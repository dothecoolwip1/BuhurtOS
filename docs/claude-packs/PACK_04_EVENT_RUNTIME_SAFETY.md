# Pack 04: event runtime, realtime, CI and deployment safety

## Goal

Make the Rumble build safer to operate and deploy at the realistic event scale without introducing post-Rumble infrastructure.

## Service-worker update safety

The current immediate `skipWaiting()` and `clients.claim()` behaviour can replace active code during scoring.

Implement a safe update flow:

- a new build may download in the background
- do not activate it while the device is actively scoring or has important pending work
- give the user a clear update-ready state when appropriate
- activate after the scoring session and important queue state are safe
- preserve an explicit emergency path for a critical event-day fix

Do not create a situation where marshals must remain permanently on a broken version because updates are impossible.

Test version transitions with pending scoring work.

## Command compatibility

Critical scoring commands must carry a command schema/protocol version.

The server should:

- accept a defined compatibility window
- refuse truly unsafe incompatible commands clearly
- avoid discarding their evidence silently
- allow an event device to survive a normal deployment without instant lockout where feasible

Keep this proportional to the Rumble. Do not build a general distributed-protocol framework.

## Realtime before the Rumble

Do not migrate the public event to Broadcast in this pack.

Fix the current waste:

- scope realtime subscriptions to the relevant event or competition on the server where supported
- when competition X changes, refetch competition X or the smallest authoritative state needed
- do not refetch all 17 competitions for every unrelated change
- prevent duplicate subscriptions and runaway refetch loops
- on reconnect, fetch authoritative state before showing LIVE again

Expected event scale is approximately 100 on-site attendees and perhaps 30 remote live viewers. Optimize for correctness and reasonable efficiency at that scale.

## Event analytics and stats

Preserve useful statistics about actual Rumble usage without turning analytics into a surveillance project.

Use the existing analytics/privacy direction in the repository.

At minimum, where the existing analytics architecture reasonably supports it, make it possible to answer after the event:

- public event page views
- approximate live-view usage
- which competitions/pages drew interest
- key registration and event-flow usage counts
- scoring/realtime error counts useful for postmortem analysis

Do not collect precise location merely for analytics.

If some metric would require disproportionate new infrastructure, document it instead of expanding this pack.

## CI

Bring the database-heavy checks into the real gate.

At minimum:

- rebuild/apply migrations from zero
- run the repository's database test suite relevant to production integrity
- run permission/RLS checks
- run TypeScript tests
- run production build
- run focused browser tests for scoring/bracket/event flows
- add schema-drift detection appropriate to the repository
- if generated database types are introduced, make their generation/check deterministic

Do not fake a passing CI gate by excluding failing database tests.

## Branch protection and deployment

Protect `main` so production changes require the intended checks.

If the connector/account cannot apply branch protection programmatically, document the exact required GitHub setting and prove everything else that can be enforced in repository code.

Create an event deploy policy:

- normal development continues before the freeze
- establish a final pre-event release
- freeze normal production deploys around the Rumble
- emergency fixes are allowed through a deliberate path
- do not deploy automatically just because a commit exists if the release policy says production is frozen

Do not invent a precise freeze clock time if none is already established. Document the operational trigger around the final pre-event release and event weekend.

## Required tests and rehearsal

Before calling this pack complete:

1. Prove a waiting service worker does not take over an active scoring session.
2. Prove an update can be activated safely after scoring/pending work clears.
3. Prove an old compatible command survives a normal version transition.
4. Prove realtime changes no longer trigger full-event refetch storms.
5. Prove reconnect fetches authoritative state before LIVE is restored.
6. Run the CI gate on the feature branch.
7. Run browser tests.
8. Produce a real-phone rehearsal checklist including airplane mode, reconnect, pending queue, conflict handling, service-worker update and paper fallback.

If actual physical phones are available in the environment, run the rehearsal. Otherwise mark real-phone execution as a required human verification, not as completed.

## Acceptance criteria

- No unconditional mid-score service-worker takeover remains.
- Realtime refetches are targeted.
- CI covers the database checks that protect the Rumble.
- Main is protected or exact manual protection steps are documented if tooling blocks direct configuration.
- Event deploy freeze/emergency procedure exists.
- A concrete real-phone rehearsal checklist exists.
- No Broadcast/CDN architecture is added.

## Handoff

Separate:

- code changes
- workflow/CI changes
- GitHub settings actually changed
- settings still requiring manual owner action
- realtime measurements before/after
- browser tests
- real-phone verification status
- deployment status
- commit SHA

Update STATUS.md and continue to Pack 05.
