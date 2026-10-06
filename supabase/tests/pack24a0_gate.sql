-- Pack 24A0 gate: match safety guards (draw rebuild vs match history, raw table writes on matches, bracket structure, set_match_queue authority,
-- durable holds, audit trail). LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack24a0_gate.sql
-- Soft mode (documents the BEFORE state against a schema without the migration; failures are collected instead of stopping the run):
--       PGOPTIONS="-c t.soft=on" psql -d <db> -f supabase/tests/pack24a0_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create table t.fails (n serial, name text, why text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.bad(label text, why text) returns void language plpgsql as $$
begin
  if coalesce(current_setting('t.soft', true), '') = 'on' then insert into t.fails (name, why) values (label, why); else raise exception 'FAIL (%): %', why, label; end if;
end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then perform t.bad(label, 'expected an error'); return; end if;
  if state is not null and got <> state then perform t.bad(label, 'wrong error ' || got || ' instead of ' || state); return; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
declare ok boolean := true; why text;
begin
  begin execute stmt; exception when others then ok := false; why := sqlstate || ' ' || sqlerrm; end;
  if not ok then perform t.bad(label, 'unexpected error ' || why); return; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then perform t.bad(label, got::text || ' <> ' || want::text); return; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated;
grant all on t.log, t.fails to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- a1 owner; a2 organizer E1; a3 head marshal E1; a4 scorekeeper E1; a5 organizer E2; a6 admin of organization O1 (E1's); a7 admin of O2 (E2's);
-- a8 check-in staff E1; a9 a plain signed-in fighter / captain with no event role; a10 scorekeeper E2
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000a0' || lpad(n::text, 2, '0'))::uuid $$;
insert into auth.users (id, email) select t.u(n), 'u' || n || '@example.test' from generate_series(1, 10) n;
insert into public.platform_roles (user_id, role) values (t.u(1), 'owner');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-0000000000f1', 'org-one', 'Org One', 'regional'), ('00000000-0000-0000-0000-0000000000f2', 'org-two', 'Org Two', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000000f1', t.u(6), 'admin'), ('00000000-0000-0000-0000-0000000000f2', t.u(7), 'admin');
insert into public.events (id, slug, name, status, starts_on, ends_on, organization_id) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date, current_date + 1, '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000e102', 'e2', 'Event Two', 'published', current_date, current_date + 1, '00000000-0000-0000-0000-0000000000f2');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', t.u(2), 'organizer'), ('00000000-0000-0000-0000-00000000e101', t.u(3), 'head_marshal'),
  ('00000000-0000-0000-0000-00000000e101', t.u(4), 'scorekeeper'), ('00000000-0000-0000-0000-00000000e102', t.u(5), 'organizer'),
  ('00000000-0000-0000-0000-00000000e101', t.u(8), 'check_in'), ('00000000-0000-0000-0000-00000000e102', t.u(10), 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 'team-' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 40) n;
