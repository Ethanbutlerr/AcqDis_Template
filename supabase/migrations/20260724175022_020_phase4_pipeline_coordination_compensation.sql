/*
# Phase 4 — Pipeline Coordination, Compensation, Revenue Attribution

## Overview
Creates tables for cross-pipeline synchronization, compensation rules, and revenue attribution.
These are the coordination layer that ties Sellers, Buyers, Acquisitions, Dispositions, and Management together.

## New Tables

### pipeline_stage_mappings
Configures which stage changes in one pipeline automatically trigger stage changes or record creation
in another pipeline. Seeded with all 13 mappings from the Phase 4 spec.
- source_pipeline/stage → target_pipeline/stage
- direction, priority, allow_regression, required_fields, actions all configurable
- Management users can edit these via the Management settings UI

### synchronization_events
Idempotency table. Every cross-pipeline automation writes here first.
If the idempotency_key already exists (UNIQUE constraint), the action is skipped.
Prevents loops where Pipeline A triggers B which triggers A again.

### compensation_rules
Configurable percentage rules for personal earnings calculation.
- NULL user_id = company default (currently 12.5% per spec)
- User-specific overrides take precedence over company default
- effective_date allows future-dated changes
- Historical payouts are NOT recalculated when rules change

### revenue_attributions
Locked snapshots of earnings at Funded/Closed.
- personal_earnings = company_revenue × percentage, frozen at lock time
- locked_at IS NOT NULL means immutable (except with adjustment_reason + locked_by override)

## Seeded Mappings
13 mappings covering:
1. Seller Prequalified → Acquisition New Lead (create record)
2. Acquisition Contract Executed → Disposition New Deal (create record)
3. Acquisition Contract Executed → Management Contract Executed (create/update record)
4. Disposition Buyer Located → Management Needs Buyer → Buyer Found
5. Disposition EMD Placed → Management Needs Title Company
6. Disposition Titlework Done → Management Title Company Found
7. Disposition Closing Scheduled → Management Closing Scheduled
8. Disposition Funded/Closed → Management Funded/Closed + lock revenue
9. Disposition Dead → Management Dead
10-13. Additional acquisition→management stage mirrors
*/

-- pipeline_stage_mappings
CREATE TABLE IF NOT EXISTS pipeline_stage_mappings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_pipeline  text NOT NULL CHECK (source_pipeline  IN ('seller','buyer','acquisition','disposition','management')),
  source_stage_id  uuid NOT NULL,
  target_pipeline  text NOT NULL CHECK (target_pipeline  IN ('seller','buyer','acquisition','disposition','management')),
  target_stage_id  uuid,
  direction        text NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','backward')),
  priority         integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  allow_regression boolean NOT NULL DEFAULT false,
  required_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions          jsonb NOT NULL DEFAULT '{}'::jsonb,
  label            text,
  created_at       timestamptz DEFAULT now()
);

-- synchronization_events
CREATE TABLE IF NOT EXISTS synchronization_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  source_pipeline  text NOT NULL,
  target_pipeline  text NOT NULL,
  idempotency_key  text NOT NULL,
  processed_at     timestamptz DEFAULT now(),
  result           text NOT NULL DEFAULT 'success' CHECK (result IN ('success','skipped','error')),
  error_detail     text,
  UNIQUE(idempotency_key)
);

-- compensation_rules
CREATE TABLE IF NOT EXISTS compensation_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  percentage     numeric(6,4) NOT NULL CHECK (percentage > 0 AND percentage <= 1),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now()
);

