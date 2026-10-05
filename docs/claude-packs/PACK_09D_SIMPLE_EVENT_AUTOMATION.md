# Pack 09D: Simple event mode, automatic tournament planning, smart scheduling, event / fighter / roster lifecycle

Branch `ccr-b436c25f-hua0xj` (from `main` `74bf9ce`, Pack 09C released). Migration `20261005000100_pack09d_simple_event_automation.sql` is the only
new migration; nothing before it was touched or re-applied.

The rule for this pack: **BuhurtOS should need fewer decisions than paper.** Default what can be defaulted, derive what can be derived, ask only what
changes the tournament, keep every advanced control one tap away but never in the way.

## What was there before (investigated first)

* Creating an event asked for name, address, dates and venue, then dropped the organizer into Setup with a nine-tab bar (Event day, Review, Fighters,
  Check-in, Run, Results, Setup, Competitions, People, Teams), all equal. Competitions were added one at a time (category, division, name, ruleset,
  structure, tier, rounds). Draws were built per competition in Run (format, seeding, draw number, third place), times and fields set by hand or in bulk.
* Event day (Pack 09A) ran each field's line in schedule order (manual order, scheduled time, competition order, stage, round, pool, position). The
  database (`private.queue_ordered`, `settle_field_queue`, the advancement trigger) is the authority for the queue. Winner / loser advancement is inside
  `finalize_match` (Pack 02); byes are handled in the browser plan (`buildSingleElimination`). A competition became *Ready to finalize* when every fight
  was final and official only through Pack 09C's `finalize_competition`.
* Official aggregates read `results` through `result_rows` / `match_sides` / `played_events` (Pack 01 keeps synthetic events out), the organization
  ranking scopes read `*_results_all` with their own synthetic predicate, and the team discipline totals had a third copy. There was no event lifecycle
  beyond `status` (draft / published / cancelled) and `closed_at` (Pack 09C), no fighter lifecycle, no roster visibility, and no event delete at all.

## UX philosophy (the three questions)

Every organizer screen answers *what is happening now*, *what needs my attention* and *what should I do next*, in sporting words. One recommended
action per state; everything else visually secondary; nothing dangerous next to the event-day controls; every automatic thing reviewable and
overridable; mistakes recoverable through the existing audited paths.

## Quick Setup (`/events/new`)

Two steps. **Step 1:** event name (the web address is derived; *Change* if wanted), first and last day, where (optional until registration opens), number of
fields (a stepper), organization and season (optional, only shown when some exist), *Start from* (a standard tournament, or *Same setup as <one of my past
events>*), and **What are we fighting?**: every row of `public.ref_categories`, the normal set already ticked (large melees 12v12 / 30v30 and Greatsword
off, one tap away), Men / Women per category (Open for Triathlon and Marathon), Select all / Clear all. **Step 2:** one-screen check: dates, place, fields,
each category with its divisions, team vs individual, the ruleset; *Create event*. *Create it and open Advanced setup* goes to the competition editor instead.

Defaults and their sources (`src/lib/quickSetup.ts`, tested): categories and names from `ref_categories`; entry kind from the category's league (the
database enforces it); ruleset named from the reference row's cited document (`Buhurt International: Duels rules V.26.4`), **none invented for HACSA
categories** (no rules text is loaded); structure `round_robin` until Build tournament proposes the real one; tier the database default (Classic).
*Create event like…* copies category, division, name, ruleset, structure, rounds to win, tier and the number of fields; never people, fights or results.

Creation goes through the existing `create_event` and `create_competition` functions, one call each; anything that fails after the event exists is
reported on the first Event home screen (never dropped). A new event lands on **Event home** with *Your event is created* and its one next step.

## Event home and the journey (`Manage › Event home`, the default outside event days)

`src/lib/eventJourney.ts` (tested) works out the stage from facts the database already has: **Set up → Registration → Build tournament → Run event →
Results → Close → History**, with one recommended action each: *Choose competitions* / *Add the waiver* / *Open registration* / *Review N registrations*
/ *Build tournament* / *Open Event day* (+ *Check in N fighters* on the day) / *Review wins & losses* / *Close event* / *View results* (+ *Archive event*).
Cards: registrations, check-in (ready / accepted), competitions (official / built, or offered), fights done. *All event tools* (collapsed) lists the rest.

The Manage bar shows four areas (Event home, Registrations, Event day, Results) plus **More options** (Build tournament, Check-in, Fighters, Run,
Competitions = advanced setup, Event settings, People, Teams). Every old `?tab=` address still opens the same screen. Manage opens on Event day while
the event is running (as before), else on Event home.

## Build tournament (`Manage › Build tournament`)