create function t.team(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid $$;
create function t.ent(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid $$;
create function t.comp(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000b1' || lpad(n::text, 2, '0'))::uuid $$;
create function t.cmd(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000ca' || lpad(n::text, 2, '0'))::uuid $$;
-- competitions 1..8 of E1 (4 entrants each: entries 4(n-1)+1 .. 4n), competition 9 of E2
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort)
  select t.comp(n), '00000000-0000-0000-0000-00000000e101', 'Comp ' || n, '5v5', 'men', 'Classic', case when n in (2, 7) then 'elimination' else 'round_robin' end, n from generate_series(1, 8) n;
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values (t.comp(9), '00000000-0000-0000-0000-00000000e102', 'E2 comp', '5v5', 'men', 'Classic', 'round_robin', 1);
insert into public.entries (id, competition_id, team_id) select t.ent(n), t.comp((n - 1) / 4 + 1), t.team(n) from generate_series(1, 32) n;
insert into public.entries (id, competition_id, team_id) select t.ent(n), t.comp(9), t.team(n) from generate_series(33, 36) n;

-- the plans the client sends
create function t.mk(k text, stage text, label text, pos int, a uuid, b uuid, nk text default null, ns text default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('key', k, 'stage', stage, 'round_label', label, 'position', pos, 'a', a, 'b', b, 'next_key', nk, 'next_slot', ns)) $$;
create function t.rr(c int) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    t.mk('m1', 'round_robin', 'Round 1', 0, t.ent(4 * c - 3), t.ent(4 * c - 2)), t.mk('m2', 'round_robin', 'Round 1', 1, t.ent(4 * c - 1), t.ent(4 * c)),
    t.mk('m3', 'round_robin', 'Round 2', 0, t.ent(4 * c - 3), t.ent(4 * c - 1)), t.mk('m4', 'round_robin', 'Round 2', 1, t.ent(4 * c - 2), t.ent(4 * c)),
    t.mk('m5', 'round_robin', 'Round 3', 0, t.ent(4 * c - 3), t.ent(4 * c)), t.mk('m6', 'round_robin', 'Round 3', 1, t.ent(4 * c - 2), t.ent(4 * c - 1))) $$;
create function t.ko(c int) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    t.mk('s1', 'elimination', 'Semifinal', 0, t.ent(4 * c - 3), t.ent(4 * c), 'f', 'a'), t.mk('s2', 'elimination', 'Semifinal', 1, t.ent(4 * c - 2), t.ent(4 * c - 1), 'f', 'b'),
    t.mk('f', 'final', 'Final', 0, null, null), t.mk('th', 'third_place', 'Third place', 0, null, null)) $$;
create function t.ids(c int) returns uuid[] language sql stable security definer as $$ select coalesce(array_agg(id order by id), '{}') from public.matches where competition_id = t.comp(c) $$;
create function t.mid(c int, label text, pos int) returns uuid language sql stable security definer as $$ select id from public.matches where competition_id = t.comp(c) and round_label = label and position = pos limit 1 $$;
create function t.n(c int) returns int language sql stable security definer as $$ select count(*)::int from public.matches where competition_id = t.comp(c) $$;
create function t.st(m uuid) returns text language sql stable security definer as $$ select queue_state from public.matches where id = m $$;
create function t.audits(p_action text, p_subject text default null) returns int language sql stable security definer as $$
  select count(*)::int from public.audit_log where action = p_action and (p_subject is null or subject = p_subject) $$;
create function t.reason(m uuid) returns text language plpgsql stable security definer as $$
declare r text;
begin execute 'select private.match_history_reason($1)' into r using m; return r;
exception when undefined_function then return 'MISSING private.match_history_reason'; end $$;
create function t.ver(m uuid) returns int language sql stable security definer as $$ select version from public.matches where id = m $$;
grant execute on all functions in schema t to anon, authenticated;

-- ================================================================ 1. the organizer builds the draws (the supported path still works)
select t.as_user(t.u(2));
select t.expect_eq('the organizer builds a round robin of 6 fights', public.build_schedule(t.comp(1), t.rr(1), 'new', null), 6);
select t.expect_eq('... and a knockout with a final and a third-place fight', public.build_schedule(t.comp(2), t.ko(2), 'new', null), 4);
select t.expect_eq('... and the draws for the rebuild scenarios', public.build_schedule(t.comp(3), t.rr(3), 'new', null) + public.build_schedule(t.comp(4), t.rr(4), 'new', null)
  + public.build_schedule(t.comp(5), t.rr(5), 'new', null) + public.build_schedule(t.comp(6), t.rr(6), 'new', null), 24);
select t.as_admin();
insert into public.matches (competition_id, stage, round_label, position, entry_a, entry_b) values (t.comp(9), 'round_robin', 'Round 1', 0, t.ent(33), t.ent(34));

-- ================================================================ 2. draw rebuild versus match history
-- 2a. a fresh, untouched draw can be replaced
select t.as_user(t.u(2));
select t.as_admin();
select set_config('t.before_ids', t.ids(1)::text, false);
select t.as_user(t.u(2));
select t.expect_eq('a fresh untouched draw can be rebuilt', public.build_schedule(t.comp(1), t.rr(1), 'replace', null), 6);
select t.as_admin();
select t.expect_eq('... the fights are new rows', t.ids(1)::text <> current_setting('t.before_ids'), true);
select t.expect_eq('... and the rebuild is on the audit trail with how many fights it replaced', (select details ->> 'replaced' from public.audit_log where action = 'schedule.built' and subject = t.comp(1)::text and details ->> 'mode' = 'replace'), '6');

-- 2b. an ACTIVE fight (the Pack 23R case): the draw is refused and nothing is lost
select t.as_user(t.u(2));
select t.expect_ok('the organizer sets a fight active', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(3, 'Round 1', 0)));
select t.as_admin();
insert into public.score_events (id, match_id, kind, payload, recorded_by) values ('00000000-0000-0000-0000-0000000055e1', t.mid(3, 'Round 1', 0), 'round', '{"a":1,"b":0}', t.u(4));
insert into public.match_live_scores (match_id, competition_id, score_a, score_b, phase, device, seq) values (t.mid(3, 'Round 1', 0), t.comp(3), 1, 0, 'round', 'dev', 1);
select t.as_user(t.u(2));
select t.expect_error('a draw cannot be replaced while one of its fights is active', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(3), t.rr(3)), 'P0001');
select t.as_admin();
select t.expect_eq('... the active fight is still there, still active', t.st(t.mid(3, 'Round 1', 0)), 'active');
select t.expect_eq('... its scoring events survive', (select count(*)::int from public.score_events where match_id = t.mid(3, 'Round 1', 0)), 1);
select t.expect_eq('... and its live score survives', (select count(*)::int from public.match_live_scores where match_id = t.mid(3, 'Round 1', 0)), 1);
select t.expect_eq('... and all six fights are intact', t.n(3), 6);

