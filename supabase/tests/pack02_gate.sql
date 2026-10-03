-- Pack 02 gate: match versions, atomic schedule building, draw seed, pool ties, result audit, reopen history, team identity.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.  Concurrency is tested separately by supabase/tests/pack02_concurrency.sh.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack02_gate.sql
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
-- a1 owner; a2 organizer of E1; a3 organizer of E2 only; a4 scorekeeper of E1; a5 stranger
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'), ('00000000-0000-0000-0000-0000000000a2', 'org1@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'org2@example.test'), ('00000000-0000-0000-0000-0000000000a4', 'score@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'stranger@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date, current_date + 1),
  ('00000000-0000-0000-0000-00000000e102', 'e2', 'Event Two', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-0000000000a3', 'organizer'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country)
  select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 'team-' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 12) n;
-- competition K1 (pools), K2 (elimination, for versions), K3 (round robin for result audit), K4 (empty, concurrency/atomicity)
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'K1 Pools', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000e101', 'K2 Elim', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000e101', 'K3 RR', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b104', '00000000-0000-0000-0000-00000000e101', 'K4 Empty', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b105', '00000000-0000-0000-0000-00000000e102', 'K5 other event', '5v5', 'men', 'Classic', 'round_robin');
-- entries: K1 has teams 1-6 (ids ...e1xx), K2 has teams 7-10, K3 has teams 1-3 as well, K5 has team 11
insert into public.entries (id, competition_id, team_id)
  select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 6) n;
insert into public.entries (id, competition_id, team_id)
  select ('00000000-0000-0000-0000-00000000e2' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b102', ('00000000-0000-0000-0000-00000000c1' || lpad((n + 6)::text, 2, '0'))::uuid from generate_series(1, 4) n;
insert into public.entries (id, competition_id, team_id)
  select ('00000000-0000-0000-0000-00000000e3' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b103', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 3) n;
insert into public.entries (id, competition_id, team_id) values ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000b105', '00000000-0000-0000-0000-00000000c111');

create function t.eid(p text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
grant execute on function t.eid(text) to anon, authenticated;
-- plan builder: a pool round robin of three entries (key prefix + entries)
create function t.pool3(p_pool text, a text, b text, c text) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'p' || p_pool || '1', 'stage', 'pool', 'round_label', 'Round 1', 'position', 0, 'pool', p_pool, 'a', t.eid(a), 'b', t.eid(b)),
    jsonb_build_object('key', 'p' || p_pool || '2', 'stage', 'pool', 'round_label', 'Round 2', 'position', 0, 'pool', p_pool, 'a', t.eid(a), 'b', t.eid(c)),
    jsonb_build_object('key', 'p' || p_pool || '3', 'stage', 'pool', 'round_label', 'Round 3', 'position', 0, 'pool', p_pool, 'a', t.eid(b), 'b', t.eid(c)))
$$;
grant execute on function t.pool3(text, text, text, text) to anon, authenticated;
create function t.mid(p_comp text, p_pool text, a text, b text) returns uuid language sql stable as $$
  select id from public.matches where competition_id = t.eid(p_comp) and pool = p_pool and entry_a = t.eid(a) and entry_b = t.eid(b)
$$;
grant execute on function t.mid(text, text, text, text) to anon, authenticated;
create function t.fin(p_match uuid, p_res text, p_a int, p_b int) returns integer language sql as $$
  select public.finalize_match(p_match, p_res, p_a, p_b, '{}'::jsonb, (select version from public.matches where id = p_match))
$$;
grant execute on function t.fin(uuid, text, int, int) to anon, authenticated;

-- ================================================================ 1+2. match version covers the sides
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('building K2 as the organizer', public.build_schedule('00000000-0000-0000-0000-00000000b102',
  jsonb_build_array(jsonb_build_object('key', 'x', 'stage', 'elimination', 'round_label', 'Semifinal', 'position', 0, 'a', t.eid('e201'), 'b', t.eid('e202'))), 'new', null), 1);
select t.as_admin();
create table t.v (k text primary key, v int);
grant all on t.v to anon, authenticated;
insert into t.v select 'before', version from public.matches where competition_id = t.eid('b102');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer swaps the entrants of a match', $q$update public.matches set entry_b = t.eid('e203') where competition_id = t.eid('b102')$q$);
select t.as_admin();
select t.expect_eq('swapping an entrant increments the version', (select version from public.matches where competition_id = t.eid('b102')), (select v + 1 from t.v where k = 'before'));
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a stale scoring command (old version) cannot be applied to the replacement entrant',
  format($q$select public.finalize_match(%L, 'b', 3, 5, '{}'::jsonb, %s)$q$, (select id from public.matches where competition_id = t.eid('b102')), (select v from t.v where k = 'before')), 'P0001');
