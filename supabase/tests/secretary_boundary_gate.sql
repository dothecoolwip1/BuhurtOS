-- Secretary boundary gate (20261022000100). Uses the Pack 18.1 fixture: u1 organizer, u2 head marshal, u3 marshal, u4 scorekeeper (secretary) on E1;
-- devices 'secretary' (scorekeeper) and 'admin' (temporary organizer). Each "denied" check is a call the secretary COULD make before this migration.
-- Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

-- Field 1: m1 on now (active), m2 on deck, m5 waiting. Field 2: m3 waiting. E2: m4.
select t.as_admin();
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field)
  values (t.m(5), t.comp(1), 'round_robin', 'Round 2', 3, t.en(1), t.en(3), 'scheduled', 'Field 1');
update public.matches set queue_state = 'active' where id = t.m(1);
update public.matches set queue_state = 'on_deck' where id = t.m(2);

-- ---------------------------------------------------------------- 1. helpers
select t.as_sub(t.u(4));
select t.expect_eq('secretary is secretary-only', private.is_secretary_only(t.ev(1)), true);
select t.expect_eq('secretary scores the fight on now', private.can_score_match(t.m(1)), true);
select t.expect_eq('secretary scores the fight on deck', private.can_score_match(t.m(2)), true);
select t.expect_eq('secretary cannot score a waiting fight', private.can_score_match(t.m(5)), false);
select t.expect_eq('secretary cannot score another field''s waiting fight', private.can_score_match(t.m(3)), false);
select t.expect_eq('secretary cannot score another event', private.can_score_match(t.m(4)), false);
select t.expect_eq('secretary has no command', private.can_command(t.ev(1)), false);
select t.expect_eq('secretary cannot adjust the queue', private.can_adjust_queue(t.ev(1)), false);
select t.expect_eq('secretary cannot announce', private.can_announce(t.ev(1)), false);
select t.as_sub(t.sid('secretary'));
select t.expect_eq('secretary device is secretary-only', private.is_secretary_only(t.ev(1)), true);
select t.expect_eq('secretary device cannot score a waiting fight', private.can_score_match(t.m(5)), false);
select t.as_sub(t.u(3));
select t.expect_eq('marshal is not secretary-only', private.is_secretary_only(t.ev(1)), false);
select t.expect_eq('marshal scores a waiting fight', private.can_score_match(t.m(5)), true);
select t.as_sub(t.u(2));
select t.expect_eq('head marshal keeps command', private.can_command(t.ev(1)), true);
select t.expect_eq('head marshal scores a waiting fight', private.can_score_match(t.m(5)), true);
select t.as_sub(t.sid('admin'));
select t.expect_eq('event admin tablet is not secretary-only', private.is_secretary_only(t.ev(1)), false);
select t.expect_eq('event admin tablet keeps command', private.can_command(t.ev(1)), true);
select t.expect_eq('event admin tablet keeps the queue', private.can_adjust_queue(t.ev(1)), true);
select t.expect_eq('event admin tablet keeps announcements', private.can_announce(t.ev(1)), true);
select t.expect_eq('event admin tablet scores a waiting fight', private.can_score_match(t.m(5)), true);
select t.as_sub(t.u(1));
select t.expect_eq('organizer adjusts the queue', private.can_adjust_queue(t.ev(1)), true);
select t.expect_eq('organizer scores a waiting fight', private.can_score_match(t.m(5)), true);

-- ---------------------------------------------------------------- 2. the secretary's calls (old behaviour: every denied one used to succeed)
select t.as_user(t.u(4));
select t.expect_error('secretary cannot open a waiting fight', $q$select public.lyst_open(t.m(5))$q$, '42501');
select t.expect_error('secretary cannot set the clock on a waiting fight',
  $q$select public.lyst_timer_command(t.ev(1), 'Field 1', t.m(5), 0, gen_random_uuid(), 'set')$q$, '42501');
