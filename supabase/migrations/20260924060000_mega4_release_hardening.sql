-- Mega Pack 4 production hardening.
-- Aligns RLS with application permissions and adds optimistic concurrency guards
-- for live multi-device event operations.

drop policy if exists fight_cards_write on public.fight_cards;
create policy fight_cards_write
on public.fight_cards for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = fight_cards.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = fight_cards.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
);

drop policy if exists brackets_write on public.brackets;
create policy brackets_write
on public.brackets for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = brackets.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = brackets.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
);

drop policy if exists participants_write on public.match_participants;
create policy participants_write
on public.match_participants for all to authenticated
using (
  exists (
    select 1
    from public.matches m
    join public.events e on e.id = m.event_id
    where m.id = match_participants.match_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.matches m
    join public.events e on e.id = m.event_id
    where m.id = match_participants.match_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
);

drop policy if exists side_members_write on public.match_side_members;
create policy side_members_write
on public.match_side_members for all to authenticated
using (
  exists (
    select 1
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    join public.events e on e.id = m.event_id
    where mp.id = match_side_members.match_participant_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    join public.events e on e.id = m.event_id
    where mp.id = match_side_members.match_participant_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
);

drop policy if exists rounds_write on public.match_rounds;
create policy rounds_write
on public.match_rounds for all to authenticated
using (
  exists (
    select 1
    from public.matches m
    join public.events e on e.id = m.event_id
    where m.id = match_rounds.match_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.matches m
    join public.events e on e.id = m.event_id
    where m.id = match_rounds.match_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role(
          (select auth.uid()),
          m.event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
      )
  )
);

drop policy if exists announcements_write on public.announcements;
create policy announcements_write
on public.announcements for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = announcements.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or exists (
    select 1
    from public.events e
    where e.id = announcements.event_id
      and private.has_org_role(
        (select auth.uid()),
        e.organization_id,
        array['organization_admin']::public.organization_role[]
      )
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
  )
);

drop policy if exists discipline_write on public.disciplinary_cards;
create policy discipline_write
on public.disciplinary_cards for all to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role(
    (select auth.uid()),
    organization_id,
    array['organization_admin']::public.organization_role[]
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
)
with check (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role(
    (select auth.uid()),
    organization_id,
    array['organization_admin']::public.organization_role[]
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal']::public.event_role[]
  )
);

drop policy if exists fight_notes_read on public.fight_notes;
create policy fight_notes_read
on public.fight_notes for select to authenticated
using (
  author_user_id = (select auth.uid())
  or (
    visibility = 'marshal_visible'
    and (
      exists (
        select 1
        from public.events e
        where e.id = fight_notes.event_id
          and private.has_org_role(
            (select auth.uid()),
            e.organization_id,
            array['organization_admin']::public.organization_role[]
          )
      )
      or private.has_event_role(
        (select auth.uid()),
        event_id,
        array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
      )
    )
  )
  or (
    visibility = 'team_only'
    and team_id is not null
    and exists (
      select 1
      from public.fighters f
      where f.user_id = (select auth.uid())
        and f.team_id = fight_notes.team_id
    )
  )
  or (
    visibility = 'team_only'
    and team_id is not null
    and private.has_team_event_role(
      (select auth.uid()),
      event_id,
      team_id,
      array['team_captain']::public.event_role[]
    )
  )
);

drop policy if exists fight_notes_author_write on public.fight_notes;
create policy fight_notes_author_write
on public.fight_notes for all to authenticated
using (author_user_id = (select auth.uid()))
with check (
  author_user_id = (select auth.uid())
  and (
    exists (
      select 1
      from public.events e
      where e.id = fight_notes.event_id
        and private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
    )
    or private.has_event_role(
      (select auth.uid()),
      event_id,
      array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]
    )
  )
  and (
    visibility <> 'team_only'
    or (
      team_id is not null
      and (
        private.has_event_role(
          (select auth.uid()),
          event_id,
          array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
        )
        or private.has_team_event_role(
          (select auth.uid()),
          event_id,
          team_id,
          array['team_captain']::public.event_role[]
        )
        or exists (
          select 1
          from public.fighters f
          where f.user_id = (select auth.uid())
            and f.team_id = fight_notes.team_id
        )
      )
    )
  )
);

