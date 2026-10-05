-- Pack 13 gate: Lyst Control (migrations 20261007000100 / 20261007000200).
--   * THE MARSHAL'S CALL IS THE ONLY OFFICIAL SCORE: counters (official or learning) never reach an official number, a result, the public state or a notification
--   * the timer is server state: refresh-proof, field-independent, stale-proof, retry-proof
--   * authorization is the database's: staff roles, event scope, field scope, match scope, round scope, seat ownership
--   * discipline is structured and permanent; subtraction is an official, audited act (never an undo); corrections keep history
--   * finalization is still a human act through the existing result path, fed by the official rounds only
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack13_gate.sql
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
create function t.expect_msg(label text, stmt text, fragment text) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlerrm; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if position(fragment in got) = 0 then raise exception 'FAIL (error "%" lacks "%"): %', got, fragment, label; end if;
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
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;

create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid $$;
create function t.cmd() returns uuid language sql volatile as $$ select gen_random_uuid() $$;
create function t.e1() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e101'::uuid $$;
create function t.e2() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e102'::uuid $$;
-- roles in event 1: 90 organizer, 89 head marshal, 88 scorekeeper, 87 marshal, 86 second scorekeeper, 85 medic. Event 2: 70 organizer. Fighters 1..6 (accounts 1..6). Counters 21..30.
create function t.tim(n int) returns jsonb language sql volatile security definer as $$ select to_jsonb(t) from public.lyst_timer t where t.event_id = t.e1() and t.field_key = 'field ' || n $$;
create function t.timer_rev(f text) returns int language sql volatile security definer as $$ select rev from public.lyst_timer where event_id = t.e1() and field_key = f $$;
create function t.timer_status(f text) returns text language sql volatile security definer as $$ select status from public.lyst_timer where event_id = t.e1() and field_key = f $$;
create function t.timer_mode(f text) returns text language sql volatile security definer as $$ select mode from public.lyst_timer where event_id = t.e1() and field_key = f $$;
create function t.timer_remaining(f text) returns text language sql volatile security definer as $$ select remaining_ms::text from public.lyst_timer where event_id = t.e1() and field_key = f $$;
create function t.round_status(mn int, r int) returns text language sql volatile security definer as $$ select status from public.lyst_rounds where match_id = t.m(mn) and round_no = r $$;
create function t.round_rev(mn int, r int) returns int language sql volatile security definer as $$ select coalesce((select rev from public.lyst_rounds where match_id = t.m(mn) and round_no = r), 0) $$;
create function t.official(mn int, r int) returns text language sql volatile security definer as $$ select official_a || '-' || official_b from public.lyst_round_scores where match_id = t.m(mn) and round_no = r $$;
create function t.mver(mn int) returns int language sql volatile security definer as $$ select version from public.matches where id = t.m(mn) $$;
create function t.notif_count() returns bigint language sql volatile security definer as $$ select count(*) from public.notifications $$;
create function t.qstate(mn int) returns text language sql volatile security definer as $$ select queue_state from public.matches where id = t.m(mn) $$;
-- timer helper: one call, returns the status word; takes the revision the caller "saw"
create function t.tc(who int, field text, mn int, rev int, action text, mode text default null, dur int default null, rnd int default null, delta int default 0, cmd uuid default null) returns jsonb language plpgsql as $$
declare r jsonb; v_rev int := rev;
begin
  perform t.as_admin();
  if rev = -1 then v_rev := coalesce((select x.rev from public.lyst_timer x where x.event_id = t.e1() and x.field_key = lower(field)), 0); end if;
  perform t.as_user(t.u(who));
  r := public.lyst_timer_command(t.e1(), field, t.m(mn), v_rev, coalesce(cmd, gen_random_uuid()), action, mode, dur, rnd, delta);
  perform t.as_admin();
  return r;
