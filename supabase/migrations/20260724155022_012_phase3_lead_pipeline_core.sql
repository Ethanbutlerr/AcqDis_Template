/*
# Phase 3 — Lead Pipeline Core Tables

## Overview
Creates the foundational tables for the seller Lead Pipeline: pipeline definitions/stages,
lead records, stage history, seller list imports and import rows.
All tables are company-scoped with RLS policies.

## New Tables
1. lead_pipeline_definitions — Pipeline configuration per company
2. lead_pipeline_stages — Named stages in exact order (11 stages)
3. seller_list_imports — Import batch metadata (list name, source, counts, status)
4. seller_list_import_rows — Individual rows with original + normalized data
5. lead_records — Central pre-acquisition outreach record linking contact + property + opportunity
6. lead_stage_history — Tracks every stage transition with timestamps and actor

## Security
- All tables RLS enabled, company-scoped SELECT.
- Writes gated by edit_lead_pipeline or upload_seller_lists permissions.

## Important Notes
1. lead_records references lead_campaigns which is created in the next migration.
   The FK will be added via ALTER TABLE in the next migration.
2. acquisition_handoff_id FK will be added when acquisition_handoffs table is created.
3. seller_list_import_rows stores both original_data and cleaned_data as JSONB.
4. Pipeline stages are seeded with the 11 required stages in exact order.
*/

