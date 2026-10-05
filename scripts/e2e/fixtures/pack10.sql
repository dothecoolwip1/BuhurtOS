-- Pack 10 fixture: a small sporting history with every case a career profile has to get right. LOCAL THROWAWAY DATABASE ONLY, loaded after the
-- migrations by supabase/tests/pack10_gate.sql (rolled back) and by scripts/e2e/pack10-live.sh (the browser journeys). Everything here is fictional.
--
-- People:  u1 platform owner, u2 organizer of every event, u6 captain of Kestrel Guard, u7 stranger, u9 administrator of Parkland League
-- Teams:   Kestrel Guard (KG), Iron Ferns (IF), Mire Wolves (MW); Phantom Test Team (PT, tagged fictional)
-- Fighters (fid): 1 Bob Brand (KG today; represented IF in 2025: a transfer), 2 John Quill (KG; Bob's usual opponent), 3 Mike Thorn (KG, set INACTIVE),
--   4 Hal Holt (KG, HIDDEN from the public roster), 5 Una Unclaimed (no team, no account), 6 Joe Marsh (IF), 7 Steve Wold (no team; disqualified once),
--   8 Phantom Pete (fictional), 9/10 Kes Three / Kes Four (KG), 11/12 Fern One / Fern Two (IF), 13/14/15 Wolf One / Two / Three (MW), 16 Alex Ash (no team)
-- Events (eid), all Parkland League, organizer u2, official through finalize_competition and closed:
--   1 Autumn Clash 2025   (season 2025)  Longsword (Bob gold, John silver, Mike bronze, Joe 4th), Polearm (Joe gold, Bob silver with a WALKOVER win, Una bronze,
--                                        Steve 4th), 5v5 (IF gold with Bob and Joe, KG silver with John and hidden Hal, MW bronze). Bob represented IF.
--   2 Winter Melee 2026   (season 2026)  ARCHIVED. Sword & Shield (John gold, Bob silver after a DRAW with John, Steve bronze), 3v3 (KG gold with Bob, MW silver)
--   3 Spring Open 2026    (season 2026)  EXCLUDED from official statistics. Longsword (Bob gold, Alex silver, Steve bronze)
--   4 Summer Duels 2026   (season 2026)  Longsword elimination (John gold over Bob in the final, Joe bronze), Polearm (Bob gold, Alex silver, Una bronze,
--                                        Steve DISQUALIFIED: placed last), 5v5 (KG gold with Bob and John, IF silver, MW bronze)
--   5 Phantom Cup         FICTIONAL event, no organization: Longsword (Phantom Pete beats Bob). Never official.
--   6 Harvest Rumble      upcoming, Bob entered: no statistics yet.
--   7 Secret Draft        a DRAFT event with a final fight of Bob's: visible to its organizer only, never to the public.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'a' || n || '@example.test' from generate_series(1, 9) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner'), ('00000000-0000-0000-0000-0000000000a2', 'organizer');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000a001', 'parkland-league', 'Parkland League', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000a9', 'admin');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000a125', '00000000-0000-0000-0000-00000000a001', 'parkland-2025', 'Parkland 2025', '2025-01-01', '2025-12-31'),
  ('00000000-0000-0000-0000-00000000a126', '00000000-0000-0000-0000-00000000a001', 'parkland-2026', 'Parkland 2026', '2026-01-01', '2026-12-31');

