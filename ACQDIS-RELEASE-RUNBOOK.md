# AcqDis local release runbook

Release record updated 2026-09-15. Production rollout was explicitly approved. No real call or SMS was used for verification.

## Review order

1. Save a private export of `acquisition_records`, `opportunities`, `disposition_records`, stage history, assignment history, notes, activities, calls, tasks, files, offers, conversations, and messages. Keep IDs unchanged.
2. Run `OPPORTUNITY-BACKFILL-REVIEW.sql`. Stop on any UUID collision, cross-company link, unmapped stage, or count mismatch.
3. Run `CONTRACT-RECONCILIATION-REVIEW.sql`. Human-confirm every proposed execution timestamp and actor; leave rows blank when evidence is missing.
4. Apply the local migrations in this order: `20260914223012_acqdis_opportunity_foundation.sql`, `20260914223649_atomic_pipeline_moves.sql`, `20260914224000_pipeline_stage_customization.sql`, `20260914225603_address_duplicate_review.sql`, `20260914230926_reporting_attribution.sql`, then `20260915101500_backfill_contract_handoffs.sql`.
5. Deploy Edge Functions only after the schema migrations succeed. Preserve the exact public callback URLs in `TWILIO_SMS_WEBHOOK_URL`, `TWILIO_SMS_STATUS_CALLBACK_URL`, `TWILIO_VOICE_WEBHOOK_URL`, `TWILIO_RECORDING_CALLBACK_URL`, and `TWILIO_INBOUND_STATUS_CALLBACK_URL` so signature checks use the same URLs Twilio signs.
6. Deploy the application after database and Edge Function checks pass.

## Completed production rollout

- Private snapshot: `acqdis_backup_20260915_release1`; 24 table counts matched, totaling 26,084 rows.
- Reconciliation: 3,637 acquisitions, two deliberately null property links, zero UUID collisions, zero cross-company links, and seven evidence-backed Contract Executed records.
- Database: all six release migrations applied and recorded in `supabase_migrations.schema_migrations`.
- Verification: 3,637 acquisitions and opportunities are linked, seven active unassigned Dispositions / New Lead handoffs exist, all 8,416 property addresses are normalized, and the repeat-address queue starts empty for future submissions.
- Edge Functions: `automation-engine`, `sms-provider`, and `voice-token` deployed successfully through the authenticated AcqDis dashboard.
- Local release checks: TypeScript, ESLint, Edge syntax, whitespace, and the 40-route production build pass. The build retains only the existing Browserslist freshness and Supabase Realtime bundler warnings.
- Remaining: push the application commit and run the controlled live checks below.

## Stop conditions

- Any source/backfill count mismatch.
- Any existing opportunity UUID collision.
- Any cross-company contact, property, opportunity, owner, or stage link.
- Any acquisition stage without an explicit opportunity-status mapping.
- Any Contract Executed record without confirmed timestamp evidence.
- Any RLS test that exposes another user’s assigned lead.
- Any Twilio request accepted without a valid user/service credential or Twilio signature.

## Required verification

- Ordinary acquisitions user sees unassigned New Leads plus their own assigned leads only.
- Ordinary dispositions user sees unassigned New Leads plus their own assigned deals only.
- Managers with the explicit view-all permission see their company’s full pipeline.
- Two users cannot claim or move the same stale record.
- Every manual stage move accepts an optional note and records the actor, old stage, new stage, timestamp, and a user-entered or automatic reason atomically.
- Manual Management moves follow the same rule; automated pipeline synchronization records a system reason.
- Contract Executed creates one active Dispositions / New Lead record with the same opportunity ID and does not create a second copy on retry.
- The new Dispositions / New Lead is unassigned and visible to eligible disposition operators; the acquisition owner remains preserved on the shared opportunity.
- Moving either linked pipeline to Dead/DNC moves the other linked record to its dead stage in the same transaction and records automatic history.
- Same normalized address creates a review item while preserving unit distinctions and both original records.
- Opted-out contacts cannot be queued or sent SMS.
- Inbound non-opt-out replies create one open follow-up task and one unread in-app alert per recipient.
- Twilio retries do not duplicate inbound messages, and a late callback cannot downgrade a delivered message.
- A verified number can enable incoming calls without affecting ordinary number sync; assigned user/team routing works and falls back only to active users with call permission.
- The app-shell call device registers once, refreshes its token, identifies known callers, records the answering user, and creates one missed-call alert per routed recipient.
- Dashboard dials exclude simulated calls and de-duplicate by provider call SID.
- Executed contracts remain attributed to the preserved execution actor after reassignment.

## Recovery approach

Do not delete backfilled opportunities. If release verification fails, roll the application and Edge Functions back first, disable the new stage-move entry points, and preserve all newly created records for review. Restore RLS/function definitions from the pre-release schema export only after checking that doing so will not hide or orphan post-release activity. Correct forward with a new migration whenever data was written after release.
