-- Pack 27B: Training Counters. A person learning to count scans the TRAINING COUNTER QR, says who they are, picks a Lyst and a side, and counts the same
-- screen as the official counters: no account, no approval, no second code. The training QR is a second reusable pool credential of the event
-- (event_credentials.kind = 'counter_pool' with training = true): it opens the same kind of low-privilege counter session as the Counter QR, so
-- everything that already works for a counter phone (sign-in, many sessions on one credential, following the Lyst, stale-tap refusal, Change Counter /
-- Lyst / Side, Exit, the device allow-list) works unchanged. What differs is on the server, by the credential:
--   * every place a training session takes on a fight is a LEARNING seat (role 'learning'), never an official one, however it binds, follows or is moved;
--   * learning seats are kept out of the OFFICIAL evidence frozen with the marshal's call (private.lyst_counter_snapshot: official seats only);
--     the tablet still lists them apart under "Training (never official)" (lyst_state carries them with their role);
--   * the learner's own screen state says training = true and carries the official counters of the same side in the live round as a list to compare
--     against (names and numbers, one per official phone, never a combined number).
-- The Pack 13/25 account path (the per-Lyst training code, join_training_counter) is left in place for a signed-in person who already has such a code;
-- nothing new is built on it and the Lyst's Training tab now shows the Training Counter QR.
-- Additive: one column, two partial unique indexes replacing one, functions redefined (create_event_credential and counter_pool_code gain a trailing
-- defaulted argument, so they are dropped and recreated; the device allow-list entry for counter_pool_code changes accordingly, regenerated and reviewed).
-- Backfill: nothing in flight changes (existing pools are official, training = false by default).

-- ---------------------------------------------------------------- 1. the Training Counter QR is a pool credential marked training
alter table public.event_credentials add column training boolean not null default false;
alter table public.event_credentials add constraint event_credentials_training_pool check (not training or kind = 'counter_pool');
drop index public.event_credentials_pool_open;
create unique index event_credentials_pool_open on public.event_credentials (event_id) where kind = 'counter_pool' and not training and revoked_at is null;
create unique index event_credentials_training_pool_open on public.event_credentials (event_id) where kind = 'counter_pool' and training and revoked_at is null;
comment on column public.event_credentials.training is 'Pack 27B: this counter pool is the event''s Training Counter QR: its sessions only ever hold learning seats.';

/** is this counter session a training one? (by its credential; null / false for an account or an official phone) */
create function private.counter_training(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.training from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where s.id = p_session), false)
$$;
revoke execute on function private.counter_training(uuid) from public, anon, authenticated;

