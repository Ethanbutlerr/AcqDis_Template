-- Consolidate the catalog without deleting legacy permission IDs or role access.
BEGIN;
INSERT INTO public.permissions (key,name,description,category) VALUES
('manage_pipeline_stages','Manage Pipeline Stages','Configure stages for pipelines you can edit; ordinary deal editing does not require this.','Administration'),
('make_calls','Make Calls','Place outbound calls from the CRM.','Calls & Messages'),
('receive_calls','Receive Calls','Receive incoming calls in the CRM.','Calls & Messages'),
('delete_records','Delete or Archive Records','Delete or archive CRM records you can already access and edit.','Administration')
ON CONFLICT (key) DO NOTHING;

-- Preserve existing effective capabilities when introducing separate controls.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM public.role_permissions rp JOIN public.permissions source ON source.id=rp.permission_id
JOIN (VALUES
('edit_acquisition_records','edit_acquisitions'),
('view_acquisitions_pipeline','view_acquisitions'),
('send_buyer_sms_blast','send_buyer_sms_campaigns'),
('edit_acquisitions','manage_pipeline_stages'),('edit_dispositions','manage_pipeline_stages'),
('edit_lead_pipeline','manage_pipeline_stages'),('edit_management','manage_pipeline_stages'),
('view_calls','make_calls'),('view_acquisitions','make_calls'),('view_acquisitions_pipeline','make_calls'),('view_dispositions','make_calls'),
('view_calls','receive_calls'),
('edit_contacts','delete_records'),('edit_acquisitions','delete_records'),('edit_acquisition_records','delete_records'),
('edit_dispositions','delete_records'),('edit_management','delete_records'),('edit_lead_pipeline','delete_records'),
('edit_tasks','delete_records'),('assign_leads','delete_records'),
('edit_lead_pipeline','restore_deleted_records'),('edit_contacts','restore_deleted_records'),('assign_leads','restore_deleted_records')
) mapping(old_key,new_key) ON mapping.old_key=source.key
JOIN public.permissions target ON target.key=mapping.new_key
ON CONFLICT DO NOTHING;

UPDATE public.permissions SET category=CASE
WHEN category IN ('Acquisitions','Dispositions','Contacts & Buyers','Calls & Messages','Campaigns','Tasks & Files','Reporting','Administration','Developer Tools') THEN category
WHEN category IN ('acquisitions') THEN 'Acquisitions'
WHEN category IN ('dispositions') THEN 'Dispositions'
WHEN category IN ('contacts','Contacts','Buyer Pipeline','Properties','Opportunities') THEN 'Contacts & Buyers'
WHEN category IN ('Communications','sms','notifications') THEN 'Calls & Messages'
WHEN category IN ('Lead Pipeline') THEN 'Campaigns'
WHEN category IN ('Tasks','Files') THEN 'Tasks & Files'
WHEN category IN ('dashboard','reporting') THEN 'Reporting'
WHEN category IN ('developer') OR key='view_developer_changelog' OR key='simulate_answered_call' THEN 'Developer Tools'
ELSE 'Administration' END;
UPDATE public.permissions SET category='Developer Tools' WHERE key='simulate_answered_call';
UPDATE public.permissions SET name='Create and Edit Acquisitions',description='Create acquisition deals and update their details and stage.' WHERE key='edit_acquisitions';
UPDATE public.permissions SET name='Send Buyer Campaigns',description='Create and launch bulk SMS campaigns to buyers.' WHERE key='send_buyer_sms_campaigns';
UPDATE public.permissions SET name='Edit Lead Records',description='Update seller lead records and move leads between existing stages.' WHERE key='edit_lead_pipeline';
UPDATE public.permissions SET name='Edit Management Records',description='Update management records and move them between existing stages.' WHERE key='edit_management';
UPDATE public.permissions SET name='Restore Suppressed / DNC Contacts',description='Remove suppression only after confirming renewed permission to contact.' WHERE key='restore_suppressed_contacts';
UPDATE public.permissions SET name='Suppress / DNC Contacts',description='Block further campaign messages to a contact.' WHERE key='suppress_contacts';

