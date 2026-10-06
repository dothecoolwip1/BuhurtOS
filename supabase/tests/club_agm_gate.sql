-- Club AGM gate: per-year fee waiver, RSVP, proxies, check-in, saved records (migration 20261014000100_club_fee_waiver_and_agm.sql).
--   * a waived year's unpaid dues do not stop an otherwise eligible member voting; a normal year's still do; dues records/history keep working
--   * members act only on their OWN membership; RSVP is one row per member with append-only history; proxies are documented authority only
--   * invalid proxies are refused (self, ineligible holder, other club, holder who gave their own proxy, no authorization)
--   * check-in is separate from the RSVP, executive-only, snapshotted, with history; saved records and histories cannot be changed
--   * nobody reads or writes these tables directly; other clubs' executives and regular members get nothing (42501)
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/club_agm_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.ok(label text) returns void language plpgsql as $$ begin insert into t.log (name) values (label); end $$;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a6' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b6' || n, 12, '0'))::uuid $$;
create function t.r() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6a01'::uuid $$;
create function t.o() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6a02'::uuid $$;
create function t.mt() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6c01'::uuid $$;
create function t.omt() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6c02'::uuid $$;
-- read as the owner (callers' own RLS view would hide the rows being checked)
create function t.q(sql text) returns text language plpgsql security definer as $$ declare v text; begin execute sql into v; return v; end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- Club R (2026 fee WAIVED, 2027 normal) and club O.  u1 President R, u2 Secretary R, u3 Treasurer R, u4 Vice President R,
-- u5 Ann (active adult, dues unpaid), u6 Bo (active adult), u7 Cy (pending), u8 Di (active, under 18), u9 Ed (removed), u10 Fay (active),
-- u11 stranger (no membership), u12 Treasurer of O, u13 Oli (member of O).
insert into auth.users (id, email) select t.u(n), 'agm' || n || '@example.test' from generate_series(1, 13) n;
update public.profiles set display_name = 'Person ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 13) n);
insert into public.teams (id, slug, name, status) values (t.r(), 'agm-gate-r', 'Gate Club', 'approved'), (t.o(), 'agm-gate-o', 'Other Club', 'approved');
insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents, fee_waived) values
  (t.r(), 2026, '2026-01-01', '2026-12-31', 2000, true), (t.r(), 2027, '2027-01-01', '2027-12-31', 2000, false), (t.o(), 2026, '2026-01-01', '2026-12-31', 2000, false);
insert into public.team_officers (team_id, user_id, office) values
  (t.r(), t.u(1), 'president'), (t.r(), t.u(2), 'secretary'), (t.r(), t.u(3), 'treasurer'), (t.r(), t.u(4), 'vice_president'), (t.o(), t.u(12), 'treasurer');
insert into public.club_memberships (id, team_id, membership_year, user_id, status, full_name, date_of_birth, adult_confirmed, bylaws_agreed_at) values
  (t.m(1), t.r(), 2026, t.u(1), 'active', 'Pres Ident', null, true, now()),
  (t.m(3), t.r(), 2026, t.u(3), 'active', 'Trea Surer', null, true, now()),
  (t.m(5), t.r(), 2026, t.u(5), 'active', 'Ann', null, true, now()),
  (t.m(6), t.r(), 2026, t.u(6), 'active', 'Bo', null, true, now()),
  (t.m(7), t.r(), 2026, t.u(7), 'pending', 'Cy', null, true, now()),
  (t.m(8), t.r(), 2026, t.u(8), 'active', 'Di', date '2015-01-01', false, now()),
  (t.m(9), t.r(), 2026, t.u(9), 'removed', 'Ed', null, true, now()),
  (t.m(10), t.r(), 2026, t.u(10), 'active', 'Fay', null, true, now()),
  (t.m(13), t.o(), 2026, t.u(13), 'active', 'Oli', null, true, now()),
  (t.m(25), t.r(), 2027, t.u(5), 'active', 'Ann', null, true, now());
insert into public.club_dues (membership_id, status) select id, 'unpaid' from public.club_memberships where team_id in (t.r(), t.o());
insert into public.club_meetings (id, team_id, membership_year, title, starts_at, location) values
  (t.mt(), t.r(), 2026, 'Gate Club 2026 AGM', now() + interval '10 days', 'Hall'),
  (t.omt(), t.o(), 2026, 'Other Club 2026 AGM', now() + interval '10 days', null);
create function t.vote(mem uuid) returns text language sql security definer as $$ select c.eligible || '/' || array_to_string(c.reasons, ';') from private.club_vote_check(mem) c $$;
grant execute on function t.vote(uuid) to authenticated;

