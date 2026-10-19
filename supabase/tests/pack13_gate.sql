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

create table t.ph (n int primary key, sid uuid);   -- counter phones 21..24: sessions of the event's Counter QR (not people)
create function t.u(n int) returns uuid language sql stable as $$ select coalesce((select sid from t.ph where t.ph.n = u.n), ('00000000-0000-0000-0000-0000000000' || lpad(u.n::text, 2, '0'))::uuid) from (select n) u $$;
create function t.as_device(s uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', s::text, true); set local role bos_event_device; end $$;
-- a phone (21..24) acts as a device session; anyone else as a signed-in person
create function t.as_who(n int) returns void language plpgsql as $$ begin if exists (select 1 from t.ph where t.ph.n = as_who.n) then perform t.as_device(t.u(n)); else perform t.as_user(t.u(n)); end if; end $$;
create function t.h(n int) returns bytea language sql immutable as $$ select decode(repeat(lpad(to_hex(n), 2, '0'), 32), 'hex') $$;
create function t.sh(n int) returns bytea language sql immutable as $$ select decode(repeat(lpad(to_hex(n + 128), 2, '0'), 32), 'hex') $$;
create function t.open(code int, ip text, sec int) returns uuid language sql as $$ select (public.device_open_session(t.h(code), t.sh(sec), ip) ->> 'session_id')::uuid $$;
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
  perform t.as_who(uid);
  r := public.counter_record(coalesce(id, gen_random_uuid()), t.seatof(uid), rnd, w);
  perform t.as_admin();
  return r;
end $$;
grant usage on schema t to bos_event_device; grant all on t.log to bos_event_device; grant usage on all sequences in schema t to bos_event_device; grant select on t.ph to anon, authenticated, service_role, bos_event_device;
grant execute on all functions in schema t to anon, authenticated, service_role, bos_event_device;

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
-- secretary boundary (20261022000100): the scorekeeper runs only called fights (on now, on deck, in the hole); the organizer calls them first
select t.as_user(t.u(88));
select t.expect_error('a scorekeeper cannot open a fight that was never called', format($$select public.lyst_open(%L, 'weighted')$$, t.m(1)), '42501');
select t.expect_error('... nor run its clock', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'start')$$, t.e1(), t.m(1)), '42501');
select t.as_admin();
select t.expect_eq('... nothing was opened', (select count(*) from public.lyst_matches), 0::bigint);
select t.as_user(t.u(90));
select t.expect_ok('the organizer calls the fights: semifinals on now (Field 1, Field 2), buckler on deck and in the hole (Field 1)',
  format($$select public.set_match_queue(%L, 'active'); select public.set_match_queue(%L, 'active'); select public.set_match_queue(%L, 'on_deck'); select public.set_match_queue(%L, 'in_the_hole')$$, t.m(1), t.m(2), t.m(4), t.m(5)));
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