create or replace function public.update_event_settings_guarded(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.event_status,
  p_event_type public.event_type,
  p_standings_mode public.standings_mode,
  p_registration_open boolean,
  p_livestream_url text
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_updated timestamptz;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then raise exception 'Event not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role(
      (select auth.uid()),
      v_event.organization_id,
      array['organization_admin']::public.organization_role[]
    )
    or private.has_event_role(
      (select auth.uid()),
      v_event.id,
      array['event_organizer']::public.event_role[]
    )
  ) then
    raise exception 'Not authorized to update event settings';
  end if;

  if p_expected_updated_at is null or v_event.updated_at <> p_expected_updated_at then
    raise exception 'Event settings changed on another device';
  end if;

  if nullif(trim(coalesce(p_livestream_url,'')),'') is not null
    and lower(trim(p_livestream_url)) !~ '^https://'
  then
    raise exception 'Livestream URL must use HTTPS';
  end if;

  update public.events
  set
    status = p_status,
    event_type = p_event_type,
    standings_mode = p_standings_mode,
    registration_open = p_registration_open,
    livestream_url = nullif(trim(coalesce(p_livestream_url,'')),''),
    last_edited_by = (select auth.uid())
  where id = p_event_id
  returning updated_at into v_updated;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,
    v_event.id,
    (select auth.uid()),
    'events',
    v_event.id,
    'update_settings_guarded',
    jsonb_build_object(
      'previousUpdatedAt',v_event.updated_at,
      'status',p_status,
      'eventType',p_event_type,
      'standingsMode',p_standings_mode,
      'registrationOpen',p_registration_open
    )
  );

  return v_updated;
end;
$$;

