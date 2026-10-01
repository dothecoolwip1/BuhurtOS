-- Not every event is a tournament. A dance, a feast, a demonstration or a clinic may sell tickets elsewhere or need no sign-up at all.
-- registration_mode says where people sign up: on BuhurtOS (fighters, waiver, check-in), on another site (a link), or nowhere.
alter table public.events
  add column registration_mode text not null default 'buhuros' check (registration_mode in ('buhuros', 'external', 'none')),
  add column external_url text check (external_url is null or (char_length(external_url) <= 500 and external_url ~ '^https?://')),
  add column time_note text check (time_note is null or char_length(time_note) <= 200),
  add constraint events_external_needs_url check (registration_mode <> 'external' or external_url is not null);
grant update (registration_mode, external_url, time_note) on public.events to authenticated;

-- The database stays the authority: nobody can register through BuhurtOS for an event that takes sign-ups elsewhere or not at all.
create or replace function private.registration_mode_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mode text;
begin
  select registration_mode into v_mode from public.events where id = new.event_id;
  if v_mode is distinct from 'buhuros' then raise exception 'this event does not take registrations on BuhurtOS' using errcode = '22023'; end if;
  return new;
end $$;
revoke execute on function private.registration_mode_guard() from public, anon, authenticated;
create trigger registrations_mode_guard before insert on public.registrations for each row execute function private.registration_mode_guard();
