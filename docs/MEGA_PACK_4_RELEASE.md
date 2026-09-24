# Mega Pack 4 Release Readiness

Last updated: 2026-09-24

## Status

Mega Pack 4 is the final production hardening, abuse testing, QA, security, performance, and release-readiness pass.

Working branch: `mega4-production-hardening`

Pull request: #8, `Mega Pack 4: production hardening and release readiness`

Verified Mega Pack 4 implementation head: `07107630551711945284cabfac3de1c3ca86cc58`

Verified workflow: `35999176785`

The workflow passed the frontend typecheck, all frontend tests, the production Vite build, a clean Supabase rebuild from every migration, and all pgTAP suites.

## Security and privacy hardening

* The service worker no longer caches cross-origin Data API traffic or requests carrying authorization headers.
* Only same-origin navigation and static application assets are eligible for PWA caching.
* Organization-admin database write policies now match the permissions the application already grants for event operations.
* Anonymous and unrelated-organization boundaries remain enforced by RLS and column grants.
* Public waiver upload uses a high-entropy registration capability token, validates file type and size, stores files in the private waiver bucket, replaces old files safely, and records an audit event.
* Public payment checkout validates the registration capability token and fails closed when no payment provider is configured. It does not create a fake charge or fake success state.
* Insecure livestream URLs are rejected by the guarded event settings mutation.

## Multi-device and offline hardening

Guarded server mutations now reject stale writes for:

* Event settings.
* Roster clearance flags.
* Tournament-field configuration.
* Registration review.
* Fight-card reordering.
* Match status and result submission already had expected-state guards and remain protected.

Offline work retains its original record version. Reconnect conflicts are kept in the queue for an explicit person-controlled retry or discard instead of silently overwriting newer server data.

## RLS and authorization alignment

The release hardening migration aligns organization-admin permissions with the secured application UI for:

* Fight cards.
* Brackets and bracket participants.
* Match rounds and side members.
* Announcements.
* Discipline.
* Marshal-visible notes.

Team-only notes remain team-scoped.

## Public and showcase UX

Controls that looked actionable but did not perform real work were removed or replaced.

* Team and fighter search/filter controls now work.
* Team and fighter share controls now use the Web Share API with clipboard fallback.
* Showcase rankings export a real CSV.
* Showcase administration actions now route to the secured operational workflow that owns the mutation.
* Profile and event settings showcase screens are explicitly read-only when they are not connected to a real write workflow.
* Spectator navigation now links to real sections and routes.

## Build and PWA release hardening

* `package-lock.json` is committed.
* CI and deployment use `npm ci`.
* Route pages are loaded lazily to reduce initial JavaScript. The initial minified JavaScript bundle decreased from about 510 kB to about 312 kB.
* Production source maps are disabled.
* Installable 192px and 512px application icons are included.
* The web app manifest has an app id, categories, and maskable icon declarations.
* Score-dialog icon controls and score inputs have accessible names and validation errors use alert/live regions.

## Automated release coverage

Mega Pack 4 adds database tests for:

* Organization-admin write alignment.
* Unrelated-organization denial.
* Stale event settings.
* Stale roster clearance.
* Unsupported roster fields.
* Stale field configuration.
* Stale fight-card ordering.
* Stale registration decisions.
* Anonymous denial of guarded mutations.
* Event settings realtime publication.

Frontend tests add coverage for:

* Offline conflicts staying queued until explicit retry.
* Unexpected sync errors retaining field work.
* Duplicate, negative, and non-finite score abuse.
* Required forfeit reasons.
* Unsafe and unsupported stream URL rejection.

## Required hosted verification before a real production launch

A dedicated BuhurtOS Supabase project is still required. The Supabase project previously inspected contains unrelated Northborn, Mallard, and Reavers data and must not receive BuhurtOS migrations.

The following items remain explicitly unverified until a dedicated BuhurtOS project exists:

1. Apply the full migration history to an isolated hosted BuhurtOS project.
2. Run hosted Supabase database and security advisors.
3. Configure and verify Auth redirect allowlists.
4. Verify real signup, verification, password recovery, refresh, and expired-session behavior.
5. Deploy and verify `invite-event-member`.
6. Deploy and verify `upload-waiver` against hosted private Storage.
7. Deploy and verify `create-registration-checkout`.
8. Connect a real payment provider and verified webhook before accepting paid registrations.
9. Verify RLS through hosted JWT sessions using isolated unrelated organizations and every operational role.
10. Perform real multi-device reconnect testing on at least two field devices.
11. Confirm production domain, TLS, analytics/privacy requirements, backup policy, and incident ownership.

No hosted deployment claim should be made until these items are completed.
