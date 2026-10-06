-- Local fixture for scripts/e2e/obs-live.mjs (the Broadcast Companion against the real stack). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 13 fixture (event "Test stuff test", users a1 owner, a2 organizer, a4 scorekeeper, c1 head marshal, c2 second scorekeeper,
-- Longsword + Polearm on Field 1, Sword and shield on Field 2), plus THREE Lysts:
--   Field 3: a Buckler round robin (m31..m34), with its own fighters, so three fields can be live at once.
-- The event runs three fields. The broadcast controller credential and the marshal device are created BY THE SCRIPT through the real Edge Function
-- (so the codes are real and shown once), not here.
\i scripts/e2e/fixtures/pack13.sql

update public.events set field_count = 3 where id = '00000000-0000-0000-0000-00000000ed01';

create or replace function pg_temp.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000f1' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.eid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e2' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.mid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000fd' || lpad(n::text, 3, '0'))::uuid $$;

-- Buckler (cd04) entries 50..55 = fighters 15, 16, 3, 4, 5, 6
insert into public.entries (id, competition_id, fighter_id)
select pg_temp.eid((49 + i)::int), '00000000-0000-0000-0000-00000000cd04', pg_temp.fid(f) from unnest(array[15, 16, 3, 4, 5, 6]) with ordinality as u(f, i);
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  (pg_temp.mid(31), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(51)),
  (pg_temp.mid(32), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 1, 'Field 3', pg_temp.eid(52), pg_temp.eid(53)),
  (pg_temp.mid(33), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 2, 'Field 3', pg_temp.eid(54), pg_temp.eid(55)),
  (pg_temp.mid(34), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(52));
update public.matches m set scheduled_at = date_trunc('hour', now()) + make_interval(mins => t.mins)
from (values (31, 0), (32, 10), (33, 20), (34, 30)) as t(n, mins) where m.id = pg_temp.mid(t.n);
