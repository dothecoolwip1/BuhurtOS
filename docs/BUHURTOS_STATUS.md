# BuhurtOS Status

Last updated: 2026-09-23

## Current recovery point

Repository: `dothecoolwip1/BuhurtOS`

Base branch: `main`

Pack 2 branch: `pack2-accounts-permissions`

Pull request: #4, `Complete Pack 2 accounts and permissions`

Pack 2 base commit: `32240b2d6b8130a317ce5815a09e6d52d1bcac11`

The original `BUHURTOS_PLAN.md`, `BUHURTOS_STATUS.md`, and `BUHURTOS_HANDOFF.md` files were absent from `main` at the start of Pack 2. These files were reconstructed from repository evidence rather than guessed historical content.

## Completed before Pack 2

Pack 1 foundation work is present and must be preserved:

* Canonical identity, clubs, affiliations, divisions, organization, season, event, team, and fighter foundations.
* Ruleset administration.
* Audit actor stamping.
* Anonymous privilege hardening.
* Organization and season lifecycle administration.
* Frontend and pgTAP coverage associated with those foundations.

## Pack 2 implemented on the working branch

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

## Verification status

Verified in GitHub Actions on an earlier Pack 2 branch head:

* TypeScript typecheck passed.
* Existing frontend/unit tests passed.
* Production Vite build passed.

Added for final Pack 2 verification:

* `tests/auth.test.ts` covers safe redirects and signed-out versus expired-session messaging.
* `supabase/tests/database/accounts_permissions.test.sql` performs direct anonymous and authenticated access attempts across two unrelated organizations and includes revoked membership and self-escalation cases.
* The repository CI rebuilds local Supabase from all migrations and runs pgTAP tests.

Final CI on the final Pack 2 head must be green before merge. A cancelled CI job caused by a newer commit is not test evidence.

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

These are infrastructure verification items, not claims of successful production deployment.
