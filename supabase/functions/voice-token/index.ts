import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import twilio from "npm:twilio@4.23.0";

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

async function handleRecordingCallback(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const callSid = formData.get("CallSid") as string || "";
    const recordingSid = formData.get("RecordingSid") as string || "";
    const recordingUrl = formData.get("RecordingUrl") as string || "";
    const recordingDuration = parseInt(formData.get("RecordingDuration") as string || "0", 10);

    if (!callSid || !recordingSid) {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const supabase = getSupabase();

    // Update the existing row (created at call start) with recording details
    const { data: existing } = await supabase
      .from("call_recordings")
      .select("id")
      .eq("call_sid", callSid)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("call_recordings")
        .update({
          recording_sid: recordingSid,
          recording_url: recordingUrl,
          duration_seconds: recordingDuration,
        })
        .eq("id", existing.id);
    } else {
      // Fallback: create a new row if the initial one wasn't created
      await supabase.from("call_recordings").insert({
        call_sid: callSid,
        recording_sid: recordingSid,
        recording_url: recordingUrl,
        duration_seconds: recordingDuration,
        company_id: null as any, // unknown at callback time
      });
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Recording callback error:", err);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
}

async function handleTwimlWebhook(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const to = formData.get("To") as string || "";
    const companyId = formData.get("CompanyId") as string || "";
    const userId = formData.get("UserId") as string || "";
    const callSid = formData.get("CallSid") as string || "";

    if (!to) {
      return twimlError("No destination number provided.");
    }

    const formattedTo = to.startsWith("+") ? to : `+${to}`;

    // Try to resolve a caller ID from the database
    let callerId = "";
    try {
      const supabase = getSupabase();

      if (userId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("assigned_user_id", userId).eq("is_active", true)
          .limit(1).maybeSingle();
        if (pn) callerId = pn.number;
      }
      if (!callerId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("is_default", true).eq("is_active", true)
          .limit(1).maybeSingle();
        if (pn) callerId = pn.number;
      }
      if (!callerId && companyId) {
        const { data: pn } = await supabase
          .from("phone_numbers").select("number")
          .eq("company_id", companyId).eq("is_active", true)
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

  // Handle TwiML webhook from Twilio (form-urlencoded POST)
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return handleTwimlWebhook(req);
  }

  // Handle JSON API requests from the browser
  try {
    const supabase = getSupabase();

    const body = await req.json();
    const { action, company_id, user_id } = body as {
      action: string;
      company_id: string;
      user_id?: string;
    };

    // Resolve company Twilio credentials
    const { data: credRows } = await supabase
      .from("company_credentials")
      .select("credential_key, credential_value")
      .eq("company_id", company_id)
      .eq("provider", "twilio");

    const credMap: Record<string, string> = {};
    for (const row of credRows ?? []) {
      credMap[row.credential_key] = row.credential_value;
    }

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

      const identity = user_id ?? "agent";
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
