/*
# Seed Data — Permissions, Roles, Demo Company & Users

## Overview
Seeds the permission catalog (23 permissions across 9 categories),
creates default system roles with appropriate permission sets,
creates one demo company, and sets up demo users with roles and teams.

## What This Migration Does

### 1. Permissions Catalog (23 permissions)
Inserted into `permissions` table. All are idempotent (ON CONFLICT DO NOTHING).

Categories:
- dashboard: view_dashboard, view_all_revenue, view_personal_earnings
- acquisitions: view_acquisitions, edit_acquisitions
- dispositions: view_dispositions, edit_dispositions
- management: view_management, edit_management
- contacts: view_contacts, edit_contacts, import_contacts
- sms: send_individual_sms, send_buyer_sms_campaigns
- leads: assign_leads, reassign_leads
- users: manage_users, manage_roles, manage_teams
- system: manage_integrations, manage_branding, view_audit_logs, view_developer_changelog

### 2. Demo Company
- "Meridian Wholesale Properties" (demo company)

### 3. Default System Roles (8 roles)
- Management: all permissions
- Director: most permissions except manage_users, manage_roles, manage_branding
- Acquisitions Manager: acquisitions + contacts + leads + dashboard
- Acquisitions Representative: view + edit acquisitions, contacts, dashboard
- Dispositions Manager: dispositions + contacts + buyer SMS + dashboard
- Dispositions Representative: view + edit dispositions, contacts, dashboard
- Transaction Coordinator: contacts + view acquisitions/dispositions + dashboard
- Read Only: view permissions only

### 4. Demo Teams
- Acquisitions Team, Dispositions Team, Transaction Coordination Team

### 5. Demo Users
Created via auth.users insert so they get real auth IDs, then profiles are auto-created by trigger.
Demo credentials are documented below. All demo users have password "Demo1234!".

### Important Notes
- All inserts are idempotent via ON CONFLICT DO NOTHING
- Demo users are clearly labeled in full_name with "(Demo)" suffix
- The management demo user is the primary admin account
*/

-- ============================================================
-- 1. PERMISSIONS CATALOG
-- ============================================================
INSERT INTO permissions (key, name, description, category) VALUES
  -- Dashboard
  ('view_dashboard', 'View Dashboard', 'Access to the main dashboard', 'dashboard'),
  ('view_all_revenue', 'View All Revenue', 'See company-wide revenue figures', 'dashboard'),
  ('view_personal_earnings', 'View Personal Earnings', 'See own earnings and commissions', 'dashboard'),
  -- Acquisitions
  ('view_acquisitions', 'View Acquisitions', 'Access to acquisitions pipeline', 'acquisitions'),
  ('edit_acquisitions', 'Edit Acquisitions', 'Create and modify acquisition deals', 'acquisitions'),
  -- Dispositions
  ('view_dispositions', 'View Dispositions', 'Access to dispositions pipeline', 'dispositions'),
  ('edit_dispositions', 'Edit Dispositions', 'Create and modify disposition deals', 'dispositions'),
  -- Management
  ('view_management', 'View Management', 'Access to the management section', 'management'),
  ('edit_management', 'Edit Management', 'Modify management settings and data', 'management'),
  -- Contacts
  ('view_contacts', 'View Contacts', 'Access to contact records', 'contacts'),
  ('edit_contacts', 'Edit Contacts', 'Create and modify contacts', 'contacts'),
  ('import_contacts', 'Import Contacts', 'Bulk import contacts via CSV', 'contacts'),
  -- SMS
  ('send_individual_sms', 'Send Individual SMS', 'Send SMS to individual contacts', 'sms'),
  ('send_buyer_sms_campaigns', 'Send Buyer SMS Campaigns', 'Send bulk SMS campaigns to buyers', 'sms'),
  -- Leads
  ('assign_leads', 'Assign Leads', 'Assign leads to team members', 'leads'),
  ('reassign_leads', 'Reassign Leads', 'Reassign leads between team members', 'leads'),
  -- Users
  ('manage_users', 'Manage Users', 'Create, edit, disable, and manage user accounts', 'users'),
  ('manage_roles', 'Manage Roles', 'Create and modify roles and permission assignments', 'users'),
  ('manage_teams', 'Manage Teams', 'Create and modify teams and memberships', 'users'),
  -- System
  ('manage_integrations', 'Manage Integrations', 'Configure third-party integrations', 'system'),
  ('manage_branding', 'Manage Branding', 'Modify company branding and appearance', 'system'),
  ('view_audit_logs', 'View Audit Logs', 'Access to the audit log', 'system'),
  ('view_developer_changelog', 'View Developer Changelog', 'Access to developer changelog', 'system')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. DEMO COMPANY
-- ============================================================
INSERT INTO companies (id, name, primary_color, secondary_color, default_appearance)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Meridian Wholesale Properties',
  '#0f172a',
  '#2563eb',
  'system'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. DEFAULT SYSTEM ROLES
-- ============================================================
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Management', 'Full system access including user and role management', true),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Director', 'Senior leadership with broad access except user/role management', true),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Acquisitions Manager', 'Manages the acquisitions pipeline and team', true),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Acquisitions Representative', 'Works acquisition leads and deals', true),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'Dispositions Manager', 'Manages the dispositions pipeline and buyer campaigns', true),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'Dispositions Representative', 'Works disposition deals and buyer relationships', true),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'Transaction Coordinator', 'Manages closing documentation and coordination', true),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'Read Only', 'View-only access across the system', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. ROLE-PERMISSION ASSIGNMENTS
-- ============================================================

