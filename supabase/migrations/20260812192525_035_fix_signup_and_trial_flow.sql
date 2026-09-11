/*
# Fix Signup & Trial Flow

1. Modified Functions
   - `create_company_and_admin` - No longer sets is_agency_admin=true for every signup.
     Regular signups get is_agency_admin=false. Only the original admin keeps agency status.
     Also skips agency_company_access insert if user is not agency admin.

2. Important Notes
   - New signups are regular users with trial status
   - is_agency_admin is only set manually or by existing agency admins
   - Trial companies start with subscription_status='trialing'
*/

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
  v_existing_profile profiles%ROWTYPE;
  v_is_agency boolean := false;
BEGIN
  -- Generate slug
  v_slug := lower(regexp_replace(p_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF EXISTS (SELECT 1 FROM companies WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Check if user already has a profile (existing user creating additional company)
  SELECT * INTO v_existing_profile FROM profiles WHERE id = p_user_id;
  IF FOUND THEN
    v_is_agency := v_existing_profile.is_agency_admin;
  END IF;

  -- Create company
  INSERT INTO companies (name, slug, owner_user_id, subscription_status, subscription_plan, trial_ends_at)
  VALUES (p_company_name, v_slug, p_user_id, 'trialing', 'trial', now() + interval '7 days')
  RETURNING id INTO v_company_id;

  -- Create admin role
  INSERT INTO roles (company_id, name, description, is_system, is_default)
  VALUES (v_company_id, 'Admin', 'Full access to all features', true, false)
  RETURNING id INTO v_role_id;

  -- Create member role
  INSERT INTO roles (company_id, name, description, is_system, is_default)
  VALUES (v_company_id, 'Member', 'Standard team member access', true, true);

  -- Assign all permissions to admin role
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

  -- Create or update profile (new users get is_agency_admin=false)
  INSERT INTO profiles (id, company_id, email, full_name, is_agency_admin, home_company_id)
  VALUES (
    p_user_id, v_company_id, p_user_email,
    COALESCE(NULLIF(p_user_full_name, ''), split_part(p_user_email, '@', 1)),
    false, v_company_id
  )
  ON CONFLICT (id) DO UPDATE SET
    company_id = v_company_id;

  -- Assign admin role
  INSERT INTO user_roles (user_id, role_id)
  VALUES (p_user_id, v_role_id)
  ON CONFLICT DO NOTHING;

  -- Only create agency access if user is an agency admin
  IF v_is_agency THEN
    INSERT INTO agency_company_access (user_id, company_id, role, granted_by)
    VALUES (p_user_id, v_company_id, 'owner', p_user_id)
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;

  -- Create default integration settings
  INSERT INTO integration_settings (company_id, provider, status, is_mock, config, features_enabled)
  SELECT v_company_id, prov.provider, 'not_configured', true, '{}'::jsonb, ARRAY[]::text[]
  FROM (VALUES ('twilio'),('resend'),('discord')) AS prov(provider)
  ON CONFLICT (company_id, provider) DO NOTHING;

  -- Create default pipeline stages
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
