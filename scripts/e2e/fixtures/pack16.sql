-- Local fixture for scripts/e2e/pack16-live.mjs (check-in, armour control and readiness). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 13 fixture (event "Test stuff test": Aldric, Brann, Cael, Dara registered and accepted; Aldric and Cael checked in;
-- Longsword m1 = Aldric v Brann on Field 1; a2 organizer, a4 scorekeeper, c1 head marshal, fighter1/fighter2 accounts), plus:
--   d1 check-in desk, d2 armour inspector, d3 captain of Iron Wolves (Aldric and Brann), d4 check-in desk at ANOTHER event only;
--   a profight competition with Cael entered (declared weight 84 kg) so weigh-in applies to him and nobody else.
\i scripts/e2e/fixtures/pack13.sql
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'd' || n || '@example.test' from generate_series(1, 4) n;
update public.profiles set display_name = (array['Desk Dana','Inspector Ines','Captain Cora','Other Desk'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000d%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000d1', 'check_in'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000d2', 'inspector');
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed02', 'other-event', 'Other event', 'published', 'tournament', current_date, current_date, 'Elsewhere', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed02', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000d4', 'check_in');

insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000a616', 'iron-wolves', 'Iron Wolves', 'approved', 'Red Deer', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000a616', '00000000-0000-0000-0000-0000000000d3', 'captain');
update public.registrations set team_id = '00000000-0000-0000-0000-00000000a616', team_name = 'Iron Wolves'
 where id in ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000ae02');

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd05', '00000000-0000-0000-0000-00000000ed01', 'Profight (men)', 'profight', 'men', 'Classic', 'round_robin', 5, 2);
insert into public.registration_competitions (registration_id, competition_id, details) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000cd01', '{}'),
  ('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000cd01', '{}'),
  ('00000000-0000-0000-0000-00000000ae03', '00000000-0000-0000-0000-00000000cd05', '{"weight": "84 kg"}'),
  ('00000000-0000-0000-0000-00000000ae04', '00000000-0000-0000-0000-00000000cd01', '{}');