-- Expand aliases in both directions for old clients and existing policies.
CREATE OR REPLACE FUNCTION public.get_user_permissions() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH aliases(old_key,new_key) AS (VALUES
('edit_acquisition_records','edit_acquisitions'),
('view_acquisitions_pipeline','view_acquisitions'),
('send_buyer_sms_blast','send_buyer_sms_campaigns')),
granted AS (
 SELECT DISTINCT COALESCE(a.new_key,p.key) AS key
 FROM public.user_roles ur
 JOIN public.role_permissions rp ON rp.role_id=ur.role_id
 JOIN public.permissions p ON p.id=rp.permission_id
 LEFT JOIN aliases a ON a.old_key=p.key
 WHERE ur.user_id=auth.uid()
)
SELECT ARRAY(SELECT key FROM granted UNION SELECT a.old_key FROM aliases a JOIN granted g ON g.key=a.new_key);
$function$;
CREATE OR REPLACE FUNCTION public.has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT auth.uid() IS NOT NULL AND perm_key=ANY(public.get_user_permissions()); $function$;

ALTER POLICY "delete_lps_perm" ON public.lead_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_lead_pipeline'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "insert_lps_perm" ON public.lead_pipeline_stages WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_lead_pipeline'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "update_lps_perm" ON public.lead_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_lead_pipeline'::text))) AND public.has_permission('manage_pipeline_stages')) WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_lead_pipeline'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "delete_custom_acquisition_stages_authorized" ON public.acquisition_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND (stage_key IS NULL) AND (is_system = false))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "insert_custom_acquisition_stages_authorized" ON public.acquisition_pipeline_stages WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND (stage_key IS NULL) AND (is_system = false))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "update_acquisition_stages_authorized" ON public.acquisition_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text))) AND public.has_permission('manage_pipeline_stages')) WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "del_mgmt_stages" ON public.management_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "ins_mgmt_stages" ON public.management_pipeline_stages WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "upd_mgmt_stages" ON public.management_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages')) WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "del_psm" ON public.pipeline_stage_mappings USING ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "ins_psm" ON public.pipeline_stage_mappings WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "upd_psm" ON public.pipeline_stage_mappings USING ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages')) WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_management'::text))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "delete_custom_disposition_stages_authorized" ON public.disposition_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND (stage_key IS NULL) AND (is_system = false))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "insert_disposition_stages_authorized" ON public.disposition_pipeline_stages WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND (stage_key IS NULL) AND (is_system = false))) AND public.has_permission('manage_pipeline_stages'));
ALTER POLICY "update_disposition_stages_authorized" ON public.disposition_pipeline_stages USING ((((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text))) AND public.has_permission('manage_pipeline_stages')) WITH CHECK ((((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text))) AND public.has_permission('manage_pipeline_stages'));

