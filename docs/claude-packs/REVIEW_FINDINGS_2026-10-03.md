# Verified review findings

Date: 2026-10-03

This file preserves the actionable findings reported after comparing the repository, a fresh migration rebuild and the hosted Supabase database.

It is a summary, not a substitute for the full review artifacts.

## Evidence quality

The review reported:

- all 112 hosted SQL functions were compared with the repository rebuild
- 87 matched byte-for-byte
- the other 25 matched after comments and whitespace were normalized
- the real outbox implementation was run against scripted failure scenarios
- hosted database rows were inspected read-only
- the live product and real phones were not reached during that review, so device-dependent findings came from code and local reproduction rather than live observation

## Offline and scoring findings

- Signed-in reads are not cached by the current service worker.
- A scorekeeper who reloads with no signal cannot reconstruct the event, role and match queue.
- Starting and finalizing matches currently require network access.
- Later bracket participants are advanced by the server, so complete disconnected tournament operation does not currently exist.
- A second phone's conflicting result can be refused and its local board cleared without creating an organizer-visible conflict.
- Rejected score information is not durable across reloads.
- One stuck global FIFO item can block unrelated queued work.
- Queue entries do not carry creator identity and can flush under a different signed-in user.
- The current service worker calls `skipWaiting()` and `clients.claim()`, so a new build can take control mid-session.

## Match and bracket integrity findings

- `finalize_match` and `reopen_match` use row locks and expected-version checks.
- Match-side changes do not currently increment the match version.
- An old client can therefore submit against a version that is numerically current even though the entrant changed.
- Brackets are currently built through several browser-driven steps rather than one transaction.
- Concurrent organizers can create duplicate or partial bracket state.
- The randomized draw seed is not persisted.
- Pool advancement and official placing logic use different tie behaviour.
- The browser can decide advancement differently from the server's official placing result.

## Security and permissions findings

- An organizer of any event can currently approve, merge or delete teams platform-wide.
- New-team contact details are available through that broad organizer path.
- Event organizers can add additional organizers and roles do not currently expire.
- Official result rows can be edited directly without a complete correction audit path.
- The production `organizer@buhurtos.ca` test account therefore inherits platform-wide destructive team capabilities under the current permission model.
- `/test-login` restrictions are client-side and should not be treated as a security boundary.

## Historical-record findings

- Reopening a match in a finished competition can trigger deletion of that competition's official results.
- Team merges repoint historical entries to the surviving team and delete the other record.
- Historical results therefore show the current surviving team identity rather than reliably preserving the identity used at the event.

## Fighter identity findings

- Accepting a registration or team-join request may create a new fighter whenever the account is not linked to an existing fighter.
- Duplicate fighter records are therefore not merely hypothetical.

## Synthetic data findings

- The hosted database contains 16 synthetic test events.
- The review reported that all current hosted matches and results were fictional at the time of inspection.
- A machine-readable source marker already exists for the fictional NACL test dataset and tags hundreds of records.
- The application does not currently use that marker consistently to distinguish fictional records in the public experience.
- Simply unpublishing the test events would not hide all synthetic teams, fighters and organization records.

## Supabase Free plan findings

The review identified the current hosted project as being on the Supabase Free plan and reported:

- 200 concurrent Realtime connections
- 100 Realtime messages per second
- no downloadable platform backup
- no point-in-time recovery
- project pausing after inactivity under the Free plan rules

No independent production export had been taken at the time of the review.

The owner has since chosen to remain on Free for now and accept this limitation, with one independent full export before the Rumble stored in two separate locations.

## Realtime findings

- Three subscription sites were reported to use broad, unfiltered realtime subscriptions.
- A change can trigger refetching all 17 Rumble competitions.
- The estimated effect reported by the review was about 51 HTTP requests per change for a spectator path.
- For the Rumble, the owner prefers the smaller fix: targeted server-side filtering and targeted refetches rather than a pre-event Broadcast migration.

## CI and deployment findings

- `main` was reported to have no branch protection.
- The CI pipeline did not run the full database check suite.
- Pushes could deploy without the desired database gate.
- Event-day service-worker activation could replace code while a scoring session is active.

## Corrections to earlier architecture advice

The review specifically corrected these earlier assumptions:

- Workbox itself was not the main iOS problem. The gap is what is queued and what authenticated state can be reloaded.
- The relevant current Realtime limit for this project is the Free-plan limit, not a much higher generic subscriber figure.
- Offline limitations start earlier than finalization because authenticated event state cannot be reconstructed after an offline reload.
- Synthetic records already have a useful source marker.
- Bracket integrity is weaker than previously assumed because participant changes, seed storage, multi-step generation and tie handling are not fully protected.
- Route and permission inspection exposed platform-wide organizer powers that a code-blind architecture review could not have known.

## Owner interpretation

These findings justify targeted remediation, not a full platform rewrite.

The Rumble does not require the entire product to run indefinitely without internet. Paper is the primary official fallback. The pre-event goal is to prevent data loss, accidental cross-user queue replay, silent conflicts, unaudited sporting-record changes and brittle bracket generation while preserving time for the product itself.
