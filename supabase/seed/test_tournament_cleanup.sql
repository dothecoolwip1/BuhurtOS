-- Removes exactly the rows created by supabase/seed/test_tournament.sql (and whatever was generated on top of them for the
-- test event: matches, score events, results, staff, waivers, audit rows). Run as the database owner.
-- It is one transaction: if anything it would touch is not a test row, or any test row is left behind, it raises and changes nothing.
--
-- A test row is identified by BOTH its marker (slug / name pattern) AND its link to the TEST DATA source or the test event.
-- It refuses to run if a real-world record points at test data:
--   * a registration for the test event, or a registration / registration_competition that names a test team or fighter
--   * a fighter account (login) or team captain role on a test fighter or team
--   * an entry of a NON-test competition for a test team or fighter, or a team membership of a test fighter in a non-test team
--   * another event hosted by a test team, or a non-test fighter or competition that points at a test team
--   * a source link of a non-test source on a test row is NOT a reason to refuse (it is simply removed with the row)
-- Event staff, waivers, matches, score events, results and audit_log rows of the test event are deleted: they belong to the test event.
do $$
declare
  c_src_title constant text := 'TEST DATA (not real): BuhurtOS test tournament';
  v_src uuid; v_ev uuid; v_org uuid;
  v_teams uuid[]; v_fighters uuid[]; v_comps uuid[];
  n int; n_total int := 0; v_left int;
