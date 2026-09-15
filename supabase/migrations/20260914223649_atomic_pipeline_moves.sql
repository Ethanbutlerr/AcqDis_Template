-- Atomic, authenticated pipeline movement.
-- REVIEW BEFORE APPLYING. This migration is local only until production approval.

SET lock_timeout = '2s';
SET statement_timeout = '60s';

ALTER TABLE public.acquisition_records
  ADD COLUMN IF NOT EXISTS contract_executed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Preserve the first recorded Contract Executed transition for historical rows.
-- Rows without matching stage-history evidence intentionally remain blank.
WITH contract_evidence AS (
  SELECT DISTINCT ON (a.id)
    a.id AS acquisition_record_id,
    h.created_at AS executed_at,
    h.changed_by AS executed_by
  FROM public.acquisition_records a
  JOIN public.acquisition_pipeline_stages s
    ON s.id = a.pipeline_stage_id
   AND s.company_id = a.company_id
   AND s.stage_key = 'contract_executed'
  JOIN public.acquisition_stage_history h
    ON h.acquisition_record_id = a.id
   AND h.company_id = a.company_id
   AND h.to_stage_id = s.id
  WHERE a.contract_executed_at IS NULL
  ORDER BY a.id, h.created_at, h.id
)
UPDATE public.acquisition_records a
SET contract_executed_at = e.executed_at,
    contract_executed_by = e.executed_by,
    attribution_snapshot = CASE
      WHEN a.attribution_snapshot = '{}'::jsonb THEN
        jsonb_build_object(
          'assigned_user_id', a.assigned_user_id,
          'executed_by', e.executed_by,
          'lead_source', a.lead_source,
          'opportunity_id', a.opportunity_id,
          'contact_id', a.contact_id,
          'property_id', a.property_id,
          'locked_at', e.executed_at,
          'source', 'acquisition_stage_history'
        )
      ELSE a.attribution_snapshot
    END
FROM contract_evidence e
WHERE a.id = e.acquisition_record_id;

UPDATE public.opportunities o
SET contract_date = a.contract_executed_at::date,
    updated_at = GREATEST(o.updated_at, a.contract_executed_at)
FROM public.acquisition_records a
JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id
 AND s.company_id = a.company_id
 AND s.stage_key = 'contract_executed'
WHERE o.id = a.opportunity_id
  AND o.company_id = a.company_id
  AND o.contract_date IS NULL
  AND a.contract_executed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acquisition_contract_actor_date
  ON public.acquisition_records (company_id, contract_executed_by, contract_executed_at)
  WHERE contract_executed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pipeline_move_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pipeline text NOT NULL CHECK (pipeline IN ('acquisition', 'disposition', 'management')),
  record_id uuid NOT NULL,
  from_stage_id uuid,
  to_stage_id uuid NOT NULL,
  note text NOT NULL,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, request_id)
);

ALTER TABLE public.pipeline_move_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_pipeline_move_requests"
ON public.pipeline_move_requests
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    actor_id = (SELECT auth.uid())
    OR public.has_permission('view_all_acquisition_leads')
    OR public.has_permission('view_all_disposition_deals')
  )
);

CREATE TABLE IF NOT EXISTS public.disposition_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  disposition_record_id uuid NOT NULL REFERENCES public.disposition_records(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES public.disposition_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES public.disposition_pipeline_stages(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_automated boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.disposition_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_visible_disposition_stage_history"
ON public.disposition_stage_history
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1
    FROM public.disposition_records d
    WHERE d.id = disposition_stage_history.disposition_record_id
  )
);

CREATE INDEX IF NOT EXISTS idx_disposition_stage_history_record_time
  ON public.disposition_stage_history (disposition_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.management_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  management_record_id uuid NOT NULL REFERENCES public.management_records(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES public.management_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES public.management_pipeline_stages(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_automated boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.management_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_visible_management_stage_history"
ON public.management_stage_history
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1
    FROM public.management_records m
    WHERE m.id = management_stage_history.management_record_id
  )
);

CREATE INDEX IF NOT EXISTS idx_management_stage_history_record_time
  ON public.management_stage_history (management_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.opportunity_creation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pipeline text NOT NULL CHECK (pipeline IN ('acquisition', 'disposition')),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL,
  acquisition_record_id uuid REFERENCES public.acquisition_records(id) ON DELETE RESTRICT,
  disposition_record_id uuid REFERENCES public.disposition_records(id) ON DELETE RESTRICT,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, request_id)
);

ALTER TABLE public.opportunity_creation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_opportunity_creation_requests"
ON public.opportunity_creation_requests
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    actor_id = (SELECT auth.uid())
    OR public.has_permission('view_all_acquisition_leads')
    OR public.has_permission('view_all_disposition_deals')
  )
);

