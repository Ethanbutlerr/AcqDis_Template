-- Safe acquisition and disposition stage customization.
-- REVIEW BEFORE APPLYING. Stable stage_key values preserve workflow behavior when labels change.

SET lock_timeout = '2s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.protect_pipeline_stage_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_key IS DISTINCT FROM OLD.stage_key THEN
    RAISE EXCEPTION 'A stage workflow key cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.stage_key IS NOT NULL THEN
    RAISE EXCEPTION 'A required workflow stage cannot be deleted; rename or reorder it instead';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_pipeline_stage_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_pipeline_stage_key() FROM anon;
REVOKE ALL ON FUNCTION public.protect_pipeline_stage_key() FROM authenticated;

DROP TRIGGER IF EXISTS trg_protect_acquisition_stage_key ON public.acquisition_pipeline_stages;
CREATE TRIGGER trg_protect_acquisition_stage_key
BEFORE UPDATE OF stage_key OR DELETE ON public.acquisition_pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.protect_pipeline_stage_key();

DROP TRIGGER IF EXISTS trg_protect_disposition_stage_key ON public.disposition_pipeline_stages;
CREATE TRIGGER trg_protect_disposition_stage_key
BEFORE UPDATE OF stage_key OR DELETE ON public.disposition_pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.protect_pipeline_stage_key();

DROP POLICY IF EXISTS "sel_disp_stages" ON public.disposition_pipeline_stages;
DROP POLICY IF EXISTS "ins_disp_stages" ON public.disposition_pipeline_stages;
DROP POLICY IF EXISTS "upd_disp_stages" ON public.disposition_pipeline_stages;
DROP POLICY IF EXISTS "del_disp_stages" ON public.disposition_pipeline_stages;

CREATE POLICY "select_disposition_stages_company"
ON public.disposition_pipeline_stages FOR SELECT TO authenticated
USING (company_id = public.get_current_company_id());

CREATE POLICY "insert_disposition_stages_authorized"
ON public.disposition_pipeline_stages FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND stage_key IS NULL
  AND is_system = false
);

CREATE POLICY "update_disposition_stages_authorized"
ON public.disposition_pipeline_stages FOR UPDATE TO authenticated
USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'))
WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));

CREATE POLICY "delete_custom_disposition_stages_authorized"
ON public.disposition_pipeline_stages FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND stage_key IS NULL
  AND is_system = false
);

DROP POLICY IF EXISTS "insert_acq_ps_perm" ON public.acquisition_pipeline_stages;
DROP POLICY IF EXISTS "update_acq_ps_perm" ON public.acquisition_pipeline_stages;
DROP POLICY IF EXISTS "delete_acq_ps_perm" ON public.acquisition_pipeline_stages;

CREATE POLICY "insert_custom_acquisition_stages_authorized"
ON public.acquisition_pipeline_stages FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND stage_key IS NULL
  AND is_system = false
);

CREATE POLICY "update_acquisition_stages_authorized"
ON public.acquisition_pipeline_stages FOR UPDATE TO authenticated
USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

CREATE POLICY "delete_custom_acquisition_stages_authorized"
ON public.acquisition_pipeline_stages FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND stage_key IS NULL
  AND is_system = false
);

CREATE OR REPLACE FUNCTION public.save_pipeline_stage_layout(
  p_pipeline text,
  p_stages jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
$function$;

CREATE OR REPLACE FUNCTION public.create_pipeline_stage(
  p_pipeline text,
  p_name text,
  p_color text DEFAULT '#6b7280'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid := public.get_current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_color text := lower(COALESCE(p_color, ''));
  v_definition_id uuid;
  v_stage_id uuid;
  v_result jsonb;
BEGIN
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_pipeline_stage(p_pipeline text, p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_id uuid := public.get_current_company_id();
BEGIN
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
$function$;

REVOKE ALL ON FUNCTION public.save_pipeline_stage_layout(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_pipeline_stage(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_pipeline_stage(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pipeline_stage_layout(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_pipeline_stage(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_pipeline_stage(text, uuid) TO authenticated;

DROP TRIGGER IF EXISTS set_updated_at_disposition_pipeline_stages ON public.disposition_pipeline_stages;
CREATE TRIGGER set_updated_at_disposition_pipeline_stages
BEFORE UPDATE ON public.disposition_pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
