-- AcqDis opportunity foundation and pipeline ownership controls.
-- REVIEW BEFORE APPLYING. This migration is additive except for replacing broad
-- acquisition/disposition RLS policies and renaming the disposition entry-stage label.

SET lock_timeout = '2s';
SET statement_timeout = '60s';

-- Stage labels may be customized without changing the stable workflow meaning.
-- Custom stages have a null stage_key and use the normal in-progress behavior.
ALTER TABLE public.acquisition_pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_key text;

ALTER TABLE public.disposition_pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_key text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.acquisition_pipeline_stages
SET stage_key = CASE name
  WHEN 'New Lead' THEN 'new_lead'
  WHEN 'No Answer' THEN 'no_answer'
  WHEN 'Answered' THEN 'answered'
  WHEN 'Waiting for Info/Photos' THEN 'waiting_for_info'
  WHEN 'Needs Offer' THEN 'needs_offer'
  WHEN 'Ready for Proposal' THEN 'ready_for_proposal'
  WHEN 'Offer Accepted' THEN 'offer_accepted'
  WHEN 'Offer Declined' THEN 'offer_declined'
  WHEN 'Needs Contract' THEN 'needs_contract'
  WHEN 'Contract Executed' THEN 'contract_executed'
  WHEN 'Dead/DNC' THEN 'dead'
  ELSE stage_key
END
WHERE stage_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisition_stage_key
  ON public.acquisition_pipeline_stages (company_id, stage_key)
  WHERE stage_key IS NOT NULL;

-- Explicit manager permissions avoid inferring broad visibility from unrelated
-- permissions such as manage_users or reassign_leads.
INSERT INTO public.permissions (key, name, description, category)
VALUES
  ('view_all_acquisition_leads', 'View All Acquisition Leads', 'View acquisition leads assigned to other users in the same company', 'acquisitions'),
  ('view_all_disposition_deals', 'View All Disposition Deals', 'View disposition deals assigned to other users in the same company', 'dispositions')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'view_all_acquisition_leads'
WHERE r.name IN ('Administrator', 'Management', 'Director', 'Acquisitions Manager', 'Acquisition Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'view_all_disposition_deals'
WHERE r.name IN ('Administrator', 'Management', 'Director', 'Dispositions Manager', 'Disposition Manager')
ON CONFLICT DO NOTHING;

-- Abort instead of partially mapping data if a reused acquisition UUID already
-- belongs to an unrelated opportunity or if company links are inconsistent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.acquisition_records a
    JOIN public.opportunities o ON o.id = a.id
    WHERE a.opportunity_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Opportunity UUID collision detected; review the ID mapping before continuing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.acquisition_records a
    LEFT JOIN public.contacts c ON c.id = a.contact_id
    LEFT JOIN public.properties p ON p.id = a.property_id
    LEFT JOIN public.profiles u ON u.id = a.assigned_user_id
    WHERE (a.contact_id IS NOT NULL AND c.company_id IS DISTINCT FROM a.company_id)
       OR (a.property_id IS NOT NULL AND p.company_id IS DISTINCT FROM a.company_id)
       OR (a.assigned_user_id IS NOT NULL AND u.company_id IS DISTINCT FROM a.company_id)
  ) THEN
    RAISE EXCEPTION 'Cross-company acquisition link detected; reconcile before continuing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.acquisition_records a
    LEFT JOIN public.acquisition_pipeline_stages s
      ON s.id = a.pipeline_stage_id AND s.company_id = a.company_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Unmapped acquisition stage detected; add an explicit opportunity status mapping before continuing';
  END IF;
END $$;

INSERT INTO public.opportunities (
  id,
  company_id,
  primary_seller_contact_id,
  property_id,
  lead_source,
  assigned_acquisition_user_id,
  priority,
  status,
  created_at,
  updated_at
)
SELECT
  a.id,
  a.company_id,
  a.contact_id,
  a.property_id,
  a.lead_source,
  a.assigned_user_id,
  a.priority,
  CASE s.stage_key
    WHEN 'new_lead' THEN 'new'
    WHEN 'needs_offer' THEN 'qualified'
    WHEN 'ready_for_proposal' THEN 'qualified'
    WHEN 'offer_accepted' THEN 'offer_made'
    WHEN 'offer_declined' THEN 'offer_made'
    WHEN 'needs_contract' THEN 'offer_made'
    WHEN 'contract_executed' THEN 'under_contract'
    WHEN 'dead' THEN 'lost'
    ELSE 'new'
  END,
  a.created_at,
  a.updated_at
