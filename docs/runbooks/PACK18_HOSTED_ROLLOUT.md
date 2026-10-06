# Pack 18 hosted rollout

Pack 18 = email + password sign-in and the Organizer Command Centre. **Performed 2026-10-06**: §2 applied and checked (see STATUS, Pack 18), app deployed by main run #113; §1 URL settings and leaked password protection confirmed by the owner; §3 is the owner's production check.

## 1. Supabase Auth settings (dashboard, project `mvbxlebznlgroptwwdsm`) — check before deploying the app
| Setting | Where | Needed |
| --- | --- | --- |
| Email provider enabled, password sign-in allowed | Authentication › Sign In / Providers › Email | Already used by the test accounts; confirm it is on |
| Confirm email | same page | On is recommended. Both on and off work in the app (verified locally with it ON). With it OFF, signing up with an address that already has an account answers "Could not create an account…" (Supabase's own behaviour) |
| Secure password change | same page | On is supported: the app asks for the emailed code (verified locally with it ON) |
| Minimum password length | Authentication › Policies (or Providers › Email) | 8 or more matches the app's message (the app checks 8; Supabase checks again) |
| Site URL | Authentication › URL Configuration | The production site address |
| Redirect URLs | same page | Must allow the site's pages for the email links: `<site>/**` (sign-up confirmation returns to the page the person was on; reset returns to `<site>/reset-password`). Google sign-in already relies on this |
| Email templates | Authentication › Emails | "Reset password" and "Confirm signup" default templates are fine (they use `{{ .ConfirmationURL }}`). The magic-link template must keep `{{ .Token }}` for the existing 6-digit codes. "Reauthentication" uses `{{ .Token }}` (default) |
| SMTP | Authentication › SMTP | The same sender as the email codes; Supabase's per-address limit (default 60 s) applies to reset and confirmation emails |

## 2. Database
1. Apply `supabase/migrations/20261012000100_pack18_command_centre.sql` through the established `apply_migration` process (additive: two
   functions, no tables, no data changes).
2. Read-only checks: `public.event_command_snapshot(uuid)` is SECURITY DEFINER, `search_path=""`, executable by `authenticated` only (not anon /
   PUBLIC); `private.can_command(uuid)` executable by nobody; the advisors show only the accepted `authenticated_security_definer_function_executable`
   warning for it.

## 3. After deploying
- Sign in with an existing test account through the normal form (email + password); with a code-only account use "Forgot password?" to set one.
- As an organizer, open an event › "Command Centre: what needs you now"; as that event's head marshal, the event page shows "Open the Command Centre".
- A scorekeeper / captain / fighter opening `/events/<slug>/command` sees "for this event's organizers and head marshal".
