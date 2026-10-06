-- Pack 18 gate: the Organizer Command Centre snapshot (migration 20261012000100).
--   * only this event's organizers (incl. the platform owner) and head marshal; everyone else refused by the database (42501)
--   * derived from Pack 16 readiness and the Pack 09A queue, nothing stored; no notes, no weights, no emails, no account ids
--   * reading it changes nothing (no writes, no audit rows)
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack18_gate.sql
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
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c18' || n, 12, '0'))::uuid $$;
create function t.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a18' || n, 12, '0'))::uuid $$;
create function t.f(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('f18' || n, 12, '0'))::uuid $$;
create function t.e(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b18' || n, 12, '0'))::uuid $$;
create function t.ev(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('e18' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('d18' || n, 12, '0'))::uuid $$;
-- the snapshot as one person sees it (the person's own grant still applies: as_user first)
create function t.snap(u uuid, ev uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin perform t.as_user(u); v := public.event_command_snapshot(coalesce(ev, t.ev(1))); perform t.as_admin(); return v; end $$;
-- everything Command Centre must never change, as one fingerprint
create function t.world() returns text language sql as $$
  select md5(coalesce((select string_agg(m::text, '|' order by m.id) from public.matches m), '') || coalesce((select string_agg(c::text, '|' order by c.registration_id, c.check_name) from public.registration_checks c), '')
         || coalesce((select count(*)::text from public.audit_log), '') || coalesce((select count(*)::text from public.registration_inspections), '') || coalesce((select count(*)::text from public.notifications), ''))
$$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- u1 organizer, u2 head marshal, u3 marshal, u4 scorekeeper, u5 check-in desk, u6 inspector, u7 medic (event 1);
-- u8 captain of Team T; u9 fighter with an account (Ada); u10 stranger; u11 organizer of event 2; u12 head marshal of event 2; u13 platform owner.
-- Fighters: 1 Ada (ready after reinspection), 2 Bo (needs correction), 3 Cy (missing), 4 Di (arrived, not checked in), 5 Ed (override),
--           6 Fay (organizer-added: no registration, never warned about), 7 Gus (pending registration), 8 Hal (profight, weighed in).
insert into auth.users (id, email) select t.u(n), 'p18u' || n || '@example.test' from (select generate_series(1, 13) union all select generate_series(22, 28)) g(n);   -- 22..28: the other registrants' own accounts
update public.profiles set display_name = 'Staff ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 13) n);
insert into public.platform_roles (user_id, role) values (t.u(13), 'owner');
insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-00000000f18a', 'p18-team-t', 'Team T', 'approved');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000f18a', t.u(8), 'captain');
insert into public.fighters (id, display_name, gender, disciplines) select t.f(n), (array['Ada','Bo','Cy','Di','Ed','Fay','Gus','Hal'])[n], 'male', '{}' from generate_series(1, 8) n;
insert into public.fighter_accounts (fighter_id, user_id) values (t.f(1), t.u(9));
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  (t.ev(1), 'p18-e1', 'Command Open', 'published', current_date, current_date), (t.ev(2), 'p18-e2', 'Elsewhere Cup', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values
  (t.ev(1), t.u(1), 'organizer'), (t.ev(1), t.u(2), 'head_marshal'), (t.ev(1), t.u(3), 'marshal'), (t.ev(1), t.u(4), 'scorekeeper'),
  (t.ev(1), t.u(5), 'check_in'), (t.ev(1), t.u(6), 'inspector'), (t.ev(1), t.u(7), 'medic'),
  (t.ev(2), t.u(11), 'organizer'), (t.ev(2), t.u(12), 'head_marshal');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-0000000c1801', t.ev(1), 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  ('00000000-0000-0000-0000-0000000c1802', t.ev(1), 'Profight', 'profight', 'men', 'Classic', 'round_robin', 2);
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000a1801', t.ev(1), 1, 'Waiver', 'Fictional waiver text for the gate.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer, team_id)
select t.r(n), t.ev(1), case when n = 1 then t.u(9) else t.u(20 + n) end, t.f(n), case when n = 7 then 'pending' else 'accepted' end, (array['Ada','Bo','Cy','Di','Ed','Fay','Gus','Hal'])[n],
  'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a1801', 'Signed', false, case when n in (1, 2) then '00000000-0000-0000-0000-00000000f18a'::uuid end
from (values (1), (2), (3), (4), (5), (7), (8)) v(n);
insert into public.registration_competitions (registration_id, competition_id, details) values (t.r(8), '00000000-0000-0000-0000-0000000c1802', '{"weight":"91 kg"}');
insert into public.entries (id, competition_id, fighter_id) select t.e(n), '00000000-0000-0000-0000-0000000c1801', t.f(n) from generate_series(1, 6) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(1), '00000000-0000-0000-0000-0000000c1801', 'round_robin', 'Round 1', 0, t.e(1), t.e(2), 'active', 'Field 1'),      -- Ada v Bo: in progress
  (t.m(2), '00000000-0000-0000-0000-0000000c1801', 'round_robin', 'Round 1', 1, t.e(3), t.e(6), 'on_deck', 'Field 1'),     -- Cy v Fay (no registration)
  (t.m(3), '00000000-0000-0000-0000-0000000c1801', 'round_robin', 'Round 1', 2, t.e(4), t.e(5), 'scheduled', 'Field 2');   -- Di v Ed, scheduled later
update public.matches set scheduled_at = clock_timestamp() + interval '30 minutes' where id = t.m(3);

-- the event day so far, through the real Pack 16 functions
select t.as_user(t.u(5));
select public.set_attendance(r, 'checked_in') from unnest(array[t.r(1), t.r(2), t.r(5), t.r(8)]) r;
select public.set_attendance(t.r(4), 'arrived');
select t.as_user(t.u(6));
select public.record_inspection(t.r(1), 'conditional', array['helmet'], 'SECRET-NOTE-grille bar loose');
select public.record_inspection(t.r(1), 'passed', '{}', 'SECRET-NOTE-fixed');
select public.record_inspection(t.r(2), 'conditional', array['gloves'], 'SECRET-NOTE-cuff gap');
select public.record_inspection(t.r(8), 'passed');
select public.record_weigh_in(t.r(8), 87.3);
select t.as_user(t.u(2));
select public.set_readiness_override(t.r(5), 'Loaner kit checked at ringside');
select t.as_admin();

-- ================================================================ 1. who may open it
select t.as_anon();
select t.expect_error('anonymous: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(10));
select t.expect_error('a signed-in stranger: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(9));
select t.expect_error('a fighter of this event: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(8));
select t.expect_error('a captain of a team in this event: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(3));
select t.expect_error('a marshal: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(4));
select t.expect_error('a scorekeeper does not become an organizer: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(5));
select t.expect_error('the check-in desk: refused (it has the desk)', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(6));
select t.expect_error('an armour inspector: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(7));
select t.expect_error('a medic: refused', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(11));
select t.expect_error('the organizer of ANOTHER event: refused here', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(12));
select t.expect_error('the head marshal of ANOTHER event: refused here', $$select public.event_command_snapshot(t.ev(1))$$, '42501');
select t.as_user(t.u(1));
select t.expect_error('the organizer of event 1 is refused for event 2', $$select public.event_command_snapshot(t.ev(2))$$, '42501');
select t.expect_error('an event that does not exist: the same refusal (no existence leak)', $$select public.event_command_snapshot('00000000-0000-0000-0000-000000000bad')$$, '42501');
select t.as_admin();
select t.expect_eq('the organizer may open it, and is marked organizer', (t.snap(t.u(1)) -> 'viewer' ->> 'organizer'), 'true');
select t.expect_eq('the head marshal may open it (not marked organizer)', (t.snap(t.u(2)) -> 'viewer' ->> 'organizer'), 'false');
select t.expect_eq('the platform owner may open it (existing platform rule)', (t.snap(t.u(13)) -> 'event' ->> 'slug'), 'p18-e1');
select t.expect_eq('each organizer sees only their own event', (t.snap(t.u(11), t.ev(2)) -> 'event' ->> 'name'), 'Elsewhere Cup');

-- ================================================================ 2. what it says (Pack 16 readiness, one rule)
select t.expect_eq('counts: 6 accepted fighters; 1 missing, 1 arrived, 4 checked in; 3 ready (Ada, Ed by override, Hal); 1 needs correction; 1 override; 1 pending',
  (select format('%s/%s/%s/%s/%s/%s/%s/%s', r ->> 'fighters', r ->> 'missing', r ->> 'arrived', r ->> 'checked_in', r ->> 'ready', r ->> 'needs_correction', r ->> 'overrides', r ->> 'pending_registrations')
   from (select t.snap(t.u(1)) -> 'readiness' r) x), '6/1/1/4/3/1/1/1');
select t.expect_eq('the not-ready list, with reasons in words',
  (select string_agg((e ->> 'name') || ':' || (e -> 'reasons' ->> 0), ', ' order by e ->> 'name') from jsonb_array_elements(t.snap(t.u(1)) -> 'not_ready') e),
  'Bo:Armour needs correction, Cy:Not checked in, Di:Arrived, not checked in');
select t.expect_eq('the head marshal sees the same readiness picture', (t.snap(t.u(2)) -> 'not_ready'), (t.snap(t.u(1)) -> 'not_ready'));
select t.expect_eq('fight warnings: Bo in the fight on now, Cy on deck, Di later; Fay (no registration) is never warned about',
  (select string_agg((e ->> 'name') || '@' || right(e ->> 'match_id', 2), ',' order by e ->> 'name') from jsonb_array_elements(t.snap(t.u(1)) -> 'fight_warnings') e),
  'Bo@81,Cy@82,Di@83');
select t.expect_eq('the override is listed with its reason (the override roles already see it)',
  (select (e ->> 'name') || ': ' || (e ->> 'reason') from jsonb_array_elements(t.snap(t.u(1)) -> 'overrides') e), 'Ed: Loaner kit checked at ringside');
select t.expect_eq('staff: assigned per role, names only, in event-day order',
  (select string_agg((e ->> 'role') || '=' || jsonb_array_length(e -> 'names'), ',') from jsonb_array_elements(t.snap(t.u(1)) -> 'staff') e),
  'organizer=1,head_marshal=1,marshal=1,scorekeeper=1,check_in=1,inspector=1,medic=1');
select t.expect_eq('broadcast: not configured yet', (t.snap(t.u(1)) -> 'broadcast' ->> 'configured'), 'false');
insert into public.event_broadcast (event_id, stream_url) values (t.ev(1), 'https://www.youtube.com/watch?v=abc');
select t.expect_eq('... configured once a stream address is set (Pack 14 owns it)', (t.snap(t.u(1)) -> 'broadcast' ->> 'configured'), 'true');

-- ================================================================ 3. what it must never contain
select t.expect_eq('no inspection notes', position('SECRET-NOTE' in t.snap(t.u(1))::text), 0);
select t.expect_eq('no weights (measured 87.3, declared 91)', position('87.3' in t.snap(t.u(1))::text) + position('91 kg' in t.snap(t.u(1))::text), 0);
select t.expect_eq('no emails', position('@example.test' in t.snap(t.u(1))::text), 0);
select t.expect_eq('no account ids (staff or fighters)',
  (select count(*) from (select generate_series(1, 13) union all select generate_series(22, 28)) g(n) where position(t.u(n)::text in t.snap(t.u(1))::text) > 0), 0::bigint);
select t.expect_eq('no keys for notes, weights or contact data',
  (select count(*) from regexp_matches(t.snap(t.u(1))::text, '"(note|inspection_note|weight_kg|declared_weight|email|phone|emergency[a-z_]*|user_id)"', 'g')), 0::bigint);

-- ================================================================ 4. reading it changes nothing
select t.as_admin();
create temp table before_world as select t.world() as w;
grant select on before_world to authenticated;
select t.snap(t.u(1)); select t.snap(t.u(2)); select t.snap(t.u(13));
select t.expect_eq('opening it (three people) wrote nothing: matches, checks, inspections, notifications and the audit log are unchanged', t.world(), (select w from before_world));
select t.expect_eq('it is a STABLE, SECURITY DEFINER function with an empty search_path',
  (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.event_command_snapshot(uuid)'::regprocedure), true);
select t.expect_eq('executable by signed-in users only (not anon, not PUBLIC); the role helper by nobody',
  format('%s/%s/%s', has_function_privilege('anon', 'public.event_command_snapshot(uuid)', 'execute'), has_function_privilege('authenticated', 'public.event_command_snapshot(uuid)', 'execute'),
         has_function_privilege('authenticated', 'private.can_command(uuid)', 'execute')), 'f/t/f');
select t.expect_eq('no new tables were added for it', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like '%command%'), 0::bigint);

-- ================================================================ 5. it follows the authoritative data
select t.as_user(t.u(6));
select public.record_inspection(t.r(2), 'passed');
select t.as_admin();
select t.expect_eq('after Bo passes reinspection: 4 ready, nobody needs correction, Bo off the not-ready list and off the fight warnings',
  (select format('%s/%s/%s/%s', s -> 'readiness' ->> 'ready', s -> 'readiness' ->> 'needs_correction',
                 (select count(*) from jsonb_array_elements(s -> 'not_ready') e where e ->> 'name' = 'Bo'),
                 (select count(*) from jsonb_array_elements(s -> 'fight_warnings') e where e ->> 'name' = 'Bo')) from (select t.snap(t.u(1)) s) x), '4/0/0/0');
update public.matches set queue_state = 'final', result = 'a', score_a = 2, score_b = 0 where id = t.m(1);
select t.expect_eq('a finished fight is no longer one of the fights in play', (select count(*) from jsonb_array_elements(t.snap(t.u(1)) -> 'fight_warnings') e where e ->> 'match_id' = t.m(1)::text), 0::bigint);

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK18 GATE PASSED % checks', n; end $$;
rollback;
