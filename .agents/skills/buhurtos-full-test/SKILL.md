---
name: buhurtos-full-test
description: Test everything in BuhurtOS and log everything. Claude Code on the owner's PC drives seven separate Microsoft Edge sessions through the full start-to-finish rehearsal on buhurt-os.app, runs local checks, design, React and Supabase reviews, and writes a complete evidence log and report. Use when asked to "test everything", run a full test, or a complete rehearsal with full logging.
---

# BuhurtOS full test: test everything, log everything

This is the one-command version of BuhurtOS testing, run by **Claude Code on the owner's Windows PC** (directly or through a Remote Control
session). Cloud sessions cannot reach https://buhurt-os.app, so a cloud session stops at the preflight and says so.

It adds **no new permissions**. Every rule in `.agents/skills/buhurtos-rehearsal/SKILL.md` applies to every phase:

- synthetic `TEST` data only, and no real records;
- no secrets in any output;
- no app, schema or settings changes;
- no database writes and no deploys;
- the uncertain-outcome rule.

Read that skill and its `references/` first.

Default run prompt: `docs/test-reports/2026-10-30/CODEX_FULL_SITE_REHEARSAL.md` (all 12 parts). Add the items from
`CODEX_RETEST_seven-profile-fixes.md` that it does not already cover. Where those prompts say "Codex", read "Claude". A newer prompt from the
owner replaces both.

## Browser sessions: seven Edge sessions over Playwright MCP

