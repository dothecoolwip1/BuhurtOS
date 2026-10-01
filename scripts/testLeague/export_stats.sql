-- Reads each fighter's statistics from the product's own views (never typed in) as one JSON object keyed by fighter id.
--   psql -X -tA -d <scratch db> -f scripts/testLeague/export_stats.sql > scripts/testLeague/stats.json
-- The generator uses it so the bios only claim what the views report.
select jsonb_pretty(coalesce(jsonb_object_agg(f.id, jsonb_build_object(
  'events', (select count(distinct fp.event_id) from public.fighter_participation fp where fp.fighter_id = f.id and exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = fp.event_id and m.queue_state = 'final')), 'matches', c.matches, 'wins', c.wins, 'losses', c.losses,
  'golds', c.golds, 'silvers', c.silvers, 'bronzes', c.bronzes, 'podiums', c.podiums, 'points', c.points,
  'firstYear', (select min(extract(year from ev.starts_on)::int) from public.fighter_participation fp join public.events ev on ev.id = fp.event_id where fp.fighter_id = f.id and exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = ev.id and m.queue_state = 'final')),
  'lastYear', (select max(extract(year from ev.starts_on)::int) from public.fighter_participation fp join public.events ev on ev.id = fp.event_id where fp.fighter_id = f.id and exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = ev.id and m.queue_state = 'final')),
  'medals', coalesce((select jsonb_agg(jsonb_build_object('place', r.final_place, 'comp', r.competition_name, 'event', r.event_name, 'year', extract(year from r.starts_on)::int) order by r.starts_on)
                      from public.fighter_results r where r.fighter_id = f.id and r.final_place <= 3), '[]'::jsonb),
  'byYear', coalesce((select jsonb_object_agg(t.y, jsonb_build_object('m', t.m, 'w', t.w))
                      from (select extract(year from ev.starts_on)::int as y, count(*) as m, count(*) filter (where fr.outcome = 'win') as w
                            from public.fighter_match_rows fr join public.events ev on ev.id = fr.event_id where fr.fighter_id = f.id group by 1) t), '{}'::jsonb),
  'rank', (select jsonb_build_object('div', (case rf.gender when 'men' then 'Male ' else 'Female ' end) || (case rf.category when '5v5' then '5v5' when '3v3' then '3v3' when 'longsword' then 'Longsword'
                                                  when 'sword_shield' then 'Sword & Shield' else 'Polearm' end),
                  'rank', rf.rank,
                  'of', (select count(*) from public.ranking_fighters x where x.scope = 'org_career' and x.organization_id = rf.organization_id and x.category = rf.category and x.gender = rf.gender))
           from public.ranking_fighters rf where rf.fighter_id = f.id and rf.scope = 'org_career' order by rf.rank, rf.competitions desc limit 1)
)), '{}'::jsonb))
from public.fighters f join public.fighter_career_stats c on c.fighter_id = f.id;
