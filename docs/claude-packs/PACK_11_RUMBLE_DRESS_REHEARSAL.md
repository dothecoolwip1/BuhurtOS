# Pack 11: Red Deer Rumble full dress rehearsal, event-day resilience and readiness

Branch `ccr-1c6a5a85-57ov54` (from `main` `37a0326`, Pack 10 released). One new migration, `20261005000300_pack11_my_event_entries.sql`
(two fixes found by the rehearsal, below). Nothing before it was touched.

The rule for this pack: **run the whole Rumble the way people will, find what would make someone reach for paper, fix it, run it again.**
Nothing is injected: the event is created in Quick Setup, every registration goes through `submit_registration` as that person, every result
through the scoring screen or the scorekeeper's `submit_match_result` command, every placing through Review wins & losses or the Results screen.

## The rehearsal tournament (deterministic fixture, local only)

`scripts/e2e/fixtures/rumble.sql`: 52 fictional fighters with accounts (40 men on eight teams of five, 12 women on three teams of four), 10 teams
of the Parkland League, an organizer, a head marshal, two scorekeepers, a stranger. The plan (`rehearsal.plan`) says who enters what:
Men Longsword 16, Sword & Shield 9, Polearm 7, Sword & Buckler 5, Sabre 1, 5v5 8 teams, 3v3 6 teams; Women Longsword 6, Women 3v3 3 teams.
Three share equipment, one is here the first day only, one the second day only (so 12 of his fights are held), one has insurance proof pending,
two have not paid, two from Saskatchewan owe no fee, two never arrive. The draw itself is random per run (as at a real event); every result
follows one rule (`decide()` in the journey) so a three-way medal tie in Buckler, a three-way pool tie in Longsword and a 3-3 draw in Women
Longsword come out every time.

Run: `PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/tmp/postgrest scripts/e2e/rumble-live.sh [shots-dir]`
(real Postgres from every migration, PostgREST, the real built app, Chromium at 390 / 768 / 1280 / 1366 / 1920). Not part of CI.
Plan sanity metrics: `psql -d <db> -v event=<uuid> -f scripts/e2e/rumble-plan-metrics.sql`.

## The journey (19 sections, every claim checked against the database)

1. Quick Setup on a phone (two fields, seven categories × two divisions), waiver, $50 fee for Albertans, close time, Open registration.
2. Three people register on their phones (one Sunday-only, one sharing kit); the other 47 through the same function. Private data lands in
   `registration_private`; anon has no grant on registrations at all.
3. Review on a phone: accept, mark paid, the rest the same way; entries per competition; rosters set (17 team entries).
4. Check-in on a phone: 0/50 → blocked list with plain reasons (insurance, two fees) → Check in anyway → 48/50, the two no-shows left.
5. Build tournament: 50 fighters, 8 competitions, 102 fights; the organizer picks four pools for Longsword and a bracket with third place for
   Polearm (7 → one bye); Review plan; Use this plan. Metrics: 86 planned, **0 back-to-back, 0 double bookings, 0 availability violations,
   12 held for the Sunday-only fighter**, 80 to 82 of the fights with a previous appearance at the 3-fight rest target (the rest 2 or first).
6. My next fight before the first call (a plan-counted place, all his fights, checked-in state), the no-show, the held fighter; Event day on
   two fields: Run this fight, Choose another fight (busy fighters marked), stability (the on-deck fight is the one that starts), Run next,
   Let BuhurtOS plan it again.
7. The scorekeeper's phone: three fights in a row, duel and team boards, the 1080p hall display following the running score; ~6 s of wall
   time for three fights, 28 to 42 taps.
8. Signal lost mid-fight: actions kept in IndexedDB, Save → Pending NOT official, paper named; Back to the queue (keep this pending); the
   next fight cannot open without signal (by design); two pending results; reconnect; browser reopened; each saved exactly once.
9. Two devices disagree (conflict → Needs review → head marshal keeps the official one with a note); a fight reopened under an open board
   (stale → sent to the head marshal, nothing official); the reopened fight scored again.
