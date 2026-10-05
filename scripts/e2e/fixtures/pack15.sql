-- Local fixture for scripts/e2e/pack15-live.mjs (event-day alerts, announcements). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 14 fixture, plus accounts for fighters 3, 4 and 5 (Cael, Dara, Edric) so the second and third fights have people to tell.
\i scripts/e2e/fixtures/pack14.sql
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-00000000f104', '00000000-0000-0000-0000-000000000104'),
  ('00000000-0000-0000-0000-00000000f105', '00000000-0000-0000-0000-000000000105')
on conflict do nothing;
