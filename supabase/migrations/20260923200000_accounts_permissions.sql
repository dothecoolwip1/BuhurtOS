-- Pack 2: account and permission hardening.
-- Membership mutations are routed through audited RPCs so ordinary users cannot self-escalate.

create or replace function private.can_manage_org_memberships(check_user uuid, check_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_platform_admin(check_user)
    or private.has_org_role(check_user, check_org, array['organization_admin']::public.organization_role[]);
$$;

create or replace function private.can_manage_event_memberships(check_user uuid, check_event uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_platform_admin(check_user)
    or exists (
      select 1 from public.events e
      where e.id = check_event
        and private.has_org_role(check_user, e.organization_id, array['organization_admin']::public.organization_role[])
    )
    or private.has_event_role(check_user, check_event, array['event_organizer']::public.event_role[]);
$$;

revoke all on function private.can_manage_org_memberships(uuid,uuid) from public, anon, authenticated;
revoke all on function private.can_manage_event_memberships(uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_manage_org_memberships(uuid,uuid) to authenticated;
grant execute on function private.can_manage_event_memberships(uuid,uuid) to authenticated;

drop policy if exists org_memberships_admin_write on public.organization_memberships;
drop policy if exists event_memberships_admin_write on public.event_memberships;

revoke insert, update, delete on public.platform_memberships from authenticated;
revoke insert, update, delete on public.organization_memberships from authenticated;
revoke insert, update, delete on public.event_memberships from authenticated;

create or replace function public.set_organization_membership(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_membership_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_org_memberships(v_uid, p_organization_id) then
    raise exception 'Organization administrator access required';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User profile not found';
  end if;

  delete from public.organization_memberships
  where organization_id = p_organization_id and user_id = p_user_id;

  insert into public.organization_memberships(organization_id,user_id,role)
  values (p_organization_id,p_user_id,p_role)
  returning id into v_membership_id;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values (p_organization_id,v_uid,'organization_memberships',v_membership_id,'set_organization_membership',
    jsonb_build_object('userId',p_user_id,'role',p_role));

  return v_membership_id;
end;
$$;

create or replace function public.revoke_organization_membership(
  p_organization_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target_is_admin boolean;
  v_other_admins integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_org_memberships(v_uid, p_organization_id) then
    raise exception 'Organization administrator access required';
  end if;

  select exists(
    select 1 from public.organization_memberships
    where organization_id=p_organization_id and user_id=p_user_id and role='organization_admin'
  ) into v_target_is_admin;

  if v_target_is_admin then
    select count(*)::integer into v_other_admins
    from public.organization_memberships
    where organization_id=p_organization_id and user_id<>p_user_id and role='organization_admin';
    if v_other_admins = 0 and not private.is_platform_admin(v_uid) then
      raise exception 'Cannot remove the last organization administrator';
    end if;
  end if;

  delete from public.organization_memberships
  where organization_id=p_organization_id and user_id=p_user_id;

  insert into public.audit_log(organization_id,actor_user_id,table_name,action,payload)
  values (p_organization_id,v_uid,'organization_memberships','revoke_organization_membership',
    jsonb_build_object('userId',p_user_id));
end;
$$;

create or replace function public.set_event_membership(
  p_event_id uuid,
  p_user_id uuid,
  p_role public.event_role,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events%rowtype;
  v_membership_id uuid;
  v_caller_is_org_admin boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_event from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not private.can_manage_event_memberships(v_uid,p_event_id) then raise exception 'Event access manager role required'; end if;

  v_caller_is_org_admin := private.is_platform_admin(v_uid)
    or private.has_org_role(v_uid,v_event.organization_id,array['organization_admin']::public.organization_role[]);

  if p_role='event_organizer' and not v_caller_is_org_admin then
    raise exception 'Only organization administrators can grant event organizer access';
  end if;
  if p_role='team_captain' and p_team_id is null then raise exception 'Team captains require a team'; end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id=p_team_id and t.organization_id=v_event.organization_id and t.deleted_at is null
  ) then
    raise exception 'Team must belong to the event organization';
  end if;
  if not exists (select 1 from public.profiles where id=p_user_id) then raise exception 'User profile not found'; end if;

  delete from public.event_memberships
  where event_id=p_event_id and user_id=p_user_id and role=p_role;

  insert into public.event_memberships(event_id,user_id,role,team_id)
  values (p_event_id,p_user_id,p_role,case when p_role='team_captain' then p_team_id else p_team_id end)
  returning id into v_membership_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (v_event.organization_id,p_event_id,v_uid,'event_memberships',v_membership_id,'set_event_membership',
    jsonb_build_object('userId',p_user_id,'role',p_role,'teamId',p_team_id));

  return v_membership_id;
end;
$$;

create or replace function public.revoke_event_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_membership public.event_memberships%rowtype;
  v_event public.events%rowtype;
  v_caller_is_org_admin boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_membership from public.event_memberships where id=p_membership_id;
  if not found then raise exception 'Event membership not found'; end if;
  select * into v_event from public.events where id=v_membership.event_id;
  if not private.can_manage_event_memberships(v_uid,v_membership.event_id) then raise exception 'Event access manager role required'; end if;

  v_caller_is_org_admin := private.is_platform_admin(v_uid)
    or private.has_org_role(v_uid,v_event.organization_id,array['organization_admin']::public.organization_role[]);

  if v_membership.role='event_organizer' and not v_caller_is_org_admin then
    raise exception 'Only organization administrators can revoke event organizer access';
  end if;

  delete from public.event_memberships where id=p_membership_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (v_event.organization_id,v_membership.event_id,v_uid,'event_memberships',p_membership_id,'revoke_event_membership',
    jsonb_build_object('userId',v_membership.user_id,'role',v_membership.role));
end;
$$;

revoke all on function public.set_organization_membership(uuid,uuid,public.organization_role) from public, anon;
revoke all on function public.revoke_organization_membership(uuid,uuid) from public, anon;
revoke all on function public.set_event_membership(uuid,uuid,public.event_role,uuid) from public, anon;
revoke all on function public.revoke_event_membership(uuid) from public, anon;
grant execute on function public.set_organization_membership(uuid,uuid,public.organization_role) to authenticated;
grant execute on function public.revoke_organization_membership(uuid,uuid) to authenticated;
grant execute on function public.set_event_membership(uuid,uuid,public.event_role,uuid) to authenticated;
grant execute on function public.revoke_event_membership(uuid) to authenticated;

-- Private account records stay private. Public sporting output is intentionally sourced from
-- event_roster_entries and other event tables with explicit public column grants.
revoke all on public.profiles from anon;
revoke all on public.platform_memberships from anon;
revoke all on public.organization_memberships from anon;
revoke all on public.event_memberships from anon;
revoke all on public.fighters from anon;
revoke all on public.fighter_identities from anon;

-- The waiver bucket remains private and is readable only through the existing staff RLS policy.
update storage.buckets set public=false where id='waivers';
