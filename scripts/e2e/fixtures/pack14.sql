-- Local fixture for scripts/e2e/pack14-live.mjs (broadcast overlay). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 13 fixture, plus a stream address, broadcast options and three event sponsors.
\i scripts/e2e/fixtures/pack13.sql
insert into public.event_broadcast (event_id, stream_url, stream_title, corners, show_records, show_photos, show_sponsors, sponsor_seconds)
values ('00000000-0000-0000-0000-00000000ed01', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Test Arena live', 'red_blue', true, true, true, 4);
insert into public.event_sponsors (event_id, name, tier, sort_order, on_broadcast) values
  ('00000000-0000-0000-0000-00000000ed01', 'Ironworks Armoury', 'title', 1, true),
  ('00000000-0000-0000-0000-00000000ed01', 'Northern Steel', 'partner', 2, true),
  ('00000000-0000-0000-0000-00000000ed01', 'Maple Mead', 'partner', 3, true),
  ('00000000-0000-0000-0000-00000000ed01', 'Hidden Sponsor', 'partner', 4, false);
