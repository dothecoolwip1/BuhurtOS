-- Pack 10 (2026-10-05): fighter and team career profiles, statistics, records and history. Additive, re-runnable.
--
-- Nothing here is a new sporting rule. Every number the profiles show comes from the records that already exist:
--   * a fight's outcome is matches.result / winner_entry_id of a FINAL match with both sides known (the same rows match_sides reads);
--   * a placing and its league points are the results row finalize_competition wrote (the same rows result_rows reads);
--   * official = not a fictional event (private.is_synthetic) and not excluded from official statistics (private.stats_excluded, Pack 09D).
--     An ARCHIVED event is official like any other. A fictional (test) event's rows are kept, flagged synthetic, so a fictional fighter's page can
--     show its own fictional history ("test" context) without a single fictional row reaching a real career total;
--   * the team a result or fight was earned FOR is the team entry's team (name as it was at the event) or, for an individual entry, the represented
--     team recorded for that entry (entries.represented_team_id, Pack "team discipline"). Never the fighter's team today.
-- What it adds is one row set per thing a profile needs, so a page is a handful of requests instead of a chain of them:
--   career_fights_all / career_fights        one row per fighter and final fight, with the opponent and the team fought for
--   team_fights_all / team_fights            one row per team and final team fight (5v5, 3v3, ...), with the opponent team and the placing
--   career_results_all / career_results      a fighter's official placings with the team each was earned for
--   fighter_career(fighter) / team_career(team)   career / season / organization totals and per-discipline lines, in one call
--   fighter_head_to_head(fighter) / team_head_to_head(team)   direct meetings only
--   team_fighters_represented(team)          every fighter who earned a result or fought a team fight for the team, from the records
-- All of it is security_invoker: row level security on matches, entries, results, events and teams decides what the viewer sees (public events for
-- the public). No account id, contact or health column is read anywhere below.

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- fights, one row per fighter and final match
create or replace view public.career_fights_all with (security_invoker = true) as
with sides as (
  select m.id as match_id, m.competition_id, m.stage, m.round_label, m.finalized_at, m.result, m.winner_entry_id, m.detail,
         'a'::text as side, m.entry_a as me, m.entry_b as opp, m.score_a as sf, m.score_b as sa
  from public.matches m where m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null
  union all
  select m.id, m.competition_id, m.stage, m.round_label, m.finalized_at, m.result, m.winner_entry_id, m.detail,
         'b', m.entry_b, m.entry_a, m.score_b, m.score_a
  from public.matches m where m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null
), who as (
  select e.id as entry_id, e.fighter_id, null::text as roster_role from public.entries e where e.fighter_id is not null
  union all
  select ef.entry_id, ef.fighter_id, ef.role from public.entry_fighters ef
)
select p.fighter_id, s.match_id, s.competition_id, k.name as competition_name, k.category, coalesce(rc.name, k.category) as category_name, k.gender, k.tier, k.structure,
  s.stage, s.round_label,
  ev.id as event_id, ev.slug as event_slug, ev.name as event_name, ev.starts_on, ev.ends_on as event_ends_on, ev.season_id,
  coalesce(ev.organization_id, se.organization_id) as organization_id,
  e.id as entry_id, case when e.team_id is not null then 'team' else 'individual' end as kind, p.roster_role,
  coalesce(e.team_id, e.represented_team_id) as team_id,
  case when e.team_id is not null then coalesce(e.team_name_at_event, t.name) else coalesce(e.represented_team_name_at_event, rt.name) end as team_name,
  coalesce(t.slug, rt.slug) as team_slug,
  o.id as opponent_entry_id, o.fighter_id as opponent_fighter_id, o.team_id as opponent_team_id,
  coalesce(o.team_name_at_event, ot.name, ofi.display_name) as opponent_name, ot.slug as opponent_team_slug,
  case when s.result = 'draw' then 'draw' when s.winner_entry_id = e.id then 'win' else 'loss' end as outcome,
  s.sf as score_for, s.sa as score_against,
  coalesce((s.detail ->> 'walkover')::boolean, false) as walkover,
  s.finalized_at,
  private.is_synthetic('event', ev.id) as synthetic, private.stats_excluded(ev.id) as stats_excluded
from sides s
join public.entries e on e.id = s.me
join who p on p.entry_id = e.id
join public.entries o on o.id = s.opp
join public.competitions k on k.id = s.competition_id
join public.events ev on ev.id = k.event_id
left join public.seasons se on se.id = ev.season_id
left join public.ref_categories rc on rc.code = k.category
left join public.teams t on t.id = e.team_id
left join public.teams rt on rt.id = e.represented_team_id
left join public.teams ot on ot.id = o.team_id
left join public.fighters ofi on ofi.id = o.fighter_id;