GRANT SELECT ON public.pipeline_move_requests TO authenticated;
GRANT SELECT ON public.disposition_stage_history TO authenticated;
GRANT SELECT ON public.management_stage_history TO authenticated;
GRANT SELECT ON public.opportunity_creation_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.create_acquisition_opportunity(
  p_stage_id uuid,
  p_contact jsonb,
  p_property jsonb,
  p_acquisition jsonb,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid := public.get_current_company_id();
  v_existing_result jsonb;
  v_contact public.contacts%ROWTYPE;
  v_property public.properties%ROWTYPE;
  v_opportunity public.opportunities%ROWTYPE;
  v_acquisition public.acquisition_records%ROWTYPE;
  v_result jsonb;
  v_created_at timestamptz := COALESCE(NULLIF(p_acquisition ->> 'created_at', '')::timestamptz, clock_timestamp());
  v_seller_type_id uuid;
  v_stage_key text;
  v_assigned_user_id uuid;
  v_opportunity_status text;
  v_disposition_stage_id uuid;
  v_disposition_id uuid;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NOT public.has_permission('edit_acquisitions') THEN
    RAISE EXCEPTION 'You do not have permission to create acquisition opportunities';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT result INTO v_existing_result
  FROM public.opportunity_creation_requests
  WHERE company_id = v_company_id AND request_id = p_request_id;
  IF FOUND THEN
    RETURN v_existing_result;
  END IF;

  SELECT stage_key INTO v_stage_key
  FROM public.acquisition_pipeline_stages
  WHERE id = p_stage_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected acquisition stage is invalid';
  END IF;

  v_assigned_user_id := CASE WHEN v_stage_key = 'new_lead' THEN NULL ELSE v_actor_id END;
  v_opportunity_status := CASE v_stage_key
    WHEN 'new_lead' THEN 'new'
    WHEN 'needs_offer' THEN 'qualified'
    WHEN 'ready_for_proposal' THEN 'qualified'
    WHEN 'offer_accepted' THEN 'offer_made'
    WHEN 'offer_declined' THEN 'offer_made'
    WHEN 'needs_contract' THEN 'offer_made'
    WHEN 'contract_executed' THEN 'under_contract'
    WHEN 'dead' THEN 'lost'
    ELSE 'contacted'
  END;

  INSERT INTO public.contacts (
    company_id, first_name, last_name, primary_phone, primary_phone_normalized,
    primary_email, primary_email_normalized, lead_source, lead_generated_at
  ) VALUES (
    v_company_id,
    NULLIF(btrim(p_contact ->> 'first_name'), ''),
    NULLIF(btrim(p_contact ->> 'last_name'), ''),
    NULLIF(btrim(p_contact ->> 'phone'), ''),
    CASE
      WHEN length(regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g')) = 10
        THEN '1' || regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g')
      ELSE NULLIF(regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g'), '')
    END,
    NULLIF(btrim(p_contact ->> 'email'), ''),
    NULLIF(lower(btrim(p_contact ->> 'email')), ''),
    NULLIF(btrim(p_acquisition ->> 'lead_source'), ''),
    v_created_at
  ) RETURNING * INTO v_contact;

  SELECT id INTO v_seller_type_id
  FROM public.contact_types
  WHERE company_id = v_company_id AND lower(name) = 'seller'
  ORDER BY is_default DESC, created_at
  LIMIT 1;
  IF v_seller_type_id IS NOT NULL THEN
    INSERT INTO public.contact_contact_types (contact_id, contact_type_id)
    VALUES (v_contact.id, v_seller_type_id)
    ON CONFLICT (contact_id, contact_type_id) DO NOTHING;
  END IF;

  INSERT INTO public.properties (
    company_id, street_address, property_type, property_condition,
    occupancy_status, asking_price, estimated_value, is_listed, has_agent
  ) VALUES (
    v_company_id,
    COALESCE(NULLIF(btrim(p_property ->> 'street_address'), ''), ''),
    NULLIF(btrim(p_property ->> 'property_type'), ''),
    NULLIF(btrim(p_property ->> 'property_condition'), ''),
    NULLIF(btrim(p_property ->> 'occupancy_status'), ''),
    NULLIF(p_property ->> 'asking_price', '')::numeric,
    NULLIF(p_property ->> 'estimated_value', '')::numeric,
    NULLIF(p_property ->> 'is_listed', '')::boolean,
    NULLIF(p_property ->> 'has_agent', '')::boolean
  ) RETURNING * INTO v_property;

  INSERT INTO public.opportunities (
    company_id, primary_seller_contact_id, property_id, lead_source,
    assigned_acquisition_user_id, priority, status, contract_date, created_at, updated_at
  ) VALUES (
    v_company_id, v_contact.id, v_property.id,
    NULLIF(btrim(p_acquisition ->> 'lead_source'), ''),
    v_assigned_user_id, COALESCE(NULLIF(p_acquisition ->> 'priority', ''), 'medium'),
    v_opportunity_status,
    CASE WHEN v_stage_key = 'contract_executed' THEN v_created_at::date ELSE NULL END,
    v_created_at, v_created_at
  ) RETURNING * INTO v_opportunity;

  INSERT INTO public.acquisition_records (
    company_id, opportunity_id, contact_id, property_id, pipeline_stage_id,
    lead_source, motivation, priority, asking_price, assigned_user_id,
    stage_entered_at, contract_executed_at, contract_executed_by,
    metadata, created_at, updated_at
  ) VALUES (
    v_company_id, v_opportunity.id, v_contact.id, v_property.id, p_stage_id,
    NULLIF(btrim(p_acquisition ->> 'lead_source'), ''),
    NULLIF(btrim(p_acquisition ->> 'motivation'), ''),
    COALESCE(NULLIF(p_acquisition ->> 'priority', ''), 'medium'),
    NULLIF(p_property ->> 'asking_price', '')::numeric,
    v_assigned_user_id, v_created_at,
    CASE WHEN v_stage_key = 'contract_executed' THEN v_created_at ELSE NULL END,
    CASE WHEN v_stage_key = 'contract_executed' THEN v_actor_id ELSE NULL END,
    COALESCE(p_acquisition -> 'metadata', '{}'::jsonb),
    v_created_at, v_created_at
  ) RETURNING * INTO v_acquisition;

  INSERT INTO public.acquisition_stage_history (
    company_id, acquisition_record_id, from_stage_id, to_stage_id,
    changed_by, is_automated, reason, created_at
  ) VALUES (
    v_company_id, v_acquisition.id, NULL, p_stage_id,
    v_actor_id, false, 'record_created', v_created_at
  );

  INSERT INTO public.activity_events (
    company_id, entity_type, entity_id, event_type, actor_id, metadata, created_at
  ) VALUES (
    v_company_id, 'acquisition_record', v_acquisition.id,
    'acquisition_record_created', v_actor_id,
    jsonb_build_object('source_channel', p_acquisition ->> 'lead_source'),
    v_created_at
  );

  IF v_stage_key = 'contract_executed' THEN
    SELECT id INTO v_disposition_stage_id
    FROM public.disposition_pipeline_stages
    WHERE company_id = v_company_id AND stage_key = 'new_lead'
    ORDER BY position
    LIMIT 1;
    IF v_disposition_stage_id IS NULL THEN
      RAISE EXCEPTION 'Dispositions / New Lead is not configured';
    END IF;

    INSERT INTO public.disposition_records (
      company_id, opportunity_id, acquisition_record_id, property_id, contact_id,
      assigned_user_id, pipeline_stage_id, status, contract_price,
      stage_entered_at, created_at, updated_at
    ) VALUES (
      v_company_id, v_opportunity.id, v_acquisition.id, v_property.id, v_contact.id,
      NULL, v_disposition_stage_id, 'active', v_acquisition.offer_amount,
      v_created_at, v_created_at, v_created_at
    ) RETURNING id INTO v_disposition_id;
  END IF;

  v_result := jsonb_build_object(
    'contact', to_jsonb(v_contact),
    'property', to_jsonb(v_property),
    'opportunity', to_jsonb(v_opportunity),
    'record', to_jsonb(v_acquisition),
    'pipeline', 'acquisition',
    'disposition_record_id', v_disposition_id
  );

  INSERT INTO public.opportunity_creation_requests (
    company_id, request_id, actor_id, pipeline, opportunity_id, record_id,
    acquisition_record_id, result, completed_at
  ) VALUES (
    v_company_id, p_request_id, v_actor_id, 'acquisition', v_opportunity.id,
    v_acquisition.id, v_acquisition.id, v_result, clock_timestamp()
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_acquisition_opportunity(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_acquisition_opportunity(uuid, jsonb, jsonb, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_acquisition_opportunity(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_pipeline_opportunity(
  p_pipeline text,
  p_stage_id uuid,
  p_contact jsonb,
  p_property jsonb,
  p_details jsonb,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid := public.get_current_company_id();
  v_existing_result jsonb;
  v_contact public.contacts%ROWTYPE;
  v_property public.properties%ROWTYPE;
  v_opportunity public.opportunities%ROWTYPE;
  v_disposition public.disposition_records%ROWTYPE;
  v_result jsonb;
  v_created_at timestamptz := COALESCE(NULLIF(p_details ->> 'created_at', '')::timestamptz, clock_timestamp());
  v_seller_type_id uuid;
  v_stage_key text;
  v_is_terminal boolean;
  v_assigned_user_id uuid;
  v_record_status text;
  v_opportunity_status text;
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_pipeline NOT IN ('acquisition', 'disposition') THEN
    RAISE EXCEPTION 'Choose either the acquisition or disposition pipeline';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required';
  END IF;

  IF p_pipeline = 'acquisition' THEN
    RETURN public.create_acquisition_opportunity(
      p_stage_id, p_contact, p_property, p_details, p_request_id
    );
  END IF;

  IF NOT public.has_permission('edit_dispositions') THEN
    RAISE EXCEPTION 'You do not have permission to create disposition opportunities';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT result INTO v_existing_result
  FROM public.opportunity_creation_requests
  WHERE company_id = v_company_id AND request_id = p_request_id;
  IF FOUND THEN
    RETURN v_existing_result;
  END IF;

  SELECT stage_key, is_terminal INTO v_stage_key, v_is_terminal
  FROM public.disposition_pipeline_stages
  WHERE id = p_stage_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected disposition stage is invalid';
  END IF;

  v_assigned_user_id := CASE WHEN v_stage_key = 'new_lead' THEN NULL ELSE v_actor_id END;
  v_record_status := CASE
    WHEN v_stage_key = 'dead' THEN 'dead'
    WHEN v_stage_key = 'funded_closed' OR v_is_terminal THEN 'closed'
    ELSE 'active'
  END;
  v_opportunity_status := CASE
    WHEN v_stage_key = 'dead' THEN 'lost'
    WHEN v_stage_key = 'funded_closed' OR v_is_terminal THEN 'closed'
    ELSE 'under_contract'
  END;

  INSERT INTO public.contacts (
    company_id, first_name, last_name, primary_phone, primary_phone_normalized,
    primary_email, primary_email_normalized, lead_source, lead_generated_at
  ) VALUES (
    v_company_id,
    NULLIF(btrim(p_contact ->> 'first_name'), ''),
    NULLIF(btrim(p_contact ->> 'last_name'), ''),
    NULLIF(btrim(p_contact ->> 'phone'), ''),
    CASE
      WHEN length(regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g')) = 10
        THEN '1' || regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g')
      ELSE NULLIF(regexp_replace(COALESCE(p_contact ->> 'phone', ''), '[^0-9]', '', 'g'), '')
    END,
    NULLIF(btrim(p_contact ->> 'email'), ''),
    NULLIF(lower(btrim(p_contact ->> 'email')), ''),
    NULLIF(btrim(p_details ->> 'lead_source'), ''),
    v_created_at
  ) RETURNING * INTO v_contact;

  SELECT id INTO v_seller_type_id
  FROM public.contact_types
  WHERE company_id = v_company_id AND lower(name) = 'seller'
  ORDER BY is_default DESC, created_at
  LIMIT 1;
  IF v_seller_type_id IS NOT NULL THEN
    INSERT INTO public.contact_contact_types (contact_id, contact_type_id)
    VALUES (v_contact.id, v_seller_type_id)
    ON CONFLICT (contact_id, contact_type_id) DO NOTHING;
  END IF;

  INSERT INTO public.properties (
    company_id, street_address, property_type, property_condition,
    occupancy_status, asking_price, estimated_value, is_listed, has_agent
  ) VALUES (
    v_company_id,
    COALESCE(NULLIF(btrim(p_property ->> 'street_address'), ''), ''),
    NULLIF(btrim(p_property ->> 'property_type'), ''),
    NULLIF(btrim(p_property ->> 'property_condition'), ''),
    NULLIF(btrim(p_property ->> 'occupancy_status'), ''),
    NULLIF(p_property ->> 'asking_price', '')::numeric,
    NULLIF(p_property ->> 'estimated_value', '')::numeric,
    NULLIF(p_property ->> 'is_listed', '')::boolean,
    NULLIF(p_property ->> 'has_agent', '')::boolean
  ) RETURNING * INTO v_property;

  INSERT INTO public.opportunities (
    company_id, primary_seller_contact_id, property_id, lead_source,
    assigned_acquisition_user_id, priority, status, created_at, updated_at
  ) VALUES (
    v_company_id, v_contact.id, v_property.id,
    NULLIF(btrim(p_details ->> 'lead_source'), ''),
    NULL, COALESCE(NULLIF(p_details ->> 'priority', ''), 'medium'),
    v_opportunity_status, v_created_at, v_created_at
  ) RETURNING * INTO v_opportunity;

  INSERT INTO public.disposition_records (
    company_id, opportunity_id, acquisition_record_id, property_id, contact_id,
    assigned_user_id, pipeline_stage_id, status, stage_entered_at, created_at, updated_at
  ) VALUES (
    v_company_id, v_opportunity.id, NULL, v_property.id, v_contact.id,
    v_assigned_user_id, p_stage_id, v_record_status, v_created_at, v_created_at, v_created_at
  ) RETURNING * INTO v_disposition;

  INSERT INTO public.disposition_stage_history (
    company_id, disposition_record_id, from_stage_id, to_stage_id,
    changed_by, is_automated, reason, created_at
  ) VALUES (
    v_company_id, v_disposition.id, NULL, p_stage_id,
    v_actor_id, false, 'record_created', v_created_at
  );

  INSERT INTO public.activity_events (
    company_id, entity_type, entity_id, event_type, actor_id, metadata, created_at
  ) VALUES (
    v_company_id, 'disposition_record', v_disposition.id,
    'disposition_record_created', v_actor_id,
    jsonb_build_object('source_channel', p_details ->> 'lead_source'),
    v_created_at
  );

  v_result := jsonb_build_object(
    'contact', to_jsonb(v_contact),
    'property', to_jsonb(v_property),
    'opportunity', to_jsonb(v_opportunity),
    'record', to_jsonb(v_disposition),
    'pipeline', 'disposition'
  );

  INSERT INTO public.opportunity_creation_requests (
    company_id, request_id, actor_id, pipeline, opportunity_id, record_id,
    disposition_record_id, result, completed_at
  ) VALUES (
    v_company_id, p_request_id, v_actor_id, 'disposition', v_opportunity.id,
    v_disposition.id, v_disposition.id, v_result, clock_timestamp()
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pipeline_opportunity(text, uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pipeline_opportunity(text, uuid, jsonb, jsonb, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_pipeline_opportunity(text, uuid, jsonb, jsonb, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_pipeline_stage(
  p_pipeline text,
  p_record_id uuid,
  p_expected_stage_id uuid,
  p_to_stage_id uuid,
  p_note text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_company_id uuid := public.get_current_company_id();
  v_note text := btrim(COALESCE(p_note, ''));
  v_existing_result jsonb;
  v_result jsonb;
  v_acquisition public.acquisition_records%ROWTYPE;
  v_disposition public.disposition_records%ROWTYPE;
  v_management public.management_records%ROWTYPE;
  v_destination_name text;
  v_destination_key text;
  v_destination_terminal boolean := false;
  v_new_owner uuid;
  v_previous_owner uuid;
  v_can_manage boolean;
  v_disposition_stage_id uuid;
  v_disposition_id uuid;
  v_existing_disposition_status text;
  v_opportunity_status text;
  v_mapping record;
  v_current_stage_name text;
  v_current_stage_key text;
  v_dead_stage_id uuid;
  v_linked_disposition record;
  v_sync_reason text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required';
  END IF;
  IF length(v_note) > 4000 THEN
    RAISE EXCEPTION 'The stage-move note is too long';
  END IF;
  IF p_pipeline NOT IN ('acquisition', 'disposition', 'management') THEN
    RAISE EXCEPTION 'Unsupported pipeline';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT result INTO v_existing_result
  FROM public.pipeline_move_requests
  WHERE company_id = v_company_id AND request_id = p_request_id;
  IF FOUND THEN
    RETURN v_existing_result;
  END IF;

  IF p_pipeline = 'acquisition' THEN
    IF NOT public.has_permission('edit_acquisitions') THEN
      RAISE EXCEPTION 'You do not have permission to move acquisition leads';
    END IF;

    SELECT * INTO v_acquisition
    FROM public.acquisition_records
    WHERE id = p_record_id
      AND company_id = v_company_id
      AND archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Acquisition lead was not found';
    END IF;
    IF v_acquisition.pipeline_stage_id IS DISTINCT FROM p_expected_stage_id THEN
      RAISE EXCEPTION 'This lead changed before the move was saved';
    END IF;

    v_can_manage := public.has_permission('view_all_acquisition_leads');
    SELECT name, stage_key INTO v_current_stage_name, v_current_stage_key
    FROM public.acquisition_pipeline_stages
    WHERE id = v_acquisition.pipeline_stage_id AND company_id = v_company_id;
    IF v_acquisition.assigned_user_id IS NOT NULL
       AND v_acquisition.assigned_user_id <> v_actor_id
       AND NOT v_can_manage THEN
      RAISE EXCEPTION 'Only the assigned user or an authorized manager can move this lead';
    END IF;
    IF v_acquisition.assigned_user_id IS NULL
       AND v_current_stage_key IS DISTINCT FROM 'new_lead'
       AND NOT v_can_manage THEN
      RAISE EXCEPTION 'Only unassigned New Leads can be claimed without manager access';
    END IF;

    SELECT name, stage_key INTO v_destination_name, v_destination_key
    FROM public.acquisition_pipeline_stages
    WHERE id = p_to_stage_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The destination acquisition stage is invalid';
    END IF;
    v_note := COALESCE(NULLIF(v_note, ''), format('Moved from %s to %s', COALESCE(v_current_stage_name, 'Unassigned'), v_destination_name));

    v_previous_owner := v_acquisition.assigned_user_id;
    v_new_owner := v_previous_owner;
    IF v_new_owner IS NULL AND v_destination_key IS DISTINCT FROM 'new_lead' THEN
      v_new_owner := v_actor_id;
    END IF;

    v_opportunity_status := CASE v_destination_key
      WHEN 'contract_executed' THEN 'under_contract'
      WHEN 'dead' THEN 'lost'
      WHEN 'offer_accepted' THEN 'offer_made'
      WHEN 'offer_declined' THEN 'offer_made'
      WHEN 'needs_contract' THEN 'offer_made'
      WHEN 'needs_offer' THEN 'qualified'
      WHEN 'ready_for_proposal' THEN 'qualified'
      WHEN 'new_lead' THEN 'new'
      ELSE 'contacted'
    END;

    UPDATE public.acquisition_records
    SET pipeline_stage_id = p_to_stage_id,
        assigned_user_id = v_new_owner,
        stage_entered_at = v_now,
        contract_executed_at = CASE
          WHEN v_destination_key = 'contract_executed' THEN COALESCE(contract_executed_at, v_now)
          ELSE contract_executed_at
        END,
        contract_executed_by = CASE
          WHEN v_destination_key = 'contract_executed' THEN COALESCE(contract_executed_by, v_new_owner, v_actor_id)
          ELSE contract_executed_by
        END,
        attribution_snapshot = CASE
          WHEN v_destination_key = 'contract_executed'
               AND attribution_snapshot = '{}'::jsonb THEN
            jsonb_build_object(
              'assigned_user_id', v_new_owner,
              'executed_by', COALESCE(v_new_owner, v_actor_id),
              'lead_source', v_acquisition.lead_source,
              'opportunity_id', v_acquisition.opportunity_id,
              'contact_id', v_acquisition.contact_id,
              'property_id', v_acquisition.property_id,
              'locked_at', v_now
            )
          ELSE attribution_snapshot
        END,
        updated_at = v_now
    WHERE id = v_acquisition.id
    RETURNING * INTO v_acquisition;

    IF v_acquisition.opportunity_id IS NULL THEN
      RAISE EXCEPTION 'This lead must be linked to an opportunity before it can move';
    END IF;

    UPDATE public.opportunities
    SET assigned_acquisition_user_id = v_new_owner,
        status = v_opportunity_status,
        contract_date = CASE
          WHEN v_destination_key = 'contract_executed' THEN COALESCE(contract_date, v_now::date)
          ELSE contract_date
        END,
        updated_at = v_now
    WHERE id = v_acquisition.opportunity_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The linked opportunity was not found';
    END IF;

    INSERT INTO public.acquisition_stage_history (
      company_id, acquisition_record_id, from_stage_id, to_stage_id,
      changed_by, is_automated, reason
    ) VALUES (
      v_company_id, v_acquisition.id, p_expected_stage_id, p_to_stage_id,
      v_actor_id, false, v_note
    );

    IF v_new_owner IS DISTINCT FROM v_previous_owner THEN
      INSERT INTO public.acquisition_assignment_history (
        company_id, acquisition_record_id, from_user_id, to_user_id, changed_by, reason
      ) VALUES (
        v_company_id, v_acquisition.id, v_previous_owner, v_new_owner,
        v_actor_id, 'claimed_during_stage_move'
      );
    END IF;

    INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body)
    VALUES (v_company_id, 'acquisition_record', v_acquisition.id, v_actor_id, v_note);

    INSERT INTO public.activity_events (
      company_id, entity_type, entity_id, event_type, actor_id, metadata
    ) VALUES (
      v_company_id, 'acquisition_record', v_acquisition.id,
      'acquisition_stage_changed', v_actor_id,
      jsonb_build_object(
        'from_stage_id', p_expected_stage_id,
        'to_stage_id', p_to_stage_id,
        'to_stage_name', v_destination_name,
        'note', v_note,
        'is_automated', false
      )
    );

    IF v_destination_key = 'dead' THEN
      SELECT id INTO v_dead_stage_id
      FROM public.disposition_pipeline_stages
      WHERE company_id = v_company_id AND stage_key = 'dead'
      LIMIT 1;
      IF v_dead_stage_id IS NULL AND EXISTS (
        SELECT 1 FROM public.disposition_records
        WHERE company_id = v_company_id
          AND opportunity_id = v_acquisition.opportunity_id
          AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'Dispositions / Dead is not configured';
      END IF;

      v_sync_reason := format('Synced from Acquisitions: %s', v_note);
      FOR v_linked_disposition IN
        SELECT id, pipeline_stage_id
        FROM public.disposition_records
        WHERE company_id = v_company_id
          AND opportunity_id = v_acquisition.opportunity_id
          AND status = 'active'
          AND pipeline_stage_id IS DISTINCT FROM v_dead_stage_id
        FOR UPDATE
      LOOP
        UPDATE public.disposition_records
        SET pipeline_stage_id = v_dead_stage_id,
            status = 'dead',
            stage_entered_at = v_now,
            updated_at = v_now
        WHERE id = v_linked_disposition.id;

        INSERT INTO public.disposition_stage_history (
          company_id, disposition_record_id, from_stage_id, to_stage_id,
          changed_by, is_automated, reason
        ) VALUES (
          v_company_id, v_linked_disposition.id, v_linked_disposition.pipeline_stage_id,
          v_dead_stage_id, v_actor_id, true, v_sync_reason
        );

        INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body)
        VALUES (v_company_id, 'disposition_record', v_linked_disposition.id, v_actor_id, v_sync_reason);

        INSERT INTO public.activity_events (
          company_id, entity_type, entity_id, event_type, actor_id, metadata
        ) VALUES (
          v_company_id, 'disposition_record', v_linked_disposition.id,
          'stage_changed', v_actor_id,
          jsonb_build_object(
            'from_stage_id', v_linked_disposition.pipeline_stage_id,
            'to_stage_id', v_dead_stage_id,
            'note', v_sync_reason,
            'is_automated', true,
            'source_acquisition_record_id', v_acquisition.id
          )
        );
      END LOOP;
    END IF;

    IF v_destination_key = 'contract_executed' THEN
      IF v_acquisition.contact_id IS NULL OR v_acquisition.property_id IS NULL THEN
        RAISE EXCEPTION 'Contract handoff requires a linked contact and property';
      END IF;

      SELECT id INTO v_disposition_stage_id
      FROM public.disposition_pipeline_stages
      WHERE company_id = v_company_id AND stage_key = 'new_lead'
      ORDER BY position
      LIMIT 1;
      IF v_disposition_stage_id IS NULL THEN
        RAISE EXCEPTION 'Dispositions / New Lead is not configured';
      END IF;

      SELECT id, status INTO v_disposition_id, v_existing_disposition_status
      FROM public.disposition_records
      WHERE opportunity_id = v_acquisition.opportunity_id
        AND company_id = v_company_id
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_disposition_id IS NULL THEN
        INSERT INTO public.disposition_records (
          company_id, opportunity_id, acquisition_record_id, property_id, contact_id,
          assigned_user_id, pipeline_stage_id, status, contract_price,
          stage_entered_at, created_at, updated_at
        ) VALUES (
          v_company_id, v_acquisition.opportunity_id, v_acquisition.id,
          v_acquisition.property_id, v_acquisition.contact_id, NULL,
          v_disposition_stage_id, 'active', v_acquisition.offer_amount,
          v_now, v_now, v_now
        ) RETURNING id INTO v_disposition_id;
      ELSE
        UPDATE public.disposition_records
        SET acquisition_record_id = v_acquisition.id,
            property_id = v_acquisition.property_id,
            contact_id = v_acquisition.contact_id,
            contract_price = COALESCE(contract_price, v_acquisition.offer_amount),
            updated_at = v_now
        WHERE id = v_disposition_id;

        IF v_existing_disposition_status <> 'active' THEN
          RAISE EXCEPTION 'This opportunity already has a closed disposition record and needs manager review before another handoff';
        END IF;
      END IF;
    END IF;

    v_result := jsonb_build_object(
      'pipeline', 'acquisition',
      'record', to_jsonb(v_acquisition),
      'disposition_record_id', v_disposition_id
    );
  ELSIF p_pipeline = 'disposition' THEN
    IF NOT public.has_permission('edit_dispositions') THEN
      RAISE EXCEPTION 'You do not have permission to move disposition deals';
    END IF;

    SELECT * INTO v_disposition
    FROM public.disposition_records
    WHERE id = p_record_id AND company_id = v_company_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Disposition deal was not found';
    END IF;
    IF v_disposition.pipeline_stage_id IS DISTINCT FROM p_expected_stage_id THEN
      RAISE EXCEPTION 'This deal changed before the move was saved';
    END IF;

    v_can_manage := public.has_permission('view_all_disposition_deals');
    SELECT name, stage_key INTO v_current_stage_name, v_current_stage_key
    FROM public.disposition_pipeline_stages
    WHERE id = v_disposition.pipeline_stage_id AND company_id = v_company_id;
    IF v_disposition.assigned_user_id IS NOT NULL
       AND v_disposition.assigned_user_id <> v_actor_id
       AND NOT v_can_manage THEN
      RAISE EXCEPTION 'Only the assigned user or an authorized manager can move this deal';
    END IF;
    IF v_disposition.assigned_user_id IS NULL
       AND v_current_stage_key IS DISTINCT FROM 'new_lead'
       AND NOT v_can_manage THEN
      RAISE EXCEPTION 'Only unassigned New Leads can be claimed without manager access';
    END IF;

    SELECT name, is_terminal, stage_key INTO v_destination_name, v_destination_terminal, v_destination_key
    FROM public.disposition_pipeline_stages
    WHERE id = p_to_stage_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The destination disposition stage is invalid';
    END IF;
    v_note := COALESCE(NULLIF(v_note, ''), format('Moved from %s to %s', COALESCE(v_current_stage_name, 'Unassigned'), v_destination_name));

    v_previous_owner := v_disposition.assigned_user_id;
    v_new_owner := v_previous_owner;
    IF v_new_owner IS NULL AND v_destination_key IS DISTINCT FROM 'new_lead' THEN
      v_new_owner := v_actor_id;
    END IF;

    UPDATE public.disposition_records
    SET pipeline_stage_id = p_to_stage_id,
        assigned_user_id = v_new_owner,
        stage_entered_at = v_now,
        status = CASE
          WHEN v_destination_key = 'dead' THEN 'dead'
          WHEN v_destination_terminal THEN 'closed'
          ELSE 'active'
        END,
        updated_at = v_now
    WHERE id = v_disposition.id
    RETURNING * INTO v_disposition;

    UPDATE public.opportunities
    SET assigned_disposition_user_id = v_new_owner,
        status = CASE
          WHEN v_disposition.status = 'dead' THEN 'lost'
          WHEN v_disposition.status = 'closed' THEN 'closed'
          ELSE status
        END,
        updated_at = v_now
    WHERE id = v_disposition.opportunity_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The linked opportunity was not found';
    END IF;

    INSERT INTO public.disposition_stage_history (
      company_id, disposition_record_id, from_stage_id, to_stage_id,
      changed_by, is_automated, reason
    ) VALUES (
      v_company_id, v_disposition.id, p_expected_stage_id, p_to_stage_id,
      v_actor_id, false, v_note
    );

    INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body)
    VALUES (v_company_id, 'disposition_record', v_disposition.id, v_actor_id, v_note);

    INSERT INTO public.activity_events (
      company_id, entity_type, entity_id, event_type, actor_id, metadata
    ) VALUES (
      v_company_id, 'disposition_record', v_disposition.id, 'stage_changed', v_actor_id,
      jsonb_build_object(
        'from_stage_id', p_expected_stage_id,
        'to_stage_id', p_to_stage_id,
        'to_stage_name', v_destination_name,
        'note', v_note,
        'is_automated', false
      )
    );

    IF v_destination_key = 'dead' THEN
      SELECT id INTO v_dead_stage_id
      FROM public.acquisition_pipeline_stages
      WHERE company_id = v_company_id AND stage_key = 'dead'
      LIMIT 1;

      SELECT * INTO v_acquisition
      FROM public.acquisition_records
      WHERE company_id = v_company_id
        AND archived_at IS NULL
        AND (
          id = v_disposition.acquisition_record_id
          OR opportunity_id = v_disposition.opportunity_id
        )
      ORDER BY CASE WHEN id = v_disposition.acquisition_record_id THEN 0 ELSE 1 END, created_at
      LIMIT 1
      FOR UPDATE;

      IF FOUND AND v_dead_stage_id IS NULL THEN
        RAISE EXCEPTION 'Acquisitions / Dead/DNC is not configured';
      END IF;
      IF FOUND AND v_acquisition.pipeline_stage_id IS DISTINCT FROM v_dead_stage_id THEN
        v_sync_reason := format('Synced from Dispositions: %s', v_note);
        UPDATE public.acquisition_records
        SET pipeline_stage_id = v_dead_stage_id,
            stage_entered_at = v_now,
            updated_at = v_now
        WHERE id = v_acquisition.id;

        INSERT INTO public.acquisition_stage_history (
          company_id, acquisition_record_id, from_stage_id, to_stage_id,
          changed_by, is_automated, reason
        ) VALUES (
          v_company_id, v_acquisition.id, v_acquisition.pipeline_stage_id,
          v_dead_stage_id, v_actor_id, true, v_sync_reason
        );

        INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body)
        VALUES (v_company_id, 'acquisition_record', v_acquisition.id, v_actor_id, v_sync_reason);

        INSERT INTO public.activity_events (
          company_id, entity_type, entity_id, event_type, actor_id, metadata
        ) VALUES (
          v_company_id, 'acquisition_record', v_acquisition.id,
          'acquisition_stage_changed', v_actor_id,
          jsonb_build_object(
            'from_stage_id', v_acquisition.pipeline_stage_id,
            'to_stage_id', v_dead_stage_id,
            'note', v_sync_reason,
            'is_automated', true,
            'source_disposition_record_id', v_disposition.id
          )
        );
      END IF;
    END IF;

    FOR v_mapping IN
      SELECT target_pipeline, target_stage_id, actions
      FROM public.pipeline_stage_mappings
      WHERE company_id = v_company_id
        AND source_pipeline = 'disposition'
        AND source_stage_id = p_to_stage_id
        AND is_active = true
    LOOP
      IF v_mapping.target_pipeline = 'management'
         AND v_mapping.actions ? 'update_stage' THEN
        UPDATE public.management_records
        SET pipeline_stage_id = v_mapping.target_stage_id,
            disposition_stage_snapshot = v_destination_name,
            stage_entered_at = v_now,
            updated_at = v_now
        WHERE opportunity_id = v_disposition.opportunity_id
          AND company_id = v_company_id;

        IF FOUND THEN
          INSERT INTO public.activity_events (
            company_id, entity_type, entity_id, event_type, actor_id, metadata
          )
          SELECT v_company_id, 'management_record', m.id, 'stage_changed', v_actor_id,
            jsonb_build_object(
              'reason', 'disposition_pipeline_sync',
              'source_disposition_record_id', v_disposition.id,
              'source_stage_id', p_to_stage_id,
              'to_stage_id', v_mapping.target_stage_id,
              'is_automated', true
            )
          FROM public.management_records m
          WHERE m.opportunity_id = v_disposition.opportunity_id
            AND m.company_id = v_company_id;
        END IF;
      END IF;
    END LOOP;

    v_result := jsonb_build_object(
      'pipeline', 'disposition',
      'record', to_jsonb(v_disposition)
    );
  ELSE
    IF NOT public.has_permission('edit_management') THEN
      RAISE EXCEPTION 'You do not have permission to move management records';
    END IF;

    SELECT * INTO v_management
    FROM public.management_records
    WHERE id = p_record_id
      AND company_id = v_company_id
      AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Management record was not found';
    END IF;
    IF v_management.pipeline_stage_id IS DISTINCT FROM p_expected_stage_id THEN
      RAISE EXCEPTION 'This management record changed before the move was saved';
    END IF;

    SELECT name INTO v_destination_name
    FROM public.management_pipeline_stages
    WHERE id = p_to_stage_id AND company_id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The destination management stage is invalid';
    END IF;
    SELECT name INTO v_current_stage_name
    FROM public.management_pipeline_stages
    WHERE id = v_management.pipeline_stage_id AND company_id = v_company_id;
    v_note := COALESCE(NULLIF(v_note, ''), format('Moved from %s to %s', COALESCE(v_current_stage_name, 'Unassigned'), v_destination_name));

    UPDATE public.management_records
    SET pipeline_stage_id = p_to_stage_id,
        stage_entered_at = v_now,
        updated_at = v_now
    WHERE id = v_management.id
    RETURNING * INTO v_management;

    INSERT INTO public.management_stage_history (
      company_id, management_record_id, from_stage_id, to_stage_id,
      changed_by, is_automated, reason
    ) VALUES (
      v_company_id, v_management.id, p_expected_stage_id, p_to_stage_id,
      v_actor_id, false, v_note
    );

    INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body)
    VALUES (v_company_id, 'management_record', v_management.id, v_actor_id, v_note);

    INSERT INTO public.activity_events (
      company_id, entity_type, entity_id, event_type, actor_id, metadata
    ) VALUES (
      v_company_id, 'management_record', v_management.id, 'stage_changed', v_actor_id,
      jsonb_build_object(
        'from_stage_id', p_expected_stage_id,
        'to_stage_id', p_to_stage_id,
        'to_stage_name', v_destination_name,
        'note', v_note,
        'is_automated', false
      )
    );

    v_result := jsonb_build_object(
      'pipeline', 'management',
      'record', to_jsonb(v_management)
    );
  END IF;

  INSERT INTO public.pipeline_move_requests (
    company_id, request_id, actor_id, pipeline, record_id,
    from_stage_id, to_stage_id, note, result, completed_at
  ) VALUES (
    v_company_id, p_request_id, v_actor_id, p_pipeline, p_record_id,
    p_expected_stage_id, p_to_stage_id, v_note, v_result, v_now
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.move_pipeline_stage(text, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_pipeline_stage(text, uuid, uuid, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_pipeline_stage(text, uuid, uuid, uuid, text, uuid) TO authenticated;
