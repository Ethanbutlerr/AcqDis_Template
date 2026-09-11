/*
# Grant all permissions to Management role

## Problem
The "Management" system role (id: b0000000-0000-4000-8000-000000000001) has zero
permissions assigned in role_permissions. All users assigned to this role see an
empty sidebar because every nav item is gated behind a permission check.

## Fix
Insert a role_permissions row for every permission in the permissions table,
linking each to the Management role. Uses ON CONFLICT DO NOTHING so re-running
is safe.

## Security
- No RLS changes.
- No new tables.
- Management role gains full access as intended for a top-level admin role.
*/

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'b0000000-0000-4000-8000-000000000001'::uuid, p.id
FROM permissions p
ON CONFLICT DO NOTHING;
