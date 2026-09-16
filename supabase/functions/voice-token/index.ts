
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import twilio from "npm:twilio@4.23.0";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getTwilioCredentialMap(
  supabase: any,
  companyId: string,
) {
  const { data, error } = await supabase
    .from("company_credentials")
    .select("credential_key, credential_value")
    .eq("company_id", companyId)
    .eq("provider", "twilio");

  if (error) {
    console.error("Unable to load Twilio credentials", error);
    return {};
  }

  const credentials: Record<string, string> = {};

  for (const row of data ?? []) {
    credentials[String(row.credential_key).trim()] =
      String(row.credential_value ?? "").trim();
  }

  return credentials;
}

async function authorizeUserRequest(
  req: Request,
  supabase: any,
  companyId: string,
  requestedUserId: string | undefined,
  permission: string | string[],
) {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles")
    .select("id, company_id, is_disabled, is_agency_admin")
    .eq("id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!profile || profile.is_disabled) return null;
  if (profile.is_agency_admin) return user;

  const { data: memberships } = await supabase.from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);
  const roleIds = (memberships ?? []).map((membership: { role_id: string }) => membership.role_id);
  if (!roleIds.length) return null;
  const { data: companyRoles } = await supabase.from("roles")
    .select("id")
    .eq("company_id", companyId)
    .in("id", roleIds);
  const companyRoleIds = (companyRoles ?? []).map((role: { id: string }) => role.id);
  if (!companyRoleIds.length) return null;
  const permissionKeys = Array.isArray(permission) ? permission : [permission];
  const { data: permissionRows } = await supabase
    .from("permissions")
    .select("id")
    .in("key", permissionKeys);
  const permissionIds = (permissionRows ?? []).map((row: { id: string }) => row.id);
  if (!permissionIds.length) return null;
  const { data: rolePermission } = await supabase.from("role_permissions")
    .select("role_id")
    .in("permission_id", permissionIds)
    .in("role_id", companyRoleIds)
    .limit(1)
    .maybeSingle();
  return rolePermission ? user : null;
}

function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

