-- Local fixture for scripts/e2e/pack181-live.mjs (Pack 18.1: temporary event devices, Camera Off, controller). LOCAL THROWAWAY DATABASE ONLY.
-- Everything from the Pack 16 fixture (event "Test stuff test": Longsword on Field 1, Sword and shield on Field 2, registrations, a2 organizer, a4 scorekeeper,
-- c1 head marshal, d1 check-in desk, d2 inspector, a1 platform owner, a7 stranger; the other event "Other event" with d4 as its check-in desk), plus:
--   b1 organizer of the OTHER event, b2 an announcer (permanent account) of this event, a competition + match + entries in the other event, official results in Longsword.
\i scripts/e2e/fixtures/pack16.sql
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'b' || n || '@example.test' from generate_series(1, 2) n;
update public.profiles set display_name = (array['Other Organizer','Permanent Announcer'])[right(id::text, 1)::int], onboarded_at = now() where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000b1', 'organizer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000b2', 'announcer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd91', '00000000-0000-0000-0000-00000000ed02', 'Longsword (other event)', 'longsword', 'men', 'Classic', 'round_robin', 1, 2);
insert into public.fighters (id, display_name, gender) values ('00000000-0000-0000-0000-00000000f191', 'Other Fighter A', 'male'), ('00000000-0000-0000-0000-00000000f192', 'Other Fighter B', 'male');
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000e291', '00000000-0000-0000-0000-00000000cd91', '00000000-0000-0000-0000-00000000f191'),
  ('00000000-0000-0000-0000-00000000e292', '00000000-0000-0000-0000-00000000cd91', '00000000-0000-0000-0000-00000000f192');
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  ('00000000-0000-0000-0000-0000000fd091', '00000000-0000-0000-0000-00000000cd91', 'round_robin', 'Round 1', 0, 'Field 1', '00000000-0000-0000-0000-00000000e291', '00000000-0000-0000-0000-00000000e292');
-- official results in Longsword so a correction / void has something to act on
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000e205', 1, 10), ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000e206', 2, 6);
