/*
# Security Fix — Function Search Paths, Audit Log Policy, RPC Execute Grants

## Issues Fixed
1. Function Search Path Mutable — 4 trigger functions lacked SET search_path
2. RLS Policy Always True — audit_logs INSERT policy `insert_audit_logs_any` was never dropped
3. Public/Authenticated Can Execute SECURITY DEFINER Functions — revoke anon EXECUTE on all;
   revoke authenticated EXECUTE on internal-only helpers not called via REST

## Approach
- ALTER FUNCTION ... SET search_path = public for trigger functions
- DROP the legacy `insert_audit_logs_any` policy (leaves the scoped `insert_audit_logs_own`)
- REVOKE EXECUTE FROM anon on every SECURITY DEFINER function
- REVOKE EXECUTE FROM authenticated on `log_audit_entry` (only called server-side via service role)
*/

-- ============================================================
-- 1. Fix mutable search_path on trigger functions
-- ============================================================
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.update_integration_settings_updated_at() SET search_path = public;
ALTER FUNCTION public.update_buyer_campaigns_updated_at() SET search_path = public;
ALTER FUNCTION public.update_buyer_campaign_recipients_updated_at() SET search_path = public;

-- ============================================================
-- 2. Drop legacy open INSERT policy on audit_logs
-- Migration 001 created `insert_audit_logs_any` WITH CHECK (true).
-- Migration 024 added `insert_audit_logs_own` with proper company scoping
-- but never dropped the old one, so the open policy took precedence.
-- ============================================================
DROP POLICY IF EXISTS "insert_audit_logs_any" ON public.audit_logs;

-- ============================================================
-- 3. Revoke EXECUTE from anon on ALL SECURITY DEFINER functions
-- anon should never invoke these — the app uses authenticated sessions.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_current_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_permissions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_company_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_company_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_audit_entry(uuid, uuid, text, text, uuid, jsonb, jsonb, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid, timestamptz, timestamptz, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_tasks(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_conversion_metrics(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_source(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_stage(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_leads_by_campaign(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_leads_contracts_closings(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_month(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_user(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_deals_by_disposition_stage(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dead_lost_reasons(uuid, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_avg_days_in_stage(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.global_search(uuid, text, integer) FROM anon;

-- ============================================================
-- 4. Revoke EXECUTE from authenticated on log_audit_entry
-- This function is only called server-side (edge functions with
-- service role key, which bypasses EXECUTE checks). Revoking from
-- authenticated prevents direct client-side audit log injection.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.log_audit_entry(uuid, uuid, text, text, uuid, jsonb, jsonb, text, uuid, text) FROM authenticated;
