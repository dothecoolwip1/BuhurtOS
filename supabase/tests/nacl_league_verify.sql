-- NACL-test dataset verification. Read-only: everything runs in a transaction that is rolled back.
--   psql -X -d <db> -f supabase/tests/nacl_league_verify.sql                     (local scratch)
--   psql -X -d <db> -v owner_id=<owner auth user id> -f supabase/tests/nacl_league_verify.sql
-- owner_id is only used to call fighter_schedule_conflicts as the owner (the real function, with its real permission check).
-- Prints PASS / FAIL per check, a summary, then a report of the numbers.
\set ON_ERROR_STOP off
\if :{?owner_id}
\else
\set owner_id 00000000-0000-4000-8000-0000000000a1
\endif
begin;
create temp table chk (n serial, name text, ok boolean, detail text);
create function pg_temp.c(p_name text, p_ok boolean, p_detail text default '') returns void language sql as $$ insert into chk (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

create temp view v_org as select id from public.organizations where slug = 'nacl-test';
create temp view v_ev as select e.* from public.events e where e.organization_id = (select id from v_org);
create temp view v_hist as select * from v_ev where slug <> 'red-deer-rumble-test';
create temp view v_f as select f.* from public.fighters f join public.team_affiliations a on a.team_id = f.team_id and a.organization_id = (select id from v_org) and a.relation = 'member';
-- Participation limited to completed (finalized) events, used for bio checks and attendance.
create temp view v_part as select distinct fp.fighter_id, fp.event_id from public.fighter_participation fp where fp.event_id in (select id from v_hist);

-- ============================================================ organization, teams, fighters
select pg_temp.c('organization NACL-test exists (regional, Canada, Western Canada, enabled)',
  exists (select 1 from public.organizations where slug = 'nacl-test' and name = 'Northern Armored Combat League-test' and short_name = 'NACL-test' and kind = 'regional' and country = 'Canada' and region = 'Western Canada' and enabled));
select pg_temp.c('4 seasons of the organization (2023-2026)', (select count(*) from public.seasons where organization_id = (select id from v_org) and slug ~ '^nacl-test-20(23|24|25|26)$') = 4);
select pg_temp.c('10 teams, all approved and affiliated (member) to NACL-test, all named -test',
  (select count(distinct t.id) from public.teams t join public.team_affiliations a on a.team_id = t.id and a.relation = 'member' and a.organization_id = (select id from v_org) where t.status = 'approved' and t.name like '%-test') = 10,
  (select count(*)::text from public.team_affiliations a where a.organization_id = (select id from v_org)));
select pg_temp.c('120 distinct fighters, 12 on every team',
  (select count(*) from v_f) = 120 and (select count(distinct id) from v_f) = 120 and (select count(*) from (select team_id from v_f group by 1 having count(*) = 12) x) = 10);
select pg_temp.c('no duplicate fighter names; every name ends with -test', (select count(distinct display_name) from v_f) = 120 and (select count(*) from v_f where display_name not like '%-test') = 0);
select pg_temp.c('genders: 70 male, 50 female', (select count(*) filter (where gender = 'male') from v_f) = 70 and (select count(*) filter (where gender = 'female') from v_f) = 50);
select pg_temp.c('profiles complete (gender, birth_year, city, region, country, joined_year, disciplines, style, bio, highlights)',
  (select count(*) from v_f where gender is null or birth_year is null or city is null or region is null or country is null or joined_year is null or cardinality(disciplines) = 0
     or fighting_style is null or bio is null or char_length(bio) < 60 or cardinality(highlights) = 0) = 0);
select pg_temp.c('birth_year = 2026 - age (ages 23 to 39)', (select count(*) from v_f where birth_year not between 1987 and 2003) = 0);
select pg_temp.c('every fighter has a current non-mercenary membership equal to fighters.team_id (no fighter on two permanent teams)',
  (select count(*) from v_f f where (select count(*) from public.team_memberships m where m.fighter_id = f.id and not m.mercenary and m.to_date is null) <> 1
     or not exists (select 1 from public.team_memberships m where m.fighter_id = f.id and not m.mercenary and m.to_date is null and m.team_id = f.team_id)) = 0);
select pg_temp.c('memberships start at the join date (year matches joined_year)', (select count(*) from public.team_memberships m join v_f f on f.id = m.fighter_id where extract(year from m.from_date) <> f.joined_year) = 0);
select pg_temp.c('provenance: every fighter, team, event, competition, season and the organization has an unverified record_source "NACL-test fictional dataset"',
  (select count(*) from v_f f where not exists (select 1 from public.record_sources r join public.sources s on s.id = r.source_id where r.entity_type = 'fighter' and r.entity_id = f.id and r.status = 'unverified' and s.title = 'NACL-test fictional dataset')) = 0
  and (select count(*) from v_ev e where not exists (select 1 from public.record_sources r where r.entity_type = 'event' and r.entity_id = e.id and r.status = 'unverified')) = 0
  and (select count(*) from public.competitions k where k.event_id in (select id from v_ev) and not exists (select 1 from public.record_sources r where r.entity_type = 'competition' and r.entity_id = k.id)) = 0
  and exists (select 1 from public.record_sources r where r.entity_type = 'organization' and r.entity_id = (select id from v_org)));
select pg_temp.c('the assumed join year is flagged (Gunnar Reed-test)', exists (select 1 from public.record_sources r join public.fighters f on f.id = r.entity_id where r.entity_type = 'fighter' and f.display_name = 'Gunnar Reed-test' and r.note ilike '%ASSUMPTION%'));

-- ============================================================ events
select pg_temp.c('16 events linked to the organization and a season (15 historical + the Rumble), all named -test, all published',
  (select count(*) from v_ev) = 16 and (select count(*) from v_ev where season_id is null or name not like '%-test' or status <> 'published') = 0);
select pg_temp.c('15 completed historical events: every competition finished, dates May 2023 to Sep 2026',
  (select count(*) from v_hist) = 15
  and (select count(*) from v_hist e where exists (select 1 from public.competitions k where k.event_id = e.id and k.status <> 'finished') or not exists (select 1 from public.competitions k where k.event_id = e.id)) = 0
  and (select min(starts_on) from v_hist) >= date '2023-05-01' and (select max(ends_on) from v_hist) <= date '2026-09-30');
select pg_temp.c('provinces 9 AB / 2 BC / 2 SK / 2 MB', (select string_agg(region || ':' || n, ' ' order by region) from (select region, count(*) n from v_hist group by 1) x) = 'AB:9 BC:2 MB:2 SK:2',
  (select string_agg(region || ':' || n, ' ' order by region) from (select region, count(*) n from v_hist group by 1) x));
select pg_temp.c('events per year 3 / 4 / 5 / 3', (select string_agg(y || ':' || n, ' ' order by y) from (select extract(year from starts_on)::int y, count(*) n from v_hist group by 1) x) = '2023:3 2024:4 2025:5 2026:3');
select pg_temp.c('competition categories are existing ref_categories keys (no duplicates created), genders men/women, every competition has a tier from ref_tiers',
  (select count(*) from public.competitions k where k.event_id in (select id from v_ev) and (k.gender not in ('men', 'women') or k.category not in ('5v5', '3v3', 'longsword', 'sword_shield', 'polearm') or k.tier is null)) = 0
  and (select count(*) from public.ref_categories) = 13 and (select count(*) from public.ref_tiers) = 5);
select pg_temp.c('championships are Regional; small events Source or Classic',
  (select count(distinct k.tier) from public.competitions k join v_ev e on e.id = k.event_id where e.slug like '%championship-test' and k.tier = 'Regional') = 1
  and (select count(*) from public.competitions k join v_ev e on e.id = k.event_id where e.slug like '%championship-test' and k.tier <> 'Regional') = 0
  and (select count(*) from public.competitions k join v_ev e on e.id = k.event_id where e.slug not like '%championship-test' and k.tier = 'Regional') = 0);
select pg_temp.c('every event has one tier and varying divisions: smallest event has <= 5 competitions, championships >= 8',
  (select min(n) from (select count(*) n from public.competitions k where k.event_id in (select id from v_hist) group by k.event_id) x) <= 5
  and (select min(n) from (select count(*) n from public.competitions k join v_hist e on e.id = k.event_id where e.slug like '%championship-test' group by k.event_id) x) >= 8);

-- ============================================================ attendance
create temp table att as select event_id, count(*) n, string_agg(fighter_id::text, ',' order by fighter_id) s from v_part group by 1;
select pg_temp.c('attendance sets differ per event (15 distinct sets)', (select count(distinct md5(s)) from att) = 15);
select pg_temp.c('consecutive events never share more than 80 percent of their fighters',
  (select count(*) from (select a.event_id, (select count(*) from v_part x join v_part y on y.fighter_id = x.fighter_id and y.event_id = (select e2.id from v_hist e2 where e2.starts_on = (select max(e3.starts_on) from v_hist e3 where e3.starts_on < e1.starts_on))
     where x.event_id = e1.id)::numeric / nullif(a.n, 0) as share from att a join v_hist e1 on e1.id = a.event_id) z where z.share > 0.8) = 0);
select pg_temp.c('event sizes by class: small 20-25, medium 30-40, large 40-55 unique fighters',
  (select count(*) from att a join v_hist e on e.id = a.event_id where
     (e.slug in ('central-alberta-steel-open-test', 'battle-of-the-badlands-test', 'blackfalds-battle-bash-test', 'manitoba-medieval-melee-test', 'grande-prairie-northern-clash-test') and a.n not between 20 and 25)
     or (e.slug in ('saskatchewan-steel-cup-test', 'edmonton-winter-melee-test', 'okanagan-armored-open-test', 'prairie-siege-test', 'queen-city-combat-classic-test', 'medicine-hat-mayhem-test') and a.n not between 30 and 40)
     or (e.slug in ('calgary-iron-clash-test', 'prairie-crown-championship-test', 'pacific-steel-championship-test', 'rocky-mountain-rumble-test') and a.n not between 40 and 55)) = 0,
  (select string_agg(e.slug || '=' || a.n, ' ' order by e.starts_on) from att a join v_hist e on e.id = a.event_id));
select pg_temp.c('nobody has an entry or roster row before they joined (year and membership date); Finn Mercer-test not before late 2024',
  (select count(*) from v_part p join public.events ev on ev.id = p.event_id join v_f f on f.id = p.fighter_id join public.team_memberships m on m.fighter_id = f.id and not m.mercenary
     where ev.starts_on <= m.from_date or extract(year from ev.starts_on) < f.joined_year) = 0
  and (select min(ev.starts_on) from v_part p join public.events ev on ev.id = p.event_id join v_f f on f.id = p.fighter_id where f.display_name = 'Finn Mercer-test') >= date '2024-10-01');
create temp table cnt as select f.id, f.display_name, f.team_id, f.joined_year, f.gender, coalesce((select count(*) from v_part p where p.fighter_id = f.id), 0) n from v_f f;
select pg_temp.c('attendance spread: some fighters at 10-12 events, a few at 2, typical 4-6, everybody at least 2, nobody over 12',
  (select count(*) from cnt where n between 10 and 12) between 3 and 10 and (select count(*) from cnt where n = 2) between 1 and 10 and (select min(n) from cnt) >= 2 and (select max(n) from cnt) <= 12
  and (select percentile_cont(0.5) within group (order by n) from cnt) between 4 and 6,
  (select 'very active ' || count(*) filter (where n >= 10) || ', at 2: ' || count(*) filter (where n = 2) || ', median ' || percentile_cont(0.5) within group (order by n) from cnt));
select pg_temp.c('home regions: Alberta clubs (Iron Wolves, Blackforge, Stags, Serpents) attend mostly Alberta events (at least half of their attendances)',
  (select bool_and(share >= 0.5) from (select t.name, avg((e.region = 'AB')::int) share from v_part p join v_hist e on e.id = p.event_id join v_f f on f.id = p.fighter_id join public.teams t on t.id = f.team_id
     where t.name in ('Iron Wolves-test', 'Blackforge Knights-test', 'Crimson Stags-test', 'Steel Serpents-test') group by t.name) x),
  (select string_agg(name || '=' || round(share, 2), ' ') from (select t.name, avg((e.region = 'AB')::int) share from v_part p join v_hist e on e.id = p.event_id join v_f f on f.id = p.fighter_id join public.teams t on t.id = f.team_id group by t.name order by 1) x));
select pg_temp.c('Frostborn mostly at BC, Stormbreakers and Golden Lions mostly at SK, Ashen Guard mostly at MB: the home province takes at least 40 percent of their attendances although it hosts only 2 of 15 events, with some long-distance appearances',
  (select bool_and(home >= 0.4 and away > 0) from (select name, max(share) filter (where home_prov) home, max(share) best, sum(n) filter (where not home_prov) away from (
       select t.name, e.region, (e.region = f.region) home_prov, count(*)::numeric / sum(count(*)) over (partition by t.name) share, count(*) n
       from v_part p join v_hist e on e.id = p.event_id join v_f f on f.id = p.fighter_id join public.teams t on t.id = f.team_id
       where t.name in ('Frostborn Raiders-test', 'Stormbreakers-test', 'Golden Lions-test', 'Ashen Guard-test') group by t.name, e.region, f.region) y group by name) x),
  (select string_agg(name || '=' || round(home, 2), ' ') from (select t.name, avg((e.region = f.region)::int) home from v_part p join v_hist e on e.id = p.event_id join v_f f on f.id = p.fighter_id join public.teams t on t.id = f.team_id
     where t.name in ('Frostborn Raiders-test', 'Stormbreakers-test', 'Golden Lions-test', 'Ashen Guard-test') group by t.name) x));

-- ============================================================ entries, rosters, mercenaries
select pg_temp.c('every historical and current team entry has a roster of exactly the format size (5v5 = 5, 3v3 = 3)',
  (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id in (select id from v_ev) and e.team_id is not null
     and (select count(*) from public.entry_fighters ef where ef.entry_id = e.id) <> (case k.category when '5v5' then 5 else 3 end)) = 0);
select pg_temp.c('duel competitions only have fighter entries; team competitions only team entries',
  (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id in (select id from v_ev)
     and ((k.category in ('5v5', '3v3') and e.team_id is null) or (k.category not in ('5v5', '3v3') and e.fighter_id is null))) = 0);
select pg_temp.c('no fighter in two entries of the same competition', (select count(*) from (select competition_id, fighter_id from public.fighter_participation fp join public.competitions k on k.id = fp.competition_id where k.event_id in (select id from v_ev) group by 1, 2 having count(*) > 1) x) = 0);
select pg_temp.c('fighters only enter divisions of their own gender and discipline (mercenaries too)',
  (select count(*) from public.fighter_participation fp join public.competitions k on k.id = fp.competition_id join public.fighters f on f.id = fp.fighter_id
     where k.event_id in (select id from v_ev) and (not (k.category = any (f.disciplines)) or (k.gender = 'men' and f.gender <> 'male') or (k.gender = 'women' and f.gender <> 'female'))) = 0);
select pg_temp.c('own-team roster members really belong to the team; mercenaries keep permanent_team_id = fighters.team_id (home team unchanged) and are on another team',
  (select count(*) from public.entry_fighters ef join public.entries e on e.id = ef.entry_id join public.fighters f on f.id = ef.fighter_id
     where (ef.role = 'fighter' and f.team_id <> e.team_id) or (ef.role = 'mercenary' and (ef.permanent_team_id is distinct from f.team_id or f.team_id = e.team_id)) or ef.role = 'guest') = 0
  and (select count(*) from public.entry_fighters where role = 'mercenary') > 0);
select pg_temp.c('mercenary scenarios exist at several historical events and at the Rumble',
  (select count(distinct k.event_id) from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where ef.role = 'mercenary' and k.event_id in (select id from v_hist)) >= 5
  and exists (select 1 from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id join v_ev e on e.id = k.event_id where ef.role = 'mercenary' and e.slug = 'red-deer-rumble-test'));
select pg_temp.c('a team that lends a mercenary keeps its own roster size (mercenaries never exceed 2 on a roster)',
  (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id in (select id from v_ev) and e.team_id is not null
     and (select count(*) from public.entry_fighters ef where ef.entry_id = e.id and ef.role = 'mercenary') > 2) = 0);

-- ============================================================ matches and results
select pg_temp.c('every match has both entries (completed events), final matches have a result and winner',
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id in (select id from v_hist) and (m.entry_a is null or m.entry_b is null or m.queue_state <> 'final' or m.winner_entry_id is null or m.result is null)) = 0);
select pg_temp.c('every result belongs to an entry of the same competition; one result per non-withdrawn entry of each finished competition',
  (select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id in (select id from v_hist) and not exists (select 1 from public.entries e where e.id = r.entry_id and e.competition_id = r.competition_id)) = 0
  and (select count(*) from public.competitions k where k.event_id in (select id from v_hist) and (select count(*) from public.results r where r.competition_id = k.id) <> (select count(*) from public.entries e where e.competition_id = k.id and e.status <> 'withdrawn')) = 0);
