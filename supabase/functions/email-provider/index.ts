import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RESEND_API_URL = "https://api.resend.com";

interface CompanyEmailConfig {
  fromEmail: string;
  fromName: string;
  resendApiKey: string;
}

async function getEmailConfig(supabase: ReturnType<typeof createClient>, companyId: string): Promise<CompanyEmailConfig | null> {
  const { data: company } = await supabase.from("companies")
    .select("from_email, from_email_name, name").eq("id", companyId).maybeSingle();

  const { data: integration } = await supabase.from("integration_settings")
    .select("credentials, status").eq("company_id", companyId).eq("provider", "resend").maybeSingle();

  const apiKey = integration?.credentials?.api_key || Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return null;

  return {
    fromEmail: company?.from_email || "noreply@example.com",
    fromName: company?.from_email_name || company?.name || "CRM",
    resendApiKey: apiKey,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (req.method === "POST" && req.headers.get("x-resend-webhook")) {
      const rawBody = await req.text();
      const payload = JSON.parse(rawBody);

      // Verify webhook signature if any company has a signing secret configured
      const svixId = req.headers.get("svix-id");
      const svixTimestamp = req.headers.get("svix-timestamp");
      const svixSignature = req.headers.get("svix-signature");

      if (svixId && svixTimestamp && svixSignature) {
        const { data: secrets } = await supabase.from("company_credentials")
          .select("credential_value")
          .eq("provider", "resend")
          .eq("credential_key", "webhook_signing_secret");

        let verified = false;
        for (const row of secrets ?? []) {
          try {
            const wh = new Webhook(row.credential_value);
            wh.verify(rawBody, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
            verified = true;
            break;
          } catch { /* try next secret */ }
        }

        if ((secrets?.length ?? 0) > 0 && !verified) {
          return jsonResponse({ error: "Invalid webhook signature" }, 401);
        }
      }

      return await handleResendWebhook(supabase, payload);
    }

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "send":            return await sendEmail(supabase, body);
      case "receive_webhook": return await handleResendWebhook(supabase, body);
      case "get_status":      return await getEmailStatus(supabase, body);
      default:                return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ─── Send Email via Resend ──────────────────────────────────────────────────
async function sendEmail(supabase: ReturnType<typeof createClient>, params: {
  company_id: string; contact_id?: string; conversation_id?: string;
  to_email: string; subject: string; text_body?: string; html_body?: string;
  cc?: string[]; bcc?: string[]; reply_to?: string; in_reply_to?: string;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
  user_id?: string;
}) {
  const config = await getEmailConfig(supabase, params.company_id);
  if (!config) return jsonResponse({ error: "Email not configured for this account. Add your Resend API key in Settings > Integrations." }, 500);

  const { company_id, contact_id, conversation_id, to_email, subject, user_id } = params;
  const htmlBody = params.html_body ?? `<p>${(params.text_body ?? "").replace(/\n/g, "<br/>")}</p>`;
  const textBody = params.text_body ?? stripHtml(htmlBody);

  // Find or create conversation
  let convId = conversation_id;
  if (!convId && contact_id) {
    const { data: existing } = await supabase.from("conversations").select("id")
      .eq("company_id", company_id).eq("contact_id", contact_id).eq("channel", "email").maybeSingle();
    if (existing) {
      convId = existing.id;
    } else {
      const { data: newConv } = await supabase.from("conversations").insert({
        company_id, contact_id, channel: "email", status: "open",
        last_message_at: new Date().toISOString(),
        last_message_preview: `[Email] ${subject}`,
        assigned_user_id: user_id ?? null,
      }).select("id").single();
      convId = newConv?.id;
    }
  }

  const resendPayload: Record<string, unknown> = {
    from: `${config.fromName} <${config.fromEmail}>`,
    to: [to_email], subject, html: htmlBody, text: textBody,
    reply_to: params.reply_to ?? config.fromEmail,
  };

  if (params.cc?.length) resendPayload.cc = params.cc;
  if (params.bcc?.length) resendPayload.bcc = params.bcc;

  const headers: Record<string, string> = {};
  if (params.in_reply_to) {
    headers["In-Reply-To"] = params.in_reply_to;
    headers["References"] = params.in_reply_to;
  }
  if (Object.keys(headers).length > 0) resendPayload.headers = headers;

  if (params.attachments?.length) {
    resendPayload.attachments = params.attachments.map((a) => ({
      filename: a.filename, content: a.content, content_type: a.content_type,
    }));
  }

  const resp = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(resendPayload),
  });

  const resendData = await resp.json();
  const success = resp.ok && resendData.id;

  const { data: message, error: msgErr } = await supabase.from("messages").insert({
    company_id, conversation_id: convId ?? null, contact_id: contact_id ?? null,
    direction: "outbound", body: textBody, html_body: htmlBody, subject,
    content_type: "email", status: success ? "sent" : "failed",
    is_simulated: false, is_automated: false,
    from_number: config.fromEmail, to_number: to_email,
    message_sid: resendData.id ?? null, email_message_id: resendData.id ?? null,
    in_reply_to: params.in_reply_to ?? null, cc: params.cc ?? null,
    bcc: params.bcc ?? null, reply_to: params.reply_to ?? config.fromEmail,
    error_message: success ? null : (resendData.message ?? `Resend error ${resp.status}`),
    sent_at: success ? new Date().toISOString() : null, created_by: user_id ?? null,
  }).select().single();

  if (msgErr) return jsonResponse({ error: msgErr.message }, 500);

  if (success && params.attachments?.length && message) {
    for (const att of params.attachments) {
      await supabase.from("message_attachments").insert({
        company_id, message_id: message.id, filename: att.filename,
        content_type: att.content_type ?? "application/octet-stream",
        size_bytes: att.content ? Math.ceil(att.content.length * 0.75) : null,
      });
    }
  }

  if (convId) {
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: `[Email] ${subject}`,
      updated_at: new Date().toISOString(),
    }).eq("id", convId);
  }

  await supabase.from("webhook_logs").insert({
    company_id, provider: "resend", event_type: "email.sent",
    processing_status: success ? "success" : "failed", is_simulated: false,
    raw_payload: { to: to_email, subject, resend_id: resendData.id },
    response_status: resp.status, error_detail: success ? null : resendData.message,
  }).then(() => null).catch(() => null);

  return jsonResponse({
    success, message_id: message?.id, conversation_id: convId,
    resend_id: resendData.id ?? null, error: success ? null : (resendData.message ?? "Send failed"),
  });
}

