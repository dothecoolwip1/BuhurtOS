-- BuhurtOS security gate. Plays real roles against the schema and asserts what each may and may not do.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/security_gate.sql      (everything is rolled back)
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

create function t.reg_payload(province text, volunteer boolean default false, agree boolean default true, fit boolean default true) returns jsonb language sql stable as $$
  select jsonb_build_object('full_name', 'Test Fighter', 'gender', 'male', 'organization', 'HACSA', 'province', province, 'insurance', 'hacsa_member',
    'is_volunteer', volunteer, 'waiver_agree', agree, 'waiver_version_id', current_setting('t.waiver'), 'waiver_signed_name', 'Test Fighter', 'days', jsonb_build_array('sat', 'sun'),
    'competitions', jsonb_build_array(jsonb_build_object('competition_id', current_setting('t.comp_ls'))),
    'private', jsonb_build_object('email', 'fighter@example.test', 'emergency_name', 'Pat Parent', 'emergency_relationship', 'parent', 'emergency_phone', '4035550100', 'medically_fit', fit, 'medical_note', 'Asthma'))
$$;
grant execute on function t.reg_payload(text, boolean, boolean, boolean) to authenticated, anon;

-- ---------------------------------------------------------------- fixtures (as the database owner)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'organizer@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'fighter@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'stranger@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'score@example.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'medic@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'fighter2@example.test'),
  ('00000000-0000-0000-0000-0000000000a8', 'captain@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner'), ('00000000-0000-0000-0000-0000000000a2', 'organizer');

-- ---------------------------------------------------------------- anonymous visitors
select t.as_anon();
select t.expect_error('anon cannot read registrations', 'select * from public.registrations', '42501');
select t.expect_error('anon cannot read registration_private', 'select * from public.registration_private', '42501');
select t.expect_error('anon cannot read score_events', 'select * from public.score_events', '42501');
select t.expect_error('anon cannot read audit_log', 'select * from public.audit_log', '42501');
select t.expect_error('anon cannot read platform_roles', 'select * from public.platform_roles', '42501');
select t.expect_error('anon cannot read event_staff', 'select * from public.event_staff', '42501');
select t.expect_error('anon cannot read fighter_accounts', 'select * from public.fighter_accounts', '42501');
select t.expect_error('anon cannot read team_roles', 'select * from public.team_roles', '42501');
select t.expect_error('anon cannot read registration_checks', 'select * from public.registration_checks', '42501');
select t.expect_error('anon cannot create events', $q$select public.create_event('x-event', 'X Event', current_date, current_date)$q$);
select t.expect_error('anon cannot submit registration', $q$select public.submit_registration(gen_random_uuid(), '{}'::jsonb)$q$);
select t.expect_ok('anon can read reference tiers', 'select * from public.ref_tiers');
select t.expect_ok('anon can read reference categories', 'select * from public.ref_categories');

-- No table or view an anonymous visitor can read exposes an account id or an actor column.
reset role;
select t.expect_eq('no anon-readable column looks like an account id',
  (select count(*) from information_schema.column_privileges cp
    where cp.grantee = 'anon' and cp.privilege_type = 'SELECT' and cp.table_schema = 'public'
      and (cp.column_name ~ '(^|_)(user|actor|created_by|recorded_by|decided_by|by)(_id)?$' or cp.column_name = 'email')), 0::bigint);

-- ---------------------------------------------------------------- who may create events
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot create an event', $q$select public.create_event('stranger-cup', 'Stranger Cup', current_date, current_date)$q$, '42501');

select t.as_user('00000000-0000-0000-0000-0000000000a2');
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
insert into ctx select 'event', public.create_event('red-deer-rumble', 'Red Deer Rumble', date '2026-11-14', date '2026-11-15', 'Horse In Hand Ranch', '39506 Highway 2 Service Rd, Blackfalds AB');
select t.expect_ok('an approved organizer can create an event', 'select 1');

-- setup by the organizer
select t.expect_ok('organizer configures fee and opens registration', format($q$update public.events set fee_cents = 4000, fee_province = 'AB', status = 'published',
  registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '5 days' where id = %L$q$, (select v from ctx where k = 'event')));
insert into ctx select 'waiver', id::text from (select * from public.waiver_versions limit 0) x;  -- placeholder row set empty
select t.expect_ok('organizer adds a waiver version', format($q$insert into public.waiver_versions (event_id, version, title, body) values (%L, 1, 'Liability waiver', 'Waiver text supplied by the owner.')$q$, (select v from ctx where k = 'event')));
select t.expect_ok('organizer adds a men''s 5v5 competition', format($q$insert into public.competitions (event_id, name, category, gender, tier, structure, rounds_to_win) values (%L, 'Men''s 5v5', '5v5', 'men', 'Exhibition', 'round_robin', 2)$q$, (select v from ctx where k = 'event')));
select t.expect_ok('organizer adds a longsword competition', format($q$insert into public.competitions (event_id, name, category, gender, tier, structure) values (%L, 'Longsword', 'longsword', 'open', 'Exhibition', 'round_robin')$q$, (select v from ctx where k = 'event')));
select t.expect_error('a tier outside the reference table is refused', format($q$insert into public.competitions (event_id, name, category, tier) values (%L, 'Bad', 'longsword', 'Galactic')$q$, (select v from ctx where k = 'event')), '23503');

select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot add a competition', format($q$insert into public.competitions (event_id, name, category) values (%L, 'Sneaky', 'longsword')$q$, (select v from ctx where k = 'event')));
select t.expect_ok('a stranger''s edit to the event is accepted but matches no rows', format($q$update public.events set name = 'Hijacked' where id = %L$q$, (select v from ctx where k = 'event')));
select t.expect_eq('a stranger''s update to the event changes nothing', (select name from public.events where id = (select v from ctx where k = 'event')::uuid), 'Red Deer Rumble');

-- staff: owner of the platform adds a scorekeeper and a medic by email (they must have signed in, which the fixtures simulate)
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer adds a scorekeeper', format($q$select public.grant_event_role_by_email(%L, 'score@example.test', 'scorekeeper')$q$, (select v from ctx where k = 'event')));
select t.expect_ok('organizer adds a medic', format($q$select public.grant_event_role_by_email(%L, 'medic@example.test', 'medic')$q$, (select v from ctx where k = 'event')));
select t.expect_error('adding someone who never signed in is refused', format($q$select public.grant_event_role_by_email(%L, 'nobody@example.test', 'medic')$q$, (select v from ctx where k = 'event')), 'P0002');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_error('a scorekeeper cannot add staff', format($q$select public.grant_event_role_by_email(%L, 'fighter@example.test', 'organizer')$q$, (select v from ctx where k = 'event')), '42501');

-- ---------------------------------------------------------------- public reads
select t.as_anon();
select t.expect_eq('anon sees the published event', (select count(*) from public.events where slug = 'red-deer-rumble'), 1::bigint);
select t.expect_eq('anon sees the event''s competitions', (select count(*) from public.competitions), 2::bigint);
select t.expect_eq('anon sees the published waiver text', (select count(*) from public.waiver_versions), 1::bigint);

-- ---------------------------------------------------------------- registration
select t.as_user('00000000-0000-0000-0000-0000000000a3');
create temp table reg (k text primary key, v text);
grant all on reg to authenticated, anon;
select t.expect_ok('stash ids', 'select 1');
select set_config('t.event', (select v from ctx where k = 'event'), false);
select set_config('t.waiver', (select id::text from public.waiver_versions limit 1), false);
select set_config('t.comp_ls', (select id::text from public.competitions where name = 'Longsword'), false);
select set_config('t.comp_5', (select id::text from public.competitions where name = 'Men''s 5v5'), false);


select t.expect_error('registration without the waiver is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', false, false))$q$, '22023');
select t.expect_error('registration without the fit declaration is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', false, true, false))$q$, '22023');
select t.expect_error('registration against the wrong waiver version is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB') || jsonb_build_object('waiver_version_id', gen_random_uuid()))$q$, '22023');
insert into reg select 'r1', public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB'));
select t.expect_ok('a signed-in fighter can register', 'select 1');
select set_config('t.r1', (select v from reg where k = 'r1'), false);
select t.expect_eq('an Alberta fighter owes the fee', (select fee_due_cents from public.registrations where id = current_setting('t.r1')::uuid), 4000);
select t.expect_eq('the fighter can read their own registration', (select count(*) from public.registrations), 1::bigint);
select t.expect_eq('the fighter can read their own private paperwork', (select count(*) from public.registration_private), 1::bigint);
select t.expect_error('the fighter cannot accept their own registration', $q$select public.decide_registration(current_setting('t.r1')::uuid, 'accepted')$q$, '42501');
select t.expect_error('the fighter cannot mark themselves paid', $q$select public.set_registration_paid(current_setting('t.r1')::uuid, true)$q$, '42501');
select t.expect_error('the fighter cannot update the registration table directly', $q$update public.registrations set status = 'accepted' where id = current_setting('t.r1')::uuid$q$);

-- fee rules
select t.as_user('00000000-0000-0000-0000-0000000000a7');
insert into reg select 'r2', public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('BC'));
select t.expect_eq('a fighter from outside Alberta owes nothing', (select fee_due_cents from public.registrations), 0);
select t.as_user('00000000-0000-0000-0000-0000000000a8');
insert into reg select 'r3', public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true));
select t.expect_eq('an Alberta volunteer owes nothing', (select fee_due_cents from public.registrations), 0);

-- volunteers: the Other role, and the waiver record
select t.expect_ok('a volunteer can pick Other with a description', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('volunteer_roles', jsonb_build_array('Squire', 'Other: carry water')))$q$);
select t.expect_eq('the Other description is stored in volunteer_roles', (select volunteer_roles from public.registrations where user_id = '00000000-0000-0000-0000-0000000000a8'), array['Squire', 'Other: carry water']);
select t.expect_eq('a volunteer who chose Other still owes nothing', (select fee_due_cents from public.registrations where user_id = '00000000-0000-0000-0000-0000000000a8'), 0);
select t.expect_error('Other without a description is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('volunteer_roles', jsonb_build_array('Other')))$q$, '22023');
select t.expect_error('Other with an empty description is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('volunteer_roles', jsonb_build_array('Other:   ')))$q$, '22023');
select t.expect_error('an over-long Other description is refused', format($q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('volunteer_roles', jsonb_build_array(%L)))$q$, 'Other: ' || repeat('x', 201)), '22023');
select t.expect_error('an unknown volunteer role is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('volunteer_roles', jsonb_build_array('Emperor')))$q$, '22023');
select t.expect_error('a blank signed name is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB', true) || jsonb_build_object('waiver_signed_name', '   '))$q$);
select t.as_admin();
select t.expect_eq('the waiver is stored exactly as loaded', (select body from public.waiver_versions where id = current_setting('t.waiver')::uuid), 'Waiver text supplied by the owner.');
select t.expect_eq('an acceptance records the version id, typed name and a time', (select count(*) from public.registrations where id = current_setting('t.r1')::uuid
  and waiver_version_id = current_setting('t.waiver')::uuid and waiver_signed_name = 'Test Fighter' and waiver_signed_at is not null), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('even an organizer cannot edit a loaded waiver (add a new version instead)', $q$update public.waiver_versions set body = 'changed' where id = current_setting('t.waiver')::uuid$q$, '42501');
select t.expect_error('even an organizer cannot delete a loaded waiver', $q$delete from public.waiver_versions where id = current_setting('t.waiver')::uuid$q$, '42501');
select t.expect_ok('an organizer can save the volunteer note', $q$update public.events set volunteer_info = 'Ask the organizers for the volunteer form.' where id = current_setting('t.event')::uuid$q$);

-- privacy: other people, scorekeepers and anonymous visitors
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a stranger sees no registrations', (select count(*) from public.registrations), 0::bigint);
select t.expect_eq('a stranger sees no private paperwork', (select count(*) from public.registration_private), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('a scorekeeper sees no registrations', (select count(*) from public.registrations), 0::bigint);
select t.expect_eq('a scorekeeper cannot read medical notes', (select count(*) from public.registration_private), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_eq('a medic can read registrations', (select count(*) from public.registrations), 3::bigint);
select t.expect_eq('a medic can read medical notes', (select count(*) from public.registration_private where medical_note is not null), 3::bigint);
select t.expect_error('a medic cannot accept a registration', $q$select public.decide_registration(current_setting('t.r1')::uuid, 'accepted')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('the organizer sees every registration', (select count(*) from public.registrations), 3::bigint);

-- closed registration
select t.as_admin();
update public.events set registration_closes_at = now() - interval '1 hour' where id = current_setting('t.event')::uuid;
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('registration after the closing time is refused', $q$select public.submit_registration(current_setting('t.event')::uuid, t.reg_payload('AB'))$q$, '22023');
select t.as_admin();
update public.events set registration_closes_at = now() + interval '5 days' where id = current_setting('t.event')::uuid;

-- acceptance creates the entry and a fighter record
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer accepts the fighter', $q$select public.decide_registration(current_setting('t.r1')::uuid, 'accepted')$q$);
select t.expect_eq('accepting created a longsword entry', (select count(*) from public.entries), 1::bigint);
select t.expect_eq('accepting created a public fighter record', (select count(*) from public.fighters), 1::bigint);
select t.expect_ok('organizer marks the fee paid', $q$select public.set_registration_paid(current_setting('t.r1')::uuid, true)$q$);
select t.expect_ok('organizer checks the fighter in', $q$select public.set_registration_check(current_setting('t.r1')::uuid, 'checked_in', true)$q$);
select t.expect_eq('not cleared until the kit check passes', (select cleared from public.registration_clearance where registration_id = current_setting('t.r1')::uuid), false);
select t.expect_ok('organizer passes the kit check', $q$select public.set_registration_check(current_setting('t.r1')::uuid, 'kit', true)$q$);
select t.expect_eq('cleared once everything is in order', (select cleared from public.registration_clearance where registration_id = current_setting('t.r1')::uuid), true);

select t.as_anon();
select t.expect_eq('anon sees the entry', (select count(*) from public.entries), 1::bigint);
select t.expect_eq('anon sees the fighter name', (select count(*) from public.fighters), 1::bigint);

-- ---------------------------------------------------------------- teams
select t.as_user('00000000-0000-0000-0000-0000000000a8');
insert into reg select 'team', public.create_team('prairie-cinders', 'Prairie Cinders', 'Saskatoon', 'SK', 'CA');
select t.expect_eq('the captain sees their pending team', (select count(*) from public.teams), 1::bigint);
select t.as_anon();
select t.expect_eq('anon does not see a pending team', (select count(*) from public.teams), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot approve a team', format($q$select public.approve_team(%L)$q$, (select v from reg where k = 'team')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('an organizer approves the team', format($q$select public.approve_team(%L)$q$, (select v from reg where k = 'team')));
select t.as_anon();
select t.expect_eq('anon sees the approved team', (select count(*) from public.teams), 1::bigint);

-- ---------------------------------------------------------------- matches and scoring
select t.as_admin();
insert into public.fighters (id, display_name) values ('00000000-0000-0000-0000-00000000f001', 'Second Duellist');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-00000000e002', current_setting('t.comp_ls')::uuid, '00000000-0000-0000-0000-00000000f001');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-00000000e003', current_setting('t.comp_ls')::uuid, '00000000-0000-0000-0000-00000000f001') on conflict do nothing;
select set_config('t.e1', (select id::text from public.entries where fighter_id <> '00000000-0000-0000-0000-00000000f001'), false);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer builds a final and a semifinal', format($q$
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values ('00000000-0000-0000-0000-0000000000f1', %L, 'final', 'Final', 1, null, null);
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values ('00000000-0000-0000-0000-0000000000f2', %L, 'elimination', 'Semifinal', 1, %L, '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000f1', 'a')$q$,
  current_setting('t.comp_ls'), current_setting('t.comp_ls'), current_setting('t.e1')));
select t.expect_error('an organizer cannot write a result directly', $q$update public.matches set result = 'a', queue_state = 'final' where id = '00000000-0000-0000-0000-0000000000f2'$q$);
select t.expect_error('an organizer cannot link a match to an entry from another competition', format($q$update public.matches set entry_a = %L where id = '00000000-0000-0000-0000-0000000000f1'$q$, gen_random_uuid()));

select t.as_anon();
select t.expect_eq('anon can read matches', (select count(*) from public.matches), 2::bigint);
select t.expect_error('anon cannot finalize', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 2, 1, '{}'::jsonb, 0)$q$);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot record a score event', $q$select public.record_score_event(gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', 'duel.strike', '{}'::jsonb)$q$, '42501');
select t.expect_error('a stranger cannot finalize', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 2, 1, '{}'::jsonb, 0)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_error('a medic cannot finalize', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 2, 1, '{}'::jsonb, 0)$q$, '42501');

select t.as_user('00000000-0000-0000-0000-0000000000a5');
create temp table ev (k text primary key, v text); grant all on ev to authenticated;
select t.expect_ok('a scorekeeper records a score event', $q$select public.record_score_event('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000f2', 'duel.strike', '{"side":"a","points":2}'::jsonb)$q$);
select t.expect_eq('the same event id sent again is ignored, not counted twice', (public.record_score_event('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000f2', 'duel.strike', '{"side":"a","points":2}'::jsonb)), false);
select t.expect_eq('only one score event is stored', (select count(*) from public.score_events), 1::bigint);
select t.expect_ok('a scorekeeper can put a match on deck', $q$select public.set_match_queue('00000000-0000-0000-0000-0000000000f2', 'on_deck', 'Field 2')$q$);
select t.expect_error('a stale result (wrong version) is refused', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 2, 1, '{}'::jsonb, 7)$q$, 'P0001');
select t.expect_error('the winner cannot have the lower score', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 1, 4, '{}'::jsonb, 0)$q$, '22023');
select t.expect_error('an elimination match cannot be a draw', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'draw', 2, 2, '{}'::jsonb, 0)$q$, '22023');
select t.expect_eq('finalizing returns the new version', public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 5, 3, '{"rounds":[2,1]}'::jsonb, 0), 1);
select t.expect_error('a final match cannot be finalized twice', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'b', 5, 9, '{}'::jsonb, 1)$q$, 'P0001');
select t.expect_error('a final match takes no more score events', $q$select public.record_score_event(gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', 'duel.strike', '{}'::jsonb)$q$, 'P0001');
select t.expect_eq('the winner advanced into the final', (select entry_a::text from public.matches where id = '00000000-0000-0000-0000-0000000000f1'), current_setting('t.e1'));
select t.expect_error('a scorekeeper cannot reopen a result', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f2', 'mistake')$q$, '42501');

select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('reopening needs a reason', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f2', '')$q$, '22023');
select t.expect_ok('an organizer reopens a mistaken result', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f2', 'wrong winner entered')$q$);
select t.expect_eq('reopening takes the winner back out of the final', (select entry_a is null from public.matches where id = '00000000-0000-0000-0000-0000000000f1'), true);

-- ---------------------------------------------------------------- competition fixes: queue field, version check, detail, third place
select t.as_admin();
insert into public.fighters (id, display_name) values ('00000000-0000-0000-0000-00000000f002', 'Third Duellist');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-00000000e004', current_setting('t.comp_ls')::uuid, '00000000-0000-0000-0000-00000000f002');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer adds a second semifinal and a third-place match', format($q$
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values ('00000000-0000-0000-0000-0000000000f3', %L, 'elimination', 'Semifinal', 2, '00000000-0000-0000-0000-00000000e004', %L, '00000000-0000-0000-0000-0000000000f1', 'b');
  insert into public.matches (id, competition_id, stage, round_label, position) values ('00000000-0000-0000-0000-0000000000f4', %L, 'third_place', 'Third place', 3)$q$,
  current_setting('t.comp_ls'), current_setting('t.e1'), current_setting('t.comp_ls')));
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_ok('a scorekeeper sets a field', $q$select public.set_match_queue('00000000-0000-0000-0000-0000000000f2', 'on_deck', 'Field 3')$q$);
select t.expect_ok('a null field keeps the field', $q$select public.set_match_queue('00000000-0000-0000-0000-0000000000f2', 'in_the_hole', null)$q$);
select t.expect_eq('the field was kept', (select field from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), 'Field 3'::text);
select t.expect_ok('an empty field clears the field', $q$select public.set_match_queue('00000000-0000-0000-0000-0000000000f2', 'on_deck', '')$q$);
select t.expect_eq('the field was cleared', (select field is null from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), true);
select t.expect_error('a null expected version is refused', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 5, 3, '{}'::jsonb, null)$q$, '22023');
select t.expect_eq('the refused result left the match open', (select queue_state from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), 'on_deck'::text);

-- a third-place match that was already played blocks a semifinal result from feeding it
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer sets the third-place sides by hand', $q$update public.matches set entry_a = '00000000-0000-0000-0000-00000000e002', entry_b = '00000000-0000-0000-0000-00000000e004' where id = '00000000-0000-0000-0000-0000000000f4'$q$);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_ok('the third-place match is played', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f4', 'a', 3, 1, '{}'::jsonb, (select version from public.matches where id = '00000000-0000-0000-0000-0000000000f4'))$q$);
select t.expect_error('a semifinal cannot feed a third-place match that is already final', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 5, 3, '{}'::jsonb, (select version from public.matches where id = '00000000-0000-0000-0000-0000000000f2'))$q$, 'P0001');
select t.expect_eq('the refused semifinal changed nothing', (select queue_state from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), 'on_deck'::text);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer reopens the third-place match', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f4', 'resetting the bracket')$q$);
select t.expect_ok('organizer clears the third-place sides', $q$update public.matches set entry_a = null, entry_b = null where id = '00000000-0000-0000-0000-0000000000f4'$q$);

