# AcqDis improvement plan

## Step 1: agreed business rules

This file is the historical decision and investigation log. Current implementation and release status is maintained in `ACQDIS-MASTER-CHECKLIST.md`. As of 2026-09-15, the private production backup, protective migration, six release migrations, and three updated Edge Functions are deployed; the application commit/push and controlled live checks remain.

Current decision update (2026-09-15): stage-move notes are optional. Every move still records actor, prior stage, destination stage, timestamp, and either the user note or an automatic movement reason. Browser-wide incoming Twilio call routing is included in the local release candidate; it has not been activated or tested with a real call.

Goal: simplify AcqDis while preserving its design, existing workflows, records, and activity history. Performance improvements must be measured; fewer tables or records alone do not guarantee a faster app.

Design requirement: follow the current CRM navigation, colors, typography, spacing, tables, drawers, buttons, and existing reusable components. Preserve existing CRM features and interactions unless an agreed checklist item explicitly changes them. Present any major visual or workflow change to the user before implementation. Backend cleanup is not authorization for a redesign.

### Contacts and opportunities

- Keep one contact record for a person, linked to their opportunities. A person may have opportunities for different addresses.
- Use one opportunity throughout acquisition and disposition. Contract Executed moves that opportunity to Dispositions / New Lead, preserving its identifier and history.
- Keep one current contract and a compact history indicator. Preserve execution date and responsible user for reporting after the move.
- Store property/form information with the opportunity as the target design. Retain existing property records until migration and dependency checks are complete.
- Flag matching phone/email contacts for review rather than automatically merging them.
- Normalize addresses, retaining apartment/unit distinctions. Never infer a property location solely from a phone area code.
- Prevent matching active opportunities within the same pipeline. Incomplete addresses must not all match each other.
- Preserve closed, dead, and archived opportunities for search and repeat-submission detection. Earlier agreement allows a new opportunity after closure/death/archive; the later concern about repeated forms means automatic reopening/new creation needs a final decision.
- Allow incomplete leads. Store missing fields as blank/null, remove placeholder NA fragments, and retain original import values for review.

### Movement and ownership

- Allow an optional note for a manual pipeline move. Always retain either the entered note or an automatic movement reason in history.
- Record old/new pipeline and stage, actor, timestamp, and assignment changes.
- Regular users see unassigned opportunities and their own assigned opportunities. Managers/admins see all within their authorized company.
- Only the assigned user or an authorized manager/admin may move or reassign an assigned opportunity.
- Claiming an unassigned opportunity must prevent two users from taking it at once.
- Enforce visibility in database access rules as well as the interface.
- Show the same underlying Dead/DNC records from both pipeline views, subject to ownership permissions; do not copy records for these views.
- Keep Dead (deal outcome) distinct from DNC (communication restriction), even if displayed in one combined view. Confirm the exact behavior before implementing.

### Form information to preserve

- Selling timeline: ASAP, within 30/60/90 days.
- Property type: single family, 2–4 units, 5+ units, mobile/manufactured, condo/townhome, vacant land, other.
- Occupancy: owner, tenant, squatter, vacant.
- Listed online: yes/no.
- Agent representation: yes/no.
- Selling motivation: preserve all supplied options.
- Condition: excellent, cleaning needed, minor repairs, major repairs, gut/teardown, vacant land.
- Purchased within five years: yes/no.
- Seller's opinion of value (not an independently assessed value or ARV).
- Asking price assuming a 10-day closing with fees covered.
- Full property address, including unit where applicable.
- Keep contact name, phone and email on the linked contact. Editing a phone must affect subsequent calls.

## Overall checklist

### Buyer offer save checkpoint — 2026-09-14

Local Add Offer now checks edit permission, guards repeated submissions while saving, validates finite positive offer/non-negative deposit values, verifies the saved row before clearing the draft, and retains inputs with an error on failed/unconfirmed writes. Activity-write failures after a confirmed offer are reported as partial success rather than inviting a duplicate offer. Closing is blocked during submission. TypeScript and lint passed; live database failure/retry tests remain pending. No live writes/deployment. Offer acceptance still requires a later atomic database operation; this change does not fix that separate workflow.

### Disposition loading checkpoint — 2026-09-14

