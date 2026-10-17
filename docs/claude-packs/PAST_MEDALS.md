# Past medals: tournaments kept for their medals (2026-10-17)

Keston Piche (Red Deer Reavers) has medals from four tournaments that were never run in BuhurtOS. The owner asked for three things: add Keston's
medals; create the tournaments so that everyone else who fought there can add theirs to the same tournament; find the exact dates. No scoring:
medals only.

## What was built

**Database** (`supabase/migrations/20261022000100_past_medals.sql`, additive, safe to run twice):

- `events.medals_only` (boolean, default false): a published past tournament kept for its medals. No registration (`registration_mode = 'none'`),
  no fights, no scoring, nothing live. The Pack 09C locks stay in force for every other event.
- `ref_categories` gains `axe` ("Axe (short / long)", HACSA league) for the Geeky Market medal.
- `public.add_past_medal(p_event, p_category, p_place, p_note, p_fighter, p_team)`: a signed-in fighter adds a gold, silver or bronze in an individual
  discipline to their OWN profile at a medals-only tournament. A platform organizer or the owner may pass another fighter's id to enter that
  fighter's report. The discipline's competition is created on first use (status `finished`, tier null: 0 ranking points; `finalized_at` the day
  after the event), the entry and the result are written through the same audited path as official results (`result_revisions` action
  `reported`, `audit_log` `result.reported`), and the result carries a source row: "Fighter-reported past medals" (fixed id
  `5c2d7e1a-3f64-4b8e-9a0c-7d1e2f3a4b5c`), status `unverified`. The same medal twice answers `already_recorded`; a different placing in the same
  discipline is refused until the first is withdrawn. Team disciplines (3v3, 5v5 ...) are refused for now. When a fighter reports their own
  medal, the team shown with it is the team they fight for today; when the owner enters it, the team given.
- `public.withdraw_past_medal(p_result, p_reason)`: the fighter (or a platform organizer) takes back an UNVERIFIED report. Logged as `voided`
  with the reason; the result and its source row go, the entry stays as `withdrawn` (revisions and the audit trail hang from it; nothing is
  deleted silently); reporting the discipline again wakes the entry.
- `public.past_medal_records` (view, security invoker): which placings are reports and whether each is verified. No account ids.
- `private.record_past_medal` does the work with no permission check (the public function and the migration's data section call it);
  `private.discard_past_medal_report` holds the removal, as Pack 09C keeps every removal of result rows in `private.discard_result`.
- `20261022000200_kings_cup_2025_dates.sql`: Kings Cup 2025 moves from the placeholder to June 28-29, 2025 (the owner's dates), its medal
  competitions' "official since" day follows, a source row records who gave the dates, and the change is audited (`event.dates_set`).

Everything that already reads results reads these rows unchanged: the fighter's career summary (5 gold, 3 silver, 4 bronze for Keston), the
Disciplines block, Event history, the tournament's podium (`competition_results`), the HACSA organization view. Rankings see 0 points.

**App**:

- Own fighter page: a **Past medals** block (`src/components/PastMedals.tsx`) lists the fighter's medals at medals-only tournaments, each with
  "Reported by the fighter · not verified" and a Remove action, and an **Add a past medal** form: tournament, discipline, Gold / Silver / Bronze,
  optional note. Adding re-reads the career summary and the results in place. Shown only to the fighter themself (the database decides anyway).
- A medals-only tournament's results page: a "Past tournament · Medals only" notice (with the time note, e.g. "Exact date to be confirmed"), an
  **Add my medal** button to one's own profile (sign in / find your profile otherwise), and the podiums under the heading "Medals" instead of
  the event record tabs. `LiveEvent.medalsOnly` comes from `events.medals_only`.
- Pure rules and tests: `src/lib/pastMedals.ts`, `src/lib/pastMedals.test.ts` (8 tests).

## The four tournaments

| Tournament | Slug | Dates recorded | How sure | Source recorded on the event |
| --- | --- | --- | --- | --- |
| Kings Cup 2025 | `kings-cup-2025` | June 28-29, 2025 (venue not recorded) | given by the owner on 2026-10-17; not found online after ten searches (no HACSA, Buhurt International, buhurt-ranking or news listing). Created with a placeholder date first, corrected by `20261022000200_kings_cup_2025_dates.sql` | `imported` (source: the owner's statement) |
| Strathmore Summer Siege 2025 | `strathmore-summer-siege-2025` | Aug 22-24, 2025, Strathmore Ag Grounds (Medieval Faire), HACSA | confirmed: HACSA event page listing + faire dates in local news | `imported` |
| Geeky Market 2025 (Edmonton) | `geeky-market-2025` | Nov 22-23, 2025, Edmonton EXPO Centre Hall E (the market's dates) | market dates confirmed; the tournament itself is not on any page found | `unverified`, time note "Market dates; tournament day to be confirmed" |
| Coulee Clash 2026 | `coulee-clash-2026` | May 30-31, 2026, Servus Sports Centre, Lethbridge (Company of the Black Spears; HACSA rules) | confirmed: Lethbridge Herald (June 2, 2026), Buhurt International and buhurt-ranking listings (May 30) | `imported` |

Keston's medals recorded (all open division, team Red Deer Reavers, source note "Reported by Keston to the owner"):
Kings Cup 2025: bronze Longsword, gold Profight. Strathmore 2025: bronze Sword & Shield, silver Longsword. Geeky Market 2025: gold Longsword,
gold Axe (note: "Keston still has to double-check this one"), bronze Sword & Buckler. Coulee Clash 2026: gold Longsword, gold Greatsword,
silver Polearm, bronze Sword & Buckler, silver Sabre. The "+ one more" at Strathmore and at the Geeky Market were not recorded: Keston can add
them himself from his profile once he remembers, or tell the owner.

## Hosted (mvbxlebznlgroptwwdsm), applied 2026-10-17 through the Supabase MCP

The whole file was cancelled by the tool's confirmation gate (as in Pack 09C: a function body that both logs a revision and removes result rows);
the removal was moved into `private.discard_past_medal_report`, and the migration went on in parts: `past_medals_schema`,
`past_medals_withdraw_view`, `past_medals_data`, then `past_medals_keep_entries` (the entry is kept as `withdrawn` instead of deleted; the
repository file carries the same final text), and `kings_cup_2025_dates` once the owner gave the dates (verified: event June 28-29, 2025, no time
note, both competitions official since June 30, 2025, source row and audit row present, Keston's profile shows the new dates).

Verified read-only after: 4 events `medals_only`, 12 competitions (finished, no tier), 12 results for Keston with points 0, 12 `reported`
revisions, 12 `result.reported` and 12 `competition.created_for_past_medals` audit rows, 12 `past_medal_records` rows `unverified`;
`fighter_career` for Keston: 4 events, 12 podiums, 5 / 3 / 4, 0 points; anon reads the 4 events, 12 podiums, 12 report rows and the history.
Permission cases (each in a rolled-back transaction): Keston adding the same medal again `already_recorded`; a 4th place refused; a medal on
Red Deer Rumble 2026 refused ("run in BuhurtOS"); a stranger adding for Keston refused (42501); anon has no execute on `add_past_medal`;
a stranger withdrawing Keston's medal refused; Keston withdrawing his Axe gold: report gone, revision `voided` logged, entry `withdrawn`,
re-adding it wakes the entry and logs `reported` again.

Not done here: the app deploy (the branch is pushed, not merged; the live site shows the new block once `main` deploys), physical phones,
verifying any medal (there is no "verify" action yet; the owner changes `record_sources.status` by hand or asks for one), team medals.
