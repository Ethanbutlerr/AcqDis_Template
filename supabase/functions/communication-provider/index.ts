import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── A2P Compliance Constants ───────────────────────────────────────────────
const COMPANY_NAME = "Good Neighbor Home Buyers LLC";
const COMPANY_URL = "goodnhb.com";
const COMPLIANCE_FOOTERS_TEMPLATES = [
  (name: string) => `\n\nReply STOP to opt out. ${name}`,
  (name: string) => `\n\nReply QUIT to stop receiving messages. ${name}`,
  (name: string) => `\n\nReply WRONG if we have the wrong person. ${name}`,
  (name: string) => `\n\nReply UNSUBSCRIBE to halt messages. ${name}`,
];
const HELP_RESPONSE = `You are receiving messages from ${COMPANY_NAME}. For assistance, visit ${COMPANY_URL} or call us directly. Reply STOP to unsubscribe. Msg&data rates may apply. Msg frequency varies.`;
const OPT_OUT_CONFIRMATION = `You have been unsubscribed and will not receive further messages from ${COMPANY_NAME}. If this was a mistake, visit ${COMPANY_URL} to re-subscribe.`;
const OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "WRONG"];

function appendComplianceFooter(body: string, contactId?: string, companyName?: string): string {
  const keywords = ["STOP", "QUIT", "WRONG", "UNSUBSCRIBE"];
  if (keywords.some(k => body.includes(k))) return body;
  const name = companyName || COMPANY_NAME;
  const seed = (contactId ?? "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const index = seed % COMPLIANCE_FOOTERS_TEMPLATES.length;
  return body + COMPLIANCE_FOOTERS_TEMPLATES[index](name);
}

interface TwilioResult {
  success: boolean;
  sid?: string;
  error?: string;
}

async function sendViaTwilio(to: string, from: string, body: string, accountSid?: string, authToken?: string, messagingServiceSid?: string): Promise<TwilioResult> {
  const sid = accountSid || Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = authToken || Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) {
    return { success: false, error: "Twilio credentials not configured" };
  }

  const formattedTo = to.startsWith("+") ? to : `+${to}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: formattedTo, Body: body });

  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else {
    const formattedFrom = from.startsWith("+") ? from : `+${from}`;
    params.set("From", formattedFrom);
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    const errorCode = data.code ? ` (${data.code})` : "";
    return { success: false, error: (data.message ?? `Twilio error ${resp.status}`) + errorCode };
  }
  return { success: true, sid: data.sid };
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    // Test events are developer tools, never ordinary CRM permissions.
    if (typeof action === "string" && action.startsWith("simulate_")) {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!token) return jsonResponse({ error: "Authentication required" }, 401);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) return jsonResponse({ error: "Authentication required" }, 401);
      const { data: profile } = await supabase.from("profiles")
        .select("company_id, is_agency_admin, is_disabled").eq("id", user.id).maybeSingle();
      if (!profile?.is_agency_admin || profile.is_disabled || profile.company_id !== body.company_id) {
        return jsonResponse({ error: "Developer access required" }, 403);
      }
    }

    switch (action) {
      case "send_sms":         return await sendSms(supabase, body);
      case "simulate_inbound": return await simulateInboundSms(supabase, body);
      case "simulate_call":    return await simulateCall(supabase, body);
      case "simulate_delivery":return await simulateDelivery(supabase, body);
      case "send_discord":     return await sendDiscordNotification(supabase, body);
      case "log_webhook":      return await logWebhook(supabase, body);
      case "get_integrations": return await getIntegrations(supabase, body);
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ─── Send SMS (real via Twilio) ─────────────────────────────────────────────
async function sendSms(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id, contact_id, conversation_id, body, from_number_id, user_id } = params as {
    company_id: string; contact_id: string; conversation_id?: string;
    body: string; from_number_id?: string; user_id?: string;
  };

  const { data: contact } = await supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle();
  if (!contact) return jsonResponse({ error: "Contact not found" }, 404);

  if (contact.do_not_text) return jsonResponse({ error: "Contact has opted out of SMS" }, 400);

  // Resolve per-company Twilio credentials from company_credentials table
  const { data: credRows } = await supabase
    .from("company_credentials")
    .select("credential_key, credential_value")
    .eq("company_id", company_id)
    .eq("provider", "twilio");

  const credMap: Record<string, string> = {};
  for (const row of credRows ?? []) {
    credMap[row.credential_key] = row.credential_value;
  }
  const companyAccountSid = credMap.account_sid || undefined;
  const companyAuthToken = credMap.auth_token || undefined;
  const companyMessagingServiceSid = credMap.messaging_service_sid || undefined;

  let fromNumber = "";
  if (from_number_id) {
    const { data: pn } = await supabase.from("phone_numbers").select("*").eq("id", from_number_id).maybeSingle();
    if (pn) fromNumber = pn.number;
  }
  if (!fromNumber && user_id) {
    const { data: pn } = await supabase
      .from("phone_numbers").select("*")
      .eq("company_id", company_id).eq("assigned_user_id", user_id).eq("is_active", true)
      .limit(1).maybeSingle();
    if (pn) fromNumber = pn.number;
  }
  if (!fromNumber) {
    const { data: pn } = await supabase
      .from("phone_numbers").select("*")
      .eq("company_id", company_id).eq("is_default", true).eq("is_active", true)
      .limit(1).maybeSingle();
    if (pn) fromNumber = pn.number;
  }
  if (!fromNumber) {
    const { data: pn } = await supabase
      .from("phone_numbers").select("*")
      .eq("company_id", company_id).eq("is_active", true)
      .limit(1).maybeSingle();
    if (pn) fromNumber = pn.number;
  }

  if (!fromNumber) return jsonResponse({ error: "No sender phone number configured" }, 400);

  let convId = conversation_id;
  if (!convId) {
    const { data: existing } = await supabase
      .from("conversations").select("id")
      .eq("company_id", company_id).eq("contact_id", contact_id).eq("channel", "sms")
      .maybeSingle();
    if (existing) {
      convId = existing.id;
    } else {
      const { data: newConv } = await supabase.from("conversations").insert({
        company_id, contact_id, channel: "sms", status: "open",
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 80),
        assigned_user_id: user_id ?? null,
      }).select("id").single();
      convId = newConv?.id;
    }
  }

  const toNumber = contact.primary_phone_normalized ?? contact.primary_phone;
  const formattedTo = toNumber.startsWith("+") ? toNumber : `+${toNumber}`;
  const formattedFrom = fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`;

  const compliantBody = appendComplianceFooter(body, contact_id);
  const twilioResult = await sendViaTwilio(formattedTo, formattedFrom, compliantBody, companyAccountSid, companyAuthToken, companyMessagingServiceSid);

  const { data: message, error: msgErr } = await supabase.from("messages").insert({
    company_id,
    conversation_id: convId,
    contact_id,
    direction: "outbound",
    channel: "sms",
    body: compliantBody,
    status: twilioResult.success ? "sent" : "failed",
    is_simulated: false,
    is_automated: false,
    from_number: fromNumber,
    to_number: toNumber,
    message_sid: twilioResult.sid ?? null,
    error_message: twilioResult.error ?? null,
    sent_at: twilioResult.success ? new Date().toISOString() : null,
    created_by: user_id ?? null,
  }).select("id").single();

  if (msgErr) return jsonResponse({ error: msgErr.message }, 500);

  await supabase.from("conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: body.slice(0, 80),
    updated_at: new Date().toISOString(),
  }).eq("id", convId);

  await logWebhookInternal(supabase, {
    company_id, provider: "twilio", event_type: "message.sent",
    processing_status: twilioResult.success ? "success" : "failed",
    is_simulated: false,
    raw_payload: { to: toNumber, body: body.slice(0, 40), message_sid: twilioResult.sid },
    error_detail: twilioResult.error ?? null,
  });

  return jsonResponse({
    success: twilioResult.success,
    message_id: message.id,
    conversation_id: convId,
    message_sid: twilioResult.sid ?? null,
    error: twilioResult.error ?? null,
  });
}

