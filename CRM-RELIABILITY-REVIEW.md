# CRM reliability review

Release review. The database migration was applied to production and the two updated Edge Functions were deployed on November 10, 2026. The frontend release is tracked below.

## Findings

- The production notification schema lacked `read_at`, although the UI sent it with every read update. Supabase rejected the write; the UI discarded the error. Notification links could also navigate before saving completed. The automation engine similarly referenced a missing notification `metadata` column.
- Dashboard and scoreboard background requests switched loaded content to skeletons. Requests lacked response ordering guards. Permission callbacks changed identity on each render, and a `null` permission fallback incorrectly rendered the default denial card.
- The active CSV importer bypassed the atomic opportunity creation workflow, overwrote source values with `Expired Inbound`, discarded unmapped columns, and did not attach import batches. Matching a contact did not prevent duplicate acquisition/property records.
- A read-only audit during the initial work found 13 executed contracts, dated September 4–29, 2026, all attributed and none missing execution dates. Those historical contracts correctly do not count in an October or November “This Week” period. The scoreboard now defaults to All Time and clearly identifies the selected period.
- Scoreboard closed-deal counts were conditional on positive verified revenue, acquisition revenue used the disposition assignee, date checks mixed funded and closing dates, and alphabetical tie-breaking gave different ranks to identical results.
- Dashboard revenue used unverified opportunity revenue; closings used mutable `updated_at`; management users' personal earnings could aggregate other users' earnings.
- Missed-call callbacks used a check-then-insert race and classified intermediate call statuses as missed calls. The initial read-only audit found no existing duplicate missed-call groups and no closed dispositions.

## Implemented

- Manual and CSV creation share the existing atomic acquisition-opportunity function, including history, contact/property links, and idempotent retries. Imports preserve supported fields and all original columns in lead metadata, validate and preview mappings, retain per-row results, and expose a downloadable summary.
- Lead groups, import batch metadata and persisted created-lead counts; combined group, batch, source, manager, stage, tag and date filters; server-side search, sorting and 100-record pages; bulk group, tag and assignment edits with all-or-nothing failure handling. Source/motivation options cover the visible dataset rather than only the current page.
- Duplicate detection requires a normalized seller identifier and the same property location. Different properties remain separate. Existing historical rows are not merged or deleted.
- Persistent notification read/unread state, history filter, full unread count, mark-all beyond the visible page, checked write results, and stale-response protection. Stable event identifiers and conflict-ignore writes preserve existing read status on callback retries.
- Loaded dashboard metrics and scoreboard results remain mounted while refreshing. Realtime changes are debounced; a 60-second visible-tab polling fallback remains. Scope changes reset account-specific state. Contract and opportunity mutations emit local refresh events.
- Selectable ranking metric, shared competition ranks for ties, consistent podium/table results, separate weekly/today dials, and diagnostics for undated/unattributed/excluded-member contracts. Rankings respect the caller's row visibility; restricted users are not granted access to hidden records.
- Distinct historical executions use a security-invoker reporting view. Verified disposition revenue, actual closing/funding dates, acquisition attribution, and the logged-in user's locked earnings replace inconsistent calculations. Compensation percentages and payment rules were not changed.

## Files

- `app/(app)/acquisitions/page.tsx`, `app/(app)/dashboard/page.tsx`
- `components/acquisitions-scoreboard.tsx`, `components/notification-center.tsx`, `components/permission-gate.tsx`
- New `components/lead-group-picker.tsx`, `components/lead-import-dialog.tsx`
- `lib/auth/use-permissions.ts`, `lib/utils/csv.ts`, `lib/utils/pipeline-stage.ts`
- Login: `lib/auth/auth-context.tsx`, `lib/auth/protected-route.tsx`, `app/login/page.tsx`, new `scripts/tests/auth-reliability.cjs`
- New `lib/utils/lead-import.ts`, `lib/utils/scoreboard.ts`, `hooks/use-crm-refresh.ts`
- `supabase/functions/voice-token/index.ts`, `supabase/functions/automation-engine/index.ts`
- `supabase/migrations/20261111042300_crm_reliability.sql`
- `scripts/tests/inbound-routing.cjs`, new `scripts/tests/crm-ui.cjs`, `scripts/tests/crm-database.cjs`, and schema/policy fixtures
- `.gitignore` excludes the isolated database test engine.

Pre-existing changes in acquisitions, automation-engine, `tsconfig.json`, `opencode.json`, and `supabase/.temp/` were retained. Temporary editing scripts were removed.

## Validation

