-- Adversarial role gate (20261023000100_event_role_race_guards). Pack 18.1 fixture: u1 organizer, u2 head marshal, u3 marshal, u4 scorekeeper
-- (secretary) on E1; devices 'secretary' and 'admin' (Event Admin). E2 is another event with its own 'Field 1'. Everything is rolled back.
-- Two-session contention is tested separately; this gate covers the single-session outcomes and that the patches are in place.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

-- E1 Field 1: m2 on deck, m5 in the hole, m1 and m6 waiting. E1 Field 2: m3 on deck. E2 Field 1: m4 on now (must not affect E1).
select t.as_admin();
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(5), t.comp(1), 'round_robin', 'Round 2', 4, t.en(1), t.en(4), 'in_the_hole', 'Field 1'),
  (t.m(6), t.comp(1), 'round_robin', 'Round 2', 5, t.en(3), t.en(6), 'scheduled', 'Field 1');
update public.matches set queue_state = 'on_deck' where id in (t.m(2), t.m(3));
update public.matches set queue_state = 'active' where id = t.m(4);
create function t.st(n int) returns text language sql stable as $$ select queue_state from public.matches where id = t.m(n) $$;
create function t.vers(ids uuid[]) returns jsonb language sql stable as $$ select coalesce(jsonb_object_agg(id::text, jsonb_build_object('version', version, 'queue_state', queue_state, 'queue_order', queue_order, 'plan_order', plan_order, 'plan_hold', plan_hold)), '{}'::jsonb) from public.matches where id = any (ids) $$;
create function t.lineup() returns text language sql stable as $$
  select string_agg(right(id::text, 1) || ':' || queue_state || coalesce(':' || queue_order, ''), ',' order by id) from public.matches where id in (t.m(1), t.m(2), t.m(5), t.m(6)) $$;
create function t.n_audit(a text) returns integer language sql stable as $$ select count(*)::int from public.audit_log where action = a $$;
grant execute on function t.st(int), t.vers(uuid[]), t.lineup(), t.n_audit(text) to authenticated, bos_event_device;

-- ---------------------------------------------------------------- 0. the patches are in place
select t.expect_eq('set_match_queue carries the secretary race guard', position('race guard 20261023000100' in pg_get_functiondef('public.set_match_queue(uuid,text,text)'::regprocedure)) > 0, true);
select t.expect_eq('save_field_lineup takes the field Lyst lock and re-reads after locking',
  (select count(*)::int from regexp_matches(pg_get_functiondef('public.save_field_lineup(uuid,text,uuid[],jsonb)'::regprocedure), 'race guard 20261023000100', 'g')), 2);

-- ---------------------------------------------------------------- 1. the secretary starts a fight only on an idle field
select t.as_user(t.u(4));
select t.expect_ok('the secretary starts the called fight on an idle field (another event''s active "Field 1" does not count)', $q$select public.set_match_queue(t.m(2), 'active', null)$q$);
select t.expect_eq('... it is on now', t.st(2), 'active');
select t.expect_error('the secretary cannot start the fight in the hole while another is on now on the same field', $q$select public.set_match_queue(t.m(5), 'active', null)$q$, 'P0001');
select t.as_device(t.sid('secretary'));
select t.expect_error('... nor can the secretary tablet', $q$select public.set_match_queue(t.m(5), 'active', null)$q$, 'P0001');
select t.as_user(t.u(4));
select t.expect_eq('... nothing changed: one fight on now', t.lineup(), '1:scheduled,2:active,5:in_the_hole,6:scheduled');
select t.expect_ok('starting the fight already on now again is harmless', $q$select public.set_match_queue(t.m(2), 'active', null)$q$);
select t.expect_ok('the secretary starts the called fight on another field', $q$select public.set_match_queue(t.m(3), 'active', null)$q$);
select t.expect_eq('... Field 2 is on now', t.st(3), 'active');
select t.expect_error('the secretary still cannot start a waiting fight', $q$select public.set_match_queue(t.m(6), 'active', null)$q$, '42501');
select t.expect_error('... nor send a called fight back to the line', $q$select public.set_match_queue(t.m(5), 'scheduled', null)$q$, '42501');
select t.as_user(t.u(1));
select t.expect_ok_undo('the organizer is unchanged: may start a second fight on the field', $q$select public.set_match_queue(t.m(5), 'active', null)$q$);
select t.as_user(t.u(2));
select t.expect_ok_undo('... the head marshal too', $q$select public.set_match_queue(t.m(5), 'active', null)$q$);
select t.as_user(t.u(3));
select t.expect_ok_undo('... a marshal too', $q$select public.set_match_queue(t.m(5), 'active', null)$q$);
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('... and the Event Admin tablet', $q$select public.set_match_queue(t.m(5), 'active', null)$q$);
select t.as_user(t.u(4));
select t.expect_eq('... and the undone starts left Field 1 as it was', t.lineup(), '1:scheduled,2:active,5:in_the_hole,6:scheduled');

