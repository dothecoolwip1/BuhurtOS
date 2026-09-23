/*
  Registration v2 and configurable competition eligibility.
  Competition eligibility is derived from event requirements and latest clearance outcomes,
  not from whichever client happened to toggle a legacy boolean.
*/

insert into public.event_clearances(event_id,roster_entry_id,clearance_type,status,inspected_at,notes)
select r.event_id,r.id,x.clearance_type,'passed'::public.clearance_status,coalesce(r.updated_at,r.created_at),'Migrated from pre-clearance roster state'
from public.event_roster_entries r
cross join lateral (
  values
    ('identity',true),
    ('registration',r.attendance_status in ('registered','approved','late')),
    ('waiver',r.waiver_confirmed),
    ('weight',r.weigh_in_cleared),
    ('medical',r.medical_cleared),
    ('armor',r.armor_cleared),
    ('weapons',r.armor_cleared),
    ('check_in',r.checked_in)
) as x(clearance_type,passed)
where x.passed
  and not exists(
    select 1 from public.event_clearances c
    where c.event_id=r.event_id and c.roster_entry_id=r.id and c.clearance_type=x.clearance_type
  );

create or replace function private.roster_entry_is_eligible(p_roster_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    r.attendance_status not in ('withdrawn','no_show')
    and (
      not exists(select 1 from public.event_clearance_requirements q where q.event_id=r.event_id and q.required)
      and r.can_compete
      or
      exists(select 1 from public.event_clearance_requirements q where q.event_id=r.event_id and q.required)
      and not exists(
        select 1
        from public.event_clearance_requirements q
        where q.event_id=r.event_id
          and q.required
          and coalesce((
            select c.status
            from public.event_clearances c
            where c.event_id=r.event_id
              and c.roster_entry_id=r.id
              and c.clearance_type=q.clearance_type
            order by c.created_at desc
            limit 1
          ),'pending'::public.clearance_status) not in ('passed','waived')
      )
    )
  from public.event_roster_entries r
  where r.id=p_roster_entry_id;
$$;
revoke execute on function private.roster_entry_is_eligible(uuid) from public,anon,authenticated;

create or replace function private.enforce_match_participant_eligibility()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_event uuid;
begin
  if new.roster_entry_id is null then return new; end if;
  select event_id into v_event from public.matches where id=new.match_id;
  if not exists(select 1 from public.event_roster_entries r where r.id=new.roster_entry_id and r.event_id=v_event) then
    raise exception 'Match participant does not belong to this event';
  end if;
  if not private.roster_entry_is_eligible(new.roster_entry_id) then
    raise exception 'Match participant has incomplete required clearances';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_match_participant_eligibility on public.match_participants;
create trigger enforce_match_participant_eligibility
before insert or update of roster_entry_id on public.match_participants
for each row execute function private.enforce_match_participant_eligibility();

create or replace function private.enforce_pool_entry_eligibility()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.roster_entry_is_eligible(new.roster_entry_id) then
    raise exception 'Pool competitor has incomplete required clearances';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_pool_entry_eligibility on public.pool_entries;
create trigger enforce_pool_entry_eligibility
before insert or update of roster_entry_id on public.pool_entries
for each row execute function private.enforce_pool_entry_eligibility();

create or replace function public.submit_public_registration_v2(
  p_event_id uuid,
  p_division_id uuid,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_division public.event_divisions%rowtype;
  v_registration public.event_registrations%rowtype;
  v_status public.registration_status:='pending';
  v_active_count integer;
begin
  select * into v_event
  from public.events
  where id=p_event_id and status in ('published','registration_open','live') and registration_open;
  if not found then raise exception 'Registration is not open'; end if;

  select * into v_division
  from public.event_divisions
  where id=p_division_id and event_id=p_event_id and status='open';
  if not found then raise exception 'Division is not open for registration'; end if;

  if length(trim(p_email))<5 or position('@' in p_email)=0 then raise exception 'Valid email required'; end if;
  if length(trim(p_display_name))<2 then raise exception 'Name required'; end if;
  if not p_waiver_acknowledged then raise exception 'Waiver acknowledgement is required'; end if;

  if v_event.registration_deadline is not null and timezone('utc',now())>v_event.registration_deadline then
    raise exception 'Registration deadline has passed';
  end if;

  if v_division.registration_cap is not null then
    select count(*) into v_active_count
    from public.event_registrations
    where division_id=p_division_id and status in ('pending','approved');
    if v_active_count>=v_division.registration_cap then v_status:='waitlisted'; end if;
  end if;

  insert into public.event_registrations(
    event_id,division_id,email,display_name,team_name,category,phone,emergency_contact,
    waiver_acknowledged,status,payment_status,registration_kind
  )
  values(
    p_event_id,p_division_id,lower(trim(p_email)),trim(p_display_name),nullif(trim(p_team_name),''),
    v_division.name,nullif(trim(p_phone),''),nullif(trim(p_emergency_contact),''),
    p_waiver_acknowledged,v_status,
    case when v_event.registration_fee_cents=0 then 'not_required'::public.payment_status else 'pending'::public.payment_status end,
    'individual'
  )
  returning * into v_registration;

  return jsonb_build_object(
    'registrationId',v_registration.id,
    'registrationToken',v_registration.registration_token,
    'status',v_registration.status,
    'divisionId',p_division_id,
    'paymentRequired',v_event.registration_fee_cents>0,
    'amountCents',v_event.registration_fee_cents,
    'currency',v_event.currency
  );
end;
$$;

revoke execute on function public.submit_public_registration_v2(uuid,uuid,text,text,text,text,text,boolean) from public;
grant execute on function public.submit_public_registration_v2(uuid,uuid,text,text,text,text,text,boolean) to anon,authenticated;

create or replace function public.review_event_registration(
  p_registration_id uuid,
  p_status public.registration_status,
  p_review_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_reg public.event_registrations%rowtype;
  v_event public.events%rowtype;
  v_roster_id uuid;
begin
  select * into v_reg from public.event_registrations where id=p_registration_id for update;
  if not found then raise exception 'Registration not found'; end if;
  select * into v_event from public.events where id=v_reg.event_id;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_event.id,array['event_organizer','tournament_director','registration_staff']::public.event_role[])
  ) then raise exception 'Not authorized to review registrations'; end if;

  if p_status='rejected' and coalesce(trim(p_review_notes),'')='' then raise exception 'A rejection reason is required'; end if;

  update public.event_registrations
  set status=p_status,review_notes=nullif(trim(p_review_notes),''),reviewed_by=(select auth.uid()),reviewed_at=timezone('utc',now())
  where id=p_registration_id;

  if p_status='approved' then
    select id into v_roster_id
    from public.event_roster_entries
    where event_id=v_reg.event_id and metadata->>'registrationId'=v_reg.id::text
    limit 1;

    if v_roster_id is null then
      insert into public.event_roster_entries(
        organization_id,event_id,team_id,fighter_id,entry_type,display_name,waiver_confirmed,attendance_status,metadata,created_by
      )
      values(
        v_event.organization_id,v_reg.event_id,v_reg.team_id,v_reg.fighter_id,
        case when v_reg.fighter_id is null then 'guest_fighter'::public.roster_entry_type else 'fighter'::public.roster_entry_type end,
        v_reg.display_name,v_reg.waiver_acknowledged,'approved',
        jsonb_build_object('registrationId',v_reg.id,'divisionId',v_reg.division_id,'registeredTeamName',v_reg.team_name),
        (select auth.uid())
      )
      returning id into v_roster_id;
    else
      update public.event_roster_entries
      set attendance_status='approved',waiver_confirmed=v_reg.waiver_acknowledged,last_edited_by=(select auth.uid())
      where id=v_roster_id;
    end if;

    insert into public.event_clearances(event_id,roster_entry_id,clearance_type,status,inspected_by,inspected_at,notes)
    values
      (v_reg.event_id,v_roster_id,'registration','passed',(select auth.uid()),timezone('utc',now()),'Registration approved'),
      (v_reg.event_id,v_roster_id,'waiver','passed',(select auth.uid()),timezone('utc',now()),'Waiver acknowledged at registration')
    ;
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_event.organization_id,v_reg.event_id,(select auth.uid()),'event_registrations',v_reg.id,'review_registration',
    jsonb_build_object('status',p_status,'rosterEntryId',v_roster_id,'notes',nullif(trim(p_review_notes),'')));

  return v_roster_id;
end;
$$;

revoke execute on function public.review_event_registration(uuid,public.registration_status,text) from public,anon;
grant execute on function public.review_event_registration(uuid,public.registration_status,text) to authenticated;
