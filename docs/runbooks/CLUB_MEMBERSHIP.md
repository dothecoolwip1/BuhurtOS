# Club membership, dues and AGM voting (Red Deer Reavers)

Status date: 2026-10-06. Migrations `20261013000100_club_membership_dues_voting.sql` and `20261014000100_club_fee_waiver_and_agm.sql`.

**Update (part 2):** see section 12 for the 2026 fee waiver, account creation on the club website and the 2026 AGM. Where part 1 below says
BuhurtOS has an AGM tab or that the two sites run on different domains, part 2 replaces it: AGM screens are on the club website only, and both
sites are served from `https://dothecoolwip1.github.io` (one browser origin).

One BuhurtOS account per person. The Red Deer Reavers website signs in to the same Supabase project as BuhurtOS. There is no second
password database, and no token is passed between the two websites.

## 1. What already existed and was reused

| Existing | Used for |
| --- | --- |
| `auth.users` / Supabase Auth (password, email code, Google) | The one account. The club website uses the same project and publishable key. |
| `public.profiles.display_name` | Suggested name on the application. Email is read from `auth.users` and never copied. |
| `public.teams` row `red-deer-reavers` (hosted: approved, HACSA member) | The club. Every new table is keyed by `team_id`, so clubs are isolated from each other. |
| `private.can_admin_team` (platform owner or the team's organization admin) | May record office holders, for example to bootstrap the first President. |
| `private.person_name`, `private.audit` / `audit_log` | Names in history, plus a general audit entry for every change. |

Not reused, on purpose:

- **`team_roles`** only allows `captain` and has primary key `(team_id, user_id)`, so one person cannot be captain and Treasurer there. Executive
  offices need term history, so they live in `team_officers`. Captains are unchanged.
- **`team_memberships`** is the public sporting roster (who fights). Society membership (dues, AGM votes) is private and is kept in
  `club_memberships`. The two are never merged.

## 2. New database structures

| Table | Purpose | Key rules |
| --- | --- | --- |
| `team_officers` | Executive office terms: President, Vice President, Secretary, Treasurer, Director | `ended_on` null = in office. Partial unique index: one current holder per office (directors excepted). Ended rows are kept as history. |
| `club_membership_years` | Per club and year: dates, dues amount (2026 = $20), `min_voting_age` (18), `dues_required_to_vote`, `applications_open` | Seeded: Reavers 2026, 2026-01-01..2026-12-31, 2000 cents. |
| `club_memberships` | One row per person, club and year: status `pending/active/inactive/removed`, full name, Discord, date of birth OR 18+ confirmation, bylaws agreement time, applied time, status change by/at/note | `check (date_of_birth is not null or adult_confirmed)`. `user_id` is set to null if an account is erased, so the society record survives. Never deleted. |
| `club_dues` | One dues record per membership (so per member and year): `unpaid/paid/waived/gear_contribution`, amount, note, changed at/by | Annual by construction. There is no permanent "dues paid" flag. |
| `club_dues_history` | Append-only audit: member (name snapshot), year, previous and new status and amount, executive (id, name, and the office used), time, note | A trigger refuses UPDATE and DELETE even for the table owner. No grant, no policy. |

## 3. RLS and grants

All five tables have RLS enabled. API roles (`anon`, `authenticated`) have **no insert, update or delete grant** on any of them.

| Table | Direct read |
| --- | --- |
| `team_officers` | Own rows only (`user_id = auth.uid()`). |
| `club_membership_years` | Everyone (the dues amount is public). |
| `club_memberships`, `club_dues` | Own rows only. |
| `club_dues_history` | Nobody. Only through `club_dues_history()`. |

Every change goes through a `SECURITY DEFINER`, `search_path=''` function that checks the caller's current office in the club that owns the
record. All of them are executable by `authenticated` only, never `anon`.

| Function | Who may call it |
| --- | --- |
| `club_membership_overview(team)` | Any signed-in person. Returns only their own memberships, dues, eligibility and offices, plus what they may do. |
| `apply_for_club_membership(...)` | The person, for themselves. Creates a Pending membership and Unpaid dues. Can edit their own details only while Pending. |
| `club_member_roster(team, year, as_of)` | Any current executive of that club. Read-only. Shows 18+ or under 18, never the date of birth. This is also the AGM snapshot. |
| `set_club_dues(membership, status, amount, note)` | Current **President, Secretary or Treasurer** of the membership's own club. Writes dues, a history row and an audit_log row. |
| `set_club_membership_status(membership, status, note)` | Same three offices. |
| `club_dues_history(team, year, membership)` | Any current executive of that club. |
| `list_team_officers` / `assign_team_officer(team, email, office, note)` / `end_team_officer(officer, note)` | Listing: executives or assigners. Assigning and ending: the platform owner, an admin of the team's organization, or the club's current President or Secretary. |
| `set_club_membership_year(...)` | President, Secretary or Treasurer. |

## 4. How voting eligibility is calculated

Eligibility is calculated each time it is read, by `private.club_vote_check(membership, as_of)`. It is not stored, and no column or function
can write it. A member is eligible when none of these rules fails:

| Code | Shown as | Fails when |
| --- | --- | --- |
| `membership_pending` | Membership pending approval | status is pending |
| `membership_inactive` | Membership inactive | status is inactive |
| `membership_removed` | Membership removed | status is removed |
| `under_age` | Under 18 | date of birth makes them younger than `min_voting_age` on the `as_of` date |
| `age_unknown` | Age not confirmed | no date of birth and no 18+ confirmation (the table already prevents this) |
| `dues_unpaid` | Dues unpaid | `dues_required_to_vote` and dues are Unpaid. Paid, Waived and Gear contribution all satisfy it. |

A Gear contribution counts as approved because only a dues officer can record one.

To add a bylaw rule later, add one `select` line to the `rules` list in `club_vote_check`. If the rule needs a setting, add a column on
`club_membership_years`. Both apps show the reasons the database returns, so neither needs changing.

The AGM snapshot passes the AGM date as `as_of`, so ages are counted on the meeting day. Reading it changes nothing (the gate checks this).

## 5. How dues permissions follow the office

`private.my_team_offices(team)` returns the caller's offices in that team where `ended_on is null` and `started_on <= today`.
`can_change_club_dues` is true when that list includes `president`, `secretary` or `treasurer`.

- **Assigning** a President, Vice President, Secretary or Treasurer sets `ended_on` on the previous holder's term the same day. The previous
  holder loses the permission at once and the new holder gains it.
- **Ending** a term (`end_team_officer`) removes the permission immediately.
- No name is written into any authorization logic. Kedrixx, Carm and Garrett get permissions only once they are assigned to an office.
- A Vice President or Director can view the roster, AGM snapshot and history, but cannot change anything.
- The platform owner and organization admins can record office holders but are not club executives, so they cannot see or change dues
  unless they also hold an office.
- Each history row stores the office used, so the record shows which office authorised a change even after the person leaves it.

## 6. Screens

- **BuhurtOS** `/teams/red-deer-reavers/membership`, linked from the team page as "Club membership".
  - Tabs: My membership, Members, AGM, Dues history, Executive.
  - Members: six summary tiles (each one filters), filter chips, search, compact rows on a phone and columns on desktop.
  - Changing dues opens a small dialog. Approving a member uses a side drawer.
  - The AGM tab is a printable snapshot.
- **Red Deer Reavers website** `members.html` ("Members" in every menu, "Member Sign In" on the homepage).
  - Members see their own record or the application form.
  - Executives also see Members, AGM voters and Dues history, with Dues and Approve buttons for the three dues offices.
  - Office assignment links out to BuhurtOS.

## 7. How the club website signs in (and why sessions are not shared)

- `members.html` loads a vendored, pinned `supabase-js` 2.117.2 (no CDN trust) and `assets/js/buhurtos-config.js`. That config holds the
  hosted project URL and the publishable key, which are public by design.
- Sign-in options are email + password (`signInWithPassword`) or a 6-digit email code (`signInWithOtp` / `verifyOtp`). An email code for a new
  address creates the BuhurtOS account itself.
- "Forgot password" and "Create an account with a password" open BuhurtOS. That avoids adding the club domain to Supabase's redirect
  allow-list.
- **Same identity:** both sites call the same Supabase Auth, so a person is the same `auth.users` id on both. This was verified locally
  against the real Supabase Auth server (section 9).
- **Sessions are per website.** BuhurtOS (`buhurtos.ca`) and the club site (GitHub Pages) are different domains, and Supabase keeps each
  session in that origin's own browser storage. Sharing one session across both would mean putting tokens in URLs or relying on third-party
  cookies. Both weaken authentication, so neither was done. A person signs in once on each site with the same email and password, or code.
- **Cross-site session sharing has not been implemented, and nothing was tested on the real domains** (the sandbox could not reach them and
  nothing is deployed).

The club page sets a Content-Security-Policy `<meta>` limiting scripts to self and cdnjs (Materialize) and connections to the Supabase
project. All database text is inserted with `textContent`.

## 8. Deployment and configuration

| Item | State |
| --- | --- |
| Hosted migration | **Applied** 2026-10-06 to project `mvbxlebznlgroptwwdsm` (`apply_migration club_membership_dues_voting`). Three function bodies were then re-created with the repository's exact text, including comments. All 19 function bodies are md5-identical to the repository. |
| BuhurtOS frontend | On branch `ccr-f3ffa4b5-htzvr1`. **Not merged, not deployed.** |
| Club website | On branch `ccr-f3ffa4b5-htzvr1` of `Red-deer-reavers`. **Not merged, not published.** |
| Supabase Auth settings | No change needed for password and email-code sign-in from the club site. The magic-link/OTP email template must keep `{{ .Token }}` (it already does for BuhurtOS codes). Add the club site to Authentication > URL Configuration > Redirect URLs **only** if Google sign-in or email links are later wanted on the club site itself. |
| If the club site moves to a custom domain | Nothing to change: the config and CSP name only the Supabase project. |

## 9. Verification performed

- **Database gate:** `supabase/tests/club_membership_gate.sql`, 101 checks, part of `run_all.sh`. The full `run_all.sh` passes (all existing suites plus this one), and the schema fingerprint was updated.
- **Hosted:** grants, RLS and the 19 function hashes were compared with the repository. A rolled-back permission run on the hosted database checked:
  - a member cannot change dues, status, offices or history;
  - anonymous callers and another team's Treasurer are refused;
  - the Vice President can view but not change;
  - the President, Secretary and Treasurer can change dues;
  - reassigning or ending a term moves the permission.

  Afterwards the hosted club tables were confirmed empty and the test users were gone.
- **Real-auth end to end:** `scripts/e2e/club-live.sh`, **58/58**. It ran against the real Supabase Auth server, PostgREST, the built
  BuhurtOS app and the real club website files on a second origin, in Chromium at 390x844 and 1280x900. Details: header of
  `scripts/e2e/club-live.mjs`.
- **Regression:** field-pack03 28/28, sw-update 28/28, pack07-ux 89/89, pack08-entrants 54/54, pack12-app 78/78. Vitest 965, typecheck and
  build pass.

## 10. Manual steps for Garrett

1. **Merge and deploy BuhurtOS** (branch `ccr-f3ffa4b5-htzvr1`). The database side is already live. Until the frontend is deployed, the
   membership pages exist only on the branch.
2. **Merge the Red-deer-reavers branch** so GitHub Pages publishes `members.html`. Then check Members sign-in on the real site with a test
   account.
3. **Record the executive.** Signed in as the platform owner (`garrettrobson95@gmail.com`), open
   `buhurtos.ca/teams/red-deer-reavers/membership?view=officers` and assign by sign-in email:
   - President: Kedrixx
   - Secretary: Carm
   - Treasurer: Garrett. Choose which of your two accounts holds it: `dothecoolwip@gmail.com` is the one linked to your fighter and Reavers
     captaincy.

   Kedrixx and Carm need to sign in once first, on either site. No office holders were seeded, because the two Garrett accounts made the
   choice ambiguous.
4. **Confirm the membership year.** The 2026 year is seeded as the calendar year with $20 dues. If the bylaws use a different year, change it
   with `set_club_membership_year` (or ask for a small settings form).
5. **Before the AGM (October 18):**
   - Members apply on either site.
   - The President, Secretary or Treasurer approves applications and records dues.
   - On the night, open the AGM tab, set the AGM date and print.
6. Optional: turn on Supabase "leaked password protection" (an existing advisor warning, not caused by this change).

## 11. Known limits and follow-ups

- No email or notification is sent when someone applies. The Pending count and amber rows show it on the dashboard instead. Adding a
  notification kind needs a constraint change on `notifications`.
- No "renew for next year" button. Members apply again for a new year once an executive opens it.
- Executives cannot enter a member who has no BuhurtOS account. Every member needs an account.
- An executive can record their own dues. This is allowed and visible in the history (name and office).


## 12. Part 2 (2026-10-06): shared account creation, 2026 fee waiver, the 2026 AGM

### Production addresses (from the Supabase Auth logs)
- BuhurtOS: `https://dothecoolwip1.github.io/BuhurtOS/`
- Club website: `https://dothecoolwip1.github.io/Red-deer-reavers/` (members area: `members.html`)

Both sites have the **same browser origin**. supabase-js keeps the session under the same storage key on both, so the browser holds one
sign-in for both sites. Signing in on one signs you in on the other, and signing out signs you out of both. No token is put in a URL or passed
between the sites. The *account* is the same either way: one `auth.users` row and one `profiles` row.

### Accounts on the club website (`members.html`)
| Action | How |
| --- | --- |
| Create account | `supabase.auth.signUp` in the BuhurtOS project. The database trigger creates the BuhurtOS `profiles` row. The confirmation email links back to `members.html`. |
| First step after confirming | BuhurtOS's own profile step: name, how you take part, optional city and province, saved with `complete_my_profile`. BuhurtOS never asks again. |
| Then | Join the Red Deer Reavers (`apply_for_club_membership`) → "Membership Application Pending" → approved → "Membership: Active". |
| Sign in | Email + password, Continue with Google, or an emailed 6-digit code for existing accounts. Existing BuhurtOS users never create a second account. |
| Existing email at Create account | No second identity is created (Supabase Auth behaviour). The page says to sign in or reset the password, without saying whether the address has an account. |
| Forgot password | `resetPasswordForEmail`. The link returns to `members.html?reset=1`, which shows "Choose a new password". The password works on both sites. |

### 2026 fee waiver
`club_membership_years.fee_waived` (per club and year). Reavers 2026 = true; every other year defaults to false.
- `club_vote_check`: Unpaid dues no longer stop anyone voting in a waived year. All other rules are unchanged.
- Per-member dues records, their history, and the Paid / Waived / Gear contribution statuses are untouched and work again in 2027.
- Both apps show "Fee waived" / "WAIVED" instead of "Unpaid".

### AGM (club website only; BuhurtOS has no AGM screens)
| Table | What it holds |
| --- | --- |
| `club_meetings` | Seeded: Red Deer Reavers 2026 AGM, 2026-10-18 17:30 America/Edmonton, at Alister's home. The video link is private and set by the executive. |
| `club_meeting_rsvps` + append-only `club_meeting_rsvp_history` | One row per member and meeting: In Person / Video Call / Voting by Proxy / Not Attending. Changes are allowed until the meeting starts. |
| `club_meeting_proxies` | Grantor, holder, authorization wording, time, status (`active` / `cancelled` / `replaced`), end time, who ended it, why. Rows can only be ended, never edited or removed (trigger). At most one active proxy per member. |
| `club_meeting_attendance` + append-only history | Check-in: present in person / present by video / absent, who, when, and eligibility at that moment. Never touches the RSVP. |
| `club_meeting_records` | Append-only frozen snapshots ("Save official AGM record"), so the record does not change when memberships change later. |

Proxy rules: the holder must be eligible to vote on the meeting day, must not be the member themselves, must be in the same club and year, and
must not have given away their own vote. A member who holds proxies cannot give theirs away. The member must tick the authorization.
- A proxy is **valid** while both people are eligible and the holder has not given their own proxy.
- Proxies are documented authority only. Nothing casts or counts votes.

Permissions:

| Who | May |
| --- | --- |
| Any member (pending, active or inactive; not removed) | RSVP and give a proxy, for their own membership only. |
| Active and pending members, and executives | See the video link. |
| Any current executive | See the AGM dashboard, proxy list and voting list. |
| President, Secretary, Treasurer | Check-in, the video link, and saving the official record. |

Every table: RLS on, no grants, functions only.

### Tests
- `supabase/tests/club_agm_gate.sql`: 78 checks, in `run_all.sh`.
- `scripts/e2e/club-live.sh`: 61 checks with the real Supabase Auth server and its default link-only emails. Both sites are served from one
  origin like production, at 390x844 and 1280x900.

### Manual step that only the owner can do (Supabase dashboard)
**Authentication › URL Configuration › Redirect URLs** must include `https://dothecoolwip1.github.io/Red-deer-reavers/**`. If
`https://dothecoolwip1.github.io/**` is already listed, nothing is needed. Without it, Supabase sends confirmation, reset and Google sign-in links
to the Site URL (BuhurtOS) instead of back to the club website. Because the origin is shared, the person still ends up signed in, but on the
BuhurtOS page.

## 13. Part 3 (2026-10-06): AGM concerns and executive nominations (club website only)

Migration `20261017000100_club_agm_topics_nominations.sql` (additive). BuhurtOS has **no screens** for any of this; the Red Deer Reavers
members page (`members.html`, 2026 AGM tab and the executive AGM admin) is the only UI. Nothing here changes membership, dues, eligibility,
RSVP, proxies, check-in, the printable list, `team_officers` or sign-in.

| Table | What it holds |
| --- | --- |
| `club_meeting_topics` + append-only `club_meeting_topic_history` | Member concerns / topics: subject (3 to 120 characters), details (up to 4000), status `submitted` / `on_agenda` / `addressed` / `withdrawn`. Every submission, edit, withdrawal and status change is kept in the history. Topics are never deleted. |
| `club_meeting_nominations` | One row per member, office and AGM, status `awaiting_acceptance` / `accepted` / `declined` / `withdrawn`. A unique index allows **one live candidacy** per member, office and meeting; declined and withdrawn rows are kept. Offices: President, Secretary, Treasurer only (a check constraint; widening it is an additive migration). |
| `club_meeting_nominators` | Everyone who put that member forward (a self-nomination lists the nominee as their own nominator). Five nominators of one member give ONE candidacy with five nominator rows. |
| `club_meeting_nomination_history` (append-only) | nominated / also nominated / accepted / declined / withdrawn, with who and when. |

Rules (all in the database functions; the screens only call them):
- **Concerns:** any member who is not removed may submit until the meeting starts. The owner edits or withdraws their own topic until the meeting
  starts and while it is Submitted or Added to Agenda (not once Addressed or Withdrawn). Nobody edits another member's topic.
  President, Secretary and Treasurer set Submitted / Added to Agenda / Addressed (also during the meeting); any current executive can read the list.
- **Nominating:** only a member who can vote today (the existing `club_vote_check`, counted on the meeting day) may nominate, until the meeting
  starts. Yourself: accepted at once. Someone else: the nominee must be able to vote too, and stays *awaiting acceptance* until THAT member
  accepts. Nobody can answer for someone else (checked against the nominee's own account). An accepted candidate can withdraw; the nominee
  must still be able to vote to accept. After a decline, a new nomination starts a new candidacy (the declined one is kept).
- **Nothing changes an officer.** No function touches `team_officers`. The election is held at the AGM; if nobody else stands, the current
  officer stays. Gate checks compare the officer table before and after.
- **What members see:** their own topics; nominations waiting for their answer (who nominated them, role, date); the board of current officers
  with accepted candidates and, labelled, nominees awaiting acceptance. Declined and withdrawn candidacies, and candidates whose membership was
  removed, are not shown to members. No e-mail addresses anywhere.
- **What the executive sees (AGM admin, Concerns and Nominations):** every topic with member, details, time, edited flag and status; every
  candidacy per office with status, self or member nomination and who nominated.

Permissions summary: members act only on their own topics, their own nominations and nominations made for them; executives (President,
Secretary, Treasurer) change topic status; any current executive reads. All five new tables have RLS on, no policies and no grants.

Tests: `supabase/tests/club_agm_topics_gate.sql` (136 checks, in `run_all.sh`; includes the rules above, the officer-unchanged check, direct
table access refused and records that cannot be removed or rewritten); `scripts/e2e/club-live.sh` (95 checks, section F drives the screens at 390x844
with real tokens); `scripts/e2e/reavers-production-agm-extras-smoke.mjs` (39 checks, passed on production 2026-10-06; manual workflow `reavers-production-smoke.yml` with
`suite = agm-extras`; it drives the LIVE site with FIXED, PRE-CONFIRMED test accounts only).

### Production smoke tests: fixed pre-confirmed accounts only (rule from 2026-10-06)
Earlier production runs signed up new `reavers-smoke-<tag>-x/y/z@buhurtos.ca` accounts. `buhurtos.ca` has no mail server, so every sign-up
confirmation email bounced to the owner (14 accounts that day). **Production tests must never sign anyone up or trigger an email.**
- `reavers-production-agm-extras-smoke.mjs` signs in with three accounts that already exist (repository secrets `SMOKE_X_*`, `SMOKE_Y_*`,
  `SMOKE_Z_*`: email, password, display name): X and Y approved voting TEST members, Z a pending TEST applicant. It refuses to run without them,
  never fills a profile or applies to join, and withdraws the candidacies it created at the end.
- `reavers-production-smoke.mjs` (creates accounts by sign-up) refuses to run.
- The fixed accounts must be created once, deliberately, by the owner (confirmed in the Supabase dashboard so no email is sent), and their
  memberships approved once. Nothing in this repository creates them.
- Do not point `buhurtos.ca` mail anywhere as part of this; that is the owner's decision.
