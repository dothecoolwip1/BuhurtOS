-- Pack 09C gate: competition finalization, official podiums, locks, reopen, event closeout (migration 20261004000900).
-- Proves: the server names every blocker (open fights, bracket not built, third place not played, review conflicts, medal ties, live scores, closed event);
-- only organizers (owner, organization admin, event organizer) can review, finalize, reopen and close; placements come from the one existing computation
-- (round robin, bracket with and without a third-place match, team fight, DQ and withdrawal); points equal the existing formula; finalize is idempotent
-- and a stale screen gets a state, not a duplicate; an official competition is locked against every ordinary mutation but keeps the audited correction
-- paths; reopen supersedes (never deletes) history and refinalization works; event closeout is blocked, then allowed, then locks the event, and can be
-- reopened with a reason; synthetic results stay out of real all-time rankings; the public results view carries no account data; legacy back-fill.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack09c_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create table t.nx (k text primary key, v text not null);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
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
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function t.id(p text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
create function t.gu(k text) returns uuid language sql stable as $$ select v::uuid from t.nx where k = $1 $$;
create function t.ent(p_key text, p_comp uuid, p_team uuid, p_fighter uuid, p_status text default 'checked_in') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.entries (competition_id, team_id, fighter_id, status) values (p_comp, p_team, p_fighter, p_status) returning id into v;
  insert into t.nx values ('e:' || p_key, v::text);
  return v;
end $$;
create function t.mkm(p_key text, p_comp uuid, p_stage text, p_label text, p_pos int, p_pool text, p_a text, p_b text, p_next text, p_slot text) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.matches (id, competition_id, stage, round_label, position, pool, entry_a, entry_b, next_match_id, next_slot)
  values (v, p_comp, p_stage, p_label, p_pos, p_pool, case when p_a is null then null else t.gu('e:' || p_a) end, case when p_b is null then null else t.gu('e:' || p_b) end,
          case when p_next is null then null else t.gu('m:' || p_next) end, p_slot);
  insert into t.nx values ('m:' || p_key, v::text);
end $$;
create function t.fin(p_key text, p_res text, p_a int, p_b int, p_detail jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  perform public.finalize_match(t.gu('m:' || p_key), p_res, p_a, p_b, p_detail, (select version from public.matches where id = t.gu('m:' || p_key)));
end $$;
create function t.place(p_comp uuid, p_key text) returns text language sql stable as $$ select final_place::text from public.results where competition_id = p_comp and entry_id = t.gu('e:' || p_key) $$;
create function t.pts(p_comp uuid, p_key text) returns numeric language sql stable as $$ select points from public.results where competition_id = p_comp and entry_id = t.gu('e:' || p_key) $$;
create function t.pre(p_comp uuid) returns jsonb language sql stable as $$ select public.competition_finalize_preflight(p_comp) $$;
create function t.codes(p_comp uuid) returns text language sql stable as $$ select coalesce(string_agg(b ->> 'code', ',' order by o), '') from jsonb_array_elements(t.pre(p_comp) -> 'blockers') with ordinality x(b, o) $$;
create function t.wcodes(p_comp uuid) returns text language sql stable as $$ select coalesce(string_agg(b ->> 'code', ',' order by b ->> 'code'), '') from jsonb_array_elements(t.pre(p_comp) -> 'warnings') b $$;
create function t.status(p_comp uuid) returns text language sql stable as $$ select status from public.competitions where id = p_comp $$;
create function t.audits(p_action text, p_subject uuid) returns bigint language sql stable security definer as $$ select count(*) from public.audit_log where action = p_action and subject = p_subject::text $$;
create function t.revisions(p_comp uuid, p_action text) returns bigint language sql stable security definer as $$ select count(*) from public.result_revisions where competition_id = p_comp and action = p_action $$;
create function t.podium(p_comp uuid) returns text language sql stable as $$
  select string_agg(final_place || ':' || coalesce(fighter_name, team_name_at_event) || coalesce(' (' || represented_team_name_at_event || ')', ''), ',' order by final_place, coalesce(fighter_name, team_name_at_event))
  from public.competition_results where competition_id = p_comp $$;
create function t.fz(p_comp uuid) returns void language plpgsql as $$ begin delete from t.nx where k = 'fz:' || p_comp; insert into t.nx values ('fz:' || p_comp, public.finalize_competition(p_comp) ->> 'status'); end $$;
create function t.fzs(p_comp uuid) returns text language sql stable as $$ select v from t.nx where k = 'fz:' || p_comp $$;
create function t.cz(p_event uuid, p_note text default null) returns void language plpgsql as $$ begin delete from t.nx where k = 'cz:' || p_event; insert into t.nx values ('cz:' || p_event, public.close_event(p_event, p_note) ->> 'status'); end $$;
create function t.czs(p_event uuid) returns text language sql stable as $$ select v from t.nx where k = 'cz:' || p_event $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log, t.nx to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- Users: d1 platform owner; d2 organizer of E1 and E3; d3 organizer of E2 only; d4 scorekeeper E1; d5 head marshal E1; d6 captain of team c1; d7 stranger; d9 admin of organization a1.
-- Organizations: a1 real (season b1; events E1 published, E2 DRAFT); a2 FICTIONAL (season b2; event E3 published, fictional).
-- Teams c1..c4. Fighters f0..ff and d0..df; f0..f3 longsword (f3 has no team), f4..f6 the tie, f7..fa the bracket, fb..fe the bracket without third place,
-- d0..d2 team c1 and d3..d5 team c2 rosters, d6..d9 sabre (d9 withdrawn, d8 disqualified), da..dd pools, de/df E2, ff + d0? no: e0/e1 synthetic in E3.
select t.as_admin();
insert into auth.users (id, email) select t.uid(n), 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values (t.uid(1), 'owner');
insert into public.sources (id, kind, title, citation, synthetic) values (t.id('c9ff'), 'submitted', 'Fictional league', 'test', true);
insert into public.organizations (id, slug, name, kind) values (t.id('c9a1'), 'c9-real', 'Real League', 'regional'), (t.id('c9a2'), 'c9-fict', 'Fictional League', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values (t.id('c9a1'), t.uid(9), 'admin');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  (t.id('c9b1'), t.id('c9a1'), 'c9-2026', 'Real 2026', current_date - 100, current_date + 100), (t.id('c9b2'), t.id('c9a2'), 'c9-f2026', 'Fictional 2026', current_date - 100, current_date + 100);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, organization_id, season_id) values
  (t.id('c9e1'), 'c9-open', 'C9 Open', 'published', 'tournament', current_date, current_date + 1, t.id('c9a1'), t.id('c9b1')),
  (t.id('c9e2'), 'c9-other', 'C9 Other (draft)', 'draft', 'tournament', current_date, current_date + 1, t.id('c9a1'), t.id('c9b1')),
  (t.id('c9e3'), 'c9-fict', 'C9 Fictional', 'published', 'tournament', current_date, current_date + 1, t.id('c9a2'), t.id('c9b2'));
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values
  (t.id('c9ff'), 'organization', t.id('c9a2'), 'unverified', 'fictional'), (t.id('c9ff'), 'event', t.id('c9e3'), 'unverified', 'fictional');
insert into public.event_staff (event_id, user_id, role) values
  (t.id('c9e1'), t.uid(2), 'organizer'), (t.id('c9e3'), t.uid(2), 'organizer'), (t.id('c9e2'), t.uid(3), 'organizer'),
  (t.id('c9e1'), t.uid(4), 'scorekeeper'), (t.id('c9e1'), t.uid(5), 'head_marshal');
insert into public.teams (id, slug, name, status, city, country) values
  (t.id('c9c1'), 'c9-ankle-biters', 'Ankle Biters', 'approved', 'Red Deer', 'CA'), (t.id('c9c2'), 'c9-reavers', 'Red Deer Reavers', 'approved', 'Red Deer', 'CA'),
  (t.id('c9c3'), 'c9-ravens', 'Northern Ravens', 'approved', 'Edmonton', 'CA'), (t.id('c9c4'), 'c9-bears', 'Mountain Bears', 'approved', 'Canmore', 'CA');
insert into public.team_roles (team_id, user_id, role) values (t.id('c9c1'), t.uid(6), 'captain');
insert into public.fighters (id, display_name, team_id) values
  (t.id('c9f0'), 'Bob', t.id('c9c1')), (t.id('c9f1'), 'John', t.id('c9c1')), (t.id('c9f2'), 'Joe', t.id('c9c2')), (t.id('c9f3'), 'Mike', null),
  (t.id('c9f4'), 'Ann', t.id('c9c1')), (t.id('c9f5'), 'Bea', t.id('c9c2')), (t.id('c9f6'), 'Cat', t.id('c9c3')),
  (t.id('c9f7'), 'Dan', t.id('c9c1')), (t.id('c9f8'), 'Eli', t.id('c9c2')), (t.id('c9f9'), 'Fay', t.id('c9c3')), (t.id('c9fa'), 'Gus', t.id('c9c4')),
  (t.id('c9fb'), 'Hal', null), (t.id('c9fc'), 'Ida', t.id('c9c2')), (t.id('c9fd'), 'Jon', t.id('c9c3')), (t.id('c9fe'), 'Kim', t.id('c9c4')),
  (t.id('c9d0'), 'Lee', t.id('c9c1')), (t.id('c9d1'), 'Max', t.id('c9c1')), (t.id('c9d2'), 'Ned', t.id('c9c1')), (t.id('c9d3'), 'Oli', t.id('c9c2')), (t.id('c9d4'), 'Pat', t.id('c9c2')), (t.id('c9d5'), 'Quin', t.id('c9c2')),
  (t.id('c9d6'), 'Rae', t.id('c9c1')), (t.id('c9d7'), 'Sam', t.id('c9c2')), (t.id('c9d8'), 'Tom', t.id('c9c3')), (t.id('c9d9'), 'Uma', t.id('c9c4')),
  (t.id('c9da'), 'Val', t.id('c9c1')), (t.id('c9db'), 'Wes', t.id('c9c2')), (t.id('c9dc'), 'Xan', t.id('c9c3')), (t.id('c9dd'), 'Yul', t.id('c9c4')),
  (t.id('c9de'), 'Zed', t.id('c9c1')), (t.id('c9df'), 'Abe', t.id('c9c2')),
  (t.id('c9e0'), 'Fict One', t.id('c9c1')), (t.id('c9e4'), 'Fict Two', t.id('c9c2'));
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  (t.id('c901'), t.id('c9e1'), 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.id('c902'), t.id('c9e1'), 'Sword and shield (men)', 'sword_shield', 'men', 'Classic', 'round_robin', 2),
  (t.id('c903'), t.id('c9e1'), 'Polearm (men)', 'polearm', 'men', 'Classic', 'elimination', 3),
  (t.id('c904'), t.id('c9e1'), 'Longsword (women)', 'longsword', 'women', 'Classic', 'elimination', 4),
  (t.id('c905'), t.id('c9e1'), '5v5 (men)', '5v5', 'men', 'Classic', 'elimination', 5),
  (t.id('c906'), t.id('c9e1'), 'Sabre (men)', 'sabre', 'men', null, 'round_robin', 6),
  (t.id('c907'), t.id('c9e1'), 'Buckler (men)', 'buckler', 'men', 'Classic', 'round_robin', 7),
  (t.id('c908'), t.id('c9e1'), 'Profight (men)', 'profight', 'men', 'Classic', 'pools_elimination', 8),
  (t.id('c909'), t.id('c9e2'), 'Other longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.id('c90a'), t.id('c9e3'), 'Fictional longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.id('c90b'), t.id('c9e1'), 'Legacy greatsword', 'greatsword', 'men', 'Classic', 'round_robin', 9);
-- A. round robin, clear order: Bob beats all, John beats Joe and Mike, Joe beats Mike. Mike has no team.
select t.ent('f0', t.id('c901'), null, t.id('c9f0')); select t.ent('f1', t.id('c901'), null, t.id('c9f1')); select t.ent('f2', t.id('c901'), null, t.id('c9f2')); select t.ent('f3', t.id('c901'), null, t.id('c9f3'));
select t.mkm('a01', t.id('c901'), 'round_robin', 'Round 1', 0, null, 'f0', 'f1', null, null); select t.mkm('a02', t.id('c901'), 'round_robin', 'Round 1', 1, null, 'f2', 'f3', null, null);
select t.mkm('a03', t.id('c901'), 'round_robin', 'Round 2', 0, null, 'f0', 'f2', null, null); select t.mkm('a04', t.id('c901'), 'round_robin', 'Round 2', 1, null, 'f1', 'f3', null, null);
select t.mkm('a05', t.id('c901'), 'round_robin', 'Round 3', 0, null, 'f0', 'f3', null, null); select t.mkm('a06', t.id('c901'), 'round_robin', 'Round 3', 1, null, 'f1', 'f2', null, null);
-- B. round robin with a three-way cycle: Ann > Bea > Cat > Ann, every score 5-3.
select t.ent('f4', t.id('c902'), null, t.id('c9f4')); select t.ent('f5', t.id('c902'), null, t.id('c9f5')); select t.ent('f6', t.id('c902'), null, t.id('c9f6'));
select t.mkm('b01', t.id('c902'), 'round_robin', 'Round 1', 0, null, 'f4', 'f5', null, null); select t.mkm('b02', t.id('c902'), 'round_robin', 'Round 2', 0, null, 'f5', 'f6', null, null); select t.mkm('b03', t.id('c902'), 'round_robin', 'Round 3', 0, null, 'f6', 'f4', null, null);
-- C. bracket of four with a third-place match. D. the same without one (shared bronze).
select t.ent('f7', t.id('c903'), null, t.id('c9f7')); select t.ent('f8', t.id('c903'), null, t.id('c9f8')); select t.ent('f9', t.id('c903'), null, t.id('c9f9')); select t.ent('fa', t.id('c903'), null, t.id('c9fa'));
select t.mkm('cf', t.id('c903'), 'final', 'Final', 0, null, null, null, null, null);
select t.mkm('c1', t.id('c903'), 'elimination', 'Semifinal', 0, null, 'f7', 'f8', 'cf', 'a'); select t.mkm('c2', t.id('c903'), 'elimination', 'Semifinal', 1, null, 'f9', 'fa', 'cf', 'b');
select t.mkm('c3', t.id('c903'), 'third_place', 'Third place', 0, null, null, null, null, null);
select t.ent('fb', t.id('c904'), null, t.id('c9fb')); select t.ent('fc', t.id('c904'), null, t.id('c9fc')); select t.ent('fd', t.id('c904'), null, t.id('c9fd')); select t.ent('fe', t.id('c904'), null, t.id('c9fe'));
select t.mkm('df', t.id('c904'), 'final', 'Final', 0, null, null, null, null, null);
select t.mkm('d1', t.id('c904'), 'elimination', 'Semifinal', 0, null, 'fb', 'fc', 'df', 'a'); select t.mkm('d2', t.id('c904'), 'elimination', 'Semifinal', 1, null, 'fd', 'fe', 'df', 'b');
-- E. team fight: one final between two teams.
select t.ent('t1', t.id('c905'), t.id('c9c1'), null); select t.ent('t2', t.id('c905'), t.id('c9c2'), null);
select t.mkm('tf', t.id('c905'), 'final', 'Final', 0, null, 't1', 't2', null, null);
-- F. sabre, no tier: Uma withdrew before the draw; Tom is disqualified after his first fight (his other fights become walkovers).
select t.ent('g6', t.id('c906'), null, t.id('c9d6')); select t.ent('g7', t.id('c906'), null, t.id('c9d7')); select t.ent('g8', t.id('c906'), null, t.id('c9d8')); select t.ent('g9', t.id('c906'), null, t.id('c9d9'), 'withdrawn');
select t.mkm('g01', t.id('c906'), 'round_robin', 'Round 1', 0, null, 'g6', 'g7', null, null); select t.mkm('g02', t.id('c906'), 'round_robin', 'Round 2', 0, null, 'g6', 'g8', null, null); select t.mkm('g03', t.id('c906'), 'round_robin', 'Round 3', 0, null, 'g7', 'g8', null, null);
-- G. buckler: entries, no draw ever (never ran). H. profight: pools, no bracket yet.
select t.ent('h1', t.id('c907'), null, t.id('c9de')); select t.ent('h2', t.id('c907'), null, t.id('c9df'));
select t.ent('pa', t.id('c908'), null, t.id('c9da')); select t.ent('pb', t.id('c908'), null, t.id('c9db')); select t.ent('pc', t.id('c908'), null, t.id('c9dc')); select t.ent('pd', t.id('c908'), null, t.id('c9dd'));
select t.mkm('p1', t.id('c908'), 'pool', 'Pool A', 0, 'A', 'pa', 'pb', null, null); select t.mkm('p2', t.id('c908'), 'pool', 'Pool B', 0, 'B', 'pc', 'pd', null, null);
-- E2 (draft, another organizer) and E3 (fictional): one fight each.
select t.ent('o1', t.id('c909'), null, t.id('c9de')); select t.ent('o2', t.id('c909'), null, t.id('c9df')); select t.mkm('o01', t.id('c909'), 'round_robin', 'Round 1', 0, null, 'o1', 'o2', null, null);
select t.ent('s1', t.id('c90a'), null, t.id('c9e0')); select t.ent('s2', t.id('c90a'), null, t.id('c9e4')); select t.mkm('s01', t.id('c90a'), 'round_robin', 'Round 1', 0, null, 's1', 's2', null, null);
-- Legacy: finished before this pack, by the old finish (an audit row at a known time), results written by a loader.
select t.ent('l1', t.id('c90b'), null, t.id('c9d0')); select t.ent('l2', t.id('c90b'), null, t.id('c9d1'));
select t.mkm('l01', t.id('c90b'), 'round_robin', 'Round 1', 0, null, 'l1', 'l2', null, null);
update public.matches set queue_state = 'final', result = 'a', winner_entry_id = t.gu('e:l1'), score_a = 5, score_b = 1 where id = t.gu('m:l01');
insert into public.results (competition_id, entry_id, final_place, points) values (t.id('c90b'), t.gu('e:l1'), 1, 7), (t.id('c90b'), t.gu('e:l2'), 2, 4);
update public.competitions set status = 'finished' where id = t.id('c90b');
insert into public.audit_log (at, actor, event_id, action, subject, details) values ('2026-03-01T10:00:00Z', t.uid(2), t.id('c9e1'), 'competition.finished', t.id('c90b')::text, '{"source":"league_structure","entries":2}');

-- ================================================================ 1. the preflight names what is in the way
select t.as_user(t.uid(2));
select t.expect_eq('fixture: the represented team came from the fighter''s home team at entry (Bob: Ankle Biters), Mike has none',
  (select string_agg(coalesce(represented_team_name_at_event, '-'), ',' order by fighter_id) from public.entries where competition_id = t.id('c901')), 'Ankle Biters,Ankle Biters,Red Deer Reavers,-');
select t.expect_eq('round robin before any fight: running, 6 fights open', (t.pre(t.id('c901')) ->> 'state') || '/' || t.codes(t.id('c901')) || '/' || (t.pre(t.id('c901')) -> 'matches' ->> 'final'), 'running/open_matches/0');
select t.fin('a01', 'a', 5, 2); select t.fin('a02', 'a', 5, 3); select t.fin('a03', 'a', 5, 1); select t.fin('a04', 'a', 5, 4); select t.fin('a05', 'a', 5, 0);
select t.expect_eq('one fight left: still running', (t.pre(t.id('c901')) ->> 'state') || '/' || (t.pre(t.id('c901')) -> 'blockers' -> 0 ->> 'text'), 'running/1 fight has no result yet.');
select t.expect_error('finalize refuses while a fight is open', format($$select public.finalize_competition(%L)$$, t.id('c901')), 'P0001');
select t.fin('a06', 'a', 5, 3);
select t.expect_eq('every fight final: ready, no blockers', (t.pre(t.id('c901')) ->> 'state') || '/' || t.codes(t.id('c901')), 'ready/');
select t.expect_eq('the preview places Bob, John, Joe, Mike with the existing formula (3 wins + gold = 9 ...)',
  (select string_agg((p ->> 'place') || ':' || (p ->> 'name') || ':' || (p ->> 'points')::numeric::int, ',' order by (p ->> 'place')::int) from jsonb_array_elements(t.pre(t.id('c901')) -> 'placements') p), '1:Bob:9,2:John:6,3:Joe:3,4:Mike:0');
select t.expect_eq('the preview names the team each fighter represented, and the warning names Mike',
  (select p ->> 'represented_team_name' from jsonb_array_elements(t.pre(t.id('c901')) -> 'placements') p where p ->> 'name' = 'Bob') || '/' || t.wcodes(t.id('c901')) || '/' ||
  (select w -> 'entries' -> 0 ->> 'name' from jsonb_array_elements(t.pre(t.id('c901')) -> 'warnings') w where w ->> 'code' = 'no_represented_team'), 'Ankle Biters/no_represented_team/Mike');
-- a review conflict blocks
select t.as_admin();
insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, expected_version, result, score_a, score_b, status)
  values (gen_random_uuid(), t.gu('m:a06'), t.id('c9e1'), 'device', t.uid(4), 1, 1, 'b', 3, 5, 'conflict');
select t.as_user(t.uid(2));
select t.expect_eq('a result two devices disagreed about blocks: blocked / result_conflicts', (t.pre(t.id('c901')) ->> 'state') || '/' || t.codes(t.id('c901')), 'blocked/result_conflicts');
select t.expect_error('... and finalize says so', format($$select public.finalize_competition(%L)$$, t.id('c901')), 'P0001');
select t.as_admin(); update public.result_proposals set status = 'resolved_kept' where match_id = t.gu('m:a06');
-- a running score still on the board blocks
insert into public.match_live_scores (match_id, competition_id, score_a, score_b) values (t.gu('m:a06'), t.id('c901'), 4, 3);
select t.as_user(t.uid(2));
select t.expect_eq('a live score left on the board blocks', t.codes(t.id('c901')), 'live_score');
select t.as_admin(); delete from public.match_live_scores where match_id = t.gu('m:a06');
select t.as_user(t.uid(2));
select t.expect_eq('clear again: ready', (t.pre(t.id('c901')) ->> 'state'), 'ready');
-- the tie
select t.fin('b01', 'a', 5, 3); select t.fin('b02', 'a', 5, 3); select t.fin('b03', 'a', 5, 3);
select t.expect_eq('a three-way tie for the medals: blocked / medal_tie', (t.pre(t.id('c902')) ->> 'state') || '/' || t.codes(t.id('c902')), 'blocked/medal_tie');
select t.expect_error('finalize refuses the tie and says what to do', format($$select public.finalize_competition(%L)$$, t.id('c902')), 'P0001');
-- the bracket
select t.fin('c1', 'a', 5, 1); select t.fin('c2', 'a', 5, 2);
select t.expect_eq('semifinals done, final and third place open', t.codes(t.id('c903')) || '/' || (t.pre(t.id('c903')) -> 'blockers' -> 0 ->> 'count'), 'open_matches/2');
select t.fin('cf', 'a', 5, 4);
select t.expect_eq('only the third-place match is open, and the text says so', (t.pre(t.id('c903')) -> 'blockers' -> 0 ->> 'text'), '1 fight has no result yet, including the third-place match.');
select t.expect_error('a bracket cannot be official with the third-place match unplayed', format($$select public.finalize_competition(%L)$$, t.id('c903')), 'P0001');
-- pools without a bracket
select t.fin('p1', 'a', 5, 1); select t.fin('p2', 'a', 5, 1);
select t.expect_eq('pools played, bracket not built: blocked / bracket_missing', (t.pre(t.id('c908')) ->> 'state') || '/' || t.codes(t.id('c908')), 'blocked/bracket_missing');
select t.expect_error('... refused', format($$select public.finalize_competition(%L)$$, t.id('c908')), 'P0001');
-- no draw
select t.expect_eq('a competition with no draw: blocked / no_draw', (t.pre(t.id('c907')) ->> 'state') || '/' || t.codes(t.id('c907')), 'blocked/no_draw');

-- ================================================================ 2. who may review and finalize
select t.as_user(t.uid(4)); select t.expect_error('a scorekeeper cannot read the preflight', format($$select public.competition_finalize_preflight(%L)$$, t.id('c901')), '42501');
select t.expect_error('a scorekeeper cannot finalize', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.as_user(t.uid(5)); select t.expect_error('a head marshal cannot finalize', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.as_user(t.uid(6)); select t.expect_error('a team captain cannot finalize', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.as_user(t.uid(7)); select t.expect_error('a stranger cannot finalize', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.as_user(t.uid(3)); select t.expect_error('the organizer of another event cannot finalize', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.as_anon(); select t.expect_error('anon cannot call finalize at all', format($$select public.finalize_competition(%L)$$, t.id('c901')), '42501');
select t.expect_error('anon cannot call the preflight', format($$select public.competition_finalize_preflight(%L)$$, t.id('c901')), '42501');
select t.as_user(t.uid(9)); select t.expect_eq('the organization administrator can read the preflight', t.pre(t.id('c901')) ->> 'state', 'ready');
select t.as_user(t.uid(1)); select t.expect_eq('the platform owner can read the preflight', t.pre(t.id('c901')) ->> 'state', 'ready');

-- ================================================================ 3. finalize: official, idempotent, the existing formula
select t.as_user(t.uid(2));
create temp table t_preview as select p from jsonb_array_elements(t.pre(t.id('c901')) -> 'placements') p;
select t.fz(t.id('c901'));
select t.expect_eq('the organizer finalizes: official, 4 placings', t.fzs(t.id('c901')) || '/' || (select count(*) from public.results where competition_id = t.id('c901')), 'official/4');
select t.expect_eq('places: Bob 1, John 2, Joe 3, Mike 4', t.place(t.id('c901'), 'f0') || t.place(t.id('c901'), 'f1') || t.place(t.id('c901'), 'f2') || t.place(t.id('c901'), 'f3'), '1234');
select t.expect_eq('points are exactly what the preview showed (same formula, Classic multiplier)', (select string_agg(t.pts(t.id('c901'), k)::int::text, ',' order by k) from unnest(array['f0', 'f1', 'f2', 'f3']) k), '9,6,3,0');
select t.expect_eq('... and equal to the stored formula for every entry', (select count(*) from t_preview x join public.results r on r.entry_id = (x.p ->> 'entry_id')::uuid where r.points <> (x.p ->> 'points')::numeric), 0::bigint);
select t.expect_eq('official metadata: finished, finalized_at set, source recorded, no reopen', (select status || '/' || (finalized_at is not null) || '/' || multiplier_source || '/' || (reopened_at is null) from public.competitions where id = t.id('c901')), 'finished/true/tournament_structure/true');
select t.expect_eq('one audit row and four computed revisions', t.audits('competition.finished', t.id('c901')) || '/' || t.revisions(t.id('c901'), 'computed'), '1/4');
select t.expect_eq('finalizing again (double tap, stale screen): already_official, nothing duplicated',
  (public.finalize_competition(t.id('c901')) ->> 'status') || '/' || (select count(*) from public.results where competition_id = t.id('c901')) || '/' || t.audits('competition.finished', t.id('c901')) || '/' || t.revisions(t.id('c901'), 'computed'), 'already_official/4/1/4');
select t.expect_eq('the preflight now reads official and shows the official placings', (t.pre(t.id('c901')) ->> 'state') || '/' || (select string_agg((p ->> 'place') || ':' || (p ->> 'name'), ',' order by (p ->> 'place')::int) from jsonb_array_elements(t.pre(t.id('c901')) -> 'placements') p), 'official/1:Bob,2:John,3:Joe,4:Mike');
select t.expect_eq('Mike''s result is official although he has no recorded team (the warning stays)', (t.place(t.id('c901'), 'f3') is not null)::text || '/' || t.wcodes(t.id('c901')), 'true/no_represented_team');
select t.expect_eq('the team discipline totals follow: Ankle Biters 15 (Bob 9 + John 6), Red Deer Reavers 3', (select string_agg(team_name || ':' || points::int, ',' order by rank) from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('c9b1') and category = 'longsword' and gender = 'men'), 'Ankle Biters:15,Red Deer Reavers:3');
select t.expect_eq('... and Mike''s 0 points sit with no team', (select count(*) from public.team_discipline_contributions where scope = 'season' and season_id = t.id('c9b1') and category = 'longsword' and gender = 'men' and team_id is null), 1::bigint);
select t.expect_eq('the fighter ranking counts the official result (Bob gold, 9 points)', (select golds || '/' || points::int from public.ranking_fighters where scope = 'season' and season_id = t.id('c9b1') and category = 'longsword' and gender = 'men' and fighter_id = t.id('c9f0')), '1/9');

-- ================================================================ 4. an official competition is locked (server side)
select t.as_user(t.uid(2));
select t.expect_error('no new fight can be added to an official competition (the organizer has no insert right at all since Pack 24A0)', format($$insert into public.matches (competition_id, stage, round_label, position, entry_a, entry_b) values (%L, 'round_robin', 'Extra', 9, %L, %L)$$, t.id('c901'), t.gu('e:f0'), t.gu('e:f1')), '42501');
select t.expect_ok('a plain write to a final fight is a no-op under the existing row rule (final rows are not the organizer''s to edit)', format($$update public.matches set field = 'Field 9' where id = %L$$, t.gu('m:a06')));
select t.expect_eq('... the fight is unchanged', (select coalesce(field, 'none') from public.matches where id = t.gu('m:a06')), 'none');
select t.expect_error('a plain delete of a fight is refused outright (Pack 24A0)', format($$delete from public.matches where id = %L$$, t.gu('m:a06')), '42501');
select t.expect_eq('... it is still there', (select count(*) from public.matches where id = t.gu('m:a06')), 1::bigint);
select t.expect_error('a fight that is NOT final cannot be added into an official competition through the organizer''s normal update path either (new row)', format($$insert into public.matches (competition_id, stage, round_label, position) values (%L, 'round_robin', 'Extra', 10)$$, t.id('c901')), '42501');
select t.expect_error('nor scored again', format($$select public.finalize_match(%L, 'b', 1, 5, '{}'::jsonb, (select version from public.matches where id = %L))$$, t.gu('m:a06'), t.gu('m:a06')), 'P0001');
select t.expect_error('no entrant can be withdrawn by a plain write', format($$update public.entries set status = 'withdrawn' where id = %L$$, t.gu('e:f3')), 'P0001');
select t.expect_error('no entrant can be added', format($$select public.add_entrant(%L, %L, null)$$, t.id('c901'), t.id('c9d0')), 'P0001');
select t.expect_error('the status cannot be written back to running by hand', format($$update public.competitions set status = 'running' where id = %L$$, t.id('c901')), 'P0001');
select t.expect_error('the official record cannot be edited by hand', format($$update public.competitions set finalized_at = null where id = %L$$, t.id('c901')), 'P0001');
select t.expect_error('a tie decision cannot be recorded once official', format($$select public.record_tie_decision(%L, '', array[%L, %L]::uuid[], 'late')$$, t.id('c901'), t.gu('e:f0'), t.gu('e:f1')), 'P0001');
select t.expect_error('a new draw cannot be built over official results', format($$select public.build_schedule(%L, '[{"key":"x","stage":"round_robin","round_label":"R","position":0,"a":"%s","b":"%s"}]'::jsonb, 'replace', null)$$, t.id('c901'), t.gu('e:f0'), t.gu('e:f1')), 'P0001');
select t.expect_error('a running competition cannot be set to finished by hand either', format($$update public.competitions set status = 'finished' where id = %L$$, t.id('c902')), 'P0001');
select t.expect_ok('the audited represented-team correction still works on an official result (Mike: Red Deer Reavers)', format($$select public.set_represented_team(%L, %L, 'checked the entry list')$$, t.gu('e:f3'), t.id('c9c2')));
select t.expect_eq('... and the team totals follow without touching the placing', (select points::int from public.ranking_team_disciplines where scope = 'season' and season_id = t.id('c9b1') and category = 'longsword' and gender = 'men' and team_id = t.id('c9c2')) || '/' || t.place(t.id('c901'), 'f3'), '3/4');
select t.expect_ok('the audited hand correction of a placing still works', format($$select public.correct_result(%L, %L, 3, 2.5, 'marshal sheet says 2.5')$$, t.id('c901'), t.gu('e:f2')));
select t.expect_eq('... it is recorded, and the preflight now says the placings were corrected by hand', t.revisions(t.id('c901'), 'corrected') || '/' || t.codes(t.id('c901')), '1/hand_corrected');
select t.fz(t.id('c901'));
select t.expect_eq('finalize after a hand correction does not recompute (already_official keeps the correction)', t.fzs(t.id('c901')) || '/' || t.pts(t.id('c901'), 'f2'), 'already_official/2.5');
select t.expect_error('the plain finish cannot recompute over a hand correction', format($$select public.finish_competition(%L)$$, t.id('c901')), 'P0001');

-- ================================================================ 5. reopen: deliberate, with a reason, audited; history superseded, never erased
select t.as_user(t.uid(4)); select t.expect_error('a scorekeeper cannot reopen an official result', format($$select public.reopen_competition(%L, 'reason')$$, t.id('c901')), '42501');
select t.as_user(t.uid(5)); select t.expect_error('a head marshal cannot reopen it', format($$select public.reopen_competition(%L, 'reason')$$, t.id('c901')), '42501');
select t.as_user(t.uid(3)); select t.expect_error('the organizer of another event cannot reopen it', format($$select public.reopen_competition(%L, 'reason')$$, t.id('c901')), '42501');
select t.as_anon(); select t.expect_error('anon cannot reopen it', format($$select public.reopen_competition(%L, 'reason')$$, t.id('c901')), '42501');
select t.as_user(t.uid(2));
select t.expect_error('a reason is required', format($$select public.reopen_competition(%L, ' ')$$, t.id('c901')), '22023');
select t.expect_error('a competition that is not official cannot be reopened', format($$select public.reopen_competition(%L, 'nothing to reopen')$$, t.id('c902')), 'P0001');
select t.expect_ok('the organizer reopens it with a reason', format($$select public.reopen_competition(%L, 'Round 3 was scored for the wrong fighter')$$, t.id('c901')));
select t.expect_eq('reopened: running, finalized_at cleared, reopened_at set, no results, 4 superseded revisions, audited with the reason',
  (select status || '/' || (finalized_at is null) || '/' || (reopened_at is not null) from public.competitions where id = t.id('c901')) || '/' || (select count(*) from public.results where competition_id = t.id('c901'))
  || '/' || t.revisions(t.id('c901'), 'superseded') || '/' || (select details ->> 'reason' from public.audit_log where action = 'competition.reopened' and subject = t.id('c901')::text), 'running/true/true/0/4/Round 3 was scored for the wrong fighter');
select t.expect_eq('the first official version is kept in the revisions (Joe was 3rd with 2.5 after the correction)', (select old_place || '/' || old_points from public.result_revisions where competition_id = t.id('c901') and entry_id = t.gu('e:f2') and action = 'superseded'), '3/2.5');
select t.expect_eq('the preflight: ready again (every fight is still final)', t.pre(t.id('c901')) ->> 'state', 'ready');
select t.expect_ok('now the organizer reopens the wrongly scored fight', format($$select public.reopen_match(%L, 'scored for the wrong fighter')$$, t.gu('m:a06')));
select t.fin('a06', 'b', 2, 5);
select t.fz(t.id('c901'));
select t.expect_eq('refinalize: official again; the re-scored fight moves Joe to 2nd and John to 3rd, Mike stays 4th', t.fzs(t.id('c901')) || '/' || t.place(t.id('c901'), 'f2') || t.place(t.id('c901'), 'f1') || t.place(t.id('c901'), 'f3'), 'official/234');
select t.expect_eq('two finish audits, computed revisions continue (8), the superseded ones stay', t.audits('competition.finished', t.id('c901')) || '/' || t.revisions(t.id('c901'), 'computed') || '/' || t.revisions(t.id('c901'), 'superseded'), '2/8/4');
select public.reopen_match(t.gu('m:a05'), 'extra check');
select t.expect_eq('a match reopened inside an official competition also takes it back (reopen_match path), audited as such',
  t.status(t.id('c901')) || '/' || (select details ->> 'by' from public.audit_log where action = 'competition.reopened' and subject = t.id('c901')::text order by id desc limit 1), 'running/reopen_match');
select t.fin('a05', 'a', 5, 0);
select t.expect_eq('... and it is official once more after the fight is re-scored and finalized', public.finalize_competition(t.id('c901')) ->> 'status', 'official');

-- ================================================================ 6. the other structures
-- round robin tie, decided then finalized
select t.expect_ok('the organizer decides the three-way tie: Ann, Bea, Cat', format($$select public.record_tie_decision(%L, '', array[%L, %L, %L]::uuid[], 'head-to-head among the three: coin toss by the head marshal')$$, t.id('c902'), t.gu('e:f4'), t.gu('e:f5'), t.gu('e:f6')));
select t.expect_eq('decided: ready', t.pre(t.id('c902')) ->> 'state', 'ready');
select t.fz(t.id('c902'));
select t.expect_eq('finalized in the decided order', t.fzs(t.id('c902')) || '/' || t.place(t.id('c902'), 'f4') || t.place(t.id('c902'), 'f5') || t.place(t.id('c902'), 'f6'), 'official/123');
-- bracket with a third-place match
select t.fin('c3', 'b', 2, 5);
select t.fz(t.id('c903'));
select t.expect_eq('bracket: champion, runner-up, third-place winner, fourth', t.fzs(t.id('c903')) || '/' || t.place(t.id('c903'), 'f7') || t.place(t.id('c903'), 'f9') || t.place(t.id('c903'), 'fa') || t.place(t.id('c903'), 'f8'), 'official/1234');
-- bracket without a third-place match: shared bronze
select t.fin('d1', 'a', 5, 1); select t.fin('d2', 'b', 1, 5); select t.fin('df', 'a', 5, 3);
select t.fz(t.id('c904'));
select t.expect_eq('no third-place match: both semifinal losers share 3rd', t.fzs(t.id('c904')) || '/' || t.place(t.id('c904'), 'fb') || t.place(t.id('c904'), 'fe') || t.place(t.id('c904'), 'fc') || t.place(t.id('c904'), 'fd'), 'official/1233');
select t.expect_eq('medal counts: Ida and Jon each have one bronze in the fighter ranking', (select string_agg(bronzes::text, ',' order by fighter_id) from public.ranking_fighters where scope = 'season' and season_id = t.id('c9b1') and category = 'longsword' and gender = 'women' and fighter_id in (t.id('c9fc'), t.id('c9fd'))), '1,1');
-- team fight with historical rosters
select t.expect_eq('rosters set for both teams', public.set_entry_roster(t.gu('e:t1'), jsonb_build_array(jsonb_build_object('fighter_id', t.id('c9d0')), jsonb_build_object('fighter_id', t.id('c9d1')), jsonb_build_object('fighter_id', t.id('c9d2'))))
  + public.set_entry_roster(t.gu('e:t2'), jsonb_build_array(jsonb_build_object('fighter_id', t.id('c9d3')), jsonb_build_object('fighter_id', t.id('c9d4')), jsonb_build_object('fighter_id', t.id('c9d5')))), 6);
select t.fin('tf', 'a', 3, 1);
select t.fz(t.id('c905'));
select t.expect_eq('team fight: the team is the winner', t.fzs(t.id('c905')) || '/' || t.place(t.id('c905'), 't1') || t.place(t.id('c905'), 't2'), 'official/12');
select t.expect_error('the roster of an official team result is locked', format($$select public.set_entry_roster(%L, '[]'::jsonb)$$, t.gu('e:t1')), 'P0001');
select t.expect_eq('the team ranking counts it (Ankle Biters gold in 5v5), the discipline totals do not', (select golds from public.ranking_teams where scope = 'season' and season_id = t.id('c9b1') and category = '5v5' and gender = 'men' and team_id = t.id('c9c1')) || '/' || (select count(*) from public.ranking_team_disciplines where category = '5v5'), '1/0');
-- DQ and withdrawal, no tier
select t.fin('g01', 'a', 5, 2);
select t.as_admin(); update public.entries set status = 'disqualified' where id = t.gu('e:g8'); select t.as_user(t.uid(2));
select t.fin('g02', 'a', 0, 0, '{"walkover": true, "reason": "disqualified"}'::jsonb); select t.fin('g03', 'a', 0, 0, '{"walkover": true, "reason": "disqualified"}'::jsonb);
select t.expect_eq('warnings before finalizing: disqualified, no_tier, withdrawn', t.wcodes(t.id('c906')), 'disqualified,no_tier,withdrawn');
select t.fz(t.id('c906'));
select t.expect_eq('DQ last with 0 points, withdrawn without a result, no tier means 0 points for everyone', t.fzs(t.id('c906')) || '/' || t.place(t.id('c906'), 'g6') || t.place(t.id('c906'), 'g7') || t.place(t.id('c906'), 'g8') || '/' || coalesce(t.place(t.id('c906'), 'g9'), 'none') || '/' || t.pts(t.id('c906'), 'g8') || '/' || t.pts(t.id('c906'), 'g6'), 'official/123/none/0/0');
-- pools: build the bracket, then official
select t.as_admin(); select t.mkm('pf', t.id('c908'), 'final', 'Final', 0, null, 'pa', 'pc', null, null); select t.as_user(t.uid(2));
select t.expect_eq('with a bracket the pools competition is running again (one fight open)', (t.pre(t.id('c908')) ->> 'state') || '/' || t.codes(t.id('c908')), 'running/open_matches');
select t.fin('pf', 'b', 3, 5);
select t.fz(t.id('c908'));
select t.expect_eq('pools into a final: official; the two pool runners-up share 3rd', t.fzs(t.id('c908')) || '/' || t.place(t.id('c908'), 'pc') || t.place(t.id('c908'), 'pa') || t.place(t.id('c908'), 'pb') || t.place(t.id('c908'), 'pd'), 'official/1233');

-- ================================================================ 7. the public results view: sporting identities only
select t.as_anon();
select t.expect_eq('anon reads the official podium of a public event with the team each fighter represented', t.podium(t.id('c901')), '1:Bob (Ankle Biters),2:Joe (Red Deer Reavers),3:John (Ankle Biters),4:Mike (Red Deer Reavers)');
select t.expect_eq('a team podium names the team as it was at the event', t.podium(t.id('c905')), '1:Ankle Biters,2:Red Deer Reavers');
select t.expect_eq('the historical roster of the winning team is readable', (select count(*) from public.entry_roster where entry_id = t.gu('e:t1')), 3::bigint);
select t.expect_eq('the view carries no account, contact or note column', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'competition_results' and (column_name ~ '(user|actor|email|phone|note|reason|waiver|medical|emergency)')), 0::bigint);
select t.expect_eq('a running competition has no public results yet', (select count(*) from public.competition_results where competition_id = t.id('c907')), 0::bigint);
select t.as_user(t.uid(3)); select t.fin('o01', 'a', 5, 1); select t.fz(t.id('c909')); select t.expect_eq('E2 (draft) finalizes for its own organizer', t.fzs(t.id('c909')), 'official');
select t.as_anon(); select t.expect_eq('... but a draft event''s results are not public', (select count(*) from public.competition_results where competition_id = t.id('c909')), 0::bigint);

-- ================================================================ 8. synthetic isolation
select t.as_user(t.uid(2));
select t.fin('s01', 'a', 5, 2);
select t.fz(t.id('c90a'));
select t.expect_eq('a fictional competition finalizes inside its fictional organization', t.fzs(t.id('c90a')) || '/' || t.place(t.id('c90a'), 's1'), 'official/1');
select t.as_anon();
select t.expect_eq('it ranks in its own organization', (select count(*) from public.ranking_fighters where scope = 'org_career' and organization_id = t.id('c9a2') and fighter_id = t.id('c9e0')), 1::bigint);
select t.expect_eq('... and never in the real all-time rankings', (select count(*) from public.ranking_fighters where scope = 'career' and fighter_id in (t.id('c9e0'), t.id('c9e4'))) + (select count(*) from public.ranking_team_disciplines where scope = 'career' and organization_id is null and team_id in (t.id('c9c1'), t.id('c9c2')) and category = 'longsword' and exists (select 1 from public.team_discipline_contributions c where c.scope = 'career' and c.fighter_id = t.id('c9e0'))), 0::bigint);
select t.expect_eq('the real all-time longsword men total for Ankle Biters is Bob 9 + John 3 (real results only)', (select points::int from public.ranking_team_disciplines where scope = 'career' and category = 'longsword' and gender = 'men' and team_id = t.id('c9c1')), 12);

-- ================================================================ 9. event closeout
select t.as_user(t.uid(4)); select t.expect_error('a scorekeeper cannot read the closeout preflight', format($$select public.event_close_preflight(%L)$$, t.id('c9e1')), '42501');
select t.expect_error('nor close the event', format($$select public.close_event(%L)$$, t.id('c9e1')), '42501');
select t.as_user(t.uid(2));
select t.expect_eq('every competition with a draw is official: the event is ready to close, with warnings only',
  (public.event_close_preflight(t.id('c9e1')) ->> 'ready') || '/' || (select string_agg(b ->> 'code', ',' order by b ->> 'code') from jsonb_array_elements(public.event_close_preflight(t.id('c9e1')) -> 'warnings') b), 'true/never_ran,no_represented_team,no_tier');
select t.expect_eq('the never-ran warning names Buckler; the represented-team warning counts Hal (Longsword women)', (select (w ->> 'text') like '%Buckler (men)%' from jsonb_array_elements(public.event_close_preflight(t.id('c9e1')) -> 'warnings') w where w ->> 'code' = 'never_ran')::text || '/' || (select w ->> 'count' from jsonb_array_elements(public.event_close_preflight(t.id('c9e1')) -> 'warnings') w where w ->> 'code' = 'no_represented_team'), 'true/1');
select t.expect_ok('reopen one competition again to prove closeout is blocked', format($$select public.reopen_competition(%L, 'checking the sheet once more')$$, t.id('c904')));
select t.expect_eq('closeout blocked: competitions_open names it', (public.event_close_preflight(t.id('c9e1')) ->> 'ready') || '/' || (select b ->> 'text' from jsonb_array_elements(public.event_close_preflight(t.id('c9e1')) -> 'blockers') b where b ->> 'code' = 'competitions_open'), 'false/1 competition is not official yet: Longsword (women).');
select t.expect_error('close_event refuses and says why', format($$select public.close_event(%L)$$, t.id('c9e1')), 'P0001');
select t.expect_eq('refinalized', public.finalize_competition(t.id('c904')) ->> 'status', 'official');
select t.cz(t.id('c9e1'), 'Great weekend');
select t.expect_eq('the organizer closes the event', t.czs(t.id('c9e1')) || '/' || (select closed_at is not null from public.events where id = t.id('c9e1')) || '/' || t.audits('event.closed', t.id('c9e1')), 'closed/true/1');
select t.cz(t.id('c9e1'));
select t.expect_eq('closing again: already_closed, no second audit', t.czs(t.id('c9e1')) || '/' || t.audits('event.closed', t.id('c9e1')), 'already_closed/1');
-- closed = history
select t.expect_error('no fight changes in a closed event (a new fight: the organizer has no insert right at all since Pack 24A0)', format($$insert into public.matches (competition_id, stage, round_label, position) values (%L, 'round_robin', 'Late', 11)$$, t.id('c907')), '42501');
select t.expect_error('no entrant changes', format($$update public.entries set status = 'withdrawn' where id = %L$$, t.gu('e:h1')), 'P0001');
select t.expect_error('no new competition', format($$insert into public.competitions (event_id, name, category, gender, structure) values (%L, 'Late', 'longsword', 'men', 'round_robin')$$, t.id('c9e1')), 'P0001');
select t.expect_error('no competition reopen while the event is closed', format($$select public.reopen_competition(%L, 'late')$$, t.id('c901')), 'P0001');
select t.expect_error('no match reopen either', format($$select public.reopen_match(%L, 'late')$$, t.gu('m:a06')), 'P0001');
select t.expect_error('no draw for the competition that never ran', format($$select public.build_schedule(%L, '[{"key":"x","stage":"round_robin","round_label":"R","position":0,"a":"%s","b":"%s"}]'::jsonb, 'new', null)$$, t.id('c907'), t.gu('e:h1'), t.gu('e:h2')), 'P0001');
select t.expect_error('no queue change', format($$select public.set_match_queue(%L, 'on_deck', null)$$, t.gu('m:a06')), 'P0001');
select t.expect_error('the event itself cannot be edited (season) while closed', format($$select public.set_event_season(%L, null)$$, t.id('c9e1')), 'P0001');
select t.expect_ok('the audited represented-team correction still works on history', format($$select public.set_represented_team(%L, %L, 'confirmed with Hal')$$, t.gu('e:fb'), t.id('c9c3')));
select t.expect_eq('the public podium is unchanged and readable', (select count(*) from public.competition_results r join public.competitions k on k.id = r.competition_id where k.event_id = t.id('c9e1')), 26::bigint);
-- reopen the event
select t.as_user(t.uid(4)); select t.expect_error('a scorekeeper cannot reopen a closed event', format($$select public.reopen_event(%L, 'reason')$$, t.id('c9e1')), '42501');
select t.as_user(t.uid(3)); select t.expect_error('the organizer of another event cannot', format($$select public.reopen_event(%L, 'reason')$$, t.id('c9e1')), '42501');
select t.as_user(t.uid(2));
select t.expect_error('a reason is required to reopen an event', format($$select public.reopen_event(%L, '')$$, t.id('c9e1')), '22023');
select t.expect_ok('the organizer reopens the event with a reason', format($$select public.reopen_event(%L, 'A result was contested after closing')$$, t.id('c9e1')));
select t.expect_eq('reopened: open again, audited', (select (closed_at is null) || '/' || (reopened_at is not null) from public.events where id = t.id('c9e1')) || '/' || (select details ->> 'reason' from public.audit_log where action = 'event.reopened' and subject = t.id('c9e1')::text), 'true/true/A result was contested after closing');
select t.expect_ok('now a competition can be reopened and corrected', format($$select public.reopen_competition(%L, 'contested')$$, t.id('c903')));
select t.expect_eq('... closeout is blocked again until it is official', (public.event_close_preflight(t.id('c9e1')) ->> 'ready'), 'false');
select t.fz(t.id('c903')); select t.cz(t.id('c9e1'));
select t.expect_eq('refinalized and closed again', t.fzs(t.id('c903')) || '/' || t.czs(t.id('c9e1')) || '/' || t.audits('event.closed', t.id('c9e1')), 'official/closed/2');
select t.as_user(t.uid(1)); select t.expect_ok('the platform owner can reopen a closed event too', format($$select public.reopen_event(%L, 'owner review')$$, t.id('c9e1')));
select t.as_user(t.uid(9)); select t.expect_eq('the organization administrator can close it', public.close_event(t.id('c9e1')) ->> 'status', 'closed');
select t.as_user(t.uid(3)); select t.expect_error('a draft event cannot be closed', format($$select public.close_event(%L)$$, t.id('c9e2')), 'P0001');

-- ================================================================ 10. legacy, realtime, publication
select t.as_admin();
select t.expect_eq('the legacy back-fill fills exactly the one legacy competition', private.backfill_official_metadata(), 1);
select t.expect_eq('legacy: a competition finished by the old finish got finalized_at from its own audit row and the recorded source', (select finalized_at::text || '/' || multiplier_source from public.competitions where id = t.id('c90b')), '2026-03-01 10:00:00+00/league_structure');
select t.expect_eq('competitions and events are in the realtime publication', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('competitions', 'events')), 2::bigint);
select t.expect_eq('privileged helpers are not executable by the API roles', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
  and p.proname in ('competition_blockers', 'competition_warnings', 'competition_placements', 'matches_lock_guard', 'entries_lock_guard', 'events_lock_guard', 'is_client_session', 'unlocked')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
