# Pack 26: UI / UX matrix (every screen, every persona)

Coverage record of the Pack 26 usability audit. One row per significant screen: who it is for, the one job it does, what was found, what was changed, and at which sizes it was looked at in the running product (real local stack, real Chromium; `scripts/e2e/pack26-live.mjs`, viewport sweep in `docs/reviews/assets/2026-10-07-pack26/viewport-sweep.json`). Severity: **P0** unsafe / wrong result / private data; **P1** critical action hard to find, serious phone problem; **P2** unnecessary steps, poor hierarchy, misleading wording, bad empty or error state; **P3** polish.

Verified sizes: 360×800 (S), 390×844 (P), 740×360 landscape phone (L), 768×1024 (T), 1024×768 (TL), 1280×900 (D), 1920×1080 (TV, big screen only). "✓" = looked at in the sweep with no sideways scroll, no covered control, no `undefined`/`NaN`, no page error; "–" = not opened at that size; a letter in brackets = a problem found there (see the Problems column).

## 1. Personas reviewed (31)

| Persona | How it was played | First-screen test ("is the thing they need near the top?") |
| --- | --- | --- |
| Signed-out visitor | fresh context, no session | Home: what BuhurtOS is, events soon. Event page: Overview before, Live during (NOW / ON DECK / IN THE HOLE), Results after. ✓ |
| New account / normal signed-in user with no role | `a7` stranger | Home → events; Event Control refused in plain words; desk refused in plain words. ✓ |
| Fighter, claimed profile, registered, several competitions | `f3` Cael Rhodes (Longsword, Polearm, 5v5) | MY NEXT FIGHT first on the live event page; who / where / how soon / which competition. ✓ |
| Fighter not registered | `f35` | Register CTA leads the Overview; after the close time the register page says so (fixed, was a full form that the server refused). ✓ |
| Fighter with upcoming fight / on deck / up now | `f3`, queue moved by the organizer | card changes by itself: Coming up → On deck ("go to the bullpen") → "You are fighting now on Lyst 1". ✓ |
| Fighter who has finished | `f3` after his fights | "No more fights scheduled for you yet" + results so far. ✓ |
| Fighter with a readiness blocker / fee outstanding / not checked in | `f2` (fee), `f15` (never arrived), `f19` (insurance) | the card says "Not checked in yet: see the registration desk" and "Your fee is not marked paid yet". ✓ |
| Withdrawn fighter | `f33` | no next fight shown; My events shows the withdrawn registration. ✓ |
| Suspended / blocked fighter | not in the fixture (Pack 22 discipline block) | reviewed by code only: the desk card says "Blocked … ask the head marshal" and offers no Check in. (recorded, not played) |
| Team member / captain / join requester / mercenary | `f1` captain of TEST Reavers; `f53` mercenary | Team manager: own team first, join requests with a count. Mercenary: his registration card carries a Mercenary chip and "No team". ✓ |
| Volunteer | `b8`, `b9` | registration card: roles, "No fee due"; desk card says Volunteer, no armour buttons. ✓ |
| Check-in staff | `b1` | the desk opens on Not ready, search first and sticky, Arrived / Check in / Undo; no armour buttons. ✓ |
| Armour inspector | `b2` | the same desk named "Armour inspection": Pass / Needs correction / Fail with what needs fixing; no check-in buttons. ✓ |
| Medic | `b3` | no screen of their own (database role only: may read medical notes). Recorded. |
| Marshal (account) | `b7` | Lyst Control opens for the field; no queue reordering. ✓ (database matrix) |
| Head marshal | `a3` | Live ops only (no Set up / Results), Open Lyst Control per Lyst, resolves conflicts, withdraws an injured fighter, readiness override. ✓ |
| Secretary / scorekeeper | `a4`, `a5` | Lyst Control: queue, open fight, clock, rounds, counters, finish. Live ops read-only boards. ✓ |
| Announcer | `b4` | announcer screen renders the current and next fights. ✓ |
| Broadcast operator | organizer | Broadcast tool from Set up; overlay renders. ✓ (configuration not exercised beyond opening) |
| Organizer | `a2` | Set up → one next step per stage; Live ops on the day; Results to close. ✓ |
| Second organizer (added by email) | `b5` | the whole of Event Control. ✓ |
| Organizer of another event | `b6` | told plainly that this is not theirs; database refuses every read. ✓ |
| Temporary event admin device | Event Admin Tablet | Live ops with the boards; no Set up. ✓ |
| Platform owner | `a1` | Platform › Devices lists sessions across events; organizer refused. ✓ |
| Counter device (Counter QR) | three phones | who → which Lyst → RED / BLUE → count; handoff; follows the next fight. ✓ |
| Training counter | `b8` on the Training QR | name → side → count; told it is practice. ✓ |
| Scorekeeper / marshal / announcer / event-admin devices | device codes | land on their screens with the device bar (event, role, access ends, sign out). ✓ |
| Expired / revoked / signed-out device | sessions ended | screen ends within the check interval and says so; a rescan of the Counter QR works at once. ✓ |
| Account with roles in two events | `b6` (organizer of the other event) opening this one | refused here, organizer there. ✓ |