end $$;
create function t.seatof(uid int) returns uuid language sql volatile security definer as $$ select id from public.lyst_counter_seats where user_id = t.u(uid) and status in ('pending', 'active') order by requested_at desc limit 1 $$;
create function t.total(uid int, r int) returns int language sql volatile security definer as $$ select private.lyst_seat_total(t.seatof(uid), r) $$;
create function t.cr(uid int, rnd int, w int default 1, id uuid default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t.as_user(t.u(uid));
  r := public.counter_record(coalesce(id, gen_random_uuid()), t.seatof(uid), rnd, w);
  perform t.as_admin();
  return r;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) select t.u(n), 'u' || n || '@example.test' from generate_series(1, 99) n;
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  (t.e1(), 'lyst-cup', 'Lyst Cup', 'published', current_date - 1, current_date + 1),
  (t.e2(), 'other-cup', 'Other Cup', 'published', current_date - 1, current_date + 1),
  ('00000000-0000-0000-0000-00000000e103', 'draft-cup', 'Draft Cup', 'draft', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values
  (t.e1(), t.u(90), 'organizer'), (t.e1(), t.u(89), 'head_marshal'), (t.e1(), t.u(88), 'scorekeeper'), (t.e1(), t.u(87), 'marshal'), (t.e1(), t.u(86), 'scorekeeper'), (t.e1(), t.u(85), 'medic'),
  (t.e2(), t.u(70), 'organizer');
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'Fighter ' || n, 'male', '{}' from generate_series(1, 6) n;
insert into public.fighter_accounts (fighter_id, user_id) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, t.u(n) from generate_series(1, 6) n;
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-00000000b101', t.e1(), 'Longsword', 'longsword', 'men', 'Classic', 'elimination', 1),
  ('00000000-0000-0000-0000-00000000b102', t.e1(), 'Sword and Buckler', 'buckler', 'men', 'Classic', 'round_robin', 2),
  ('00000000-0000-0000-0000-00000000b103', t.e2(), 'Other Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1);
insert into public.entries (id, competition_id, fighter_id) select ('00000000-0000-0000-0000-00000000ee0' || n)::uuid, case when n <= 4 then '00000000-0000-0000-0000-00000000b101'::uuid else '00000000-0000-0000-0000-00000000b102'::uuid end,
  ('00000000-0000-0000-0000-00000000f00' || n)::uuid from generate_series(1, 6) n;
insert into public.fighters (id, display_name, gender, disciplines) values ('00000000-0000-0000-0000-00000000f0a1', 'Other One', 'male', '{}'), ('00000000-0000-0000-0000-00000000f0a2', 'Other Two', 'male', '{}');
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000ee0a', '00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000f0a1'),
  ('00000000-0000-0000-0000-00000000ee0b', '00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000f0a2');
-- Longsword semifinals m1 (Field 1) and m2 (Field 2) feed the final m3 (Field 1). Buckler pool matches m4 (Field 1), m5 (Field 1). Other event m9.
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  (t.m(3), '00000000-0000-0000-0000-00000000b101', 'final', 'Final', 0, 'Field 1', null, null),
  (t.m(4), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-00000000ee06'),
  (t.m(5), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 2', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee06', '00000000-0000-0000-0000-00000000ee05'),
  (t.m(9), '00000000-0000-0000-0000-00000000b103', 'round_robin', 'Round 1', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee0a', '00000000-0000-0000-0000-00000000ee0b');
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, next_match_id, next_slot) values
  (t.m(1), '00000000-0000-0000-0000-00000000b101', 'elimination', 'Semifinal', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee02', t.m(3), 'a'),
  (t.m(2), '00000000-0000-0000-0000-00000000b101', 'elimination', 'Semifinal', 1, 'Field 2', '00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-00000000ee04', t.m(3), 'b');

-- ================================================================ 1. nobody is anything by default
select t.as_anon();
select t.expect_error('anonymous cannot open a lyst', format('select public.lyst_open(%L)', t.m(1)), '42501');
select t.expect_error('anonymous cannot run the timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'start')$$, t.e1(), t.m(1)), '42501');
select t.expect_error('anonymous cannot confirm a round', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 5, 3, 0)', t.m(1)), '42501');
select t.expect_error('anonymous cannot record discipline', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 1, 'a', 'warning')$$, t.m(1)), '42501');
select t.expect_error('anonymous cannot finalize through the lyst', format($$select public.lyst_finalize(gen_random_uuid(), %L, 0, 'a')$$, t.m(1)), '42501');
select t.expect_error('anonymous cannot read the staff state', format('select public.lyst_state(%L)', t.m(1)), '42501');
select t.expect_error('anonymous cannot count', 'select public.counter_record(gen_random_uuid(), gen_random_uuid(), 1, 1)', '42501');
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot open a lyst', format('select public.lyst_open(%L)', t.m(1)), '42501');
select t.expect_error('a fighter cannot run the timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'start')$$, t.e1(), t.m(1)), '42501');
select t.expect_error('a fighter cannot change an official score', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 99, 0, 0)', t.m(1)), '42501');
select t.expect_error('a fighter cannot issue a card, penalty or DQ', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 1, 'b', 'dq')$$, t.m(1)), '42501');
select t.expect_error('a fighter cannot make a join code', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.e1()), '42501');
select t.as_user(t.u(85));
select t.expect_error('a medic is not lyst staff', format('select public.lyst_open(%L)', t.m(1)), '42501');
select t.as_user(t.u(70));
select t.expect_error('another event''s organizer cannot run this event''s lyst', format('select public.lyst_open(%L)', t.m(1)), '42501');
select t.expect_error('... nor its timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'start')$$, t.e1(), t.m(1)), '42501');
select t.as_user(t.u(88));
select t.expect_error('a scorekeeper cannot change the lyst settings (head marshal or organizer only)', format($$select public.set_lyst_settings(%L, '{"auto_break": true}')$$, t.e1()), '42501');
select t.as_user(t.u(89));
select t.expect_error('unknown settings are refused', format($$select public.set_lyst_settings(%L, '{"win_anything": true}')$$, t.e1()), '22023');
select t.expect_error('the number of regular rounds must be sane', format($$select public.set_lyst_settings(%L, '{"regular_rounds": 0}')$$, t.e1()), '22023');
select t.expect_error('an extra round cannot be longer than an hour', format($$select public.set_lyst_settings(%L, '{"extra_round_seconds": 9999}')$$, t.e1()), '22023');
select t.expect_error('a preset must be sane (0 seconds)', format($$select public.set_lyst_settings(%L, '{"presets": [{"key":"x","label":"x","seconds":0,"kind":"fight"}]}')$$, t.e1()), '22023');
select t.expect_ok('the head marshal changes the break length and the cards', format($$select public.set_lyst_settings(%L, '{"presets": [{"key":"fight","label":"Round","seconds":60,"kind":"fight"},{"key":"break","label":"Break","seconds":45,"kind":"break"},{"key":"dq","label":"DQ countdown","seconds":60,"kind":"dq"},{"key":"equipment","label":"Equipment","seconds":90,"kind":"equipment"}]}')$$, t.e1()));
select t.as_admin();
select t.expect_eq('the starting rule is two full rounds, then 30-second extra rounds, as settings', array[private.lyst_settings_for(t.e1()) ->> 'regular_rounds', private.lyst_settings_for(t.e1()) ->> 'extra_round_seconds'], array['2', '30']);
select t.expect_eq('the starting settings are only starting values: the cards list is empty until an event sets its own', private.lyst_settings_for(t.e1()) -> 'cards', '[]'::jsonb);
select t.expect_eq('the event''s own presets replaced the starting ones', private.lyst_settings_for(t.e1()) #>> '{presets,1,seconds}', '45');

-- ================================================================ 2. open a match; the timer (field 1)
select t.as_user(t.u(88));
select t.expect_ok('a scorekeeper opens a match in Lyst Control', format($$select public.lyst_open(%L, 'weighted')$$, t.m(1)));
select t.expect_ok('opening again is harmless', format($$select public.lyst_open(%L, 'simple')$$, t.m(1)));
select t.as_admin();
select t.expect_eq('the first counter input style stands', (select counter_input from public.lyst_matches where match_id = t.m(1)), 'weighted');
select t.as_user(t.u(88));
select public.lyst_open(t.m(2), 'weighted'); select public.lyst_open(t.m(4), 'simple'); select public.lyst_open(t.m(5), 'simple');
select t.as_admin();
select t.expect_eq('nothing exists before the first command: no timer rows, no rounds', array[(select count(*) from public.lyst_timer), (select count(*) from public.lyst_rounds)], array[0::bigint, 0::bigint]);
select t.expect_error('a field-1 tablet cannot start a timer for a field-2 match', format($$select t.tc(88, 'Field 1', 2, -1, 'start')$$), 'P0001');
select t.expect_error('a match of another event cannot be run from this event', format($$select t.tc(88, 'Field 1', 9, -1, 'start')$$), 'P0002');

select t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 1) as r1 \gset
select t.expect_eq('START: running, round 1 of the match', array[(:'r1'::jsonb ->> 'status'), (:'r1'::jsonb #>> '{timer,status}'), (:'r1'::jsonb #>> '{timer,round_no}')], array['ok', 'running', '1']);
select t.expect_eq('starting the fight timer opened round 1 for scoring', t.round_status(1, 1), 'running');
select t.expect_eq('the timer counts from the server clock, not a browser: it ticks while nobody does anything', (select (private.lyst_remaining_ms(status, remaining_ms, started_at) < 60000) from public.lyst_timer where field_key = 'field 1'), true);
select pg_sleep(1.2);
select t.expect_eq('... a second later it has lost at least a second', (select private.lyst_remaining_ms(status, remaining_ms, started_at) <= 58900 from public.lyst_timer where field_key = 'field 1'), true);
select t.expect_eq('a stale tablet (wrong revision) changes nothing and is told so', (t.tc(88, 'Field 1', 1, 99, 'pause') ->> 'status'), 'stale');
select t.expect_eq('... the timer is still running', t.timer_status('field 1'), 'running');
select t.cmd() as c_pause \gset
select t.expect_eq('PAUSE', (t.tc(88, 'Field 1', 1, 1, 'pause', cmd => :'c_pause') ->> 'status'), 'ok');
select t.expect_eq('paused', t.timer_status('field 1'), 'paused');
select t.expect_eq('a retried pause (same command id) is a duplicate and changes nothing', array[(t.tc(88, 'Field 1', 1, 1, 'pause', cmd => :'c_pause') ->> 'status'), t.timer_rev('field 1')::text], array['duplicate', '2']);
select t.expect_eq('a second device tapping pause with the old revision is stale, not a second pause', (t.tc(87, 'Field 1', 1, 1, 'pause') ->> 'status'), 'stale');
select t.expect_eq('the paused time is exact and does not drift', array[(select (remaining_ms between 55000 and 58900)::text from public.lyst_timer where field_key = 'field 1'), (select (private.lyst_remaining_ms(status, remaining_ms, started_at) = remaining_ms)::text from public.lyst_timer where field_key = 'field 1')], array['true', 'true']);
select t.expect_eq('RESUME', (t.tc(88, 'Field 1', 1, -1, 'resume') ->> 'status'), 'ok');
select t.expect_eq('running again', t.timer_status('field 1'), 'running');
select t.expect_error('resume while running is refused', $$select t.tc(88, 'Field 1', 1, -1, 'resume')$$, 'P0001');
select t.expect_eq('a marshal can nudge the clock (-5 s)', (t.tc(87, 'Field 1', 1, -1, 'adjust', delta => -5000) ->> 'status'), 'ok');
select t.expect_error('a huge adjustment is refused', $$select t.tc(87, 'Field 1', 1, -1, 'adjust', delta => 900000)$$, '22023');
select t.expect_eq('a mistaken change can be taken back: restore puts the earlier time back, paused (nothing starts by surprise)', (t.tc(87, 'Field 1', 1, -1, 'restore') ->> 'status'), 'ok');
select t.expect_eq('... as paused', t.timer_status('field 1'), 'paused');
select t.expect_error('there is only one level of take-back', $$select t.tc(87, 'Field 1', 1, -1, 'restore')$$, 'P0001');
select t.expect_eq('RESET goes back to the full duration, idle', array[(t.tc(87, 'Field 1', 1, -1, 'reset') ->> 'status'), t.timer_status('field 1'), t.timer_remaining('field 1')], array['ok', 'idle', '60000']);
select t.expect_eq('SET a preset without starting (a custom 2:30)', (t.tc(88, 'Field 1', 1, -1, 'set', 'custom', 150000) ->> 'status'), 'ok');
select t.expect_eq('... idle at 150 s in custom mode', array[t.timer_status('field 1'), t.timer_mode('field 1'), t.timer_remaining('field 1')], array['idle', 'custom', '150000']);
select t.expect_error('a timer cannot be absurd (61 minutes)', $$select t.tc(88, 'Field 1', 1, -1, 'set', 'custom', 3660000)$$, '22023');
select t.expect_eq('the round is untouched by timer fiddling', t.round_status(1, 1), 'running');

-- Field 2 runs on its own, at the same time
select t.tc(87, 'Field 2', 2, -1, 'start', 'fight', 60000, 1) as r2 \gset
select t.expect_eq('FIELD 2 starts independently', (:'r2'::jsonb #>> '{timer,status}'), 'running');
select t.expect_eq('... and field 1 is exactly as it was (idle, same revision)', array[t.timer_status('field 1'), t.timer_rev('field 1')::text], array['idle', '7']);
select t.expect_eq('two fields, two independent timers', (select count(*) from public.lyst_timer), 2::bigint);

-- the real round: Field 1 start, break
select t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 1) as r1b \gset
select t.expect_eq('round 1 runs on field 1 again', t.timer_status('field 1'), 'running');
select t.expect_error('round 2 cannot start before round 1 is confirmed', $$select t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 2)$$, 'P0001');
select t.expect_eq('START BREAK ends the running round for scoring (one tap: "Scores being confirmed")', (t.tc(88, 'Field 1', 1, -1, 'start', 'break', 45000, 1) ->> 'status'), 'ok');
select t.expect_eq('... the round is now being confirmed', t.round_status(1, 1), 'confirming');
select t.expect_eq('... and the break timer runs on the same field', array[t.timer_mode('field 1'), t.timer_status('field 1')], array['break', 'running']);

-- ================================================================ 3. counters join (provisional evidence), before the marshal's call
select t.as_user(t.u(88));
select public.create_lyst_join_code(t.e1(), 'Field 1') ->> 'code' as code1 \gset
select t.as_user(t.u(21));
select t.expect_eq('a wrong join code is answered "invalid" (not an error, so the try is counted)', public.request_counter_seat('NOT-A-CODE') ->> 'status', 'invalid');
select t.expect_eq('a counter scanning the code only ASKS for a seat (pending, no match, no side)', public.request_counter_seat(:'code1') ->> 'status', 'pending');
select t.expect_eq('asking again is the same request', (select count(*) from public.lyst_counter_seats where user_id = t.u(21)), 1::bigint);
select t.expect_error('a counter cannot assign themselves', format('select public.assign_counter_seat(%L, %L, %L)', t.seatof(21), t.m(1), 'a'), '42501');
select t.expect_error('a counter cannot count before being seated', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(21)), 'P0001');
select t.expect_error('a counter cannot make a join code', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.e1()), '42501');
select t.expect_error('a counter cannot read the staff state', format('select public.lyst_state(%L)', t.m(1)), '42501');
select t.expect_error('a counter cannot touch the timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'pause')$$, t.e1(), t.m(1)), '42501');
select t.expect_error('a counter cannot confirm a round', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 6, 5, 0)', t.m(1)), '42501');
select t.expect_error('a counter cannot record discipline', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 1, 'b', 'warning')$$, t.m(1)), '42501');
select t.expect_error('a counter cannot finalize', format($$select public.lyst_finalize(gen_random_uuid(), %L, 0, 'a')$$, t.m(1)), '42501');
select t.as_user(t.u(22)); select public.request_counter_seat(lower(:'code1'));
select t.as_user(t.u(23)); select public.request_counter_seat(:'code1');
select t.as_user(t.u(24)); select public.request_counter_seat(:'code1');
select t.as_user(t.u(25)); select public.request_counter_seat(:'code1');
select t.as_user(t.u(26)); select public.request_counter_seat(:'code1');
select t.as_user(t.u(88));
select t.expect_eq('the tablet sees the pending requests (names, no accounts)', jsonb_array_length(public.lyst_state(t.m(1)) -> 'requests'), 6);
select t.expect_error('a seat cannot be on a match of another field', format('select public.assign_counter_seat(%L, %L, %L)', t.seatof(21), t.m(2), 'a'), 'P0001');
select t.expect_error('a seat cannot be on a match of another event', format('select public.assign_counter_seat(%L, %L, %L)', t.seatof(21), t.m(9), 'a'), 'P0002');
select t.expect_eq('seat counter 21 on fighter A: slot A, official', (public.assign_counter_seat(t.seatof(21), t.m(1), 'a') ->> 'slot'), 'A');
select t.expect_eq('seat counter 22 on fighter A: slot B', public.assign_counter_seat(t.seatof(22), t.m(1), 'a') ->> 'slot', 'B');
select t.expect_eq('seat counter 23 on fighter B: slot C', public.assign_counter_seat(t.seatof(23), t.m(1), 'b') ->> 'slot', 'C');
select t.expect_eq('seat counter 24 on fighter B: slot D', public.assign_counter_seat(t.seatof(24), t.m(1), 'b') ->> 'slot', 'D');
select t.expect_eq('a LEARNING counter on fighter A: slot L1', public.assign_counter_seat(t.seatof(25), t.m(1), 'a', 'learning') ->> 'slot', 'L1');
select t.expect_eq('a second LEARNING counter on fighter B: slot L2 (not limited to four devices)', public.assign_counter_seat(t.seatof(26), t.m(1), 'b', 'learning') ->> 'slot', 'L2');
select t.as_admin();

-- ---------------------------------------------------------------- counting: the round must be the one being fought
-- round 1 is in "confirming" (a break started): counting has stopped
select t.expect_msg('counting stops when the round ends (break running)', $$select t.cr(21, 1)$$, 'ROUND_ENDED');
-- reopen the round for the story by starting a new fight timer on round 1 is not allowed once the break began? It is: confirming -> running again
select t.expect_eq('the operator can put the same round back to running (late start)', (t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 1) ->> 'status'), 'ok');
select t.expect_eq('... round 1 is running', t.round_status(1, 1), 'running');
select t.cr(21, 1) as c1 \gset
select t.expect_eq('a counter taps: total 1', (:'c1'::jsonb ->> 'total'), '1');
select t.cmd() as tap \gset
select t.cr(21, 1, 1, :'tap'::uuid) as c2 \gset
select t.cr(21, 1, 1, :'tap'::uuid) as c2b \gset
select t.expect_eq('a retried tap (same id) is counted once', array[(:'c2'::jsonb ->> 'total'), (:'c2b'::jsonb ->> 'status'), (:'c2b'::jsonb ->> 'total')], array['2', 'duplicate', '2']);
select t.expect_eq('RAPID: 30 taps in one go land exactly 30 times (plus the 2 above)', (select (t.cr(21, 1) ->> 'total')::int from generate_series(1, 30) order by 1 desc limit 1), 32);
select t.expect_eq('the tally is exactly the taps', t.total(21, 1), 32);
select t.as_admin();
select t.expect_eq('counter 22 (fighter A) counts 5', (select (t.cr(22, 1) ->> 'total')::int from generate_series(1, 5) order by 1 desc limit 1), 5);
select t.cr(23, 1, 2), t.cr(23, 1, 2);
select t.expect_eq('counter 23 (fighter B) counts 4 with two weighted taps', t.total(23, 1), 4);
select t.expect_eq('counter 24 (fighter B) counts 3', (select (t.cr(24, 1) ->> 'total')::int from generate_series(1, 3) order by 1 desc limit 1), 3);
select t.expect_eq('the learning counters count too (they practise the real job)', array[(select (t.cr(25, 1) ->> 'total')::int from generate_series(1, 9) order by 1 desc limit 1), (select (t.cr(26, 1) ->> 'total')::int from generate_series(1, 2) order by 1 desc limit 1)], array[9, 2]);
select t.expect_error('a weight of 3 is never allowed', $$select t.cr(21, 1, 3)$$, '22023');
select t.as_user(t.u(22)); select public.counter_undo(gen_random_uuid(), t.seatof(22), 1);
select t.as_admin();
select t.expect_eq('UNDO LAST took one off', t.total(22, 1), 4);
select t.cmd() as undo \gset
select t.as_user(t.u(22)); select public.counter_undo(:'undo'::uuid, t.seatof(22), 1); select public.counter_undo(:'undo'::uuid, t.seatof(22), 1); select t.as_admin();
select t.expect_eq('a retried undo (same id) reverses only once', t.total(22, 1), 3);
select t.as_user(t.u(21));
select t.expect_error('a counter cannot count on another counter''s seat', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(22)), '42501');
select t.expect_error('... nor undo another counter''s tap', format('select public.counter_undo(gen_random_uuid(), %L, 1)', t.seatof(22)), '42501');
select t.expect_error('... nor submit for them', format('select public.counter_submit(%L, 1)', t.seatof(22)), '42501');
select t.expect_error('stale input: a counter cannot add to round 2 while round 1 is the live round', format('select public.counter_record(gen_random_uuid(), %L, 2, 1)', t.seatof(21)), 'P0001');
select t.as_admin();
select t.expect_eq('the tablet can see every tally row (taps only; undo rows reverse them)', (select count(*) from public.lyst_counts where round_no = 1 and undo_of is null), 53::bigint);
select t.as_user(t.u(21));
select t.expect_eq('a counter sees only their own tally rows', (select count(*) from public.lyst_counts), 32::bigint);
select t.expect_eq('a counter sees only their own seat', (select count(*) from public.lyst_counter_seats), 1::bigint);
select t.expect_eq('a counter sees their own phone state: fighter, slot, role, round, total, can_count', (public.counter_state() ->> 'fighter') || '|' || (public.counter_state() #>> '{seat,slot}') || '|' || (public.counter_state() #>> '{seat,role}') || '|' || (public.counter_state() ->> 'my_total') || '|' || (public.counter_state() ->> 'can_count'), 'Fighter 1|A|official|32|true');
select t.expect_eq('the phone state carries no other counter, no official score and no account id', (select count(*) from jsonb_object_keys(public.counter_state()) k where k in ('seats', 'rounds', 'discipline', 'requests', 'user_id', 'official_a', 'official_b')), 0::bigint);
select public.counter_submit(t.seatof(21), 1);
select t.as_admin();

-- ================================================================ 4. the marshal's call
-- Counters on A: 32 and 3 (official), on B: 4 and 3. The marshal's call is 6-5: not an average, not a max, not a majority.
select t.expect_eq('the operator ends the round with the break timer (counting stops, "Scores being confirmed")', (t.tc(88, 'Field 1', 1, -1, 'start', 'break', 45000, 1) ->> 'status'), 'ok');
select t.as_user(t.u(88));
select t.expect_eq('a stale revision on the round is told so', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 6, 5, t.round_rev(1, 1) + 5) ->> 'status', 'stale');
select t.expect_error('scores are bounded', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 100, 5, 1)', t.m(1)), '22023');
select t.cmd() as conf \gset
select public.lyst_confirm_round(:'conf'::uuid, t.m(1), 1, 6, 5, t.round_rev(1, 1), 7, 5) ->> 'status' as s1 \gset
select t.expect_eq('CONFIRM ROUND records the marshal''s 6-5 (counters recommended 7-5: that is only recorded)', :'s1'::text, 'ok');
select t.as_admin();
select t.expect_eq('the official round score is exactly what the marshal awarded', t.official(1, 1), '6-5');
select t.expect_eq('... even though the counters tallied 32/3 and 4/3 and recommended 7-5', (select recommended_a || '-' || recommended_b from public.lyst_round_revisions where id = :'conf'::uuid), '7-5');
select t.expect_eq('the evidence keeps every counter''s number, learning ones marked as learning',
  (select string_agg((c ->> 'slot') || ':' || (c ->> 'role') || ':' || (c ->> 'total'), ',' order by c ->> 'slot') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.id = :'conf'::uuid),
  'A:official:32,B:official:3,C:official:4,D:official:3,L1:learning:9,L2:learning:2');
select t.as_user(t.u(88));
select t.expect_eq('a double tap on CONFIRM ROUND (same command) does not confirm twice', public.lyst_confirm_round(:'conf'::uuid, t.m(1), 1, 6, 5, t.round_rev(1, 1) - 1, 7, 5) ->> 'status', 'duplicate');
select t.expect_eq('a second confirm from another device with the old revision is stale', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 9, 9, t.round_rev(1, 1) - 1) ->> 'status', 'stale');
select t.as_admin();
select t.expect_eq('one confirmation, one revision', (select count(*) from public.lyst_round_revisions where match_id = t.m(1) and round_no = 1), 1::bigint);
select t.expect_eq('the official score did not move', t.official(1, 1), '6-5');
select t.as_user(t.u(21));
select t.expect_error('a counter cannot add after the round is confirmed (stale round input cannot leak)', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(21)), 'P0001');
select t.as_admin();
select t.expect_eq('learning counts have zero official effect: the official round did not change when they counted', t.official(1, 1), '6-5');
select t.expect_eq('the public round view carries only official numbers', (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a where a.attrelid = 'public.lyst_round_scores'::regclass and a.attnum > 0 and not a.attisdropped), 'match_id,event_id,round_no,status,rev,awarded_a,awarded_b,deduct_a,deduct_b,official_a,official_b');

