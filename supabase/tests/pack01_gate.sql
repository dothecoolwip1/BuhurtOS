-- Pack 01 gate: team authority scoping, event-role scope and expiry, synthetic data exclusion.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack01_gate.sql
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

-- ---------------------------------------------------------------- fixtures
-- aa01 platform owner; aa02 approved event creator (platform role organizer); aa03 admin of League A; aa04 admin of League B;
-- aa05 organizer of event E1 only (the shape of organizer@buhurtos.ca); aa06 organizer of event E2 only; aa07 stranger; aa08 captain of Bears; aa09 scorekeeper of E1.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'owner@example.test'), ('00000000-0000-0000-0000-00000000aa02', 'creator@example.test'),
  ('00000000-0000-0000-0000-00000000aa03', 'orgadminA@example.test'), ('00000000-0000-0000-0000-00000000aa04', 'orgadminB@example.test'),
  ('00000000-0000-0000-0000-00000000aa05', 'evorg1@example.test'), ('00000000-0000-0000-0000-00000000aa06', 'evorg2@example.test'),
  ('00000000-0000-0000-0000-00000000aa07', 'stranger@example.test'), ('00000000-0000-0000-0000-00000000aa08', 'captain@example.test'),
  ('00000000-0000-0000-0000-00000000aa09', 'score@example.test'), ('00000000-0000-0000-0000-00000000aa0a', 'newbie@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-00000000aa01', 'owner'), ('00000000-0000-0000-0000-00000000aa02', 'organizer');
insert into public.organizations (id, slug, name, kind) values
  ('00000000-0000-0000-0000-00000000ab01', 'league-a', 'League A', 'regional'), ('00000000-0000-0000-0000-00000000ab02', 'league-b', 'League B', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000aa03', 'admin'), ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-00000000aa04', 'admin');
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-00000000ac01', 'bears', 'Bears', 'approved', 'Red Deer', 'CA'),
  ('00000000-0000-0000-0000-00000000ac02', 'wolves', 'Wolves', 'approved', 'Calgary', 'CA'),
  ('00000000-0000-0000-0000-00000000ac03', 'lynx', 'Lynx', 'approved', 'Edmonton', 'CA'),
  ('00000000-0000-0000-0000-00000000ac04', 'ravens', 'Ravens', 'approved', 'Banff', 'CA'),
  ('00000000-0000-0000-0000-00000000ac05', 'pending-a', 'Pending A', 'pending', 'Leduc', 'CA'),
  ('00000000-0000-0000-0000-00000000ac06', 'pending-b', 'Pending B', 'pending', 'Leduc', 'CA'),
  ('00000000-0000-0000-0000-00000000ac07', 'bears-dup', 'Bears Dup', 'approved', 'Red Deer', 'CA'),
  ('00000000-0000-0000-0000-00000000ac08', 'orgb-extra', 'OrgB Extra', 'approved', 'Camrose', 'CA');
insert into public.team_affiliations (team_id, organization_id, relation) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ab01', 'member'),
  ('00000000-0000-0000-0000-00000000ac07', '00000000-0000-0000-0000-00000000ab01', 'member'),
  ('00000000-0000-0000-0000-00000000ac05', '00000000-0000-0000-0000-00000000ab01', 'member'),
  ('00000000-0000-0000-0000-00000000ac02', '00000000-0000-0000-0000-00000000ab02', 'member'),
  ('00000000-0000-0000-0000-00000000ac08', '00000000-0000-0000-0000-00000000ab02', 'member');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000aa08', 'captain');
insert into public.team_request_private (team_id, requested_by, contact_email, contact_phone, captain_reason) values
  ('00000000-0000-0000-0000-00000000ac05', '00000000-0000-0000-0000-00000000aa0a', 'private@example.test', '403-555-0100', 'we practise weekly'),
  ('00000000-0000-0000-0000-00000000ac06', '00000000-0000-0000-0000-00000000aa0a', 'private2@example.test', '403-555-0101', 'we practise weekly');
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000ae01', 'e1-upcoming', 'E1 upcoming', 'published', current_date + 30, current_date + 31),
  ('00000000-0000-0000-0000-00000000ae02', 'e2-upcoming', 'E2 upcoming', 'published', current_date + 30, current_date + 31),
  ('00000000-0000-0000-0000-00000000ae03', 'e3-just-ended', 'E3 just ended', 'published', current_date - 5, current_date - 4),
  ('00000000-0000-0000-0000-00000000ae04', 'e4-long-ended', 'E4 long ended', 'published', current_date - 20, current_date - 19);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa05', 'organizer'),
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa09', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000aa06', 'organizer'),
  ('00000000-0000-0000-0000-00000000ae03', '00000000-0000-0000-0000-00000000aa05', 'organizer'),
  ('00000000-0000-0000-0000-00000000ae04', '00000000-0000-0000-0000-00000000aa05', 'organizer'),
  ('00000000-0000-0000-0000-00000000ae04', '00000000-0000-0000-0000-00000000aa09', 'scorekeeper');

