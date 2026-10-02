-- Team manager for admins, "am I already on this team", and "which fighter profile is mine". All additive.
--   * my_team_ids(): the teams the caller is already part of (captain, roster, or marked as their team). The team page uses it to hide
--     "Request to join". It exposes only the caller's own ids.
--   * my_fighter_id(): the caller's own fighter record id, so the app can offer "Edit profile". Null when they have none.
--   * assign_team_captain / remove_team_captain / list_team_captains: the platform owner, a platform organizer, or an admin of an
--     organization the team is a member of can name captains. Captains are chosen by sign-in email: that person must have signed in once.

create or replace function public.my_team_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.teams t where auth.uid() is not null and private.is_team_member(t.id, auth.uid())
$$;

create or replace function public.my_fighter_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select fighter_id from public.fighter_accounts where user_id = auth.uid()
$$;

-- May the caller name captains for this team. Owner and platform organizers always; an organization admin when the team is a
-- (current) member of an organization they administer.
create or replace function private.can_assign_captain(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_organizer()
    or exists (
      select 1 from public.team_affiliations a
      where a.team_id = p_team and a.relation = 'member' and private.is_org_admin(a.organization_id)
        and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date))
$$;
revoke execute on function private.can_assign_captain(uuid) from public, anon, authenticated;

create or replace function public.assign_team_captain(p_team uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if auth.uid() is null or not private.can_assign_captain(p_team) then raise exception 'only an organizer or an organization admin can name a captain' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'that person has not signed in to BuhurtOS yet' using errcode = 'P0002'; end if;
  insert into public.team_roles (team_id, user_id, role) values (p_team, v_user, 'captain') on conflict do nothing;
  perform private.audit(null, 'team.captain_assigned', p_team::text, jsonb_build_object('user', v_user));
end $$;

create or replace function public.remove_team_captain(p_team uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_assign_captain(p_team) then raise exception 'only an organizer or an organization admin can remove a captain' using errcode = '42501'; end if;
  delete from public.team_roles where team_id = p_team and user_id = p_user and role = 'captain';
  perform private.audit(null, 'team.captain_removed', p_team::text, jsonb_build_object('user', p_user));
end $$;

create or replace function public.list_team_captains(p_team uuid) returns table (user_id uuid, name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_assign_captain(p_team) then raise exception 'only an organizer or an organization admin can see captains' using errcode = '42501'; end if;
  return query select r.user_id, private.person_name(r.user_id), u.email::text
    from public.team_roles r join auth.users u on u.id = r.user_id where r.team_id = p_team and r.role = 'captain' order by u.email;
end $$;

revoke execute on function public.my_team_ids(), public.my_fighter_id(), public.assign_team_captain(uuid, text), public.remove_team_captain(uuid, uuid), public.list_team_captains(uuid) from public, anon;
grant execute on function public.my_team_ids(), public.my_fighter_id(), public.assign_team_captain(uuid, text), public.remove_team_captain(uuid, uuid), public.list_team_captains(uuid) to authenticated;
