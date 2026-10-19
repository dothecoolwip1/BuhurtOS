-- Pack 18.1 gate 2: who may do what (migration 20261015000200), tested on the SERVER for every caller.
--   * one role: Secretary = Scorekeeper. It gains queue adjustment, announcements, a read-only Command Centre and Camera Off, and nothing else.
--   * the Temporary Organizer is NOT an organizer: event-day powers (results, staff below organizer, announcements, broadcast control), nothing platform-wide
--   * the Announcer is read-only (plus Camera Off); a Counter can only count; Marshal is today's marshal
--   * a device acts on its own event only; its actions are attributed to the device (label, role, session), never to "anonymous"
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run from the repo root:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack181_roles_gate.sql
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

-- ---------------------------------------------------------------- the matrix: every helper x every caller
create function t.who(w text) returns uuid language sql stable as $$
  select case w when 'organizer' then t.u(1) when 'head_marshal' then t.u(2) when 'marshal_staff' then t.u(3) when 'scorekeeper_staff' then t.u(4) when 'announcer_staff' then t.u(5)
                when 'medic' then t.u(6) when 'check_in' then t.u(7) when 'inspector' then t.u(8) when 'fighter' then t.u(9) when 'stranger' then t.u(10) when 'other_organizer' then t.u(11)
                when 'owner' then t.u(12) when 'counter_dev' then t.sid('counter1') when 'secretary_dev' then t.sid('secretary') when 'marshal_dev' then t.sid('marshal')
                when 'announcer_dev' then t.sid('announcer') when 'admin_dev' then t.sid('admin') when 'e2_marshal_dev' then t.sid('e2marshal') end $$;
create function t.can(w text, fn text, ev uuid default t.ev(1)) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform t.as_sub(t.who(w));
  execute format('select private.%I(%L::uuid)', fn, ev) into r;
  perform t.as_sub(null);
  return coalesce(r, false);
end $$;
create function t.truthset(fn text, ev uuid default t.ev(1)) returns text language sql as $$
  select coalesce(string_agg(w, ',' order by w), '') from unnest(array['organizer', 'head_marshal', 'marshal_staff', 'scorekeeper_staff', 'announcer_staff', 'medic', 'check_in', 'inspector', 'fighter',
    'stranger', 'other_organizer', 'owner', 'counter_dev', 'secretary_dev', 'marshal_dev', 'announcer_dev', 'admin_dev', 'e2_marshal_dev']) w where t.can(w, fn, ev) $$;
-- "owner" is the platform owner: passes every event check, by the existing rule
select t.expect_eq('is_organizer: the organizer and the owner only; NO device (not even the Temporary Organizer)', t.truthset('is_organizer'), 'organizer,owner');
select t.expect_eq('is_event_operator: organizer, owner, and the Temporary Organizer of THIS event', t.truthset('is_event_operator'), 'admin_dev,organizer,owner');
select t.expect_eq('can_score (scoring, timer, calling fights): organizer, head marshal, marshal, scorekeeper, owner + their device equivalents; never announcer or counter',
  t.truthset('can_score'), 'admin_dev,head_marshal,marshal_dev,marshal_staff,organizer,owner,scorekeeper_staff,secretary_dev');
select t.expect_eq('can_resolve_results (conflicts, paper results, overrides): head marshal, organizer, owner, Temporary Organizer; NOT the secretary or marshal',
  t.truthset('can_resolve_results'), 'admin_dev,head_marshal,organizer,owner');
-- secretary boundary (20261022000100): the secretary no longer has the Command Centre, the running order or announcements
select t.expect_eq('can_command (Command Centre, read only): organizer, head marshal, owner, Temporary Organizer; not the secretary or marshal',
  t.truthset('can_command'), 'admin_dev,head_marshal,organizer,owner');
select t.expect_eq('can_adjust_queue: organizer, owner, Temporary Organizer; not the secretary, head marshal, marshal or announcer',
  t.truthset('can_adjust_queue'), 'admin_dev,organizer,owner');
