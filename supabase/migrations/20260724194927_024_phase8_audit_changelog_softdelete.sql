/*
# Phase 8 — Audit Logs, Changelog, Soft Deletion, Monitoring

Extends the existing audit_logs table (from Phase 1) with company_id and richer fields.
Creates app_changelog, scheduled_jobs tables.
Adds soft-delete columns to 8 record types.
Seeds permissions and initial changelog entry.
*/

-- 1. EXTEND audit_logs
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_type text; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_id uuid; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_value jsonb; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_value jsonb; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS automation_id uuid; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id text; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address inet; END $$;
DO $$ BEGIN ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason text; END $$;

UPDATE audit_logs SET company_id = p.company_id
FROM profiles p WHERE audit_logs.user_id = p.id AND audit_logs.company_id IS NULL;

ALTER TABLE audit_logs ALTER COLUMN company_id SET NOT NULL;

DROP POLICY IF EXISTS "select_audit_logs_own" ON audit_logs;
DROP POLICY IF EXISTS "insert_audit_logs_own" ON audit_logs;
CREATE POLICY "select_audit_logs_own" ON audit_logs FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());
CREATE POLICY "insert_audit_logs_own" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(company_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON audit_logs(company_id, record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);

-- 2. APP CHANGELOG
CREATE TABLE IF NOT EXISTS app_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version text NOT NULL,
  release_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  summary text NOT NULL,
  added text[] NOT NULL DEFAULT '{}',
  changed text[] NOT NULL DEFAULT '{}',
  fixed text[] NOT NULL DEFAULT '{}',
  security text[] NOT NULL DEFAULT '{}',
  author text,
  deployment_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (company_id, version)
);
ALTER TABLE app_changelog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_changelog_own" ON app_changelog;
CREATE POLICY "select_changelog_own" ON app_changelog FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_changelog_perm" ON app_changelog;
CREATE POLICY "insert_changelog_perm" ON app_changelog FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('view_developer_changelog'));
DROP POLICY IF EXISTS "update_changelog_perm" ON app_changelog;
CREATE POLICY "update_changelog_perm" ON app_changelog FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('view_developer_changelog'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('view_developer_changelog'));
DROP POLICY IF EXISTS "delete_changelog_perm" ON app_changelog;
CREATE POLICY "delete_changelog_perm" ON app_changelog FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('view_developer_changelog'));

CREATE INDEX IF NOT EXISTS idx_changelog_company ON app_changelog(company_id, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_status ON app_changelog(status);

DROP TRIGGER IF EXISTS set_updated_at_changelog ON app_changelog;
CREATE TRIGGER set_updated_at_changelog BEFORE UPDATE ON app_changelog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. SCHEDULED JOBS
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_detail text,
  related_record_id uuid,
  related_record_type text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_scheduled_jobs_own" ON scheduled_jobs;
CREATE POLICY "select_scheduled_jobs_own" ON scheduled_jobs FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "insert_scheduled_jobs_own" ON scheduled_jobs;
CREATE POLICY "insert_scheduled_jobs_own" ON scheduled_jobs FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());
DROP POLICY IF EXISTS "update_scheduled_jobs_perm" ON scheduled_jobs;
CREATE POLICY "update_scheduled_jobs_perm" ON scheduled_jobs FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_integrations'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_integrations'));

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_company ON scheduled_jobs(company_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type ON scheduled_jobs(job_type);

DROP TRIGGER IF EXISTS set_updated_at_scheduled_jobs ON scheduled_jobs;
CREATE TRIGGER set_updated_at_scheduled_jobs BEFORE UPDATE ON scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. SOFT DELETE COLUMNS
DO $$ BEGIN ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE acquisition_records ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE acquisition_records ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE disposition_records ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE disposition_records ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE management_records ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE management_records ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;
DO $$ BEGIN ALTER TABLE lead_campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE lead_campaigns ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_deleted ON contacts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_deleted ON properties(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_deleted ON opportunities(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acq_records_deleted ON acquisition_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disp_records_deleted ON disposition_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mgmt_records_deleted ON management_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_campaigns_deleted ON lead_campaigns(deleted_at) WHERE deleted_at IS NOT NULL;

-- 5. AUDIT LOG HELPER FUNCTION (all params have defaults)
CREATE OR REPLACE FUNCTION public.log_audit_entry(
  p_company_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_action text DEFAULT '',
  p_record_type text DEFAULT NULL,
  p_record_id uuid DEFAULT NULL,
  p_previous_value jsonb DEFAULT NULL,
  p_new_value jsonb DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_automation_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO audit_logs (
    company_id, user_id, action, record_type, record_id,
    previous_value, new_value, source, automation_id, reason
  )
  VALUES (
    p_company_id, p_user_id, p_action, p_record_type, p_record_id,
    p_previous_value, p_new_value, p_source, p_automation_id, p_reason
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 6. SEED PERMISSIONS
INSERT INTO permissions (key, name, description, category)
VALUES
  ('view_audit_logs', 'View Audit Logs', 'View business audit trail', 'audit'),
  ('manage_changelog', 'Manage Changelog', 'Create and publish app changelog entries', 'developer'),
  ('manage_scheduled_jobs', 'Manage Scheduled Jobs', 'Retry, cancel, and manage scheduled jobs', 'developer'),
  ('restore_deleted_records', 'Restore Deleted Records', 'Restore soft-deleted records', 'admin')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE v_admin_role uuid;
BEGIN
  SELECT id INTO v_admin_role FROM roles WHERE name = 'Admin' LIMIT 1;
  IF v_admin_role IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_admin_role, id FROM permissions
    WHERE key IN ('view_audit_logs','manage_changelog','manage_scheduled_jobs','restore_deleted_records')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 7. SEED INITIAL CHANGELOG
DO $$
DECLARE v_co uuid;
BEGIN
  SELECT id INTO v_co FROM companies LIMIT 1;
  IF v_co IS NULL THEN RETURN; END IF;
  INSERT INTO app_changelog (company_id, version, release_date, status, summary, added, changed, fixed, security, author, deployment_source)
  VALUES (
    v_co, '1.0.0', CURRENT_DATE, 'published',
    'Initial production release of Meridian CRM with full pipeline management.',
    ARRAY[
      'Lead pipeline with seller/buyer campaigns and SMS blast',
      'Acquisition pipeline with 9 stages and drag-and-drop kanban',
      'Disposition pipeline with buyer offers and EMD tracking',
      'Management pipeline with cross-pipeline synchronization',
      'Compensation rules and revenue attribution',
      'Dashboard with KPIs, charts, and date filters',
      'Conversations inbox with SMS and email',
      'Custom fields, roles, teams, and permissions',
      'Automation engine with triggers and conditions',
      'Audit logs and developer changelog'
    ],
    ARRAY[]::text[], ARRAY[]::text[],
    ARRAY['Row Level Security on all tables','Company-scoped data isolation'],
    'System', 'initial-deployment'
  )
  ON CONFLICT (company_id, version) DO NOTHING;
END $$;
