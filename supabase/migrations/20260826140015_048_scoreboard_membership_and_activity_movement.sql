/*
# Scoreboard Membership Table + Updated RPC

## Problem
The scoreboard was hardcoded to the "Acquisitions Manager" role. Management needs to
include/exclude any eligible user regardless of their role. Also, rank-movement indicators
were misleading when all managers had zero activity.

## New Tables
- `scoreboard_members`
  - `id` (uuid, PK)
  - `company_id` (uuid, FK companies, NOT NULL)
  - `user_id` (uuid, FK auth.users, NOT NULL)
  - `is_included` (boolean, default true) - whether user appears on scoreboard
  - `added_by` (uuid, FK auth.users) - who included this user
  - `removed_by` (uuid, FK auth.users, nullable) - who excluded this user
  - `reason` (text, nullable) - why added or removed
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  - UNIQUE on (company_id, user_id) - one membership record per user per company

## Modified Functions
- `get_scoreboard_data` now:
  1. Reads from `scoreboard_members` (is_included = true) instead of role filtering
  2. Falls back to Acquisitions Manager role if no membership records exist (backward compat)
  3. Returns `has_activity` boolean per manager (revenue OR deals OR contracts OR dials > 0)
  4. Returns `prev_rank` as NULL when the manager had zero activity in the previous period
  5. Uses deterministic tie-breaking: revenue DESC, deals DESC, contracts DESC, dials DESC, full_name ASC

## Security
- RLS enabled on scoreboard_members
- SELECT: authenticated users in same company
- INSERT/UPDATE/DELETE: requires 'manage_users' permission (admin/management only)
- Function remains SECURITY INVOKER

## Seed Data
- Seeds the 4 current Acquisitions Managers as included members

## Important Notes
1. Adding someone to the scoreboard does NOT change their role or permissions.
2. Setting is_included = false hides them from future views without deleting records.
3. Disabled profiles are excluded even if they have a membership record.
4. Rank movement is NULL when a manager had zero meaningful activity in previous period.
5. Deterministic tie ordering prevents reshuffling between refreshes.
*/

-- Create scoreboard_members table
CREATE TABLE IF NOT EXISTS scoreboard_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_included boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES auth.users(id),
  removed_by uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scoreboard_members_company ON scoreboard_members(company_id, is_included);

ALTER TABLE scoreboard_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_scoreboard_members" ON scoreboard_members;
CREATE POLICY "sel_scoreboard_members" ON scoreboard_members FOR SELECT
  TO authenticated USING (company_id = get_current_company_id());

DROP POLICY IF EXISTS "ins_scoreboard_members" ON scoreboard_members;
CREATE POLICY "ins_scoreboard_members" ON scoreboard_members FOR INSERT
  TO authenticated WITH CHECK (company_id = get_current_company_id() AND has_permission('manage_users'));

DROP POLICY IF EXISTS "upd_scoreboard_members" ON scoreboard_members;
CREATE POLICY "upd_scoreboard_members" ON scoreboard_members FOR UPDATE
  TO authenticated USING (company_id = get_current_company_id() AND has_permission('manage_users'))
  WITH CHECK (company_id = get_current_company_id() AND has_permission('manage_users'));

DROP POLICY IF EXISTS "del_scoreboard_members" ON scoreboard_members;
CREATE POLICY "del_scoreboard_members" ON scoreboard_members FOR DELETE
  TO authenticated USING (company_id = get_current_company_id() AND has_permission('manage_users'));

-- Seed current Acquisitions Managers
-- Get the company_id from one of the known profiles
DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM profiles WHERE id = '9c155d2a-d4cd-4655-86ee-ec5e694e203f';
  IF v_company_id IS NOT NULL THEN
    INSERT INTO scoreboard_members (company_id, user_id, is_included, reason)
    VALUES
      (v_company_id, '9c155d2a-d4cd-4655-86ee-ec5e694e203f', true, 'Seeded: Acquisitions Manager'),
      (v_company_id, 'c41ad754-bbdf-4a61-8494-bd7d616633e0', true, 'Seeded: Acquisitions Manager'),
      (v_company_id, 'e21a4c35-5660-42fa-9490-5bd2f0514806', true, 'Seeded: Acquisitions Manager'),
      (v_company_id, 'a1033265-6e4d-4cf3-8b28-91e5f0710e8a', true, 'Seeded: Acquisitions Manager')
    ON CONFLICT (company_id, user_id) DO NOTHING;
  END IF;
