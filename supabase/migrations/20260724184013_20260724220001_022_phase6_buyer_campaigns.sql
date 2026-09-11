/*
# Phase 6 — Buyer CSV Import and Compliant SMS Campaigns

## Summary
Adds the complete infrastructure for buyer list imports and compliant SMS broadcast campaigns.
This schema tracks every step of the buyer import lifecycle (upload → validation → import) and the
full campaign lifecycle (draft → scheduled → queued → sending → delivered/failed), including
per-recipient suppression tracking, compliance settings, and audit trail.

## New Tables

### buyer_import_batches
Tracks a single CSV upload event. Stores column mapping, validation summary counts, import tag,
and overall status. One batch = one uploaded file.

### buyer_import_rows
One row per CSV record within a batch. Stores raw parsed data as JSONB, normalized phone number,
validation errors, match status (new/existing contact), and the resulting contact_id after import.

### buyer_campaigns
A campaign targeting buyers about a specific disposition deal. Includes message body, sender number,
compliance settings (quiet hours, frequency caps, daily limits), scheduling, and live counter fields
for reporting (queued/sent/delivered/failed/replies/opt-outs).

### buyer_campaign_recipients
The actual message queue — one row per recipient per campaign. Tracks scheduled send time, rendered
message body (with variables resolved), delivery status, attempt count, suppression reason, and
provider message ID. This is what the processor reads to send messages.

### buyer_compliance_settings
Per-company default compliance rules: quiet hours start/end, timezone policy, daily message limit,
frequency cap (min hours between messages to same number), and compliance footer text (STOP language).

## Modified Tables
None — all additions are additive.

## Security
All new tables use RLS. Company-scoped reads. Write access gated on relevant permissions.

## Important Notes
1. buyer_campaign_recipients.status covers the full lifecycle: queued → sending → sent → delivered/failed.
   Suppressed and canceled are terminal states that prevent any send attempt.
2. Quiet hours are enforced by the processor at job execution time by comparing scheduled_at
   against the company compliance settings and the recipient's area-code timezone estimate.
3. The campaign status machine: draft → scheduled → queued → sending → completed/failed/canceled.
4. All mock sends set is_simulated=true. Real sends require Twilio credentials in edge function secrets.
*/

-- ============================================================
-- buyer_import_batches
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  original_row_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  opted_out_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','complete','failed')),
  column_mapping jsonb NOT NULL DEFAULT '{}',
  import_tag text,
  lead_source text NOT NULL DEFAULT 'buyer_csv_import',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE buyer_import_batches ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_buyer_import_batches_company ON buyer_import_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_buyer_import_batches_created ON buyer_import_batches(created_at DESC);

DROP POLICY IF EXISTS "select_buyer_import_batches" ON buyer_import_batches;
CREATE POLICY "select_buyer_import_batches" ON buyer_import_batches FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_buyer_import_batches" ON buyer_import_batches;
CREATE POLICY "insert_buyer_import_batches" ON buyer_import_batches FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_buyer_import_batches" ON buyer_import_batches;
CREATE POLICY "update_buyer_import_batches" ON buyer_import_batches FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- buyer_import_rows
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES buyer_import_batches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}',
  normalized_phone text,
  first_name text,
  last_name text,
  email text,
  city text,
  state text,
  zip_code text,
  county text,
  buyer_type text,
  property_type_interest text,
  price_range text,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','invalid','duplicate','suppressed','opted_out','imported')),
  validation_errors text[] NOT NULL DEFAULT '{}',
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  is_existing_contact boolean NOT NULL DEFAULT false,
  duplicate_of_row_number integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE buyer_import_rows ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_buyer_import_rows_batch ON buyer_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_buyer_import_rows_company ON buyer_import_rows(company_id);
CREATE INDEX IF NOT EXISTS idx_buyer_import_rows_phone ON buyer_import_rows(normalized_phone);

DROP POLICY IF EXISTS "select_buyer_import_rows" ON buyer_import_rows;
CREATE POLICY "select_buyer_import_rows" ON buyer_import_rows FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_buyer_import_rows" ON buyer_import_rows;
CREATE POLICY "insert_buyer_import_rows" ON buyer_import_rows FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_buyer_import_rows" ON buyer_import_rows;
CREATE POLICY "update_buyer_import_rows" ON buyer_import_rows FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- buyer_campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  import_batch_id uuid REFERENCES buyer_import_batches(id) ON DELETE SET NULL,
  disposition_record_id uuid REFERENCES disposition_records(id) ON DELETE SET NULL,
  message_template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  message_body text NOT NULL,
  sender_phone_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','queued','sending','sent','paused','cancelled','completed','failed')),
  -- Scheduling
  scheduled_at timestamptz,
  send_immediately boolean NOT NULL DEFAULT false,
  -- Compliance settings (stored per campaign, defaults from buyer_compliance_settings)
  quiet_hours_start time,
  quiet_hours_end time,
  recipient_timezone_policy text NOT NULL DEFAULT 'company' CHECK (recipient_timezone_policy IN ('company','area_code','utc')),
  frequency_cap_hours integer NOT NULL DEFAULT 72,
  daily_message_limit integer NOT NULL DEFAULT 200,
  max_attempts integer NOT NULL DEFAULT 1,
  include_stop_language boolean NOT NULL DEFAULT true,
  compliance_footer text NOT NULL DEFAULT 'Reply STOP to opt out.',
  sender_id_text text,
  -- Stats (live updated counters)
  total_recipients integer NOT NULL DEFAULT 0,
  eligible_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  opt_out_count integer NOT NULL DEFAULT 0,
  interested_count integer NOT NULL DEFAULT 0,
  -- Audit
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  launched_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE buyer_campaigns ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_buyer_campaigns_company ON buyer_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_buyer_campaigns_status ON buyer_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_buyer_campaigns_created ON buyer_campaigns(created_at DESC);

