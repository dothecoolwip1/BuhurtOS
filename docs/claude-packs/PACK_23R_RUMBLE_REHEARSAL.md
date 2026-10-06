# PACK 23R RUMBLE REHEARSAL

Discovery and rehearsal only. No production source, migration, hosted database, Cloudflare or deployment was changed. Pack 24 was not started.

* Repository reviewed: `main` at `56b1d8a` (Pack 18 + Reavers club work merged), on branch `ccr-1138edea-jygf5t`.
* Rehearsal: a local Postgres 16 built from all 61 migrations, PostgREST 12.2.3, the real built app (`vite build`), and Chromium. Everything is fictional TEST data on a throwaway database.
* Reproduce: `PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack23r-rehearsal.sh [shots-dir]`.
  * Fixture: `scripts/e2e/fixtures/pack23r.sql`. Journey: `scripts/e2e/pack23r-rehearsal.mjs`.
  * Every observation is written to `<shots>/evidence.json`. The run this report quotes is committed as `docs/reviews/assets/2026-10-06-pack23r/evidence.json`, with 13 screenshots beside it.
* The journey ran three times. Runs 1 and 2 exposed experiments that hit the wrong target, because the draw is random each run: a withdrawn fighter who had already lost, and a rebuild aimed at a competition with a final result. Those were fixed to pick their targets from the database. **Run 3 is the one reported.** Every number below is from run 3 unless it says otherwise.

Evidence keys in `[brackets]` refer to `evidence.json`. Code references are `path:line` on `56b1d8a`.

---

## 1. Executive summary

**Can the current BuhurtOS run a tournament shaped like the paper schedules?**

Not as the paper describes it. It can run the *fights*: build every draw, score ~110 fights on one lyst, advance brackets, apply walkovers and keep an audited record. It does not have the paper sheet's *running order*.

BuhurtOS has no stable fight number, no day, no lunch row and no fixed slot for a future bracket fight. Its order is recomputed by a rest-based planner, so it moves under the operator's hands.

**What works (proven at Rumble scale in the real app):**

* Build tournament made 10 draws and 99 fights for 50 fighters on one lyst in about 0.4 s `[build.ms]`, with every fight planned for rest.
* A scorekeeper's finish took about 190 ms per fight through the idempotent command `[run.ms_per_fight_api]`.
* Brackets fill automatically: byes are pre-placed and semifinal losers go to the third-place fight `[bracket.sword_shield_semis_after]`.
* Withdrawals produce audited walkovers automatically `[withdraw.after]`.
* Pools into a bracket is verified against the standings on the server `[pools.bracket_offer]`.
* Every forbidden action by the wrong role was refused by the database, not just hidden `[permissions.denied_or_allowed]`.
* "N fights ahead of you" matched the server's line exactly `[view.f1.*]`.
* No screen errored, and nothing scrolled sideways at 390, 768, 1024 or 1280 `[scale.live]`.

**What would stop the Rumble being run the paper way (critical):**

1. **No day boundary.** Saturday's line included Sunday's categories.
   * The first fight BuhurtOS recommended on Saturday was a Sunday Men 5v5 quarterfinal `[built.first_sunday_fight_at_planned_position = 1]`.
   * 23 of the first 60 planned fights were Sunday fights `[built.sunday_fights_in_first_60_planned]`.
   * 7 of the first 16 fights actually run were Sunday categories `[run.sixteen_fights_in_order_run]`.
2. **No stable human fight number.** The secretary, the announcer, the paper sheet and the screen cannot refer to "Fight 47".
   * The only numbers on screen are a 1 to 5 position in "Up next", which changes as the line moves.
3. **The running order is not durable.**
   * One "run later" freezes the whole line as hand-arranged (87 of 87 fights get a manual order) `[identity.manual_queue_order_rows_after_moves]`.
   * A hold is silently erased as soon as an organizer opens Event day `[hold.after_an_organizer_opens_event_day_plan_hold_is = f]`.
   * After a hand move, newly known bracket fights drop to the end of the line: the Sword & Shield semifinals went to positions 71 and 72 `[bracket.sword_shield_semis_after]`.
   * Published times are overridden by the hand order or the plan: 2 of 10 timed fights ran before a fight timed earlier `[delay.saturday_finished_out_of_time_order]`.
4. **Rebuilding a draw while a fight is live silently destroys it.**
   * `build_schedule('replace')` succeeded while a Sabre fight was ACTIVE. The active fight's row and its live score events were deleted, and the only trace is a `schedule.built replace` audit line `[rebuild.replace_while_a_fight_is_ACTIVE]`.
   * An organizer can also DELETE a waiting bracket fight, or overwrite a bracket side, through the table API with **no audit row**. The deleted quarterfinal left its semifinal with one feeder forever `[rebuild.organizer_deletes_*]`, `[rebuild.organizer_writes_*]`.
5. **The secretary has no running-order authority and no screen.**
   * Head marshal and scorekeeper are refused reorder, hold, retime and withdraw, both on the server and in the UI ("This area is for organizers").
   * Yet a scorekeeper *can* pull any fight to On deck through `set_match_queue` `[permissions.scorekeeper_set_match_queue_on_deck_out_of_order]`. The authority model is inconsistent.
6. **Nothing printable.** No print view exists. The only list containing every fight is Run, which is about 29,500 px tall on a tablet with 585 to 718 controls `[scale.live]`.

**Data model versus UI.**