CREATE OR REPLACE FUNCTION public.create_pipeline_stage(p_pipeline text, p_name text, p_color text DEFAULT '#6b7280'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_company_id uuid := public.get_current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_color text := lower(COALESCE(p_color, ''));
  v_definition_id uuid;
  v_stage_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_permission('manage_pipeline_stages') THEN
    RAISE EXCEPTION 'You do not have permission to configure pipeline stages';
  END IF;
  IF auth.uid() IS NULL OR v_company_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF length(v_name) < 1 OR length(v_name) > 80 THEN RAISE EXCEPTION 'Stage names must be 1 to 80 characters'; END IF;
  IF v_color !~ '^#[0-9a-f]{6}$' THEN RAISE EXCEPTION 'Use a six-digit hex color'; END IF;

  IF p_pipeline = 'acquisition' THEN
    IF NOT public.has_permission('edit_acquisitions') THEN RAISE EXCEPTION 'You do not have permission to customize acquisition stages'; END IF;
    IF (SELECT count(*) FROM public.acquisition_pipeline_stages WHERE company_id = v_company_id) >= 30 THEN RAISE EXCEPTION 'This pipeline already has 30 stages'; END IF;
    SELECT id INTO v_definition_id FROM public.acquisition_pipeline_definitions WHERE company_id = v_company_id ORDER BY is_default DESC, created_at LIMIT 1;
    IF v_definition_id IS NULL THEN RAISE EXCEPTION 'The acquisition pipeline is not configured'; END IF;
    INSERT INTO public.acquisition_pipeline_stages (pipeline_definition_id, company_id, name, sort_order, is_system, color, stage_key)
    VALUES (v_definition_id, v_company_id, v_name, COALESCE((SELECT max(sort_order) + 1 FROM public.acquisition_pipeline_stages WHERE company_id = v_company_id), 1), false, v_color, NULL)
    RETURNING id INTO v_stage_id;
    SELECT to_jsonb(stage) INTO v_result FROM public.acquisition_pipeline_stages stage WHERE stage.id = v_stage_id;
  ELSIF p_pipeline = 'disposition' THEN
    IF NOT public.has_permission('edit_dispositions') THEN RAISE EXCEPTION 'You do not have permission to customize disposition stages'; END IF;
    IF (SELECT count(*) FROM public.disposition_pipeline_stages WHERE company_id = v_company_id) >= 30 THEN RAISE EXCEPTION 'This pipeline already has 30 stages'; END IF;
    INSERT INTO public.disposition_pipeline_stages (company_id, name, color, position, is_terminal, is_system, stage_key)
    VALUES (v_company_id, v_name, v_color, COALESCE((SELECT max(position) + 1 FROM public.disposition_pipeline_stages WHERE company_id = v_company_id), 1), false, false, NULL)
    RETURNING id INTO v_stage_id;
    SELECT to_jsonb(stage) INTO v_result FROM public.disposition_pipeline_stages stage WHERE stage.id = v_stage_id;
  ELSE
    RAISE EXCEPTION 'Unsupported pipeline';
  END IF;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_pipeline_stage(p_pipeline text, p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_company_id uuid := public.get_current_company_id();
BEGIN
  IF NOT public.has_permission('manage_pipeline_stages') THEN
    RAISE EXCEPTION 'You do not have permission to configure pipeline stages';
  END IF;
  IF auth.uid() IS NULL OR v_company_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF p_pipeline = 'acquisition' THEN
    IF NOT public.has_permission('edit_acquisitions') THEN RAISE EXCEPTION 'You do not have permission to customize acquisition stages'; END IF;
    IF EXISTS (SELECT 1 FROM public.acquisition_records WHERE company_id = v_company_id AND pipeline_stage_id = p_stage_id) THEN RAISE EXCEPTION 'Move records out of this stage before deleting it'; END IF;
    DELETE FROM public.acquisition_pipeline_stages WHERE id = p_stage_id AND company_id = v_company_id AND stage_key IS NULL AND is_system = false;
  ELSIF p_pipeline = 'disposition' THEN
    IF NOT public.has_permission('edit_dispositions') THEN RAISE EXCEPTION 'You do not have permission to customize disposition stages'; END IF;
    IF EXISTS (SELECT 1 FROM public.disposition_records WHERE company_id = v_company_id AND pipeline_stage_id = p_stage_id) THEN RAISE EXCEPTION 'Move records out of this stage before deleting it'; END IF;
    DELETE FROM public.disposition_pipeline_stages WHERE id = p_stage_id AND company_id = v_company_id AND stage_key IS NULL AND is_system = false;
  ELSE
    RAISE EXCEPTION 'Unsupported pipeline';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an unused custom stage can be deleted'; END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_pipeline_stage_layout(p_pipeline text, p_stages jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_company_id uuid := public.get_current_company_id();
  v_item jsonb;
  v_expected_count integer;
  v_received_count integer;
  v_index integer := 0;
  v_name text;
  v_color text;
BEGIN
  IF NOT public.has_permission('manage_pipeline_stages') THEN
    RAISE EXCEPTION 'You do not have permission to configure pipeline stages';
  END IF;
  IF auth.uid() IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_pipeline = 'acquisition' AND NOT public.has_permission('edit_acquisitions') THEN
    RAISE EXCEPTION 'You do not have permission to customize acquisition stages';
  ELSIF p_pipeline = 'disposition' AND NOT public.has_permission('edit_dispositions') THEN
    RAISE EXCEPTION 'You do not have permission to customize disposition stages';
  ELSIF p_pipeline NOT IN ('acquisition', 'disposition') THEN
    RAISE EXCEPTION 'Unsupported pipeline';
  END IF;
  IF jsonb_typeof(p_stages) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The complete ordered stage list is required';
  END IF;

  v_received_count := jsonb_array_length(p_stages);
  IF v_received_count = 0 OR v_received_count > 30 THEN
    RAISE EXCEPTION 'A pipeline must contain between 1 and 30 stages';
  END IF;

  IF p_pipeline = 'acquisition' THEN
    SELECT count(*) INTO v_expected_count FROM public.acquisition_pipeline_stages WHERE company_id = v_company_id;
    PERFORM 1 FROM public.acquisition_pipeline_stages WHERE company_id = v_company_id FOR UPDATE;
    IF v_expected_count <> v_received_count OR (
      SELECT count(DISTINCT item ->> 'id') FROM jsonb_array_elements(p_stages) item
    ) <> v_expected_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_stages) item
      WHERE NOT EXISTS (
        SELECT 1 FROM public.acquisition_pipeline_stages stage
        WHERE stage.company_id = v_company_id AND stage.id = (item ->> 'id')::uuid
      )
    ) THEN
      RAISE EXCEPTION 'Save the complete current acquisition stage list';
    END IF;

    UPDATE public.acquisition_pipeline_stages
    SET sort_order = sort_order + 10000,
        name = '__stage_edit__' || id::text
    WHERE company_id = v_company_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_stages) LOOP
      v_index := v_index + 1;
      v_name := btrim(COALESCE(v_item ->> 'name', ''));
      v_color := lower(COALESCE(v_item ->> 'color', ''));
      IF length(v_name) < 1 OR length(v_name) > 80 THEN RAISE EXCEPTION 'Stage names must be 1 to 80 characters'; END IF;
      IF v_color !~ '^#[0-9a-f]{6}$' THEN RAISE EXCEPTION 'Each stage needs a six-digit hex color'; END IF;
      UPDATE public.acquisition_pipeline_stages
      SET name = v_name, color = v_color, sort_order = v_index, updated_at = now()
      WHERE company_id = v_company_id AND id = (v_item ->> 'id')::uuid;
    END LOOP;

    RETURN COALESCE((SELECT jsonb_agg(to_jsonb(stage) ORDER BY stage.sort_order) FROM public.acquisition_pipeline_stages stage WHERE stage.company_id = v_company_id), '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_expected_count FROM public.disposition_pipeline_stages WHERE company_id = v_company_id;
  PERFORM 1 FROM public.disposition_pipeline_stages WHERE company_id = v_company_id FOR UPDATE;
  IF v_expected_count <> v_received_count OR (
    SELECT count(DISTINCT item ->> 'id') FROM jsonb_array_elements(p_stages) item
  ) <> v_expected_count OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_stages) item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.disposition_pipeline_stages stage
      WHERE stage.company_id = v_company_id AND stage.id = (item ->> 'id')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'Save the complete current disposition stage list';
  END IF;

  UPDATE public.disposition_pipeline_stages
  SET position = position + 10000,
      name = '__stage_edit__' || id::text
  WHERE company_id = v_company_id;

  v_index := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_stages) LOOP
    v_index := v_index + 1;
    v_name := btrim(COALESCE(v_item ->> 'name', ''));
    v_color := lower(COALESCE(v_item ->> 'color', ''));
    IF length(v_name) < 1 OR length(v_name) > 80 THEN RAISE EXCEPTION 'Stage names must be 1 to 80 characters'; END IF;
    IF v_color !~ '^#[0-9a-f]{6}$' THEN RAISE EXCEPTION 'Each stage needs a six-digit hex color'; END IF;
    UPDATE public.disposition_pipeline_stages
    SET name = v_name, color = v_color, position = v_index, updated_at = now()
    WHERE company_id = v_company_id AND id = (v_item ->> 'id')::uuid;
  END LOOP;

  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(stage) ORDER BY stage.position) FROM public.disposition_pipeline_stages stage WHERE stage.company_id = v_company_id), '[]'::jsonb);
