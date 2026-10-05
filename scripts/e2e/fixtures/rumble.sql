-- Pack 11 dress-rehearsal fixture: the people and teams of a Rumble-sized tournament. LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations by
-- scripts/e2e/rumble-live.sh). Everything here is fictional. The EVENT is not here: the journey creates it through Quick Setup, opens registration,
-- then calls rehearsal.register_all(event) so every registration goes through the real submit_registration function, as a person's would.
--
-- Accounts: a1 platform owner, a2 organizer (approved platform organizer), a3 head marshal, a4 scorekeeper on Field 1, a5 scorekeeper on Field 2,
--           a7 stranger (signed in, no role), a9 administrator of Parkland League.
-- Fighters: 52, each with an account (user f-n) so they can register and open My next fight. 40 men (1..40) on eight teams of five, 12 women
--           (41..52) on three teams of four. Team captains are the first fighter of each team.
-- The plan (rehearsal.plan): who enters what, who shares equipment, who is only here one day, who pays, who never shows up.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'a' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner'), ('00000000-0000-0000-0000-0000000000a2', 'organizer');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000a001', 'parkland-league', 'Parkland League', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000a9', 'admin');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000a126', '00000000-0000-0000-0000-00000000a001', 'parkland-2026', 'Parkland 2026', date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date);

create schema rehearsal;
create function rehearsal.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f11' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function rehearsal.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000e11' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function rehearsal.tid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000d11' || lpad(to_hex(n), 2, '0'))::uuid $$;

-- ---------------------------------------------------------------- teams
create table rehearsal.team (n int primary key, slug text, name text, city text);
insert into rehearsal.team values
  (1, 'kestrel-guard', 'Kestrel Guard', 'Red Deer'), (2, 'iron-ferns', 'Iron Ferns', 'Lacombe'), (3, 'mire-wolves', 'Mire Wolves', 'Olds'),
  (4, 'prairie-hammers', 'Prairie Hammers', 'Calgary'), (5, 'foothill-lions', 'Foothill Lions', 'Cochrane'), (6, 'coulee-ravens', 'Coulee Ravens', 'Lethbridge'),
  (7, 'badland-bears', 'Badland Bears', 'Drumheller'), (8, 'chinook-riders', 'Chinook Riders', 'Airdrie'), (9, 'aspen-shields', 'Aspen Shields', 'Edmonton'),
  (10, 'northern-elk', 'Northern Elk', 'Grande Prairie');
insert into public.teams (id, slug, name, status, city, region, country)
  select rehearsal.tid(n), slug, name, 'approved', city, 'Alberta', 'CA' from rehearsal.team;
insert into public.team_affiliations (team_id, organization_id, relation) select rehearsal.tid(n), '00000000-0000-0000-0000-00000000a001', 'member' from rehearsal.team;

-- ---------------------------------------------------------------- fighters (deterministic names)
create table rehearsal.fighter (n int primary key, name text, gender text, team int);
insert into rehearsal.fighter
select n,
  (array['Aldric','Brann','Cael','Dara','Edric','Finn','Garen','Hollis','Ivar','Jorah','Kaspar','Lorcan','Magnus','Niall','Orin','Piers','Quill','Rafe','Soren','Tarn',
         'Ulric','Varek','Wyatt','Xander','Yorick','Zane','Ansel','Bodhi','Corin','Dax','Emmett','Fenwick','Gideon','Hugo','Idris','Jasper','Kieran','Leif','Milo','Nash'])[n]
  || ' ' ||
  (array['Stone','Oakley','Rhodes','Voss','Hale','Marsh','Quill','Thorn','Wold','Ash','Birch','Cedar','Holt','Ings','Brand','Crane','Dunmore','Ellery','Fairweather','Grange',
         'Hartley','Irons','Juniper','Kettle','Lowry','Mallory','Norwood','Osgood','Pryor','Ridley','Sutton','Tiller','Underhill','Vance','Whitlock','Yates','Abernathy','Blackwood','Carrow','Dunstan'])[n],
  'male', ((n - 1) / 5) + 1
from generate_series(1, 40) n;
insert into rehearsal.fighter
select n,
  (array['Ann','Bea','Cat','Dot','Eve','Fay','Gwen','Hana','Isla','June','Kit','Lena'])[n - 40] || ' ' ||
  (array['Ashby','Blythe','Corrigan','Dale','Ember','Frost','Gale','Harrow','Ingram','Jessop','Kerr','Lund'])[n - 40],
  'female', ((n - 41) / 4) + 1
