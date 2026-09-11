-- Allow management/admins to delete any role, including system roles,
-- as long as they have manage_roles permission and the role belongs to their company.
-- The user_count > 0 check in the application layer prevents deleting
-- a role that still has users assigned.

DROP POLICY IF EXISTS "delete_roles_perm" ON roles;

CREATE POLICY "delete_roles_perm" ON roles FOR DELETE
  TO authenticated
  USING (
    company_id = get_my_company_id()
    AND has_permission('manage_roles')
  );
