# Incoming call panel and routing review

Local-only change. No calls/messages were sent; no production data, permissions,
secrets, Twilio settings, functions, or deployments were modified.

## Findings

Read-only inspection of the AcqDis production project on September 24–25, 2026:

- The header phone button only retried device errors. It did not open a panel.
  Panel visibility was tied to the call object; Escape/X rejected the call.
- All six Acquisitions Manager users lack `receive_calls` (and `view_calls`).
  Three active numbers, ending 7487, 2719, and 7515, are assigned to users in
  this role. The frontend therefore never registers their incoming Device.
- The deployed `voice-token` version 26 uses `view_calls` for recipient selection
  and legacy view permissions for token access, with unconditional incoming grants.
  The repository already contains the newer `receive_calls`/`make_calls` token
  checks and direction-specific grants, but production does not.
- Existing routing falls back from an ineligible assignee/team to company users.
  That explains calls being offered to other eligible accounts instead of the
  assigned users. It does not prove which browser sessions were registered.
- Four current users qualify under the existing grants (three agency admins and
  one Transaction Coordinator). Company-scoped phone-number SELECT RLS does not
  restrict number discovery to admins. No permission or RLS expansion is needed
  in application code.
- Token and TwiML recipient identities both use `user_` plus the authenticated
  user's UUID with underscores. The supplied `user_id` does not select another
  token identity. Device registration is required independently of panel opening.
- Stored routing metadata for the unassigned main number ending 1356 references
  a different TwiML app from the current company app setting. This is a metadata
  discrepancy, NOT verification of Twilio's actual current configuration.
  Actual Twilio number/application URLs and browser registrations were not inspected.

## Proposed release

- `components/incoming-call-listener.tsx`: existing header icon opens the panel;
  empty/connecting/unavailable/error states; ringing indicator and reopen;
  explicit Answer/Decline/End Call; dismissal changes visibility only. The SDK
  call remains owned by the registered device. Terminal events remove stale
  actions/listeners; duplicate accepts cannot repeat history writes or timers.
  Company/user/permission changes invalidate pending initialization and refresh.
- `supabase/functions/voice-token/index.ts`: separate backend change. Assigned
  lines return only their eligible assignee; assigned teams return only eligible
  members. An ineligible assignment returns no recipients, never a company-wide
  fallback. Shared Acquisition lines ring only eligible members of the existing
  company system role named `Acquisitions Manager` who have no assigned number.
  Even an inactive number assignment excludes a user from shared routing. There
  is no generic company-wide fallback. Other team routes remain company-scoped.
  `receive_calls`, company isolation, and the existing agency-admin exception remain.
- `scripts/tests/incoming-call-window.cjs`, `scripts/tests/inbound-routing.cjs`,
  and `package.json`: mocked UI, authorization, identity and routing regression tests.
- The existing tracked `package-lock.json` and jsdom development dependency are
  required. No new dependency versions or lockfile edits are needed for this change.

Outbound calling, its minimize provider, notes, recording callbacks, and existing
call history components are not edited. The inbound accepted-call history write
keeps its existing fields and adds company, direction, status, and unassigned-owner
guards. A delayed accepted-call write can fill the winner of a completed short
call without reopening it or replacing an existing owner.

The confirmed membership rule is automatic: Acquisition-role users without an
assigned number belong to the shared Acquisition number. No new team membership
is invented. With current assignments, a reviewed `receive_calls` grant enables
three dedicated recipients and three shared recipients, not all six on the main
line. Assignment is not an authorization bypass. The separate review-only file
`scripts/review/incoming-call-permissions.sql` scopes the grant to this company's
existing Acquisition role and defaults to ROLLBACK. It has NOT been executed.
Role-name changes require a routing review because the existing system role name
is used to identify membership.

## Event and routing limits

