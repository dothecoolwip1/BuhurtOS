# Post-Rumble roadmap and decision records

Status: **roadmap only**. Nothing in this file is built or promised. It records what was deliberately deferred before the Red Deer Rumble (Nov 14 to 15, 2026),
why, and the evidence that would justify reconsidering each item. Owner decisions of 2026-10-03 (`docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`) are the authority.
Do not choose a large architecture from hypothetical scale if the event gives real evidence.

## 1. Evidence to collect from the Rumble (before deciding anything below)
| Evidence | Where it is |
|---|---|
| Connectivity failures, pending-queue sizes, refused/stuck actions | first-party events `result_pending_no_signal`, `score_action_refused`; `score_events` rows vs finalizations; marshals' notes |
| IndexedDB/outbox failures | marshal reports; `score_action_refused`; devices that showed "This browser cannot save scoring" |
| Score conflicts (number and type) | `result_proposals` by status; `audit_log` `result.conflict`, `result.conflict_resolved` |
| Paper fallback usage | `audit_log` `result.paper_entered`; paper sheet count vs digital finals |
| Service-worker/update incidents | `app_update_ready` / `app_update_applied` (with `emergency`); marshal reports |
| Spectator concurrency, realtime volume | Supabase dashboard (Realtime and API reports); `live_connection` statuses; page views of the event page |
| Public page traffic | first-party analytics (page views by path) |
| Registration and check-in friction | registration funnel events; organizer feedback |
| Duplicate fighter identity incidents | `fighter_identity_reviews` (open / distinct / duplicate counts) |
| Organizer, marshal and mobile feedback | a short debrief form after the event |
Queries: `docs/runbooks/EVENT_ANALYTICS.md`. Take the post-event database export first (`docs/runbooks/PRODUCTION_EXPORT_AND_RESTORE.md`).

## 2. Decision records
Format: **Decision now** / **Revisit when** / **Evidence needed** / **Not doing**.

### 2.1 Offline sync engine (PowerSync or similar)
* Decision now: not before the Rumble. The goal is resilience to brief outages: an IndexedDB outbox bound to user and event, finalization that needs signal, paper as the official fallback.
* Revisit when: the Rumble or a later event shows the lightweight approach is insufficient (for example repeated multi-minute outages where marshals could not run the day, or frequent unreconcilable conflicts).
* Evidence needed: outage durations, pending-queue peaks, conflict counts, how often paper replaced digital.
* If evaluated later, compare current documentation against a concrete BuhurtOS workload: full-event offline reads, write-conflict behaviour, Supabase/RLS integration, multi-tenant security, operating complexity, cost, migration effort, mobile/PWA implications. The earlier PowerSync suggestion is not a commitment.
* Not doing: a full offline-first rewrite; making server-driven bracket advancement work indefinitely without signal.

### 2.2 Realtime scaling (Broadcast plus snapshot/CDN)
* Decision now: keep Supabase Realtime, filtered by competition on the server, with targeted refetch and a "Live only after a fresh re-read" rule (Pack 04). Expected scale is about 100 on site and tens of remote viewers.
* Revisit when: concurrent viewers approach the Free-plan limits (200 realtime connections, 100 messages per second at the time of the review; re-check current limits), request load becomes a problem, or a much larger audience is realistic.
* Evidence needed: peak concurrent connections, realtime message volume, API request counts, any "Reconnecting" incident reports.
* Not doing: 20,000-viewer infrastructure. If that audience ever appears: video belongs on a dedicated streaming/CDN provider; public state should avoid one database/realtime connection per casual viewer; snapshot/cache infrastructure can be introduced then, sized to the Supabase plan and limits that exist at that time.

### 2.3 Open results format
* Decision now: nothing built.
* Later: a portable, versioned, machine-readable buhurt results format that another site can consume without knowing the BuhurtOS schema: events, competitions, matches, placements, corrections; stable IDs; source provenance; supersession and corrections supported (the Pack 02 revision log is the natural source); a published schema with a version number.
* Revisit when: a second organization or site wants to consume results, or after the event when the data model has been stressed by real use.

### 2.4 Ranking architecture
* Decision now: no new ranking engine. Each organization's ranking stays official within that organization. The rankings page says so and never counts fictional events.
* Later: optionally add a clearly separate BuhurtOS statistical rating, starting with an explainable Elo-style method unless real evidence supports something better; never present it as federation endorsement or as an organization's official ranking; publish immutable ranking snapshots, with corrections creating a new superseding snapshot.
* Revisit when: a real need for cross-organization comparison appears and there is enough clean, real (non-synthetic) result history to justify it.

### 2.5 Organization and federation relationships
* Keep these as separate concepts: workspace/user administration, team membership, organization affiliation, event sanctioning, ruleset authority, platform usage. An organization using BuhurtOS must not imply federation endorsement.
* Revisit when: a federation wants sanctioning tools or a second organization runs its own events on the platform.

### 2.6 QA environment
* Decision now: no separate QA Supabase project. Synthetic data stays in production, labelled and excluded from official aggregates; permission tests run against a throwaway Postgres built from the migrations.
* Revisit when: synthetic production data becomes hard to isolate, destructive testing becomes unsafe, CI/preview environments need independent backend state, or permission/security testing against production-like local data becomes impractical.

### 2.7 Cryptographic audit enhancement
* Decision now: an ordinary append-only, audited correction history (`result_revisions`, `audit_log`, `result_proposals`) is the requirement.
* Revisit when: governance, sanctioning, dispute resolution or external trust requirements justify hash-chained or externally anchored tamper evidence.

### 2.8 Supabase
* BuhurtOS stays on Supabase (Free plan for now; recovery limits accepted and documented). No migration-away project. Keep sensible boundaries (RPCs and views behind `src/data`) so the domain model is not needlessly coupled to SDK calls.
* Revisit the plan (not the vendor) when paused-project risk, backups or point-in-time recovery needs, or connection limits matter more than cost.

### 2.9 Fighter identity beyond the pre-Rumble basics
* Done: one account = one fighter in the database; no duplicate creation on accept; look-alikes go to an administrator.
* Later: a self-service claim flow for existing historical records and a careful merge tool that keeps both records' history and provenance; slug history so renamed teams keep their old addresses.
* Revisit when: the identity review list shows recurring duplicates, or fighters ask to claim their history.

### 2.10 Other candidates (unscheduled)
Push notifications; a big-screen mode and QR links (cut first in the original plan); Stripe; team discovery by city / region / postal code with approximate locations (rule: never require precise GPS); a fresh offline reload that rebuilds the authenticated event workspace.

## 3. What each decision must not become
No decision here authorises work on PowerSync, a new ranking engine, a frontend rewrite, a Supabase exit, Broadcast/CDN, or 20,000-viewer infrastructure before the Rumble. The owner promotes an item explicitly.
