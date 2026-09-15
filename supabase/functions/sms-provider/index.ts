import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import twilio from "npm:twilio@4.23.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "WRONG"];
const RESUBSCRIBE_KEYWORDS = ["START", "UNSTOP", "YES"];

interface CompanyCompliance {
  sms_company_name: string;
  website_url: string;
  sms_help_phone: string | null;
  sms_help_email: string | null;
}

function getHelpResponse(c: CompanyCompliance): string {
  const contact = c.sms_help_phone ? `call ${c.sms_help_phone}` : (c.website_url ? `visit ${c.website_url.replace(/^https?:\/\//, '')}` : 'contact us');
  return `${c.sms_company_name}: For help, ${contact}. Reply STOP to opt out. Msg&data rates may apply. Msg frequency varies.`;
}

function getOptOutResponse(c: CompanyCompliance): string {
  return `${c.sms_company_name}: You have been unsubscribed and will not receive any further messages. Reply START to resubscribe.`;
}

function getResubscribeResponse(c: CompanyCompliance): string {
  return `${c.sms_company_name}: You have been resubscribed to messages. Reply HELP for help, STOP to opt out.`;
}

const OPT_OUT_FOOTERS = [
  (name: string) => `\n\n${name}\nReply STOP to opt out`,
  (name: string) => `\n\n${name}\nReply QUIT to stop receiving messages`,
  (name: string) => `\n\n${name}\nReply WRONG if we have the wrong person`,
  (name: string) => `\n\n${name}\nReply UNSUBSCRIBE to halt messages`,
];

function getComplianceFooter(c: CompanyCompliance, contactId?: string): string {
  const seed = (contactId ?? "").split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const index = seed % OPT_OUT_FOOTERS.length;
  return OPT_OUT_FOOTERS[index](c.sms_company_name);
}

interface TwilioResult {
  success: boolean;
  sid?: string;
  error?: string;
}