// ─── Simulate Inbound SMS (dev tool) ────────────────────────────────────────
async function simulateInboundSms(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id, contact_id, body } = params as {
    company_id: string; contact_id: string; body: string;
  };

  const { data: contact } = await supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle();
  if (!contact) return jsonResponse({ error: "Contact not found" }, 404);

  const upperBody = (body as string).trim().toUpperCase();
  const isOptOut = OPT_OUT_KEYWORDS.includes(upperBody);
  const isHelp = upperBody === "HELP";

  const { data: existing } = await supabase
    .from("conversations").select("id, is_opted_out")
    .eq("company_id", company_id).eq("contact_id", contact_id).eq("channel", "sms")
    .maybeSingle();

  let convId = existing?.id;
  if (!convId) {
    const { data: newConv } = await supabase.from("conversations").insert({
      company_id, contact_id, channel: "sms", status: "open",
      last_message_at: new Date().toISOString(),
      last_message_preview: (body as string).slice(0, 80),
      unread_count: 1,
      is_opted_out: isOptOut,
    }).select("id").single();
    convId = newConv?.id;
  } else {
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: (body as string).slice(0, 80),
      is_opted_out: isOptOut ? true : existing?.is_opted_out,
      updated_at: new Date().toISOString(),
    }).eq("id", convId);
  }

  const { data: message } = await supabase.from("messages").insert({
    company_id,
    conversation_id: convId,
    contact_id,
    direction: "inbound",
    body,
    status: "received",
    is_simulated: true,
    is_automated: false,
    from_number: contact.primary_phone_normalized ?? contact.primary_phone,
    created_at: new Date().toISOString(),
  }).select("id").single();

  if (isOptOut) {
    await handleOptOut(supabase, { company_id, contact, conv_id: convId });
  }

  if (isHelp) {
    await supabase.from("messages").insert({
      company_id, conversation_id: convId, contact_id,
      direction: "outbound", body: HELP_RESPONSE,
      status: "delivered", is_simulated: true, is_automated: true,
      sent_at: new Date().toISOString(), delivered_at: new Date().toISOString(),
    });
  }

  await supabase.rpc("increment_conversation_unread", { conv_id: convId }).catch(() => {
    return supabase.from("conversations").update({ unread_count: (existing ? 2 : 1) }).eq("id", convId);
  });

  return jsonResponse({ success: true, message_id: message?.id, conversation_id: convId, opt_out: isOptOut, simulated: true });
}

