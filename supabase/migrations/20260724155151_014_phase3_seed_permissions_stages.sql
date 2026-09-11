/*
# Phase 3 — Seed Permissions, Pipeline Stages, Default Campaign Templates

## Overview
1. Seeds 16 new permissions for the Lead Pipeline.
2. Creates default pipeline definitions and 11 system stages for existing companies.
3. Seeds default message templates for seller outreach.
4. Grants permissions to existing system roles.
5. Seeds a mock shared acquisition phone number for each company.

## New Permissions
- view_lead_pipeline, edit_lead_pipeline, upload_seller_lists, import_leads, export_leads
- create_lead_campaigns, edit_lead_campaigns, start_campaigns, pause_campaigns
- assign_leads, move_leads_to_acquisitions, suppress_contacts, restore_suppressed_contacts
- view_management_lead_control, manage_message_templates, view_campaign_analytics

## Pipeline Stages (in exact order)
1. New Upload  2. Needs Review  3. Ready for Outreach  4. Drip Active
5. Response Received  6. Assigned to Acquisitions  7. Moved to Acquisitions
8. No Response  9. Opted Out / DNC  10. Bad Data  11. Archived
*/

-- ============================================================
-- SEED: New Permissions
-- ============================================================
INSERT INTO permissions (key, name, description, category)
VALUES
  ('view_lead_pipeline', 'View Lead Pipeline', 'View the seller lead pipeline', 'Lead Pipeline'),
  ('edit_lead_pipeline', 'Edit Lead Pipeline', 'Edit lead records and pipeline stages', 'Lead Pipeline'),
  ('upload_seller_lists', 'Upload Seller Lists', 'Upload seller list CSV files', 'Lead Pipeline'),
  ('import_leads', 'Import Leads', 'Import leads from CSV files', 'Lead Pipeline'),
  ('export_leads', 'Export Leads', 'Export leads to CSV', 'Lead Pipeline'),
  ('create_lead_campaigns', 'Create Lead Campaigns', 'Create SMS drip campaigns', 'Lead Pipeline'),
  ('edit_lead_campaigns', 'Edit Lead Campaigns', 'Edit campaign configuration', 'Lead Pipeline'),
  ('start_campaigns', 'Start Campaigns', 'Activate and start campaigns', 'Lead Pipeline'),
  ('pause_campaigns', 'Pause Campaigns', 'Pause active campaigns', 'Lead Pipeline'),
  ('assign_leads', 'Assign Leads', 'Assign leads to users and teams', 'Lead Pipeline'),
  ('move_leads_to_acquisitions', 'Move Leads to Acquisitions', 'Move leads to the acquisitions pipeline', 'Lead Pipeline'),
  ('suppress_contacts', 'Suppress Contacts', 'Add contacts to suppression list', 'Lead Pipeline'),
  ('restore_suppressed_contacts', 'Restore Suppressed Contacts', 'Remove contacts from suppression list', 'Lead Pipeline'),
  ('view_management_lead_control', 'View Management Lead Control', 'View management lead control section', 'Management'),
  ('manage_message_templates', 'Manage Message Templates', 'Create and edit SMS message templates', 'Lead Pipeline'),
  ('view_campaign_analytics', 'View Campaign Analytics', 'View campaign performance analytics', 'Lead Pipeline')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- GRANT: Permissions to system roles
-- ============================================================

