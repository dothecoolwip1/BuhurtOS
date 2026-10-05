-- Local fixture for scripts/e2e/finalize-live.mjs (Pack 09C). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- "Closeout Open", running today, in a real organization and season. Users: a1 platform owner, a2 organizer, a4 scorekeeper, a7 stranger.
-- Competitions:
--   Longsword (men)        round robin, 4 fighters: 5 of 6 fights final, the last one ACTIVE on Field 1 (the journey finishes it, then finalizes)
--   Sword and shield (men) round robin, 3 fighters in a cycle (every fight final): a medal tie the organizer must decide
--   Polearm (men)          bracket of 4 with a third-place match, everything final: ready
--   5v5 (men)              one final between two teams with rosters, final: ready
--   Buckler (men)          entries, no draw: never ran
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000a001', 'prairie-league', 'Prairie League', 'regional');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a001', 'prairie-2026', 'Prairie 2026', current_date - 120, current_date + 120);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000a201', 'closeout-open', 'Closeout Open', 'published', 'tournament', current_date, current_date + 1, 'Test Arena', 'America/Edmonton', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a101');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2', 'organizer'), ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-00000000a301', 'ankle-biters', 'Ankle Biters', 'approved', 'Red Deer', 'CA'), ('00000000-0000-0000-0000-00000000a302', 'red-deer-reavers', 'Red Deer Reavers', 'approved', 'Red Deer', 'CA'),
  ('00000000-0000-0000-0000-00000000a303', 'northern-ravens', 'Northern Ravens', 'approved', 'Edmonton', 'CA');
create function pg_temp.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000f4' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.eid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e5' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.mid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000fd6' || lpad(n::text, 2, '0'))::uuid $$;
insert into public.fighters (id, display_name, team_id) values
  (pg_temp.fid(1), 'Bob Stone', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(2), 'John Oakley', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(3), 'Joe Rhodes', '00000000-0000-0000-0000-00000000a302'), (pg_temp.fid(4), 'Mike Voss', null),
  (pg_temp.fid(5), 'Ann Hale', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(6), 'Bea Crow', '00000000-0000-0000-0000-00000000a302'), (pg_temp.fid(7), 'Cat Fell', '00000000-0000-0000-0000-00000000a303'),
  (pg_temp.fid(8), 'Dan Morrow', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(9), 'Eli Penn', '00000000-0000-0000-0000-00000000a302'), (pg_temp.fid(10), 'Fay Wick', '00000000-0000-0000-0000-00000000a303'), (pg_temp.fid(11), 'Gus Arden-Whitfield-Montgomery', '00000000-0000-0000-0000-00000000a303'),
  (pg_temp.fid(12), 'Lee Ashby', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(13), 'Max Tarn', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(14), 'Ned Rook', '00000000-0000-0000-0000-00000000a301'),
  (pg_temp.fid(15), 'Oli Robson', '00000000-0000-0000-0000-00000000a302'), (pg_temp.fid(16), 'Pat Robson', '00000000-0000-0000-0000-00000000a302'), (pg_temp.fid(17), 'Quin Reed', '00000000-0000-0000-0000-00000000a302'),
  (pg_temp.fid(18), 'Zed Vale', '00000000-0000-0000-0000-00000000a301'), (pg_temp.fid(19), 'Abe Kerr', '00000000-0000-0000-0000-00000000a302');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000a201', 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1, 2),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000a201', 'Sword and shield (men)', 'sword_shield', 'men', 'Classic', 'round_robin', 2, 2),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000a201', 'Polearm (men)', 'polearm', 'men', 'Classic', 'elimination', 3, 2),
  ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000a201', '5v5 (men)', '5v5', 'men', 'Classic', 'elimination', 4, null),
  ('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000a201', 'Buckler (men)', 'buckler', 'men', 'Classic', 'round_robin', 5, 2);