- ESLint: passes, no warnings or errors.
- TypeScript: `npm run typecheck -- --incremental false` passes. Disabling incremental output avoids the workspace's cache-file write restriction.
- Production build: passes; all 40 static pages generated. Existing Browserslist age and Supabase Realtime dynamic-dependency warnings remain.
- 98 tests pass across CRM database/UI, authentication, browser calling, incoming calls, and routing suites. They cover persisted grouped creation, retry safety, source field preservation, combined filtering/pagination across 1,205 records, bulk rollback, permissions, historical reporting, dials, ties, notification history and mark-all, callback retries, and five dashboard background refresh cycles without replacing metric DOM. Authentication coverage includes REST outages, recovery, missing and disabled profiles, permission failures, duplicate auth events, retained background state, and late responses after sign-out.
- Database tests execute the actual migration/functions in isolated PostgreSQL using schema and policy snapshots. Identity and permission helpers use controlled fixtures. They do not run against production and are not a full Supabase infrastructure test.

To repeat:

```powershell
npm install --prefix .crm-test-tools --no-save --package-lock=false @electric-sql/pglite@0.5.11
node --test scripts/tests/auth-reliability.cjs scripts/tests/crm-ui.cjs scripts/tests/crm-database.cjs scripts/tests/browser-call-window.cjs scripts/tests/incoming-call-window.cjs scripts/tests/inbound-routing.cjs
npm run lint
npm run typecheck -- --incremental false
npm run build
```

The isolated test dependency is not part of the application dependencies or lockfile.

## Review and deployment considerations

- The migration was applied to production on November 10, 2026, and registered as version `20261111042300`. The local filename matches remote migration history. The updated frontend and notification-producing Edge Functions require its columns and RPCs.
- `voice-token` version 28 and `automation-engine` version 10 are active in production with their existing JWT settings preserved.
- The migration adds lead groups/import batches, acquisition grouping/tag columns and indexes, notification read/event/metadata columns, a distinct-contract reporting view, and updated creation, search, bulk-edit and reporting functions. Existing duplicate missed-call copies, if any, are retained as read history. No historical leads, deals or contracts are deleted.
- Realtime delivery depends on the deployment's existing publication settings. Polling remains a fallback; no production publication settings were changed.
- The active Acquisitions workflow is the updated lead workflow. Legacy, unlinked seller-list/import components remain in the repository.
- Browser visual checks across devices, a several-minute authenticated live session, and staging tests against actual external calling providers remain release checks. Automated DOM refresh tests are not represented as those live checks.
- Existing conversion-rate widgets intentionally exclude legacy `csv_import` sources, unlike total metric cards. That existing business rule was not silently changed. Their broader historical definition should be reviewed separately.
- Import retries within the open dialog retain request IDs. Closing the dialog/reloading does not resume a partially completed import automatically; batch results and saved leads remain persisted. Re-importing property-identifiable rows checks duplicates, while leads without a property cannot be safely deduplicated automatically.

## Login outage investigation and local fix

- Production logs on November 10 EST / November 11 UTC show profile REST requests returning HTTP 503 with `PGRST002`. PostgREST's internal logs report `PGRST003`, a timeout acquiring a connection from its pool, while loading schema cache, server version and configuration.
- The reported user's auth account, active profile, company and confirmed email all exist. A direct read under the authenticated role and that user's identity successfully reads the profile. The exposed `public` and `graphql_public` schemas both exist. A database snapshot showed no blocked connections and no evidence of the configured connection limit being exhausted. The exact reason the REST pool stopped serving requests is not established.
- The old sign-in path discarded the profile query error, interpreted its null data as a nonexistent account, and attempted `create_company_and_admin`. That failed and produced the misleading account-setup message. The failure does not mean the user's account needs to be recreated.
- Removed provisioning from sign-in. Service errors now preserve the session and show an explicit retry; missing profiles direct users to their administrator. Profile, subscription and permissions must load successfully before completing sign-in. Transient background errors preserve an already loaded account. Stale results cannot restore a profile after sign-out, and auth-event database work is deferred outside the callback. Login submission reliably exits its loading state; protected routes show recovery controls instead of an endless spinner.
- An additional pre-existing signup issue was identified: production `create_company_and_admin` references `role_permissions.permission_key`, while the current table uses `permission_id`. It was not invoked or changed during this audit. Signup provisioning needs a separate reviewed migration; this is not the cause of the REST service outage.
- A [Supabase schema-cache reload](https://supabase.com/kb/troubleshooting/refresh-postgrest-schema) reached PostgREST but did not clear its pool timeout. The user repaired the database service separately; a zero-row REST request then returned HTTP 200. The exact service-side cause of the pool failure remains unknown.
- A real authenticated browser login and staging/mobile/long-session release checks remain outstanding.
