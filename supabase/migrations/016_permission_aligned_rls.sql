-- Align legacy event RLS with normalized capabilities and constrain specialist writes.

-- Event visibility and administration.
drop policy if exists events_public_read on public.events;
drop policy if exists events_staff_read on public.events;
drop policy if exists events_staff_write on public.events;
create policy events_public_read on public.events for select to anon,authenticated
using (status in ('published','live','completed'));
create policy events_staff_read on public.events for select to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[])
  or private.user_has_permission((select auth.uid()),'event.view_private',organization_id,id,null)
);
create policy events_staff_write on public.events for all to authenticated
using (private.user_has_permission((select auth.uid()),'event.manage',organization_id,id,null))
with check (private.user_has_permission((select auth.uid()),'event.manage',organization_id,id,null));

drop policy if exists event_memberships_self_read on public.event_memberships;
drop policy if exists event_memberships_admin_write on public.event_memberships;
create policy event_memberships_self_read on public.event_memberships for select to authenticated
using (
  user_id=(select auth.uid())
  or exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'roles.manage',e.organization_id,e.id,team_id)
  )
  or exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,team_id)
  )
);
create policy event_memberships_admin_write on public.event_memberships for all to authenticated
using (
  exists(
    select 1 from public.events e
    where e.id=event_id
      and (
        private.user_has_permission((select auth.uid()),'roles.manage',e.organization_id,e.id,team_id)
        or private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,team_id)
      )
  )
)
with check (
  exists(
    select 1 from public.events e
    where e.id=event_id
      and (
        private.user_has_permission((select auth.uid()),'roles.manage',e.organization_id,e.id,team_id)
        or private.user_has_permission((select auth.uid()),'event.manage',e.organization_id,e.id,team_id)
      )
  )
);

-- Roster data has a deliberately narrow public projection through column grants.
drop policy if exists roster_read on public.event_roster_entries;
drop policy if exists roster_public_read on public.event_roster_entries;
drop policy if exists roster_staff_read on public.event_roster_entries;
drop policy if exists roster_staff_write on public.event_roster_entries;
create policy roster_public_read on public.event_roster_entries for select to anon,authenticated
using (private.event_is_public(event_id));
create policy roster_staff_read on public.event_roster_entries for select to authenticated
using (
  private.user_has_permission((select auth.uid()),'event.view_private',organization_id,event_id,team_id)
  or private.user_has_permission((select auth.uid()),'roster.manage',organization_id,event_id,team_id)
  or private.user_has_permission((select auth.uid()),'registration.manage',organization_id,event_id,team_id)
  or private.user_has_permission((select auth.uid()),'armor.inspect',organization_id,event_id,team_id)
  or private.user_has_permission((select auth.uid()),'medical.manage',organization_id,event_id,team_id)
);
create policy roster_staff_write on public.event_roster_entries for all to authenticated
using (private.user_has_permission((select auth.uid()),'roster.manage',organization_id,event_id,team_id))
with check (private.user_has_permission((select auth.uid()),'roster.manage',organization_id,event_id,team_id));

-- Field/list and bracket configuration.
drop policy if exists fight_cards_read on public.fight_cards;
drop policy if exists fight_cards_public_read on public.fight_cards;
drop policy if exists fight_cards_staff_read on public.fight_cards;
drop policy if exists fight_cards_write on public.fight_cards;
create policy fight_cards_public_read on public.fight_cards for select to anon,authenticated
using (private.event_is_public(event_id));
create policy fight_cards_staff_read on public.fight_cards for select to authenticated
using (
  exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,null))
);
create policy fight_cards_write on public.fight_cards for all to authenticated
using (
  exists(select 1 from public.events e where e.id=event_id and (
    private.user_has_permission((select auth.uid()),'bracket.manage',e.organization_id,e.id,null)
    or private.user_has_permission((select auth.uid()),'match.manage',e.organization_id,e.id,null)
  ))
)
with check (
  exists(select 1 from public.events e where e.id=event_id and (
    private.user_has_permission((select auth.uid()),'bracket.manage',e.organization_id,e.id,null)
    or private.user_has_permission((select auth.uid()),'match.manage',e.organization_id,e.id,null)
  ))
);