-- semifinal losers drop into the third-place match, first semifinal to slot a, second to slot b
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_ok('first semifinal is finalized', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f2', 'a', 5, 3, '{"rounds":[2,1]}'::jsonb, (select version from public.matches where id = '00000000-0000-0000-0000-0000000000f2'))$q$);
select t.expect_eq('the first loser goes to slot a of third place', (select entry_a::text from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), '00000000-0000-0000-0000-00000000e002');
select t.expect_eq('slot b of third place is still empty', (select entry_b is null from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), true);
select t.expect_ok('second semifinal is finalized', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f3', 'a', 4, 0, '{}'::jsonb, (select version from public.matches where id = '00000000-0000-0000-0000-0000000000f3'))$q$);
select t.expect_eq('the second loser goes to slot b of third place', (select entry_b::text from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), current_setting('t.e1'));
select t.expect_eq('the winners are in the final', (select entry_a::text || '/' || entry_b::text from public.matches where id = '00000000-0000-0000-0000-0000000000f1'), current_setting('t.e1') || '/00000000-0000-0000-0000-00000000e004');
select t.expect_ok('the third-place match is played again', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000f4', 'b', 0, 2, '{}'::jsonb, (select version from public.matches where id = '00000000-0000-0000-0000-0000000000f4'))$q$);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a semifinal cannot be reopened while third place is final', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f2', 'fixing the score')$q$, 'P0001');
select t.expect_eq('the refused reopen changed nothing', (select queue_state from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), 'final'::text);
select t.expect_ok('organizer reopens third place', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f4', 'fixing the bracket')$q$);
select t.expect_ok('organizer reopens the first semifinal', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f2', 'fixing the score')$q$);
select t.expect_eq('reopening takes the first loser out of third place', (select entry_a is null from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), true);
select t.expect_eq('reopening leaves the second loser in place', (select entry_b::text from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), current_setting('t.e1'));
select t.expect_eq('reopening clears the stored detail', (select detail from public.matches where id = '00000000-0000-0000-0000-0000000000f2'), '{}'::jsonb);
select t.expect_ok('organizer reopens the second semifinal', $q$select public.reopen_match('00000000-0000-0000-0000-0000000000f3', 'fixing the score')$q$);
select t.expect_eq('reopening takes the second loser out of third place', (select entry_b is null from public.matches where id = '00000000-0000-0000-0000-0000000000f4'), true);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a stranger sees no audit entries', (select count(*) from public.audit_log), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('a scorekeeper sees no audit entries', (select count(*) from public.audit_log), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('the organizer can read the event audit trail', (select count(*) > 0 from public.audit_log), true);
select t.expect_error('nobody can write the audit log directly', $q$insert into public.audit_log (action) values ('forged')$q$);
select t.as_anon();
select t.expect_error('anon cannot read the audit log', 'select * from public.audit_log', '42501');
select t.expect_error('anon cannot read score events', 'select * from public.score_events', '42501');
select t.expect_eq('standings view is readable by anon', (select count(*) from public.competition_standings), 3::bigint);  -- two registered fighters plus the extra duellist entry added for the third-place checks

-- ---------------------------------------------------------------- medical notes are purged 30 days after the event
select t.as_admin();
update public.events set starts_on = current_date - 33, ends_on = current_date - 31 where id = current_setting('t.event')::uuid;
select t.expect_eq('purge removes notes older than 30 days after the event', private.purge_medical_notes(), 3);
select t.expect_eq('no medical note remains', (select count(*) from public.registration_private where medical_note is not null), 0::bigint);
select t.as_anon();
select t.expect_error('anon cannot call the purge', 'select private.purge_medical_notes()', '42501');

-- ---------------------------------------------------------------- the connected model: organizations, careers, rulesets, sources, results
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('an event organizer is not the platform owner: cannot add an organization', $q$insert into public.organizations (slug, name, kind) values ('nope', 'Nope', 'federation')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot add a source', $q$insert into public.sources (kind, title) values ('official', 'Forged')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner adds an organization', $q$insert into public.organizations (id, slug, name, kind, country) values ('00000000-0000-0000-0000-0000000000b1', 'example-fed', 'Example Federation', 'federation', 'CA')$q$);
select t.expect_ok('the owner adds a source', $q$insert into public.sources (id, kind, title, url) values ('00000000-0000-0000-0000-0000000000c1', 'imported', 'Example rulebook', 'https://example.test/rules')$q$);
select t.expect_ok('the owner adds a ruleset and a version', $q$with r as (insert into public.rulesets (id, organization_id, slug, name) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'example-duels', 'Example Duels') returning id) insert into public.ruleset_versions (id, ruleset_id, version, source_id) select '00000000-0000-0000-0000-0000000000d2', id, 'V.1', '00000000-0000-0000-0000-0000000000c1' from r$q$);
select t.expect_ok('the owner links a source to a record with a status', $q$insert into public.record_sources (source_id, entity_type, entity_id, status) values ('00000000-0000-0000-0000-0000000000c1', 'organization', '00000000-0000-0000-0000-0000000000b1', 'unverified')$q$);
select t.expect_ok('the owner records an affiliation explicitly', format($q$insert into public.team_affiliations (team_id, organization_id, relation) values (%L, '00000000-0000-0000-0000-0000000000b1', 'member')$q$, (select v from reg where k = 'team')));
select t.expect_ok('the owner adds a season', $q$insert into public.seasons (slug, name, starts_on, ends_on) values ('s-2026', '2026 season', '2026-01-01', '2026-12-31')$q$);

select t.as_anon();
select t.expect_eq('anon can read organizations', (select count(*) from public.organizations), 1::bigint);
select t.expect_eq('anon can read sources', (select count(*) from public.sources), 1::bigint);
select t.expect_eq('anon can read ruleset versions', (select count(*) from public.ruleset_versions), 1::bigint);
select t.expect_eq('anon can read the source status of a record', (select status from public.record_sources limit 1), 'unverified'::text);
select t.expect_eq('anon sees the affiliation of an approved team', (select count(*) from public.team_affiliations), 1::bigint);
select t.expect_eq('anon can read seasons', (select count(*) from public.seasons), 1::bigint);
select t.expect_error('anon cannot add a source', $q$insert into public.sources (kind, title) values ('official', 'Forged')$q$, '42501');
select t.expect_error('anon cannot add an organization', $q$insert into public.organizations (slug, name, kind) values ('x1', 'X', 'club')$q$, '42501');
select t.expect_error('anon cannot add a membership', format($q$insert into public.team_memberships (fighter_id, team_id) values ('00000000-0000-0000-0000-00000000f001', %L)$q$, (select v from reg where k = 'team')), '42501');

-- careers: only the team's captain (or the owner) writes a roster
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot add a fighter to a team roster', format($q$insert into public.team_memberships (fighter_id, team_id) values ('00000000-0000-0000-0000-00000000f001', %L)$q$, (select v from reg where k = 'team')));
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select t.expect_ok('the captain adds a fighter to their roster', format($q$insert into public.team_memberships (fighter_id, team_id, role, from_date) values ('00000000-0000-0000-0000-00000000f001', %L, 'fighter', '2026-01-01')$q$, (select v from reg where k = 'team')));
select t.as_anon();
select t.expect_eq('anon sees the roster of an approved team', (select count(*) from public.team_memberships), 1::bigint);
select t.expect_eq('anon sees no account ids: memberships carry none', (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('team_memberships', 'team_affiliations', 'organizations', 'rulesets', 'ruleset_versions', 'seasons', 'sources', 'record_sources', 'results') and column_name in ('user_id', 'created_by', 'owner_id')), 0::bigint);

-- results: organizers write, everyone reads on a published event
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot record a result', format($q$insert into public.results (competition_id, entry_id, final_place) values (%L, '00000000-0000-0000-0000-00000000e002', 1)$q$, current_setting('t.comp_ls')));
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer records a result', format($q$insert into public.results (competition_id, entry_id, final_place, points) values (%L, '00000000-0000-0000-0000-00000000e002', 1, 10)$q$, current_setting('t.comp_ls')));
select t.as_anon();
select t.expect_eq('anon sees the result', (select count(*) from public.results), 1::bigint);
select t.expect_eq('a fighter history reads from the result', (select count(*) from public.fighter_history where fighter_id = '00000000-0000-0000-0000-00000000f001'), 1::bigint);
select t.expect_error('a result cannot be written twice for one entry', format($q$insert into public.results (competition_id, entry_id) values (%L, '00000000-0000-0000-0000-00000000e002')$q$, current_setting('t.comp_ls')));

-- ---------------------------------------------------------------- insurance is recorded by organizers only
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot record insurance', format($q$select public.set_registration_insurance(%L, 'proof_received')$q$, current_setting('t.r1')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('a registrant cannot mark their own proof as received', format($q$select public.set_registration_insurance(%L, 'proof_received')$q$, current_setting('t.r1')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('an unknown insurance state is refused', format($q$select public.set_registration_insurance(%L, 'whatever')$q$, current_setting('t.r1')), '22023');
select t.expect_ok('the organizer sets proof pending', format($q$select public.set_registration_insurance(%L, 'proof_pending')$q$, current_setting('t.r1')));
select t.expect_eq('pending proof means not cleared', (select cleared from public.registration_clearance where registration_id = current_setting('t.r1')::uuid), false);
select t.expect_ok('the organizer records proof received', format($q$select public.set_registration_insurance(%L, 'proof_received')$q$, current_setting('t.r1')));
select t.expect_eq('proof received clears them again', (select cleared from public.registration_clearance where registration_id = current_setting('t.r1')::uuid), true);

-- ---------------------------------------------------------------- only an event's organizers can list its staff
select t.as_anon();
select t.expect_error('anon cannot list staff', format($q$select * from public.list_event_staff(%L)$q$, current_setting('t.event')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot list staff', format($q$select * from public.list_event_staff(%L)$q$, current_setting('t.event')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_error('a scorekeeper cannot list staff', format($q$select * from public.list_event_staff(%L)$q$, current_setting('t.event')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('the organizer sees the staff with emails', (select count(*) from public.list_event_staff(current_setting('t.event')::uuid) where email like '%@example.test'), (select count(*) from public.event_staff where event_id = current_setting('t.event')::uuid));

-- ---------------------------------------------------------------- events that are not tournaments: sign-up elsewhere or nowhere
select t.as_admin();
select t.expect_error('an external event needs a link', format($q$update public.events set registration_mode = 'external' where id = %L$q$, current_setting('t.event')), '23514');
select t.expect_error('a link must be http or https', format($q$update public.events set registration_mode = 'external', external_url = 'javascript:alert(1)' where id = %L$q$, current_setting('t.event')), '23514');
select t.expect_ok('an event can send people to another site', format($q$update public.events set registration_mode = 'external', external_url = 'https://tickets.example.test/feast', time_note = 'Doors 6 pm' where id = %L$q$, current_setting('t.event')));
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('nobody can register on BuhurtOS for an external event', format($q$select public.submit_registration(%L, t.reg_payload('AB'))$q$, current_setting('t.event')), '22023');
select t.as_admin();
select t.expect_ok('an event can take no sign-ups at all', format($q$update public.events set registration_mode = 'none', external_url = null where id = %L$q$, current_setting('t.event')));
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('nobody can register for a no-sign-up event', format($q$select public.submit_registration(%L, t.reg_payload('AB'))$q$, current_setting('t.event')), '22023');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_ok('a stranger''s attempt to change how an event takes sign-ups is silently ignored', format($q$update public.events set registration_mode = 'buhuros' where id = %L$q$, current_setting('t.event')));
select t.expect_eq('the stranger changed nothing', (select registration_mode from public.events where id = current_setting('t.event')::uuid), 'none'::text);
select t.as_admin();
select t.expect_ok('back to registering on BuhurtOS', format($q$update public.events set registration_mode = 'buhuros' where id = %L$q$, current_setting('t.event')));

-- ---------------------------------------------------------------- merging duplicate teams, and the captain's clearance list
select t.as_admin();
create temp table mt (k text primary key, v text);
grant all on mt to anon, authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'captain2@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
insert into mt select 'dup', public.create_team('prairie-cinders-2', 'Prairie Cinders (dup)', 'Saskatoon', 'SK', 'CA');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
insert into mt select 'other', public.create_team('lone-wolves', 'Lone Wolves', 'Regina', 'SK', 'CA');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('an organizer approves the other teams', format($q$select public.approve_team(%L); select public.approve_team(%L)$q$, (select v from mt where k = 'dup'), (select v from mt where k = 'other')));
select t.as_admin();
-- the duplicate and the kept team are both registered for 5v5 by their own captain's registration; the "other" team is in 5v5 too
insert into public.entries (id, competition_id, team_id) select '00000000-0000-0000-0000-00000000e0a1', id, (select v from reg where k = 'team')::uuid from public.competitions where name = 'Men''s 5v5';
insert into public.entries (id, competition_id, team_id) select '00000000-0000-0000-0000-00000000e0a2', id, (select v from mt where k = 'other')::uuid from public.competitions where name = 'Men''s 5v5';
update public.registrations set team_id = (select v from mt where k = 'dup')::uuid where id = current_setting('t.r1')::uuid;
update public.registrations set team_id = (select v from reg where k = 'team')::uuid where id = (select v from reg where k = 'r2')::uuid;
insert into public.team_affiliations (team_id, organization_id, relation) values ((select v from mt where k = 'dup')::uuid, '00000000-0000-0000-0000-0000000000b1', 'member');  -- same as the kept team's: must be dropped, not collide
insert into public.team_memberships (fighter_id, team_id) values ('00000000-0000-0000-0000-00000000f001', (select v from mt where k = 'dup')::uuid);
insert into public.team_roles (team_id, user_id, role) values ((select v from reg where k = 'team')::uuid, '00000000-0000-0000-0000-0000000000a9', 'captain');  -- already captain of the duplicate: must not collide
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-0000000000b9', 'second-org', 'Second Org', 'club');
insert into public.team_affiliations (team_id, organization_id, relation) values ((select v from mt where k = 'dup')::uuid, '00000000-0000-0000-0000-0000000000b9', 'member');
update public.fighters set team_id = (select v from mt where k = 'dup')::uuid where id = '00000000-0000-0000-0000-00000000f001';

select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot merge teams', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from mt where k = 'dup')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select t.expect_error('a captain cannot merge teams', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from mt where k = 'dup')), '42501');
select t.as_anon();
select t.expect_error('anon cannot merge teams', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from mt where k = 'dup')));
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a team cannot be merged into itself', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from reg where k = 'team')), '22023');
select t.expect_error('an unknown team is refused', format($q$select public.merge_teams(%L, gen_random_uuid())$q$, (select v from reg where k = 'team')), 'P0002');
select t.expect_error('teams with entries in the same competition are not merged', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from mt where k = 'other')), '22023');
select t.expect_eq('the refused merge changed nothing', (select count(*) from public.teams where id = (select v from mt where k = 'other')::uuid), 1::bigint);
select t.expect_ok('an organizer merges the duplicate into the kept team', format($q$select public.merge_teams(%L, %L)$q$, (select v from reg where k = 'team'), (select v from mt where k = 'dup')));
select t.as_admin();
select t.expect_eq('the duplicate team is gone', (select count(*) from public.teams where id = (select v from mt where k = 'dup')::uuid), 0::bigint);
select t.expect_eq('registrations moved to the kept team', (select count(*) from public.registrations where team_id = (select v from reg where k = 'team')::uuid), 2::bigint);
select t.expect_eq('affiliation moved to the kept team', (select count(*) from public.team_affiliations where team_id = (select v from reg where k = 'team')::uuid), 2::bigint);
select t.expect_eq('memberships moved to the kept team', (select count(*) from public.team_memberships where team_id = (select v from reg where k = 'team')::uuid), 2::bigint);
select t.expect_eq('fighters moved to the kept team', (select count(*) from public.fighters where team_id = (select v from reg where k = 'team')::uuid), 1::bigint);
select t.expect_eq('both captains now captain the kept team, once each', (select count(*) from public.team_roles where team_id = (select v from reg where k = 'team')::uuid), 2::bigint);
select t.expect_eq('the merge is in the audit log', (select count(*) from public.audit_log where action = 'team.merged'), 1::bigint);

select t.as_user('00000000-0000-0000-0000-0000000000a8');
select t.expect_eq('the captain sees their team''s registered people and no one else', (select count(*) from public.team_clearance(current_setting('t.event')::uuid, (select v from reg where k = 'team')::uuid)), 2::bigint);
select t.expect_eq('the clearance list shows who is checked in', (select count(*) from public.team_clearance(current_setting('t.event')::uuid, (select v from reg where k = 'team')::uuid) where checked_in), 1::bigint);
select t.expect_eq('the clearance list exposes no private columns', (select count(*) from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_name = 'team_clearance' and p.parameter_mode = 'OUT' and p.parameter_name ~ 'emergency|medical|note|phone|email|fit'), 0::bigint);
select t.expect_error('a captain cannot read another team''s clearance list', format($q$select * from public.team_clearance(%L, %L)$q$, current_setting('t.event'), (select v from mt where k = 'other')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger cannot read a clearance list', format($q$select * from public.team_clearance(%L, %L)$q$, current_setting('t.event'), (select v from reg where k = 'team')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('a fighter who is not a captain cannot read the list', format($q$select * from public.team_clearance(%L, %L)$q$, current_setting('t.event'), (select v from reg where k = 'team')), '42501');
select t.as_anon();
select t.expect_error('anon cannot read a clearance list', format($q$select * from public.team_clearance(%L, %L)$q$, current_setting('t.event'), (select v from reg where k = 'team')));
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('an organizer can read any team''s list', (select count(*) from public.team_clearance(current_setting('t.event')::uuid, (select v from reg where k = 'team')::uuid)), 2::bigint);

-- ---------------------------------------------------------------- my_event_entries: "My next fight"
select t.as_admin();
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b9', 'duelist@example.test'),
  ('00000000-0000-0000-0000-0000000000ba', 'member@example.test'),
  ('00000000-0000-0000-0000-0000000000bb', 'pending@example.test'),
  ('00000000-0000-0000-0000-0000000000bc', 'volunteer@example.test'),
  ('00000000-0000-0000-0000-0000000000bd', 'viaregcomp@example.test');
insert into public.teams (id, slug, name, status) values
  ('00000000-0000-0000-0000-0000000000e1', 'my-entries-a', 'My Entries A', 'approved'),
  ('00000000-0000-0000-0000-0000000000e2', 'my-entries-b', 'My Entries B', 'approved');
insert into public.fighters (id, display_name) values ('00000000-0000-0000-0000-0000000000f9', 'Mine Duelist');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000b9');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-0000000000c9', current_setting('t.comp_ls')::uuid, '00000000-0000-0000-0000-0000000000f9');
insert into public.entries (id, competition_id, team_id) values
  ('00000000-0000-0000-0000-0000000000ca', current_setting('t.comp_5')::uuid, '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000cb', current_setting('t.comp_5')::uuid, '00000000-0000-0000-0000-0000000000e2');
insert into public.registrations (id, event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, team_id, is_volunteer) values
  ('00000000-0000-0000-0000-0000000000d1', current_setting('t.event')::uuid, '00000000-0000-0000-0000-0000000000ba', 'accepted', 'Team Member', 'male', 'HACSA', 'hacsa_member', current_setting('t.waiver')::uuid, 'Team Member', '00000000-0000-0000-0000-0000000000e1', false),
  ('00000000-0000-0000-0000-0000000000d2', current_setting('t.event')::uuid, '00000000-0000-0000-0000-0000000000bb', 'pending', 'Pending Member', 'male', 'HACSA', 'hacsa_member', current_setting('t.waiver')::uuid, 'Pending Member', '00000000-0000-0000-0000-0000000000e1', false),
  ('00000000-0000-0000-0000-0000000000d3', current_setting('t.event')::uuid, '00000000-0000-0000-0000-0000000000bc', 'accepted', 'Team Volunteer', 'male', 'HACSA', 'hacsa_member', current_setting('t.waiver')::uuid, 'Team Volunteer', '00000000-0000-0000-0000-0000000000e1', true),
  ('00000000-0000-0000-0000-0000000000d4', current_setting('t.event')::uuid, '00000000-0000-0000-0000-0000000000bd', 'accepted', 'Regcomp Member', 'male', 'HACSA', 'hacsa_member', current_setting('t.waiver')::uuid, 'Regcomp Member', null, false);
insert into public.registration_competitions (registration_id, competition_id, team_id) values
  ('00000000-0000-0000-0000-0000000000d4', current_setting('t.comp_5')::uuid, '00000000-0000-0000-0000-0000000000e2');

select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.expect_eq('a duelist gets exactly their own entry', (select array_agg(entry_id) from public.my_event_entries(current_setting('t.event')::uuid)), array['00000000-0000-0000-0000-0000000000c9'::uuid]);
select t.expect_eq('the function returns only an entry id column', (select count(*) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_name = 'my_event_entries' and p.parameter_mode = 'OUT'), 1::bigint);
select t.expect_eq('another event returns nothing', (select count(*) from public.my_event_entries(gen_random_uuid())), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000ba');
select t.expect_eq('an accepted team member gets their team entry only', (select array_agg(entry_id) from public.my_event_entries(current_setting('t.event')::uuid)), array['00000000-0000-0000-0000-0000000000ca'::uuid]);
select t.as_user('00000000-0000-0000-0000-0000000000bd');
select t.expect_eq('a team chosen per competition counts', (select array_agg(entry_id) from public.my_event_entries(current_setting('t.event')::uuid)), array['00000000-0000-0000-0000-0000000000cb'::uuid]);
select t.as_user('00000000-0000-0000-0000-0000000000bb');
select t.expect_eq('a pending registration gets nothing', (select count(*) from public.my_event_entries(current_setting('t.event')::uuid)), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000bc');
select t.expect_eq('a volunteer on a team gets nothing', (select count(*) from public.my_event_entries(current_setting('t.event')::uuid)), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a stranger gets nothing', (select count(*) from public.my_event_entries(current_setting('t.event')::uuid)), 0::bigint);
select t.as_admin();
update public.entries set status = 'withdrawn' where id = '00000000-0000-0000-0000-0000000000ca';
select t.as_user('00000000-0000-0000-0000-0000000000ba');
select t.expect_eq('a withdrawn entry is not returned', (select count(*) from public.my_event_entries(current_setting('t.event')::uuid)), 0::bigint);
select t.as_anon();
select t.expect_error('anon cannot call my_event_entries', format($q$select * from public.my_event_entries(%L)$q$, current_setting('t.event')), '42501');

-- ---------------------------------------------------------------- team manager: join requests, new-team requests, rosters, notifications
select t.as_admin();
create temp table tm (k text primary key, v text);
grant all on tm to anon, authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f101', 'tm-captain@example.test'), ('00000000-0000-0000-0000-00000000f102', 'tm-joiner@example.test'),
  ('00000000-0000-0000-0000-00000000f103', 'tm-noname@example.test'),  ('00000000-0000-0000-0000-00000000f104', 'tm-member@example.test'),
  ('00000000-0000-0000-0000-00000000f105', 'tm-second@example.test'),  ('00000000-0000-0000-0000-00000000f106', 'tm-othercaptain@example.test'),
  ('00000000-0000-0000-0000-00000000f107', 'tm-lookalike@example.test'), ('00000000-0000-0000-0000-00000000f108', 'tm-spammer@example.test'),
  ('00000000-0000-0000-0000-00000000f109', 'tm-newcaptain@example.test');
update public.profiles set display_name = v.n from (values
  ('00000000-0000-0000-0000-00000000f101'::uuid, 'Cap Tain'), ('00000000-0000-0000-0000-00000000f102', 'Jo Joiner'), ('00000000-0000-0000-0000-00000000f104', 'Mem Ber'),
  ('00000000-0000-0000-0000-00000000f105', 'Second Joiner'), ('00000000-0000-0000-0000-00000000f106', 'Other Cap'), ('00000000-0000-0000-0000-00000000f107', 'Look Alike'),
  ('00000000-0000-0000-0000-00000000f108', 'Spam Mer'), ('00000000-0000-0000-0000-00000000f109', 'New Cap')) v(id, n) where public.profiles.id = v.id;
insert into public.teams (id, slug, name, city, country, status, initial) values
  ('00000000-0000-0000-0000-00000000f201', 'tm-ironwood', 'Ironwood Company', 'Calgary', 'CA', 'approved', 'I'),
  ('00000000-0000-0000-0000-00000000f202', 'tm-other', 'Other Company', 'Regina', 'CA', 'approved', 'O'),
  ('00000000-0000-0000-0000-00000000f203', 'tm-hidden', 'Hidden Company', 'Banff', 'CA', 'pending', 'H');
insert into public.team_roles (team_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-00000000f101', 'captain'),
  ('00000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-00000000f106', 'captain');
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000f301', 'Cap Tain', '00000000-0000-0000-0000-00000000f201'),
  ('00000000-0000-0000-0000-00000000f302', 'Mem Ber', '00000000-0000-0000-0000-00000000f201'),
  ('00000000-0000-0000-0000-00000000f303', 'Look Alike', null),
  ('00000000-0000-0000-0000-00000000f304', 'Former Fighter', null);
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f101'), ('00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-00000000f104');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values
  ('00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-00000000f201', 'fighter', '2025-03-01');
insert into public.team_memberships (fighter_id, team_id, role, from_date, to_date) values
  ('00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-00000000f201', 'fighter', '2020-01-01', '2021-01-01');

-- roster: public for approved teams, no account ids
select t.as_anon();
select t.expect_eq('anon reads the roster of an approved team: current members only', (select array_agg(display_name order by display_name) from public.team_roster('00000000-0000-0000-0000-00000000f201')), array['Cap Tain', 'Mem Ber']);
select t.expect_eq('the captain is flagged from team_roles without exposing the account', (select array_agg(display_name) from public.team_roster('00000000-0000-0000-0000-00000000f201') where is_captain), array['Cap Tain']);
select t.expect_eq('the roster is ordered captains first', (select display_name from public.team_roster('00000000-0000-0000-0000-00000000f201') limit 1), 'Cap Tain');
select t.expect_eq('the roster function returns no account id column', (select count(*) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_name = 'team_roster' and p.parameter_mode = 'OUT' and p.parameter_name in ('user_id', 'account_id', 'email', 'requester_id')), 0::bigint);
select t.expect_eq('no account id or email appears anywhere in the roster output', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000f201') r
  where to_jsonb(r)::text ~* '(f101|f104|@example)'), 0::bigint);
select t.expect_eq('anon sees nobody on a pending team roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000f203')), 0::bigint);
select t.expect_eq('anon sees nothing for an unknown team', (select count(*) from public.team_roster(gen_random_uuid())), 0::bigint);
select t.expect_error('anon cannot read join requests', 'select * from public.team_join_requests', '42501');
select t.expect_error('anon cannot read notifications', 'select * from public.notifications', '42501');
select t.expect_error('anon cannot read the private new-team request table', 'select * from public.team_request_private', '42501');
select t.expect_error('anon cannot request to join', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', 'hi')$q$, '42501');
select t.expect_error('anon cannot decide', $q$select public.decide_team_join(gen_random_uuid(), 'approved')$q$, '42501');
select t.expect_error('anon cannot cancel', $q$select public.cancel_team_join(gen_random_uuid())$q$, '42501');
select t.expect_error('anon cannot list requests', 'select * from public.my_team_requests()', '42501');
select t.expect_error('anon cannot read the inbox', 'select * from public.team_requests_inbox()', '42501');
select t.expect_error('anon cannot read notifications through the function', 'select * from public.my_notifications()', '42501');
select t.expect_error('anon cannot mark notifications read', 'select public.mark_notifications_read()', '42501');
select t.expect_error('anon cannot request a new team', $q$select public.request_new_team('{}'::jsonb)$q$, '42501');
select t.expect_error('anon cannot read new-team details', 'select * from public.new_team_request_details(gen_random_uuid())', '42501');

select t.as_user('00000000-0000-0000-0000-00000000f104');
select t.expect_eq('a member of another team sees nobody on a pending team roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000f203')), 0::bigint);
select t.expect_error('a signed-in user cannot write join requests directly', $q$insert into public.team_join_requests (team_id, requester_id) values ('00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-00000000f104')$q$, '42501');
select t.expect_error('a signed-in user cannot write notifications directly', $q$insert into public.notifications (user_id, kind) values ('00000000-0000-0000-0000-00000000f101', 'team_join_decided')$q$, '42501');
select t.expect_error('a signed-in user cannot read the private new-team request table', 'select * from public.team_request_private', '42501');

-- requesting to join
select t.as_user('00000000-0000-0000-0000-00000000f102');
insert into tm select 'req_jo', public.request_team_join('00000000-0000-0000-0000-00000000f201', 'I fought with Ironwood at a practice last year.');
select t.expect_eq('the request is pending', (select status from public.my_team_requests() where id = (select v from tm where k = 'req_jo')::uuid), 'pending');
select t.expect_error('a second pending request for the same team is refused', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', null)$q$, '22023');
select t.expect_error('a pending team looks like a missing one', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f203', null)$q$, 'P0002');
select t.expect_error('an unknown team is refused', $q$select public.request_team_join(gen_random_uuid(), null)$q$, 'P0002');
select t.expect_error('a message over 500 characters is refused', format($q$select public.request_team_join('00000000-0000-0000-0000-00000000f202', %L)$q$, repeat('x', 501)), '22023');
select t.expect_error('the requester cannot decide their own request', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_jo')), '42501');
select t.expect_eq('the requester has no inbox entries for the team they asked', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_eq('the requester has no notification yet', (select count(*) from public.my_notifications()), 0::bigint);

select t.as_user('00000000-0000-0000-0000-00000000f103');
select t.expect_error('a person with no name must add one first', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', null)$q$, '22023');
select t.as_user('00000000-0000-0000-0000-00000000f104');
select t.expect_error('a current member cannot request their own team again', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', null)$q$, '22023');
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_error('a captain cannot request their own team', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', null)$q$, '22023');

-- the captain's side
select t.expect_eq('the captain has one pending request in the inbox', (select count(*) from public.team_requests_inbox()), 1::bigint);
select t.expect_eq('the inbox shows the requester name, not an account', (select requester_name from public.team_requests_inbox()), 'Jo Joiner');
select t.expect_eq('the inbox has no account id or email column', (select count(*) from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_name in ('team_requests_inbox', 'my_team_requests', 'my_notifications') and p.parameter_mode = 'OUT' and p.parameter_name in ('user_id', 'requester_id', 'email', 'decided_by')), 0::bigint);
select t.expect_eq('the captain was notified', (select count(*) from public.my_notifications() where kind = 'team_join_requested' and read_at is null), 1::bigint);
select t.expect_eq('the notification names the requester and carries no id or email', (select count(*) from public.my_notifications() n
  where n.payload ->> 'requester_name' = 'Jo Joiner' and n::text !~* '(f102|@example)'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f106');
select t.expect_eq('another team''s captain sees nothing in their inbox', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_eq('another team''s captain gets no notification', (select count(*) from public.my_notifications()), 0::bigint);
select t.expect_error('another team''s captain cannot approve', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_jo')), '42501');
select t.as_user('00000000-0000-0000-0000-00000000f105');
select t.expect_error('a stranger cannot approve', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_jo')), '42501');
select t.expect_error('a stranger cannot cancel someone else''s request', format($q$select public.cancel_team_join(%L)$q$, (select v from tm where k = 'req_jo')), 'P0002');
select t.expect_eq('a stranger sees none of their own', (select count(*) from public.my_team_requests()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_error('a bad decision value is refused', format($q$select public.decide_team_join(%L, 'maybe')$q$, (select v from tm where k = 'req_jo')), '22023');
select t.expect_ok('the captain approves', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_jo')));
select t.expect_error('an answered request cannot be decided again', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from tm where k = 'req_jo')), '22023');
select t.expect_eq('the captain''s request notification is marked read', (select count(*) from public.my_notifications() where kind = 'team_join_requested' and read_at is null), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f102');
select t.expect_eq('the requester is told', (select count(*) from public.my_notifications() where kind = 'team_join_decided' and payload ->> 'decision' = 'approved'), 1::bigint);
select t.expect_error('a member cannot request again after being approved', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f201', null)$q$, '22023');
select t.expect_error('an answered request cannot be cancelled', format($q$select public.cancel_team_join(%L)$q$, (select v from tm where k = 'req_jo')), '22023');
select t.as_anon();
select t.expect_eq('the new member is on the public roster', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000f201') where display_name = 'Jo Joiner' and role = 'fighter' and not is_captain and since = current_date), 1::bigint);
select t.as_admin();
select t.expect_eq('approval created exactly one fighter, linked to the account', (select count(*) from public.fighters f join public.fighter_accounts a on a.fighter_id = f.id where a.user_id = '00000000-0000-0000-0000-00000000f102' and f.display_name = 'Jo Joiner'), 1::bigint);
select t.expect_eq('approval created one membership', (select count(*) from public.team_memberships m join public.fighter_accounts a on a.fighter_id = m.fighter_id where a.user_id = '00000000-0000-0000-0000-00000000f102' and m.team_id = '00000000-0000-0000-0000-00000000f201'), 1::bigint);

-- never silently linked to a look-alike public fighter
select t.as_user('00000000-0000-0000-0000-00000000f107');
insert into tm select 'req_look', public.request_team_join('00000000-0000-0000-0000-00000000f201', null);
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_ok('the captain approves the look-alike', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_look')));
select t.as_admin();
select t.expect_eq('the existing public fighter with the same name was not linked to the account', (select count(*) from public.fighter_accounts where fighter_id = '00000000-0000-0000-0000-00000000f303'), 0::bigint);
select t.expect_eq('a new fighter record was created instead', (select count(*) from public.fighters where display_name = 'Look Alike'), 2::bigint);

-- declining, cancelling, an organizer deciding, the pending cap
select t.as_user('00000000-0000-0000-0000-00000000f105');
insert into tm select 'req_second', public.request_team_join('00000000-0000-0000-0000-00000000f201', null);
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_ok('the captain declines', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from tm where k = 'req_second')));
select t.as_admin();
select t.expect_eq('declining adds nobody', (select count(*) from public.fighter_accounts where user_id = '00000000-0000-0000-0000-00000000f105'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f105');
select t.expect_eq('the requester is told of the decline', (select count(*) from public.my_notifications() where payload ->> 'decision' = 'declined'), 1::bigint);
select t.expect_eq('a declined request shows as declined', (select status from public.my_team_requests() where id = (select v from tm where k = 'req_second')::uuid), 'declined');
insert into tm select 'req_second2', public.request_team_join('00000000-0000-0000-0000-00000000f201', 'Trying again after the decline');
select t.expect_ok('a requester can cancel their own pending request', format($q$select public.cancel_team_join(%L)$q$, (select v from tm where k = 'req_second2')));
select t.expect_eq('the cancelled request shows as cancelled', (select status from public.my_team_requests() where id = (select v from tm where k = 'req_second2')::uuid), 'cancelled');
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_error('a cancelled request cannot be approved', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_second2')), '22023');
select t.as_user('00000000-0000-0000-0000-00000000f105');
insert into tm select 'req_second3', public.request_team_join('00000000-0000-0000-0000-00000000f201', null);
select t.as_user('00000000-0000-0000-0000-00000000f101');
select t.expect_eq('a captain with no member rows needs no special case: inbox shows the new request', (select count(*) from public.team_requests_inbox()), 1::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f105');
select t.expect_ok('cancel the third request so the person can ask elsewhere', format($q$select public.cancel_team_join(%L)$q$, (select v from tm where k = 'req_second3')));
select t.as_user('00000000-0000-0000-0000-00000000f102');
insert into tm select 'req_org', public.request_team_join('00000000-0000-0000-0000-00000000f202', null);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stranger who is not an organizer cannot decide', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_org')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('a platform organizer does not see requests of teams that have a captain', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_ok('a platform organizer may decide a request', format($q$select public.decide_team_join(%L, 'declined')$q$, (select v from tm where k = 'req_org')));
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_error('the owner cannot decide a request that was already answered', format($q$select public.decide_team_join(%L, 'approved')$q$, (select v from tm where k = 'req_org')), '22023');

select t.as_admin();
insert into public.teams (id, slug, name, status, initial)
  select ('00000000-0000-0000-0000-00000000f30' || n)::uuid, 'tm-cap-' || n, 'Cap Team ' || n, 'approved', 'C' from generate_series(1, 6) n;
select t.as_user('00000000-0000-0000-0000-00000000f108');
select t.expect_ok('five pending requests are allowed', $q$select public.request_team_join(('00000000-0000-0000-0000-00000000f30' || n)::uuid, null) from generate_series(1, 5) n$q$);
select t.expect_error('a sixth pending request is refused', $q$select public.request_team_join('00000000-0000-0000-0000-00000000f306', null)$q$, '22023');
select t.as_admin();
select t.expect_eq('a team with no captain tells platform owner and organizers', (select count(*) from public.notifications where kind = 'team_join_requested' and user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2') and payload ->> 'team_slug' = 'tm-cap-1'), 2::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('an organizer inbox lists the requests of captainless teams', (select count(*) from public.team_requests_inbox() where requester_name = 'Spam Mer'), 5::bigint);

-- notifications are private to their owner
select t.as_user('00000000-0000-0000-0000-00000000f102');
select t.expect_ok('a user marks all their own notifications read', 'select public.mark_notifications_read()');
select t.expect_eq('their notifications are all read', (select count(*) from public.my_notifications() where read_at is null), 0::bigint);
select t.as_admin();
select t.expect_eq('marking read left other people''s notifications unread', (select count(*) > 0 from public.notifications where user_id <> '00000000-0000-0000-0000-00000000f102' and read_at is null), true);
insert into tm select 'cap_notes', array_agg(id)::text from public.notifications where user_id = '00000000-0000-0000-0000-00000000f101';
select t.as_user('00000000-0000-0000-0000-00000000f105');
select t.expect_eq('marking another person''s notification by id changes nothing', public.mark_notifications_read((select v from tm where k = 'cap_notes')::uuid[]), 0);
select t.expect_eq('a user only ever sees their own notifications', (select count(*) from public.my_notifications() where kind = 'team_join_requested'), 0::bigint);
select t.expect_error('a user cannot update notifications directly', 'update public.notifications set read_at = null', '42501');

-- requesting a new team
select t.as_user('00000000-0000-0000-0000-00000000f109');
select t.expect_ok('a full new-team form is accepted', $q$select public.request_new_team(jsonb_build_object(
  'name', 'Frostgate Free Company', 'city', 'Edmonton', 'region', 'AB', 'country', 'CA', 'description', 'A new team training in Edmonton since last year.',
  'website', 'https://frostgate.example/about', 'social_links', jsonb_build_object('instagram', 'https://instagram.com/frostgate'), 'founded_year', 2024,
  'claimed_organizations', jsonb_build_array('HACSA', 'Some Regional Club'), 'colors', jsonb_build_array('#112233', '#EEDDCC'), 'crest_division', 'fess', 'initial', 'ff',
  'contact_email', 'frostgate-private@example.test', 'contact_phone', '403-555-0199', 'captain_reason', 'I run the weekly practice and hold the hall booking.', 'notes', 'Private note for reviewers'))$q$);
insert into tm select 'new_team', id::text from public.teams where slug = 'frostgate-free-company';
select t.expect_eq('the new team is pending', (select status from public.teams where slug = 'frostgate-free-company'), 'pending');
select t.expect_eq('the requester is its captain', (select count(*) from public.team_roles where team_id = (select v from tm where k = 'new_team')::uuid and user_id = '00000000-0000-0000-0000-00000000f109' and role = 'captain'), 1::bigint);
select t.expect_eq('the crest initial is normalised', (select initial from public.teams where slug = 'frostgate-free-company'), 'FF');
select t.expect_error('the requester cannot read the private part', 'select * from public.team_request_private', '42501');
select t.expect_error('the requester is not a reviewer', format($q$select * from public.new_team_request_details(%L)$q$, (select v from tm where k = 'new_team')), '42501');
select t.expect_eq('the new captain can read the roster of their pending team (empty)', (select count(*) from public.team_roster((select v from tm where k = 'new_team')::uuid)), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000f105');
select t.expect_error('a stranger is not a reviewer', format($q$select * from public.new_team_request_details(%L)$q$, (select v from tm where k = 'new_team')), '42501');
select t.as_anon();
select t.expect_eq('anon cannot see the pending team', (select count(*) from public.teams where slug = 'frostgate-free-company'), 0::bigint);
select t.expect_error('anon cannot read the private part', 'select * from public.team_request_private', '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('an organizer reads the private part', (select contact_email from public.new_team_request_details((select v from tm where k = 'new_team')::uuid)), 'frostgate-private@example.test');
select t.expect_eq('an organizer sees the requester name and the reason', (select requested_by_name || '|' || left(captain_reason, 9) from public.new_team_request_details((select v from tm where k = 'new_team')::uuid)), 'New Cap|I run the');
select t.expect_eq('an organizer was notified of the proposal', (select count(*) from public.my_notifications() where kind = 'team_proposed' and payload ->> 'team_slug' = 'frostgate-free-company'), 1::bigint);
select t.expect_error('an organizer cannot read the private table directly either', 'select * from public.team_request_private', '42501');
select t.expect_ok('an organizer approves the new team', format($q$select public.approve_team(%L)$q$, (select v from tm where k = 'new_team')));
select t.as_anon();
select t.expect_eq('anon sees the approved team with its public fields only', (select count(*) from public.teams where slug = 'frostgate-free-company' and claimed_organizations = array['HACSA', 'Some Regional Club'] and website = 'https://frostgate.example/about' and founded_year = 2024 and description is not null and social_links ? 'instagram'), 1::bigint);
select t.expect_eq('no private field is a column of a table anon can read', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'teams'
  and column_name in ('contact_email', 'contact_phone', 'captain_reason', 'notes', 'requested_by')), 0::bigint);

-- refusals on the form
select t.as_admin();
create function t.form(over jsonb default '{}'::jsonb, drop_keys text[] default '{}') returns jsonb language sql stable as $f$
  select (jsonb_build_object('name', 'Valid Team ' || md5(random()::text), 'city', 'Calgary', 'country', 'CA', 'description', 'A perfectly fine description.',
    'contact_email', 'who@example.test', 'captain_reason', 'I am the one who runs it.') || over) - drop_keys
$f$;
grant execute on function t.form(jsonb, text[]) to anon, authenticated;
select t.as_user('00000000-0000-0000-0000-00000000f109');
select t.expect_error('the name is required', $q$select public.request_new_team(t.form('{}', array['name']))$q$, '22023');
select t.expect_error('a one character name is refused', $q$select public.request_new_team(t.form('{"name":"X"}'))$q$, '22023');
select t.expect_error('city is required', $q$select public.request_new_team(t.form('{}', array['city']))$q$, '22023');
select t.expect_error('country is required', $q$select public.request_new_team(t.form('{}', array['country']))$q$, '22023');
select t.expect_error('a short description is refused', $q$select public.request_new_team(t.form('{"description":"short"}'))$q$, '22023');
select t.expect_error('a description over 500 characters is refused', format($q$select public.request_new_team(t.form(jsonb_build_object('description', %L)))$q$, repeat('d', 501)), '22023');
select t.expect_error('a taken slug is refused', $q$select public.request_new_team(t.form('{"slug":"tm-ironwood"}'))$q$, '22023');
select t.expect_error('a badly formed slug is refused', $q$select public.request_new_team(t.form('{"slug":"Not A Slug"}'))$q$, '22023');
select t.expect_error('an http website is refused', $q$select public.request_new_team(t.form('{"website":"http://insecure.example"}'))$q$, '22023');
select t.expect_error('a javascript website is refused', $q$select public.request_new_team(t.form('{"website":"javascript:alert(1)"}'))$q$, '22023');
select t.expect_error('a website with spaces is refused', $q$select public.request_new_team(t.form('{"website":"https://a b.example"}'))$q$, '22023');
select t.expect_error('an unknown social network is refused', $q$select public.request_new_team(t.form('{"social_links":{"myspace":"https://x.example/a"}}'))$q$, '22023');
select t.expect_error('an http social link is refused', $q$select public.request_new_team(t.form('{"social_links":{"facebook":"http://x.example/a"}}'))$q$, '22023');
select t.expect_error('a non-object social_links is refused', $q$select public.request_new_team(t.form('{"social_links":["https://x.example"]}'))$q$, '22023');
select t.expect_error('a future founding year is refused', $q$select public.request_new_team(t.form('{"founded_year":2999}'))$q$, '22023');
select t.expect_error('a year before 1900 is refused', $q$select public.request_new_team(t.form('{"founded_year":1850}'))$q$, '22023');
select t.expect_error('a text founding year is refused', $q$select public.request_new_team(t.form('{"founded_year":"soon"}'))$q$, '22023');
select t.expect_error('more than 5 claimed organizations are refused', $q$select public.request_new_team(t.form('{"claimed_organizations":["a1","a2","a3","a4","a5","a6"]}'))$q$, '22023');
select t.expect_error('a bad colour is refused', $q$select public.request_new_team(t.form('{"colors":["red","#000000"]}'))$q$, '22023');
select t.expect_error('an unknown crest pattern is refused', $q$select public.request_new_team(t.form('{"crest_division":"stripes"}'))$q$, '22023');
select t.expect_error('a contact email is required', $q$select public.request_new_team(t.form('{}', array['contact_email']))$q$, '22023');
select t.expect_error('a malformed contact email is refused', $q$select public.request_new_team(t.form('{"contact_email":"not-an-email"}'))$q$, '22023');
select t.expect_error('the reason for being captain is required', $q$select public.request_new_team(t.form('{}', array['captain_reason']))$q$, '22023');
select t.expect_error('an unknown form field is refused', $q$select public.request_new_team(t.form('{"status":"approved"}'))$q$, '22023');
select t.expect_error('a non-object payload is refused', $q$select public.request_new_team('[]'::jsonb)$q$, '22023');
select t.expect_error('a null payload is refused', $q$select public.request_new_team(null)$q$, '22023');
select t.expect_eq('refused forms created no team', (select count(*) from public.teams where name like 'Valid Team%'), 0::bigint);
select t.expect_ok('a minimal valid form works (slug derived from the name)', $q$select public.request_new_team(t.form('{"name":"Minimal Crew"}'))$q$);
select t.expect_eq('the slug was derived', (select count(*) from public.teams where slug = 'minimal-crew'), 1::bigint);
select t.expect_ok('a second pending team is allowed', $q$select public.request_new_team(t.form('{"name":"Second Crew"}'))$q$);
select t.expect_ok('a third pending team is allowed (an approved one no longer counts)', $q$select public.request_new_team(t.form('{"name":"Third Crew"}'))$q$);
select t.expect_error('a fourth pending team is refused', $q$select public.request_new_team(t.form('{"name":"Fourth Crew"}'))$q$, '22023');
select t.expect_ok('create_team still works for compatibility', $q$select public.create_team('tm-legacy', 'Legacy Team')$q$);

-- the old table stays unreadable
select t.as_admin();
select t.expect_eq('every private new-team field is stored apart from teams', (select count(*) from public.team_request_private), 4::bigint);

-- ---------------------------------------------------------------- every public table has row level security
select t.as_admin();
select t.expect_eq('every table in public has row level security on', (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity), 0::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
