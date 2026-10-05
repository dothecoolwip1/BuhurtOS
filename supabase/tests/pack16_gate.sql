-- Pack 16 gate: check-in, armour inspection, weigh-in, overrides and derived readiness (migration 20261010000100).
--   * who may check in / inspect / weigh in / override (event-scoped; a scorekeeper or captain gains nothing; fighters cannot clear themselves)
--   * inspection history is append-only (a failure is never overwritten); the latest is current; the old kit switch follows it
--   * readiness is derived with plain reasons; private notes and weights only for the desk; captains and Lyst staff see status words only
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack16_gate.sql
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
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c16' || n, 12, '0'))::uuid $$;
create function t.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a16' || n, 12, '0'))::uuid $$;
create function t.ev(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('e16' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('d16' || n, 12, '0'))::uuid $$;
-- the desk view of one registration, read as the event organizer (u1)
create function t.ready(n int) returns text language plpgsql security definer as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', t.u(1)::text, true);
  select (case when x.ready then 'READY' else 'NOT READY' end) || coalesce(': ' || nullif(array_to_string(x.reasons, ', '), ''), '') into v
  from public.event_readiness(t.ev(1)) x where x.registration_id = t.r(n);
  return v;
end $$;
create function t.col(n int, c text) returns text language plpgsql security definer as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', t.u(1)::text, true);
  execute format('select (x.%I)::text from public.event_readiness(%L) x where x.registration_id = %L', c, t.ev(1), t.r(n)) into v;
  return v;
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- u1 organizer, u2 head marshal, u3 check-in desk, u4 inspector, u5 scorekeeper (all event 1); u6 duel fighter; u7 team fighter;
-- u8 captain of team T; u9 stranger; u10 organizer of event 2; u11 inspector of event 2; u12 volunteer; u13 pending; u14 profight fighter.
insert into auth.users (id, email) select t.u(n), 'p16u' || n || '@example.test' from generate_series(1, 14) n;
insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-00000000f16a', 'p16-team-t', 'Team T', 'approved'), ('00000000-0000-0000-0000-00000000f16b', 'p16-team-u', 'Team U', 'approved');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000f16a', t.u(8), 'captain'), ('00000000-0000-0000-0000-00000000f16b', t.u(9), 'captain');
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-' || lpad('f16' || n, 12, '0'))::uuid, 'P16 Fighter ' || n, 'male', '{}' from generate_series(6, 14) n;
insert into public.fighter_accounts (fighter_id, user_id) select ('00000000-0000-0000-0000-' || lpad('f16' || n, 12, '0'))::uuid, t.u(n) from generate_series(6, 14) n where n in (6, 7, 14);
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  (t.ev(1), 'p16-e1', 'Readiness Open', 'published', current_date, current_date + 1), (t.ev(2), 'p16-e2', 'Other Event', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values
  (t.ev(1), t.u(1), 'organizer'), (t.ev(1), t.u(2), 'head_marshal'), (t.ev(1), t.u(3), 'check_in'), (t.ev(1), t.u(4), 'inspector'), (t.ev(1), t.u(5), 'scorekeeper'),
  (t.ev(2), t.u(10), 'organizer'), (t.ev(2), t.u(11), 'inspector');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-0000000c1601', t.ev(1), 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  ('00000000-0000-0000-0000-0000000c1602', t.ev(1), 'Profight', 'profight', 'men', 'Classic', 'round_robin', 2),
  ('00000000-0000-0000-0000-0000000c1603', t.ev(1), 'Men 5v5', '5v5', 'men', 'Classic', 'round_robin', 3);
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000a1601', t.ev(1), 1, 'Waiver', 'Fictional waiver text for the gate.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer, team_id)
select t.r(n), t.ev(1), t.u(n), case when n in (6, 7, 14) then ('00000000-0000-0000-0000-' || lpad('f16' || n, 12, '0'))::uuid end,
  case when n = 13 then 'pending' else 'accepted' end, 'Person ' || n, 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a1601', 'Person ' || n, n = 12,
  case when n = 7 then '00000000-0000-0000-0000-00000000f16a'::uuid end
