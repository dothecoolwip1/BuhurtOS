-- Pack 18.1 gate 3: Camera Off, broadcast control, and the stream controller (migrations 20261015000200 / 20261015000300).
--   * Camera Off ACTIVATE: marshal, head marshal, scorekeeper (secretary), announcer, Temporary Organizer, organizer, owner. Nobody else.
--   * Camera Off RELEASE: head marshal, Temporary Organizer, organizer, owner. Marshal, secretary and announcer can protect but never restore.
--   * latched: only camera_off_release clears it; nothing the tournament does (fights, queue, results) can; every change is audited and logged append-only
--   * Camera Off is not OBS access; broadcast control (Take, Holding, AUTO/MANUAL, music) is organizer / owner / Temporary Organizer only
--   * the controller can read its own event's desired state and report status, and execute nothing else; the tournament never reads either
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run from the repo root:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack181_broadcast_gate.sql
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

create function t.cam_world() returns text language sql volatile security definer as $$
  select md5(coalesce((select string_agg(m::text, '|' order by m.id) from public.matches m), '') || coalesce((select string_agg(r::text, '|' order by r.id) from public.results r), '')
          || coalesce((select string_agg(l::text, '|' order by l.event_id, l.field_key) from public.lyst_timer l), '')) $$;
create function t.cam() returns jsonb language sql volatile security definer as $$ select private.camera_state_json(t.ev(1)) $$;

-- ---------------------------------------------------------------- nothing is off to begin with
select t.expect_eq('cameras are on by default', (t.cam() ->> 'active')::boolean, false);

