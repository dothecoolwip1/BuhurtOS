-- Red Deer Reavers members roster: which members' accounts have a BuhurtOS fighter profile, so the club website can link a member's name to
-- their public fighter page (Red-deer-reavers assets/js/member-portal.js, fetchRoster).
--
-- SOURCE CONTROL RECORD of a function that is already live: it was applied to the hosted project on 2026-10-06 as migration
-- 20261006205512 "reavers_member_buhurtos_profile_links" and is reproduced here unchanged (same body, same security definer, same empty
-- search_path, same execute grants), numbered after the club migrations it depends on. Re-running it changes nothing.
--
-- Who may call it: the same people who may see the club's member roster (private.can_view_club_roster: the club's current executive). It
-- returns only membership id -> fighter id for that club and year: the fighter id is already public (fighters is publicly readable); the
-- account behind it is never returned. Everyone else, including anonymous callers, is refused (42501). A member's own link is answered by
-- the existing public.my_fighter_id(), which reads only auth.uid().
create or replace function public.club_member_profile_links(p_team uuid, p_year integer)
returns table (membership_id uuid, fighter_id uuid)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if auth.uid() is null or not private.can_view_club_roster(p_team) then
    raise exception 'only this club''s executive can see the membership list' using errcode = '42501';
  end if;

  return query
  select m.id, fa.fighter_id
  from public.club_memberships m
  left join public.fighter_accounts fa on fa.user_id = m.user_id
  where m.team_id = p_team
    and m.membership_year = p_year;
end
$function$;
revoke execute on function public.club_member_profile_links(uuid, integer) from public, anon;
grant execute on function public.club_member_profile_links(uuid, integer) to authenticated, service_role;
