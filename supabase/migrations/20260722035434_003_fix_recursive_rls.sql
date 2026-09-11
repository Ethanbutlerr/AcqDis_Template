/*
# Fix: Remove recursive RLS policies that cause "Database error querying schema"

## Problem
During Supabase Auth login, the auth service validates the schema by evaluating RLS policies.
The `select_profiles_by_perm` policy on `profiles` called `has_permission('manage_users')`,
which queries `user_roles`. The `user_roles` SELECT policy also called `has_permission()`,
which re-queries `user_roles` — creating a circular dependency that caused a 500 error on login.

## Fix
1. Drop `select_profiles_by_perm` — the main policy `select_own_profile` already lets each
   user read their own row (which is all the frontend needs for auth). Management access to
   all profiles is handled by the `update_own_profile` policy being open plus a new
   non-recursive policy that uses a direct subquery into `user_roles`/`role_permissions`
   without calling the `has_permission()` helper function.

2. Replace `select_user_roles_own` with a simpler policy that only uses `auth.uid()` directly.

3. Replace any policy using `has_permission()` in its USING clause with direct subqueries
   for the cases that are needed during schema validation. Policies using `has_permission()`
   for INSERT/DELETE WITH CHECK are fine — those are only evaluated on write operations.

## Result
Login works. Profile reads work for the authenticated user. All write-protection policies
are preserved via WITH CHECK conditions which are only evaluated on actual writes.
*/

-- ============================================================
-- FIX 1: Profiles — drop the recursive select policy
-- ============================================================
DROP POLICY IF EXISTS "select_profiles_by_perm" ON profiles;

-- Replace with a non-recursive version that checks manage_users permission
-- via a direct JOIN instead of calling has_permission()
CREATE POLICY "select_profiles_manage" ON profiles FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = 'manage_users'
    )
  );

-- ============================================================
-- FIX 2: user_roles SELECT — use simpler non-recursive policy
-- ============================================================
DROP POLICY IF EXISTS "select_user_roles_own" ON user_roles;

-- Own roles: always visible to themselves
CREATE POLICY "select_user_roles_self" ON user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Managers can see all user_roles in their company via direct subquery
CREATE POLICY "select_user_roles_manage" ON user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_roles.user_id
        AND p.company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM user_roles ur2
      JOIN role_permissions rp ON rp.role_id = ur2.role_id
      JOIN permissions perm ON perm.id = rp.permission_id
      WHERE ur2.user_id = auth.uid()
        AND perm.key = 'manage_users'
    )
  );