`scripts/setup-edge-sessions.ps1` registers seven Playwright MCP servers for Claude Code, in local scope (this PC only). Each one drives its
own Microsoft Edge (`--browser msedge`) with its own profile folder under `%LOCALAPPDATA%\BuhurtOS-rehearsal\profiles\`. They are separate
browsers, so nothing is shared between them: no cookies, no storage and no sign-in.

| MCP server | Profile role (`references/profiles.md`) | Viewport | Signed in |
|---|---|---|---|
| `edge-organizer` | A, Organizer | 1440×900 (resize to 390×844 for the phone steps) | organizer test account, once, by the owner |
| `edge-secretary` | B, Secretary | 1440×900 | scorekeeper test account, once, by the owner |
| `edge-counter-1` … `edge-counter-4` | C–F, Counters 1–4 | 390×844 | never: QR only |
| `edge-guest` | G, Spectator, then each other role one at a time | 390×844 (820×1180 for the head marshal) | signed out by default |

- These are dedicated automation profiles, not the owner's seven everyday Edge profiles. Recent Chromium-based browsers, Edge included, refuse automation on
  the default profile folder, and a separate folder keeps a run from touching the owner's own browsing. Record them in the profile table by server name.
- The owner signs in once with the setup script's `-SignIn` switch. Claude never types, reads back or stores a password or a sign-in code.
  If a session is signed out when it should not be, mark its steps NOT RUN and ask the owner to sign in.
- For other roles (head marshal, medic, announcer, fighter, captain, a brand-new person), the owner signs `edge-guest` in when the step
  comes. Each change is logged as a role change.
- Two tabs of one server are one person ("two tabs, one person"). Never use them for two people.
- Use the browser tools only through the MCP server for the person being played. Use `browser_resize` for viewport changes, and
  `browser_console_messages` and `browser_network_requests` for evidence. If a tool can't do a step (for example going offline, or a truly
  hidden tab), log it as `limitation` and mark the step NOT RUN. Do not work around it.
- Viewport and touch emulation is not a physical phone. Say so in the report.

## Log everything (and what "everything" excludes)

Start the log before the first action. Every action goes in. That includes failed attempts, retries, waits, role changes, sign-outs,
tool limitations and anything skipped.

- `docs/test-reports/<date>/full-test-<build>-evidence/run-log.jsonl` has one JSON line per action:
  `{"utc","phase","step","case","server","role","viewport","build","action","target","result","text","evidence","note"}`.
  `result` is one of `ok`, `PASS`, `FAIL`, `NOT RUN`, `blocked` or `limitation`. `text` is the exact on-screen text when it matters.
- `console-network.jsonl` is filled after each step, from every server used. It holds every console error and warning, every failed
  request, every request slower than 3 s, and every request to the RPCs in `references/supabase-health.md`:
  `{"utc","server","page","kind","name","status","ms","message"}`.
- Take a screenshot for every PASS and FAIL, named `<step>-<short-name>-<viewport>.png`.
- `measurements.json` comes from `.agents/skills/buhurtos-rehearsal/scripts/measure-layout.js`, run with `browser_evaluate` on every screen
  visited.
- `profile-log.md` holds the session table and every role change.

"Everything" never includes secrets. Before writing any line or image, strip or redact passwords, sign-in codes, QR links, device tokens,
account ids, `apikey` and `Authorization` values, cookies and query strings. Do not save a screenshot that shows a QR code or a code. A line
that can't be cleaned is replaced by `{"result":"limitation","note":"withheld: contained <kind>"}`. Files that Playwright MCP writes to its
own output folder stay on the PC. Copy only cleaned evidence into the report folder.

## Phases

### 0. Preflight

1. Check that this is the owner's PC, `claude mcp list` shows the seven `edge-*` servers connected, and https://buhurt-os.app loads. If not,
   stop and report what is missing.
2. Then run the rehearsal skill's preflight:
   - the footer build and UTC time;
   - the sign-in state of each session, by role name only;
   - the event creation check;
   - whether read-only Supabase log access is available.

Log each check. A failed check makes the steps that depend on it NOT RUN, with the reason. Phases that don't depend on it carry on.

### 1. Local automated checks

1. Check out the commit shown in the footer in a separate worktree, and run `npm ci`, `npm run typecheck`, `npm test` and
   `npm run build`.
2. Run `scripts/e2e/*-live.sh` only if a local Postgres and PostgREST are available. Use the `webapp-testing` skill for any ad-hoc local
   Playwright check.
3. Record each command, its exit code and its pass/fail counts.

Label all of this **Local automated**, never production evidence. If a failure also happens on `main`, say so.

### 2. Production browser rehearsal

Run every part of the run prompt with the `buhurtos-rehearsal` skill, using the seven `edge-*` servers as the people. Log every action.
Mark every step PASS, FAIL or NOT RUN.

### 3. Design and accessibility audit (screens visited in phase 2)

- Check measurements: overflow at 390×844, 820×1180 and 1440×900; phone targets at least 44 px; dialogs fit and take focus; primary
  actions are within reach.
- Run `web-design-guidelines` on the components behind any screen that failed or looked wrong.
- Use `frontend-design` for hierarchy and spacing proposals that keep scores readable and the next action obvious. Proposals only, no
  redesign.

### 4. React review (code behind each failure)

Run `vercel-react-best-practices` on the components and hooks involved, for example `src/lib/lyst/useLystState.ts` or
`src/lib/lyst/pollRecovery.ts`. Apply Vite and React Router rules only; never suggest Next.js patterns.

### 5. Supabase and database health (read-only)

- Use `supabase` to explain the Auth, device-session, Realtime and RLS behaviour seen in phase 2, for example a desk that went stale, a
  revoked role or an expired QR.
- Follow `references/supabase-health.md` for the busiest 15 minutes.
- Use `supabase-postgres-best-practices` to reason about timeouts, lock waits and RLS cost from that evidence.

Without read-only log access, this whole phase is **NOT RUN**.

### 6. Report and handoff

1. Write `docs/test-reports/<date>/full-test-<build>.md` and its HTML companion, using the layout in `references/report.md`, with one
   section per phase.
2. Give the counts of log lines, screenshots and measurements, so the reader can see the log is complete.
3. Commit only the report and the cleaned evidence to a `codex/` branch, push, and confirm every GitHub link loads.
4. Finish with the copyable message for Claude, with one line per phase.

Any FAIL or NOT RUN makes this a partial run, never an all-tests pass.
