-- Security hardening for organizer registration workflows and public registration.
-- Keeps Data API functions security-invoker and grants only the row/column access they need.

create policy teams_event_organizer_read
on public.teams for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.organization_id = teams.organization_id
      and private.has_event_role(
        (select auth.uid()),
        e.id,
        array['event_organizer']::public.event_role[]
      )
  )
);

create policy fighters_event_organizer_read
on public.fighters for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.organization_id = fighters.organization_id
      and private.has_event_role(
        (select auth.uid()),
        e.id,
        array['event_organizer']::public.event_role[]
      )
  )
);

create policy fighters_event_organizer_insert
on public.fighters for insert
to authenticated
with check (
  exists (
    select 1
    from public.events e
    where e.organization_id = fighters.organization_id
      and private.has_event_role(
        (select auth.uid()),
        e.id,
        array['event_organizer']::public.event_role[]
      )
  )
);

create policy audit_authorized_insert
on public.audit_log for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and (
    private.is_platform_admin((select auth.uid()))
    or (
      organization_id is not null
      and private.has_org_role(
        (select auth.uid()),
        organization_id,
        array['organization_admin']::public.organization_role[]
      )
    )
    or (
      event_id is not null
      and private.has_event_role(
        (select auth.uid()),
        event_id,
        array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
      )
    )
  )
);

drop trigger if exists audit_change on public.fight_cards;
create trigger audit_change
after insert or update or delete on public.fight_cards
for each row execute function private.capture_audit_change();

create policy registrations_public_insert
on public.event_registrations for insert
to anon, authenticated
with check (
  status = 'pending'
  and exists (
    select 1
    from public.events e
    where e.id = event_registrations.event_id
      and e.status in ('published','live')
      and e.registration_open
      and event_registrations.payment_status = case
        when e.registration_fee_cents = 0 then 'not_required'::public.payment_status
        else 'pending'::public.payment_status
      end
  )
);

grant insert (
  id,event_id,email,display_name,team_name,category,phone,
  emergency_contact,waiver_acknowledged,registration_token,payment_status
) on public.event_registrations to anon;

create or replace function public.submit_public_registration(
  p_event_id uuid,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_category text,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_registration_id uuid := gen_random_uuid();
  v_registration_token uuid := gen_random_uuid();
begin
  select * into v_event
  from public.events
  where id = p_event_id
    and status in ('published','live')
    and registration_open;

  if not found then raise exception 'Registration is not open'; end if;
  if length(trim(p_email)) < 5 or position('@' in p_email) = 0 then raise exception 'Valid email required'; end if;
  if length(trim(p_display_name)) < 2 then raise exception 'Name required'; end if;
  if length(trim(p_category)) < 1 then raise exception 'Category required'; end if;

  insert into public.event_registrations(
    id,event_id,email,display_name,team_name,category,phone,emergency_contact,
    waiver_acknowledged,registration_token,payment_status
  )
  values (
    v_registration_id,p_event_id,lower(trim(p_email)),trim(p_display_name),
    nullif(trim(p_team_name),''),trim(p_category),nullif(trim(p_phone),''),
    nullif(trim(p_emergency_contact),''),p_waiver_acknowledged,v_registration_token,
    case when v_event.registration_fee_cents = 0 then 'not_required'::public.payment_status else 'pending'::public.payment_status end
  );

  return jsonb_build_object(
    'registrationId',v_registration_id,
    'registrationToken',v_registration_token,
    'paymentRequired',v_event.registration_fee_cents > 0,
    'amountCents',v_event.registration_fee_cents,
    'currency',v_event.currency
  );
end;
$$;

revoke execute on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) from public;
grant execute on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) to anon, authenticated;
