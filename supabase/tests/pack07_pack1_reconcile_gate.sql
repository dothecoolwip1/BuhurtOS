-- Pack 07 / Pack 1 reconciliation gate (migration 20261004000200): one competition guard, the tier call, ONE "my events" rule behind both
-- my_events() and my_event_relations() (invitations included; owner and organization-admin status give nothing), and submit_registration
-- doing both packs' work (waiver version + organizer invitation from Pack 07, attendance dates from Pack 1).
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack07_pack1_reconcile_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);

create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;

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
-- The two RPCs must name exactly the same events for whoever is signed in.
create function t.mine_cards() returns text language sql as $$ select coalesce(string_agg(slug, ',' order by slug), '') from public.my_events() $$;
create function t.mine_rel() returns text language sql as $$
  select coalesce(string_agg(ev.slug, ',' order by ev.slug), '') from public.events ev where ev.id in (select event_id from public.my_event_relations()) $$;
create function t.roles(p_slug text) returns text language sql as $$
  select coalesce(string_agg(role, ',' order by role), '') from public.my_event_relations() where event_id = (select id from public.events where slug = p_slug) $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- e1 platform owner; e2 organizer; e3 organization admin; e4 fighter with an account (invited); e5 registrant; e6 captain; e7 stranger;
-- e8 volunteer; e9 scorekeeper
insert into auth.users (id, email) select t.u(n), 'rc' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values (t.u(1), 'owner'), (t.u(2), 'organizer');
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;

select t.as_user(t.u(2));
insert into ctx select 'e1', public.create_event('rc-closed-open', 'Reconcile Closed Open', date '2026-12-05', date '2026-12-06', 'Hall', 'Street');
insert into ctx select 'e2', public.create_event('rc-draft', 'Reconcile Draft', date '2026-12-12', date '2026-12-13', 'Arena', 'Road');
insert into ctx select 'e3', public.create_event('rc-open', 'Reconcile Open', date '2026-12-19', date '2026-12-20', 'Barn', 'Lane');
insert into ctx select 'k1', public.create_competition((select v from ctx where k = 'e1')::uuid, 'Longsword', 'longsword', 'open');
insert into ctx select 'k2', public.create_competition((select v from ctx where k = 'e1')::uuid, 'Men 5v5', '5v5', 'men');
insert into ctx select 'k3', public.create_competition((select v from ctx where k = 'e2')::uuid, 'Longsword', 'longsword', 'open');
insert into ctx select 'k4', public.create_competition((select v from ctx where k = 'e3')::uuid, 'Longsword', 'longsword', 'open');
select set_config('t.e1', (select v from ctx where k = 'e1'), false);
select set_config('t.e2', (select v from ctx where k = 'e2'), false);
select set_config('t.e3', (select v from ctx where k = 'e3'), false);
select set_config('t.k1', (select v from ctx where k = 'k1'), false);
select set_config('t.k2', (select v from ctx where k = 'k2'), false);
select set_config('t.k3', (select v from ctx where k = 'k3'), false);
select set_config('t.k4', (select v from ctx where k = 'k4'), false);

select t.as_admin();
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-0000000eb001', 'rc-org', 'Reconcile Org', 'club');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000eb001', t.u(3), 'admin');
-- E1: published, in the organization, registration already closed. E3: published, open. E2 stays a draft.
update public.events set status = 'published', organization_id = '00000000-0000-0000-0000-0000000eb001',
  registration_opens_at = now() - interval '10 days', registration_closes_at = now() - interval '1 day' where id = current_setting('t.e1')::uuid;
update public.events set status = 'published', organization_id = '00000000-0000-0000-0000-0000000eb001',
  registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '5 days' where id = current_setting('t.e3')::uuid;
update public.events set organization_id = '00000000-0000-0000-0000-0000000eb001' where id = current_setting('t.e2')::uuid;
insert into public.waiver_versions (event_id, version, title, body)
  select id, 1, 'Waiver', 'The full waiver text of the reconcile gate.' from public.events where slug in ('rc-closed-open', 'rc-draft', 'rc-open');
