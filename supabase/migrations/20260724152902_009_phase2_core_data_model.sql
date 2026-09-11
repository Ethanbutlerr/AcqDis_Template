/*
# Phase 2 Core Data Model — Contacts, Properties, Opportunities, Tasks, Notes, Files

## Overview
Creates the shared data foundation for the CRM pipeline. All tables are
company-scoped with RLS policies checking company membership and permissions.

## New Tables
1. contact_types — Default + custom contact type labels
2. contacts — People or companies with normalized phone/email for dedup
3. contact_phones — Multiple phone numbers per contact
4. contact_emails — Multiple email addresses per contact
5. contact_contact_types — Many-to-many join contacts <-> contact_types
6. tags — Reusable tag labels scoped to company
7. contact_tags — Many-to-many join contacts <-> tags
8. properties — Real estate properties with normalized address fields
9. opportunities — Business opportunities linking seller contact + property
10. notes — Internal notes with pin/mentions, polymorphic attachment
11. files — File metadata for Supabase Storage uploads
12. tasks — Tasks with status, priority, assignment, recurrence, record links
13. task_comments — Comments on tasks
14. saved_views — Per-user saved filter configurations
15. activity_events — Meaningful event log for activity timeline

## Security
- All tables RLS enabled, company-scoped SELECT, permission-gated writes.
- Notes/files/activity: company-scoped SELECT, INSERT by any company member.
- Saved views: owner-scoped (user_id = auth.uid()).
*/

-- CONTACT_TYPES
CREATE TABLE IF NOT EXISTS contact_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE contact_types ENABLE ROW LEVEL SECURITY;

-- CONTACTS
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  company_name text,
  primary_phone text,
  primary_phone_normalized text,
  primary_email text,
  primary_email_normalized text,
  mailing_address_1 text,
  mailing_address_2 text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  lead_source text,
  communication_consent boolean NOT NULL DEFAULT true,
  do_not_call boolean NOT NULL DEFAULT false,
  do_not_text boolean NOT NULL DEFAULT false,
  opt_out_date timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- CONTACT_PHONES
CREATE TABLE IF NOT EXISTS contact_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone text NOT NULL,
  phone_normalized text NOT NULL,
  label text NOT NULL DEFAULT 'mobile',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;

-- CONTACT_EMAILS
CREATE TABLE IF NOT EXISTS contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_normalized text NOT NULL,
  label text NOT NULL DEFAULT 'personal',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;

-- CONTACT_CONTACT_TYPES
CREATE TABLE IF NOT EXISTS contact_contact_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_type_id uuid NOT NULL REFERENCES contact_types(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, contact_type_id)
);
ALTER TABLE contact_contact_types ENABLE ROW LEVEL SECURITY;

-- TAGS
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- CONTACT_TAGS
CREATE TABLE IF NOT EXISTS contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, tag_id)
);
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

