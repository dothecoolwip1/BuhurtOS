-- Pack 25 HOSTED ROLLOUT (owner runs this ONCE in the Supabase SQL Editor on mvbxlebznlgroptwwdsm, as for Pack 24).
-- It is the committed migration supabase/migrations/20261020000100_pack25_counter_pool.sql, byte for byte, followed by the ledger row that
-- the Supabase migration tool would have written. Run it as a whole (the editor runs it in one transaction: either everything applies or nothing).
-- Why the owner: the Supabase MCP tool refuses to run any statement containing DROP without an interactive confirmation (three attempts on
-- 2026-10-07 timed out with nothing applied). The migration needs DROP for two constraint changes, one index, two function signature changes and
-- the three retired RPCs. Nothing in it deletes sporting data.
-- Preflight done 2026-10-07: hosted holds 20261007024220 result_revisions_search_path (= the repository's 20261019000300); every function this file
-- patches is byte-identical to the local build of main (pg_get_functiondef md5); no Pack 25 object exists on hosted.
-- After running: run supabase/tests/hosted/pack25_hosted_verify.sql (read-only checks), then tell the session / see STATUS.md.

-- Pack 25 (2026-10-07): the counter workflow. ADDITIVE, except that three functions of the old seating ceremony are dropped at the end
-- (request_counter_seat, assign_counter_seat, carry_counter_seats): nothing in the repository calls them any more.
--
-- The product model:
--   * One reusable COUNTER QR per event (event_credentials.kind = 'counter_pool', role 'counter'). Every scan opens its OWN session (multi-session):
--     a sixth phone never signs a fifth one out; a dead phone is simply replaced. The pool code is low privilege by construction (counter role only:
--     no staff role, no table, an allow-list of counter functions), so its plaintext is kept on the credential and shown to scoring staff.
--   * A counter phone is bound to the EVENT, a FIELD (Lyst) and a SIDE (counter_bindings). It is never bound to a fighter. When the Lyst opens the
--     next match on that field, every active counter seat on the field follows it (private.counter_rebind_field): no second QR, no reseat.
--   * The person holding the phone types their name (operator). It is logged (counter_operator_log, lyst_counts.operator_name) and never a permission.
--   * A field has ONE current Lyst match (lyst_field_current): counters can never be bound to two open matches on the same field.
--   * Training: the Lyst's join code is the TRAINING QR. A signed-in trainee joins as a learning counter at once (no approval), picks a side, counts.
--   * Team fights: counter_input 'standing' (a tap = a fighter down, bounded by the side's size). Evidence only, like every other count.
-- What does NOT change: the marshal's call is the only official score; counters only write their own tally on the live round of their own match;
-- revocation and expiry are checked on every call (private.device_ctx); the public view carries no counter data; learning never becomes official.

create function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack25 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $$;

-- ---------------------------------------------------------------- 1. the reusable counter pool credential
alter table public.event_credentials drop constraint event_credentials_kind_check;
alter table public.event_credentials add constraint event_credentials_kind_check check (kind in ('device', 'controller', 'counter_pool'));
alter table public.event_credentials drop constraint event_credentials_kind_role;
alter table public.event_credentials add constraint event_credentials_kind_role check (
  (kind = 'device' and role in ('counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer'))
  or (kind = 'controller' and role = 'broadcast_controller')
  or (kind = 'counter_pool' and role = 'counter'));
alter table public.event_credentials add column pool_code text check (pool_code is null or pool_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$');
alter table public.event_credentials add constraint event_credentials_pool_code check ((kind = 'counter_pool') = (pool_code is not null));
create unique index event_credentials_pool_open on public.event_credentials (event_id) where kind = 'counter_pool' and revoked_at is null;
comment on column public.event_credentials.pool_code is 'Pack 25: the plaintext of the event''s reusable Counter QR only (counter role, no other authority). Every other credential keeps a verifier only.';

alter table public.event_sessions add column multi boolean not null default false;
drop index public.event_sessions_one_open;
create unique index event_sessions_one_open on public.event_sessions (credential_id) where ended_at is null and not multi;
comment on column public.event_sessions.multi is 'Pack 25: a session of the counter pool. Many may be open on one credential; one is never ended by another.';

-- the counter pool reads as a device to everything that asks "what is this session?" (its role is counter; it has no staff role)
create or replace function private.device_ctx() returns table (session_id uuid, credential_id uuid, event_id uuid, kind text, role text, label text)
language sql stable security definer set search_path = '' as $$
  select s.id, c.id, c.event_id, case when c.kind = 'counter_pool' then 'device' else c.kind end, c.role, c.label
  from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
  where s.id = auth.uid() and s.ended_at is null and c.revoked_at is null
    and private.device_valid_at(c.id, clock_timestamp()) and private.event_org_enabled(c.event_id)
$$;

-- create: the pool is one credential per event; its plaintext travels in p_pool_code (the Edge Function mints it; the hash is still what signs in)
drop function public.create_event_credential(uuid, text, text, text, bytea, timestamptz);
create function public.create_event_credential(p_event uuid, p_kind text, p_label text, p_role text, p_code_hash bytea, p_expires_at timestamptz default null, p_pool_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_label text := btrim(coalesce(p_label, '')); v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can create device codes' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('device', 'controller', 'counter_pool') then raise exception 'unknown credential kind' using errcode = '22023'; end if;
  if p_kind = 'device' and (p_role is null or p_role not in ('counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer')) then raise exception 'unknown device role' using errcode = '22023'; end if;
  if p_kind = 'controller' and p_role is distinct from 'broadcast_controller' then raise exception 'unknown controller role' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and p_role is distinct from 'counter' then raise exception 'the counter pool is for counters' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and (p_pool_code is null or p_pool_code !~ '^[0-9A-HJKMNP-TV-Z]{12}$') then raise exception 'the counter pool needs its code' using errcode = '22023'; end if;
  if p_kind <> 'counter_pool' and p_pool_code is not null then raise exception 'only the counter pool keeps its code' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and v_label = '' then v_label := 'Counter QR'; end if;
  if char_length(v_label) < 1 or char_length(v_label) > 40 then raise exception 'a device name is 1 to 40 characters' using errcode = '22023'; end if;
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then raise exception 'bad code verifier' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then raise exception 'the expiry must be in the future' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:cred:' || p_event::text, 0));
  if p_kind = 'device' and (select count(*) from public.event_credentials where event_id = p_event and kind = 'device' and revoked_at is null) >= 40 then
    raise exception 'an event can have 40 device codes at a time' using errcode = '22023'; end if;
  if p_kind = 'controller' and exists (select 1 from public.event_credentials where event_id = p_event and kind = 'controller' and revoked_at is null) then
    raise exception 'this event already has a stream controller code: replace or revoke it' using errcode = '22023'; end if;
  if p_kind = 'counter_pool' and exists (select 1 from public.event_credentials where event_id = p_event and kind = 'counter_pool' and revoked_at is null) then
    raise exception 'this event already has a Counter QR: show it, or revoke it first' using errcode = '22023'; end if;
  if exists (select 1 from public.event_credentials where event_id = p_event and lower(label) = lower(v_label) and revoked_at is null) then
    raise exception 'a device with that name already exists for this event' using errcode = '23505'; end if;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, expires_at, created_by, pool_code)
  values (p_event, p_kind, v_label, p_role, p_code_hash, p_expires_at, auth.uid(), case when p_kind = 'counter_pool' then p_pool_code end) returning id into v_id;
  perform private.audit(p_event, case p_kind when 'controller' then 'controller.created' when 'counter_pool' then 'counter_pool.created' else 'device.created' end, v_label, jsonb_build_object('credential_id', v_id, 'role', p_role));
  return jsonb_build_object('id', v_id, 'kind', p_kind, 'label', v_label, 'role', p_role, 'expires_at', private.device_credential_expiry(v_id));
end $$;
revoke execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz, text) from public, anon;
grant execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz, text) to authenticated;

-- a replaced pool keeps its code? No: a replacement is a NEW code; the old sessions end. The pool's plaintext must come with the new hash, so a pool is
-- revoked and created again instead of replaced (the client does exactly that).
select pg_temp.bos_patch('public.replace_event_credential(uuid, bytea)'::regprocedure,
  $a$if v_c.revoked_at is not null then raise exception 'that device code was already revoked; create a new one' using errcode = '22023'; end if;$a$,
  $b$if v_c.revoked_at is not null then raise exception 'that device code was already revoked; create a new one' using errcode = '22023'; end if;
  if v_c.kind = 'counter_pool' then raise exception 'revoke the Counter QR and make a new one instead' using errcode = '22023'; end if;$b$);

-- sign in: a pool session never ends another; the "signed in elsewhere" flag is for single-session codes only
select pg_temp.bos_patch('public.device_open_session(bytea, bytea, text)'::regprocedure,
  $a$  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'signed_in_again' where credential_id = v_c.id and ended_at is null;
  get diagnostics v_open = row_count;
  insert into public.event_sessions (credential_id, secret_hash, last_seen_at) values (v_c.id, p_secret_hash, clock_timestamp()) returning id into v_sid;$a$,
  $b$  if v_c.kind = 'counter_pool' then
    v_open := 0;
    insert into public.event_sessions (credential_id, secret_hash, last_seen_at, multi) values (v_c.id, p_secret_hash, clock_timestamp(), true) returning id into v_sid;
  else
    update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'signed_in_again' where credential_id = v_c.id and ended_at is null;
    get diagnostics v_open = row_count;
    insert into public.event_sessions (credential_id, secret_hash, last_seen_at) values (v_c.id, p_secret_hash, clock_timestamp()) returning id into v_sid;
  end if;$b$);
select pg_temp.bos_patch('public.device_open_session(bytea, bytea, text)'::regprocedure,
  $a$return jsonb_build_object('ok', true, 'session_id', v_sid, 'credential_id', v_c.id, 'kind', v_c.kind,$a$,
  $b$return jsonb_build_object('ok', true, 'session_id', v_sid, 'credential_id', v_c.id, 'kind', case when v_c.kind = 'counter_pool' then 'device' else v_c.kind end,$b$);
select pg_temp.bos_patch('public.device_refresh_session(bytea)'::regprocedure,
  $a$return jsonb_build_object('ok', true, 'session_id', v_s.id, 'credential_id', v_c.id, 'kind', v_c.kind,$a$,
  $b$return jsonb_build_object('ok', true, 'session_id', v_s.id, 'credential_id', v_c.id, 'kind', case when v_c.kind = 'counter_pool' then 'device' else v_c.kind end,$b$);

-- the list the organizer sees: the pool shows as its own kind, with how many phones are on it right now
drop function public.list_event_credentials(uuid);
create function public.list_event_credentials(p_event uuid)
returns table (id uuid, kind text, label text, role text, status text, used boolean, expires_at timestamptz, created_at timestamptz,
               last_signin_at timestamptz, last_seen_at timestamptz, signed_in_elsewhere_at timestamptz, revoked_at timestamptz, replaced boolean, open_sessions integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its device codes' using errcode = '42501'; end if;
  return query
    select c.id, c.kind, c.label, c.role,
           case when c.revoked_at is not null then 'revoked' when clock_timestamp() >= private.device_credential_expiry(c.id) then 'expired' else 'active' end,
           c.first_used_at is not null, private.device_credential_expiry(c.id), c.created_at, c.last_signin_at,
           (select max(s.last_seen_at) from public.event_sessions s where s.credential_id = c.id), c.elsewhere_at, c.revoked_at, c.replaced_by is not null,
           (select count(*)::integer from public.event_sessions s where s.credential_id = c.id and s.ended_at is null)
    from public.event_credentials c where c.event_id = p_event
    order by (c.revoked_at is not null), (c.kind = 'counter_pool') desc, c.kind desc, c.role, lower(c.label);
end $$;
revoke execute on function public.list_event_credentials(uuid) from public, anon;
grant execute on function public.list_event_credentials(uuid) to authenticated;

-- DISPLAY the Counter QR: anyone who may run a Lyst of this event (organizer, head marshal, marshal, Secretary / Scorekeeper, their devices, the owner).
create function public.counter_pool_code(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_c public.event_credentials;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_event is null or not (private.can_score(p_event) or private.is_owner()) then raise exception 'only this event''s scoring staff can show the Counter QR' using errcode = '42501'; end if;
  select * into v_c from public.event_credentials where event_id = p_event and kind = 'counter_pool' and revoked_at is null and private.device_valid_at(id, clock_timestamp());
  if not found then return jsonb_build_object('code', null, 'can_create', private.is_organizer(p_event)); end if;
  return jsonb_build_object('code', v_c.pool_code, 'credential_id', v_c.id, 'label', v_c.label, 'expires_at', private.device_credential_expiry(v_c.id),
    'open_sessions', (select count(*) from public.event_sessions s where s.credential_id = v_c.id and s.ended_at is null), 'can_create', private.is_organizer(p_event));
end $$;

-- ---------------------------------------------------------------- 2. the field's one current Lyst match
create table public.lyst_field_current (
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text not null,
  match_id uuid not null references public.matches (id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (event_id, field_key)
);
create index lyst_field_current_match_idx on public.lyst_field_current (match_id);
alter table public.lyst_field_current enable row level security;
create policy lyst_field_current_read on public.lyst_field_current for select to authenticated using (private.can_score(event_id));
grant select on public.lyst_field_current to authenticated;
revoke insert, update, delete on public.lyst_field_current from public, anon, authenticated;
comment on table public.lyst_field_current is 'Pack 25: the one Lyst match a field is running (written by lyst_open, cleared when the match is final). Counters follow it.';

alter table public.lyst_matches drop constraint lyst_matches_counter_input_check;
alter table public.lyst_matches add constraint lyst_matches_counter_input_check check (counter_input in ('simple', 'weighted', 'standing'));

create function private.field_current_match(p_event uuid, p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select f.match_id from public.lyst_field_current f join public.matches m on m.id = f.match_id
  where f.event_id = p_event and f.field_key = p_key and m.queue_state <> 'final'
$$;
revoke execute on function private.field_current_match(uuid, text) from public, anon, authenticated;

-- fighters per side in a group fight ("5v5" -> 5); duels and anything unnamed read as 1
create function private.lyst_per_side(p_match uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(substring(k.category from '^(\d+)v\d+$'), '')::integer from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match), 1)
$$;
revoke execute on function private.lyst_per_side(uuid) from public, anon, authenticated;

-- the fields of an event: wherever a fight is placed, plus the event's numbered fields, plus any field a Lyst already ran
create function private.event_field_keys(p_event uuid) returns table (field_key text, label text)
language sql stable security definer set search_path = '' as $$
  with raw as (
    select coalesce(nullif(btrim(m.field), ''), 'Field 1') as label from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = p_event and m.queue_state <> 'final'
    union all
    select 'Field ' || g from public.events e, generate_series(1, greatest(1, coalesce(e.field_count, 1))) g where e.id = p_event
    union all
    select t.field_key from public.lyst_timer t where t.event_id = p_event)
  select lower(r.label) as field_key, min(r.label) as label from raw r group by 1 order by 1
$$;
revoke execute on function private.event_field_keys(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. counter bindings and operator history
create table public.counter_bindings (
  session_id uuid primary key references public.event_sessions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text,
  side text check (side is null or side in ('a', 'b')),
  operator_name text check (operator_name is null or char_length(operator_name) between 1 and 80),
  updated_at timestamptz not null default now()
);
create index counter_bindings_event_idx on public.counter_bindings (event_id, field_key);
alter table public.counter_bindings enable row level security;
revoke all on table public.counter_bindings from public, anon, authenticated;
comment on table public.counter_bindings is 'Pack 25: a counter phone''s place at the event: which field (Lyst) and which side it counts, and who holds it. Never a fighter; never a permission.';

create table public.counter_operator_log (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.event_sessions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  operator_name text not null,
  field_key text, side text,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz
);
create index counter_operator_log_session_idx on public.counter_operator_log (session_id, started_at);
create index counter_operator_log_event_idx on public.counter_operator_log (event_id, started_at);
alter table public.counter_operator_log enable row level security;
revoke all on table public.counter_operator_log from public, anon, authenticated;
create function private.operator_log_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'the operator log is append-only' using errcode = '42501'; end if;
  if (new.id, new.session_id, new.event_id, new.operator_name, new.field_key, new.side, new.started_at) is distinct from (old.id, old.session_id, old.event_id, old.operator_name, old.field_key, old.side, old.started_at)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    raise exception 'the operator log is append-only' using errcode = '42501'; end if;
  return new;
end $$;
revoke execute on function private.operator_log_guard() from public, anon, authenticated;
create trigger counter_operator_log_guard before update or delete on public.counter_operator_log for each row execute function private.operator_log_guard();
comment on table public.counter_operator_log is 'Pack 25: who held each counter phone, from when to when. Audit only.';

-- every tap names the person who made it (the operator at that moment)
alter table public.lyst_counts add column operator_name text;

-- ---------------------------------------------------------------- 4. seats follow the field
-- Every active seat on the field (device counters AND trainees) moves to the match that just opened: the old seat is ended (its tally stays as the
-- evidence of the old fight) and an identical seat is created on the new match, starting at zero. A binding with no seat yet (the phone chose a side
-- while no fight was open) gets its seat now.
create function private.counter_seat_create(p_event uuid, p_key text, p_user uuid, p_name text, p_match uuid, p_side text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = p_user and event_id = p_event and field_key = p_key and status in ('pending', 'active');
  insert into public.lyst_counter_seats (event_id, field_key, user_id, display_name, match_id, side, slot, role, status, decided_at, expires_at)
  values (p_event, p_key, p_user, left(coalesce(nullif(btrim(p_name), ''), 'Counter'), 80), p_match, p_side, null, p_role, 'active', clock_timestamp(), clock_timestamp() + interval '24 hours')
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.counter_seat_create(uuid, text, uuid, text, uuid, text, text) from public, anon, authenticated;

create function private.counter_rebind_field(p_event uuid, p_key text, p_match uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  -- seats on this field that are on another (or no) match: trainees and devices alike
  for r in select s.user_id, s.display_name, s.side, s.role from public.lyst_counter_seats s
           where s.event_id = p_event and s.field_key = p_key and s.status = 'active' and s.match_id is distinct from p_match loop
    perform private.counter_seat_create(p_event, p_key, r.user_id, r.display_name, p_match, r.side, r.role);
    v_n := v_n + 1;
  end loop;
  -- bound devices with a side but no seat at all
  for r in select b.session_id, b.operator_name, b.side from public.counter_bindings b join public.event_sessions s on s.id = b.session_id
           where b.event_id = p_event and b.field_key = p_key and b.side is not null and s.ended_at is null
             and not exists (select 1 from public.lyst_counter_seats x where x.user_id = b.session_id and x.event_id = p_event and x.field_key = p_key and x.status = 'active') loop
    perform private.counter_seat_create(p_event, p_key, r.session_id, r.operator_name, p_match, r.side, 'official');
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.audit(p_event, 'lyst.counters_followed', p_match::text, jsonb_build_object('field', p_key, 'seats', v_n)); end if;
  return v_n;
end $$;
revoke execute on function private.counter_rebind_field(uuid, text, uuid) from public, anon, authenticated;

-- lyst_open: the match becomes the field's current one, and the counters follow. 'standing' is the team-fight input.
create or replace function public.lyst_open(p_match uuid, p_counter_input text default 'simple') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_key text; v_prev uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_counter_input is null or p_counter_input not in ('simple', 'weighted', 'standing') then raise exception 'counter input is simple, weighted or standing' using errcode = '22023'; end if;
  v_m := private.lyst_match_check(v_event, p_match, null);
  v_key := private.field_key(v_m.field);
  insert into public.lyst_matches (match_id, event_id, field_key, counter_input) values (p_match, v_event, v_key, p_counter_input) on conflict (match_id) do nothing;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-field:' || v_event::text || ':' || v_key, 0));
  select match_id into v_prev from public.lyst_field_current where event_id = v_event and field_key = v_key;
  if v_prev is distinct from p_match then
    insert into public.lyst_field_current (event_id, field_key, match_id, opened_at) values (v_event, v_key, p_match, clock_timestamp())
    on conflict (event_id, field_key) do update set match_id = excluded.match_id, opened_at = excluded.opened_at;
    perform private.audit(v_event, 'lyst.field_current', p_match::text, jsonb_build_object('field', v_key, 'previous', v_prev));
  end if;
  perform private.counter_rebind_field(v_event, v_key, p_match);
  return jsonb_build_object('status', 'ok', 'match_id', p_match, 'counter_input', (select counter_input from public.lyst_matches where match_id = p_match));
end $$;

-- a final match leaves the field free (the timer stops as before)
create or replace function private.lyst_match_final() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.lyst_timer set status = 'idle', remaining_ms = duration_ms, started_at = null, rev = rev + 1, previous = null, updated_at = now() where match_id = new.id and status <> 'idle';
  delete from public.lyst_field_current where match_id = new.id;
  return null;
end $$;

-- ---------------------------------------------------------------- 5. the counter phone's own functions
-- a counter must be a counter-pool (or legacy counter device) session of THIS event; a signed-in person is a trainee
create function private.counter_session() returns record
language sql stable security definer set search_path = '' as $$
  select d.session_id, d.event_id, d.label from private.device_ctx() d where d.role = 'counter' limit 1
$$;
revoke execute on function private.counter_session() from public, anon, authenticated;

create function private.counter_log_operator(p_session uuid, p_event uuid, p_name text, p_key text, p_side text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.counter_operator_log set ended_at = clock_timestamp() where session_id = p_session and ended_at is null;
  insert into public.counter_operator_log (session_id, event_id, operator_name, field_key, side) values (p_session, p_event, p_name, p_key, p_side);
end $$;
revoke execute on function private.counter_log_operator(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Bind (or re-bind) this phone: which field, which side, who is counting. Changing the field or side ends the old seat (its evidence stays) and seats
-- the phone on the new field's current fight, if one is open. Any time, no approval.
create function public.counter_bind(p_field text, p_side text, p_operator text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sid uuid; v_event uuid; v_label text; v_key text; v_b public.counter_bindings; v_name text; v_match uuid; v_seat public.lyst_counter_seats;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  select session_id, event_id, label into v_sid, v_event, v_label from private.counter_session() as x(session_id uuid, event_id uuid, label text);
  if v_sid is null then raise exception 'this is not a counter phone of an event: scan the event''s Counter QR' using errcode = '42501'; end if;
  if p_side is not null and p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;
  v_key := private.field_key(p_field);
  if not exists (select 1 from private.event_field_keys(v_event) f where f.field_key = v_key) then raise exception 'this event has no such field' using errcode = '22023'; end if;
  if private.event_closed(v_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
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
  if v_seat.id is not null and v_seat.field_key = v_key and v_seat.side is not distinct from p_side and v_seat.match_id is not distinct from v_match then
    update public.lyst_counter_seats set display_name = v_name where id = v_seat.id and display_name is distinct from v_name;
  else
    update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = v_sid and event_id = v_event and status in ('pending', 'active');
    if p_side is not null then perform private.counter_seat_create(v_event, v_key, v_sid, v_name, v_match, p_side, 'official'); end if;
  end if;
  perform private.audit(v_event, 'counter.bound', v_sid::text, jsonb_build_object('field', v_key, 'side', p_side, 'operator', v_name, 'match', v_match));
  return public.counter_state();
end $$;

-- A new person takes the phone: the tally on screen carries on; the log records the handoff.
create function public.counter_set_operator(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sid uuid; v_event uuid; v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 80); v_b public.counter_bindings; v_s public.lyst_counter_seats;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if v_name is null then raise exception 'say who is counting' using errcode = '22023'; end if;
  select session_id, event_id into v_sid, v_event from private.counter_session() as x(session_id uuid, event_id uuid, label text);
  if v_sid is not null then
    select * into v_b from public.counter_bindings where session_id = v_sid for update;
    if v_b.session_id is null then
      insert into public.counter_bindings (session_id, event_id, operator_name) values (v_sid, v_event, v_name);
    else
      update public.counter_bindings set operator_name = v_name, updated_at = clock_timestamp() where session_id = v_sid;
    end if;
    if v_b.operator_name is distinct from v_name then perform private.counter_log_operator(v_sid, v_event, v_name, v_b.field_key, v_b.side); end if;
    update public.lyst_counter_seats set display_name = v_name where user_id = v_sid and status = 'active';
    perform private.audit(v_event, 'counter.operator', v_sid::text, jsonb_build_object('operator', v_name, 'previous', v_b.operator_name));
    return public.counter_state();
  end if;
  -- a trainee renames their own seat
  select * into v_s from public.lyst_counter_seats where user_id = auth.uid() and status = 'active' and role = 'learning' order by requested_at desc limit 1;
  if v_s.id is null then raise exception 'you are not counting' using errcode = 'P0001'; end if;
  update public.lyst_counter_seats set display_name = v_name where id = v_s.id;
  return public.counter_state();
end $$;

-- The phone stops counting here (a trainee leaves their seat the same way through end_counter_seat).
create function public.counter_leave() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sid uuid; v_event uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  select session_id, event_id into v_sid, v_event from private.counter_session() as x(session_id uuid, event_id uuid, label text);
  if v_sid is null then raise exception 'this is not a counter phone' using errcode = '42501'; end if;
  update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = v_sid and status in ('pending', 'active');
  update public.counter_operator_log set ended_at = clock_timestamp() where session_id = v_sid and ended_at is null;
  delete from public.counter_bindings where session_id = v_sid;
  perform private.audit(v_event, 'counter.left', v_sid::text, '{}'::jsonb);
  return public.counter_state();
end $$;

-- TRAINING: a signed-in person scans the Lyst's training QR, says their name and picks a side. Seated at once as a LEARNING counter (never official).
create function public.join_training_counter(p_code text, p_name text, p_side text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_c public.lyst_join_codes; v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 80); v_code text; v_match uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if exists (select 1 from private.device_ctx()) then raise exception 'an event phone counts through the Counter QR, not the training code' using errcode = '42501'; end if;
  if (select count(*) from public.lyst_join_attempts where user_id = v_uid and at > now() - interval '10 minutes') >= 15 then raise exception 'too many tries: wait a few minutes' using errcode = '22023'; end if;
  if p_side is null or p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_c from public.lyst_join_codes where code = v_code and revoked_at is null and expires_at > now();
  if not found then
    insert into public.lyst_join_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid', 'message', 'that training code is not valid or has expired: ask the Lyst for a new one');
  end if;
  if v_name is null then v_name := coalesce(nullif(btrim(private.person_name(v_uid)), ''), 'Trainee'); end if;
  if private.event_closed(v_c.event_id) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  v_match := private.field_current_match(v_c.event_id, v_c.field_key);
  perform private.counter_seat_create(v_c.event_id, v_c.field_key, v_uid, v_name, v_match, p_side, 'learning');
  update public.lyst_counter_seats set expires_at = clock_timestamp() + interval '8 hours' where user_id = v_uid and event_id = v_c.event_id and field_key = v_c.field_key and status = 'active';
  perform private.audit(v_c.event_id, 'lyst.trainee_joined', v_c.field_key, jsonb_build_object('name', v_name, 'side', p_side, 'match', v_match));
  return jsonb_build_object('status', 'ok', 'event_slug', (select slug from public.events where id = v_c.event_id), 'field_key', v_c.field_key, 'state', public.counter_state());
end $$;

-- the training QR lasts the day (it only lets a signed-in person practise; it grants nothing official)
select pg_temp.bos_patch('public.create_lyst_join_code(uuid, text)'::regprocedure, $a$v_exp timestamptz := now() + interval '30 minutes'$a$, $b$v_exp timestamptz := now() + interval '12 hours'$b$);

-- ---------------------------------------------------------------- 6. counting: own seat, live round, side chosen, standing bounded; every tap names the operator
create or replace function private.lyst_seat_for_counting(p_seat uuid, p_round integer, p_need_running boolean) returns public.lyst_counter_seats
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_state text; v_cur integer; v_rs text;
begin
  select * into v_s from public.lyst_counter_seats where id = p_seat;
  if not found or v_s.user_id is distinct from auth.uid() then raise exception 'that is not your counter seat' using errcode = '42501'; end if;
  if v_s.status <> 'active' or v_s.expires_at is null or v_s.expires_at < now() then raise exception 'your counter seat is not active: choose your Lyst and side again' using errcode = 'P0001'; end if;
  if v_s.match_id is null then raise exception 'WAITING_FOR_FIGHT' using errcode = 'P0001'; end if;
  if v_s.side is null then raise exception 'choose a side first' using errcode = 'P0001'; end if;
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

create or replace function public.counter_record(p_id uuid, p_seat uuid, p_round integer, p_weight integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_input text; v_old public.lyst_counts; v_n integer;
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_id is null then raise exception 'a tap id is required' using errcode = '22023'; end if;
  select * into v_old from public.lyst_counts where id = p_id;
  if found then
    if v_old.seat_id <> p_seat or (select user_id from public.lyst_counter_seats where id = p_seat) is distinct from auth.uid() then raise exception 'that tap id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.lyst_seat_total(p_seat, v_old.round_no));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  select counter_input into v_input from public.lyst_matches where match_id = v_s.match_id;
  if p_weight is null or p_weight < 1 or p_weight > 2 or (coalesce(v_input, 'simple') in ('simple', 'standing') and p_weight <> 1) then raise exception 'that count is not allowed in this fight' using errcode = '22023'; end if;
  if v_input = 'standing' and private.lyst_seat_total(p_seat, p_round) >= private.lyst_per_side(v_s.match_id) then raise exception 'everyone on that side is already down' using errcode = 'P0001'; end if;
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, operator_name) values (p_id, p_seat, v_s.match_id, p_round, p_weight, v_s.display_name) on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n = 1 then 'ok' else 'duplicate' end, 'total', private.lyst_seat_total(p_seat, p_round));
end $$;

select pg_temp.bos_patch('public.counter_undo(uuid, uuid, integer)'::regprocedure,
  $a$insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, undo_of) values (p_id, p_seat, v_s.match_id, p_round, 0, v_target) on conflict do nothing;$a$,
  $b$insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, undo_of, operator_name) values (p_id, p_seat, v_s.match_id, p_round, 0, v_target, v_s.display_name) on conflict do nothing;$b$);

-- the evidence frozen with the marshal's call now names the operator and says which side; slots are gone
create or replace function private.lyst_counter_snapshot(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'user_id', s.user_id, 'operator', s.display_name, 'slot', s.slot, 'side', s.side, 'role', s.role,
         'device', exists (select 1 from public.event_sessions es where es.id = s.user_id),
         'total', private.lyst_seat_total(s.id, p_round),
         'submitted', exists (select 1 from public.lyst_counter_rounds r where r.seat_id = s.id and r.match_id = p_match and r.round_no = p_round)) order by s.role, s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s where s.match_id = p_match and s.status = 'active'
$$;

-- ---------------------------------------------------------------- 7. what the phone shows (device or trainee), and the same read for a staff preview
create function private.counter_state_for(p_sub uuid, p_touch boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sid uuid; v_event uuid; v_label text; v_b public.counter_bindings; v_s public.lyst_counter_seats; v_m public.matches; v_cur public.lyst_rounds; v_t public.lyst_timer;
  v_e public.events; v_input text; v_comp text; v_match uuid; v_key text; v_side text; v_per integer; v_total integer; v_kind text; v_fields jsonb; v_opponent text;
begin
  select s.id, c.event_id, c.label into v_sid, v_event, v_label from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
   where s.id = p_sub and s.ended_at is null and c.revoked_at is null and c.role = 'counter' and private.device_valid_at(c.id, clock_timestamp());
  if v_sid is not null then
    v_kind := 'device';
    if p_touch then update public.event_sessions set last_seen_at = clock_timestamp() where id = v_sid and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds'); end if;
    select * into v_b from public.counter_bindings where session_id = v_sid;
    select * into v_s from public.lyst_counter_seats where user_id = v_sid and status = 'active' order by requested_at desc limit 1;
    v_key := coalesce(v_s.field_key, v_b.field_key); v_side := coalesce(v_s.side, v_b.side);
  else
    v_kind := 'training';
    select * into v_s from public.lyst_counter_seats where user_id = p_sub and status = 'active' and role = 'learning' order by requested_at desc limit 1;
    if v_s.id is null then return jsonb_build_object('kind', v_kind, 'seat', null, 'server_now', clock_timestamp()); end if;
    v_event := v_s.event_id; v_key := v_s.field_key; v_side := v_s.side;
  end if;
  select * into v_e from public.events where id = v_event;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label, 'open', private.field_current_match(v_event, f.field_key) is not null) order by f.field_key collate "C"), '[]'::jsonb) into v_fields from private.event_field_keys(v_event) f;
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
  end if;
  return jsonb_build_object(
    'kind', v_kind, 'session_id', v_sid, 'device_label', v_label,
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
    'submitted', case when v_cur.match_id is null then false else exists (select 1 from public.lyst_counter_rounds r where r.seat_id = v_s.id and r.match_id = v_match and r.round_no = v_cur.round_no) end,
    'can_count', v_s.id is not null and v_s.status = 'active' and v_s.expires_at >= now() and v_side is not null and v_m.id is not null and v_m.queue_state <> 'final' and v_cur.status = 'running',
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'server_now', clock_timestamp());
end $$;
revoke execute on function private.counter_state_for(uuid, boolean) from public, anon, authenticated;

create or replace function public.counter_state() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return private.counter_state_for(auth.uid(), true);
end $$;

-- ---------------------------------------------------------------- 8. what the Lyst sees: every counter of this fight as evidence (operator, side, tally, online, submitted); the training code
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
    'field_current', private.field_current_match(v_event, v_key),
    'per_side', private.lyst_per_side(p_match),
    'settings', private.lyst_settings_for(v_event),
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'rounds', coalesce((select jsonb_agg(to_jsonb(s) - 'event_id' order by s.round_no) from public.lyst_round_scores s where s.match_id = p_match), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('round_no', r.round_no, 'kind', r.kind, 'previous_a', r.previous_a, 'previous_b', r.previous_b, 'awarded_a', r.awarded_a, 'awarded_b', r.awarded_b,
                  'recommended_a', r.recommended_a, 'recommended_b', r.recommended_b, 'reason', r.reason, 'changed_at', r.changed_at) order by r.changed_at) from public.lyst_round_revisions r where r.match_id = p_match), '[]'::jsonb),
    'discipline', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'round_no', d.round_no, 'side', d.side, 'kind', d.kind, 'label', d.label, 'amount', d.amount, 'voided_at', d.voided_at,
                  'reason', p.reason, 'called_by', p.called_by, 'void_reason', p.void_reason, 'created_at', d.created_at) order by d.created_at)
                  from public.match_discipline d join public.match_discipline_private p on p.discipline_id = d.id where d.match_id = p_match), '[]'::jsonb),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name, 'slot', s.slot, 'side', s.side, 'role', s.role, 'status', s.status,
                  'device', es.id is not null, 'online', case when es.id is null then null else coalesce(es.last_seen_at > clock_timestamp() - interval '90 seconds', false) end,
                  'tallies', coalesce((select jsonb_agg(jsonb_build_object('round_no', rr.round_no, 'total', private.lyst_seat_total(s.id, rr.round_no),
                        'submitted', exists (select 1 from public.lyst_counter_rounds cr where cr.seat_id = s.id and cr.match_id = p_match and cr.round_no = rr.round_no)) order by rr.round_no)
                        from public.lyst_rounds rr where rr.match_id = p_match), '[]'::jsonb)) order by s.role, s.side, s.display_name)
                  from public.lyst_counter_seats s left join public.event_sessions es on es.id = s.user_id where s.match_id = p_match and s.status = 'active'), '[]'::jsonb),
    'field_counters', coalesce((select jsonb_agg(jsonb_build_object('session_id', b.session_id, 'operator', b.operator_name, 'side', b.side,
                  'online', coalesce(es.last_seen_at > clock_timestamp() - interval '90 seconds', false)) order by b.side, b.operator_name)
                  from public.counter_bindings b join public.event_sessions es on es.id = b.session_id where b.event_id = v_event and b.field_key = v_key and es.ended_at is null), '[]'::jsonb),
    'join_code', (select jsonb_build_object('code', c.code, 'expires_at', c.expires_at) from public.lyst_join_codes c
                  where c.event_id = v_event and c.field_key = v_key and c.revoked_at is null and c.expires_at > now() order by c.created_at desc limit 1));
