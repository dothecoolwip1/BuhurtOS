/*
  BuhurtOS platform expansion.
  This migration intentionally keeps flexible competition rules in versioned JSON configuration,
  while identities, relationships, results, history, permissions, and audit references remain relational.
*/

alter type public.event_status add value if not exists 'registration_open';
alter type public.event_status add value if not exists 'registration_closed';
alter type public.event_status add value if not exists 'check_in';
alter type public.event_status add value if not exists 'cancelled';

create type public.claim_status as enum ('submitted','needs_information','approved','rejected','withdrawn');
create type public.correction_status as enum ('submitted','under_review','needs_information','approved','rejected','applied');
create type public.validation_status as enum ('in_progress','submitted','pending_validation','validated','disputed','corrected','final');
create type public.clearance_status as enum ('pending','passed','failed','reinspection_required','waived');
create type public.ring_status as enum ('idle','preparing','ready','match_underway','medical_hold','marshal_review','delayed','closed');
create type public.qualification_status as enum ('not_qualified','in_contention','qualified','wildcard','invited','approved','ineligible');

alter table public.fighters
  add column if not exists display_name text,
  add column if not exists country_code text,
  add column if not exists province_state text,
  add column if not exists city text,
  add column if not exists nationality text,
  add column if not exists weight_kg numeric(6,2),
  add column if not exists height_cm numeric(6,2),
  add column if not exists experience_started_on date,
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists public_visibility boolean not null default true,
  add column if not exists deleted_at timestamptz;

update public.fighters set display_name = name where display_name is null;
alter table public.fighters alter column display_name set not null;

alter table public.teams add column if not exists deleted_at timestamptz;
alter table public.teams add column if not exists country_code text;
alter table public.teams add column if not exists description text;
alter table public.teams add column if not exists social_links jsonb not null default '{}'::jsonb;

create table public.fighter_private_profiles (
  fighter_id uuid primary key references public.fighters(id) on delete cascade,
  legal_name text,
  date_of_birth date,
  email text,
  phone text,
  emergency_contact jsonb,
  medical_notes text,
  insurance_details jsonb,
  guardian_details jsonb,
  youth_profile boolean not null default false,
  updated_at timestamptz not null default timezone('utc',now()),
  updated_by uuid references public.profiles(id)
);

create table public.rulesets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  discipline_key text,
  description text,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.ruleset_versions (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  version_label text not null,
  effective_from date,
  effective_to date,
  configuration jsonb not null default '{}'::jsonb,
  human_summary text,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  unique(ruleset_id,version_label),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  home_organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  short_name text,
  logo_path text,
  country_code text,
  province_state text,
  city text,
  description text,
  website_url text,
  social_links jsonb not null default '{}'::jsonb,
  contact_public jsonb not null default '{}'::jsonb,
  public_roster boolean not null default true,
  founded_on date,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id)
);

alter table public.teams add column if not exists club_id uuid references public.clubs(id) on delete set null;

create table public.club_staff (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('club_admin','captain','coach','staff')),
  starts_at timestamptz not null default timezone('utc',now()),
  ends_at timestamptz,
  unique(club_id,user_id,role,starts_at),
  check (ends_at is null or ends_at > starts_at)
);

