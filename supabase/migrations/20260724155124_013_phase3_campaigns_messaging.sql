/*
# Phase 3 — Campaigns, Messaging, Conversations, Handoffs, Automations, Notifications

## Overview
Creates tables for SMS drip campaigns, mock messaging, conversations, acquisition handoffs,
the automation engine, and in-app notifications. Adds FK constraints linking
lead_records to lead_campaigns and acquisition_handoffs.

## New Tables
1. lead_campaigns — Campaign configuration (name, sender number, schedule, quiet hours, limits)
2. lead_campaign_members — Join table linking leads to campaigns with enrollment/sequence tracking
3. lead_sequence_steps — Ordered message steps within a campaign (template, delay, send window, stop conditions)
4. message_templates — Reusable SMS message templates with variables
5. messaging_jobs — Queue of scheduled messages (mock mode, status tracking, attempt counts)
6. conversations — Conversation threads per contact + phone number
7. conversation_participants — Users participating in a conversation
8. messages — Individual inbound/outbound messages with status and metadata
9. phone_numbers — Company-owned phone numbers (shared_acquisition_automation type)
10. communication_consents — Consent records per contact + channel + source
11. suppression_entries — Suppression list per contact with reason and source
12. acquisition_handoffs — Handoff records linking leads to the future acquisitions pipeline
13. automations — Automation definitions (trigger, conditions, actions, active status)
14. automation_conditions — Conditions for an automation to fire
15. automation_actions — Actions an automation performs
16. automation_runs — Execution log for automation runs
17. system_events — System-level events log
18. notifications — In-app notifications for users

## Security
- All tables RLS enabled, company-scoped SELECT.
- Writes gated by appropriate permissions (edit_lead_pipeline, create_lead_campaigns, etc.).
- notifications: owner-scoped (user_id = auth.uid()).
- phone_numbers: company-scoped SELECT, manage_branding for writes.

## Important Notes
1. messaging_jobs uses mock mode — is_simulated flag marks all messages as simulated.
2. acquisition_handoffs has a unique constraint on (lead_record_id, idempotency_key) to prevent duplicates.
3. phone_numbers supports the shared_acquisition_automation type.
4. conversations + messages will later be used by the full Conversations tab.
5. Automations support conditions and actions as flexible JSONB configs.
*/

-- ============================================================
-- PHONE_NUMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number text NOT NULL,
  number_type text NOT NULL DEFAULT 'shared_acquisition_automation' CHECK (number_type IN ('shared_acquisition_automation','personal','dedicated','twilio','mock')),
  label text,
  is_active boolean NOT NULL DEFAULT true,
  is_mock boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGE_TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  variables text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD_CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  lead_source text,
  sender_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  sending_schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  daily_message_limit integer NOT NULL DEFAULT 100,
  max_attempts integer NOT NULL DEFAULT 4,
  start_date timestamptz,
  end_date timestamptz,
  total_enrolled integer NOT NULL DEFAULT 0,
  total_messages_sent integer NOT NULL DEFAULT 0,
  total_responses integer NOT NULL DEFAULT 0,
  total_opt_outs integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lead_campaigns ENABLE ROW LEVEL SECURITY;

