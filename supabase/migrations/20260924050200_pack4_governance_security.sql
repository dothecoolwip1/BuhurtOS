create or replace function private.is_club_member(p_user uuid,p_club uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.club_memberships m
    where m.club_id=p_club
      and m.user_id=p_user
      and m.ends_on is null
  );
$$;

create or replace function private.is_team_member(p_user uuid,p_team uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.team_memberships m
    where m.team_id=p_team
      and m.user_id=p_user
      and m.ends_on is null
  );
$$;

create or replace function private.can_view_organization_jurisdiction(
  p_user uuid,
  p_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    private.is_platform_admin(p_user)
    or exists(
      select 1
      from public.organization_memberships m
      where m.user_id=p_user
        and m.role in ('organization_admin','organization_staff')
        and (
          m.organization_id=p_organization
          or private.organization_reaches(m.organization_id,p_organization)
        )
    );
$$;

alter table public.organization_relationships enable row level security;
alter table public.club_memberships enable row level security;
alter table public.team_memberships enable row level security;
alter table public.membership_requests enable row level security;

drop policy if exists teams_org_read on public.teams;
drop policy if exists teams_org_write on public.teams;
drop policy if exists clubs_org_read on public.clubs;
drop policy if exists clubs_org_write on public.clubs;

create policy organizations_public_read
on public.organizations
for select
to anon,authenticated
using (status='active' and visibility='public');

create policy organizations_jurisdiction_read
on public.organizations
for select
to authenticated
using (private.can_view_organization_jurisdiction((select auth.uid()),id));

create policy teams_public_read
on public.teams
for select
to anon,authenticated
using (
  status='active'
  and is_active
  and deleted_at is null
  and visibility='public'
);

create policy teams_member_read
on public.teams
for select
to authenticated
using (
  private.can_view_organization_jurisdiction((select auth.uid()),organization_id)
  or (club_id is not null and private.is_club_admin((select auth.uid()),club_id))
  or private.is_team_member((select auth.uid()),id)
);

create policy clubs_public_read
on public.clubs
for select
to anon,authenticated
using (
  is_active
  and deleted_at is null
  and visibility='public'
);

create policy clubs_member_read
on public.clubs
for select
to authenticated
using (
  private.can_view_organization_jurisdiction((select auth.uid()),organization_id)
  or private.is_club_member((select auth.uid()),id)
);

create policy organization_relationships_public_read
on public.organization_relationships
for select
to anon,authenticated
using (
  ends_on is null
  and exists(
    select 1
    from public.organizations p
    where p.id=parent_organization_id
      and p.status='active'
      and p.visibility='public'
  )
  and exists(
    select 1
    from public.organizations c
    where c.id=child_organization_id
      and c.status='active'
      and c.visibility='public'
  )
);

create policy organization_relationships_member_read
on public.organization_relationships
for select
to authenticated
using (
  private.can_view_organization_jurisdiction((select auth.uid()),parent_organization_id)
  or private.can_view_organization_jurisdiction((select auth.uid()),child_organization_id)
);

create policy club_memberships_read
on public.club_memberships
for select
to authenticated
using (
  user_id=(select auth.uid())
  or private.can_manage_club((select auth.uid()),club_id)
);

create policy team_memberships_read
on public.team_memberships
for select
to authenticated
using (
  user_id=(select auth.uid())
  or private.can_manage_team((select auth.uid()),team_id)
);

create policy membership_requests_read
on public.membership_requests
for select
to authenticated
using (
  requester_user_id=(select auth.uid())
  or created_by=(select auth.uid())
  or (scope='club' and private.can_manage_club((select auth.uid()),club_id))
  or (scope='team' and private.can_manage_team((select auth.uid()),team_id))
  or (
    request_kind='invitation'
    and lower(invite_email)=private.current_auth_email()
  )
);

revoke insert,update,delete on public.clubs from authenticated;
revoke insert,update,delete on public.teams from authenticated;

revoke all on public.organization_relationships from anon,authenticated;
revoke all on public.club_memberships from anon,authenticated;
revoke all on public.team_memberships from anon,authenticated;
revoke all on public.membership_requests from anon,authenticated;

grant select on public.organization_relationships to authenticated;
grant select on public.club_memberships to authenticated;
grant select on public.team_memberships to authenticated;
grant select on public.membership_requests to authenticated;

grant all on public.organization_relationships to service_role;
grant all on public.club_memberships to service_role;
grant all on public.team_memberships to service_role;
grant all on public.membership_requests to service_role;

revoke select on public.organizations from anon;
revoke select on public.clubs from anon;
revoke select on public.teams from anon;

grant select(
  id,name,short_name,region,description,branding,status,kind,visibility,
  country_code,website_url,public_contact_email
) on public.organizations to anon;

grant select(
  id,organization_id,name,short_name,region,website_url,is_active,visibility,
  public_description,logo_path,public_contact_email
) on public.clubs to anon;

grant select(
  id,organization_id,club_id,name,short_name,city_or_region,logo_path,is_active,
  status,visibility,public_description,colors,website_url,public_contact_email,founded_on
) on public.teams to anon;

grant select(
  id,parent_organization_id,child_organization_id,relationship_kind,starts_on,ends_on
) on public.organization_relationships to anon;

revoke all on function private.organization_reaches(uuid,uuid) from public,anon,authenticated;
revoke all on function private.is_club_admin(uuid,uuid) from public,anon,authenticated;
revoke all on function private.is_team_leader(uuid,uuid) from public,anon,authenticated;
revoke all on function private.is_club_member(uuid,uuid) from public,anon,authenticated;
revoke all on function private.is_team_member(uuid,uuid) from public,anon,authenticated;
revoke all on function private.can_manage_club(uuid,uuid) from public,anon,authenticated;
revoke all on function private.can_manage_team(uuid,uuid) from public,anon,authenticated;
revoke all on function private.can_view_organization_jurisdiction(uuid,uuid) from public,anon,authenticated;
revoke all on function private.profile_label(uuid) from public,anon,authenticated;
revoke all on function private.current_auth_email() from public,anon,authenticated;
revoke all on function private.self_identity(uuid) from public,anon,authenticated;
revoke all on function private.audit_pack4(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;

revoke all on function private.create_subordinate_organization(uuid,text,text,text,public.organization_kind,public.entity_visibility) from public,anon,authenticated;
revoke all on function private.create_organization_relationship(uuid,uuid,public.organization_relationship_kind,date) from public,anon,authenticated;
revoke all on function private.end_organization_relationship(uuid,date) from public,anon,authenticated;
revoke all on function private.create_club(uuid,text,text,text,public.entity_visibility,text,text) from public,anon,authenticated;
revoke all on function private.update_club(uuid,text,text,text,public.entity_visibility,text,text) from public,anon,authenticated;
revoke all on function private.archive_club(uuid) from public,anon,authenticated;
revoke all on function private.create_team(uuid,uuid,text,text,text,public.entity_visibility,text) from public,anon,authenticated;
revoke all on function private.update_team(uuid,uuid,text,text,text,public.entity_visibility,text) from public,anon,authenticated;
revoke all on function private.set_team_status(uuid,public.team_status) from public,anon,authenticated;
revoke all on function private.archive_team(uuid) from public,anon,authenticated;
revoke all on function private.create_membership_invitation(public.membership_scope,uuid,text,public.club_role,public.team_role,text) from public,anon,authenticated;
revoke all on function private.request_membership(public.membership_scope,uuid,public.club_role,public.team_role,text) from public,anon,authenticated;
revoke all on function private.activate_membership(public.membership_requests,uuid) from public,anon,authenticated;
revoke all on function private.accept_membership_invitation(uuid) from public,anon,authenticated;
revoke all on function private.review_membership_application(uuid,text) from public,anon,authenticated;
revoke all on function private.cancel_membership_request(uuid) from public,anon,authenticated;
revoke all on function private.end_membership(public.membership_scope,uuid,date) from public,anon,authenticated;
revoke all on function private.change_membership_role(public.membership_scope,uuid,public.club_role,public.team_role) from public,anon,authenticated;

grant usage on schema private to authenticated;

grant execute on function private.is_club_admin(uuid,uuid) to authenticated;
grant execute on function private.is_club_member(uuid,uuid) to authenticated;
grant execute on function private.is_team_member(uuid,uuid) to authenticated;
grant execute on function private.can_manage_club(uuid,uuid) to authenticated;
grant execute on function private.can_manage_team(uuid,uuid) to authenticated;
grant execute on function private.can_view_organization_jurisdiction(uuid,uuid) to authenticated;
grant execute on function private.current_auth_email() to authenticated;

grant execute on function private.create_subordinate_organization(uuid,text,text,text,public.organization_kind,public.entity_visibility) to authenticated;
grant execute on function private.create_organization_relationship(uuid,uuid,public.organization_relationship_kind,date) to authenticated;
grant execute on function private.end_organization_relationship(uuid,date) to authenticated;
grant execute on function private.create_club(uuid,text,text,text,public.entity_visibility,text,text) to authenticated;
grant execute on function private.update_club(uuid,text,text,text,public.entity_visibility,text,text) to authenticated;
grant execute on function private.archive_club(uuid) to authenticated;
grant execute on function private.create_team(uuid,uuid,text,text,text,public.entity_visibility,text) to authenticated;
grant execute on function private.update_team(uuid,uuid,text,text,text,public.entity_visibility,text) to authenticated;
grant execute on function private.set_team_status(uuid,public.team_status) to authenticated;
grant execute on function private.archive_team(uuid) to authenticated;
grant execute on function private.create_membership_invitation(public.membership_scope,uuid,text,public.club_role,public.team_role,text) to authenticated;
grant execute on function private.request_membership(public.membership_scope,uuid,public.club_role,public.team_role,text) to authenticated;
grant execute on function private.accept_membership_invitation(uuid) to authenticated;
grant execute on function private.review_membership_application(uuid,text) to authenticated;
grant execute on function private.cancel_membership_request(uuid) to authenticated;
grant execute on function private.end_membership(public.membership_scope,uuid,date) to authenticated;
grant execute on function private.change_membership_role(public.membership_scope,uuid,public.club_role,public.team_role) to authenticated;

revoke all on function public.create_subordinate_organization(uuid,text,text,text,public.organization_kind,public.entity_visibility) from public,anon;
revoke all on function public.create_organization_relationship(uuid,uuid,public.organization_relationship_kind,date) from public,anon;
revoke all on function public.end_organization_relationship(uuid,date) from public,anon;
revoke all on function public.create_club(uuid,text,text,text,public.entity_visibility,text,text) from public,anon;
revoke all on function public.update_club(uuid,text,text,text,public.entity_visibility,text,text) from public,anon;
revoke all on function public.archive_club(uuid) from public,anon;
revoke all on function public.create_team(uuid,uuid,text,text,text,public.entity_visibility,text) from public,anon;
revoke all on function public.update_team(uuid,uuid,text,text,text,public.entity_visibility,text) from public,anon;
revoke all on function public.set_team_status(uuid,public.team_status) from public,anon;
revoke all on function public.archive_team(uuid) from public,anon;
revoke all on function public.create_membership_invitation(public.membership_scope,uuid,text,public.club_role,public.team_role,text) from public,anon;
revoke all on function public.request_membership(public.membership_scope,uuid,public.club_role,public.team_role,text) from public,anon;
revoke all on function public.accept_membership_invitation(uuid) from public,anon;
revoke all on function public.review_membership_application(uuid,text) from public,anon;
revoke all on function public.cancel_membership_request(uuid) from public,anon;
revoke all on function public.end_membership(public.membership_scope,uuid,date) from public,anon;
revoke all on function public.change_membership_role(public.membership_scope,uuid,public.club_role,public.team_role) from public,anon;

grant execute on function public.create_subordinate_organization(uuid,text,text,text,public.organization_kind,public.entity_visibility) to authenticated;
grant execute on function public.create_organization_relationship(uuid,uuid,public.organization_relationship_kind,date) to authenticated;
grant execute on function public.end_organization_relationship(uuid,date) to authenticated;
grant execute on function public.create_club(uuid,text,text,text,public.entity_visibility,text,text) to authenticated;
grant execute on function public.update_club(uuid,text,text,text,public.entity_visibility,text,text) to authenticated;
grant execute on function public.archive_club(uuid) to authenticated;
grant execute on function public.create_team(uuid,uuid,text,text,text,public.entity_visibility,text) to authenticated;
grant execute on function public.update_team(uuid,uuid,text,text,text,public.entity_visibility,text) to authenticated;
grant execute on function public.set_team_status(uuid,public.team_status) to authenticated;
grant execute on function public.archive_team(uuid) to authenticated;
grant execute on function public.create_membership_invitation(public.membership_scope,uuid,text,public.club_role,public.team_role,text) to authenticated;
grant execute on function public.request_membership(public.membership_scope,uuid,public.club_role,public.team_role,text) to authenticated;
grant execute on function public.accept_membership_invitation(uuid) to authenticated;
grant execute on function public.review_membership_application(uuid,text) to authenticated;
grant execute on function public.cancel_membership_request(uuid) to authenticated;
grant execute on function public.end_membership(public.membership_scope,uuid,date) to authenticated;
grant execute on function public.change_membership_role(public.membership_scope,uuid,public.club_role,public.team_role) to authenticated;
