-- Entry rosters, mercenaries and schedule conflicts (additive).
--
-- A group-fight (team) entry gets a roster: the fighters who actually stood on the field for it at that event.
--   role 'fighter'    a member of the entry's own team (fighters.team_id = entry team, or a current non-mercenary membership)
--   role 'mercenary'  a member of ANOTHER team lending a hand. permanent_team_id = their home team at that time
--   role 'guest'      anyone else (no home team, or not asked about it)
-- A roster row NEVER changes fighters.team_id or team_memberships: mercenary status belongs to the entry, not to the person.
-- Rules (clear and small; everything else is the organizer's call):
--   1. Only team entries have rosters. Duel entries keep entries.fighter_id.
--   2. A fighter may be on one entry per competition (unique competition_id + fighter_id).
--   3. Rows are written only through set_entry_roster(), which only an organizer of the event (or the owner) can call.
--      Being added by an organizer is the proof; an accepted registration is NOT required.
--   4. A finished competition's rosters are locked (reopen a match first).
--   5. At most 40 fighters per entry.

alter table public.entries add constraint entries_id_competition_key unique (id, competition_id);

create or replace function private.event_of_entry(p_entry uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select k.event_id from public.entries e join public.competitions k on k.id = e.competition_id where e.id = p_entry
$$;
revoke execute on function private.event_of_entry(uuid) from public;
grant execute on function private.event_of_entry(uuid) to anon, authenticated;

-- The team a fighter belongs to now: fighters.team_id, else the newest current non-mercenary membership.
create or replace function private.fighter_home_team(p_fighter uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select f.team_id from public.fighters f where f.id = p_fighter),
    (select m.team_id from public.team_memberships m where m.fighter_id = p_fighter and not m.mercenary and (m.to_date is null or m.to_date >= current_date)
      order by m.from_date desc nulls last, m.id limit 1))
$$;
revoke execute on function private.fighter_home_team(uuid) from public, anon, authenticated;

create table public.entry_fighters (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  competition_id uuid not null,
  fighter_id uuid not null references public.fighters (id) on delete restrict,
  role text not null default 'fighter' check (role in ('fighter', 'mercenary', 'guest')),
  -- Snapshot of the fighter's home team when the roster was set. Null for a guest without a team.
  permanent_team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, fighter_id),
  unique (competition_id, fighter_id),
  foreign key (entry_id, competition_id) references public.entries (id, competition_id) on delete cascade on update cascade
);
alter table public.entry_fighters enable row level security;
create index entry_fighters_fighter_idx on public.entry_fighters (fighter_id);

-- competition_id is copied from the entry, and only team entries can have a roster.
create or replace function private.entry_fighters_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_comp uuid; v_team uuid;
begin
  select competition_id, team_id into v_comp, v_team from public.entries where id = new.entry_id;
  if v_comp is null then raise exception 'entry not found' using errcode = '23503'; end if;
  if v_team is null then raise exception 'only team entries have a roster' using errcode = '23514'; end if;
  new.competition_id := v_comp;
  return new;
end $$;
revoke execute on function private.entry_fighters_fill() from public, anon, authenticated;
create trigger entry_fighters_fill before insert on public.entry_fighters for each row execute function private.entry_fighters_fill();

-- Same visibility as the entry itself: public for a public event, otherwise whoever can score. Writes: no grant, RPC only.
create policy entry_fighters_read on public.entry_fighters for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id)));
grant select on public.entry_fighters to anon, authenticated;