create table public.fighter_affiliations (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete restrict,
  club_id uuid references public.clubs(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  affiliation_type text not null check (affiliation_type in ('home_club','permanent_team','temporary_team','mercenary','independent')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_primary boolean not null default false,
  source_event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  check (club_id is not null or team_id is not null or affiliation_type = 'independent'),
  check (ends_at is null or ends_at > starts_at)
);
create index fighter_affiliations_history_idx on public.fighter_affiliations(fighter_id,starts_at desc);

create table public.team_rosters (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  fighter_id uuid not null references public.fighters(id) on delete restrict,
  roster_role text not null default 'fighter' check (roster_role in ('fighter','captain','coach','reserve')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  check (ends_at is null or ends_at > starts_at)
);
create unique index team_rosters_one_active_idx on public.team_rosters(team_id,fighter_id,roster_role) where ends_at is null;
create index team_rosters_fighter_history_idx on public.team_rosters(fighter_id,starts_at desc);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  address_line_1 text,
  address_line_2 text,
  city text,
  province_state text,
  postal_code text,
  country_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  timezone text,
  parking_info text,
  accessibility_info text,
  indoor_outdoor text check (indoor_outdoor in ('indoor','outdoor','mixed')),
  public_notes text,
  private_notes text,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

alter table public.events add column if not exists venue_id uuid references public.venues(id) on delete set null;
alter table public.events add column if not exists ruleset_version_id uuid references public.ruleset_versions(id) on delete restrict;
alter table public.events add column if not exists logo_path text;
alter table public.events add column if not exists banner_path text;
alter table public.events add column if not exists address_text text;
alter table public.events add column if not exists latitude numeric(9,6);
alter table public.events add column if not exists longitude numeric(9,6);
alter table public.events add column if not exists registration_deadline timestamptz;
alter table public.events add column if not exists private_organizer_notes text;

create table public.event_divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ruleset_version_id uuid references public.ruleset_versions(id) on delete restrict,
  name text not null,
  discipline_key text not null,
  gender_division text,
  age_min integer,
  age_max integer,
  weight_min_kg numeric(6,2),
  weight_max_kg numeric(6,2),
  team_min integer,
  team_max integer,
  registration_cap integer,
  advancement_config jsonb not null default '{}'::jsonb,
  seeding_config jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('draft','open','closed','completed','cancelled')),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  unique(event_id,name),
  check (age_max is null or age_min is null or age_max >= age_min),
  check (weight_max_kg is null or weight_min_kg is null or weight_max_kg >= weight_min_kg)
);

alter table public.event_registrations add column if not exists division_id uuid references public.event_divisions(id) on delete set null;
alter table public.event_registrations add column if not exists fighter_id uuid references public.fighters(id) on delete set null;
alter table public.event_registrations add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.event_registrations add column if not exists registration_kind text not null default 'individual' check (registration_kind in ('individual','team','club'));
alter table public.event_registrations add column if not exists review_notes text;
alter table public.event_registrations add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.event_registrations add column if not exists reviewed_at timestamptz;

create table public.event_clearances (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  roster_entry_id uuid not null references public.event_roster_entries(id) on delete cascade,
  clearance_type text not null check (clearance_type in ('identity','registration','fee','waiver','insurance','weight','medical','armor','weapons','check_in','custom')),
  status public.clearance_status not null default 'pending',
  inspected_by uuid references public.profiles(id),
  inspected_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  reinspection_of uuid references public.event_clearances(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
create index event_clearances_lookup_idx on public.event_clearances(event_id,roster_entry_id,clearance_type,created_at desc);

create table public.rings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  status public.ring_status not null default 'idle',
  status_note text,
  updated_at timestamptz not null default timezone('utc',now()),
  updated_by uuid references public.profiles(id),
  unique(event_id,name)
);

alter table public.matches add column if not exists division_id uuid references public.event_divisions(id) on delete set null;
alter table public.matches add column if not exists ring_id uuid references public.rings(id) on delete set null;
alter table public.matches add column if not exists scheduled_start timestamptz;
alter table public.matches add column if not exists validation_status public.validation_status not null default 'in_progress';
alter table public.matches add column if not exists victory_method text;
alter table public.matches add column if not exists official_notes text;
alter table public.matches add column if not exists video_url text;

create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ring_id uuid references public.rings(id) on delete set null,
  match_id uuid references public.matches(id) on delete cascade,
  division_id uuid references public.event_divisions(id) on delete set null,
  item_type text not null check (item_type in ('match','break','ceremony','lunch','armor_check','meeting','awards','custom')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','delayed','active','completed','cancelled')),
  is_public boolean not null default true,
  notes text,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id),
  check (ends_at > starts_at)
);
create index schedule_items_event_time_idx on public.schedule_items(event_id,starts_at,ends_at);
create index schedule_items_ring_time_idx on public.schedule_items(ring_id,starts_at,ends_at);

create table public.pools (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  division_id uuid not null references public.event_divisions(id) on delete cascade,
  name text not null,
  advancement_count integer not null default 0 check (advancement_count >= 0),
  standings_config jsonb not null default '{"winPoints":3,"drawPoints":1,"tieBreakers":["standing_points","head_to_head","round_differential","score_differential","score_for","seed"]}'::jsonb,
  locked_at timestamptz,
  locked_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  unique(division_id,name)
);

create table public.pool_entries (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools(id) on delete cascade,
  roster_entry_id uuid not null references public.event_roster_entries(id) on delete restrict,
  seed integer not null,
  final_place integer,
  advanced boolean not null default false,
  created_at timestamptz not null default timezone('utc',now()),
  unique(pool_id,roster_entry_id),
  unique(pool_id,seed)
);

alter table public.matches add column if not exists pool_id uuid references public.pools(id) on delete set null;

create table public.match_penalties (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  round_number integer,
  roster_entry_id uuid references public.event_roster_entries(id) on delete set null,
  penalty_type text not null,
  points numeric(8,2) not null default 0,
  reason text not null,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default timezone('utc',now()),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversal_reason text
);

create table public.match_validation_history (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  status public.validation_status not null,
  result_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  actor_user_id uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc',now())
);
create index match_validation_history_idx on public.match_validation_history(match_id,created_at desc);

create table public.fighter_claims (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete cascade,
  claimant_user_id uuid not null references public.profiles(id) on delete cascade,
  status public.claim_status not null default 'submitted',
  evidence_text text,
  reviewer_user_id uuid references public.profiles(id),
  review_notes text,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  reviewed_at timestamptz
);
create unique index fighter_claim_one_open_idx on public.fighter_claims(fighter_id,claimant_user_id) where status in ('submitted','needs_information');

create table public.ranking_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete cascade,
  name text not null,
  scope text not null check (scope in ('global','organization','country','regional','season','career','discipline','team','weight_class','age_class')),
  discipline_key text,
  version integer not null,
  formula jsonb not null,
  minimum_matches integer not null default 0 check (minimum_matches >= 0),
  is_public boolean not null default true,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  unique(organization_id,name,version),
  check (active_to is null or active_from is null or active_to > active_from)
);

