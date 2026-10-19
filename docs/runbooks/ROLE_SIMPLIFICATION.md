# Event role simplification — verification and rollout

Implemented with Codex integration and Claude Code backend work and review, October 19, 2026.

## Behavior

- Organizer Live ops puts Lysts first. Event administration remains available under Event tools and details. Explicit lineup edit mode supports drag/drop, Up/Down, Save/Cancel and reasoned entrant replacement. Server-owned editable sets, queue snapshots, row locks and audited writes protect concurrent changes and sporting history.
- Secretary Event Control shows current, next and in-the-hole fights. Scoring supports submitted-score acceptance, an audited return for recount, manual awarded scores, marshal calls and clock controls. Organizer tools are denied at the database boundary as well as hidden in the UI. Team rounds retain the group board with clock and marshal-call controls.
- Counter tap UI is unchanged. Offline taps, tally evidence, QR assignment and automatic next-fight following remain supported.
- Announcer emphasizes current/next names, teams and recorded fighting start year. Extra queue/results are collapsed. Missing experience is omitted.

## Evidence

- Unit suite: 1,422 passing, six existing skipped tests; production build and TypeScript pass.
- Actual Chromium role rehearsal against disposable PostgreSQL, PostgREST and the real device-session handler: 29 checks pass. Includes reorder, cancel, replacement, scorekeeper restrictions, Counter QR, offline taps/reconnect, recount preservation, manual override reason, warning, official result, next-fight handoff/reload, team clock without counters, announcer team/experience, and responsive overflow checks.
- Public audit: 46 route/viewport visits at 390, 768 and 1280 pixels, including actual public team, fighter, event and organization details. No uncaught JavaScript errors, load errors or horizontal overflow after the calendar fix.
- Classic scoring browser regression: 28 checks pass. Classic fixtures use marshal roles; secretaries intentionally enter the simplified Lyst workflow.
- New permission/integrity gates: secretary boundary 81 checks; organizer lineup 61 checks, including restricted editable reads, stale snapshots, immutable history, eligibility and audited replacement.
- Full fresh database regression, simulation, concurrent commits and GitHub CI must be green before merge/deployment. Record the exact commit and workflow in the PR.
- Claude final integrated review: findings about permanently stale lineups, field-name rewriting and encoding resolved; no blocking findings. Reviewed code only, not hosted behavior.

## Reproduce

`npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

Run `supabase/tests/run_all.sh` only against a disposable local PostgreSQL database using its local-host guard. This replays migrations, all SQL gates, tournament simulation, fictional league, concurrent mutations and schema fingerprint.

For the new browser rehearsal, seed `scripts/e2e/fixtures/role-simplification.sql` after migrations into a disposable local database. Serve `scripts/e2e/localstack.mjs`, PostgREST and Vite with that database. Set local-only `JWT_SECRET`, `CHROME`, `E2E_BASE` and `E2E_API`, then run `node scripts/e2e/role-simplification.mjs`. The script refuses a non-local API and writes a JSON report/screenshots outside the checkout by default.

## Rollout

Apply `20261022000100_secretary_boundary.sql`, then `20261022000200_organizer_lineup.sql` to the existing BuhurtOS Supabase project. Anchored function patches fail closed on unexpected definitions. Migrations add functions/evidence and change permissions; they do not rewrite active match, timer, session or counter rows. Shared Steel & Tape and Reavers data must remain untouched.

Review both migrations, the device function allowlist and fingerprint together. Apply the backend before the frontend, merge only the verified SHA, respect the repository release freeze and verify the serving build and hosted function definitions afterward. Legacy secretary organizer-only actions will be denied during transition; in-flight scoring remains reachable.

## Limits

Chromium phone/tablet emulation is not physical iOS/Android testing. Local role rehearsals use real database/RPC logic with minimal fixture authentication and polling fallback, not hosted Supabase Realtime or real radios. Offline awarded scores can be refused if counters later submit conflicting totals without an override reason; the durable outbox retains the refusal for correction. Entrant replacement blocks active-fight collisions; it does not solve every future schedule conflict. A Lyst/clock's current fight remains accessible to secretary staff even if a legacy queue state disagrees, preserving in-flight compatibility.
