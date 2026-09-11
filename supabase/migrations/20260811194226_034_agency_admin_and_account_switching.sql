/*
# Agency Admin: Multi-account access and sub-account switching

1. Modified Tables
   - `profiles`
     - `is_agency_admin` (boolean, default false) - Whether user is an agency-level admin
     - `home_company_id` (uuid, nullable) - The user's original/home company (for switching back)

2. New Tables
   - `agency_company_access`
     - Tracks which companies an agency admin can access
     - `id` (uuid, PK)
     - `user_id` (uuid, FK auth.users) - The agency admin user
     - `company_id` (uuid, FK companies) - A company they can switch into
     - `role` (text) - Their role in that company: 'owner', 'admin', 'viewer'
     - `granted_at` (timestamptz)
     - `granted_by` (uuid, nullable)
     - UNIQUE(user_id, company_id)

3. Functions
   - `switch_company(p_target_company_id uuid)` - SECURITY DEFINER
     Switches the calling user's active company_id in profiles.
     Only allowed if user is agency admin AND has access to that company.
     Returns the new company_id on success.
   
   - `get_accessible_companies()` - SECURITY INVOKER
     Returns all companies the current user can access (for the switcher UI).

4. Modified defaults
   - Trial duration changed from 14 days to 7 days in create_company_and_admin

5. Security
   - RLS on agency_company_access: users can read their own rows
   - switch_company validates membership before allowing switch
*/

-- Add columns to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_agency_admin') THEN
    ALTER TABLE profiles ADD COLUMN is_agency_admin boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'home_company_id') THEN
    ALTER TABLE profiles ADD COLUMN home_company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Agency company access table
CREATE TABLE IF NOT EXISTS agency_company_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'viewer')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_access_user ON agency_company_access(user_id);
CREATE INDEX IF NOT EXISTS idx_agency_access_company ON agency_company_access(company_id);

ALTER TABLE agency_company_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_agency_access" ON agency_company_access;
CREATE POLICY "select_own_agency_access" ON agency_company_access FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert_agency_access" ON agency_company_access;
CREATE POLICY "insert_agency_access" ON agency_company_access FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_agency_admin = true)
  );

DROP POLICY IF EXISTS "update_agency_access" ON agency_company_access;
CREATE POLICY "update_agency_access" ON agency_company_access FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "delete_agency_access" ON agency_company_access;
CREATE POLICY "delete_agency_access" ON agency_company_access FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_agency_admin = true)
  );

