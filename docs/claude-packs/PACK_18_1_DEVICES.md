# Pack 18.1: temporary event devices, client side

> **Changed by Pack 25 (2026-10-07):** a new credential kind `counter_pool` (the event's one Counter QR, many sessions per credential, `event_sessions.multi`) replaces per-phone Counter codes in the normal path; staff device codes are unchanged. Sessions are listed and managed (move, end, preview) from Event Control and Platform › Devices. See `PACK_25_EVENT_CONTROL_AND_COUNTERS.md`.

What a phone or tablet does when an organizer gives it a code. The database and the Edge Function are in `PACK_18_1_CONTRACTS.md`; this file is the browser half.

## What a device sees
1. `/device`: one field for the 12-character code (or a QR that opens `/device#c=XXXXXXXXXXXX`). Chrome-less page, `<meta name="referrer" content="no-referrer">`.
2. It signs in once and lands on its role's screen (full page load; the app is built once per mode):
   | role (words on screen) | lands on |
   | --- | --- |
   | Counter | `/lyst/counter` |
   | Secretary / Scorekeeper | `/events/<slug>/command` (read only) |
   | Marshal | `/events/<slug>` (the field picker, `DeviceHome`) |
   | Announcer | `/events/<slug>/announcer` |
   | Event Admin / Temporary Organizer | `/events/<slug>/command` |
3. A bar on every screen: event name, "Temporary Device", the device label, "Role: ...", "Access ends Mon 00:00 MDT" (event time zone), CAMERA OFF (roles that may press it; the control itself decides what to show) and "Sign out this device" (asks first). No account, profile, onboarding, team or platform link; no bug button; no analytics; no push.
4. It stays signed in: reload, sleep/wake, the installed app (`./?source=pwa` redirects to the landing page). It ends only on sign-out, revocation, replacement (the same code signed in elsewhere) or expiry. Then `/device` says "This device's access has ended."

## How it works
| file | job |
| --- | --- |
| `src/lib/deviceCode.ts` | normalise (Crockford, O->0, I/L->1), format `XXXX-XXXX-XXXX`, parse `#c=` |
| `src/lib/deviceSession.ts` | `localStorage['bos-device-session']` = `{secret, access_token, expires_at, whoami}`; sign in / refresh (60 s before expiry, on focus, on `online`, single-flight) / sign out; a 401 on refresh or 42501 from `device_whoami` ends the session; QR fragment removed with `history.replaceState` at start-up before any request |
| `src/lib/deviceClient.ts` | supabase-js client with the `accessToken` option; `.auth` replaced by a shim (`getSession`/`getUser` answer with a minimal Session whose `user.id` is the DEVICE SESSION id and no email; `onAuthStateChange` quiet; `signOut` signs the device out; everything else returns a plain "not available" error) |
| `src/lib/supabase.ts` | picks the device client when a device session is stored; the normal client is untouched |
| `src/lib/deviceRoutes.ts` | role words, landing table, which paths a role is offered, the "Access ends" label |
| `src/auth/AuthContext.tsx`, `ProfileGate.tsx`, `src/lib/analytics.ts` | device-aware; normal accounts unchanged |
| `src/DeviceApp.tsx`, `DeviceBar.tsx`, `DeviceHome.tsx`, `DeviceSignInPage.tsx`, `styles/device.css` | the device route tree and screens; `device_whoami()` at launch, on focus and every 30 s |
| `src/data/api.ts` `fetchMyEventContext` | device mode never reads `event_staff`/`platform_roles`/`registrations`; roles come from the stored whoami (Temporary Organizer also counts as `operator`, never organizer) |
| `src/pages/FieldPage.tsx` | Move earlier / Move later / Make next on waiting queue rows for organizer, owner, secretary / scorekeeper and event admin (`move_match_in_queue`); not for head marshal, marshal, announcer, counter |

The route guard only decides what to OFFER. Every action is checked by the database; the browser scenario probes it directly with each device's own token.

## Verification (local only; nothing here is hosted)
- `npx tsc -b --pretty false` clean; `npx vitest run` green (see the hand-off for counts).
- `scripts/e2e/device-live.sh` (real Postgres from every migration, PostgREST, the real Edge Function handler, the real built app in Chromium): eight devices created through the Edge Function and signed in through the real `/device` page; persistence, QR fragment hygiene, uniform wrong-code answer, route restrictions, queue reordering, the three-device counter flow, the check-in desk for the event admin, revocation / replacement / sign-out, direct permission probes, and a scan for the plaintext code (URLs, headers, console, tables, localStorage, responses).
- Regression: `pack13-live` and `pack16-live` on the same stack.

## Not verified here
Hosted Supabase (signing-key import, custom role claim, Edge Function CORS), Realtime with a device token (the local stack has no Realtime; field and Command Centre screens fall back to polling), the service worker in the loop (blocked in the browser scenario), an installed iOS home-screen app (its storage is separate from Safari: the code is entered once inside the installed app), physical phones.

## Known limits
- A browser that blocks site storage cannot keep a device signed in: the sign-in is refused with a plain message instead of half working.
- A permanent account signed in on the same browser keeps its own session; device mode takes over the whole app until the device signs out.
- In device mode `/events/<slug>` is the device home, not the public event workspace (that page reads account tables a device cannot read).