async function sendViaTwilio(to: string, from: string, body: string, accountSid: string, authToken: string): Promise<TwilioResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const statusCallbackUrl = Deno.env.get("TWILIO_SMS_STATUS_CALLBACK_URL")
    || (Deno.env.get("SUPABASE_URL") ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-provider` : null);
  if (statusCallbackUrl) params.set("StatusCallback", statusCallbackUrl);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) return { success: false, error: data.message ?? `Twilio error ${resp.status}` };
  return { success: true, sid: data.sid };
}

async function getTwilioCredentials(supabase: any, companyId: string): Promise<{ accountSid: string; authToken: string } | null> {
  const { data: credentialRows } = await supabase
    .from("company_credentials")
    .select("credential_key, credential_value")
    .eq("company_id", companyId)
    .eq("provider", "twilio");
  const credentialMap: Record<string, string> = {};
  for (const row of credentialRows ?? []) credentialMap[row.credential_key] = row.credential_value;
  if (credentialMap.account_sid && credentialMap.auth_token) {
    return { accountSid: credentialMap.account_sid, authToken: credentialMap.auth_token };
  }

  // Legacy storage remains readable while existing accounts are migrated.
  const { data } = await supabase
    .from("integration_settings")
    .select("credentials, status")
    .eq("company_id", companyId)
    .eq("provider", "twilio")
    .maybeSingle();

  if (data?.credentials?.account_sid && data?.credentials?.auth_token) {
    return { accountSid: data.credentials.account_sid, authToken: data.credentials.auth_token };
  }

  // Fallback to env vars
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (sid && token) return { accountSid: sid, authToken: token };

  return null;
}

async function getCompanyCompliance(supabase: any, companyId: string): Promise<CompanyCompliance> {
  const { data } = await supabase
    .from("companies")
    .select("sms_company_name, website_url, sms_help_phone, sms_help_email, legal_name, name")
    .eq("id", companyId)
    .maybeSingle();

  return {
    sms_company_name: data?.sms_company_name || data?.legal_name || data?.name || "This company",
    website_url: data?.website_url || "",
    sms_help_phone: data?.sms_help_phone || null,
    sms_help_email: data?.sms_help_email || null,
  };
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
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

function twimlResponse(message?: string) {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
}

function isServiceRequest(req: Request, serviceKey: string): boolean {
  return bearerToken(req) === serviceKey || req.headers.get("apikey") === serviceKey;
}

async function authorizeUserSend(
  createClient: any,
  supabaseUrl: string,
  anonKey: string,
  req: Request,
  requestedCompanyId: string,
): Promise<{ userId: string } | { error: Response }> {
  const token = bearerToken(req);
  if (!token) return { error: jsonResponse({ error: "Authentication is required" }, 401) };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return { error: jsonResponse({ error: "Invalid or expired session" }, 401) };

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id, company_id, is_disabled, is_agency_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.is_disabled || profile.company_id !== requestedCompanyId) {
    return { error: jsonResponse({ error: "You cannot send for this company" }, 403) };
  }

  if (!profile.is_agency_admin) {
    const { data: permissions, error: permissionError } = await userClient.rpc("get_user_permissions");
    const allowed = new Set(["send_individual_sms", "send_buyer_sms_campaigns", "edit_lead_campaigns"]);
    if (permissionError || !(permissions ?? []).some((permission: string) => allowed.has(permission))) {
      return { error: jsonResponse({ error: "You do not have permission to send SMS" }, 403) };
    }
  }

  return { userId: userData.user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, serviceKey);

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      const twilioBody: Record<string, string> = {};
      formData.forEach((value, key) => { twilioBody[key] = value as string; });
      return await handleTwilioWebhook(supabase, twilioBody, req);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action ?? "send";
      const serviceRequest = isServiceRequest(req, serviceKey);
      if (action === "send") {
        if (!serviceRequest) {
          const authorization = await authorizeUserSend(createClient, supabaseUrl, anonKey, req, body.company_id);
          if ("error" in authorization) return authorization.error;
          body.created_by = authorization.userId;
          body.is_automated = false;
          body.skip_compliance_footer = false;
        }
        return await sendSms(supabase, body);
      }
      if (action === "receive") {
        if (!serviceRequest) return jsonResponse({ error: "Service authentication is required" }, 401);
        return await receiveSms(supabase, body);
      }
      if (action === "process_jobs") {
        if (!serviceRequest) return jsonResponse({ error: "Service authentication is required" }, 401);
        return await processJobs(supabase);
      }
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// ─── Outbound SMS ────────────────────────────────────────────────────────────
async function sendSms(supabase: any, params: {
  messaging_job_id?: string;
  to_number: string;
  from_number: string;
  body: string;
  contact_id?: string;
  lead_record_id?: string;
  conversation_id?: string;
  campaign_id?: string;
  company_id: string;
  created_by?: string;
  is_automated?: boolean;
  skip_compliance_footer?: boolean;
}) {
  if (params.contact_id) {
    const blocked = await isContactBlocked(supabase, params.company_id, params.contact_id);
    if (blocked) return jsonResponse({ success: false, error: "Contact is opted out or suppressed", blocked: true });
  }

  const creds = await getTwilioCredentials(supabase, params.company_id);
  if (!creds) return jsonResponse({ success: false, error: "Twilio not configured for this account" }, 500);

  const compliance = await getCompanyCompliance(supabase, params.company_id);

  const normalizedFrom = normalizePhone(params.from_number);
  const { data: verifiedSender } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("company_id", params.company_id)
    .eq("number_normalized", normalizedFrom)
    .eq("provider", "twilio")
    .eq("registration_status", "registered")
    .eq("is_active", true)
    .not("provider_reference", "is", null)
    .maybeSingle();
  if (!verifiedSender) {
    return jsonResponse({ success: false, error: "The sender is not a verified Twilio number for this company" }, 400);
  }

  let messageBody = params.body;
  if (params.is_automated && !params.skip_compliance_footer) {
    messageBody = appendComplianceFooter(messageBody, compliance, params.contact_id);
  }

  const twilioResult = await sendViaTwilio(
    formatPhone(params.to_number), formatPhone(params.from_number), messageBody,
    creds.accountSid, creds.authToken,
  );

  const { data: message, error } = await supabase.from("messages").insert({
    company_id: params.company_id,
    conversation_id: params.conversation_id ?? null,
    contact_id: params.contact_id ?? null,
    lead_record_id: params.lead_record_id ?? null,
    campaign_id: params.campaign_id ?? null,
    direction: "outbound",
    body: messageBody,
    content_type: "sms",
    status: twilioResult.success ? "sent" : "failed",
    is_simulated: false,
    is_automated: params.is_automated ?? true,
    sender_number: params.from_number,
    to_number: params.to_number,
    from_number: params.from_number,
    message_sid: twilioResult.sid ?? null,
    error_message: twilioResult.error ?? null,
    sent_at: twilioResult.success ? new Date().toISOString() : null,
    created_by: params.created_by ?? null,
  }).select().single();

  if (error) return jsonResponse({ error: error.message }, 500);

  if (params.lead_record_id) {
    const lead = await getLead(supabase, params.lead_record_id);
    await supabase.from("lead_records").update({
      last_outbound_message_at: new Date().toISOString(),
      total_message_attempts: (lead?.total_message_attempts ?? 0) + 1,
      initial_sms_sent: true,
    }).eq("id", params.lead_record_id);
  }

  if (params.messaging_job_id) {
    await supabase.from("messaging_jobs").update({
      status: twilioResult.success ? "sent" : "failed",
      processed_at: new Date().toISOString(),
      message_id: message?.id ?? null,
      error_message: twilioResult.error ?? null,
    }).eq("id", params.messaging_job_id);
  }

  return jsonResponse({
    success: twilioResult.success,
    message_id: message?.id,
    message_sid: twilioResult.sid ?? null,
    status: twilioResult.success ? "sent" : "failed",
    error: twilioResult.error ?? null,
  });
}

// ─── Twilio Inbound Webhook ─────────────────────────────────────────────────
async function handleTwilioWebhook(supabase: any, params: Record<string, string>, req: Request) {
  const fromNumber = params.From ?? "";
  const toNumber = params.To ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? "";
  const messageStatus = params.MessageStatus ?? "";
  const upperBody = body.trim().toUpperCase();
  const companyNumber = messageStatus ? fromNumber : toNumber;
  const normalizedCompanyNumber = normalizePhone(companyNumber);
  const normalizedFrom = normalizePhone(fromNumber);

  const { data: phoneRecord } = await supabase
    .from("phone_numbers").select("company_id")
    .eq("number_normalized", normalizedCompanyNumber)
    .eq("provider", "twilio")
    .eq("registration_status", "registered")
    .eq("is_active", true)
    .not("provider_reference", "is", null)
    .maybeSingle();

  const companyId: string | null = phoneRecord?.company_id ?? null;
  if (!companyId) return jsonResponse({ error: "Unknown receiving number" }, 403);

  const credentials = await getTwilioCredentials(supabase, companyId);
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const webhookUrl = messageStatus
    ? (Deno.env.get("TWILIO_SMS_STATUS_CALLBACK_URL") || req.url)
    : (Deno.env.get("TWILIO_SMS_WEBHOOK_URL") || req.url);
  if (!credentials || !signature || !twilio.validateRequest(credentials.authToken, signature, webhookUrl, params)) {
    await logSystemEvent(supabase, companyId, "twilio_signature_rejected", "company", companyId, { receiving_number: normalizedCompanyNumber });
    return jsonResponse({ error: "Invalid Twilio signature" }, 403);
  }

  if (messageStatus && messageSid) {
    const mappedStatus = ["delivered"].includes(messageStatus)
      ? "delivered"
      : ["sent", "sending"].includes(messageStatus)
        ? "sent"
        : ["failed", "undelivered", "canceled"].includes(messageStatus)
          ? "failed"
          : "queued";
    const messageUpdate: Record<string, unknown> = {
      status: mappedStatus,
      error_code: params.ErrorCode || null,
      error_message: params.ErrorMessage || null,
    };
    const recipientUpdate: Record<string, unknown> = {
      status: mappedStatus,
      failure_reason: params.ErrorMessage || (params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null),
      updated_at: new Date().toISOString(),
    };
    if (mappedStatus === "delivered") {
      messageUpdate.delivered_at = new Date().toISOString();
      recipientUpdate.delivered_at = new Date().toISOString();
    }
    let messageUpdateQuery = supabase.from("messages").update(messageUpdate)
      .eq("company_id", companyId).eq("message_sid", messageSid);
    let recipientUpdateQuery = supabase.from("buyer_campaign_recipients").update(recipientUpdate)
      .eq("company_id", companyId).eq("provider_message_id", messageSid);
    if (mappedStatus !== "delivered") {
      messageUpdateQuery = messageUpdateQuery.neq("status", "delivered");
      recipientUpdateQuery = recipientUpdateQuery.neq("status", "delivered");
    }
    const [{ error: messageStatusError }, { error: recipientStatusError }] = await Promise.all([
      messageUpdateQuery,
      recipientUpdateQuery,
    ]);
    if (messageStatusError || recipientStatusError) {
      await logSystemEvent(supabase, companyId, "twilio_status_update_failed", "message", messageSid, {
        message_status: messageStatus,
        message_error: messageStatusError?.message ?? null,
        recipient_error: recipientStatusError?.message ?? null,
      });
    }
    return twimlResponse();
  }

  const compliance = await getCompanyCompliance(supabase, companyId);

  const { data: contact } = await supabase
    .from("contacts").select("id, first_name, do_not_text")
    .eq("company_id", companyId).eq("primary_phone_normalized", normalizedFrom).maybeSingle();

  if (OPT_OUT_KEYWORDS.includes(upperBody)) {
    if (contact) await handleOptOut(supabase, companyId, contact.id, fromNumber);
    return twimlResponse(getOptOutResponse(compliance));
  }

  if (upperBody === "HELP") {
    return twimlResponse(getHelpResponse(compliance));
  }

  if (RESUBSCRIBE_KEYWORDS.includes(upperBody)) {
    if (contact) await handleResubscribe(supabase, companyId, contact.id);
    return twimlResponse(getResubscribeResponse(compliance));
  }

  if (!contact) return twimlResponse();

  return await receiveSms(supabase, {
    from_number: fromNumber, to_number: toNumber, body,
    company_id: companyId, message_sid: messageSid,
  });
}

// ─── Inbound SMS Processing ────────────────────────────────────────────────
async function receiveSms(supabase: any, params: {
  from_number: string; to_number: string; body: string;
  company_id: string; message_sid?: string;
}) {
  const normalizedFrom = normalizePhone(params.from_number);
  const compliance = await getCompanyCompliance(supabase, params.company_id);

  const { data: contact } = await supabase
    .from("contacts").select("id, first_name, assigned_user_id")
    .eq("company_id", params.company_id).eq("primary_phone_normalized", normalizedFrom).maybeSingle();

  if (!contact) return jsonResponse({ error: "No matching contact found" }, 404);

  if (params.message_sid) {
    const { data: existingMessage } = await supabase.from("messages")
      .select("id")
      .eq("company_id", params.company_id)
      .eq("message_sid", params.message_sid)
      .maybeSingle();
    if (existingMessage) return twimlResponse();
  }

  const { data: leadRecord } = await supabase
    .from("lead_records").select("id, campaign_id, response_status, assigned_user_id")
    .eq("company_id", params.company_id).eq("contact_id", contact.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  let conversationId: string | null = null;
  const { data: existingConv } = await supabase
    .from("conversations").select("id, opportunity_id").eq("contact_id", contact.id).eq("channel", "sms")
    .order("created_at", { ascending: false }).maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: newConv } = await supabase.from("conversations").insert({
      company_id: params.company_id, contact_id: contact.id, channel: "sms", status: "open",
    }).select().single();
    conversationId = newConv?.id ?? null;
  }

  const { data: message } = await supabase.from("messages").insert({
    company_id: params.company_id, conversation_id: conversationId, contact_id: contact.id,
    lead_record_id: leadRecord?.id ?? null, campaign_id: leadRecord?.campaign_id ?? null,
    direction: "inbound", body: params.body,
    content_type: "sms", status: "received", is_simulated: false, is_automated: false,
    from_number: params.from_number, to_number: params.to_number,
    message_sid: params.message_sid ?? null, sent_at: new Date().toISOString(),
  }).select().single();

  if (conversationId) {
    await supabase.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: params.body.slice(0, 80),
      updated_at: new Date().toISOString(),
    }).eq("id", conversationId);
    await supabase.rpc("increment_conversation_unread", { conv_id: conversationId }).catch(() => {
      return supabase.from("conversations").update({ unread_count: 1 }).eq("id", conversationId);
    });
  }

  const upperBody = params.body.trim().toUpperCase();
  if (OPT_OUT_KEYWORDS.includes(upperBody)) {
    await handleOptOut(supabase, params.company_id, contact.id, params.from_number);
    if (params.message_sid) return twimlResponse(getOptOutResponse(compliance));
  } else if (upperBody === "HELP") {
    if (params.message_sid) return twimlResponse(getHelpResponse(compliance));
  } else if (leadRecord) {
    await handleResponse(supabase, params.company_id, leadRecord.id, contact.id, params.body, conversationId!, message?.id);
  }

  if (!OPT_OUT_KEYWORDS.includes(upperBody) && upperBody !== "HELP" && conversationId && message?.id) {
    try {
      await createResponseFollowUps(supabase, {
        companyId: params.company_id,
        contactId: contact.id,
        conversationId,
        messageId: message.id,
        assignedUserId: leadRecord?.assigned_user_id ?? contact.assigned_user_id ?? null,
        opportunityId: existingConv?.opportunity_id ?? null,
        responseBody: params.body,
      });
    } catch (error) {
      await logSystemEvent(supabase, params.company_id, "callback_follow_up_failed", "conversation", conversationId, {
        message_id: message.id,
        contact_id: contact.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (params.message_sid) return twimlResponse();
  return jsonResponse({ success: true, message_id: message?.id });
}

// ─── Opt-Out Handler ────────────────────────────────────────────────────────
async function handleOptOut(supabase: any, companyId: string, contactId: string, fromNumber: string) {
  await supabase.from("contacts").update({
    do_not_text: true, opt_out_date: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", contactId);

  await supabase.from("suppression_entries").insert({
    company_id: companyId, contact_id: contactId, reason: "opted_out",
    source: "sms_opt_out_keyword", notes: `Opt-out received from ${fromNumber}`, is_active: true,
  }).then(() => null).catch(() => null);

  await supabase.from("lead_records").update({
    response_status: "opted_out", response_date: new Date().toISOString(),
    is_suppressed: true, suppression_reason: "opted_out", outreach_eligibility: "opted_out",
  }).eq("company_id", companyId).eq("contact_id", contactId);

  const { data: contactLeads } = await supabase.from("lead_records")
    .select("id")
    .eq("company_id", companyId)
    .eq("contact_id", contactId);
  const contactLeadIds = (contactLeads ?? []).map((lead: { id: string }) => lead.id);
  const { data: members } = contactLeadIds.length > 0
    ? await supabase.from("lead_campaign_members")
      .select("id, campaign_id, lead_record_id")
      .eq("company_id", companyId)
      .in("lead_record_id", contactLeadIds)
      .in("status", ["enrolled", "active"])
    : { data: [] };

  for (const m of members ?? []) {
    await supabase.from("lead_campaign_members").update({
      status: "opted_out", stopped_reason: "opted_out", stopped_at: new Date().toISOString(),
    }).eq("id", m.id);
    if (m.lead_record_id) {
      await supabase.from("messaging_jobs").update({ status: "canceled" })
        .eq("lead_record_id", m.lead_record_id).eq("campaign_id", m.campaign_id)
        .in("status", ["scheduled", "processing"]);
    }
  }

  const normalizedFrom = normalizePhone(fromNumber);
  await supabase.from("buyer_campaign_recipients").update({
    status: "suppressed", suppression_reason: "Contact opted out via STOP", updated_at: new Date().toISOString(),
  }).eq("phone_normalized", normalizedFrom).eq("status", "queued");

  await supabase.from("conversations").update({
    is_opted_out: true, updated_at: new Date().toISOString(),
  }).eq("contact_id", contactId).eq("channel", "sms");

  await logSystemEvent(supabase, companyId, "contact_opted_out", "contact", contactId, { from_number: fromNumber });
}

// ─── Resubscribe Handler ───────────────────────────────────────────────────
async function handleResubscribe(supabase: any, companyId: string, contactId: string) {
  await supabase.from("contacts").update({
    do_not_text: false, opt_out_date: null, updated_at: new Date().toISOString(),
  }).eq("id", contactId);

  await supabase.from("suppression_entries").update({
    is_active: false, notes: "Resubscribed via START keyword", updated_at: new Date().toISOString(),
  }).eq("company_id", companyId).eq("contact_id", contactId).eq("is_active", true);

  await supabase.from("conversations").update({
    is_opted_out: false, updated_at: new Date().toISOString(),
  }).eq("contact_id", contactId).eq("channel", "sms");

  await logSystemEvent(supabase, companyId, "contact_resubscribed", "contact", contactId, {});
}

// ─── Response Handler ───────────────────────────────────────────────────────
async function handleResponse(supabase: any, companyId: string, leadRecordId: string, contactId: string, body: string, conversationId: string, messageId: string) {
  await supabase.from("lead_records").update({
    response_status: "responded", response_date: new Date().toISOString(),
    last_inbound_message_at: new Date().toISOString(),
  }).eq("id", leadRecordId);

  const { data: members } = await supabase.from("lead_campaign_members")
    .select("id, campaign_id").eq("lead_record_id", leadRecordId).in("status", ["enrolled", "active"]);

  for (const m of members ?? []) {
    const { data: steps } = await supabase.from("lead_sequence_steps")
      .select("stop_on_response").eq("campaign_id", m.campaign_id).eq("is_active", true);
    if ((steps ?? []).some((s: any) => s.stop_on_response)) {
      await supabase.from("lead_campaign_members").update({
        status: "stopped", stopped_reason: "response_received", stopped_at: new Date().toISOString(),
      }).eq("id", m.id);
      await supabase.from("messaging_jobs").update({ status: "canceled" })
        .eq("lead_record_id", leadRecordId).eq("campaign_id", m.campaign_id)
        .in("status", ["scheduled", "processing"]);
    }
  }

  const { data: lead } = await supabase.from("lead_records")
    .select("property_id, assigned_user_id, priority, campaign_id, import_batch_id")
    .eq("id", leadRecordId).maybeSingle();

  if (lead) {
    const idempotencyKey = `${leadRecordId}-seller_responded`;
    const { data: existing } = await supabase.from("acquisition_handoffs")
      .select("id").eq("lead_record_id", leadRecordId).eq("idempotency_key", idempotencyKey).maybeSingle();

    if (!existing) {
      await supabase.from("acquisition_handoffs").insert({
        company_id: companyId, lead_record_id: leadRecordId, contact_id: contactId,
        property_id: lead.property_id, trigger_type: "seller_responded",
        handoff_reason: "Seller responded to outreach", requested_acquisition_stage: "new",
        requested_priority: lead.priority, requested_assignee_id: lead.assigned_user_id,
        source_campaign_id: lead.campaign_id, source_import_batch_id: lead.import_batch_id,
        seller_response_message: body, status: "pending", idempotency_key: idempotencyKey,
      });
      await supabase.from("lead_records").update({
        handoff_status: "pending", handoff_reason: "Seller responded to outreach",
      }).eq("id", leadRecordId);
    }

  }

  await logSystemEvent(supabase, companyId, "lead_response_received", "lead_record", leadRecordId, { message: body });
}

async function createResponseFollowUps(supabase: any, params: {
  companyId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  assignedUserId: string | null;
  opportunityId: string | null;
  responseBody: string;
}) {
  const recipientIds = new Set<string>();
  if (params.assignedUserId) recipientIds.add(params.assignedUserId);

  const { data: managerPermission } = await supabase.from("permissions").select("id").eq("key", "view_all_acquisition_leads").maybeSingle();
  if (managerPermission) {
    const { data: rolePermissions } = await supabase.from("role_permissions").select("role_id").eq("permission_id", managerPermission.id);
    const roleIds = (rolePermissions ?? []).map((row: { role_id: string }) => row.role_id);
    if (roleIds.length > 0) {
      const { data: companyRoles } = await supabase.from("roles").select("id").eq("company_id", params.companyId).in("id", roleIds);
      const companyRoleIds = (companyRoles ?? []).map((row: { id: string }) => row.id);
      if (companyRoleIds.length > 0) {
        const { data: memberships } = await supabase.from("user_roles").select("user_id").in("role_id", companyRoleIds);
        (memberships ?? []).forEach((row: { user_id: string }) => recipientIds.add(row.user_id));
      }
    }
  }

  const { data: agencyAdmins } = await supabase.from("profiles")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("is_agency_admin", true)
    .eq("is_disabled", false);
  (agencyAdmins ?? []).forEach((row: { id: string }) => recipientIds.add(row.id));

  const responsePreview = params.responseBody.trim().slice(0, 140);
  for (const userId of recipientIds) {
    const { data: existingTask } = await supabase.from("tasks")
      .select("id")
      .eq("company_id", params.companyId)
      .eq("assigned_user_id", userId)
      .eq("related_contact_id", params.contactId)
      .eq("automation_source", "inbound_response")
      .in("status", ["open", "in_progress", "waiting"])
      .limit(1)
      .maybeSingle();
    if (!existingTask) {
      const { error: taskError } = await supabase.from("tasks").insert({
        company_id: params.companyId,
        title: "Respond to inbound message",
        description: responsePreview || "A contact replied and needs review.",
        status: "open",
        priority: "high",
        assigned_user_id: userId,
        related_contact_id: params.contactId,
        related_opportunity_id: params.opportunityId,
        is_automated: true,
        automation_source: "inbound_response",
        due_date: new Date().toISOString().slice(0, 10),
      });
      if (taskError) throw taskError;
    }

    const { data: existingNotification } = await supabase.from("notifications")
      .select("id")
      .eq("company_id", params.companyId)
      .eq("user_id", userId)
      .eq("type", "callback_requested")
      .eq("entity_type", "conversation")
      .eq("entity_id", params.conversationId)
      .eq("is_read", false)
      .limit(1)
      .maybeSingle();
    if (!existingNotification) {
      const { error: notificationError } = await supabase.from("notifications").insert({
        company_id: params.companyId,
        user_id: userId,
        type: "callback_requested",
        title: "Contact replied — follow up",
        body: responsePreview || "A contact replied and needs review.",
        entity_type: "conversation",
        entity_id: params.conversationId,
      });
      if (notificationError) throw notificationError;
    }
  }

  await logSystemEvent(supabase, params.companyId, "callback_follow_up_created", "conversation", params.conversationId, {
    message_id: params.messageId,
    contact_id: params.contactId,
    recipient_count: recipientIds.size,
  });
}

// ─── Process Scheduled Jobs ────────────────────────────────────────────────
async function processJobs(supabase: any) {
  const now = new Date().toISOString();
  const { data: jobs } = await supabase.from("messaging_jobs")
    .select("*").eq("status", "scheduled").lte("scheduled_at", now).limit(50);

  let processed = 0, failed = 0;
  const credsByCompany: Record<string, { accountSid: string; authToken: string } | null> = {};
  const complianceByCompany: Record<string, CompanyCompliance> = {};

  for (const job of jobs ?? []) {
    await supabase.from("messaging_jobs").update({ status: "processing" }).eq("id", job.id);

    // Cache credentials per company
    if (!(job.company_id in credsByCompany)) {
      credsByCompany[job.company_id] = await getTwilioCredentials(supabase, job.company_id);
      complianceByCompany[job.company_id] = await getCompanyCompliance(supabase, job.company_id);
    }
    const creds = credsByCompany[job.company_id];
    if (!creds) {
      await supabase.from("messaging_jobs").update({ status: "failed", error_message: "Twilio not configured" }).eq("id", job.id);
      failed++;
      continue;
    }
    const compliance = complianceByCompany[job.company_id];

    const { data: lead } = await supabase.from("lead_records")
      .select("contact_id, is_suppressed, outreach_eligibility, response_status")
      .eq("id", job.lead_record_id).maybeSingle();

    if (!lead || lead.is_suppressed || lead.outreach_eligibility === "opted_out" || lead.response_status === "opted_out") {
      await supabase.from("messaging_jobs").update({ status: "canceled", error_message: "Lead suppressed or opted out" }).eq("id", job.id);
      continue;
    }

    if (lead.contact_id) {
      const blocked = await isContactBlocked(supabase, job.company_id, lead.contact_id);
      if (blocked) {
        await supabase.from("messaging_jobs").update({ status: "canceled", error_message: "Contact opted out" }).eq("id", job.id);
        continue;
      }
    }

    const { data: contact } = await supabase.from("contacts")
      .select("primary_phone, primary_phone_normalized, first_name")
      .eq("id", lead.contact_id).maybeSingle();

    if (!contact?.primary_phone) {
      await supabase.from("messaging_jobs").update({ status: "failed", error_message: "No valid phone number" }).eq("id", job.id);
      failed++;
      continue;
    }

    const { data: step } = await supabase.from("lead_sequence_steps")
      .select("message_body, template_id").eq("id", job.sequence_step_id).maybeSingle();

    let messageBody = step?.message_body ?? "";
    if (step?.template_id) {
      const { data: tpl } = await supabase.from("message_templates")
        .select("body").eq("id", step.template_id).maybeSingle();
      if (tpl) messageBody = tpl.body;
    }
    messageBody = messageBody.replace(/\{first_name\}/g, contact.first_name ?? "there");
    messageBody = appendComplianceFooter(messageBody, compliance, lead.contact_id);

    const { data: sharedNumber } = await supabase.from("phone_numbers")
      .select("number")
      .eq("company_id", job.company_id)
      .eq("provider", "twilio")
      .eq("registration_status", "registered")
      .eq("is_active", true)
      .not("provider_reference", "is", null)
      .order("created_at").limit(1).maybeSingle();

    if (!sharedNumber?.number) {
      await supabase.from("messaging_jobs").update({ status: "failed", error_message: "No active sender phone number" }).eq("id", job.id);
      failed++;
      continue;
    }

    const twilioResult = await sendViaTwilio(
      formatPhone(contact.primary_phone), formatPhone(sharedNumber.number), messageBody,
      creds.accountSid, creds.authToken,
    );

    const { data: message } = await supabase.from("messages").insert({
      company_id: job.company_id, conversation_id: job.conversation_id, contact_id: lead.contact_id,
      lead_record_id: job.lead_record_id, campaign_id: job.campaign_id,
      direction: "outbound", body: messageBody, content_type: "sms",
      status: twilioResult.success ? "sent" : "failed", is_simulated: false, is_automated: true,
      sender_number: sharedNumber.number, to_number: contact.primary_phone,
      from_number: sharedNumber.number, message_sid: twilioResult.sid ?? null,
      error_message: twilioResult.error ?? null,
      sent_at: twilioResult.success ? new Date().toISOString() : null,
    }).select().single();

    await supabase.from("messaging_jobs").update({
      status: twilioResult.success ? "sent" : "failed",
      processed_at: new Date().toISOString(),
      message_id: message?.id ?? null,
      error_message: twilioResult.error ?? null,
    }).eq("id", job.id);

    const currentLead = await getLead(supabase, job.lead_record_id);
    await supabase.from("lead_records").update({
      last_outbound_message_at: new Date().toISOString(),
      total_message_attempts: (currentLead?.total_message_attempts ?? 0) + 1,
      initial_sms_sent: true,
    }).eq("id", job.lead_record_id);

    if (twilioResult.success) processed++;
    else failed++;
  }

  return jsonResponse({ processed, failed, total: (jobs ?? []).length });
}

// ─── Compliance Helpers ────────────────────────────────────────────────────
function appendComplianceFooter(body: string, compliance: CompanyCompliance, contactId?: string): string {
  const keywords = ["STOP", "QUIT", "WRONG", "UNSUBSCRIBE"];
  if (keywords.some(k => body.includes(k)) && body.includes(compliance.sms_company_name)) return body;
  return body + getComplianceFooter(compliance, contactId);
}

async function isContactBlocked(supabase: any, companyId: string, contactId: string): Promise<boolean> {
  const { data: contact } = await supabase.from("contacts").select("do_not_text").eq("id", contactId).maybeSingle();
  if (contact?.do_not_text) return true;
  const { data: suppression } = await supabase.from("suppression_entries").select("id")
    .eq("company_id", companyId).eq("contact_id", contactId).eq("is_active", true).limit(1).maybeSingle();
  return !!suppression;
}

async function getLead(supabase: any, leadId: string) {
  const { data } = await supabase.from("lead_records").select("total_message_attempts").eq("id", leadId).maybeSingle();
  return data;
}

async function logSystemEvent(supabase: any, companyId: string, eventType: string, entityType: string, entityId: string, metadata: unknown) {
  await supabase.from("system_events").insert({
    company_id: companyId, event_type: eventType, entity_type: entityType, entity_id: entityId,
    metadata, severity: "info",
  }).then(() => null).catch(() => null);
}
