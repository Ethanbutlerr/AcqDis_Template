-- Preserve original addresses while adding a searchable comparison value and
-- a manager review queue. Matching records are never merged or deleted.

SET lock_timeout = '2s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.normalize_property_address(
  p_street text,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_zip text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(concat_ws(' ',
            NULLIF(btrim(COALESCE(p_street, '')), ''),
            NULLIF(btrim(COALESCE(p_city, '')), ''),
            NULLIF(btrim(COALESCE(p_state, '')), ''),
            NULLIF(btrim(COALESCE(p_zip, '')), '')
          )),
          '([,[:space:]]+(n/?a|null|undefined|\(\s*\)))+$', '', 'gi'
        ),
        '[^a-z0-9#]+', ' ', 'g'
      )
    ),
    ''
  );
$function$;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS normalized_address text;

UPDATE public.properties
SET normalized_address = public.normalize_property_address(
  street_address, city, state, zip_code
)
WHERE normalized_address IS DISTINCT FROM public.normalize_property_address(
  street_address, city, state, zip_code
);

CREATE OR REPLACE FUNCTION public.set_property_normalized_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.normalized_address := public.normalize_property_address(
    NEW.street_address, NEW.city, NEW.state, NEW.zip_code
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_property_normalized_address ON public.properties;
CREATE TRIGGER trg_set_property_normalized_address
BEFORE INSERT OR UPDATE OF street_address, city, state, zip_code
ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.set_property_normalized_address();

CREATE INDEX IF NOT EXISTS idx_properties_company_normalized_address
  ON public.properties (company_id, normalized_address)
  WHERE normalized_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.opportunity_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  matched_opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  normalized_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed_distinct', 'duplicate', 'dismissed')),
  reason text NOT NULL DEFAULT 'same_normalized_address',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opportunity_id <> matched_opportunity_id),
  UNIQUE (company_id, opportunity_id, matched_opportunity_id)
);

ALTER TABLE public.opportunity_duplicate_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_duplicate_reviews_manager"
ON public.opportunity_duplicate_reviews
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    public.has_permission('view_all_acquisition_leads')
    OR public.has_permission('view_all_disposition_deals')
  )
);

CREATE POLICY "update_duplicate_reviews_manager"
ON public.opportunity_duplicate_reviews
FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    public.has_permission('view_all_acquisition_leads')
    OR public.has_permission('view_all_disposition_deals')
  )
)
WITH CHECK (
  company_id = public.get_current_company_id()
  AND (
    public.has_permission('view_all_acquisition_leads')
    OR public.has_permission('view_all_disposition_deals')
  )
);

GRANT SELECT, UPDATE ON public.opportunity_duplicate_reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.flag_repeated_opportunity_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_normalized_address text;
  v_matched_opportunity_id uuid;
  v_review_id uuid;
BEGIN
  SELECT p.normalized_address INTO v_normalized_address
  FROM public.properties p
  WHERE p.id = NEW.property_id AND p.company_id = NEW.company_id;

  IF v_normalized_address IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT opportunity.id INTO v_matched_opportunity_id
  FROM public.opportunities opportunity
  JOIN public.properties p ON p.id = opportunity.property_id
  WHERE opportunity.company_id = NEW.company_id
    AND opportunity.id <> NEW.id
    AND opportunity.deleted_at IS NULL
    AND p.normalized_address = v_normalized_address
  ORDER BY opportunity.created_at DESC
  LIMIT 1;

  IF v_matched_opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.opportunity_duplicate_reviews (
    company_id, opportunity_id, matched_opportunity_id, normalized_address
  ) VALUES (
    NEW.company_id, NEW.id, v_matched_opportunity_id, v_normalized_address
  )
  ON CONFLICT (company_id, opportunity_id, matched_opportunity_id) DO NOTHING
  RETURNING id INTO v_review_id;

  IF v_review_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      company_id, user_id, type, title, body, entity_type, entity_id, is_read
    )
    SELECT DISTINCT
      NEW.company_id,
      recipients.user_id,
      'duplicate_review',
      'Possible Repeat Property',
      'A new opportunity has the same normalized address as an existing opportunity.',
      'opportunity_duplicate_review',
      v_review_id,
      false
    FROM (
      SELECT p.id AS user_id
      FROM public.profiles p
      WHERE p.company_id = NEW.company_id AND p.is_agency_admin = true
      UNION
      SELECT ur.user_id
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id AND r.company_id = NEW.company_id
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions permission ON permission.id = rp.permission_id
      WHERE permission.key IN ('view_all_acquisition_leads', 'view_all_disposition_deals')
    ) recipients;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.flag_repeated_opportunity_address() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flag_repeated_opportunity_address() FROM anon;
REVOKE ALL ON FUNCTION public.flag_repeated_opportunity_address() FROM authenticated;

DROP TRIGGER IF EXISTS trg_flag_repeated_opportunity_address ON public.acquisition_records;
DROP TRIGGER IF EXISTS trg_flag_repeated_opportunity_address ON public.opportunities;
CREATE TRIGGER trg_flag_repeated_opportunity_address
AFTER INSERT OR UPDATE OF property_id
ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.flag_repeated_opportunity_address();