-- PROPERTIES
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  street_address text NOT NULL,
  city text,
  state text,
  zip_code text,
  county text,
  property_type text,
  bedrooms integer,
  bathrooms numeric(4,1),
  square_footage integer,
  lot_size text,
  year_built integer,
  occupancy_status text,
  property_condition text,
  repairs_needed text,
  estimated_repair_cost numeric(12,2),
  access_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- OPPORTUNITIES
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_seller_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  lead_source text,
  campaign text,
  referral_source text,
  assigned_acquisition_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_disposition_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','offer_made','under_contract','closed','lost')),
  created_at timestamptz NOT NULL DEFAULT now(),
  contract_date date,
  closing_date date,
  expected_revenue numeric(12,2),
  actual_revenue numeric(12,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- NOTES
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact','property','opportunity','task','acquisition','disposition','management')),
  entity_id uuid NOT NULL,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  mentions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- FILES
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact','property','opportunity','task','acquisition','disposition','management')),
  entity_id uuid NOT NULL,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','completed','canceled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  due_date date,
  due_time text,
  completed_at timestamptz,
  related_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  related_property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  related_opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_automated boolean NOT NULL DEFAULT false,
  automation_source text,
  recurrence_rule text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- TASK_COMMENTS
CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- SAVED_VIEWS
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  page text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

-- ACTIVITY_EVENTS
CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- CONTACT_TYPES
DROP POLICY IF EXISTS "select_contact_types_own" ON contact_types;
CREATE POLICY "select_contact_types_own" ON contact_types FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_contact_types_perm" ON contact_types;
CREATE POLICY "insert_contact_types_perm" ON contact_types FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "update_contact_types_perm" ON contact_types;
CREATE POLICY "update_contact_types_perm" ON contact_types FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "delete_contact_types_perm" ON contact_types;
CREATE POLICY "delete_contact_types_perm" ON contact_types FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

-- CONTACTS
DROP POLICY IF EXISTS "select_contacts_own" ON contacts;
CREATE POLICY "select_contacts_own" ON contacts FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_contacts_perm" ON contacts;
CREATE POLICY "insert_contacts_perm" ON contacts FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "update_contacts_perm" ON contacts;
CREATE POLICY "update_contacts_perm" ON contacts FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "delete_contacts_perm" ON contacts;
CREATE POLICY "delete_contacts_perm" ON contacts FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

-- CONTACT_PHONES
DROP POLICY IF EXISTS "select_contact_phones_own" ON contact_phones;
CREATE POLICY "select_contact_phones_own" ON contact_phones FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_contact_phones_perm" ON contact_phones;
CREATE POLICY "insert_contact_phones_perm" ON contact_phones FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "update_contact_phones_perm" ON contact_phones;
CREATE POLICY "update_contact_phones_perm" ON contact_phones FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "delete_contact_phones_perm" ON contact_phones;
CREATE POLICY "delete_contact_phones_perm" ON contact_phones FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

-- CONTACT_EMAILS
DROP POLICY IF EXISTS "select_contact_emails_own" ON contact_emails;
CREATE POLICY "select_contact_emails_own" ON contact_emails FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_contact_emails_perm" ON contact_emails;
CREATE POLICY "insert_contact_emails_perm" ON contact_emails FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "update_contact_emails_perm" ON contact_emails;
CREATE POLICY "update_contact_emails_perm" ON contact_emails FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "delete_contact_emails_perm" ON contact_emails;
CREATE POLICY "delete_contact_emails_perm" ON contact_emails FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

-- CONTACT_CONTACT_TYPES
DROP POLICY IF EXISTS "select_cct_own" ON contact_contact_types;
CREATE POLICY "select_cct_own" ON contact_contact_types FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_contact_types.contact_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_cct_perm" ON contact_contact_types;
CREATE POLICY "insert_cct_perm" ON contact_contact_types FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_contact_types.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "delete_cct_perm" ON contact_contact_types;
CREATE POLICY "delete_cct_perm" ON contact_contact_types FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_contact_types.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

-- TAGS
DROP POLICY IF EXISTS "select_tags_own" ON tags;
CREATE POLICY "select_tags_own" ON tags FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_tags_perm" ON tags;
CREATE POLICY "insert_tags_perm" ON tags FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "update_tags_perm" ON tags;
CREATE POLICY "update_tags_perm" ON tags FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

DROP POLICY IF EXISTS "delete_tags_perm" ON tags;
CREATE POLICY "delete_tags_perm" ON tags FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_contacts'));

-- CONTACT_TAGS
DROP POLICY IF EXISTS "select_contact_tags_own" ON contact_tags;
CREATE POLICY "select_contact_tags_own" ON contact_tags FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND c.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_contact_tags_perm" ON contact_tags;
CREATE POLICY "insert_contact_tags_perm" ON contact_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

DROP POLICY IF EXISTS "delete_contact_tags_perm" ON contact_tags;
CREATE POLICY "delete_contact_tags_perm" ON contact_tags FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND c.company_id = public.get_current_company_id())
    AND public.has_permission('edit_contacts')
  );

-- PROPERTIES
DROP POLICY IF EXISTS "select_properties_own" ON properties;
CREATE POLICY "select_properties_own" ON properties FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_properties_perm" ON properties;
CREATE POLICY "insert_properties_perm" ON properties FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "update_properties_perm" ON properties;
CREATE POLICY "update_properties_perm" ON properties FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "delete_properties_perm" ON properties;
CREATE POLICY "delete_properties_perm" ON properties FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

-- OPPORTUNITIES
DROP POLICY IF EXISTS "select_opportunities_own" ON opportunities;
CREATE POLICY "select_opportunities_own" ON opportunities FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_opportunities_perm" ON opportunities;
CREATE POLICY "insert_opportunities_perm" ON opportunities FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "update_opportunities_perm" ON opportunities;
CREATE POLICY "update_opportunities_perm" ON opportunities FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'))
  WITH CHECK (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

DROP POLICY IF EXISTS "delete_opportunities_perm" ON opportunities;
CREATE POLICY "delete_opportunities_perm" ON opportunities FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND public.has_permission('edit_acquisitions'));

