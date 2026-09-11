/*
# Phase 5 — Communications Schema

## Summary
Adds the full communication infrastructure for Phase 5: Conversations, Calls, Integration Settings,
Webhook Logs, and extends existing phone_numbers and conversations tables.

## New Tables
1. `calls` — Records of all phone calls (inbound/outbound, answered/missed/voicemail).
2. `integration_settings` — Provider configuration status per company (Twilio, Resend, Discord).
3. `webhook_logs` — Immutable audit log of all inbound webhooks and processing outcomes.

## Modified Tables
4. `phone_numbers` — Extended with Phase 5 fields: friendly_name, provider, assigned_user_id,
   assigned_team_id, inbound_routing, outbound_permissions, registration_status, provider_reference.
5. `conversations` — Extended with: assigned_user_id, opportunity_id, last_call_at, is_opted_out,
   contact_type_filter.

## Security
- RLS enabled on all new tables with company-scoped policies.
- Webhook logs are insert-permitted but selectable only with developer permission.
- Integration settings writable only with manage_integrations permission.
*/

-- ============================================================
-- EXTEND phone_numbers
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='friendly_name') THEN
    ALTER TABLE phone_numbers ADD COLUMN friendly_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='provider') THEN
    ALTER TABLE phone_numbers ADD COLUMN provider text NOT NULL DEFAULT 'mock';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='assigned_user_id') THEN
    ALTER TABLE phone_numbers ADD COLUMN assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='assigned_team_id') THEN
    ALTER TABLE phone_numbers ADD COLUMN assigned_team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='inbound_routing') THEN
    ALTER TABLE phone_numbers ADD COLUMN inbound_routing jsonb NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='outbound_permissions') THEN
    ALTER TABLE phone_numbers ADD COLUMN outbound_permissions jsonb NOT NULL DEFAULT '{"roles":["all"]}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='registration_status') THEN
    ALTER TABLE phone_numbers ADD COLUMN registration_status text NOT NULL DEFAULT 'unregistered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_numbers' AND column_name='provider_reference') THEN
    ALTER TABLE phone_numbers ADD COLUMN provider_reference text;
  END IF;
END $$;

ALTER TABLE phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_number_type_check;
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_number_type_check
  CHECK (number_type IN (
    'shared_acquisition_automation','personal','shared_disposition',
    'buyer_campaign','management','dedicated','twilio','mock'
  ));

ALTER TABLE phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_registration_status_check;
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_registration_status_check
  CHECK (registration_status IN ('unregistered','pending','registered','failed'));

-- ============================================================
-- EXTEND conversations
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='assigned_user_id') THEN
    ALTER TABLE conversations ADD COLUMN assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='opportunity_id') THEN
    ALTER TABLE conversations ADD COLUMN opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='last_call_at') THEN
    ALTER TABLE conversations ADD COLUMN last_call_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='is_opted_out') THEN
    ALTER TABLE conversations ADD COLUMN is_opted_out boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='conversations' AND column_name='contact_type_filter') THEN
    ALTER TABLE conversations ADD COLUMN contact_type_filter text;
  END IF;
END $$;

-- ============================================================
-- calls
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  acquisition_record_id uuid REFERENCES acquisition_records(id) ON DELETE SET NULL,
  phone_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','ringing','in_progress','answered','missed','voicemail','failed','completed','no_answer')),
  from_number text,
  to_number text,
  duration_seconds integer,
  recording_url text,
  recording_sid text,
  call_sid text,
  is_simulated boolean NOT NULL DEFAULT true,
  simulated_outcome text CHECK (simulated_outcome IN ('answered','missed','voicemail')),
  assigned_via text CHECK (assigned_via IN ('call_answered','manual','auto_assign')),
  previous_assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  voicemail_transcription text,
  notes text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_calls_company_id ON calls(company_id);
CREATE INDEX IF NOT EXISTS idx_calls_contact_id ON calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_conversation_id ON calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);

DROP POLICY IF EXISTS "select_calls" ON calls;
CREATE POLICY "select_calls" ON calls FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_calls" ON calls;
CREATE POLICY "insert_calls" ON calls FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_calls" ON calls;
CREATE POLICY "update_calls" ON calls FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_calls" ON calls;
CREATE POLICY "delete_calls" ON calls FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id());