from generate_series(41, 52) n;
-- one extravagantly long name, to see it wrap everywhere
update rehearsal.fighter set name = 'Bartholomew Fitzgerald-Montgomery of the Northern Marches' where n = 34;

insert into public.fighters (id, display_name, team_id, gender, city, region, disciplines)
  select rehearsal.fid(n), name, rehearsal.tid(team), gender, (select city from rehearsal.team t where t.n = f.team), 'Alberta', '{}' from rehearsal.fighter f;
insert into auth.users (id, email) select rehearsal.uid(n), 'f' || n || '@example.test' from rehearsal.fighter;
update public.profiles set display_name = coalesce((select name from rehearsal.fighter f where rehearsal.uid(f.n) = profiles.id), 'User ' || right(id::text, 3)), onboarded_at = now();
insert into public.fighter_accounts (fighter_id, user_id) select rehearsal.fid(n), rehearsal.uid(n) from rehearsal.fighter;
insert into public.team_memberships (fighter_id, team_id, role, from_date) select rehearsal.fid(n), rehearsal.tid(team), case when n in (1, 6, 11, 16, 21, 26, 31, 36) then 'captain' else 'fighter' end, '2025-01-15' from rehearsal.fighter;
insert into public.team_roles (team_id, user_id, role) select rehearsal.tid(team), rehearsal.uid(n), 'captain' from rehearsal.fighter where n in (1, 6, 11, 16, 21, 26, 31, 36);

-- ---------------------------------------------------------------- the plan: who enters what
-- categories are reference codes; a team category is entered FOR the fighter's team (the captain or any member registering creates the team entry)
create table rehearsal.plan (n int primary key references rehearsal.fighter, codes text[], days text default 'both', shares boolean default false,
  insurance text default 'hacsa_member', province text default 'AB', pays boolean default true, shows_up boolean default true, notes text);
