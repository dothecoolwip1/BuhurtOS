create extension if not exists pgcrypto;

create type public.org_status as enum ('active', 'inactive');
create type public.season_status as enum ('draft', 'active', 'archived');
create type public.event_status as enum ('draft', 'published', 'live', 'completed', 'archived');
create type public.event_type as enum ('ranked_competitive', 'demo_fun', 'exhibition', 'clinic_training', 'custom');
create type public.standings_mode as enum ('season_and_event', 'event_only', 'no_standings');
create type public.roster_entry_type as enum ('fighter', 'team', 'ghost_fighter', 'guest_fighter');
create type public.roster_status as enum ('registered', 'approved', 'no_show', 'late', 'withdrawn');
create type public.fight_card_status as enum ('draft', 'live', 'locked', 'archived');
create type public.match_status as enum ('scheduled', 'on_deck', 'in_the_hole', 'active', 'completed', 'finalized', 'forfeit', 'cancelled');
create type public.match_stage as enum ('pool', 'bracket', 'showcase', 'final');
create type public.note_visibility as enum ('private', 'team_only', 'marshal_visible');
create type public.disciplinary_color as enum ('yellow', 'red');
create type public.platform_role as enum ('platform_super_admin', 'platform_staff');
create type public.organization_role as enum ('organization_admin', 'organization_staff');
create type public.event_role as enum ('event_organizer', 'field_marshal', 'assistant_marshal', 'team_captain', 'fighter');
create type public.registration_status as enum ('pending', 'approved', 'waitlisted', 'withdrawn', 'rejected');
create type public.payment_status as enum ('not_required', 'pending', 'paid', 'failed', 'refunded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null,
  region text not null,
  description text,
  branding jsonb not null default '{}'::jsonb,
  status public.org_status not null default 'active',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.platform_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.platform_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, role)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, user_id, role)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  status public.season_status not null default 'draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  check (ends_at > starts_at)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  city_or_region text,
  notes text,
  logo_path text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  unique (organization_id, name)
);

create table public.fighters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  nickname text,
  preferred_weapons text[] not null default '{}',
  avatar_path text,
  bio text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null,
  venue text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  organizer_name text,
  event_type public.event_type not null,
  standings_mode public.standings_mode not null,
  status public.event_status not null default 'draft',
  timezone text not null default 'UTC',
  custom_ruleset jsonb not null default '{}'::jsonb,
  notes text,
  livestream_url text,
  public_links jsonb not null default '{}'::jsonb,
  registration_open boolean not null default false,
  registration_fee_cents integer not null default 0 check (registration_fee_cents >= 0),
  currency text not null default 'CAD',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  check (ends_at > starts_at)
);

create table public.event_memberships (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.event_role not null,
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, user_id, role),
  check (role <> 'team_captain' or team_id is not null)
);

create table public.event_roster_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  fighter_id uuid references public.fighters(id) on delete set null,
  entry_type public.roster_entry_type not null,
  display_name text not null,
  ghost_original_name text,
  checked_in boolean not null default false,
  armor_cleared boolean not null default false,
  medical_cleared boolean not null default false,
  waiver_confirmed boolean not null default false,
  weigh_in_cleared boolean not null default false,
  attendance_status public.roster_status not null default 'registered',
  can_compete boolean generated always as (
    checked_in and armor_cleared and medical_cleared and waiver_confirmed
    and attendance_status not in ('withdrawn', 'no_show')
  ) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.fight_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  list_name text not null,
  status public.fight_card_status not null default 'draft',
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.brackets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  fight_card_id uuid references public.fight_cards(id) on delete set null,
  name text not null,
  format text not null check (format in ('single_elimination', 'double_elimination', 'round_robin', 'pools_to_bracket')),
  category text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  fight_card_id uuid references public.fight_cards(id) on delete set null,
  bracket_id uuid references public.brackets(id) on delete set null,
  label text not null,
  category text not null,
  match_type text not null,
  scoring_config jsonb not null default '{}'::jsonb,
  status public.match_status not null default 'scheduled',
  stage public.match_stage not null default 'pool',
  scheduled_order integer not null default 0,
  bracket_round integer,
  bracket_slot text,
  winner_advances_to_match_id uuid references public.matches(id) deferrable initially deferred,
  winner_advances_to_slot smallint check (winner_advances_to_slot between 1 and 2),
  loser_advances_to_match_id uuid references public.matches(id) deferrable initially deferred,
  loser_advances_to_slot smallint check (loser_advances_to_slot between 1 and 2),
  started_at timestamptz,
  completed_at timestamptz,
  finalized_at timestamptz,
  active_list_assignment text,
  stream_reference text,
  result_summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id)
);

