-- Run after the access-removal migration. All changes are rolled back.
-- Uses an existing disabled account with pipeline history, or the UUID set
-- in test.removed_user_id by the caller before running this script.
BEGIN;
SELECT set_config('test.removed_user_id',
  COALESCE(NULLIF(current_setting('test.removed_user_id', true), ''),
    (SELECT p.id::text FROM public.profiles p WHERE p.is_disabled
      AND EXISTS (SELECT 1 FROM public.pipeline_move_requests r WHERE r.actor_id = p.id)
      ORDER BY p.created_at LIMIT 1)), true);
SELECT set_config('test.removed_user_name',
  (SELECT full_name FROM public.profiles WHERE id = current_setting('test.removed_user_id')::uuid), true);
CREATE TEMP TABLE preserved_history(table_name text, column_name text, checksum text) ON COMMIT DROP;
DO $$
DECLARE item record; checksum text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('acquisition_records','assigned_user_id'),
    ('disposition_records','assigned_user_id'),
    ('pipeline_move_requests','actor_id'),
    ('opportunity_creation_requests','actor_id'),
    ('acquisition_stage_history','changed_by'),
    ('notes','author_id'),
    ('calls','assigned_user_id'),
    ('messages','created_by')) AS items(table_name,column_name)
  LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, ''''))
      FROM public.%I t WHERE %I = $1', item.table_name, item.column_name)
      INTO checksum USING current_setting('test.removed_user_id')::uuid;
    INSERT INTO preserved_history VALUES(item.table_name,item.column_name,checksum);
  END LOOP;
END $$;
UPDATE public.profiles SET is_disabled = true, deleted_at = now()
WHERE id = current_setting('test.removed_user_id')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.removed_user_id'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected integer;
BEGIN
  ASSERT public.get_current_company_id() IS NULL, 'Removed account still has company access';
  ASSERT cardinality(public.get_user_permissions()) = 0, 'Removed account still has permissions';
  ASSERT NOT EXISTS(SELECT 1 FROM public.acquisition_records), 'Old JWT can read acquisitions';
  ASSERT NOT EXISTS(SELECT 1 FROM public.calls), 'Old JWT can read calls';
  ASSERT NOT EXISTS(SELECT 1 FROM public.messages), 'Old JWT can read messages';
  ASSERT NOT EXISTS(SELECT 1 FROM public.profiles), 'Old JWT can read profiles';
  BEGIN
    UPDATE public.profiles SET is_disabled = false, deleted_at = NULL WHERE id = auth.uid();
    GET DIAGNOSTICS affected = ROW_COUNT;
    ASSERT affected = 0, 'Removed account can restore itself';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- Column privileges also correctly prohibit restoring access.
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
FROM public.profiles p
WHERE NOT p.is_disabled AND p.deleted_at IS NULL
  AND p.company_id = (SELECT company_id FROM public.profiles WHERE id = current_setting('test.removed_user_id')::uuid)
ORDER BY p.created_at LIMIT 1;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT public.get_current_company_id() IS NOT NULL, 'Active account lost company access';
  ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid()), 'Active account lost its profile';
  ASSERT EXISTS(SELECT 1 FROM public.profiles WHERE id = current_setting('test.removed_user_id')::uuid
    AND full_name = current_setting('test.removed_user_name')), 'Historical user name is not readable';
END $$;
RESET ROLE;
DO $$
DECLARE item record; checksum text;
BEGIN
  FOR item IN SELECT * FROM preserved_history LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, ''''))
      FROM public.%I t WHERE %I = $1', item.table_name, item.column_name)
      INTO checksum USING current_setting('test.removed_user_id')::uuid;
    ASSERT checksum = item.checksum, 'Business records changed in ' || item.table_name;
  END LOOP;
END $$;
SELECT 'passed' AS access_and_attribution_checks, count(*) AS unchanged_history_tables FROM preserved_history;
ROLLBACK;