// ─── Resend Inbound Webhook ────────────────────────────────────────────────
async function handleResendWebhook(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const eventType = payload.type as string ?? "";
  if (["email.sent", "email.delivered", "email.bounced", "email.complained", "email.delivery_delayed"].includes(eventType)) {
    return await handleDeliveryEvent(supabase, payload);
  }
  if (eventType === "email.received" || payload.from || payload.to) {
    return await handleInboundEmail(supabase, payload);
  }
  return jsonResponse({ received: true });
}

async function handleDeliveryEvent(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const emailId = data.email_id as string ?? data.id as string;
  const eventType = payload.type as string;
  if (!emailId) return jsonResponse({ received: true });

  const statusMap: Record<string, string> = {
    "email.sent": "sent", "email.delivered": "delivered",
    "email.bounced": "failed", "email.complained": "failed", "email.delivery_delayed": "sent",
  };

  const newStatus = statusMap[eventType] ?? "sent";
  const update: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === "delivered") update.delivered_at = new Date().toISOString();
  if (newStatus === "failed") update.error_message = `Email ${eventType.split(".")[1]}`;

  await supabase.from("messages").update(update)
    .or(`message_sid.eq.${emailId},email_message_id.eq.${emailId}`);

  return jsonResponse({ received: true, status: newStatus });
}