-- ---------------------------------------------------------------- ACTIVATE: every role that may, and every one that may not
select t.as_device(t.sid('counter1'));
select t.expect_error('a Counter cannot activate (a Counter does not get Camera Off)', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(9));
select t.expect_error('a fighter cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(7));
select t.expect_error('check-in cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(8));
select t.expect_error('an armour inspector cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(6));
select t.expect_error('a medic cannot (as a medic)', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_user(t.u(13));
select t.expect_error('another event''s head marshal cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_device(t.sid('e2marshal'));
select t.expect_error('another event''s Marshal device cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_anon();
select t.expect_error('anonymous cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_ctrl(t.sid('controller'));
select t.expect_error('the stream controller cannot', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)), '42501');
select t.as_admin();
select t.expect_eq('... none of those changed anything', (t.cam() ->> 'active')::boolean, false);

-- the allowed activators, one at a time (each is undone so the next can try)
select t.as_device(t.sid('marshal'));
select t.expect_ok_undo('a Marshal device can activate', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_device(t.sid('secretary'));
select t.expect_ok_undo('the Secretary / Scorekeeper device can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_device(t.sid('announcer'));
select t.expect_ok_undo('the Announcer device can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer device can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(2));
select t.expect_ok_undo('the head marshal can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(3));
select t.expect_ok_undo('a (permanent) marshal can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(4));
select t.expect_ok_undo('a (permanent) scorekeeper can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(5));
select t.expect_ok_undo('a (permanent) announcer can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(1));
select t.expect_ok_undo('the permanent organizer can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_user(t.u(12));
select t.expect_ok_undo('the platform owner can', format($$select public.camera_off_activate(%L, 'medical')$$, t.ev(1)));
select t.as_admin();
select t.expect_eq('... and each of those was undone: still on', (t.cam() ->> 'active')::boolean, false);

-- ---------------------------------------------------------------- an activation, shown as it will be on screen
select t.as_device(t.sid('marshal'));
select t.expect_eq('the Marshal Phone turns the cameras off', public.camera_off_activate(t.ev(1), 'medical') ->> 'status', 'off');
select t.as_admin();
select t.expect_eq('state: off, who, which role, why', (select format('%s/%s/%s/%s', c ->> 'active', c ->> 'activated_by_label', c ->> 'activated_by_role', c ->> 'reason') from (select t.cam() c) x), 'true/Marshal Phone/marshal/medical');
select t.as_device(t.sid('announcer'));
select t.expect_eq('a second activation changes nothing (idempotent: the first activator stays)', public.camera_off_activate(t.ev(1), 'privacy') ->> 'status', 'already_off');
select t.as_admin();
select t.expect_eq('... still the Marshal Phone and the first reason', (select format('%s/%s', c ->> 'activated_by_label', c ->> 'reason') from (select t.cam() c) x), 'Marshal Phone/medical');
select t.expect_eq('the revision moved once', (t.cam() ->> 'rev')::int, 1);

-- ---------------------------------------------------------------- RELEASE: only the senior roles
select t.as_device(t.sid('marshal'));
select t.expect_error('the Marshal who turned them off cannot turn them back on', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary / Scorekeeper cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('announcer'));
select t.expect_error('the Announcer cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('counter1'));
select t.expect_error('a Counter cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(3));
select t.expect_error('a permanent marshal cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(4));
select t.expect_error('a permanent scorekeeper cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(5));
select t.expect_error('a permanent announcer cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('e2marshal'));
select t.expect_error('another event''s device cannot release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_ctrl(t.sid('controller'));
select t.expect_error('the controller cannot release (it executes nothing but its own two functions)', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.as_admin();
select t.expect_eq('... still off after all those attempts', (t.cam() ->> 'active')::boolean, true);

-- ---------------------------------------------------------------- LATCH: nothing the tournament does turns the cameras back on
select t.as_device(t.sid('marshal'));
select public.lyst_open(t.m(2), 'simple');
select public.lyst_timer_command(t.ev(1), 'Field 1', t.m(2), 0, gen_random_uuid(), 'start', 'fight', 60000, 1, 0);
select t.as_device(t.sid('secretary'));
select public.set_match_queue(t.m(3), 'active', null);
select t.as_admin();
update public.matches set queue_state = 'final', result = 'a', score_a = 3, score_b = 1, finalized_at = now() where id = t.m(2);
select t.expect_eq('a new fight starting, a fight finishing and queue changes leave Camera Off latched', (t.cam() ->> 'active')::boolean, true);
select t.expect_eq('... the tournament keeps working (the fight finished, a new one is active)', array[(select queue_state from public.matches where id = t.m(2)), (select queue_state from public.matches where id = t.m(3))], array['final', 'active']);

-- release by each senior role; each is undone to try the next
select t.as_user(t.u(2));
select t.expect_ok_undo('the head marshal can release', format($$select public.camera_off_release(%L, 'player is fine')$$, t.ev(1)));
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer can release', format($$select public.camera_off_release(%L)$$, t.ev(1)));
select t.as_user(t.u(1));
select t.expect_ok_undo('the permanent organizer can release', format($$select public.camera_off_release(%L)$$, t.ev(1)));
select t.as_user(t.u(12));
select t.expect_ok_undo('the platform owner can release', format($$select public.camera_off_release(%L)$$, t.ev(1)));
select t.as_admin();
select t.expect_eq('(undone: still off)', (t.cam() ->> 'active')::boolean, true);
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer turns the cameras back on', public.camera_off_release(t.ev(1), 'player is fine, hold ended') ->> 'status', 'on');
select t.as_admin();
select t.expect_eq('state: on again, by whom', (select format('%s/%s/%s', c ->> 'active', c ->> 'released_by_label', c ->> 'released_by_role') from (select t.cam() c) x), 'false/Event Admin Tablet/temporary_organizer');
select t.as_user(t.u(2));
select t.expect_eq('releasing when already on says so and changes nothing', public.camera_off_release(t.ev(1)) ->> 'status', 'already_on');

-- ---------------------------------------------------------------- the record: audit + append-only log, no direct writes for anyone
select t.as_admin();
select t.expect_eq('audit: camera off by the Marshal Phone, released by the Event Admin Tablet',
  (select string_agg(action || ':' || (details -> 'device' ->> 'label'), ',' order by id) from public.audit_log where action in ('broadcast.camera_off', 'broadcast.camera_released') and actor in (t.sid('marshal'), t.sid('admin')) and details ? 'device' and details ->> 'reason' is distinct from 'x'),
  'broadcast.camera_off:Marshal Phone,broadcast.camera_released:Event Admin Tablet');
select t.expect_eq('the camera log has both entries with who and role', (select string_agg(action || ':' || by_label || ':' || by_role, ',' order by id) from public.event_camera_log where event_id = t.ev(1)), 'activated:Marshal Phone:marshal,released:Event Admin Tablet:temporary_organizer');
select t.expect_error('the camera log is append-only (update)', $$update public.event_camera_log set by_label = 'x'$$, '42501');
select t.expect_error('... (delete)', $$delete from public.event_camera_log$$, '42501');
select t.as_user(t.u(1));
select t.expect_error('not even the organizer can write the state table directly', format($$update public.event_camera_state set active = false where event_id = %L$$, t.ev(1)), '42501');
select t.as_device(t.sid('admin'));
select t.expect_error('... nor the Temporary Organizer', format($$update public.event_camera_state set active = false where event_id = %L$$, t.ev(1)), '42501');
select t.expect_error('... nor read the log', 'select * from public.event_camera_log', '42501');
select t.as_anon();
select t.expect_error('anonymous cannot read the state', 'select * from public.event_camera_state', '42501');

-- the reader: who may see the state
select t.as_device(t.sid('announcer'));
select t.expect_eq('the Announcer sees the state (they may protect the broadcast): can activate, cannot release', (select format('%s/%s', s ->> 'can_activate', s ->> 'can_release') from (select public.camera_state(t.ev(1)) s) x), 'true/false');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer sees: can release', (select public.camera_state(t.ev(1)) ->> 'can_release'), 'true');
select t.as_device(t.sid('counter1'));
select t.expect_error('a Counter cannot read the camera state', format($$select public.camera_state(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot', format($$select public.camera_state(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_error('an invalid reason is refused', format($$select public.camera_off_activate(%L, 'because')$$, t.ev(1)), '22023');
select t.as_admin();

-- ---------------------------------------------------------------- broadcast control: organizer, owner, Temporary Organizer only
select t.as_admin();
select t.cam_world() as w0 \gset
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot take a Lyst', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"lyst","target_field":"Field 1"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('the Secretary cannot (Camera Off is not OBS access)', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"holding"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_device(t.sid('announcer'));
select t.expect_error('the Announcer cannot control music or AUTO/MANUAL', format($$select public.set_broadcast_control(%L, 0, '{"music_mode":"muted"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_user(t.u(2));
select t.expect_error('the head marshal cannot (they release Camera Off, they do not run the broadcast)', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"holding"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"holding"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_ctrl(t.sid('controller'));
select t.expect_error('the controller cannot command itself', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"holding"}'::jsonb)$$, t.ev(1)), '42501');
select t.as_user(t.u(1));
select t.expect_eq('the organizer takes Lyst 2 (the field name is normalised)', (public.set_broadcast_control(t.ev(1), 0, '{"mode":"manual","target_kind":"lyst","target_field":" FIELD 2 "}'::jsonb) -> 'control' ->> 'target_field'), 'field 2');
select t.expect_eq('a stale tablet (old revision) changes nothing and is told so', (public.set_broadcast_control(t.ev(1), 0, '{"mode":"manual","target_kind":"holding"}'::jsonb) ->> 'status'), 'stale');
select t.as_admin();
select t.expect_eq('... the Take stands', private.broadcast_control_json(t.ev(1)) ->> 'target_field', 'field 2');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer returns to AUTO (clears the manual target)', (select format('%s/%s', c ->> 'mode', coalesce(c ->> 'target_kind', 'none')) from (select public.set_broadcast_control(t.ev(1), 1, '{"mode":"auto"}'::jsonb) -> 'control' c) x), 'auto/none');
select t.expect_eq('... music and ducking are controls too', (select format('%s/%s', c ->> 'music_mode', c ->> 'auto_duck') from (select public.set_broadcast_control(t.ev(1), 2, '{"music_mode":"muted","auto_duck":false}'::jsonb) -> 'control' c) x), 'muted/false');
select t.expect_eq('... and the priority order of fields', (select c -> 'priority_fields' from (select public.set_broadcast_control(t.ev(1), 3, '{"priority_fields":["Field 2"," field 1"]}'::jsonb) -> 'control' c) x), '["field 2", "field 1"]'::jsonb);
select t.expect_error('manual with no target is refused', format($$select public.set_broadcast_control(%L, 4, '{"mode":"manual"}'::jsonb)$$, t.ev(1)), '22023');
select t.expect_error('a Lyst target needs a field', format($$select public.set_broadcast_control(%L, 4, '{"mode":"manual","target_kind":"lyst"}'::jsonb)$$, t.ev(1)), '22023');
select t.expect_error('an unknown setting is refused (no scene names, URLs or commands travel through it)', format($$select public.set_broadcast_control(%L, 4, '{"scene":"Camera 1"}'::jsonb)$$, t.ev(1)), '22023');
select t.expect_error('... nor a URL', format($$select public.set_broadcast_control(%L, 4, '{"url":"http://x.test"}'::jsonb)$$, t.ev(1)), '22023');
select t.expect_error('an unknown music mode is refused', format($$select public.set_broadcast_control(%L, 4, '{"music_mode":"loud"}'::jsonb)$$, t.ev(1)), '22023');
select t.expect_error('too many priority fields are refused', format($$select public.set_broadcast_control(%L, 4, %L::jsonb)$$, t.ev(1), (select jsonb_build_object('priority_fields', jsonb_agg('f' || n))::text from generate_series(1, 13) n)), '22023');
select t.expect_error('another event''s Temporary Organizer cannot', format($$select public.set_broadcast_control(%L, 0, '{"mode":"auto"}'::jsonb)$$, t.ev(2)), '42501');
select t.as_admin();
select t.expect_eq('every change is audited with the device', (select count(*) from public.audit_log where action = 'broadcast.control' and details -> 'device' ->> 'label' = 'Event Admin Tablet')::int, 3);
select t.expect_eq('broadcast control left the tournament untouched (no score, timer, queue or result changed)', t.cam_world(), :'w0');

-- the Command Centre panel read: the control room's people, not everyone
select t.as_device(t.sid('secretary'));
select t.expect_eq('the Secretary reads the broadcast state (Command Centre): may NOT control it', (select (public.broadcast_control_state(t.ev(1)) ->> 'can_control')), 'false');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Temporary Organizer reads it: may control it', (select (public.broadcast_control_state(t.ev(1)) ->> 'can_control')), 'true');
select t.expect_eq('... and sees that a controller is set up', (select (public.broadcast_control_state(t.ev(1)) ->> 'controller_exists')), 'true');
select t.as_device(t.sid('marshal'));
select t.expect_error('a Marshal device cannot read it', format($$select public.broadcast_control_state(%L)$$, t.ev(1)), '42501');

-- ---------------------------------------------------------------- the controller: its own event, two functions
select t.as_ctrl(t.sid('controller'));
select t.expect_eq('controller_state: its own event only', (select c -> 'event' ->> 'slug' from (select public.controller_state() c) x), 'p181-e1');
select t.expect_eq('... with the desired state (a closed vocabulary)', (select array(select k from jsonb_object_keys(public.controller_state() -> 'control') k order by k)), array['auto_duck', 'mode', 'music_mode', 'priority_fields', 'rev', 'target_field', 'target_kind', 'updated_at', 'updated_by_label']);
select t.expect_eq('... and the camera state (activation reason included so music can stay muted)', (select array(select k from jsonb_object_keys(public.controller_state() -> 'camera') k order by k)), array['activated_at', 'activated_by_label', 'activated_by_role', 'active', 'reason', 'released_at', 'released_by_label', 'released_by_role', 'rev']);
select t.expect_eq('the controller reports its status (a small object)', (public.broadcast_controller_heartbeat('{"obs_connected":true,"mode":"auto","on_air":"field 1"}'::jsonb) ->> 'ok'), 'true');
select t.as_admin();
select t.expect_eq('... and the report is stored for ITS event only (the function has no event argument to choose another)', (select array[(select count(*) from public.broadcast_controller_status where event_id = t.ev(1)), (select count(*) from public.broadcast_controller_status where event_id = t.ev(2))]), array[1::bigint, 0::bigint]);
select t.as_ctrl(t.sid('controller'));
select t.expect_error('an oversized status report is refused', format($$select public.broadcast_controller_heartbeat(%L::jsonb)$$, (select jsonb_build_object('x', repeat('a', 5000))::text)), '22023');
select t.expect_error('a non-object report is refused', $$select public.broadcast_controller_heartbeat('[1]'::jsonb)$$, '22023');
select t.as_device(t.sid('admin'));
select t.expect_error('a device is not a controller (controller_state)', 'select public.controller_state()', '42501');
select t.expect_error('... nor can it report as one', $$select public.broadcast_controller_heartbeat('{"obs_connected":true}'::jsonb)$$, '42501');
select t.as_user(t.u(1));
select t.expect_error('a person is not a controller either', 'select public.controller_state()', '42501');
select t.as_user(t.u(1));
select t.as_admin();
select t.as_device(t.sid('admin'));
select t.expect_eq('the report is stored for the Command Centre, with its age', (public.broadcast_control_state(t.ev(1)) -> 'controller' -> 'status' ->> 'on_air'), 'field 1');
select t.as_admin();
select t.expect_eq('the first connection was audited', (select count(*) from public.audit_log where action = 'broadcast.controller_status' and details -> 'device' ->> 'label' = 'Stream Laptop')::int, 1);
-- Event B's controller would see Event B only
select t.as_user(t.u(11));
select public.create_event_credential(t.ev(2), 'controller', 'E2 Laptop', 'broadcast_controller', t.h(90));
select t.as_admin();
select t.open(90) as e2ctrl \gset
select t.as_ctrl(:'e2ctrl');
select t.expect_eq('an Event 2 controller reads Event 2 (never Event 1)', (select public.controller_state() -> 'event' ->> 'slug'), 'p181-e2');
-- revoking the controller cuts it off immediately
select t.as_user(t.u(1));
select public.revoke_event_credential(t.cred('controller'));
select t.as_ctrl(t.sid('controller'));
select t.expect_error('a revoked controller reads nothing', 'select public.controller_state()', '42501');
select t.expect_error('... and reports nothing', $$select public.broadcast_controller_heartbeat('{"obs_connected":true}'::jsonb)$$, '42501');
select t.as_admin();

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK181 BROADCAST GATE PASSED % checks', n; end $$;
rollback;
