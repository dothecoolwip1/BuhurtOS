-- Local fixture for scripts/e2e/eventday-live.mjs. LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- An event like the hosted "Test stuff test": runs today and tomorrow (today IN THE EVENT'S TIME ZONE: the app judges "running" there, so a UTC
-- current_date made Manage open on Event home instead of Event day every evening in Edmonton, after 18:00 MDT), tagged as synthetic test data. Field 1 matches have NO field set (the default);
-- Field 2 is explicit. Users: a1 owner, a2 organizer, a4 scorekeeper, a7 stranger; f11..f14 are registered fighters.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'fighter' || n || '@example.test' from generate_series(1, 6) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');

insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000d0e01', 'submitted', 'Event day test data', 'local fixture', true);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed01', 'test-stuff-test', 'Test stuff test', 'published', 'tournament', (now() at time zone 'America/Edmonton')::date, (now() at time zone 'America/Edmonton')::date + 1, 'Test Arena', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed01', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper');

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000ed01', 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1, 2),
  ('00000000-0000-0000-0000-00000000cd02', '00000000-0000-0000-0000-00000000ed01', 'Sword and shield (men)', 'sword_shield', 'men', 'Classic', 'round_robin', 2, 2),
  ('00000000-0000-0000-0000-00000000cd03', '00000000-0000-0000-0000-00000000ed01', 'Polearm (men)', 'polearm', 'men', 'Classic', 'elimination', 3, 2),
  ('00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000ed01', 'Buckler (men)', 'buckler', 'men', 'Classic', 'round_robin', 4, 2);

-- fighters 1..16. Entries: longsword 1-6, sword and shield 1,7-10, polearm 11-14, buckler none (no draw yet)
create function pg_temp.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000f1' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.eid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e2' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.mid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000fd' || lpad(n::text, 3, '0'))::uuid $$;
insert into public.fighters (id, display_name, gender) select pg_temp.fid(n), (array['Aldric Stone','Brann Oakley','Cael Rhodes','Dara Voss','Edric Hale','Fenna Crow','Garrick Fell','Hale Morrow','Ivor Penn','Jory Wick','Kell Arden','Lorn Ashby','Mace Tarn','Nell Rook','Odin Robson','Taylor Robson'])[n], 'male' from generate_series(1, 16) n;
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000cd01', pg_temp.fid(n) from generate_series(1, 6) n;
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid((20 + i)::int), '00000000-0000-0000-0000-00000000cd02', pg_temp.fid(f) from unnest(array[1, 7, 8, 9, 10]) with ordinality as u(f, i);
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(30 + n), '00000000-0000-0000-0000-00000000cd03', pg_temp.fid(n) from generate_series(11, 14) n;

-- Longsword on Field 1 (NO field set): m1..m5. Taylor/Odin are not used here; names are plain.
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  (pg_temp.mid(1), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 0, pg_temp.eid(1), pg_temp.eid(2)),
  (pg_temp.mid(2), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 1, pg_temp.eid(3), pg_temp.eid(4)),
  (pg_temp.mid(3), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 2, pg_temp.eid(5), pg_temp.eid(6)),
  (pg_temp.mid(4), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 0, pg_temp.eid(1), pg_temp.eid(3)),
  (pg_temp.mid(5), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 1, pg_temp.eid(2), pg_temp.eid(4)),
  (pg_temp.mid(6), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 2, pg_temp.eid(5), pg_temp.eid(6));
-- Sword and shield on Field 2 (explicit): m11, m12. m11 has Aldric (fighter 1), who is also in longsword m4 at the same time: a schedule clash.
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  (pg_temp.mid(11), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 1', 0, 'Field 2', pg_temp.eid(21), pg_temp.eid(22)),
  (pg_temp.mid(12), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 1', 1, 'Field 2', pg_temp.eid(23), pg_temp.eid(24)),
  (pg_temp.mid(13), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 2', 0, 'Field 2', pg_temp.eid(21), pg_temp.eid(23));
-- Polearm knockout on Field 1 (no field set): semifinals m21, m22; final m23 and third place m24 wait for results.
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  (pg_temp.mid(23), '00000000-0000-0000-0000-00000000cd03', 'final', 'Final', 0, null, null),
  (pg_temp.mid(24), '00000000-0000-0000-0000-00000000cd03', 'third_place', 'Third place', 0, null, null);
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values
  (pg_temp.mid(21), '00000000-0000-0000-0000-00000000cd03', 'elimination', 'Semifinal', 0, pg_temp.eid(41), pg_temp.eid(42), pg_temp.mid(23), 'a'),
  (pg_temp.mid(22), '00000000-0000-0000-0000-00000000cd03', 'elimination', 'Semifinal', 1, pg_temp.eid(43), pg_temp.eid(44), pg_temp.mid(23), 'b');

-- Every match has a time, ten minutes apart from an hour ago, so "schedule time decides the order" is what the screen shows.
-- Aldric (fighter 1) plays longsword m4 (+30 min) and sword and shield m11 (+35 min) on the other field: a double booking.
update public.matches m set scheduled_at = date_trunc('hour', now()) + make_interval(mins => t.mins)
from (values (1, 0), (2, 10), (3, 20), (4, 30), (5, 40), (6, 50), (21, 60), (22, 70), (12, 0), (11, 35), (13, 20)) as t(n, mins) where m.id = pg_temp.mid(t.n);

-- Registrations (so check-in means something): fighters 1..4 registered and accepted; 1 and 3 checked in, 2 and 4 are not.
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000aed01', '00000000-0000-0000-0000-00000000ed01', 1, 'Waiver', 'A long enough waiver text for the check constraint.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, is_volunteer, waiver_version_id, waiver_signed_name)
select ('00000000-0000-0000-0000-00000000ae' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000ed01', ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, pg_temp.fid(n),
       'accepted', (array['Aldric Stone','Brann Oakley','Cael Rhodes','Dara Voss'])[n], 'male', 'HACSA', 'hacsa_member', false, '00000000-0000-0000-0000-0000000aed01', 'Signed Name'
from generate_series(1, 4) n;
insert into public.registration_checks (registration_id, check_name, passed) values
  ('00000000-0000-0000-0000-00000000ae01', 'checked_in', true), ('00000000-0000-0000-0000-00000000ae03', 'checked_in', true);
