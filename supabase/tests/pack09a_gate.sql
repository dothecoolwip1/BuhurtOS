-- Pack 09A gate: the field queue for event day (queue_order, running order, readiness, automatic advancement, advance_field_queue, move_match_in_queue).
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack09a_gate.sql
-- The advancement trigger is deferred to COMMIT; this script never commits, so it forces pending trigger events with SET CONSTRAINTS ... IMMEDIATE
-- (t.settle). supabase/tests/pack09a_concurrency.sh covers real commits and two sessions.
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

-- ---------------------------------------------------------------- fixtures
-- a1 owner; a2 organizer E1+E3; a3 head marshal E1; a4, a5 scorekeepers E1; a6 scorekeeper E2; a7 stranger
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date, current_date + 1),
  ('00000000-0000-0000-0000-00000000e102', 'e2', 'Event Two', 'published', current_date, current_date + 1),
  ('00000000-0000-0000-0000-00000000e103', 'e3', 'Event Three', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a3', 'head_marshal'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a5', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-0000000000a6', 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 'team-' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 16) n;
-- E1: C1 "Alpha" (sort 1, teams 1-8) and C2 "Bravo" (sort 2, teams 9-12). E3: C3 single elimination (teams 13-16). E2 has a competition only so it exists.
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Alpha', '5v5', 'men', 'Classic', 'round_robin', 1),
  ('00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000e101', 'Bravo', '5v5', 'women', 'Classic', 'round_robin', 2),
  ('00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000e103', 'Knockout', '5v5', 'men', 'Classic', 'elimination', 1),
  ('00000000-0000-0000-0000-00000000b104', '00000000-0000-0000-0000-00000000e102', 'Other event', '5v5', 'men', 'Classic', 'round_robin', 1);
create function t.team(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid $$;
create function t.ent(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid $$;
create function t.cmd(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000ca' || lpad(n::text, 2, '0'))::uuid $$;
insert into public.entries (id, competition_id, team_id) select t.ent(n), '00000000-0000-0000-0000-00000000b101', t.team(n) from generate_series(1, 8) n;
insert into public.entries (id, competition_id, team_id) select t.ent(n), '00000000-0000-0000-0000-00000000b102', t.team(n) from generate_series(9, 12) n;
insert into public.entries (id, competition_id, team_id) select t.ent(n), '00000000-0000-0000-0000-00000000b103', t.team(n) from generate_series(13, 16) n;

-- Field 1 of E1 (the field is left empty on most rows on purpose: no field = Field 1):
--   m1..m3 Alpha Round 1, m4..m6 Alpha Round 2, m7 Alpha Round 3 (a side still unknown), m21 Bravo (no time), m22 Bravo with an early time
-- Field 2 of E1: m11..m14 Alpha
insert into public.matches (id, competition_id, stage, round_label, position, field, scheduled_at, entry_a, entry_b) values
  (t.m(1),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 0, null,       null, t.ent(1), t.ent(2)),
  (t.m(2),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 1, '',         null, t.ent(3), t.ent(4)),
  (t.m(3),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 2, ' field 1 ', null, t.ent(5), t.ent(6)),
  (t.m(4),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 0, 'Field 1',  null, t.ent(1), t.ent(3)),
  (t.m(5),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 1, null,       null, t.ent(2), t.ent(4)),
  (t.m(6),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 2, null,       null, t.ent(7), t.ent(8)),
  (t.m(7),  '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 3', 0, null,       null, t.ent(1), null),
  (t.m(21), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 0, null,       null, t.ent(9), t.ent(10)),
  (t.m(22), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 1, null, (current_date + time '08:00')::timestamptz, t.ent(11), t.ent(12)),
  (t.m(11), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 3, 'Field 2', null, t.ent(1), t.ent(5)),
  (t.m(12), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 4, 'Field 2', null, t.ent(2), t.ent(6)),
  (t.m(13), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 5, 'Field 2', null, t.ent(3), t.ent(7)),
  (t.m(14), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 6, 'Field 2', null, t.ent(4), t.ent(8));

-- Event Two: one match, for the cross-event checks. Event Three: a four-entrant knockout on Field 1 (semifinals 41, 42; final 43; third place 44).
insert into public.entries (id, competition_id, team_id) values (t.ent(31), '00000000-0000-0000-0000-00000000b104', t.team(1)), (t.ent(32), '00000000-0000-0000-0000-00000000b104', t.team(2));
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values (t.m(31), '00000000-0000-0000-0000-00000000b104', 'round_robin', 'Round 1', 0, t.ent(31), t.ent(32));
insert into public.matches (id, competition_id, stage, round_label, position) values
  (t.m(43), '00000000-0000-0000-0000-00000000b103', 'final', 'Final', 0), (t.m(44), '00000000-0000-0000-0000-00000000b103', 'third_place', 'Third place', 0);
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values
  (t.m(41), '00000000-0000-0000-0000-00000000b103', 'elimination', 'Semifinal', 0, t.ent(13), t.ent(14), t.m(43), 'a'),
  (t.m(42), '00000000-0000-0000-0000-00000000b103', 'elimination', 'Semifinal', 1, t.ent(15), t.ent(16), t.m(43), 'b');

create function t.ver(n int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(n) $$;
create function t.s(n int) returns text language sql stable security definer as $$ select queue_state from public.matches where id = t.m(n) $$;
create function t.ord(n int) returns int language sql stable security definer as $$ select queue_order from public.matches where id = t.m(n) $$;
-- "1:active,2:on_deck,..." for the given match numbers
create function t.snap(ns int[]) returns text language sql stable security definer as $$ select string_agg(n || ':' || t.s(n), ',' order by i) from unnest(ns) with ordinality u(n, i) $$;
-- the running order the database computes for a field: "22,1,2,..." (match numbers)
create function t.line(p_event uuid, p_field text, p_states text[]) returns text language sql stable security definer as $$
  select string_agg(((right(x::text, 3))::int)::text, ',' order by ord) from private.queue_ordered(p_event, private.field_key(p_field), p_states) with ordinality q(x, ord) $$;
-- push deferred trigger events now (the real thing happens at COMMIT)
create function t.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
-- finalize a match as a scorekeeper would, then let the commit-time advancement run
create function t.finish(n int, who uuid default '00000000-0000-0000-0000-0000000000a4') returns text language plpgsql as $$
declare v_status text;
begin
  perform t.as_user(who);
  v_status := public.submit_match_result(t.cmd(n), t.m(n), 'a', 5, 3, '{}'::jsonb, t.ver(n), 1) ->> 'status';
  perform t.settle();
  return v_status;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- ================================================================ 1. the running order rule
select t.as_admin();
select t.expect_eq('the field key: blank, spaces and case all mean the same field, and blank is Field 1',
  (select array[private.field_key(null), private.field_key(''), private.field_key('  FIELD 1 '), private.field_key('Field 2')]), array['field 1', 'field 1', 'field 1', 'field 2']);
select t.expect_eq('rounds sort by their meaning: pool round numbers, then Round of 16 < Quarterfinal < Semifinal < Final',
  (select array[private.round_rank('pool', 'Round 10'), private.round_rank('elimination', 'Round of 16'), private.round_rank('elimination', 'Quarterfinal'), private.round_rank('elimination', 'Semifinal'), private.round_rank('final', 'Final')]),
  array[10, -16, -8, -4, 0]);
select t.expect_eq('stages sort pool, elimination, third place, final', (select array[private.stage_rank('round_robin'), private.stage_rank('elimination'), private.stage_rank('third_place'), private.stage_rank('final')]), array[0, 1, 2, 3]);
select t.expect_eq('Field 1 waiting line: the early-timed match first, then Alpha before Bravo, rounds in order; the match with an unknown side is not in the line',
  t.line('00000000-0000-0000-0000-00000000e101', null, array['scheduled']), '22,1,2,3,4,5,6,21');
select t.expect_eq('... "Field 1", "field 1" and a blank field are one line', t.line('00000000-0000-0000-0000-00000000e101', ' FIELD 1', array['scheduled']), '22,1,2,3,4,5,6,21');
select t.expect_eq('Field 2 is its own line', t.line('00000000-0000-0000-0000-00000000e101', 'Field 2', array['scheduled']), '11,12,13,14');
select t.expect_eq('a match with an unknown side is not runnable', private.match_runnable((select m from public.matches m where id = t.m(7))), false);
select t.expect_eq('a match with both sides is runnable', private.match_runnable((select m from public.matches m where id = t.m(1))), true);
update public.entries set status = 'withdrawn' where id = t.ent(8);
select t.expect_eq('a withdrawn entrant makes the match not runnable', private.match_runnable((select m from public.matches m where id = t.m(6))), false);
select t.expect_eq('... and it drops out of the line', t.line('00000000-0000-0000-0000-00000000e101', null, array['scheduled']), '22,1,2,3,4,5,21');
update public.entries set status = 'disqualified' where id = t.ent(8);
select t.expect_eq('a disqualified entrant too', t.line('00000000-0000-0000-0000-00000000e101', null, array['scheduled']), '22,1,2,3,4,5,21');
update public.entries set status = 'registered' where id = t.ent(8);
select t.expect_eq('reinstated, it is back in the line', t.line('00000000-0000-0000-0000-00000000e101', null, array['scheduled']), '22,1,2,3,4,5,6,21');

-- ================================================================ 2. who may do what
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('a stranger cannot start a field', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true)$q$, '42501');
select t.expect_error('a stranger cannot reorder', $q$select public.move_match_in_queue(t.m(1), 'first')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_error('a scorekeeper of another event cannot start this event''s field', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true)$q$, '42501');
select t.expect_error('... nor reorder its matches', $q$select public.move_match_in_queue(t.m(1), 'first')$q$, '42501');
select t.as_anon();
select t.expect_error('anonymous visitors cannot call either function', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true)$q$, '42501');
select t.expect_error('... the reorder either', $q$select public.move_match_in_queue(t.m(1), 'first')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a scorekeeper cannot reorder the line (organizers only)', $q$select public.move_match_in_queue(t.m(1), 'first')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('a head marshal cannot reorder either; they keep setting a match''s state', $q$select public.move_match_in_queue(t.m(1), 'first')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('the organizer of ANOTHER event cannot reorder Event Two''s matches', $q$select public.move_match_in_queue(t.m(31), 'first')$q$, '42501');
select t.expect_error('... nor start its field', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e102', null, true)$q$, '42501');
select t.expect_error('... nor call one of its matches', $q$select public.set_match_queue(t.m(31), 'active')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('queue_order cannot be written directly by a scorekeeper', $q$update public.matches set queue_order = 1 where id = t.m(1)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_error('... nor by an organizer (only move_match_in_queue writes it)', $q$update public.matches set queue_order = 1 where id = t.m(1)$q$, '42501');
select t.expect_error('the helper functions are not callable by users', $q$select private.settle_field_queue('00000000-0000-0000-0000-00000000e101', 'field 1', true)$q$, '42501');

-- ================================================================ 3. start the field, fill the queue, idempotent
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a scorekeeper starts Field 1: active, on deck, in the hole are the first three of the line',
  (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true) -> 'promoted')::text,
  '[{"to": "active", "match": "' || t.m(22) || '"}, {"to": "on_deck", "match": "' || t.m(1) || '"}, {"to": "in_the_hole", "match": "' || t.m(2) || '"}]');
select t.expect_eq('... as stored', t.snap(array[22, 1, 2, 3, 4, 5, 6, 21]), '22:active,1:on_deck,2:in_the_hole,3:scheduled,4:scheduled,5:scheduled,6:scheduled,21:scheduled');
select t.expect_eq('pressing it again changes nothing (idempotent)', (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', 'Field 1', true) -> 'promoted')::text, '[]');
select t.expect_eq('... and the stored states are the same', t.snap(array[22, 1, 2, 3]), '22:active,1:on_deck,2:in_the_hole,3:scheduled');
select t.expect_eq('Field 2 was not touched by starting Field 1', t.snap(array[11, 12, 13, 14]), '11:scheduled,12:scheduled,13:scheduled,14:scheduled');
select t.expect_eq('the match with an unknown side was never promoted', t.s(7), 'scheduled');
select t.expect_eq('queue changes never change a match version', (select count(*) from public.matches where version <> 0), 0::bigint);
select t.as_admin();
select t.expect_eq('the audit trail records the advance', (select count(*) from public.audit_log where action = 'queue.advanced' and event_id = '00000000-0000-0000-0000-00000000e101'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('starting Field 2 without "start" fills on deck and in the hole but starts nothing',
  (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', 'Field 2', false) -> 'promoted')::text,
  '[{"to": "on_deck", "match": "' || t.m(11) || '"}, {"to": "in_the_hole", "match": "' || t.m(12) || '"}]');
select t.as_admin();
select t.expect_eq('... Field 2 has no active match', (select count(*) from public.matches where field = 'Field 2' and queue_state = 'active'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('an unknown field is an empty answer, not an error', (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', 'Nowhere', true))::text, '{"demoted": [], "promoted": []}');

-- ================================================================ 4. a result advances the queue by itself
select t.expect_eq('device A makes the active match official', t.finish(22), 'accepted');
select t.as_admin();
select t.expect_eq('the next match is active, the one in the hole is on deck, the next waiting match is in the hole',
  t.snap(array[22, 1, 2, 3, 4, 5, 6, 21]), '22:final,1:active,2:on_deck,3:in_the_hole,4:scheduled,5:scheduled,6:scheduled,21:scheduled');
select t.expect_eq('Field 2 did not move when Field 1 advanced', t.snap(array[11, 12, 13, 14]), '11:on_deck,12:in_the_hole,13:scheduled,14:scheduled');
select t.expect_eq('the result itself is exactly what was submitted', (select result || score_a || '-' || score_b || '/' || version from public.matches where id = t.m(22)), 'a5-3/1');
select t.expect_eq('the promoted matches kept their version (queue moves are not structural changes)', t.ver(1) + t.ver(2) + t.ver(3), 0);
select t.expect_eq('the audit trail says the advance followed a result', (select details ->> 'after' from public.audit_log where action = 'queue.advanced' and subject = t.m(22)::text), 'result');
-- finish the new active match: the same shift again
select t.expect_eq('the next result is accepted', t.finish(1), 'accepted');
select t.as_admin();
select t.expect_eq('the line shifts again', t.snap(array[1, 2, 3, 4, 5, 6, 21]), '1:final,2:active,3:on_deck,4:in_the_hole,5:scheduled,6:scheduled,21:scheduled');
-- repeating the same result command does not advance again
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('the same command again is a repeat', public.submit_match_result(t.cmd(1), t.m(1), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'repeat', 'true');
select t.settle();
select t.as_admin();
select t.expect_eq('... and the queue does not move a second time', t.snap(array[1, 2, 3, 4, 5]), '1:final,2:active,3:on_deck,4:in_the_hole,5:scheduled');

-- ================================================================ 5. finishing a match that is not the active one
select t.expect_eq('the match on deck is entered from paper (not the active one)', t.finish(3, '00000000-0000-0000-0000-0000000000a3'), 'accepted');
select t.as_admin();
select t.expect_eq('the active match stays active; the hole moves up; the next fills the hole',
  t.snap(array[2, 3, 4, 5, 6, 21]), '2:active,3:final,4:on_deck,5:in_the_hole,6:scheduled,21:scheduled');
select t.expect_eq('a match that was only scheduled finishes: nothing in the queue moves',
  (select t.finish(6, '00000000-0000-0000-0000-0000000000a3')), 'accepted');
select t.as_admin();
select t.expect_eq('... still 2 active, 4 on deck, 5 in the hole, Bravo waiting', t.snap(array[2, 4, 5, 6, 21]), '2:active,4:on_deck,5:in_the_hole,6:final,21:scheduled');

-- ================================================================ 6. running the last matches, then nothing is left to promote
select t.expect_eq('active match 2 done', t.finish(2), 'accepted');
select t.as_admin();
select t.expect_eq('4 active, 5 on deck, 21 in the hole', t.snap(array[4, 5, 21]), '4:active,5:on_deck,21:in_the_hole');
select t.expect_eq('active match 4 done', t.finish(4), 'accepted');
select t.as_admin();
select t.expect_eq('5 active, 21 on deck, the hole stays empty (match 7 has an unknown side and is NOT promoted)', t.snap(array[5, 21, 7]), '5:active,21:on_deck,7:scheduled');
select t.expect_eq('active match 5 done', t.finish(5), 'accepted');
select t.as_admin();
select t.expect_eq('21 active, nothing else promoted', t.snap(array[21, 7]), '21:active,7:scheduled');
select t.expect_eq('the last active match done', t.finish(21), 'accepted');
select t.as_admin();
select t.expect_eq('with nothing runnable left, Field 1 is simply empty (match 7 still waits)', t.snap(array[7]), '7:scheduled');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('starting an exhausted field is a no-op', (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true) -> 'promoted')::text, '[]');
-- the missing side is decided: the match becomes runnable and the next advance picks it up
select t.as_admin();
update public.matches set entry_b = t.ent(2) where id = t.m(7);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('once both sides are known the match can be started', (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', null, true) -> 'promoted')::text,
  '[{"to": "active", "match": "' || t.m(7) || '"}]');

-- ================================================================ 7. unrunnable matches in the live slots go back to the line
select t.as_admin();
update public.matches set queue_state = 'scheduled' where id = t.m(7);
update public.matches set queue_state = 'on_deck' where id = t.m(13);
update public.matches set queue_state = 'in_the_hole' where id = t.m(14);
update public.entries set status = 'withdrawn' where id = t.ent(7);   -- match 13 (entry 3 v entry 7) can no longer run
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('settle puts the unrunnable on-deck match back and does not promote it', (public.advance_field_queue('00000000-0000-0000-0000-00000000e101', 'Field 2', false) -> 'demoted')::text, '["' || t.m(13) || '"]');
select t.as_admin();
select t.expect_eq('... 11 on deck, 12 in the hole were already there; 13 is back in the line; 14 stays in the hole',
  t.snap(array[11, 12, 13, 14]), '11:on_deck,12:in_the_hole,13:scheduled,14:in_the_hole');
update public.entries set status = 'registered' where id = t.ent(7);

-- ================================================================ 8. moving things around (organizers)
-- Reset Field 2 to a clean picture: 11, 12, 13, 14 all waiting.
select t.as_admin();
update public.matches set queue_state = 'scheduled', queue_order = null where id in (t.m(11), t.m(12), t.m(13), t.m(14));
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer starts Field 2', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e101', 'Field 2', true)$q$);
select t.as_admin();
select t.expect_eq('Field 2 reads active 11, on deck 12, in the hole 13, waiting 14', t.snap(array[11, 12, 13, 14]), '11:active,12:on_deck,13:in_the_hole,14:scheduled');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('skip the match on deck: it swaps places with the one in the hole', (public.move_match_in_queue(t.m(12), 'skip') ->> 'changed'), 'true');
select t.as_admin();
select t.expect_eq('... 13 is on deck, 12 in the hole', t.snap(array[11, 12, 13, 14]), '11:active,12:in_the_hole,13:on_deck,14:scheduled');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('"later" on the match in the hole swaps it with the first waiting one', (public.move_match_in_queue(t.m(12), 'later') ->> 'changed'), 'true');
select t.as_admin();
select t.expect_eq('... 14 is in the hole and 12 waits with an explicit place (1)', t.snap(array[11, 12, 13, 14]) || '/' || t.ord(12), '11:active,12:scheduled,13:on_deck,14:in_the_hole/1');
select t.expect_eq('the whole line, as the database computes it', t.line('00000000-0000-0000-0000-00000000e101', 'Field 2', array['on_deck', 'in_the_hole', 'scheduled']), '13,14,12');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('"first": make 12 the next match', (public.move_match_in_queue(t.m(12), 'first') ->> 'changed'), 'true');
select t.as_admin();
select t.expect_eq('... 12 on deck, 13 in the hole, 14 waiting (and 14 now has place 1, 12 none)', t.snap(array[11, 12, 13, 14]) || '/' || coalesce(t.ord(14)::text, '-') || '/' || coalesce(t.ord(12)::text, '-'), '11:active,12:on_deck,13:in_the_hole,14:scheduled/1/-');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('"first" again changes nothing', (public.move_match_in_queue(t.m(12), 'first') ->> 'changed'), 'false');
select t.expect_eq('"earlier" on the waiting match swaps it with the one in the hole', (public.move_match_in_queue(t.m(14), 'earlier') ->> 'changed'), 'true');
select t.as_admin();
select t.expect_eq('... 14 in the hole, 13 waiting', t.snap(array[11, 12, 13, 14]), '11:active,12:on_deck,13:scheduled,14:in_the_hole');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('"later" on the last place does nothing', (public.move_match_in_queue(t.m(13), 'later') ->> 'changed'), 'false');
select t.expect_error('an active match cannot be moved', $q$select public.move_match_in_queue(t.m(11), 'later')$q$, 'P0001');
select t.expect_error('a match with an unknown side or an entrant who cannot run has no place in the line', $q$select public.move_match_in_queue(t.m(44), 'first')$q$, 'P0001');
select t.expect_error('an unknown action is refused', $q$select public.move_match_in_queue(t.m(12), 'sideways')$q$, '22023');
select t.expect_error('a missing match is refused', $q$select public.move_match_in_queue('00000000-0000-0000-0000-00000000dead', 'first')$q$, 'P0002');
select t.expect_error('a final match cannot be moved', $q$select public.move_match_in_queue(t.m(21), 'first')$q$, 'P0001');
select t.as_admin();
select t.expect_eq('Field 1 was never touched by moving Field 2 around', (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '00000000-0000-0000-0000-00000000e101' and private.field_key(m.field) = 'field 1' and m.queue_state in ('active', 'on_deck', 'in_the_hole')), 0::bigint);
select t.expect_eq('no result changed while the line was moved around', (select count(*) from public.matches where queue_state = 'final' and (result <> 'a' or score_a <> 5 or score_b <> 3)), 0::bigint);

-- the manual order wins over the schedule; the schedule times are not rewritten
update public.matches set field = 'Parked', queue_state = 'scheduled' where id = t.m(11);
update public.matches set queue_state = 'scheduled', queue_order = null where id in (t.m(12), t.m(13), t.m(14));
update public.matches set scheduled_at = (current_date + time '09:00')::timestamptz where id = t.m(12);
update public.matches set scheduled_at = (current_date + time '09:10')::timestamptz where id = t.m(13);
update public.matches set scheduled_at = (current_date + time '09:20')::timestamptz where id = t.m(14);
select t.expect_eq('by schedule time the waiting line is 12, 13, 14', t.line('00000000-0000-0000-0000-00000000e101', 'Field 2', array['scheduled']), '12,13,14');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer moves 14 earlier', $q$select public.move_match_in_queue(t.m(14), 'earlier')$q$);
select t.as_admin();
select t.expect_eq('the line follows the organizer (12, 14, 13)', t.line('00000000-0000-0000-0000-00000000e101', 'Field 2', array['scheduled']), '12,14,13');
select t.expect_eq('... and the three schedule times are exactly as they were', (select string_agg(to_char(scheduled_at at time zone 'UTC', 'HH24:MI'), ',' order by id) from public.matches where id in (t.m(12), t.m(13), t.m(14))),
  to_char((current_date + time '09:00')::timestamptz at time zone 'UTC', 'HH24:MI') || ',' || to_char((current_date + time '09:10')::timestamptz at time zone 'UTC', 'HH24:MI') || ',' || to_char((current_date + time '09:20')::timestamptz at time zone 'UTC', 'HH24:MI'));
select t.as_anon();
select t.expect_eq('the order is public information like the rest of the queue', (select count(*) from public.matches where queue_order is not null), 3::bigint);

-- ================================================================ 9. set_match_queue keeps working
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_ok('a scorekeeper still calls a match by hand', $q$select public.set_match_queue(t.m(13), 'active')$q$);
select t.as_admin();
select t.expect_eq('... and a called match forgets its manual order', t.s(13) || '/' || coalesce(t.ord(13)::text, 'none'), 'active/none');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_ok('a field can still be changed or cleared through it', $q$select public.set_match_queue(t.m(13), 'scheduled', '')$q$);
select t.expect_error('a final match cannot be put back by it', $q$select public.set_match_queue(t.m(22), 'scheduled')$q$, 'P0001');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('a stranger still cannot call a match', $q$select public.set_match_queue(t.m(13), 'active')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_ok('the scorekeeper of Event Two can run Event Two''s field', $q$select public.advance_field_queue('00000000-0000-0000-0000-00000000e102', null, true)$q$);
select t.as_admin();
select t.expect_eq('... and it started that event''s match, not anything in Event One', t.s(31), 'active');

-- ================================================================ 10. a knockout: the next round becomes runnable at the moment the result is saved
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('start the knockout field: semifinal 1 active, semifinal 2 on deck, final and third place wait for results (not promoted)',
  (select string_agg(x ->> 'match' || '>' || (x ->> 'to'), ',') from jsonb_array_elements(public.advance_field_queue('00000000-0000-0000-0000-00000000e103', null, true) -> 'promoted') x), t.m(41) || '>active,' || t.m(42) || '>on_deck');
select t.expect_eq('semifinal 1 is saved', t.finish(41, '00000000-0000-0000-0000-0000000000a2'), 'accepted');
select t.as_admin();
select t.expect_eq('its winner went to the final and the loser to third place (bracket logic untouched)', (select entry_a::text from public.matches where id = t.m(43)) || '/' || (select entry_a::text from public.matches where id = t.m(44)), t.ent(13) || '/' || t.ent(14));
select t.expect_eq('semifinal 2 takes over; the final and third place are still waiting for their second side', t.snap(array[41, 42, 43, 44]), '41:final,42:active,43:scheduled,44:scheduled');
select t.expect_eq('semifinal 2 is saved', t.finish(42, '00000000-0000-0000-0000-0000000000a2'), 'accepted');
select t.as_admin();
select t.expect_eq('both are runnable now and the queue sees it: third place (earlier stage) is active, the final is on deck', t.snap(array[42, 43, 44]), '42:final,43:on_deck,44:active');
select t.expect_eq('the third-place match is saved', t.finish(44, '00000000-0000-0000-0000-0000000000a2'), 'accepted');
select t.as_admin();
select t.expect_eq('the final becomes active', t.snap(array[43, 44]), '43:active,44:final');

-- ================================================================ 11. a problem with the queue never costs a result
update public.matches set queue_state = 'active', field = 'Field 3', queue_order = null where id = t.m(12);
update public.matches set queue_state = 'scheduled', field = 'Field 3' where id = t.m(14);
create or replace function private.settle_field_queue(p_event uuid, p_key text, p_start boolean) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end $$;
select t.expect_eq('the result is accepted even though the queue step fails', t.finish(12), 'accepted');
select t.as_admin();
select t.expect_eq('... the result stands', (select queue_state || result from public.matches where id = t.m(12)), 'finala');
select t.expect_eq('... and the failure is on the audit trail for the organizer', (select details ->> 'error' from public.audit_log where action = 'queue.advance_failed' and subject = t.m(12)::text), 'boom');

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
