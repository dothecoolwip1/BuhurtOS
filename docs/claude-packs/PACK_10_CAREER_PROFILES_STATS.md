# Pack 10: Fighter and team career profiles, statistics, records and history

Branch `ccr-1c6a5a85-57ov54` (from `main` `c5b5443`, Pack 09D released). Migration `20261005000200_pack10_career_profiles.sql` is the only new
migration; nothing before it was touched or re-applied.

The rule for this pack: **a profile is the sporting record, read out loud.** Every number on a fighter or team page is the sum of official fight
results and official placings that already exist. Nothing is inferred from a placing, nothing is guessed about teams or dates, and no fictional or
excluded row ever reaches an official total.

## What was there before (investigated first)

* The fighter page showed career tiles from `fighter_career_stats`, a flat list of every ranking row, "This season", a "By category" list built in the
  browser from `fighter_match_stats` and `fighter_results_all`, a tournament history, ten recent fights (four follow-up requests to name the opponents),
  season by season, upcoming entries and team memberships. The team page showed a roster, team record tiles from `team_stats`, 5v5 / 3v3 records from
  every `match_sides` row of the team, the ranking rows and a tournament history.
* What was missing: the team a result was earned FOR (the represented team, built for the Team Discipline rankings) on the fighter's own history; team
  fights kept apart from duels; head to head; season or organization filtering; a team's history of who represented it; the roster that actually
  fought a team fight; any distinction on the team page between the team competing and its duelists competing for it.
* Eligibility already had one rule, `private.stats_excluded(event)` (Pack 09D), and one synthetic rule, `private.is_synthetic` (Pack 01), both applied in
  `match_sides` / `result_rows` / `played_events`. Pack 10 reads those same functions; it adds no second rule.

## Statistics: what every number means

