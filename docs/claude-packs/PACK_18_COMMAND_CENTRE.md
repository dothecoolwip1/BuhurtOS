# Pack 18: email + password sign-in and the Organizer Command Centre (2026-10-06)

Branch `pack18-command-centre` from `main` at `90ff429` (Packs 13–16 merged and deployed; the PR #35 realtime-channel / ErrorBoundary fix is on main).
Read with `STATUS.md` (Pack 18 section).

## 0. Owner decision this pack supersedes
`docs/PROJECT_SPEC.md` says "Sign-in: 6-digit email code plus Google. No passwords." The Pack 18 instruction (owner, 2026-10-06) asks for a normal
email + password option for everyone. Per `CLAUDE.md` ("current owner decisions override older assumptions") passwords are now a first-class option.
Email codes and Google stay exactly as they are; nothing is removed.

## 1. Investigation: what already exists

### Authentication
| Piece | What is there | Where |
| --- | --- | --- |
| Auth backend | Supabase Auth only (supabase-js 2.117, PKCE flow, `detectSessionInUrl`, persisted session). No BuhurtOS table stores credentials | `src/lib/supabase.ts` |
| Sign-in UI | `SignIn` component: Google, then "email me a code" (OTP, `shouldCreateUser: true`). Rendered inline by 14 pages at the page the person asked for, so the destination is already kept for codes | `src/auth/SignIn.tsx` |
| Passwords | `signInWithPassword` exists in `AuthContext`, used only by the unlinked `/test-login` page (test accounts `@buhurtos.ca`, created by `supabase/seed/test_logins.sql` with bcrypt passwords in `auth.users`) | `src/auth/AuthContext.tsx`, `TestLoginPage.tsx` |
| Sign-up | None separate: the first email code creates the account. A profile row is created by the existing `auth.users` trigger; `/welcome` is the first-sign-in profile step (`ProfileGate`, `wantOnboarding`) | `ProfileGate.tsx`, `WelcomePage` |
| Fighter claims | Separate relationship (`fighter_accounts`, claim requests) keyed on the account id; untouched by how someone signs in | Pack 08 / Pack 1 |
| Forgot / reset / change password | None | — |
| Sign-out | `AuthContext.signOut` disables this device's push first (Pack 15) | `AuthContext.tsx` |
| Hosted Auth settings | Not in the repository (no `supabase/config.toml`). Unknown from here: whether "Confirm email" and "Secure password change" are on, the redirect allow-list, SMTP. The UI handles every combination (see §3) and the rollout notes list what to check | dashboard |

### Command Centre sources (all reused, none duplicated)
| Need | Authoritative source | Access today |
| --- | --- | --- |
| Matches, fields, queue, current/next fights | `matches` (Pack 09A queue `queue_state`, `queue_order`, `field`, `scheduled_at`) via `useEventDayData` (realtime via `realtimeChannel`, PR #35) | public |
| Field boards, attention rules (two active, withdrawn in a live fight, walkover, blocked, bracket needed, result review, double booking) | `lib/eventDay.ts` (`buildFieldBoards`, `attentionItems`, `competitionProgress`) | pure |
| Lyst clock / round state | Pack 13 `lyst_public_state` (`useLystPublic`) | public |
| Result conflicts | `list_result_conflicts` (Pack 03) | organizer, head marshal |
| Schedule clashes | `fighter_schedule_conflicts` | scoring staff |
| Readiness | Pack 16 `private.readiness_rows` (one rule) | desk roles via `event_readiness` (with notes/weights) |
| Staff | `event_staff` / `list_event_staff` (returns emails; organizer only) | organizer |
| Announcements | Pack 15 `AnnouncementPanel` (`send_event_announcement`, limits, audit, history) | organizer |
| Broadcast | Pack 14 `event_broadcast` | public read |

The Event day tab (Manage › Event day) is the organizer's *control* screen: it calls fights, saves the Pack 09D plan automatically, resolves
results. The Command Centre is the *read-only* "what needs me now" screen. It must not run the planner autosave or any other write.

## 2. Plan

### Part A: email + password (Supabase Auth only)
- `SignIn` becomes: **Email, Password (show/hide), Sign in, Forgot password?, Create account**, then "Other ways": email code and Google (unchanged).
  `autocomplete` = `email`/`username`, `current-password`, `new-password`; Enter submits; buttons lock while a request is in flight.
- Create account: `supabase.auth.signUp` with `emailRedirectTo` = the page the person was on. If Supabase returns a session (confirmation off) they
  are signed in and go through the existing `/welcome` step; if not, "Check your email" (worded so it never reveals whether the address already has
  an account). No profile or fighter is created by BuhurtOS at sign-up: the existing trigger + `/welcome` + claims do that, as today.
- Forgot password: `resetPasswordForEmail(email, { redirectTo: <site>/reset-password?next=… })`; the same answer whatever the address.
- `/reset-password`: handles the recovery session (PASSWORD_RECOVERY / PKCE code), expired / invalid / used links (error in the URL or no recovery
  session), leaving and coming back; New + Confirm + Save; then "Continue" to where they were going.
- Change password (Account › Password): current password (or "I have no password yet" for code/Google accounts) → `updateUser({ password,
  current_password })`; if Supabase answers `reauthentication_needed`, it sends a code (`reauthenticate()`) and the update is retried with the nonce.
  Nothing weakens Supabase's own checks.
- Destination kept: inline sign-in already renders at the destination; email links carry `next`; `/sign-in?next=` exists for links from elsewhere.
- Existing accounts: untouched. Code and Google sign-in unchanged; test accounts sign in through the normal form; nobody's password is set or reset by
  BuhurtOS.

### Part B: Organizer Command Centre (`/events/<slug>/command`)
- **Access**: organizer (incl. org admins and the platform owner by the existing rule) and the **head marshal** (who already resolves result
  conflicts and readiness overrides for the event). Check-in desk, inspectors, scorekeepers, marshals, medics, captains, fighters: no. Enforced by
  the database (`event_command_snapshot` refuses with 42501), the page only reflects it.
- **One additive RPC**: `public.event_command_snapshot(p_event)` → jsonb: server time, viewer role, readiness counts and the not-ready list from
  Pack 16's `readiness_rows` (status words only: no notes, no weights), active overrides, per-fight readiness for the fights in play and coming up,
  staff assigned per role (display names only, "assigned" not "present"), broadcast configured/not. No new tables, no stored state.
- **Client** combines the snapshot with the public live data it already has (matches + Lyst public state over the existing realtime hooks), plus
  the existing result-conflict and clash functions. Attention items reuse `attentionItems` and add readiness / Lyst items; each says what, who,
  where and links to the existing screen that fixes it.
- **Never a second authority**: no timer, no score, no queue writes. The page makes no write calls at all.
- **Freshness**: realtime match data (existing channels), snapshot re-read every 20 s, after a live update, on reconnect/focus; "Updated hh:mm:ss" and
  a clear stale / offline banner when the last good read is older than 60 s or the connection is down.

## 3. Hosted settings this depends on (owner checks before release)
- Authentication › URL configuration: the site URL and `…/reset-password` (and the site's pages, for email links) in the redirect allow-list.
- Authentication › Providers › Email: password sign-in enabled (it is used by the test accounts today, so it is on). "Confirm email" on or off both
  work; on is recommended. "Secure password change" on is supported (the code flow).
- SMTP: reset and confirmation emails use the same sender as the email codes.

## 4. What was built
### Part A: sign-in (`src/auth/SignIn.tsx`, `src/auth/AuthPages.tsx`, `src/lib/authFlow.ts`, `AuthContext`)
- **Sign in**: Email, Password (Show/Hide), Sign in, Forgot password?, Create account; then "Other ways": Google, "Email me a sign-in code"
  (both unchanged). One request at a time (a ref guard, not just a disabled button). `/sign-in?next=…` for links from elsewhere; `next` must be a
  path inside BuhurtOS (`safeNext`: no other sites, no `//host`, no `javascript:`).
- **Create account**: `signUp` with `emailRedirectTo` = the page the person was on. Session returned (confirmation off) → signed in → the existing
  `/welcome` step; no session (confirmation on) → "Check your email … if <address> can be used for a new account" + "Send the link again".
- **Forgot password**: the same "Check your email … if <address> has an account" for every address. Supabase's per-address limit ("too soon",
  which only happens for real accounts) is answered the same way, so it cannot be used to discover accounts.
- **`/reset-password`**: valid link → New + Confirm + Save → "Password saved" + Continue (to `next`); leaving and coming back keeps working;
  used / expired / invalid / replaced-by-a-newer-link / other-browser links are explained, with "Send a new link".
- **Account › Password**: current password (checked by a fresh sign-in, and sent as `current_password` for Supabase's own check when enabled),
  or "I have never set a password" for code / Google accounts; Supabase's `reauthentication_needed` → it emails a code → "Confirm and save".
- Errors are words (`authErrorMessage`); a wrong password and an unknown email read identically.

### Part B: Command Centre (`/events/<slug>/command`, `src/pages/CommandCentrePage.tsx`, `src/lib/commandCentre.ts`, migration `20261012000100`)
- **Who**: organizer (incl. org admins and the platform owner by the existing rule) and the head marshal of THAT event. Enforced by
  `event_command_snapshot` (42501 for everyone else, and for an event that does not exist). Head marshal: same picture, links go to the field
  screens (Manage is organizer-only), no announcement form (Pack 15 is organizer-only).
- **Header**: event name, status, the time at the event, the overall state ("All good: nothing needs you right now" / "N things need attention (k
  now)" — a count of open items, no score), "Live · updated hh:mm:ss", or "Offline / Not updating · last updated … This may be out of date".
- **Needs attention** (most urgent first; each item = what, who, where, a link to the existing screen):
  result conflicts → Event day (organizer) / the field screen (head marshal); Event day's own rules reused as is (two fights active on a field, a
  withdrawn entrant in a called fight, walkover needed, a due fight that cannot run, double booking, bracket to build); fighters called to fight
  (on now / on deck / in the hole) but not ready, and those fighting within 90 minutes (Pack 16 reasons); armour to fix; arrived but not checked in;
  not here yet; still to inspect; insurance / fee; registrations waiting (organizer); overrides in place (FYI); a paused Lyst clock (Pack 13);
  a field 15+ minutes behind its scheduled time (not while its clock is running); a field with no fight on and the next one ready (organizer).
- **Fighters**: counts from Pack 16 (one rule), each a link into the desk on that list (`/checkin?f=…`); "Fighting soon, not ready" with the slot.
- **Fields**: per field, state in words from Pack 13 (clock running / paused / not running, round), the fight on, the next, how many are waiting,
  minutes behind, readiness warnings, "Open Lyst Control". No clock, no score, no queue order of its own.
- **Fights** (on now / called next / coming up, not the bracket), **Progress** (fights scored of drawn, competitions by phase; no finish-time
  estimate: the data cannot support one honestly), **Staff** (assigned per role, names only; "BuhurtOS does not know who is physically here";
  roles nobody holds), **Announcements** (the Pack 15 panel itself), **Broadcast** (configured or not, link to Manage › Broadcast),
  **Quick actions** (existing screens only).
- **Freshness**: matches over the existing realtime channels (`realtimeChannel`, PR #35) with polling fallback; Lyst state via `useLystPublic`;
  the snapshot every 20 s, after each live change, on reconnect and on focus. Stale after 60 s without a good read, or offline.
- **Read-only**: the page makes no write call (no planner autosave, unlike Event day). Verified: 25 s open changed no match, timer, round, check,
  audit row, result or notification.

## 5. Known limits (by design or by Supabase)
- Reset links use Supabase's PKCE flow: the link works in the browser that asked for it, and a newer request replaces an older link. The page says so.
- With "Confirm email" OFF on the project, Supabase answers sign-up for an existing address with an error; the app words it neutrally, but the
  difference is Supabase's. Recommended: keep it ON.
- Presence is not tracked: Staff shows assignments only.
