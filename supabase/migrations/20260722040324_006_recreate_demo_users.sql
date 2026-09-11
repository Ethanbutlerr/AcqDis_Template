/*
# Recreate demo users with proper password hashing

## Problem
Original seed used crypt() with 6 rounds. Supabase Auth needs 10 rounds.
Also, confirmed_at is a generated column — cannot insert into it directly.

## Fix
Insert into auth.users with bcrypt 10 rounds, omitting generated columns.
Then manually create profiles, user_roles, and team_members.
*/

-- ============================================================
-- 1. Create auth users with proper bcrypt hashing (10 rounds)
-- ============================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Sarah Mitchell (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'director@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"James Carter (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'acq.manager@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Maria Rodriguez (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'acq.rep@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Tommy Chen (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'disp.manager@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Aisha Patel (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'tc@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Kevin O''Brien (Demo)"}'::jsonb, now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'readonly@meridianwholesale.com', crypt('Demo1234!', gen_salt('bf', 10)), now(), '{}'::jsonb, '{"full_name":"Jordan Lee (Demo)"}'::jsonb, now(), now(), false, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Create profiles manually (no trigger now)
-- ============================================================
INSERT INTO public.profiles (id, company_id, email, full_name)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'admin@meridianwholesale.com', 'Sarah Mitchell (Demo)'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'director@meridianwholesale.com', 'James Carter (Demo)'),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'acq.manager@meridianwholesale.com', 'Maria Rodriguez (Demo)'),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'acq.rep@meridianwholesale.com', 'Tommy Chen (Demo)'),
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'disp.manager@meridianwholesale.com', 'Aisha Patel (Demo)'),
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'tc@meridianwholesale.com', 'Kevin O''Brien (Demo)'),
  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'readonly@meridianwholesale.com', 'Jordan Lee (Demo)')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Re-assign user roles
-- ============================================================
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000007'),
  ('d0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000008')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Re-assign team memberships
-- ============================================================
INSERT INTO public.team_members (team_id, user_id, role) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'lead'),
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'member'),
  ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'lead'),
  ('c0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', 'lead')
ON CONFLICT DO NOTHING;
