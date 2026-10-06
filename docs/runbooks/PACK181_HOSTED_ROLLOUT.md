# Pack 18.1 hosted rollout (NOT performed by the build; the owner does this, in this order, after review)

Nothing here has been run against hosted Supabase. Everything in the pack was verified locally; the items in "Only provable on hosted" below are the open risks.
Do not apply migrations, deploy the function or change Auth settings until each step below is understood. The migrations are additive and Pack 18's
`20261012000100_pack18_command_centre` must already be applied (it is: version `20261006015820`).

## 1. What ships
| Piece | What it is |
| --- | --- |
| `20261013000100_pack181_event_sessions.sql` | `event_credentials`, `event_sessions`, `device_code_attempts`; roles `bos_event_device` and `bos_controller`; `has_event_role` device branch; device-aware `private.audit`; the counter-seat changes (FK removed, own-event rule, dead-session guard); credential RPCs; the session RPCs the Edge Function calls |
| `20261013000200_pack181_roles_camera.sql` | `announcer` staff role; Scorekeeper (Secretary) event-day powers; Temporary Organizer via `is_event_operator`; Camera Off tables and RPCs; `announcer_readiness` |
| `20261013000300_pack181_broadcast_control.sql` | broadcast control + controller status tables; `set_broadcast_control`, `broadcast_control_state`, `controller_state`, `broadcast_controller_heartbeat`; the EXECUTE allow-list for the two session roles |
| `supabase/functions/device-session` | the door: sign in with a code, refresh, sign out, mint codes for organizers |
| App | `/device`, the device shell, the Announcer view, Command Centre Event Devices + Broadcast panels, Camera Off control |
| Local controller | `tools/obs-controller` (runs on the stream laptop; nothing is deployed to Supabase for it) |

## 2. Before anything: decide how the session token is signed (owner decision)
The device token is a normal JWT whose `role` is a CUSTOM database role. Supabase only accepts tokens signed with a key it trusts, so the function needs a key
Supabase trusts. Two ways; **A is recommended**.
- **A. Import your own ES256 signing key (recommended).** Locally: `supabase gen signing-key --algorithm ES256` (writes a private JWK incl. `kid`). Keep that file in a password manager,
  never in the repository. Dashboard → Project Settings → JWT Keys → import it (it starts as *standby*). From the Supabase docs, a standby key is **not** accepted for verification until
  you **Rotate keys**; rotating makes Supabase Auth sign NEW user tokens with the imported key too (ES256) and keeps the old (legacy) key trusted as "Previously used", so existing sessions keep working
  (wait at least one access-token lifetime + 15 min before ever revoking the legacy key; do not revoke it for this pack). Rotation is reversible (move keys back), changes are throttled ~5 minutes.
  This is a **project-wide Auth change**: do it at least a day before the event, then re-verify normal sign-in (password, email code, Google) and the existing apps before relying on it.
- **B. Sign with the legacy JWT secret (not recommended).** Needs that master secret inside the function (it also signs the anon/service-role keys). Only if A is impossible.
Either way the private key / secret exists ONLY as an Edge Function secret (below) and in your password manager.

## 3. Hosted settings and secrets to prepare
1. **Function secrets** (Dashboard → Edge Functions → device-session → Secrets, or `supabase secrets set`):
   - `DEVICE_JWT_PRIVATE_JWK` = the ES256 private JWK (JSON, with `kid`)
   - `DEVICE_CODE_PEPPER` = 32+ random characters (generate with a password manager; **if this is lost or changed every outstanding device code stops working**: re-create codes)
   - `DEVICE_ALLOWED_ORIGINS` = the app origin(s), e.g. `https://dothecoolwip1.github.io` (comma-separated). Nothing else may call the function from a browser.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are provided by the platform.
