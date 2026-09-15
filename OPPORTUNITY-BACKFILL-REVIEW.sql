-- REVIEW DRAFT. Ends in ROLLBACK intentionally. Not a deployable migration yet.
-- Release the conversation-selection safeguard before activating these links.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

-- Work against temporary copies for a rehearsal without changing live leads.
CREATE TEMP TABLE acqdis_source ON COMMIT DROP AS
SELECT a.*, s.name AS original_stage_name
FROM public.acquisition_records a
LEFT JOIN public.acquisition_pipeline_stages s
  ON s.id = a.pipeline_stage_id AND s.company_id = a.company_id
WHERE a.opportunity_id IS NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM acqdis_source a
    LEFT JOIN public.contacts c ON c.id = a.contact_id
    LEFT JOIN public.properties p ON p.id = a.property_id
    LEFT JOIN public.profiles u ON u.id = a.assigned_user_id
    WHERE (a.contact_id IS NOT NULL AND c.company_id IS DISTINCT FROM a.company_id)
       OR (a.property_id IS NOT NULL AND p.company_id IS DISTINCT FROM a.company_id)
       OR (a.assigned_user_id IS NOT NULL AND u.company_id IS DISTINCT FROM a.company_id)
  ) THEN RAISE EXCEPTION 'Cross-company link: review before migration'; END IF;
  IF EXISTS (SELECT 1 FROM acqdis_source WHERE original_stage_name IS NULL OR original_stage_name NOT IN (
    'New Lead', 'No Answer', 'Answered', 'Waiting for Info/Photos', 'Needs Offer',
    'Ready for Proposal', 'Offer Accepted', 'Offer Declined', 'Needs Contract',
    'Contract Executed', 'Dead/DNC'
  )) THEN RAISE EXCEPTION 'Unmapped stage: review before migration'; END IF;
END $$;

CREATE TEMP TABLE acqdis_opportunity_preview
  (LIKE public.opportunities INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
  ON COMMIT DROP;

-- Reuse the acquisition UUID in the preview only, making the mapping explicit.
-- Permanent activation must save a private backup/map and check UUID collisions.
INSERT INTO acqdis_opportunity_preview (
  id, company_id, primary_seller_contact_id, property_id, lead_source,
  assigned_acquisition_user_id, priority, status, created_at, updated_at,
  deleted_at, deleted_by
)
SELECT id, company_id, contact_id, property_id, lead_source, assigned_user_id,
  priority,
  CASE original_stage_name
    WHEN 'New Lead' THEN 'new'
    WHEN 'No Answer' THEN 'contacted'
    WHEN 'Answered' THEN 'contacted'
    WHEN 'Waiting for Info/Photos' THEN 'contacted'
    WHEN 'Needs Offer' THEN 'qualified'
    WHEN 'Ready for Proposal' THEN 'qualified'
    WHEN 'Offer Accepted' THEN 'offer_made'
    WHEN 'Offer Declined' THEN 'offer_made'
    WHEN 'Needs Contract' THEN 'offer_made'
    WHEN 'Contract Executed' THEN 'under_contract'
    WHEN 'Dead/DNC' THEN 'lost'
  END,
  created_at, updated_at, deleted_at, deleted_by
FROM acqdis_source;

SELECT
  (SELECT count(*) FROM acqdis_source) AS source_count,
  (SELECT count(*) FROM acqdis_opportunity_preview) AS preview_count,
  (SELECT count(*) FROM acqdis_opportunity_preview WHERE property_id IS NULL) AS missing_property_count,
  (SELECT count(*) FROM acqdis_opportunity_preview WHERE contract_date IS NOT NULL) AS invented_contract_dates,
  (SELECT count(*) FROM acqdis_source a JOIN acqdis_opportunity_preview o ON o.id=a.id
    WHERE o.company_id IS DISTINCT FROM a.company_id
       OR o.primary_seller_contact_id IS DISTINCT FROM a.contact_id
       OR o.property_id IS DISTINCT FROM a.property_id
       OR o.assigned_acquisition_user_id IS DISTINCT FROM a.assigned_user_id
       OR o.created_at IS DISTINCT FROM a.created_at) AS changed_links,
  (SELECT count(*) FROM acqdis_source a JOIN public.opportunities o ON o.id=a.id) AS existing_id_collisions;

ROLLBACK;
