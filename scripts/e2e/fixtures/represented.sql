-- Local fixture for scripts/e2e/represented-team-live.mjs. LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Team discipline totals and correcting the team a fighter represented. Users: a1 platform owner, a2 organizer of both events, a7 stranger.
--   Fall Open (ended 2 days ago, so a2's organizer role is still active): Longsword men, finished.
--     Ankle Biters: Bob 3, John 3, Joe 3 (= 9). Red Deer Reavers: Rex 7, Ray 5 (= 12). Mike 1 with NO recorded team (event over, no evidence).
--     5v5 men (team fight): Ankle Biters 50, Red Deer Reavers 30.
--   Spring Open (ended 60 days ago, a2's organizer role has expired): Longsword men, finished: Nia 4 with no recorded team.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');

insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000b001', 'prairie-league', 'Prairie League', 'regional');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b001', 'prairie-season', 'Prairie season', current_date - 120, current_date + 120);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000b201', 'fall-open', 'Fall Open', 'published', 'tournament', current_date - 3, current_date - 2, 'Test Arena', 'America/Edmonton',
   '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b101'),
  ('00000000-0000-0000-0000-00000000b202', 'spring-open', 'Spring Open', 'published', 'tournament', current_date - 61, current_date - 60, 'Test Arena', 'America/Edmonton',
   '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b101');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-0000000000a2', 'organizer');

insert into public.teams (id, slug, name, status, city) values
  ('00000000-0000-0000-0000-00000000b301', 'ankle-biters', 'Ankle Biters', 'approved', 'Red Deer'),
  ('00000000-0000-0000-0000-00000000b302', 'red-deer-reavers', 'Red Deer Reavers', 'approved', 'Red Deer'),
  ('00000000-0000-0000-0000-00000000b303', 'northern-ravens', 'Northern Ravens', 'approved', 'Edmonton');
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000b401', 'Bob', '00000000-0000-0000-0000-00000000b301'), ('00000000-0000-0000-0000-00000000b402', 'John', '00000000-0000-0000-0000-00000000b301'),
  ('00000000-0000-0000-0000-00000000b403', 'Joe', '00000000-0000-0000-0000-00000000b301'), ('00000000-0000-0000-0000-00000000b404', 'Rex', '00000000-0000-0000-0000-00000000b302'),
  ('00000000-0000-0000-0000-00000000b405', 'Ray', '00000000-0000-0000-0000-00000000b302'), ('00000000-0000-0000-0000-00000000b406', 'Mike', '00000000-0000-0000-0000-00000000b303'),
  ('00000000-0000-0000-0000-00000000b407', 'Nia', '00000000-0000-0000-0000-00000000b303');

insert into public.competitions (id, event_id, name, category, gender, tier, structure, status) values
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b201', 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 'finished'),
  ('00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b201', '5v5 (men)', '5v5', 'men', 'Classic', 'round_robin', 'finished'),
  ('00000000-0000-0000-0000-00000000b503', '00000000-0000-0000-0000-00000000b202', 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 'finished');
-- The results were imported with the team each fighter represented; Mike's and Nia's were not (the events are over, so nothing is guessed).
insert into public.entries (id, competition_id, fighter_id, represented_team_id, status) values
  ('00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b401', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b602', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b402', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b603', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b403', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b604', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b404', '00000000-0000-0000-0000-00000000b302', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b605', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b405', '00000000-0000-0000-0000-00000000b302', 'checked_in');
insert into public.entries (id, competition_id, fighter_id, status) values
  ('00000000-0000-0000-0000-00000000b606', '00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b406', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b611', '00000000-0000-0000-0000-00000000b503', '00000000-0000-0000-0000-00000000b407', 'checked_in');
insert into public.entries (id, competition_id, team_id, status) values
  ('00000000-0000-0000-0000-00000000b607', '00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000b608', '00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b302', 'checked_in');
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b604', 1, 7), ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b605', 2, 5),
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b601', 3, 3), ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b602', 4, 3),
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b603', 5, 3), ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000b606', 6, 1),
  ('00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b607', 1, 50), ('00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000b608', 2, 30),
  ('00000000-0000-0000-0000-00000000b503', '00000000-0000-0000-0000-00000000b611', 1, 4);

