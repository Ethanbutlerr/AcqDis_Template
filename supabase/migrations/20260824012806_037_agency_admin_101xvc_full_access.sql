/*
# Agency admin privileges for @101xvc.com accounts

1. Changes
   - Updates all existing profiles with @101xvc.com emails to be agency admins
   - Creates a trigger that automatically sets is_agency_admin = true for any new @101xvc.com account
   - Replaces get_accessible_companies() to return ALL companies when user is agency admin
   - Replaces switch_company() to skip access check when user is agency admin

2. Security
   - Agency admins can see and switch to any company in the system
   - Non-agency-admin users still only see companies in their agency_company_access list
   - The trigger ensures any future @101xvc.com signups automatically get agency admin

3. Important Notes
   - This is a platform-level privilege, not a per-company role
   - Agency admins bypass the agency_company_access table entirely
*/

-- Mark all existing @101xvc.com users as agency admins
UPDATE profiles SET is_agency_admin = true WHERE email LIKE '%@101xvc.com';

-- Create trigger function to auto-set agency admin for new @101xvc.com accounts
CREATE OR REPLACE FUNCTION auto_set_agency_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email LIKE '%@101xvc.com' THEN
    NEW.is_agency_admin := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_agency_admin ON profiles;
CREATE TRIGGER trg_auto_agency_admin
  BEFORE INSERT OR UPDATE OF email ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_agency_admin();

-- Replace get_accessible_companies to return ALL companies for agency admins
CREATE OR REPLACE FUNCTION get_accessible_companies()
RETURNS TABLE (
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
  v_is_agency boolean;
BEGIN
  v_user_id := auth.uid();
  SELECT p.company_id, p.is_agency_admin
    INTO v_current_company, v_is_agency
    FROM profiles p WHERE p.id = v_user_id;

  IF v_is_agency THEN
    -- Agency admins see ALL companies
    RETURN QUERY
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      c.slug AS company_slug,
      'agency_admin'::text AS role,
      c.subscription_status,
      c.subscription_plan,
      (c.id = v_current_company) AS is_current
    FROM companies c
    ORDER BY (c.id = v_current_company) DESC, c.name;
  ELSE
    -- Normal users only see their access list
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
  END IF;
END;
$$;

-- Replace switch_company to skip access check for agency admins
CREATE OR REPLACE FUNCTION switch_company(p_target_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
    -- Non-agency users must have explicit access
    SELECT EXISTS (
      SELECT 1 FROM agency_company_access
      WHERE user_id = v_user_id AND company_id = p_target_company_id
    ) INTO v_has_access;

    IF NOT v_has_access THEN
      RETURN jsonb_build_object('error', 'No access to this account');
    END IF;
  END IF;

  -- Verify target company exists
  SELECT name INTO v_company_name FROM companies WHERE id = p_target_company_id;
  IF v_company_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Company not found');
  END IF;

  -- Save home company if first switch
  IF v_home_company_id IS NULL THEN
    UPDATE profiles SET home_company_id = company_id WHERE id = v_user_id;
  END IF;

  -- Do the switch
  UPDATE profiles SET company_id = p_target_company_id WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_target_company_id,
    'company_name', v_company_name
  );
END;
$$;