drop policy if exists brackets_read on public.brackets;
drop policy if exists brackets_public_read on public.brackets;
drop policy if exists brackets_staff_read on public.brackets;
drop policy if exists brackets_write on public.brackets;
create policy brackets_public_read on public.brackets for select to anon,authenticated
using (private.event_is_public(event_id));
create policy brackets_staff_read on public.brackets for select to authenticated
using (
  exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,null))
);
create policy brackets_write on public.brackets for all to authenticated
using (
  exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'bracket.manage',e.organization_id,e.id,null))
)
with check (
  exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'bracket.manage',e.organization_id,e.id,null))
);

-- Match reads include all staff with private event access. Direct row writes stay
-- with match managers. Scoring is performed by the constrained RPC below.
drop policy if exists matches_read on public.matches;
drop policy if exists matches_public_read on public.matches;
drop policy if exists matches_staff_read on public.matches;
drop policy if exists matches_write on public.matches;
create policy matches_public_read on public.matches for select to anon,authenticated
using (private.event_is_public(event_id));
create policy matches_staff_read on public.matches for select to authenticated
using (private.user_has_permission((select auth.uid()),'event.view_private',organization_id,event_id,null));
create policy matches_write on public.matches for all to authenticated
using (private.user_has_permission((select auth.uid()),'match.manage',organization_id,event_id,null))
with check (private.user_has_permission((select auth.uid()),'match.manage',organization_id,event_id,null));

drop policy if exists participants_read on public.match_participants;
drop policy if exists participants_public_read on public.match_participants;
drop policy if exists participants_staff_read on public.match_participants;
drop policy if exists participants_write on public.match_participants;
create policy participants_public_read on public.match_participants for select to anon,authenticated
using (exists(select 1 from public.matches m where m.id=match_id and private.event_is_public(m.event_id)));
create policy participants_staff_read on public.match_participants for select to authenticated
using (exists(select 1 from public.matches m where m.id=match_id and private.user_has_permission((select auth.uid()),'event.view_private',m.organization_id,m.event_id,null)));
create policy participants_write on public.match_participants for all to authenticated
using (exists(select 1 from public.matches m where m.id=match_id and (
  private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)
  or private.user_has_permission((select auth.uid()),'bracket.manage',m.organization_id,m.event_id,null)
)))
with check (exists(select 1 from public.matches m where m.id=match_id and (
  private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)
  or private.user_has_permission((select auth.uid()),'bracket.manage',m.organization_id,m.event_id,null)
)));

drop policy if exists side_members_read on public.match_side_members;
drop policy if exists side_members_public_read on public.match_side_members;
drop policy if exists side_members_staff_read on public.match_side_members;
drop policy if exists side_members_write on public.match_side_members;
create policy side_members_public_read on public.match_side_members for select to anon,authenticated
using (
  exists(
    select 1 from public.match_participants mp
    join public.matches m on m.id=mp.match_id
    where mp.id=match_participant_id and private.event_is_public(m.event_id)
  )
);
create policy side_members_staff_read on public.match_side_members for select to authenticated
using (
  exists(
    select 1 from public.match_participants mp
    join public.matches m on m.id=mp.match_id
    where mp.id=match_participant_id
      and private.user_has_permission((select auth.uid()),'event.view_private',m.organization_id,m.event_id,null)
  )
);
create policy side_members_write on public.match_side_members for all to authenticated
using (
  exists(
    select 1 from public.match_participants mp
    join public.matches m on m.id=mp.match_id
    where mp.id=match_participant_id
      and (
        private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)
        or private.user_has_permission((select auth.uid()),'bracket.manage',m.organization_id,m.event_id,null)
      )
  )
)
with check (
  exists(
    select 1 from public.match_participants mp
    join public.matches m on m.id=mp.match_id
    where mp.id=match_participant_id
      and (
        private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)
        or private.user_has_permission((select auth.uid()),'bracket.manage',m.organization_id,m.event_id,null)
      )
  )
);