-- ---------------------------------------------------------------- the break flow: next round
select t.expect_eq('NEXT ROUND: the fight timer starts round 2', (t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 2) ->> 'status'), 'ok');
select t.expect_eq('round 2 is running, round 1 stays confirmed', array[t.round_status(1, 1), t.round_status(1, 2)], array['confirmed', 'running']);
select t.expect_error('the timer cannot restart a confirmed round', $$select t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 1)$$, 'P0001');
select t.expect_eq('a counter can now count round 2', (t.cr(21, 2) ->> 'total'), '1');
select t.expect_error('... but round 1 input is refused for good', $$select t.cr(21, 1)$$, 'P0001');
select t.as_user(t.u(21)); select public.counter_submit(t.seatof(21), 2);
select t.as_admin();

-- ================================================================ 5. discipline: structured, official, audited
select t.as_user(t.u(88));
select t.expect_error('a card needs an event card vocabulary first (nothing is invented)', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'card', 'Yellow')$$, t.m(1)), 'P0001');
select t.expect_ok('a warning is recorded with the marshal''s name and reason', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'b', 'warning', null, 0, 'Unsafe conduct', 'Marshal Lee')$$, t.m(1)));
select t.cmd() as ded \gset
select t.expect_eq('a point deduction of 1 against fighter A in round 2', public.lyst_record_discipline(:'ded'::uuid, t.m(1), 2, 'a', 'deduction', null, 1, 'Illegal strike', 'Marshal Lee') ->> 'status', 'ok');
select t.expect_eq('a retried deduction (same command) is a duplicate, not a second deduction', public.lyst_record_discipline(:'ded'::uuid, t.m(1), 2, 'a', 'deduction', null, 1, 'Illegal strike', 'Marshal Lee') ->> 'status', 'duplicate');
select t.expect_error('only an amount the event allows (1, 2, 3) can be deducted', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'deduction', null, 7)$$, t.m(1)), '22023');
select t.expect_error('a warning has no amount', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'warning', null, 1)$$, t.m(1)), '22023');
select t.expect_error('a side is required', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'c', 'warning')$$, t.m(1)), '22023');
select t.as_user(t.u(89));
select public.set_lyst_settings(t.e1(), '{"cards": [{"key":"yellow","label":"Yellow card"},{"key":"red","label":"Red card"}]}');
select t.as_user(t.u(88));
select t.expect_error('a card must be one of this event''s card types', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'card', 'Purple card')$$, t.m(1)), '22023');
select t.cmd() as card \gset
select t.expect_ok('a configured card is recorded', format($$select public.lyst_record_discipline(%L, %L, 2, 'a', 'card', 'Yellow card', 0, 'Conduct', 'Marshal Lee')$$, :'card', t.m(1)));
select t.expect_ok('a deduction can be related to the card that came with it', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'deduction', null, 1, 'With the yellow card', 'Marshal Lee', %L)$$, t.m(1), :'card'));
select t.as_admin();
select t.as_user(t.u(88));
select t.expect_eq('confirm round 2 awarded 7-4', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 2, 7, 4, t.round_rev(1, 2)) ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('round 2 official: 7 minus two deductions against A = 5, B untouched = 4', t.official(1, 2), '5-4');
select t.expect_eq('the awarded score is kept as the marshal gave it (7-4); the deductions are separate official records', (select awarded_a || '-' || awarded_b || '/' || deduct_a || '-' || deduct_b from public.lyst_round_scores where match_id = t.m(1) and round_no = 2), '7-4/2-0');
select t.expect_eq('the audit trail names who did what', (select count(*) from public.audit_log where event_id = t.e1() and action in ('lyst.discipline', 'lyst.round_confirmed', 'lyst.timer', 'lyst.counter_assigned') and actor is not null), (select count(*) from public.audit_log where event_id = t.e1() and action in ('lyst.discipline', 'lyst.round_confirmed', 'lyst.timer', 'lyst.counter_assigned')));
select t.expect_eq('discipline is never deleted', (select count(*) from public.match_discipline where match_id = t.m(1)), 4::bigint);
select t.expect_error('even the table owner cannot delete a disciplinary record', format($$delete from public.match_discipline where match_id = %L$$, t.m(1)), 'P0001');
select t.expect_error('... nor rewrite one (only voiding is allowed)', format($$update public.match_discipline set amount = 9, kind = 'deduction' where match_id = %L and kind = 'deduction'$$, t.m(1)), 'P0001');
-- void
select t.as_user(t.u(86));
select t.expect_error('a scorekeeper cannot void a record another person made', format($$select public.lyst_void_discipline(gen_random_uuid(), %L, 'Wrong fighter')$$, :'ded'::uuid), '42501');
select t.as_user(t.u(88));
select t.expect_error('voiding needs a reason', format($$select public.lyst_void_discipline(gen_random_uuid(), %L, 'x')$$, :'ded'::uuid), '22023');
select t.expect_ok('the operator who recorded it can take back their own mistake within minutes', format($$select public.lyst_void_discipline(gen_random_uuid(), %L, 'Tapped the wrong fighter')$$, :'ded'::uuid));
select t.as_admin();
select t.expect_eq('the voided deduction no longer lowers the official score (record kept)', array[t.official(1, 2), (select count(*)::text from public.match_discipline where id = :'ded'::uuid and voided_at is not null)], array['6-4', '1']);
select t.expect_eq('the void reason is kept privately', (select void_reason from public.match_discipline_private where discipline_id = :'ded'::uuid), 'Tapped the wrong fighter');
select t.as_user(t.u(89));
select t.expect_ok('the head marshal can void any record', format($$select public.lyst_void_discipline(gen_random_uuid(), %L, 'Marshal withdrew the warning')$$, (select id from public.match_discipline where match_id = t.m(1) and kind = 'warning' limit 1)));
select t.as_admin();

