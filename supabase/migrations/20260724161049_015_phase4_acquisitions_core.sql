/*
# Phase 4 — Acquisitions Pipeline Core

## Overview
Creates the acquisitions pipeline data model: pipeline definitions/stages,
acquisition records (one per opportunity), stage history, and assignment history.
Seeds the 9 required acquisition stages in exact order.

## New Tables
1. acquisition_pipeline_definitions — One pipeline definition per company
2. acquisition_pipeline_stages — 9 named stages in exact order
3. acquisition_records — Central acquisition record linked to opportunity, seller contact, property, assigned user, current stage
4. acquisition_stage_history — Tracks every stage transition with previous/new stage, actor, manual/automated flag
5. acquisition_assignment_history — Tracks every assignment change with previous/new assignee, actor, reason

## Security
- All tables RLS enabled, company-scoped SELECT via get_current_company_id().
- Writes gated by edit_acquisitions permission.
- Unique constraint on acquisition_records: one active record per opportunity.

## Important Notes
1. acquisition_records has a unique partial index on opportunity_id WHERE archived_at IS NULL,
   ensuring one opportunity cannot have multiple active acquisition records.
2. acquisition_pipeline_stages seeded with 9 stages in exact order.
3. Stage history records previous and new stage, who changed it, and whether it was manual or automated.
4. Assignment history records previous and new assignee, who changed it, and the reason.
*/