FROM public.acquisition_records a
LEFT JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id AND s.company_id = a.company_id
WHERE a.opportunity_id IS NULL;

UPDATE public.acquisition_records
SET opportunity_id = id
WHERE opportunity_id IS NULL;

-- Keep every future acquisition linked even when an older import path omits the
-- opportunity insert. The acquisition UUID is reused only for this fallback.
CREATE OR REPLACE FUNCTION public.ensure_acquisition_opportunity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_stage_key text;
BEGIN
  IF NEW.opportunity_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Acquisition contact must belong to the same company';
  END IF;
  IF NEW.property_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = NEW.property_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Acquisition property must belong to the same company';
  END IF;
  IF NEW.assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = NEW.assigned_user_id
      AND profile.company_id = NEW.company_id
      AND profile.is_disabled = false
  ) THEN
    RAISE EXCEPTION 'Acquisition owner must be an active user in the same company';
  END IF;

  SELECT stage_key INTO v_stage_key
  FROM public.acquisition_pipeline_stages
  WHERE id = NEW.pipeline_stage_id AND company_id = NEW.company_id;

  INSERT INTO public.opportunities (
    id, company_id, primary_seller_contact_id, property_id, lead_source,
    assigned_acquisition_user_id, priority, status, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.company_id, NEW.contact_id, NEW.property_id, NEW.lead_source,
    NEW.assigned_user_id, NEW.priority,
    CASE v_stage_key
      WHEN 'contract_executed' THEN 'under_contract'
      WHEN 'dead' THEN 'lost'
      WHEN 'offer_accepted' THEN 'offer_made'
      WHEN 'offer_declined' THEN 'offer_made'
      WHEN 'needs_contract' THEN 'offer_made'
      WHEN 'needs_offer' THEN 'qualified'
      WHEN 'ready_for_proposal' THEN 'qualified'
      WHEN 'new_lead' THEN 'new'
      ELSE 'contacted'
    END,
    COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
  );

  NEW.opportunity_id := NEW.id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_acquisition_opportunity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_acquisition_opportunity() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_acquisition_opportunity() FROM authenticated;

DROP TRIGGER IF EXISTS trg_ensure_acquisition_opportunity ON public.acquisition_records;
CREATE TRIGGER trg_ensure_acquisition_opportunity
BEFORE INSERT ON public.acquisition_records
FOR EACH ROW EXECUTE FUNCTION public.ensure_acquisition_opportunity();

ALTER TABLE public.acquisition_records
  ALTER COLUMN opportunity_id SET NOT NULL;

-- Preserve the existing stage UUID and ordering; only change the requested label.
UPDATE public.disposition_pipeline_stages d
SET name = 'New Lead'
WHERE d.name = 'New Deal'
  AND d.position = (
    SELECT min(first_stage.position)
    FROM public.disposition_pipeline_stages first_stage
    WHERE first_stage.company_id = d.company_id
  );

UPDATE public.disposition_pipeline_stages
SET stage_key = CASE name
  WHEN 'New Lead' THEN 'new_lead'
  WHEN 'Waiting on Info/Photos' THEN 'waiting_for_info'
  WHEN 'Contacted VIPs' THEN 'contacted_vips'
  WHEN 'Posted on FB' THEN 'posted_facebook'
  WHEN 'Posted on InvestorBase' THEN 'posted_investorbase'
  WHEN 'Pulled List' THEN 'pulled_list'
  WHEN 'SMS Blasted' THEN 'sms_blasted'
  WHEN 'Buyer Located' THEN 'buyer_located'
  WHEN 'EMD Placed' THEN 'emd_placed'
  WHEN 'Titlework Done' THEN 'titlework_done'
  WHEN 'Closing Scheduled' THEN 'closing_scheduled'
  WHEN 'Funded/Closed' THEN 'funded_closed'
  WHEN 'Dead' THEN 'dead'
  ELSE stage_key
