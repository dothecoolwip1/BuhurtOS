-- MEGA PACK 1 permanent identity, organization, competition configuration and authorization foundation.
-- This migration is additive and preserves the existing event/match schema and historical rows.

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active','invited','disabled')),
  add column if not exists last_seen_at timestamptz;

alter table public.organizations
  add column if not exists slug text,
  add column if not exists logo_path text,
  add column if not exists country_code text,
  add column if not exists website_url text,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists configuration jsonb not null default '{}'::jsonb,
  add column if not exists is_public boolean not null default true,
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz;

update public.organizations
set slug = lower(regexp_replace(trim(short_name), '[^a-zA-Z0-9]+', '-', 'g'))
where slug is null;

alter table public.organizations alter column slug set not null;
create unique index if not exists organizations_slug_unique
  on public.organizations(lower(slug)) where deleted_at is null;

alter table public.seasons
  add column if not exists ruleset_id uuid references public.rulesets(id) on delete restrict,
  add column if not exists championship_config jsonb not null default '{}'::jsonb,
  add column if not exists configuration_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists finalized_at timestamptz,
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null check (length(trim(name)) > 1),
  short_name text,
  logo_path text,
  country_code text,
  province_state text,
  city text,
  description text,
  website_url text,
  social_links jsonb not null default '{}'::jsonb,
  contact_information jsonb not null default '{}'::jsonb,
  public_roster boolean not null default true,
  is_active boolean not null default true,
  merged_into_id uuid references public.clubs(id) on delete restrict,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  check (merged_into_id is null or merged_into_id <> id)
);

create unique index clubs_org_name_unique
  on public.clubs(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where deleted_at is null;

create table public.club_organization_affiliations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  affiliation_type text not null default 'member'
    check (affiliation_type in ('member','recognized','affiliate','sanctioned','former')),
  starts_on date,
  ends_on date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index club_org_affiliations_org_idx on public.club_organization_affiliations(organization_id, club_id);
create index club_org_affiliations_club_idx on public.club_organization_affiliations(club_id, starts_on desc);

create table public.club_training_locations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  address_text text,
  city text,
  province_state text,
  country_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  schedule_text text,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.disciplines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  competition_kind text not null default 'individual'
    check (competition_kind in ('individual','team','hybrid')),
  description text,
  default_team_size integer check (default_team_size is null or default_team_size > 0),
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create unique index disciplines_scope_code_unique
  on public.disciplines(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code))
  where deleted_at is null;

create table public.age_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  minimum_age integer check (minimum_age is null or minimum_age >= 0),
  maximum_age integer check (maximum_age is null or maximum_age >= 0),
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (maximum_age is null or minimum_age is null or maximum_age >= minimum_age)
);

create table public.weight_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  minimum_kg numeric(8,3) check (minimum_kg is null or minimum_kg >= 0),
  maximum_kg numeric(8,3) check (maximum_kg is null or maximum_kg >= 0),
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (maximum_kg is null or minimum_kg is null or maximum_kg >= minimum_kg)
);

create table public.gender_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete restrict,
  name text not null,
  code text not null,
  age_class_id uuid references public.age_classes(id) on delete restrict,
  weight_class_id uuid references public.weight_classes(id) on delete restrict,
  gender_class_id uuid references public.gender_classes(id) on delete restrict,
  minimum_fighters integer check (minimum_fighters is null or minimum_fighters > 0),
  maximum_fighters integer check (maximum_fighters is null or maximum_fighters > 0),
  substitutions_allowed integer check (substitutions_allowed is null or substitutions_allowed >= 0),
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  check (maximum_fighters is null or minimum_fighters is null or maximum_fighters >= minimum_fighters)
);

create unique index divisions_scope_code_unique
  on public.divisions(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code))
  where deleted_at is null;

create table public.competition_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  name text not null,
  code text not null,
  team_size integer check (team_size is null or team_size > 0),
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create unique index competition_categories_scope_code_unique
  on public.competition_categories(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code))
  where deleted_at is null;

alter table public.teams
  alter column organization_id drop not null,
  add column if not exists club_id uuid references public.clubs(id) on delete set null,
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists division_id uuid references public.divisions(id) on delete set null,
  add column if not exists team_type text not null default 'permanent'
    check (team_type in ('permanent','season','a_team','b_team','womens','youth','competition','tournament','temporary','mercenary','mixed')),
  add column if not exists country_code text,
  add column if not exists public_roster boolean not null default true,
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists merged_into_id uuid references public.teams(id) on delete restrict,
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz;

