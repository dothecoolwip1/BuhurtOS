-- Club membership gate: Red Deer Reavers membership, annual dues, voting eligibility and executive offices
-- (migration 20261013000100_club_membership_dues_voting.sql).
--   * only the club's CURRENT President, Secretary or Treasurer can change dues or membership status; authority follows the office, not the person
--   * regular members, other executives, other teams' officers, organization admins of other organizations and anonymous callers are refused
--     by the database (42501), including direct table writes through the API roles
--   * eligibility is calculated (active + 18 or older + dues satisfied) and cannot be written by anyone
--   * every dues change leaves an append-only history row
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/club_membership_gate.sql
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
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c1b' || n, 12, '0'))::uuid $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- Reavers (R) and Other Team (O).
-- u1 President R, u2 Secretary R, u3 Treasurer R, u4 Vice President R (executive WITHOUT dues authority), u5 regular member R,
-- u6 Treasurer of O and captain of O, u7 pending applicant R, u8 platform owner, u9 next year's Treasurer R, u10 under-18 applicant R,
-- u11 stranger, u12 admin of an organization R is NOT in, u13 captain of R (no office).
insert into auth.users (id, email) select t.u(n), 'club' || n || '@example.test' from generate_series(1, 13) n;
update public.profiles set display_name = 'Person ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 13) n);
insert into public.platform_roles (user_id, role) values (t.u(8), 'owner');
insert into public.teams (id, slug, name, status) values
  ('00000000-0000-0000-0000-0000000c1b0a', 'club-gate-reavers', 'Gate Reavers', 'approved'),
  ('00000000-0000-0000-0000-0000000c1b0b', 'club-gate-other', 'Gate Other', 'approved');
create function t.r() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000c1b0a'::uuid $$;
create function t.o() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000c1b0b'::uuid $$;
grant execute on function t.r(), t.o() to anon, authenticated;
insert into public.team_roles (team_id, user_id, role) values (t.o(), t.u(6), 'captain'), (t.r(), t.u(13), 'captain');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-0000000c1b0c', 'club-gate-org', 'Gate Org', 'club');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000c1b0c', t.u(12), 'admin');
insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents) values
  (t.r(), extract(year from current_date)::int, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 2000),
  (t.o(), extract(year from current_date)::int, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 5000);
create function t.y() returns int language sql stable as $$ select extract(year from current_date)::int $$;
grant execute on function t.y() to anon, authenticated;
create table t.ids (k text primary key, id uuid);
grant all on t.ids to anon, authenticated;
create function t.id(k text) returns uuid language sql stable as $$ select id from t.ids where ids.k = $1 $$;
grant execute on function t.id(text) to anon, authenticated;
-- the current term of an office, read as the table owner (the caller's own RLS view would hide other people's terms)
create function t.officer(p_office text) returns uuid language sql stable security definer as $$ select id from public.team_officers where team_id = t.r() and office = p_office and ended_on is null $$;
grant execute on function t.officer(text) to anon, authenticated;

