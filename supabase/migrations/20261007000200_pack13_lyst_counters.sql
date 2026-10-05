-- Pack 13 (2026-10-07), part 2 of 2: counters, the tablet's state, finalization from the official rounds, and public state for Arena / Pack 14. Additive.
-- Requires part 1 (20261007000100).
--
-- COUNTERS ARE EVIDENCE, NOT AUTHORITY.
--   * A counter is a signed-in person the lyst operator ASSIGNED to one fight, one fighter, one role. They can tally and undo their OWN tally, and nothing else.
--   * Role 'learning' is chosen by the operator (never the counter). A learning counter's tally is stored the same way (so they practise the real job) but is
--     excluded by construction from every function that produces an official number: official rounds come only from lyst_confirm_round (the marshal's call).
--   * Nothing here, nor anywhere, averages, maxes, majority-votes or auto-accepts counters. The tablet shows them next to the marshal's entry; humans reconcile.
--   * Provisional tallies are staff-only (and the counter's own). The public sees lyst_rounds / lyst_timer / match_discipline only.

-- ---------------------------------------------------------------- 1. tables
create table if not exists public.lyst_join_codes (
  code text primary key check (code ~ '^[A-Z0-9]{10}$'),
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists lyst_join_codes_event_idx on public.lyst_join_codes (event_id, field_key);
alter table public.lyst_join_codes enable row level security;
create policy lyst_join_codes_read on public.lyst_join_codes for select to authenticated using (private.can_score(event_id));
grant select on public.lyst_join_codes to authenticated;
revoke insert, update, delete on public.lyst_join_codes from public, anon, authenticated;
comment on table public.lyst_join_codes is 'Pack 13: short-lived code shown as a QR on a lyst tablet. It only lets a signed-in person ASK for a counter seat on that field; the operator still decides. It carries no credential.';

create table if not exists public.lyst_counter_seats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'Counter' check (char_length(display_name) <= 80),
  match_id uuid references public.matches (id) on delete cascade,
  side text check (side is null or side in ('a', 'b')),
  slot text check (slot is null or slot ~ '^[A-Z][0-9A-Z]{0,2}$'),
  role text not null default 'official' check (role in ('official', 'learning')),
  status text not null default 'pending' check (status in ('pending', 'active', 'ended', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  expires_at timestamptz
);
create unique index if not exists lyst_counter_seats_one_open on public.lyst_counter_seats (user_id, event_id, field_key) where status in ('pending', 'active');
create index if not exists lyst_counter_seats_match_idx on public.lyst_counter_seats (match_id) where status = 'active';
create index if not exists lyst_counter_seats_match_all_idx on public.lyst_counter_seats (match_id);
create index if not exists lyst_counter_seats_user_idx on public.lyst_counter_seats (user_id);
create index if not exists lyst_counter_seats_event_idx on public.lyst_counter_seats (event_id, field_key);
alter table public.lyst_counter_seats enable row level security;
create policy lyst_counter_seats_read on public.lyst_counter_seats for select to authenticated using (user_id = (select auth.uid()) or private.can_score(event_id));
grant select on public.lyst_counter_seats to authenticated;
revoke insert, update, delete on public.lyst_counter_seats from public, anon, authenticated;

-- Append-only tally: a tap is a row; an undo is a row that points at the tap it reverses. Nothing is edited or removed.
create table if not exists public.lyst_counts (
  id uuid primary key,                       -- chosen by the counter's device: a retried send is recognised and ignored
  seat_id uuid not null references public.lyst_counter_seats (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  weight integer not null default 1 check (weight between 0 and 2),
  undo_of uuid references public.lyst_counts (id),
  created_at timestamptz not null default clock_timestamp(),
  check ((undo_of is null and weight >= 1) or (undo_of is not null and weight = 0))
);
create index if not exists lyst_counts_seat_idx on public.lyst_counts (seat_id, round_no, created_at);
create index if not exists lyst_counts_match_idx on public.lyst_counts (match_id, round_no);
create index if not exists lyst_counts_undo_idx on public.lyst_counts (undo_of);
create unique index if not exists lyst_counts_one_undo on public.lyst_counts (undo_of) where undo_of is not null;
alter table public.lyst_counts enable row level security;
create policy lyst_counts_read on public.lyst_counts for select to authenticated
  using (private.can_score(private.event_of_match(match_id)) or exists (select 1 from public.lyst_counter_seats s where s.id = seat_id and s.user_id = (select auth.uid())));
grant select on public.lyst_counts to authenticated;
revoke insert, update, delete on public.lyst_counts from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'lyst_counts_no_change' and tgrelid = 'public.lyst_counts'::regclass) then
    create trigger lyst_counts_no_change before update or delete on public.lyst_counts for each row execute function private.lyst_append_only();
  end if;
end $do$;

create table if not exists public.lyst_counter_rounds (
  seat_id uuid not null references public.lyst_counter_seats (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no integer not null,
  submitted_at timestamptz not null default now(),
  primary key (seat_id, match_id, round_no)
);
create index if not exists lyst_counter_rounds_match_idx on public.lyst_counter_rounds (match_id);
alter table public.lyst_counter_rounds enable row level security;
create policy lyst_counter_rounds_read on public.lyst_counter_rounds for select to authenticated
  using (exists (select 1 from public.lyst_counter_seats s where s.id = seat_id and (s.user_id = (select auth.uid()) or private.can_score(s.event_id))));
grant select on public.lyst_counter_rounds to authenticated;
revoke insert, update, delete on public.lyst_counter_rounds from public, anon, authenticated;

-- Failed code guesses, so a code cannot be brute-forced by a signed-in person.
create table if not exists public.lyst_join_attempts (id bigint generated always as identity primary key, user_id uuid not null, at timestamptz not null default now());
alter table public.lyst_join_attempts enable row level security;
revoke all on public.lyst_join_attempts from public, anon, authenticated;
create index if not exists lyst_join_attempts_idx on public.lyst_join_attempts (user_id, at);

-- ---------------------------------------------------------------- 2. counting rules (read by the counter's own functions; never by an official one)
create or replace function private.lyst_seat_total(p_seat uuid, p_round integer) returns integer
language sql stable security definer set search_path = '' as $$
  -- a seat can be carried to the next fight: its tally is always per MATCH (the seat's current one) and per round
  select coalesce(sum(c.weight), 0)::integer from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id and s.match_id = c.match_id
  where c.seat_id = p_seat and c.round_no = p_round and c.undo_of is null and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id)
$$;
revoke execute on function private.lyst_seat_total(uuid, integer) from public, anon, authenticated;

-- Frozen into the revision when the marshal's call is recorded: who tallied what, as evidence. Learning counters are listed as learning.
create or replace function private.lyst_counter_snapshot(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'user_id', s.user_id, 'slot', s.slot, 'side', s.side, 'role', s.role,
         'total', private.lyst_seat_total(s.id, p_round),
         'submitted', exists (select 1 from public.lyst_counter_rounds r where r.seat_id = s.id and r.match_id = p_match and r.round_no = p_round)) order by s.role, s.slot), '[]'::jsonb)
  from public.lyst_counter_seats s where s.match_id = p_match and s.status = 'active'
$$;
revoke execute on function private.lyst_counter_snapshot(uuid, integer) from public, anon, authenticated;

create or replace function private.lyst_side_name(p_entry uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(t.name, f.display_name, 'Fighter') from public.entries e left join public.teams t on t.id = e.team_id left join public.fighters f on f.id = e.fighter_id where e.id = p_entry
$$;
revoke execute on function private.lyst_side_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. the operator: join code, requests, assignment
create or replace function public.create_lyst_join_code(p_event uuid, p_field text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_key text := private.field_key(p_field); v_code text; v_exp timestamptz := now() + interval '30 minutes';
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.can_score(p_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if private.event_closed(p_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  update public.lyst_join_codes set revoked_at = now() where event_id = p_event and field_key = v_key and revoked_at is null;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.lyst_join_codes (code, event_id, field_key, created_by, expires_at) values (v_code, p_event, v_key, auth.uid(), v_exp);
  perform private.audit(p_event, 'lyst.join_code', v_key, jsonb_build_object('expires_at', v_exp));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp, 'field_key', v_key);
end $$;

-- A signed-in person asks for a seat. It grants nothing: the operator assigns the fighter, the slot and the role. Idempotent per person and field.
create or replace function public.request_counter_seat(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_c public.lyst_join_codes; v_s public.lyst_counter_seats; v_name text; v_slug text; v_code text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if (select count(*) from public.lyst_join_attempts where user_id = v_uid and at > now() - interval '10 minutes') >= 15 then raise exception 'too many tries: wait a few minutes' using errcode = '22023'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_c from public.lyst_join_codes where code = v_code and revoked_at is null and expires_at > now();
  if not found then
    -- answered, not raised: an exception would roll the attempt back and the limit above would never count a wrong guess
    insert into public.lyst_join_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid', 'message', 'that join code is not valid or has expired: ask for a new one at the lyst tablet');
  end if;
  select * into v_s from public.lyst_counter_seats where user_id = v_uid and event_id = v_c.event_id and field_key = v_c.field_key and status in ('pending', 'active');
  if not found then
    v_name := coalesce(nullif(btrim(private.person_name(v_uid)), ''), 'Counter');
    insert into public.lyst_counter_seats (event_id, field_key, user_id, display_name) values (v_c.event_id, v_c.field_key, v_uid, left(v_name, 80)) returning * into v_s;
  end if;
  select slug into v_slug from public.events where id = v_c.event_id;
  return jsonb_build_object('status', v_s.status, 'seat_id', v_s.id, 'event_slug', v_slug, 'field_key', v_c.field_key);
end $$;

-- The operator seats a counter: which fight, which fighter (side), which slot, official or learning. Re-assigning is allowed (people move). A counter cannot do this.
create or replace function public.assign_counter_seat(p_seat uuid, p_match uuid, p_side text, p_role text default 'official', p_slot text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_event uuid; v_m public.matches; v_slot text := upper(nullif(btrim(coalesce(p_slot, '')), '')); v_n integer; v_i integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_s from public.lyst_counter_seats where id = p_seat for update;
  if not found then raise exception 'seat not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_s.event_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if v_s.status in ('ended', 'declined') then raise exception 'that counter is no longer on this lyst' using errcode = 'P0001'; end if;
  if p_side is null or p_side not in ('a', 'b') then raise exception 'say which fighter this counter watches' using errcode = '22023'; end if;
  if p_role is null or p_role not in ('official', 'learning') then raise exception 'role is official or learning' using errcode = '22023'; end if;
  v_m := private.lyst_match_check(v_s.event_id, p_match, v_s.field_key);
  if not exists (select 1 from public.lyst_matches where match_id = p_match) then raise exception 'open the match in Lyst Control first' using errcode = 'P0001'; end if;
  if v_slot is null then
    -- A, B watch fighter A; C, D watch fighter B; learners are L1, L2 ... in the order they are seated.
    if p_role = 'learning' then
      select count(*) + 1 into v_n from public.lyst_counter_seats where match_id = p_match and role = 'learning' and status = 'active' and id <> p_seat;
      v_slot := 'L' || v_n;
    else
      for v_i in 1..8 loop
        v_slot := substr('ABCDEFGH', v_i, 1);
        exit when (case when p_side = 'a' then v_i in (1, 2, 5, 6) else v_i in (3, 4, 7, 8) end)
          and not exists (select 1 from public.lyst_counter_seats where match_id = p_match and slot = v_slot and status = 'active' and id <> p_seat);
        v_slot := null;
      end loop;
      if v_slot is null then raise exception 'this fight has all its official counter seats filled' using errcode = 'P0001'; end if;
    end if;
  end if;
  if exists (select 1 from public.lyst_counter_seats where match_id = p_match and slot = v_slot and status = 'active' and id <> p_seat) then raise exception 'that slot is already taken' using errcode = 'P0001'; end if;
  update public.lyst_counter_seats set match_id = p_match, side = p_side, role = p_role, slot = v_slot, status = 'active', decided_at = now(), decided_by = auth.uid(), expires_at = now() + interval '8 hours' where id = p_seat returning * into v_s;
  perform private.audit(v_s.event_id, 'lyst.counter_assigned', p_match::text, jsonb_build_object('seat', p_seat, 'side', p_side, 'role', p_role, 'slot', v_slot));
  return jsonb_build_object('status', 'ok', 'seat_id', p_seat, 'slot', v_slot, 'role', p_role, 'side', p_side);
end $$;

create or replace function public.end_counter_seat(p_seat uuid, p_decline boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_s from public.lyst_counter_seats where id = p_seat for update;
  if not found then raise exception 'seat not found' using errcode = 'P0002'; end if;
  if v_s.user_id <> auth.uid() and not private.can_score(v_s.event_id) then raise exception 'you cannot do that' using errcode = '42501'; end if;
  if v_s.status in ('ended', 'declined') then return jsonb_build_object('status', 'unchanged'); end if;
  update public.lyst_counter_seats set status = case when p_decline and status = 'pending' then 'declined' else 'ended' end, decided_at = now(), decided_by = auth.uid() where id = p_seat;
  perform private.audit(v_s.event_id, 'lyst.counter_ended', coalesce(v_s.match_id::text, v_s.field_key), jsonb_build_object('seat', p_seat));
  return jsonb_build_object('status', 'ok');
end $$;

-- "Next fight": the counters stay, the seats move to the next match on the same field (same side and slot; the operator can still change any of them).
create or replace function public.carry_counter_seats(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid := private.event_of_match(p_from); v_m public.matches; v_f public.matches; v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_event is null or v_event is distinct from private.event_of_match(p_to) then raise exception 'match not found in this event' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  select * into v_f from public.matches where id = p_from;
  v_m := private.lyst_match_check(v_event, p_to, v_f.field);
  if not exists (select 1 from public.lyst_matches where match_id = p_to) then raise exception 'open the next match in Lyst Control first' using errcode = 'P0001'; end if;
  update public.lyst_counter_seats set match_id = p_to, expires_at = now() + interval '8 hours' where match_id = p_from and status = 'active';
  get diagnostics v_n = row_count;
  perform private.audit(v_event, 'lyst.counters_carried', p_to::text, jsonb_build_object('from', p_from, 'seats', v_n));
  return jsonb_build_object('status', 'ok', 'moved', v_n);
end $$;

-- ---------------------------------------------------------------- 4. the counter: count, undo, finish
-- All three: the caller must own an ACTIVE, unexpired seat on a match that is not final, and the round must be the one being fought (running). A counter never
-- touches a round, a score, another counter or the opponent: the only thing they can write is their own tally.
create or replace function private.lyst_seat_for_counting(p_seat uuid, p_round integer, p_need_running boolean) returns public.lyst_counter_seats
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_state text; v_cur integer; v_rs text;
begin
  select * into v_s from public.lyst_counter_seats where id = p_seat;
  if not found or v_s.user_id is distinct from auth.uid() then raise exception 'that is not your counter seat' using errcode = '42501'; end if;
  if v_s.status <> 'active' or v_s.expires_at is null or v_s.expires_at < now() or v_s.match_id is null then raise exception 'your counter seat is not active: ask the lyst for a new one' using errcode = 'P0001'; end if;
  select queue_state into v_state from public.matches where id = v_s.match_id;
  if v_state = 'final' then raise exception 'this fight is already final' using errcode = 'P0001'; end if;
  select max(round_no) into v_cur from public.lyst_rounds where match_id = v_s.match_id;
  if v_cur is null then raise exception 'ROUND_NOT_STARTED' using errcode = 'P0001'; end if;
  if p_round is distinct from v_cur then raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
  if p_need_running then
    select status into v_rs from public.lyst_rounds where match_id = v_s.match_id and round_no = v_cur;
    if v_rs is distinct from 'running' then raise exception 'ROUND_ENDED' using errcode = 'P0001'; end if;
  end if;
  return v_s;
end $$;
revoke execute on function private.lyst_seat_for_counting(uuid, integer, boolean) from public, anon, authenticated;

create or replace function public.counter_record(p_id uuid, p_seat uuid, p_round integer, p_weight integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_input text; v_old public.lyst_counts; v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_id is null then raise exception 'a tap id is required' using errcode = '22023'; end if;
  select * into v_old from public.lyst_counts where id = p_id;
  if found then
    if v_old.seat_id <> p_seat or (select user_id from public.lyst_counter_seats where id = p_seat) is distinct from auth.uid() then raise exception 'that tap id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.lyst_seat_total(p_seat, v_old.round_no));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  select counter_input into v_input from public.lyst_matches where match_id = v_s.match_id;
  if p_weight is null or p_weight < 1 or p_weight > 2 or (coalesce(v_input, 'simple') = 'simple' and p_weight <> 1) then raise exception 'that count is not allowed in this fight' using errcode = '22023'; end if;
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight) values (p_id, p_seat, v_s.match_id, p_round, p_weight) on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n = 1 then 'ok' else 'duplicate' end, 'total', private.lyst_seat_total(p_seat, p_round));
end $$;

-- Reverses this counter's most recent tap in the round that is being fought. A retried undo (same id) reverses nothing twice.
create or replace function public.counter_undo(p_id uuid, p_seat uuid, p_round integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_old public.lyst_counts; v_target uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_id is null then raise exception 'an undo id is required' using errcode = '22023'; end if;
  select * into v_old from public.lyst_counts where id = p_id;
  if found then
    if v_old.seat_id <> p_seat or (select user_id from public.lyst_counter_seats where id = p_seat) is distinct from auth.uid() then raise exception 'that id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.lyst_seat_total(p_seat, v_old.round_no));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  select c.id into v_target from public.lyst_counts c
    where c.seat_id = p_seat and c.match_id = v_s.match_id and c.round_no = p_round and c.undo_of is null and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id)
    order by c.created_at desc, c.id desc limit 1;
  if v_target is null then return jsonb_build_object('status', 'nothing', 'total', 0); end if;
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, undo_of) values (p_id, p_seat, v_s.match_id, p_round, 0, v_target) on conflict do nothing;
  return jsonb_build_object('status', 'ok', 'total', private.lyst_seat_total(p_seat, p_round));
end $$;

-- "I am done counting this round." Allowed while the round runs or is being confirmed. Recorded; it changes nothing official.
create or replace function public.counter_submit(p_seat uuid, p_round integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, false);
  insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values (p_seat, v_s.match_id, p_round) on conflict do nothing;
  return jsonb_build_object('status', 'ok', 'total', private.lyst_seat_total(p_seat, p_round));
end $$;

-- What a counter's phone shows. Only the caller's own seat, the fighter they watch (a public name), the round, their own tally and the public timer.
create or replace function public.counter_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_m public.matches; v_cur public.lyst_rounds; v_slug text; v_input text; v_t public.lyst_timer; v_comp text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_s from public.lyst_counter_seats where user_id = auth.uid() and status in ('pending', 'active') order by requested_at desc limit 1;
  if not found then return jsonb_build_object('seat', null, 'server_now', clock_timestamp()); end if;
  select slug into v_slug from public.events where id = v_s.event_id;
  if v_s.status = 'pending' or v_s.match_id is null then
    return jsonb_build_object('seat', jsonb_build_object('id', v_s.id, 'status', v_s.status, 'field_key', v_s.field_key), 'event_slug', v_slug, 'server_now', clock_timestamp());
  end if;
  select * into v_m from public.matches where id = v_s.match_id;
  select name into v_comp from public.competitions where id = v_m.competition_id;
  select counter_input into v_input from public.lyst_matches where match_id = v_s.match_id;
  select * into v_cur from public.lyst_rounds where match_id = v_s.match_id order by round_no desc limit 1;
  select * into v_t from public.lyst_timer where event_id = v_s.event_id and field_key = v_s.field_key and match_id = v_s.match_id;
  return jsonb_build_object(
    'seat', jsonb_build_object('id', v_s.id, 'status', case when v_s.expires_at < now() then 'expired' else v_s.status end, 'slot', v_s.slot, 'side', v_s.side, 'role', v_s.role, 'field_key', v_s.field_key),
    'event_slug', v_slug, 'competition', v_comp, 'round_label', v_m.round_label, 'match_id', v_m.id, 'final', v_m.queue_state = 'final',
    'fighter', private.lyst_side_name(case when v_s.side = 'a' then v_m.entry_a else v_m.entry_b end),
    'counter_input', coalesce(v_input, 'simple'),
    'round', case when v_cur.match_id is null then null else jsonb_build_object('no', v_cur.round_no, 'status', v_cur.status) end,
    'my_total', case when v_cur.match_id is null then 0 else private.lyst_seat_total(v_s.id, v_cur.round_no) end,
    'submitted', case when v_cur.match_id is null then false else exists (select 1 from public.lyst_counter_rounds r where r.seat_id = v_s.id and r.match_id = v_s.match_id and r.round_no = v_cur.round_no) end,
    'can_count', v_s.status = 'active' and v_s.expires_at >= now() and v_m.queue_state <> 'final' and v_cur.status = 'running',
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------- 5. the tablet's whole picture (staff only), one read
create or replace function public.lyst_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_key text; v_t public.lyst_timer; v_lm public.lyst_matches;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  select * into v_m from public.matches where id = p_match;
  v_key := private.field_key(v_m.field);
  select * into v_t from public.lyst_timer where event_id = v_event and field_key = v_key;
  select * into v_lm from public.lyst_matches where match_id = p_match;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'match', jsonb_build_object('id', v_m.id, 'field_key', v_key, 'queue_state', v_m.queue_state, 'version', v_m.version, 'stage', v_m.stage),
    'lyst', case when v_lm.match_id is null then null else jsonb_build_object('counter_input', v_lm.counter_input) end,
    'settings', private.lyst_settings_for(v_event),
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'rounds', coalesce((select jsonb_agg(to_jsonb(s) - 'event_id' order by s.round_no) from public.lyst_round_scores s where s.match_id = p_match), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('round_no', r.round_no, 'kind', r.kind, 'previous_a', r.previous_a, 'previous_b', r.previous_b, 'awarded_a', r.awarded_a, 'awarded_b', r.awarded_b,
                  'recommended_a', r.recommended_a, 'recommended_b', r.recommended_b, 'reason', r.reason, 'changed_at', r.changed_at) order by r.changed_at) from public.lyst_round_revisions r where r.match_id = p_match), '[]'::jsonb),
    'discipline', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'round_no', d.round_no, 'side', d.side, 'kind', d.kind, 'label', d.label, 'amount', d.amount, 'voided_at', d.voided_at,
                  'reason', p.reason, 'called_by', p.called_by, 'void_reason', p.void_reason, 'created_at', d.created_at) order by d.created_at)
                  from public.match_discipline d join public.match_discipline_private p on p.discipline_id = d.id where d.match_id = p_match), '[]'::jsonb),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name, 'slot', s.slot, 'side', s.side, 'role', s.role, 'status', s.status,
                  'tallies', coalesce((select jsonb_agg(jsonb_build_object('round_no', rr.round_no, 'total', private.lyst_seat_total(s.id, rr.round_no),
                        'submitted', exists (select 1 from public.lyst_counter_rounds cr where cr.seat_id = s.id and cr.match_id = p_match and cr.round_no = rr.round_no)) order by rr.round_no)
                        from public.lyst_rounds rr where rr.match_id = p_match), '[]'::jsonb)) order by s.role, s.slot)
                  from public.lyst_counter_seats s where s.match_id = p_match and s.status = 'active'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name, 'requested_at', s.requested_at) order by s.requested_at)
                  from public.lyst_counter_seats s where s.event_id = v_event and s.field_key = v_key and s.status = 'pending'), '[]'::jsonb),
    'join_code', (select jsonb_build_object('code', c.code, 'expires_at', c.expires_at) from public.lyst_join_codes c
                  where c.event_id = v_event and c.field_key = v_key and c.revoked_at is null and c.expires_at > now() order by c.created_at desc limit 1));