| Number | Definition (official context) |
| --- | --- |
| Events competed | distinct events where the fighter / team has at least one official fight or official placing (an upcoming entry is not an event competed; an event with an entry but nothing fought or placed is not either) |
| Competitions | distinct competitions with an official placing (`results.final_place`, written by `finalize_competition`) |
| Fights, Wins, Losses, Draws | final fights with both sides known, as `match_sides` reads them: `matches.result` = `draw` → draw; `winner_entry_id` = my entry → win; else loss. A team fight counts for every fighter on the roster recorded for that entry (`entry_fighters`); a fighter not on that roster gets nothing from it |
| Win rate | wins / fights × 100, one decimal; draws are fights. Null (shown "No matches yet") with no fights |
| Gold / Silver / Bronze / Podiums | placings 1 / 2 / 3 (a shared place counts for each holder); podiums = their sum |
| Ranking points | the sum of `results.points` of those placings: the existing authoritative value (tier multiplier and placement maths unchanged; a roster member of a team entry gets the team's points, as `fighter_career_stats` and the `career` ranking scope already did) |
| Best place | the best placing in the partition |

**Win / loss / draw semantics.** A win, loss or draw exists only as an official fight result. A **walkover** (`matches.detail.walkover = true`) is a win
for the side awarded it and a loss for the other, and is labelled "by walkover" wherever the fight is shown. A **draw** is `result = 'draw'` (round robins
and pools). A **disqualified** entrant (`entries.status = 'disqualified'`) keeps every fight they fought (their wins stay wins, as the fights happened)
and is placed last with 0 points by the existing placement engine; the placing is labelled "Disqualified". A **withdrawn** entrant's unplayed fights are
not fights (no final match), so they count nowhere; the walkovers the organizer recorded for the opponents do. There is no "no contest" state: a
fight that is not final is not in any number. **Nothing is inferred from a placing**: a gold with no recorded fights is a gold and zero fights.

**Official vs test context.** Every row carries `synthetic` (fictional event, Pack 01) and `stats_excluded` (Pack 09D). Official = neither. An
**archived** event is official like any other (archive is presentation only). A fictional fighter's or team's page shows its own fictional rows as the
"test" context, labelled *Test data* and stated to count nowhere; a real fighter's page shows a fictional event in the history list, labelled, and in no
total. An **excluded** event shows in history lists marked *Not counted in statistics* and in no total of either context.

## Fighter career model

* **Hero**: name, photo, *Active* / *Inactive* (Pack 09D `fighters.inactive_at`, public column), *Test data*, *Unclaimed profile*; "Fights for <team>"
  (the home team today, from `fighter_profile`; "Last team" when inactive; "No team"); the three most fought disciplines (from the record, else the
  profile's own list); place; the career in one line (fights, W · L · D, medals, points); up to three ranking highlights (best rank first, a running
  season before an organization's career, past seasons left out; `View all rankings`).
* **Filter**: Career, each season with a record (newest first), each organization when there is more than one. Applies to the summary, discipline
  lines, team fight lines, recent fights and event history. Rankings and head to head are not filtered.
* **Career summary** tiles (the table above). **Highlights** (career filter only, deterministic): most recent gold, best current ranking, most fought
  discipline, current win streak (3+ and only when the order is certain, see below), most recent event.
* **Disciplines**: one line per individual category and division from `fighter_career` (`kind = 'individual'`), most fought first: fights, W · L · D,
  medals, points. Category names come from `ref_categories` (a new category appears by itself). **Team fights**: the same for group fights the fighter
  was on the roster for (`kind = 'team'`), kept apart.
* **Recent fights**: form strip (W / L / D, newest first, with screen-reader words) and the last five (expand to the last fifty): outcome, opponent
  (tap for head to head; a team opponent links to the team), "Won 5 to 2" / "Lost by walkover" / "Drew 3 to 3", event, discipline, "for <team>" on team
  fights, date. Official fights only.
* **Head to head**: opponents most met first (direct meetings: both were the individual entry of the same final fight; a team fight is a meeting of two
  teams, never of two fighters; placings are never meetings). Choosing one (`?vs=<fighter id>`, from the list or by tapping an opponent in any fight
  row) shows meetings, "Bob 1 · John 1 · Draws 1", the split per discipline and every meeting, with `Open <opponent>`. Symmetric by construction.
* **Event history**: newest first; each event with its placings (medal / place, competition linked to the event's official result, points,
  *Disqualified* where so), the fights fought there (W · L · D) and **the team represented there** (from the record of that day; see attribution below),
  labelled *Test data* / *Not counted in statistics* where so. Archived events stay.
* **Teams represented**: the current team (from the profile) and every team a result or fight was earned for, each with the years the evidence spans and
  the events that prove it. No joined / left dates are invented ("Iron Ferns · 2025 · Autumn Clash 2025"). **Team memberships** (the recorded
  `team_memberships` rows with their own dates, and guest appearances) stay as a separate block, as before.
* **All rankings** (collapsed), About, gallery, Upcoming, claim panel: as before.

## Team career model

* **Hero**: crest, name, *Test data* / pending, organization (member affiliation), place, "N active fighters on the roster" (the public roster under the
  Pack 09D rules), founded (as stated); the team fight record in one line; the two best discipline totals ("#1 Longsword · #1 Sword & Shield"); up to
  three ranking highlights (team fight rankings) and `View all rankings`.
* **Current roster**: `team_roster(team)` (Pack 09D): hidden and inactive fighters are not current members. The block says so.
* **Filter**: as for fighters, with seasons that have discipline totals but no team fight added (a duel-only team still gets its seasons).
* **Team fight record**: `team_career` (team entries only: 5v5, 3v3, …): events, competitions, team fights, record, win rate, medals, podiums, points;
  per-category lines; form strip. **Its fighters' duels are never in these numbers.**
* **Discipline totals**: the team's rows of `ranking_team_disciplines` (the existing Team Discipline ranking: individual points of the fighters who
  represented it, per discipline), rank and points per discipline for the filter's scope, `Show fighters` = `team_discipline_contributions` for the
  same scope with the total (equals the discipline total; proven). Visually and conceptually apart from the team fight record, with a link to
  Rankings › Teams › Discipline totals.
* **Fighters represented in results**: `team_fighters_represented(team)`: everyone who earned an individual placing for the team or fought on the
  roster of one of its team fights, with what the evidence is ("3 individual results · 3 team fights · last 2026"), *On the roster* when on the public
  roster today, *Inactive* when inactive. Worded as evidence of representation, never as a membership list.
* **Event history**: per event, *Team competed* lines (the group fights the team entered: competition, W · L · D, placing, points) kept apart from one
  *Represented* line (how many of its fighters fought individual competitions for it, their medals, their names). A duelist representing the team never
  makes the team "compete" in a 5v5. A real team's history never shows a fictional event's rows (a fictional team's shows only those).
* **Team fight history**: newest first: outcome, opponent team (linked), score, event, category, round, the placing it finished with, and
  **Roster that day** = `entry_roster` of that entry (the recorded roster of that competition, never today's roster).
* **Head to head**: `team_head_to_head(team)`: opponent teams most met first, meetings, W · L · D, split per category; `?vs=<team id>`. Built from team
  fights only, never from discipline totals.

## Historical attribution (the team represented)

The team a result or fight was earned for is, for a team entry, `entries.team_id` with `team_name_at_event` (the name used at the event); for an
individual entry, `entries.represented_team_id` with `represented_team_name_at_event` (set at entry time from evidence of that time, or corrected
through the audited `set_represented_team`). It is never the fighter's team today: moving Bob to another team changes no result, no fight and no
discipline total (proven in the gate). Where nothing was recorded the page says "No team recorded"; BuhurtOS does not guess.

## Database objects (migration `20261005000200_pack10_career_profiles.sql`, additive, re-runnable)

All views are `security_invoker`; all functions are plain (NOT security definer) `stable sql` with `search_path = ''`, so row level security on
matches, entries, results, events and teams decides what a viewer sees (public events for the public; a draft event's fight is visible to its organizer
and to nobody else; proven). Grants: select on the views and execute on the functions to `anon` and `authenticated`.

| Object | What |
| --- | --- |
| `career_fights_all` / `career_fights` | one row per fighter and final fight: competition, category (+ name), event, season, organization, entry kind (individual / team), roster role, the team fought for (name as it was), the opponent (entry, fighter, team, name), outcome, score, walkover, finalized_at, `synthetic`, `stats_excluded`. `career_fights` = official rows only |
| `team_fights_all` / `team_fights` | one row per team and final fight of a team entry, with the opponent team, the score, the placing and points of that entry |
| `career_results_all` / `career_results` | `fighter_results_all` plus the team the placing was earned for, the category name, the entry's status |
| `fighter_career(fighter)` | the totals and per-discipline lines for every filter in one call: `context`, `scope` (career / season / organization) + id, `kind`, `category`, `gender`, events, competitions, matches, wins, losses, draws, win_pct, medals, podiums, points, best_place, first_on, last_on (grouping sets; no row for a missing season or organization) |
| `team_career(team)` | the same for a team's own fights and placings |
| `fighter_head_to_head(fighter)` | direct meetings per opponent fighter, all categories and per category |
| `team_head_to_head(team)` | the same for team fights |
| `team_fighters_represented(team)` | who earned a result or fought a team fight for the team, with counts, dates and `active` |

No account id, email, phone, emergency, medical, waiver or note column is read anywhere (checked by the gate against `information_schema`).
Fingerprint regenerated (1284 objects).

## Pages and queries

A fighter page makes one request per block, all in parallel, none depending on another: profile, inactive state, claim state, `fighter_career`,
`career_fights_all` (one request, opponents and events included: the four follow-ups of the old recent-fights read are gone), `career_results_all`,
`fighter_head_to_head`, `ranking_fighters`, memberships, appearances, organizations, seasons. A team page: team, roster, entries, `team_career`,
`team_fights_all`, represented results, `team_fighters_represented`, `team_head_to_head`, `ranking_teams`, `ranking_team_disciplines`, organizations,
seasons, fighter basics; `Show fighters` and `Roster that day` load on request. Summaries are computed by the database; the browser only groups rows
for display (event history, teams represented, highlights). Files: `src/data/careerProfile.ts`, `src/lib/careerProfile.ts` (pure, 17 tests),
`src/components/CareerBlocks.tsx`, `src/pages/FighterPage.tsx`, `src/pages/TeamPage.tsx`; the fighter directory's discipline filter now reads
`ref_categories`.

## Win streaks

Counted backwards from the newest official fight over fights ordered by event end date, then `finalized_at`, then id. A draw or loss ends it. When two
fights of the same event cannot be ordered (either lacks `finalized_at`) the streak is reported as unreliable and not shown. Shown only from three.

## Inactive, hidden, unclaimed, fictional

* Inactive (Pack 09D): the hero says *Inactive* and "Last team"; every total, fight, placing, ranking and team represented stays (gate: identical
  snapshot before and after `set_fighter_active`); the fighter directory leaves them out by default, as before.
* Hidden from the public roster (Pack 09D): not on the current roster; still in *Fighters represented in results* and in every historical roster.
* Unclaimed (no `fighter_accounts` row): a complete public career and the existing *Is this you?* claim panel. Auth ownership is never needed.
* Fictional: labelled on the hero; the test context as above; never in an official ranking, total or a real team's history.

## Tests and evidence (local, 2026-10-05)

* Database: `pack10_gate.sql` **104 checks**, mostly as the `anon` role, on `scripts/e2e/fixtures/pack10.sql` (an active fighter with a transfer,
  three disciplines, team fights on two rosters, a walkover, a draw; an inactive fighter; a hidden roster member; an unclaimed fighter; a disqualified
  entrant; a fictional event / team / fighter; an archived event; an excluded event; an upcoming event; a draft event): every career number by hand,
  discipline lines add up, season and organization partitions, archive → identical, exclude → gone exactly once, restore → baseline, fictional isolation
  both ways, transfer rewrites nothing, head to head direct meetings only and symmetric, team record team fights only, team head to head, fighters
  represented with hidden and inactive, roster rules, contributors = discipline total, draft invisible to the public and to a stranger, no private
  column, grants and security settings. Full `supabase/tests/run_all.sh` from zero: **DATABASE GATE PASSED** (every gate incl. 09D and 10, vectors,
  fingerprint, simulation, league verifier, three concurrency runs).
* Unit: careerProfile 17 (filters, wording, chronology, streaks, ranking highlights, event history, teams represented, highlights, head to head, team
  event history, discipline totals, represented list); whole suite **814 tests / 75 files**; typecheck and production build clean.
* Real stack (`scripts/e2e/pack10-live.sh`: Postgres from every migration + the fixture, PostgREST, the built app, Chromium): **135 checks** at
  390 / 768 / 1280 px: Bob's profile (hero, one-line career, ranking highlights, summary = `fighter_career` as anon, discipline and team fight lines, form
  strip, newest fight, walkover and draw wording, team fight "for Iron Ferns", head to head list, event history order and marks, Autumn Clash represented
  Iron Ferns while his team today is Kestrel Guard, teams represented without invented dates, highlights, no streak claimed, no private data on the page
  or in any API answer behind it); season filter (2025, 2026 with the excluded event listed but not counted); head to head from the list and from a fight
  row, by discipline, equals the database, to the opponent's profile; disqualified placing; inactive, unclaimed (claim panel), fictional, brand-new and
  long-name fighters; Kestrel Guard (hero, roster under the hide / inactive rules = `team_roster`, fighters represented with Hal and Mike, team fight
  record = `team_career` = `team_stats`, by category, form, discipline totals with Show fighters = contributions = total, event history with *Team
  competed* and *Represented* apart, fight history with the roster of the day, head to head and its split, season filter); cross-profile navigation
  (fighter → historical team → event → fighter → competition result; team → fighter; team → rankings; team → discipline leaderboard; directories →
  profiles, inactive left out of the directory, data-driven discipline filter); the fighter's and the captain's own controls still there; empty team,
  fictional team, Iron Ferns' represented list; no sideways scrolling, no small tap targets at any width. Screenshots reviewed.
* Regression: see STATUS.md (the mock and real-stack suites of Packs 03 to 09D).

## Known limitations, intentionally deferred

* "Events competed" counts an event with an official fight or placing; the older `fighter_career_stats.events_attended` (an entry at a played event) is
  unchanged and still used by the rankings page. The two differ only for a no-show with no placing.
* Fighter head to head covers individual competitions; two fighters on opposing team rosters are not a meeting (by design).
* Organization filter appears only when a fighter or team has records in more than one organization.
* Streaks are shown only from three fights and only when the chronology is certain; otherwise nothing is claimed.
* The hosted project's realtime socket is not exercised by the local stack (no socket there), as in Packs 09A to 09D; the profiles do not use realtime.
* The views scan final matches once per request (small tables today); an index on `matches (queue_state)` can come later if profiles get slow.

## Hosted release

See STATUS.md (filled in at release).
