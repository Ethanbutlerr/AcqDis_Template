/*
# Add current_period_end column to companies

1. Modified Tables
   - `companies` - Added `current_period_end` (timestamptz) to track when the current billing period ends

2. Important Notes
   - Used by Stripe webhook to track subscription period
   - Nullable since trial accounts won't have this set
*/

ALTER TABLE companies ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
