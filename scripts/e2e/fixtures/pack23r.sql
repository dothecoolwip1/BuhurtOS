-- Pack 23R: Red Deer Rumble rehearsal fixture (TEST DATA ONLY). LOCAL THROWAWAY DATABASE ONLY: loaded after the migrations by
-- scripts/e2e/pack23r-rehearsal.sh. Never load this into the hosted database. Everything here is fictional and tagged synthetic.
--
-- It reuses the Pack 11 people (52 fighters with accounts, 10 teams, the organizer a2, head marshal a3, scorekeepers a4/a5, stranger a7) and adds
-- what a real Rumble weekend looks like on paper: ONE lyst, TWO days, ten categories mixed into one running order, fighters in up to four categories,
-- a two-entrant category, round robins, pools into a bracket, a six-into-eight knockout with byes, a TEST Reavers team.
--
-- The event is created through public.create_event as the organizer and every competition through public.create_competition; every person
-- registers through public.submit_registration (rehearsal.register_all from rumble.sql). Draws are NOT made here: the journey builds them through
-- the real Build tournament screen, so the rehearsal sees what an organizer would.
\ir rumble.sql

-- ---------------------------------------------------------------- TEST markers
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-00000023a001', 'submitted', 'Pack 23R rehearsal test data', 'local fixture', true);
-- the TEST Reavers: team 1 of the Pack 11 people (fighters 1..5, captain fighter 1) and the women's team 1 (41..44) renamed so team highlighting can be judged
update public.teams set name = 'TEST Reavers', slug = 'test-reavers-23r', city = 'Red Deer' where id = rehearsal.tid(1);
update rehearsal.team set name = 'TEST Reavers', slug = 'test-reavers-23r', city = 'Red Deer' where n = 1;

-- ---------------------------------------------------------------- the event: two days, one lyst, published with a waiver, registration open
create table rehearsal.k23 (n int primary key, name text, category text, gender text, structure text, day int);
insert into rehearsal.k23 values
  -- Saturday
  (1, 'Men Longsword', 'longsword', 'men', 'pools_elimination', 1),
  (2, 'Men Sword & Shield', 'sword_shield', 'men', 'elimination', 1),
  (3, 'Women Longsword', 'longsword', 'women', 'round_robin', 1),
  (4, 'Men 3v3', '3v3', 'men', 'round_robin', 1),
  -- Sunday
  (5, 'Men Long Axe (Polearm)', 'polearm', 'men', 'round_robin', 2),
  (6, 'Men Sword & Buckler', 'buckler', 'men', 'elimination', 2),
  (7, 'Women Sword & Shield', 'sword_shield', 'women', 'round_robin', 2),
  (8, 'Men Sabre', 'sabre', 'men', 'pools_elimination', 2),
  (9, 'Men 5v5', '5v5', 'men', 'elimination', 2),
  (10, 'Women 3v3', '3v3', 'women', 'round_robin', 2);

create function rehearsal.setup_23r() returns uuid language plpgsql as $$
declare v_ev uuid; v_day1 date := (now() at time zone 'America/Edmonton')::date; r record;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  v_ev := public.create_event('test-rumble-23r', 'TEST Red Deer Rumble 2026 (Pack 23R rehearsal)', v_day1, v_day1 + 1, 'TEST Westerner Park', '4847 19 St, Red Deer, AB');
  for r in select * from rehearsal.k23 order by n loop
    perform public.create_competition(v_ev, r.name, r.category, r.gender, null, r.structure, null);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  -- publishing, the fee and the lyst count are plain event settings (the Settings screen); set directly here
  update public.events set status = 'published', field_count = 1, fee_cents = 4000, fee_province = 'AB', city = 'Red Deer', region = 'Alberta', country = 'CA',
    time_note = 'Saturday 9:00 to 17:00, Sunday 9:00 to 16:00. Lunch 12:00 to 12:45 both days.' where id = v_ev;
  insert into public.waiver_versions (event_id, version, title, body) values (v_ev, 1, 'TEST Rumble waiver', 'TEST waiver text for the Pack 23R rehearsal. Fictional.');
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-00000023a001', 'event', v_ev, 'unverified', 'Pack 23R fixture');
  -- competitions sort in weekend order (Saturday first)
  update public.competitions k set sort = x.n from rehearsal.k23 x where k.event_id = v_ev and k.name = x.name;
  return v_ev;
end $$;

-- ---------------------------------------------------------------- who enters what (rehearsal.plan from rumble.sql; reset, then the Rumble entries)
update rehearsal.plan set codes = '{}', days = 'both', shows_up = true, notes = null, pays = true, insurance = 'hacsa_member', province = 'AB', shares = false;
-- Saturday
update rehearsal.plan set codes = codes || array['longsword'] where n between 1 and 16;                         -- Men Longsword 16: pools then a bracket
update rehearsal.plan set codes = codes || array['sword_shield'] where n between 17 and 22;                      -- Men Sword & Shield 6: 8-slot knockout, 2 byes
update rehearsal.plan set codes = codes || array['longsword'] where n between 41 and 45;                         -- Women Longsword 5: round robin
update rehearsal.plan set codes = codes || array['3v3'] where n between 1 and 30 and (n - 1) % 5 < 3;           -- Men 3v3: teams 1..6
-- Sunday
update rehearsal.plan set codes = codes || array['polearm'] where n in (1, 2, 3, 9, 23, 24);                     -- Men Long Axe 6: round robin
update rehearsal.plan set codes = codes || array['buckler'] where n in (4, 10, 25, 26, 27, 28, 29, 30);          -- Men Sword & Buckler 8: knockout
update rehearsal.plan set codes = codes || array['sword_shield'] where n in (46, 47);                            -- Women Sword & Shield: TWO entrants
update rehearsal.plan set codes = codes || array['sabre'] where n in (5, 6, 7, 8, 31, 32, 33);                   -- Men Sabre 7: pools then a bracket
update rehearsal.plan set codes = codes || array['5v5'] where n between 1 and 40;                                -- Men 5v5: eight teams, knockout
update rehearsal.plan set codes = codes || array['3v3'] where n in (41, 42, 43, 45, 46, 47, 49, 50, 51);         -- Women 3v3: three teams
-- circumstances
update rehearsal.plan set notes = 'Hurt his knee on Saturday; may not fight Sunday' where n = 20;               -- the injury withdrawal (journey)
update rehearsal.plan set shows_up = false where n = 34;                                                        -- never arrives (5v5 only)

grant usage on schema rehearsal to postgres;