select t.expect_error('secretary cannot read a waiting fight''s Lyst', $q$select public.lyst_state(t.m(5))$q$, '42501');
select t.expect_error('secretary cannot call a waiting fight', $q$select public.set_match_queue(t.m(5), 'active')$q$, '42501');
select t.expect_error('secretary cannot send the on-deck fight back', $q$select public.set_match_queue(t.m(2), 'scheduled')$q$, '42501');
select t.expect_error('secretary cannot move a fight to another Lyst', $q$select public.set_match_queue(t.m(2), 'active', 'Field 2')$q$, '42501');
select t.expect_ok_undo('secretary starts the on-deck fight', $q$select public.set_match_queue(t.m(2), 'active')$q$);
select t.expect_ok_undo('secretary may still fill the field''s line', $q$select public.advance_field_queue(t.ev(1), 'Field 1', false)$q$);
select t.expect_error('secretary cannot reorder', $q$select public.move_match_in_queue(t.m(2), 'later')$q$, '42501');
select t.expect_error('secretary cannot hold a fight', $q$select public.set_match_hold(t.m(5), true, 'not here')$q$, '42501');
select t.expect_error('secretary cannot move a fight''s time or Lyst', $q$select public.set_match_schedule(t.m(5), null, 'Field 2')$q$, '42501');
select t.expect_error('secretary cannot announce', $q$select public.send_event_announcement(t.ev(1), 'hello', 'everyone')$q$);
select t.expect_error('secretary cannot see the devices', $q$select public.list_event_device_sessions(t.ev(1))$q$, '42501');
select t.expect_error('secretary cannot see the Counter QR', $q$select public.counter_pool_code(t.ev(1))$q$, '42501');
select t.expect_error('secretary cannot make a training QR', $q$select public.create_lyst_join_code(t.ev(1), 'Field 1')$q$, '42501');
select t.expect_error('secretary cannot see the staff', $q$select public.list_event_staff_names(t.ev(1))$q$, '42501');
select t.expect_error('secretary has no Command Centre', $q$select public.event_command_snapshot(t.ev(1))$q$);
select t.expect_error('secretary cannot submit a waiting fight''s result',
  $q$select public.submit_match_result(gen_random_uuid(), t.m(5), 'a', 1, 0, '{}'::jsonb, (select version from public.matches where id = t.m(5)))$q$, '42501');
select t.expect_error('secretary cannot score a waiting fight classically',
  $q$select public.record_score_event(gen_random_uuid(), t.m(5), 'point', '{}'::jsonb)$q$, '42501');
select t.expect_ok_undo('secretary scores the fight on now classically', $q$select public.record_score_event(gen_random_uuid(), t.m(1), 'point', '{}'::jsonb)$q$);

-- the board
select t.expect_eq('board: now', (select f -> 'now' ->> 'match_id' from jsonb_array_elements(public.secretary_board(t.ev(1)) -> 'fields') f where f ->> 'key' = 'field 1'), t.m(1)::text);
select t.expect_eq('board: on deck', (select f -> 'on_deck' ->> 'match_id' from jsonb_array_elements(public.secretary_board(t.ev(1)) -> 'fields') f where f ->> 'key' = 'field 1'), t.m(2)::text);
select t.expect_eq('board: viewer is the secretary', public.secretary_board(t.ev(1)) -> 'viewer' ->> 'secretary_only', 'true');
select t.expect_eq('board: no queue control', public.secretary_board(t.ev(1)) -> 'viewer' ->> 'adjust_queue', 'false');
select t.expect_eq('board: no codes or devices in it', public.secretary_board(t.ev(1))::text ~ '(join_code|session_id|pool_code)', false);
select t.expect_error('board: another event', $q$select public.secretary_board(t.ev(2))$q$, '42501');
select t.as_device(t.sid('secretary'));
select t.expect_ok('secretary device reads the board', $q$select public.secretary_board(t.ev(1))$q$);
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot read the board', $q$select public.secretary_board(t.ev(1))$q$, '42501');
select t.as_user(t.u(1));
select t.expect_eq('board: organizer has queue control', public.secretary_board(t.ev(1)) -> 'viewer' ->> 'adjust_queue', 'true');
select t.expect_ok_undo('organizer reorders', $q$select public.move_match_in_queue(t.m(2), 'later')$q$);
select t.as_user(t.u(3));
select t.expect_ok_undo('marshal opens a waiting fight', $q$select public.lyst_open(t.m(5))$q$);

-- ---------------------------------------------------------------- 3. the fight on now: count, accept, return, amend, override
select t.as_user(t.u(4));
select t.expect_ok('secretary opens the fight on now', $q$select public.lyst_open(t.m(1))$q$);
select t.expect_eq('secretary starts the clock', public.lyst_timer_command(t.ev(1), 'Field 1', t.m(1), 0, gen_random_uuid(), 'start', 'fight', 60000, 1, 0) ->> 'status', 'ok');
select t.expect_ok('secretary reads the fight on now', $q$select public.lyst_state(t.m(1))$q$);
select t.expect_eq('the training code is not shown to the secretary', public.lyst_state(t.m(1)) -> 'join_code', 'null'::jsonb);

-- an official counter (an account) on side a tallies 2 and submits; a waiting fight has evidence too
select t.as_admin();
insert into public.lyst_counter_seats (id, event_id, field_key, user_id, display_name, match_id, side, role, status, expires_at)
  values ('00000000-0000-0000-0000-5ec000000001', t.ev(1), 'field 1', t.u(9), 'Counter Nine', t.m(1), 'a', 'official', 'active', now() + interval '1 hour'),
         ('00000000-0000-0000-0000-5ec000000002', t.ev(1), 'field 1', t.u(10), 'Counter Ten', t.m(5), 'a', 'official', 'active', now() + interval '1 hour');
insert into public.lyst_counts (id, seat_id, match_id, round_no, weight) values
  (gen_random_uuid(), '00000000-0000-0000-0000-5ec000000001', t.m(1), 1, 1), (gen_random_uuid(), '00000000-0000-0000-0000-5ec000000001', t.m(1), 1, 1),
  (gen_random_uuid(), '00000000-0000-0000-0000-5ec000000002', t.m(5), 1, 1);
insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values ('00000000-0000-0000-0000-5ec000000001', t.m(1), 1);

select t.as_user(t.u(4));
select t.expect_eq('evidence: the secretary sees the tallies of the fight on now', (select count(*)::int from public.lyst_counts where match_id = t.m(1)), 2);
select t.expect_eq('evidence: the secretary does not see a waiting fight''s tallies', (select count(*)::int from public.lyst_counts where match_id = t.m(5)), 0);
select t.expect_eq('evidence: nor its seats', (select count(*)::int from public.lyst_counter_seats where match_id = t.m(5)), 0);
select t.as_user(t.u(3));
select t.expect_eq('evidence: the marshal sees a waiting fight''s tallies', (select count(*)::int from public.lyst_counts where match_id = t.m(5)), 1);

select t.as_user(t.u(4));
select t.expect_error('manual score over the counters needs a reason', $q$select public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 1, 0, 1)$q$, '22023');
select t.expect_eq('accept the counters'' total', public.lyst_confirm_round('00000000-0000-0000-0000-5ec0000000c1', t.m(1), 1, 2, 0, 1) ->> 'status', 'ok');
select t.expect_error('returning a confirmed round needs a reason', $q$select public.lyst_return_round(gen_random_uuid(), t.m(1), 1, 2)$q$, '22023');
select t.expect_eq('return: a stale revision changes nothing', public.lyst_return_round(gen_random_uuid(), t.m(1), 1, 1, 'recount please') ->> 'status', 'stale');
select t.expect_eq('return: ok', public.lyst_return_round('00000000-0000-0000-0000-5ec0000000a1', t.m(1), 1, 2, 'recount please') ->> 'status', 'ok');
select t.expect_eq('return: a retry is a duplicate', public.lyst_return_round('00000000-0000-0000-0000-5ec0000000a1', t.m(1), 1, 2, 'recount please') ->> 'status', 'duplicate');
select t.expect_eq('return: a running round is unchanged', public.lyst_return_round(gen_random_uuid(), t.m(1), 1, 3) ->> 'status', 'unchanged');
select t.as_user(t.u(2));
select t.expect_error('return: someone else''s command id', $q$select public.lyst_return_round('00000000-0000-0000-0000-5ec0000000a1', t.m(1), 1, 3, 'x y z')$q$, '42501');

select t.as_admin();
select t.expect_eq('return: the round runs again, unofficial', (select status || ':' || coalesce(awarded_a::text, '-') from public.lyst_rounds where match_id = t.m(1) and round_no = 1), 'running:-');
select t.expect_eq('return: the submission is reset', (select count(*)::int from public.lyst_counter_rounds where match_id = t.m(1) and round_no = 1), 0);
select t.expect_eq('return: the tally evidence stays', (select count(*)::int from public.lyst_counts where match_id = t.m(1)), 2);
select t.expect_eq('return: the record keeps the submission and the old score',
  (select jsonb_array_length(submissions) || ':' || previous_status || ':' || previous_a from public.lyst_round_returns where id = '00000000-0000-0000-0000-5ec0000000a1'), '1:confirmed:2');
select t.expect_eq('return: audited once', (select count(*)::int from public.audit_log where action = 'lyst.round_returned' and subject = t.m(1)::text), 1);
select t.expect_error('return: the record is append-only', $q$delete from public.lyst_round_returns$q$);

select t.as_user(t.u(9));
select t.expect_ok('the counter submits again', $q$select public.counter_submit('00000000-0000-0000-0000-5ec000000001', 1)$q$);
select t.as_user(t.u(4));
select t.expect_eq('evidence: the secretary reads the return', (select count(*)::int from public.lyst_round_returns where match_id = t.m(1)), 1);
select t.expect_eq('manual score over the counters with a reason', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 1, 0, 3, null, null, 'marshal saw a double') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('the override is audited',
  (select count(*) filter (where details ->> 'override' = 'true') || '/' || count(*) from public.audit_log where action = 'lyst.round_confirmed' and subject = t.m(1)::text), '1/2');

-- ---------------------------------------------------------------- 4. devices and in-flight fights
select t.as_device(t.sid('secretary'));
select t.expect_error('secretary device cannot return a waiting fight''s round', $q$select public.lyst_return_round(gen_random_uuid(), t.m(5), 1, 1, 'x y z')$q$, '42501');
select t.as_admin();
insert into public.lyst_field_current (event_id, field_key, match_id) values (t.ev(1), 'field 2', t.m(3));
select t.as_sub(t.u(4));
select t.expect_eq('in flight: a waiting fight the Lyst already runs stays reachable', private.can_score_match(t.m(3)), true);

select t.as_admin();
do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'SECRETARY BOUNDARY GATE PASSED % checks', n; end $$;
rollback;