-- ================================================================ 1. platform administrator keeps platform-wide authority
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.expect_ok('owner approves any pending team', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac06')$q$);
select t.expect_eq('owner can read a new-team request', (select contact_email from public.new_team_request_details('00000000-0000-0000-0000-00000000ac05')), 'private@example.test');
select t.expect_ok('owner merges two unrelated teams', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac03', '00000000-0000-0000-0000-00000000ac04')$q$);
select t.expect_eq('the removed team is gone', (select count(*) from public.teams where id = '00000000-0000-0000-0000-00000000ac04'), 0::bigint);
select t.expect_eq('owner can edit any team', public.can_edit_team('00000000-0000-0000-0000-00000000ac02'), true);

-- ================================================================ 2. organization administrator: own organization only
select t.as_user('00000000-0000-0000-0000-00000000aa03');
select t.expect_ok('League A admin approves a pending team in League A', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac05')$q$);
select t.expect_error('League A admin cannot approve a team with no affiliation', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac03')$q$, '42501');
select t.expect_error('League A admin cannot merge a League A team into a League B team', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac02')$q$, '42501');
select t.expect_error('League A admin cannot merge a League B team into a League A team', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac02', '00000000-0000-0000-0000-00000000ac01')$q$, '42501');
select t.expect_error('League A admin cannot merge an unaffiliated team away', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac03')$q$, '42501');
select t.expect_eq('League A admin can edit League A teams', public.can_edit_team('00000000-0000-0000-0000-00000000ac01'), true);
select t.expect_eq('League A admin cannot edit League B teams', public.can_edit_team('00000000-0000-0000-0000-00000000ac02'), false);
select t.expect_error('League A admin cannot read a request for a team outside League A', $q$select * from public.new_team_request_details('00000000-0000-0000-0000-00000000ac06')$q$, '42501');
select t.expect_ok('League A admin merges two League A teams', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac07')$q$);
select t.expect_eq('the League A duplicate is gone', (select count(*) from public.teams where id = '00000000-0000-0000-0000-00000000ac07'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000aa04');
select t.expect_error('League B admin cannot approve a League A team', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac01')$q$, '42501');

-- ================================================================ 3. event organizers (incl. the shape of organizer@buhurtos.ca) have NO platform-wide team power
select t.as_admin();
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000ac09', 'real-team', 'A Real Team', 'approved', 'Lacombe', 'CA'), ('00000000-0000-0000-0000-00000000ac0a', 'real-dup', 'A Real Team Dup', 'pending', 'Lacombe', 'CA');
insert into public.team_request_private (team_id, requested_by, contact_email, contact_phone, captain_reason) values ('00000000-0000-0000-0000-00000000ac0a', '00000000-0000-0000-0000-00000000aa0a', 'secret@example.test', '403-555-0111', 'we practise weekly');
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_error('event organizer cannot approve a team', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('event organizer cannot merge two real teams', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac09', '00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('event organizer cannot read new-team contact details', $q$select * from public.new_team_request_details('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('event organizer cannot name a team captain', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac09', 'newbie@example.test')$q$, '42501');
select t.expect_error('event organizer cannot rename/edit a team', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac09', '{"description":"Hijacked by an event organizer"}')$q$, '42501');
select t.expect_eq('event organizer cannot edit teams', public.can_edit_team('00000000-0000-0000-0000-00000000ac09'), false);
select t.expect_eq('event organizer cannot see a pending team', (select count(*) from public.teams where id = '00000000-0000-0000-0000-00000000ac0a'), 0::bigint);
select t.expect_eq('event organizer cannot see the roster of a pending team', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000ac0a')), 0::bigint);
select t.expect_error('event organizer cannot read team_request_private directly', 'select * from public.team_request_private', '42501');
select t.expect_error('event organizer cannot update teams directly', $q$update public.teams set status = 'approved' where id = '00000000-0000-0000-0000-00000000ac0a'$q$);
select t.expect_error('event organizer cannot delete teams directly', $q$delete from public.teams where id = '00000000-0000-0000-0000-00000000ac09'$q$);
select t.expect_eq('the team still exists after every attempt', (select count(*) from public.teams where id in ('00000000-0000-0000-0000-00000000ac09', '00000000-0000-0000-0000-00000000ac0a')), 1::bigint);
-- the approved event creator (platform role "organizer") is not a team administrator either
select t.as_user('00000000-0000-0000-0000-00000000aa02');
select t.expect_error('platform-role organizer cannot approve a team', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('platform-role organizer cannot merge teams', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac09', '00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_ok('platform-role organizer can still create an event', $q$select public.create_event('creator-cup', 'Creator Cup', current_date + 40, current_date + 41)$q$);

-- ================================================================ 4. unauthorised signed-in users and anon, direct RPC
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_error('stranger cannot approve', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('stranger cannot merge', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac09', '00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('stranger cannot read request details', $q$select * from public.new_team_request_details('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('stranger cannot grant event roles', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000ae01', 'newbie@example.test', 'organizer')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa08');
select t.expect_error('a captain cannot approve', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac0a')$q$, '42501');
select t.expect_error('a captain cannot merge their team into another', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac09')$q$, '42501');
select t.as_anon();
select t.expect_error('anon cannot approve', $q$select public.approve_team('00000000-0000-0000-0000-00000000ac0a')$q$);
select t.expect_error('anon cannot merge', $q$select public.merge_teams('00000000-0000-0000-0000-00000000ac09', '00000000-0000-0000-0000-00000000ac0a')$q$);

-- ================================================================ 5. event roles are scoped to their event and expire
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_ok('organizer adds another organizer to THEIR event', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000ae01', 'newbie@example.test', 'organizer')$q$);
select t.expect_eq('... and the new organizer really holds the role', (select count(*) from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ae01' and user_id = '00000000-0000-0000-0000-00000000aa0a' and role = 'organizer'), 1::bigint);
select t.expect_error('organizer cannot add an organizer to ANOTHER event', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000ae02', 'newbie@example.test', 'organizer')$q$, '42501');
select t.expect_error('organizer cannot add any role to another event', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000ae02', 'newbie@example.test', 'scorekeeper')$q$, '42501');
select t.expect_error('organizer cannot list another event''s staff', $q$select * from public.list_event_staff('00000000-0000-0000-0000-00000000ae02')$q$, '42501');
select t.expect_error('organizer cannot remove staff of another event', $q$select public.remove_event_role('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000aa06', 'organizer')$q$, '42501');
select t.expect_eq('organizer is an organizer of E1', private.is_organizer('00000000-0000-0000-0000-00000000ae01'), true);
select t.expect_eq('organizer is not an organizer of E2', private.is_organizer('00000000-0000-0000-0000-00000000ae02'), false);
-- just-ended event: still inside the 7-day grace window
select t.expect_eq('organizer still holds the role 5 days after the event', private.is_organizer('00000000-0000-0000-0000-00000000ae03'), true);
-- long-ended event: role has lapsed, row is kept for history
select t.expect_eq('organizer role has lapsed 20 days after the event', private.is_organizer('00000000-0000-0000-0000-00000000ae04'), false);
select t.expect_error('a lapsed organizer cannot add staff', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000ae04', 'newbie@example.test', 'organizer')$q$, '42501');
select t.expect_error('a lapsed organizer cannot list staff', $q$select * from public.list_event_staff('00000000-0000-0000-0000-00000000ae04')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa09');
select t.expect_eq('a scorekeeper cannot score for an event that ended 20 days ago', private.can_score('00000000-0000-0000-0000-00000000ae04'), false);
select t.expect_eq('a scorekeeper can score for an upcoming event they work', private.can_score('00000000-0000-0000-0000-00000000ae01'), true);
select t.as_admin();
select t.expect_eq('lapsed staff rows are kept (history, not deleted)', (select count(*) from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ae04'), 2::bigint);
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.expect_eq('the platform owner can still act on a long-ended event', private.is_organizer('00000000-0000-0000-0000-00000000ae04'), true);

-- ================================================================ 6. synthetic data is labelled and excluded from official aggregates
select t.as_admin();
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-00000000b001', 'submitted', 'Fictional test dataset', 'test', true);
insert into public.sources (id, kind, title, citation) values ('00000000-0000-0000-0000-00000000b002', 'submitted', 'Fictional-sounding but real source', 'test');
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000b101', 'real-open', 'Real Open', 'published', 'tournament', current_date - 40, current_date - 39),
  ('00000000-0000-0000-0000-00000000b102', 'fake-open-test', 'Fake Open', 'published', 'tournament', current_date - 40, current_date - 39),
  ('00000000-0000-0000-0000-00000000b103', 'plain-open', 'Looks synthetic by name only -test', 'published', 'tournament', current_date - 40, current_date - 39);
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values
  ('00000000-0000-0000-0000-00000000b001', 'event', '00000000-0000-0000-0000-00000000b102', 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-00000000b002', 'event', '00000000-0000-0000-0000-00000000b103', 'unverified', 'not synthetic');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b101', 'Real 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000b102', 'Fake 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b203', '00000000-0000-0000-0000-00000000b103', 'Name-only 5v5', '5v5', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, team_id) values
  ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000ac02'),
  ('00000000-0000-0000-0000-00000000b302', '00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000ac01'),
  ('00000000-0000-0000-0000-00000000b303', '00000000-0000-0000-0000-00000000b203', '00000000-0000-0000-0000-00000000ac09');
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b301', 1, 10),
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000b302', 1, 99),
  ('00000000-0000-0000-0000-00000000b203', '00000000-0000-0000-0000-00000000b303', 1, 10);
select t.as_anon();
select t.expect_eq('anon can see which records are synthetic', (select count(*) from public.synthetic_records where entity_type = 'event' and entity_id = '00000000-0000-0000-0000-00000000b102'), 1::bigint);
select t.expect_eq('a non-synthetic source does not mark its records', (select count(*) from public.synthetic_records where entity_id = '00000000-0000-0000-0000-00000000b103'), 0::bigint);
select t.expect_eq('official team results exclude the synthetic event', (select count(*) from public.team_results where event_id = '00000000-0000-0000-0000-00000000b102'), 0::bigint);
select t.expect_eq('official team results keep the real events', (select count(*) from public.team_results where event_id in ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b103')), 2::bigint);
select t.expect_eq('the career ranking excludes the synthetic team result', (select count(*) from public.ranking_teams where scope = 'career' and team_id = '00000000-0000-0000-0000-00000000ac01'), 0::bigint);
select t.expect_eq('the career ranking keeps real results', (select count(*) from public.ranking_teams where scope = 'career' and team_id = '00000000-0000-0000-0000-00000000ac02'), 1::bigint);
select t.expect_eq('team statistics do not count synthetic golds', (select golds from public.team_stats where team_id = '00000000-0000-0000-0000-00000000ac01'), 0::bigint);
select t.expect_eq('team statistics do not count synthetic points', (select points from public.team_stats where team_id = '00000000-0000-0000-0000-00000000ac01'), 0::numeric);
select t.expect_eq('team statistics still count real golds', (select golds from public.team_stats where team_id = '00000000-0000-0000-0000-00000000ac02'), 1::bigint);
select t.expect_eq('a synthetic event is not a played event', (select count(*) from public.played_events where event_id = '00000000-0000-0000-0000-00000000b102'), 0::bigint);
select t.expect_eq('a real event is a played event', (select count(*) from public.played_events where event_id = '00000000-0000-0000-0000-00000000b101'), 1::bigint);
select t.expect_eq('team history still lists the synthetic result, flagged', (select synthetic from public.team_history where event_id = '00000000-0000-0000-0000-00000000b102'), true);
select t.expect_eq('team history flags real results as not synthetic', (select synthetic from public.team_history where event_id = '00000000-0000-0000-0000-00000000b101'), false);
select t.expect_eq('only the source flag decides: a "-test" slug is not enough', private.is_synthetic('event', '00000000-0000-0000-0000-00000000b102'), true);
select t.expect_eq('... and an event untagged by a synthetic source is real', private.is_synthetic('event', '00000000-0000-0000-0000-00000000b103'), false);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