* Items 1, 2, 3 and 4 are data-model and server problems. They cannot be fixed by screens alone.
* Item 5 is half server (role checks) and half UI (no secretary screen).
* Item 6 is UI on top of item 2 and needs it first.

---

## 2. Rehearsal dataset

| | |
| --- | --- |
| Event | `TEST Red Deer Rumble 2026 (Pack 23R rehearsal)`, slug `test-rumble-23r`. Two days (today and tomorrow in America/Edmonton, so the app treats it as running). `field_count = 1`. Published. Tagged synthetic through `record_sources`, and shown with the TEST DATA banner `[setup.event]` |
| People | 52 fictional fighters with accounts, reused from the Pack 11 fixture (40 men on 8 teams, 12 women on 3 teams). Team 1 is renamed **TEST Reavers** (fighters 1 to 5 and women 41 to 44; captain fighter 1) |
| Registrations | 50 registrations through the real `submit_registration` as each fighter, then accepted, paid and rostered. 49 checked in; fighter 34 never arrives `[setup.registrations_accepted_paid_rosters_checkedin = 50/50/50/17/49]` |
| Roles | organizer `a2`, head marshal `a3`, scorekeeper `a4` (the "secretary"), check-in staff `a5`, stranger `a7`, fighter and captain `f1`, an injured fighter, anonymous |
| Saturday categories | Men Longsword 16 (4 pools of 4, then an 8-fight bracket) · Men Sword & Shield 6 (knockout of 8: two byes) · Women Longsword 5 (round robin) · Men 3v3, 6 teams (round robin) |
| Sunday categories | Men Long Axe (Polearm) 6 (round robin) · Men Sword & Buckler 8 (knockout) · **Women Sword & Shield, 2 entrants** · Men Sabre 7 (2 pools, then a bracket) · Men 5v5, 8 teams (knockout) · Women 3v3, 3 teams |
| Fights | **99 built** by Build tournament `[built.total_matches]`. **109 in the event at the end** of the rehearsal: +8 Longsword bracket, +1 exhibition, +2 extra best-of-three bouts, −1 quarterfinal deleted in a test `[final.state_counts]`. A full weekend is 111 sporting fights (+4 Sabre bracket) plus exhibitions |
| Load per fighter | 22 fighters in 3 or more categories `[setup.fighters_in_3plus_categories]`. 27 fighters with 5 or more fights already known, up to 14 `[built.*appearances*]`. Fighter 1 alone is in Longsword, 3v3, Long Axe, 5v5 and the exhibition |
| Special cases | two-entrant category; round robins; pools into a bracket; 6-in-8 byes; unresolved later rounds; a withdrawal through injury; fights moved later and earlier; a hold; a timed Saturday with a 45-minute lunch gap; an ~18-minute drift; a fun fight; a rebuild during a live fight; a TEST team |

---

## 3. Gap matrix

Support is rated **Yes**, **Partial** or **No**. The destination is the pack where the evidence says the fix belongs (see §10).