create table public.ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  ranking_config_id uuid not null references public.ranking_configs(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete cascade,
  calculated_at timestamptz not null default timezone('utc',now()),
  formula_snapshot jsonb not null,
  source_cutoff timestamptz not null,
  created_at timestamptz not null default timezone('utc',now())
);
create index ranking_snapshots_history_idx on public.ranking_snapshots(ranking_config_id,calculated_at desc);

create table public.ranking_snapshot_entries (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.ranking_snapshots(id) on delete cascade,
  fighter_id uuid references public.fighters(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  rank integer not null check (rank > 0),
  rating numeric(12,4) not null,
  previous_rank integer,
  matches_counted integer not null default 0,
  points numeric(12,4),
  explanation jsonb not null default '{}'::jsonb,
  unique(snapshot_id,rank),
  check ((fighter_id is not null)::integer + (team_id is not null)::integer = 1)
);
create index ranking_entries_fighter_history_idx on public.ranking_snapshot_entries(fighter_id,snapshot_id) where fighter_id is not null;

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  achievement_type text not null,
  criteria jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()),
  unique(organization_id,key)
);

create table public.fighter_achievements (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  earned_at timestamptz not null,
  source_data jsonb not null default '{}'::jsonb,
  unique(fighter_id,achievement_id,event_id,season_id,earned_at)
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text,
  url text not null,
  title text,
  thumbnail_url text,
  occurred_at timestamptz,
  is_public boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  unique(url)
);
create table public.video_events(video_id uuid references public.videos(id) on delete cascade,event_id uuid references public.events(id) on delete cascade,primary key(video_id,event_id));
create table public.video_matches(video_id uuid references public.videos(id) on delete cascade,match_id uuid references public.matches(id) on delete cascade,primary key(video_id,match_id));
create table public.video_fighters(video_id uuid references public.videos(id) on delete cascade,fighter_id uuid references public.fighters(id) on delete cascade,primary key(video_id,fighter_id));
create table public.video_teams(video_id uuid references public.videos(id) on delete cascade,team_id uuid references public.teams(id) on delete cascade,primary key(video_id,team_id));
create table public.video_clubs(video_id uuid references public.videos(id) on delete cascade,club_id uuid references public.clubs(id) on delete cascade,primary key(video_id,club_id));

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.profiles(id) on delete set null,
  reporter_email text,
  category text not null check (category in ('wrong_fighter','duplicate_fighter','wrong_team','incorrect_score','incorrect_affiliation','wrong_event','missing_event','incorrect_video','other')),
  entity_type text,
  entity_id uuid,
  description text not null,
  evidence_links text[] not null default '{}',
  status public.correction_status not null default 'submitted',
  assigned_to uuid references public.profiles(id),
  resolution_notes text,
  applied_audit_id uuid references public.audit_log(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz
);

