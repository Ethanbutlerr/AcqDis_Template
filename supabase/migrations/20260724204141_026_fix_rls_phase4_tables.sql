/*
# Security Fix — Tighten RLS on Phase 4 Tables

## Issue
Migrations 018, 019, 020 created tables with USING(true) / WITH CHECK(true) policies,
meaning any authenticated user from ANY company could read, insert, update, or delete
all rows. This migration replaces those open policies with proper company-scoped,
permission-gated policies matching the pattern used in migrations 001/009/010.

## Tables Fixed
- disposition_pipeline_stages (018)
- management_pipeline_stages (018)
- disposition_records (019)
- buyer_offers (019)
- management_records (019)
- pipeline_stage_mappings (020)
- synchronization_events (020)
- compensation_rules (020)
- revenue_attributions (020)

## Storage Fix
- crm-files bucket: restrict to company-scoped paths
*/

-- ============================================================
-- disposition_pipeline_stages — company-scoped, manage via edit_dispositions
-- ============================================================
DROP POLICY IF EXISTS "sel_disp_stages" ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "ins_disp_stages" ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "upd_disp_stages" ON disposition_pipeline_stages;
DROP POLICY IF EXISTS "del_disp_stages" ON disposition_pipeline_stages;

CREATE POLICY "sel_disp_stages" ON disposition_pipeline_stages FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
CREATE POLICY "ins_disp_stages" ON disposition_pipeline_stages FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "upd_disp_stages" ON disposition_pipeline_stages FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "del_disp_stages" ON disposition_pipeline_stages FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));

-- ============================================================
-- management_pipeline_stages — company-scoped, manage via edit_management
-- ============================================================
DROP POLICY IF EXISTS "sel_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "ins_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "upd_mgmt_stages" ON management_pipeline_stages;
DROP POLICY IF EXISTS "del_mgmt_stages" ON management_pipeline_stages;

CREATE POLICY "sel_mgmt_stages" ON management_pipeline_stages FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id());
CREATE POLICY "ins_mgmt_stages" ON management_pipeline_stages FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "upd_mgmt_stages" ON management_pipeline_stages FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "del_mgmt_stages" ON management_pipeline_stages FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));

-- ============================================================
-- disposition_records — company-scoped, view/edit_dispositions
-- ============================================================
DROP POLICY IF EXISTS "sel_disp_rec" ON disposition_records;
DROP POLICY IF EXISTS "ins_disp_rec" ON disposition_records;
DROP POLICY IF EXISTS "upd_disp_rec" ON disposition_records;
DROP POLICY IF EXISTS "del_disp_rec" ON disposition_records;

CREATE POLICY "sel_disp_rec" ON disposition_records FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('view_dispositions'));
CREATE POLICY "ins_disp_rec" ON disposition_records FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "upd_disp_rec" ON disposition_records FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "del_disp_rec" ON disposition_records FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));

-- ============================================================
-- buyer_offers — company-scoped, view/edit_dispositions
-- ============================================================
DROP POLICY IF EXISTS "sel_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "ins_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "upd_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "del_buyer_offers" ON buyer_offers;

CREATE POLICY "sel_buyer_offers" ON buyer_offers FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('view_dispositions'));
CREATE POLICY "ins_buyer_offers" ON buyer_offers FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "upd_buyer_offers" ON buyer_offers FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));
CREATE POLICY "del_buyer_offers" ON buyer_offers FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_dispositions'));

-- ============================================================
-- management_records — company-scoped, view/edit_management
-- ============================================================
DROP POLICY IF EXISTS "sel_mgmt_rec" ON management_records;
DROP POLICY IF EXISTS "ins_mgmt_rec" ON management_records;
DROP POLICY IF EXISTS "upd_mgmt_rec" ON management_records;
DROP POLICY IF EXISTS "del_mgmt_rec" ON management_records;

