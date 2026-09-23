-- Event organizer workflows: registration review and transactional roster promotion.

create or replace function public.review_event_registration(
  p_registration_id uuid,
  p_status public.registration_status
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registration public.event_registrations%rowtype;
  v_event public.events%rowtype;
  v_team_id uuid;
  v_fighter_id uuid;
  v_roster_id uuid;
begin
  if p_status not in ('approved','waitlisted','withdrawn','rejected') then
    raise exception 'Unsupported registration review status';
  end if;

  select * into v_registration
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then raise exception 'Registration not found'; end if;

  select * into v_event
  from public.events
  where id = v_registration.event_id;

  if not found then raise exception 'Event not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()), v_event.organization_id, array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()), v_event.id, array['event_organizer']::public.event_role[])
  ) then
    raise exception 'Not authorized to review registrations';
  end if;

  update public.event_registrations
  set status = p_status
  where id = p_registration_id;

  if p_status = 'approved' then
    if v_registration.team_name is not null then
      select id into v_team_id
      from public.teams
      where organization_id = v_event.organization_id
        and lower(name) = lower(v_registration.team_name)
        and is_active
      order by created_at
      limit 1;
    end if;

    select id into v_fighter_id
    from public.fighters
    where organization_id = v_event.organization_id
      and lower(name) = lower(v_registration.display_name)
      and team_id is not distinct from v_team_id
      and is_active
    order by created_at
    limit 1;

    if v_fighter_id is null then
      insert into public.fighters(
        organization_id, team_id, name, preferred_weapons, created_by, last_edited_by
      )
      values (
        v_event.organization_id, v_team_id, v_registration.display_name, array[v_registration.category], (select auth.uid()), (select auth.uid())
      )
      returning id into v_fighter_id;
    end if;

    select id into v_roster_id
    from public.event_roster_entries
    where event_id = v_event.id
      and fighter_id = v_fighter_id
    limit 1;

    if v_roster_id is null then
      insert into public.event_roster_entries(
        organization_id,event_id,team_id,fighter_id,entry_type,display_name,
        waiver_confirmed,attendance_status,metadata,created_by,last_edited_by
      )
      values (
        v_event.organization_id,v_event.id,v_team_id,v_fighter_id,'fighter',v_registration.display_name,
        v_registration.waiver_acknowledged,'approved',
        jsonb_build_object('registrationId',v_registration.id,'category',v_registration.category,'submittedTeamName',v_registration.team_name),
        (select auth.uid()),(select auth.uid())
      )
      returning id into v_roster_id;
    else
      update public.event_roster_entries
      set attendance_status='approved',
          waiver_confirmed = waiver_confirmed or v_registration.waiver_acknowledged,
          last_edited_by=(select auth.uid())
      where id=v_roster_id;
    end if;
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_event.organization_id,v_event.id,(select auth.uid()),'event_registrations',v_registration.id,'review_registration',
    jsonb_build_object('from',v_registration.status,'to',p_status,'rosterEntryId',v_roster_id,'fighterId',v_fighter_id)
  );

  return v_roster_id;
end;
$$;

revoke execute on function public.review_event_registration(uuid,public.registration_status) from public, anon;
grant execute on function public.review_event_registration(uuid,public.registration_status) to authenticated;
