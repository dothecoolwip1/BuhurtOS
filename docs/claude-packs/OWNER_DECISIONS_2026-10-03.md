# BuhurtOS owner decisions

Date: 2026-10-03

These are owner decisions gathered after the Round 1 and Round 2 architecture reviews. They override older assumptions where they conflict.

## Production permissions

- Keep the current `@buhurtos.ca` test accounts until after the Rumble.
- Platform administrators have platform-wide team approval and merge authority.
- Organization administrators may manage teams within the organization they administer.
- Event organizers do not receive platform-wide team merge or delete authority merely because they organize an event.
- An event organizer may add another organizer to that same event.
- Event-specific roles should expire shortly after the event finishes.

Keeping the test accounts does not mean preserving accidental global permissions. Permission scoping should make those accounts no more powerful than their legitimate roles.

## Supabase and recovery

- Keep Supabase as the backend.
- Stay on the Supabase Free plan for now.
- Do not start a Supabase portability or exit project.
- Take one full independent production export before the Rumble.
- Store that export in at least two locations separate from Supabase.
- The Free-plan recovery limitations are accepted for now and should remain documented as an operational risk.

## Synthetic and test data

- Synthetic data may stay in production.
- Synthetic events, teams, fighters, matches and results must be clearly labelled as test or fictional data wherever they are shown.
- Synthetic data must not silently contribute to official rankings, official historical records, official statistics or other aggregates presented as real.
- No separate QA Supabase project is required at this time.
- Reconsider isolation later only if production testing becomes difficult or dangerous.

## Offline and scoring

- Do not build a full offline-sync system before the Rumble.
- Do not migrate to PowerSync or another sync engine before the Rumble.
- Events are expected to have internet connectivity the great majority of the time.
- The goal is resilience to brief outages, not indefinite disconnected operation.
- Move durable unsent scoring work from `localStorage` to IndexedDB.
- Bind queued work to the user and event that created it.
- Keep refused or failed queued work durably for review instead of silently deleting it.
- Match finalization requires network connectivity for the Rumble.
- A field screen that remains open may continue preserving local work during a brief outage. A fresh offline reload is not required to reconstruct the full authenticated event workspace.
- Locally entered work should be visibly pending until accepted by the server.
- The normal scorekeeper experience may remain simple with Pending and Official states.
- Conflicting final results require human intervention. They must never silently resolve by last-write-wins.
- The head marshal is the event-day authority for resolving a scoring conflict.
- Conflict details may appear as a dedicated Needs Review state for authorized officials even if ordinary scorekeepers only see Pending and Official.

## Paper record

- Paper score sheets are the primary official fallback at the Rumble.
- BuhurtOS is the fast digital operating path and should mirror the official result.
- Build a simple authorized Enter Official Result recovery path for transcription or correction from paper.
- The paper process must be rehearsed before event day.

## Match versions and bracket integrity

- Changing who is fighting in a match must increment the match version.
- Brackets should be built atomically in one server-side database transaction.
- Save random draw seeds for major events such as the Red Deer Rumble.
- Pool ties should require organizer intervention rather than allowing browser and server algorithms to disagree.
- A manual tie decision must be recorded deterministically so every client displays the same advancement and placing afterward.

## Official results and history

- Reopening a competition must not silently delete official results.
- Official results should be corrected, voided or superseded while preserving history.
- Organizers may correct official results, but the editor, time, previous value, new value and reason must be auditable.
- Historical event displays should be able to show both the team name used at the event and the team's current name.
- Team mergers must preserve the original historical team identity and link it to the successor rather than rewriting history as if the successor always competed.

## Service worker and deployment

- A new app version may download during an event.
- Do not activate a new service worker in the middle of active scoring or while important work is unsynced.
- Replace the current unconditional immediate takeover behaviour with a safe update flow.
- Critical fixes may still be deployed during an event when needed.
- Scoring commands should have a versioned schema with a backward-compatibility window.
- Protect `main` with required checks.
- Production deploys should be frozen around the Rumble except for emergency fixes.
- Readiness requires database tests, browser tests and real-phone airplane-mode rehearsal.

## Realtime and spectator scale

- Before the Rumble, keep the existing realtime approach and make it efficient.
- Filter realtime to the relevant event or competition on the server where possible.
- Refetch only the competition or state that actually changed instead of all competitions.
- After reconnecting from a dead zone, fetch authoritative state before showing the spectator as LIVE again.
- Do not build Broadcast plus CDN snapshot infrastructure before the Rumble.
- Expected Rumble scale is around 100 people on site and perhaps 30 remote live viewers.
- Keep useful event analytics and statistics for the Rumble, but do not confuse analytics collection with realtime transport architecture.

## Fighter identity

- Product rule: one user account represents one fighter.
- Database constraint should enforce at most one fighter link per account and at most one account link per claimed fighter.
- Fighter sporting records may still exist without an account for historical, imported or organizer-created participants.
- When duplicate fighter identities are detected, notify administration for manual conflict resolution rather than auto-merging records.
- Prevent the known flows that create unnecessary duplicate fighter records.
- Basic identity linking and duplicate prevention are pre-Rumble work. A sophisticated self-service claim and merge system may wait.

## Rankings

- Organization rankings remain official within their own organization.
- BuhurtOS may eventually also offer a separate statistical rating.
- If an independent BuhurtOS rating is added, start with an explainable Elo-style approach unless later evidence supports something better.
- Clearly distinguish an organization's official ranking from any BuhurtOS statistical rating.
- Published ranking snapshots should be immutable. Corrections create a new superseding snapshot.

## Public experience

- The homepage should explain what buhurt is quickly and lead people toward teams and events.
- Team discovery should work by city, town, province or state, or postal code without requiring precise GPS.
- Factual spectator explanations should be generated from deterministic rules and scoring data rather than asking an LLM to infer why someone won.

## Architecture

- Postgres and controlled server-side RPC or command handlers are authoritative for permanent sporting records.
- Important state changes should express a domain action such as Finalize Match rather than allowing arbitrary browser edits to official rows.
- TypeScript and SQL implementations of the same sporting rule should be checked against shared test vectors where both layers perform related calculations.
- Keep Supabase. Maintain reasonable boundaries, but do not spend pre-Rumble time on hypothetical migration work.

## Later decisions

- Re-evaluate PowerSync or another sync engine only if real event usage proves the lightweight approach insufficient.
- Eventually define a portable open buhurt results format.
- Workspace membership, sporting affiliation and federation sanctioning must remain separate concepts.
- Keep cryptographic tamper-evident auditing as a possible future enhancement, not pre-Rumble work.
- Do not build 20,000-viewer infrastructure now.
- Broadcast plus CDN snapshots are a post-Rumble scaling option if usage justifies them.

## Priority rule

Reliability and new features may proceed in balance, but a proven security, data-loss or sporting-integrity blocker outranks cosmetic or convenience work.