| Real world requirement | Current support | Evidence | Gap | Destination |
| --- | --- | --- | --- | --- |
| One lyst as the normal case | Partial | `field_count=1` built fine, one lane `[build.review_lanes=1]`. But "Field 1" is shown 62 to 99 times on Run, plus the Event day heading, the arena heading and the fighter chips `[scale.live …field1]`. `toMatch` forces `'Field 1'` (`src/data/matches.ts:41`) | Field language shown everywhere when there is only one lyst | 24D (with 24A4 for the secretary screen) |
| Separate Saturday / Sunday | **No** | No day column on matches or competitions. The planner only knows per-fighter `attend_dates` (`src/lib/eventPlan.ts:58`). The first planned fight was a Sunday fight `[built.first_sunday_fight_at_planned_position=1]` | Categories cannot be assigned to a day; Saturday calls Sunday fights | **24A3** |
| One chronological running order mixing categories | Partial | The server line `private.queue_ordered` mixes all categories per field, with 59 category switches in 87 fights `[built.competition_switches_in_planned_order]`. But it is computed, not authored, and only per field | Order is a planner output, not an authored list | **24A3** |
| Stable human fight number | **No** | No number column (`[built.number_like_columns_on_matches] = round_label` only). Event day shows `{i + 1}` (`FieldBoardView.tsx:128`), which is transient | No fight number for paper, announcer or secretary | **24A3** |
| Number ≠ running position (fight 31 runs before 12) | No (no number at all) | as above | needs the stored number first | 24A3 |
| Move a fight later or earlier, keeping its identity | Yes (server), organizer only | id and `position` unchanged after later ×3 and earlier ×1. Audit `queue.reordered` ×4 `[identity.*]` | Works, but see the next two rows | — |
| Moving one fight should not freeze the whole order | **No** | One move set `queue_order` on 87 of 87 waiting fights `[identity.manual_queue_order_rows_after_moves]`. Event day then says "This field's line was arranged by hand" | Moves rewrite the whole line | 24A3 |
| Hold a fight while later ones run | Partial, then lost | `save_queue_plan` hold set, then erased the moment an organizer opened Event day, because Event day auto-saves its plan (`EventDayTab.tsx:80-95`) `[hold.*]` | Hold is not durable | **24A3** |
| Secretary/scorekeeper can reorder, hold, retime or withdraw | **No** | 403 for head marshal, scorekeeper, check-in, fighter and stranger. Table writes return 0 rows `[permissions.denied_or_allowed]`. UI refuses Manage for head marshal and scorekeeper `[view.headmarshal.manage.text]` | No delegated running-order authority | **24A2** |
| Scorekeeper can only call fights in the order given | **No (too broad)** | Scorekeeper `set_match_queue` put fight #21 on deck, and it jumped to line index 1 `[permissions.scorekeeper_set_match_queue_on_deck_out_of_order]` | Inconsistent: can call anything, cannot reorder | 24A2 |
| Lunch / break / awards as a running-order row | **No** | No table or row type `[time.lunch_row_possible]`. Only free-text `events.time_note`, parsed by `EventDaySchedule.tsx:3-8`, or an announcement `[time.closest_lunch_concept_announcement=200]` | Program blocks missing | 24A3 (data) / 24B2 (paper) |
| Exhibition / fun fight | **No** | Built as a competition with tier *Exhibition*: it joined the line at #70 and is listed publicly `[exhibition.*]`. Its loss appears in fighter 1's record ("LOST vs Brann Oakley · Exhibition: Fun fight (TEST)", `[view.f1.my_next_fight]`). It is counted in `career_fights_all`, and the official views filter only synthetic or excluded events, not tier. Places 1 and 2 are given by finalize preflight | No exhibition flag; its results leak into records and placings | Format Pack (data) — do **not** record exhibitions in BuhurtOS at the Rumble |
| Later rounds as "QF1 winner", "Pool A 1st", "SF2 loser" | **No** | Only "To be decided" (`liveView.ts:11`, `RunTab.tsx:185`). Pool brackets do not exist until every pool fight is final `[built.longsword_non_pool_rows_before_pools_finish = 0]` | No placeholder labels; pool brackets cannot be scheduled ahead | 24A3 (labels, slots) |
| Downstream fight keeps its schedule slot when filled | **No** | After a hand move the filled semifinals went to the end of the line (71 and 72) `[bracket.sword_shield_semis_after]`. Under the planner the new quarterfinals moved from 38–41 to 23, 34, 27 and 39 `[pools.new_quarterfinals_*]` | No reserved slot for a future fight | 24A3 |
| Automatic bracket population | Yes | QF winners filled the semis; the walkover sent the semifinal loser to third place `[withdraw.after]` | — | — |
| Byes (6 in 8) | Yes | 2 quarterfinal rows; seeds 1 and 2 pre-placed in the semis; no bye row (`bracket.ts:68,84`) `[built.sword_shield_6_in_8]` | Quarterfinal labels have gaps ("Quarterfinal 2 / 4") | 24A3 (labels only) |
| Wild cards | No | none in code (only advice text, `tournament.ts:103`) | — | Deferred |
| Two-entrant category | Partial | 1 round-robin fight `[built.two_entrant_women_sword_shield]`. Best of three is advice text only (`tournament.ts:66`) | No series | **Format Pack** |
| Best of three | **No** | Three rows for the same pair are accepted, and places come out right for a 2–1. But each bout is a separate career fight (6 career rows), and pool wins / base points count per bout `[format.bo3_*]` | Workaround distorts records | **Format Pack** |
| Withdrawal / injury | Yes, organizer only | Walkover automatic and audited. The injured fighter is then placed in the third-place fight ("Ulric Hartley vs ?") `[withdraw.after]`, `[withdraw.withdrawn_fighter_now_in_third_place_match = 1]` | Head marshal cannot withdraw. A withdrawn fighter is shown in a future fight | 24A2 (authority) / Format Pack (third-place rule) |
| Draw rebuild safety | **No** | Replace during an ACTIVE fight succeeded and deleted it and its live score events `[rebuild.replace_while_a_fight_is_ACTIVE]`. Refused only after a final (server and UI share the same `hasFinal` guard, `RunTab.tsx:72`) | Live fights and scoring can be destroyed | **24A0 (new, small)** |
| Critical match edits only through audited RPCs | **No** | `authenticated` has DELETE and column UPDATE on `entry_a/entry_b/next_match_id/position/stage/…` for organizers. Direct DELETE and PATCH succeeded with 0 audit rows `[rebuild.organizer_*]` | Unaudited bracket surgery possible | **24A0** |
| Original vs estimated vs actual time | **No** | Only `scheduled_at`, `finalized_at`, `created_at` `[time.columns_on_matches]`. Start time only inferable from `audit_log queue.advanced` | No estimated time, no actual start | 24A3 |
| "Behind schedule" alert | Partial / blind | `commandCentre.ts:71-83` looks only at the current or next fight, with a 15-minute threshold. With 3 overdue timed fights (one 18 minutes late) on deck and in the hole, nothing showed, because the fight on the lyst was untimed `[delay.*]` | Unreliable when timing is mixed | 24B1 |
| "Up in 4 fights · ~10 min late" | Partial | Fights ahead exists and is exact (UI 1, 10, 13, 20 vs server 0, 9, 12, 19 + the live fight) `[view.f1.*]`. No delay figure | Lateness is one subtraction once times are trustworthy | 24C1 (after 24A3) |
| Not-ready warns, never blocks staff | Yes | "A warning only: the fight is not held back" on the scoring screen. Command Centre shows "10 fighters called to fight but not ready". Fights ran | — | — |
| Printable running order | **No** | One `@media print` rule that hides navigation (`app.css:1382-1385`). No print view, no `window.print` | No paper output | 24B2 (needs 24A3) |
| TV running order | Partial | Arena shows now, on deck and in the hole only (`arena.ts:89` keeps 3 upcoming). It reads matches without `queue_order/plan_order` (`matches.ts:37`, `useArenaData.ts:12`), so "Up next" can differ from Event day | Order mismatch risk; no list view | 24B3 |
| Public "Now and next" order | **Bug** | Public page lists NOW → IN THE HOLE → ON DECK `[view.anon.now_and_next_order]`, because `liveView.ts:88` ranks in the hole before on deck | Wrong order shown to the public | 24C2 (one-line fix) |
| Team highlighting (Reavers) | No | No team filter or highlight on any running-order view. `MyTeamPanel` shows readiness only | — | 24C2 / 24C1 |
| Org admin as organizer | Partial | The server counts an org admin as an organizer (`has_event_role`). The UI only checks `organizer`/`owner` (`src/data/api.ts:94`) | UI locks out a real authority (code finding, not run) | 24D |
| Scale: Run tab | **No (at scale)** | 26,955 to 36,406 px; 585 to 718 controls; 2,321 to 2,387 DOM nodes; 26 to 43 screens `[scale.*.run.*]` | Unusable as an operating list | 24A4 / 24D |
| Scale: Event day, Command Centre, field, arena | Yes | Event day 3.5 to 5.7 screens with 45 to 60 controls. Command 2 to 5 screens. Field and scoring fit one screen. Arena fits. Load 0.5 to 1.0 s with 0 errors `[scale.live]` | — | — |