-- Add FK from lead_records.campaign_id to lead_campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lead_records_campaign_id_fkey' AND table_name = 'lead_records'
  ) THEN
    ALTER TABLE lead_records ADD CONSTRAINT lead_records_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES lead_campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add FK from seller_list_imports.campaign_id to lead_campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'seller_list_imports_campaign_id_fkey' AND table_name = 'seller_list_imports'
  ) THEN
    ALTER TABLE seller_list_imports ADD CONSTRAINT seller_list_imports_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES lead_campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- LEAD_SEQUENCE_STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES lead_campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_number integer NOT NULL DEFAULT 1,
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  message_body text,
  delay_after_previous_hours integer NOT NULL DEFAULT 0,
  send_window_start text NOT NULL DEFAULT '09:00',
  send_window_end text NOT NULL DEFAULT '20:00',
  stop_on_response boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lead_sequence_steps ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD_CAMPAIGN_MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES lead_campaigns(id) ON DELETE CASCADE,
  lead_record_id uuid NOT NULL REFERENCES lead_records(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','active','completed','stopped','removed','opted_out')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  current_step_number integer NOT NULL DEFAULT 0,
  sequence_started_at timestamptz,
  sequence_completed_at timestamptz,
  stopped_reason text,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_record_id)
);
ALTER TABLE lead_campaign_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email','call','internal')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONVERSATION_PARTICIPANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_record_id uuid REFERENCES lead_records(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES lead_campaigns(id) ON DELETE SET NULL,
  campaign_member_id uuid REFERENCES lead_campaign_members(id) ON DELETE SET NULL,
  sequence_step_id uuid REFERENCES lead_sequence_steps(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','delivered','failed','received','read')),
  is_simulated boolean NOT NULL DEFAULT false,
  is_automated boolean NOT NULL DEFAULT false,
  sender_number text,
  from_number text,
  to_number text,
  message_sid text,
  error_code text,
  error_message text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGING_JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS messaging_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES lead_campaigns(id) ON DELETE CASCADE,
  campaign_member_id uuid REFERENCES lead_campaign_members(id) ON DELETE CASCADE,
  sequence_step_id uuid REFERENCES lead_sequence_steps(id) ON DELETE SET NULL,
  lead_record_id uuid REFERENCES lead_records(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','sent','failed','canceled')),
  scheduled_at timestamptz NOT NULL,
  processed_at timestamptz,
  attempt_number integer NOT NULL DEFAULT 1,
  is_simulated boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messaging_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COMMUNICATION_CONSENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS communication_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','call','email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','denied','revoked')),
  source text,
  consent_date timestamptz,
  revoked_date timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE communication_consents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SUPPRESSION_ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS suppression_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('opted_out','do_not_call','do_not_text','invalid_phone','manual','compliance','frequency_limited')),
  source text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppression_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACQUISITION_HANDOFFS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_record_id uuid NOT NULL REFERENCES lead_records(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('seller_responded','assigned_to_acquisition_user','manual_management_handoff')),
  handoff_reason text,
  requested_acquisition_stage text NOT NULL DEFAULT 'new_lead',
  requested_priority text NOT NULL DEFAULT 'high',
  requested_assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source_campaign_id uuid REFERENCES lead_campaigns(id) ON DELETE SET NULL,
  source_import_batch_id uuid REFERENCES seller_list_imports(id) ON DELETE SET NULL,
  seller_response_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','canceled')),
  handoff_notes text,
  failure_reason text,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_record_id, idempotency_key)
);
ALTER TABLE acquisition_handoffs ENABLE ROW LEVEL SECURITY;

-- Add FK from lead_records.acquisition_handoff_id to acquisition_handoffs.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lead_records_acquisition_handoff_id_fkey' AND table_name = 'lead_records'
  ) THEN
    ALTER TABLE lead_records ADD CONSTRAINT lead_records_acquisition_handoff_id_fkey
      FOREIGN KEY (acquisition_handoff_id) REFERENCES acquisition_handoffs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('lead_stage_changed','lead_responded','lead_assigned','campaign_enrolled','message_received','scheduled','manual','import_completed','handoff_completed')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_CONDITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  field text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('equals','not_equals','contains','in','not_in','greater_than','less_than','is_null','is_not_null')),
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automation_conditions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_ACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('change_stage','change_priority','assign_user','assign_team','enroll_campaign','remove_from_campaign','send_message','create_task','create_handoff','stop_campaign_sequence','suppress_contact','notify','send_sms')),
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automation_actions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped')),
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SYSTEM_EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- PHONE_NUMBERS
DROP POLICY IF EXISTS "select_phone_numbers_own" ON phone_numbers;
CREATE POLICY "select_phone_numbers_own" ON phone_numbers FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_phone_numbers_perm" ON phone_numbers;
CREATE POLICY "insert_phone_numbers_perm" ON phone_numbers FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_branding'));

DROP POLICY IF EXISTS "update_phone_numbers_perm" ON phone_numbers;
CREATE POLICY "update_phone_numbers_perm" ON phone_numbers FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_branding'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_branding'));

