# Codex prompt: full-site rehearsal of BuhurtOS

Paste everything below the line into Codex. It covers every feature and role, including everything the 2026-10-30 domain and seven-profile reports left unverified. Run the short retest (`CODEX_RETEST_seven-profile-fixes.md`) first, or include it as Part 9 below; both need the owner to have applied migration `20261113000200_rehearsal_ko_finish.sql` to hosted Supabase. If the footer build is older than commit `3aab7f9`, stop and report that.

---

You are running a full rehearsal of BuhurtOS, the buhurt tournament platform, on the live site. It is a dress rehearsal for the Red Deer Rumble (Nov 14–15, 2026: about 100 people on site, 30 watching remotely). Test as the real people would on the day, on phone-sized and desk-sized screens.

Site: **https://buhurt-os.app** (the old https://buhurt-os.vercel.app must still work).

## Ground rules (read first)

- Only synthetic data. Create one new test event with the **Test event** checkbox ticked on New Event, named `TEST Full Site Rehearsal 2026-MM-DD` (today's date). Every fighter, team and result you create goes in it, with names starting `TEST`. You may also reuse the preserved fixtures **TEST New Domain Longsword Rehearsal 2026-10-30** and the fictional `-test` events (e.g. "Red Deer Rumble-test"), read-only unless a step says otherwise.
- Never change, score, register into or delete anything on a real event (e.g. Red Deer Rumble 2026), a real fighter, a real team, or any HACSA profile. Never delete records at all. Keep every fixture, journal and result.
- No schema, settings or authentication changes. No database writes through a connector, except reading to confirm a result.
- Accounts: the shared test accounts `organizer@buhurtos.ca` (organizer) and `scorekeeper@buhurtos.ca` (scorekeeper/secretary) are staff on every test event automatically. Ask the owner for any other account you need (fighter, team captain, head marshal, medic, announcer). Never print or save passwords, codes, QR links, tokens or account ids.
- Profiles: use separate Edge profiles per person (organizer, head marshal, secretary, four counter phones, medic, announcer, fighter, team captain, signed-out spectator). Phones are 390×844 viewports, tablets 820×1180, desks 1440×900. Say clearly that viewports are simulations, not real touch.
- Each step: note the UTC time, take a screenshot at each PASS/FAIL, and copy exact on-screen text for failures. Note the build in the footer (`v0.1.0 · … · <commit>`) at the start and whenever it changes.
- If Supabase is slow or failing (No signal, 5xx, long waits), note when and carry on where possible. Do not retry a score action more than once without reading what the screen says first.

## Part 1. Arrival and sign-in (signed out, then each account)

1. Signed out, open the home page, Events, Fighters, Teams, Rules, Rankings. No horizontal scroll at 390 px; no console errors.
2. Redirects: `www.buhurt-os.app/events?x=1` lands on the apex with the query kept. The old vercel.app address loads.
3. Sign in three ways: email + password, **Email me a sign-in code** (the page must say "sign-in code", not "6-digit"; an 8-digit code works; report the email's subject and wording), and **Continue with Google** (one tab only; report if the first return shows signed out).
4. Sign out, sign back in. Account page shows no account id.

Pass: every way signs in on the apex and lands back where you started.

## Part 2. Public pages and privacy (signed out)

1. Real event page (Red Deer Rumble 2026), a real fighter, a real team (Red Deer Reavers): load, read only. No emails, phone numbers, emergency contacts, medical notes or account ids anywhere on the page or in the network responses you can see.
2. Fighter `https://buhurt-os.app/fighters/7c848b31-39db-453c-b2c4-7fa84982620f`: **Upcoming** must not list "Red Deer Rumble-test" or any other fictional event. A TEST fighter's page still lists its fictional events with a Test data badge.
3. Events list: fictional events hidden by default; "Show test data" shows them, labelled.
4. Your new test event: signed out, direct URL is not found; it does not appear in search, rankings or any fighter's career. Check again after Part 3 publishes it.
5. Share link and Add to calendar (Google link and .ics) use the apex address.
6. Install prompt / manifest loads; scope and start URL are relative.

## Part 3. Organizer: build the event (organizer, desk then phone)

1. New Event with **Test event** ticked. Review step says private/test. Venue search works. Set date, fee, registration window, waiver.
2. Competitions: one each of Longsword, Sword and Shield, Sword and Buckler, Polearm (duels); Profight (set Division 2, tournament, a weight class); a 5v5 buhurt team fight; a Triathlon or Marathon if the form offers it.
3. People: add 8 TEST fighters with the organizer-added fighter flow. Add 2 TEST teams of 5. Staff: give the head marshal, medic and announcer accounts their roles on this event only.
4. Publish the event (it stays a test event). Re-check Part 2.4.
5. Readiness strip: read what it says needs attention.

Pass: each step saves, nothing appears outside the event, staff roles exist only on this event.

## Part 4. Registration, waivers, check-in (fighter, captain, organizer)

1. Fighter account: register for one duel competition, accept the waiver (verbatim HACSA text, versioned), fill emergency info. Confirm it shows in My events and My next fight.
2. Captain account: enter a team into the team fight with a roster.
3. Organizer: review entries, mark fee paid, export registrations (check the export has no medical note by default).
4. Check-in desk: check in fighters by code; weapons/safety check if offered.

Pass: no re-typing between steps; the export and public pages hold no private data.

## Part 5. Build the tournament (organizer)

1. Build Tournament for each competition: pools then elimination for one duel, round robin for another. Note the saved draw seed. Third-place fight is on by default.
2. Run order across 2 Lysts. Command centre (laptop) shows both Lysts and what needs attention.
3. Devices: make 4 counter QR codes; open each in its own phone profile, signed out. Each lands as a temporary Counter without an account sign-in and with no CORS error.

## Part 6. Run the day: duels (secretary desk, head marshal, 4 counter phones, announcer, spectator)

For each duel weapon, fight at least one match on the Lyst with phones, and one on the classic scoreboard with a paper sheet.

1. Longsword: phone pads show **+2 / Head or torso, two hands** and **+1 / Arm, leg, hand, or one-handed**; screen-reader name of +2 contains "two hands". +2 adds two; Undo works.
2. Round end opens the confirm pop-up on desk and phones by itself. Each phone confirms; the desk awards with a reason when a count disagrees. "Score confirmed. Wait for the next round." disappears from every phone when the next round starts and after the result, without a tap.
3. Duels need the regular rounds and a 2-point lead, then extra rounds; no duel draws. Sword and buckler: 5 points a round, 2 round wins.
4. Reprimand: +3 to the opponent (+1 in buckler), shown apart from the round score. Warning → yellow → red escalation; void the second yellow and the red goes too.
5. Technical win: before any round (no-show), needs the marshal's reason, scored 10–0 per regular round (buckler 2–0).
6. Finish: Official on both desks; announcer page and the public arena/OBS overlay show it; phones show the exact final score in Last fight.
7. Next fight is one tap from the official screen; the phones follow without a reload.

## Part 7. Run the day: team fight (5v5)

1. Score by fighters down per round; rounds to win; a draw only in the group stage when time runs out level, never in elimination.
2. Group-stage tie-breaks: wins, head-to-head (only 2 tied), round difference, organizer's decision.
3. Discipline totals per team.

## Part 8. Run the day: Profight (Outrance Rules V.26.4)

Use 3 to 5 line-marshal phones and paper sheets typed in on the secretary desk.

1. Criteria order: grappling → list control → aggression → defence, stopping at the first that is not Even. Letters refused in number fields.
2. Mixed phone and paper sheets average correctly; the score columns show whole numbers and the result keeps the exact values. Missing phone excluded only by the organizer with a reason.
3. **KO winner behind on points**: Red leads round 1, KO against Red in round 2 before confirming. Blue wins by KO, saved Official, real totals kept (Red ahead). Red has a permanent KO hold with no Cleared control.
4. **No extra round after a KO**: level after 2 confirmed rounds, then a KO: no "Start round 3" on any desk (a second desk open beforehand loses it within seconds without reload; if tapped, the server refuses). Void the KO: round 3 comes back.
5. Division 2 TKO loses the round only; the medic must clear the check before the next round. Division 1 TKO ends the fight and puts a medic check on the loser (set up a Division 1 competition for this).
6. Red card / DQ against the leader: the trailing fighter wins by DQ.
7. Head marshal's decision on a fight still level after round 3.
8. Appeals: a competitor appeal within 5 minutes of the result, a corner appeal within 15; one rejected, one upheld. Late appeals refused with the rule cited.
9. Profight standings page.
10. Paper save under a lost connection: set the desk Offline for ~3 s while adding a paper sheet. It saves by itself when back, or says "The server has not confirmed this sheet yet… cannot be counted twice"; Add again saves it. Only one sheet for that marshal.

## Part 9. Reliability and recovery (all desks and phones)

1. Desk Offline 30 s, then Online: shows "No signal" while offline; header chip says "Scores sent" or "N pending", never "Synced" beside "No signal"; recovers within about 10 s without a reload.
2. Phone Offline mid-round, keep tapping, back Online: taps are delivered once; Saved counter evidence explains anything held.
3. Finish a fight with the desk offline: it shows Pending, not Official; back online it becomes Official once, with no duplicate.
4. Two desks save different results for the same fight: the second goes to Needs review; the head marshal resolves it.
5. **Genuine hidden-tab recovery** (unverified last time): put a desk tab really in the background (switch tabs or minimise for 2 minutes) while the other desk changes rounds; come back; report how long until it is current and what `document.hidden` reported.
6. **Long session**: keep one desk open more than 70 minutes (past the 1-hour sign-in token); report whether it ever sticks on No signal and needs a reload.
7. App update: if a new version is offered mid-scoring, it must wait ("It will not replace this version while a scoring screen is open…").

## Part 10. Finalize, history and notifications

1. Finalize tab: close the event; results appear on fighter and team pages **inside the test event only**; nothing in public rankings or statistics.
2. Correct one result with a reason and void another: the history shows both with an audit trail; nothing silently rewritten.
3. Push: follow a TEST fighter, allow notifications, send a test; report whether a notification arrived (OS toast seen or not).
4. Broadcast tab: livestream link and OBS overlay URLs use the apex address and update live.

## Part 11. Layout and one-handed use

At 390×844 for every phone screen used (counter, marshal, fighter, spectator): no sideways scroll, every button at least 44 px tall, main actions reachable in the bottom half. At 1440×900 for desks: nothing clipped; dialogs fit. Record measurements as JSON like the earlier reports.

## Part 12. Supabase health (read-only, if you have log access)

For the busiest 15-minute window: counts and max upstream time per RPC (`counter_state`, `lyst_state`, `counter_acknowledge_run`, `device_whoami`, `outrance_enter_sheet`, `outrance_finish`), any 5xx, and any "canceling statement due to statement timeout" or "still waiting for ShareLock" lines in the Postgres log. Say these are project-wide, not proof of cause.

## Report

Write `docs/test-reports/<date>/full-site-rehearsal-<build>.md` with an HTML companion and screenshots, on a `codex/` branch, like the earlier reports. For every numbered step: PASS / FAIL / NOT RUN, UTC time, build, screenshot names, exact text of any failure, and a suggested fix where you have one. Then list, separately: what was verified, what was not verified and why, real records touched (should be none), and synthetic records created. Do not call it an all-tests pass unless every step passed.
