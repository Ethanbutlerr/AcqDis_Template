/*
# Phase 7 — Dashboard, KPIs, Revenue Reporting, User Earnings
*/

-- 1. DASHBOARD PREFERENCES
CREATE TABLE IF NOT EXISTS dashboard_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_order text[] NOT NULL DEFAULT '{}',
  hidden_cards text[] NOT NULL DEFAULT '{}',
  date_range text NOT NULL DEFAULT 'last_30_days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
ALTER TABLE dashboard_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_dash_prefs_own" ON dashboard_preferences;
CREATE POLICY "select_dash_prefs_own" ON dashboard_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "insert_dash_prefs_own" ON dashboard_preferences;
CREATE POLICY "insert_dash_prefs_own" ON dashboard_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "update_dash_prefs_own" ON dashboard_preferences;
CREATE POLICY "update_dash_prefs_own" ON dashboard_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "delete_dash_prefs_own" ON dashboard_preferences;
CREATE POLICY "delete_dash_prefs_own" ON dashboard_preferences FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 2. USER EARNINGS
CREATE TABLE IF NOT EXISTS user_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  revenue_attribution_id uuid REFERENCES revenue_attributions(id) ON DELETE SET NULL,
  disposition_record_id uuid REFERENCES disposition_records(id) ON DELETE SET NULL,
  acquisition_record_id uuid REFERENCES acquisition_records(id) ON DELETE SET NULL,
  company_revenue numeric(12,2) NOT NULL DEFAULT 0,
  compensation_percentage numeric(6,4) NOT NULL DEFAULT 0,
  personal_earnings numeric(12,2) NOT NULL DEFAULT 0,
  payout_status text NOT NULL DEFAULT 'not_calculated'
    CHECK (payout_status IN ('not_calculated','needs_review','approved','scheduled','paid','disputed')),
  paid_at timestamptz,
  paid_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_user_earnings_own" ON user_earnings;
CREATE POLICY "select_user_earnings_own" ON user_earnings FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND (user_id = auth.uid() OR public.has_permission('view_all_revenue')));
DROP POLICY IF EXISTS "insert_user_earnings_perm" ON user_earnings;
CREATE POLICY "insert_user_earnings_perm" ON user_earnings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
DROP POLICY IF EXISTS "update_user_earnings_perm" ON user_earnings;
CREATE POLICY "update_user_earnings_perm" ON user_earnings FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
DROP POLICY IF EXISTS "delete_user_earnings_perm" ON user_earnings;
CREATE POLICY "delete_user_earnings_perm" ON user_earnings FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));

CREATE INDEX IF NOT EXISTS idx_user_earnings_company ON user_earnings(company_id);
CREATE INDEX IF NOT EXISTS idx_user_earnings_user ON user_earnings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_earnings_status ON user_earnings(payout_status);
CREATE INDEX IF NOT EXISTS idx_user_earnings_disposition ON user_earnings(disposition_record_id);

