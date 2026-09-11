import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

const OPT_OUT_FOOTERS = [
  (name: string) => `\n\n${name}\nReply STOP to opt out`,
  (name: string) => `\n\n${name}\nReply QUIT to stop receiving messages`,
  (name: string) => `\n\n${name}\nReply WRONG if we have the wrong person`,
  (name: string) => `\n\n${name}\nReply UNSUBSCRIBE to halt messages`,
];

function getComplianceFooter(companyName: string, contactSeed: string): string {
  const seed = (contactSeed ?? "").split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const index = seed % OPT_OUT_FOOTERS.length;
  return OPT_OUT_FOOTERS[index](companyName);
}

function isSameDay(date: Date, now: Date): boolean {
  return date.getUTCFullYear() === now.getUTCFullYear()
    && date.getUTCMonth() === now.getUTCMonth()
    && date.getUTCDate() === now.getUTCDate();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action, campaign_id, company_id } = body as {
      action: string;
      campaign_id: string;
      company_id: string;
    };

    if (action === "process_next_batch") {
      return await processNextBatch(supabase, campaign_id, company_id);
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

async function processNextBatch(supabase: any, campaignId: string, companyId: string) {
  const { data: campaign } = await supabase
    .from("import_text_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!campaign) return jsonResponse({ error: "Campaign not found" }, 404);
  if (campaign.status !== "active") {
    return jsonResponse({ done: true, reason: `Campaign status is ${campaign.status}` });
  }

  // Get Twilio credentials
  const { data: credRows } = await supabase
    .from("company_credentials")
    .select("credential_key, credential_value")
    .eq("company_id", companyId)
    .eq("provider", "twilio");

  const credMap: Record<string, string> = {};
  for (const row of credRows ?? []) {
    credMap[row.credential_key] = row.credential_value;
  }
  const accountSid = credMap.account_sid;
  const authToken = credMap.auth_token;
  const messagingServiceSid = credMap.messaging_service_sid;

  if (!accountSid || !authToken) {
    return jsonResponse({ error: "Twilio credentials not configured" }, 400);
  }

  // Get the sender phone number with its daily limit info
  let phoneRecord: any = null;
  let fromNumber = "";

  if (!messagingServiceSid) {
    const { data: pn } = await supabase
      .from("phone_numbers")
      .select("id, number, daily_send_limit, daily_sends_today, daily_sends_reset_at")
      .eq("company_id", companyId).eq("is_active", true).eq("is_default", true)
      .limit(1).maybeSingle();

    if (pn) {
      phoneRecord = pn;
      fromNumber = pn.number;
    } else {
      const { data: pn2 } = await supabase
        .from("phone_numbers")
        .select("id, number, daily_send_limit, daily_sends_today, daily_sends_reset_at")
        .eq("company_id", companyId).eq("is_active", true)
        .limit(1).maybeSingle();
      if (pn2) {
        phoneRecord = pn2;
        fromNumber = pn2.number;
      }
    }

    if (!fromNumber) return jsonResponse({ error: "No active phone number" }, 400);
  }

  // --- Daily limit check ---
  const now = new Date();
  let dailySendsToday = 0;
  let dailyLimit: number | null = null;

  if (phoneRecord) {
    dailyLimit = phoneRecord.daily_send_limit;
    const resetAt = new Date(phoneRecord.daily_sends_reset_at);

    if (isSameDay(resetAt, now)) {
      dailySendsToday = phoneRecord.daily_sends_today ?? 0;
    } else {
      // New day - reset the counter
      dailySendsToday = 0;
      await supabase.from("phone_numbers").update({
        daily_sends_today: 0,
        daily_sends_reset_at: now.toISOString(),
      }).eq("id", phoneRecord.id);
    }

    // If we've hit the limit, stop cleanly
    if (dailyLimit !== null && dailySendsToday >= dailyLimit) {
      return jsonResponse({
        done: false,
        daily_limit_reached: true,
        daily_limit: dailyLimit,
        daily_sends_today: dailySendsToday,
        resets_at: getNextMidnightUTC(now).toISOString(),
      });
    }
  }

  // Calculate how many we can still send this batch (respect the daily cap)
  let batchLimit = 3;
  if (dailyLimit !== null) {
    const remaining = dailyLimit - dailySendsToday;
    batchLimit = Math.min(batchLimit, remaining);
    if (batchLimit <= 0) {
      return jsonResponse({
        done: false,
        daily_limit_reached: true,
        daily_limit: dailyLimit,
        daily_sends_today: dailySendsToday,
        resets_at: getNextMidnightUTC(now).toISOString(),
      });
    }
  }

  // Get company name for compliance
  const { data: companyData } = await supabase
    .from("companies")
    .select("compliance_company_name, name, legal_name")
    .eq("id", companyId)
    .maybeSingle();
  const companyName = companyData?.compliance_company_name || companyData?.legal_name || companyData?.name || "This company";

  // Get next batch of queued recipients
  const { data: recipients } = await supabase
    .from("import_text_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .order("sort_order", { ascending: true })
    .limit(batchLimit);

  if (!recipients || recipients.length === 0) {
    await supabase.from("import_text_campaigns").update({
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", campaignId);
    return jsonResponse({ done: true, sent: 0 });
  }

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const recipient of recipients) {
    // Re-check limit before each send (in case we counted wrong)
    if (dailyLimit !== null && (dailySendsToday + sentCount) >= dailyLimit) {
      break;
    }

    // Check if contact is opted out
    if (recipient.contact_id) {
      const { data: contact } = await supabase
        .from("contacts").select("do_not_text")
        .eq("id", recipient.contact_id).maybeSingle();
      if (contact?.do_not_text) {
        await supabase.from("import_text_recipients").update({
          status: "opted_out", sent_at: new Date().toISOString(),
        }).eq("id", recipient.id);
        skippedCount++;
        continue;
      }
    }

    // Check suppression by phone
    const { data: suppressed } = await supabase
      .from("contacts").select("id")
      .eq("company_id", companyId)
      .eq("primary_phone_normalized", recipient.phone_normalized)
      .eq("do_not_text", true)
      .maybeSingle();

    if (suppressed) {
      await supabase.from("import_text_recipients").update({
        status: "opted_out", sent_at: new Date().toISOString(),
      }).eq("id", recipient.id);
      skippedCount++;
      continue;
    }

    // Build message
    let messageBody = campaign.message_template;
    messageBody = messageBody.replace(/\{first_name\}/g, recipient.first_name || "there");
    messageBody = messageBody.replace(/\{last_name\}/g, recipient.last_name || "");
    messageBody = messageBody.replace(/\{property_address\}/g, recipient.property_address || "your property");

    const footer = getComplianceFooter(companyName, recipient.phone_normalized || recipient.phone);
    const keywords = ["STOP", "QUIT", "WRONG", "UNSUBSCRIBE"];
    if (!keywords.some(k => messageBody.includes(k))) {
      messageBody += footer;
    }

    // Send via Twilio
    const toFormatted = formatPhone(recipient.phone);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({ To: toFormatted, Body: messageBody });
    if (messagingServiceSid) {
      params.set("MessagingServiceSid", messagingServiceSid);
    } else {
      params.set("From", formatPhone(fromNumber));
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await resp.json();

    if (resp.ok) {
      await supabase.from("import_text_recipients").update({
        status: "sent", sent_at: new Date().toISOString(),
      }).eq("id", recipient.id);
      sentCount++;
    } else {
      const errMsg = data.message ?? `Twilio error ${resp.status}`;
      await supabase.from("import_text_recipients").update({
        status: "failed", error_message: errMsg, sent_at: new Date().toISOString(),
      }).eq("id", recipient.id);
      failedCount++;
    }

    // Link to existing contact if possible
    if (!recipient.contact_id && recipient.phone_normalized) {
      const { data: existingContact } = await supabase
        .from("contacts").select("id")
        .eq("company_id", companyId).eq("primary_phone_normalized", recipient.phone_normalized)
        .maybeSingle();
      if (existingContact) {
        await supabase.from("import_text_recipients").update({
          contact_id: existingContact.id,
        }).eq("id", recipient.id);
      }
    }
  }

  // Increment the daily send counter on the phone number
  if (phoneRecord && sentCount > 0) {
    await supabase.from("phone_numbers").update({
      daily_sends_today: dailySendsToday + sentCount,
    }).eq("id", phoneRecord.id);
  }

  // Update campaign counts
  await supabase.from("import_text_campaigns").update({
    sent_count: campaign.sent_count + sentCount,
    failed_count: campaign.failed_count + failedCount,
  }).eq("id", campaignId);

  // Check if fully done
  const { data: remaining } = await supabase
    .from("import_text_recipients")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .limit(1)
    .maybeSingle();

  if (!remaining) {
    await supabase.from("import_text_campaigns").update({
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", campaignId);
    return jsonResponse({ done: true, sent: sentCount, failed: failedCount });
  }

  // Check if we just hit the limit with this batch
  if (dailyLimit !== null && (dailySendsToday + sentCount) >= dailyLimit) {
    return jsonResponse({
      done: false,
      daily_limit_reached: true,
      daily_limit: dailyLimit,
      daily_sends_today: dailySendsToday + sentCount,
      sent: sentCount,
      failed: failedCount,
      resets_at: getNextMidnightUTC(now).toISOString(),
    });
  }

  return jsonResponse({ done: false, sent: sentCount, failed: failedCount });
}

function getNextMidnightUTC(now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}
