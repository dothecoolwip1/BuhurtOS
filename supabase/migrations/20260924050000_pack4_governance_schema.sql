create type public.organization_kind as enum (
  'international_federation',
  'national_federation',
  'regional_organization',
  'local_organization',
  'independent_organization'
);

create type public.entity_visibility as enum ('public','members','private');
create type public.organization_relationship_kind as enum ('governs','recognizes','affiliate');
create type public.club_role as enum ('club_admin','coach','member');
create type public.team_role as enum ('team_admin','captain','coach','fighter','support');
create type public.membership_scope as enum ('club','team');
create type public.membership_request_kind as enum ('invitation','application');
create type public.membership_request_status as enum ('pending','accepted','rejected','cancelled','expired');

alter table public.organizations
  add column kind public.organization_kind not null default 'independent_organization',
  add column visibility public.entity_visibility not null default 'members',
  add column country_code text,
  add column website_url text,
  add column public_contact_email text;

alter table public.clubs
  add column visibility public.entity_visibility not null default 'members',
  add column public_description text,
  add column logo_path text,
  add column public_contact_email text;

alter table public.teams
  drop constraint if exists teams_organization_id_name_key;

alter table public.teams
  add column short_name text,
  add column visibility public.entity_visibility not null default 'members',
  add column public_description text,
  add column colors jsonb not null default '{}'::jsonb,
  add column website_url text,
  add column public_contact_email text,
  add column founded_on date;

create unique index teams_org_name_active_unique_idx
  on public.teams(organization_id,lower(name))
  where deleted_at is null;

create table public.organization_relationships (
  id uuid primary key default gen_random_uuid(),
  parent_organization_id uuid not null references public.organizations(id) on delete restrict,
  child_organization_id uuid not null references public.organizations(id) on delete restrict,
  relationship_kind public.organization_relationship_kind not null default 'governs',
  starts_on date not null default current_date,
  ends_on date,
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id) default auth.uid(),
  check (parent_organization_id <> child_organization_id),
  check (ends_on is null or ends_on >= starts_on)
);

create unique index organization_relationships_active_unique_idx
  on public.organization_relationships(parent_organization_id,child_organization_id,relationship_kind)
  where ends_on is null;

create index organization_relationships_parent_idx
  on public.organization_relationships(parent_organization_id)
  where ends_on is null;

create index organization_relationships_child_idx
  on public.organization_relationships(child_organization_id)
  where ends_on is null;

create table public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.club_role not null,
  display_name text not null,
  starts_on date not null default current_date,
  ends_on date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id) default auth.uid(),
  check (ends_on is null or ends_on >= starts_on)
);

create unique index club_memberships_active_role_unique_idx
  on public.club_memberships(club_id,user_id,role)
  where ends_on is null;

create index club_memberships_user_idx
  on public.club_memberships(user_id,club_id)
  where ends_on is null;

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  fighter_identity_id uuid references public.fighter_identities(id) on delete set null,
  role public.team_role not null,
  display_name text not null,
  starts_on date not null default current_date,
  ends_on date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id) default auth.uid(),
  check (ends_on is null or ends_on >= starts_on)
);

create unique index team_memberships_active_role_unique_idx
  on public.team_memberships(team_id,user_id,role)
  where ends_on is null;

create index team_memberships_user_idx
  on public.team_memberships(user_id,team_id)
  where ends_on is null;

create index team_memberships_identity_idx
  on public.team_memberships(fighter_identity_id,team_id)
  where fighter_identity_id is not null;

create table public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  scope public.membership_scope not null,
  request_kind public.membership_request_kind not null,
  status public.membership_request_status not null default 'pending',
  club_id uuid references public.clubs(id) on delete restrict,
  team_id uuid references public.teams(id) on delete restrict,
  requested_club_role public.club_role,
  requested_team_role public.team_role,
  requester_user_id uuid references public.profiles(id) on delete cascade,
  invite_email text,
  invite_token uuid,
  expires_at timestamptz,
  message text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check (
    (scope='club' and club_id is not null and team_id is null and requested_club_role is not null and requested_team_role is null)
    or
    (scope='team' and team_id is not null and club_id is null and requested_team_role is not null and requested_club_role is null)
  ),
  check (
    (request_kind='application' and requester_user_id is not null and invite_email is null and invite_token is null)
    or
    (request_kind='invitation' and requester_user_id is null and invite_email is not null and invite_token is not null and expires_at is not null)
  )
);