-- ================================================================ 1. fee waiver is per year
select t.expect_eq('2026 (fee waived): an active adult with dues unpaid is ELIGIBLE', t.vote(t.m(5)), 'true/');
select t.expect_eq('2027 (normal year): the same person with dues unpaid is NOT eligible: Dues unpaid', t.vote(t.m(25)), 'false/Dues unpaid');
select t.expect_eq('a waiver does not hide other reasons: pending in 2026', t.vote(t.m(7)), 'false/Membership pending approval');
select t.expect_eq('a waiver does not hide other reasons: under 18 in 2026', t.vote(t.m(8)), 'false/Under 18');
select t.as_user(t.u(5));
select t.expect_eq('the member overview says the 2026 fee is waived',
  (select (m ->> 'fee_waived') || '/' || (m ->> 'eligible') || '/' || (select y ->> 'fee_waived' from jsonb_array_elements(o -> 'years') y where (y ->> 'year')::int = 2026)
   from (select public.club_membership_overview(t.r()) o) x, jsonb_array_elements(o -> 'memberships') m where (m ->> 'year')::int = 2026), 'true/true/true');
select t.as_user(t.u(3));
select public.set_club_dues(t.m(25), 'paid');
select t.expect_eq('dues records and history still work in a normal year (2027 paid -> eligible)', t.vote(t.m(25)), 'true/');
select t.as_admin();
select t.expect_eq('that change left a dues history row', (select count(*) from public.club_dues_history where membership_id = t.m(25)), 1::bigint);
update public.club_membership_years set fee_waived = false where team_id = t.r() and year = 2026;
select t.expect_eq('turning the waiver off brings the dues rule back', t.vote(t.m(5)), 'false/Dues unpaid');
update public.club_membership_years set fee_waived = true where team_id = t.r() and year = 2026;
select t.as_user(t.u(5));
select t.expect_error('a member cannot change the fee waiver directly', format($q$update public.club_membership_years set fee_waived = false where team_id = %L$q$, t.r()), '42501');

-- ================================================================ 2. member view
select t.as_user(t.u(11));
select t.expect_eq('a signed-in non-member sees the AGM but no membership, no video, no proxy candidates',
  (select format('%s|%s|%s|%s', v -> 'meeting' ->> 'title', v -> 'membership', v -> 'video', jsonb_array_length(v -> 'proxy_candidates')) from (select public.club_meeting_member_view(t.r()) v) x),
  'Gate Club 2026 AGM|null|null|0');
select t.as_anon();
select t.expect_error('anonymous callers cannot read the AGM view', format($q$select public.club_meeting_member_view(%L)$q$, t.r()), '42501');
select t.as_user(t.u(5));
select t.expect_eq('a member sees their eligibility, the fee waiver and the eligible members they could choose as proxy',
  (select format('%s|%s|%s|%s', v ->> 'eligible', v ->> 'fee_waived', v -> 'membership' ->> 'status',
     (select string_agg(e ->> 'name', ',' order by e ->> 'name') from jsonb_array_elements(v -> 'proxy_candidates') e)) from (select public.club_meeting_member_view(t.r()) v) x),
  'true|true|active|Bo,Fay,Pres Ident,Trea Surer');

-- ================================================================ 3. RSVP: own membership only, one row, history
select t.as_user(t.u(11));
select t.expect_error('a non-member cannot register', format($q$select public.set_club_meeting_rsvp(%L, 'in_person')$q$, t.mt()), '42501');
select t.as_user(t.u(9));
select t.expect_error('a removed member cannot register', format($q$select public.set_club_meeting_rsvp(%L, 'in_person')$q$, t.mt()), '42501');
select t.as_user(t.u(13));
select t.expect_error('a member of another club cannot register for this AGM', format($q$select public.set_club_meeting_rsvp(%L, 'in_person')$q$, t.mt()), '42501');
select t.as_user(t.u(5));
select t.expect_error('an unknown answer is refused', format($q$select public.set_club_meeting_rsvp(%L, 'maybe')$q$, t.mt()), '22023');
select public.set_club_meeting_rsvp(t.mt(), 'in_person');
select public.set_club_meeting_rsvp(t.mt(), 'video');
select public.set_club_meeting_rsvp(t.mt(), 'video');
select t.expect_eq('changing the answer keeps ONE RSVP row', t.q(format('select count(*) from public.club_meeting_rsvps where membership_id = %L', t.m(5))), '1');
select t.expect_eq('the RSVP shows the latest answer', t.q(format('select response from public.club_meeting_rsvps where membership_id = %L', t.m(5))), 'video');
select t.expect_eq('each change (not a repeat) is in the RSVP history', t.q(format($q$select string_agg(coalesce(previous_response,'-') || '>' || new_response, ',' order by id) from public.club_meeting_rsvp_history where membership_id = %L$q$, t.m(5))), '->in_person,in_person>video');
select public.set_club_meeting_rsvp(t.mt(), 'not_attending');
select t.ok('Not Attending is accepted');
select t.as_user(t.u(7));
select public.set_club_meeting_rsvp(t.mt(), 'in_person');
select t.ok('a pending applicant (not eligible) may still RSVP');
select t.as_user(t.u(5));
select t.expect_error('a member cannot write RSVPs directly (someone else''s or their own)', format($q$insert into public.club_meeting_rsvps (meeting_id, membership_id, response) values (%L, %L, 'in_person')$q$, t.mt(), t.m(6)), '42501');
select t.expect_error('a member cannot change RSVPs directly', $q$update public.club_meeting_rsvps set response = 'video'$q$, '42501');
select t.expect_error('a member cannot read the RSVP table directly', 'select count(*) from public.club_meeting_rsvps', '42501');