## 2. Screens (routes)

| Screen | Route | Audience | Primary job / action | Problems found (severity → outcome) | S | P | L | T | TL | D | A11y |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home | `/` | everyone; signed-in fighters see "your day" first | what BuhurtOS is; events soon; a fighter's next thing | onboarding dialog and the install card can show together on Home (P3, recorded) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | landmarks ✓ |
| Events | `/events` | everyone | find an event | test events carry the Test data badge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Calendar | `/calendar` | everyone | month view | – | – | ✓ | – | ✓ | – | ✓ | |
| Event · Overview | `/events/:slug` (before), `/overview` | visitor, fighter | facts, register | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Event · Live | `/events/:slug/live` | spectator, fighter | NOW / ON DECK / IN THE HOLE per Lyst; MY NEXT FIGHT first for a fighter | fields grouped case-sensitively and a blank field read "Field not set" (P2 → fixed: one key, Lyst label); team-fight score read as fighters standing (P1 → fixed: "rounds won") | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | aria-live region ✓ |
| Event · Results | `/events/:slug/results` | everyone | official placings, history | – | ✓ | ✓ | – | ✓ | – | ✓ | |
| Register | `/events/:slug/register` | fighter, volunteer | the one form | the form showed after the close time and the server refused a completed form (P1 → fixed: closed / not open yet states; no Change button once closed) | – | ✓ | – | – | – | – | errors tied to fields ✓ |
| Event Control · Set up | `/control?mode=setup` | organizer | the ONE next step; set-up tools | the number of Lysts was not a setting (P2 → fixed in Event settings); with one straggler pending the step stays "Review 1 registration" with Build beside it (recorded) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Event Control · Live ops | `/control?mode=live` | organizer, head marshal, secretary, event-admin device | run the day: attention, the Lysts, workstations, Counter QR | "Lyst 1 has no fight on → Call it in Live ops" linked to the page it was on (P3 → fixed: jumps to the board); heading "Fields" beside "Lyst Control" (P2 → fixed: Lysts everywhere) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | status regions ✓ |
| Event Control · Results | `/control?mode=results` | organizer | make results official, close | – | – | ✓ | – | ✓ | – | ✓ | |
| Tool · Registrations | `?tool=registrations` | organizer | accept / decline / fees / insurance | 43 pending cards were 24 screens tall at 390 and an accepted card vanished from the Pending list with no confirmation (P2 → fixed: compact pending card, "Accepted …" status line); decisions made on another screen are not pushed to an open list (P3, recorded) | – | ✓ | – | ✓ | – | ✓ | |
| Tool · Event settings | `?tool=settings` | organizer | dates, venue, fees, waiver, publish | Lyst count added (P2) | – | ✓ | – | – | – | ✓ | |
| Tool · Build tournament | `?tool=build` | organizer | one plan, one Use this plan | changing event dates after registration holds every fight ("not here on …"); the plan says so but nothing offers to re-ask availability (P2, owner question) | – | – | – | – | – | ✓ | |
| Tool · Draws and schedule | `?tool=run` | organizer | each draw by hand; bracket from pools; reopen a result | "Open in Run tools" wording (P3 → fixed) | – | – | – | ✓ | – | – | |
| Tool · Counters and devices | `?tool=devices` | organizer | Counter QR, phones signed in, device codes | help text still listed "Counter Phone 1 to 4" (P2 → fixed); Move sheet said "Another field… / Field name" (P3 → fixed: Lyst) | – | ✓ | – | ✓ | – | ✓ | |
| Tool · Check-in list | `?tool=checkin` | organizer | the list form of the desk | – | – | – | – | – | – | – | |
| Tool · Staff and roles, Teams, Entrants, Competitions, Broadcast | `?tool=…` | organizer | – | not changed; opened in the sweep | – | ✓ | – | – | – | – | |
| Check-in desk | `/events/:slug/checkin` | desk, inspector, head marshal, organizer | arrived / check in / armour / override | stranger text pointed at "Manage › People" (P3 → fixed) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | focus layout ✓ |
| Lyst Control (field) | `/events/:slug/field/:field` | secretary, marshal, head marshal | queue → fight → clock → rounds → finish | header read "Lyst · Field 1" (P3 → fixed: "Lyst 1"); "Next fight on Field 1" (fixed) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | output/timer roles ✓ |
| Counter phone | `/lyst/counter` (device) | counter | who → which Lyst → side → count | Lyst buttons said "Field 1" under "Which Lyst?" (P2 → fixed); order Field 1, 10, 2 (P3 → fixed client side); "This seat has run out" (P3 → fixed) | ✓ | ✓ | – | – | – | – | RED/BLUE in words ✓ |
| Training counter | `/lyst/train/:code` | trainee (own account) | name → side → count (practice) | – | – | ✓ | – | – | – | – | |
| Big screen (Arena) | `/events/:slug/arena/:field` | spectators (TV) | NOW, score, clock, On deck, In the hole | team-fight numbers were rounds won with no word for it (P1 → fixed); "Field complete" (P3 → fixed) | – | ✓ | – | – | – | ✓ | TV ✓ |
| Announcer | `/events/:slug/announcer` | announcer | current and next, names | – | – | – | – | ✓ | – | – | |
| Broadcast overlay | `/broadcast/:eventId/:field` | OBS | overlay | – | – | – | – | – | – | ✓ | |
| Device sign-in | `/device` | any event device | one code field; QR | – | – | ✓ | – | ✓ | – | – | |
| My events | `/my-events` | signed-in people | my registrations and fights | – | – | ✓ | – | – | – | – | |
| Account | `/account` | signed-in people | profile, fighter link, notifications, sign out | the Notifications row was called "Notification Settings" (P3 → fixed) | – | ✓ | – | ✓ | – | – | |
| Notifications dialog | (dialog) | signed-in people | 4 switches | hints did not say what each switch covers; a test push was silently blocked by the BuhurtOS switch (P2 → fixed: hints, migration) | – | ✓ | – | – | – | – | dialog focus ✓ |
| Teams, Team page, Team manager, Team editor, Membership | `/teams…`, `/team-manager` | fighters, captains | find / join / manage a team | opened in the sweep; no change | – | ✓ | – | ✓ | – | – | |
| Fighters, Fighter page, Profile editor | `/fighters…` | everyone | sporting identity | opened in the sweep; no change | – | ✓ | – | ✓ | – | – | |
| Rankings, Formats, Rules, Rule document, Rule | `/rankings`, `/formats`, `/rules…` | everyone | read | opened in the sweep; no change | – | ✓ | – | ✓ | – | – | |
| Organizations | `/organizations…` | everyone | – | not opened (unchanged) | – | – | – | – | – | – | |
| Platform home, Events, Organizations, Fighters, Analytics, Bugs, Rules, Devices | `/platform…` | platform owner | restrained platform administration | Devices: verified; the rest opened (home) | – | ✓ | – | ✓ | – | – | |
| Sign in, Reset password, Welcome, Claim profile | `/sign-in`, … | new / returning people | – | not exercised on the local stack (no real Auth server here); reviewed by code only | – | – | – | – | – | – | |
| Discipline log | `/events/:slug/discipline` | head marshal, organizer | cards and penalties | not opened in Pack 26 | – | – | – | – | – | – | |
| Not found | `*` | everyone | a way out | – | – | ✓ | – | – | – | – | |