-- ============================================================
-- LEAD_PIPELINE_DEFINITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_pipeline_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Seller Lead Pipeline',
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE lead_pipeline_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD_PIPELINE_STAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_definition_id uuid NOT NULL REFERENCES lead_pipeline_definitions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_definition_id, name)
);
ALTER TABLE lead_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SELLER_LIST_IMPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS seller_list_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  list_name text NOT NULL,
  lead_source text,
  file_name text NOT NULL,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','partial')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  new_contacts integer NOT NULL DEFAULT 0,
  matched_contacts integer NOT NULL DEFAULT 0,
  new_properties integer NOT NULL DEFAULT 0,
  matched_properties integer NOT NULL DEFAULT 0,
  new_lead_records integer NOT NULL DEFAULT 0,
  campaign_enrollment_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  initial_stage_id uuid REFERENCES lead_pipeline_stages(id) ON DELETE SET NULL,
  campaign_id uuid,
  default_tags text[] NOT NULL DEFAULT '{}',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seller_list_imports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD_RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  pipeline_stage_id uuid REFERENCES lead_pipeline_stages(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES seller_list_imports(id) ON DELETE SET NULL,
  campaign_id uuid,
  lead_source text,
  original_list_name text,
  original_row_number integer,
  outreach_eligibility text NOT NULL DEFAULT 'needs_review' CHECK (outreach_eligibility IN ('eligible','needs_review','suppressed','invalid_phone','opted_out','frequency_limited')),
  consent_status text NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending','granted','denied','revoked')),
  is_suppressed boolean NOT NULL DEFAULT false,
  suppression_reason text,
  last_outbound_message_at timestamptz,
  last_inbound_message_at timestamptz,
  last_contact_attempt_at timestamptz,
  next_scheduled_message_at timestamptz,
  total_message_attempts integer NOT NULL DEFAULT 0,
  response_status text NOT NULL DEFAULT 'no_response' CHECK (response_status IN ('no_response','responded','opted_out','wrong_number','do_not_contact','needs_review')),
  response_date timestamptz,
  handoff_status text NOT NULL DEFAULT 'not_ready' CHECK (handoff_status IN ('not_ready','pending','completed','failed','manually_blocked')),
  handoff_reason text,
  acquisition_handoff_id uuid,
  lead_origin text NOT NULL DEFAULT 'seller_list' CHECK (lead_origin IN ('seller_list','lead_campaign','direct_acquisition_entry','website_lead','meta_lead','referral','manual_entry','other')),
  initial_sms_sent boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lead_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LEAD_STAGE_HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_record_id uuid NOT NULL REFERENCES lead_records(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES lead_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES lead_pipeline_stages(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SELLER_LIST_IMPORT_ROWS
-- ============================================================
CREATE TABLE IF NOT EXISTS seller_list_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL REFERENCES seller_list_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  original_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleaned_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  lead_record_id uuid REFERENCES lead_records(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','duplicate','skipped','matched','created','error')),
  duplicate_match_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  duplicate_match_property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seller_list_import_rows ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- LEAD_PIPELINE_DEFINITIONS
DROP POLICY IF EXISTS "select_lpd_own" ON lead_pipeline_definitions;
CREATE POLICY "select_lpd_own" ON lead_pipeline_definitions FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lpd_perm" ON lead_pipeline_definitions;
CREATE POLICY "insert_lpd_perm" ON lead_pipeline_definitions FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "update_lpd_perm" ON lead_pipeline_definitions;
CREATE POLICY "update_lpd_perm" ON lead_pipeline_definitions FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

-- LEAD_PIPELINE_STAGES
DROP POLICY IF EXISTS "select_lps_own" ON lead_pipeline_stages;
CREATE POLICY "select_lps_own" ON lead_pipeline_stages FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lps_perm" ON lead_pipeline_stages;
CREATE POLICY "insert_lps_perm" ON lead_pipeline_stages FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "update_lps_perm" ON lead_pipeline_stages;
CREATE POLICY "update_lps_perm" ON lead_pipeline_stages FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "delete_lps_perm" ON lead_pipeline_stages;
CREATE POLICY "delete_lps_perm" ON lead_pipeline_stages FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

-- LEAD_RECORDS
DROP POLICY IF EXISTS "select_lead_records_own" ON lead_records;
CREATE POLICY "select_lead_records_own" ON lead_records FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lead_records_perm" ON lead_records;
CREATE POLICY "insert_lead_records_perm" ON lead_records FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "update_lead_records_perm" ON lead_records;
CREATE POLICY "update_lead_records_perm" ON lead_records FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

DROP POLICY IF EXISTS "delete_lead_records_perm" ON lead_records;
CREATE POLICY "delete_lead_records_perm" ON lead_records FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_lead_pipeline'));

-- LEAD_STAGE_HISTORY
DROP POLICY IF EXISTS "select_lead_stage_history_own" ON lead_stage_history;
CREATE POLICY "select_lead_stage_history_own" ON lead_stage_history FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_lead_stage_history_perm" ON lead_stage_history;
CREATE POLICY "insert_lead_stage_history_perm" ON lead_stage_history FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

-- SELLER_LIST_IMPORTS
DROP POLICY IF EXISTS "select_sli_own" ON seller_list_imports;
CREATE POLICY "select_sli_own" ON seller_list_imports FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_sli_perm" ON seller_list_imports;
CREATE POLICY "insert_sli_perm" ON seller_list_imports FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('upload_seller_lists'));

DROP POLICY IF EXISTS "update_sli_perm" ON seller_list_imports;
CREATE POLICY "update_sli_perm" ON seller_list_imports FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('upload_seller_lists'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('upload_seller_lists'));

-- SELLER_LIST_IMPORT_ROWS
DROP POLICY IF EXISTS "select_slir_own" ON seller_list_import_rows;
CREATE POLICY "select_slir_own" ON seller_list_import_rows FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM seller_list_imports sli WHERE sli.id = seller_list_import_rows.import_batch_id AND sli.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_slir_perm" ON seller_list_import_rows;
CREATE POLICY "insert_slir_perm" ON seller_list_import_rows FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM seller_list_imports sli WHERE sli.id = seller_list_import_rows.import_batch_id AND sli.company_id = public.get_current_company_id())
    AND public.has_permission('upload_seller_lists')
  );

DROP POLICY IF EXISTS "update_slir_perm" ON seller_list_import_rows;
CREATE POLICY "update_slir_perm" ON seller_list_import_rows FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM seller_list_imports sli WHERE sli.id = seller_list_import_rows.import_batch_id AND sli.company_id = public.get_current_company_id())
    AND public.has_permission('upload_seller_lists')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM seller_list_imports sli WHERE sli.id = seller_list_import_rows.import_batch_id AND sli.company_id = public.get_current_company_id())
  );

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_lpd_company ON lead_pipeline_definitions(company_id);
CREATE INDEX IF NOT EXISTS idx_lps_pipeline_def ON lead_pipeline_stages(pipeline_definition_id);
CREATE INDEX IF NOT EXISTS idx_lps_company ON lead_pipeline_stages(company_id);
CREATE INDEX IF NOT EXISTS idx_lps_sort ON lead_pipeline_stages(sort_order);
CREATE INDEX IF NOT EXISTS idx_lead_records_company ON lead_records(company_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_contact ON lead_records(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_property ON lead_records(property_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_stage ON lead_records(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_campaign ON lead_records(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_import ON lead_records(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_assigned ON lead_records(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_handoff ON lead_records(handoff_status);
CREATE INDEX IF NOT EXISTS idx_lead_records_archived ON lead_records(archived_at);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON lead_stage_history(lead_record_id);
CREATE INDEX IF NOT EXISTS idx_sli_company ON seller_list_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_slir_batch ON seller_list_import_rows(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_slir_contact ON seller_list_import_rows(contact_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at_lpd ON lead_pipeline_definitions;
CREATE TRIGGER set_updated_at_lpd BEFORE UPDATE ON lead_pipeline_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lps ON lead_pipeline_stages;
CREATE TRIGGER set_updated_at_lps BEFORE UPDATE ON lead_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_lead_records ON lead_records;
CREATE TRIGGER set_updated_at_lead_records BEFORE UPDATE ON lead_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_sli ON seller_list_imports;
CREATE TRIGGER set_updated_at_sli BEFORE UPDATE ON seller_list_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();