-- ================================================================ 1. executive offices
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot give themselves an executive role (RPC)', format($q$select public.assign_team_officer(%L, 'club5@example.test', 'treasurer')$q$, t.r()), '42501');
select t.expect_error('a regular member cannot give themselves an executive role (direct insert)', format($q$insert into public.team_officers (team_id, user_id, office) values (%L, %L, 'president')$q$, t.r(), t.u(5)), '42501');
select t.as_user(t.u(13));
select t.expect_error('the team captain is not an executive and cannot assign offices', format($q$select public.assign_team_officer(%L, 'club13@example.test', 'president')$q$, t.r()), '42501');
select t.as_user(t.u(12));
select t.expect_error('an admin of an organization the club is not in cannot assign its offices', format($q$select public.assign_team_officer(%L, 'club12@example.test', 'president')$q$, t.r()), '42501');
select t.as_user(t.u(8));
select public.assign_team_officer(t.r(), 'club1@example.test', 'president', 'elected at AGM');
select public.assign_team_officer(t.o(), 'club6@example.test', 'treasurer');
select t.ok('the platform owner records the first president');
select t.as_user(t.u(1));
select public.assign_team_officer(t.r(), 'CLUB2@example.test', 'secretary');
select public.assign_team_officer(t.r(), 'club3@example.test', 'treasurer');
select public.assign_team_officer(t.r(), 'club4@example.test', 'vice_president');
select t.ok('the president records the other offices');
select t.expect_error('one person cannot hold the same office twice', format($q$select public.assign_team_officer(%L, 'club3@example.test', 'treasurer')$q$, t.r()), '23505');
select t.expect_error('an unknown office is refused', format($q$select public.assign_team_officer(%L, 'club5@example.test', 'emperor')$q$, t.r()), '22023');
select t.as_user(t.u(3));
select t.expect_error('the treasurer cannot assign offices', format($q$select public.assign_team_officer(%L, 'club5@example.test', 'director')$q$, t.r()), '42501');
select t.as_user(t.u(4));
select t.expect_error('the vice president cannot assign offices', format($q$select public.assign_team_officer(%L, 'club4@example.test', 'treasurer')$q$, t.r()), '42501');
select t.as_user(t.u(6));
select t.expect_error('another team''s treasurer cannot assign this club''s offices', format($q$select public.assign_team_officer(%L, 'club6@example.test', 'president')$q$, t.r()), '42501');
select t.as_user(t.u(1));
select t.expect_eq('the president sees four current officers', (select count(*) from public.list_team_officers(t.r())), 4::bigint);
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot list the officers with emails', format($q$select * from public.list_team_officers(%L)$q$, t.r()), '42501');
select t.expect_eq('a regular member sees no office rows directly', (select count(*) from public.team_officers), 0::bigint);
select t.as_user(t.u(3));
select t.expect_eq('the treasurer sees only their own office row directly', (select count(*) from public.team_officers), 1::bigint);

-- ================================================================ 2. applying
select t.as_anon();
select t.expect_error('anonymous callers cannot apply', format($q$select public.apply_for_club_membership(%L, %s, 'Anon', null, null, true, true)$q$, t.r(), t.y()), '42501');
select t.as_user(t.u(5));
select t.expect_error('applying needs the bylaws agreement', format($q$select public.apply_for_club_membership(%L, %s, 'Regular Member', null, null, true, false)$q$, t.r(), t.y()), '22023');
select t.expect_error('applying needs a date of birth or the 18+ confirmation', format($q$select public.apply_for_club_membership(%L, %s, 'Regular Member', null, null, false, true)$q$, t.r(), t.y()), '22023');
select t.expect_error('a membership year that does not exist is refused', format($q$select public.apply_for_club_membership(%L, 1999, 'Regular Member', null, null, true, true)$q$, t.r()), 'P0002');
insert into t.ids values ('m5', public.apply_for_club_membership(t.r(), t.y(), 'Regular Member', 'regular#1', null, true, true));
select t.as_user(t.u(7));
insert into t.ids values ('m7', public.apply_for_club_membership(t.r(), t.y(), 'Pending Applicant', null, (current_date - interval '30 years')::date, false, true));
select t.as_user(t.u(10));
insert into t.ids values ('m10', public.apply_for_club_membership(t.r(), t.y(), 'Young Applicant', null, (current_date - interval '16 years')::date, false, true));
select t.as_user(t.u(3));
insert into t.ids values ('m3', public.apply_for_club_membership(t.r(), t.y(), 'Treasurer Person', null, null, true, true));
select t.as_user(t.u(6));
insert into t.ids values ('m6', public.apply_for_club_membership(t.o(), t.y(), 'Other Team Treasurer', null, null, true, true));
select t.as_admin();
select t.expect_eq('a new application is pending with dues unpaid', (select m.status || '/' || d.status from public.club_memberships m join public.club_dues d on d.membership_id = m.id where m.id = t.id('m5')), 'pending/unpaid');
select t.expect_eq('applying writes no dues history', (select count(*) from public.club_dues_history), 0::bigint);