---

## 4. Running order findings

**Stable match identity.**

* A match's UUID never changes when it is moved, called or held, and neither does its bracket `position` `[identity.X_before/X_after]`.
* Results, readiness, notifications and audit all key on the UUID.
* Identity is destroyed only by a draw rebuild (`build_schedule('replace')` deletes and re-inserts, `pack02:422`) or a direct DELETE.
* **UUIDs are independent of any human number, because there is no human number.**

**Human fight numbers.**

* None is stored: `matches` has no number-like column `[built.number_like_columns_on_matches]`. None is generated stably either.
* Event day's "Up next" shows `1 … 5` (`FieldBoardView.tsx:128`), which renumbers on every call or move.
* LiveBracket shows "Quarterfinal 2" from `position + 1` (`liveView.ts:75`). That is stable until a rebuild, but per round, so "Quarterfinal 2" exists in every bracket. With byes it is non-consecutive ("2" and "4").
* Answers to Q1 to Q7:
  * There is no stable number.
  * It could not survive movement because it does not exist.
  * Nothing is stored; the on-screen index is derived from order.
  * A rebuild makes new UUIDs and new positions.
  * A withdrawal changes nothing structurally: walkover rows stay with their identity.
  * Identity survives moving earlier or later.
  * UUIDs are independent.

**Schedule position.**

* The server line is `private.queue_ordered`: called slots, then `queue_order` (hand), then `plan_order` (planner), then `scheduled_at`, then bracket order. The client mirror is `compareRunOrder` (`src/lib/eventDay.ts:68-83`).
* Positions are **re-derived continuously**:
  * The planner re-plans on every result and saves through `save_queue_plan` whenever an organizer has Event day open (`EventDayTab.tsx:80-95`). This is what erased the hold.
  * The first hand move converts every waiting fight to hand order (`move_match_in_queue` rewrites `queue_order` for the whole line, pack09a). After that, newly runnable fights (filled semifinals, a new bracket) have no `queue_order` and **sort after all 70 hand-placed fights** `[bracket.sword_shield_semis_after = line 71, 72]`.
  * "Let BuhurtOS plan it again" (`clear_manual_queue`) discards every hand move at once.

**Movement.**

* Organizer: `first`, `earlier`, `later` and `skip` are one swap per tap (`move_match_in_queue`). Moving a fight 30 places takes 30 taps, or `first`.
* No "move after fight N" and no "move to Sunday".
* A hold exists only as `plan_hold`, organizer-only, and is not durable (above). Q16: a fight can be held only until the next re-plan.

**Time.**

* `scheduled_at` is optional and written by Run › Set time or Bulk schedule as direct table updates (organizer RLS). Build tournament writes no times (`eventPlan.ts:40-41`).
* Timed fights are treated as a hand order by the planner (`eventPlan.ts:42-44`), but a real hand order (`queue_order`) outranks them, and untimed fights are mixed in for rest.
* In the rehearsal:
  * 51 Saturday fights were timed with a lunch gap `[time.saturday_fights_timed]`.
  * Sunday fights, untimed, kept running between them `[delay.line_first_8_after_replan]`: an untimed Long Axe fight is first, ahead of 3 overdue timed fights.
* Re-timing 41 fights fired 29 `schedule_changed` notifications, throttled per person `[delay.schedule_changed_notifications]`. A real "we are 15 minutes late" shift would notify, which is acceptable.
* No original, estimated or actual start is distinguished (Q38 to Q39). Behind-schedule is `commandCentre.ts:73-94`: one fight versus now, at 15 minutes or more, and silent if that fight has no time (Q40).
* "N fights away" exists: `myFight.ts:69-77`, plus the `ahead` count in the in-the-hole alert (Q41).
* Q42: the sentence "Your fight is up in 4 fights · about 10 minutes late" needs only `fightsAhead` plus `now − scheduled_at` of the fight on the lyst. That is small, **but only after 24A3 makes the times authoritative**. Today the times and the order disagree.

**Multi-competition ordering.**