-- 3. INDEXES FOR REPORTING
CREATE INDEX IF NOT EXISTS idx_acq_records_created ON acquisition_records(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_acq_records_contract ON acquisition_records(contract_executed_at) WHERE contract_executed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acq_records_stage_entered ON acquisition_records(stage_entered_at);
CREATE INDEX IF NOT EXISTS idx_disp_records_created ON disposition_records(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_disp_records_status ON disposition_records(status);
CREATE INDEX IF NOT EXISTS idx_disp_records_stage ON disposition_records(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_opp_actual_revenue ON opportunities(company_id, actual_revenue) WHERE actual_revenue IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_contract_date ON opportunities(contract_date) WHERE contract_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_closing_date ON opportunities(closing_date) WHERE closing_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(company_id, due_date) WHERE status IN ('open','in_progress','waiting');
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_user_id) WHERE status IN ('open','in_progress','waiting');
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_rev_attr_locked ON revenue_attributions(locked_at) WHERE locked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rev_attr_user ON revenue_attributions(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_created ON lead_records(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_records_source ON lead_records(lead_source);
CREATE INDEX IF NOT EXISTS idx_lead_records_campaign ON lead_records(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_records_stage ON lead_records(pipeline_stage_id);

-- 4. RPC: get_dashboard_kpis
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL, p_user_id uuid DEFAULT NULL,
  p_include_demo boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start timestamptz := COALESCE(p_start_date, '1970-01-01'::timestamptz);
  v_end timestamptz := COALESCE(p_end_date, now());
  v_total_leads int; v_unassigned_leads int; v_assigned_leads int;
  v_company_revenue numeric(12,2); v_personal_earnings numeric(12,2);
  v_open_deals int; v_contracts_executed int; v_closings int; v_overdue_tasks int;
BEGIN
  SELECT count(*) INTO v_total_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL
    AND created_at >= v_start AND created_at <= v_end
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT count(*) INTO v_unassigned_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL
    AND created_at >= v_start AND created_at <= v_end AND assigned_user_id IS NULL
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT count(*) INTO v_assigned_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL
    AND created_at >= v_start AND created_at <= v_end AND assigned_user_id IS NOT NULL
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT COALESCE(SUM(o.actual_revenue), 0) INTO v_company_revenue FROM opportunities o
  WHERE o.company_id = p_company_id AND o.status = 'closed'
    AND o.actual_revenue IS NOT NULL AND o.actual_revenue > 0
    AND o.closing_date IS NOT NULL AND o.closing_date >= v_start::date AND o.closing_date <= v_end::date;
  SELECT COALESCE(SUM(ra.personal_earnings), 0) INTO v_personal_earnings FROM revenue_attributions ra
  WHERE ra.company_id = p_company_id AND ra.locked_at IS NOT NULL
    AND ra.locked_at >= v_start AND ra.locked_at <= v_end
    AND (p_user_id IS NULL OR ra.user_id = p_user_id);
  SELECT count(*) INTO v_open_deals FROM disposition_records
  WHERE company_id = p_company_id AND status = 'active'
    AND created_at >= v_start AND created_at <= v_end;
  SELECT count(*) INTO v_contracts_executed FROM acquisition_records
  WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
    AND contract_executed_at >= v_start AND contract_executed_at <= v_end;
  SELECT count(*) INTO v_closings FROM disposition_records dr
  WHERE dr.company_id = p_company_id AND dr.status = 'closed'
    AND dr.updated_at >= v_start AND dr.updated_at <= v_end;
  SELECT count(*) INTO v_overdue_tasks FROM tasks
  WHERE company_id = p_company_id AND status IN ('open','in_progress','waiting')
    AND due_date IS NOT NULL AND due_date < CURRENT_DATE
    AND (p_user_id IS NULL OR assigned_user_id = p_user_id);
  RETURN jsonb_build_object(
    'total_leads', v_total_leads, 'unassigned_leads', v_unassigned_leads,
    'assigned_leads', v_assigned_leads, 'company_revenue', v_company_revenue,
    'personal_earnings', v_personal_earnings, 'open_deals', v_open_deals,
    'contracts_executed', v_contracts_executed, 'closings', v_closings,
    'overdue_tasks', v_overdue_tasks
  );
END;
$$;

-- 5. RPC: get_leads_contracts_closings
CREATE OR REPLACE FUNCTION public.get_leads_contracts_closings(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'leads', COALESCE((SELECT count(*) FROM acquisition_records
      WHERE company_id = p_company_id AND archived_at IS NULL
        AND created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
        AND created_at <= COALESCE(p_end_date, now())), 0),
    'contracts', COALESCE((SELECT count(*) FROM acquisition_records
      WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
        AND contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
        AND contract_executed_at <= COALESCE(p_end_date, now())), 0),
    'closings', COALESCE((SELECT count(*) FROM disposition_records
      WHERE company_id = p_company_id AND status = 'closed'
        AND updated_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
        AND updated_at <= COALESCE(p_end_date, now())), 0)
  );
$$;

-- 6. RPC: get_revenue_by_month
CREATE OR REPLACE FUNCTION public.get_revenue_by_month(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month_str, 'revenue', rev) ORDER BY month_str), '[]'::jsonb)
  FROM (
    SELECT to_char(date_trunc('month', o.closing_date), 'YYYY-MM') AS month_str,
           COALESCE(SUM(o.actual_revenue), 0) AS rev
    FROM opportunities o
    WHERE o.company_id = p_company_id AND o.status = 'closed'
      AND o.actual_revenue IS NOT NULL AND o.actual_revenue > 0
      AND o.closing_date IS NOT NULL
      AND o.closing_date >= COALESCE(p_start_date, '1970-01-01'::timestamptz)::date
      AND o.closing_date <= COALESCE(p_end_date, now())::date
    GROUP BY date_trunc('month', o.closing_date)
  ) sub;
$$;

-- 7. RPC: get_revenue_by_user
CREATE OR REPLACE FUNCTION public.get_revenue_by_user(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'user_name', user_name, 'revenue', rev, 'earnings', earn, 'percentage', pct
  ) ORDER BY rev DESC), '[]'::jsonb)
  FROM (
    SELECT ra.user_id, COALESCE(p.full_name, 'Unknown') AS user_name,
           SUM(ra.company_revenue) AS rev, SUM(ra.personal_earnings) AS earn,
           CASE WHEN SUM(ra.company_revenue) > 0 THEN SUM(ra.personal_earnings) / SUM(ra.company_revenue) ELSE 0 END AS pct
    FROM revenue_attributions ra
    LEFT JOIN profiles p ON p.id = ra.user_id
    WHERE ra.company_id = p_company_id AND ra.locked_at IS NOT NULL
      AND ra.locked_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND ra.locked_at <= COALESCE(p_end_date, now())
    GROUP BY ra.user_id, p.full_name
  ) sub;
$$;

-- 8. RPC: get_leads_by_source
CREATE OR REPLACE FUNCTION public.get_leads_by_source(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
  FROM (
    SELECT COALESCE(lead_source, 'Unknown') AS source, count(*) AS cnt
    FROM acquisition_records
    WHERE company_id = p_company_id AND archived_at IS NULL
      AND created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND created_at <= COALESCE(p_end_date, now())
    GROUP BY lead_source
  ) sub;
$$;

-- 9. RPC: get_leads_by_stage
CREATE OR REPLACE FUNCTION public.get_leads_by_stage(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', stage_id, 'stage_name', stage_name, 'count', cnt, 'color', color
  ) ORDER BY cnt DESC), '[]'::jsonb)
  FROM (
    SELECT ar.pipeline_stage_id AS stage_id, COALESCE(aps.name, 'Unknown') AS stage_name,
           count(*) AS cnt, COALESCE(aps.color, '#6b7280') AS color
    FROM acquisition_records ar
    LEFT JOIN acquisition_pipeline_stages aps ON aps.id = ar.pipeline_stage_id
    WHERE ar.company_id = p_company_id AND ar.archived_at IS NULL
      AND ar.created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND ar.created_at <= COALESCE(p_end_date, now())
    GROUP BY ar.pipeline_stage_id, aps.name, aps.color
  ) sub;
