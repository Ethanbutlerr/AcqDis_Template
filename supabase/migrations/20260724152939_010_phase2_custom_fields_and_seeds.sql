/*
# Phase 2 Custom Fields + Seed Data

## Overview
1. Creates the custom field system (field_groups, field_definitions, field_values).
2. Seeds default contact types for the existing company.
3. Seeds default field groups with field definitions.
4. Adds new permissions for properties, opportunities, tasks, files, custom fields.

## New Tables
- field_groups: Named groups of custom fields (Seller Info, Property Info, Deal Info, Closing Info)
- field_definitions: Individual custom field definitions with type, validation, visibility
- field_values: Stored values for custom fields, polymorphic attachment to any record

## Security
- field_groups/field_definitions: company-scoped SELECT, permission-gated writes (manage_roles)
- field_values: company-scoped SELECT, any company member can INSERT/UPDATE

## Important Notes
1. Field definitions support 17 field types including calculated fields.
2. Fields can be scoped to a record_type (contact, property, opportunity, acquisition, disposition, management).
3. Fields can be restricted to certain roles via visible_to_roles array.
4. field_values uses polymorphic entity_type + entity_id pattern.
*/

-- ============================================================
-- FIELD_GROUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS field_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('contact','property','opportunity','acquisition','disposition','management')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name, record_type)
);
ALTER TABLE field_groups ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FIELD_DEFINITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  field_group_id uuid NOT NULL REFERENCES field_groups(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('short_text','long_text','number','currency','percentage','date','datetime','dropdown','multi_select','checkbox','phone','email','url','address','user','contact','file','image','calculated')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  record_type text NOT NULL CHECK (record_type IN ('contact','property','opportunity','acquisition','disposition','management')),
  visible_to_roles text[] NOT NULL DEFAULT '{}',
  calculated_expression text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FIELD_VALUES
-- ============================================================
CREATE TABLE IF NOT EXISTS field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact','property','opportunity','acquisition','disposition','management')),
  entity_id uuid NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_definition_id, entity_type, entity_id)
);
ALTER TABLE field_values ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- FIELD_GROUPS
DROP POLICY IF EXISTS "select_field_groups_own" ON field_groups;
CREATE POLICY "select_field_groups_own" ON field_groups FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_field_groups_perm" ON field_groups;
CREATE POLICY "insert_field_groups_perm" ON field_groups FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

DROP POLICY IF EXISTS "update_field_groups_perm" ON field_groups;
CREATE POLICY "update_field_groups_perm" ON field_groups FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

DROP POLICY IF EXISTS "delete_field_groups_perm" ON field_groups;
CREATE POLICY "delete_field_groups_perm" ON field_groups FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

-- FIELD_DEFINITIONS
DROP POLICY IF EXISTS "select_field_defs_own" ON field_definitions;
CREATE POLICY "select_field_defs_own" ON field_definitions FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_field_defs_perm" ON field_definitions;
CREATE POLICY "insert_field_defs_perm" ON field_definitions FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

DROP POLICY IF EXISTS "update_field_defs_perm" ON field_definitions;
CREATE POLICY "update_field_defs_perm" ON field_definitions FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

DROP POLICY IF EXISTS "delete_field_defs_perm" ON field_definitions;
CREATE POLICY "delete_field_defs_perm" ON field_definitions FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('manage_roles'));

-- FIELD_VALUES
DROP POLICY IF EXISTS "select_field_values_own" ON field_values;
CREATE POLICY "select_field_values_own" ON field_values FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_field_values_perm" ON field_values;
CREATE POLICY "insert_field_values_perm" ON field_values FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_field_values_perm" ON field_values;
CREATE POLICY "update_field_values_perm" ON field_values FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_field_values_perm" ON field_values;
CREATE POLICY "delete_field_values_perm" ON field_values FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_field_groups_company ON field_groups(company_id);
CREATE INDEX IF NOT EXISTS idx_field_groups_record_type ON field_groups(record_type);
CREATE INDEX IF NOT EXISTS idx_field_defs_company ON field_definitions(company_id);
CREATE INDEX IF NOT EXISTS idx_field_defs_group ON field_definitions(field_group_id);
CREATE INDEX IF NOT EXISTS idx_field_defs_record_type ON field_definitions(record_type);
CREATE INDEX IF NOT EXISTS idx_field_values_entity ON field_values(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_field_values_def ON field_values(field_definition_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at_field_groups ON field_groups;
CREATE TRIGGER set_updated_at_field_groups BEFORE UPDATE ON field_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_field_definitions ON field_definitions;
CREATE TRIGGER set_updated_at_field_definitions BEFORE UPDATE ON field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_field_values ON field_values;
CREATE TRIGGER set_updated_at_field_values BEFORE UPDATE ON field_values
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- SEED: Default Contact Types
-- ============================================================
INSERT INTO contact_types (company_id, name, is_default)
SELECT c.id, t.name, true
FROM companies c
CROSS JOIN (VALUES
  ('Seller'), ('Buyer'), ('Agent'), ('Title Company'), ('Title Contact'),
  ('Contractor'), ('Photographer'), ('Bird Dog'), ('Wholesaler'), ('Lender'),
  ('Attorney'), ('Other')
) AS t(name)
WHERE NOT EXISTS (
  SELECT 1 FROM contact_types ct WHERE ct.company_id = c.id AND ct.name = t.name
);

-- ============================================================
-- SEED: Default Field Groups + Field Definitions
-- ============================================================
-- Seller Information group (contact)
INSERT INTO field_groups (company_id, name, record_type, sort_order)
SELECT c.id, 'Seller Information', 'contact', 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM field_groups fg WHERE fg.company_id = c.id AND fg.name = 'Seller Information' AND fg.record_type = 'contact'
);

-- Motivation group (contact)
INSERT INTO field_groups (company_id, name, record_type, sort_order)
SELECT c.id, 'Motivation', 'contact', 2
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM field_groups fg WHERE fg.company_id = c.id AND fg.name = 'Motivation' AND fg.record_type = 'contact'
);

