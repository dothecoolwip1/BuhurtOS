# Pack 18.1 plan: automatic event operations, OBS broadcast and temporary event-device access

Status: **PLANNING ONLY. Nothing here is implemented, migrated, deployed or merged.** Written 2026-10-06 against `main` at `90ff429` (Pack 16 merge).

## 0. Gate: Pack 18 is NOT merged

Verified 2026-10-06 (not assumed):

- `origin/main` = `90ff429 Merge Pack 16`. It has no `PACK_18_*.md`, no Command Centre, no `20261012000100_pack18_command_centre.sql`.
- `origin/pack18-command-centre` exists, is 9 commits ahead of main (tip `c9e979f`), and has **no pull request**. It was read only (git show); nothing on it was touched.
- Pack 18 as described on that branch: email + password sign-in, `/events/<slug>/command`, `public.event_command_snapshot`, `private.can_command`, `useAsync(load, deps, refreshDeps)`, a REAL_AUTH e2e mode (real Supabase Auth built from source, with a mail sink), migration `20261012000100`.

**Implementation must not start until Pack 18 is merged to main and that is verified again** (PR state `merged: true`, merge commit reachable from `origin/main`). Then: branch from the NEW main, re-read the Pack 18 diff, and reconcile every "after Pack 18" item in §20 against what actually landed. Every Pack 18 detail in this plan is from the unmerged branch and may change.

This document is the only file added. Deliberately not touched: `STATUS.md`, `PACK_18_COMMAND_CENTRE.md`, anything under `src/` or `supabase/`.

---

## 1. Current-system findings (all read in `main`; Pack 18 items marked)

