# Pack 26: full Rumble rehearsal, event-day hardening and product polish (2026-10-07)

Durable work log of Pack 26. Levels are kept apart on purpose: **repository**, **local database**, **build / tests**, **browser verification**, **hosted database**, **deployment**.

**Hosted Supabase and production were not touched by this pack: no migration applied, nothing deployed, no hosted row written. Everything below ran on a throwaway local stack.**

## 0. Branch, baseline, scope

| | |
| --- | --- |
| Branch | `ccr-ba2f7d4b-7bn1n5` (the session's designated branch; it is the Pack 26 branch) |
| Starting commit | `0c1fc9d` (`main` after PR #55, Pack 25.1) |
| Container | Linux, Node 22.22, Postgres 16.15 (local throwaway cluster at `/var/tmp/run:55432`), PostgREST 12.2.3 (downloaded binary), Chromium 1194 (Playwright) |
| Scope | the 48-part Pack 26 brief: a realistic synthetic rehearsal fixture; the full tournament lifecycle in the running app; fixes for reproduced problems within established decisions; the UI/UX audit by persona (`PACK_26_UIUX_MATRIX.md`); documentation accuracy |

### Baseline (before any change, 2026-10-07)

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 112 files passed, 6 skipped; **1404 tests passed**, 6 skipped |
| `npm run build` | clean (chunk-size warnings as before) |
| `supabase/tests/run_all.sh` | **DATABASE GATE PASSED**: security 709, captain 65, team_admin 69, activity 90, pack01 70, pack02 69, pack03 67, pack05 43, pack07 109, pack1 49, reconcile 54, pack08 122, synthetic_org 37, pack09a 107, pack09b 47, team_discipline 53, pack09c 136, pack09d 149, pack10 104, pack11 28, pack12 122, pack13 269, pack14 69, pack15 61, pack16 90, pack18 36, pack181 sessions 119 / roles 133 / broadcast 104, club 111 / 78 / 136, pack22 139 / 119 / 43 / 64 / 14, pack24a0 151, pack24 followups 28; vectors, fingerprint, simulation, league 68/68, four concurrency suites |

## 1. The rehearsal fixture

`scripts/e2e/fixtures/pack26.sql` (TEST DATA ONLY, local throwaway database, tagged synthetic through `sources.synthetic` + `record_sources`). It reuses the Pack 11 people (`rumble.sql`: 52 fighters with accounts, 10 teams, platform owner a1, organizer a2) and adds what the brief asks for. Details in section 1 of the work log below as the fixture is built.

## 2. Work log

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| 1 | Baseline recorded | done | section 0 |
| 2 | Local real stack (Postgres, PostgREST, built app, Chromium) | done | `/var/tmp/run`, `/opt/postgrest` |
| 3 | Pack 26 fixture | in progress | `scripts/e2e/fixtures/pack26.sql` |
| 4 | Existing live suites re-run on the real stack | in progress | section 6 |
| 5 | Full rehearsal script `scripts/e2e/pack26-live.{sh,mjs}` | to do | |
| 6 | Problems reproduced and fixed | to do | section 3 |
| 7 | UI/UX matrix | to do | `PACK_26_UIUX_MATRIX.md` |
| 8 | Docs accuracy | to do | section 8 |

## 3. Problems reproduced, severity, root cause, fix

(filled as found; one row per problem)

| # | Where | Severity | Reproduced how | Root cause | Fix | Files | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |

## 4. Migrations

None yet.

## 5. Permissions affected

None yet.

## 6. Tests

(exact commands and results, filled as they run)

## 7. Browser verification, screenshots, viewports

Screenshots: `docs/reviews/assets/2026-10-07-pack26/`.

## 8. Documentation corrected

## 9. Known limitations, owner questions, deliberately deferred

## 10. Final verification