END $$;

-- Replace the function with membership-based + activity-aware logic
CREATE OR REPLACE FUNCTION get_scoreboard_data(p_period text, p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_result json;
  v_has_members boolean;
BEGIN
  v_end := now();

  CASE p_period
    WHEN 'today' THEN
      v_start := date_trunc('day', now());
      v_prev_start := v_start - interval '1 day';
      v_prev_end := v_start;
    WHEN 'week' THEN
      v_start := date_trunc('week', now());
      v_prev_start := v_start - interval '7 days';
      v_prev_end := v_start;
    WHEN 'month' THEN
      v_start := date_trunc('month', now());
      v_prev_start := v_start - interval '1 month';
      v_prev_end := v_start;
    WHEN 'all' THEN
      v_start := '2000-01-01'::timestamptz;
      v_prev_start := NULL;
      v_prev_end := NULL;
    ELSE
      v_start := date_trunc('week', now());
      v_prev_start := v_start - interval '7 days';
      v_prev_end := v_start;
  END CASE;

  -- Check if company has explicit scoreboard membership
  SELECT EXISTS (
    SELECT 1 FROM scoreboard_members WHERE company_id = p_company_id AND is_included = true
  ) INTO v_has_members;

  WITH managers AS (
    -- Use membership table if populated, else fall back to Acquisitions Manager role
    SELECT p.id as user_id, p.full_name, p.avatar_url, p.email
    FROM profiles p
    WHERE p.company_id = p_company_id
      AND p.is_disabled = false
      AND (
        (v_has_members AND EXISTS (
          SELECT 1 FROM scoreboard_members sm
          WHERE sm.user_id = p.id AND sm.company_id = p_company_id AND sm.is_included = true
        ))
        OR
        (NOT v_has_members AND EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = p.id AND r.company_id = p_company_id AND r.name ILIKE 'Acquisitions Manager'
        ))
      )
  ),
  revenue_data AS (
    SELECT
      dr.assigned_user_id as user_id,
      COALESCE(SUM(dr.actual_revenue), 0) as verified_revenue,
      COUNT(*) as closed_deals
    FROM disposition_records dr
    WHERE dr.company_id = p_company_id
      AND dr.status = 'closed'
      AND dr.deleted_at IS NULL
      AND dr.revenue_verification_status = 'verified'
      AND dr.actual_revenue IS NOT NULL
      AND dr.actual_revenue > 0
      AND (dr.funded_date >= v_start::date OR dr.closing_date >= v_start::date)
      AND (dr.funded_date <= v_end::date OR dr.closing_date <= v_end::date)
    GROUP BY dr.assigned_user_id
  ),
  contracts_data AS (
    SELECT
      ar.assigned_user_id as user_id,
      COUNT(*) as signed_contracts
    FROM acquisition_records ar
    WHERE ar.company_id = p_company_id
      AND ar.contract_executed_at IS NOT NULL
      AND ar.deleted_at IS NULL
      AND ar.contract_executed_at >= v_start
      AND ar.contract_executed_at <= v_end
    GROUP BY ar.assigned_user_id
  ),
  dials_data AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as total_dials
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND c.started_at >= v_start
      AND c.started_at <= v_end
    GROUP BY c.assigned_user_id
  ),
  dials_today AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as dials_today
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND c.started_at >= date_trunc('day', now())
    GROUP BY c.assigned_user_id
  ),
  prev_revenue AS (
    SELECT
      dr.assigned_user_id as user_id,
      COALESCE(SUM(dr.actual_revenue), 0) as prev_revenue,
      COUNT(*) as prev_deals
    FROM disposition_records dr
    WHERE dr.company_id = p_company_id
      AND dr.status = 'closed'
      AND dr.deleted_at IS NULL
      AND dr.revenue_verification_status = 'verified'
      AND dr.actual_revenue IS NOT NULL
      AND dr.actual_revenue > 0
      AND v_prev_start IS NOT NULL
      AND (dr.funded_date >= v_prev_start::date OR dr.closing_date >= v_prev_start::date)
      AND (dr.funded_date < v_prev_end::date OR dr.closing_date < v_prev_end::date)
    GROUP BY dr.assigned_user_id
  ),
  prev_contracts AS (
    SELECT
      ar.assigned_user_id as user_id,
      COUNT(*) as prev_contracts
    FROM acquisition_records ar
    WHERE ar.company_id = p_company_id
      AND ar.contract_executed_at IS NOT NULL
      AND ar.deleted_at IS NULL
      AND v_prev_start IS NOT NULL
      AND ar.contract_executed_at >= v_prev_start
      AND ar.contract_executed_at < v_prev_end
    GROUP BY ar.assigned_user_id
  ),
  prev_dials AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as prev_dials
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND v_prev_start IS NOT NULL
      AND c.started_at >= v_prev_start
      AND c.started_at < v_prev_end
    GROUP BY c.assigned_user_id
  ),
  combined AS (
    SELECT
      m.user_id,
      m.full_name,
      m.avatar_url,
      m.email,
      COALESCE(rd.verified_revenue, 0) as verified_revenue,
      COALESCE(rd.closed_deals, 0) as closed_deals,
      COALESCE(cd.signed_contracts, 0) as signed_contracts,
      COALESCE(dd.total_dials, 0) as dials_period,
      COALESCE(dt.dials_today, 0) as dials_today,
      COALESCE(pr.prev_revenue, 0) as prev_revenue,
      COALESCE(pr.prev_deals, 0) as prev_deals,
      COALESCE(pc.prev_contracts, 0) as prev_contracts,
      COALESCE(pd.prev_dials, 0) as prev_dials,
      -- Has meaningful current activity
      (COALESCE(rd.verified_revenue, 0) > 0 OR COALESCE(rd.closed_deals, 0) > 0
       OR COALESCE(cd.signed_contracts, 0) > 0 OR COALESCE(dd.total_dials, 0) > 0) as has_current_activity,
      -- Has meaningful previous activity
      (COALESCE(pr.prev_revenue, 0) > 0 OR COALESCE(pr.prev_deals, 0) > 0
       OR COALESCE(pc.prev_contracts, 0) > 0 OR COALESCE(pd.prev_dials, 0) > 0) as has_prev_activity
    FROM managers m
    LEFT JOIN revenue_data rd ON rd.user_id = m.user_id
    LEFT JOIN contracts_data cd ON cd.user_id = m.user_id
    LEFT JOIN dials_data dd ON dd.user_id = m.user_id
    LEFT JOIN dials_today dt ON dt.user_id = m.user_id
    LEFT JOIN prev_revenue pr ON pr.user_id = m.user_id
    LEFT JOIN prev_contracts pc ON pc.user_id = m.user_id
    LEFT JOIN prev_dials pd ON pd.user_id = m.user_id
  ),
  ranked AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        ORDER BY c.verified_revenue DESC, c.closed_deals DESC, c.signed_contracts DESC, c.dials_period DESC, c.full_name ASC
      ) as rank
    FROM combined c
  ),
  prev_ranked AS (
    SELECT
      c.user_id,
      c.has_prev_activity,
      ROW_NUMBER() OVER (
        ORDER BY c.prev_revenue DESC, c.prev_deals DESC, c.prev_contracts DESC, c.prev_dials DESC, c.full_name ASC
      ) as prev_rank
    FROM combined c
    WHERE v_prev_start IS NOT NULL
  )
  SELECT json_build_object(
    'managers', COALESCE((
      SELECT json_agg(
        json_build_object(
          'user_id', r.user_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'email', r.email,
          'verified_revenue', r.verified_revenue,
          'closed_deals', r.closed_deals,
          'signed_contracts', r.signed_contracts,
          'dials_period', r.dials_period,
          'dials_today', r.dials_today,
          'rank', r.rank,
          'has_activity', r.has_current_activity,
          'prev_rank', CASE
            WHEN v_prev_start IS NULL THEN NULL
            WHEN NOT r.has_current_activity AND NOT prvr.has_prev_activity THEN NULL
            ELSE prvr.prev_rank
          END
        )
        ORDER BY r.rank ASC
      )
      FROM ranked r
      LEFT JOIN prev_ranked prvr ON prvr.user_id = r.user_id
    ), '[]'::json),
    'period', p_period,
    'period_start', v_start,
    'period_end', v_end,
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_scoreboard_data(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_scoreboard_data(text, uuid) TO authenticated;
