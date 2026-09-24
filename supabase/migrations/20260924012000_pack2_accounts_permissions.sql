begin;

create table if not exists private.bootstrap_state (
  singleton boolean primary key default true check (singleton),
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null
);

revoke all on table private.bootstrap_state from public, anon, authenticated;

insert into private.bootstrap_state(singleton)
values (true)
on conflict (singleton) do nothing;

update private.bootstrap_state state
set claimed_at = coalesce(state.claimed_at, membership.created_at),
    claimed_by = coalesce(state.claimed_by, membership.user_id)
from (
  select user_id, created_at
  from public.platform_memberships
  order by created_at, id
  limit 1
) membership
where state.singleton
  and state.claimed_at is null;

create or replace function private.claim_first_super_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_claimed_at timestamptz;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select claimed_at
  into v_claimed_at
  from private.bootstrap_state
  where singleton
  for update;

  if v_claimed_at is not null then
    return false;
  end if;

  lock table public.platform_memberships in share row exclusive mode;

  if exists (select 1 from public.platform_memberships) then
    update private.bootstrap_state
    set claimed_at = timezone('utc', now())
    where singleton;
    return false;
  end if;

  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Profile bootstrap has not completed';
  end if;

  insert into public.platform_memberships(user_id, role)
  values (v_user, 'platform_super_admin');

  update private.bootstrap_state
  set claimed_at = timezone('utc', now()),
      claimed_by = v_user
  where singleton;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (v_user, 'platform_memberships', v_user, 'claim_first_super_admin', '{}'::jsonb);

  return true;
end;
$$;

revoke all on function private.claim_first_super_admin() from public, anon, authenticated;
grant execute on function private.claim_first_super_admin() to authenticated;

create or replace function public.claim_first_super_admin()
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.claim_first_super_admin(); $$;

revoke all on function public.claim_first_super_admin() from public, anon;
grant execute on function public.claim_first_super_admin() to authenticated;

