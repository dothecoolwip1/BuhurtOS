# BuhurtOS

The operating system for armored combat (buhurt): events, registration, check-in and armour inspection, tournament building, Lyst Control (clock, rounds, marshal's call), counter phones, live and big-screen displays, official results and history, teams, fighters, rankings and the rules library.

Status (2026-10-07): **in use on the hosted Supabase project and GitHub Pages, being rehearsed before the Red Deer Rumble (Nov 14–15, 2026).** Everything up to Pack 25 is merged and deployed; the current state of each pack, what is on hosted and what was verified where is in `docs/claude-packs/STATUS.md`. Synthetic test events exist on hosted and are labelled "Test data" everywhere they appear; they never count in rankings or statistics.

## Stack
Vite, React 19, TypeScript (strict), React Router with real URLs, plain CSS on design tokens (light and dark), an installable PWA (manifest, service worker with a safe update flow). Backend: **Supabase** (PostgreSQL with row-level security, Auth, Realtime, Storage, one Edge Function for event device sessions). The database is authoritative for permanent sporting records; critical mutations go through controlled functions (`supabase/migrations`). Static hosting on GitHub Pages.

## Run it
```
npm install
npm run dev        # http://localhost:5173 (needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY)
npm run typecheck
npm test           # unit tests (vitest)
npm run build      # outputs dist/ with base /BuhurtOS/
```
Set `VITE_BASE=/` for a custom domain.

### The database gate and the real-stack browser suites (local only)
`supabase/tests/run_all.sh` builds a throwaway Postgres from every migration and runs every permission, integrity and concurrency suite (CI runs exactly this). The `scripts/e2e/*-live.sh` suites run the built app in real Chromium against a real local Postgres + PostgREST (`POSTGREST_BIN`), never against hosted Supabase; `scripts/e2e/pack26-live.sh` is the full tournament rehearsal. The mocked-Supabase browser checks (`field-pack03`, `sw-update`, `pack07-ux`, `pack08-entrants`, `pack12-app`) run in CI.

## Where things are
* `src/lib/` pure rules and view logic (tested): tournament maths, queue and running order (`eventDay.ts`), Lyst clock and counters (`lyst/`), finalization, the event journey, phase-aware views.
* `src/data/` the typed boundary to Supabase (RPCs and views).
* `src/pages/`, `src/components/` the screens: the public event (Overview / Live / Results), Event Control (Set up / Live ops / Results), the check-in desk, Lyst Control, the counter phone, the big screen, the announcer, the broadcast overlay, teams, fighters, rankings, rules, Platform.
* `supabase/migrations/` additive migrations; `supabase/tests/` the gates; `supabase/functions/` the device-session Edge Function.
* `docs/` the vision, the project spec, the owner decisions, one document per pack (`docs/claude-packs/`), runbooks for the day (`docs/runbooks/`).

## Deploy
`.github/workflows/pages.yml` typechecks, tests, builds, runs the database gate, the release policy and the browser checks, then deploys `main` to GitHub Pages. Migrations are applied to the hosted project deliberately, one at a time, as each pack's record says; nothing in CI touches the hosted database.

## Known gaps
* Two BI documents disagree on the Regional and Conference points multiplier. Both are shown; the owner decides.
* Group-fight rounds-to-win is a per-competition setting (the regulation's round structure is not in the app).
* Physical phones, iOS Safari and the hosted Realtime path are verified by people, not by the suites: see the runbooks.
* Not built: Stripe, native apps, a sync engine (deliberately, see `docs/ROADMAP_POST_RUMBLE.md`).
