-- Local fixture for scripts/e2e/pack13-live.mjs (Lyst Control). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Event day fixture (event "Test stuff test", Longsword on Field 1, Sword and shield on Field 2), plus:
--   c1 head marshal, c2 second scorekeeper, c3..c7 people who will scan a counter QR (no event role at all), c8 a fighter's account.
\i scripts/e2e/fixtures/eventday.sql
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, 'c' || n || '@example.test' from generate_series(1, 8) n;
update public.profiles set display_name = (array['Head Marshal','Second Scorekeeper','Counter Ash','Counter Birch','Counter Cedar','Counter Dune','Counter Elm','Fighter Account'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000c%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000c1', 'head_marshal'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000c2', 'scorekeeper');
-- fighters 1 and 2 (Aldric, Brann) have accounts, so the existing fight alerts reach them (to prove Lyst Control adds none)
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000101'), ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000102');
