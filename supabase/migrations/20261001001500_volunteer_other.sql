-- Volunteers: the eighth role "Other" with a free-text description, and an organizer-written volunteer note.
-- Additive only. Nothing here contains safety or legal wording: the separate volunteer safety/liability/tracking form text has not been supplied.

-- Organizer-configurable note shown to volunteers on the registration form (for example where to find the separate volunteer form).
alter table public.events
  add column volunteer_info text check (volunteer_info is null or char_length(volunteer_info) <= 2000);
grant update (volunteer_info) on public.events to authenticated;

-- volunteer_roles keeps its shape (text[]). Allowed values: the seven fixed roles, or "Other: <description>" (description 1 to 200 characters).
-- submit_registration writes this column as given, so the rule lives on the table, where every write path meets it.
create or replace function private.check_volunteer_roles() returns trigger
language plpgsql set search_path = '' as $$
declare r text;
begin
  if cardinality(new.volunteer_roles) > 8 then raise exception 'too many volunteer roles' using errcode = '22023'; end if;
  foreach r in array new.volunteer_roles loop
    if r in ('Squire', 'Points counter', 'Marshal', 'Runner', 'Secretary', 'Scheduling', 'Ticket booth') then continue; end if;
    if r like 'Other: %' and char_length(btrim(substr(r, 8))) between 1 and 200 and char_length(r) <= 207 then continue; end if;
    raise exception 'unknown volunteer role, or Other without a description of at most 200 characters' using errcode = '22023';
  end loop;
  return new;
end $$;
revoke execute on function private.check_volunteer_roles() from public, anon, authenticated;
create trigger registrations_volunteer_roles before insert or update of volunteer_roles on public.registrations
  for each row execute function private.check_volunteer_roles();

-- A signed name must hold real characters, not only spaces (submit_registration only checks the raw length).
alter table public.registrations add constraint registrations_waiver_name_real check (char_length(btrim(waiver_signed_name)) >= 2);