// ─── Opt-Out Handler ─────────────────────────────────────────────────────────
async function handleOptOut(supabase: ReturnType<typeof createClient>, params: {
  company_id: string; contact: Record<string, unknown>; conv_id: string | undefined;
}) {
  const { company_id, contact, conv_id } = params;
  const contactId = contact.id as string;

  await supabase.from("contacts").update({
    do_not_text: true, opt_out_date: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", contactId);

  await supabase.from("suppression_entries").insert({
    company_id, contact_id: contactId,
    reason: "opted_out", source: "inbound_sms_keyword", is_active: true,
    notes: "Contact replied with opt-out keyword",
  }).then(() => null).catch(() => null);

  await supabase.from("lead_records").update({
    outreach_eligibility: "opted_out", response_status: "opted_out", updated_at: new Date().toISOString(),
  }).eq("company_id", company_id).eq("contact_id", contactId);

  await supabase.from("messaging_jobs").update({ status: "canceled" })
    .eq("company_id", company_id).eq("contact_id", contactId).eq("status", "scheduled");

  if (conv_id) {
    await supabase.from("conversations").update({ is_opted_out: true, updated_at: new Date().toISOString() }).eq("id", conv_id);
    await supabase.from("messages").insert({
      company_id, conversation_id: conv_id, contact_id: contactId,
      direction: "outbound",
      body: OPT_OUT_CONFIRMATION,
      status: "delivered", is_simulated: true, is_automated: true,
      sent_at: new Date().toISOString(), delivered_at: new Date().toISOString(),
    });
  }

  await supabase.from("activity_events").insert({
    company_id, entity_type: "contact", entity_id: contactId,
    event_type: "opted_out", metadata: { source: "inbound_sms_keyword" },
  });
}

// ─── Simulate Call (dev tool) ───────────────────────────────────────────────
async function simulateCall(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id, contact_id, outcome, user_id, phone_number_id } = params as {
    company_id: string; contact_id: string;
    outcome: "answered" | "missed" | "voicemail";
    user_id?: string; phone_number_id?: string;
  };

  const { data: contact } = await supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle();
  if (!contact) return jsonResponse({ error: "Contact not found" }, 404);

  const { data: existing } = await supabase
    .from("conversations").select("id")
    .eq("company_id", company_id).eq("contact_id", contact_id)
    .in("channel", ["sms", "call"]).maybeSingle();

  let convId = existing?.id;
  if (!convId) {
    const { data: newConv } = await supabase.from("conversations").insert({
      company_id, contact_id, channel: "sms", status: "open",
      last_message_at: new Date().toISOString(),
      last_call_at: new Date().toISOString(),
      last_message_preview: `[Call ${outcome}]`,
    }).select("id").single();
    convId = newConv?.id;
  } else {
    await supabase.from("conversations").update({
      last_call_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      last_message_preview: `[Call ${outcome}]`,
      updated_at: new Date().toISOString(),
    }).eq("id", convId);
  }

  const durationSeconds = outcome === "answered" ? Math.floor(Math.random() * 300 + 30) : null;
  const voicemailText = outcome === "voicemail"
    ? "Hey, I got your message about my property. Give me a call back when you get a chance."
    : null;

  const now = new Date().toISOString();
  const { data: call } = await supabase.from("calls").insert({
    company_id,
    conversation_id: convId,
    contact_id,
    phone_number_id: phone_number_id ?? null,
    assigned_user_id: outcome === "answered" ? (user_id ?? null) : null,
    direction: "inbound",
    status: outcome === "answered" ? "answered" : outcome === "voicemail" ? "voicemail" : "missed",
    from_number: contact.primary_phone_normalized ?? contact.primary_phone,
    is_simulated: true,
    simulated_outcome: outcome,
    assigned_via: outcome === "answered" ? "call_answered" : null,
    duration_seconds: durationSeconds,
    voicemail_transcription: voicemailText,
    started_at: now,
    answered_at: outcome === "answered" ? now : null,
    ended_at: durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : now,
  }).select("id").single();

  const bodyText = outcome === "answered"
    ? `Inbound call answered - ${durationSeconds}s`
    : outcome === "voicemail"
    ? `Voicemail received: "${voicemailText}"`
    : "Missed inbound call";

  await supabase.from("messages").insert({
    company_id, conversation_id: convId, contact_id,
    direction: "inbound", body: bodyText,
    status: "received", is_simulated: true, is_automated: true,
    created_at: now,
  });

  if (outcome === "answered" && user_id) {
    const { data: acqRec } = await supabase
      .from("acquisition_records")
      .select("id, assigned_user_id")
      .eq("company_id", company_id)
      .is("assigned_user_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (acqRec) {
      await supabase.from("acquisition_records").update({
        assigned_user_id: user_id, updated_at: now,
      }).eq("id", acqRec.id);

      await supabase.from("activity_events").insert({
        company_id, entity_type: "acquisition_record", entity_id: acqRec.id,
        event_type: "call_answered",
        metadata: { assigned_to: user_id, reason: "call_answered", simulated: true },
      });
    }
  }

  await supabase.from("activity_events").insert({
    company_id, entity_type: "contact", entity_id: contact_id,
    event_type: `call_${outcome}`,
    metadata: { call_id: call?.id, simulated: true, duration_seconds: durationSeconds },
  });

  return jsonResponse({ success: true, call_id: call?.id, conversation_id: convId, outcome, simulated: true });
}

// ─── Simulate Delivery Status (dev tool) ────────────────────────────────────
async function simulateDelivery(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { message_id, status, company_id } = params as {
    message_id: string; status: "delivered" | "failed"; company_id: string;
  };

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "delivered") update.delivered_at = new Date().toISOString();
  if (status === "failed") update.error_message = "Simulated delivery failure";

  await supabase.from("messages").update(update).eq("id", message_id);

  return jsonResponse({ success: true, message_id, status, simulated: true });
}

