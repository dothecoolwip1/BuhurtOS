# BuhurtOS Rumble pack status

Branch: `ccr-a435c5f7-pmrfxr`

Last updated: 2026-10-03

## Pack status

| Pack | Status | Commit | Hosted DB | Deployment | Verification notes |
| --- | --- | --- | --- | --- | --- |
| 00 Source of truth | COMPLETE | (see git log) | none (docs only) | none | Docs only. PROJECT_SPEC reconciled, CLAUDE.md added. Round 2 scratchpad was empty in this container: only the committed Part 1/Part 2 reviews exist; the ChatGPT comparison was not recoverable. |
| 01 Security and data safety | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED: `apply_migration` for `20261003000100_pack01_permissions_synthetic.sql` was cancelled when attempted; hosted DB unchanged | none; not deployed | Local gates pass (see Pack 01 notes). Hosted permission holes are STILL OPEN until the migration is applied. |
| 02 Tournament integrity | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED (depends on the unapplied Pack 01 migration being applied first) | none; not deployed | Local gates pass. Browser flows not verified (no local Supabase stack here). |
| 03 Scoring resilience | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED (needs Packs 01 and 02 migrations first) | none; not deployed | Local gates and a real-Chromium run against a MOCKED Supabase pass. Real phone and iOS not tested. |
| 04 Event runtime safety | NOT STARTED |  |  |  |  |
| 05 Identity/public data/stats | NOT STARTED |  |  |  |  |
| 06 Post-Rumble roadmap | NOT STARTED |  |  |  | Documentation only |

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
