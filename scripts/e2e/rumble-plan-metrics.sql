-- Pack 11 plan sanity metrics for one event: run as  psql -d <db> -v event=<uuid> -f scripts/e2e/rumble-plan-metrics.sql
-- Reads the saved plan (matches.plan_order, the planner's event-wide order of waiting fights; plan_hold = held back). A person's rest before a
-- fight = planned fights between their previous appearance and this one (the planner's own definition, REST_TARGET 3). People = the duel fighter
-- or the recorded roster of a team entry. Prints one JSON row: rest distribution, short-rest fights, held fights, availability violations
-- (a fight that is NOT held although someone in it is not attending today), equipment-sharing fights planned back to back, double bookings.
with ev as (select id, starts_on, (now() at time zone coalesce(timezone, 'America/Edmonton'))::date as today from public.events where id = :'event'),
planned as (
  select m.id, m.plan_order, m.plan_hold, m.competition_id, m.entry_a, m.entry_b
  from public.matches m join public.competitions k on k.id = m.competition_id join ev on ev.id = k.event_id
  where m.queue_state = 'scheduled' and (m.plan_order is not null or m.plan_hold)),
people as (
  select p.id as match_id, p.plan_order, coalesce(e.fighter_id, ef.fighter_id) as fighter_id
  from planned p join public.entries e on e.id in (p.entry_a, p.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null
  where not p.plan_hold and p.plan_order is not null and coalesce(e.fighter_id, ef.fighter_id) is not null),
gaps as (
  select match_id, fighter_id, plan_order - lag(plan_order) over (partition by fighter_id order by plan_order) - 1 as rest from people),
fight_rest as (select match_id, min(rest) as min_rest from gaps group by match_id),
unavailable as (
  select g.fighter_id from public.registrations g join ev on ev.id = g.event_id
  where g.status = 'accepted' and g.fighter_id is not null and coalesce(array_length(g.attend_dates, 1), 0) > 0 and not (ev.today = any (g.attend_dates))),
shares as (select g.fighter_id from public.registrations g join ev on ev.id = g.event_id where g.status = 'accepted' and g.shares_equipment and g.fighter_id is not null),
adjacent_shares as (
  select count(*) as n from people a join people b on b.fighter_id = a.fighter_id and b.plan_order = a.plan_order + 1
  where a.fighter_id in (select fighter_id from shares))
select jsonb_build_object(
  'planned', (select count(*) from planned where not plan_hold),
  'held', (select count(*) from planned where plan_hold),
  'with_rest', (select count(*) from fight_rest where min_rest is not null),
  'rest_0', (select count(*) from fight_rest where min_rest = 0),
  'rest_1', (select count(*) from fight_rest where min_rest = 1),
  'rest_2', (select count(*) from fight_rest where min_rest = 2),
  'rest_3_plus', (select count(*) from fight_rest where min_rest >= 3),
  'first_appearance', (select count(*) from planned p where not p.plan_hold and not exists (select 1 from fight_rest r where r.match_id = p.id and r.min_rest is not null)),
  'availability_violations', (select count(distinct p.match_id) from people p where p.fighter_id in (select fighter_id from unavailable)),
  'held_for_unavailable', (select count(*) from planned p where p.plan_hold and exists (
      select 1 from public.entries e left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null
      where e.id in (p.entry_a, p.entry_b) and coalesce(e.fighter_id, ef.fighter_id) in (select fighter_id from unavailable))),
  'double_booked_slots', (select count(*) from (select fighter_id, plan_order from people group by 1, 2 having count(*) > 1) d),
  'shares_back_to_back', (select n from adjacent_shares),
  'people', (select count(distinct fighter_id) from people)
) as metrics;
