-- Operational safety, realtime, audit coverage, and standings helpers.

create index if not exists platform_memberships_user_idx on public.platform_memberships(user_id, role);
create index if not exists organization_memberships_lookup_idx on public.organization_memberships(user_id, organization_id, role);
create index if not exists event_memberships_lookup_idx on public.event_memberships(user_id, event_id, role);
create index if not exists roster_event_compete_idx on public.event_roster_entries(event_id, can_compete, attendance_status);
create index if not exists participants_match_side_idx on public.match_participants(match_id, side_index);
create index if not exists rounds_match_idx on public.match_rounds(match_id, round_number);

create or replace function private.enforce_participant_clearance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if new.roster_entry_id is null then
    return new;
  end if;

  select event_id into v_event_id from public.matches where id = new.match_id;
  if v_event_id is null then
    raise exception 'Match not found';
  end if;

  if not exists (
    select 1
    from public.event_roster_entries r
    where r.id = new.roster_entry_id
      and r.event_id = v_event_id
      and r.can_compete
      and r.attendance_status not in ('no_show','withdrawn')
  ) then
    raise exception 'Participant is not cleared to compete in this event';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_participant_clearance() from public, anon, authenticated;

drop trigger if exists enforce_participant_clearance on public.match_participants;
create trigger enforce_participant_clearance
before insert or update of roster_entry_id, match_id on public.match_participants
for each row execute function private.enforce_participant_clearance();

create or replace function public.set_match_status(
  p_match_id uuid,
  p_status public.match_status,
  p_expected_status public.match_status
)
returns public.match_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_participant_count integer;
begin
  if p_status not in ('scheduled','in_the_hole','on_deck','active','cancelled') then
    raise exception 'Unsupported field status transition';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> p_expected_status then raise exception 'Match changed since it was loaded'; end if;
  if v_match.status in ('finalized','cancelled') then raise exception 'Closed matches cannot be moved into field states'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()), v_match.organization_id, array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()), v_match.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
  ) then
    raise exception 'Not authorized to change match status';
  end if;

  if p_status in ('in_the_hole','on_deck','active') then
    select count(*) into v_participant_count
    from public.match_participants mp
    where mp.match_id = p_match_id
      and not mp.is_placeholder
      and mp.roster_entry_id is not null;

    if v_participant_count < 2 then
      raise exception 'Match does not have two resolved competitors';
    end if;

    if exists (
      select 1
      from public.match_participants mp
      left join public.event_roster_entries r on r.id = mp.roster_entry_id
      where mp.match_id = p_match_id
        and not mp.is_placeholder
        and (r.id is null or not r.can_compete or r.attendance_status in ('no_show','withdrawn'))
    ) then
      raise exception 'All competitors must be cleared before entering the field queue';
    end if;

    update public.matches
    set status = 'scheduled', last_edited_by = (select auth.uid())
    where event_id = v_match.event_id
      and fight_card_id is not distinct from v_match.fight_card_id
      and id <> p_match_id
      and status = p_status;
  end if;

  update public.matches
  set status = p_status,
      started_at = case when p_status = 'active' and started_at is null then timezone('utc', now()) else started_at end,
      last_edited_by = (select auth.uid())
  where id = p_match_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (v_match.organization_id,v_match.event_id,(select auth.uid()),'matches',p_match_id,'set_status',jsonb_build_object('from',v_match.status,'to',p_status));

  return p_status;
end;
$$;

revoke execute on function public.set_match_status(uuid,public.match_status,public.match_status) from public, anon;
grant execute on function public.set_match_status(uuid,public.match_status,public.match_status) to authenticated;

create or replace function private.capture_audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_event_id uuid := nullif(v_row->>'event_id','')::uuid;
  v_org_id uuid := nullif(v_row->>'organization_id','')::uuid;
  v_record_id uuid := nullif(v_row->>'id','')::uuid;
begin
  if v_org_id is null and v_event_id is not null then
    select organization_id into v_org_id from public.events where id = v_event_id;
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_org_id,
    v_event_id,
    (select auth.uid()),
    tg_table_name,
    v_record_id,
    lower(tg_op),
    jsonb_strip_nulls(jsonb_build_object('old',v_old,'new',v_new))
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function private.capture_audit_change() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['event_roster_entries','matches','disciplinary_cards','fight_notes','announcements','event_memberships','event_registrations']
  loop
    execute format('drop trigger if exists audit_change on public.%I', v_table);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.capture_audit_change()', v_table);
  end loop;
end;
$$;

create or replace function public.event_standings(p_event_id uuid)
returns table (
  competitor_id uuid,
  display_name text,
  matches_played bigint,
  wins bigint,
  losses bigint,
  draws bigint,
  points bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible_event as (
    select id from public.events where id = p_event_id and standings_mode in ('season_and_event','event_only')
  ), sides as (
    select
      mp.roster_entry_id as competitor_id,
      r.display_name,
      m.id as match_id,
      mp.side_index,
      nullif(m.result_summary->>'winnerSide','')::smallint as winner_side
    from public.matches m
    join eligible_event e on e.id = m.event_id
    join public.match_participants mp on mp.match_id = m.id and mp.roster_entry_id is not null and not mp.is_placeholder
    join public.event_roster_entries r on r.id = mp.roster_entry_id
    where m.status = 'finalized'
      and coalesce(m.result_summary->>'resultType','') <> 'bye'
  )
  select competitor_id, max(display_name), count(distinct match_id),
    count(*) filter (where winner_side = side_index),
    count(*) filter (where winner_side is not null and winner_side <> side_index),
    count(*) filter (where winner_side is null),
    (count(*) filter (where winner_side = side_index) * 3 + count(*) filter (where winner_side is null))::bigint
  from sides
  group by competitor_id
  order by 7 desc, 4 desc, 2 asc;
$$;

create or replace function public.season_standings(p_season_id uuid)
returns table (
  competitor_id uuid,
  display_name text,
  matches_played bigint,
  wins bigint,
  losses bigint,
  draws bigint,
  points bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sides as (
    select
      coalesce(r.fighter_id, r.id) as competitor_id,
      r.display_name,
      m.id as match_id,
      mp.side_index,
      nullif(m.result_summary->>'winnerSide','')::smallint as winner_side
    from public.matches m
    join public.events e on e.id = m.event_id
    join public.match_participants mp on mp.match_id = m.id and mp.roster_entry_id is not null and not mp.is_placeholder
    join public.event_roster_entries r on r.id = mp.roster_entry_id
    where m.season_id = p_season_id
      and m.status = 'finalized'
      and coalesce(m.result_summary->>'resultType','') <> 'bye'
      and e.standings_mode = 'season_and_event'
  )
  select competitor_id, max(display_name), count(distinct match_id),
    count(*) filter (where winner_side = side_index),
    count(*) filter (where winner_side is not null and winner_side <> side_index),
    count(*) filter (where winner_side is null),
    (count(*) filter (where winner_side = side_index) * 3 + count(*) filter (where winner_side is null))::bigint
  from sides
  group by competitor_id
  order by 7 desc, 4 desc, 2 asc;
$$;

revoke execute on function public.event_standings(uuid) from public;
grant execute on function public.event_standings(uuid) to anon, authenticated;
revoke execute on function public.season_standings(uuid) from public, anon;
grant execute on function public.season_standings(uuid) to authenticated;

-- Postgres Changes requires the source tables to be in the Supabase realtime publication.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_roster_entries') then
    alter publication supabase_realtime add table public.event_roster_entries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
    alter publication supabase_realtime add table public.announcements;
  end if;
end;
$$;
