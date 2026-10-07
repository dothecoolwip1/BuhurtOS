-- Pack 26: full Rumble rehearsal fixture (TEST DATA ONLY). LOCAL THROWAWAY DATABASE ONLY: loaded after the migrations by
-- scripts/e2e/pack26-live.sh. Never load this into the hosted database. Everything here is fictional and tagged synthetic.
--
-- It reuses the Pack 11 people (rumble.sql: 52 fighters with accounts, 10 teams, platform owner a1, organizer a2, head marshal a3, scorekeepers a4/a5,
-- stranger a7, Parkland League admin a9) and adds a medium-sized two-Lyst weekend: eight competitions (pools into a bracket, a bracket with byes,
-- round robins, a 5v5 and a 3v3 team fight, a two-entrant category), fighters in several categories, shared equipment, one-day attendance,
-- fee and insurance differences, volunteers, a mercenary, a pending, a declined and a withdrawn registration, event staff of every role, a
-- second organizer, and ANOTHER event with its own organizer so isolation can be judged.
--
-- The event is created through public.create_event as the organizer and every competition through public.create_competition; every person
-- registers through public.submit_registration (rehearsal.register_all from rumble.sql, plus the volunteers and the mercenary below). Draws are NOT made
-- here: the journey builds them through the real Build tournament screen, so the rehearsal sees what an organizer would. Results, conflicts,
-- reopened matches, finalization and the close are all produced by the journey through the real functions.
\ir rumble.sql

-- ---------------------------------------------------------------- TEST markers
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-00000026a001', 'submitted', 'Pack 26 rehearsal test data', 'local fixture', true);
update public.teams set name = 'TEST Reavers', slug = 'test-reavers-26', city = 'Red Deer' where id = rehearsal.tid(1);
update rehearsal.team set name = 'TEST Reavers', slug = 'test-reavers-26', city = 'Red Deer' where n = 1;

