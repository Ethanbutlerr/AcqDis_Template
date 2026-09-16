# Permissions cleanup release

Consolidates duplicate acquisition and buyer campaign controls, groups permissions into expandable sections, and keeps legacy permission IDs compatible. Existing grants are copied into the new controls; no CRM records are deleted.

New controls: Make Calls, Receive Calls, Manage Pipeline Stages, Delete or Archive Records. Stage setup also requires the existing edit permission for that pipeline. Restore Deleted Records remains separate. Management editing now has a specific record-oriented label. Underlying property/opportunity and obsolete simulation permissions are hidden from routine role editing while existing assignments are preserved.

Role saves use one authorized database transaction. Role loading batches assignment and membership reads. Simulated communication events require an active agency admin in the same company.

## Deployment order

1. Apply `supabase/migrations/20260916172640_permission_catalog_cleanup.sql` to the approved production project.
2. Deploy the updated `voice-token` function, retaining `verify_jwt=false` and its existing Twilio signature validation. Deploy `communication-provider` retaining its current gateway setting.
3. Publish the frontend commit to main and allow the hosting deployment to finish.
4. Refresh existing sessions to load the updated permissions. Verify the role editor and a real call with an authorized test user.

Do not deploy the frontend before the migration: it requires the new role-save function and permission keys.

## Verification

- TypeScript and focused ESLint.
- `node scripts/tests/voice-permissions.cjs`: outbound-only, inbound-only, combined, view-only rejection, and agency-admin token grants. Uses mocks; places no calls.
- `scripts/tests/permission-catalog.mjs`: executes the complete migration in an isolated PostgreSQL-compatible PGlite database using representative schema fixtures. Tests alias compatibility, preservation of grants, independent permissions, deletion denial, and atomic role saves.
- Run the database test with PGlite 0.5.8 installed in a separate test directory. Set `PGLITE_MODULE` to the file URL of that directory's `node_modules/@electric-sql/pglite/dist/index.js`, then run `node scripts/tests/permission-catalog.mjs`. No production credentials are used.

The fixtures test this migration and its rules; they do not reproduce the complete production schema. Live deployment and end-to-end browser/call checks are separate release steps.
