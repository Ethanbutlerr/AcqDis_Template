import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action ?? "trigger";

    if (action === "trigger") {
      return await triggerAutomations(supabase, body);
    } else if (action === "process_follow_ups") {
      return await processFollowUps(supabase);
    } else if (action === "seed_default_automations") {
      return await seedDefaultAutomations(supabase, body.company_id);
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});

async function triggerAutomations(supabase: any, params: {
  trigger_type: string;
  company_id: string;
  record_id: string;
  record_type: string;
  metadata?: Record<string, unknown>;
}) {
  const { trigger_type, company_id, record_id, record_type, metadata } = params;

  // Find active automations for this trigger type
  const { data: automations } = await supabase
    .from("automations")
    .select("*")
    .eq("company_id", company_id)
    .eq("trigger_type", trigger_type)
    .eq("is_active", true);

  let executed = 0;
  let skipped = 0;

  for (const automation of automations ?? []) {
    const idempotencyKey = `${automation.id}-${trigger_type}-${record_id}`;

    // Check idempotency — prevent duplicate execution
    const { data: existingRun } = await supabase
      .from("automation_runs")
      .select("id, status")
      .eq("automation_id", automation.id)
      .eq("idempotency_key", idempotency_key(idempotencyKey))
      .in("status", ["pending", "running", "completed"])
      .maybeSingle();

    if (existingRun) {
      skipped++;
      continue;
    }

    // Create automation run
    const { data: run } = await supabase.from("automation_runs").insert({
      company_id,
      automation_id: automation.id,
      trigger_event: trigger_type,
      record_id,
      record_type,
      started_at: new Date().toISOString(),
      status: "running",
      idempotency_key: idempotency_key(idempotencyKey),
    }).select().single();

    if (!run) continue;

    try {
      // Check conditions
      const { data: conditions } = await supabase
        .from("automation_conditions")
        .select("*")
        .eq("automation_id", automation.id);

      const conditionsMet = await checkConditions(supabase, conditions ?? [], {
        record_id,
        record_type,
        metadata: metadata ?? {},
        company_id,
      });

      if (!conditionsMet) {
        await supabase.from("automation_runs").update({
          status: "skipped",
          completed_at: new Date().toISOString(),
          error: "Conditions not met",
        }).eq("id", run.id);
        skipped++;
        continue;
      }

      // Execute actions
      const { data: actions } = await supabase
        .from("automation_actions")
        .select("*")
        .eq("automation_id", automation.id)
        .order("sort_order");

      for (const action of actions ?? []) {
        await executeAction(supabase, action, {
          record_id,
          record_type,
          company_id,
          metadata: metadata ?? {},
          automation_id: automation.id,
        });
      }

      await supabase.from("automation_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      executed++;
    } catch (err) {
      await supabase.from("automation_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: err.message,
        retry_count: (run.retry_count ?? 0) + 1,
      }).eq("id", run.id);
    }
  }

  // Also handle built-in automations for specific triggers
  await handleBuiltInTriggers(supabase, trigger_type, company_id, record_id, record_type, metadata ?? {});

  return jsonResponse({ executed, skipped, trigger_type });
}

async function handleBuiltInTriggers(supabase: any, trigger_type: string, company_id: string, record_id: string, record_type: string, metadata: Record<string, unknown>) {
  if (record_type !== "acquisition_record") return;

  const { data: record } = await supabase
    .from("acquisition_records")
    .select("*")
    .eq("id", record_id)
    .maybeSingle();
  if (!record) return;

  if (trigger_type === "lead_created") {
    await handleNewLeadAutomation(supabase, company_id, record, metadata);
  } else if (trigger_type === "stage_changed") {
    const toStageId = metadata.to_stage_id as string;
    const { data: stage } = await supabase
      .from("acquisition_pipeline_stages")
      .select("name")
      .eq("id", toStageId)
      .maybeSingle();
    if (stage?.name === "Needs Offer") {
      await handleNeedsOfferAutomation(supabase, company_id, record);
    } else if (stage?.name === "Needs Contract") {
      await handleNeedsContractAutomation(supabase, company_id, record);
    } else if (stage?.name === "Contract Executed") {
      await handleContractExecutedAutomation(supabase, company_id, record);
    }
  } else if (trigger_type === "call_answered") {
    await handleCallAnsweredAutomation(supabase, company_id, record, metadata);
  }
}

