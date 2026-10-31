-- Test organizers may create TEST events only (owner request 2026-10-31: the shared rehearsal account organizer@buhurtos.ca was refused
-- "Event creation is for approved organizers", so a full rehearsal could not create its own test event).
--   * An account listed as 'organizer' in private.test_event_crew may call create_event with p_test = true. A real event still needs an approved
--     organizer (platform_roles) or the owner, so a shared test account can never publish a real event.
--   * The test flag cannot be changed afterwards (trigger events_test_fixed), so a test event cannot be turned into a real one.
--   * Nothing else that checks private.is_platform_organizer() changes (past medals, card context).
--   * public.my_event_creation() tells the app what this person may create ('any', 'test' or 'none'), because the crew list is private.
-- In-flight: nothing is stored; the crew row for organizer@buhurtos.ca already exists on hosted (20261113000100), so it takes effect at once.
-- Additive: one private helper, one public read function, one anchored patch (refuses unless its anchor is found exactly once; safe to run twice).
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'test organizer patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

create or replace function private.is_test_organizer() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from private.test_event_crew c where c.user_id = auth.uid() and c.role = 'organizer')
$$;
revoke execute on function private.is_test_organizer() from public, anon, authenticated;

create or replace function public.my_event_creation() returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then 'none' when private.is_platform_organizer() then 'any' when private.is_test_organizer() then 'test' else 'none' end
$$;
revoke execute on function public.my_event_creation() from public, anon;
grant execute on function public.my_event_creation() to authenticated;
comment on function public.my_event_creation() is 'What the caller may create: any event, test events only, or none.';

select pg_temp.bos_patch('public.create_event(text,text,date,date,text,text,boolean)'::regprocedure,
  $a$  if not private.is_platform_organizer() then raise exception 'only approved organizers can create events' using errcode = '42501'; end if;$a$,
  $b$  if not private.is_platform_organizer() then
    if v_test and private.is_test_organizer() then null;   -- a test organizer, creating a test event 20261114000200
    elsif private.is_test_organizer() then raise exception 'this account can create test events only: tick "This is a test event"' using errcode = '42501';
    else raise exception 'only approved organizers can create events' using errcode = '42501'; end if;
  end if;$b$);

reset check_function_bodies;
