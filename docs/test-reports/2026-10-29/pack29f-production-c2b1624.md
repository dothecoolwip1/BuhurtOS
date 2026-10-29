# Pack29f — remaining phone and desktop flows

Production: https://buhurt-os.vercel.app · app c2b1624 · 2026-10-29 (America/Denver).
Browser: Edge. Counter phone: 390×844. Organizer desk: 1440×900. Additional counter desktop capture: 1440×900.
Synthetic event only: TEST Outrance V26.4 Rehearsal 2026-10-28, event 0081228a-e8d6-44b6-98a9-65cf5fe8dc7a. The Test badge was confirmed in the immediately preceding Pack29e run. All records preserved. No application code, migrations, roles, auth settings or browser settings were changed. Viewport overrides were temporary.

## Verdict

Core phone submission, mixed sheets, exact final scores and Red/Blue duel flows work. Four UI defects were found, including a blocked Profight recount. Genuine hidden-tab recovery remains unverified because Windows refused native tab-switch input. This is a focused continuation, not a claim that every original A–H scenario was repeated.

## Results

| Journey | Result | Evidence |
|---|---|---|
| Counter QR sign-in on real production | PASS | Existing event Counter QR signs in, asks operator name, Lyst and Line marshal. No CORS error observed. QR secret intentionally excluded from uploaded evidence. |
| Line marshal strikes / undo | PASS | Nine Red strikes, add one Red takedown, Undo Red takedown restores takedowns to zero. Screenshot 02. |
| Automatic phone sheet | PASS | End round opens Round 1 · your sheet automatically, with own 9–0 tally and 10–9 result. No other marshal sheets on phone. Screenshot 03. |
| Phones plus paper | PASS | Two paper sheets plus phone submission arrive on desk without reload. 3 marshals, average 9.67–9.33. Before submission desk identifies the missing phone. 04–06. |
| Criteria order/stop | PASS (tested branch) | Round 2 zero strikes: Grappling Even moves to List control. Blue stops criteria and yields 9–10; no aggression/defence question after decisive answer. 09. |
| Recount after all sheets submitted | FAIL F1 | Recount demands a reason but no textbox exists. Exact error: Say why the round goes back to the line marshals. Screenshot 07. |
| Submitted sheet round identity | FAIL F2 | After round 1 confirmed and round 2 merely prepared, phone labels old 9–0/10–9 sheet Round 2: sheet handed in. Screenshot 08. |
| Profight final desk + phone Last fight | PASS for result data | Unequal sheets across rounds finish with Man C winning split decision, 18.67–19.33. Phone moves to waiting for next fight and displays exact score without reload. 10–11 and 23. |
| Final phone status wording | FAIL F3 | Stale Sheet handed in / Score confirmed: Wait for the next round contradicts Waiting for the next fight on both Profight and duel. 11, 21. |
| Prepared line-marshal identity | FAIL F4 | Prepared message says C vs A while heading/pads say A vs C. Source uses ordinary side-oriented names rather than canonical line-marshal names. 01, 08. |
| Corner appeal validation | PASS (validation only) | Synthetic corner appeal recorded within 15 min. Decision note alone does not enable Uphold; outcome is required. Appeal rejected with synthetic validation explanation, no result correction. 13. |
| Duel unprepared-phone start gate | PASS | Start paused popup with reason field and disabled override until entered. Waiting for phone preparation then retrying starts normally without override. 14. |
| Red duel confirm/edit | PASS | +2 and +1 => 3, automatic Confirm score/Edit score opens. Edit to 4 retained adjustment for marshal review; desk required reason. Awarded 4–0 after review. 15–16. |
| Blue duel count and retry | PASS with transient connection error | Same test phone switched to Blue for round 2. +2 retained during no signal. First Confirm failed with retained-count message; retry succeeded. Desk received 2, awarded 0–2 with no review reason. 17–19. This is sequential Red/Blue coverage, not two independent physical phones. |
| Duel final result | PASS | Desk official Man B 4–2; phone Last fight matches. 20–22. |
| Duplicate counter tab | PASS | Opening second counter tab displays ownership warning and prevents counting until Use this tab. No takeover performed. 22. |
| Phone navigation targets | PASS | New counter, Change side, Change Lyst, Stop counting all 44 px high. phone-targets.json. |
| Horizontal page overflow | PASS on captured states | 390-wide phone and 1440-wide desk captures have no measured horizontal page overflow. This does not prove every control is reachable one-handed on physical hardware. |
| Genuine background/foreground recovery | BLOCKED / NOT VERIFIED | Native Edge tab click failed: GetCursorPos failed: Access is denied. (0x80070005). DOM reported visible and is insufficient to certify actual hidden state. Do not mark this passed. |

## Suggested fixes

[Source-grounded code proposals, reasoning and verification steps](pack29f-suggested-fixes.md). No fixes were applied. Priorities: unblock recount first, then correct submitted-sheet round identity, clear obsolete final-state success notices, and align line-marshal prepared names.

## Transport and evidence limits

There was a transient no-signal episode during the duel. It was not deliberately induced. Pending taps and awarded round were retained; all actions eventually reached the server. No backend root cause established; no captured console warnings/errors. Tool selector wait timeouts were followed by state inspection, not treated as application errors. Desktop and phone share one Edge profile, so this does not prove independent-device authentication isolation. A newly opened desk URL while in device mode redirects to the counter; the existing organizer desk remained usable.

Screenshot 12-phone-final-desktop was actually 390×844 because the viewport command did not target that older tab; it is retained as raw evidence but excluded from the gallery. 22 is the verified 1440×900 counter capture. Screenshots may be scrolled to the relevant controls; paired text snapshots preserve full UI context.

## Preserved records

- Profight e0f29ac4-d4e0-4aa5-b6b5-5766d644979d (existing queued fixture, now final), Field 5. Red Man A vs Blue Man C. R1 phone9–0, paper Bea3–10, Cara10–3 => 9.667–9.333. R2 phone0–0, grappling Even/list control Blue => 9–10. Final 18.667–19.333, Blue Man C, split decision. Rounded database score columns remain 19–19 by design; exact UI result is correct.
- New duel 79525e42-6df0-4e86-80c4-225f77fa4098, Field 6, same synthetic Men's Longsword competition. Man B vs Man A. R1 4–0, R2 0–2, final Man B4–2. One retained correction action remains as evidence.
- Test operator TEST Pack29f Line Marshal; phone moved back to Line marshal/Lyst 5 after duel checks. Session and evidence preserved.
- Synthetic appeal recorded and rejected with note Synthetic validation complete; no correction warranted.
- Existing KO/medic holds and other fixtures untouched.

## Next test priority

Implement/review F1–F4, then repeat recount end to end (paper sheets must remain), round transition labels, and final phone notices. Run the genuine hidden-tab test with working native tab control or manually. Controlled offline/reconnect and simultaneous independent Red/Blue phones remain separate hardware/session coverage; the incidental connection recovery here is not a substitute.