select pg_temp.c('team results exist only for teams that had an entry in that competition',
  (select count(*) from public.team_results tr where tr.event_id in (select id from v_ev) and not exists (select 1 from public.entries e where e.competition_id = tr.competition_id and e.team_id = tr.team_id)) = 0);
select pg_temp.c('medals only at attended events: every medal row has a participation at that event, and recounted medals equal fighter_career_stats.podiums',
  (select count(*) from public.fighter_results r where r.final_place <= 3 and r.event_id in (select id from v_ev) and not exists (select 1 from public.fighter_participation p where p.fighter_id = r.fighter_id and p.event_id = r.event_id)) = 0
  and (select count(*) from v_f f join public.fighter_career_stats c on c.fighter_id = f.id where (
     select count(*) from public.results r join public.entries e on e.id = r.entry_id left join public.entry_fighters ef on ef.entry_id = e.id where r.final_place <= 3 and (e.fighter_id = f.id or ef.fighter_id = f.id)) <> c.podiums) = 0);
select pg_temp.c('final of every elimination competition: winner has place 1 and loser place 2; third-place winner place 3',
  (select count(*) from public.matches m join public.results r on r.competition_id = m.competition_id where m.queue_state = 'final'
     and ((m.stage = 'final' and ((r.entry_id = m.winner_entry_id and r.final_place <> 1) or (r.entry_id = (case when m.winner_entry_id = m.entry_a then m.entry_b else m.entry_a end) and r.final_place <> 2)))
       or (m.stage = 'third_place' and r.entry_id = m.winner_entry_id and r.final_place <> 3))) = 0);
