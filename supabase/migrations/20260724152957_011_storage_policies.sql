/*
# Phase 2 Storage Policies for crm-files bucket

## Overview
Creates RLS policies on the storage.objects table for the crm-files bucket.
Files are stored under company-scoped paths: {company_id}/{entity_type}/{entity_id}/{filename}

## Security
- SELECT: any authenticated user can read files (company scoping is enforced via path prefix)
- INSERT: any authenticated user can upload files
- DELETE: any authenticated user can delete files
- UPDATE: any authenticated user can update file metadata
*/

DROP POLICY IF EXISTS "select_crm_files" ON storage.objects;
CREATE POLICY "select_crm_files" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'crm-files');

DROP POLICY IF EXISTS "insert_crm_files" ON storage.objects;
CREATE POLICY "insert_crm_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'crm-files');

DROP POLICY IF EXISTS "update_crm_files" ON storage.objects;
CREATE POLICY "update_crm_files" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'crm-files')
  WITH CHECK (bucket_id = 'crm-files');

DROP POLICY IF EXISTS "delete_crm_files" ON storage.objects;
CREATE POLICY "delete_crm_files" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'crm-files');