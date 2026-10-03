# Pack 06: post-Rumble roadmap only

## Goal

Capture deferred architecture decisions without implementing them before the Red Deer Rumble.

This pack is documentation/backlog work only unless the owner later explicitly promotes an item.

## Use real Rumble evidence

After the event, review:

- connectivity failures
- IndexedDB/outbox failures
- number and type of score conflicts
- paper fallback usage
- service-worker/update incidents
- spectator concurrency
- realtime message/request volume
- public page traffic
- registration and check-in friction
- duplicate fighter identity incidents
- organizer feedback
- marshal feedback
- mobile usability issues

Do not choose a large architecture based on hypothetical scale if the event gives real evidence.

## Deferred offline/sync decision

Re-evaluate a full sync engine only if the Rumble or later events show that brief-outage resilience is insufficient.

If evaluating PowerSync or alternatives later, compare current documentation and a concrete BuhurtOS workload:

- full-event offline reads
- write conflict behaviour
- Supabase/RLS integration
- multi-tenant security
- operational complexity
- cost
- migration effort
- mobile/PWA implications

Do not treat the earlier PowerSync suggestion as a commitment.

## Realtime scaling

Broadcast plus snapshot/CDN architecture is deferred.

Consider it only when actual spectator scale, connection limits or request load justify it.

The Rumble's expected tens of remote viewers do not justify world-scale infrastructure.

## Open results format

Design a portable, versioned buhurt results format after the event.

Goals:

- another site can consume event, competition, match, placement and correction data
- stable IDs and source provenance
- corrections/supersession supported
- no requirement to understand the internal BuhurtOS database schema
- machine-readable schema/version

Do not implement before the Rumble.

## Ranking architecture

Long term:

- preserve each organization's official ranking separately
- optionally add a clearly separate BuhurtOS Elo-style statistical rating
- never present the BuhurtOS rating as federation endorsement
- publish immutable ranking snapshots with superseding corrections

Do not implement a new ranking engine in this pack.

## Organization and federation relationships

Keep separate concepts for:

- workspace/user administration
- team membership
- organization affiliation
- event sanctioning
- ruleset authority
- platform usage

An organization using BuhurtOS must not imply federation endorsement.

## QA environment

The owner currently does not require a separate QA Supabase project.

Reconsider only if:

- synthetic production data becomes hard to isolate
- destructive testing becomes unsafe
- CI/preview environments need independent backend state
- permission/security testing becomes impractical against production-like local data

## Cryptographic audit enhancement

Keep hash-chained or externally anchored tamper evidence as a future option.

The near-term requirement remains an ordinary append-only/audited correction history.

Only revisit cryptographic chaining if governance, sanctioning, dispute resolution or external trust requirements justify the complexity.

## Supabase

BuhurtOS is staying on Supabase.

Do not create a migration-away project.

Continue to use sensible abstraction boundaries so the domain model is not unnecessarily coupled to frontend SDK calls, but optimize for the product that actually exists.

## Large-event scale

Do not build for 20,000 viewers until there is a realistic path to that audience.

If it happens later:

- video should use a dedicated streaming/CDN provider
- public state should avoid one database/realtime connection per casual viewer where unnecessary
- cache/snapshot infrastructure can be introduced then
- capacity planning should use the Supabase plan and limits that exist at that time

## Output

Update the product backlog with evidence-based post-Rumble candidates and a short decision record for each.

Do not modify production architecture simply to complete this pack.

Mark Pack 06 as ROADMAP COMPLETE, not IMPLEMENTATION COMPLETE, in STATUS.md.
