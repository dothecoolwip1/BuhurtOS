# BuhurtOS Status

Updated: 2026-09-23

## Repository recovery

The requested checkpoint files were absent from main when Pack 2 began. Repository history and the current tree were inspected before changes. This file, BUHURTOS_PLAN.md, and BUHURTOS_HANDOFF.md reconstruct the checkpoint from repository evidence without replacing completed implementation.

## Pack 1

Status: implemented in repository, verification evidence partially present.

Evidence includes core migrations, security and RPC migration, operational hardening, auth bootstrap, first run bootstrap, event workflows, double elimination results, security hardening, fight card realtime, rulesets, identity foundation, identity workflow database tests, and TypeScript foundation tests.

## Pack 2

Status: implementation complete on branch `pack-2-accounts-permissions`; runtime infrastructure verification still required.

Implemented:

* Password sign in and sign out.
* Account sign up with verification redirect.
* Existing account magic link sign in without implicit account creation.
* Password reset request and recovery password update.
* Safe internal operations redirect validation.
* Session readiness handling before protected route decisions.
* Session sign out and refresh event handling.
* Clear pending access state for authenticated users with no assigned operational role.
* Organization and event membership mutation hardening.
* Direct client mutation grants removed from platform, organization, and event membership tables.
* Audited RPCs for organization and event role assignment and revocation.
* Event organizers may manage operational event roles but cannot grant or revoke event organizer access.
* Organization administrators control event organizer access.
* Last organization administrator protection.
* Cross organization team validation for event membership assignment.
* Explicit private account and membership grants for anonymous users revoked.
* Private waiver bucket retained.
* Direct role revocation client call replaced with authorized RPC.
* Redirect regression tests and database authorization test suite added.

## Verification status

Verified from repository inspection:

* No service role key is present in frontend source or environment example.
* Frontend Supabase client uses a publishable key or legacy anonymous key only.
* Existing public event access uses explicit RLS and column grants.
* Private profiles are not granted to anonymous users.
* Membership helper functions are in the private schema and are not Data API endpoints.

Not verified in this session:

* Local npm test, typecheck, and build could not run because the execution container could not resolve GitHub to clone dependencies.
* Pack 2 migration has not been applied to a confirmed BuhurtOS Supabase project because the connected Supabase account exposes one generically named project and the repository does not identify it as BuhurtOS.
* pgTAP Pack 2 tests have not run against a migrated database.
* Real email verification, magic link, and password recovery delivery were intentionally not triggered.
* Hosted Auth Site URL, allowed redirect URLs, SMTP, password policy, CAPTCHA, and session timeout settings remain infrastructure checks.
* Expired JWT behavior remains unverified against hosted Auth.
