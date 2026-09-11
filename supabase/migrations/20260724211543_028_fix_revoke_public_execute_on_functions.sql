/*
# Security Fix — Properly Revoke PUBLIC EXECUTE on SECURITY DEFINER Functions

## Root Cause
PostgreSQL grants EXECUTE to PUBLIC by default when functions are created.
The `anon` and `authenticated` roles inherit from PUBLIC, so REVOKE FROM anon
had no effect. Must REVOKE FROM PUBLIC, then GRANT back to authenticated
for functions that authenticated users legitimately call via REST.

## Functions that authenticated users SHOULD call via REST:
- get_current_company_id, get_user_permissions, has_permission (auth helpers)
- get_my_company_id, is_company_manager, get_user_company_id (auth helpers)
- get_dashboard_kpis, get_dashboard_tasks, get_conversion_metrics (dashboard)
- get_leads_by_source, get_leads_by_stage, get_leads_by_campaign (dashboard)
- get_leads_contracts_closings, get_revenue_by_month, get_revenue_by_user (dashboard)
- get_deals_by_disposition_stage, get_dead_lost_reasons, get_avg_days_in_stage (dashboard)
- global_search (global search)

## Function that should NOT be callable by any client (service-role only):
- log_audit_entry (only called from edge functions with service role key)
*/

-- ============================================================
-- Step 1: REVOKE EXECUTE FROM PUBLIC on ALL SECURITY DEFINER functions
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_current_company_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_permissions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_company_manager() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_company_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit_entry(uuid, uuid, text, text, uuid, jsonb, jsonb, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid, timestamptz, timestamptz, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_tasks(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversion_metrics(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_source(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_stage(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_campaign(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leads_contracts_closings(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_month(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_user(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_deals_by_disposition_stage(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dead_lost_reasons(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_avg_days_in_stage(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.global_search(uuid, text, integer) FROM PUBLIC;

-- ============================================================
-- Step 2: GRANT EXECUTE TO authenticated for client-callable functions
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_company_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid, timestamptz, timestamptz, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tasks(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversion_metrics(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_by_source(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_by_stage(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_by_campaign(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leads_contracts_closings(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_month(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_user(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_deals_by_disposition_stage(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dead_lost_reasons(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_avg_days_in_stage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, text, integer) TO authenticated;

-- Note: log_audit_entry is NOT granted to authenticated.
-- It is only called from edge functions using the service role key,
-- which bypasses all permission checks including EXECUTE grants.
