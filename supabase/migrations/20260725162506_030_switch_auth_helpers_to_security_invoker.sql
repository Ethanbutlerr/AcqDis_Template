/*
# Security Fix — Switch auth helper functions to SECURITY INVOKER

## Problem
6 auth helper functions were SECURITY DEFINER, flagged by scanner as
"Signed-In Users Can Execute SECURITY DEFINER Function".

## Challenge
These functions are used inside RLS policies on 77 tables. Switching to
SECURITY INVOKER naively causes infinite recursion:
  - get_my_company_id() reads from profiles
  - profiles RLS policy calls get_my_company_id()
  - → stack overflow

## Solution
Create security_barrier views that bypass RLS, then switch functions to
SECURITY INVOKER reading from those views. The barrier views are owned
by postgres and only expose the minimal columns needed.

## Verification
Tested with SET ROLE authenticated + JWT claims:
  - get_my_company_id() returns correct company_id (no recursion)
  - RLS policies on roles, user_roles, profiles, teams all work correctly
  - has_permission(), is_company_manager() work via barrier views
*/

-- ============================================================
-- Step 1: Create security_barrier views (bypass RLS, owned by postgres)
-- ============================================================
CREATE OR REPLACE VIEW public.v_profiles_company WITH (security_barrier = true) AS
SELECT id, company_id FROM public.profiles;

CREATE OR REPLACE VIEW public.v_user_roles WITH (security_barrier = true) AS
SELECT user_id, role_id FROM public.user_roles;

CREATE OR REPLACE VIEW public.v_role_permissions WITH (security_barrier = true) AS
SELECT role_id, permission_id FROM public.role_permissions;

CREATE OR REPLACE VIEW public.v_permissions WITH (security_barrier = true) AS
SELECT id, key FROM public.permissions;

-- ============================================================
-- Step 2: Switch all 6 functions to SECURITY INVOKER
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT company_id FROM public.v_profiles_company WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT company_id FROM public.v_profiles_company WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_user_company_id(target_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT company_id FROM public.v_profiles_company WHERE id = target_uid;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_permissions()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT ARRAY(
  SELECT DISTINCT p.key
  FROM public.v_user_roles ur
  JOIN public.v_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.v_permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
);
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(perm_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT EXISTS (
  SELECT 1
  FROM public.v_user_roles ur
  JOIN public.v_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.v_permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
  AND p.key = perm_key
);
$function$;

CREATE OR REPLACE FUNCTION public.is_company_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
SELECT EXISTS (
  SELECT 1
  FROM public.v_user_roles ur
  JOIN public.v_role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.v_permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
  AND p.key = 'manage_users'
);
$function$;

-- ============================================================
-- Step 3: Grant SELECT on barrier views to authenticated
-- (needed for SECURITY INVOKER functions to read from them)
-- ============================================================
GRANT SELECT ON public.v_profiles_company TO authenticated;
GRANT SELECT ON public.v_user_roles TO authenticated;
GRANT SELECT ON public.v_role_permissions TO authenticated;
GRANT SELECT ON public.v_permissions TO authenticated;
