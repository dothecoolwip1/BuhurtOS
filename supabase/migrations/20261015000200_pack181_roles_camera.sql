-- Pack 18.1 (2/3): roles, the Scorekeeper's event-day powers, and Camera Off. ADDITIVE (existing functions are patched in place with anchors).
--
--   * Secretary and Scorekeeper are ONE role: `scorekeeper`. It gains, deliberately: queue adjustment, event announcements, a read-only Command Centre,
--     and Camera Off. It still cannot build a schedule, resolve conflicts, correct results, change settings, or release Camera Off.
--   * `announcer` joins the event staff roles. It matches no other helper: a read-only role, plus Camera Off.
--   * The Temporary Organizer (a device role) is NOT an organizer. It reaches organizer-only actions only through private.is_event_operator, and only
--     where this migration says so (result correction/void, staff operations, announcements, broadcast control).
--   * Camera Off: ACTIVATE = marshal, head marshal, scorekeeper, announcer, organizer, temporary organizer, owner. RELEASE = head marshal, organizer,
--     temporary organizer, owner. Latched: only camera_off_release clears it. Not OBS access: it grants nothing else.

-- 1. patch helper ------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack181 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $$;

-- 2. the announcer role ---------------------------------------------------------------------------------------------------------------------------------
alter table public.event_staff drop constraint event_staff_role_check;
alter table public.event_staff add constraint event_staff_role_check
  check (role in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic', 'check_in', 'inspector', 'announcer'));

-- 3. helpers --------------------------------------------------------------------------------------------------------------------------------------------
create function private.can_adjust_queue(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'scorekeeper']) $$;
create function private.can_announce(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'scorekeeper']) $$;
create function private.can_camera_off_activate(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_event is not null and private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'announcer']) $$;
create function private.can_camera_off_release(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_event is not null and private.has_event_role(p_event, array['organizer', 'head_marshal']) $$;
-- manual broadcast controls (Take, Holding, Break, AUTO/MANUAL, music): the organizer or the Temporary Organizer, NOT the Camera Off roles as such
create function private.can_broadcast_control(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select auth.uid() is not null and p_event is not null and private.is_event_operator(p_event) $$;
revoke execute on function private.can_adjust_queue(uuid), private.can_announce(uuid), private.can_camera_off_activate(uuid),
  private.can_camera_off_release(uuid), private.can_broadcast_control(uuid) from public, anon, authenticated;

create function private.actor_label() returns text language sql stable security definer set search_path = '' as $$
  select coalesce(private.device_label(), nullif(btrim(private.person_name(auth.uid())), ''), 'A staff member') $$;
create function private.actor_role(p_event uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select d.role from private.device_ctx() d limit 1),
    case when private.is_owner() then 'platform_owner'
         when private.is_organizer(p_event) then 'organizer'
         when private.has_event_role(p_event, array['head_marshal']) then 'head_marshal'
         when private.has_event_role(p_event, array['marshal']) then 'marshal'
         when private.has_event_role(p_event, array['scorekeeper']) then 'scorekeeper'
         when private.has_event_role(p_event, array['announcer']) then 'announcer'
         else 'staff' end) $$;
revoke execute on function private.actor_label(), private.actor_role(uuid) from public, anon, authenticated;

-- 4. the Scorekeeper's event-day powers -------------------------------------------------------------------------------------------------------------------
-- Command Centre (read only): organizer, head marshal, scorekeeper (Secretary / Scorekeeper). A Temporary Organizer counts through its roles.
create or replace function private.can_command(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_event is not null and private.has_event_role(p_event, array['organizer', 'head_marshal', 'scorekeeper'])
$$;
select pg_temp.bos_patch('public.event_command_snapshot(uuid)'::regprocedure,
  $a$'viewer', jsonb_build_object('organizer', coalesce(private.is_organizer(p_event), false)),$a$,
  $b$'viewer', jsonb_build_object('organizer', coalesce(private.is_organizer(p_event), false),
                                'announce', coalesce(private.can_announce(p_event), false),
                                'operator', coalesce(private.is_event_operator(p_event), false),
                                'camera_off', coalesce(private.can_camera_off_activate(p_event), false),
                                'camera_release', coalesce(private.can_camera_off_release(p_event), false),
                                'broadcast', coalesce(private.can_broadcast_control(p_event), false)),$b$);
-- queue adjustment (the existing line only: no schedule or bracket building)
select pg_temp.bos_patch('public.move_match_in_queue(uuid,text)'::regprocedure,
  $a$if not private.is_organizer(v_event) then raise exception 'only an organizer can change the running order'$a$,
  $b$if not private.can_adjust_queue(v_event) then raise exception 'only an organizer or the secretary can change the running order'$b$);
select pg_temp.bos_patch('public.clear_manual_queue(uuid,text)'::regprocedure,
  $a$if not private.is_organizer(p_event) then raise exception 'only an organizer can change the running order'$a$,
  $b$if not private.can_adjust_queue(p_event) then raise exception 'only an organizer or the secretary can change the running order'$b$);
select pg_temp.bos_patch('public.save_queue_plan(uuid,uuid[],uuid[])'::regprocedure,
  $a$if not private.is_organizer(p_event) then raise exception 'only an organizer can plan the running order'$a$,
  $b$if not private.can_adjust_queue(p_event) then raise exception 'only an organizer or the secretary can plan the running order'$b$);
-- announcements (Pack 15): the sender is named by label when it is a device (sent_by stays an auth user or null)
alter table public.event_announcements add column sent_by_label text check (sent_by_label is null or char_length(sent_by_label) <= 40);
select pg_temp.bos_patch('public.send_event_announcement(uuid,text,text)'::regprocedure,
  $a$if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can send announcements'$a$,
  $b$if p_event is null or not private.can_announce(p_event) then raise exception 'only an organizer or the secretary of this event can send announcements'$b$);
select pg_temp.bos_patch('public.send_event_announcement(uuid,text,text)'::regprocedure,
  $a$insert into public.event_announcements (event_id, message, audience, sent_by, sent_at) values (p_event, v_msg, p_audience, v_uid, clock_timestamp())$a$,
  $b$insert into public.event_announcements (event_id, message, audience, sent_by, sent_by_label, sent_at)
  values (p_event, v_msg, p_audience, case when private.is_device() then null else v_uid end, private.device_label(), clock_timestamp())$b$);
select pg_temp.bos_patch('public.list_event_announcements(uuid)'::regprocedure,
  $a$not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its announcements'$a$,
  $b$not private.is_event_operator(p_event) then raise exception 'only an organizer of this event can see its announcements'$b$);
select pg_temp.bos_patch('public.list_event_announcements(uuid)'::regprocedure,
  $a$coalesce(private.person_name(a.sent_by), 'An organizer')$a$,
  $b$coalesce(private.person_name(a.sent_by), a.sent_by_label, 'An organizer')$b$);

-- 5. the Temporary Organizer's result workflows and staff operations ---------------------------------------------------------------------------------------
select pg_temp.bos_patch('public.correct_result(uuid,uuid,integer,numeric,text)'::regprocedure,
  $a$if not private.is_organizer(v_event) then raise exception 'only an organizer can correct an official result'$a$,
  $b$if not private.is_event_operator(v_event) then raise exception 'only an organizer can correct an official result'$b$);
select pg_temp.bos_patch('public.void_result(uuid,uuid,text)'::regprocedure,
  $a$if not private.is_organizer(v_event) then raise exception 'only an organizer can void an official result'$a$,
  $b$if not private.is_event_operator(v_event) then raise exception 'only an organizer can void an official result'$b$);
-- overrides: a device has no auth.users row; the person columns stay empty and the audit record names the device
select pg_temp.bos_patch('public.set_readiness_override(uuid,text)'::regprocedure,
  $a$revoked_by = auth.uid() where registration_id = p_reg and revoked_at is null;$a$,
  $b$revoked_by = case when private.is_device() then null else auth.uid() end where registration_id = p_reg and revoked_at is null;$b$);
select pg_temp.bos_patch('public.set_readiness_override(uuid,text)'::regprocedure,
  $a$(registration_id, event_id, reason, created_by) values (p_reg, v_r.event_id, v_reason, auth.uid())$a$,
  $b$(registration_id, event_id, reason, created_by) values (p_reg, v_r.event_id, v_reason, case when private.is_device() then null else auth.uid() end)$b$);
select pg_temp.bos_patch('public.clear_readiness_override(uuid)'::regprocedure,
  $a$revoked_by = auth.uid() where registration_id = p_reg and revoked_at is null;$a$,
  $b$revoked_by = case when private.is_device() then null else auth.uid() end where registration_id = p_reg and revoked_at is null;$b$);
-- the head marshal's desk powers (a Temporary Organizer counts as one): inspections and weigh-ins also name their person; a device has none, the audit names the device
select pg_temp.bos_patch('public.record_inspection(uuid,text,text[],text)'::regprocedure,
  $a$v_note, auth.uid()) returning id into v_id;$a$,
  $b$v_note, case when private.is_device() then null else auth.uid() end) returning id into v_id;$b$);
