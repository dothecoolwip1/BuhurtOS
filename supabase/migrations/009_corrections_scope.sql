/*
  Scope correction requests to organizations and events so delegated administrators can review
  issues relevant to their own competition data without receiving global access.
*/

alter table public.correction_requests add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.correction_requests add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists correction_requests_event_status_idx on public.correction_requests(event_id,status,created_at desc);
create index if not exists correction_requests_org_status_idx on public.correction_requests(organization_id,status,created_at desc);

drop policy if exists corrections_admin_update on public.correction_requests;
drop policy if exists corrections_own_read on public.correction_requests;

create policy corrections_read on public.correction_requests for select to authenticated
using (
  reporter_user_id=(select auth.uid())
  or private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin','organization_staff']::public.organization_role[]))
  or (event_id is not null and private.has_event_role((select auth.uid()),event_id,array['event_organizer','field_marshal']::public.event_role[]))
);

create policy corrections_review on public.correction_requests for update to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[]))
  or (event_id is not null and private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[]))
)
with check (
  private.is_platform_admin((select auth.uid()))
  or (organization_id is not null and private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[]))
  or (event_id is not null and private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[]))
);

create or replace function public.review_correction_request(
  p_correction_id uuid,
  p_status public.correction_status,
  p_resolution_notes text default null
)
returns public.correction_status
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_row public.correction_requests%rowtype;
begin
  select * into v_row from public.correction_requests where id=p_correction_id for update;
  if not found then raise exception 'Correction request not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or (v_row.organization_id is not null and private.has_org_role((select auth.uid()),v_row.organization_id,array['organization_admin']::public.organization_role[]))
    or (v_row.event_id is not null and private.has_event_role((select auth.uid()),v_row.event_id,array['event_organizer']::public.event_role[]))
  ) then raise exception 'Not authorized to review this correction'; end if;

  if p_status in ('approved','rejected','applied') and coalesce(trim(p_resolution_notes),'')='' then
    raise exception 'Resolution notes are required for a closed correction request';
  end if;

  update public.correction_requests
  set status=p_status,
      resolution_notes=nullif(trim(p_resolution_notes),''),
      assigned_to=coalesce(assigned_to,(select auth.uid())),
      resolved_at=case when p_status in ('rejected','applied') then timezone('utc',now()) else null end
  where id=p_correction_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_row.organization_id,v_row.event_id,(select auth.uid()),'correction_requests',p_correction_id,'review_correction',jsonb_build_object('from',v_row.status,'to',p_status,'notes',nullif(trim(p_resolution_notes),'')));

  return p_status;
end;
$$;

revoke execute on function public.review_correction_request(uuid,public.correction_status,text) from public,anon;
grant execute on function public.review_correction_request(uuid,public.correction_status,text) to authenticated;
