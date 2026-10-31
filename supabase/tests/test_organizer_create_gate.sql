-- Test organizer gate: a test-crew organizer creates TEST events only; a real event still needs an approved organizer. Rolled back.
\set ON_ERROR_STOP on
begin;
create temp table log (n serial, msg text);
grant all on log to public; grant usage on sequence log_n_seq to public;
create function pg_temp.ok(p boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(p, false) then raise exception 'FAIL: %', msg; end if; insert into log (msg) values (msg); end $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true); if u is null then set local role anon; else set local role authenticated; end if; end $$;
create function pg_temp.refused(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

do $$ begin execute format('grant usage on schema %s to public', pg_my_temp_schema()::regnamespace); end $$;
grant execute on function pg_temp.ok(boolean, text), pg_temp.as_user(uuid), pg_temp.refused(text) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d001', 'testorg@example.test'), ('00000000-0000-0000-0000-00000000d002', 'nobody@example.test'),
  ('00000000-0000-0000-0000-00000000d003', 'approved@example.test');
insert into private.test_event_crew (user_id, role) values ('00000000-0000-0000-0000-00000000d001', 'organizer');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-00000000d003', 'organizer');

-- what the app is told
select pg_temp.as_user('00000000-0000-0000-0000-00000000d001');
select pg_temp.ok(public.my_event_creation() = 'test', 'a test organizer may create test events only');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d002');
select pg_temp.ok(public.my_event_creation() = 'none', 'an ordinary account may create nothing');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d003');
select pg_temp.ok(public.my_event_creation() = 'any', 'an approved organizer may create any event');
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.my_event_creation()', 'execute'), 'signed-out visitors cannot call it');
select pg_temp.ok(not has_function_privilege('authenticated', 'private.is_test_organizer()', 'execute'), 'the helper is not reachable from the app');

-- the test organizer: a test event is created, tagged synthetic, with them as organizer; a real event is refused
select pg_temp.as_user('00000000-0000-0000-0000-00000000d001');
select pg_temp.ok(public.create_event('tog-test', 'TEST organizer event', current_date, current_date, null, null, true) is not null, 'a test organizer creates a test event');
reset role;
select pg_temp.ok((select test_event from public.events where slug = 'tog-test'), 'it is a test event');
select pg_temp.ok(private.is_synthetic('event', (select id from public.events where slug = 'tog-test')), 'it is tagged as test data');
select pg_temp.ok(exists (select 1 from public.event_staff s join public.events e on e.id = s.event_id where e.slug = 'tog-test' and s.user_id = '00000000-0000-0000-0000-00000000d001' and s.role = 'organizer'), 'they organize it');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d001');
select pg_temp.ok(pg_temp.refused($$select public.create_event('tog-real', 'Real by test organizer', current_date, current_date, null, null, false)$$) like '42501%test events only%', 'a test organizer cannot create a real event');
select pg_temp.ok(pg_temp.refused($$select public.create_event('tog-real2', 'Real by default', current_date, current_date)$$) like '42501%', 'nor by leaving the test flag out');
reset role;
select pg_temp.ok(not exists (select 1 from public.events where slug in ('tog-real', 'tog-real2')), 'no real event was created');

-- the test flag cannot be switched off afterwards
select pg_temp.ok(pg_temp.refused($$update public.events set test_event = false where slug = 'tog-test'$$) is not null, 'a test event cannot become a real one');

-- an ordinary account is refused either way; an approved organizer still creates real events
select pg_temp.as_user('00000000-0000-0000-0000-00000000d002');
select pg_temp.ok(pg_temp.refused($$select public.create_event('tog-n1', 'Nobody test', current_date, current_date, null, null, true)$$) like '42501%approved organizers%', 'an ordinary account cannot create a test event');
select pg_temp.ok(pg_temp.refused($$select public.create_event('tog-n2', 'Nobody real', current_date, current_date, null, null, false)$$) like '42501%approved organizers%', 'nor a real one');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d003');
select pg_temp.ok(public.create_event('tog-approved', 'Approved real event', current_date, current_date, null, null, false) is not null, 'an approved organizer still creates a real event');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.refused($$select public.create_event('tog-anon', 'Anon', current_date, current_date, null, null, true)$$) is not null, 'signed out cannot create anything');
reset role;

do $$ begin raise notice 'TEST ORGANIZER CREATE GATE PASSED % checks', (select count(*) from log); end $$;
rollback;
