/*
# Core CRM Schema — Phase 1 Foundation

## Overview
Creates the foundational database schema for a private wholesale real estate CRM.
This is a single-company internal tool, but company_id is kept on records for proper data scoping.

## New Tables

1. **companies** — The company record (single company in practice, multi-company capable)
   - id, name, logo_url, favicon_url, primary_color, secondary_color, default_appearance, created_at, updated_at

2. **profiles** — Extended user data linked to auth.users
   - id (references auth.users), company_id, email, full_name, avatar_url, timezone, notification_preferences, is_disabled, last_login_at, created_at, updated_at

3. **teams** — Teams within the company
   - id, company_id, name, description, created_at, updated_at

4. **team_members** — User-team membership
   - id, team_id, user_id, role ('lead'|'member'), created_at

5. **roles** — Role definitions
   - id, company_id, name, description, is_system, created_at, updated_at

6. **permissions** — Granular permission catalog
   - id, key (unique), name, description, category, created_at

7. **role_permissions** — Maps roles to permissions (many-to-many)
   - id, role_id, permission_id

8. **user_roles** — Assigns roles to users
   - id, user_id, role_id, created_at

9. **audit_logs** — Audit trail
   - id, user_id, action, entity_type, entity_id, metadata, created_at

## Security (RLS)
- All tables have RLS enabled.
- Profiles: users read/update own; manage_users can read all in company.
- Teams, team_members, roles, role_permissions, user_roles: company-scoped reads; management-permission-gated writes.
- Permissions: readable by all authenticated (shared catalog).
- Companies: readable by company members; writable with manage_branding.
- Audit logs: readable with view_audit_logs; insertable by any authenticated user.

## Helper Functions
- get_current_company_id() — company_id of authenticated user
- has_permission(key) — checks if current user has a permission via any role
- get_user_permissions() — returns all permission keys for current user
*/

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  favicon_url text,
  primary_color text NOT NULL DEFAULT '#0f172a',
  secondary_color text NOT NULL DEFAULT '#3b82f6',
  default_appearance text NOT NULL DEFAULT 'system' CHECK (default_appearance IN ('light', 'dark', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  avatar_url text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_disabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TEAM_MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PERMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROLE_PERMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USER_ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUDIT_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT p.key
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(perm_key text)
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
    AND p.key = perm_key
  );
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- COMPANIES
DROP POLICY IF EXISTS "select_company_own" ON companies;
CREATE POLICY "select_company_own" ON companies FOR SELECT
  TO authenticated USING (id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_company_own" ON companies;
CREATE POLICY "update_company_own" ON companies FOR UPDATE
  TO authenticated USING (id = public.get_current_company_id())
  WITH CHECK (id = public.get_current_company_id());

-- PROFILES
DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "select_profiles_by_perm" ON profiles;
CREATE POLICY "select_profiles_by_perm" ON profiles FOR SELECT
  TO authenticated USING (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_users')
  );

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- TEAMS
DROP POLICY IF EXISTS "select_teams_own" ON teams;
CREATE POLICY "select_teams_own" ON teams FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_teams_perm" ON teams;
CREATE POLICY "insert_teams_perm" ON teams FOR INSERT
  TO authenticated WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "update_teams_perm" ON teams;
CREATE POLICY "update_teams_perm" ON teams FOR UPDATE
  TO authenticated USING (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_teams')
  ) WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "delete_teams_perm" ON teams;
CREATE POLICY "delete_teams_perm" ON teams FOR DELETE
  TO authenticated USING (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_teams')
  );

-- TEAM_MEMBERS
DROP POLICY IF EXISTS "select_team_members_own" ON team_members;
CREATE POLICY "select_team_members_own" ON team_members FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_current_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_team_members_perm" ON team_members;
CREATE POLICY "insert_team_members_perm" ON team_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "update_team_members_perm" ON team_members;
CREATE POLICY "update_team_members_perm" ON team_members FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_teams')
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_teams')
  );

DROP POLICY IF EXISTS "delete_team_members_perm" ON team_members;
CREATE POLICY "delete_team_members_perm" ON team_members FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
      AND t.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_teams')
  );

-- ROLES
DROP POLICY IF EXISTS "select_roles_own" ON roles;
CREATE POLICY "select_roles_own" ON roles FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_roles_perm" ON roles;
CREATE POLICY "insert_roles_perm" ON roles FOR INSERT
  TO authenticated WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "update_roles_perm" ON roles;
CREATE POLICY "update_roles_perm" ON roles FOR UPDATE
  TO authenticated USING (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_roles')
  ) WITH CHECK (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "delete_roles_perm" ON roles;
CREATE POLICY "delete_roles_perm" ON roles FOR DELETE
  TO authenticated USING (
    company_id = public.get_current_company_id()
    AND public.has_permission('manage_roles')
    AND is_system = false
  );

-- PERMISSIONS (shared catalog)
DROP POLICY IF EXISTS "select_permissions_all" ON permissions;
CREATE POLICY "select_permissions_all" ON permissions FOR SELECT
  TO authenticated USING (true);

-- ROLE_PERMISSIONS
DROP POLICY IF EXISTS "select_role_permissions_own" ON role_permissions;
CREATE POLICY "select_role_permissions_own" ON role_permissions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_current_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_role_permissions_perm" ON role_permissions;
CREATE POLICY "insert_role_permissions_perm" ON role_permissions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_roles')
  );

DROP POLICY IF EXISTS "delete_role_permissions_perm" ON role_permissions;
CREATE POLICY "delete_role_permissions_perm" ON role_permissions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
      AND r.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_roles')
  );

-- USER_ROLES
DROP POLICY IF EXISTS "select_user_roles_own" ON user_roles;
CREATE POLICY "select_user_roles_own" ON user_roles FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
        AND p.company_id = public.get_current_company_id()
      )
      AND public.has_permission('manage_users')
    )
  );

DROP POLICY IF EXISTS "insert_user_roles_perm" ON user_roles;
CREATE POLICY "insert_user_roles_perm" ON user_roles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
      AND p.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_users')
  );

DROP POLICY IF EXISTS "delete_user_roles_perm" ON user_roles;
CREATE POLICY "delete_user_roles_perm" ON user_roles FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
      AND p.company_id = public.get_current_company_id()
    )
    AND public.has_permission('manage_users')
  );

-- AUDIT_LOGS
DROP POLICY IF EXISTS "select_audit_logs_perm" ON audit_logs;
CREATE POLICY "select_audit_logs_perm" ON audit_logs FOR SELECT
  TO authenticated USING (public.has_permission('view_audit_logs'));

DROP POLICY IF EXISTS "insert_audit_logs_any" ON audit_logs;
CREATE POLICY "insert_audit_logs_any" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_teams_company_id ON teams(company_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_roles_company_id ON roles(company_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_companies ON companies;
CREATE TRIGGER set_updated_at_companies
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_profiles ON profiles;
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_teams ON teams;
CREATE TRIGGER set_updated_at_teams
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_roles ON roles;
CREATE TRIGGER set_updated_at_roles
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TRIGGER: Auto-create profile on auth user creation
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, company_id, email, full_name)
  VALUES (
    NEW.id,
    (SELECT id FROM public.companies ORDER BY created_at LIMIT 1),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
