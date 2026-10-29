# BuhurtOS production retest — 8ff52cd

Date: 2026-10-29 (America/Denver). Browser: Edge. Site: https://buhurt-os.vercel.app
Synthetic event only: TEST Outrance V26.4 Rehearsal 2026-10-28 (0081228a-e8d6-44b6-98a9-65cf5fe8dc7a).
Build footer verified: 8ff52cd · 2026-10-29 17:18 UTC. No app code, auth settings or migrations changed. Requested new competition setup and synthetic scoring were performed. All records preserved.

## Verdict

The old submitting-desk finalization bug is fixed in this run. Two requested checks fail: cross-desk setup completion and the Profight Rankings division filter heights. The optional genuine hidden-tab check remains unverified.

| Check | Result | Evidence |
|---|---|---|
| Profight finish on desk 1 | PASS | Immediately shows Result official, Man A by split decision, 18.67–19.33, and Appeals. No reload. |
| Desk 2 final result | PASS | Shows This fight is final with 18.67–19.33, not 19–19. |
| F04 desk-1 layout | PASS | 390×844: document scrollWidth 375; 1440×900: 1425. No page horizontal overflow. F04/F06/F07 captures. |
| Automatic round-ended popup | PASS | Round 1 already ended on load; popup opens. Live round-2 ending also opens Round 2 ended · confirm the score on both desks. |
| Popup contents and paper return | PASS | Sheets, Type in a paper sheet, normal Confirm or missing-phone head-marshal path, and Return for recount visible. Adding paper returns to popup. |
| Popup dismissal and confirmation | PASS | Escape leaves sheets on desk at both sizes. Confirm closes popup; it stays closed for that confirmed round. |
| Popup overflow | PASS | Phone scrollWidth 390 with popup; desktop 1440. Dedicated desktop P10/P11 captures confirm normal paper-only path. |
| Duel finish regression | PASS | Fixture 11465ab5-d6b5-4b34-a9bc-f2d45db63eeb now official, Man B wins 3–2. Result stays visible at both sizes. |
| New competition setup sync | FAIL | Observer still displays Set this Profight's division and format at least 16.185 seconds after Save, even though its header already says Division 2 · tournament. Writer correctly shows ready 1:30 clock. No reload. |
| Hidden-tab recovery | NOT VERIFIED | Supported keyboard Control+PageDown did not change tab active flags. Both previous document visibility observations and tooling make a genuine hidden/return transition unproven. No native Windows retry, which stopped earlier runs. Cross-desk paper updates did work without reload. |
| Call-log Void / Cite | PASS | Void with a reason: 44 px. Citation control Add the rule: 44 px. |
| Hold controls | PASS | What was checked textbox: 44 px. Cleared button: 44 px. Existing medic hold left uncleared. |
| Standard Rankings filters | PASS | Who, Scope, Organization, Season, Category, Division controls all 44 px at 390×844. Used NACL-test, not HACSA. |
| Profight Rankings Men/Women | FAIL | Both 40 px high at 390×844, below required 44 px. |

## Failure 1: Setup sync

New competition 5f5b19ee-4a63-403e-9dd7-ec1905887982; match 037908fc-7226-47e6-8bdc-0123c05b6b35; Field 3.
1. Open unset competition fight on two desks.
2. On desk 1 choose Division 2, Tournament, Men Heavyweight up to 105 kg, Save.
3. Desk 1 advances to ready 1:30 clock.
4. Desk 2's header updates to Division 2 · tournament, but setup form remains, with unset division/format choices, Open weight selected and Save disabled.
5. Still stuck after 16.185 seconds. Screenshots S01–S03 and DOM snapshots preserve evidence.

The automated wait for Start round 1 timed out; this is a harness diagnostic, not a displayed app error. No warn/error console entries were captured.

## Failure 2: Profight filter size

Rankings → Profight records → Men and Women. Each getBoundingClientRect().height = 40 CSS px, measured at innerWidth 390 and innerHeight 844. Standard Rankings filter controls measure 44 px. See T05 and target-measurements.json.

## Additional visual observation

On the second desk's desktop This fight is final card, the long Next fight button extends beyond the right edge of its card (F05). It remains within the page, so document overflow is false. This is separate from desk 1's passing F04 layout.

## Measurement notes

Screenshots are viewport captures, sometimes scrolled to relevant controls. Some early phone PNGs (P02–P05/P09) were clipped by the browser capture provider; clean active-tab repeats P13–P16 supersede their visual evidence, with all original DOM measurements preserved. DOM snapshots and steps.json contain measured viewport and overflow values. The submitting desk was recaptured while active after closing the observer to avoid distorted background screenshots. A New version ready banner appeared even while the footer showed 8ff52cd; no Update button was pressed, keeping the tested build consistent. No captured browser warn/error logs. Synthetic data do not appear in Profight records.

## Preserved records

- 410c6a88-99fb-4574-adb6-562b0f362a7a: final, Man A wins split decision, 18.667–19.333. Round 1 sheets Anna 10–3, Bea 3–10, Cara 10–3. Round 2 Anna 3–10. Both confirmed with reasons for deliberately absent test phones.
- 11465ab5-d6b5-4b34-a9bc-f2d45db63eeb: final duel 3–2, Man B wins.
- New competition 5f5b19ee-4a63-403e-9dd7-ec1905887982: TEST Pack29d setup sync. Setup saved Division 2 / tournament / heavyweight.
- New match 037908fc-7226-47e6-8bdc-0123c05b6b35: Field 3, rounds 1 and 2 each confirmed 10–9 from Anna paper (total 20–18), not finalized. One warning was added only to expose call-log targets and then voided with reason Synthetic touch-target measurement complete; warning was test-only. Audit record retained.
- New hold-display fixture e63d138c-cf79-42fc-b458-9b3ad356282f: Field 4, blocked by existing Woman A medic-check hold. Hold was measured, not cleared; no round started.
- Previous original test results and KO hold remain intact. No records deleted.

## Evidence

HTML gallery: pack29d-production-8ff52cd.html
PNG screenshots, DOM snapshots and JSON measurements: pack29d-evidence/