create or replace function private.assign_platform_role(
  p_user_id uuid,
  p_role public.platform_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.is_platform_admin(v_actor) then raise exception 'Platform administrator access required'; end if;
  if v_actor = p_user_id then raise exception 'You cannot change your own platform role'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Account profile not found'; end if;

  insert into public.platform_memberships(user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (v_actor, 'platform_memberships', p_user_id, 'assign_platform_role', jsonb_build_object('role', p_role));
end;
$$;

create or replace function private.revoke_platform_role(
  p_user_id uuid,
  p_role public.platform_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.is_platform_admin(v_actor) then raise exception 'Platform administrator access required'; end if;
  if v_actor = p_user_id then raise exception 'You cannot change your own platform role'; end if;

  if p_role = 'platform_super_admin'
     and (select count(*) from public.platform_memberships where role = 'platform_super_admin') <= 1
  then
    raise exception 'The last platform super administrator cannot be removed';
  end if;

  delete from public.platform_memberships
  where user_id = p_user_id and role = p_role;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (v_actor, 'platform_memberships', p_user_id, 'revoke_platform_role', jsonb_build_object('role', p_role));
end;
$$;

create or replace function private.assign_organization_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_platform boolean;
  v_org_admin boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then raise exception 'Organization not found'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Account profile not found'; end if;

  v_platform := private.is_platform_admin(v_actor);
  v_org_admin := private.has_org_role(v_actor, p_organization_id, array['organization_admin']::public.organization_role[]);

  if not (v_platform or v_org_admin) then raise exception 'Organization administrator access required'; end if;
  if v_actor = p_user_id and not v_platform then raise exception 'Organization administrators cannot change their own role'; end if;
  if p_role = 'organization_admin' and not v_platform then raise exception 'Only a platform super administrator can assign organization administrators'; end if;

  insert into public.organization_memberships(organization_id, user_id, role)
  values (p_organization_id, p_user_id, p_role)
  on conflict (organization_id, user_id, role) do nothing;

  insert into public.audit_log(organization_id, actor_user_id, table_name, record_id, action, payload)
  values (p_organization_id, v_actor, 'organization_memberships', p_user_id, 'assign_organization_role', jsonb_build_object('role', p_role));
end;
$$;

create or replace function private.revoke_organization_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_platform boolean;
  v_org_admin boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  v_platform := private.is_platform_admin(v_actor);
  v_org_admin := private.has_org_role(v_actor, p_organization_id, array['organization_admin']::public.organization_role[]);

  if not (v_platform or v_org_admin) then raise exception 'Organization administrator access required'; end if;
  if v_actor = p_user_id and not v_platform then raise exception 'Organization administrators cannot change their own role'; end if;
  if p_role = 'organization_admin' and not v_platform then raise exception 'Only a platform super administrator can revoke organization administrators'; end if;

  if p_role = 'organization_admin'
     and (select count(*) from public.organization_memberships where organization_id = p_organization_id and role = 'organization_admin') <= 1
  then
    raise exception 'The last organization administrator cannot be removed';
  end if;

  delete from public.organization_memberships
  where organization_id = p_organization_id
    and user_id = p_user_id
    and role = p_role;

  insert into public.audit_log(organization_id, actor_user_id, table_name, record_id, action, payload)
  values (p_organization_id, v_actor, 'organization_memberships', p_user_id, 'revoke_organization_role', jsonb_build_object('role', p_role));
end;
$$;

create or replace function private.assign_event_role(
  p_event_id uuid,
  p_user_id uuid,
  p_role public.event_role,
  p_team_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_organization_id uuid;
  v_full_admin boolean;
  v_event_organizer boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select organization_id into v_organization_id
  from public.events
  where id = p_event_id;

  if v_organization_id is null then raise exception 'Event not found'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'Account profile not found'; end if;

  v_full_admin := private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor, v_organization_id, array['organization_admin']::public.organization_role[]);
  v_event_organizer := private.has_event_role(v_actor, p_event_id, array['event_organizer']::public.event_role[]);

  if not (v_full_admin or v_event_organizer) then raise exception 'Event administrator access required'; end if;
  if v_actor = p_user_id and not v_full_admin then raise exception 'Event organizers cannot change their own role'; end if;
  if p_role = 'event_organizer' and not v_full_admin then raise exception 'Only organization or platform administrators can assign event organizers'; end if;
  if p_role = 'team_captain' and p_team_id is null then raise exception 'Team captains require a team'; end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams
    where id = p_team_id
      and organization_id = v_organization_id
      and is_active
  ) then
    raise exception 'Team is not active in this event organization';
  end if;

  insert into public.event_memberships(event_id, user_id, role, team_id)
  values (p_event_id, p_user_id, p_role, case when p_role = 'team_captain' then p_team_id else null end)
  on conflict (event_id, user_id, role)
  do update set team_id = excluded.team_id;

  insert into public.audit_log(organization_id, event_id, actor_user_id, table_name, record_id, action, payload)
  values (
    v_organization_id,
    p_event_id,
    v_actor,
    'event_memberships',
    p_user_id,
    'assign_event_role',
    jsonb_build_object('role', p_role, 'teamId', p_team_id)
  );
end;
$$;

create or replace function private.revoke_event_membership(
  p_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_membership public.event_memberships%rowtype;
  v_organization_id uuid;
  v_full_admin boolean;
  v_event_organizer boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_membership
  from public.event_memberships
  where id = p_membership_id
  for update;

  if v_membership.id is null then raise exception 'Event membership not found'; end if;

  select organization_id into v_organization_id
  from public.events
  where id = v_membership.event_id;

  v_full_admin := private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor, v_organization_id, array['organization_admin']::public.organization_role[]);
  v_event_organizer := private.has_event_role(v_actor, v_membership.event_id, array['event_organizer']::public.event_role[]);

  if not (v_full_admin or v_event_organizer) then raise exception 'Event administrator access required'; end if;
  if v_actor = v_membership.user_id and not v_full_admin then raise exception 'Event organizers cannot revoke their own role'; end if;
  if v_membership.role = 'event_organizer' and not v_full_admin then raise exception 'Only organization or platform administrators can revoke event organizers'; end if;

  delete from public.event_memberships where id = p_membership_id;

  insert into public.audit_log(organization_id, event_id, actor_user_id, table_name, record_id, action, payload)
  values (
    v_organization_id,
    v_membership.event_id,
    v_actor,
    'event_memberships',
    v_membership.user_id,
    'revoke_event_role',
    jsonb_build_object('role', v_membership.role, 'membershipId', p_membership_id)
  );
end;
$$;

revoke all on function private.assign_platform_role(uuid,public.platform_role) from public, anon, authenticated;
revoke all on function private.revoke_platform_role(uuid,public.platform_role) from public, anon, authenticated;
revoke all on function private.assign_organization_role(uuid,uuid,public.organization_role) from public, anon, authenticated;
revoke all on function private.revoke_organization_role(uuid,uuid,public.organization_role) from public, anon, authenticated;
revoke all on function private.assign_event_role(uuid,uuid,public.event_role,uuid) from public, anon, authenticated;
revoke all on function private.revoke_event_membership(uuid) from public, anon, authenticated;

grant execute on function private.assign_platform_role(uuid,public.platform_role) to authenticated;
grant execute on function private.revoke_platform_role(uuid,public.platform_role) to authenticated;
grant execute on function private.assign_organization_role(uuid,uuid,public.organization_role) to authenticated;
grant execute on function private.revoke_organization_role(uuid,uuid,public.organization_role) to authenticated;
grant execute on function private.assign_event_role(uuid,uuid,public.event_role,uuid) to authenticated;
grant execute on function private.revoke_event_membership(uuid) to authenticated;

create or replace function public.assign_platform_role(p_user_id uuid, p_role public.platform_role)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.assign_platform_role(p_user_id, p_role); $$;

create or replace function public.revoke_platform_role(p_user_id uuid, p_role public.platform_role)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.revoke_platform_role(p_user_id, p_role); $$;

create or replace function public.assign_organization_role(p_organization_id uuid, p_user_id uuid, p_role public.organization_role)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.assign_organization_role(p_organization_id, p_user_id, p_role); $$;

create or replace function public.revoke_organization_role(p_organization_id uuid, p_user_id uuid, p_role public.organization_role)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.revoke_organization_role(p_organization_id, p_user_id, p_role); $$;

create or replace function public.assign_event_role(p_event_id uuid, p_user_id uuid, p_role public.event_role, p_team_id uuid default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.assign_event_role(p_event_id, p_user_id, p_role, p_team_id); $$;

create or replace function public.revoke_event_membership(p_membership_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.revoke_event_membership(p_membership_id); $$;

revoke all on function public.assign_platform_role(uuid,public.platform_role) from public, anon;
revoke all on function public.revoke_platform_role(uuid,public.platform_role) from public, anon;
revoke all on function public.assign_organization_role(uuid,uuid,public.organization_role) from public, anon;
revoke all on function public.revoke_organization_role(uuid,uuid,public.organization_role) from public, anon;
revoke all on function public.assign_event_role(uuid,uuid,public.event_role,uuid) from public, anon;
revoke all on function public.revoke_event_membership(uuid) from public, anon;

grant execute on function public.assign_platform_role(uuid,public.platform_role) to authenticated;
grant execute on function public.revoke_platform_role(uuid,public.platform_role) to authenticated;
grant execute on function public.assign_organization_role(uuid,uuid,public.organization_role) to authenticated;
grant execute on function public.revoke_organization_role(uuid,uuid,public.organization_role) to authenticated;
grant execute on function public.assign_event_role(uuid,uuid,public.event_role,uuid) to authenticated;
grant execute on function public.revoke_event_membership(uuid) to authenticated;

drop policy if exists org_memberships_admin_write on public.organization_memberships;
drop policy if exists event_memberships_admin_write on public.event_memberships;

revoke insert, update, delete on public.platform_memberships from authenticated;
revoke insert, update, delete on public.organization_memberships from authenticated;
revoke insert, update, delete on public.event_memberships from authenticated;

create or replace function private.can_view_event_private(check_user uuid, check_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = check_event
      and (
        private.is_platform_admin(check_user)
        or private.has_org_role(check_user, e.organization_id, array['organization_admin','organization_staff']::public.organization_role[])
        or private.has_event_role(check_user, e.id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[])
      )
  );
$$;

create or replace function private.can_view_roster_entry(
  check_user uuid,
  check_event uuid,
  check_team uuid,
  check_fighter uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_platform_admin(check_user)
    or exists (
      select 1
      from public.events e
      where e.id = check_event
        and private.has_org_role(check_user, e.organization_id, array['organization_admin','organization_staff']::public.organization_role[])
    )
    or private.has_event_role(check_user, check_event, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
    or (check_team is not null and private.has_team_event_role(check_user, check_event, check_team, array['team_captain']::public.event_role[]))
    or (
      check_fighter is not null
      and exists (
        select 1 from public.fighters f
        where f.id = check_fighter
          and f.user_id = check_user
          and f.deleted_at is null
      )
    );
$$;

revoke all on function private.can_view_event_private(uuid,uuid) from public, anon, authenticated;
revoke all on function private.can_view_roster_entry(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_view_event_private(uuid,uuid) to authenticated;
grant execute on function private.can_view_roster_entry(uuid,uuid,uuid,uuid) to authenticated;

drop policy if exists events_public_read on public.events;
create policy events_anon_read on public.events
for select to anon
using (status in ('published','live','completed'));

create policy events_authenticated_read on public.events
for select to authenticated
using (private.can_view_event_private((select auth.uid()), id));

drop policy if exists roster_read on public.event_roster_entries;
create policy roster_anon_read on public.event_roster_entries
for select to anon
using (private.event_is_public(event_id));

create policy roster_authenticated_read on public.event_roster_entries
for select to authenticated
using (private.can_view_roster_entry((select auth.uid()), event_id, team_id, fighter_id));

drop policy if exists fight_cards_read on public.fight_cards;
create policy fight_cards_anon_read on public.fight_cards
for select to anon
using (private.event_is_public(event_id));

create policy fight_cards_authenticated_read on public.fight_cards
for select to authenticated
using (private.can_view_event_private((select auth.uid()), event_id));

drop policy if exists brackets_read on public.brackets;
create policy brackets_anon_read on public.brackets
for select to anon
using (private.event_is_public(event_id));

create policy brackets_authenticated_read on public.brackets
for select to authenticated
using (private.can_view_event_private((select auth.uid()), event_id));

drop policy if exists matches_read on public.matches;
create policy matches_anon_read on public.matches
for select to anon
using (private.event_is_public(event_id));

create policy matches_authenticated_read on public.matches
for select to authenticated
using (private.can_view_event_private((select auth.uid()), event_id));

drop policy if exists participants_read on public.match_participants;
create policy participants_anon_read on public.match_participants
for select to anon
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and private.event_is_public(m.event_id)
  )
);

create policy participants_authenticated_read on public.match_participants
for select to authenticated
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id
      and private.can_view_event_private((select auth.uid()), m.event_id)
  )
);

drop policy if exists side_members_read on public.match_side_members;
create policy side_members_anon_read on public.match_side_members
for select to anon
using (
  exists (
    select 1
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.id = match_participant_id
      and private.event_is_public(m.event_id)
  )
);

create policy side_members_authenticated_read on public.match_side_members
for select to authenticated
using (
  exists (
    select 1
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.id = match_participant_id
      and private.can_view_event_private((select auth.uid()), m.event_id)
  )
);

drop policy if exists rounds_read on public.match_rounds;
create policy rounds_anon_read on public.match_rounds
for select to anon
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and private.event_is_public(m.event_id)
  )
);

create policy rounds_authenticated_read on public.match_rounds
for select to authenticated
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id
      and private.can_view_event_private((select auth.uid()), m.event_id)
  )
);