select t.as_admin();
select t.expect_eq('... and nothing was scored', (select queue_state from public.matches where competition_id = t.eid('b102')), 'scheduled');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_ok('the current version is accepted', format($q$select public.finalize_match(%L, 'b', 3, 5, '{}'::jsonb, %s)$q$, (select id from public.matches where competition_id = t.eid('b102')), (select version from public.matches where competition_id = t.eid('b102'))));

-- ================================================================ 4+5. atomic build, draw seed
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_error('a stranger cannot build a schedule', $q$select public.build_schedule(t.eid('b104'), '[]'::jsonb, 'new', null)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a scorekeeper cannot build a schedule', $q$select public.build_schedule(t.eid('b104'), '[]'::jsonb, 'new', null)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('an organizer of another event cannot build this schedule', $q$select public.build_schedule(t.eid('b101'), '[]'::jsonb, 'new', null)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a bad link leaves no partial bracket', $q$select public.build_schedule(t.eid('b101'),
  t.pool3('A', 'e101', 'e102', 'e103') || jsonb_build_array(jsonb_build_object('key', 'z', 'stage', 'elimination', 'round_label', 'Final', 'position', 0, 'next_key', 'nope', 'next_slot', 'a')), 'new', null)$q$, '22023');
select t.expect_error('an entry from another competition leaves no partial bracket', $q$select public.build_schedule(t.eid('b101'),
  t.pool3('A', 'e101', 'e102', 'e103') || jsonb_build_array(jsonb_build_object('key', 'z', 'stage', 'pool', 'round_label', 'Round 9', 'position', 0, 'pool', 'A', 'a', t.eid('e101'), 'b', t.eid('e501'))), 'new', null)$q$);
select t.expect_error('a duplicate key leaves no partial bracket', $q$select public.build_schedule(t.eid('b101'), t.pool3('A', 'e101', 'e102', 'e103') || t.pool3('A', 'e101', 'e102', 'e103'), 'new', null)$q$, '22023');
select t.as_admin();
select t.expect_eq('after three failed builds K1 has no matches at all', (select count(*) from public.matches where competition_id = t.eid('b101')), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('a valid draw builds both pools in one call', public.build_schedule(t.eid('b101'), t.pool3('A', 'e101', 'e102', 'e103') || t.pool3('B', 'e104', 'e105', 'e106'), 'new',
  '{"format":"pools","mode":"random","seed":424242,"algorithm":"ts-draw-v1"}'::jsonb), 6);
select t.expect_error('a second "new" build is refused: one authoritative schedule', $q$select public.build_schedule(t.eid('b101'), t.pool3('A', 'e101', 'e102', 'e103'), 'new', null)$q$, 'P0001');
select t.as_admin();
select t.expect_eq('the draw seed and algorithm are stored', (select draw_seed || '/' || draw_algorithm || '/' || draw_mode from public.competitions where id = t.eid('b101')), '424242/ts-draw-v1/random');
select t.expect_eq('the pools format set the competition structure', (select structure from public.competitions where id = t.eid('b101')), 'pools_elimination');
select t.expect_eq('building was audited', (select count(*) from public.audit_log where action = 'schedule.built' and subject = t.eid('b101')::text), 1::bigint);
select t.expect_eq('the seed is readable by anonymous visitors only as part of the public competition, no account id', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'competitions' and column_name in ('drawn_by', 'created_by', 'user_id')), 0::bigint);

