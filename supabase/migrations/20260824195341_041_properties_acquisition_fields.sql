/*
# Add acquisition intake fields to properties and acquisition_records

1. Modified Tables
   - `properties`: Add `asking_price`, `estimated_value`, `is_listed`, `has_agent` columns
   - `acquisition_records`: Add `metadata` jsonb column for flexible extra data (timeline, recently_purchased, lead_id)

2. Important Notes
   - All new columns are nullable to avoid breaking existing rows
   - `asking_price` on properties is the seller's listed/stated price
   - `estimated_value` is the team's opinion of value (OOV)
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'asking_price') THEN
    ALTER TABLE properties ADD COLUMN asking_price numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'estimated_value') THEN
    ALTER TABLE properties ADD COLUMN estimated_value numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'is_listed') THEN
    ALTER TABLE properties ADD COLUMN is_listed boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'has_agent') THEN
    ALTER TABLE properties ADD COLUMN has_agent boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'acquisition_records' AND column_name = 'metadata') THEN
    ALTER TABLE acquisition_records ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;
