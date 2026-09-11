/*
# Fix: Cross-table RLS recursion between profiles and user_roles

## Problem
- `profiles` SELECT policy `select_profiles_manage` queries `user_roles` to check manage_users permission
- `user_roles` SELECT policy `select_user_roles_manage` queries `profiles` to check company_id
- This creates cross-table infinite recursion

## Fix
1. Create a SECURITY DEFINER function `is_company_manager()` that checks if the current user
   has manage_users permission WITHOUT triggering RLS (runs as owner, bypasses RLS).
2. Create a SECURITY DEFINER function `get_user_company_id(uid)` that gets a user's company_id
   WITHOUT triggering RLS on profiles.
3. Replace the recursive subqueries in policies with these functions.

## Result
No more cross-table recursion. Login works.
*/

-- ============================================================
-- SECURITY DEFINER function: check if current user has manage_users
-- Runs as owner, bypasses RLS, no recursion
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_company_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.key = 'manage_users'
  );
$$;

-- ============================================================
-- SECURITY DEFINER function: get any user's company_id
-- Runs as owner, bypasses RLS on profiles, no recursion
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_company_id(target_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = target_uid;
$$;

-- ============================================================
-- Fix profiles SELECT policy for managers
-- ============================================================
DROP POLICY IF EXISTS "select_profiles_manage" ON profiles;

CREATE POLICY "select_profiles_manage" ON profiles FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.is_company_manager()
  );

-- ============================================================
-- Fix user_roles SELECT policy for managers
-- ============================================================
DROP POLICY IF EXISTS "select_user_roles_manage" ON user_roles;

CREATE POLICY "select_user_roles_manage" ON user_roles FOR SELECT
  TO authenticated
  USING (
    public.get_user_company_id(user_roles.user_id) = public.get_my_company_id()
    AND public.is_company_manager()
  );

-- ============================================================
-- Fix user_roles INSERT/DELETE policies to use non-recursive functions
-- ============================================================
DROP POLICY IF EXISTS "insert_user_roles_perm" ON user_roles;
CREATE POLICY "insert_user_roles_perm" ON user_roles FOR INSERT
  TO authenticated WITH CHECK (
    public.get_user_company_id(user_roles.user_id) = public.get_my_company_id()
    AND public.is_company_manager()
  );

DROP POLICY IF EXISTS "delete_user_roles_perm" ON user_roles;
CREATE POLICY "delete_user_roles_perm" ON user_roles FOR DELETE
  TO authenticated USING (
    public.get_user_company_id(user_roles.user_id) = public.get_my_company_id()
    AND public.is_company_manager()
  );
