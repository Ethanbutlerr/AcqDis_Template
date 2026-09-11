/*
# Sellers & Buyers Pipelines — Split lead_pipeline_definitions by list_type

Adds list_type to distinguish seller vs buyer pipelines.
Adds lead_type to lead_records to distinguish seller vs buyer records.
Seeds a Buyer pipeline with 6 buyer-appropriate stages.
Updates the existing Sellers pipeline name.
*/

-- Add list_type to pipeline definitions
ALTER TABLE lead_pipeline_definitions
  ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'seller'
    CHECK (list_type IN ('seller', 'buyer'));

-- Add lead_type to lead_records
ALTER TABLE lead_records
  ADD COLUMN IF NOT EXISTS lead_type text NOT NULL DEFAULT 'seller'
    CHECK (lead_type IN ('seller', 'buyer'));

-- Rename existing pipeline to Sellers Pipeline
UPDATE lead_pipeline_definitions
SET name = 'Sellers Pipeline', list_type = 'seller', updated_at = now()
WHERE name = 'Prospects Pipeline' OR name = 'Sellers Pipeline' OR (list_type = 'seller');

-- Seed Buyer pipeline + stages
DO $$
DECLARE
  v_company_id uuid;
  v_pipeline_id uuid;
BEGIN
  SELECT id INTO v_company_id FROM companies LIMIT 1;
  IF v_company_id IS NULL THEN RETURN; END IF;

  -- Create buyer pipeline definition
  INSERT INTO lead_pipeline_definitions (company_id, name, is_default, list_type)
  VALUES (v_company_id, 'Buyers Pipeline', false, 'buyer')
  ON CONFLICT (company_id, name) DO NOTHING;

  SELECT id INTO v_pipeline_id FROM lead_pipeline_definitions
  WHERE company_id = v_company_id AND list_type = 'buyer' LIMIT 1;

  IF v_pipeline_id IS NULL THEN RETURN; END IF;

  -- Seed buyer stages
  INSERT INTO lead_pipeline_stages (pipeline_definition_id, company_id, name, sort_order, color, is_system)
  VALUES
    (v_pipeline_id, v_company_id, 'New Buyer',       1, '#3b82f6', true),
    (v_pipeline_id, v_company_id, 'Contacted',        2, '#8b5cf6', true),
    (v_pipeline_id, v_company_id, 'Qualified',         3, '#22c55e', true),
    (v_pipeline_id, v_company_id, 'Active Buyer',     4, '#06b6d4', true),
    (v_pipeline_id, v_company_id, 'Under Contract',   5, '#f59e0b', true),
    (v_pipeline_id, v_company_id, 'Closed',           6, '#16a34a', true),
    (v_pipeline_id, v_company_id, 'Not Interested',   7, '#dc2626', true)
  ON CONFLICT (pipeline_definition_id, name) DO NOTHING;
END $$;

-- Index on new column
CREATE INDEX IF NOT EXISTS idx_lead_records_lead_type ON lead_records(lead_type);
CREATE INDEX IF NOT EXISTS idx_lead_pd_list_type ON lead_pipeline_definitions(list_type);
