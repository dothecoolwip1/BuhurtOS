# BuhurtOS Build Plan

## Product goal

BuhurtOS is a production quality, mobile first armored combat platform covering public sporting records, organization and team administration, event operations, scoring, brackets, standings, rulesets, identity, and secure account access.

## Delivery packs

1. Foundation and identity
   Core schema, permanent fighter identity, organizations, clubs, teams, affiliations, divisions, rulesets, event operations foundations, audit history, and baseline RLS.

2. Accounts and permissions
   Complete Supabase Auth flows, safe redirects, session handling, organization and event memberships, role assignment and revocation, server enforced authorization, private account separation, storage controls, and access tests.

3. Competition operations
   Event setup, registration operations, check in and compliance, fight card, bracket operations, scoring, discipline, notes, offline queue, conflict handling, and realtime hardening.

4. Public platform and release hardening
   Public profiles and rankings, spectator experience, accessibility, performance, deployment, production configuration, monitoring, end to end validation, and release documentation.

## Engineering rules

* Preserve completed work and migrations.
* Frontend visibility is never an authorization boundary.
* Supabase RLS and privileged database operations enforce access.
* Browser code may use only publishable Supabase credentials.
* Private account data and public sporting records remain separate.
* Security relevant mutations are auditable.
* Each pack ends with tests, exact recovery notes, and explicit unverified items.
* Do not expand a pack into later product work.