create table public.merge_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('fighter','team','club','event','venue','organization')),
  source_id uuid not null,
  target_id uuid not null,
  source_snapshot jsonb not null,
  target_snapshot_before jsonb not null,
  reason text not null,
  merged_by uuid not null references public.profiles(id),
  merged_at timestamptz not null default timezone('utc',now()),
  check (source_id <> target_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc',now())
);
create index notifications_user_unread_idx on public.notifications(user_id,created_at desc) where read_at is null;

create table public.qualification_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  division_key text,
  name text not null,
  configuration jsonb not null,
  is_public boolean not null default true,
  cutoff_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id)
);

create table public.qualification_statuses (
  id uuid primary key default gen_random_uuid(),
  qualification_config_id uuid not null references public.qualification_configs(id) on delete cascade,
  fighter_id uuid references public.fighters(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  status public.qualification_status not null,
  points numeric(12,4),
  events_counted integer not null default 0,
  explanation jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default timezone('utc',now()),
  unique(qualification_config_id,fighter_id,team_id),
  check ((fighter_id is not null)::integer + (team_id is not null)::integer = 1)
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc',now()),
  updated_by uuid references public.profiles(id),
  unique(organization_id,key)
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_type text not null,
  status text not null default 'preview' check (status in ('preview','validated','committed','failed','cancelled')),
  source_filename text,
  summary jsonb not null default '{}'::jsonb,
  error_report jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  committed_at timestamptz
);

create index fighters_public_search_idx on public.fighters using gin (to_tsvector('simple',coalesce(display_name,'') || ' ' || coalesce(nickname,'') || ' ' || coalesce(city,'') || ' ' || coalesce(country_code,'')));
create index teams_public_search_idx on public.teams using gin (to_tsvector('simple',coalesce(name,'') || ' ' || coalesce(city_or_region,'') || ' ' || coalesce(country_code,'')));
create index clubs_public_search_idx on public.clubs using gin (to_tsvector('simple',coalesce(name,'') || ' ' || coalesce(city,'') || ' ' || coalesce(country_code,'')));

create or replace function private.can_manage_org(check_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),check_org,array['organization_admin']::public.organization_role[])
  );
$$;
revoke execute on function private.can_manage_org(uuid) from public,anon,authenticated;

create or replace function private.can_manage_event(check_event uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    private.is_platform_admin((select auth.uid()))
    or exists(select 1 from public.events e where e.id=check_event and private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[]))
    or private.has_event_role((select auth.uid()),check_event,array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
  );
$$;
revoke execute on function private.can_manage_event(uuid) from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'fighter_private_profiles','rulesets','ruleset_versions','clubs','club_staff','fighter_affiliations','team_rosters',
    'venues','event_divisions','event_clearances','rings','schedule_items','pools','pool_entries','match_penalties',
    'match_validation_history','fighter_claims','ranking_configs','ranking_snapshots','ranking_snapshot_entries',
    'achievements','fighter_achievements','videos','video_events','video_matches','video_fighters','video_teams','video_clubs',
    'correction_requests','merge_history','notifications','qualification_configs','qualification_statuses','feature_flags','import_jobs'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
  end loop;
end $$;

grant select on public.rulesets,public.ruleset_versions,public.clubs,public.fighter_affiliations,public.team_rosters,public.venues,
  public.event_divisions,public.rings,public.schedule_items,public.pools,public.pool_entries,public.ranking_configs,
  public.ranking_snapshots,public.ranking_snapshot_entries,public.achievements,public.fighter_achievements,public.videos,
  public.video_events,public.video_matches,public.video_fighters,public.video_teams,public.video_clubs,
  public.qualification_configs,public.qualification_statuses to anon;

