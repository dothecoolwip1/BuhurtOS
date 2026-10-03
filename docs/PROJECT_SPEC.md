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
  email; an event organizer may add another organizer to the same event. Roles are per event and should expire shortly after the event finishes. Designed to extend to organizations later.
* One scorekeeper per field enters the result the marshals agree on. (Per-marshal scoring is a later option.)
* Teams: any signed-in person can create a team; **platform administrators approve new teams before they are public** and can merge duplicates. Organization administrators manage teams within their own organization. Event organizers get **no** platform-wide team approve/merge/delete power merely because they organize an event (superseded by `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`).
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
* Connectivity (superseded 2026-10-03): there is **no** full offline-first requirement before the Rumble. The goal is resilience to brief outages: unsent scoring work is preserved on the device (durable queue bound to user and event), shown as Pending until the server accepts it, and synced in order with idempotency ids. **Match finalization requires signal.** **Paper score sheets are the primary official fallback**; BuhurtOS is the fast digital path and mirrors the official result. A fresh offline reload need not reconstruct the authenticated event workspace.
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
* The waiver text. (The HACSA waiver was later pasted from the live form and is loaded verbatim; see the corrections below.)
* The text or link for the separate volunteer safety, liability and tracking form (volunteers who assist fighters fill it in). Not supplied: the app shows an organizer-written note (Setup, "Volunteer information") or a visible placeholder, and invents no wording.
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

## North star: how it is applied (owner's statement is in `docs/VISION.md`; added 2026-10-01)
The test for every decision: *does this make BuhurtOS closer to the connected operating system for buhurt?*
**Sequencing (owner decision):** foundation first, then the Rumble on top of it. Event workspaces first; team and fighter workspaces follow the same pattern after the Rumble.
Dates unchanged: registration and public pages by Nov 1; scoring and live brackets by Nov 14. Decision point Oct 14: if the foundation is behind, cut claim flow, media links, season/ranking views and the organizations UI, never the registration path.

**Principles**
1. One identity per thing: one fighter record, teams with history, events as permanent records. A result entered once feeds fighter, team, event, season and ranking.
2. Open the thing and it becomes the workspace (event now; team and fighter later). Controls appear in place by role. No giant global menu.
3. Different audiences, different experiences, one design language: public energetic and understandable to a newcomer; fighter personal and mobile; marshal one-handed; organizer calm, "what needs attention"; platform owner restrained and separate.
4. Mobile is primary, not secondary.
5. Real data with provenance: every entered or imported fact has a source and a status (official / imported / unverified); disagreements are shown. A roster entry is not an account, a directory listing is not adoption, and nothing implies federation endorsement. No invented history; sample data never appears on public pages without a clear label.
6. Governance is not geography: team location says nothing about governing organization; relationships are explicit, sourced records.
7. Remove repeated work: registration -> entries -> matches -> results -> rankings flow without re-typing.
8. Plain language; permissions stay in the database.

**Connected model to add (additive migrations, nothing deleted):** `organizations`, `team_affiliations`, `team_memberships`, `rulesets` + `ruleset_versions`, `seasons`, `sources` + `record_sources`, `results`/placings with read-only history and ranking views, `media_links`, profile claim flow.
**Navigation:** small global nav (Home, Events, Teams, Fighters, Rankings, Learn, account); event workspace at `/events/:slug` with role-aware panels; field scoring at `/events/:slug/field/:field`; owner-only `/platform`.
**Out of scope until after the Rumble:** rankings pages, team and fighter workspaces, federation tools, video links, notifications, Stripe, domain.


## Owner decisions of 2026-10-03 (override anything above that conflicts)
Full text: `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`. Implementation packs: `docs/claude-packs/`.
* **Backend:** Supabase remains the backend, on the **Free plan for now**. No Supabase exit/portability project. One full independent production export before the Rumble, stored in two locations outside Supabase. Free-plan recovery limits are an accepted, documented operational risk.
* **Scope before the Rumble:** no full offline-first rebuild, no PowerSync/sync-engine migration, no Broadcast/CDN architecture, no new ranking engine, no further frontend rewrite, no cryptographic audit chaining. Expected scale: about 100 on site and about 30 remote live viewers.
* **Permissions:** platform administrators hold platform-wide team approval and merge. Organization administrators manage teams in their organization. Event organizers do not. `@buhurtos.ca` test accounts stay until after the Rumble, but their permissions are narrowed to their legitimate roles.
* **Scoring:** finalization requires signal; paper is the primary official fallback; an authorized "Enter Official Result" path allows transcription/correction from paper; conflicting final results need a human (head marshal) and never resolve by last-write-wins.
* **Test data:** synthetic data may stay in production if clearly labelled and excluded from official rankings, records and aggregates.
* **History:** official results are corrected, voided or superseded with an audit trail, never silently deleted. Team mergers preserve the original historical team identity and link it to the successor.
* **Identity:** one account represents one fighter; duplicates are flagged to administration, not auto-merged.
* **Priority:** reliability and features proceed in balance, but security, data-loss and sporting-integrity blockers win.
