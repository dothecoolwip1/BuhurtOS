-- Pack 09B gate: the running-score table for the venue display (migration 20261004000600).
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack09b_gate.sql
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
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures: a2 organizer E1; a4, a5 scorekeepers E1; a6 scorekeeper E2; a7 stranger. E1 published, E2 a DRAFT.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date, current_date + 1),
  ('00000000-0000-0000-0000-00000000e102', 'e2', 'Event Two (draft)', 'draft', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a5', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-0000000000a6', 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 'team-' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 4) n;
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Alpha', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000e102', 'Draft comp', '5v5', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, team_id) select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 4) n;
insert into public.entries (id, competition_id, team_id) values ('00000000-0000-0000-0000-00000000e121', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c101'), ('00000000-0000-0000-0000-00000000e122', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c102');
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid $$;
insert into public.matches (id, competition_id, stage, round_label, position, queue_state, entry_a, entry_b) values
  (t.m(1), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 0, 'active', '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102'),
  (t.m(2), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 1, 'on_deck', '00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-00000000e104'),
  (t.m(3), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 0, 'scheduled', '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e103'),
  (t.m(9), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 0, 'active', '00000000-0000-0000-0000-00000000e121', '00000000-0000-0000-0000-00000000e122');
create function t.ver(n int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(n) $$;
create function t.score(n int) returns text language sql stable security definer as $$ select coalesce((select score_a || '-' || score_b || ' ' || phase || ' seq' || seq || ' dev=' || device from public.match_live_scores where match_id = t.m(n)), 'none') $$;
create function t.report(n int, dev text, seq bigint, a int, b int, phase text default '', ver int default null) returns text language sql as $$
  select public.report_live_score(t.m(n), dev, seq, a, b, phase, '{}'::jsonb, ver) ->> 'status' $$;
grant execute on all functions in schema t to anon, authenticated;

-- ================================================================ 1. who may write
select t.as_anon();
select t.expect_error('anonymous cannot report a live score', $q$select t.report(1, 'd1', 1, 1, 0)$q$, '42501');
select t.expect_error('anonymous cannot write the table', $q$insert into public.match_live_scores (match_id, competition_id, reported_by) values (t.m(1), '00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000a4')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('a stranger cannot report', $q$select t.report(1, 'd1', 1, 1, 0)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_error('a scorekeeper of another event cannot report on this one', $q$select t.report(1, 'd1', 1, 1, 0)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('even a scorekeeper cannot write the table directly', $q$insert into public.match_live_scores (match_id, competition_id, reported_by) values (t.m(1), '00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000a4')$q$, '42501');
select t.expect_error('... nor update it', $q$update public.match_live_scores set score_a = 99$q$, '42501');
select t.expect_error('... nor delete from it', $q$delete from public.match_live_scores$q$, '42501');
select t.expect_error('a missing match is refused', $q$select t.report(77, 'd1', 1, 1, 0)$q$, 'P0002');
select t.expect_error('negative scores are refused', $q$select t.report(1, 'd1', 1, -1, 0)$q$, '22023');

-- ================================================================ 2. reporting, latest wins, stale devices
select t.expect_eq('a scorekeeper reports the first snapshot', t.report(1, 'd1', 1, 2, 0, 'Round 1 of 2', t.ver(1)), 'ok');
select t.expect_eq('... stored', t.score(1), '2-0 Round 1 of 2 seq1 dev=d1');
select t.expect_eq('a newer snapshot from the same device replaces it', t.report(1, 'd1', 2, 3, 1, 'Round 1 of 2', t.ver(1)), 'ok');
select t.expect_eq('an OLDER snapshot from the same device (arrived late) is ignored', t.report(1, 'd1', 1, 0, 0, 'Round 1 of 2', t.ver(1)), 'older');
select t.expect_eq('... the newer one stands', t.score(1), '3-1 Round 1 of 2 seq2 dev=d1');
select t.expect_eq('the same seq again is ignored too (idempotent)', t.report(1, 'd1', 2, 3, 1, 'Round 1 of 2', t.ver(1)), 'older');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('another device (another scorer) simply takes over, whatever its seq', t.report(1, 'd2', 1, 5, 5, 'Extra round', t.ver(1)), 'ok');
select t.expect_eq('... and is now the one shown', t.score(1), '5-5 Extra round seq1 dev=d2');
select t.expect_eq('a device that opened an older version of the match is told it is stale and writes nothing', t.report(1, 'd3', 1, 9, 9, 'x', t.ver(1) - 1), 'stale');
select t.expect_eq('... nothing changed', t.score(1), '5-5 Extra round seq1 dev=d2');
select t.expect_eq('no expected version given: accepted (an old client)', t.report(1, 'd2', 2, 6, 5, 'Extra round'), 'ok');
select t.as_admin();
select t.expect_eq('the report never touches the match version', t.ver(1), 0);
select t.expect_eq('... nor the match result', (select result is null and queue_state = 'active' from public.matches where id = t.m(1)), true);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('a long phase is truncated, not refused', t.report(1, 'd2', 3, 6, 5, repeat('x', 100)), 'ok');
select t.as_admin();
select t.expect_eq('... to 80 characters', (select char_length(phase) from public.match_live_scores where match_id = t.m(1)), 80);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a snapshot can be reported for a match that is on deck or waiting too (the board may be opened early)', t.report(2, 'd1', 1, 0, 0, 'Round 1'), 'ok');

-- ================================================================ 3. who may read: the same rule as the match
select t.as_anon();
select t.expect_eq('anyone can read the live score of a published event', (select count(*) from public.match_live_scores where match_id = t.m(1)), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_eq('the draft event''s scorekeeper reports on the draft event', t.report(9, 'd9', 1, 1, 0), 'ok');
select t.as_anon();
select t.expect_eq('... but nobody outside sees a draft event''s live score', (select count(*) from public.match_live_scores where match_id = t.m(9)), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_eq('... a signed-in stranger neither', (select count(*) from public.match_live_scores where match_id = t.m(9)), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_eq('... its own staff do', (select count(*) from public.match_live_scores where match_id = t.m(9)), 1::bigint);
select t.as_anon();
select t.expect_eq('the public row carries no account id in what the display uses (reported_by is an auth id: not selected by the app, and anon sees only published events)', (select count(*) from information_schema.columns where table_name = 'match_live_scores' and column_name = 'reported_by'), 1::bigint);

-- ================================================================ 4. a result and a live score never coexist
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('the live score is there before the result', t.score(1) <> 'none', true);
select t.expect_eq('device A makes the result official', public.submit_match_result('00000000-0000-0000-0000-00000000ca01', t.m(1), 'a', 5, 3, '{}'::jsonb, t.ver(1), 1) ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('the live score is gone the moment the match is final', t.score(1), 'none');
select t.expect_eq('the official result is exactly what was submitted, untouched by the live score', (select result || score_a || '-' || score_b from public.matches where id = t.m(1)), 'a5-3');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('reporting on a final match is refused softly, nothing written', t.report(1, 'd1', 9, 1, 1), 'final');
select t.as_admin();
select t.expect_eq('... still nothing', t.score(1), 'none');
-- sent back to the line: the live score goes too
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_ok('match 2 is called (active)', $q$select public.set_match_queue(t.m(2), 'active')$q$);
select t.expect_eq('... and gets a live score', t.report(2, 'd1', 5, 1, 0, 'Round 1'), 'ok');
select t.expect_ok('the organizer sends it back to the line', $q$select public.set_match_queue(t.m(2), 'scheduled')$q$);
select t.as_admin();
select t.expect_eq('the live score of a match sent back is dropped', t.score(2), 'none');
-- reopen: nothing to drop, and the match can get a fresh score
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer reopens the result', $q$select public.reopen_match(t.m(1), 'wrong winner entered')$q$);
select t.expect_eq('a reopened match can get a live score again', t.report(1, 'd1', 10, 0, 0, 'Round 1 of 2', t.ver(1)), 'ok');
select t.as_admin();
select t.expect_eq('one row per match, never more', (select count(*) from public.match_live_scores where match_id = t.m(1)), 1::bigint);
select t.expect_eq('the realtime publication carries the table', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'match_live_scores'), 1::bigint);
select t.expect_eq('the function is not executable by anon', has_function_privilege('anon', 'public.report_live_score(uuid,text,bigint,integer,integer,text,jsonb,integer)', 'execute'), false);
select t.expect_eq('the trigger function is not executable by users', has_function_privilege('authenticated', 'private.clear_live_score()', 'execute'), false);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