end $$;

-- ---------------------------------------------------------------- 9. managing the phones: the event's staff and the platform owner
create function private.can_manage_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or exists (select 1 from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where s.id = p_session and private.is_event_operator(c.event_id))
$$;
revoke execute on function private.can_manage_session(uuid) from public, anon, authenticated;

create function private.device_session_row(s public.event_sessions, c public.event_credentials) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('session_id', s.id, 'credential_id', c.id, 'event_id', c.event_id,
    'event', (select jsonb_build_object('slug', e.slug, 'name', e.name, 'timezone', e.timezone) from public.events e where e.id = c.event_id),
    'kind', c.kind, 'label', c.label, 'role', c.role, 'created_at', s.created_at, 'last_seen_at', s.last_seen_at,
    'online', s.ended_at is null and coalesce(s.last_seen_at > clock_timestamp() - interval '90 seconds', false),
    'ended_at', s.ended_at, 'ended_reason', s.ended_reason, 'expires_at', private.device_credential_expiry(c.id),
    'status', case when s.ended_at is not null then 'ended' when c.revoked_at is not null then 'revoked' when clock_timestamp() >= private.device_credential_expiry(c.id) then 'expired' else 'active' end,
    'binding', (select jsonb_build_object('field_key', b.field_key, 'field_label', (select f.label from private.event_field_keys(c.event_id) f where f.field_key = b.field_key), 'side', b.side, 'operator', b.operator_name, 'updated_at', b.updated_at) from public.counter_bindings b where b.session_id = s.id),
    'seat', (select jsonb_build_object('match_id', x.match_id, 'side', x.side, 'role', x.role) from public.lyst_counter_seats x where x.user_id = s.id and x.status = 'active' order by x.requested_at desc limit 1))