select pg_temp.bos_patch('public.record_weigh_in(uuid,numeric)'::regprocedure,
  $a$round(p_weight_kg, 1), auth.uid()) returning id into v_id;$a$,
  $b$round(p_weight_kg, 1), case when private.is_device() then null else auth.uid() end) returning id into v_id;$b$);
-- staff operations below organizer: every event role except 'organizer'; the Temporary Organizer sees names, never emails
select pg_temp.bos_patch('public.grant_event_role_by_email(uuid,text,text)'::regprocedure,
  $a$if not private.is_organizer(p_event) then raise exception 'only an organizer can add staff'$a$,
  $b$if not private.is_event_operator(p_event) then raise exception 'only an organizer can add staff'$b$);
select pg_temp.bos_patch('public.grant_event_role_by_email(uuid,text,text)'::regprocedure,
  $a$'medic', 'check_in', 'inspector') then raise exception 'unknown role'$a$,
  $b$'medic', 'check_in', 'inspector', 'announcer') then raise exception 'unknown role'$b$);
select pg_temp.bos_patch('public.grant_event_role_by_email(uuid,text,text)'::regprocedure,
  $a$  select id into v_user from auth.users where lower(email) = lower(p_email);$a$,
  $b$  if p_role = 'organizer' and not private.is_organizer(p_event) then raise exception 'only an organizer can add another organizer' using errcode = '42501'; end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);$b$);
