# Maintained rehearsal cases

Each case has an id, what PASS looks like, and where the expectation comes from. "Last seen" is history from earlier reports, for
orientation only: it is never evidence for a fresh run. Exact quoted texts come from the run prompts and earlier reports; if the app shows
different wording, record the exact wording and whether the meaning matches.

Sources: **FR** = `CODEX_FULL_SITE_REHEARSAL.md` part.step, **RT** = `CODEX_RETEST_seven-profile-fixes.md` item, **OD** = owner decisions,
**P29** = `PACK_29_OUTRANCE.md`, **CR** = `COUNTER_RECOVERY_REQUIREMENTS.md`, **OR** = owner request 2026-10-31.

## T. Tournament behaviour

| Id | Case | PASS | Source | Last seen |
|---|---|---|---|---|
| T01 | Event creation | New Event with **Test event** ticked; review step says private/test; venue, date, fee, window, waiver save | FR 3.1 | FAIL 4c78d57: "Event creation is for approved organizers" |
| T02 | Test badge | Test data badge on the event wherever it is shown, desk and phone | OD synthetic data | evidence only (pack29c `00/01-test-badge`), status not restated here |
| T03 | Publication and privacy | Published test event: signed-out direct URL is Not found; absent from search, rankings and every fighter's career; checked before and after publishing | FR 2.4, 3.4 | not run |
| T04 | Registration | Fighter registers, accepts waiver (verbatim HACSA text with a version), emergency info; shows in My events / My next fight. Twice, after window, unticked waiver each refused clearly | FR 4.1–4.4 | not run |
| T05 | Check-in | By code; by hand for a fighter without an account; weapons/safety check if offered; nobody types anything twice | FR 4.6 | not run |
| T06 | Staff roles and removal | Head marshal, medic, announcer get roles on this event only (no role on any other event). A removed duty disappears within seconds without reload | FR 3.3, 5.5 | not run |
| T07 | Duel scoring per weapon | One phone match and one classic scoreboard + paper match for each of Longsword, Sword and Shield, Sword and Buckler, Polearm. Points per zone match `src/lib/tournament.ts` and the BI duel rules | FR 6 | partial (longsword only) |
| T08 | Longsword pads | +2 pad shows **+2** and **Head or torso, two hands**; +1 pad shows **Arm, leg, hand, or one-handed**; accessible name of +2 contains "two hands"; +2 adds two; +1 adds one; Undo removes the last; totals match desk | FR 6.1, RT 5 | fixed in 3aab7f9, not retested |
| T09 | Automatic round-end dialog | Opens by itself on desks and phones; each phone confirms; desk awards with a reason when counts disagree | FR 6.2 | PASS 8ff52cd (pack29d) |
| T10 | Stale phone notice | "Score confirmed. Wait for the next round." and "Sheet handed in. Wait for the next round." disappear without a tap at next round start and after the result | FR 6.2, RT 5 | FAIL d90be08, fixed in 3aab7f9, not retested |
| T11 | Duel end conditions | Regular rounds then lead requirement then extra rounds; never a draw; buckler round and match rules | FR 6.3 | check against rules (C-table) |
| T12 | Discipline | Reprimand points shown apart from round score; warning → yellow → red; voiding the second yellow voids the red | FR 6.4, RT 8 | not run |
| T13 | Technical win | No-show before any round needs a reason; scored as the rules say | FR 6.5 | not run |
| T14 | Phone submission | Every expected phone submits; desk shows who it is waiting for | FR 6.2, CR §3 | PASS d90be08 |
| T15 | Missing phone | Fewer counters (2 phones) and none (paper only): desk says what it waits for; a missing phone is excluded only by the organizer with a reason; secretary cannot | FR 6.9, 8.2 | PASS d90be08 |
| T16 | Paper-only operation | Classic scoreboard + paper sheet; result saves Official | FR 6.9, OD paper record | not run on all weapons |
| T17 | Profight criteria order | Grappling → list control → aggression → defence, stopping at first not Even; letters refused in number fields | FR 8.1, P29 §3.2 | PASS d90be08 |
| T18 | Sheet corrections | Fix needs a reason; corrected sheet replaces the old one on both desks without reload | P29, d90be08 | PASS d90be08 |
| T19 | Averaging and exact scores | Mixed phone and paper sheets average correctly; columns show whole numbers; result keeps exact values (for example 19.47–18.53) | FR 8.2, P29 §3.3 | PASS d90be08 |
| T20 | KO winner behind on points | Red leads R1 (confirmed); KO against Red in R2 before confirming; Finish offers only KO; **Blue wins by KO**, Official; real totals kept (Red ahead) on official screen and observer; never "The winner cannot have the lower score" | FR 8.3, RT 1 | FAIL d90be08 (HTTP 400 outrance_finish), fixed by 20261113000200, not retested |
| T21 | TKO / DQ winners | Div 2 TKO loses the round only, medic check before next round; Div 1 TKO ends the fight with a medic check on the loser; red card / DQ against the leader → trailing fighter wins by DQ | FR 8.5, 8.6 | Div 2 PASS d90be08; Div 1 and DQ not run |
| T22 | Permanent KO hold | Loser's next fight says "This fight cannot start yet" with no Cleared control | FR 8.3, RT 1 | PASS d90be08 |
| T23 | Medic-check clearance | Clearance only by an authorized role; record which role cleared (see C9) | FR 8.5 | organizer clear PASS d90be08 |
| T24 | No extra round after fight-ending call | Level after 2 rounds + KO: no "Start round 3" on any desk; an already-open second desk loses it within seconds without reload; if tapped, server refuses "this fight was ended by Knockout: finish the fight instead of starting round 3…"; voiding the KO brings round 3 back | FR 8.4, RT 2 | FAIL d90be08, fixed 3aab7f9, not retested |
| T25 | Head marshal decision | Fight level after round 3 decided by head marshal | FR 8.7 | not run |
| T26 | Appeals | Competitor appeal within 5 minutes, corner within 15; one rejected, one upheld; late appeals refused citing the rule | FR 8.8, P29 §3.5 | not run |
| T27 | Official results and observer | Both desks Official; announcer page and arena/OBS overlay show the result; observer exact score | FR 6.6 | PASS d90be08 |
| T28 | Counter Last fight | Every phone's Last fight shows the exact final score | FR 6.6, RT 1 | PASS d90be08 |
| T29 | Next fight | One tap from the official screen; phones follow without reload; Next fight stays inside its card | FR 6.7 | PASS d90be08 |
| T30 | Team scoring | Fighters down per round, rounds to win; draw only in group stage on time; tie-breaks wins → head-to-head (2 tied) → round difference → organizer; team discipline totals | FR 7.1–7.3 | not run |
| T31 | Roster change | Substitute between fights shows on the desk before the next fight | FR 7.4 | not run |
| T32 | Finalization | Results appear on fighter and team pages inside the test event only; nothing in public rankings or statistics | FR 10.1, OD synthetic data | not run |
| T33 | Correction and void audit | Correct one result and void another, each with a reason; history shows editor, time, old, new, reason; nothing silently rewritten | FR 10.2, OD official results | not run |
| T34 | Closed event | Score, clock and registration on a closed event are refused clearly | FR 10.6 | not run |
| T35 | Test data exclusion | Real fighter `7c848b31-39db-453c-b2c4-7fa84982620f` Upcoming has no fictional event; TEST fighter still shows its fictional events with a badge; test results absent from rankings and aggregates | FR 2.2, RT 7 | real-fighter half PASS 4c78d57 |

