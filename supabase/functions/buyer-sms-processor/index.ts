import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getCompanyCompliance(supabase: ReturnType<typeof createClient>, companyId: string) {
  const { data } = await supabase.from("companies")
    .select("sms_company_name, website_url, sms_help_phone, legal_name, name")
    .eq("id", companyId).maybeSingle();
  const companyName = data?.sms_company_name || data?.legal_name || data?.name || "This company";
  return { companyName, footer: `\n\n${companyName}\nReply STOP to opt out` };
}

function appendComplianceFooter(body: string, companyName: string, footer: string): string {
  if (body.includes("STOP") && body.includes(companyName)) return body;
  return body + footer;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return null;
}

interface TwilioResult {
  success: boolean;
  sid?: string;
  error?: string;
}

async function getTwilioCredentials(supabase: ReturnType<typeof createClient>, companyId: string) {
  const { data } = await supabase.from("integration_settings")
    .select("credentials").eq("company_id", companyId).eq("provider", "twilio").maybeSingle();
  if (data?.credentials?.account_sid && data?.credentials?.auth_token) {
    return { accountSid: data.credentials.account_sid, authToken: data.credentials.auth_token };
  }
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (sid && token) return { accountSid: sid, authToken: token };
  return null;
}

async function sendViaTwilio(to: string, from: string, body: string, accountSid: string, authToken: string): Promise<TwilioResult> {
  const formattedTo = to.startsWith("+") ? to : `+${to}`;
  const formattedFrom = from.startsWith("+") ? from : `+${from}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: formattedTo, From: formattedFrom, Body: body });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    return { success: false, error: data.message ?? `Twilio error ${resp.status}` };
  }
  return { success: true, sid: data.sid };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "launch_campaign":     return await launchCampaign(supabase, body);
      case "process_queue":       return await processQueue(supabase, body);
      case "pause_campaign":      return await setCampaignStatus(supabase, body, "paused");
      case "cancel_campaign":     return await setCampaignStatus(supabase, body, "cancelled");
      case "resume_campaign":     return await setCampaignStatus(supabase, body, "sending");
      case "get_campaign_stats":  return await getCampaignStats(supabase, body);
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

async function launchCampaign(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { campaign_id, user_id } = params as { campaign_id: string; user_id?: string };

  const { data: campaign } = await supabase
    .from("buyer_campaigns")
    .select("*")
    .eq("id", campaign_id)
    .maybeSingle();

  if (!campaign) return jsonResponse({ error: "Campaign not found" }, 404);
  if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
    return jsonResponse({ error: `Cannot launch campaign with status: ${campaign.status}` }, 400);
  }

  const { data: recipients } = await supabase
    .from("buyer_campaign_recipients")
    .select("*")
    .eq("campaign_id", campaign_id)
    .eq("status", "queued");

  if (!recipients || recipients.length === 0) {
    return jsonResponse({ error: "No queued recipients to send to" }, 400);
  }

  await supabase.from("buyer_campaigns").update({
    status: "sending",
    launched_by: user_id ?? null,
    launched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", campaign_id);

  const limit = Math.min(campaign.daily_message_limit ?? 200, recipients.length);
  const batch = recipients.slice(0, limit);
  let sent = 0, failed = 0;

  for (const recipient of batch) {
    const result = await sendToRecipient(supabase, campaign, recipient);
    if (result.success) sent++;
    else failed++;
  }

  const remaining = recipients.length - batch.length;
  const newStatus = remaining > 0 ? "sending" : "completed";

  await supabase.from("buyer_campaigns").update({
    status: newStatus,
    sent_count: campaign.sent_count + sent,
    failed_count: campaign.failed_count + failed,
    completed_at: newStatus === "completed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", campaign_id);

  await logAudit(supabase, campaign.company_id, campaign_id, "launched", {
    sent, failed, remaining, user_id,
  });

  return jsonResponse({ success: true, sent, failed, remaining, status: newStatus });
}

async function sendToRecipient(
  supabase: ReturnType<typeof createClient>,
  campaign: Record<string, unknown>,
  recipient: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const companyId = campaign.company_id as string;
  const contactId = recipient.contact_id as string | null;

  // Compliance: check quiet hours
  const { data: compliance } = await supabase
    .from("buyer_compliance_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (compliance?.quiet_hours_enabled) {
    const now = new Date();
    const [sh, sm] = (compliance.quiet_hours_start as string).split(":").map(Number);
    const [eh, em] = (compliance.quiet_hours_end as string).split(":").map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    const inQuiet =
      startMinutes < endMinutes
        ? nowMinutes >= startMinutes && nowMinutes < endMinutes
        : nowMinutes >= startMinutes || nowMinutes < endMinutes;

    if (inQuiet) {
      const tomorrow = new Date();
      tomorrow.setHours(eh, em + 5, 0, 0);
      if (tomorrow <= now) tomorrow.setDate(tomorrow.getDate() + 1);
      await supabase.from("buyer_campaign_recipients").update({
        scheduled_at: tomorrow.toISOString(),
        status: "queued",
        failure_reason: `Rescheduled: quiet hours (${compliance.quiet_hours_start}-${compliance.quiet_hours_end})`,
        updated_at: new Date().toISOString(),
      }).eq("id", recipient.id);
      return { success: false, error: "quiet_hours" };
    }
  }

  // Compliance: check opt-out and suppression
  if (contactId) {
    const { data: contact } = await supabase.from("contacts").select("do_not_text").eq("id", contactId).maybeSingle();
    if (contact?.do_not_text) {
      await supabase.from("buyer_campaign_recipients").update({
        status: "suppressed",
        suppression_reason: "Contact opted out",
        updated_at: new Date().toISOString(),
      }).eq("id", recipient.id);
      return { success: false, error: "opted_out" };
    }
  }

  // Check suppression entries
  const { data: suppression } = await supabase
    .from("suppression_entries")
    .select("id")
    .eq("company_id", companyId)
    .eq("contact_id", contactId ?? "")
    .eq("is_active", true)
    .maybeSingle();

  if (suppression) {
    await supabase.from("buyer_campaign_recipients").update({
      status: "suppressed",
      suppression_reason: "Active suppression entry",
      updated_at: new Date().toISOString(),
    }).eq("id", recipient.id);
    return { success: false, error: "suppressed" };
  }

  // Check frequency cap
  const capHours = campaign.frequency_cap_hours as number ?? 72;
  const capSince = new Date(Date.now() - capHours * 3600 * 1000).toISOString();
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("direction", "outbound")
    .eq("to_number", recipient.phone_normalized as string)
    .gte("created_at", capSince)
    .limit(1);

  if (recentMessages && recentMessages.length > 0) {
    await supabase.from("buyer_campaign_recipients").update({
      status: "suppressed",
      suppression_reason: `Frequency cap: message sent within last ${capHours}h`,
      updated_at: new Date().toISOString(),
    }).eq("id", recipient.id);
    return { success: false, error: "frequency_cap" };
  }

  // Find or create conversation
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id")
    .eq("company_id", companyId)
    .eq("contact_id", contactId ?? "")
    .eq("channel", "sms")
    .maybeSingle();

  let convId: string | null = existingConv?.id ?? null;
  if (!convId && contactId) {
    const { data: newConv } = await supabase.from("conversations").insert({
      company_id: companyId,
      contact_id: contactId,
      channel: "sms",
      status: "open",
      last_message_at: new Date().toISOString(),
      last_message_preview: (recipient.message_body as string).slice(0, 80),
    }).select("id").single();
    convId = newConv?.id ?? null;
  }

  // Get sender number
  let fromNumber = "";
  if (campaign.sender_phone_number_id) {
    const { data: pn } = await supabase
      .from("phone_numbers").select("number").eq("id", campaign.sender_phone_number_id).maybeSingle();
    if (pn) fromNumber = pn.number;
  }
  if (!fromNumber) {
    const { data: defaultPn } = await supabase
      .from("phone_numbers").select("number")
      .eq("company_id", companyId).eq("is_active", true)
      .limit(1).maybeSingle();
    if (defaultPn) fromNumber = defaultPn.number;
  }

  if (!fromNumber) {
    await supabase.from("buyer_campaign_recipients").update({
      status: "failed",
      failure_reason: "No sender phone number configured",
      updated_at: new Date().toISOString(),
    }).eq("id", recipient.id);
    return { success: false, error: "no_sender_number" };
  }

  // Get per-company credentials and compliance
  const creds = await getTwilioCredentials(supabase, companyId);
  if (!creds) {
    await supabase.from("buyer_campaign_recipients").update({
      status: "failed", failure_reason: "Twilio not configured for this account",
      updated_at: new Date().toISOString(),
    }).eq("id", recipient.id);
    return { success: false, error: "twilio_not_configured" };
  }

  const comp = await getCompanyCompliance(supabase, companyId);
  const toNumber = recipient.phone_normalized as string;
  const formattedTo = toNumber.startsWith("+") ? toNumber : `+${toNumber}`;
  const formattedFrom = fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`;
  const compliantBody = appendComplianceFooter(recipient.message_body as string, comp.companyName, comp.footer);
  const twilioResult = await sendViaTwilio(formattedTo, formattedFrom, compliantBody, creds.accountSid, creds.authToken);

  // Insert message
  const { data: message } = await supabase.from("messages").insert({
    company_id: companyId,
    conversation_id: convId,
    contact_id: contactId,
    direction: "outbound",
    body: compliantBody,
    status: twilioResult.success ? "sent" : "failed",
    is_simulated: false,
    is_automated: true,
    from_number: fromNumber,
    to_number: toNumber,
    message_sid: twilioResult.sid ?? null,
    error_message: twilioResult.error ?? null,
    sent_at: twilioResult.success ? new Date().toISOString() : null,
  }).select("id").single();

  // Update recipient
  await supabase.from("buyer_campaign_recipients").update({
    status: twilioResult.success ? "sent" : "failed",
    sent_at: twilioResult.success ? new Date().toISOString() : null,
    attempt_count: (recipient.attempt_count as number) + 1,
    provider_message_id: twilioResult.sid ?? null,
    is_simulated: false,
    conversation_id: convId,
    message_id: message?.id ?? null,
    failure_reason: twilioResult.error ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", recipient.id);

  // Update conversation
  if (convId) {
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: (recipient.message_body as string).slice(0, 80),
      updated_at: new Date().toISOString(),
    }).eq("id", convId);
  }

  return { success: twilioResult.success, error: twilioResult.error };
}

