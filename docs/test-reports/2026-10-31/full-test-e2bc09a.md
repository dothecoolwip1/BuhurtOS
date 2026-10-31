# Full site test and optimization: e2bc09a: partial (local complete, production browser checks NOT RUN)

- Code under test: `e2bc09a` (origin/main, the build serving https://buhurt-os.app per Vercel on 2026-10-31). Fixes and optimizations are on
  branch `claude/project-thread-xkt5e2`.
- UTC window: 2026-10-31 05:40 to 06:45.
- Browser: Playwright Chromium (headless) in a cloud container, one browser context per role. Phone and tablet sizes are browser viewports
  with touch emulation, not physical devices.
- Production browser checks: **NOT RUN**. The cloud container cannot open https://buhurt-os.app (blocked by the network policy), and the
  full-test skill (PR #87) is built for seven Edge sessions on the owner's PC. Hosted Supabase was read-only: logs, `pg_stat_statements`,
  advisors and function definitions. Nothing was written to hosted and nothing was deployed.

## How it was tested

A full local copy of the stack, built from the repository:

| Part | What ran |
|---|---|
| Database | PostgreSQL 17, every migration in `supabase/migrations` applied from zero (the same build `supabase/tests/run_all.sh` uses) |
| API | PostgREST v12.2.3 and Supabase Auth (GoTrue v2.177.0), the real device-session handler (`scripts/e2e/localstack.mjs`) |
| App | `npm run build` + `vite preview` (production bundle) |
| Browsers | headless Chromium, a separate context per role: organizer, secretary, head marshal, 4 counters, medic, announcer, fighter, captain, spectator, stranger, owner |

Harness fix found on the way: `eventday-live.sh` and `represented-team-live.sh` started the preview with `npx vite preview`; killing the
wrapper left the real server running, so a later run could silently test an older build. They now run `node node_modules/vite/bin/vite.js
preview --strictPort`, which fails loudly if the port is taken.

## Results: local automated

| Check | Command | Result on the branch |
|---|---|---|
| TypeScript | `npm run typecheck` | pass |
| Unit tests | `npx vitest run` | 1,631 passed, 6 skipped (4 new tests for screen loading) |
| Production build | `npm run build` | pass; entry script 2,024 KB → 310 KB, no chunk-size warning |
| Database gate | `supabase/tests/run_all.sh` | DATABASE GATE PASSED: every SQL suite, simulation, league verifier, concurrency, fingerprint (fingerprint updated with the migration) |
| Site sweep (new) | `scripts/e2e/site-sweep.sh` | 381/381 after fixes, re-run on the final branch (13 roles × 49 screens at 390×844 and desktop) |
| Screen loading (new) | `node scripts/e2e/lazy-chunks.mjs` | 11/11: deploy reload-once, offline opening of never-opened screens |
| Offline worker | `node scripts/e2e/sw-update.mjs` | 28/28 on the old and the new build |
| Live updates keep the view (updated) | `scripts/e2e/live-stability.sh` | 42/45; the 3 left fail the same way on `e2bc09a` |
| Existing browser rehearsals | 31 `scripts/e2e/*-live.sh` against `e2bc09a` | 6 fully green, 25 with failures; all 25 triaged below as outdated tests, none as an app bug |

### Site sweep: what it checks and what it found

Every screen, as every role, on a phone (390×844) and desktop: console errors, failed or 5xx requests, private data in the page (a planted
medical note, emergency contact, phone and private email on a TEST registration), sideways overflow, tap targets under 44 px, and that a
stranger and the wrong staff role are refused.

| Finding (all fixed on the branch) | Where | Fix |
|---|---|---|
| "Show test data" toggle 25 px tall | /fighters, /teams | `label.toggle` 44 px min height (`src/styles/touch.css`) |
| "Change name" 25 px | /account | `.acct-edit` 44 px |
| Announcer "back" link 20 px | /events/…/announcer | `.an-event` 44 px |
| Event Control back link, team roster links | control, team page | `.ctl-back`, `.roster li > a` 44 px |
| "Needs attention" links 30–32 px | Live ops | `.cc-glance li a` 44 px, keeps the space between words |
| Category tick boxes in registration and profile edit 18 px rows | /register, /fighters/…/edit | `.pick-row` 44 px rows (`src/styles/app.css`) |
| Signed-out visitors' fighter page called `can_manage_fighter` and got a 401 in the console | /fighters/… | skip the check when nobody is signed in (`src/components/Lifecycle.tsx`) |
| Medic and secretary got a 403 from the Command Centre snapshot for a moment after opening Event Control (Live ops mounted before their roles loaded) | /events/…/control | wait for the roles before choosing the view (`EventControlPage.tsx`) |

Private data: none leaked on any screen for any role. Refusals: a stranger was refused on every staff screen; the medic and announcer could
not reach organizer tools.

### Existing browser rehearsals: triage

All 31 ran against `e2bc09a` (what production serves). Each failure was read against the code and the merged PRs. Every one traces to a
deliberate product change that the test was not updated for. Where a script stopped early (a click that waits for a renamed or moved
control), the checks after that point were **not run**; that is a coverage gap, not a pass.

| Script | Pass / fail | Cause |
|---|---|---|
| device-reliability, pack14, pack22-history, pack22-review, pack24a1, pack23r-rehearsal | all pass | |
| announcer, pack18 (B0), pack24a0, pack181 (§4, 5, 7), device (41, 46) | secretary refused | PR #71: the secretary runs only the fights now / on deck / in the hole, and has no Command Centre or announcements. Tests predate it. |
| pack181 (1, 3, 8) | head marshal made a device code | Commit 2d874c0: whoever runs the day makes Counter QR and device codes. Test predates it. |
| live-stability (4), cc181 (1.1–1.5), pack26 (71) | Command Centre sections not visible | PR #71: Live ops puts Lysts first; Needs attention, Camera Off, Fights and Broadcast sit under "Event tools and details". live-stability updated on the branch to open that first. |
| arena, eventday, finalize, pack13, pack15, pack16, pack22, pack22-discipline, pack25, pack09d, represented-team, rumble | a click or wait timed out | "Field" became "Lyst", the Live ops layout changed, the default discipline set changed (11 of 14 ticked), ended events say "ended" not "complete". |
| pack18 (A13) | first sign-in lands on /account | PR #73: /account stays reachable without setup by design. |
| pack10 (team hero) | "Red Deer, AB, CA" | regions are stored as codes now; test expects "Alberta". |
| device (22) | "Access ends Sun 23:00 MST", test wants "Mon 00:00" | Daylight saving ends 1 Nov 2026: access lasts 24 real hours past the event day, which is 23:00 on the clock that night. Harmless, but see Contradictions. |
| obs (1.6 onward) | stream controller heartbeat | the controller test fixture no longer creates the session the test reads (`select version … where id = ''`). |
| live-stability (0, 3 desktop, 5 phone) | public event page 399 px tall (test needs 400); desktop Event day scroll moved when the fight it was anchored to was called away; phone public event page moved 106 px after offline and back | Same three on `e2bc09a` and on the branch (42/45 on the branch after the test update; the Command Centre checks now pass). Not caused by this work; worth one look at scroll anchoring on those two screens. |

Recommendation: update these scripts in a separate PR before the next rehearsal. Until then, they are not a safety net for the screens
they no longer reach.

## Optimization

### 1. Screens load on first open (frontend)

The whole site was one 2 MB script that every phone downloaded and parsed before showing anything. Each screen now loads when it is first
opened (`src/lib/lazyPage.ts`, `src/App.tsx`).

Measured in Chromium at 390×844, median of 3 runs, time until the screen is usable:

| Screen | Slow 3G before → after | Fast 3G before → after |
|---|---|---|
| Home | 6.7 s → 2.8 s | 3.4 s → 1.6 s |
| Counter | 6.6 s → 3.4 s | 3.4 s → 2.0 s |
| Event Control | 6.7 s → 2.8 s | 3.4 s → 1.6 s |

Script needed for the first screen: 1,976 KB → about 650 KB (Event Control 1,258 KB).

Safety, tested in a real browser (`scripts/e2e/lazy-chunks.mjs`):

- **After a deploy**, a tab still running the old build opens a screen whose file is gone. It reloads once onto the new build and shows
  that screen. It never reloads in a loop.
- **Offline**, after one visit the offline worker has every screen. A phone with no signal can open screens it has never opened.
- `vercel.json` no longer rewrites missing `/assets/*` files to the app page, so a missing file fails cleanly.

### 2. Counter and Lyst desk polls (database)

Hosted evidence (read-only):

- `pg_stat_statements` since 2026-10-10: `counter_state` averaged 433 ms over 8,108 calls; `lyst_state` averaged 248 ms over 10,359.
- Edge logs, last 24 h: `counter_state` p95 4.6 s, max 12.7 s, 28 errors (5xx); `lyst_state` p95 4.4 s, 15 errors; `device_whoami` p95 13.7 s;
  `device_refresh_session` p95 16.8 s.
- Postgres logs: 69 "canceling statement due to statement timeout" between 19:24 and 19:56 UTC on 30 Oct, inside `counter_state` and `lyst_state`.

Cause: the 28 one-statement helpers these polls call were SQL-language `SECURITY DEFINER` functions. PostgreSQL never inlines those and
plans their statement again on every call, many times per poll. Migration `20261115000100_counter_poll_cost.sql` keeps each statement
unchanged and runs it as PL/pgSQL, whose plans are cached per connection. `counter_state_for` also reads the Lyst list and the current fight
once instead of twice each.

| Bench (32 events, 2,115 fights, 200 polls) | Before | After |
|---|---|---|
| `counter_state` | 1.6 s | 0.75 s |
| `lyst_state` | 1.0 s | 0.15 s |
| Reading `matches` under RLS (organizer) | 31 ms | 25 ms |

Correctness: hosted definitions of all 32 functions were compared by hash with the repository first (identical). Then every counter
session's state, every Lyst's state, and every converted helper for every event, Lyst, fight and entry were compared before and after:
**identical** (2,989 rows; clock fields excluded, synthetic ties in finish times broken first because the "last fight" pick among fights
finished at the same instant is arbitrary in both versions).

The migration only replaces functions; no rows change, so open events, Lysts, fights and counter phones pick it up on their next poll.
**It is not applied to hosted.** That needs Garrett's go.

### 3. Hosted compute (needs Garrett)

The local per-poll cost is about 8 ms; hosted takes hundreds of ms and times out at peak. The hosted project is on the smallest compute
(Micro: 60 connections, 224 MB shared buffers), and the same database also serves the steeltape game. The slowness on 30 Oct is the
machine running out of CPU, so the migration helps but a bigger machine is the direct fix for tournament weekends.

Step by step (Supabase website):

1. Open https://supabase.com/dashboard/project/mvbxlebznlgroptwwdsm/settings/compute-and-disk
2. Under **Compute size**, the current value is **Micro**. Choose **Small**.
3. Read the price the page shows, then click **Confirm** (or **Save changes**).
4. The database restarts for about two minutes. Do it when no fight is running. To go back later, repeat with **Micro**.

## Supabase health (hosted, read-only)

| Advisor | Count | Note |
|---|---|---|
| Leaked-password protection | off | Turn on: https://supabase.com/dashboard/project/mvbxlebznlgroptwwdsm/auth/protection → "Prevent use of leaked passwords" off → on (may need the Pro plan) |
| `SECURITY DEFINER` functions callable by anon | 20 | mostly public read functions by design; `attach_bug_screenshot` is worth a look |
| Unindexed foreign keys | 21 | none on the hot poll paths found |
| Unused indexes | 84 | not removed: the hosted stats window is short and includes few event days |
| Multiple permissive policies | 11 | |
| RLS on with no policy | 109 | intentional private tables |
| `pg_net` in public | 1 | |

Also seen: cron job start-up timeouts during the 30 Oct peak, and `pg_timezone_names` reads averaging 580 ms (372 calls).

## Contradictions

| Requested | Documented | App behaviour | Tested against |
|---|---|---|---|
| Camera Off first on the Command Centre | Pack 18.1 (comment in `LiveOps.tsx`) | Inside the collapsed "Event tools and details" for organizer Live ops (devices still show it in their top bar) | `e2bc09a`, local |
| Device access "ends Mon 00:00" | `device-live.mjs` §22 | Ends Sun 23:00 on the weekend daylight saving ends (24 real hours) | `e2bc09a`, local |

## Verified

- Local: all results in the tables above, on the branch.
- Hosted, read-only: function definitions match the repository; health numbers above.

## Not verified, and why

- Production browser checks (all 12 parts of `CODEX_FULL_SITE_REHEARSAL.md` on buhurt-os.app): NOT RUN, the site is blocked from the cloud
  container. Run `buhurtos-full-test` on the owner's PC.
- The migration on hosted: not applied (needs Garrett's go). Its effect on hosted is estimated from the local bench, not measured.
- Physical phones and real radio conditions.
- The checks inside the 25 outdated rehearsal scripts after the point where each stopped.

## Synthetic records created

Local throwaway databases only (`bos_sweep`, `bos_bench*`, `bos_gate*`, and one per rehearsal). Nothing on hosted.

## Real records changed

None.