create or replace function public.create_fight_card_guarded(
  p_event_id uuid,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_id uuid;
  v_order integer;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id;

  if not found then raise exception 'Event not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role(
      (select auth.uid()),
      v_event.organization_id,
      array['organization_admin']::public.organization_role[]
    )
    or private.has_event_role(
      (select auth.uid()),
      p_event_id,
      array['event_organizer','field_marshal']::public.event_role[]
    )
  ) then
    raise exception 'Not authorized to create tournament fields';
  end if;

  if length(trim(coalesce(p_name,''))) < 1 then
    raise exception 'Field name is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('fight-card:' || p_event_id::text));

  select coalesce(max(sort_order),-1) + 1
  into v_order
  from public.fight_cards
  where event_id = p_event_id;

  insert into public.fight_cards(
    event_id,name,list_name,status,sort_order,created_by,last_edited_by
  )
  values (
    p_event_id,trim(p_name),trim(p_name),'live',v_order,(select auth.uid()),(select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_fight_card_guarded(
  p_fight_card_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_status public.fight_card_status
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.fight_cards%rowtype;
  v_event public.events%rowtype;
  v_updated timestamptz;
begin
  select *
  into v_card
  from public.fight_cards
  where id = p_fight_card_id
  for update;

  if not found then raise exception 'Tournament field not found'; end if;

  select *
  into v_event
  from public.events
  where id = v_card.event_id;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role(
      (select auth.uid()),
      v_event.organization_id,
      array['organization_admin']::public.organization_role[]
    )
    or private.has_event_role(
      (select auth.uid()),
      v_card.event_id,
      array['event_organizer','field_marshal']::public.event_role[]
    )
  ) then
    raise exception 'Not authorized to update tournament fields';
  end if;

  if p_expected_updated_at is null or v_card.updated_at <> p_expected_updated_at then
    raise exception 'Tournament field changed on another device';
  end if;

  if length(trim(coalesce(p_name,''))) < 1 then
    raise exception 'Field name is required';
  end if;

  update public.fight_cards
  set
    name = trim(p_name),
    list_name = trim(p_name),
    status = p_status,
    last_edited_by = (select auth.uid())
  where id = p_fight_card_id
  returning updated_at into v_updated;

  return v_updated;
end;
$$;

create or replace function public.update_roster_clearance_guarded(
  p_roster_entry_id uuid,
  p_expected_updated_at timestamptz,
  p_field text,
  p_value boolean
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry public.event_roster_entries%rowtype;
  v_updated timestamptz;
begin
  select *
  into v_entry
  from public.event_roster_entries
  where id = p_roster_entry_id
  for update;

  if not found then raise exception 'Roster entry not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role(
      (select auth.uid()),
      v_entry.organization_id,
      array['organization_admin']::public.organization_role[]
    )
    or private.has_event_role(
      (select auth.uid()),
      v_entry.event_id,
      array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
    )
  ) then
    raise exception 'Not authorized to update roster clearance';
  end if;

  if p_expected_updated_at is null or v_entry.updated_at <> p_expected_updated_at then
    raise exception 'Roster entry changed on another device';
  end if;

  if p_field not in ('checked_in','armor_cleared','medical_cleared','waiver_confirmed','weigh_in_cleared') then
    raise exception 'Unsupported roster clearance field';
  end if;

  update public.event_roster_entries
  set
    checked_in = case when p_field='checked_in' then p_value else checked_in end,
    armor_cleared = case when p_field='armor_cleared' then p_value else armor_cleared end,
    medical_cleared = case when p_field='medical_cleared' then p_value else medical_cleared end,
    waiver_confirmed = case when p_field='waiver_confirmed' then p_value else waiver_confirmed end,
    weigh_in_cleared = case when p_field='weigh_in_cleared' then p_value else weigh_in_cleared end,
    last_edited_by = (select auth.uid())
  where id = p_roster_entry_id
  returning updated_at into v_updated;

  return v_updated;
end;
$$;

create or replace function public.review_event_registration_guarded(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.registration_status
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registration public.event_registrations%rowtype;
begin
  select *
  into v_registration
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then raise exception 'Registration not found'; end if;

  if p_expected_updated_at is null or v_registration.updated_at <> p_expected_updated_at then
    raise exception 'Registration changed on another device';
  end if;

  return public.review_event_registration(p_registration_id,p_status);
end;
$$;

create or replace function public.reorder_match_guarded(
  p_match_id uuid,
  p_direction integer,
  p_expected_order integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  select *
  into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then raise exception 'Match not found'; end if;
  if v_match.scheduled_order <> p_expected_order then
    raise exception 'Fight card order changed on another device';
  end if;

  perform public.reorder_match(p_match_id,p_direction);
end;
$$;

revoke execute on function public.update_event_settings_guarded(
  uuid,timestamptz,public.event_status,public.event_type,public.standings_mode,boolean,text
) from public,anon;
grant execute on function public.update_event_settings_guarded(
  uuid,timestamptz,public.event_status,public.event_type,public.standings_mode,boolean,text
) to authenticated;

revoke execute on function public.create_fight_card_guarded(uuid,text) from public,anon;
grant execute on function public.create_fight_card_guarded(uuid,text) to authenticated;

revoke execute on function public.update_fight_card_guarded(
  uuid,timestamptz,text,public.fight_card_status
) from public,anon;
grant execute on function public.update_fight_card_guarded(
  uuid,timestamptz,text,public.fight_card_status
) to authenticated;

revoke execute on function public.update_roster_clearance_guarded(
  uuid,timestamptz,text,boolean
) from public,anon;
grant execute on function public.update_roster_clearance_guarded(
  uuid,timestamptz,text,boolean
) to authenticated;

revoke execute on function public.review_event_registration_guarded(
  uuid,timestamptz,public.registration_status
) from public,anon;
grant execute on function public.review_event_registration_guarded(
  uuid,timestamptz,public.registration_status
) to authenticated;

revoke execute on function public.reorder_match_guarded(uuid,integer,integer) from public,anon;
grant execute on function public.reorder_match_guarded(uuid,integer,integer) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end;
$$;
