# Pack 24A0: Match safety guards

**State (2026-10-07):**
- **Merged:** PR #51, `main` `4298aec`.
- **Hosted migrations applied:** yes, all three, by the owner through the Supabase SQL editor (section 0.6).
- **Deployed:** CI and Deploy run 153, GitHub Pages, the live bundle labelled `build 153 · 4298aec`.
- **Hosted verification:** completed (section 0.7).
- **Production smoke (automated, live site):** 47/47 public and signed-out checks. The signed-in part was not run (section 0.7).
- **Physical devices:** not tested.

Migrations: `20261019000100_pack24a0_match_safety_guards.sql`, `20261019000200_pack24_test_fighter_propagation.sql`, `20261019000300_result_revisions_search_path.sql` (additive). Branch: `claude/pack-24-safety-reconcile-grf0gg`, reconciled onto `main` `643a62a`, later merged with `7876836`.

Sections 1 to 8 are the original report, written on the stranded branch `claude/focus-layout-tablet-safety-b40tc4` before Pack 18.1 and Pack 22 reached `main`. Wherever section 0 disagrees with them, section 0 wins.

## 0. Reconciliation with main (2026-10-06)

### 0.1 Why the stranded branch could not merge as it was

| Problem | Resolution |
| --- | --- |
| Migration `20261015000100` was already taken on `main` and hosted by `pack181_event_sessions`. Pack 22 had been renumbered to `20261018*` and merged. | Renumbered to **`20261019000100`**, with follow-ups at `20261019000200` and `20261019000300`. No branch on the remote has a migration later than `20261018001000`. Hosted applies by name with apply-time versions, so no applied migration was touched. |
| A full `create or replace` of `save_queue_plan` would have silently undone Pack 18.1's patch to it (`can_adjust_queue`, which lets the Secretary / Scorekeeper plan the queue). | `save_queue_plan` is now **patched in place with an anchor**, the Pack 18.1 technique. Only the hold line changes (`or m.hold_manual`). |
| `set_match_queue` refused scorekeepers and marshals any call except opening or sending back a called fight. The owner-reviewed Pack 18.1 matrix gives "call fight" to every scoring role (`can_score`), and `pack181_roles_gate` asserts it for a Marshal device. | **Authority unchanged from `main` (`can_score`).** The function only gains the audit row `queue.state_set` (from, to, field before and after, `by` = the caller's role via `private.actor_role`). Narrowing it is listed in 0.5 as an owner decision. |
| `set_match_hold` was organizer-only. | It uses Pack 18.1's `can_adjust_queue`: organizer, platform owner, organization admin, Secretary / Scorekeeper, Event Admin device. Holding is planning the line, and planning the line is that role. It is not on the device allow-list, so a device cannot call it until that list is deliberately changed. |
| Pack 22 added `discipline_reviews.match_id ON DELETE RESTRICT`. A replace over such a fight would have failed with a raw foreign-key error. | `private.match_history_reason` adds "a discipline review was lodged about it". |
| **New gap found while reconciling:** `matches.entry_a/entry_b` are `ON DELETE SET NULL`, and an organizer could still delete or re-point (competition, fighter, team) an `entries` row through the table API. That would blank or rewrite a side of a fight that has been fought. | New trigger `entries_history_guard` refuses it while the entrant is in a fight with protected history (P0001, a sentence an organizer can act on). It allows sanctioned server paths (`private.unlocked`, team merges via `bos.merging`, non-client sessions), seed, status changes and withdrawals. `delete_event` removes matches before entries, so it is unaffected. |

Not changed from the original: protected-history rules, locking and atomic replace, bracket shape validation, table grants on `matches` (only `scheduled_at`, `field`, `duration_minutes` stay writable, and they are audited), holds surviving Event day, the Run tab messages and the public Now and Next order.

Hosted was checked read-only on 2026-10-06. The 11 functions this branch replaces or patches have md5-identical definitions on hosted and in a scratch build of `main`. Hosted `matches` still has the insert, update and delete policies, the DELETE grant and 24 column grants, and has no `hold_manual` column. **So the hazard is live in production.** *(Superseded 2026-10-07: the migrations are applied and the hazard is closed on hosted; see sections 0.6 and 0.7.)*

### 0.2 Audit follow-ups in the same branch

- **Test fighters are test data** (`20261019000200`). `create_unclaimed_fighter` on a synthetic event now tags the new fighter with the event's own synthetic source. That is one `record_sources` row, the existing Pack 01 model; nothing new was added. It also skips the look-alike check and identity reviews against real fighters, and records `synthetic` in its audit row. `add_entrant_core` refuses a synthetic fighter in a real event. Real events are unchanged. An account's fighter is never marked as test data. **Existing fighters are not backfilled:** which fighters were created for `test-stuff-test` and `test-new-test` is part of the owner's cleanup decision. Read-only query to list them: `select a.subject from public.audit_log a join public.events e on e.id = a.event_id where a.action = 'fighter.created_by_organizer' and private.is_synthetic('event', e.id) and not private.is_synthetic('fighter', a.subject::uuid);`
- **`private.result_revisions_append_only` search_path** (`20261019000300`). `alter function … set search_path = ''`, the same pattern as Pack 18.1's `camera_log_append_only` fix. The body only raises, so behaviour is unchanged. After it, no function in `public` or `private` lacks a fixed search_path (gate check). It is the only `function_search_path_mutable` finding on hosted today.

### 0.3 Tests on the reconciled branch (local)

| Check | Result |
| --- | --- |
| `pack24a0_gate.sql` | **PASSED 151 checks**. New: atomic refusal (same rows, draw settings, scoring and audit count after a refused replace that carried a new draw), the refusal message, discipline review protection, the entrant guard (allowed and refused cases), Scorekeeper and head-marshal calls audited with role, Scorekeeper hold and release, head marshal refused `save_queue_plan`. Soft mode against `main`'s schema: **80 of 151 fail**, including the replace over an active fight succeeding and deleting its score event and live score. See `docs/reviews/assets/2026-10-06-pack24-reconcile/`. |
| `pack24_followups_gate.sql` (new) | **PASSED 28 checks**. Against `main`'s schema, 13 fail. |
| Full database gate `run_all.sh` from zero | **DATABASE GATE PASSED, 49/49 steps** (`run_all-database-gate-passed-49.txt`) |
| Browser `scripts/e2e/pack24a0-live.sh` | **40/40** on the reconciled branch: Scorekeeper and head marshal calls expected and audited, Scorekeeper may hold |
| Gates changed on purpose | `security_gate`, `pack02_gate`, `pack03_gate`, `pack09c_gate`, `simulate_tournament.sql`: the organizer no longer inserts, deletes or restructures matches through the table, so the harness lays out fixtures as the database owner. The draft's changes to `pack09a_gate` and `pack09d_gate`, and its Scorekeeper / marshal `set_match_queue` refusals in `security_gate` and the simulation, were **reverted to `main`'s assertions**. |

### 0.4 Who may do what after the reconciliation (replaces the table in section 3)

| Action | Organizer / org admin / owner | Secretary / Scorekeeper | Head marshal / marshal | Check-in, fighter, other event |
| --- | --- | --- | --- | --- |
| Build or replace a fresh draw | ✓ | ✗ | ✗ | ✗ |
| Replace a draw with protected history | ✗ (refused for everyone, atomic) | – | – | – |
| Insert, delete or restructure a match through the table | ✗ | ✗ | ✗ | ✗ |
| Time, field, length through the table | ✓ audited | ✗ | ✗ | ✗ |
| Delete or re-point an entrant of a protected fight through the table | ✗ | ✗ | ✗ | ✗ |
| `set_match_queue` (call, reorder, send back, field) | ✓ audited | ✓ audited | ✓ audited (as on `main`) | ✗ |
| `set_match_hold` | ✓ | ✓ | ✗ | ✗ |
| `save_queue_plan` | ✓ | ✓ (Pack 18.1, preserved) | ✗ | ✗ |

### 0.5 Owner decisions this leaves open

1. Should marshals and the head marshal stop calling waiting fights by hand (the first 24A0 draft's rule)? Doing so contradicts the Pack 18.1 matrix, so it is not done here.
2. ~~Cleanup of `test-stuff-test` and `test-new-test`.~~ The owner approved full deletion as a one-time exception; both events were deleted from hosted on 2026-10-07 (section 0.8). Their fighters were kept (all four are real people with accounts or a real team membership); none was tagged as test data.
3. ~~Applying the three migrations to hosted, after review.~~ Done 2026-10-07 (section 0.6).

### 0.6 Applying to hosted: done on 2026-10-07

Hosted ledger (project `mvbxlebznlgroptwwdsm`), each recorded as one statement (the whole file), `created_by` the owner:

| Version | Name |
| --- | --- |
| `20261007024158` | `pack24a0_match_safety_guards` |
| `20261007024215` | `pack24_test_fighter_propagation` |
| `20261007024220` | `result_revisions_search_path` |

How it went:
- **Preflight (read-only)** before applying:
  - The 36 functions Pack 24 replaces, patches or calls were byte-identical on hosted and on a build of pre-merge `main` `7876836`.
  - So were the 19 table shapes and the policies, triggers and grants on `matches`, `entries` and `result_revisions`.
  - The only difference was Supabase's `service_role` grants. `create or replace` keeps them.
- **The `apply_migration` tool cancelled migration 1 twice,** even after the owner approved in chat. It refuses anything containing DROP or DELETE, and migration 1 must contain them (dropped policies, a replaced trigger, the `delete` in `build_schedule`). Nothing was applied by either attempt (checked after each). As the repository's rule says, no `execute_sql` workaround and no splitting.
- **The owner then applied the three committed files in the SQL editor,** in order, each with its ledger row.
- **Do not use `supabase db push` for this project.** Hosted records migrations under their apply time, not the file numbers, so the CLI would treat every repository migration as missing.

After applying, a read-only fingerprint matched a build of `4298aec` exactly: 61 items, whole-hash `f4f8534a…`. It covers:
- every Pack 24 function body, plus its security-definer and search_path settings and its execute permissions (`service_role` aside)
- `hold_manual`
- the `matches` and `entries` policies, triggers and grants

### 0.7 Hosted verification (2026-10-07)

**Final hosted permissions on `matches`:**
- Policies: `matches_read` and `matches_organizer_update` (the organizer INSERT and DELETE policies are gone).
- `authenticated`: SELECT, plus UPDATE on exactly `scheduled_at`, `field` and `duration_minutes`. No INSERT, no DELETE, no other column.
- `anon`: SELECT.
- Triggers added: `matches_audit_schedule` on `matches`, `entries_history_guard` on `entries`.
- `set_match_hold`: executable by `authenticated` only, not `anon` and not the device roles.
- The other new helpers (`match_history_reason`, `check_plan_structure`, `plan_rows`, `audit_schedule_changes`, `entries_history_guard`, `synthetic_source_of`): no client can call them.

**Behaviour on hosted, run without leaving data behind.** The local gate files were deliberately *not* run on production. Instead, `supabase/tests/hosted/pack24_hosted_verify.sql` ran as one DO block:
- It built its own throwaway synthetic event (tagged with the existing test-data source, a new random slug), a stand-in real event, three small competitions and their fighters.
- It acted as the designated synthetic test organizer (`pack181-hosted-test@example.test`) through the `authenticated` role.
- It ended with a deliberate exception, so everything rolled back.
- It contains no destructive keywords and never touches a genuine event, fight or score, or `test-stuff-test` / `test-new-test`.

All checks passed:

| Check | Result on hosted |
| --- | --- |
| Clean replace of an untouched future draw | allowed: 6 new fights, audit `replaced=6` |
| Replace over an ACTIVE fight with a score event (through `record_score_event`) and a live score | refused P0001 "This draw cannot be replaced: 1 of its fights have started … (a fight is being fought)"; same rows afterwards; the fight still active; score event 1 and live score 1 kept; no audit row for the refused attempt |
| Replace over an OFFICIAL result (through `finalize_match`) | refused P0001 "(a result is recorded)"; the fight still final |
| Replace over a fight with a lodged discipline review | refused P0001 "(a discipline review …)"; the fight kept |
| Organizer table INSERT; UPDATE of `entry_a`, `stage`, `next_match_id`, `queue_state`, `result` | all refused 42501 |
| Organizer table UPDATE of `scheduled_at`, `field`, `duration_minutes` | allowed (1 row); audited `match.schedule_changed` |
| `set_match_queue` | audited `queue.state_set`, `by=organizer` |
| `set_match_hold` (authenticated organizer) | `{"held": true, "changed": true}`; `hold_manual` true; audited `queue.hold_set` |
| Re-point (fighter) or move (competition) an entrant of the active fight through the table | refused P0001 "This entrant is in a fight that has started or has history …"; changing its seed still allowed |
| `create_unclaimed_fighter` on the synthetic event | returns `synthetic: true`; one `record_sources` row naming the event's own source (`ac7ebfbe…`); audit `synthetic: true` |
| `add_entrant` of that test fighter into a real event's competition | refused 22023; no entry made |
| A real (untagged) fighter entered in the test event | stays real |
| `create_unclaimed_fighter` on the real stand-in event | real (not tagged) |

Row counts before and after the run were identical for every table involved: events 22, competitions 143, matches 863, entries 662, fighters 124, score events 112, live scores 0, record sources 1006, discipline reviews 0, audit rows 1837 (max id 2138), notifications 27. A fingerprint of `test-stuff-test` and `test-new-test` (event rows, their fights and entries) was unchanged. No `p24-verify` event remained, no fighter has been tagged since the migration, and no manual hold exists.

Direct DELETE refusal on `matches` is proven by the grant and policy state above, not by issuing a DELETE.

**Security advisor (after):** no `function_search_path_mutable` lint remains, so `private.result_revisions_append_only` is fixed. Unrelated findings, unchanged:
- `pg_net` in the public schema
- leaked-password protection off (a plan limitation)
- 9 anon-executable security-definer functions (none from Pack 24)
- 237 authenticated-executable security-definer functions (the accepted pattern; Pack 24 adds `set_match_hold`)
- 40 RLS-on, no-policy tables (INFO, intended)

**Live site.** `scripts/e2e/pack24-production-check.mjs`, one-shot workflow run 37564308976, then removed: **47/47**, at 390x844, 768x1024 and 1024x768, fresh contexts, read-only. It covered:
- the live bundle `build 153 · 4298aec`, pointing at the hosted project
- homepage and event page, with no sideways scroll
- the field page and the check-in desk in the focus layout: focus header with Exit, one compact row, no site header, bottom bar or footer, the build label present and matching, sign-in asked
- Command Centre in the normal layout
- the Broadcast overlay
- the device sign-in page (marshal and scorekeeper device entry)
- no page errors

**Not run on production:**
- The signed-in part (sign-in, notification bell, popup and settings entry point, staff refusal): the repository's `SMOKE_X` secrets were empty in that workflow.
- The staff screens with a live fight: Command Centre content, the desk list, the scoring screen with Start round / End round, and marshal and scorekeeper device sessions. These need staff credentials or device codes. Creating those would be a production write, and no fight may be created for UI testing.

Those screens are covered locally only (`pack24a1-live` 83/83, `pack24a0-live` 40/40, `device-live` 82/82, `pack181-live` 176/176). Physical phones and tablets: not tested.

### 0.8 One-time deletion of the two test events (2026-10-07)

**Decision.** The owner approved full deletion of `test-stuff-test` (`feec4fde-ea8c-4eaa-86f2-9538b5c61785`) and `test-new-test` (`1acb67d3-db5f-40a5-bce7-682e0aa6edb3`) as a one-time exception to "history is never deleted". The approval applied only to these two event UUIDs. `public.delete_event` refused both, because they were published, had fights fought and had official results. Four append-only logs refuse any DELETE.

**Script.** `supabase/manual/hosted_delete_test_events_2026-10-07.sql`, run once by the owner in the Supabase SQL Editor. The Supabase MCP tool cancels SQL containing DELETE; nothing was split or routed around that.
- One REPEATABLE READ transaction, targeted by exact UUID; slugs are checked, never pattern-matched.
- Refuses if any other event's row references these events' rows, or if a history table whose delete guard is not bypassed has rows for them.
- Disables exactly four triggers and re-enables them before commit: `result_revisions_no_change`, `lyst_round_revisions_no_change`, `match_discipline_guard`, `registration_inspections_append_only`. No FK, constraint, RLS or other trigger was touched, and `session_replication_role` was not used.
- Deletes results first (`results.entry_id` is RESTRICT), then the two events (FK cascades do the rest), then the rows with no FK: the events' audit rows, record-source links and notifications. A notification is deleted only when its `event_slug` equals one of the two slugs AND every id it carries belongs to the same events.
- Before committing it verifies: no target row left; every affected table lost exactly the expected rows; every other table's total unchanged; protected fighters, team, organization and accounts present; every trigger in its earlier state.

**Local test first.** `supabase/manual/test_delete_test_events.sh` ran against a copy of the hosted rows (a read-only export with private fields replaced; not committed) plus a control copy of both events sharing the same fighters, team and accounts. All 7 cases passed: success, rerun refused, slug changed, cross-event reference, app session, failure after the deletes, and failure during the deletes while the triggers were disabled. Both failure cases rolled back fully, with all triggers enabled.

**Production result (owner ran the script; verification read-only by Claude, 2026-10-07):**

| Table | Deleted |
| --- | --- |
| score_events | 112 |
| audit_log | 92 |
| competitions | 21 |
| notifications | 16 (all provably owned by `test-new-test`; none ambiguous) |
| matches | 12 |
| result_proposals | 11 |
| entries | 10 |
| push_deliveries | 6 |
| lyst_rounds, lyst_round_revisions | 6 each |
| results, result_revisions | 4 each |
| lyst_matches, event_invitations, event_invitation_competitions, registration_checks, registration_competitions | 3 each |
| events, event_staff, registrations, registration_private, match_discipline, match_discipline_private | 2 each |
| lyst_timer, registration_inspections, event_announcements, event_sponsors, waiver_versions | 1 each |
| **Total** | **332** (exactly the predicted figure) |

- **Table counts:** all 115 tables (public, private, `auth.users`, `auth.identities`, `storage.objects`) compared with a baseline taken read-only before the run. The 28 tables above changed by exactly the predicted amounts; every other table is unchanged. Unchanged tables include fighters 124, teams 20, team memberships 124, `auth.users` 21, record sources 1006, entry_fighters 453 and results outside the events. After: events 20, competitions 122, matches 851, entries 652, results 596.
- **Nothing left behind:** no row in any public/private table contains either event UUID or slug, except analytics page-view rows (`activity_views` 91, `activity_sessions` 12, `activity_events` 5: the visited `path`). These are visit history, not event data, and were outside the approval, so they were kept.
- **No orphans:** none in `audit_log.event_id`, `result_revisions.entry_id`, `record_sources` entities, or notification payload ids/slugs.
- **Protected records present:**
  - Garrett, Odin, Taylor and Bjorn Robson
  - Red Deer Reavers, with Bjorn's membership (4 members)
  - the organization
  - all 4 linked Auth accounts
  - the 3 fighter-account links
- **Triggers and schema:** the four bypassed triggers are enabled, and no trigger in public/private is disabled.
  - Triggers, policies, RLS flags, grants and constraints on the 32 affected/shared tables match a build of `main` (`4298aec`).
  - Only `notifications` differs: the `reavers_discord_membership_alert` trigger and the `club_membership_submitted` notification kind. Both come from Red Deer Reavers migrations applied on hosted on 2026-10-06/07 and are not part of this cleanup.
- **Live site** (read-only `scripts/e2e/test-events-removed-check.mjs`, one-shot workflow run 37569077017, then removed): **16/16 passed**, signed out at 390x844.
  - The public API returns no row for either event.
  - Events, Calendar, homepage, Rankings and the HACSA organization page show neither event and link to neither.
  - `/events/test-stuff-test` and `/events/test-new-test` show the 404 page.
  - A real event (`red-deer-rumble-2026`) still loads.
- **Not checked in the browser:** the signed-in organizer/admin lists (My events, platform Events), because the `SMOKE_X` secrets are empty. Those lists are built from the `events` table and the `my_events` / `my_event_relations` RPCs, and the underlying event, staff and registration rows no longer exist.
- **Not deleted:** the test event's sponsor logo file in Storage (`1acb67d3-db5f-40a5-bce7-682e0aa6edb3/1791246848783.png`). Files are removed in the Storage UI, not by SQL.
- **Replacement test event:** not created.

---

The rule this pack enforces: *a live tournament match must not be silently destroyed, structurally corrupted, or materially changed through an unaudited shortcut.* It does not build the running order (24A3), the secretary role (24A2) or any UI beyond what the rules need.

Evidence: `docs/reviews/assets/2026-10-06-pack24a0/` (`gate-before-migration.txt`, `hold-baseline-repro.sql`, `evidence.json`, six screenshots). Reproduce the browser run with `scripts/e2e/pack24a0-live.sh`, the database run with `supabase/tests/pack24a0_gate.sql`.

---

## 1. Pack 23R findings: verified first

Each finding was re-checked against the code and a database built from the repository **before** any change. The new gate has a soft mode (`PGOPTIONS="-c t.soft=on"`) that records failures instead of stopping: against the unmodified schema it failed **68 of 125** checks (`gate-before-migration.txt`). Many are knock-on effects (once a rebuild wrongly succeeds, later fixtures disappear), but the core ones are exactly the reported ones.

| # | Pack 23R finding | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Draw rebuild destroys a live fight and its scoring | **Confirmed** | Baseline gate: `build_schedule('replace')` succeeded over an ACTIVE fight, over a fight with score events, and over a reopened fight with result-proposal history; each time the rows and their score events, live score and proposals were gone. The only server guard was "some fight is `final`" (`pack02` `v_final`). The UI guard was the same (`RunTab.tsx:72`) |
| 2 | Raw table writes bypass business logic | **Confirmed**, and **identical on hosted** | Local grants: `authenticated` had INSERT, DELETE and UPDATE on `entry_a`, `entry_b`, `next_match_id`, `next_slot`, `position`, `stage`, `round_label`, `pool` as well as the three schedule columns. A read-only query of the hosted project (`mvbxlebznlgroptwwdsm`) returned the same column grants, table DELETE grant and the same insert, update and delete policies, and no `hold_manual` column. Every direct edit in the baseline gate succeeded with no audit row. The client uses only three of those writes (below) |
| 3 | Deleting a bracket fight leaves a downstream match with one feeder | **Confirmed** | Baseline: the organizer's DELETE of a semifinal succeeded; the final then had **1** feeder (`gate check 30: 1 <> 2`) and no audit row |
| 4 | A scorekeeper can pull arbitrary fights into On Deck via `set_match_queue` | **Confirmed** | Baseline: a scorekeeper and the head marshal moved a waiting fight to on deck, in the hole and active, swapped on deck with in the hole, and changed a called fight's field. `set_match_queue` checked only `can_score` and wrote no audit row |
| 5 | Opening Event Day clears a hold | **Confirmed, with a correction to what it means** | See the paragraph below. `hold-baseline-repro.sql` on the untouched schema: a hold written through the only hold API reads `t`; a plan save of the kind Event day makes on open turns it `f` |
| 6 | Public Now and Next ranks IN THE HOLE before ON DECK | **Confirmed** | `liveView.ts:88` (still line 88) `{ active: 0, in_the_hole: 1, on_deck: 2 }`. The existing unit test used only `active` plus `in_the_hole`, so it could not see it. The new test fails against the old code (`['now','hole','deck']`) |

**Not reproduced as described: the hold.** Pack 23R's "a hold is erased by opening Event day" is true of a hold written through `save_queue_plan`, but **no screen creates such a hold**. The only holds the product makes are the planner's, derived from attendance (`eventPlan.ts:58,69`), and Event day recomputes those from attendance on every open; they persist for as long as the attendance says so. What *is* true, and wrong, is that Event day writes `plan_order` and `plan_hold` to the database simply by being opened (`EventDayTab.tsx:80-95`), and the server let that overwrite any hold. This pack makes a *deliberate* hold durable; it does not stop Event day saving its plan (see §7).

Also confirmed while checking: the Run tab's old message ("Reopen them first, then you can build a new draw") was misleading. After a reopen the fight keeps its score events or result proposals, so under the new rule the draw stays protected. The message was changed.

Two findings are unchanged: Pack 23R reported that the head marshal and scorekeeper are correctly refused reorder, hold, retime and withdraw (confirmed, and kept), and that the UI is not the boundary (confirmed: each refusal below comes from the database).

## 2. What changed

### 2.1 Protected history (one definition, in code and tests)

`private.match_history_reason(match)` returns why a fight is protected, or null. A fight is protected when any of these holds:

| Reason | Source |
| --- | --- |
| a result is recorded | `queue_state = 'final'`, or `result`, `winner_entry_id` or `finalized_at` set |
| a fight is being fought | `queue_state = 'active'` |
| scoring has been recorded | any `score_events` row |
| live scoring is in progress | any `match_live_scores` row |
| Lyst scoring has been recorded | `lyst_rounds`, `lyst_round_revisions`, `lyst_counts`, `lyst_counter_rounds` |
| discipline has been recorded | `match_discipline` |
| a result was submitted or reviewed | `result_proposals` (device, paper, conflict, stale) |
| a result was recorded and later reopened | audit rows `match.finalized`, `match.reopened`, `result.paper_entered` naming the match |

**Not** protected: a waiting fight, a fight that is on deck or in the hole with nothing recorded, and pure setup rows (`lyst_matches`, `lyst_counter_seats`, `lyst_timer`) that hold no sporting data. A fight set going by mistake with nothing scored can be sent back to the line and the draw replaced.

Bracket advancement needs no separate rule: a winner is placed in a later match only by `finalize_match`, and that source match is final.

### 2.2 Draw rebuild

`build_schedule` in `replace` mode now locks every fight of the draw, refuses if any is protected, and otherwise replaces atomically. The refusal is `P0001` with a usable message (shown as is in the Run tab): *"This draw cannot be replaced: 1 of its fights have started or already have a result or scoring history (scoring has been recorded). Those fights are never deleted. If a fight was only set going by mistake and nothing was scored, send it back to the line first."* The audit row `schedule.built` for a replace now carries `replaced` (how many fights), `replaced_states` (by queue state) and `replaced_ids` (capped at 100). The locking closes the window in which a scorer could start a fight between the check and the delete (the concurrency gates still pass).

### 2.3 Bracket shape

`build_schedule` also validates the plan before writing (`private.check_plan_structure`): a match that others feed has both sides covered exactly once (a feeder, or a side already filled for a bye), no two feeders into one side, no feeder into a filled side, no self-link, a slot on every link. The third-place match, filled by the server, is exempt. A plan that would leave a downstream match with a missing feeder is refused with `P0001` and writes nothing. A unit test (`src/lib/bracket.test.ts`) proves every bracket the client can generate (2 to 40 entrants, with and without third place) satisfies the same rule, and the browser run proves the real Build tournament and pools-to-bracket plans are accepted.

### 2.4 Raw table writes: classification

| Write path | Used by the app? | Decision |
| --- | --- | --- |
| INSERT any column | No (`build_schedule` only) | **Prohibited**: revoked, policy dropped |
| DELETE | No (`build_schedule replace` only) | **Prohibited**: revoked, policy dropped |
| UPDATE `entry_a`, `entry_b` | No | **Prohibited**: revoked. (`bump_match_version` and `check_match_links` stay as defence in depth) |
| UPDATE `next_match_id`, `next_slot`, `position`, `stage`, `round_label`, `pool` | No | **Prohibited**: revoked |
| UPDATE `scheduled_at`, `field`, `duration_minutes` | Yes (`runSchedule.ts:25,99`, `eventDay.ts:75`) | **Safe to keep, now audited**: stays a column grant (row policy, lock guard and closed-event guard still apply); a statement-level trigger writes `match.schedule_changed` with old and new values, actor and event, one row per statement and event, capped at 50 changes |
| `queue_state`, `queue_order`, `plan_order`, `plan_hold`, `result` and the other columns | No | Already no grant; unchanged |

A direct delete is gone, so there is no way to remove one bracket fight: removing one is a rebuild. There is no supported "replace an entrant in a waiting fight" action either; none ever had a screen. Both are 24A3's job if wanted (§7).

### 2.5 `set_match_queue`

- **Organizer** (including the platform owner and an administrator of the event's organization): unchanged.
- **Head marshal, marshal, scorekeeper**: may open a fight that is already called (on deck, in the hole, active) and send a called or active fight back to the line. They may not call a waiting fight, swap on deck with in the hole, or change a fight's field. A field screen passes the field it is showing; passing the *same* field is fine.
- **Check-in staff, fighters, captains, strangers, another event's staff**: refused as before.
- Every change writes `queue.state_set` (from, to, field before and after, organizer or scoring staff). A no-op writes nothing. `advance_field_queue` (the queue picks in order) is untouched and still works for scoring staff.

### 2.6 Holds

New column `matches.hold_manual` and RPC `set_match_hold(match, held, reason)` (organizer only; a hold needs a 3 to 120 character reason; only a waiting fight can be held). `save_queue_plan`, which Event day calls on open, now keeps a deliberate hold held (`new_hold or hold_manual`) and still updates the plan order; a hold the planner made from attendance remains the planner's to release. `promote_one` and the client already skipped held fights, so nothing else changed. Hold and release write `queue.hold_set` and `queue.hold_released` with the reason and the before state.

### 2.7 Client changes (small)

- `src/lib/liveView.ts`: NOW → ON DECK → IN THE HOLE (+ a regression test).
- `src/pages/RunTab.tsx`: the draw builder disables "Use this draw" and explains why when a fight is active or final, and the withdrawal redraw does the same; the message no longer tells people to reopen first. The server decides the rest and its message is shown.

### 2.8 Test fixtures that depended on the removed rights

The simulation helper and the NACL fictional-league generator inserted matches as the organizer; the generator (`scripts/testLeague/sql.ts`) now lays them out as the loader (17 generated seed files regenerate with `reset role` / `set local role authenticated` around the match inserts, nothing else). Several older gates asserted capabilities this pack removes; each now asserts the new rule and, where the original intent still applies, keeps it through the harness or an organizer (§4).

## 3. Permission and grant changes

```
revoke insert, update, delete on public.matches from authenticated;
grant update (scheduled_at, field, duration_minutes) on public.matches to authenticated;
drop policy matches_organizer_insert, matches_organizer_delete on public.matches;     (matches_organizer_update and matches_read unchanged)
grant execute on function public.set_match_hold(uuid, boolean, text) to authenticated; (revoked from public, anon)
```

New helpers `private.match_history_reason`, `private.check_plan_structure`, `private.plan_rows`, `private.audit_schedule_changes` are not executable by anon or authenticated. `anon` has SELECT only, as before.

Role matrix after this pack (server behaviour, tested with each person's own login):

| Action | Organizer / org admin | Head marshal | Scorekeeper | Check-in | Fighter / captain | Other event's staff |
| --- | --- | --- | --- | --- | --- | --- |
| Rebuild a draw (fresh) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Rebuild a protected draw | ✗ (refused for everyone) | – | – | – | – | – |
| Insert, delete or restructure a match through the table | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Time, field, length through the table | ✓ audited | ✗ | ✗ | ✗ | ✗ | ✗ |
| Call a waiting fight / swap called fights / change field (`set_match_queue`) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Open a called fight, send a called or active fight back | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Hold or release a fight (`set_match_hold`) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

## 4. Migrations and database files

| File | Change |
| --- | --- |
| `supabase/migrations/20261015000100_pack24a0_match_safety_guards.sql` | new, additive: one column, five functions replaced or added, one trigger, grants and two dropped policies. Nothing is deleted or rewritten; it applies from zero (the full gate builds from every migration) |
| `supabase/schema.fingerprint.txt` | updated (10 added, 5 changed lines; the diff is exactly the objects above) |
| `supabase/tests/pack24a0_gate.sql` (new), `run_all.sh` | new gate, 128 checks, added to the full gate |
| Updated to the new rules | `security_gate`, `pack02_gate`, `pack03_gate`, `pack09a_gate`, `pack09c_gate`, `pack09d_gate`, `simulate_tournament.sql` |
| `scripts/testLeague/sql.ts` + 17 regenerated `supabase/seed/nacl_test/*.sql` | seed loads matches as the loader |

## 5. Tests and results (all local)

| Check | Result |
| --- | --- |
| New gate `pack24a0_gate.sql`, strict mode | **PASSED 128 checks** |
| Same gate against the unmodified schema (soft mode) | 68 of 125 failed (the "before") |
| Full database gate `supabase/tests/run_all.sh` | see §5.1 |
| `npm test` | 87 files, **1045 tests passed** (965 before; +80: the Now and Next regression, and the bracket structure rule over 2 to 40 entrants, with and without third place) |
| `npm run typecheck` | clean |
| `npm run build` | clean |
| Browser run `scripts/e2e/pack24a0-live.sh` | **41 / 41** |

What the new gate covers, against the task's checklist: (1) a fresh untouched draw rebuilds; (2, 3) a draw with an active fight, scoring events, an official result, a reopened result, a Lyst round or discipline cannot be replaced and the rows, score events, live score and proposals survive; (4) every direct structural write is refused for the organizer; (5, 6) a bracket fight cannot be deleted, and plans with an unfed side, two feeders into one side, a collision with a filled side or a self-link are refused without touching the existing bracket, while byes and a two-fighter final are accepted; (7, 8) a scorekeeper and the head marshal cannot call a waiting fight, swap called fights, or change a field, and can still open a called fight, send it back, repeat a state and start the next fight through `advance_field_queue`; (9, 10) a saved plan with no hold in it leaves a deliberate hold held, the planner's own hold is still released by the planner, the queue skips a held fight, and only an organizer can release it; (12) an administrator of another organization, the organizer of another event, a scorekeeper of another event, check-in staff, head marshal and a plain fighter are refused on rebuild, queue and hold; (13, 14) audit rows exist for each material success (`schedule.built` with `replaced`, `match.schedule_changed`, `queue.state_set`, `queue.hold_set`, `queue.hold_released`) with the actor, and **none** exists for a refused attempt; an administrator of the event's organization acts as an organizer.

### 5.1 Full database gate

Final run of `supabase/tests/run_all.sh` on the finished branch: **DATABASE GATE PASSED, 39 of 39 steps ok** (migrations from zero, every pack gate including `pack24a0_gate`, shared vectors, schema fingerprint, simulation, fictional-league verifier, and the concurrency suites for schedule build, field queue and result commits). The earlier runs found the six gates and two harnesses that depended on the removed rights (§4); each was reviewed individually rather than blanket-edited.

## 6. Browser verification (real Chromium against local Postgres + PostgREST + the built app)

Fixture: the Pack 23R TEST weekend (50 fighters, 10 categories, one lyst). Screenshots in the evidence folder.

| Scenario | Size | Result |
| --- | --- | --- |
| Build tournament with the real client: all 10 draws accepted (three knockouts of 6 with byes, 8 and 8, pools, round robins) | 1280 | 10 competitions, 99 fights, every bracket side covered exactly once |
| Longsword pools finished by the scorekeeper, then **Build bracket from pool results** in the Run tab | 768 | 8 bracket fights accepted; final has both feeders |
| **Hold survives opening Event day**: deliberate hold, saved plan wiped so the page must re-plan; Event day opened | 1280 and 768 | the page saved a plan for 91 waiting fights; the hold is still held both times |
| Explicit release by the organizer, then Event day opened again | 1280 | released and not re-held; audit shows set and release by the organizer |
| Scorekeeper, head marshal, check-in, fighter, stranger try to hold | API | all 403 |
| **Public Now and Next** with a fight now, one on deck, one in the hole | 390 and 1280 | NOW → ON DECK → IN THE HOLE |
| Run tab: a competition with an **active** fight: build a new draw | 1280 | message shown, "Use this draw" disabled, fights intact |
| Run tab: a competition with a scoring event the screen cannot see: confirm replace | 1280 | the server refuses and the screen shows its reason; fights and event intact |
| Run tab: an untouched competition rebuilt | 1280 | rebuilt, audit shows `replace` and 9 replaced |
| Scorekeeper's field screen lists the 3 called fights and opens the on-deck fight | 768 | opens (still works) |
| Scorekeeper and head marshal pull a waiting fight on deck | API | 403, state unchanged; the organizer's identical call succeeds |
| Organizer's raw DELETE, entrant edit, relink, insert on `matches` | API | all 403 `permission denied for table matches`; the fight unchanged |
| Run › Set time | 1280 | time written; `match.schedule_changed` with the new time |

Not verified in a browser (and why): a held fight is not shown anywhere in Event day (no hold UI exists, §7), so the hold check reads the database; the phone size for Event day and Run was not re-run (only the public page at 390 was); the real Supabase Auth and realtime paths were not used (the local stack signs its own tokens and polls).

## 7. Known remaining risks and intentionally deferred

- **Event day still saves its plan just by being opened.** The deliberate hold is safe, but `plan_order` and the planner's holds are still written on view. Stopping that belongs to 24A3, where the planner becomes a proposal tool.
- **No hold UI.** `set_match_hold` is an organizer RPC with no screen, and a deliberately held fight is not explained in Event day (its "N fights are held back" line describes only planner holds). 24A3 and 24A4 own the screens; until then a hold is something the organizer can only set through the RPC.
- **No supported way to remove one bracket fight or to replace an entrant in a waiting fight.** Neither ever had a screen; the table route is closed. A deliberate, audited RPC is a 24A3 candidate. A wrong bracket slot before any scoring is fixed by rebuilding that draw.
- **A draw cannot be rebuilt once any of its fights has history, even if every result was reopened.** That is deliberate (history is corrected, never deleted), but an organizer who started and then wants to restart a competition has no supported route. If the owner wants one, it must be an audited reset that supersedes rather than deletes; not built here.
- **Event deletion** (`delete_event`, drafts and synthetic events only) is guarded by "published, closed, official results, final fights", not by `match_history_reason`, so a *draft or synthetic* event with an active fight or scoring events but no final result can still be deleted. Not changed here; worth tightening in a later integrity pack.
- **Schedule audit is per statement.** Bulk-scheduling a competition writes one `match.schedule_changed` row per match (the screen saves them one at a time). Acceptable noise; revisit if 24A3 moves scheduling behind an RPC.
- **`save_queue_plan` and planner holds are still organizer-triggered by a screen**; a scorekeeper cannot, as before.
- **Hosted database:** has the same grants and policies the migration revokes, and no `hold_manual`. The hazards in §1 remain live there until this migration is applied through the normal process. Not applied, deliberately. *(Superseded 2026-10-07: applied and verified on hosted, section 0.7.)*
- **The Pack 23R rehearsal script** (`scripts/e2e/pack23r-rehearsal.mjs`) records evidence about the *old* behaviour and is kept as the historical record; rerunning it against this branch will show the refusals instead.
- **Deferred to 24A3 and later (not touched):** permanent fight numbers; day-specific scheduling; a published, human-ordered running order with deliberate moves; the secretary role; printable sheets; bracket source labels; best of three; exhibitions; wild cards; long axe category; one-lyst presentation; navigation cleanup; the delay and behind-schedule system. The mutation surface for those is now small and audited, which is what 24A3 needs.

## 8. Assessment

The match mutation surface is now: structure changes only through `build_schedule` (validated, history-protected, audited), results only through the scoring and correction RPCs (unchanged), queue state through `set_match_queue` / `advance_field_queue` / `move_match_in_queue` / `set_match_hold` / `save_queue_plan` (role-checked, audited), and only three harmless schedule columns writable directly (audited). That is a foundation a published running order can be built on without first having to defend against shortcuts. The two things 24A3 should not build on top of unchanged are the Event day auto-save of the plan and the absence of a hold screen (§7).
