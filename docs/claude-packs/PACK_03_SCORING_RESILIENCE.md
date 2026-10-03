# Pack 03: scoring resilience for brief outages

## Goal

Make the existing scoring workflow safe during short connectivity problems without turning BuhurtOS into a full offline-first tournament engine.

Paper remains the primary official fallback.

## Explicit non-goals

Do not:

- migrate to PowerSync
- add ElectricSQL or another sync engine
- promise that a fresh offline reload reconstructs the full authenticated event
- make server-driven bracket advancement operate indefinitely without connectivity
- redesign all event state as an offline replica
- change the owner decision that match finalization requires signal for the Rumble

## Required behaviour

### IndexedDB outbox

Replace the scoring outbox's durable storage in `localStorage` with IndexedDB.

Each queued entry must include enough information to safely identify:

- event
- match or target entity
- creator user
- idempotency identity
- local sequence/order where needed
- command/action type
- payload
- created time
- retry/error status
- compatible command schema version

The owner requires user and event binding. Do not replay user A's commands while user B is authenticated.

### Queue isolation and progress

Fix the global poisoned-FIFO failure.

A permanently failing entry for one match must not indefinitely block unrelated valid work.

Preserve ordering only where domain correctness requires it.

Rejected or conflicted entries remain durable until explicitly resolved or discarded by an authorized flow.

### Pending state

During brief signal loss:

- already-open scoring may continue preserving local work
- local work is visibly Pending until the server accepts it
- do not present a pending result as official
- ordinary scorekeeper UI may remain limited to Pending and Official for simplicity

A fresh offline reload is not required to rebuild the whole scoring workspace, but local data must not be silently destroyed.

### Finalization

Finalization requires signal for the Rumble.

When the scorekeeper requests finalization:

- send a controlled finalization command with the current expected version and authoritative proposed result
- use idempotency
- verify the authenticated actor and event role on the server
- use the participant/version protection from Pack 02
- if the command cannot reach the server, leave the result Pending and instruct the operator to use the paper fallback as needed

Do not claim that a locally finalized result is official before server acceptance.

### Conflicts

When two devices disagree on an official result:

- never last-write-wins silently
- never wipe the losing device's evidence
- preserve the conflicting proposal
- create or expose an authorized Needs Review item
- require head-marshal intervention
- show enough evidence to choose the correct official result
- record the final intervention in the audit history

The general scorekeeper UI does not need a permanent third status if Needs Review is limited to authorized officials.

### Paper recovery

Build or harden a simple `Enter Official Result` recovery flow for authorized event officials.

The workflow should be usable when transcribing from the paper score sheet after connectivity or device trouble.

It must use the same audited official-result path rather than bypassing integrity checks.

## Required tests

Run the actual outbox implementation through at least these scenarios:

1. User A creates queued work, logs out, user B signs in. B cannot flush A's work.
2. One permanently failing entry does not block unrelated valid match entries forever.
3. A rejected entry survives reload and remains reviewable.
4. Short network loss while the scoring screen stays open does not erase entered work.
5. Reconnection sends valid pending actions exactly once or idempotently.
6. A stale participant/version command is refused safely.
7. Two conflicting device results create intervention rather than silent loss.
8. Head-marshal resolution creates one official result and preserves conflict evidence.
9. Offline finalization is not falsely reported as official.
10. Paper recovery uses the audited official path.

Where browser/service-worker behaviour is involved, test the running app. Use real-phone rehearsal later in Pack 04.

## Acceptance criteria

- No global anonymous `localStorage` scoring FIFO remains.
- Cross-user replay is prevented.
- Poisoned entries cannot freeze unrelated matches forever.
- Rejected/conflicting work is durable.
- Pending and official are visually distinct.
- Finalization still requires signal, by owner decision.
- The head marshal has a workable conflict intervention path.
- Paper recovery exists and is auditable.

## Handoff

Report:

- queue schema and migration strategy from existing localStorage data, if needed
- exact failure scenarios reproduced before and after
- browser verification
- any iOS-specific limitation not directly verified
- commit SHA

Update STATUS.md and continue to Pack 04.
