-- The connected model (docs/VISION.md): organizations, affiliations, memberships over time, rulesets with versions,
-- seasons, sources with a status, and permanent results. Additive: nothing existing is changed or removed.
-- Governance is not geography: nothing here is derived from where a team is. Every relationship is an explicit record.
-- No publicly readable table carries an account id.

-- ---------------------------------------------------------------- sources
-- Where a fact came from. Official, imported and unverified claims can sit side by side; disagreement is not hidden.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('official', 'imported', 'submitted', 'observed')),
  title text not null check (char_length(title) between 2 and 200),
  url text check (url is null or char_length(url) <= 500),
  citation text check (citation is null or char_length(citation) <= 500),
  retrieved_on date,
  created_at timestamptz not null default now()
);
alter table public.sources enable row level security;
create policy sources_read on public.sources for select to anon, authenticated using (true);
create policy sources_owner_write on public.sources for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.sources to anon, authenticated;
grant insert, update, delete on public.sources to authenticated;

create table public.record_sources (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete restrict,
  entity_type text not null check (entity_type in ('organization', 'team', 'fighter', 'event', 'competition', 'ruleset_version', 'result', 'team_affiliation', 'team_membership', 'season')),
  entity_id uuid not null,
  status text not null default 'unverified' check (status in ('official', 'imported', 'unverified')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (source_id, entity_type, entity_id)
);
alter table public.record_sources enable row level security;
create index record_sources_entity_idx on public.record_sources (entity_type, entity_id);
create policy record_sources_read on public.record_sources for select to anon, authenticated using (true);
create policy record_sources_owner_write on public.record_sources for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.record_sources to anon, authenticated;
grant insert, update, delete on public.record_sources to authenticated;

-- ---------------------------------------------------------------- organizations
-- Federations, national and regional bodies, clubs. Listing one is not an endorsement by it, and says nothing about who it governs.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  kind text not null check (kind in ('federation', 'national', 'regional', 'club', 'other')),
  country text,
  website text check (website is null or char_length(website) <= 300),
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
create policy organizations_read on public.organizations for select to anon, authenticated using (true);
create policy organizations_owner_write on public.organizations for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.organizations to anon, authenticated;
grant insert, update, delete on public.organizations to authenticated;

-- A team's relationship to an organization. Never inferred from location: each one is a recorded fact with a status.
create table public.team_affiliations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  relation text not null check (relation in ('member', 'recognized', 'affiliate', 'other')),
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date),
  unique (team_id, organization_id, relation)
);
alter table public.team_affiliations enable row level security;
create policy team_affiliations_read on public.team_affiliations for select to anon, authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.status = 'approved') or private.is_any_organizer());
create policy team_affiliations_owner_write on public.team_affiliations for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.team_affiliations to anon, authenticated;
grant insert, update, delete on public.team_affiliations to authenticated;

-- ---------------------------------------------------------------- careers: a fighter's teams over time
-- Public sporting identity only. A membership is not an account; claiming a profile comes later.
create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  role text not null default 'fighter' check (role in ('fighter', 'captain', 'coach', 'squire', 'other')),
  mercenary boolean not null default false,
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date)
);
alter table public.team_memberships enable row level security;
create index team_memberships_fighter_idx on public.team_memberships (fighter_id);
create index team_memberships_team_idx on public.team_memberships (team_id);
create policy team_memberships_read on public.team_memberships for select to anon, authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.status = 'approved') or private.is_team_captain(team_id) or private.is_any_organizer());
create policy team_memberships_captain_write on public.team_memberships for all to authenticated
  using (private.is_team_captain(team_id) or private.is_owner()) with check (private.is_team_captain(team_id) or private.is_owner());
grant select on public.team_memberships to anon, authenticated;
grant insert, update, delete on public.team_memberships to authenticated;

-- ---------------------------------------------------------------- rulesets, with versions that stay traceable
create table public.rulesets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now()
);
alter table public.rulesets enable row level security;
create policy rulesets_read on public.rulesets for select to anon, authenticated using (true);
create policy rulesets_owner_write on public.rulesets for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.rulesets to anon, authenticated;
grant insert, update, delete on public.rulesets to authenticated;

create table public.ruleset_versions (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.rulesets (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  source_id uuid references public.sources (id) on delete set null,
  effective_from date,
  effective_to date,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (ruleset_id, version)
);
alter table public.ruleset_versions enable row level security;
create policy ruleset_versions_read on public.ruleset_versions for select to anon, authenticated using (true);
create policy ruleset_versions_owner_write on public.ruleset_versions for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.ruleset_versions to anon, authenticated;
grant insert, update, delete on public.ruleset_versions to authenticated;

-- ---------------------------------------------------------------- seasons
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
alter table public.seasons enable row level security;
create policy seasons_read on public.seasons for select to anon, authenticated using (true);
create policy seasons_owner_write on public.seasons for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select on public.seasons to anon, authenticated;
grant insert, update, delete on public.seasons to authenticated;

-- ---------------------------------------------------------------- links from what already exists
-- competitions keep the text label `ruleset` during the transition; the version link is the traceable one.
alter table public.competitions add column ruleset_version_id uuid references public.ruleset_versions (id) on delete set null;
alter table public.events add column season_id uuid references public.seasons (id) on delete set null;
-- Events are changed by their organizer through the existing column grants; add the season to that list.
grant update (season_id) on public.events to authenticated;
-- Competitions are written by organizers under the existing policy; the grant is table-wide there already.

-- ---------------------------------------------------------------- results: the permanent record
-- One row per entry per competition. Written when a competition finishes (by the organizer), never typed twice.
create table public.results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete restrict,
  final_place int check (final_place is null or final_place >= 1),
  points numeric check (points is null or points >= 0),
  created_at timestamptz not null default now(),
  unique (competition_id, entry_id)
);
alter table public.results enable row level security;
create index results_competition_idx on public.results (competition_id);
create policy results_read on public.results for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id)));
create policy results_organizer_write on public.results for all to authenticated
  using (private.is_organizer(private.event_of_competition(competition_id)))
  with check (private.is_organizer(private.event_of_competition(competition_id)));
grant select on public.results to anon, authenticated;
grant insert, update, delete on public.results to authenticated;

-- A fighter's and a team's history are read-only views over results; they follow the caller's own permissions.
create view public.fighter_history with (security_invoker = true) as
  select e.fighter_id, ev.id as event_id, ev.slug as event_slug, ev.name as event_name, ev.starts_on,
         k.id as competition_id, k.name as competition_name, k.ruleset, r.final_place, r.points
  from public.results r
  join public.entries e on e.id = r.entry_id
  join public.competitions k on k.id = r.competition_id
  join public.events ev on ev.id = k.event_id
  where e.fighter_id is not null;
create view public.team_history with (security_invoker = true) as
  select e.team_id, ev.id as event_id, ev.slug as event_slug, ev.name as event_name, ev.starts_on,
         k.id as competition_id, k.name as competition_name, k.ruleset, r.final_place, r.points
  from public.results r
  join public.entries e on e.id = r.entry_id
  join public.competitions k on k.id = r.competition_id
  join public.events ev on ev.id = k.event_id
  where e.team_id is not null;
grant select on public.fighter_history, public.team_history to anon, authenticated;
