-- Versioned, inheritable rulesets for federations, organizations, and teams.

create table if not exists public.rulesets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  parent_ruleset_id uuid references public.rulesets(id) on delete restrict,
  name text not null check (length(trim(name)) > 1),
  short_name text not null check (length(trim(short_name)) > 0),
  version text not null default '1.0',
  description text,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  effective_from timestamptz,
  effective_to timestamptz,
  settings jsonb not null default jsonb_build_object(
    'enabledFormats', '[]'::jsonb,
    'scoringOverrides', '{}'::jsonb,
    'compliance', jsonb_build_object(
      'requireCheckIn', true,
      'requireArmorClearance', true,
      'requireMedicalClearance', true,
      'requireWaiver', true,
      'requireWeighIn', true
    ),
    'discipline', jsonb_build_object(
      'yellowCardsBeforeSuspension', 2,
      'redCardSuspensionMatches', 1
    ),
    'bracket', jsonb_build_object('antiFratricide', true)
  ),
  created_by uuid default auth.uid(),
  last_edited_by uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ruleset_owner_shape check (team_id is null or organization_id is not null),
  constraint ruleset_effective_window check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create index if not exists rulesets_organization_idx on public.rulesets(organization_id,status);
create index if not exists rulesets_team_idx on public.rulesets(team_id,status);
create index if not exists rulesets_parent_idx on public.rulesets(parent_ruleset_id);

alter table public.events
  add column if not exists ruleset_id uuid references public.rulesets(id) on delete restrict;

alter table public.rulesets enable row level security;

drop policy if exists rulesets_public_read on public.rulesets;
create policy rulesets_public_read
on public.rulesets for select
to anon, authenticated
using (
  status = 'published'
  or private.is_platform_admin((select auth.uid()))
  or (
    organization_id is not null
    and private.has_org_role(
      (select auth.uid()),
      organization_id,
      array['organization_admin','organization_staff']::public.organization_role[]
    )
  )
);

drop policy if exists rulesets_admin_insert on public.rulesets;
create policy rulesets_admin_insert
on public.rulesets for insert
to authenticated
with check (
  private.is_platform_admin((select auth.uid()))
  or (
    organization_id is not null
    and private.has_org_role(
      (select auth.uid()),
      organization_id,
      array['organization_admin']::public.organization_role[]
    )
  )
);

drop policy if exists rulesets_admin_update on public.rulesets;
create policy rulesets_admin_update
on public.rulesets for update
to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or (
    organization_id is not null
    and private.has_org_role(
      (select auth.uid()),
      organization_id,
      array['organization_admin']::public.organization_role[]
    )
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or (
    organization_id is not null
    and private.has_org_role(
      (select auth.uid()),
      organization_id,
      array['organization_admin']::public.organization_role[]
    )
  )
);

drop policy if exists rulesets_admin_delete on public.rulesets;
create policy rulesets_admin_delete
on public.rulesets for delete
to authenticated
using (
  status = 'draft'
  and (
    private.is_platform_admin((select auth.uid()))
    or (
      organization_id is not null
      and private.has_org_role(
        (select auth.uid()),
        organization_id,
        array['organization_admin']::public.organization_role[]
      )
    )
  )
);

grant select on public.rulesets to anon, authenticated;
grant insert, update, delete on public.rulesets to authenticated;

create or replace function private.touch_ruleset_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  new.last_edited_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists ruleset_touch_updated_at on public.rulesets;
create trigger ruleset_touch_updated_at
before update on public.rulesets
for each row execute function private.touch_ruleset_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rulesets'
  ) then
    alter publication supabase_realtime add table public.rulesets;
  end if;
end;
$$;
