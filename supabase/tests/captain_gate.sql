-- Captain authority gate: who may read the captain inbox, answer join requests and edit a team, and who may not.
-- Plays a regular fighter (including one whose team HISTORY says captain), the captain of team A, the captain of team B, a captain of a
-- team still awaiting approval, a platform organizer and the owner against the schema. Fictional '-test' names only.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/captain_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);

create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;

-- expect_ok / expect_error run a statement and compare the outcome. SQLSTATE can be left null to accept any error.
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise exception 'FAIL (unexpected error %: %): %', sqlstate, sqlerrm, label; end;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;



-- ---------------------------------------------------------------- fixtures (as the database owner)
-- c1 owner, c2 platform organizer, c3 captain of A, c4 captain of B, c5 regular fighter (history says captain), c6 requester one,
-- c7 requester two, c8 stranger, c9 captain of a team still awaiting approval.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner-test@example.test'),   ('00000000-0000-0000-0000-0000000000c2', 'organizer-test@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'captain-a-test@example.test'), ('00000000-0000-0000-0000-0000000000c4', 'captain-b-test@example.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'fighter-test@example.test'),  ('00000000-0000-0000-0000-0000000000c6', 'joiner-one-test@example.test'),
  ('00000000-0000-0000-0000-0000000000c7', 'joiner-two-test@example.test'), ('00000000-0000-0000-0000-0000000000c8', 'stranger-test@example.test'),
  ('00000000-0000-0000-0000-0000000000c9', 'captain-p-test@example.test');
update public.profiles set display_name = v.n from (values
  ('00000000-0000-0000-0000-0000000000c6'::uuid, 'Joiner One-test'), ('00000000-0000-0000-0000-0000000000c7', 'Joiner Two-test'),
  ('00000000-0000-0000-0000-0000000000c8', 'Stranger-test')) v(id, n) where public.profiles.id = v.id;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'owner'), ('00000000-0000-0000-0000-0000000000c2', 'organizer');
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-0000000000d1', 'team-a-test', 'Team A-test', 'approved', 'Red Deer', 'CA'),
  ('00000000-0000-0000-0000-0000000000d2', 'team-b-test', 'Team B-test', 'approved', 'Calgary', 'CA'),
  ('00000000-0000-0000-0000-0000000000d3', 'team-p-test', 'Team P-test', 'pending', 'Banff', 'CA');
