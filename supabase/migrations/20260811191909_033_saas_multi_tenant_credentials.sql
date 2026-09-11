/*
# SaaS Multi-Tenant: Per-Company Credentials & Compliance Settings

Transforms the platform from single-tenant (hardcoded Good Neighbor) to multi-tenant SaaS
where each company configures their own Twilio, Resend, and compliance settings.

1. Modified Tables
   - `companies`
     - `legal_name` (text) - Legal entity name for compliance (e.g., "Good Neighbor Home Buyers LLC")
     - `website_url` (text) - Company website (e.g., "goodnhb.com")
     - `sms_company_name` (text) - Company name used in SMS opt-out/HELP messages
     - `sms_help_phone` (text) - Phone number shown in HELP responses
     - `sms_help_email` (text) - Email shown in HELP responses
     - `from_email` (text) - Default from email address for outbound email
     - `from_email_name` (text) - Display name for outbound email
   
   - `integration_settings`
     - `credentials` (jsonb) - Encrypted/stored provider credentials
       For Twilio: { account_sid, auth_token }
       For Resend: { api_key }
     - `webhook_url` (text) - Auto-generated webhook URL for this company's integration
     - `a2p_brand_status` (text) - A2P 10DLC brand registration status
     - `a2p_campaign_status` (text) - A2P 10DLC campaign registration status
     - `a2p_brand_id` (text) - Twilio A2P Brand SID
     - `a2p_campaign_id` (text) - Twilio A2P Campaign SID

2. Security
   - credentials column uses existing integration_settings RLS (manage_integrations permission)
   - Edge functions read credentials via service role (bypasses RLS)

3. Important Notes
   - Existing env-var based Twilio/Resend keys remain as fallback
   - Per-company credentials take priority over env vars
   - Good Neighbor Home Buyers seeded with their current config
*/

-- Add compliance & email fields to companies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'legal_name') THEN
    ALTER TABLE companies ADD COLUMN legal_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'website_url') THEN
    ALTER TABLE companies ADD COLUMN website_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'sms_company_name') THEN
    ALTER TABLE companies ADD COLUMN sms_company_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'sms_help_phone') THEN
    ALTER TABLE companies ADD COLUMN sms_help_phone text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'sms_help_email') THEN
    ALTER TABLE companies ADD COLUMN sms_help_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'from_email') THEN
    ALTER TABLE companies ADD COLUMN from_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'from_email_name') THEN
    ALTER TABLE companies ADD COLUMN from_email_name text;
  END IF;
END $$;

-- Add credential + A2P fields to integration_settings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'credentials') THEN
    ALTER TABLE integration_settings ADD COLUMN credentials jsonb DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'webhook_url') THEN
    ALTER TABLE integration_settings ADD COLUMN webhook_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'a2p_brand_status') THEN
    ALTER TABLE integration_settings ADD COLUMN a2p_brand_status text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'a2p_campaign_status') THEN
    ALTER TABLE integration_settings ADD COLUMN a2p_campaign_status text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'a2p_brand_id') THEN
    ALTER TABLE integration_settings ADD COLUMN a2p_brand_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'integration_settings' AND column_name = 'a2p_campaign_id') THEN
    ALTER TABLE integration_settings ADD COLUMN a2p_campaign_id text;
  END IF;
END $$;

-- Seed Good Neighbor Home Buyers with their existing config
UPDATE companies SET
  legal_name = 'Good Neighbor Home Buyers LLC',
  website_url = 'https://goodnhb.com',
  sms_company_name = 'Good Neighbor Home Buyers LLC',
  from_email = 'info@goodnhb.com',
  from_email_name = 'Good Neighbor Home Buyers'
WHERE legal_name IS NULL;