-- entries (represented teams come from the fighters' home teams at entry; Mike has none)
insert into public.entries (id, competition_id, fighter_id, status) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000c001', pg_temp.fid(n), 'checked_in' from generate_series(1, 4) n;
insert into public.entries (id, competition_id, fighter_id, status) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000c002', pg_temp.fid(n), 'checked_in' from generate_series(5, 7) n;
insert into public.entries (id, competition_id, fighter_id, status) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000c003', pg_temp.fid(n), 'checked_in' from generate_series(8, 11) n;
insert into public.entries (id, competition_id, team_id, status) values (pg_temp.eid(20), '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000a301', 'checked_in'), (pg_temp.eid(21), '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000a302', 'checked_in');
insert into public.entries (id, competition_id, fighter_id, status) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000c005', pg_temp.fid(n), 'checked_in' from generate_series(18, 19) n;
-- rosters (loader role: the entry_fighters trigger fills competition_id)
insert into public.entry_fighters (entry_id, fighter_id, role) select pg_temp.eid(20), pg_temp.fid(n), 'fighter' from generate_series(12, 14) n;
insert into public.entry_fighters (entry_id, fighter_id, role) select pg_temp.eid(21), pg_temp.fid(n), 'fighter' from generate_series(15, 17) n;
-- Longsword: Bob beats all, John beats Joe and Mike, Joe beats Mike; the last fight (John vs Joe) is ACTIVE on Field 1
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(1), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 1', 0, pg_temp.eid(1), pg_temp.eid(2), 'final', 'a', pg_temp.eid(1), 5, 2, now() - interval '3 hours'),
  (pg_temp.mid(2), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 1', 1, pg_temp.eid(3), pg_temp.eid(4), 'final', 'a', pg_temp.eid(3), 5, 3, now() - interval '3 hours'),
  (pg_temp.mid(3), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 2', 0, pg_temp.eid(1), pg_temp.eid(3), 'final', 'a', pg_temp.eid(1), 5, 1, now() - interval '2 hours'),
  (pg_temp.mid(4), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 2', 1, pg_temp.eid(2), pg_temp.eid(4), 'final', 'a', pg_temp.eid(2), 5, 4, now() - interval '2 hours'),
  (pg_temp.mid(5), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 3', 0, pg_temp.eid(1), pg_temp.eid(4), 'final', 'a', pg_temp.eid(1), 5, 0, now() - interval '1 hour'),
  (pg_temp.mid(6), '00000000-0000-0000-0000-00000000c001', 'round_robin', 'Round 3', 1, pg_temp.eid(2), pg_temp.eid(3), 'active', null, null, null, null, null);
-- Sword and shield: Ann > Bea > Cat > Ann, every score 5-3 (a three-way tie for the medals)
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(7), '00000000-0000-0000-0000-00000000c002', 'round_robin', 'Round 1', 0, pg_temp.eid(5), pg_temp.eid(6), 'final', 'a', pg_temp.eid(5), 5, 3, now() - interval '3 hours'),
  (pg_temp.mid(8), '00000000-0000-0000-0000-00000000c002', 'round_robin', 'Round 2', 0, pg_temp.eid(6), pg_temp.eid(7), 'final', 'a', pg_temp.eid(6), 5, 3, now() - interval '2 hours'),
  (pg_temp.mid(9), '00000000-0000-0000-0000-00000000c002', 'round_robin', 'Round 3', 0, pg_temp.eid(7), pg_temp.eid(5), 'final', 'a', pg_temp.eid(7), 5, 3, now() - interval '1 hour');
-- Polearm bracket: semis Dan > Eli, Fay > Gus; final Dan > Fay; third place Gus > Eli
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(12), '00000000-0000-0000-0000-00000000c003', 'final', 'Final', 0, pg_temp.eid(8), pg_temp.eid(10), 'final', 'a', pg_temp.eid(8), 5, 4, now() - interval '30 minutes'),
  (pg_temp.mid(13), '00000000-0000-0000-0000-00000000c003', 'third_place', 'Third place', 0, pg_temp.eid(9), pg_temp.eid(11), 'final', 'b', pg_temp.eid(11), 2, 5, now() - interval '40 minutes');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(10), '00000000-0000-0000-0000-00000000c003', 'elimination', 'Semifinal', 0, pg_temp.eid(8), pg_temp.eid(9), pg_temp.mid(12), 'a', 'final', 'a', pg_temp.eid(8), 5, 1, now() - interval '2 hours'),
  (pg_temp.mid(11), '00000000-0000-0000-0000-00000000c003', 'elimination', 'Semifinal', 1, pg_temp.eid(10), pg_temp.eid(11), pg_temp.mid(12), 'b', 'final', 'a', pg_temp.eid(10), 5, 2, now() - interval '2 hours');
-- 5v5: one final, Ankle Biters win
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  (pg_temp.mid(14), '00000000-0000-0000-0000-00000000c004', 'final', 'Final', 0, pg_temp.eid(20), pg_temp.eid(21), 'final', 'a', pg_temp.eid(20), 3, 1, now() - interval '20 minutes');