-- ---------------------------------------------------------------- more people: event staff of every role, a second organizer, another event's organizer, volunteers, a mercenary
-- b1 check-in desk, b2 armour inspector, b3 medic, b4 announcer, b5 second organizer (added by a2 through grant_event_role_by_email in the journey),
-- b6 the organizer of the OTHER event (approved platform organizer), b7 a marshal, b8 a volunteer (squire, points counter), b9 a volunteer (runner).
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'b' || n || '@example.test' from generate_series(1, 9) n;
update public.profiles set display_name = (array['Desk Dana','Inspector Ivo','Medic Mira','Announcer Al','Organizer Two','Other Organizer','Marshal Mo','Volunteer Vee','Volunteer Ray'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000b6', 'organizer');
-- the mercenary: fighter 53, Rook Lonely, no team, with an account (uses the rehearsal id scheme)
insert into rehearsal.fighter values (53, 'Rook Lonely', 'male', null);
insert into public.fighters (id, display_name, gender, city, region, disciplines) values (rehearsal.fid(53), 'Rook Lonely', 'male', 'Camrose', 'Alberta', '{}');
insert into auth.users (id, email) values (rehearsal.uid(53), 'f53@example.test');
update public.profiles set display_name = 'Rook Lonely', onboarded_at = now() where id = rehearsal.uid(53);
insert into public.fighter_accounts (fighter_id, user_id) values (rehearsal.fid(53), rehearsal.uid(53));
insert into rehearsal.plan (n, codes) values (53, '{}');

-- ---------------------------------------------------------------- the event: two days, TWO Lysts, published with a waiver, registration open, fee rules
create table rehearsal.k26 (n int primary key, name text, category text, gender text, structure text, rounds_to_win int);
insert into rehearsal.k26 values
  (1, 'Men Longsword', 'longsword', 'men', 'pools_elimination', null),      -- 16 entrants: pools, then a bracket
  (2, 'Men Sword & Shield', 'sword_shield', 'men', 'elimination', null),    -- 6 entrants: 8-slot knockout, 2 byes
  (3, 'Women Longsword', 'longsword', 'women', 'round_robin', null),        -- 5 entrants: round robin
  (4, 'Men Polearm', 'polearm', 'men', 'elimination', null),                -- 7 entrants: knockout with 1 bye
  (5, 'Men Sword & Buckler', 'buckler', 'men', 'round_robin', null),        -- 3 entrants: round robin (3 fights; the first competition to be made official)
  (6, 'Women Sword & Shield', 'sword_shield', 'women', 'round_robin', null),-- 2 entrants: one fight
  (7, 'Men 5v5', '5v5', 'men', 'elimination', 2),                           -- 6 teams: knockout; the standing-count team fight
  (8, 'Men 3v3', '3v3', 'men', 'round_robin', 2);                           -- 4 teams: round robin

create function rehearsal.setup_26() returns uuid language plpgsql as $$
declare v_ev uuid; v_day1 date := (now() at time zone 'America/Edmonton')::date; r record;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  v_ev := public.create_event('test-rumble-26', 'TEST Red Deer Rumble 2026 (Pack 26 rehearsal)', v_day1, v_day1 + 1, 'TEST Horse in Hand Ranch', '39506 Highway 2 Service Rd, Blackfalds, AB');
  for r in select * from rehearsal.k26 order by n loop
    perform public.create_competition(v_ev, r.name, r.category, r.gender, null, r.structure, r.rounds_to_win);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  -- the event settings an organizer types on the Settings screen (published, two Lysts, $40 for Alberta fighters, registration closes after the event so the
  -- registration journeys can run during the rehearsal; the journey closes it when it tests the closed state)
  update public.events set status = 'published', field_count = 2, fee_cents = 4000, fee_province = 'AB', fee_note = 'E-transfer to the Reavers before the day, or cash at the desk.',
    city = 'Blackfalds', region = 'Alberta', country = 'CA', description = 'TEST rehearsal event for Pack 26. Fictional people, fictional results.',
    time_note = 'Saturday and Sunday 10:00 to 18:00. Weapons check 08:00. Safety meeting 09:30 both days.',
    registration_opens_at = now() - interval '30 days', registration_closes_at = now() + interval '3 days',
    volunteer_info = 'Volunteers who assist fighters fill in the separate safety form at the desk.'
    where id = v_ev;
  insert into public.waiver_versions (event_id, version, title, body) values (v_ev, 1, 'TEST Rumble waiver', 'TEST waiver text for the Pack 26 rehearsal. Fictional. Long enough for the check constraint.');
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-00000026a001', 'event', v_ev, 'unverified', 'Pack 26 fixture');
  update public.competitions k set sort = x.n from rehearsal.k26 x where k.event_id = v_ev and k.name = x.name;
  return v_ev;
end $$;

-- the OTHER event: another organizer's published event the same weekend, so every isolation check has a target
create function rehearsal.setup_other_26() returns uuid language plpgsql as $$
declare v_ev uuid; v_day1 date := (now() at time zone 'America/Edmonton')::date;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b6', true);
  v_ev := public.create_event('test-other-26', 'TEST Other Event (Pack 26 isolation)', v_day1, v_day1 + 1, 'TEST Other Hall', 'Elsewhere');
  perform public.create_competition(v_ev, 'Men Longsword', 'longsword', 'men', null, 'round_robin', null);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.events set status = 'published', field_count = 1 where id = v_ev;
  insert into public.waiver_versions (event_id, version, title, body) values (v_ev, 1, 'TEST Other waiver', 'TEST waiver text for the other event of the Pack 26 rehearsal. Fictional.');
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-00000026a001', 'event', v_ev, 'unverified', 'Pack 26 fixture (other event)');
  return v_ev;
end $$;

-- ---------------------------------------------------------------- who enters what (rehearsal.plan from rumble.sql: reset, then the Pack 26 entries)
update rehearsal.plan set codes = '{}', days = 'both', shows_up = true, notes = null, pays = true, insurance = 'hacsa_member', province = 'AB', shares = false;
update rehearsal.plan set codes = codes || array['longsword'] where n between 1 and 16;                         -- Men Longsword 16: pools then a bracket
update rehearsal.plan set codes = codes || array['sword_shield'] where n between 17 and 22;                      -- Men Sword & Shield 6: 8-slot knockout, 2 byes
update rehearsal.plan set codes = codes || array['longsword'] where n between 41 and 45;                         -- Women Longsword 5: round robin
update rehearsal.plan set codes = codes || array['polearm'] where n in (1, 2, 3, 9, 23, 24, 25);                 -- Men Polearm 7: knockout, 1 bye (1, 2, 3, 9 also in Longsword: close together)
update rehearsal.plan set codes = codes || array['buckler'] where n in (4, 10, 26);                              -- Men Sword & Buckler 3: round robin
update rehearsal.plan set codes = codes || array['sword_shield'] where n in (46, 47);                            -- Women Sword & Shield: TWO entrants
update rehearsal.plan set codes = codes || array['5v5'] where n between 1 and 30;                                -- Men 5v5: six teams (1..6), knockout
update rehearsal.plan set codes = codes || array['3v3'] where n between 1 and 20 and (n - 1) % 5 < 3;           -- Men 3v3: teams 1..4, the first three of each
-- circumstances
update rehearsal.plan set shares = true where n in (2, 3, 44);                                                  -- share equipment (2 and 3 are both in Longsword AND Polearm)
update rehearsal.plan set days = 'first' where n = 30;                                                           -- Saturday only (5v5 only)
update rehearsal.plan set days = 'second' where n = 26;                                                          -- Sunday only (Buckler): his fights are held on day one
update rehearsal.plan set notes = 'Arriving around 11 on the first day' where n = 13;
update rehearsal.plan set notes = 'Has to leave by 15:00 on the second day' where n = 23;
update rehearsal.plan set insurance = 'proof_pending' where n = 19;                                              -- insurance blocker at check-in (Sword & Shield)
update rehearsal.plan set insurance = 'proof_received' where n in (24, 25);
update rehearsal.plan set pays = false where n in (2, 33);                                                       -- unpaid at check-in (2 is in Longsword, Polearm and 5v5)
update rehearsal.plan set province = 'SK' where n in (25, 26);                                                   -- out of province: no fee
update rehearsal.plan set province = 'BC' where n = 45;
update rehearsal.plan set shows_up = false where n = 15;                                                         -- registered, never arrives (Longsword and 5v5)
update rehearsal.plan set notes = 'Hurt his shoulder in training; will decide on the day' where n = 20;         -- the Sword & Shield fighter who withdraws mid-tournament (journey)
-- the mercenary: a longsword duelist with no team who asks to be placed; he registers with team_id null and mercenary true
update rehearsal.plan set codes = array['longsword'] where n = 53;

-- fighters 31..40 (teams 7 and 8) are NOT in the plan with codes: they are the people whose registrations are pending (31), declined (32) or withdrawn (33) at
-- the start of the rehearsal; rehearsal.register_all skips anyone with no competition, so the journey registers them explicitly (below).

-- ---------------------------------------------------------------- registration of the mercenary (team_id null), volunteers and the three edge cases, through the real function
create function rehearsal.register_extras(p_event uuid) returns text language plpgsql as $$
declare v_waiver uuid; v_ev public.events; v_ls uuid; v_ss uuid; v_reg uuid; out text := ''; v_n int; v_name text;
begin
  select * into v_ev from public.events where id = p_event;
  select id into v_waiver from public.waiver_versions where event_id = p_event order by version desc limit 1;
  select id into v_ls from public.competitions where event_id = p_event and name = 'Men Longsword';
  select id into v_ss from public.competitions where event_id = p_event and name = 'Men Sword & Shield';
  -- the mercenary (fighter 53): longsword, no team, asks to be placed
  perform set_config('request.jwt.claim.sub', rehearsal.uid(53)::text, true);
  v_reg := public.submit_registration(p_event, jsonb_build_object('full_name', 'Rook Lonely', 'gender', 'male', 'organization', 'other', 'province', 'AB', 'team_id', null, 'mercenary', true,
    'shares_equipment', false, 'attend_dates', jsonb_build_array(v_ev.starts_on::text, v_ev.ends_on::text), 'insurance', 'proof_pending', 'waiver_agree', true, 'waiver_version_id', v_waiver, 'waiver_signed_name', 'Rook Lonely',
    'competitions', jsonb_build_array(jsonb_build_object('competition_id', v_ls, 'team_id', null)), 'notes', 'Happy to fight for any team that needs a body.',
    'private', jsonb_build_object('email', 'f53@example.test', 'emergency_name', 'Contact of Rook', 'emergency_phone', '4035550053', 'medically_fit', true)));
  out := out || 'mercenary=' || v_reg::text;
  -- two volunteers (no fee, no competition)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', true);
  v_reg := public.submit_registration(p_event, jsonb_build_object('full_name', 'Volunteer Vee', 'gender', 'female', 'organization', 'HACSA', 'province', 'AB', 'is_volunteer', true, 'volunteer_roles', jsonb_build_array('Squire', 'Points counter'),
    'attend_dates', jsonb_build_array(v_ev.starts_on::text, v_ev.ends_on::text), 'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', v_waiver, 'waiver_signed_name', 'Volunteer Vee', 'competitions', '[]'::jsonb,
    'private', jsonb_build_object('email', 'b8@example.test', 'emergency_name', 'Contact of Vee', 'emergency_phone', '4035550808', 'medically_fit', true)));
  out := out || ' vol1=' || v_reg::text;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
  v_reg := public.submit_registration(p_event, jsonb_build_object('full_name', 'Volunteer Ray', 'gender', 'other', 'organization', 'other', 'province', 'AB', 'is_volunteer', true, 'volunteer_roles', jsonb_build_array('Runner'),
    'attend_dates', jsonb_build_array(v_ev.starts_on::text), 'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', v_waiver, 'waiver_signed_name', 'Volunteer Ray', 'competitions', '[]'::jsonb,
    'availability_notes', 'Saturday only, from noon.',
    'private', jsonb_build_object('email', 'b9@example.test', 'emergency_name', 'Contact of Ray', 'emergency_phone', '4035550809', 'medically_fit', true)));
  out := out || ' vol2=' || v_reg::text;
  -- the three edge cases: 31 stays pending, 32 is declined, 33 is accepted then withdrawn by himself
  for v_n in 31..33 loop
    select name into v_name from rehearsal.fighter f where f.n = v_n;
    perform set_config('request.jwt.claim.sub', rehearsal.uid(v_n)::text, true);
    v_reg := public.submit_registration(p_event, jsonb_build_object('full_name', v_name, 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'team_id', rehearsal.tid(7),
      'shares_equipment', false, 'attend_dates', jsonb_build_array(v_ev.starts_on::text, v_ev.ends_on::text), 'insurance', 'hacsa_member', 'waiver_agree', true, 'waiver_version_id', v_waiver, 'waiver_signed_name', 'Signed',
      'competitions', jsonb_build_array(jsonb_build_object('competition_id', v_ss, 'team_id', null)),
      'private', jsonb_build_object('email', 'f' || v_n || '@example.test', 'emergency_name', 'Contact', 'emergency_phone', '4035550' || lpad(v_n::text, 3, '0'), 'medically_fit', true)));
    out := out || ' edge' || v_n || '=' || v_reg::text;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return out;
end $$;

grant usage on schema rehearsal to postgres;
