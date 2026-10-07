# Pack 25: Event experience redesign and the counter workflow (2026-10-07)

Branch `ccr-cf597ddb-ehfkck` from `main` `7e69f8c`. This file is the durable record of the work: what was planned, what is done, what is open, and what was verified where. Levels are kept apart on purpose: **repository**, **local database**, **build / tests**, **browser verification**, **hosted database**, **deployment**.

Hosted Supabase and production were **not touched** by this pack (no migration applied, nothing deployed). See section 9.

---

## 0. The problems this pack fixes (as found in the repository on 2026-10-07)

**Events.** One real event had up to sixteen named destinations: the public event page (with Command Centre, Manage, check-in desk and scorekeeping cards stacked on it), Manage with 13 tabs (Event home, Registrations, Event day, Results, Build tournament, Check-in, Fighters, Run, Competitions, Event settings, People, Teams, Broadcast), the Command Centre (`/command`), Lyst Control per field, the check-in desk, Arena, Announcer, Broadcast, Discipline. Command Centre and Event day both answered "what needs attention right now?" from the same state (`commandAttention` and `attentionItems`), both listed the fields and the fights, and both carried an eight-link "quick actions" row. The public page showed registration, live, results and organizer cards in one scroll whatever the event's phase. The Lyst's Exit sent staff to the public page.

**Counters.** The normal counter needed two credentials (an event device code, then a Lyst join code), a seat request, a staff member to assign Fighter A or B, a slot limited to A-D, and a "carry seats" call for every next fight. `event_sessions_one_open` made every device code single-session, so the "usual set" of four named Counter Phones was the only model.

## 1. New information architecture

### 1.1 Public event (`/events/:slug`)
Three destinations, phase aware (`src/lib/eventPhaseView.ts`, pure, tested):

| Phase | Default view | Header leads with |
| --- | --- | --- |
| draft / upcoming | **Overview** | dates, venue, registration state, primary registration action |
| live (published, today inside the event's days in the event's time zone) | **Live** | NOW / ON DECK / IN THE HOLE per field, the signed-in fighter's own next fight first |
| completed (closed, or past its last day) | **Results** | official placings, event history |

Views: `/events/:slug` (Overview), `/events/:slug/live`, `/events/:slug/results`. Brackets and pools live inside Live while fighting and inside Results afterwards. Staff see ONE door: **Event Control**.

### 1.2 Event Control (`/events/:slug/control`)
Phase aware, three modes: `?mode=setup` (SET UP), `?mode=live` (LIVE OPS), `?mode=results` (RESULTS / CLOSEOUT). The default mode follows the phase. Deep tools open inside Event Control with `?tool=` (registrations, entrants, teams, staff, competitions, settings, build, run, broadcast, checkin, devices): the existing screens, not new ones.

- SET UP: the journey (eventJourney.ts), the one next action, and a checklist of setup jobs with complete / incomplete / blocked state.
- LIVE OPS: one hub that merges the Command Centre and Event day: event health and attention items, fields with NOW / ON DECK / IN THE HOLE and the running-order controls, fighter readiness, result conflicts, competition progress, counters and devices (Counter QR), announcements, Camera Off, broadcast, staff, and one row of workstations (Lyst per field, check-in desk, announcer, live display, broadcast overlay, cards and penalties, rules).
- RESULTS: the existing finalization flow (review wins and losses, blockers, make official, close, reopen with a reason).

### 1.3 Legacy routes
`/events/:slug/manage?tab=X` and `/events/:slug/command` redirect to the matching Event Control mode and tool. Workstation URLs are unchanged (`/field/:field`, `/checkin`, `/arena`, `/announcer`, `/broadcast/:id`, `/discipline`). Exit from a workstation launched from Event Control returns to Event Control (`?from=control`).

## 2. New counter architecture

| Concept | Where |
| --- | --- |
| Reusable **Counter QR** | `event_credentials.kind = 'counter_pool'` (role `counter`, one per event, multi-session). The plaintext pool code is kept on the credential (`pool_code`) because the credential is low privilege by construction (counter role only) and must be displayable by scoring staff (`counter_pool_code(p_event)`, `private.can_score`). Other credentials still store only a verifier. |
| Phone session | `event_sessions` (one row per scan; `multi = true` rows do not end each other). |
| Field / side / mode / operator binding | `counter_bindings` (session_id → event, field_key, side, mode `strikes` or `standing`, operator_name). `counter_bind`, `counter_set_operator`. |
| Operator history | `counter_operator_log` (append-only: session, operator, started_at, ended_at) and `lyst_counts.operator_name` on every tap. |
| The field's current Lyst match | `lyst_field_current` (event_id, field_key → match_id), written by `lyst_open` and cleared when the match is final. One row per field: a field can never bind counters to two open matches. |
| Auto rebind | `private.counter_rebind_field(event, field_key, match)`, called from `lyst_open`: every active seat on that field (device counters and trainees) is ended and re-created on the new match (same side, role, operator). Tallies are per seat per match per round, so the new fight starts at zero and the old evidence stays. |
| Tally | unchanged: `lyst_counter_seats` (now without slots), `lyst_counts`, `lyst_counter_rounds`, `counter_record` / `counter_undo` / `counter_submit`, idempotent ids, offline queue in the browser. |
| Training | the Lyst's join code becomes the **Training QR**: `join_training_counter(p_code, p_name, p_side)` seats a signed-in person as a learning counter on the field's current match at once (no approval). Learning seats follow the field too. |
| Team fights | `lyst_matches.counter_input = 'standing'`: a tap is "fighter down", undo restores; the phone shows fighters standing (per side from the category). Evidence only. The group board opens the match in Lyst Control and starts / ends rounds through the existing timer command so the same live-round guard applies. |
| Removed from the normal path | `request_counter_seat`, `assign_counter_seat`, `carry_counter_seats` (dropped), the Counters seating drawer, "Join as a counter", slots A–D. |
| Device management | `platform_device_sessions()` (owner), `list_event_device_sessions(p_event)` (organizer), `move_counter_session(p_session, p_field, p_side)`, `end_event_session(p_session, p_reason)`, `device_session_preview(p_session)` (read only). |

Security that stays: counter writes only through its own live seat; a device's seat is only on its own event; round must be live and match the request; final matches refuse taps; idempotent ids; revocation and expiry (`private.device_ctx()` on every call); the public view carries no counter data; learning seats cannot become official; finalization reads `lyst_round_scores` only.

## 3. Work log

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| 1 | Progress document | done | this file |
| 2 | Migration `20261020000100_pack25_counter_pool.sql` | planned | |
| 3 | Edge Function + device client for the pool | planned | |
| 4 | Counter phone rewrite | planned | |
| 5 | Lyst counters evidence panel, Counter QR, Training QR | planned | |
| 6 | Public event redesign | planned | |
| 7 | Event Control (Setup / Live Ops / Results), redirects, Exit | planned | |
| 8 | Platform device management | planned | |
| 9 | Tests (unit, gates, allow-list, fingerprint, browser) | planned | |
| 10 | Docs, cleanup, STATUS, handoff | planned | |

## 4. Migrations
(filled in as they are written)

## 5. Routes
(filled in as they change)

## 6. Tests
(exact commands and results)

## 7. Browser verification and screenshots
(journeys, viewports, paths under `docs/reviews/assets/2026-10-07-pack25/`)

## 8. Unresolved problems
(kept honest)

## 9. Hosted database and deployment
Not applied, not deployed. The migration is additive and must be applied in order after `20261019000300`. The Edge Function `device-session` must be redeployed (it learns the `counter_pool` kind).
