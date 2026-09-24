# BuhurtOS handoff

Updated: 2026-09-24. Current milestone: Pack 1, Recover and Stabilize.

## Saved state

- Repository: `dothecoolwip1/BuhurtOS`.
- Branch: `pack-1-recover-stabilize`.
- Starting main commit: `32240b2d6b8130a317ce5815a09e6d52d1bcac11`.
- First saved milestone: `a6f6d2281e694500122d67f942952e2815943bd7`, deterministic installation and bounded CI.
- Application repair milestone: `18d5be14fcc6959e1265c69fc136d231b0b7e4e7`, shell cache isolation, event navigation and regression/browser checks.
- Latest saved implementation/verification commit: `b072c8eb7c87cb3257a42495dbdf371999023415`, corrected Pages-mode browser preview and fail-fast limit.
- This handoff and the status/plan are saved in a subsequent documentation commit. Resolve its exact SHA with `git log -1 --format=%H -- docs/BUHURTOS_HANDOFF.md`; a document cannot contain its own commit hash.
- Review: https://github.com/dothecoolwip1/BuhurtOS/pull/3 (draft; no merge or production deployment performed).
- Existing recovery branches and exact tips are retained in PLAN. No source replacement, history rewrite on GitHub, force push, migration rewrite or production database mutation occurred.

## Checks performed

1. Inspected branches, clean cloned state, recent commits, README, original scope, package/configuration files, route definitions, auth/data/queue code, all migration inventory and CI job logs. Found no repository AGENTS instructions.
2. Reproduced absent lockfile with `npm ci` before repair. Reinstalled from the resulting committed lockfile with Node 24.19.0 / npm 11.9.0.
3. Reproduced six service-worker isolation/fallback regressions and the event navigation regression before changing those implementations.
4. Final local `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and Pages-mode build passed. Vitest: 5 files, 15 tests. Existing dependencies remain pinned; added pinned Node types and Playwright for verification.
5. Local preview starts when bound to `127.0.0.1`; binding all interfaces fails in this runtime's network-interface lookup. Local Chromium launch is blocked by denied sockets. Agent-browser daemon and direct Playwright diagnostics confirmed this environment restriction; no local visual pass is claimed. A same-process HTTP check confirmed that Pages assets return JavaScript in Pages preview mode; the initially mismatched preview mode returned HTML and was corrected.
6. CI baseline run `35930637116` passed build and 35 pgTAP assertions against the twelve timestamped migrations. New branch CI details are recorded in STATUS.
7. No configured live Supabase test environment was identified. Production login, real account permissions, Edge Functions, payment and live persistence remain unverified. Existing Pages deployment is demo configuration.

## Outstanding work

The implementation is deliberately limited to baseline stabilization. Missing waiver/checkout functions, showcase-only controls, auth/recovery gaps, offline account isolation, field concurrency and authoritative rankings are mapped to acceptance gates in PLAN. Do not infer completion from old commit messages or visible UI.

No unrelated user changes were found or overwritten. GitHub source saving used the connected GitHub API because this shell had read access but no push credential. Local milestone commits were aligned to identical remote trees with soft ref updates; the working files were preserved.

## Exact next action

Start Pack 2 from this branch, or from main only after PR 3 has been merged:

```bash
git fetch origin
git switch pack-1-recover-stabilize
git status --short --branch
git log -3 --oneline
npm ci
npm run typecheck
npm test
```

Read STATUS and PLAN, confirm PR CI is green, then identify the intended BuhurtOS Supabase project using repository/deployment evidence. Establish disposable authenticated accounts for two organizations. Reproduce password/magic-link callback, role-load failure, account switching and queue ownership behavior before porting selected auth/recovery code from `origin/mega-pack-1-foundation`. Do not copy that branch's migration directory. If backend identity/configuration remains unavailable, work on isolated auth/queue regression fixtures and record the missing live evidence.
