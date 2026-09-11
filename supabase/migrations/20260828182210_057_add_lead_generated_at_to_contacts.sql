/*
# Add lead_generated_at to contacts

1. Modified Tables
   - `contacts`: Added `lead_generated_at` (timestamptz, nullable)
     - Represents when the lead was originally generated (e.g. from a list provider)
     - Falls back to `created_at` for display when null

2. Important Notes
   - For existing imported contacts, we cannot recover the original generation date
   - New imports should populate this field from the spreadsheet date column
   - UI will prefer this field over created_at when showing "Created Date"
*/

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_generated_at timestamptz;
