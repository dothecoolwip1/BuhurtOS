-- HACSA teams, loaded from https://www.hacsacanada.com/teams (page content pasted by the BuhurtOS owner, 2026-10-01).
-- Rules for this file: only what that page states. Team names and cities are as listed there. Provinces are added by BuhurtOS from the city names.
-- No captains' emails, phone numbers or personal chat links are loaded. Imported teams have no captain until a real captain claims them.
-- Idempotent: safe to run twice. Run as the database owner (the API roles cannot write these tables).
do $$
declare
  v_src uuid; v_org uuid; v_team uuid; v_aff uuid; r record;
begin
  select id into v_src from public.sources where url = 'https://www.hacsacanada.com/teams';
  if v_src is null then
    insert into public.sources (kind, title, url, citation, retrieved_on)
    values ('imported', 'HACSA website: Teams list', 'https://www.hacsacanada.com/teams',
            'Page content pasted by the BuhurtOS owner. Names and cities as listed on the page; provinces added by BuhurtOS.', '2026-10-01')
    returning id into v_src;
  end if;

  insert into public.organizations (slug, name, kind, country, website)
  values ('hacsa', 'HACSA', 'national', 'CA', 'https://www.hacsacanada.com') on conflict (slug) do nothing;
  select id into v_org from public.organizations where slug = 'hacsa';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note)
  values (v_src, 'organization', v_org, 'imported', 'Named HACSA on its own website; full name to be confirmed from an official page') on conflict do nothing;

  for r in select * from (values
    ('company-of-the-silver-gryphons', 'The Company of the Silver Gryphons', 'Calgary (North)',  'AB', 'S'),
    ('horde-drayton-valley',           'Horde',                              'Drayton Valley',   'AB', 'H'),
    ('crimson-blades-west-edmonton',   'The Crimson Blades',                 'West Edmonton',    'AB', 'C'),
    ('company-of-the-black-spears',    'The Company of the Black Spears',    'Lethbridge',       'AB', 'B'),
    ('mace-company-manitoba',          'Mace Company Manitoba',              'Winnipeg',         'MB', 'M'),
    ('red-deer-reavers',               'Red Deer Reavers',                   'Red Deer',         'AB', 'R'),
    ('oath-bearers-regina',            'The Oath Bearers',                   'Regina',           'SK', 'O'),
    ('vanguard-vancouver',             'Vanguard',                           'Vancouver',        'BC', 'V'),
    ('strathcona-warhorse',            'Strathcona Warhorse',                'East Edmonton',    'AB', 'W'),
    ('arverni-legion',                 'Arverni Legion',                     'Alberta Foothills','AB', 'A')
  ) as t(slug, name, city, region, initial) loop
    insert into public.teams (slug, name, city, region, country, initial, status)
    values (r.slug, r.name, r.city, r.region, 'CA', r.initial, 'approved') on conflict (slug) do nothing;
    select id into v_team from public.teams where slug = r.slug;

    insert into public.team_affiliations (team_id, organization_id, relation) values (v_team, v_org, 'member') on conflict do nothing;
    select id into v_aff from public.team_affiliations where team_id = v_team and organization_id = v_org and relation = 'member';

    insert into public.record_sources (source_id, entity_type, entity_id, status, note)
    values (v_src, 'team', v_team, 'imported', 'Listed on HACSA''s teams page') on conflict do nothing;
    insert into public.record_sources (source_id, entity_type, entity_id, status, note)
    values (v_src, 'team_affiliation', v_aff, 'imported', 'Listed under HACSA TEAMS on the HACSA website') on conflict do nothing;
  end loop;
end $$;