-- ================================================================ 4. proxies
select t.expect_error('a proxy needs the explicit authorization', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, false)$q$, t.mt(), t.m(6)), '22023');
select t.expect_error('a proxy needs a holder', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', null, true)$q$, t.mt()), '22023');
select t.expect_error('nobody can hold their own proxy', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(5)), '22023');
select t.expect_error('a pending (not eligible) member cannot hold a proxy', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(7)), '22023');
select t.expect_error('an under-18 member cannot hold a proxy', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(8)), '22023');
select t.expect_error('a removed member cannot hold a proxy', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(9)), '22023');
select t.expect_error('a member of another club cannot hold a proxy', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(13)), '22023');
select public.set_club_meeting_rsvp(t.mt(), 'proxy', t.m(6), true);
select t.as_admin();
select t.expect_eq('the proxy is stored with giver, holder, meeting, time and the authorization wording',
  (select format('%s|%s|%s|%s', grantor_membership_id = t.m(5), holder_membership_id = t.m(6), authorized_at is not null, authorization_text)
   from public.club_meeting_proxies where grantor_membership_id = t.m(5) and status = 'active'),
  format('t|t|t|I authorize Bo to act as my proxy for the %s Gate Club AGM.', (select to_char(starts_at at time zone timezone, 'FMMonth FMDD, YYYY') from public.club_meetings where id = t.mt())));
select t.as_user(t.u(6));
select t.expect_eq('the holder sees the proxy they hold', (select v -> 'proxies_held' -> 0 ->> 'grantor_name' from (select public.club_meeting_member_view(t.r()) v) x), 'Ann');
select t.expect_error('a member holding a proxy cannot give their own away (no chains)', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(10)), '22023');
select t.as_user(t.u(10));
select public.set_club_meeting_rsvp(t.mt(), 'proxy', t.m(1), true);
select t.as_user(t.u(5));
select t.expect_error('a member who gave their own proxy cannot hold one', format($q$select public.set_club_meeting_rsvp(%L, 'proxy', %L, true)$q$, t.mt(), t.m(10)), '22023');
select public.set_club_meeting_rsvp(t.mt(), 'proxy', t.m(3), true);
select t.as_admin();
select t.expect_eq('changing the holder replaces the old proxy and keeps it', (select string_agg(status, ',' order by authorized_at) from public.club_meeting_proxies where grantor_membership_id = t.m(5)), 'replaced,active');
select t.expect_eq('only one active proxy per member', (select count(*) from public.club_meeting_proxies where grantor_membership_id = t.m(5) and status = 'active'), 1::bigint);
select t.as_user(t.u(5));
select public.cancel_club_meeting_proxy(t.mt());
select t.as_admin();
select t.expect_eq('cancelling a proxy ends it and sets the answer back to no response',
  (select string_agg(status, ',' order by authorized_at) from public.club_meeting_proxies where grantor_membership_id = t.m(5)) || '|' || coalesce((select response from public.club_meeting_rsvps where membership_id = t.m(5)), 'none'),
  'replaced,cancelled|none');
