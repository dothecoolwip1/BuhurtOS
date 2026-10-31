---
name: buhurtos-rehearsal
description: Plan, run and report a BuhurtOS tournament rehearsal or production browser check on buhurt-os.app with synthetic TEST events, the seven Edge profiles, evidence, Supabase health and suggested fixes. Use for any rehearsal, retest, dress rehearsal or live smoke check of scoring, counters, desks or Profight.
---

# BuhurtOS rehearsal

A rehearsal plays every tournament-day person against the live site and writes an evidence-backed report. It is a **testing task**: it observes
and records. It never fixes, migrates, deploys or tidies anything.

Read these before starting, every time (they change between runs):

1. The run prompt you were given (for example `docs/test-reports/2026-10-30/CODEX_FULL_SITE_REHEARSAL.md` or
   `CODEX_RETEST_seven-profile-fixes.md`). It decides which steps are requested.
2. `references/sources.md`: which documents are the authority for rules and expected behaviour, and the known contradictions.
3. `references/profiles.md`: the seven Edge profiles and how roles map onto them.
4. `references/test-cases.md`: the maintained case list for tournament behaviour, reliability and layout.
5. `references/report.md`: the report layout, evidence names, JSON shapes and the closing message for Claude.
6. `references/supabase-health.md` when log access is available.

Rules in this file marked **(documented)** come from the repository or the owner's written request; rules marked **(assumption)** are this
skill's best reading where nothing written decides it. When the run prompt, a rules document and the app disagree, report the contradiction
(see "Contradictions" below). Never silently pick one.

## 1. Scope and safety (documented, owner request 2026-10-31 and the run prompts)

- Production rehearsals use only events created with the **Test event** box ticked, or the preserved synthetic fixtures named in the run prompt.
- Every event, fighter and team you create has a name starting `TEST ` (for example `TEST Full Rehearsal 2026-11-02`, `TEST Outrance Man E`).
  Older fictional fixtures such as "Red Deer Rumble-test" predate this rule: read them, never rename or "fix" them.
- Never edit, register into, score, delete or otherwise change a real event (for example Red Deer Rumble 2026), a real fighter, a real team
  (for example Red Deer Reavers) or any HACSA profile. Reading their public pages is allowed.
- Preserve synthetic fixtures, journals and results. Delete nothing. A fighter with a permanent KO hold (currently **TEST Outrance Man A**) is
  not entered again.
- Never print, paste, save or screenshot unredacted: passwords, sign-in codes, device tokens, account ids, QR session links. Describe them
  ("QR for Counter 3"). Redact before saving a screenshot or log; if a screenshot cannot be redacted, do not save it and say so.
  Public record ids (match ids, public fighter page URLs) are not secrets.
- During a testing-only task do not change app code, schema, migrations, auth settings, Supabase settings, Vercel settings or global app
  settings, and do not deploy.
- Do not write to the database by any route other than the application UI as an authorized role: no SQL connector writes, no RPC calls from a
  console, no REST calls with a copied token. Read-only database or log queries to confirm a result are allowed when the run prompt allows them.
- Suggested fixes and illustrative code in the report are recommendations only. They are never permission to apply, merge or deploy anything.
- Updates during a running event are legitimate (CLAUDE.md). If a new build appears mid-run, record it and carry on; do not stop the rehearsal
  because the site changed, but do not mix evidence from two builds under one PASS.

### Preflight (do this before step 1, and stop if any fails)

1. Open https://buhurt-os.app, read the footer `v0.1.0 · … · <commit>`, record it with the UTC time. If the run prompt names a minimum build and
   the footer is older, stop and report that.
2. Confirm each profile you need is signed in to the expected account (or signed out), and record it in the profile table.
3. If the run needs a new test event: as the organizer, open https://buhurt-os.app/events/new. If it shows "Event creation is for approved
   organizers", stop the event-dependent parts, mark them NOT RUN with that exact text, and list it as an owner action. Do not reuse a preserved
   fixture to work around it unless the run prompt says to.
4. Confirm you have the owner-provided accounts the run needs (head marshal, medic, announcer, fighter, captain, brand-new person). A missing
   account makes its steps NOT RUN, never "passed by another role".

## 2. Browser sessions and evidence (documented)

- Interactive production rehearsals use **Microsoft Edge** and the **seven existing Edge profiles**. Do not create new profiles unless the
  owner asks. The default mapping is in `references/profiles.md`; record the mapping you actually used.
- Organizer, secretary and every concurrently active counter each have their own profile. Two tabs of one profile share one session: that is
  "two tabs, one person" (a requested case of its own), never a substitute for two people.