10. Paper: a wrong official result corrected from the score sheet, the previous result kept on the proposal.
11. No-show taken out (3 walkovers, draw untouched, his team still fights); an injury in the Polearm bracket (walkover).
12. Concurrency (same command ×3 at once, two different commands at once, three "start next" at once); the remaining 86 pool fights through
    the queue on two fields, the 12 held fights called by hand; both engineered ties verified in `pool_standings`.
13. Pools → brackets: the pool tie decided by a person (Up/Down, note), 8-fight Longsword bracket, Sword & Shield and 5v5 brackets; 16
    bracket fights including the Polearm bye, third places and finals.
14. Review wins & losses with the medal tie, Confirm results; the rest from the Results screen; Women 3v3 reopened with a reason, a fight
    corrected from the sheet, finalized again (revisions kept); Close event (five never-run competitions closed as not held); locks.
15. Public results page; Arena "Event complete" at 1920 / 1366 / 768.
16. Career statistics: the champion's profile (gold, team represented, fights), the team page, rankings, `fighter_career` / `team_career`.
17. Archive (identical statistics), exclude (exactly this event's contribution gone) and restore (identical), inactive fighter (history
    kept), synthetic tagging on this LOCAL copy (official aggregates empty, test context only, the public page says fictional).
18. Permissions straight at the database (anonymous, stranger, scorekeeper, head marshal, organizer refusals) and privacy of every public
    answer behind the event, arena, field, rankings, team and fighter pages.
19. Edge states (empty field, organizer area as a scorekeeper, no entry, one entrant) and phone / tablet sweeps of the busiest screens.

## What the rehearsal found and what was done

