-- Pack 10 gate: fighter and team career profiles, statistics, records and history (migration 20261005000200).
-- Proves, on the fixture in scripts/e2e/fixtures/pack10.sql and mostly AS THE PUBLIC (anon) ROLE:
--   every career number is the sum of official match and placing evidence (nothing inferred from a placing); discipline lines add up to the totals;
--   season and organization partitions; a walkover is a win, a draw is a draw, a disqualified entrant keeps the fights they fought and is placed last;
--   an archived event changes nothing; an excluded event contributes to no row and restoring it restores it once; a fictional event never reaches an
--   official row and a fictional fighter's page has its own test context; the team represented at the event is kept after a transfer (the fighter's
--   team today changes nothing); head-to-head counts direct meetings only (never team fights, never placings); the team record counts the team's own
--   fights only; team head-to-head; fighters represented from the records (hidden and inactive included, with their state); hide / inactive change
--   the public roster only; discipline contributors add up to the team total; a draft event is invisible to the public; no private column anywhere.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run from the repository root:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack10_gate.sql
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

\ir ../../scripts/e2e/fixtures/pack10.sql

create function t.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000a' || n)::uuid $$;
-- the official career total row of one fighter, as one text (equal text = equal statistics)
create function t.bob() returns uuid language sql immutable as $$ select pg_temp.p10f(1) $$;
create function t.kg() returns uuid language sql immutable as $$ select pg_temp.p10t(1) $$;
create function t.career_text(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(kind, '-') || ':' || coalesce(category, '-') || ':' || events || ':' || competitions || ':' || matches || ':' || wins || ':' || losses || ':' || draws
    || ':' || golds || ':' || silvers || ':' || bronzes || ':' || points, ',' order by kind nulls first, category nulls first), '-')
  from public.fighter_career(p) where context = 'official' and scope = 'career' $$;
create function t.team_text(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(coalesce(category, '-') || ':' || events || ':' || competitions || ':' || matches || ':' || wins || ':' || losses || ':' || draws
    || ':' || golds || ':' || silvers || ':' || bronzes || ':' || points, ',' order by category nulls first), '-')
  from public.team_career(p) where context = 'official' and scope = 'career' $$;
create function t.represented_text(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(display_name || ':' || active || ':' || individual_results || ':' || individual_fights || ':' || team_fights, ',' order by display_name), '-')
  from public.team_fighters_represented(p) where context = 'official' $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ================================================================ the public view of Bob's career