Buyer-picker contacts now load only when Add Offer opens, removing the up-to-300-contact read from ordinary drawer opens and field-save reloads. Closing the picker cancels its request; failures show Retry; submission waits for a valid loaded buyer. Empty offer lists clear stale buyer names. Existing 300-contact picker cap remains (search/pagination still pending). TypeScript and focused lint verification performed; browser/live offer testing remains pending. No live schema/data writes or deployment.

### Acquisition loading checkpoint — 2026-09-14

Local acquisition loader now cancels outstanding reads on reload/unmount/company change, checks read errors, orders pagination by ID, and commits loaded records/maps/settings together only when successful. Contact/property/opportunity/task lookups explicitly filter company. Empty task results clear stale task mappings. Company changes clear prior company data and close the drawer. Failed refreshes preserve the previous successful snapshot with a visible error and Retry action.

TypeScript, focused ESLint and whitespace checks pass. Browser navigation/network-failure tests remain pending. ID ordering stabilizes offset pagination but is not a snapshot under concurrent inserts/deletes. This reduces wasted superseded requests; no measured latency claim and no claim that this explains the earlier router/DNS incident. All-lead loading and database ownership enforcement remain separate unfinished tasks. No live writes or deployment.

### Original checklist resumed — 2026-09-14

User redirected work to the Google Doc's original nine requests and asked to stop expanding role management because the app already has usable role/permission controls. Keep operator visibility and anti-stealing protections in scope. Do not redesign the role system or require another teammate-role inventory to progress. Existing later business decisions (same opportunity moves, preserve data/history, distinct units, review ambiguous duplicates) override conflicting older document wording.

Fetched current AcqDis Notes from Google Drive; document includes the nine requests and phased checklist. Progress below is implementation status, not production completion:

1. Shared opportunity model: pending migration, consumer updates and reconciliation; live acquisitions remain unlinked.
2. Addresses/duplicates: local display formatter removes comma-separated NA/N/A/NULL/undefined placeholders, trailing repeated NA tokens, empty parentheses and surrounding parentheses. Preserves unit identifiers; does not infer location from phone area code. Integrated into acquisition/disposition detail and pipeline displays. Stored data/import normalization and duplicate review remain pending.
3. Contract handoff/configurable stages: audited; implementation and end-to-end verification pending.
4. Acquisition inline calling: implemented locally; real call verification pending.
5. Twilio inventory: confirmed local phone settings allow manual arbitrary numbers and set registration_status=registered without API verification. Verified official Twilio IncomingPhoneNumbers resource is the account inventory source. No number removal or settings mutation performed. Account-scoped synchronization and send/call validation remain pending.
6. Opportunity layout: acquisition and disposition local drawers now contact-first. Disposition reuses contact editor; Opportunity Details label; contact then opportunity then contract details; buyer offers and activity retained. Existing disposition notes field moved to separate Notes tab alongside attributed NotesSection, preserving old text without inventing an author. Browser/live-save checks pending.
7. Notes/create controls: attribution and simulator removal implemented locally; disposition attributed notes added. Acquisition button/dialog renamed New Opportunity. Cross-entity note synchronization, pipeline/stage chooser and optional-field creation still pending; do not claim the label change completes the form.
8. SMS pipelines/compliance: pending. Preserve opt-out suppression evidence; do not rotate numbers to evade filtering or promise carrier approval. No bulk messages authorized to send as part of implementation testing.
9. Dashboard: pending reconciliation of dial attempts and executed-contract history; do not fabricate missing dates.

Latest checks: TypeScript and focused ESLint pass. Address examples cover placeholder tokens, parentheses, distinct units, legitimate street text and missing fields. No live database changes, pushes, calls or SMS in this batch. Current work is not a complete release of the original checklist.

1. Business rules recorded here; resolve the few remaining edge cases below.
2. Map current fields and dependencies to the proposed structure.
3. Verify the app's actual Supabase project and compare its live schema with local migrations.
4. Back up database records and preserve file/recording references; spreadsheet is supplemental.
5. Prepare and test an additive migration in a separate test environment.
6. Update and verify one workflow at a time; discuss major changes before implementing.
7. Retire old structures only after reconciliation and rollback checks.

