-- READ-ONLY REVIEW SCRIPT. This file does not update production data.
-- Use before the AcqDis opportunity migrations to review records already in
-- Contract Executed without a preserved execution timestamp or actor.

WITH contract_stage AS (
  SELECT id, company_id
  FROM public.acquisition_pipeline_stages
  WHERE name = 'Contract Executed'
),
history_evidence AS (
  SELECT
    h.acquisition_record_id,
    min(h.created_at) FILTER (WHERE h.to_stage_id = cs.id) AS first_entered_contract_stage_at,
    max(h.created_at) FILTER (WHERE h.to_stage_id = cs.id) AS last_entered_contract_stage_at,
    (array_agg(h.changed_by ORDER BY h.created_at DESC)
      FILTER (WHERE h.to_stage_id = cs.id))[1] AS latest_contract_stage_actor_id,
    count(*) FILTER (WHERE h.to_stage_id = cs.id) AS contract_stage_entries
  FROM public.acquisition_stage_history h
  JOIN contract_stage cs
    ON cs.id = h.to_stage_id
   AND cs.company_id = h.company_id
  GROUP BY h.acquisition_record_id
)
SELECT
  a.company_id,
  a.id AS acquisition_record_id,
  a.opportunity_id,
  a.contact_id,
  concat_ws(' ', c.first_name, c.last_name) AS contact_name,
  a.property_id,
  concat_ws(', ', nullif(p.street_address, ''), nullif(p.city, ''), nullif(p.state, ''), nullif(p.zip_code, '')) AS property_address,
  a.assigned_user_id,
  a.contract_executed_at,
  h.first_entered_contract_stage_at,
  h.last_entered_contract_stage_at,
  h.latest_contract_stage_actor_id,
  coalesce(h.contract_stage_entries, 0) AS contract_stage_entries,
  CASE
    WHEN a.contract_executed_at IS NOT NULL THEN 'timestamp_already_preserved'
    WHEN h.first_entered_contract_stage_at IS NOT NULL THEN 'history_candidate_requires_human_confirmation'
    ELSE 'no_timestamp_evidence_do_not_backfill'
  END AS review_status
FROM public.acquisition_records a
JOIN contract_stage cs
  ON cs.id = a.pipeline_stage_id
 AND cs.company_id = a.company_id
LEFT JOIN history_evidence h ON h.acquisition_record_id = a.id
LEFT JOIN public.contacts c ON c.id = a.contact_id AND c.company_id = a.company_id
LEFT JOIN public.properties p ON p.id = a.property_id AND p.company_id = a.company_id
ORDER BY a.company_id, a.created_at, a.id;

-- Release approval should record a human-confirmed timestamp and actor for each
-- row before a separate data migration is written. Never substitute created_at
-- or updated_at when stage history is missing.