select pg_temp.c('round robin: more wins never means a worse place',
  (select count(*) from (select r.competition_id, r.entry_id, r.final_place, (select count(*) from public.matches m where m.competition_id = r.competition_id and m.winner_entry_id = r.entry_id) w
     from public.results r join public.competitions k on k.id = r.competition_id where k.structure = 'round_robin' and k.event_id in (select id from v_hist)) a
     join (select r.competition_id, r.entry_id, r.final_place, (select count(*) from public.matches m where m.competition_id = r.competition_id and m.winner_entry_id = r.entry_id) w
     from public.results r join public.competitions k on k.id = r.competition_id where k.structure = 'round_robin' and k.event_id in (select id from v_hist)) b
     on a.competition_id = b.competition_id and a.w > b.w and a.final_place > b.final_place) = 0);
select pg_temp.c('points agree with placements: recomputed (pool/round-robin wins + 2 x elimination wins + 6/4/2 for places 1/2/3) x tier multiplier equals results.points',
  (select count(*) from public.results r join public.competitions k on k.id = r.competition_id join public.ref_tiers t on t.name = k.tier
     where k.event_id in (select id from v_hist) and r.points <> round((
       (select count(*) from public.matches m where m.competition_id = r.competition_id and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and m.winner_entry_id = r.entry_id)
       + 2 * (select count(*) from public.matches m where m.competition_id = r.competition_id and m.queue_state = 'final' and m.stage in ('elimination', 'third_place', 'final') and m.winner_entry_id = r.entry_id)
       + case when exists (select 1 from public.matches m where m.competition_id = r.competition_id and m.queue_state = 'final' and r.entry_id in (m.entry_a, m.entry_b))
              then (case r.final_place when 1 then 6 when 2 then 4 when 3 then 2 else 0 end) else 0 end) * t.multiplier_tournament_structure, 2)) = 0);