end $$;

-- ---------------------------------------------------------------- 6. finalization: the existing human path, fed ONLY by the official rounds
-- The tablet shows the totals and asks a person to confirm; this function then saves through submit_match_result (idempotent, version-checked, bracket progression,
-- audit, conflict handling: exactly as before). The numbers are read from lyst_rounds here, so a result cannot disagree with what the marshal awarded.
-- A winner on SCORES must lead on the official totals. A DQ needs a recorded disqualification against the other side; a technical result needs the marshal's reason.
create or replace function public.lyst_finalize(p_command uuid, p_match uuid, p_expected_version integer, p_result text, p_basis text default 'score', p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_ta integer; v_tb integer; v_n integer; v_open integer; v_detail jsonb; v_m public.matches; v_loser text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_basis is null or p_basis not in ('score', 'dq', 'technical') then raise exception 'basis is score, dq or technical' using errcode = '22023'; end if;
  -- a retry of an already saved command is answered by submit_match_result itself (duplicate); do not recheck a now-final match here
  if exists (select 1 from public.result_proposals where id = p_command) then
    return public.submit_match_result(p_command, p_match, p_result, 0, 0, '{}'::jsonb, coalesce(p_expected_version, 0));
  end if;
  select * into v_m from public.matches where id = p_match;
  select count(*), count(*) filter (where status <> 'confirmed') into v_n, v_open from public.lyst_rounds where match_id = p_match;
  if v_n = 0 then raise exception 'no round has been confirmed yet' using errcode = 'P0001'; end if;
  if v_open > 0 then raise exception 'confirm every round before finishing the match' using errcode = 'P0001'; end if;
  select coalesce(sum(official_a), 0), coalesce(sum(official_b), 0) into v_ta, v_tb from public.lyst_round_scores where match_id = p_match and status = 'confirmed';
  if p_basis = 'score' then
    if (p_result = 'a' and v_ta <= v_tb) or (p_result = 'b' and v_tb <= v_ta) or (p_result = 'draw' and v_ta <> v_tb) then raise exception 'the official totals do not support that result' using errcode = 'P0001'; end if;
  elsif p_basis = 'dq' then
    if p_result = 'draw' then raise exception 'a disqualification has a winner' using errcode = '22023'; end if;
    v_loser := case when p_result = 'a' then 'b' else 'a' end;
    if not exists (select 1 from public.match_discipline where match_id = p_match and kind = 'dq' and side = v_loser and voided_at is null) then raise exception 'record the disqualification first' using errcode = 'P0001'; end if;
  else
    if p_result = 'draw' or char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a technical result needs a winner and the marshal''s reason' using errcode = '22023'; end if;
  end if;
  v_detail := jsonb_build_object(
    'kind', 'duel',
    'rounds', jsonb_build_object('a', (select jsonb_agg(official_a order by round_no) from public.lyst_round_scores where match_id = p_match), 'b', (select jsonb_agg(official_b order by round_no) from public.lyst_round_scores where match_id = p_match)),
    'totals', jsonb_build_object('a', v_ta, 'b', v_tb),
    'lyst', jsonb_build_object('basis', p_basis, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'rounds', (select jsonb_agg(jsonb_build_object('round', round_no, 'awarded_a', awarded_a, 'awarded_b', awarded_b, 'deduct_a', deduct_a, 'deduct_b', deduct_b, 'official_a', official_a, 'official_b', official_b) order by round_no)
                 from public.lyst_round_scores where match_id = p_match),
      'discipline', coalesce((select jsonb_agg(jsonb_build_object('round', round_no, 'side', side, 'kind', kind, 'label', label, 'amount', amount) order by created_at)
                 from public.match_discipline where match_id = p_match and voided_at is null), '[]'::jsonb)));
  return public.submit_match_result(p_command, p_match, p_result, v_ta, v_tb, v_detail, p_expected_version);
end $$;

-- ---------------------------------------------------------------- 7. public state: one clean read for Arena now and Broadcast (Pack 14) later
-- Official data only. No counters, no learners, no reasons or notes, no account ids. security_invoker: it follows the public tables' own row-level rules.
create or replace view public.lyst_public_state with (security_invoker = true) as
select m.id as match_id, k.event_id, lower(coalesce(nullif(btrim(m.field), ''), 'Field 1')) as field_key, m.queue_state,
       t.mode as timer_mode, t.status as timer_status, t.duration_ms as timer_duration_ms, t.remaining_ms as timer_remaining_ms, t.started_at as timer_started_at, t.rev as timer_rev, t.round_no as timer_round,
       cur.round_no, cur.status as round_status,
       coalesce(tot.official_a, 0)::integer as official_a, coalesce(tot.official_b, 0)::integer as official_b, coalesce(tot.rounds_confirmed, 0)::integer as rounds_confirmed,
       coalesce(dis.items, '[]'::jsonb) as discipline,
       clock_timestamp() as server_now
from public.matches m
join public.competitions k on k.id = m.competition_id
left join public.lyst_timer t on t.event_id = k.event_id and t.field_key = lower(coalesce(nullif(btrim(m.field), ''), 'Field 1')) and t.match_id = m.id
left join lateral (select r.round_no, r.status from public.lyst_rounds r where r.match_id = m.id order by r.round_no desc limit 1) cur on true
left join lateral (select sum(s.official_a) as official_a, sum(s.official_b) as official_b, count(*) filter (where s.status = 'confirmed') as rounds_confirmed from public.lyst_round_scores s where s.match_id = m.id and s.status = 'confirmed') tot on true
left join lateral (select jsonb_agg(jsonb_build_object('round', d.round_no, 'side', d.side, 'kind', d.kind, 'label', d.label, 'amount', d.amount) order by d.created_at) as items
                   from public.match_discipline d where d.match_id = m.id and d.voided_at is null) dis on true
where cur.round_no is not null or t.match_id is not null;
grant select on public.lyst_public_state to anon, authenticated;

-- ---------------------------------------------------------------- 8. privileges
revoke execute on function public.create_lyst_join_code(uuid, text), public.request_counter_seat(text), public.assign_counter_seat(uuid, uuid, text, text, text), public.end_counter_seat(uuid, boolean),
  public.carry_counter_seats(uuid, uuid), public.counter_record(uuid, uuid, integer, integer), public.counter_undo(uuid, uuid, integer), public.counter_submit(uuid, integer),
  public.counter_state(), public.lyst_state(uuid), public.lyst_finalize(uuid, uuid, integer, text, text, text) from public, anon;
grant execute on function public.create_lyst_join_code(uuid, text), public.request_counter_seat(text), public.assign_counter_seat(uuid, uuid, text, text, text), public.end_counter_seat(uuid, boolean),
  public.carry_counter_seats(uuid, uuid), public.counter_record(uuid, uuid, integer, integer), public.counter_undo(uuid, uuid, integer), public.counter_submit(uuid, integer),
  public.counter_state(), public.lyst_state(uuid), public.lyst_finalize(uuid, uuid, integer, text, text, text) to authenticated;
