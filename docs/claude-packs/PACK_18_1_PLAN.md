# Pack 18.1 plan: automatic event operations, OBS broadcast control and temporary event devices

Status: **PLANNING ONLY (revision 2). Nothing here is implemented, migrated, deployed or merged.**
Revision 1: 2026-10-06 against `main` `90ff429`. Revision 2: same day, after the owner's follow-up decisions (see §0.2). Written on branch `ccr-ef74f1c4-1ks28z`; the only file this branch adds.

## 0. Gate, and what changed

### 0.1 Pack 18 is NOT merged (re-verified for revision 2)
- `origin/main` = `90ff429` (Pack 16 merge). No `PACK_18_*.md`, no Command Centre, no `20261012000100` migration on main.
- Pack 18 is PR #38, **open, not merged**, head `95bde75` (`pack18-command-centre`). Read only; never modified.
- **Implementation does not start** until the owner explicitly confirms the merge **and** I verify it against `origin/main` (PR `merged:true`, merge commit reachable from main, `PACK_18_COMMAND_CENTRE.md` and the migration present). Then: new branch from the NEW main (never from the Pack 18 branch), re-read the finished Pack 18 code, reconcile this plan, update it, then build.
- Everything below that mentions Pack 18 is from the unmerged branch and must be re-checked after merge.

### 0.2 Owner decisions folded into revision 2 (override revision 1)
1. **Secretary and Scorekeeper are ONE role.** The permission class is the existing `scorekeeper`. UI label: "Secretary / Scorekeeper". No `secretary` role is created. Missing event-day powers are added to `scorekeeper` deliberately (§13).
2. **Camera Off is a narrow safety capability, separate from OBS control.** Activation by more roles than OBS control; release only by senior roles; latched; audited (§7, §13).
3. **The streaming laptop is not a ninth device.** It has its own narrow machine credential (§3.3).
4. **Temporary devices are event sessions, not fake people.** Supabase-Auth users per device were investigated and **not** chosen (§11): the evidence is that Supabase Auth cannot represent them cleanly. A purpose-built event-session architecture is chosen.
5. **Device code: 12 characters, `XXXX-XXXX-XXXX`**, if the entropy analysis holds (§12: it does, with stated conditions). QR provisioning is in scope.
6. **Expiry rule fixed:** the final `ends_on` calendar day in the event's time zone is allowed to finish; access ends 24 h after that day ends (§12).
7. Temporary Organizer may also do result correction/void, staff operations (below organizer), announcements, manual broadcast controls, Camera Off activate and release (§13).
8. Command Centre gets Event Devices and Broadcast Status panels (§15, §20).

---

## 1. Current-system findings (all read in `main`; Pack 18 items marked)

### Tournament truth (Pack 13 / 09A)
- No Lyst entity. "Lyst 1/2" is `matches.field` (free text, default "Field 1"); `private.field_key(text)` = `lower(coalesce(nullif(btrim(field),''),'Field 1'))`, TS mirror `fieldKey` in `src/lib/eventDay.ts`. Timer, join codes and counter seats are keyed `(event_id, field_key)`.
- `matches.queue_state`: `scheduled | on_deck | in_the_hole | active | final`. Auto-advance on final is the deferred constraint trigger `matches_advance_queue`; it never blocks a result. `private.queue_ordered` / `settle_field_queue` own "next fight".
- **Official** = `lyst_rounds` (`running → confirming → confirmed`), `match_discipline`, `lyst_timer` (modes `fight|break|extended_break|dq|equipment|custom`; server clock `src/lib/lyst/timer.ts`). **Provisional** = counter tallies (`lyst_counts`): staff-only, never read by anything official. Results: `lyst_finalize → submit_match_result → finalize_match`; conflicts to head marshal; corrections via `enter_official_result`, `correct_result`, `void_result`, `reopen_match`, all audited.
- Public read-only state: view `lyst_public_state` (timer, round, official score, non-voided discipline marks, `server_now`; no names, counters, reasons or account ids), `lyst_round_scores`, `matches`/`entries` (public events), `match_live_scores`.

### Broadcast (Pack 14)
- `/broadcast/:eventId/:field` (chrome-less, public, no token). `broadcastScene(view, {phase, nowMs})` in `src/lib/broadcast/state.ts` → `SceneMode = idle|upcoming|intro|ready|live|paused|break|equipment|dq_clock|disqualified|complete|winner|between`; inputs are public reads (`useArenaData`, `useLystPublic`, `fetchSides`, `useBroadcast`). `STALE_AFTER_MS = 20_000`, `COMPLETE_MS = 8000`, `RESULT_HOLD_MS = 25000`.
- `event_broadcast`, `event_sponsors`; writers organizer-only.
- **Confirmed gaps: no "on air / primary field", no server scene/override state, no OBS code, nothing named "announcer", no announcer role.** `arena.ts`, `eventDay.ts`, `broadcast/state.ts`, `lyst/timer.ts` import only types and each other (re-verify no browser import transitively before bundling the controller).

### Roles and permissions
- `event_staff(event_id, user_id, role)`: no expiry column. Roles: `organizer, head_marshal, marshal, scorekeeper, medic, check_in, inspector`. Writes only via `grant_event_role_by_email` / `remove_event_role` (organizer; audited).
- Single choke point `private.has_event_role(event, roles[])` = `is_owner()` OR (org enabled AND ((matching `event_staff` row AND `event_staff_active`) OR ('organizer' requested AND org admin of event))). `event_staff_active` = `current_date <= coalesce(ends_on, starts_on) + 7`, server date, not event time zone.
- Helpers: `is_organizer`, `can_score` (organizer, head_marshal, marshal, scorekeeper), `can_resolve_results` (organizer, head_marshal), `can_read_health` (organizer, medic), `can_check_in` (organizer, head_marshal, check_in), `can_inspect`, `can_see_readiness_detail`. Pack 18 adds `can_command` = `can_resolve_results`.
- **All identity resolves through `auth.uid()`.** `private.audit` writes `actor = auth.uid()`, no actor parameter. Platform owner = `platform_roles` (written only by the database owner). Org admin = `organization_staff`.
- **Existing tests that pin Scorekeeper's current limits** (must be changed deliberately, not accidentally, when the role is extended): `pack09a_gate` line 156 (cannot reorder queue), `pack09d_gate` line 311 (cannot save plan), `pack15_gate` lines 166 and 203 (cannot send/see announcements). Ones that stay true: `pack02` (cannot build a schedule, correct a result), `pack03` (cannot resolve/list conflicts, cannot enter paper result), `pack09c` (cannot finalize/reopen competition, preflight), `pack13` (cannot change Lyst settings), `pack14` (cannot change broadcast settings), `pack16` (cannot read desk notes/weights, weigh in).
- Platform facts: 87 distinct `grant execute on function` statements and 176 `to authenticated` grants in migrations: a very wide signed-in surface.

### Counters
Ordinary signed-in users. `create_lyst_join_code` (can_score) → 10-char code **stored plaintext**, 30 min. `request_counter_seat(code)`: any signed-in user, 15 attempts / 10 min / user, wrong code returns `invalid` (the attempt row survives). `assign_counter_seat` (can_score) activates for 8 h. `counter_record/undo/submit/state` need only an active own seat. Tallies readable by can_score and the counter's own rows only.

### Auth and platform
- supabase-js PKCE, persisted session; email code via `signInWithOtp`. Trigger `on_auth_user_created` → `private.handle_new_user()` inserts a `profiles` row for **every** `auth.users` row. `profiles_select_own`.
- No `supabase/config.toml`: hosted Auth settings (JWT expiry, anonymous sign-ins, captcha, redirect list, signing keys) are not in the repo.
- One Edge Function (`send-push`): shared-secret door, service-role key, pg_net kick, one-minute sweep. Precedent for a server-side door.
- Service worker caches only anonymous public GETs (`Authorization === 'Bearer ' + apikey`); any other Authorization is never cached. Update waits for a safe moment. Manifest `start_url ./?source=pwa`.

### Event time
`events.starts_on date`, `ends_on date`, `timezone text default 'America/Edmonton'`. No time-of-day. `closed_at` is the only explicit finish action.