$$;
revoke execute on function private.device_session_row(public.event_sessions, public.event_credentials) from public, anon, authenticated;

-- the event's phones: organizer, Temporary Organizer, head marshal, Secretary / Scorekeeper (what the Command / Live Ops screen needs), the owner
create function public.list_event_device_sessions(p_event uuid, p_include_ended boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_event is null or not (private.is_owner() or private.can_command(p_event)) then raise exception 'only this event''s organizers, head marshal or secretary can see its devices' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.device_session_row(s, c) order by (s.ended_at is not null), c.kind, lower(c.label), s.created_at)
    from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
    where c.event_id = p_event and (p_include_ended or s.ended_at is null)), '[]'::jsonb);
end $$;

-- every phone on the platform (the owner only)
create function public.platform_device_sessions(p_include_ended boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_owner() then raise exception 'only the platform owner can see every device' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.device_session_row(s, c) order by (s.ended_at is not null), s.last_seen_at desc nulls last, s.created_at desc)
    from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
    where p_include_ended or (s.ended_at is null and c.revoked_at is null)), '[]'::jsonb);
end $$;

-- move a counter phone to another Lyst or side (staff who may run the Lyst; the owner)
create function public.move_counter_session(p_session uuid, p_field text, p_side text) returns jsonb
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
    perform private.counter_seat_create(v_c.event_id, v_key, p_session, coalesce(v_b.operator_name, v_c.label), v_match, p_side, 'official');
  end if;
  perform private.audit(v_c.event_id, 'counter.moved', p_session::text, jsonb_build_object('field', v_key, 'side', p_side, 'by_staff', true));
  return private.device_session_row((select s from public.event_sessions s where s.id = p_session), v_c);