Later requested improvements: address cleanup/deduplication, configurable stages, direct calling from opportunities, accurate Twilio number choices, opportunity layout, attributed notes, flexible New Opportunity form, SMS campaign views and safeguards, and accurate per-user dashboard metrics.

The reported navigation incident was attributed by the user to DNS/router issues. Previously observed request-race risks are separate unconfirmed preventive findings, not a proven incident cause.

## Decisions still needed before implementation

- At the disposition handoff, retain the owner, assign a disposition user, or return to an unassigned queue?
- Does a failed deal mean Dead only, with DNC applied separately when appropriate?
- On repeat submissions for a dead/closed opportunity, flag for review, reopen, or create a new opportunity?
- Does the required note apply only to pipeline moves, or also every stage change? How should automated moves record reasons?
- How should contact/conversation access work when one contact has opportunities owned by different users?

## Scope and verification

## First local checkpoint: feature preservation map

This is a source-code map, not a live-data test. Checkboxes below remain open until tested in an isolated environment. Do not test by sending real messages, making calls, or moving production leads.

| Feature | Current source to preserve | Check after migration |
| --- | --- | --- |
| Acquisition list, filters, sorting | `app/(app)/acquisitions/page.tsx`: acquisition records plus contacts, properties, opportunities and tasks | Same visible leads, values, order and filters for the same user |
| Open acquisition and edit details | `components/acquisition-drawer.tsx`: acquisition record, linked contact/property, assignment and stage history | Edits persist on the correct lead; existing panel design remains |
| Disposition list and Dead action | `app/(app)/dispositions/page.tsx`: disposition records and linked property/acquisition | Existing active deals remain visible; agreed shared Dead view uses one underlying record |
| Open disposition and buyer offers | `components/disposition-drawer.tsx`: disposition, seller, property, acquisition, offers and activity | Offers, prices and closing information survive with their links |
| Contract execution | `supabase/functions/automation-engine/index.ts`: execution timestamp and contract event handling | One opportunity moves; retry does not duplicate a contract count or transition |

### Verification checklist for one test lead

- [ ] Record original identifiers, owner, stage, form answers and contract values.
- [ ] Map notes, calls, messages, tasks, files, buyer offers and reporting references before changing identifiers.
- [ ] Open the lead from both the pipeline and contact screen; confirm the correct details appear.
- [ ] Confirm saved contact phone changes are used by the call action without placing a real call.
- [ ] Verify a normal user can access their own/unassigned leads, but cannot retrieve another owner's restricted lead through another screen or API.
- [ ] Verify an authorized manager can view and reassign it within the company.
- [ ] Move the test opportunity through Contract Executed with a note; verify the same identifier in Dispositions / New Lead.
- [ ] Verify original contract actor/date remain in history and dashboard totals remain correct after ownership changes.
- [ ] Verify Dead and DNC behavior separately, including both pipeline views and communication suppression.
- [ ] Compare the current and updated screens for layout, controls and navigation.

Next checkpoint: complete the field/link inventory, then verify the actual Supabase project. No schema or application behavior changes in this checkpoint.

## Database verification boundary

### Opportunity backfill rehearsal — 2026-09-14

Created OPPORTUNITY-BACKFILL-REVIEW.sql, a temporary-table-only rehearsal ending with ROLLBACK. Executed against the verified project's current schema constraints: 3,637 source acquisitions produced 3,637 preview opportunities; zero changed company/contact/property/owner/created-date links; zero invented contract dates; zero ID collisions. Two missing properties remain explicitly missing. Stage-to-status mapping is preview-only; original stage records are preserved. This is not an executable production backfill and contains no permanent backup or link activation. Production migration still needs private backup/mapping, concurrency protection, recovery checks and ongoing insert/update synchronization.

Found 484 contacts with multiple acquisitions. Current Conversations fallback chooses the most recently created opportunity, which would select an arbitrary deal after backfill. Local safeguard now resolves only explicit opportunity links or a single undeleted opportunity for a contact; company filters and a request-generation guard prevent stale opportunity selection. Multiple matches leave the opportunity unselected; a future explicit deal picker is still needed. TypeScript passed; lint has no errors and one pre-existing contacts dependency warning.