### Audit and tests
`audit_log(actor uuid, event_id, action, subject, details)`; read = owner or organizer. Gates: `supabase/tests/*_gate.sql` (one transaction, `t.as_user/as_anon/as_admin`, `t.expect_*`), listed in `run_all.sh` (Pack 18 appends `pack18_gate`); `schema.fingerprint.txt` regenerated in the same commit as any schema change (grants are not in the fingerprint). Live scenarios `scripts/e2e/*-live.sh` wrap `eventday-live.sh` (real Postgres + PostgREST + Chromium; `localstack.mjs` stubs auth; HS256 JWTs minted locally; Phoenix realtime stand-in in `broadcast-realtime.mjs`). Pack 18 adds `REAL_AUTH=1` (real GoTrue + mail sink). Live scripts are not in CI. Realtime fix (PR #35): `realtimeChannel(name)` gives each subscriber a unique topic; `ErrorBoundary` wraps routed screens; new screens must use both. Pack 18: `useAsync(load, deps, refreshDeps)` (refresh never remounts or resets view); `live-stability` regression.

---

## 2. Architecture and the one rule

```
Pack 13 tournament truth (DB) ──public reads──► Pack 14 overlay (browser source in OBS)
        │                                                ▲
        ├─ public reads + control/camera rows ──► LOCAL CONTROLLER ──ws://127.0.0.1──► OBS (cameras, audio, encode, stream)
        │                                            │ outbound only (controller credential)
        │                                            └─► status heartbeat
Event devices / organizers ──RPC──► event_broadcast_control, event_camera_state (desired state only; no OBS words)
```

**OBS and the controller are consumers. They are never a dependency of scoring, timer, queue, results, check-in, readiness, notifications or the Command Centre.** No Pack 13/15/16/18 code path reads controller or OBS state; the controller credential can execute nothing but its heartbeat. A dead controller changes nothing in the tournament.

---

## 3. Local OBS controller (A)

### 3.1 Packaging (unchanged from revision 1)
A standalone local process, "BuhurtOS Broadcast Companion": Node 22 LTS + TypeScript in `tools/obs-controller/`, shipped as a zip with a pinned Node and `Start BuhurtOS Broadcast.bat` / `.command` (a restart loop; no unsigned `.exe`). Rejected: hosted page in a browser (Chrome Local Network Access gates loopback from Chrome 145/147; page would hold the OBS password), OBS Browser Dock (loopback reach unverified), OBS Lua/Python script. Dependencies: `ws` + Node `crypto`; own obs-websocket v5 handshake (SHA-256 challenge → base64) behind a **typed allow-list client**.
- UI: `http://127.0.0.1:4777` (loopback only): connection lights, mode, mapping wizard, local **Camera Off** button, scene test buttons, log tail.
- OBS WebSocket: `ws://127.0.0.1:4455`. obs-websocket **binds all interfaces and offers no localhost-only option** (OBS discussions/issues; unverified in the live UI). Required setup: authentication on, strong password, **OS firewall blocks inbound 4455**, `netstat` check, and a phone on venue Wi-Fi must fail to connect. The controller only ever connects to 127.0.0.1.
- Local credentials (OBS password, controller credential): stored only on the laptop with OS protection (Windows DPAPI / macOS Keychain; fallback a user-only-readable file; env var is weakest). Never in Supabase, URLs, logs, heartbeat, UI echo, or sent to any device.
- State in: public reads (same as the overlay) + `event_broadcast_control` + `event_camera_state` (public-read for public events; contain nothing secret). Realtime with polling fallback, unique channel names. State out: heartbeat RPC every 5 s with the controller credential.
- Reconnect: OBS backoff 1,2,5,10 s cap, forever; on each identify: `GetVersion`, `GetSceneList`, validate mapping, read program scene, **reconcile to current truth**. Restart: connect, read state, reconcile once. No replay.
- Internet loss: keep the current scene; never fall to holding because data is stale; latched Camera Off persists.
- **Not a remote agent:** outbound connections only (no listener except the loopback UI). The server supplies only a closed vocabulary (below); never scene names, URLs, file paths, filter settings, hotkeys, commands, code. Scene names come from the local mapping only.

### 3.2 OBS request allow-list (default deny; applied to every request inside any batch)
Allowed: `GetVersion`, `GetStats`, `GetSceneList`, `GetCurrentProgramScene`, `SetCurrentProgramScene`, `GetStudioModeEnabled`, `GetInputList`, `GetInputMute`, `SetInputMute`, `GetInputVolume`, `SetInputVolume`, `GetSourceFilterList`, `GetSourceFilter`, `SetSourceFilterEnabled`, `SetSourceFilterSettings` (only the configured ducking filter on the configured music source), `GetMediaInputStatus`, `TriggerMediaInputAction` (play/pause only, configured media source), `GetStreamStatus`, `GetRecordStatus` (read-only).
Never: stream/record/output/virtual-cam/replay start-stop-toggle, `GetStreamServiceSettings` (**returns the stream key**), `SetStreamServiceSettings`, profile/scene-collection/video-settings setters, all `Remove*`/`Create*`, renames, `SetInputSettings`, all `Open*Dialog/Projector`, `CallVendorRequest`, `TriggerHotkey*`, `BroadcastCustomEvent`, `Sleep`, `SetPersistentData`, `SaveSourceScreenshot`. The controller never starts or stops the stream (going live stays human). Subscriptions: Scenes | Inputs | Outputs | General (+Filters, MediaInputs); the high-volume meter bit **only** for the mic "quiet/speaking" status (summarised locally to a boolean at about 1 Hz; raw levels never leave the laptop).
Closed server vocabulary: `mode ∈ {auto, manual}`; `target ∈ {lyst(field_key), holding, break}`; `camera_off bool + reason enum`; `music_mode`; `auto_duck bool`; `priority_fields`.

### 3.3 Controller credential (separate machine principal, not a device)
- Its own credential kind (`controller`), its own database role `bos_controller` (§11). One per event, created/revoked by the permanent organizer in the Command Centre; shown once (same code format as devices, but it never appears in the device list as a person-device and is not counted among the eight).
- Authority (and nothing else): execute `broadcast_controller_heartbeat(...)`; read public data and the two control rows. **Cannot** execute any tournament mutation, any role/staff/device function, `set_broadcast_control`, `camera_off_activate/release`; cannot act as organizer; cannot score. Enforced by Postgres GRANTs on `bos_controller` (it holds no `authenticated` membership), tested by enumerating `has_function_privilege`.
- Optional: the controller still works without it (AUTO from public data + local Camera Off), it just cannot report status or be monitored.

---

## 4. Camera / scene mapping
Configured in the controller's local UI (wizard reads `GetSceneList`); stored **locally**, copy of names in the heartbeat for visibility. Per Lyst: a `live` scene (camera + Pack 14 overlay browser source `/broadcast/<event>/<field>`, full layout; the overlay already draws intro/ready/live/break/winner over the camera) and an optional `graphics` scene. Global scenes: `holding` (overlay `layout=queue`/`sponsors`), `break`, **`camera_off` (no camera sources, no browser sources; static image/text only, so it works when everything else is broken)**.
Validation: every mapped scene must exist. Missing `live` → `holding`; missing `holding` → stay and alert; missing `camera_off` → red setup warning and local Camera Off falls back to muting program audio + `holding`. Unmapped Lyst going live → no action, reported ("Lyst 3 is live and has no camera mapping"). Lyst count not hard-coded (event `field_count` + any `field_key` seen). Garrett edits mapping in the local UI, no source edits.

---

## 5. AUTO selection state machine
A **pure function** `decideProgram(input) → {target, reason, lock, dwellUntil}` in a shared module (vector-tested; used by the controller and by Command Centre "AUTO would show…"). Inputs: per-field `broadcastScene` result (reuse; do not re-derive), first-live times from `lyst_timer.started_at`/`lyst_rounds` (durable in the DB), `event_broadcast_control`, `event_camera_state`, local latch, previous decision, mapping, now.
Per-field phase from `SceneMode`: **fightLive** = `live, paused, break (between rounds), equipment, dq_clock, disqualified`; **armed** = `ready, intro`; **post** = `complete, winner`; **quiet** = `idle, upcoming, between`.
1. **Camera Off latched** (server OR local) → `camera_off`. Beats everything, including manual.
2. `mode = manual` → the manual target; nothing automatic moves it.
3. **AUTO lock**: if a lock on field F is held and F is fightLive or post → stay on F's `live` scene. No switch at a round break, pause, equipment, DQ, nor when another Lyst starts. `complete` (8 s) and `winner` (~25 s) stay on the camera scene.
4. **Release** only when F reaches `quiet` (winner presentation over) or F's fight is voided/reopened.
5. **Pick next**, in order: (a) fields with fightLive: **earliest first-live**; ties → organizer-ordered `priority_fields`; ties → `field_key` ascending; (b) else armed fields: earliest armed, same tie-breaks (camera is ready as fighters walk on); (c) else `holding`.
6. **Anti-thrash:** 10 s minimum dwell between AUTO switches (except into `camera_off`); a just-released field cannot be re-taken for 5 s; score/timer/penalty changes never switch (the decision depends on phase only); `SetCurrentProgramScene` is called **only when desired ≠ actual program scene**.
7. **Other live Lysts are represented, not taken:** "Also live: Lyst 2 (C vs D, round 2)" in the controller UI and Command Centre, with a one-tap **Take Lyst 2** (→ MANUAL).
8. **Return to Auto** clears manual and lock and runs step 5 on **current** state; never replays missed transitions.
9. Restart with two fights live → step 5a by first-live (durable time), landing on the same fight AUTO would have had.

---

## 6. Manual override
`event_broadcast_control` (one row per event): `mode`, `target_kind` (lyst|holding|break), `target_field`, `music_mode` (auto|muted|paused), `auto_duck`, `priority_fields text[]`, `rev`, `updated_at`, `updated_by_label` (no account ids public). Written only via `set_broadcast_control(p_event, ..., p_expected_rev)`: revision-checked (no silent overwrite), audited `broadcast.control`. Controls: Take Lyst N, Holding / Between fights, Break, **Return to Auto**, AUTO/MANUAL, music controls. Who: permanent organizer, Temporary Organizer, super admin (not Camera Off roles by that fact alone; §13).
Camera Off is a **separate state** (`event_camera_state`, §7), not a field of this row, so that its permissions and latch are independent of OBS control.

---

## 7. Emergency Camera Off (safety capability)

**Model:** `event_camera_state(event_id pk, active bool, reason enum(medical|privacy|camera_problem|venue|other), activated_at, activated_by_label, activated_by_role, released_at, released_by_label, released_by_role, rev)` plus an append-only `event_camera_log`. Written **only** by two definer RPCs:
- `camera_off_activate(p_event, p_reason, p_command uuid)`: idempotent; any role in the **activate set** (§13). Sets `active = true`. Never lowers anything.
- `camera_off_release(p_event, p_command uuid, p_note)`: only the **release set**. Sets `active = false`.
Nothing else writes it: not a fight starting or ending, not AUTO, not Return to Auto, not a controller, not a device reconnecting. **Automation can never silently restore cameras.**
- UI: one large red button on the Command Centre broadcast panel, Announcer, Marshal, Scorekeeper and Temporary Organizer screens, and the controller's local UI; shows **CAMERAS OFF · Activated by: Marshal Phone · 7:42 PM · Waiting for authorized release.** Release is a separate, deliberate, confirmed action visible only to the release set.
- Effect in OBS: program → `camera_off` scene; **latched** through new fight, fight end, AUTO changes, OBS disconnect/reconnect/restart, controller restart, internet loss/recovery, BuhurtOS reconnect. The controller persists the last seen state locally and treats "unknown" as "still off".
- Local latch: the on-laptop operator can cut the camera with no internet; `effective = server.active OR local.latch`. The local latch clears locally only; both show in the heartbeat. (A server release cannot clear a local latch; the operator is informed.)
- Audio: Camera Off does **not** blast music: music is faded and muted by default; reason `medical` also locks `music_muted` until a person with broadcast control deliberately resumes it; announcer mic untouched.
- **Camera Off is not OBS access:** the two RPCs are all that the activate set receives; no Take, scene, camera, music, AUTO/MANUAL, OBS password, stream, stream key or broadcast administration.
- It is presentation only: it does not pause the timer, change score or queue (Pack 13 decisions stay with the marshal).
- Audited: `broadcast.camera_off` and `broadcast.camera_released`, with device/role attribution (§17). Event-scoped by construction (`p_event` is checked against the caller's authority for **that** event).

---

## 8. OBS recovery behaviour (specification the tests assert)
| Failure | Behaviour | Tournament |
| --- | --- | --- |
| OBS closes mid-fight | "OBS not connected", retries; heartbeat says so | unchanged |
| OBS restarts mid-fight | re-identify, validate mapping, reconcile to current desired scene | unchanged |
| Controller closes/restarts | OBS keeps its scene; on start reconcile once; latch/mapping restored from local file | unchanged |
| Internet lost | keep scene; Camera Off latch persists; stale warning locally; no switch to holding | unchanged |
| BuhurtOS realtime drops | polling fallback; same if polling fails | unchanged |
| Laptop reconnects | re-read, reconcile, no replay | unchanged |
| Camera mapping / OBS scene missing | §4 fallbacks; never throws | unchanged |
| Controller crashes on bad data | restart loop; Command Centre shows "controller silent 30 s" | unchanged |

---

## 9. Audio architecture (B)

**Principle: millisecond ducking is done inside OBS (Compressor sidechain), not by commands from BuhurtOS.** The controller only sets coarse policy and monitors.

### 9.1 OBS-native ducking
- **Compressor** (`compressor_filter`) on the Music source (or a Music group), **Sidechain/Ducking Source = Announcer Mic**. Source-confirmed ranges: `ratio` 1-32 (default 10), `threshold` -60..0 dB (default -18), `attack_time` 1-500 ms (default 6), **`release_time` 1-1000 ms (hard cap 1000)**, `output_gain` -32..+32, `sidechain_source`. No hold parameter; release is the fade-back.
- Starting values (engineering judgement, **tune with the real wireless mic**): threshold about -30 dB, ratio 6-10, attack 10-20 ms, release 1000 ms, output gain 0; target ducked depth about 10-20 % of music level.
- "Hold 1-2 s then return" cannot come from the compressor alone (release max 1 s). Add a **Noise Gate on the mic** (open/close threshold, attack/hold/release) so breaths/room noise do not trip the sidechain and short gaps between words are bridged by the gate hold; sidechain should read the mic **after** its filters (to confirm on real OBS). Gate hold + 1 s release ≈ 1-2 s to full return; pumping between words is controlled by gate hold, release and threshold.
- **Unverified on real OBS:** exact filter key names (`GetSourceFilterDefaultSettings` will confirm), gate hold range, sidechain tap point. Fallback only if native cannot reach the target: a local meter-driven fade (documented, not preferred).
- Configuration surface (organizer-visible, stored in the controller's local config and mirrored in the heartbeat): normal music level, ducked depth, attack, release, mic source, music source. Filter creation is a one-time operator step in the runbook (the controller cannot create filters); a read-only "Check audio setup" reports the filter state; an optional "Apply recommended values" uses `SetSourceFilterSettings` on that one filter.

### 9.2 Music sources
1. **Guaranteed default: local licensed or stream-safe music in an OBS Media Source (playlist)**: `TriggerMediaInputAction` play/pause, volume, mute, ducking; no capture.
2. Operator-started app/browser playlist captured by OBS Application Audio Capture (Windows) or a macOS routing source: controller can mute/fade/duck but cannot press play, so "Play/Pause" shows as Mute/Unmute for this source. **Next track only for sources where it is legitimately supported (Media Source playlist, via the operator-set OBS action); otherwise hidden.**
3. A local audio-device input (mixer line-in).

### 9.3 Controls and authority
Play/Pause, Mute, Auto Duck on/off (`SetSourceFilterEnabled` on the ducking filter; Off shows a warning), stepped ~1 s fades for level restores (never per word). Music controls are **not** available to every device: organizer, Temporary Organizer, super admin, only via `set_broadcast_control`.

### 9.4 Safe behaviour by state (defaults, event-configurable)
| State | Music |
| --- | --- |
| Fight live (and its pause/break) | faded out and muted; restored when the fight reaches `quiet` |
| Normal between fights / holding | on, normal level, auto-duck on |
| Scheduled break | on, normal level |
| Camera Off (any reason) | muted (never auto-on) |
| Medical hold (Camera Off, reason medical) | muted and locked until a person with broadcast control deliberately resumes it; announcer mic untouched |
| Controller or OBS down | OBS keeps its last settings; ducking keeps working (it lives inside OBS) |
Missing mic source → controller reports it and **mutes music rather than leaving it un-duckable** (configurable). Music must never exceed the announcer.

### 9.5 Venue PA vs livestream
Do not assume one output. Topologies chosen at the event:
- **A** PA fed from the OBS monitor output: OBS has **one global monitoring device**; per source `Off | Monitor Only | Monitor and Output`. Music: both; livestream-only music: Output only; venue-only music: Monitor Only. Announcer mic normally goes to the PA **directly**, not through OBS (feedback).
- **B** PA fed by the mixer; OBS gets a mixer feed or its own mic; music in OBS is livestream-only; venue music is separate.
- **C** virtual audio cable (VB-Cable / BlackHole / Loopback; not official OBS features) for a second mix.
OBS tracks 1-6 per source (Advanced Audio Properties) also keep livestream-only content off the PA. The runbook has one diagram per topology and a "which do I have?" test. The controller exposes **no routing control**; routing is one-time OBS setup. UI labels and the 32.x monitoring-API change are to be confirmed on the real install.

---

## 10. Spotify / YouTube / music findings (not legal advice; sources in revision-1 research; Spotify developer pages were unreachable from the research environment)
- OBS Studio latest found: 32.2.2 (2026-08-14); re-verify at implementation.
- **Spotify:** Web API `PUT /v1/me/player/play` (`context_uri`, scope `user-modify-playback-state`) needs Premium and an active Spotify client; a playlist link maps to `spotify:playlist:<id>`. But consumer terms are personal, non-commercial; public/commercial playback is not covered even with Premium; developer terms bar capture/ripping features; streaming-SDK apps cannot be commercial without Spotify's approval (re-verify at developer.spotify.com/terms and support.spotify.com "public/commercial use"). **Decision: no Spotify API playback control.**
- **YouTube / YouTube Music:** the API developer policies prohibit background play and separating audio from video; an IFrame embed in a visible tab is allowed as an embed; YouTube Music is personal-use (commercial terms unconfirmed). **No audio extraction, no downloading, no hidden-audio embed.**
- **Livestream copyright:** commercial recordings on a livestream risk Content ID claims, muted VODs and strikes (YouTube, Twitch, Facebook). In a venue it is a public performance: in Canada SOCAN (works) and Re:Sound (recordings), usually held by the venue or via tariff. **Do not assume the venue has a licence; ask it.** Treat anything on the livestream as stream-safe only.
- **What a pasted link can legitimately do:** nothing automatic. Supported design: (1) licensed/stream-safe files in a Media Source; (2) a person starts any playlist in its own app and OBS captures that app; BuhurtOS ducks/mutes. A pasted link is, at most, a **local-only** "Open playlist" button in the controller UI (opens in the laptop's default browser/app, human click; never stored in Supabase, never server-driven), with a visible licence warning. **Pack 18.1 does not wait on any of this.**
- Stream-safe candidates (licence must explicitly cover live events/public performance): YouTube Audio Library, Pretzel, StreamBeats, Uppbeat, Epidemic Sound, Artlist. Unverified.

---

## 11. Temporary-device architecture (C): event sessions, not fake people

### 11.1 Is a Supabase-Auth user per device clean? Investigated: no.
Evidence from the repo and Supabase docs:
1. **Role is fixed.** Every GoTrue-issued token carries role `authenticated` (or `anon`); the Custom Access Token Hook schema restricts `role` to `["anon","authenticated"]`. A device user therefore holds the **same database privileges as any signed-up person** (176 `to authenticated` grants; 87 distinct function grants) and can call every RPC that only checks "signed in" (register, team requests, fighter claims, profile writes, push registration). Containment would rest entirely on classification + per-function guards: possible, but a missed function is a hole.
2. **Fake-person pollution.** `on_auth_user_created` creates a `profiles` row for every `auth.users` row; onboarding gate, directories, People/staff name joins and email-code/reset paths all assume a person. Each device would be a permanent `auth.users` row (no automatic cleanup in Supabase for non-anonymous users) with `app_metadata` flags we would have to keep honouring forever.
3. **Audit and enumeration:** actor would be a real user id; device principals would appear in user administration and `list_event_staff`-style joins.
4. Anonymous sign-ins do not fix it: same `authenticated` role, a global project toggle, abuse/captcha burden, manual cleanup (docs).
Conclusion: Supabase Auth cannot represent a temporary device cleanly. Per the owner's rule, **implement a purpose-built event-session architecture.**

### 11.2 Chosen architecture
- **Domain:** `event_credentials` (what the organizer creates) and `event_sessions` (what a device holds). A session is bound to ONE event and ONE role. No `auth.users` row, no profile, no fighter, no team, no org.
- **Transport:** a short-lived (10 min) JWT signed by an **Edge Function** (`device-session`) that carries `role = bos_event_device`, `sub = <session uuid>` (a session id, **not** a user id; absent from `auth.users`), `session_id`, `exp`. PostgREST/Realtime switch to the custom Postgres role named in the claim.
- **Containment by construction (deny-by-default):** `bos_event_device` is a NOLOGIN role granted **to `authenticator`** and holding **no `authenticated` membership**. It inherits `anon` (so public reads and public RLS work) and receives `EXECUTE` only on an explicit allow-list of functions. **A new function is not callable by a device unless a migration grants it.** `bos_controller` is a second, narrower role (heartbeat only). This is the mechanism for the containment goal; the gate asserts it (§18.1) by enumerating `has_function_privilege` for each role against a checked-in allow-list file; it is not a classification of every function by hand.
- **Existing RPCs keep working** because `auth.uid()` (claim `sub`) is non-null and non-person: existing "signed-in" guards pass, but `private.has_event_role` and the staff helpers find no `event_staff` row for a session id, so **no existing staff authority leaks**. Devices receive authority only through one patched branch in `has_event_role` keyed on `private.device_session()` (revocation, event, expiry looked up in tables on every call).
- **Authority never lives in the JWT.** A leaked, revoked or expired token has zero authority immediately (DB check each call). JWT lifetime only bounds how long a valid-looking token exists.
- **Refresh:** the device keeps a long-lived opaque **session secret** (256-bit random; only its hash is stored) and calls `device-session` every ~8 min to mint a new JWT; expired/revoked/expired-event sessions are refused by the function and, independently, by the DB. Last sign-in wins per credential.
- **Client:** device mode builds the supabase-js client with the documented `accessToken` option (this disables `supabase.auth` for that client by design); a boot-time switch in `src/lib/supabase.ts` chooses device client vs normal client; `AuthContext`/`ProfileGate` never run in device mode (no onboarding, no Account). Realtime auth follows `accessToken`.

### 11.3 What this requires on hosted Supabase (documented, **not** done by this pack)
- Supabase accepts only JWTs signed with a trusted signing key; **minting requires importing your own signing key** (`supabase gen signing-key` → dashboard JWT signing keys → import). From the Supabase docs, a newly imported key starts **standby: only the current key is accepted until you rotate**, and rotation activates the imported key for Supabase Auth too (old key remains trusted as "previously used"). So the owner action is: import an ES256 key, rotate, keep the legacy key trusted until existing sessions age out. This is a **project-wide Auth setting change**; it must be scheduled, rehearsed and reversible (keys are reversible except permanent deletion; changes are throttled ~5 min).
- The Edge Function secret holds that **private key**: it can sign any role, including service role-equivalent tokens; its blast radius equals the service-role key `send-push` already holds. Stored as a function secret, never in the repo, never in the browser.
- `create role bos_event_device nologin; create role bos_controller nologin; grant bos_event_device, bos_controller to authenticator;` plus explicit grants (in a migration; verified locally against PostgREST, **not yet** against hosted).
- Unverified until tested: PostgREST/Realtime on hosted accepting a custom role claim; supabase-js `accessToken` + Realtime; Edge Function CORS for the app origin.
- **Contingency (only if hosted rejects the above and the owner accepts it):** contained Auth-user transport ("G′"): one `auth.users` row per device flagged `bos_device`, `handle_new_user` skipped for them, `private.is_device()` guards plus a CI classification gate for every `authenticated` function, sweep/deletion on expiry. Same domain tables, same `has_event_role` branch. Documented, not built, and not recommended.

### 11.4 Spike gate at the start of implementation (before any feature work)
1. Local: mint HS256 JWT with `role=bos_event_device`, call real PostgREST: prove role switch, `has_function_privilege` deny-by-default, public reads via `anon` inheritance, `auth.uid()` = session id, Realtime stand-in.
2. Local REAL_AUTH: prove the normal Auth path (password, email code) is untouched.
3. Owner/hosted: confirm key import + custom role viability on a **Supabase branch or non-production project** if the owner provides one; otherwise record as unverified and stop for the owner's decision before shipping devices.

---

## 12. Codes, QR, sessions, expiry, revocation

### 12.1 Code
- **12 characters, shown `XXXX-XXXX-XXXX`**, Crockford base32 (no I, L, O, U), generated by `gen_random_bytes` in `create_event_device`; case-insensitive; `O→0`, `I/L→1`.
- **Entropy analysis (why 12 is enough here):** 12 × 5 bits = **60 bits**. Online guessing is bounded by throttles (10 failures / 10 min per IP, global breaker of 100 failures / 10 min): at that rate exhausting 2^60 is not feasible; a code is valid only for days. Offline risk (database dump): store `HMAC-SHA256(pepper, code)` (not bare SHA-256), pepper held in the Edge Function secret store and **not** in the database, so a database dump alone cannot be brute-forced (2^60 SHA-256 guesses would otherwise be hours-to-days on a GPU cluster); the verifier runs inside the Edge Function. Residual: a database dump plus the function secret within the code's lifetime is already a total compromise. Conclusion: 12 characters are acceptable **provided** the HMAC pepper, throttles and expiry are all in place; if any is dropped, extend to 16.
- Stored: only the HMAC verifier (`code_hash`, unique). **No plaintext, no hint stored.** Plaintext appears only in the create/replace response, in the organizer's browser, once. Replace is the recovery path.
- Never logged: the Edge Function logs no request body; the code travels in a POST body; QR carries it in the URL **fragment**; `audit_log` never holds it; no public table contains it.

### 12.2 QR provisioning (in scope)
- `create_event_device` result also renders a QR (client-side, existing `qrcode-generator`) encoding `https://<site>/device#c=XXXXXXXXXXXX`. The QR **is** the credential: same handling as the code (shown once, same expiry/revocation, never emailed, never put in analytics).
- `/device` reads the fragment, **immediately** removes it with `history.replaceState`, sets `Referrer-Policy: no-referrer` for that route, never sends it to analytics (analytics already strips fragments and queries; a test asserts it), and posts it to the Edge Function in a POST body. Scanning with a camera opens the installed PWA or browser; a "scan code" in-app option is out of scope (needs camera permission and a decoder).
- Risk accepted and documented: a photographed QR is a leaked code: revoke/replace that device.

### 12.3 Verification and rate limiting
`device-session` (service-role only RPCs behind it): normalise → throttle (per `ip_hash = sha256(ip‖daily salt)`, global breaker) → HMAC → `device_redeem` → mint. Uniform failure message and a fixed minimum response time for wrong/expired/revoked/throttled. A lockout blocks only **new** sign-ins; existing sessions are untouched, so guessers cannot take devices offline. Attempt rows hold hashed IPs only; pruned after 24 h.

### 12.4 Persistence
Session secret in `localStorage` (and the PWA's own storage). Refresh and reload keep the session; sleep/wake keeps it (refresh on `visibilitychange`/`online`). Ends only on sign-out, revocation, expiry or security invalidation. No per-fight code entry. iOS home-screen PWAs have storage separate from Safari: enter the code once inside the installed app. `/` redirects a device session to its landing page (manifest `start_url` unchanged). A device bar on every device screen shows identity (§12.6) and **Sign out this device**. `device_whoami()` runs at launch and on focus; revoked/expired → local sign-out and "This device's access has ended".

### 12.5 Expiration (server-side, exact)
- **Event end = the end of the event's last local day: midnight starting `ends_on + 1` in `events.timezone`** (`((ends_on + 1)::timestamp AT TIME ZONE timezone)`); expiry = that + `interval '24 hours'` (exact hours, DST-safe). Example: `ends_on = 2026-10-10`, `America/Edmonton`: the event ends Sun 00:00 MDT; access ends Mon 00:00 MDT.
- Valid iff `created_at <= t < expiry`, not revoked; per-credential optional `expires_at` may only be **earlier**. **At exactly expiry → refused; 23:59 before → valid; after → refused.**
- Computed live from the `events` row on every call (`private.device_valid_at(session, t)`; `device_active` = `valid_at(…, clock_timestamp())`): rescheduling the event moves expiry; nothing relies on the device clock, a stored expiry or a frontend timer. The gate tests `valid_at` with explicit instants (+23:59:59 / +24:00:00), time-zone and DST-week cases, plus one real-clock check. No test-only clock override ships.
- A browser/PWA holding a token after expiry: JWT ≤ 10 min, refresh refused, and every DB call re-checks → no authority.
- `event_staff` real accounts keep `ends_on + 7` server dates (existing; unchanged). Devices are stricter by design.
- Cleanup (hosted pg_cron or the existing one-minute sweep pattern): mark expired sessions, prune. No `auth.users` rows exist to clean.

### 12.6 Visible identity
Device bar (not colour alone): **RED DEER RUMBLE · Temporary Device · Marshal Phone · Role: Marshal · access ends Mon 00:00**, and a role icon + text. Present on every device screen, including the Announcer and the Command Centre view.

### 12.7 Revocation and management (server enforced)
Organizer: revoke one device (others unaffected), replace/regenerate (old code dies, new shown once, linked `replaced_by`), **sign out all temporary devices** (event-wide revoke), list with status (active / expired / revoked / never used, last seen, "signed in elsewhere at hh:mm" flag). Controller credential has its own revoke/replace. Event A authority never affects Event B.

---

## 13. Permission matrix (tied to server-side checks)

### 13.1 Role definitions
- **Counter device** → no staff role; own seat only; may join only its own event's counter flow.
- **Scorekeeper = "Secretary / Scorekeeper"** (event-staff role and device role): today's `can_score`, **plus** (new, deliberate): queue/schedule adjustment of the existing line (`move_match_in_queue`, `save_queue_plan`, `clear_manual_queue`; **not** `build_schedule` or bracket/draw), `send_event_announcement`, Command Centre read (`can_command`), Camera Off activate.
- **Marshal** → today's `marshal` (`can_score`) + Camera Off activate. No Command Centre.
- **Announcer** → new event-staff role `announcer` (permanent accounts may hold it too) and device role; **no staff helper includes it**; only Camera Off activate beyond public reads.
- **Temporary Organizer / Event Admin** → device role. Effective staff roles `{head_marshal, marshal, scorekeeper, check_in, inspector}`; `is_organizer()` stays **false**. Organizer-only abilities reach it only through `private.is_event_operator(e)` (= organizer OR active Temporary Organizer of **that** event) substituted into an explicit allow-list (default deny).
- **Super admin / platform owner** → unchanged `is_owner()` path; passes every check including Camera Off both ways.
- **Controller** → separate credential (§3.3).
- Devices **never** match `organizer` or `medic`, and `can_read_health` is untouched.

### 13.2 Matrix (✔ allowed, — denied, ◐ condition; **bold** = new in 18.1; check = server function)
| Action → RPC/check | Counter | Scorekeeper (Sec.) | Marshal | Head Marshal | Announcer | Temp. Organizer | Perm. Organizer | Super Admin | Check-in | Inspector | Captain | Fighter |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Public reads: live fights, official score/timer/cards, upcoming, results | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Own counter seat: `request_counter_seat`, `counter_record/undo/submit/state` (own active seat) | ✔ own event | — | — | — | — | — | ✔* | ✔* | ✔* | ✔* | ✔* | ✔* |
| Timer, open Lyst, end/confirm round, discipline, call fight, advance queue, finalize: `can_score` | — | ✔ | ✔ | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| **Reorder queue / save plan / clear manual queue: `can_adjust_queue`** | — | **✔** | — | — **(Q2)** | — | **✔** | ✔ | ✔ | — | — | — | — |
| Build schedule / bracket: `build_schedule`, `record_tie_decision`: `is_organizer` | — | — | — | — | — | **✔ operator** | ✔ | ✔ | — | — | — | — |
| Resolve conflicts, paper result, reopen match, Lyst settings: `can_resolve_results` | — | — | — | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| **Correct / void result, withdraw entry: `is_organizer` → `is_event_operator`** | — | — | — | — | — | **✔ (audited)** | ✔ | ✔ | — | — | — | — |
| Check-in: `can_check_in`; inspect: `can_inspect`; readiness detail | — | — | — | ✔ | — | ✔ | ✔ | ✔ | ✔ / — / ✔ | — / ✔ / ✔ | — | — |
| Readiness override: `can_resolve_results` | — | — | — | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| Registrations admin, health data (`can_read_health`) | — | — | — | — | — | admin: **✔ operator**; health: — | ✔ | ✔ | — | — | — | — |
| **Command Centre `event_command_snapshot`: `can_command`** | — | **✔ (read-only)** | — | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| **Fighter/event announcements `send_event_announcement`** | — | **✔** | — | — | — | **✔** | ✔ | ✔ | — | — | — | — |
| Announcement history `list_event_announcements` | — | — | — | — | — | ✔ | ✔ | ✔ | — | — | — | — |
| **Staff ops: `grant/remove_event_role`** | — | — | — | — | — | **✔ except `organizer`; names-only list, no emails** | ✔ | ✔ | — | — | — | — |
| Device/controller management: create / revoke / replace / sign-out-all / list | — | — | — | — | — | — **(revoke-only is Q7)** | ✔ | ✔ | — | — | — | — |
| Event settings, publish, close/reopen, archive, delete, org/season links | — | — | — | — | — | — | ✔ | ✔ | — | — | — | — |
| Broadcast settings/sponsors (`set_broadcast_settings`, `save_event_sponsor`) | — | — | — | — | — | — | ✔ | ✔ | — | — | — | — |
| **OBS-level control: `set_broadcast_control` (Take, Holding, Break, AUTO/MANUAL, music)** | — | — | — | — | — | **✔** | ✔ | ✔ | — | — | — | — |
| **Camera Off ACTIVATE: `camera_off_activate`** | — | **✔** | **✔** | **✔** | **✔** | **✔** | **✔** | **✔** | — | — | — | — |
| **Camera Off RELEASE: `camera_off_release`** | — | — | — | **✔** | — | **✔** | **✔** | **✔** | — | — | — | — |
| Audit log read | — | — | — | — | — | — | ✔ | ✔ | — | — | — | — |
| Another event | — | — | — | — | — | — | own events | all | — | — | — | — |
| OBS WebSocket password / stream key | never | never | never | never | never | never | local laptop only | local laptop only | never | never | never | never |

\* A permanent account that also holds the role, via ordinary sign-in.
Counter, Fighter, Captain, Check-in, Inspector never receive Camera Off, and Camera Off grants no other broadcast power. A person with several roles gets the union (normal combined authorization). Q2/Q7 flagged in §21.

### 13.3 Server-side boundaries (what the gates attack)
`private.has_event_role` (device branch, event-scoped, role expansion, `device_active`), `is_event_operator`, `can_adjust_queue` (new), `can_camera_off_activate/release` (new, definer, inside the two RPCs), `can_command` (extended), the allow-list `GRANT`s for `bos_event_device`/`bos_controller`, and the per-RPC definer checks. UI hiding and route protection are never relied on.

---

## 14. Announcer architecture (D)
- Route `/events/<slug>/announcer` (chrome-less like Arena/Broadcast; `ErrorBoundary fullPage`; tablet-first, phone/desktop OK). Device sign-in as Announcer → direct redirect here; permanent accounts with the `announcer` role may open it. Device bar always visible; the **Camera Off** button is visible and is the only action.
- **Read-only otherwise: no write control renders.** Data composed from existing public reads and hooks: `useArenaData`, `useLystPublic` (server-synced clock), `buildFieldBoards/buildArena`, `fetchSides` (name, team, crest, photo, record), career/head-to-head RPCs, `matches` (final, ordered by `finalized_at`) for recent results. `realtimeChannel` unique channels + polling; refresh without remount (Pack 18 `useAsync refreshDeps`): keeps scroll, focus selection, filters, expanded cards; "Not updating; last good HH:MM:SS" banner; never flashes to full loading.
- Sections: **Now fighting** per live Lyst (Lyst, competition/category, red/blue fighter+team, crest/photo, official score, round, clock state, cards/penalty marks as the overlay shows them; never counter data); **Up next** per Lyst; **Coming up** (next ~4-6 per Lyst, not the bracket); **Recent results** (last ~8: names, winner, score/basis, category, Lyst); **Fighter/team info** on tap (name, team, crest, photo, category, corner, career record, event record, earlier fights at this event; synthetic data labelled "Test").
- Multiple Lysts: a column/card per live Lyst; local **Focus Lyst N** in `localStorage` only; writes nothing, so cannot change queue, score, timer, camera, OBS or any other screen.
- Never shown: email, phone, account ids, inspection notes, weigh-in, medical, emergency contact, admin notes, counter data, readiness reasons. Readiness: one "Ready / Not yet ready" per fighter from a new minimal definer RPC `announcer_readiness(p_event)` (announcer/scorekeeper/marshal/operator roles; returns `match_id`, side, boolean; no reasons) (**Q8**).
- Draft/unpublished events are not publicly readable; the announcer view needs the event published and says so on screen.
- Server-side denials for the announcer (all asserted): score, counter-score, timer, call fights, queue, results, accept, conflicts, check-in, inspect, override, schedule, registrations, staff, announcements, Take, AUTO/MANUAL, music, OBS config, release Camera Off, create device codes, any other event. Because an announcer matches **no** staff helper, these refuse by existing helpers with no new code; the gate asserts each. The only extra: `camera_off_activate`.
- Mobile/tablet: verified at 390×844, 820×1180 and desktop.

---

## 15. Database plan (nothing applied)

Migrations after Pack 18's `20261012000100` (re-check numbering after merge): `20261013000100_pack181_event_sessions.sql`, `20261013000200_pack181_roles_camera.sql`, `20261013000300_pack181_broadcast_control.sql`. Each: new gate in `supabase/tests/`, appended to `run_all.sh` after `pack18_gate`, fingerprint regenerated in the same commit. Convention: `security definer set search_path = ''`, `revoke … from public, anon`, explicit grants, `auth.uid()` null → 28000, authority → 42501, validation → 22023, `private.audit`, advisory locks on create/revoke races, DO-block `replace` with anchor assertions to patch existing functions.

**Tables (RLS on, no client grants):**
- `event_credentials(id, event_id fk cascade, kind ('device','controller'), label ≤40, role (device: counter|scorekeeper|marshal|announcer|temporary_organizer; controller: broadcast_controller), code_hash bytea unique, expires_at null (earlier only), created_by, created_at, first_used_at, last_signin_at, revoked_at/by/reason, replaced_by)`; unique `(event_id, lower(label))` among non-revoked.
- `event_sessions(id uuid pk (the JWT sub), credential_id fk, secret_hash bytea unique, created_at, last_seen_at, ended_at, ended_reason)`; at most one open session per credential (partial unique index).
- `device_code_attempts(at, ip_hash, outcome)` (service only; pruned).
- `event_camera_state` (+ append-only `event_camera_log`), `event_broadcast_control`, `broadcast_controller_status` (staff-read: organizer, Temp. Organizer, head marshal). Public read of the two control rows for public events; no account ids in them. `event_camera_state`/`event_broadcast_control` added to the realtime publication.

**Roles:** `bos_event_device`, `bos_controller` (NOLOGIN, granted to `authenticator`, no `authenticated` membership, inherit `anon`). Allow-list of executable functions kept in the gate as a checked-in file (the cleanest maintainable deny-by-default: a function is callable by devices only if a migration grants it and the list names it).

**Event-staff role set:** add `announcer` (same DO-block technique as Pack 03/16). No `secretary` role.

**Functions:**
- Private: `device_session()` (claims → session row), `device_valid_at(session, at)`, `device_active()`, `device_roles(event)`, `is_event_operator(event)`, `can_adjust_queue(event)`, `can_camera_off_activate(event)`, `can_camera_off_release(event)`.
- **Patched:** `has_event_role` (device branch; expands `counter→{}`, `scorekeeper→{scorekeeper}`, `marshal→{marshal}`, `announcer→{announcer}`, `temporary_organizer→{head_marshal,marshal,scorekeeper,check_in,inspector}`; never `organizer`/`medic`); `private.audit` (when `device_session()` is set: actor stays the session id, `details.device = {credential_id, session_id, label, role}`); `can_command` (add scorekeeper + temporary_organizer via existing role expansion); `move_match_in_queue`, `save_queue_plan`, `clear_manual_queue` (→ `can_adjust_queue`); `send_event_announcement` (→ scorekeeper + operator; history stays organizer/operator); `correct_result`, `void_result`, `withdraw_entry`, `build_schedule`, `record_tie_decision`, registration-admin and `grant/remove_event_role` (→ `is_event_operator`, with the organizer-role guard and a names-only staff list); `request_counter_seat` (a device session's join-code event must equal its event).
- Organizer-facing: `create_event_device`, `create_event_controller`, `list_event_credentials`, `revoke_event_credential`, `replace_event_credential`, `revoke_all_event_devices`.
- Session-facing (granted to the device role): `device_whoami`, `device_sign_out`, `camera_off_activate`, plus the explicit allow-list of existing RPCs each role needs (Lyst/counter/check-in/etc. exactly as in §13).
- Service-role only: `device_redeem`, `device_open_session`, `device_refresh_session`, `device_record_attempt`, `device_sweep`.
- Broadcast: `set_broadcast_control`, `camera_off_release`, `broadcast_controller_heartbeat` (controller role only), `announcer_readiness`.
- Every new function: PUBLIC/anon revoked; grants tested.

**Edge Function (new, deployed only on owner approval):** `device-session` (sign-in, refresh, sign-out). Holds the signing private key and the HMAC pepper; verifies nothing about JWTs (pre-auth); IP/global throttle; no body logging; CORS limited to the app origin.

---

## 16. Security / threat model
| Threat | Mitigation |
| --- | --- |
| Code guessing / enumeration | 60-bit code, HMAC verifier with out-of-DB pepper, IP + global throttle, uniform responses and minimum response time, lockout blocks only new sign-ins |
| Code/QR leaked (photo, chat) | one credential per device; revoke one; "signed in elsewhere" flag; replace; short life; QR in fragment, stripped immediately |
| Device lost/stolen | individual revoke; authority gone immediately (DB check per call) |
| Copied session | last sign-in wins; organizer sees it |
| XSS steals session secret | blast radius = one event + one role; JWT 10 min; revoke/expiry |
| Device calls generic signed-in RPCs | custom DB role without `authenticated`: **GRANT-level deny-by-default**; allow-list file in the gate |
| New function silently reachable | not callable unless a migration grants it and the allow-list names it |
| Cross-event use | every device check is `event_id = p_event`; counter join checks event; tested A→B for each role |
| Self-promotion | role in a table no client can write; JWT carries no role; devices never match `organizer`/`medic`; staff/device RPCs deny devices (Temp. Organizer: not `organizer`) |
| Temp. Organizer persistence | no `organizer` grants, no device creation, no emails/audit/health/settings; expiry; revocation |
| Expired token still works | DB re-checks every call; refresh refused; JWT ≤ 10 min |
| Signing-key compromise (Edge Function secret) | equals service-role-key risk already accepted for `send-push`; secret never in repo/browser; rotatable (Supabase signing keys are rotatable/revocable) |
| Hosted misconfiguration | §11.3 list; spike gate §11.4; contingency G′ |
| Plaintext in logs | no body logging; fragment QR; audit never has code; leak-scan gate |
| Audit anonymity | `private.audit` enrichment; actor = session id; label/role/credential in details |
| Camera Off abused (DoS of the stream) | safe direction by design; audited with who/when; release limited to senior roles; no other power granted |
| Camera Off silently undone | only `camera_off_release` writes the state; automation/controller/reconnect cannot; local latch |
| OBS password theft | local-only, never displayed/logged/sent |
| OBS WebSocket on LAN | auth on + strong password + firewall block + netstat check; controller loopback only |
| Server drives OBS | closed vocabulary; no names/paths/URLs from server; local allow-list; stream never started/stopped; stream-key request blocked |
| Controller compromise | credential can execute only the heartbeat; no tournament write, no organizer power |
| Supply chain (controller) | minimal deps, lockfile, pinned Node |
| Copyright | §10 |
| Announcer leak | public data + one boolean RPC; gate checks columns |
| Sign-in DoS | existing sessions unaffected; paper/other fallbacks unchanged |

---

## 17. Audit design
- Actor = the session id (a stable uuid per sign-in session, resolvable via `event_sessions → event_credentials`). `private.audit` enriches `details.device = {credential_id, session_id, label, role}` whenever a device session is the caller; event id is already the call's event. Never "anonymous", never the code.
- Existing actions made by a device (scoring, check-in, etc.) go through `private.audit` already → attribution gained with no per-RPC edits. `audit_log` read stays organizer/owner/Temp. Organizer-excluded; organizer UI resolves a session id to "Counter Phone 3".
- New actions: `device.created`, `device.signed_in`, `device.signed_out`, `device.revoked`, `device.replaced`, `device.revoked_all`, `device.refused` (no code), `controller.created/revoked`, `broadcast.control`, **`broadcast.camera_off`**, **`broadcast.camera_released`**, `queue.*` (existing actions, now with device attribution), `result.corrected/voided` (existing, attributed), `staff.granted/removed` (existing, attributed).
- Camera Off activation/release is audited both in `audit_log` and the append-only `event_camera_log` (who/device/role/time/reason/note).
- A gate scans `audit_log`, tables, error text for the generated code after a full scenario.

---

## 18. Test plan

### 18.1 Database gates (`pack181_sessions_gate.sql`, `pack181_roles_gate.sql`, `pack181_broadcast_gate.sql`)
Allowed and denied, each of: anon, stranger, every device role (counter, scorekeeper, marshal, announcer, temporary organizer), controller, every existing staff role (organizer, head_marshal, marshal, scorekeeper, medic, check_in, inspector), captain, fighter, other-event organizer, org admin, owner.
- Sessions: valid redeem; wrong/expired/revoked/throttled indistinguishable; throttle; one revoke leaves others; replace kills old code; sign-out-all; single open session per credential; `valid_at` at +23:59:59 true / +24:00:00 false; Edmonton vs UTC; DST-week event; `ends_on` change moves expiry; real-clock check.
- **Containment (the deny-by-default test):** for `bos_event_device` and `bos_controller`, enumerate every function in `public`/`private` with `has_function_privilege` and assert the executable set **equals** the checked-in allow-list exactly; assert `authenticated` membership absent; assert table privileges none beyond public reads; assert a probe function added in-test and **not** granted is refused. This replaces hand-classification of 87+ functions with an exact-set assertion and avoids a brittle name-by-name "is it denied" list.
- Roles: every cell of §13.2 asserted server-side (not UI), including: Temp. Organizer refused grant-organizer, device create/revoke, event settings, health data, emails, audit read, stats governance; Scorekeeper newly allowed queue/plan/announce/command but still refused schedule build, correct result, conflicts, paper result, Lyst settings, broadcast settings, weigh-in; Announcer refused everything but Camera Off; Counter refused everything but own-event counter flow; cross-event refusals for each.
- **Camera Off:** activation by marshal, head marshal, scorekeeper, announcer, temp organizer, permanent organizer, super admin; refusal for counter, check-in, inspector, captain, fighter, anon, other-event staff; release by head marshal, temp organizer, permanent organizer, super admin; refusal for marshal, scorekeeper, announcer; idempotent activate; release only via RPC; no other write path (direct table writes refused); event A vs B; audit rows with attribution.
- Audit: device attribution present; leak scan of the code.
- Existing gates stay green except the **deliberately changed** assertions (pack09a:156, pack09d:311, pack15:166/203) which are updated in the same commit with a comment; all Pack 01-18 gates otherwise unchanged (proves email/password and email-code identities unaffected). Fingerprint regenerated.

### 18.2 Unit tests
`decideProgram` vectors (every §5 rule, tie-breaks, anti-thrash, restart reconcile, Return to Auto, no switch on score change, Camera Off latch beats manual/auto); OBS client allow-list (every denied request rejected, batches checked); code normaliser/format/checksum-free parse; QR fragment handling (stripped before any request; never in analytics payload); device landing-route table; expiry label formatting; announcer view-model (no private fields); camera-off state machine; ducking-config helper; mic quiet/speaking summariser.

### 18.3 Real-stack browser scenario `pack181-live` (+ REAL_AUTH for the normal-auth regressions)
Realistic fixture: multiple Lysts (3), multiple competitions, many fights, **simultaneous live fights on two Lysts**, ready fighters, a not-ready fighter, official results, upcoming fights, recent results, broadcast config, camera mappings, all **8 devices** (Counter 1-4, Scorekeeper tablet, Marshal, Announcer, Event Admin tablet) plus the controller credential.
Eight simultaneous browser contexts, each verified independently: valid code sign-in lands on the right interface (no fighter onboarding); invalid code; rate limit; individual revocation (only that device ends within one refresh); replacement; **Sign Out All**; PWA restart persistence (reload and a new context with stored session); expiry using event dates relative to now plus the `valid_at` boundary tests; Event A code refused for Event B (every role); role cannot change itself (direct RPC probes with the device JWT); Counter / Scorekeeper / Marshal / Announcer / Temp. Organizer restrictions (direct RPC, not buttons); device identity bar present; audit attribution; **no plaintext code** in DB/audit/console/network/localStorage after the code has been consumed (the one-time view excepted); QR fragment stripped; normal email+password, email-code and permanent sign-in unaffected; 390×844 phone for counter/marshal/scorekeeper, tablet for announcer/admin; no blank screen with the realtime stand-in connected. Announcer: two live Lysts, focus selection changes nothing server-side (table diffs), private data absent from every response.
Live-update stability: Command Centre device list, broadcast status and Announcer survive live changes and reconnects without remount, scroll reset, filter/tab reset or erased input (extend Pack 18's `live-stability`).

### 18.4 OBS tiers (always labelled)
1. **Stand-in verified:** `scripts/obs-standin/`, a Node server speaking obs-websocket v5 (Hello/Identify with the real challenge/salt SHA-256 auth, RequestResponse shapes, `GetSceneList`, program-scene get/set + `CurrentProgramSceneChanged`, input mute/volume, filter list/enable/settings, media actions, `ExitStarted`, meter events), with fault injection (drop, restart, missing scene, slow, wrong password) and a **request log asserted against the allow-list** (a denied request in the log fails the run).
2. **Real OBS headless (stretch):** `obs` under Xvfb on Linux with its built-in websocket: proves real protocol/auth/scene-switch behaviour only; no cameras, no audio DSP.
3. **Physical OBS (§19):** the only tier proving ducking, cameras, routing, packaging, firewall.
A mocked OBS run is never reported as "OBS verified".

### 18.5 OBS scenario checklist (stand-in against the real local stack driving Pack 13 through its RPCs)
Connect; holding; fight ready; fight live → correct camera; score change and timer change cause **zero** `SetCurrentProgramScene` calls; pause; resume; equipment; DQ; complete; winner; between fights; next fight same Lyst; next fight another Lyst; two simultaneous live Lysts (stays on first, other shown "also live"); manual Take; Holding; Break; **Camera Off** (latched through new fight, fight end, AUTO change, OBS disconnect/reconnect/restart, controller restart, internet loss/recovery, BuhurtOS reconnect); Return to Auto reconciles to current truth with no replay; OBS disconnect, reconnect, restart; controller restart; internet loss then recovery; BuhurtOS stale then reconnect; missing scene; missing mapping; **Pack 13 scoring/timer/queue/finalize/check-in/readiness/Command Centre/notifications all work with the controller and OBS entirely absent** (run the existing `pack13-live`, `pack16-live`, `pack18-live` unchanged with no controller).

### 18.6 Audio checks
Stand-in: commands issued in correct order per state (§9.4); stepped fades; Auto Duck off warning; missing mic → music muted; missing music source reported; reconnect and controller restart restore policy; Camera Off and medical hold never unmute; scheduled break and normal recovery restore music; manual mute, play/pause (media source), pump-guard logic (no per-word commands issued). **Physical only:** ducking depth/attack/release, no pumping, speech-gap behaviour, PA vs stream routing.

### 18.7 Regression
Typecheck, vitest, build, full `run_all.sh`, the five CI browser suites (field-pack03, sw-update, pack07-ux, pack08-entrants, pack12-app), pack13-live, pack14-live, broadcast-realtime, pack15-live, pack16-live, pack18-live (REAL_AUTH), live-stability, eventday-live, finalize-live. Failures are investigated with evidence, never dismissed as flakes.

---

## 19. Physical verification plan and event-laptop runbook
Runbook `docs/runbooks/PACK181_EVENT_LAPTOP.md` (for Garrett; no source editing):
1. Laptop software: current stable OBS; browser; the Companion zip; nothing else.
2. OBS: Tools → WebSocket Server Settings: enable, long password, note port. **Firewall:** block inbound 4455; verify with `netstat` and a phone failing to connect.
3. Scenes: per Lyst "Lyst N Live" (camera + Pack 14 browser source 1920×1080, shutdown-when-hidden OFF); "Holding"; "Break"; **"Camera Off" (static image only)**. Name and test each camera.
4. Audio: "Announcer Mic" (wireless receiver) and "Music"; mic Noise Gate; Compressor on Music keyed to the mic; starting values from §9; pick the music option; monitoring per the venue/stream diagram (A/B/C) with the "which do I have?" test.
5. Start the Companion; paste the OBS password (kept on this laptop only); paste the controller code (from the Command Centre); the wizard lights each Lyst; Test each scene; Test Camera Off and the on-laptop clear.
6. AUTO: rehearsal fight; camera follows; two-Lyst behaviour; Take, Holding, Break, **Camera Off, release (by an authorized person), Return to Auto**.
7. Failure drills (each ends with the stream correct): quit OBS mid-fight; close/reopen the Companion; unplug the network 60 s; unplug a camera; wrong password.
8. Music drills: mic quiet → music normal; speak → duck; mid-sentence 1-2 s pause (no pumping); stop → returns; mute; Auto Duck off; mic unplugged; Camera Off keeps music muted; medical hold stays muted.
9. If automation completely fails: use OBS by hand (scene list), the stream continues; the tournament runs unchanged; where the manual Camera Off lives; how to tell BuhurtOS state vs OBS state.
10. Going live stays manual: the Companion never starts or stops the stream.
Physical checklist (camera, wireless mic, PA routing, Windows/macOS packaging, firewall, a phone on venue Wi-Fi failing to reach 4455) is a tick list in that runbook and is **not** claimed performed by this pack.

---

## 20. Files and components likely to change AFTER Pack 18 lands (re-verify against merged Pack 18)
**Database (new):** the three migrations (§15); `supabase/tests/pack181_*_gate.sql`; the checked-in device-role allow-list file used by the gate; `run_all.sh`; `schema.fingerprint.txt`; `scripts/e2e/fixtures/pack181.sql`.
**Database (patches via DO-block replace):** `private.has_event_role`, `private.audit`, `can_command` (Pack 18), `request_counter_seat`, `event_staff_role_check`, `move_match_in_queue`, `save_queue_plan`, `clear_manual_queue`, `send_event_announcement`, `correct_result`, `void_result`, `withdraw_entry`, `build_schedule`, `record_tie_decision`, registration-admin RPCs, `grant/remove_event_role`, `list_event_staff` (names-only variant). The exact list comes from a script that lists every `is_organizer`-gated function, then hand-classified.
**Existing tests deliberately updated:** `pack09a_gate`:156, `pack09d_gate`:311, `pack15_gate`:166 and 203, plus `schema.fingerprint.txt`.
**Edge Function (new):** `supabase/functions/device-session/` (+ shared pure handler under test).
**Frontend (new):** `src/pages/DeviceSignInPage.tsx` (`/device`, fragment handling), `src/lib/deviceSession.ts` (session secret, refresh, landing routes, whoami), `src/lib/deviceClient.ts` (supabase-js `accessToken` client), `src/components/DeviceBar.tsx`, `src/components/CameraOffButton.tsx`, `src/pages/AnnouncerPage.tsx` + `src/lib/announcer.ts`, `src/data/devices.ts`, `src/data/broadcastControl.ts`, Command Centre **Event Devices** and **Broadcast** panels (create with show-once code + QR, revoke, replace, sign-out-all, signed-in-elsewhere flag; broadcast panel: OBS, Mode, On Air, Fight, Camera, Overlay, Music, Mic, Auto Duck, Camera Safety).
**Frontend (modified; Pack 14-18 files):** `src/lib/supabase.ts` (device-mode switch), `App.tsx` (routes `/device`, `/events/:id/announcer`, `/` redirect for device sessions), `AuthContext.tsx`/`ProfileGate` (skipped in device mode), `Layout.tsx` (device bar), `data/api.ts fetchMyEventContext` (device role display), `PeopleTab.tsx` (descriptions: Secretary / Scorekeeper, Announcer), `CommandCentrePage.tsx`, `CounterPage.tsx` (device landing), `FieldPage.tsx`/Manage entries (scorekeeper queue adjustments), `BroadcastPage.tsx` (optional "technical break" card from `event_camera_state`).
**Shared pure modules:** `src/lib/broadcast/decide.ts` (`decideProgram`), `src/lib/camera.ts`, reusing `state.ts`, `arena.ts`, `eventDay.ts`, `lyst/timer.ts`.
**Controller (new):** `tools/obs-controller/`, `scripts/obs-standin/`, `scripts/e2e/pack181-live.{sh,mjs}`.
**Docs:** `docs/runbooks/PACK181_EVENT_LAPTOP.md`, `docs/runbooks/PACK181_DEVICES.md` (day-of crib sheet), `docs/runbooks/PACK181_HOSTED_ROLLOUT.md` (signing-key import, roles, Edge Function, secrets, order), `STATUS.md` section, `PROJECT_SPEC.md` (devices, roles, Camera Off), `PACK14_OBS_SETUP.md` pointer.

**Build order (each shippable on its own):** (0) post-merge reconciliation + §11.4 spike; (1) event sessions + scorekeeper/announcer role changes + Camera Off state (C) with gates; (2) Announcer (D); (3) control row, `decideProgram`, stand-in, controller (A); (4) audio policy (B); (5) Command Centre panels; (6) runbook, regression, physical checklist. C, Camera Off and D are the Rumble-critical path (no OBS needed); A/B add risk only on the streaming laptop and cannot affect scoring.

---

## 21. Open questions and blockers

**Blockers (first session after Pack 18 merges):**
- **B1** Pack 18 merged and reconciled (§0.1).
- **B2** Hosted Supabase viability of the chosen transport (§11.3): signing-key import + rotation (project-wide Auth change, owner action), custom DB role claim accepted by PostgREST/Realtime, Edge Function CORS. Needs a non-production project/branch or an explicit owner-scheduled window. If not viable and the owner accepts: contingency G′ (documented, not built).
- **B3** OBS WebSocket bind address on the real install (research says all interfaces).

**Owner decisions:**
- **Q1** Controller as a local process (recommended). Is the event laptop Windows (Application Audio Capture, packaging)?
- **Q2** Queue/schedule adjustment: Scorekeeper and Temporary Organizer yes (as planned). Also Head Marshal? (today head marshal cannot reorder; recommended no change.)
- **Q3** *(Resolved by owner 2026-10-06, folded into §7/§13.)* Retained here only to record the decision.
- **Q4** *(Resolved: Temporary Organizer may correct/void results, audited.)*
- **Q5** *(Resolved: Scorekeeper and Temporary Organizer may send announcements, existing limits.)*
- **Q6** Closed/archived events: closing does not end devices (they still end at end + 24 h); archive/delete does. OK?
- **Q7** May a Temporary Organizer revoke (not create) devices? Recommended no (permanent organizer only).
- **Q8** Announcer sees a single "Ready / Not yet ready" per fighter (no reasons)? Recommended yes.
- **Q9** Music: confirm stream-safe/licensed files as the supported default; confirm the venue's SOCAN/Re:Sound position before any commercial playlist is used live. Music during live fights: off (recommended).
- **Q10** *(Resolved: the streaming laptop is a separate controller credential, not a device.)*
- **Q11** *(Resolved: 12-character code, with the HMAC pepper, throttles and expiry conditions of §12.1.)*
- **Q12** Scorekeeper role widening applies to **existing permanent Scorekeepers** too (queue adjustment, announcements, Command Centre read, Camera Off). Accepted? (Required if Secretary and Scorekeeper are one role.)
- **Q13** Temporary Organizer staff operations: may grant/remove every event role **except `organizer`**, names-only staff list. Accepted, or narrower?
- **Q14** Camera Off by the Announcer role means a permanent account holding `announcer` can also cut cameras. Accepted?

**Known limits stated up front:** ducking quality, gate/hold behaviour, PA routing and Windows/macOS packaging can only be proven on the physical laptop; Spotify/YouTube pasted-link playback is not supported by design; hosted behaviour of custom JWT roles is unverified until B2.
