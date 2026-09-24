# BuhurtOS Build Plan

Last reconstructed: 2026-09-23

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

## Later packs

Later product work is out of scope for Pack 2. Do not add tournament features, ranking features, streaming features, new competition workflows, or unrelated visual redesigns while closing this pack.

Before starting a later pack:

* Read `BUHURTOS_STATUS.md`.
* Read `BUHURTOS_HANDOFF.md`.
* Confirm Pack 2 CI is green on the merged commit.
* Confirm a dedicated BuhurtOS Supabase project is selected before applying migrations remotely.
