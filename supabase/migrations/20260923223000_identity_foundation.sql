-- Permanent identity, affiliation, division, merge, and soft deletion foundation.

create type public.affiliation_type as enum ('member','mercenary','guest','independent');
create type public.division_status as enum ('draft','published','retired');

create table public.fighter_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null check (length(trim(display_name)) > 0),
  nickname text,
  avatar_path text,
  bio text,
  merged_into_identity_id uuid references public.fighter_identities(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  check (merged_into_identity_id is null or merged_into_identity_id <> id)
);

create unique index fighter_identities_user_unique_idx
  on public.fighter_identities(user_id)
  where user_id is not null and deleted_at is null;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  short_name text,
  region text,
  website_url text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create unique index clubs_org_name_active_unique_idx
  on public.clubs(organization_id, lower(name))
  where deleted_at is null;

alter table public.teams
  add column club_id uuid references public.clubs(id) on delete set null,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;

alter table public.fighters
  add column identity_id uuid references public.fighter_identities(id) on delete restrict,
  add column merged_into_fighter_id uuid references public.fighters(id) on delete set null,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;

insert into public.fighter_identities(id,user_id,display_name,nickname,avatar_path,bio,created_at,updated_at)
select distinct on (f.user_id)
  f.id,f.user_id,f.name,f.nickname,f.avatar_path,f.bio,f.created_at,f.updated_at
from public.fighters f
where f.user_id is not null
order by f.user_id,f.created_at,f.id;

insert into public.fighter_identities(id,user_id,display_name,nickname,avatar_path,bio,created_at,updated_at)
select f.id,null,f.name,f.nickname,f.avatar_path,f.bio,f.created_at,f.updated_at
from public.fighters f
where f.user_id is null
on conflict (id) do nothing;

update public.fighters f
set identity_id = coalesce(
  (select i.id from public.fighter_identities i where i.user_id = f.user_id and f.user_id is not null limit 1),
  f.id
)
where f.identity_id is null;

alter table public.fighters alter column identity_id set not null;

create index fighters_identity_idx on public.fighters(identity_id);
create index fighters_active_org_name_idx on public.fighters(organization_id,name) where deleted_at is null;
create index teams_club_idx on public.teams(club_id) where deleted_at is null;

create table public.fighter_affiliations (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.fighter_identities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  affiliation_type public.affiliation_type not null default 'member',
  starts_on date not null,
  ends_on date,
  is_primary boolean not null default false,
  source_event_id uuid references public.events(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  check (ends_on is null or ends_on >= starts_on),
  check (club_id is not null or team_id is not null or affiliation_type = 'independent')
);

create index fighter_affiliations_identity_dates_idx on public.fighter_affiliations(identity_id,starts_on desc,ends_on);
create index fighter_affiliations_org_idx on public.fighter_affiliations(organization_id,starts_on desc);
create unique index fighter_affiliations_one_open_primary_idx
  on public.fighter_affiliations(identity_id,organization_id)
  where is_primary and ends_on is null;

create table public.competition_divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  competition_format_id text not null,
  ruleset_id uuid references public.rulesets(id) on delete restrict,
  team_size integer check (team_size is null or team_size > 0),
  min_weight_kg numeric(6,2) check (min_weight_kg is null or min_weight_kg >= 0),
  max_weight_kg numeric(6,2) check (max_weight_kg is null or max_weight_kg >= 0),
  age_min integer check (age_min is null or age_min >= 0),
  age_max integer check (age_max is null or age_max >= 0),
  eligibility_label text,
  status public.division_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  check (max_weight_kg is null or min_weight_kg is null or max_weight_kg >= min_weight_kg),
  check (age_max is null or age_min is null or age_max >= age_min)
);

create unique index competition_divisions_owner_slug_unique_idx
  on public.competition_divisions(coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),slug)
  where deleted_at is null;

create table public.event_divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  division_id uuid not null references public.competition_divisions(id) on delete restrict,
  ruleset_id uuid references public.rulesets(id) on delete restrict,
  registration_limit integer check (registration_limit is null or registration_limit > 0),
  is_registration_open boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id),
  unique(event_id,division_id)
);

alter table public.brackets add column division_id uuid references public.competition_divisions(id) on delete set null;
alter table public.matches add column division_id uuid references public.competition_divisions(id) on delete set null;
alter table public.event_registrations add column division_id uuid references public.competition_divisions(id) on delete set null;

create index brackets_division_idx on public.brackets(division_id);
create index matches_division_idx on public.matches(division_id);
create index event_registrations_division_idx on public.event_registrations(division_id);
create index event_divisions_event_idx on public.event_divisions(event_id);
create index event_divisions_division_idx on public.event_divisions(division_id);

