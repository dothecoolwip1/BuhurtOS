-- Test event crew gate: the shared test accounts join every test event, present and future, and never a real one. Rolled back.
\set ON_ERROR_STOP on
begin;
create temp table log (n serial, msg text);
create function pg_temp.ok(p boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(p, false) then raise exception 'FAIL: %', msg; end if; insert into log (msg) values (msg); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c001', 'crew-org@example.test'), ('00000000-0000-0000-0000-00000000c002', 'crew-sk@example.test');
insert into public.events (id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000ce01', 'crew-test-old', 'Crew test event', current_date, current_date),
  ('00000000-0000-0000-0000-00000000ce02', 'crew-real', 'Crew real event', current_date, current_date);
insert into public.record_sources (source_id, entity_type, entity_id, status) values ('7e570000-0000-4000-8000-000000000001', 'event', '00000000-0000-0000-0000-00000000ce01', 'unverified');

-- adding a crew member puts them on every present test event, not on real ones
insert into private.test_event_crew (user_id, role) values ('00000000-0000-0000-0000-00000000c001', 'organizer'), ('00000000-0000-0000-0000-00000000c002', 'scorekeeper');
select pg_temp.ok((select count(*) from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ce01' and user_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')) = 2, 'a present test event gets the organizer and scorekeeper');
select pg_temp.ok(not exists (select 1 from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ce02' and user_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')), 'a real event gets nobody');
select pg_temp.ok((select role from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ce01' and user_id = '00000000-0000-0000-0000-00000000c002') = 'scorekeeper', 'each in their own role');

-- a future test event, tagged as create_event does, gets the crew at once
insert into public.events (id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000ce03', 'crew-test-new', 'Crew new test event', current_date, current_date);
insert into public.record_sources (source_id, entity_type, entity_id, status) values ('7e570000-0000-4000-8000-000000000001', 'event', '00000000-0000-0000-0000-00000000ce03', 'unverified');
select pg_temp.ok((select count(*) from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ce03' and user_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')) = 2, 'a new test event gets the crew');

-- a non-synthetic source on a real event does nothing; running the backfill again adds nothing new
insert into public.sources (id, kind, title, synthetic) values ('00000000-0000-0000-0000-00000000c5c5', 'submitted', 'Real source', false);
insert into public.record_sources (source_id, entity_type, entity_id, status) values ('00000000-0000-0000-0000-00000000c5c5', 'event', '00000000-0000-0000-0000-00000000ce02', 'unverified');
select pg_temp.ok(not exists (select 1 from public.event_staff where event_id = '00000000-0000-0000-0000-00000000ce02' and user_id in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002')), 'a real source on a real event adds nobody');
select pg_temp.ok(private.test_crew_join(null) = 0, 'the backfill is safe to run twice');

-- browsers cannot read or change the crew list
select pg_temp.ok(not has_table_privilege('authenticated', 'private.test_event_crew', 'select') and not has_table_privilege('authenticated', 'private.test_event_crew', 'insert'), 'the crew list is not reachable from the app');

do $$ begin raise notice 'TEST EVENT CREW GATE PASSED % checks', (select count(*) from log); end $$;
rollback;