drop policy if exists rounds_read on public.match_rounds;
drop policy if exists rounds_public_read on public.match_rounds;
drop policy if exists rounds_staff_read on public.match_rounds;
drop policy if exists rounds_write on public.match_rounds;
create policy rounds_public_read on public.match_rounds for select to anon,authenticated
using (exists(select 1 from public.matches m where m.id=match_id and private.event_is_public(m.event_id)));
create policy rounds_staff_read on public.match_rounds for select to authenticated
using (exists(select 1 from public.matches m where m.id=match_id and private.user_has_permission((select auth.uid()),'event.view_private',m.organization_id,m.event_id,null)));
create policy rounds_write on public.match_rounds for all to authenticated
using (exists(select 1 from public.matches m where m.id=match_id and private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)))
with check (exists(select 1 from public.matches m where m.id=match_id and private.user_has_permission((select auth.uid()),'match.manage',m.organization_id,m.event_id,null)));

-- Discipline, notes, announcements and registration.
drop policy if exists discipline_read on public.disciplinary_cards;
drop policy if exists discipline_write on public.disciplinary_cards;
create policy discipline_read on public.disciplinary_cards for select to authenticated
using (
  private.user_has_permission((select auth.uid()),'event.view_private',organization_id,event_id,null)
  or private.user_has_permission((select auth.uid()),'discipline.manage',organization_id,event_id,null)
);
create policy discipline_write on public.disciplinary_cards for all to authenticated
using (private.user_has_permission((select auth.uid()),'discipline.manage',organization_id,event_id,null))
with check (private.user_has_permission((select auth.uid()),'discipline.manage',organization_id,event_id,null));

drop policy if exists fight_notes_read on public.fight_notes;
drop policy if exists fight_notes_author_write on public.fight_notes;
create policy fight_notes_read on public.fight_notes for select to authenticated
using (
  author_user_id=(select auth.uid())
  or (
    visibility='marshal_visible'
    and exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'notes.team',e.organization_id,e.id,null))
  )
  or (
    visibility='team_only'
    and team_id is not null
    and exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'notes.team',e.organization_id,e.id,team_id))
  )
);
create policy fight_notes_author_write on public.fight_notes for all to authenticated
using (author_user_id=(select auth.uid()))
with check (
  author_user_id=(select auth.uid())
  and exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'notes.team',e.organization_id,e.id,team_id)
  )
);

drop policy if exists announcements_read on public.announcements;
drop policy if exists announcements_public_read on public.announcements;
drop policy if exists announcements_staff_read on public.announcements;
drop policy if exists announcements_write on public.announcements;
create policy announcements_public_read on public.announcements for select to anon,authenticated
using (is_public and private.event_is_public(event_id));
create policy announcements_staff_read on public.announcements for select to authenticated
using (exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,null)));
create policy announcements_write on public.announcements for all to authenticated
using (exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'announcement.manage',e.organization_id,e.id,null)))
with check (exists(select 1 from public.events e where e.id=event_id and private.user_has_permission((select auth.uid()),'announcement.manage',e.organization_id,e.id,null)));

drop policy if exists registrations_staff_read on public.event_registrations;
drop policy if exists registrations_staff_write on public.event_registrations;
create policy registrations_staff_read on public.event_registrations for select to authenticated
using (
  exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'registration.manage',e.organization_id,e.id,null)
  )
);
create policy registrations_staff_write on public.event_registrations for update to authenticated
using (
  exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'registration.manage',e.organization_id,e.id,null)
  )
)
with check (
  exists(
    select 1 from public.events e
    where e.id=event_id
      and private.user_has_permission((select auth.uid()),'registration.manage',e.organization_id,e.id,null)
  )
);

drop policy if exists payments_staff_read on public.registration_payments;
create policy payments_staff_read on public.registration_payments for select to authenticated
using (
  exists(
    select 1 from public.event_registrations r
    join public.events e on e.id=r.event_id
    where r.id=registration_id
      and private.user_has_permission((select auth.uid()),'registration.manage',e.organization_id,e.id,null)
  )
);

