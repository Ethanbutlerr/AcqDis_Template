/*
# Import-Text Drip Campaigns

1. New Tables
   - `import_text_campaigns`
     - `id` (uuid, primary key)
     - `company_id` (uuid, FK to companies)
     - `name` (text, campaign label)
     - `status` (text: 'pending', 'active', 'paused', 'completed', 'canceled')
     - `message_template` (text, the SMS body template with {first_name} placeholder)
     - `total_contacts` (integer)
     - `sent_count` (integer, how many have been sent)
     - `failed_count` (integer)
     - `drip_interval_seconds` (integer, delay between each message - default 60s)
     - `created_by` (uuid, FK to auth.users)
     - `created_at` (timestamptz)
     - `started_at` (timestamptz)
     - `completed_at` (timestamptz)
     - `paused_at` (timestamptz)

   - `import_text_recipients`
     - `id` (uuid, primary key)
     - `campaign_id` (uuid, FK to import_text_campaigns)
     - `company_id` (uuid, FK to companies)
     - `contact_id` (uuid, FK to contacts, nullable - linked after import)
     - `first_name` (text)
     - `last_name` (text)
     - `phone` (text)
     - `phone_normalized` (text)
     - `property_address` (text, optional context)
     - `status` (text: 'queued', 'sent', 'failed', 'skipped', 'opted_out')
     - `error_message` (text, nullable)
     - `sent_at` (timestamptz, nullable)
     - `sort_order` (integer, preserves CSV row order for resume)
     - `created_at` (timestamptz)

2. Security
   - RLS enabled, company-scoped policies for authenticated users.

3. Notes
   - The drip processor picks up recipients in sort_order, only those with status='queued'.
   - If campaign is paused/canceled, no further sends happen.
   - On reload the frontend checks for active campaigns and shows progress.
*/

CREATE TABLE IF NOT EXISTS import_text_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Import Campaign',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'completed', 'canceled')),
  message_template text NOT NULL,
  total_contacts integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  drip_interval_seconds integer NOT NULL DEFAULT 60,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_import_text_campaigns_company ON import_text_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_import_text_campaigns_status ON import_text_campaigns(company_id, status);

CREATE TABLE IF NOT EXISTS import_text_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES import_text_campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  phone text NOT NULL,
  phone_normalized text,
  property_address text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped', 'opted_out')),
  error_message text,
  sent_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_text_recipients_campaign ON import_text_recipients(campaign_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_import_text_recipients_phone ON import_text_recipients(company_id, phone_normalized);

ALTER TABLE import_text_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_text_recipients ENABLE ROW LEVEL SECURITY;

-- Policies for import_text_campaigns
DROP POLICY IF EXISTS "select_import_text_campaigns" ON import_text_campaigns;
CREATE POLICY "select_import_text_campaigns" ON import_text_campaigns FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "insert_import_text_campaigns" ON import_text_campaigns;
CREATE POLICY "insert_import_text_campaigns" ON import_text_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "update_import_text_campaigns" ON import_text_campaigns;
CREATE POLICY "update_import_text_campaigns" ON import_text_campaigns FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "delete_import_text_campaigns" ON import_text_campaigns;
CREATE POLICY "delete_import_text_campaigns" ON import_text_campaigns FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

-- Policies for import_text_recipients
DROP POLICY IF EXISTS "select_import_text_recipients" ON import_text_recipients;
CREATE POLICY "select_import_text_recipients" ON import_text_recipients FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "insert_import_text_recipients" ON import_text_recipients;
CREATE POLICY "insert_import_text_recipients" ON import_text_recipients FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "update_import_text_recipients" ON import_text_recipients;
CREATE POLICY "update_import_text_recipients" ON import_text_recipients FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "delete_import_text_recipients" ON import_text_recipients;
CREATE POLICY "delete_import_text_recipients" ON import_text_recipients FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT p.company_id FROM profiles p WHERE p.id = auth.uid()));