* Mixing works. The planner interleaves categories well for rest: no back-to-back fights, 87 fights planned in milliseconds.
* The problem is the opposite of the paper's: it mixes *everything*, including the other day, and nothing pins an order.

**One-lyst assumptions (Q43 to Q46).**

* With one field, Event day hides the field picker (`EventDayTab.tsx:213`) but still headlines **FIELD 1**.
* Run shows a "FIELD 1" chip on every card (`RunTab.tsx:192`).
* My next fight says "on Field 1" and shows a Field 1 chip on every row.
* Arena shows FIELD 1, Command Centre has field cards, and the server notification says "Report to Field 1".
* The field concept is a free-text `matches.field` with null meaning Field 1 (`private.field_key`). That is fine for data; it is a presentation issue.
* What would need to change later: one `singleLyst` flag from `events.field_count = 1` and the distinct fields, consulted in about 12 places: FieldBoardView heading, RunTab chip, MatchSchedule and BulkSchedule field inputs, MyNextFight chip and wording, CommandCentre field section, LiveNow, ScorekeepingPanel, arena and broadcast pickers, `eventDay.ts` attention titles, and the notification payload wording. Not implemented here.

---

## 5. Permission findings

Every server row was exercised with that person's own JWT against PostgREST `[permissions.denied_or_allowed]`. Table writes the database refuses come back as `200 rows=0` (RLS filters the row), not as an error.

