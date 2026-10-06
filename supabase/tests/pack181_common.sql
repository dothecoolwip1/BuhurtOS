-- Pack 18.1 shared gate prelude + fixture (\i-ed by pack181_*_gate.sql INSIDE their transaction; everything is rolled back).
--   helpers  t.as_anon / as_user / as_device / as_ctrl / as_sub / as_admin, expect_error / expect_ok / expect_ok_undo / expect_eq
--   world    two events, staff of every kind, a platform owner, a fighter, matches; credentials + OPEN sessions for the eight example devices
--            (Counter Phone 1-4, Secretary / Scorekeeper Tablet, Marshal Phone, Announcer Tablet, Event Admin Tablet) and the stream controller on
--            event 1, and a Counter and a Marshal device on event 2.
create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
-- a device / controller token: the role in the JWT is the custom database role, `sub` is the SESSION id (not a person)
create function t.as_device(s uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', s::text, true); set local role bos_event_device; end $$;
create function t.as_ctrl(s uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', s::text, true); set local role bos_controller; end $$;
-- evaluate private helpers for a given caller while keeping superuser rights (they are not executable by the API roles)
create function t.as_sub(s uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', coalesce(s::text, ''), true); end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin execute stmt; insert into t.log (name) values (label); end $$;
create function t.expect_ok_undo(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; raise exception 'undo' using errcode = 'P0042'; exception when sqlstate 'P0042' then null; end;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c181' || n, 12, '0'))::uuid $$;
create function t.ev(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('e181' || n, 12, '0'))::uuid $$;
create function t.comp(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c18c' || n, 12, '0'))::uuid $$;
create function t.en(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b181' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('d181' || n, 12, '0'))::uuid $$;
create function t.h(n int) returns bytea language sql immutable as $$ select decode(repeat(lpad(to_hex(n), 2, '0'), 32), 'hex') $$;          -- a code verifier
create function t.sh(n int) returns bytea language sql immutable as $$ select decode(repeat(lpad(to_hex(n + 128), 2, '0'), 32), 'hex') $$;    -- a session secret hash
create table t.s (name text primary key, sid uuid, cred uuid, code int);
create function t.sid(n text) returns uuid language sql stable as $$ select sid from t.s where name = n $$;
create function t.cred(n text) returns uuid language sql stable as $$ select cred from t.s where name = n $$;
-- the Edge Function's door: open a session for a code (n) with secret (n); returns the session id or null
create function t.open(code int, ip text default 'ip-x', sec int default null) returns uuid language sql as $$ select (public.device_open_session(t.h(code), t.sh(coalesce(sec, code)), ip) ->> 'session_id')::uuid $$;
grant usage on schema t to anon, authenticated, service_role, bos_event_device, bos_controller;
grant all on t.log to anon, authenticated, service_role, bos_event_device, bos_controller;
grant select on t.s to anon, authenticated, service_role, bos_event_device, bos_controller;
grant usage on all sequences in schema t to anon, authenticated, service_role, bos_event_device, bos_controller;
grant execute on all functions in schema t to anon, authenticated, service_role, bos_event_device, bos_controller;

-- ---------------------------------------------------------------- the world
-- u1 organizer E1; u2 head marshal E1; u3 marshal E1; u4 scorekeeper E1; u5 announcer (staff) E1; u6 medic E1; u7 check-in E1; u8 inspector E1;
-- u9 fighter (account); u10 stranger; u11 organizer E2; u12 platform owner; u13 head marshal E2.
insert into auth.users (id, email) select t.u(n), 'p181u' || n || '@example.test' from generate_series(1, 13) n;
update public.profiles set display_name = 'Person ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 13) n);
insert into public.platform_roles (user_id, role) values (t.u(12), 'owner');
insert into public.events (id, slug, name, status, starts_on, ends_on, timezone) values
  (t.ev(1), 'p181-e1', 'Rumble Rehearsal', 'published', current_date, current_date, 'America/Edmonton'),
  (t.ev(2), 'p181-e2', 'Elsewhere Cup', 'published', current_date, current_date, 'America/Edmonton');
insert into public.event_staff (event_id, user_id, role) values
  (t.ev(1), t.u(1), 'organizer'), (t.ev(1), t.u(2), 'head_marshal'), (t.ev(1), t.u(3), 'marshal'), (t.ev(1), t.u(4), 'scorekeeper'),
  (t.ev(1), t.u(5), 'announcer'), (t.ev(1), t.u(6), 'medic'), (t.ev(1), t.u(7), 'check_in'), (t.ev(1), t.u(8), 'inspector'),
  (t.ev(2), t.u(11), 'organizer'), (t.ev(2), t.u(13), 'head_marshal');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  (t.comp(1), t.ev(1), 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.comp(2), t.ev(2), 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1);
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-' || lpad('f181' || n, 12, '0'))::uuid, 'Fighter ' || n, 'male', '{}' from generate_series(1, 8) n;
insert into public.fighter_accounts (fighter_id, user_id) values (('00000000-0000-0000-0000-' || lpad('f1811', 12, '0'))::uuid, t.u(9));
insert into public.entries (id, competition_id, fighter_id) select t.en(n), case when n <= 6 then t.comp(1) else t.comp(2) end, ('00000000-0000-0000-0000-' || lpad('f181' || n, 12, '0'))::uuid from generate_series(1, 8) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(1), t.comp(1), 'round_robin', 'Round 1', 0, t.en(1), t.en(2), 'scheduled', 'Field 1'),
  (t.m(2), t.comp(1), 'round_robin', 'Round 1', 1, t.en(3), t.en(4), 'scheduled', 'Field 1'),
  (t.m(3), t.comp(1), 'round_robin', 'Round 1', 2, t.en(5), t.en(6), 'scheduled', 'Field 2'),
  (t.m(4), t.comp(2), 'round_robin', 'Round 1', 0, t.en(7), t.en(8), 'scheduled', 'Field 1');
insert into public.results (competition_id, entry_id, final_place, points) values (t.comp(1), t.en(5), 1, 10), (t.comp(1), t.en(6), 2, 6);

-- credentials, created by the event's permanent organizer through the real function; sessions opened through the Edge Function's door
select t.as_user(t.u(1));
select public.create_event_credential(t.ev(1), 'device', n.label, n.role, t.h(n.code)) from (values
  (1, 'Counter Phone 1', 'counter'), (2, 'Counter Phone 2', 'counter'), (3, 'Counter Phone 3', 'counter'), (4, 'Counter Phone 4', 'counter'),
  (5, 'Secretary Tablet', 'scorekeeper'), (6, 'Marshal Phone', 'marshal'), (7, 'Announcer Tablet', 'announcer'), (8, 'Event Admin Tablet', 'temporary_organizer')) n(code, label, role);
select public.create_event_credential(t.ev(1), 'controller', 'Stream Laptop', 'broadcast_controller', t.h(9));
select t.as_user(t.u(11));
select public.create_event_credential(t.ev(2), 'device', 'E2 Counter', 'counter', t.h(10));
select public.create_event_credential(t.ev(2), 'device', 'E2 Marshal', 'marshal', t.h(11));
select t.as_admin();
insert into t.s (name, code) values ('counter1', 1), ('counter2', 2), ('counter3', 3), ('counter4', 4), ('secretary', 5), ('marshal', 6), ('announcer', 7), ('admin', 8), ('controller', 9), ('e2counter', 10), ('e2marshal', 11);
update t.s set sid = t.open(code), cred = (select id from public.event_credentials where code_hash = t.h(code));