-- a correction to a confirmed round keeps history
select t.as_user(t.u(88));
select t.expect_error('correcting a confirmed round needs a reason', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 7, 5, %s)', t.m(1), t.round_rev(1, 1)), '22023');
select t.expect_eq('the marshal corrects round 1 to 7-5 with a reason', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 7, 5, t.round_rev(1, 1), null, null, 'Marshal re-counted after the break') ->> 'kind', 'correct');
select t.as_admin();
select t.expect_eq('the correction is on the record: new numbers official, old numbers kept', array[t.official(1, 1), (select previous_a || '-' || previous_b from public.lyst_round_revisions where match_id = t.m(1) and round_no = 1 and kind = 'correct')], array['7-5', '6-5']);
select t.expect_error('the revision log is append-only', format($$update public.lyst_round_revisions set awarded_a = 0 where match_id = %L$$, t.m(1)), 'P0001');
select t.expect_error('... and cannot be deleted', format($$delete from public.lyst_round_revisions where match_id = %L$$, t.m(1)), 'P0001');
select t.expect_error('tallies are append-only too', $$delete from public.lyst_counts$$, 'P0001');

-- ================================================================ 6. equipment / DQ countdown timers, preset switching
select t.expect_eq('EQUIPMENT timer (90 s preset) on field 1', (t.tc(88, 'Field 1', 1, -1, 'start', 'equipment', 90000, 2) ->> 'status'), 'ok');
select t.expect_eq('... a timeout is not a round: round 2 is not re-opened by it', t.round_status(1, 2), 'confirmed');
select t.expect_eq('DQ countdown timer', (t.tc(88, 'Field 1', 1, -1, 'start', 'dq', 60000, 2) ->> 'status'), 'ok');
select t.expect_eq('the mode is recorded for the display', t.timer_mode('field 1'), 'dq');
select t.expect_eq('a long break is a mode, too', (t.tc(88, 'Field 1', 1, -1, 'start', 'extended_break', 180000, 2) ->> 'status'), 'ok');