create unique index membership_requests_pending_club_application_idx
  on public.membership_requests(club_id,requester_user_id,requested_club_role)
  where status='pending' and request_kind='application' and club_id is not null;

create unique index membership_requests_pending_team_application_idx
  on public.membership_requests(team_id,requester_user_id,requested_team_role)
  where status='pending' and request_kind='application' and team_id is not null;

create unique index membership_requests_pending_club_invite_idx
  on public.membership_requests(club_id,lower(invite_email),requested_club_role)
  where status='pending' and request_kind='invitation' and club_id is not null;

create unique index membership_requests_pending_team_invite_idx
  on public.membership_requests(team_id,lower(invite_email),requested_team_role)
  where status='pending' and request_kind='invitation' and team_id is not null;

create unique index membership_requests_token_unique_idx
  on public.membership_requests(invite_token)
  where invite_token is not null;

create trigger organization_relationships_updated
before update on public.organization_relationships
for each row execute function public.set_updated_at();

create trigger club_memberships_updated
before update on public.club_memberships
for each row execute function public.set_updated_at();

create trigger team_memberships_updated
before update on public.team_memberships
for each row execute function public.set_updated_at();

create trigger membership_requests_updated
before update on public.membership_requests
for each row execute function public.set_updated_at();

create or replace function private.organization_reaches(p_start uuid,p_target uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  with recursive descendants(id) as (
    select r.child_organization_id
    from public.organization_relationships r
    where r.parent_organization_id=p_start
      and r.relationship_kind='governs'
      and r.ends_on is null
    union
    select r.child_organization_id
    from public.organization_relationships r
    join descendants d on d.id=r.parent_organization_id
    where r.relationship_kind='governs'
      and r.ends_on is null
  )
  select exists(select 1 from descendants where id=p_target);
$$;

create or replace function private.is_club_admin(p_user uuid,p_club uuid)
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
      and m.role='club_admin'
      and m.ends_on is null
  );
$$;

create or replace function private.is_team_leader(p_user uuid,p_team uuid)
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
      and m.role in ('team_admin','captain')
      and m.ends_on is null
  );
$$;

create or replace function private.can_manage_club(p_user uuid,p_club uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.clubs c
    where c.id=p_club
      and c.deleted_at is null
      and (
        private.is_platform_admin(p_user)
        or private.has_org_role(p_user,c.organization_id,array['organization_admin']::public.organization_role[])
        or private.is_club_admin(p_user,c.id)
      )
  );
$$;

create or replace function private.can_manage_team(p_user uuid,p_team uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.teams t
    where t.id=p_team
      and t.deleted_at is null
      and (
        private.is_platform_admin(p_user)
        or private.has_org_role(p_user,t.organization_id,array['organization_admin']::public.organization_role[])
        or (t.club_id is not null and private.is_club_admin(p_user,t.club_id))
        or private.is_team_leader(p_user,t.id)
      )
  );
$$;

create or replace function private.profile_label(p_user uuid)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(nullif(trim(p.display_name),''),left(p.id::text,8))
  from public.profiles p
  where p.id=p_user;
$$;

create or replace function private.current_auth_email()
returns text
language sql
stable
security definer
set search_path=''
as $$
  select lower(u.email)
  from auth.users u
  where u.id=(select auth.uid());
$$;

create or replace function private.self_identity(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select a.identity_id
  from public.fighter_identity_accounts a
  join public.fighter_identities i on i.id=a.identity_id and i.deleted_at is null
  where a.user_id=p_user
    and a.relationship='self'
    and a.revoked_at is null
  order by a.verified_at asc,a.created_at asc
  limit 1;
$$;

create or replace function private.audit_pack4(
  p_organization uuid,
  p_actor uuid,
  p_table text,
  p_record uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path=''
as $$
  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(p_organization,p_actor,p_table,p_record,p_action,coalesce(p_payload,'{}'::jsonb));
$$;