drop function public.create_event_credential(uuid, text, text, text, bytea, timestamptz, text);
create function public.create_event_credential(p_event uuid, p_kind text, p_label text, p_role text, p_code_hash bytea, p_expires_at timestamptz default null, p_pool_code text default null, p_training boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_label text := btrim(coalesce(p_label, '')); v_id uuid; v_training boolean := coalesce(p_training, false);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can create device codes' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('device', 'controller', 'counter_pool') then raise exception 'unknown credential kind' using errcode = '22023'; end if;
  if p_kind = 'device' and (p_role is null or p_role not in ('counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer')) then raise exception 'unknown device role' using errcode = '22023'; end if;
  if p_kind = 'controller' and p_role is distinct from 'broadcast_controller' then raise exception 'unknown controller role' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and p_role is distinct from 'counter' then raise exception 'the counter pool is for counters' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and (p_pool_code is null or p_pool_code !~ '^[0-9A-HJKMNP-TV-Z]{12}$') then raise exception 'the counter pool needs its code' using errcode = '22023'; end if;
  if p_kind <> 'counter_pool' and p_pool_code is not null then raise exception 'only the counter pool keeps its code' using errcode = '22023'; end if;
  if v_training and p_kind <> 'counter_pool' then raise exception 'only a counter pool can be a training one' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and v_label = '' then v_label := case when v_training then 'Training Counter QR' else 'Counter QR' end; end if;
  if char_length(v_label) < 1 or char_length(v_label) > 40 then raise exception 'a device name is 1 to 40 characters' using errcode = '22023'; end if;
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then raise exception 'bad code verifier' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then raise exception 'the expiry must be in the future' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:cred:' || p_event::text, 0));
  if p_kind = 'device' and (select count(*) from public.event_credentials where event_id = p_event and kind = 'device' and revoked_at is null) >= 40 then
    raise exception 'an event can have 40 device codes at a time' using errcode = '22023'; end if;
  if p_kind = 'controller' and exists (select 1 from public.event_credentials where event_id = p_event and kind = 'controller' and revoked_at is null) then
    raise exception 'this event already has a stream controller code: replace or revoke it' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and exists (select 1 from public.event_credentials where event_id = p_event and kind = 'counter_pool' and training = v_training and revoked_at is null) then
    raise exception '%', case when v_training then 'this event already has a Training Counter QR: show it, or revoke it first' else 'this event already has a Counter QR: show it, or revoke it first' end using errcode = '22023'; end if;
  if exists (select 1 from public.event_credentials where event_id = p_event and lower(label) = lower(v_label) and revoked_at is null) then
    raise exception 'a device with that name already exists for this event' using errcode = '23505'; end if;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, expires_at, created_by, pool_code, training)
  values (p_event, p_kind, v_label, p_role, p_code_hash, p_expires_at, auth.uid(), case when p_kind = 'counter_pool' then p_pool_code end, v_training) returning id into v_id;
  perform private.audit(p_event, case p_kind when 'controller' then 'controller.created' when 'counter_pool' then (case when v_training then 'training_pool.created' else 'counter_pool.created' end) else 'device.created' end, v_label, jsonb_build_object('credential_id', v_id, 'role', p_role, 'training', v_training));
  return jsonb_build_object('id', v_id, 'kind', p_kind, 'label', v_label, 'role', p_role, 'training', v_training, 'expires_at', private.device_credential_expiry(v_id));
end $$;
revoke execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz, text, boolean) from public, anon;
grant execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz, text, boolean) to authenticated;