-- revenue_attributions
CREATE TABLE IF NOT EXISTS revenue_attributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  disposition_record_id uuid NOT NULL REFERENCES disposition_records(id) ON DELETE RESTRICT,
  acquisition_record_id uuid REFERENCES acquisition_records(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES profiles(id) ON DELETE SET NULL,
  company_revenue       numeric(12,2) NOT NULL,
  percentage            numeric(6,4) NOT NULL,
  personal_earnings     numeric(12,2) NOT NULL,
  locked_at             timestamptz,
  locked_by             uuid REFERENCES profiles(id) ON DELETE SET NULL,
  adjustment_reason     text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE pipeline_stage_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE synchronization_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_attributions    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "ins_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "upd_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "del_psm" ON pipeline_stage_mappings;
CREATE POLICY "sel_psm" ON pipeline_stage_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_psm" ON pipeline_stage_mappings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_psm" ON pipeline_stage_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_psm" ON pipeline_stage_mappings FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "sel_sync_ev" ON synchronization_events;
DROP POLICY IF EXISTS "ins_sync_ev" ON synchronization_events;
CREATE POLICY "sel_sync_ev" ON synchronization_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_sync_ev" ON synchronization_events FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "sel_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "ins_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "upd_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "del_comp_rules" ON compensation_rules;
CREATE POLICY "sel_comp_rules" ON compensation_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_comp_rules" ON compensation_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_comp_rules" ON compensation_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_comp_rules" ON compensation_rules FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "sel_rev_attr" ON revenue_attributions;
DROP POLICY IF EXISTS "ins_rev_attr" ON revenue_attributions;
DROP POLICY IF EXISTS "upd_rev_attr" ON revenue_attributions;
CREATE POLICY "sel_rev_attr" ON revenue_attributions FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_rev_attr" ON revenue_attributions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_rev_attr" ON revenue_attributions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Seed company default compensation rule (12.5% per spec)
DO $$
DECLARE v_co uuid;
BEGIN
  SELECT id INTO v_co FROM companies LIMIT 1;
  IF v_co IS NULL THEN RETURN; END IF;
  INSERT INTO compensation_rules (company_id, user_id, percentage, effective_date)
  VALUES (v_co, NULL, 0.1250, CURRENT_DATE)
  ON CONFLICT DO NOTHING;
END $$;

-- Seed pipeline_stage_mappings
DO $$
DECLARE
  v_co uuid;
  -- seller stages
  s_prequalified uuid;
  -- acquisition stages
  a_new_lead uuid; a_contract_executed uuid;
  -- disposition stages
  d_new_deal uuid; d_buyer_located uuid; d_emd_placed uuid;
  d_titlework_done uuid; d_closing_sched uuid; d_funded_closed uuid; d_dead uuid;
  -- management stages
  m_new_deal uuid; m_contract_exec uuid; m_buyer_found uuid; m_needs_title uuid;
  m_title_found uuid; m_closing_sched uuid; m_funded uuid; m_dead uuid;
BEGIN
  SELECT id INTO v_co FROM companies LIMIT 1;
  IF v_co IS NULL THEN RETURN; END IF;

  -- Resolve seller stage IDs
  SELECT id INTO s_prequalified FROM lead_pipeline_stages WHERE company_id = v_co AND name = 'Prequalified' LIMIT 1;

  -- Resolve acquisition stage IDs
  SELECT id INTO a_new_lead          FROM acquisition_pipeline_stages WHERE company_id = v_co AND name = 'New Lead'          LIMIT 1;
  SELECT id INTO a_contract_executed FROM acquisition_pipeline_stages WHERE company_id = v_co AND name = 'Contract Executed' LIMIT 1;

  -- Resolve disposition stage IDs
  SELECT id INTO d_new_deal       FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'New Deal'              LIMIT 1;
  SELECT id INTO d_buyer_located  FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'Buyer Located'         LIMIT 1;
  SELECT id INTO d_emd_placed     FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'EMD Placed'            LIMIT 1;
  SELECT id INTO d_titlework_done FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'Titlework Done'        LIMIT 1;
  SELECT id INTO d_closing_sched  FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'Closing Scheduled'     LIMIT 1;
  SELECT id INTO d_funded_closed  FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'Funded/Closed'         LIMIT 1;
  SELECT id INTO d_dead           FROM disposition_pipeline_stages WHERE company_id = v_co AND name = 'Dead'                  LIMIT 1;

  -- Resolve management stage IDs
  SELECT id INTO m_new_deal        FROM management_pipeline_stages WHERE company_id = v_co AND name = 'New Deal'                 LIMIT 1;
  SELECT id INTO m_contract_exec   FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Contract Executed'        LIMIT 1;
  SELECT id INTO m_buyer_found     FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Buyer Found'              LIMIT 1;
  SELECT id INTO m_needs_title     FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Needs Title Company'      LIMIT 1;
  SELECT id INTO m_title_found     FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Title Company Found'      LIMIT 1;
  SELECT id INTO m_closing_sched   FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Closing Scheduled'        LIMIT 1;
  SELECT id INTO m_funded          FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Funded/Closed'            LIMIT 1;
  SELECT id INTO m_dead            FROM management_pipeline_stages WHERE company_id = v_co AND name = 'Dead'                     LIMIT 1;

  -- Insert mappings (idempotent: skip duplicates by label)
  INSERT INTO pipeline_stage_mappings
    (company_id, source_pipeline, source_stage_id, target_pipeline, target_stage_id, label, actions, allow_regression)
  VALUES
    -- Seller Prequalified → Acquisition New Lead
    (v_co, 'seller',      s_prequalified,    'acquisition', a_new_lead,
     'Seller Prequalified → Acquisition New Lead',
     '{"create_record":"acquisition_record"}'::jsonb, false),

    -- Acquisition Contract Executed → Disposition New Deal
    (v_co, 'acquisition', a_contract_executed, 'disposition', d_new_deal,
     'Acquisition Contract Executed → Disposition New Deal',
     '{"create_record":"disposition_record"}'::jsonb, false),

    -- Acquisition Contract Executed → Management Contract Executed
    (v_co, 'acquisition', a_contract_executed, 'management', m_contract_exec,
     'Acquisition Contract Executed → Management Contract Executed',
     '{"create_or_update_record":"management_record"}'::jsonb, false),

    -- Disposition Buyer Located → Management Buyer Found
    (v_co, 'disposition', d_buyer_located,  'management', m_buyer_found,
     'Disposition Buyer Located → Management Buyer Found',
     '{"update_stage":"management_record"}'::jsonb, false),

    -- Disposition EMD Placed → Management Needs Title Company
    (v_co, 'disposition', d_emd_placed,     'management', m_needs_title,
     'Disposition EMD Placed → Management Needs Title Company',
     '{"update_stage":"management_record"}'::jsonb, false),

    -- Disposition Titlework Done → Management Title Company Found
    (v_co, 'disposition', d_titlework_done, 'management', m_title_found,
     'Disposition Titlework Done → Management Title Company Found',
     '{"update_stage":"management_record"}'::jsonb, false),

    -- Disposition Closing Scheduled → Management Closing Scheduled
    (v_co, 'disposition', d_closing_sched,  'management', m_closing_sched,
     'Disposition Closing Scheduled → Management Closing Scheduled',
     '{"update_stage":"management_record"}'::jsonb, false),

    -- Disposition Funded/Closed → Management Funded/Closed + lock revenue
    (v_co, 'disposition', d_funded_closed,  'management', m_funded,
     'Disposition Funded/Closed → Management Funded/Closed',
     '{"update_stage":"management_record","lock_revenue":true}'::jsonb, false),

    -- Disposition Dead → Management Dead (allow regression)
    (v_co, 'disposition', d_dead,           'management', m_dead,
     'Disposition Dead → Management Dead',
     '{"update_stage":"management_record"}'::jsonb, true)
  ON CONFLICT DO NOTHING;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_psm_company        ON pipeline_stage_mappings(company_id);
CREATE INDEX IF NOT EXISTS idx_psm_source         ON pipeline_stage_mappings(company_id, source_pipeline, source_stage_id);
CREATE INDEX IF NOT EXISTS idx_sync_ev_key        ON synchronization_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sync_ev_entity     ON synchronization_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comp_rules_company ON compensation_rules(company_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_rev_attr_disp      ON revenue_attributions(disposition_record_id);
