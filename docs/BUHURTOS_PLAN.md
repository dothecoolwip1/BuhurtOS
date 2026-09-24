# BuhurtOS Build Plan

Last updated: 2026-09-23

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

## Later packs

Later product work is out of scope for Pack 3. Do not add tournament features, ranking features, streaming features, new competition workflows, or unrelated visual redesigns while closing this pack.

Before starting a later pack:

* Read `BUHURTOS_STATUS.md`.
* Read `BUHURTOS_HANDOFF.md`.
* Confirm Pack 3 CI is green on the verified implementation head and that PR #6 is merged.
* Confirm a dedicated BuhurtOS Supabase project is selected before applying migrations remotely.
