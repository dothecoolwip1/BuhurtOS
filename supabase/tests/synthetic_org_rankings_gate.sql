-- Synthetic organization rankings gate (migration 20261004000400).
-- A fictional organization ranks its own fictional results in its organization scopes ('season', 'org_career', 'org_all'); the global
-- 'career' scope and every real organization stay real-data only. Fighters and teams behave the same; the public columns are unchanged.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/synthetic_org_rankings_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- Org d001 is REAL but its slug ends in -test; org d002 is FICTIONAL (tagged by a synthetic source) with a plain slug: only the flag decides.
--   E1 real event,      real org d001, season d101: Alpha (fighter Ann)  1st 10 pts
--   E2 fictional event, real org d001, season d101: Bravo (fighter Ben)  1st 50 pts   -> must not reach d001 or career
--   E3 fictional event, fict. org d002, season d102: Charlie (Cal) 1st 30, Delta (Dee) 2nd 20 -> ranks inside d002 only
--   E4 fictional event, no organization, no season: Charlie (Cal) 1st 40 pts             -> ranks nowhere
--   E5 real event,      fict. org d002, season d102: Echo (Eve)      1st 5 pts            -> a real result counts everywhere it belongs
select t.as_admin();
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000d0001', 'submitted', 'Fictional league', 'test', true);
insert into public.organizations (id, slug, name, kind) values
  ('00000000-0000-0000-0000-00000000d001', 'real-league-test', 'Real League', 'regional'),
  ('00000000-0000-0000-0000-00000000d002', 'plain-league', 'Fictional League', 'regional');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d001', 'real-2026', 'Real 2026', current_date - 200, current_date + 100),
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-00000000d002', 'fict-2026', 'Fictional 2026', current_date - 200, current_date + 100);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000d201', 'e1', 'Real event, real org', 'published', 'tournament', current_date - 40, current_date - 39, '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d101'),
  ('00000000-0000-0000-0000-00000000d202', 'e2', 'Fictional event, real org', 'published', 'tournament', current_date - 40, current_date - 39, '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d101'),
  ('00000000-0000-0000-0000-00000000d203', 'e3', 'Fictional event, fictional org', 'published', 'tournament', current_date - 40, current_date - 39, '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d102'),
  ('00000000-0000-0000-0000-00000000d204', 'e4', 'Fictional event, no org', 'published', 'tournament', current_date - 40, current_date - 39, null, null),
  ('00000000-0000-0000-0000-00000000d205', 'e5', 'Real event, fictional org', 'published', 'tournament', current_date - 40, current_date - 39, '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d102');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values
  ('00000000-0000-0000-0000-0000000d0001', 'organization', '00000000-0000-0000-0000-00000000d002', 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-0000000d0001', 'event', '00000000-0000-0000-0000-00000000d202', 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-0000000d0001', 'event', '00000000-0000-0000-0000-00000000d203', 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-0000000d0001', 'event', '00000000-0000-0000-0000-00000000d204', 'unverified', 'fictional');
insert into public.teams (id, slug, name, status) values
  ('00000000-0000-0000-0000-00000000d301', 'alpha', 'Alpha', 'approved'), ('00000000-0000-0000-0000-00000000d302', 'bravo', 'Bravo', 'approved'),
  ('00000000-0000-0000-0000-00000000d303', 'charlie', 'Charlie', 'approved'), ('00000000-0000-0000-0000-00000000d304', 'delta', 'Delta', 'approved'),
  ('00000000-0000-0000-0000-00000000d305', 'echo', 'Echo', 'approved');
insert into public.fighters (id, display_name) values
  ('00000000-0000-0000-0000-00000000d401', 'Ann'), ('00000000-0000-0000-0000-00000000d402', 'Ben'), ('00000000-0000-0000-0000-00000000d403', 'Cal'),
  ('00000000-0000-0000-0000-00000000d404', 'Dee'), ('00000000-0000-0000-0000-00000000d405', 'Eve');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000d201', 'E1 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-00000000d202', 'E2 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d203', 'E3 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000d504', '00000000-0000-0000-0000-00000000d204', 'E4 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-00000000d205', 'E5 5v5', '5v5', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, team_id) values
  ('00000000-0000-0000-0000-00000000d601', '00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000d301'),
  ('00000000-0000-0000-0000-00000000d602', '00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-00000000d302'),
  ('00000000-0000-0000-0000-00000000d603', '00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d303'),
  ('00000000-0000-0000-0000-00000000d604', '00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d304'),
  ('00000000-0000-0000-0000-00000000d605', '00000000-0000-0000-0000-00000000d504', '00000000-0000-0000-0000-00000000d303'),
  ('00000000-0000-0000-0000-00000000d606', '00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-00000000d305');
insert into public.entry_fighters (entry_id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000d601', '00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000d401'),
  ('00000000-0000-0000-0000-00000000d602', '00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-00000000d402'),
  ('00000000-0000-0000-0000-00000000d603', '00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d403'),
  ('00000000-0000-0000-0000-00000000d604', '00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d404'),
  ('00000000-0000-0000-0000-00000000d605', '00000000-0000-0000-0000-00000000d504', '00000000-0000-0000-0000-00000000d403'),
  ('00000000-0000-0000-0000-00000000d606', '00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-00000000d405');
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000d601', 1, 10),
  ('00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-00000000d602', 1, 50),
  ('00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d603', 1, 30),
  ('00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d604', 2, 20),
  ('00000000-0000-0000-0000-00000000d504', '00000000-0000-0000-0000-00000000d605', 1, 40),
  ('00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-00000000d606', 1, 5);

-- Both views are checked with the same assertions: teams by team id (d30x), fighters by fighter id (d40x).
create function t.team_rows(p_scope text, p_org uuid, p_subject uuid) returns bigint language sql as $$
  select count(*) from public.ranking_teams where scope = p_scope and organization_id is not distinct from p_org and team_id = p_subject $$;
create function t.fighter_rows(p_scope text, p_org uuid, p_subject uuid) returns bigint language sql as $$
  select count(*) from public.ranking_fighters where scope = p_scope and organization_id is not distinct from p_org and fighter_id = p_subject $$;
grant execute on all functions in schema t to anon, authenticated;

select t.as_anon();
select t.expect_eq('the fixtures: d002 is fictional by its source, d001 is real whatever its slug says',
  (select array[private.is_synthetic('organization', '00000000-0000-0000-0000-00000000d002'), private.is_synthetic('organization', '00000000-0000-0000-0000-00000000d001')]), array[true, false]);

-- ================================================================ 1. a fictional organization ranks its own fictional results
select t.expect_eq('team: fictional org season ranking has Charlie 1st (30) then Delta 2nd (20), Echo (real, 5) 3rd',
  (select string_agg(team_name || ':' || points::int || ':' || rank, ',' order by rank, team_name) from public.ranking_teams
   where scope = 'season' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id = '00000000-0000-0000-0000-00000000d102' and category = '5v5' and gender = 'men'),
  'Charlie:30:1,Delta:20:2,Echo:5:3');
select t.expect_eq('fighter: fictional org season ranking has Cal 1st (30) then Dee 2nd (20), Eve (real, 5) 3rd',
  (select string_agg(display_name || ':' || points::int || ':' || rank, ',' order by rank, display_name) from public.ranking_fighters
   where scope = 'season' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id = '00000000-0000-0000-0000-00000000d102' and category = '5v5' and gender = 'men'),
  'Cal:30:1,Dee:20:2,Eve:5:3');
select t.expect_eq('team: fictional org org_career ranking', (select string_agg(team_name || ':' || points::int, ',' order by rank, team_name) from public.ranking_teams
   where scope = 'org_career' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id is null and category = '5v5' and gender = 'men'), 'Charlie:30,Delta:20,Echo:5');
select t.expect_eq('fighter: fictional org org_career ranking', (select string_agg(display_name || ':' || points::int, ',' order by rank, display_name) from public.ranking_fighters
   where scope = 'org_career' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id is null and category = '5v5' and gender = 'men'), 'Cal:30,Dee:20,Eve:5');
select t.expect_eq('team: fictional org org_all ranking', (select string_agg(team_name || ':' || points::int || ':' || golds || ':' || silvers, ',' order by rank, team_name) from public.ranking_teams
   where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id is null and category is null and gender is null), 'Charlie:30:1:0,Delta:20:0:1,Echo:5:1:0');
select t.expect_eq('fighter: fictional org org_all ranking', (select string_agg(display_name || ':' || points::int || ':' || golds || ':' || silvers, ',' order by rank, display_name) from public.ranking_fighters
   where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id is null and category is null and gender is null), 'Cal:30:1:0,Dee:20:0:1,Eve:5:1:0');

-- ================================================================ 2. the same fictional results never reach the global career ranking
select t.expect_eq('team: Charlie (fictional only) is not in the career ranking', t.team_rows('career', null, '00000000-0000-0000-0000-00000000d303'), 0::bigint);
select t.expect_eq('team: Delta (fictional only) is not in the career ranking', t.team_rows('career', null, '00000000-0000-0000-0000-00000000d304'), 0::bigint);
select t.expect_eq('fighter: Cal (fictional only) is not in the career ranking', t.fighter_rows('career', null, '00000000-0000-0000-0000-00000000d403'), 0::bigint);
select t.expect_eq('fighter: Dee (fictional only) is not in the career ranking', t.fighter_rows('career', null, '00000000-0000-0000-0000-00000000d404'), 0::bigint);
select t.expect_eq('team: a fictional event with no organization ranks nowhere (Charlie has only its 3 fictional-org rows)',
  (select count(*) from public.ranking_teams where team_id = '00000000-0000-0000-0000-00000000d303'), 3::bigint);
select t.expect_eq('fighter: a fictional event with no organization ranks nowhere (Cal has only 3 fictional-org rows)',
  (select count(*) from public.ranking_fighters where fighter_id = '00000000-0000-0000-0000-00000000d403'), 3::bigint);
select t.expect_eq('team: the 40 points of the no-organization fictional event are counted nowhere',
  (select coalesce(max(points), 0)::int from public.ranking_teams where team_id = '00000000-0000-0000-0000-00000000d303'), 30);

-- ================================================================ 3. a fictional event attached to a REAL organization stays out of it
select t.expect_eq('team: Bravo (fictional event in a real org) has no ranking rows at all', (select count(*) from public.ranking_teams where team_id = '00000000-0000-0000-0000-00000000d302'), 0::bigint);
select t.expect_eq('fighter: Ben (fictional event in a real org) has no ranking rows at all', (select count(*) from public.ranking_fighters where fighter_id = '00000000-0000-0000-0000-00000000d402'), 0::bigint);
select t.expect_eq('team: the real org season ranking holds only the real result', (select string_agg(team_name || ':' || points::int, ',') from public.ranking_teams
   where scope = 'season' and organization_id = '00000000-0000-0000-0000-00000000d001'), 'Alpha:10');
select t.expect_eq('fighter: the real org season ranking holds only the real result', (select string_agg(display_name || ':' || points::int, ',') from public.ranking_fighters
   where scope = 'season' and organization_id = '00000000-0000-0000-0000-00000000d001'), 'Ann:10');
select t.expect_eq('team: the real org org_career / org_all rankings hold only the real result', (select string_agg(scope || ':' || team_name, ',' order by scope) from public.ranking_teams
   where scope in ('org_career', 'org_all') and organization_id = '00000000-0000-0000-0000-00000000d001'), 'org_all:Alpha,org_career:Alpha');
select t.expect_eq('fighter: the real org org_career / org_all rankings hold only the real result', (select string_agg(scope || ':' || display_name, ',' order by scope) from public.ranking_fighters
   where scope in ('org_career', 'org_all') and organization_id = '00000000-0000-0000-0000-00000000d001'), 'org_all:Ann,org_career:Ann');

-- ================================================================ 4. real results rank normally
select t.expect_eq('team: Alpha (real event, real org) has season, org_career, org_all and career rows',
  (select string_agg(scope, ',' order by scope) from public.ranking_teams where team_id = '00000000-0000-0000-0000-00000000d301'), 'career,org_all,org_career,season');
select t.expect_eq('fighter: Ann (real event, real org) has season, org_career, org_all and career rows',
  (select string_agg(scope, ',' order by scope) from public.ranking_fighters where fighter_id = '00000000-0000-0000-0000-00000000d401'), 'career,org_all,org_career,season');
select t.expect_eq('team: a real event inside a fictional org still counts in the career ranking', t.team_rows('career', null, '00000000-0000-0000-0000-00000000d305'), 1::bigint);
select t.expect_eq('fighter: a real event inside a fictional org still counts in the career ranking', t.fighter_rows('career', null, '00000000-0000-0000-0000-00000000d405'), 1::bigint);
select t.expect_eq('team: the career ranking holds exactly the two real results', (select string_agg(team_name || ':' || points::int || ':' || rank, ',' order by rank)
   from public.ranking_teams where scope = 'career' and team_id::text like '00000000-0000-0000-0000-00000000d3%'), 'Alpha:10:1,Echo:5:2');
select t.expect_eq('fighter: the career ranking holds exactly the two real results', (select string_agg(display_name || ':' || points::int || ':' || rank, ',' order by rank)
   from public.ranking_fighters where scope = 'career' and fighter_id::text like '00000000-0000-0000-0000-00000000d4%'), 'Ann:10:1,Eve:5:2');

-- ================================================================ 5. fighter and team rankings agree row for row
select t.expect_eq('fighter and team rankings have the same (scope, org, season, category, gender, points, rank) rows',
  (select count(*) from (
     (select scope, organization_id, season_id, category, gender, points, rank, golds, silvers, bronzes, competitions from public.ranking_teams where team_id::text like '00000000-0000-0000-0000-00000000d3%'
      except all
      select scope, organization_id, season_id, category, gender, points, rank, golds, silvers, bronzes, competitions from public.ranking_fighters where fighter_id::text like '00000000-0000-0000-0000-00000000d4%')
     union all
     (select scope, organization_id, season_id, category, gender, points, rank, golds, silvers, bronzes, competitions from public.ranking_fighters where fighter_id::text like '00000000-0000-0000-0000-00000000d4%'
      except all
      select scope, organization_id, season_id, category, gender, points, rank, golds, silvers, bronzes, competitions from public.ranking_teams where team_id::text like '00000000-0000-0000-0000-00000000d3%')) x),
  0::bigint);

-- ================================================================ 6. the public contract is unchanged
select t.expect_eq('ranking_fighters columns and types are unchanged',
  (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'ranking_fighters'),
  'scope text, organization_id uuid, season_id uuid, category text, gender text, fighter_id uuid, display_name text, competitions bigint, golds bigint, silvers bigint, bronzes bigint, points numeric, rank bigint');
select t.expect_eq('ranking_teams columns and types are unchanged',
  (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'ranking_teams'),
  'scope text, organization_id uuid, season_id uuid, category text, gender text, team_id uuid, team_name text, team_slug text, competitions bigint, golds bigint, silvers bigint, bronzes bigint, points numeric, rank bigint');
select t.expect_eq('both views stay security_invoker',
  (select count(*) from pg_class where relname in ('ranking_fighters', 'ranking_teams') and relnamespace = 'public'::regnamespace and 'security_invoker=true' = any (reloptions)), 2::bigint);
select t.expect_eq('anon and authenticated can still read both views',
  (select bool_and(has_table_privilege(r, v, 'select')) from unnest(array['anon', 'authenticated']) r, unnest(array['public.ranking_fighters', 'public.ranking_teams']) v), true);
-- The exact filter the frontend applies (applyRankingFilter: scope + eq/is for organization, season, category, gender), ordered by rank.
select t.expect_eq('the frontend season filter (eq scope/org/season/category/gender) returns the fictional league table',
  (select count(*) from public.ranking_teams where scope = 'season' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id = '00000000-0000-0000-0000-00000000d102'
     and category = '5v5' and gender = 'men'), 3::bigint);
select t.expect_eq('the frontend org_all filter (is null season/category/gender) returns the fictional league table',
  (select count(*) from public.ranking_fighters where scope = 'org_all' and organization_id = '00000000-0000-0000-0000-00000000d002' and season_id is null and category is null and gender is null), 3::bigint);

-- ================================================================ 7. the general fictional-data protection is untouched
select t.expect_eq('result_rows still leaves every fictional event out', (select count(*) from public.result_rows where event_id in
  ('00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-00000000d204')), 0::bigint);
select t.expect_eq('fighter_results still leaves fictional events out', (select count(*) from public.fighter_results where fighter_id = '00000000-0000-0000-0000-00000000d403'), 0::bigint);
select t.expect_eq('team_stats still count no fictional golds or points', (select golds::int || ':' || points::int from public.team_stats where team_id = '00000000-0000-0000-0000-00000000d303'), '0:0');
select t.expect_eq('fighter_career_stats still count no fictional points', (select points::int from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-00000000d403'), 0);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