CREATE POLICY "sel_mgmt_rec" ON management_records FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('view_management'));
CREATE POLICY "ins_mgmt_rec" ON management_records FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "upd_mgmt_rec" ON management_records FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "del_mgmt_rec" ON management_records FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));

-- ============================================================
-- pipeline_stage_mappings — company-scoped, view/edit_management
-- ============================================================
DROP POLICY IF EXISTS "sel_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "ins_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "upd_psm" ON pipeline_stage_mappings;
DROP POLICY IF EXISTS "del_psm" ON pipeline_stage_mappings;

CREATE POLICY "sel_psm" ON pipeline_stage_mappings FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('view_management'));
CREATE POLICY "ins_psm" ON pipeline_stage_mappings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "upd_psm" ON pipeline_stage_mappings FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));
CREATE POLICY "del_psm" ON pipeline_stage_mappings FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('edit_management'));

-- ============================================================
-- synchronization_events — company-scoped, view_management for SELECT
-- INSERT only for authenticated (automation engine writes these)
-- ============================================================
DROP POLICY IF EXISTS "sel_sync_ev" ON synchronization_events;
DROP POLICY IF EXISTS "ins_sync_ev" ON synchronization_events;

CREATE POLICY "sel_sync_ev" ON synchronization_events FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('view_management'));
CREATE POLICY "ins_sync_ev" ON synchronization_events FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- compensation_rules — company-scoped, manage_compensation
-- ============================================================
DROP POLICY IF EXISTS "sel_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "ins_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "upd_comp_rules" ON compensation_rules;
DROP POLICY IF EXISTS "del_comp_rules" ON compensation_rules;

CREATE POLICY "sel_comp_rules" ON compensation_rules FOR SELECT TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
CREATE POLICY "ins_comp_rules" ON compensation_rules FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
CREATE POLICY "upd_comp_rules" ON compensation_rules FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
CREATE POLICY "del_comp_rules" ON compensation_rules FOR DELETE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));

-- ============================================================
-- revenue_attributions — company-scoped
-- SELECT: view_all_revenue OR view_personal_earnings (own rows)
-- INSERT/UPDATE: manage_compensation
-- ============================================================
DROP POLICY IF EXISTS "sel_rev_attr" ON revenue_attributions;
DROP POLICY IF EXISTS "ins_rev_attr" ON revenue_attributions;
DROP POLICY IF EXISTS "upd_rev_attr" ON revenue_attributions;

CREATE POLICY "sel_rev_attr" ON revenue_attributions FOR SELECT TO authenticated
  USING (
    company_id = public.get_current_company_id()
    AND (
      public.has_permission('view_all_revenue')
      OR (user_id = auth.uid() AND public.has_permission('view_personal_earnings'))
    )
  );
CREATE POLICY "ins_rev_attr" ON revenue_attributions FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));
CREATE POLICY "upd_rev_attr" ON revenue_attributions FOR UPDATE TO authenticated
  USING (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('manage_compensation'));

-- ============================================================
-- Storage: crm-files bucket — restrict to company-scoped paths
-- Files are stored as {company_id}/{entity_type}/{entity_id}/{filename}
-- ============================================================
DROP POLICY IF EXISTS "select_crm_files" ON storage.objects;
CREATE POLICY "select_crm_files" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'crm-files'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );

DROP POLICY IF EXISTS "insert_crm_files" ON storage.objects;
CREATE POLICY "insert_crm_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'crm-files'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );

DROP POLICY IF EXISTS "update_crm_files" ON storage.objects;
CREATE POLICY "update_crm_files" ON storage.objects FOR UPDATE
  TO authenticated USING (
    bucket_id = 'crm-files'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  )
  WITH CHECK (
    bucket_id = 'crm-files'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );

DROP POLICY IF EXISTS "delete_crm_files" ON storage.objects;
CREATE POLICY "delete_crm_files" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'crm-files'
    AND (storage.foldername(name))[1] = public.get_current_company_id()::text
  );