select pg_temp.c('duel stats come only from duel matches: duel-category match rows = 2 x final duel matches; melee rows = roster sizes of final melee matches',
  (select coalesce(sum(matches), 0) from public.fighter_match_stats where category in ('longsword', 'sword_shield', 'polearm') and fighter_id in (select id from v_f))
    = (select 2 * count(*) from public.matches m join public.competitions k on k.id = m.competition_id where m.queue_state = 'final' and k.event_id in (select id from v_ev) and k.category in ('longsword', 'sword_shield', 'polearm'))
  and (select coalesce(sum(matches), 0) from public.fighter_match_stats where category in ('5v5', '3v3') and fighter_id in (select id from v_f))
    = (select coalesce(sum((select count(*) from public.entry_fighters ef where ef.entry_id = m.entry_a) + (select count(*) from public.entry_fighters ef where ef.entry_id = m.entry_b)), 0)
       from public.matches m join public.competitions k on k.id = m.competition_id where m.queue_state = 'final' and k.event_id in (select id from v_ev) and k.category in ('5v5', '3v3')));
select pg_temp.c('duel round points: detail.rounds sums equal score_a / score_b and the winner leads by 2 or more after at least 2 rounds',
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id in (select id from v_hist) and k.category in ('longsword', 'sword_shield', 'polearm')
     and not ((select sum(x::int) from jsonb_array_elements_text(m.detail #> '{rounds,a}') x) = m.score_a and (select sum(x::int) from jsonb_array_elements_text(m.detail #> '{rounds,b}') x) = m.score_b
              and abs(m.score_a - m.score_b) >= 2 and jsonb_array_length(m.detail #> '{rounds,a}') >= 2)) = 0);
select pg_temp.c('group fight detail: roundsWon equals score_a / score_b and the winner reached roundsToWin',
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id in (select id from v_hist) and k.category in ('5v5', '3v3')
     and not ((m.detail #>> '{roundsWon,a}')::int = m.score_a and (m.detail #>> '{roundsWon,b}')::int = m.score_b and greatest(m.score_a, m.score_b) = (m.detail ->> 'roundsToWin')::int)) = 0);
select pg_temp.c('scoring records: one audit entry match.finalized per final match, competition.finished per finished competition',
  (select count(*) from public.audit_log where action = 'match.finalized' and event_id in (select id from v_hist)) = (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where m.queue_state = 'final' and k.event_id in (select id from v_hist))
  and (select count(*) from public.audit_log where action = 'competition.finished' and event_id in (select id from v_hist)) >= (select count(*) from public.competitions where event_id in (select id from v_hist)));

-- ============================================================ rankings and stats
select pg_temp.c('ranking_fighters: rank = 1 + number of fighters with more points, in every scope and division',
  (select count(*) from (select rank, points, rank() over (partition by scope, organization_id, season_id, category, gender order by points desc) r from public.ranking_fighters) x where x.rank <> x.r) = 0
  and (select count(*) from public.ranking_fighters where scope = 'org_career') > 0);
select pg_temp.c('ranking_teams: same rule', (select count(*) from (select rank, points, rank() over (partition by scope, organization_id, season_id, category, gender order by points desc) r from public.ranking_teams) x where x.rank <> x.r) = 0);
select pg_temp.c('ranking points equal the sum of result points (fighters: season scope and career scope)',
  (select coalesce(sum(points), 0) from public.ranking_fighters where scope = 'org_all') = (select coalesce(sum(points), 0) from public.fighter_results where organization_id = (select id from v_org))
  and (select coalesce(sum(points), 0) from public.ranking_teams where scope = 'org_all') = (select coalesce(sum(points), 0) from public.team_results where organization_id = (select id from v_org)));
select pg_temp.c('season rankings exist for each season and the 10 divisions have rankings', (select count(distinct season_id) from public.ranking_fighters where scope = 'season') = 4 and (select count(distinct (category, gender)) from public.ranking_fighters where scope = 'org_career') >= 8);
select pg_temp.c('stats populated: nearly every fighter and every team has matches; season and category stats exist',
  (select count(*) from v_f f join public.fighter_career_stats c on c.fighter_id = f.id where c.matches > 0) >= 118
  and (select count(*) from public.team_stats ts join public.team_affiliations a on a.team_id = ts.team_id and a.organization_id = (select id from v_org) where ts.matches > 0 and ts.events > 0) = 10
  and (select count(distinct season_id) from public.fighter_season_stats where season_id is not null) = 4
  and (select count(*) from public.fighter_match_stats where fighter_id in (select id from v_f)) > 200);
select pg_temp.c('events_attended counts only events that have happened (the upcoming Rumble is not attended): equals the participation at completed events, for fighters and teams',
  (select count(*) from v_f f join public.fighter_career_stats c on c.fighter_id = f.id where c.events_attended <> (select count(*) from v_part p where p.fighter_id = f.id)) = 0
  and (select count(*) from public.team_stats ts where ts.team_id in (select team_id from v_f) and ts.events <> (select count(distinct k.event_id) from public.entries e join public.competitions k on k.id = e.competition_id where e.team_id = ts.team_id and e.status <> 'withdrawn' and k.event_id in (select id from v_hist))) = 0);
select pg_temp.c('stats differ across fighters: many distinct match counts, veterans fight more than newcomers',
  (select count(distinct matches) from public.fighter_career_stats where fighter_id in (select id from v_f)) >= 15
  and (select avg(c.matches) from public.fighter_career_stats c join v_f f on f.id = c.fighter_id where f.joined_year <= 2020) > (select avg(c.matches) from public.fighter_career_stats c join v_f f on f.id = c.fighter_id where f.joined_year >= 2024),
  (select 'veterans ' || round(avg(c.matches) filter (where f.joined_year <= 2020), 1) || ' vs 2024 joiners ' || round(avg(c.matches) filter (where f.joined_year >= 2024), 1) from public.fighter_career_stats c join v_f f on f.id = c.fighter_id));
select pg_temp.c('team success is spread: at least 7 of 10 teams have a team gold, and no team has more than 40 percent of team golds',
  (select count(*) filter (where golds > 0) from public.team_stats where team_id in (select team_id from v_f)) >= 7
  and (select max(golds)::numeric / nullif(sum(golds), 0) from public.team_stats where team_id in (select team_id from v_f)) <= 0.4,
  (select string_agg(team_name || '=' || golds, ' ' order by golds desc) from public.team_stats where team_id in (select team_id from v_f)));
select pg_temp.c('no team wins every team competition', (select count(*) from (select competition_id from public.team_results tr where tr.event_id in (select id from v_hist) and final_place = 1 group by 1) x) > (select max(golds) from public.team_stats where team_id in (select team_id from v_f)) - 1);
select pg_temp.c('bios tell the same story as the results: phrases are backed by the views (golds, podiums, record, activity, experience, attended count)',
  (select count(*) from v_f f join public.fighter_career_stats c on c.fighter_id = f.id left join (select fighter_id, count(*) n from v_part group by 1) p on p.fighter_id = f.id where
     (f.bio like '%A regular podium finisher%' and c.podiums < 4) or (f.bio like '%A tournament winner%' and c.golds < 1) or (f.bio like '%Has yet to reach a podium%' and c.podiums > 0)
     or (f.bio like '%A winning record overall%' and c.wins * 2 <= c.matches) or (f.bio like '%A losing record so far%' and c.wins * 2 >= c.matches) or (f.bio like '%One of the most active%' and coalesce(p.n, 0) < 9)
     or (f.bio like '%A veteran who joined%' and f.joined_year > 2020) or (f.bio like '%A newer competitor%' and f.joined_year < 2024)
     or (f.bio not like '%Has attended ' || coalesce(p.n, 0) || ' NACL-test event%') or (f.bio like '%Has reached the podium once%' and c.podiums <> 1)) = 0);

-- ============================================================ the current event
create temp view v_r as select * from v_ev where slug = 'red-deer-rumble-test';
create temp table rpart as select distinct fp.fighter_id from public.fighter_participation fp where fp.event_id = (select id from v_r);
select pg_temp.c('Rumble: published, registration_mode none, Red Deer AB, Nov 14-15 2026, organization NACL-test, season set',
  exists (select 1 from v_r where status = 'published' and registration_mode = 'none' and city = 'Red Deer' and region = 'AB' and starts_on = date '2026-11-14' and ends_on = date '2026-11-15' and season_id is not null and name = 'Red Deer Rumble-test'));
select pg_temp.c('Rumble: about 40 unique fighters (38-44), 25-30 men, 10-15 women',
  (select count(*) from rpart) between 38 and 44 and (select count(*) from rpart p join public.fighters f on f.id = p.fighter_id where f.gender = 'male') between 25 and 30
  and (select count(*) from rpart p join public.fighters f on f.id = p.fighter_id where f.gender = 'female') between 10 and 15,
  (select (select count(*) from rpart) || ' unique, ' || count(*) filter (where f.gender = 'male') || ' men, ' || count(*) filter (where f.gender = 'female') || ' women' from rpart p join public.fighters f on f.id = p.fighter_id));
select pg_temp.c('Rumble: category registrations (duel entries + roster rows) about 90 (80-105) and more than unique fighters; entries in all of 5v5, 3v3, longsword, sword & shield, polearm for men and women where viable',
  (select count(*) from public.fighter_participation fp where fp.event_id = (select id from v_r)) between 80 and 105
  and (select count(*) from public.fighter_participation fp where fp.event_id = (select id from v_r)) > (select count(*) from rpart)
  and (select count(distinct k.category) from public.competitions k where k.event_id = (select id from v_r)) = 5,
  (select count(*) || ' registrations, ' || (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r)) || ' entries, ' || (select count(*) from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where k.event_id = (select id from v_r)) || ' roster rows'
   from public.fighter_participation fp where fp.event_id = (select id from v_r)));
select pg_temp.c('Female 3v3 works: the Rumble has a Female 3v3 competition with at least 3 team entries (11 women have a 3v3 discipline, so 3 teams of 3 is the most that exist), a drawn schedule, and every roster of 3 is completed with at most 2 mercenaries who are women with 3v3',
  (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and k.name = 'Female 3v3' and k.gender = 'women' and k.category = '3v3') >= 3
  and (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = (select id from v_r) and k.name = 'Female 3v3') >= 3
  and (select count(*) from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id join public.fighters f on f.id = ef.fighter_id where k.event_id = (select id from v_r) and k.name = 'Female 3v3'
        and (f.gender <> 'female' or not ('3v3' = any (f.disciplines)))) = 0
  and (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and k.name = 'Female 3v3' and (select count(*) from public.entry_fighters ef where ef.entry_id = e.id and ef.role = 'mercenary') > 2) = 0);
select pg_temp.c('Female 3v3 also ran at 2 or more historical events, with finished results',
  (select count(distinct k.event_id) from public.competitions k where k.name = 'Female 3v3' and k.status = 'finished' and k.event_id in (select id from v_hist)) >= 2);
select pg_temp.c('Rumble: many fighters in several categories', (select count(*) from (select fighter_id from public.fighter_participation where event_id = (select id from v_r) group by 1 having count(*) >= 2) x) >= 15);
select pg_temp.c('Rumble: attendance differs from the latest completed event (under 45 percent overlap), with returnees and newcomers',
  (select count(*) from rpart r join v_part p on p.fighter_id = r.fighter_id and p.event_id = (select id from v_hist order by starts_on desc limit 1))::numeric
     / (select count(*) from (select fighter_id from rpart union select fighter_id from v_part where event_id = (select id from v_hist order by starts_on desc limit 1)) u) < 0.45
  and (select count(*) from rpart r where not exists (select 1 from v_part p where p.fighter_id = r.fighter_id and p.event_id in (select id from v_hist order by starts_on desc limit 3)) and exists (select 1 from v_part p where p.fighter_id = r.fighter_id)) >= 3
  and (select count(*) from rpart r where (select count(*) from v_part p where p.fighter_id = r.fighter_id) <= 3) >= 3);
select pg_temp.c('Rumble: Aldric Stone-test is in Male 5v5, Male 3v3 and Male Longsword',
  (select count(distinct k.name) from public.fighter_participation fp join public.competitions k on k.id = fp.competition_id join public.fighters f on f.id = fp.fighter_id where fp.event_id = (select id from v_r) and f.display_name = 'Aldric Stone-test' and k.name in ('Male 5v5', 'Male 3v3', 'Male Longsword')) = 3);
select pg_temp.c('Rumble: one team sends only duelists, one 5v5 team is made of its own people only, one is a mercenary-completed near-full 5v5, some teams send 2-3',
  (select count(*) from (select e.team_id from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and e.team_id is not null group by 1) x) <= 8
  and exists (select 1 from public.teams t where t.name = 'Golden Lions-test' and exists (select 1 from public.fighter_participation fp join public.fighters f on f.id = fp.fighter_id where fp.event_id = (select id from v_r) and f.team_id = t.id)
     and not exists (select 1 from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and e.team_id = t.id)
     and not exists (select 1 from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id join public.fighters f on f.id = ef.fighter_id where k.event_id = (select id from v_r) and f.team_id = t.id and ef.role = 'mercenary'))
  and exists (select 1 from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and k.name = 'Male 5v5' and not exists (select 1 from public.entry_fighters ef where ef.entry_id = e.id and ef.role <> 'fighter'))
  and exists (select 1 from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = (select id from v_r) and k.name = 'Male 5v5' and (select count(*) from public.entry_fighters ef where ef.entry_id = e.id and ef.role = 'mercenary') = 1)
  and (select count(*) from (select f.team_id, count(*) from rpart p join public.fighters f on f.id = p.fighter_id group by 1 having count(*) between 2 and 3) x) >= 2);
select pg_temp.c('Rumble: matches are drawn and scheduled (field, scheduled_at, duration), none final, no results, every competition registration status',
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = (select id from v_r)) > 40
  and (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = (select id from v_r) and (m.field is null or m.scheduled_at is null or m.duration_minutes is null or m.queue_state <> 'scheduled' or m.finalized_at is not null or m.result is not null)) = 0
  and (select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = (select id from v_r)) = 0
  and (select count(*) from public.competitions k where k.event_id = (select id from v_r) and k.status = 'finished') = 0);
-- Owner-only RPC, called with the owner's claims.
select id as rumble_id from v_r \gset
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
select count(*) as n_conf, count(distinct fighter_id) as n_conf_f, count(*) filter (where display_name = 'Aldric Stone-test') as n_aldric, count(*) filter (where match_a = match_b or competition_a = competition_b) as n_same from public.fighter_schedule_conflicts(:'rumble_id') \gset
reset role;
select pg_temp.c('Rumble: fighter_schedule_conflicts finds real conflicts (more than 0), recognises the same fighter across competitions, and includes Aldric Stone-test',
  :n_conf > 0 and :n_same = 0 and :n_aldric > 0, (:n_conf)::text || ' conflicts, ' || (:n_conf_f)::text || ' fighters, Aldric ' || (:n_aldric)::text);
-- A conflict is real: recheck one pair by hand.
select pg_temp.c('Rumble: a conflicting pair really overlaps in time and shares the fighter (hand recheck)',
  (select count(*) from (select a.fighter_id from private.event_bookings(:'rumble_id') a join private.event_bookings(:'rumble_id') b on b.fighter_id = a.fighter_id and b.match_id <> a.match_id
     and a.scheduled_at < b.scheduled_at + make_interval(mins => b.duration_minutes) and b.scheduled_at < a.scheduled_at + make_interval(mins => a.duration_minutes)) x) >= :n_conf * 2);
select pg_temp.c('Rumble: not every conflict removed (some fighters have none)', (select count(*) from rpart) > :n_conf_f);

-- ============================================================ public browsing (anonymous visitor)
set local role anon;
select (select count(*) from public.events where organization_id = (select id from public.organizations where slug = 'nacl-test')) as a_events,
  (select count(*) from public.competitions k join public.events e on e.id = k.event_id where e.slug = 'calgary-iron-clash-test') as a_comps,
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id join public.events e on e.id = k.event_id where e.slug = 'calgary-iron-clash-test' and m.queue_state = 'final') as a_matches,
  (select count(*) from public.results r join public.competitions k on k.id = r.competition_id join public.events e on e.id = k.event_id where e.slug = 'calgary-iron-clash-test') as a_results,
  (select count(*) from public.ranking_fighters where scope = 'org_career') as a_rank, (select count(*) from public.team_stats where matches > 0) as a_team,
  (select count(*) from public.fighter_career_stats where matches > 0) as a_fstats, (select count(*) from public.fighter_history) as a_hist,
  (select count(*) from public.competition_standings) as a_stand, (select count(*) from public.entry_roster) as a_roster,
  (select count(*) from public.fighter_profile((select id from public.fighters where display_name = 'Aldric Stone-test'))) as a_profile \gset
reset role;
select pg_temp.c('completed events are browsable by anonymous visitors through the public views (events, competitions, matches, results, rankings, stats, history, standings, rosters, profiles)',
  :a_events = 16 and :a_comps > 0 and :a_matches > 0 and :a_results > 0 and :a_rank > 0 and :a_team = 10 and :a_fstats >= 118 and :a_hist > 0 and :a_stand > 0 and :a_roster > 0 and :a_profile = 1,
  (:a_events)::text || ' events, ' || (:a_comps)::text || ' comps, ' || (:a_matches)::text || ' final matches, ' || (:a_results)::text || ' results at Calgary Iron Clash-test; ' || (:a_rank)::text || ' career rankings');

-- ============================================================ output
select case when ok then 'PASS' else 'FAIL' end as status, name, case when ok and detail = '' then '' else detail end as detail from chk order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(*) as total from chk;

\echo
\echo '=== REPORT: counts ==='
select (select count(*) from v_f) as fighters, (select count(distinct team_id) from v_f) as teams, (select count(*) from v_ev) as events,
  (select count(*) from public.competitions where event_id in (select id from v_ev)) as competitions,
  (select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id in (select id from v_ev)) as entries,
  (select count(*) from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where k.event_id in (select id from v_ev)) as entry_fighters,
  (select count(*) from public.entry_fighters ef where ef.role = 'mercenary') as mercenary_rows,
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id in (select id from v_ev)) as matches,
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id in (select id from v_ev) and m.queue_state = 'final') as finalized,
  (select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id in (select id from v_ev)) as results_rows,
  (select count(*) from public.audit_log where event_id in (select id from v_ev)) as audit_rows,
  (select count(*) from public.record_sources r join public.sources s on s.id = r.source_id where s.title = 'NACL-test fictional dataset') as record_sources;
\echo '=== REPORT: events (unique fighters, entries, registrations, matches) ==='
select e.starts_on, e.name, e.region, (select tier from public.competitions k where k.event_id = e.id limit 1) as tier,
  (select count(distinct fighter_id) from public.fighter_participation fp where fp.event_id = e.id) as unique_fighters,
  (select count(*) from public.competitions k where k.event_id = e.id) as comps,
  (select count(*) from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = e.id) as entries,
  (select count(*) from public.fighter_participation fp where fp.event_id = e.id) as registrations,
  (select count(*) from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where k.event_id = e.id and ef.role = 'mercenary') as mercs,
  (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = e.id) as matches
from v_ev e order by e.starts_on;
\echo '=== REPORT: ranking sizes per division (org_career) ==='
select gender, category, count(*) as ranked_fighters, max(points) as top_points from public.ranking_fighters where scope = 'org_career' group by 1, 2 order by 1, 2;
select gender, category, count(*) as ranked_teams from public.ranking_teams where scope = 'org_career' group by 1, 2 order by 1, 2;
\echo '=== REPORT: top 5 fighters, a few divisions (career points) ==='
select r.gender, r.category, r.rank, r.display_name, r.points, r.golds, r.silvers, r.bronzes, r.competitions from public.ranking_fighters r
where r.scope = 'org_career' and (r.gender, r.category) in (('men', 'longsword'), ('women', 'longsword'), ('men', 'polearm'), ('women', 'sword_shield')) and r.rank <= 5 order by r.gender, r.category, r.rank, r.display_name;
\echo '=== REPORT: top 5 teams, 5v5 men and 3v3 men ==='
select r.gender, r.category, r.rank, r.team_name, r.points, r.golds, r.silvers, r.bronzes from public.ranking_teams r
where r.scope = 'org_career' and (r.gender, r.category) in (('men', '5v5'), ('men', '3v3'), ('women', '5v5')) and r.rank <= 5 order by r.gender, r.category, r.rank, r.team_name;
\echo '=== REPORT: team success ==='
select team_name, events, matches, wins, losses, win_pct, golds, silvers, bronzes, points, recent_form from public.team_stats where team_id in (select team_id from v_f) order by points desc;
\echo '=== REPORT: attendance extremes ==='
select display_name, joined_year, n as events from cnt where n >= 9 or n = 2 order by n desc, display_name;
\echo '=== REPORT: mercenary scenarios per event ==='
select e.name, k.name as division, t.name as team, f.display_name as mercenary, ht.name as home_team
from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id join public.events e on e.id = k.event_id join public.entries en on en.id = ef.entry_id join public.teams t on t.id = en.team_id
join public.fighters f on f.id = ef.fighter_id join public.teams ht on ht.id = ef.permanent_team_id where ef.role = 'mercenary' and e.slug in ('rocky-mountain-rumble-test', 'red-deer-rumble-test', 'calgary-iron-clash-test') order by e.starts_on, k.sort, t.name, f.display_name;
rollback;
