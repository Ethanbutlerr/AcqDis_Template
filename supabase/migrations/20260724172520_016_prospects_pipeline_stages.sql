/*
# Phase 4 — Rename Lead Pipeline to Prospects + Replace Stages

## Overview
Replaces the old lead pipeline stages with 6 new stages oriented for cold outreach
to seller & buyer lists: New Prospect, SMS Sent, Interested, Uninterested, Prequalified, Disqualified.
The pipeline definition name is updated to "Prospects Pipeline".

## Changes
1. Deletes old lead_pipeline_stages rows (11 stages from seed data).
2. Inserts 6 new stages in exact order with appropriate colors.
3. Updates the pipeline definition name to "Prospects Pipeline".
4. lead_records that referenced old stages will have pipeline_stage_id set to the first new stage.

## Important Notes
- Only affects lead_pipeline_stages, not acquisition_pipeline_stages.
- Prequalified is the hand-off stage — records in this stage can be promoted to Acquisitions or Dispositions.
- Disqualified and Uninterested are terminal stages.
*/

DO $$
DECLARE
  v_pipeline_id uuid;
  v_company_id uuid;
  v_new_prospect_id uuid;
BEGIN
  SELECT id INTO v_company_id FROM companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN; END IF;

  -- Get the pipeline definition
  SELECT id INTO v_pipeline_id FROM lead_pipeline_definitions
  WHERE company_id = v_company_id LIMIT 1;

  IF v_pipeline_id IS NULL THEN RETURN; END IF;

  -- Update the pipeline name
  UPDATE lead_pipeline_definitions
  SET name = 'Prospects Pipeline', updated_at = now()
  WHERE id = v_pipeline_id;

  -- Delete old stages (cascades safely since we're replacing all)
  DELETE FROM lead_pipeline_stages WHERE pipeline_definition_id = v_pipeline_id;

  -- Insert 6 new stages
  INSERT INTO lead_pipeline_stages (pipeline_definition_id, company_id, name, sort_order, color, is_system)
  VALUES
    (v_pipeline_id, v_company_id, 'New Prospect',   1, '#3b82f6', true),
    (v_pipeline_id, v_company_id, 'SMS Sent',        2, '#8b5cf6', true),
    (v_pipeline_id, v_company_id, 'Interested',      3, '#22c55e', true),
    (v_pipeline_id, v_company_id, 'Uninterested',    4, '#f59e0b', true),
    (v_pipeline_id, v_company_id, 'Prequalified',    5, '#06b6d4', true),
    (v_pipeline_id, v_company_id, 'Disqualified',    6, '#dc2626', true);

  -- Get the New Prospect stage id
  SELECT id INTO v_new_prospect_id FROM lead_pipeline_stages
  WHERE pipeline_definition_id = v_pipeline_id AND name = 'New Prospect';

  -- Move any lead_records with a now-deleted stage to New Prospect
  UPDATE lead_records
  SET pipeline_stage_id = v_new_prospect_id, updated_at = now()
  WHERE company_id = v_company_id
    AND (pipeline_stage_id IS NULL OR pipeline_stage_id NOT IN (
      SELECT id FROM lead_pipeline_stages WHERE pipeline_definition_id = v_pipeline_id
    ));
END $$;
