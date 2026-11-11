-- Show every matching lead in one board page (up to 5,000) while preserving row policies.
-- Keep bulk edits atomic for a selected board page.

CREATE OR REPLACE FUNCTION public.bulk_edit_acquisition_leads(p_ids uuid[], p_action text, p_value text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_count integer; v_expected integer; v_owner uuid;
BEGIN
  IF NOT public.has_permission('edit_acquisitions') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_ids) id;
  IF v_expected < 1 OR v_expected > 5000 THEN RAISE EXCEPTION 'Select between 1 and 5000 leads'; END IF;
  IF p_action = 'assign' THEN
    IF NOT public.has_permission('assign_leads') THEN RAISE EXCEPTION 'Assignment permission required'; END IF;
    v_owner := NULLIF(p_value, '')::uuid;
    IF v_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_owner AND company_id = public.get_current_company_id() AND NOT is_disabled AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid manager'; END IF;
    UPDATE acquisition_records SET assigned_user_id = v_owner, updated_at = now() WHERE id = ANY(p_ids) AND deleted_at IS NULL;
  ELSIF p_action = 'group' THEN
    UPDATE acquisition_records SET group_id = NULLIF(p_value,'')::uuid, updated_at = now() WHERE id = ANY(p_ids) AND deleted_at IS NULL;
  ELSIF p_action = 'tag' AND length(btrim(p_value)) BETWEEN 1 AND 80 THEN
    UPDATE acquisition_records SET tags = ARRAY(SELECT DISTINCT t FROM unnest(tags || ARRAY[btrim(p_value)]) t), updated_at = now() WHERE id = ANY(p_ids) AND deleted_at IS NULL;
  ELSE RAISE EXCEPTION 'Invalid bulk action'; END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION 'Some leads could not be changed. No changes were saved.'; END IF;
  IF p_action = 'assign' THEN
    UPDATE opportunities o SET assigned_acquisition_user_id = v_owner FROM acquisition_records a WHERE a.id = ANY(p_ids) AND a.opportunity_id = o.id;
  END IF;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.bulk_edit_acquisition_leads(uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_edit_acquisition_leads(uuid[],text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_acquisition_leads(p_filters jsonb DEFAULT '{}', p_page integer DEFAULT 0, p_sort text DEFAULT 'stage_entered_at', p_direction text DEFAULT 'desc')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH filtered AS (
  SELECT a.*, concat_ws(' ',c.first_name,c.last_name) AS seller_name,
    p.street_address AS property_address, o.expected_revenue AS potential_revenue,
    array_position(ARRAY['urgent','high','medium','low'],a.priority) AS priority_order
  FROM acquisition_records a
  LEFT JOIN contacts c ON c.id = a.contact_id AND c.company_id = a.company_id
  LEFT JOIN properties p ON p.id = a.property_id AND p.company_id = a.company_id
  LEFT JOIN opportunities o ON o.id = a.opportunity_id AND o.company_id = a.company_id
  WHERE a.company_id = public.get_current_company_id() AND a.deleted_at IS NULL AND a.archived_at IS NULL
    AND (COALESCE(p_filters->>'stage','all') = 'all' OR a.pipeline_stage_id::text = p_filters->>'stage')
    AND (COALESCE(p_filters->>'assigned','all') = 'all' OR (p_filters->>'assigned' = 'mine' AND a.assigned_user_id = auth.uid()) OR (p_filters->>'assigned' = 'unassigned' AND a.assigned_user_id IS NULL) OR a.assigned_user_id::text = p_filters->>'assigned')
    AND (COALESCE(p_filters->>'source','all') = 'all' OR a.lead_source = p_filters->>'source')
    AND (COALESCE(p_filters->>'motivation','all') = 'all' OR lower(a.motivation) = lower(p_filters->>'motivation'))
    AND (COALESCE(p_filters->>'group','all') = 'all' OR (p_filters->>'group' = 'none' AND a.group_id IS NULL) OR a.group_id::text = p_filters->>'group')
    AND (COALESCE(p_filters->>'batch','all') = 'all' OR a.import_batch_id::text = p_filters->>'batch')
    AND (COALESCE(p_filters->>'tag','') = '' OR a.tags @> ARRAY[p_filters->>'tag'])
    AND (NULLIF(p_filters->>'from','') IS NULL OR a.created_at >= (p_filters->>'from')::timestamptz)
    AND (NULLIF(p_filters->>'to','') IS NULL OR a.created_at < (p_filters->>'to')::timestamptz)
    AND (COALESCE(p_filters->>'search','') = '' OR strpos(lower(concat_ws(' ',c.first_name,c.last_name,c.primary_phone,p.street_address,p.city,p.state,a.motivation)), lower(p_filters->>'search')) > 0
      OR (length(regexp_replace(p_filters->>'search','[^0-9]','','g')) >= 3 AND strpos(regexp_replace(c.primary_phone,'[^0-9]','','g'),regexp_replace(p_filters->>'search','[^0-9]','','g')) > 0))
), page AS (
  SELECT * FROM filtered ORDER BY
    CASE WHEN p_direction = 'asc' AND p_sort = 'seller_name' THEN seller_name END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'seller_name' THEN seller_name END DESC,
    CASE WHEN p_direction = 'asc' AND p_sort = 'property_address' THEN property_address END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'property_address' THEN property_address END DESC,
    CASE WHEN p_direction = 'asc' AND p_sort = 'priority' THEN priority_order END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'priority' THEN priority_order END DESC,
    CASE WHEN p_direction = 'asc' AND p_sort = 'stage_entered_at' THEN stage_entered_at END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'stage_entered_at' THEN stage_entered_at END DESC,
    CASE WHEN p_direction = 'asc' AND p_sort = 'last_contacted_at' THEN last_contacted_at END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'last_contacted_at' THEN last_contacted_at END DESC,
    CASE WHEN p_direction = 'asc' AND p_sort = 'potential_revenue' THEN potential_revenue END ASC,
    CASE WHEN p_direction <> 'asc' AND p_sort = 'potential_revenue' THEN potential_revenue END DESC,
    id
  LIMIT 5000 OFFSET greatest(0,p_page) * 5000
)
SELECT jsonb_build_object(
  'records',COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'),
  'total',(SELECT count(*) FROM filtered),
  'sources',COALESCE((SELECT jsonb_agg(source) FROM (SELECT DISTINCT lead_source source FROM acquisition_records WHERE company_id=get_current_company_id() AND deleted_at IS NULL AND archived_at IS NULL AND NULLIF(lead_source,'') IS NOT NULL ORDER BY source) s),'[]'),
  'motivations',COALESCE((SELECT jsonb_agg(motivation) FROM (SELECT DISTINCT motivation FROM acquisition_records WHERE company_id=get_current_company_id() AND deleted_at IS NULL AND archived_at IS NULL AND NULLIF(motivation,'') IS NOT NULL ORDER BY motivation) m),'[]')
);
$$;
REVOKE ALL ON FUNCTION public.search_acquisition_leads(jsonb,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_acquisition_leads(jsonb,integer,text,text) TO authenticated;