DROP POLICY IF EXISTS "delete_phone_numbers_perm" ON phone_numbers;
CREATE POLICY "delete_phone_numbers_perm" ON phone_numbers FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_branding'));

-- MESSAGE_TEMPLATES
DROP POLICY IF EXISTS "select_message_templates_own" ON message_templates;
CREATE POLICY "select_message_templates_own" ON message_templates FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_message_templates_perm" ON message_templates;
CREATE POLICY "insert_message_templates_perm" ON message_templates FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_message_templates'));

DROP POLICY IF EXISTS "update_message_templates_perm" ON message_templates;
CREATE POLICY "update_message_templates_perm" ON message_templates FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_message_templates'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_message_templates'));

DROP POLICY IF EXISTS "delete_message_templates_perm" ON message_templates;
CREATE POLICY "delete_message_templates_perm" ON message_templates FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_message_templates'));

-- LEAD_CAMPAIGNS
DROP POLICY IF EXISTS "select_lead_campaigns_own" ON lead_campaigns;
CREATE POLICY "select_lead_campaigns_own" ON lead_campaigns FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lead_campaigns_perm" ON lead_campaigns;
CREATE POLICY "insert_lead_campaigns_perm" ON lead_campaigns FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('create_lead_campaigns'));

DROP POLICY IF EXISTS "update_lead_campaigns_perm" ON lead_campaigns;
CREATE POLICY "update_lead_campaigns_perm" ON lead_campaigns FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'));

DROP POLICY IF EXISTS "delete_lead_campaigns_perm" ON lead_campaigns;
CREATE POLICY "delete_lead_campaigns_perm" ON lead_campaigns FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'));

-- LEAD_SEQUENCE_STEPS
DROP POLICY IF EXISTS "select_lss_own" ON lead_sequence_steps;
CREATE POLICY "select_lss_own" ON lead_sequence_steps FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lss_perm" ON lead_sequence_steps;
CREATE POLICY "insert_lss_perm" ON lead_sequence_steps FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'));

DROP POLICY IF EXISTS "update_lss_perm" ON lead_sequence_steps;
CREATE POLICY "update_lss_perm" ON lead_sequence_steps FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'));

DROP POLICY IF EXISTS "delete_lss_perm" ON lead_sequence_steps;
CREATE POLICY "delete_lss_perm" ON lead_sequence_steps FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_campaigns'));

-- LEAD_CAMPAIGN_MEMBERS
DROP POLICY IF EXISTS "select_lcm_own" ON lead_campaign_members;
CREATE POLICY "select_lcm_own" ON lead_campaign_members FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lcm_perm" ON lead_campaign_members;
CREATE POLICY "insert_lcm_perm" ON lead_campaign_members FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "update_lcm_perm" ON lead_campaign_members;
CREATE POLICY "update_lcm_perm" ON lead_campaign_members FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "delete_lcm_perm" ON lead_campaign_members;
CREATE POLICY "delete_lcm_perm" ON lead_campaign_members FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

-- CONVERSATIONS
DROP POLICY IF EXISTS "select_conversations_own" ON conversations;
CREATE POLICY "select_conversations_own" ON conversations FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_conversations_perm" ON conversations;
CREATE POLICY "insert_conversations_perm" ON conversations FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_conversations_perm" ON conversations;
CREATE POLICY "update_conversations_perm" ON conversations FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- CONVERSATION_PARTICIPANTS
DROP POLICY IF EXISTS "select_conv_part_own" ON conversation_participants;
CREATE POLICY "select_conv_part_own" ON conversation_participants FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_participants.conversation_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_conv_part_perm" ON conversation_participants;
CREATE POLICY "insert_conv_part_perm" ON conversation_participants FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_participants.conversation_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "delete_conv_part_perm" ON conversation_participants;
CREATE POLICY "delete_conv_part_perm" ON conversation_participants FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_participants.conversation_id AND c.company_id = public.get_current_company_id())
  );