async function processQueue(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id } = params as { company_id?: string };

  let campaignQuery = supabase
    .from("buyer_campaigns")
    .select("id, company_id")
    .in("status", ["sending", "queued"])
    .limit(10);

  if (company_id) campaignQuery = campaignQuery.eq("company_id", company_id);

  const { data: campaigns } = await campaignQuery;
  if (!campaigns || campaigns.length === 0) return jsonResponse({ processed: 0 });

  let totalProcessed = 0;
  for (const campaign of campaigns) {
    await launchCampaign(supabase, { campaign_id: campaign.id, action: "launch_campaign" });
    totalProcessed++;
  }

  return jsonResponse({ processed: totalProcessed });
}

async function setCampaignStatus(
  supabase: ReturnType<typeof createClient>,
  params: Record<string, unknown>,
  status: string,
) {
  const { campaign_id, user_id } = params as { campaign_id: string; user_id?: string };

  if (status === "cancelled") {
    await supabase.from("buyer_campaign_recipients")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("campaign_id", campaign_id)
      .eq("status", "queued");
  }

  await supabase.from("buyer_campaigns").update({
    status,
    updated_at: new Date().toISOString(),
  }).eq("id", campaign_id);

  const { data: camp } = await supabase.from("buyer_campaigns").select("company_id").eq("id", campaign_id).maybeSingle();
  if (camp) {
    await logAudit(supabase, camp.company_id, campaign_id, status, { user_id });
  }

  return jsonResponse({ success: true, status });
}