// ─── Send Discord Notification ──────────────────────────────────────────────
async function sendDiscordNotification(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id, channel, message, embed } = params as {
    company_id: string; channel: string; message: string; embed?: Record<string, unknown>;
  };

  const { data: integration } = await supabase
    .from("integration_settings").select("*")
    .eq("company_id", company_id).eq("provider", "discord").maybeSingle();

  const webhookUrl = integration?.config?.webhook_url as string | undefined;
  let sent = false;
  let error: string | null = null;

  if (webhookUrl && integration?.status === "active") {
    try {
      const payload: Record<string, unknown> = { content: message };
      if (embed) payload.embeds = [embed];
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      sent = resp.ok;
      if (!resp.ok) error = `Discord returned ${resp.status}`;

      await supabase.from("integration_settings").update({
        last_webhook_at: new Date().toISOString(),
        last_webhook_success_at: sent ? new Date().toISOString() : undefined,
        last_webhook_failure_at: !sent ? new Date().toISOString() : undefined,
        last_error: !sent ? error : null,
        updated_at: new Date().toISOString(),
      }).eq("id", integration.id);
    } catch (e) {
      error = (e as Error).message;
    }
  } else {
    error = integration ? "Discord not active" : "Discord not configured";
  }

  await supabase.from("system_events").insert({
    company_id,
    event_type: "discord_notification",
    entity_type: "notification",
    entity_id: null,
    metadata: { channel, message: message.slice(0, 200), sent, error },
    severity: sent ? "info" : "warning",
  }).then(() => null).catch(() => null);

  return jsonResponse({ success: true, sent, error });
}

