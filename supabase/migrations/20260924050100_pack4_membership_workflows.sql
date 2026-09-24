create or replace function private.create_subordinate_organization(
  p_parent_organization_id uuid,
  p_name text,
  p_short_name text,
  p_region text,
  p_kind public.organization_kind,
  p_visibility public.entity_visibility default 'members'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,p_parent_organization_id,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Parent organization administrator access required';
  end if;
  if length(trim(coalesce(p_name,'')))=0
    or length(trim(coalesce(p_short_name,'')))=0
    or length(trim(coalesce(p_region,'')))=0 then
    raise exception 'Name, short name, and region are required';
  end if;

  insert into public.organizations(
    name,short_name,region,kind,visibility,created_by,last_edited_by
  )
  values(
    trim(p_name),trim(p_short_name),trim(p_region),p_kind,p_visibility,v_actor,v_actor
  )
  returning id into v_id;

  insert into public.organization_relationships(
    parent_organization_id,child_organization_id,relationship_kind,created_by,last_edited_by
  )
  values(p_parent_organization_id,v_id,'governs',v_actor,v_actor);

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_id,v_actor,'organization_admin');

  perform private.audit_pack4(
    p_parent_organization_id,v_actor,'organizations',v_id,'create_subordinate_organization',
    jsonb_build_object('parentOrganizationId',p_parent_organization_id,'kind',p_kind)
  );

  return v_id;
end;
$$;

