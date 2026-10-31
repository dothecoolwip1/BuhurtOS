# Codex prompt: full start-to-finish rehearsal of BuhurtOS

Paste everything below the line into Codex. It runs one synthetic tournament from sign-up to the final result, with a separate Microsoft Edge profile for every person, and it deliberately includes the awkward people and situations seen on a real tournament day. It also covers everything the 2026-10-30 domain and seven-profile reports left unverified.

Migration `20261113000200_rehearsal_ko_finish.sql` has been applied to hosted Supabase (2026-10-31, verified by function hash), and the app code is on main at `406c77d`. If the site footer shows a build older than `3aab7f9`, stop and report that.

---

You are running a full start-to-finish rehearsal of BuhurtOS, the buhurt tournament platform, on the live site. It is the dress rehearsal for the Red Deer Rumble (Nov 14–15, 2026: about 100 people on site, 30 watching remotely). Play every person as they would behave on the day, including the ones who do things wrong.

Site: **https://buhurt-os.app** (the old https://buhurt-os.vercel.app must still work).

## Ground rules (read first)

- **Synthetic data only.** Create one new test event with the **Test event** box ticked on New Event, named `TEST Full Rehearsal 2026-MM-DD` (today's date). Every fighter, team and result you create belongs to it and has a name starting with `TEST`. You may read the preserved fixtures **TEST New Domain Longsword Rehearsal 2026-10-30** and the fictional `-test` events (for example "Red Deer Rumble-test"), but do not change them. **TEST Outrance Man A** has a permanent KO hold: do not enter A.
- **Never** change, score, register into or delete anything on a real event (for example Red Deer Rumble 2026), a real fighter, a real team or any HACSA profile. Never delete any record. Keep every fixture, journal and result.
- Do not change the schema, app settings or authentication. Do not write to the database through a connector; reading it to confirm a result is allowed.
- **Never print or save** passwords, sign-in codes, QR links, device tokens or account ids. Describe them ("QR for Counter 3") instead.
- Viewports: phones are 390×844, tablets 820×1180, desks 1440×900. These are simulations, not real touch: say so in the report.
- For each step, record the UTC time and take a screenshot at each PASS or FAIL. Copy the exact on-screen text of every failure. Note the footer build (`v0.1.0 · … · <commit>`) at the start and whenever it changes.
- If Supabase is slow or failing (No signal, 5xx errors, long waits), note when it happened and carry on where you can. Do not retry a score action more than once without first reading what the screen says.

## The cast: one Edge profile per person

Create these Edge profiles (edge://settings/profiles → Add profile). Name each one exactly as listed and keep it in its own window. Ask the owner for any account you do not have. The shared accounts `organizer@buhurtos.ca` and `scorekeeper@buhurtos.ca` are staff on every test event automatically.

| # | Profile name | Who | Account | Viewport |
|---|---|---|---|---|
| P1 | `BOS Organizer` | runs the event | organizer@buhurtos.ca | desk, later phone |
| P2 | `BOS Secretary` | second desk at the Lyst | scorekeeper@buhurtos.ca | desk |
| P3 | `BOS Head Marshal` | head marshal, this event only | owner-provided | tablet |
| P4–P7 | `BOS Counter 1`–`4` | QR counters / line marshals | **signed out**, QR only | phone |
| P8 | `BOS Medic` | medic, this event only | owner-provided | phone |
| P9 | `BOS Announcer` | announcer page, arena / OBS overlay | owner-provided or signed out link | desk |
| P10 | `BOS Fighter` | a fighter with an account | owner-provided | phone |
| P11 | `BOS Captain` | a team captain | owner-provided | phone |
| P12 | `BOS Spectator` | public, never signs in | none | phone |

The edge-case people below reuse a profile only where the step says so; otherwise give each its own profile (`BOS Edge – <name>`):

- **E1 Brand-new person**: a fresh email that has never signed in (an owner-provided address, or an `+alias` the owner approves). Signs up during registration.
- **E2 Fighter with no account**: a TEST fighter the organizer adds by hand, who never signs in.
- **E3 Wrong-person phone**: a counter phone holding a QR from another Lyst, or an old QR made before the event was rebuilt.
- **E4 Role switcher**: the head marshal account given counter or secretary duty mid-day, then having it removed.
- **E5 Non-staff signed-in user**: a normal account that opens staff URLs (desk, counter, finalize) directly.
- **E6 Late arrival**: a counter phone that joins after round 1 has started.
- **E7 Bad connection**: any desk or phone put on DevTools → Network → "Slow 3G" or Offline when a step says so.

## Part 1. Arrival and sign-in

1. P12 (signed out): open Home, Events, Fighters, Teams, Rules and Rankings. Pass: no sideways scroll at 390 px, no console errors.
2. Redirects: `www.buhurt-os.app/events?x=1` lands on the apex address with the query kept; the old vercel.app address loads.
3. Sign in three ways on P10:
   - email and password;
   - **Email me a sign-in code**: the page says "sign-in code", never "6-digit", and an 8-digit code from the email works (report the email's subject and wording);
   - **Continue with Google** in one tab (report if the first return shows you as signed out).
4. Sign out, then sign in again. The Account page shows no account id.
5. **E1 brand-new person** signs up with a sign-in code. Report every screen until they have a usable account and can make a fighter profile. Check that a wrong or expired code gives a clear message.
6. **E5 non-staff user** opens a desk, counter and finalize URL of your test event directly. Each must refuse politely, with no data shown.

## Part 2. Public pages and privacy (P12, signed out)

1. Real event (Red Deer Rumble 2026), a real fighter and a real team (Red Deer Reavers), read only. Pass: no email addresses, phone numbers, emergency contacts, medical notes or account ids on the page or in visible network responses.
2. Fighter `https://buhurt-os.app/fighters/7c848b31-39db-453c-b2c4-7fa84982620f`: **Upcoming** must not list "Red Deer Rumble-test" or any other fictional event. A TEST fighter's page still lists its fictional events with a Test data badge.
3. Events list: fictional events are hidden by default, and "Show test data" shows them with a label.
4. Your new test event: a direct URL while signed out returns Not found; the event is absent from search, rankings and every fighter's career. Repeat this check after Part 3 publishes it.
5. The share link and Add to calendar (Google link and .ics) use the apex address.
6. The install prompt and manifest load; the scope and start URL are relative.

## Part 3. Build the event (P1, desk, then repeat two steps on phone)

1. New Event with **Test event** ticked. The review step says private/test. Venue search works. Set the date, fee, registration window and waiver.
2. Competitions: one each of Longsword, Sword and Shield, Sword and Buckler and Polearm (duels); a **Profight Division 2** tournament with a weight class; a **Profight Division 1** competition (for the TKO check); a 5v5 team fight; a Triathlon or Marathon if the form offers one.
3. People: add 10 TEST fighters with the organizer-added fighter flow (one of them is **E2**). Add 2 TEST teams of 5. Staff: give P3, P8 and P9 their roles **on this event only**, and confirm they have no role on any other event.
4. Publish the event (it stays a test event), then repeat Part 2.4.
5. Readiness strip: write down everything it says needs attention.
6. On a phone viewport, edit one competition and one fighter. Pass: every control is reachable and saves.

## Part 4. Registration, waivers and check-in

1. P10 fighter: register for one duel, accept the waiver (verbatim HACSA text, with a version) and fill in emergency info. It shows in My events and My next fight.
2. E1 (the new person): register for a second duel straight after sign-up.
3. P11 captain: enter a team into the team fight with a roster.
4. Edge cases: try to register twice for the same competition, register after the window has closed, and leave the waiver unticked. Each must give a clear refusal.
5. P1: review the entries, mark a fee paid and export registrations. The export holds no medical note by default.
6. Check-in desk: check fighters in by code; do the weapons and safety check if it is offered. Check in E2 (who has no account) by hand.

Pass: nobody types anything twice, and neither the export nor any public page holds private data.

## Part 5. Build the tournament and the devices (P1)

1. Build Tournament for each competition: pools then elimination for one duel, round robin for another. Write down the saved draw seed. The third-place fight is on by default.
2. Set a run order across 2 Lysts. The command centre (desk) shows both Lysts and what needs attention.
3. Make 4 counter QR codes and open each in P4–P7, signed out. Each lands as a temporary Counter, without an account sign-in and with no CORS error.
4. **E3 wrong phone**: open a QR from Lyst 2 on a phone meant for Lyst 1, and an old QR made before a rebuild. Pass: the phone clearly says where it belongs or that the QR is no longer valid. It never counts for the wrong fight.
5. **E4 role switch**: give P3 counter duty, open it, then remove it. Within seconds and without a reload, the phone or desk loses that duty.

## Part 6. Run the day: duels (P1, P2, P3, P4–P7, P9, P12)

For each duel weapon, fight at least one match on the Lyst with phones, and one on the classic scoreboard with a paper sheet.

1. Longsword: the phone pads show **+2 / Head or torso, two hands** and **+1 / Arm, leg, hand, or one-handed**. The screen-reader name of +2 contains "two hands". +2 adds two points, and Undo works.
2. At round end, the confirm pop-up opens on the desks and phones by itself. Each phone confirms; the desk awards with a reason when a count disagrees. "Score confirmed. Wait for the next round." **disappears from every phone, without a tap,** when the next round starts and after the result.
3. Duels need the regular rounds and a 2-point lead, then extra rounds; duels never end in a draw. Sword and buckler: 5 points a round, 2 round wins.
4. Reprimand: +3 to the opponent (+1 in buckler), shown apart from the round score. Warning → yellow → red escalation; void the second yellow and the red goes too.
5. Technical win: before any round (no-show), it needs the marshal's reason and is scored 10–0 per regular round (2–0 in buckler).
6. Finish: both desks show Official, the announcer page and the public arena / OBS overlay show the result, and the phones show the exact final score in Last fight.
7. The next fight is one tap from the official screen, and the phones follow it without a reload.
8. **E6 late arrival**: a fifth counter phone joins after round 1 has started. Pass: it shows the current round, it is not counted for round 1, and it counts normally from round 2.
9. **Fewer counters**: run one match with only 2 phones, and one with no phones (classic scoreboard and a paper sheet only). Pass: the desk says clearly what it is waiting for, and the result saves.
10. A counter phone **closes the tab mid-round** and reopens the QR. Pass: it comes back on the same fight, with no taps lost or doubled.

## Part 7. Run the day: team fight (5v5)

1. Score by fighters down per round, with rounds to win. A draw happens only in the group stage when time runs out level, never in elimination.
2. Group-stage tie-breaks: wins, then head-to-head (only when 2 are tied), then round difference, then the organizer's decision.
3. Discipline totals per team.
4. Change the roster between fights (a substitute). The change shows on the desk before the next fight.

## Part 8. Run the day: Profight (Outrance Rules V.26.4)

Use 3 to 5 line-marshal phones (P4–P7, plus one extra if you have it) and paper sheets typed in on the P2 desk.

1. Criteria order is grappling → list control → aggression → defence, stopping at the first one that is not Even. Letters are refused in number fields.
2. Mixed phone and paper sheets average correctly; the score columns show whole numbers and the result keeps the exact values. A missing phone is excluded only by the organizer, with a reason.
3. **KO winner behind on points (fixed and live; verify it)**: Red clearly leads round 1, which is confirmed. In round 2, before confirming, the knight marshal records **Knockout against Red**. Finish the fight → **Blue wins by KO**.
   - Pass: the result is saved and Official, with Blue the winner by KO. It never says "The winner cannot have the lower score".
   - Pass: the real totals are kept, with Red ahead, on the official screen and the observer page.
   - Pass: the finish dialog offers only the KO finish, with no points-decision button and no "Start round 3".
   - Pass: Red then has a permanent KO hold. Opening Red's next fight says "This fight cannot start yet", with no Cleared control.
   - Pass: no phone still says "Score confirmed. Wait for the next round."
4. **No extra round after a KO (fixed and live; verify it)**: make the fight level after 2 confirmed rounds, then record a KO before round 3.
   - Pass: there is no "Start round 3" on any desk. A second desk that was open beforehand loses the button within seconds without a reload.
   - If the button can still be tapped, the server must refuse with "this fight was ended by Knockout: finish the fight instead of starting round 3…". Report the exact text.
   - Void the KO (head marshal, with a reason): round 3 comes back. Record the KO again and finish by KO.
5. A Division 2 TKO (lack of defence) loses the round only, and the medic (P8) must clear the check before the next round. A Division 1 TKO ends the fight and puts a medic check on the loser.
6. A red card or DQ against the leader: the trailing fighter wins by DQ.
7. The head marshal decides a fight still level after round 3.
8. Appeals: a competitor appeal within 5 minutes of the result and a corner appeal within 15 minutes; reject one and uphold the other. Late appeals are refused with the rule cited.
9. Check the Profight standings page.
10. **Paper sheet with a lost connection**: set the P2 desk Offline for about 3 seconds as you press Add the sheet.
    - Pass: the sheet either saves by itself once you are back online, or the dialog says "The server has not confirmed this sheet yet… cannot be counted twice". Pressing Add again saves it.
    - Pass: there is only one sheet for that marshal, on both desks.
11. **Secretary retries the finish**: put P2 on Slow 3G and press Finish. If the answer seems lost, press it again. Pass: one Official result, and never "you cannot run this lyst".

## Part 9. Reliability and recovery (all desks and phones)

1. Desk Offline for 30 s, then Online.
   - While offline, the desk shows "No signal". The header chip says "Scores sent" or "N pending", never "Synced" beside "No signal".
   - It recovers within about 10 s, without a reload.
2. Phone Offline mid-round: keep tapping, then go back Online. Every tap is delivered once, and Saved counter evidence explains anything held.
3. Finish a fight with the desk offline. It shows Pending, not Official. Back online, it becomes Official once, with no duplicate.
4. Two desks save different results for the same fight. The second goes to Needs review, and the head marshal resolves it.
5. **Hidden-tab recovery**: put a desk tab truly in the background (switch tab or minimise for 2 minutes) while the other desk changes rounds. Come back and report how long it takes to be current, and what `document.hidden` reported.
6. **Long session**: keep one desk open for more than 70 minutes, past the 1-hour sign-in token. Report whether it ever gets stuck on No signal and needs a reload.
7. **Slow 3G for a whole fight** on one counter phone and on P2. Report any spinner longer than 10 s and any error text.
8. **Two tabs, one person**: open the same desk in two tabs of P1. Both stay correct, and an action taken in one shows in the other.
9. **App update**: if a new version is offered mid-scoring, it must wait ("It will not replace this version while a scoring screen is open…").

## Part 10. Finish the event: finalize, history and notifications

1. Finalize tab: close the event. Results appear on fighter and team pages **inside the test event only**, and nothing appears in public rankings or statistics.
2. Correct one result with a reason and void another. The history shows both with an audit trail; nothing is silently rewritten.
3. P10 and E1: My events and the fighter page show the right results. E2 (no account) has results on their fighter page too.
4. Push: follow a TEST fighter, allow notifications and send a test. Report whether a notification arrived (OS toast seen or not).
5. Broadcast tab: the livestream link and OBS overlay URLs use the apex address and update live.
6. After closing: try to score, start a clock or register on the closed event. Each is refused clearly.

## Part 11. Layout and one-handed use

- At 390×844, on every phone screen used (counter, marshal, medic, fighter, captain, spectator): no sideways scroll, every button at least 44 px tall, and the main actions within reach in the bottom half.
- At 1440×900 on the desks: nothing clipped, and dialogs fit.
- Record the measurements as JSON, as in the earlier reports.

## Part 12. Supabase health (read-only, if you have log access)

For the busiest 15-minute window, report:

- the count and maximum upstream time for each RPC: `counter_state`, `lyst_state`, `counter_acknowledge_run`, `device_whoami`, `outrance_enter_sheet` and `outrance_finish`;
- any 5xx responses;
- any "canceling statement due to statement timeout" or "still waiting for ShareLock" lines in the Postgres log. The heartbeat lock waits should be gone after the 2026-10-31 fix.

Say that these figures are project-wide and do not prove a cause.

## Report

Write `docs/test-reports/<date>/full-rehearsal-<build>.md`, with an HTML companion and screenshots, on a `codex/` branch, like the earlier reports. Start with a table of the profiles you actually used.

For every numbered step, give:

- PASS, FAIL or NOT RUN;
- the UTC time and the build;
- the screenshot names;
- the exact text of any failure;
- a suggested fix, where you have one.

Then list, separately:

- what was verified;
- what was not verified, and why;
- real records touched (this should be none);
- synthetic records created.

Do not call it an all-tests pass unless every step passed.
