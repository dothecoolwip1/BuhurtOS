# Event role simplification — verification and rollout

Implemented with Codex integration and Claude Code backend work and review, October 19, 2026.

## Behavior

- Organizer Live ops puts Lysts first. Event administration remains available under Event tools and details. Explicit lineup edit mode supports drag/drop, Up/Down, Save/Cancel and reasoned entrant replacement. Server-owned editable sets, queue snapshots, row locks and audited writes protect concurrent changes and sporting history.
- Secretary Event Control shows current, next and in-the-hole fights. Scoring supports submitted-score acceptance, an audited return for recount, manual awarded scores, marshal calls and clock controls. Organizer tools are denied at the database boundary as well as hidden in the UI. Team rounds retain the group board with clock and marshal-call controls.
- Counter tap UI is unchanged. Offline taps, tally evidence, QR assignment and automatic next-fight following remain supported.
- Announcer emphasizes current/next names, teams and recorded fighting start year. Extra queue/results are collapsed. Missing experience is omitted.

## Evidence

- Unit suite: 1,422 passing, six existing skipped tests; production build and TypeScript pass.
- Actual Chromium role rehearsal against disposable PostgreSQL, PostgREST and the real device-session handler: 34 checks pass. Includes reorder, cancel, replacement, scorekeeper restrictions, Counter QR, offline taps/reconnect, recount preservation, manual override reason, warning, official result, next-fight handoff/reload, team clock without counters, standing counter taps/recount/round confirmation/reload, announcer team/experience, and responsive overflow checks.
- Public audit: 46 route/viewport visits at 390, 768 and 1280 pixels, including actual public team, fighter, event and organization details. No uncaught JavaScript errors, load errors or horizontal overflow after the calendar fix.
- Role rehearsal also passes all 34 checks against a production bundle, including team round recovery after reload.
- Service-worker update safety: 28 checks pass, including safe activation, emergency handover, durable outbox delivery and fallback recovery.
- Classic scoring browser regression: 28 checks pass. Classic fixtures use marshal roles; secretaries intentionally enter the simplified Lyst workflow.
- New permission/integrity gates: secretary boundary 81 checks; organizer lineup 61 checks, including restricted editable reads, stale snapshots, immutable history, eligibility and audited replacement.
- GitHub fresh database gate passed on the initial candidate, including all SQL suites, tournament simulation, fictional league, concurrent mutations and fingerprint. Final CI must also pass before merge/deployment. Record the exact commit and workflow in the PR.
- Claude final integrated review: findings about permanently stale lineups, field-name rewriting and encoding resolved; no blocking findings. Reviewed code only, not hosted behavior.

## Adversarial follow-up (October 19)

The follow-up found and repaired fresh-device team boards resetting recorded wins, missing submitted standing-count evidence for the secretary, simultaneous secretary starts, lineup eligibility changing between read and lock, round/Lyst writes racing finalization, announcer profiles failing to recover after an outage, and blank/case-varied field names splitting the queue.

- A group board reads confirmed Lyst rounds before reporting live scores. Repaired cached boards are saved and obsolete result command IDs cleared. An interrupted 0-0 round advances without inventing a winner. One known pending manual round is synchronized even without its clock; several missing winners require an audited paper result.
- The secretary can see and use submitted official standing counts, including evidence from a phone that subsequently loses signal. Finishing waits for round confirmation. The server independently checks team results against recorded rounds; manual scoring without Lyst rounds and audited organizer/head-marshal overrides remain available.
- Queue changes recheck the secretary's called window under the queue lock. Lineup saves synchronize with field opening and recheck eligibility after locking. Clock/round/open commands lock and recheck the match before changing a finalized fight. Result command IDs are serialized before proposal reads, preventing a simultaneous retry from inserting the same proposal twice. The migration patches whichever timer overload exists, preserving the hosted press-time correction and grants.
- Announcer profiles retry every 15 seconds and on reconnect/focus. Null/blank fields and mixed case use the same default-field grouping throughout the field screens.

Evidence: 1,431 unit tests pass (six existing skips); TypeScript and production build pass. The expanded real PostgreSQL/PostgREST/device-handler browser rehearsal passes 43 checks against a production bundle, including stale organizer drafts, offline counts, fresh-device recovery, holding the deciding-round confirmation in flight, manual deciding-round recovery and a sustained 20-second profile API outage. Five coordinated multi-session checks pass, including two secretaries starting, lineup versus Lyst opening, and both orderings of finalization versus a round writer; late Lyst opening cannot rebind phones to a final fight, and concurrent result retries through different scoring paths return one stored answer. The new SQL gate passes 79 checks, also against an isolated copy of the actual hosted press-time clock function. A hosted public sweep passes 46 route/viewport visits. Destructive cases run only on disposable local databases.

Apply `20261023000100_event_role_race_guards.sql` before publishing this frontend. It patches functions in place and adds two private guards; it does not reset or backfill sporting rows. Compare hosted function definitions and row hashes before/after. Candidate CI must replay the complete database gate and browser suite before merge. Hosted authenticated role flows, physical phones and real network/radio conditions remain outside the local rehearsal's evidence.

## Reproduce

`npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

Run `supabase/tests/run_all.sh` only against a disposable local PostgreSQL database using its local-host guard. This replays migrations, all SQL gates, tournament simulation, fictional league, concurrent mutations and schema fingerprint.

For the new browser rehearsal, seed `scripts/e2e/fixtures/role-simplification.sql` after migrations into a disposable local database. Serve `scripts/e2e/localstack.mjs`, PostgREST and Vite with that database. Set local-only `JWT_SECRET`, `CHROME`, `E2E_BASE` and `E2E_API`, then run `node scripts/e2e/role-simplification.mjs`. The script refuses a non-local API and writes a JSON report/screenshots outside the checkout by default.

## Rollout

Apply `20261022000100_secretary_boundary.sql`, then `20261022000200_organizer_lineup.sql` to the existing BuhurtOS Supabase project. Anchored function patches fail closed on unexpected definitions. Migrations add functions/evidence and change permissions; they do not rewrite active match, timer, session or counter rows. Shared Steel & Tape and Reavers data must remain untouched.

Review both migrations, the device function allowlist and fingerprint together. Apply the backend before the frontend, merge only the verified SHA, respect the repository release freeze and verify the serving build and hosted function definitions afterward. Legacy secretary organizer-only actions will be denied during transition; in-flight scoring remains reachable.

## Limits

Chromium phone/tablet emulation is not physical iOS/Android testing. Local role rehearsals use real database/RPC logic with minimal fixture authentication and polling fallback, not hosted Supabase Realtime or real radios. Offline awarded scores can be refused if counters later submit conflicting totals without an override reason; the durable outbox retains the refusal for correction. Entrant replacement blocks active-fight collisions; it does not solve every future schedule conflict. A Lyst/clock's current fight remains accessible to secretary staff even if a legacy queue state disagrees, preserving in-flight compatibility.
