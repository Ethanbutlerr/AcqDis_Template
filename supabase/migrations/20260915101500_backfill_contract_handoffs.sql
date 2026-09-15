-- Create the Dispositions / New Lead side for contracts that were already
-- executed before atomic pipeline movement was installed.

SET lock_timeout = '2s';
SET statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.acquisition_records a
    JOIN public.acquisition_pipeline_stages s
      ON s.id = a.pipeline_stage_id
     AND s.company_id = a.company_id
     AND s.stage_key = 'contract_executed'
    WHERE a.opportunity_id IS NULL
       OR a.contact_id IS NULL
       OR a.property_id IS NULL
       OR a.contract_executed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A Contract Executed record is missing its opportunity, contact, property, or recorded execution timestamp';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.acquisition_records a
    JOIN public.acquisition_pipeline_stages s
      ON s.id = a.pipeline_stage_id
     AND s.company_id = a.company_id
     AND s.stage_key = 'contract_executed'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.disposition_pipeline_stages ds
      WHERE ds.company_id = a.company_id
        AND ds.stage_key = 'new_lead'
    )
  ) THEN
    RAISE EXCEPTION 'Dispositions / New Lead is not configured for a company with executed contracts';
  END IF;
END $$;

INSERT INTO public.disposition_records (
  company_id,
  opportunity_id,
  acquisition_record_id,
  property_id,
  contact_id,
  assigned_user_id,
  pipeline_stage_id,
  status,
  contract_price,
  stage_entered_at,
  created_at,
  updated_at
)
SELECT
  a.company_id,
  a.opportunity_id,
  a.id,
  a.property_id,
  a.contact_id,
  NULL,
  ds.id,
  'active',
  a.offer_amount,
  a.contract_executed_at,
  a.contract_executed_at,
  clock_timestamp()
FROM public.acquisition_records a
JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id
 AND s.company_id = a.company_id
 AND s.stage_key = 'contract_executed'
JOIN public.disposition_pipeline_stages ds
  ON ds.company_id = a.company_id
 AND ds.stage_key = 'new_lead'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.disposition_records d
  WHERE d.company_id = a.company_id
    AND d.opportunity_id = a.opportunity_id
);

INSERT INTO public.disposition_stage_history (
  company_id,
  disposition_record_id,
  from_stage_id,
  to_stage_id,
  changed_by,
  is_automated,
  reason,
  created_at
)
SELECT
  d.company_id,
  d.id,
  NULL,
  d.pipeline_stage_id,
  a.contract_executed_by,
  true,
  'Historical contract handed off from Acquisitions',
  a.contract_executed_at
FROM public.disposition_records d
JOIN public.acquisition_records a
  ON a.id = d.acquisition_record_id
 AND a.company_id = d.company_id
JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id
 AND s.company_id = a.company_id
 AND s.stage_key = 'contract_executed'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.disposition_stage_history h
  WHERE h.disposition_record_id = d.id
    AND h.to_stage_id = d.pipeline_stage_id
);

INSERT INTO public.notes (company_id, entity_type, entity_id, author_id, body, created_at)
SELECT
  d.company_id,
  'disposition_record',
  d.id,
  a.contract_executed_by,
  'Historical contract handed off from Acquisitions',
  a.contract_executed_at
FROM public.disposition_records d
JOIN public.acquisition_records a
  ON a.id = d.acquisition_record_id
 AND a.company_id = d.company_id
JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id
 AND s.company_id = a.company_id
 AND s.stage_key = 'contract_executed'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notes n
  WHERE n.company_id = d.company_id
    AND n.entity_type = 'disposition_record'
    AND n.entity_id = d.id
    AND n.body = 'Historical contract handed off from Acquisitions'
);

INSERT INTO public.activity_events (
  company_id,
  entity_type,
  entity_id,
  event_type,
  actor_id,
  metadata,
  created_at
)
SELECT
  d.company_id,
  'disposition_record',
  d.id,
  'contract_handoff_created',
  a.contract_executed_by,
  jsonb_build_object(
    'source_acquisition_record_id', a.id,
    'opportunity_id', a.opportunity_id,
    'to_stage_id', d.pipeline_stage_id,
    'is_automated', true,
    'historical_backfill', true
  ),
  a.contract_executed_at
FROM public.disposition_records d
JOIN public.acquisition_records a
  ON a.id = d.acquisition_record_id
 AND a.company_id = d.company_id
JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id
 AND s.company_id = a.company_id
 AND s.stage_key = 'contract_executed'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_events e
  WHERE e.company_id = d.company_id
    AND e.entity_type = 'disposition_record'
    AND e.entity_id = d.id
    AND e.event_type = 'contract_handoff_created'
    AND e.metadata ->> 'source_acquisition_record_id' = a.id::text
);