create trigger fighter_identities_updated before update on public.fighter_identities for each row execute function public.set_updated_at();
create trigger clubs_updated before update on public.clubs for each row execute function public.set_updated_at();
create trigger fighter_affiliations_updated before update on public.fighter_affiliations for each row execute function public.set_updated_at();
create trigger competition_divisions_updated before update on public.competition_divisions for each row execute function public.set_updated_at();
create trigger event_divisions_updated before update on public.event_divisions for each row execute function public.set_updated_at();

alter table public.fighter_identities enable row level security;
alter table public.clubs enable row level security;
alter table public.fighter_affiliations enable row level security;
alter table public.competition_divisions enable row level security;
alter table public.event_divisions enable row level security;

create policy fighter_identities_read on public.fighter_identities
for select to authenticated using (
  user_id = (select auth.uid())
  or private.is_platform_admin((select auth.uid()))
  or exists (
    select 1 from public.fighters f
    where f.identity_id = id
      and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  )
);

create policy fighter_identities_admin_update on public.fighter_identities
for update to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1 from public.fighters f
    where f.identity_id = id
      and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1 from public.fighters f
    where f.identity_id = id
      and private.has_org_role((select auth.uid()),f.organization_id,array['organization_admin']::public.organization_role[])
  )
);

create policy clubs_org_read on public.clubs
for select to authenticated using (
  deleted_at is null and (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  )
);

create policy clubs_org_write on public.clubs
for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
)
with check (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
);

create policy affiliations_read on public.fighter_affiliations
for select to authenticated using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  or exists (select 1 from public.fighter_identities i where i.id = identity_id and i.user_id = (select auth.uid()))
);

create policy affiliations_write on public.fighter_affiliations
for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
)
with check (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
);

create policy divisions_public_read on public.competition_divisions
for select to anon using (deleted_at is null and status = 'published');

create policy divisions_authenticated_read on public.competition_divisions
for select to authenticated using (
  deleted_at is null and (
    status = 'published'
    or organization_id is null
    or private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  )
);

create policy divisions_admin_write on public.competition_divisions
for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[]))
)
with check (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[]))
);

create policy event_divisions_read on public.event_divisions
for select to anon, authenticated using (
  private.event_is_public(event_id)
  or private.has_event_role((select auth.uid()),event_id,array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[])
  or exists (
    select 1 from public.events e
    where e.id = event_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin','organization_staff']::public.organization_role[])
      )
  )
);

create policy event_divisions_write on public.event_divisions
for all to authenticated
using (
  private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[])
  or exists (
    select 1 from public.events e
    where e.id = event_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[])
      )
  )
)
with check (
  private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[])
  or exists (
    select 1 from public.events e
    where e.id = event_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[])
      )
  )
);

revoke all on public.fighter_identities, public.clubs, public.fighter_affiliations, public.competition_divisions, public.event_divisions from anon;
revoke all on public.fighter_identities, public.clubs, public.fighter_affiliations, public.competition_divisions, public.event_divisions from authenticated;

grant select on public.fighter_identities, public.clubs, public.fighter_affiliations to authenticated;
grant insert, update, delete on public.fighter_identities, public.clubs, public.fighter_affiliations to authenticated;
grant select on public.competition_divisions, public.event_divisions to anon, authenticated;
grant insert, update, delete on public.competition_divisions, public.event_divisions to authenticated;
grant all on public.fighter_identities, public.clubs, public.fighter_affiliations, public.competition_divisions, public.event_divisions to service_role;

