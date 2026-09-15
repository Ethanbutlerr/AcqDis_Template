# AcqDis master checklist

Current state (2026-09-15): the private production backup is complete, the protective migration plus six release migrations are applied and tracked in AcqDis (`rogtagiiqjbmokhxywpd`), and the updated `automation-engine`, `sms-provider`, and `voice-token` Edge Functions are deployed. The application changes are verified locally and await the Git commit/push and controlled live browser checks.

## 0. Acquisition refresh regression

- [x] Use the real `saved_views` fields: `page` and `config`.
- [x] Map database `config` to the page's local `filters` value when loading and after saving.
- [x] Preserve the previous successful lead snapshot and show Retry when a refresh fails.
- [x] Verify TypeScript, focused ESLint, and production build.
- File: `app/(app)/acquisitions/page.tsx`.
- Risk left: browser verification against production data is still required; no database migration is needed for this fix.

## 1. One opportunity through acquisition and disposition

- [x] Prepare an additive opportunity backfill that reuses each acquisition UUID and preserves contact, property, owner, created date, notes, calls, tasks, files, messages, and history links.
- [x] Protect acquisition history from opportunity deletion with `ON DELETE RESTRICT`.
- [x] Make Contract Executed create or reuse one active disposition record with the same opportunity ID.
- [x] Keep an existing active disposition in its current stage on a retry; send a closed/dead prior disposition to manager review instead of reopening it.
- [x] Preserve the disposition entry-stage UUID while changing its label from New Deal to New Lead.
- [x] Preserve the first contract execution timestamp and execution owner for reporting.
- [x] Hand a newly executed contract to Dispositions as an unassigned New Lead so eligible disposition operators can see and claim it.
- [x] Synchronize Dead/DNC across linked acquisition and disposition records, with automatic history on the linked side.
- [x] Prepare read-only backfill and five-contract reconciliation reports.
- [x] Review the two acquisitions without a property and all seven current Contract Executed rows. The two missing property links remain null, and contract dates/actors came only from recorded stage-history evidence.
- [x] Backfill the seven existing executed contracts into unassigned Dispositions / New Lead records without duplicating opportunities.
- Files: `OPPORTUNITY-BACKFILL-REVIEW.sql`, `CONTRACT-RECONCILIATION-REVIEW.sql`, `supabase/migrations/20260914223012_acqdis_opportunity_foundation.sql`, `supabase/migrations/20260914223649_atomic_pipeline_moves.sql`.

## 2. Address cleanup and repeat-submission review

- [x] Remove display-only NA/N/A/NULL/undefined fragments and empty parentheses.
- [x] Keep apartment/unit text distinct and never infer location from a phone area code.
- [x] Add a stored normalized comparison address while preserving the original address.
- [x] Add a same-company repeat-address review queue and in-app manager alerts.
- [x] Keep both opportunities; review actions never merge or delete records.
- [x] Add the compact review control to the existing Acquisitions and Dispositions screens.
- [x] Review production normalization before rollout: all 8,416 properties produced nonblank normalized values; historical repeats were not enqueued in bulk.
- Files: `lib/utils/format.ts`, `components/duplicate-review-dialog.tsx`, `app/(app)/acquisitions/page.tsx`, `supabase/migrations/20260914225603_address_duplicate_review.sql`.
- Risk left: an address match is only a flag; spelling variations can miss matches and shared addresses can be valid.

## 3. Ownership, visibility, and multiple roles

- [x] Keep multiple role memberships and combine their permissions.
- [x] Keep TC-only users out of Acquisitions unless another assigned role grants access.
- [x] Show ordinary Acquisition/Disposition operators only unassigned New Leads and their personally assigned records.
- [x] Prevent another operator from moving or claiming an assigned record.
- [x] Prevent stale simultaneous claims and stage moves with row locks, expected-stage checks, and request IDs.
- [x] Limit unassigned claims to the New Lead stage; manager exceptions use explicit view-all permissions.
- [x] Validate contact, property, owner, stage, and company links in the migration/transaction paths.
- [ ] Run the release role matrix with ordinary operators, managers, TC-only, and TC plus Acquisitions Manager accounts.
- Files: `app/(app)/layout.tsx`, `app/(app)/settings/users/page.tsx`, acquisition/disposition pages and drawers, opportunity foundation and atomic movement migrations.
- Scope note: shared Contacts behavior is unchanged because one contact can have multiple opportunities with different owners.

## 4. Stage history and optional notes

- [x] Let users add an optional note to manual Acquisition, Disposition, and Management stage moves.
- [x] When the note is blank, record a concise automatic `Moved from ... to ...` reason so history is never empty.
- [x] Save the stage update, owner claim, note, history row, activity row, opportunity status, and contract handoff in one database transaction.
- [x] Record actor, previous stage, destination stage, timestamp, note, and whether a move was automated.
- [x] Make retries idempotent and allow later unrelated stage/call automation events to run with their own event identity.
- [x] Surface failed moves and failed post-move automation in the current CRM controls.
- Files: `components/stage-move-dialog.tsx`, acquisition/disposition/management pages and drawers, `lib/utils/pipeline-stage.ts`, `lib/utils/automation.ts`, atomic movement migration, `supabase/functions/automation-engine/index.ts`.
- Risk left: automatic reasons explain the movement but do not capture extra call context unless the user chooses to add it.

## 5. Opportunity screens, notes, and New Opportunity