Do not activate production links before the conversation safeguard is released and remaining handoff/synchronization consumers are ready. Rehearsal does not establish safe ongoing dual writes or end-to-end migration completion. No permanent data changes in this rehearsal.

### First live foundation migration — 2026-09-14

Applied protect_acquisition_history_on_opportunity_delete to verified project rogtagiiqjbmokhxywpd, migration version 20260914172429. Changed acquisition_records.opportunity_id foreign-key deletion action from CASCADE to RESTRICT. Deleting a linked opportunity is now blocked instead of cascading through its acquisition and stage/assignment history. Existing ID and relationship columns remain unchanged; no data moved or deleted. Used 2-second lock timeout and 20-second statement timeout.

Verified live catalog shows ON DELETE RESTRICT and convalidated=true. Post-change counts: 3,637 acquisitions, all 3,637 still unlinked, zero opportunities. Saved exact applied migration locally under the version generated by Supabase. No production delete test performed. This is a prerequisite protection, not completion of the opportunity backfill/handoff.

The deletion behavior change is intentional. Any future explicit deletion workflow must handle the constraint and require deliberate handling of acquisition/history records. Do not revert to CASCADE as a routine rollback after opportunities are populated; it restores the data-loss risk. No application deployment in this checkpoint.

### Local claim-safety checkpoint — 2026-09-14

Confirmed requirement: ordinary users see their assigned leads plus unassigned New Leads only; another owner's New Lead is hidden. TC and Read Only remain assigned-only within permitted areas. Multiple roles combine; manager exceptions must be explicit rather than inferred from manage_users (Investor and TC currently have that permission).

Fixed local acquisition stage auto-assignment so it never replaces an existing owner. Added shared updateAcquisitionRecord helper for pipeline stage moves and drawer stage/assignment updates. The UPDATE filters company, ID, archived state, expected owner and expected stage in one statement; an outdated claim/move returns an error rather than overwriting the newer owner/stage. Callers stop before writing success history or dispatching automation on rejected updates. UI reports the error and refreshes; successful pipeline moves use the returned database record.

Validation: TypeScript and focused ESLint passed. Mock query checks passed for a second stale claim, company mismatch and a stale stage move. These are not real concurrent Postgres/RLS tests. Existing history writes still occur separately from the successful update; a later transaction is needed for all-or-nothing history. Other edit/import/API paths are not protected by this helper, and current live RLS is still broad.

No live database changes or deployment in this checkpoint. Next: prepare and test database enforcement across acquisition/disposition/management, related records and privileged endpoints, including role-company validation. Coordinate activation with the updated frontend because production currently ignores some failed writes. Do not represent local compare-and-set handling as full access enforcement.

Manual work while paused: identify teammates needing TC only or TC plus Acquisitions Manager; record which current screen handles transactions; identify a few example assigned/unassigned leads for later controlled verification without changing them; keep the master lead spreadsheet intact. Do not run SQL, move leads for tests, or deploy the unfinished access changes.

### Multiple-role local checkpoint — 2026-09-14

User approved additive role access: TC alone should not access Acquisitions; TC plus Acquisitions Manager combines both roles. Read Only and TC see assigned records within permitted areas. Manager roles retain broader access within their areas. No user identity has been selected for reassignment.

Verified live get_user_permissions and has_permission already combine all user_roles memberships. Local Users settings now offers Add role for existing users, preserves memberships, selects company roles, and reports insertion errors. Existing database policies remain authoritative. Users without roles are no longer excluded by an inner join. Invite flow still assigns one initial role; additional roles can be added afterward.

App layout now gates matching navigation/settings routes using existing PermissionGate so a hidden tab cannot simply be opened by its URL. This is UI protection only, not a substitute for database policies.

No live memberships, role permissions, policies, or schema were changed. Remaining: tenant validation on user_roles inserts currently checks the target user's company but not the assigned role's company; permission helpers also do not scope joined roles to current company. Address and verify these before treating role assignment as fully hardened. Map transaction work to actual existing screens (navigation currently has no Transactions tab), then apply TC role changes and ownership policies with role-matrix tests. Do not deploy local changes as completion of the full access-control task.

Manual preparation: list which teammates need TC only versus TC plus Acquisitions Manager; identify the current screen used for transaction work. No passwords or API keys needed. Avoid role changes until permission cleanup is verified.