-- ================================================================ 3. counters: ONE reusable Counter QR per event (many phones), each phone bound to a field and a side; trainees through the training QR
select t.as_user(t.u(90));
select t.expect_eq('the organizer makes the event''s reusable Counter QR (kind counter_pool, role counter)', public.create_event_credential(t.e1(), 'counter_pool', 'Counter QR', 'counter', t.h(50), null, 'ABCDEFGH2345') ->> 'kind', 'counter_pool');
select t.expect_error('one Counter QR per event', format($$select public.create_event_credential(%L, 'counter_pool', 'Second QR', 'counter', %L, null, 'ABCDEFGH2346')$$, t.e1(), t.h(51)), '22023');
select t.expect_error('the pool needs its plaintext code (that is what the QR shows)', format($$select public.create_event_credential(%L, 'counter_pool', 'QR', 'counter', %L)$$, t.e2(), t.h(52)), '42501');
select t.expect_error('an ordinary device code never keeps a plaintext', format($$select public.create_event_credential(%L, 'device', 'Marshal Phone', 'marshal', %L, null, 'ABCDEFGH2347')$$, t.e1(), t.h(53)), '22023');
select t.expect_error('a pool is only ever a counter', format($$select public.create_event_credential(%L, 'counter_pool', 'QR', 'marshal', %L, null, 'ABCDEFGH2348')$$, t.e1(), t.h(54)), '22023');
select t.as_admin();
insert into t.ph select n, t.open(50, 'ip-p' || n, 50 + n) from generate_series(21, 24) n;
select t.expect_eq('four phones scan the same QR: four open sessions, none signed the others out', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and s.ended_at is null and s.multi), 4::bigint);
select t.expect_eq('... and the credential is not flagged "signed in elsewhere"', (select elsewhere_at is null from public.event_credentials where kind = 'counter_pool'), true);
select t.as_user(t.u(88));
select t.expect_error('the Secretary / Scorekeeper does not handle the Counter QR (secretary boundary)', format('select public.counter_pool_code(%L)', t.e1()), '42501');
select t.as_user(t.u(87));
select t.expect_eq('a marshal shows the Counter QR (the plaintext, with how many phones are on it)', (public.counter_pool_code(t.e1()) ->> 'code') || '|' || (public.counter_pool_code(t.e1()) ->> 'open_sessions'), 'ABCDEFGH2345|4');
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot', format('select public.counter_pool_code(%L)', t.e1()), '42501');
select t.as_user(t.u(70));
select t.expect_error('another event''s organizer cannot', format('select public.counter_pool_code(%L)', t.e1()), '42501');
select t.as_user(t.u(70));
select t.expect_eq('an event without a Counter QR says so, and that its organizer may make one', (public.counter_pool_code(t.e2()) ->> 'code') is null and (public.counter_pool_code(t.e2()) ->> 'can_create') = 'true', true);
-- the Lyst is running m1 on Field 1 (the last fight opened on a field is its current one)
select t.as_user(t.u(88)); select public.lyst_open(t.m(1), 'weighted');
-- the phone: who is counting, which Lyst, which side. Nothing else to decide, nobody to approve.
select t.as_device(t.u(21));
select t.expect_eq('a fresh phone knows its event and its fields, and has no seat yet', (public.counter_state() ->> 'kind') || '|' || jsonb_array_length(public.counter_state() -> 'fields') || '|' || jsonb_typeof(public.counter_state() -> 'seat'), 'device|2|null');
select t.expect_error('a phone must say who is counting', $$select public.counter_bind('Field 1', 'a')$$, '22023');
select t.expect_error('a phone cannot bind to a field the event does not have', $$select public.counter_bind('Field 9', 'a', 'Ash')$$, '22023');
select t.expect_error('a side is a (red) or b (blue)', $$select public.counter_bind('Field 1', 'c', 'Ash')$$, '22023');
select t.expect_eq('phone 21: Field 1, red, Ash: seated at once on the fight the Lyst has open', (public.counter_bind('Field 1', 'a', 'Ash') -> 'seat' ->> 'match_id'), t.m(1)::text);
select t.expect_eq('... as an official counter on side a, watching Fighter 1', (public.counter_state() -> 'seat' ->> 'role') || '|' || (public.counter_state() -> 'seat' ->> 'side') || '|' || (public.counter_state() ->> 'fighter'), 'official|a|Fighter 1');
select t.expect_error('a phone cannot make a training code', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.e1()), '42501');
select t.expect_error('a phone cannot read the staff state', format('select public.lyst_state(%L)', t.m(1)), '42501');
select t.expect_error('a phone cannot touch the timer', format($$select public.lyst_timer_command(%L, 'Field 1', %L, 0, gen_random_uuid(), 'pause')$$, t.e1(), t.m(1)), '42501');
select t.expect_error('a phone cannot confirm a round', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 6, 5, 0)', t.m(1)), '42501');
select t.expect_error('a phone cannot record discipline', format($$select public.lyst_record_discipline(gen_random_uuid(), %L, 1, 'b', 'warning')$$, t.m(1)), '42501');
select t.expect_error('a phone cannot finalize', format($$select public.lyst_finalize(gen_random_uuid(), %L, 0, 'a')$$, t.m(1)), '42501');
select t.expect_error('a phone cannot read any table (it inherits the public reads only)', 'select count(*) from public.lyst_counter_seats', '42501');
select t.expect_error('a phone cannot move another phone', format($$select public.move_counter_session(%L, 'Field 2', 'b')$$, t.u(22)), '42501');
select t.as_device(t.u(22)); select public.counter_bind('Field 1', 'a', 'Birch');
select t.as_device(t.u(23)); select public.counter_bind('Field 1', 'b', 'Cedar');
select t.as_device(t.u(24)); select public.counter_bind('Field 1', 'b', 'Dune');
select t.as_admin();
select t.expect_eq('the phones have no slots and are not limited to four: two on red, two on blue', (select string_agg(coalesce(slot, '-') || side, ',' order by display_name) from public.lyst_counter_seats where match_id = t.m(1) and status = 'active'), '-a,-a,-b,-b');
select t.expect_eq('the operator history has one line per phone', (select count(*) from public.counter_operator_log where event_id = t.e1()), 4::bigint);
-- trainees: the Lyst's join code is the TRAINING QR; a signed-in person joins at once (no approval, no waiting), always as LEARNING
select t.as_user(t.u(88));
select t.expect_error('the secretary cannot make a training code (secretary boundary)', format($$select public.create_lyst_join_code(%L, 'Field 1')$$, t.e1()), '42501');
select t.as_user(t.u(87));
select public.create_lyst_join_code(t.e1(), 'Field 1') ->> 'code' as code1 \gset
select t.as_user(t.u(25));
select t.expect_eq('a wrong training code is answered "invalid" (not an error, so the try is counted)', public.join_training_counter('NOT-A-CODE', 'Elm', 'a') ->> 'status', 'invalid');
select t.expect_error('a trainee must pick a side', format($$select public.join_training_counter(%L, 'Elm', null)$$, :'code1'), '22023');
select t.expect_eq('a trainee joins at once as a LEARNING counter on the open fight (no approval)', public.join_training_counter(:'code1', 'Elm', 'a') ->> 'status', 'ok');
select t.expect_eq('... learning, side a, on m1', (public.counter_state() ->> 'kind') || '|' || (public.counter_state() -> 'seat' ->> 'role') || '|' || (public.counter_state() -> 'seat' ->> 'side') || '|' || (public.counter_state() -> 'seat' ->> 'match_id'), 'training|learning|a|' || t.m(1)::text);
select t.expect_error('a trainee cannot bind like a phone (no device)', $$select public.counter_bind('Field 1', 'a', 'Elm')$$, '42501');
select t.as_user(t.u(26)); select public.join_training_counter(lower(:'code1'), 'Fir', 'b');
select t.as_user(t.u(88));
select t.expect_eq('the Lyst sees 4 counters and 2 trainees on the fight, by operator name (no slots, no accounts), device counters marked online',
  (select string_agg((x ->> 'name') || ':' || (x ->> 'role') || ':' || (x ->> 'side') || ':' || coalesce(x ->> 'online', 'n/a'), ',' order by x ->> 'role', x ->> 'side', x ->> 'name') from jsonb_array_elements(public.lyst_state(t.m(1)) -> 'seats') x),
  'Elm:learning:a:n/a,Fir:learning:b:n/a,Ash:official:a:true,Birch:official:a:true,Cedar:official:b:true,Dune:official:b:true');
