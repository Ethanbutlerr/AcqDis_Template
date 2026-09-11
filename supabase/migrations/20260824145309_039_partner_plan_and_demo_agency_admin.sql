/*
# Partner plan and demo agency admin setup

1. Changes
   - Sets the demo user (admin@meridianwholesale.com) as an agency admin
   - Updates "Good Neighbor Home Buyer" company to subscription_plan = 'partner', subscription_status = 'active'
   - The 'partner' plan is $0/forever with normal Twilio rates and free Resend email
   - Adds a new RPC function `create_partner_subaccount` that creates a company on the partner plan
     (agency admins use this instead of `create_company_and_admin` when selecting $0 plan)

2. Modified Data
   - profiles: admin@meridianwholesale.com -> is_agency_admin = true
   - companies: Good Neighbor Home Buyer -> subscription_plan = 'partner', subscription_status = 'active'

3. New Functions
   - `create_partner_subaccount(p_company_name, p_owner_email, p_owner_full_name)` 
     Creates a company with plan='partner', status='active', no trial expiry.
     Only callable by agency admins.

4. Important Notes
   - 'partner' plan = $0 platform fee, normal Twilio pass-through rates, free Resend email
   - Only agency admins can create partner sub-accounts
*/

-- Make demo user an agency admin
UPDATE profiles 
SET is_agency_admin = true 
WHERE email = 'admin@meridianwholesale.com';

-- Set Good Neighbor Home Buyer to partner plan
UPDATE companies 
SET subscription_plan = 'partner', 
    subscription_status = 'active',
    trial_ends_at = NULL
WHERE id = 'a0000000-0000-4000-8000-000000000001';

-- Function for agency admins to create partner sub-accounts
CREATE OR REPLACE FUNCTION create_partner_subaccount(
  p_company_name text,
  p_owner_email text DEFAULT NULL,
  p_owner_full_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_company_id uuid;
  v_role_id uuid;
  v_slug text;
  v_is_agency boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT is_agency_admin INTO v_is_agency FROM profiles WHERE id = v_user_id;
  IF NOT COALESCE(v_is_agency, false) THEN
    RETURN jsonb_build_object('error', 'Only agency admins can create partner accounts');
  END IF;

  -- Generate slug
  v_slug := lower(regexp_replace(p_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF EXISTS (SELECT 1 FROM companies WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Create company on partner plan (active, $0, no trial)
  INSERT INTO companies (name, slug, owner_user_id, subscription_status, subscription_plan, trial_ends_at)
  VALUES (p_company_name, v_slug, v_user_id, 'active', 'partner', NULL)
  RETURNING id INTO v_company_id;

  -- Create admin role
  INSERT INTO roles (company_id, name, description, is_system)
  VALUES (v_company_id, 'Admin', 'Full access to all features', true)
  RETURNING id INTO v_role_id;

  -- Create member role
  INSERT INTO roles (company_id, name, description, is_system)
  VALUES (v_company_id, 'Member', 'Standard team member access', true);

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

  -- Link agency admin to this company
  INSERT INTO agency_company_access (user_id, company_id, role, granted_by)
  VALUES (v_user_id, v_company_id, 'owner', v_user_id)
  ON CONFLICT (user_id, company_id) DO NOTHING;

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
    'success', true,
    'company_id', v_company_id,
    'slug', v_slug,
    'plan', 'partner'
  );
END;
$$;