## R. Reliability

| Id | Case | PASS | Source |
|---|---|---|---|
| R01 | Two desks without reload | An action on one desk shows on the other within seconds; record the measured delay | FR 9.8, d90be08 (setup sync about 5.7 s) |
| R02 | True background tab | Desk tab in the background 2 minutes while the other desk changes rounds; record `document.hidden`, `document.visibilityState` before, during and after, and seconds until current | FR 9.5, RT 8, C7 |
| R03 | Offline counter | Phone offline mid-round keeps tapping; back online every tap delivered **exactly once**; Saved counter evidence explains anything held | FR 9.2, CR §6–7 |
| R04 | Paper-sheet retry | Desk offline about 3 s on Add the sheet: either saves by itself, or "The server has not confirmed this sheet yet… cannot be counted twice"; Add again saves; one sheet per marshal on both desks | FR 8.10, RT 3 |
| R05 | Offline finalization | Finish while offline shows **Pending**, never Official; online it becomes Official once | FR 9.3, OD offline |
| R06 | Desk recovery | 30 s offline: "No signal"; chip "Scores sent" or "N pending", never "Synced" beside No signal; recovers within about 10 s without reload | FR 9.1, RT 4 |
| R07 | Slow connection | Slow 3G for a whole fight on one phone and P2: report spinners over 10 s and any error text | FR 9.7 |
| R08 | Lost response on finish | Finish on Slow 3G, press again if the answer seems lost: one Official result, never "you cannot run this lyst" | FR 8.11 |
| R09 | Conflicting results | Two desks save different results: second goes to Needs review; head marshal resolves it with a note; never last-write-wins | FR 9.4, OD offline |
| R10 | Role revocation | Removed duty disappears without reload; a revoked seat never regains access | FR 5.5, CR §7 |
| R11 | Wrong or expired QR | QR from another Lyst says where it belongs; QR from before a rebuild says it is no longer valid; never counts for the wrong fight | FR 5.4 |
| R12 | Late counter | Joins after round 1 started: shows current round, not counted for round 1, counts from round 2 | FR 6.8 |
| R13 | Tab reopening | Counter tab closed mid-round and QR reopened: same fight, no taps lost or doubled | FR 6.10 |
| R14 | Long session | Desk open over 70 minutes (past the 1-hour sign-in token), only when the run allows the time: never stuck on No signal needing reload | FR 9.6, RT 4 |
| R15 | Update prompt during scoring | New version offered mid-scoring waits ("It will not replace this version while a scoring screen is open…") | FR 9.9, OD service worker |
| R16 | Two tabs, one person | Same desk in two tabs of one profile: both correct, action in one shows in the other | FR 9.8 |

