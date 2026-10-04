-- Organization rankings for a fictional (synthetic) organization (2026-10-04).
-- Pack 01 keeps fictional events out of result_rows, so ranking_fighters / ranking_teams could never rank a test league such as
-- NACL-test, whose every event is fictional. The rule is now:
--   organization scopes ('season', 'org_career', 'org_all'): real results always count; a fictional result counts only when the
--     organization it belongs to is itself fictional (private.is_synthetic('organization', ...)). A fictional event attached to a real
--     organization, or to no organization, never counts.
--   'career' (the global ranking): real results only, exactly as before.
-- Only the two ranking views change. Same columns, same order, same types: create or replace keeps every grant and the frontend contract.
-- result_rows / fighter_results / team_results and every statistics view still leave all fictional events out.
-- Synthetic means the existing source flag (private.is_synthetic); names and slugs are never looked at.

create or replace view public.ranking_fighters with (security_invoker = true) as
with org_rows as (
  select fighter_id, organization_id, season_id, category, gender, final_place, points
  from public.fighter_results_all
  where not synthetic or private.is_synthetic('organization', organization_id)),
agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, fighter_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from org_rows where season_id is not null group by organization_id, season_id, category, gender, fighter_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, category, gender, fighter_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, fighter_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.fighter_results group by fighter_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.fighter_id, f.display_name, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.fighters f on f.id = a.fighter_id;

create or replace view public.ranking_teams with (security_invoker = true) as
with org_rows as (
  select team_id, organization_id, season_id, category, gender, final_place, points
  from public.team_results_all
  where not synthetic or private.is_synthetic('organization', organization_id)),
agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, team_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from org_rows where season_id is not null group by organization_id, season_id, category, gender, team_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, category, gender, team_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, team_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.team_results group by team_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.team_id, t.name as team_name, t.slug as team_slug, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.teams t on t.id = a.team_id;

comment on view public.ranking_fighters is 'Rankings. Organization scopes count real results, plus fictional results inside a fictional organization; the career scope counts real results only.';
comment on view public.ranking_teams is 'Rankings. Organization scopes count real results, plus fictional results inside a fictional organization; the career scope counts real results only.';