create policy fighter_private_self_admin on public.fighter_private_profiles for all to authenticated
using (
  exists(select 1 from public.fighters f where f.id=fighter_id and f.user_id=(select auth.uid()))
  or private.is_platform_admin((select auth.uid()))
  or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[]))
)
with check (
  exists(select 1 from public.fighters f where f.id=fighter_id and f.user_id=(select auth.uid()))
  or private.is_platform_admin((select auth.uid()))
  or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[]))
);

create policy rulesets_public_read on public.rulesets for select to anon,authenticated using (status in ('active','retired'));
create policy rulesets_admin_write on public.rulesets for all to authenticated using (organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is not null and private.can_manage_org(organization_id));
create policy ruleset_versions_public_read on public.ruleset_versions for select to anon,authenticated using (published_at is not null);
create policy ruleset_versions_admin_write on public.ruleset_versions for all to authenticated
using (exists(select 1 from public.rulesets r where r.id=ruleset_id and r.organization_id is not null and private.can_manage_org(r.organization_id)))
with check (exists(select 1 from public.rulesets r where r.id=ruleset_id and r.organization_id is not null and private.can_manage_org(r.organization_id)));

create policy clubs_public_read on public.clubs for select to anon,authenticated using (deleted_at is null);
create policy clubs_admin_write on public.clubs for all to authenticated using (home_organization_id is not null and private.can_manage_org(home_organization_id)) with check (home_organization_id is not null and private.can_manage_org(home_organization_id));
create policy club_staff_member_read on public.club_staff for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.club_staff s where s.club_id=club_staff.club_id and s.user_id=(select auth.uid()) and s.role='club_admin' and s.ends_at is null) or private.is_platform_admin((select auth.uid())));
create policy club_staff_admin_write on public.club_staff for all to authenticated using (exists(select 1 from public.club_staff s where s.club_id=club_staff.club_id and s.user_id=(select auth.uid()) and s.role='club_admin' and s.ends_at is null) or private.is_platform_admin((select auth.uid()))) with check (exists(select 1 from public.club_staff s where s.club_id=club_staff.club_id and s.user_id=(select auth.uid()) and s.role='club_admin' and s.ends_at is null) or private.is_platform_admin((select auth.uid())));

create policy affiliations_public_read on public.fighter_affiliations for select to anon,authenticated using (true);
create policy affiliations_admin_write on public.fighter_affiliations for all to authenticated
using (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])))
with check (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])));

create policy team_rosters_public_read on public.team_rosters for select to anon,authenticated using (true);
create policy team_rosters_admin_write on public.team_rosters for all to authenticated
using (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.teams t where t.id=team_id and private.has_org_role((select auth.uid()),t.organization_id,array['organization_admin']::public.organization_role[])))
with check (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.teams t where t.id=team_id and private.has_org_role((select auth.uid()),t.organization_id,array['organization_admin']::public.organization_role[])));

create policy venues_public_read on public.venues for select to anon,authenticated using (private_notes is null or (select auth.role())='authenticated');
create policy venues_admin_write on public.venues for all to authenticated using (organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is not null and private.can_manage_org(organization_id));

create policy divisions_public_read on public.event_divisions for select to anon,authenticated using (private.event_is_public(event_id) or private.can_manage_event(event_id));
create policy divisions_staff_write on public.event_divisions for all to authenticated using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));

create policy clearances_staff on public.event_clearances for all to authenticated using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));

create policy rings_public_read on public.rings for select to anon,authenticated using (private.event_is_public(event_id) or private.can_manage_event(event_id));
create policy rings_staff_write on public.rings for all to authenticated using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));

create policy schedule_public_read on public.schedule_items for select to anon,authenticated using ((is_public and private.event_is_public(event_id)) or private.can_manage_event(event_id));
create policy schedule_staff_write on public.schedule_items for all to authenticated using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));

