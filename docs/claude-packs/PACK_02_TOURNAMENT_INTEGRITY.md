# Pack 02: tournament and sporting-record integrity

## Goal

Make bracket creation, participant identity and official-result correction deterministic and auditable before the Rumble.

## Scope

This pack addresses the proven tournament-integrity failures:

- match-side changes that do not invalidate stale clients
- multi-step browser bracket construction
- missing random draw seed
- browser/server pool-tie disagreement
- destructive reopen behaviour
- unaudited official-result edits
- team history being rewritten by merges

Do not redesign every competition format or build a universal event-sourcing system.

## Required behaviour

### Match version meaning

A match version must change whenever a change can alter the meaning of a queued or stale scoring command.

At minimum, changing either participant/side must increment the version.

Verify other match-structure fields and include them if stale values could cause a score to be credited to the wrong sporting state.

### Atomic bracket construction

Move authoritative bracket generation into one controlled server-side transaction or RPC.

Requirements:

- one request either creates the intended bracket completely or leaves no partial bracket
- concurrent generation attempts cannot create two authoritative brackets for the same competition
- resulting match structure is deterministic given the chosen entrants, rules and draw inputs
- authorization is enforced in the database
- browser code becomes an orchestrator/view, not the authority for multi-step persistence

### Draw seed

For major events such as the Red Deer Rumble, persist the seed or equivalent reproducibility input for randomized draws.

The saved value must be enough to explain/reproduce the draw algorithm version used at the time.

Do not force every informal event to expose a seed in the UI if the current product does not need that.

### Pool ties

The owner chose manual organizer intervention for unresolved pool ties.

Therefore:

- eliminate the current browser/server disagreement
- define when a tie requires manual resolution
- block advancement/publication that would otherwise be ambiguous
- show the organizer the tied competitors and relevant standings
- record the organizer's chosen order/advancement, actor, time and reason or note
- once resolved, every client and official placing uses the same recorded decision

Do not use random-looking ID order as a sporting tie breaker.

### Official result correction

The owner allows organizers to correct official results, but every correction must be auditable.

Implement a controlled correction path that records at minimum:

- result/match affected
- previous authoritative value
- replacement value
- actor
- server timestamp
- reason or correction note
- resulting version/revision

Prevent arbitrary client updates from bypassing that audit path.

### Reopen semantics

Reopening a match or competition must not silently delete official results.

Use correction, voiding, supersession or another explicit historical status.

The public/current state may change, but the previous official record and the reason for change remain inspectable by authorized users.

### Team history

Do not let a team merge rewrite history as if the surviving team competed under its current identity at every old event.

Preserve enough historical identity/snapshot information so an old result can show:

- the team identity/name used at the event
- the current/successor team where relevant

The owner wants both old and current names available.

## Required tests

Prove at minimum:

1. Changing a match side invalidates an old expected version.
2. A stale scoring/finalization command cannot be applied to replacement entrants.
3. Two simultaneous bracket-generation requests produce one authoritative bracket.
4. A failure inside bracket generation does not leave a partial official bracket.
5. The Rumble/randomized major-event seed is stored.
6. A true unresolved pool tie cannot silently advance by browser ID ordering.
7. Manual tie resolution is recorded and both public advancement and official placings agree.
8. Reopening does not erase the audit/history of an official result.
9. Direct unaudited official-result mutation is blocked.
10. Team merge history preserves the event-time identity.

Add shared test vectors where TypeScript and SQL implement the same competition rule.

## Acceptance criteria

- The database, not a sequence of browser writes, owns official bracket creation.
- Expected-version protection covers participant changes.
- Tie handling cannot disagree between browser and server.
- Official sporting history is corrected, not silently erased.
- Historical team identity survives merges.

## Handoff

Report:

- functions and tables changed
- migration(s)
- concurrency tests
- tie scenarios tested
- correction/reopen scenarios tested
- hosted database state
- browser verification of organizer flows
- commit SHA

Update STATUS.md and continue to Pack 03.