| Sev | Where | Finding | Done |
| --- | --- | --- | --- |
| P1 | Two fields | Automatic promotion chose a field's next fight by order alone, so with two fields running at different paces one person could be made **active on both fields at once**; Event day only flagged it afterwards. | Fixed in the database: `private.promote_one` never promotes to active a fight whose fighter or roster member is in an active fight anywhere (`private.fighting_elsewhere`). Gate `pack11_gate.sql`. Verified: 90 pool fights and 16 bracket fights on two fields with no double booking. |
| P1 | My next fight | A fighter saw the fights of **every team entry of his club**, including the women's 3v3 (`my_event_entries` matched by the club's team row). | Fixed: a team entry is the viewer's when they are on its recorded roster; the registration stands in only while no roster exists. Gate checks. |
| P1 | My next fight | Fights on Field 1 showed "Field not set yet" and no place (Field 1 is stored as a blank field); nothing said how far away a planned fight was; one fight at a time. | Rewritten: place counted from the field's line and the saved plan order ("Coming up soon · 2 fights ahead of you on Field 1", never a clock), every unfinished fight across competitions, held fights named, a short-rest note, checked-in state. The public page's live read now carries the plan columns. 17 unit tests. |
| P1 | Event day | **Choose another fight** could start a fight whose fighter was fighting on the other field at that moment. | The dialog marks such fights ("X is fighting now on Field 1: it cannot start now") and disables Run this instead. |
| P1 | Scoring | After a lost signal the Pending screen had no way back to the queue: the scorer was stuck until the signal returned. | "Back to the queue (keep this pending)": the board and command stay on the device; reopen the fight to save it. |
| P2 | Review | Accepting a team registration creates no roster; the organizer sets 17 rosters by hand although the registrations say who fights for which team. | Not changed (roster rules are the team's); noted for a later pack. |
| P2 | Event day | After a manual override the line behind can hold two fights with the same people back to back; only the recommendation card warns about short rest. | Noted. |
| P2 | Check-in | A no-show in three competitions means three Take outs; nothing offers "take this person out of everything". | Noted. |
| P2 | Scoring | Without signal the NEXT fight cannot be opened (opening sets it active and re-reads its version). Paper is the fallback for it. | By design (no full offline mode); the runbook says so. |
| P3 | Scoring | Opening the on-deck fight makes it active while the first is still active (two active on one field; Needs attention flags it). | Noted. |
| P3 | Scoring | Two identical commands in the same instant: one accepted, the other refused with 409 instead of "duplicate"; a later retry gets its original answer back (`repeat: true`). One result either way. | Noted. |

## Paper comparison

| Task | Verdict |
| --- | --- |
| Registration, review, fees, insurance, check-in with blockers | CLEARLY BETTER THAN PAPER |
| Building the draws and the fight order for rest across two fields | CLEARLY BETTER THAN PAPER |
| Calling fights, keeping two fields moving, never double-booking a person | CLEARLY BETTER THAN PAPER (after the P1 fix) |
| Scoring a fight on a phone, the hall display | CLEARLY BETTER THAN PAPER |
| Scoring with no signal | ABOUT THE SAME (the open fight is kept; the next fight waits for signal or paper) |
| Two devices disagreeing, a wrong result corrected | CLEARLY BETTER THAN PAPER (audited, nothing lost) |
| Withdrawals and no-shows | ABOUT THE SAME (per competition, three taps each) |
| Ties, brackets from pools, placings, podiums, closeout | CLEARLY BETTER THAN PAPER |
| Fighters knowing when they fight | CLEARLY BETTER THAN PAPER (plan-counted place, no notifications) |
| Career statistics afterwards | CLEARLY BETTER THAN PAPER |

## Readiness scorecard

| Area | State |
| --- | --- |
| Quick Setup, waiver, publish | READY |
| Registration (fighter) | READY |
| Review, fees, insurance | READY |
| Check-in and blockers | READY |
| Team rosters | READY WITH LIMITATION (set by hand per team entry) |
| Build tournament, plan, rest | READY |
| Event day two fields | READY (promotion guard new) |
| Called-fight stability, manual override | READY |
| Scorekeeper phone scoring | READY |
| Hall display (Arena) | READY |
| Connection loss | READY WITH LIMITATION (open fight only; next fight needs signal or paper) |
| Conflicts, stale results, head marshal review | READY |
| Paper entry and corrections | READY |
| Withdrawals, no-shows, walkovers | READY WITH LIMITATION (per competition) |
| Ties and bracket from pools | READY |
| Review wins & losses, finalize, reopen | READY |
| Closeout | READY |
| My next fight | READY (rewritten) |
| Career statistics, archive, exclusion, synthetic isolation | READY |
| Permissions and privacy | READY |
| Concurrency | READY |
| Performance (Event day 47 requests, ~1 s load; no per-match requests) | READY |
| Service worker update safety | READY (sw-update CI suite; not re-exercised here) |
| Real phones, real radios | NEEDS WORK: not tested here (see the checklist) |

**Recommendation: GO WITH KNOWN LIMITATIONS**, provided the real-phone checklist below is run on the deployed build before the Rumble.

## Real-phone checklist (NOT executed in this pack; local Chromium only)

Use `docs/runbooks/REAL_PHONE_REHEARSAL.md` rows 1 to 16 on an iPhone and an Android phone against the deployed site, plus:
17. Two phones on two fields for twenty fights: watch Needs attention for "booked twice" (there should be none).
18. A fighter's phone on the event page through three of their fights: the place counts down, "on deck" and "fighting now" arrive on time.
19. Airplane mode mid-fight, finish, Back to the queue (keep this pending), signal back, reopen, Save.

## Verification evidence (local; see STATUS.md for the release)

Journey: `scripts/e2e/rumble-live.sh`: final run 178 checks green through section 14 (every competition official); sections 14 tail to 19 not reached by a complete run (STATUS.md); database gate `pack11_gate.sql` 16 checks; full `run_all.sh`;
unit suite; typecheck; production build. Hosted: the migration applied through the Supabase MCP and verified read-only (STATUS.md).
No real event, result, fighter or team was changed anywhere; the rehearsal event exists only on the local scratch database.
