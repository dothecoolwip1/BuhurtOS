-- Transactional bootstrap, invitations and temporary fighter workflows.

create table public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role_key text not null references public.role_definitions(role_key) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (timezone('utc',now()) + interval '7 days'),
  created_at timestamptz not null default timezone('utc',now()),
  check (expires_at > created_at),
  check (email = lower(trim(email)))
);

create index account_invitations_email_pending_idx
  on public.account_invitations(lower(email),status,expires_at);
create index account_invitations_event_idx
  on public.account_invitations(event_id,status) where event_id is not null;

create unique index if not exists access_grants_active_unique
  on public.access_grants(
    user_id,
    role_id,
    coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(event_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id,'00000000-0000-0000-0000-000000000000'::uuid)
  )
  where deleted_at is null;

create or replace function private.apply_event_invitation(p_invitation_id uuid,p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.account_invitations%rowtype;
  role_id uuid;
begin
  select * into invitation from public.account_invitations where id=p_invitation_id for update;
  if not found then return false; end if;
  if invitation.status<>'pending' then return invitation.status='accepted'; end if;

  if invitation.expires_at<=timezone('utc',now()) then
    update public.account_invitations set status='expired' where id=p_invitation_id;
    return false;
  end if;

  if invitation.event_id is null then raise exception 'Only event invitations are supported by this workflow'; end if;

  select id into role_id from public.role_definitions where role_key=invitation.role_key and scope_type='event' and is_active;
  if role_id is null then raise exception 'Invitation role is not an active event role'; end if;

  insert into public.event_memberships(event_id,user_id,role,team_id,created_by)
  values(invitation.event_id,p_user_id,invitation.role_key::public.event_role,invitation.team_id,invitation.invited_by)
  on conflict(event_id,user_id,role) do update
    set team_id=excluded.team_id;

  insert into public.access_grants(user_id,role_id,organization_id,event_id,team_id,created_by)
  values(p_user_id,role_id,invitation.organization_id,invitation.event_id,invitation.team_id,invitation.invited_by)
  on conflict do nothing;

  update public.account_invitations
  set status='accepted',accepted_by=p_user_id,accepted_at=timezone('utc',now())
  where id=p_invitation_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(invitation.organization_id,invitation.event_id,p_user_id,'account_invitations',invitation.id,'accept_invitation',
         jsonb_build_object('role',invitation.role_key,'teamId',invitation.team_id));
  return true;
end;
$$;

revoke execute on function private.apply_event_invitation(uuid,uuid) from public,anon,authenticated;

create or replace function public.invite_or_assign_event_member(
  p_event_id uuid,
  p_email text,
  p_role_key text,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  event_row public.events%rowtype;
  role_row public.role_definitions%rowtype;
  existing_user uuid;
  invitation_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if position('@' in normalized_email)<2 or length(normalized_email)<5 then raise exception 'Valid email required'; end if;

  select * into event_row from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;

  if not private.user_has_permission((select auth.uid()),'event.manage',event_row.organization_id,event_row.id,null) then
    raise exception 'Not authorized to invite event members';
  end if;

  select * into role_row from public.role_definitions
  where role_key=p_role_key and scope_type='event' and is_system and is_active;
  if not found then raise exception 'Unsupported event role'; end if;

  if p_role_key='team_captain' and p_team_id is null then raise exception 'Team captain invitations require a team'; end if;
  if p_team_id is not null and not exists(select 1 from public.teams t where t.id=p_team_id and t.organization_id=event_row.organization_id and t.is_active) then
    raise exception 'Team does not belong to this organization';
  end if;

  select u.id into existing_user from auth.users u where lower(u.email)=normalized_email order by u.created_at limit 1;

  select i.id into invitation_id
  from public.account_invitations i
  where i.email=normalized_email
    and i.event_id=p_event_id
    and i.role_key=p_role_key
    and i.team_id is not distinct from p_team_id
    and i.status='pending'
    and i.expires_at>timezone('utc',now())
  order by i.created_at desc limit 1;

  if invitation_id is null then
    insert into public.account_invitations(email,role_key,organization_id,event_id,team_id,invited_by)
    values(normalized_email,p_role_key,event_row.organization_id,p_event_id,p_team_id,(select auth.uid()))
    returning id into invitation_id;
  end if;

  if existing_user is not null then
    perform private.apply_event_invitation(invitation_id,existing_user);
  end if;

  return jsonb_build_object(
    'invitationId',invitation_id,
    'invited',existing_user is null,
    'assigned',existing_user is not null
  );
end;
$$;

revoke execute on function public.invite_or_assign_event_member(uuid,text,text,uuid) from public,anon;
grant execute on function public.invite_or_assign_event_member(uuid,text,text,uuid) to authenticated;

create or replace function public.claim_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user uuid := (select auth.uid());
  current_email text;
  invitation record;
  accepted_count integer := 0;
begin
  if current_user is null then raise exception 'Authentication required'; end if;
  select lower(email) into current_email from auth.users where id=current_user;
  if current_email is null then return 0; end if;

  for invitation in
    select id from public.account_invitations
    where email=current_email and status='pending' and expires_at>timezone('utc',now())
    order by created_at
  loop
    if private.apply_event_invitation(invitation.id,current_user) then accepted_count:=accepted_count+1; end if;
  end loop;
  return accepted_count;
end;
$$;

revoke execute on function public.claim_pending_invitations() from public,anon;
grant execute on function public.claim_pending_invitations() to authenticated;

create or replace function private.accept_new_user_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare invitation record;
begin
  if new.email is null then return new; end if;
  for invitation in
    select id from public.account_invitations
    where email=lower(new.email) and status='pending' and expires_at>timezone('utc',now())
    order by created_at
  loop
    perform private.apply_event_invitation(invitation.id,new.id);
  end loop;
  return new;
end;
$$;

revoke execute on function private.accept_new_user_invitations() from public,anon,authenticated;
drop trigger if exists zz_buhurtos_accept_invitations on auth.users;
create trigger zz_buhurtos_accept_invitations
after insert on auth.users
for each row execute function private.accept_new_user_invitations();

create or replace function public.create_organization_with_admin(
  p_name text,
  p_short_name text,
  p_region text,
  p_country_code text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org_id uuid;
  org_slug text;
begin
  if not private.is_platform_admin((select auth.uid())) then raise exception 'Platform administrator permission required'; end if;
  if length(trim(p_name))<2 or length(trim(p_short_name))<2 then raise exception 'Organization name and short name are required'; end if;

  org_slug:=trim(both '-' from lower(regexp_replace(trim(p_short_name),'[^a-zA-Z0-9]+','-','g')));
  if org_slug='' then raise exception 'Short name must contain letters or numbers'; end if;

  insert into public.organizations(name,short_name,slug,region,country_code,status,is_public,created_by,last_edited_by,updated_by)
  values(trim(p_name),trim(p_short_name),org_slug,trim(p_region),nullif(upper(trim(coalesce(p_country_code,''))),''),'active',true,(select auth.uid()),(select auth.uid()),(select auth.uid()))
  returning id into org_id;

  insert into public.organization_memberships(organization_id,user_id,role)
  values(org_id,(select auth.uid()),'organization_admin')
  on conflict(organization_id,user_id,role) do nothing;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(org_id,(select auth.uid()),'organizations',org_id,'create_organization','{}'::jsonb);
  return org_id;
end;
$$;

revoke execute on function public.create_organization_with_admin(text,text,text,text) from public,anon;
grant execute on function public.create_organization_with_admin(text,text,text,text) to authenticated;

create or replace function public.create_event_with_organizer(
  p_organization_id uuid,
  p_season_id uuid,
  p_name text,
  p_venue text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_event_type public.event_type,
  p_standings_mode public.standings_mode
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare event_id uuid;
begin
  if not private.user_has_permission((select auth.uid()),'organization.manage',p_organization_id,null,null) then
    raise exception 'Organization administrator permission required';
  end if;
  if p_ends_at<=p_starts_at then raise exception 'Event end must be after event start'; end if;
  if not exists(select 1 from public.seasons s where s.id=p_season_id and s.organization_id=p_organization_id and s.deleted_at is null) then
    raise exception 'Season does not belong to this organization';
  end if;

  insert into public.events(organization_id,season_id,name,venue,starts_at,ends_at,timezone,event_type,standings_mode,status,created_by,last_edited_by)
  values(p_organization_id,p_season_id,trim(p_name),trim(p_venue),p_starts_at,p_ends_at,trim(p_timezone),p_event_type,p_standings_mode,'draft',(select auth.uid()),(select auth.uid()))
  returning id into event_id;

  insert into public.event_memberships(event_id,user_id,role,created_by)
  values(event_id,(select auth.uid()),'event_organizer',(select auth.uid()))
  on conflict(event_id,user_id,role) do nothing;

  return event_id;
end;
$$;

revoke execute on function public.create_event_with_organizer(uuid,uuid,text,text,timestamptz,timestamptz,text,public.event_type,public.standings_mode) from public,anon;
grant execute on function public.create_event_with_organizer(uuid,uuid,text,text,timestamptz,timestamptz,text,public.event_type,public.standings_mode) to authenticated;

create or replace function public.create_temporary_fighter_for_event(
  p_event_id uuid,
  p_display_name text,
  p_country_code text default null,
  p_team_id uuid default null,
  p_division_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events%rowtype;
  fighter_id uuid;
  roster_id uuid;
begin
  select * into event_row from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not private.user_has_permission((select auth.uid()),'roster.manage',event_row.organization_id,event_row.id,p_team_id) then
    raise exception 'Not authorized to create temporary fighters';
  end if;
  if length(trim(p_display_name))<2 then raise exception 'Temporary fighter name is required'; end if;
  if p_team_id is not null and not exists(select 1 from public.teams where id=p_team_id and organization_id=event_row.organization_id and is_active) then
    raise exception 'Temporary fighter team is not valid for this organization';
  end if;
  if p_division_id is not null and not exists(select 1 from public.divisions where id=p_division_id and (organization_id is null or organization_id=event_row.organization_id) and is_active) then
    raise exception 'Temporary fighter division is not valid for this organization';
  end if;

  insert into public.fighters(organization_id,team_id,name,country_code,is_temporary,is_active,preferred_weapons,created_by,last_edited_by,updated_by)
  values(event_row.organization_id,p_team_id,trim(p_display_name),nullif(upper(trim(coalesce(p_country_code,''))),''),true,true,'{}'::text[],(select auth.uid()),(select auth.uid()),(select auth.uid()))
  returning id into fighter_id;

  insert into public.event_roster_entries(
    organization_id,event_id,team_id,fighter_id,entry_type,display_name,attendance_status,metadata,created_by,last_edited_by
  )
  values(
    event_row.organization_id,event_row.id,p_team_id,fighter_id,'ghost_fighter',trim(p_display_name),'registered',
    jsonb_strip_nulls(jsonb_build_object('temporary',true,'divisionId',p_division_id,'countryCode',nullif(upper(trim(coalesce(p_country_code,''))),''))),
    (select auth.uid()),(select auth.uid())
  )
  returning id into roster_id;

  return jsonb_build_object('fighterId',fighter_id,'rosterEntryId',roster_id);
end;
$$;

revoke execute on function public.create_temporary_fighter_for_event(uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.create_temporary_fighter_for_event(uuid,text,text,uuid,uuid) to authenticated;

alter table public.account_invitations enable row level security;

create policy account_invitations_admin_read on public.account_invitations for select to authenticated using (
  invited_by=(select auth.uid())
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
  or (event_id is not null and exists(
    select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,team_id)
  ))
);

create policy account_invitations_admin_update on public.account_invitations for update to authenticated using (
  invited_by=(select auth.uid())
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
)
with check (
  invited_by=(select auth.uid())
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
);

grant select,update on public.account_invitations to authenticated;

drop trigger if exists audit_change on public.account_invitations;
create trigger audit_change after insert or update or delete on public.account_invitations
for each row execute function private.capture_audit_change();
