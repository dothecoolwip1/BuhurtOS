# BuhurtOS Build Plan

Last updated: 2026-09-24

## Recovery provenance

The original checkpoint documents were missing from `main` when Pack 2 began. This plan was reconstructed from the current repository, README, migration history, tests, and recent Git history. It is intentionally conservative and does not claim work that is not present in the repository.

Pack 1 evidence includes these completed commits:

* `8353463de61f46a03c88f0463368015eaaf9c461` completed the Pack 1 identity and database foundation.
* `6099f90f0bda96557d9f00eb8b05f63adda36393` completed Pack 1 identity CRUD and workflow tests.
* `ef5a8c72785e94cbf1717f58fbc4a7591d08048b` hardened anonymous privileges.
* `c0313e009636e03da45508cfb6be72a02f058bdf` completed audit actor stamping.
* `90dad7a0554fe8c911b64b3d6ac55bff608e3dc6` completed organization and season lifecycle administration.
* `32240b2d6b8130a317ce5815a09e6d52d1bcac11` added the deterministic dependency lockfile and is the Pack 2 base commit.

## Pack 1: Foundation and identity

Status: completed before this checkpoint reconstruction.

Repository evidence shows:

* PostgreSQL and Supabase foundation schema.
* Organizations, seasons, events, teams, fighters, canonical fighter identities, clubs, affiliations, competition divisions, and event divisions.
* Audit stamping and soft deletion support for applicable foundation records.
* Ruleset administration and inheritance.
* First-run setup for organization, season, and event creation.
* RLS and Data API privilege hardening for Pack 1 tables.
* pgTAP identity workflow coverage and frontend quality checks.

Do not replace or redesign these foundations while completing Pack 2 unless a security defect requires a targeted change.

## Pack 2: Accounts and permissions

Status: completed and merged to `main` in PR #4. Final Pack 2 head `bef3d41c7fd509269535f13a85b2555961edd483` passed the combined frontend and local Supabase CI workflow.

Scope is deliberately limited to account and access control work:

* Account creation using Supabase Auth.
* Email verification and verification resend.
* Password sign-in and sign-out.
* Password recovery and password update.
* Existing-account magic-link sign-in without implicit account creation.
* Session restoration, refresh, expiry, and signed-out states.
* Internal-only return paths to prevent open redirects.
* Organization, event, official, team captain, fighter, and public access boundaries.
* Server-enforced role assignment and revocation.
* Protection against self-escalation and reopening the first-admin bootstrap.
* RLS protection for private account, membership, operational, and storage records.
* Deliberately limited public event and roster columns.
* Separation of the anonymous public data client from the authenticated operations client.
* Direct authorization tests for unrelated organizations, revoked memberships, anonymous users, ordinary members, administrators, officials, fighters, and missing identity context.
* No automatic invitation email delivery in this pack. Event access assignment only targets an existing BuhurtOS account.

Pack 2 is complete only when both GitHub Actions jobs pass on the final Pack 2 head:

1. Typecheck, tests and production build.
2. Rebuild and test Supabase schema.

Any hosted Supabase deployment or email delivery check that cannot be performed against a dedicated BuhurtOS project must remain explicitly unverified.

## Pack 3: Fighter identities

Status: completed and merged to `main` in PR #6. Implementation head `2ffab73e9e403ab8c0325ef18a441ed5fe09319e` passed GitHub Actions workflow `35954642255` before merge commit `e6fde086939f3c4e74353affb5a82a4aa1977a45`.

Scope completed:

* Permanent fighter identity IDs independent from login accounts, names, teams, clubs, and organizations.
* Authenticated self and guardian account links separated from the sporting identity.
* Public, members-only, and private profile visibility enforced by row-level security and column grants.
* Separate private administrative profiles for legal name, birth date, contact, emergency, and guardian information.
* Youth public-profile protection requiring verified guardian consent when a recorded birth date identifies the fighter as under 18.
* Optimistic public and private profile revisions that reject stale-device overwrites.
* Historical display-name aliases and duplicate suggestions without automatic merging.
* Existing-record claim workflows with approval, rejection, cancellation, dispute escalation, and audited ownership transfer.
* Merge requests separated from merge approval. A platform super administrator other than the requester performs the final review.
* Transactional merge conflict checks for changed revisions and conflicting verified owners.
* Historical roster and result references preserved instead of rewritten during identity merges.
* Archived duplicate identities and organization fighter rows retained with canonical provenance.
* Dated team, club, independent, mercenary, and guest affiliation history.
* Direct browser writes removed from identity and affiliation mutation paths in favor of authorized RPCs.
* Compatibility synchronization for trusted legacy `fighter_identities.user_id` ownership records.
* Self-service fighter identity UI and administrator claim/merge review UI.
* Pack 3 unit and pgTAP coverage, including 49 identity-specific database assertions plus the preserved Pack 1 and Pack 2 suites.