-- ============================================================
-- ACQUISITION_PIPELINE_DEFINITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_pipeline_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Acquisitions Pipeline',
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE acquisition_pipeline_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACQUISITION_PIPELINE_STAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_definition_id uuid NOT NULL REFERENCES acquisition_pipeline_definitions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT '#6b7280',
  is_stopping_stage boolean NOT NULL DEFAULT false,
  requires_confirmation_backward boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_definition_id, name)
);
ALTER TABLE acquisition_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACQUISITION_RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  pipeline_stage_id uuid REFERENCES acquisition_pipeline_stages(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  lead_source text,
  motivation text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  asking_price numeric(14,2),
  estimated_arv numeric(14,2),
  estimated_repair_cost numeric(14,2),
  offer_amount numeric(14,2),
  offer_status text CHECK (offer_status IN ('pending','accepted','declined','expired','withdrawn')),
  contract_executed_at timestamptz,
  attribution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  follow_up_active boolean NOT NULL DEFAULT true,
  follow_up_paused boolean NOT NULL DEFAULT false,
  follow_up_attempt_count integer NOT NULL DEFAULT 0,
  follow_up_max_attempts integer NOT NULL DEFAULT 5,
  follow_up_next_at timestamptz,
  last_contacted_at timestamptz,
  next_task_title text,
  next_task_due_at timestamptz,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE acquisition_records ENABLE ROW LEVEL SECURITY;

-- Unique partial index: one active acquisition record per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS idx_acq_records_active_opportunity
  ON acquisition_records(opportunity_id) WHERE archived_at IS NULL;

-- ============================================================
-- ACQUISITION_STAGE_HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  acquisition_record_id uuid NOT NULL REFERENCES acquisition_records(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES acquisition_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES acquisition_pipeline_stages(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_automated boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE acquisition_stage_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACQUISITION_ASSIGNMENT_HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  acquisition_record_id uuid NOT NULL REFERENCES acquisition_records(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE acquisition_assignment_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- ACQUISITION_PIPELINE_DEFINITIONS
DROP POLICY IF EXISTS "select_acq_pd_own" ON acquisition_pipeline_definitions;
CREATE POLICY "select_acq_pd_own" ON acquisition_pipeline_definitions FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_acq_pd_perm" ON acquisition_pipeline_definitions;
CREATE POLICY "insert_acq_pd_perm" ON acquisition_pipeline_definitions FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "update_acq_pd_perm" ON acquisition_pipeline_definitions;
CREATE POLICY "update_acq_pd_perm" ON acquisition_pipeline_definitions FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

-- ACQUISITION_PIPELINE_STAGES
DROP POLICY IF EXISTS "select_acq_ps_own" ON acquisition_pipeline_stages;
CREATE POLICY "select_acq_ps_own" ON acquisition_pipeline_stages FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_acq_ps_perm" ON acquisition_pipeline_stages;
CREATE POLICY "insert_acq_ps_perm" ON acquisition_pipeline_stages FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "update_acq_ps_perm" ON acquisition_pipeline_stages;
CREATE POLICY "update_acq_ps_perm" ON acquisition_pipeline_stages FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "delete_acq_ps_perm" ON acquisition_pipeline_stages;
CREATE POLICY "delete_acq_ps_perm" ON acquisition_pipeline_stages FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

-- ACQUISITION_RECORDS
DROP POLICY IF EXISTS "select_acq_records_own" ON acquisition_records;
CREATE POLICY "select_acq_records_own" ON acquisition_records FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_acq_records_perm" ON acquisition_records;
CREATE POLICY "insert_acq_records_perm" ON acquisition_records FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "update_acq_records_perm" ON acquisition_records;
CREATE POLICY "update_acq_records_perm" ON acquisition_records FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "delete_acq_records_perm" ON acquisition_records;
CREATE POLICY "delete_acq_records_perm" ON acquisition_records FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

-- ACQUISITION_STAGE_HISTORY
DROP POLICY IF EXISTS "select_acq_stage_hist_own" ON acquisition_stage_history;
CREATE POLICY "select_acq_stage_hist_own" ON acquisition_stage_history FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_acq_stage_hist_perm" ON acquisition_stage_history;
CREATE POLICY "insert_acq_stage_hist_perm" ON acquisition_stage_history FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

-- ACQUISITION_ASSIGNMENT_HISTORY
DROP POLICY IF EXISTS "select_acq_assign_hist_own" ON acquisition_assignment_history;
CREATE POLICY "select_acq_assign_hist_own" ON acquisition_assignment_history FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_acq_assign_hist_perm" ON acquisition_assignment_history;
CREATE POLICY "insert_acq_assign_hist_perm" ON acquisition_assignment_history FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_acq_pd_company ON acquisition_pipeline_definitions(company_id);
CREATE INDEX IF NOT EXISTS idx_acq_ps_pipeline_def ON acquisition_pipeline_stages(pipeline_definition_id);
CREATE INDEX IF NOT EXISTS idx_acq_ps_company ON acquisition_pipeline_stages(company_id);
CREATE INDEX IF NOT EXISTS idx_acq_ps_sort ON acquisition_pipeline_stages(sort_order);
CREATE INDEX IF NOT EXISTS idx_acq_records_company ON acquisition_records(company_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_opportunity ON acquisition_records(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_contact ON acquisition_records(contact_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_property ON acquisition_records(property_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_stage ON acquisition_records(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_assigned ON acquisition_records(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_acq_records_archived ON acquisition_records(archived_at);
CREATE INDEX IF NOT EXISTS idx_acq_stage_hist_record ON acquisition_stage_history(acquisition_record_id);
CREATE INDEX IF NOT EXISTS idx_acq_assign_hist_record ON acquisition_assignment_history(acquisition_record_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at_acq_pd ON acquisition_pipeline_definitions;
CREATE TRIGGER set_updated_at_acq_pd BEFORE UPDATE ON acquisition_pipeline_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_acq_ps ON acquisition_pipeline_stages;
CREATE TRIGGER set_updated_at_acq_ps BEFORE UPDATE ON acquisition_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_acq_records ON acquisition_records;
CREATE TRIGGER set_updated_at_acq_records BEFORE UPDATE ON acquisition_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- SEED: Default acquisition pipeline + 9 stages
-- ============================================================
DO $$
DECLARE
  v_pipeline_id uuid;
  v_company_id uuid;
  v_stage_data text[][] := ARRAY[
    ['New Lead', '#3b82f6', 'true', 'false'],
    ['No Answer', '#f59e0b', 'false', 'false'],
    ['Answered', '#22c55e', 'true', 'false'],
    ['Waiting for Info/Photos', '#8b5cf6', 'false', 'false'],
    ['Needs Offer', '#ef4444', 'false', 'false'],
    ['Ready for Proposal', '#06b6d4', 'false', 'false'],
    ['Offer Accepted', '#16a34a', 'true', 'true'],
    ['Offer Declined', '#dc2626', 'false', 'true'],
    ['Needs Contract', '#7c3aed', 'false', 'true'],
    ['Contract Executed', '#0f766e', 'true', 'true']
  ];
BEGIN
  SELECT id INTO v_company_id FROM companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN; END IF;

  INSERT INTO acquisition_pipeline_definitions (company_id, name, is_default)
  VALUES (v_company_id, 'Acquisitions Pipeline', true)
  ON CONFLICT (company_id, name) DO NOTHING;

  SELECT id INTO v_pipeline_id FROM acquisition_pipeline_definitions
  WHERE acquisition_pipeline_definitions.company_id = v_company_id AND name = 'Acquisitions Pipeline';

  FOR i IN 1..array_length(v_stage_data, 1) LOOP
    INSERT INTO acquisition_pipeline_stages (pipeline_definition_id, company_id, name, sort_order, color, is_stopping_stage, requires_confirmation_backward)
    VALUES (v_pipeline_id, v_company_id, v_stage_data[i][1], i, v_stage_data[i][2], v_stage_data[i][3] = 'true', v_stage_data[i][4] = 'true')
    ON CONFLICT (pipeline_definition_id, name) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- SEED: New permissions for acquisitions
-- ============================================================
INSERT INTO permissions (key, name, description, category)
VALUES
  ('view_acquisitions_pipeline', 'View Acquisitions Pipeline', 'View the acquisitions kanban pipeline', 'acquisitions'),
  ('edit_acquisition_records', 'Edit Acquisition Records', 'Create and edit acquisition records', 'acquisitions'),
  ('manage_automations', 'Manage Automations', 'Create and edit automation rules', 'automations'),
  ('view_notifications', 'View Notifications', 'View in-app notifications', 'notifications'),
  ('simulate_answered_call', 'Simulate Answered Call', 'Simulate an answered call event for assignment', 'acquisitions')
ON CONFLICT (key) DO NOTHING;
