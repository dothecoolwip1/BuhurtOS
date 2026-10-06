-- The three FIXED production smoke-test identities for the Red Deer Reavers members page (see docs/runbooks/CLUB_MEMBERSHIP.md, "Production smoke tests").
-- Run by the OWNER in the Supabase SQL editor. Contains NO passwords and NO secrets, creates NO auth users, and sends NO email.
--
--   X  reavers-smoke-fixed-x@buhurtos.ca   voting TEST member (approved while a test runs)   display name "Smoke Test Fixed X"
--   Y  reavers-smoke-fixed-y@buhurtos.ca   voting TEST member (approved while a test runs)   display name "Smoke Test Fixed Y"
--   Z  reavers-smoke-fixed-z@buhurtos.ca   pending TEST applicant (cannot vote)              display name "Smoke Test Fixed Z"
--
-- ONE-TIME SETUP (by hand, so no confirmation email is ever sent):
--   1. Supabase Dashboard > Authentication > Users > Add user > "Create new user": the email above, a password you choose, and TICK
--      "Auto Confirm User". Do this for X, Y and Z. NEVER use the public Create account page, and never use "Forgot password" for them.
--   2. Run SECTION 1 below once.
--   3. Add the nine repository secrets (GitHub > Settings > Secrets and variables > Actions):
--        SMOKE_X_EMAIL  SMOKE_X_PASSWORD  SMOKE_X_NAME     (name: Smoke Test Fixed X)
--        SMOKE_Y_EMAIL  SMOKE_Y_PASSWORD  SMOKE_Y_NAME     (name: Smoke Test Fixed Y)
--        SMOKE_Z_EMAIL  SMOKE_Z_PASSWORD  SMOKE_Z_NAME     (name: Smoke Test Fixed Z)
--
-- WHY THE MEMBERSHIPS SIT AT "removed": an approved test member would show up in the real AGM voting list, check-in list and saved record.
-- So they stay Removed, and are switched on (SECTION 2) only for the minutes a test runs, then off again (SECTION 3).
--   before a run: SECTION 2 (arm)      after a run: SECTION 3 (disarm)      any time: SECTION 4 (check)
-- Every change writes an audit_log row. Nothing is deleted.

-- ================================================================ SECTION 1: prepare (once; safe to run again)
with team as (select t.id, (select max(y.year) from public.club_membership_years y where y.team_id = t.id) as yr from public.teams t where t.slug = 'red-deer-reavers'),
ident(email, full_name) as (values
  ('reavers-smoke-fixed-x@buhurtos.ca', 'Smoke Test Fixed X'), ('reavers-smoke-fixed-y@buhurtos.ca', 'Smoke Test Fixed Y'), ('reavers-smoke-fixed-z@buhurtos.ca', 'Smoke Test Fixed Z')),
u as (select a.id, i.full_name from auth.users a join ident i on lower(a.email) = i.email),
p as (update public.profiles pr set display_name = u.full_name, onboarded_at = coalesce(pr.onboarded_at, now()), interests = case when cardinality(pr.interests) = 0 then '{fighter}' else pr.interests end
      from u where pr.id = u.id returning pr.id),
m as (insert into public.club_memberships (team_id, membership_year, user_id, status, full_name, adult_confirmed, bylaws_agreed_at, status_changed_at, status_note)
      select team.id, team.yr, u.id, 'removed', u.full_name, true, now(), now(), 'fixed production smoke-test identity (not a real member); switched on only while a test runs'
      from u cross join team on conflict (team_id, membership_year, user_id) do nothing returning id, full_name),
d as (insert into public.club_dues (membership_id, status) select id, 'unpaid' from m on conflict do nothing returning membership_id),
a as (insert into public.audit_log (action, subject, details) select 'club.smoke_identity_prepared', id::text, jsonb_build_object('name', full_name, 'status', 'removed') from m returning subject)
select (select count(*) from u) as auth_users_found_of_3, (select count(*) from p) as profiles_prepared, (select count(*) from m) as memberships_created;
-- auth_users_found_of_3 must be 3. If it is less, create the missing users in the dashboard (step 1) and run this again.

-- ================================================================ SECTION 2: ARM, before a test run (X and Y approved voters, Z pending)
with u as (select a.id, lower(a.email) as email from auth.users a where lower(a.email) in ('reavers-smoke-fixed-x@buhurtos.ca', 'reavers-smoke-fixed-y@buhurtos.ca', 'reavers-smoke-fixed-z@buhurtos.ca')),
w as (update public.club_memberships m set status = case when u.email like '%-z@%' then 'pending' else 'active' end, status_changed_at = now(),
        status_note = 'fixed production smoke-test identity: switched ON for a test run (not a real member)'
      from u where m.user_id = u.id and m.full_name like 'Smoke Test Fixed %' returning m.id, m.status)
insert into public.audit_log (action, subject, details) select 'club.membership_status', id::text, jsonb_build_object('to', status, 'note', 'fixed smoke-test identity armed') from w returning subject, details ->> 'to' as now_status;

-- ================================================================ SECTION 3: DISARM, after a test run
-- (a) withdraw any test candidacy still live (kept as history), (b) switch all three off again
with w as (update public.club_meeting_nominations n set status = 'withdrawn', responded_at = now()
           from public.club_memberships c where c.id = n.nominee_membership_id and c.full_name like 'Smoke Test Fixed %' and n.status in ('accepted', 'awaiting_acceptance') returning n.id, n.office, n.status),
h as (insert into public.club_meeting_nomination_history (nomination_id, action, previous_status, new_status, changed_by) select id, 'withdrawn', 'accepted', 'withdrawn', '00000000-0000-0000-0000-000000000000' from w returning nomination_id),
a1 as (insert into public.audit_log (action, subject, details) select 'club.agm_nomination_withdrawn', id::text, jsonb_build_object('office', office, 'note', 'fixed smoke-test cleanup') from w returning subject),
o as (update public.club_memberships m set status = 'removed', status_changed_at = now(), status_note = 'fixed production smoke-test identity (not a real member); switched off after a test run'
      where m.full_name like 'Smoke Test Fixed %' and m.status <> 'removed' returning m.id),
a2 as (insert into public.audit_log (action, subject, details) select 'club.membership_status', id::text, jsonb_build_object('to', 'removed', 'note', 'fixed smoke-test identity disarmed') from o returning subject)
select (select count(*) from w) as candidacies_withdrawn, (select count(*) from o) as memberships_switched_off;

-- ================================================================ SECTION 4: check (read only)
select a.email, a.email_confirmed_at is not null as confirmed, p.onboarded_at is not null as profile_done, m.status as membership
from auth.users a left join public.profiles p on p.id = a.id
left join public.club_memberships m on m.user_id = a.id and m.full_name like 'Smoke Test Fixed %'
where lower(a.email) in ('reavers-smoke-fixed-x@buhurtos.ca', 'reavers-smoke-fixed-y@buhurtos.ca', 'reavers-smoke-fixed-z@buhurtos.ca') order by a.email;