### Contract handoff and migration audit — 2026-09-14

Read-only review of the deployed automation-engine source, live catalog, six missing migration definitions, and local acquisition callers. No automation was invoked, records moved, migrations replayed, or production code deployed.

Confirmed blockers and implementation references:

1. Local acquisitions/page.tsx stage-change and lead-create callers, and acquisition-drawer.tsx stage/assignment callers, send NEXT_PUBLIC_SUPABASE_ANON_KEY as the bearer token. Deployed automation-engine authenticates with auth.getUser(token), requiring a user session. Callers do not check HTTP response status. A saved stage can therefore be followed by an unnoticed rejected automation request. Source mismatch confirmed; historical request logs were not inspected, so this is not proof of the cause for every existing record.
2. Deployed handleContractExecutedAutomation requires opportunity_id to create a disposition. Live disposition_records.opportunity_id is NOT NULL; every existing acquisition lacks this link. Correcting authentication alone is insufficient.
3. The handler inserts synchronization_events result=success before dependent writes, and ignores errors from multiple writes. A failed first attempt could prevent a subsequent retry from completing. The live synchronization_events table currently has zero rows; this is a prospective failure mode, not an observed stuck event.
4. Task inserts use assigned_to, but the live tasks column is assigned_user_id. Success messages and activity metadata are not tied to verified insert results.
5. Current disposition entry stage is New Deal; the handler hardcodes that name. Desired future entry is New Lead. Preserve the stage identifier and use configured stage semantics instead of relying on display text.
6. The deployed built-in handler fetches the acquisition by ID without company scope and does not establish record-level move authorization before service-role writes. Authenticate the actor AND validate company, ownership/management permission, and destination before enabling a repaired handoff. Do not replace the deployed function with the older local version: deployed authentication differs.

Missing migration review:

- 20260731173112: helper-view restrictions and permission/company helper definitions.
- 20260731173149: restricts direct profile updates to specific self-service columns.
- 20260811183407: email message fields, attachment metadata and storage policies.
- 20260811192041: subscription plans, company billing fields and usage records.
- 20260811192049: company settings, provider-credential table/policies, signup function, and an existing-company data update.
- 20260811194225: earlier agency switching/signup definitions and an existing-profile admin update. Local 20260811194226 is a DIFFERENT follow-up with agency_company_access and membership checks, not a duplicate to substitute blindly.

Migration history is not the final schema: authenticated currently CAN select v_profiles_company despite the earlier revoke. Provider credential policies currently use company scope; assess manager-only access separately without reading credential values. Reconstruct effective functions, grants and policies from the current catalog before designing a test baseline. Do not replay migrations containing data updates on production.

Ordered next implementation checkpoints:

- [x] Identify contract handoff blockers and missing migration scope.
- [ ] Reconcile the local test baseline with effective live schema and deployed function security. Preserve raw migration history as evidence; do not blindly join/replay stored statement fragments.
- [ ] Prepare an additive opportunity-link migration with a dry-run report, preserving acquisition IDs and note/call/history references. Review the two missing property links and five executed-stage records; do not infer contract dates.
- [ ] Implement one authorized database transaction for stage/pipeline move plus required note/history. A transaction means these core changes succeed together or none are saved. Handle notifications separately with retryable delivery.
- [ ] Make retries safe: the same transition request must not create another handoff, contract event, or task. Mark completion only after confirmed success.
- [ ] Connect both existing UI move controls through the same authenticated path and show accurate errors in the existing design.
- [ ] Test cross-company/other-owner denial, failed-write rollback, repeated requests, simultaneous moves, preserved notes/calls, contract reporting and the same deal appearing in Dispositions. Use an isolated test database before a manual release.

No application behavior changes in this audit checkpoint. Existing local UI edits remain uncommitted. This audit does not establish that the app is ready for deployment.

### Read-only live inventory — 2026-09-14

Confirmed connected project reference matches local production configuration: rogtagiiqjbmokhxywpd (user renamed project AcqDis).

Exact counts at inspection: 3,422 contacts; 8,416 properties; 3,637 acquisition records; zero opportunities; zero dispositions; 112 notes; 93 calls.