2. **Deploy** with JWT verification OFF (a device has no JWT before it signs in; create/replace forward the organizer's JWT to the database, which checks it):
   `supabase functions deploy device-session --no-verify-jwt`.
3. **Auth settings:** no change is needed for devices (they are not Auth users). Pack 18's settings still apply.
4. **App build:** `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are unchanged. The device pages call `${VITE_SUPABASE_URL}/functions/v1/device-session`.

## 4. Release order (after the PR is reviewed and CI is green)
1. `apply_migration` for `20261013000100`, `…200`, `…300` in that order (the repository's established process; if it is cancelled or fails, stop and report: no `execute_sql` workaround).
   The first migration creates the roles and runs `GRANT anon TO bos_event_device` and, if the `authenticator` role exists, `GRANT bos_event_device, bos_controller TO authenticator`. **If the migration role is not allowed to
   grant `anon` or to grant to `authenticator`, the migration fails at that statement: stop, and ask Supabase support / use a Supabase branch to find the permitted way. Do not weaken the design (e.g. by adding the roles to `authenticated`).**
2. Verify the database (read-only; section 5).
3. Deploy the function and set its secrets (section 3); import and rotate the signing key (section 2A) if not already done.
4. Merge → Pages deploy → production checks (section 6).
5. Create the event's codes only after step 4 (Command Centre → Event devices).

## 5. Database verification after the migrations (read-only; compare with `supabase/tests/device_allowlist.txt`)
```sql
-- the roles exist, cannot log in, and are NOT members of authenticated
select rolname, rolcanlogin from pg_roles where rolname in ('bos_event_device','bos_controller');
select pg_has_role('bos_event_device','authenticated','member') or pg_has_role('bos_controller','authenticated','member') as must_be_false;
-- exactly the reviewed allow-list is executable by a device beyond anon (must equal the '## bos_event_device' block of device_allowlist.txt)
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind in ('f','p') and has_function_privilege('bos_event_device', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') order by 1;
-- the controller: exactly broadcast_controller_heartbeat(p_status jsonb) and controller_state()
-- anon: exactly the '## anon' block (14 functions at the time of writing); anything extra means a REVOKE FROM PUBLIC was missed
-- no table privilege beyond anon for either role
select c.relname, pr from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['select','insert','update','delete']) pr
where n.nspname in ('public','private') and c.relkind in ('r','v','m','p')
  and ((has_table_privilege('bos_event_device', c.oid, pr) or has_table_privilege('bos_controller', c.oid, pr)) and not has_table_privilege('anon', c.oid, pr));   -- must return no rows
-- RLS is on and no client grants on the new tables
select relname, relrowsecurity from pg_class where relname in ('event_credentials','event_sessions','device_code_attempts','event_camera_state','event_camera_log','event_broadcast_control','broadcast_controller_status');
```
Run the Supabase security advisors before and after and compare: the new tables have RLS and no policies (intended: only the definer functions touch them).

## 6. Only provable on hosted (open risks; each needs a human test with a real token)
1. **A token with a custom `role` claim is accepted by the Data API and by Realtime.** Test with a throwaway credential on a draft event: sign in through `/device`, load the Announcer / field screen, watch that data loads (Data API) and (if enabled) live updates arrive (Realtime). If the gateway rejects the role, the transport must change (see the plan's contingency); do not ship devices.
2. **`supabase-js` `accessToken` mode** works with Realtime on the hosted project (locally Realtime is a polling fallback).
3. **Edge Function CORS** for the app origin, and that the function never logs bodies (check the function logs after a sign-in: no code, secret or token).
4. **Time and refresh:** a device stays signed in across a phone sleep and a PWA restart, and loses authority exactly at the event's final day + 24 h in the event's time zone (set a short test event and `expires_at`).
5. **iOS home-screen app** storage is separate from Safari: enter the code once inside the installed app (documented in the device crib sheet).
6. The PostgREST role switch for custom roles and `GRANT bos_event_device TO authenticator` on hosted.
7. Real OBS, cameras, microphone, audio routing and the laptop firewall are physical checks: `PACK181_EVENT_LAPTOP.md`.

## 7. Kill switch and rollback
- Stop all temporary device and controller access immediately: organizer → Command Centre → **Sign out all temporary devices** (and revoke the controller), or SQL as the project owner:
  `update public.event_credentials set revoked_at = now(), revoked_reason = 'kill switch' where revoked_at is null;` (sessions then have no authority on their next call).
- Undeploy the function (`supabase functions delete device-session`): nobody can sign in or mint codes; existing tokens still die within 10 minutes and have no authority once the credentials are revoked.
- The migrations are additive and are not rolled back; the tournament does not depend on any of the new tables. A new Auth signing key can be rotated back (section 2A).
- Reverting the Scorekeeper widening requires a new additive migration (restore `can_command` to head marshal + organizer and the old checks); say so before release, because permanent Scorekeepers gain queue adjustment, announcements and a read-only Command Centre.

## 8. Not changed by this pack
Supabase Free-plan limits, leaked-password protection (not available on this plan; a known plan limitation), the Auth settings listed in `PACK18_HOSTED_ROLLOUT.md`, any production data.