$$;

-- 10. RPC: get_deals_by_disposition_stage
CREATE OR REPLACE FUNCTION public.get_deals_by_disposition_stage(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', stage_id, 'stage_name', stage_name, 'count', cnt, 'color', color
  ) ORDER BY cnt DESC), '[]'::jsonb)
  FROM (
    SELECT dr.pipeline_stage_id AS stage_id, COALESCE(dps.name, 'Unknown') AS stage_name,
           count(*) AS cnt, COALESCE(dps.color, '#6b7280') AS color
    FROM disposition_records dr
    LEFT JOIN disposition_pipeline_stages dps ON dps.id = dr.pipeline_stage_id
    WHERE dr.company_id = p_company_id AND dr.status = 'active'
      AND dr.created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND dr.created_at <= COALESCE(p_end_date, now())
    GROUP BY dr.pipeline_stage_id, dps.name, dps.color
  ) sub;
$$;

-- 11. RPC: get_conversion_metrics
CREATE OR REPLACE FUNCTION public.get_conversion_metrics(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_leads int; v_contracts int; v_closings int;
  v_lead_to_contract_pct numeric; v_contract_to_closing_pct numeric;
  v_avg_lead_to_contract_days numeric; v_avg_contract_to_closing_days numeric;
BEGIN
  SELECT count(*) INTO v_total_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL
    AND created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
    AND created_at <= COALESCE(p_end_date, now());
  SELECT count(*) INTO v_contracts FROM acquisition_records
  WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
    AND contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
    AND contract_executed_at <= COALESCE(p_end_date, now());
  SELECT count(*) INTO v_closings FROM disposition_records
  WHERE company_id = p_company_id AND status = 'closed'
    AND updated_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
    AND updated_at <= COALESCE(p_end_date, now());
  v_lead_to_contract_pct := CASE WHEN v_total_leads > 0 THEN round((v_contracts::numeric / v_total_leads) * 100, 1) ELSE 0 END;
  v_contract_to_closing_pct := CASE WHEN v_contracts > 0 THEN round((v_closings::numeric / v_contracts) * 100, 1) ELSE 0 END;
  SELECT COALESCE(avg(extract(epoch FROM (contract_executed_at - created_at)) / 86400), 0)
  INTO v_avg_lead_to_contract_days FROM acquisition_records
  WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
    AND contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
    AND contract_executed_at <= COALESCE(p_end_date, now());
  SELECT COALESCE(avg(extract(epoch FROM (o.closing_date - ar.contract_executed_at)) / 86400), 0)
  INTO v_avg_contract_to_closing_days
  FROM acquisition_records ar JOIN opportunities o ON o.id = ar.opportunity_id
  WHERE ar.company_id = p_company_id AND ar.contract_executed_at IS NOT NULL
    AND o.closing_date IS NOT NULL AND o.status = 'closed'
    AND ar.contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
    AND ar.contract_executed_at <= COALESCE(p_end_date, now());
  RETURN jsonb_build_object(
    'total_leads', v_total_leads, 'contracts', v_contracts, 'closings', v_closings,
    'lead_to_contract_pct', v_lead_to_contract_pct, 'contract_to_closing_pct', v_contract_to_closing_pct,
    'avg_lead_to_contract_days', round(v_avg_lead_to_contract_days, 1),
    'avg_contract_to_closing_days', round(v_avg_contract_to_closing_days, 1)
  );
END;
$$;

-- 12. RPC: get_dead_lost_reasons
CREATE OR REPLACE FUNCTION public.get_dead_lost_reasons(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'dead_leads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT COALESCE(motivation, 'No reason given') AS reason, count(*) AS cnt
            FROM acquisition_records
            WHERE company_id = p_company_id AND archived_at IS NOT NULL
              AND updated_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
              AND updated_at <= COALESCE(p_end_date, now())
            GROUP BY motivation) d
    ), '[]'::jsonb),
    'dead_deals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT COALESCE(notes, 'No reason given') AS reason, count(*) AS cnt
            FROM disposition_records
            WHERE company_id = p_company_id AND status = 'dead'
              AND updated_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
              AND updated_at <= COALESCE(p_end_date, now())
            GROUP BY notes) d
    ), '[]'::jsonb)
  );