-- ---------------------------------------------------------------- 2. a fight that is opened, clocked or scored stops being editable, and an old screen changes nothing
select t.as_user(t.u(1));
select t.expect_eq('editable on Field 1: the waiting and called fights, not the one on now', public.editable_field_lineup(t.ev(1), 'Field 1'), (select array_agg(x order by x) from unnest(array[t.m(1), t.m(5), t.m(6)]) x));
select t.expect_eq('a fresh lineup saves', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(1), t.m(6)], t.vers(array[t.m(1), t.m(5), t.m(6)])) ->> 'status', 'ok');
select t.expect_eq('... audited once', t.n_audit('queue.lineup_saved'), 1);
create temp table seen as select t.lineup() as line, t.vers(array[t.m(1), t.m(5), t.m(6)]) as v;
grant select on seen to authenticated;

select t.expect_eq('the organizer opens 5 on the Lyst', public.lyst_open(t.m(5), 'simple') ->> 'status', 'ok');
select t.expect_eq('a lineup from before 5 was opened is stale', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(6), t.m(1), t.m(5)], (select v from seen)) ->> 'status', 'stale');
select t.expect_eq('... nothing moved', t.lineup(), (select line from seen));
select t.expect_eq('... 5 is no longer editable', public.editable_field_lineup(t.ev(1), 'Field 1'), (select array_agg(x order by x) from unnest(array[t.m(1), t.m(6)]) x));

update seen set v = t.vers(array[t.m(1), t.m(6)]);
select t.expect_eq('the clock is set on 6', public.lyst_timer_command(t.ev(1), 'Field 1', t.m(6), 0, gen_random_uuid(), 'set') ->> 'status', 'ok');
select t.expect_eq('a lineup from before 6 was on the clock is stale', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(6), t.m(1)], (select v from seen)) ->> 'status', 'stale');
select t.expect_eq('... nothing moved', t.lineup(), (select line from seen));

update seen set v = t.vers(array[t.m(1)]);
select t.as_admin();
insert into public.score_events (id, match_id, kind, payload, recorded_by) values (gen_random_uuid(), t.m(1), 'point', '{}', t.u(3));
select t.as_user(t.u(1));
select t.expect_eq('a lineup from before 1 had scoring history is stale', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(1)], (select v from seen)) ->> 'status', 'stale');
select t.expect_eq('... nothing moved', t.lineup(), (select line from seen));
select t.expect_eq('... and none of the refusals was audited', t.n_audit('queue.lineup_saved'), 1);
select t.expect_eq('Field 1 has nothing editable left', public.editable_field_lineup(t.ev(1), 'Field 1'), array[]::uuid[]);

-- ---------------------------------------------------------------- 3. a team fight's result agrees with its confirmed Lyst rounds
-- Team 5v5 (buhurt league, 2 rounds to win). m21 (Field 3) and m22 (Field 4) have Lyst round 1 confirmed 1-0; m23 (Field 5) is scored by hand.
select t.as_admin();
insert into public.teams (id, slug, name, status) values
  ('00000000-0000-0000-0000-0000000a7e01', 'adv-gate-anvil', 'Team Anvil', 'approved'), ('00000000-0000-0000-0000-0000000a7e02', 'adv-gate-bastion', 'Team Bastion', 'approved');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, rounds_to_win, sort) values (t.comp(3), t.ev(1), 'Team 5v5', '5v5', 'men', 'Classic', 'round_robin', 2, 2);
