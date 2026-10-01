-- Statistics count only events that have happened (additive; replaces three views of 20261001002200, same columns).
--
-- Found by loading the NACL-test dataset, which has a current event (Red Deer Rumble-test) whose registered fighters are already entered:
--   * fighter_career_stats.events_attended, fighter_season_stats.events_attended and team_stats.events counted ANY event with an entry or roster row,
--     so an upcoming event with entries (draw made, nothing played) made every entered fighter and team "attend" one more event than they have.
-- Rule now: an event counts once it has happened = it ended before today (database date, UTC) OR at least one of its matches is final. An event with
-- entries but neither (upcoming or ongoing without a result) does not. Everything else in the views is unchanged: matches, wins, medals and points
-- already came from final matches and results only.

create view public.played_events with (security_invoker = true) as
select e.id as event_id
from public.events e
where e.ends_on < current_date
   or exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = e.id and m.queue_state = 'final');
grant select on public.played_events to anon, authenticated;

create or replace view public.fighter_career_stats with (security_invoker = true) as
with ev as (select fighter_id, count(distinct event_id) as events from public.fighter_participation where event_id in (select event_id from public.played_events) group by fighter_id),
mt as (select fighter_id, count(*) as matches, count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses,
              count(*) filter (where outcome = 'draw') as draws from public.fighter_match_rows group by fighter_id),
rs as (select fighter_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes,
              count(*) filter (where final_place = 1 and event_type = 'tournament' and tier is not null and tier <> 'Exhibition') as tournament_victories,
              coalesce(sum(points), 0) as points from public.fighter_results group by fighter_id)
select f.id as fighter_id, f.display_name,
  coalesce(ev.events, 0) as events_attended, coalesce(mt.matches, 0) as matches, coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  case when coalesce(mt.matches, 0) = 0 then null else round(mt.wins * 100.0 / mt.matches, 1) end as win_pct,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums,
  coalesce(rs.tournament_victories, 0) as tournament_victories, coalesce(rs.points, 0) as points
from public.fighters f left join ev on ev.fighter_id = f.id left join mt on mt.fighter_id = f.id left join rs on rs.fighter_id = f.id;

create or replace view public.fighter_season_stats with (security_invoker = true) as
with ev as (select fp.fighter_id, e.season_id, coalesce(e.organization_id, se.organization_id) as organization_id, count(distinct fp.event_id) as events
            from public.fighter_participation fp join public.events e on e.id = fp.event_id left join public.seasons se on se.id = e.season_id
            where e.season_id is not null and fp.event_id in (select event_id from public.played_events) group by 1, 2, 3),
mt as (select fighter_id, season_id, organization_id, count(*) as matches, count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses,
              count(*) filter (where outcome = 'draw') as draws from public.fighter_match_rows where season_id is not null group by 1, 2, 3),
rs as (select fighter_id, season_id, organization_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers,
              count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points from public.fighter_results where season_id is not null group by 1, 2, 3),
keys as (select fighter_id, season_id, organization_id from ev union select fighter_id, season_id, organization_id from mt union select fighter_id, season_id, organization_id from rs)
select k.fighter_id, f.display_name, k.season_id, k.organization_id,
  coalesce(ev.events, 0) as events_attended, coalesce(mt.matches, 0) as matches, coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums, coalesce(rs.points, 0) as points
from keys k join public.fighters f on f.id = k.fighter_id
left join ev on ev.fighter_id = k.fighter_id and ev.season_id = k.season_id and ev.organization_id is not distinct from k.organization_id
left join mt on mt.fighter_id = k.fighter_id and mt.season_id = k.season_id and mt.organization_id is not distinct from k.organization_id
left join rs on rs.fighter_id = k.fighter_id and rs.season_id = k.season_id and rs.organization_id is not distinct from k.organization_id;

create or replace view public.team_stats with (security_invoker = true) as
with ev as (select e.team_id, count(distinct k.event_id) as events from public.entries e join public.competitions k on k.id = e.competition_id
            where e.team_id is not null and e.status <> 'withdrawn' and k.event_id in (select event_id from public.played_events) group by e.team_id),
mt as (select team_id, count(*) as matches, count(*) filter (where category = '5v5') as m5, count(*) filter (where category = '3v3') as m3,
              count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses, count(*) filter (where outcome = 'draw') as draws
       from public.match_sides where team_id is not null group by team_id),
rs as (select team_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes,
              count(*) filter (where final_place = 1 and event_type = 'tournament' and tier is not null and tier <> 'Exhibition') as tournament_wins,
              coalesce(sum(points), 0) as points from public.team_results group by team_id)
select t.id as team_id, t.name as team_name, t.slug as team_slug,
  coalesce(ev.events, 0) as events, coalesce(mt.matches, 0) as matches, coalesce(mt.m5, 0) as matches_5v5, coalesce(mt.m3, 0) as matches_3v3,
  coalesce(mt.matches, 0) - coalesce(mt.m5, 0) - coalesce(mt.m3, 0) as matches_other,
  coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  case when coalesce(mt.matches, 0) = 0 then null else round(mt.wins * 100.0 / mt.matches, 1) end as win_pct,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums,
  coalesce(rs.tournament_wins, 0) as tournament_wins, coalesce(rs.points, 0) as points,
  coalesce((select string_agg(case f.outcome when 'win' then 'W' when 'loss' then 'L' else 'D' end, '' order by f.event_ends_on desc, f.finalized_at desc nulls last, f.match_id desc)
            from (select ms.outcome, ms.event_ends_on, ms.finalized_at, ms.match_id from public.match_sides ms where ms.team_id = t.id
                  order by ms.event_ends_on desc, ms.finalized_at desc nulls last, ms.match_id desc limit 5) f), '') as recent_form
from public.teams t left join ev on ev.team_id = t.id left join mt on mt.team_id = t.id left join rs on rs.team_id = t.id;