-- ================================================================ 6+7. pool ties: pool A is a three-way cycle, pool B is clear
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.fin(t.mid('b101', 'A', 'e101', 'e102'), 'a', 5, 3);
select t.fin(t.mid('b101', 'A', 'e101', 'e103'), 'b', 3, 5);
select t.fin(t.mid('b101', 'A', 'e102', 'e103'), 'a', 5, 3);
select t.fin(t.mid('b101', 'B', 'e104', 'e105'), 'a', 5, 1);
select t.fin(t.mid('b101', 'B', 'e104', 'e106'), 'a', 5, 2);
select t.fin(t.mid('b101', 'B', 'e105', 'e106'), 'a', 5, 3);
select t.as_anon();
select t.expect_eq('pool A shows a three-way tie', (select count(*) from public.pool_standings(t.eid('b101')) where part = 'A' and tied), 3::bigint);
select t.expect_eq('pool B has no tie', (select count(*) from public.pool_standings(t.eid('b101')) where part = 'B' and tied), 0::bigint);
select t.expect_eq('pool B order is by results: e104, e105, e106', (select string_agg(right(entry_id::text, 4), ',' order by rank) from public.pool_standings(t.eid('b101')) where part = 'B'), 'e104,e105,e106');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
-- the browser's old behaviour would have ordered the tied entries by id; the database refuses to advance them
select t.expect_error('a bracket cannot be built while a tie affects who advances', format($q$select public.build_schedule(t.eid('b101'),
  jsonb_build_array(
    jsonb_build_object('key','s1','stage','elimination','round_label','Semifinal','position',0,'a',t.eid('e101'),'b',t.eid('e105'),'next_key','f','next_slot','a'),
    jsonb_build_object('key','s2','stage','elimination','round_label','Semifinal','position',1,'a',t.eid('e104'),'b',t.eid('e102'),'next_key','f','next_slot','b'),
    jsonb_build_object('key','f','stage','final','round_label','Final','position',0)), 'append', null, 2)$q$), 'P0001');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a scorekeeper cannot decide a tie', format($q$select public.record_tie_decision(%L, 'A', array[%L, %L, %L]::uuid[], 'lots')$q$, t.eid('b101'), t.eid('e103'), t.eid('e101'), t.eid('e102')), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a decision needs a reason', format($q$select public.record_tie_decision(%L, 'A', array[%L, %L, %L]::uuid[], '')$q$, t.eid('b101'), t.eid('e103'), t.eid('e101'), t.eid('e102')), '22023');
select t.expect_error('a decision must list exactly the tied entries', format($q$select public.record_tie_decision(%L, 'A', array[%L, %L]::uuid[], 'lots')$q$, t.eid('b101'), t.eid('e103'), t.eid('e101')), '22023');
select t.expect_error('entries that are not tied cannot be re-ordered', format($q$select public.record_tie_decision(%L, 'B', array[%L, %L]::uuid[], 'lots')$q$, t.eid('b101'), t.eid('e104'), t.eid('e105')), '22023');
select t.expect_ok('the organizer decides pool A: e103, e101, e102', format($q$select public.record_tie_decision(%L, 'A', array[%L, %L, %L]::uuid[], 'drew lots in front of the head marshal')$q$, t.eid('b101'), t.eid('e103'), t.eid('e101'), t.eid('e102')));
select t.as_anon();
select t.expect_eq('public standings now show the decided order for pool A', (select string_agg(right(entry_id::text, 4), ',' order by rank) from public.pool_standings(t.eid('b101')) where part = 'A'), 'e103,e101,e102');
select t.expect_eq('... and no tie remains', (select count(*) from public.pool_standings(t.eid('b101')) where tied), 0::bigint);
select t.as_admin();
select t.expect_eq('the decision records actor, time and note', (select count(*) from public.pool_tie_decisions where competition_id = t.eid('b101') and decided_by = '00000000-0000-0000-0000-0000000000a2' and note like 'drew lots%'), 3::bigint);
select t.expect_eq('the decision was audited', (select count(*) from public.audit_log where action = 'pool.tie_decided' and subject = t.eid('b101')::text), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a bracket that does not match the pool standings is refused', format($q$select public.build_schedule(t.eid('b101'),
  jsonb_build_array(
    jsonb_build_object('key','s1','stage','elimination','round_label','Semifinal','position',0,'a',t.eid('e101'),'b',t.eid('e105'),'next_key','f','next_slot','a'),
    jsonb_build_object('key','s2','stage','elimination','round_label','Semifinal','position',1,'a',t.eid('e104'),'b',t.eid('e102'),'next_key','f','next_slot','b'),
    jsonb_build_object('key','f','stage','final','round_label','Final','position',0)), 'append', null, 2)$q$), 'P0001');
