ALTER TABLE public.acquisition_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposition_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delete_acq_records_visible" ON public.acquisition_records AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_acquisition_leads'::text))));
CREATE POLICY "insert_acq_records_visible" ON public.acquisition_records AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_acquisition_leads'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM acquisition_pipeline_stages s
  WHERE ((s.id = acquisition_records.pipeline_stage_id) AND (s.company_id = acquisition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "require_active_account" ON public.acquisition_records AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "select_acq_records_visible" ON public.acquisition_records AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = ( SELECT get_current_company_id() AS get_current_company_id)) AND ( SELECT has_permission('view_acquisitions'::text) AS has_permission) AND (( SELECT has_permission('view_all_acquisition_leads'::text) AS has_permission) OR (assigned_user_id = ( SELECT auth.uid() AS uid)) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM acquisition_pipeline_stages s
  WHERE ((s.id = acquisition_records.pipeline_stage_id) AND (s.company_id = acquisition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "update_acq_records_visible" ON public.acquisition_records AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_acquisition_leads'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM acquisition_pipeline_stages s
  WHERE ((s.id = acquisition_records.pipeline_stage_id) AND (s.company_id = acquisition_records.company_id) AND (s.stage_key = 'new_lead'::text)))))))) WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_acquisition_leads'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM acquisition_pipeline_stages s
  WHERE ((s.id = acquisition_records.pipeline_stage_id) AND (s.company_id = acquisition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "delete_calls" ON public.calls AS PERMISSIVE FOR DELETE TO authenticated USING ((company_id = get_current_company_id()));
CREATE POLICY "insert_calls" ON public.calls AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((company_id = get_current_company_id()));
CREATE POLICY "require_active_account" ON public.calls AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "select_calls" ON public.calls AS PERMISSIVE FOR SELECT TO authenticated USING ((company_id = get_current_company_id()));
CREATE POLICY "update_calls" ON public.calls AS PERMISSIVE FOR UPDATE TO authenticated USING ((company_id = get_current_company_id())) WITH CHECK ((company_id = get_current_company_id()));
CREATE POLICY "delete_disposition_records_visible" ON public.disposition_records AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_disposition_deals'::text))));
CREATE POLICY "insert_disposition_records_visible" ON public.disposition_records AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_disposition_deals'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM disposition_pipeline_stages s
  WHERE ((s.id = disposition_records.pipeline_stage_id) AND (s.company_id = disposition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "require_active_account" ON public.disposition_records AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "select_disposition_records_visible" ON public.disposition_records AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('view_dispositions'::text) AND (has_permission('view_all_disposition_deals'::text) OR (assigned_user_id = ( SELECT auth.uid() AS uid)) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM disposition_pipeline_stages s
  WHERE ((s.id = disposition_records.pipeline_stage_id) AND (s.company_id = disposition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "update_disposition_records_visible" ON public.disposition_records AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_disposition_deals'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM disposition_pipeline_stages s
  WHERE ((s.id = disposition_records.pipeline_stage_id) AND (s.company_id = disposition_records.company_id) AND (s.stage_key = 'new_lead'::text)))))))) WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_dispositions'::text) AND ((assigned_user_id = ( SELECT auth.uid() AS uid)) OR has_permission('view_all_disposition_deals'::text) OR ((assigned_user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM disposition_pipeline_stages s
  WHERE ((s.id = disposition_records.pipeline_stage_id) AND (s.company_id = disposition_records.company_id) AND (s.stage_key = 'new_lead'::text))))))));
CREATE POLICY "delete_notifications_own" ON public.notifications AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = get_current_company_id()) AND (user_id = auth.uid())));
CREATE POLICY "insert_notifications_perm" ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((company_id = get_current_company_id()));
CREATE POLICY "require_active_account" ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "select_notifications_own" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = get_current_company_id()) AND (user_id = auth.uid())));
CREATE POLICY "update_notifications_own" ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = get_current_company_id()) AND (user_id = auth.uid()))) WITH CHECK ((company_id = get_current_company_id()));
CREATE POLICY "delete_opportunities_perm" ON public.opportunities AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text)));
CREATE POLICY "insert_opportunities_perm" ON public.opportunities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text)));
CREATE POLICY "require_active_account" ON public.opportunities AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "select_opportunities_own" ON public.opportunities AS PERMISSIVE FOR SELECT TO authenticated USING ((company_id = get_current_company_id()));
CREATE POLICY "update_opportunities_perm" ON public.opportunities AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text))) WITH CHECK (((company_id = get_current_company_id()) AND has_permission('edit_acquisitions'::text)));
CREATE POLICY "ins_rev_attr" ON public.revenue_attributions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = get_current_company_id()) AND has_permission('manage_compensation'::text)));
CREATE POLICY "require_active_account" ON public.revenue_attributions AS RESTRICTIVE FOR ALL TO authenticated USING ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL)) WITH CHECK ((( SELECT get_current_company_id() AS get_current_company_id) IS NOT NULL));
CREATE POLICY "sel_rev_attr" ON public.revenue_attributions AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = get_current_company_id()) AND (has_permission('view_all_revenue'::text) OR ((user_id = auth.uid()) AND has_permission('view_personal_earnings'::text)))));
CREATE POLICY "upd_rev_attr" ON public.revenue_attributions AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = get_current_company_id()) AND has_permission('manage_compensation'::text))) WITH CHECK (((company_id = get_current_company_id()) AND has_permission('manage_compensation'::text)));