insert into public.entries (id, competition_id, team_id) values (t.en(21), t.comp(3), '00000000-0000-0000-0000-0000000a7e01'), (t.en(22), t.comp(3), '00000000-0000-0000-0000-0000000a7e02');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(21), t.comp(3), 'round_robin', 'Round 1', 0, t.en(21), t.en(22), 'active', 'Field 3'),
  (t.m(22), t.comp(3), 'round_robin', 'Round 1', 1, t.en(21), t.en(22), 'active', 'Field 4'),
  (t.m(23), t.comp(3), 'round_robin', 'Round 1', 2, t.en(21), t.en(22), 'active', 'Field 5');
create function t.tm(n int) returns text language sql stable security definer set search_path = '' as $$
  select queue_state || ':' || coalesce(result, '-') || ':' || coalesce(score_a::text, '-') || '-' || coalesce(score_b::text, '-') || ':' || version from public.matches where id = t.m(n) $$;
create function t.rounds(n int) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(round_no || ':' || status || ':' || coalesce(awarded_a::text, '-') || '-' || coalesce(awarded_b::text, '-'), ',' order by round_no), '') from public.lyst_rounds where match_id = t.m(n) $$;
create function t.n_props(n int) returns integer language sql stable security definer set search_path = '' as $$ select count(*)::int from public.result_proposals where match_id = t.m(n) $$;
create function t.ver(n int) returns integer language sql stable security definer set search_path = '' as $$ select version from public.matches where id = t.m(n) $$;
create function t.rev(n int, r int) returns integer language sql stable security definer set search_path = '' as $$ select rev from public.lyst_rounds where match_id = t.m(n) and round_no = r $$;
grant execute on function t.tm(int), t.rounds(int), t.n_props(int), t.ver(int), t.rev(int, int) to authenticated, bos_event_device;

select t.as_user(t.u(1));
select t.expect_eq('round 1 of m21 is confirmed 1-0 on the Lyst', public.lyst_confirm_round(gen_random_uuid(), t.m(21), 1, 1, 0, 0) ->> 'status', 'ok');
select t.expect_eq('... and of m22', public.lyst_confirm_round(gen_random_uuid(), t.m(22), 1, 1, 0, 0) ->> 'status', 'ok');

select t.as_user(t.u(4));
select t.expect_error('the secretary cannot finish 0-2 over a recorded 1-0', $q$select public.submit_match_result(gen_random_uuid(), t.m(21), 'b', 0, 2, '{"kind":"group","roundsToWin":2,"roundsWon":{"a":0,"b":2},"roundsPlayed":2}', t.ver(21), 1)$q$, 'P0001');
select t.expect_error('... a detail claiming another kind of fight does not bypass it', $q$select public.submit_match_result(gen_random_uuid(), t.m(21), 'b', 0, 2, '{"kind":"duel"}', t.ver(21), 1)$q$, 'P0001');
select t.expect_error('... nor does calling finalize_match directly', $q$select public.finalize_match(t.m(21), 'b', 0, 2, '{}', t.ver(21))$q$, 'P0001');
select t.as_device(t.sid('secretary'));
select t.expect_error('... nor the secretary tablet', $q$select public.submit_match_result(gen_random_uuid(), t.m(21), 'b', 0, 2, '{}', t.ver(21), 1)$q$, 'P0001');
select t.as_user(t.u(4));
select t.expect_error('a result short of the rounds to win (1-0 of 2) is refused', $q$select public.submit_match_result(gen_random_uuid(), t.m(21), 'a', 1, 0, '{}', t.ver(21), 1)$q$, 'P0001');
select t.expect_eq('... the fight is untouched', t.tm(21), 'active:-:---:0');
select t.expect_eq('... its Lyst rounds are untouched', t.rounds(21), '1:confirmed:1-0');
select t.expect_eq('... and no proposal was kept', t.n_props(21), 0);

