-- Platform control of organizations (additive; replaces function bodies and two policies from earlier migrations, deletes nothing).
--
-- The platform owner (platform_roles.role = 'owner') can switch an organization off and on. Switching off is a SOFT state: no row is ever
-- deleted, and switching on restores everything. The enforcement is here, in the database, not in the UI:
--   * private.has_event_role (the root of is_organizer / can_score / can_read_health) is false for events of a disabled organization;
--     the owner always passes. An admin of an ENABLED organization counts as organizer of that organization's events.
--   * private.is_team_captain / private.can_manage_team are false for teams whose organization is disabled (owner passes).
--   * request_team_join and registrations are refused (triggers on team_join_requests and registrations).
--   * public reads: an event of a disabled organization stays readable ONLY when it is in the past (ends_on < current_date);
--     upcoming and ongoing events vanish for everyone except the owner. The organizations row itself stays public.
--   * teams_active hides teams of a disabled organization; team/fighter history keeps working.
--
-- Which organization does an event belong to? events.organization_id, else its season's organization. No organization = never affected.
-- Which organization does a team belong to? Its CURRENT team_affiliations rows with relation 'member'. No member affiliation = never
-- affected. Several = enabled while ANY of them is enabled.
-- "Past" uses the database date (UTC), not the event's own timezone.

-- ---------------------------------------------------------------- organization columns
alter table public.organizations
  add column enabled boolean not null default true,
  add column disabled_at timestamptz,
  add column disabled_by uuid,
  add column short_name text check (short_name is null or char_length(short_name) between 2 and 20),
  add column region text check (region is null or char_length(region) <= 80),
  add column description text check (description is null or char_length(description) <= 1000),
  add constraint organizations_disabled_consistent check ((enabled and disabled_at is null) or (not enabled and disabled_at is not null));

-- The old table-wide grants would let the owner write `enabled` directly. Replace them with column lists so that the only way to change
-- enabled / disabled_at / disabled_by is set_organization_enabled(). disabled_by is an account id, so it is not readable through the API at all
-- (admin_list_organizations returns it to the owner). Consequence: select explicit columns, never select('*'), on organizations.
revoke select, insert, update on public.organizations from anon, authenticated;
grant select (id, slug, name, kind, country, website, created_at, short_name, region, description, enabled, disabled_at) on public.organizations to anon, authenticated;
grant insert (id, slug, name, kind, country, website, short_name, region, description) on public.organizations to authenticated;
grant update (slug, name, kind, country, website, short_name, region, description) on public.organizations to authenticated;
-- delete stays granted to the owner policy (organizations_owner_write) as before; rows that are referenced cannot be removed anyway.

-- ---------------------------------------------------------------- organization staff (organization-level role)
create table public.organization_staff (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.organization_staff enable row level security;
create policy organization_staff_read on public.organization_staff for select to authenticated using (user_id = auth.uid() or private.is_owner());
grant select on public.organization_staff to authenticated;
-- No write grant: the owner adds and removes admins through grant_organization_admin / remove_organization_admin.

alter table public.events add column organization_id uuid references public.organizations (id) on delete set null;
create index events_organization_idx on public.events (organization_id);
-- organization_id is NOT in any column grant: it changes only through set_event_organization / set_event_season.
-- season_id used to be organizer-writable; it decides which organization an event counts for, so it moves behind set_event_season too.
revoke update (season_id) on public.events from authenticated;

-- ---------------------------------------------------------------- helpers (all stable, security definer, no side effects)
create or replace function private.event_org(p_event uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(e.organization_id, s.organization_id) from public.events e left join public.seasons s on s.id = e.season_id where e.id = p_event
$$;
create or replace function private.org_enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select o.enabled from public.organizations o where o.id = p_org), true)
$$;
create or replace function private.event_org_enabled(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select o.enabled from public.organizations o where o.id = private.event_org(p_event)), true)
$$;
create or replace function private.team_org_enabled(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select bool_or(o.enabled) from public.team_affiliations a join public.organizations o on o.id = a.organization_id
    where a.team_id = p_team and a.relation = 'member'
      and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)), true)