### Tournament truth (Pack 13 / 09A)
- There is **no Lyst entity.** "Lyst 1/2" is `matches.field` (free text, default "Field 1"). `private.field_key(text)` = `lower(coalesce(nullif(btrim(field),''),'Field 1'))`; TS mirror `fieldKey` in `src/lib/eventDay.ts`. Timer, join codes and counter seats are keyed `(event_id, field_key)`.
- `matches.queue_state`: `scheduled | on_deck | in_the_hole | active | final`. Auto-advance on final is a deferred constraint trigger (`matches_advance_queue`); it never blocks a result. `private.queue_ordered` / `settle_field_queue` own "next fight".
- **Official** = `lyst_rounds` (marshal's awarded score, `running → confirming → confirmed`), `match_discipline`, `lyst_timer` (modes `fight|break|extended_break|dq|equipment|custom`; server-synced clock `src/lib/lyst/timer.ts`). **Provisional** = counter tallies (`lyst_counts`), staff-only, never read by anything official. Result is saved by a person via `lyst_finalize → submit_match_result → finalize_match`; conflicts go to the head marshal; corrections via `enter_official_result`, `correct_result`, `void_result`, `reopen_match`, all audited.
- Public, read-only state: view `lyst_public_state` (timer, round, official score, non-voided discipline marks, `server_now`; no names, no counters, no reasons, no account ids), `lyst_round_scores`, `matches`/`entries` (public events), `match_live_scores`.

### Broadcast (Pack 14)
- `/broadcast/:eventId/:field` (chrome-less, public, no token). `broadcastScene(view, {phase, nowMs})` in `src/lib/broadcast/state.ts` derives `SceneMode = idle|upcoming|intro|ready|live|paused|break|equipment|dq_clock|disqualified|complete|winner|between`. Inputs are public reads (`useArenaData`, `useLystPublic`, `fetchSides`, `useBroadcast`). `STALE_AFTER_MS = 20_000`; the overlay keeps the last true state and self-recovers. `COMPLETE_MS = 8000`, `RESULT_HOLD_MS = 25000`.
- Tables `event_broadcast` (stream URL, look) and `event_sponsors`; writers organizer-only.
- **Gaps (confirmed by grep): no "on air / primary field" concept anywhere, no server-side scene or override state, no OBS code, nothing named "announcer", no `secretary`/`announcer` role.**
- Pure-ish modules the controller can reuse: `arena.ts`, `eventDay.ts`, `broadcast/state.ts`, `lyst/timer.ts` import only types and each other (verified imports). Re-verify there is no browser/supabase import transitively before bundling (§20).

### Roles and permissions
- `event_staff(event_id, user_id, role)`, no expiry column, no granted_by. Roles today: `organizer, head_marshal, marshal, scorekeeper, medic, check_in, inspector`. **No counter, secretary or announcer role.** Writes only via `grant_event_role_by_email` / `remove_event_role` (organizer; audited).
- Single choke point: `private.has_event_role(event, roles[])` = `is_owner()` OR (org enabled AND ((matching `event_staff` row AND `event_staff_active`) OR ('organizer' requested AND org admin of event))). `event_staff_active` = `current_date <= coalesce(ends_on, starts_on) + 7` using the **server** date, not the event time zone.
- Helpers: `is_organizer`, `can_score` (organizer, head_marshal, marshal, scorekeeper), `can_resolve_results` (organizer, head_marshal), `can_read_health` (organizer, medic), `can_check_in` (organizer, head_marshal, check_in), `can_inspect` (organizer, head_marshal, inspector), `can_see_readiness_detail` (organizer, head_marshal, check_in, inspector). Pack 18 adds `can_command` = `can_resolve_results`.
- **Everything resolves identity through `auth.uid()`.** Nothing reads JWT claims other than `sub`. No anonymous sign-ins anywhere. `private.audit` writes `actor = auth.uid()`; it has no actor parameter.
- Platform owner = `platform_roles` row written only by the database owner. Org admin = `organization_staff`. Event organizer is event-scoped. Owner decision 2026-10-03: "Event-specific roles should expire shortly after the event finishes" (implemented today as +7 days).

### Counters
- Counters are ordinary signed-in users. `create_lyst_join_code` (can_score) makes a 10-char code, **stored in plaintext**, 30 min life. `request_counter_seat(code)` (any signed-in user; 15 attempts / 10 min / user; wrong code returns `invalid` rather than raising so the attempt row survives) creates a pending seat; `assign_counter_seat` (can_score) activates it for 8 h. `counter_record/undo/submit/state` need only an active own seat. Tallies readable by can_score and the counter's own rows only.

### Auth and platform
- supabase-js PKCE, persisted session in localStorage (`sb-<host>-auth-token`). Email code via `signInWithOtp`. `profiles` is created by trigger `on_auth_user_created` on `auth.users`; `profiles_select_own` (own row only).
- **No `supabase/config.toml`:** hosted Auth settings (JWT expiry, anonymous sign-ins, captcha, redirect list) are not in the repo and must be checked in the dashboard by the owner.
- One Edge Function exists (`send-push`, shared-secret door `x-dispatch-secret`, secret in `private.push_config`, service-role key, pg_net kick, one-minute sweep). It is the precedent for a server-side door.
- Service worker caches only anonymous public GETs (`Authorization === 'Bearer ' + apikey`); a user/device token is never cached. SW update waits for a safe moment. Manifest `start_url` is `./?source=pwa`, `scope` `./`.

### Event time
- `events.starts_on date`, `ends_on date`, `timezone text default 'America/Edmonton'`. **There is no event end time-of-day.** `closed_at` (close_event) is the only explicit finish action; `status` is draft/published/cancelled.

### Audit and tests
- `audit_log(actor uuid, event_id, action, subject, details)`; read = owner or organizer. `private.audit` is definer, not API-callable.
- Gates: `supabase/tests/*_gate.sql` (one transaction, `t.as_anon/as_user/as_admin`, `t.expect_*`), listed in `run_all.sh`; `schema.fingerprint.txt` must be regenerated in the same commit as any schema change. Browser live scenarios: `scripts/e2e/*-live.sh` wrap `eventday-live.sh` (real Postgres + PostgREST + Chromium; `localstack.mjs` stubs auth; JWTs minted HS256 locally). `broadcast-realtime.mjs` has a Phoenix realtime stand-in (`routeWebSocket`). Pack 18 adds REAL_AUTH (real GoTrue). Live scripts are not in CI.
- Realtime fix (PR #35): `realtimeChannel(name)` gives every subscriber a unique topic; `ErrorBoundary` wraps routed screens. New screens must use both.

---

## 2. Architecture overview and the one rule

```
Pack 13 tournament truth (DB)  ──public reads──►  Pack 14 overlay (browser source in OBS)
        │                                                 ▲
        └──public reads + control row──►  LOCAL CONTROLLER (laptop)  ──ws://127.0.0.1──►  OBS (cameras, audio, encode, stream)
                                              │ outbound only
                                              └─► heartbeat RPC (status only)
Organizer / temp organizer ──RPC──► event_broadcast_control (desired mode only; no OBS words)
```

**Rule: OBS and the controller are consumers. They can never be a dependency of scoring, timer, queue, results, check-in or readiness.** No Pack 13/16 code path reads controller or OBS state; the controller code cannot import any write RPC other than its own heartbeat. A dead controller changes nothing in the tournament.

---

## 3. OBS controller architecture (A)

### Packaging decision
Recommended: **a small standalone local process ("BuhurtOS Broadcast Companion")**, Node 22 LTS + TypeScript, in a new `tools/obs-controller/`, shipped as a zip with a pinned Node runtime and `Start BuhurtOS Broadcast.bat` / `.command` (avoid unsigned `.exe` SmartScreen/Gatekeeper friction; revisit Node SEA/`bun compile` only if tested).

| Option | Verdict |
| --- | --- |
| (b) local process | **Chosen.** Allow-list enforced in code we control; OBS password never reaches a web page; no browser mixed-content / Chrome Local Network Access dependence (LNA now gates loopback access in Chrome 145+/147: a hosted https page would hit a permission prompt); survives a closed browser tab; works offline. |
| (a) hosted BuhurtOS page in laptop browser | Rejected as primary: LNA prompt, Safari/Firefox unverified, page would hold the OBS password and full OBS authority, dies with the tab. |
| (c) OBS Browser Dock | Unverified whether a dock can reach `ws://localhost:4455`; same page-holds-password problem. Possible later as a *read-only status* dock showing the Command Centre. |
| (d) OBS Lua/Python script | Cannot reach BuhurtOS cleanly; harder for a non-developer to maintain; no allow-list boundary. |

Dependencies kept tiny for supply-chain reasons: `ws` plus Node `crypto`; implement the obs-websocket v5 handshake directly (SHA-256 challenge, two-step base64) behind a **typed allow-list client**. (`obs-websocket-js` is MIT and acceptable if the hand-rolled client proves costly; Node engine version unconfirmed.)

### Lifecycle
- **Start:** operator double-click; optional start-at-login documented (Windows Task Scheduler / macOS LaunchAgent). Starts fine before or after OBS.
- **Local UI:** `http://127.0.0.1:4777` (bound to loopback only): connection lights (OBS, BuhurtOS, mapping), AUTO/MANUAL display, mapping wizard, "Camera Off" button, "Test scene" buttons, log tail. Not reachable from LAN.
- **OBS connection:** `ws://127.0.0.1:4455` with the OBS WebSocket password. obs-websocket **binds all interfaces and has no localhost-only option** (confirmed from OBS discussions/issues; not verified in the live UI). Runbook therefore requires: authentication on, strong password, **OS firewall blocks inbound 4455**, and `netstat` check. The controller itself only ever connects to 127.0.0.1.
- **Credentials (local only):** OBS password and BuhurtOS device code stored on the laptop with OS protection (Windows DPAPI via the user profile / macOS Keychain; fallback a user-only-readable file; env var is the weakest). Never in Supabase, never in a URL, never sent to any browser, never logged. The controller never reveals the OBS password in its UI or heartbeat.
- **State in (read):** BuhurtOS public reads (the same sources as the overlay: matches/entries/`lyst_public_state`/`match_live_scores`) plus the control row (§6). Reads need no credential. Realtime with polling fallback (reuse the 3-5 s cadence; own unique channel names).
- **State out (write):** one heartbeat RPC every 5 s (§13). Requires the optional `broadcast_controller` device credential; without it the controller still runs AUTO from public data and local manual, it just cannot be commanded or monitored remotely.
- **Reconnect:** OBS: backoff 1, 2, 5, 10 s (cap 10 s), forever. On every (re)identify: `GetVersion`, `GetSceneList`, validate mapping, read `GetCurrentProgramScene`, reconcile. BuhurtOS: polling fallback, jittered backoff.
- **Restart recovery:** persisted local file holds mapping, local Camera Off latch, last applied `rev`. Startup = connect, read state, **reconcile once to what should be on air now**. No history, no replay.
- **Internet loss:** keep the current OBS program scene; never "fail" to holding because data is stale (a fight is probably still happening and the camera is the right picture). Latched Camera Off stays. Overlay keeps its own last-known-state behaviour. On return: re-read, reconcile.
- **Not a remote agent:** the controller makes **outbound** connections only (no listener except loopback UI). The server can only supply a closed vocabulary: `mode ∈ {auto, manual}`, `target ∈ {lyst(field_key), holding, break}`, `camera_off bool + reason enum`, `music_mode`, `auto_duck bool`. It never receives scene names, URLs, file paths, filter settings, hotkeys, commands or code. Field→scene names come from the **local** mapping only. The OBS request allow-list (below) is enforced in the client wrapper; every request in any batch is checked.

### OBS request allow-list (default deny)
Allowed: `GetVersion`, `GetStats`, `GetSceneList`, `GetCurrentProgramScene`, `SetCurrentProgramScene`, `GetStudioModeEnabled`, `GetInputList`, `GetInputMute`, `SetInputMute`, `GetInputVolume`, `SetInputVolume`, `GetSourceFilterList`, `GetSourceFilter`, `SetSourceFilterEnabled`, `SetSourceFilterSettings` (only for the configured ducking filter on the configured music source), `GetMediaInputStatus`, `TriggerMediaInputAction` (play/pause only, only the configured media source), `GetStreamStatus` and `GetRecordStatus` (read-only status).
Never: `Start/Stop/Toggle Stream|Record|Output|VirtualCam|ReplayBuffer`, `GetStreamServiceSettings` (**returns the stream key**), `SetStreamServiceSettings`, profile / scene-collection / video-settings setters, `Remove*`, `Create*` (the operator builds scenes; the controller never creates), `SetInputName/SetSceneName`, `SetInputSettings` (can set browser-source URLs and file paths), all `Open*Dialog/Projector`, `CallVendorRequest`, `TriggerHotkey*`, `BroadcastCustomEvent`, `Sleep`, `SetPersistentData`, `SaveSourceScreenshot`. The controller **never starts or stops the stream**; going live stays a human decision.
Event subscriptions: Scenes | Inputs | Outputs | General (+ Filters, MediaInputs if used). Do not subscribe to the high-volume meter bit unless a meter UI is built.

---

## 4. Camera / scene mapping design

Mapping is configured in the controller's local UI (a wizard reads `GetSceneList`) and stored **locally**; a copy of the names goes up in the heartbeat for Command Centre visibility. Rationale: the scene names exist only in that laptop's OBS; keeping them local removes a server→controller path that could carry arbitrary strings.

Per Lyst (field key) the operator maps:
- `live` scene: camera + Pack 14 overlay browser source `/broadcast/<event>/<field>` (layout full). The overlay's own scenes (intro, ready, live, break, winner...) already draw the graphics over the camera; the controller does **not** try to drive them.
- Optional `graphics` scene (same overlay, no camera, e.g. a background) for pre-fight/upcoming if wanted; default = use the `live` scene.

Global scenes: `holding` (between fights: overlay `layout=queue` and/or `sponsors`), `break` (long break/lunch), `camera_off` (**no camera sources and no browser sources**; static image/text only, so it works when everything else is broken).

Validation: every mapped scene must exist in `GetSceneList`. Missing scene → mapping problem is shown locally and in the heartbeat; fallbacks: missing `live` → `holding`; missing `holding` → stay put and alert; missing `camera_off` → **red warning at setup** (it is a required scene) and local Camera Off falls back to muting program audio + `holding`. Unmapped Lyst going live: do nothing, report "Lyst 3 is live and has no camera mapping". Lyst count is not hard-coded (event `field_count` + any `field_key` seen).

---

## 5. AUTO selection state machine

A **pure function** `decideProgram(input) → { target, reason, lock, dwellUntil }` in a shared module (tested with vectors, used by the controller and by the Command Centre "AUTO would show…" line). Inputs: per-field `broadcastScene` result (reuse; do not re-derive), field first-live times (`timer_started_at` of the current fight, else first observed), control row, previous decision (lock + since), mapping, now.

Per-field phase from `SceneMode`:
- `fightLive` = `ready`?, no: **`live`, `paused`, `break` (between rounds), `equipment`, `dq_clock`, `disqualified`** (the fight is in progress);
- `armed` = `ready`, `intro` (fight called, clock armed);
- `post` = `complete`, `winner`;
- `quiet` = `idle`, `upcoming`, `between`.

Policy (recommended):
1. **Camera Off latched (server `camera_off` OR local latch) → `camera_off`.** Beats everything.
2. **`mode = manual`** → the manual target (Lyst N / holding / break). Nothing automatic moves it.
3. **AUTO, current-live lock.** If a lock on field F is held and F is `fightLive` or `post` → stay on F (`live` scene). Do **not** switch at a round break, pause, equipment, DQ countdown, or when another Lyst starts. Result presentation (`complete` 8 s + `winner` ~25 s) stays on the camera scene.
4. **Release** only when F reaches `quiet` (its winner presentation has ended) **or** F's fight is voided/reopened.
5. **Pick next** after release (and on first start), in order:
   a. fields with `fightLive`: the **first-live** (earliest fight start); ties → broadcast priority list (organizer-ordered field list, default Field 1, Field 2…); ties → `field_key` ascending;
   b. else fields that are `armed`: earliest armed; same tiebreaks. This pre-selects the camera as the fighters walk on;
   c. else `holding`.
6. **Anti-thrash:** minimum dwell 10 s on any AUTO target before another AUTO switch (except into `camera_off`); a just-released field cannot be re-taken for 5 s; score/timer/penalty changes never produce a switch because the decision depends only on phase, not on values; the controller calls `SetCurrentProgramScene` **only when the desired scene differs from the actual program scene** (idempotent, no reload, no flicker).
7. **Other live Lysts** are *represented, not taken*: status shows "Also live: Lyst 2 (C vs D, round 2)" in the controller UI and in the Command Centre broadcast panel, with a one-tap **Take Lyst 2** (which goes to MANUAL). Optional later: "switch, stay in AUTO".
8. **Return to Auto** clears manual + lock and runs step 5 against **current** state. It never replays missed transitions; a fight that finished while manual is simply not shown.
9. **Between fights, next fight:** same Lyst → returns through `quiet` to `holding`, then `armed` re-selects F; different Lyst → via `holding`. Both are the same rule.

Edge: two fights `fightLive` at AUTO start (e.g. controller restart) → rule 5a by first-live, so a restart lands on the same fight AUTO would have had without it (first-live time is from `lyst_timer.started_at`/`lyst_rounds`, durable in the DB, not controller memory).

---

## 6. Manual override design

New table `event_broadcast_control` (one row per event; §15): `mode` (auto|manual), `target_kind` (lyst|holding|break), `target_field` (field_key), `camera_off bool`, `camera_off_reason` (medical|privacy|camera_problem|venue|other), `music_mode` (auto|muted|paused), `auto_duck bool`, `priority_fields text[]`, `rev`, `updated_at`, `updated_by`. Public read for public events (it holds no secret and lets the overlay show a "technical break" card); writes only via `set_broadcast_control(p_event, ..., p_expected_rev)` (revision-checked; two people cannot silently overwrite each other; audited `broadcast.control`).

Manual controls: Take Lyst N (one per mapped Lyst), Holding / Between fights, Break, **Camera Off**, **Return to Auto**. **Manual always beats AUTO** (rule 2) and **Camera Off beats manual**. Who may call it: organizer; temporary organizer **only if that device was created with `allow_broadcast_controls`** (default off); see §13-14 and open question Q3 for Camera Off by marshals.

---

## 7. Emergency Camera Off

- One large, red, always-visible button on: Command Centre broadcast panel, the controller local UI, optionally an OBS hotkey (operator-set in OBS, outside the controller).
- Effect: program → `camera_off` scene (static, no camera, no names, no score), reason recorded. **Latches** (survives controller/OBS restart and internet loss) until a person clears it. Clearing = **Return to Auto** or a manual Take, never automatic, never by a fight starting.
- Local latch and server latch are independent (`effective = server OR local`): if the internet is down the on-site operator can still cut the camera; the server value can still cut it remotely. The local latch clears only locally.
- Audio: Camera Off does **not** blast music. Default policy: Camera Off mutes music (fade out); reason `medical` additionally forces `music_mode = muted` and keeps the announcer mic untouched. Operator can unmute manually. Camera Off never *starts* anything.
- It is a presentation action only. It does not pause the timer, change the score or touch the queue (those are marshal decisions in Pack 13).

---

## 8. OBS recovery behaviour (specification the tests will assert)

| Failure | Behaviour | Tournament |
| --- | --- | --- |
| OBS closes mid-fight | controller: "OBS not connected", retries; heartbeat says so | unchanged |
| OBS restarts mid-fight | re-identify, re-validate mapping, reconcile to current desired scene (fight still live → camera scene) | unchanged |
| Controller closes / restarts | OBS keeps its current scene; on start, reconcile once from current state; latch and mapping restored from local file | unchanged |
| Internet lost | keep current scene, latched Camera Off persists, stale warning locally; no switch to holding | unchanged |
| BuhurtOS realtime drops | polling fallback; same as above if polling also fails | unchanged |
| Laptop reconnects | re-read; reconcile; no replay | unchanged |
| Camera mapping missing | report; fall back per §4; never throw | unchanged |
| OBS scene missing | as §4 | unchanged |
| Controller crashes on bad data | process supervisor restart (the `.bat` loops); heartbeat gap shows in Command Centre as "controller silent for 30 s" | unchanged |

---

## 9. Audio architecture (B)

**Principle: millisecond ducking is done inside OBS (native Compressor with sidechain), not by the controller.** The controller only sets coarse policy.

### OBS-native ducking
- Put a **Compressor** filter (`compressor_filter`) on the Music source (or a "Music" group), **Sidechain/Ducking Source = Announcer Mic**. Source-confirmed settings: `ratio` 1-32 (default 10), `threshold` -60..0 dB (default -18), `attack_time` 1-500 ms (default 6), `release_time` **1-1000 ms (hard cap 1000)**, `output_gain` -32..+32, `sidechain_source`. There is **no hold parameter**; release is the fade-back.
- Starting values (engineering judgement, **to be tuned with the real wireless mic**): threshold about -30 dB (so only speech trips it), ratio 6-10, attack 10-20 ms, release 1000 ms, output gain 0. Target "ducked" depth about -14 to -20 dB (about 10-20 % volume); set depth by ratio/threshold and verify by ear and by meter.
- "Wait 1-2 s then return" cannot come from the compressor alone (release max 1 s). Add a **Noise Gate on the mic** (open/close threshold, attack/hold/release) so room noise and breaths do not trip the sidechain and short gaps between words are bridged by the gate's hold; the sidechain should read the mic **after** its filters (to be confirmed on a real OBS). Combined hold + 1 s release gives roughly 1-2 s before music is fully back. Pumping between words is controlled by the gate hold + the 1 s release + the threshold. **Unverified on real OBS: filter key names (`GetSourceFilterDefaultSettings` will confirm), gate hold range, sidechain tap point.** If native cannot reach the target, fallback (documented, not preferred): controller reads `InputVolumeMeters` and drives a fade with SetInputVolume.
- Configuration the organizer sees: Normal music level, Ducked depth, Attack, Release, plus "Auto duck on/off". The first-time filter creation is done by the operator following the runbook (the controller cannot create filters). A setup check button reads the filter and reports "Ducking filter found, keyed to Announcer Mic" or what is wrong; an optional "apply recommended values" uses `SetSourceFilterSettings` on that one filter.

### Music source options (see §10 for the legal position)
1. **Default / recommended:** licensed or stream-safe audio files in an OBS **Media Source (playlist)** named by the operator. Fully controllable: `TriggerMediaInputAction` play/pause, volume, mute, ducking. No capture.
2. Operator-started app/browser playlist (Spotify, YouTube, YouTube Music) captured by OBS **Application Audio Capture** (Windows) or a macOS audio-routing source. The controller can **mute/fade** it, duck it, but cannot press play in another application, so "Play/Pause" for this source is displayed as Mute/Unmute.
3. Local audio-device input (DJ mixer line-in).

### Controller audio commands (all coarse)
Play/Pause (media source only), Mute music, Auto Duck on/off (`SetSourceFilterEnabled` on the ducking filter), music-level restore via short stepped `SetInputVolume` fades (about 1 s, steps of 5-10 %), never per-word.

### Safe behaviour by presentation state (defaults, event-configurable)
| State | Music |
| --- | --- |
| Fight live (and its break/pause) | **faded out and muted** (arena audio and announcer are what matter); restored when the fight reaches `quiet` |
| Normal between fights / holding | on, normal level, auto-duck on |
| Break (long) | on, normal level |
| Camera Off | **muted** (never auto-on) |
| Medical hold (Camera Off, reason medical) | muted and locked until a person unmutes; announcer mic untouched |
| Controller or OBS down | OBS keeps whatever it last had; ducking filter keeps working (it is inside OBS) |
Hard rule: music must never exceed the announcer: ducking is native; "Auto Duck off" is allowed but shows a warning; if the mic source is missing the controller reports it and **mutes music rather than leaving it un-duckable** (configurable).

### Venue PA vs livestream audio
Do not assume one mix. Possible topologies, chosen at the event:
- A. PA fed from the OBS **monitor output**: OBS has **one global Audio Monitoring Device**; per source `Off | Monitor Only | Monitor and Output`. Music = Monitor and Output (both); livestream-only music = Output only; venue-only music = Monitor Only. Mic is Monitor and Output only if the announcer must be heard in the venue **through OBS** (feedback risk: the announcer's wireless mic should normally go to the PA directly, not via OBS).
- B. PA fed by the mixer; OBS gets a mixer feed or separate mic. Music in OBS is livestream-only; the venue music plays from the venue system (outside BuhurtOS).
- C. Virtual audio cable (VB-Cable on Windows, BlackHole/Loopback on macOS; not official OBS features) to carry a second mix.
Audio-track routing (OBS tracks 1-6 per source in Advanced Audio Properties; the stream uses one track) is also how livestream-only content is kept off the PA. The runbook gives one diagram per topology and a "which one do I have?" test (play music, mute in OBS, listen in the room and on the stream). Controller exposes **no routing control**; routing is a one-time OBS setup. UI labels and the 32.x monitoring-API change are to be confirmed on the real install.

---

## 10. Spotify / YouTube / music findings (not legal advice)

- Latest OBS Studio found: 32.2.2 (2026-08-14). Verify at implementation.
- **Spotify:** the Web API `PUT /v1/me/player/play` (`context_uri`, scope `user-modify-playback-state`) needs Premium and an active Spotify client device; a pasted playlist link maps to `spotify:playlist:<id>`. **But** Spotify's consumer terms are personal, non-commercial; public/commercial playback (a paid-entry tournament, a public stream) is not covered even with Premium; developer terms bar features that capture or rip content, and streaming-SDK apps cannot be commercial without Spotify's approval. (Developer pages were blocked from the research environment; this rests on search snippets: re-verify at https://developer.spotify.com/terms and https://support.spotify.com/us/article/spotify-public-commercial-use/.) **Decision: do not build Spotify API playback control.** Spotify may be used by a person for private rehearsal only.
- **YouTube / YouTube Music:** the YouTube API developer policies prohibit background play and isolating audio from video; an IFrame embed in a visible tab is allowed as an embed. YouTube Music is a personal-use service (commercial terms unconfirmed). **Do not extract or download audio. Do not build an embedded hidden-audio player.**
- **Livestream copyright:** commercial recordings played on a stream are exposed to Content ID claims, muted VODs, strikes (YouTube, Twitch, Facebook). Playing them in a venue is a *public performance* that needs licences (in Canada, SOCAN for the musical works and Re:Sound for recordings, usually held by the venue or bought via tariff). **Action for Garrett:** ask the venue what it already licenses; treat any live-stream music as stream-safe only.
- **What can legitimately be automated from a pasted link:** nothing that starts playback. **Supported design:** (1) stream-safe/licensed local files or a licensed provider's files in a Media Source (best, fully controllable); (2) a person starts any playlist in its own app and OBS captures that app; BuhurtOS ducks/mutes. A pasted link, if offered at all, is a **local-only convenience** in the controller UI ("Open playlist" opens it in the laptop's default browser/app, one click by a human); it is not stored in Supabase and never server-driven. The UI shows a visible licence warning when the source is Spotify/YouTube.
- Stream-safe options to evaluate (licences must explicitly cover live events/public performance, not just "streaming"): YouTube Audio Library, Pretzel, StreamBeats, Uppbeat, Epidemic Sound, Artlist. Unverified.

---

## 11. Temporary-device authentication architecture (C)

### Options evaluated (all must keep Supabase as the backend)
| Option | Description | Verdict |
| --- | --- | --- |
| 1 Shared email/password account | forbidden by the brief | Rejected |
| 2 Custom-signed JWT with a dedicated DB role | needs the project JWT secret in a function; own refresh logic; supabase-js `accessToken` mode disables auth APIs; hosted signing-key model is moving | Rejected: highest-value secret, bespoke session handling |
| 3 Supabase anonymous sign-ins + `redeem` RPC binding `auth.uid()` | no service role, no function | Fallback: needs the **global anonymous-sign-in toggle** (anyone can mint users), needs captcha, orphan cleanup; code attempts are per-throwaway-user so rate limiting is weak |
| 4 **Per-device real `auth.users` principal minted by an Edge Function after code verification** | `device-sign-in` verifies the code, ensures one auth user per device credential, returns a one-time token that the client exchanges for a normal Supabase session | **Chosen** |

### Chosen flow
1. Organizer calls `create_event_device(event, label, role, options)` (SQL RPC): generates a high-entropy code, stores only its hash, returns the plaintext **once**.
2. Device opens `/device` (chrome-less page; also reachable by a QR that carries the code in the URL **fragment** so it is never sent to a server or logged) and enters the code.
3. Client POSTs `{ code }` to Edge Function `device-sign-in`. The function: normalises the code; throttles (§12); SHA-256s; calls service-role-only `device_redeem(hash, ip_hash)`; on success ensures one `auth.users` row for that device (`admin.createUser`, no email delivery, `app_metadata: {bos_device: true}`, synthetic address on a non-routable domain, no password); if a prior session exists it is killed (last sign-in wins; the device list shows "signed in elsewhere"); returns a one-time token (`generateLink` hashed token). Uniform failure answer for wrong/expired/revoked.
4. Client calls `supabase.auth.verifyOtp({ token_hash, type })` → ordinary Supabase session, persisted by supabase-js, refreshed automatically. From here every existing `auth.uid()`-based RLS/RPC works unchanged.
5. Client calls `device_whoami()` → `{ event_slug, event_name, role, label, expires_at }` and routes to the role's landing page.

**Why this fits the codebase:** all permission code resolves identity via `auth.uid()`; a real principal means no RLS/RPC rewrite, existing JWT refresh, realtime and service-worker behaviour. The Edge Function precedent (`send-push`) exists. The local test stack's REAL_AUTH mode (Pack 18) runs real GoTrue so the mint/exchange path is testable for real.

**Authority never lives in the JWT.** The DB decides on every call: `private.device_active(uid)` re-checks revocation, event, and expiry from tables. A leaked, revoked or expired token has **zero** event authority immediately, even before Supabase deletes the session (cleanup is belt-and-braces, §12).

**Things to verify before building (hosted-settings unknowns, not in repo):** that `admin.createUser` + `generateLink` + `verifyOtp(token_hash)` works with the hosted project's settings with sign-ups disabled/enabled either way; that the synthetic address passes GoTrue validation (else use a project-owned domain); that deleting rows from `auth.sessions` from a definer function is permitted on hosted (else fall back to `ban_duration` on revoke and rely on DB authority); JWT expiry setting; no email is sent in this path. These checks are the **first** implementation task in the new session and need owner dashboard access.

### Device principal containment
A device principal is "authenticated" and could call every function granted to `authenticated` that merely requires a signed-in user (register, team requests, fighter claims, profile changes, bug reports, push registration...). Containment:
- `private.is_device()` (true iff `auth.uid()` is in `event_devices.user_id`). Device principals have `app_metadata.bos_device`, no email, no profile onboarding (`ProfileGate` bypass).
- **Classification gate:** a SQL gate enumerates every function executable by `authenticated` and requires it to appear in an explicit table `device_policy` (`allowed_device` | `denied_device` | `role_checked`). A new RPC without a classification **fails the gate**. Every `denied_device` function is also tested to refuse a device principal. This turns "which generic RPCs can a device call?" into a tested inventory rather than a hope.
- `request_counter_seat` for a device: the join code's event must equal the device's event.

---

## 12. Code storage, verification, rate limiting, session, expiration, persistence

### Code
- 16 characters of Crockford base32 (no I, L, O, U) = **80 bits**, generated with `gen_random_bytes` in `create_event_device`, shown as `XXXX-XXXX-XXXX-XXXX`; case-insensitive; input normalisation maps `O→0`, `I/L→1`. Optional display as QR (fragment-carried) to avoid typing.
- Stored: `sha256(normalised code)` in `event_devices.code_hash` (unique index). 80 random bits make a per-code salt/pepper unnecessary. **No plaintext is stored, ever; no hint of the code is stored.** The plaintext exists only in the create/replace RPC response, in the organizer's browser for that one view.
- Never logged: the Edge Function logs no request body; the code travels in a POST body (not URL, not query string); the QR carries it in the fragment; `audit_log` details never include it; no Realtime/public table contains it. A gate greps `audit_log`, the device table and `pg_stat_statements`-style captured text for the generated code after a full scenario.

### Verification and rate limiting
- `device_redeem` is service-role only; `event_devices` has RLS on and **no** client grants.
- Throttles (all counted in a service-only `device_code_attempts(at, ip_hash, outcome)`; `ip_hash = sha256(ip || daily salt)` so IPs are not stored raw): per IP 10 failures / 10 min; global 100 failures / 10 min as a circuit-breaker (a venue NAT shares one IP: 8 devices will not trip it). Throttle responses look the same as a bad code. A lockout only blocks **new** sign-ins; existing sessions are unaffected, so a guesser cannot take devices down.
- Entropy check: 80 bits against 10 guesses / 10 min per IP is not enumerable. Uniform responses and a fixed-minimum response time stop enumeration/timing leaks. Expired/revoked/wrong are indistinguishable.

### Session and persistence
- One credential = one device principal = at most one live session (last sign-in wins; "signed in on another device at hh:mm" is shown to the organizer; this also exposes a copied code).
- Persistence: supabase-js stores the session; closing/reopening the PWA keeps it until sign-out, revocation, expiry or security invalidation. No per-fight re-entry. **iOS home-screen PWAs have storage separate from Safari**, so the code is entered once inside the installed app. `/` redirects a device principal to its landing page (the manifest `start_url` stays `./?source=pwa`).
- A slim non-dismissable device bar on every device screen: label, event, role, "access ends <local time>", **Sign out this device**.
- `device_whoami()` is called at launch and on focus; if it reports revoked/expired the client signs out and shows "This device's access has ended".

### Expiration (server-side)
Rule: **access ends at EVENT END + 24 h, exactly.**
- "Event end" is not stored as an instant. Defined as **the end of the event's last local day: midnight starting `ends_on + 1`, in `events.timezone`**: `((ends_on + 1)::timestamp AT TIME ZONE timezone)`.
- Expiry instant = that + `interval '24 hours'` (exact hours, not a calendar "1 day", so DST is irrelevant). Example: Saturday-only event ending `ends_on = 2026-10-10` in `America/Edmonton` ends Sun 00:00 MDT; devices are valid through Mon 00:00 MDT (exclusive).
- Valid iff `valid_from <= t < expiry` and not revoked. **End + 23:59 → valid; End + 24:00:00 → refused.** An optional per-device `expires_at` can only be *earlier*.
- Computed live from the `events` row on every check (`private.device_valid_at(uid, at timestamptz)`; `device_active` = `valid_at(uid, clock_timestamp())`), so rescheduling an event moves device expiry with it and nothing relies on a stored expiry or on the browser. The gate tests `valid_at` with explicit instants (+23:59:59 vs +24:00:00) plus one real-clock check; no test-only clock override ships to production.
- A deleted/archived/cancelled event: devices lose authority (archived stays valid until expiry for read-only closeout? **Q6**).
- Cleanup sweep (hosted pg_cron or the existing one-minute sweep pattern): kills Supabase sessions and bans/deletes expired or revoked device users. Authority is already gone; this stops token refresh and tidies `auth.users`.
- Comparison note: `event_staff` real accounts expire at `ends_on + 7` server dates (existing, unchanged by this pack). Devices are deliberately stricter.

---

## 13. Permission matrix (maps real screens/RPCs)

Legend: ✔ allowed · — denied · ◐ conditional (note) · **bold** = new in Pack 18.1. "Check" is the server function that decides.

New roles/principals, defined by what they expand to in `has_event_role` (devices **never** match `organizer`, never match `medic`):
- `counter` device → no staff role; own seat only (existing counter RPCs), joining only its own event.
- **`secretary`** → effective staff role `check_in` + new helper `can_manage_registrations` (organizer, secretary) + read access to Command Centre (`can_command` extended). Not `can_read_health`.
- `marshal` device → effective `marshal` (exactly today's marshal).
- **`announcer`** → no staff roles; read-only; one extra read RPC (§14).
- **`temporary_organizer`** → effective `{head_marshal, marshal, scorekeeper, check_in, inspector}` and nothing else; **`is_organizer()` stays false** for it. It gains organizer-only abilities **only** through a new helper `private.is_event_operator(e)` (= `is_organizer(e)` OR active temporary_organizer device of e) substituted into an explicit allow-list of RPCs (default deny). The same new roles `secretary` and `announcer` are also added to the `event_staff` role set so permanent accounts can hold them.
- **`broadcast_controller`** (optional 9th device, the streaming laptop) → heartbeat RPC only.

| Action → RPC / mechanism → check | Counter dev | **Secretary** | Marshal dev | **Announcer** | **Temp organizer** | Perm. organizer | Head marshal | Scorekeeper | Check-in | Inspector | Captain | Fighter |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| View live fights, official score, timer, upcoming, results (public reads) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Own counter seat: `request_counter_seat`, `counter_record/undo/submit/state` (own active seat) | ✔ (own event) | — | — | — | — | ✔* | ✔* | ✔* | ✔* | ✔* | ✔* | ✔* |
| Timer commands `lyst_timer_command`, open Lyst, end/confirm round, discipline: `can_score` | — | — | ✔ | — | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Call fight / advance queue: `set_match_queue`, `advance_field_queue`: `can_score` | — | — | ✔ | — | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Reorder queue / plan / build schedule: `move_match_in_queue`, `save_queue_plan`, `clear_manual_queue`, `build_schedule`: today `is_organizer` | — | **◐ (Q2)** | — | — | **✔ operator** | ✔ | — | — | — | — | — | — |
| Accept / finalize result: `lyst_finalize`, `submit_match_result`: `can_score` | — | — | ✔ | — | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Resolve result conflict, paper result, reopen match, lyst settings: `can_resolve_results` | — | — | — | — | ✔ | ✔ | ✔ | — | — | — | — | — |
| Correct/void competition result, withdraw entry, tie decision: `is_organizer` | — | — | — | — | **— (Q4)** | ✔ | — | — | — | — | — | — |
| Check-in: `set_attendance`: `can_check_in` | — | ✔ | — | — | ✔ | ✔ | ✔ | — | ✔ | — | — | — |
| Inspect armour / weigh-in: `record_inspection`, `record_weigh_in`: `can_inspect` | — | — | — | — | ✔ | ✔ | ✔ | — | ◐ weigh-in | ✔ | — | — |
| Readiness detail `event_readiness`: `can_see_readiness_detail` | — | ✔ | — | — | ✔ | ✔ | ✔ | — | ✔ | ✔ | — | — |
| Readiness override: `set/clear_readiness_override`: `can_resolve_results` | — | — | — | — | ✔ | ✔ | ✔ | — | — | — | — | — |
| `match_readiness` (status words only) | — | ✔ | ✔ | **◐ boolean only** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Registrations: accept/decline, paid, insurance, invite, withdraw: today `is_organizer` | — | **✔ via `can_manage_registrations`** | — | — | ✔ operator | ✔ | — | — | — | — | — | — |
| Registration health/contact data: `can_read_health` (organizer, medic) | — | **— (needs narrower read RPC)** | — | — | — | ✔ | — | — | — | — | — | — |
| Command Centre `event_command_snapshot`: `can_command` | — | **✔ (extend)** | — | — | ✔ | ✔ | ✔ | — | — | — | — | — |
| Organizer announcements `send_event_announcement`: `is_organizer` | — | — **(Q5)** | — | — | ✔ operator (existing limits) | ✔ | — | — | — | — | — | — |
| Staff grants `grant/remove_event_role`, `list_event_staff` (emails) | — | — | — | — | **—** | ✔ | — | — | — | — | — | — |
| Device management: create/revoke/replace/list/sign-out-all | — | — | — | — | **— (revoke-only is Q7)** | ✔ | — | — | — | — | — | — |
| Event settings (UPDATE `events`), publish, close/reopen, archive, delete, org/season link | — | — | — | — | **—** | ✔ | — | — | — | — | — | — |
| Broadcast settings/sponsors `set_broadcast_settings`, `save_event_sponsor` | — | — | — | — | — | ✔ | — | — | — | — | — | — |
| **Broadcast control (AUTO/MANUAL/Take/Holding/Camera Off/music) `set_broadcast_control`** | — | — | **◐ Camera Off only (Q3)** | — | **◐ only if `allow_broadcast_controls`** | ✔ | **◐ Camera Off only (Q3)** | — | — | — | — | — |
| Audit log read | — | — | — | — | — | ✔ | — | — | — | — | — | — |
| Another event | — | — | — | — | — | per own events | — | — | — | — | — | — |
| OBS WebSocket password / stream key | never | never | never | never | never | never (local laptop only) | never | never | never | never | never | never |

\* Permanent accounts holding those roles can use the ordinary counter flow too.

Announcer denials (all must be server-verified): score, counter-score, timer, call fights, queue, results, accept, resolve conflicts, check-in, inspect, readiness override, schedule, registrations, staff, announcements, OBS, music, AUTO/MANUAL, event settings, device codes, any other event. Because an announcer expands to **no** staff role, all of these refuse by the existing helpers with no new code; the gate asserts each.

Server-side boundaries to be proven: `private.has_event_role` (device branch, event-scoped), `is_event_operator`, `can_manage_registrations`, `device_active`, the `device_policy` classification gate, and per-RPC definer checks. UI hiding is never relied on.

---

## 14. Announcer architecture (D)

- Route `/events/<slug>/announcer` (chrome-less like Arena/Broadcast; wrapped in `ErrorBoundary fullPage`; tablet-first, phone/desktop OK). After device sign-in as `announcer` → redirect here. Permanent accounts with the `announcer` role may open it too.
- **Read-only. No write controls render at all.** Data is composed from existing public reads and hooks: `useArenaData`, `useLystPublic` (server-synced clock via `ServerClock`), `buildFieldBoards/buildArena`, `fetchSides` (name, team, crest, photo, record), career/head-to-head RPCs for fighter info, `matches` (final, ordered by `finalized_at`) for recent results. All use `realtimeChannel` unique channels + polling fallback; refresh without remounting (Pack 18 `useAsync` `refreshDeps` pattern). Reconnect shows "Not updating; last good HH:MM:SS" and keeps the last good data.
- Sections: **Now fighting** (per live Lyst: Lyst, competition/category, red/blue fighter+team, crest/photo, official score, round, clock state, cards/penalty marks as the overlay shows them, never counter data); **Up next** (per Lyst); **Coming up** (next 4-6 per Lyst, not the bracket); **Recent results** (last ~8 finalized: names, winner, score/basis, category, Lyst); **Fighter info** panel on tap (name, team, crest, photo, category, corner, career record, event record, earlier fights at this event; test/fictional data labelled "Test").
- **Multiple Lysts:** one column/card per live Lyst; a local "Focus Lyst N" selector stored **only in the device's localStorage**. It writes nothing to the server, so it cannot change queue, score, timer, camera, OBS or anyone else's screen.
- **Never shown:** email, phone, account ids, inspection notes, weights, medical, emergency contact, admin notes, counter data, readiness reasons. Readiness in the announcer view is limited to a single "Ready / Not yet ready" per fighter via a **new minimal definer RPC `announcer_readiness(p_event)`** (announcer, operator roles; returns `match_id`, side, boolean, no reasons). Whether to show even that is **Q8**.
- Public-read limitation: draft/unpublished events are not publicly readable, so the announcer view needs the event **published** (stated on screen otherwise). Widening RLS for announcers is not planned.
- Mobile: one-handed tablet use is passive; sticky Lyst selector; large type; verified at 390x844, 820x1180 and desktop.

---

## 15. Database plan (nothing applied; additive migrations after Pack 18)

Proposed files (numbers after Pack 18's `20261012000100`): `20261013000100_pack181_event_devices.sql`, `20261013000200_pack181_device_roles.sql`, `20261013000300_pack181_broadcast_control.sql`. Each: new gate in `supabase/tests/`, added to `run_all.sh`, fingerprint regenerated in the same commit. Functions follow the repo convention: `security definer set search_path = ''`, revoke from `public, anon`, explicit grants, `auth.uid()` null → 28000, permission → 42501, validation → 22023, `private.audit`, advisory locks for create/revoke races.

**Tables (RLS on, no client grants):**
- `event_devices(id uuid pk, event_id fk events on delete cascade, label text 1-40, role text check in ('counter','secretary','marshal','announcer','temporary_organizer','broadcast_controller'), code_hash bytea unique not null, user_id uuid unique null (auth principal, set at first redemption), allow_broadcast_controls bool default false, expires_at timestamptz null (only earlier), created_by, created_at, first_used_at, last_seen_at, last_signin_at, revoked_at, revoked_by, revoked_reason, replaced_by uuid)`; unique `(event_id, lower(label))` among non-revoked; index `(event_id)`, `(user_id)`.
- `device_code_attempts(at, ip_hash, outcome)` (service-only; pruned after 24 h).
- `event_broadcast_control(event_id pk, mode, target_kind, target_field, camera_off, camera_off_reason, music_mode, auto_duck, priority_fields text[], rev int, updated_at, updated_by)`: select public for public events (+ staff); no writes except RPC. Add to realtime publication.
- `broadcast_controller_status(event_id pk, reported_at, controller_version, obs_connected, on_air jsonb, mapping_problems text[], effective_mode, rev_applied, local_camera_off, also_live jsonb)`: staff-read only (organizer, temp organizer, head marshal).

**Role set:** extend `event_staff_role_check` with `secretary`, `announcer` (same DO-block replace-with-anchor-assertion technique Pack 03/16 used). The `broadcast_controller`/`temporary_organizer`/`counter` are device-only roles.

**Functions:**
- Private helpers: `device_principal(uid)`, `is_device()`, `device_expiry(event)`, `device_valid_at(uid, at)`, `device_active(uid)`, `device_effective_roles(event, uid)`, `is_event_operator(event)`, `can_manage_registrations(event)`.
- **Patched (DO-block replace, anchor asserted):** `private.has_event_role` (add device branch: event-scoped, `device_active`, expansion above; never matches `organizer`/`medic`); `private.audit` (when caller is a device, add `details.device = {id, label, role}`; actor stays the device principal uuid); `can_command` (add secretary); RPCs on the operator allow-list (swap `is_organizer` → `is_event_operator`); `request_counter_seat` (device event match); registration-admin RPCs (`can_manage_registrations`).
- Organizer-facing: `create_event_device`, `list_event_devices` (status active/expired/revoked/never used, last seen, "signed in elsewhere" flag; never a code), `revoke_event_device`, `replace_event_device` (revokes old, creates new, returns new code once, links `replaced_by`), `revoke_all_event_devices`.
- Device-facing: `device_whoami`, `device_sign_out`.
- Service-role only: `device_redeem`, `device_bind_user`, `device_record_attempt`, `device_sweep`.
- Broadcast: `set_broadcast_control(p_event, ..., p_expected_rev)`, `broadcast_controller_heartbeat(...)`, `announcer_readiness(p_event)`.
- Cleanup of `anon`/PUBLIC execute on every new function is part of each gate.

**Edge Function (new, deployed only on owner approval):** `device-sign-in`. Holds the service-role key; no JWT verify (it is pre-auth); IP/global throttling; no body logging; CORS limited to the app origin.

**Public-data impact:** `event_broadcast_control` is public by design; contains no ids of accounts (`updated_by` excluded from the public view / use a view). `event_devices` and attempts are never public.

---

## 16. Security / threat model

| Threat | Mitigation |
| --- | --- |
| Code guessing / enumeration | 80-bit codes, IP + global throttles, uniform responses, minimum response time, lockout blocks only new sign-ins |
| Code leaked (photo of a screen, chat) | one code per device; revoke one device; "signed in elsewhere" flag; replace; short life (event end + 24 h); optional earlier expiry |
| Shoulder-surf at create | shown once; Replace is the recovery path |
| Device lost/stolen | individual revoke; authority gone immediately (DB check each call) |
| Copied session / clone | last sign-in wins; organizer sees it |
| XSS steals device token | blast radius is one event + one role; no org/platform power; expiry + revoke |
| Device calls generic signed-in RPCs (register, claim, team, profile) | `device_policy` classification gate; denied RPCs refuse devices; no onboarding for device principals |
| Cross-event use | every device check is `event_id = p_event`; counter join checks event; tested A→B |
| Self-promotion | role lives in a table no client can write; JWT carries no role; devices never match `organizer`; staff/device RPCs deny devices |
| Temporary organizer persistence | cannot grant staff roles, cannot create devices, cannot read emails/audit/health; expiry as above |
| Expired token still refreshes | authority is table-checked (expired = nothing); sweep kills sessions |
| Hosted-only misconfiguration | first-task verification list (§11); fall back to anonymous-sign-in option 3 if option 4 is not viable |
| Plaintext in logs | no body logging, fragment QR, audit never has code, leak-scan gate |
| Audit anonymity | `private.audit` enrichment; actor = device principal; label/role in details |
| OBS password theft | local-only storage, never displayed, never in URLs/Supabase/heartbeat |
| OBS WebSocket reachable on LAN | auth on + strong password + firewall inbound block + netstat check in runbook; controller connects loopback only |
| Server tries to drive OBS | closed vocabulary, no names/paths/URLs from server, local allow-list, stream never started/stopped, stream key request blocked |
| Malicious/buggy controller input | heartbeat is write-only status; controller device cannot call any other RPC |
| Supply chain (controller) | minimal deps (`ws`), lockfile, pinned Node |
| Copyright | §10 |
| Announcer information leak | read-only; only public data + one boolean RPC; gate checks columns |
| DoS on sign-in | existing sessions unaffected; paper/other fallbacks unchanged |

---

## 17. Audit design

- Actor = the device principal's `auth.users` uuid (stable per device). `private.audit` is patched once: if the caller is a device, `details` gains `{"device": {"id": ..., "label": ..., "role": ...}}`. `audit_log` read stays organizer/owner, so existing screens show who did what; Command Centre/People can resolve a uuid to "Counter Phone 3".
- New actions: `device.created`, `device.signed_in`, `device.signed_out`, `device.revoked`, `device.replaced`, `device.revoked_all`, `device.refused` (expired/revoked use, **no code**), `broadcast.control`, `broadcast.camera_off`, `broadcast.controller_status_changed`.
- Existing actions made by a device (scoring, check-in, etc.) already go through `private.audit`; so they gain device attribution with no per-RPC edits.
- The code is never in `subject`, `details`, logs, errors or notifications. A gate scans for it.
- `match_live_scores.device` (existing free-text label) is not changed.

---

## 18. Test plan

### 18.1 Database gates (new `pack181_devices_gate.sql`, `pack181_broadcast_gate.sql`)
Allowed and denied for **each of** anon, stranger, each device role, each existing staff role, permanent organizer, other-event organizer, owner. Specific: valid redeem; wrong/expired/revoked indistinguishable; throttle; one revoke leaves others; replace invalidates old code; sign-out-all; `valid_at` at end+23:59:59 → true, end+24:00:00 → false, DST-week event, tz Edmonton vs UTC; ends_on changed moves expiry; cross-event refused for every helper; devices never satisfy `is_organizer`/`can_read_health`; temp organizer denied the whole "never" list and allowed the "operator" list; `device_policy` classification complete (every `authenticated` function classified; every `denied_device` refuses); audit has device attribution; **leak scan**: generated code absent from audit_log, tables, error messages; hash only. Fingerprint regenerated. Existing gates (all Pack 01-16) must remain green: proves email/password and email-code identities are unaffected.

### 18.2 Unit tests
`decideProgram` vectors (every §5 rule, tie-breaks, anti-thrash, restart-reconcile, Return-to-Auto, no-switch-on-score-change); OBS client allow-list (every denied request rejected, batches checked); code normaliser/format; device landing-route table; expiry label formatting; announcer view-model (no private fields); ducking-config helper.

### 18.3 Real-stack browser scenario `pack181-live` (REAL_AUTH mode)
Eight **simultaneous** browser contexts: Counter 1-4, Secretary, Temporary Organizer, Marshal, Announcer, plus the organizer creating them, plus optionally the controller and the stand-in OBS. Verify each independently: valid code sign-in lands on its page; invalid code; guess/rate limit; individual revoke (only that device is signed out within one refresh); replace; sign-out-all; PWA restart persistence (reload + new context with stored session); expiry using event dates set relative to now plus a direct `valid_at` boundary check; Event A code refused for Event B; role cannot change itself (direct RPC probes with the device JWT); Counter restrictions (private tallies, own event join only); Secretary restrictions; Marshal restrictions; Announcer restrictions (every denied RPC returns 4xx; zero write controls in the DOM); Temporary Organizer boundaries; audit rows attributed to device label; no plaintext code in DB/audit/console/network logs/localStorage; normal email+password and email-code sign-in still work; 390x844 phone for counter/marshal/secretary, tablet for announcer/organizer; no blank screen with realtime stand-in connected.
Announcer scenario: two simultaneous live Lysts, focus selection changes nothing server-side (diff of queue/timer/score/broadcast tables before and after), private data absent from every response.

### 18.4 OBS tiers (must be labelled in every report)
1. **Stand-in verified.** `scripts/obs-standin/`: a Node WebSocket server speaking obs-websocket v5 (Hello/Identify with the real challenge/salt SHA-256 auth, RequestResponse shapes, `GetSceneList`, `Get/SetCurrentProgramScene` + `CurrentProgramSceneChanged`, input mute/volume, filter list/enable/settings, media actions, `ExitStarted`), with fault injection (drop, restart, missing scene, slow, wrong password) and a **request log asserted against the allow-list** (the log must never contain a denied request). Response shapes checked against `protocol.md`.
2. **Real OBS, headless (stretch).** Try `obs` under Xvfb on Linux with the real built-in websocket: validates real protocol/auth/scene-switch behaviour only; no cameras, no real audio DSP.
3. **Physical OBS verified** (§19): the only tier that proves ducking, cameras, routing, Windows/macOS packaging, and the laptop firewall.

### 18.5 OBS scenario checklist (stand-in, against the real local stack driving Pack 13 through its RPCs)
Connect; no fight live; fight ready; fight live → correct camera; score change and timer change cause **zero** `SetCurrentProgramScene` calls; pause, resume; equipment; DQ; completion; winner; between fights; next fight same Lyst; next fight different Lyst; two simultaneous live Lysts (stays on first, other shown as "also live"); manual Take; Holding; Break; Camera Off (latches, survives controller restart); Return to Auto reconciles to current truth without replay; OBS disconnect, reconnect, restart; controller restart; internet loss (block Supabase) then recovery; BuhurtOS stale then reconnect; missing scene; missing camera mapping; **Pack 13 scoring/timer/queue/finalize/check-in/readiness all keep working with the controller and OBS entirely absent** (run the existing `pack13-live` unchanged with no controller).

### 18.6 Audio checks
Stand-in: music-mute/volume/filter-enable commands issued in the right order for each presentation state; fade steps; Auto Duck off warning; missing mic → music muted; missing music source reported; reconnect and controller restart restore policy; Camera Off and medical hold never unmute. **Physical only:** ducking depth/attack/release, pumping, speech-gap behaviour, PA vs stream routing.

### 18.7 Regression
Typecheck, vitest, build, full `run_all.sh`, plus the existing live suites (pack13, 14, 15, 16, eventday, broadcast-realtime, finalize) after the pack, because `has_event_role` and `private.audit` are central.

---

## 19. Physical OBS verification plan and event-laptop runbook

Runbook (to be written as `docs/runbooks/PACK181_EVENT_LAPTOP.md` in plain language; no source editing, no terminal beyond double-clicking):
1. Install OBS (current stable); open once; **Tools → WebSocket Server Settings**: enable, set a long password, note the port. Windows: add an inbound firewall rule that blocks 4455 from other machines; verify (`netstat` line and a phone on the venue Wi-Fi failing to connect).
2. Build scenes: per Lyst "Lyst N Live" = camera + Pack 14 browser source (`/broadcast/<event>/<field>`, 1920x1080, shutdown-when-hidden OFF); "Holding" (`layout=queue`/sponsors); "Break"; **"Camera Off"** (static image only). Cameras: name them; test each.
3. Audio: add "Announcer Mic" (wireless receiver) and "Music"; add the mic Noise Gate; add the Compressor on Music keyed to the mic; set starting values from §9; pick the music source option; set monitoring per the venue/stream topology diagram.
4. Start the Companion; paste the OBS password (kept on this laptop only); paste the optional device code for status/commands; the mapping wizard lights each Lyst green; "Test" each scene; "Camera Off" test and clear.
5. AUTO: run a rehearsal fight on the tablet; confirm camera follows; confirm two-Lyst behaviour; use Take, Holding, Camera Off, Return to Auto.
6. Failure drills (each timed, each must end with the stream correct): quit OBS mid-fight and reopen; close and reopen the Companion; unplug the network 60 s then reconnect; unplug the camera; wrong password.
7. Music drills: mic quiet → music normal; speak → duck; pause 1-2 s mid-sentence (no pumping); stop → returns; mute; Auto Duck off; mic unplugged; Camera Off keeps music muted.
8. Going live stays manual: the Companion never presses Start Streaming.
Physical checklist is a tick list in that runbook and is **not** claimed performed by this pack.

---

## 20. Files and components likely to change AFTER Pack 18 lands

Re-verify each against the merged Pack 18; touching Pack 18 files is expected here only after merge.

**Database (new):** the three migrations in §15, `supabase/tests/pack181_*_gate.sql`, `run_all.sh`, `schema.fingerprint.txt`, optional `scripts/e2e/fixtures/pack181.sql`.
**Database (patches, DO-block replace):** `private.has_event_role`, `private.audit`, `can_command` (Pack 18), `request_counter_seat`, `event_staff_role_check`, registration-admin and queue-plan RPCs on the operator allow-list (exact list to be generated by a script that lists every `is_organizer`-gated RPC, then classified by hand).
**Edge Function (new):** `supabase/functions/device-sign-in/`.
**Frontend (new):** `src/pages/DeviceSignInPage.tsx`, `src/lib/deviceSession.ts` (landing routes, whoami), `src/components/DeviceBar.tsx`, `src/pages/AnnouncerPage.tsx` + `src/lib/announcer.ts` (view model, tested), `src/data/devices.ts`, `src/data/broadcastControl.ts`, a **Devices** panel in the Command Centre (`CommandCentrePage.tsx`; create, show-code-once, revoke, replace, sign-out-all, signed-in-elsewhere flag) and a **Broadcast control** panel (mode, Take buttons, Camera Off, music, "also live", controller status/last seen).
**Frontend (modified, Pack 18/Pack 14-16 files):** `App.tsx` (routes `/device`, `/events/:id/announcer`, `/` redirect for devices), `AuthContext.tsx`/`ProfileGate` (skip onboarding for device principals, hide Account), `Layout.tsx` (device bar), `data/api.ts fetchMyEventContext` (device role for display), `PeopleTab.tsx` (new `secretary`/`announcer` descriptions), `CheckinDeskPage.tsx`/Manage entries (secretary access), `FieldPage.tsx` (marshal/temp organizer already via can_score), `CounterPage.tsx` (device landing), `BroadcastPage.tsx` optionally a "technical break" card from the control row.
**Shared pure modules:** `src/lib/broadcast/decide.ts` (new, `decideProgram`), reusing `state.ts`, `arena.ts`, `eventDay.ts`, `lyst/timer.ts` (confirm no browser imports transitively).
**Controller (new):** `tools/obs-controller/` (client wrapper + allow-list, reconcile loop, local UI, config/credential store, heartbeat, packaging scripts), `scripts/obs-standin/`, `scripts/e2e/pack181-live.{sh,mjs}`.
**Docs:** `docs/runbooks/PACK181_EVENT_LAPTOP.md`, `docs/runbooks/PACK181_DEVICES.md` (day-of devices crib sheet), `docs/claude-packs/PACK_18_1_*.md` status, `STATUS.md` section, update `PACK14_OBS_SETUP.md` pointer, `PROJECT_SPEC.md` (devices and roles decisions).

**Recommended build order (each independently shippable):** (1) hosted-settings/Edge-Function viability check; (2) devices + roles + audit (C) with gates; (3) Announcer (D); (4) control row + `decideProgram` + stand-in + controller (A); (5) audio policy (B); (6) runbook and physical drills. C and D are the Rumble-critical path because they need no OBS; A and B add risk only on the streaming laptop and cannot affect scoring.

---

## 21. Open questions and blockers

Blockers to confirm in the first session after Pack 18 merges:
- **B1** Pack 18 merged and reconciled (§0).
- **B2** Hosted Supabase: can an Edge Function create a user, mint a magic-link token and have the client exchange it with `verifyOtp(token_hash)`? Can a definer function delete from `auth.sessions`? JWT expiry setting? (Owner dashboard access; any deployment needs the owner's explicit go-ahead.)
- **B3** OBS WebSocket bind address: confirm on the real install whether it is loopback-only (research says all interfaces).

Owner decisions needed (recommendation first):
- **Q1** Controller packaging as a local process (recommended) vs browser page. Decide whether a Windows laptop is certain (affects Application Audio Capture and packaging).
- **Q2** Secretary and queue ordering/plans: yes (recommended) or check-in/registrations only?
- **Q3** Camera Off for marshal / head marshal devices (recommended **yes, Camera Off only**: it is safe-direction and medical-incident relevant) vs the brief's "no OBS by default for marshal". Default in the build: **off** until you say yes.
- **Q4** Temporary organizer may `correct_result` / `void_result` / `withdraw_entry`? Recommended no (permanent organizer only); `enter_official_result` and conflict resolution yes via head-marshal powers.
- **Q5** Temporary organizer and secretary sending fighter announcements: temp organizer yes (existing limits), secretary no. OK?
- **Q6** Archived/closed events: do devices keep read-only access to expiry? (Recommended: closing the event does not end devices; they still end at event end + 24 h; archive/delete does.)
- **Q7** Should a temporary organizer be allowed to revoke (not create) devices? (Recommended no.)
- **Q8** Announcer sees "Ready / Not yet ready" per fighter (recommended yes, no reasons) or nothing?
- **Q9** Music: confirm stream-safe/licensed files as the supported default; confirm the venue's SOCAN/Re:Sound position before any commercial playlist is used live. Music during live fights: off (recommended) or low?
- **Q10** The optional "broadcast_controller" device role (ninth device): accept?
- **Q11** Code format: 16 characters (recommended, QR-assisted) or shorter (12, 60 bits) for easier typing?

Known limits stated up front: ducking quality, gate/hold behaviour, PA routing and Windows/macOS packaging can only be proven on the physical laptop; Spotify/YouTube pasted-link playback is not supported by design; the hosted-settings checks in B2 may force the anonymous-sign-in fallback.
