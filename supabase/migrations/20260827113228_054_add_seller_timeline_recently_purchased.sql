/*
# Add missing seller lead fields: timeline and recently_purchased

1. Modified Tables
   - `acquisition_records`
     - `seller_timeline` (text, nullable) - seller's timeline to sell
     - `recently_purchased` (boolean, nullable) - whether property was purchased in last 5 years
   - `properties`
     - `recently_purchased` (boolean, nullable) - whether property was purchased in last 5 years

2. Important Notes
   - These fields match the user's original spreadsheet columns (Timeline, Recently Purchased)
   - They were missing from the original import schema
   - Opinion of Value maps to existing `estimated_value` on properties
   - Condition maps to existing `property_condition` on properties
   - Property Listed maps to existing `is_listed` on properties
   - Agent Involved maps to existing `has_agent` on properties
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'acquisition_records' AND column_name = 'seller_timeline') THEN
    ALTER TABLE acquisition_records ADD COLUMN seller_timeline text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'recently_purchased') THEN
    ALTER TABLE properties ADD COLUMN recently_purchased boolean;
  END IF;
END $$;
