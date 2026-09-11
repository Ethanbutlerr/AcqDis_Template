/*
# Scoreboard security and performance hardening

## Changes
1. Replace get_scoreboard_data to filter only users with the 'Acquisitions Manager' role
   (previously included all users with any role).
2. Revoke EXECUTE from anon role - only authenticated users can call this function.
3. Add CHECK constraint on revenue_verification_status for valid values.
4. Add composite indexes to support scoreboard query performance:
   - disposition_records: (company_id, status, revenue_verification_status, assigned_user_id)
   - calls: (company_id, direction, is_simulated, assigned_user_id, started_at)

## Security
- Function remains SECURITY INVOKER with search_path = public.
- anon role can no longer execute the function.
- RLS on underlying tables still applies (company-scoped).

## Important Notes
1. The 'Acquisitions Manager' role name is matched case-insensitively via ILIKE.
2. Existing disposition_records all have 'pending' status which passes the CHECK.
3. No destructive changes - only additive indexes and a replaced function.
*/

-- Revoke anon execute
REVOKE EXECUTE ON FUNCTION get_scoreboard_data(text, uuid) FROM anon;

-- Add CHECK constraint for valid verification statuses
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_revenue_verification_status'
  ) THEN
    ALTER TABLE disposition_records
      ADD CONSTRAINT chk_revenue_verification_status
      CHECK (revenue_verification_status IN ('pending', 'verified', 'disputed'));
  END IF;
END $$;

-- Performance indexes for scoreboard queries
CREATE INDEX IF NOT EXISTS idx_disp_rec_scoreboard
  ON disposition_records (company_id, status, revenue_verification_status, assigned_user_id)
  WHERE deleted_at IS NULL AND status = 'closed' AND revenue_verification_status = 'verified';

CREATE INDEX IF NOT EXISTS idx_calls_scoreboard
  ON calls (company_id, direction, is_simulated, assigned_user_id, started_at)
  WHERE direction = 'outbound' AND is_simulated = false AND call_sid IS NOT NULL;

-- Replace the function to filter only Acquisitions Manager role
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
          AND r.company_id = p_company_id
          AND r.name ILIKE 'Acquisitions Manager'
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

-- Re-grant to authenticated only (CREATE OR REPLACE resets grants)
REVOKE ALL ON FUNCTION get_scoreboard_data(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_scoreboard_data(text, uuid) TO authenticated;