from (values (6), (7), (12), (13), (14)) v(n);
insert into public.registration_competitions (registration_id, competition_id, team_id, details) values
  (t.r(6), '00000000-0000-0000-0000-0000000c1601', null, '{}'), (t.r(7), '00000000-0000-0000-0000-0000000c1603', '00000000-0000-0000-0000-00000000f16a', '{}'),
  (t.r(14), '00000000-0000-0000-0000-0000000c1602', null, '{"weight":"92 kg"}');
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-0000000e1606', '00000000-0000-0000-0000-0000000c1601', '00000000-0000-0000-0000-00000000f166'),
  ('00000000-0000-0000-0000-0000000e1608', '00000000-0000-0000-0000-0000000c1601', '00000000-0000-0000-0000-00000000f168');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  (t.m(1), '00000000-0000-0000-0000-0000000c1601', 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-0000000e1606', '00000000-0000-0000-0000-0000000e1608');

-- ================================================================ 1. the starting point
select t.expect_eq('a registered fighter starts NOT READY: not checked in, armour inspection required', t.ready(6), 'NOT READY: Not checked in, Armour inspection required');
select t.expect_eq('a volunteer needs check-in only (no inspection)', t.ready(12) || ' / ' || t.col(12, 'inspection'), 'NOT READY: Not checked in / not_needed');
select t.expect_eq('a pending registration says so', t.ready(13), 'NOT READY: Registration not accepted');

-- ================================================================ 2. nobody else can check in or clear
select t.as_anon();
select t.expect_error('anonymous cannot check anyone in', $$select public.set_attendance(t.r(6), 'checked_in')$$, '42501');
select t.expect_error('anonymous cannot read readiness', $$select * from public.event_readiness(t.ev(1))$$, '42501');
select t.as_user(t.u(6));
select t.expect_error('a fighter cannot check themself in', $$select public.set_attendance(t.r(6), 'checked_in')$$, '42501');
select t.expect_error('a fighter cannot pass their own armour', $$select public.record_inspection(t.r(6), 'passed')$$, '42501');
select t.expect_error('a fighter cannot use the old kit switch', $$select public.set_registration_check(t.r(6), 'kit', true)$$, '42501');
select t.expect_error('a fighter cannot override', $$select public.set_readiness_override(t.r(6), 'I am fine honestly')$$, '42501');
select t.expect_error('no direct write to the check state', $$insert into public.registration_checks (registration_id, check_name, passed) values (t.r(6), 'kit', true)$$, '42501');
select t.expect_error('no direct write to the inspection history', $$insert into public.registration_inspections (registration_id, event_id, result) values (t.r(6), t.ev(1), 'passed')$$, '42501');
select t.expect_error('no direct read of inspections', $$select count(*) from public.registration_inspections$$, '42501');
select t.expect_error('no direct read of weights', $$select count(*) from public.registration_weighins$$, '42501');
select t.expect_error('a fighter cannot read the desk dashboard', $$select * from public.event_readiness(t.ev(1))$$, '42501');
select t.as_user(t.u(5));
select t.expect_error('a SCOREKEEPER is not check-in staff', $$select public.set_attendance(t.r(6), 'checked_in')$$, '42501');
select t.expect_error('a SCOREKEEPER is not an inspector', $$select public.record_inspection(t.r(6), 'passed')$$, '42501');
select t.expect_error('a scorekeeper cannot read notes and weights (the desk dashboard)', $$select * from public.event_readiness(t.ev(1))$$, '42501');
select t.as_user(t.u(8));
select t.expect_error('a CAPTAIN cannot clear their own fighter', $$select public.record_inspection(t.r(7), 'passed')$$, '42501');
select t.expect_error('a captain cannot check their fighter in', $$select public.set_attendance(t.r(7), 'checked_in')$$, '42501');
select t.as_user(t.u(10));
select t.expect_error('event 2''s organizer cannot check in at event 1', $$select public.set_attendance(t.r(6), 'checked_in')$$, '42501');
select t.as_user(t.u(11));
select t.expect_error('event 2''s inspector cannot inspect at event 1', $$select public.record_inspection(t.r(6), 'passed')$$, '42501');
select t.expect_error('... nor read event 1''s dashboard', $$select * from public.event_readiness(t.ev(1))$$, '42501');
select t.as_user(t.u(4));
select t.expect_error('the INSPECTOR is not the check-in desk', $$select public.set_attendance(t.r(6), 'checked_in')$$, '42501');
select t.as_user(t.u(3));
select t.expect_error('the CHECK-IN DESK is not an inspector', $$select public.record_inspection(t.r(6), 'passed')$$, '42501');

-- ================================================================ 3. check-in at the desk
select t.expect_ok('the desk marks the fighter arrived', $$select public.set_attendance(t.r(6), 'arrived')$$);
select t.expect_eq('arrived but not checked in is its own state', t.ready(6), 'NOT READY: Arrived, not checked in, Armour inspection required');
select t.as_user(t.u(3));
select t.expect_ok('checked in', $$select public.set_attendance(t.r(6), 'checked_in')$$);
select t.expect_eq('a second tap changes nothing (no duplicate)', (select (public.set_attendance(t.r(6), 'checked_in')) ->> 'changed'), 'false');
select t.expect_eq('now only the armour is missing', t.ready(6), 'NOT READY: Armour inspection required');
select t.expect_error('a pending registration cannot be checked in', $$select public.set_attendance(t.r(13), 'checked_in')$$, '22023');
select t.expect_error('unknown state', $$select public.set_attendance(t.r(6), 'teleported')$$, '22023');

-- ================================================================ 4. inspection, correction, reinspection
select t.as_user(t.u(4));
select t.expect_error('needs correction without saying what is refused', $$select public.record_inspection(t.r(6), 'conditional')$$, '22023');
select t.expect_error('an unknown issue is refused', $$select public.record_inspection(t.r(6), 'failed', array['vibes'])$$, '22023');
select t.expect_ok('the inspector: needs correction (shield), with a note', $$select public.record_inspection(t.r(6), 'conditional', array['shield'], 'Shield rim strap loose')$$);
select t.expect_eq('NOT READY: armour needs correction', t.ready(6), 'NOT READY: Armour needs correction');
select t.expect_eq('the desk sees the issue and the private note', t.col(6, 'issues') || ' / ' || t.col(6, 'inspection_note'), '{shield} / Shield rim strap loose');
select t.as_user(t.u(4));
select t.expect_ok('back again: failed (helmet)', $$select public.record_inspection(t.r(6), 'failed', array['helmet'])$$);
select t.expect_eq('NOT READY: armour failed', t.ready(6), 'NOT READY: Armour failed inspection');
select t.as_user(t.u(4));
select t.expect_ok('reinspection: passed', $$select public.record_inspection(t.r(6), 'passed', array['helmet'], 'Fixed')$$);
select t.expect_eq('READY after reinspection', t.ready(6), 'READY');
select t.expect_eq('... marked as a reinspection (an earlier problem is on record)', t.col(6, 'reinspected'), 'true');
select t.as_user(t.u(1));
select t.expect_eq('the full history is kept, newest first: passed, failed, conditional', (select string_agg(h.result, ',') from public.inspection_history(t.r(6)) h), 'passed,failed,conditional');
select t.expect_eq('... with who inspected', (select count(*) from public.inspection_history(t.r(6)) h where h.inspected_by_name is not null), 3::bigint);
select t.as_admin();
select t.expect_eq('the old kit flag follows the latest inspection (every older screen agrees)', (select passed from public.registration_checks where registration_id = t.r(6) and check_name = 'kit'), true);
select t.expect_error('the history cannot be rewritten (even by the database owner)', $$update public.registration_inspections set result = 'passed' where registration_id = t.r(6)$$, '42501');
select t.expect_error('... nor deleted', $$delete from public.registration_inspections where registration_id = t.r(6)$$, '42501');
select t.expect_eq('every action is in the audit log with the actor', (select count(*) from public.audit_log where event_id = t.ev(1) and (action like 'checkin.%' or action like 'inspection.%') and actor is not null), 5::bigint);
select t.expect_eq('... the reinspection is flagged as one', (select details ->> 'reinspection' from public.audit_log where event_id = t.ev(1) and action = 'inspection.passed'), 'true');

-- the older one-switch path writes through the history too
select t.as_user(t.u(1));
select t.expect_ok('organizer uses the old "Kit check" switch for the team fighter', $$select public.set_registration_check(t.r(7), 'kit', true)$$);
select t.as_admin();
select t.expect_eq('... it leaves an inspection record (one writer)', (select string_agg(result, ',') from public.registration_inspections where registration_id = t.r(7)), 'passed');

-- ================================================================ 5. admin blockers, override
update public.registrations set insurance = 'needs_cover' where id = t.r(7);
select t.as_user(t.u(1));
select public.set_registration_check(t.r(7), 'checked_in', true);
select t.expect_eq('insurance is still a blocker (existing rule), check-in implies arrived', t.ready(7) || ' / ' || t.col(7, 'attendance'), 'NOT READY: Insurance not in order / checked_in');
select t.as_user(t.u(4));
select t.expect_error('an inspector cannot override', $$select public.set_readiness_override(t.r(7), 'Proof shown on paper')$$, '42501');
select t.as_user(t.u(2));
select t.expect_error('an override needs a reason', $$select public.set_readiness_override(t.r(7), 'ok')$$, '22023');
select t.expect_ok('the head marshal overrides with a reason', $$select public.set_readiness_override(t.r(7), 'Insurance proof shown on paper')$$);
select t.expect_eq('READY by override, and it is visible as an override (reasons kept)', t.ready(7) || ' / ' || t.col(7, 'override_active') || ' / ' || t.col(7, 'override_reason'), 'READY: Insurance not in order / true / Insurance proof shown on paper');
select t.as_user(t.u(1));
select t.expect_eq('the organizer withdraws it', public.clear_readiness_override(t.r(7)), 1);
select t.expect_eq('NOT READY again', t.ready(7), 'NOT READY: Insurance not in order');
select t.as_admin();
select t.expect_eq('override and its withdrawal are audited', (select count(*) from public.audit_log where event_id = t.ev(1) and action in ('readiness.override', 'readiness.override_cleared')), 2::bigint);

-- ================================================================ 6. weigh-in (profight only, private)
select t.as_user(t.u(4));
select t.expect_error('a duel fighter has no weigh-in', $$select public.record_weigh_in(t.r(6), 80)$$, '22023');
select t.expect_error('a weight out of range is refused', $$select public.record_weigh_in(t.r(14), 900)$$, '22023');
select t.expect_ok('profight fighter weighed in', $$select public.record_weigh_in(t.r(14), 91.36)$$);
select t.expect_eq('the desk sees declared and measured (rounded to 0.1 kg)', t.col(14, 'declared_weight') || ' / ' || t.col(14, 'weight_kg'), '92 kg / 91.4');
select t.as_user(t.u(5));
select t.expect_error('a scorekeeper cannot weigh in', $$select public.record_weigh_in(t.r(14), 90)$$, '42501');

-- ================================================================ 7. what Lyst staff and captains see
select t.as_user(t.u(5));
select t.expect_eq('Lyst staff (scorekeeper) see both sides of the fight: ready, and the other side has no registration (not tracked, never blocked)',
  (select string_agg(x.side || ':' || x.tracked || ':' || x.ready, ',' order by x.side) from public.match_readiness(t.m(1)) x), 'a:true:true,b:false:true');
select t.expect_eq('... status words only: no note or weight columns exist in that answer', (select count(*) from pg_proc p, unnest(p.proargnames) a where p.proname = 'match_readiness' and a in ('inspection_note', 'weight_kg', 'override_reason')), 0::bigint);
select t.as_user(t.u(9));
select t.expect_error('a stranger cannot see a fight''s readiness', $$select * from public.match_readiness(t.m(1))$$, '42501');
select t.as_user(t.u(8));
select t.expect_eq('the captain sees their own roster''s readiness (status words)', (select string_agg(x.full_name || '=' || case when x.ready then 'ready' else 'not' end, ',') from public.team_readiness(t.ev(1), '00000000-0000-0000-0000-00000000f16a') x), 'Person 7=not');
select t.expect_eq('... and nobody else''s', (select count(*) from public.team_readiness(t.ev(1), '00000000-0000-0000-0000-00000000f16a') x where x.registration_id <> t.r(7)), 0::bigint);
select t.expect_error('a captain cannot read another team', $$select * from public.team_readiness(t.ev(1), '00000000-0000-0000-0000-00000000f16b')$$, '42501');
select t.expect_eq('the captain''s answer has no note, weight or override reason columns', (select count(*) from pg_proc p, unnest(p.proargnames) a where p.proname = 'team_readiness' and a in ('inspection_note', 'weight_kg', 'override_reason', 'declared_weight')), 0::bigint);
select t.expect_error('a captain cannot read the desk dashboard', $$select * from public.event_readiness(t.ev(1))$$, '42501');
select t.expect_error('a captain cannot read inspection history', $$select * from public.inspection_history(t.r(7))$$, '42501');

-- ================================================================ 8. roles, grants, hardening
select t.as_user(t.u(1));
select t.expect_ok('an organizer can give someone the inspector role', $$select public.grant_event_role_by_email(t.ev(1), 'p16u9@example.test', 'inspector')$$);
select t.expect_eq('my_desk_roles tells the screen what to show (the database still checks)', (select public.my_desk_roles(t.ev(1))), '{"detail": true, "inspect": true, "override": true, "check_in": true}'::jsonb);
select t.as_user(t.u(9));
select t.expect_eq('... a new inspector can inspect but not check in or override', (select (r ->> 'inspect') || (r ->> 'check_in') || (r ->> 'override') from (select public.my_desk_roles(t.ev(1)) r) x), 'truefalsefalse');
select t.as_admin();
select t.expect_eq('the new tables have RLS on and no client grants',
  (select count(*) from pg_class c where c.relname in ('registration_inspections', 'registration_weighins', 'registration_overrides') and c.relrowsecurity)::text || '/' ||
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('registration_inspections', 'registration_weighins', 'registration_overrides') and grantee in ('anon', 'authenticated')), '3/0');
select t.expect_eq('every new public function is SECURITY DEFINER with an empty search_path and not executable by anon',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('set_attendance', 'record_inspection', 'record_weigh_in', 'set_readiness_override', 'clear_readiness_override', 'event_readiness', 'inspection_history', 'match_readiness', 'team_readiness', 'my_desk_roles')
     and p.prosecdef and p.proconfig = array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')), 10::bigint);
select t.expect_eq('the private helpers are callable by nobody',
  (select bool_or(has_function_privilege(r, p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated')) v(r)
   where n.nspname = 'private' and p.proname in ('readiness_rows', 'desk_registration', 'can_check_in', 'can_inspect', 'can_see_readiness_detail')), false);
select t.expect_eq('readiness never touched the queue', (select queue_state from public.matches where id = t.m(1)), 'scheduled');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK16 GATE PASSED % checks', n; end $$;
rollback;
