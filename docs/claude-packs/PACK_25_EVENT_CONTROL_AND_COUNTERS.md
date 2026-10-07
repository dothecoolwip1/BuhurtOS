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
All run on 2026-10-07 in this container (Linux, Node 22, Chromium 1194, Postgres 16, PostgREST 12.2.3). Nothing ran against hosted Supabase.

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` (vitest) | 112 files passed, 6 skipped; 1403 tests passed, 6 skipped (new: `src/lib/eventPhaseView.test.ts` 6, `src/lib/eventControl.test.ts` 2; updated: `deviceRoutes`, `commandCentre`, `pushSupport`, `analytics`, `admin`, `teamManager`, `eventJourney`, `devices`, `lyst`, `deviceSession` tests) |
| `npm run build` | clean (chunk-size warnings as before) |
| `supabase/tests/run_all.sh` | DATABASE GATE PASSED (run at the end of the pack): `pack13_gate.sql` 259 checks, `pack181_roles_gate.sql` 133 checks, the allow-list check against `device_allowlist.txt` (76 entries), the fingerprint matches `schema.fingerprint.txt`, the tournament simulation and every earlier suite unchanged. |
| CI browser scripts (mocked Supabase, built app on :4180/:4181) | `field-pack03` 28/28, `sw-update` 28/28, `pack07-ux` 89/89, `pack08-entrants` 54/54, `pack12-app` 78/78 |
| `scripts/e2e/pack25-live.sh` (real local stack, pack13 fixture + the 5v5 fight) | **81/81** (final run after every fix; one earlier run found a real race: a phone signed out by staff that scanned the Counter QR again from the sign-in page got a hash change, not a reload, and sat on the sign-in form. The sign-in page now takes a QR link that arrives as a hash change.) |
| `scripts/e2e/pack13-live.sh` (Lyst Control, counter sections rewritten for the Counter QR) | first run 86/89: three wording / audit-action expectations were stale (the trainee's "never changes any score", the finished fight now reads "waiting for the next fight on this Lyst", `counter.bound` replaces `lyst.counter_assigned`); fixed in the script and re-run: **89/89** |
| `scripts/e2e/device-live.sh` (Pack 18.1 devices) | first run: check 22 expected the full identity bar on a counter phone (Pack 25 gives counters the compact bar); fixed in the script (and the counter section rewritten: a counter device binds itself, nobody seats it) and re-run: **82/82**. One product fix came out of it: the Event Control page no longer pre-judges a device by reading staff tables; the database decides. |
| `scripts/e2e/pack181-live.sh` (device roles, section 5 rewritten for `counter_bind` / `move_counter_session`) | **176/176** |
| `scripts/e2e/cc181-live.sh` (Command Centre panels, now Live ops; the usual set is four staff devices, the Fighters section starts folded) | **148/148** after three script updates. Two product fixes came out of its first runs: a device token in the ordinary session never asks the staff or registration tables, and an ended token counts as a refusal. |
| `scripts/e2e/pack18-live.sh` (Command Centre on a realistic event, now Live ops) | NOT RUN: it needs a real Supabase Auth (GoTrue) binary (`AUTH_BIN`), which this container does not have. Its addresses were rewritten to Event Control; its checks on the Command Centre page itself overlap `cc181-live` and `pack25-live`. |

## 7. Browser verification and screenshots
Real stack, real Chromium; `scripts/e2e/pack25-live.mjs` is the record. Screenshots under `docs/reviews/assets/2026-10-07-pack25/`:

| Journey | Screenshot(s) |
| --- | --- |
| Public event while LIVE (visitor, 390×844): status, dates, venue, Overview / Live / Results, per-field NOW / ON DECK / IN THE HOLE | `p25-public-live-390.png`, `p25-public-live-390-full.png` |
| Overview and Results while live | `p25-public-overview-390.png`, `p25-public-results-390.png` |
| Public event UPCOMING (leads with Overview, register CTA) and COMPLETED (leads with Results) | `p25-public-upcoming-390.png`, `p25-public-completed-390.png` |
| A signed-in fighter: MY NEXT FIGHT · UP NOW first, their fight marked on the field | `p25-fighter-on-deck-390.png` |
| Event Control › Live ops (organizer) | `p25-control-live-390.png`, `p25-control-live-390-full.png` |
| Event Control › Set up (journey, next step, tools) and › Results | `p25-control-setup-390.png`, `p25-control-results-390.png` |
| Live ops for the head marshal (no mode switch) | `p25-control-live-headmarshal-390.png` |
| The Counter QR shown from Live ops | `p25-control-counter-qr-390.png` |
| Counter phone: who → which Lyst → which side → waiting → counting → handoff → second phone (blue) → next fight followed | `p25-counter-01-who-390.png` … `p25-counter-08-next-fight-390.png` |
| The Lyst (768): counters as evidence; the Counters sheet | `p25-lyst-evidence-768.png`, `p25-lyst-counters-sheet-768.png` |
| Counters and devices tool; device preview (read only) | `p25-devices-tool-390.png`, `p25-devices-preview-390.png` |
| Platform › Devices (owner) | `p25-platform-devices-390.png` |
| Team fight: RED 5 STANDING / FIGHTER DOWN; the group board's counter evidence | `p25-team-standing-390.png`, `p25-team-board-evidence-768.png` |
| Other viewports: public Live, Live ops and Set up at 360×800, 768×1024, 1024×768, 1280×900 | `p25-public-live-*.png`, `p25-control-live-*.png`, `p25-control-setup-*.png` |

Every page above was checked for sideways scroll at its viewport and for page errors (none).

## 8. Unresolved problems
- The Arena (public big screen) prefers Lyst official totals once a round exists; for group fights the confirmed rounds equal rounds won, so a 5v5 shows rounds, not fighters standing. Accepted for this pack.
- `private.event_field_keys` is the server's field list for a move; the Move sheet offers `Field 1..field_count` plus fields seen on other phones and a free-text field. A typo is refused by the database with a plain message.
- The local-only live scripts other than `pack25`, `pack13`, `device`, `pack181`, `cc181` and `pack18` had their addresses rewritten mechanically (`/manage?tab=…` → Event Control) but were not re-run in this pack.
- `scripts/e2e/pack18-live.sh` could not run here (no GoTrue binary); see section 6.
- Nothing here was tried on a physical phone, iOS Safari or the hosted stack.

## 9. Hosted database and deployment (rollout attempt, 2026-10-07)

The rollout was attempted from this session against the hosted project `mvbxlebznlgroptwwdsm` and the GitHub Pages site. The real state at the end of the session, with the evidence for each line:

| Layer | State | Evidence |
| --- | --- | --- |
| Repository | COMPLETE (Pack 25 + the rollout files below), PR #54 open against `main`, CI green on the branch | `https://github.com/dothecoolwip1/BuhurtOS/pull/54`; "CI and Deploy" run 159 on `886e2f9` success |
| Hosted migration `20261020000100_pack25_counter_pool` | NOT APPLIED, nothing applied in part | ledger `max(version) = 20261007031625`, no `pack25_counter_pool` row, 0 of the 3 new tables, 0 of the new RPCs, the 3 old RPCs still present, re-checked 11:22 UTC |
| Edge Function `device-session` | NOT redeployed (version 6, the pre-Pack-25 source, still serving) | `get_edge_function` source compared with `main`: identical; the Pack 25 change is the `create` action only |
| Frontend | NOT deployed (the live bundle is `assets/index-DC9aFdBv.js`, the pre-Pack-25 build of `main` `7e69f8c`, Pages run 158) | one-shot Actions probe (run 37612455735) and the baseline production check (section 9.4) |
| Hosted verification | PREPARED, DRY-RUN LOCALLY, NOT RUN ON HOSTED (it cannot run before the migration) | `supabase/tests/hosted/pack25_hosted_verify.sql`, local dry run via `run_pack25_verify_locally.sh`: no FAIL |
| Physical phones / tablets / iOS Safari / a camera scan | NOT VERIFIED (no physical device in this session) | – |