insert into public.event_staff (event_id, user_id, role) values (current_setting('t.e1')::uuid, t.u(9), 'scorekeeper');
insert into public.fighters (id, display_name, gender) values ('00000000-0000-0000-0000-0000000eb0f4', 'Reconcile Invitee', 'male');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-0000000eb0f4', t.u(4));
insert into public.teams (id, slug, name, city, region, country, status) values ('00000000-0000-0000-0000-0000000eb0a1', 'rc-team', 'Reconcile Team', 'Red Deer', 'AB', 'CA', 'approved');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-0000000eb0a1', t.u(6), 'captain');
insert into public.entries (competition_id, team_id) values (current_setting('t.k2')::uuid, '00000000-0000-0000-0000-0000000eb0a1');

-- ---------------------------------------------------------------- 1. one competition guard
select t.expect_eq('only Pack 1''s competitions_guard trigger is on competitions', (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.competitions'::regclass and not tgisinternal and tgname like '%guard%'), 'competitions_guard');
select t.expect_eq('Pack 07''s duplicate guard function is gone', (select count(*) from pg_proc where proname = 'guard_competition_delete'), 0::bigint);
select t.as_user(t.u(2));
select t.expect_error('a competition with an entry cannot be deleted through the table', $q$delete from public.competitions where id = current_setting('t.k2')::uuid$q$, 'P0001');
select t.expect_error('nor through delete_competition', $q$select public.delete_competition(current_setting('t.k2')::uuid)$q$, 'P0001');
select t.expect_eq('it is still there', (select count(*) from public.competitions where id = current_setting('t.k2')::uuid), 1::bigint);
select t.as_admin();
grant select, delete on public.competitions to service_role;   -- the hosted service role has table grants; the local stub role does not
grant usage on schema t to service_role; grant execute on all functions in schema t to service_role; grant all on t.log to service_role; grant usage on all sequences in schema t to service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select t.expect_error('the service key is guarded too (Pack 07 protection kept)', $q$delete from public.competitions where id = current_setting('t.k2')::uuid$q$, 'P0001');
reset role;
select set_config('request.jwt.claims', '', true);
select t.as_admin();
select t.expect_eq('still there', (select count(*) from public.competitions where id = current_setting('t.k2')::uuid), 1::bigint);

-- ---------------------------------------------------------------- 2. tier, the one setup field only Pack 07's editor had
select t.as_user(t.u(2));
select t.expect_ok('the organizer sets a tier', $q$select public.set_competition_tier(current_setting('t.k1')::uuid, 'Regional')$q$);
select t.expect_eq('the tier is stored', (select tier from public.competitions where id = current_setting('t.k1')::uuid), 'Regional');
select t.expect_eq('the change is audited', (select count(*) from public.audit_log where action = 'competition.tier_changed' and subject = current_setting('t.k1')), 1::bigint);
select t.expect_error('a tier must come from the list', $q$select public.set_competition_tier(current_setting('t.k1')::uuid, 'Galactic')$q$, '22023');
select t.as_user(t.u(7));
select t.expect_error('a stranger cannot set a tier', $q$select public.set_competition_tier(current_setting('t.k1')::uuid, 'Classic')$q$, '42501');
select t.as_user(t.u(3));
select t.expect_ok('an organization admin may manage their organization''s events (existing organization permission)', $q$select public.set_competition_tier(current_setting('t.k1')::uuid, 'Regional')$q$);
select t.as_anon();
select t.expect_error('anon cannot set a tier', $q$select public.set_competition_tier(current_setting('t.k1')::uuid, 'Classic')$q$, '42501');
select t.as_admin();
update public.competitions set status = 'finished' where id = current_setting('t.k4')::uuid;
select t.as_user(t.u(2));
select t.expect_error('a finished competition keeps its tier', $q$select public.set_competition_tier(current_setting('t.k4')::uuid, 'Regional')$q$, 'P0001');
select t.as_admin();
update public.competitions set status = 'registration' where id = current_setting('t.k4')::uuid;

-- ---------------------------------------------------------------- 3. registration: invitation (Pack 07) and attendance dates (Pack 1) together
select t.as_user(t.u(2));
select t.expect_ok('the organizer adds the fighter to the closed event', $q$select public.invite_fighter_to_event(current_setting('t.e1')::uuid, '00000000-0000-0000-0000-0000000eb0f4', array[current_setting('t.k1')::uuid])$q$);
select t.as_user(t.u(4));
select t.expect_ok('the added fighter completes the form after the close, with attendance dates', $q$select set_config('t.reg4', public.submit_registration(current_setting('t.e1')::uuid, jsonb_build_object(
  'full_name', 'Reconcile Invitee', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', false,
  'waiver_agree', true, 'waiver_version_id', (select id from public.waiver_versions where event_id = current_setting('t.e1')::uuid), 'waiver_signed_name', 'Reconcile Invitee',
  'attend_dates', jsonb_build_array('2026-12-06', '2026-11-30'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', current_setting('t.k1'))),
  'private', jsonb_build_object('email', 'rc4@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))::text, false)$q$);
select t.expect_eq('the invitation made it an accepted registration (Pack 07)', (select status from public.registrations where id = current_setting('t.reg4')::uuid), 'accepted');
select t.expect_eq('the invitation is linked to it', (select status from public.event_invitations where registration_id = current_setting('t.reg4')::uuid), 'registered');
select t.expect_eq('only the event''s own day is kept (Pack 1)', (select attend_dates from public.registrations where id = current_setting('t.reg4')::uuid), array[date '2026-12-06']);
select t.expect_eq('the accepted duel registration became an entry', (select count(*) from public.entries e join public.fighter_accounts a on a.fighter_id = e.fighter_id where a.user_id = t.u(4) and e.competition_id = current_setting('t.k1')::uuid), 1::bigint);

select t.as_user(t.u(5));
select t.expect_error('someone who was not added cannot register after the close', $q$select public.submit_registration(current_setting('t.e1')::uuid, jsonb_build_object(
  'full_name', 'Reconcile Five', 'gender', 'female', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', false,
  'waiver_agree', true, 'waiver_version_id', (select id from public.waiver_versions where event_id = current_setting('t.e1')::uuid), 'waiver_signed_name', 'Reconcile Five',
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', current_setting('t.k1'))),
  'private', jsonb_build_object('email', 'rc5@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$, '22023');
select t.expect_ok('ordinary self-registration on an open event, with dates', $q$select set_config('t.reg5', public.submit_registration(current_setting('t.e3')::uuid, jsonb_build_object(
  'full_name', 'Reconcile Five', 'gender', 'female', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', false,
  'waiver_agree', true, 'waiver_version_id', (select id from public.waiver_versions where event_id = current_setting('t.e3')::uuid), 'waiver_signed_name', 'Reconcile Five',
  'attend_dates', jsonb_build_array('2026-12-19', '2026-12-20'), 'days', jsonb_build_array('sat'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', current_setting('t.k4'))),
  'private', jsonb_build_object('email', 'rc5@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))::text, false)$q$);
select t.expect_eq('it waits for review, with both dates and the legacy day', (select status || '|' || attend_dates::text || '|' || days::text from public.registrations where id = current_setting('t.reg5')::uuid), 'pending|{2026-12-19,2026-12-20}|{sat}');
select t.as_admin();
insert into public.waiver_versions (event_id, version, title, body) values (current_setting('t.e3')::uuid, 2, 'Waiver', 'The second waiver text of the reconcile gate.');
select t.as_user(t.u(8));
select t.expect_error('a stale waiver version is refused (Pack 07)', $q$select public.submit_registration(current_setting('t.e3')::uuid, jsonb_build_object(
  'full_name', 'Reconcile Eight', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', true,
  'waiver_agree', true, 'waiver_version_id', (select id from public.waiver_versions where event_id = current_setting('t.e3')::uuid and version = 1), 'waiver_signed_name', 'Reconcile Eight',
  'private', jsonb_build_object('email', 'rc8@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$, '22023');
select t.expect_ok('a volunteer signs the current version', $q$select public.submit_registration(current_setting('t.e3')::uuid, jsonb_build_object(
  'full_name', 'Reconcile Eight', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member', 'is_volunteer', true,
  'waiver_agree', true, 'waiver_version_id', (select id from public.waiver_versions where event_id = current_setting('t.e3')::uuid and version = 2), 'waiver_signed_name', 'Reconcile Eight',
  'private', jsonb_build_object('email', 'rc8@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$);

-- ---------------------------------------------------------------- 4. one "my events" rule
-- a pending invitation to the published event E3 and one to the draft E2
select t.as_user(t.u(2));
select t.expect_ok('the organizer adds the fighter to the open event and the draft', $q$select public.invite_fighter_to_event(current_setting('t.e3')::uuid, '00000000-0000-0000-0000-0000000eb0f4', array[current_setting('t.k4')::uuid]),
  public.invite_fighter_to_event(current_setting('t.e2')::uuid, '00000000-0000-0000-0000-0000000eb0f4', array[current_setting('t.k3')::uuid])$q$);

select t.as_user(t.u(1));
select t.expect_eq('platform owner: nothing just for being the owner (cards)', t.mine_cards(), '');
select t.expect_eq('platform owner: nothing (calendar relations)', t.mine_rel(), '');
select t.as_user(t.u(3));
select t.expect_eq('organization admin: no organization event becomes "mine" (cards)', t.mine_cards(), '');
select t.expect_eq('organization admin: none in the relations either', t.mine_rel(), '');
select t.as_user(t.u(7));
select t.expect_eq('a stranger has none', t.mine_cards() || '/' || t.mine_rel(), '/');

select t.as_user(t.u(2));
select t.expect_eq('organizer: all three events, the draft included', t.mine_cards(), 'rc-closed-open,rc-draft,rc-open');
select t.expect_eq('organizer: the relations agree', t.mine_rel(), t.mine_cards());

select t.as_user(t.u(4));
select t.expect_eq('invited fighter: the registered event and the pending invitation, not the draft', t.mine_cards(), 'rc-closed-open,rc-open');
select t.expect_eq('invited fighter: the relations agree', t.mine_rel(), t.mine_cards());
select t.expect_eq('the pending invitation is a relationship', t.roles('rc-open'), 'invited');
select t.expect_eq('my_events marks it as invited', (select invited from public.my_events() where slug = 'rc-open'), true);
select t.expect_eq('the event they registered through an invitation is "fighter", no longer "invited"', t.roles('rc-closed-open'), 'fighter');
select t.expect_eq('with the registration on the card', (select registration_status || '|' || fighter_entry::text || '|' || invited::text from public.my_events() where slug = 'rc-closed-open'), 'accepted|true|false');

select t.as_user(t.u(5));
select t.expect_eq('registrant: the event they registered for', t.mine_cards(), 'rc-open');
select t.expect_eq('registrant: the relations agree, as fighter', t.mine_rel() || ':' || t.roles('rc-open'), 'rc-open:fighter');
select t.as_user(t.u(8));
select t.expect_eq('volunteer: the event, as volunteer, in both', t.mine_cards() || '|' || t.mine_rel() || ':' || t.roles('rc-open'), 'rc-open|rc-open:volunteer');
select t.as_user(t.u(9));
select t.expect_eq('scorekeeper: the event they staff, in both', t.mine_cards() || '|' || t.mine_rel() || ':' || t.roles('rc-closed-open'), 'rc-closed-open|rc-closed-open:scorekeeper');
select t.as_user(t.u(6));
select t.expect_eq('captain: the event their team is entered in, in both', t.mine_cards() || '|' || t.mine_rel() || ':' || t.roles('rc-closed-open'), 'rc-closed-open|rc-closed-open:captain');

-- a withdrawn registration is still the person's own event (Pack 1 rule), a cancelled invitation is not
select t.as_user(t.u(5));
select t.expect_ok('the registrant withdraws', $q$select public.withdraw_registration(current_setting('t.reg5')::uuid)$q$);
select t.expect_eq('the withdrawn registration still shows, in both, with its status', t.mine_cards() || '|' || t.mine_rel() || '|' || (select registration_status from public.my_events()), 'rc-open|rc-open|withdrawn');
select t.as_user(t.u(2));
select t.expect_ok('the organizer cancels the pending invitation', $q$select public.cancel_invitation((select id from public.event_invitations where event_id = current_setting('t.e3')::uuid and fighter_id = '00000000-0000-0000-0000-0000000eb0f4'))$q$);
select t.as_user(t.u(4));
select t.expect_eq('a cancelled invitation is no longer a relationship, in both', t.mine_cards() || '|' || t.mine_rel(), 'rc-closed-open|rc-closed-open');

select t.as_anon();
select t.expect_error('anon cannot call my_events', 'select * from public.my_events()', '42501');
select t.expect_error('anon cannot call my_event_relations', 'select * from public.my_event_relations()', '42501');
select t.as_user(t.u(4));
select t.expect_error('the rule itself is not callable by users', $q$select * from private.my_event_links('00000000-0000-0000-0000-0000000000e2')$q$, '42501');

select t.as_admin();
select t.expect_ok('a direct database session (seeds, cleanup scripts) keeps its cascades (Pack 1 rule)', $q$delete from public.competitions where id = current_setting('t.k2')::uuid$q$);
select t.expect_eq('... the competition and its entry are gone', (select count(*) from public.entries where competition_id = current_setting('t.k2')::uuid), 0::bigint);
select format('PASSED %s checks', count(*)) from t.log;
rollback;
