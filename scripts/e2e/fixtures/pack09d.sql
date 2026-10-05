-- Local fixture for scripts/e2e/pack09d-live.mjs (Pack 09D). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations). Everything here is fictional.
-- Users: b1 platform owner, b2 organizer (approved platform organizer), b4 scorekeeper, b6 captain of Kestrel Guard, b7 stranger, b9 admin of Parkland League,
--        b20 / b21 registrants (Sam: Saturday only; Gus: shares equipment).
-- Events:
--   Build Rumble   today and tomorrow, published, 2 fields, NO draws yet: Longsword (4 in, 1 withdrawn), Sword & Shield (Bob and John again, Sam only
--                  tomorrow, Gus shares equipment), Sabre (8: pools), Polearm women (nobody), Polearm men (1), 5v5 (two teams; Bob and Joe on rosters)
--   Short Rest Cup today, 1 field, a 3-person round robin with the first fight done: whatever runs next, someone just fought
--   Old Cup        a month ago, closed, official (Bob won Longsword) in Parkland League: archive and statistics journeys
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'b' || n || '@example.test' from generate_series(1, 9) n;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000b20', 'sam@example.test'), ('00000000-0000-0000-0000-000000000b21', 'gus@example.test');
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'owner'), ('00000000-0000-0000-0000-0000000000b2', 'organizer');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000b001', 'parkland-league', 'Parkland League', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000b9', 'admin');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b001', 'parkland-2026', 'Parkland 2026', current_date - 120, current_date + 120);
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-00000000b301', 'kestrel-guard', 'Kestrel Guard', 'approved', 'Red Deer', 'CA'), ('00000000-0000-0000-0000-00000000b302', 'iron-ferns', 'Iron Ferns', 'approved', 'Lacombe', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-0000000000b6', 'captain');

create function pg_temp.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000f9' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.eid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e9' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.mid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000fd9' || lpad(n::text, 2, '0'))::uuid $$;
insert into public.fighters (id, display_name, team_id) values
  (pg_temp.fid(1), 'Bob Brand', '00000000-0000-0000-0000-00000000b301'), (pg_temp.fid(2), 'John Quill', '00000000-0000-0000-0000-00000000b301'), (pg_temp.fid(3), 'Joe Marsh', '00000000-0000-0000-0000-00000000b302'),
  (pg_temp.fid(4), 'Mike Thorn', null), (pg_temp.fid(5), 'Steve Wold', null), (pg_temp.fid(6), 'Sam Saturday', null), (pg_temp.fid(7), 'Gus Gearshare', null),
  (pg_temp.fid(8), 'Sab One', null), (pg_temp.fid(9), 'Sab Two', null), (pg_temp.fid(10), 'Sab Three', null), (pg_temp.fid(11), 'Sab Four', null),
  (pg_temp.fid(12), 'Sab Five', null), (pg_temp.fid(13), 'Sab Six', null), (pg_temp.fid(14), 'Sab Seven', null), (pg_temp.fid(15), 'Sab Eight', null),
  (pg_temp.fid(16), 'Pole Lone', null), (pg_temp.fid(17), 'Kes Three', '00000000-0000-0000-0000-00000000b301'), (pg_temp.fid(18), 'Kes Four', '00000000-0000-0000-0000-00000000b301'),
  (pg_temp.fid(19), 'Fern One', '00000000-0000-0000-0000-00000000b302'), (pg_temp.fid(20), 'Fern Two', '00000000-0000-0000-0000-00000000b302'),
  (pg_temp.fid(21), 'Ann Ash', null), (pg_temp.fid(22), 'Bea Birch', null), (pg_temp.fid(23), 'Cat Cedar', null), (pg_temp.fid(24), 'Hal Holt', null), (pg_temp.fid(25), 'Ivo Ings', null);
insert into public.fighter_accounts (fighter_id, user_id) values (pg_temp.fid(6), '00000000-0000-0000-0000-000000000b20'), (pg_temp.fid(7), '00000000-0000-0000-0000-000000000b21');

