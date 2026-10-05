-- Team discipline rankings gate (migration 20261004000600).
-- A team's discipline total = the individual ranking points of the fighters who REPRESENTED it in that discipline, added up. Proves: the
-- simple sum (3 + 3 + 3 = 9), several teams and disciplines, season / organization / all-time scopes, divisions and the combined total without
-- double counting, ties, a transfer between seasons keeping history with the old team, no guessing for history without evidence, the
-- synthetic-organization rule, team (group fight) results never counted, a new discipline appearing from data, the same points as
-- ranking_fighters, and who may change a represented team (audited) and how merges carry it.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/team_discipline_rankings_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise exception 'FAIL (unexpected error %: %): %', sqlstate, sqlerrm, label; end;
  insert into t.log (name) values (label);
end $$;
create function t.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function t.id(p text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
-- "Team:points:rank" for one ranking partition, best first. p_gender null = all divisions together.
create function t.board(p_scope text, p_org text, p_season text, p_cat text, p_gender text) returns text language sql as $$
  select string_agg(team_name || ':' || points::numeric(10, 0) || ':' || rank, ',' order by rank, team_name) from public.ranking_team_disciplines
   where scope = p_scope and organization_id is not distinct from t.id(p_org) and season_id is not distinct from t.id(p_season)
     and category = p_cat and gender is not distinct from p_gender $$;
-- "Fighter:points" behind one team's total.
create function t.behind(p_scope text, p_org text, p_season text, p_cat text, p_gender text, p_team text) returns text language sql as $$
  select string_agg(display_name || ':' || points::numeric(10, 0), ',' order by points desc, display_name) from public.team_discipline_contributions
   where scope = p_scope and organization_id is not distinct from t.id(p_org) and season_id is not distinct from t.id(p_season)
     and category = p_cat and gender is not distinct from p_gender and team_id is not distinct from t.id(p_team) $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- Users: d1 platform owner, d2 organizer of E6 (the upcoming event) only, d5 stranger, d6 registers Nia for E6.
-- Organizations: f001 real (seasons f101 = 2025, f102 = 2026), f002 real (season f103), f003 FICTIONAL (season f104).
-- Teams: Ankle Biters f301, Red Deer Reavers f302, Northern Ravens f303, Mountain Bears f304.
-- Fighters: Bob f401 (Ankle Biters, later Red Deer Reavers), John f402, Joe f403, Ann f404 (Ankle Biters), Rex f405, Ray f406, Rita f407
-- (Red Deer Reavers), Mike f408 (Northern Ravens), Nia f409 (Northern Ravens).
select t.as_admin();
insert into auth.users (id, email) select t.uid(n), 'u' || n || '@example.test' from generate_series(1, 6) n;
insert into public.platform_roles (user_id, role) values (t.uid(1), 'owner');
insert into public.sources (id, kind, title, citation, synthetic) values (t.id('f0f0'), 'submitted', 'Fictional league', 'test', true);
insert into public.organizations (id, slug, name, kind) values
  (t.id('f001'), 'tdr-one', 'League One', 'regional'), (t.id('f002'), 'tdr-two', 'League Two', 'regional'), (t.id('f003'), 'tdr-fict', 'Fictional League', 'regional');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  (t.id('f101'), t.id('f001'), 'one-2025', 'One 2025', date '2025-01-01', date '2025-12-31'),
  (t.id('f102'), t.id('f001'), 'one-2026', 'One 2026', date '2026-01-01', current_date + 200),
  (t.id('f103'), t.id('f002'), 'two-2026', 'Two 2026', date '2026-01-01', current_date + 200),
  (t.id('f104'), t.id('f003'), 'fict-2026', 'Fict 2026', date '2026-01-01', current_date + 200);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, organization_id, season_id) values
  (t.id('f201'), 'tdr-e1', 'E1 2025', 'published', 'tournament', date '2025-06-07', date '2025-06-08', t.id('f001'), t.id('f101')),
  (t.id('f202'), 'tdr-e2', 'E2 2026', 'published', 'tournament', current_date - 30, current_date - 29, t.id('f001'), t.id('f102')),
  (t.id('f203'), 'tdr-e3', 'E3 other org', 'published', 'tournament', current_date - 30, current_date - 29, t.id('f002'), t.id('f103')),
  (t.id('f204'), 'tdr-e4', 'E4 fictional org', 'published', 'tournament', current_date - 30, current_date - 29, t.id('f003'), t.id('f104')),
  (t.id('f205'), 'tdr-e5', 'E5 fictional event, real org', 'published', 'tournament', current_date - 30, current_date - 29, t.id('f001'), t.id('f102')),
  (t.id('f206'), 'tdr-e6', 'E6 upcoming', 'published', 'tournament', current_date + 20, current_date + 21, t.id('f001'), t.id('f102'));
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values
  (t.id('f0f0'), 'organization', t.id('f003'), 'unverified', 'fictional'), (t.id('f0f0'), 'event', t.id('f204'), 'unverified', 'fictional'),
  (t.id('f0f0'), 'event', t.id('f205'), 'unverified', 'fictional');
