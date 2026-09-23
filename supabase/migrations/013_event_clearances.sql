/*
  Event-day clearance requirements and specialized event staff roles.
*/

alter type public.event_role add value if not exists 'tournament_director';
alter type public.event_role add value if not exists 'scorekeeper';
alter type public.event_role add value if not exists 'registration_staff';
alter type public.event_role add value if not exists 'armor_inspector';
alter type public.event_role add value if not exists 'medical_staff';

create table public.event_clearance_requirements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  clearance_type text not null check (clearance_type in ('identity','registration','fee','waiver','insurance','weight','medical','armor','weapons','check_in','custom')),
  label text not null,
  required boolean not null default true,
  sort_order integer not null default 0,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default timezone('utc',now()),
  last_edited_by uuid references public.profiles(id),
  unique(event_id,clearance_type)
);

alter table public.event_clearance_requirements enable row level security;
revoke all on table public.event_clearance_requirements from anon,authenticated;
grant select,insert,update,delete on table public.event_clearance_requirements to authenticated;

create policy clearance_requirements_staff_read on public.event_clearance_requirements
for select to authenticated
using (private.can_manage_event(event_id) or private.has_event_role((select auth.uid()),event_id,array['registration_staff','armor_inspector','medical_staff','scorekeeper']::public.event_role[]));

create policy clearance_requirements_admin_write on public.event_clearance_requirements
for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or exists(select 1 from public.events e where e.id=event_id and private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[]))
  or private.has_event_role((select auth.uid()),event_id,array['event_organizer','tournament_director']::public.event_role[])
)
with check (
  private.is_platform_admin((select auth.uid()))
  or exists(select 1 from public.events e where e.id=event_id and private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[]))
  or private.has_event_role((select auth.uid()),event_id,array['event_organizer','tournament_director']::public.event_role[])
);

create or replace function private.can_record_clearance(p_event_id uuid,p_type text)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    private.is_platform_admin((select auth.uid()))
    or exists(select 1 from public.events e where e.id=p_event_id and private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin']::public.organization_role[]))
    or private.has_event_role((select auth.uid()),p_event_id,array['event_organizer','tournament_director','field_marshal']::public.event_role[])
    or (p_type in ('identity','registration','fee','waiver','insurance','weight','check_in') and private.has_event_role((select auth.uid()),p_event_id,array['registration_staff']::public.event_role[]))
    or (p_type in ('armor','weapons') and private.has_event_role((select auth.uid()),p_event_id,array['armor_inspector']::public.event_role[]))
    or (p_type='medical' and private.has_event_role((select auth.uid()),p_event_id,array['medical_staff']::public.event_role[]));
$$;
revoke execute on function private.can_record_clearance(uuid,text) from public,anon,authenticated;

create or replace function public.record_event_clearance(
  p_event_id uuid,
  p_roster_entry_id uuid,
  p_clearance_type text,
  p_status public.clearance_status,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
  v_previous uuid;
begin
  if not private.can_record_clearance(p_event_id,p_clearance_type) then raise exception 'Not authorized to record this clearance'; end if;
  if not exists(select 1 from public.event_roster_entries where id=p_roster_entry_id and event_id=p_event_id) then
    raise exception 'Roster entry does not belong to this event';
  end if;
  if p_status='failed' and coalesce(trim(p_notes),'')='' then raise exception 'A note is required when a clearance fails'; end if;

  select id into v_previous
  from public.event_clearances
  where event_id=p_event_id and roster_entry_id=p_roster_entry_id and clearance_type=p_clearance_type
  order by created_at desc
  limit 1;

  insert into public.event_clearances(event_id,roster_entry_id,clearance_type,status,inspected_by,inspected_at,notes,reinspection_of)
  values(p_event_id,p_roster_entry_id,p_clearance_type,p_status,(select auth.uid()),timezone('utc',now()),nullif(trim(p_notes),''),case when p_status in ('passed','failed','reinspection_required') then v_previous else null end)
  returning id into v_id;

  update public.event_roster_entries
  set
    checked_in=case when p_clearance_type='check_in' then p_status='passed' else checked_in end,
    armor_cleared=case when p_clearance_type in ('armor','weapons') then
      case when p_status='passed' then
        case when p_clearance_type='armor' then true else armor_cleared end
      else false end
      else armor_cleared end,
    medical_cleared=case when p_clearance_type='medical' then p_status='passed' else medical_cleared end,
    waiver_confirmed=case when p_clearance_type='waiver' then p_status='passed' else waiver_confirmed end,
    weigh_in_cleared=case when p_clearance_type='weight' then p_status='passed' else weigh_in_cleared end,
    last_edited_by=(select auth.uid())
  where id=p_roster_entry_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  select e.organization_id,p_event_id,(select auth.uid()),'event_clearances',v_id,'record_clearance',
    jsonb_build_object('rosterEntryId',p_roster_entry_id,'type',p_clearance_type,'status',p_status)
  from public.events e where e.id=p_event_id;

  return v_id;
end;
$$;

revoke execute on function public.record_event_clearance(uuid,uuid,text,public.clearance_status,text) from public,anon;
grant execute on function public.record_event_clearance(uuid,uuid,text,public.clearance_status,text) to authenticated;

drop trigger if exists audit_change on public.event_clearance_requirements;
create trigger audit_change after insert or update or delete on public.event_clearance_requirements
for each row execute function private.capture_audit_change();

insert into public.event_clearance_requirements(event_id,clearance_type,label,required,sort_order)
select e.id, x.clearance_type, x.label, x.required, x.sort_order
from public.events e
cross join (values
  ('identity','Identity',true,10),
  ('registration','Registration',true,20),
  ('waiver','Waiver',true,30),
  ('insurance','Insurance',false,40),
  ('weight','Weight',false,50),
  ('medical','Medical',true,60),
  ('armor','Armor',true,70),
  ('weapons','Weapons',true,80),
  ('check_in','Checked in',true,90)
) as x(clearance_type,label,required,sort_order)
on conflict(event_id,clearance_type) do nothing;