-- ---------------------------------------------------------------- Build Rumble
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id, field_count) values
  ('00000000-0000-0000-0000-00000000b201', 'build-rumble', 'Build Rumble', 'published', 'tournament', current_date, current_date + 1, 'Test Ranch', 'America/Edmonton', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b101', 2);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-0000000000b2', 'organizer'), ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-0000000000b4', 'scorekeeper');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, status) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b201', 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'registration'),
  ('00000000-0000-0000-0000-00000000c902', '00000000-0000-0000-0000-00000000b201', 'Men Sword & Shield', 'sword_shield', 'men', 'Classic', 'round_robin', 2, 'registration'),
  ('00000000-0000-0000-0000-00000000c903', '00000000-0000-0000-0000-00000000b201', 'Men Sabre', 'sabre', 'men', 'Classic', 'round_robin', 3, 'registration'),
  ('00000000-0000-0000-0000-00000000c904', '00000000-0000-0000-0000-00000000b201', 'Women Polearm', 'polearm', 'women', 'Classic', 'round_robin', 4, 'registration'),
  ('00000000-0000-0000-0000-00000000c905', '00000000-0000-0000-0000-00000000b201', 'Men Polearm', 'polearm', 'men', 'Classic', 'round_robin', 5, 'registration'),
  ('00000000-0000-0000-0000-00000000c906', '00000000-0000-0000-0000-00000000b201', 'Men 5v5', '5v5', 'men', 'Classic', 'round_robin', 6, 'registration');
insert into public.entries (id, competition_id, fighter_id, status) values
  (pg_temp.eid(1), '00000000-0000-0000-0000-00000000c901', pg_temp.fid(1), 'registered'), (pg_temp.eid(2), '00000000-0000-0000-0000-00000000c901', pg_temp.fid(2), 'registered'),
  (pg_temp.eid(3), '00000000-0000-0000-0000-00000000c901', pg_temp.fid(3), 'registered'), (pg_temp.eid(4), '00000000-0000-0000-0000-00000000c901', pg_temp.fid(4), 'registered'),
  (pg_temp.eid(5), '00000000-0000-0000-0000-00000000c901', pg_temp.fid(5), 'withdrawn'),
  (pg_temp.eid(6), '00000000-0000-0000-0000-00000000c902', pg_temp.fid(1), 'registered'), (pg_temp.eid(7), '00000000-0000-0000-0000-00000000c902', pg_temp.fid(2), 'registered'),
  (pg_temp.eid(8), '00000000-0000-0000-0000-00000000c902', pg_temp.fid(6), 'registered'), (pg_temp.eid(9), '00000000-0000-0000-0000-00000000c902', pg_temp.fid(7), 'registered'),
  (pg_temp.eid(30), '00000000-0000-0000-0000-00000000c905', pg_temp.fid(16), 'registered');
insert into public.entries (id, competition_id, fighter_id, status) select pg_temp.eid(n + 2), '00000000-0000-0000-0000-00000000c903', pg_temp.fid(n), 'registered' from generate_series(8, 15) n;
insert into public.entries (id, competition_id, team_id, status) values
  (pg_temp.eid(40), '00000000-0000-0000-0000-00000000c906', '00000000-0000-0000-0000-00000000b301', 'registered'), (pg_temp.eid(41), '00000000-0000-0000-0000-00000000c906', '00000000-0000-0000-0000-00000000b302', 'registered');
insert into public.entry_fighters (entry_id, fighter_id, role) values
  (pg_temp.eid(40), pg_temp.fid(1), 'fighter'), (pg_temp.eid(40), pg_temp.fid(17), 'fighter'), (pg_temp.eid(40), pg_temp.fid(18), 'fighter'),
  (pg_temp.eid(41), pg_temp.fid(3), 'fighter'), (pg_temp.eid(41), pg_temp.fid(19), 'fighter'), (pg_temp.eid(41), pg_temp.fid(20), 'fighter');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000b401', '00000000-0000-0000-0000-00000000b201', 1, 'Waiver', 'Fictional waiver text for the local Pack 09D test.');
insert into public.registrations (event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, attend_dates, shares_equipment) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-000000000b20', pg_temp.fid(6), 'accepted', 'Sam Saturday', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000b401', 'Sam Saturday', array[current_date + 1], false),
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-000000000b21', pg_temp.fid(7), 'accepted', 'Gus Gearshare', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000b401', 'Gus Gearshare', '{}', true);