insert into public.event_staff (event_id, user_id, role) values (t.id('f206'), t.uid(2), 'organizer');
insert into public.teams (id, slug, name, status) values
  (t.id('f301'), 'ankle-biters', 'Ankle Biters', 'approved'), (t.id('f302'), 'red-deer-reavers', 'Red Deer Reavers', 'approved'),
  (t.id('f303'), 'northern-ravens', 'Northern Ravens', 'approved'), (t.id('f304'), 'mountain-bears', 'Mountain Bears', 'approved');
insert into public.fighters (id, display_name, team_id) values
  (t.id('f401'), 'Bob', t.id('f301')), (t.id('f402'), 'John', t.id('f301')), (t.id('f403'), 'Joe', t.id('f301')), (t.id('f404'), 'Ann', t.id('f301')),
  (t.id('f405'), 'Rex', t.id('f302')), (t.id('f406'), 'Ray', t.id('f302')), (t.id('f407'), 'Rita', t.id('f302')),
  (t.id('f408'), 'Mike', t.id('f303')), (t.id('f409'), 'Nia', t.id('f303'));
-- A discipline no code knows about: it must show up from the data alone.
insert into public.ref_categories (code, league, name, sort, source) values ('dagger', 'duels', 'Dagger', 99, 'gate fixture');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  (t.id('f501'), t.id('f201'), 'E1 Longsword men', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('f502'), t.id('f201'), 'E1 Longsword women', 'longsword', 'women', 'Classic', 'round_robin'),
  (t.id('f503'), t.id('f201'), 'E1 Sword and shield men', 'sword_shield', 'men', 'Classic', 'round_robin'),
  (t.id('f504'), t.id('f201'), 'E1 5v5 men', '5v5', 'men', 'Classic', 'round_robin'),
  (t.id('f505'), t.id('f201'), 'E1 Dagger men', 'dagger', 'men', 'Classic', 'round_robin'),
  (t.id('f511'), t.id('f202'), 'E2 Longsword men', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('f521'), t.id('f203'), 'E3 Longsword men', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('f531'), t.id('f204'), 'E4 Longsword men', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('f541'), t.id('f205'), 'E5 Longsword men', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('f561'), t.id('f206'), 'E6 Longsword men', 'longsword', 'men', 'Classic', 'round_robin');

-- E1 (2025): Bob, John and Joe fight longsword for Ankle Biters. Entries for a past event carry the team explicitly (an import).
insert into public.entries (id, competition_id, fighter_id, represented_team_id) values
  (t.id('f601'), t.id('f501'), t.id('f401'), t.id('f301')), (t.id('f602'), t.id('f501'), t.id('f402'), t.id('f301')),
  (t.id('f603'), t.id('f501'), t.id('f403'), t.id('f301')), (t.id('f604'), t.id('f501'), t.id('f405'), t.id('f302')),
  (t.id('f605'), t.id('f501'), t.id('f406'), t.id('f302')),
  (t.id('f607'), t.id('f502'), t.id('f404'), t.id('f301')), (t.id('f608'), t.id('f502'), t.id('f407'), t.id('f302')),
  (t.id('f609'), t.id('f503'), t.id('f401'), t.id('f301')), (t.id('f60a'), t.id('f503'), t.id('f405'), t.id('f302')),
  (t.id('f60d'), t.id('f505'), t.id('f403'), t.id('f301')),
  (t.id('f611'), t.id('f511'), t.id('f401'), t.id('f302')),   -- 2026: Bob now represents Red Deer Reavers
  (t.id('f612'), t.id('f511'), t.id('f402'), t.id('f301')),
  (t.id('f621'), t.id('f521'), t.id('f402'), t.id('f301')),
  (t.id('f631'), t.id('f531'), t.id('f403'), t.id('f301')),
  (t.id('f641'), t.id('f541'), t.id('f403'), t.id('f301'));