-- 2c. a fight set going by mistake with nothing scored can be sent back, and then the draw can be replaced
select t.as_user(t.u(2));
select t.expect_ok('the organizer sends the mistaken fight in comp 5 back to the line', format($q$select public.set_match_queue(%L, 'active'); select public.set_match_queue(%L, 'scheduled')$q$, t.mid(5, 'Round 1', 0), t.mid(5, 'Round 1', 0)));
select t.expect_eq('... nothing was scored, so the draw can be replaced', public.build_schedule(t.comp(5), t.rr(5), 'replace', null), 6);

-- 2d. a waiting fight that already has scoring events is protected, whatever its state
select t.as_admin();
insert into public.score_events (id, match_id, kind, payload, recorded_by) values ('00000000-0000-0000-0000-0000000055e2', t.mid(4, 'Round 1', 1), 'round', '{"a":1,"b":0}', t.u(4));
select t.as_user(t.u(2));
select t.expect_error('a draw with a scored fight (scoring events, fight not final) cannot be replaced', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(4), t.rr(4)), 'P0001');
select t.as_admin();
select t.expect_eq('... the scoring events survive', (select count(*)::int from public.score_events where id = '00000000-0000-0000-0000-0000000055e2'), 1);
select t.expect_eq('... and the fights are intact', t.n(4), 6);

-- 2e. an official result protects the draw, and so does the history that stays after the result is reopened
select t.as_user(t.u(4));
select t.expect_eq('a scorekeeper finishes a fight in comp 6 through the command', public.submit_match_result(t.cmd(1), t.mid(6, 'Round 1', 0), 'a', 5, 3, '{}'::jsonb, t.ver(t.mid(6, 'Round 1', 0)), 1) ->> 'status', 'accepted');
select t.as_user(t.u(2));
select t.expect_error('a draw with an official result cannot be replaced', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(6), t.rr(6)), 'P0001');
select t.expect_ok('the organizer reopens the result', format($q$select public.reopen_match(%L, 'wrong score entered')$q$, t.mid(6, 'Round 1', 0)));
select t.expect_error('... and the draw STILL cannot be replaced: the result proposal history stays (history is corrected, never deleted)', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(6), t.rr(6)), 'P0001');
select t.as_admin();
select t.expect_eq('... the match and its proposal survive', (select count(*)::int from public.result_proposals where match_id = t.mid(6, 'Round 1', 0)), 1);

-- 2f. called but not started (on deck / in the hole) and nothing recorded: not history
select t.as_user(t.u(2));
select t.expect_ok('the organizer calls two fights of comp 1 (on deck, in the hole)', format($q$select public.set_match_queue(%L, 'on_deck'); select public.set_match_queue(%L, 'in_the_hole')$q$, t.mid(1, 'Round 1', 0), t.mid(1, 'Round 1', 1)));
select t.expect_eq('called fights with nothing recorded do not block a new draw', public.build_schedule(t.comp(1), t.rr(1), 'replace', null), 6);