drop policy if exists announcements_read on public.announcements;
create policy announcements_anon_read on public.announcements
for select to anon
using (is_public and private.event_is_public(event_id));

create policy announcements_authenticated_read on public.announcements
for select to authenticated
using (
  (is_public and private.can_view_event_private((select auth.uid()), event_id))
  or private.can_view_event_private((select auth.uid()), event_id)
);

drop policy if exists event_divisions_read on public.event_divisions;
create policy event_divisions_anon_read on public.event_divisions
for select to anon
using (private.event_is_public(event_id));

create policy event_divisions_authenticated_read on public.event_divisions
for select to authenticated
using (private.can_view_event_private((select auth.uid()), event_id));

revoke select on public.events from anon;
grant select (
  id, organization_id, season_id, name, venue, starts_at, ends_at,
  organizer_name, event_type, standings_mode, status, timezone,
  livestream_url, registration_open, registration_fee_cents, currency, ruleset_id
) on public.events to anon;

revoke select on public.event_roster_entries from anon;
grant select (
  id, event_id, team_id, entry_type, display_name, attendance_status
) on public.event_roster_entries to anon;

revoke select on public.fight_cards from anon;
grant select (
  id, event_id, name, list_name, status, sort_order
) on public.fight_cards to anon;

revoke select on public.brackets from anon;
grant select (
  id, event_id, fight_card_id, division_id, name, format, category, metadata
) on public.brackets to anon;

