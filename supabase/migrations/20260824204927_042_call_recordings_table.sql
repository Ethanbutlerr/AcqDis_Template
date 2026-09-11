/*
# Call Recordings Table

1. New Tables
   - `call_recordings`
     - `id` (uuid, primary key)
     - `company_id` (uuid, FK to companies)
     - `call_sid` (text, Twilio Call SID)
     - `recording_sid` (text, Twilio Recording SID)
     - `recording_url` (text, URL to the recording audio)
     - `duration_seconds` (integer, recording length)
     - `from_number` (text, caller)
     - `to_number` (text, called party)
     - `user_id` (uuid, the agent who placed the call)
     - `created_at` (timestamptz)

2. Security
   - RLS enabled, scoped to authenticated users within same company.
   - Separate SELECT/INSERT/UPDATE/DELETE policies.

3. Notes
   - Recordings are stored by Twilio; we store the metadata + URL reference.
   - The recording status callback writes rows via service role key (edge function).
*/

CREATE TABLE IF NOT EXISTS call_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  call_sid text NOT NULL,
  recording_sid text,
  recording_url text,
  duration_seconds integer,
  from_number text,
  to_number text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_company ON call_recordings(company_id);
CREATE INDEX IF NOT EXISTS idx_call_recordings_call_sid ON call_recordings(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_recordings_user ON call_recordings(user_id);

ALTER TABLE call_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_call_recordings" ON call_recordings;
CREATE POLICY "select_call_recordings" ON call_recordings FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_call_recordings" ON call_recordings;
CREATE POLICY "insert_call_recordings" ON call_recordings FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_call_recordings" ON call_recordings;
CREATE POLICY "update_call_recordings" ON call_recordings FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_call_recordings" ON call_recordings;
CREATE POLICY "delete_call_recordings" ON call_recordings FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()
    )
  );