select t.as_user(t.u(5));
select t.expect_error('cancelling when there is no proxy is refused', format($q$select public.cancel_club_meeting_proxy(%L)$q$, t.mt()), 'P0002');
select public.set_club_meeting_rsvp(t.mt(), 'proxy', t.m(6), true);
select public.set_club_meeting_rsvp(t.mt(), 'in_person');
select t.as_admin();
select t.expect_eq('choosing In Person cancels the active proxy', (select count(*) from public.club_meeting_proxies where grantor_membership_id = t.m(5) and status = 'active'), 0::bigint);
select t.as_user(t.u(5));
select public.set_club_meeting_rsvp(t.mt(), 'proxy', t.m(6), true);
select t.expect_error('a member cannot create a proxy for someone else directly', format($q$insert into public.club_meeting_proxies (meeting_id, grantor_membership_id, holder_membership_id, authorization_text, authorized_by) values (%L, %L, %L, 'I authorize someone to act', %L)$q$, t.mt(), t.m(10), t.m(5), t.u(5)), '42501');
select t.expect_error('a member cannot read the proxy table directly', 'select count(*) from public.club_meeting_proxies', '42501');
select t.as_admin();
select t.expect_error('a proxy record cannot be rewritten (even by the owner)', format($q$update public.club_meeting_proxies set holder_membership_id = %L where grantor_membership_id = %L and status = 'active'$q$, t.m(1), t.m(5)), '42501');
select t.expect_error('an ended proxy cannot be reopened', format($q$update public.club_meeting_proxies set status = 'active', ended_at = null where grantor_membership_id = %L and status = 'cancelled'$q$, t.m(5)), '42501');
select t.expect_error('proxy records cannot be removed', 'delete from public.club_meeting_proxies', '42501');
-- validity follows eligibility of both people
select t.as_user(t.u(1));
select t.expect_eq('the executive proxy list shows Ann -> Bo as valid', (select valid::text from public.club_meeting_proxy_list(t.mt()) where grantor_name = 'Ann' and status = 'active'), 'true');
select public.set_club_membership_status(t.m(6), 'inactive', 'gate');
select t.expect_eq('if the holder stops being eligible the proxy shows as not valid, with the reason',
  (select valid || '/' || problem from public.club_meeting_proxy_list(t.mt()) where grantor_name = 'Ann' and status = 'active'), 'false/Proxy holder is not eligible to vote');
select public.set_club_membership_status(t.m(6), 'active');
select t.expect_eq('the dashboard counts valid proxies held per member', (select valid_proxies_held from public.club_meeting_dashboard(t.mt()) where full_name = 'Bo'), 1);

-- ================================================================ 5. video link
select t.as_user(t.u(5));
select t.expect_eq('no video link until the executive sets one', (select v -> 'video' ->> 'link' from (select public.club_meeting_member_view(t.r()) v) x), null::text);
select t.expect_error('a member cannot set the video link', format($q$select public.set_club_meeting_video(%L, 'https://meet.example/x')$q$, t.mt()), '42501');
select t.as_user(t.u(4));
select t.expect_error('the vice president cannot set the video link', format($q$select public.set_club_meeting_video(%L, 'https://meet.example/x')$q$, t.mt()), '42501');
select t.as_user(t.u(12));
select t.expect_error('another club''s treasurer cannot set this club''s video link', format($q$select public.set_club_meeting_video(%L, 'https://meet.example/x')$q$, t.mt()), '42501');
select t.as_user(t.u(2));
select t.expect_error('the video link must be https', format($q$select public.set_club_meeting_video(%L, 'javascript:alert(1)')$q$, t.mt()), '22023');
select public.set_club_meeting_video(t.mt(), 'https://meet.example/reavers-agm', 'Passcode 1234');
select t.as_user(t.u(5));
select t.expect_eq('an active member gets the video link', (select v -> 'video' ->> 'link' from (select public.club_meeting_member_view(t.r()) v) x), 'https://meet.example/reavers-agm');
select t.as_user(t.u(11));
select t.expect_eq('a signed-in non-member never gets the video link', (select v ->> 'video' from (select public.club_meeting_member_view(t.r()) v) x), null::text);
select t.as_user(t.u(9));
select t.expect_eq('a removed member never gets the video link', (select v ->> 'video' from (select public.club_meeting_member_view(t.r()) v) x), null::text);

