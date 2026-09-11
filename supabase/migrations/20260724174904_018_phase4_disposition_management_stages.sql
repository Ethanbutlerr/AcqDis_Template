/*
# Phase 4 — Disposition & Management Pipeline Stage Tables

## Overview
Creates two new pipeline stage tables (disposition and management) and seeds all stages.
These are separate from the existing lead and acquisition pipeline stage tables.

## New Tables
- `disposition_pipeline_stages`: 13 stages for the wholesale disposition workflow
- `management_pipeline_stages`: 15 stages for the management control pipeline

## Stages Seeded

### Disposition (13):
New Deal → Waiting on Info/Photos → Contacted VIPs → Posted on FB → Posted on InvestorBase
→ Pulled List → SMS Blasted → Buyer Located → EMD Placed → Titlework Done
→ Closing Scheduled → Funded/Closed → Dead

### Management (15):
New Deal → Seller Contacted → Contract Sent → Contract Signed → Due Diligence
→ Title Ordered → Buyer Marketing Active → Buyer Under Contract → EMD Received
→ Title Clear → Closing Disclosure Sent → Closing Scheduled → Funded → Closed → Dead

## Notes
- `is_terminal` marks stages that end the workflow (Funded/Closed, Dead, Closed)
- `position` drives sort order in the kanban
- Both tables are company-scoped for future multi-tenant customization
*/

CREATE TABLE IF NOT EXISTS disposition_pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#6B7280',
  position    integer NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(company_id, position)
);

CREATE TABLE IF NOT EXISTS management_pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#6B7280',
  position    integer NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(company_id, position)
);

ALTER TABLE disposition_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_pipeline_stages  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_disp_stages"  ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "ins_disp_stages"  ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "upd_disp_stages"  ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "del_disp_stages"  ON disposition_pipeline_stages;

CREATE POLICY "sel_disp_stages" ON disposition_pipeline_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_disp_stages" ON disposition_pipeline_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_disp_stages" ON disposition_pipeline_stages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_disp_stages" ON disposition_pipeline_stages FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "sel_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "ins_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "upd_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "del_mgmt_stages" ON management_pipeline_stages;

CREATE POLICY "sel_mgmt_stages" ON management_pipeline_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_mgmt_stages" ON management_pipeline_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_mgmt_stages" ON management_pipeline_stages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_mgmt_stages" ON management_pipeline_stages FOR DELETE TO authenticated USING (true);

-- Seed stages
DO $$
DECLARE v_co uuid;
BEGIN
  SELECT id INTO v_co FROM companies LIMIT 1;
  IF v_co IS NULL THEN RETURN; END IF;

  INSERT INTO disposition_pipeline_stages (company_id, name, color, position, is_terminal) VALUES
    (v_co, 'New Deal',                '#6366f1', 1,  false),
    (v_co, 'Waiting on Info/Photos',  '#f59e0b', 2,  false),
    (v_co, 'Contacted VIPs',          '#8b5cf6', 3,  false),
    (v_co, 'Posted on FB',            '#3b82f6', 4,  false),
    (v_co, 'Posted on InvestorBase',  '#06b6d4', 5,  false),
    (v_co, 'Pulled List',             '#10b981', 6,  false),
    (v_co, 'SMS Blasted',             '#84cc16', 7,  false),
    (v_co, 'Buyer Located',           '#f97316', 8,  false),
    (v_co, 'EMD Placed',              '#ef4444', 9,  false),
    (v_co, 'Titlework Done',          '#ec4899', 10, false),
    (v_co, 'Closing Scheduled',       '#14b8a6', 11, false),
    (v_co, 'Funded/Closed',           '#22c55e', 12, true),
    (v_co, 'Dead',                    '#6b7280', 13, true)
  ON CONFLICT (company_id, position) DO NOTHING;

  INSERT INTO management_pipeline_stages (company_id, name, color, position, is_terminal) VALUES
    (v_co, 'New Deal',                 '#6366f1', 1,  false),
    (v_co, 'Needs Photos/Information', '#f59e0b', 2,  false),
    (v_co, 'Photo/Information Obtained','#8b5cf6',3,  false),
    (v_co, 'Needs Contract',           '#3b82f6', 4,  false),
    (v_co, 'Contract Executed',        '#06b6d4', 5,  false),
    (v_co, 'Needs Agent/Contract',     '#10b981', 6,  false),
    (v_co, 'Agent/Contractor Found',   '#84cc16', 7,  false),
    (v_co, 'Needs Buyer',              '#f97316', 8,  false),
    (v_co, 'Buyer Found',              '#ef4444', 9,  false),
    (v_co, 'Needs Title Company',      '#ec4899', 10, false),
    (v_co, 'Title Company Found',      '#14b8a6', 11, false),
    (v_co, 'Coordinating with Title',  '#0ea5e9', 12, false),
    (v_co, 'Closing Scheduled',        '#22c55e', 13, false),
    (v_co, 'Funded/Closed',            '#16a34a', 14, true),
    (v_co, 'Needs Pay Out',            '#9333ea', 15, false),
    (v_co, 'Paid Out',                 '#2563eb', 16, true),
    (v_co, 'Dead',                     '#6b7280', 17, true)
  ON CONFLICT (company_id, position) DO NOTHING;
END $$;

CREATE INDEX IF NOT EXISTS idx_disp_stages_company ON disposition_pipeline_stages(company_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_stages_company ON management_pipeline_stages(company_id);