-- Mike's E1 entry is written WITHOUT a team: the event is over and there is no registration, so nothing may be guessed.
insert into public.entries (id, competition_id, fighter_id) values (t.id('f606'), t.id('f501'), t.id('f408'));
-- Group fights: team entries with rosters. Their 50 / 30 points are team competition points, never discipline points.
insert into public.entries (id, competition_id, team_id) values (t.id('f60b'), t.id('f504'), t.id('f301')), (t.id('f60c'), t.id('f504'), t.id('f302'));
insert into public.entry_fighters (entry_id, competition_id, fighter_id) values
  (t.id('f60b'), t.id('f504'), t.id('f401')), (t.id('f60b'), t.id('f504'), t.id('f402')), (t.id('f60b'), t.id('f504'), t.id('f403')),
  (t.id('f60c'), t.id('f504'), t.id('f405')), (t.id('f60c'), t.id('f504'), t.id('f406'));
insert into public.results (competition_id, entry_id, final_place, points) values
  (t.id('f501'), t.id('f604'), 1, 7), (t.id('f501'), t.id('f605'), 2, 5), (t.id('f501'), t.id('f601'), 3, 3), (t.id('f501'), t.id('f602'), 4, 3),
  (t.id('f501'), t.id('f603'), 5, 3), (t.id('f501'), t.id('f606'), 6, 1),
  (t.id('f502'), t.id('f607'), 1, 4), (t.id('f502'), t.id('f608'), 2, 4),
  (t.id('f503'), t.id('f60a'), 1, 6), (t.id('f503'), t.id('f609'), 2, 2),
  (t.id('f504'), t.id('f60b'), 1, 50), (t.id('f504'), t.id('f60c'), 2, 30),
  (t.id('f505'), t.id('f60d'), 1, 1),
  (t.id('f511'), t.id('f611'), 1, 10), (t.id('f511'), t.id('f612'), 2, 2),
  (t.id('f521'), t.id('f621'), 1, 20),
  (t.id('f531'), t.id('f631'), 1, 30),
  (t.id('f541'), t.id('f641'), 1, 100);
-- The transfer: Bob's current team is now Red Deer Reavers. History must not move with him.
update public.fighters set team_id = t.id('f302') where id = t.id('f401');

-- ================================================================ 1. the simple sum, read by the public
select t.as_anon();
select t.expect_eq('Ankle Biters: Bob 3 + John 3 + Joe 3 = 9 longsword points (2025, men)',
  (select points::int from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('f101') and category = 'longsword' and gender = 'men' and team_id = t.id('f301')), 9);
select t.expect_eq('the 9 points are exactly Bob, John and Joe', t.behind('season', 'f001', 'f101', 'longsword', 'men', 'f301'), 'Bob:3,Joe:3,John:3');
select t.expect_eq('a team with 12 (Rex 7 + Ray 5) ranks ahead of Ankle Biters', t.board('season', 'f001', 'f101', 'longsword', 'men'), 'Red Deer Reavers:12:1,Ankle Biters:9:2');
select t.expect_eq('fighters are summed, not averaged or best-of: 3 fighters, 3 results', (select fighters || '/' || results from public.ranking_team_disciplines
   where scope = 'season' and season_id = t.id('f101') and category = 'longsword' and gender = 'men' and team_id = t.id('f301')), '3/3');

-- ================================================================ 2. several disciplines, each on its own, and a new one from the data
select t.expect_eq('sword and shield is ranked separately', t.board('season', 'f001', 'f101', 'sword_shield', 'men'), 'Red Deer Reavers:6:1,Ankle Biters:2:2');
select t.expect_eq('a discipline only the data knows (dagger) appears, named from ref_categories',
  (select string_agg(category_name || ':' || team_name || ':' || points::int, ',') from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('f101') and category = 'dagger' and gender = 'men'),
  'Dagger:Ankle Biters:1');
select t.expect_eq('the disciplines in 2025 are exactly the individual ones with results',
  (select string_agg(distinct category, ',' order by category) from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('f101')), 'dagger,longsword,sword_shield');

