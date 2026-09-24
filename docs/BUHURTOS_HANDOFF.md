# BuhurtOS Handoff

Last updated: 2026-09-23

## Resume here

Pack 3 is complete and merged to `main` in pull request #6.

Pack 3 merge commit: `e6fde086939f3c4e74353affb5a82a4aa1977a45`.

Verified Pack 3 implementation head: `2ffab73e9e403ab8c0325ef18a441ed5fe09319e`.

Successful pre-merge GitHub Actions workflow: `35954642255`.

Pack 2 remains complete underneath Pack 3. Its merge commit was `04ac4bb4fbdcf7789d21aed1a3998da64d349388`.

Do not apply BuhurtOS migrations to the currently connected Supabase project unless it is independently confirmed to be a dedicated BuhurtOS project. The project inspected during Pack 2 contains Northborn, Mallard, and Reavers data and is not the BuhurtOS target.

## Pack 3 files to know

Database and security:

* `supabase/migrations/20260924043000_pack3_fighter_identities.sql`
* `supabase/tests/database/fighter_identities_pack3.test.sql`
* `supabase/tests/database/identity_workflows.test.sql`

Frontend identity workflows:

* `src/lib/fighterIdentity.ts`
* `src/pages/IdentityPage.tsx`
* `src/pages/IdentityReviewPage.tsx`
* `src/pages/FoundationPage.tsx`
* `src/lib/identityAdmin.ts`
* `src/types.ts`
* `src/App.tsx`
* `src/components/Layout.tsx`
* `tests/fighterIdentity.test.ts`

## Identity model after Pack 3

A fighter identity is a permanent sporting record. Its UUID is not a login ID, team ID, club ID, or organization ID.

`fighter_identity_accounts` links authenticated accounts to a fighter identity as either self or guardian. The legacy `fighter_identities.user_id` field remains for compatibility, but Pack 3 ownership and permission checks use the account-link model. Trusted legacy writes synchronize into account links automatically.

Public sporting data stays on `fighter_identities`. Legal name, birth date, contact information, emergency contacts, guardian details, and guardian consent are stored separately in `fighter_identity_private_profiles`.

Anonymous users can read only active identities explicitly marked public. Authenticated members can read member-visible identities, their own controlled identities, or identities within their administrative scope. Platform administrators can inspect archived merged identities for provenance. Private administrative profile data has no anonymous access.

## Claim workflow

Users should search for an existing historical identity before creating a new one.

A normal claim is pending until reviewed. If a different account already controls the same self identity, the new self claim is automatically disputed. Organization-scoped administrators can handle normal claims for identities they administer. Disputed ownership requires platform administrator review.

Rejected claimants can dispute a decision with a reason. Approved ownership changes revoke superseded self links rather than deleting them. Claim versions reject stale concurrent actions.

## Duplicate and merge workflow

Duplicate suggestions are advisory only. There is no automatic merge.

An organization administrator may request a merge only when both identities are represented in an organization that administrator controls. A platform super administrator other than the requester must perform the final approval.

The merge transaction refuses to proceed if either identity changed after the request or if the identities have different active verified self owners.

Successful merges:

* Keep the canonical identity active.
* Archive the duplicate identity with a canonical pointer.
* Preserve previous names as aliases.
* Carry account links and affiliation history forward.
* Preserve completed event roster references on their original fighter rows.
* Archive duplicate organization fighter rows with canonical fighter pointers when both records exist in the same organization.
* Record audit and merge-review provenance.

Do not reintroduce the old direct `merge_fighters` browser RPC. Authenticated execution is intentionally revoked.

## Affiliation history

Use `create_fighter_affiliation` and `end_fighter_affiliation` through the client helpers rather than writing `fighter_affiliations` directly.

A new open primary affiliation closes the previous open primary affiliation on the prior day. Historical periods remain stored. Current fighter team assignment follows the active primary affiliation.

## Concurrency and privacy rules that must remain

* Public profile updates require the current `profile_revision`.
* Private profile updates require the current private-profile revision.
* Claim review and dispute actions require the current claim version.
* Merge requests snapshot both identity revisions.
* Stale writes fail instead of last-write-wins overwrites.
* Recorded youth profiles cannot become public without verified guardian consent.
* Anonymous clients must never receive account UUIDs, legal names, birth dates, contact details, emergency contacts, or guardian details.
* Frontend visibility is not an authorization boundary.

## Verification commands

Run from the repository root:

```text
npm ci
npm run typecheck
npm test
npx vite build --mode github-pages
supabase start
supabase db reset
supabase test db
```

GitHub Actions workflow `35954642255` passed both jobs on Pack 3 implementation head `2ffab73e9e403ab8c0325ef18a441ed5fe09319e` before merge.

The Pack 3 database suite contains 49 identity-specific assertions in addition to the earlier Pack 1 and Pack 2 database suites. It covers public and private access, profile concurrency, youth privacy, claim approval, rejection and disputes, unauthorized edits, affiliation transitions, duplicate suggestions, merge preservation, conflicting owners, rollback, and auditing.

## Hosted checks still pending

A dedicated BuhurtOS Supabase project is still required before any remote migration or Auth/Storage verification. Keep these unverified until that project exists:

1. Apply all migrations to an isolated BuhurtOS project.
2. Run Supabase security advisors against that project.
3. Verify real account signup, verification, password recovery, refresh, and expired-session behavior.
4. Verify identity RLS through the hosted Data API using isolated fighter, guardian, organization-admin, and platform-admin accounts.
5. Verify youth private-profile access and guardian consent through real hosted sessions.
6. Verify merge and claim RPCs through hosted JWTs.
7. Verify private waiver Storage behavior.
8. Deploy and verify the existing event-member Edge Function.

## Next session

Read `BUHURTOS_PLAN.md`, `BUHURTOS_STATUS.md`, and this handoff before continuing. Confirm `main` contains merge commit `e6fde086939f3c4e74353affb5a82a4aa1977a45` and that the checkpoint-only documentation commit has green CI.

Do not begin Pack 4 work as part of Pack 3 closeout.
