# BuhurtOS phone test plan (before Nov 1, 2026)

For the owner and a few teammates, on real phones. Plain language. Written 2026-10-01 from what is in this repo today, not from what was hoped for. Each step says where the answer comes from so you can check me.

## How to use this

* Use your own phone, on the browser you normally use. Try at least one person on iPhone and one on Android, and one with mobile data only (no wifi).
* Do the steps in order. Part A and B need one person (the owner or an approved organizer). Parts C to F are for everyone.
* If a step does not behave the way "Expected" says, stop and send a report using the template at the end. A confusing screen is a bug too. Do not try to fix it by guessing.
* The competition steps (Part G) are **new, not yet tested against the real database**. Expect rough edges and report exactly what you see.
* Use a throwaway event and fake test people. Do not enter real emergency contacts or real medical notes. Use made-up names like "Test Fighter One".

## Before you start: what exists and what does not

Verified in the code (cited so you can check):

* Real pages: Home, Events, event page at `/events/:slug`, registration at `/events/:slug/register`, organizer area at `/events/:slug/manage`, Account (`/account`), Formats, Rules, Marshal (`src/App.tsx`).
* The organizer area has four tabs: Review, Check-in, Setup, People (`src/pages/ManagePage.tsx`).
* The old `/admin/*` clickable mock was removed (see docs/ADMIN_MOCK_RETIRED.md). Test the real admin at `/events/:slug/manage`.
* `/marshal` in this tree is the scoring screen design running on invented fighters, with a pretend "no signal" switch. Its send step is simulated, not a real database call (`src/lib/useOutbox.ts` says so in its comments).
* **There is no screen to create an event or a team.** The database functions `create_event` and `create_team` exist (`supabase/migrations/20261001000300_registration.sql`) but nothing in `src/` calls them. See Part B for how the throwaway event is made.
* Sample mode (`?sample=1` on any page) mixes clearly labelled invented events into the lists. Leave it off for this test (`src/data/mode.ts`). If you ever see "Sample events (invented)", add `?sample=0` to the address.

## Part A. Sign in (everyone)

What is really implemented (`src/auth/AuthContext.tsx`, `src/auth/SignIn.tsx`):

* **Email code:** the app asks the backend to email a code (`signInWithOtp`) and then checks what you type (`verifyOtp`). The box is labelled 6-digit and accepts spaces. New emails automatically get an account.
* **Google:** the button "Continue with Google" is in the app and calls Google sign-in (`signInWithOAuth`). Whether Google is actually switched on in the Supabase project, and set up with Google, **cannot be confirmed from this repo**. Treat it as unverified until someone taps it.
* Sign-out is on the Account page. There are no passwords.

Steps:

1. Open the site address, tap **Sign in** (top right) or go to `/account`.
   Expected: a card "Sign in" with a Google button, "or use an email code", and an Email box.
2. Type your email, tap **Email me a code**.
   Expected: the card changes to "We sent a 6-digit code to ...". Code email arrives within about a minute (the page says check spam).
   Note the time you tapped and the time the email arrived. Report which sender address it came from.
3. Type the code, tap **Sign in**.
   Expected: you land on the Account page, "Signed in as your@email".
4. Try a wrong code on purpose (use a second attempt). Expected: a plain-language error, no crash.
5. Sign out and sign back in with Google (everyone with a Google account).
   Expected: leaves the site, returns to the same page, signed in. If it shows a Google error or "provider is not enabled", that is the answer: report it.
6. Close the browser tab, reopen the site. Expected: still signed in (sessions persist, `src/lib/supabase.ts`).

## Part B. Create a throwaway event (owner, with help)

There is no button for this in the app. Two things must happen in the database first, by the owner or by Claude applying SQL with the owner's approval:

1. The owner's account must have a row in `platform_roles` with role `owner` or `organizer`. Nothing in the app writes that table (`supabase/migrations/20261001000100_foundation.sql`: written only by the database owner).
2. Someone calls `create_event(slug, name, starts_on, ends_on, venue, address)` while signed in as that account (it makes the caller the event's organizer), then adds at least one competition and a waiver version for the event. The event starts as a **draft**.

There is a seed file for the real event as a private draft (`supabase/seed/red_deer_rumble_2026.sql`: 17 competitions, the owner's waiver text as version 1, fee $40 for Alberta, registration closing 2026-11-09 06:59 UTC which is Nov 8, 23:59 Mountain). **Do not run that seed for this test unless the owner wants the real event to exist.** For a throwaway, make a separate event, for example slug `test-night-1`, and give it one fake competition and a short fake waiver so nothing real is mixed in. Whoever sets this up: tell testers the exact address.

Also needed: at least one **approved team** (status `approved`) so the team box has choices. The `supabase/seed/hacsa_teams.sql` file loads 10 HACSA teams as approved with no captain. Whether it has been run on the live project is not visible from the repo. If the team list on the register page is empty, report that.

## Part C. Organizer setup at `/events/:slug/manage` (organizer)

Source: `src/pages/ManagePage.tsx`, `src/pages/SetupTab.tsx`, `src/registration/setup.ts`.

1. Signed out, open `/events/test-night-1/manage`.
   Expected: if the event is a draft nothing leaks; you may see "not found" or a sign-in prompt. Report which.
2. Sign in as the organizer account. Expected: "Manage <event name>" with Review, Check-in, Setup, People tabs.
3. Sign in as a **different** non-organizer account and open the same address.
   Expected: "This area is for organizers". Nothing else shown. (The database also refuses; this is only the polite screen.)
4. Setup tab. Check the publish checklist. Expected: ticks for a competition and a waiver, a warning (not a blocker) if no close time or venue.
5. Change the name, dates, venue, fee ($40, "Only people from Alberta"), and a close time in the future. Tap **Save changes**.
   Expected: "Saved." Leave a field wrong on purpose (end date before start date): a plain message under the field.
6. Tap **Publish event**, then **Yes, publish**. Expected: "Published." and the page says "This event is public".
7. People tab. Add a second tester's email as **marshal**.
   Expected: if that person has never signed in, a plain error saying they have not signed in yet (the database says so, `grant_event_role_by_email`). After they sign in once, adding works and they show in "Who has access". You cannot remove the last organizer.
   Note: roles marshal/scorekeeper/medic exist, but whether they unlock anything in the UI yet is not verified. The only organizer-only screen proven here is Manage.

## Part D. Public event page (everyone, signed out too)

Source: `src/pages/EventWorkspace.tsx`, `src/pages/EventsPage.tsx`.

1. Open **Events**. Expected: the published throwaway event appears; no invented "sample" events; drafts do not appear.
2. Open the event. Expected: name, dates, competitions grouped (Group fights / Duels / Profights / HACSA events), fee text, venue, and a registration card.
   Fee text should read like "$40 for fighters from Alberta. Fighters from elsewhere and volunteers pay nothing."
3. Signed out, tap the register button. Expected: "Sign in and register".
4. Check it reads well on a small screen: no sideways scrolling, buttons reachable with one hand.
5. After the close time passes (organizer can set it a few minutes ahead to test): Expected "Registration is closed" and the form refuses to submit.

## Part E. Registration (three people, three roles)

Source: `src/registration/RegisterPage.tsx`, `src/registration/model.ts`, database `submit_registration`.

**What the form actually has.** One form for everyone. There is no separate captain form and no separate volunteer form. A "captain" in this test means: the person who picks the team and the group-fight categories. The app does not yet let a captain create a team, add teammates, or see team status. `create_team` exists in the database but has no screen. In team events each person signs up themselves and chooses an approved team.

Common to all (sign in first): name, email, gender, organization (HACSA/MCC/Other), province, team, optional BI fighter profile, categories, scheduling (days, shares equipment), insurance, emergency contact, "medically fit" box, optional private medical note, fee acknowledgement, waiver text with agree box and typed name, optional notes.

**E1. Fighter (duels)**
1. Tick a duel category only. Fill everything. Submit.
   Expected: "Thank you, you are registered", fee shown, e.g. $40 if province is Alberta.
2. Reopen the event page. Expected: your registration shows as pending.
3. Try to break it: leave the waiver box unticked, leave emergency phone empty, pick insurance "No, and I will not be taking part". Expected: red messages, nothing saved.

**E2. Captain (group fight)**
1. Choose a team and a group-fight category (3v3 or 5v5). Submit.
   Expected: works. If you leave the team empty, the form says fighters without a team do not fight.
2. Ask a teammate to do the same with the same team. Expected: both appear in organizer review under that team.
3. Report anything you expected a captain to be able to do that you could not.

**E3. Volunteer**
1. Tick "I am volunteering (no fee)", tick roles (list: Squire, Points counter, Marshal, Runner, Secretary, Scheduling, Ticket booth), no category needed. Submit.
   Expected: fee shows "No fee is due for you."
   Note: the owner's form also lists "other" volunteer roles and a separate safety/liability form for volunteers. The app has neither (`docs/PROJECT_SPEC.md`, corrections section). Report if testers expected them.

**E4. Edit and resubmit**
1. Submit a second time with the same account. Expected: replaces the first (one registration per person per event), goes back to pending. After the organizer accepts, resubmitting is refused ("ask an organizer to change it").

**E5. Privacy check (organizer only)**
1. The medical note and emergency contact must be visible to the organizer but never on any public page. Look at the public event page signed out and signed in as another person. Expected: neither appears.

## Part F. Organizer review and check-in (organizer)

Source: `src/pages/ManagePage.tsx`, `src/registration/review.ts`.

1. Review tab. Filters Pending / Accepted / Declined / All, and a search box. Expected: the three registrations from Part E appear under Pending with the right team, categories, volunteer chip.
2. Open "Contact, availability and notes". Expected: email, emergency contact (tap-to-call link), days, notes. The medical note is hidden until you tap "Show private medical note".
3. Tap **Accept** on one, **Decline** on another. Expected: status chip updates; "Back to pending" is available on accepted ones.
4. Fee: tap "Mark $40 paid". Expected: label becomes "Paid $40 (undo)". Volunteers show "No fee due".
5. Insurance dropdown: change one to "proof received" or similar. Expected: saves, and the "Outstanding" list on the card gets shorter.
6. Check-in tab (shows accepted only). Expected: "Check in" and "Kit check" buttons (volunteers have no kit button), a "Ready" chip once nothing is outstanding. The tab header shows "(x/y ready)".
7. Pull the phone out of signal for a minute while on this page, then tap a button. Expected: a plain error, not a frozen screen. Review and check-in do not work offline in this build; only the scoring outbox is designed to.

## Part G. Competition path (NEW, NOT YET TESTED AGAINST THE REAL DATABASE)

Honest status: other people are building the Run tab, the field scoring page and the live bracket in parallel. When this plan was written, only the planning and data pieces were in this tree:

* `src/lib/bracket.ts` builds single elimination (with byes, optional third-place match), round robin, and pools-then-bracket. Pure maths with tests.
* `src/data/matches.ts` talks to the database: fetch matches/entries/standings, generate matches, set queue state, finalize a match, reopen a match. Its code comments say it inserts planned matches in two passes and refuses to replace matches that are already final.
* Database side exists (`supabase/migrations/20261001000400_matches_scoring.sql`): `finalize_match`, `reopen_match` (organizer only, needs a reason of at least 3 characters, refuses if the next match was already played), a standings view.
* **Planned, route/UI may differ:** the Run tab, the field scoring page (design says `/events/:slug/field/:field`, `docs/PROJECT_SPEC.md`) and the live bracket page. Do not rely on the names below. Find the nearest screen and tell me what you saw.
* The existing `/marshal` screen is a design preview with invented fighters. Its offline switch is a pretend switch.

Accepting a registration is what creates the competition entries (comment above `decide_registration` in the migration), so you need accepted fighters from Part F first. Aim for a throwaway competition with 6 accepted entries so there are byes and more than one round. Use "Group fights" or a duel category.

**G1. Build the draw** (organizer) - new, not yet tested against the real database
1. Find where to build a draw (probably the Run tab). Pick the competition, choose random-with-seed or manual order, build.
   Expected: matches appear with names, not blanks, in rounds (for 6 entries: a first round with byes, semifinals, a final; a third-place match only if enabled). Same seed twice gives the same draw.
2. Tap build again. Expected: it refuses or asks you to replace, never silently doubles the matches.
3. Report: number of entries, number of matches shown, anything labelled oddly.

**G2. Score a fight on a phone** (marshal or scorekeeper) - new, not yet tested against the real database
1. Open the scoring page for a field, pick the first fight, score it, confirm the result.
   Expected: result shows on the page, the winner appears in the next round's slot.
2. Score a second fight and check the next-round slot fills with the right name.

**G3. Offline, then back online** - new, not yet tested against the real database
1. With the scoring page open and a fight loaded, switch on airplane mode. Score the fight and confirm the result.
   Expected: the page keeps working, shows something like "saved on this device, waiting for signal", nothing is lost.
2. Close the tab and reopen it while still offline. Expected: the waiting count is still there (the outbox stores entries on the device, `src/lib/outbox.ts`).
3. Turn airplane mode off. Expected: within about 10 seconds the waiting count drops to zero ("All saved and synced") and the live bracket shows the result.
4. Try the same thing with two fights queued offline. Expected: they sync in order.
5. Report any case where the count never clears, a result is missing, or a result is doubled.
   Caveat: in the tree I read, the sender is simulated. Whether the real build replaces it with a database call is unknown. If the number clears but the bracket never changes, that is the bug to report.

**G4. Live bracket** (everyone, signed out too) - new, not yet tested against the real database
1. On a second phone, open the public bracket for the competition while a result is entered on the first.
   Expected: the new result and the advancing winner appear without a manual page reload, or after a pull to refresh. Say which.
2. Check readability at phone width: names not cut off, current fight obvious, no sideways scrolling.

**G5. Reopen a result** (organizer) - new, not yet tested against the real database
1. Reopen a finished match, give a reason (3 or more characters). Expected: match goes back to "scheduled" with no score, the winner is removed from the next match's slot, and the action is recorded in the audit log.
2. Try to reopen a match whose next match is already finished. Expected: refused with a plain message, "reopen that one first".
3. Re-enter a different winner. Expected: the bracket follows the new winner.
4. Try the same reopen as a non-organizer (marshal). Expected: refused.

## What to report

Copy this into a message for each problem. One problem per message. A screenshot is worth more than a paragraph.

```
Step:            (for example E2 step 1, or G3 step 3)
Who I was:       (signed out / fighter / captain / volunteer / marshal / organizer) and the email I used
Phone and browser: (for example iPhone 14, Safari / Pixel 7, Chrome)
Signal:          (wifi / mobile data / airplane mode)
What I did:      
What I expected: (use the Expected line in this plan)
What happened:   (exact words on the screen, red text included)
Screenshot:      (attach)
Time it happened: (to the minute, so it can be found in logs)
How bad:         blocker (cannot register or cannot score) / annoying / cosmetic
```

If something works, say so too. "Part E all passed on iPhone Safari" is useful.

## Known gaps and risks

Stated plainly. None of these have been fixed by this document.

* **Waiver text.** The seed file contains the owner's HACSA waiver verbatim as version 1 for the real event (`supabase/seed/red_deer_rumble_2026.sql`). It names "Historical Armored Combat Sports Association" and also "the company" and "Heavy Armoured Combat Society of Alberta" as written in the source, and a pass over it has not been done by a lawyer or by HACSA. `docs/PROJECT_SPEC.md` still lists the waiver text as open. A throwaway event will use a made-up waiver, so testing proves the mechanism (version, typed name, time stored), not that the wording is right. The app stores who, when and which version.
* **Round structure.** Rounds-to-win for group fights is a per-competition setting because the Buhurt Regulations round structure was not available (`docs/PROJECT_SPEC.md`, `README.md`). Anything that shows a round count in testing is a placeholder, not rules. Weapon charts and armour requirements are not in the app.
* **Tier question.** The owner first said Exhibition, then the live form announced an official BI tournament. Tier is unresolved and the seed leaves it unset on every competition on purpose (`supabase/migrations/20261001000600_tier_optional.sql`). No league points are computed without a tier. Two BI documents also disagree on the Regional and Conference multiplier; both are shown, the owner decides (`README.md`).
* **Email codes (SMTP).** The plan is for codes to go through the owner's Gmail with an app password until a domain exists (`docs/PROJECT_SPEC.md`). Nothing in this repo shows whether that is configured. The built-in Supabase email sender has strict hourly limits, so a group of testers all requesting codes at once could be throttled or delayed. Part A step 2 asks you to record delivery time and sender because of this. Codes landing in spam is likely with a Gmail sender.
* **Google sign-in.** Button and code exist; the provider setup in Supabase and Google is unverified.
* **Creating events and teams has no screen.** Part B needs SQL. Teams proposed by users, captain tools, merging duplicates and approving new teams in the UI do not exist; `approve_team` is a database function only. HACSA seed teams have no captain (`supabase/seed/hacsa_teams.sql`).
* **Organizer approval** (the owner approving organizers once) is a manual database row (`platform_roles`), not a screen.
* **Staff roles.** Marshal, scorekeeper and medic can be added, but this plan could not confirm any screen yet restricts or unlocks by those roles. The medic can read medical notes at database level (`private.can_read_health`); there is no medic screen in the real app.
* **Medical note retention.** The form promises deletion 30 days after the event. A function `private.purge_medical_notes` exists in `supabase/migrations/20261001000300_registration.sql`; I did not verify it is scheduled to run. Do not use a real medical note in the test.
* **Form gaps against the owner's live form** (`docs/PROJECT_SPEC.md` corrections): no "other" volunteer role, no separate volunteer safety form, no Marathon team field beyond a teammate name, no melee captain field, no "other hours" availability box beyond one free-text note. The form requires an emergency contact, which the owner's form also has.
* **Insurance.** The form offers five choices; the organizer screen has a "proof received" value the form does not (`src/data/manage.ts`). The rule "no cover means no fights" is shown as outstanding work on the card but is not shown as enforced anywhere I read.
* **Fees** are tracked by hand only; no payment.
* **Competition path** is new, assembled by several people at once, not run against the real database, and I could not read the Run tab, field scoring page or live bracket. The `/marshal` page in this tree uses invented fighters and a simulated sender, so "offline then online" proves the queue mechanics only until the real wiring lands. Bracket maths is covered by unit tests, but the two-step insert, the version check in finalize, and reopen with a next-match link have not been exercised end to end.
* **Not tested at all here:** Safari private-mode storage limits for the outbox, very slow mobile signal, two scorekeepers on the same fight, tiebreaks, big-screen mode, QR codes, notifications. Cut-first items per the spec are big-screen mode and QR extras.
* **Decision point.** The spec sets Oct 14 as the point to cut scope if the foundation is behind; registration is never cut (`docs/PROJECT_SPEC.md`).