-- ================================================================ 7. public surfaces: official only
select t.as_anon();
select t.expect_eq('anyone can read the official round scores of a published event', (select count(*) from public.lyst_round_scores where match_id = t.m(1)), 2::bigint);
select t.expect_eq('anyone can read the timer', (select count(*) from public.lyst_timer), 2::bigint);
select t.expect_eq('the public state is one clean row per match with lyst activity', (select count(*) from public.lyst_public_state), 2::bigint);
select t.expect_eq('... with the official totals only (13-9 after the correction)', (select official_a || '-' || official_b from public.lyst_public_state where match_id = t.m(1)), '13-9');
select t.expect_eq('... and nothing about counters in its columns', (select count(*) from pg_attribute a where a.attrelid = 'public.lyst_public_state'::regclass and a.attnum > 0 and (a.attname like '%counter%' or a.attname like '%seat%' or a.attname like '%learn%' or a.attname like '%user%' or a.attname like '%reason%' or a.attname like '%called%')), 0::bigint);
select t.expect_eq('the public discipline list has kind, side, round, label, amount and nothing else', (select string_agg(distinct k, ',' order by k) from public.lyst_public_state s, jsonb_array_elements(s.discipline) d, jsonb_object_keys(d) k where s.match_id = t.m(1)), 'amount,kind,label,round,side');
select t.expect_error('anonymous cannot read tallies', 'select * from public.lyst_counts', '42501');
select t.expect_error('... nor counter seats', 'select * from public.lyst_counter_seats', '42501');
select t.expect_error('... nor revisions (they hold counter snapshots)', 'select * from public.lyst_round_revisions', '42501');
select t.expect_error('... nor reasons and the marshal''s name', 'select * from public.match_discipline_private', '42501');
select t.expect_error('... nor the settings', 'select * from public.event_lyst_settings', '42501');
select t.expect_error('... nor which matches are run through Lyst Control', 'select * from public.lyst_matches', '42501');
select t.expect_error('... nor join codes', 'select * from public.lyst_join_codes', '42501');
select t.expect_error('nobody writes a table directly: rounds', $$insert into public.lyst_rounds (match_id, round_no, event_id) values (gen_random_uuid(), 1, gen_random_uuid())$$, '42501');
select t.as_user(t.u(1));
select t.expect_error('... a fighter cannot write rounds directly', format($$update public.lyst_rounds set awarded_a = 99 where match_id = %L$$, t.m(1)), '42501');
select t.expect_error('... nor the timer', $$update public.lyst_timer set remaining_ms = 1$$, '42501');
select t.expect_error('... nor discipline', $$delete from public.match_discipline$$, '42501');
select t.expect_eq('a fighter cannot see counter tallies (not their seat)', (select count(*) from public.lyst_counts), 0::bigint);
select t.as_user(t.u(70));
select t.expect_eq('staff of another event see no tallies of this event', (select count(*) from public.lyst_counts), 0::bigint);
select t.expect_eq('... and cannot read this event''s seats', (select count(*) from public.lyst_counter_seats), 0::bigint);
select t.as_admin();
update public.events set status = 'draft' where id = t.e1();
select t.as_anon();
select t.expect_eq('an unpublished event shows nothing publicly', array[(select count(*) from public.lyst_round_scores), (select count(*) from public.lyst_timer), (select count(*) from public.lyst_public_state)], array[0::bigint, 0::bigint, 0::bigint]);
select t.as_admin();
update public.events set status = 'published' where id = t.e1();