async function getCampaignStats(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { campaign_id } = params as { campaign_id: string };

  const { data: campaign } = await supabase.from("buyer_campaigns").select("*").eq("id", campaign_id).maybeSingle();
  if (!campaign) return jsonResponse({ error: "Campaign not found" }, 404);

  const { data: statusCounts } = await supabase
    .from("buyer_campaign_recipients")
    .select("status")
    .eq("campaign_id", campaign_id);

  const counts: Record<string, number> = {};
  for (const row of (statusCounts ?? [])) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  await supabase.from("buyer_campaigns").update({
    queued_count: counts.queued ?? 0,
    sent_count: (counts.sent ?? 0) + (counts.delivered ?? 0),
    delivered_count: counts.delivered ?? 0,
    failed_count: counts.failed ?? 0,
    suppressed_count: (counts.suppressed ?? 0) + (counts.opted_out ?? 0),
    updated_at: new Date().toISOString(),
  }).eq("id", campaign_id);

  return jsonResponse({ campaign, recipient_counts: counts });
}

async function logAudit(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  campaignId: string,
  action: string,
  metadata: unknown,
) {
  await supabase.from("system_events").insert({
    company_id: companyId,
    event_type: `buyer_campaign.${action}`,
    entity_type: "buyer_campaign",
    entity_id: campaignId,
    metadata,
    severity: "info",
  }).then(() => null).catch(() => null);
}
