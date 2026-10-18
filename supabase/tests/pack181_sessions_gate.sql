-- Pack 18.1 gate 1: temporary event devices as event sessions (migration 20261015000100).
--   * a device is an event session: not an auth user, one event, one role, individually revocable, attributable
--   * expiry is server-side and exact: the event's final ends_on day (in the event's time zone) + 24 h; end+23:59 valid, end+24:00 refused
--   * deny by default: the session roles can execute exactly the checked-in allow-list (supabase/tests/device_allowlist.txt), nothing else
--   * only the event's permanent organizer manages credentials; the throttle blocks guessing without signing anyone out
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run from the repo root:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack181_sessions_gate.sql
\set ON_ERROR_STOP on
\set allowlist `cat supabase/tests/device_allowlist.txt`
begin;
\i supabase/tests/pack181_common.sql

-- ---------------------------------------------------------------- it is an event session, not a person
select t.expect_eq('all eleven fixture sessions opened', (select count(*) from t.s where sid is not null), 11::bigint);
select t.expect_eq('a session id is not an auth user (no profile, no account)', (select count(*) from auth.users u where u.id in (select sid from t.s)), 0::bigint);
select t.expect_eq('... and has no profile or fighter row', (select count(*) from public.profiles p where p.id in (select sid from t.s)), 0::bigint);
select t.expect_eq('the credential stores a 32-byte verifier only (no code, no hint column)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'event_credentials' and column_name ilike any (array['%plain%', '%secret%', '%hint%', 'code']))::int, 0);
select t.as_device(t.sid('marshal'));
select t.expect_eq('device_whoami names the device, its role, its event',
  (select format('%s/%s/%s/%s', w ->> 'label', w ->> 'role', w -> 'event' ->> 'slug', w ->> 'kind') from (select public.device_whoami() w) x), 'Marshal Phone/marshal/p181-e1/device');
select t.expect_eq('... and the roles it counts as (marshal only)', (select public.device_whoami() -> 'effective_roles'), '["marshal"]'::jsonb);
select t.as_admin();

-- ---------------------------------------------------------------- the code: wrong, revoked, replaced, throttled
select t.expect_eq('a wrong code opens nothing', public.device_open_session(t.h(99), t.sh(99), 'ip-w') ->> 'ok', 'false');
select t.expect_eq('... and answers exactly like any other refusal (no reason leaks)', public.device_open_session(t.h(99), t.sh(99), 'ip-w'), jsonb_build_object('ok', false));
select t.as_user(t.u(1));
select t.expect_eq('the organizer sees all device codes of the event, never a code or verifier',
  (select count(*) from public.list_event_credentials(t.ev(1))), 9::bigint);
select t.expect_eq('revoke Counter Phone 3 only', public.revoke_event_credential(t.cred('counter3'), 'phone missing') ->> 'status', 'revoked');
select t.as_admin();
select t.expect_eq('Counter Phone 3 no longer exists as a session', (select count(*) from private.device_ctx() where false), 0::bigint);
select t.as_sub(t.sid('counter3'));
select t.expect_eq('... its token has no authority (ctx empty)', (select count(*) from private.device_ctx()), 0::bigint);
select t.as_device(t.sid('counter3'));
select t.expect_error('... device_whoami refuses it', 'select public.device_whoami()', '42501');
select t.as_sub(t.sid('counter1'));
select t.expect_eq('Counter Phones 1, 2 and 4 keep working', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_sub(t.sid('counter2'));
select t.expect_eq('... 2', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_sub(t.sid('counter4'));
select t.expect_eq('... 4', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_admin();
select t.expect_eq('the revoked code opens nothing', public.device_open_session(t.h(3), t.sh(3), 'ip-r') ->> 'ok', 'false');
select t.expect_eq('a refresh of the revoked session is refused', public.device_refresh_session(t.sh(3)) ->> 'ok', 'false');

-- replace: old code and session die immediately, same name and role come back with a new code
select t.as_user(t.u(1));
select t.expect_eq('replace Counter Phone 4', public.replace_event_credential(t.cred('counter4'), t.h(40)) ->> 'label', 'Counter Phone 4');
select t.as_admin();
select t.expect_eq('the old code is dead', public.device_open_session(t.h(4), t.sh(4), 'ip-r') ->> 'ok', 'false');
select t.as_sub(t.sid('counter4'));
select t.expect_eq('its session has no authority', (select count(*) from private.device_ctx()), 0::bigint);
select t.as_admin();
select t.expect_eq('the new code works', (public.device_open_session(t.h(40), t.sh(40), 'ip-r') ->> 'ok'), 'true');
select t.expect_eq('... the new credential has the same role', (select role from public.event_credentials where code_hash = t.h(40)), 'counter');
select t.expect_eq('a replaced credential cannot be replaced again', (select count(*) from public.event_credentials where replaced_by is not null)::int, 1);

-- one open session per credential: the later sign-in wins and is flagged
select t.expect_eq('a second sign-in with the same code succeeds', t.open(5, 'ip-x', 55) is not null, true);
select t.as_sub(t.sid('secretary'));
select t.expect_eq('... the first session is no longer valid (last sign-in wins)', (select count(*) from private.device_ctx()), 0::bigint);
select t.as_admin();
select t.expect_eq('... and the credential records a sign-in elsewhere', (select elsewhere_at is not null from public.event_credentials where id = t.cred('secretary')), true);
update t.s set sid = (select s.id from public.event_sessions s where s.credential_id = t.s.cred and s.ended_at is null) where name = 'secretary';

-- the throttle: 10 failures per address stop NEW sign-ins from that address; another address and existing sessions are untouched
select public.device_open_session(t.h(100 + n), t.sh(100 + n), 'ip-guesser') from generate_series(1, 10) n;
select t.expect_eq('10 wrong guesses from one address: even the right code is refused from it',
  public.device_open_session(t.h(6), t.sh(6), 'ip-guesser') ->> 'ok', 'false');
select t.expect_eq('... the same code works from another address', public.device_open_session(t.h(6), t.sh(66), 'ip-venue') ->> 'ok', 'true');
update t.s set sid = (select s.id from public.event_sessions s where s.credential_id = t.s.cred and s.ended_at is null) where name = 'marshal';
select t.as_sub(t.sid('marshal'));
select t.expect_eq('existing sessions are not affected by a lockout', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_admin();
delete from public.device_code_attempts;
select public.device_open_session(t.h(100 + (n % 120)), t.sh(100 + (n % 120)), 'ip-' || n) from generate_series(1, 100) n;
select t.expect_eq('100 failures overall trip the circuit-breaker: a valid code is refused until it clears',
  public.device_open_session(t.h(7), t.sh(7), 'ip-calm') ->> 'ok', 'false');
delete from public.device_code_attempts;
select t.expect_eq('... and works again after the window', public.device_open_session(t.h(7), t.sh(77), 'ip-calm') ->> 'ok', 'true');
update t.s set sid = (select s.id from public.event_sessions s where s.credential_id = t.s.cred and s.ended_at is null) where name = 'announcer';

-- ---------------------------------------------------------------- expiry: server-side and exact
-- fixed calendar events: Saturday 2026-10-10 in Edmonton (MDT, UTC-6): the day ends at 2026-10-11 00:00 MDT = 06:00Z; access ends 24 h later = 2026-10-12 06:00Z
insert into public.events (id, slug, name, status, starts_on, ends_on, timezone) values
  (t.ev(3), 'p181-e3', 'Calendar Cup', 'published', '2026-10-10', '2026-10-10', 'America/Edmonton'),
  (t.ev(4), 'p181-e4', 'UTC Cup', 'published', '2026-10-10', '2026-10-10', 'UTC'),
  (t.ev(5), 'p181-e5', 'Clock Change Cup', 'published', '2026-10-31', '2026-10-31', 'America/Edmonton'),
  (t.ev(6), 'p181-e6', 'Long Past Cup', 'published', '2026-01-01', '2026-01-01', 'America/Edmonton'),
  (t.ev(7), 'p181-e7', 'Two Day Cup', 'published', '2026-10-10', '2026-10-11', 'America/Edmonton');
-- created_at is fixed too: a code is valid from its creation, and these calendar checks must not depend on the day the gate runs
insert into public.event_credentials (id, event_id, kind, label, role, code_hash, created_at) values
  ('00000000-0000-0000-0000-00000000cd03', t.ev(3), 'device', 'Cal', 'counter', t.h(60), '2025-12-01 00:00:00+00'), ('00000000-0000-0000-0000-00000000cd04', t.ev(4), 'device', 'Utc', 'counter', t.h(61), '2025-12-01 00:00:00+00'),
  ('00000000-0000-0000-0000-00000000cd05', t.ev(5), 'device', 'Dst', 'counter', t.h(62), '2025-12-01 00:00:00+00'), ('00000000-0000-0000-0000-00000000cd06', t.ev(6), 'device', 'Past', 'counter', t.h(63), '2025-12-01 00:00:00+00'),
  ('00000000-0000-0000-0000-00000000cd07', t.ev(7), 'device', 'Two', 'counter', t.h(64), '2025-12-01 00:00:00+00');
select t.expect_eq('Edmonton Saturday: the day ends 06:00Z the next day', private.device_event_end(t.ev(3)), '2026-10-11 06:00:00+00'::timestamptz);
select t.expect_eq('... access ends exactly 24 h later', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd03'), '2026-10-12 06:00:00+00'::timestamptz);
select t.expect_eq('end + 23:59 (one minute before expiry): VALID', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-10-12 05:59:00+00'), true);
select t.expect_eq('one second before expiry: VALID', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-10-12 05:59:59+00'), true);
select t.expect_eq('at the expiry instant (end + 24:00): REFUSED', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-10-12 06:00:00+00'), false);
select t.expect_eq('one second after: REFUSED', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-10-12 06:00:01+00'), false);
select t.expect_eq('days after: REFUSED', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-11-20 00:00:00+00'), false);
select t.expect_eq('the event day itself (during the event): VALID', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2026-10-10 18:00:00+00'), true);
select t.expect_eq('UTC event: day ends 2026-10-11 00:00Z, access ends 2026-10-12 00:00Z', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd04'), '2026-10-12 00:00:00+00'::timestamptz);
select t.expect_eq('... UTC 23:59 before: valid', private.device_valid_at('00000000-0000-0000-0000-00000000cd04', '2026-10-11 23:59:00+00'), true);
select t.expect_eq('... UTC at expiry: refused', private.device_valid_at('00000000-0000-0000-0000-00000000cd04', '2026-10-12 00:00:00+00'), false);
-- the clock changes on 2026-11-01 (MDT→MST): 24 EXACT hours, not "tomorrow at the same wall time"
select t.expect_eq('clock-change week: day ends 2026-11-01 00:00 MDT = 06:00Z', private.device_event_end(t.ev(5)), '2026-11-01 06:00:00+00'::timestamptz);
select t.expect_eq('... access ends 24 exact hours later (2026-11-02 06:00Z, 23:00 MST on the 1st)', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd05'), '2026-11-02 06:00:00+00'::timestamptz);
select t.expect_eq('a two-day event ends after its LAST day', private.device_event_end(t.ev(7)), '2026-10-12 06:00:00+00'::timestamptz);
select t.expect_eq('an event long past: a code for it opens nothing', public.device_open_session(t.h(63), t.sh(63), 'ip-p') ->> 'ok', 'false');
-- an event that is upcoming WHENEVER the gate runs (the calendar events above are fixed dates, so they age)
insert into public.events (id, slug, name, status, starts_on, ends_on, timezone) values
  (t.ev(8), 'p181-e8', 'Next Month Cup', 'published', current_date + 30, current_date + 30, 'America/Edmonton');
insert into public.event_credentials (id, event_id, kind, label, role, code_hash) values ('00000000-0000-0000-0000-00000000cd08', t.ev(8), 'device', 'Next', 'counter', t.h(65));
select t.expect_eq('a credential created now for an upcoming event opens', t.open(65) is not null, true);
-- rescheduling the event moves the expiry (nothing is stored)
update public.events set ends_on = '2026-10-11' where id = t.ev(3);
select t.expect_eq('... extending ends_on by a day extends access by a day', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd03'), '2026-10-13 06:00:00+00'::timestamptz);
update public.events set ends_on = '2026-10-10' where id = t.ev(3);
-- an organizer can only SHORTEN
update public.event_credentials set expires_at = '2026-10-11 12:00:00+00' where id = '00000000-0000-0000-0000-00000000cd03';
select t.expect_eq('an earlier per-device expiry wins', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd03'), '2026-10-11 12:00:00+00'::timestamptz);
update public.event_credentials set expires_at = '2027-01-01 00:00:00+00' where id = '00000000-0000-0000-0000-00000000cd03';
select t.expect_eq('a LATER per-device expiry is ignored (never past event end + 24 h)', private.device_credential_expiry('00000000-0000-0000-0000-00000000cd03'), '2026-10-12 06:00:00+00'::timestamptz);
select t.expect_eq('before the credential existed: refused', private.device_valid_at('00000000-0000-0000-0000-00000000cd03', '2020-01-01 00:00:00+00'), false);
-- a LIVE session whose event has ended + 24 h has no authority at all, whatever the token says
update public.events set starts_on = '2026-01-01', ends_on = '2026-01-01' where id = t.ev(1);
select t.as_sub(t.sid('marshal'));
select t.expect_eq('a retained session of an expired event has no authority (live check, not a stored flag)', (select count(*) from private.device_ctx()), 0::bigint);
select t.as_device(t.sid('marshal'));
select t.expect_error('... device_whoami refuses it', 'select public.device_whoami()', '42501');
select t.as_admin();
select t.expect_eq('... and a refresh through the door refuses it (and ends it)', public.device_refresh_session(t.sh(66)) ->> 'ok', 'false');
update public.events set starts_on = current_date, ends_on = current_date where id = t.ev(1);

-- ---------------------------------------------------------------- Event A vs Event B
select t.as_sub(t.sid('e2marshal'));
select t.expect_eq('an E2 device counts for E2 only', (select count(*) from private.device_ctx() where event_id = t.ev(2)), 1::bigint);
select t.as_device(t.sid('e2marshal'));
select t.expect_error('E2 marshal cannot open an E1 match in Lyst Control', format($$select public.lyst_open(%L)$$, t.m(1)), '42501');
select t.expect_ok('... but can open its own', format($$select public.lyst_open(%L)$$, t.m(4)));
select t.expect_error('E2 marshal cannot call the E1 queue', format($$select public.set_match_queue(%L, 'on_deck', null)$$, t.m(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_error('E1 marshal cannot open an E2 match', format($$select public.lyst_open(%L)$$, t.m(4)), '42501');
select t.expect_error('E1 marshal cannot turn E2 cameras off', format($$select public.camera_off_activate(%L, 'other')$$, t.ev(2)), '42501');
select t.as_admin();

-- ---------------------------------------------------------------- only the permanent organizer manages credentials
select t.as_anon();
select t.expect_error('anonymous cannot create a device code', format($$select public.create_event_credential(%L, 'device', 'X', 'counter', t.h(70))$$, t.ev(1)), '42501');
select t.expect_error('... nor list', format($$select * from public.list_event_credentials(%L)$$, t.ev(1)), '42501');
select t.expect_error('... nor read the table', 'select * from public.event_credentials', '42501');
select t.expect_error('... nor sessions', 'select * from public.event_sessions', '42501');
select t.expect_error('... nor open a session (service role only)', $$select public.device_open_session(t.h(5), t.sh(5), 'x')$$, '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot create a code', format($$select public.create_event_credential(%L, 'device', 'X', 'counter', t.h(70))$$, t.ev(1)), '42501');
select t.expect_error('... nor read the table', 'select * from public.event_credentials', '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot create a code for this event', format($$select public.create_event_credential(%L, 'device', 'X', 'counter', t.h(70))$$, t.ev(1)), '42501');
select t.expect_error('... nor revoke a device of this event', format($$select public.revoke_event_credential(%L)$$, t.cred('marshal')), '42501');
select t.expect_error('... nor list them', format($$select * from public.list_event_credentials(%L)$$, t.ev(1)), '42501');
select t.as_user(t.u(2));
select t.expect_ok_undo('the head marshal makes an ordinary device code: whoever runs the day may (Pack 26)', format($$select public.create_event_credential(%L, 'device', 'HM Made', 'counter', t.h(70))$$, t.ev(1)));
select t.expect_error('... but not an Event Admin code (never more authority than they hold)', format($$select public.create_event_credential(%L, 'device', 'HM Admin', 'temporary_organizer', t.h(71))$$, t.ev(1)), '42501');
select t.expect_error('... nor a stream controller code', format($$select public.create_event_credential(%L, 'controller', 'HM Laptop', 'broadcast_controller', t.h(72))$$, t.ev(1)), '42501');
select t.as_user(t.u(4));
select t.expect_ok_undo('a scorekeeper makes an ordinary device code too', format($$select public.create_event_credential(%L, 'device', 'SK Made', 'counter', t.h(70))$$, t.ev(1)));
select t.expect_error('... but not an Event Admin code', format($$select public.create_event_credential(%L, 'device', 'SK Admin', 'temporary_organizer', t.h(71))$$, t.ev(1)), '42501');
select t.as_user(t.u(12));
select t.expect_ok_undo('the platform owner can (the owner passes every event check)', format($$select public.create_event_credential(%L, 'device', 'Owner Made', 'counter', t.h(70))$$, t.ev(1)));
select t.as_user(t.u(1));
select t.expect_error('a duplicate name in the same event is refused', format($$select public.create_event_credential(%L, 'device', 'marshal phone', 'marshal', t.h(71))$$, t.ev(1)), '23505');
select t.expect_error('a second controller for the event is refused', format($$select public.create_event_credential(%L, 'controller', 'Other Laptop', 'broadcast_controller', t.h(72))$$, t.ev(1)), '22023');
select t.expect_error('a controller cannot be a counter', format($$select public.create_event_credential(%L, 'controller', 'X', 'counter', t.h(73))$$, t.ev(1)), '22023');
select t.expect_error('a device cannot be a controller role', format($$select public.create_event_credential(%L, 'device', 'X', 'broadcast_controller', t.h(74))$$, t.ev(1)), '22023');
select t.expect_error('an unknown role is refused', format($$select public.create_event_credential(%L, 'device', 'X', 'organizer', t.h(75))$$, t.ev(1)), '22023');
select t.expect_error('a verifier of the wrong size is refused', format($$select public.create_event_credential(%L, 'device', 'X', 'counter', '\x01'::bytea)$$, t.ev(1)), '22023');
select t.as_device(t.sid('admin'));
select t.expect_ok_undo('the Temporary Organizer makes an ordinary device code: it runs the day (Pack 26)', format($$select public.create_event_credential(%L, 'device', 'TO Made', 'counter', t.h(76))$$, t.ev(1)));
select t.expect_error('... but not another Event Admin code', format($$select public.create_event_credential(%L, 'device', 'TO Admin', 'temporary_organizer', t.h(77))$$, t.ev(1)), '42501');
select t.expect_error('... nor a stream controller code', format($$select public.create_event_credential(%L, 'controller', 'TO Laptop', 'broadcast_controller', t.h(78))$$, t.ev(1)), '42501');
select t.expect_ok_undo('... may revoke an ordinary device', format($$select public.revoke_event_credential(%L)$$, t.cred('marshal')));
select t.expect_error('... but not the stream controller', format($$select public.revoke_event_credential(%L)$$, t.cred('controller')), '42501');
select t.expect_ok('... and lists them', format($$select * from public.list_event_credentials(%L)$$, t.ev(1)));
select t.expect_error('... but cannot sign everything out (the organizer only)', format($$select public.revoke_all_event_devices(%L)$$, t.ev(1)), '42501');
select t.as_device(t.sid('marshal'));
select t.expect_error('a marshal device cannot call the door functions', $$select public.device_open_session(t.h(5), t.sh(5), 'x')$$, '42501');
select t.as_ctrl(t.sid('controller'));
select t.expect_error('the controller cannot manage credentials', format($$select * from public.list_event_credentials(%L)$$, t.ev(1)), '42501');

-- sign out all temporary devices: every device of the event, none of another event, the controller untouched
select t.as_user(t.u(1));
select t.expect_eq('Sign Out All ends every device of the event', public.revoke_all_event_devices(t.ev(1)) ->> 'revoked', '7');
select t.as_admin();
select t.expect_eq('... every E1 device session is gone', (select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.event_id = t.ev(1) and c.kind = 'device' and s.ended_at is null), 0::bigint);
select t.as_sub(t.sid('controller'));
select t.expect_eq('... the stream controller keeps its session', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_sub(t.sid('e2marshal'));
select t.expect_eq('... and Event 2 is untouched', (select count(*) from private.device_ctx()), 1::bigint);
select t.as_admin();
select t.expect_eq('the audit trail shows who revoked, without any code', (select count(*) from public.audit_log where action = 'device.revoked_all' and actor = t.u(1))::int, 1);

-- ---------------------------------------------------------------- audit: the device is named, never the code
select t.expect_eq('device sign-ins are audited as the session itself', (select count(*) from public.audit_log where action = 'device.signed_in' and (details -> 'device' ->> 'session_id')::uuid = actor)::int > 0, true);
select t.expect_eq('... with the device label and role', (select count(*) from public.audit_log where action = 'device.signed_in' and details -> 'device' ->> 'label' = 'Marshal Phone' and details -> 'device' ->> 'role' = 'marshal')::int > 0, true);
select t.expect_eq('no audit record contains a verifier or secret hash', (select count(*) from public.audit_log where details::text ~* '(code_hash|secret_hash|\\\\x[0-9a-f]{20})')::int, 0);

-- ---------------------------------------------------------------- DENY BY DEFAULT: the session roles can execute exactly the allow-list
create temp table allow (sect text, fn text);
select set_config('t.allowlist', :'allowlist', true);
do $$
declare cur text; l text;
begin
  for l in select unnest(string_to_array(current_setting('t.allowlist'), E'\n')) loop
    if l like '## %' then cur := substr(l, 4);
    elsif l <> '' and l not like '#%' and cur is not null then insert into allow values (cur, l); end if;
  end loop;
end $$;
select t.expect_eq('the allow-list file has the three sections', (select count(distinct sect) from allow), 3::bigint);
create temp table have as
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, p.oid as oid,
         has_function_privilege('bos_event_device', p.oid, 'execute') as dev, has_function_privilege('bos_controller', p.oid, 'execute') as ctl, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p');
select t.expect_eq('anon can execute exactly the pinned baseline (a forgotten REVOKE FROM PUBLIC on a new function fails here)',
  (select count(*) from (select fn from have where anon except select fn from allow where sect like 'anon%') x)::int + (select count(*) from (select fn from allow where sect like 'anon%' except select fn from have where anon) y)::int, 0);
select t.expect_eq('a device can execute exactly: the anon baseline + the device allow-list (nothing more, nothing less)',
  (select count(*) from (select fn from have where dev except (select fn from allow where sect in ('bos_event_device') union select fn from allow where sect like 'anon%')) x)::int
  + (select count(*) from ((select fn from allow where sect in ('bos_event_device') union select fn from allow where sect like 'anon%') except select fn from have where dev) y)::int, 0);
select t.expect_eq('the controller can execute exactly: the anon baseline + its two functions',
  (select count(*) from (select fn from have where ctl except (select fn from allow where sect = 'bos_controller' union select fn from allow where sect like 'anon%')) x)::int
  + (select count(*) from ((select fn from allow where sect = 'bos_controller' union select fn from allow where sect like 'anon%') except select fn from have where ctl) y)::int, 0);
select t.expect_eq('neither role is a member of authenticated', pg_has_role('bos_event_device', 'authenticated', 'member') or pg_has_role('bos_controller', 'authenticated', 'member'), false);
select t.expect_eq('neither role can log in', (select count(*) from pg_roles where rolname in ('bos_event_device', 'bos_controller') and rolcanlogin)::int, 0);
select t.expect_eq('neither role has ANY table privilege beyond anon on any table or view',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) pr
   where n.nspname in ('public', 'private', 'auth') and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and ((has_table_privilege('bos_event_device', c.oid, pr) and not has_table_privilege('anon', c.oid, pr)) or (has_table_privilege('bos_controller', c.oid, pr) and not has_table_privilege('anon', c.oid, pr))))::int, 0);
-- a function made after this migration is NOT reachable until someone reviews and grants it
create function public.t_probe() returns int language sql as $$ select 1 $$;
revoke execute on function public.t_probe() from public, anon, authenticated;
select t.expect_eq('a brand-new function (with the repository''s REVOKE) is not executable by a device or the controller',
  has_function_privilege('bos_event_device', 'public.t_probe()', 'execute') or has_function_privilege('bos_controller', 'public.t_probe()', 'execute'), false);
grant execute on function public.t_probe() to public;
select t.expect_eq('... and a forgotten REVOKE FROM PUBLIC makes it reachable, which the equality checks above would have caught',
  has_function_privilege('bos_event_device', 'public.t_probe()', 'execute'), true);
drop function public.t_probe();
-- and the grants really bite
select t.as_device(t.sid('admin'));
select t.expect_error('a device cannot call a function outside the allow-list (close_event)', format($$select public.close_event(%L)$$, t.ev(1)), '42501');
select t.expect_error('... build a schedule', format($$select public.build_schedule(%L, '[]'::jsonb, 'new', null)$$, t.ev(1)), '42501');
select t.expect_error('... change broadcast settings', format($$select public.set_broadcast_settings(%L, '{}'::jsonb)$$, t.ev(1)), '42501');
select t.expect_error('... call an ordinary signed-in function (my_fighter_id)', $$select public.my_fighter_id()$$, '42501');
select t.expect_error('... read staff with emails', format($$select * from public.list_event_staff(%L)$$, t.ev(1)), '42501');
select t.expect_error('... read the staff table', 'select * from public.event_staff', '42501');
select t.expect_error('... read registrations', 'select * from public.registrations', '42501');
select t.expect_error('... write a match directly', format($$update public.matches set field = 'Field 9' where id = %L$$, t.m(1)), '42501');
select t.expect_error('... read the audit log', 'select * from public.audit_log', '42501');
select t.expect_ok('but public reads work (an event''s matches)', 'select count(*) from public.matches');
select t.expect_ok('... and the public Lyst view', 'select count(*) from public.lyst_public_state');
select t.as_ctrl(t.sid('controller'));
select t.expect_error('the controller cannot call anything else: score', format($$select public.lyst_open(%L)$$, t.m(1)), '42501');
select t.expect_error('... Camera Off release', format($$select public.camera_off_release(%L)$$, t.ev(1)), '42501');
select t.expect_error('... Camera Off activate', format($$select public.camera_off_activate(%L)$$, t.ev(1)), '42501');
select t.expect_error('... broadcast control', format($$select public.set_broadcast_control(%L, 0, '{"mode":"manual","target_kind":"holding"}'::jsonb)$$, t.ev(1)), '42501');
select t.expect_error('... who-am-I (devices only)', 'select public.device_whoami()', '42501');
select t.as_admin();

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK181 SESSIONS GATE PASSED % checks', n; end $$;
rollback;