revoke select on public.matches from anon;
grant select (
  id, organization_id, season_id, event_id, fight_card_id, bracket_id, division_id,
  label, category, match_type, scoring_config, status, stage, scheduled_order,
  bracket_round, bracket_slot, winner_advances_to_match_id, winner_advances_to_slot,
  loser_advances_to_match_id, loser_advances_to_slot, started_at, completed_at,
  finalized_at, result_summary
) on public.matches to anon;

revoke select on public.match_rounds from anon;
grant select (
  id, match_id, round_number, side_1_score, side_2_score, created_at
) on public.match_rounds to anon;

revoke select on public.announcements from anon;
grant select (
  id, event_id, title, body, is_public, scheduled_for, created_at
) on public.announcements to anon;

revoke all on public.profiles from anon;
revoke all on public.platform_memberships from anon;
revoke all on public.organization_memberships from anon;
revoke all on public.event_memberships from anon;
revoke all on public.fighter_identities from anon;
revoke all on public.fighter_affiliations from anon;
revoke all on public.fighters from anon;

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
  v_registration_id uuid := gen_random_uuid();
  v_registration_token uuid := gen_random_uuid();
  v_fee_cents integer;
  v_currency text;
begin
  select registration_fee_cents, currency
  into v_fee_cents, v_currency
  from public.events
  where id = p_event_id
    and status in ('published','live')
    and registration_open;

  if not found then raise exception 'Registration is not open'; end if;
  if length(trim(p_email)) < 5 or position('@' in p_email) = 0 then raise exception 'Valid email required'; end if;
  if length(trim(p_display_name)) < 2 then raise exception 'Name required'; end if;
  if length(trim(p_category)) < 1 then raise exception 'Category required'; end if;

  insert into public.event_registrations(
    id, event_id, email, display_name, team_name, category, phone, emergency_contact,
    waiver_acknowledged, registration_token, payment_status
  )
  values (
    v_registration_id, p_event_id, lower(trim(p_email)), trim(p_display_name),
    nullif(trim(p_team_name),''), trim(p_category), nullif(trim(p_phone),''),
    nullif(trim(p_emergency_contact),''), p_waiver_acknowledged, v_registration_token,
    case when v_fee_cents = 0 then 'not_required'::public.payment_status else 'pending'::public.payment_status end
  );

  return jsonb_build_object(
    'registrationId', v_registration_id,
    'registrationToken', v_registration_token,
    'paymentRequired', v_fee_cents > 0,
    'amountCents', v_fee_cents,
    'currency', v_currency
  );
end;
$$;

revoke all on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) from public;
grant execute on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) to anon, authenticated;

commit;
