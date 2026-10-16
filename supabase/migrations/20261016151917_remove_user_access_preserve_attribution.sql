-- Account removal preserves profiles, assignments and historical attribution.
SET lock_timeout = '2s';
SET statement_timeout = '60s';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.profiles ADD CONSTRAINT removed_profiles_are_disabled
  CHECK (deleted_at IS NULL OR is_disabled);

-- Restore protection against accidental hard deletion of recorded actors.
-- The application now soft-deletes credentials, never the profile.
ALTER TABLE public.pipeline_move_requests
  DROP CONSTRAINT pipeline_move_requests_actor_id_fkey,
  ADD CONSTRAINT pipeline_move_requests_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.opportunity_creation_requests
  DROP CONSTRAINT opportunity_creation_requests_actor_id_fkey,
  ADD CONSTRAINT opportunity_creation_requests_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Extend existing authorization helpers to reject disabled/removed accounts.
-- Keep the existing SECURITY DEFINER boundary used by RLS to avoid recursion.
CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_id FROM public.profiles
  WHERE id = auth.uid() AND NOT is_disabled AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_id FROM public.profiles
  WHERE id = auth.uid() AND NOT is_disabled AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH aliases(old_key,new_key) AS (VALUES
  ('edit_acquisition_records','edit_acquisitions'),
  ('view_acquisitions_pipeline','view_acquisitions'),
  ('send_buyer_sms_blast','send_buyer_sms_campaigns')),
granted AS (
  SELECT DISTINCT COALESCE(a.new_key,p.key) AS key
  FROM public.user_roles ur
  JOIN public.profiles caller ON caller.id = ur.user_id
  JOIN public.role_permissions rp ON rp.role_id=ur.role_id
  JOIN public.permissions p ON p.id=rp.permission_id
  LEFT JOIN aliases a ON a.old_key=p.key
  WHERE ur.user_id=auth.uid() AND NOT caller.is_disabled AND caller.deleted_at IS NULL
)
SELECT ARRAY(SELECT key FROM granted
  UNION SELECT a.old_key FROM aliases a JOIN granted g ON g.key=a.new_key);
$$;

-- An old access JWT can remain valid after Auth credentials/sessions are
-- removed. Require an active account in addition to every existing RLS policy,
-- including policies that only test user_id = auth.uid(). This does not grant
-- any new access; original company/assignment/permission rules still apply.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND c.relrowsecurity
      AND (n.nspname = 'public' OR
           (n.nspname = 'storage' AND c.relname IN ('objects','buckets')))
  LOOP
    EXECUTE format(
      'CREATE POLICY require_active_account ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT public.get_current_company_id()) IS NOT NULL)
       WITH CHECK ((SELECT public.get_current_company_id()) IS NOT NULL)',
      target.nspname, target.relname);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