select t.expect_eq('can_announce: organizer, owner, Temporary Organizer; not the secretary', t.truthset('can_announce'), 'admin_dev,organizer,owner');
select t.expect_eq('can_camera_off_activate: marshal, head marshal, scorekeeper, announcer, Temporary Organizer, organizer, owner; NOT counter, fighter, check-in, inspector, medic, stranger',
  t.truthset('can_camera_off_activate'), 'admin_dev,announcer_dev,announcer_staff,head_marshal,marshal_dev,marshal_staff,organizer,owner,scorekeeper_staff,secretary_dev');
select t.expect_eq('can_camera_off_release: head marshal, Temporary Organizer, organizer, owner ONLY (marshal, secretary and announcer protect but cannot restore)',
  t.truthset('can_camera_off_release'), 'admin_dev,head_marshal,organizer,owner');
select t.expect_eq('can_broadcast_control (Take, Holding, AUTO/MANUAL, music): organizer, owner, Temporary Organizer; NOT head marshal, marshal, scorekeeper, announcer (Camera Off is not OBS access)',
  t.truthset('can_broadcast_control'), 'admin_dev,organizer,owner');
select t.expect_eq('can_read_health (medical): organizer, medic, owner; NO device', t.truthset('can_read_health'), 'medic,organizer,owner');
select t.expect_eq('the desk powers (check-in, inspection, readiness detail) are the head marshal''s, so the Temporary Organizer holds them; no other device does',
  t.truthset('can_check_in') || '|' || t.truthset('can_inspect') || '|' || t.truthset('can_see_readiness_detail'),
  'admin_dev,check_in,head_marshal,organizer,owner|admin_dev,head_marshal,inspector,organizer,owner|admin_dev,check_in,head_marshal,inspector,organizer,owner');
-- Event A vs Event B: nobody's E1 device counts for E2, and the E2 device counts for nothing in E1
select t.expect_eq('on Event 2 only the E2 organizer/head marshal/owner and the E2 marshal device have authority; no E1 device or E1 staff',
  t.truthset('can_score', t.ev(2)), 'e2_marshal_dev,other_organizer,owner');
select t.expect_eq('... can_camera_off_activate on E2', t.truthset('can_camera_off_activate', t.ev(2)), 'e2_marshal_dev,other_organizer,owner');
select t.expect_eq('... is_event_operator on E2 (no Temporary Organizer there)', t.truthset('is_event_operator', t.ev(2)), 'other_organizer,owner');
select t.expect_eq('... the E2 marshal device has no authority on E1', t.can('e2_marshal_dev', 'can_score', t.ev(1)), false);

