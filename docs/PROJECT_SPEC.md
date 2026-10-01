# BuhurtOS: project spec (owner decisions, 2026-10-01)

Single source of truth for what is being built and why. Every line below is a decision the owner made or a fact the owner
confirmed. Anything marked **assumed** was not confirmed and should be corrected.

## Goal and deadlines
* A full restart of BuhurtOS on a new frontend and a new Supabase project. The old app and its database are gone (the old
  hosted project was deleted on 2026-10-01). The new app is the only path to the event.
* **Nov 1, 2026:** public pages and **registration** work: people can see the event, sign up, organizers can review, and
  check-in is ready.
* **Nov 14 to 15, 2026 (Red Deer Rumble):** scoring and live brackets are hardened and used at the event.
* Audience priority: 60% competitors and spectators on event day (phone first), 20% organizers and marshals, 20% the
  year-round directory and rankings.
* If time runs short, cut first: the big-screen mode and QR code extras. Flag any other risk early.

## The event
Red Deer Rumble, Nov 14 to 15 2026, Horse in Hand Ranch, Blackfalds, Alberta. Hosted by Red Deer Reavers (a team, not an
organization). The owner describes it as HACSA-related; no endorsement or affiliation is displayed beyond what the owner states.
Not sanctioned by Buhurt International: tier **Exhibition**, no league points. Medium size (8 to 16 teams, 16 to 40 duelists).
Competitions to offer: men's 5v5, women's 5v5 and/or 3v3, men's 3v3, and the duel categories (longsword, sword & shield,
sword & buckler, polearm). The organizer turns on the ones that run. The current Google Form closes Nov 8, so registration
closes **Nov 8** (assumed to open when the app launches).

## Accounts, roles, permissions (enforced in the database)
* Sign-in: **6-digit email code plus Google**. No passwords. Until a domain is bought, email codes go out through the owner's
  Gmail (app password SMTP). Buy a domain after the Rumble if it works.
* Public viewing needs no account.
* The owner approves **organizers** once. Organizers create events and add their own marshals, scorekeepers and a medic by
  email. Roles are per event. Designed to extend to organizations later.
* One scorekeeper per field enters the result the marshals agree on. (Per-marshal scoring is a later option.)
* Teams: any signed-in person can create a team; **organizers approve new teams before they are public** and can merge duplicates.
* Public tables never carry account ids. Health and contact data is never public.

## Registration, waivers, privacy
* Anyone with an account may sign up; organizers review. Captains register teams; fighters register themselves for duels.
* In team events **each fighter individually** accepts the waiver, gives emergency info and is checked in.
* Waiver: **in-app acceptance** (typed name, agree, stored with who, when and waiver version). The owner supplies the waiver text; Claude writes no legal wording.
* Collected: emergency contact name and phone; a "medically fit" declaration; an optional medical-conditions/allergies note.
  The note is readable only by organizers and a medic role, never public, never in default exports, and auto-deleted 30 days
  after the event. Legal-age is a yes/no confirmation unless the owner asks for date of birth.
* Entry fees: **track only now** (organizer marks entries paid). Stripe is a later add-on; the paid status exists from day one.

## Competition running
* Draw: organizer chooses a reproducible random draw or manual placement. The app shows the BI structure advice for the entrant count.
* Group fight rounds-to-win is a per-competition setting (round structure from the Buhurt Regulations is not available to read yet).
* Offline: scoring works with no signal. Every action is saved on the device first and synced in order (outbox with idempotency ids).
* Two BI documents disagree on the Regional and Conference points multiplier; both are kept and shown; the owner decides later.

## Spectator and fighter extras (all wanted; big-screen and QR are first to cut)
"My next fight" for signed-in fighters; big-screen (TV) mode; QR code and share links; follow a team or fighter with notifications.

## Process
* Claude may merge its own PRs into the new repo when checks pass and apply migrations to the new Supabase project one at a
  time, reporting after each step. The owner can stop at any time.
* The owner and a few teammates test on real phones before Nov 1. Claude supplies a test plan and a throwaway event.
* The owner wants a **clickable admin mock** (registration review, check-in, run-the-day, event setup) reviewed before the real admin is built.
* Branding: name BuhurtOS stays; placeholder shield logo; GitHub Pages address for now.
* Design to keep: steel/brass/temper-band palette, condensed headline type, formats and tier pages, the marshal scoring screen.

## Data
Clean database. Only reference data is seeded (tiers, categories, with sources). No BI team import for now.

## Not decided / open
* The Buhurt Regulations round structure for group fights (owner: "not decided yet").
* The waiver text.
* Whether a "medic" role needs a separate sign-in flow or is just an event role (assumed: an event role).


## Corrections from the live registration form (owner pasted it 2026-10-01)
These override earlier assumptions above wherever they conflict.
* **Schedule:** Sat Nov 14 and Sun Nov 15, 10:00 to 18:00. Weapons check 08:00. Safety meeting 09:30 both days. Camping on site.
  Address: Horse In Hand Ranch, 39506 Highway 2 Service Rd, Blackfalds AB. Open to anyone.
* **It is announced as an official BI tournament.** This contradicts the earlier "not sanctioned, Exhibition" answer. Tier is
  **unresolved** (see open questions). BI rulesets apply to BI categories; **Sabre and Greatsword (in Marathon) follow HACSA rulesets**,
  which Claude has not been given.
* **Fighters need a BI fighter profile** or are moved to a separate bracket and likely do not compete for medals.
* **Competitions listed on the form:** Longsword, Sword and Shield, Sword and Buckler, Polearm, Sabre (each men and women);
  Triathlon; Marathon (a new 2-fighter relay: six one-round categories in order Longsword, Sword and Shield, Sabre, Polearm,
  Sword and Buckler, Short Axe or Greatsword; 10 s breaks; 2 pts per round win, 1 tie, 0 loss; most points wins; may run solo);
  Profight (men, women, by weight class; small classes handled on the day); Melees 3v3 (men), 5v5 (men), melees (women).
* **Teams** must exist before registration closes and are final; a fighter with no team does not fight. A fighter may ask to be
  placed as a **mercenary**.
* **Fee:** $40 for Alberta fighters. Fighters from outside the province, and people who mostly volunteer (fighting one category),
  do not pay. Paid by e-transfer to the Reavers before Nov 13, or cash on the day. Tracked by hand in the app.
* **Insurance:** HACSA members in good standing and MCC members are covered. Others show proof of insurance (by Nov 11) or sign up
  as temporary HACSA members. No cover means no fights.
* **Waiver:** HACSA's liability waiver text appears in the form (age of majority in Alberta, assumption of risk, indemnity).
  The owner supplied it; use it verbatim and versioned, do not edit it.
* **Form fields:** email, name, gender (male, female, other), emergency contact (name, relationship, phone), organization
  (HACSA, MCC, other), team, sharing equipment with another fighter (affects scheduling), days able to attend (Sat, Sun, other
  hours), categories, Marathon teammate and team, Profight weight, melee team and captain, "mercenary", volunteer roles
  (squire, points counter, marshal, runners, secretary, scheduling, ticket booth, other), fee acknowledgment, insurance status,
  waiver agreement, free-text notes. There is **no medical-conditions field**; the owner still wants an optional private note.
* **Volunteers** who assist fighters fill a separate safety/liability/tracking form.
* **Scheduling constraints:** fighters state which days they can attend and whether they share equipment. Missing Sunday risks
  forfeiting a final.