drop policy if exists audit_authorized_insert on public.audit_log;
create policy audit_authorized_insert on public.audit_log for insert to authenticated
with check (
  actor_user_id=(select auth.uid())
  and (
    private.is_platform_admin((select auth.uid()))
    or (
      organization_id is not null
      and (
        private.user_has_permission((select auth.uid()),'organization.manage',organization_id,event_id,null)
        or private.user_has_permission((select auth.uid()),'event.manage',organization_id,event_id,null)
        or private.user_has_permission((select auth.uid()),'match.manage',organization_id,event_id,null)
        or private.user_has_permission((select auth.uid()),'match.score',organization_id,event_id,null)
        or private.user_has_permission((select auth.uid()),'roster.manage',organization_id,event_id,null)
      )
    )
  )
);

-- Specialist clearance writes use a field-specific, audited, idempotent function.
create or replace function public.update_roster_clearance_idempotent(
  p_operation_id uuid,
  p_roster_entry_id uuid,
  p_field text,
  p_value boolean,
  p_expected_value boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster_row public.event_roster_entries%rowtype;
  existing public.sync_operations%rowtype;
  required_permission text;
  current_value boolean;
  result_json jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into existing from public.sync_operations where operation_id=p_operation_id for update;
  if found and existing.user_id is distinct from (select auth.uid()) then raise exception 'Operation ID belongs to another user'; end if;
  if found and existing.operation_type<>'update_roster_clearance' then raise exception 'Operation ID type mismatch'; end if;
  if found and existing.state='completed' then return existing.result; end if;

  select * into roster_row from public.event_roster_entries where id=p_roster_entry_id for update;
  if not found then raise exception 'Roster entry not found'; end if;

  required_permission:=case p_field
    when 'armor_cleared' then 'armor.inspect'
    when 'medical_cleared' then 'medical.manage'
    when 'checked_in' then 'roster.manage'
    when 'waiver_confirmed' then 'roster.manage'
    when 'weigh_in_cleared' then 'roster.manage'
    else null
  end;

  if required_permission is null then raise exception 'Unsupported clearance field'; end if;

  current_value:=case p_field
    when 'armor_cleared' then roster_row.armor_cleared
    when 'medical_cleared' then roster_row.medical_cleared
    when 'checked_in' then roster_row.checked_in
    when 'waiver_confirmed' then roster_row.waiver_confirmed
    when 'weigh_in_cleared' then roster_row.weigh_in_cleared
  end;

  if p_expected_value is not null and current_value is distinct from p_expected_value and current_value is distinct from p_value then
    raise exception 'Clearance changed since it was loaded';
  end if;

  if not (
    private.user_has_permission((select auth.uid()),required_permission,roster_row.organization_id,roster_row.event_id,roster_row.team_id)
    or private.user_has_permission((select auth.uid()),'roster.manage',roster_row.organization_id,roster_row.event_id,roster_row.team_id)
  ) then
    raise exception 'Not authorized to update this clearance';
  end if;

  if existing.operation_id is null then
    insert into public.sync_operations(operation_id,user_id,operation_type,entity_type,entity_id)
    values(p_operation_id,(select auth.uid()),'update_roster_clearance','event_roster_entry',p_roster_entry_id);
  elsif existing.state<>'completed' then
    update public.sync_operations set state='accepted',error_message=null where operation_id=p_operation_id;
  end if;

  execute format('update public.event_roster_entries set %I=$1,last_edited_by=$2 where id=$3',p_field)
  using p_value,(select auth.uid()),p_roster_entry_id;

  result_json:=jsonb_build_object('field',p_field,'value',p_value,'rosterEntryId',p_roster_entry_id);
  update public.sync_operations
  set state='completed',result=result_json,completed_at=timezone('utc',now())
  where operation_id=p_operation_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(roster_row.organization_id,roster_row.event_id,(select auth.uid()),'event_roster_entries',p_roster_entry_id,'update_clearance',
         jsonb_build_object('field',p_field,'value',p_value));

  return result_json;
end;
$$;

revoke execute on function public.update_roster_clearance_idempotent(uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.update_roster_clearance_idempotent(uuid,uuid,text,boolean,boolean) to authenticated;

-- A scorekeeper can finalize scores without receiving unrestricted UPDATE on matches.
alter function public.submit_match_result(uuid,jsonb,smallint,text,public.match_status) security definer;
revoke execute on function public.submit_match_result(uuid,jsonb,smallint,text,public.match_status) from public,anon;
grant execute on function public.submit_match_result(uuid,jsonb,smallint,text,public.match_status) to authenticated;

-- Registration review is capability based and transactional.
create or replace function public.review_event_registration(
  p_registration_id uuid,
  p_status public.registration_status
)
returns uuid
language plpgsql
security definer
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

  select * into v_registration from public.event_registrations where id=p_registration_id for update;
  if not found then raise exception 'Registration not found'; end if;
  select * into v_event from public.events where id=v_registration.event_id;
  if not found then raise exception 'Event not found'; end if;

  if not private.user_has_permission((select auth.uid()),'registration.manage',v_event.organization_id,v_event.id,null) then
    raise exception 'Not authorized to review registrations';
  end if;

  update public.event_registrations set status=p_status where id=p_registration_id;

  if p_status='approved' then
    if v_registration.team_name is not null then
      select id into v_team_id
      from public.teams
      where organization_id=v_event.organization_id
        and lower(name)=lower(v_registration.team_name)
        and is_active and deleted_at is null
      order by created_at limit 1;
    end if;

    select id into v_fighter_id
    from public.fighters
    where organization_id=v_event.organization_id
      and lower(name)=lower(v_registration.display_name)
      and team_id is not distinct from v_team_id
      and is_active and deleted_at is null
    order by created_at limit 1;

    if v_fighter_id is null then
      insert into public.fighters(
        organization_id,team_id,name,preferred_weapons,created_by,last_edited_by,updated_by
      )
      values(
        v_event.organization_id,v_team_id,v_registration.display_name,array[v_registration.category],
        (select auth.uid()),(select auth.uid()),(select auth.uid())
      )
      returning id into v_fighter_id;
    end if;

    select id into v_roster_id
    from public.event_roster_entries
    where event_id=v_event.id and fighter_id=v_fighter_id
    limit 1;

    if v_roster_id is null then
      insert into public.event_roster_entries(
        organization_id,event_id,team_id,fighter_id,entry_type,display_name,
        waiver_confirmed,attendance_status,metadata,created_by,last_edited_by
      )
      values(
        v_event.organization_id,v_event.id,v_team_id,v_fighter_id,'fighter',v_registration.display_name,
        v_registration.waiver_acknowledged,'approved',
        jsonb_build_object('registrationId',v_registration.id,'category',v_registration.category,'submittedTeamName',v_registration.team_name),
        (select auth.uid()),(select auth.uid())
      )
      returning id into v_roster_id;
    else
      update public.event_roster_entries
      set attendance_status='approved',
          waiver_confirmed=waiver_confirmed or v_registration.waiver_acknowledged,
          last_edited_by=(select auth.uid())
      where id=v_roster_id;
    end if;
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(
    v_event.organization_id,v_event.id,(select auth.uid()),'event_registrations',v_registration.id,'review_registration',
    jsonb_build_object('from',v_registration.status,'to',p_status,'rosterEntryId',v_roster_id,'fighterId',v_fighter_id)
  );

  return v_roster_id;
end;
$$;

revoke execute on function public.review_event_registration(uuid,public.registration_status) from public,anon;
grant execute on function public.review_event_registration(uuid,public.registration_status) to authenticated;


-- Event administrators need supporting directory rows without becoming organization administrators.
create or replace function private.can_view_managed_profile(check_user uuid,target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_platform_admin(check_user)
    or exists(
      select 1
      from public.event_memberships target
      join public.events e on e.id=target.event_id
      where target.user_id=target_user
        and private.user_has_permission(check_user,'event.manage',e.organization_id,e.id,target.team_id)
    );
$$;

revoke execute on function private.can_view_managed_profile(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_view_managed_profile(uuid,uuid) to authenticated;

drop policy if exists teams_event_staff_read on public.teams;
create policy teams_event_staff_read on public.teams for select to authenticated
using (
  exists(
    select 1 from public.events e
    where e.organization_id=teams.organization_id
      and private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,teams.id)
  )
);

drop policy if exists fighters_event_staff_read on public.fighters;
create policy fighters_event_staff_read on public.fighters for select to authenticated
using (
  exists(
    select 1 from public.events e
    where e.organization_id=fighters.organization_id
      and private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,fighters.team_id)
  )
);
