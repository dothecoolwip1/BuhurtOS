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
| 2 | Migration `20261020000100_pack25_counter_pool.sql` | done | `supabase/tests/run_all.sh` (section 6) |
| 3 | Edge Function + device client for the pool | done | `supabase/functions/_shared/deviceSession.test.ts`, `src/data/devices.ts` |
| 4 | Counter phone rewrite | done | `src/pages/lyst/CounterPage.tsx`; browser journeys 42–59, 67–72 |
| 5 | Lyst counters evidence panel, Counter QR, Training QR | done | `src/components/lyst/CountersPanel.tsx`, `CounterQrCard.tsx`; journeys 54–56 |
| 6 | Public event redesign | done | `src/pages/EventWorkspace.tsx`, `src/pages/event/*`; journeys 1–13 |
| 7 | Event Control (Set up / Live ops / Results), redirects, Exit | done | `src/pages/control/*`; journeys 14–34 |
| 8 | Device management (event tool + Platform › Devices) | done | `src/components/command/DeviceSessions.tsx`; journeys 60–66 |
| 9 | Tests (unit, gates, allow-list, fingerprint, browser) | done | section 6 |
| 10 | Docs, cleanup, STATUS, handoff | done | section 10, `STATUS.md`, `docs/runbooks/PACK25_EVENT_CONTROL_AND_COUNTERS.md` |

## 4. Migrations
One additive migration, `supabase/migrations/20261020000100_pack25_counter_pool.sql`, after `20261019000300`:

- `event_credentials`: kind `counter_pool` (role `counter`), plaintext `pool_code` (the QR is not a secret: it can only count), one open pool per event (`event_credentials_pool_open`). `create_event_credential` gains `p_pool_code`; `replace_event_credential` refuses a pool; `list_event_credentials` reports `open_sessions`.
- `event_sessions.multi`: a pool credential opens a session per scan and never signs the others out (`event_sessions_one_open` applies to single-session credentials only). `device_open_session` / `device_refresh_session` patched; `private.device_ctx()` maps the pool to a device.
- `lyst_field_current` (one current match per field, written by `lyst_open` under an advisory lock, cleared when the match is final), `counter_bindings` (session → field, side, operator), `counter_operator_log` (append-only, guarded by trigger), `lyst_counts.operator_name`.
- `lyst_matches.counter_input` accepts `standing`; `private.lyst_per_side` (5v5 → 5); `counter_record` bounds standing taps by the side size.
- Phone functions (allow-listed for `bos_event_device`): `counter_bind(p_field, p_side, p_operator)`, `counter_set_operator(p_name)`, `counter_leave()`, `counter_state()`; `join_training_counter(p_code, p_name, p_side)` for a signed-in trainee; the join code is a training code (12 h).
- Staff functions: `counter_pool_code(p_event)` (anyone who may score; `can_create` for the organizer), `list_event_device_sessions`, `platform_device_sessions` (owner), `move_counter_session`, `end_event_session`, `device_session_preview` (read only), `counter_operator_history`.
- Dropped: `request_counter_seat`, `assign_counter_seat`, `carry_counter_seats`. `lyst_state` adds `field_current`, `per_side`, seats with `device`/`online`, `field_counters`; `private.lyst_counter_snapshot` adds `operator`, `device`, `submitted`.
- `supabase/tests/device_allowlist.txt` regenerated (76 entries); `supabase/schema.fingerprint.txt` updated.

## 5. Routes
| Address | What |
| --- | --- |
| `/events/:slug` | the public event, on the view its phase needs (Overview before, Live during, Results after) |
| `/events/:slug/overview`, `/live`, `/results` | the three public views |
| `/events/:slug/control?mode=setup\|live\|results&tool=…` | Event Control; tools: `competitions`, `registrations`, `entrants`, `build`, `run`, `settings`, `staff`, `teams`, `broadcast`, `devices`, `checkin` |
| `/events/:slug/manage?tab=…` | redirects into Event Control (`legacyManageTarget`), keeping `match`, `competition`, `focus`, `closeout`, `created`, `notes` |
| `/events/:slug/command` | redirects to `control?mode=live` (the device app too) |
| `/events/:slug/field/:field?from=control`, `/checkin?from=control` | workstations whose Exit returns to Live ops |
| `/lyst/counter` | the counter phone (device app); `/lyst/join*` and `/lyst/train*` on a device redirect there |
| `/lyst/train/:code` | a signed-in trainee's counter |
| `/platform/devices` | the platform owner's cross-event device list |
| `/device#c=<pool code>` | a phone scanning the Counter QR |

Removed pages: `ManagePage`, `CommandCentrePage`, `EventHomeTab`, `EventDayTab`, `CommandEntry`. Device landing for a scorekeeper or Event Admin tablet is `control?mode=live`.

## 6. Tests
(exact commands and results)

## 7. Browser verification and screenshots
(journeys, viewports, paths under `docs/reviews/assets/2026-10-07-pack25/`)

## 8. Unresolved problems
- The Arena (public big screen) prefers Lyst official totals once a round exists; for group fights the confirmed rounds equal rounds won, so a 5v5 shows rounds, not fighters standing. Accepted for this pack.
- `private.event_field_keys` is the server's field list for a move; the Move sheet offers `Field 1..field_count` plus fields seen on other phones and a free-text field. A typo is refused by the database with a plain message.
- The local-only live scripts other than `pack25`, `pack13`, `device`, `pack181`, `cc181` and `pack18` had their addresses rewritten mechanically (`/manage?tab=…` → Event Control) but were not re-run in this pack.
- Nothing here was tried on a physical phone, iOS Safari or the hosted stack.

## 9. Hosted database and deployment
Not applied, not deployed. The migration is additive and must be applied in order after `20261019000300`. The Edge Function `device-session` must be redeployed (it learns the `counter_pool` kind).
