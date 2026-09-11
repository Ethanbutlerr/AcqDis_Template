/*
# Add Dead/DNC pipeline stage and fix imported lead sources

1. Changes
   - Inserts a "Dead/DNC" stage at position 11 in the acquisition pipeline for all companies
   - Updates all acquisition_records with lead_source 'csv_import' to 'Expired Inbound'
   - Updates all contacts with lead_source 'csv_import' to 'Expired Inbound'

2. Important Notes
   - The Dead/DNC stage will auto-assign leads to the user who moves them there
     (handled by existing frontend logic in the autoAssignStages array)
   - This is non-destructive: only adds new rows and updates text values
*/

-- Add Dead/DNC stage for every company, pulling the pipeline_definition_id from existing stages
INSERT INTO acquisition_pipeline_stages (company_id, pipeline_definition_id, name, sort_order)
SELECT DISTINCT company_id, pipeline_definition_id, 'Dead/DNC', 11
FROM acquisition_pipeline_stages
WHERE NOT EXISTS (
  SELECT 1 FROM acquisition_pipeline_stages aps2
  WHERE aps2.company_id = acquisition_pipeline_stages.company_id
  AND aps2.name = 'Dead/DNC'
);

-- Update existing imported records lead_source from 'csv_import' to 'Expired Inbound'
UPDATE acquisition_records SET lead_source = 'Expired Inbound' WHERE lead_source = 'csv_import';
UPDATE contacts SET lead_source = 'Expired Inbound' WHERE lead_source = 'csv_import';