function twimlError(message: string): Response {
  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`,
  );
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function voiceIdentity(userId: string): string {
  return `user_${userId.replace(/-/g, "_")}`;
}

async function getInboundRecipients(supabase: any, companyId: string, phoneNumber: any): Promise<string[]> {
  const [{ data: profiles }, { data: permission }] = await Promise.all([
    supabase.from("profiles").select("id, is_agency_admin").eq("company_id", companyId).eq("is_disabled", false),
    supabase.from("permissions").select("id").eq("key", "view_calls").maybeSingle(),
  ]);

  const profileIds = new Set((profiles ?? []).map((profile: { id: string }) => profile.id));
  const permittedIds = new Set(
    (profiles ?? [])
      .filter((profile: { is_agency_admin?: boolean }) => profile.is_agency_admin)
      .map((profile: { id: string }) => profile.id),
  );

  if (permission?.id) {
    const { data: rolePermissions } = await supabase
      .from("role_permissions")
      .select("role_id")
      .eq("permission_id", permission.id);
    const roleIds = (rolePermissions ?? []).map((row: { role_id: string }) => row.role_id);
    if (roleIds.length) {
      const { data: companyRoles } = await supabase.from("roles").select("id").eq("company_id", companyId).in("id", roleIds);
      const companyRoleIds = (companyRoles ?? []).map((row: { id: string }) => row.id);
      if (companyRoleIds.length) {
        const { data: memberships } = await supabase.from("user_roles").select("user_id").in("role_id", companyRoleIds);
        for (const membership of memberships ?? []) {
          if (profileIds.has(membership.user_id)) permittedIds.add(membership.user_id);
        }
      }
    }
  }

  if (phoneNumber.assigned_user_id && permittedIds.has(phoneNumber.assigned_user_id)) {
    return [phoneNumber.assigned_user_id];
  }

  if (phoneNumber.assigned_team_id) {
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", phoneNumber.assigned_team_id);
    const teamRecipients = (teamMembers ?? [])
      .map((member: { user_id: string }) => member.user_id)
      .filter((userId: string) => permittedIds.has(userId));
    if (teamRecipients.length) return Array.from(new Set(teamRecipients)).slice(0, 10) as string[];
  }

  return Array.from(permittedIds).slice(0, 10) as string[];
}

async function validateTwilioWebhook(
  req: Request,
  params: Record<string, string>,
  credentials: Record<string, string>,
  _configuredUrl?: string,
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature")?.trim();
  const authToken = credentials.auth_token?.trim();
  const accountMatches = Boolean(params.AccountSid && params.AccountSid === credentials.account_sid?.trim());
  if (!signature || !authToken || !accountMatches) {
    console.error("VOICE_WEBHOOK_REJECTED", {
      reason: "missing signature, credentials, or account mismatch",
      has_signature: Boolean(signature),
      has_auth_token: Boolean(authToken),
      account_matches: accountMatches,
    });
    return false;
  }

  // Validate the public endpoint Twilio called, not the proxy's internal URL.
  const incomingUrl = new URL(req.url);
  const publicUrl = new URL("/functions/v1/voice-token", SUPABASE_URL);
  publicUrl.search = incomingUrl.search;
  const valid = twilio.validateRequest(authToken, signature, publicUrl.toString(), params);
  if (!valid) {
    console.error("VOICE_WEBHOOK_REJECTED", {
      reason: "signature mismatch",
      public_url: publicUrl.toString(),
      runtime_path: incomingUrl.pathname,
    });
  }
  return valid;
}

async function handleRecordingCallback(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const callbackParams: Record<string, string> = {};
    formData.forEach((value, key) => { callbackParams[key] = String(value); });
    const callSid = callbackParams.CallSid || "";
    const recordingSid = callbackParams.RecordingSid || "";
    const recordingUrl = callbackParams.RecordingUrl || "";
    const recordingDuration = parseInt(callbackParams.RecordingDuration || "0", 10);

    if (!callSid || !recordingSid) {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const supabase = getSupabase();

    // Update the existing row (created at call start) with recording details
    const { data: existing } = await supabase
      .from("call_recordings")
      .select("id, company_id")
      .eq("call_sid", callSid)
      .maybeSingle();

    if (!existing?.company_id) return new Response("OK", { status: 200, headers: corsHeaders });
    const credentials = await getTwilioCredentialMap(supabase, existing.company_id);
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const callbackUrl = Deno.env.get("TWILIO_RECORDING_CALLBACK_URL") || req.url;
    if (!await validateTwilioWebhook(req, callbackParams, credentials)) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    if (existing) {
      await supabase
        .from("call_recordings")
        .update({
          recording_sid: recordingSid,
          recording_url: recordingUrl,
          duration_seconds: recordingDuration,
        })
        .eq("id", existing.id);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Recording callback error:", err);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
}

async function handleInboundStatusCallback(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const callbackParams: Record<string, string> = {};
    formData.forEach((value, key) => { callbackParams[key] = String(value); });
    const callSid = callbackParams.CallSid || callbackParams.ParentCallSid || "";
    if (!callSid) return new Response("OK", { status: 200, headers: corsHeaders });

    const supabase = getSupabase();
    const { data: call } = await supabase
      .from("calls")
      .select("id, company_id, phone_number_id, from_number, answered_at")
      .eq("call_sid", callSid)
      .eq("direction", "inbound")
      .maybeSingle();
    if (!call?.company_id) return new Response("OK", { status: 200, headers: corsHeaders });

    const credentials = await getTwilioCredentialMap(supabase, call.company_id);
    const valid = await validateTwilioWebhook(
      req,
      callbackParams,
      credentials,
      Deno.env.get("TWILIO_INBOUND_STATUS_CALLBACK_URL") || undefined,
    );
    if (!valid) return new Response("Forbidden", { status: 403, headers: corsHeaders });

    const dialStatus = callbackParams.DialCallStatus || callbackParams.CallStatus || "";
    const duration = parseInt(callbackParams.DialCallDuration || callbackParams.CallDuration || "0", 10);
    const completed = dialStatus === "completed";
    const failed = dialStatus === "failed";
    const missed = ["busy", "no-answer", "canceled"].includes(dialStatus) || (!completed && !failed);
    const status = completed ? "completed" : failed ? "failed" : "missed";

    await supabase.from("calls").update({
      status,
      duration_seconds: duration > 0 ? duration : null,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", call.id);

    if (missed && call.phone_number_id) {
      const { data: phoneNumber } = await supabase.from("phone_numbers").select("*").eq("id", call.phone_number_id).maybeSingle();
      if (phoneNumber) {
        const recipientIds = await getInboundRecipients(supabase, call.company_id, phoneNumber);
        for (const userId of recipientIds) {
          const { data: existing } = await supabase.from("notifications")
            .select("id")
            .eq("user_id", userId)
            .eq("type", "missed_call")
            .eq("entity_type", "call")
            .eq("entity_id", call.id)
            .maybeSingle();
          if (!existing) {
            await supabase.from("notifications").insert({
              company_id: call.company_id,
              user_id: userId,
              type: "missed_call",
              title: "Missed call",
              body: `Missed incoming call from ${call.from_number || "an unknown number"}.`,
              entity_type: "call",
              entity_id: call.id,
            });
          }
        }
      }
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Inbound call status callback error:", err);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
}

async function handleTwimlWebhook(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const webhookParams: Record<string, string> = {};
    formData.forEach((value, key) => { webhookParams[key] = String(value); });
    const to = webhookParams.To || "";
    let companyId = webhookParams.CompanyId || "";
    const userId = webhookParams.UserId || "";
    const callSid = webhookParams.CallSid || "";

    if (!to) {
      return twimlError("No destination number provided.");
    }

    const supabase = getSupabase();
    let inboundPhoneNumber: any = null;
    if (!companyId) {
      const { data: candidates } = await supabase
        .from("phone_numbers")
        .select("id, company_id, number, assigned_user_id, assigned_team_id")
        .eq("provider", "twilio")
        .eq("registration_status", "registered")
        .eq("is_active", true);
      inboundPhoneNumber = (candidates ?? []).find((number: { number: string }) => normalizePhone(number.number) === normalizePhone(to));
      companyId = inboundPhoneNumber?.company_id || "";
    }

    if (!companyId) {
      console.error("VOICE_WEBHOOK_REJECTED", { reason: "missing company context", has_destination: Boolean(to) });
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }
    const credentials = await getTwilioCredentialMap(supabase, companyId);
    const valid = await validateTwilioWebhook(
      req,
      webhookParams,
      credentials,
      Deno.env.get("TWILIO_VOICE_WEBHOOK_URL") || undefined,
    );
    if (!valid) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    if (inboundPhoneNumber) {
      const callerNumber = webhookParams.From || webhookParams.Caller || "";
      const normalizedCaller = normalizePhone(callerNumber);
      const { data: contact } = await supabase.from("contacts")
        .select("id, first_name, last_name")
        .eq("company_id", companyId)
        .eq("primary_phone_normalized", normalizedCaller)
        .limit(1)
        .maybeSingle();
      const { data: conversation } = contact?.id
        ? await supabase.from("conversations").select("id").eq("company_id", companyId).eq("contact_id", contact.id).limit(1).maybeSingle()
        : { data: null };
      const callerName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Unknown caller";
      const recipientIds = await getInboundRecipients(supabase, companyId, inboundPhoneNumber);
      if (!recipientIds.length) return twimlError("No team member is available to receive this call.");

      let callId = "";
      const { data: existingCall } = await supabase.from("calls").select("id").eq("call_sid", callSid).eq("direction", "inbound").maybeSingle();
      if (existingCall?.id) {
        callId = existingCall.id;
      } else {
        const { data: createdCall } = await supabase.from("calls").insert({
          company_id: companyId,
          conversation_id: conversation?.id || null,
          contact_id: contact?.id || null,
          phone_number_id: inboundPhoneNumber.id,
          direction: "inbound",
          status: "ringing",
          from_number: callerNumber || null,
          to_number: to,
          call_sid: callSid || null,
          is_simulated: false,
          started_at: new Date().toISOString(),
        }).select("id").single();
        callId = createdCall?.id || "";
        if (callId && callSid) {
          await supabase.from("call_recordings").insert({
            company_id: companyId,
            call_sid: callSid,
            from_number: callerNumber || null,
            to_number: to,
            user_id: null,
          });
        }
      }

      const callbackUrl = `${SUPABASE_URL}/functions/v1/voice-token?action=inbound-status`;
      const recordingCallback = `${SUPABASE_URL}/functions/v1/voice-token?action=recording-callback`;
      const clients = recipientIds.map((recipientId) => (
        `<Client><Identity>${xmlEscape(voiceIdentity(recipientId))}</Identity>`
        + `<Parameter name="CallId" value="${xmlEscape(callId)}"/>`
        + `<Parameter name="CallerName" value="${xmlEscape(callerName)}"/>`
        + `<Parameter name="CallerNumber" value="${xmlEscape(callerNumber)}"/>`
        + `</Client>`
      )).join("");
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true" timeout="30" record="record-from-answer-dual" action="${xmlEscape(callbackUrl)}" method="POST" recordingStatusCallback="${xmlEscape(recordingCallback)}" recordingStatusCallbackMethod="POST">${clients}</Dial></Response>`;
      return twimlResponse(twiml);
    }

    const formattedTo = to.startsWith("+") ? to : `+${to}`;

    // Try to resolve a caller ID from the database
    let callerId = "";
    try {
      if (userId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("assigned_user_id", userId).eq("is_active", true)
          .eq("provider", "twilio").eq("registration_status", "registered").not("provider_reference", "is", null)
          .limit(1).maybeSingle();
        if (pn) callerId = pn.number;
      }
      if (!callerId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("is_default", true).eq("is_active", true)
          .eq("provider", "twilio").eq("registration_status", "registered").not("provider_reference", "is", null)
          .limit(1).maybeSingle();
        if (pn) callerId = pn.number;
      }
      if (!callerId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("is_active", true)
          .eq("provider", "twilio").eq("registration_status", "registered").not("provider_reference", "is", null)
          .limit(1).maybeSingle();
        if (pn) callerId = pn.number;
      }

      // Pre-create the recording row so we can link it to the company/user
      if (callSid && companyId) {
        await supabase.from("call_recordings").insert({
          company_id: companyId,
          call_sid: callSid,
          from_number: callerId || null,
          to_number: formattedTo,
          user_id: userId || null,
        });
      }
    } catch {
      // If DB lookup fails, continue without caller ID
    }

    if (!callerId) {
      const caller = formData.get("Caller") as string || "";
      const from = formData.get("From") as string || "";
      const called = formData.get("Called") as string || "";

      if (called && called.startsWith("+")) {
        callerId = called;
      } else if (caller && caller.startsWith("+")) {
        callerId = caller;
      } else if (from && from.startsWith("+")) {
        callerId = from;
      }
    }

    const formattedFrom = callerId ? (callerId.startsWith("+") ? callerId : `+${callerId}`) : "";

    if (!formattedFrom) {
      return twimlError("No caller ID number is configured. Please add a phone number in settings.");
    }

    const recordingCallback = `${SUPABASE_URL}/functions/v1/voice-token?action=recording-callback`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${formattedFrom}" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST"><Number>${formattedTo}</Number></Dial></Response>`;
    return twimlResponse(twiml);
  } catch (err) {
    console.error("TwiML webhook error:", err);
    return twimlError("An error occurred connecting your call. Please try again.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const contentType = req.headers.get("content-type") || "";

  // Handle recording status callback (Twilio posts form-urlencoded with ?action=recording-callback)
  if (url.searchParams.get("action") === "recording-callback" && contentType.includes("application/x-www-form-urlencoded")) {
    return handleRecordingCallback(req);
  }

  if (url.searchParams.get("action") === "inbound-status" && contentType.includes("application/x-www-form-urlencoded")) {
    return handleInboundStatusCallback(req);
  }

  // Handle TwiML webhook from Twilio (form-urlencoded POST)
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return handleTwimlWebhook(req);
  }

  // Handle JSON API requests from the browser
  try {
    const supabase = getSupabase();

    const body = await req.json();
    const { action, company_id, user_id, phone_number_id } = body as {
      action: string;
      company_id: string;
      user_id?: string;
      phone_number_id?: string;
    };

    // Resolve company Twilio credentials
    const requiredPermission = ["sync_numbers", "configure_inbound"].includes(action)
      ? "manage_phone_numbers"
      : action === "get_token"
        ? ["view_calls", "view_acquisitions", "view_dispositions"]
        : "view_calls";
    const authorizedUser = await authorizeUserRequest(req, supabase, company_id, user_id, requiredPermission);
    if (!authorizedUser) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credMap = await getTwilioCredentialMap(supabase, company_id);

    const accountSid = credMap.account_sid;
    const authToken = credMap.auth_token;
    const twimlAppSid = credMap.twiml_app_sid;

    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured. Go to Settings > Integrations and add your Twilio Account SID and Auth Token." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "get_token") {
      if (!twimlAppSid) {
        return new Response(
          JSON.stringify({ error: "Twilio TwiML App SID not configured. Add twiml_app_sid to your Twilio integration settings. The Voice Request URL should point to your voice-token edge function." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const apiKeySid = credMap.api_key_sid;
      const apiKeySecret = credMap.api_key_secret;

      if (!apiKeySid || !apiKeySecret) {
        return new Response(
          JSON.stringify({ error: "Twilio API Key SID and Secret are required for browser calling. Add api_key_sid and api_key_secret to your Twilio integration settings." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { AccessToken } = twilio.jwt;
      const { VoiceGrant } = AccessToken;

      const identity = voiceIdentity(authorizedUser.id);
      const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity });
      const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: true,
      });
      token.addGrant(voiceGrant);

      return new Response(
        JSON.stringify({ success: true, token: token.toJwt(), identity }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "sync_numbers") {
      const client = twilio(accountSid, authToken);
      const incomingNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
      const actualNumbers = new Set(
        incomingNumbers.map(
          (number: { phoneNumber: string }) => number.phoneNumber,
        ),
      );

      for (const number of incomingNumbers as Array<{
        sid: string;
        phoneNumber: string;
        friendlyName?: string;
      }>) {
        const { error } = await supabase.from("phone_numbers").upsert({
          company_id,
          number: number.phoneNumber,
          friendly_name: number.friendlyName || number.phoneNumber,
          provider: "twilio",
          provider_reference: number.sid,
          registration_status: "registered",
          is_mock: false,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,number" });
        if (error) throw error;
      }

      const { data: storedNumbers } = await supabase.from("phone_numbers")
        .select("id, number")
        .eq("company_id", company_id)
        .eq("provider", "twilio");
      for (const stored of storedNumbers ?? []) {
        if (!actualNumbers.has(stored.number)) {
          await supabase.from("phone_numbers").update({
            is_active: false,
            registration_status: "unregistered",
            updated_at: new Date().toISOString(),
          }).eq("id", stored.id).eq("company_id", company_id);
        }
      }

      return new Response(JSON.stringify({ success: true, count: incomingNumbers.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "configure_inbound") {
      if (!twimlAppSid) {
        return new Response(
          JSON.stringify({ error: "Add the TwiML App SID in Settings > Integrations before enabling incoming calls." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!phone_number_id) {
        return new Response(JSON.stringify({ error: "A phone number is required." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: phoneNumber } = await supabase.from("phone_numbers")
        .select("id, provider_reference")
        .eq("id", phone_number_id)
        .eq("company_id", company_id)
        .eq("provider", "twilio")
        .eq("registration_status", "registered")
        .maybeSingle();
      if (!phoneNumber?.provider_reference) {
        return new Response(JSON.stringify({ error: "Sync this Twilio number before enabling incoming calls." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const client = twilio(accountSid, authToken);
      await client.incomingPhoneNumbers(phoneNumber.provider_reference).update({
        voiceApplicationSid: twimlAppSid,
        voiceMethod: "POST",
      });
      await supabase.from("phone_numbers").update({
        inbound_routing: {
          mode: "browser",
          voice_application_sid: twimlAppSid,
          configured_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", phoneNumber.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
