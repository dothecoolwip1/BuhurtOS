-- Team review: merge duplicate teams (organizers) and a roster clearance view for captains. Additive; nothing is dropped except the merged-away team row.

-- Merge p_remove into p_keep. Every row that points at the removed team is repointed to the kept team in one transaction.
-- Tables that reference teams (checked against every migration): entries, registrations, registration_competitions, fighters,
-- team_roles, team_affiliations, team_memberships, events.host_team_id. Matches and results hang off entries, so they follow.
-- Refused when both teams have an entry in the same competition: an organizer must resolve that by hand first.
create or replace function public.merge_teams(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_keep public.teams; v_remove public.teams;
  n_entries int; n_regs int; n_regcomps int; n_fighters int; n_roles int; n_affil int; n_members int; n_hosts int;
begin
  if not private.is_any_organizer() then raise exception 'only an organizer can merge teams' using errcode = '42501'; end if;
  if p_keep is null or p_remove is null or p_keep = p_remove then raise exception 'choose two different teams' using errcode = '22023'; end if;
  -- Lock in a stable order so two organizers merging the same pair cannot deadlock.
  perform 1 from public.teams where id in (p_keep, p_remove) order by id for update;
  select * into v_keep from public.teams where id = p_keep;
  select * into v_remove from public.teams where id = p_remove;
  if v_keep.id is null or v_remove.id is null then raise exception 'team not found' using errcode = 'P0002'; end if;
  if v_keep.status <> 'approved' and v_remove.status = 'approved' then
    raise exception 'keep the approved team, or approve the kept team first' using errcode = '22023'; end if;
  if exists (select 1 from public.entries a join public.entries b on b.competition_id = a.competition_id
             where a.team_id = p_keep and b.team_id = p_remove) then
    raise exception 'both teams have an entry in the same competition; withdraw one entry first' using errcode = '22023'; end if;

  update public.entries set team_id = p_keep where team_id = p_remove;
  get diagnostics n_entries = row_count;
  update public.registrations set team_id = p_keep where team_id = p_remove;
  get diagnostics n_regs = row_count;
  update public.registration_competitions set team_id = p_keep where team_id = p_remove;
  get diagnostics n_regcomps = row_count;
  update public.fighters set team_id = p_keep where team_id = p_remove;
  get diagnostics n_fighters = row_count;
  update public.team_memberships set team_id = p_keep where team_id = p_remove;
  get diagnostics n_members = row_count;
  update public.events set host_team_id = p_keep where host_team_id = p_remove;
  get diagnostics n_hosts = row_count;

  -- Captains: keep one row per person.
  delete from public.team_roles r where r.team_id = p_remove and exists (select 1 from public.team_roles k where k.team_id = p_keep and k.user_id = r.user_id);
  update public.team_roles set team_id = p_keep where team_id = p_remove;
  get diagnostics n_roles = row_count;
  -- Affiliations are unique per (team, organization, relation): drop the removed team's copy of any the kept team already has.
  delete from public.team_affiliations a where a.team_id = p_remove and exists (
    select 1 from public.team_affiliations k where k.team_id = p_keep and k.organization_id = a.organization_id and k.relation = a.relation);
  update public.team_affiliations set team_id = p_keep where team_id = p_remove;
  get diagnostics n_affil = row_count;

  delete from public.teams where id = p_remove;
  perform private.audit(null, 'team.merged', p_keep::text, jsonb_build_object('removed', p_remove, 'removed_slug', v_remove.slug, 'removed_name', v_remove.name,
    'moved', jsonb_build_object('entries', n_entries, 'registrations', n_regs, 'registration_competitions', n_regcomps, 'fighters', n_fighters,
      'team_roles', n_roles, 'team_affiliations', n_affil, 'team_memberships', n_members, 'host_events', n_hosts)));
end $$;
revoke execute on function public.merge_teams(uuid, uuid) from public, anon;
grant execute on function public.merge_teams(uuid, uuid) to authenticated;

-- A team's registered people for one event, and what each still lacks. For the team's captain and the event's organizers.
-- Deliberately returns no emergency contact, no medical declaration and no medical note. Insurance is a yes/no, not the private state.
-- Declined and withdrawn registrations are left out.
create or replace function public.team_clearance(p_event uuid, p_team uuid)
returns table (registration_id uuid, full_name text, status text, is_volunteer boolean, waiver_signed boolean, insurance_ok boolean, checked_in boolean, kit_passed boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.is_team_captain(p_team) or private.is_organizer(p_event)) then
    raise exception 'only the team captain or an organizer can see this' using errcode = '42501'; end if;
  return query
  select r.id, r.full_name, r.status, r.is_volunteer, true,
    r.insurance in ('hacsa_member', 'mcc_member', 'proof_received'),
    coalesce((select bool_or(c.passed) from public.registration_checks c where c.registration_id = r.id and c.check_name = 'checked_in'), false),
    coalesce((select bool_or(c.passed) from public.registration_checks c where c.registration_id = r.id and c.check_name = 'kit'), false)
  from public.registrations r
  where r.event_id = p_event and r.status in ('pending', 'accepted')
    and (r.team_id = p_team or exists (
      select 1 from public.registration_competitions rc join public.competitions k on k.id = rc.competition_id
      where rc.registration_id = r.id and rc.team_id = p_team and k.event_id = p_event))
  order by r.full_name;
end $$;
revoke execute on function public.team_clearance(uuid, uuid) from public, anon;
grant execute on function public.team_clearance(uuid, uuid) to authenticated;
