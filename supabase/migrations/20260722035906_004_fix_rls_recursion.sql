/*
# Fix: Infinite recursion in profiles RLS policy

## Problem
The `select_profiles_manage` policy on `profiles` references `profiles` in a subquery:
`company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())`
This causes infinite recursion because the subquery is subject to the same RLS policies.

## Fix
1. Create a SECURITY DEFINER function `get_my_company_id()` that reads from profiles
   bypassing RLS (since it's SECURITY DEFINER, it runs as the owner).
2. Replace all references to `(SELECT company_id FROM profiles WHERE id = auth.uid())`
   in RLS policies with `public.get_my_company_id()`.
3. Drop the existing `select_profiles_manage` policy and recreate it using the new function.
4. Fix the `select_user_roles_manage` policy similarly.
5. Fix any other policies that reference profiles in subqueries.

## Result
No more infinite recursion. Login works.
*/

-- ============================================================
-- Create a SECURITY DEFINER function to get the caller's company_id
-- This bypasses RLS so it won't cause recursion
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- Fix profiles SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "select_profiles_manage" ON profiles;

CREATE POLICY "select_profiles_manage" ON profiles FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = 'manage_users'
    )
  );

-- ============================================================
-- Fix user_roles SELECT policy (manage variant)
-- ============================================================
DROP POLICY IF EXISTS "select_user_roles_manage" ON user_roles;

CREATE POLICY "select_user_roles_manage" ON user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.company_id = public.get_my_company_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur2
      JOIN public.role_permissions rp ON rp.role_id = ur2.role_id
      JOIN public.permissions perm ON perm.id = rp.permission_id
      WHERE ur2.user_id = auth.uid()
        AND perm.key = 'manage_users'
    )
  );

-- ============================================================
-- Fix companies SELECT/UPDATE policies (also reference get_current_company_id
-- which queries profiles — replace with get_my_company_id)
-- ============================================================
DROP POLICY IF EXISTS "select_company_own" ON companies;
CREATE POLICY "select_company_own" ON companies FOR SELECT
  TO authenticated USING (id = public.get_my_company_id());

DROP POLICY IF EXISTS "update_company_own" ON companies;
CREATE POLICY "update_company_own" ON companies FOR UPDATE
  TO authenticated USING (id = public.get_my_company_id())
  WITH CHECK (id = public.get_my_company_id());

-- ============================================================
-- Fix teams policies (reference get_current_company_id)
-- ============================================================
DROP POLICY IF EXISTS "select_teams_own" ON teams;
CREATE POLICY "select_teams_own" ON teams FOR SELECT
  TO authenticated USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "insert_teams_perm" ON teams;
CREATE POLICY "insert_teams_perm" ON teams FOR INSERT
  TO authenticated WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "update_teams_perm" ON teams;
CREATE POLICY "update_teams_perm" ON teams FOR UPDATE
  TO authenticated USING (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_teams')
  ) WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "delete_teams_perm" ON teams;
CREATE POLICY "delete_teams_perm" ON teams FOR DELETE
  TO authenticated USING (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_teams')
  );

-- ============================================================
-- Fix team_members policies
-- ============================================================
DROP POLICY IF EXISTS "select_team_members_own" ON team_members;
CREATE POLICY "select_team_members_own" ON team_members FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_my_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_team_members_perm" ON team_members;
CREATE POLICY "insert_team_members_perm" ON team_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "update_team_members_perm" ON team_members;
CREATE POLICY "update_team_members_perm" ON team_members FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_teams')
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "delete_team_members_perm" ON team_members;
CREATE POLICY "delete_team_members_perm" ON team_members FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_teams')
  );

-- ============================================================
-- Fix roles policies
-- ============================================================
DROP POLICY IF EXISTS "select_roles_own" ON roles;
CREATE POLICY "select_roles_own" ON roles FOR SELECT
  TO authenticated USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "insert_roles_perm" ON roles;
CREATE POLICY "insert_roles_perm" ON roles FOR INSERT
  TO authenticated WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "update_roles_perm" ON roles;
CREATE POLICY "update_roles_perm" ON roles FOR UPDATE
  TO authenticated USING (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_roles')
  ) WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "delete_roles_perm" ON roles;
CREATE POLICY "delete_roles_perm" ON roles FOR DELETE
  TO authenticated USING (
    company_id = public.get_my_company_id()
    AND public.has_permission('manage_roles')
    AND is_system = false
  );

-- ============================================================
-- Fix role_permissions policies
-- ============================================================
DROP POLICY IF EXISTS "select_role_permissions_own" ON role_permissions;
CREATE POLICY "select_role_permissions_own" ON role_permissions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_my_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_role_permissions_perm" ON role_permissions;
CREATE POLICY "insert_role_permissions_perm" ON role_permissions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "delete_role_permissions_perm" ON role_permissions;
CREATE POLICY "delete_role_permissions_perm" ON role_permissions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_roles')
  );

-- ============================================================
-- Fix user_roles INSERT/DELETE policies
-- ============================================================
DROP POLICY IF EXISTS "insert_user_roles_perm" ON user_roles;
CREATE POLICY "insert_user_roles_perm" ON user_roles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
      AND p.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_users')
  );

DROP POLICY IF EXISTS "delete_user_roles_perm" ON user_roles;
CREATE POLICY "delete_user_roles_perm" ON user_roles FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
      AND p.company_id = public.get_my_company_id()
    )
    AND public.has_permission('manage_users')
  );

-- ============================================================
-- Fix audit_logs SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "select_audit_logs_perm" ON audit_logs;
CREATE POLICY "select_audit_logs_perm" ON audit_logs FOR SELECT
  TO authenticated USING (public.has_permission('view_audit_logs'));