-- MESSAGES
DROP POLICY IF EXISTS "select_messages_own" ON messages;
CREATE POLICY "select_messages_own" ON messages FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_messages_perm" ON messages;
CREATE POLICY "insert_messages_perm" ON messages FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_messages_perm" ON messages;
CREATE POLICY "update_messages_perm" ON messages FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- MESSAGING_JOBS
DROP POLICY IF EXISTS "select_messaging_jobs_own" ON messaging_jobs;
CREATE POLICY "select_messaging_jobs_own" ON messaging_jobs FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_messaging_jobs_perm" ON messaging_jobs;
CREATE POLICY "insert_messaging_jobs_perm" ON messaging_jobs FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_messaging_jobs_perm" ON messaging_jobs;
CREATE POLICY "update_messaging_jobs_perm" ON messaging_jobs FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_messaging_jobs_perm" ON messaging_jobs;
CREATE POLICY "delete_messaging_jobs_perm" ON messaging_jobs FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id());

-- COMMUNICATION_CONSENTS
DROP POLICY IF EXISTS "select_consents_own" ON communication_consents;
CREATE POLICY "select_consents_own" ON communication_consents FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_consents_perm" ON communication_consents;
CREATE POLICY "insert_consents_perm" ON communication_consents FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_consents_perm" ON communication_consents;
CREATE POLICY "update_consents_perm" ON communication_consents FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- SUPPRESSION_ENTRIES
DROP POLICY IF EXISTS "select_suppression_own" ON suppression_entries;
CREATE POLICY "select_suppression_own" ON suppression_entries FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_suppression_perm" ON suppression_entries;
CREATE POLICY "insert_suppression_perm" ON suppression_entries FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('suppress_contacts'));

DROP POLICY IF EXISTS "update_suppression_perm" ON suppression_entries;
CREATE POLICY "update_suppression_perm" ON suppression_entries FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('suppress_contacts'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('suppress_contacts'));

DROP POLICY IF EXISTS "delete_suppression_perm" ON suppression_entries;
CREATE POLICY "delete_suppression_perm" ON suppression_entries FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('suppress_contacts'));

-- ACQUISITION_HANDOFFS
DROP POLICY IF EXISTS "select_handoffs_own" ON acquisition_handoffs;
CREATE POLICY "select_handoffs_own" ON acquisition_handoffs FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_handoffs_perm" ON acquisition_handoffs;
CREATE POLICY "insert_handoffs_perm" ON acquisition_handoffs FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('move_leads_to_acquisitions'));

DROP POLICY IF EXISTS "update_handoffs_perm" ON acquisition_handoffs;
CREATE POLICY "update_handoffs_perm" ON acquisition_handoffs FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('move_leads_to_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('move_leads_to_acquisitions'));

-- AUTOMATIONS
DROP POLICY IF EXISTS "select_automations_own" ON automations;
CREATE POLICY "select_automations_own" ON automations FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_automations_perm" ON automations;
CREATE POLICY "insert_automations_perm" ON automations FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "update_automations_perm" ON automations;
CREATE POLICY "update_automations_perm" ON automations FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "delete_automations_perm" ON automations;
CREATE POLICY "delete_automations_perm" ON automations FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

-- AUTOMATION_CONDITIONS
DROP POLICY IF EXISTS "select_auto_conds_own" ON automation_conditions;
CREATE POLICY "select_auto_conds_own" ON automation_conditions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_conditions.automation_id AND a.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_auto_conds_perm" ON automation_conditions;
CREATE POLICY "insert_auto_conds_perm" ON automation_conditions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_conditions.automation_id AND a.company_id = public.get_current_company_id())
    AND public.has_permission('edit_lead_pipeline')
  );

DROP POLICY IF EXISTS "delete_auto_conds_perm" ON automation_conditions;
CREATE POLICY "delete_auto_conds_perm" ON automation_conditions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_conditions.automation_id AND a.company_id = public.get_current_company_id())
    AND public.has_permission('edit_lead_pipeline')
  );

-- AUTOMATION_ACTIONS
DROP POLICY IF EXISTS "select_auto_actions_own" ON automation_actions;
CREATE POLICY "select_auto_actions_own" ON automation_actions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_actions.automation_id AND a.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_auto_actions_perm" ON automation_actions;
CREATE POLICY "insert_auto_actions_perm" ON automation_actions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_actions.automation_id AND a.company_id = public.get_current_company_id())
    AND public.has_permission('edit_lead_pipeline')
  );