// ─── Log Webhook ────────────────────────────────────────────────────────────
async function logWebhook(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  return jsonResponse(await logWebhookInternal(supabase, params as Parameters<typeof logWebhookInternal>[1]));
}

async function logWebhookInternal(supabase: ReturnType<typeof createClient>, params: {
  company_id?: string; provider: string; event_type?: string;
  processing_status: string; is_simulated?: boolean;
  raw_payload?: unknown; error_detail?: string | null;
}) {
  const { data } = await supabase.from("webhook_logs").insert({
    company_id: params.company_id ?? null,
    provider: params.provider,
    event_type: params.event_type ?? null,
    processing_status: params.processing_status,
    is_simulated: params.is_simulated ?? false,
    raw_payload: params.raw_payload ?? null,
    error_detail: params.error_detail ?? null,
    response_status: params.processing_status === "success" ? 200 : 500,
  }).select("id").single();
  return { log_id: data?.id };
}

// ─── Get Integration Status ────────────────────────────────────────────────
async function getIntegrations(supabase: ReturnType<typeof createClient>, params: Record<string, unknown>) {
  const { company_id } = params as { company_id: string };

  const { data: integrations } = await supabase
    .from("integration_settings").select("*")
    .eq("company_id", company_id).order("provider");

  const { data: recentLogs } = await supabase
    .from("webhook_logs")
    .select("provider, processing_status, created_at, error_detail")
    .eq("company_id", company_id)
    .order("created_at", { ascending: false })
    .limit(50);

  const logsByProvider: Record<string, { last_success: string | null; last_failure: string | null; last_error: string | null }> = {};
  for (const log of (recentLogs ?? [])) {
    if (!logsByProvider[log.provider]) {
      logsByProvider[log.provider] = { last_success: null, last_failure: null, last_error: null };
    }
    const p = logsByProvider[log.provider];
    if (log.processing_status === "success" && !p.last_success) p.last_success = log.created_at;
    if (log.processing_status === "failed" && !p.last_failure) {
      p.last_failure = log.created_at;
      p.last_error = log.error_detail;
    }
  }

  const result = (integrations ?? []).map((i) => ({
    ...i,
    config: undefined,
    _webhook_stats: logsByProvider[i.provider] ?? { last_success: null, last_failure: null, last_error: null },
  }));

  return jsonResponse({ integrations: result });
}