create function pg_temp.p10t(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000a10' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.p10f(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000a1f' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.p10e(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000a1e' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.p10c(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000a1c' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.p10x(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-000000a1ee' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.p10m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-000000a1dd' || lpad(n::text, 2, '0'))::uuid $$;

insert into public.teams (id, slug, name, status, city, region, country, founded_year) values
  (pg_temp.p10t(1), 'kestrel-guard', 'Kestrel Guard', 'approved', 'Red Deer', 'Alberta', 'CA', 2019),
  (pg_temp.p10t(2), 'iron-ferns', 'Iron Ferns', 'approved', 'Lacombe', 'Alberta', 'CA', null),
  (pg_temp.p10t(3), 'mire-wolves', 'Mire Wolves', 'approved', 'Olds', 'Alberta', 'CA', null),
  (pg_temp.p10t(4), 'phantom-test-team', 'Phantom Test Team', 'approved', 'Nowhere', null, 'CA', null);
insert into public.team_roles (team_id, user_id, role) values (pg_temp.p10t(1), '00000000-0000-0000-0000-0000000000a6', 'captain');
insert into public.team_affiliations (team_id, organization_id, relation) values (pg_temp.p10t(1), '00000000-0000-0000-0000-00000000a001', 'member');

insert into public.fighters (id, display_name, team_id, gender, city, region, disciplines) values
  (pg_temp.p10f(1), 'Bob Brand', pg_temp.p10t(1), 'male', 'Red Deer', 'Alberta', array['longsword', 'polearm', 'sword_shield']),
  (pg_temp.p10f(2), 'John Quill', pg_temp.p10t(1), 'male', null, null, array['longsword']),
  (pg_temp.p10f(3), 'Mike Thorn', pg_temp.p10t(1), 'male', null, null, '{}'),
  (pg_temp.p10f(4), 'Hal Holt', pg_temp.p10t(1), 'male', null, null, '{}'),
  (pg_temp.p10f(5), 'Una Unclaimed', null, 'female', null, null, '{}'),
  (pg_temp.p10f(6), 'Joe Marsh', pg_temp.p10t(2), 'male', null, null, '{}'),
  (pg_temp.p10f(7), 'Steve Wold', null, 'male', null, null, '{}'),
  (pg_temp.p10f(8), 'Phantom Pete', pg_temp.p10t(4), 'male', null, null, '{}'),
  (pg_temp.p10f(9), 'Kes Three', pg_temp.p10t(1), 'male', null, null, '{}'), (pg_temp.p10f(10), 'Kes Four', pg_temp.p10t(1), 'male', null, null, '{}'),
  (pg_temp.p10f(11), 'Fern One', pg_temp.p10t(2), 'male', null, null, '{}'), (pg_temp.p10f(12), 'Fern Two', pg_temp.p10t(2), 'male', null, null, '{}'),
  (pg_temp.p10f(13), 'Wolf One', pg_temp.p10t(3), 'male', null, null, '{}'), (pg_temp.p10f(14), 'Wolf Two', pg_temp.p10t(3), 'male', null, null, '{}'),
  (pg_temp.p10f(15), 'Wolf Three', pg_temp.p10t(3), 'male', null, null, '{}'),
  (pg_temp.p10f(16), 'Alex Ash', null, 'other', null, null, '{}');
-- Bob has an account (u3); Una and the rest have none
insert into public.fighter_accounts (fighter_id, user_id) values (pg_temp.p10f(1), '00000000-0000-0000-0000-0000000000a3');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values (pg_temp.p10f(4), pg_temp.p10t(1), 'fighter', '2024-03-01');

-- fictional tagging: the Phantom event, team and fighter
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000a1050', 'submitted', 'Pack 10 fictional dataset', 'test', true);

-- ---------------------------------------------------------------- events, competitions, entries, fights
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id) values
  (pg_temp.p10e(1), 'autumn-clash-2025', 'Autumn Clash 2025', 'published', 'tournament', '2025-09-13', '2025-09-14', 'Old Hall', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a125'),
  (pg_temp.p10e(2), 'winter-melee-2026', 'Winter Melee 2026', 'published', 'tournament', '2026-02-21', '2026-02-21', 'Ice Barn', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a126'),
  (pg_temp.p10e(3), 'spring-open-2026', 'Spring Open 2026', 'published', 'tournament', '2026-05-10', '2026-05-10', 'Field House', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a126'),
  (pg_temp.p10e(4), 'summer-duels-2026', 'Summer Duels 2026', 'published', 'tournament', '2026-07-18', '2026-07-19', 'River Park', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a126'),
  (pg_temp.p10e(5), 'phantom-cup-test', 'Phantom Cup', 'published', 'tournament', '2026-08-02', '2026-08-02', 'Nowhere', 'America/Edmonton', null, null),
  (pg_temp.p10e(6), 'harvest-rumble', 'Harvest Rumble', 'published', 'tournament', current_date + 30, current_date + 31, 'Big Ranch', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a126'),
  (pg_temp.p10e(7), 'secret-draft', 'Secret Draft', 'draft', 'tournament', current_date, current_date, 'Nowhere', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a126');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values
  ('00000000-0000-0000-0000-0000000a1050', 'event', pg_temp.p10e(5), 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-0000000a1050', 'team', pg_temp.p10t(4), 'unverified', 'fictional'),
  ('00000000-0000-0000-0000-0000000a1050', 'fighter', pg_temp.p10f(8), 'unverified', 'fictional');
insert into public.event_staff (event_id, user_id, role) select pg_temp.p10e(n), '00000000-0000-0000-0000-0000000000a2', 'organizer' from generate_series(1, 7) n;

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, status) values
  (pg_temp.p10c(11), pg_temp.p10e(1), 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'running'),
  (pg_temp.p10c(12), pg_temp.p10e(1), 'Men Polearm', 'polearm', 'men', 'Classic', 'round_robin', 2, 'running'),
  (pg_temp.p10c(13), pg_temp.p10e(1), 'Men 5v5', '5v5', 'men', 'Classic', 'round_robin', 3, 'running'),
  (pg_temp.p10c(21), pg_temp.p10e(2), 'Men Sword & Shield', 'sword_shield', 'men', 'Classic', 'round_robin', 1, 'running'),
  (pg_temp.p10c(22), pg_temp.p10e(2), 'Men 3v3', '3v3', 'men', 'Classic', 'round_robin', 2, 'running'),
  (pg_temp.p10c(31), pg_temp.p10e(3), 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'running'),
  (pg_temp.p10c(41), pg_temp.p10e(4), 'Men Longsword', 'longsword', 'men', 'Regional', 'elimination', 1, 'running'),
  (pg_temp.p10c(42), pg_temp.p10e(4), 'Men Polearm', 'polearm', 'men', 'Regional', 'round_robin', 2, 'running'),
  (pg_temp.p10c(43), pg_temp.p10e(4), 'Men 5v5', '5v5', 'men', 'Regional', 'round_robin', 3, 'running'),
  (pg_temp.p10c(51), pg_temp.p10e(5), 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'running'),
  (pg_temp.p10c(61), pg_temp.p10e(6), 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'registration'),
  (pg_temp.p10c(71), pg_temp.p10e(7), 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'running');

-- individual entries: p10x(competition two digits * ? ) -> explicit numbers
insert into public.entries (id, competition_id, fighter_id, status) values
  (pg_temp.p10x(1), pg_temp.p10c(11), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(2), pg_temp.p10c(11), pg_temp.p10f(2), 'checked_in'),
  (pg_temp.p10x(3), pg_temp.p10c(11), pg_temp.p10f(3), 'checked_in'), (pg_temp.p10x(4), pg_temp.p10c(11), pg_temp.p10f(6), 'checked_in'),
  (pg_temp.p10x(5), pg_temp.p10c(12), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(6), pg_temp.p10c(12), pg_temp.p10f(6), 'checked_in'),
  (pg_temp.p10x(7), pg_temp.p10c(12), pg_temp.p10f(7), 'checked_in'), (pg_temp.p10x(8), pg_temp.p10c(12), pg_temp.p10f(5), 'checked_in'),
  (pg_temp.p10x(21), pg_temp.p10c(21), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(22), pg_temp.p10c(21), pg_temp.p10f(2), 'checked_in'),
  (pg_temp.p10x(23), pg_temp.p10c(21), pg_temp.p10f(7), 'checked_in'),
  (pg_temp.p10x(31), pg_temp.p10c(31), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(32), pg_temp.p10c(31), pg_temp.p10f(16), 'checked_in'),
  (pg_temp.p10x(33), pg_temp.p10c(31), pg_temp.p10f(7), 'checked_in'),
  (pg_temp.p10x(41), pg_temp.p10c(41), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(42), pg_temp.p10c(41), pg_temp.p10f(2), 'checked_in'),
  (pg_temp.p10x(43), pg_temp.p10c(41), pg_temp.p10f(6), 'checked_in'), (pg_temp.p10x(44), pg_temp.p10c(41), pg_temp.p10f(7), 'checked_in'),
  (pg_temp.p10x(45), pg_temp.p10c(42), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(46), pg_temp.p10c(42), pg_temp.p10f(7), 'disqualified'),
  (pg_temp.p10x(47), pg_temp.p10c(42), pg_temp.p10f(16), 'checked_in'), (pg_temp.p10x(48), pg_temp.p10c(42), pg_temp.p10f(5), 'checked_in'),
  (pg_temp.p10x(51), pg_temp.p10c(51), pg_temp.p10f(8), 'checked_in'), (pg_temp.p10x(52), pg_temp.p10c(51), pg_temp.p10f(1), 'checked_in'),
  (pg_temp.p10x(61), pg_temp.p10c(61), pg_temp.p10f(1), 'registered'),
  (pg_temp.p10x(71), pg_temp.p10c(71), pg_temp.p10f(1), 'checked_in'), (pg_temp.p10x(72), pg_temp.p10c(71), pg_temp.p10f(2), 'checked_in');
-- team entries and the rosters that actually fought
insert into public.entries (id, competition_id, team_id, status) values
  (pg_temp.p10x(11), pg_temp.p10c(13), pg_temp.p10t(2), 'checked_in'), (pg_temp.p10x(12), pg_temp.p10c(13), pg_temp.p10t(1), 'checked_in'), (pg_temp.p10x(13), pg_temp.p10c(13), pg_temp.p10t(3), 'checked_in'),
  (pg_temp.p10x(24), pg_temp.p10c(22), pg_temp.p10t(1), 'checked_in'), (pg_temp.p10x(25), pg_temp.p10c(22), pg_temp.p10t(3), 'checked_in'),
  (pg_temp.p10x(49), pg_temp.p10c(43), pg_temp.p10t(1), 'checked_in'), (pg_temp.p10x(50), pg_temp.p10c(43), pg_temp.p10t(2), 'checked_in'), (pg_temp.p10x(53), pg_temp.p10c(43), pg_temp.p10t(3), 'checked_in');
insert into public.entry_fighters (entry_id, fighter_id, role) values
  (pg_temp.p10x(11), pg_temp.p10f(1), 'fighter'), (pg_temp.p10x(11), pg_temp.p10f(6), 'fighter'), (pg_temp.p10x(11), pg_temp.p10f(11), 'fighter'), (pg_temp.p10x(11), pg_temp.p10f(12), 'fighter'),
  (pg_temp.p10x(12), pg_temp.p10f(2), 'fighter'), (pg_temp.p10x(12), pg_temp.p10f(4), 'fighter'), (pg_temp.p10x(12), pg_temp.p10f(9), 'fighter'), (pg_temp.p10x(12), pg_temp.p10f(10), 'fighter'),
  (pg_temp.p10x(13), pg_temp.p10f(13), 'fighter'), (pg_temp.p10x(13), pg_temp.p10f(14), 'fighter'), (pg_temp.p10x(13), pg_temp.p10f(15), 'fighter'),
  (pg_temp.p10x(24), pg_temp.p10f(1), 'fighter'), (pg_temp.p10x(24), pg_temp.p10f(2), 'fighter'), (pg_temp.p10x(24), pg_temp.p10f(9), 'fighter'),
  (pg_temp.p10x(25), pg_temp.p10f(13), 'fighter'), (pg_temp.p10x(25), pg_temp.p10f(14), 'fighter'), (pg_temp.p10x(25), pg_temp.p10f(15), 'fighter'),
  (pg_temp.p10x(49), pg_temp.p10f(1), 'fighter'), (pg_temp.p10x(49), pg_temp.p10f(2), 'fighter'), (pg_temp.p10x(49), pg_temp.p10f(9), 'fighter'), (pg_temp.p10x(49), pg_temp.p10f(10), 'fighter'),
  (pg_temp.p10x(50), pg_temp.p10f(6), 'fighter'), (pg_temp.p10x(50), pg_temp.p10f(11), 'fighter'), (pg_temp.p10x(50), pg_temp.p10f(12), 'fighter'),
  (pg_temp.p10x(53), pg_temp.p10f(13), 'fighter'), (pg_temp.p10x(53), pg_temp.p10f(14), 'fighter'), (pg_temp.p10x(53), pg_temp.p10f(15), 'fighter');

-- fights (final, scores, deterministic finalized_at so the order of a day's fights is known)
create function pg_temp.p10fight(n int, comp int, stage text, label text, pos int, a int, b int, res text, sa int, sb int, at timestamptz, detail jsonb default '{}'::jsonb) returns void
language sql as $$
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at, detail)
  values (pg_temp.p10m(n), pg_temp.p10c(comp), stage, label, pos, pg_temp.p10x(a), pg_temp.p10x(b), 'final', res,
          case res when 'a' then pg_temp.p10x(a) when 'b' then pg_temp.p10x(b) end, sa, sb, at, detail)
$$;
-- Autumn Clash 2025: Longsword RR (1 Bob, 2 John, 3 Mike, 4 Joe)
select pg_temp.p10fight(1, 11, 'round_robin', 'Round 1', 0, 1, 2, 'a', 5, 3, '2025-09-13 17:00Z');
select pg_temp.p10fight(2, 11, 'round_robin', 'Round 1', 1, 3, 4, 'a', 5, 4, '2025-09-13 17:10Z');
select pg_temp.p10fight(3, 11, 'round_robin', 'Round 2', 0, 1, 3, 'a', 5, 1, '2025-09-13 17:20Z');
select pg_temp.p10fight(4, 11, 'round_robin', 'Round 2', 1, 2, 4, 'a', 5, 2, '2025-09-13 17:30Z');
select pg_temp.p10fight(5, 11, 'round_robin', 'Round 3', 0, 1, 4, 'a', 5, 0, '2025-09-13 17:40Z');
select pg_temp.p10fight(6, 11, 'round_robin', 'Round 3', 1, 2, 3, 'a', 5, 2, '2025-09-13 17:50Z');
-- Polearm RR (5 Bob, 6 Joe, 7 Steve, 8 Una): Bob beats Steve by walkover, loses to Joe
select pg_temp.p10fight(7, 12, 'round_robin', 'Round 1', 0, 5, 7, 'a', 0, 0, '2025-09-14 16:00Z', '{"walkover": true, "reason": "Steve did not appear"}');
select pg_temp.p10fight(8, 12, 'round_robin', 'Round 1', 1, 6, 8, 'a', 5, 2, '2025-09-14 16:10Z');
select pg_temp.p10fight(9, 12, 'round_robin', 'Round 2', 0, 6, 5, 'a', 5, 4, '2025-09-14 16:20Z');
select pg_temp.p10fight(10, 12, 'round_robin', 'Round 2', 1, 8, 7, 'a', 5, 3, '2025-09-14 16:30Z');
select pg_temp.p10fight(11, 12, 'round_robin', 'Round 3', 0, 5, 8, 'a', 5, 1, '2025-09-14 16:40Z');
select pg_temp.p10fight(12, 12, 'round_robin', 'Round 3', 1, 6, 7, 'a', 5, 0, '2025-09-14 16:50Z');
-- 5v5 RR (11 IF, 12 KG, 13 MW)
select pg_temp.p10fight(13, 13, 'round_robin', 'Round 1', 0, 11, 12, 'a', 3, 1, '2025-09-14 19:00Z', '{"roundsWon": {"a": 3, "b": 1}}');
select pg_temp.p10fight(14, 13, 'round_robin', 'Round 2', 0, 12, 13, 'a', 3, 2, '2025-09-14 19:20Z', '{"roundsWon": {"a": 3, "b": 2}}');
select pg_temp.p10fight(15, 13, 'round_robin', 'Round 3', 0, 11, 13, 'a', 3, 0, '2025-09-14 19:40Z', '{"roundsWon": {"a": 3, "b": 0}}');
-- Winter Melee 2026: Sword & Shield RR (21 Bob, 22 John, 23 Steve): Bob and John DRAW
select pg_temp.p10fight(21, 21, 'round_robin', 'Round 1', 0, 21, 22, 'draw', 3, 3, '2026-02-21 17:00Z');
select pg_temp.p10fight(22, 21, 'round_robin', 'Round 2', 0, 22, 23, 'a', 5, 1, '2026-02-21 17:10Z');
select pg_temp.p10fight(23, 21, 'round_robin', 'Round 3', 0, 21, 23, 'a', 5, 2, '2026-02-21 17:20Z');
-- 3v3 (24 KG, 25 MW)
select pg_temp.p10fight(24, 22, 'round_robin', 'Round 1', 0, 24, 25, 'a', 2, 0, '2026-02-21 19:00Z', '{"roundsWon": {"a": 2, "b": 0}}');
-- Spring Open 2026 (will be excluded): Longsword RR (31 Bob, 32 Alex, 33 Steve)
select pg_temp.p10fight(31, 31, 'round_robin', 'Round 1', 0, 31, 32, 'a', 5, 2, '2026-05-10 17:00Z');
select pg_temp.p10fight(32, 31, 'round_robin', 'Round 2', 0, 31, 33, 'a', 5, 1, '2026-05-10 17:10Z');
select pg_temp.p10fight(33, 31, 'round_robin', 'Round 3', 0, 32, 33, 'a', 5, 4, '2026-05-10 17:20Z');
-- Summer Duels 2026: Longsword elimination (41 Bob, 42 John, 43 Joe, 44 Steve): semis, third place, final
insert into public.matches (id, competition_id, stage, round_label, position, queue_state) values (pg_temp.p10m(43), pg_temp.p10c(41), 'final', 'Final', 0, 'scheduled');
insert into public.matches (id, competition_id, stage, round_label, position, queue_state) values (pg_temp.p10m(44), pg_temp.p10c(41), 'third_place', 'Third place', 0, 'scheduled');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at, next_match_id, next_slot) values
  (pg_temp.p10m(41), pg_temp.p10c(41), 'elimination', 'Semifinal', 0, pg_temp.p10x(41), pg_temp.p10x(43), 'final', 'a', pg_temp.p10x(41), 5, 2, '2026-07-19 16:00Z', pg_temp.p10m(43), 'a'),
  (pg_temp.p10m(42), pg_temp.p10c(41), 'elimination', 'Semifinal', 1, pg_temp.p10x(42), pg_temp.p10x(44), 'final', 'a', pg_temp.p10x(42), 5, 0, '2026-07-19 16:10Z', pg_temp.p10m(43), 'b');
update public.matches set entry_a = pg_temp.p10x(43), entry_b = pg_temp.p10x(44), queue_state = 'final', result = 'a', winner_entry_id = pg_temp.p10x(43), score_a = 5, score_b = 4, finalized_at = '2026-07-19 17:00Z' where id = pg_temp.p10m(44);
update public.matches set entry_a = pg_temp.p10x(41), entry_b = pg_temp.p10x(42), queue_state = 'final', result = 'b', winner_entry_id = pg_temp.p10x(42), score_a = 4, score_b = 5, finalized_at = '2026-07-19 17:30Z' where id = pg_temp.p10m(43);
-- Polearm RR (45 Bob, 46 Steve DQ, 47 Alex, 48 Una)
select pg_temp.p10fight(45, 42, 'round_robin', 'Round 1', 0, 45, 47, 'a', 5, 1, '2026-07-18 16:00Z');
select pg_temp.p10fight(46, 42, 'round_robin', 'Round 1', 1, 46, 48, 'a', 5, 2, '2026-07-18 16:10Z');
select pg_temp.p10fight(47, 42, 'round_robin', 'Round 2', 0, 45, 46, 'a', 5, 3, '2026-07-18 16:20Z');
select pg_temp.p10fight(48, 42, 'round_robin', 'Round 2', 1, 47, 48, 'a', 5, 4, '2026-07-18 16:30Z');
select pg_temp.p10fight(49, 42, 'round_robin', 'Round 3', 0, 45, 48, 'a', 5, 0, '2026-07-18 16:40Z');
select pg_temp.p10fight(50, 42, 'round_robin', 'Round 3', 1, 46, 47, 'a', 5, 2, '2026-07-18 16:50Z');
-- 5v5 RR (49 KG, 50 IF, 53 MW)
select pg_temp.p10fight(51, 43, 'round_robin', 'Round 1', 0, 49, 50, 'a', 3, 2, '2026-07-19 15:00Z', '{"roundsWon": {"a": 3, "b": 2}}');
select pg_temp.p10fight(52, 43, 'round_robin', 'Round 2', 0, 49, 53, 'a', 3, 1, '2026-07-19 15:20Z', '{"roundsWon": {"a": 3, "b": 1}}');
select pg_temp.p10fight(53, 43, 'round_robin', 'Round 3', 0, 50, 53, 'a', 3, 1, '2026-07-19 15:40Z', '{"roundsWon": {"a": 3, "b": 1}}');
-- Phantom Cup (fictional): Pete beats Bob
select pg_temp.p10fight(61, 51, 'round_robin', 'Round 1', 0, 51, 52, 'a', 5, 0, '2026-08-02 17:00Z');
-- Secret Draft: a final fight the public must never see
select pg_temp.p10fight(71, 71, 'round_robin', 'Round 1', 0, 71, 72, 'a', 5, 0, now() - interval '1 hour');

-- ---------------------------------------------------------------- official results, represented teams, lifecycle (through the sanctioned functions, as the owner)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
-- Bob represented Iron Ferns in 2025 (a transfer: his team today is Kestrel Guard); John, Mike represented Kestrel Guard; Joe Iron Ferns
select public.set_represented_team(pg_temp.p10x(1), pg_temp.p10t(2), 'entry list says Iron Ferns');
select public.set_represented_team(pg_temp.p10x(5), pg_temp.p10t(2), 'entry list says Iron Ferns');
select public.set_represented_team(pg_temp.p10x(2), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(3), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(4), pg_temp.p10t(2), 'entry list says Iron Ferns');
select public.set_represented_team(pg_temp.p10x(6), pg_temp.p10t(2), 'entry list says Iron Ferns');
select public.set_represented_team(pg_temp.p10x(21), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(22), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(31), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(41), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(42), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(43), pg_temp.p10t(2), 'entry list says Iron Ferns');
select public.set_represented_team(pg_temp.p10x(45), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.set_represented_team(pg_temp.p10x(52), pg_temp.p10t(1), 'entry list says Kestrel Guard');
select public.finalize_competition(pg_temp.p10c(n)) from unnest(array[11, 12, 13, 21, 22, 31, 41, 42, 43, 51, 71]) n;
select public.close_event(pg_temp.p10e(n), 'fixture') from unnest(array[1, 2, 3, 4, 5]) n;
select public.archive_event(pg_temp.p10e(2));
select public.exclude_event_from_stats(pg_temp.p10e(3), 'Pack 10 fixture: an unsanctioned practice event recorded by mistake');
select public.set_fighter_active(pg_temp.p10f(3), false, 'took a break from the sport');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false);
select public.set_roster_visibility(pg_temp.p10t(1), pg_temp.p10f(4), false);
select set_config('request.jwt.claim.sub', '', false);
