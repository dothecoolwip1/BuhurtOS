-- Pack 27A gate: Official Counter Foundation (migration 20261022000100), on top of the Pack 13 / 25 counter model (pack13_gate.sql keeps covering that).
--   * one Counter QR, many phones; each phone binds itself (name, Lyst, side); the server derives the rest from the session
--   * OPERATOR TURNS know the fight; a handoff keeps the tally and the frozen evidence names each operator's taps
--   * per-phone undo; a phone's taps never reach another phone, a result, or the public state
--   * following the Lyst: taps, undos and "done" with the OLD seat are refused after the next fight opens; the turn moves to the new fight
--   * ONE CURRENT FIGHT per Lyst: a Lyst in a running round is not switched by another tablet; a tablet left on an earlier fight cannot pull the phones back
--   * the server's counter messages have no "seat" in them; a trainee's account id never appears in the tablet's state
--   * Pack 27B: the Training Counter QR (a training pool): learning seats only, kept out of the official evidence, a comparison list for the learner
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack27_gate.sql
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


-- ================================================================ 1. the Counter QR and three phones on Lyst 1 (two red, one blue); turns know the fight
select t.as_user(t.u(90));
select public.create_event_credential(t.e1(), 'counter_pool', 'Counter QR', 'counter', t.h(50), null, 'ABCDEFGH2345');
select t.as_admin();
insert into t.ph select n, t.open(50, 'ip-p' || n, 50 + n) from generate_series(21, 23) n;
select t.expect_eq('three phones scanned the one Counter QR: three open sessions, nobody signed out', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and s.ended_at is null and s.multi), 3::bigint);
select t.as_user(t.u(88)); select public.lyst_open(t.m(1), 'weighted');
select t.as_device(t.u(21)); select public.counter_bind('Field 1', 'a', 'Garrett');
select t.as_device(t.u(22)); select public.counter_bind('Field 1', 'a', 'Nathan');
select t.as_device(t.u(23)); select public.counter_bind('Field 1', 'b', 'Joe');
select t.as_admin();
select t.expect_eq('three official seats on the fight the Lyst has open: Garrett and Nathan on red, Joe on blue, no slots, nothing pending', (select string_agg(display_name || ':' || side || ':' || role || ':' || status, ',' order by side, display_name) from public.lyst_counter_seats where match_id = t.m(1)), 'Garrett:a:official:active,Nathan:a:official:active,Joe:b:official:active');
select t.expect_eq('each phone''s OPERATOR TURN records who, which Lyst, which side and WHICH FIGHT (Pack 27A)', (select string_agg(operator_name || '@' || field_key || '/' || side || ':' || (match_id = t.m(1))::text, ',' order by operator_name) from public.counter_operator_log where event_id = t.e1() and ended_at is null), 'Garrett@field 1/a:true,Joe@field 1/b:true,Nathan@field 1/a:true');
select t.expect_error('the operator log is append-only: the fight of a turn cannot be rewritten', format('update public.counter_operator_log set match_id = %L where operator_name = %L', t.m(4), 'Garrett'), '42501');

-- ================================================================ 2. counting is per phone; the tablet sees each phone by its session, never summed
select t.expect_eq('round 1 starts', t.tc(88, 'Field 1', 1, -1, 'start', 'fight', 60000, 1) ->> 'status', 'ok');
select t.cr(21, 1, 2); select t.cr(21, 1, 1);          -- Garrett 3
select t.cr(22, 1, 2);                                 -- Nathan 2
select t.cr(23, 1, 2); select t.cr(23, 1, 2);          -- Joe 4
select t.expect_eq('three tallies, three numbers: 3, 2, 4', array[t.total(21, 1), t.total(22, 1), t.total(23, 1)], array[3, 2, 4]);
select t.as_user(t.u(88));
select t.expect_eq('the tablet lists each phone with its SESSION id (so a waiting phone is matched by session, not by name)', (select count(*) from jsonb_array_elements(public.lyst_state(t.m(1)) -> 'seats') s where (s ->> 'session_id')::uuid in (t.u(21), t.u(22), t.u(23)) and (s ->> 'device')::boolean), 3::bigint);
select t.expect_eq('... and each round tally names its operators (one so far per phone)', (select string_agg((s ->> 'name') || '=' || (s -> 'tallies' -> 0 -> 'operators' -> 0 ->> 'total'), ',' order by s ->> 'name') from jsonb_array_elements(public.lyst_state(t.m(1)) -> 'seats') s), 'Garrett=3,Joe=4,Nathan=2');
select t.expect_eq('nothing in the tablet''s state sums or averages the phones (no total across seats)', (public.lyst_state(t.m(1))::text ~* '"(sum|average|combined|consensus)'), false);
-- another phone cannot touch Garrett's tally
select t.as_device(t.u(22));
select t.expect_error('a phone cannot count on another phone''s place', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(21)), '42501');
select t.expect_error('... nor undo it', format('select public.counter_undo(gen_random_uuid(), %L, 1)', t.seatof(21)), '42501');
select t.expect_msg('... and the refusal speaks of the phone and the fight, never of a "seat"', format('select public.counter_undo(gen_random_uuid(), %L, 1)', t.seatof(21)), 'not counting on that fight');