### 9.1 Preflight (read-only), what was found
- Branch `ccr-cf597ddb-ehfkck` is 20 commits ahead of `origin/main` (`7e69f8c`), 0 behind; `main` deploys through `.github/workflows/pages.yml` (typecheck, unit tests, build, the database gate, the release policy `vars.PRODUCTION_FROZEN`, deploy-pages) to `https://dothecoolwip1.github.io/BuhurtOS/`.
- Hosted ledger: last version `20261007031625`; `20261007024220 result_revisions_search_path` is the hosted name of the repo's `20261019000300`, so the migration order is right. No Pack 25 object exists: `event_credentials_kind_check` still allows `device`/`controller`, `lyst_matches_counter_input_check` still `simple`/`weighted`, no `counter_bindings`, `counter_operator_log`, `lyst_field_current`, no `event_sessions.multi`, no `lyst_counts.operator_name`.
- Hosted data: 21 events, 123 competitions, 857 matches, 15 device credentials (8 active), 7 device sessions (1 open: the owner's `Secretary Tablet` on `testing-stuff-v3`), 1 lyst match, 0 counter seats, 0 counts, 1 join code. `red-deer-rumble-2026` is the real published event (Nov 14–15); `red-deer-rumble-test`, `rocky-mountain-rumble-test` and the other `-test` events are synthetic; `testing-stuff-v3` is the owner's live test event (Oct 6–13).
- Function drift: the migration patches six hosted functions with `pg_temp.bos_patch` (it raises if an anchor is missing). `md5(pg_get_functiondef(...))` on hosted equals a local build of `origin/main` for every patched function (`replace_event_credential`, `device_open_session`, `device_refresh_session`, `create_lyst_join_code`, `counter_undo`, `private.lyst_seat_total` modulo a comment) and for every function the migration redefines (`device_ctx`, `counter_record`, `counter_state`, `lyst_open`, `lyst_state`, `lyst_match_final`, `lyst_counter_snapshot`, `lyst_seat_for_counting`, `create_event_credential`, `list_event_credentials`). Nothing on hosted drifted from the repo.
- Allow-list on hosted: 56 functions for `bos_event_device` (including the three to be dropped), 2 for `bos_controller`; 109 public tables, all with RLS; the roles exist.
- GitHub Actions holds no database URL, access token, service key or smoke account (probe run 37612455735: `db_url=false access_token=false service_key=false smoke_x=false smoke_y=false smoke_z=false`), so no automated path from CI to the hosted database exists, by design.

### 9.2 The genuine blocker: the migration
`apply_migration` (the whole file, once, as asked) timed out twice at the tool's 60 s limit, and so did a one-line probe that only creates and drops a `pg_temp` function. Any statement holding `drop` waits for an interactive confirmation this autonomous session cannot give (the same limit as Pack 24). Verified three times afterwards that nothing had been applied (no new object, no ledger row, no active query on hosted). Splitting the file into drop-free pieces would be a partial, hand-made reproduction of the migration, which the task forbids and which would leave the old RPCs and constraints in place; it was not done.

**Owner step (once, in the Supabase SQL Editor):** run `supabase/manual/hosted_rollout_pack25.sql`. It is the migration verbatim plus one ledger row (`pack25_counter_pool`), so the Supabase CLI never re-applies it. Expected: one transaction, no error; afterwards `select count(*) from public.counter_bindings` answers `0` and `select proname from pg_proc where proname = 'request_counter_seat'` answers nothing.

### 9.3 Order of the rest of the rollout (why nothing else was pushed first)
- The new `device-session` sends `p_pool_code` to `create_event_credential`; on the old database that signature does not exist (PostgREST 404), so deploying the function before the migration would break every staff device code. Held.
- The new frontend on the old database loses only the counter screens (friendly errors); the public and Event Control pages work. Merging PR #54 was still held so that one release carries all three layers in the right order.
- After the owner's step: (1) run `supabase/tests/hosted/pack25_hosted_verify.sql` on hosted (one DO block, synthetic fixtures, rolls itself back; local dry run: no FAIL) and the schema checks of section 9.5; (2) deploy `device-session` (files `index.ts`, `deno.json`, `../_shared/deviceSession.ts`, verify_jwt off, as today); (3) merge PR #54 and watch "CI and Deploy"; (4) run the production check (Actions › "Pack 25 production check (read-only)" › Run workflow, with the build number and commit the Pages run printed); (5) put its screenshots in `docs/reviews/assets/2026-10-07-pack25-hosted/`.

### 9.4 The production check and its baseline
`scripts/e2e/pack25-production-check.mjs` (read-only: never signs in, never writes) opens three published test events by phase at 390×844, 360×800, 768×1024, 1024×768 and 1280×900, the legacy addresses, the workstations signed out, Platform › Devices as a visitor, the device page with a code that cannot exist (the deployed function answers from the real origin), and the function's own refusals and CORS directly. It ran first against the real local stack: 105 of 108 (the three misses are local only: the local function allows every origin, and the local bundle label). Its one-shot workflow `.github/workflows/pack25-production-check.yml` ran against the live site before the rollout as the baseline; the result is in section 10, item 31.

### 9.5 Hosted schema checks to run after the migration (read-only)
New tables with RLS (`counter_bindings`, `counter_operator_log`, `lyst_field_current`); `event_sessions.multi`, `lyst_counts.operator_name`, `event_credentials.pool_code` with `event_credentials_pool_code_check`; `event_credentials_kind_check` = device/controller/counter_pool; `lyst_matches_counter_input_check` = simple/weighted/standing; the 12 new RPCs present and `request_counter_seat`, `assign_counter_seat`, `carry_counter_seats` gone; the `bos_event_device` allow-list equal to `supabase/tests/device_allowlist.txt`; `md5(pg_get_functiondef)` of every changed function equal to a local build of the branch (`supabase/tests/build_scratch.sh`); the ledger row.

## 10. Final handoff (the 27 items)

1. **Problems found before the redesign.** One event had seven overlapping staff surfaces: the public Event page with an organizer panel, Manage with 13 tabs (four "primary" plus "More options"), Event home, Event day, the Command Centre at its own address, Build tournament and Run as separate tabs doing adjacent jobs, and device entries (CommandEntry, DeskEntry, ScorekeepingPanel) scattered on the public page. The public page mixed the fighter's own fight, registration, live fights and results in one scroll with no phase awareness. Counters needed a device code per phone, then a Lyst join QR, a seat request, operator approval and a manual fighter A/B assignment (9 steps), and a phone was bound to a fighter, so every new fight needed re-seating or a carry-over.
2. **New public IA.** `/events/:slug` leads with its phase (Overview before, Live during, Results after); `/overview`, `/live`, `/results` are the three destinations, one tap apart in a sticky switch under a compact header (status, name, dates, venue, one primary CTA, the staff door). Live shows NOW / ON DECK / IN THE HOLE per field with the official clock and score (`LiveFields`, from `useLiveMatches` + `lyst_public_state`); MY NEXT FIGHT comes first for a signed-in fighter while live; Results is the record when complete. Phase is decided by `eventPhaseOf` in the event's time zone.
3. **Event Control.** `/events/:slug/control`, the one staff door, phase aware: Set up (the Pack 09D journey plus the set-up tools), Live ops (the Command Centre and Event day merged: attention, fields with queue commands, workstations, Counter QR, readiness, progress, fights, broadcast, announcements, staff, device codes), Results (finalization and closeout). Tools open with `?tool=` and return to their mode. Non-organizer staff (head marshal, secretary, Event Admin tablet) get Live ops only; strangers are told plainly.
4. **Fate of the old screens.** Event home → Set up mode (`SetupMode.tsx`). Event day → merged into Live ops (`LiveOps.tsx`). Command Centre → merged into Live ops. The 13 Manage tabs → 11 tools (`src/lib/eventControl.ts`) plus the three modes; `ManagePage.tsx`, `CommandCentrePage.tsx`, `EventHomeTab.tsx`, `EventDayTab.tsx` and `CommandEntry` are deleted. The organizer panel, scorekeeping panel and desk entry are gone from the public page (devices keep their own home, `DeviceHome`, which now points at Live ops).
5. **Legacy routes.** `/manage?tab=…` → `legacyManageTarget(tab)` → Event Control mode + tool, carrying `match`, `competition`, `focus`, `closeout`, `created`, `notes`; `/command` → `control?mode=live` (in the device app too). Every in-app link was rewired (`commandCentre.ts`, `FieldBoardView`, `ReviewSheet`, `SetupTab`, `FightersTab`, `BuildTournamentTab`, `FinalizeTab`, `RunTab`, `MyEventsPage`, `NewEventPage`, `notificationView`, `DisciplineLogPage`, `BroadcastPanel`, `DeviceHome`); `pushSupport`, `analytics` and the admin page labels know the new address. Browser checks 23–26.
6. **Counter architecture.** One `counter_pool` credential per event with a plaintext code (the Counter QR). Each scan opens its own `event_sessions` row (`multi = true`), never signing another out. The phone binds itself: `counter_bind(field, side, operator)` writes `counter_bindings` and creates an official seat on the field's current match (`lyst_field_current`). `lyst_open` sets the field's current match under an advisory lock and `private.counter_rebind_field` re-seats every bound phone on it (a field never binds counters to two open matches); a final match clears the field. `counter_record` writes `operator_name` on every tap. Counters are evidence only: the snapshot is frozen into `lyst_round_revisions`, never used for a score.
7. **The Counter QR.** Made once by the organizer (Live ops › Counter QR or Counters and devices; the Lyst offers the same card and says who may make it). Shown by anyone who may score (`counter_pool_code`), from Live ops, the Lyst's Counters sheet and the devices tool. Low privilege: a pool session can only count (`bos_event_device`, allow-listed functions only).
8. **Operator logging.** The operator name is asked once at scan (and on every handoff via NEW COUNTER); it is written on every tap (`lyst_counts.operator_name`), kept in `counter_operator_log` (append-only, previous turn closed at the handoff), readable through `counter_operator_history` ("Who held it"). The tally of the fight carries on through a handoff; nothing is reset.
9. **Multiple counters per side.** Any number of phones per side; each is its own seat with its own tally; the Lyst lists them one by one (operator, side, tally, online, submitted). Nothing is summed, averaged or voted; the marshal's confirmed rounds are the only score (browser checks 52–56; gate `pack13_gate.sql`).
10. **Training.** The Lyst's join code is now the training QR (`/lyst/train/:code`, 12 h): a signed-in trainee gives a name and a side, counts along, is listed apart as learning, never official, never on the public display (Pack 13 live checks 20–22, 38, 71–76).
11. **Team fights.** `counter_input = 'standing'` for buhurt/NvN: the group board offers Start/End round for counters (`GroupCounterRounds`), a counter phone shows RED 5 STANDING / FIGHTER DOWN / UNDO (`per_side` from the category), evidence only (browser checks 67–72).
12. **Device management.** Event Control › Counters and devices (organizer): the Counter QR, every phone signed in (operator, Lyst, side, online), Move, Device preview (read only), Who held it, Sign out, plus the Pack 18.1 device codes. Platform › Devices (owner): the same list across events. No impersonation: `move_counter_session`, `end_event_session` write with an audit entry; `device_session_preview` reads `private.counter_state_for(session, touch=false)`.
13. **Migrations.** One, additive: `20261020000100_pack25_counter_pool.sql` (section 4). Allow-list and fingerprint regenerated.
14. **Security.** Own session / own seat only (`private.counter_session`, `lyst_seat_for_counting`), own event (`device_ctx`), live round and round number checked by `counter_record`, final matches refuse, idempotent commands, revocation and expiry (`assert_session_alive`, 24 h after the event), public Arena shows no counter data, training seats are learning-only, the pool can only count. Directly tested in `pack13_gate.sql` (259) and `pack181_roles_gate.sql` (133) and in the browser (Pack 13 live checks 69–76).
15. **Files changed.** `git diff --stat fcda313^..HEAD` on the branch; the main ones: `supabase/migrations/20261020000100_pack25_counter_pool.sql`, `supabase/functions/_shared/deviceSession.ts`, `src/lib/{eventPhaseView,eventControl,devices,commandCentre,deviceRoutes,pushSupport}.ts`, `src/lib/lyst/counters.ts`, `src/data/{devices,lyst,api}.ts`, `src/pages/EventWorkspace.tsx`, `src/pages/event/{EventHeader,LiveFields}.tsx`, `src/pages/control/{EventControlPage,LiveOps,SetupMode,RegistrationsTool,ProgressPanel,LegacyRedirects}.tsx`, `src/pages/lyst/CounterPage.tsx`, `src/pages/platform/PlatformDevicesPage.tsx`, `src/components/command/{CounterQrCard,DeviceSessions}.tsx`, `src/components/lyst/{CountersPanel,LystScoring}.tsx`, `src/components/scoring/GroupCounterRounds.tsx`, `src/components/DeviceBar.tsx`, `src/App.tsx`, `src/DeviceApp.tsx`, styles, tests, scripts, docs.
16. **Tests and exact results.** Section 6.
17. **Browser journeys verified.** Section 7 and the two live scripts (`pack25-live.mjs` 81 checks; `pack13-live.mjs` 89 checks).
18. **Viewports.** 390×844 and 360×800 (phones), 768×1024, 1024×768, 1280×900; no sideways scroll on any page checked.
19. **Screenshot paths.** `docs/reviews/assets/2026-10-07-pack25/p25-*.png` (40 files; section 7).
20. **Known limitations.** Section 8.
21. **Incomplete.** Nothing in the requested scope is left unbuilt. The other local-only live scripts (rumble, pack09d, pack23r, finalize, …) had their addresses rewritten but were not re-run.
22. **Not verified.** Physical phones/tablets, iOS Safari, a real camera scan, hosted Supabase (Auth, Realtime, the deployed Edge Function), production data.
23. **Production database touched?** No. Nothing was applied to hosted Supabase.
24. **Deployed?** No.
25. **Accessibility.** RED/BLUE are words as well as colours on every counter screen, the Lyst's evidence lists and the device rows; buttons carry `aria-label`s; the live field list is `aria-live="polite"`; the official score has a spoken label; the counter's standing number is an `<output>`.
26. **Documentation.** This file; `docs/runbooks/PACK25_EVENT_CONTROL_AND_COUNTERS.md`; superseded notes on Packs 09A, 09D, 13, 18, 18.1 (Command Centre, Devices); runbooks `PACK181_DEVICES.md`, `PACK13_REAL_DEVICE_CHECKLIST.md`, `PACK181_REHEARSAL_CHECKLIST.md`; `STATUS.md`.
27. **Hosted rollout.** Attempted on 2026-10-07; section 9 has the real state and the owner's one step (`supabase/manual/hosted_rollout_pack25.sql` in the SQL Editor), then the verification block, the function, the merge and the production check in that order.

## 11. Hosted rollout report (the 32 items, 2026-10-07)

1. **Preflight.** Done, read-only (section 9.1): branch 20 ahead of `main`, 0 behind; hosted ledger ends `20261007031625` with `result_revisions_search_path` (= `20261019000300`) present; no partial Pack 25 object; hosted function bodies equal a local build of `main` (md5 of `pg_get_functiondef`) for every function the migration patches or redefines; `device-session` v6 equals `main`; Pages via `pages.yml` on push to `main`; live bundle `index-DC9aFdBv.js`.
2. **Merge.** NOT merged. PR #54 is open and green ("CI and Deploy" 159, 161 and 162 on the branch). Held on purpose until the migration is on hosted (section 9.3).
3. **Migration on hosted.** NOT applied, nothing applied in part (section 9.2). Genuine external blocker: the hosted migration tool times out on any statement that drops (interactive confirmation). Owner step: run `supabase/manual/hosted_rollout_pack25.sql` once in the SQL Editor.
4. **Schema verification on hosted.** NOT run (needs the migration). The read-only check list is section 9.5; the journey block is `supabase/tests/hosted/pack25_hosted_verify.sql` (dry-run locally on a Pack 25 build: every check PASS, every refusal the expected code, `confirm=ok`, official `3-1`, frozen evidence `Nathan:6,Odin:6,Taylor:1`, audit `counter.bound=7, counter.moved=1, counter.operator=1, device.session_ended=1, lyst.counters_followed=2, lyst.field_current=4, lyst.trainee_joined=1`; then rolled back).
5. **Edge Function.** NOT redeployed (v6 pre-Pack-25 serving). Deploying it before the migration would break staff device codes (the new `create` sends `p_pool_code`). Ready to deploy from `supabase/functions/device-session/` the moment the ledger carries `pack25_counter_pool`.
6. **Function behaviour on hosted.** The pre-Pack-25 function was checked read-only from the live origin and directly (section 9.4 baseline: CORS preflight, foreign origin, wrong code, garbage, unknown secret refresh, idempotent sign-out, create without a person, unknown action, GET, no leakage). Pool sessions, several phones, event isolation and the ended-session rule can only be exercised after the migration (the verification block covers them in the database; the production check covers the function's refusals).
7. **Frontend.** NOT deployed; production still serves the pre-Pack-25 build (Pages run 158, `main` `7e69f8c`). The release path is unchanged: merge PR #54, "CI and Deploy" prints the build number and commit.
8–9. **Hosted public event pages (upcoming / live / completed) and Event Control.** NOT verified on hosted (the old build is live). The read-only production check is written and proven on the real local stack (105/108, section 9.4); it runs by hand from Actions after the deployment, against `red-deer-rumble-test` (upcoming, synthetic), `testing-stuff-v3` (the owner's live test event) and `rocky-mountain-rumble-test` (completed, synthetic). Signed-in Event Control journeys on hosted need the owner's own account or a pre-confirmed test account; none exists for this session.
10. **Legacy routes on hosted.** Covered by the production check (seven redirects, `match=` kept, sign-in asked, no loop, no 404); not yet run on the new build.
11. **Workstations on hosted.** Covered by the production check (Exit to Event Control / Exit to Event, the desk, the big screen without counter data, the announcer, Platform › Devices refusing a visitor); not yet run on the new build.
12–14. **Counter flow, training, team fights on hosted.** NOT verified on hosted. The database side (bind, follow, handoff, several phones per side, training apart, standing 5→0, isolation, expiry, revocation, the legacy code) is the verification block of item 4; the phone side is the local Pack 25 and Pack 13 live scripts (81/81, 89/89).
15. **Device management on hosted.** NOT verified on hosted; `list_event_device_sessions`, `move_counter_session`, `device_session_preview`, `end_event_session`, `platform_device_sessions` are walked in the verification block (move, preview read only, sign out one, the ended session refused, rescan).
16. **Security and isolation on hosted.** The function's refusals were checked live (item 6); the database refusals (other seat, clock, finalize, confirm, stale round, other event, stranger, expired, revoked, ended session, bad training code) are in the verification block, to run after the migration.
17. **Viewports.** The production check uses 390×844, 360×800, 768×1024, 1024×768 and 1280×900 in real Chromium, each view in a fresh context; sideways scroll is asserted on every page.
18. **Hosted screenshots.** Folder reserved: `docs/reviews/assets/2026-10-07-pack25-hosted/` (empty until the check runs on the new build; the Actions artifact `pack25-hosted-screenshots` is the source). The local Pack 25 screenshots stay in `docs/reviews/assets/2026-10-07-pack25/`.
19. **Physical phones.** NOT tested: no physical phone, tablet or camera in this session. A real scan of the Counter QR is the one check left to a person (runbook step 6).
20. **Problems found and fixed during the rollout.** The production check's bundle marker used a test id that is built at run time (`view-${v}`) and never appears in the bundle; fixed before the first hosted run. No product defect was found, because the new build never reached hosted.
21. **Regression tests added.** None needed for a product change (none was made). The rollout files themselves: the verification block (its own PASS/FAIL list), the production check (108 checks), the local runner.
22. **Hosted data touched.** None. Every hosted call was a read (`select`), except the two `apply_migration` attempts that timed out before any statement ran (verified three times: no object, no ledger row, no active query).
23. **Secrets.** None read, printed or stored. The Actions probe printed only `true`/`false` for the presence of secrets (all false).
24. **Production commit / build.** Still Pages run 158, `main` `7e69f8c`, bundle `assets/index-DC9aFdBv.js`.
25. **Commits of the rollout.** `658d9b6` (probe workflow), `18c7c57` (probe removed), `5bc99f1` (rollout file, verification block, local runner, production check, its workflow), and the docs commit after it.
26. **Docs updated.** This file (sections 9, 10 item 27, 11), `docs/runbooks/PACK25_EVENT_CONTROL_AND_COUNTERS.md` ("Rolling Pack 25 out"), `docs/claude-packs/STATUS.md`.
27. **State, line by line.** Repository COMPLETE · migration NOT APPLIED · Edge Function NOT DEPLOYED · frontend NOT DEPLOYED · hosted verification PREPARED, NOT RUN · physical phone NOT VERIFIED.
28. **What unblocks it.** One owner action: the SQL Editor run of `supabase/manual/hosted_rollout_pack25.sql`. Everything after it (items 4, 5, 2, 7, 8–11, 18) is scripted and was rehearsed locally.
29. **Risk if the order is broken.** Function before migration: every staff device code creation fails (404 on `create_event_credential`). Frontend before migration: counter screens show a plain error, the rest works. Migration alone: the old frontend keeps working (it never calls the dropped RPCs on hosted today: 0 seats, 0 counts).
30. **Rollback.** The migration is additive apart from three dropped RPCs and two widened check constraints; the old frontend and function keep working on the new database. If needed, redeploy the previous function version (v6) from the dashboard and revert `main`; do not drop the new tables (history).
31. **Baseline production check before the rollout.** See the line added below once the run finished.
32. **Honest summary.** Nothing reached the hosted environment in this session. The only step that could not be done here is the one the hosted tool refuses without a person; everything else is ready, rehearsed on a real local stack, and written down for the owner.