create policy pools_public_read on public.pools for select to anon,authenticated using (private.event_is_public(event_id) or private.can_manage_event(event_id));
create policy pools_staff_write on public.pools for all to authenticated using (private.can_manage_event(event_id)) with check (private.can_manage_event(event_id));
create policy pool_entries_public_read on public.pool_entries for select to anon,authenticated using (exists(select 1 from public.pools p where p.id=pool_id and (private.event_is_public(p.event_id) or private.can_manage_event(p.event_id))));
create policy pool_entries_staff_write on public.pool_entries for all to authenticated using (exists(select 1 from public.pools p where p.id=pool_id and private.can_manage_event(p.event_id))) with check (exists(select 1 from public.pools p where p.id=pool_id and private.can_manage_event(p.event_id)));

create policy penalties_staff on public.match_penalties for all to authenticated using (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id))) with check (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id)));
create policy validations_staff_read on public.match_validation_history for select to authenticated using (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id)));
create policy validations_staff_write on public.match_validation_history for insert to authenticated with check (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id)));

create policy claims_self_read on public.fighter_claims for select to authenticated using (claimant_user_id=(select auth.uid()) or private.is_platform_admin((select auth.uid())) or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])));
create policy claims_self_create on public.fighter_claims for insert to authenticated with check (claimant_user_id=(select auth.uid()));
create policy claims_admin_update on public.fighter_claims for update to authenticated using (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.fighters f where f.id=fighter_id and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])));

create policy ranking_configs_public_read on public.ranking_configs for select to anon,authenticated using (is_public);
create policy ranking_configs_admin_write on public.ranking_configs for all to authenticated using (organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is not null and private.can_manage_org(organization_id));
create policy ranking_snapshots_public_read on public.ranking_snapshots for select to anon,authenticated using (exists(select 1 from public.ranking_configs c where c.id=ranking_config_id and c.is_public));
create policy ranking_snapshots_admin_write on public.ranking_snapshots for all to authenticated using (organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is not null and private.can_manage_org(organization_id));
create policy ranking_entries_public_read on public.ranking_snapshot_entries for select to anon,authenticated using (exists(select 1 from public.ranking_snapshots s join public.ranking_configs c on c.id=s.ranking_config_id where s.id=snapshot_id and c.is_public));
create policy ranking_entries_admin_write on public.ranking_snapshot_entries for all to authenticated using (exists(select 1 from public.ranking_snapshots s where s.id=snapshot_id and s.organization_id is not null and private.can_manage_org(s.organization_id))) with check (exists(select 1 from public.ranking_snapshots s where s.id=snapshot_id and s.organization_id is not null and private.can_manage_org(s.organization_id)));

create policy achievements_public_read on public.achievements for select to anon,authenticated using (is_public);
create policy achievements_admin_write on public.achievements for all to authenticated using (organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is not null and private.can_manage_org(organization_id));
create policy fighter_achievements_public_read on public.fighter_achievements for select to anon,authenticated using (exists(select 1 from public.achievements a where a.id=achievement_id and a.is_public));
create policy fighter_achievements_admin_write on public.fighter_achievements for all to authenticated using (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.achievements a where a.id=achievement_id and a.organization_id is not null and private.can_manage_org(a.organization_id))) with check (private.is_platform_admin((select auth.uid())) or exists(select 1 from public.achievements a where a.id=achievement_id and a.organization_id is not null and private.can_manage_org(a.organization_id)));

create policy videos_public_read on public.videos for select to anon,authenticated using (is_public);
create policy videos_authenticated_write on public.videos for all to authenticated using ((select auth.uid())=created_by or private.is_platform_admin((select auth.uid()))) with check ((select auth.uid())=created_by or private.is_platform_admin((select auth.uid())));
create policy video_events_public on public.video_events for select to anon,authenticated using (true);
create policy video_matches_public on public.video_matches for select to anon,authenticated using (true);
create policy video_fighters_public on public.video_fighters for select to anon,authenticated using (true);
create policy video_teams_public on public.video_teams for select to anon,authenticated using (true);
create policy video_clubs_public on public.video_clubs for select to anon,authenticated using (true);
create policy video_events_write on public.video_events for all to authenticated using (exists(select 1 from public.events e where e.id=event_id and private.can_manage_event(e.id))) with check (exists(select 1 from public.events e where e.id=event_id and private.can_manage_event(e.id)));
create policy video_matches_write on public.video_matches for all to authenticated using (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id))) with check (exists(select 1 from public.matches m where m.id=match_id and private.can_manage_event(m.event_id)));
create policy video_fighters_write on public.video_fighters for all to authenticated using (private.is_platform_admin((select auth.uid()))) with check (private.is_platform_admin((select auth.uid())));
create policy video_teams_write on public.video_teams for all to authenticated using (private.is_platform_admin((select auth.uid()))) with check (private.is_platform_admin((select auth.uid())));
create policy video_clubs_write on public.video_clubs for all to authenticated using (private.is_platform_admin((select auth.uid()))) with check (private.is_platform_admin((select auth.uid())));