end $$;

-- sign ONE phone out (an organizer or Temporary Organizer of the event, or the owner). The credential stays; other phones are untouched.
create function public.end_event_session(p_session uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.event_sessions; v_c public.event_credentials;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  select s.* into v_s from public.event_sessions s where s.id = p_session for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if not private.can_manage_session(p_session) then raise exception 'only an organizer of this event can sign a device out' using errcode = '42501'; end if;
  select * into v_c from public.event_credentials where id = v_s.credential_id;
  if v_s.ended_at is not null then return jsonb_build_object('status', 'already_ended'); end if;
  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'signed_out_by_staff' where id = p_session;
  update public.lyst_counter_seats set status = 'ended', decided_at = clock_timestamp() where user_id = p_session and status in ('pending', 'active');
  update public.counter_operator_log set ended_at = clock_timestamp() where session_id = p_session and ended_at is null;
  perform private.audit(v_c.event_id, 'device.session_ended', v_c.label, jsonb_build_object('session_id', p_session, 'credential_id', v_c.id, 'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 140)));
  return jsonb_build_object('status', 'ended');
end $$;

-- a read-only look at what a counter phone shows (never "as" the device: nothing is written for it, nothing is touched)
create function public.device_session_preview(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_c public.event_credentials;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select c.* into v_c from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where s.id = p_session;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if not (private.is_owner() or private.can_command(v_c.event_id)) then raise exception 'only this event''s organizers, head marshal or secretary can preview a device' using errcode = '42501'; end if;
  if v_c.role <> 'counter' then return jsonb_build_object('kind', v_c.role, 'preview', false); end if;
  return private.counter_state_for(p_session, false);
end $$;

-- the operator history of a fight or a phone: who counted which side when (staff of the event)
create function public.counter_operator_history(p_event uuid, p_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not (private.is_owner() or private.can_score(p_event)) then raise exception 'only this event''s scoring staff can read the operator history' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('session_id', l.session_id, 'operator', l.operator_name, 'field_key', l.field_key, 'side', l.side, 'started_at', l.started_at, 'ended_at', l.ended_at) order by l.started_at desc)
    from public.counter_operator_log l where l.event_id = p_event and (p_session is null or l.session_id = p_session)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 10. the old ceremony goes
revoke execute on function public.request_counter_seat(text), public.assign_counter_seat(uuid, uuid, text, text, text), public.carry_counter_seats(uuid, uuid) from public, anon, authenticated, bos_event_device;
drop function public.request_counter_seat(text);
drop function public.assign_counter_seat(uuid, uuid, text, text, text);
drop function public.carry_counter_seats(uuid, uuid);

-- ---------------------------------------------------------------- 11. privileges
revoke execute on function public.counter_pool_code(uuid), public.counter_bind(text, text, text), public.counter_set_operator(text), public.counter_leave(), public.join_training_counter(text, text, text),
  public.list_event_device_sessions(uuid, boolean), public.platform_device_sessions(boolean), public.move_counter_session(uuid, text, text), public.end_event_session(uuid, text),
  public.device_session_preview(uuid), public.counter_operator_history(uuid, uuid) from public, anon;
grant execute on function public.counter_pool_code(uuid), public.counter_bind(text, text, text), public.counter_set_operator(text), public.counter_leave(), public.join_training_counter(text, text, text),
  public.list_event_device_sessions(uuid, boolean), public.platform_device_sessions(boolean), public.move_counter_session(uuid, text, text), public.end_event_session(uuid, text),
  public.device_session_preview(uuid), public.counter_operator_history(uuid, uuid) to authenticated;
-- the counter phone itself, and the staff devices that run a Lyst or the day (the functions check the device's role on every call)
grant execute on function public.counter_bind(text, text, text), public.counter_set_operator(text), public.counter_leave(), public.counter_pool_code(uuid),
  public.list_event_device_sessions(uuid, boolean), public.move_counter_session(uuid, text, text), public.end_event_session(uuid, text) to bos_event_device;

-- ---------------------------------------------------------------- the ledger row (what apply_migration would have recorded)
insert into supabase_migrations.schema_migrations (version, name, statements)
values (to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'pack25_counter_pool', array['-- applied by the owner in the SQL Editor from supabase/manual/hosted_rollout_pack25.sql (= supabase/migrations/20261020000100_pack25_counter_pool.sql)']);