-- Administrator gets everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Administrator'
  AND p.key IN (
    'view_lead_pipeline','edit_lead_pipeline','upload_seller_lists','import_leads','export_leads',
    'create_lead_campaigns','edit_lead_campaigns','start_campaigns','pause_campaigns',
    'assign_leads','move_leads_to_acquisitions','suppress_contacts','restore_suppressed_contacts',
    'view_management_lead_control','manage_message_templates','view_campaign_analytics'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Director gets most things
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Director'
  AND p.key IN (
    'view_lead_pipeline','edit_lead_pipeline','upload_seller_lists','import_leads','export_leads',
    'create_lead_campaigns','edit_lead_campaigns','start_campaigns','pause_campaigns',
    'assign_leads','move_leads_to_acquisitions','suppress_contacts','restore_suppressed_contacts',
    'view_management_lead_control','manage_message_templates','view_campaign_analytics'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Acquisition Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Acquisition Manager'
  AND p.key IN (
    'view_lead_pipeline','edit_lead_pipeline','upload_seller_lists','import_leads',
    'create_lead_campaigns','edit_lead_campaigns','start_campaigns','pause_campaigns',
    'assign_leads','move_leads_to_acquisitions','manage_message_templates','view_campaign_analytics'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Acquisition Rep
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Acquisition Rep'
  AND p.key IN (
    'view_lead_pipeline','edit_lead_pipeline','assign_leads','view_campaign_analytics'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Disposition Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Disposition Manager'
  AND p.key IN ('view_lead_pipeline')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Transaction Coordinator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Transaction Coordinator'
  AND p.key IN ('view_lead_pipeline')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Read Only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system = true AND r.name = 'Read Only'
  AND p.key IN ('view_lead_pipeline','view_campaign_analytics')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ============================================================
-- SEED: Default Pipeline Definitions + Stages
-- ============================================================

-- Create default pipeline definition for each company
INSERT INTO lead_pipeline_definitions (company_id, name, is_default)
SELECT c.id, 'Seller Lead Pipeline', true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM lead_pipeline_definitions lpd WHERE lpd.company_id = c.id AND lpd.name = 'Seller Lead Pipeline'
);

-- Seed 11 system stages for each pipeline definition
INSERT INTO lead_pipeline_stages (pipeline_definition_id, company_id, name, sort_order, is_system, color)
SELECT lpd.id, lpd.company_id, s.name, s.sort_order, true, s.color
FROM lead_pipeline_definitions lpd
CROSS JOIN (VALUES
  ('New Upload', 1, '#3b82f6'),
  ('Needs Review', 2, '#f59e0b'),
  ('Ready for Outreach', 3, '#10b981'),
  ('Drip Active', 4, '#8b5cf6'),
  ('Response Received', 5, '#ef4444'),
  ('Assigned to Acquisitions', 6, '#06b6d4'),
  ('Moved to Acquisitions', 7, '#14b8a6'),
  ('No Response', 8, '#6b7280'),
  ('Opted Out / DNC', 9, '#dc2626'),
  ('Bad Data', 10, '#78716c'),
  ('Archived', 11, '#9ca3af')
) AS s(name, sort_order, color)
WHERE NOT EXISTS (
  SELECT 1 FROM lead_pipeline_stages lps
  WHERE lps.pipeline_definition_id = lpd.id AND lps.name = s.name
);

-- ============================================================
-- SEED: Default Message Templates
-- ============================================================
INSERT INTO message_templates (company_id, name, body, category, variables)
SELECT c.id, t.name, t.body, 'seller_outreach', t.variables
FROM companies c
CROSS JOIN (VALUES
  ('Initial Seller Outreach', 'Hi {first_name}, this is {company_name}. We buy properties in {city} and surrounding areas. Are you open to a cash offer for your property at {property_address}? Reply YES if interested or STOP to opt out.', ARRAY['first_name','company_name','city','property_address']),
  ('Follow-up Day 1', 'Hi {first_name}, just following up on my text about your property at {property_address}. We can close quickly with no fees. Reply if interested or STOP to opt out.', ARRAY['first_name','property_address']),
  ('Follow-up Day 2', 'Hi {first_name}, still interested in your property at {property_address}. We can make a fair cash offer this week. Reply to chat or STOP to opt out.', ARRAY['first_name','property_address']),
  ('Final Follow-up', 'Hi {first_name}, last reach-out regarding {property_address}. If circumstances change, save my number. Text STOP to opt out.', ARRAY['first_name','property_address'])
) AS t(name, body, variables)
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates mt WHERE mt.company_id = c.id AND mt.name = t.name
);

-- ============================================================
-- SEED: Mock Shared Acquisition Phone Number
-- ============================================================
INSERT INTO phone_numbers (company_id, number, number_type, label, is_active, is_mock)
SELECT c.id, '+1' || lpad((floor(random() * 9000000000 + 1000000000))::text, 10, '0'),
  'shared_acquisition_automation', 'Shared Acquisition Number (Mock)', true, true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM phone_numbers pn
  WHERE pn.company_id = c.id AND pn.number_type = 'shared_acquisition_automation'
);