create policy corrections_create on public.correction_requests for insert to anon,authenticated with check (description <> '');
create policy corrections_own_read on public.correction_requests for select to authenticated using (reporter_user_id=(select auth.uid()) or private.is_platform_admin((select auth.uid())));
create policy corrections_admin_update on public.correction_requests for update to authenticated using (private.is_platform_admin((select auth.uid()))) with check (private.is_platform_admin((select auth.uid())));
grant insert on public.correction_requests to anon;

create policy merge_history_admin on public.merge_history for select to authenticated using (private.is_platform_admin((select auth.uid())));
create policy merge_history_insert on public.merge_history for insert to authenticated with check (private.is_platform_admin((select auth.uid())));

create policy notifications_self on public.notifications for select to authenticated using (user_id=(select auth.uid()));
create policy notifications_self_update on public.notifications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy notifications_admin_insert on public.notifications for insert to authenticated with check (private.is_platform_admin((select auth.uid())) or user_id=(select auth.uid()));

create policy qualification_configs_public on public.qualification_configs for select to anon,authenticated using (is_public);
create policy qualification_configs_admin on public.qualification_configs for all to authenticated using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy qualification_status_public on public.qualification_statuses for select to anon,authenticated using (exists(select 1 from public.qualification_configs c where c.id=qualification_config_id and c.is_public));
create policy qualification_status_admin on public.qualification_statuses for all to authenticated using (exists(select 1 from public.qualification_configs c where c.id=qualification_config_id and private.can_manage_org(c.organization_id))) with check (exists(select 1 from public.qualification_configs c where c.id=qualification_config_id and private.can_manage_org(c.organization_id)));

create policy feature_flags_admin on public.feature_flags for all to authenticated using (organization_id is null and private.is_platform_admin((select auth.uid())) or organization_id is not null and private.can_manage_org(organization_id)) with check (organization_id is null and private.is_platform_admin((select auth.uid())) or organization_id is not null and private.can_manage_org(organization_id));
create policy import_jobs_admin on public.import_jobs for all to authenticated using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));

drop policy if exists fighters_public_read on public.fighters;
create policy fighters_public_read on public.fighters for select to anon using (is_active and public_visibility and deleted_at is null);
grant select(id,display_name,nickname,preferred_weapons,avatar_path,bio,country_code,province_state,city,nationality,weight_kg,height_cm,experience_started_on,social_links,is_active,public_visibility) on public.fighters to anon;

drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams for select to anon using (is_active and deleted_at is null);
grant select(id,organization_id,club_id,name,city_or_region,logo_path,is_active,country_code,description,social_links) on public.teams to anon;

create policy organizations_public_read on public.organizations for select to anon using (status='active');
grant select(id,name,short_name,region,description,branding,status) on public.organizations to anon;

do $$
declare t text;
begin
  foreach t in array array[
    'fighter_private_profiles','rulesets','ruleset_versions','clubs','fighter_affiliations','team_rosters','venues','event_divisions',
    'event_clearances','rings','schedule_items','pools','pool_entries','match_penalties','match_validation_history','fighter_claims',
    'ranking_configs','ranking_snapshots','ranking_snapshot_entries','achievements','fighter_achievements','correction_requests',
    'merge_history','qualification_configs','qualification_statuses','feature_flags','import_jobs'
  ] loop
    execute format('drop trigger if exists audit_change on public.%I',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.capture_audit_change()',t);
  end loop;
end $$;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rings') then
    alter publication supabase_realtime add table public.rings;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='schedule_items') then
    alter publication supabase_realtime add table public.schedule_items;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pools') then
    alter publication supabase_realtime add table public.pools;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pool_entries') then
    alter publication supabase_realtime add table public.pool_entries;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