-- DISPLAY either QR: the Counter QR (default) or the Training Counter QR, to anyone who may run a Lyst of this event
drop function public.counter_pool_code(uuid);
create function public.counter_pool_code(p_event uuid, p_training boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_c public.event_credentials; v_training boolean := coalesce(p_training, false);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_event is null or not (private.can_score(p_event) or private.is_owner()) then raise exception 'only this event''s scoring staff can show the Counter QR' using errcode = '42501'; end if;
  select * into v_c from public.event_credentials where event_id = p_event and kind = 'counter_pool' and training = v_training and revoked_at is null and private.device_valid_at(id, clock_timestamp());
  if not found then return jsonb_build_object('code', null, 'training', v_training, 'can_create', private.is_organizer(p_event)); end if;
  return jsonb_build_object('code', v_c.pool_code, 'credential_id', v_c.id, 'label', v_c.label, 'training', v_training, 'expires_at', private.device_credential_expiry(v_c.id),
    'open_sessions', (select count(*) from public.event_sessions s where s.credential_id = v_c.id and s.ended_at is null), 'can_create', private.is_organizer(p_event));
end $$;
revoke execute on function public.counter_pool_code(uuid, boolean) from public, anon;
grant execute on function public.counter_pool_code(uuid, boolean) to authenticated, bos_event_device;

-- the organizer's list names the training pool
drop function public.list_event_credentials(uuid);
create function public.list_event_credentials(p_event uuid)
returns table (id uuid, kind text, label text, role text, status text, used boolean, expires_at timestamptz, created_at timestamptz,
               last_signin_at timestamptz, last_seen_at timestamptz, signed_in_elsewhere_at timestamptz, revoked_at timestamptz, replaced boolean, open_sessions integer, training boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its device codes' using errcode = '42501'; end if;
  return query
    select c.id, c.kind, c.label, c.role,
           case when c.revoked_at is not null then 'revoked' when clock_timestamp() >= private.device_credential_expiry(c.id) then 'expired' else 'active' end,
           c.first_used_at is not null, private.device_credential_expiry(c.id), c.created_at, c.last_signin_at,
           (select max(s.last_seen_at) from public.event_sessions s where s.credential_id = c.id), c.elsewhere_at, c.revoked_at, c.replaced_by is not null,
           (select count(*)::integer from public.event_sessions s where s.credential_id = c.id and s.ended_at is null), c.training
    from public.event_credentials c where c.event_id = p_event
    order by (c.revoked_at is not null), (c.kind = 'counter_pool') desc, c.training, c.kind desc, c.role, lower(c.label);
end $$;
revoke execute on function public.list_event_credentials(uuid) from public, anon;
grant execute on function public.list_event_credentials(uuid) to authenticated;

-- the phone knows it is a training phone from its first call
create or replace function public.device_whoami() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; v_e public.events;
begin
  select * into d from private.device_ctx() limit 1;
  if not found then raise exception 'this device session has ended' using errcode = '42501'; end if;
  update public.event_sessions set last_seen_at = clock_timestamp() where id = d.session_id and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds');
  select * into v_e from public.events where id = d.event_id;
  return jsonb_build_object('session_id', d.session_id, 'credential_id', d.credential_id, 'kind', d.kind, 'role', d.role, 'label', d.label,
    'training', private.counter_training(d.session_id),
    'effective_roles', to_jsonb(private.device_effective_roles(d.role)),
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'timezone', v_e.timezone, 'ends_on', v_e.ends_on),
    'expires_at', private.device_credential_expiry(d.credential_id), 'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------- 2. a training session only ever holds a LEARNING seat
create or replace function public.counter_bind(p_field text, p_side text, p_operator text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sid uuid; v_event uuid; v_label text; v_key text; v_b public.counter_bindings; v_name text; v_match uuid; v_seat public.lyst_counter_seats; v_role text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  select session_id, event_id, label into v_sid, v_event, v_label from private.counter_session() as x(session_id uuid, event_id uuid, label text);
  if v_sid is null then raise exception 'this is not a counter phone of an event: scan the event''s Counter QR' using errcode = '42501'; end if;
  if p_side is not null and p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;
  v_key := private.field_key(p_field);
  if not exists (select 1 from private.event_field_keys(v_event) f where f.field_key = v_key) then raise exception 'this event has no such field' using errcode = '22023'; end if;
  if private.event_closed(v_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  v_role := case when private.counter_training(v_sid) then 'learning' else 'official' end;
  select * into v_b from public.counter_bindings where session_id = v_sid for update;
  v_name := left(nullif(btrim(coalesce(p_operator, '')), ''), 80);
  if v_name is null then v_name := v_b.operator_name; end if;
  if v_name is null then raise exception 'say who is counting' using errcode = '22023'; end if;
  insert into public.counter_bindings (session_id, event_id, field_key, side, operator_name, updated_at) values (v_sid, v_event, v_key, p_side, v_name, clock_timestamp())
  on conflict (session_id) do update set field_key = excluded.field_key, side = excluded.side, operator_name = excluded.operator_name, updated_at = clock_timestamp();
  if v_b.session_id is null or v_b.operator_name is distinct from v_name or v_b.field_key is distinct from v_key or v_b.side is distinct from p_side then
    perform private.counter_log_operator(v_sid, v_event, v_name, v_key, p_side);
  end if;
  -- the seat: same field and side keeps it (the tally carries on through an operator change); anything else ends it and seats the phone afresh
  select * into v_seat from public.lyst_counter_seats where user_id = v_sid and event_id = v_event and status = 'active' order by requested_at desc limit 1;
  v_match := private.field_current_match(v_event, v_key);
  if v_seat.id is not null and v_seat.field_key = v_key and v_seat.side is not distinct from p_side and v_seat.match_id is not distinct from v_match and v_seat.role = v_role then
    update public.lyst_counter_seats set display_name = v_name where id = v_seat.id and display_name is distinct from v_name;
  else
    update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = v_sid and event_id = v_event and status in ('pending', 'active');
    if p_side is not null then perform private.counter_seat_create(v_event, v_key, v_sid, v_name, v_match, p_side, v_role); end if;
  end if;
  perform private.audit(v_event, 'counter.bound', v_sid::text, jsonb_build_object('field', v_key, 'side', p_side, 'operator', v_name, 'match', v_match, 'role', v_role));
  return public.counter_state();
end $$;

-- following the Lyst: a bound phone with no seat yet is seated with the role its credential allows
create or replace function private.counter_rebind_field(p_event uuid, p_key text, p_match uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  -- seats on this field that are on another (or no) match: trainees and devices alike, each keeping its role
  for r in select s.user_id, s.display_name, s.side, s.role, b.operator_name, (es.id is not null) as device from public.lyst_counter_seats s
           left join public.event_sessions es on es.id = s.user_id left join public.counter_bindings b on b.session_id = s.user_id
           where s.event_id = p_event and s.field_key = p_key and s.status = 'active' and s.match_id is distinct from p_match loop
    perform private.counter_seat_create(p_event, p_key, r.user_id, r.display_name, p_match, r.side, r.role);
    if r.device and p_match is not null then perform private.counter_log_operator(r.user_id, p_event, coalesce(r.operator_name, r.display_name), p_key, r.side, p_match); end if;
    v_n := v_n + 1;
  end loop;
  -- bound devices with a side but no seat at all
  for r in select b.session_id, b.operator_name, b.side from public.counter_bindings b join public.event_sessions s on s.id = b.session_id
           where b.event_id = p_event and b.field_key = p_key and b.side is not null and s.ended_at is null
             and not exists (select 1 from public.lyst_counter_seats x where x.user_id = b.session_id and x.event_id = p_event and x.field_key = p_key and x.status = 'active') loop
    perform private.counter_seat_create(p_event, p_key, r.session_id, r.operator_name, p_match, r.side, case when private.counter_training(r.session_id) then 'learning' else 'official' end);
    if p_match is not null then perform private.counter_log_operator(r.session_id, p_event, r.operator_name, p_key, r.side, p_match); end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.audit(p_event, 'lyst.counters_followed', p_match::text, jsonb_build_object('field', p_key, 'seats', v_n)); end if;
  return v_n;
end $$;

-- a staff move keeps the phone's nature: a training phone moved to another Lyst is still learning
create or replace function public.move_counter_session(p_session uuid, p_field text, p_side text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.event_sessions; v_c public.event_credentials; v_key text; v_b public.counter_bindings; v_match uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  select s.* into v_s from public.event_sessions s where s.id = p_session and s.ended_at is null;
  if not found then raise exception 'that phone is not signed in' using errcode = 'P0002'; end if;
  select * into v_c from public.event_credentials where id = v_s.credential_id;
  if v_c.role <> 'counter' then raise exception 'only a counter phone can be moved' using errcode = '22023'; end if;
  if not (private.is_owner() or private.can_score(v_c.event_id)) then raise exception 'only this event''s scoring staff can move a counter' using errcode = '42501'; end if;
  if p_side is not null and p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;
  v_key := case when p_field is null then null else private.field_key(p_field) end;
  if v_key is not null and not exists (select 1 from private.event_field_keys(v_c.event_id) f where f.field_key = v_key) then raise exception 'this event has no such field' using errcode = '22023'; end if;
  select * into v_b from public.counter_bindings where session_id = p_session for update;
  insert into public.counter_bindings (session_id, event_id, field_key, side, operator_name, updated_at) values (p_session, v_c.event_id, v_key, p_side, v_b.operator_name, clock_timestamp())
  on conflict (session_id) do update set field_key = excluded.field_key, side = excluded.side, updated_at = clock_timestamp();
  update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = p_session and status in ('pending', 'active');
  if v_key is not null and p_side is not null then
    v_match := private.field_current_match(v_c.event_id, v_key);
    perform private.counter_seat_create(v_c.event_id, v_key, p_session, coalesce(v_b.operator_name, v_c.label), v_match, p_side, case when v_c.training then 'learning' else 'official' end);
  end if;
  perform private.audit(v_c.event_id, 'counter.moved', p_session::text, jsonb_build_object('field', v_key, 'side', p_side, 'by_staff', true));
  return private.device_session_row((select s from public.event_sessions s where s.id = p_session), v_c);
end $$;

-- ---------------------------------------------------------------- 3. the OFFICIAL evidence frozen with the marshal's call holds official counters only
create or replace function private.lyst_counter_snapshot(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'user_id', s.user_id, 'operator', s.display_name, 'slot', s.slot, 'side', s.side, 'role', s.role,
         'device', exists (select 1 from public.event_sessions es where es.id = s.user_id),
         'total', private.lyst_seat_total(s.id, p_round),
         'operators', private.lyst_seat_operators(s.id, p_match, p_round),
         'submitted', exists (select 1 from public.lyst_counter_rounds r where r.seat_id = s.id and r.match_id = p_match and r.round_no = p_round)) order by s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s where s.match_id = p_match and s.status = 'active' and s.role = 'official'
$$;

-- ---------------------------------------------------------------- 4. the learner's screen: training, and the official counters of the same side to compare against
create or replace function private.counter_state_for(p_sub uuid, p_touch boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sid uuid; v_event uuid; v_label text; v_b public.counter_bindings; v_s public.lyst_counter_seats; v_m public.matches; v_cur public.lyst_rounds; v_t public.lyst_timer;
  v_e public.events; v_input text; v_comp text; v_match uuid; v_key text; v_side text; v_per integer; v_total integer; v_kind text; v_fields jsonb; v_opponent text;
  v_training boolean := false; v_officials jsonb;
begin
  select s.id, c.event_id, c.label, c.training into v_sid, v_event, v_label, v_training from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
   where s.id = p_sub and s.ended_at is null and c.revoked_at is null and c.role = 'counter' and private.device_valid_at(c.id, clock_timestamp());
  if v_sid is not null then
    v_kind := 'device';
    if p_touch then update public.event_sessions set last_seen_at = clock_timestamp() where id = v_sid and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds'); end if;
    select * into v_b from public.counter_bindings where session_id = v_sid;
    select * into v_s from public.lyst_counter_seats where user_id = v_sid and status = 'active' order by requested_at desc limit 1;
    v_key := coalesce(v_s.field_key, v_b.field_key); v_side := coalesce(v_s.side, v_b.side);
  else
    v_kind := 'training'; v_training := true;
    select * into v_s from public.lyst_counter_seats where user_id = p_sub and status = 'active' and role = 'learning' order by requested_at desc limit 1;
    if v_s.id is null then return jsonb_build_object('kind', v_kind, 'training', true, 'seat', null, 'server_now', clock_timestamp()); end if;
    v_event := v_s.event_id; v_key := v_s.field_key; v_side := v_s.side;
  end if;
  select * into v_e from public.events where id = v_event;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label, 'open', c.match_id is not null,
      'now', case when c.match_id is null then null else jsonb_build_object('a', private.lyst_side_name(c.entry_a), 'b', private.lyst_side_name(c.entry_b)) end) order by f.field_key collate "C"), '[]'::jsonb) into v_fields
    from private.event_field_keys(v_event) f left join lateral (select m.id as match_id, m.entry_a, m.entry_b from public.matches m where m.id = private.field_current_match(v_event, f.field_key)) c on true;
  v_match := case when v_key is not null then private.field_current_match(v_event, v_key) end;
  if v_s.id is not null and v_s.match_id is not null and v_s.match_id = v_match then
    select * into v_m from public.matches where id = v_match;
    select name into v_comp from public.competitions where id = v_m.competition_id;
    select counter_input into v_input from public.lyst_matches where match_id = v_match;
    select * into v_cur from public.lyst_rounds where match_id = v_match order by round_no desc limit 1;
    select * into v_t from public.lyst_timer where event_id = v_event and field_key = v_key and match_id = v_match;
    v_per := private.lyst_per_side(v_match);
    v_total := case when v_cur.match_id is null then 0 else private.lyst_seat_total(v_s.id, v_cur.round_no) end;
    v_opponent := private.lyst_side_name(case when v_side = 'a' then v_m.entry_b else v_m.entry_a end);
    -- a learner compares against the OFFICIAL counters of the same side in this round: one line per official phone (names and numbers are what the
    -- tablet shows anyway); never a combined number. An official phone gets nothing here: it must not count by another counter's number.
    if v_s.role = 'learning' and v_cur.match_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('name', o.display_name, 'total', private.lyst_seat_total(o.id, v_cur.round_no)) order by o.display_name), '[]'::jsonb) into v_officials
        from public.lyst_counter_seats o where o.match_id = v_match and o.status = 'active' and o.role = 'official' and o.side = v_side;
    end if;
  end if;
  return jsonb_build_object(
    'kind', v_kind, 'training', v_training, 'session_id', v_sid, 'device_label', v_label,
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'closed', v_e.closed_at is not null),
    'fields', v_fields,
    'binding', case when v_kind = 'device' then jsonb_build_object('field_key', v_b.field_key, 'side', v_b.side, 'operator', v_b.operator_name) else jsonb_build_object('field_key', v_s.field_key, 'side', v_s.side, 'operator', v_s.display_name) end,
    'field_label', (select f.label from private.event_field_keys(v_event) f where f.field_key = v_key),
    'seat', case when v_s.id is null then null else jsonb_build_object('id', v_s.id, 'status', case when v_s.expires_at < now() then 'expired' else v_s.status end, 'side', v_s.side, 'role', v_s.role, 'field_key', v_s.field_key, 'operator', v_s.display_name, 'match_id', v_s.match_id) end,
    'waiting', v_s.id is not null and (v_s.match_id is null or v_s.match_id is distinct from v_match),
    'match_id', case when v_m.id is null then null else v_m.id end, 'competition', v_comp, 'round_label', v_m.round_label, 'final', coalesce(v_m.queue_state = 'final', false),
    'fighter', case when v_m.id is null then null else private.lyst_side_name(case when v_side = 'a' then v_m.entry_a else v_m.entry_b end) end,
    'opponent', v_opponent,
    'counter_input', coalesce(v_input, 'simple'), 'per_side', v_per, 'standing', case when v_input = 'standing' then greatest(0, v_per - coalesce(v_total, 0)) end,
    'round', case when v_cur.match_id is null then null else jsonb_build_object('no', v_cur.round_no, 'status', v_cur.status) end,
    'my_total', coalesce(v_total, 0),
    'officials', v_officials,
    'submitted', case when v_cur.match_id is null then false else exists (select 1 from public.lyst_counter_rounds r where r.seat_id = v_s.id and r.match_id = v_match and r.round_no = v_cur.round_no) end,
    'can_count', v_s.id is not null and v_s.status = 'active' and v_s.expires_at >= now() and v_side is not null and v_m.id is not null and v_m.queue_state <> 'final' and v_cur.status = 'running',
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'fights', case when v_key is null then null else private.field_fights(v_event, v_key) end,
    'sides', private.event_sides(v_event),
    'server_now', clock_timestamp());
end $$;

comment on table public.lyst_join_codes is 'Pack 13/25: the per-Lyst training code for a SIGNED-IN person (join_training_counter). Since Pack 27B the Training Counter QR (a training counter pool) is the way a trainee''s phone joins without an account; this stays for anyone who already has such a code.';