END;
$function$
;

-- Preserve existing visibility/edit policies and add a separate deletion gate.
CREATE OR REPLACE FUNCTION public.check_record_removal_permission() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE old_value jsonb; new_value jsonb;
BEGIN
 IF auth.uid() IS NULL THEN
   IF current_user IN ('postgres','service_role','supabase_admin') OR auth.role()='service_role' THEN
     RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
   END IF;
   RAISE EXCEPTION 'Authentication required';
 END IF;
 IF TG_OP='DELETE' THEN
   IF NOT public.has_permission('delete_records') THEN RAISE EXCEPTION 'Delete or Archive Records permission required'; END IF;
   RETURN OLD;
 END IF;
 old_value:=to_jsonb(OLD)->TG_ARGV[0]; new_value:=to_jsonb(NEW)->TG_ARGV[0];
 IF new_value IS DISTINCT FROM old_value THEN
   IF new_value IS DISTINCT FROM 'null'::jsonb AND NOT public.has_permission('delete_records') THEN
     RAISE EXCEPTION 'Delete or Archive Records permission required';
   ELSIF new_value='null'::jsonb AND NOT public.has_permission('restore_deleted_records') THEN
     RAISE EXCEPTION 'Restore Deleted Records permission required';
   END IF;
 END IF;
 RETURN NEW;