alter table public.fighters
  alter column organization_id drop not null,
  add column if not exists country_code text,
  add column if not exists province_state text,
  add column if not exists city text,
  add column if not exists nationality text,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists public_profile boolean not null default true,
  add column if not exists is_temporary boolean not null default false,
  add column if not exists merged_into_id uuid references public.fighters(id) on delete restrict,
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists deleted_at timestamptz;

create index fighters_public_name_idx on public.fighters(lower(name)) where deleted_at is null;
create index fighters_merged_into_idx on public.fighters(merged_into_id) where merged_into_id is not null;
create index teams_club_idx on public.teams(club_id) where deleted_at is null;
create index teams_season_idx on public.teams(season_id) where deleted_at is null;

create table public.fighter_private_details (
  fighter_id uuid primary key references public.fighters(id) on delete cascade,
  legal_name text,
  membership_status text,
  insurance_status text,
  eligibility_data jsonb not null default '{}'::jsonb,
  private_contact jsonb not null default '{}'::jsonb,
  private_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles(id)
);

insert into public.fighter_private_details(fighter_id, private_notes)
select id, notes from public.fighters
where notes is not null
on conflict (fighter_id) do nothing;

create table public.fighter_user_links (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  relationship text not null default 'owner' check (relationship in ('owner','delegate')),
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  check (ends_at is null or ends_at > starts_at)
);

create unique index fighter_user_active_fighter_unique
  on public.fighter_user_links(fighter_id)
  where ends_at is null and relationship = 'owner';

create unique index fighter_user_active_user_unique
  on public.fighter_user_links(user_id)
  where ends_at is null and relationship = 'owner';

insert into public.fighter_user_links(fighter_id,user_id,relationship,approved_by)
select id,user_id,'owner',user_id
from public.fighters
where user_id is not null
on conflict do nothing;

