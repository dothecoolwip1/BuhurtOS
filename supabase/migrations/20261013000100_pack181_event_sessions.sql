-- Pack 18.1 (1/3): temporary event devices and the stream controller as EVENT SESSIONS, not people. ADDITIVE.
--
--   * event_credentials: what an organizer creates ("Counter Phone 3"). Only a keyed verifier (HMAC) of the 12-character code is stored; the plaintext is shown once.
--   * event_sessions: what a device holds after entering the code. The session id is the JWT `sub`. It is NOT an auth.users row: no profile, no fighter, no team.
--   * Two database roles carry the tokens: bos_event_device and bos_controller. Neither is a member of `authenticated`; both inherit `anon` (public reads) and
--     receive EXECUTE on an explicit allow-list only (migration 3). A function that is not granted is not callable by them: deny by default.
--   * private.has_event_role gains ONE branch for device sessions (event-scoped, revocation/expiry looked up in tables on every call). Devices never match
--     'organizer' or 'medic'. private.audit records which device acted.
--   * Expiry (server side, exact): the event's final `ends_on` day, in the event's time zone, finishes; access ends 24 h after that (exact hours).
-- Hosted prerequisites (NOT done by this migration): the project must trust tokens signed with an imported signing key, and the role grants below must be
-- allowed. See docs/runbooks/PACK181_HOSTED_ROLLOUT.md.

-- 0. a one-shot patch helper (anchor must exist, so a changed function can never be patched blindly) --------------------------------------------
create function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack181 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $$;

-- 1. roles ----------------------------------------------------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bos_event_device') then create role bos_event_device nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'bos_controller') then create role bos_controller nologin; end if;
end $$;
grant anon to bos_event_device;
grant anon to bos_controller;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant bos_event_device to authenticator;
    grant bos_controller to authenticator;
  end if;
end $$;

-- 2. tables (RLS on, no client grants: only the functions below touch them) -----------------------------------------------------------------------
create table public.event_credentials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('device', 'controller')),
  label text not null check (char_length(label) between 1 and 40),
  role text not null,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  expires_at timestamptz,                                    -- optional EARLIER limit; never later than event end + 24 h
  created_by uuid,
  created_at timestamptz not null default now(),
  first_used_at timestamptz,
  last_signin_at timestamptz,
  elsewhere_at timestamptz,                                  -- a new sign-in ended a session that was still open (a copied code looks like this)
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 140),
  replaced_by uuid references public.event_credentials (id),
  constraint event_credentials_kind_role check (
    (kind = 'device' and role in ('counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer'))
    or (kind = 'controller' and role = 'broadcast_controller'))
);
create unique index event_credentials_code_hash on public.event_credentials (code_hash);
create unique index event_credentials_label_open on public.event_credentials (event_id, lower(label)) where revoked_at is null;
create index event_credentials_event on public.event_credentials (event_id);
alter table public.event_credentials enable row level security;
revoke all on table public.event_credentials from public, anon, authenticated;

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),             -- the JWT `sub`; never an auth.users id
  credential_id uuid not null references public.event_credentials (id) on delete cascade,
  secret_hash bytea not null unique check (octet_length(secret_hash) = 32),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  ended_at timestamptz,
  ended_reason text
);
create unique index event_sessions_one_open on public.event_sessions (credential_id) where ended_at is null;
create index event_sessions_credential on public.event_sessions (credential_id);
alter table public.event_sessions enable row level security;
revoke all on table public.event_sessions from public, anon, authenticated;

create table public.device_code_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ip_hash text,
  outcome text not null
);
create index device_code_attempts_at on public.device_code_attempts (at);
create index device_code_attempts_ip on public.device_code_attempts (ip_hash, at);
alter table public.device_code_attempts enable row level security;
revoke all on table public.device_code_attempts from public, anon, authenticated;

