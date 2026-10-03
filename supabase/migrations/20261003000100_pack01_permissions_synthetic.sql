-- Pack 01 (2026-10-03): scope team authority, expire event roles, mark synthetic data and keep it out of official aggregates.
-- Owner decisions: platform administrators (platform_roles.owner) approve/merge teams platform-wide; organization administrators manage
-- teams in their own organization; event organizers get no platform-wide team power. Event roles lapse shortly after the event ends.
-- Additive: no data is deleted, no test account is touched.

-- 1. Team authority ---------------------------------------------------------------------------------------------------------------
create or replace function private.can_admin_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_team is not null and auth.uid() is not null and (
    private.is_owner()
    or exists (
      select 1 from public.team_affiliations a
      where a.team_id = p_team and a.relation = 'member' and private.is_org_admin(a.organization_id)
        and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)))
$$;
revoke execute on function private.can_admin_team(uuid) from public;
grant execute on function private.can_admin_team(uuid) to anon, authenticated;

create or replace function private.can_assign_captain(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.can_admin_team(p_team) $$;

create or replace function private.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (private.is_team_captain(p_team) or private.can_admin_team(p_team)) and (private.team_org_enabled(p_team) or private.is_owner())
$$;

create or replace function public.approve_team(p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_admin_team(p_team) then raise exception 'only a platform administrator or the team''s organization administrator can approve teams' using errcode = '42501'; end if;
  update public.teams set status = 'approved' where id = p_team;
  perform private.audit(null, 'team.approved', p_team::text);
end $$;

create or replace function public.new_team_request_details(p_team uuid)
returns table(team_id uuid, requested_by_name text, contact_email text, contact_phone text, captain_reason text, notes text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_admin_team(p_team) then raise exception 'only a platform administrator or the team''s organization administrator can read a team request' using errcode = '42501'; end if;
  return query
  select p.team_id, private.person_name(p.requested_by), p.contact_email, p.contact_phone, p.captain_reason, p.notes, p.created_at
  from public.team_request_private p where p.team_id = p_team;
end $$;

create or replace function public.team_requests_inbox()
returns table(id uuid, team_id uuid, team_name text, team_slug text, requester_name text, message text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.team_id, t.name, t.slug, coalesce(private.person_name(r.requester_id), 'Unnamed member'), r.message, r.created_at
  from public.team_join_requests r join public.teams t on t.id = r.team_id
  where r.status = 'pending' and r.requester_id <> auth.uid()
    and (private.is_team_captain(r.team_id)
         or (private.can_admin_team(r.team_id) and not exists (select 1 from public.team_roles c where c.team_id = r.team_id)))
  order by r.created_at
$$;

-- merge_teams: same body as before, only the authority check changes (both teams must be administrable by the caller).
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'merge_teams';
  v_def := replace(v_def,
    $$if not private.is_any_organizer() then raise exception 'only an organizer can merge teams' using errcode = '42501'; end if;$$,
    $$if not (private.can_admin_team(p_keep) and private.can_admin_team(p_remove)) then raise exception 'only a platform administrator, or an organization administrator for both teams, can merge teams' using errcode = '42501'; end if;$$);
  if position('can_admin_team' in v_def) = 0 then raise exception 'merge_teams body did not match the expected text'; end if;
  execute v_def;
end $do$;

create or replace function public.team_roster(p_team uuid)
returns table(fighter_id uuid, display_name text, role text, is_captain boolean, mercenary boolean, since date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (
    exists (select 1 from public.teams t where t.id = p_team and t.status = 'approved')
    or (auth.uid() is not null and (private.can_admin_team(p_team) or private.is_team_member(p_team, auth.uid())))
  ) then
    return;
  end if;
  return query
  with cur as (
    select m.fighter_id, m.role, m.mercenary, m.from_date
    from public.team_memberships m
    where m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)
    union all
    select f.id, 'fighter', false, null::date
    from public.fighters f
    where f.team_id = p_team and not exists (select 1 from public.team_memberships m where m.team_id = p_team and m.fighter_id = f.id)
  ), one as (
    select distinct on (c.fighter_id) c.fighter_id, c.role, c.mercenary, c.from_date
    from cur c order by c.fighter_id, (c.role = 'captain') desc, c.from_date nulls last
  )
  select o.fighter_id, f.display_name, o.role,
         (o.role = 'captain' or exists (select 1 from public.fighter_accounts fa join public.team_roles r on r.user_id = fa.user_id and r.team_id = p_team and r.role = 'captain' where fa.fighter_id = o.fighter_id)),
         o.mercenary, o.from_date
  from one o join public.fighters f on f.id = o.fighter_id
  order by 4 desc, lower(f.display_name), f.id;
end $$;

drop policy teams_read on public.teams;
create policy teams_read on public.teams for select to anon, authenticated
  using (status = 'approved' or private.is_team_captain(id) or private.can_admin_team(id));
drop policy team_memberships_read on public.team_memberships;
create policy team_memberships_read on public.team_memberships for select to anon, authenticated
  using (exists (select 1 from public.teams t where t.id = team_memberships.team_id and t.status = 'approved')
         or private.is_team_captain(team_id) or private.can_admin_team(team_id));
drop policy team_affiliations_read on public.team_affiliations;
create policy team_affiliations_read on public.team_affiliations for select to anon, authenticated
  using (exists (select 1 from public.teams t where t.id = team_affiliations.team_id and t.status = 'approved')
         or private.can_admin_team(team_id));

drop function private.is_any_organizer();  -- the broad "organizer of any event" test; nothing may use it again

-- 2. Event roles expire --------------------------------------------------------------------------------------------------------------
-- An event_staff row only counts until 7 days after the event's last day (events with no dates never expire). Owners and
-- organization administrators are not event_staff and are unaffected. Rows are kept for the audit trail.
create or replace function private.event_staff_active(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(e.ends_on, e.starts_on) is null or current_date <= coalesce(e.ends_on, e.starts_on) + 7
                   from public.events e where e.id = p_event), false)
$$;
revoke execute on function private.event_staff_active(uuid) from public;
grant execute on function private.event_staff_active(uuid) to anon, authenticated;

create or replace function private.has_event_role(p_event uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or (
    private.event_org_enabled(p_event) and (
      (private.event_staff_active(p_event)
       and exists (select 1 from public.event_staff where event_id = p_event and user_id = auth.uid() and role = any (p_roles)))
      or ('organizer' = any (p_roles) and private.is_org_admin_of_event(p_event))))
$$;

create or replace function private.event_organizer_users(p_event uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with staff as (
    select s.user_id from public.event_staff s where s.event_id = p_event and s.role = 'organizer' and private.event_staff_active(p_event)
    union
    select os.user_id from public.organization_staff os where os.organization_id = private.event_org(p_event) and os.role = 'admin' and private.event_org_enabled(p_event)
  )
  select user_id from staff
  union
  select pr.user_id from public.platform_roles pr where pr.role = 'owner' and not exists (select 1 from staff)
$$;

-- 3. Synthetic data -----------------------------------------------------------------------------------------------------------------
alter table public.sources add column if not exists synthetic boolean not null default false;
comment on column public.sources.synthetic is 'True for fictional/test datasets. Records tagged with such a source (record_sources) are labelled Test and excluded from official rankings, records and statistics.';
update public.sources set synthetic = true where id = 'ac7ebfbe-8866-5e61-918e-0f3ae9fafab8';  -- NACL-test fictional dataset

create or replace function private.is_synthetic(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.record_sources r join public.sources s on s.id = r.source_id
                 where s.synthetic and r.entity_type = p_type and r.entity_id = p_id)
$$;
revoke execute on function private.is_synthetic(text, uuid) from public;
grant execute on function private.is_synthetic(text, uuid) to anon, authenticated;

create or replace view public.synthetic_records with (security_invoker = true) as
  select r.entity_type, r.entity_id, coalesce(ev.slug, tm.slug, og.slug) as slug
  from public.record_sources r join public.sources s on s.id = r.source_id
  left join public.events ev on r.entity_type = 'event' and ev.id = r.entity_id
  left join public.teams tm on r.entity_type = 'team' and tm.id = r.entity_id
  left join public.organizations og on r.entity_type = 'organization' and og.id = r.entity_id
  where s.synthetic;
grant select on public.synthetic_records to anon, authenticated;

-- Official aggregate inputs: synthetic events never feed rankings, career/season/team statistics or "events attended".
create or replace view public.result_rows with (security_invoker = true) as
 SELECT r.competition_id, r.entry_id, r.final_place, COALESCE(r.points, (0)::numeric) AS points, k.name AS competition_name, k.category, k.gender, k.tier, k.structure,
        ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.event_type, ev.starts_on, ev.ends_on AS event_ends_on, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, e.team_id, e.fighter_id AS entry_fighter_id
   FROM ((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN seasons se ON ((se.id = ev.season_id)))
  WHERE r.final_place IS NOT NULL AND NOT private.is_synthetic('event', ev.id);

create or replace view public.played_events with (security_invoker = true) as
 SELECT id AS event_id FROM events e
  WHERE NOT private.is_synthetic('event', e.id)
    AND ((ends_on < CURRENT_DATE) OR (EXISTS ( SELECT 1 FROM (matches m JOIN competitions k ON ((k.id = m.competition_id))) WHERE ((k.event_id = e.id) AND (m.queue_state = 'final'::text)))));

create or replace view public.match_sides with (security_invoker = true) as
 SELECT m.id AS match_id, m.competition_id, k.event_id, k.category, k.gender, k.tier, k.structure, m.stage, m.finalized_at, ev.ends_on AS event_ends_on, ev.event_type, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, s.side, e.id AS entry_id, e.team_id, e.fighter_id,
        CASE WHEN (m.result = 'draw'::text) THEN 'draw'::text WHEN (m.winner_entry_id = e.id) THEN 'win'::text ELSE 'loss'::text END AS outcome,
        s.sf AS score_for, s.sa AS score_against, r.won AS rounds_won, r.lost AS rounds_lost
   FROM ((((((matches m JOIN competitions k ON ((k.id = m.competition_id))) JOIN events ev ON ((ev.id = k.event_id))) LEFT JOIN seasons se ON ((se.id = ev.season_id)))
        CROSS JOIN LATERAL ( VALUES ('a'::text,m.entry_a,m.score_a,m.score_b), ('b'::text,m.entry_b,m.score_b,m.score_a)) s(side, entry_id, sf, sa))
        JOIN entries e ON ((e.id = s.entry_id))) CROSS JOIN LATERAL private.side_rounds(m.detail, s.side, s.sf, s.sa) r(won, lost))
  WHERE ((m.queue_state = 'final'::text) AND (m.entry_a IS NOT NULL) AND (m.entry_b IS NOT NULL) AND NOT private.is_synthetic('event', ev.id));

-- Per-person / per-team history lists stay visible (they are not aggregates) but now say whether the event is fictional.
create or replace view public.fighter_history with (security_invoker = true) as
 SELECT e.fighter_id, ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.starts_on, k.id AS competition_id, k.name AS competition_name, k.ruleset, r.final_place, r.points,
        private.is_synthetic('event', ev.id) AS synthetic
   FROM (((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
  WHERE e.fighter_id IS NOT NULL;
create or replace view public.team_history with (security_invoker = true) as
 SELECT e.team_id, ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.starts_on, k.id AS competition_id, k.name AS competition_name, k.ruleset, r.final_place, r.points,
        private.is_synthetic('event', ev.id) AS synthetic
   FROM (((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
  WHERE e.team_id IS NOT NULL;

-- 4. Notifications follow the same authority: team reviews go to the platform owner (and organization admins), not to approved event creators.
create or replace function private.team_managers(p_team uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.team_roles where team_id = p_team
  union
  select pr.user_id from public.platform_roles pr where pr.role = 'owner' and not exists (select 1 from public.team_roles where team_id = p_team)
  union
  select os.user_id from public.team_affiliations a join public.organization_staff os on os.organization_id = a.organization_id and os.role = 'admin'
  where a.team_id = p_team and a.relation = 'member' and not exists (select 1 from public.team_roles where team_id = p_team)
    and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)
$$;
revoke execute on function private.team_managers(uuid) from public, anon, authenticated;

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'request_new_team';
  v_def := replace(v_def, $$from public.platform_roles pr where pr.role in ('owner', 'organizer');$$, $$from public.platform_roles pr where pr.role = 'owner';$$);
  if position($$pr.role = 'owner';$$ in v_def) = 0 then raise exception 'request_new_team body did not match the expected text'; end if;
  execute v_def;
end $do$;