-- ---------------------------------------------------------------- Coastal League: ties, divisions and a discipline the frontend has never heard of
-- A separate organization so the Prairie League numbers above do not move. Every team below is one of the three teams above.
--   Longsword men:    Cy (Ankle Biters) 6, Dee (Northern Ravens) 6   -> tied for #1 in the men's division
--   Longsword women:  Eve (Northern Ravens) 4                         -> Northern Ravens lead all divisions with 10 (men 6 + women 4)
--   Sword and shield: Gus (Ankle Biters) 5, Hal (Red Deer Reavers) 5  -> tied for #1 overall
--   Dagger men:       Fay (Red Deer Reavers) 2                        -> 'dagger' exists only as a ref_categories row: no frontend code knows it
insert into public.ref_categories (code, league, name, sort, source) values ('dagger', 'duels', 'Dagger', 99, 'represented-team fixture');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000c001', 'coastal-league', 'Coastal League', 'regional');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-00000000c001', 'coastal-season', 'Coastal season', current_date - 120, current_date + 120);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone, organization_id, season_id) values
  ('00000000-0000-0000-0000-00000000c201', 'coastal-open', 'Coastal Open', 'published', 'tournament', current_date - 5, current_date - 4, 'Test Arena', 'America/Vancouver',
   '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c101');
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000c401', 'Cy',  '00000000-0000-0000-0000-00000000b301'), ('00000000-0000-0000-0000-00000000c402', 'Dee', '00000000-0000-0000-0000-00000000b303'),
  ('00000000-0000-0000-0000-00000000c403', 'Eve', '00000000-0000-0000-0000-00000000b303'), ('00000000-0000-0000-0000-00000000c404', 'Gus', '00000000-0000-0000-0000-00000000b301'),
  ('00000000-0000-0000-0000-00000000c405', 'Hal', '00000000-0000-0000-0000-00000000b302'), ('00000000-0000-0000-0000-00000000c406', 'Fay', '00000000-0000-0000-0000-00000000b302');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, status) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c201', 'Longsword (men)',   'longsword',    'men',   'Classic', 'round_robin', 'finished'),
  ('00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-00000000c201', 'Longsword (women)', 'longsword',    'women', 'Classic', 'round_robin', 'finished'),
  ('00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c201', 'Sword and shield (men)', 'sword_shield', 'men', 'Classic', 'round_robin', 'finished'),
  ('00000000-0000-0000-0000-00000000c504', '00000000-0000-0000-0000-00000000c201', 'Dagger (men)',       'dagger',       'men',   'Classic', 'round_robin', 'finished');
insert into public.entries (id, competition_id, fighter_id, represented_team_id, status) values
  ('00000000-0000-0000-0000-00000000c601', '00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c401', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000c602', '00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c402', '00000000-0000-0000-0000-00000000b303', 'checked_in'),
  ('00000000-0000-0000-0000-00000000c603', '00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-00000000c403', '00000000-0000-0000-0000-00000000b303', 'checked_in'),
  ('00000000-0000-0000-0000-00000000c604', '00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c404', '00000000-0000-0000-0000-00000000b301', 'checked_in'),
  ('00000000-0000-0000-0000-00000000c605', '00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c405', '00000000-0000-0000-0000-00000000b302', 'checked_in'),
  ('00000000-0000-0000-0000-00000000c606', '00000000-0000-0000-0000-00000000c504', '00000000-0000-0000-0000-00000000c406', '00000000-0000-0000-0000-00000000b302', 'checked_in');
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c601', 1, 6), ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c602', 2, 6),
  ('00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-00000000c603', 1, 4),
  ('00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c604', 1, 5), ('00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c605', 2, 5),
  ('00000000-0000-0000-0000-00000000c504', '00000000-0000-0000-0000-00000000c606', 1, 2);
