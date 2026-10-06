# Pack 24A0: Match safety guards

Branch `ccr-1138edea-jygf5t`, on top of Pack 23R (`11f2263`). One additive migration, `20261015000100_pack24a0_match_safety_guards.sql`. **Local only: the migration is not applied to the hosted database and nothing is deployed.**

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
- **Hosted database:** has the same grants and policies the migration revokes, and no `hold_manual`. The hazards in §1 remain live there until this migration is applied through the normal process. Not applied, deliberately.
- **The Pack 23R rehearsal script** (`scripts/e2e/pack23r-rehearsal.mjs`) records evidence about the *old* behaviour and is kept as the historical record; rerunning it against this branch will show the refusals instead.
- **Deferred to 24A3 and later (not touched):** permanent fight numbers; day-specific scheduling; a published, human-ordered running order with deliberate moves; the secretary role; printable sheets; bracket source labels; best of three; exhibitions; wild cards; long axe category; one-lyst presentation; navigation cleanup; the delay and behind-schedule system. The mutation surface for those is now small and audited, which is what 24A3 needs.

## 8. Assessment

The match mutation surface is now: structure changes only through `build_schedule` (validated, history-protected, audited), results only through the scoring and correction RPCs (unchanged), queue state through `set_match_queue` / `advance_field_queue` / `move_match_in_queue` / `set_match_hold` / `save_queue_plan` (role-checked, audited), and only three harmless schedule columns writable directly (audited). That is a foundation a published running order can be built on without first having to defend against shortcuts. The two things 24A3 should not build on top of unchanged are the Event day auto-save of the plan and the absence of a hold screen (§7).
