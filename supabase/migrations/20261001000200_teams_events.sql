-- Teams, fighters, events, staff roles, competitions, entries.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 80),
  city text, region text, country text,
  colors text[] not null default array['#2C4A8C', '#E9ECEF'] check (cardinality(colors) = 2),
  crest_division text not null default 'pale' check (crest_division in ('pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire')),
  initial text not null default '' check (char_length(initial) <= 2),
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
create policy teams_public_read on public.teams for select to anon, authenticated using (true);
grant select on public.teams to anon, authenticated;

create table public.team_roles (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('captain')),
  primary key (team_id, user_id)
);
alter table public.team_roles enable row level security;
create policy team_roles_own on public.team_roles for select to authenticated using (user_id = auth.uid());
grant select on public.team_roles to authenticated;

create table public.fighters (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 80),
  team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.fighters enable row level security;
create policy fighters_public_read on public.fighters for select to anon, authenticated using (true);
grant select on public.fighters to anon, authenticated;

-- Which account controls which fighter record. Private: a public fighter record is not an account.
create table public.fighter_accounts (
  fighter_id uuid primary key references public.fighters (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade
);
alter table public.fighter_accounts enable row level security;
create policy fighter_accounts_own on public.fighter_accounts for select to authenticated using (user_id = auth.uid());
grant select on public.fighter_accounts to authenticated;

create or replace function private.is_team_captain(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_roles where team_id = p_team and user_id = auth.uid() and role = 'captain')
$$;
revoke execute on function private.is_team_captain(uuid) from public;
grant execute on function private.is_team_captain(uuid) to anon, authenticated;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  event_type text not null default 'tournament' check (event_type in ('tournament', 'practice', 'clinic', 'demonstration', 'gathering')),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  venue text, city text, region text, country text,
  timezone text not null default 'America/Edmonton',
  starts_on date not null,
  ends_on date not null,
  host_team_id uuid references public.teams (id) on delete set null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (registration_closes_at is null or registration_opens_at is null or registration_closes_at > registration_opens_at)
);
alter table public.events enable row level security;
create trigger events_touch before update on public.events for each row execute function private.touch_updated_at();

create table public.event_staff (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('organizer', 'marshal', 'scorekeeper')),
  primary key (event_id, user_id, role)
);
alter table public.event_staff enable row level security;

create or replace function private.has_event_role(p_event uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or exists (
    select 1 from public.event_staff where event_id = p_event and user_id = auth.uid() and role = any (p_roles))
$$;
create or replace function private.is_organizer(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer']) $$;
create or replace function private.can_score(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'marshal', 'scorekeeper']) $$;
create or replace function private.is_event_public(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.events where id = p_event and status = 'published') $$;
revoke execute on function private.has_event_role(uuid, text[]), private.is_organizer(uuid), private.can_score(uuid), private.is_event_public(uuid) from public;
grant execute on function private.has_event_role(uuid, text[]), private.is_organizer(uuid), private.can_score(uuid), private.is_event_public(uuid) to anon, authenticated;

create policy events_read on public.events for select to anon, authenticated
  using (status = 'published' or private.can_score(id));
grant select on public.events to anon, authenticated;
create policy events_organizer_update on public.events for update to authenticated
  using (private.is_organizer(id)) with check (private.is_organizer(id));
grant update (name, description, event_type, status, venue, city, region, country, timezone, starts_on, ends_on, host_team_id, registration_opens_at, registration_closes_at) on public.events to authenticated;

create policy event_staff_read on public.event_staff for select to authenticated
  using (user_id = auth.uid() or private.is_organizer(event_id));
grant select on public.event_staff to authenticated;

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  category text not null references public.ref_categories (code),
  gender text not null default 'open' check (gender in ('open', 'men', 'women')),
  division text not null default 'open' check (division in ('open', '1', '2')),
  tier text not null default 'Classic' references public.ref_tiers (name),
  structure text not null default 'round_robin' check (structure in ('round_robin', 'pools_elimination', 'elimination')),
  status text not null default 'setup' check (status in ('setup', 'registration', 'running', 'finished')),
  -- Group fights: how many rounds make a fight. Set by the tournament regulations.
  rounds_to_win int check (rounds_to_win is null or rounds_to_win between 1 and 5),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.competitions enable row level security;
create index competitions_event_idx on public.competitions (event_id);
create policy competitions_read on public.competitions for select to anon, authenticated
  using (private.is_event_public(event_id) or private.can_score(event_id));
create policy competitions_organizer_write on public.competitions for all to authenticated
  using (private.is_organizer(event_id)) with check (private.is_organizer(event_id));
grant select on public.competitions to anon, authenticated;
grant insert, update, delete on public.competitions to authenticated;

create or replace function private.event_of_competition(p_comp uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select event_id from public.competitions where id = p_comp $$;
revoke execute on function private.event_of_competition(uuid) from public;
grant execute on function private.event_of_competition(uuid) to anon, authenticated;

-- An entry is a team (group fights) or a fighter (duels) in a competition.
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  team_id uuid references public.teams (id) on delete restrict,
  fighter_id uuid references public.fighters (id) on delete restrict,
  pool text,
  seed int,
  status text not null default 'registered' check (status in ('registered', 'checked_in', 'withdrawn', 'disqualified')),
  created_at timestamptz not null default now(),
  check ((team_id is null) <> (fighter_id is null)),
  unique (competition_id, team_id),
  unique (competition_id, fighter_id)
);
alter table public.entries enable row level security;
create index entries_competition_idx on public.entries (competition_id);

create or replace function private.check_entry_kind() returns trigger
language plpgsql set search_path = '' as $$
declare v_league text;
begin
  select c.league into v_league from public.competitions k join public.ref_categories c on c.code = k.category where k.id = new.competition_id;
  if v_league = 'buhurt' and new.team_id is null then raise exception 'group fights take team entries' using errcode = '23514'; end if;
  if v_league <> 'buhurt' and new.fighter_id is null then raise exception 'this competition takes fighter entries' using errcode = '23514'; end if;
  return new;
end $$;
create trigger entries_kind before insert or update on public.entries for each row execute function private.check_entry_kind();

create policy entries_read on public.entries for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id)));
create policy entries_organizer_write on public.entries for all to authenticated
  using (private.is_organizer(private.event_of_competition(competition_id)))
  with check (private.is_organizer(private.event_of_competition(competition_id)));
grant select on public.entries to anon, authenticated;
grant insert, update, delete on public.entries to authenticated;