create or replace function public.claim_temporary_fighter(
  p_roster_entry_id uuid,
  p_existing_fighter_id uuid default null,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_roster public.event_roster_entries%rowtype;
  v_event public.events%rowtype;
  v_fighter public.fighters%rowtype;
  v_identity_id uuid;
  v_fighter_id uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_roster from public.event_roster_entries where id = p_roster_entry_id for update;
  if not found then raise exception 'Roster entry not found'; end if;
  if v_roster.entry_type not in ('ghost_fighter','guest_fighter') then raise exception 'Only temporary fighters can be claimed'; end if;

  select * into v_event from public.events where id = v_roster.event_id;
  if not (
    private.is_platform_admin(v_uid)
    or private.has_org_role(v_uid,v_roster.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role(v_uid,v_roster.event_id,array['event_organizer']::public.event_role[])
  ) then
    raise exception 'Not authorized to claim this fighter';
  end if;

  if p_existing_fighter_id is not null then
    select * into v_fighter
    from public.fighters
    where id = p_existing_fighter_id
      and organization_id = v_roster.organization_id
      and deleted_at is null
      and merged_into_fighter_id is null;
    if not found then raise exception 'Permanent fighter not found in this organization'; end if;
    v_fighter_id := v_fighter.id;
    v_identity_id := v_fighter.identity_id;
  else
    v_name := coalesce(nullif(trim(p_display_name),''),v_roster.display_name);
    insert into public.fighter_identities(display_name,created_at,updated_at)
    values (v_name,timezone('utc',now()),timezone('utc',now()))
    returning id into v_identity_id;

    insert into public.fighters(organization_id,team_id,identity_id,name,created_by,last_edited_by)
    values (v_roster.organization_id,v_roster.team_id,v_identity_id,v_name,v_uid,v_uid)
    returning id into v_fighter_id;
  end if;

  update public.event_roster_entries
  set fighter_id = v_fighter_id,
      entry_type = 'fighter',
      ghost_original_name = coalesce(ghost_original_name,display_name),
      last_edited_by = v_uid
  where id = p_roster_entry_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_roster.organization_id,
    v_roster.event_id,
    v_uid,
    'event_roster_entries',
    p_roster_entry_id,
    'claim_temporary_fighter',
    jsonb_build_object('fighterId',v_fighter_id,'identityId',v_identity_id)
  );

  return v_fighter_id;
end;
$$;

revoke all on function public.claim_temporary_fighter(uuid,uuid,text) from public, anon;
grant execute on function public.claim_temporary_fighter(uuid,uuid,text) to authenticated;

create or replace function public.merge_fighters(
  p_canonical_fighter_id uuid,
  p_duplicate_fighter_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_canonical public.fighters%rowtype;
  v_duplicate public.fighters%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_canonical_fighter_id = p_duplicate_fighter_id then raise exception 'Choose two different fighters'; end if;

  select * into v_canonical from public.fighters where id = p_canonical_fighter_id for update;
  select * into v_duplicate from public.fighters where id = p_duplicate_fighter_id for update;

  if v_canonical.id is null or v_duplicate.id is null then raise exception 'Fighter not found'; end if;
  if v_canonical.organization_id <> v_duplicate.organization_id then raise exception 'Fighters must belong to the same organization'; end if;
  if v_canonical.deleted_at is not null or v_duplicate.deleted_at is not null then raise exception 'Archived fighters cannot be merged'; end if;
  if not (
    private.is_platform_admin(v_uid)
    or private.has_org_role(v_uid,v_canonical.organization_id,array['organization_admin']::public.organization_role[])
  ) then
    raise exception 'Organization administrator access required';
  end if;
  if v_canonical.user_id is not null and v_duplicate.user_id is not null and v_canonical.user_id <> v_duplicate.user_id then
    raise exception 'Two fighters linked to different user accounts cannot be merged';
  end if;

  if v_canonical.user_id is null and v_duplicate.user_id is not null then
    if v_canonical.identity_id <> v_duplicate.identity_id then
      update public.fighter_identities set user_id = null where id = v_duplicate.identity_id;
    end if;
    update public.fighters set user_id = v_duplicate.user_id,last_edited_by = v_uid where id = v_canonical.id;
    update public.fighter_identities set user_id = v_duplicate.user_id where id = v_canonical.identity_id;
  end if;

  update public.event_roster_entries
  set fighter_id = v_canonical.id,last_edited_by = v_uid
  where fighter_id = v_duplicate.id;

  update public.disciplinary_cards set fighter_id = v_canonical.id where fighter_id = v_duplicate.id;

  if v_canonical.identity_id <> v_duplicate.identity_id then
    update public.fighter_affiliations set identity_id = v_canonical.identity_id,last_edited_by = v_uid
    where identity_id = v_duplicate.identity_id;

    update public.fighter_identities
    set merged_into_identity_id = v_canonical.identity_id,
        deleted_at = timezone('utc',now()),
        deleted_by = v_uid
    where id = v_duplicate.identity_id;
  end if;

  update public.fighters
  set is_active = false,
      merged_into_fighter_id = v_canonical.id,
      deleted_at = timezone('utc',now()),
      deleted_by = v_uid,
      last_edited_by = v_uid
  where id = v_duplicate.id;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_canonical.organization_id,
    v_uid,
    'fighters',
    v_duplicate.id,
    'merge_fighter',
    jsonb_build_object('canonicalFighterId',v_canonical.id,'duplicateFighterId',v_duplicate.id)
  );

  return v_canonical.id;
end;
$$;

revoke all on function public.merge_fighters(uuid,uuid) from public, anon;
grant execute on function public.merge_fighters(uuid,uuid) to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['fighter_identities','clubs','fighter_affiliations','competition_divisions','event_divisions','fighters','teams']
  loop
    execute format('drop trigger if exists audit_change on public.%I',v_table);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.capture_audit_change()',v_table);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_divisions'
  ) then
    alter publication supabase_realtime add table public.event_divisions;
  end if;
end;
$$;