- [x] Keep contact information first, followed by opportunity and contract details.
- [x] Keep current tabs, styling, offer flow, activity, files, tasks, and navigation.
- [x] Edit the linked contact from Acquisition and Disposition opportunity screens.
- [x] Reload the saved phone before preparing a call and remain in the opportunity screen.
- [x] Show note author, current roles, timestamp, and linked contact/opportunity/acquisition/disposition notes without duplicating stored notes.
- [x] Create contact, property, opportunity, acquisition, initial history, and activity atomically with one request ID.
- [x] Preserve incomplete leads and align form options with the confirmed form questions.
- [x] Allow New Opportunity from either pipeline and select its starting pipeline/stage without creating duplicate opportunities.
- [x] Add safe stage rename, color, reorder, create, and unused-custom-stage deletion while protecting required workflow keys.
- [x] Keep the stage editor readable before database rollout and disable writes until the `stage_key` migration exists.
- Files: opportunity drawers, `components/create-opportunity-dialog.tsx`, `components/opportunity-contact-editor.tsx`, `components/opportunity-call-button.tsx`, `components/notes-section.tsx`, acquisition/disposition pages, `app/(app)/settings/pipelines/page.tsx`, atomic movement and pipeline customization migrations.

## 6. Twilio numbers, outbound calls, inbound SMS, and alerts

- [x] Sync selectable numbers from the authenticated Twilio IncomingPhoneNumbers inventory.
- [x] Mark removed/unverified local numbers inactive and exclude them from call/SMS sender selection.
- [x] Keep credentials server-side in `company_credentials`, with legacy fallback only for existing installs.
- [x] Authenticate user send/sync requests and require service authorization for scheduled jobs/internal receive actions.
- [x] Validate Twilio webhook signatures against the configured public callback URL.
- [x] Receive inbound SMS, preserve STOP/HELP/resubscribe handling, and prevent retry duplicates by Message SID.
- [x] Record delivered/failed status callbacks without downgrading an already delivered message.
- [x] Create idempotent follow-up tasks and unread in-app alerts for the assigned user plus authorized managers/admins.
- [x] Link alerts to the contact, conversation, message, and opportunity when available; no user IDs are hardcoded.
- [x] Register one browser-wide receiving device, refresh its token, ring up to ten authorized recipients, and let the first answer win.
- [x] Route each number to its assigned user/team, falling back to active users with call permission; log answered/missed calls and create missed-call alerts.
- [x] Add an explicit Enable Incoming Calls action that links a verified Twilio number to the configured TwiML App without changing it during ordinary sync.
- [ ] Configure and verify Twilio webhook URLs in an isolated account without placing an unauthorized real call or SMS.
- Files: `supabase/functions/voice-token/index.ts`, `supabase/functions/sms-provider/index.ts`, phone settings, `components/incoming-call-listener.tsx`, browser call dialog, notification center.

## 7. Seller/buyer SMS campaign visibility and compliance

- [x] Show Queued, Sent, Delivered, Responded, Suppressed/Review, and Failed recipient groups using real lead/message state.
- [x] Resolve campaign member lead IDs to their linked contacts correctly.
- [x] Batch message lookups so larger campaigns do not silently lose status rows.
- [x] Use the database's create/edit/start/pause campaign permissions in the UI.
- [x] Keep Seller, Buyer, Unread, assignment, SMS, Call, Email, and Opted Out filters in Conversations.
- [x] Preserve opt-out evidence, suppression, quiet hours, frequency limits, sender identity, and audit records.
- [x] Do not rotate numbers to evade carrier filtering and do not send real test messages.
- Files: `app/(app)/sms-blasts/page.tsx`, `app/(app)/conversations/page.tsx`, `components/conversations/conversation-list-panel.tsx`, `supabase/functions/sms-provider/index.ts`.

## 8. Dashboard attribution

- [x] Count real outbound call attempts by distinct provider Call SID and exclude simulated calls.
- [x] Attribute signed contracts to the preserved execution actor, with current owner only as a fallback for unreconciled historical rows.
- [x] Keep closed-deal revenue tied to verified source records.
- [x] Reconcile the seven historical executed contracts to recorded stage history and preserve their execution actor/date for dashboard attribution.
- File: `supabase/migrations/20260914230926_reporting_attribution.sql`.

## 9. Release and verification

- [x] TypeScript: passed with incremental output disabled.
- [x] Focused ESLint: passed with zero warnings and zero errors.
- [x] Edge Function TypeScript syntax: passed for automation, SMS, and voice functions.
- [x] Re-run TypeScript, ESLint, Edge syntax, production build, and diff checks after the final stage/Twilio changes; all pass. The build has only the existing Browserslist freshness and Supabase Realtime bundler warnings.
- [x] Diff whitespace check: passed; only Git's Windows line-ending notices remain.
- [x] Prepare deployment order, stop conditions, verification cases, and recovery steps in `ACQDIS-RELEASE-RUNBOOK.md`.
- [x] Take a private production snapshot in `acqdis_backup_20260915_release1`; all 24 copied table counts matched (26,084 rows total) and access is restricted.
- [x] Run both read-only reconciliation reports and record the production results.
- [x] Apply and track the six release migrations in order.
- [x] Deploy `automation-engine`, `sms-provider`, and `voice-token` through the authenticated AcqDis dashboard.
- [ ] Deploy the application by pushing the reviewed commit to `main`.
- [ ] Run the controlled browser/RLS/Twilio/dashboard checks in the runbook.
- [ ] Commit and push only the reviewed project files; exclude local `opencode.json` and `supabase/.temp`.

## Current completion

- Local checklist implementation: complete.
- Production database rollout: complete and verified (3,637 linked acquisitions/opportunities, seven unassigned New Lead dispositions, 8,416 normalized properties, six tracked release migrations).
- Edge Function rollout: complete for automation, SMS, and voice.
- Remaining release work: reviewed Git commit/push and controlled live browser/RLS/Twilio/dashboard checks.
- No real message or call was sent during release verification.
