/*
# Add is_default flag to phone_numbers

1. Modified Tables
   - `phone_numbers`: added `is_default` boolean column (default false)
   - This marks one number per company as the fallback sender when no user-assigned number is available.

2. Important Notes
   - Only one number per company should be marked is_default at a time (enforced at application level).
   - Existing numbers default to false.
*/

ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
