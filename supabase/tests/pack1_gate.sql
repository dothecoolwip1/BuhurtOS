-- Pack 1 gate: competition setup is organizer-only, audited and never destroys tournament data; my_events means a direct relationship
-- (the platform owner gets nothing for free, strangers never see drafts); attendance dates come from the event's own days.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack1_gate.sql
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

-- u1 platform owner (staffs nothing); u2 organizer of E1 (draft) and E2 (published); u3 stranger; u4 fighter who registers for E2;
-- u5 scorekeeper on E2; u6 captain of Team One which has an entry in E2; u7 account linked to fighter F1 who has a duel entry in E2
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, 'p1u' || n || '@example.test' from generate_series(1, 7) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'owner'), ('00000000-0000-0000-0000-0000000000c2', 'organizer');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;

select t.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ctx select 'e1', public.create_event('p1-draft-cup', 'Pack 1 Draft Cup', date '2026-12-05', date '2026-12-06', 'Hall', 'Street');
insert into ctx select 'e2', public.create_event('p1-open', 'Pack 1 Open', date '2026-12-12', date '2026-12-13', 'Arena', 'Road');
select set_config('t.e1', (select v from ctx where k = 'e1'), false);
select set_config('t.e2', (select v from ctx where k = 'e2'), false);

-- ---------------------------------------------------------------- 1. competition setup
select t.as_anon();
select t.expect_error('anon cannot create a competition', $q$select public.create_competition(current_setting('t.e1')::uuid, 'Men 5v5', '5v5', 'men')$q$);
select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.expect_error('a stranger cannot create a competition', $q$select public.create_competition(current_setting('t.e1')::uuid, 'Men 5v5', '5v5', 'men')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ctx select 'k0', public.create_competition(current_setting('t.e1')::uuid, 'Owner test', '5v5', 'men');
select t.expect_ok('the platform owner may set up competitions on any event (existing owner rule)', 'select 1');
select t.expect_ok('and remove an unused one again', $q$select public.delete_competition((select v from ctx where k = 'k0')::uuid)$q$);

select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_error('a competition needs a real category', $q$select public.create_competition(current_setting('t.e1')::uuid, 'Odd', 'jousting', 'open')$q$, '22023');
select t.expect_error('a competition needs a division from the list', $q$select public.create_competition(current_setting('t.e1')::uuid, 'Odd', '5v5', 'mixed')$q$, '22023');
select t.expect_error('a competition needs a name', $q$select public.create_competition(current_setting('t.e1')::uuid, ' ', '5v5', 'men')$q$, '22023');
select t.expect_error('rounds to win stay within 1 to 5', $q$select public.create_competition(current_setting('t.e1')::uuid, 'Men 5v5', '5v5', 'men', null, 'round_robin', 9)$q$, '22023');
insert into ctx select 'k1', public.create_competition(current_setting('t.e1')::uuid, '  Men 5v5 ', '5v5', 'men', ' Buhurt Rules V.26.4.1 ', 'round_robin', 2);
select t.expect_ok('the organizer creates a competition', 'select 1');
select set_config('t.k1', (select v from ctx where k = 'k1'), false);
select t.expect_eq('the name and ruleset are trimmed', (select name || '|' || ruleset from public.competitions where id = current_setting('t.k1')::uuid), 'Men 5v5|Buhurt Rules V.26.4.1');
select t.expect_eq('a created competition is open for registration', (select status from public.competitions where id = current_setting('t.k1')::uuid), 'registration');
insert into ctx select 'k2', public.create_competition(current_setting('t.e1')::uuid, 'Longsword', 'longsword', 'open');
select t.expect_eq('the second competition sorts after the first', (select sort from public.competitions where id = (select v from ctx where k = 'k2')::uuid), 2);
select t.expect_eq('creation is audited', (select count(*) from public.audit_log where action = 'competition.created' and event_id = current_setting('t.e1')::uuid), 3::bigint);

select t.expect_ok('the organizer renames a competition', $q$select public.update_competition(current_setting('t.k1')::uuid, 'Men 5v5 Open', '5v5', 'men', null, 'elimination', 3)$q$);
select t.expect_eq('the update is applied', (select name || '|' || structure || '|' || rounds_to_win from public.competitions where id = current_setting('t.k1')::uuid), 'Men 5v5 Open|elimination|3');
select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.expect_error('a stranger cannot update a competition', $q$select public.update_competition(current_setting('t.k1')::uuid, 'Hijacked', '5v5', 'men', null, 'round_robin', null)$q$, '42501');
select t.expect_error('a stranger cannot delete a competition', $q$select public.delete_competition(current_setting('t.k1')::uuid)$q$, '42501');

-- the publish checklist sees the competition: E1 is a tournament with 1+ competitions now
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_eq('the organizer sees both competitions on the draft', (select count(*) from public.competitions where event_id = current_setting('t.e1')::uuid), 2::bigint);
select t.expect_ok('an unused competition can be removed', $q$select public.delete_competition((select v from ctx where k = 'k2')::uuid)$q$);
select t.expect_eq('removal is audited', (select count(*) from public.audit_log where action = 'competition.deleted'), 2::bigint);

-- dependent data: a registration that chose the competition, then entries and matches
select t.as_admin();
update public.events set status = 'published', registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '5 days' where id = current_setting('t.e2')::uuid;
insert into public.waiver_versions (event_id, version, title, body) values (current_setting('t.e2')::uuid, 1, 'Waiver', 'Text.');
select set_config('t.waiver', (select id::text from public.waiver_versions where event_id = current_setting('t.e2')::uuid), false);
select t.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ctx select 'k3', public.create_competition(current_setting('t.e2')::uuid, 'Longsword', 'longsword', 'open', 'Duels V.26.4', 'round_robin');
insert into ctx select 'k4', public.create_competition(current_setting('t.e2')::uuid, 'Men 3v3', '3v3', 'men', null, 'round_robin', 2);
select set_config('t.k3', (select v from ctx where k = 'k3'), false);
select set_config('t.k4', (select v from ctx where k = 'k4'), false);

-- ---------------------------------------------------------------- 3. attendance dates (registration on E2 by u4)
select t.as_user('00000000-0000-0000-0000-0000000000c4');
create temp table reg (k text primary key, v text);
grant all on reg to authenticated;
insert into reg select 'r1', public.submit_registration(current_setting('t.e2')::uuid, jsonb_build_object(
  'full_name', 'Pack One Fighter', 'gender', 'female', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', false,
  'waiver_agree', true, 'waiver_version_id', current_setting('t.waiver'), 'waiver_signed_name', 'Pack One Fighter',
  'attend_dates', jsonb_build_array('2026-12-12', '2026-12-13', '2027-01-01'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', current_setting('t.k3'))),
  'private', jsonb_build_object('email', 'p1u4@example.test', 'emergency_name', 'Pat', 'emergency_relationship', 'parent', 'emergency_phone', '4035550100', 'medically_fit', true)));
select t.expect_ok('a fighter registers with attendance dates', 'select 1');
select set_config('t.r1', (select v from reg where k = 'r1'), false);
select t.expect_eq('only the event''s own days are kept', (select attend_dates from public.registrations where id = current_setting('t.r1')::uuid), array[date '2026-12-12', date '2026-12-13']);
select t.expect_eq('the legacy days column stays empty for a dated registration', (select days from public.registrations where id = current_setting('t.r1')::uuid), '{}'::text[]);

-- ---------------------------------------------------------------- 1b. nothing with dependents can be removed or re-categorised
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_error('a competition someone registered for cannot be removed', $q$select public.delete_competition(current_setting('t.k3')::uuid)$q$, 'P0001');
select t.expect_error('nor through the plain table path the organizer policy allows', $q$delete from public.competitions where id = current_setting('t.k3')::uuid$q$, 'P0001');
select t.expect_eq('the competition is still there', (select count(*) from public.competitions where id = current_setting('t.k3')::uuid), 1::bigint);

select t.as_admin();
insert into public.teams (slug, name, city, region, country, status) values ('p1-team-one', 'Pack One Team', 'Red Deer', 'AB', 'CA', 'approved');
insert into public.team_roles (team_id, user_id, role) select id, '00000000-0000-0000-0000-0000000000c6', 'captain' from public.teams where slug = 'p1-team-one';
insert into public.fighters (display_name, gender) values ('Pack One Duellist', 'female');
insert into public.fighter_accounts (fighter_id, user_id) select id, '00000000-0000-0000-0000-0000000000c7' from public.fighters where display_name = 'Pack One Duellist';
insert into public.fighters (display_name, gender) values ('Pack One Other', 'female');
insert into public.entries (competition_id, team_id, status) select current_setting('t.k4')::uuid, id, 'registered' from public.teams where slug = 'p1-team-one';
insert into public.entries (competition_id, fighter_id, status) select current_setting('t.k3')::uuid, id, 'registered' from public.fighters where display_name = 'Pack One Duellist';
insert into public.entries (competition_id, fighter_id, status) select current_setting('t.k3')::uuid, id, 'registered' from public.fighters where display_name = 'Pack One Other';
insert into public.matches (competition_id, stage, round_label, position, entry_a, entry_b)
  select current_setting('t.k3')::uuid, 'round_robin', 'Round 1', 0,
         (select id from public.entries where competition_id = current_setting('t.k3')::uuid order by id limit 1),
         (select id from public.entries where competition_id = current_setting('t.k3')::uuid order by id desc limit 1);

select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_error('a competition with matches cannot change category', $q$select public.update_competition(current_setting('t.k3')::uuid, 'Longsword', 'polearm', 'open', null, 'round_robin', null)$q$, 'P0001');
select t.expect_error('nor through the plain table path', $q$update public.competitions set gender = 'men' where id = current_setting('t.k3')::uuid$q$, 'P0001');
select t.expect_ok('a competition with matches can still be renamed', $q$select public.update_competition(current_setting('t.k3')::uuid, 'Longsword (open)', 'longsword', 'open', 'Duels V.26.4', 'elimination', null)$q$);
select t.expect_eq('the rename landed but the structure stayed with the draw', (select name || '|' || structure from public.competitions where id = current_setting('t.k3')::uuid), 'Longsword (open)|round_robin');
select t.expect_error('a competition with entries cannot be removed', $q$select public.delete_competition(current_setting('t.k4')::uuid)$q$, 'P0001');
select t.as_admin();
select t.expect_ok('the database owner (seeds, cleanup) is not blocked by the guard', $q$delete from public.competitions where id = gen_random_uuid()$q$);

-- ---------------------------------------------------------------- 2. my events
select t.as_admin();
insert into public.event_staff (event_id, user_id, role) values (current_setting('t.e2')::uuid, '00000000-0000-0000-0000-0000000000c5', 'scorekeeper');

select t.as_anon();
select t.expect_error('anon cannot call my_events', 'select * from public.my_events()', '42501');
select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.expect_eq('a stranger has no events', (select count(*) from public.my_events()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c1');
select t.expect_eq('the platform owner does NOT get every event', (select count(*) from public.my_events()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.expect_eq('the organizer sees both events, the draft included', (select count(*) from public.my_events()), 2::bigint);
select t.expect_eq('the organizer''s role is reported', (select staff_roles from public.my_events() where slug = 'p1-draft-cup'), array['organizer']);
select t.expect_eq('the organizer sees how many registrations wait', (select pending_registrations from public.my_events() where slug = 'p1-open'), 1);
select t.expect_eq('rows come in date order', (select string_agg(slug, ',') from (select slug from public.my_events()) x), 'p1-draft-cup,p1-open');
select t.as_user('00000000-0000-0000-0000-0000000000c4');
select t.expect_eq('the registered fighter sees the event', (select count(*) from public.my_events()), 1::bigint);
select t.expect_eq('with their registration status', (select registration_status || '|' || fee_due_cents from public.my_events()), 'pending|0');
select t.expect_eq('the fighter does not see the draft', (select count(*) from public.my_events() where slug = 'p1-draft-cup'), 0::bigint);
select t.expect_eq('no pending count leaks to a non-organizer', (select pending_registrations from public.my_events()), null::integer);
select t.as_user('00000000-0000-0000-0000-0000000000c5');
select t.expect_eq('the scorekeeper sees the event they staff', (select staff_roles from public.my_events()), array['scorekeeper']);
select t.as_user('00000000-0000-0000-0000-0000000000c6');
select t.expect_eq('the captain sees the event their team entered', (select captain_entry from public.my_events() where slug = 'p1-open'), true);
select t.as_user('00000000-0000-0000-0000-0000000000c7');
select t.expect_eq('the account behind an entered fighter sees the event', (select fighter_entry from public.my_events() where slug = 'p1-open'), true);

-- a registration survives the event going back to draft; a mere entry does not reveal a draft
select t.as_admin();
update public.events set status = 'draft' where id = current_setting('t.e2')::uuid;
select t.as_user('00000000-0000-0000-0000-0000000000c4');
select t.expect_eq('a registrant still sees an event taken back to draft', (select count(*) from public.my_events()), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c7');
select t.expect_eq('an entered fighter does not see a draft', (select count(*) from public.my_events()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000c6');
select t.expect_eq('a captain does not see a draft', (select count(*) from public.my_events()), 0::bigint);

select t.as_admin();
select format('PACK1 GATE PASSED: %s checks', count(*)) from t.log;
rollback;
