-- Test event crew (owner request 2026-10-30): the shared test accounts organizer@buhurtos.ca (organizer) and scorekeeper@buhurtos.ca
-- (scorekeeper) are staff on every test event, present and future. A test event is any event tagged with a synthetic source: the
-- "Test event" checkbox events and the fictional datasets (NACL-test, rehearsal fixtures). Real events are never touched.
--   * private.test_event_crew lists who joins every test event and in what role; adding a row later also adds that person to every
--     existing test event.
--   * A trigger on record_sources adds the crew the moment an event is tagged synthetic (create_event tags a test event right after
--     creating it).
--   * Existing test events are backfilled below. Ordinary event-role expiry (7 days after the event's last day) still applies.
-- Additive: one table, two trigger functions, a backfill.

create table if not exists private.test_event_crew (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  primary key (user_id, role)
);
alter table private.test_event_crew enable row level security;
revoke all on table private.test_event_crew from public, anon, authenticated;
comment on table private.test_event_crew is 'Accounts added as staff to every test (synthetic) event, present and future.';

-- every test event gets the crew (one event, or all of them when p_event is null)
create or replace function private.test_crew_join(p_event uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.event_staff (event_id, user_id, role)
  select e.id, c.user_id, c.role
  from public.events e cross join private.test_event_crew c
  where (p_event is null or e.id = p_event) and private.is_synthetic('event', e.id)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function private.test_crew_join(uuid) from public, anon, authenticated;

create or replace function private.record_sources_test_crew() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_type = 'event' and exists (select 1 from public.sources s where s.id = new.source_id and s.synthetic) then
    perform private.test_crew_join(new.entity_id);
  end if;
  return null;
end $$;
revoke execute on function private.record_sources_test_crew() from public, anon, authenticated;
drop trigger if exists record_sources_test_crew on public.record_sources;
create trigger record_sources_test_crew after insert or update of source_id, entity_type, entity_id on public.record_sources
  for each row execute function private.record_sources_test_crew();

create or replace function private.test_event_crew_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_staff (event_id, user_id, role)
  select e.id, new.user_id, new.role from public.events e where private.is_synthetic('event', e.id)
  on conflict do nothing;
  return null;
end $$;
revoke execute on function private.test_event_crew_added() from public, anon, authenticated;
drop trigger if exists test_event_crew_added on private.test_event_crew;
create trigger test_event_crew_added after insert on private.test_event_crew for each row execute function private.test_event_crew_added();

-- the crew (only accounts that exist here; a fresh database has none) and the backfill of every present test event
insert into private.test_event_crew (user_id, role)
select u.id, v.role from (values ('organizer@buhurtos.ca', 'organizer'), ('scorekeeper@buhurtos.ca', 'scorekeeper')) v(email, role)
join auth.users u on lower(u.email) = v.email
on conflict do nothing;
select private.test_crew_join(null);