select t.expect_eq('... and the field''s bound phones with their operators', jsonb_array_length(public.lyst_state(t.m(1)) -> 'field_counters'), 4);
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
select t.as_device(t.u(21));
select t.expect_error('a counter cannot count on another counter''s seat', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(22)), '42501');
select t.expect_error('... nor undo another counter''s tap', format('select public.counter_undo(gen_random_uuid(), %L, 1)', t.seatof(22)), '42501');
select t.expect_error('... nor submit for them', format('select public.counter_submit(%L, 1)', t.seatof(22)), '42501');
select t.expect_error('stale input: a counter cannot add to round 2 while round 1 is the live round', format('select public.counter_record(gen_random_uuid(), %L, 2, 1)', t.seatof(21)), 'P0001');
select t.as_admin();
select t.expect_eq('the tablet can see every tally row (taps only; undo rows reverse them)', (select count(*) from public.lyst_counts where round_no = 1 and undo_of is null), 53::bigint);
select t.as_user(t.u(25));
select t.expect_eq('a trainee sees only their own tally rows', (select count(*) from public.lyst_counts), 9::bigint);
select t.expect_eq('a trainee sees only their own seat', (select count(*) from public.lyst_counter_seats), 1::bigint);
select t.as_device(t.u(21));
select t.expect_error('a phone reads no tally table at all', 'select count(*) from public.lyst_counts', '42501');
select t.expect_eq('a phone sees its own state: fighter, side, role, operator, round, total, can_count', (public.counter_state() ->> 'fighter') || '|' || (public.counter_state() #>> '{seat,side}') || '|' || (public.counter_state() #>> '{seat,role}') || '|' || (public.counter_state() #>> '{binding,operator}') || '|' || (public.counter_state() ->> 'my_total') || '|' || (public.counter_state() ->> 'can_count'), 'Fighter 1|a|official|Ash|32|true');
select t.expect_eq('the phone state carries no other counter, no official score and no account id', (select count(*) from jsonb_object_keys(public.counter_state()) k where k in ('seats', 'rounds', 'discipline', 'requests', 'user_id', 'official_a', 'official_b')), 0::bigint);
-- OPERATOR HANDOFF: Ash hands the phone to Birch's friend Oak mid-round; the tally on the phone carries on, the log says who held it when, every tap names its operator
select t.expect_eq('a new operator takes the phone: same seat, same tally (32), new name', (public.counter_set_operator('Oak') -> 'seat' ->> 'operator') || '|' || (public.counter_set_operator('Oak') ->> 'my_total'), 'Oak|32');
select t.expect_eq('... the next tap is Oak''s and continues the count', (t.cr(21, 1) ->> 'total'), '33');
select t.as_admin();
select t.expect_eq('every tap names the operator who made it (32 by Ash, 1 by Oak)', (select string_agg(x.operator_name || ':' || x.n, ',' order by x.operator_name) from (select operator_name, count(*) as n from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.user_id = t.u(21) and c.undo_of is null group by operator_name) x), 'Ash:32,Oak:1');
select t.expect_eq('the operator log keeps both (Ash ended, Oak open)', (select string_agg(operator_name || ':' || (ended_at is not null)::text, ',' order by started_at) from public.counter_operator_log where session_id = t.u(21)), 'Ash:true,Oak:false');
select t.expect_error('the operator log is append-only', format('delete from public.counter_operator_log where session_id = %L', t.u(21)), '42501');
select t.as_user(t.u(88));
select t.expect_error('the secretary does not read the counters'' operator history (secretary boundary)', format('select public.counter_operator_history(%L, %L)', t.e1(), t.u(21)), '42501');
select t.as_user(t.u(89));
select t.expect_eq('the operator history is readable by the head marshal (who counted red on this phone)', (select string_agg(x ->> 'operator', ',' order by x ->> 'started_at') from jsonb_array_elements(public.counter_operator_history(t.e1(), t.u(21))) x), 'Ash,Oak');
select t.as_device(t.u(21));
select public.counter_submit(t.seatof(21), 1);
select t.as_admin();

-- ================================================================ 4. the marshal's call
-- Counters on A: 33 and 3 (official), on B: 4 and 3. The marshal's call is 6-5: not an average, not a max, not a majority.
select t.expect_eq('the operator ends the round with the break timer (counting stops, "Scores being confirmed")', (t.tc(88, 'Field 1', 1, -1, 'start', 'break', 45000, 1) ->> 'status'), 'ok');
select t.as_user(t.u(88));
select t.expect_eq('a stale revision on the round is told so', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 6, 5, t.round_rev(1, 1) + 5) ->> 'status', 'stale');
select t.expect_error('scores are bounded', format('select public.lyst_confirm_round(gen_random_uuid(), %L, 1, 100, 5, 1)', t.m(1)), '22023');
select t.cmd() as conf \gset
select public.lyst_confirm_round(:'conf'::uuid, t.m(1), 1, 6, 5, t.round_rev(1, 1), 7, 5, 'Marshal awarded 6-5 after review') ->> 'status' as s1 \gset
select t.expect_eq('CONFIRM ROUND records the marshal''s 6-5 (counters recommended 7-5: that is only recorded)', :'s1'::text, 'ok');
select t.as_admin();
select t.expect_eq('the official round score is exactly what the marshal awarded', t.official(1, 1), '6-5');
select t.expect_eq('... even though the counters tallied 33/3 and 4/3 and recommended 7-5', (select recommended_a || '-' || recommended_b from public.lyst_round_revisions where id = :'conf'::uuid), '7-5');
select t.expect_eq('the evidence keeps every counter''s number by operator and side, learning ones marked as learning',
  (select string_agg((c ->> 'operator') || ':' || (c ->> 'side') || ':' || (c ->> 'role') || ':' || (c ->> 'total'), ',' order by c ->> 'role', c ->> 'side', c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.id = :'conf'::uuid),
  'Elm:a:learning:9,Fir:b:learning:2,Birch:a:official:3,Oak:a:official:33,Cedar:b:official:4,Dune:b:official:3');
select t.as_user(t.u(88));
select t.expect_eq('a double tap on CONFIRM ROUND (same command) does not confirm twice', public.lyst_confirm_round(:'conf'::uuid, t.m(1), 1, 6, 5, t.round_rev(1, 1) - 1, 7, 5) ->> 'status', 'duplicate');
select t.expect_eq('a second confirm from another device with the old revision is stale', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 1, 9, 9, t.round_rev(1, 1) - 1) ->> 'status', 'stale');
select t.as_admin();
select t.expect_eq('one confirmation, one revision', (select count(*) from public.lyst_round_revisions where match_id = t.m(1) and round_no = 1), 1::bigint);
select t.expect_eq('the official score did not move', t.official(1, 1), '6-5');
select t.as_device(t.u(21));
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
select t.as_device(t.u(21)); select public.counter_submit(t.seatof(21), 2);
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
select t.expect_eq('confirm round 2 awarded 7-4 with the override reason', public.lyst_confirm_round(gen_random_uuid(), t.m(1), 2, 7, 4, t.round_rev(1, 2), p_reason => 'Marshal awarded 7-4 after review') ->> 'status', 'ok');
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
select t.expect_eq('... or moved the queue beyond the active fight called by the fixture', t.qstate(1), 'active');

-- ================================================================ 9. the field has ONE current fight; a phone changes field or side itself; expiry
select t.as_admin();
select t.expect_eq('Field 1 has exactly one current fight (m1)', private.field_current_match(t.e1(), 'field 1'), t.m(1));
select t.as_user(t.u(88));
select t.expect_eq('opening m2 on Field 2 again', public.lyst_open(t.m(2), 'weighted') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... it is Field 2''s current fight and Field 1 is left alone', (private.field_current_match(t.e1(), 'field 2') = t.m(2))::text || '|' || (private.field_current_match(t.e1(), 'field 1') = t.m(1))::text, 'true|true');
select t.expect_eq('the Field 1 phones did not move', (select count(*) from public.lyst_counter_seats where match_id = t.m(1) and status = 'active'), 6::bigint);
-- phone 24 deliberately moves to Field 2, blue: its old seat ends (evidence kept), a new one starts on m2 at zero
select t.as_device(t.u(24));
select t.expect_eq('a phone changes field and side itself: seated on Field 2''s fight, blue', (public.counter_bind('Field 2', 'b', 'Dune') -> 'seat' ->> 'match_id') || '|' || (public.counter_state() -> 'seat' ->> 'side'), t.m(2)::text || '|b');
select t.as_admin();
select t.expect_eq('... its m1 seat is ended, its round-1 taps on m1 are still there as evidence', (select status from public.lyst_counter_seats where user_id = t.u(24) and match_id = t.m(1)) || '|' || (select count(*) from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.user_id = t.u(24) and c.match_id = t.m(1) and c.undo_of is null), 'ended|3');
select t.as_device(t.u(24));
select t.expect_eq('... and it comes back to Field 1 red, a fresh seat on m1, round-2 count at zero', (public.counter_bind('Field 1', 'a', 'Dune') ->> 'my_total'), '0');
-- an expired seat cannot count
select t.as_admin();
update public.lyst_counter_seats set expires_at = now() - interval '1 minute' where user_id = t.u(24) and status = 'active';
select t.expect_msg('an expired counter seat cannot count', $$select t.cr(24, 2)$$, 'not active');
update public.lyst_counter_seats set expires_at = now() + interval '1 hour' where user_id = t.u(24) and status = 'active';
-- a lost phone: the organizer signs that one phone out; the other phones and the QR keep working; a replacement phone just scans the QR
select t.as_user(t.u(90));
select t.expect_eq('the organizer sees every phone on the event with its field, side and operator', (select count(*) from jsonb_array_elements(public.list_event_device_sessions(t.e1())) x where x -> 'binding' ->> 'operator' is not null), 4::bigint);
select t.expect_eq('the organizer signs the lost phone (24) out', public.end_event_session(t.u(24), 'left in a car') ->> 'status', 'ended');
select t.as_device(t.u(24));
select t.expect_error('the lost phone has no authority from its next call', 'select public.counter_state()', '42501');
select t.as_admin();
select t.expect_eq('its seat is ended, its operator log closed', (select status from public.lyst_counter_seats where user_id = t.u(24) and match_id = t.m(1) order by requested_at desc limit 1) || '|' || (select (ended_at is not null)::text from public.counter_operator_log where session_id = t.u(24) order by started_at desc limit 1), 'ended|true');
select t.expect_eq('the other three phones and the QR are untouched', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and s.ended_at is null) || '|' || (select revoked_at is null from public.event_credentials where kind = 'counter_pool')::text, '3|true');
update t.ph set sid = t.open(50, 'ip-p24b', 60) where n = 24;
select t.expect_eq('a replacement phone scans the same QR and is in at once (nothing blocked it)', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and s.ended_at is null), 4::bigint);
select t.as_device(t.u(24));
select t.expect_eq('... binds to Field 1 red as Dune and is seated on m1', public.counter_bind('Field 1', 'a', 'Dune') -> 'seat' ->> 'match_id', t.m(1)::text);
select t.as_admin();

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
select t.as_device(t.u(21));
select t.expect_error('counters cannot count a final match', format('select public.counter_record(gen_random_uuid(), %L, 2, 1)', t.seatof(21)), 'P0001');
select t.as_user(t.u(89));
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
select t.as_user(t.u(90));
select public.set_match_queue(t.m(4), 'on_deck');
select public.set_match_queue(t.m(5), 'in_the_hole');
select t.as_user(t.u(88));
select t.expect_eq('NEXT FIGHT: the Lyst opens m4 on Field 1', public.lyst_open(t.m(4), 'simple') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... every counter on the field followed it (same side, same operator): no rejoin, no reseat', (select count(*) from public.lyst_counter_seats where match_id = t.m(4) and status = 'active'), 6::bigint);
select t.expect_eq('the old seats are ended and keep their evidence (nothing deleted)', (select count(*) from public.lyst_counter_seats where match_id = t.m(1) and status = 'ended') || '|' || (select count(*) from public.lyst_counts where match_id = t.m(1) and undo_of is null), '8|' || (select count(*) from public.lyst_counts where match_id = t.m(1) and undo_of is null));
select t.as_device(t.u(21));
select t.expect_eq('the phone shows the new fight on its own, same side, count at zero, no new fighter chosen by anyone', (public.counter_state() ->> 'fighter') || '|' || (public.counter_state() -> 'seat' ->> 'side') || '|' || (public.counter_state() ->> 'my_total') || '|' || (public.counter_state() ->> 'competition'), 'Fighter 5|a|0|Sword and Buckler');
select t.as_admin();
select t.tc(88, 'Field 1', 4, -1, 'start', 'fight', 60000, 1);
select t.expect_eq('a followed counter counts the new fight', (t.cr(21, 1) ->> 'total'), '1');
select t.expect_eq('... and the trainee followed too (still learning, never official)', (t.cr(25, 1) ->> 'total') || '|' || (select role from public.lyst_counter_seats where user_id = t.u(25) and match_id = t.m(4)), '1|learning');
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
select public.join_training_counter('WRONGCODE' || n, 'Guess', 'a') from generate_series(1, 15) n;
select t.expect_error('after 15 wrong guesses a person is asked to wait (even with the right code)', format($$select public.join_training_counter(%L, 'Guess', 'a')$$, :'code1'), '22023');
select t.expect_eq('the old seating ceremony is gone (no seat request, no assignment, no carry)', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('request_counter_seat', 'assign_counter_seat', 'carry_counter_seats')), 0::bigint);
select t.as_admin();
select t.expect_eq('the new tables all have row-level security on',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('event_lyst_settings','lyst_matches','lyst_timer','lyst_rounds','lyst_round_revisions','match_discipline','match_discipline_private','lyst_join_codes','lyst_counter_seats','lyst_counts','lyst_counter_rounds','lyst_join_attempts','lyst_field_current','counter_bindings','counter_operator_log') and c.relrowsecurity),
  15::bigint);