insert into rehearsal.plan (n, codes) select n, '{}' from rehearsal.fighter;
-- men's longsword: 1..16 (pools then a bracket)
update rehearsal.plan set codes = codes || array['longsword'] where n between 1 and 16;
-- men's sword & shield: 5..8 and 17..21 (9: two pools of 5 and 4, then a bracket)
update rehearsal.plan set codes = codes || array['sword_shield'] where n between 5 and 8 or n between 17 and 21;
-- men's polearm: 1, 2, 3, 9, 22, 23, 24 (7: a bracket with a bye)
update rehearsal.plan set codes = codes || array['polearm'] where n in (1, 2, 3, 9, 22, 23, 24);
-- men's sword & buckler: 4, 10, 25, 26, 27 (5: round robin, where the medal tie is engineered)
update rehearsal.plan set codes = codes || array['buckler'] where n in (4, 10, 25, 26, 27);
-- men's sabre: 28 alone (1 entrant: never built)
update rehearsal.plan set codes = codes || array['sabre'] where n = 28;
-- men's 5v5: every man of teams 1..8 (eight teams); men's 3v3: teams 1..6, the first three of each
update rehearsal.plan set codes = codes || array['5v5'] where n between 1 and 40;
update rehearsal.plan set codes = codes || array['3v3'] where n between 1 and 30 and (n - 1) % 5 < 3;
-- women's longsword: 41..46 (round robin of 6); women's 3v3: teams 1..3, the first three of each (41,42,43 / 45,46,47 / 49,50,51)
update rehearsal.plan set codes = codes || array['longsword'] where n between 41 and 46;
update rehearsal.plan set codes = codes || array['3v3'] where n in (41, 42, 43, 45, 46, 47, 49, 50, 51);
-- the circumstances
update rehearsal.plan set shares = true where n in (6, 7, 44);
update rehearsal.plan set days = 'first' where n = 30;                          -- Saturday only (5v5 only)
update rehearsal.plan set days = 'second' where n = 27;                         -- Sunday only (buckler): his fights are held on day one
update rehearsal.plan set notes = 'Arriving around 11 on the first day' where n = 13;
update rehearsal.plan set notes = 'Has to leave by 15:00 on the second day' where n = 23;
update rehearsal.plan set insurance = 'proof_pending' where n = 19;             -- missing item at check-in
update rehearsal.plan set pays = false where n in (2, 33);                      -- unpaid at check-in
update rehearsal.plan set province = 'SK' where n in (25, 26);                  -- out of province: no fee
update rehearsal.plan set shows_up = false where n = 15;                        -- registered, never arrives (men's longsword and 5v5)
update rehearsal.plan set shows_up = false where n = 18;                        -- the team with one missing member (Prairie Hammers 5v5)

-- ---------------------------------------------------------------- helpers the journey calls (as the real functions, as the right people)
-- Everyone registers through submit_registration, signed in as themselves, choosing the event's competitions by category and division.
create function rehearsal.register_all(p_event uuid) returns int language plpgsql as $$
declare r record; v_comps jsonb; v_waiver uuid; v_dates jsonb; v_ev public.events; n int := 0;
begin
  select * into v_ev from public.events where id = p_event;
  select id into v_waiver from public.waiver_versions where event_id = p_event order by version desc limit 1;
  for r in select f.*, p.codes, p.days, p.shares, p.insurance, p.province, p.notes from rehearsal.fighter f join rehearsal.plan p on p.n = f.n
           where not exists (select 1 from public.registrations g where g.event_id = p_event and g.user_id = rehearsal.uid(f.n)) order by f.n loop
    select coalesce(jsonb_agg(jsonb_build_object('competition_id', k.id, 'team_id', case when rc.league = 'buhurt' then rehearsal.tid(r.team) else null end)), '[]'::jsonb) into v_comps
    from public.competitions k join public.ref_categories rc on rc.code = k.category
    where k.event_id = p_event and k.category = any (r.codes) and k.gender = case r.gender when 'male' then 'men' else 'women' end;
    if jsonb_array_length(v_comps) = 0 then continue; end if;
    v_dates := case r.days when 'first' then jsonb_build_array(v_ev.starts_on::text) when 'second' then jsonb_build_array(v_ev.ends_on::text) else jsonb_build_array(v_ev.starts_on::text, v_ev.ends_on::text) end;
    perform set_config('request.jwt.claim.sub', rehearsal.uid(r.n)::text, true);
    perform public.submit_registration(p_event, jsonb_build_object(
      'full_name', r.name, 'gender', r.gender, 'organization', 'HACSA', 'province', r.province, 'team_id', rehearsal.tid(r.team),
      'shares_equipment', r.shares, 'attend_dates', v_dates, 'availability_notes', r.notes, 'insurance', r.insurance,
      'waiver_agree', true, 'waiver_version_id', v_waiver, 'waiver_signed_name', r.name, 'competitions', v_comps,
      'private', jsonb_build_object('email', 'f' || r.n || '@example.test', 'emergency_name', 'Contact of ' || r.name, 'emergency_phone', '4035550' || lpad(r.n::text, 3, '0'), 'medically_fit', true)));
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- The organizer accepts every pending registration (the journey accepts the first few on screen; this does the rest the same way).
create function rehearsal.accept_rest(p_event uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  for r in select id from public.registrations where event_id = p_event and status = 'pending' order by created_at, id loop
    perform public.decide_registration(r.id, 'accepted'); n := n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- Fees: the organizer marks everyone paid except the two who have not paid (the real function, as the organizer).
create function rehearsal.mark_fees(p_event uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  for r in select g.id from public.registrations g join rehearsal.fighter f on rehearsal.uid(f.n) = g.user_id join rehearsal.plan p on p.n = f.n
           where g.event_id = p_event and g.fee_due_cents > 0 and p.pays loop
    perform public.set_registration_paid(r.id, true); n := n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- Check-in: everyone who shows up, as the organizer, through the real function (the journey does a few on screen first).
create function rehearsal.checkin_rest(p_event uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  for r in select g.id from public.registrations g join rehearsal.fighter f on rehearsal.uid(f.n) = g.user_id join rehearsal.plan p on p.n = f.n
           where g.event_id = p_event and g.status = 'accepted' and p.shows_up
             and not exists (select 1 from public.registration_checks c where c.registration_id = g.id and c.check_name = 'checked_in' and c.passed) loop
    perform public.set_registration_check(r.id, 'checked_in', true); n := n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- Team rosters: each team entry gets the fighters who registered for that team competition (the organizer, through set_entry_roster).
create function rehearsal.set_rosters(p_event uuid) returns int language plpgsql as $$
declare e record; v_list jsonb; n int := 0;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
  for e in select en.id, en.team_id, en.competition_id from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = p_event and en.team_id is not null order by k.sort, en.id loop
    select coalesce(jsonb_agg(jsonb_build_object('fighter_id', g.fighter_id) order by g.fighter_id), '[]'::jsonb) into v_list
    from public.registrations g join public.registration_competitions rc on rc.registration_id = g.id
    where g.event_id = p_event and g.status = 'accepted' and rc.competition_id = e.competition_id and rc.team_id = e.team_id and g.fighter_id is not null;
    if jsonb_array_length(v_list) > 0 then perform public.set_entry_roster(e.id, v_list); n := n + 1; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

grant usage on schema rehearsal to postgres;