insert into public.team_roles (team_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3', 'captain'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c4', 'captain'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c9', 'captain');
-- The regular fighter: home team A, and a HISTORICAL sporting role of captain on A. No team_roles row: no authority.
insert into public.fighters (id, display_name, team_id) values ('00000000-0000-0000-0000-0000000000e1', 'Abel Coil-test', '00000000-0000-0000-0000-0000000000d1');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c5');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'captain', '2018-01-01');
create temp table gt (k text primary key, v text);
grant all on gt to authenticated;

-- two pending requests: joiner one asks team A and team B, joiner two asks team A
select t.as_user('00000000-0000-0000-0000-0000000000c6');
insert into gt select 'r1_a', public.request_team_join('00000000-0000-0000-0000-0000000000d1', 'One for A (test)');
insert into gt select 'r1_b', public.request_team_join('00000000-0000-0000-0000-0000000000d2', 'One for B (test)');
select t.as_user('00000000-0000-0000-0000-0000000000c7');
insert into gt select 'r2_a', public.request_team_join('00000000-0000-0000-0000-0000000000d1', 'Two for A (test)');

-- ---------------------------------------------------------------- team_roles is row-scoped by RLS (the client query has no user filter)
select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.expect_eq('captain A reads exactly one team_roles row (their own)', (select count(*) from public.team_roles), 1::bigint);
select t.expect_eq('captain A reads no team_roles row for team B', (select count(*) from public.team_roles where team_id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint);
select t.expect_eq('the client lookup (captain rows) returns only team A for captain A', (select array_agg(team_id) from public.team_roles where role = 'captain'), array['00000000-0000-0000-0000-0000000000d1'::uuid]);
select t.expect_error('captain A cannot add a captain row directly', $q$insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c3', 'captain')$q$, '42501');
select t.expect_error('captain A cannot edit a captain row directly', $q$update public.team_roles set user_id = '00000000-0000-0000-0000-0000000000c8'$q$, '42501');
select t.expect_error('captain A cannot delete a captain row directly', $q$delete from public.team_roles$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000c5');
select t.expect_eq('regular fighter: the captain lookup returns nothing', (select count(*) from public.team_roles where role = 'captain'), 0::bigint);
select t.expect_eq('regular fighter: sees no team_roles row at all', (select count(*) from public.team_roles), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c8');
select t.expect_eq('stranger: sees no team_roles row at all', (select count(*) from public.team_roles), 0::bigint);

-- ---------------------------------------------------------------- regular fighter whose team HISTORY says captain: no authority
select t.as_user('00000000-0000-0000-0000-0000000000c5');
select t.expect_eq('history captain: can_edit_team(A) is false', public.can_edit_team('00000000-0000-0000-0000-0000000000d1'), false);
select t.expect_eq('history captain: can_rename_team(A) is false', public.can_rename_team('00000000-0000-0000-0000-0000000000d1'), false);
select t.expect_eq('history captain: the inbox is empty although requests wait on their own team', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_error('history captain cannot approve a request for their own team', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from gt where k = 'r1_a')), '42501');
select t.expect_error('history captain cannot decline a request for their own team', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r1_a')), '42501');
select t.expect_error('regular fighter cannot approve a request for another team', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from gt where k = 'r1_b')), '42501');
select t.expect_error('regular fighter cannot decline a request for another team', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r1_b')), '42501');
select t.expect_error('regular fighter cannot decide a request that does not exist', $q$select public.decide_team_join(gen_random_uuid(), 'approved')$q$, '42501');
select t.expect_error('history captain cannot edit their team page', $q$select public.update_team_profile('00000000-0000-0000-0000-0000000000d1', '{"description":"Taken over by a fighter."}')$q$, '42501');
select t.expect_error('regular fighter cannot edit another team page', $q$select public.update_team_profile('00000000-0000-0000-0000-0000000000d2', '{"description":"Taken over by a fighter."}')$q$, '42501');
select t.expect_error('history captain cannot set the emblem', $q$select public.set_team_emblem('00000000-0000-0000-0000-0000000000d1', null)$q$, '42501');
select t.expect_error('history captain cannot upload into the team emblem folder', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', '00000000-0000-0000-0000-0000000000d1/1700000000001.png')$q$);
select t.expect_error('regular fighter cannot name a captain', $q$select public.assign_team_captain('00000000-0000-0000-0000-0000000000d1', 'fighter-test@example.test')$q$, '42501');
select t.expect_error('regular fighter cannot approve a team', $q$select public.approve_team('00000000-0000-0000-0000-0000000000d3')$q$);
select t.expect_error('regular fighter cannot write the team table directly', $q$update public.teams set description = 'direct write' where id = '00000000-0000-0000-0000-0000000000d1'$q$, '42501');
select t.expect_ok('regular fighter''s edit of a membership row is filtered out by RLS (no error, no row)', $q$update public.team_memberships set role = 'coach'$q$);
select t.expect_error('regular fighter cannot add a membership row to a team', $q$insert into public.team_memberships (fighter_id, team_id, role) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d2', 'captain')$q$, '42501');
select t.expect_error('regular fighter cannot read the private new-team details', $q$select * from public.new_team_request_details('00000000-0000-0000-0000-0000000000d3')$q$);
select t.as_admin();
select t.expect_eq('after every attempt the requests are still pending', (select count(*) from public.team_join_requests where status = 'pending'), 3::bigint);
select t.expect_eq('after every attempt the fighter still holds no captain role', (select count(*) from public.team_roles where user_id = '00000000-0000-0000-0000-0000000000c5'), 0::bigint);
select t.expect_eq('after every attempt the membership row is unchanged', (select role from public.team_memberships where fighter_id = '00000000-0000-0000-0000-0000000000e1' and team_id = '00000000-0000-0000-0000-0000000000d1'), 'captain');
select t.expect_eq('after every attempt the team page is unchanged', (select coalesce(description, '') from public.teams where id = '00000000-0000-0000-0000-0000000000d1'), '');

-- ---------------------------------------------------------------- captain of A: inbox and decisions are scoped to team A
select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.expect_eq('captain A sees the two requests for team A', (select count(*) from public.team_requests_inbox()), 2::bigint);
select t.expect_eq('captain A sees none for team B', (select count(*) from public.team_requests_inbox() where team_id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint);
select t.expect_eq('captain A can edit team A', public.can_edit_team('00000000-0000-0000-0000-0000000000d1'), true);
select t.expect_eq('captain A cannot edit team B', public.can_edit_team('00000000-0000-0000-0000-0000000000d2'), false);
select t.expect_error('captain A cannot approve a request for team B', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from gt where k = 'r1_b')), '42501');
select t.expect_error('captain A cannot decline a request for team B', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r1_b')), '42501');
select t.expect_error('captain A cannot edit team B', $q$select public.update_team_profile('00000000-0000-0000-0000-0000000000d2', '{"description":"Not my team at all."}')$q$, '42501');
select t.expect_error('captain A cannot set the emblem of team B', $q$select public.set_team_emblem('00000000-0000-0000-0000-0000000000d2', null)$q$, '42501');
select t.expect_error('captain A cannot upload into the folder of team B', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', '00000000-0000-0000-0000-0000000000d2/1700000000002.png')$q$);
select t.expect_error('captain A cannot add a membership row to team B', $q$insert into public.team_memberships (fighter_id, team_id, role) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d2', 'fighter')$q$, '42501');
select t.expect_error('captain A cannot name a captain for their own team', $q$select public.assign_team_captain('00000000-0000-0000-0000-0000000000d1', 'stranger-test@example.test')$q$, '42501');
select t.expect_ok('captain A approves joiner one for team A', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from gt where k = 'r1_a')));
select t.expect_ok('captain A declines joiner two for team A', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r2_a')));
select t.expect_error('an answered request cannot be answered twice', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r1_a')), '22023');
select t.expect_eq('captain A inbox is empty after answering both', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_ok('captain A edits the team A page', $q$select public.update_team_profile('00000000-0000-0000-0000-0000000000d1', '{"description":"Team A-test trains on Tuesdays."}')$q$);
select t.as_admin();
select t.expect_eq('approval put joiner one on the roster of A as a plain fighter', (select m.role from public.team_memberships m join public.fighter_accounts fa on fa.fighter_id = m.fighter_id where fa.user_id = '00000000-0000-0000-0000-0000000000c6' and m.team_id = '00000000-0000-0000-0000-0000000000d1'), 'fighter');
select t.expect_eq('approval did NOT make joiner one a captain', (select count(*) from public.team_roles where user_id = '00000000-0000-0000-0000-0000000000c6'), 0::bigint);
select t.expect_eq('declining put joiner two on no team', (select count(*) from public.team_memberships m join public.fighter_accounts fa on fa.fighter_id = m.fighter_id where fa.user_id = '00000000-0000-0000-0000-0000000000c7'), 0::bigint);
select t.expect_eq('the request for team B was never touched by captain A', (select status from public.team_join_requests where id = (select v from gt where k = 'r1_b')::uuid), 'pending');
select t.expect_eq('team B page was never touched by captain A', (select coalesce(description, '') from public.teams where id = '00000000-0000-0000-0000-0000000000d2'), '');
select t.as_user('00000000-0000-0000-0000-0000000000c6');
select t.expect_eq('the approved joiner cannot edit team A', public.can_edit_team('00000000-0000-0000-0000-0000000000d1'), false);
select t.expect_eq('the approved joiner has an empty inbox', (select count(*) from public.team_requests_inbox()), 0::bigint);

-- ---------------------------------------------------------------- captain of B: sees and decides only team B
select t.as_user('00000000-0000-0000-0000-0000000000c4');
select t.expect_eq('captain B sees exactly the one request for team B', (select count(*) from public.team_requests_inbox()), 1::bigint);
select t.expect_eq('that request is for team B', (select team_slug from public.team_requests_inbox()), 'team-b-test');
select t.expect_error('captain B cannot approve something for team A', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from gt where k = 'r2_a')), '42501');
select t.expect_error('captain B cannot edit team A', $q$select public.update_team_profile('00000000-0000-0000-0000-0000000000d1', '{"description":"Not my team at all."}')$q$, '42501');
select t.expect_ok('captain B declines the request for team B', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from gt where k = 'r1_b')));

-- ---------------------------------------------------------------- a captain whose team still awaits approval
select t.as_user('00000000-0000-0000-0000-0000000000c9');
select t.expect_eq('captain of a pending team can still edit its page', public.can_edit_team('00000000-0000-0000-0000-0000000000d3'), true);
select t.expect_eq('captain of a pending team has an empty inbox', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c8');
select t.expect_error('nobody can ask to join a team that is still awaiting approval', $q$select public.request_team_join('00000000-0000-0000-0000-0000000000d3', 'let me in')$q$, 'P0002');

-- ---------------------------------------------------------------- platform authority is unchanged
select t.as_user('00000000-0000-0000-0000-0000000000c1');
select t.expect_eq('owner: can edit and rename any team', (public.can_edit_team('00000000-0000-0000-0000-0000000000d2') and public.can_rename_team('00000000-0000-0000-0000-0000000000d2')), true);
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_eq('organizer: can edit any team', public.can_edit_team('00000000-0000-0000-0000-0000000000d2'), true);
select t.expect_eq('organizer: the inbox lists only teams that have no captain', (select count(*) from public.team_requests_inbox()), 0::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
