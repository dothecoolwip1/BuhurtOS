# Pack 18.1 contracts (what is built, exactly: the parts the UI, the announcer and the OBS controller all rely on)

This is the interface the database (migrations `20261015000100/200/300`) and the Edge Function expose. The plan is `PACK_18_1_PLAN.md`; where the two differ, **this file and the migrations are the truth** (the plan is reconciled at the end).

## 1. Architecture in one paragraph
A temporary device (or the stream controller) is an **event session**, not a person. The organizer creates a *credential* (label + role, one per device). The device enters a 12-character code **once**; the Edge Function `device-session` verifies it (HMAC verifier, throttled), opens a *session* and returns a short-lived (10 min) JWT whose database role is `bos_event_device` (or `bos_controller`) and whose `sub` is the **session id** (not an `auth.users` id), plus a long-lived **session secret** the device keeps. The device refreshes the JWT with the secret. Authority is never in the token: the database looks the session up on every call (`private.device_ctx()`), so revocation and expiry (event's final `ends_on` day in its time zone + 24 h) bite immediately. The roles are not members of `authenticated`; they can execute only the functions in `supabase/tests/device_allowlist.txt`.

## 2. Edge Function `device-session` (POST JSON; `Authorization` only for create/replace)
URL: `${SUPABASE_URL}/functions/v1/device-session`. Headers: `apikey: <publishable key>`, `content-type: application/json`.

| action | body | success | failure |
| --- | --- | --- | --- |
| `signin` | `{action:'signin', code:'K7Q2-M9XD-4TRH'}` (any case, dashes/spaces optional) | `200 {access_token, expires_in, expires_at (unix s), session_secret, whoami}` | `401 {error}` (the **same** answer for wrong/expired/revoked/throttled, after >= 350 ms) |
| `refresh` | `{action:'refresh', session_secret}` | `200 {access_token, expires_in, expires_at, whoami}` | `401` (session ended: sign out locally) |
| `signout` | `{action:'signout', session_secret}` | `200 {ok:true}` | |
| `create` | `{action:'create', event:<uuid>, kind:'device'\|'controller', label, role, expires_at?}` + `Authorization: Bearer <the organizer's own user JWT>` | `200 {credential:{id,kind,label,role,expires_at}, code:'XXXX-XXXX-XXXX'}` (the plaintext exists only here, once) | `401` no JWT; `403/400 {error}` the database's refusal |
| `replace` | `{action:'replace', credential:<uuid>}` + organizer JWT | same as create | |

`whoami = {session_id, credential_id, kind:'device'|'controller', role, label, event:{id,slug,name,timezone}, expires_at (ISO)}`.
Roles: device `counter | scorekeeper | marshal | announcer | temporary_organizer`; controller `broadcast_controller`. UI names: scorekeeper = **Secretary / Scorekeeper**; temporary_organizer = **Event Admin / Temporary Organizer**.
JWT claims: `{aud:'authenticated', role:'bos_event_device'|'bos_controller', sub:<session id>, session_id, iat, exp}`; nothing else.
Local stack: `scripts/e2e/localstack.mjs` serves this route with the real handler (`supabase/functions/_shared/deviceSession.ts`), HS256, against the local PostgREST.

## 3. Database functions (public schema; `p_event` is always the event uuid)
**Organizer-only (permanent organizer, incl. org admin and owner; a Temporary Organizer is refused):**
`list_event_credentials(p_event)` → rows `{id, kind, label, role, status:'active'|'expired'|'revoked', used, expires_at, created_at, last_signin_at, last_seen_at, signed_in_elsewhere_at, revoked_at, replaced}`;
`revoke_event_credential(p_credential, p_reason?)` → `{status:'revoked'|'already_revoked'}`;
`revoke_all_event_devices(p_event)` → `{revoked:n}` (devices only; the controller is untouched).
(`create_event_credential` / `replace_event_credential` are called by the Edge Function with the organizer's JWT; clients call the function, not these.)

**A device asks about itself** (role `bos_event_device` only): `device_whoami()` → `{session_id, credential_id, kind, role, label, effective_roles:[…], event:{id,slug,name,timezone,ends_on}, expires_at, server_now}`; raises 42501 when the session has ended/expired/been revoked (the client must sign out locally).

**Camera Off** (roles that may activate: marshal, head marshal, scorekeeper, announcer, Temporary Organizer, organizer, owner; release: head marshal, Temporary Organizer, organizer, owner):
`camera_off_activate(p_event, p_reason='other')` (`reason` ∈ medical|privacy|camera_problem|venue|other) → state + `status:'off'|'already_off'`;
`camera_off_release(p_event, p_note?)` → state + `status:'on'|'already_on'`;
`camera_state(p_event)` → state + `{can_activate, can_release}`. State = `{active, reason (only while active), activated_at, activated_by_label, activated_by_role, released_at, released_by_label, released_by_role, rev}`.

**Broadcast control** (organizer / owner / Temporary Organizer only; Camera Off roles do NOT get these):
`set_broadcast_control(p_event, p_expected_rev, p_patch jsonb)` → `{status:'ok'|'stale', control}`; patch keys ∈ `mode ('auto'|'manual')`, `target_kind ('lyst'|'holding'|'break')`, `target_field (text)`, `music_mode ('auto'|'muted'|'paused')`, `auto_duck (bool)`, `priority_fields (text[])`; anything else is refused. `mode:'auto'` clears the manual target. `control = {mode, target_kind, target_field (normalised field key e.g. 'field 2'), music_mode, auto_duck, priority_fields, rev, updated_at, updated_by_label}`.
`broadcast_control_state(p_event)` (Command Centre readers: can_command or broadcast control) → `{control, camera, controller:null|{reported_at, age_seconds, status}, controller_exists, can_control, server_now}`.

**The stream controller** (role `bos_controller`; its event comes from its own session): `controller_state()` → `{event:{id,slug,name,timezone,status}, control, camera:{…state incl. reason}, server_now}`; `broadcast_controller_heartbeat(p_status jsonb ≤ 4 KB object)` → `{ok, control_rev, camera_rev}`. `p_status` suggested keys: `obs_connected, obs_version, mode, on_air:{kind,field,scene,reason}, fight, camera_off, camera_off_local, also_live:[…], mapping_problems:[…], music:{state,ducking,mic}, controller_version, stale`. It can execute nothing else.

**Announcer**: `announcer_readiness(p_event)` → rows `{match_id, side:'a'|'b', ready:boolean}` (no reasons) for fights in play/coming up. Roles: organizer, head marshal, marshal, scorekeeper, announcer (+ devices of those roles).

**Staff, below organizer** (Temporary Organizer or organizer): `grant_event_role_by_email(p_event, p_email, p_role)` (any event role **except `organizer`** for a Temporary Organizer; `announcer` is a new role), `remove_event_role(p_event, p_user, p_role)`, `list_event_staff_names(p_event)` → `{user_id, name, role}` (names only; `list_event_staff` with emails stays organizer-only).

**Scorekeeper (Secretary) additions** (database): may reorder/plan/clear the queue (`move_match_in_queue`, `save_queue_plan`, `clear_manual_queue`), send announcements (`send_event_announcement`; history stays organizer/operator), read the Command Centre (`event_command_snapshot`), activate Camera Off. `event_command_snapshot().viewer` now also has `announce, operator, camera_off, camera_release, broadcast` (booleans) next to `organizer`.

## 4. What a device can reach (client rules)
- A device client uses the same supabase-js API; **only** the functions in `supabase/tests/device_allowlist.txt` and public reads work. Table reads that need a person (`event_staff`, `registrations`, `platform_roles`, `profiles`, `audit_log`, …) are refused: **device-mode code must never call them** (e.g. `fetchMyEventContext` must use `device_whoami` instead).
- `track_activity`, `track_event`, `report_bug` write the caller's id into columns tied to `auth.users`: **device mode must not call analytics or bug reports**.
- Effective roles used for display only (the database decides): counter → none; scorekeeper → `['scorekeeper']`; marshal → `['marshal']`; announcer → `['announcer']`; temporary_organizer → `['head_marshal','marshal','scorekeeper']` plus operator powers.

## 5. Client storage and session
`localStorage['bos-device-session'] = JSON {secret, access_token, expires_at, whoami}`. Device mode is on when that key holds a valid object. Sign-in / sign-out switch modes with a full page load (`location.replace`). The JWT is refreshed ~60 s before `expires_at`, on `visibilitychange`, and on `online`. A refresh answered `401` ends the session locally (and says so). The code and secret never go in a URL, log or analytics call; the QR carries the code in the URL **fragment** only (`/device#c=XXXXXXXXXXXX`), removed with `history.replaceState` before anything else runs.

## 6. Routes (device mode)
| role | lands on | may open |
| --- | --- | --- |
| counter | `/lyst/counter` | `/lyst/join(/:code)`, `/lyst/counter` |
| scorekeeper (Secretary / Scorekeeper) | `/events/<slug>/command` | field screens `/events/<slug>/field/<field>`, command centre (read only), camera off |
| marshal | `/events/<slug>/field/Field 1`-style picker (`DeviceHome`) | field screens, camera off |
| announcer | `/events/<slug>/announcer` | announcer view only, camera off |
| temporary_organizer | `/events/<slug>/command` | command centre (all panels), field screens, check-in desk `/events/<slug>/checkin`, result review via the field screen, announcements, broadcast control, camera off + release |
Public pages (`/events/<slug>`, arena, rules) stay readable by everyone. Account, profile, onboarding, team and registration pages are not offered in device mode.

## 7. Audit attribution
Every `private.audit` row written by a device includes `details.device = {credential_id, session_id, label, role, kind}`; `actor` = the session id. Camera Off also writes `event_camera_log` (append-only).
