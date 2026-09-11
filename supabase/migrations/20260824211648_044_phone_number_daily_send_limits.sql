/*
# Daily Send Limits for Phone Numbers

1. Modified Tables
   - `phone_numbers`
     - Added `daily_send_limit` (integer, nullable) - max messages per day from this number during ramp-up. NULL = unlimited.
     - Added `daily_sends_today` (integer, default 0) - counter of messages sent today.
     - Added `daily_sends_reset_at` (timestamptz) - when the daily counter was last reset (start of current day).

2. Notes
   - During carrier ramp-up, new numbers start with low daily limits (e.g. 50-100/day).
   - The drip processor checks this limit before sending and stops cleanly when hit.
   - The counter resets automatically when a new UTC day begins.
   - NULL daily_send_limit means no limit (fully ramped number).
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_numbers' AND column_name = 'daily_send_limit') THEN
    ALTER TABLE phone_numbers ADD COLUMN daily_send_limit integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_numbers' AND column_name = 'daily_sends_today') THEN
    ALTER TABLE phone_numbers ADD COLUMN daily_sends_today integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_numbers' AND column_name = 'daily_sends_reset_at') THEN
    ALTER TABLE phone_numbers ADD COLUMN daily_sends_reset_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
