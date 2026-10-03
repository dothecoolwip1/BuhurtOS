# Event release policy and branch protection

Owner decisions (2026-10-03): protect `main` with required checks; freeze normal production deploys around the Red Deer Rumble (Nov 14 to 15, 2026);
emergency fixes stay possible. No freeze clock time has been set by the owner, so none is invented here: **the owner starts the freeze by setting one
repository variable.**

## What the repository already enforces (code)
`.github/workflows/pages.yml` has five jobs. `check` (typecheck, unit tests, production build), `database` (builds a database from every migration, then runs
`supabase/tests/run_all.sh`: all permission and integrity suites, the tournament simulation, the fictional-league verifier, the two-organizer concurrency
test, the shared SQL/TypeScript vectors and the schema fingerprint) and `browser` (real Chromium: scoring screen, offline queue, update safety) run on every
pull request and every push to `main`. The `deploy` job runs only on `main`, only after all three pass, and only if the `release-policy` job says production
is not frozen.

## Branch protection: the GitHub setting that makes the checks mandatory (NOT applied by Claude)
The tools available to the coding session cannot change repository settings, so this is a manual step for the owner (an admin of `dothecoolwip1/buhurtos`):
1. GitHub > the repository > Settings > Branches > Add branch ruleset (or classic rule) for `main`.
2. Require a pull request before merging. Require status checks to pass before merging, and select: `Typecheck, unit tests, build`,
   `Database gate (migrations from zero, permissions, integrity)`, `Browser tests (scoring, offline, update safety)`. Require branches to be up to date.
3. Block force pushes and deletion of `main`.
4. Optional but recommended: Settings > Environments > `github-pages` > Required reviewers = the owner, so even an emergency deploy needs a human click.
Until step 2 is done `main` is **not** protected (a direct push to `main` can still deploy, subject to the freeze variable below).

## The freeze
* **Before the freeze:** normal development and deploys continue.
* **Final pre-event release:** when the owner decides the code is ready, they (1) merge the final change, (2) confirm the `main` run is green and deployed,
  (3) run the real-phone rehearsal (`docs/runbooks/REAL_PHONE_REHEARSAL.md`) against that deployed build, (4) record the build number and commit in
  `docs/claude-packs/STATUS.md`, and (5) set the repository variable `PRODUCTION_FROZEN` to `true`
  (Settings > Secrets and variables > Actions > Variables). From then on a push to `main` still builds and tests but **does not deploy**; the run summary says so.
* **Lifting the freeze:** after the event weekend (and after the post-event database export), delete the variable or set it to `false`; the next push deploys.
* **Emergency fix during the freeze:** (1) fix on a branch, pull request, all checks green (do not bypass them); (2) merge to `main` (it will not deploy);
  (3) Actions > "CI and Deploy" > Run workflow on `main` with `emergency` ticked and a `reason` of at least 10 characters (the reason is written into the run summary);
  (4) approve the `github-pages` environment if reviewers are required; (5) verify the live build number, then tell the marshals. Devices in the middle of scoring
  are not forced onto the new build: they show "A new version is ready" and update when the marshal finishes, or at once via the explicit emergency button.
* **Database migrations during the freeze** are not applied by CI. Applying one is a deliberate manual act by the owner and should be treated like an emergency deploy.

## Compatibility during a deployment
Finalization commands carry a version (`public.submit_match_result`, window 1..1 today, `private.command_schema_ok`). A phone one build behind keeps working inside
the window; outside it the server refuses with a clear message and nothing is lost (the device keeps the board and queue). Policy: widen the window when a new
command version ships; do not narrow it before the event is over.
