# Pack 16: check-in, armour control and fighter readiness (2026-10-10)

Branch `pack16-readiness` from `main` at `8d71688` (Pack 14 and the Broadcast fix #35). Pack 15 merged to `main` (#36, `6d9f137`) while Pack 16 was in
progress; `main` was merged into this branch at `82f139b` with Pack 15 preserved as merged, and §6 was then wired into Pack 15's notifications.
Read with `STATUS.md` (Pack 16 section).

## 1. Investigation: what already exists (reused, not duplicated)
| Concept | Already there | Where |
| --- | --- | --- |
| Check-in and "kit passed" as current state | `registration_checks (registration_id, check_name in ('checked_in','kit'), passed, at)`; organizer-only `set_registration_check`, audited | Pack 01 registration migration |
| Admin blockers | insurance not in order, fee unpaid (`blockReasons`), "Check in anyway" | `src/registration/checkin.ts` |
| Organizer check-in screen | Manage › Check-in (`CheckinPanel`): search, filters, one-thumb Check in / Kit check | `src/pages/CheckinPanel.tsx` |
| Captain view | `team_clearance(event, team)` (captain or organizer): checked in, kit passed, insurance; no health data | `MyTeamPanel`, `lib/teamClearance.ts` |
| Event-day warning | Event day "Needs attention": fighters in the next fights who are not checked in | `lib/eventDay.ts checkinGaps` |
| Event roles | organizer, head_marshal, marshal, scorekeeper, medic; `has_event_role` (platform owner + org admins per existing rules) | Pack 01 / Pack 03 |
| Weight | profight registration asks for a declared weight (`registration_competitions.details.weight`); profight rules have weight classes in text only (no class configuration) | Pack 01, `content/rules.ts` |
| QR | `qrcode-generator` already used for the Lyst counter join code | Pack 13 |
| Audit | `private.audit(event, action, subject, details)` → `audit_log` (actor, time) | foundation |
| Queue | Pack 13/09 queue (`matches.queue_state`) is authoritative and untouched here |

Gaps: no inspection result beyond a yes/no that overwrites itself (a failure is never recorded, no issue, no inspector, no history); no
"arrived but not checked in"; no inspector / check-in-desk roles (check-in is organizer-only); no single readiness answer with reasons; nothing
on the Lyst screen; no weigh-in record; no QR for check-in; organizer-added entrants without a registration cannot be checked in at all (unchanged,
see §7).

## 2. State model (one record per registration for the event)
```
attendance:  expected → arrived → checked_in        (withdrawn / not accepted shown apart; undo is allowed and audited)
inspection:  not_inspected → passed | conditional | failed → (reinspection) → passed …   (history kept, latest is current)
admin:       insurance in order, fee paid           (existing rules, unchanged)
override:    none | active (organizer or head marshal, reason, audited; can be withdrawn)
READY  =  registration accepted  AND  checked_in  AND  (volunteer OR latest inspection = passed)  AND  no admin blocker
          OR an active override
```
Readiness is **derived, never stored**: one SQL function computes it for everyone (`event_readiness`), the same rule feeds the captain view and the
Lyst warning. Reasons are plain words: *Not checked in*, *Arrived, not checked in*, *Armour inspection required*, *Armour needs correction*,
*Armour failed*, *Insurance not in order*, *Fee not paid*, *Registration not accepted*, *Withdrawn*.

Compatibility: `registration_checks.kit` stays the "inspection passed" flag (every existing screen, CSV export and `team_clearance` keep working); it
is now written ONLY through an inspection record (passed → true, anything else → false). `set_registration_check(…,'kit',…)` keeps its signature and
writes an inspection record too, so there is one writer.

## 3. Roles (existing architecture, two roles added)
| Action | Who |
| --- | --- |
| Arrived / check in / undo | organizer, head marshal, **check-in desk** (new role `check_in`) |
| Inspect / reinspect | organizer, head marshal, **armour inspector** (new role `inspector`) |
| Weigh-in (profight entrants only) | organizer, head marshal, inspector, check-in desk |
| Readiness override | organizer, head marshal |
| Detailed notes, weights, history | organizer, head marshal, inspector, check-in desk |
| Readiness of the two sides of a fight (no notes, no weights) | the above + marshal, scorekeeper (Lyst staff) |
| Own team's readiness (no notes, no weights) | captains of that team |
A scorekeeper is not an inspector; a fighter cannot check in or clear themself; a captain sees but cannot change.

## 4. QR
The fighter's QR (on their own event page, "Check-in code") encodes only `…/events/<slug>/checkin?r=<registration id>`: an opaque id, no name,
no personal data. It grants nothing: the check-in screen is staff-only (the database refuses everyone else, and the page says so). Staff scan it with
the phone's own camera app (works on Android and iPhone without an in-browser scanner); the fallback is the search box (name, team, competition).

## 5. Lyst Control (Pack 13) and the queue
Nothing blocks or rewrites a fight. The Lyst screen shows a warning strip for a fight whose fighter is not ready ("Not ready: Brann Oakley:
armour needs correction"), from `match_readiness`. Event day keeps its existing "not checked in" attention item. A wrong readiness state can never
stop the event: the queue does not read it, and an override exists for the genuine exception.

## 6. Pack 15 (notifications): wired in, no second system
Migration `20261010000200_pack16_inspection_alerts.sql` adds two kinds to Pack 15's `notifications` and nothing else:
`inspection_needs_correction` ("Armour needs a fix: … Then go back for reinspection." / "Armour did not pass: … Talk to the inspectors before you
fight.") and `inspection_passed` ("Your armour passed inspection at …"). Group *events*, pushable, opens the fighter's event page. One AFTER INSERT
trigger on `registration_inspections` sends them to the registration's account and the fighter's linked accounts (dedupe key
`inspection:<inspection id>:<account>`), never to staff or captains. The inspector's note is staff-only and is **not** in the payload. Pack 15's
group / push / route / words functions are extended in place (each patch asserts its anchor, so a changed Pack 15 definition fails the migration
loudly instead of silently). Like Pack 15's producers, an alert failure never undoes the inspection. A reset sends nothing.

## 7. Not built (and why)
- Weight classes (the rules text has them, the product has no class configuration; inventing it would be a new rule system). Weigh-in records the
  measured weight beside the declared one, for profight entrants only, never public, never a blocker.
- Check-in for entrants with no registration (organizer-added profiles): there is no record to attach to; they are listed as "not tracked" and never
  counted as blocked.
- An in-browser camera scanner (unreliable across iOS/Android browsers); the phone camera + link is the scanner.
- Offline queueing of check-ins: an action shows *Saving…* until the server confirms; a failure says so and nothing is shown as saved.