-- p_fighters: [{"fighter_id": uuid, "role": "fighter"|"mercenary"|"guest"}]. role is optional: it defaults to 'fighter' for a member of the
-- entry's team and 'mercenary' for a member of another team, 'guest' for a fighter with no team. The array REPLACES the whole roster.
create or replace function public.set_entry_roster(p_entry uuid, p_fighters jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.entries; v_k public.competitions; v_item jsonb; v_f uuid; v_role text; v_home uuid; v_ids uuid[] := '{}'; n int := 0; v_other uuid;
begin
  select * into v_e from public.entries where id = p_entry for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  select * into v_k from public.competitions where id = v_e.competition_id;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can set a roster' using errcode = '42501'; end if;
  if v_e.team_id is null then raise exception 'only team entries have a roster' using errcode = '22023'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is finished; reopen a match before changing a roster' using errcode = 'P0001'; end if;
  if p_fighters is null or jsonb_typeof(p_fighters) <> 'array' then raise exception 'send the roster as a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_fighters) > 40 then raise exception 'a roster has at most 40 fighters' using errcode = '22023'; end if;

  delete from public.entry_fighters where entry_id = p_entry;
  for v_item in select value from jsonb_array_elements(p_fighters) loop
    if jsonb_typeof(v_item) <> 'object' or (v_item ->> 'fighter_id') is null then raise exception 'each roster item needs a fighter_id' using errcode = '22023'; end if;
    v_f := (v_item ->> 'fighter_id')::uuid;
    if v_f = any (v_ids) then raise exception 'a fighter is listed twice' using errcode = '22023'; end if;
    v_ids := v_ids || v_f;
    if not exists (select 1 from public.fighters where id = v_f) then raise exception 'fighter not found' using errcode = 'P0002'; end if;
    v_home := private.fighter_home_team(v_f);
    v_role := coalesce(nullif(v_item ->> 'role', ''), case when v_home = v_e.team_id then 'fighter' when v_home is not null then 'mercenary' else 'guest' end);
    if v_role not in ('fighter', 'mercenary', 'guest') then raise exception 'role must be fighter, mercenary or guest' using errcode = '22023'; end if;
    if v_role = 'fighter' and v_home is distinct from v_e.team_id then raise exception 'a fighter of another team must be a mercenary or a guest' using errcode = '22023'; end if;
    if v_role = 'mercenary' and (v_home is null or v_home = v_e.team_id) then raise exception 'a mercenary must belong to another team' using errcode = '22023'; end if;
    select ef.entry_id into v_other from public.entry_fighters ef where ef.competition_id = v_e.competition_id and ef.fighter_id = v_f;
    if v_other is not null then raise exception 'a fighter is already on another entry of this competition' using errcode = '23505'; end if;
    insert into public.entry_fighters (entry_id, fighter_id, role, permanent_team_id) values (p_entry, v_f, v_role, v_home);
    n := n + 1;
  end loop;
  perform private.audit(v_k.event_id, 'entry.roster_set', p_entry::text, jsonb_build_object('fighters', n));
  return n;
end $$;

-- Roster with names, for pages. security_invoker: it follows the caller's access to entry_fighters.
create view public.entry_roster with (security_invoker = true) as
  select ef.entry_id, ef.competition_id, ef.fighter_id, f.display_name, ef.role, ef.permanent_team_id, pt.name as permanent_team_name, pt.slug as permanent_team_slug
  from public.entry_fighters ef
  join public.fighters f on f.id = ef.fighter_id
  left join public.teams pt on pt.id = ef.permanent_team_id;
grant select on public.entry_roster to anon, authenticated;

-- ---------------------------------------------------------------- match length and scheduling conflicts
alter table public.matches add column duration_minutes int not null default 15 check (duration_minutes between 1 and 720);
grant insert (duration_minutes) on public.matches to authenticated;
grant update (duration_minutes) on public.matches to authenticated;

-- Who stands in which not-yet-final, scheduled, non-withdrawn match of an event: duel entries by entries.fighter_id, team entries by roster.
create or replace function private.event_bookings(p_event uuid)
returns table (fighter_id uuid, match_id uuid, competition_id uuid, competition_name text, scheduled_at timestamptz, duration_minutes int)
language sql stable security definer set search_path = '' as $$
  select x.fighter_id, m.id, k.id, k.name, m.scheduled_at, m.duration_minutes
  from public.matches m
  join public.competitions k on k.id = m.competition_id
  cross join lateral (values (m.entry_a), (m.entry_b)) s(entry_id)
  join public.entries e on e.id = s.entry_id and e.status not in ('withdrawn', 'disqualified')
  cross join lateral (
    select e.fighter_id as fighter_id where e.fighter_id is not null
    union all
    select ef.fighter_id from public.entry_fighters ef where ef.entry_id = e.id) x
  where k.event_id = p_event and m.scheduled_at is not null and m.queue_state <> 'final'
$$;
revoke execute on function private.event_bookings(uuid) from public, anon, authenticated;

-- Pairs of matches in one event where the same fighter is booked in both at overlapping times. Final and unscheduled matches are ignored.
-- A match runs [scheduled_at, scheduled_at + duration_minutes). Touching intervals (one ends when the next starts) are NOT a conflict.
create or replace function public.fighter_schedule_conflicts(p_event uuid)
returns table (fighter_id uuid, display_name text, match_a uuid, match_b uuid, competition_a uuid, competition_b uuid,
  scheduled_a timestamptz, scheduled_b timestamptz, overlap_minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_score(p_event) then raise exception 'only event staff can see schedule conflicts' using errcode = '42501'; end if;
  return query
  select a.fighter_id, f.display_name, a.match_id, b.match_id, a.competition_id, b.competition_id, a.scheduled_at, b.scheduled_at,
    round(extract(epoch from least(a.scheduled_at + make_interval(mins => a.duration_minutes), b.scheduled_at + make_interval(mins => b.duration_minutes))
                          - greatest(a.scheduled_at, b.scheduled_at)) / 60)::int
  from private.event_bookings(p_event) a
  join private.event_bookings(p_event) b on b.fighter_id = a.fighter_id and (a.scheduled_at, a.match_id) < (b.scheduled_at, b.match_id)
    and a.scheduled_at < b.scheduled_at + make_interval(mins => b.duration_minutes) and b.scheduled_at < a.scheduled_at + make_interval(mins => a.duration_minutes)
  join public.fighters f on f.id = a.fighter_id
  order by a.scheduled_at, f.display_name, a.match_id, b.match_id;
end $$;

-- Is this fighter already booked in [p_at, p_at + p_minutes)? Returns the matches that overlap (none = free).
-- p_exclude_match lets a form ignore the match being edited.
create or replace function public.fighter_bookings(p_event uuid, p_fighter uuid, p_at timestamptz, p_minutes int default 15, p_exclude_match uuid default null)
returns table (match_id uuid, competition_id uuid, competition_name text, scheduled_at timestamptz, duration_minutes int, overlap_minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_score(p_event) then raise exception 'only event staff can see bookings' using errcode = '42501'; end if;
  if p_at is null or p_minutes is null or p_minutes < 1 then raise exception 'give a start time and a length in minutes' using errcode = '22023'; end if;
  return query
  select b.match_id, b.competition_id, b.competition_name, b.scheduled_at, b.duration_minutes,
    round(extract(epoch from least(b.scheduled_at + make_interval(mins => b.duration_minutes), p_at + make_interval(mins => p_minutes)) - greatest(b.scheduled_at, p_at)) / 60)::int
  from private.event_bookings(p_event) b
  where b.fighter_id = p_fighter and b.match_id is distinct from p_exclude_match
    and b.scheduled_at < p_at + make_interval(mins => p_minutes) and p_at < b.scheduled_at + make_interval(mins => b.duration_minutes)
  order by b.scheduled_at, b.match_id;
end $$;

create or replace function public.fighter_is_booked(p_event uuid, p_fighter uuid, p_at timestamptz, p_minutes int default 15, p_exclude_match uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fighter_bookings(p_event, p_fighter, p_at, p_minutes, p_exclude_match))
$$;

revoke execute on function public.set_entry_roster(uuid, jsonb), public.fighter_schedule_conflicts(uuid),
  public.fighter_bookings(uuid, uuid, timestamptz, int, uuid), public.fighter_is_booked(uuid, uuid, timestamptz, int, uuid) from public, anon;
grant execute on function public.set_entry_roster(uuid, jsonb), public.fighter_schedule_conflicts(uuid),
  public.fighter_bookings(uuid, uuid, timestamptz, int, uuid), public.fighter_is_booked(uuid, uuid, timestamptz, int, uuid) to authenticated;