select t.expect_eq('the bracket from the decided standings (advance 2: e103, e101, e104, e105) is accepted', public.build_schedule(t.eid('b101'),
  jsonb_build_array(
    jsonb_build_object('key','s1','stage','elimination','round_label','Semifinal','position',0,'a',t.eid('e103'),'b',t.eid('e105'),'next_key','f','next_slot','a'),
    jsonb_build_object('key','s2','stage','elimination','round_label','Semifinal','position',1,'a',t.eid('e104'),'b',t.eid('e101'),'next_key','f','next_slot','b'),
    jsonb_build_object('key','f','stage','final','round_label','Final','position',0)), 'append', null, 2), 3);
select t.expect_error('the bracket cannot be built twice', $q$select public.build_schedule(t.eid('b101'), '[]'::jsonb, 'append', null, 2)$q$, 'P0001');
-- play the bracket; e102 (third in pool A by decision) and e106 (third in pool B) are eliminated in the pools
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.fin((select id from public.matches where competition_id = t.eid('b101') and stage = 'elimination' and position = 0), 'a', 5, 2);
select t.fin((select id from public.matches where competition_id = t.eid('b101') and stage = 'elimination' and position = 1), 'a', 5, 2);
select t.fin((select id from public.matches where competition_id = t.eid('b101') and stage = 'final'), 'a', 5, 4);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('finishing K1 ranks every entry', public.finish_competition(t.eid('b101')), 6);
select t.as_admin();
select t.expect_eq('champion and runner-up follow the bracket', (select string_agg(right(entry_id::text, 4), ',' order by final_place) from public.results where competition_id = t.eid('b101') and final_place <= 2), 'e103,e104');
select t.expect_eq('official placings agree with the decided pool order: e101 and e105 lost semifinals, e102 and e106 left in the pools',
  (select string_agg(right(entry_id::text, 4), ',' order by final_place, entry_id) from public.results where competition_id = t.eid('b101') and final_place > 2), 'e101,e105,e102,e106');
select t.expect_eq('... e102 (pool A, decided third) is placed strictly ahead of e106 by the shared rule, never by id', (select final_place from public.results where competition_id = t.eid('b101') and entry_id = t.eid('e102')) < (select final_place from public.results where competition_id = t.eid('b101') and entry_id = t.eid('e106')), true);

