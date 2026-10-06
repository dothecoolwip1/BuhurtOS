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
