# Codex retest: seven-profile rehearsal fixes

Paste everything below the line into Codex. Run it only after the owner has applied migration `20261113000200_rehearsal_ko_finish.sql` to hosted Supabase and the Vercel production build shows the commit that contains it (footer: `v0.1.0 · … · <commit>`). If the footer shows an older build, stop and report that.

---

You are retesting fixes from the seven-profile rehearsal report `docs/test-reports/2026-10-30/seven-profile-rehearsal-d90be08.md` (branch `codex/rehearsal-reports-2026-10-29`). Use the same seven independent Edge profiles as before: organizer, secretary, four QR counters, and a signed-out spectator. Phones are 390×844 viewports; desks are 1440×900.

Site: https://buhurt-os.app

Synthetic fixture to use (do not use any real event, fighter, team or HACSA record):
- Event: **TEST New Domain Longsword Rehearsal 2026-10-30**, https://buhurt-os.app/events/test-new-domain-longsword-rehearsal-2026-10-30 (test_event, draft).
- Competitions: **TEST Seven Profile Longsword** and **TEST Seven Profile Profight** (Division 2, tournament, Heavyweight). Fighters: TEST Outrance Man A–D. **TEST Outrance Man A has a permanent KO hold from the last run: do not use A.** Use B, C and D, or add new fighters named `TEST Outrance Man E`/`F` with the organizer-added fighter flow inside this test event only.
- Do not delete anything. Keep every fixture, journal and result. Do not change app settings, schema or real records.

Before each step, write down the time (UTC). Take a screenshot at every PASS/FAIL point. Never include passwords, QR links, tokens or account ids in the report.

## 1. P1: a KO winner who is behind on points (the priority fix)

1. Organizer: start a new Profight between two fighters without holds (e.g. B vs C). Four line-marshal phones on it.
2. Round 1: score so Red clearly leads (for example, every marshal gives Red a 10–7 or 10–8). Confirm round 1.
3. Round 2: start it. While the clock runs, the knight marshal records **Knockout against Red** (Knight marshal's call → Red → Ends the fight → Knockout → Record).
4. Do **not** confirm round 2. Open **Finish the fight** and choose **Blue · … wins by KO**.

Pass:
- The result is saved and **Official**, winner Blue by KO, even though Blue is behind on points. No "The winner cannot have the lower score".
- The official screen and the observer page show the real Total Fight Score (Red ahead), not reversed numbers.
- The finish dialog offered only the KO finish: no "wins on the Total Fight Score" button and no "Start round 3".
- Red then has a permanent KO hold: opening Red's next fight says "This fight cannot start yet" with no Cleared control.
- All four phones' Last fight shows the result; none still says "Score confirmed. Wait for the next round."

Repeat once with the KO recorded **after** round 2 is confirmed and the fight is level (to check the extra-round fix in 2).

## 2. P2: no extra round after a fight-ending call

1. New Profight (e.g. C vs D, or E vs F). Make it level after 2 confirmed rounds (e.g. round 1 10–7 Red, round 2 7–10 Blue).
2. Before starting round 3, record a **Knockout against Blue**.

Pass:
- The desk shows **Finish: Knockout** and no "Start round 3" button and no "Level after 2 rounds" line.
- On a **second desk** (secretary) that was open before the KO, without reloading: within a few seconds the Start round 3 button disappears. If it is still there, tap it: the server must refuse with "this fight was ended by Knockout: finish the fight instead of starting round 3". Report the exact text.
- Void the KO (head marshal or organizer, with a reason). Start round 3 comes back. Then record the KO again and finish by KO.

Also check a **Division 2 TKO** (TKO: lack of defence) does **not** end the fight: rounds carry on after the medic check is cleared.

## 3. Paper sheet saving under a bad connection

1. On the secretary desk, for a round with no phones, open **Type in a paper sheet**, fill it in, and just before pressing **Add the sheet** set the desk browser to Offline (DevTools → Network → Offline) for about 3 seconds, then back Online.

Pass:
- Either the sheet saves by itself once the connection is back (the desk retries the same sheet), or the dialog says "The server has not confirmed this sheet yet. It is kept here: Add the sheet again sends the same sheet, so it cannot be counted twice." Pressing **Add the sheet** again then saves it.
- Only **one** sheet for that marshal appears for the round, on both desks.

## 4. Desk connection recovers by itself

1. Organizer desk on a running Profight. Set the browser Offline for 30 seconds, then Online.

Pass:
- While offline the desk shows "No signal…". The header chip says **Scores sent** (or "N pending"), not "Synced".
- Within about 10 seconds of going back online, without a reload, the "No signal" line goes and the desk shows the current clock and rounds (compare with the secretary desk).
- Leave a desk open for at least 70 minutes (past the sign-in token's 1-hour life) during the session if you can; report whether it ever sticks on "No signal" and needs a reload.

## 5. Counter phone notices and the Longsword pad

1. Longsword duel (TEST Seven Profile Longsword, new match). Four QR counters.
2. Pass, phone pad: the +2 pad shows **+2** and under it **Head or torso, two hands**; the +1 pad shows **Arm, leg, hand, or one-handed**. The screen-reader name of +2 contains "two hands". Pads still at least 44 px high and no sideways scroll at 390×844.
3. Round 1: each phone confirms its score → "Score confirmed. Wait for the next round." appears.
4. Start round 2. Pass: that notice is gone on every phone **without a tap**.
5. Finish the fight. Pass: no phone says "Score confirmed. Wait for the next round." after the result; Last fight shows the exact final score.
6. Profight line-marshal phone: hand in a sheet → "Sheet handed in. Wait for the next round." Start the next round → it goes without a tap.

## 6. Sign-in code wording (account page)

Signed out, https://buhurt-os.app/account → Email me a sign-in code. Pass: the page says "We email you a sign-in code…" and "We sent a sign-in code to …"; no "6-digit". An 8-digit code from the email signs in. (The email's own wording is changed by the owner in Supabase; report what it says.)

## 7. Test events on a real fighter's page

Signed out, open https://buhurt-os.app/fighters/7c848b31-39db-453c-b2c4-7fa84982620f. Pass: **Upcoming** no longer lists "Red Deer Rumble-test" (a fictional event); the real Red Deer Rumble still shows if the fighter is entered. A fictional (TEST) fighter's page still lists its fictional events.

## 8. Items still unverified from the last run (do these if time allows)

- Genuine hidden-tab recovery: put a desk tab truly in the background (switch to another tab for 2 minutes while rounds change on the other desk), come back, and report how long it takes to show the current state. Report `document.hidden` values you observed.
- Division 1 TKO ends the fight and puts a medic check on the loser.
- Warning → yellow → red escalation; voiding the second yellow voids the red.
- A full appeal: competitor appeal within 5 minutes, corner appeal within 15, head marshal rejects/upholds.
- Head marshal's decision on a fight still level after round 3.
- Published test-event privacy: publish this test event, then confirm signed-out direct URL still returns not found and it is absent from rankings and event search. Return it to draft afterwards.

## Report

For each numbered item: PASS / FAIL / NOT RUN, time (UTC), build shown in the footer, screenshots, and exact on-screen text for any failure. Also record Supabase errors you see in the browser console (sanitized: RPC name, HTTP status, time). State clearly what was not verified. Do not call this an all-tests pass unless every item passed.
