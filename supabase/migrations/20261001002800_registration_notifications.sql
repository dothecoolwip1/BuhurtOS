-- Sign-ups become notifications. Additive.
--   * registration_submitted: to the event's organizers (event staff with the organizer role and admins of the event's organization),
--     or the platform owner when the event has nobody else. Sent when a registration is created, or sent again for review.
--   * registration_decided: to the person, when an organizer accepts or declines it.
-- The payload carries the event name and slug, the name on the registration (organizers already see it in Review) and the decision.
-- Nothing else: no email, no account id, no health or contact data.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided'));

create or replace function private.event_organizer_users(p_event uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with staff as (
    select s.user_id from public.event_staff s where s.event_id = p_event and s.role = 'organizer'
    union
    select os.user_id from public.organization_staff os where os.organization_id = private.event_org(p_event) and os.role = 'admin' and private.event_org_enabled(p_event)
  )
  select user_id from staff
  union
  select pr.user_id from public.platform_roles pr where pr.role = 'owner' and not exists (select 1 from staff)
$$;
revoke execute on function private.event_organizer_users(uuid) from public, anon, authenticated;

create or replace function private.registration_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = new.event_id;
  if not found then return new; end if;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    insert into public.notifications (user_id, kind, payload)
    select u, 'registration_submitted', jsonb_build_object('registration_id', new.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'person_name', new.full_name, 'volunteer', new.is_volunteer)
    from private.event_organizer_users(new.event_id) u where u is distinct from new.user_id;
  elsif tg_op = 'UPDATE' and new.status in ('accepted', 'declined') and old.status is distinct from new.status then
    insert into public.notifications (user_id, kind, payload)
    values (new.user_id, 'registration_decided', jsonb_build_object('registration_id', new.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'decision', new.status));
    -- The organizers' "new sign-up" notice is done with once someone has decided it.
    update public.notifications set read_at = coalesce(read_at, now()) where kind = 'registration_submitted' and payload ->> 'registration_id' = new.id::text;
  end if;
  return new;
end $$;
revoke execute on function private.registration_notify() from public, anon, authenticated;

create trigger registrations_notify after insert or update of status on public.registrations for each row execute function private.registration_notify();
