/*
# Security Fix — Switch SECURITY DEFINER functions to SECURITY INVOKER

## Issue
The scanner flags that authenticated users can execute SECURITY DEFINER functions.
SECURITY DEFINER functions run with the function owner's privileges, bypassing RLS.
This is a privilege escalation risk if a function has a bug or accepts user-controlled params.

## Fix
Switch all 20 SECURITY DEFINER functions to SECURITY INVOKER.
- INVOKER functions run with the caller's privileges, subject to RLS.
- The app's frontend calls these via the Supabase JS client (authenticated session).
- RLS policies on the underlying tables scope access to the caller's company.
- Functions that call get_current_company_id() / has_permission() still work because
  those functions can remain SECURITY DEFINER (they only read the caller's own data
  and are safe — profiles RLS allows reading own profile, user_roles RLS allows
  reading own role assignments).

## Exceptions
- get_current_company_id(), get_user_permissions(), has_permission(),
  get_my_company_id(), is_company_manager(), get_user_company_id()
  STAY as SECURITY DEFINER because they read from tables (profiles, user_roles,
  role_permissions) where RLS policies reference these same functions recursively.
  Switching them to INVOKER would cause infinite recursion.
  Instead, EXECUTE is already revoked from anon, and authenticated EXECUTE
  is safe because these functions only return the caller's own data.

- log_audit_entry stays SECURITY DEFINER. EXECUTE is revoked from both anon
  and authenticated. Only callable via service role key from edge functions.

## Dashboard/reporting functions → SECURITY INVOKER
These take p_company_id as a parameter and filter by it. With INVOKER, RLS on
the underlying tables provides defense-in-depth: even if a caller passes a
different company_id, RLS blocks access to that company's data.
*/

-- Auth helper functions: keep SECURITY DEFINER (prevent RLS recursion)
-- EXECUTE already revoked from anon in migration 028.
-- These are safe: they only return the caller's own data.
-- (No change needed — just documenting why they stay DEFINER)

-- Dashboard / reporting functions → SECURITY INVOKER
ALTER FUNCTION public.get_dashboard_kpis(uuid, timestamptz, timestamptz, uuid, boolean) SECURITY INVOKER;
ALTER FUNCTION public.get_dashboard_tasks(uuid, uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_conversion_metrics(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_leads_by_source(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_leads_by_stage(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_leads_by_campaign(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_leads_contracts_closings(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_revenue_by_month(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_revenue_by_user(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_deals_by_disposition_stage(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_dead_lost_reasons(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.get_avg_days_in_stage(uuid) SECURITY INVOKER;
ALTER FUNCTION public.global_search(uuid, text, integer) SECURITY INVOKER;