async function handleInboundEmail(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const fromRaw = data.from as string ?? "";
  const toRaw = data.to as string | string[] ?? "";
  const subject = data.subject as string ?? "(No subject)";
  const textBody = data.text as string ?? "";
  const htmlBody = data.html as string ?? "";
  const emailMessageId = data.message_id as string ?? data.id as string ?? null;
  const inReplyTo = data.in_reply_to as string ?? null;
  const cc = data.cc as string[] ?? null;
  const attachments = data.attachments as Array<Record<string, unknown>> ?? [];

  const fromEmail = extractEmail(fromRaw);
  const toAddresses = Array.isArray(toRaw) ? toRaw : [toRaw];

  // Find company by matching the to-address against company from_email
  let companyId: string | null = null;
  for (const addr of toAddresses) {
    const toEmail = extractEmail(addr).toLowerCase();
    const { data: company } = await supabase.from("companies")
      .select("id").eq("from_email", toEmail).maybeSingle();
    if (company) { companyId = company.id; break; }
  }

  // Fallback: just use the first company
  if (!companyId) {
    const { data: company } = await supabase.from("companies").select("id").limit(1).maybeSingle();
    if (!company) return jsonResponse({ error: "No company found" }, 500);
    companyId = company.id;
  }

  // Find contact by email
  let contactId: string | null = null;
  const { data: contact } = await supabase.from("contacts")
    .select("id").eq("company_id", companyId).ilike("primary_email", fromEmail).maybeSingle();
  contactId = contact?.id ?? null;

  if (!contactId) {
    const fromName = extractName(fromRaw);
    const { data: newContact } = await supabase.from("contacts").insert({
      company_id: companyId, first_name: fromName.split(" ")[0] || fromEmail.split("@")[0],
      last_name: fromName.split(" ").slice(1).join(" ") || null,
      primary_email: fromEmail, contact_type: "unknown",
    }).select("id").single();
    contactId = newContact?.id ?? null;
  }

  // Thread by In-Reply-To or find existing email conversation
  let convId: string | null = null;
  if (inReplyTo) {
    const { data: threadMsg } = await supabase.from("messages")
      .select("conversation_id").eq("email_message_id", inReplyTo).maybeSingle();
    if (threadMsg?.conversation_id) convId = threadMsg.conversation_id;
  }
  if (!convId && contactId) {
    const { data: existingConv } = await supabase.from("conversations").select("id")
      .eq("company_id", companyId).eq("contact_id", contactId).eq("channel", "email").maybeSingle();
    convId = existingConv?.id ?? null;
  }
  if (!convId) {
    const { data: newConv } = await supabase.from("conversations").insert({
      company_id: companyId, contact_id: contactId, channel: "email", status: "open",
      last_message_at: new Date().toISOString(), last_message_preview: `[Email] ${subject}`, unread_count: 1,
    }).select("id").single();
    convId = newConv?.id ?? null;
  }

  const config = await getEmailConfig(supabase, companyId);
  const toEmail = config?.fromEmail ?? "unknown@example.com";

  const { data: message } = await supabase.from("messages").insert({
    company_id: companyId, conversation_id: convId, contact_id: contactId,
    direction: "inbound", body: textBody || stripHtml(htmlBody),
    html_body: htmlBody || null, subject, content_type: "email",
    status: "received", is_simulated: false, is_automated: false,
    from_number: fromEmail, to_number: toEmail,
    email_message_id: emailMessageId, in_reply_to: inReplyTo, cc,
    sent_at: new Date().toISOString(),
  }).select().single();

  if (message && attachments.length > 0) {
    for (const att of attachments) {
      const filename = att.filename as string ?? "attachment";
      const attContentType = att.content_type as string ?? "application/octet-stream";
      const content = att.content as string;
      const size = att.size as number ?? null;
      let storagePath: string | null = null;
      let url: string | null = null;

      if (content) {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        storagePath = `${companyId}/${message.id}/${safeName}`;
        let fileData: Uint8Array;
        try {
          const binaryStr = atob(content);
          fileData = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) fileData[i] = binaryStr.charCodeAt(i);
        } catch { fileData = new TextEncoder().encode(content); }

        const { error: uploadErr } = await supabase.storage
          .from("email-attachments").upload(storagePath, fileData, { contentType: attContentType, upsert: true });
        if (!uploadErr) {
          const { data: signedUrl } = await supabase.storage
            .from("email-attachments").createSignedUrl(storagePath, 60 * 60 * 24 * 365);
          url = signedUrl?.signedUrl ?? null;
        }
      }

      await supabase.from("message_attachments").insert({
        company_id: companyId, message_id: message.id, filename,
        content_type: attContentType, size_bytes: size, storage_path: storagePath, url,
        is_inline: att.content_disposition === "inline",
        content_id: att.content_id as string ?? null,
      });
    }
  }

  if (convId) {
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(), last_message_preview: `[Email] ${subject}`,
      updated_at: new Date().toISOString(),
    }).eq("id", convId);
    await supabase.rpc("increment_conversation_unread", { conv_id: convId }).catch(() => {
      return supabase.from("conversations").update({ unread_count: 1 }).eq("id", convId);
    });
  }

  await supabase.from("webhook_logs").insert({
    company_id: companyId, provider: "resend", event_type: "email.received",
    processing_status: "success", is_simulated: false,
    raw_payload: { from: fromEmail, subject, attachment_count: attachments.length },
    response_status: 200,
  }).then(() => null).catch(() => null);

  return jsonResponse({
    success: true, message_id: message?.id, conversation_id: convId,
    contact_id: contactId, attachment_count: attachments.length,
  });
}

async function getEmailStatus(supabase: ReturnType<typeof createClient>, params: { message_id: string; company_id?: string }) {
  const { data: message } = await supabase.from("messages")
    .select("id, status, message_sid, sent_at, delivered_at, error_message, company_id")
    .eq("id", params.message_id).maybeSingle();
  if (!message) return jsonResponse({ error: "Message not found" }, 404);

  if (message.message_sid) {
    const config = await getEmailConfig(supabase, message.company_id);
    if (config) {
      const resp = await fetch(`${RESEND_API_URL}/emails/${message.message_sid}`, {
        headers: { "Authorization": `Bearer ${config.resendApiKey}` },
      });
      if (resp.ok) {
        const resendData = await resp.json();
        const newStatus = resendData.last_event ?? message.status;
        if (newStatus !== message.status) {
          await supabase.from("messages").update({
            status: newStatus === "delivered" ? "delivered" : newStatus === "bounced" ? "failed" : message.status,
            delivered_at: newStatus === "delivered" ? new Date().toISOString() : message.delivered_at,
          }).eq("id", message.id);
        }
        return jsonResponse({ ...message, resend_status: resendData });
      }
    }
  }

  return jsonResponse(message);
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].trim() : raw.trim();
}

function extractName(raw: string): string {
  const match = raw.match(/^([^<]+)</);
  return match ? match[1].trim().replace(/"/g, "") : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
}