create or replace view public.career_fights with (security_invoker = true) as
select * from public.career_fights_all where not synthetic and not stats_excluded;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- team fights, one row per team and final match of a team entry (what the team itself fought: 5v5, 3v3, ...; never a duelist's result)
create or replace view public.team_fights_all with (security_invoker = true) as
with sides as (
  select m.id as match_id, m.competition_id, m.stage, m.round_label, m.finalized_at, m.result, m.winner_entry_id, m.detail,
         m.entry_a as me, m.entry_b as opp, m.score_a as sf, m.score_b as sa
  from public.matches m where m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null
  union all
  select m.id, m.competition_id, m.stage, m.round_label, m.finalized_at, m.result, m.winner_entry_id, m.detail, m.entry_b, m.entry_a, m.score_b, m.score_a
  from public.matches m where m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null
)
select e.team_id, s.match_id, s.competition_id, k.name as competition_name, k.category, coalesce(rc.name, k.category) as category_name, k.gender, k.tier, k.structure,
  s.stage, s.round_label,
  ev.id as event_id, ev.slug as event_slug, ev.name as event_name, ev.starts_on, ev.ends_on as event_ends_on, ev.season_id,
  coalesce(ev.organization_id, se.organization_id) as organization_id,
  e.id as entry_id, coalesce(e.team_name_at_event, t.name) as team_name_at_event,
  o.id as opponent_entry_id, o.team_id as opponent_team_id, coalesce(o.team_name_at_event, ot.name) as opponent_name, ot.slug as opponent_team_slug,
  case when s.result = 'draw' then 'draw' when s.winner_entry_id = e.id then 'win' else 'loss' end as outcome,
  s.sf as score_for, s.sa as score_against,
  coalesce((s.detail ->> 'walkover')::boolean, false) as walkover,
  s.finalized_at, r.final_place, coalesce(r.points, 0) as points,
  private.is_synthetic('event', ev.id) as synthetic, private.stats_excluded(ev.id) as stats_excluded
from sides s
join public.entries e on e.id = s.me and e.team_id is not null
join public.entries o on o.id = s.opp
join public.competitions k on k.id = s.competition_id
join public.events ev on ev.id = k.event_id
left join public.seasons se on se.id = ev.season_id
left join public.ref_categories rc on rc.code = k.category
left join public.teams t on t.id = e.team_id
left join public.teams ot on ot.id = o.team_id
left join public.results r on r.competition_id = e.competition_id and r.entry_id = e.id and r.final_place is not null;

create or replace view public.team_fights with (security_invoker = true) as
select * from public.team_fights_all where not synthetic and not stats_excluded;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- a fighter's placings with the team each was earned for (fighter_results_all + the represented team, the category's name, the entry's status)
create or replace view public.career_results_all with (security_invoker = true) as
select fr.fighter_id, fr.competition_id, fr.competition_name, fr.category, coalesce(rc.name, fr.category) as category_name, fr.gender, fr.tier, fr.structure,
  fr.entry_id, case when e.team_id is not null then 'team' else 'individual' end as kind, e.status as entry_status,
  coalesce(e.team_id, e.represented_team_id) as team_id,
  case when e.team_id is not null then fr.team_name_at_event else coalesce(e.represented_team_name_at_event, rt.name) end as team_name,
  coalesce(fr.team_current_slug, rt.slug) as team_slug,
  fr.final_place, fr.points,
  fr.event_id, fr.event_slug, fr.event_name, fr.event_type, fr.starts_on, fr.event_ends_on, fr.season_id, fr.organization_id,
  fr.synthetic, fr.stats_excluded
from public.fighter_results_all fr
join public.entries e on e.id = fr.entry_id
left join public.ref_categories rc on rc.code = fr.category
left join public.teams rt on rt.id = e.represented_team_id;

create or replace view public.career_results with (security_invoker = true) as
select * from public.career_results_all where not synthetic and not stats_excluded;

grant select on public.career_fights_all, public.career_fights, public.team_fights_all, public.team_fights, public.career_results_all, public.career_results to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- fighter_career: one call, every total a profile shows, for every filter the page offers.
--   context  'official' (real, not excluded) or 'test' (a fictional event's rows; shown only on a fictional fighter's page, labelled)
--   scope    'career' (everything), 'season' (one season_id), 'organization' (one organization_id)
--   kind / category / gender  null on the total rows; set on the per-discipline lines ('individual' duel categories, 'team' group fights)
--   events        distinct events with a fight or a placing      competitions  distinct competitions with an official placing
--   matches / wins / losses / draws   final fights (a team fight counts for every fighter on its roster)   win_pct  wins / matches, one decimal
--   golds / silvers / bronzes / podiums   placings 1 / 2 / 3 (a shared place counts for each)   points  league points of those placings (team placings included)
--   best_place    the best placing     first_on / last_on   the event dates the record spans
-- Excluded events contribute to NO row (not even the test context). Nothing is inferred from a placing: no matches, no wins or losses.
create or replace function public.fighter_career(p_fighter uuid)
returns table (context text, scope text, season_id uuid, organization_id uuid, kind text, category text, category_name text, gender text,
  events int, competitions int, matches int, wins int, losses int, draws int, win_pct numeric, golds int, silvers int, bronzes int, podiums int, points numeric,
  best_place int, first_on date, last_on date)
language sql stable set search_path = '' as $$
  with facts as (
    select case when f.synthetic then 'test' else 'official' end as ctx, f.season_id, f.organization_id, f.kind, f.category, f.category_name, f.gender,
      f.event_id, null::uuid as result_comp, f.match_id, f.outcome, null::int as place, null::numeric as pts, f.event_ends_on
    from public.career_fights_all f where f.fighter_id = p_fighter and not f.stats_excluded
    union all
    select case when r.synthetic then 'test' else 'official' end, r.season_id, r.organization_id, r.kind, r.category, r.category_name, r.gender,
      r.event_id, r.competition_id, null, null, r.final_place, r.points, r.event_ends_on
    from public.career_results_all r where r.fighter_id = p_fighter and not r.stats_excluded
  ), agg as (
    select ctx, season_id, organization_id, kind, category, category_name, gender,
      grouping(season_id) as gs, grouping(organization_id) as go,
      count(distinct event_id) as events, count(distinct result_comp) as competitions,
      count(match_id) as matches, count(match_id) filter (where outcome = 'win') as wins, count(match_id) filter (where outcome = 'loss') as losses,
      count(match_id) filter (where outcome = 'draw') as draws,
      count(place) filter (where place = 1) as golds, count(place) filter (where place = 2) as silvers, count(place) filter (where place = 3) as bronzes,
      coalesce(sum(pts), 0) as points, min(place) as best_place, min(event_ends_on) as first_on, max(event_ends_on) as last_on
    from facts
    group by grouping sets ((ctx), (ctx, season_id), (ctx, organization_id), (ctx, kind, category, category_name, gender),
      (ctx, season_id, kind, category, category_name, gender), (ctx, organization_id, kind, category, category_name, gender))
  )
  select ctx, case when gs = 0 then 'season' when go = 0 then 'organization' else 'career' end, season_id, organization_id, kind, category, category_name, gender,
    events::int, competitions::int, matches::int, wins::int, losses::int, draws::int,
    case when matches = 0 then null else round(wins * 100.0 / matches, 1) end,
    golds::int, silvers::int, bronzes::int, (golds + silvers + bronzes)::int, points, best_place, first_on, last_on
  from agg
  where not (gs = 0 and season_id is null) and not (go = 0 and organization_id is null)
$$;

-- team_career: the same shape for a team's OWN fights and placings (team entries only; a duelist representing the team is never in these numbers)
create or replace function public.team_career(p_team uuid)
returns table (context text, scope text, season_id uuid, organization_id uuid, category text, category_name text, gender text,
  events int, competitions int, matches int, wins int, losses int, draws int, win_pct numeric, golds int, silvers int, bronzes int, podiums int, points numeric,
  best_place int, first_on date, last_on date)
language sql stable set search_path = '' as $$
  with facts as (
    select case when f.synthetic then 'test' else 'official' end as ctx, f.season_id, f.organization_id, f.category, f.category_name, f.gender,
      f.event_id, null::uuid as result_comp, f.match_id, f.outcome, null::int as place, null::numeric as pts, f.event_ends_on
    from public.team_fights_all f where f.team_id = p_team and not f.stats_excluded
    union all
    select case when r.synthetic then 'test' else 'official' end, r.season_id, r.organization_id, r.category, coalesce(rc.name, r.category), r.gender,
      r.event_id, r.competition_id, null, null, r.final_place, r.points, r.event_ends_on
    from public.team_results_all r left join public.ref_categories rc on rc.code = r.category where r.team_id = p_team and not r.stats_excluded
  ), agg as (
    select ctx, season_id, organization_id, category, category_name, gender,
      grouping(season_id) as gs, grouping(organization_id) as go,
      count(distinct event_id) as events, count(distinct result_comp) as competitions,
      count(match_id) as matches, count(match_id) filter (where outcome = 'win') as wins, count(match_id) filter (where outcome = 'loss') as losses,
      count(match_id) filter (where outcome = 'draw') as draws,
      count(place) filter (where place = 1) as golds, count(place) filter (where place = 2) as silvers, count(place) filter (where place = 3) as bronzes,
      coalesce(sum(pts), 0) as points, min(place) as best_place, min(event_ends_on) as first_on, max(event_ends_on) as last_on
    from facts
    group by grouping sets ((ctx), (ctx, season_id), (ctx, organization_id), (ctx, category, category_name, gender),
      (ctx, season_id, category, category_name, gender), (ctx, organization_id, category, category_name, gender))
  )
  select ctx, case when gs = 0 then 'season' when go = 0 then 'organization' else 'career' end, season_id, organization_id, category, category_name, gender,
    events::int, competitions::int, matches::int, wins::int, losses::int, draws::int,
    case when matches = 0 then null else round(wins * 100.0 / matches, 1) end,
    golds::int, silvers::int, bronzes::int, (golds + silvers + bronzes)::int, points, best_place, first_on, last_on
  from agg
  where not (gs = 0 and season_id is null) and not (go = 0 and organization_id is null)
$$;

-- fighter_head_to_head: direct meetings only. Two fighters "met" when both were the individual entry of the same final fight. A team fight is a
-- meeting of two TEAMS, not of two fighters, so it is never here. Category null = all categories together.
create or replace function public.fighter_head_to_head(p_fighter uuid)
returns table (context text, opponent_fighter_id uuid, opponent_name text, category text, category_name text, gender text,
  meetings int, wins int, losses int, draws int, last_on date)
language sql stable set search_path = '' as $$
  select case when f.synthetic then 'test' else 'official' end, f.opponent_fighter_id, max(f.opponent_name), f.category, f.category_name, f.gender,
    count(*)::int, count(*) filter (where f.outcome = 'win')::int, count(*) filter (where f.outcome = 'loss')::int, count(*) filter (where f.outcome = 'draw')::int,
    max(f.event_ends_on)
  from public.career_fights_all f
  where f.fighter_id = p_fighter and f.kind = 'individual' and f.opponent_fighter_id is not null and not f.stats_excluded
  group by grouping sets ((1, f.opponent_fighter_id), (1, f.opponent_fighter_id, f.category, f.category_name, f.gender))
  order by 1, 7 desc, 3
$$;

-- team_head_to_head: the same for team fights (team entry against team entry). Never built from discipline totals.
create or replace function public.team_head_to_head(p_team uuid)
returns table (context text, opponent_team_id uuid, opponent_name text, opponent_team_slug text, category text, category_name text, gender text,
  meetings int, wins int, losses int, draws int, last_on date)
language sql stable set search_path = '' as $$
  select case when f.synthetic then 'test' else 'official' end, f.opponent_team_id, max(f.opponent_name), max(f.opponent_team_slug), f.category, f.category_name, f.gender,
    count(*)::int, count(*) filter (where f.outcome = 'win')::int, count(*) filter (where f.outcome = 'loss')::int, count(*) filter (where f.outcome = 'draw')::int,
    max(f.event_ends_on)
  from public.team_fights_all f
  where f.team_id = p_team and f.opponent_team_id is not null and not f.stats_excluded
  group by grouping sets ((1, f.opponent_team_id), (1, f.opponent_team_id, f.category, f.category_name, f.gender))
  order by 1, 8 desc, 3
$$;

-- team_fighters_represented: who earned results or fought for the team, from the records (a placing earned while representing the team, or a
-- place on the roster of one of the team's fights). This is evidence of representation, not a membership list.
create or replace function public.team_fighters_represented(p_team uuid)
returns table (context text, fighter_id uuid, display_name text, active boolean, individual_results int, individual_fights int, team_fights int, first_on date, last_on date)
language sql stable set search_path = '' as $$
  with facts as (
    select case when r.synthetic then 'test' else 'official' end as ctx, r.fighter_id, r.competition_id as result_comp, null::uuid as match_id, 'individual' as kind, r.event_ends_on
    from public.career_results_all r where r.team_id = p_team and r.kind = 'individual' and not r.stats_excluded
    union all
    select case when f.synthetic then 'test' else 'official' end, f.fighter_id, null, f.match_id, f.kind, f.event_ends_on
    from public.career_fights_all f where f.team_id = p_team and not f.stats_excluded
  )
  select x.ctx, x.fighter_id, fi.display_name, fi.inactive_at is null,
    count(distinct x.result_comp)::int, count(x.match_id) filter (where x.kind = 'individual')::int, count(x.match_id) filter (where x.kind = 'team')::int,
    min(x.event_ends_on), max(x.event_ends_on)
  from facts x join public.fighters fi on fi.id = x.fighter_id
  group by x.ctx, x.fighter_id, fi.display_name, fi.inactive_at
  order by 1, 9 desc, 3
$$;

revoke execute on function public.fighter_career(uuid), public.team_career(uuid), public.fighter_head_to_head(uuid), public.team_head_to_head(uuid), public.team_fighters_represented(uuid) from public;
grant execute on function public.fighter_career(uuid), public.team_career(uuid), public.fighter_head_to_head(uuid), public.team_head_to_head(uuid), public.team_fighters_represented(uuid) to anon, authenticated;