The client removes an offer on Twilio `cancel`, `reject`, or `disconnect`. In a
multi-recipient call, answering elsewhere must cancel losing offers through
Twilio; tests simulate that event, not a real Twilio fan-out.
See [Twilio Call events](https://www.twilio.com/docs/voice/sdks/javascript/twiliocall#events).
Twilio delivers eligible identities to registered reachable devices. A single
multi-client Dial uses Twilio's first-answer arbitration; losing offers are
canceled and their panels close on the SDK event. Explicit Decline uses local
`Call.ignore()` so it does not hang up the caller or other recipients. This is
device-local: multiple tabs/devices for the same user need staging verification.
See [Twilio Client Dial](https://www.twilio.com/docs/voice/twiml/client).
More than ten recipients now fails closed explicitly rather than silently
omitting users; a larger group requires a separately reviewed routing design.

## Eventual operator-controlled release order

1. Review the role grants and number assignments. Independently inspect Twilio's
   actual incoming-number application association and Voice Request URL, especially
   the main number's differing stored app. Do not run `configure_inbound` merely
   to inspect it: that action writes Twilio settings.
2. In an approved staging environment, deploy the reviewed local `voice-token`
   source (including its already-tracked direction-specific permission checks).
   Retain the existing webhook JWT configuration and signature validation.
   No schema migration or secret change is required by this patch.
3. Apply only the reviewed `receive_calls` grants through normal role management,
   retaining the intended number assignments. Without the grants, the assigned
   numbers intentionally have no eligible recipient under the stricter rule.
4. Publish the reviewed frontend build. Users must refresh/sign in again to load
   permissions and register with fresh tokens.
5. With explicit approval for test calls, verify two eligible user sessions plus
   an unauthorized session: assigned line, shared main line, decline, answer on
   the other session, remote cancellation/hangup, mute, recordings/history, and
   outbound minimize/restore with note saving. Check keyboard and small screens.
6. Only after review and staging sign-off should the operator repeat the release
   in production. Nothing in this document authorizes automatic deployment.

## Validation

**Overall status: NOT READY TO PUSH.** Local validation passes, but the intended
production delivery requires reviewed permission grants, verification of actual
Twilio configuration, and approved staging call tests. No live-call success is claimed.

The exact release was assembled from Git HEAD
`943e9103a402fa79e08e9c17a30c0e91d701e8a6` plus the five code/test/package changes
listed above, with the unchanged tracked lockfile. Final routing and history
updates were copied into that release before repeating checks. It was checked in an isolated
temporary directory using `npm ci --ignore-scripts --no-audit --no-fund`.
The unrelated working-tree changes to `tsconfig.json` and
`supabase/functions/automation-engine/index.ts`, `opencode.json`, and
`supabase/.temp/` were excluded and preserved in the original workspace.
The clean release used the committed ES5 TypeScript target, not the local ES2015
edit. All six source/package/lockfile inputs were hash-compared after validation
and again after resuming work; they match the tested release.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Fresh locked dependency installation | PASS | 572 packages installed in the isolated copy. The initial sandbox attempt was blocked; the approved network-enabled retry passed. |
| Incoming panel and routing regressions | PASS | 36 mocked tests: eligible/unauthorized identities, shared role membership and dedicated exclusivity, simultaneous answers in both orders, recipient-local decline, caller cancellation, stale alerts, winner history guards, empty/unavailable states, dismissal/reopen, duplicate listeners and token/company races. Twilio arbitration is a contract mock, not live proof. |
| Existing outbound call-window suite | PASS | All 31 tests, including minimize/restore, note saving, drawer reopening, completion, mute, and explicit End Call. |
| Existing voice-permission checks | PASS | Direction-specific grants, view-only denial, and existing agency-admin behavior. |
| TypeScript | PASS | `npm run typecheck` in both workspace and isolated release. |
| Relevant lint | PASS | Incoming component, both new test files, and voice-token function; no warnings/errors. |
| Production build | PASS | Isolated `npm run build`; all 40 pages generated. Dummy Supabase build values used; nothing deployed. Network access was needed for the existing Google Fonts download. |
| Build warnings | PASS with warnings | Outdated Browserslist data and Supabase realtime dynamic-dependency warning; no build failure. |
| Diff whitespace and release input consistency | PASS | `git diff --check` and matching file hashes. |
| Production configuration investigation | PASS, read-only | Role permissions, number assignments, company policies, deployed function source and stored app metadata inspected. No mutations. |
| Real Twilio device registration and multi-user delivery | NOT TESTED | Browser sessions/actual Twilio configuration and live fan-out were not verified. Mocks cannot prove these. |
| Live audio, recordings, cancellation of losing Twilio legs | NOT TESTED | Requires explicitly approved staging calls. Recording parameters/history writes were verified only with mocks. |
| Browser visual/keyboard checks on small screens | NOT TESTED | DOM tests cover dismissal/focus behavior; no rendered-browser layout inspection was performed. |
| Staging/production deployment | NOT TESTED | No deployment, commit, push, role grant, schema change, or Twilio setting change was performed. |

Reproduction commands (run against the reviewed release):

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run test:incoming-calls
npm run test:call-window
node scripts/tests/voice-permissions.cjs
npm run typecheck
npm run lint -- --file components/incoming-call-listener.tsx --file scripts/tests/incoming-call-window.cjs --file scripts/tests/inbound-routing.cjs --file supabase/functions/voice-token/index.ts
npm run build
```

Resume inspection preserved completed work and unrelated edits. Final checks were
repeated because the subsequently confirmed membership and cancellation rules
required additional focused changes, not merely because work was interrupted.
