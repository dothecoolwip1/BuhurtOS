-- TEST DATASET (not real). A fictional tournament big enough to run every competition format end to end.
-- Nothing here is real sporting history: every record is named TEST / Test and is tagged with a "TEST DATA" source (docs/VISION.md, "Real data matters").
--
-- What it creates (all fictional):
--   1 organization  'TEST Organization (not real)'                      slug test-organization
--   1 source        'TEST DATA (not real): BuhurtOS test tournament'    (every record below is linked to it, status 'unverified')
--   16 teams        'TEST Team 01'..'TEST Team 16'                      slug test-team-01.., status 'pending' (never in the registration team picker)
--   128 fighters    'Test Fighter 001'..'Test Fighter 128'              8 per team, with team_memberships (role 'fighter')
--   1 event         'TEST Tournament (not a real event)'                slug test-tournament, status 'draft' (never public), 2027-06-12 to 2027-06-13
--   8 competitions (no tier, no ruleset: no league points can follow from this data)
--       TEST Melee 5v5 (men)     5v5          16 teams   pools_elimination
--       TEST Melee 5v5 (women)   5v5           6 teams   round_robin
--       TEST Melee 3v3 (men)     3v3           8 teams   elimination (third place)
--       TEST Longsword           longsword    16 fighters elimination
--       TEST Sword and Shield    sword_shield 12 fighters elimination (byes)
--       TEST Sword and Buckler   buckler       8 fighters elimination
--       TEST Polearm             polearm       8 fighters elimination
--       TEST Profight            profight      8 fighters elimination
--   entries for each competition (teams for group fights, fighters for duels and profight).
--
-- Not created on purpose: auth users, registrations, event staff, results, tier points, league data.
-- The draft event has NO staff. The platform owner reaches it through platform_roles (owner rights come from private.is_owner()),
-- so the owner can open it in the organizer workspace and run it. To rehearse as someone else, the owner adds staff by email in the app.
--
-- Visibility: the event, competitions, entries and matches are hidden from the public while the event is a draft (row-level security).
-- Teams are 'pending', so they are hidden from the public too. Organizations, sources and fighters are public by design in this schema,
-- so the labelled test organization, test source and 'Test Fighter NNN' rows are readable by anyone with the API key until cleaned up.
--
-- Idempotent: safe to run twice (the second run changes nothing). Run as the database owner, never against a database with real data you
-- are not prepared to inspect. Remove everything with supabase/seed/test_tournament_cleanup.sql.
do $$
declare
  c_src_title constant text := 'TEST DATA (not real): BuhurtOS test tournament';
  v_src uuid; v_org uuid; v_ev uuid; v_team uuid; v_f uuid; v_comp uuid; r record; i int; k int;
  n_before int; n_after int;