-- Property Information group (property)
INSERT INTO field_groups (company_id, name, record_type, sort_order)
SELECT c.id, 'Property Information', 'property', 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM field_groups fg WHERE fg.company_id = c.id AND fg.name = 'Property Information' AND fg.record_type = 'property'
);

-- Deal Information group (opportunity)
INSERT INTO field_groups (company_id, name, record_type, sort_order)
SELECT c.id, 'Deal Information', 'opportunity', 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM field_groups fg WHERE fg.company_id = c.id AND fg.name = 'Deal Information' AND fg.record_type = 'opportunity'
);

-- Closing Information group (opportunity)
INSERT INTO field_groups (company_id, name, record_type, sort_order)
SELECT c.id, 'Closing Information', 'opportunity', 2
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM field_groups fg WHERE fg.company_id = c.id AND fg.name = 'Closing Information' AND fg.record_type = 'opportunity'
);

-- Seed field definitions for Seller Information group
INSERT INTO field_definitions (company_id, field_group_id, key, label, field_type, sort_order, record_type)
SELECT c.id, fg.id, fd.key, fd.label, fd.field_type, fd.sort_order, 'contact'
FROM companies c
CROSS JOIN field_groups fg
CROSS JOIN (VALUES
  ('selling_timeline', 'Selling timeline', 'short_text', 1),
  ('preferred_contact_method', 'Preferred contact method', 'dropdown', 2),
  ('best_time_to_contact', 'Best time to contact', 'short_text', 3),
  ('asking_price', 'Asking price', 'currency', 4),
  ('mortgage_balance', 'Mortgage balance', 'currency', 5),
  ('liens', 'Liens', 'currency', 6),
  ('taxes_owed', 'Taxes owed', 'currency', 7)
) AS fd(key, label, field_type, sort_order)
WHERE fg.company_id = c.id
  AND fg.name = 'Seller Information'
  AND fg.record_type = 'contact'
  AND NOT EXISTS (
    SELECT 1 FROM field_definitions fdef
    WHERE fdef.field_group_id = fg.id AND fdef.key = fd.key
  );

-- Seed field definitions for Motivation group
INSERT INTO field_definitions (company_id, field_group_id, key, label, field_type, sort_order, record_type)
SELECT c.id, fg.id, fd.key, fd.label, fd.field_type, fd.sort_order, 'contact'
FROM companies c
CROSS JOIN field_groups fg
CROSS JOIN (VALUES
  ('motivation_level', 'Motivation level', 'dropdown', 1),
  ('motivation_notes', 'Motivation notes', 'long_text', 2)
) AS fd(key, label, field_type, sort_order)
WHERE fg.company_id = c.id
  AND fg.name = 'Motivation'
  AND fg.record_type = 'contact'
  AND NOT EXISTS (
    SELECT 1 FROM field_definitions fdef
    WHERE fdef.field_group_id = fg.id AND fdef.key = fd.key
  );

-- Seed field definitions for Property Information group
INSERT INTO field_definitions (company_id, field_group_id, key, label, field_type, sort_order, record_type)
SELECT c.id, fg.id, fd.key, fd.label, fd.field_type, fd.sort_order, 'property'
FROM companies c
CROSS JOIN field_groups fg
CROSS JOIN (VALUES
  ('estimated_current_value', 'Estimated current value', 'currency', 1),
  ('estimated_arv', 'Estimated ARV', 'currency', 2),
  ('photos_received', 'Photos received', 'checkbox', 3)
) AS fd(key, label, field_type, sort_order)
WHERE fg.company_id = c.id
  AND fg.name = 'Property Information'
  AND fg.record_type = 'property'
  AND NOT EXISTS (
    SELECT 1 FROM field_definitions fdef
    WHERE fdef.field_group_id = fg.id AND fdef.key = fd.key
  );