-- Switch company function
CREATE OR REPLACE FUNCTION switch_company(p_target_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_agency boolean;
  v_has_access boolean;
  v_home_company_id uuid;
  v_company_name text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT is_agency_admin, home_company_id, company_id
  INTO v_is_agency, v_home_company_id, v_home_company_id
  FROM profiles WHERE id = v_user_id;

  IF NOT v_is_agency THEN
    RETURN jsonb_build_object('error', 'Not an agency admin');
  END IF;

  -- Check access
  SELECT EXISTS (
    SELECT 1 FROM agency_company_access
    WHERE user_id = v_user_id AND company_id = p_target_company_id
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object('error', 'No access to this account');
  END IF;

  -- Save home company if first switch
  IF v_home_company_id IS NULL THEN
    UPDATE profiles SET home_company_id = company_id WHERE id = v_user_id;
  END IF;

  -- Do the switch
  UPDATE profiles SET company_id = p_target_company_id WHERE id = v_user_id;

  SELECT name INTO v_company_name FROM companies WHERE id = p_target_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_target_company_id,
    'company_name', v_company_name
  );
END;
$$;

REVOKE ALL ON FUNCTION switch_company FROM PUBLIC;
GRANT EXECUTE ON FUNCTION switch_company TO authenticated;

-- Get accessible companies for agency switcher
CREATE OR REPLACE FUNCTION get_accessible_companies()
RETURNS TABLE(
  company_id uuid,
  company_name text,
  company_slug text,
  role text,
  subscription_status text,
  subscription_plan text,
  is_current boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_current_company uuid;
BEGIN
  v_user_id := auth.uid();
  SELECT p.company_id INTO v_current_company FROM profiles p WHERE p.id = v_user_id;

  RETURN QUERY
  SELECT
    c.id AS company_id,
    c.name AS company_name,
    c.slug AS company_slug,
    aca.role,
    c.subscription_status,
    c.subscription_plan,
    (c.id = v_current_company) AS is_current
  FROM agency_company_access aca
  JOIN companies c ON c.id = aca.company_id
  WHERE aca.user_id = v_user_id
  ORDER BY (c.id = v_current_company) DESC, c.name;
END;
$$;

REVOKE ALL ON FUNCTION get_accessible_companies FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_accessible_companies TO authenticated;

-- Update create_company_and_admin to use 7-day trial and grant agency access
CREATE OR REPLACE FUNCTION create_company_and_admin(
  p_user_id uuid,
  p_company_name text,
  p_user_email text,
  p_user_full_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role_id uuid;
  v_slug text;
  v_is_first_company boolean;
BEGIN
  v_slug := lower(regexp_replace(p_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF EXISTS (SELECT 1 FROM companies WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Check if this user already has a company (making them agency admin)
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND company_id IS NOT NULL)
  INTO v_is_first_company;

  INSERT INTO companies (name, slug, owner_user_id, subscription_status, subscription_plan, trial_ends_at)
  VALUES (p_company_name, v_slug, p_user_id, 'trialing', 'trial', now() + interval '7 days')
  RETURNING id INTO v_company_id;

  INSERT INTO roles (company_id, name, description, is_system, is_default)
  VALUES (v_company_id, 'Admin', 'Full access to all features', true, false)
  RETURNING id INTO v_role_id;

  INSERT INTO roles (company_id, name, description, is_system, is_default)
  VALUES (v_company_id, 'Member', 'Standard team member access', true, true);

  INSERT INTO role_permissions (role_id, permission_key)
  SELECT v_role_id, pk.key
  FROM unnest(ARRAY[
    'view_dashboard','manage_branding','manage_users','manage_roles',
    'manage_teams','manage_custom_fields','manage_phone_numbers',
    'view_developer_changelog','view_contacts','edit_contacts',
    'delete_contacts','view_properties','edit_properties',
    'delete_properties','view_lead_pipeline','manage_lead_pipeline',
    'view_campaigns','manage_campaigns','view_acquisitions',
    'manage_acquisitions','view_dispositions','manage_dispositions',
    'view_management','manage_management','view_opportunities',
    'manage_opportunities','send_individual_sms','send_individual_email',
    'view_conversations','manage_conversations','view_tasks',
    'manage_tasks','view_sms_blasts','manage_sms_blasts',
    'view_buyers','manage_buyers','view_automations',
    'manage_automations','view_audit_log'
  ]) AS pk(key)
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, company_id, email, full_name, is_agency_admin, home_company_id)
  VALUES (
    p_user_id, v_company_id, p_user_email,
    COALESCE(NULLIF(p_user_full_name, ''), split_part(p_user_email, '@', 1)),
    true, v_company_id
  )
  ON CONFLICT (id) DO UPDATE SET
    company_id = v_company_id,
    is_agency_admin = true,
    home_company_id = COALESCE(profiles.home_company_id, profiles.company_id);

  INSERT INTO user_roles (user_id, role_id)
  VALUES (p_user_id, v_role_id)
  ON CONFLICT DO NOTHING;

  -- Grant agency access to this company
  INSERT INTO agency_company_access (user_id, company_id, role, granted_by)
  VALUES (p_user_id, v_company_id, 'owner', p_user_id)
  ON CONFLICT (user_id, company_id) DO NOTHING;

  INSERT INTO integration_settings (company_id, provider, status, is_mock, config, features_enabled)
  SELECT v_company_id, prov.provider, 'not_configured', true, '{}'::jsonb, ARRAY[]::text[]
  FROM (VALUES ('twilio'),('resend'),('discord')) AS prov(provider)
  ON CONFLICT (company_id, provider) DO NOTHING;

  INSERT INTO seller_pipeline_stages (company_id, name, position, color, is_system)
  VALUES
    (v_company_id, 'New Lead', 1, '#3b82f6', true),
    (v_company_id, 'Contacted', 2, '#f59e0b', true),
    (v_company_id, 'Qualified', 3, '#10b981', true),
    (v_company_id, 'Under Contract', 4, '#8b5cf6', true),
    (v_company_id, 'Closed', 5, '#6b7280', true)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'company_id', v_company_id,
    'role_id', v_role_id,
    'slug', v_slug
  );
END;
$$;

REVOKE ALL ON FUNCTION create_company_and_admin FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_company_and_admin TO authenticated;

-- Make existing owner an agency admin with access to the first company
DO $$
DECLARE
  v_first_company_id uuid;
  v_owner_id uuid;
BEGIN
  SELECT id, owner_user_id INTO v_first_company_id, v_owner_id
  FROM companies ORDER BY created_at LIMIT 1;
  
  IF v_owner_id IS NOT NULL THEN
    UPDATE profiles
    SET is_agency_admin = true, home_company_id = v_first_company_id
    WHERE id = v_owner_id;
    
    INSERT INTO agency_company_access (user_id, company_id, role)
    VALUES (v_owner_id, v_first_company_id, 'owner')
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;
END $$;

-- Update trial default on companies
ALTER TABLE companies ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '7 days');
