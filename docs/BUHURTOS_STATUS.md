# BuhurtOS Status

Last updated: 2026-09-24

## Current recovery point

Repository: `dothecoolwip1/BuhurtOS`

Base branch: `main`

Pack 2 branch: `pack2-accounts-permissions` (merged)

Pack 2 pull request: #4, `Complete Pack 2 accounts and permissions` (merged)

Pack 2 base commit: `32240b2d6b8130a317ce5815a09e6d52d1bcac11`

Pack 3 branch: `pack3-fighter-identities` (merged)

Pack 3 pull request: #6, `Complete Pack 3 fighter identities` (merged)

Pack 3 verified implementation head: `2ffab73e9e403ab8c0325ef18a441ed5fe09319e`

Pack 3 merge commit: `e6fde086939f3c4e74353affb5a82a4aa1977a45`

Pack 3 successful pre-merge workflow: `35954642255`

Mega Pack 4 branch: `mega4-production-hardening`

Mega Pack 4 pull request: #8, `Mega Pack 4: production hardening and release readiness`

Mega Pack 4 verified implementation head: `07107630551711945284cabfac3de1c3ca86cc58`

Mega Pack 4 successful verification workflow: `35999176785`

The original `BUHURTOS_PLAN.md`, `BUHURTOS_STATUS.md`, and `BUHURTOS_HANDOFF.md` files were absent from `main` at the start of Pack 2. These files were reconstructed from repository evidence rather than guessed historical content.

## Completed before Pack 2

Pack 1 foundation work is present and must be preserved:

* Canonical identity, clubs, affiliations, divisions, organization, season, event, team, and fighter foundations.
* Ruleset administration.
* Audit actor stamping.
* Anonymous privilege hardening.
* Organization and season lifecycle administration.
* Frontend and pgTAP coverage associated with those foundations.

## Pack 2 completed and merged

Account lifecycle:

* Password sign-in and sign-out.
* Self-service signup with display-name profile bootstrap.
* Verification redirect and verification resend.
* Password recovery and new-password update.
* Magic-link sign-in configured not to create unknown users.
* PKCE Auth flow for browser callbacks.
* Safe internal return paths restricted to `/ops`.
* Distinct loading, verification, recovery, success, failure, signed-out, and session-ended states.
* Auth context refresh on operational reload so revoked memberships do not remain trusted in client state.

Authorization:

* Direct writes to platform, organization, and event membership tables are removed from the authenticated browser role.
* Role changes go through server-authorized functions.
* Organization administrators can manage staff but cannot promote organization administrators.
* Event organizers can manage lower event roles but cannot mint another organizer or mutate their own event role.
* Organization or platform administrators can assign event organizers.
* Platform administrator role operations reject self-mutation and protect the last super administrator.
* The first-super-admin bootstrap now records a permanent sentinel and cannot reopen if membership rows are later removed.
* Role assignment and revocation are audited.

Public and private data:

* Public requests use a separate anonymous Supabase client rather than inheriting the signed-in account token.
* Anonymous event, fight-card, bracket, match, announcement, and roster access is controlled by published-event RLS.
* Anonymous grants expose only deliberate public event and roster columns.
* Private event notes, clearance flags, metadata, account profiles, membership tables, fighter account links, and affiliation records are not anonymously readable.
* Authenticated private event access is scoped by organization and event membership.
* Fighter roster access is limited to the fighter's own row.
* Team captain roster access is limited to that captain's team.
* Officials and authorized administrators retain operational roster access.
* Waiver storage remains private and has no anonymous object policy.

Existing-account event assignment:

* The previously referenced `invite-event-member` function is now implemented.
* It performs authenticated caller verification.
* Email-to-account lookup uses the Supabase service role only inside the Edge Function runtime.
* Final role assignment is still authorized by the caller's JWT through the database RPC.
* It sends no invitation email. Unknown users are told to create and verify their own BuhurtOS account first.

## Pack 3 completed and merged

Permanent fighter identity:

* Fighter identity IDs remain stable across login changes, name changes, team changes, and organization changes.
* Login ownership is represented by `fighter_identity_accounts` rather than using frontend-visible fields as an authorization boundary.
* Self and guardian relationships can be verified independently.
* Historical aliases are retained for renamed fighters.
* Trusted legacy `fighter_identities.user_id` records synchronize into the Pack 3 account-link model for backward compatibility.

Profile privacy and youth handling:

* Public sporting fields and private administrative fields are stored separately.
* Anonymous reads are limited to deliberately public active fighter identities and deliberately public aliases.
* Private legal, birth, contact, emergency, and guardian details have no anonymous grants.
* Recorded youth profiles cannot be made public without guardian consent recorded by a verified guardian or platform administrator.
* Public and private profile writes use revision checks so stale clients fail instead of silently overwriting newer changes.
* Platform administrators can inspect archived identity provenance after merges; ordinary and public reads cannot.

Claims and disputes:

* Signed-in users can search only claimable identity summaries.
* Self and guardian claims are explicit records with versions and audit history.
* A competing self claim becomes disputed rather than displacing the current owner.
* Normal claims can be reviewed by an appropriately scoped identity administrator.
* Disputed ownership requires platform administrator resolution.
* Rejected claims can be challenged with a dispute reason.
* Superseded account links are revoked rather than deleted.

Duplicate handling and merges:

* Duplicate detection returns review suggestions based on normalized names, aliases, and nicknames and never merges automatically.
* Organization administrators can request a merge only when both identities are within an organization they administer.
* Final merge approval requires a different platform super administrator.
* Merge reviews snapshot profile revisions and reject concurrent edits.
* Different verified self owners block the merge transaction.
* Historical event roster references remain on their original fighter rows.
* Duplicate organization fighter rows and identity rows are archived with canonical pointers rather than deleted.
* Alias, affiliation, account-link, audit, and provenance data are retained.

Affiliation history:

* Affiliation creation and ending now use authorized RPCs.
* Starting a new open primary affiliation closes the prior primary period without deleting it.
* Current fighter team membership follows the active primary affiliation while dated history remains intact.

UI:

* `/ops/identity` provides fighter self-service creation, public profile editing, private detail editing, claim search, and claim history.
* `/ops/identity-review` provides administrator claim review, duplicate suggestions, merge requests, and platform merge review.
* The older foundation merge control now requests review rather than executing a direct merge.

## Mega Pack 4 implementation complete

Production security and privacy:

* The PWA service worker caches only same-origin application navigation and static assets and excludes authorization-bearing requests.
* Organization-administrator operational writes are aligned between application permissions and RLS.
* Public waiver upload is implemented as a token-protected Edge Function using private Storage.
* Registration checkout validates the registration capability token and fails closed when no payment provider exists.
* Production source maps are disabled.

Concurrency and field reliability:

* Event settings, roster clearances, field configuration, registration review, and fight-card reorder operations use server-side expected-version guards.
* Existing match-status and result-submission concurrency guards remain in place.
* Offline mutations preserve their base version and surface conflicts for explicit retry or discard.
* Event-setting changes are included in realtime subscriptions.

Release UX and performance:

* Misleading showcase-only controls were replaced by working search, share, export, navigation, or explicit read-only states.
* Route-level code splitting reduced the initial minified JavaScript bundle from about 510 kB to about 312 kB.
* The PWA now includes 192px and 512px icons and updated install metadata.
* Score-dialog controls include accessible labels and live validation messaging.

Verification:

* Implementation head `07107630551711945284cabfac3de1c3ca86cc58` passed GitHub Actions workflow `35999176785`.
* The frontend job passed TypeScript, unit/regression tests, and the production Vite build.
* The database job started local Supabase, rebuilt the schema from all migrations, and passed all pgTAP suites including Mega Pack 4 concurrency and RLS abuse tests.

## Pack 5 completed and merged

Governed rulesets:

* Rulesets move through draft, review, published, and retired states.
* Published and retired versions are historical records and cannot be silently rewritten.
* Parent inheritance is restricted to valid same-organization chains and protects against cycles.
* Effective settings are snapshotted for events so later ruleset versions do not rewrite historical competition.
* Eligibility, scoring, tournament, and ranking policy are modeled as separate domains.
* Public provenance is retained separately from internal drafting notes.
* Out-of-window use requires an explicit audited event exception.
* Approved exception details are immutable; revocation is explicit and audited.

Divisions and eligibility:

* Competition divisions are versioned and can express age, weight, experience, team-size, declaration, and custom requirements.
* Missing required facts produce a needs-review result rather than a silent pass.
* Event divisions capture immutable division and effective-ruleset snapshots.
* Current source-backed BI format classifications are distinguished from organization-defined configurable templates.

Seasons and competition history:

* Seasons have enforced boundaries, default published rulesets, ranking policy, and guarded lifecycle transitions.
* New events can inherit the season default, but governed competition locks an immutable snapshot.
* Brackets and matches retain their division and ruleset snapshot references.
* Bracket generation uses the selected event division's locked scoring policy.
* Database validation rejects scoring overrides that contradict the locked ruleset.

Security and verification:

* Pack 5 tables and mutations are protected by RLS plus explicit Data API grants.
* Cross-organization mutation attempts are filtered or rejected without changing protected records.
* Invalid scoring and malformed eligibility configuration are rejected at the PostgreSQL boundary.
* Verified implementation head `d357c6414edeabc2f0034c420207ca1d29fa36ae` passed GitHub Actions workflow `36069252396`.
* The frontend job passed TypeScript, all unit/regression tests, and the production Vite build.
* The database job rebuilt Supabase from every migration and passed all pgTAP suites.
* PR #9 merged Pack 5 to `main` as `178874356d4a8c4076d1deaa3ffd742d6490f515`.

## Verification status

Verified in GitHub Actions on an earlier Pack 2 branch head:

* TypeScript typecheck passed.
* Existing frontend/unit tests passed.
* Production Vite build passed.

Added for final Pack 2 verification:

* `tests/auth.test.ts` covers safe redirects and signed-out versus expired-session messaging.
* `supabase/tests/database/accounts_permissions.test.sql` performs direct anonymous and authenticated access attempts across two unrelated organizations and includes revoked membership and self-escalation cases.
* The repository CI rebuilds local Supabase from all migrations and runs pgTAP tests.

Final Pack 2 head `bef3d41c7fd509269535f13a85b2555961edd483` passed GitHub Actions workflow run `35945001693`. Pack 3 implementation head `2ffab73e9e403ab8c0325ef18a441ed5fe09319e` then passed GitHub Actions workflow run `35954642255`, including frontend checks, a clean rebuild through the Pack 3 migration, and all database tests. PR #6 merged that verified implementation as `e6fde086939f3c4e74353affb5a82a4aa1977a45`. Mega Pack 4 implementation head `07107630551711945284cabfac3de1c3ca86cc58` passed workflow `35999176785` with frontend, production-build, clean-migration, and pgTAP verification. Pack 5 implementation head `d357c6414edeabc2f0034c420207ca1d29fa36ae` passed workflow `36069252396` with the same frontend and clean-database verification, then merged in PR #9 as `178874356d4a8c4076d1deaa3ffd742d6490f515`.

## Explicitly unverified infrastructure

A connected Supabase project was inspected during Pack 2 and was identified as a different Northborn/Mallard/Reavers database, not a dedicated BuhurtOS database. No BuhurtOS migration was applied to it.

Until a dedicated BuhurtOS project is available, these remain unverified:

* Remote migration application.
* Hosted Auth redirect allowlist configuration.
* Real verification-email delivery.
* Real password-recovery email delivery.
* Deployed `invite-event-member` Edge Function behavior.
* Hosted JWT expiry and refresh behavior through the Supabase gateway.
* Hosted waiver Storage behavior.
* Deployed `upload-waiver` behavior.
* Deployed `create-registration-checkout` behavior.
* Real payment-provider checkout and webhook reconciliation.
* Real multi-device reconnect behavior on hosted infrastructure.

These are infrastructure verification items, not claims of successful production deployment.