-- ================================================================ 8+9. results: no direct writes, corrections audited, reopen supersedes
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('an organizer cannot insert a result', $q$insert into public.results (competition_id, entry_id, final_place, points) values (t.eid('b103'), t.eid('e301'), 1, 5)$q$);
select t.expect_error('an organizer cannot update a result directly', $q$update public.results set final_place = 1 where competition_id = t.eid('b101') and entry_id = t.eid('e104')$q$);
select t.expect_error('an organizer cannot delete a result directly', $q$delete from public.results where competition_id = t.eid('b101')$q$);
select t.as_admin();
select t.expect_eq('the results are untouched', (select count(*) from public.results where competition_id = t.eid('b101')), 6::bigint);
select t.expect_eq('finishing logged one "computed" revision per entry', (select count(*) from public.result_revisions where competition_id = t.eid('b101') and action = 'computed'), 6::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a scorekeeper cannot correct a result', $q$select public.correct_result(t.eid('b101'), t.eid('e104'), 1, 10, 'typo')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('an organizer of another event cannot correct a result', $q$select public.correct_result(t.eid('b101'), t.eid('e104'), 1, 10, 'typo')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('a correction needs a reason', $q$select public.correct_result(t.eid('b101'), t.eid('e104'), 1, 10, ' ')$q$, '22023');
select t.expect_ok('the organizer corrects a result with a reason', $q$select public.correct_result(t.eid('b101'), t.eid('e104'), 3, 4.5, 'protest upheld by the head marshal')$q$);
select t.expect_eq('the stored result changed', (select final_place || '/' || points from public.results where competition_id = t.eid('b101') and entry_id = t.eid('e104')), '3/4.5');
select t.expect_eq('the revision keeps old value, new value, actor and reason', (select old_place || '/' || new_place || '/' || new_points || '/' || actor::text || '/' || reason from public.result_revisions where competition_id = t.eid('b101') and entry_id = t.eid('e104') and action = 'corrected'),
  '2/3/4.5/00000000-0000-0000-0000-0000000000a2/protest upheld by the head marshal');
select t.expect_error('the revision log cannot be edited', $q$update public.result_revisions set reason = 'nothing happened'$q$);
select t.as_admin();
select t.expect_error('... even by the database owner', $q$delete from public.result_revisions$q$, '42501');
select t.expect_eq('the correction was audited', (select count(*) from public.audit_log where action = 'result.corrected'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('finishing again is refused while hand corrections stand', $q$select public.finish_competition(t.eid('b101'))$q$, 'P0001');
-- reopen the final: results leave the current record but stay inspectable
select t.expect_ok('the organizer reopens the final', format($q$select public.reopen_match(%L, 'wrong score on the final')$q$, (select id from public.matches where competition_id = t.eid('b101') and stage = 'final')));
select t.as_admin();
select t.expect_eq('the competition is running again', (select status from public.competitions where id = t.eid('b101')), 'running');
select t.expect_eq('current results are cleared', (select count(*) from public.results where competition_id = t.eid('b101')), 0::bigint);
select t.expect_eq('every result was superseded in the log with the reopen reason, not lost', (select count(*) from public.result_revisions where competition_id = t.eid('b101') and action = 'superseded' and reason = 'wrong score on the final'), 6::bigint);
select t.expect_eq('the superseded rows still hold the previous official places (e103 was champion)', (select old_place from public.result_revisions where competition_id = t.eid('b101') and entry_id = t.eid('e103') and action = 'superseded'), 1);
select t.expect_eq('the corrected value is also preserved: e104 was officially 3', (select old_place from public.result_revisions where competition_id = t.eid('b101') and entry_id = t.eid('e104') and action = 'superseded'), 3);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('there is nothing to void for a competition without results', $q$select public.void_result(t.eid('b101'), t.eid('e104'), 'x y z')$q$, 'P0002');

-- ================================================================ 10. a team merge keeps the identity used at the event
select t.as_admin();
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at)
  values ('00000000-0000-0000-0000-0000000f0301', t.eid('b103'), 'round_robin', 'Round 1', 0, t.eid('e301'), t.eid('e302'), 'final', 'a', t.eid('e301'), 5, 1, now()),
         ('00000000-0000-0000-0000-0000000f0302', t.eid('b103'), 'round_robin', 'Round 1', 1, t.eid('e301'), t.eid('e303'), 'final', 'a', t.eid('e301'), 5, 2, now()),
         ('00000000-0000-0000-0000-0000000f0303', t.eid('b103'), 'round_robin', 'Round 1', 2, t.eid('e302'), t.eid('e303'), 'final', 'a', t.eid('e302'), 5, 3, now());
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('finishing K3 (no ties)', public.finish_competition(t.eid('b103')), 3);
select t.as_admin();
select t.expect_eq('entries remember the team name used at the event', (select team_name_at_event from public.entries where id = t.eid('e302')), 'Team 2');
update public.teams set name = 'Team 1 Renamed' where id = t.eid('c101');  -- a later rename must not change the entry snapshot
select t.expect_eq('a rename does not rewrite the snapshot', (select team_name_at_event from public.entries where id = t.eid('e301')), 'Team 1');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_error('both teams have entries in the same competition: the merge is refused', $q$select public.merge_teams(t.eid('c101'), t.eid('c102'))$q$, '22023');
select t.as_admin();
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000c1ff', 'old-team', 'Old Team Name', 'approved', 'Leduc', 'CA');
insert into public.entries (id, competition_id, team_id) values (t.eid('e5ff'), t.eid('b105'), t.eid('c1ff'));
insert into public.results (competition_id, entry_id, final_place, points) values (t.eid('b105'), t.eid('e5ff'), 1, 3);
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.expect_ok('the platform administrator merges Old Team Name into Team 12', $q$select public.merge_teams(t.eid('c112'), t.eid('c1ff'))$q$);
select t.as_anon();
select t.expect_eq('the old result still shows the name used at the event', (select team_name_at_event from public.team_history where event_slug = 'e2' and final_place = 1), 'Old Team Name');
select t.expect_eq('... and the team as it is now', (select team_current_name from public.team_history where event_slug = 'e2' and final_place = 1), 'Team 12');
select t.expect_eq('... the successor link is public', (select removed_name || ' -> ' || kept.name from public.team_merges m join public.teams kept on kept.id = m.kept_team_id where removed_slug = 'old-team'), 'Old Team Name -> Team 12');

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