async function handleNewLeadAutomation(supabase: any, company_id: string, record: any, metadata: Record<string, unknown>) {
  const idempotencyKey = `new-lead-${record.id}`;

  // Create high-priority contact task (idempotent)
  const { data: existingTask } = await supabase
    .from("tasks")
    .select("id")
    .eq("related_contact_id", record.contact_id)
    .eq("title", "Contact new lead")
    .maybeSingle();

  if (!existingTask) {
    await supabase.from("tasks").insert({
      company_id,
      title: "Contact new lead",
      description: `New acquisition lead from ${record.lead_source ?? "unknown source"}. Motivation: ${record.motivation ?? "N/A"}`,
      status: "open",
      priority: "high",
      related_contact_id: record.contact_id,
      assigned_to: record.assigned_user_id,
      created_by: metadata.changed_by ?? null,
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Create in-app notification for assignment (idempotent)
  await createNotificationIdempotent(supabase, {
    company_id,
    user_id: record.assigned_user_id,
    type: "new_lead",
    title: "New acquisition lead assigned",
    body: `New lead from ${record.lead_source ?? "unknown"}`,
    entity_type: "acquisition_record",
    entity_id: record.id,
    idempotency_key: `${idempotencyKey}-notif`,
  });

  // Queue initial SMS event (mock)
  await queueMockEvent(supabase, {
    company_id,
    event_type: "initial_sms",
    entity_type: "acquisition_record",
    entity_id: record.id,
    metadata: { contact_id: record.contact_id, simulated: true },
    idempotency_key: `${idempotencyKey}-sms`,
  });

  // Queue Discord notification event (mock)
  await queueMockEvent(supabase, {
    company_id,
    event_type: "discord_notification",
    entity_type: "acquisition_record",
    entity_id: record.id,
    metadata: { message: `New lead created: ${record.lead_source ?? "unknown"}`, simulated: true },
    idempotency_key: `${idempotencyKey}-discord`,
  });

  // Begin daily follow-up sequence
  await supabase.from("acquisition_records").update({
    follow_up_active: true,
    follow_up_paused: false,
    follow_up_attempt_count: 0,
    follow_up_next_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }).eq("id", record.id);

  // Log system event
  await supabase.from("system_events").insert({
    company_id,
    event_type: "new_lead_automation_executed",
    entity_type: "acquisition_record",
    entity_id: record.id,
    metadata: { task_created: true, notification_created: true, sms_queued: true, discord_queued: true, simulated: true },
    severity: "info",
  });
}

async function handleNeedsOfferAutomation(supabase: any, company_id: string, record: any) {
  // Create Director review notification (idempotent — check if data changed)
  const { data: existingNotif } = await supabase
    .from("notifications")
    .select("id, metadata")
    .eq("entity_id", record.id)
    .eq("type", "needs_offer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentData = {
    asking_price: record.asking_price,
    estimated_arv: record.estimated_arv,
    estimated_repair_cost: record.estimated_repair_cost,
    motivation: record.motivation,
  };

  if (existingNotif) {
    const prevData = (existingNotif.metadata as Record<string, unknown>)?.data;
    if (JSON.stringify(prevData) === JSON.stringify(currentData)) {
      return; // No meaningful data changed, skip duplicate notification
    }
  }

  // Find Director role users
  const { data: directors } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", company_id)
    .eq("system_role", "director");

  for (const director of directors ?? []) {
    await supabase.from("notifications").insert({
      company_id,
      user_id: director.id,
      type: "needs_offer",
      title: "Director review needed: offer calculation",
      body: `Acquisition record needs offer review. Asking: ${record.asking_price ?? "N/A"}, ARV: ${record.estimated_arv ?? "N/A"}, Repairs: ${record.estimated_repair_cost ?? "N/A"}`,
      entity_type: "acquisition_record",
      entity_id: record.id,
      is_read: false,
      metadata: { data: currentData },
    });
  }

  // Create task to calculate offer (idempotent)
  const { data: existingTask } = await supabase
    .from("tasks")
    .select("id")
    .eq("related_contact_id", record.contact_id)
    .eq("title", "Calculate offer for acquisition")
    .maybeSingle();

  if (!existingTask) {
    await supabase.from("tasks").insert({
      company_id,
      title: "Calculate offer for acquisition",
      description: `Seller: ${record.contact_id ?? "N/A"}, Property: ${record.property_id ?? "N/A"}, Asking: ${record.asking_price ?? "N/A"}, ARV: ${record.estimated_arv ?? "N/A"}, Repairs: ${record.estimated_repair_cost ?? "N/A"}, Notes: ${record.motivation ?? "N/A"}`,
      status: "open",
      priority: "high",
      related_contact_id: record.contact_id,
      created_by: null,
      due_date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  }
}

async function handleNeedsContractAutomation(supabase: any, company_id: string, record: any) {
  // Create notifications for Director and Transaction Coordinator
  const { data: directors } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", company_id)
    .eq("system_role", "director");

  const { data: coordinators } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", company_id)
    .eq("system_role", "transaction_coordinator");

  for (const director of directors ?? []) {
    await createNotificationIdempotent(supabase, {
      company_id,
      user_id: director.id,
      type: "needs_contract",
      title: "Contract preparation needed",
      body: `Acquisition record moved to Needs Contract stage.`,
      entity_type: "acquisition_record",
      entity_id: record.id,
      idempotency_key: `needs-contract-${record.id}-director-${director.id}`,
    });
  }

  for (const coordinator of coordinators ?? []) {
    await createNotificationIdempotent(supabase, {
      company_id,
      user_id: coordinator.id,
      type: "needs_contract",
      title: "Contract preparation needed",
      body: `Acquisition record moved to Needs Contract stage.`,
      entity_type: "acquisition_record",
      entity_id: record.id,
      idempotency_key: `needs-contract-${record.id}-coordinator-${coordinator.id}`,
    });
  }

  // Create contract-preparation task (idempotent)
  const { data: existingTask } = await supabase
    .from("tasks")
    .select("id")
    .eq("related_contact_id", record.contact_id)
    .eq("title", "Prepare contract for acquisition")
    .maybeSingle();

  if (!existingTask) {
    await supabase.from("tasks").insert({
      company_id,
      title: "Prepare contract for acquisition",
      description: "Prepare contract documents for the acquisition record.",
      status: "open",
      priority: "high",
      related_contact_id: record.contact_id,
      due_date: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Check for missing required fields
  const missingFields: string[] = [];
  if (!record.asking_price) missingFields.push("Asking Price");
  if (!record.estimated_arv) missingFields.push("Estimated ARV");
  if (!record.estimated_repair_cost) missingFields.push("Estimated Repair Cost");
  if (!record.offer_amount) missingFields.push("Offer Amount");

  if (missingFields.length > 0) {
    await supabase.from("system_events").insert({
      company_id,
      event_type: "needs_contract_missing_fields",
      entity_type: "acquisition_record",
      entity_id: record.id,
      metadata: { missing_fields: missingFields },
      severity: "warning",
    });
  }
}

async function handleContractExecutedAutomation(supabase: any, company_id: string, record: any) {
  // Idempotency guard — only run once per acquisition record
  const dispIdemKey = `contract-executed-${record.id}-create-disposition`;
  const { error: idemErr } = await supabase.from("synchronization_events").insert({
    company_id,
    entity_type: "acquisition_record",
    entity_id: record.id,
    source_pipeline: "acquisition",
    target_pipeline: "disposition",
    idempotency_key: dispIdemKey,
    result: "success",
  });
  const alreadyRan = idemErr && idemErr.code === "23505";

  // Mark contract executed timestamp (always safe to update)
  if (!record.contract_executed_at) {
    await supabase.from("acquisition_records").update({
      contract_executed_at: new Date().toISOString(),
    }).eq("id", record.id);
  }

  // Lock attribution snapshot (always safe)
  if (!record.attribution_snapshot || Object.keys(record.attribution_snapshot ?? {}).length === 0) {
    await supabase.from("acquisition_records").update({
      attribution_snapshot: {
        assigned_user_id: record.assigned_user_id,
        lead_source: record.lead_source,
        opportunity_id: record.opportunity_id,
        contact_id: record.contact_id,
        property_id: record.property_id,
        locked_at: new Date().toISOString(),
      },
    }).eq("id", record.id);
  }

  if (!alreadyRan) {
    // ── Create Disposition Record ──────────────────────────────────────
    // Check whether an active disposition already exists for this opportunity
    const { data: existingDisp } = await supabase
      .from("disposition_records")
      .select("id, pipeline_stage_id")
      .eq("opportunity_id", record.opportunity_id)
      .eq("status", "active")
      .maybeSingle();

    let dispositionId: string | null = existingDisp?.id ?? null;

    if (!existingDisp) {
      // Find "New Deal" disposition stage
      const { data: newDealStage } = await supabase
        .from("disposition_pipeline_stages")
        .select("id")
        .eq("company_id", company_id)
        .eq("name", "New Deal")
        .maybeSingle();

      if (newDealStage && record.property_id && record.contact_id) {
        const { data: newDisp } = await supabase
          .from("disposition_records")
          .insert({
            company_id,
            opportunity_id: record.opportunity_id,
            acquisition_record_id: record.id,
            property_id: record.property_id,
            contact_id: record.contact_id,
            assigned_user_id: record.assigned_user_id ?? null,
            pipeline_stage_id: newDealStage.id,
            contract_price: record.offer_amount ?? null,
            status: "active",
            stage_entered_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        dispositionId = newDisp?.id ?? null;
      }
    }

    // ── Create / Update Management Record ─────────────────────────────
    const { data: contractExecMgmtStage } = await supabase
      .from("management_pipeline_stages")
      .select("id")
      .eq("company_id", company_id)
      .eq("name", "Contract Executed")
      .maybeSingle();

    const { data: existingMgmt } = await supabase
      .from("management_records")
      .select("id")
      .eq("opportunity_id", record.opportunity_id)
      .maybeSingle();

    if (existingMgmt) {
      // Update the existing management record
      await supabase.from("management_records").update({
        acquisition_record_id: record.id,
        disposition_record_id: dispositionId,
        pipeline_stage_id: contractExecMgmtStage?.id ?? existingMgmt.pipeline_stage_id,
        acquisition_stage_snapshot: "Contract Executed",
        stage_entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", existingMgmt.id);
    } else if (contractExecMgmtStage) {
      await supabase.from("management_records").insert({
        company_id,
        opportunity_id: record.opportunity_id,
        acquisition_record_id: record.id,
        disposition_record_id: dispositionId,
        assigned_user_id: record.assigned_user_id ?? null,
        pipeline_stage_id: contractExecMgmtStage.id,
        acquisition_stage_snapshot: "Contract Executed",
        stage_entered_at: new Date().toISOString(),
      });
    }

    // Create initial disposition tasks
    const taskTitles = [
      "Collect property photos and info",
      "Send deal to VIP buyers list",
      "Post deal to Facebook groups",
    ];
    for (const title of taskTitles) {
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("company_id", company_id)
        .eq("title", title)
        .eq("related_opportunity_id", record.opportunity_id)
        .maybeSingle();
      if (!existing) {
        await supabase.from("tasks").insert({
          company_id,
          title,
          status: "open",
          priority: "high",
          related_contact_id: record.contact_id ?? null,
          related_opportunity_id: record.opportunity_id ?? null,
          assigned_to: record.assigned_user_id ?? null,
          due_date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    // Notify disposition team via Discord mock
    await queueMockEvent(supabase, {
      company_id,
      event_type: "discord_notification",
      entity_type: "acquisition_record",
      entity_id: record.id,
      metadata: {
        message: `🏠 New Deal: Contract Executed — Disposition record created. Property: ${record.property_id ?? "N/A"}`,
        channel: "disposition-team",
        simulated: true,
      },
      idempotency_key: `contract-executed-${record.id}-discord`,
    });
  }

  // Activity event (always write — shows re-entries too)
  await supabase.from("activity_events").insert({
    company_id,
    entity_type: "acquisition_record",
    entity_id: record.id,
    event_type: "contract_executed",
    metadata: {
      locked_attribution: true,
      disposition_created: !alreadyRan,
      management_updated: !alreadyRan,
    },
  });

  // Notify assigned user
  await createNotificationIdempotent(supabase, {
    company_id,
    user_id: record.assigned_user_id,
    type: "contract_executed",
    title: "Contract Executed",
    body: `Contract executed. Disposition record ${alreadyRan ? "already exists" : "created"} and management record updated.`,
    entity_type: "acquisition_record",
    entity_id: record.id,
    idempotency_key: `contract-executed-${record.id}-notif`,
  });
}

async function handleCallAnsweredAutomation(supabase: any, company_id: string, record: any, metadata: Record<string, unknown>) {
  const userId = metadata.user_id as string;
  if (!userId) return;

  // Stop the unassigned notification cycle
  await supabase.from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("entity_id", record.id)
    .eq("type", "new_lead")
    .eq("is_read", false);

  // Stop automated follow-up if configured
  await supabase.from("acquisition_records").update({
    follow_up_active: false,
    follow_up_paused: true,
  }).eq("id", record.id);

  await supabase.from("system_events").insert({
    company_id,
    event_type: "answered_call_assignment",
    entity_type: "acquisition_record",
    entity_id: record.id,
    metadata: { assigned_to: userId, reason: "Answered Call", simulated: true },
    severity: "info",
  });
}

async function processFollowUps(supabase: any) {
  const now = new Date().toISOString();

  // Get records with active follow-ups that are due
  const { data: records } = await supabase
    .from("acquisition_records")
    .select("*")
    .not("follow_up_next_at", "is", null)
    .lte("follow_up_next_at", now)
    .eq("follow_up_active", true)
    .eq("follow_up_paused", false)
    .is("archived_at", null)
    .limit(100);

  let processed = 0;
  let stopped = 0;

  for (const record of records ?? []) {
    // Check stopping conditions
    const { data: stage } = await supabase
      .from("acquisition_pipeline_stages")
      .select("name, is_stopping_stage")
      .eq("id", record.pipeline_stage_id)
      .maybeSingle();

    if (stage?.is_stopping_stage) {
      await supabase.from("acquisition_records").update({
        follow_up_active: false,
        follow_up_paused: true,
      }).eq("id", record.id);
      stopped++;
      continue;
    }

    if (record.follow_up_attempt_count >= record.follow_up_max_attempts) {
      await supabase.from("acquisition_records").update({
        follow_up_active: false,
      }).eq("id", record.id);
      stopped++;
      continue;
    }

    // Check if contact opted out or DNC
    if (record.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("do_not_text, do_not_call")
        .eq("id", record.contact_id)
        .maybeSingle();

      if (contact?.do_not_text || contact?.do_not_call) {
        await supabase.from("acquisition_records").update({
          follow_up_active: false,
          follow_up_paused: true,
        }).eq("id", record.id);
        stopped++;
        continue;
      }

      // Check for inbound SMS (response received)
      const { data: inboundMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("contact_id", record.contact_id)
        .eq("direction", "inbound")
        .gte("created_at", record.stage_entered_at)
        .limit(1)
        .maybeSingle();

      if (inboundMsg) {
        await supabase.from("acquisition_records").update({
          follow_up_active: false,
          follow_up_paused: true,
        }).eq("id", record.id);
        stopped++;
        continue;
      }
    }

    // Queue follow-up SMS (mock)
    await queueMockEvent(supabase, {
      company_id: record.company_id,
      event_type: "follow_up_sms",
      entity_type: "acquisition_record",
      entity_id: record.id,
      metadata: {
        contact_id: record.contact_id,
        attempt_number: record.follow_up_attempt_count + 1,
        simulated: true,
      },
      idempotency_key: `follow-up-${record.id}-${record.follow_up_attempt_count + 1}`,
    });

    // Update follow-up tracking
    const nextAttempt = record.follow_up_attempt_count + 1;
    const nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase.from("acquisition_records").update({
      follow_up_attempt_count: nextAttempt,
      follow_up_next_at: nextAt,
      last_contacted_at: now,
    }).eq("id", record.id);

    processed++;
  }

  return jsonResponse({ processed, stopped, total: (records ?? []).length });
}

async function checkConditions(supabase: any, conditions: any[], ctx: Record<string, unknown>): Promise<boolean> {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
    const fieldValue = ctx.metadata?.[cond.field] ?? ctx[cond.field];
    switch (cond.operator) {
      case "equals": if (fieldValue !== cond.value) return false; break;
      case "not_equals": if (fieldValue === cond.value) return false; break;
      case "contains": if (!String(fieldValue ?? "").includes(String(cond.value))) return false; break;
      case "is_empty": if (fieldValue) return false; break;
      case "is_not_empty": if (!fieldValue) return false; break;
    }
  }
  return true;
}

async function executeAction(supabase: any, action: any, ctx: Record<string, unknown>) {
  const config = action.action_config ?? {};
  switch (action.action_type) {
    case "create_task": {
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("related_contact_id", ctx.metadata?.contact_id ?? null)
        .eq("title", config.title ?? "Automated task")
        .maybeSingle();
      if (!existing) {
        await supabase.from("tasks").insert({
          company_id: ctx.company_id,
          title: config.title ?? "Automated task",
          description: config.description ?? "",
          status: "open",
          priority: config.priority ?? "medium",
          related_contact_id: ctx.metadata?.contact_id ?? null,
          due_date: config.due_in_hours ? new Date(Date.now() + config.due_in_hours * 60 * 60 * 1000).toISOString() : null,
        });
      }
      break;
    }
    case "assign_user": {
      await supabase.from("acquisition_records").update({
        assigned_user_id: config.user_id ?? null,
      }).eq("id", ctx.record_id);
      await supabase.from("acquisition_assignment_history").insert({
        company_id: ctx.company_id,
        acquisition_record_id: ctx.record_id,
        from_user_id: null,
        to_user_id: config.user_id ?? null,
        changed_by: null,
        reason: "automation_assignment",
      });
      break;
    }
    case "update_stage": {
      await supabase.from("acquisition_records").update({
        pipeline_stage_id: config.stage_id,
        stage_entered_at: new Date().toISOString(),
      }).eq("id", ctx.record_id);
      await supabase.from("acquisition_stage_history").insert({
        company_id: ctx.company_id,
        acquisition_record_id: ctx.record_id,
        from_stage_id: null,
        to_stage_id: config.stage_id,
        changed_by: null,
        is_automated: true,
        reason: "automation_stage_change",
      });
      break;
    }
    case "update_field": {
      await supabase.from("acquisition_records").update({
        [config.field]: config.value,
      }).eq("id", ctx.record_id);
      break;
    }
    case "add_tag": {
      // Tags would be added to contact
      break;
    }
    case "add_internal_note": {
      await supabase.from("notes").insert({
        company_id: ctx.company_id,
        entity_type: "acquisition_record",
        entity_id: ctx.record_id,
        body: config.note ?? "",
        created_by: null,
      });
      break;
    }
    case "create_notification": {
      await createNotificationIdempotent(supabase, {
        company_id: ctx.company_id,
        user_id: config.user_id ?? null,
        type: config.notification_type ?? "automation_notification",
        title: config.title ?? "Automated notification",
        body: config.body ?? "",
        entity_type: "acquisition_record",
        entity_id: ctx.record_id,
        idempotency_key: `automation-${ctx.automation_id}-${ctx.record_id}-${config.notification_type ?? "notif"}`,
      });
      break;
    }
    case "queue_sms": {
      await queueMockEvent(supabase, {
        company_id: ctx.company_id,
        event_type: "queued_sms",
        entity_type: "acquisition_record",
        entity_id: ctx.record_id,
        metadata: { body: config.body ?? "", contact_id: ctx.metadata?.contact_id, simulated: true },
        idempotency_key: `automation-sms-${ctx.automation_id}-${ctx.record_id}-${Date.now()}`,
      });
      break;
    }
    case "queue_discord_notification": {
      await queueMockEvent(supabase, {
        company_id: ctx.company_id,
        event_type: "queued_discord",
        entity_type: "acquisition_record",
        entity_id: ctx.record_id,
        metadata: { message: config.message ?? "", simulated: true },
        idempotency_key: `automation-discord-${ctx.automation_id}-${ctx.record_id}-${Date.now()}`,
      });
      break;
    }
    case "stop_follow_up_sequence": {
      await supabase.from("acquisition_records").update({
        follow_up_active: false,
        follow_up_paused: true,
      }).eq("id", ctx.record_id);
      break;
    }
  }
}

async function createNotificationIdempotent(supabase: any, params: {
  company_id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
}) {
  if (!params.user_id) return;

  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", params.user_id)
    .eq("entity_id", params.entity_id)
    .eq("type", params.type)
    .maybeSingle();

  if (existing) return;

  await supabase.from("notifications").insert({
    company_id: params.company_id,
    user_id: params.user_id,
    type: params.type,
    title: params.title,
    body: params.body,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    is_read: false,
  });
}

async function queueMockEvent(supabase: any, params: {
  company_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  idempotency_key: string;
}) {
  const { data: existing } = await supabase
    .from("system_events")
    .select("id")
    .eq("entity_id", params.entity_id)
    .eq("event_type", params.event_type)
    .maybeSingle();

  if (existing) return;

  await supabase.from("system_events").insert({
    company_id: params.company_id,
    event_type: params.event_type,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    metadata: { ...params.metadata, idempotency_key: params.idempotency_key },
    severity: "info",
  });
}

async function seedDefaultAutomations(supabase: any, company_id: string) {
  const automations = [
    {
      name: "New Lead: Create Task + Notify + SMS + Discord",
      trigger_type: "lead_created",
      actions: [
        { action_type: "create_task", action_config: { title: "Contact new lead", priority: "high", due_in_hours: 24 }, sort_order: 1 },
        { action_type: "create_notification", action_config: { notification_type: "new_lead", title: "New lead assigned" }, sort_order: 2 },
        { action_type: "queue_sms", action_config: { body: "Hi, this is about your property." }, sort_order: 3 },
        { action_type: "queue_discord_notification", action_config: { message: "New lead created" }, sort_order: 4 },
      ],
    },
    {
      name: "Needs Offer: Director Review",
      trigger_type: "stage_changed",
      conditions: [{ field: "to_stage_id", operator: "equals", value: "needs_offer" }],
      actions: [
        { action_type: "create_notification", action_config: { notification_type: "needs_offer", title: "Director review needed" }, sort_order: 1 },
        { action_type: "create_task", action_config: { title: "Calculate offer", priority: "high", due_in_hours: 48 }, sort_order: 2 },
      ],
    },
    {
      name: "Needs Contract: Notify Director + TC",
      trigger_type: "stage_changed",
      conditions: [{ field: "to_stage_id", operator: "equals", value: "needs_contract" }],
      actions: [
        { action_type: "create_notification", action_config: { notification_type: "needs_contract", title: "Contract preparation needed" }, sort_order: 1 },
        { action_type: "create_task", action_config: { title: "Prepare contract", priority: "high", due_in_hours: 72 }, sort_order: 2 },
      ],
    },
    {
      name: "Call Answered: Stop Follow-Up",
      trigger_type: "call_answered",
      actions: [
        { action_type: "stop_follow_up_sequence", action_config: {}, sort_order: 1 },
      ],
    },
  ];

  let created = 0;
  for (const auto of automations) {
    const { data: existing } = await supabase
      .from("automations")
      .select("id")
      .eq("company_id", company_id)
      .eq("name", auto.name)
      .maybeSingle();

    if (existing) continue;

    const { data: autoRecord } = await supabase.from("automations").insert({
      company_id,
      name: auto.name,
      trigger_type: auto.trigger_type,
      trigger_config: {},
      is_active: true,
    }).select().single();

    if (autoRecord) {
      for (const cond of auto.conditions ?? []) {
        await supabase.from("automation_conditions").insert({
          automation_id: autoRecord.id,
          field: cond.field,
          operator: cond.operator,
          value: cond.value,
        });
      }
      for (const action of auto.actions) {
        await supabase.from("automation_actions").insert({
          automation_id: autoRecord.id,
          action_type: action.action_type,
          action_config: action.action_config,
          sort_order: action.sort_order,
        });
      }
      created++;
    }
  }

  return jsonResponse({ created, total: automations.length });
}

function idempotency_key(key: string): string {
  // Simple hash to fit in a text field if needed
  return key.slice(0, 255);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