select pg_temp.bos_patch('public.remove_event_role(uuid,uuid,text)'::regprocedure,
  $a$if not private.is_organizer(p_event) then raise exception 'only an organizer can remove staff'$a$,
  $b$if not private.is_event_operator(p_event) or (p_role = 'organizer' and not private.is_organizer(p_event)) then raise exception 'only an organizer can remove staff'$b$);

create function public.list_event_staff_names(p_event uuid) returns table (user_id uuid, name text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_event_operator(p_event) then raise exception 'only an organizer of this event can see the staff' using errcode = '42501'; end if;
  return query select s.user_id, coalesce(nullif(btrim(private.person_name(s.user_id)), ''), 'A staff member'), s.role
    from public.event_staff s where s.event_id = p_event order by s.role, 2;
end $$;
revoke execute on function public.list_event_staff_names(uuid) from public, anon;
grant execute on function public.list_event_staff_names(uuid) to authenticated;

-- 6. Camera Off -------------------------------------------------------------------------------------------------------------------------------------------
create table public.event_camera_state (
  event_id uuid primary key references public.events (id) on delete cascade,
  active boolean not null default false,
  reason text check (reason is null or reason in ('medical', 'privacy', 'camera_problem', 'venue', 'other')),
  activated_at timestamptz, activated_by_label text, activated_by_role text,
  released_at timestamptz, released_by_label text, released_by_role text, release_note text check (release_note is null or char_length(release_note) <= 140),
  rev integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.event_camera_state enable row level security;
revoke all on table public.event_camera_state from public, anon, authenticated;

create table public.event_camera_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  at timestamptz not null default now(),
  action text not null check (action in ('activated', 'released')),
  reason text, by_label text not null, by_role text not null, by_session uuid, note text
);
create index event_camera_log_event on public.event_camera_log (event_id, at desc);
alter table public.event_camera_log enable row level security;
revoke all on table public.event_camera_log from public, anon, authenticated;
create function private.camera_log_append_only() returns trigger language plpgsql as $$ begin raise exception 'the camera log is append-only' using errcode = '42501'; end $$;
create trigger event_camera_log_no_change before update or delete on public.event_camera_log for each row execute function private.camera_log_append_only();
revoke execute on function private.camera_log_append_only() from public, anon, authenticated;

create function private.camera_state_json(p_event uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('active', s.active, 'reason', case when s.active then s.reason end, 'activated_at', s.activated_at,
                          'activated_by_label', s.activated_by_label, 'activated_by_role', s.activated_by_role,
                          'released_at', s.released_at, 'released_by_label', s.released_by_label, 'released_by_role', s.released_by_role, 'rev', s.rev)
                   from public.event_camera_state s where s.event_id = p_event),
                  jsonb_build_object('active', false, 'reason', null, 'rev', 0))
$$;
revoke execute on function private.camera_state_json(uuid) from public, anon, authenticated;