-- ================================================================ 3. team (group fight) results are never discipline points
select t.expect_eq('no 5v5 row in the discipline aggregate', (select count(*) from public.ranking_team_disciplines where category = '5v5'), 0::bigint);
select t.expect_eq('no 5v5 contribution either (rosters do not feed it)', (select count(*) from public.team_discipline_contributions where category = '5v5'), 0::bigint);
select t.expect_eq('the team competition ranking is untouched: Ankle Biters 50, Red Deer Reavers 30',
  (select string_agg(team_name || ':' || points::int, ',' order by rank) from public.ranking_teams where scope = 'season' and season_id = t.id('f101') and category = '5v5' and gender = 'men'),
  'Ankle Biters:50,Red Deer Reavers:30');
select t.expect_eq('fighters still get their 5v5 points in the fighter ranking (formula unchanged)',
  (select points::int from public.ranking_fighters where scope = 'season' and season_id = t.id('f101') and category = '5v5' and gender = 'men' and fighter_id = t.id('f401')), 50);

-- ================================================================ 4. divisions, the combined total and ties
select t.expect_eq('women''s longsword: Ankle Biters and Red Deer Reavers are tied at 4, both rank 1', t.board('season', 'f001', 'f101', 'longsword', 'women'), 'Ankle Biters:4:1,Red Deer Reavers:4:1');
select t.expect_eq('all divisions together: Red Deer Reavers 16 (12 + 4), Ankle Biters 13 (9 + 4)', t.board('season', 'f001', 'f101', 'longsword', null), 'Red Deer Reavers:16:1,Ankle Biters:13:2');
select t.expect_eq('the combined breakdown lists each fighter once', t.behind('season', 'f001', 'f101', 'longsword', null, 'f301'), 'Ann:4,Bob:3,Joe:3,John:3');
select t.expect_eq('no double counting: every combined row is exactly the sum of its divisions', (
  select count(*) from (
    select c.scope, c.organization_id, c.season_id, c.category, c.team_id, c.fighter_id, sum(c.points) filter (where c.gender is null) as combined,
           sum(c.points) filter (where c.gender is not null) as divisions, sum(c.results) filter (where c.gender is null) as rc, sum(c.results) filter (where c.gender is not null) as rd
    from public.team_discipline_contributions c group by 1, 2, 3, 4, 5, 6) x
  where combined is distinct from divisions or rc is distinct from rd), 0::bigint);

-- ================================================================ 5. the same points as the fighter ranking
-- For every individual discipline partition: credited team points + points with no recorded team = the fighter ranking's points.
select t.expect_eq('team discipline points (plus unattributed) equal ranking_fighters points, partition by partition', (
  with a as (select scope, coalesce(organization_id::text, '-') as o, coalesce(season_id::text, '-') as s, category, gender, sum(points) as p
             from public.team_discipline_contributions where gender is not null and scope in ('season', 'org_career') group by 1, 2, 3, 4, 5),
       f as (select r.scope, coalesce(r.organization_id::text, '-') as o, coalesce(r.season_id::text, '-') as s, r.category, r.gender, sum(r.points) as p from public.ranking_fighters r
             where r.scope in ('season', 'org_career') and r.category in (select category from a) group by 1, 2, 3, 4, 5)
  select count(*) from a full join f using (scope, o, s, category, gender) where a.p is distinct from f.p), 0::bigint);
select t.expect_eq('all time: credited + unattributed equals each fighter''s real individual points', (
  with a as (select fighter_id, sum(points) as p from public.team_discipline_contributions where scope = 'career' and gender is not null group by 1),
       f as (select fighter_id, sum(points) as p from public.fighter_results where entry_id in (select id from public.entries where fighter_id is not null) group by 1)
  select count(*) from a full join f using (fighter_id) where a.p is distinct from f.p), 0::bigint);

-- ================================================================ 6. no guessing: Mike's old result has no recorded team
select t.expect_eq('Mike''s 2025 entry (event over, no registration) has no team, although his team today is Northern Ravens',
  (select coalesce(represented_team_id::text, 'none') || '/' || coalesce(represented_team_basis, 'none') from public.entries where id = t.id('f606')), 'none/none');
select t.expect_eq('his point is visible as "no recorded team"', t.behind('season', 'f001', 'f101', 'longsword', 'men', null), 'Mike:1');
select t.expect_eq('Northern Ravens are credited nothing in 2025', (select count(*) from public.ranking_team_disciplines where team_id = t.id('f303')), 0::bigint);

