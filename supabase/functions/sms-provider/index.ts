import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, serviceKey);

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      const twilioBody: Record<string, string> = {};
      formData.forEach((value, key) => { twilioBody[key] = value as string; });
      return await handleTwilioWebhook(supabase, twilioBody);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action ?? "send";
      if (action === "send") return await sendSms(supabase, body);
      if (action === "receive") return await receiveSms(supabase, body);
      if (action === "process_jobs") return await processJobs(supabase);
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
async function handleTwilioWebhook(supabase: any, params: Record<string, string>) {
  const fromNumber = params.From ?? "";
  const toNumber = params.To ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? "";
  const upperBody = body.trim().toUpperCase();
  const normalizedTo = normalizePhone(toNumber);
  const normalizedFrom = normalizePhone(fromNumber);

  const { data: phoneRecord } = await supabase
    .from("phone_numbers").select("company_id")
    .eq("number_normalized", normalizedTo).eq("is_active", true).maybeSingle();

  let companyId: string | null = phoneRecord?.company_id ?? null;
  if (!companyId) {
    const { data: fallback } = await supabase
      .from("phone_numbers").select("company_id").eq("is_active", true).limit(1).maybeSingle();
    companyId = fallback?.company_id ?? null;
  }
  if (!companyId) return twimlResponse();

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
    .from("contacts").select("id, first_name")
    .eq("company_id", params.company_id).eq("primary_phone_normalized", normalizedFrom).maybeSingle();

  if (!contact) return jsonResponse({ error: "No matching contact found" }, 404);

  const { data: leadRecord } = await supabase
    .from("lead_records").select("id, campaign_id, response_status")
    .eq("company_id", params.company_id).eq("contact_id", contact.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  let conversationId: string | null = null;
  const { data: existingConv } = await supabase
    .from("conversations").select("id").eq("contact_id", contact.id).eq("channel", "sms")
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
    lead_record_id: leadRecord?.id ?? null, direction: "inbound", body: params.body,
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

  const { data: members } = await supabase.from("lead_campaign_members")
    .select("id, campaign_id, lead_record_id")
    .eq("company_id", companyId).or(`contact_id.eq.${contactId}`)
    .in("status", ["enrolled", "active"]);

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
      .select("number").eq("company_id", job.company_id).eq("is_active", true)
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