## 3. Interaction cost (taps from the screen the person starts on)

| Task | Taps | Note |
| --- | --- | --- |
| Register for an event (signed in, from the event page) | 1 + the form | Register CTA → form |
| Check a fighter in (desk) | 2–3 | search → Arrived → Check in (Arrived is optional) |
| Open a Lyst (Live ops) | 1 | Lyst Control · Lyst 1 |
| Start scoring a fight (Lyst) | 2 | the fight row → Start round 1 |
| Join as a counter | 3 after the scan | name → Lyst → side (2 with one Lyst) |
| Change the counter | 2 | New counter → name |
| Find my next fight | 0 | first thing on the live event page |
| Build the tournament | 2 | Build tournament → Use this plan |
| Resolve a result conflict (Live ops) | 2 + a note | note → Keep / Use |
| Make a competition official (Live ops) | 3 | Review wins & losses → Confirm results → Yes |
| Close the event | 3 + a note | Close event → note → Yes |
| Add a staff member | tool + form | Staff and roles → email, role |
| Change notification settings | 2 | Account → Notifications |

## 4. Reviewed and deliberately left unchanged
- The journey's "Review 1 registration" before "Build tournament" when one registration is still pending: the person waiting deserves an answer; Build is one tap beside it.
- The two first-time notification asks (the small onboarding dialog on calm pages; the card on My next fight): they share one "Not now", so a person sees at most one, and the card is the only one that can work on iOS Safari (install steps).
- The Registrations list not refreshing when another organizer decides at the same time: a reload shows it; a live list is not worth its requests for a review screen.
- Fields stored as "Field N": the stored name stays (keys, timers, counter bindings and broadcast mappings depend on it); only the word a person reads changed.