-- ================================================================ 7. a transfer between seasons
select t.expect_eq('2026: Bob''s 10 go to Red Deer Reavers, John''s 2 to Ankle Biters', t.board('season', 'f001', 'f102', 'longsword', 'men'), 'Red Deer Reavers:10:1,Ankle Biters:2:2');
select t.expect_eq('2025 is unchanged after Bob moved: his 3 stay with Ankle Biters', t.behind('season', 'f001', 'f101', 'longsword', 'men', 'f301'), 'Bob:3,Joe:3,John:3');
select t.expect_eq('organization history: Bob appears under both teams, with the points earned for each',
  (select string_agg(tm.name || ':' || c.points::int, ',' order by tm.name) from public.team_discipline_contributions c join public.teams tm on tm.id = c.team_id
    where scope = 'org_career' and organization_id = t.id('f001') and category = 'longsword' and gender = 'men' and fighter_id = t.id('f401')),
  'Ankle Biters:3,Red Deer Reavers:10');
select t.expect_eq('organization history (League One, men): Red Deer Reavers 22 (7 + 5 + 10), Ankle Biters 11 (3 + 5 + 3)',
  t.board('org_career', 'f001', null, 'longsword', 'men'), 'Red Deer Reavers:22:1,Ankle Biters:11:2');

-- ================================================================ 8. organizations, the synthetic rule and all time
select t.expect_eq('season filtering: the 2026 board holds only 2026 results', (select sum(results)::int from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('f102') and gender is null), 2);
select t.expect_eq('organization filtering: League Two has only John''s 20', t.board('org_career', 'f002', null, 'longsword', 'men'), 'Ankle Biters:20:1');
select t.expect_eq('a fictional event in a real organization never counts (Joe''s 100)', (select count(*) from public.team_discipline_contributions where points >= 100), 0::bigint);
select t.expect_eq('the fictional organization ranks its own fictional results', t.board('org_career', 'f003', null, 'longsword', 'men'), 'Ankle Biters:30:1');
select t.expect_eq('all time, men''s longsword: real results only, every organization (Ankle Biters 11 + 20 = 31)', t.board('career', null, null, 'longsword', 'men'), 'Ankle Biters:31:1,Red Deer Reavers:22:2');
select t.expect_eq('all time, all divisions: Ankle Biters 35, Red Deer Reavers 26', t.board('career', null, null, 'longsword', null), 'Ankle Biters:35:1,Red Deer Reavers:26:2');

-- ================================================================ 9. how a new entry gets its team
select t.as_admin();
insert into public.waiver_versions (id, event_id, version, title, body) values (t.id('f701'), t.id('f206'), 1, 'Waiver', 'Waiver text for the gate.');
insert into public.registrations (event_id, user_id, fighter_id, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, team_id, status)
values (t.id('f206'), t.uid(6), t.id('f409'), 'Nia', 'female', 'HACSA', 'hacsa_member', t.id('f701'), 'Nia', t.id('f304'), 'accepted');
insert into public.entries (id, competition_id, fighter_id) values (t.id('f661'), t.id('f561'), t.id('f408')), (t.id('f662'), t.id('f561'), t.id('f409'));
select t.expect_eq('an upcoming event: the fighter''s team at entry time (Mike: Northern Ravens)',
  (select represented_team_name_at_event || '/' || represented_team_basis from public.entries where id = t.id('f661')), 'Northern Ravens/team_at_entry');
select t.expect_eq('the fighter''s registration for the event wins over the home team (Nia registered for Mountain Bears)',
  (select represented_team_name_at_event || '/' || represented_team_basis from public.entries where id = t.id('f662')), 'Mountain Bears/registration');
select t.expect_error('a team entry cannot carry a represented team',
  $$insert into public.entries (competition_id, team_id, represented_team_id) values ('00000000-0000-0000-0000-00000000f504', '00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-00000000f303')$$);
select t.expect_eq('a team entry inserted without one gets none',
  (select count(*) from public.entries where team_id is not null and (represented_team_id is not null or represented_team_basis is not null)), 0::bigint);

-- ================================================================ 10. changing it: only through set_represented_team, audited
select t.expect_error('even the database owner cannot rewrite it with a plain update',
  $$update public.entries set represented_team_id = '00000000-0000-0000-0000-00000000f302' where id = '00000000-0000-0000-0000-00000000f601'$$, '42501');