begin
  select id into v_src from public.sources where title = c_src_title;
  select id into v_ev from public.events where slug = 'test-tournament' and name = 'TEST Tournament (not a real event)';
  select id into v_org from public.organizations where slug = 'test-organization' and name = 'TEST Organization (not real)';
  if exists (select 1 from public.events where slug = 'test-tournament') and v_ev is null then
    raise exception 'an event with slug test-tournament exists but is not the test event; refusing'; end if;
  if v_ev is not null and exists (select 1 from public.events where id = v_ev and status <> 'draft') then
    raise exception 'the test event is not a draft any more; refusing'; end if;

  select coalesce(array_agg(id), '{}') into v_teams from public.teams
    where slug ~ '^test-team-(0[1-9]|1[0-6])$' and name = 'TEST Team ' || right(slug, 2);
  if (select count(*) from public.teams where slug like 'test-team-%') <> cardinality(v_teams) then
    raise exception 'a team with a test-team- slug is not a test team; refusing'; end if;
  select coalesce(array_agg(id), '{}') into v_fighters from public.fighters
    where display_name ~ '^Test Fighter [0-9]{3}$'
      and (team_id = any (v_teams) or id in (select entity_id from public.record_sources where source_id = v_src and entity_type = 'fighter'));
  select coalesce(array_agg(id), '{}') into v_comps from public.competitions where event_id = v_ev and name like 'TEST %';
  if v_ev is not null and (select count(*) from public.competitions where event_id = v_ev) <> cardinality(v_comps) then
    raise exception 'the test event has a competition whose name does not start with TEST; refusing'; end if;

  -- ---- refuse when anything real is attached
  if v_ev is not null and exists (select 1 from public.registrations where event_id = v_ev) then
    raise exception 'the test event has registrations (real people''s data); refusing'; end if;
  if exists (select 1 from public.registrations where team_id = any (v_teams) or fighter_id = any (v_fighters)) then
    raise exception 'a registration points at a test team or fighter; refusing'; end if;
  if exists (select 1 from public.registration_competitions where team_id = any (v_teams) or competition_id = any (v_comps)) then
    raise exception 'a registration choice points at a test team or competition; refusing'; end if;
  if exists (select 1 from public.fighter_accounts where fighter_id = any (v_fighters)) then
    raise exception 'a test fighter is linked to a login; refusing'; end if;
  if exists (select 1 from public.team_roles where team_id = any (v_teams)) then
    raise exception 'a test team has a captain account; refusing'; end if;
  if exists (select 1 from public.entries e where (e.team_id = any (v_teams) or e.fighter_id = any (v_fighters)) and not (e.competition_id = any (v_comps))) then
    raise exception 'a test team or fighter is entered in a non-test competition; refusing'; end if;
  if exists (select 1 from public.entries e where e.competition_id = any (v_comps) and e.team_id is not null and not (e.team_id = any (v_teams))) or
     exists (select 1 from public.entries e where e.competition_id = any (v_comps) and e.fighter_id is not null and not (e.fighter_id = any (v_fighters))) then
    raise exception 'a test competition has an entry that is not a test team or fighter; refusing'; end if;
  if exists (select 1 from public.team_memberships m where (m.fighter_id = any (v_fighters)) <> (m.team_id = any (v_teams))) then
    raise exception 'a team membership links a test row to a non-test row; refusing'; end if;
  if exists (select 1 from public.fighters f where f.team_id = any (v_teams) and not (f.id = any (v_fighters))) then
    raise exception 'a non-test fighter belongs to a test team; refusing'; end if;
  if exists (select 1 from public.events e where e.host_team_id = any (v_teams) and e.id is distinct from v_ev) then
    raise exception 'another event is hosted by a test team; refusing'; end if;
  if exists (select 1 from public.team_affiliations a where a.team_id = any (v_teams) and a.organization_id is distinct from v_org) then
    raise exception 'a test team has an affiliation with a real organization; refusing'; end if;
  if v_org is not null and exists (select 1 from public.team_affiliations a where a.organization_id = v_org and not (a.team_id = any (v_teams))) then
    raise exception 'a real team is affiliated with the test organization; refusing'; end if;
  if v_org is not null and exists (select 1 from public.rulesets where organization_id = v_org) then
    raise exception 'a ruleset belongs to the test organization; refusing'; end if;
  if v_org is not null and exists (select 1 from public.seasons where organization_id = v_org) then
    raise exception 'a season belongs to the test organization; refusing'; end if;
  if v_ev is not null and exists (select 1 from public.events where id = v_ev and season_id is not null) then
    raise exception 'the test event is in a season; refusing'; end if;

  -- ---- delete, children first
  if v_ev is not null then
    delete from public.audit_log where event_id = v_ev;                       get diagnostics n = row_count; n_total := n_total + n;
    delete from public.competitions where id = any (v_comps);                 get diagnostics n = row_count; n_total := n_total + n;  -- cascades entries, matches, score_events, results
    delete from public.events where id = v_ev;                                get diagnostics n = row_count; n_total := n_total + n;  -- cascades staff, waivers
  end if;
  delete from public.team_memberships where fighter_id = any (v_fighters) or team_id = any (v_teams);  get diagnostics n = row_count; n_total := n_total + n;
  delete from public.team_affiliations where team_id = any (v_teams);         get diagnostics n = row_count; n_total := n_total + n;
  delete from public.fighters where id = any (v_fighters);                    get diagnostics n = row_count; n_total := n_total + n;
  delete from public.teams where id = any (v_teams);                          get diagnostics n = row_count; n_total := n_total + n;
  if v_org is not null then delete from public.organizations where id = v_org; get diagnostics n = row_count; n_total := n_total + n; end if;
  if v_src is not null then
    delete from public.record_sources where source_id = v_src;                get diagnostics n = row_count; n_total := n_total + n;
    delete from public.sources where id = v_src;                              get diagnostics n = row_count; n_total := n_total + n;
  end if;

  -- ---- verify nothing of the test data is left
  select (select count(*) from public.events where slug = 'test-tournament')
       + (select count(*) from public.organizations where slug = 'test-organization')
       + (select count(*) from public.teams where slug like 'test-team-%')
       + (select count(*) from public.fighters where display_name ~ '^Test Fighter [0-9]{3}$')
       + (select count(*) from public.sources where title = c_src_title)
       + (select count(*) from public.competitions where name like 'TEST %' and category in (select code from public.ref_categories) and event_id = v_ev)
       + (select count(*) from public.record_sources where note = 'TEST DATA: fictional')
    into v_left;
  if v_left <> 0 then raise exception 'cleanup left % test rows behind; rolled back', v_left; end if;
  raise notice 'test_tournament cleanup done: % rows deleted (direct deletes, cascades not counted), 0 test rows left', n_total;
end $$;