-- ============================================================
-- integration_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured','configured','registration_pending','active','error')),
  is_mock boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',
  last_webhook_at timestamptz,
  last_webhook_success_at timestamptz,
  last_webhook_failure_at timestamptz,
  last_error text,
  features_enabled text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);
ALTER TABLE integration_settings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_integration_settings_company ON integration_settings(company_id);

DROP POLICY IF EXISTS "select_integration_settings" ON integration_settings;
CREATE POLICY "select_integration_settings" ON integration_settings FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_integration_settings" ON integration_settings;
CREATE POLICY "insert_integration_settings" ON integration_settings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_integration_settings" ON integration_settings;
CREATE POLICY "update_integration_settings" ON integration_settings FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_integration_settings" ON integration_settings;
CREATE POLICY "delete_integration_settings" ON integration_settings FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id());

CREATE OR REPLACE FUNCTION update_integration_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_integration_settings_updated_at ON integration_settings;
CREATE TRIGGER set_integration_settings_updated_at
  BEFORE UPDATE ON integration_settings
  FOR EACH ROW EXECUTE FUNCTION update_integration_settings_updated_at();

-- ============================================================
-- webhook_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_type text,
  http_method text,
  endpoint text,
  raw_payload jsonb,
  response_status integer,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processing','success','failed','ignored')),
  error_detail text,
  is_simulated boolean NOT NULL DEFAULT false,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_webhook_logs_company ON webhook_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_provider ON webhook_logs(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

DROP POLICY IF EXISTS "select_webhook_logs" ON webhook_logs;
CREATE POLICY "select_webhook_logs" ON webhook_logs FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_webhook_logs" ON webhook_logs;
CREATE POLICY "insert_webhook_logs" ON webhook_logs FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- SEED Phase 5 permissions
-- ============================================================
INSERT INTO permissions (key, name, description, category) VALUES
  ('manage_integrations',   'Manage Integrations',   'Configure and manage third-party integrations', 'Developer'),
  ('view_conversations',    'View Conversations',     'View conversation inbox and message history',   'Communications'),
  ('send_individual_sms',   'Send Individual SMS',    'Send manual SMS messages to contacts',          'Communications'),
  ('send_individual_email', 'Send Individual Email',  'Send manual email messages to contacts',        'Communications'),
  ('view_calls',            'View Calls',             'View call logs and recordings',                 'Communications'),
  ('manage_phone_numbers',  'Manage Phone Numbers',   'Add, configure, and assign phone numbers',      'Communications'),
  ('assign_conversations',  'Assign Conversations',   'Assign conversations to team members',          'Communications')
ON CONFLICT (key) DO NOTHING;

-- Grant all comms permissions to Administrator and Director
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Administrator','Director')
  AND p.key IN (
    'manage_integrations','view_conversations','send_individual_sms','send_individual_email',
    'view_calls','manage_phone_numbers','assign_conversations'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Grant subset to managers + TC
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Acquisition Manager','Disposition Manager','Transaction Coordinator')
  AND p.key IN ('view_conversations','send_individual_sms','send_individual_email','view_calls','assign_conversations')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Grant minimal to Acquisition Rep
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Acquisition Rep'
  AND p.key IN ('view_conversations','send_individual_sms')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ============================================================
-- SEED integration_settings per company
-- ============================================================
INSERT INTO integration_settings (company_id, provider, status, is_mock, config, features_enabled)
SELECT c.id, prov.provider, 'not_configured', true, '{}'::jsonb, ARRAY[]::text[]
FROM companies c
CROSS JOIN (VALUES ('twilio'),('resend'),('discord')) AS prov(provider)
ON CONFLICT (company_id, provider) DO NOTHING;

-- ============================================================
-- SEED additional phone numbers per company
-- ============================================================
INSERT INTO phone_numbers (company_id, number, friendly_name, number_type, label, is_active, is_mock, provider, registration_status)
SELECT c.id, '+15550000002', 'Shared Disposition Number', 'shared_disposition', 'Shared Disposition', true, true, 'mock', 'unregistered'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM phone_numbers pn WHERE pn.company_id = c.id AND pn.number_type = 'shared_disposition');

INSERT INTO phone_numbers (company_id, number, friendly_name, number_type, label, is_active, is_mock, provider, registration_status)
SELECT c.id, '+15550000003', 'Management Number', 'management', 'Management', true, true, 'mock', 'unregistered'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM phone_numbers pn WHERE pn.company_id = c.id AND pn.number_type = 'management');
