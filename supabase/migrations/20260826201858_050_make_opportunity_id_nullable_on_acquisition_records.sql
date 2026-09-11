/*
# Make opportunity_id nullable on acquisition_records

## Changes
- Alters `acquisition_records.opportunity_id` from NOT NULL to nullable
- This aligns with how the app actually creates acquisition records (the Add Lead form
  on the acquisitions page inserts directly without an opportunity)
- Allows bulk imports to create acquisition records without needing a separate opportunity

## Modified Tables
- `acquisition_records`: `opportunity_id` column changed from NOT NULL to NULL allowed

## Security
- No RLS or policy changes
*/

ALTER TABLE acquisition_records ALTER COLUMN opportunity_id DROP NOT NULL;