| Action | Organizer | Head marshal | Scorekeeper | Check-in staff | Fighter / captain | Stranger / anon |
| --- | --- | --- | --- | --- | --- | --- |
| Reorder (`move_match_in_queue`) | Server ✓ · UI ✓ (Event day › Change) | Server ✗ 403 · UI none | ✗ 403 · none | ✗ 403 | ✗ 403 | ✗ 403 |
| Hold / plan (`save_queue_plan`, `clear_manual_queue`) | ✓ · UI automatic plan, "plan it again" | ✗ 403 | ✗ 403 | ✗ 403 | ✗ | ✗ |
| Call any fight to active, on deck or in the hole; send back (`set_match_queue`) | ✓ · Event day, Run | **✓ server** · UI: field page shows only called fights | **✓ server** (pulled #21 to on deck) · UI: tapping a fight on the field page makes it active | ✗ 403 | ✗ | ✗ |
| Start next (`advance_field_queue`) | ✓ | ✓ server · no UI | ✓ server · no UI (the field page sets active directly) | ✗ | ✗ | ✗ |
| Score / finish (`submit_match_result`, `finalize_match`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Official result from paper, resolve conflicts | ✓ | ✓ (field page) | ✗ | ✗ | ✗ | ✗ |
| Reopen a result | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Retime (`scheduled_at` table update) | ✓ (Run) | ✗ rows=0 | ✗ rows=0 | ✗ rows=0 | ✗ | ✗ |
| Withdraw an entrant | ✓ (Run) | ✗ 403 | ✗ 403 | ✗ 403 | ✗ | ✗ |
| Build or rebuild a draw | ✓ (Build, Run) | ✗ 403 | ✗ 403 | ✗ 403 | ✗ | ✗ |
| DELETE a match, PATCH bracket sides (table API) | **✓, unaudited** | ✗ rows=0 | ✗ rows=0 | ✗ rows=0 | ✗ rows=0 | ✗ rows=0 |
| Announcement (lunch, delay) | ✓ | ✗ 403 | ✗ 403 | ✗ 403 | ✗ | ✗ |
| Readiness override | ✓ | ✓ (desk) | ✗ | ✗ | ✗ | ✗ |
| Command Centre | ✓ (with actions) | ✓ read-only | ✗ | ✗ | ✗ | ✗ |
| Manage / Event day screen | ✓ | ✗ "This area is for organizers" | ✗ same | ✗ | ✗ | ✗ |

**What is wrong at the server layer:**

* **(a) Running-order authority is organizer-only.** The head marshal and the secretary, who run the lyst, cannot move, hold or retime a fight. 24A2 must decide the verbs for the scorekeeper/secretary and head marshal.
* **(b) `set_match_queue` lets any scorer or marshal call any fight**, ignoring the order. That is broader than reorder, which they are denied. It should become "call the next fight / send back" for scorers, with arbitrary calls reserved for the running-order authority.
* **(c) Organizer table grants on `matches`:**
  * DELETE, and column UPDATE of `entry_a`, `entry_b`, `next_match_id`, `next_slot`, `position` and `stage` (`20261001002100_entry_rosters.sql:117-118`).
  * These bypass `build_schedule` and the audit log. CLAUDE.md says critical sporting mutations go through controlled RPCs.
  * The app itself uses only `scheduled_at`, `field` and `duration_minutes` (`src/data/runSchedule.ts:25,99`, `src/data/eventDay.ts:75`), so the rest can be revoked without breaking a screen. Check during 24A0.
* **(d) `build_schedule('replace')` does not refuse active or called fights**, or fights with live score or Lyst data (pack02:382). The rows cascade away (`match_live_scores`, `lyst_*`, `score_events` are `on delete cascade`).

**UI-only issues:** org admins are organizers on the server but are refused by the UI (`src/data/api.ts:94`). This is a code finding; it was not exercised in the browser.

**Correct and worth keeping:** every refusal above is enforced by the database. Hidden buttons are never the only barrier.

---

## 6. Format findings

* **Two-person categories (Q31 to Q34).**
  * Build tournament advises a round robin for 2 to 6 entrants (`buildPlan.ts:22-28`). Exactly 2 entrants gives **one** fight (`bracket.ts:92-113`) `[built.two_entrant_women_sword_shield]`.
  * Medals come from Finalize: the server's places from wins, so 1st and 2nd.
  * Best of three: none. `rounds_to_win` is "first to N rounds" *inside* one group fight (`scoring.ts:41`), not a series.
  * Faking it with three rows (accepted by `build_schedule replace`) gives the right places for a 2–1 `[format.bo3_finalize_preflight]`. But it records **three career fights per fighter** `[format.bo3_counts_as_three_career_fights = 6 rows]`, and pool wins and base points count per bout.
  * A real series needs a series or bout concept (one sporting match, several bouts) and a medal rule. → **Format Pack.**
* **Long axe round robin.** Men Long Axe (category `polearm`, 6 fighters) gave 15 fights and planned fine `[built.matches_per_competition]`. There is no `long axe` reference category; the name is free text on a `polearm` competition. → Deferred: add a category only if the league wants long axe statistics separate.
* **Byes (Q35 to Q36).**
  * 6 in 8: seeds 1 and 2 go straight into the semifinals.
  * The two real first-round fights are labelled Quarterfinal at positions 1 and 3. No bye row is created (`bracket.ts:68`).
  * The Run preview explains the byes (`runDraw.ts:76-79`). Clean, and it advances correctly `[bracket.sword_shield_semis_after]`.
* **Wild cards (Q37).** None: no wild card, lucky loser or repechage in the code.
* **Placeholder behaviour (Q26 to Q30).**
  * An unknown side is `entry_a/entry_b = null`, linked by `next_match_id/next_slot`.
  * Shown as "To be decided" plus "Waiting for earlier results…" (Run) or "Waiting for the semifinals to finish" (third place). There is no source label like "QF1 winner" or "SF2 loser", although `next_match_id` has the data for winners.
  * Pool-to-bracket fights do not exist until the pools finish (`build_schedule` append), so "Pool A 1st vs Pool B 2nd" cannot be scheduled ahead at all.
  * Auto-population on a result works (Q28 yes). The position is not preserved (Q29 no, §4).
  * For an operator, "Ulric Hartley vs To be decided" with no source is guessable in one bracket and not across a 110-fight line (Q30).
* **Withdrawal in a bracket.**
  * Walkover is automatic and audited.
  * The withdrawn loser is routed into the third-place fight like any semifinal loser `[withdraw.withdrawn_fighter_now_in_third_place_match = 1]`. When the other semifinal ends, the existing walkover cascade will award it.
  * Until then the schedule shows an injured fighter in a future fight. → Format Pack rule: "a withdrawn semifinalist forfeits third place".

---

## 7. Paper and TV findings

**Paper today.**

* No printable running order, bracket sheet or score sheet. One print rule hides the navigation (`app.css:1382-1385`).
* Printing Run would produce about 27,000 px of cards full of buttons.
* The paper fallback that exists is *Enter official result from paper* (head marshal or organizer), which works and is audited (Pack 03, `enter_official_result`).

**What printing needs.** A single ordered source is the prerequisite: fight number, day, block rows, time, placeholder labels and lyst. **That source exists in shape**: `private.queue_ordered` / `compareRunOrder` over `matches` is already the one list that Event day, field pages, notifications and My next fight use. It lacks the fields above, so 24B2 must come after 24A3.

**TV and Arena today (Q51 to Q53).**

* Arena and Broadcast read the same `matches` rows and live-score tables as Event day. There is no duplicated queue (`useArenaData.ts:12`, `arena.ts:76-103` reuses `buildFieldBoards`).
* But they load `MATCH_SELECT` without `queue_order/plan_order/plan_hold` (`matches.ts:37`), so their "Up next" can disagree with Event day once the order is hand-made or planned. Called slots agree.
* At 1920×1080 the arena shows the fight now plus on deck and in the hole. There is no list, no times, no fight numbers and no lunch notice `[view.anon.arena.text]`.
* A future TV running-order board can use the same source once 24A3 exists. It must use the ordered fetch, not `fetchCompetitionMatches`.

---

## 8. Scale findings

Measured in Chromium on the live rehearsal (99 to 109 fights, one lyst) `[scale.before]`, `[scale.live]`. Height is CSS px. Controls are visible buttons, links-as-buttons, inputs, selects and summaries in `main`.

| Screen (who) | 390 phone | 768 tablet | 1024 tablet | 1280 desktop | Controls | DOM nodes | Load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Run (organizer) | 36,406 (43 screens) | 29,496 (29) | 29,474 (38) | 29,505 (33) | 585 to 718 | 2,321 to 2,387 | 0.6 to 1.0 s, 97 API requests |
| Event day (organizer) | 4,793 | 4,402 | 4,197 | 4,145 | 45 to 60 | ~400 | 0.6 to 0.8 s, 44 requests |
| Command Centre (organizer) | 4,309 | 3,454 | 3,253 | 2,725 | 26 to 27 | ~440 | 0.5 to 0.8 s |
| Field page (scorekeeper) | 1,170 | 1,036 | 997 | — | 3 to 4 | ~120 | 0.5 to 0.7 s |
| Scoring screen (scorekeeper) | — | 1,447 | — | — | 9 | 143 | — |
| Event page (fighter f1) | 12,915 (15 screens) | 9,928 | — | — | 5 | 1,266 | 0.7 s |
| Event page (anonymous) | 10,682 | — | 8,404 | 8,417 (stranger) | 4 | ~1,120 | 0.6 s |
| Arena | — | 768 (fits) | — | 1080 at 1920 (fits) | 0 | 58 | 0.5 to 0.7 s |

No screen scrolled sideways, no tap target was under 40 px in `main`, and there were 0 page errors on any screen.

**What is fine at 13 fights and fails at about 110:**

* **Run** grows linearly: every card has a 4-button state segment plus Set time, and the page reaches about 30 screens. It is the only place to see every fight, set times, withdraw or rebuild. Unusable as a tournament-day controller.
* **Event day** stays small because it shows 5 "Up next" with "Show all 87". Fine to operate, but it is not a running order.
* **Fighter event page** grows with every bracket and pool table: 15 phone screens. My next fight is at the top and stays usable.
* The planner, API calls and scoring commands showed no slowdown (build 0.36 s; ~190 ms per scoring command).

---

## 9. Things the current architecture already handles well

Keep these; Pack 24 should extend them, not replace them.

* **Database as the boundary:** every refused action in §5 was refused by the server, with clear messages.
* **Match identity:** UUID and bracket `position` survive moves, calls and holds. Results key on identity. Pack 24A3 can add a fight number *beside* the UUID.
* **One ordered source:** `private.queue_ordered` / `compareRunOrder` already drive Event day, field pages, notifications and My next fight. A running-order foundation should become that source's input, not a parallel list.
* **Scoring:** idempotent, versioned commands. Conflicts are kept for the head marshal; the paper-entry path is audited.
* **Bracket engine:** byes, advancement, third place, walkover cascade, and pool-to-bracket verified against standings, all server-side.
* **Planner:** a fast, deterministic rest planner with no back-to-back fights. Valuable as a *proposal* tool for drafting the running order.
* **Readiness:** it warns but never blocks (the owner's rule), at the scoring screen, Command Centre and Event day.
* **Fights ahead:** exact against the server line. The basis for "Your Day".
* **Audit:** moves, results, rebuilds and withdrawals are logged. The exceptions are the direct table writes in §5c.
* **Test-data isolation:** the synthetic tag shows a TEST DATA banner and is excluded from official views.

---

## 10. Pack recommendations

The working boundaries mostly hold. The evidence changes four things.

1. **Add Pack 24A0, Match integrity guards (small, server only), before everything else.**
   * `build_schedule('replace')` refuses when any fight is active, called, or has live-score / Lyst / score-event rows.
   * Revoke organizer DELETE and the bracket-shape column UPDATEs on `matches`, keeping only `scheduled_at`, `field` and `duration_minutes` until 24A3 replaces them with RPCs.
   * Audit any remaining direct edit.
   * This closes the only path found that silently destroys live sporting data. It is independent of every UI decision.
2. **Do 24A3 (running order foundation) before 24A2.**
   * 24A2's job is to grant the secretary *verbs* (move, hold, call next, retime by delay). Today those verbs are the wrong ones: whole-line rewrites, non-durable holds, per-day blindness.
   * Granting today's `move_match_in_queue` to scorekeepers would hand them the freeze-the-line behaviour.
   * 24A3 must include: day (or session) on fights, a stored fight number, program-block rows (lunch, break, awards), a durable hold, fixed slots for future bracket fights with source labels (including pool placements), original and estimated time, and the planner demoted to a "propose order" tool.
3. **Fold 24A1 (focus layout and tablet safety) into 24A4 (secretary tablet controller).**
   * The tablet evidence shows the existing event-day screens are tablet-safe: no sideways scroll, no small targets, fit within a few screens.
   * The tablet problem is that the secretary *has no screen* and Run is 30 screens long. Both are 24A4's subject.
4. **24B1 must fix "behind schedule" with the new times; 24C2 fixes the public Now-and-next order bug** (`liveView.ts:88`), a one-line change that could ride any earlier pack.

Unchanged: 24B2 paper (after 24A3), 24B3 TV (after 24A3; use the ordered fetch), 24C1 Your Day (fights ahead exists; add lateness after 24A3), 24D navigation and one-lyst cleanup.

Format Pack:

* best of three as a series (one sporting match, several bouts, records counted once);
* the two-entrant medal rule;
* exhibition / fun fight flag (outside standings, brackets, medals, rankings, records and statistics);
* the withdrawn-semifinalist third-place rule;
* placeholder semantics for pool placements.

Deferred:

* wild cards / repechage;
* a long-axe reference category;
* multi-lyst-specific improvements;
* virtualizing the Run list (superseded by 24A4).

**What must be built before the Rumble:** 24A0, 24A3 and 24A2, plus 24A4 (secretary tablet) and 24B2 (paper running order), because paper is the official fallback.

**What can safely wait:**

* 24B3 TV board: the arena already shows now, on deck and in the hole.
* 24C1 and 24C2 beyond the one-line order fix.
* 24D.
* The Format Pack, *if* the Rumble avoids best-of-three and exhibitions in BuhurtOS. Paper can carry those, with the result entered as a normal fight only where it is sporting.

---

## 11. Blocking decisions (Garrett)

1. **Authored running order or live planner?**
   * The paper model is an authored, numbered, timed order that staff deviate from. BuhurtOS today is a planner that re-sorts after every result.
   * Recommendation: the organizer publishes an authored order (the planner proposes it), and the planner never reorders a published fight. Only people move fights.
   * This decides the whole shape of 24A3.
2. **Who is the "secretary" in authority terms?** Choose one:
   * the existing `scorekeeper` gains running-order verbs; or
   * the `head_marshal` gains them and the scorekeeper only scores; or
   * a new event role.
   * Today none of them can move a fight, yet every scorer can call any fight.
3. **Two-entrant categories at the Rumble:**
   * Is best of three the rule?
   * Do two entrants receive gold and silver medals, and ranking points?
   * Needed for the Format Pack. If it cannot be built in time, should the Rumble run best of three on paper, entering one result?
4. **Exhibition fights:** confirm they must never appear in fighter records or placings. Until the Format Pack, should exhibitions stay off BuhurtOS entirely? Today a tier-Exhibition competition leaks into records.

Not owner questions (implementation details for the packs): fight number format, where lunch rows are stored, the delay formula, the print layout and one-lyst wording.

---

## 12. Recommended implementation order

1. **24A0 Match integrity guards.** Server only, small, removes silent data loss. Evidence: §5c and §5d, `[rebuild.*]`.
2. **24A3 Running order foundation.** After decision 1. Covers day, fight number, blocks, durable hold, fixed future slots with labels, times (original / estimated / actual start), and the planner as a proposal.
3. **24A2 Secretary live permissions.** After decision 2. Server verbs on 24A3's model, and narrowing `set_match_queue`.
4. **24A4 Secretary tablet controller,** including the old 24A1 tablet-safety scope. Replaces Run as the operating list.
5. **24B2 Paper running order.** Printed from the same source as 24A3; the official fallback.
6. **24B1 Unified Live operations.** Reliable behind-schedule from 24A3's times; one place for head marshal and organizer.
7. **24C1 Fighter Your Day.** Add "about N minutes late" to the existing exact fights-ahead.
8. **24B3 TV board** (ordered fetch), **24C2 Public event** (with the Now-and-next order fix, which can ship earlier), **24D Navigation and one-lyst cleanup.**
9. **Format Pack** in parallel with 24A4 onward, if decision 3 says best of three is required at the Rumble.

---

## Appendix: answers to the numbered questions

| Q | Answer (evidence) |
| --- | --- |
| 1 | No stable human number (no column; transient `{i+1}`) |
| 2 | N/A, there is no number; the UUID and `position` stay the same `[identity.*]` |
| 3 | Not stored; only an on-screen index derived from order |
| 4 | Rebuild = new UUIDs and positions (delete and re-insert, pack02:422) |
| 5 | Walkover rows keep their identity; nothing renumbers `[withdraw.after]` |
| 6 | Yes, through `move_match_in_queue` (organizer) |
| 7 | Yes (there is no human number to depend on) |
| 8 | Yes. Server and UI only block once a fight is *final*; an ACTIVE fight was destroyed `[rebuild.replace_while_a_fight_is_ACTIVE]` |
| 9 | No: refused with "Some matches are already final" (server and UI) |
| 10 | Server: non-organizer, any final fight, malformed plans, append before pools finish or with ties |
| 11 | UI: nothing beyond the server's final guard (`RunTab.tsx:72`) |
| 12 | Yes: live fights and score events are deleted; table-API DELETE/PATCH leave brackets broken without audit |
| 13 | Yes per field (server line); not authored; mixes days |
| 14 | No numbers exist |
| 15 | Yes: identity is kept; but the first move freezes the whole line |
| 16 | Only until the next re-plan (hold erased on opening Event day) |
| 17 | No: scorekeeper and head marshal get 403 on move, plan and hold; they can only call fights via `set_match_queue` |
| 18 | Reorder, plan, hold: organizer (incl. owner and org admin). Live state (`set_match_queue`, `advance_field_queue`, finish): organizer, head marshal, marshal, scorekeeper |
| 19 to 21 | No; no block rows. Closest: `events.time_note` free text and an announcement |
| 22 to 25 | Only as a tier-Exhibition competition; participants and winner are recorded but leak into records and placings; no guarantee → gap |
| 26 | `entry_a/entry_b = null` plus the `next_match_id` link; pool brackets not created until pools finish |
| 27 | No: only "To be decided" |
| 28 | Yes |
| 29 | No (end of line after hand moves; planner-chosen otherwise) |
| 30 | Partly; not across a 110-fight line |
| 31 to 32 | One round-robin fight |
| 33 | No best of three (only "first to N rounds" inside a team fight) |
| 34 | Finalize: server places by wins, so 1st and 2nd |
| 35 to 36 | Clean: seeds 1 and 2 pre-placed in the semis, two quarterfinal rows, no bye rows |
| 37 | No wild cards |
| 38 | `scheduled_at`, `duration_minutes`, `finalized_at` (+ `created_at`) |
| 39 | Only scheduled and finish; start only via the audit log |
| 40 | `commandCentre.ts:73-94`: current or next fight vs now, ≥15 min |
| 41 | Yes: `myFight.ts:69-77` and the in-the-hole alert's `ahead` |
| 42 | Yes, small, once 24A3 makes times authoritative |
| 43 to 46 | One board, picker hidden, but "Field 1" everywhere; ~12 places listed in §4 |
| 47 to 50 | No print view; print CSS only hides navigation; the order source exists but lacks number, day and blocks |
| 51 to 53 | Same `matches` and live tables; no duplication; arena omits `queue_order/plan_order`, so its order can differ |
| 54 to 55 | §8 |