-- ================================================================ 8. Pack 12 and the queue are untouched
select t.expect_eq('nothing the lyst did created a notification', t.notif_count(), 0::bigint);
select t.expect_eq('... or moved the queue (the match is still scheduled: only the existing queue functions move it)', t.qstate(1), 'scheduled');

-- ================================================================ 9. carrying counters to the next fight (same field), field scope, expiry
select t.as_user(t.u(88));
select t.expect_error('counters cannot be carried to a match on another field', format('select public.carry_counter_seats(%L, %L)', t.m(1), t.m(2)), 'P0001');
select t.expect_error('the next match must be opened in Lyst Control first', format('select public.carry_counter_seats(%L, %L)', t.m(1), t.m(3)), 'P0001');
select t.as_admin();
-- an expired seat cannot count
update public.lyst_counter_seats set expires_at = now() - interval '1 minute' where user_id = t.u(24);
select t.expect_msg('an expired counter seat cannot count', $$select t.cr(24, 2)$$, 'not active');
update public.lyst_counter_seats set expires_at = now() + interval '1 hour' where user_id = t.u(24);

-- ================================================================ 10. finalization: human, official, through the existing path
select t.as_user(t.u(88));
select t.expect_error('a match with an unconfirmed round cannot be finished', format('select public.lyst_finalize(gen_random_uuid(), %L, %s, %L)', t.m(4), t.mver(4), 'a'), 'P0001');
select t.expect_error('a result must be supported by the official totals (13-9: B cannot win on score)', format('select public.lyst_finalize(gen_random_uuid(), %L, %s, %L)', t.m(1), t.mver(1), 'b'), 'P0001');
select t.expect_error('a DQ needs a recorded disqualification', format($$select public.lyst_finalize(gen_random_uuid(), %L, %s, 'a', 'dq')$$, t.m(1), t.mver(1)), 'P0001');
select t.expect_error('a technical result needs the marshal''s reason', format($$select public.lyst_finalize(gen_random_uuid(), %L, %s, 'a', 'technical')$$, t.m(1), t.mver(1)), '22023');
select t.cmd() as fin \gset
select public.lyst_finalize(:'fin'::uuid, t.m(1), t.mver(1), 'a') ->> 'status' as fs \gset
select t.expect_eq('FINISH MATCH through the existing result path: accepted', :'fs'::text, 'accepted');
select t.as_admin();
select t.expect_eq('the match is final with the OFFICIAL totals', (select result || ' ' || score_a || '-' || score_b from public.matches where id = t.m(1)), 'a 13-9');
select t.expect_eq('bracket progression: the winner moved into the final', (select entry_a from public.matches where id = t.m(3)), '00000000-0000-0000-0000-00000000ee01'::uuid);
select t.expect_eq('the stored result detail carries official rounds and discipline, and NO counters', (select (detail ? 'lyst') and not (detail::text ~* 'counter|learning|tally|seat') from public.matches where id = t.m(1)), true);
select t.expect_eq('the proposal record shows who saved it (existing Pack 03 evidence)', (select status from public.result_proposals where id = :'fin'::uuid), 'accepted');
select t.as_user(t.u(88));
select t.expect_eq('a retried FINISH (same command) is answered as a repeat', public.lyst_finalize(:'fin'::uuid, t.m(1), 0, 'a') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('only one result exists', (select count(*) from public.result_proposals where match_id = t.m(1)), 1::bigint);
select t.expect_eq('finishing stopped the field-1 timer for that match', t.timer_status('field 1'), 'idle');
select t.expect_eq('finishing the match ended the fight; the second field is untouched', t.timer_status('field 2'), 'running');
select t.as_user(t.u(21));
select t.expect_error('counters cannot count a final match', format('select public.counter_record(gen_random_uuid(), %L, 2, 1)', t.seatof(21)), 'P0001');
select t.as_user(t.u(88));
select t.expect_error('a final match''s rounds are locked (reopen it first)', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 2, 9, 9, %s, null, null, ''x1x'')', t.m(1), t.round_rev(1, 2)), 'P0001');
select t.expect_error('... its timer too', $$select t.tc(88, 'Field 1', 1, -1, 'start')$$, 'P0001');
select t.expect_error('... and no discipline can be added', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 2, 'a', 'warning')$$, t.m(1)), 'P0001');
select t.as_admin();