END; $function$;
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.acquisition_records FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.disposition_records FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.management_records FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.properties FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF deleted_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('deleted_at');
CREATE TRIGGER permission_record_removal BEFORE DELETE OR UPDATE OF archived_at ON public.lead_records FOR EACH ROW EXECUTE FUNCTION public.check_record_removal_permission('archived_at');

-- Save roles atomically so a failed permission insert cannot erase existing access.
CREATE OR REPLACE FUNCTION public.save_role_permissions(p_role_id uuid,p_name text,p_description text,p_permission_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_role_id uuid; v_company_id uuid:=public.get_current_company_id();
BEGIN
 IF auth.uid() IS NULL OR v_company_id IS NULL OR NOT public.has_permission('manage_roles') THEN RAISE EXCEPTION 'Manage Roles permission required'; END IF;
 IF length(btrim(COALESCE(p_name,'')))=0 THEN RAISE EXCEPTION 'Role name is required'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_permission_ids) AS requested(permission_id) WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.id=requested.permission_id)) THEN RAISE EXCEPTION 'Unknown permission'; END IF;
 IF p_role_id IS NULL THEN
   INSERT INTO public.roles(company_id,name,description) VALUES(v_company_id,btrim(p_name),p_description) RETURNING id INTO v_role_id;
 ELSE
   SELECT id INTO v_role_id FROM public.roles WHERE id=p_role_id AND company_id=v_company_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Role not found in your company'; END IF;
   UPDATE public.roles SET name=btrim(p_name),description=p_description WHERE id=v_role_id;
   DELETE FROM public.role_permissions WHERE role_id=v_role_id;
 END IF;
 INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT v_role_id,id FROM (SELECT DISTINCT unnest(p_permission_ids) id) p;
 RETURN v_role_id;
END; $function$;
REVOKE ALL ON FUNCTION public.save_role_permissions(uuid,text,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_role_permissions(uuid,text,text,uuid[]) TO authenticated;
COMMIT;
