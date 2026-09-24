# BuhurtOS verified status

Audit date: 2026-09-24. Milestone: Pack 1 recovery and stabilization complete within the audit scope; Pack 2 is next. This is not a completed production platform.

## Repository and recovery

Started at `main` commit `32240b2d6b8130a317ce5815a09e6d52d1bcac11`. No existing BuhurtOS checkout or uncommitted work was available in this workspace, so the existing repository was cloned with all remote branches. No `AGENTS.md` was present in the repository or workspace ancestry searched. README and `docs/ORIGINAL_SCOPE.md` were inspected. Existing source and migrations were preserved. Divergent branches are inventoried in PLAN rather than merged destructively.

## Repairs

- Reproduced `npm ci` failure: the prior “Generate deterministic dependency lockfile” commit only added lockfile logging to CI. Created and committed the actual lockfile without changing existing dependency versions. CI now uses `npm ci`, caches by lockfile and has bounded job timeouts.
- Reproduced six service-worker regressions before repair. Limited caching to same-origin public shell/assets; excluded authenticated, query-bearing and out-of-scope requests; preserved other apps' caches; purged old BuhurtOS shell caches; stopped returning HTML for unavailable scripts. Added regression coverage and explicit Node test types.
- Reproduced event selection loss in rendered navigation. All operations sidebar, utility, mobile and public links now carry the selected event query. Added a regression test and CI interaction coverage.
- Added desktop/mobile browser checks for 25 main routes, operations navigation and demo roster persistence. Corrected README deployment instructions to match the actual workflow.

## Evidence ledger

| Environment | Evidence | Result and limits |
| --- | --- | --- |
| Local baseline | `npm run build`, `npm test` at original source after dependency installation | Build passed; 3 files / 8 Vitest tests passed. This proves compilation and covered pure logic, not full workflows. |
| Local repaired source | `npm ci`, typecheck, root build, Pages build, regression suite | All passed. 5 Vitest files / 15 tests. |
| Local HTTP preview | Asset MIME check in one process | Pages preview mode serves the built JavaScript correctly. Default preview mode serves HTML at the prefixed asset URL; test harness corrected. No local browser pass. |
| CI repaired branch | Run `35941440716`, commit `18d5be1` | Database reset and 35 pgTAP assertions passed. Initial browser harness had a mismatched base path and failed; this was diagnosed and corrected. |
| CI browser audit | Run `35941794487`, commit `b072c8e` | 52 of 54 browser checks passed. Two failed because the setup route intentionally shows a demo configuration notice, not a heading. Assertion corrected to check that exact notice; the subsequent run below passed all browser checks. |
| CI baseline | GitHub Actions run `35930637116`, source `32240b2` | Quality, database and Pages deployment jobs succeeded. Database job logs show clean migration reset and 2 pgTAP files / 35 assertions passed. |
| CI final application verification | Run `35942005520`, commit `883d49b` | Clean install, typecheck, 15 unit tests, Pages build and all 54 desktop/mobile browser checks passed. Clean database rebuild and all 35 pgTAP assertions also passed. Deployment intentionally skipped for the pull request. |
| Database local | Docker and Supabase CLI unavailable | No local database reset performed. Existing CI database proof is for the unchanged timestamped migrations, not a live backend. |
| Backend configuration | `.env.example`; no local project credentials; connected Supabase discovery | One generically named project is visible, with no repository evidence establishing it as BuhurtOS. No live database was modified or tested. |
| Production | Existing Pages deployment job succeeded | No claim of authenticated production readiness. Workflow supplies no Supabase values, so its build uses demo data. |

Baseline CI: https://github.com/dothecoolwip1/BuhurtOS/actions/runs/35930637116

Final application CI: https://github.com/dothecoolwip1/BuhurtOS/actions/runs/35942005520

## What exists and what is verified

- React/TypeScript application with HashRouter, marketing/showcase navigation and operational pages.
- Tested pure scoring, compliance, bracket generation/progression, identity normalization/duplicate candidates and ruleset helpers. The core suite groups many assertions into one test, so test count is not feature coverage.
- Operational repository, RPC and permission integration for roster, matches, event setup, rulesets, identity, discipline and notes exists in source. Demo mutations use local storage; live integration still needs authenticated end-to-end proof.
- Twelve ordered migrations cover schema, RLS/RPCs, registration storage, hardening, auth/bootstrap, event administration, double elimination, realtime, rulesets and identity. Existing CI proves clean rebuild and the current 35 database assertions; it does not prove every cross-tenant permission or upgrade path.
- Showcase role selection is presentation state, not authentication. Showcase profiles, teams, events and rankings use fixture data independently of operational Supabase state.

## Blockers and release restrictions

1. Identify the intended Supabase project, deployment configuration, auth redirect allowlist and test identities. Live password/magic-link, RLS and data persistence are unverified.
2. Registration references two missing Edge Functions; payment and waiver upload must not be represented as complete.
3. Existing offline queue has no account ownership boundary and no durable live snapshot. Do not use it for live multi-user field operations until Packs 2 and 11 pass.
4. Divergent branch migrations must not replace timestamped migration history. Verify actual deployed history before any schema recovery.
5. Showcase actions and authoritative operational data must be connected in their owning packs. See PLAN for file-level evidence and acceptance gates.

Browser scope: 25 routes in desktop and mobile Chromium, plus selected-event navigation and demo roster persistence after reload. This does not verify real accounts, live database writes, third-party livestream availability, or every visible showcase control.

Current work preserves the existing design and functionality, fixes bounded baseline defects, and exposes later work honestly. It does not certify production use.