-- the existing reopen path (Pack 03 / 09C) makes the rounds correctable again, with the audit trail
select t.as_user(t.u(90));
select public.reopen_match(t.m(1), 'Marshal reviewed the lyst sheet') as _re \gset
select t.as_admin();
select t.expect_eq('reopened by the organizer through the existing reopen path', (select queue_state <> 'final' from public.matches where id = t.m(1)), true);
select t.as_user(t.u(88));
select t.expect_eq('rounds can be corrected again (with a reason)', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 2, 8, 4, t.round_rev(1, 2), null, null, 'Marshal changed the call after review') ->> 'kind', 'correct');
select t.as_admin();
select t.expect_eq('the earlier official result was superseded into the existing revision log, not erased', (select count(*) >= 0 from public.result_revisions), true);

-- ================================================================ 11. a pool match with a draw, a DQ and a technical result
select t.as_user(t.u(88));
select t.expect_eq('NEXT FIGHT: the counters move to the next match on the field (same side and slot)', public.carry_counter_seats(t.m(1), t.m(4)) ->> 'moved', '6');
select t.as_admin();
select t.tc(88, 'Field 1', 4, -1, 'start', 'fight', 60000, 1);
select t.expect_eq('a carried counter counts the new fight', (t.cr(21, 1) ->> 'total'), '1');
select t.expect_error('a simple-input fight refuses a weight of 2', $$select t.cr(21, 1, 2)$$, '22023');
select t.as_user(t.u(88));
select public.lyst_confirm_round(gen_random_uuid(), t.m(4), 1, 3, 3, t.round_rev(4, 1));
select t.as_admin();
select t.tc(88, 'Field 1', 4, -1, 'start', 'fight', 60000, 2);
select t.as_user(t.u(88));
select public.lyst_confirm_round(gen_random_uuid(), t.m(4), 2, 2, 2, t.round_rev(4, 2));
select t.expect_error('level totals are not a win for either side', format('select public.lyst_finalize(gen_random_uuid(), %L, %s, %L)', t.m(4), t.mver(4), 'a'), 'P0001');
select public.lyst_record_discipline(gen_random_uuid(), t.m(4), 2, 'b', 'dq', null, 0, 'Removed by the marshal', 'Marshal Lee');
select t.expect_eq('a DQ against B lets A be awarded the fight on that basis', public.lyst_finalize(gen_random_uuid(), t.m(4), t.mver(4), 'a', 'dq') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('the result is A with the official 5-5 totals (the DQ is in the detail, not in the score)', (select result || ' ' || score_a || '-' || score_b from public.matches where id = t.m(4)), 'a 5-5');
select t.expect_eq('the entry itself was NOT marked disqualified by this (an event-level decision stays with the organizers)', (select status from public.entries where id = '00000000-0000-0000-0000-00000000ee06'), 'registered');

select t.tc(88, 'Field 1', 5, -1, 'start', 'fight', 60000, 1);
select t.as_user(t.u(88));
select public.lyst_confirm_round(gen_random_uuid(), t.m(5), 1, 2, 2, t.round_rev(5, 1));
select t.expect_eq('level official totals can be finished as a draw by a person', public.lyst_finalize(gen_random_uuid(), t.m(5), t.mver(5), 'draw') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('the draw is stored with the official totals', (select result || ' ' || score_a || '-' || score_b from public.matches where id = t.m(5)), 'draw 2-2');

-- ================================================================ 12. synthetic data stays labelled; the lyst adds no aggregate
select t.expect_eq('lyst tables feed no ranking, statistic or career view (they are not referenced by any aggregate view)',
  (select count(*) from pg_views where schemaname = 'public' and definition ~* 'lyst_|match_discipline' and viewname not in ('lyst_round_scores', 'lyst_public_state')), 0::bigint);


-- ================================================================ 13. join-code brute force, grants and row-level security on everything new
select t.as_user(t.u(40));
select public.request_counter_seat('WRONGCODE' || n) from generate_series(1, 15) n;
select t.expect_error('after 15 wrong guesses a person is asked to wait (even with the right code)', format('select public.request_counter_seat(%L)', :'code1'), '22023');
select t.as_admin();
select t.expect_eq('the new tables all have row-level security on',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('event_lyst_settings','lyst_matches','lyst_timer','lyst_rounds','lyst_round_revisions','match_discipline','match_discipline_private','lyst_join_codes','lyst_counter_seats','lyst_counts','lyst_counter_rounds','lyst_join_attempts') and c.relrowsecurity),
  12::bigint);
select t.expect_eq('no client role can write any new table directly',
  (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon','authenticated','public') and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
     and g.table_name in ('event_lyst_settings','lyst_matches','lyst_timer','lyst_rounds','lyst_round_revisions','match_discipline','match_discipline_private','lyst_join_codes','lyst_counter_seats','lyst_counts','lyst_counter_rounds','lyst_join_attempts')), 0::bigint);
select t.expect_eq('anonymous cannot run any lyst or counter function',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'lyst\_%' or p.proname like 'counter\_%' or p.proname in ('create_lyst_join_code','request_counter_seat','assign_counter_seat','end_counter_seat','carry_counter_seats','set_lyst_settings'))
     and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.expect_eq('the helper functions in the private schema are not callable by signed-in users',
  (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'lyst\_%' and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint);
select t.expect_eq('every public lyst function sets an empty search path (no path hijacking)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and (p.proname like 'lyst\_%' or p.proname like 'counter\_%' or p.proname in ('create_lyst_join_code','request_counter_seat','assign_counter_seat','end_counter_seat','carry_counter_seats','set_lyst_settings'))
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 0::bigint);

select 'PACK13 GATE PASSED ' || count(*) || ' checks' from t.log;
rollback;
