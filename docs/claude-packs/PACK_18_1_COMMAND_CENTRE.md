# Pack 18.1: Command Centre panels (Event devices, Broadcast, Staff, Camera Off)

> **Superseded by Pack 25 (2026-10-07):** the Command Centre is **Event Control › Live ops**; the Event devices panel lives under the **Counters and devices** tool (and folded in Live ops). Counter phones use the one Counter QR. See `PACK_25_EVENT_CONTROL_AND_COUNTERS.md`.

Extends the Pack 18 Command Centre (`/events/<slug>/command`) in place. Read with `PACK_18_1_CONTRACTS.md` (the RPC and Edge Function contracts) and `PACK_18_COMMAND_CENTRE.md` (section 6: live updates must not reset the view).
The database decides everything; the page only reflects `event_command_snapshot().viewer` = `{organizer, announce, operator, camera_off, camera_release, broadcast}`.

## Who sees what
| Viewer | Camera Off | Broadcast | Announcements | Staff | Event devices |
| --- | --- | --- | --- | --- | --- |
| Organizer / owner | activate + release | status + controls | send + history | names, add, remove (incl. Organizer) | yes |
| Temporary Organizer (device) | activate + release | status + controls | send + history | names, add, remove (not Organizer) | no (database refuses) |
| Secretary / Scorekeeper | activate | status only | **send only** (history is refused: no error shown) | assigned list | no |
| Head marshal | activate + release | status only | no | assigned list | no |

The page works for a device session: it reads only public data and allow-listed RPCs (`event_command_snapshot`, `list_result_conflicts`, `fighter_schedule_conflicts`, `camera_state`, `broadcast_control_state`, `list_event_staff_names`, ...). It no longer assumes a person: "signed in" is an account session OR a device session in this browser (`hasDeviceSession()`, key `bos-device-session`, contract section 5).

## Event devices (`src/components/command/DevicesPanel.tsx`, `DeviceCodeSheet.tsx`, `src/data/devices.ts`, `src/lib/devices.ts`)
- List via `list_event_credentials`: Active / Revoked / Expired, role in UI words, last seen, "Signed in on another device at hh:mm", "Access ends <day hh:mm zone>" (event time zone). Revoked and expired sit under a closed "Revoked and expired" list.
- Create / replace go through the Edge Function (`supabase.functions.invoke('device-session', ...)`: the organizer's own access token and the publishable key are attached by the client). Revoke one = `revoke_event_credential`; sign out all = `revoke_all_event_devices` (the stream laptop is untouched). All three ask first.
- **A code is shown once**, in a sheet: grouped `XXXX-XXXX-XXXX`, a QR of `<origin><BASE_URL>device#c=XXXXXXXXXXXX` (the code in the URL FRAGMENT only; `qrcode-generator`, same as the check-in code), Copy, Print, and a plain warning. Closing the sheet drops it: it is never put in storage, the list, a log or a URL (verified, see below).
- "Add the usual set for an event": Counter Phone 1-4, Secretary Tablet (scorekeeper), Marshal Phone, Announcer Tablet, Event Admin Tablet (temporary_organizer); all codes in ONE sheet, one card each (label, role, code, QR). Print uses `window.print()` with `body.printing-codes` print CSS (only the sheet, black on white, a card never split). Names already in use are skipped, never duplicated; a partial failure still shows the codes that were made.
- Stream laptop: label "Stream laptop", kind `controller`, role `broadcast_controller`; create / replace / revoke; one at a time (the database refuses a second).

## Broadcast (`BroadcastPanel.tsx`, `src/data/broadcastControl.ts`, `src/lib/broadcastView.ts`)
- Status from `broadcast_control_state`: the controller heartbeat (OBS, On air, Fight, Camera, Overlay, Music, Mic, "Also live", setup problems) plus the database's own Mode, Auto Duck and Camera Safety (ON AIR / CAMERAS OFF). No controller: "Stream controller not connected", the database lines still show. Silent 30 s or more: "Silent for N s", old values dimmed, "Also live" dropped. The heartbeat is read loosely (it is written by another program): odd or partial reports never break the panel. The Overlay line is derived from what is on air (the panel does not read the overlay).
- Controls only when `can_control`: AUTO / MANUAL, Take Lyst N (one per field the event has fights on), Holding / Between fights, Break, Return to Auto, Music Mute / Unmute / Pause, Auto Duck On / Off, each `set_broadcast_control(p_event, p_expected_rev, p_patch)` with the revision of the last read. `stale` is answered "Someone else just changed this; check and try again." and the panel shows the current state. MANUAL on its own keeps what the controller shows on air. **No Camera Off here**: that is `CameraOffControl`, at the top of the page, for everyone who can read the state.
- Refreshed every 5 s and after each snapshot, in place (`useAsync` with `refreshDeps`).

## Staff (`StaffNamesPanel.tsx`)
`list_event_staff_names` (names, no emails), `grant_event_role_by_email` (roles: Head marshal, Marshal, Secretary / Scorekeeper, Announcer, Medic, Check-in desk, Armour inspector; Organizer only for a permanent organizer), `remove_event_role`.

## Live-update stability
No panel remounts: data comes from `useAsync(load, deps, refreshDeps)`; a section the person opened or closed stays that way; an unsent announcement draft, scroll position and the page root survive heartbeat changes, revokes from another session and focus / reconnect refreshes (checked below).

## Files
`src/pages/CommandCentrePage.tsx`, `src/components/command/{CommandSection,DevicesPanel,DeviceCodeSheet,BroadcastPanel,StaffNamesPanel}.tsx`, `src/components/command/hooks.ts`, `src/data/{devices,broadcastControl}.ts` (+ the viewer flags in `src/data/command.ts`, `src/lib/commandCentre.ts`), `src/lib/{devices,broadcastView}.ts` (+ tests), `src/styles/command181.css`, `src/components/AnnouncementPanel.tsx` (history refusal tolerated), `scripts/e2e/cc181-live.{sh,mjs}`, `scripts/e2e/fixtures/cc181.sql`.

## Verification
- Unit: `src/lib/devices.test.ts`, `src/lib/broadcastView.test.ts`.
- Browser: `scripts/e2e/cc181-live.sh` (real Postgres + PostgREST + the real device-session handler + the built app in Chromium, 390x844 and 1280x900): 148 checks including the code appearing exactly once and being found nowhere afterwards (DOM, storage, IndexedDB, console, request URLs, audit log, credential / session rows, a data-only dump of the whole scratch database), the QR matching the fragment link, replace / revoke-one / sign-out-all effects on real sign-in and refresh calls, the control row after each press, a stale revision, silent and missing controller, Camera Off from another session, a Temporary Organizer device token refused device management and driving the real page, the scorekeeper's send-only announcements, and live updates keeping scroll, sections and a draft.
- Not verified: hosted Supabase (custom JWT roles, Edge Function CORS), a real printer / paper layout (print CSS checked with print media emulation and a PDF render), the QR scanned by a real phone camera (the QR modules are compared with the library's output for the exact link), a real OBS controller (a heartbeat is simulated in SQL).
