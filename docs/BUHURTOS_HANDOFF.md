# BuhurtOS Handoff

Updated: 2026-09-23
Branch: `pack-2-accounts-permissions`

## Recovery point

Main commit observed before Pack 2: `32240b2d6b8130a317ce5815a09e6d52d1bcac11`.

The checkpoint documents requested by the Pack 2 prompt were missing from main. They were reconstructed from the repository tree and implementation evidence on this branch.

## Pack 2 changed files

* `src/lib/auth.ts`
* `src/pages/LoginPage.tsx`
* `src/features/AppState.tsx`
* `src/App.tsx`
* `src/lib/memberAdmin.ts`
* `supabase/migrations/20260923235900_accounts_permissions.sql`
* `supabase/tests/database/accounts_permissions.test.sql`
* `tests/auth.test.ts`
* `docs/BUHURTOS_PLAN.md`
* `docs/BUHURTOS_STATUS.md`
* `docs/BUHURTOS_HANDOFF.md`

## Required verification before merging

1. Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build` with bounded command timeouts.
2. Confirm which Supabase project belongs to BuhurtOS before applying any migration.
3. Apply migrations in filename order to an isolated BuhurtOS test database.
4. Run all SQL tests in `supabase/tests/database`, including `accounts_permissions.test.sql`.
5. Run Supabase security and performance advisors after migration.
6. Test anonymous access, Org A member and admin, unrelated Org B admin, event organizer, official, fighter, revoked membership, and an expired session.
7. Attempt direct Data API writes to membership tables as ordinary authenticated users and confirm denial.
8. Confirm the waiver bucket remains private and staff reads still follow RLS.
9. Configure exact production Auth Site URL and redirect URLs for the login callback. Confirm email verification and password recovery using isolated test accounts only.
10. Confirm password strength, leaked password protection where available, rate limits, CAPTCHA policy, SMTP, and session timeout settings in the hosted project.

## Security model notes

Authorization data is stored in membership tables, not user editable metadata. The UI permission helpers are for presentation only. Database RLS and the Pack 2 membership RPCs are the security boundary.

Public sporting output continues to come from event and roster data with intentionally limited public columns. `profiles`, membership tables, permanent fighter account links, and waiver objects are not anonymous account data surfaces.

## Known infrastructure dependency

The connected Supabase account currently exposes a project named `dothecoolwip1's Project`. The repository contains no project reference proving that project is BuhurtOS. Do not apply BuhurtOS migrations there until the mapping is confirmed.
