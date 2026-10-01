-- An event's organizers need to see who holds each role. Emails live in auth.users, which the API never exposes,
-- so this returns them to organizers of that event only.
create or replace function public.list_event_staff(p_event uuid) returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_organizer(p_event) then raise exception 'only an organizer can see the staff' using errcode = '42501'; end if;
  return query
    select s.user_id, u.email::text, s.role from public.event_staff s join auth.users u on u.id = s.user_id
    where s.event_id = p_event order by s.role, u.email;
end $$;
revoke execute on function public.list_event_staff(uuid) from public, anon;
grant execute on function public.list_event_staff(uuid) to authenticated;
