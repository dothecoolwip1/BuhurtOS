# Agent skills for BuhurtOS

Seven skills are installed in this repository, project-scoped, for both Claude Code and Codex:

| Skill | Source | Claude Code | Codex |
|---|---|---|---|
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | `.claude/skills/web-design-guidelines/` | `.agents/skills/web-design-guidelines/` |
| `vercel-react-best-practices` (React Best Practices) | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | `.claude/skills/vercel-react-best-practices/` | `.agents/skills/vercel-react-best-practices/` |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | `.claude/skills/frontend-design/` | `.agents/skills/frontend-design/` |
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | `.claude/skills/webapp-testing/` | `.agents/skills/webapp-testing/` |
| `supabase` | [supabase/agent-skills](https://github.com/supabase/agent-skills/tree/main/skills/supabase) | `.claude/skills/supabase/` | `.agents/skills/supabase/` |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills/tree/main/skills/supabase-postgres-best-practices) | `.claude/skills/supabase-postgres-best-practices/` | `.agents/skills/supabase-postgres-best-practices/` |
| `buhurtos-rehearsal` (ours) | this repository | `.claude/skills/buhurtos-rehearsal/` | `.agents/skills/buhurtos-rehearsal/` |

The six official skills were installed on 2026-10-31 with the [`skills` CLI](https://github.com/vercel-labs/skills) 1.7.4, which is the method
the Vercel and Supabase READMEs document (`npx skills add <owner>/<repo>`), and is the skills.sh installer linked from the Anthropic README:

```bash
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --skill vercel-react-best-practices -a claude-code -a codex --copy -y
npx skills add anthropics/skills       --skill frontend-design --skill webapp-testing                -a claude-code -a codex --copy -y
npx skills add supabase/agent-skills   --skill supabase --skill supabase-postgres-best-practices    -a claude-code -a codex --copy -y
```

`--copy` writes real files instead of symlinks so the checkout works on Windows. `skills-lock.json` records each skill's source and content
hash. To update later: `npx skills update -p` (project skills), then review the diff before committing.

The files under these six folders are the upstream skills, unchanged. **Do not edit them**: an update would overwrite the edit. The
BuhurtOS-specific way to use each one is below; it takes precedence over a skill's generic advice, and `CLAUDE.md` takes precedence over both.

## How to use each skill in BuhurtOS

**Web Design Guidelines** (`web-design-guidelines`): audits of accessibility, forms, focus handling, dialogs, touch controls, navigation and
error messages. It fetches Vercel's current guideline list from GitHub each time. Pair its code review with measurements in the running app:
horizontal overflow (`scrollWidth` against `innerWidth`) and target sizes, using
`.agents/skills/buhurtos-rehearsal/scripts/measure-layout.js`. Phone action targets must be at least 44 px high (owner acceptance).

**Frontend Design** (`frontend-design`): visual hierarchy, spacing, typography and responsive layout. BuhurtOS is a tournament operations
tool: readable scores, an obvious next action and one-handed phone use come first. Keep the existing identity (`src/styles/`, existing
components). The skill encourages distinctive aesthetics; here that means clarity, not decoration. Never add a decorative redesign that
competes with scoring controls, and follow `src/CLAUDE.md` ("avoid broad visual rewrites").

**React Best Practices** (`vercel-react-best-practices`): review data fetching, rendering, state and performance. BuhurtOS is **React 19 +
Vite + React Router**, not Next.js. Apply the client-side rules (waterfalls, re-renders, memoisation, bundle size, effects); skip rules about
Server Components, Server Actions, `next/*` APIs, RSC caching or route handlers, and never migrate frameworks because the skill mentions one.

**Supabase** (`supabase`): Auth, device sessions, Realtime, role permissions, RLS and client integration. Pay attention to several desks and
counter phones staying current: Realtime is a refresh signal and polling is authoritative (`docs/runbooks/COUNTER_RECOVERY_REQUIREMENTS.md`
§9). The skill's SSR/Next.js parts do not apply. Supabase stays the backend (`CLAUDE.md`); migrations are additive and must carry in-flight
state.

**Supabase Postgres Best Practices** (`supabase-postgres-best-practices`): query performance, connection pressure, transaction contention,
locking and RLS efficiency. Base proposed fixes on evidence (EXPLAIN, logs, lock waits, advisors) and say what the evidence is. Browser lag
alone does not prove a database problem. Never change hosted settings or apply a migration without the owner's go.

**Webapp Testing** (`webapp-testing`): repeatable regression tests, screenshots, console and network evidence. Its default is headless
Chromium against a local server, which is **not** the live Edge rehearsal. For local automated tests prefer the repository's own harness
(`scripts/e2e/*-live.sh`: real local Postgres + PostgREST + built app, Playwright via `playwright-core`) and the read-only production checks
(`scripts/e2e/*-production-*.mjs`). Label results **Local automated** or **Production browser**, never mix them, and never stand in for
separate users with tabs that share one session.

**BuhurtOS rehearsal** (`buhurtos-rehearsal`): planning, running and reporting rehearsals on https://buhurt-os.app with synthetic TEST events,
the seven Edge profiles, sanitized evidence, Supabase health and suggested fixes. Its rules and references are in
`.agents/skills/buhurtos-rehearsal/`.

## Which skill for which job

- Design: `frontend-design` for layout and hierarchy, checked with `web-design-guidelines`.
- Development: `vercel-react-best-practices` for React code, `supabase` for Auth, RLS, Realtime and client calls.
- Database diagnosis: `supabase-postgres-best-practices`, with `supabase` for platform behaviour.
- Rehearsals: `buhurtos-rehearsal`, with `webapp-testing` only for local automated runs.

## Keeping the two copies in step

Claude Code reads `.claude/skills/`; Codex reads `.agents/skills/`. The folders must be identical; `scripts/skills/mirror.test.ts` (part of
`npm test`) fails if they drift. Edit `buhurtos-rehearsal` in `.agents/skills/` and copy it to `.claude/skills/`.