DROP POLICY IF EXISTS "delete_auto_actions_perm" ON automation_actions;
CREATE POLICY "delete_auto_actions_perm" ON automation_actions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_actions.automation_id AND a.company_id = public.get_current_company_id())
    AND public.has_permission('edit_lead_pipeline')
  );

-- AUTOMATION_RUNS
DROP POLICY IF EXISTS "select_auto_runs_own" ON automation_runs;
CREATE POLICY "select_auto_runs_own" ON automation_runs FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_auto_runs_perm" ON automation_runs;
CREATE POLICY "insert_auto_runs_perm" ON automation_runs FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_auto_runs_perm" ON automation_runs;
CREATE POLICY "update_auto_runs_perm" ON automation_runs FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- SYSTEM_EVENTS
DROP POLICY IF EXISTS "select_system_events_own" ON system_events;
CREATE POLICY "select_system_events_own" ON system_events FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_system_events_perm" ON system_events;
CREATE POLICY "insert_system_events_perm" ON system_events FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

-- NOTIFICATIONS (owner-scoped)
DROP POLICY IF EXISTS "select_notifications_own" ON notifications;
CREATE POLICY "select_notifications_own" ON notifications FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "insert_notifications_perm" ON notifications;
CREATE POLICY "insert_notifications_perm" ON notifications FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_notifications_own" ON notifications;
CREATE POLICY "update_notifications_own" ON notifications FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_notifications_own" ON notifications;
CREATE POLICY "delete_notifications_own" ON notifications FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_phone_numbers_company ON phone_numbers(company_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_company ON message_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_campaigns_company ON lead_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_campaigns_status ON lead_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_lss_campaign ON lead_sequence_steps(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lcm_campaign ON lead_campaign_members(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lcm_lead ON lead_campaign_members(lead_record_id);
CREATE INDEX IF NOT EXISTS idx_lcm_status ON lead_campaign_members(status);
CREATE INDEX IF NOT EXISTS idx_conversations_company ON conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_record_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messaging_jobs_company ON messaging_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_messaging_jobs_status ON messaging_jobs(status);
CREATE INDEX IF NOT EXISTS idx_messaging_jobs_scheduled ON messaging_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messaging_jobs_campaign ON messaging_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_consents_contact ON communication_consents(contact_id);
CREATE INDEX IF NOT EXISTS idx_suppression_contact ON suppression_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_suppression_active ON suppression_entries(is_active);
CREATE INDEX IF NOT EXISTS idx_handoffs_company ON acquisition_handoffs(company_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_lead ON acquisition_handoffs(lead_record_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON acquisition_handoffs(status);
CREATE INDEX IF NOT EXISTS idx_automations_company ON automations(company_id);
CREATE INDEX IF NOT EXISTS idx_auto_runs_automation ON automation_runs(automation_id);
CREATE INDEX IF NOT EXISTS idx_system_events_company ON system_events(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at_phone_numbers ON phone_numbers;
CREATE TRIGGER set_updated_at_phone_numbers BEFORE UPDATE ON phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_message_templates ON message_templates;
CREATE TRIGGER set_updated_at_message_templates BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lead_campaigns ON lead_campaigns;
CREATE TRIGGER set_updated_at_lead_campaigns BEFORE UPDATE ON lead_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lss ON lead_sequence_steps;
CREATE TRIGGER set_updated_at_lss BEFORE UPDATE ON lead_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lcm ON lead_campaign_members;
CREATE TRIGGER set_updated_at_lcm BEFORE UPDATE ON lead_campaign_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_conversations ON conversations;
CREATE TRIGGER set_updated_at_conversations BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_messaging_jobs ON messaging_jobs;
CREATE TRIGGER set_updated_at_messaging_jobs BEFORE UPDATE ON messaging_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_handoffs ON acquisition_handoffs;
CREATE TRIGGER set_updated_at_handoffs BEFORE UPDATE ON acquisition_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_automations ON automations;
CREATE TRIGGER set_updated_at_automations BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();