-- ================================================================ 3. CHANGE COUNTER: the tally carries on, the turn closes, the frozen evidence names both
select t.as_device(t.u(21));
select t.expect_eq('Garrett hands the phone to Taylor: the same place on the Lyst, the tally still 3', (public.counter_set_operator('Taylor') ->> 'my_total'), '3');
select t.cr(21, 1, 2);                                 -- Taylor 2 → 5 on the phone
select t.as_admin();
select t.expect_eq('the phone''s tally is 5; Garrett''s turn is closed on this fight, Taylor''s is open on this fight', t.total(21, 1)::text || '|' || (select (ended_at is not null)::text || ':' || (match_id = t.m(1))::text from public.counter_operator_log where session_id = t.u(21) and operator_name = 'Garrett') || '|' || (select (ended_at is null)::text || ':' || (match_id = t.m(1))::text from public.counter_operator_log where session_id = t.u(21) and operator_name = 'Taylor'), '5|true:true|true:true');
select t.expect_eq('every tap keeps the name of the person who made it', (select string_agg(operator_name || ':' || weight, ',' order by created_at) from public.lyst_counts c where c.seat_id = t.seatof(21) and c.undo_of is null), 'Garrett:2,Garrett:1,Taylor:2');
select t.as_user(t.u(88));
select t.expect_eq('the tablet''s round tally for that phone reads Garrett 3 · Taylor 2 under the current holder', (select (s ->> 'name') || ':' || (select string_agg((o ->> 'name') || ' ' || (o ->> 'total'), ' · ') from jsonb_array_elements(s -> 'tallies' -> 0 -> 'operators') o) from jsonb_array_elements(public.lyst_state(t.m(1)) -> 'seats') s where (s ->> 'session_id')::uuid = t.u(21)), 'Taylor:Garrett 3 · Taylor 2');

-- ================================================================ 4. UNDO is per phone
select t.as_device(t.u(23));
select t.expect_eq('Joe undoes his last tap: 4 → 2 (a two-point tap), with his name on the undo', (public.counter_undo(gen_random_uuid(), t.seatof(23), 1) ->> 'total'), '2');
select t.as_admin();
select t.expect_eq('the undo row names Joe and reverses one of his taps; nobody else''s number moved', (select operator_name from public.lyst_counts where seat_id = t.seatof(23) and undo_of is not null) || '|' || t.total(21, 1) || '|' || t.total(22, 1), 'Joe|5|2');
select t.as_device(t.u(22));
select t.expect_eq('an undo with nothing left to undo answers "nothing"', (select (public.counter_undo(gen_random_uuid(), t.seatof(22), 1) ->> 'status') || ':' || (public.counter_undo(gen_random_uuid(), t.seatof(22), 1) ->> 'status')), 'ok:nothing');