-- ================================================================ 6. executive dashboard and check-in
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot open the AGM dashboard', format($q$select * from public.club_meeting_dashboard(%L)$q$, t.mt()), '42501');
select t.expect_error('a regular member cannot open the proxy list', format($q$select * from public.club_meeting_proxy_list(%L)$q$, t.mt()), '42501');
select t.expect_error('a regular member cannot check anyone in', format($q$select public.set_club_meeting_attendance(%L, %L, 'present_in_person')$q$, t.mt(), t.m(5)), '42501');
select t.expect_error('a regular member cannot write attendance directly', format($q$insert into public.club_meeting_attendance (meeting_id, membership_id, status, recorded_by, recorded_by_name, membership_status_at_checkin, eligible_at_checkin) values (%L, %L, 'present_in_person', %L, 'x', 'active', true)$q$, t.mt(), t.m(5), t.u(5)), '42501');
select t.as_user(t.u(12));
select t.expect_error('another club''s treasurer cannot open this AGM dashboard', format($q$select * from public.club_meeting_dashboard(%L)$q$, t.mt()), '42501');
select t.expect_error('another club''s treasurer cannot check in this club''s members', format($q$select public.set_club_meeting_attendance(%L, %L, 'present_in_person')$q$, t.mt(), t.m(5)), '42501');
select t.as_user(t.u(4));
select t.expect_eq('the vice president can view the AGM dashboard', (select count(*) from public.club_meeting_dashboard(t.mt())), 8::bigint);
select t.expect_error('the vice president cannot check members in', format($q$select public.set_club_meeting_attendance(%L, %L, 'present_in_person')$q$, t.mt(), t.m(5)), '42501');
select t.as_user(t.u(3));
select t.expect_error('check-in only for members of this meeting', format($q$select public.set_club_meeting_attendance(%L, %L, 'present_in_person')$q$, t.mt(), t.m(13)), '22023');
select public.set_club_meeting_attendance(t.mt(), t.m(6), 'present_video');
select public.set_club_meeting_attendance(t.mt(), t.m(6), 'present_in_person');
select public.set_club_meeting_attendance(t.mt(), t.m(7), 'present_in_person');
select t.expect_eq('check-in does not overwrite the RSVP (Bo never answered; Cy said In Person)',
  (select coalesce(response, 'none') || '/' || attendance from public.club_meeting_dashboard(t.mt()) where full_name = 'Bo') || ' ' ||
  (select response || '/' || attendance from public.club_meeting_dashboard(t.mt()) where full_name = 'Cy'), 'none/present_in_person in_person/present_in_person');
select t.expect_eq('check-in records who and when, and eligibility at that moment',
  (select format('%s|%s|%s', attendance_recorded_by, attendance_recorded_at is not null, eligible_at_checkin) from public.club_meeting_dashboard(t.mt()) where full_name = 'Cy'), 'Person 63|t|f');
select t.as_admin();
select t.expect_eq('every check-in change is in the attendance history', (select string_agg(coalesce(previous_status,'-') || '>' || new_status, ',' order by id) from public.club_meeting_attendance_history where membership_id = t.m(6)), '->present_video,present_video>present_in_person');
select t.expect_error('attendance history cannot be edited', 'update public.club_meeting_attendance_history set new_status = ''absent''', '42501');
select t.expect_error('RSVP history cannot be removed', 'delete from public.club_meeting_rsvp_history', '42501');

-- ================================================================ 7. saved AGM record does not change later
select t.as_user(t.u(4));
select t.expect_error('the vice president cannot save the official record', format($q$select public.record_club_meeting_snapshot(%L)$q$, t.mt()), '42501');
select t.as_user(t.u(1));
select public.record_club_meeting_snapshot(t.mt());
select public.set_club_membership_status(t.m(10), 'inactive', 'after the AGM');
select t.expect_eq('a later membership change does not alter the saved record',
  (select e ->> 'eligible' from public.club_meeting_records(t.mt()) r, jsonb_array_elements(r.snapshot -> 'members') e where e ->> 'full_name' = 'Fay'), 'true');
select t.expect_eq('the saved record lists the active proxies', (select jsonb_array_length(snapshot -> 'proxies') from public.club_meeting_records(t.mt())), 2);
select t.as_admin();
select t.expect_error('saved records cannot be edited (even by the owner)', 'update public.club_meeting_records set snapshot = ''{}''', '42501');

-- ================================================================ 8. after the meeting starts
update public.club_meetings set starts_at = now() - interval '1 minute' where id = t.mt();
select t.as_user(t.u(5));
select t.expect_error('answers cannot change once the meeting has started', format($q$select public.set_club_meeting_rsvp(%L, 'video')$q$, t.mt()), '22023');
select t.expect_error('proxies cannot be cancelled once the meeting has started', format($q$select public.cancel_club_meeting_proxy(%L)$q$, t.mt()), '22023');
select t.as_user(t.u(3));
select public.set_club_meeting_attendance(t.mt(), t.m(5), 'absent');
select t.ok('check-in still works during the meeting');
select t.as_anon();
select t.expect_error('anonymous callers cannot read meetings', 'select count(*) from public.club_meetings', '42501');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'CLUB AGM GATE PASSED % checks', n; end $$;
rollback;