-- ---------------------------------------------------------------- Lyst Control and counting with devices (the real functions)
select t.as_device(t.sid('marshal'));
select t.expect_ok('a Marshal device opens a match in Lyst Control', format($$select public.lyst_open(%L, 'simple')$$, t.m(1)));
select t.expect_eq('... and starts the fight clock', (public.lyst_timer_command(t.ev(1), 'Field 1', t.m(1), 0, gen_random_uuid(), 'start', 'fight', 60000, 1, 0) ->> 'status'), 'ok');
select t.expect_ok('... and makes a join code', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.ev(1)));
select t.as_admin();
select code as jcode from public.lyst_join_codes where event_id = t.ev(1) and revoked_at is null limit 1 \gset
select t.as_device(t.sid('counter1'));
select t.expect_eq('Counter Phone 1 (a legacy single-session counter code) binds itself to Field 1, red, as Garrett: seated at once on the open fight', (public.counter_bind('Field 1', 'a', 'Garrett') -> 'seat' ->> 'match_id'), t.m(1)::text);
select t.expect_error('a Counter cannot open a Lyst', format($$select public.lyst_open(%L)$$, t.m(1)), '42501');
select t.expect_error('... nor move a fight to another Lyst or time', format($$select public.set_match_schedule(%L, null, 'Field 2', null)$$, t.m(2)), '42501');
select t.expect_error('... read the tablet state (tallies of everyone)', format($$select public.lyst_state(%L)$$, t.m(1)), '42501');
select t.expect_error('... make a training code', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.ev(1)), '42501');
select t.expect_error('... call a fight', format($$select public.set_match_queue(%L, 'active', null)$$, t.m(2)), '42501');
select t.expect_error('... turn the cameras off (a Counter does not get Camera Off)', format($$select public.camera_off_activate(%L)$$, t.ev(1)), '42501');
select t.expect_error('... read counter tallies directly', 'select * from public.lyst_counts', '42501');
select t.expect_error('... show the Counter QR (that is for scoring staff)', format($$select public.counter_pool_code(%L)$$, t.ev(1)), '42501');
select t.expect_error('... list the event''s phones', format($$select public.list_event_device_sessions(%L)$$, t.ev(1)), '42501');
select t.expect_error('... move another phone', format($$select public.move_counter_session(%L, 'Field 2', 'b')$$, t.sid('counter2')), '42501');
select t.expect_error('... or sign another phone out', format($$select public.end_event_session(%L)$$, t.sid('counter2')), '42501');
select t.as_admin();
select t.expect_eq('the seat carries the operator''s name, not a person''s account', (select display_name from public.lyst_counter_seats where user_id = t.sid('counter1')), 'Garrett');
select id as seat1 from public.lyst_counter_seats where user_id = t.sid('counter1') \gset
select t.as_device(t.sid('e2counter'));
select t.expect_eq('an Event 2 Counter device binds to ITS OWN event''s Field 1 (no fight open there): never Event 1''s', (public.counter_bind('Field 1', 'a', 'Ghost') -> 'event' ->> 'slug') || '|' || jsonb_typeof(public.counter_state() -> 'seat' -> 'match_id'), 'p181-e2|null');
select t.as_admin();
select t.expect_eq('... and nothing of Event 1 was touched by it', (select count(*) from public.lyst_counter_seats where event_id = t.ev(1)), 1::bigint);
select t.as_device(t.sid('secretary'));
select t.expect_error('a Secretary device is not a counter: it cannot bind as one', $$select public.counter_bind('Field 1', 'a', 'Sec')$$, '42501');
select t.expect_error('the Secretary / Scorekeeper does not handle the Counter QR (secretary boundary)', format($$select public.counter_pool_code(%L)$$, t.ev(1)), '42501');
select t.expect_error('... nor moves a fight''s time (secretary boundary)', format($$select public.set_match_schedule(%L, '2026-10-10 20:00:00+00', null, null)$$, t.m(2)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Event Admin device shows the Counter QR state (none yet) and may create one (Pack 26)', (public.counter_pool_code(t.ev(1)) ->> 'can_create'), 'true');
select t.expect_eq('... and moves a waiting fight to a time, keeping its Lyst and length (Pack 26: set_match_schedule)',
  (public.set_match_schedule(t.m(2), '2026-10-10 20:00:00+00', (select field from public.matches where id = t.m(2)), null) ->> 'scheduled_at') is not null
  and (select duration_minutes from public.matches where id = t.m(2)) between 1 and 720, true);
select t.as_admin();
select t.expect_eq('... the move is audited with before and after', (select count(*) from public.audit_log where action = 'match.rescheduled' and subject = t.m(2)::text)::int, 1);
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary device cannot move a counter phone (secretary boundary)', format($$select public.move_counter_session(%L, 'Field 1', 'b')$$, t.sid('counter1')), '42501');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Event Admin device may move Counter Phone 1 to blue (scoring authority)', public.move_counter_session(t.sid('counter1'), 'Field 1', 'b') -> 'binding' ->> 'side', 'b');
select t.as_device(t.sid('counter1'));
select t.expect_eq('... the phone sees the change at once', public.counter_state() -> 'binding' ->> 'side', 'b');
select public.counter_bind('Field 1', 'a', 'Garrett');
select t.as_admin();
select id as seat1 from public.lyst_counter_seats where user_id = t.sid('counter1') and status = 'active' \gset
select t.as_device(t.sid('counter1'));
select t.expect_ok('the active Counter counts (own seat, running round)', format($$select public.counter_record(gen_random_uuid(), %L, 1, 1)$$, :'seat1'));
select t.expect_ok('... and reads its own state', 'select public.counter_state()');
select t.as_device(t.sid('counter2'));
select t.expect_error('another Counter cannot count on Phone 1''s seat', format($$select public.counter_record(gen_random_uuid(), %L, 1, 1)$$, :'seat1'));
select t.as_admin();
select t.expect_eq('the audit shows the Marshal device by name', (select count(*) from public.audit_log where action = 'lyst.timer' and actor = t.sid('marshal') and details -> 'device' ->> 'label' = 'Marshal Phone' and details -> 'device' ->> 'role' = 'marshal')::int, 1);
select t.expect_eq('... and the move names the Event Admin device', (select count(*) from public.audit_log where action = 'counter.moved' and details -> 'device' ->> 'label' = 'Event Admin Tablet')::int, 1);
select t.expect_eq('no device or session id appears as an auth account anywhere', (select count(*) from auth.users where id in (select sid from t.s))::int, 0);

-- the event's reusable Counter QR: whoever runs the day makes it (Pack 26): the Event Admin device too. What stays with the permanent organizer:
-- an Event Admin or stream controller code (nobody hands out more authority than they hold).
select t.as_device(t.sid('admin'));
select t.expect_error('the Event Admin device cannot mint another Event Admin code', format($$select public.create_event_credential(%L, 'device', 'Second Admin', 'temporary_organizer', %L)$$, t.ev(1), t.h(66)), '42501');
select t.expect_error('... nor a stream controller code', format($$select public.create_event_credential(%L, 'controller', 'Laptop 2', 'broadcast_controller', %L)$$, t.ev(1), t.h(67)), '42501');
select t.expect_ok('the Event Admin device creates the Counter QR', format($$select public.create_event_credential(%L, 'counter_pool', 'Counter QR', 'counter', %L, null, 'ABCDEFGH2345')$$, t.ev(1), t.h(60)));
select t.as_user(t.u(1));
select t.expect_error('one Counter QR per event: the organizer cannot make a second', format($$select public.create_event_credential(%L, 'counter_pool', 'Counter QR 2', 'counter', %L, null, 'ABCDEFGH2346')$$, t.ev(1), t.h(68)), '22023');
select t.as_admin();
select t.open(60, 'ip-q', 61) as q1 \gset
select t.open(60, 'ip-q', 62) as q2 \gset
select t.expect_eq('two phones scan it: two sessions, both alive', (select count(*) from public.event_sessions where credential_id = (select id from public.event_credentials where code_hash = t.h(60)) and ended_at is null), 2::bigint);
select t.as_device(:'q1');
select t.expect_eq('a pool phone reads as a counter device of Event 1', (public.device_whoami() ->> 'role') || '|' || (public.device_whoami() ->> 'kind') || '|' || (public.device_whoami() -> 'event' ->> 'slug'), 'counter|device|p181-e1');
select t.expect_eq('... binds like any counter', (public.counter_bind('Field 1', 'b', 'Taylor') -> 'seat' ->> 'side'), 'b');
select t.expect_error('... and has no more authority than that', format($$select public.lyst_open(%L)$$, t.m(1)), '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary device does not show the Counter QR (secretary boundary)', format($$select public.counter_pool_code(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_eq('the Marshal device shows the Counter QR for its own event', public.counter_pool_code(t.ev(1)) ->> 'code', 'ABCDEFGH2345');
select t.as_device(t.sid('e2marshal'));
select t.expect_error('an Event 2 marshal device cannot show Event 1''s Counter QR', format($$select public.counter_pool_code(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Event Admin device lists the event''s phones (with field, side and operator)', (select count(*) from jsonb_array_elements(public.list_event_device_sessions(t.ev(1))) x where x -> 'binding' ->> 'operator' = 'Taylor'), 1::bigint);
select t.expect_eq('... and signs one pool phone out; the other pool phone and the QR carry on', public.end_event_session(:'q2', 'dropped') ->> 'status', 'ended');
select t.as_device(:'q2');
select t.expect_error('the signed-out pool phone has no authority', 'select public.counter_state()', '42501');
select t.as_device(:'q1');
select t.expect_ok('the other pool phone still reads its state', 'select public.counter_state()');

-- a DEAD session has no authority even in the functions that only ask "is this your own seat?" (revocation and expiry are immediate, not at seat expiry)
select t.as_user(t.u(1));
select public.revoke_event_credential(t.cred('counter1'));
select t.as_device(t.sid('counter1'));
select t.expect_error('a revoked Counter cannot keep counting on the seat it already held', format($$select public.counter_record(gen_random_uuid(), %L, 1, 1)$$, :'seat1'), '42501');
select t.expect_error('... undo', format($$select public.counter_undo(gen_random_uuid(), %L, 1)$$, :'seat1'), '42501');
select t.expect_error('... submit', format($$select public.counter_submit(%L, 1)$$, :'seat1'), '42501');
select t.expect_error('... read its state', 'select public.counter_state()', '42501');
select t.expect_error('... end the seat', format($$select public.end_counter_seat(%L, false)$$, :'seat1'), '42501');
select t.expect_error('... or bind again', $$select public.counter_bind('Field 1', 'a', 'Garrett')$$, '42501');
select t.as_admin();
select t.expect_eq('... the seat itself was not touched by any of that', (select status from public.lyst_counter_seats where id = :'seat1'), 'active');
update public.events set starts_on = '2026-01-01', ends_on = '2026-01-01' where id = t.ev(1);
select t.as_device(t.sid('counter2'));
select t.expect_error('after the event + 24 h an expired Counter cannot bind either', $$select public.counter_bind('Field 1', 'a', 'Late')$$, '42501');
select t.as_device(:'q1');
select t.expect_error('... nor can a pool phone', 'select public.counter_state()', '42501');
select t.as_admin();
update public.events set starts_on = current_date, ends_on = current_date where id = t.ev(1);

-- ---------------------------------------------------------------- the queue (the existing line only)
select t.as_device(t.sid('secretary'));
-- secretary boundary: the secretary starts a fight already on the board; calling a waiting one and every running-order change are the organizer's
select t.expect_error('the Secretary / Scorekeeper cannot call a waiting fight', format($$select public.set_match_queue(%L, 'on_deck', null)$$, t.m(2)), '42501');
select t.expect_error('... reorder the line', format($$select public.move_match_in_queue(%L, 'first')$$, t.m(2)), '42501');
select t.expect_error('... save a plan', format($$select public.save_queue_plan(%L, array[%L]::uuid[], '{}')$$, t.ev(1), t.m(2)), '42501');
select t.expect_error('... clear the hand-made order', format($$select public.clear_manual_queue(%L, 'Field 1')$$, t.ev(1)), '42501');
select t.expect_error('... or save a field lineup', format($$select public.save_field_lineup(%L, 'Field 1', array[]::uuid[], '{}'::jsonb)$$, t.ev(1)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer saves a plan', format($$select public.save_queue_plan(%L, array[%L]::uuid[], '{}')$$, t.ev(1), t.m(2)));
select t.expect_ok_undo('... and clears the hand-made order', format($$select public.clear_manual_queue(%L, 'Field 1')$$, t.ev(1)));
select t.as_device(t.sid('secretary'));
select t.expect_error('... but not build a schedule', format($$select public.build_schedule(%L, '[]'::jsonb, 'new', null)$$, t.ev(1)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer may reorder the line', format($$select public.move_match_in_queue(%L, 'first')$$, t.m(2)));
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot reorder the line', format($$select public.move_match_in_queue(%L, 'first')$$, t.m(2)), '42501');
select t.expect_ok_undo('... but still calls fights by hand (can_score)', format($$select public.set_match_queue(%L, 'on_deck', null)$$, t.m(2)));
select t.as_device(t.sid('announcer'));
select t.expect_error('the Announcer cannot reorder the line', format($$select public.move_match_in_queue(%L, 'first')$$, t.m(2)), '42501');
select t.expect_error('... call a fight', format($$select public.set_match_queue(%L, 'on_deck', null)$$, t.m(2)), '42501');
select t.expect_error('... advance the queue', format($$select public.advance_field_queue(%L, null, true)$$, t.ev(1)), '42501');
select t.expect_error('... run the timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 1, gen_random_uuid(), 'pause')$$, t.ev(1), t.m(1)), '42501');
select t.expect_error('... open a Lyst', format($$select public.lyst_open(%L)$$, t.m(2)), '42501');
select t.expect_error('... score', format($$select public.record_score_event(gen_random_uuid(), %L, 'point', '{}'::jsonb, now())$$, t.m(1)), '42501');
select t.expect_error('... finalize a result', format($$select public.lyst_finalize(gen_random_uuid(), %L, 1, 'a', 'score', null)$$, t.m(1)), '42501');
select t.expect_error('... resolve conflicts', format($$select * from public.list_result_conflicts(%L)$$, t.ev(1)), '42501');
select t.expect_error('... enter an official result', format($$select public.enter_official_result(%L, 'a', 5, 2, '{}'::jsonb, 'x')$$, t.m(1)), '42501');
select t.expect_error('... send an announcement', format($$select public.send_event_announcement(%L, 'Lunch ends at 1:15 PM.')$$, t.ev(1)), '42501');
select t.expect_error('... read the announcement history', format($$select * from public.list_event_announcements(%L)$$, t.ev(1)), '42501');
select t.expect_error('... grant itself a role', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'scorekeeper')$$, t.ev(1)), '42501');
select t.expect_error('... read the Command Centre', format($$select public.event_command_snapshot(%L)$$, t.ev(1)), '42501');
select t.expect_error('... read the broadcast state', format($$select public.broadcast_control_state(%L)$$, t.ev(1)), '42501');
select t.expect_error('... take a Lyst on air', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"lyst","target_field":"Field 1"}'::jsonb)$$, t.ev(1)), '42501');
select t.expect_error('... set Lyst settings', format($$select public.set_lyst_settings(%L, '{}'::jsonb)$$, t.ev(1)), '42501');

-- ---------------------------------------------------------------- announcements (Pack 15): organizer, secretary, Temporary Organizer
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary / Scorekeeper cannot send an announcement (secretary boundary)', format($$select public.send_event_announcement(%L, 'Lunch ends at 1:15 PM.')$$, t.ev(1)), '42501');
select t.expect_error('... nor read the history', format($$select * from public.list_event_announcements(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot announce', format($$select public.send_event_announcement(%L, 'Hello there everyone.')$$, t.ev(1)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer announces too', (select (public.send_event_announcement(t.ev(1), 'Finals start at 4 PM.') ->> 'id') is not null), true);
select t.expect_eq('... and reads the history, with the DEVICE named as the sender', (select string_agg(sent_by_name, ',' order by sent_by_name) from public.list_event_announcements(t.ev(1))), 'Event Admin Tablet');
select t.as_admin();
select t.expect_eq('a device-sent announcement has no auth user behind it', (select count(*) from public.event_announcements where sent_by is not null and sent_by_label is not null)::int, 0);
select t.as_device(t.sid('e2marshal'));
select t.expect_error('another event''s device cannot announce here', format($$select public.send_event_announcement(%L, 'Hello there everyone.')$$, t.ev(1)), '42501');

-- ---------------------------------------------------------------- results: the Temporary Organizer corrects and voids (audited); nobody else of the devices
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary cannot correct an official result', format($$select public.correct_result(%L, %L, 1, 12, 'typo here')$$, t.comp(1), t.en(5)), '42501');
select t.expect_error('... void one', format($$select public.void_result(%L, %L, 'duplicate')$$, t.comp(1), t.en(6)), '42501');
select t.expect_error('... resolve a conflict', format($$select * from public.list_result_conflicts(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot correct a result', format($$select public.correct_result(%L, %L, 1, 12, 'typo here')$$, t.comp(1), t.en(5)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_ok('the Temporary Organizer corrects a result', format($$select public.correct_result(%L, %L, 1, 12, 'scoring typo')$$, t.comp(1), t.en(5)));
select t.expect_ok('... voids one', format($$select public.void_result(%L, %L, 'entered twice')$$, t.comp(1), t.en(6)));
select t.expect_ok('... and reads conflicts', format($$select * from public.list_result_conflicts(%L)$$, t.ev(1)));
select t.expect_error('... but not for another event', format($$select public.correct_result(%L, %L, 1, 12, 'typo here')$$, t.comp(2), t.en(7)), '42501');
select t.as_admin();
select t.expect_eq('the correction keeps the old value in the revision history', (select count(*) from public.result_revisions where action = 'corrected' and competition_id = t.comp(1) and entry_id = t.en(5) and old_points = 10 and new_points = 12)::int, 1);
select t.expect_eq('... and the audit names the Event Admin Tablet', (select count(*) from public.audit_log where action in ('result.corrected', 'result.voided') and details -> 'device' ->> 'label' = 'Event Admin Tablet' and details -> 'device' ->> 'role' = 'temporary_organizer')::int, 2);

-- ---------------------------------------------------------------- staff operations below organizer; names only
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer adds a scorekeeper by email', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'scorekeeper')$$, t.ev(1)));
select t.expect_ok_undo('... and an announcer', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'announcer')$$, t.ev(1)));
select t.expect_error('... but cannot make anyone an ORGANIZER', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'organizer')$$, t.ev(1)), '42501');
select t.expect_error('... cannot remove the organizer', format($$select public.remove_event_role(%L, %L, 'organizer')$$, t.ev(1), t.u(1)), '42501');
select t.expect_error('... cannot read staff emails', format($$select * from public.list_event_staff(%L)$$, t.ev(1)), '42501');
select t.expect_ok('... reads the staff by name', format($$select * from public.list_event_staff_names(%L)$$, t.ev(1)));
select t.expect_eq('... the names listing has no email column', pg_get_function_result('public.list_event_staff_names(uuid)'::regprocedure), 'TABLE(user_id uuid, name text, role text)');
select t.expect_eq('... and shows nobody''s email', (select count(*) from public.list_event_staff_names(t.ev(1)) where name like '%@%')::int, 0);
select t.expect_error('... cannot touch another event''s staff', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'scorekeeper')$$, t.ev(2)), '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary device cannot add staff (secretary boundary)', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'scorekeeper')$$, t.ev(1)), '42501');
select t.expect_error('... cannot make anyone an ORGANIZER', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'organizer')$$, t.ev(1)), '42501');
select t.expect_error('... cannot remove the organizer', format($$select public.remove_event_role(%L, %L, 'organizer')$$, t.ev(1), t.u(1)), '42501');
select t.expect_error('... cannot remove a marshal', format($$select public.remove_event_role(%L, %L, 'marshal')$$, t.ev(1), t.u(3)), '42501');
select t.expect_error('... does not see the staff by name', format($$select * from public.list_event_staff_names(%L)$$, t.ev(1)), '42501');
select t.expect_error('... never with emails (those stay with the permanent organizer)', format($$select * from public.list_event_staff(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(2));
select t.expect_ok_undo('the head marshal still adds a scorekeeper (Pack 26)', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'scorekeeper')$$, t.ev(1)));
select t.expect_ok('... and sees the staff by name', format($$select * from public.list_event_staff_names(%L)$$, t.ev(1)));
select t.as_user(t.u(1));
select t.expect_ok_undo('the permanent organizer still adds an organizer', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'organizer')$$, t.ev(1)));
select t.expect_ok_undo('... and the new announcer role', format($$select public.grant_event_role_by_email(%L, 'p181u10@example.test', 'announcer')$$, t.ev(1)));

-- ---------------------------------------------------------------- readiness overrides without a person behind the device
select t.as_admin();
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000a1810', t.ev(1), 1, 'Waiver', 'Fictional waiver text for the gate.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer)
values ('00000000-0000-0000-0000-0000000ae181', t.ev(1), t.u(9), ('00000000-0000-0000-0000-' || lpad('f1811', 12, '0'))::uuid, 'accepted', 'Fighter 1', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a1810', 'Signed', false);
select t.as_device(t.sid('admin'));
select t.expect_ok('the Temporary Organizer overrides a readiness block (head marshal power)', $$select public.set_readiness_override('00000000-0000-0000-0000-0000000ae181', 'kit approved on the floor')$$);
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary cannot override readiness', $$select public.set_readiness_override('00000000-0000-0000-0000-0000000ae181', 'kit approved on the floor')$$, '42501');
select t.as_admin();
select t.expect_eq('the override row names no person (a device has none) ...', (select created_by is null from public.registration_overrides where registration_id = '00000000-0000-0000-0000-0000000ae181' and revoked_at is null), true);
select t.expect_eq('... the audit names the device', (select count(*) from public.audit_log where action = 'readiness.override' and details -> 'device' ->> 'label' = 'Event Admin Tablet')::int, 1);
select t.as_device(t.sid('admin'));
select t.expect_ok('... and clears it', $$select public.clear_readiness_override('00000000-0000-0000-0000-0000000ae181')$$);

-- ---------------------------------------------------------------- Command Centre: read only, and what each viewer is told they may do
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary has no Command Centre (secretary boundary)', format($$select public.event_command_snapshot(%L)$$, t.ev(1)), '42501');
select t.expect_eq('... its board says: may turn cameras off, may not announce, not an operator',
  (select format('%s/%s/%s', v ->> 'camera_off', v ->> 'announce', v ->> 'operator') from (select public.secretary_board(t.ev(1)) -> 'viewer' v) x), 'true/false/false');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer: operator, may announce, activate and release, control the broadcast',
  (select format('%s/%s/%s/%s/%s/%s', v ->> 'organizer', v ->> 'announce', v ->> 'camera_off', v ->> 'camera_release', v ->> 'operator', v ->> 'broadcast') from (select public.event_command_snapshot(t.ev(1)) -> 'viewer' v) x), 'false/true/true/true/true/true');
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot read it', format($$select public.event_command_snapshot(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('counter1'));
select t.expect_error('a Counter cannot', format($$select public.event_command_snapshot(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('e2marshal'));
select t.expect_error('an Event 2 device cannot read Event 1''s', format($$select public.event_command_snapshot(%L)$$, t.ev(1)), '42501');

-- ---------------------------------------------------------------- the announcer's one extra read
select t.as_device(t.sid('announcer'));
select t.expect_eq('the Announcer reads ready / not ready: three columns, no reasons', pg_get_function_result('public.announcer_readiness(uuid)'::regprocedure), 'TABLE(match_id uuid, side text, ready boolean)');
select t.expect_ok('announcer_readiness works for the Announcer', format($$select * from public.announcer_readiness(%L)$$, t.ev(1)));
select t.expect_eq('... one row per side of the fights coming up (6 sides across 3 scheduled fights)', (select count(*) from public.announcer_readiness(t.ev(1)))::int, 6);
select t.as_device(t.sid('counter1'));
select t.expect_error('a Counter cannot read it', format($$select * from public.announcer_readiness(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('e2marshal'));
select t.expect_error('another event''s device cannot', format($$select * from public.announcer_readiness(%L)$$, t.ev(1)), '42501');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK181 ROLES GATE PASSED % checks', n; end $$;
rollback;
