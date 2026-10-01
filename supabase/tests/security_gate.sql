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

-- Deleting a match that another match leads into clears the link instead of failing the next_slot check (migration 20261001001700).
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('organizer builds a final and two semifinals that lead into it', format($q$
  insert into public.matches (id, competition_id, stage, round_label, position) values ('00000000-0000-0000-0000-0000000000d1', %L, 'final', 'Final', 11);
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values ('00000000-0000-0000-0000-0000000000d2', %L, 'elimination', 'Semifinal', 11, %L, '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000d1', 'a');
  insert into public.matches (id, competition_id, stage, round_label, position, next_match_id, next_slot) values ('00000000-0000-0000-0000-0000000000d3', %L, 'elimination', 'Semifinal', 12, '00000000-0000-0000-0000-0000000000d1', 'b')$q$,
  current_setting('t.comp_ls'), current_setting('t.comp_ls'), current_setting('t.e1'), current_setting('t.comp_ls')));
select t.expect_ok('the first semifinal is finalized', $q$select public.finalize_match('00000000-0000-0000-0000-0000000000d2', 'a', 3, 1, '{}'::jsonb, 0)$q$);
select t.expect_ok('the organizer deletes the unfinished final that two semifinals lead into', $q$delete from public.matches where id = '00000000-0000-0000-0000-0000000000d1'$q$);
select t.expect_eq('the final is gone', (select count(*) from public.matches where id = '00000000-0000-0000-0000-0000000000d1'), 0::bigint);
select t.expect_eq('the unfinished semifinal lost both link columns together', (select next_match_id is null and next_slot is null from public.matches where id = '00000000-0000-0000-0000-0000000000d3'), true);
select t.expect_eq('the finished semifinal lost both link columns and kept its result', (select next_match_id is null and next_slot is null and result = 'a' and queue_state = 'final' from public.matches where id = '00000000-0000-0000-0000-0000000000d2'), true);
select t.expect_ok('the unfinished semifinal can be deleted', $q$delete from public.matches where id = '00000000-0000-0000-0000-0000000000d3'$q$);
select t.as_admin();
delete from public.matches where id in ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3');
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

-- ================================================================================================================================
-- Platform organization control (20261001001900), fighter profile (2000), entry rosters and conflicts (2100), results and stats (2200)
-- ================================================================================================================================
select t.as_admin();
create temp table nx (k text primary key, v text);
grant all on nx to authenticated, anon;
create function t.g(k text) returns text language sql stable as $$ select v from nx where k = $1 $$;
create function t.gu(k text) returns uuid language sql stable as $$ select v::uuid from nx where k = $1 $$;
-- entry / match builders (run as the database owner, so row level security is out of the way for fixtures)
create function t.ent(p_key text, p_comp uuid, p_team uuid, p_fighter uuid, p_status text default 'registered') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.entries (competition_id, team_id, fighter_id, status) values (p_comp, p_team, p_fighter, p_status) returning id into v;
  insert into nx values ('e:' || p_key, v::text);
  return v;
end $$;
create function t.mkm(p_key text, p_comp uuid, p_stage text, p_label text, p_pos int, p_pool text, p_a text, p_b text, p_next text, p_slot text,
                      p_sched timestamptz default null, p_dur int default 15) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.matches (id, competition_id, stage, round_label, position, pool, entry_a, entry_b, next_match_id, next_slot, scheduled_at, duration_minutes)
  values (v, p_comp, p_stage, p_label, p_pos, p_pool, t.gu('e:' || p_a), t.gu('e:' || p_b), case when p_next is null then null else t.gu('m:' || p_next) end, p_slot, p_sched, p_dur);
  insert into nx values ('m:' || p_key, v::text);
end $$;
create function t.fin(p_key text, p_res text, p_a int, p_b int) returns void language plpgsql as $$
begin
  perform public.finalize_match(t.gu('m:' || p_key), p_res, p_a, p_b, '{}'::jsonb, (select version from public.matches where id = t.gu('m:' || p_key)));
end $$;
create function t.place(p_comp uuid, p_key text) returns int language sql stable as $$
  select final_place from public.results where competition_id = p_comp and entry_id = t.gu('e:' || p_key) $$;
create function t.pts(p_comp uuid, p_key text) returns numeric language sql stable as $$
  select points from public.results where competition_id = p_comp and entry_id = t.gu('e:' || p_key) $$;
create function t.counts() returns text language plpgsql as $$
declare r text := ''; x text; n bigint;
begin
  foreach x in array array['organizations', 'organization_staff', 'teams', 'team_affiliations', 'team_memberships', 'fighters', 'fighter_accounts', 'events', 'event_staff', 'competitions',
                           'entries', 'entry_fighters', 'matches', 'results', 'registrations', 'registration_competitions', 'team_join_requests', 'seasons'] loop
    execute format('select count(*) from public.%I', x) into n;
    r := r || x || '=' || n || ';';
  end loop;
  return r;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures: people
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'orgadmin@example.test'), ('00000000-0000-0000-0000-00000000e002', 'ncaptain@example.test'),
  ('00000000-0000-0000-0000-00000000e003', 'nfighter@example.test'), ('00000000-0000-0000-0000-00000000e004', 'nmarshal@example.test'),
  ('00000000-0000-0000-0000-00000000e005', 'norganizer@example.test'), ('00000000-0000-0000-0000-00000000e006', 'nstranger@example.test'),
  ('00000000-0000-0000-0000-00000000e007', 'nstranger2@example.test'), ('00000000-0000-0000-0000-00000000e008', 'nstranger3@example.test'),
  ('00000000-0000-0000-0000-00000000e009', 'nfighterless@example.test');
update public.profiles set display_name = 'Stranger Six' where id = '00000000-0000-0000-0000-00000000e006';
update public.profiles set display_name = 'Stranger Seven' where id = '00000000-0000-0000-0000-00000000e007';
update public.profiles set display_name = 'Stranger Eight' where id = '00000000-0000-0000-0000-00000000e008';

-- ---------------------------------------------------------------- fixtures: the league
insert into public.organizations (id, slug, name, kind, short_name, region, description) values
  ('00000000-0000-0000-0000-00000000b101', 'nacl-test', 'Northern Armored Combat League-test', 'regional', 'NACL-test', 'North', 'A fictional league.'),
  ('00000000-0000-0000-0000-00000000b102', 'other-league', 'Other League', 'regional', 'OL', 'South', null),
  ('00000000-0000-0000-0000-00000000b103', 'rank-league', 'Ranking League', 'regional', 'RL', 'East', null);
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e001', 'admin');
insert into public.teams (id, slug, name, status, initial) values
  ('00000000-0000-0000-0000-00000000b201', 'nt-one', 'NT One', 'approved', 'O'), ('00000000-0000-0000-0000-00000000b202', 'nt-two', 'NT Two', 'approved', 'T'),
  ('00000000-0000-0000-0000-00000000b203', 'nt-three', 'NT Three', 'approved', 'H'), ('00000000-0000-0000-0000-00000000b204', 'nt-four', 'NT Four', 'approved', 'F'),
  ('00000000-0000-0000-0000-00000000b205', 'nt-free', 'NT Free Agents', 'approved', 'A');
insert into public.team_affiliations (team_id, organization_id, relation) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b101', 'member'), ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000b101', 'member'),
  ('00000000-0000-0000-0000-00000000b203', '00000000-0000-0000-0000-00000000b101', 'member'), ('00000000-0000-0000-0000-00000000b204', '00000000-0000-0000-0000-00000000b101', 'member'),
  ('00000000-0000-0000-0000-00000000b204', '00000000-0000-0000-0000-00000000b102', 'member'),
  ('00000000-0000-0000-0000-00000000b205', '00000000-0000-0000-0000-00000000b101', 'recognized');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000e002', 'captain');
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000b301', 'Fighter Alpha', '00000000-0000-0000-0000-00000000b201'), ('00000000-0000-0000-0000-00000000b302', 'Fighter Bravo', '00000000-0000-0000-0000-00000000b201'),
  ('00000000-0000-0000-0000-00000000b303', 'Fighter Charlie', '00000000-0000-0000-0000-00000000b202'), ('00000000-0000-0000-0000-00000000b304', 'Fighter Delta', '00000000-0000-0000-0000-00000000b202'),
  ('00000000-0000-0000-0000-00000000b305', 'Fighter Echo', null);
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-00000000e003');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values
  ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-00000000b201', 'fighter', '2024-01-01'), ('00000000-0000-0000-0000-00000000b302', '00000000-0000-0000-0000-00000000b201', 'fighter', '2024-01-01'),
  ('00000000-0000-0000-0000-00000000b303', '00000000-0000-0000-0000-00000000b202', 'fighter', '2024-01-01'), ('00000000-0000-0000-0000-00000000b304', '00000000-0000-0000-0000-00000000b202', 'fighter', '2024-01-01');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b101', 'nt-s1', 'NACL Season 1', current_date - 365, current_date + 365),
  ('00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b103', 'rl-s1', 'Ranking Season 1', current_date - 365, current_date + 365);

-- events: a past one, an upcoming one (both NACL), an upcoming one of another organization, an upcoming one with no organization
insert into public.events (id, slug, name, status, starts_on, ends_on, organization_id, season_id, registration_opens_at, registration_closes_at) values
  ('00000000-0000-0000-0000-00000000b401', 'nt-past', 'NACL Past Open', 'published', current_date - 40, current_date - 39, '00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b501', null, null),
  ('00000000-0000-0000-0000-00000000b402', 'nt-up', 'NACL Upcoming Open', 'published', current_date + 20, current_date + 21, '00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b501', now() - interval '1 day', now() + interval '10 days'),
  ('00000000-0000-0000-0000-00000000b403', 'nt-other-up', 'Other Upcoming', 'published', current_date + 20, current_date + 21, '00000000-0000-0000-0000-00000000b102', null, null, null),
  ('00000000-0000-0000-0000-00000000b404', 'nt-free-up', 'Free Upcoming', 'published', current_date + 20, current_date + 21, null, null, null, null),
  ('00000000-0000-0000-0000-00000000b405', 'nt-season-only', 'Season Only Event', 'published', current_date + 5, current_date + 6, null, '00000000-0000-0000-0000-00000000b501', null, null);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b401', '00000000-0000-0000-0000-00000000e005', 'organizer'), ('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000e005', 'organizer'),
  ('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000e004', 'marshal');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b402', 1, 'Waiver', 'Text');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b701', '00000000-0000-0000-0000-00000000b401', 'Past Longsword', 'longsword', 'open', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b702', '00000000-0000-0000-0000-00000000b402', 'Upcoming Longsword', 'longsword', 'open', 'Classic', 'round_robin');
select t.ent('past_a', '00000000-0000-0000-0000-00000000b701', null, '00000000-0000-0000-0000-00000000b301');
select t.ent('past_b', '00000000-0000-0000-0000-00000000b701', null, '00000000-0000-0000-0000-00000000b302');
select t.ent('up_a', '00000000-0000-0000-0000-00000000b702', null, '00000000-0000-0000-0000-00000000b301');
select t.ent('up_b', '00000000-0000-0000-0000-00000000b702', null, '00000000-0000-0000-0000-00000000b302');
select t.mkm('past_m', '00000000-0000-0000-0000-00000000b701', 'round_robin', 'RR', 0, null, 'past_a', 'past_b', null, null);
select t.mkm('up_m', '00000000-0000-0000-0000-00000000b702', 'round_robin', 'RR', 0, null, 'up_a', 'up_b', null, null);
select t.mkm('up_m2', '00000000-0000-0000-0000-00000000b702', 'round_robin', 'RR', 1, null, 'up_b', 'up_a', null, null);
insert into public.results (competition_id, entry_id, final_place, points)
  values ('00000000-0000-0000-0000-00000000b701', t.gu('e:past_a'), 1, 7), ('00000000-0000-0000-0000-00000000b701', t.gu('e:past_b'), 2, 4);