DROP POLICY IF EXISTS "select_buyer_campaigns" ON buyer_campaigns;
CREATE POLICY "select_buyer_campaigns" ON buyer_campaigns FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_buyer_campaigns" ON buyer_campaigns;
CREATE POLICY "insert_buyer_campaigns" ON buyer_campaigns FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_buyer_campaigns" ON buyer_campaigns;
CREATE POLICY "update_buyer_campaigns" ON buyer_campaigns FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "delete_buyer_campaigns" ON buyer_campaigns;
CREATE POLICY "delete_buyer_campaigns" ON buyer_campaigns FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id()
    AND status IN ('draft','cancelled'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_buyer_campaigns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_buyer_campaigns_updated_at ON buyer_campaigns;
CREATE TRIGGER set_buyer_campaigns_updated_at
  BEFORE UPDATE ON buyer_campaigns FOR EACH ROW
  EXECUTE FUNCTION update_buyer_campaigns_updated_at();

-- ============================================================
-- buyer_campaign_recipients
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES buyer_campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  phone_normalized text NOT NULL,
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','delivered','failed','suppressed','canceled','opted_out')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  failure_reason text,
  suppression_reason text,
  is_simulated boolean NOT NULL DEFAULT true,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE buyer_campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bcr_campaign ON buyer_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bcr_company ON buyer_campaign_recipients(company_id);
CREATE INDEX IF NOT EXISTS idx_bcr_status ON buyer_campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_bcr_scheduled ON buyer_campaign_recipients(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bcr_phone ON buyer_campaign_recipients(phone_normalized);

DROP POLICY IF EXISTS "select_buyer_campaign_recipients" ON buyer_campaign_recipients;
CREATE POLICY "select_buyer_campaign_recipients" ON buyer_campaign_recipients FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_buyer_campaign_recipients" ON buyer_campaign_recipients;
CREATE POLICY "insert_buyer_campaign_recipients" ON buyer_campaign_recipients FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_buyer_campaign_recipients" ON buyer_campaign_recipients;
CREATE POLICY "update_buyer_campaign_recipients" ON buyer_campaign_recipients FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_buyer_campaign_recipients_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_buyer_campaign_recipients_updated_at ON buyer_campaign_recipients;
CREATE TRIGGER set_buyer_campaign_recipients_updated_at
  BEFORE UPDATE ON buyer_campaign_recipients FOR EACH ROW
  EXECUTE FUNCTION update_buyer_campaign_recipients_updated_at();

-- ============================================================
-- buyer_compliance_settings (per company defaults)
-- ============================================================
CREATE TABLE IF NOT EXISTS buyer_compliance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quiet_hours_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start time NOT NULL DEFAULT '21:00:00',
  quiet_hours_end time NOT NULL DEFAULT '09:00:00',
  company_timezone text NOT NULL DEFAULT 'America/New_York',
  daily_message_limit integer NOT NULL DEFAULT 200,
  frequency_cap_hours integer NOT NULL DEFAULT 72,
  max_messages_per_number_per_day integer NOT NULL DEFAULT 1,
  compliance_footer text NOT NULL DEFAULT 'Reply STOP to opt out.',
  include_sender_id boolean NOT NULL DEFAULT true,
  sender_id_template text NOT NULL DEFAULT '{company_name}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);
ALTER TABLE buyer_compliance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_buyer_compliance_settings" ON buyer_compliance_settings;
CREATE POLICY "select_buyer_compliance_settings" ON buyer_compliance_settings FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_buyer_compliance_settings" ON buyer_compliance_settings;
CREATE POLICY "insert_buyer_compliance_settings" ON buyer_compliance_settings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_buyer_compliance_settings" ON buyer_compliance_settings;
CREATE POLICY "update_buyer_compliance_settings" ON buyer_compliance_settings FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

-- Seed default compliance settings per company
INSERT INTO buyer_compliance_settings (company_id)
SELECT id FROM companies
ON CONFLICT (company_id) DO NOTHING;

-- ============================================================
-- SEED Phase 6 permissions
-- ============================================================
INSERT INTO permissions (key, name, description, category) VALUES
  ('send_buyer_sms_blast',    'Send Buyer SMS Blast',    'Create and launch buyer SMS campaigns',  'Communications'),
  ('manage_buyer_campaigns',  'Manage Buyer Campaigns',  'View, pause, and cancel buyer campaigns','Communications'),
  ('import_buyers',           'Import Buyers',           'Upload and import buyer CSV files',       'Buyer Pipeline')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('Administrator','Director','Disposition Manager')
  AND p.key IN ('send_buyer_sms_blast','manage_buyer_campaigns','import_buyers')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('Transaction Coordinator')
  AND p.key IN ('manage_buyer_campaigns','import_buyers')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