$$;
-- Admin of an ENABLED organization (the owner is handled separately by callers).
create or replace function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and private.org_enabled(p_org)
    and exists (select 1 from public.organization_staff s where s.organization_id = p_org and s.user_id = auth.uid() and s.role = 'admin')
$$;
create or replace function private.is_org_admin_of_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_org_admin(private.event_org(p_event)) $$;
revoke execute on function private.event_org(uuid), private.org_enabled(uuid), private.event_org_enabled(uuid), private.team_org_enabled(uuid),
  private.is_org_admin(uuid), private.is_org_admin_of_event(uuid) from public;
grant execute on function private.event_org(uuid), private.org_enabled(uuid), private.event_org_enabled(uuid), private.team_org_enabled(uuid),
  private.is_org_admin(uuid), private.is_org_admin_of_event(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- enforcement: events
create or replace function private.has_event_role(p_event uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or (
    private.event_org_enabled(p_event) and (
      exists (select 1 from public.event_staff where event_id = p_event and user_id = auth.uid() and role = any (p_roles))
      or ('organizer' = any (p_roles) and private.is_org_admin_of_event(p_event))))
$$;

-- An event is public when published AND (past OR its organization is enabled).
create or replace function private.is_event_public(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = p_event and e.status = 'published' and (e.ends_on < current_date or private.event_org_enabled(e.id)))
$$;

drop policy events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (private.is_event_public(id) or private.can_score(id));

-- Event staff of a disabled organization are not "any organizer" either (that helper decides who may approve and review teams).
create or replace function private.is_any_organizer() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_organizer() or exists (
    select 1 from public.event_staff es where es.user_id = auth.uid() and es.role = 'organizer' and private.event_org_enabled(es.event_id))
$$;

-- Registration is refused for events of a disabled organization (any date), whichever function writes it.
create or replace function private.registration_org_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.event_org_enabled(new.event_id) and not private.is_owner() then
    raise exception 'this event''s organization is not active, so registration is closed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function private.registration_org_guard() from public, anon, authenticated;
create trigger registrations_org_guard before insert on public.registrations for each row execute function private.registration_org_guard();

-- ---------------------------------------------------------------- enforcement: teams
create or replace function private.is_team_captain(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_roles where team_id = p_team and user_id = auth.uid() and role = 'captain')
    and (private.team_org_enabled(p_team) or private.is_owner())
$$;
create or replace function private.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (private.is_team_captain(p_team) or private.is_platform_organizer()) and (private.team_org_enabled(p_team) or private.is_owner())
$$;

create or replace function private.join_request_org_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.team_org_enabled(new.team_id) and not private.is_owner() then
    raise exception 'this team''s organization is not active, so it is not taking join requests' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function private.join_request_org_guard() from public, anon, authenticated;
create trigger team_join_requests_org_guard before insert on public.team_join_requests for each row execute function private.join_request_org_guard();

-- Active listings. History (results, fighter_history, team_history, memberships) is untouched and stays readable.
create view public.teams_active with (security_invoker = true) as
  select t.* from public.teams t where private.team_org_enabled(t.id);
grant select on public.teams_active to anon, authenticated;

-- ---------------------------------------------------------------- the switch
create or replace function public.set_organization_enabled(p_org uuid, p_enabled boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.is_owner() then raise exception 'only the platform owner can enable or disable an organization' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'say whether the organization is enabled' using errcode = '22023'; end if;
  if char_length(coalesce(v_reason, '')) > 500 then raise exception 'the reason is at most 500 characters' using errcode = '22023'; end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'organization not found' using errcode = 'P0002'; end if;
  if v_org.enabled = p_enabled then return; end if;
  update public.organizations
     set enabled = p_enabled,
         disabled_at = case when p_enabled then null else now() end,
         disabled_by = case when p_enabled then null else auth.uid() end
   where id = p_org;
  perform private.audit(null, case when p_enabled then 'organization.enabled' else 'organization.disabled' end, p_org::text,
    jsonb_build_object('slug', v_org.slug, 'name', v_org.name, 'reason', v_reason));
end $$;

create or replace function public.admin_list_organizations()
returns table (id uuid, slug text, name text, short_name text, kind text, country text, region text, enabled boolean, disabled_at timestamptz, disabled_by uuid,
  teams_count bigint, fighters_count bigint, events_completed bigint, events_current bigint, events_upcoming bigint, admins_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can list every organization' using errcode = '42501'; end if;
  return query
  with mt as (
    select a.organization_id as org, a.team_id from public.team_affiliations a join public.teams t on t.id = a.team_id and t.status = 'approved'
    where a.relation = 'member' and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)),
  pf as (
    select mt.org, f.id as fighter_id from mt join public.fighters f on f.team_id = mt.team_id
    union
    select mt.org, m.fighter_id from mt join public.team_memberships m on m.team_id = mt.team_id and (m.to_date is null or m.to_date >= current_date)),
  ev as (
    select e.id, private.event_org(e.id) as org, e.starts_on, e.ends_on,
      (e.ends_on < current_date or (exists (select 1 from public.competitions k where k.event_id = e.id)
                                    and not exists (select 1 from public.competitions k where k.event_id = e.id and k.status <> 'finished'))) as done
    from public.events e where e.status <> 'cancelled')
  select o.id, o.slug, o.name, o.short_name, o.kind, o.country, o.region, o.enabled, o.disabled_at, o.disabled_by,
    (select count(distinct mt.team_id) from mt where mt.org = o.id),
    (select count(distinct pf.fighter_id) from pf where pf.org = o.id),
    (select count(*) from ev where ev.org = o.id and ev.done),
    (select count(*) from ev where ev.org = o.id and not ev.done and ev.starts_on <= current_date),
    (select count(*) from ev where ev.org = o.id and not ev.done and ev.starts_on > current_date),
    (select count(*) from public.organization_staff s where s.organization_id = o.id)
  from public.organizations o order by o.enabled desc, lower(o.name), o.id;
end $$;

-- The public list of organizations that are switched on.
create or replace function public.list_active_organizations()
returns table (id uuid, slug text, name text, short_name text, kind text, country text, region text, website text, description text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.slug, o.name, o.short_name, o.kind, o.country, o.region, o.website, o.description
  from public.organizations o where o.enabled order by lower(o.name), o.id
$$;

-- ---------------------------------------------------------------- organization admins (owner manages them)
create or replace function public.grant_organization_admin(p_org uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_owner() then raise exception 'only the platform owner can add organization admins' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'organization not found' using errcode = 'P0002'; end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'that person has not signed in to BuhurtOS yet' using errcode = 'P0002'; end if;
  insert into public.organization_staff (organization_id, user_id, role) values (p_org, v_user, 'admin') on conflict do nothing;
  perform private.audit(null, 'organization.admin_granted', p_org::text, jsonb_build_object('user', v_user));
end $$;

create or replace function public.remove_organization_admin(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can remove organization admins' using errcode = '42501'; end if;
  delete from public.organization_staff where organization_id = p_org and user_id = p_user;
  perform private.audit(null, 'organization.admin_removed', p_org::text, jsonb_build_object('user', p_user));
end $$;

-- Owner, or an admin of that (enabled) organization.
create or replace function public.list_organization_staff(p_org uuid) returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_owner() or private.is_org_admin(p_org)) then raise exception 'only an organization admin can see the staff' using errcode = '42501'; end if;
  return query select s.user_id, u.email::text, s.role from public.organization_staff s join auth.users u on u.id = s.user_id
    where s.organization_id = p_org order by u.email;
end $$;

-- ---------------------------------------------------------------- linking events to organizations and seasons
-- Linking needs two things: authority over the event (its organizer; the owner always) AND authority over the organization (its admin; the owner always).
-- Unlinking (null) is the owner's call.
create or replace function public.set_event_organization(p_event uuid, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_season uuid;
begin
  if not exists (select 1 from public.events where id = p_event) then raise exception 'event not found' using errcode = 'P0002'; end if;
  if p_org is null then
    if not private.is_owner() then raise exception 'only the platform owner can unlink an event from its organization' using errcode = '42501'; end if;
  else
    if not private.is_organizer(p_event) then raise exception 'only an organizer of the event can link it' using errcode = '42501'; end if;
    if not (private.is_owner() or private.is_org_admin(p_org)) then raise exception 'you are not an admin of that organization' using errcode = '42501'; end if;
    if not exists (select 1 from public.organizations where id = p_org) then raise exception 'organization not found' using errcode = 'P0002'; end if;
  end if;
  select s.organization_id into v_season from public.events e join public.seasons s on s.id = e.season_id where e.id = p_event;
  if p_org is not null and v_season is not null and v_season <> p_org then raise exception 'the event''s season belongs to another organization' using errcode = '22023'; end if;
  update public.events set organization_id = p_org where id = p_event;
  perform private.audit(p_event, 'event.organization_set', p_event::text, jsonb_build_object('organization', p_org));
end $$;

-- A season of an organization may only be set by someone who may link to that organization; the event's organization is set to match.
create or replace function public.set_event_season(p_event uuid, p_season uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.seasons; v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of the event can set its season' using errcode = '42501'; end if;
  if p_season is not null then
    select * into v_s from public.seasons where id = p_season;
    if not found then raise exception 'season not found' using errcode = 'P0002'; end if;
    if v_s.organization_id is not null then
      if not (private.is_owner() or private.is_org_admin(v_s.organization_id)) then raise exception 'you are not an admin of that season''s organization' using errcode = '42501'; end if;
      if v_ev.organization_id is not null and v_ev.organization_id <> v_s.organization_id then raise exception 'the event is linked to another organization' using errcode = '22023'; end if;
    end if;
  end if;
  update public.events set season_id = p_season, organization_id = coalesce(organization_id, v_s.organization_id) where id = p_event;
  perform private.audit(p_event, 'event.season_set', p_event::text, jsonb_build_object('season', p_season));
end $$;

-- An admin of an enabled organization (or the owner) creates a season for it.
create or replace function public.create_season(p_org uuid, p_slug text, p_name text, p_starts_on date, p_ends_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (private.is_owner() or private.is_org_admin(p_org)) then raise exception 'only an organization admin can create seasons' using errcode = '42501'; end if;
  insert into public.seasons (organization_id, slug, name, starts_on, ends_on) values (p_org, p_slug, p_name, p_starts_on, p_ends_on) returning id into v_id;
  perform private.audit(null, 'season.created', v_id::text, jsonb_build_object('organization', p_org, 'slug', p_slug));
  return v_id;
end $$;

-- ---------------------------------------------------------------- API surface
revoke execute on function public.set_organization_enabled(uuid, boolean, text), public.admin_list_organizations(), public.list_active_organizations(),
  public.grant_organization_admin(uuid, text), public.remove_organization_admin(uuid, uuid), public.list_organization_staff(uuid),
  public.set_event_organization(uuid, uuid), public.set_event_season(uuid, uuid), public.create_season(uuid, text, text, date, date) from public, anon;
grant execute on function public.set_organization_enabled(uuid, boolean, text), public.admin_list_organizations(),
  public.grant_organization_admin(uuid, text), public.remove_organization_admin(uuid, uuid), public.list_organization_staff(uuid),
  public.set_event_organization(uuid, uuid), public.set_event_season(uuid, uuid), public.create_season(uuid, text, text, date, date) to authenticated;
grant execute on function public.list_active_organizations() to anon, authenticated;