-- ---------------------------------------------------------------- Short Rest Cup
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, field_count) values
  ('00000000-0000-0000-0000-00000000b202', 'short-rest-cup', 'Short Rest Cup', 'published', 'tournament', current_date, current_date, 'Test Barn', 'America/Edmonton', '00000000-0000-0000-0000-00000000b001', 1);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-0000000000b2', 'organizer'), ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-0000000000b4', 'scorekeeper');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, status) values
  ('00000000-0000-0000-0000-00000000c911', '00000000-0000-0000-0000-00000000b202', 'Women Longsword', 'longsword', 'women', 'Classic', 'round_robin', 1, 'running');
insert into public.entries (id, competition_id, fighter_id, status) values
  (pg_temp.eid(51), '00000000-0000-0000-0000-00000000c911', pg_temp.fid(21), 'checked_in'), (pg_temp.eid(52), '00000000-0000-0000-0000-00000000c911', pg_temp.fid(22), 'checked_in'),
  (pg_temp.eid(53), '00000000-0000-0000-0000-00000000c911', pg_temp.fid(23), 'checked_in');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(1), '00000000-0000-0000-0000-00000000c911', 'round_robin', 'Round 1', 0, pg_temp.eid(51), pg_temp.eid(52), 'final', 'a', pg_temp.eid(51), 5, 2, now() - interval '5 minutes'),
  (pg_temp.mid(2), '00000000-0000-0000-0000-00000000c911', 'round_robin', 'Round 2', 0, pg_temp.eid(51), pg_temp.eid(53), 'scheduled', null, null, null, null, null),
  (pg_temp.mid(3), '00000000-0000-0000-0000-00000000c911', 'round_robin', 'Round 3', 0, pg_temp.eid(52), pg_temp.eid(53), 'scheduled', null, null, null, null, null);

-- ---------------------------------------------------------------- Old Cup: finished, official, closed (through the sanctioned functions, as the owner)
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000b203', 'old-cup', 'Old Cup', 'published', 'tournament', current_date - 30, current_date - 30, 'Old Hall', 'America/Edmonton', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b101');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000b203', '00000000-0000-0000-0000-0000000000b2', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, status) values
  ('00000000-0000-0000-0000-00000000c921', '00000000-0000-0000-0000-00000000b203', 'Men Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1, 'running');
insert into public.entries (id, competition_id, fighter_id, status) values
  (pg_temp.eid(61), '00000000-0000-0000-0000-00000000c921', pg_temp.fid(1), 'checked_in'), (pg_temp.eid(62), '00000000-0000-0000-0000-00000000c921', pg_temp.fid(24), 'checked_in'),
  (pg_temp.eid(63), '00000000-0000-0000-0000-00000000c921', pg_temp.fid(25), 'checked_in');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(11), '00000000-0000-0000-0000-00000000c921', 'round_robin', 'Round 1', 0, pg_temp.eid(61), pg_temp.eid(62), 'final', 'a', pg_temp.eid(61), 5, 1, now() - interval '30 days'),
  (pg_temp.mid(12), '00000000-0000-0000-0000-00000000c921', 'round_robin', 'Round 2', 0, pg_temp.eid(61), pg_temp.eid(63), 'final', 'a', pg_temp.eid(61), 5, 2, now() - interval '30 days'),
  (pg_temp.mid(13), '00000000-0000-0000-0000-00000000c921', 'round_robin', 'Round 3', 0, pg_temp.eid(62), pg_temp.eid(63), 'final', 'a', pg_temp.eid(62), 5, 3, now() - interval '30 days');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
-- Bob represented Kestrel Guard at Old Cup (recorded through the audited path, as an organizer would in Run › Teams represented)
select public.set_represented_team(pg_temp.eid(61), '00000000-0000-0000-0000-00000000b301', 'entry list says Kestrel Guard');
select public.finalize_competition('00000000-0000-0000-0000-00000000c921');
select public.close_event('00000000-0000-0000-0000-00000000b203', 'fixture');
select set_config('request.jwt.claim.sub', '', false);