$$;

-- 13. RPC: get_avg_days_in_stage
CREATE OR REPLACE FUNCTION public.get_avg_days_in_stage(p_company_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_name', stage_name, 'avg_days', avg_days, 'count', cnt
  ) ORDER BY avg_days DESC), '[]'::jsonb)
  FROM (
    SELECT COALESCE(aps.name, 'Unknown') AS stage_name,
           COALESCE(round(extract(epoch FROM avg(now() - ar.stage_entered_at)) / 86400), 0) AS avg_days,
           count(*) AS cnt
    FROM acquisition_records ar
    LEFT JOIN acquisition_pipeline_stages aps ON aps.id = ar.pipeline_stage_id
    WHERE ar.company_id = p_company_id AND ar.archived_at IS NULL
    GROUP BY aps.name
  ) sub;
$$;

-- 14. RPC: get_leads_by_campaign (uses opportunities.campaign text field)
CREATE OR REPLACE FUNCTION public.get_leads_by_campaign(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'campaign_name', campaign_name, 'count', cnt
  ) ORDER BY cnt DESC), '[]'::jsonb)
  FROM (
    SELECT COALESCE(o.campaign, 'No Campaign') AS campaign_name, count(*) AS cnt
    FROM acquisition_records ar
    JOIN opportunities o ON o.id = ar.opportunity_id
    WHERE ar.company_id = p_company_id AND ar.archived_at IS NULL
      AND ar.created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND ar.created_at <= COALESCE(p_end_date, now())
    GROUP BY o.campaign
  ) sub;