select t.as_anon();
select t.expect_eq('Bob: events (fights or placings at 3 official events; the upcoming entry and the draft event do not count)', (select events from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 3);
select t.expect_eq('Bob: competitions with an official placing', (select competitions from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 8);
select t.expect_eq('Bob: matches = every final fight he was in (duels and team fights)', (select matches from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 18);
select t.expect_eq('Bob: wins / losses / draws from match results only', (select wins || '-' || losses || '-' || draws from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), '15-2-1');
select t.expect_eq('Bob: win percentage = wins / matches (draws are matches)', (select win_pct from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 83.3::numeric);
select t.expect_eq('Bob: gold / silver / bronze from placings (a team gold counts for its roster)', (select golds || '-' || silvers || '-' || bronzes from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), '5-3-0');
select t.expect_eq('Bob: podiums', (select podiums from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 8);
select t.expect_eq('Bob: best place', (select best_place from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 1);
select t.expect_eq('Bob: the record spans the first and last official event', (select first_on || '/' || last_on from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), '2025-09-14/2026-07-19');
select t.expect_eq('Bob: career points = the sum of his official placings'' league points (the existing authoritative value)',
  (select points from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null),
  (select sum(points) from public.fighter_results where fighter_id = t.bob()));
select t.expect_eq('Bob: career points equal the existing career ranking scope', (select points from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null),
  (select points from public.ranking_fighters where scope = 'career' and fighter_id = t.bob()));
select t.expect_eq('Bob: the existing career statistics view agrees on matches, wins, losses, draws and medals',
  (select matches || ':' || wins || ':' || losses || ':' || draws || ':' || golds || ':' || silvers || ':' || bronzes from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null),
  (select matches || ':' || wins || ':' || losses || ':' || draws || ':' || golds || ':' || silvers || ':' || bronzes from public.fighter_career_stats where fighter_id = t.bob()));
select t.expect_eq('Bob: official fight rows = the existing match rows view', (select count(*) from public.career_fights where fighter_id = t.bob()), (select count(*) from public.fighter_match_rows where fighter_id = t.bob()));
select t.expect_eq('Bob: official placing rows = the existing results view', (select count(*) from public.career_results where fighter_id = t.bob()), (select count(*) from public.fighter_results where fighter_id = t.bob()));

-- discipline lines
select t.expect_eq('Bob: discipline lines add up to the matches total', (select sum(matches) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is not null), 18::bigint);
select t.expect_eq('Bob: discipline lines add up to wins, losses and draws', (select sum(wins) || '-' || sum(losses) || '-' || sum(draws) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is not null), '15-2-1');
select t.expect_eq('Bob: discipline lines add up to the medals and competitions', (select sum(golds) || '-' || sum(silvers) || '-' || sum(bronzes) || '/' || sum(competitions) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is not null), '5-3-0/8');
select t.expect_eq('Bob: discipline lines add up to the points', (select sum(points) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is not null), (select points from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null));
select t.expect_eq('Bob: longsword line (two competitions, a gold and a silver)', (select matches || ':' || wins || '-' || losses || '-' || draws || ':' || competitions || ':' || golds || '-' || silvers || '-' || bronzes from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind = 'individual' and category = 'longsword'), '5:4-1-0:2:1-1-0');
select t.expect_eq('Bob: polearm line', (select matches || ':' || wins || '-' || losses || '-' || draws || ':' || golds || '-' || silvers from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind = 'individual' and category = 'polearm'), '6:5-1-0:1-1');
select t.expect_eq('Bob: sword and shield line carries the draw', (select matches || ':' || wins || '-' || losses || '-' || draws || ':' || silvers from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind = 'individual' and category = 'sword_shield'), '2:1-0-1:1');
select t.expect_eq('Bob: team fights are their own lines (5v5 from two rosters he was really on, 3v3)', (select string_agg(category || ':' || matches || ':' || wins || ':' || golds, ',' order by category) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind = 'team'), '3v3:1:1:1,5v5:4:4:2');
select t.expect_eq('Bob: category names come from the reference data', (select category_name from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind = 'individual' and category = 'sword_shield'), 'Sword & Shield');
select t.expect_eq('Bob: the division is carried on every line', (select count(distinct gender) from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is not null), 1::bigint);

-- seasons and organizations
select t.expect_eq('Bob: season 2025 (Autumn Clash only)', (select events || ':' || competitions || ':' || matches || ':' || wins || '-' || losses || '-' || draws || ':' || golds || '-' || silvers from public.fighter_career(t.bob()) where context = 'official' and scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a125' and kind is null), '1:3:8:7-1-0:2-1');
select t.expect_eq('Bob: season 2026 (Winter Melee and Summer Duels; the excluded Spring Open is not in it)', (select events || ':' || competitions || ':' || matches || ':' || wins || '-' || losses || '-' || draws || ':' || golds || '-' || silvers from public.fighter_career(t.bob()) where context = 'official' and scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a126' and kind is null), '2:5:10:8-1-1:3-2');
select t.expect_eq('Bob: the seasons add up to the career', (select sum(matches) || ':' || sum(golds) from public.fighter_career(t.bob()) where context = 'official' and scope = 'season' and kind is null), '18:5');
select t.expect_eq('Bob: season discipline lines exist', (select count(*) from public.fighter_career(t.bob()) where context = 'official' and scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a126' and kind is not null), 5::bigint);
select t.expect_eq('Bob: the organization partition (everything is Parkland League) equals the career', (select events || ':' || matches || ':' || golds || ':' || points from public.fighter_career(t.bob()) where context = 'official' and scope = 'organization' and organization_id = '00000000-0000-0000-0000-00000000a001' and kind is null),
  (select events || ':' || matches || ':' || golds || ':' || points from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null));
select t.expect_eq('Bob: no partition row for a missing season or organization', (select count(*) from public.fighter_career(t.bob()) where (scope = 'season' and season_id is null) or (scope = 'organization' and organization_id is null)), 0::bigint);

-- fights, outcomes, chronology
select t.expect_eq('Bob: the walkover is a win and says so', (select outcome || ':' || walkover from public.career_fights where fighter_id = t.bob() and opponent_name = 'Steve Wold' and event_slug = 'autumn-clash-2025'), 'win:true');
select t.expect_eq('Bob: the draw with John is a draw', (select outcome || ':' || score_for || '-' || score_against from public.career_fights where fighter_id = t.bob() and category = 'sword_shield' and opponent_name = 'John Quill'), 'draw:3-3');
select t.expect_eq('Bob: newest fight first is the Summer Duels final, lost to John', (select event_slug || ':' || stage || ':' || outcome || ':' || opponent_name from public.career_fights where fighter_id = t.bob() order by event_ends_on desc, finalized_at desc nulls last, match_id desc limit 1), 'summer-duels-2026:final:loss:John Quill');
select t.expect_eq('Bob: last five fights, newest first', (select string_agg(left(outcome, 1), '' order by event_ends_on desc, finalized_at desc nulls last, match_id desc) from (select * from public.career_fights where fighter_id = t.bob() order by event_ends_on desc, finalized_at desc nulls last, match_id desc limit 5) f), 'lwwww');
select t.expect_eq('Bob: a team fight row names the team he fought for and the opponent team', (select kind || ':' || team_name || ':' || opponent_name || ':' || roster_role from public.career_fights where fighter_id = t.bob() and event_slug = 'autumn-clash-2025' and category = '5v5' and opponent_name = 'Kestrel Guard'), 'team:Iron Ferns:Kestrel Guard:fighter');
select t.expect_eq('Bob: a duel names the opponent fighter', (select opponent_fighter_id from public.career_fights where fighter_id = t.bob() and match_id = pg_temp.p10m(1)), pg_temp.p10f(2));
select t.expect_eq('Steve: disqualified at Summer Duels keeps the fights he fought (6 fights, 2 wins) and is placed last with 0 points', (select matches || ':' || wins || '-' || losses from public.fighter_career(pg_temp.p10f(7)) where context = 'official' and scope = 'career' and kind = 'individual' and category = 'polearm') || '/' || (select final_place || ':' || points || ':' || entry_status from public.career_results where fighter_id = pg_temp.p10f(7) and event_slug = 'summer-duels-2026' and category = 'polearm'), '6:2-4/4:0.00:disqualified');
select t.expect_eq('Una: an unclaimed fighter has a full official record', (select matches || ':' || wins || '-' || losses || ':' || bronzes from public.fighter_career(pg_temp.p10f(5)) where context = 'official' and scope = 'career' and kind is null), '6:1-5:2');
select t.as_admin();
select t.expect_eq('Una: has no account at all', (select count(*) from public.fighter_accounts where fighter_id = pg_temp.p10f(5)), 0::bigint);
select t.as_anon();
select t.as_admin();
insert into public.fighters (id, display_name, disciplines) values (pg_temp.p10f(99), 'Newbie Nell', '{}');
select t.as_anon();
select t.expect_eq('a fighter with nothing recorded has no rows, not zeros to misread', (select count(*) from public.fighter_career(pg_temp.p10f(99))) + (select count(*) from public.fighter_head_to_head(pg_temp.p10f(99))), 0::bigint);

-- the team represented at the event, after a transfer
select t.expect_eq('Bob: the 2025 results were earned for Iron Ferns although his team today is Kestrel Guard', (select string_agg(distinct team_name, ',') from public.career_results where fighter_id = t.bob() and event_slug = 'autumn-clash-2025'), 'Iron Ferns');
select t.expect_eq('Bob: the 2026 results were earned for Kestrel Guard', (select string_agg(distinct team_name, ',') from public.career_results where fighter_id = t.bob() and event_slug in ('winter-melee-2026', 'summer-duels-2026')), 'Kestrel Guard');
select t.expect_eq('Bob: the 2025 fights say Iron Ferns too', (select string_agg(distinct coalesce(team_name, '-'), ',') from public.career_fights where fighter_id = t.bob() and event_slug = 'autumn-clash-2025'), 'Iron Ferns');
select t.expect_eq('Bob: his home team today is Kestrel Guard', (select team_name from public.fighter_profile(t.bob())), 'Kestrel Guard');
select t.as_admin();
create table t.before_transfer (event_slug text, competition_name text, team_name text);
grant all on t.before_transfer to anon, authenticated;
select t.as_anon();
insert into t.before_transfer select event_slug, competition_name, coalesce(team_name, '-') from public.career_results where fighter_id = t.bob() union all select event_slug, competition_name, coalesce(team_name, '-') from public.career_fights where fighter_id = t.bob();
select t.as_admin();
update public.fighters set team_id = pg_temp.p10t(3) where id = t.bob();   -- Bob moves to Mire Wolves today
select t.as_anon();
select t.expect_eq('Bob: moving to another team today rewrites no result or fight', (select count(*) from (select event_slug, competition_name, coalesce(team_name, '-') from public.career_results where fighter_id = t.bob() union all select event_slug, competition_name, coalesce(team_name, '-') from public.career_fights where fighter_id = t.bob() except all select * from t.before_transfer) d), 0::bigint);
select t.as_admin();
update public.fighters set team_id = t.kg() where id = t.bob();
select t.as_anon();

-- head to head
select t.expect_eq('Bob vs John: three direct meetings, one each and a draw', (select meetings || ':' || wins || '-' || losses || '-' || draws from public.fighter_head_to_head(t.bob()) where context = 'official' and opponent_fighter_id = pg_temp.p10f(2) and category is null), '3:1-1-1');
select t.expect_eq('Bob vs John: by discipline', (select string_agg(category || ':' || wins || '-' || losses || '-' || draws, ',' order by category) from public.fighter_head_to_head(t.bob()) where context = 'official' and opponent_fighter_id = pg_temp.p10f(2) and category is not null), 'longsword:1-1-0,sword_shield:0-0-1');
select t.expect_eq('Bob vs Steve: the walkover counts, the excluded event does not', (select meetings || ':' || wins from public.fighter_head_to_head(t.bob()) where context = 'official' and opponent_fighter_id = pg_temp.p10f(7) and category is null), '3:3');
select t.expect_eq('head to head never counts a team fight as a meeting of two fighters', (select count(*) from public.fighter_head_to_head(t.bob()) where opponent_fighter_id in (pg_temp.p10f(13), pg_temp.p10f(14), pg_temp.p10f(15))), 0::bigint);
select t.expect_eq('head to head never counts a placing (Mike placed below Bob twice but met him once)', (select meetings from public.fighter_head_to_head(t.bob()) where context = 'official' and opponent_fighter_id = pg_temp.p10f(3) and category is null), 1);
select t.expect_eq('head to head is symmetric', (select wins || '-' || losses || '-' || draws from public.fighter_head_to_head(pg_temp.p10f(2)) where context = 'official' and opponent_fighter_id = t.bob() and category is null), '1-1-1');
select t.expect_eq('head to head: most frequent opponents first, equal counts by name', (select string_agg(opponent_name || ':' || meetings, ',') from (select opponent_name, meetings from public.fighter_head_to_head(t.bob()) where context = 'official' and category is null limit 4) x), 'Joe Marsh:3,John Quill:3,Steve Wold:3,Una Unclaimed:2');

-- ================================================================ archive, exclude, restore (Pack 09D rules, proven on the new rows)
select t.as_admin();
create table t.snap (bob text, kg text, rep text, fights bigint, results bigint);
grant all on t.snap to anon, authenticated;
select t.as_anon();
insert into t.snap select t.career_text(t.bob()), t.team_text(t.kg()), t.represented_text(t.kg()),
  (select count(*) from public.career_fights where fighter_id = t.bob()), (select count(*) from public.career_results where fighter_id = t.bob());
select t.expect_eq('the archived Winter Melee is in the official totals (archive changes visibility, not statistics)', (select count(*) from public.career_results where fighter_id = t.bob() and event_slug = 'winter-melee-2026'), 2::bigint);
select t.as_user(t.uid(1));   -- the organizer's event role has expired (Pack 01); the owner archives
select public.unarchive_event(pg_temp.p10e(2));
select t.as_anon();
select t.expect_eq('unarchiving changes nothing in the career', t.career_text(t.bob()), (select bob from t.snap));
select t.as_user(t.uid(1));
select public.archive_event(pg_temp.p10e(2));
select t.as_anon();
select t.expect_eq('archiving again changes nothing in the career', t.career_text(t.bob()) || t.team_text(t.kg()), (select bob || kg from t.snap));
select t.expect_eq('the excluded Spring Open is still visible in the history, marked', (select count(*) || ':' || bool_and(stats_excluded) from public.career_results_all where fighter_id = t.bob() and event_slug = 'spring-open-2026'), '1:true');
select t.expect_eq('the excluded Spring Open is in no official row', (select count(*) from public.career_results where fighter_id = t.bob() and event_slug = 'spring-open-2026') + (select count(*) from public.career_fights where fighter_id = t.bob() and event_slug = 'spring-open-2026'), 0::bigint);
select t.as_user(t.uid(9));   -- the organization administrator restores it
select public.restore_event_stats(pg_temp.p10e(3), 'Pack 10 gate: counting it after all');
select t.as_anon();
select t.expect_eq('restoring the Spring Open adds its two fights and its gold exactly once', (select matches || ':' || wins || ':' || golds || ':' || competitions || ':' || events from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), '20:17:6:9:4');
select t.expect_eq('restoring the Spring Open adds Alex to the head to head', (select meetings from public.fighter_head_to_head(t.bob()) where context = 'official' and opponent_fighter_id = pg_temp.p10f(16) and category = 'longsword'), 1);
select t.as_user(t.uid(9));
select public.exclude_event_from_stats(pg_temp.p10e(3), 'Pack 10 gate: excluded again');
select t.as_anon();
select t.expect_eq('excluding it again returns exactly the baseline', t.career_text(t.bob()) || t.team_text(t.kg()) || t.represented_text(t.kg()), (select bob || kg || rep from t.snap));
select t.as_user(t.uid(9));
select public.exclude_event_from_stats(pg_temp.p10e(4), 'Pack 10 gate: a real event taken out');
select t.as_anon();
select t.expect_eq('excluding Summer Duels removes its 7 fights, 3 placings and 2 golds from Bob', (select matches || ':' || competitions || ':' || golds || ':' || silvers from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), '11:5:3:2');
select t.expect_eq('excluding Summer Duels removes the team''s two fights and its gold', (select matches || ':' || golds from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is null), '3:1');
select t.expect_eq('excluding Summer Duels removes it from the team head to head', (select meetings from public.team_head_to_head(t.kg()) where context = 'official' and opponent_team_id = pg_temp.p10t(2) and category is null), 1);
select t.as_user(t.uid(9));
select public.restore_event_stats(pg_temp.p10e(4), 'Pack 10 gate: back');
select t.as_anon();
select t.expect_eq('restoring Summer Duels returns exactly the baseline', t.career_text(t.bob()) || t.team_text(t.kg()) || t.represented_text(t.kg()), (select bob || kg || rep from t.snap));

-- ================================================================ fictional data
select t.expect_eq('the fictional Phantom Cup reaches no official row of Bob''s', (select count(*) from public.career_fights where fighter_id = t.bob() and synthetic) + (select count(*) from public.career_results where fighter_id = t.bob() and synthetic), 0::bigint);
select t.expect_eq('Bob''s fictional loss sits in the test context only', (select matches || ':' || losses || ':' || silvers from public.fighter_career(t.bob()) where context = 'test' and scope = 'career' and kind is null), '1:1:1');
select t.expect_eq('Phantom Pete has no official context at all', (select count(*) from public.fighter_career(pg_temp.p10f(8)) where context = 'official'), 0::bigint);
select t.expect_eq('Phantom Pete''s own page can show his fictional gold', (select matches || ':' || wins || ':' || golds from public.fighter_career(pg_temp.p10f(8)) where context = 'test' and scope = 'career' and kind is null), '1:1:1');
select t.expect_eq('the fictional fight is flagged in the history rows', (select bool_and(synthetic) from public.career_fights_all where fighter_id = pg_temp.p10f(8)), true);
select t.expect_eq('no fictional fighter in the all-time ranking', (select count(*) from public.ranking_fighters where scope = 'career' and fighter_id = pg_temp.p10f(8)), 0::bigint);
select t.expect_eq('fictional head to head stays in the test context', (select string_agg(context, ',') from public.fighter_head_to_head(pg_temp.p10f(8)) where category is null), 'test');

-- ================================================================ the team
select t.expect_eq('Kestrel Guard: team fights only (5 fights: 4 wins, 1 loss), 3 competitions, 3 events', (select events || ':' || competitions || ':' || matches || ':' || wins || '-' || losses || '-' || draws from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is null), '3:3:5:4-1-0');
select t.expect_eq('Kestrel Guard: medals from team placings only', (select golds || '-' || silvers || '-' || bronzes from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is null), '2-1-0');
select t.expect_eq('Kestrel Guard: the duels of its fighters are not in the team record', (select sum(matches) from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is not null), 5::bigint);
select t.expect_eq('Kestrel Guard: by category', (select string_agg(category || ':' || matches || ':' || wins || '-' || losses || ':' || golds || '-' || silvers, ',' order by category) from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is not null), '3v3:1:1-0:1-0,5v5:4:3-1:1-1');
select t.expect_eq('Kestrel Guard: team points equal the existing team ranking', (select points from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is null), (select points from public.ranking_teams where scope = 'career' and team_id = t.kg()));
select t.expect_eq('Kestrel Guard: the existing team statistics view agrees', (select matches || ':' || wins || ':' || losses || ':' || golds from public.team_career(t.kg()) where context = 'official' and scope = 'career' and category is null), (select matches || ':' || wins || ':' || losses || ':' || golds from public.team_stats where team_id = t.kg()));
select t.expect_eq('Kestrel Guard: season 2025 = the Autumn Clash 5v5 (silver)', (select matches || ':' || wins || '-' || losses || ':' || silvers from public.team_career(t.kg()) where context = 'official' and scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a125' and category is null), '2:1-1:1');
select t.expect_eq('Kestrel Guard: a team fight row carries the placing and the opponent', (select opponent_name || ':' || outcome || ':' || score_for || '-' || score_against || ':' || final_place from public.team_fights where team_id = t.kg() and event_slug = 'autumn-clash-2025' and opponent_team_id = pg_temp.p10t(2)), 'Iron Ferns:loss:1-3:2');
select t.expect_eq('Kestrel Guard: the historical roster of a team fight is the entry roster of that day (Hal and John, not today''s roster)', (select string_agg(display_name, ',' order by display_name) from public.entry_roster where entry_id = (select entry_id from public.team_fights where team_id = t.kg() and event_slug = 'autumn-clash-2025' limit 1)), 'Hal Holt,John Quill,Kes Four,Kes Three');
select t.expect_eq('Kestrel Guard vs Iron Ferns: two meetings, one each', (select meetings || ':' || wins || '-' || losses || '-' || draws from public.team_head_to_head(t.kg()) where context = 'official' and opponent_team_id = pg_temp.p10t(2) and category is null), '2:1-1-0');
select t.expect_eq('Kestrel Guard vs Mire Wolves: three meetings, by category', (select string_agg(category || ':' || wins || '-' || losses, ',' order by category) from public.team_head_to_head(t.kg()) where context = 'official' and opponent_team_id = pg_temp.p10t(3) and category is not null), '3v3:1-0,5v5:2-0');
select t.expect_eq('team head to head is never built from discipline totals (Bob''s duels against Joe do not make a Kestrel Guard vs Iron Ferns meeting)', (select sum(meetings) from public.team_head_to_head(t.kg()) where context = 'official' and category is null), 5::bigint);
select t.expect_eq('Kestrel Guard: fighters represented, from the records (hidden Hal and inactive Mike included, with their state)', t.represented_text(t.kg()),
  'Bob Brand:true:3:7:3,Hal Holt:true:0:0:2,John Quill:true:3:7:5,Kes Four:true:0:0:4,Kes Three:true:0:0:5,Mike Thorn:false:1:3:0');
select t.expect_eq('Kestrel Guard: a 2025 duel Bob fought for Iron Ferns is credited to Iron Ferns, not Kestrel Guard', (select individual_results || ':' || individual_fights from public.team_fighters_represented(pg_temp.p10t(2)) where context = 'official' and fighter_id = t.bob()), '2:6');
select t.expect_eq('Kestrel Guard: the current public roster leaves hidden Hal and inactive Mike out', (select string_agg(display_name, ',' order by display_name) from public.team_roster(t.kg())), 'Bob Brand,John Quill,Kes Four,Kes Three');
select t.expect_eq('Kestrel Guard: discipline contributors add up to the discipline total (longsword, career)',
  (select sum(points) from public.team_discipline_contributions where scope = 'career' and team_id = t.kg() and category = 'longsword' and gender is null),
  (select points from public.ranking_team_disciplines where scope = 'career' and team_id = t.kg() and category = 'longsword' and gender is null));
select t.expect_eq('Kestrel Guard: the longsword total is Bob''s, John''s and Mike''s points earned while representing it (Bob''s 2025 gold is Iron Ferns'')',
  (select points from public.ranking_team_disciplines where scope = 'career' and team_id = t.kg() and category = 'longsword' and gender is null),
  (select sum(points) from public.career_results where team_id = t.kg() and kind = 'individual' and category = 'longsword'));
select t.expect_eq('Iron Ferns: Bob''s 2025 longsword gold is in its total', (select points from public.ranking_team_disciplines where scope = 'career' and team_id = pg_temp.p10t(2) and category = 'longsword' and gender is null), (select sum(points) from public.career_results where team_id = pg_temp.p10t(2) and kind = 'individual' and category = 'longsword'));
select t.expect_eq('a team with nothing recorded has no rows', (select count(*) from public.team_career(pg_temp.p10t(4)) where context = 'official') + (select count(*) from public.team_head_to_head(pg_temp.p10t(4))), 0::bigint);

-- hide / inactive change the public roster only
select t.as_user(t.uid(6));
select public.set_roster_visibility(t.kg(), pg_temp.p10f(4), true);
select t.as_anon();
select t.expect_eq('showing Hal again puts him on the roster and changes no statistic', (select string_agg(display_name, ',' order by display_name) from public.team_roster(t.kg())) || '|' || (t.career_text(t.bob()) || t.team_text(t.kg()) || t.represented_text(t.kg()) = (select bob || kg || rep from t.snap)), 'Bob Brand,Hal Holt,John Quill,Kes Four,Kes Three|true');
select t.as_user(t.uid(6));
select public.set_roster_visibility(t.kg(), pg_temp.p10f(4), false);
select t.as_user(t.uid(1));
select public.set_fighter_active(pg_temp.p10f(3), true, 'back');
select t.as_anon();
select t.expect_eq('reactivating Mike changes his state in the represented list and nothing else', (select active from public.team_fighters_represented(t.kg()) where context = 'official' and fighter_id = pg_temp.p10f(3)) || ':' || (t.career_text(t.bob()) || t.team_text(t.kg()) = (select bob || kg from t.snap)), 'true:true');
select t.expect_eq('Mike: inactive or not, his bronze and his fights stay', (select matches || ':' || bronzes from public.fighter_career(pg_temp.p10f(3)) where context = 'official' and scope = 'career' and kind is null), '3:1');
select t.as_user(t.uid(1));
select public.set_fighter_active(pg_temp.p10f(3), false, 'break again');
select t.as_anon();
select t.expect_eq('Mike inactive: the record is identical', (select matches || ':' || bronzes || ':' || points from public.fighter_career(pg_temp.p10f(3)) where context = 'official' and scope = 'career' and kind is null), (select matches || ':' || bronzes || ':' || points from public.fighter_career_stats where fighter_id = pg_temp.p10f(3)));

-- ================================================================ who can see what
select t.expect_eq('the public never sees the draft event''s fight', (select count(*) from public.career_fights_all where fighter_id = t.bob() and event_slug = 'secret-draft'), 0::bigint);
select t.as_user(t.uid(2));
select t.expect_eq('the draft event''s organizer sees it (the rows follow row level security, not a copy)', (select count(*) from public.career_fights_all where fighter_id = t.bob() and event_slug = 'secret-draft'), 1::bigint);
select t.expect_eq('the organizer''s own career total therefore counts it; the public total does not', (select matches from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 19);
select t.as_user(t.uid(7));
select t.expect_eq('a signed-in stranger sees exactly what the public sees', (select matches from public.fighter_career(t.bob()) where context = 'official' and scope = 'career' and kind is null), 18);
select t.as_anon();
select t.expect_error('the public cannot read account links', 'select user_id from public.fighter_accounts', '42501');
select t.expect_error('the public cannot read private registration data', 'select * from public.registration_private', '42501');
select t.as_admin();
select t.expect_eq('no new view or function carries an account, contact or health column',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('career_fights_all', 'career_fights', 'team_fights_all', 'team_fights', 'career_results_all', 'career_results')
     and (column_name ~ '(user|email|phone|emergency|medical|waiver|note|address)'))
  + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fighter_career', 'team_career', 'fighter_head_to_head', 'team_head_to_head', 'team_fighters_represented')
     and pg_get_function_result(p.oid) ~ '(user|email|phone|emergency|medical|waiver|note|address)'), 0::bigint);
select t.expect_eq('the new views are security invoker', (select count(*) from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace and c.relname in ('career_fights_all', 'career_fights', 'team_fights_all', 'team_fights', 'career_results_all', 'career_results') and c.reloptions @> array['security_invoker=true']), 6::bigint);
select t.expect_eq('the new functions are NOT security definer (they see what the caller may see) and have an empty search_path', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fighter_career', 'team_career', 'fighter_head_to_head', 'team_head_to_head', 'team_fighters_represented') and not p.prosecdef and p.proconfig @> array['search_path=""']), 5::bigint);
select t.expect_eq('the public may read the new views and call the new functions', (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT' and table_name in ('career_fights_all', 'career_fights', 'team_fights_all', 'team_fights', 'career_results_all', 'career_results'))
  + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fighter_career', 'team_career', 'fighter_head_to_head', 'team_head_to_head', 'team_fighters_represented') and has_function_privilege('anon', p.oid, 'execute')), 11::bigint);

select 'PACK10 GATE PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