-- NOTES
DROP POLICY IF EXISTS "select_notes_own" ON notes;
CREATE POLICY "select_notes_own" ON notes FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_notes_perm" ON notes;
CREATE POLICY "insert_notes_perm" ON notes FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_notes_perm" ON notes;
CREATE POLICY "update_notes_perm" ON notes FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_notes_perm" ON notes;
CREATE POLICY "delete_notes_perm" ON notes FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND (author_id = auth.uid() OR public.has_permission('edit_contacts')));

-- FILES
DROP POLICY IF EXISTS "select_files_own" ON files;
CREATE POLICY "select_files_own" ON files FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_files_perm" ON files;
CREATE POLICY "insert_files_perm" ON files FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_files_perm" ON files;
CREATE POLICY "delete_files_perm" ON files FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id());

-- TASKS
DROP POLICY IF EXISTS "select_tasks_own" ON tasks;
CREATE POLICY "select_tasks_own" ON tasks FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_tasks_perm" ON tasks;
CREATE POLICY "insert_tasks_perm" ON tasks FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "update_tasks_perm" ON tasks;
CREATE POLICY "update_tasks_perm" ON tasks FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id())
  WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "delete_tasks_perm" ON tasks;
CREATE POLICY "delete_tasks_perm" ON tasks FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id());

-- TASK_COMMENTS
DROP POLICY IF EXISTS "select_task_comments_own" ON task_comments;
CREATE POLICY "select_task_comments_own" ON task_comments FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id AND t.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "insert_task_comments_perm" ON task_comments;
CREATE POLICY "insert_task_comments_perm" ON task_comments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id AND t.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "update_task_comments_perm" ON task_comments;
CREATE POLICY "update_task_comments_perm" ON task_comments FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id AND t.company_id = public.get_current_company_id())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id AND t.company_id = public.get_current_company_id())
  );

DROP POLICY IF EXISTS "delete_task_comments_perm" ON task_comments;
CREATE POLICY "delete_task_comments_perm" ON task_comments FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id AND t.company_id = public.get_current_company_id())
  );

-- SAVED_VIEWS (owner-scoped)
DROP POLICY IF EXISTS "select_saved_views_own" ON saved_views;
CREATE POLICY "select_saved_views_own" ON saved_views FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "insert_saved_views_own" ON saved_views;
CREATE POLICY "insert_saved_views_own" ON saved_views FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "update_saved_views_own" ON saved_views;
CREATE POLICY "update_saved_views_own" ON saved_views FOR UPDATE
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = public.get_current_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "delete_saved_views_own" ON saved_views;
CREATE POLICY "delete_saved_views_own" ON saved_views FOR DELETE
  TO authenticated USING (company_id = public.get_current_company_id() AND user_id = auth.uid());

-- ACTIVITY_EVENTS
DROP POLICY IF EXISTS "select_activity_events_own" ON activity_events;
CREATE POLICY "select_activity_events_own" ON activity_events FOR SELECT
  TO authenticated USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS "insert_activity_events_perm" ON activity_events;
CREATE POLICY "insert_activity_events_perm" ON activity_events FOR INSERT
  TO authenticated WITH CHECK (company_id = public.get_current_company_id());

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contact_types_company ON contact_types(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_norm ON contacts(primary_phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_email_norm ON contacts(primary_email_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_phones_norm ON contact_phones(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_emails_norm ON contact_emails(email_normalized);
CREATE INDEX IF NOT EXISTS idx_cct_contact ON contact_contact_types(contact_id);
CREATE INDEX IF NOT EXISTS idx_cct_type ON contact_contact_types(contact_type_id);
CREATE INDEX IF NOT EXISTS idx_tags_company ON tags(company_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_properties_company ON properties(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_seller ON opportunities(primary_seller_contact_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_property ON opportunities(property_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_page ON saved_views(page);
CREATE INDEX IF NOT EXISTS idx_activity_events_entity ON activity_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_company ON activity_events(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(created_at DESC);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at_contact_types ON contact_types;
CREATE TRIGGER set_updated_at_contact_types BEFORE UPDATE ON contact_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_contacts ON contacts;
CREATE TRIGGER set_updated_at_contacts BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_properties ON properties;
CREATE TRIGGER set_updated_at_properties BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_opportunities ON opportunities;
CREATE TRIGGER set_updated_at_opportunities BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_notes ON notes;
CREATE TRIGGER set_updated_at_notes BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_tasks ON tasks;
CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_task_comments ON task_comments;
CREATE TRIGGER set_updated_at_task_comments BEFORE UPDATE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_saved_views ON saved_views;
CREATE TRIGGER set_updated_at_saved_views BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();