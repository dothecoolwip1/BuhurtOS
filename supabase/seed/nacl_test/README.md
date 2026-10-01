# NACL-test: a fictional league dataset

Northern Armored Combat League-test (`nacl-test`, short name NACL-test) is **entirely fictional**: 10 teams, 120 fighters, 15 completed events
(May 2023 to Sep 2026) and one current event (Red Deer Rumble-test, Nov 14-15 2026). Every organization, team, event and fighter name ends in
`-test`, and every row carries an unverified `record_sources` entry from the source "NACL-test fictional dataset" (docs/VISION.md, "Real data matters").
It exists to stress-test BuhurtOS with a realistic volume of data. The owner's facts are in `scripts/testLeague/roster.md` (binding).

## What is in the files

| File | Content |
| --- | --- |
| `00_core.sql` | source, organization, 4 seasons, 10 teams, 10 member affiliations, their record sources |
| `01_fighters_a.sql`, `_b`, `_c` | 120 fighters (profile, bio, highlights), their memberships (from the join date), record sources |
| `10_...` to `24_...` | one file per completed event (15), in date order |
| `30_event_current_red-deer-rumble-test.sql` | the current event: entries, rosters, drawn and scheduled matches, nothing final |
| `cleanup.sql` | removes exactly this dataset (see below) |

Every file is one transaction (`begin; ... commit;`), under 400 KB, and **safe to run again**: base rows use `on conflict`, matches are only
finalized when they are not final yet.

### How the data is loaded (the real product paths)

* Base rows (source, organization, seasons, teams, fighters, events) are written by the loader role (postgres), like `supabase/seed/*.sql`.
* Everything an organizer does runs **as the platform owner through RLS, grants and RPCs**: `set_event_season`, `set_event_organization`,
  inserting competitions, entries and matches, `set_entry_roster` (rosters and mercenaries), `finalize_match` (every result, with duel round
  points or group fight rounds in `detail`), `finish_competition` (places and league points).
* Placements, points, rankings, statistics and standings are **never typed in**: they come from `finish_competition` and the views.
* The owner is the placeholder `__OWNER_ID__`. Replace it with the platform owner's auth user id when loading
  (`sed "s/__OWNER_ID__/<owner id>/g" file.sql`, or find and replace in the SQL editor). Locally the runner creates an owner user.

## Load order

`00_core` -> `01_fighters_a, b, c` -> `10_...` to `24_...` (any order among events, but date order is natural) -> `30_...`.
Check with `supabase/tests/nacl_league_verify.sql` (read-only, prints PASS/FAIL and a report).

### Locally (throwaway Postgres only)

```sh
PGHOST=/var/tmp/nacl/run PGPORT=55433 PGUSER=postgres supabase/tests/run_nacl_league.sh        # builds a scratch db from all migrations, loads, verifies
PGHOST=... supabase/tests/run_nacl_league.sh --keep                                         # reload into the same db (idempotence check)
PGHOST=... psql -X -d nacl_scratch -f supabase/seed/nacl_test/cleanup.sql                       # remove it again
```
The runner refuses any host that is not a local socket directory, localhost or 127.0.0.1. It skips migration `20261001001300` (needs pg_cron).

### On the live Supabase project (SQL editor or SQL tool, chunk by chunk)

1. **Apply migrations through `20261001002400` first.** `20261001002300` makes statistics ignore upcoming events (otherwise the Rumble counts as
   "attended"); `20261001002400` fixes deleting linked matches in one statement, which `cleanup.sql` needs.
2. Open each file in order, replace `__OWNER_ID__` with the real owner's auth user id, run it as ONE execution (as the `postgres` role, so
   `set local role authenticated` works). If a file fails, nothing from that file is kept; fix the cause and run it again.
3. Run `supabase/tests/nacl_league_verify.sql` (set `owner_id` with `psql -v owner_id=...`, or edit the default at its top). It changes nothing.
4. Never run these files against a database you care about without reading `cleanup.sql` first: the dataset is public (events are published).

## Removing it

`cleanup.sql` deletes exactly the rows listed in `record_sources` for the source "NACL-test fictional dataset" (organization, seasons, teams,
affiliations, fighters, memberships, events, competitions, results) plus their children (entries, rosters, matches, audit rows), in foreign-key
order, in one transaction. It **refuses to run** (nothing deleted) if any listed row is not a `-test` row, if anything outside the dataset depends
on a dataset row (another event on the organization, an entry of a test fighter in a real competition, a real fighter on a test team, a claimed
fighter, a captain account, registrations), and it re-checks that nothing is left before committing.

## Regenerating

```sh
npm run nacl:gen        # rolldown bundles scripts/testLeague/generate.ts, node runs it; writes supabase/seed/nacl_test/*.sql
```
Deterministic: same `roster.md` + same code + same `scripts/testLeague/stats.json` give byte-identical files; ids are UUIDs derived from names.
Bios are written in **two passes** so they only claim what the product's own views report: load once, then
`psql -X -tA -d nacl_scratch -f scripts/testLeague/export_stats.sql > scripts/testLeague/stats.json`, then `npm run nacl:gen` again.
Results do not depend on bios, so `stats.json` is stable (checked: re-exporting after the second pass gives the identical file).

## Assumptions and honest notes

* Gunnar Reed-test's join year (2019) is an assumption (the owner did not state it); it is flagged in his record source note.
* Join dates inside a year are generated (Finn Mercer-test: 2024-10-12, so his first event is Blackfalds Battle Bash-test, Nov 2024).
* "Registrations" are entries (duel entries by fighter, team entries with an `entry_fighters` roster); the `registrations` table (waiver, insurance) is not used.
  The brief's "about 90 entries" for the Rumble is read as fighter-category registrations (duel entries + roster rows) = 87; the `entries` rows are 55.
* Women's 3v3 never formed (too few women with a 3v3 discipline attend together); Women's 5v5 is small and mercenary-heavy, which the roster explains.
* `matches.finalized_at` and the audit log timestamps of the completed events are moved to the event weekend after loading (cosmetic).
* In pools-then-bracket competitions, entries that did not reach the knockout are placed by their pool finish first (documented rule of
  `compute_places`), so a pool-stage 6th can have fewer points than a 7th. This is the documented behaviour, not changed.