-- 2g. every other history table protects a match (the definition of protected history)
select t.as_admin();
select t.expect_eq('a plain waiting fight has no history', t.reason(t.mid(1, 'Round 1', 0)), null);
select t.expect_eq('... an untouched fight of another competition has none', t.reason(t.mid(5, 'Round 2', 0)), null);
insert into public.lyst_rounds (match_id, round_no, event_id) values (t.mid(5, 'Round 1', 0), 1, '00000000-0000-0000-0000-00000000e101');
select t.expect_eq('a Lyst round protects a fight', t.reason(t.mid(5, 'Round 1', 0)) is not null, true);
insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label, amount) values (gen_random_uuid(), t.mid(5, 'Round 1', 1), '00000000-0000-0000-0000-00000000e101', 1, 'a', 'warning', 'test', 0);
select t.expect_eq('recorded discipline protects a fight', t.reason(t.mid(5, 'Round 1', 1)) is not null, true);

-- 2h. who may rebuild, and where
select t.as_user(t.u(6));
select t.expect_eq('an administrator of the event''s organization may rebuild a fresh draw', public.build_schedule(t.comp(1), t.rr(1), 'replace', null), 6);
select t.as_user(t.u(7));
select t.expect_error('an administrator of ANOTHER organization cannot', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(1), t.rr(1)), '42501');
select t.as_user(t.u(5));
select t.expect_error('the organizer of another event cannot', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(1), t.rr(1)), '42501');
select t.as_user(t.u(3));
select t.expect_error('the head marshal cannot', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(1), t.rr(1)), '42501');
select t.as_user(t.u(4));
select t.expect_error('a scorekeeper cannot', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(1), t.rr(1)), '42501');
select t.as_user(t.u(9));
select t.expect_error('an ordinary signed-in fighter or captain cannot', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(1), t.rr(1)), '42501');
select t.as_admin();
select t.expect_eq('none of the refused attempts left a rebuild on the audit trail', (select count(*)::int from public.audit_log where action = 'schedule.built' and subject = t.comp(3)::text and details ->> 'mode' = 'replace'), 0);