Pack 3 verification requires both repository CI jobs:

1. Typecheck, tests and production build.
2. Clean Supabase startup, database reset from all migrations, and all pgTAP database tests.

Hosted Supabase application remains intentionally unverified until a dedicated BuhurtOS Supabase project exists.

## Mega Pack 4: Production hardening and release readiness

Status: implementation complete in pull request #8. Verified implementation head `07107630551711945284cabfac3de1c3ca86cc58` passed GitHub Actions workflow `35999176785`, including typecheck, all frontend tests, production build, a clean Supabase rebuild from every migration, and all pgTAP suites.

Scope completed:

* Hardened the service worker so private or cross-origin authenticated API responses are not cached.
* Aligned organization-administrator RLS writes with the permissions exposed by secured operations screens.
* Added optimistic concurrency guards for event settings, roster clearances, tournament fields, registration review, and fight-card ordering.
* Preserved explicit conflict resolution for offline reconnects instead of last-write-wins behavior.
* Added token-protected private waiver upload with validation, safe replacement, and audit logging.
* Added a fail-closed registration checkout endpoint. Paid registration checkout remains unavailable until a real payment provider and verified webhook are configured.
* Removed or replaced showcase controls that appeared functional but did not perform real work.
* Added offline failure/conflict and scoring/stream abuse regression coverage.
* Added deterministic dependency installation with a committed lockfile and `npm ci`.
* Added route-level code splitting, disabled production source maps, and reduced the initial minified JavaScript bundle from about 510 kB to about 312 kB.
* Added installable PWA icons, manifest metadata, and targeted accessibility improvements.
* Documented hosted-production dependencies in `docs/MEGA_PACK_4_RELEASE.md`.

Mega Pack 4 local verification is complete. Hosted production verification remains intentionally separate because no dedicated BuhurtOS Supabase project has been confirmed.

## Pack 5: Rulesets, divisions and seasons

Status: completed and merged to `main` in PR #9. Verified implementation head `d357c6414edeabc2f0034c420207ca1d29fa36ae` passed GitHub Actions workflow `36069252396` before merge commit `178874356d4a8c4076d1deaa3ffd742d6490f515`.

Scope completed:

* Governed ruleset lifecycle covering draft, review, publish, and retire.
* Immutable published and retired ruleset versions with same-organization inheritance and cycle protection.
* Public source provenance separated from private drafting evidence.
* Separate eligibility, scoring, tournament, and ranking policy domains.
* Effective windows plus explicit audited event exceptions.
* Immutable event ruleset snapshots containing resolved policy, inheritance, and provenance.
* Versioned competition divisions with age, weight, experience, team-size, declaration, and custom eligibility constraints.
* Explainable eligibility decisions that return needs-review when required facts are missing.
* Governed event-division assignment with immutable division and ruleset snapshots.
* Season date boundaries, default published rulesets, ranking policy, guarded lifecycle, and event-boundary enforcement.
* New-event inheritance of season defaults with snapshot locking before governed competition.
* Brackets and matches retain division and ruleset snapshot references.
* Generated competition uses the locked division ruleset scoring, and conflicting scoring overrides are rejected.
* Approved policy exceptions are immutable and revocations are audited.
* PostgreSQL validation rejects malformed eligibility and invalid scoring configuration.
* RLS and explicit Data API grants protect new Pack 5 tables and cross-organization writes.
* Current source-backed competition formats are distinguished from configurable organization templates.
* Frontend and pgTAP regression coverage for lifecycle transitions, snapshots, RLS, conflicts, exceptions, scoring, eligibility, and historical preservation.

Pack 5 verification requires both repository CI jobs:

1. Typecheck, tests and production build.
2. Clean Supabase startup, database reset from all migrations, and all pgTAP database tests.

Workflow `36069252396` passed both jobs on the verified implementation head. Hosted Supabase verification remains separate until a dedicated BuhurtOS project is selected.

## Later packs

Later product work should start from the verified Pack 5 checkpoint. Preserve the completed identity, authorization, release-hardening, governance, division, and season foundations unless a targeted defect requires change.

Before starting a later pack:

* Read `BUHURTOS_STATUS.md`.
* Read `BUHURTOS_HANDOFF.md`.
* Confirm Pack 5 CI is green on verified implementation head `d357c6414edeabc2f0034c420207ca1d29fa36ae` and that PR #9 is merged.
* Confirm a dedicated BuhurtOS Supabase project is selected before applying migrations remotely.