select t.as_user(t.u(1));
select t.expect_eq('round 2 starts on the clock', public.lyst_timer_command(t.ev(1), 'Field 3', t.m(21), 0, gen_random_uuid(), 'start', 'fight', 60000, 2) ->> 'status', 'ok');
select t.as_user(t.u(4));
select t.expect_error('a result while round 2 is live is refused, even if it is what the board will say', $q$select public.submit_match_result(gen_random_uuid(), t.m(21), 'a', 2, 0, '{}', t.ver(21), 1)$q$, 'P0001');
select t.expect_eq('... nothing changed', t.tm(21) || ' ' || t.rounds(21), 'active:-:---:0 1:confirmed:1-0,2:running:---');
select t.as_user(t.u(1));
select t.expect_eq('round 2 is confirmed 1-0', public.lyst_confirm_round('00000000-0000-0000-0000-0000000adc03', t.m(21), 2, 1, 0, t.rev(21, 2)) ->> 'status', 'ok');
select t.as_user(t.u(4));
select t.expect_eq('the result that matches the Lyst (2-0) is accepted', public.submit_match_result('00000000-0000-0000-0000-0000000adc01', t.m(21), 'a', 2, 0, '{}', t.ver(21), 1) ->> 'status', 'accepted');
select t.expect_eq('... official', t.tm(21), 'final:a:2-0:1');
select t.expect_eq('a lost acknowledgement retried with the same command is recognised',
  (select r ->> 'status' || ':' || (r ->> 'repeat') from public.submit_match_result('00000000-0000-0000-0000-0000000adc01', t.m(21), 'a', 2, 0, '{}', 1, 1) r), 'accepted:true');
select t.as_user(t.u(1));
select t.expect_eq('a different result for the final fight is kept as a conflict, not applied', public.submit_match_result('00000000-0000-0000-0000-0000000adc02', t.m(21), 'b', 0, 2, '{}', t.ver(21), 1) ->> 'status', 'conflict');
select t.expect_eq('... still 2-0', t.tm(21), 'final:a:2-0:1');
select t.as_user(t.u(2));
select t.expect_ok('the head marshal may still decide the conflict for the proposal (audited override)', $q$select public.resolve_result_conflict('00000000-0000-0000-0000-0000000adc02', 'use_proposal', 'checked against the paper sheet')$q$);
select t.expect_eq('... the decided result stands', left(t.tm(21), 12), 'final:b:0-2:');
select t.expect_eq('... the Lyst rounds are kept as they were', t.rounds(21), '1:confirmed:1-0,2:confirmed:1-0');

select t.as_user(t.u(1));
select t.expect_eq('the organizer may enter an official result from paper over the Lyst (audited override)',
  public.enter_official_result(t.m(22), 'b', 0, 2, '{}', 'paper sheet 7') ->> 'status', 'entered');
select t.expect_eq('... official', t.tm(22), 'final:b:0-2:1');
select t.expect_eq('... audited', (select count(*)::int from public.audit_log where action = 'result.paper_entered' and subject = t.m(22)::text), 1);
select t.expect_eq('... and the Lyst round is kept', t.rounds(22), '1:confirmed:1-0');
select t.expect_eq('... the override mark does not outlive the call', coalesce(current_setting('bos.result_override', true), ''), '');

select t.as_user(t.u(4));
select t.expect_eq('a team fight with no Lyst rounds is still scored by hand', public.submit_match_result(gen_random_uuid(), t.m(23), 'a', 2, 1, '{}', t.ver(23), 1) ->> 'status', 'accepted');
select t.expect_eq('... official', t.tm(23), 'final:a:2-1:1');