begin
  -- Guards: never adopt or alter a look-alike row that is not ours.
  if exists (select 1 from public.events where slug = 'test-tournament' and name <> 'TEST Tournament (not a real event)') then
    raise exception 'an event with slug test-tournament exists but is not the test event; refusing'; end if;
  if exists (select 1 from public.events where slug = 'test-tournament' and status <> 'draft') then
    raise exception 'the test event is no longer a draft; refusing to touch it'; end if;
  if exists (select 1 from public.organizations where slug = 'test-organization' and name <> 'TEST Organization (not real)') then
    raise exception 'an organization with slug test-organization exists but is not the test organization; refusing'; end if;
  if exists (select 1 from public.teams t where t.slug ~ '^test-team-(0[1-9]|1[0-6])$' and t.name <> 'TEST Team ' || right(t.slug, 2)) then
    raise exception 'a team with a test-team-NN slug exists but is not a test team; refusing'; end if;

  select count(*) into n_before from public.fighters where display_name ~ '^Test Fighter [0-9]{3}$';

  select id into v_src from public.sources where title = c_src_title;
  if v_src is null then
    insert into public.sources (kind, title, citation, synthetic)
    values ('submitted', c_src_title, 'Fictional records created by supabase/seed/test_tournament.sql so organizers can rehearse a full tournament. Nothing here happened.', true)
    returning id into v_src;
  end if;

  insert into public.organizations (slug, name, kind) values ('test-organization', 'TEST Organization (not real)', 'other') on conflict (slug) do nothing;
  select id into v_org from public.organizations where slug = 'test-organization';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note)
  values (v_src, 'organization', v_org, 'unverified', 'TEST DATA: fictional') on conflict do nothing;

  insert into public.events (slug, name, description, event_type, status, venue, city, region, country, timezone, starts_on, ends_on)
  values ('test-tournament', 'TEST Tournament (not a real event)',
          'TEST DATA. This is a fictional tournament used only to rehearse running a full competition. It never took place and nobody listed here is real.',
          'tournament', 'draft', 'TEST venue (not real)', 'Test City', 'XX', 'CA', 'America/Edmonton', date '2027-06-12', date '2027-06-13')
  on conflict (slug) do nothing;
  select id into v_ev from public.events where slug = 'test-tournament';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note)
  values (v_src, 'event', v_ev, 'unverified', 'TEST DATA: fictional') on conflict do nothing;

  -- Teams, fighters (8 per team), memberships.
  for i in 1..16 loop
    insert into public.teams (slug, name, initial, status)
    values ('test-team-' || lpad(i::text, 2, '0'), 'TEST Team ' || lpad(i::text, 2, '0'), 'T', 'pending') on conflict (slug) do nothing;
    select id into v_team from public.teams where slug = 'test-team-' || lpad(i::text, 2, '0');
    insert into public.record_sources (source_id, entity_type, entity_id, status, note)
    values (v_src, 'team', v_team, 'unverified', 'TEST DATA: fictional') on conflict do nothing;
    insert into public.team_affiliations (team_id, organization_id, relation) values (v_team, v_org, 'other') on conflict do nothing;

    for k in 1..8 loop
      select id into v_f from public.fighters where display_name = 'Test Fighter ' || lpad(((i - 1) * 8 + k)::text, 3, '0');
      if v_f is null then
        insert into public.fighters (display_name, team_id) values ('Test Fighter ' || lpad(((i - 1) * 8 + k)::text, 3, '0'), v_team) returning id into v_f;
      end if;
      insert into public.record_sources (source_id, entity_type, entity_id, status, note)
      values (v_src, 'fighter', v_f, 'unverified', 'TEST DATA: fictional') on conflict do nothing;
      insert into public.team_memberships (fighter_id, team_id, role)
      select v_f, v_team, 'fighter' where not exists (select 1 from public.team_memberships m where m.fighter_id = v_f and m.team_id = v_team);
    end loop;
  end loop;

  -- Competitions. No tier and no ruleset on purpose.
  for r in select * from (values
    (10, 'TEST Melee 5v5 (men)',   '5v5',          'men',   'pools_elimination', 2),
    (11, 'TEST Melee 5v5 (women)', '5v5',          'women', 'round_robin',       2),
    (12, 'TEST Melee 3v3 (men)',   '3v3',          'men',   'elimination',       2),
    (20, 'TEST Longsword',         'longsword',    'open',  'elimination',       null),
    (22, 'TEST Sword and Shield',  'sword_shield', 'open',  'elimination',       null),
    (24, 'TEST Sword and Buckler', 'buckler',      'open',  'elimination',       null),
    (26, 'TEST Polearm',           'polearm',      'open',  'elimination',       null),
    (40, 'TEST Profight',          'profight',     'open',  'elimination',       null)
  ) as t(sort, name, category, gender, structure, rtw) loop
    insert into public.competitions (event_id, name, category, gender, structure, rounds_to_win, sort)
    select v_ev, r.name, r.category, r.gender, r.structure, r.rtw, r.sort
    where not exists (select 1 from public.competitions c where c.event_id = v_ev and c.name = r.name);
    select id into v_comp from public.competitions where event_id = v_ev and name = r.name;
    insert into public.record_sources (source_id, entity_type, entity_id, status, note)
    values (v_src, 'competition', v_comp, 'unverified', 'TEST DATA: fictional') on conflict do nothing;
  end loop;

  -- Entries. Group fights: teams 1..16 (men 5v5), 1..6 (women 5v5), 1..8 (men 3v3). Duels use the n-th fighter of successive teams.
  for r in select * from (values
    ('TEST Melee 5v5 (men)',   'team',    16, 0),
    ('TEST Melee 5v5 (women)', 'team',     6, 0),
    ('TEST Melee 3v3 (men)',   'team',     8, 0),
    ('TEST Longsword',         'fighter', 16, 1),
    ('TEST Sword and Shield',  'fighter', 12, 2),
    ('TEST Sword and Buckler', 'fighter',  8, 3),
    ('TEST Polearm',           'fighter',  8, 4),
    ('TEST Profight',          'fighter',  8, 5)
  ) as t(comp, kind, n, nth) loop
    select id into v_comp from public.competitions where event_id = v_ev and name = r.comp;
    for i in 1..r.n loop
      if r.kind = 'team' then
        insert into public.entries (competition_id, team_id, seed)
        select v_comp, t.id, i from public.teams t where t.slug = 'test-team-' || lpad(i::text, 2, '0') on conflict (competition_id, team_id) do nothing;
      else
        insert into public.entries (competition_id, fighter_id, seed)
        select v_comp, f.id, i from public.fighters f where f.display_name = 'Test Fighter ' || lpad(((i - 1) * 8 + r.nth)::text, 3, '0')
        on conflict (competition_id, fighter_id) do nothing;
      end if;
    end loop;
  end loop;

  select count(*) into n_after from public.fighters where display_name ~ '^Test Fighter [0-9]{3}$';
  raise notice 'test_tournament seed done: % fighters before, % after', n_before, n_after;
end $$;
