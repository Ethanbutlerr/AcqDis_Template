-- Cache request-constant permission checks without changing lead visibility.
ALTER POLICY select_acq_records_visible ON public.acquisition_records
USING (
  company_id = (SELECT public.get_current_company_id())
  AND (SELECT public.has_permission('view_acquisitions'))
  AND (
    (SELECT public.has_permission('view_all_acquisition_leads'))
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
