/*
# Message Attachments and SMS Compliance Support

## Overview
Adds support for email/SMS attachments on messages and stores compliance
configuration for SMS messaging.

## 1. New Tables
- `message_attachments`
  - `id` (uuid, primary key)
  - `company_id` (uuid, references companies)
  - `message_id` (uuid, references messages)
  - `filename` (text) — original file name
  - `content_type` (text) — MIME type
  - `size_bytes` (bigint) — file size
  - `storage_path` (text) — path in Supabase storage
  - `url` (text) — public or signed URL
  - `source` (text) — 'upload', 'inbound_email', 'inbound_mms'
  - `created_at` (timestamptz)

## 2. Modified Tables
- `messages` — add `subject` column for email subjects,
  add `channel` column to distinguish sms/email/note at message level,
  add `has_attachments` boolean for quick filtering

## 3. New Storage Bucket
- `message-attachments` — for uploaded and inbound attachments

## 4. Security
- RLS on `message_attachments` scoped to authenticated users via company membership
- Storage policies for message-attachments bucket
*/

-- Add columns to messages
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'subject') THEN
    ALTER TABLE messages ADD COLUMN subject text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'channel') THEN
    ALTER TABLE messages ADD COLUMN channel text DEFAULT 'sms';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'has_attachments') THEN
    ALTER TABLE messages ADD COLUMN has_attachments boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Create message_attachments table
CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_path text,
  url text,
  source text NOT NULL DEFAULT 'upload',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_company_id ON message_attachments(company_id);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_message_attachments" ON message_attachments;
CREATE POLICY "select_message_attachments" ON message_attachments FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.company_id = message_attachments.company_id));

DROP POLICY IF EXISTS "insert_message_attachments" ON message_attachments;
CREATE POLICY "insert_message_attachments" ON message_attachments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.company_id = message_attachments.company_id));

DROP POLICY IF EXISTS "update_message_attachments" ON message_attachments;
CREATE POLICY "update_message_attachments" ON message_attachments FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.company_id = message_attachments.company_id))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.company_id = message_attachments.company_id));

DROP POLICY IF EXISTS "delete_message_attachments" ON message_attachments;
CREATE POLICY "delete_message_attachments" ON message_attachments FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.company_id = message_attachments.company_id));

-- Create storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  26214400,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain','application/zip']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "auth_select_message_attachments" ON storage.objects;
CREATE POLICY "auth_select_message_attachments" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "auth_insert_message_attachments" ON storage.objects;
CREATE POLICY "auth_insert_message_attachments" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "service_role_all_message_attachments" ON storage.objects;
CREATE POLICY "service_role_all_message_attachments" ON storage.objects FOR ALL
  TO service_role USING (bucket_id = 'message-attachments');
