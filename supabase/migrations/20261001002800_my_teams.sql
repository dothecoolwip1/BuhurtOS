-- "My teams" for the account area.
-- Every team the caller is on: captain (team_roles), a current membership of their own fighter record (team_memberships, mercenary rows are NOT "on the
-- team"), or marked as theirs (fighters.team_id). One row per team, with the strongest role: captain, then the membership role (coach, squire, other),
-- then 'fighter'. Own data only (auth.uid()); no account ids are returned. A pending team is shown to its captain (status says so).
-- roster_count counts the current roster (same rule as team_roster). pending_requests is the number of waiting join requests and is filled ONLY for
-- captains (null for everyone else). upcoming_events: published events that have not ended where the team has an active entry, soonest first, max 10.
create or replace function public.my_teams()
returns table (team_id uuid, team_name text, team_slug text, team_status text, logo_path text, role text, is_captain boolean, since date,
  organization_id uuid, organization_slug text, organization_name text, roster_count int, pending_requests int, upcoming_events jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return query
  with fa as (select fighter_id from public.fighter_accounts where user_id = v_uid),
  mine as (
    select r.team_id, 'captain'::text as role, null::date as since, 1 as rank from public.team_roles r where r.user_id = v_uid and r.role = 'captain'
    union all
    select m.team_id, m.role, m.from_date, case m.role when 'captain' then 1 when 'coach' then 2 when 'squire' then 3 when 'other' then 4 else 5 end
    from public.team_memberships m join fa on fa.fighter_id = m.fighter_id
    where not m.mercenary and (m.to_date is null or m.to_date >= current_date)
    union all
    select f.team_id, 'fighter', null::date, 6 from public.fighters f join fa on fa.fighter_id = f.id where f.team_id is not null
  ), best as (
    select distinct on (mine.team_id) mine.team_id, mine.role, mine.since from mine order by mine.team_id, mine.rank, mine.since nulls last
  )
  select t.id, t.name, t.slug, t.status, t.logo_path, b.role, (b.role = 'captain'), b.since,
    o.id, o.slug, o.name,
    (select count(*)::int from public.team_roster(t.id)),
    case when b.role = 'captain' then (select count(*)::int from public.team_join_requests q where q.team_id = t.id and q.status = 'pending') end,
    coalesce((select jsonb_agg(jsonb_build_object('event_id', x.id, 'slug', x.slug, 'name', x.name, 'starts_on', x.starts_on, 'ends_on', x.ends_on) order by x.starts_on, x.id)
      from (select distinct e.id, e.slug, e.name, e.starts_on, e.ends_on from public.entries en
            join public.competitions c on c.id = en.competition_id join public.events e on e.id = c.event_id
            where en.team_id = t.id and en.status <> 'withdrawn' and e.status = 'published' and e.ends_on >= current_date order by e.starts_on, e.id limit 10) x), '[]'::jsonb)
  from best b join public.teams t on t.id = b.team_id
  left join lateral (
    select og.* from public.team_affiliations a join public.organizations og on og.id = a.organization_id
    where a.team_id = t.id and a.relation = 'member' and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)
    order by og.enabled desc, a.from_date nulls last, og.id limit 1) o on true
  order by (b.role = 'captain') desc, lower(t.name), t.id;
end $$;

revoke execute on function public.my_teams() from public, anon;
grant execute on function public.my_teams() to authenticated;
