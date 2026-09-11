/*
# Fix: Create missing auth.identities entries for demo users

## Problem
Supabase Auth requires an entry in auth.identities for each user.
Without it, the login query fails with "Database error querying schema".
The email column is generated, so we can't insert into it directly.

## Fix
Insert identity records with provider_id, user_id, identity_data, provider.
The email column will be auto-generated from identity_data.
*/

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
VALUES
  ('admin@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000001', '{"sub":"d0000000-0000-4000-8000-000000000001","email":"admin@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('director@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000002', '{"sub":"d0000000-0000-4000-8000-000000000002","email":"director@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('acq.manager@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000003', '{"sub":"d0000000-0000-4000-8000-000000000003","email":"acq.manager@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('acq.rep@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000004', '{"sub":"d0000000-0000-4000-8000-000000000004","email":"acq.rep@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('disp.manager@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000005', '{"sub":"d0000000-0000-4000-8000-000000000005","email":"disp.manager@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('tc@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000006', '{"sub":"d0000000-0000-4000-8000-000000000006","email":"tc@meridianwholesale.com"}'::jsonb, 'email', now(), now()),
  ('readonly@meridianwholesale.com', 'd0000000-0000-4000-8000-000000000007', '{"sub":"d0000000-0000-4000-8000-000000000007","email":"readonly@meridianwholesale.com"}'::jsonb, 'email', now(), now())
ON CONFLICT DO NOTHING;