create function public.camera_off_activate(p_event uuid, p_reason text default 'other') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_reason text := coalesce(nullif(btrim(p_reason), ''), 'other'); v_s public.event_camera_state; v_label text; v_role text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not coalesce(private.can_camera_off_activate(p_event), false) then raise exception 'you cannot turn this event''s cameras off' using errcode = '42501'; end if;
  if v_reason not in ('medical', 'privacy', 'camera_problem', 'venue', 'other') then raise exception 'unknown reason' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:camera:' || p_event::text, 0));
  insert into public.event_camera_state (event_id) values (p_event) on conflict do nothing;
  select * into v_s from public.event_camera_state where event_id = p_event for update;
  if v_s.active then return private.camera_state_json(p_event) || jsonb_build_object('status', 'already_off'); end if;
  v_label := private.actor_label(); v_role := private.actor_role(p_event);
  update public.event_camera_state set active = true, reason = v_reason, activated_at = clock_timestamp(), activated_by_label = v_label, activated_by_role = v_role,
         released_at = null, released_by_label = null, released_by_role = null, release_note = null, rev = rev + 1, updated_at = clock_timestamp() where event_id = p_event;
  insert into public.event_camera_log (event_id, action, reason, by_label, by_role, by_session) values (p_event, 'activated', v_reason, v_label, v_role, auth.uid());
  perform private.audit(p_event, 'broadcast.camera_off', v_label, jsonb_build_object('reason', v_reason, 'role', v_role));
  return private.camera_state_json(p_event) || jsonb_build_object('status', 'off');
end $$;

create function public.camera_off_release(p_event uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.event_camera_state; v_label text; v_role text; v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 140);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not coalesce(private.can_camera_off_release(p_event), false) then raise exception 'only the head marshal or an organizer can turn the cameras back on' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:camera:' || p_event::text, 0));
  select * into v_s from public.event_camera_state where event_id = p_event for update;
  if not found or not v_s.active then return private.camera_state_json(p_event) || jsonb_build_object('status', 'already_on'); end if;
  v_label := private.actor_label(); v_role := private.actor_role(p_event);
  update public.event_camera_state set active = false, released_at = clock_timestamp(), released_by_label = v_label, released_by_role = v_role, release_note = v_note,
         rev = rev + 1, updated_at = clock_timestamp() where event_id = p_event;
  insert into public.event_camera_log (event_id, action, reason, by_label, by_role, by_session, note) values (p_event, 'released', v_s.reason, v_label, v_role, auth.uid(), v_note);
  perform private.audit(p_event, 'broadcast.camera_released', v_label, jsonb_build_object('role', v_role));
  return private.camera_state_json(p_event) || jsonb_build_object('status', 'on');
end $$;

create function public.camera_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not (coalesce(private.can_camera_off_activate(p_event), false) or coalesce(private.can_command(p_event), false) or coalesce(private.can_broadcast_control(p_event), false)) then
    raise exception 'you cannot see this event''s camera state' using errcode = '42501'; end if;
  return private.camera_state_json(p_event) || jsonb_build_object('can_activate', coalesce(private.can_camera_off_activate(p_event), false), 'can_release', coalesce(private.can_camera_off_release(p_event), false));
end $$;

-- 7. the announcer's one extra read: ready / not ready per side, no reasons ---------------------------------------------------------------------------
create function public.announcer_readiness(p_event uuid) returns table (match_id uuid, side text, ready boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'announcer']) then
    raise exception 'only this event''s staff can see readiness' using errcode = '42501'; end if;
  return query
  with rr as (select * from private.readiness_rows(p_event, false)),
  live as (
    select m.id, m.entry_a, m.entry_b
    from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and m.queue_state <> 'final' and m.result is null and m.entry_a is not null and m.entry_b is not null
    order by case m.queue_state when 'active' then 0 when 'on_deck' then 1 when 'in_the_hole' then 2 else 3 end, m.queue_order nulls last, m.scheduled_at nulls last, m.id
    limit 40),
  sides as (select l.id as mid, 'a'::text as sd, l.entry_a as entry from live l union all select l.id, 'b', l.entry_b from live l),
  people as (
    select s.mid, s.sd, en.fighter_id from sides s join public.entries en on en.id = s.entry where en.fighter_id is not null
    union
    select s.mid, s.sd, ef.fighter_id from sides s join public.entry_fighters ef on ef.entry_id = s.entry)
  select s.mid, s.sd, coalesce(bool_and(coalesce(x.ready, true)), true)
  from sides s
  left join people p on p.mid = s.mid and p.sd = s.sd
  left join lateral (select r.ready from rr r where r.fighter_id = p.fighter_id and r.status = 'accepted' limit 1) x on true
  group by s.mid, s.sd;
end $$;

-- 8. grants (ordinary roles; the session roles get theirs in migration 3) -------------------------------------------------------------------------------
revoke execute on function public.camera_off_activate(uuid, text), public.camera_off_release(uuid, text), public.camera_state(uuid), public.announcer_readiness(uuid) from public, anon;
grant execute on function public.camera_off_activate(uuid, text), public.camera_off_release(uuid, text), public.camera_state(uuid), public.announcer_readiness(uuid) to authenticated;
