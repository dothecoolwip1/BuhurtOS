-- NACL-test cleanup: deletes exactly the rows the NACL-test dataset created, in foreign-key-safe order, and REFUSES to run if anything it
-- would delete (or anything that still depends on it) is not a NACL-test row. Run as the database owner (postgres / SQL editor), in one go.
--
-- The dataset's manifest is the set of record_sources rows of the source titled 'NACL-test fictional dataset': every organization, season,
-- team, affiliation, fighter, membership, event, competition and result has one. Entries, rosters, matches and audit rows are children of those
-- competitions and events and are removed with them. Nothing is matched by name patterns alone.
begin;

create temp table c_src on commit drop as select id from public.sources where title = 'NACL-test fictional dataset';
create temp table c_rs on commit drop as select r.entity_type, r.entity_id from public.record_sources r where r.source_id in (select id from c_src);
create temp table c_org on commit drop as select entity_id id from c_rs where entity_type = 'organization';
create temp table c_season on commit drop as select entity_id id from c_rs where entity_type = 'season';
create temp table c_team on commit drop as select entity_id id from c_rs where entity_type = 'team';
create temp table c_aff on commit drop as select entity_id id from c_rs where entity_type = 'team_affiliation';
create temp table c_fighter on commit drop as select entity_id id from c_rs where entity_type = 'fighter';
create temp table c_member on commit drop as select entity_id id from c_rs where entity_type = 'team_membership';
create temp table c_event on commit drop as select entity_id id from c_rs where entity_type = 'event';
create temp table c_comp on commit drop as select k.id from public.competitions k where k.event_id in (select id from c_event);

do $$
begin
  if not exists (select 1 from c_src) then raise exception 'refusing: the source "NACL-test fictional dataset" does not exist, so there is nothing to clean'; end if;
  -- Every listed row must be a test row.
  if exists (select 1 from public.organizations o where o.id in (select id from c_org) and (o.slug <> 'nacl-test' or o.name not like '%-test')) then raise exception 'refusing: a listed organization is not NACL-test'; end if;
  if exists (select 1 from public.seasons s where s.id in (select id from c_season) and (s.slug not like 'nacl-test-%' or s.organization_id not in (select id from c_org))) then raise exception 'refusing: a listed season is not a NACL-test season'; end if;
  if exists (select 1 from public.teams t where t.id in (select id from c_team) and (t.name not like '%-test' or t.slug not like '%-test')) then raise exception 'refusing: a listed team is not a -test team'; end if;
  if exists (select 1 from public.fighters f where f.id in (select id from c_fighter) and f.display_name not like '%-test') then raise exception 'refusing: a listed fighter is not a -test fighter'; end if;
  if exists (select 1 from public.events e where e.id in (select id from c_event) and (e.name not like '%-test' or e.slug not like '%-test' or e.organization_id not in (select id from c_org))) then raise exception 'refusing: a listed event is not a NACL-test event'; end if;
  if exists (select 1 from public.team_affiliations a where a.id in (select id from c_aff) and a.organization_id not in (select id from c_org)) then raise exception 'refusing: a listed affiliation is not to NACL-test'; end if;
  -- Nothing else may hang on the rows being removed.
  if exists (select 1 from public.events e where e.organization_id in (select id from c_org) and e.id not in (select id from c_event)) then raise exception 'refusing: another event is linked to the NACL-test organization'; end if;
  if exists (select 1 from public.events e where e.season_id in (select id from c_season) and e.id not in (select id from c_event)) then raise exception 'refusing: another event uses a NACL-test season'; end if;
  if exists (select 1 from public.team_affiliations a where a.organization_id in (select id from c_org) and a.id not in (select id from c_aff)) then raise exception 'refusing: another team is affiliated to NACL-test'; end if;
  if exists (select 1 from public.entries e where (e.fighter_id in (select id from c_fighter) or e.team_id in (select id from c_team)) and e.competition_id not in (select id from c_comp)) then raise exception 'refusing: a NACL-test fighter or team has an entry in a non-test competition'; end if;
  if exists (select 1 from public.entry_fighters ef where ef.fighter_id in (select id from c_fighter) and ef.competition_id not in (select id from c_comp)) then raise exception 'refusing: a NACL-test fighter is on a roster of a non-test competition'; end if;
  if exists (select 1 from public.entry_fighters ef where ef.competition_id in (select id from c_comp) and ef.fighter_id not in (select id from c_fighter)) then raise exception 'refusing: a non-test fighter is on a NACL-test roster'; end if;
  if exists (select 1 from public.entries e where e.competition_id in (select id from c_comp) and ((e.fighter_id is not null and e.fighter_id not in (select id from c_fighter)) or (e.team_id is not null and e.team_id not in (select id from c_team)))) then raise exception 'refusing: a NACL-test competition has a non-test entry'; end if;
  if exists (select 1 from public.fighters f where f.team_id in (select id from c_team) and f.id not in (select id from c_fighter)) then raise exception 'refusing: a non-test fighter belongs to a NACL-test team'; end if;
  if exists (select 1 from public.team_memberships m where (m.fighter_id in (select id from c_fighter) or m.team_id in (select id from c_team)) and m.id not in (select id from c_member)) then raise exception 'refusing: a membership of a NACL-test fighter or team is not in the manifest'; end if;
  if exists (select 1 from public.fighter_accounts a where a.fighter_id in (select id from c_fighter)) then raise exception 'refusing: a NACL-test fighter is claimed by an account'; end if;
  if exists (select 1 from public.team_roles r where r.team_id in (select id from c_team)) then raise exception 'refusing: a NACL-test team has a captain account'; end if;
  if exists (select 1 from public.registrations g where g.event_id in (select id from c_event)) then raise exception 'refusing: a NACL-test event has registrations'; end if;
end $$;

delete from public.audit_log where event_id in (select id from c_event);
delete from public.record_sources where source_id in (select id from c_src);
delete from public.results where competition_id in (select id from c_comp);
delete from public.matches where competition_id in (select id from c_comp);
delete from public.entry_fighters where competition_id in (select id from c_comp);
delete from public.entries where competition_id in (select id from c_comp);
delete from public.competitions where id in (select id from c_comp);
delete from public.events where id in (select id from c_event);
delete from public.team_memberships where id in (select id from c_member);
delete from public.team_affiliations where id in (select id from c_aff);
delete from public.fighters where id in (select id from c_fighter);
delete from public.teams where id in (select id from c_team);
delete from public.seasons where id in (select id from c_season);
delete from public.organizations where id in (select id from c_org);
delete from public.sources where id in (select id from c_src);

do $$
begin
  if exists (select 1 from public.organizations where slug = 'nacl-test') or exists (select 1 from public.fighters where display_name like '%-test' and id in (select id from c_fighter))
     or exists (select 1 from public.events where id in (select id from c_event)) or exists (select 1 from public.teams where id in (select id from c_team)) then
    raise exception 'cleanup left NACL-test rows behind; nothing was committed';
  end if;
end $$;
commit;
select 'NACL-test dataset removed' as result;