END
WHERE stage_key IS NULL;

UPDATE public.disposition_pipeline_stages
SET is_system = true
WHERE stage_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_disposition_stage_key
  ON public.disposition_pipeline_stages (company_id, stage_key)
  WHERE stage_key IS NOT NULL;

DROP POLICY IF EXISTS "select_acq_records_own" ON public.acquisition_records;
DROP POLICY IF EXISTS "insert_acq_records_perm" ON public.acquisition_records;
DROP POLICY IF EXISTS "update_acq_records_perm" ON public.acquisition_records;
DROP POLICY IF EXISTS "delete_acq_records_perm" ON public.acquisition_records;

CREATE POLICY "select_acq_records_visible" ON public.acquisition_records
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('view_acquisitions')
  AND (
    public.has_permission('view_all_acquisition_leads')
    OR assigned_user_id = (SELECT auth.uid())
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.acquisition_pipeline_stages s
        WHERE s.id = acquisition_records.pipeline_stage_id
          AND s.company_id = acquisition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "insert_acq_records_visible" ON public.acquisition_records
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_acquisition_leads')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.acquisition_pipeline_stages s
        WHERE s.id = acquisition_records.pipeline_stage_id
          AND s.company_id = acquisition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "update_acq_records_visible" ON public.acquisition_records
FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_acquisition_leads')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.acquisition_pipeline_stages s
        WHERE s.id = acquisition_records.pipeline_stage_id
          AND s.company_id = acquisition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
)
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_acquisition_leads')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.acquisition_pipeline_stages s
        WHERE s.id = acquisition_records.pipeline_stage_id
          AND s.company_id = acquisition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "delete_acq_records_visible" ON public.acquisition_records
FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_acquisitions')
  AND (assigned_user_id = (SELECT auth.uid()) OR public.has_permission('view_all_acquisition_leads'))
);

DROP POLICY IF EXISTS "sel_disp_rec" ON public.disposition_records;
DROP POLICY IF EXISTS "ins_disp_rec" ON public.disposition_records;
DROP POLICY IF EXISTS "upd_disp_rec" ON public.disposition_records;
DROP POLICY IF EXISTS "del_disp_rec" ON public.disposition_records;

CREATE POLICY "select_disposition_records_visible" ON public.disposition_records
FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('view_dispositions')
  AND (
    public.has_permission('view_all_disposition_deals')
    OR assigned_user_id = (SELECT auth.uid())
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.disposition_pipeline_stages s
        WHERE s.id = disposition_records.pipeline_stage_id
          AND s.company_id = disposition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "insert_disposition_records_visible" ON public.disposition_records
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_disposition_deals')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.disposition_pipeline_stages s
        WHERE s.id = disposition_records.pipeline_stage_id
          AND s.company_id = disposition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "update_disposition_records_visible" ON public.disposition_records
FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_disposition_deals')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.disposition_pipeline_stages s
        WHERE s.id = disposition_records.pipeline_stage_id
          AND s.company_id = disposition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
)
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND (
    assigned_user_id = (SELECT auth.uid())
    OR public.has_permission('view_all_disposition_deals')
    OR (
      assigned_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.disposition_pipeline_stages s
        WHERE s.id = disposition_records.pipeline_stage_id
          AND s.company_id = disposition_records.company_id
          AND s.stage_key = 'new_lead'
      )
    )
  )
);

CREATE POLICY "delete_disposition_records_visible" ON public.disposition_records
FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_permission('edit_dispositions')
  AND (assigned_user_id = (SELECT auth.uid()) OR public.has_permission('view_all_disposition_deals'))
);

CREATE INDEX IF NOT EXISTS idx_acq_visible_owner_stage
  ON public.acquisition_records (company_id, assigned_user_id, pipeline_stage_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_disp_visible_owner_stage
  ON public.disposition_records (company_id, assigned_user_id, pipeline_stage_id, status);
