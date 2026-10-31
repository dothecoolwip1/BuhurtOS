# Sources of truth and known contradictions

Re-read the files below at the start of each run. Cite the file and section in the report whenever an expectation comes from it.

## Order of authority (documented)

1. **The owner's current instruction** in the run prompt or thread. `CLAUDE.md` says current owner decisions override older assumptions.
2. **Project rules**: `CLAUDE.md` and `src/CLAUDE.md` (data safety, synthetic data, audit trail, mobile-first, verification).
3. **Owner decisions**: `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md` (synthetic data, Pending/Official, Needs review, paper fallback,
   safe app updates, realtime) and the dated owner sections inside packs, for example `PACK_29_OUTRANCE.md` §2 and §7 (2026-10-29).
4. **Official sporting rules**: Buhurt International release 2026-10-06 in
   `rules-library/buhurt-international/releases/2026-10-06/structured/`. Versions recorded in `overrides/`: Outrance, Duels and Duel
   regulations **V.26.4**, Buhurt rules **26.4.1**. They are in force in the app only once the platform owner publishes them (Platform › Rules,
   `/platform/rules`); the public `/rules` page shows what is published. BuhurtOS does not author rules (`rules-library/README.md`).
5. **How BuhurtOS implements the rules and runtime** (design documents, not rules):
   - Profight / Outrance: `docs/claude-packs/PACK_29_OUTRANCE.md` (sheet criteria, Round Score, Total Fight Score, win types, KO/TKO,
     medic checks, appeals, rule gaps the owner answered).
   - Duel and team scoring, categories and pads: `src/lib/tournament.ts` (`DuelCategory`, points per zone, `bucklerMatchFinished`),
     `src/lib/duelRules.test.ts`, `src/lib/lyst/counters.ts`.
   - Discipline (warnings, cards, reprimands, voids): `docs/claude-packs/PACK_22_RULES_DISCIPLINE.md`.
   - Tournament integrity, draws, versions: `PACK_02_TOURNAMENT_INTEGRITY.md`, `PACK_24A0_MATCH_SAFETY_GUARDS.md`.
   - Offline, Pending/Official, queues: `PACK_03_SCORING_RESILIENCE.md`, `docs/runbooks/COUNTER_RECOVERY_REQUIREMENTS.md`.
   - Lyst, counters, devices, QR sessions: `PACK_13_LYST_CONTROL.md`, `PACK_18_1_DEVICES.md`, `PACK_25_EVENT_CONTROL_AND_COUNTERS.md`,
     `docs/runbooks/PACK181_DEVICES.md`.
   - Finalization and history: `PACK_09C_FINALIZATION_CLOSEOUT.md`; identity, public data, stats: `PACK_05_IDENTITY_PUBLIC_DATA_AND_STATS.md`.
   - Screens, personas, interaction cost: `PACK_26_UIUX_MATRIX.md`; focus layout and 44 px targets: `PACK_24A1_FOCUS_LAYOUT.md`.
6. **Run prompts**: `docs/test-reports/2026-10-30/CODEX_FULL_SITE_REHEARSAL.md` (12 parts) and `CODEX_RETEST_seven-profile-fixes.md`
   (8 items). Copies are kept in the project files under `rehearsal-fixes-2026-10-30/`.
7. **Earlier reports** (evidence of what happened then, never evidence for a fresh run), on GitHub branches:
   - `codex/rehearsal-reports-2026-10-29`: `docs/test-reports/2026-10-29/pack29d…f-production-*.md`, `pack29f-suggested-fixes.md`,
     `test-events-production-77d93a0.md`, and `docs/test-reports/2026-10-30/domain-production-d90be08.md`, `seven-profile-rehearsal-d90be08.md`.
   - `codex/full-rehearsal-2026-10-30`: all of the above plus `docs/test-reports/2026-10-30/full-rehearsal-4c78d57.md`, with `-evidence/`
     folders (`measurements.json`, `18-layouts.json`).
8. **Real-device checklists** that a browser rehearsal cannot complete: `docs/runbooks/REAL_PHONE_REHEARSAL.md`,
   `docs/runbooks/PACK13_REAL_DEVICE_CHECKLIST.md`, `docs/runbooks/REAL_DEVICE_PUSH_CHECKLIST.md`.

If a run prompt states a sporting rule (for example "duels need a 2-point lead", "Sword and buckler: 5 points a round, 2 round wins",
"reprimand +3 to the opponent"), check it against the structured rule text and the implementation above. If they disagree, report the
contradiction; do not decide which is right.

## Known contradictions and gaps (check each again; they may be resolved)

| # | What | Sources that disagree | How to handle |
|---|---|---|---|
| C1 | Number of people versus profiles | Full rehearsal prompt lists P1–P12 plus E1–E7 and says "Create these Edge profiles"; the owner's 2026-10-31 request says reuse the **seven existing** profiles | Follow the newer owner request. Use `profiles.md`. Steps that need more simultaneous isolated people than profiles are NOT RUN, not simulated in shared tabs |
| C2 | Shared organizer cannot create events | Full rehearsal assumes `organizer@buhurtos.ca` can create a test event; run `full-rehearsal-4c78d57` was blocked with "Event creation is for approved organizers". Migration `20261114000200_test_organizer_create.sql` on main lets a test organizer create test events, but whether it is applied on hosted is not recorded here | Preflight step 3. Never confirm hosted state from the repository |
| C3 | "Show test data" signed out | Prompt Part 2.3 expects it signed out; `src/components/EventFilters.tsx` documented `showTest` as signed-in only in build 4c78d57 (commit `bab430f` on main changes this) | Test the deployed build, report which behaviour you saw |
| C4 | "No email addresses" on public pages | Prompt Part 2.1; public event pages may carry an organizer-authored payment contact email | Report organizer-authored public contact separately from leaked registration or account data |
| C5 | Touch target threshold | Owner acceptance is **44 px high** for phone actions; the local harness `scripts/e2e/lib.mjs` `measure()` counts controls under **32 px** | Use 44 px for rehearsal PASS/FAIL. Local harness numbers are not the acceptance check |
| C6 | Desk viewport | Owner requires **1440×900**; local harness desktop context is **1280×800** | Production browser checks use 1440×900 |
| C7 | Hidden-tab recovery | Requested as "true background"; earlier runs saw `document.hidden` stay `false` under browser control | Record `document.hidden` and `visibilityState`; if never `true`, NOT VERIFIED |
| C8 | `TEST` prefix | New records must start `TEST `; older fixtures use a `-test` suffix ("Red Deer Rumble-test") or a `-test` slug | Do not rename old fixtures. Report any synthetic record that is not visibly labelled as test data |
| C9 | Medic clearance | Prompt says "the medic (P8) must clear the check"; the 2026-10-30 seven-profile run passed with "organizer Cleared" | Record which role cleared. If the rule or app allows the organizer, note it; do not count an organizer clear as a medic-role check |
| C10 | Webapp-testing skill defaults | The `webapp-testing` skill launches headless Chromium with Python against a local server; the rehearsal is interactive Edge against production | Use it only for local automated tests, labelled separately |
