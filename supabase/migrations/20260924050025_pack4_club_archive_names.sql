alter table public.clubs
  drop constraint if exists clubs_organization_id_name_key;

create unique index clubs_org_name_active_unique_idx
  on public.clubs(organization_id,lower(name))
  where deleted_at is null;