Uncertain outcome rule for every R case: read the current screen on every affected device before retrying a score mutation; at most one retry
without reading again.

## L. Layout and simplicity

| Id | Case | PASS | Source |
|---|---|---|---|
| L01 | Horizontal overflow | `scrollWidth <= innerWidth` on every screen used at 390×844, 820×1180 and 1440×900 | FR 11 |
| L02 | Target height | Every interactive action target on phone screens at least **44 px high** (owner acceptance). Report width too. A checkbox's input size alone does not decide its tappable area: measure the label | FR 11, OR, 4c78d57 note |
| L03 | Dialogs | Each dialog fits the viewport, has a clear action, focus moves into it and is usable by keyboard, Escape/close works where offered | OR |
| L04 | Reach | Primary phone actions within the bottom half at 390×844 | FR 11 |
| L05 | Blocking decisions | Important blocking decisions are explicit dialogs with a clear action, not inline text | OR |
| L06 | Compact status | Routine status is compact and inspectable (tap to see detail); no repeated warning paragraphs covering scoring controls | OR |
| L07 | Desk containment | Desktop cards, score columns and Next fight buttons stay inside their containers at 1440×900; nothing clipped | FR 11, d90be08 18-layouts |

Record measurements with `scripts/measure-layout.js` into `<report-name>-evidence/measurements.json`.