`src/lib/buildPlan.ts` (tested): from the entrants already in each competition. **Activation:** a competition is built only with 2 or more entrants still in
(withdrawn / disqualified excluded); 0 or 1 stays *offered, not run* and is listed as *Not built* (never an empty bracket). **Format:** the existing advice
(`structureAdvice`, Tournament Structure and Formats) and the Run tab's own default: 2 to 6 = round robin, 7+ = pools (advised count), the bracket built from
pool results as before; the organizer can change any competition to round robin / pools / single elimination (third-place fight on by default from 4).
**Draw:** the existing reproducible random draw with a saved draw number (*Draw again*); manual seeding stays in Run. **Fields:** whole competitions go to
fields, biggest first, chosen with the planner itself (least rest penalty, then evenness; no field may carry more than the balanced spread's busiest field;
never worse than the plain balanced spread). **Preview:** fighters, competitions, fights, fields, the rest target and how many planned fights meet it, how
many have shorter rest and why, bracket fights to come, fighters who are not here today (held, never silently planned); *Review plan* shows each field's
order. **Use this plan:** each draw through `build_schedule` (server side, atomic per competition, draw recorded), field written for non-default fields, the
fight order saved through `save_queue_plan`. Nothing is called or started by building. Then → Event day.

## The scheduler (`src/lib/planner.ts`, 27 tests; `src/lib/eventPlan.ts`, 6 tests)

Deterministic; same input, same plan. Lanes = fields; a slot is one fight's worth of time on every field; a fight's place in time is
`slot * fields + fieldIndex`. Finished fights are history in finish order. **Rest is event-wide**: fights (any field, any competition) that start strictly
between two appearances of the same person; a team side is its roster (`entry_roster`), so a person's rest follows them from a duel into a 5v5.