create index matches_event_order_idx on public.matches(event_id, scheduled_order);
create index matches_bracket_round_idx on public.matches(bracket_id, bracket_round, scheduled_order);

create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  roster_entry_id uuid references public.event_roster_entries(id) on delete restrict,
  side_index smallint not null check (side_index between 1 and 2),
  seed integer,
  is_placeholder boolean not null default false,
  placeholder_label text,
  source_match_id uuid references public.matches(id) on delete set null,
  source_slot smallint check (source_slot between 1 and 2),
  is_winner_source boolean,
  created_at timestamptz not null default timezone('utc', now()),
  unique (match_id, side_index),
  check ((is_placeholder and roster_entry_id is null) or (not is_placeholder and roster_entry_id is not null))
);

create table public.match_side_members (
  id uuid primary key default gen_random_uuid(),
  match_participant_id uuid not null references public.match_participants(id) on delete cascade,
  roster_entry_id uuid not null references public.event_roster_entries(id) on delete cascade,
  side_role text not null default 'lineup_member',
  eliminated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (match_participant_id, roster_entry_id)
);

create table public.match_rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  side_1_score numeric(8,2) not null default 0 check (side_1_score >= 0),
  side_2_score numeric(8,2) not null default 0 check (side_2_score >= 0),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (match_id, round_number)
);

create table public.disciplinary_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  fighter_id uuid references public.fighters(id) on delete set null,
  roster_entry_id uuid references public.event_roster_entries(id) on delete set null,
  color public.disciplinary_color not null,
  card_reason text not null,
  notes text,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default timezone('utc', now())
);

create index disciplinary_season_fighter_idx on public.disciplinary_cards(season_id, fighter_id, issued_at desc);

create table public.fight_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  visibility public.note_visibility not null default 'private',
  note_body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  body text not null,
  is_public boolean not null default false,
  scheduled_for timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  display_name text not null,
  team_name text,
  category text not null,
  phone text,
  emergency_contact text,
  waiver_acknowledged boolean not null default false,
  waiver_storage_path text,
  status public.registration_status not null default 'pending',
  payment_status public.payment_status not null default 'pending',
  registration_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_id, email, category)
);

create table public.registration_payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  status public.payment_status not null default 'pending',
  checkout_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated before update on public.organizations for each row execute function public.set_updated_at();
create trigger seasons_updated before update on public.seasons for each row execute function public.set_updated_at();
create trigger teams_updated before update on public.teams for each row execute function public.set_updated_at();
create trigger fighters_updated before update on public.fighters for each row execute function public.set_updated_at();
create trigger events_updated before update on public.events for each row execute function public.set_updated_at();
create trigger roster_updated before update on public.event_roster_entries for each row execute function public.set_updated_at();
create trigger fight_cards_updated before update on public.fight_cards for each row execute function public.set_updated_at();
create trigger brackets_updated before update on public.brackets for each row execute function public.set_updated_at();
create trigger matches_updated before update on public.matches for each row execute function public.set_updated_at();
create trigger fight_notes_updated before update on public.fight_notes for each row execute function public.set_updated_at();
create trigger registrations_updated before update on public.event_registrations for each row execute function public.set_updated_at();
create trigger payments_updated before update on public.registration_payments for each row execute function public.set_updated_at();
