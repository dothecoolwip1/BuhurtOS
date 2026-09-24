# BuhurtOS Handoff

Last updated: 2026-09-23

## Resume here

Pack 2 is complete and merged to `main` in pull request #4.

Merged commit: `04ac4bb4fbdcf7789d21aed1a3998da64d349388`.

Verified Pack 2 head: `bef3d41c7fd509269535f13a85b2555961edd483`.

Successful GitHub Actions workflow run: `35945001693`.

Base commit before Pack 2 was `32240b2d6b8130a317ce5815a09e6d52d1bcac11`.

Do not apply the BuhurtOS migrations to the currently connected Supabase project unless it is independently confirmed to be a dedicated BuhurtOS project. The project inspected during this work contains Northborn, Mallard, and Reavers tables and migrations and is not the BuhurtOS target.

## Pack 2 files to know

Authentication and client boundary:

* `src/lib/auth.ts`
* `src/lib/supabase.ts`
* `src/features/AppState.tsx`
* `src/pages/LoginPage.tsx`
* `src/App.tsx`

Membership administration:

* `src/lib/setup.ts`
* `src/lib/memberAdmin.ts`
* `src/pages/AdminPage.tsx`
* `supabase/functions/invite-event-member/index.ts`

Database hardening:

* `supabase/migrations/20260924012000_pack2_accounts_permissions.sql`

Tests:

* `tests/auth.test.ts`
* `supabase/tests/database/accounts_permissions.test.sql`

## Security model after Pack 2

Frontend visibility is not an authorization boundary.

Browser clients use the publishable or anonymous key only. No service-role key belongs in frontend code.

The normal Supabase client persists the authenticated PKCE session. A second non-persistent client is reserved for public event data so a signed-in user does not gain broader public-row column access through the authenticated database role.

Membership tables are readable only through RLS and are not directly writable by the authenticated browser role. Public RPC wrappers are security invokers. Privileged table mutation lives in the non-exposed `private` schema and re-checks `auth.uid()` plus platform, organization, or event scope.

First-admin bootstrap is one-time. The sentinel in `private.bootstrap_state` keeps it closed even if platform membership rows are later removed.

## Final verification commands

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

GitHub Actions already runs the equivalent frontend and local Supabase checks. Prefer the CI result as the shared verification record.

## Direct access cases that must stay covered

The Pack 2 pgTAP suite is expected to prove:

* Anonymous users can read published public event data but not draft events.
* Anonymous users cannot request private event notes or roster clearance fields.
* Anonymous users cannot read account profiles or membership tables.
* An administrator in organization B cannot read organization A private data.
* Ordinary organization staff cannot perform administrative writes.
* Fighters only receive their scoped private roster access.
* Event organizers can assign lower event roles but cannot self-modify or create another organizer.
* Cross-organization captain assignment is rejected.
* Organization administrators cannot create another organization administrator or mutate their own organization role.
* Revoked event members immediately lose private event access and cannot restore themselves.
* Direct authenticated inserts into membership tables are blocked.
* The first-super-admin bootstrap does not reopen after its first successful claim.
* A request with no authenticated user identity cannot read private organizations or execute privileged role operations.

## Hosted checks to perform when the dedicated BuhurtOS project exists

Keep these marked unverified until they are actually run:

1. Link the dedicated project and apply migrations in a controlled environment.
2. Configure Auth Site URL and redirect allowlist for the production GitHub Pages origin and any approved development origin.
3. Create isolated BuhurtOS test accounts. Do not use personal accounts.
4. Verify signup confirmation, verification resend, sign-in, sign-out, password recovery, password update, refresh, and an actually expired or revoked refresh session.
5. Verify two unrelated organizations through the REST/Data API using their real user JWTs.
6. Verify a revoked membership loses access without obtaining a new token.
7. Deploy `invite-event-member` and verify it can assign an existing account but sends no email.
8. Verify the private `waivers` bucket cannot be listed or read anonymously.
9. Run Supabase security advisors and record only findings that apply to the dedicated BuhurtOS project.

## Pack 2 closeout

The final Pack 2 pull-request head passed the repository CI and local Supabase pgTAP workflow and was merged. Hosted checks that require a dedicated BuhurtOS Supabase project remain explicitly unverified above.

The next session may proceed to the next planned pack only after reading these checkpoint files and confirming the current `main` state.