-- ================================================================ 5. the marshal's call: the evidence frozen with it names each operator; the result never reads the phones
select t.expect_eq('the round ends (break)', t.tc(88, 'Field 1', 1, -1, 'start', 'break', 45000, 1) ->> 'status', 'ok');
select t.as_device(t.u(23));
select t.expect_msg('a tap after the round ended is refused (ROUND_ENDED)', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', t.seatof(23)), 'ROUND_ENDED');
select t.as_user(t.u(88));
select t.cmd() as conf \gset
select public.lyst_confirm_round(:'conf'::uuid, t.m(1), 1, 6, 5, t.round_rev(1, 1)) ->> 'status' as s1 \gset
select t.expect_eq('the marshal confirms 6-5 (phones said 5, 0 and 2: no relation)', :'s1'::text, 'ok');
select t.as_admin();
select t.expect_eq('the official round is the marshal''s 6-5', t.official(1, 1), '6-5');
select t.expect_eq('the frozen evidence keeps every phone with its holder AND the taps by each operator', (select string_agg((c ->> 'operator') || ':' || (c ->> 'total') || '[' || coalesce((select string_agg((o ->> 'name') || '=' || (o ->> 'total'), ',') from jsonb_array_elements(c -> 'operators') o), '') || ']', ' ' order by c ->> 'side', c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.id = :'conf'::uuid), 'Nathan:0[] Taylor:5[Garrett=3,Taylor=2] Joe:2[Joe=2]');
select t.expect_eq('the public round view carries no counter data', (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a where a.attrelid = 'public.lyst_public_state'::regclass and a.attnum > 0 and not a.attisdropped) !~* 'counter|seat|operator|session', true);

-- ================================================================ 6. FOLLOWING THE LYST: the next fight opens, the old places are closed for good, the turns move with the phones
select t.seatof(21) as old21 \gset
select t.seatof(23) as old23 \gset
select t.as_user(t.u(88));
select t.expect_eq('the Lyst opens the next fight (m4) on Field 1', public.lyst_open(t.m(4), 'weighted') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('all three phones follow to m4 at zero, same sides, same holders', (select string_agg(display_name || ':' || side, ',' order by side, display_name) from public.lyst_counter_seats where match_id = t.m(4) and status = 'active'), 'Nathan:a,Taylor:a,Joe:b');
select t.expect_eq('the old places are ended, their evidence kept', (select string_agg(status, ',') from public.lyst_counter_seats where id in (:'old21'::uuid, :'old23'::uuid)) || '|' || (select count(*) from public.lyst_counts where seat_id = :'old21'::uuid), 'ended,ended|3');
select t.expect_eq('each holder''s turn moved to the new fight: the m1 turn is closed, an m4 turn is open, same person', (select string_agg(operator_name || ':' || (match_id = t.m(4))::text, ',' order by operator_name) from public.counter_operator_log where event_id = t.e1() and ended_at is null) || '|' || (select count(*) from public.counter_operator_log where session_id = t.u(21) and operator_name = 'Taylor' and match_id = t.m(1) and ended_at is not null), 'Joe:true,Nathan:true,Taylor:true|1');
select t.expect_eq('round 1 of m4 starts', t.tc(88, 'Field 1', 4, -1, 'start', 'fight', 60000, 1) ->> 'status', 'ok');
select t.as_device(t.u(21));
select t.expect_msg('a STALE tap with the old place (the earlier fight) is refused: the phone is told to choose again, no "seat" word', format('select public.counter_record(gen_random_uuid(), %L, 1, 1)', :'old21'), 'not counting now');
select t.expect_msg('... a stale undo too', format('select public.counter_undo(gen_random_uuid(), %L, 1)', :'old21'), 'not counting now');
select t.expect_msg('... and a stale "done with round"', format('select public.counter_submit(%L, 1)', :'old21'), 'not counting now');
select t.as_admin();
select t.expect_eq('the refused stale tap changed nothing on either fight', (select count(*) from public.lyst_counts where match_id = t.m(4)) || '|' || (select count(*) from public.lyst_counts where seat_id = :'old21'::uuid), '0|3');
select t.as_device(t.u(21));
select t.expect_eq('the phone counts on the new fight from zero with its new place', (public.counter_record(gen_random_uuid(), t.seatof(21), 1, 2) ->> 'total'), '2');
select t.expect_error('a tap for a round that is not the live one (round 2 before it exists) is refused', format('select public.counter_record(gen_random_uuid(), %L, 2, 1)', t.seatof(21)), 'P0001');
select t.as_admin();

-- ================================================================ 7. ONE CURRENT FIGHT per Lyst
select t.as_user(t.u(86));   -- a second scorekeeper's tablet
select t.expect_msg('while m4 is IN A ROUND, another tablet cannot open a different fight on Lyst 1 (end the round there first)', format('select public.lyst_open(%L)', t.m(5)), 'Lyst 1 is still in round 1 of Fighter 5 vs Fighter 6');
select t.as_admin();
select t.expect_eq('Lyst 1 still runs m4; the phones did not move', (private.field_current_match(t.e1(), 'field 1') = t.m(4))::text || '|' || (select count(*) from public.lyst_counter_seats where match_id = t.m(4) and status = 'active'), 'true|3');
select t.expect_eq('the field has exactly one current-fight row', (select count(*) from public.lyst_field_current where event_id = t.e1() and field_key = 'field 1'), 1::bigint);
select t.expect_eq('opening the fight that is already on is a no-op (idempotent, no error)', (select public.lyst_open(t.m(4), 'weighted') ->> 'status' from (select t.as_user(t.u(86))) x), 'ok');
select t.as_admin();
-- the round ends and is confirmed; now the Lyst may move on
select t.expect_eq('m4 round 1 ends', t.tc(88, 'Field 1', 4, -1, 'start', 'break', 45000, 1) ->> 'status', 'ok');
select t.as_user(t.u(88)); select public.lyst_confirm_round(gen_random_uuid(), t.m(4), 1, 2, 0, t.round_rev(4, 1));
select t.as_user(t.u(86));
select t.expect_eq('between rounds, the second tablet opens m5 on Lyst 1: allowed, the phones follow', public.lyst_open(t.m(5), 'weighted') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('Lyst 1 now runs m5; three phones on it', (private.field_current_match(t.e1(), 'field 1') = t.m(5))::text || '|' || (select count(*) from public.lyst_counter_seats where match_id = t.m(5) and status = 'active'), 'true|3');
-- the first tablet is still on m4 and touches its clock (the clock row still names m4): it may not pull the phones back
select t.expect_msg('a tablet left on the earlier fight cannot pull the Lyst back with its clock: it is told the Lyst has moved on', $$select t.tc(88, 'Field 1', 4, -1, 'start', 'fight', 60000, 2)$$, 'Lyst 1 has moved on to Fighter 6 vs Fighter 5');
select t.expect_eq('... Lyst 1 still runs m5, the phones are still on m5, and m4 has no round 2', (private.field_current_match(t.e1(), 'field 1') = t.m(5))::text || '|' || (select count(*) from public.lyst_counter_seats where match_id = t.m(5) and status = 'active') || '|' || (select count(*) from public.lyst_rounds where match_id = t.m(4) and round_no = 2), 'true|3|0');
select t.expect_eq('the tablet on m5 starts its round 1: the clock follows the Lyst''s current fight', t.tc(86, 'Field 1', 5, -1, 'start', 'fight', 60000, 1) ->> 'status', 'ok');
select t.expect_eq('the phones can count on m5', (t.cr(23, 1, 2) ->> 'total'), '2');
select t.expect_eq('the trigger and the claim helper are private', (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('lyst_field_claim', 'lyst_seat_operators', 'counter_log_operator') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('bos_event_device', p.oid, 'execute'))), 0::bigint);

-- ================================================================ 8. a trainee's account id never reaches the tablet's state; the server's counter words
select t.as_user(t.u(88));
select public.create_lyst_join_code(t.e1(), 'Field 1') ->> 'code' as code1 \gset
select t.as_user(t.u(25));
select t.expect_eq('a trainee joins Lyst 1 with the training code', public.join_training_counter(:'code1', 'Elm', 'a') ->> 'status', 'ok');
select t.as_user(t.u(88));
select t.expect_eq('the tablet lists the trainee as learning with NO session id (an account is not a device)', (select (s ->> 'role') || ':' || coalesce(s ->> 'session_id', 'null') || ':' || (s ->> 'device') from jsonb_array_elements(public.lyst_state(t.m(5)) -> 'seats') s where s ->> 'name' = 'Elm'), 'learning:null:false');
select t.expect_eq('... and the trainee''s account id appears nowhere in it', position(t.u(25)::text in public.lyst_state(t.m(5))::text), 0);
select t.as_admin();
select t.expect_eq('no counter refusal the server raises says "seat"', (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname in ('lyst_seat_for_counting', 'counter_record', 'counter_undo', 'counter_submit', 'counter_bind', 'counter_set_operator', 'counter_leave') and p.prosrc ~* 'raise exception ''[^'']*seat'), 0::bigint);
select t.expect_eq('the device allowlist gained nothing: no new public function is callable by a counter phone beyond Pack 25''s', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('bos_event_device', p.oid, 'execute') and p.proname in ('lyst_field_claim', 'lyst_seat_operators')), 0::bigint);


-- ================================================================ 9. Pack 27B: TRAINING COUNTERS. A second reusable pool (training): no account, no approval; learning seats only; kept out of the official evidence
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot make the Training Counter QR', format($$select public.create_event_credential(%L, 'counter_pool', null, 'counter', %L, null, 'TRANQR234567', true)$$, t.e1(), t.h(60)), '42501');
select t.as_user(t.u(90));
select t.expect_eq('the organizer makes the event''s Training Counter QR (a counter pool marked training, labelled by default)', (public.create_event_credential(t.e1(), 'counter_pool', null, 'counter', t.h(60), null, 'TRANQR234567', true) ->> 'label'), 'Training Counter QR');
select t.as_admin();
select t.expect_eq('... stored as a training pool', (select training::text from public.event_credentials where code_hash = t.h(60)), 'true');
select t.as_user(t.u(90));
select t.expect_error('one Training Counter QR per event (the Counter QR is a separate one and still there)', format($$select public.create_event_credential(%L, 'counter_pool', null, 'counter', %L, null, 'TRANQR234568', true)$$, t.e1(), t.h(61)), '22023');
select t.as_admin();
select t.expect_eq('... both pools are open side by side', (select count(*) from public.event_credentials where event_id = t.e1() and kind = 'counter_pool' and revoked_at is null), 2::bigint);
select t.as_user(t.u(90));
select t.expect_error('only a pool can be a training credential', format($$select public.create_event_credential(%L, 'device', 'Phone X', 'marshal', %L, null, null, true)$$, t.e1(), t.h(62)), '22023');
select t.as_user(t.u(88));
select t.expect_eq('the scorekeeper shows the Training Counter QR (and the Counter QR is still the Counter QR)', (public.counter_pool_code(t.e1(), true) ->> 'code') || '|' || (public.counter_pool_code(t.e1(), true) ->> 'training') || '|' || (public.counter_pool_code(t.e1()) ->> 'code') || '|' || (public.counter_pool_code(t.e1()) ->> 'training'), 'TRANQR234567|true|ABCDEFGH2345|false');
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot show it', format('select public.counter_pool_code(%L, true)', t.e1()), '42501');
select t.as_admin();
-- two learners scan the Training Counter QR: sessions of their own, no account anywhere
insert into t.ph select n, t.open(60, 'ip-t' || n, 70 + n) from generate_series(27, 28) n;
select t.expect_eq('two phones scan the Training QR: two more open counter sessions, the official phones untouched', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.event_id = t.e1() and c.kind = 'counter_pool' and s.ended_at is null), 5::bigint);
select t.as_device(t.u(27));
select t.expect_eq('a training phone knows it is one from its first call', (public.device_whoami() ->> 'training') || '|' || (public.device_whoami() ->> 'role') || '|' || (public.counter_state() ->> 'training'), 'true|counter|true');
select t.expect_eq('it binds like any counter (name, Lyst, side) and is seated at once: as LEARNING, on the fight the Lyst has open (m5), red', (public.counter_bind('Field 1', 'a', 'Learner Lee') -> 'seat' ->> 'role') || '|' || (public.counter_state() -> 'seat' ->> 'match_id') || '|' || (public.counter_state() -> 'seat' ->> 'side'), 'learning|' || t.m(5)::text || '|a');
select t.as_device(t.u(28)); select public.counter_bind('Field 1', 'b', 'Learner Max');
select t.as_device(t.u(27));
select t.expect_eq('the learner counts along: their own tally, round 1 of m5', (public.counter_record(gen_random_uuid(), t.seatof(27), 1, 2) ->> 'total'), '2');
select t.cr(21, 1, 2); select t.cr(21, 1, 1);   -- Taylor (official, red) 3 on m5 round 1; Nathan (official, red) 0; Joe (blue) 2
select t.as_device(t.u(27));
select t.expect_eq('the learner''s screen compares against the OFFICIAL counters of the same side, one line each, never a combined number', (select string_agg((o ->> 'name') || '=' || (o ->> 'total'), ',' order by o ->> 'name') from jsonb_array_elements(public.counter_state() -> 'officials') o), 'Nathan=0,Taylor=3');
select t.expect_eq('... and nothing else of theirs: no seat ids, no other learners', (public.counter_state() -> 'officials')::text !~* 'seat|user|session|Max', true);
select t.as_device(t.u(21));
select t.expect_eq('an official phone gets no comparison list (it must not count by another counter''s number)', (public.counter_state() ->> 'officials') is null and (public.counter_state() ->> 'training') = 'false', true);
select t.as_device(t.u(27));
select t.expect_error('a training phone has no staff authority either', format('select public.lyst_state(%L)', t.m(5)), '42501');
select t.expect_error('... cannot show the Lyst tablet''s state of another phone', format('select public.device_session_preview(%L)', t.u(21)), '42501');
select t.as_user(t.u(88));
select t.expect_eq('the tablet lists the learners APART as learning, with their sessions', (select string_agg((s ->> 'name') || ':' || (s ->> 'role') || ':' || ((s ->> 'session_id') is not null)::text, ',' order by s ->> 'name') from jsonb_array_elements(public.lyst_state(t.m(5)) -> 'seats') s where s ->> 'role' = 'learning'), 'Elm:learning:false,Learner Lee:learning:true,Learner Max:learning:true');
-- the marshal's call: the official evidence frozen with it holds OFFICIAL counters only
select t.expect_eq('m5 round 1 ends', t.tc(86, 'Field 1', 5, -1, 'start', 'break', 45000, 1) ->> 'status', 'ok');
select t.as_user(t.u(88));
select t.cmd() as conf5 \gset
select public.lyst_confirm_round(:'conf5'::uuid, t.m(5), 1, 4, 2, t.round_rev(5, 1)) ->> 'status' as s5 \gset
select t.expect_eq('the marshal confirms 4-2', :'s5'::text, 'ok');
select t.as_admin();
select t.expect_eq('the frozen evidence names the official phones only; the learners'' practice is not official evidence', (select string_agg((c ->> 'operator') || ':' || (c ->> 'role'), ',' order by c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.id = :'conf5'::uuid), 'Joe:official,Nathan:official,Taylor:official');
select t.expect_eq('... the learners'' taps are still there as practice rows (nothing deleted), on learning seats', (select count(*) from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.role = 'learning' and c.match_id = t.m(5)), 1::bigint);
select t.expect_eq('the official score is the marshal''s', t.official(5, 1), '4-2');
-- a training phone changes Lyst, follows the next fight and is moved by staff: learning every time
select t.as_user(t.u(88)); select public.lyst_open(t.m(4), 'weighted');
select t.as_admin();
select t.expect_eq('on the next fight the learners followed as LEARNING, the officials as official', (select string_agg(x.role || ':' || x.n, ',' order by x.role) from (select role, count(*)::text as n from public.lyst_counter_seats where match_id = t.m(4) and status = 'active' group by role) x), 'learning:3,official:3');
select t.as_device(t.u(27));
select t.expect_eq('a learner changes to Lyst 2 blue: a learning seat there', (public.counter_bind('Field 2', 'b', 'Learner Lee') -> 'seat' ->> 'role'), 'learning');
select t.as_user(t.u(88));
select t.expect_eq('staff move the learner back to Lyst 1 red: still learning', (public.move_counter_session(t.u(27), 'Field 1', 'a') -> 'seat' ->> 'role'), 'learning');
select t.as_admin();
select t.expect_eq('a training session never held an official seat', (select count(*) from public.lyst_counter_seats where user_id in (t.u(27), t.u(28)) and role = 'official'), 0::bigint);
select t.expect_eq('the helpers are private; the device allow-list gained nothing but the two-argument counter_pool_code', (select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'counter_training' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('bos_event_device', p.oid, 'execute'))), 0::bigint);
select t.as_anon();
select t.expect_error('anon cannot read the credentials (the training flag included)', 'select training from public.event_credentials', '42501');
select t.as_admin();

select format('PACK27 GATE PASSED %s checks', count(*)) from t.log \gset
\echo :format
rollback;
