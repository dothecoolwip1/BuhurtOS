# BuhurtOS Rumble pack status

Branch: `ccr-a435c5f7-pmrfxr`

Last updated: 2026-10-04 (main's Pack 1 merged; Pack 07 / Pack 1 reconciled; Pack 08 added)

## Pack status

| Pack | Status | Commit | Hosted DB | Deployment | Verification notes |
| --- | --- | --- | --- | --- | --- |
| 00 Source of truth | COMPLETE | (see git log) | none (docs only) | none | Docs only. PROJECT_SPEC reconciled, CLAUDE.md added. Round 2 scratchpad was empty in this container: only the committed Part 1/Part 2 reviews exist; the ChatGPT comparison was not recoverable. |
| 01 Security and data safety | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | PARTIAL: non-destructive parts applied (can_admin_team, team authority functions, event-role expiry, synthetic flag/views, team read policies altered). NOT applied: `drop function private.is_any_organizer()` (blocked by the tool; function remains, unreferenced) | none; not deployed | Local gates pass (see Pack 01 notes). Hosted permission holes are STILL OPEN until the migration is applied. |
| 02 Tournament integrity | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | PARTIAL: applied match-version trigger, draw columns, `pool_tie_decisions`, group_ranks/base_points/tier_points/compute_places/unresolved_ties/pool_standings. NOT applied (every statement containing DELETE/DROP was cancelled by the tool): record_tie_decision, tie-clear trigger, result_revisions + results write lockdown, finish/correct/void/unfinish, build_schedule, team_merges/merge patch. Hosted `finish_competition` is still the OLD one | none; not deployed | Local gates pass. Browser flows not verified (no local Supabase stack here). |
| 03 Scoring resilience | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED (needs Packs 01 and 02 migrations first) | none; not deployed | Local gates and a real-Chromium run against a MOCKED Supabase pass. Real phone and iOS not tested. |
| 04 Event runtime safety | REPO COMPLETE, NOT RUN IN GITHUB, MAIN NOT PROTECTED | (see git log) | NOT APPLIED (migration 20261003000400 command window; needs 01 to 03 first) | none; not deployed | Everything passes locally. CI workflow rewritten but never executed on GitHub yet. Branch protection and real-phone rehearsal are owner/human steps. |
| 05 Identity/public data/stats | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED (migration 20261003000500; needs 01 to 04 first) | none; not deployed | Local DB gates and unit tests pass. Public pages not viewed in a browser against real data. |
| 06 Post-Rumble roadmap | ROADMAP COMPLETE (not implementation) | (see git log) | n/a | n/a | Documentation only: docs/ROADMAP_POST_RUMBLE.md. Nothing in it was built. |
| 07 Phone UX workflows (results on test events, competitions, waiver choices, venue search, organizer-added fighters, social links, gallery, calendar, My events) | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED: migration 20261003000600 holds `drop constraint` / `drop policy if exists` / `alter column ... drop not null`, which the hosted migration tool refuses; owner runs it in the SQL Editor (notes below) | none; not deployed | Local: database gate (9 suites, pack07_gate 108 checks), vitest 557, tsc, build, Chromium 390px browser test 81/81 (mocked Supabase). Real phone not tested. |

## Current known constraints

- Supabase Free plan remains in use.
- Paper is the primary official fallback for the Rumble.
- Full offline-first operation is not a pre-Rumble requirement.
- Finalization requires signal for the Rumble.
- No sync-engine migration before the Rumble.
- No Broadcast/CDN migration before the Rumble.
- Test accounts remain until after the Rumble.
- Synthetic data may remain visible when clearly labelled and excluded from official aggregates.

## Pack completion template

For each completed pack, record:

- status
- commit SHA
- migrations added/applied
- hosted database verification
- automated tests run
- browser verification
- real-phone verification where relevant
- deployment state
- unresolved risks
- explicit deferred work


## Pack 00 notes
- Files: `docs/PROJECT_SPEC.md` (reconciled), `CLAUDE.md` (new), this file. No code, schema or data changed.
- Contradictions corrected: organizer team approve/merge authority, full-offline scoring requirement, added a 2026-10-03 override section (Supabase Free, no sync engine, paper fallback, finalization needs signal, test data, history, identity).
- Not recoverable: the Round 2 scratchpad report and the ChatGPT-vs-code comparison were not present in this container; only the already committed `docs/reviews/2026-10-03-interrogation-part1.md`, `part2.md` and `REVIEW_FINDINGS_2026-10-03.md` exist.

## Pack 01 notes
Inspected hosted DB (read-only, project `mvbxlebznlgroptwwdsm`): `approve_team`, `merge_teams`, `new_team_request_details`, `team_roster` and three read policies used `private.is_any_organizer()` (any event organizer); `can_assign_captain`, `can_manage_team`, `team_requests_inbox`, team notifications used `is_platform_organizer()` (owner or approved event creator). Platform roles: one owner (garrettrobson95@gmail.com). `organizer@buhurtos.ca` is organizer and `scorekeeper@buhurtos.ca` scorekeeper of `red-deer-rumble-test` only.

Repository changes: migration `supabase/migrations/20261003000100_pack01_permissions_synthetic.sql`; `private.can_admin_team` (owner or admin of the team's organization) now governs approve/merge/request details/roster of pending teams/captain assignment/team editing; `is_any_organizer` dropped; event_staff roles count only until 7 days after the event's last day (rows kept); `sources.synthetic` flag set on the NACL source; `result_rows`, `match_sides`, `played_events` exclude synthetic events (so rankings, career/season/team stats ignore them); history views gain a `synthetic` flag; `synthetic_records` view; Test-data badges on event, team, fighter lists and pages; seeds/generator set the flag; export and restore scripts plus `docs/runbooks/PRODUCTION_EXPORT_AND_RESTORE.md`.

Local verification (throwaway Postgres 16, schema rebuilt from all migrations): security_gate 699, captain_gate 65, team_admin_gate 69, activity_gate 90, new pack01_gate 70 checks pass; NACL league verifier 68/68 (with the flag cleared in the scratch DB only); `tsc` clean; vitest 474 pass; `vite build` ok. pack01_gate fails against a database built without the new migration (negative control). Existing gate assertions that encoded the old organizer powers were changed to the new rules.
Export/restore: scripts rehearsed against a local database only (checksums verified, row counts matched). **No production export has been taken.**
Not verified: hosted behaviour, browser rendering of the Test badges, any deployment.


## Pack 02 notes
Migration `supabase/migrations/20261003000200_pack02_tournament_integrity.sql` (not applied to hosted; apply after the Pack 01 migration).

Tables/functions changed:
- `matches`: new trigger `matches_bump_version` increments `version` whenever entry_a, entry_b, stage, pool, next_match_id or next_slot changes (so a stale command cannot score replacement entrants). Note: linking a freshly built bracket also bumps the version, so clients must read the current version (the simulation test was changed accordingly).
- `public.build_schedule(competition, plan jsonb, mode new|replace|append, draw, advance)`: one transaction under a row lock on the competition; validates keys/links/entries; `append` also checks pools are final, no unresolved tie in the advancing places, and that the plan's entrants equal the database's qualifiers. Stores `competitions.draw_seed / draw_mode / draw_algorithm / drawn_at` (no account id: who drew is in audit_log) and sets `competitions.structure` from the draw format. The browser still plans matches (shuffle/seeding stays in TypeScript, algorithm label `ts-draw-v1`); the database validates and persists. The browser no longer inserts matches itself for draws.
- Pool ties: `private.group_ranks` is the single ranking (wins, score difference, head-to-head among entries level on both, points scored, then recorded decision). `private.compute_places` now uses it. New `pool_tie_decisions` table, `public.record_tie_decision`, `public.pool_standings`. A tie within the advancing places blocks `build_schedule(append)`; a tie for a medal place blocks `finish_competition` for round robins. A decision is cleared if a pool/round-robin result changes. The browser no longer ranks pools or breaks ties by id; the spectator pool tables use the database rank.
- Results: organizers can no longer insert/update/delete `results` directly (policy and grants removed). Writes go through `finish_competition`, `correct_result`, `void_result`, all appended to `result_revisions` (append-only, enforced by trigger even for the table owner) with actor, time, old/new place and points, and reason. Reopening a match supersedes results into the log instead of silently deleting them (`bos.reopen_reason` carries the reason). Re-finishing after a hand correction is refused until a match is reopened.
- Team identity: `entries.team_name_at_event` snapshot (backfilled from current names), `team_merges` successor link, merge_teams patched to preserve the snapshot; `team_history` now exposes `team_name_at_event`, `team_current_name`, `team_current_slug`.
- Shared rule vectors: `supabase/tests/vectors/league_points.json` checked by `src/lib/tournament.test.ts` and `supabase/tests/vectors_gate.sql` (`private.base_points`, `private.tier_points`).

Local tests (throwaway Postgres 16): pack02_gate 69 checks; real two-session concurrency test `pack02_concurrency.sh` (second request blocks on the lock, is refused, one schedule of 2 matches, seed stored); security_gate 703, captain 65, team_admin 69, activity 90, pack01 70; tournament simulation passes; NACL league 68/68 (the fictional seed now settles its ties through `record_tie_decision`). Negative control: pack02_gate fails on a database without the migration. Vitest 488, tsc, build pass.
Scenarios covered: stale version after side swap; failed builds leave nothing (bad link, foreign entry, duplicate key); second concurrent build refused; 3-way pool cycle blocks advancement, decision recorded (actor/time/note/audit), public order and official placings agree; non-qualifying plan refused; correction audited and log immutable; reopen supersedes with reason and old values; direct result writes blocked; merge keeps event-time name with successor link.
Not verified: hosted DB, any browser run of the organizer flows (tie UI, draw builder), real phones. Known limits: the draw shuffle/seeding is not reimplemented in SQL (database validates structure and standings, not the shuffle); entries merged before this migration have no event-time name beyond the current one (names were backfilled from today's team names).


## Pack 03 notes
Migration `supabase/migrations/20261003000300_pack03_scoring_commands.sql` (not applied to hosted). New event role `head_marshal` (can score and settle disagreements; not an organizer); `private.can_resolve_results` = organizer or head marshal. `public.submit_match_result` (idempotent on a device-chosen command id, schema version 1, expected match version) answers accepted / duplicate / conflict / stale and stores every proposal in `result_proposals`; a different result for an already-final match is KEPT as a conflict, never applied (no last-write-wins). `list_result_conflicts` and `resolve_result_conflict` (keep_official | use_proposal, note required, audited, evidence retained), `enter_official_result` (paper recovery through the same finalize/reopen machinery, so results are superseded into `result_revisions` and the audit log records the sheet note). `private.reopen_match_core` is reopen_match without the organizer check, used only by those controlled paths.

Client: `src/lib/outbox.ts` rewritten on IndexedDB (`src/lib/idb.ts`): each entry has user, event, subject, schema, local sequence, status and error; flush only sends the signed-in user's entries; order is kept per match; one failing match no longer blocks others; refused entries are KEPT (status rejected, reason, retry/discard); no signal stops the run without losing anything. Boards are in IndexedDB bound to user and event; the finalization command id is created once per board and stored before sending. Old localStorage queue entries are imported as refused (never replayed), old boards are adopted once by whoever opens that match. Field screen: Pending vs Official chips; finalization shows "Pending: NOT official" with the paper-sheet instruction when it cannot reach the server; "Needs review: not changed" when the server kept this device's result as a conflict; head marshal/organizers get a Needs review list and an Enter official result from paper form.

Failures reproduced BEFORE (old Outbox, temporary tests): a second user flushed the first user's queue; one entry returning retry blocked an unrelated match for 50 flushes; a rejected entry was removed from storage (lost on reload). AFTER: the same scenarios in src/lib/outbox.test.ts pass against the real Outbox on IndexedDB (fake-indexeddb): cross-user isolation, per-match progress, rejected entries survive reload and can be retried/discarded by their owner, queued work survives signal loss + reload and is delivered exactly once, a lost reply re-sends the same id, legacy import.
Server: pack03_gate 63 checks (idempotent repeat, someone else's command id refused, stale refused as evidence, duplicate vs conflict, official result untouched, evidence + audit kept, scorekeeper cannot list/resolve, head marshal resolves both ways, paper entry and correction, correction after a finished competition supersedes results with the paper reason). Negative control: the gate fails without the migration.
Browser (real Chromium 1194, built app, MOCKED Supabase via Playwright routes, `scripts/e2e/field-pack03.mjs`, 28 checks, mobile viewport): offline scoring kept in IndexedDB bound to the user; Pending shown, never Official, while offline; second account on the same device sends nothing and sees the explanation; reconnect delivers each action once; reload restores the half-scored board; finalization with a lost reply is retried with the same command id and applied once; conflict shows Needs review; head marshal sees both results, needs a note, and the audited resolve call is made; paper form calls the audited function; no sideways scroll on the pending screen. This proves the app's behaviour, not the real database.
Not verified: hosted DB, real phones, iOS Safari/PWA IndexedDB eviction (iOS can evict site data after long inactivity; paper stays primary), fresh offline reload (not required), service-worker interplay (blocked in this run; Pack 04).


## Pack 04 notes
Code: `public/sw.js` no longer calls skipWaiting in install: a new build downloads and WAITS; it activates only after the page sends SKIP_WAITING (first visit still activates at once). `src/lib/swUpdate.ts` (policy `updateSafety`, `scoringGuard`, registration, reload once on a real update) and `src/components/UpdateBanner.tsx` (mounted in Layout): "A new version is ready", explains why it is waiting (scoring screen open, unconfirmed score actions on the device from any account, part-scored boards or unconfirmed finalizations), offers Update now only when safe and an explicit two-step "Update anyway (emergency)". Finalization command window: `private.command_schema_ok` (1..1 today) used by `submit_match_result` (migration `20261003000400_pack04_command_window.sql`); client entries from a newer schema than the app are kept and shown, not guessed at.
Realtime: `src/lib/liveSync.ts` (+ `useLiveMatches`): server-side filter `competition_id=in.(...)` on matches and entries (no unfiltered table subscription), targeted refetch of only the competition that changed (debounced, coalesced), full re-read on (re)connect, and the screen claims Live (`LiveStatus`, bracket LIVE labels) only after SUBSCRIBED plus a completed full re-read; otherwise it says "Reconnecting ... refreshing every few seconds". The field screen's channel is filtered too and reads its whole queue in one request. No Broadcast/CDN added. Measurement (modelled from the old code vs the real coordinator, `liveSync.test.ts`): 30 change events over 12 s on a 17-competition event: BEFORE 1530 requests (every event re-read all 17 competitions x 3 requests), AFTER 90; initial load 51 in both. This is arithmetic from the code, not a live capture. Duplicate subscriptions/refetch loops: one channel per event key, cleaned up on unmount; in-flight reads are coalesced.
Analytics (existing first-party/PostHog design, no precise location): events `live_connection`, `live_refresh_failed`, `result_official`, `result_pending_no_signal`, `result_conflict`, `result_stale`, `score_action_refused`, `app_update_ready`, `app_update_applied`; database-side counts for the postmortem are in `docs/runbooks/EVENT_ANALYTICS.md`. Not available without new infrastructure: per-competition spectator interest, exact concurrent viewers (Supabase dashboard).
CI: `.github/workflows/pages.yml` now has `check` (typecheck, unit tests, build), `database` (Postgres 16 service, `supabase/tests/run_all.sh`: migrations from zero, security/captain/team_admin/activity/pack01/02/03 gates, shared vectors, schema fingerprint vs `supabase/schema.fingerprint.txt`, tournament simulation, fictional-league verifier, two-organizer concurrency), `browser` (real Chromium: `scripts/e2e/field-pack03.mjs`, `scripts/e2e/sw-update.mjs`), `release-policy` and `deploy` (needs all of them; skipped while `PRODUCTION_FROZEN=true` unless a manual run sets `emergency` with a reason). Schema drift: `supabase/tests/schema_fingerprint.sql` / `check_fingerprint.sh` (repository rebuild vs committed snapshot; the same SQL can be run read-only on the hosted project to diff, grants excluded). No generated DB types were introduced.
Local results: run_all.sh DATABASE GATE PASSED (all suites, vectors, fingerprint, simulation, league 68/68, concurrency); vitest 514 pass; tsc, build pass; field-pack03.mjs 28/28; sw-update.mjs 22/22 (real Chromium, mocked Supabase, two real builds served one after the other: a waiting build does not take over a scoring session with pending work, banner explains, still old after 4 s, activation only after the work is confirmed and the screen left, cache cleaned, emergency path keeps the queued action and the half-scored board and the new build delivers the old build's action exactly once). Negative control: with the previous sw.js the same script shows the page reloading itself under the scorer.
NOT done / owner actions: (1) branch protection on `main` could not be applied (no tool for it): exact steps in `docs/runbooks/EVENT_RELEASE_POLICY.md`; (2) set repository variable `PRODUCTION_FROZEN=true` when the final pre-event release is done (no clock time invented); (3) the workflow has not run on GitHub: first run on the feature branch is unverified; (4) real-phone rehearsal NOT executed: `docs/runbooks/REAL_PHONE_REHEARSAL.md`; (5) hosted migration not applied; (6) deployment: nothing deployed.


## Pack 04 addendum (service-worker handover)
The CI run on the feature branch found a real problem the local run had hidden: in Chromium the handover to a waiting worker can hang (the new worker received SKIP_WAITING, `skipWaiting()` never resolved, no activation) while the page is open; reproduced locally about half the time and almost always with Playwright request routing on. Fix: `activateUpdate` now re-reads the waiting worker from the registration, and if control has not changed after 5 s and the device is online it unregisters the old worker and reloads, so the page installs the new build fresh (scoring data is in IndexedDB, not in the worker); offline it keeps the old build and says so. The browser test (`scripts/e2e/sw-update.mjs`, now 28 checks, 3 runs in a row 28/28 locally) has a third scenario that swallows SKIP_WAITING to prove the fallback keeps the queue and delivers it exactly once. Root cause inside Chromium not established; the fallback is what makes the update path reliable.
GitHub: workflow run 37152537060 on branch `ccr-a435c5f7-pmrfxr` (manual dispatch, commit f61b69a): `check` success, `database` success (the whole run_all.sh on GitHub's Postgres 16, ~3 min), `release-policy` success, `browser` FAILED only in the service-worker test (cause above), `deploy` skipped by design (not main). A re-run after the fix is recorded below.

## Pack 05 notes
Migration `supabase/migrations/20261003000500_pack05_fighter_identity.sql` (not applied to hosted).
* Identity rule: `fighter_accounts` already had fighter_id as primary key and user_id unique (one account = one fighter, one claimed fighter = one account), and accounts cannot write it (select policy only). Fighter records without an account stay valid. Both avoidable-duplicate paths (accepting a registration: `decide_registration`; accepting a team-join request: `decide_team_join`) are the only places that created fighters; both now call `private.ensure_fighter_for_account`, which takes an advisory lock per account, returns the existing link if there is one, otherwise creates and links one fighter. If an UNLINKED fighter with the same name exists it opens a `fighter_identity_reviews` row (and an audit entry) instead of linking or merging. Platform administrators see both records with context (team, account/no account, entries, sources, synthetic flag) in Platform > Fighter identities (`list_fighter_identity_reviews`, `resolve_fighter_identity_review`: "two different people" or "the same person (merge later)", note required, audited, nothing merged). Other users cannot read or decide them.
* Public synthetic labels: Test data badge on event cards and event page (with an explanatory note), team pages and lists, fighter pages and lists, and on each tournament-history line. Because the ranking/statistics views leave fictional events out (Pack 01), tournament history lists now read `fighter_results_all` / `team_results_all` (new views with a `synthetic` flag and event-time team name) so fictional history is still visible, labelled; career statistics for a fictional fighter therefore read zero, and the note on team pages says fictional results are not counted. Rankings page copy now says each ranking is the organization's own official ranking and fictional events are never counted.
* Team history: team result lines show "played as <name used at the event>" when it differs from the current name (`playedAsName`), from `entries.team_name_at_event` (Pack 02).
* Deterministic explanations: `src/lib/matchExplain.ts` writes one factual sentence per finished bracket match from the recorded result and detail (fixed templates; no model); shown under each finished match in the bracket.
* Direction recorded in `docs/PROJECT_SPEC.md` (rankings official per organization, separate Elo-style rating later, immutable snapshots; team discovery by place never needing GPS; no ranking engine built). No team-near-me feature was touched.
* Analytics: Pack 04 events do not distinguish fictional traffic from real by themselves; the event pages carry the Test data label, and database-side counts in `docs/runbooks/EVENT_ANALYTICS.md` use real event ids. Page-view paths of fictional events (`/events/<slug>-test`) can be excluded by slug in the Insights queries; not automated.
* Tests: `pack05_gate.sql` 43 checks (linked account gets no second fighter via registration or team join; new account gets exactly one, second flow reuses it, both orders; direct inserts that would double-link are refused (23505), users cannot write the link table; look-alike opens a review without linking or merging, source kept, audited; organizer/stranger cannot see or decide reviews, the administrator sees both records with context, decisions need a note and cannot be repeated; history views keep fictional results flagged while rankings/statistics see only real ones; a merged team's old result keeps "Old Name -> Successor"). Unit tests for playedAsName, tournamentHistory flags, explainResult (deterministic).
* Deferred on purpose: self-service claim/merge, slug history, any ranking engine, team-near-me, per-competition spectator analytics.

## Pack 06 notes
`docs/ROADMAP_POST_RUMBLE.md`: evidence to collect and where it lives, and a decision record (decision now / revisit when / evidence needed / not doing) for sync engine, realtime scaling, open results format, ranking architecture, organization/federation concepts, QA environment, cryptographic audit, Supabase, fighter identity follow-ups, large-event scale. ROADMAP COMPLETE, not IMPLEMENTATION COMPLETE. Nothing from it was built.


## Hosted migration blocker (recorded at end of run)
`mcp__Supabase__apply_migration` cancels any migration containing DELETE/DROP statements (even `delete from` inside a function body). This is treated as an owner-confirmation gate and not bypassed. Remaining hosted work must be run by the owner, in order, from `supabase/migrations/` (`supabase db push`, or the SQL editor): finish 20261003000100 (drop of `is_any_organizer`), the remainder of 20261003000200 (hosted already has its sections 1, 2 and the ranking functions; re-running the whole file will fail on `create trigger`/`create table`, so edit those to `if not exists`/`drop trigger if exists` first or run from a fresh section marker at `record_tie_decision`), then 0300, 0400, 0500. Until then hosted permission holes from Pack 01 (organizers' team powers via `is_any_organizer`-using functions are patched; results table still organizer-writable) remain partly open. GitHub run 37153958665 on 80fdc03 (check, database, browser, release-policy): success; deploy not run (feature branch).

## Hosted reconciliation (2026-10-03, feature work stopped)
Full record: `docs/claude-packs/HOSTED_RECONCILIATION_2026-10-03.md`. Correction to the note above: hosted DID have `private.can_score`, in its
original (pre-Pack 03) form; it was an old version, not missing.

* **Hosted inventory.** Measured read-only and matched exactly by a local replica (929 objects, hash `cf4b0bee...`). Against the branch:
  61 objects match, 135 are missing, 12 are old versions, 2 are partial.
* **Rollout script.** `supabase/manual/hosted_rollout_packs_01_05.sql` (generated; guard + sections A-H + 135 rolled-back verification
  checks). Tested locally: on the replica it applies and reaches the branch fingerprint, and all 135 checks pass. Running it again changes
  nothing. It refuses 4 wrong states, and existing data is byte-identical afterwards.
* **Canonical migrations.** 0100/0200 are now rerunnable from the hosted state; the clean-build fingerprint is unchanged and the full
  database gate passes.
* **HOSTED STATE: STILL PARTIAL.** The owner has to run the script in the Supabase SQL Editor; the hosted migration tool refuses
  DROP/DELETE, and that refusal is not bypassed. After the owner's run: re-measure the fingerprints, run the hosted permission tests and the
  advisors, and record them in the reconciliation file.
* **Do not use `supabase db push`.** The hosted ledger versions differ from the repository's; see section 7 of the reconciliation file.


## Pack 07 notes (phone UX workflows, 2026-10-03)
Migration `supabase/migrations/20261003000600_pack07_ux_workflows.sql` (rerunnable; applies from zero; NOT applied to hosted). Gate
`supabase/tests/pack07_gate.sql` (108 checks, in `run_all.sh`). Schema fingerprint updated. Browser test `scripts/e2e/pack07-ux.mjs`
with `scripts/e2e/mock-rest.mjs` (a PostgREST/Storage stand-in), added to the CI browser job (plus a second build with a fake Google key to
prove the manual fallback).

What was actually wrong, and what changed:
1. **Synthetic event results.** The event page's record read `result_rows`, the official-only view from Pack 01, so a finished test event
   showed "No final placings". Now `fetchEventHistory` reads `result_rows_all` (Pack 05) and the Results and Statistics tabs carry a
   "Test data / synthetic event" note. Rankings, career/season/team statistics, played-event counts still read the official views only
   (gate checks 1a-1e; browser checks 1a-2c). No SQL change was needed.
2. **Waiver.** Versions were text only, numbered by the browser, inserted directly. Now `add_waiver_version()` numbers them, versions can be
   `text` or `pdf` (private bucket `waiver-documents`, readable only by the event's organizers and by anyone who may read a version that
   points at the file; never deletable once referenced), the organizer sees three choices (starter template with placeholders that must be
   replaced, upload PDF, write/paste), old versions stay readable, every registration still records the exact version signed, and the
   registration form shows the PDF or the text and says which version is being accepted. The starter template text says it is not legal
   advice (`src/content/waiverTemplate.ts`).
3. **Venue.** `VenuePicker` (Google Places "New" library: AutocompleteSuggestion + Place, session tokens, CA/US) on New event and Setup;
   fills venue, address, city, province, country and `events.latitude/longitude` (new nullable columns). No key, or Google unreachable:
   plain fields, with a sentence saying so. Nothing asks the phone for its location. Setup in `docs/runbooks/GOOGLE_PLACES.md` and
   `.env.example` (`VITE_GOOGLE_MAPS_BROWSER_KEY`, referrer-restricted browser key).
4. **Competitions.** There was no way to create one anywhere in the app (the Run tab and the publish checklist both dead-ended). Setup now
   has a Competitions section (add / edit / remove; the database refuses to delete a competition that has entrants, matches, results or
   registrations: trigger `competitions_delete_guard`), the checklist shows "+ Add competition" / "Add the waiver" beside each blocking
   item, the Run tab's empty state links there, and the event page's organizer panel says "Needs competition setup".
5. **Organizer adds fighters.** New `event_invitations` (+ competitions). Not a registration, not staff: `invite_fighter_to_event`,
   `cancel_invitation`, `withdraw_my_invitation`, `list_event_invitations` (has_account yes/no only), `withdraw_registration`. The
   fighter is notified (`event_invited`) only when the record has a linked account; otherwise the organizer is told nobody was notified.
   States: Invited: no linked account / Pending fighter confirmation (+ Pending form submission, Pending waiver) / Ready / Withdrawn /
   Cancelled. `submit_registration` lets an added fighter complete the form after the close and accepts it at once (the organizer chose
   them); `decide_registration` keeps the normal review for everyone else (accept body moved to `private.accept_registration_core`).
   Manage → Fighters tab; event page card "The organizers added you" with Complete / Withdraw; registrations can be withdrawn by the
   person or an organizer (entries withdrawn, organizers notified).
6. **Team social links.** Persistence and the public read were correct (hosted `red-deer-reavers` holds a Facebook link; anon reads it).
   The problems were the editor and the presentation: a bare `facebook.com/...` or an auto-capitalised `Https://` failed validation with
   one message at the bottom of the section, and the only way out wiped the links (`mountain-bears-test` audit shows two saves ending in
   `{}`); on the public page the links were small text pills at the bottom of About. Now `SocialLinksEditor` normalises on blur (adds
   https://, fixes the scheme, expands @handles), errors sit on the field, and `SocialLinksRow` shows icon buttons under the team's name.
7. **Fighter social links.** `fighters.social_links` (public, owner-only through `update_my_fighter_profile`, shared validator
   `private.clean_social_links`), same editor on Edit my profile, same row under the fighter's name.
8. **Gallery.** `fighter_gallery` (max 10, trigger + function), bucket `fighter-gallery` (own-folder insert/select/delete), WebP (or JPEG)
   at 1800 px made in the browser (canvas redraw drops EXIF), reorder, remove, "Profile photo" from a gallery image; public page shows a
   2-column grid only when photos exist, with a full-screen viewer (swipe, keys). Own-folder SELECT policies were also added for
   `avatars` and `team-emblems`: Storage's `remove()` needs SELECT, so old files were never actually deleted before.
9-12. **Events / Calendar / My events / Platform events** are four views over one loader (`useEventIndex`) and one pure rule set
   (`src/lib/eventFilters.ts`: search, format, organization, province, type, status, when, role, test-data toggle, sort order happening now
   → upcoming → drafts → past, grouping, month grid, .ics / Google Calendar export). `my_event_relations()` returns the signed-in
   person's real relationships (staff roles, fighter/volunteer registrations, invitations, own entries and rosters, captained team
   entries, organization admin); being the owner is NOT one, so the owner's My events is empty until they take part, and Platform →
   Events lists everything (test data included). Fictional events are hidden by default on every view and shown by the "Show test data"
   toggle (signed-in people); the toggle and every filter live in the URL. The account page links to My events / My calendar.

Not done / honest limits: real Samsung phone not used (Chromium at 390x844 with touch only); Google Places not exercised against the real
API (no key here; the loader, mapping and fallback are tested, the live round-trip is not); the hosted database still lacks Pack 07; nothing
deployed. The waiver clearance literals in `registration_clearance` / `team_clearance` are unchanged (out of scope). `scripts/e2e/lib.mjs`
(probe helper) still imports `playwright` which is not installed; unrelated and untouched.

**Hosted rollout (owner step, Supabase SQL Editor):** hosted now holds Packs 01-05 (checked read-only 2026-10-03: `result_rows_all`,
`ensure_fighter_for_account`, `submit_match_result` present; no `event_invitations`, no `waiver_versions.kind`; 0 waiver rows shorter than
20 characters). Run the whole of `supabase/migrations/20261003000600_pack07_ux_workflows.sql` once, as is; it is rerunnable. The hosted
migration tool refuses it because of `alter column body drop not null`, `drop constraint notifications_kind_check` and the
`drop ... if exists` guards; none of them touches data. Afterwards: `select count(*) from public.event_invitations` (0), check the two new
buckets exist, and run the Pack 07 section of a read-only verification (`supabase/tests/pack07_gate.sql` is a local throwaway gate; do not
run it on hosted).

## Pack 08 notes (organizer-added entrants and claimable fighter profiles, 2026-10-04)

Migration `20261004000300_pack08_entrants_and_claims.sql` (renamed from the colliding `20261004000100` during the main merge; never applied
anywhere hosted; additive, rerunnable; run it AFTER the Pack 07 migration because it re-adds the notification kinds). Gate `supabase/tests/pack08_gate.sql` (122 checks, in `run_all.sh`); browser script `scripts/e2e/pack08-entrants.mjs`
(54 checks at 390x844, mocked Supabase, in the CI workflow).

- **Add entrant** (Run area, per competition): search existing fighters (team and place shown, never auto-matched) -> add, or create a new
  fighter with no account (`create_unclaimed_fighter`: stable UUID, no auth user, no email, optional team/city/region/gender, entered in the same
  transaction). A same-name fighter is refused until the organizer confirms "different person"; the pairs are then queued for the platform
  administrator in `fighter_identity_reviews` (source `organizer_entry`). Individual competitions use a normal fighter entry; group fights
  (buhurt league) join a team entry's roster through `set_entry_roster`, so roster rules are unchanged. The entrant count reloads after every add.
  A draw that already exists is not rebuilt; the UI says to build a new draw.
- **Permissions:** `search_fighters_for_entry`, `add_entrant`, `create_unclaimed_fighter` are for organizers of that event only (strangers and
  organizers of other events get 42501). Synthetic fighters appear only for a synthetic event.
- **Claims:** `request_fighter_claim` / `cancel_fighter_claim` / `my_fighter_claims` / `search_unclaimed_fighters` (any signed-in user);
  `list_fighter_claims` / `resolve_fighter_claim` are **platform-owner only** (kept from the Pack 05 identity-review model; event organizers have no
  say). `fighter_claim_requests` has no grants; nobody can write `fighter_accounts`. Approval links the account to the EXISTING fighter id; nothing is
  created, copied or moved, and the other pending requests for that fighter are closed. Outcomes: `approved`, `declined`, `already_claimed`
  (the fighter got an owner first; nothing linked), `account_has_fighter` (the claimant already owns one; nothing linked, the pair is queued as a
  `claim_conflict` review). Email is deliberately not collected (the fighters table is public).
- **Audit:** `fighter.created_by_organizer` and `entrant.added` (visible to that event's organizers), claim decisions (owner-only, event id null).
- **UI:** "Unclaimed profile" chip on fighter pages and in the entrant list; "Is this you?" panel on a fighter page; `/claim-profile`
  ("Already have fight history in BuhurtOS? Find and claim your fighter profile"); a row on the account page; claims and look-alikes on
  Platform > Fighter identities; notifications for requested/decided claims.

Not done / honest limits: the hosted database does not have Packs 06/07/08 and nothing is deployed; the browser script runs against an in-memory
imitation of Supabase, so the database rules are proved only by the SQL gate; no real Samsung phone; entrants are not shown on the public event
page with the chip (only Run, fighter page, search);
no email notification, only the in-app bell.

## Pack 1 (post-audit corrective pack, 2026-10-04)
Source: `docs/reviews/2026-10-03-full-site-mobile-desktop-audit.md`. Branch `ccr-3b8f5e2b-gglnaw`. Six issues, one additive migration
`supabase/migrations/20261004000100_pack1_competitions_myevents_days.sql`, new gate `supabase/tests/pack1_gate.sql` (49 checks, in run_all.sh),
browser evidence script `scripts/e2e/pack1-live.mjs` (needs a real local stack; 37 checks at 390 and 1440).

1. Upcoming queries: `entries -> competitions` embeds now name `entries_competition_id_fkey` (`careers.ts`, `teamDirectory.ts`); `pool_tie_decisions` had
   made the path ambiguous (PGRST201) on every team and fighter page.
2. Synthetic results: the event's own record reads `result_rows_all` and labels fictional placings; `result_rows`, rankings and statistics are untouched
   (browser check: `result_rows` still returns 0 rows for the test event, `result_rows_all` 21 flagged rows).
3. Competitions: `create_competition` / `update_competition` / `delete_competition` (organizer-only, audited) plus trigger `competitions_guard` (no
   removal with registrations, entries, matches or results; category/division fixed once matches exist; finished competitions immutable; loaders
   without a signed-in user unaffected). New Manage › Competitions tab; the publish checklist and the Run tab link to it.
4. Scorekeeping: `ScorekeepingPanel` on the event page for staff who may score (one button per field with what is queued); the field page lists the
   other fields and links back. No per-ring assignment was added (the data model has none).
5. My events: `public.my_events()` (staff role, own registration, own fighter's entry, captained team's entry; drafts only for staff and registrants;
   the platform owner is not special). `/my-events` page (search, test events hidden by default, now / coming up / drafts / past, reason chips,
   outstanding items, View registration). `/events/<slug>/register` shows the existing registration instead of a blank form. The old staff-only
   `fetchMyEvents` / `pickMine` are gone.
6. Registration copy: attendance days come from the event's dates (`registrations.attend_dates`, legacy `days` kept and still accepted); fee and
   insurance wording no longer carries Rumble dates (fee note comes from the event's `fee_note`).

Verified locally: tsc, vitest 534, vite build, `run_all.sh` DATABASE GATE PASSED (migrations from zero, every gate incl. pack1_gate, fingerprint updated,
simulation, league 68/68, concurrency), `pack1-live.mjs` 37/37 against the local stack (Chromium, 390 and 1440).
Hosted (read-only inspection 2026-10-04): every object the migration depends on exists on the hosted project (pool_tie_decisions, result_rows_all,
registration_checks, team_roles, private.audit / is_synthetic / is_organizer; Packs 01-05 present), and none of the new objects exist yet. The MCP
`apply_migration` call for `20261004000100_pack1_competitions_myevents_days.sql` answered `cancelled` because the file contains `delete from`
statements inside function bodies (`delete_competition`, and the unchanged `delete from public.registration_competitions` in `submit_registration`);
that refusal is the owner-confirmation gate and was not bypassed. **HOSTED MIGRATION NOT APPLIED.** Owner action: run the migration file once in the
Supabase SQL Editor (it is additive and rerunnable except for `create trigger competitions_guard`, which exists only after the first run), then
`notify pgrst, 'reload schema'` is not needed on hosted (Supabase reloads on DDL). Deploy only after that, or the My events page and the
Competitions tab fail with "function not found" until the migration lands.


## Pack 07 / Pack 1 reconciliation (main merged into the Pack 07 + 08 branch, 2026-10-04)

Main's Pack 1 and this branch's Pack 07 were built in parallel and overlapped. Owner decisions (2026-10-04) applied:

- **Migration order:** `20261003000600_pack07_ux_workflows` -> `20261004000100_pack1_competitions_myevents_days` -> `20261004000200_pack07_pack1_reconcile`
  -> `20261004000300_pack08_entrants_and_claims`. No duplicate versions; no committed migration was edited.
- **Competitions:** Manage > Competitions (Pack 1's tab and create/update/delete functions) is the only editor; Pack 07's Setup editor
  (`CompetitionsSection`) is gone. Setup's publish checklist and the event/Run pages send "+ Add competition" to that tab. The reconcile migration
  drops Pack 07's `competitions_delete_guard` trigger and function, so Pack 1's `private.competitions_guard` is the one guard. Two adjustments,
  both stricter than or equal to Pack 1: (1) its no-user bypass now applies only to a direct database session (no API role, no request JWT: SQL
  editor, seeds, cleanup scripts, migrations); every API request, the service role included, is guarded, as Pack 07's guard did. Pack 07 had
  also refused direct owner sessions; that is not kept, because the seed cleanup scripts delete test competitions with entries and Pack 1
  documents that path. (2) The tier field Pack 07's editor offered is kept through a new organizer-only, audited `set_competition_tier`
  (refused for finished competitions), shown in the Competitions tab.
- **My events:** one database rule, `private.my_event_links(uid)`: staff role, own registration (any status, Pack 1), own fighter's entry or
  roster place, captained team's entry, and a pending organizer invitation (Pack 07). Platform owner and organization admin status give nothing
  (Pack 07's `org_admin` relation is removed). Drafts only for the event's staff and for registrants. `my_events()` (now with `invited`) and
  `my_event_relations()` both read it; the gate checks they name the same events for owner, org admin, organizer, invitee, registrant,
  volunteer, scorekeeper and captain. The page keeps Pack 07's view switch, search/filters, test-data toggle and grouping, with Pack 1's cards
  (reasons, registration state, fee, check-in, pending reviews, outstanding items, View registration / Manage / Scorekeeping / Complete
  registration). The event index loads both, so My events and My calendar agree, including events the person can only reach through their own
  registration (an event taken back to draft), which never appear on the general lists.
- **submit_registration:** one final definition in the reconcile migration: Pack 07's waiver-version check and invitation path (outside the
  window, auto-accept, invitation linked) plus Pack 1's `attend_dates` (event days only) and legacy `days`.
- **Tests adjusted, not weakened:** `pack07_gate` and `security_gate` expect the Pack 1 guard's error code (P0001) and now model the
  service-role path; `pack1_gate`'s fixture waiver is 20+ characters (Pack 07's waiver rule). New `pack07_pack1_reconcile_gate.sql` (54 checks).
  `pack07-ux.mjs` follows the Competitions tab and checks invitation/organization-admin behaviour on My events and My calendar.
- **Not verified here:** `scripts/e2e/pack1-live.mjs` (needs a real local Supabase stack, not available in this container); nothing hosted.
  Hosted rollout is an owner step in the SQL Editor, in the order above (Pack 07, Pack 1, reconcile, Pack 08); nothing is deployed.

## Hosted rollout of Pack 07 / Pack 1 / reconcile / Pack 08 (2026-10-04, in progress)

- Read-only inspection of hosted (mvbxlebznlgroptwwdsm): every migration through Pack 1 is present (Pack 1 was run earlier in the SQL Editor; it is
  not in the migration ledger); none of Pack 07, the reconcile or Pack 08. Schema fingerprint equals a local build of the same migrations: every
  table, column, constraint, index, policy, view and trigger identical; 27 function bodies differ only by whitespace / stripped comments.
- The Supabase MCP migration tool answered `cancelled` for Pack 07 (owner-confirmation gate for DROP/ALTER/DELETE). Not bypassed; nothing applied.
- Owner step: run `docs/runbooks/HOSTED_ROLLOUT_2026-10-04.sql` once in the SQL Editor. It applies the four repository files in order in one
  transaction (Pack 1 re-run without its `create trigger competitions_guard`, which hosted already has), with pre- and post-checks. Proven on a local
  replica of hosted: the result equals the full repository build and the pack07, pack1, reconcile, pack08 and security gates pass.
- main is not pushed yet: a push to main deploys, and the reconciled frontend needs these database functions. Production stays on main c4ec9d2
  (Pack 1 frontend + Pack 1 database, consistent) until the owner step is done.

## Synthetic organization rankings and persistent sample mode (2026-10-04)

- Database: migration `20261004000400_synthetic_org_rankings.sql` replaces `ranking_fighters` / `ranking_teams` only (same columns, types, grants,
  security_invoker). Organization scopes (`season`, `org_career`, `org_all`) count real results plus fictional results inside a fictional
  organization (`private.is_synthetic('organization', ...)`); a fictional event in a real organization or in no organization never counts; `career`
  stays real-only. `result_rows`, `fighter_results`, `team_results` and every statistics view are unchanged. Gate:
  `supabase/tests/synthetic_org_rankings_gate.sql` (37 checks, in `run_all.sh`).
- Hosted: NOT APPLIED. A read-only SELECT on hosted showed NACL-test (596 stored results, 0 ranking rows today) would get 590 / 224 / 120 fighter rows
  and 65 / 30 / 10 team rows (season / org_career / org_all); HACSA has no results and stays empty. The migration needs only Pack 01
  (`private.is_synthetic`) and Pack 05 (`*_results_all` views), both present on hosted, and contains no DROP / ALTER / DELETE.
- Frontend: sample mode is stored in localStorage (`bos-sample`) and stays on in that browser until `?sample=0`, Leave sample mode or the owner's
  switch under Platform turns it off; other open tabs follow at once. Browser test: `scripts/e2e/sample-mode.mjs` (34 checks, mocked Supabase).
- Deployment: none (feature branch only).

## Pack 09A: Event day command center and field queue (2026-10-04)

- Released 2026-10-04: hosted migration applied through the Supabase MCP, merged to `main` (`9d65342`), CI run #80 green, GitHub Pages deployed. Production browser smoke test was not possible from the release session (github.io egress blocked).
- Rankings fix (separate commit): Teams get their own categories from the ranking data, a "Top teams" overview and a division control only where a division exists. Frontend only. 16 unit tests, 22 browser checks.
- Database: `20261004000500_pack09a_event_day_queue.sql` (`matches.queue_order`, one rule for running order and for "can it run", commit-time automatic advancement, `advance_field_queue`, `move_match_in_queue`, serialized `set_match_queue`). Local only: full database suite passes (pack09a_gate 107, pack09a_concurrency 14, every existing suite, fingerprint).
- Frontend: Manage > Event day. Local only: typecheck, 663 unit tests, build; earlier browser suites unchanged (field-pack03 28, pack07-ux 86, pack08-entrants 54, sample-mode 34, rankings-teams 22); new `scripts/e2e/eventday-live.sh` run against a real local stack: 78 checks at 1280 / 768 / 390 px.
- Apply the migration before deploying the frontend (see docs/claude-packs/PACK_09A_EVENT_DAY.md, which also lists the known limits).

## Team discipline totals (2026-10-04)

Rankings > Teams has two separate team tables: **Discipline totals** (the default: fighters' individual ranking points summed by the team each fighter represented, per discipline) and **Team fights** (the existing team competition ranking, 3v3 / 5v5 and so on; heading "Team fight leaders").

- Formula unchanged: totals are derived from the same rows as `ranking_fighters`; group fight (team entry) results never count. Disciplines, names and divisions come from the data.
- Historical attribution: `entries.represented_team_id` (+ name at the event, + basis), set when an entry is created from evidence of that time (registration team, else the home team while the event is not over). An entry for an event that is already over gets no default; nothing is guessed.
- Correction UI: Manage > Run > (individual competition) > **Teams represented**. Organizer of the event (while their role is active, 7 days after the event) or the platform owner / organization admin: choose the team, give a reason, save through `set_represented_team` (audited: who, when, from, to, reason). It never changes the fighter's current team or memberships.
- Migrations: `20261004000600_team_discipline_rankings.sql` and `20261004000700_represented_team_embed_fix.sql`. 0700 replaces the foreign key on `represented_team_id` with triggers (team must exist; a represented team cannot be deleted): a second entries->teams foreign key made PostgREST refuse every `entries -> teams(name)` embed (PGRST201), which the app uses for entrants, matches, brackets and history.

### Hosted (mvbxlebznlgroptwwdsm), 2026-10-04

- Before: a read-only schema fingerprint of hosted equalled a local build of every migration through `20261004000500` (1170 objects; function bodies compared without whitespace/comments). None of the feature's objects existed.
- Applied with the Supabase migration tool (no SQL Editor step): `team_discipline_rankings` at 20:22:59 UTC, `represented_team_embed_fix` at 20:30:27 UTC. Between the two, `entries -> teams(name)` embeds were ambiguous on hosted; the API logs show no REST requests in that window. After: hosted fingerprint equals a local build of every migration (1184 objects).
- Back-fill by the migration: past NACL-test results got no team (no evidence); the upcoming fictional Rumble-test got 44 home-team + 1 registration attributions; the upcoming real `test-stuff-test` (4 entries, no results) got the fighters' home teams, the same rule a new entry follows.
- NACL-test back-fill (fictional data only): the 498 finished NACL-test individual entries were attributed through `set_represented_team` as the platform owner, reason "NACL-test fictional dataset: the team this fictional fighter belongs to" (498 audit rows). Evidence: the deterministic seed's fighter -> team map (120 fictional fighters, one team each for the whole dataset), checked against hosted (same team, no other memberships, every fighter and team tagged fictional) and guarded to fictional events only. No real record was changed; there are no real HACSA or Red Deer Rumble results on hosted.
- Verified read-only on hosted: 382 NACL-test discipline rows; in all 29 partitions team totals (+ unattributed, now 0) equal `ranking_fighters` points and every result is counted once; combined = sum of divisions; organization history 1796.25 = 1796.25; only longsword / polearm / sword_shield in discipline totals, only 3v3 / 5v5 in team fights; `ranking_fighters` (590/224/120) and `ranking_teams` (65/30/10) row counts unchanged; no fictional fighter or team in any all-time ranking; grants: views readable by anon/authenticated, `set_represented_team` executable by authenticated only.
- Pre-existing, unrelated: one HTTP 300 at 17:49 UTC for `entries?select=team_id,competitions!inner(event_id)` (src/data/teams.ts) — entries has two relationships to competitions; that query needs a hint. Not changed here.

### Reconciliation with Pack 09B and release preparation (2026-10-04)

- main had moved to `7c77bd8` (Pack 09B, 11 commits) while this branch sat at `4ee6b5e`. Overlapping files: `STATUS.md`, `run_all.sh` (conflicts, both sides kept: `pack09b_gate` and `team_discipline_rankings_gate` both run), `app.css` and `schema.fingerprint.txt` (merged cleanly; the fingerprint equals a fresh build of every migration, 1208 objects). No source file of Pack 09B (scorekeeper screen, Arena, live scores) overlaps ours. Migration order: 000600, 000700 (team discipline), 000800 (Pack 09B); all three are on hosted.
- Hosted re-verified read-only against the merged repository: the full schema fingerprint is byte-identical (1208 objects); one ledger row per migration, no duplicates; represented-team columns, constraints and both triggers, the correction function (authenticated only), both views, 498 audit rows. Nothing was re-applied.
- `src/data/teams.ts` (`fetchMyTeamRosters`): `entries` reaches `competitions` two ways (its own foreign key, and many-to-many through `pool_tie_decisions`), so the un-hinted embed was answered 300 / PGRST201. Reproduced on a real PostgREST and fixed with the explicit `competitions!entries_competition_id_fkey!inner(event_id)` (the relationship the other entries -> competitions embeds already name). Regression tests fail without the hint; no other un-hinted embed exists.
- The live browser test now also covers ties, divisions, a discipline known only to the database, tap-through, Show fighters, Team fights apart, and the "No team" correction (108 checks).
- Evidence on the merged tree: full database gate (pack09b 47, team discipline 53, fingerprint, simulation, league verifier, both concurrency tests); vitest 712; typecheck; build; field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, rankings-teams 22, sample-mode 34; real-stack represented-team 108, eventday 78, arena 103.

### Release (2026-10-04)

- Merged to `main` as `5d29f95` (merge commit; main had not moved, so its tree equals the tested feature tip `fcc596e`). No hosted SQL was applied: migrations 000600 and 000700 were already on hosted and were not re-run; no ledger rows were added.
- CI run #83 (push to main): typecheck/unit/build, database gate, browser suites, release policy (production not frozen) all green; Deploy GitHub Pages succeeded at 21:43 UTC from `5d29f95`.
- Production smoke of the deployed pages was NOT possible from the release session: `dothecoolwip1.github.io` and the Supabase API host are denied by the environment's network policy. Substituted: the queries the pages make, run read-only as the public (anon) role against hosted, in a rolled-back transaction (NACL-test leaders per discipline, full board, Show fighters breakdown = team total, Team fights separate, all-time discipline rows 0, 777 final matches untouched). Still to do by a person: open Rankings > Teams, an Event day screen, `/events/<slug>/arena` and sample mode on the live site.

### Local verification

Database gate (`run_all.sh`, includes `team_discipline_rankings_gate.sql`, 53 checks), vitest, typecheck, build; `scripts/e2e/represented-team-live.sh` (real Postgres + PostgREST + Chromium, 51 checks at 390 / 768 / 1280 px); `scripts/e2e/eventday-live.sh`; `scripts/e2e/rankings-teams.mjs` (mocked, 22).

- Known limits: docs/claude-packs/PACK_09A_EVENT_DAY.md.

## Pack 09B: Field-side scoring and the Live Arena display (2026-10-04)

- Released 2026-10-04: hosted migration applied and verified through the Supabase MCP (statement by statement; ledger `pack09b_live_scores`), merged to `main` (`cbf9bbb`), CI run #81 green, GitHub Pages deployed. Production browser smoke test was not possible from the release session (github.io egress blocked). Note: the hosted database also carries two migrations from another session's branch (`ccr-2b377afe-r59vjf`: team discipline rankings and its embed fix) that are not on `main`.
- Database: `20261004000800_pack09b_live_scores.sql`: `public.match_live_scores` (the running score a scorer's device reports for a fight in progress; public for published events, no account id, cleared by trigger when the match becomes final or is sent back), `public.report_live_score` (SECURITY DEFINER, explicit `can_score`, refuses final and stale, latest wins per device), publication membership. Local: `pack09b_gate` 47 checks, full database gate green, fingerprint 1194 objects.
- Frontend: the scoring screen (`components/scoring/ScoringScreen.tsx`) with a state banner, the two sides and the running score as the dominant element, OFFICIAL → Next fight on this field / Back to Event day; the device reports its running score while scoring. New public `/events/:slug/arena[/:field]` venue display outside the site chrome (one field, NOW with live score, result card, On deck / In the hole, fullscreen with fallback, realtime + polling). Links from the event workspace and Event day.
- Local evidence: typecheck, unit suite, build; earlier browser suites unchanged (field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, sample-mode 34, rankings-teams 22, eventday-live 78); `scripts/e2e/arena-live.sh` 103 checks against a real local stack with screenshots at 1920 / 1366 / 1024 / 768 / 390 px. Details and known limits: docs/claude-packs/PACK_09B_LIVE_ARENA.md.

## Pack 09C: Competition finalization, podiums, event closeout and official history (2026-10-05)

- Database (`20261004000900_pack09c_finalization_closeout.sql`, additive): `finished` stays the official boundary; new metadata (`competitions.finalized_at / reopened_at / multiplier_source`, `events.closed_at / reopened_at`), a server-side preflight (`competition_finalize_preflight`: blockers such as open or live fights, bracket or final missing, result conflicts, medal ties, a live score, a closed event; warnings such as fighters with no recorded team), atomic and idempotent `finalize_competition` (runs the existing `finish_competition`, same `compute_places` / `tier_points`, no new formula), audited `reopen_competition` with a reason (results superseded through `result_revisions`), server-side locks on matches / entries / competitions / events once official or closed, `event_close_preflight` / `close_event` / `reopen_event`, the public `competition_results` view (team as it was at the event, the fighter's represented team, no account ids), `competitions` + `events` in the realtime publication, legacy `finalized_at` back-fill. Removal of result rows and tie decisions lives in three private helpers the audited paths call (see the pack doc for why). Local: `pack09c_gate` 136 checks, a two-session concurrency test, full gate green, fingerprint 1237 objects.
- Frontend: Event day labels every competition Official / Ready to finalize / Needs review (blocker named) / Reopened; Manage › Results (review screen with the server's state, blockers, warnings, podium and full placings as they would be recorded, multiplier source, Finalize dialog, Reopen with a reason, a round-robin medal tie decided in place, event closeout card, Close event, Reopen the event); public event page and history show official podiums and full results with rosters on request; Arena shows Event complete / Field complete; a realtime watch on the event's competitions and events rows (plus a slow poll) refreshes every screen.
- Local evidence: typecheck, unit suite (728), `scripts/e2e/finalize-live.sh` 125 checks against a real local stack (finalize, two-browser propagation, idempotence, permissions, locks, reopen and re-finalize, medal tie, closeout, Arena, reopen event, 390 / 768 / 1280 / 1920 with screenshots reviewed); CI browser suites field-pack03 28, sw-update 28, pack07-ux 86, pack08-entrants 54, sample-mode 34, rankings-teams 22; real-stack represented-team-live 108, eventday-live 78, arena-live 103.
- Hosted (mvbxlebznlgroptwwdsm): preflight clean (96 finished competitions, all synthetic); migration applied section by section through the Supabase MCP after the tool's confirmation gate cancelled the function bodies that supersede results (details in the pack doc); every function hash equals the local build; fingerprint identical (1237 objects; the 24 known comment-only differences remain); 96 legacy competitions back-filled from their own audit rows; advisors unchanged except the six new organizer RPCs; ledger row `pack09c_finalization_closeout` (version 20261005013659). Garrett ran no SQL. Details: docs/claude-packs/PACK_09C_FINALIZATION_CLOSEOUT.md.
- Released 2026-10-05: merged to `main` (`08d6487`), CI run #85 green (typecheck / unit / build, database gate, browser suites, release policy), GitHub Pages deployed from that commit (Deploy GitHub Pages job succeeded 01:47 UTC). A production browser smoke test was not possible from this session (dothecoolwip1.github.io is blocked by the environment's network policy, HTTP 000); the read-only hosted smoke through the Supabase MCP stands in (see the pack doc).

## Pack 09D: Simple event mode, automatic tournament planning, smart scheduling, event / fighter / roster lifecycle (2026-10-05)

- Database (`20261005000100_pack09d_simple_event_automation.sql`, additive, re-runnable): event lifecycle as separate columns (`archived_at` presentation only; `stats_excluded_at` + reason; `field_count`), ONE statistics rule `private.stats_excluded(event)` read by `result_rows`, `match_sides`, `played_events`, the organization ranking scopes and the team discipline totals (`result_rows_all` / `*_results_all` / `fighter_history` gain a `stats_excluded` column; synthetic isolation untouched); `archive_event` / `unarchive_event` (organizers), `exclude_event_from_stats` / `restore_event_stats` (owner or organization admin, reason, audit, idempotent), `delete_event` for a disposable draft only (server-side blockers, typed confirmation, one private helper per table); `fighters.inactive_at` + `set_fighter_active` (the fighter, their team's captain / administrator, the owner); `team_memberships.hidden_from_roster` + `set_roster_visibility` / `team_roster_manage` (team managers); `team_roster` and `search_fighters_for_entry` leave inactive / hidden out; `matches.plan_order` / `plan_hold` written only by `save_queue_plan`, read by `queue_ordered` after the hand-made order, held fights skipped by `promote_one`; `clear_manual_queue`. Gate `pack09d_gate.sql` 149 checks (archive = identical aggregate snapshot, exclude / restore exact and idempotent, closed counts, delete refused / allowed, fighter and roster lifecycle, plan and queue, bracket automation end to end, privileges). Fingerprint 1273 objects.
- Frontend: Quick Setup (two steps, the reference categories with the normal set ticked, divisions, fields, organization / season, "Create event like…" copying configuration only); Manage opens on Event home (journey stepper, one recommended action per state, cards; four areas + More options with every old `?tab=` address kept); Build tournament (activation from 2 entrants, format from the existing advice, fields chosen with the planner, rest preview, `build_schedule` per competition, saved plan); the deterministic event-wide planner (`src/lib/planner.ts`: 3 > 2 > 1 > back-to-back, never double-booked, called fights locked, held fights for absent fighters, hand-made order and published times first, bounded swap pass) with Event day's Next recommended / Short rest / Run anyway / Choose another fight and continuous re-planning; Review wins & losses sheet (records, opponents and scores, server placings and points, compare, tie decision in place, Confirm results = `finalize_competition`); Event settings › Archive and statistics; fighter Set as inactive / Make active again; team page Manage the public roster; archived events hidden from browsing (toggle), excluded results marked Not counted. Details: docs/claude-packs/PACK_09D_SIMPLE_EVENT_AUTOMATION.md.
- Local evidence: typecheck, unit suite 797 tests / 74 files, production build; full `supabase/tests/run_all.sh` from zero **DATABASE GATE PASSED** (every gate incl. 09D, vectors, fingerprint, simulation, league verifier, three concurrency runs); `scripts/e2e/pack09d-live.sh` **123 checks** against a real local stack (Quick Setup on a phone without Advanced, Build tournament, Event day planning / override / stability / bracket re-planning, short rest, Review wins & losses → Pack 09C official, archive / exclude / restore / delete refused, roster hide / show, inactive / reactivate, direct permission refusals, 390 / 768 / 1280 layout); regression: field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, sample-mode 34, rankings-teams 22, eventday-live 78, arena-live 103, finalize-live 126, represented-team-live 108 (three suites updated to the new controls). Screenshots reviewed at 390 / 768 / 1280.
- Hosted (mvbxlebznlgroptwwdsm, through the Supabase MCP; Garrett ran no SQL): preflight read-only (main `74bf9ce` unchanged, no 09D object present, Pack 09C function hashes equal to the local build, 18 events / 596 results / 781 final fights, 2 real events). Section 1 (columns, the statistics rule, views) applied as ledger migration `pack09d_simple_event_automation` (version 20261005033255); sections 2 to 4 through `execute_sql`. The tool's confirmation gate cancelled a function body holding five DELETE statements (and a DROP), so the removal of a disposable draft became one private helper per table (`private.discard_event_matches / _entries / _registrations / _competitions / _row`, called by `discard_event`), exactly as Pack 09C did for results; the repository file, gate and fingerprint were changed to match before the helpers were applied. Two probe functions used to find that out could not be dropped (DROP cancelled) and were retired in place: `private.p9d_probe_a / _b` raise an exception and are not executable by anon or authenticated. Verified read-only after: all 27 Pack 09D function hashes identical to the local build; no private helper executable by clients; no new RPC executable by anon; the eleven commands SECURITY DEFINER with `search_path=''`; `events_lifecycle_guard` trigger present; column grants only on `field_count`; the hosted fingerprint holds all 1273 repository lines, differing only in the 24 known comment-only function hashes (same set as the 09B / 09C releases) plus the two retired probes; **0 rows changed** (no archived / excluded event, no inactive fighter, no hidden member, no planned fight; 596 results and 781 final fights untouched; rankings 934 rows, team discipline 382 rows as before). Advisors after: security unchanged except the 12 new organizer / team / fighter RPCs joining the expected list of authenticated-executable SECURITY DEFINER functions; performance baseline unchanged.
- Released 2026-10-05: merged to `main` (`b4fee93`), CI run #90 green (typecheck / unit / build, database gate incl. `pack09d_gate`, browser suites, release policy), GitHub Pages deployed from `b4fee932ab693460197ea81cadc5bee2937bd181` (deploy-pages job succeeded 03:42 UTC). A production browser smoke test was not possible from the release session (dothecoolwip1.github.io and the hosted REST endpoint are blocked by the environment's network policy, as in the 09B / 09C releases); the read-only hosted verification through the Supabase MCP stands in. First thing to try on a phone: create an event at /events/new, then open Manage on a running event and run the recommended fight.

## Pack 10: Fighter and team career profiles, statistics, records and history (2026-10-05)

- Database (`20261005000200_pack10_career_profiles.sql`, additive, re-runnable, no DROP / DELETE / ALTER): six `security_invoker` views (`career_fights_all` / `career_fights`: one row per fighter and final fight with the opponent and the team fought FOR; `team_fights_all` / `team_fights`: one row per team and team fight with the opponent team and the placing; `career_results_all` / `career_results`: placings with the team each was earned for) and five plain (not security definer, `search_path=''`) functions (`fighter_career`, `team_career`: career / season / organization totals and per-discipline lines in one call; `fighter_head_to_head`, `team_head_to_head`: direct meetings only; `team_fighters_represented`). Eligibility is the existing `private.stats_excluded` + `private.is_synthetic` (no second rule); ranking formulas untouched; every number is the sum of existing fight results and placings (nothing inferred from a placing; walkover = win/loss labelled; draw = draw; disqualified = fights kept, placed last with 0 points). Gate `pack10_gate.sql` **104 checks** (as the public role) on `scripts/e2e/fixtures/pack10.sql`; full `run_all.sh` from zero **DATABASE GATE PASSED**; fingerprint 1284 objects.
- Frontend: fighter profile (hero with Active / Inactive / Test data / Unclaimed, "Fights for" the team today, disciplines, one-line career, up to three ranking highlights; Career / season / organization filter; summary tiles; deterministic highlights; discipline lines and team-fight lines apart; recent form and fights with "Won 5 to 2" / "by walkover"; head to head from the opponents list or any fight row (`?vs=`); event history with the team represented THERE; teams represented from the record without invented dates; memberships kept apart) and team profile (hero with active roster count, team fight line, best discipline totals, ranking highlights; current roster under the Pack 09D rules; team fight record apart from Discipline totals with Show fighters = contributors = total; fighters represented in results incl. hidden and inactive, labelled; event history with *Team competed* vs *Represented*; team fight history with the roster of the day; team head to head). Directory discipline filter reads `ref_categories`. Details: docs/claude-packs/PACK_10_CAREER_PROFILES_STATS.md.
- Local evidence: typecheck, unit suite **814 tests / 75 files** (careerProfile 17 new), production build; `scripts/e2e/pack10-live.sh` **135 checks** against a real local stack (fighter journey incl. season filter and head to head, inactive / unclaimed / fictional / new / long-name fighters, team journey incl. roster rules, contributors, historical roster, head to head and season filter, cross-profile navigation fighter → historical team → event → official result → fighter → competition result, team → fighter / rankings / discipline leaderboard, directories, own-page controls, 390 / 768 / 1280 with no sideways scrolling and no small tap targets, no private data in the page or in any API answer behind it); screenshots reviewed. Regression: field-pack03 28, sw-update 28, pack07-ux 89 (two assertions updated to the new profile reads and headings; same proofs), pack08-entrants 54, sample-mode 34, rankings-teams 22 (mock stack); pack09d-live 123, finalize-live 126, represented-team-live 108, eventday-live 78, arena-live 103 (real stack).
- Hosted (mvbxlebznlgroptwwdsm, through the Supabase MCP; Garrett ran no SQL): preflight read-only (main `c5b5443`, none of the eleven objects present, the four objects the migration builds on byte-identical to the local build, 18 events / 596 results / 781 final fights / 124 fighters as at the 09D release). Applied in ONE call as ledger migration `pack10_career_profiles` (version 20261005122008); the tool's confirmation gate did not trigger (nothing destructive). Verified read-only after: all eleven object hashes identical to the local build; views `security_invoker=true` and readable by anon / authenticated; functions `secdef=false`, `search_path=""`, executable by anon / authenticated, not by public; tables, columns, constraints, indexes, policies, views and triggers byte-identical to the local build (per-category digests equal); functions equal once comments / whitespace are ignored and the two retired 09D probes set aside (236 hosted vs 234 local). **0 rows changed** (events 18, results 596, final fights 781, ranking rows 934, discipline rows 382 unchanged; no archived / excluded event, no inactive fighter). As anon: the three real fighters with fights give the same numbers through `fighter_career` as through `fighter_career_stats` and `fighter_match_rows`; a NACL-test fighter has a test context only (11 fights, 20.25 points), no official row, no career ranking row, head to head in the test context only; anon cannot read `fighter_accounts` or `registration_private`. Advisors after: security unchanged (no Pack 10 object in any finding: the new functions are not security definer); performance unchanged (pre-existing unindexed foreign keys / RLS initplan / permissive-policy lints, none on Pack 10 objects).
- Production browser smoke was NOT possible from this session (dothecoolwip1.github.io and the Supabase API host are denied by the environment's network policy, HTTP 000); the read-only hosted smoke above stands in.
- Released 2026-10-05: merged to `main` (`0659661`, merge commit of feature tip `0c0ddf5`; main had not moved), CI run #92 green (typecheck / unit / build, database gate incl. pack10_gate, browser suites, release policy: production not frozen), Deploy GitHub Pages succeeded 12:32 UTC from `0659661`. Hosted migration `pack10_career_profiles` (version 20261005122008) was applied and verified before the merge (above). Garrett ran no SQL.

## Pack 11: Red Deer Rumble full dress rehearsal, event-day resilience and readiness (2026-10-05)

- What it is: the whole Rumble lifecycle run through the application against a real local stack on a deterministic rehearsal tournament (52 fighters, 10 teams, 14 competitions, two fields, shared kit, one-day availability, unpaid fees, missing insurance proof, two no-shows, a Sunday-only fighter whose 12 fights are held): Quick Setup → waiver → registration (as each person) → review → check-in → Build tournament → two fields → scorekeeper phones → lost signal → conflicts, stale results, paper → no-show and injury → engineered ties, brackets from pools → Review wins & losses → Results → reopen and correct → closeout → Arena → career statistics → archive / exclusion / synthetic isolation → permissions and privacy → edge states and phone / tablet sweeps. `scripts/e2e/rumble-live.sh` (19 sections), fixture `scripts/e2e/fixtures/rumble.sql`, plan metrics `scripts/e2e/rumble-plan-metrics.sql`. Details, findings, paper comparison, readiness scorecard and real-phone checklist: docs/claude-packs/PACK_11_RUMBLE_DRESS_REHEARSAL.md.
- Fixed from the rehearsal (migration `20261005000300_pack11_my_event_entries.sql`, additive): automatic queue promotion never makes a person active on two fields at once (`private.fighting_elsewhere` + `private.promote_one`); `my_event_entries` is roster-aware (a man no longer sees his club's women's team fights). Frontend: My next fight rewritten (plan-counted place, every unfinished fight, held fights, short-rest note, checked-in state; the public page's live read carries the plan columns; Field 1's blank field handled); Choose another fight marks and disables fights whose people are fighting elsewhere now; the offline Pending screen offers Back to the queue (keep this pending); segment buttons, small buttons and disclosure summaries are 40px tall. Gate `pack11_gate.sql` 16 checks; fingerprint updated.
- Plan metrics on the rehearsal (saved plan after Build tournament): 86 planned fights, 0 back-to-back, 0 double bookings, 0 availability violations, 12 held for the Sunday-only fighter, 80 of 80 fights with a previous appearance at the 3-fight rest target (one run showed 3 at 2 fights of rest). Scoring: three fights from one phone in ~6 s of wall time and 28 to 42 taps; Event day loads in ~1 s with 47 requests (no per-match requests); 90 pool fights and 16 bracket fights on two fields with no double booking.
- Local evidence: typecheck; unit suite 820 tests / 75 files; production build; `pack11_gate.sql` 16 checks on a fresh scratch database; full `run_all.sh` (result below); rumble journey runs (the draw is random per run; results follow one deterministic rule): the final run: **178 checks green, 0 product failures**, through every competition made official (sections 1 to 14 up to the Women 3v3 reopen); the script then stopped on a label selector in the Reopen dialog, so the closeout, public results / Arena after the event, career statistics, archive / exclusion / synthetic, permissions / privacy, edge-state and sweep sections (14 tail to 19) are written but were NOT reached by a complete run in this session. Earlier partial runs exercised the layout sweeps (which found the 36px tap targets, fixed) and the same closeout path was verified in Pack 09C. Treat sections 15 to 19 as pending evidence.
- Hosted (mvbxlebznlgroptwwdsm, through the Supabase MCP; Garrett ran no SQL): preflight read-only (hosted `my_event_entries` and `promote_one` byte-identical to the local pre-migration build, no `fighting_elsewhere`); applied in ONE call as ledger migration `pack11_my_event_entries`; verified after: all three function hashes identical to the local build, security definer with an empty search_path, `my_event_entries` executable by authenticated only, the two private functions by nobody. No row of any table was changed; no real event, result, fighter or team touched; the rehearsal event exists only on the local scratch database.
- Production browser smoke was NOT possible from this session (dothecoolwip1.github.io and the Supabase API host are denied by the environment's network policy); the read-only hosted verification above stands in. Real phones were NOT tested: the checklist in the pack doc is required before the Rumble.


## Pack 12: installable app, push notifications, product polish (2026-10-06)

- Full description, security model and evidence ladder: `docs/claude-packs/PACK_12_APP_AND_NOTIFICATIONS.md`. Hosted record and operations: `docs/runbooks/PACK12_HOSTED_ROLLOUT.md`. Phone checklist: `docs/runbooks/REAL_DEVICE_PUSH_CHECKLIST.md` (NOT performed).
- Migrations (additive): `20261006000100_pack12_notification_kinds`, `20261006000200_pack12_push_notifications`, `20261006000300_pack12_registration_gender`. Edge Function `supabase/functions/send-push`.
- Local evidence: typecheck; Vitest 856 tests; production build; `run_all.sh` DATABASE GATE PASSED including `pack12_gate.sql` (122 checks) and `pack12_commit.sh` (real commits: queue advance alerts once, repeats and concurrent presses send nothing, a broken notification store never blocks a result);
  browser in real Chromium against the built app: `pack12-app.mjs` (74 checks incl. install prompt, alerts settings, signed-in Home, iPhone-not-installed, manifest/icons/offline shell, push injected into the real service worker, tap routing, 320/390/768/1280 sweeps), pack07-ux 89, field-pack03 28, sw-update 28, pack08 54.
- Hosted (mvbxlebznlgroptwwdsm, through the Supabase MCP; Garrett ran no SQL): preflight read-only (Pack 11 state, no Pack 12 objects, no gender mismatches in data); three migrations applied; pg_net enabled; Edge Function deployed (verify_jwt off, shared-secret check); VAPID pair created in the database by the function;
  `push-sweep` cron job; verified RLS, grants and function privileges, wrong secret 401 / right secret 200. No real event, result, fighter or team row was changed.
- NOT physically verified: a phone receiving a push, a tap with the app closed, iOS Home Screen behaviour, installing from a real browser. Production deployment and production browser checks are recorded below once done.
- **Release (2026-10-05, recorded after the merge):** PR #31 merged to `main` as `1ebe13abe3e120d29fbd4f97899647546efaa47c`. GitHub Actions run 37352233672 on that commit: typecheck/unit/build, database gate (`run_all.sh`), browser tests (including the new Pack 12 app test) and release policy all succeeded, and **Deploy GitHub Pages succeeded** (deployed commit = the merge commit).
  Hosted Supabase was already updated before the merge (migrations, pg_net, Edge Function, sweep job), so the deployed frontend and the hosted database match.
  **Production browser check: NOT done**: this environment's network policy denies `dothecoolwip1.github.io` (proxy 403), so what production serves was not inspected directly; the deploy job's success and the CI browser run of the identical build are the evidence.
  **Physical phone: NOT verified** (install, permission, receipt of a push, tap with the app closed, iPhone Home Screen). The checklist `docs/runbooks/REAL_DEVICE_PUSH_CHECKLIST.md` is unperformed and is required before relying on alerts at the Rumble.


## Pack 13: Lyst Control, timing, counter scoring and marshal authority (2026-10-07)

- Full description, security model and defaults: `docs/claude-packs/PACK_13_LYST_CONTROL.md`. Hosted record: `docs/runbooks/PACK13_HOSTED_ROLLOUT.md`. Real-device list: `docs/runbooks/PACK13_REAL_DEVICE_CHECKLIST.md` (**NOT performed; no box is ticked**).
- The rule: the marshal's call is the only official score. Counters (including learning counters) are provisional evidence with no path to anything official; nothing averages, maxes, votes or auto-accepts them. The result is still saved by a person through the existing finalization path.
- Migrations (additive): `20261007000100_pack13_lyst_core`, `20261007000200_pack13_lyst_counters`. No Edge Function, cron job or extension.

### Evidence by level (kept apart on purpose)
| Level | Result |
| --- | --- |
| Repository changed | yes: 2 migrations, `src/lib/lyst/*`, `src/data/lyst.ts`, `src/components/lyst/*`, `src/pages/lyst/CounterPage.tsx`, Arena clock/official state, outbox kinds, tests, docs |
| Local build / unit | typecheck clean; Vitest 899 (incl. 32 lyst lib tests, 10 sender, 19 arena); production build |
| Local database | `run_all.sh` DATABASE GATE PASSED (all earlier packs + `pack13_gate.sql` **220 checks**); `pack13_commit.sh` **14** real-commit / parallel-session checks (two tablets pause at once, same command sent twice or four times, 30 counters tapping at once, duplicate tap ids, two finishes at once); schema fingerprint updated |
| Browser (real Chromium, REAL local Postgres + PostgREST, built app) | `scripts/e2e/pack13-live.mjs` **88/88**: tablets, 5 counter phones, head marshal, public display, stranger. Includes refresh-proof clock, pause/resume, two tablets racing, Field 1 + Field 2 independent, QR join + operator seating, learning counter, counting, UNDO LAST, 40-click burst lands exactly 40, break workflow, cards from the event's own list, void with reason, double-tap CONFIRM, correction with reason, finish through the existing path, next fight carries counters, offline marshal's call through the existing outbox, security checks, 390/768/1280 sweeps, keyboard/focus |
| Measured 30-second break | END ROUND, marshal's score, CONFIRM, START ROUND 2: **5 taps; 4.3-4.6 s of automation** (entry screen up in about 50-60 ms; break clock still had 26 s). Rapid taps: 40 clicks in one burst, exactly 40 recorded. A person is slower; the margin inside a 30 s break is large but is not a human measurement |
| Regression (local) | CI browser suites on the built app: field-pack03 28, sw-update 28, pack07-ux 89, pack08 54, pack12-app 74, all passed. Real-stack: eventday-live 78/78, finalize-live 126/126. arena-live 102/103 (see below) |
| Hosted database (mvbxlebznlgroptwwdsm, via Supabase MCP) | read-only preflight (Pack 12 state, no Pack 13 objects); 4 additive migrations applied (`pack13_lyst_core`, `pack13_lyst_counters`, `pack13_trigger_search_path`, `pack13_join_attempts_pk`); verified 12 tables with RLS on, 0 client write grants, anon cannot execute any lyst/counter function, no SECURITY DEFINER function without an empty search_path, private helpers not callable by users, 4 triggers, 3 tables in realtime, 2 views with no sensitive columns; anon refused (permission denied) on counts, seats, revisions, private reasons and settings (rolled-back transaction), anon can read the public state and clock. No real event, result, fighter or team row was created or changed |
| Advisors vs baseline | Baseline: security 6 groups, performance FK 42 / initplan 11 / unused 2 / multiple-permissive 10. After: **no new** unindexed-FK, initplan or permissive-policy findings (covering indexes added, `(select auth.uid())` used). Fixed after the first check: 2 trigger functions without a pinned search_path, 1 table without a primary key. New and accepted: 18 "authenticated can execute SECURITY DEFINER" notices (the same intended class as the existing 132; every function checks role or ownership inside), 1 INFO `lyst_join_attempts` RLS with no policy (server-only by design, like other private tables), 17 INFO "unused index" on the new tables (they have not been used yet) |
| CI / deploy / production | recorded below after the merge |
| Physical device / real hall | **NOT tested** |

### Known, not caused by Pack 13
`scripts/e2e/arena-live.mjs` fails one check ("a result on Field 2 leaves Field 1 alone": queue is `13:on_deck,11:in_the_hole`, the script expects `13:active,11:on_deck`). It fails identically on `757123b` (the code before Pack 13), so it predates this pack; that suite is not part of CI. Not changed here.

### Bugs the new tests caught before release (fixed)
- A wrong join code raised an error, which rolled back the attempt row, so the brute-force limit never counted guesses. Now answered as `invalid` after the attempt is recorded.
- A counter seat carried to the next fight inherited its old fight's tally. Tallies and submissions are now per match.
- A late answer to an earlier poll put an old count back on a counter's phone. Answers requested before the last tap was sent are ignored.

### Decisions recorded
- Lyst Control applies to duels (the round-scored boards). Team fights, Profight and the series boards are unchanged; a marshal can switch to the classic board per device.
- All durations, regular rounds (2), extra-round length (30 s), deduction amounts, reasons and the card list are event settings. The card list starts empty: no card names are invented.
- Refreshing the lyst screen returns to the open fight (`?open=`); the classic board keeps its old behaviour (refresh returns to the queue).
- Nothing was built for Pack 14 (broadcast overlays) beyond the clean public state view `lyst_public_state`.

## Pack 14: Broadcast, livestream and spectator graphics (2026-10-08) — MERGED AND DEPLOYED; PRODUCTION BROWSER VERIFICATION NOT YET DONE

Branch `pack14-broadcast` (from `main` 12f2e66). Architecture and decisions: `docs/claude-packs/PACK_14_BROADCAST.md`. OBS setup and the real-device checklist: `docs/runbooks/PACK14_OBS_SETUP.md`. Constraints from the owner: do not touch Pack 13's deployment workflow; do not deploy Pack 14; no PR and no hosted-database change unless asked. Before any later merge: confirm Pack 13's production deploy state and reconcile with the latest `main`.

| Level | Status |
| --- | --- |
| Implemented in repository | yes: overlay `/broadcast/:event/:field`, scene state machine, fighter/team graphics, sponsors, admin Manage > Broadcast, public event-page livestream block, OBS link builder |
| Migration created | yes: `20261008000100_pack14_broadcast.sql` (additive: `event_broadcast`, `event_sponsors`, bucket `sponsor-logos`, 3 organizer functions) |
| Applied locally | yes (scratch databases only) |
| Applied to hosted Supabase | **YES** (2026-10-05, project `mvbxlebznlgroptwwdsm`, through the Supabase `apply_migration` operation, recorded as `20261005214619 pack14_broadcast`; no `execute_sql` workaround; the migration is additive, nothing existing was altered). The first attempts were cancelled by the connector permission and changed nothing; the owner re-allowed the tool |
| Hosted schema verified (read-only catalog queries) | yes: `event_broadcast` and `event_sponsors` exist with RLS on; one SELECT policy each (`is_event_public or is_organizer`, roles anon + authenticated); table grants are SELECT only for anon/authenticated (no insert/update/delete); 3 functions are SECURITY DEFINER with empty search_path, executable by `authenticated` only (anon and PUBLIC revoked); bucket `sponsor-logos` public, 512 KB, png/jpeg/webp; 3 storage policies (insert/update/delete, authenticated, organizer of the folder's event); both tables in the realtime publication |
| Hosted behaviour verified | yes, 61 checks run on the hosted database as anon / signed-in stranger / scorekeeper / organizer inside ONE transaction that was deliberately aborted, so no production row, status or storage object changed (afterwards: 0 broadcast rows, 0 sponsors, 0 logos, 0 unpublished events, 0 disabled organizations, 0 broadcast audit rows). Results: public reads work for a published event; a DRAFT event returns nothing to anon, a stranger or a scorekeeper (the organizer still reads it); a DISABLED organization hides it from anon and re-enabling restores it; no role can write the tables directly (not even an organizer); anon, stranger, scorekeeper and an organizer of ANOTHER event are refused (42501) by every broadcast function; the organizer's own writes work and are audited; stream addresses on another domain, http, look-alike hosts (`youtube.com.evil.com`) and `javascript:` are refused (22023); an unknown setting key is refused; a sponsor logo path in another event's folder is refused; storage inserts succeed only for the organizer in the event's own folder with an image name (anon, stranger, scorekeeper, another event's organizer, and non-image names are refused); no account-like columns on the new tables or on `lyst_public_state`; anon cannot read counter tallies, seats or lyst settings, nor call `lyst_timer_command`. Note: the platform owner is an organizer of every event by the existing platform rule, so "an organizer of another event" was tested with a non-owner organizer |
| Hosted advisors after the migration | security: the only Pack 14 mention is the existing, accepted `authenticated_security_definer_function_executable` warning (same as ~150 other controlled functions: each checks the role inside); nothing about the new tables, no anon exposure |
| Automated tests | typecheck clean; `npx vitest run` 924 passed (25 new broadcast tests); production build passes; `supabase/tests/run_all.sh` DATABASE GATE PASSED (includes `pack14_gate.sql`, 69 checks, and the schema fingerprint) |
| Browser verified (real Chromium, real Postgres + PostgREST, local stack) | `scripts/e2e/pack14-live.sh`: 63/63 checks (1920x1080 overlay through every scene, score/clock/cards/finalization/Now-Next, refresh and offline recovery, layouts/backgrounds, public page, draft boundary, anonymous/stranger/scorekeeper write attempts refused, admin on a 390x844 phone incl. no sideways scroll and 40 px controls, sponsor add/hide/remove with logo upload, copy link) |
| Regression browser suites (CI set) | field-pack03, sw-update, pack07-ux, pack08-entrants, pack12-app all exit 0 on this branch |
| PR | #34 (`pack14-broadcast` into `main`), required CI run #104 on head `685632f`: Typecheck/unit/build PASS, Database gate PASS, Browser tests PASS, Release policy PASS (Vercel preview ready) |
| Merged to main | **YES**: merge commit `ed9fb3b` (before merging, `main` was still `12f2e66`, the Pack 13 merge whose production run had completed successfully; the branch was 0 behind) |
| Main production run (`CI and Deploy` #105 on `ed9fb3b`) | Typecheck/unit/build PASS, Database gate PASS, Browser tests PASS, Release policy PASS (the release policy was not bypassed or touched) |
| GitHub Pages deployment | **PASS**: job `Deploy GitHub Pages` (`actions/deploy-pages@v4`) completed successfully at 2026-10-05 22:00 UTC |
| Production verified (live site in a browser) | **NO**. The execution environment's network policy denies the production hosts (`github.io` and `supabase.co` answer 403 to CONNECT), so the live site could not be opened from here. Deployment success is NOT claimed as production verification. To do: BuhurtOS loads; an existing user workflow loads; Manage > Broadcast for an organizer; a published event's `/broadcast/<slug>/<field>` loads read-only and shows fighters/score; the public event page livestream block; a draft event is not exposed; refresh keeps the overlay state |

Not verified on hosted (honest list): the storage DELETE policy could not be exercised by direct SQL (every role is refused a direct delete from `storage.objects` by Supabase), so only its definition was verified there and its behaviour is covered locally by `pack14_gate.sql`; a real upload through the Storage API.

Not verified (honest list): a real OBS browser source on a real streaming computer; real phones/tablets/TV; real YouTube/Twitch embeds (the sandbox blocks external hosts, so only the embed address, sandbox attributes and layout were checked, not playback); realtime websockets (the local stack has none, so the polling fallback was what ran: overlay polls every 5 s, 3 s for the clock; with realtime it is faster); the sponsor-logo storage policies in a browser (the local storage stand-in does not enforce policies; they are tested in `pack14_gate.sql`); the hosted database and production. The last CSS nudge (event tag position under the score bug) was not re-screenshotted after the final browser run. The pre-existing `arena-live` failure noted under Pack 13 is unrelated and unchanged.

### Broadcast blank-screen fix (2026-10-05), after Pack 14
- Production bug: Manage › Broadcast showed content for about 0.5 s, then the whole app unmounted to a blank page. Root cause: two hooks (ManagePage and the Broadcast tab, and the public event page with a stream) asked supabase-js for the same realtime topic `event-record-<id>`; the client returns the SAME channel object, and once realtime had joined (only with a live connection, i.e. production) the second `.on()` threw inside an effect with no error boundary.
- Fix (PR #35, branch `fix-broadcast-blank`, merged to `main` as `8d71688`): `src/lib/realtimeChannel.ts` (one channel per subscriber, used by every subscription) and `src/components/ErrorBoundary.tsx` (a failing screen shows Try again / Reload instead of blanking the app). Regression: `scripts/e2e/broadcast-realtime.{sh,mjs}` runs the real app with a realtime stand-in in the browser (2/5 on the unfixed code, 15/15 fixed) and `src/lib/realtimeChannel.test.ts`.
- PR #35 CI run 106 passed. Merged by the owner; main run 107 on `8d71688`: typecheck/unit/build, database gate, browser tests, release policy and **Deploy GitHub Pages all succeeded** (2026-10-05 22:25 UTC). Production browser check: NOT done from this environment (production hosts denied by the network policy); the owner's phone is the real check.

## Pack 15: installable app, push notifications and event-day alerts (2026-10-09) — IMPLEMENTED ON BRANCH, NOT MERGED, NOT DEPLOYED

Branch `pack15-installable-alerts` (from `main` `ed9fb3b`; `main` with PR #35 merged in at `8d71688`, no conflicts, the realtime-channel and ErrorBoundary code kept as merged). Design, investigation and dedupe strategy: `docs/claude-packs/PACK_15_INSTALLABLE_ALERTS.md`. Phone runbook: `docs/runbooks/PACK15_DEVICE_RUNBOOK.md` (**not performed**).

| Level | Status |
| --- | --- |
| Reused from Pack 12 (unchanged) | manifest/icons/standalone/scope, service worker (offline shell, update safety, push + tap routing), install card, permission ask, subscriptions (secret table, own-device functions, takeover, revocation), dispatcher (`push_claim` / `send-push` / `push_report`, pg_net kick, sweep, TTL), preferences, bell feed, team alerts, queue trigger |
| Implemented in repository | alert wording ("You're 2 fights away" from the real line count, "You're up next · Report to <field>", "Your fight is ready · Report to <field> now", "Your fight changed field"); field change reaches people already alerted; schedule-change alerts (10+ min, within 24 h, coalesced per person per event); result-conflict alert to organizers and head marshals; event announcements (organizer of that event, 140 chars, no links, 5/hour, 20/day, audited, history); durable dedupe keys on every producer; Event day announcement panel; settings show browser permission apart from the BuhurtOS switch; signed-out fight-alert landing asks to sign in in place and keeps the address; a device whose permission was revoked removes its own registration, a replaced subscription removes the old row; the settings page no longer waits forever without a service worker; bell refreshes on reconnect |
| Migration created | `20261009000100_pack15_event_day_alerts.sql` (additive: kinds, wording, routes, `queue_notify` body, 2 new triggers, `event_announcements` table, 2 functions) |
| Applied locally | yes (scratch databases) |
| Applied to hosted Supabase | **NO** (not requested; required before release, together with the merge) |
| Automated tests | typecheck clean; Vitest 928 passed; production build passes; `run_all.sh` **DATABASE GATE PASSED** (incl. `pack15_gate.sql` 61 checks; `pack12_gate.sql` 122 with its wording expectations updated to the Pack 15 words; `pack12_commit` real commits; fingerprint) |
| Browser verified (real Chromium, built app, real Postgres + PostgREST) | `scripts/e2e/pack15-live.sh` **42/42**: alerts from the real queue and a real result, no duplicates from repeats/reads/reloads, offline → reconnect catches up without duplicates, schedule change coalesced, announcement from a 390x844 phone (refusals, audit, history, 40 px controls), scorekeeper/fighter/stranger/anon cannot send, no direct table reads, signed-out landing, settings at 390 px, revoked-permission device removed, manifest + icons + service worker + offline launch |
| Regression browser suites | field-pack03 28/28, sw-update 28/28 (service-worker update safety), pack07-ux 89/89, pack08-entrants 54/54, pack12-app 74/74; on the merged branch also `broadcast-realtime` 15/15 (with realtime connected) and the Pack 13 Lyst rehearsal `pack13-live` 88/88 (unchanged behaviour: Lyst actions create no alerts until the result moves the queue) |
| Push delivery levels | (1) application logic: verified (database + browser). (2) browser Push API / service worker: Pack 12's push injection into the real worker and tap routing still pass (pack12-app); the Pack 15 payloads use the same fields. (3) **physical-device delivery: NOT verified** (runbook) |
| PR / merged / deployed / production verified | no / no / no / no |

## Pack 16: check-in, armour control and fighter readiness (2026-10-10) — IMPLEMENTED ON BRANCH, NOT MERGED, NOT DEPLOYED

Branch `pack16-readiness` (from `main` `8d71688`; Pack 15 merged to `main` as #36 `6d9f137` during the work and was merged into this branch at
`82f139b` with Pack 15 kept as merged). Design, investigation, state model, roles, QR and integration: `docs/claude-packs/PACK_16_READINESS.md`.

| Level | Status |
| --- | --- |
| Reused (not duplicated) | `registration_checks` (check-in and the kit flag, which every existing screen still reads), `set_registration_check`, Manage › Check-in, `team_clearance`, event roles and `has_event_role`, `private.audit`, the Pack 13 queue (untouched), Pack 15 notifications, `qrcode-generator` |
| Implemented in repository | roles `check_in` (Check-in desk) and `inspector` (Armour inspector); attendance expected → arrived → checked in (undo audited); append-only inspection history (passed / needs correction / failed, issue list, staff-only note, inspector, time; reinspection flagged); optional profight weigh-in (never public, never a blocker); head-marshal/organizer override with reason, withdrawable, audited; ONE derived readiness with plain reasons (`event_readiness`, `match_readiness`, `team_readiness`); check-in desk page `/events/<slug>/checkin` (counts, search by name/team/competition, filters, phone-first, never shows unsaved as saved, refresh on reconnect/focus); fighter's check-in code (QR holding only the address + registration id; grants nothing); Lyst/field warning strip (warning only; never blocks or rewrites a fight); captain event-day readiness (status words only); entry links (event page for desk staff, Event day › More tools, Manage › Check-in); inspection alerts through Pack 15's notifications (note never included) |
| Migrations created | `20261010000100_pack16_readiness.sql`, `20261010000200_pack16_inspection_alerts.sql` (both additive; the second extends Pack 15's notification functions in place with anchor assertions) |
| Applied locally | yes (scratch databases only) |
| Applied to hosted Supabase | **NO** (not requested). Order on release: Pack 15's `20261009000100` must already be applied (it is a prerequisite of `…000200`), then `20261010000100`, then `20261010000200`. Existing kit-passed records count as "Armour passed" (no backfill needed) |
| Automated tests | typecheck clean; Vitest 936 passed (8 new readiness tests); production build passes; `run_all.sh` **DATABASE GATE PASSED** on the merged tree (incl. `pack16_gate.sql` **90 checks**, `pack15_gate.sql` 61, `pack12_gate.sql` 122, `pack13_gate.sql` 220, `pack14_gate.sql` 69, real-commit concurrency suites, schema fingerprint regenerated: 1776 lines) |
| Browser verified (real Chromium 390x844, built app, real Postgres + PostgREST) | `scripts/e2e/pack16-live.sh` **66/66** on the merged tree: arrive → check in → inspector "needs correction (helmet)" with note → desk dashboard → organizer calls the fight anyway → Lyst screen warns "Brann Oakley: armour needs correction" with the clock and scoring working and the match row unchanged → captain sees it (no note) and is refused → reinspection passes → READY, history keeps both → Lyst warning clears on reconnect → captain sees 2/2 ready → fighter's QR and bell alerts ("Armour needs a fix … helmet", "Armour passed", no note, no staff alerts) → QR opened by the fighter / signed out / unknown code → offline Check in says "Not saved" and writes nothing, then saves online; another device's change appears after reconnect → profight weigh-in 83.46 → 83.5 kg → override with reason, audited, withdrawn (row kept) → refusals for scorekeeper, captain, fighter, stranger, anonymous, other-event desk staff, desk↔inspector, direct table writes → Manage › Check-in and People roles → no sideways scroll; no page errors |
| Regression browser suites (merged tree) | field-pack03 28/28, sw-update 28/28, pack07-ux 89/89, pack08-entrants 54/54, pack12-app 74/74, eventday-live 78/78, pack13-live 88/88, broadcast-realtime 15/15, pack14-live 63/63, pack15-live 42/42 |
| Test fix outside Pack 16 | `pack14-live` check 29 read the overlay scene the moment `data-ready` flipped; on a fresh load the overlay is `idle` for about a second until its match list arrives (seen once as 62/63). The check now waits for the scene like its neighbours. The brief idle frame on load is pre-existing Pack 14 behaviour and was not changed |
| PR / merged / deployed / production verified | no / no / no / no |

Not verified (honest list): real phones and a real phone camera scanning the QR (the QR's address is unit-tested and the page it opens is browser-tested, the camera step is not); push delivery of the inspection alerts to a physical device (they go through Pack 15's pipeline, whose device level is itself not yet verified); realtime websockets for the desk (it reads every 20 s and on reconnect/focus; the Lyst strip every 30 s and on reconnect); hosted database; production.

## Pack 18: email + password sign-in, Organizer Command Centre, live updates that keep the view (2026-10-06) — IMPLEMENTED ON BRANCH, NOT MERGED, NOT DEPLOYED

Branch `pack18-command-centre` from `main` `90ff429` (Packs 13–16 and the PR #35 realtime / ErrorBoundary fix; `main` did not move during the
work). Plan, investigation, decisions, root causes and limits: `docs/claude-packs/PACK_18_COMMAND_CENTRE.md`. Hosted steps (not performed):
`docs/runbooks/PACK18_HOSTED_ROLLOUT.md`. `docs/PROJECT_SPEC.md` now records the owner's decision to allow passwords.

| Level | Status |
| --- | --- |
| Implemented in repository | **Sign-in**: Email + Password (Show/Hide) + Sign in + Forgot password? + Create account, with Google and email codes kept; `/sign-in?next=`, `/reset-password`, Account › Password (current password, or first password for code/Google accounts, with Supabase's reauthentication code); destinations kept; no account enumeration (wrong password = unknown email; reset / sign-up / resend answer the same, including within Supabase's per-address limit). **Command Centre** `/events/<slug>/command` for organizers and the head marshal: header with real state and freshness, Needs attention (what / who / where / link), fighters (Pack 16), fields (Pack 13 state words), fights, progress (no ETA), staff (assigned, not presence), Pack 15 announcements, broadcast status, quick actions; read-only. **Live updates keep the view**: `useAsync` refresh semantics (see the doc, §6) and the `.fade-in` fill fix |
| Root cause of "live update sends me to the top" | (1) background re-reads (event-record watch every 20 s + live ticks) set `loading`, and the event page replaced itself with "Loading…" (remount, scroll 0, lost state); a failed re-read also blanked data. (2) the page entrance animation's `both` fill disabled the browser's scroll anchoring on every page. Both fixed at the root; no scroll restoring hacks |
| Migration created | `20261012000100_pack18_command_centre.sql` (additive: `public.event_command_snapshot`, `private.can_command`; no tables) |
| Applied locally | yes (scratch databases only) |
| Applied to hosted Supabase | **NO** (hosted database unchanged) |
| Automated tests | typecheck clean; Vitest **957 passed** (new: authFlow 11, commandCentre 10); production build passes; `run_all.sh` **DATABASE GATE PASSED** (incl. `pack18_gate.sql` **36 checks**, pack16 90, pack15 61, fingerprint 1778 lines) |
| Real-auth browser scenario (real Supabase Auth server built from source + mail sink + PostgREST + Postgres, real Chromium) | `scripts/e2e/pack18-live.sh` **67/67**: sign in / wrong password = unknown email / one request per double tap / sign out & in / Pack 15 fight-alert landing keeps `#my-next-fight` / `next` kept, outside `next` refused / the committed test-login seed signs in / sign-up with confirmation email back into `/welcome` (no fighter invented) / existing address on sign-up and reset: same answer / reset link, come back later, mismatch, saved, Continue / reused, other-browser and expired links explained / change password (wrong and right current) / code-only account: email code still works, first password with Supabase's reauthentication code / offline / no password column in BuhurtOS / claims and roles untouched; Command Centre on a realistic event (two fields, running and paused Lyst, result conflict, missing / not checked in / armour correction / reinspected fighters): header, attention, fields, readiness tiles, deep links (desk filter, Event day, Lyst Control), **25 s open wrote nothing**, follows changes without reload, offline / back online, "All good" when healthy, empty event, head marshal view, refusals for scorekeeper / stranger / fighter / captain / desk / inspector / other event / anon / other-event organizer, no notes / weights / emails, 390 / 768 / 1280 without sideways scroll, no page errors |
| Live-update stability | `scripts/e2e/live-stability.sh` **47/47** (phone 390x844 and desktop 1280x900; event page, Event day, Command Centre, check-in desk, Field / Lyst queue, Manage › Broadcast; live change + reconnect / focus refresh): same root node, reading position kept, search / filter / open section / unsent input kept. The same test on the unfixed code: event page remounted and thrown to the top at both sizes (43/47) |
| Regression suites | field-pack03 28/28, sw-update 28/28, pack07-ux 89/89, pack08-entrants 54/54, pack12-app 74/74, eventday-live 78/78, pack13-live 88/88, broadcast-realtime 15/15, pack14-live 63/63, pack15-live 42/42, pack16-live 66/66 |
| Test fix outside Pack 18 | eventday-live failed every evening after 18:00 MDT: the fixture (and two events the script creates) used the database's UTC `current_date`, while the app judges "running" in the event's time zone. Reproduced on unmodified `main`; fixtures now use the event-time-zone date |
| Viewports reviewed (screenshots) | sign-in, check-your-email, reset saved, used link, change password (390); Command Centre with problems (390), healthy (390, 1280), tablet 768, offline, refused, empty event. Found and fixed during review: the Command Centre root class collided with an older `.cc` swatch (20 px wide page) — width checks added |
| PR / merged / deployed / production verified | no / no / no / no |

Not verified (honest list): the hosted Auth settings (confirm email, secure password change, redirect URLs, SMTP) — the app handles both settings and the runbook lists what to check; real phones; realtime websockets for these screens locally (the polling fallbacks were what ran; realtime uses the same in-place update paths); hosted database; production.

## Red Deer Reavers membership, dues and AGM voting (2026-10-06) — HOSTED MIGRATION APPLIED, FRONTEND NOT MERGED, NOT DEPLOYED

Branch `ccr-f3ffa4b5-htzvr1` (BuhurtOS and Red-deer-reavers). Full design, RLS, eligibility rules, auth model and owner steps: `docs/runbooks/CLUB_MEMBERSHIP.md`.

| Level | Status |
| --- | --- |
| Implemented in repository | `team_officers` (office terms), `club_membership_years`, `club_memberships`, `club_dues`, append-only `club_dues_history`; checked RPCs; `/teams/:slug/membership` (member view, apply, dashboard, dues dialog, AGM print, history, executive roles); club website `members.html` on the same Supabase Auth |
| Migration created | `20261013000100_club_membership_dues_voting.sql` (additive) |
| Applied to hosted Supabase | **YES** (2026-10-06); 19 function bodies md5-identical to the repository; grants / RLS verified; seeded Reavers 2026 ($20); no office holders seeded |
| Automated tests | `club_membership_gate.sql` **101 checks**; `run_all.sh` DATABASE GATE PASSED; Vitest 965; typecheck; build |
| Hosted permission run | rolled back, all refusals/grants as designed (member, anon, other team's treasurer, VP, President, Secretary, Treasurer, reassignment, ended term) |
| Real-auth browser scenario | `scripts/e2e/club-live.sh` **58/58** (real Supabase Auth + PostgREST + built app + club website files on a second origin; 390x844 and 1280x900) |
| Regression suites | field-pack03 28/28, sw-update 28/28, pack07-ux 89/89, pack08-entrants 54/54, pack12-app 78/78 |
| PR / merged / deployed / production verified | no / no / no / no |

Not verified: the real domains (buhurtos.ca, the GitHub Pages club site): sign-in there, CSP with the real CDN, real phones. Cross-site session sharing is not implemented by design (same account, separate sessions).

## Red Deer Reavers part 2: account creation on the club website, 2026 fee waiver, 2026 AGM (2026-10-06)

| Level | Status |
| --- | --- |
| Implemented in repository | `club_membership_years.fee_waived` (Reavers 2026 = true; eligibility ignores unpaid dues in a waived year); `club_meetings`, RSVP (+history), proxies (end-only), attendance (+history), saved AGM records; BuhurtOS shows "Fee waived" and has NO AGM screens (part 1's AGM tab removed); club website: create account / sign in / Google / reset password / profile step / join / AGM / executive AGM tools |
| Migration created | `20261014000100_club_fee_waiver_and_agm.sql` (additive) |
| Applied to hosted Supabase | **YES** (2026-10-06); all 35 club function bodies md5-identical to the repository; AGM seeded Sunday 2026-10-18 17:30 America/Edmonton; no API grants on the meeting tables; nothing anon-executable |
| Officers on hosted | Treasurer = dothecoolwip@gmail.com (assigned through `assign_team_officer` as the platform owner, audited). President / Secretary: no accounts exist yet |
| Automated tests | `club_agm_gate.sql` **78 checks** + `club_membership_gate.sql` 101; `run_all.sh` DATABASE GATE PASSED; Vitest 965; typecheck |
| Real-auth browser scenario | `scripts/e2e/club-live.sh` **61/61** (real Supabase Auth with default link-only emails; both sites on ONE origin like production; 390x844 + 1280x900) |

## Pack 18.1: temporary event devices, Announcer view, Camera Off, OBS Broadcast Companion (2026-10-06) — HOSTED BACKEND LIVE AND VERIFIED, MERGED, DEPLOYED TO PRODUCTION (browser and hardware checks still open)

Branch `pack18-1-event-ops` from `main` `e880e09` (Pack 18 merged, PR #38). Everything: `docs/claude-packs/PACK_18_1_EVENT_OPS.md` (architecture, final permission matrix, evidence ladder, known failures, what is not verified). Owner steps (not performed): `docs/runbooks/PACK181_HOSTED_ROLLOUT.md`. Event day: `PACK181_DEVICES.md`, `PACK181_EVENT_LAPTOP.md`.

| Level | Status |
| --- | --- |
| Implemented in repository | event sessions for eight devices (12-character code + QR, server-side expiry final day + 24 h, revoke / replace / sign-out-all), `device-session` Edge Function, device client + shell, Announcer view, Camera Off (latched, audited), Secretary/Scorekeeper powers, Temporary Organizer/Event Admin, Command Centre device/broadcast/staff panels, OBS Broadcast Companion, music policy |
| Migrations created | `20261015000100_pack181_event_sessions`, `20261015000200_pack181_roles_camera`, `20261015000300_pack181_broadcast_control` (additive) |
| Applied locally | yes (scratch databases; `run_all.sh` DATABASE GATE PASSED again on 2026-10-06 with the follow-up migration below) |
| Unit / DB | Vitest 1354/1354; Companion 186/186; `run_all.sh` DATABASE GATE PASSED (new gates 119 + 113 + 103 checks; fingerprint regenerated) |
| Real stack + Chromium | pack181-live 176/176, device-live 82/82, cc181-live 148/148, announcer-live 181/181; REAL_AUTH pack18-live 68/68; regressions pack13/14/15/16, eventday, finalize, pack10, represented-team, broadcast-realtime, five CI mocked suites all pass |
| OBS | stand-in only: `obs-live` 119/119 (**NOT real OBS**) |
| Known failures not from 18.1 (same on `e880e09`) | arena-live 2, pack09d-live 1, rumble-live 2; live-stability desktop Command Centre scroll check is position-sensitive (46/47 here at 60 %; fails on `e880e09` at 50 %/70 %) |
| Not verified | hosted Supabase (custom-role JWT, signing key, function secrets/CORS), real OBS, ducking, PA routing, cameras/mic, Windows/macOS launchers, firewall, Realtime sockets, installed iOS PWA, physical phones/tablets |
| Release pass 2026-10-06 | reconciled with main `56b1d8a`; migrations renumbered `20261015*`; device reliability scenario 24/24; hosted rollout **blocked** (Supabase connector authorization lost; function secrets / signing key need the owner; session network policy blocks `*.supabase.co`): see `PACK181_HOSTED_ROLLOUT.md` section 0 |
| For Pack 24 | `live-stability` desktop Command Centre scroll anchoring (position-sensitive, also fails on Pack 18 main at other scroll points); `pack15-live` check 33 stale since the notification popup (PR #39); arena-live 2, pack09d-live 1, rumble-live 2 (identical on Pack 18 main) |
| PR / merged / deployed / production verified | PR #42 merged 2026-10-06 14:05 UTC as `8b25e67` (merge commit; head `83b0ac0`; CI green on that head; hosted backend verified first). Main run #130 on `8b25e67`: typecheck/unit/build, database gate, browser tests, release policy (not frozen) and **Deploy GitHub Pages: success** (14:10:55 UTC). Live check (fetched from the hosted database with pg_net, since the session cannot reach github.io): `https://dothecoolwip1.github.io/BuhurtOS/` 200, last modified 14:10:50 UTC, bundle `index-BkrTK4mD.js` reports **`v0.1.0 · build 130 · 8b25e67 · 2026-10-06 14:06 UTC`**, contains the `/device` route and `functions/v1/device-session`, and points only at `mvbxlebznlgroptwwdsm.supabase.co`. **Production browser verification at phone/tablet sizes: NOT DONE** (no browser can reach the site from the session) |
| CI on PR #42 | head `5eb588c` was **red** (a race in the Companion TEST `controller.suite.ts`, not in the Companion: reproduced 5/116 under CPU load, 0/144 after the fix); `a18f353` all green (typecheck/unit/build, database gate, browser tests, release policy) |
| Hosted database (2026-10-06, rollout session 3) | **APPLIED.** Hosted history: `20261006081036 pack181_event_sessions`, `20261006081056 pack181_roles_camera`, `20261006081102 pack181_broadcast_control` (applied by the owner from the committed files at `a18f353`), and the follow-up `20261006082002 pack181_camera_log_search_path` (this session). All 62 functions created or patched by Pack 18.1 are md5-identical to a scratch database built from the repository, except `request_counter_seat`, which differs by one code comment the hosted Pack 13 body never had (behaviour identical). Roles `bos_event_device` / `bos_controller`: no login, not superuser, no BYPASSRLS, NOT members of `authenticated` or `service_role`, granted to `authenticator`. Device-executable functions beyond anon = exactly the 56 of `device_allowlist.txt` (same md5); controller = exactly `broadcast_controller_heartbeat`, `controller_state`; anon = the pinned 14. No table privilege beyond anon for either role; the 7 new tables have RLS on, no client grants, no policies |
| Security advisor | `function_search_path_mutable` on `private.camera_log_append_only` was valid (the only Pack 18.1 function without `set search_path`); fixed by the additive migration `20261016000100_pack181_camera_log_search_path` (`alter function ... set search_path = ''`; the body only raises, so behaviour is unchanged; gate check added, negative control fails without it). After it, compared with the advisor run BEFORE Pack 18.1: no new ERROR, no new anon finding; `function_search_path_mutable` back to the single pre-existing `private.result_revisions_append_only` (Pack 02); +12 `authenticated_security_definer_function_executable` = the Pack 18.1 RPCs a signed-in caller must reach (each checks authority inside, the accepted pattern of the other 186); +7 `rls_enabled_no_policy` = the 7 new tables (intended: only definer functions touch them). **Leaked Password Protection: disabled. It is only available on Supabase Pro plans and is not available on the current BuhurtOS plan (accepted plan limitation, not a Pack 18.1 regression, not a release blocker); it can be enabled if the project moves to a plan that includes it** |
| Edge Function `device-session` | **DEPLOYED** to the BuhurtOS project (version 1, ACTIVE, `verify_jwt` false as the runbook requires; `index.ts` + `_shared/deviceSession.ts` + `deno.json` exactly as committed, read back). Called from the hosted database through `pg_net`: answers `503 {"error":"not configured"}`, i.e. it runs and fails closed until its secrets exist |
| Signing key and secrets | **CONFIGURED by the owner (2026-10-06).** Current JWT signing key: imported ES256 `kid de2891ff-872c-4287-a58d-c2ead48aa36c` (the hosted JWKS publishes it with a second key `027f29ee…`; the original Supabase-managed key `bfe4ac4e…` seen earlier the same day is no longer published: owner to confirm it was moved to "previously used", not revoked). Function secrets set: `DEVICE_JWT_PRIVATE_JWK`, `DEVICE_CODE_PEPPER`, `DEVICE_ALLOWED_ORIGINS=https://dothecoolwip1.github.io` (names only; values never seen by the session). Supabase Auth now issues user tokens with `kid de2891ff…` (ES256), checked on a real password sign-in |
| Hosted permission tests | **PASSED on hosted, 336 checks**: the three Pack 18.1 gates, each as one transaction ended by a deliberate error so nothing is kept (verified: no test schema or rows left). Roles 113/113 (every role allowed/denied; Camera Off activate/release split; broadcast control; queue adjustment; announcements; staff management; result correction/voiding with revision history; announcer read-only; cross-event isolation); sessions 119/119 (revoke, replace, last sign-in wins, per-address lockout and global breaker, exact expiry incl. time zones and the clock change, sessions are not accounts, the 56-function allow-list, no table access); broadcast 104/104 (incl. the camera-log search_path fix). The Supabase SQL tool refuses (cancels) SQL containing DELETE/DROP even inside a rolled-back test, so the sessions run aged its own rate-limit rows (`update ... where ip_hash like 'ip-%'`) instead of deleting them and left the probe function to the rollback; same 119 checks locally |
| Hosted end-to-end device flow (real Supabase Auth, the deployed Edge Function, the Data API; driven from inside the database with pg_net because the session cannot reach *.supabase.co) | **PASSED.** A synthetic test organizer (`pack181-hosted-test@example.test`) signed in (200, ES256 `kid de2891ff…`) and minted 5 codes through `device-session` (200; no sign-in: 401). Sign-in: 200 for the marshal/announcer on event A and the marshal on event B, token = ES256 `kid de2891ff…`, role `bos_event_device`, `sub` = session id, claims `aud/exp/iat/role/session_id/sub` only, 600 s, CORS only for `https://dothecoolwip1.github.io` (another origin: 403); event C ended 3 days ago: 401; wrong code: 401 (same message). Data API with the device token: `device_whoami` 200 (marshal; announcer); Camera Off on its own event 200, on event B 403; event B device reading A 403; marshal and announcer release 403, organizer release 200; announcer announcement 403; `close_event` / `my_fighter_id` 403 (not on the allow-list); `event_credentials` / `event_staff` tables 403; public read 200; forged signature 401. Refresh: 200 with a new token, bogus secret 401. Sign-out: 200, then the old token 403 "this device session has ended" and refresh 401. Revoke (organizer through the Data API): 200, then the revoked token 403 and refresh 401. Lockout: 10 wrong codes from one address, then a VALID code from it 401; other devices unaffected. No session became an auth user or profile; the audit trail names each device and holds no code, secret or token; function logs hold only boot/shutdown, edge logs only method/status/URL |
| Realtime with a device token | **NOT VERIFIED** (WebSocket; not possible from inside the database and the session has no network to *.supabase.co). Check on a phone: a Command Centre / Announcer change appears on the device without reloading |
| Test data left on hosted | 3 synthetic draft events `pack181-hosted-test-a/b/c` (record_sources -> the synthetic source; all device codes revoked; event A keeps its append-only camera log and audit rows, which is why the events are not deleted); the test organizer, BANNED with no live refresh tokens; `private.p181_live` (request numbers only, no client access); pg_net responses 16 to 71 (expired/revoked tokens; pg_net removes them after 6 hours). The cleanup DELETE was cancelled by the SQL tool: the owner may delete the test account and the staging table from the SQL editor |
| Hardening note (not Pack 18.1) | `anon` / `authenticated` hold SELECT on `net._http_response` (pg_net default). Not reachable from outside: the Data API exposes only `public` and `graphql_public` (checked: `Accept-Profile: net` → 406) |
| Production deployment and browser verification | deployment: verified (row above). Browser at phone/tablet sizes (device sign-in, persistence through refresh, sign-out, Command Centre, Announcer view, Secretary permissions, Camera Off activate/release, broadcast controls, event isolation, device-mode navigation, bottom navigation, dialogs): **NOT VERIFIED on production**; covered locally by device-live, device-reliability-live, cc181-live, announcer-live and pack181-live (Chromium, phone/tablet viewports, real Postgres/PostgREST). Garrett: `docs/runbooks/PACK181_REHEARSAL_CHECKLIST.md` on real phones/tablets |
| Physical / hardware | **NOT VERIFIED**: real OBS, cameras, microphone, PA, ducking, venue network, laptop firewall, physical phones/tablets, iPhone home-screen app (Garrett: `docs/runbooks/PACK181_REHEARSAL_CHECKLIST.md`) |

### Pack 18.1 final status (2026-10-06)

The software is complete. Nothing in the two lists after COMPLETE is a Pack 18.1 software blocker: they are manual / physical checks and owner housekeeping.

**COMPLETE** (evidence in the table above)
- Hosted migrations: `pack181_event_sessions`, `pack181_roles_camera`, `pack181_broadcast_control` applied; Pack 18.1 functions match the repository
- Security / search_path fix: `20261016000100_pack181_camera_log_search_path` applied; advisor finding cleared
- Signing key setup: imported ES256 key `de2891ff…` is the current key; `DEVICE_JWT_PRIVATE_JWK`, `DEVICE_CODE_PEPPER`, `DEVICE_ALLOWED_ORIGINS` set
- Edge Function: `device-session` deployed with the committed code
- 336 hosted permission checks (sessions 119, roles 113, broadcast 104), rolled back
- Real hosted device sign-in (Supabase Auth organizer, codes minted by the function, devices signed in)
- Data API authorization with device tokens (role, allow-list, table access, forged signature refused)
- Refresh
- Sign-out
- Revoke
- Expiry (server-side, event end + 24 h; ended event refused)
- Rate limiting (per-address lockout; global breaker in the gate)
- Cross-event isolation
- Camera Off (activate by marshal/announcer roles, release only by head marshal / organizer / Temporary Organizer)
- Production merge: PR #42 → `8b25e67`
- GitHub Pages deployment: run #130 success
- Production build verification: live bundle reports `v0.1.0 · build 130 · 8b25e67`

**REMAINING MANUAL / PHYSICAL VERIFICATION** (Garrett: `docs/runbooks/PACK181_REHEARSAL_CHECKLIST.md`)
- Realtime using a real device token
- Phone browser check
- Tablet browser check
- Installed iPhone / PWA check
- Real OBS
- Real cameras
- Microphone
- PA
- Music ducking
- Venue network

**OWNER CLEANUP**
- Inspect Dashboard → JWT Keys and document what `027f29ee…` is
- Confirm `bfe4ac4e…` is "Previously used" rather than revoked, if possible
- Delete the banned test organizer `pack181-hosted-test@example.test` when convenient (Authentication → Users)
- Remove `private.p181_live` when convenient (Table Editor)
- Leave the three synthetic draft events `pack181-hosted-test-a/b/c`: their append-only camera log and audit history prevent deletion, by design
