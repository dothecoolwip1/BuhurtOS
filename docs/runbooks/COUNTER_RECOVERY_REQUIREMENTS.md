# Counter recovery and rehearsal corrections

Owner request: fix all seven findings in the October 20 non-HACSA rehearsal and provide layered safeguards when phones miss a round start because of lag. Preserve full organizer control. Testing uses fictional independent events only.

This file is an implementation and verification checklist, **not a completion claim**. No hosted migration or deployment is approved merely by this checklist.

## Required behavior

- R1: legacy finalization cannot recompute official placements/points. Explicit reopen with reason is required. Modern finalization remains idempotent. Closed-event and role boundaries remain enforced.
- R2: all proposed draws and Lyst assignments commit together. A failed assignment leaves no partial tournament. A lost response cannot replace an existing draw on retry. Fight-order planning has visible recovery after reload and never falsely reports success.
- R3: unknown individual/team registration readiness is unknown, not Ready. Any recorded block remains false. Readiness remains a warning under organizer control; no private reasons leak to an announcer.
- R4: confirmed total and pending command IDs survive offline reload together, without double-counting lost acknowledgements.
- R5: unrelated event insurance wording is generic. Existing HACSA/MCC membership codes retain their exact meanings and labels.
- R6: compact check-in describes its actual scope and links to the full desk; never claims signed waiver data is absent or that all legacy registrations signed.
- R7: organization choices match existing linking permissions. Check again before creating; a refused preflight creates nothing. A concurrent permission change still produces an honest post-create recovery warning.

## Layered scoring safeguards

1. A phone caches the exact fight, side, operator and server-issued round/run identity while connected. A returned/recounted round gets a distinct run. In-flight hosted rounds are backfilled without resetting clocks/counts.
2. A prepared phone that misses Go can explicitly count from the marshal's call. Show the saved fight/round and a clear provisional warning. No network connection is required for that local action. A phone never guesses a different fight/round.
3. The scorekeeper sees prepared, start received, last seen, submitted and pending signals for each expected phone. Heartbeat alone never proves start delivery. Quiet phones must not disappear from this safety view.
4. Missing preparation/start, pending evidence or missing Done must produce an actionable warning. Authorized staff can proceed with a specific audited reason and marshal/paper numbers.
5. Timer commands retain their ID and payload across a lost acknowledgement/reload. Retry cannot restart a clock. Delayed intents are not automatically started after reconnect without human review.
6. Taps save before network send. Every acknowledgement atomically saves the new confirmed total and remaining queue. Concurrent pumps/Done share one delivery sequence. Storage denial/quota/corruption produces a visible paper/copy fallback and preserves unreadable bytes.
7. Late, stale, refused, revoked-seat or provisional evidence is retained locally, with copy/export. Valid sessions can upload late evidence for marshal review; it never automatically changes an awarded score or official result. Revocation never regains access.
8. Evidence remains accessible after seat/fight changes and after a result becomes official. Staff review is event-scoped, reasoned and audited. An old run's counts cannot be replayed into a new run.
9. Polling and reconnect/foreground reconciliation are authoritative; Realtime is only a refresh signal. Requests have deadlines. Responses from an obsolete account/fight request cannot overwrite a new context.
10. Multiple tabs, lost responses, double taps, network flapping and browser background/reload must not silently lose or duplicate evidence. A new tap invalidates an earlier Done mark.

## Operator recovery procedure

- Before leaving or signing a phone out, check that its taps were sent. A fresh sign-in cannot upload counts using an ended session's authority. If access has already ended, open **Saved counter evidence** on the sign-in page and give its exact saved text to the marshal.
- If Go has not arrived but the correct fight and prepared round are saved, verify the names and side with the marshal, then use **Marshal started round … · count offline**. That whole round remains provisional evidence for review. Use paper if the correct prepared round is missing.
- At the end, the marshal checks the phone evidence and paper sheet, reviews any recovered actions, and enters the awarded score with a reason when required. Uploading or reviewing evidence never automatically changes an official result.
- **Archive locally** means the counts were handed to the marshal. It stops retrying selected undelivered actions and keeps their exact bytes on the phone; it does not mean they reached the server or became an official score. Keep the marshal's copy.
- Check the displayed clock after any uncertain command. A later permission refusal does not prove an earlier attempt failed. Retry the same saved action only after checking; clearing it requires the explicit clock-check control.
- Older records retry automatically only while a usable session remains and browser tab locks are available. Other identities' records may be refused and kept for local handoff. Without tab locks, show older undelivered evidence to the marshal; it is not sent by the background worker.

## Verification needed before completion

- Focused tests for each R1–R7 and permissions/denials, including multi-competition atomic rollback and lost build response.
- Deterministic tests: all phones disconnected at Go, staggered recovery, lost tap/start acknowledgement, repeated starts, mid-round reload/background, late evidence after end/finalization, recount generation, wrong fight/round/ID reuse, phone replacement/revocation, unavailable/corrupt/quota storage, multiple tabs, concurrent send/Done.
- Fresh migration replay and upgrade of an already-open fight with seats/counts/clock. Preserve the existing hosted function variants when preparing a release.
- Independent Claude review, typecheck, appropriate unit tests/build, SQL integrity/role/concurrency checks, schema fingerprint, and actual multi-device browser rehearsal on phone and desktop views.
- Distinguish local source/tests from hosted state and deployment. Do not declare the goal complete until the required behavior and full failure paths have current evidence.