-- ================================================================ 3. raw writes to the matches table
select t.as_user(t.u(2));
select t.expect_error('the organizer cannot insert a match through the table', format($q$insert into public.matches (competition_id, stage, round_label, position) values (%L, 'round_robin', 'Round 9', 0)$q$, t.comp(1)), '42501');
select t.expect_error('... cannot delete a match through the table', format($q$delete from public.matches where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change an entrant', format($q$update public.matches set entry_a = %L where id = %L$q$, t.ent(2), t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change the other entrant', format($q$update public.matches set entry_b = %L where id = %L$q$, t.ent(2), t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot relink a match', format($q$update public.matches set next_match_id = %L, next_slot = 'a' where id = %L$q$, t.mid(1, 'Round 1', 1), t.mid(1, 'Round 2', 0)), '42501');
select t.expect_error('... cannot change next_slot', format($q$update public.matches set next_slot = 'a' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change the position', format($q$update public.matches set position = 9 where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change the stage', format($q$update public.matches set stage = 'final' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change the round label', format($q$update public.matches set round_label = 'Final' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot change the pool', format($q$update public.matches set pool = 'Z' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot write the queue state', format($q$update public.matches set queue_state = 'on_deck' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot write queue_order', format($q$update public.matches set queue_order = 1 where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot write the hold', format($q$update public.matches set plan_hold = true where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... cannot write a result', format($q$update public.matches set result = 'a' where id = %L$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.as_admin();
select t.expect_eq('none of that changed the fight', (select entry_a::text || entry_b::text || position || stage || coalesce(pool, '-') from public.matches where id = t.mid(1, 'Round 1', 1)), t.ent(3)::text || t.ent(4)::text || '1round_robin-');

-- schedule time, field and length stay a direct column write, now audited
select t.as_user(t.u(2));
select t.expect_ok('the organizer sets a time, a field and a length', format($q$update public.matches set scheduled_at = %L, field = 'Field 2', duration_minutes = 20 where id = %L$q$, '2031-05-01 15:00+00', t.mid(1, 'Round 1', 1)));
select t.as_admin();
select t.expect_eq('... the change took', (select field || duration_minutes from public.matches where id = t.mid(1, 'Round 1', 1)), 'Field 220');
select t.expect_eq('... and is on the audit trail with before and after', (select details -> 'changes' -> 0 ->> 'match' from public.audit_log where action = 'match.schedule_changed' and event_id = '00000000-0000-0000-0000-00000000e101' order by id desc limit 1), t.mid(1, 'Round 1', 1)::text);
select t.expect_eq('... including the old and new field', (select (details -> 'changes' -> 0 -> 'field')::text from public.audit_log where action = 'match.schedule_changed' and event_id = '00000000-0000-0000-0000-00000000e101' order by id desc limit 1), '[null, "Field 2"]');
select t.expect_eq('... the actor is recorded', (select actor from public.audit_log where action = 'match.schedule_changed' and event_id = '00000000-0000-0000-0000-00000000e101' order by id desc limit 1), t.u(2));
select t.as_user(t.u(6));
select t.expect_ok('an administrator of the event''s organization may set a time', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 16:00+00', t.mid(1, 'Round 1', 1)));
select t.as_admin();
select t.expect_eq('... audited', t.audits('match.schedule_changed') >= 2, true);
create temp table t_n as select t.audits('match.schedule_changed') as n;
select t.as_user(t.u(4));
select t.expect_ok('a scorekeeper''s update of a time changes nothing (no row is theirs)', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 17:00+00', t.mid(1, 'Round 1', 1)));
select t.as_user(t.u(3));
select t.expect_ok('... nor a head marshal''s', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 17:00+00', t.mid(1, 'Round 1', 1)));
select t.as_user(t.u(5));
select t.expect_ok('... nor another event''s organizer''s', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 17:00+00', t.mid(1, 'Round 1', 1)));
select t.as_user(t.u(9));
select t.expect_ok('... nor a fighter''s', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 17:00+00', t.mid(1, 'Round 1', 1)));
select t.as_admin();
select t.expect_eq('... the time is unchanged', (select scheduled_at from public.matches where id = t.mid(1, 'Round 1', 1)), '2031-05-01 16:00+00'::timestamptz);
select t.expect_eq('... and those refused attempts are not on the audit trail', t.audits('match.schedule_changed'), (select n from t_n));
-- a final match is not editable at all
select t.as_user(t.u(2));
select t.expect_ok('writing a time on a final fight is a no-op', format($q$update public.matches set scheduled_at = %L where id = %L$q$, '2031-05-01 18:00+00', t.mid(6, 'Round 1', 1)));

-- ================================================================ 4. bracket structure
select t.as_user(t.u(2));
select t.expect_error('a semifinal cannot be deleted through the table (that would leave the final with one feeder)', format($q$delete from public.matches where id = %L$q$, t.mid(2, 'Semifinal', 0)), '42501');
select t.as_admin();
select t.expect_eq('... the final still has both feeders', (select count(*)::int from public.matches where next_match_id = t.mid(2, 'Final', 0)), 2);
select t.as_user(t.u(2));
select t.expect_error('a plan whose final has an unfed slot is refused (one feeder only)', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(2),
  jsonb_build_array(t.mk('s1', 'elimination', 'Semifinal', 0, t.ent(5), t.ent(8), 'f', 'a'), t.mk('s2', 'elimination', 'Semifinal', 1, t.ent(6), t.ent(7)), t.mk('f', 'final', 'Final', 0, null, null))), 'P0001');
select t.expect_error('a plan with two feeders into the same slot is refused', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(2),
  jsonb_build_array(t.mk('s1', 'elimination', 'Semifinal', 0, t.ent(5), t.ent(8), 'f', 'a'), t.mk('s2', 'elimination', 'Semifinal', 1, t.ent(6), t.ent(7), 'f', 'a'), t.mk('f', 'final', 'Final', 0, null, null))), 'P0001');
select t.expect_error('a plan whose feeder collides with a side already filled is refused', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(2),
  jsonb_build_array(t.mk('s1', 'elimination', 'Semifinal', 0, t.ent(5), t.ent(8), 'f', 'a'), t.mk('f', 'final', 'Final', 0, t.ent(6), t.ent(7)))), 'P0001');
select t.expect_error('a plan that links a match to itself is refused', format($q$select public.build_schedule(%L, %L::jsonb, 'replace', null)$q$, t.comp(2),
  jsonb_build_array(t.mk('s1', 'elimination', 'Semifinal', 0, t.ent(5), t.ent(8), 's1', 'a'))), 'P0001');
select t.as_admin();
select t.expect_eq('... none of those touched the existing bracket', t.n(2), 4);
select t.as_user(t.u(2));
select t.expect_eq('a bracket with a bye (one side of the final already placed) is accepted', public.build_schedule(t.comp(7), jsonb_build_array(
  t.mk('s2', 'elimination', 'Semifinal', 1, t.ent(26), t.ent(27), 'f', 'b'), t.mk('f', 'final', 'Final', 0, t.ent(25), null), t.mk('th', 'third_place', 'Third place', 0, null, null)), 'new', null), 3);
select t.expect_eq('a two-fighter final with no feeders is accepted', public.build_schedule(t.comp(8), jsonb_build_array(t.mk('f', 'final', 'Final', 0, t.ent(29), t.ent(30))), 'new', null), 1);

-- ================================================================ 5. set_match_queue authority
-- Field 1 of comp 1 has six waiting fights (rebuilt above). The organizer calls two; the rest stay waiting.
select t.as_user(t.u(2));
select t.expect_ok('the organizer calls a fight on deck, another in the hole', format($q$select public.set_match_queue(%L, 'on_deck'); select public.set_match_queue(%L, 'in_the_hole')$q$, t.mid(1, 'Round 1', 0), t.mid(1, 'Round 1', 1)));
create temp table t_q as select t.audits('queue.state_set') as n;
select t.as_admin();
select t.expect_eq('... each call is on the audit trail', t.audits('queue.state_set') >= 2, true);
select t.expect_eq('... with the previous and new state', (select details ->> 'from' || '>' || (details ->> 'to') from public.audit_log where action = 'queue.state_set' and subject = t.mid(1, 'Round 1', 1)::text order by id desc limit 1), 'scheduled>in_the_hole');
create temp table t_q2 as select t.audits('queue.state_set') as n;
select t.as_user(t.u(4));
select t.expect_error('a scorekeeper cannot pull a waiting fight on deck', format($q$select public.set_match_queue(%L, 'on_deck')$q$, t.mid(1, 'Round 2', 0)), '42501');
select t.expect_error('... nor in the hole', format($q$select public.set_match_queue(%L, 'in_the_hole')$q$, t.mid(1, 'Round 2', 0)), '42501');
select t.expect_error('... nor straight to active', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 2', 0)), '42501');
select t.expect_error('... nor reorder the called fights (in the hole to on deck)', format($q$select public.set_match_queue(%L, 'on_deck')$q$, t.mid(1, 'Round 1', 1)), '42501');
select t.expect_error('... nor move a called fight to another field', format($q$select public.set_match_queue(%L, 'active', 'Field 9')$q$, t.mid(1, 'Round 1', 0)), '42501');
select t.as_user(t.u(3));
select t.expect_error('the head marshal cannot pull a waiting fight on deck either', format($q$select public.set_match_queue(%L, 'on_deck')$q$, t.mid(1, 'Round 2', 0)), '42501');
select t.as_user(t.u(8));
select t.expect_error('check-in staff cannot touch the queue', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 1', 0)), '42501');
select t.as_user(t.u(9));
select t.expect_error('a fighter or captain cannot', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 1', 0)), '42501');
select t.as_user(t.u(10));
select t.expect_error('a scorekeeper of another event cannot touch this event''s fights', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 1', 0)), '42501');
select t.as_user(t.u(5));
select t.expect_error('the organizer of another event cannot', format($q$select public.set_match_queue(%L, 'on_deck')$q$, t.mid(1, 'Round 2', 0)), '42501');
select t.as_admin();
select t.expect_eq('the refused attempts changed nothing', t.st(t.mid(1, 'Round 2', 0)) || t.st(t.mid(1, 'Round 1', 0)) || t.st(t.mid(1, 'Round 1', 1)), 'scheduledon_deckin_the_hole');
select t.expect_eq('... and are not on the audit trail', t.audits('queue.state_set'), (select n from t_q2));
-- the legitimate scorekeeper workflow
select t.as_user(t.u(4));
select t.expect_ok('a scorekeeper opens the fight on deck (field given as the page does)', format($q$select public.set_match_queue(%L, 'active', 'Field 1')$q$, t.mid(1, 'Round 1', 0)));
select t.expect_ok('... and opens the one in the hole', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 1', 1)));
select t.expect_ok('... and sends an active fight back to the line', format($q$select public.set_match_queue(%L, 'scheduled')$q$, t.mid(1, 'Round 1', 1)));
select t.expect_ok('... repeating a state that already holds is harmless', format($q$select public.set_match_queue(%L, 'active')$q$, t.mid(1, 'Round 1', 0)));
select t.as_admin();
select t.expect_eq('... the audit trail names the scorekeeper''s own calls', (select count(*)::int from public.audit_log where action = 'queue.state_set' and actor = t.u(4)), 3);
select t.as_user(t.u(4));
select t.expect_ok('a scorekeeper still starts the next fight through advance_field_queue (the queue picks it, not the scorekeeper)', format($q$select public.advance_field_queue(%L, 'Field 1', true)$q$, '00000000-0000-0000-0000-00000000e101'));
select t.as_user(t.u(2));
select t.expect_ok('the organizer still calls any fight, in any order, and changes its field', format($q$select public.set_match_queue(%L, 'in_the_hole', 'Field 3')$q$, t.mid(1, 'Round 3', 1)));
select t.as_admin();
select t.expect_eq('... on Field 3', (select field from public.matches where id = t.mid(1, 'Round 3', 1)), 'Field 3');
select t.expect_eq('... and the field change is audited once, by the queue call (not twice by the schedule trigger)', (select count(*)::int from public.audit_log where subject = t.mid(1, 'Round 3', 1)::text and action in ('queue.state_set', 'match.schedule_changed')), 1);
select t.as_user(t.u(2));
select t.expect_ok('an organizer''s explicit "Field 1" is stored as written', format($q$select public.set_match_queue(%L, 'scheduled', 'Field 1')$q$, t.mid(1, 'Round 3', 1)));
select t.as_admin();
select t.expect_eq('... as written', (select field from public.matches where id = t.mid(1, 'Round 3', 1)), 'Field 1');
select t.as_user(t.u(6));
select t.expect_ok('an administrator of the event''s organization is an organizer here too', format($q$select public.set_match_queue(%L, 'scheduled')$q$, t.mid(1, 'Round 3', 1)));

-- ================================================================ 6. holds stay held
select t.as_user(t.u(2));
select t.expect_ok('the organizer holds a waiting fight with a reason', format($q$select public.set_match_hold(%L, true, 'Fighter is at the medic until noon')$q$, t.mid(1, 'Round 2', 1)));
select t.as_admin();
select t.expect_eq('... it is held', (select plan_hold from public.matches where id = t.mid(1, 'Round 2', 1)), true);
select t.expect_eq('... the hold is on the audit trail with the reason', (select details ->> 'reason' from public.audit_log where action = 'queue.hold_set' and subject = t.mid(1, 'Round 2', 1)::text), 'Fighter is at the medic until noon');
select t.as_user(t.u(2));
-- exactly what Event day does on every open: it saves the planner's order and the planner's holds (none here)
select t.expect_ok('Event day saves its plan with no hold in it (the page was only opened)', format($q$select public.save_queue_plan(%L, %L::uuid[], '{}'::uuid[])$q$, '00000000-0000-0000-0000-00000000e101', (select array_agg(id order by id) from public.matches where competition_id = t.comp(1) and queue_state = 'scheduled')));
select t.as_admin();
select t.expect_eq('... and the deliberate hold is still there', (select plan_hold from public.matches where id = t.mid(1, 'Round 2', 1)), true);
select t.expect_eq('... while the planner order was saved', (select count(*)::int from public.matches where competition_id = t.comp(1) and plan_order is not null), 4);
-- planner-derived holds still follow the planner
select t.as_user(t.u(2));
select t.expect_ok('the planner holds another fight (attendance)', format($q$select public.save_queue_plan(%L, %L::uuid[], %L::uuid[])$q$, '00000000-0000-0000-0000-00000000e101', (select array_agg(id order by id) from public.matches where competition_id = t.comp(1) and queue_state = 'scheduled'), array[t.mid(1, 'Round 3', 0)]));
select t.expect_ok('... and releases it when attendance changes (a plan with no hold)', format($q$select public.save_queue_plan(%L, %L::uuid[], '{}'::uuid[])$q$, '00000000-0000-0000-0000-00000000e101', (select array_agg(id order by id) from public.matches where competition_id = t.comp(1) and queue_state = 'scheduled')));
select t.as_admin();
select t.expect_eq('... the planner''s own hold went, the deliberate one stayed', (select string_agg(round_label || position, ',' order by round_label, position) from public.matches where competition_id = t.comp(1) and plan_hold), 'Round 21');
-- the queue skips a held fight
select t.as_admin();
update public.matches set queue_state = 'scheduled', queue_order = null, field = null where competition_id = t.comp(1) and queue_state <> 'final';
update public.matches set plan_order = null where competition_id = t.comp(1);
update public.matches set plan_order = 1 where id = t.mid(1, 'Round 2', 1);
update public.matches set plan_order = 2 where id = t.mid(1, 'Round 1', 0);
select t.as_user(t.u(4));
select t.expect_ok('a scorekeeper asks for the next fight', format($q$select public.advance_field_queue(%L, 'Field 1', true)$q$, '00000000-0000-0000-0000-00000000e101'));
select t.as_admin();
select t.expect_eq('the held fight (first in the plan) was skipped and stays waiting', t.st(t.mid(1, 'Round 2', 1)), 'scheduled');
select t.expect_eq('... the next planned fight was called instead', t.st(t.mid(1, 'Round 1', 0)) <> 'scheduled', true);
-- release
create temp table t_h as select t.audits('queue.hold_released') as n;
select t.as_user(t.u(4));
select t.expect_error('a scorekeeper cannot release a hold', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.as_user(t.u(3));
select t.expect_error('the head marshal cannot', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.as_user(t.u(9));
select t.expect_error('a fighter cannot', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.as_user(t.u(5));
select t.expect_error('another event''s organizer cannot', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.as_user(t.u(7));
select t.expect_error('another organization''s administrator cannot', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.expect_error('nobody can hold a fight through a bare table write', format($q$update public.matches set plan_hold = false where id = %L$q$, t.mid(1, 'Round 2', 1)), '42501');
select t.as_user(t.u(2));
select t.expect_error('a held fight needs a reason', format($q$select public.set_match_hold(%L, true, '')$q$, t.mid(1, 'Round 3', 0)), '22023');
select t.expect_error('a fight being fought cannot be held (send it back first)', format($q$select public.set_match_hold(%L, true, 'because')$q$, t.mid(1, 'Round 1', 0)), 'P0001');
select t.expect_ok('the organizer releases the hold', format($q$select public.set_match_hold(%L, false)$q$, t.mid(1, 'Round 2', 1)));
select t.as_admin();
select t.expect_eq('... it is no longer held', (select m.plan_hold::text || '/' || coalesce(to_jsonb(m) ->> 'hold_manual', 'missing') from public.matches m where m.id = t.mid(1, 'Round 2', 1)), 'false/false');
select t.expect_eq('... the release is audited once, by the organizer', (select count(*)::int from public.audit_log where action = 'queue.hold_released' and subject = t.mid(1, 'Round 2', 1)::text and actor = t.u(2)), 1);
select t.expect_eq('... and the refused attempts were not', t.audits('queue.hold_released'), (select n from t_h) + 1);
select t.as_user(t.u(2));
select t.expect_ok('Event day saving the plan can hold it again by itself now (the planner owns planner holds)', format($q$select public.save_queue_plan(%L, %L::uuid[], %L::uuid[])$q$, '00000000-0000-0000-0000-00000000e101', (select array_agg(id order by id) from public.matches where competition_id = t.comp(1) and queue_state = 'scheduled'), array[t.mid(1, 'Round 2', 1)]));
select t.as_admin();
select t.expect_eq('... it does', (select plan_hold from public.matches where id = t.mid(1, 'Round 2', 1)), true);
select t.as_user(t.u(2));
select t.expect_error('a match of another event cannot be held by this organizer', format($q$select public.set_match_hold(%L, true, 'cross event')$q$, t.mid(9, 'Round 1', 0)), '42501');
select t.expect_error('... nor called or sent back by this event''s scorekeeper', format($q$select public.set_match_queue(%L, 'scheduled')$q$, t.mid(9, 'Round 1', 0)), '42501');

select 'PASSED ' || (select count(*) from t.log) || ' checks' as result where not exists (select 1 from t.fails);
select 'FAILED ' || (select count(*) from t.fails) || ' of ' || ((select count(*) from t.log) + (select count(*) from t.fails)) || ' checks (soft mode)' as result where exists (select 1 from t.fails);
select n, name, why from t.fails order by n;
rollback;