- When a profile changes role, record the time, the sign-out, the sign-in as which role (by role name, never by account id) and confirm the
  previous role's screens are closed.
- Viewports: phone **390×844**, tablet **820×1180**, desk **1440×900**. Say in the report that viewport and touch emulation is not a physical
  phone or tablet (radios, battery, iOS background behaviour and real touch are untested).
- Record the deployed build and UTC time for every step.
- Take one screenshot at each PASS or FAIL point, after redaction. Name it `<step>-<short-name>-<viewport>.png` (for example
  `8.3-ko-official-desk.png`).
- For every failure copy the exact on-screen text, and the sanitized request: RPC or path name, HTTP status, time and duration (strip query
  tokens, `apikey`, `Authorization` and any id that identifies an account).
- A PASS from an earlier run is never evidence for this run. Re-run it or mark it NOT RUN.
- If browser control fails (cannot switch tabs, cannot set Offline, `document.hidden` stays `false`, a profile will not open), record the
  limitation and mark the step NOT RUN or "NOT VERIFIED: <limitation>". Never claim it passed and never bypass a browser-control or site
  permission restriction.

## 3. Uncertain outcomes on score actions (documented, run prompts)

Before retrying any score, sheet, clock or finish action, **read the current screen** (both desks if two are open) and decide from what it
shows. Retry at most once without reading again. Never tap repeatedly on an uncertain outcome: a duplicate tap on a live scoring screen is a
sporting-integrity risk, and the duplicate-protection behaviour is itself under test.

## 4. Running the cases

Work through the steps of the run prompt in order, using `references/test-cases.md` for the detailed expectation of each case (tournament
behaviour, reliability, layout and simplicity). For each step write PASS, FAIL or NOT RUN with UTC time, build, role, profile, viewport and
evidence names. Measure layout with `scripts/measure-layout.js` (paste into the DevTools console of the page under test, or run through the
browser-control tool's evaluate function); it is read-only.

Local automated tests are a different kind of evidence. The repository's harness (`scripts/e2e/*-live.sh`, a local Postgres + PostgREST stack
with Playwright) and the `webapp-testing` skill's headless Playwright pattern prove app logic against a local or mocked backend. Label those
results **Local automated** and production Edge results **Production browser**, in separate sections, and never report one as the other.

## 5. Supabase health

Follow `references/supabase-health.md`. If read-only log access is not available, mark the whole health section **NOT RUN** with the reason.
Never infer database health from a few screens that loaded, and never infer a database cause from browser lag alone.

## 6. Findings and suggested fixes

For every FAIL write:

- expected (with its source: run prompt, rules document or owner decision) versus observed;
- reproduction steps, role, profile, viewport, build and UTC time;
- exact error text and evidence filenames;
- severity (`P1` sporting integrity or data loss on the day, `P2` blocks or slows a tournament-day workflow, `P3` cosmetic or wording) and the
  practical tournament-day impact (assumption: this scale is this skill's, aligned with the "Priority rule" in
  `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`);
- the likely cause, labelled **Hypothesis** unless you verified it in code, data or logs;
- a suggested fix with code and file/function references, why it addresses the observed failure, and a regression test that would catch it.

Open the actual implementation (`src/`, `supabase/migrations/`, `supabase/functions/`) before calling a code suggestion repository-specific.
Otherwise label it **Illustrative, not checked against the code**. A suggestion is never applied during the rehearsal.

## 7. Report and handoff

Write the report as described in `references/report.md`:
`docs/test-reports/<YYYY-MM-DD>/full-rehearsal-<build>.md` (use the run's own name, for example `retest-<build>.md`, for a narrower run), with
an HTML companion, sanitized screenshots and JSON layout measurements under `docs/test-reports/<date>/<report-name>-evidence/`.

Commit only the report and its evidence to a `codex/` branch (for example `codex/full-rehearsal-2026-11-02`) when the run prompt or owner has
authorized uploading reports. Push, then open the GitHub URLs and confirm each file is there before giving the links. If you cannot confirm,
say the upload is unverified. Do not merge the branch.

Finish with the copyable message for Claude from `references/report.md`. A run with any FAIL or NOT RUN is a **partial run**: never describe
it as an all-tests pass.

## Contradictions

When the requested test, the documented rule and the app behave differently, write a row in the report's "Contradictions" table: what the run
prompt asked, what the rules document or owner decision says (file and section), what the app did, and which one you tested against. Known
contradictions at the time of writing are listed in `references/sources.md`; re-check them, they may have been resolved.