-- Seed field definitions for Deal Information group
INSERT INTO field_definitions (company_id, field_group_id, key, label, field_type, sort_order, record_type)
SELECT c.id, fg.id, fd.key, fd.label, fd.field_type, fd.sort_order, 'opportunity'
FROM companies c
CROSS JOIN field_groups fg
CROSS JOIN (VALUES
  ('offer_amount', 'Offer amount', 'currency', 1),
  ('maximum_allowable_offer', 'Maximum allowable offer', 'currency', 2),
  ('contract_price', 'Contract price', 'currency', 3),
  ('buyer_price', 'Buyer price', 'currency', 4),
  ('assignment_fee', 'Assignment fee', 'currency', 5),
  ('expected_gross_revenue', 'Expected gross revenue', 'currency', 6),
  ('actual_company_revenue', 'Actual company revenue', 'currency', 7)
) AS fd(key, label, field_type, sort_order)
WHERE fg.company_id = c.id
  AND fg.name = 'Deal Information'
  AND fg.record_type = 'opportunity'
  AND NOT EXISTS (
    SELECT 1 FROM field_definitions fdef
    WHERE fdef.field_group_id = fg.id AND fdef.key = fd.key
  );

-- Seed field definitions for Closing Information group
INSERT INTO field_definitions (company_id, field_group_id, key, label, field_type, sort_order, record_type)
SELECT c.id, fg.id, fd.key, fd.label, fd.field_type, fd.sort_order, 'opportunity'
FROM companies c
CROSS JOIN field_groups fg
CROSS JOIN (VALUES
  ('contract_signed_date', 'Contract signed date', 'date', 1),
  ('contract_expiration', 'Contract expiration', 'date', 2),
  ('inspection_period', 'Inspection period', 'short_text', 3),
  ('emd_amount', 'EMD amount', 'currency', 4),
  ('emd_due_date', 'EMD due date', 'date', 5),
  ('emd_received', 'EMD received', 'checkbox', 6),
  ('title_company', 'Title company', 'short_text', 7),
  ('closing_status', 'Closing status', 'dropdown', 8),
  ('final_payout_status', 'Final payout status', 'dropdown', 9)
) AS fd(key, label, field_type, sort_order)
WHERE fg.company_id = c.id
  AND fg.name = 'Closing Information'
  AND fg.record_type = 'opportunity'
  AND NOT EXISTS (
    SELECT 1 FROM field_definitions fdef
    WHERE fdef.field_group_id = fg.id AND fdef.key = fd.key
  );

-- ============================================================
-- SEED: New Permissions
-- ============================================================
INSERT INTO permissions (key, name, description, category)
VALUES
  ('view_properties', 'View Properties', 'View property records', 'Properties'),
  ('edit_properties', 'Edit Properties', 'Create and edit property records', 'Properties'),
  ('view_opportunities', 'View Opportunities', 'View opportunity records', 'Opportunities'),
  ('edit_opportunities', 'Edit Opportunities', 'Create and edit opportunity records', 'Opportunities'),
  ('view_tasks', 'View Tasks', 'View task records', 'Tasks'),
  ('edit_tasks', 'Edit Tasks', 'Create and edit task records', 'Tasks'),
  ('view_files', 'View Files', 'View uploaded files', 'Files'),
  ('upload_files', 'Upload Files', 'Upload files to storage', 'Files'),
  ('manage_custom_fields', 'Manage Custom Fields', 'Create and edit custom field definitions', 'Custom Fields'),
  ('export_contacts', 'Export Contacts', 'Export contacts to CSV', 'Contacts')
ON CONFLICT (key) DO NOTHING;

-- Grant new permissions to existing system roles (Admin and Director get everything)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true
  AND r.name IN ('Administrator', 'Director')
  AND p.key IN ('view_properties','edit_properties','view_opportunities','edit_opportunities','view_tasks','edit_tasks','view_files','upload_files','manage_custom_fields','export_contacts')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Grant view-level permissions to Acquisition Manager and Reps
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true
  AND r.name IN ('Acquisition Manager', 'Acquisition Rep')
  AND p.key IN ('view_properties','edit_properties','view_opportunities','edit_opportunities','view_tasks','edit_tasks','view_files','upload_files')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Grant view-level permissions to Disposition Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true
  AND r.name = 'Disposition Manager'
  AND p.key IN ('view_properties','view_opportunities','view_tasks','edit_tasks','view_files','upload_files')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Grant view-level permissions to Transaction Coordinator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true
  AND r.name = 'Transaction Coordinator'
  AND p.key IN ('view_properties','view_opportunities','view_tasks','edit_tasks','view_files','upload_files')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Grant view-level permissions to Read Only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true
  AND r.name = 'Read Only'
  AND p.key IN ('view_properties','view_opportunities','view_tasks','view_files')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );