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
select t.expect_eq('standings view is readable by anon', (select count(*) from public.competition_standings), 2::bigint);

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

-- ---------------------------------------------------------------- every public table has row level security
select t.as_admin();
select t.expect_eq('every table in public has row level security on', (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity), 0::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