* **Candidates:** waiting (`scheduled`) fights with both sides known and neither withdrawn (Pack 09A's `match_runnable`). A bracket fight waiting on an earlier
  result is *waiting*, never planned. A fight with someone registered as not attending today (accepted registration with `attend_dates` that exclude today)
  is *held*: reported, saved as `plan_hold`, never called automatically; an organizer can still call it by hand.
* **Hard rules:** never double-book a person across fields in the same slot; never schedule a fight before both entrants are known; a fight runs on its own field.
* **Locked:** NOW, ON DECK, IN THE HOLE keep their places (the queue already called them). Newly ready fights join the future pool.
* **Preferences, in order:** (a) the organizer's hand-made order on the field (Pack 09A *run sooner / later*), then fights with a published time in time order;
  (b) the most rest, counted up to the target of 3 (3+ > 2 > 1 > back-to-back; never-yet-fought = fully rested; rest beyond 3 is not "better");
  (c) people with more fights still to come go first (spreads a round robin); (d) the normal running order. Greedy fill of the earliest open slot, then a bounded
  local swap pass on each lane (a swap is kept only when the rest penalty strictly drops; never moves locked or hand-placed fights; never double-books).
* **Equipment:** registration only records *shares equipment: yes/no*, not with whom, so it is a warning on the fight, never a rule.
* **Replanning:** Event day recomputes the plan on every live change (result, withdrawal, bracket entrant known, field change, skip) and saves it through
  `save_queue_plan` when it differs (debounced; organizers only; nothing happens without the migration or the right). The database order is then: manual
  order, plan order, schedule, bracket order (`private.queue_ordered`); `promote_one` skips held fights. **Stability:** the plan never touches a called fight.
* **Performance:** 300 fights on 4 fields plan in milliseconds; the worst case tested (80 fights, people in two pools) in ~2 ms.
* **Explainability:** each planned fight carries every person's rest and plain reasons: *First fight today for everyone*, *3+ fights of rest*, *Short rest: 2
  fights between appearances*, *Back-to-back: no other ready fight gives more rest*, *Only ready fight on this field*, *Placed by hand*, *Follows the published
  fight times*, *Someone in this fight shares equipment*.

## Event day (what changed)

Per field, **Next recommended** when nothing is fighting: the pairing, each person's rest in words, *Ready to fight* / *Not checked in: …*, the headline reason,
**Run this fight** (or **Run anyway** under a red **Short rest** warning that names the fighter and says no better ready matchup exists), **Choose another
fight** (a drawer listing the other ready fights with their rest). While a fight is on, the planner is one line after the called slots (*Next up* or *Why this
order*, expandable). Held fights are explained at the top. Competitions with no draw are one *Not built: …* line with a link to Build tournament. A competition
whose fights are all done shows **Review wins & losses**. Manual override: everything from Pack 09A stays (run sooner / later / skip, change field or time,
back to the line); a field arranged by hand says so and offers *Let BuhurtOS plan it again* (`clear_manual_queue`).

## Bracket automation

Unchanged authority: `finalize_match` advances winners (and semifinal losers into the third-place fight); byes come from the draw plan. What Pack 09D adds is
that the newly known fight enters the plan by itself and the competition is recognized as complete by itself (every fight final → *Ready* in the existing
preflight → Review wins & losses). Proven end to end in `pack09d_gate.sql` (byes, advancement, readiness, stale result refused and no corruption, no duplicate
advancement, review state, confirm, idempotent confirm).

## Review wins & losses (`src/components/ReviewSheet.tsx`, `src/lib/winLoss.ts` 7 tests)

A bottom drawer from Event day or Event home. For every competitor: wins, losses, ties, the server's calculated place and the points that would be
recorded (from `competition_finalize_preflight`, the same computation finalize writes; no new formula), expandable to every fight (*Won vs John 5–1*,
*Lost vs Chris (walkover)*, round). *Compare* two competitors side by side with head to head. A shared place is marked; a medal tie goes to the existing
`TieDecision` (with a note) right in the sheet; other blockers link to the Results tab. **Confirm results** → a confirmation naming the champion →
`finalize_competition` (Pack 09C). No parallel publication path.

## Event lifecycle (one column per idea)

| State | Column | Who | Effect |
| --- | --- | --- | --- |
| Closed | `events.closed_at` (Pack 09C) | organizers | finished, history, counts normally, operations locked |
| Archived | `events.archived_at` | organizers of the event | hidden from current/upcoming browsing (*Show archived events* toggle, `?archived=1`; still on My events; reachable by link; the page says so). **Zero** change to statistics. Reversible. |
| Excluded from official statistics | `events.stats_excluded_at` + reason | platform owner or the event's organization admin, reason required | the event, fights, results and audit stay; its results feed no official aggregate. Reversible (reason required). Both audited. |
| Deletable | none (computed: `private.event_delete_blockers`) | organizers of the event, typed confirmation | only a draft (or fictional) event with no sporting history (no published real event, not closed, no results, no result history, no fought fights, no official competition). Server-side refusal otherwise; `private.discard_event` removes it bottom-up and audits. |

Functions: `archive_event`, `unarchive_event`, `exclude_event_from_stats`, `restore_event_stats`, `event_delete_check`, `delete_event`. A trigger
(`events_lifecycle_guard`) stops direct writes to the lifecycle columns; the sanctioned functions use the Pack 09C `bos.unlock` flag. UI: Event settings ›
**Archive and statistics** (states, each action explained before its confirmation; delete only when possible).

## Statistical eligibility: one rule

`private.stats_excluded(event)` is read by `result_rows` (→ `fighter_results`, `team_results`, career / season / team statistics, the global ranking scope),
`match_sides` (→ match counts, form), `played_events` (→ events attended), the organization scopes of `ranking_fighters` / `ranking_teams` and
`team_discipline_contributions` (through a new `stats_excluded` column on `result_rows_all` / `*_results_all` / `fighter_history`, so history lists still
show the result, marked *Not counted in statistics*). Synthetic isolation (`private.is_synthetic`) is untouched and separate. Ranking formulas unchanged.
Regression proof in the gate: archive → byte-identical aggregate snapshot; exclude → the contribution gone; restore → exactly the baseline; repeated twice.

## Fighter lifecycle and team roster visibility

* `fighters.inactive_at` (+ note), `set_fighter_active(fighter, active, reason)`: the fighter's own account, a captain or administrator of a team they are
  currently on, or the platform owner (`private.can_manage_fighter`; event organizers get nothing). Inactive fighters keep every result, medal, point and
  represented-team entry (statistics snapshot identical); they leave entrant search (`search_fighters_for_entry` finds them only by their exact name), the
  roster pickers, the fighter directory (default) and the current public roster. Reactivation is the same row. UI: fighter page, *Set as inactive… / Make
  active again*, shown only to those the database allows.
* `team_memberships.hidden_from_roster`, `set_roster_visibility(team, fighter, visible)` and `team_roster_manage(team)` (team managers:
  `private.can_manage_team`). `team_roster` (public) now leaves out hidden and inactive members. Presentation only: `entries.represented_team_id`, results,
  Team Discipline totals and rankings never read it (proven). A home-team fighter with no membership row gets one to carry the flag. Former members
  (`to_date` in the past) are not current and keep their history. UI: team page › *Manage the public roster* (team managers only).

## Permissions summary (database-enforced; the UI only hides)

| Action | Who |
| --- | --- |
| Quick Setup, Build tournament, save / clear the plan, archive / unarchive, delete a disposable draft | the event's organizers (`is_organizer`: organizer, org admin, owner) |
| Exclude from / restore to official statistics | platform owner or the event's organization administrator (`can_govern_event_stats`) |
| Run / choose a fight (queue) | anyone who can score (as Pack 09A) |
| Fighter active / inactive | the fighter, their current team's captain / administrator, the owner |
| Roster show / hide | the team's captain or administrator (`can_manage_team`) |

Every new command is SECURITY DEFINER with an explicit check and empty search_path, executable by `authenticated` only; private helpers are not executable
by clients; `plan_order`, `plan_hold`, `inactive_at`, `archived_at`, `stats_excluded_*` have no client column grant. Allowed and denied cases are tested
directly (gate: 149 checks; browser run: direct refusals through PostgREST).

## Migration (`20261005000100_pack09d_simple_event_automation.sql`, additive, re-runnable)

Columns: `events.archived_at`, `stats_excluded_at`, `stats_excluded_reason`, `field_count` (grant to authenticated, 1 to 12); `fighters.inactive_at`,
`inactive_reason`; `team_memberships.hidden_from_roster`; `matches.plan_order`, `plan_hold`. Views replaced in place (same columns, `+stats_excluded` on
the `_all` views and `fighter_history`). Functions above plus `private.stats_excluded`, `can_govern_event_stats`, `event_delete_blockers`, `discard_event`,
`can_manage_fighter`, `events_lifecycle_guard`; `queue_ordered` and `promote_one` replaced (plan order, held fights); `search_fighters_for_entry` and
`team_roster` replaced (inactive / hidden). Fingerprint regenerated (1268 objects).

## Tests and evidence (local, 2026-10-05)

* Database: `pack09d_gate.sql` **149 checks** (archive / exclude / restore snapshots, closed counts, delete refused and allowed, fighter and roster lifecycle,
  the plan and the queue, bracket automation end to end, privileges). Full `supabase/tests/run_all.sh` from zero: every gate, vectors, fingerprint, simulation,
  league verifier, three concurrency runs: **DATABASE GATE PASSED**.
* Unit: planner 27, eventPlan 6, quickSetup 7, eventJourney 10, buildPlan 9, winLoss 7, eventFilters +3, matches +1; whole suite **796 tests / 74 files**;
  typecheck and production build clean.
* Real stack (`scripts/e2e/pack09d-live.sh`, Postgres from every migration + `fixtures/pack09d.sql`, PostgREST, the built app, Chromium): **123 checks**:
  Quick Setup on a phone without Advanced (defaults, two categories off, review, create, Event home, waiver step, Open registration); Build tournament
  (activation, format advice, held fighter, a change, review, use → draws through `build_schedule`, fields, saved plan, nothing started); Event day
  (recommended fight per field with reasons, held fights, run it, queue stable when the scorekeeper finishes it, Sabre quarterfinals → semifinal known and
  planned by itself, the other semifinal waits, choose another fight, nobody double-booked); short rest said out loud, run anyway, Review wins & losses
  (records, expand, compare, confirm names the champion, Pack 09C official, public podium); archive (stats identical, hidden from browsing, toggle, page
  reachable), exclude (organizer refused, stats gone, stored, marked), restore (baseline exact), delete not offered, audit trail; roster hide / show (history
  intact), fighter inactive / reactivate (directory, picker, roster, history); direct permission refusals; phone 390 / tablet 768 / desktop 1280 layout
  (no sideways scrolling, no small tap targets). Screenshots reviewed.
* Regression: field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, sample-mode 34, rankings-teams 22 (mock stack); eventday-live 78, arena-live
  103, finalize-live 126, represented-team-live 108 (real stack). Three suites were updated to the new controls (*Run this fight*, *Review wins & losses*,
  Quick Setup's two steps) proving the same things.

## Paper test (skeptical pass after building)

Can a first-time organizer tell what to press? Yes: every screen has one dark button and says what comes next. Recover from the wrong thing? Draft back
from published in Event settings; a called fight back to the line; results reopened with a reason; archive reversible; exclusion reversible. Run without
Advanced? Yes (the browser journey never opens it). Who fights next? The card. Who needs rest? Each person's rest is written on it. Who won? The sheet.
Close the event? Event home says so when everything is official. Simplified during the pass: the primary action no longer overflows a phone; the next-up
line stays out of the way while a fight is on; *More options* stays on the tab row; the home screen's collapsed list is *All event tools*.

## Known limitations, intentionally deferred

* Shared equipment is yes/no in registration (no partner), so it stays a warning; a future registration field could make it a hard rule.
* Availability is by day (`attend_dates`); hours in `availability_notes` are free text and not read.
* Build tournament builds pools; the bracket after the pools is built from the standings in Run as before (and planned as soon as it exists).
* Event templates beyond *Create event like…* (a named organization template) are not built: the reference data already supplies the standard set.
* The planner is a deterministic heuristic (greedy + bounded local swaps), not a global optimizer, by design.
* Archive hides from the general lists and the calendar's normal view; the public home page's event lists use the same filter rules.
* Realtime push is not exercised by the local stack (no socket); polling fallbacks carried the two-browser checks, as in Packs 09A to 09C.

## Hosted release

See STATUS.md (filled in at release).
