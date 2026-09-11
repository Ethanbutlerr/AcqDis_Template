/*
# Force all acquisition record lead_sources to Expired Inbound

1. Changes
   - Updates ALL acquisition_records to have lead_source = 'Expired Inbound'
     (previously these contained company names from the CSV import)
   - Updates corresponding contacts lead_source to 'Expired Inbound' as well

2. Important Notes
   - This is a bulk text update, no data loss
   - All records that were imported via CSV had company names as their source
   - Going forward the import wizard will always set 'Expired Inbound'
*/

UPDATE acquisition_records SET lead_source = 'Expired Inbound' WHERE lead_source IS DISTINCT FROM 'Expired Inbound';
UPDATE contacts SET lead_source = 'Expired Inbound' WHERE id IN (
  SELECT DISTINCT contact_id FROM acquisition_records WHERE contact_id IS NOT NULL
);