select t.as_anon();
select t.expect_error('the public cannot call it', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f661', null, 'reason')$$, '42501');
select t.as_user(t.uid(5));
select t.expect_error('a stranger cannot change it', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f661', null, 'reason')$$, '42501');
select t.as_user(t.uid(2));
select t.expect_error('an organizer of another event cannot change E1 history', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-00000000f302', 'reason')$$, '42501');
select t.expect_error('a reason is required', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f661', '00000000-0000-0000-0000-00000000f304', ' ')$$, '22023');
select t.expect_ok('the organizer of E6 corrects Mike to Mountain Bears', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f661', '00000000-0000-0000-0000-00000000f304', 'He fights for Mountain Bears this year')$$);
select t.as_admin();
select t.expect_eq('the correction is stored with its basis and the event-time name',
  (select represented_team_name_at_event || '/' || represented_team_basis from public.entries where id = t.id('f661')), 'Mountain Bears/correction');
select t.expect_eq('the correction is audited: who, from, to and why',
  (select (actor = t.uid(2))::text || '/' || (details ->> 'from') || '/' || (details ->> 'to') || '/' || (details ->> 'reason') from public.audit_log where action = 'entry.represented_team_changed' and subject = t.id('f661')::text),
  'true/' || t.id('f303') || '/' || t.id('f304') || '/He fights for Mountain Bears this year');
select t.as_user(t.uid(1));
select t.expect_error('a team entry is refused (even for the owner)', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f60b', '00000000-0000-0000-0000-00000000f304', 'reason')$$, '22023');
select t.expect_ok('the platform owner records that Mike''s 2025 point was for Northern Ravens', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f606', '00000000-0000-0000-0000-00000000f303', 'Confirmed from the 2025 entry list')$$);
select t.as_anon();
select t.expect_eq('the corrected history now credits Northern Ravens', t.board('season', 'f001', 'f101', 'longsword', 'men'), 'Red Deer Reavers:12:1,Ankle Biters:9:2,Northern Ravens:1:3');
select t.expect_eq('and nothing is left without a team in 2025', (select count(*) from public.team_discipline_contributions where season_id = t.id('f101') and team_id is null), 0::bigint);

-- ================================================================ 11. a merge carries represented teams to the kept team
select t.as_user(t.uid(1));
select t.expect_ok('merge Mountain Bears into Northern Ravens', $$select public.merge_teams('00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-00000000f304')$$);
select t.as_admin();
select t.expect_eq('Nia and Mike now count for Northern Ravens; the event-time name and basis are kept',
  (select string_agg(coalesce(represented_team_id = t.id('f303'), false)::text || '/' || represented_team_name_at_event || '/' || represented_team_basis, ',' order by id) from public.entries where id in (t.id('f661'), t.id('f662'))),
  'true/Mountain Bears/correction,true/Mountain Bears/registration');

-- ================================================================ 12. the API can still embed a team's name on entries (20261004000700)
-- PostgREST refuses `entries -> teams(name)` when two foreign keys link the tables, so represented_team_id has no foreign key; its rules are triggers.
select t.as_admin();
select t.expect_eq('exactly one foreign key from entries to teams (team_id), so teams(name) embeds are not ambiguous',
  (select string_agg(conname, ',') from pg_constraint where conrelid = 'public.entries'::regclass and confrelid = 'public.teams'::regclass and contype = 'f'), 'entries_team_id_fkey');
select t.expect_error('a represented team that does not exist is refused on insert',
  $$insert into public.entries (competition_id, fighter_id, represented_team_id) values ('00000000-0000-0000-0000-00000000f505', '00000000-0000-0000-0000-00000000f404', '00000000-0000-0000-0000-00000000ffff')$$, '23503');
select t.as_user(t.uid(1));
select t.expect_error('set_represented_team refuses a team that does not exist', $$select public.set_represented_team('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-00000000ffff', 'reason')$$, 'P0002');
select t.as_admin();
select t.expect_error('a team that is still someone''s represented team cannot be deleted',
  $$delete from public.teams where id = '00000000-0000-0000-0000-00000000f301'$$, '23503');
select t.expect_ok('a team nobody represented can still be deleted',
  $$insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-00000000f3ff', 'spare-team', 'Spare', 'approved'); delete from public.teams where id = '00000000-0000-0000-0000-00000000f3ff'$$);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
