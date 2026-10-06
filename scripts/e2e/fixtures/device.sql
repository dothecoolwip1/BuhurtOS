-- Local fixture for scripts/e2e/device-live.mjs (Pack 18.1 temporary event devices, client side). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Event day fixture (event "Test stuff test", a published tournament running today and tomorrow in America/Edmonton: Longsword and
-- Polearm on Field 1, Sword and shield on Field 2, 16 fighters, 4 registrations with 2 checked in; a1 owner, a2 organizer, a4 scorekeeper, a7 stranger), plus:
--   * a LIVE-LOOKING queue on both fields: on deck, in the hole and scheduled fights (the field screens and the Command Centre have something to show)
--   * a second event, "Other event", with its own organizer (a5), competition and fight, so a code of one event can be shown to be useless at the other
-- The device credentials themselves are NOT here: the browser script creates them through the real Edge Function route (as the organizer), like the product does.
\i scripts/e2e/fixtures/eventday.sql

-- Field 1 (explicit): Round 1 of Longsword: Aldric v Brann on deck, Cael v Dara in the hole, Edric v Fenna still scheduled
update public.matches set field = 'Field 1' where id in (pg_temp.mid(1), pg_temp.mid(2), pg_temp.mid(3));
update public.matches set queue_state = 'on_deck' where id = pg_temp.mid(1);
update public.matches set queue_state = 'in_the_hole' where id = pg_temp.mid(2);
-- Field 2: Sword and shield: m11 on deck, m12 in the hole, m13 scheduled (the queue the secretary reorders)
update public.matches set queue_state = 'on_deck' where id = pg_temp.mid(11);
update public.matches set queue_state = 'in_the_hole' where id = pg_temp.mid(12);

update public.profiles set display_name = 'Other Organizer', onboarded_at = now() where id = '00000000-0000-0000-0000-0000000000a5';
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed02', 'other-event', 'Other event', 'published', 'tournament', (now() at time zone 'America/Edmonton')::date, (now() at time zone 'America/Edmonton')::date, 'Elsewhere', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed02', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000a5', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd11', '00000000-0000-0000-0000-00000000ed02', 'Longsword (open)', 'longsword', 'men', 'Classic', 'round_robin', 1, 2);
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000e261', '00000000-0000-0000-0000-00000000cd11', pg_temp.fid(15)), ('00000000-0000-0000-0000-00000000e262', '00000000-0000-0000-0000-00000000cd11', pg_temp.fid(16));
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, queue_state) values
  ('00000000-0000-0000-0000-0000000fd0f1', '00000000-0000-0000-0000-00000000cd11', 'round_robin', 'Round 1', 0, 'Field 1', '00000000-0000-0000-0000-00000000e261', '00000000-0000-0000-0000-00000000e262', 'on_deck');