All acquisitions have contact links. Two lack a property link. All 3,637 lack an opportunity link. No property ID is shared by multiple acquisition records; this does not prove address uniqueness. 4,781 property rows are not linked from acquisitions; other references must be checked before treating them as unused.

All 112 notes use entity_type acquisition_record. Assignment and stage history reference acquisitions with ON DELETE CASCADE. Calls reference acquisitions with ON DELETE SET NULL. Preserve existing IDs or explicitly remap these dependencies before any retirement. Notes/activity entity references also need explicit mapping because they are not ordinary foreign keys.

Five acquisitions occupy Contract Executed, but no acquisition has contract_executed_at populated. Dispositions remain empty. This is a confirmed data mismatch, not proof of its cause. Reconcile these five with stage history and actual contract evidence; do not fabricate execution dates or automatically move production records.

Stage counts: New Lead 1,517; Dead/DNC 1,438; No Answer 600; Answered 30; Offer Declined 18; Waiting for Info/Photos 16; Needs Offer 5; Ready for Proposal 5; Contract Executed 5; Needs Contract 2; Offer Accepted 1. None are archived.

Six live migration versions are absent locally:

- 20260731173112 — 032_secure_auth_helper_views
- 20260731173149 — 033_restrict_profile_column_updates
- 20260811183407 — 032_email_columns_and_attachments
- 20260811192041 — 033_saas_subscriptions_and_usage
- 20260811192049 — 033_saas_multi_tenant_company_settings
- 20260811194225 — 034_agency_admin_and_account_switching

Next: inspect those migration definitions and the current contract transition implementation, then design a reproducible test baseline. Do not replay migrations on production. No live writes in this inventory.

## Local checkpoint: acquisition calling

- Call opens the existing browser-call dialog over the acquisition panel; it no longer navigates to Conversations.
- The new button reloads the contact's saved phone, checks do_not_call, and normalizes the number before showing the call dialog.
- Existing SMS/call conversation is reused, or a call conversation is prepared when none exists. Opening the dialog can therefore create a conversation when used; no real calls or database writes were performed during development.
- Calls from the acquisition panel include acquisition/opportunity identifiers in the existing call-history insert.
- Shared call setup now ignores cancelled async attempts, prevents double starts, clears delayed close timers on unmount, and guards duplicate terminal call-history inserts.
- Live Twilio behavior, microphone permissions, caller ID, call-history persistence and concurrent-user behavior still require an isolated test before pushing. The inherited line-busy check is advisory, not an atomic reservation.
- No database migrations, credential changes or Git pushes in this checkpoint.

## Local checkpoint: note attribution

- Shared NotesSection displays author name, current role(s), and the existing timestamp using the current note-card design.
- Missing/deleted/inaccessible authors or roles show explicit fallback labels without hiding note text.
- Author queries are batched and company-scoped. Outdated load results are ignored when the record changes.
- Note creation, conversation-copy behavior, pinning, deletion and existing data remain unchanged. Full contact/opportunity note synchronization is not completed by this change.
- TypeScript, focused ESLint and diff whitespace checks passed. Live role visibility and visual checks remain pending against a verified test project; no database data or schema was changed.
- Historical roles cannot be reconstructed from current memberships; role-at-creation snapshots require a later schema decision.

## Local checkpoint: acquisition contact editing

- Acquisition panel now has an Edit contact dialog using the existing CRM controls and styling.
- Edits require the existing edit_contacts permission and use company/contact filters; database policies remain authoritative.
- Save updates only changed fields; phone/email normalization is saved with their displayed values. Empty values remain optional.
- Save failures remain visible with the draft retained; Cancel does not write. Successful saves refresh the panel and pipeline.
- Earlier local changes: Opportunity Details label, simulator removal, contact-first layout, saved contract execution date display.
- No Supabase schema changes or production writes were made. Live save/call verification is pending identification of the correct test project. Direct calling inside the opportunity is still a separate unfinished checklist item.

Local migration files describe intended schema history, not proof of the current live database. Do not use whichever Supabase account happens to be connected without matching the application's project reference first. Never include API keys in this document.

No live data deletion, schema deployment, mass merge, or production behavior changes are authorized by this planning document.
