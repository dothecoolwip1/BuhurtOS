-- Seven-profile rehearsal gate (20261113000200): a fight-ending call decides an Outrance fight whatever the score (Outrance Rules V.26.4 §14.11,
-- §14.8, §13.4), and nothing offers or starts another round once it is on record (§4). Pack 18.1 fixture (fictional people):
-- u1 organizer E1, u2 head marshal E1, u3 marshal E1, u4 scorekeeper (secretary) E1, u10 stranger. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
create function t.g(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a31' || n, 12, '0'))::uuid $$;
create function t.rev(mn int, r int) returns int language sql stable security definer as $$ select rev from public.lyst_rounds where match_id = t.m(mn) and round_no = r $$;
create function t.ver(mn int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(mn) $$;
create function t.start(mn int, r int) returns void language sql security definer as $$
  insert into public.lyst_rounds (match_id, round_no, event_id, status) values (t.m(mn), r, t.ev(1), 'running') $$;
create function t.stop(mn int, r int) returns void language sql security definer as $$
  update public.lyst_rounds set status = 'confirming' where match_id = t.m(mn) and round_no = r $$;
create function t.totals(mn int) returns jsonb language sql stable security definer as $$ select private.outrance_state(t.m(mn)) -> 'totals' $$;
create function t.paper(mn int, r int, a int, b int) returns jsonb language sql as $$
  select public.outrance_enter_sheet(gen_random_uuid(), t.m(mn), r, 'Anna', jsonb_build_object('strike', jsonb_build_object('a', a, 'b', b))) $$;
create function t.holds(e uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(kind, ',' order by kind), '') from public.outrance_holds where entry_id = e $$;
grant execute on all functions in schema t to authenticated, anon;

-- the world: a Division 2 tournament Profight (2 rounds, a 3rd if level), paper sheets only, as in the rehearsal
insert into public.competitions (id, event_id, name, category, gender, structure, sort) values (t.comp(41), t.ev(1), 'Profight heavy', 'profight', 'men', 'round_robin', 9);
insert into public.fighters (id, display_name, gender, disciplines) select t.g(n), 'Ko ' || n, 'male', '{}' from generate_series(1, 8) n;
insert into public.entries (id, competition_id, fighter_id) select t.en(410 + n), t.comp(41), t.g(n) from generate_series(1, 8) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(41), t.comp(41), 'round_robin', 'Round 1', 0, t.en(411), t.en(412), 'active', 'Field 2'),
  (t.m(42), t.comp(41), 'round_robin', 'Round 1', 1, t.en(413), t.en(414), 'scheduled', 'Field 2'),
  (t.m(43), t.comp(41), 'round_robin', 'Round 1', 2, t.en(415), t.en(416), 'scheduled', 'Field 2'),
  (t.m(44), t.comp(41), 'round_robin', 'Round 1', 3, t.en(417), t.en(418), 'scheduled', 'Field 3');
select t.as_user(t.u(1));
select public.set_profight_format(t.comp(41), '2', 'tournament');

-- ================================================================ 1. the rehearsal: Red leads 10-7 after round 1, Red is knocked out in round 2
select t.as_user(t.u(4));
select t.expect_eq('the fight opens', public.lyst_open(t.m(41), 'simple') ->> 'scoring', 'outrance');
select t.start(41, 1); select t.stop(41, 1);
select t.paper(41, 1, 20, 0);
select t.expect_eq('round 1 confirmed: Red 10 - 7', (select (j -> 'units' ->> 'a') || '-' || (j -> 'units' ->> 'b') from (select public.outrance_confirm_round(gen_random_uuid(), t.m(41), 1, t.rev(41, 1)) j) x), '600-420');
select t.start(41, 2);
select t.as_user(t.u(3));
select t.expect_eq('round 2: the knight marshal calls a KO against Red', public.outrance_call(t.g(100), t.m(41), 2, 'a', 'ko') ->> 'status', 'ok');
select t.as_user(t.u(4));
select t.expect_eq('the totals stop the fight: next is "stopped", ended by the KO against Red',
  (select (j ->> 'next') || ' ' || (j -> 'ended_by' ->> 'key') || ' ' || (j -> 'ended_by' ->> 'side') from (select t.totals(41) j) x), 'stopped ko a');
select t.expect_error('a points decision is refused once a KO is on record', $q$select public.outrance_finish(gen_random_uuid(), t.m(41), t.ver(41), 'decision', 'a')$q$, 'P0001');
select t.expect_error('... and the head marshal''s decision too', $q$select public.outrance_finish(gen_random_uuid(), t.m(41), t.ver(41), 'head_marshal', 'a', 'decided')$q$, 'P0001');
select t.expect_error('the KO was against Red: Red cannot be the KO winner', $q$select public.outrance_finish(gen_random_uuid(), t.m(41), t.ver(41), 'ko', 'a')$q$, 'P0001');
select t.expect_error('the generic result path keeps the guard: Blue behind on points is refused there even with the KO on record',
  $q$select public.submit_match_result(gen_random_uuid(), t.m(41), 'b', 10, 7, '{}'::jsonb, t.ver(41))$q$, '22023');
select t.expect_error('... and so is finalize_match called directly', $q$select public.finalize_match(t.m(41), 'b', 10, 7, '{}'::jsonb, t.ver(41))$q$, null);
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot finish it', $q$select public.outrance_finish(gen_random_uuid(), t.m(41), t.ver(41), 'ko', 'b')$q$, '42501');
select t.as_user(t.u(4));
select t.expect_eq('P1: Blue, behind 7-10 on points, wins by KO with round 2 still open',
  public.outrance_finish(t.g(101), t.m(41), t.ver(41), 'ko', 'b') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('... the real totals are kept, not reversed: Blue wins, 10-7 on the score columns, win type KO',
  (select result || ' ' || score_a || '-' || score_b || ' ' || (detail ->> 'win_type') || ' ' || (detail ->> 'method') from public.matches where id = t.m(41)), 'b 10-7 ko ko');
select t.expect_eq('... Red is out of the tournament (§14.11)', t.holds(t.en(411)), 'knocked_out');
select t.expect_eq('... the mark does not outlive the finish', coalesce(current_setting('bos.outrance_stoppage', true), ''), '');
select t.as_user(t.u(4));
select t.expect_eq('the same command again is the same result, not a second one', public.outrance_finish(t.g(101), t.m(41), t.ver(41) - 1, 'ko', 'b') ->> 'repeat', 'true');
select t.as_admin();
select t.expect_eq('... one accepted result and one hold', (select count(*) from public.result_proposals where match_id = t.m(41) and status = 'accepted')::int || ' ' || (select count(*) from public.outrance_holds where entry_id = t.en(411))::int, '1 1');

-- ================================================================ 2. KO after both rounds are confirmed level: no 3rd round is offered or started (P2)
select t.as_admin();
update public.matches set queue_state = 'active' where id = t.m(42);
select t.as_user(t.u(4));
select public.lyst_open(t.m(42), 'simple');
select t.start(42, 1); select t.stop(42, 1); select t.paper(42, 1, 20, 0);
select public.outrance_confirm_round(gen_random_uuid(), t.m(42), 1, t.rev(42, 1));
select t.start(42, 2); select t.stop(42, 2); select t.paper(42, 2, 0, 20);
select public.outrance_confirm_round(gen_random_uuid(), t.m(42), 2, t.rev(42, 2));
select t.expect_eq('level 17-17 after 2 rounds: next is the 3rd round', t.totals(42) ->> 'next', 'tiebreak');
select t.as_user(t.u(3));
select public.outrance_call(t.g(110), t.m(42), 2, 'b', 'ko');
select t.as_user(t.u(4));
select t.expect_eq('... with a KO on record, next is "stopped", not the 3rd round', t.totals(42) ->> 'next', 'stopped');
select t.expect_error('a stale desk cannot start round 3 on the clock', $q$select public.lyst_timer_command(t.ev(1), 'Field 2', t.m(42), 0, gen_random_uuid(), 'start', 'fight', 90000, 3)$q$, 'P0001');
select t.as_user(t.u(2));
select public.lyst_void_discipline(gen_random_uuid(), t.g(110), 'wrong fighter');
select t.as_user(t.u(4));
select t.expect_eq('voiding the KO brings the 3rd round back', t.totals(42) ->> 'next', 'tiebreak');
select t.expect_eq('... and the clock starts it', public.lyst_timer_command(t.ev(1), 'Field 2', t.m(42), (select coalesce(max(rev), 0) from public.lyst_timer where event_id = t.ev(1) and field_key = 'field 2'), gen_random_uuid(), 'start', 'fight', 90000, 3) ->> 'status', 'ok');
select t.as_user(t.u(3));
select public.outrance_call(t.g(111), t.m(42), 3, 'a', 'ko');
select t.as_user(t.u(4));
select t.expect_eq('a KO in the 3rd round against Red: Blue wins (level on points)', public.outrance_finish(gen_random_uuid(), t.m(42), t.ver(42), 'ko', 'b') ->> 'status', 'accepted');

-- ================================================================ 3. Division 2 TKO loses the round only; a voided KO no longer excuses a lower score
select t.as_admin();
update public.matches set queue_state = 'active' where id = t.m(43);
select t.as_user(t.u(4));
select public.lyst_open(t.m(43), 'simple');
select t.start(43, 1); select t.stop(43, 1); select t.paper(43, 1, 20, 0);
select public.outrance_confirm_round(gen_random_uuid(), t.m(43), 1, t.rev(43, 1));
select t.start(43, 2);
select t.as_user(t.u(3));
select public.outrance_call(t.g(120), t.m(43), 2, 'a', 'tko');
select t.as_user(t.u(4));
select t.expect_eq('a Division 2 TKO does not stop the fight', coalesce(t.totals(43) ->> 'next', ''), 'confirm');
select t.expect_error('... and is not a finish', $q$select public.outrance_finish(gen_random_uuid(), t.m(43), t.ver(43), 'tko', 'b')$q$, 'P0001');
select t.as_user(t.u(3));
select public.outrance_call(t.g(121), t.m(43), 2, 'a', 'ko');
select t.as_user(t.u(2));
select public.lyst_void_discipline(gen_random_uuid(), t.g(121), 'not a knockout');
select t.as_user(t.u(4));
select t.expect_error('a voided KO is no finish', $q$select public.outrance_finish(gen_random_uuid(), t.m(43), t.ver(43), 'ko', 'b')$q$, 'P0001');

-- ================================================================ 4. a red card against the leader: the trailing fighter wins by disqualification
select t.as_admin();
update public.matches set queue_state = 'active' where id = t.m(44);
select t.as_user(t.u(4));
select public.lyst_open(t.m(44), 'simple');
select t.start(44, 1); select t.stop(44, 1); select t.paper(44, 1, 20, 0);
select public.outrance_confirm_round(gen_random_uuid(), t.m(44), 1, t.rev(44, 1));
select t.start(44, 2);
select t.as_user(t.u(3));
select public.outrance_call(gen_random_uuid(), t.m(44), 2, 'a', 'red');
select t.as_user(t.u(4));
select t.expect_eq('the red card stops the fight', t.totals(44) ->> 'next', 'stopped');
select t.expect_error('a disqualification against Red does not make Red the winner', $q$select public.outrance_finish(gen_random_uuid(), t.m(44), t.ver(44), 'dq', 'a')$q$, 'P0001');
select t.expect_eq('Blue, behind 7-10, wins by disqualification', public.outrance_finish(gen_random_uuid(), t.m(44), t.ver(44), 'dq', 'b') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('... 10-7 kept, win type dq', (select result || ' ' || score_a || '-' || score_b || ' ' || (detail ->> 'win_type') from public.matches where id = t.m(44)), 'b 10-7 dq');

-- ================================================================ 5. a duel keeps the guard: no Outrance call, no lower-scored winner
select t.as_admin();
select t.expect_eq('the stoppage helper is not callable by API roles',
  (select bool_or(has_function_privilege(r, 'private.outrance_fight_ender(uuid)', 'execute')) from unnest(array['anon', 'authenticated']) r), false);

-- ================================================================ 6. the counter phone is told the category, so a longsword phone can say "two hands" (Duels §2.1.4)
select t.expect_eq('counter_state_for carries the competition category', strpos(pg_get_functiondef('private.counter_state_for(uuid,boolean)'::regprocedure), '''category'', (select k.category from public.competitions k') > 0, true);

-- ================================================================ 7. the device heartbeat skips a row another request holds (no lock queue)
select t.expect_eq('counter_state_for and device_whoami take the heartbeat row with skip locked',
  (select bool_and(strpos(pg_get_functiondef(f), 'for update skip locked);') > 0 and strpos(pg_get_functiondef(f), 'last_seen_at < clock_timestamp() - interval ''30 seconds'');') = 0)
     from unnest(array['private.counter_state_for(uuid,boolean)'::regprocedure, 'public.device_whoami()'::regprocedure]) f), true);

do $$ begin raise notice 'REHEARSAL KO FINISH GATE PASSED % checks', (select count(*) from t.log); end $$;
rollback;
