-- Local review only. No historical records are deleted or dates invented.
SET lock_timeout = '2s';

CREATE TABLE public.lead_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX lead_groups_name ON public.lead_groups(company_id, lower(btrim(name)));
ALTER TABLE public.lead_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_groups_read ON public.lead_groups FOR SELECT TO authenticated
USING (company_id = (SELECT public.get_current_company_id()) AND (SELECT public.has_permission('view_acquisitions')));
CREATE POLICY lead_groups_create ON public.lead_groups FOR INSERT TO authenticated
WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND created_by = (SELECT auth.uid()) AND (SELECT public.has_permission('edit_acquisitions')));
GRANT SELECT, INSERT ON public.lead_groups TO authenticated;

CREATE TABLE public.acquisition_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  lead_count integer NOT NULL DEFAULT 0 CHECK (lead_count >= 0),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','partial','failed')),
  results jsonb NOT NULL DEFAULT '[]',
  UNIQUE (company_id, id)
);
ALTER TABLE public.acquisition_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY acquisition_batches_read ON public.acquisition_import_batches FOR SELECT TO authenticated
USING (company_id = (SELECT public.get_current_company_id()) AND (uploaded_by = (SELECT auth.uid()) OR (SELECT public.has_permission('view_all_acquisition_leads'))));
CREATE POLICY acquisition_batches_create ON public.acquisition_import_batches FOR INSERT TO authenticated
WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND uploaded_by = (SELECT auth.uid()) AND (SELECT public.has_permission('edit_acquisitions')));
CREATE POLICY acquisition_batches_update ON public.acquisition_import_batches FOR UPDATE TO authenticated
USING (company_id = (SELECT public.get_current_company_id()) AND uploaded_by = (SELECT auth.uid()) AND (SELECT public.has_permission('edit_acquisitions')))
WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND uploaded_by = (SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.acquisition_import_batches TO authenticated;

ALTER TABLE public.acquisition_records
  ADD COLUMN group_id uuid,
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT acquisition_group_company_fk FOREIGN KEY (company_id, group_id) REFERENCES public.lead_groups(company_id, id),
  ADD CONSTRAINT acquisition_batch_company_fk FOREIGN KEY (company_id, import_batch_id) REFERENCES public.acquisition_import_batches(company_id, id);
CREATE INDEX acquisition_group_page ON public.acquisition_records(company_id, group_id, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX acquisition_batch_page ON public.acquisition_records(company_id, import_batch_id, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX acquisition_owner_page ON public.acquisition_records(company_id, assigned_user_id, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX acquisition_source_page ON public.acquisition_records(company_id, lead_source, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX acquisition_tags ON public.acquisition_records USING gin(tags);
CREATE INDEX notification_inbox ON public.notifications(company_id, user_id, is_read, created_at DESC);

-- One execution per opportunity, including archived historical records. This
-- view obeys the caller's row policies and never rewrites historical dates.
CREATE VIEW public.reporting_executed_contracts WITH (security_invoker = true) AS
SELECT DISTINCT ON (company_id, COALESCE(opportunity_id,id)) *
FROM public.acquisition_records
WHERE deleted_at IS NULL AND contract_executed_at IS NOT NULL
ORDER BY company_id, COALESCE(opportunity_id,id), contract_executed_at, id;
GRANT SELECT ON public.reporting_executed_contracts TO authenticated;

-- Existing duplicate notifications are retained as history. Only the earliest
-- receives the unique event key; later rows inherit read state if any copy was read.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.notifications ADD COLUMN event_key text;
WITH events AS (
  SELECT id, row_number() OVER (PARTITION BY company_id,user_id,type,entity_type,entity_id ORDER BY created_at,id) AS n,
    bool_or(is_read) OVER (PARTITION BY company_id,user_id,type,entity_type,entity_id) AS was_read
  FROM public.notifications WHERE type = 'missed_call' AND entity_type = 'call' AND entity_id IS NOT NULL
)
UPDATE public.notifications n SET
  event_key = CASE WHEN e.n = 1 THEN 'missed_call:' || n.entity_id::text ELSE NULL END,
  is_read = n.is_read OR e.n > 1 OR e.was_read,
  read_at = CASE WHEN n.is_read OR e.n > 1 OR e.was_read THEN COALESCE(n.read_at, now()) ELSE n.read_at END
FROM events e WHERE n.id = e.id;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_event_recipient UNIQUE (company_id, user_id, event_key);
ALTER POLICY update_notifications_own ON public.notifications
WITH CHECK (company_id = (SELECT public.get_current_company_id()) AND user_id = (SELECT auth.uid()));

-- All-or-nothing bulk edits. Invoker permissions and row policies apply.
CREATE FUNCTION public.bulk_edit_acquisition_leads(p_ids uuid[], p_action text, p_value text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_count integer; v_expected integer; v_owner uuid;
BEGIN
  IF NOT public.has_permission('edit_acquisitions') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_ids) id;
  IF v_expected < 1 OR v_expected > 100 THEN RAISE EXCEPTION 'Select between 1 and 100 leads'; END IF;
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
  v_identity text;
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

  IF NULLIF(btrim(p_contact->>'first_name'),'') IS NULL AND NULLIF(btrim(p_contact->>'last_name'),'') IS NULL
    AND NULLIF(btrim(p_contact->>'phone'),'') IS NULL AND NULLIF(btrim(p_contact->>'email'),'') IS NULL THEN
    RAISE EXCEPTION 'Provide a seller name, phone number, or email';
  END IF;
  IF p_acquisition ? 'assigned_user_id' THEN
    IF NOT public.has_permission('assign_leads') THEN RAISE EXCEPTION 'Assignment permission required'; END IF;
    v_assigned_user_id := NULLIF(p_acquisition->>'assigned_user_id','')::uuid;
    IF v_assigned_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_assigned_user_id AND company_id = v_company_id AND NOT is_disabled AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid manager'; END IF;
  END IF;
  -- Conservative duplicate identity includes the property; a shared phone alone
  -- must never merge different properties. Missing addresses require review.
  v_identity := lower(btrim(COALESCE(p_property->>'street_address',''))) || '|' || lower(btrim(COALESCE(p_property->>'city',''))) || '|' || lower(btrim(COALESCE(p_property->>'state',''))) || '|' || btrim(COALESCE(p_property->>'zip_code',''));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || v_identity, 0));
  IF NULLIF(btrim(p_property->>'street_address'),'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.acquisition_records a JOIN public.contacts c ON c.id = a.contact_id JOIN public.properties p ON p.id = a.property_id
    WHERE a.company_id = v_company_id AND a.deleted_at IS NULL AND a.archived_at IS NULL
      AND lower(btrim(p.street_address)) || '|' || lower(btrim(COALESCE(p.city,''))) || '|' || lower(btrim(COALESCE(p.state,''))) || '|' || btrim(COALESCE(p.zip_code,'')) = v_identity
      AND ((length(regexp_replace(COALESCE(p_contact->>'phone',''),'[^0-9]','','g')) >= 10 AND
        (CASE WHEN length(regexp_replace(COALESCE(c.primary_phone,''),'[^0-9]','','g'))=10 THEN '1' ELSE '' END || regexp_replace(COALESCE(c.primary_phone,''),'[^0-9]','','g')) =
        (CASE WHEN length(regexp_replace(p_contact->>'phone','[^0-9]','','g'))=10 THEN '1' ELSE '' END || regexp_replace(p_contact->>'phone','[^0-9]','','g')))
        OR (NULLIF(btrim(p_contact->>'email'),'') IS NOT NULL AND lower(btrim(c.primary_email)) = lower(btrim(p_contact->>'email'))))
  ) THEN RAISE EXCEPTION 'Duplicate lead: this seller and property already have an active acquisition'; END IF;
  INSERT INTO public.contacts (
    company_id, first_name, last_name, primary_phone, primary_phone_normalized,
    primary_email, primary_email_normalized, lead_source, lead_generated_at, company_name, mailing_address_1, mailing_address_2, mailing_city, mailing_state, mailing_zip
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
    v_created_at, p_contact->>'company_name', p_contact->>'mailing_address_1', p_contact->>'mailing_address_2', p_contact->>'mailing_city', p_contact->>'mailing_state', p_contact->>'mailing_zip'
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
    occupancy_status, asking_price, estimated_value, is_listed, has_agent, city, state, zip_code, county, bedrooms, bathrooms, square_footage, lot_size, year_built, estimated_repair_cost
  ) VALUES (
    v_company_id,
    COALESCE(NULLIF(btrim(p_property ->> 'street_address'), ''), ''),
    NULLIF(btrim(p_property ->> 'property_type'), ''),
    NULLIF(btrim(p_property ->> 'property_condition'), ''),
    NULLIF(btrim(p_property ->> 'occupancy_status'), ''),
    NULLIF(p_property ->> 'asking_price', '')::numeric,
    NULLIF(p_property ->> 'estimated_value', '')::numeric,
    NULLIF(p_property ->> 'is_listed', '')::boolean,
    NULLIF(p_property ->> 'has_agent', '')::boolean, p_property->>'city', p_property->>'state', p_property->>'zip_code', p_property->>'county', NULLIF(p_property->>'bedrooms','')::integer, NULLIF(p_property->>'bathrooms','')::numeric, NULLIF(p_property->>'square_footage','')::integer, p_property->>'lot_size', NULLIF(p_property->>'year_built','')::integer, NULLIF(p_property->>'estimated_repair_cost','')::numeric
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
    metadata, created_at, updated_at, group_id, import_batch_id, tags, estimated_arv, estimated_repair_cost, offer_amount
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
    v_created_at, v_created_at, NULLIF(p_acquisition->>'group_id','')::uuid, NULLIF(p_acquisition->>'import_batch_id','')::uuid, ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_acquisition->'tags','[]'))), NULLIF(p_property->>'estimated_value','')::numeric, NULLIF(p_property->>'estimated_repair_cost','')::numeric, NULLIF(p_acquisition->>'offer_amount','')::numeric
  ) RETURNING * INTO v_acquisition;

  IF v_acquisition.import_batch_id IS NOT NULL THEN
    UPDATE public.acquisition_import_batches SET lead_count = lead_count + 1
    WHERE id = v_acquisition.import_batch_id AND company_id = v_company_id;
  END IF;

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