$$;

-- 15. RPC: get_dashboard_tasks
CREATE OR REPLACE FUNCTION public.get_dashboard_tasks(
  p_company_id uuid, p_user_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'overdue', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, title, priority, due_date, assigned_user_id, related_contact_id
        FROM tasks WHERE company_id = p_company_id AND status IN ('open','in_progress','waiting')
          AND due_date IS NOT NULL AND due_date < CURRENT_DATE
          AND (p_user_id IS NULL OR assigned_user_id = p_user_id)
        ORDER BY due_date ASC LIMIT 20) t
    ), '[]'::jsonb),
    'due_today', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, title, priority, due_date, assigned_user_id, related_contact_id
        FROM tasks WHERE company_id = p_company_id AND status IN ('open','in_progress','waiting')
          AND due_date = CURRENT_DATE
          AND (p_user_id IS NULL OR assigned_user_id = p_user_id)
        ORDER BY priority DESC LIMIT 20) t
    ), '[]'::jsonb),
    'upcoming', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, title, priority, due_date, assigned_user_id, related_contact_id
        FROM tasks WHERE company_id = p_company_id AND status IN ('open','in_progress','waiting')
          AND due_date > CURRENT_DATE
          AND (p_user_id IS NULL OR assigned_user_id = p_user_id)
        ORDER BY due_date ASC LIMIT 20) t
    ), '[]'::jsonb),
    'assigned_to_me', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, title, priority, due_date, assigned_user_id, related_contact_id
        FROM tasks WHERE company_id = p_company_id AND status IN ('open','in_progress','waiting')
          AND assigned_user_id = p_user_id
        ORDER BY due_date ASC LIMIT 20) t
    ), '[]'::jsonb)
  );
$$;

-- 16. Triggers
DROP TRIGGER IF EXISTS set_updated_at_user_earnings ON user_earnings;
CREATE TRIGGER set_updated_at_user_earnings BEFORE UPDATE ON user_earnings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_dash_prefs ON dashboard_preferences;
CREATE TRIGGER set_updated_at_dash_prefs BEFORE UPDATE ON dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 17. Seed permissions
INSERT INTO permissions (key, name, description, category)
VALUES
  ('view_dashboard', 'View Dashboard', 'Access the main dashboard', 'dashboard'),
  ('view_all_revenue', 'View All Revenue', 'View company-wide revenue and all user earnings', 'reporting'),
  ('view_personal_earnings', 'View Personal Earnings', 'View own personal earnings', 'reporting'),
  ('manage_compensation', 'Manage Compensation', 'Manage compensation rules and payout statuses', 'reporting'),
  ('view_reports', 'View Reports', 'Access reporting and analytics', 'reporting'),
  ('customize_dashboard', 'Customize Dashboard', 'Rearrange and hide dashboard cards', 'dashboard')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE v_admin_role uuid; v_member_role uuid;
BEGIN
  SELECT id INTO v_admin_role FROM roles WHERE name = 'Admin' LIMIT 1;
  IF v_admin_role IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_admin_role, id FROM permissions
    WHERE key IN ('view_dashboard','view_all_revenue','view_personal_earnings','manage_compensation','view_reports','customize_dashboard')
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_member_role FROM roles WHERE name = 'User' LIMIT 1;
  IF v_member_role IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_member_role, id FROM permissions
    WHERE key IN ('view_dashboard','view_personal_earnings','customize_dashboard')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
