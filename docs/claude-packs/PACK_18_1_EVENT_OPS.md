# Pack 18.1: automatic event operations, OBS broadcast control and temporary event devices

Status: **implemented and locally verified on branch `pack18-1-event-ops`. NOT merged. NOT deployed. NOT applied to hosted Supabase. Nothing physical (real OBS, cameras, microphone, venue network, real phones) has been tested.**
Built on `main` `e880e09` (Pack 18, PR #38). Plan: `PACK_18_1_PLAN.md`. Exact interface: `PACK_18_1_CONTRACTS.md`. Parts: `PACK_18_1_DEVICES.md` (device client), `PACK_18_1_COMMAND_CENTRE.md`, `PACK_18_1_ANNOUNCER.md`, `PACK_18_1_CONTROLLER.md` (OBS companion). Runbooks: `docs/runbooks/PACK181_DEVICES.md` (event crib sheet), `PACK181_EVENT_LAPTOP.md` (stream laptop), `PACK181_HOSTED_ROLLOUT.md` (owner release steps).

## 1. What it is
| Part | What shipped |
| --- | --- |
| **C. Temporary event devices** | An event **session**, not a fake person: organizer creates a credential (label + role) → a 12-character code `XXXX-XXXX-XXXX` (+ QR carrying the code in the URL fragment only) → Edge Function `device-session` verifies it and opens a session → short-lived (10 min) JWT with a custom database role (`bos_event_device` / `bos_controller`) and `sub` = session id (**not** an `auth.users` row) + a long-lived session secret kept on the device. Authority is never in the token: the database re-checks session, credential, revocation, expiry and organization on **every** call. |
| **A. OBS controller** | `tools/obs-controller` ("Broadcast Companion"): a local Node 22 process on the stream laptop; its own controller credential; obs-websocket v5 over loopback with a 19-request default-deny allow-list (never starts/stops the stream, never reads stream settings); AUTO scene choice (`src/lib/broadcast/decide.ts`), manual override, Camera Off latch, reconnect/restart recovery, heartbeat to the Command Centre, loopback-only local screen. |
| **B. Music / ducking** | OBS-native: Compressor sidechain keyed to the announcer mic + Noise Gate (millisecond ducking is OBS's, release capped 1000 ms); the Companion only applies coarse policy (music muted during live fights and Camera Off, medical hold locked) and monitors. Guaranteed source = local licensed/stream-safe files in an OBS Media Source. **No Spotify / YouTube control, scraping, ripping or DRM workaround** (terms; see plan §10). |
| **D. Announcer view** | `/events/:event/announcer`: read-only live board (now fighting, official score, clock, up next with Ready / Not yet ready, coming up, results, tap-for-fighter-card). Only write: Emergency **Camera Off**. |
| Camera Off | Narrow safety capability (`camera_off_activate/release/state`), latched server-side, append-only `event_camera_log`, only a release RPC clears it. |
| Roles | `announcer` event role (new); **Secretary and Scorekeeper are one role** (`scorekeeper`, label "Secretary / Scorekeeper") with deliberate extra powers; Temporary Organizer / Event Admin device role (event-scoped). |
| Command Centre | Camera Off at the top; Event devices (create / replace / revoke / sign-out-all / show-once code sheet with QR + print / "usual set" of eight); Broadcast (controller heartbeat + revision-checked controls); names-only Staff; viewer-driven panels. |

## 2. Why not Supabase Auth users for devices (investigated, decided)
GoTrue's Auth hook can only select `anon|authenticated`; a device user would hold every `authenticated` grant (87 function grants / 176 `to authenticated` grants at the time), `handle_new_user` creates a profile per `auth.users` row (a device would become a "person"), and cleanup/enumeration semantics are wrong. Custom roles are **not** members of `authenticated`, inherit only `anon`, and have an explicit EXECUTE allow-list (`supabase/tests/device_allowlist.txt`: 14 pinned `anon` functions, **56** for devices beyond anon, **2** for the controller). The gate asserts exact set equality. Contingency "G′" (contained Auth users) is documented in the plan, not built.

## 3. Code, storage, expiry, revocation
- **Code:** 12 characters, Crockford base32 (no I/L/O/U), 60 bits, generated in the Edge Function from `crypto.getRandomValues`. Stored only as an HMAC-SHA256 verifier (pepper = Edge Function secret `DEVICE_CODE_PEPPER`, never in the database or repository). Shown **once**; a lost code is **Replace**d. Session secret: only its SHA-256 is stored. Sign-in: uniform 401 for wrong/expired/revoked/throttled after ≥ 350 ms; throttle 10 failures / 10 min / IP-hash and 100 global; the function never logs a body, code, secret or token.
- **QR:** `/device#c=XXXXXXXXXXXX` (fragment is removed with `history.replaceState` before anything runs); tested equal to the library's output for exactly that URL.
- **Persistence:** `localStorage['bos-device-session']`; refresh ~60 s before expiry, on visibility, on `online`; survives reload, sleep, PWA restart. iOS: Safari and the installed app do not share storage (enter the code again in the installed app).
- **Expiry (server, live):** event end = midnight starting `ends_on + 1` in `events.timezone`; access ends exactly 24 h later (`private.device_valid_at`); an optional per-credential `expires_at` can only be earlier. Boundary tested: the expiry instant is refused, 23:59 before is valid; Edmonton/other-timezone and DST cases in the gates.
- **Revocation:** revoke one, replace (old code + session die immediately), revoke all devices (controller untouched). A revoked/expired session loses even the counter functions (`assert_session_alive`).
- **Isolation:** a device belongs to one event; Event B's device cannot read or change Event A (tested at database, API and browser level). Public data never exposes auth ids, health, emergency or private contact data (leak scan of every captured API response and a data-only `pg_dump`).

## 4. Final permission matrix (as built; ✔ allowed, — denied)
Devices never match `organizer` or `medic`. Event roles are event-scoped. A person holding several roles gets the union.
| Action | Counter | Sec./Scorekeeper | Marshal | Head Marshal | Announcer | Temp. Organizer / Event Admin | Perm. Organizer | Super Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public reads (live fights, official scores, results) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Own counter seat (`counter_*`) | ✔ own event | — | — | — | — | — | ✔ | ✔ |
| Timer, round, discipline, call fight, finalize (`can_score`) | — | ✔ | ✔ | ✔ | — | ✔ | ✔ | ✔ |
| Reorder / plan / clear queue (`can_adjust_queue`) | — | ✔ | — | — | — | ✔ | ✔ | ✔ |
| Resolve conflicts, paper result, reopen (`can_resolve_results`) | — | — | — | ✔ | — | ✔ | ✔ | ✔ |
| Correct / void result | — | — | — | — | — | ✔ (audited as the device) | ✔ | ✔ |
| Check-in, inspection, weigh-in, readiness override | — | — | — | ✔ | — | ✔ (recorded with no person) | ✔ | ✔ |
| Build schedule, registrations admin, withdraw entry, health data | — | — | — | — | — | — | ✔ | ✔ |
| Command Centre read (`can_command`) | — | ✔ read-only | — | ✔ | — | ✔ | ✔ | ✔ |
| Send announcement | — | ✔ | — | — | — | ✔ | ✔ | ✔ |
| Announcement history | — | — | — | — | — | ✔ | ✔ | ✔ |
| Staff grant/remove (never `organizer`; names only, no emails) | — | — | — | — | — | ✔ | ✔ | ✔ |
| Create / revoke / replace devices, sign-out-all, controller credential | — | — | — | — | — | — | ✔ | ✔ |
| Event settings, publish, close, delete | — | — | — | — | — | — | ✔ | ✔ |
| Broadcast control (`set_broadcast_control`: Take / Holding / Break / Auto / music) | — | — | — | — | — | ✔ | ✔ | ✔ |
| **Camera Off ACTIVATE** | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Camera Off RELEASE** | — | — | — | ✔ | — | ✔ | ✔ | ✔ |
| Audit log read | — | — | — | — | — | — | ✔ | ✔ |
| Another event | — | — | — | — | — | — | own events | all |
Controller (`bos_controller`): public reads + `controller_state()` + `broadcast_controller_heartbeat()` only. OBS WebSocket password / stream key: never in BuhurtOS.
Owner-visible consequence: **permanent Scorekeepers gain** queue adjustment, announcements, read-only Command Centre and Camera Off; reverting needs a new additive migration. **Temporary Organizer also has head-marshal desk powers** (check-in, inspection, readiness override); the plan listed `check_in`/`inspector` roles instead, the build uses the head-marshal expansion and records device actions with no person.

## 5. Camera Off
Activate: Marshal, Head Marshal, Secretary/Scorekeeper, Announcer, Temporary Organizer, Permanent Organizer, Super Admin. Release: Head Marshal, Temporary Organizer, Permanent Organizer, Super Admin. Reasons: medical (first), privacy, camera problem, venue, other. Idempotent; only the release RPC clears; every action in `event_camera_log` (who/role/reason/time). The Companion treats the server state OR its local latch as off and keeps it off through new fights, AUTO changes, OBS drop/restart, Companion crash/restart and loss of internet; an unknown server state is "still off" if the last known answer was off. A medical Camera Off also locks the music muted until a deliberate resume. Camera Off never grants other broadcast control.

## 6. Controller architecture and AUTO policy
Reads the same public data as the Pack 14 overlay (never re-derives scene state) + `controller_state()`; polls (2.5 s, backoff to 10 s; Realtime is not used for the controller token). `decideProgram`: Camera Off beats everything; manual beats auto; AUTO **locks on the current live fight** (stays through live/pause/break/equipment/DQ and the result screens; releases only at quiet, a different fight on that Lyst, or a reopen); next choice = earliest first-live (from `lyst_rounds`), ties by organizer priority then field key, else earliest armed; 10 s dwell, 5 s no-re-take; Return to Auto reconciles without replay; no data yet = no decision. Score/clock/penalty changes cause zero scene switches (asserted by counting `SetCurrentProgramScene` calls). A scene changed by hand in OBS is put back in about a second (documented fallback: quit the Companion, or a local Take). Mapping: wizard maps scenes; unmapped Lyst stays unselected and is reported. Failure recovery drills are in `PACK181_EVENT_LAPTOP.md` §8.

## 7. Migrations (additive; none applied to hosted)
`20261015000100_pack181_event_sessions.sql` (credentials, sessions, throttle table, roles, `has_event_role` device branch, device-aware audit, counter-seat changes, session RPCs) · `20261015000200_pack181_roles_camera.sql` (`announcer` role, Scorekeeper/Temp-Organizer powers, `is_event_operator`, Camera Off, `announcer_readiness`) · `20261015000300_pack181_broadcast_control.sql` (broadcast control + controller status, controller RPCs, EXECUTE allow-lists). Schema fingerprint regenerated (1935 lines). Edge Function: `supabase/functions/device-session` (+ `_shared/deviceSession.ts`).

## 8. Test evidence (all LOCAL; labels matter)
| Level | Check | Result |
| --- | --- | --- |
| Repository | `tsc -b`, `tsc -p tools/obs-controller`, `vite build`, Companion bundle build | clean / succeeds |
| Unit | root `vitest run` | **1354 / 1354** (104 files; includes edge-function handler 19, decide 42, announcer 42, device client/session/code ~68, devices/broadcast views 38) |
| Unit (stand-in) | `tools/obs-controller` `npm test` | **186 / 186** |
| Database gates | `supabase/tests/run_all.sh` | **DATABASE GATE PASSED**: pack181_sessions 119, pack181_roles 113, pack181_broadcast 103 (new); pack18 36, pack16 90, pack15 61, pack14 69, pack13 220, pack09d 149 and all earlier gates; fingerprint, simulation, league, concurrency |
| Real stack + Chromium | `pack181-live` (8 devices + controller through the real handler: boundaries, revoke/replace/sign-out-all/expiry/throttle/isolation/audit/leak scan) | **176 / 176** |
| Real stack + Chromium | `device-live` (8 devices, each in its own browser context through the real `/device` page; phone 390×844 and tablet 820×1180; reload / fresh context / `?source=pwa` start; role restrictions; revoke; direct probes with each device token) | **82 / 82** |
| Real stack + Chromium | `cc181-live` (Command Centre panels; code shown once and found nowhere afterwards; QR; Temp Organizer; scorekeeper; live refresh keeps scroll/open sections/unsent draft) | **148 / 148** |
| Real stack + Chromium | `announcer-live` (3 viewports, live changes on a scrolled page, offline/reconnect, draft/anonymous/stranger, Camera Off, device token, privacy scan of 348+ responses) | **181 / 181** |
| **OBS stand-in (NOT OBS)** | `obs-live` (Companion vs `scripts/obs-standin`, real Postgres/PostgREST/handler; AUTO, manual, Camera Off latch through restarts/offline, audio policy, failures; every request on the allow-list) | **119 / 119** |
| Real GoTrue (REAL_AUTH) | `pack18-live` (email+password, codes, Command Centre) — normal sign-in unaffected | **68 / 68** |
| Regression (real stack) | pack13-live 88, pack14-live 63, pack15-live 42, pack16-live 66, eventday-live 78, finalize-live 126, broadcast-realtime 15, pack10-live 135, represented-team-live 108 | all pass |
| Regression (mocked, CI) | field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, pack12-app 74 | all pass |
Assertions changed **on purpose** because of owner decisions (not to hide failures): pack09a/09d/15/18 gates, pack15-live check 28, pack18-live B19/B22 (scorekeeper may now read the Command Centre read-only), eventday-live (scorekeeper reaches the queue rules), device-live regex/text. Each is explained in its commit.

### Known failures that are NOT caused by Pack 18.1 (identical on unmodified Pack 18 main `e880e09`, re-run there)
- `arena-live`: 2 failing checks (phone scoring buttons position; "a result on Field 2 leaves Field 1 alone").
- `pack09d-live` and `rumble-live`: "journey ran to the end … locator.click timeout" (rumble also "check-in and kit check are stored").
These were not fixed (unrelated; out of scope).

### `live-stability` (Pack 18): 46/47 on this branch at its default 60 % scroll position, 47/47 on `e880e09`
The failing check is desktop Command Centre "view kept" (check 3). **It is a position-sensitive weakness that already exists on Pack 18 main**, exposed because Pack 18.1 made the Command Centre taller (so the scenario's fixed 60 % scroll point lands elsewhere): on unmodified `e880e09`, setting the scroll point to 50 % fails phone Event day, and 70 % fails desktop Event day and desktop Command Centre (`STAB_SCROLL=0.5|0.7`, option added to the scenario). Cause: Chromium's scroll anchoring keeps the reader's visible row in place, while rows in the other column of the desktop two-column grid, and rows removed above the visible rows, shift by up to ~140 px. Phone/tablet single-column passes. **Not fixed here** (would need the desktop Command Centre columns to be independent); recorded as a follow-up. The scenario also now steps the anchor down to a real row instead of a whole section.

## 9. What is NOT verified
Hosted Supabase (custom-role JWT accepted by the Data API and Realtime; signing-key import/rotation; `GRANT anon TO bos_*` and grant to `authenticator`; Edge Function secrets, CORS, deployment with `--no-verify-jwt`); real obs-websocket/real OBS (response shapes, filter key names, studio mode, restart behaviour); ducking quality, pumping, noise gate; PA routing; real cameras/microphone; Windows DPAPI / macOS Keychain / `.bat` / `.command` launchers; the 4455 firewall and a phone failing to reach it; Realtime sockets (local stack polls); installed iOS PWA; physical phones/tablets; printing the code sheet on paper. See `PACK181_HOSTED_ROLLOUT.md` §6 and `PACK181_EVENT_LAPTOP.md` §10.

## 10. Release actions still required (owner)
Review → merge → CI. Hosted: follow `PACK181_HOSTED_ROLLOUT.md` in order (decide token-signing key; apply the three migrations with `apply_migration`; verify allow-list queries; set function secrets; deploy `device-session --no-verify-jwt`; import/rotate the signing key at least a day before the event; re-verify normal sign-in; then merge/Pages deploy; then create the event's codes). Then physical rehearsal per the two runbooks. Leaked Password Protection remains unavailable on the current Supabase plan (known limitation).