-- ---------------------------------------------------------------- 4. an early finish by disqualification (the marshal's call), from the secretary
-- m24 (Field 6): round 1 confirmed 1-0 for a, then b is disqualified. 1-0 is short of the 2 rounds to win, so only the recorded DQ lets it finish.
select t.as_admin();
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(24), t.comp(3), 'round_robin', 'Round 2', 3, t.en(21), t.en(22), 'active', 'Field 6');
select t.as_user(t.u(4));
select t.expect_eq('the secretary confirms round 1 of m24 1-0', public.lyst_confirm_round(gen_random_uuid(), t.m(24), 1, 1, 0, 0) ->> 'status', 'ok');
select t.expect_error('without a disqualification, 1-0 cannot finish the fight', $q$select public.submit_match_result(gen_random_uuid(), t.m(24), 'a', 1, 0, '{}', t.ver(24), 1)$q$, 'P0001');
select t.expect_eq('the secretary records the marshal''s disqualification of b',
  public.lyst_record_discipline(p_command => gen_random_uuid(), p_match => t.m(24), p_round => 1, p_side => 'b', p_kind => 'dq', p_reason => 'struck a downed fighter', p_called_by => 'Head Marshal') ->> 'status', 'ok');
select t.expect_error('... the rounds won must still be the ones recorded', $q$select public.submit_match_result(gen_random_uuid(), t.m(24), 'a', 2, 0, '{}', t.ver(24), 1)$q$, 'P0001');
select t.expect_error('... and a DQ of b does not let b win', $q$select public.submit_match_result(gen_random_uuid(), t.m(24), 'b', 0, 1, '{}', t.ver(24), 1)$q$);
select t.expect_eq('... the fight is untouched', t.tm(24), 'active:-:---:0');
select t.expect_eq('the secretary finishes it by disqualification through the Lyst', public.lyst_finalize(gen_random_uuid(), t.m(24), t.ver(24), 'a', 'dq') ->> 'status', 'accepted');
select t.expect_eq('... official, rounds as recorded', t.tm(24), 'final:a:1-0:1');

-- ---------------------------------------------------------------- 5. nothing changes a final fight's Lyst rounds
select t.expect_eq('clock, end, confirm and return lock the fight and check it again',
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('lyst_timer_command', 'lyst_end_round', 'lyst_confirm_round', 'lyst_return_round')
      and position('private.lyst_lock_live_match(p_match)' in pg_get_functiondef(p.oid)) > 0), 4);
select t.as_admin();
select t.expect_error('the re-check under the lock refuses a final fight', $q$select private.lyst_lock_live_match(t.m(21))$q$, 'P0001');
select t.expect_ok('... and lets a live one through', $q$select private.lyst_lock_live_match(t.m(2))$q$);
select t.expect_eq('... the lock it takes does not block the Lyst''s other writers (key share only)',
  (select count(*)::int from pg_proc where proname = 'lyst_lock_live_match' and position('for key share' in pg_get_functiondef(oid)) > 0), 1);
select t.as_user(t.u(1));
select t.expect_error('a correction of a final fight''s round is refused', $q$select public.lyst_confirm_round(gen_random_uuid(), t.m(21), 2, 0, 1, t.rev(21, 2), null, null, 'late correction')$q$, 'P0001');
select t.expect_error('... returning it to the counters is refused', $q$select public.lyst_return_round(gen_random_uuid(), t.m(21), 2, t.rev(21, 2), 'recount please')$q$, 'P0001');
select t.expect_error('... ending a round is refused', $q$select public.lyst_end_round(t.m(21), 2)$q$, 'P0001');
select t.expect_error('... opening it cannot rebind the field to a final fight', $q$select public.lyst_open(t.m(21), 'standing')$q$, 'P0001');
select t.expect_error('... starting a round on the clock is refused', $q$select public.lyst_timer_command(t.ev(1), 'Field 3', t.m(21), (select rev from public.lyst_timer where event_id = t.ev(1) and field_key = 'field 3'), gen_random_uuid(), 'start', 'fight', 60000, 3)$q$, 'P0001');
select t.expect_eq('... the rounds are as they were', t.rounds(21), '1:confirmed:1-0,2:confirmed:1-0');
select t.expect_eq('a retried confirm already recorded is still answered as a duplicate', public.lyst_confirm_round('00000000-0000-0000-0000-0000000adc03', t.m(21), 2, 1, 0, 0) ->> 'status', 'duplicate');

select t.as_admin();
do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'ADVERSARIAL ROLE GATE PASSED % checks', n; end $$;
rollback;