-- Attribute contracts to the owner captured when the contract was executed.
-- Existing rows with no captured actor keep their current-owner fallback until reviewed.

CREATE OR REPLACE FUNCTION get_scoreboard_data(p_period text, p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_result json;
  v_has_members boolean;
  v_timezone text;
BEGIN
  SELECT p.timezone INTO v_timezone FROM profiles p JOIN pg_timezone_names tz ON tz.name=p.timezone WHERE p.id=auth.uid();
  PERFORM set_config('TimeZone',COALESCE(v_timezone,'America/New_York'),true);
  v_end := now();

  CASE p_period
    WHEN 'today' THEN
      v_start := date_trunc('day', now());
      v_prev_start := v_start - interval '1 day';
      v_prev_end := v_start;
    WHEN 'week' THEN
      v_start := date_trunc('week', now());
      v_prev_start := v_start - interval '7 days';
      v_prev_end := v_start;
    WHEN 'month' THEN
      v_start := date_trunc('month', now());
      v_prev_start := v_start - interval '1 month';
      v_prev_end := v_start;
    WHEN 'all' THEN
      v_start := '-infinity'::timestamptz;
      v_prev_start := NULL;
      v_prev_end := NULL;
    ELSE
      v_start := date_trunc('week', now());
      v_prev_start := v_start - interval '7 days';
      v_prev_end := v_start;
  END CASE;

  -- Check if company has explicit scoreboard membership
  SELECT EXISTS (
    SELECT 1 FROM scoreboard_members WHERE company_id = p_company_id
  ) INTO v_has_members;

  WITH managers AS (
    -- Use membership table if populated, else fall back to Acquisitions Manager role
    SELECT p.id as user_id, p.full_name, p.avatar_url, p.email
    FROM profiles p
    WHERE p.company_id = p_company_id
      AND p.is_disabled = false
      AND (
        (v_has_members AND EXISTS (
          SELECT 1 FROM scoreboard_members sm
          WHERE sm.user_id = p.id AND sm.company_id = p_company_id AND sm.is_included = true
        ))
        OR
        (NOT v_has_members AND EXISTS (
          SELECT 1 FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = p.id AND r.company_id = p_company_id AND r.name ILIKE 'Acquisitions Manager'
        ))
      )
  ),
  revenue_data AS (
    SELECT
      COALESCE(a.contract_executed_by, a.assigned_user_id) as user_id,
      COALESCE(SUM(CASE WHEN dr.revenue_verification_status = 'verified' AND dr.actual_revenue > 0 THEN dr.actual_revenue ELSE 0 END), 0) as verified_revenue,
      COUNT(*) as closed_deals
    FROM disposition_records dr
    LEFT JOIN acquisition_records a ON a.id = dr.acquisition_record_id AND a.company_id = dr.company_id
    WHERE dr.company_id = p_company_id
      AND dr.status = 'closed'
      AND dr.deleted_at IS NULL
      AND COALESCE(dr.funded_date, dr.closing_date) >= v_start::date
      AND COALESCE(dr.funded_date, dr.closing_date) <= v_end::date
    GROUP BY COALESCE(a.contract_executed_by, a.assigned_user_id)
  ),
  contracts_data AS (
    SELECT
      COALESCE(ar.contract_executed_by, ar.assigned_user_id) as user_id,
      COUNT(*) as signed_contracts
    FROM reporting_executed_contracts ar
    WHERE ar.company_id = p_company_id
      AND ar.contract_executed_at IS NOT NULL
      AND ar.deleted_at IS NULL
      AND ar.contract_executed_at >= v_start
      AND ar.contract_executed_at <= v_end
    GROUP BY COALESCE(ar.contract_executed_by, ar.assigned_user_id)
  ),
  dials_data AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as total_dials
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND c.started_at >= v_start
      AND c.started_at <= v_end
    GROUP BY c.assigned_user_id
  ),
  dials_today AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as dials_today
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND c.started_at >= date_trunc('day', now())
    GROUP BY c.assigned_user_id
  ),
  dials_week AS (
    SELECT assigned_user_id as user_id, count(DISTINCT call_sid) AS dials_week
    FROM calls WHERE company_id = p_company_id AND direction = 'outbound' AND NOT is_simulated
      AND call_sid IS NOT NULL AND started_at >= date_trunc('week',now()) AND started_at <= now()
    GROUP BY assigned_user_id
  ),
  prev_revenue AS (
    SELECT
      COALESCE(a.contract_executed_by, a.assigned_user_id) as user_id,
      COALESCE(SUM(CASE WHEN dr.revenue_verification_status = 'verified' AND dr.actual_revenue > 0 THEN dr.actual_revenue ELSE 0 END), 0) as prev_revenue,
      COUNT(*) as prev_deals
    FROM disposition_records dr
    LEFT JOIN acquisition_records a ON a.id = dr.acquisition_record_id AND a.company_id = dr.company_id
    WHERE dr.company_id = p_company_id
      AND dr.status = 'closed'
      AND dr.deleted_at IS NULL
      AND v_prev_start IS NOT NULL
      AND COALESCE(dr.funded_date, dr.closing_date) >= v_prev_start::date
      AND COALESCE(dr.funded_date, dr.closing_date) < v_prev_end::date
    GROUP BY COALESCE(a.contract_executed_by, a.assigned_user_id)
  ),
  prev_contracts AS (
    SELECT
      COALESCE(ar.contract_executed_by, ar.assigned_user_id) as user_id,
      COUNT(*) as prev_contracts
    FROM reporting_executed_contracts ar
    WHERE ar.company_id = p_company_id
      AND ar.contract_executed_at IS NOT NULL
      AND ar.deleted_at IS NULL
      AND v_prev_start IS NOT NULL
      AND ar.contract_executed_at >= v_prev_start
      AND ar.contract_executed_at < v_prev_end
    GROUP BY COALESCE(ar.contract_executed_by, ar.assigned_user_id)
  ),
  prev_dials AS (
    SELECT
      c.assigned_user_id as user_id,
      COUNT(DISTINCT c.call_sid) as prev_dials
    FROM calls c
    WHERE c.company_id = p_company_id
      AND c.direction = 'outbound'
      AND c.is_simulated = false
      AND c.call_sid IS NOT NULL
      AND v_prev_start IS NOT NULL
      AND c.started_at >= v_prev_start
      AND c.started_at < v_prev_end
    GROUP BY c.assigned_user_id
  ),
  combined AS (
    SELECT
      m.user_id,
      m.full_name,
      m.avatar_url,
      m.email,
      COALESCE(rd.verified_revenue, 0) as verified_revenue,
      COALESCE(rd.closed_deals, 0) as closed_deals,
      COALESCE(cd.signed_contracts, 0) as signed_contracts,
      COALESCE(dd.total_dials, 0) as dials_period,
      COALESCE(dt.dials_today, 0) as dials_today,
      COALESCE(dw.dials_week, 0) as dials_week,
      COALESCE(pr.prev_revenue, 0) as prev_revenue,
      COALESCE(pr.prev_deals, 0) as prev_deals,
      COALESCE(pc.prev_contracts, 0) as prev_contracts,
      COALESCE(pd.prev_dials, 0) as prev_dials,
      -- Has meaningful current activity
      (COALESCE(rd.verified_revenue, 0) > 0 OR COALESCE(rd.closed_deals, 0) > 0
       OR COALESCE(cd.signed_contracts, 0) > 0 OR COALESCE(dd.total_dials, 0) > 0) as has_current_activity,
      -- Has meaningful previous activity
      (COALESCE(pr.prev_revenue, 0) > 0 OR COALESCE(pr.prev_deals, 0) > 0
       OR COALESCE(pc.prev_contracts, 0) > 0 OR COALESCE(pd.prev_dials, 0) > 0) as has_prev_activity
    FROM managers m
    LEFT JOIN revenue_data rd ON rd.user_id = m.user_id
    LEFT JOIN contracts_data cd ON cd.user_id = m.user_id
    LEFT JOIN dials_data dd ON dd.user_id = m.user_id
    LEFT JOIN dials_today dt ON dt.user_id = m.user_id
    LEFT JOIN dials_week dw ON dw.user_id = m.user_id
    LEFT JOIN prev_revenue pr ON pr.user_id = m.user_id
    LEFT JOIN prev_contracts pc ON pc.user_id = m.user_id
    LEFT JOIN prev_dials pd ON pd.user_id = m.user_id
  ),
  ranked AS (
    SELECT
      c.*,
      RANK() OVER (
        ORDER BY c.verified_revenue DESC, c.closed_deals DESC, c.signed_contracts DESC, c.dials_period DESC
      ) as rank
    FROM combined c
  ),
  prev_ranked AS (
    SELECT
      c.user_id,
      c.has_prev_activity,
      RANK() OVER (
        ORDER BY c.prev_revenue DESC, c.prev_deals DESC, c.prev_contracts DESC, c.prev_dials DESC
      ) as prev_rank
    FROM combined c
    WHERE v_prev_start IS NOT NULL
  )
  SELECT json_build_object(
    'managers', COALESCE((
      SELECT json_agg(
        json_build_object(
          'user_id', r.user_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'email', r.email,
          'verified_revenue', r.verified_revenue,
          'closed_deals', r.closed_deals,
          'signed_contracts', r.signed_contracts,
          'dials_period', r.dials_period,
          'dials_today', r.dials_today,
          'dials_week', r.dials_week,
          'rank', r.rank,
          'has_activity', r.has_current_activity,
          'prev_rank', CASE
            WHEN v_prev_start IS NULL THEN NULL
            WHEN NOT r.has_current_activity AND NOT prvr.has_prev_activity THEN NULL
            ELSE prvr.prev_rank
          END
        )
        ORDER BY r.rank ASC
      )
      FROM ranked r
      LEFT JOIN prev_ranked prvr ON prvr.user_id = r.user_id
    ), '[]'::json),
    'unattributed_contracts', (SELECT count(*) FROM acquisition_records WHERE company_id = p_company_id AND deleted_at IS NULL AND contract_executed_at BETWEEN v_start AND v_end AND COALESCE(contract_executed_by, assigned_user_id) IS NULL),
    'undated_contracts', (SELECT count(*) FROM acquisition_records a JOIN acquisition_pipeline_stages s ON s.id = a.pipeline_stage_id WHERE a.company_id = p_company_id AND a.deleted_at IS NULL AND s.stage_key = 'contract_executed' AND a.contract_executed_at IS NULL),
    'excluded_contracts', (SELECT count(*) FROM acquisition_records WHERE company_id=p_company_id AND deleted_at IS NULL AND contract_executed_at BETWEEN v_start AND v_end AND COALESCE(contract_executed_by,assigned_user_id) IS NOT NULL AND COALESCE(contract_executed_by,assigned_user_id) NOT IN (SELECT user_id FROM managers)),
    'timezone', COALESCE(v_timezone,'America/New_York'),
    'period', p_period,
    'period_start', v_start,
    'period_end', v_end,
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_scoreboard_data(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_scoreboard_data(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL, p_user_id uuid DEFAULT NULL,
  p_include_demo boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_start timestamptz := COALESCE(p_start_date, '1970-01-01'::timestamptz);
  v_end timestamptz := COALESCE(p_end_date, now());
  v_total_leads int; v_unassigned_leads int; v_assigned_leads int;
  v_company_revenue numeric(12,2); v_personal_earnings numeric(12,2);
  v_open_deals int; v_contracts_executed int; v_closings int; v_overdue_tasks int;
  v_timezone text;
BEGIN
  SELECT p.timezone INTO v_timezone FROM profiles p JOIN pg_timezone_names tz ON tz.name=p.timezone WHERE p.id=auth.uid();
  PERFORM set_config('TimeZone',COALESCE(v_timezone,'America/New_York'),true);
  SELECT count(*) INTO v_total_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL AND deleted_at IS NULL
    AND created_at >= v_start AND created_at <= v_end
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT count(*) INTO v_unassigned_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL AND deleted_at IS NULL
    AND created_at >= v_start AND created_at <= v_end AND assigned_user_id IS NULL
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT count(*) INTO v_assigned_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL AND deleted_at IS NULL
    AND created_at >= v_start AND created_at <= v_end AND assigned_user_id IS NOT NULL
    AND (p_include_demo OR (COALESCE(motivation,'') NOT ILIKE '%test%' AND COALESCE(motivation,'') NOT ILIKE '%demo%'));
  SELECT COALESCE(SUM(o.actual_revenue), 0) INTO v_company_revenue FROM disposition_records o
  WHERE o.company_id = p_company_id AND o.status = 'closed'
    AND o.deleted_at IS NULL AND o.revenue_verification_status = 'verified' AND o.actual_revenue IS NOT NULL AND o.actual_revenue > 0
    AND COALESCE(o.funded_date, o.closing_date) IS NOT NULL AND COALESCE(o.funded_date, o.closing_date) >= v_start::date AND COALESCE(o.funded_date, o.closing_date) <= v_end::date;
  SELECT COALESCE(SUM(ra.personal_earnings), 0) INTO v_personal_earnings FROM revenue_attributions ra
  WHERE ra.company_id = p_company_id AND ra.locked_at IS NOT NULL
    AND ra.locked_at >= v_start AND ra.locked_at <= v_end
    AND ra.user_id = auth.uid() AND EXISTS (SELECT 1 FROM disposition_records d WHERE d.id = ra.disposition_record_id AND d.deleted_at IS NULL AND d.status = 'closed' AND d.revenue_verification_status = 'verified');
  SELECT count(*) INTO v_open_deals FROM disposition_records
  WHERE company_id = p_company_id AND status = 'active' AND deleted_at IS NULL
    AND created_at >= v_start AND created_at <= v_end;
  SELECT count(*) INTO v_contracts_executed FROM reporting_executed_contracts
  WHERE company_id = p_company_id AND deleted_at IS NULL AND contract_executed_at IS NOT NULL
    AND contract_executed_at >= v_start AND contract_executed_at <= v_end;
  SELECT count(*) INTO v_closings FROM disposition_records dr
  WHERE dr.company_id = p_company_id AND dr.status = 'closed' AND dr.deleted_at IS NULL
    AND COALESCE(dr.funded_date, dr.closing_date) >= v_start::date AND COALESCE(dr.funded_date, dr.closing_date) <= v_end::date;
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


CREATE OR REPLACE FUNCTION public.get_revenue_by_month(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month_str, 'revenue', rev) ORDER BY month_str), '[]'::jsonb)
  FROM (
    SELECT to_char(date_trunc('month', COALESCE(o.funded_date, o.closing_date)), 'YYYY-MM') AS month_str,
           COALESCE(SUM(o.actual_revenue), 0) AS rev
    FROM disposition_records o
    WHERE o.company_id = p_company_id AND o.status = 'closed'
      AND o.deleted_at IS NULL AND o.revenue_verification_status = 'verified' AND o.actual_revenue IS NOT NULL AND o.actual_revenue > 0
      AND COALESCE(o.funded_date, o.closing_date) IS NOT NULL
      AND COALESCE(o.funded_date, o.closing_date) >= COALESCE(p_start_date, '1970-01-01'::timestamptz)::date
      AND COALESCE(o.funded_date, o.closing_date) <= COALESCE(p_end_date, now())::date
    GROUP BY date_trunc('month', COALESCE(o.funded_date, o.closing_date))
  ) sub;
$$;


CREATE FUNCTION public.search_acquisition_leads(p_filters jsonb DEFAULT '{}', p_page integer DEFAULT 0, p_sort text DEFAULT 'stage_entered_at', p_direction text DEFAULT 'desc')
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
  LIMIT 100 OFFSET greatest(0,p_page) * 100
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

CREATE OR REPLACE FUNCTION public.get_revenue_by_user(
  p_company_id uuid, p_start_date timestamptz DEFAULT NULL, p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
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
      AND EXISTS (SELECT 1 FROM disposition_records d WHERE d.id=ra.disposition_record_id AND d.company_id=ra.company_id AND d.deleted_at IS NULL AND d.status='closed' AND d.revenue_verification_status='verified')
      AND ra.locked_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
      AND ra.locked_at <= COALESCE(p_end_date, now())
    GROUP BY ra.user_id, p.full_name
  ) sub;
$$;