-- Management: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Management' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

-- Director: everything except manage_users, manage_roles, manage_branding
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Director' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key NOT IN ('manage_users', 'manage_roles', 'manage_branding')
ON CONFLICT DO NOTHING;

-- Acquisitions Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Acquisitions Manager' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard', 'view_all_revenue', 'view_personal_earnings',
  'view_acquisitions', 'edit_acquisitions',
  'view_contacts', 'edit_contacts', 'import_contacts',
  'send_individual_sms',
  'assign_leads', 'reassign_leads',
  'view_dispositions'
)
ON CONFLICT DO NOTHING;

-- Acquisitions Representative
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Acquisitions Representative' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard', 'view_personal_earnings',
  'view_acquisitions', 'edit_acquisitions',
  'view_contacts', 'edit_contacts',
  'send_individual_sms'
)
ON CONFLICT DO NOTHING;

-- Dispositions Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Dispositions Manager' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard', 'view_all_revenue', 'view_personal_earnings',
  'view_dispositions', 'edit_dispositions',
  'view_contacts', 'edit_contacts', 'import_contacts',
  'send_individual_sms', 'send_buyer_sms_campaigns',
  'view_acquisitions'
)
ON CONFLICT DO NOTHING;

-- Dispositions Representative
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Dispositions Representative' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard', 'view_personal_earnings',
  'view_dispositions', 'edit_dispositions',
  'view_contacts', 'edit_contacts',
  'send_individual_sms'
)
ON CONFLICT DO NOTHING;

-- Transaction Coordinator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Transaction Coordinator' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard',
  'view_acquisitions', 'view_dispositions',
  'view_contacts', 'edit_contacts',
  'send_individual_sms'
)
ON CONFLICT DO NOTHING;

-- Read Only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Read Only' AND r.company_id = 'a0000000-0000-4000-8000-000000000001'
AND p.key IN (
  'view_dashboard', 'view_personal_earnings',
  'view_acquisitions', 'view_dispositions',
  'view_management', 'view_contacts'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. DEMO TEAMS
-- ============================================================
INSERT INTO teams (id, company_id, name, description) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acquisitions Team', 'Front-line acquisition specialists (Demo)'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Dispositions Team', 'Buyer outreach and deal dispositions (Demo)'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Transaction Coordination', 'Closing and documentation team (Demo)')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6. DEMO USERS
-- ============================================================
-- We create auth.users entries so they can actually log in.
-- The handle_new_user trigger auto-creates their profile.
-- Password for all demo accounts: Demo1234!

-- Management user (primary admin)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'admin@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Sarah Mitchell (Demo)"}'::jsonb,
  '{"full_name":"Sarah Mitchell (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@meridianwholesale.com');

-- Director
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'director@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"James Carter (Demo)"}'::jsonb,
  '{"full_name":"James Carter (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'director@meridianwholesale.com');

-- Acquisitions Manager
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'acq.manager@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Maria Rodriguez (Demo)"}'::jsonb,
  '{"full_name":"Maria Rodriguez (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'acq.manager@meridianwholesale.com');

-- Acquisitions Representative
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000004',
  'authenticated',
  'authenticated',
  'acq.rep@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Tommy Chen (Demo)"}'::jsonb,
  '{"full_name":"Tommy Chen (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'acq.rep@meridianwholesale.com');

-- Dispositions Manager
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000005',
  'authenticated',
  'authenticated',
  'disp.manager@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Aisha Patel (Demo)"}'::jsonb,
  '{"full_name":"Aisha Patel (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'disp.manager@meridianwholesale.com');

-- Transaction Coordinator
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000006',
  'authenticated',
  'authenticated',
  'tc@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Kevin O''Brien (Demo)"}'::jsonb,
  '{"full_name":"Kevin O''Brien (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'tc@meridianwholesale.com');

-- Read Only user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000007',
  'authenticated',
  'authenticated',
  'readonly@meridianwholesale.com',
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  '{"full_name":"Jordan Lee (Demo)"}'::jsonb,
  '{"full_name":"Jordan Lee (Demo)"}'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'readonly@meridianwholesale.com');

-- ============================================================
-- 7. UPDATE PROFILES WITH CORRECT COMPANY_ID
-- ============================================================
-- The trigger defaults to first company, but let's ensure they're all correct
UPDATE profiles SET company_id = 'a0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL OR company_id != 'a0000000-0000-4000-8000-000000000001';

-- ============================================================
-- 8. ASSIGN USER ROLES
-- ============================================================
INSERT INTO user_roles (user_id, role_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'), -- Management
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002'), -- Director
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003'), -- Acquisitions Manager
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004'), -- Acquisitions Representative
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005'), -- Dispositions Manager
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000007'), -- Transaction Coordinator
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000008')  -- Read Only
ON CONFLICT DO NOTHING;

-- ============================================================
-- 9. ASSIGN TEAM MEMBERSHIPS
-- ============================================================
INSERT INTO team_members (team_id, user_id, role) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'lead'), -- Acq Mgr -> Acq Team lead
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'member'), -- Acq Rep -> Acq Team
  ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'lead'), -- Disp Mgr -> Disp Team lead
  ('c0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', 'lead')  -- TC -> Transaction Team lead
ON CONFLICT DO NOTHING;