-- 3. expiry and the session context ---------------------------------------------------------------------------------------------------------------
-- End of the event = the end of its last local day (the midnight that starts ends_on + 1, in the event's time zone). Access ends 24 exact hours later.
create function private.device_event_end(p_event uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((e.ends_on + 1)::timestamp at time zone e.timezone) from public.events e where e.id = p_event
$$;
revoke execute on function private.device_event_end(uuid) from public, anon, authenticated;

create function private.device_credential_expiry(p_credential uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(coalesce(c.expires_at, 'infinity'::timestamptz), private.device_event_end(c.event_id) + interval '24 hours')
  from public.event_credentials c where c.id = p_credential
$$;
revoke execute on function private.device_credential_expiry(uuid) from public, anon, authenticated;

-- valid at an instant: created, not revoked (by then), before expiry (the expiry instant itself is refused)
create function private.device_valid_at(p_credential uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.created_at <= p_at and (c.revoked_at is null or c.revoked_at > p_at) and p_at < private.device_credential_expiry(c.id)
                   from public.event_credentials c where c.id = p_credential), false)
$$;
revoke execute on function private.device_valid_at(uuid, timestamptz) from public, anon, authenticated;

-- the caller's live session, if it is one: open, credential not revoked, not expired, event's organization enabled
create function private.device_ctx() returns table (session_id uuid, credential_id uuid, event_id uuid, kind text, role text, label text)
language sql stable security definer set search_path = '' as $$
  select s.id, c.id, c.event_id, c.kind, c.role, c.label
  from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
  where s.id = auth.uid() and s.ended_at is null and c.revoked_at is null
    and private.device_valid_at(c.id, clock_timestamp()) and private.event_org_enabled(c.event_id)
$$;
revoke execute on function private.device_ctx() from public, anon, authenticated;

create function private.is_device() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.device_ctx() d where d.kind = 'device') $$;
revoke execute on function private.is_device() from public, anon, authenticated;

create function private.device_label() returns text language sql stable security definer set search_path = '' as $$
  select d.label from private.device_ctx() d limit 1 $$;
revoke execute on function private.device_label() from public, anon, authenticated;

-- what a device role counts as in the existing staff checks. Never 'organizer', never 'medic', never check_in / inspector.
create function private.device_effective_roles(p_role text) returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'scorekeeper' then array['scorekeeper']
    when 'marshal' then array['marshal']
    when 'announcer' then array['announcer']
    when 'temporary_organizer' then array['head_marshal', 'marshal', 'scorekeeper']
    else array[]::text[] end
$$;
revoke execute on function private.device_effective_roles(text) from public, anon, authenticated;

create function private.device_has_role(p_event uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.device_ctx() d
                 where d.kind = 'device' and d.event_id = p_event and private.device_effective_roles(d.role) && p_roles)
$$;
revoke execute on function private.device_has_role(uuid, text[]) from public, anon, authenticated;

-- 4. the one branch in the permission choke point ----------------------------------------------------------------------------------------------
create or replace function private.has_event_role(p_event uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner() or (
    private.event_org_enabled(p_event) and (
      (private.event_staff_active(p_event)
       and exists (select 1 from public.event_staff where event_id = p_event and user_id = auth.uid() and role = any (p_roles)))
      or ('organizer' = any (p_roles) and private.is_org_admin_of_event(p_event))
      or private.device_has_role(p_event, p_roles)))
$$;

-- event authority that is NOT platform/organization authority: the organizer (incl. org admins and the owner) or the Temporary Organizer of THIS event
create function private.is_event_operator(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_organizer(p_event)
      or (private.event_org_enabled(p_event)
          and exists (select 1 from private.device_ctx() d where d.kind = 'device' and d.role = 'temporary_organizer' and d.event_id = p_event))
$$;
revoke execute on function private.is_event_operator(uuid) from public, anon, authenticated;
grant execute on function private.is_event_operator(uuid) to anon, authenticated;

-- 5. audit: a device's actions carry who it was (never the code) --------------------------------------------------------------------------------------
create or replace function private.audit(p_event uuid, p_action text, p_subject text, p_details jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, event_id, action, subject, details)
  values (auth.uid(), p_event, p_action, p_subject,
          coalesce(p_details, '{}'::jsonb)
          || coalesce((select jsonb_build_object('device', jsonb_build_object('credential_id', d.credential_id, 'session_id', d.session_id, 'label', d.label, 'role', d.role, 'kind', d.kind))
                       from private.device_ctx() d limit 1), '{}'::jsonb))
$$;

-- the same record for a caller that is not (yet) the session itself: the Edge Function opens and closes sessions as the service role
create function private.audit_as(p_actor uuid, p_event uuid, p_action text, p_subject text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, event_id, action, subject, details) values (p_actor, p_event, p_action, p_subject, coalesce(p_details, '{}'::jsonb))
$$;
revoke execute on function private.audit_as(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- 6. places that wrote the caller's id into a column tied to auth.users ------------------------------------------------------------------------------
-- A counter seat is keyed by whoever holds it. A device session is not an auth.users row, so that foreign key goes; the unique "one open seat" index
-- and the own-rows rule are unchanged, and a seat is short-lived (8 h) and ended explicitly, so nothing depends on the cascade.
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.lyst_counter_seats'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass loop
    execute format('alter table public.lyst_counter_seats drop constraint %I', r.conname);
  end loop;
end $$;
-- a device may only join its OWN event's counting, and only as a counter; its seat carries the device's label as the display name
select pg_temp.bos_patch('public.request_counter_seat(text)'::regprocedure,
  $a$  select * into v_s from public.lyst_counter_seats where user_id = v_uid and event_id = v_c.event_id$a$,
  $b$  if exists (select 1 from private.device_ctx() d where d.event_id <> v_c.event_id or d.role <> 'counter') then
    insert into public.lyst_join_attempts (user_id) values (v_uid);
    return jsonb_build_object('status', 'invalid', 'message', 'that join code is not valid or has expired: ask for a new one at the lyst tablet');
  end if;
  select * into v_s from public.lyst_counter_seats where user_id = v_uid and event_id = v_c.event_id$b$);
select pg_temp.bos_patch('public.request_counter_seat(text)'::regprocedure,
  $a$coalesce(nullif(btrim(private.person_name(v_uid)), ''), 'Counter')$a$,
  $b$coalesce(private.device_label(), nullif(btrim(private.person_name(v_uid)), ''), 'Counter')$b$);

-- 7. credentials: created and managed by the event's PERMANENT organizer only -----------------------------------------------------------------------
create function public.create_event_credential(p_event uuid, p_kind text, p_label text, p_role text, p_code_hash bytea, p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_label text := btrim(coalesce(p_label, '')); v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can create device codes' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('device', 'controller') then raise exception 'unknown credential kind' using errcode = '22023'; end if;
  if p_kind = 'device' and (p_role is null or p_role not in ('counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer')) then raise exception 'unknown device role' using errcode = '22023'; end if;
  if p_kind = 'controller' and p_role is distinct from 'broadcast_controller' then raise exception 'unknown controller role' using errcode = '22023'; end if;
  if char_length(v_label) < 1 or char_length(v_label) > 40 then raise exception 'a device name is 1 to 40 characters' using errcode = '22023'; end if;
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then raise exception 'bad code verifier' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then raise exception 'the expiry must be in the future' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:cred:' || p_event::text, 0));
  if p_kind = 'device' and (select count(*) from public.event_credentials where event_id = p_event and kind = 'device' and revoked_at is null) >= 40 then
    raise exception 'an event can have 40 device codes at a time' using errcode = '22023'; end if;
  if p_kind = 'controller' and exists (select 1 from public.event_credentials where event_id = p_event and kind = 'controller' and revoked_at is null) then
    raise exception 'this event already has a stream controller code: replace or revoke it' using errcode = '22023'; end if;
  if exists (select 1 from public.event_credentials where event_id = p_event and lower(label) = lower(v_label) and revoked_at is null) then
    raise exception 'a device with that name already exists for this event' using errcode = '23505'; end if;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, expires_at, created_by)
  values (p_event, p_kind, v_label, p_role, p_code_hash, p_expires_at, auth.uid()) returning id into v_id;
  perform private.audit(p_event, case when p_kind = 'controller' then 'controller.created' else 'device.created' end, v_label, jsonb_build_object('credential_id', v_id, 'role', p_role));
  return jsonb_build_object('id', v_id, 'kind', p_kind, 'label', v_label, 'role', p_role, 'expires_at', private.device_credential_expiry(v_id));
end $$;

create function public.revoke_event_credential(p_credential uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.event_credentials;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_c from public.event_credentials where id = p_credential for update;
  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only an organizer of this event can revoke a device' using errcode = '42501'; end if;
  if v_c.revoked_at is not null then return jsonb_build_object('status', 'already_revoked'); end if;
  update public.event_credentials set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoked_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 140) where id = p_credential;
  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'revoked' where credential_id = p_credential and ended_at is null;
  perform private.audit(v_c.event_id, case when v_c.kind = 'controller' then 'controller.revoked' else 'device.revoked' end, v_c.label, jsonb_build_object('credential_id', p_credential));
  return jsonb_build_object('status', 'revoked');
end $$;

-- a new code for the same device: the old code and any session on it end immediately; the new plaintext is shown once by the caller
create function public.replace_event_credential(p_credential uuid, p_code_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.event_credentials; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_code_hash is null or octet_length(p_code_hash) <> 32 then raise exception 'bad code verifier' using errcode = '22023'; end if;
  select * into v_c from public.event_credentials where id = p_credential for update;
  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only an organizer of this event can replace a device code' using errcode = '42501'; end if;
  if v_c.revoked_at is not null then raise exception 'that device code was already revoked; create a new one' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:cred:' || v_c.event_id::text, 0));
  update public.event_credentials set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoked_reason = 'replaced' where id = p_credential;
  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'replaced' where credential_id = p_credential and ended_at is null;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, expires_at, created_by)
  values (v_c.event_id, v_c.kind, v_c.label, v_c.role, p_code_hash, v_c.expires_at, auth.uid()) returning id into v_id;
  update public.event_credentials set replaced_by = v_id where id = p_credential;
  perform private.audit(v_c.event_id, 'device.replaced', v_c.label, jsonb_build_object('old_credential_id', p_credential, 'credential_id', v_id));
  return jsonb_build_object('id', v_id, 'kind', v_c.kind, 'label', v_c.label, 'role', v_c.role, 'expires_at', private.device_credential_expiry(v_id));
end $$;

create function public.revoke_all_event_devices(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can sign out its devices' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:cred:' || p_event::text, 0));
  update public.event_credentials set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoked_reason = 'all devices signed out'
   where event_id = p_event and kind = 'device' and revoked_at is null;
  get diagnostics v_n = row_count;
  update public.event_sessions s set ended_at = clock_timestamp(), ended_reason = 'revoked'
   from public.event_credentials c where c.id = s.credential_id and c.event_id = p_event and c.kind = 'device' and s.ended_at is null;
  perform private.audit(p_event, 'device.revoked_all', null, jsonb_build_object('devices', v_n));
  return jsonb_build_object('revoked', v_n);
end $$;

create function public.list_event_credentials(p_event uuid)
returns table (id uuid, kind text, label text, role text, status text, used boolean, expires_at timestamptz, created_at timestamptz,
               last_signin_at timestamptz, last_seen_at timestamptz, signed_in_elsewhere_at timestamptz, revoked_at timestamptz, replaced boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its device codes' using errcode = '42501'; end if;
  return query
    select c.id, c.kind, c.label, c.role,
           case when c.revoked_at is not null then 'revoked' when clock_timestamp() >= private.device_credential_expiry(c.id) then 'expired' else 'active' end,
           c.first_used_at is not null, private.device_credential_expiry(c.id), c.created_at, c.last_signin_at,
           (select max(s.last_seen_at) from public.event_sessions s where s.credential_id = c.id), c.elsewhere_at, c.revoked_at, c.replaced_by is not null
    from public.event_credentials c where c.event_id = p_event
    order by (c.revoked_at is not null), c.kind desc, c.role, lower(c.label);
end $$;

-- 8. sessions: only the Edge Function (service role) opens, refreshes and closes them ---------------------------------------------------------------------
create function public.device_open_session(p_code_hash bytea, p_secret_hash bytea, p_ip_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.event_credentials; v_sid uuid; v_open integer; v_e public.events;
begin
  if p_code_hash is null or p_secret_hash is null then return jsonb_build_object('ok', false); end if;
  -- throttle: 10 failures / 10 min per address, 100 failures / 10 min overall. A lockout only blocks NEW sign-ins.
  delete from public.device_code_attempts where at < clock_timestamp() - interval '1 day';
  if (select count(*) from public.device_code_attempts where outcome = 'fail' and at > clock_timestamp() - interval '10 minutes' and ip_hash is not distinct from p_ip_hash) >= 10
     or (select count(*) from public.device_code_attempts where outcome = 'fail' and at > clock_timestamp() - interval '10 minutes') >= 100 then
    return jsonb_build_object('ok', false);
  end if;
  select c.* into v_c from public.event_credentials c where c.code_hash = p_code_hash for update;
  if not found or v_c.revoked_at is not null or not private.device_valid_at(v_c.id, clock_timestamp()) or not private.event_org_enabled(v_c.event_id) then
    insert into public.device_code_attempts (ip_hash, outcome) values (p_ip_hash, 'fail');
    return jsonb_build_object('ok', false);
  end if;
  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'signed_in_again' where credential_id = v_c.id and ended_at is null;
  get diagnostics v_open = row_count;
  insert into public.event_sessions (credential_id, secret_hash, last_seen_at) values (v_c.id, p_secret_hash, clock_timestamp()) returning id into v_sid;
  update public.event_credentials set first_used_at = coalesce(first_used_at, clock_timestamp()), last_signin_at = clock_timestamp(),
         elsewhere_at = case when v_open > 0 then clock_timestamp() else elsewhere_at end where id = v_c.id;
  insert into public.device_code_attempts (ip_hash, outcome) values (p_ip_hash, 'ok');
  select * into v_e from public.events where id = v_c.event_id;
  -- audited as the device itself (the session exists now, so private.audit can name it); the code is never in the record
  perform private.audit_as(v_sid, v_c.event_id, case when v_c.kind = 'controller' then 'controller.signed_in' else 'device.signed_in' end, v_c.label,
    jsonb_build_object('credential_id', v_c.id, 'replaced_open_session', v_open > 0, 'device', jsonb_build_object('credential_id', v_c.id, 'session_id', v_sid, 'label', v_c.label, 'role', v_c.role, 'kind', v_c.kind)));
  return jsonb_build_object('ok', true, 'session_id', v_sid, 'credential_id', v_c.id, 'kind', v_c.kind, 'role', v_c.role, 'label', v_c.label,
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'timezone', v_e.timezone), 'expires_at', private.device_credential_expiry(v_c.id));
end $$;

create function public.device_refresh_session(p_secret_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.event_sessions; v_c public.event_credentials; v_e public.events;
begin
  select s.* into v_s from public.event_sessions s where s.secret_hash = p_secret_hash and s.ended_at is null for update;
  if not found then return jsonb_build_object('ok', false); end if;
  select * into v_c from public.event_credentials where id = v_s.credential_id;
  if v_c.revoked_at is not null or not private.device_valid_at(v_c.id, clock_timestamp()) or not private.event_org_enabled(v_c.event_id) then
    update public.event_sessions set ended_at = clock_timestamp(), ended_reason = case when v_c.revoked_at is not null then 'revoked' else 'expired' end where id = v_s.id;
    return jsonb_build_object('ok', false);
  end if;
  update public.event_sessions set last_seen_at = clock_timestamp() where id = v_s.id;
  select * into v_e from public.events where id = v_c.event_id;
  return jsonb_build_object('ok', true, 'session_id', v_s.id, 'credential_id', v_c.id, 'kind', v_c.kind, 'role', v_c.role, 'label', v_c.label,
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'timezone', v_e.timezone), 'expires_at', private.device_credential_expiry(v_c.id));
end $$;

create function public.device_close_session(p_secret_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.event_sessions; v_c public.event_credentials;
begin
  select s.* into v_s from public.event_sessions s where s.secret_hash = p_secret_hash and s.ended_at is null for update;
  if not found then return jsonb_build_object('ok', true); end if;
  update public.event_sessions set ended_at = clock_timestamp(), ended_reason = 'signed_out' where id = v_s.id;
  select * into v_c from public.event_credentials where id = v_s.credential_id;
  perform private.audit_as(v_s.id, v_c.event_id, case when v_c.kind = 'controller' then 'controller.signed_out' else 'device.signed_out' end, v_c.label,
    jsonb_build_object('credential_id', v_c.id, 'device', jsonb_build_object('credential_id', v_c.id, 'session_id', v_s.id, 'label', v_c.label, 'role', v_c.role, 'kind', v_c.kind)));
  return jsonb_build_object('ok', true);
end $$;

-- 9. what a device (or the controller) can ask about itself ------------------------------------------------------------------------------------------------
create function public.device_whoami() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; v_e public.events;
begin
  select * into d from private.device_ctx() limit 1;
  if not found then raise exception 'this device session has ended' using errcode = '42501'; end if;
  update public.event_sessions set last_seen_at = clock_timestamp() where id = d.session_id and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds');
  select * into v_e from public.events where id = d.event_id;
  return jsonb_build_object('session_id', d.session_id, 'credential_id', d.credential_id, 'kind', d.kind, 'role', d.role, 'label', d.label,
    'effective_roles', to_jsonb(private.device_effective_roles(d.role)),
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'timezone', v_e.timezone, 'ends_on', v_e.ends_on),
    'expires_at', private.device_credential_expiry(d.credential_id), 'server_now', clock_timestamp());
end $$;

-- 10. grants. Everything is revoked from the ordinary roles first; devices get an allow-list in migration 3. ----------------------------------------------
revoke execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz), public.revoke_event_credential(uuid, text),
  public.replace_event_credential(uuid, bytea), public.revoke_all_event_devices(uuid), public.list_event_credentials(uuid),
  public.device_open_session(bytea, bytea, text), public.device_refresh_session(bytea), public.device_close_session(bytea), public.device_whoami()
  from public, anon;
grant execute on function public.create_event_credential(uuid, text, text, text, bytea, timestamptz), public.revoke_event_credential(uuid, text),
  public.replace_event_credential(uuid, bytea), public.revoke_all_event_devices(uuid), public.list_event_credentials(uuid) to authenticated;
revoke execute on function public.device_open_session(bytea, bytea, text), public.device_refresh_session(bytea), public.device_close_session(bytea) from authenticated;
grant execute on function public.device_open_session(bytea, bytea, text), public.device_refresh_session(bytea), public.device_close_session(bytea) to service_role;
revoke execute on function public.device_whoami() from authenticated;   -- only sessions ask this (granted to the session roles in migration 3)
