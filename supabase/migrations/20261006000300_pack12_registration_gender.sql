-- Pack 12 (2026-10-06), part 3: the gender a person registers with decides which categories they can enter. Additive.
--   male   -> Men's and Open categories
--   female -> Women's and Open categories
--   other  -> every category (the organizer places them)
-- The registration form already offers only the matching categories; this makes the database refuse a mismatch too, because the form is not a security
-- boundary. It guards the rows a registration creates (registration_competitions) and nothing else: organizers adding an entrant by hand, existing
-- registrations and every past result are untouched. An organizer who wants a different placement for someone uses the entrant tools.
create or replace function private.registration_category_gender() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_person text; v_cat text; v_name text;
begin
  select r.gender into v_person from public.registrations r where r.id = new.registration_id;
  select k.gender, k.name into v_cat, v_name from public.competitions k where k.id = new.competition_id;
  if v_person = 'male' and v_cat = 'women' then
    raise exception '% is a women''s category. Registering as Male, you can enter men''s and open categories.', v_name using errcode = '22023';
  elsif v_person = 'female' and v_cat = 'men' then
    raise exception '% is a men''s category. Registering as Female, you can enter women''s and open categories.', v_name using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.registration_category_gender() from public, anon, authenticated;
do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'registration_competitions_gender' and tgrelid = 'public.registration_competitions'::regclass) then
    create trigger registration_competitions_gender before insert on public.registration_competitions for each row execute function private.registration_category_gender();
  end if;
end $do$;
