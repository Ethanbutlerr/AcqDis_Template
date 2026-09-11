/*
# Fix notes entity_type constraint and profiles SELECT RLS

1. Modified Tables
   - `notes`: Updated CHECK constraint to include 'acquisition_record' as valid entity_type
   - `profiles`: Added RLS policy so all authenticated company members can see
     each other's basic profile info (needed for assignee dropdowns, user lists)

2. Security
   - New SELECT policy on profiles: "select_company_profiles" allows any authenticated
     user to see profiles in their own company via get_current_company_id()
   - Existing restrictive policies remain in place

3. Important Notes
   - The old constraint only allowed: contact, property, opportunity, task,
     acquisition, disposition, management
   - Now also allows: acquisition_record, disposition_record, management_record
   - This was causing silent insert failures when saving notes on acquisition opportunities
*/

-- Fix the notes entity_type CHECK constraint
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_entity_type_check;
ALTER TABLE notes ADD CONSTRAINT notes_entity_type_check CHECK (
  entity_type = ANY (ARRAY[
    'contact', 'property', 'opportunity', 'task',
    'acquisition', 'acquisition_record',
    'disposition', 'disposition_record',
    'management', 'management_record'
  ])
);

-- Allow all authenticated company members to see each other's profiles
-- This is needed for assignee dropdowns, user lists in pipeline views, etc.
DROP POLICY IF EXISTS "select_company_profiles" ON profiles;
CREATE POLICY "select_company_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (company_id = get_current_company_id());