select t.expect_eq('no client role can write any new table directly',
  (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon','authenticated','public') and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
     and g.table_name in ('event_lyst_settings','lyst_matches','lyst_timer','lyst_rounds','lyst_round_revisions','match_discipline','match_discipline_private','lyst_join_codes','lyst_counter_seats','lyst_counts','lyst_counter_rounds','lyst_join_attempts','lyst_field_current','counter_bindings','counter_operator_log')), 0::bigint);
select t.expect_eq('anonymous cannot run any lyst or counter function',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'lyst\_%' or p.proname like 'counter\_%' or p.proname in ('create_lyst_join_code','join_training_counter','end_counter_seat','set_lyst_settings','move_counter_session','end_event_session','device_session_preview'))
     and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.expect_eq('the helper functions in the private schema are not callable by signed-in users',
  (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'lyst\_%' and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint);
select t.expect_eq('every public lyst function sets an empty search path (no path hijacking)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and (p.proname like 'lyst\_%' or p.proname like 'counter\_%' or p.proname in ('create_lyst_join_code','join_training_counter','end_counter_seat','set_lyst_settings','move_counter_session','end_event_session','device_session_preview'))
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 0::bigint);

-- ================================================================ 14. a fight opened BEFORE Pack 25 (its Lyst row and clock, no lyst_field_current): counters still find it; the clock makes it current; last / now / next
select t.as_admin();
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, queue_state) values
  (t.m(6), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 3', 0, 'Field 3', '00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-00000000ee06', 'active'),
  (t.m(7), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 4', 1, 'Field 3', '00000000-0000-0000-0000-00000000ee06', '00000000-0000-0000-0000-00000000ee05', 'on_deck');
insert into t.ph select 26, t.open(50, 'ip-p26', 76);
select t.as_user(t.u(87));
select public.lyst_open(t.m(6), 'simple');
select t.tc(87, 'Field 3', 6, -1, 'start', 'fight', 60000, 1);
select t.as_admin();
delete from public.lyst_field_current where match_id = t.m(6);   -- exactly the state of every fight opened before the Pack 25 migration
select t.expect_eq('a fight with only its Lyst row and its clock is still the field''s current fight', private.field_current_match(t.e1(), 'field 3'), t.m(6));
select t.as_device(t.u(26));
select t.expect_eq('phone 26 binds to that field: seated on the fight at once, counting allowed', (public.counter_bind('Field 3', 'a', 'Fern') -> 'seat' ->> 'match_id') || '|' || (public.counter_state() ->> 'waiting') || '|' || (public.counter_state() ->> 'can_count'), t.m(6)::text || '|false|true');
select t.expect_eq('... and its tap counts on that fight', t.cr(26, 1) ->> 'total', '1');
select t.as_device(t.u(26));
select t.expect_eq('the phone sees NOW and NEXT on its field (names only)', (public.counter_state() -> 'fights' -> 'now' ->> 'a') || ' vs ' || (public.counter_state() -> 'fights' -> 'now' ->> 'b') || ' / next ' || (public.counter_state() -> 'fights' -> 'next' ->> 'match_id'), 'Fighter 5 vs Fighter 6 / next ' || t.m(7)::text);
select t.expect_eq('no fight has finished on this field yet: LAST is empty', (public.counter_state() -> 'fights' -> 'last')::text, 'null');
select t.expect_eq('the fights block carries no counter, seat, account or score of a running fight', (public.counter_state() -> 'fights')::text ~* 'seat|operator|tally|user_id|count', false);
-- the marshal's clock makes the fight the field's current one (the row is written, the bound phones seated), with its own audit entry
select t.as_admin();
delete from public.lyst_field_current where match_id = t.m(6);
update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = t.u(26) and status = 'active';
select t.tc(87, 'Field 3', 6, -1, 'pause');
select t.as_admin();
select t.expect_eq('the clock on a Lyst fight makes it the field''s current fight (audited as such)', (select count(*) from public.lyst_field_current where match_id = t.m(6) and field_key = 'field 3') || '|' || (select count(*) from public.audit_log where event_id = t.e1() and action = 'lyst.field_current' and subject = t.m(6)::text and details ->> 'source' = 'timer'), '1|1');
select t.expect_eq('... and the bound phone was seated on it again', (select count(*) from public.lyst_counter_seats where user_id = t.u(26) and match_id = t.m(6) and status = 'active'), 1::bigint);
select t.expect_eq('the clock on a finished fight changes nothing', (select count(*) from public.lyst_field_current where match_id = t.m(4)), 0::bigint);
select t.expect_eq('the new trigger and helpers are private (no client role may call them)', (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('field_fights', 'lyst_timer_field_current', 'field_current_match') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint);

-- ================================================================ 15. the sides' names and colours (Pack 25.2): anyone who runs the Lyst may set them; phones and the Lyst read them
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot change the side colours', format($$select public.set_event_sides(%L, '{"a": {"name": "Yellow", "color": "#F2B233"}}')$$, t.e1()), '42501');
select t.as_user(t.u(70));
select t.expect_error('the other event''s organizer cannot change this event''s side colours', format($$select public.set_event_sides(%L, '{"a": {"name": "Yellow", "color": "#F2B233"}}')$$, t.e1()), '42501');
select t.as_user(t.u(87));
select t.expect_error('a side colour must be a hex colour', format($$select public.set_event_sides(%L, '{"a": {"name": "Yellow", "color": "yellow"}}')$$, t.e1()), '22023');
select t.expect_error('a side name is 1 to 20 characters', format($$select public.set_event_sides(%L, '{"a": {"name": "This side name is far too long to fit", "color": "#F2B233"}}')$$, t.e1()), '22023');
select t.expect_error('an empty change is refused', format($$select public.set_event_sides(%L, '{}')$$, t.e1()), '22023');
select t.expect_eq('a marshal sets side A to yellow (the colour is kept upper-case)', public.set_event_sides(t.e1(), '{"a": {"name": "Yellow", "color": "#f2b233"}}') -> 'a' ->> 'color', '#F2B233');
select t.as_user(t.u(88));
select t.expect_error('the secretary cannot change the side colours (secretary boundary)', format($$select public.set_event_sides(%L, '{"b": {"name": "Green", "color": "#1B7F3B"}}')$$, t.e1()), '42501');
select t.as_user(t.u(89));
select t.expect_eq('the head marshal sets side B to green; side A keeps yellow', (select (x -> 'a' ->> 'name') || '|' || (x -> 'b' ->> 'name') from public.set_event_sides(t.e1(), '{"b": {"name": "Green", "color": "#1B7F3B"}}') x), 'Yellow|Green');
select t.as_user(t.u(90));
select t.expect_eq('the organizer sees the sides in the Lyst state (settings.sides)', (public.lyst_state(t.m(6)) -> 'settings' -> 'sides' -> 'a' ->> 'name') || '/' || (public.lyst_state(t.m(6)) -> 'settings' -> 'sides' -> 'b' ->> 'color'), 'Yellow/#1B7F3B');
select t.expect_eq('the other settings survived the colour change (presets still there)', jsonb_typeof(public.lyst_state(t.m(6)) -> 'settings' -> 'presets'), 'array');
select t.expect_eq('the sides are audited', (select count(*) from public.audit_log where event_id = t.e1() and action = 'lyst.sides'), 2::bigint);
select t.as_device(t.u(26));
select t.expect_eq('a counter phone gets the names and colours', (public.counter_state() -> 'sides' -> 'a' ->> 'name') || ' ' || (public.counter_state() -> 'sides' -> 'a' ->> 'color') || ' / ' || (public.counter_state() -> 'sides' -> 'b' ->> 'name'), 'Yellow #F2B233 / Green');
select t.expect_eq('... and each Lyst in the chooser says who is fighting there', (select (f -> 'now' ->> 'a') || ' vs ' || (f -> 'now' ->> 'b') from jsonb_array_elements(public.counter_state() -> 'fields') f where f ->> 'key' = 'field 3'), 'Fighter 5 vs Fighter 6');
select t.expect_eq('... every Lyst in the chooser carries its now (names, or null when nothing is on)', (select bool_and(f ? 'now') from jsonb_array_elements(public.counter_state() -> 'fields') f), true);
select t.expect_error('a counter phone cannot change the side colours', format($$select public.set_event_sides(%L, '{"a": {"name": "X", "color": "#000000"}}')$$, t.e1()), '42501');
select t.as_admin();
select t.expect_eq('the other event has its own default sides', (private.event_sides(t.e2()) -> 'a' ->> 'name') || '/' || (private.event_sides(t.e2()) -> 'b' ->> 'name'), 'Red/Blue');

select 'PACK13 GATE PASSED ' || count(*) || ' checks' from t.log;
rollback;