create or replace function private.create_organization_relationship(
  p_parent uuid,
  p_child uuid,
  p_kind public.organization_relationship_kind,
  p_starts_on date default current_date
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_id uuid;
  v_platform boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_parent=p_child then raise exception 'An organization cannot relate to itself'; end if;

  v_platform:=private.is_platform_admin(v_actor);

  if not (
    v_platform
    or (
      private.has_org_role(v_actor,p_parent,array['organization_admin']::public.organization_role[])
      and private.has_org_role(v_actor,p_child,array['organization_admin']::public.organization_role[])
    )
  ) then
    raise exception 'Administrator access to both existing organizations is required';
  end if;

  if not exists(select 1 from public.organizations where id=p_parent and status='active')
    or not exists(select 1 from public.organizations where id=p_child and status='active') then
    raise exception 'Both organizations must be active';
  end if;

  if p_kind='governs' and private.organization_reaches(p_child,p_parent) then
    raise exception 'Organization hierarchy cycle detected';
  end if;

  insert into public.organization_relationships(
    parent_organization_id,child_organization_id,relationship_kind,starts_on,created_by,last_edited_by
  )
  values(p_parent,p_child,p_kind,coalesce(p_starts_on,current_date),v_actor,v_actor)
  returning id into v_id;

  perform private.audit_pack4(
    p_parent,v_actor,'organization_relationships',v_id,'create_organization_relationship',
    jsonb_build_object('childOrganizationId',p_child,'kind',p_kind)
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'That organization relationship is already active';
end;
$$;

create or replace function private.end_organization_relationship(
  p_relationship uuid,
  p_ends_on date default current_date
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_row public.organization_relationships%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select *
  into v_row
  from public.organization_relationships
  where id=p_relationship and ends_on is null
  for update;

  if v_row.id is null then raise exception 'Active organization relationship not found'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_row.parent_organization_id,array['organization_admin']::public.organization_role[])
    or private.has_org_role(v_actor,v_row.child_organization_id,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Organization administrator access required';
  end if;

  if p_ends_on<v_row.starts_on then raise exception 'End date cannot be before start date'; end if;

  update public.organization_relationships
  set ends_on=p_ends_on,last_edited_by=v_actor
  where id=v_row.id;

  perform private.audit_pack4(
    v_row.parent_organization_id,v_actor,'organization_relationships',v_row.id,'end_organization_relationship',
    jsonb_build_object('endsOn',p_ends_on)
  );
end;
$$;

create or replace function private.create_club(
  p_organization uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null,
  p_website text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,p_organization,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Organization administrator access required';
  end if;

  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Club name is required'; end if;

  insert into public.clubs(
    organization_id,name,short_name,region,website_url,visibility,public_description,created_by,last_edited_by
  )
  values(
    p_organization,
    trim(p_name),
    nullif(trim(coalesce(p_short_name,'')),''),
    nullif(trim(coalesce(p_region,'')),''),
    nullif(trim(coalesce(p_website,'')),''),
    p_visibility,
    nullif(trim(coalesce(p_description,'')),''),
    v_actor,
    v_actor
  )
  returning id into v_id;

  insert into public.club_memberships(
    club_id,user_id,role,display_name,created_by,last_edited_by
  )
  values(v_id,v_actor,'club_admin',private.profile_label(v_actor),v_actor,v_actor);

  perform private.audit_pack4(
    p_organization,v_actor,'clubs',v_id,'create_club',
    jsonb_build_object('name',trim(p_name))
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'An active club with that name already exists';
end;
$$;

create or replace function private.update_club(
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null,
  p_website text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_org uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_club(v_actor,p_club) then raise exception 'Club administrator access required'; end if;
  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Club name is required'; end if;

  update public.clubs
  set
    name=trim(p_name),
    short_name=nullif(trim(coalesce(p_short_name,'')),''),
    region=nullif(trim(coalesce(p_region,'')),''),
    website_url=nullif(trim(coalesce(p_website,'')),''),
    visibility=p_visibility,
    public_description=nullif(trim(coalesce(p_description,'')),''),
    last_edited_by=v_actor
  where id=p_club and deleted_at is null
  returning organization_id into v_org;

  if v_org is null then raise exception 'Club not found'; end if;

  perform private.audit_pack4(
    v_org,v_actor,'clubs',p_club,'update_club',
    jsonb_build_object('name',trim(p_name))
  );
exception
  when unique_violation then
    raise exception 'An active club with that name already exists';
end;
$$;

create or replace function private.archive_club(p_club uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_org uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select organization_id
  into v_org
  from public.clubs
  where id=p_club and deleted_at is null
  for update;

  if v_org is null then raise exception 'Club not found'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Organization administrator access required';
  end if;

  update public.clubs
  set is_active=false,deleted_at=timezone('utc',now()),deleted_by=v_actor,last_edited_by=v_actor
  where id=p_club;

  update public.teams
  set club_id=null,last_edited_by=v_actor
  where club_id=p_club and deleted_at is null;

  update public.club_memberships
  set ends_on=coalesce(ends_on,current_date),last_edited_by=v_actor
  where club_id=p_club and ends_on is null;

  update public.membership_requests
  set status='cancelled',reviewed_by=v_actor,resolved_at=timezone('utc',now())
  where club_id=p_club and status='pending';

  perform private.audit_pack4(v_org,v_actor,'clubs',p_club,'archive_club');
end;
$$;

create or replace function private.create_team(
  p_organization uuid,
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_id uuid;
  v_org_admin boolean;
  v_status public.team_status;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_club is not null and not exists(
    select 1 from public.clubs
    where id=p_club and organization_id=p_organization and deleted_at is null and is_active
  ) then
    raise exception 'Club does not belong to this organization';
  end if;

  v_org_admin:=private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,p_organization,array['organization_admin']::public.organization_role[]);

  if not (
    v_org_admin
    or (p_club is not null and private.is_club_admin(v_actor,p_club))
  ) then
    raise exception 'Organization or club administrator access required';
  end if;

  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Team name is required'; end if;

  v_status:=case when v_org_admin then 'active'::public.team_status else 'pending'::public.team_status end;

  insert into public.teams(
    organization_id,club_id,name,short_name,city_or_region,visibility,public_description,status,is_active,created_by,last_edited_by
  )
  values(
    p_organization,
    p_club,
    trim(p_name),
    nullif(trim(coalesce(p_short_name,'')),''),
    nullif(trim(coalesce(p_region,'')),''),
    p_visibility,
    nullif(trim(coalesce(p_description,'')),''),
    v_status,
    v_status='active',
    v_actor,
    v_actor
  )
  returning id into v_id;

  insert into public.team_memberships(
    team_id,user_id,role,display_name,created_by,last_edited_by
  )
  values(v_id,v_actor,'team_admin',private.profile_label(v_actor),v_actor,v_actor);

  perform private.audit_pack4(
    p_organization,v_actor,'teams',v_id,'create_team',
    jsonb_build_object('name',trim(p_name),'clubId',p_club,'status',v_status)
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'An active or pending team with that name already exists';
end;
$$;

create or replace function private.update_team(
  p_team uuid,
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_org uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select organization_id
  into v_org
  from public.teams
  where id=p_team and deleted_at is null;

  if v_org is null then raise exception 'Team not found'; end if;
  if not private.can_manage_team(v_actor,p_team) then raise exception 'Team administrator access required'; end if;

  if p_club is not null and not exists(
    select 1 from public.clubs
    where id=p_club and organization_id=v_org and deleted_at is null and is_active
  ) then
    raise exception 'Club does not belong to this organization';
  end if;

  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Team name is required'; end if;

  update public.teams
  set
    club_id=p_club,
    name=trim(p_name),
    short_name=nullif(trim(coalesce(p_short_name,'')),''),
    city_or_region=nullif(trim(coalesce(p_region,'')),''),
    visibility=p_visibility,
    public_description=nullif(trim(coalesce(p_description,'')),''),
    last_edited_by=v_actor
  where id=p_team;

  perform private.audit_pack4(
    v_org,v_actor,'teams',p_team,'update_team',
    jsonb_build_object('name',trim(p_name),'clubId',p_club)
  );
exception
  when unique_violation then
    raise exception 'An active or pending team with that name already exists';
end;
$$;

create or replace function private.set_team_status(
  p_team uuid,
  p_status public.team_status
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_org uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select organization_id
  into v_org
  from public.teams
  where id=p_team and deleted_at is null
  for update;

  if v_org is null then raise exception 'Team not found'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Organization administrator access required';
  end if;

  if p_status='archived' then
    raise exception 'Use archive_team to archive a team and preserve history';
  end if;

  update public.teams
  set status=p_status,is_active=(p_status='active'),last_edited_by=v_actor
  where id=p_team;

  if p_status<>'active' then
    update public.membership_requests
    set status='cancelled',reviewed_by=v_actor,resolved_at=timezone('utc',now())
    where team_id=p_team and status='pending';
  end if;

  perform private.audit_pack4(
    v_org,v_actor,'teams',p_team,'set_team_status',
    jsonb_build_object('status',p_status)
  );
end;
$$;

create or replace function private.archive_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_org uuid;
  v_club uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select organization_id,club_id
  into v_org,v_club
  from public.teams
  where id=p_team and deleted_at is null
  for update;

  if v_org is null then raise exception 'Team not found'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
    or (v_club is not null and private.is_club_admin(v_actor,v_club))
  ) then
    raise exception 'Organization or club administrator access required';
  end if;

  update public.teams
  set
    status='archived',
    is_active=false,
    deleted_at=timezone('utc',now()),
    deleted_by=v_actor,
    last_edited_by=v_actor
  where id=p_team;

  update public.team_memberships
  set ends_on=coalesce(ends_on,current_date),last_edited_by=v_actor
  where team_id=p_team and ends_on is null;

  update public.membership_requests
  set status='cancelled',reviewed_by=v_actor,resolved_at=timezone('utc',now())
  where team_id=p_team and status='pending';

  perform private.audit_pack4(v_org,v_actor,'teams',p_team,'archive_team');
end;
$$;

create or replace function private.create_membership_invitation(
  p_scope public.membership_scope,
  p_target uuid,
  p_email text,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_token uuid;
  v_request_id uuid;
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_org uuid;
  v_club uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if v_email='' or position('@' in v_email)<2 then raise exception 'A valid invitation email is required'; end if;

  if p_scope='club' then
    if p_club_role is null or p_team_role is not null then raise exception 'Choose one club role'; end if;

    select organization_id
    into v_org
    from public.clubs
    where id=p_target and deleted_at is null and is_active;

    if v_org is null or not private.can_manage_club(v_actor,p_target) then
      raise exception 'Club administrator access required';
    end if;

    if p_club_role='club_admin'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
      ) then
      raise exception 'Only organization administrators can invite club administrators';
    end if;

    insert into public.membership_requests(
      scope,request_kind,club_id,requested_club_role,invite_email,invite_token,expires_at,message,created_by
    )
    values(
      'club','invitation',p_target,p_club_role,v_email,gen_random_uuid(),
      timezone('utc',now())+interval '14 days',
      nullif(trim(coalesce(p_message,'')),''),
      v_actor
    )
    returning id,invite_token into v_request_id,v_token;
  else
    if p_team_role is null or p_club_role is not null then raise exception 'Choose one team role'; end if;

    select organization_id,club_id
    into v_org,v_club
    from public.teams
    where id=p_target and deleted_at is null and is_active and status='active';

    if v_org is null or not private.can_manage_team(v_actor,p_target) then
      raise exception 'Active team administrator access required';
    end if;

    if p_team_role='team_admin'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
      ) then
      raise exception 'Only organization or club administrators can invite team administrators';
    end if;

    if p_team_role='captain'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
        or exists(
          select 1 from public.team_memberships
          where team_id=p_target and user_id=v_actor and role='team_admin' and ends_on is null
        )
      ) then
      raise exception 'Only team, club, or organization administrators can assign captains';
    end if;

    insert into public.membership_requests(
      scope,request_kind,team_id,requested_team_role,invite_email,invite_token,expires_at,message,created_by
    )
    values(
      'team','invitation',p_target,p_team_role,v_email,gen_random_uuid(),
      timezone('utc',now())+interval '14 days',
      nullif(trim(coalesce(p_message,'')),''),
      v_actor
    )
    returning id,invite_token into v_request_id,v_token;
  end if;

  perform private.audit_pack4(
    v_org,v_actor,'membership_requests',v_request_id,'create_membership_invitation',
    jsonb_build_object(
      'scope',p_scope,
      'target',p_target,
      'role',coalesce(p_club_role::text,p_team_role::text),
      'inviteEmail',v_email
    )
  );

  return v_token;
exception
  when unique_violation then
    raise exception 'A matching invitation is already pending';
end;
$$;

create or replace function private.request_membership(
  p_scope public.membership_scope,
  p_target uuid,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_id uuid;
  v_org uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_scope='club' then
    if p_club_role is distinct from 'member' or p_team_role is not null then
      raise exception 'Members may only apply for club member access';
    end if;

    select organization_id
    into v_org
    from public.clubs
    where id=p_target and deleted_at is null and is_active;

    if v_org is null then raise exception 'Club not found'; end if;

    if exists(
      select 1 from public.club_memberships
      where club_id=p_target and user_id=v_actor and role='member' and ends_on is null
    ) then
      raise exception 'You already have this club membership';
    end if;

    insert into public.membership_requests(
      scope,request_kind,club_id,requested_club_role,requester_user_id,message,created_by
    )
    values(
      'club','application',p_target,'member',v_actor,
      nullif(trim(coalesce(p_message,'')),''),
      v_actor
    )
    returning id into v_id;
  else
    if p_team_role is null or p_team_role not in ('fighter','support') or p_club_role is not null then
      raise exception 'Members may only apply as a fighter or support member';
    end if;

    select organization_id
    into v_org
    from public.teams
    where id=p_target and deleted_at is null and is_active and status='active';

    if v_org is null then raise exception 'Active team not found'; end if;

    if exists(
      select 1 from public.team_memberships
      where team_id=p_target and user_id=v_actor and role=p_team_role and ends_on is null
    ) then
      raise exception 'You already have this team membership';
    end if;

    insert into public.membership_requests(
      scope,request_kind,team_id,requested_team_role,requester_user_id,message,created_by
    )
    values(
      'team','application',p_target,p_team_role,v_actor,
      nullif(trim(coalesce(p_message,'')),''),
      v_actor
    )
    returning id into v_id;
  end if;

  perform private.audit_pack4(
    v_org,v_actor,'membership_requests',v_id,'request_membership',
    jsonb_build_object(
      'scope',p_scope,
      'target',p_target,
      'role',coalesce(p_club_role::text,p_team_role::text)
    )
  );

  return v_id;
exception
  when unique_violation then
    raise exception 'A matching membership request is already pending';
end;
$$;

create or replace function private.activate_membership(
  p_request public.membership_requests,
  p_user uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_label text:=private.profile_label(p_user);
  v_identity uuid:=private.self_identity(p_user);
  v_org uuid;
begin
  if p_request.scope='club' then
    select organization_id into v_org from public.clubs where id=p_request.club_id;

    insert into public.club_memberships(
      club_id,user_id,role,display_name,created_by,last_edited_by
    )
    values(
      p_request.club_id,p_user,p_request.requested_club_role,v_label,
      coalesce(p_request.created_by,p_user),coalesce(p_request.created_by,p_user)
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id
      from public.club_memberships
      where club_id=p_request.club_id
        and user_id=p_user
        and role=p_request.requested_club_role
        and ends_on is null
      limit 1;
    end if;
  else
    select organization_id into v_org from public.teams where id=p_request.team_id;

    insert into public.team_memberships(
      team_id,user_id,fighter_identity_id,role,display_name,created_by,last_edited_by
    )
    values(
      p_request.team_id,
      p_user,
      case when p_request.requested_team_role='fighter' then v_identity else null end,
      p_request.requested_team_role,
      v_label,
      coalesce(p_request.created_by,p_user),
      coalesce(p_request.created_by,p_user)
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id
      from public.team_memberships
      where team_id=p_request.team_id
        and user_id=p_user
        and role=p_request.requested_team_role
        and ends_on is null
      limit 1;
    end if;
  end if;

  perform private.audit_pack4(
    v_org,(select auth.uid()),
    case when p_request.scope='club' then 'club_memberships' else 'team_memberships' end,
    v_id,
    'activate_membership',
    jsonb_build_object('requestId',p_request.id,'userId',p_user)
  );

  return v_id;
end;
$$;

create or replace function private.accept_membership_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_email text;
  v_request public.membership_requests%rowtype;
  v_membership uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select lower(email) into v_email from auth.users where id=v_actor;

  select *
  into v_request
  from public.membership_requests
  where invite_token=p_token and request_kind='invitation'
  for update;

  if v_request.id is null then raise exception 'Invitation not found'; end if;
  if v_request.status<>'pending' then raise exception 'Invitation is no longer pending'; end if;

  if v_request.expires_at<=timezone('utc',now()) then
    update public.membership_requests
    set status='expired',resolved_at=timezone('utc',now())
    where id=v_request.id;
    raise exception 'Invitation has expired';
  end if;

  if v_email is null or lower(v_request.invite_email)<>v_email then
    raise exception 'Invitation email does not match the signed-in account';
  end if;

  if v_request.scope='club' then
    if not private.can_manage_club(v_request.created_by,v_request.club_id) then
      raise exception 'The invitation issuer no longer has authority to grant this membership';
    end if;

    if v_request.requested_club_role='club_admin'
      and not (
        private.is_platform_admin(v_request.created_by)
        or exists(
          select 1
          from public.clubs c
          where c.id=v_request.club_id
            and private.has_org_role(
              v_request.created_by,c.organization_id,array['organization_admin']::public.organization_role[]
            )
        )
      ) then
      raise exception 'The invitation issuer no longer has authority to grant club administrator access';
    end if;
  else
    if not exists(
      select 1 from public.teams
      where id=v_request.team_id and deleted_at is null and is_active and status='active'
    ) then
      raise exception 'The invited team is no longer active';
    end if;

    if not private.can_manage_team(v_request.created_by,v_request.team_id) then
      raise exception 'The invitation issuer no longer has authority to grant this membership';
    end if;

    if v_request.requested_team_role='team_admin'
      and not (
        private.is_platform_admin(v_request.created_by)
        or exists(
          select 1
          from public.teams t
          where t.id=v_request.team_id
            and (
              private.has_org_role(
                v_request.created_by,t.organization_id,array['organization_admin']::public.organization_role[]
              )
              or (t.club_id is not null and private.is_club_admin(v_request.created_by,t.club_id))
            )
        )
      ) then
      raise exception 'The invitation issuer no longer has authority to grant team administrator access';
    end if;

    if v_request.requested_team_role='captain'
      and not (
        private.is_platform_admin(v_request.created_by)
        or exists(
          select 1
          from public.teams t
          where t.id=v_request.team_id
            and (
              private.has_org_role(
                v_request.created_by,t.organization_id,array['organization_admin']::public.organization_role[]
              )
              or (t.club_id is not null and private.is_club_admin(v_request.created_by,t.club_id))
              or exists(
                select 1
                from public.team_memberships tm
                where tm.team_id=t.id
                  and tm.user_id=v_request.created_by
                  and tm.role='team_admin'
                  and tm.ends_on is null
              )
            )
        )
      ) then
      raise exception 'The invitation issuer no longer has authority to grant captain access';
    end if;
  end if;

  v_membership:=private.activate_membership(v_request,v_actor);

  update public.membership_requests
  set status='accepted',requester_user_id=v_actor,resolved_at=timezone('utc',now())
  where id=v_request.id;

  perform private.audit_pack4(
    coalesce(
      (select organization_id from public.clubs where id=v_request.club_id),
      (select organization_id from public.teams where id=v_request.team_id)
    ),
    v_actor,
    'membership_requests',
    v_request.id,
    'accept_membership_invitation',
    jsonb_build_object('membershipId',v_membership)
  );

  return v_membership;
end;
$$;

create or replace function private.review_membership_application(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_request public.membership_requests%rowtype;
  v_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select *
  into v_request
  from public.membership_requests
  where id=p_request_id and request_kind='application'
  for update;

  if v_request.id is null then raise exception 'Membership application not found'; end if;
  if v_request.status<>'pending' then raise exception 'Membership application is no longer pending'; end if;
  if p_decision not in ('accept','reject') then raise exception 'Decision must be accept or reject'; end if;

  if v_request.scope='club' and not private.can_manage_club(v_actor,v_request.club_id) then
    raise exception 'Club administrator access required';
  end if;

  if v_request.scope='team' and not private.can_manage_team(v_actor,v_request.team_id) then
    raise exception 'Team administrator access required';
  end if;

  if p_decision='accept' then
    v_id:=private.activate_membership(v_request,v_request.requester_user_id);
  end if;

  update public.membership_requests
  set
    status=case
      when p_decision='accept' then 'accepted'::public.membership_request_status
      else 'rejected'::public.membership_request_status
    end,
    reviewed_by=v_actor,
    resolved_at=timezone('utc',now())
  where id=v_request.id;

  perform private.audit_pack4(
    coalesce(
      (select organization_id from public.clubs where id=v_request.club_id),
      (select organization_id from public.teams where id=v_request.team_id)
    ),
    v_actor,
    'membership_requests',
    v_request.id,
    'review_membership_application',
    jsonb_build_object('decision',p_decision,'membershipId',v_id)
  );

  return v_id;
end;
$$;

create or replace function private.cancel_membership_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_request public.membership_requests%rowtype;
  v_allowed boolean:=false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select *
  into v_request
  from public.membership_requests
  where id=p_request_id and status='pending'
  for update;

  if v_request.id is null then raise exception 'Pending membership request not found'; end if;

  v_allowed:=v_request.requester_user_id=v_actor or v_request.created_by=v_actor;

  if v_request.scope='club' then
    v_allowed:=v_allowed or private.can_manage_club(v_actor,v_request.club_id);
  else
    v_allowed:=v_allowed or private.can_manage_team(v_actor,v_request.team_id);
  end if;

  if not v_allowed then raise exception 'You cannot cancel this membership request'; end if;

  update public.membership_requests
  set status='cancelled',reviewed_by=v_actor,resolved_at=timezone('utc',now())
  where id=v_request.id;

  perform private.audit_pack4(
    coalesce(
      (select organization_id from public.clubs where id=v_request.club_id),
      (select organization_id from public.teams where id=v_request.team_id)
    ),
    v_actor,
    'membership_requests',
    v_request.id,
    'cancel_membership_request'
  );
end;
$$;

create or replace function private.end_membership(
  p_scope public.membership_scope,
  p_membership uuid,
  p_ends_on date default current_date
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_user uuid;
  v_role text;
  v_target uuid;
  v_start date;
  v_org uuid;
  v_club uuid;
  v_allowed boolean:=false;
  v_remaining integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_scope='club' then
    select m.user_id,m.role::text,m.club_id,m.starts_on,c.organization_id
    into v_user,v_role,v_target,v_start,v_org
    from public.club_memberships m
    join public.clubs c on c.id=m.club_id
    where m.id=p_membership and m.ends_on is null
    for update of m;

    if v_user is null then raise exception 'Active club membership not found'; end if;

    v_allowed:=v_user=v_actor or private.can_manage_club(v_actor,v_target);
    if not v_allowed then raise exception 'Club administrator access required'; end if;

    if v_role='club_admin' then
      select count(*)
      into v_remaining
      from public.club_memberships
      where club_id=v_target and role='club_admin' and ends_on is null and id<>p_membership;

      if v_remaining=0 then raise exception 'The last club administrator cannot be removed'; end if;
    end if;

    if p_ends_on<v_start then raise exception 'End date cannot be before membership start'; end if;

    update public.club_memberships
    set ends_on=p_ends_on,last_edited_by=v_actor
    where id=p_membership;

    perform private.audit_pack4(
      v_org,v_actor,'club_memberships',p_membership,'end_membership',
      jsonb_build_object('role',v_role,'endsOn',p_ends_on)
    );
  else
    select m.user_id,m.role::text,m.team_id,m.starts_on,t.organization_id,t.club_id
    into v_user,v_role,v_target,v_start,v_org,v_club
    from public.team_memberships m
    join public.teams t on t.id=m.team_id
    where m.id=p_membership and m.ends_on is null
    for update of m;

    if v_user is null then raise exception 'Active team membership not found'; end if;

    v_allowed:=v_user=v_actor or private.can_manage_team(v_actor,v_target);
    if not v_allowed then raise exception 'Team administrator access required'; end if;

    if v_user<>v_actor
      and v_role in ('team_admin','captain')
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
        or exists(
          select 1 from public.team_memberships tm
          where tm.team_id=v_target and tm.user_id=v_actor and tm.role='team_admin' and tm.ends_on is null
        )
      ) then
      raise exception 'Only team, club, or organization administrators can revoke team leadership';
    end if;

    if v_role='team_admin' then
      select count(*)
      into v_remaining
      from public.team_memberships
      where team_id=v_target and role='team_admin' and ends_on is null and id<>p_membership;

      if v_remaining=0 then raise exception 'The last team administrator cannot be removed'; end if;
    end if;

    if p_ends_on<v_start then raise exception 'End date cannot be before membership start'; end if;

    update public.team_memberships
    set ends_on=p_ends_on,last_edited_by=v_actor
    where id=p_membership;

    perform private.audit_pack4(
      v_org,v_actor,'team_memberships',p_membership,'end_membership',
      jsonb_build_object('role',v_role,'endsOn',p_ends_on)
    );
  end if;
end;
$$;

create or replace function private.change_membership_role(
  p_scope public.membership_scope,
  p_membership uuid,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_user uuid;
  v_target uuid;
  v_old text;
  v_label text;
  v_identity uuid;
  v_org uuid;
  v_club uuid;
  v_new uuid;
  v_remaining integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_scope='club' then
    select m.user_id,m.club_id,m.role::text,m.display_name,c.organization_id
    into v_user,v_target,v_old,v_label,v_org
    from public.club_memberships m
    join public.clubs c on c.id=m.club_id
    where m.id=p_membership and m.ends_on is null
    for update of m;

    if v_user is null then raise exception 'Active club membership not found'; end if;
    if p_club_role is null or p_team_role is not null then raise exception 'Choose one club role'; end if;
    if not private.can_manage_club(v_actor,v_target) or v_user=v_actor then
      raise exception 'Club administrators cannot change their own role';
    end if;

    if p_club_role='club_admin'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
      ) then
      raise exception 'Only organization administrators can assign club administrators';
    end if;

    if v_old='club_admin' then
      select count(*)
      into v_remaining
      from public.club_memberships
      where club_id=v_target and role='club_admin' and ends_on is null and id<>p_membership;

      if v_remaining=0 then raise exception 'The last club administrator cannot be removed'; end if;
    end if;

    update public.club_memberships
    set ends_on=current_date,last_edited_by=v_actor
    where id=p_membership;

    insert into public.club_memberships(
      club_id,user_id,role,display_name,starts_on,created_by,last_edited_by
    )
    values(v_target,v_user,p_club_role,v_label,current_date,v_actor,v_actor)
    returning id into v_new;

    perform private.audit_pack4(
      v_org,v_actor,'club_memberships',v_new,'change_membership_role',
      jsonb_build_object('previousMembershipId',p_membership,'fromRole',v_old,'toRole',p_club_role)
    );
  else
    select m.user_id,m.team_id,m.role::text,m.display_name,m.fighter_identity_id,t.organization_id,t.club_id
    into v_user,v_target,v_old,v_label,v_identity,v_org,v_club
    from public.team_memberships m
    join public.teams t on t.id=m.team_id
    where m.id=p_membership and m.ends_on is null
    for update of m;

    if v_user is null then raise exception 'Active team membership not found'; end if;
    if p_team_role is null or p_club_role is not null then raise exception 'Choose one team role'; end if;
    if not private.can_manage_team(v_actor,v_target) or v_user=v_actor then
      raise exception 'Team leaders cannot change their own role';
    end if;

    if v_old in ('team_admin','captain')
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
        or exists(
          select 1 from public.team_memberships tm
          where tm.team_id=v_target and tm.user_id=v_actor and tm.role='team_admin' and tm.ends_on is null
        )
      ) then
      raise exception 'Only team, club, or organization administrators can change team leadership';
    end if;

    if p_team_role='team_admin'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
      ) then
      raise exception 'Only organization or club administrators can assign team administrators';
    end if;

    if p_team_role='captain'
      and not (
        private.is_platform_admin(v_actor)
        or private.has_org_role(v_actor,v_org,array['organization_admin']::public.organization_role[])
        or (v_club is not null and private.is_club_admin(v_actor,v_club))
        or exists(
          select 1 from public.team_memberships
          where team_id=v_target and user_id=v_actor and role='team_admin' and ends_on is null
        )
      ) then
      raise exception 'Only team, club, or organization administrators can assign captains';
    end if;

    if v_old='team_admin' then
      select count(*)
      into v_remaining
      from public.team_memberships
      where team_id=v_target and role='team_admin' and ends_on is null and id<>p_membership;

      if v_remaining=0 then raise exception 'The last team administrator cannot be removed'; end if;
    end if;

    update public.team_memberships
    set ends_on=current_date,last_edited_by=v_actor
    where id=p_membership;

    if p_team_role='fighter' and v_identity is null then
      v_identity:=private.self_identity(v_user);
    end if;

    insert into public.team_memberships(
      team_id,user_id,fighter_identity_id,role,display_name,starts_on,created_by,last_edited_by
    )
    values(
      v_target,
      v_user,
      case when p_team_role='fighter' then v_identity else null end,
      p_team_role,
      v_label,
      current_date,
      v_actor,
      v_actor
    )
    returning id into v_new;

    perform private.audit_pack4(
      v_org,v_actor,'team_memberships',v_new,'change_membership_role',
      jsonb_build_object('previousMembershipId',p_membership,'fromRole',v_old,'toRole',p_team_role)
    );
  end if;

  return v_new;
end;
$$;

create or replace function public.create_subordinate_organization(
  p_parent_organization_id uuid,
  p_name text,
  p_short_name text,
  p_region text,
  p_kind public.organization_kind,
  p_visibility public.entity_visibility default 'members'
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_subordinate_organization(
    p_parent_organization_id,p_name,p_short_name,p_region,p_kind,p_visibility
  );
$$;

create or replace function public.create_organization_relationship(
  p_parent uuid,
  p_child uuid,
  p_kind public.organization_relationship_kind,
  p_starts_on date default current_date
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_organization_relationship(p_parent,p_child,p_kind,p_starts_on);
$$;

create or replace function public.end_organization_relationship(
  p_relationship uuid,
  p_ends_on date default current_date
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.end_organization_relationship(p_relationship,p_ends_on);
$$;

create or replace function public.create_club(
  p_organization uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null,
  p_website text default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_club(
    p_organization,p_name,p_short_name,p_region,p_visibility,p_description,p_website
  );
$$;

create or replace function public.update_club(
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null,
  p_website text default null
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.update_club(
    p_club,p_name,p_short_name,p_region,p_visibility,p_description,p_website
  );
$$;

create or replace function public.archive_club(p_club uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.archive_club(p_club);
$$;

create or replace function public.create_team(
  p_organization uuid,
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_team(
    p_organization,p_club,p_name,p_short_name,p_region,p_visibility,p_description
  );
$$;

create or replace function public.update_team(
  p_team uuid,
  p_club uuid,
  p_name text,
  p_short_name text default null,
  p_region text default null,
  p_visibility public.entity_visibility default 'members',
  p_description text default null
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.update_team(
    p_team,p_club,p_name,p_short_name,p_region,p_visibility,p_description
  );
$$;

create or replace function public.set_team_status(
  p_team uuid,
  p_status public.team_status
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.set_team_status(p_team,p_status);
$$;

create or replace function public.archive_team(p_team uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.archive_team(p_team);
$$;

create or replace function public.create_membership_invitation(
  p_scope public.membership_scope,
  p_target uuid,
  p_email text,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null,
  p_message text default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_membership_invitation(
    p_scope,p_target,p_email,p_club_role,p_team_role,p_message
  );
$$;

create or replace function public.request_membership(
  p_scope public.membership_scope,
  p_target uuid,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null,
  p_message text default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.request_membership(
    p_scope,p_target,p_club_role,p_team_role,p_message
  );
$$;

create or replace function public.accept_membership_invitation(p_token uuid)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.accept_membership_invitation(p_token);
$$;

create or replace function public.review_membership_application(
  p_request_id uuid,
  p_decision text
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.review_membership_application(p_request_id,p_decision);
$$;

create or replace function public.cancel_membership_request(p_request_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.cancel_membership_request(p_request_id);
$$;

create or replace function public.end_membership(
  p_scope public.membership_scope,
  p_membership uuid,
  p_ends_on date default current_date
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.end_membership(p_scope,p_membership,p_ends_on);
$$;

create or replace function public.change_membership_role(
  p_scope public.membership_scope,
  p_membership uuid,
  p_club_role public.club_role default null,
  p_team_role public.team_role default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.change_membership_role(
    p_scope,p_membership,p_club_role,p_team_role
  );
$$;