create table public.fighter_affiliations (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  club_id uuid references public.clubs(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  affiliation_type text not null
    check (affiliation_type in ('home_club','permanent_team','season_team','tournament_team','temporary_team','mercenary','historical_representation')),
  starts_on date,
  ends_on date,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  check (club_id is not null or team_id is not null),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index fighter_affiliations_fighter_history_idx on public.fighter_affiliations(fighter_id, starts_on desc, created_at desc);
create index fighter_affiliations_team_idx on public.fighter_affiliations(team_id, fighter_id) where team_id is not null;
create index fighter_affiliations_club_idx on public.fighter_affiliations(club_id, fighter_id) where club_id is not null;
create index fighter_affiliations_event_idx on public.fighter_affiliations(event_id, fighter_id) where event_id is not null;

create table public.club_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  fighter_id uuid references public.fighters(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('captain','coach','manager','trainer','other')),
  display_name text,
  starts_on date,
  ends_on date,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  check (fighter_id is not null or user_id is not null or display_name is not null)
);

create table public.officials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  fighter_id uuid references public.fighters(id) on delete set null,
  display_name text not null,
  country_code text,
  province_state text,
  qualifications jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','suspended','retired')),
  public_profile boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create table public.official_organization_affiliations (
  id uuid primary key default gen_random_uuid(),
  official_id uuid not null references public.officials(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role_title text,
  certification_status text,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default timezone('utc', now()),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.fighter_profile_claims (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  statement text,
  evidence_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index fighter_claim_pending_unique
  on public.fighter_profile_claims(fighter_id,user_id) where status = 'pending';

create table public.event_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  competition_category_id uuid not null references public.competition_categories(id) on delete restrict,
  ruleset_id uuid references public.rulesets(id) on delete restrict,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique(event_id, competition_category_id)
);

create table public.season_awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  description text,
  fighter_id uuid references public.fighters(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  club_id uuid references public.clubs(id) on delete set null,
  awarded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.season_qualification_rules (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.season_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  ruleset_id uuid references public.rulesets(id) on delete restrict,
  captured_at timestamptz not null default timezone('utc', now()),
  reason text,
  standings jsonb not null,
  created_by uuid references public.profiles(id)
);

create index season_ranking_snapshots_lookup_idx on public.season_ranking_snapshots(season_id, captured_at desc);

create table public.permissions (
  permission_key text primary key,
  description text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.role_definitions (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  name text not null,
  scope_type text not null check (scope_type in ('platform','organization','event','team')),
  organization_id uuid references public.organizations(id) on delete cascade,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.role_permissions (
  role_id uuid not null references public.role_definitions(id) on delete cascade,
  permission_key text not null references public.permissions(permission_key) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key(role_id, permission_key)
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.role_definitions(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  deleted_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);

create index access_grants_user_idx on public.access_grants(user_id, deleted_at, expires_at);
create index access_grants_org_idx on public.access_grants(organization_id, user_id) where organization_id is not null and deleted_at is null;
create index access_grants_event_idx on public.access_grants(event_id, user_id) where event_id is not null and deleted_at is null;
create index access_grants_team_idx on public.access_grants(team_id, user_id) where team_id is not null and deleted_at is null;

create table public.entity_merges (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('fighter','team','club')),
  source_id uuid not null,
  target_id uuid not null,
  reason text not null,
  relationship_counts jsonb not null default '{}'::jsonb,
  performed_by uuid not null references public.profiles(id),
  performed_at timestamptz not null default timezone('utc', now()),
  check (source_id <> target_id)
);

create table public.sync_operations (
  operation_id uuid primary key,
  user_id uuid references public.profiles(id) on delete set null,
  operation_type text not null,
  entity_type text,
  entity_id uuid,
  payload_hash text,
  state text not null default 'accepted' check (state in ('accepted','completed','failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index sync_operations_user_time_idx on public.sync_operations(user_id, created_at desc);

insert into public.permissions(permission_key, description) values
('platform.admin','Administer the platform'),
('organization.manage','Manage organization configuration'),
('season.manage','Manage seasons and historical snapshots'),
('ruleset.manage','Manage versioned rulesets'),
('division.manage','Manage disciplines, divisions and categories'),
('club.manage','Manage clubs and club affiliations'),
('team.manage','Manage teams and rosters'),
('fighter.manage','Manage fighter identities and affiliations'),
('fighter.claim.review','Review fighter profile claims'),
('duplicate.merge','Merge duplicate permanent identities'),
('roles.manage','Manage scoped access and memberships'),
('event.view_private','View private event operations'),
('event.manage','Manage event configuration'),
('roster.manage','Manage event rosters'),
('registration.manage','Review event registrations'),
('armor.inspect','Record armor inspection clearance'),
('medical.manage','Record restricted medical clearance state'),
('match.manage','Manage field match state'),
('match.score','Score and finalize matches'),
('bracket.manage','Create and manage competition structures'),
('announcement.manage','Manage event announcements'),
('discipline.manage','Manage disciplinary records'),
('notes.team','Use team scoped fight notes'),
('profile.self','Manage own profile')
on conflict(permission_key) do update set description = excluded.description;

insert into public.role_definitions(role_key,name,scope_type,is_system) values
('platform_super_admin','Platform Administrator','platform',true),
('platform_staff','Platform Staff','platform',true),
('organization_admin','Organization Administrator','organization',true),
('organization_staff','Organization Staff','organization',true),
('tournament_director','Tournament Director','event',true),
('event_organizer','Event Organizer','event',true),
('field_marshal','Field Marshal','event',true),
('assistant_marshal','Assistant Marshal','event',true),
('scorekeeper','Scorekeeper','event',true),
('registration_staff','Registration Staff','event',true),
('armor_inspector','Armor Inspector','event',true),
('medical_staff','Medical Staff','event',true),
('team_captain','Team Captain','event',true),
('fighter','Fighter','event',true)
on conflict(role_key) do update set name=excluded.name, scope_type=excluded.scope_type, is_system=true;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array[
  'platform.admin','organization.manage','season.manage','ruleset.manage','division.manage','club.manage','team.manage',
  'fighter.manage','fighter.claim.review','duplicate.merge','roles.manage','event.view_private','event.manage','roster.manage',
  'registration.manage','armor.inspect','medical.manage','match.manage','match.score','bracket.manage','announcement.manage',
  'discipline.manage','notes.team','profile.self'
]::text[]) p(permission_key)
where r.role_key='platform_super_admin'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array[
  'organization.manage','season.manage','ruleset.manage','division.manage','club.manage','team.manage','fighter.manage',
  'fighter.claim.review','duplicate.merge','roles.manage','event.view_private','event.manage','roster.manage','registration.manage',
  'armor.inspect','medical.manage','match.manage','match.score','bracket.manage','announcement.manage','discipline.manage','notes.team','profile.self'
]::text[]) p(permission_key)
where r.role_key='organization_admin'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array['event.view_private','profile.self']::text[]) p(permission_key)
where r.role_key in ('platform_staff','organization_staff')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array[
  'event.view_private','event.manage','roster.manage','registration.manage','armor.inspect','medical.manage','match.manage',
  'match.score','bracket.manage','announcement.manage','discipline.manage','notes.team'
]::text[]) p(permission_key)
where r.role_key in ('tournament_director','event_organizer')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array['event.view_private','roster.manage','armor.inspect','match.manage','match.score','announcement.manage','discipline.manage','notes.team']::text[]) p(permission_key)
where r.role_key='field_marshal'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key
from public.role_definitions r
cross join lateral unnest(array['event.view_private','roster.manage','armor.inspect','match.manage','match.score','announcement.manage','notes.team']::text[]) p(permission_key)
where r.role_key='assistant_marshal'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','match.score']::text[]) p(permission_key)
where r.role_key='scorekeeper'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','registration.manage','roster.manage']::text[]) p(permission_key)
where r.role_key='registration_staff'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','armor.inspect']::text[]) p(permission_key)
where r.role_key='armor_inspector'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','medical.manage']::text[]) p(permission_key)
where r.role_key='medical_staff'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','team.manage','notes.team']::text[]) p(permission_key)
where r.role_key='team_captain'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_key)
select r.id,p.permission_key from public.role_definitions r
cross join lateral unnest(array['event.view_private','profile.self']::text[]) p(permission_key)
where r.role_key='fighter'
on conflict do nothing;

create or replace function private.user_has_permission(
  check_user uuid,
  check_permission text,
  check_org uuid default null,
  check_event uuid default null,
  check_team uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    check_user is not null
    and (
      private.is_platform_admin(check_user)
      or exists (
        select 1
        from public.access_grants ag
        join public.role_definitions rd on rd.id=ag.role_id and rd.is_active
        join public.role_permissions rp on rp.role_id=rd.id and rp.permission_key=check_permission
        where ag.user_id=check_user
          and ag.deleted_at is null
          and (ag.expires_at is null or ag.expires_at > timezone('utc',now()))
          and (
            rd.scope_type='platform'
            or (rd.scope_type='organization' and check_org is not null and ag.organization_id=check_org)
            or (rd.scope_type='event' and check_event is not null and ag.event_id=check_event and (check_team is null or ag.team_id is null or ag.team_id=check_team))
            or (rd.scope_type='team' and check_team is not null and ag.team_id=check_team)
          )
      )
      or exists (
        select 1
        from public.organization_memberships om
        join public.role_definitions rd on rd.role_key=om.role::text and rd.is_active
        join public.role_permissions rp on rp.role_id=rd.id and rp.permission_key=check_permission
        where om.user_id=check_user
          and check_org is not null
          and om.organization_id=check_org
      )
      or exists (
        select 1
        from public.event_memberships em
        join public.role_definitions rd on rd.role_key=em.role::text and rd.is_active
        join public.role_permissions rp on rp.role_id=rd.id and rp.permission_key=check_permission
        where em.user_id=check_user
          and check_event is not null
          and em.event_id=check_event
          and (check_team is null or em.team_id is null or em.team_id=check_team)
      )
    );
$$;

revoke execute on function private.user_has_permission(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.user_has_permission(uuid,text,uuid,uuid,uuid) to authenticated;

create or replace function public.current_user_permissions()
returns table(permission_key text, organization_id uuid, event_id uuid, team_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as user_id),
  normalized as (
    select rp.permission_key, ag.organization_id, ag.event_id, ag.team_id
    from public.access_grants ag
    join me on me.user_id=ag.user_id
    join public.role_definitions rd on rd.id=ag.role_id and rd.is_active
    join public.role_permissions rp on rp.role_id=rd.id
    where ag.deleted_at is null and (ag.expires_at is null or ag.expires_at > timezone('utc',now()))
    union
    select rp.permission_key, om.organization_id, null::uuid, null::uuid
    from public.organization_memberships om
    join me on me.user_id=om.user_id
    join public.role_definitions rd on rd.role_key=om.role::text
    join public.role_permissions rp on rp.role_id=rd.id
    union
    select rp.permission_key, e.organization_id, em.event_id, em.team_id
    from public.event_memberships em
    join me on me.user_id=em.user_id
    join public.events e on e.id=em.event_id
    join public.role_definitions rd on rd.role_key=em.role::text
    join public.role_permissions rp on rp.role_id=rd.id
    union
    select p.permission_key, null::uuid, null::uuid, null::uuid
    from public.permissions p
    join me on private.is_platform_admin(me.user_id)
  )
  select distinct * from normalized;
$$;

revoke execute on function public.current_user_permissions() from public, anon;
grant execute on function public.current_user_permissions() to authenticated;

create or replace function public.review_fighter_profile_claim(
  p_claim_id uuid,
  p_status text,
  p_decision_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.fighter_profile_claims%rowtype;
  v_fighter public.fighters%rowtype;
  v_org uuid;
begin
  if p_status not in ('approved','rejected') then raise exception 'Claim decision must be approved or rejected'; end if;

  select * into v_claim from public.fighter_profile_claims where id=p_claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if v_claim.status <> 'pending' then raise exception 'Claim has already been reviewed'; end if;

  select * into v_fighter from public.fighters where id=v_claim.fighter_id;
  if not found then raise exception 'Fighter not found'; end if;
  v_org := v_fighter.organization_id;

  if not (
    private.is_platform_admin((select auth.uid()))
    or (v_org is not null and private.user_has_permission((select auth.uid()),'fighter.claim.review',v_org,null,null))
  ) then raise exception 'Not authorized to review this claim'; end if;

  update public.fighter_profile_claims
  set status=p_status, reviewed_by=(select auth.uid()), reviewed_at=timezone('utc',now()),
      decision_notes=nullif(trim(coalesce(p_decision_notes,'')),'')
  where id=p_claim_id;

  if p_status='approved' then
    if exists (select 1 from public.fighter_user_links where user_id=v_claim.user_id and relationship='owner' and ends_at is null and fighter_id<>v_claim.fighter_id) then
      raise exception 'This user already owns another active fighter profile';
    end if;
    if exists (select 1 from public.fighter_user_links where fighter_id=v_claim.fighter_id and relationship='owner' and ends_at is null and user_id<>v_claim.user_id) then
      raise exception 'This fighter profile is already claimed';
    end if;

    insert into public.fighter_user_links(fighter_id,user_id,relationship,approved_by)
    values(v_claim.fighter_id,v_claim.user_id,'owner',(select auth.uid()))
    on conflict do nothing;

    update public.fighters set user_id=v_claim.user_id, updated_by=(select auth.uid()) where id=v_claim.fighter_id;
  end if;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(v_org,(select auth.uid()),'fighter_profile_claims',p_claim_id,'review_claim',
         jsonb_build_object('status',p_status,'fighterId',v_claim.fighter_id,'userId',v_claim.user_id));
  return v_claim.fighter_id;
end;
$$;

revoke execute on function public.review_fighter_profile_claim(uuid,text,text) from public, anon;
grant execute on function public.review_fighter_profile_claim(uuid,text,text) to authenticated;

create or replace function public.merge_identity_records(
  p_entity_type text,
  p_source_id uuid,
  p_target_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_counts jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_merge_id uuid := gen_random_uuid();
begin
  if p_source_id=p_target_id then raise exception 'Source and target must differ'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Merge reason is required'; end if;

  if p_entity_type='fighter' then
    perform 1 from public.fighters where id in (p_source_id,p_target_id) order by id for update;
    if (select count(*) from public.fighters where id in (p_source_id,p_target_id)) <> 2 then raise exception 'Fighter source or target not found'; end if;
    select coalesce((select organization_id from public.fighters where id=p_target_id),(select organization_id from public.fighters where id=p_source_id)) into v_org;
    if not (private.is_platform_admin((select auth.uid())) or (v_org is not null and private.user_has_permission((select auth.uid()),'duplicate.merge',v_org,null,null))) then raise exception 'Not authorized to merge fighters'; end if;

    update public.event_roster_entries set fighter_id=p_target_id where fighter_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('eventRosterEntries',v_count);
    update public.disciplinary_cards set fighter_id=p_target_id where fighter_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('disciplinaryCards',v_count);
    update public.fighter_affiliations set fighter_id=p_target_id where fighter_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('affiliations',v_count);
    update public.fighter_profile_claims set fighter_id=p_target_id where fighter_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('claims',v_count);

    insert into public.fighter_user_links(fighter_id,user_id,relationship,starts_at,ends_at,approved_by)
    select p_target_id,user_id,relationship,starts_at,ends_at,approved_by
    from public.fighter_user_links where fighter_id=p_source_id
    on conflict do nothing;
    delete from public.fighter_user_links where fighter_id=p_source_id;

    update public.fighters
    set merged_into_id=p_target_id, is_active=false, deleted_at=timezone('utc',now()), updated_by=(select auth.uid()), user_id=null
    where id=p_source_id;

  elsif p_entity_type='team' then
    perform 1 from public.teams where id in (p_source_id,p_target_id) order by id for update;
    if (select count(*) from public.teams where id in (p_source_id,p_target_id)) <> 2 then raise exception 'Team source or target not found'; end if;
    select coalesce((select organization_id from public.teams where id=p_target_id),(select organization_id from public.teams where id=p_source_id)) into v_org;
    if not (private.is_platform_admin((select auth.uid())) or (v_org is not null and private.user_has_permission((select auth.uid()),'duplicate.merge',v_org,null,null))) then raise exception 'Not authorized to merge teams'; end if;

    update public.event_roster_entries set team_id=p_target_id where team_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('eventRosterEntries',v_count);
    update public.event_memberships set team_id=p_target_id where team_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('eventMemberships',v_count);
    update public.fighters set team_id=p_target_id where team_id=p_source_id;
    update public.fighter_affiliations set team_id=p_target_id where team_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('affiliations',v_count);

    update public.teams set merged_into_id=p_target_id,is_active=false,deleted_at=timezone('utc',now()),updated_by=(select auth.uid()) where id=p_source_id;

  elsif p_entity_type='club' then
    perform 1 from public.clubs where id in (p_source_id,p_target_id) order by id for update;
    if (select count(*) from public.clubs where id in (p_source_id,p_target_id)) <> 2 then raise exception 'Club source or target not found'; end if;
    select coalesce((select organization_id from public.clubs where id=p_target_id),(select organization_id from public.clubs where id=p_source_id)) into v_org;
    if not (private.is_platform_admin((select auth.uid())) or (v_org is not null and private.user_has_permission((select auth.uid()),'duplicate.merge',v_org,null,null))) then raise exception 'Not authorized to merge clubs'; end if;

    update public.teams set club_id=p_target_id where club_id=p_source_id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('teams',v_count);
    update public.fighter_affiliations set club_id=p_target_id where club_id=p_source_id;
    update public.club_training_locations set club_id=p_target_id where club_id=p_source_id;
    update public.club_staff_assignments set club_id=p_target_id where club_id=p_source_id;
    update public.club_organization_affiliations set club_id=p_target_id where club_id=p_source_id;

    update public.clubs set merged_into_id=p_target_id,is_active=false,deleted_at=timezone('utc',now()),updated_by=(select auth.uid()) where id=p_source_id;
  else
    raise exception 'Unsupported merge entity type';
  end if;

  insert into public.entity_merges(id,entity_type,source_id,target_id,reason,relationship_counts,performed_by)
  values(v_merge_id,p_entity_type,p_source_id,p_target_id,trim(p_reason),v_counts,(select auth.uid()));

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(v_org,(select auth.uid()),p_entity_type,p_target_id,'merge',
         jsonb_build_object('sourceId',p_source_id,'targetId',p_target_id,'reason',trim(p_reason),'counts',v_counts));

  return v_merge_id;
end;
$$;

revoke execute on function public.merge_identity_records(text,uuid,uuid,text) from public, anon;
grant execute on function public.merge_identity_records(text,uuid,uuid,text) to authenticated;

-- RLS for every new Data API table.
alter table public.clubs enable row level security;
alter table public.club_organization_affiliations enable row level security;
alter table public.club_training_locations enable row level security;
alter table public.club_staff_assignments enable row level security;
alter table public.disciplines enable row level security;
alter table public.age_classes enable row level security;
alter table public.weight_classes enable row level security;
alter table public.gender_classes enable row level security;
alter table public.divisions enable row level security;
alter table public.competition_categories enable row level security;
alter table public.fighter_private_details enable row level security;
alter table public.fighter_user_links enable row level security;
alter table public.fighter_affiliations enable row level security;
alter table public.officials enable row level security;
alter table public.official_organization_affiliations enable row level security;
alter table public.fighter_profile_claims enable row level security;
alter table public.event_categories enable row level security;
alter table public.season_awards enable row level security;
alter table public.season_qualification_rules enable row level security;
alter table public.season_ranking_snapshots enable row level security;
alter table public.permissions enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.access_grants enable row level security;
alter table public.entity_merges enable row level security;
alter table public.sync_operations enable row level security;

create policy clubs_member_read on public.clubs for select to authenticated using (
  deleted_at is null and (
    organization_id is null
    or private.user_has_permission((select auth.uid()),'club.manage',organization_id,null,null)
    or exists(select 1 from public.club_organization_affiliations coa where coa.club_id=id and private.has_org_role((select auth.uid()),coa.organization_id,array['organization_admin','organization_staff']::public.organization_role[]))
  )
);
create policy clubs_admin_write on public.clubs for all to authenticated
using (private.is_platform_admin((select auth.uid())) or (organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',organization_id,null,null)))
with check (private.is_platform_admin((select auth.uid())) or (organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',organization_id,null,null)));

create policy club_org_affiliation_read on public.club_organization_affiliations for select to authenticated using (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
);
create policy club_org_affiliation_write on public.club_organization_affiliations for all to authenticated
using (private.user_has_permission((select auth.uid()),'club.manage',organization_id,null,null))
with check (private.user_has_permission((select auth.uid()),'club.manage',organization_id,null,null));

create policy club_locations_read on public.club_training_locations for select to authenticated using (
  exists(select 1 from public.clubs c where c.id=club_id and (c.organization_id is null or private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)))
);
create policy club_locations_write on public.club_training_locations for all to authenticated
using (exists(select 1 from public.clubs c where c.id=club_id and c.organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)))
with check (exists(select 1 from public.clubs c where c.id=club_id and c.organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)));

create policy club_staff_read on public.club_staff_assignments for select to authenticated using (
  exists(select 1 from public.clubs c where c.id=club_id and (c.organization_id is null or private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)))
);
create policy club_staff_write on public.club_staff_assignments for all to authenticated
using (exists(select 1 from public.clubs c where c.id=club_id and c.organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)))
with check (exists(select 1 from public.clubs c where c.id=club_id and c.organization_id is not null and private.user_has_permission((select auth.uid()),'club.manage',c.organization_id,null,null)));

do $$
declare t text;
begin
  foreach t in array array['disciplines','age_classes','weight_classes','gender_classes','divisions','competition_categories']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (organization_id is null or private.has_org_role((select auth.uid()),organization_id,array[''organization_admin'',''organization_staff'']::public.organization_role[]))',t||'_read',t);
    execute format('create policy %I on public.%I for all to authenticated using (private.is_platform_admin((select auth.uid())) or (organization_id is not null and private.user_has_permission((select auth.uid()),''division.manage'',organization_id,null,null))) with check (private.is_platform_admin((select auth.uid())) or (organization_id is not null and private.user_has_permission((select auth.uid()),''division.manage'',organization_id,null,null)))',t||'_write',t);
  end loop;
end;
$$;

create policy fighter_private_owner_read on public.fighter_private_details for select to authenticated using (
  exists(select 1 from public.fighter_user_links l where l.fighter_id=fighter_id and l.user_id=(select auth.uid()) and l.relationship='owner' and l.ends_at is null)
  or exists(select 1 from public.fighters f where f.id=fighter_id and f.organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',f.organization_id,null,null))
);
create policy fighter_private_admin_write on public.fighter_private_details for all to authenticated
using (exists(select 1 from public.fighters f where f.id=fighter_id and f.organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',f.organization_id,null,null)))
with check (exists(select 1 from public.fighters f where f.id=fighter_id and f.organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',f.organization_id,null,null)));

create policy fighter_links_self_read on public.fighter_user_links for select to authenticated using (
  user_id=(select auth.uid()) or exists(select 1 from public.fighters f where f.id=fighter_id and f.organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',f.organization_id,null,null))
);
create policy fighter_affiliations_read on public.fighter_affiliations for select to authenticated using (
  exists(select 1 from public.fighter_user_links l where l.fighter_id=fighter_id and l.user_id=(select auth.uid()) and l.ends_at is null)
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[]))
);
create policy fighter_affiliations_write on public.fighter_affiliations for all to authenticated
using (organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',organization_id,null,null))
with check (organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.manage',organization_id,null,null));

create policy officials_read on public.officials for select to authenticated using (deleted_at is null);
create policy officials_write on public.officials for all to authenticated
using (private.is_platform_admin((select auth.uid())))
with check (private.is_platform_admin((select auth.uid())));
create policy official_affiliations_read on public.official_organization_affiliations for select to authenticated using (
  private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  or private.user_has_permission((select auth.uid()),'roles.manage',organization_id,null,null)
);
create policy official_affiliations_write on public.official_organization_affiliations for all to authenticated
using (private.user_has_permission((select auth.uid()),'roles.manage',organization_id,null,null))
with check (private.user_has_permission((select auth.uid()),'roles.manage',organization_id,null,null));

create policy fighter_claims_self_read on public.fighter_profile_claims for select to authenticated using (
  user_id=(select auth.uid())
  or exists(select 1 from public.fighters f where f.id=fighter_id and f.organization_id is not null and private.user_has_permission((select auth.uid()),'fighter.claim.review',f.organization_id,null,null))
);
create policy fighter_claims_self_insert on public.fighter_profile_claims for insert to authenticated with check (
  user_id=(select auth.uid()) and status='pending'
);
create policy fighter_claims_self_cancel on public.fighter_profile_claims for update to authenticated
using (user_id=(select auth.uid()) and status='pending')
with check (user_id=(select auth.uid()) and status='cancelled');

create policy event_categories_read on public.event_categories for select to authenticated using (
  exists(select 1 from public.events e where e.id=event_id and (
    private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin','organization_staff']::public.organization_role[])
    or private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,null)
  ))
);
create policy event_categories_write on public.event_categories for all to authenticated
using (exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,null)))
with check (exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,null)));

do $$
declare t text;
begin
  foreach t in array array['season_awards','season_qualification_rules','season_ranking_snapshots']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (exists(select 1 from public.seasons s where s.id=season_id and private.has_org_role((select auth.uid()),s.organization_id,array[''organization_admin'',''organization_staff'']::public.organization_role[])))',t||'_read',t);
    execute format('create policy %I on public.%I for all to authenticated using (exists(select 1 from public.seasons s where s.id=season_id and private.user_has_permission((select auth.uid()),''season.manage'',s.organization_id,null,null))) with check (exists(select 1 from public.seasons s where s.id=season_id and private.user_has_permission((select auth.uid()),''season.manage'',s.organization_id,null,null)))',t||'_write',t);
  end loop;
end;
$$;

create policy permissions_authenticated_read on public.permissions for select to authenticated using (true);
create policy roles_authenticated_read on public.role_definitions for select to authenticated using (is_active);
create policy role_permissions_authenticated_read on public.role_permissions for select to authenticated using (true);
create policy roles_admin_write on public.role_definitions for all to authenticated
using (not is_system and organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,null,null))
with check (not is_system and organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,null,null));
create policy role_permissions_admin_write on public.role_permissions for all to authenticated
using (exists(select 1 from public.role_definitions r where r.id=role_id and not r.is_system and r.organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',r.organization_id,null,null)))
with check (exists(select 1 from public.role_definitions r where r.id=role_id and not r.is_system and r.organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',r.organization_id,null,null)));

create policy access_grants_self_read on public.access_grants for select to authenticated using (
  user_id=(select auth.uid())
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
  or private.is_platform_admin((select auth.uid()))
);
create policy access_grants_admin_write on public.access_grants for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
)
with check (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.user_has_permission((select auth.uid()),'roles.manage',organization_id,event_id,team_id))
);

create policy entity_merges_admin_read on public.entity_merges for select to authenticated using (
  private.is_platform_admin((select auth.uid()))
  or exists(select 1 from public.audit_log a where a.action='merge' and a.actor_user_id=(select auth.uid()) and a.record_id=target_id)
);
create policy sync_operations_self_read on public.sync_operations for select to authenticated using (user_id=(select auth.uid()) or private.is_platform_admin((select auth.uid())));

grant select,insert,update,delete on
  public.clubs,public.club_organization_affiliations,public.club_training_locations,public.club_staff_assignments,
  public.disciplines,public.age_classes,public.weight_classes,public.gender_classes,public.divisions,public.competition_categories,
  public.fighter_private_details,public.fighter_user_links,public.fighter_affiliations,public.officials,public.official_organization_affiliations,
  public.fighter_profile_claims,public.event_categories,public.season_awards,public.season_qualification_rules,public.season_ranking_snapshots,
  public.role_definitions,public.role_permissions,public.access_grants
to authenticated;
grant select on public.permissions,public.entity_merges,public.sync_operations to authenticated;

-- Public directory RPCs intentionally expose only non-sensitive fields.
create or replace function public.public_fighter_directory()
returns table(id uuid,display_name text,nickname text,avatar_path text,bio text,country_code text,province_state text,city text,nationality text,social_links jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id,f.name,f.nickname,f.avatar_path,f.bio,f.country_code,f.province_state,f.city,f.nationality,f.social_links
  from public.fighters f
  where f.public_profile and f.is_active and f.deleted_at is null and f.merged_into_id is null
  order by f.name;
$$;

create or replace function public.public_club_directory()
returns table(id uuid,name text,short_name text,logo_path text,country_code text,province_state text,city text,description text,website_url text,social_links jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,c.name,c.short_name,c.logo_path,c.country_code,c.province_state,c.city,c.description,c.website_url,c.social_links
  from public.clubs c
  where c.is_active and c.deleted_at is null and c.merged_into_id is null
  order by c.name;
$$;

create or replace function public.public_team_directory()
returns table(id uuid,club_id uuid,name text,city_or_region text,logo_path text,country_code text,team_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,t.club_id,t.name,t.city_or_region,t.logo_path,t.country_code,t.team_type
  from public.teams t
  where t.is_active and t.deleted_at is null and t.merged_into_id is null
  order by t.name;
$$;

revoke execute on function public.public_fighter_directory() from public;
revoke execute on function public.public_club_directory() from public;
revoke execute on function public.public_team_directory() from public;
grant execute on function public.public_fighter_directory() to anon,authenticated;
grant execute on function public.public_club_directory() to anon,authenticated;
grant execute on function public.public_team_directory() to anon,authenticated;

-- Keep timestamps consistent on new mutable tables.
do $$
declare t text;
begin
  foreach t in array array[
    'clubs','club_training_locations','disciplines','age_classes','weight_classes','gender_classes','divisions',
    'competition_categories','fighter_private_details','officials','fighter_profile_claims','season_qualification_rules','role_definitions'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I',t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
  end loop;
end;
$$;

-- Significant administrative changes are audit logged.
do $$
declare t text;
begin
  foreach t in array array[
    'clubs','club_organization_affiliations','disciplines','divisions','competition_categories',
    'fighter_affiliations','officials','official_organization_affiliations','fighter_profile_claims',
    'event_categories','season_awards','season_qualification_rules','role_definitions','role_permissions','access_grants'
  ]
  loop
    execute format('drop trigger if exists audit_change on public.%I',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.capture_audit_change()',t);
  end loop;
end;
$$;