-- ================================================================ 3. a regular member cannot change dues, status or eligibility
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot change their own dues (RPC)', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('a regular member cannot change dues directly', format($q$update public.club_dues set status = 'paid' where membership_id = %L$q$, t.id('m5')), '42501');
select t.expect_error('a regular member cannot insert a dues record directly', format($q$insert into public.club_dues (membership_id, status) values (%L, 'paid')$q$, t.id('m7')), '42501');
select t.expect_error('a regular member cannot approve themselves (RPC)', format($q$select public.set_club_membership_status(%L, 'active')$q$, t.id('m5')), '42501');
select t.expect_error('a regular member cannot approve themselves directly', format($q$update public.club_memberships set status = 'active' where id = %L$q$, t.id('m5')), '42501');
select t.expect_error('a regular member cannot insert a membership directly', format($q$insert into public.club_memberships (team_id, membership_year, user_id, status, full_name, adult_confirmed, bylaws_agreed_at) values (%L, %s, %L, 'active', 'X Y', true, now())$q$, t.r(), t.y(), t.u(5)), '42501');
select t.expect_error('a regular member cannot write dues history', format($q$insert into public.club_dues_history (membership_id, team_id, membership_year, member_name, new_status, changed_by, changed_by_name, changed_by_office) values (%L, %L, %s, 'x', 'paid', %L, 'x', 'Treasurer')$q$, t.id('m5'), t.r(), t.y(), t.u(5)), '42501');
select t.expect_error('a regular member cannot read dues history directly', 'select count(*) from public.club_dues_history', '42501');
select t.expect_error('a regular member cannot read dues history through the RPC', format($q$select * from public.club_dues_history(%L)$q$, t.r()), '42501');
select t.expect_error('a regular member cannot see the roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.r(), t.y()), '42501');
select t.expect_error('a regular member cannot open a membership year', format($q$select public.set_club_membership_year(%L, 2099, 0, '2099-01-01', '2099-12-31', true)$q$, t.r()), '42501');
select t.expect_eq('a regular member reads only their own membership row', (select count(*) from public.club_memberships), 1::bigint);
select t.expect_eq('a regular member reads only their own dues row', (select count(*) from public.club_dues), 1::bigint);
select t.expect_eq('voting eligibility is not a column anyone could write', (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'club_%' and column_name ilike '%elig%'), 0::bigint);
select t.expect_error('a regular member cannot call the eligibility rule directly', format($q$select * from private.club_vote_check(%L)$q$, t.id('m5')), '42501');
select t.expect_eq('the overview shows a regular member only their own record and no powers',
  (select format('%s/%s/%s/%s', jsonb_array_length(o -> 'memberships'), o ->> 'can_view_roster', o ->> 'can_change_dues', o -> 'memberships' -> 0 ->> 'status')
   from (select public.club_membership_overview(t.r()) o) x), '1/false/false/pending');
select t.expect_eq('the overview explains why a pending applicant cannot vote',
  (select (o -> 'memberships' -> 0 -> 'reasons')::text from (select public.club_membership_overview(t.r()) o) x), '["Membership pending approval", "Dues unpaid"]');
select t.as_user(t.u(13));
select t.expect_error('the club captain without an office cannot change dues', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('the club captain without an office cannot see the roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.r(), t.y()), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot change dues', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('anonymous callers cannot read memberships', 'select count(*) from public.club_memberships', '42501');
select t.expect_eq('anonymous callers can read the published dues amount', (select dues_cents from public.club_membership_years where team_id = t.r()), 2000);

-- ================================================================ 4. other teams and executives without dues authority
select t.as_user(t.u(6));
select t.expect_error('another team''s treasurer cannot change this club''s dues', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('another team''s treasurer cannot approve this club''s members', format($q$select public.set_club_membership_status(%L, 'active')$q$, t.id('m5')), '42501');
select t.expect_error('another team''s treasurer cannot see this club''s roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.r(), t.y()), '42501');
select t.expect_error('another team''s treasurer cannot see this club''s dues history', format($q$select * from public.club_dues_history(%L)$q$, t.r()), '42501');
select t.expect_eq('another team''s treasurer sees only their own team''s roster', (select count(*) from public.club_member_roster(t.o(), t.y())), 1::bigint);
select t.as_user(t.u(4));
select t.expect_eq('the vice president can see the roster', (select count(*) from public.club_member_roster(t.r(), t.y())), 4::bigint);
select t.expect_error('the vice president cannot change dues', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('the vice president cannot approve members', format($q$select public.set_club_membership_status(%L, 'active')$q$, t.id('m5')), '42501');
select t.expect_error('the vice president cannot open a membership year', format($q$select public.set_club_membership_year(%L, 2099, 0, '2099-01-01', '2099-12-31', true)$q$, t.r()), '42501');
select t.as_user(t.u(8));
select t.expect_error('the platform owner is not a club officer: no dues changes', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.expect_error('the platform owner is not a club officer: no roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.r(), t.y()), '42501');

-- ================================================================ 5. President, Secretary and Treasurer can each change dues
select t.as_user(t.u(2));
select public.set_club_membership_status(t.id('m5'), 'active', 'approved at meeting');
select public.set_club_dues(t.id('m5'), 'paid', null, 'cash');
select t.ok('the secretary approves a member and records dues');
select t.as_user(t.u(1));
select public.set_club_dues(t.id('m7'), 'waived', null, 'hardship');
select t.ok('the president can change dues');
select t.as_user(t.u(3));
select public.set_club_dues(t.id('m7'), 'gear_contribution', 4500, 'donated a helmet');
select public.set_club_membership_status(t.id('m3'), 'active');
select public.set_club_dues(t.id('m3'), 'paid', 2000);
select t.ok('the treasurer can change dues (including their own, which is recorded)');
select t.expect_error('the same dues again is refused as nothing changed', format($q$select public.set_club_dues(%L, 'paid', 2000)$q$, t.id('m3')), '22023');
select t.expect_error('an unknown dues status is refused', format($q$select public.set_club_dues(%L, 'bribed')$q$, t.id('m3')), '22023');
select t.as_admin();
select t.expect_eq('paid with no amount records the year''s normal dues', (select amount_cents from public.club_dues where membership_id = t.id('m5')), 2000);
select t.expect_eq('waived carries no amount', (select count(*) from public.club_dues_history where membership_id = t.id('m7') and new_status = 'waived' and new_amount_cents is null), 1::bigint);
select t.expect_eq('dues record who changed it', (select changed_by from public.club_dues where membership_id = t.id('m7')), t.u(3));

-- ================================================================ 6. audit history
select t.expect_eq('every dues change created one history row', (select count(*) from public.club_dues_history where team_id = t.r()), 4::bigint);
select t.expect_eq('history records member, previous and new status, year, executive and office',
  (select format('%s|%s|%s|%s|%s|%s|%s', member_name, previous_status, new_status, membership_year = t.y(), changed_by = t.u(2), changed_by_office, note)
   from public.club_dues_history where membership_id = t.id('m5')), 'Regular Member|unpaid|paid|t|t|Secretary|cash');
select t.expect_eq('history keeps the chain unpaid -> waived -> gear contribution',
  (select string_agg(coalesce(previous_status, '-') || '>' || new_status, ',' order by id) from public.club_dues_history where membership_id = t.id('m7')), 'unpaid>waived,waived>gear_contribution');
select t.expect_error('history cannot be edited, even by the table owner', 'update public.club_dues_history set new_status = ''unpaid''', '42501');
select t.expect_error('history cannot be removed, even by the table owner', 'delete from public.club_dues_history', '42501');
select t.as_user(t.u(3));
select t.expect_error('an executive cannot edit history directly', 'update public.club_dues_history set note = ''x''', '42501');
select t.expect_error('an executive cannot remove history directly', 'delete from public.club_dues_history', '42501');
select t.expect_eq('the treasurer reads the club''s history through the RPC', (select count(*) from public.club_dues_history(t.r(), t.y())), 4::bigint);
select t.as_user(t.u(4));
select t.expect_eq('the vice president can read the history', (select count(*) from public.club_dues_history(t.r())), 4::bigint);
select t.as_admin();
select t.expect_eq('dues changes are also in the general audit log', (select count(*) from public.audit_log where action = 'club.dues_changed'), 4::bigint);

-- ================================================================ 7. voting eligibility
select t.as_user(t.u(1));
select t.expect_eq('active + adult + paid = eligible', (select eligible from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m5')), true);
select t.expect_eq('pending member with an approved gear contribution is not eligible',
  (select reasons from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m7')), array['Membership pending approval']);
select public.set_club_membership_status(t.id('m7'), 'active');
select t.expect_eq('active + adult + gear contribution = eligible', (select eligible from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m7')), true);
select public.set_club_dues(t.id('m7'), 'waived');
select t.expect_eq('active + adult + waived = eligible', (select eligible from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m7')), true);
select public.set_club_dues(t.id('m7'), 'unpaid', null, 'waiver withdrawn');
select t.expect_eq('unpaid dues: not eligible, reason Dues unpaid', (select reasons from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m7')), array['Dues unpaid']);
select public.set_club_membership_status(t.id('m10'), 'active');
select public.set_club_dues(t.id('m10'), 'paid');
select t.expect_eq('under 18: not eligible, reason Under 18', (select reasons from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m10')), array['Under 18']);
select t.expect_eq('the roster shows 18+ / under 18 but never a date of birth', (select is_adult from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m10')), false);
select t.expect_eq('ages are counted at the AGM date of an AGM snapshot', (select eligible from public.club_member_roster(t.r(), t.y(), (current_date + interval '3 years')::date) where membership_id = t.id('m10')), true);
select public.set_club_membership_status(t.id('m5'), 'inactive', 'moved away');
select t.expect_eq('inactive: not eligible, reason Membership inactive', (select reasons from public.club_member_roster(t.r(), t.y()) where membership_id = t.id('m5')), array['Membership inactive']);
select public.set_club_membership_status(t.id('m5'), 'active');
select t.as_admin();
select t.expect_eq('reading the roster or AGM snapshot changes nothing', (select count(*) from public.club_dues_history) || '/' || (select count(*) from public.club_memberships), '7/5');
select t.as_user(t.u(5));
select t.expect_error('an active member cannot re-apply to reset their own record', format($q$select public.apply_for_club_membership(%L, %s, 'Regular Member', null, null, true, true)$q$, t.r(), t.y()), '23505');
select t.expect_eq('the member sees their own eligibility', (select (o -> 'memberships' -> 0 ->> 'eligible') from (select public.club_membership_overview(t.r()) o) x), 'true');
select t.as_user(t.u(3));
select t.expect_eq('an officer sees their office in their own overview', (select o -> 'offices' -> 0 ->> 'label' from (select public.club_membership_overview(t.r()) o) x), 'Treasurer');

-- ================================================================ 8. office changes move the permission
select t.as_user(t.u(1));
select public.end_team_officer(t.officer('treasurer'), 'stepped down');
select t.as_user(t.u(3));
select t.expect_error('removing the treasurer role removes the permission at once', format($q$select public.set_club_dues(%L, 'waived')$q$, t.id('m5')), '42501');
select t.expect_error('a former treasurer can no longer see the roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.r(), t.y()), '42501');
select t.as_user(t.u(9));
select t.expect_error('before being assigned, the new treasurer cannot change dues', format($q$select public.set_club_dues(%L, 'waived')$q$, t.id('m5')), '42501');
select t.as_user(t.u(2));
select public.assign_team_officer(t.r(), 'club9@example.test', 'treasurer', 'elected');
select t.as_user(t.u(9));
select public.set_club_dues(t.id('m5'), 'waived', null, 'new treasurer');
select t.ok('assigning the treasurer role grants the permission');
-- Reassigning an office ends the previous holder's term automatically.
select t.as_user(t.u(1));
select public.assign_team_officer(t.r(), 'club3@example.test', 'treasurer', 'returns');
select t.as_user(t.u(9));
select t.expect_error('when a new treasurer is assigned, the previous one loses the permission', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m5')), '42501');
select t.as_user(t.u(3));
select public.set_club_dues(t.id('m5'), 'paid');
select t.ok('the newly assigned treasurer has the permission');
select t.as_admin();
select t.expect_eq('only one current treasurer at a time', (select count(*) from public.team_officers where team_id = t.r() and office = 'treasurer' and ended_on is null), 1::bigint);
select t.expect_eq('past terms are kept as history', (select count(*) from public.team_officers where team_id = t.r() and office = 'treasurer'), 3::bigint);
select t.expect_eq('history records the office that authorised each change', (select changed_by_office from public.club_dues_history where note = 'new treasurer'), 'Treasurer');
select t.expect_error('a second current treasurer cannot be inserted even by the owner', format($q$insert into public.team_officers (team_id, user_id, office) values (%L, %L, 'treasurer')$q$, t.r(), t.u(11)), '23505');
select t.as_user(t.u(1));
select public.end_team_officer(t.officer('secretary'));
select t.as_user(t.u(2));
select t.expect_error('a former secretary cannot change dues', format($q$select public.set_club_dues(%L, 'unpaid')$q$, t.id('m5')), '42501');
select t.expect_error('a former secretary cannot assign offices', format($q$select public.assign_team_officer(%L, 'club2@example.test', 'secretary')$q$, t.r()), '42501');
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot end an executive term', format($q$select public.end_team_officer(%L)$q$, t.officer('president')), '42501');

-- ================================================================ 9. tenant isolation of the other team's records
select t.as_user(t.u(3));
select t.expect_error('this club''s treasurer cannot change the other team''s dues', format($q$select public.set_club_dues(%L, 'paid')$q$, t.id('m6')), '42501');
select t.expect_error('this club''s treasurer cannot see the other team''s roster', format($q$select * from public.club_member_roster(%L, %s)$q$, t.o(), t.y()), '42501');
select t.as_user(t.u(6));
select public.set_club_dues(t.id('m6'), 'paid');
select t.expect_eq('the other team''s dues use their own amount', (select dues_amount_cents from public.club_member_roster(t.o(), t.y())), 5000);

-- ================================================================ 10. member profile links (migration 20261018001100) and a member's own link
-- Only the club's executive sees which memberships have a fighter profile; a member learns only their own (my_fighter_id, auth.uid() only).
select t.as_admin();
insert into public.fighters (id, display_name) values ('00000000-0000-0000-0000-0000000c1bf5', 'Regular Member Fighter');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-0000000c1bf5', t.u(5));
select t.as_anon();
select t.expect_error('anonymous callers cannot read member profile links', format($q$select * from public.club_member_profile_links(%L, %s)$q$, t.r(), t.y()), '42501');
select t.as_user(t.u(5));
select t.expect_error('a regular member cannot read member profile links', format($q$select * from public.club_member_profile_links(%L, %s)$q$, t.r(), t.y()), '42501');
select t.expect_eq('a member learns their own fighter profile', public.my_fighter_id(), '00000000-0000-0000-0000-0000000c1bf5'::uuid);
select t.expect_eq('a member sees only their own account link row', (select count(*) from public.fighter_accounts), 1::bigint);
select t.as_user(t.u(7));
select t.expect_eq('a member without a fighter profile gets none (never someone else''s)', public.my_fighter_id(), null::uuid);
select t.expect_eq('a member without a fighter profile sees no account link rows', (select count(*) from public.fighter_accounts), 0::bigint);
select t.as_user(t.u(6));
select t.expect_error('another team''s treasurer cannot read this club''s profile links', format($q$select * from public.club_member_profile_links(%L, %s)$q$, t.r(), t.y()), '42501');
select t.as_user(t.u(3));
select t.expect_eq('the treasurer sees the linked member''s fighter profile', (select fighter_id from public.club_member_profile_links(t.r(), t.y()) where membership_id = t.id('m5')), '00000000-0000-0000-0000-0000000c1bf5'::uuid);
select t.expect_eq('the treasurer sees no fighter profile for an unlinked member', (select fighter_id from public.club_member_profile_links(t.r(), t.y()) where membership_id = t.id('m7')), null::uuid);
select t.expect_eq('profile links cover exactly the roster', (select count(*) from public.club_member_profile_links(t.r(), t.y())), (select count(*) from public.club_member_roster(t.r(), t.y())));

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'CLUB MEMBERSHIP GATE PASSED % checks', n; end $$;
rollback;