-- ================================================================ A. who may switch an organization, and who may list them all
-- set_organization_enabled and admin_list_organizations: the platform owner (a1) and nobody else.
create function t.matrix(label text, uid uuid) returns void language plpgsql as $$
begin
  if uid is null then perform t.as_anon(); else perform t.as_user(uid); end if;
  perform t.expect_error(label || ' cannot disable an organization', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', false, 'nope')$q$, '42501');
  perform t.expect_error(label || ' cannot enable an organization', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', true)$q$, '42501');
  perform t.expect_error(label || ' cannot list all organizations', $q$select * from public.admin_list_organizations()$q$, '42501');
  perform t.expect_error(label || ' cannot update organizations.enabled directly', $q$update public.organizations set enabled = false where id = '00000000-0000-0000-0000-00000000b101'$q$, '42501');
  perform t.expect_error(label || ' cannot update organizations.disabled_at directly', $q$update public.organizations set disabled_at = now() where id = '00000000-0000-0000-0000-00000000b101'$q$, '42501');
  perform t.expect_error(label || ' cannot update organizations.disabled_by directly', $q$update public.organizations set disabled_by = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000b101'$q$, '42501');
  perform t.expect_error(label || ' cannot read organizations.disabled_by', $q$select disabled_by from public.organizations$q$, '42501');
end $$;
grant execute on function t.matrix(text, uuid) to anon, authenticated;
select t.matrix('anon', null);
select t.matrix('a plain user', '00000000-0000-0000-0000-00000000e006');
select t.matrix('a fighter', '00000000-0000-0000-0000-00000000e003');
select t.matrix('a team captain', '00000000-0000-0000-0000-00000000e002');
select t.matrix('a marshal', '00000000-0000-0000-0000-00000000e004');
select t.matrix('an event organizer', '00000000-0000-0000-0000-00000000e005');
select t.matrix('an organization admin', '00000000-0000-0000-0000-00000000e001');
select t.matrix('a platform organizer', '00000000-0000-0000-0000-0000000000a2');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_error('even the owner cannot write organizations.enabled with a plain UPDATE', $q$update public.organizations set enabled = false where id = '00000000-0000-0000-0000-00000000b101'$q$, '42501');
select t.expect_error('the owner cannot create an organization that is born disabled', $q$insert into public.organizations (slug, name, kind, enabled) values ('born-off', 'Born Off', 'club', false)$q$, '42501');
select t.expect_ok('the owner can still edit the public profile of an organization', $q$update public.organizations set region = 'North Region' where id = '00000000-0000-0000-0000-00000000b101'$q$);
select t.expect_eq('the owner lists every organization', (select count(*) from public.admin_list_organizations() where slug in ('nacl-test', 'other-league', 'rank-league')), 3::bigint);
select t.expect_eq('the list counts member-affiliated teams (the recognized one does not count)', (select teams_count from public.admin_list_organizations() where slug = 'nacl-test'), 4::bigint);
select t.expect_eq('the list counts distinct fighters of those teams', (select fighters_count from public.admin_list_organizations() where slug = 'nacl-test'), 4::bigint);
select t.expect_eq('the list counts completed, current and upcoming events (a season-only event counts for its season organization)',
  (select events_completed::text || '/' || events_current || '/' || events_upcoming from public.admin_list_organizations() where slug = 'nacl-test'), '1/0/2');
select t.expect_eq('the list counts organization admins', (select admins_count from public.admin_list_organizations() where slug = 'nacl-test'), 1::bigint);
select t.expect_eq('a new organization is enabled', (select enabled from public.admin_list_organizations() where slug = 'nacl-test'), true);

-- who may link events and seasons, and organization admins as organizers
select t.as_user('00000000-0000-0000-0000-00000000e001');
select t.expect_eq('an admin of an enabled organization counts as organizer of its events', private.is_organizer('00000000-0000-0000-0000-00000000b402'), true);
select t.expect_eq('... and can score them', private.can_score('00000000-0000-0000-0000-00000000b402'), true);
select t.expect_eq('... but not the events of another organization', private.is_organizer('00000000-0000-0000-0000-00000000b403'), false);
select t.expect_error('an admin who is not an organizer of the event cannot link it', $q$select public.set_event_organization('00000000-0000-0000-0000-00000000b404', '00000000-0000-0000-0000-00000000b101')$q$, '42501');
select t.expect_ok('an organization admin creates a season', $q$select public.create_season('00000000-0000-0000-0000-00000000b101', 'nt-s2', 'NACL Season 2', current_date, current_date + 100)$q$);
select t.expect_error('an admin cannot create a season for another organization', $q$select public.create_season('00000000-0000-0000-0000-00000000b102', 'ol-s2', 'x season', current_date, current_date + 100)$q$, '42501');
select t.expect_error('an organization admin cannot add organization admins', $q$select public.grant_organization_admin('00000000-0000-0000-0000-00000000b101', 'nstranger@example.test')$q$, '42501');
select t.expect_eq('an organization admin sees the organization staff', (select count(*) from public.list_organization_staff('00000000-0000-0000-0000-00000000b101')), 1::bigint);
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_error('an event organizer who is not an organization admin cannot link their event to the organization', $q$select public.set_event_organization('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b102')$q$, '42501');
select t.expect_error('an event organizer cannot set an organization season on their event', $q$select public.set_event_season('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b502')$q$, '42501');
select t.expect_error('event organizers can no longer write events.season_id directly', $q$update public.events set season_id = null where id = '00000000-0000-0000-0000-00000000b402'$q$, '42501');
select t.expect_error('event organizers cannot write events.organization_id directly', $q$update public.events set organization_id = null where id = '00000000-0000-0000-0000-00000000b402'$q$, '42501');
select t.expect_error('organization_staff cannot be written through the API', $q$insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e005', 'admin')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner links an event to an organization', $q$select public.set_event_organization('00000000-0000-0000-0000-00000000b404', '00000000-0000-0000-0000-00000000b102')$q$);
select t.expect_ok('... and unlinks it again', $q$select public.set_event_organization('00000000-0000-0000-0000-00000000b404', null)$q$);
select t.expect_error('an event cannot be linked to an organization other than its season''s', $q$select public.set_event_organization('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b102')$q$, '22023');
select t.as_user('00000000-0000-0000-0000-00000000e006');
select t.expect_eq('organization_staff is private: a stranger sees none', (select count(*) from public.organization_staff), 0::bigint);
select t.as_anon();
select t.expect_error('anon cannot read organization_staff', 'select * from public.organization_staff', '42501');

-- ================================================================ A. lifecycle: operate, disable, locked out, public view, owner view, re-enable
select t.as_user('00000000-0000-0000-0000-00000000e004');
select t.expect_ok('before: a marshal of the event scores', format($q$select public.record_score_event(gen_random_uuid(), %L, 'point')$q$, t.g('m:up_m')));
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_ok('before: the event organizer edits the event', $q$update public.events set name = 'NACL Upcoming Open!' where id = '00000000-0000-0000-0000-00000000b402'$q$);
select t.expect_eq('before: the edit landed', (select name from public.events where id = '00000000-0000-0000-0000-00000000b402'), 'NACL Upcoming Open!');
select t.as_user('00000000-0000-0000-0000-00000000e006');
select t.expect_ok('before: a stranger asks to join the NACL team', $q$select public.request_team_join('00000000-0000-0000-0000-00000000b201', 'hello')$q$);
insert into nx select 'join_req', id::text from public.my_team_requests() limit 1;
select t.as_user('00000000-0000-0000-0000-00000000e007');
select t.expect_ok('before: a second stranger asks to join (left pending)', $q$select public.request_team_join('00000000-0000-0000-0000-00000000b201', 'me too')$q$);
insert into nx select 'join_req2', id::text from public.my_team_requests() limit 1;
select t.as_user('00000000-0000-0000-0000-00000000e002');
select t.expect_eq('before: the captain is a captain', private.is_team_captain('00000000-0000-0000-0000-00000000b201'), true);
select t.expect_ok('before: the captain approves the first request', format($q$select public.decide_team_join(%L, 'approved')$q$, t.g('join_req')));
select t.as_user('00000000-0000-0000-0000-00000000e003');
select t.expect_ok('before: a fighter registers for the upcoming event', format($q$select public.submit_registration(%L, jsonb_build_object('full_name', 'Fighter Alpha', 'gender', 'male', 'organization', 'HACSA',
  'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', %L, 'waiver_signed_name', 'Fighter Alpha',
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', %L)),
  'private', jsonb_build_object('email', 'x@example.test', 'emergency_name', 'Pat Parent', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$,
  '00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b702'));
select t.as_admin();
insert into nx values ('counts0', t.counts());

-- ---- the owner switches NACL off
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner disables NACL', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', false, 'lifecycle test')$q$);
select t.expect_eq('disabled_at is set', (select disabled_at is not null from public.organizations where id = '00000000-0000-0000-0000-00000000b101'), true);
select t.expect_eq('the owner list shows it disabled', (select enabled from public.admin_list_organizations() where slug = 'nacl-test'), false);
select t.expect_eq('the switch was audited', (select count(*) from public.audit_log where action = 'organization.disabled' and details ->> 'reason' = 'lifecycle test'), 1::bigint);
select t.expect_ok('disabling twice is a harmless no-op', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', false)$q$);
select t.expect_eq('... and does not write a second audit row', (select count(*) from public.audit_log where action = 'organization.disabled'), 1::bigint);

-- event staff are locked out
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_eq('after: the event organizer is no longer an organizer', private.is_organizer('00000000-0000-0000-0000-00000000b402'), false);
select t.expect_eq('after: ... cannot score', private.can_score('00000000-0000-0000-0000-00000000b402'), false);
select t.expect_eq('after: ... cannot read health data', private.can_read_health('00000000-0000-0000-0000-00000000b402'), false);
select t.expect_ok('after: the event organizer''s edit is accepted but matches no rows', $q$update public.events set name = 'Hijack' where id = '00000000-0000-0000-0000-00000000b402'$q$);
select t.expect_eq('after: the organizer no longer even sees the upcoming event', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b402'), 0::bigint);
select t.expect_error('after: the organizer cannot add staff', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000b402', 'nstranger@example.test', 'marshal')$q$, '42501');
select t.expect_error('after: the organizer cannot read the staff list', $q$select * from public.list_event_staff('00000000-0000-0000-0000-00000000b402')$q$, '42501');
select t.expect_error('after: the organizer cannot add a competition', $q$insert into public.competitions (event_id, name, category) values ('00000000-0000-0000-0000-00000000b402', 'New', 'longsword')$q$);
select t.expect_eq('after: the organizer cannot see the registrations', (select count(*) from public.registrations), 0::bigint);
select t.expect_eq('after: ... but can still see the past event', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b401'), 1::bigint);
select t.expect_eq('after: ... though not as an organizer of it', private.is_organizer('00000000-0000-0000-0000-00000000b401'), false);
select t.as_user('00000000-0000-0000-0000-00000000e004');
select t.expect_error('after: the marshal cannot score', format($q$select public.record_score_event(gen_random_uuid(), %L, 'point')$q$, t.g('m:up_m')), '42501');
select t.expect_error('after: the marshal cannot finalize', format($q$select public.finalize_match(%L, 'a', 5, 1, '{}'::jsonb, 0)$q$, t.g('m:up_m')), '42501');
select t.expect_error('after: the marshal cannot change the queue', format($q$select public.set_match_queue(%L, 'on_deck')$q$, t.g('m:up_m')), '42501');
select t.expect_eq('after: the marshal cannot see the upcoming matches', (select count(*) from public.matches where id = t.gu('m:up_m')), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000e001');
select t.expect_eq('after: an admin of a disabled organization is no organizer', private.is_organizer('00000000-0000-0000-0000-00000000b402'), false);
select t.expect_error('after: ... and cannot create a season', $q$select public.create_season('00000000-0000-0000-0000-00000000b101', 'nt-s3', 'NACL Season 3', current_date, current_date + 100)$q$, '42501');
select t.expect_error('after: ... and cannot read the staff list', $q$select * from public.list_organization_staff('00000000-0000-0000-0000-00000000b101')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('after: a platform organizer who is not the owner cannot score NACL events', private.can_score('00000000-0000-0000-0000-00000000b402'), false);
select t.expect_error('after: ... nor decide a join request of a NACL team', format($q$select public.decide_team_join(%L, 'approved')$q$, t.g('join_req2')), '42501');
-- captains, join requests, registrations
select t.as_user('00000000-0000-0000-0000-00000000e002');
select t.expect_eq('after: the captain of a NACL team is no longer a captain', private.is_team_captain('00000000-0000-0000-0000-00000000b201'), false);
select t.expect_error('after: the captain cannot decide a join request', format($q$select public.decide_team_join(%L, 'approved')$q$, t.g('join_req2')), '42501');
select t.expect_eq('after: the captain''s inbox is empty', (select count(*) from public.team_requests_inbox()), 0::bigint);
select t.expect_eq('after: the captain cannot add roster members (memberships stay as they were)',
  (select count(*) from public.team_memberships where team_id = '00000000-0000-0000-0000-00000000b201'), 3::bigint);
select t.expect_error('after: the captain cannot write memberships directly', $q$insert into public.team_memberships (fighter_id, team_id) values ('00000000-0000-0000-0000-00000000b305', '00000000-0000-0000-0000-00000000b201')$q$);
select t.expect_error('after: the captain cannot read team clearance', $q$select * from public.team_clearance('00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b201')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000e008');
select t.expect_error('after: a stranger cannot ask to join a NACL team', $q$select public.request_team_join('00000000-0000-0000-0000-00000000b201', 'please')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000e003');
select t.expect_error('after: nobody can register for an upcoming NACL event', format($q$select public.submit_registration(%L, jsonb_build_object('full_name', 'Fighter Alpha', 'gender', 'male', 'organization', 'HACSA',
  'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', %L, 'waiver_signed_name', 'Fighter Alpha',
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', %L)),
  'private', jsonb_build_object('email', 'x@example.test', 'emergency_name', 'Pat Parent', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$,
  '00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b702'));
select t.expect_eq('after: a registrant still reads their own registration', (select count(*) from public.registrations), 1::bigint);
-- the public
select t.as_anon();
select t.expect_eq('after: anon cannot see the upcoming NACL event', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b402'), 0::bigint);
select t.expect_eq('after: ... nor its competitions', (select count(*) from public.competitions where event_id = '00000000-0000-0000-0000-00000000b402'), 0::bigint);
select t.expect_eq('after: ... nor its entries', (select count(*) from public.entries where competition_id = '00000000-0000-0000-0000-00000000b702'), 0::bigint);
select t.expect_eq('after: ... nor its matches', (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000b702'), 0::bigint);
select t.expect_eq('after: ... nor its waiver', (select count(*) from public.waiver_versions where event_id = '00000000-0000-0000-0000-00000000b402'), 0::bigint);
select t.expect_eq('after: anon still sees the PAST NACL event', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b401'), 1::bigint);
select t.expect_eq('after: ... its competitions, entries, matches and results', (select (select count(*) from public.competitions where event_id = '00000000-0000-0000-0000-00000000b401')
  + (select count(*) from public.entries where competition_id = '00000000-0000-0000-0000-00000000b701') + (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000b701')
  + (select count(*) from public.results where competition_id = '00000000-0000-0000-0000-00000000b701')), 6::bigint);
select t.expect_eq('after: fighter_history and team_history keep working for past results', (select count(*) from public.fighter_history where event_slug = 'nt-past'), 2::bigint);
select t.expect_eq('after: ... the new results view too', (select count(*) from public.fighter_results where event_slug = 'nt-past'), 2::bigint);
select t.expect_eq('after: events of other organizations and of none are untouched', (select count(*) from public.events where id in ('00000000-0000-0000-0000-00000000b403', '00000000-0000-0000-0000-00000000b404')), 2::bigint);
select t.expect_eq('after: the organization row stays readable and says inactive', (select enabled::text || '/' || (disabled_at is not null)::text from public.organizations where slug = 'nacl-test'), 'false/true');
select t.expect_eq('after: list_active_organizations leaves it out', (select count(*) from public.list_active_organizations() where slug = 'nacl-test'), 0::bigint);
select t.expect_eq('after: ... and keeps the others', (select count(*) from public.list_active_organizations() where slug in ('other-league', 'rank-league')), 2::bigint);
select t.expect_eq('after: teams_active hides NACL-only teams', (select count(*) from public.teams_active where slug in ('nt-one', 'nt-two', 'nt-three')), 0::bigint);
select t.expect_eq('after: ... keeps a team that also belongs to an enabled organization, and a team with only a recognized affiliation',
  (select count(*) from public.teams_active where slug in ('nt-four', 'nt-free')), 2::bigint);
select t.expect_eq('after: the team rows themselves stay readable (history)', (select count(*) from public.teams where slug in ('nt-one', 'nt-two', 'nt-three', 'nt-four')), 4::bigint);
select t.expect_eq('after: the roster stays readable', (select count(*) from public.team_roster('00000000-0000-0000-0000-00000000b201')), 3::bigint);
select t.expect_eq('after: fighters stay readable', (select count(*) from public.fighters where display_name like 'Fighter %'), 5::bigint);
select t.expect_eq('after: fighter_profile still names the team and its organization as inactive',
  (select team_name || '/' || team_organization_slug || '/' || team_organization_enabled::text from public.fighter_profile('00000000-0000-0000-0000-00000000b301')), 'NT One/nacl-test/false');
-- the owner sees everything
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_eq('after: the owner still sees the upcoming NACL event', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b402'), 1::bigint);
select t.expect_eq('after: ... its matches, entries and registrations', (select (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000b702')
  + (select count(*) from public.entries where competition_id = '00000000-0000-0000-0000-00000000b702') + (select count(*) from public.registrations where event_id = '00000000-0000-0000-0000-00000000b402')), 5::bigint);
select t.expect_eq('after: the owner can still score NACL events', private.can_score('00000000-0000-0000-0000-00000000b402'), true);
select t.expect_ok('after: ... and does', format($q$select public.record_score_event(gen_random_uuid(), %L, 'point')$q$, t.g('m:up_m')));
select t.expect_eq('after: the owner sees disabled organizations in the admin list', (select count(*) from public.admin_list_organizations() where not enabled), 1::bigint);
select t.as_admin();
select t.expect_eq('NOTHING was deleted or added by disabling (row counts of every affected table)', t.counts(), t.g('counts0'));
select t.expect_eq('(score events are append-only history: the marshal''s before, the owner''s after)', (select count(*) from public.score_events where match_id = t.gu('m:up_m')), 2::bigint);
-- things the switch must NOT touch: teams with no member affiliation or with another enabled organization
select t.as_user('00000000-0000-0000-0000-00000000e008');
select t.expect_ok('after: a team that also belongs to an enabled organization still takes join requests', $q$select public.request_team_join('00000000-0000-0000-0000-00000000b204', null)$q$);
select t.expect_ok('after: a team with no member affiliation takes join requests', $q$select public.request_team_join('00000000-0000-0000-0000-00000000b205', null)$q$);
select t.as_admin();
insert into nx values ('counts1', t.counts());

-- ---- the owner switches NACL on again
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner re-enables NACL', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', true)$q$);
select t.expect_eq('disabled_at is cleared', (select disabled_at is null and enabled from public.organizations where id = '00000000-0000-0000-0000-00000000b101'), true);
select t.expect_eq('the re-enable was audited', (select count(*) from public.audit_log where action = 'organization.enabled'), 1::bigint);
select t.as_admin();
select t.expect_eq('re-enabling created or removed nothing', t.counts(), t.g('counts1'));
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_eq('restored: the event organizer is an organizer again', private.is_organizer('00000000-0000-0000-0000-00000000b402'), true);
select t.expect_ok('restored: ... and edits the event', $q$update public.events set name = 'NACL Upcoming Open' where id = '00000000-0000-0000-0000-00000000b402'$q$);
select t.expect_eq('restored: the edit landed', (select name from public.events where id = '00000000-0000-0000-0000-00000000b402'), 'NACL Upcoming Open');
select t.as_user('00000000-0000-0000-0000-00000000e004');
select t.expect_ok('restored: the marshal scores again', format($q$select public.record_score_event(gen_random_uuid(), %L, 'point')$q$, t.g('m:up_m')));
select t.as_user('00000000-0000-0000-0000-00000000e002');
select t.expect_eq('restored: the captain is a captain again', private.is_team_captain('00000000-0000-0000-0000-00000000b201'), true);
select t.expect_ok('restored: ... and decides the waiting request', format($q$select public.decide_team_join(%L, 'declined')$q$, t.g('join_req2')));
select t.as_user('00000000-0000-0000-0000-00000000e001');
select t.expect_eq('restored: the organization admin is an organizer again', private.is_organizer('00000000-0000-0000-0000-00000000b402'), true);
select t.as_anon();
select t.expect_eq('restored: anon sees the upcoming event, its competitions and matches again', (select (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b402')
  + (select count(*) from public.competitions where event_id = '00000000-0000-0000-0000-00000000b402') + (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000b702')), 4::bigint);
select t.expect_eq('restored: list_active_organizations has it again', (select count(*) from public.list_active_organizations() where slug = 'nacl-test'), 1::bigint);
select t.expect_eq('restored: teams_active has the teams again', (select count(*) from public.teams_active where slug in ('nt-one', 'nt-two', 'nt-three', 'nt-four')), 4::bigint);
select t.as_user('00000000-0000-0000-0000-00000000e003');
select t.expect_ok('restored: registration works again (the existing registration is updated)', format($q$select public.submit_registration(%L, jsonb_build_object('full_name', 'Fighter Alpha', 'gender', 'male', 'organization', 'HACSA',
  'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', %L, 'waiver_signed_name', 'Fighter Alpha',
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', %L)),
  'private', jsonb_build_object('email', 'x@example.test', 'emergency_name', 'Pat Parent', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$,
  '00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b702'));
-- a season-only event follows its season's organization
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner disables NACL again for the season-only event', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', false)$q$);
select t.as_anon();
select t.expect_eq('an upcoming event that belongs to NACL only through its season is hidden too', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b405'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner enables NACL for good', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b101', true)$q$);
select t.as_anon();
select t.expect_eq('... and it is back', (select count(*) from public.events where id = '00000000-0000-0000-0000-00000000b405'), 1::bigint);

-- ================================================================ fixtures for results, rosters, conflicts and rankings
select t.as_admin();
drop function t.fin(text, text, int, int);
create function t.fin(p_key text, p_res text, p_a int, p_b int, p_detail jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  perform public.finalize_match(t.gu('m:' || p_key), p_res, p_a, p_b, p_detail, (select version from public.matches where id = t.gu('m:' || p_key)));
end $$;
grant execute on function t.fin(text, text, int, int, jsonb) to anon, authenticated;
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000b311', 'Elim One', '00000000-0000-0000-0000-00000000b203'), ('00000000-0000-0000-0000-00000000b312', 'Elim Two', '00000000-0000-0000-0000-00000000b203'),
  ('00000000-0000-0000-0000-00000000b313', 'Elim Three', '00000000-0000-0000-0000-00000000b203'), ('00000000-0000-0000-0000-00000000b314', 'Elim Four', '00000000-0000-0000-0000-00000000b203'),
  ('00000000-0000-0000-0000-00000000b315', 'Elim Five', '00000000-0000-0000-0000-00000000b203'), ('00000000-0000-0000-0000-00000000b316', 'Elim Six', '00000000-0000-0000-0000-00000000b203'),
  ('00000000-0000-0000-0000-00000000b317', 'Elim Seven', '00000000-0000-0000-0000-00000000b203');
insert into public.events (id, slug, name, status, starts_on, ends_on, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000b411', 'nt-stats', 'Stats Open', 'published', current_date - 10, current_date - 9, '00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000b502'),
  ('00000000-0000-0000-0000-00000000b412', 'nt-stats2', 'Stats Open Two', 'published', current_date - 8, current_date - 7, null, null),
  ('00000000-0000-0000-0000-00000000b413', 'nt-conf', 'Conflict Open', 'draft', current_date + 30, current_date + 31, null, null);
insert into public.event_staff (event_id, user_id, role) select e, '00000000-0000-0000-0000-0000000000a2', 'organizer'
  from unnest(array['00000000-0000-0000-0000-00000000b411', '00000000-0000-0000-0000-00000000b412', '00000000-0000-0000-0000-00000000b413']::uuid[]) e;
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b801', '00000000-0000-0000-0000-00000000b411', 'Longsword Elim', 'longsword', 'open', 'Classic', 'elimination'),
  ('00000000-0000-0000-0000-00000000b802', '00000000-0000-0000-0000-00000000b411', 'Buckler RR', 'buckler', 'open', 'Source', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b803', '00000000-0000-0000-0000-00000000b411', 'Men''s 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b811', '00000000-0000-0000-0000-00000000b412', 'S&S cycle', 'sword_shield', 'open', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b812', '00000000-0000-0000-0000-00000000b412', 'Polearm pools', 'polearm', 'open', 'Regional', 'pools_elimination'),
  ('00000000-0000-0000-0000-00000000b813', '00000000-0000-0000-0000-00000000b412', 'Profight no tier', 'profight', 'open', null, 'round_robin'),
  ('00000000-0000-0000-0000-00000000b821', '00000000-0000-0000-0000-00000000b413', 'Conflict Longsword', 'longsword', 'open', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b822', '00000000-0000-0000-0000-00000000b413', 'Conflict 5v5', '5v5', 'open', 'Classic', 'round_robin');

-- ---- elimination with byes and a third-place match: 6 entries in an 8 bracket (seeds 1 and 2 have byes), plus a withdrawn entry
select t.ent('s' || n, '00000000-0000-0000-0000-00000000b801', null, ('00000000-0000-0000-0000-00000000b31' || n)::uuid) from generate_series(1, 6) n;
select t.ent('s7', '00000000-0000-0000-0000-00000000b801', null, '00000000-0000-0000-0000-00000000b317', 'withdrawn');
select t.mkm('ef', '00000000-0000-0000-0000-00000000b801', 'final', 'Final', 0, null, null, null, null, null);
select t.mkm('e3', '00000000-0000-0000-0000-00000000b801', 'third_place', 'Third place', 0, null, null, null, null, null);
select t.mkm('es1', '00000000-0000-0000-0000-00000000b801', 'elimination', 'Semifinal', 0, null, 's1', null, 'ef', 'a');
select t.mkm('es2', '00000000-0000-0000-0000-00000000b801', 'elimination', 'Semifinal', 1, null, 's2', null, 'ef', 'b');
select t.mkm('eq2', '00000000-0000-0000-0000-00000000b801', 'elimination', 'Quarterfinal', 1, null, 's4', 's5', 'es1', 'b');
select t.mkm('eq4', '00000000-0000-0000-0000-00000000b801', 'elimination', 'Quarterfinal', 3, null, 's3', 's6', 'es2', 'b');
-- ---- round robin that needs head-to-head: A and B both 2 wins and +2 difference; B has more points scored, A beat B
select t.ent('rA', '00000000-0000-0000-0000-00000000b802', null, '00000000-0000-0000-0000-00000000b312');
select t.ent('rB', '00000000-0000-0000-0000-00000000b802', null, '00000000-0000-0000-0000-00000000b311');
select t.ent('rC', '00000000-0000-0000-0000-00000000b802', null, '00000000-0000-0000-0000-00000000b313');
select t.ent('rD', '00000000-0000-0000-0000-00000000b802', null, '00000000-0000-0000-0000-00000000b314');
select t.mkm('rab', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 0, null, 'rA', 'rB', null, null);
select t.mkm('rac', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 1, null, 'rA', 'rC', null, null);
select t.mkm('rda', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 2, null, 'rD', 'rA', null, null);
select t.mkm('rbc', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 3, null, 'rB', 'rC', null, null);
select t.mkm('rbd', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 4, null, 'rB', 'rD', null, null);
select t.mkm('rcd', '00000000-0000-0000-0000-00000000b802', 'round_robin', 'RR', 5, null, 'rC', 'rD', null, null);
-- ---- 5v5 with rosters
select t.ent('tA', '00000000-0000-0000-0000-00000000b803', '00000000-0000-0000-0000-00000000b201', null);
select t.ent('tB', '00000000-0000-0000-0000-00000000b803', '00000000-0000-0000-0000-00000000b202', null);
select t.mkm('t1', '00000000-0000-0000-0000-00000000b803', 'round_robin', 'RR', 0, null, 'tA', 'tB', null, null);
-- ---- a three-way cycle (every tie-break level)
select t.ent('cX', '00000000-0000-0000-0000-00000000b811', null, '00000000-0000-0000-0000-00000000b311');
select t.ent('cY', '00000000-0000-0000-0000-00000000b811', null, '00000000-0000-0000-0000-00000000b312');
select t.ent('cZ', '00000000-0000-0000-0000-00000000b811', null, '00000000-0000-0000-0000-00000000b313');
select t.mkm('cxy', '00000000-0000-0000-0000-00000000b811', 'round_robin', 'RR', 0, null, 'cX', 'cY', null, null);
select t.mkm('cyz', '00000000-0000-0000-0000-00000000b811', 'round_robin', 'RR', 1, null, 'cY', 'cZ', null, null);
select t.mkm('czx', '00000000-0000-0000-0000-00000000b811', 'round_robin', 'RR', 2, null, 'cZ', 'cX', null, null);
-- ---- pools (two pools of three) then a knockout without a third-place match
select t.ent('pA1', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b311');
select t.ent('pA2', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b312');
select t.ent('pA3', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b313');
select t.ent('pB1', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b314');
select t.ent('pB2', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b315');
select t.ent('pB3', '00000000-0000-0000-0000-00000000b812', null, '00000000-0000-0000-0000-00000000b316');
select t.mkm('pf', '00000000-0000-0000-0000-00000000b812', 'final', 'Final', 0, null, null, null, null, null);
select t.mkm('ps1', '00000000-0000-0000-0000-00000000b812', 'elimination', 'Semifinal', 0, null, 'pA1', 'pB2', 'pf', 'a');
select t.mkm('ps2', '00000000-0000-0000-0000-00000000b812', 'elimination', 'Semifinal', 1, null, 'pB1', 'pA2', 'pf', 'b');
select t.mkm('pa12', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool A', 0, 'A', 'pA1', 'pA2', null, null);
select t.mkm('pa13', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool A', 1, 'A', 'pA1', 'pA3', null, null);
select t.mkm('pa23', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool A', 2, 'A', 'pA2', 'pA3', null, null);
select t.mkm('pb12', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool B', 0, 'B', 'pB1', 'pB2', null, null);
select t.mkm('pb13', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool B', 1, 'B', 'pB1', 'pB3', null, null);
select t.mkm('pb23', '00000000-0000-0000-0000-00000000b812', 'pool', 'Pool B', 2, 'B', 'pB2', 'pB3', null, null);
-- ---- no tier
select t.ent('nA', '00000000-0000-0000-0000-00000000b813', null, '00000000-0000-0000-0000-00000000b314');
select t.ent('nB', '00000000-0000-0000-0000-00000000b813', null, '00000000-0000-0000-0000-00000000b315');
select t.mkm('n1', '00000000-0000-0000-0000-00000000b813', 'round_robin', 'RR', 0, null, 'nA', 'nB', null, null);

-- ================================================================ C. rosters and mercenaries
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('the organizer sets a roster; a team member is a fighter, a member of another team a mercenary, a team-less person a guest',
  public.set_entry_roster(t.gu('e:tA'), jsonb_build_array(
    jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b301'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b302'),
    jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b303'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b305'))), 4);
select t.expect_eq('roles were derived', (select string_agg(fighter_id::text || ':' || role, ',' order by fighter_id) from public.entry_fighters where entry_id = t.gu('e:tA')),
  '00000000-0000-0000-0000-00000000b301:fighter,00000000-0000-0000-0000-00000000b302:fighter,00000000-0000-0000-0000-00000000b303:mercenary,00000000-0000-0000-0000-00000000b305:guest');
select t.expect_eq('the mercenary row snapshots the home team', (select permanent_team_id from public.entry_fighters where entry_id = t.gu('e:tA') and role = 'mercenary'), '00000000-0000-0000-0000-00000000b202'::uuid);
select t.as_admin();
select t.expect_eq('a mercenary does NOT change fighters.team_id', (select team_id from public.fighters where id = '00000000-0000-0000-0000-00000000b303'), '00000000-0000-0000-0000-00000000b202'::uuid);
select t.expect_eq('... nor team_memberships (still one membership, not a mercenary, still on the home team)', (select count(*) from public.team_memberships
  where fighter_id = '00000000-0000-0000-0000-00000000b303' and team_id = '00000000-0000-0000-0000-00000000b202' and not mercenary and to_date is null), 1::bigint);
select t.expect_eq('... and added no membership for the lending team', (select count(*) from public.team_memberships where fighter_id = '00000000-0000-0000-0000-00000000b303'), 1::bigint);
select t.expect_eq('... and the guest got no team', (select team_id is null from public.fighters where id = '00000000-0000-0000-0000-00000000b305'), true);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a fighter cannot be on two entries of the same competition', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b303')))$q$, t.g('e:tB')), '23505');
select t.expect_error('a fighter of another team cannot be listed as a plain fighter', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b301', 'role', 'fighter')))$q$, t.g('e:tB')), '22023');
select t.expect_error('a member of the entry''s own team cannot be a mercenary', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304', 'role', 'mercenary')))$q$, t.g('e:tB')), '22023');
select t.expect_error('an unknown role is refused', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304', 'role', 'captain')))$q$, t.g('e:tB')), '22023');
select t.expect_error('the same fighter twice in one roster is refused', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304')))$q$, t.g('e:tB')), '22023');
select t.expect_error('a duel entry has no roster', format($q$select public.set_entry_roster(%L, '[]'::jsonb)$q$, t.g('e:s1')), '22023');
select t.expect_error('a roster that fails half way changes nothing', format($q$select public.set_entry_roster(%L, jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b301'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b302', 'role', 'captain')))$q$, t.g('e:tA')), '22023');
select t.expect_eq('... still 4 on the first entry', (select count(*) from public.entry_fighters where entry_id = t.gu('e:tA')), 4::bigint);
select t.expect_eq('the second entry''s own member is accepted', public.set_entry_roster(t.gu('e:tB'), jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304'))), 1);
select t.as_user('00000000-0000-0000-0000-00000000e006');
select t.expect_error('a stranger cannot set a roster', format($q$select public.set_entry_roster(%L, '[]'::jsonb)$q$, t.g('e:tA')), '42501');
select t.expect_error('nobody can write entry_fighters directly', format($q$insert into public.entry_fighters (entry_id, fighter_id) values (%L, '00000000-0000-0000-0000-00000000b304')$q$, t.g('e:tA')));
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_error('an organizer of another event cannot set it either', format($q$select public.set_entry_roster(%L, '[]'::jsonb)$q$, t.g('e:tA')), '42501');
select t.as_anon();
select t.expect_eq('anon reads the roster of a public event', (select count(*) from public.entry_roster where entry_id = t.gu('e:tA')), 4::bigint);
select t.expect_eq('... with the lending team named for the mercenary', (select permanent_team_name from public.entry_roster where entry_id = t.gu('e:tA') and role = 'mercenary'), 'NT Two');

-- ================================================================ D. finish_competition: elimination with byes and a third-place match
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a competition cannot be finished while a match is open', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), 'P0001');
select t.fin('eq2', 'a', 5, 3);
select t.fin('eq4', 'a', 5, 2);
select t.fin('es1', 'a', 5, 1);
select t.fin('es2', 'b', 2, 5);
select t.expect_eq('semifinal losers were routed into the third-place match', (select count(*) from public.matches where id = t.gu('m:e3') and entry_a = t.gu('e:s4') and entry_b = t.gu('e:s2')), 1::bigint);
select t.fin('ef', 'a', 5, 4);
select t.expect_error('one match still open (third place)', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), 'P0001');
select t.fin('e3', 'b', 3, 5);
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_error('an organizer of another event cannot finish it', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), '42501');
select t.as_user('00000000-0000-0000-0000-00000000e006');
select t.expect_error('a stranger cannot finish a competition', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), '42501');
select t.as_anon();
select t.expect_error('anon cannot finish a competition', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('an unknown multiplier source is refused', format($q$select public.finish_competition(%L, 'bogus')$q$, '00000000-0000-0000-0000-00000000b801'), '22023');
select t.expect_eq('finishing ranks every entry that is not withdrawn', public.finish_competition('00000000-0000-0000-0000-00000000b801'), 6);
select t.expect_eq('elimination places: champion, runner-up, third-place winner, third-place loser, quarterfinal losers share 5th',
  (select string_agg(k || '=' || t.place('00000000-0000-0000-0000-00000000b801', k)::text, ',' order by k) from unnest(array['s1','s2','s3','s4','s5','s6']) k), 's1=1,s2=3,s3=2,s4=4,s5=5,s6=5');
select t.expect_eq('elimination points (wins 1/2 + placement 6/4/2, Classic x1): bye entry s1 = 2 elimination wins + gold', t.pts('00000000-0000-0000-0000-00000000b801', 's1'), 10::numeric);
select t.expect_eq('s3 = 2 elimination wins + silver', t.pts('00000000-0000-0000-0000-00000000b801', 's3'), 8::numeric);
select t.expect_eq('s2 = third-place win + bronze', t.pts('00000000-0000-0000-0000-00000000b801', 's2'), 4::numeric);
select t.expect_eq('s4 = one quarterfinal win, nothing else', t.pts('00000000-0000-0000-0000-00000000b801', 's4'), 2::numeric);
select t.expect_eq('s5 and s6 score nothing', t.pts('00000000-0000-0000-0000-00000000b801', 's5') + t.pts('00000000-0000-0000-0000-00000000b801', 's6'), 0::numeric);
select t.expect_eq('the withdrawn entry has no result', (select count(*) from public.results where entry_id = t.gu('e:s7')), 0::bigint);
select t.expect_eq('the competition is finished', (select status from public.competitions where id = '00000000-0000-0000-0000-00000000b801'), 'finished');
select t.expect_eq('finishing again recomputes the same thing (idempotent)', public.finish_competition('00000000-0000-0000-0000-00000000b801'), 6);
select t.expect_eq('... no duplicate rows', (select count(*) from public.results where competition_id = '00000000-0000-0000-0000-00000000b801'), 6::bigint);
select t.expect_eq('... same points', (select sum(points) from public.results where competition_id = '00000000-0000-0000-0000-00000000b801'), 24::numeric);
select t.expect_eq('finishing was audited', (select count(*) from public.audit_log where action = 'competition.finished' and subject = '00000000-0000-0000-0000-00000000b801'), 2::bigint);
-- reopening a match un-finishes the competition
select t.expect_ok('an organizer reopens the third-place match', format($q$select public.reopen_match(%L, 'wrong score')$q$, t.g('m:e3')));
select t.expect_eq('the competition is running again', (select status from public.competitions where id = '00000000-0000-0000-0000-00000000b801'), 'running');
select t.expect_eq('its results were cleared', (select count(*) from public.results where competition_id = '00000000-0000-0000-0000-00000000b801'), 0::bigint);
select t.expect_error('it cannot be finished with the match open', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b801'), 'P0001');
select t.fin('e3', 'b', 3, 5);
select t.expect_eq('finishing again after the correction works', public.finish_competition('00000000-0000-0000-0000-00000000b801'), 6);
select t.expect_eq('the unfinish was audited', (select count(*) from public.audit_log where action = 'competition.reopened' and subject = '00000000-0000-0000-0000-00000000b801'), 1::bigint);

-- ---- round robin: head-to-head beats points scored
select t.fin('rab', 'a', 5, 2);
select t.fin('rac', 'a', 5, 4);
select t.fin('rda', 'a', 5, 3);
select t.fin('rbc', 'a', 10, 7);
select t.fin('rbd', 'a', 7, 5);
select t.fin('rcd', 'a', 5, 0);
select t.expect_eq('round robin result rows', public.finish_competition('00000000-0000-0000-0000-00000000b802'), 4);
select t.expect_eq('round robin places: A and B level on wins and difference, A beat B, so A first although B scored more', (select string_agg(k || '=' || t.place('00000000-0000-0000-0000-00000000b802', k)::text, ',' order by k) from unnest(array['rA','rB','rC','rD']) k), 'rA=1,rB=2,rC=3,rD=4');
select t.expect_eq('round robin points (wins + placement) x Source 0.5 (tournament structure): A 8 -> 4, B 6 -> 3, C 3 -> 1.5, D 1 -> 0.5',
  (select string_agg(t.pts('00000000-0000-0000-0000-00000000b802', k)::text, ',' order by k) from unnest(array['rA','rB','rC','rD']) k), '4.00,3.00,1.50,0.50');

-- ---- a cycle: everything is level, so all three share first place
select t.fin('cxy', 'a', 5, 3, '{"kind":"duel","rounds":{"a":[2,1,2],"b":[1,2,0]}}'::jsonb);
select t.fin('cyz', 'a', 5, 3);
select t.fin('czx', 'a', 5, 3);
select t.expect_eq('cycle result rows', public.finish_competition('00000000-0000-0000-0000-00000000b811'), 3);
select t.expect_eq('a full tie shares the place (and the placement points)', (select string_agg(t.place('00000000-0000-0000-0000-00000000b811', k)::text || '/' || t.pts('00000000-0000-0000-0000-00000000b811', k)::text, ',' order by k) from unnest(array['cX','cY','cZ']) k), '1/7.00,1/7.00,1/7.00');

-- ---- pools then knockout without a third-place match
select t.fin('pa12', 'a', 5, 0);
select t.fin('pa13', 'a', 5, 0);
select t.fin('pa23', 'a', 5, 2);
select t.fin('pb12', 'a', 5, 1);
select t.fin('pb13', 'a', 5, 4);
select t.fin('pb23', 'a', 5, 4);
select t.fin('ps1', 'a', 5, 2);
select t.fin('ps2', 'a', 5, 3);
select t.fin('pf', 'a', 5, 1);
select t.expect_eq('pools result rows', public.finish_competition('00000000-0000-0000-0000-00000000b812'), 6);
select t.expect_eq('pools + knockout places: final, semifinal losers share 3rd (no third-place match), pool-only entries after them ordered by difference',
  (select string_agg(k || '=' || t.place('00000000-0000-0000-0000-00000000b812', k)::text, ',' order by k) from unnest(array['pA1','pA2','pA3','pB1','pB2','pB3']) k), 'pA1=1,pA2=3,pA3=6,pB1=2,pB2=3,pB3=5');
select t.expect_eq('pools points x Regional 1.25 (tournament structure): A1 (4 wins + gold = 12) 15, B1 (3 wins + silver = 8) 10, A2 and B2 (1 pool win + bronze = 3) 3.75, pool-only entries 0',
  (select string_agg(t.pts('00000000-0000-0000-0000-00000000b812', k)::text, ',' order by k) from unnest(array['pA1','pA2','pA3','pB1','pB2','pB3']) k), '15.00,3.75,0.00,10.00,3.75,0.00');
select t.expect_eq('the same competition with the league-structure multiplier (x1.5)', public.finish_competition('00000000-0000-0000-0000-00000000b812', 'league_structure'), 6);
select t.expect_eq('... A1 is now 18', t.pts('00000000-0000-0000-0000-00000000b812', 'pA1'), 18::numeric);
select t.expect_eq('back to the default source', public.finish_competition('00000000-0000-0000-0000-00000000b812'), 6);
select t.expect_eq('... A1 is 15 again', t.pts('00000000-0000-0000-0000-00000000b812', 'pA1'), 15::numeric);
-- no tier: places, but no points
select t.fin('n1', 'a', 10, 9);
select t.expect_eq('a competition without a tier is finished', public.finish_competition('00000000-0000-0000-0000-00000000b813'), 2);
select t.expect_eq('... places are stored, points are 0 (no tier, no league points)', (select string_agg(final_place::text || '/' || points::text, ',' order by final_place) from public.results where competition_id = '00000000-0000-0000-0000-00000000b813'), '1/0,2/0');
select t.as_admin();
select t.mkm('n2', '00000000-0000-0000-0000-00000000b813', 'round_robin', 'RR', 1, null, 'nB', 'nA', null, null);
select t.expect_eq('a new unfinished match in a finished competition reopens it', (select status || '/' || (select count(*) from public.results where competition_id = '00000000-0000-0000-0000-00000000b813')::text from public.competitions where id = '00000000-0000-0000-0000-00000000b813'), 'running/0');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('... and it cannot be finished until the new match is played', format($q$select public.finish_competition(%L)$q$, '00000000-0000-0000-0000-00000000b813'), 'P0001');
select t.fin('n2', 'a', 10, 9);
select t.expect_eq('after the extra match each entry has one win and the same score line, so they share first place', public.finish_competition('00000000-0000-0000-0000-00000000b813'), 2);
select t.expect_eq('... both are first', (select string_agg(final_place::text, ',' order by final_place) from public.results where competition_id = '00000000-0000-0000-0000-00000000b813'), '1,1');

-- ================================================================ D. rosters feed the 5v5 result and the statistics
select t.fin('t1', 'a', 2, 1, '{"kind":"group","roundsToWin":2,"roundsWon":{"a":2,"b":1},"roundsPlayed":3}'::jsonb);
select t.expect_eq('the 5v5 competition finishes', public.finish_competition('00000000-0000-0000-0000-00000000b803'), 2);
select t.expect_error('a finished competition''s roster is locked', format($q$select public.set_entry_roster(%L, '[]'::jsonb)$q$, t.g('e:tA')), 'P0001');
select t.expect_eq('team points: A = 1 win + gold = 7, B = 4 (silver), x Classic 1', (select string_agg(t.pts('00000000-0000-0000-0000-00000000b803', k)::text, ',' order by k) from unnest(array['tA','tB']) k), '7.00,4.00');
select t.as_anon();
select t.expect_eq('anon: team_stats for the winner (events/matches/5v5/3v3/wins/losses/win%/golds/podiums/tournament wins/points/form)', (select events || '/' || matches || '/' || matches_5v5 || '/' || matches_3v3 || '/' || wins || '/' || losses || '/' || win_pct || '/' || golds || '/' || podiums || '/' || tournament_wins || '/' || points || '/' || recent_form
  from public.team_stats where team_slug = 'nt-one'), '1/1/1/0/1/0/100.0/1/1/1/7.00/W');
select t.expect_eq('anon: team_stats for the loser', (select matches || '/' || wins || '/' || losses || '/' || silvers || '/' || recent_form from public.team_stats where team_slug = 'nt-two'), '1/0/1/1/L');
select t.expect_eq('anon: a team with no matches has zeros and a null win rate', (select matches::text || '/' || coalesce(win_pct::text, 'null') || '/' || recent_form from public.team_stats where team_slug = 'nt-three'), '0/null/');
select t.expect_eq('a mercenary appears in the melee stats of the entry he fought for (rounds from detail)', (select matches || '/' || wins || '/' || rounds_won || '/' || rounds_lost
  from public.fighter_match_stats where fighter_id = '00000000-0000-0000-0000-00000000b303' and category = '5v5'), '1/1/2/1');
select t.expect_eq('... and in his career: events, matches, wins, losses, win%, golds, podiums, tournament victories, points', (select events_attended || '/' || matches || '/' || wins || '/' || losses || '/' || win_pct || '/' || golds || '/' || podiums || '/' || tournament_victories || '/' || points
  from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000b303'), '1/1/1/0/100.0/1/1/1/7.00');
select t.expect_eq('the opposing roster fighter has a loss and a silver', (select matches || '/' || losses || '/' || silvers || '/' || points from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000b304'), '1/1/1/4.00');
select t.expect_eq('every rostered fighter of the winning entry gets the appearance', (select count(*) from public.fighter_match_rows where fighter_id in ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-00000000b302', '00000000-0000-0000-0000-00000000b305') and category = '5v5'), 3::bigint);
select t.expect_eq('duel stats: fighter One in longsword: matches, wins, losses, rounds (fall back to the scores), points for/against',
  (select matches || '/' || wins || '/' || losses || '/' || rounds_won || '/' || rounds_lost || '/' || points_for || '/' || points_against from public.fighter_match_stats
   where fighter_id = '00000000-0000-0000-0000-00000000b311' and category = 'longsword'), '2/2/0/10/5/10/5');
select t.expect_eq('duel stats: rounds come from detail when stored (2 won, 1 lost) and from the scores otherwise (3, 5)',
  (select rounds_won || '/' || rounds_lost || '/' || points_for || '/' || points_against from public.fighter_match_stats where fighter_id = '00000000-0000-0000-0000-00000000b311' and category = 'sword_shield'), '5/6/8/8');
select t.expect_eq('stats are split by season and organization (Ranking League season)', (select count(*) from public.fighter_match_stats where fighter_id = '00000000-0000-0000-0000-00000000b311'
  and season_id = '00000000-0000-0000-0000-00000000b502' and organization_id = '00000000-0000-0000-0000-00000000b103'), 2::bigint);
select t.expect_eq('fighter career: events, matches, wins, losses, draws, win%, golds, silvers, bronzes, podiums, tournament victories, points',
  (select events_attended || '/' || matches || '/' || wins || '/' || losses || '/' || draws || '/' || win_pct || '/' || golds || '/' || silvers || '/' || bronzes || '/' || podiums || '/' || tournament_victories || '/' || points
   from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000b311'), '2/11/9/2/0/81.8/3/1/0/4/3/35.00');
select t.expect_eq('fighter season stats (only events with a season)', (select events_attended || '/' || matches || '/' || wins || '/' || losses || '/' || golds || '/' || silvers || '/' || points
  from public.fighter_season_stats where fighter_id = '00000000-0000-0000-0000-00000000b311' and season_id = '00000000-0000-0000-0000-00000000b502'), '1/5/4/1/1/1/13.00');
select t.expect_eq('events without a season have no season row', (select count(*) from public.fighter_season_stats where fighter_id = '00000000-0000-0000-0000-00000000b311'), 1::bigint);

-- ================================================================ D. rankings agree with the results
select t.expect_eq('ranking_fighters (organization, all categories): points are the sum of results.points',
  (select string_agg(right(fighter_id::text, 4) || '=' || points::text || '#' || rank, ',' order by rank, fighter_id) from public.ranking_fighters
   where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000b103' and fighter_id in ('00000000-0000-0000-0000-00000000b311', '00000000-0000-0000-0000-00000000b313', '00000000-0000-0000-0000-00000000b312', '00000000-0000-0000-0000-00000000b304', '00000000-0000-0000-0000-00000000b314', '00000000-0000-0000-0000-00000000b315')),
  'b311=13.00#1,b313=9.50#2,b312=8.00#3,b304=4.00#8,b314=2.50#9,b315=0.00#10');
select t.expect_eq('ties share a rank and skip the next ones (four fighters on 7 points are all 4th)', (select count(*) from public.ranking_fighters where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000b103' and points = 7 and rank = 4), 4::bigint);
select t.expect_eq('no pair of fighters is ranked against their points (any scope)', (select count(*) from public.ranking_fighters a join public.ranking_fighters b
  on a.scope = b.scope and a.organization_id is not distinct from b.organization_id and a.season_id is not distinct from b.season_id and a.category is not distinct from b.category and a.gender is not distinct from b.gender
  where a.points > b.points and a.rank >= b.rank), 0::bigint);
select t.expect_eq('ranking per category (organization career, longsword, open)', (select string_agg(right(fighter_id::text, 4) || '#' || rank, ',' order by rank, fighter_id) from public.ranking_fighters
  where scope = 'org_career' and organization_id = '00000000-0000-0000-0000-00000000b103' and category = 'longsword' and gender = 'open'), 'b311#1,b313#2,b312#3,b314#4,b315#5,b316#5');
select t.expect_eq('ranking per season, category and gender', (select count(*) from public.ranking_fighters where scope = 'season' and season_id = '00000000-0000-0000-0000-00000000b502' and category = '5v5' and gender = 'men'), 5::bigint);
select t.expect_eq('the career scope sums everything (all organizations and categories)', (select points from public.ranking_fighters where scope = 'career' and fighter_id = '00000000-0000-0000-0000-00000000b311'), 35::numeric);
select t.expect_eq('career ranking agrees with fighter_career_stats for everybody', (select count(*) from public.ranking_fighters r join public.fighter_career_stats c on c.fighter_id = r.fighter_id where r.scope = 'career' and r.points <> c.points), 0::bigint);
select t.expect_eq('ranking_teams (organization, all categories)', (select string_agg(team_slug || '=' || points::text || '#' || rank, ',' order by rank) from public.ranking_teams where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000b103'), 'nt-one=7.00#1,nt-two=4.00#2');
select t.expect_eq('events of other organizations never mix into an organization ranking (Alpha has 7 here, 7 more in NACL, 14 in the career)', (select points::text || '/' || (select points::text from public.ranking_fighters where scope = 'career' and fighter_id = '00000000-0000-0000-0000-00000000b301') from public.ranking_fighters where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000b103' and fighter_id = '00000000-0000-0000-0000-00000000b301'), '7.00/14.00');
select t.expect_eq('statistics and rankings expose no account ids', (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('ranking_fighters', 'ranking_teams', 'fighter_career_stats', 'team_stats', 'fighter_match_stats', 'fighter_season_stats', 'fighter_results', 'team_results', 'entry_roster')
  and column_name ~ '(^|_)(user|actor|account|by)(_id)?$'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the owner disables the ranking league', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b103', false)$q$);
select t.as_anon();
select t.expect_eq('rankings of a disabled organization whose events are all in the past are unchanged', (select points from public.ranking_fighters where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000b103' and fighter_id = '00000000-0000-0000-0000-00000000b311'), 13::numeric);
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('... and re-enabled', $q$select public.set_organization_enabled('00000000-0000-0000-0000-00000000b103', true)$q$);

-- ================================================================ C. scheduling conflicts (same fighter in a 5v5 roster and a longsword duel)
select t.as_admin();
insert into nx values ('t0', (date_trunc('day', now()) + interval '30 days 10 hours')::text);
select t.ent('cl_a', '00000000-0000-0000-0000-00000000b821', null, '00000000-0000-0000-0000-00000000b301');
select t.ent('cl_b', '00000000-0000-0000-0000-00000000b821', null, '00000000-0000-0000-0000-00000000b302');
select t.ent('cl_d', '00000000-0000-0000-0000-00000000b821', null, '00000000-0000-0000-0000-00000000b304');
select t.ent('c5_a', '00000000-0000-0000-0000-00000000b822', '00000000-0000-0000-0000-00000000b201', null);
select t.ent('c5_b', '00000000-0000-0000-0000-00000000b822', '00000000-0000-0000-0000-00000000b202', null);
select t.mkm('l1', '00000000-0000-0000-0000-00000000b821', 'round_robin', 'RR', 0, null, 'cl_a', 'cl_d', null, null, t.g('t0')::timestamptz, 15);
select t.mkm('l2', '00000000-0000-0000-0000-00000000b821', 'round_robin', 'RR', 1, null, 'cl_b', 'cl_a', null, null, t.g('t0')::timestamptz + interval '15 minutes', 15);
select t.mkm('l3', '00000000-0000-0000-0000-00000000b821', 'round_robin', 'RR', 2, null, 'cl_a', 'cl_b', null, null, null, 15);
select t.mkm('l4', '00000000-0000-0000-0000-00000000b821', 'round_robin', 'RR', 3, null, 'cl_a', 'cl_d', null, null, t.g('t0')::timestamptz + interval '12 minutes', 15);
update public.matches set queue_state = 'final', result = 'a', winner_entry_id = entry_a, score_a = 5, score_b = 0 where id = t.gu('m:l4');
select t.mkm('m1', '00000000-0000-0000-0000-00000000b822', 'round_robin', 'RR', 0, null, 'c5_a', 'c5_b', null, null, t.g('t0')::timestamptz + interval '10 minutes', 20);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('rosters for the conflict event: home team and lending team', public.set_entry_roster(t.gu('e:c5_a'), jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b301'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b302'))), 2);
select t.expect_eq('... second roster (a mercenary is fine, the same fighter is not on the other entry)', public.set_entry_roster(t.gu('e:c5_b'), jsonb_build_array(jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b303'), jsonb_build_object('fighter_id', '00000000-0000-0000-0000-00000000b304'))), 2);
select t.expect_eq('conflicts: 4 rows (Alpha and Delta overlap the 5v5 by 5 minutes, Alpha and Bravo by 15); touching matches, unscheduled and final matches are ignored',
  (select count(*) || '/' || sum(overlap_minutes) || '/' || count(distinct fighter_id) from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413')), '4/40/3');
select t.expect_eq('each conflict names both matches in time order', (select count(*) from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413') where match_a = t.gu('m:l1') and match_b = t.gu('m:m1') and competition_a = '00000000-0000-0000-0000-00000000b821' and competition_b = '00000000-0000-0000-0000-00000000b822'), 2::bigint);
select t.expect_eq('... and no pair involves the final or the unscheduled match', (select count(*) from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413') where t.gu('m:l3') in (match_a, match_b) or t.gu('m:l4') in (match_a, match_b)), 0::bigint);
select t.expect_eq('a longsword match that starts when the previous ends is not a conflict (L1 and L2)', (select count(*) from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413') where match_a = t.gu('m:l1') and match_b = t.gu('m:l2')), 0::bigint);
select t.expect_eq('the booking helper says Alpha is booked at 10:12 (longsword and 5v5)', public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b301', t.g('t0')::timestamptz + interval '12 minutes', 5), true);
select t.expect_eq('... Echo is not booked', public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b305', t.g('t0')::timestamptz + interval '12 minutes', 5), false);
select t.expect_eq('... Alpha is free at 12:00', public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b301', t.g('t0')::timestamptz + interval '2 hours', 15), false);
select t.expect_eq('a mercenary on a roster is booked through the roster (Charlie, only the 5v5)', public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b303', t.g('t0')::timestamptz + interval '20 minutes', 5), true);
select t.expect_eq('... unless the form excludes the match being edited', public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b303', t.g('t0')::timestamptz + interval '20 minutes', 5, t.gu('m:m1')), false);
select t.expect_eq('bookings list the overlapping matches with the overlap', (select string_agg(competition_name || ':' || overlap_minutes, ',' order by scheduled_at) from public.fighter_bookings('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b301', t.g('t0')::timestamptz + interval '5 minutes', 15)), 'Conflict Longsword:10,Conflict 5v5:10,Conflict Longsword:5');
select t.expect_ok('the organizer shortens the 5v5 match to 5 minutes', format($q$update public.matches set duration_minutes = 5 where id = %L$q$, t.g('m:m1')));
select t.expect_eq('... Alpha/Bravo no longer overlap (it ends when the second longsword match starts), Alpha and Delta still do with the first', (select count(*) from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413')), 2::bigint);
select t.expect_error('a match length of 0 is refused', format($q$update public.matches set duration_minutes = 0 where id = %L$q$, t.g('m:m1')), '23514');
select t.expect_ok('back to 20 minutes', format($q$update public.matches set duration_minutes = 20 where id = %L$q$, t.g('m:m1')));
select t.as_user('00000000-0000-0000-0000-00000000e006');
select t.expect_error('a stranger cannot see conflicts', $q$select * from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413')$q$, '42501');
select t.expect_error('a stranger cannot ask about bookings', $q$select public.fighter_is_booked('00000000-0000-0000-0000-00000000b413', '00000000-0000-0000-0000-00000000b301', now(), 5)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000e005');
select t.expect_error('an organizer of another event cannot see conflicts', $q$select * from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413')$q$, '42501');
select t.as_anon();
select t.expect_error('anon cannot call the conflict function', $q$select * from public.fighter_schedule_conflicts('00000000-0000-0000-0000-00000000b413')$q$, '42501');
select t.expect_eq('rosters of a draft event are not public', (select count(*) from public.entry_fighters where competition_id = '00000000-0000-0000-0000-00000000b822'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('... but the organizer sees them', (select count(*) from public.entry_fighters where competition_id = '00000000-0000-0000-0000-00000000b822'), 4::bigint);

-- ================================================================ B. fighter profile
select t.as_anon();
select t.expect_eq('anon reads a profile (no profile data yet, team and organization present, no age)', (select coalesce(age::text, 'null') || '/' || team_name || '/' || team_organization_name || '/' || cardinality(disciplines)
  from public.fighter_profile('00000000-0000-0000-0000-00000000b301')), 'null/NT One/Northern Armored Combat League-test/0');
select t.expect_error('anon cannot update a profile', $q$select public.update_my_fighter_profile('{"bio":"x"}'::jsonb)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000e009');
select t.expect_error('a user with no fighter record cannot update a profile', $q$select public.update_my_fighter_profile('{"bio":"x"}'::jsonb)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000e003');
select t.expect_ok('a fighter fills in their own profile', $q$select public.update_my_fighter_profile(jsonb_build_object('gender', 'male', 'birth_year', 1990, 'city', 'Edmonton', 'region', 'AB', 'country', 'CA',
  'joined_year', 2019, 'disciplines', jsonb_build_array('longsword', '5v5'), 'fighting_style', 'Aggressive pressure', 'bio', 'Fights for the fun of it.', 'highlights', jsonb_build_array('NACL champion 2025')))$q$);
select t.as_anon();
select t.expect_eq('the public sees it, and the age is computed', (select gender || '/' || (age = extract(year from current_date)::int - 1990)::text || '/' || city || '/' || region || '/' || country || '/' || joined_year || '/' || array_to_string(disciplines, '+') || '/' || fighting_style || '/' || bio || '/' || highlights[1]
  from public.fighter_profile('00000000-0000-0000-0000-00000000b301')), 'male/true/Edmonton/AB/CA/2019/longsword+5v5/Aggressive pressure/Fights for the fun of it./NACL champion 2025');
select t.expect_eq('the profile can be read straight from fighters too', (select count(*) from public.fighters where id = '00000000-0000-0000-0000-00000000b301' and bio is not null), 1::bigint);
select t.expect_eq('fighter_profile exposes no account id', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fighter_profile'
  and exists (select 1 from unnest(p.proargnames) a where a ~ '(user|account|actor)')), 0::bigint);
select t.expect_eq('fighters has no account column', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fighters' and column_name ~ '(user|account|actor|email)'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-00000000e003');
select t.expect_ok('null clears a field', $q$select public.update_my_fighter_profile('{"city": null, "highlights": null}'::jsonb)$q$);
select t.expect_eq('... it is cleared', (select (city is null)::text || '/' || cardinality(highlights) from public.fighters where id = '00000000-0000-0000-0000-00000000b301'), 'true/0');
select t.expect_error('an unknown gender is refused', $q$select public.update_my_fighter_profile('{"gender":"robot"}'::jsonb)$q$, '22023');
select t.expect_error('an unknown key is refused (no team_id, no display_name)', $q$select public.update_my_fighter_profile('{"team_id":"00000000-0000-0000-0000-00000000b202"}'::jsonb)$q$, '22023');
select t.expect_error('display_name is not editable here', $q$select public.update_my_fighter_profile('{"display_name":"Somebody Else"}'::jsonb)$q$, '22023');
select t.expect_error('an unknown discipline is refused', $q$select public.update_my_fighter_profile('{"disciplines":["longsword","quidditch"]}'::jsonb)$q$, '22023');
select t.expect_error('a discipline listed twice is refused', $q$select public.update_my_fighter_profile('{"disciplines":["longsword","longsword"]}'::jsonb)$q$, '22023');
select t.expect_error('a bio over 1500 characters is refused', format($q$select public.update_my_fighter_profile(jsonb_build_object('bio', %L))$q$, repeat('b', 1501)), '22023');
select t.expect_ok('a bio of exactly 1500 characters is fine', format($q$select public.update_my_fighter_profile(jsonb_build_object('bio', %L))$q$, repeat('b', 1500)));
select t.expect_error('a future birth year is refused', $q$select public.update_my_fighter_profile('{"birth_year":2999}'::jsonb)$q$, '22023');
select t.expect_error('a text birth year is refused', $q$select public.update_my_fighter_profile('{"birth_year":"soon"}'::jsonb)$q$, '22023');
select t.expect_error('more than 10 highlights are refused', $q$select public.update_my_fighter_profile((select jsonb_build_object('highlights', jsonb_agg('h' || n)) from generate_series(1, 11) n))$q$, '22023');
select t.expect_error('a highlight over 200 characters is refused', format($q$select public.update_my_fighter_profile(jsonb_build_object('highlights', jsonb_build_array(%L)))$q$, repeat('h', 201)), '22023');
select t.expect_error('a city over 80 characters is refused', format($q$select public.update_my_fighter_profile(jsonb_build_object('city', %L))$q$, repeat('c', 81)), '22023');
select t.expect_error('a non-object payload is refused', $q$select public.update_my_fighter_profile('[]'::jsonb)$q$, '22023');
select t.expect_error('a fighter cannot write fighters directly', $q$update public.fighters set bio = 'direct' where id = '00000000-0000-0000-0000-00000000b301'$q$, '42501');
select t.expect_error('... nor someone else''s', $q$update public.fighters set bio = 'direct' where id = '00000000-0000-0000-0000-00000000b302'$q$, '42501');
select t.as_admin();
select t.expect_eq('updating the profile never touched another fighter or the team', (select count(*) from public.fighters where id <> '00000000-0000-0000-0000-00000000b301' and (bio is not null or gender is not null)), 0::bigint);
select t.expect_eq('... nor the fighter''s team', (select team_id from public.fighters where id = '00000000-0000-0000-0000-00000000b301'), '00000000-0000-0000-0000-00000000b201'::uuid);
select t.expect_error('a loader cannot insert a bad discipline either (trigger)', $q$update public.fighters set disciplines = array['nonsense'] where id = '00000000-0000-0000-0000-00000000b302'$q$, '22023');

-- ---------------------------------------------------------------- statistics count only events that have happened (20261001002300)
select t.as_admin();
insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-00000000c901', 'pe-team', 'Played Events Team', 'approved');
insert into public.fighters (id, display_name, team_id) values ('00000000-0000-0000-0000-00000000c911', 'Played Events One', '00000000-0000-0000-0000-00000000c901'), ('00000000-0000-0000-0000-00000000c912', 'Played Events Two', null);
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000c921', 'pe-future', 'Upcoming with entries', 'published', current_date + 30, current_date + 31),
  ('00000000-0000-0000-0000-00000000c922', 'pe-past', 'Past, entries only', 'published', current_date - 10, current_date - 9),
  ('00000000-0000-0000-0000-00000000c923', 'pe-live', 'Today, one final match', 'published', current_date, current_date + 1);
insert into public.competitions (id, event_id, name, category, gender) values
  ('00000000-0000-0000-0000-00000000c931', '00000000-0000-0000-0000-00000000c921', 'Future duel', 'longsword', 'men'),
  ('00000000-0000-0000-0000-00000000c932', '00000000-0000-0000-0000-00000000c922', 'Past duel', 'longsword', 'men'),
  ('00000000-0000-0000-0000-00000000c933', '00000000-0000-0000-0000-00000000c923', 'Live duel', 'longsword', 'men'),
  ('00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-00000000c921', 'Future melee', '3v3', 'men');
insert into public.entries (id, competition_id, team_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000c941', '00000000-0000-0000-0000-00000000c931', null, '00000000-0000-0000-0000-00000000c911'),
  ('00000000-0000-0000-0000-00000000c942', '00000000-0000-0000-0000-00000000c932', null, '00000000-0000-0000-0000-00000000c911'),
  ('00000000-0000-0000-0000-00000000c943', '00000000-0000-0000-0000-00000000c933', null, '00000000-0000-0000-0000-00000000c911'),
  ('00000000-0000-0000-0000-00000000c944', '00000000-0000-0000-0000-00000000c933', null, '00000000-0000-0000-0000-00000000c912'),
  ('00000000-0000-0000-0000-00000000c945', '00000000-0000-0000-0000-00000000c934', '00000000-0000-0000-0000-00000000c901', null);
insert into public.matches (id, competition_id, stage, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at)
  values ('00000000-0000-0000-0000-00000000c951', '00000000-0000-0000-0000-00000000c933', 'round_robin', '00000000-0000-0000-0000-00000000c943', '00000000-0000-0000-0000-00000000c944', 'final', 'a', '00000000-0000-0000-0000-00000000c943', 4, 1, now());
select t.as_anon();
select t.expect_eq('an upcoming event with entries is not attended; a past event with entries and today''s event with a final match are', (select events_attended from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000c911'), 2::bigint);
select t.expect_eq('the opponent attended only the event with the final match', (select events_attended from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000c912'), 1::bigint);
select t.expect_eq('a team entered only in an upcoming event has attended none', (select events from public.team_stats where team_slug = 'pe-team'), 0::bigint);
select t.expect_eq('played_events lists exactly the past event and the event with a final match', (select string_agg(e.slug, ',' order by e.slug) from public.played_events p join public.events e on e.id = p.event_id where e.slug like 'pe-%'), 'pe-live,pe-past');
select t.expect_eq('a final match still counts for the fighter (stats of matches are unchanged)', (select matches from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000c911'), 1::bigint);
select t.as_admin();
update public.events set starts_on = current_date - 3, ends_on = current_date - 2 where id = '00000000-0000-0000-0000-00000000c921';
select t.as_anon();
select t.expect_eq('once the event is in the past it counts', (select events_attended from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000c911'), 3::bigint);
select t.expect_eq('... and the team has attended it too', (select events from public.team_stats where team_slug = 'pe-team'), 1::bigint);
select t.as_admin();

-- ---------------------------------------------------------------- deleting linked matches in one statement (20261001002400)
select t.as_admin();
insert into public.competitions (id, event_id, name, category, gender) values ('00000000-0000-0000-0000-00000000c935', '00000000-0000-0000-0000-00000000c923', 'Linked matches', 'longsword', 'men');
insert into public.matches (id, competition_id, stage, round_label, position) values
  ('00000000-0000-0000-0000-00000000c961', '00000000-0000-0000-0000-00000000c935', 'final', 'Final', 0),
  ('00000000-0000-0000-0000-00000000c962', '00000000-0000-0000-0000-00000000c935', 'elimination', 'Semifinal', 0),
  ('00000000-0000-0000-0000-00000000c963', '00000000-0000-0000-0000-00000000c935', 'elimination', 'Semifinal', 1);
update public.matches set next_match_id = '00000000-0000-0000-0000-00000000c961', next_slot = 'a' where id = '00000000-0000-0000-0000-00000000c962';
update public.matches set next_match_id = '00000000-0000-0000-0000-00000000c961', next_slot = 'b' where id = '00000000-0000-0000-0000-00000000c963';
select t.expect_error('a link without a slot is still refused', $q$update public.matches set next_slot = null where id = '00000000-0000-0000-0000-00000000c962'$q$, '23514');
select t.expect_ok('deleting the final clears the link AND the slot of both semifinals', $q$delete from public.matches where id = '00000000-0000-0000-0000-00000000c961'$q$);
select t.expect_eq('... no semifinal keeps a slot without a link', (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000c935' and (next_match_id is not null or next_slot is not null)), 0::bigint);
update public.matches set next_match_id = '00000000-0000-0000-0000-00000000c963', next_slot = 'a' where id = '00000000-0000-0000-0000-00000000c962';
insert into public.matches (id, competition_id, stage, round_label, position, next_match_id, next_slot) values ('00000000-0000-0000-0000-00000000c964', '00000000-0000-0000-0000-00000000c935', 'final', 'Final', 0, null, null);
update public.matches set next_match_id = '00000000-0000-0000-0000-00000000c964', next_slot = 'b' where id = '00000000-0000-0000-0000-00000000c963';
select t.expect_ok('deleting a chain of linked matches in ONE statement works (it used to fail: tuple already modified)', $q$delete from public.matches where competition_id = '00000000-0000-0000-0000-00000000c935'$q$);
select t.expect_eq('... all gone', (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000c935'), 0::bigint);
insert into public.matches (id, competition_id, stage, round_label, position) values
  ('00000000-0000-0000-0000-00000000c965', '00000000-0000-0000-0000-00000000c935', 'final', 'Final', 0),
  ('00000000-0000-0000-0000-00000000c966', '00000000-0000-0000-0000-00000000c935', 'elimination', 'Semifinal', 0);
update public.matches set next_match_id = '00000000-0000-0000-0000-00000000c965', next_slot = 'a' where id = '00000000-0000-0000-0000-00000000c966';
select t.expect_ok('deleting the whole competition cascades without error', $q$delete from public.competitions where id = '00000000-0000-0000-0000-00000000c935'$q$);
select t.expect_eq('... and nothing is left behind', (select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000c935'), 0::bigint);

-- ---------------------------------------------------------------- every public table has row level security
select t.as_admin();
select t.expect_eq('every table in public has row level security on', (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity), 0::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
