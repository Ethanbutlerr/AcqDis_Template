/*
# Acquisitions Manager Scoreboard - Schema & RPC

## Problem
The Overview (Dashboard) needs a competitive scoreboard ranking acquisition managers
by verified revenue, closed deals, signed contracts, and dials. Revenue verification
fields are missing from disposition_records.

## Modified Tables
- `disposition_records`: Added 3 nullable columns for revenue verification workflow
  - `revenue_verified_at` (timestamptz) - when revenue was verified
  - `revenue_verified_by` (uuid) - who verified it (references auth.users)
  - `revenue_verification_status` (text) - 'pending' | 'verified' | 'disputed', default 'pending'

## New Functions
- `get_scoreboard_data(p_period text, p_company_id uuid)` - returns ranked scoreboard data
  for acquisition managers including verified revenue, closed deals, signed contracts,
  and outbound dials. All data is server-calculated and tamper-proof.

## Security
- Function is SECURITY INVOKER (runs as calling user)
- Respects existing RLS on all tables
- Only includes non-disabled profiles in the same company

## Important Notes
1. Revenue only counts when disposition_records.revenue_verification_status = 'verified'
   AND the record status is 'closed' AND actual_revenue is not null.
2. Dials count unique outbound, non-simulated calls with a call_sid.
3. Signed contracts use acquisition_records.contract_executed_at timestamp.
4. Ranking: revenue DESC, closed deals DESC, contracts DESC, dials DESC.
5. Existing records get 'pending' verification status by default - no data loss.
*/

-- Add revenue verification columns to disposition_records
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disposition_records' AND column_name = 'revenue_verification_status') THEN
    ALTER TABLE disposition_records ADD COLUMN revenue_verification_status text NOT NULL DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disposition_records' AND column_name = 'revenue_verified_at') THEN
    ALTER TABLE disposition_records ADD COLUMN revenue_verified_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'disposition_records' AND column_name = 'revenue_verified_by') THEN
    ALTER TABLE disposition_records ADD COLUMN revenue_verified_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

-- Create the scoreboard RPC function
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

  WITH managers AS (
    SELECT p.id as user_id, p.full_name, p.avatar_url, p.email
    FROM profiles p
    WHERE p.company_id = p_company_id
      AND p.is_disabled = false
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p.id
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
      COALESCE(SUM(dr.actual_revenue), 0) as prev_revenue
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
      COALESCE(pr.prev_revenue, 0) as prev_revenue
    FROM managers m
    LEFT JOIN revenue_data rd ON rd.user_id = m.user_id
    LEFT JOIN contracts_data cd ON cd.user_id = m.user_id
    LEFT JOIN dials_data dd ON dd.user_id = m.user_id
    LEFT JOIN dials_today dt ON dt.user_id = m.user_id
    LEFT JOIN prev_revenue pr ON pr.user_id = m.user_id
  ),
  ranked AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        ORDER BY c.verified_revenue DESC, c.closed_deals DESC, c.signed_contracts DESC, c.dials_period DESC
      ) as rank
    FROM combined c
  ),
  prev_ranked AS (
    SELECT
      m.user_id,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(pr.prev_revenue, 0) DESC, m.full_name ASC
      ) as prev_rank
    FROM managers m
    LEFT JOIN prev_revenue pr ON pr.user_id = m.user_id
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
          'prev_rank', prvr.prev_rank
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

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_scoreboard_data(text, uuid) TO authenticated;
