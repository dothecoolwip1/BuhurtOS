-- Pack 18.1 (3/3): broadcast control state, the stream controller's two functions, and the session roles' EXECUTE allow-list. ADDITIVE.
--
--   * event_broadcast_control holds DESIRED PRESENTATION only (AUTO/MANUAL, which Lyst to take, music mode). It never touches Pack 13 state, and nothing in
--     the tournament reads it. A closed vocabulary: no scene names, URLs, files or commands ever travel through it.
--   * The controller (bos_controller) can execute exactly two functions: controller_state() and broadcast_controller_heartbeat(). The event is taken from
--     its own session, never from an argument, so it cannot read or write another event.
--   * bos_event_device can execute the functions listed at the end and nothing else. Each of them still checks the caller's role for the event.

create table public.event_broadcast_control (
  event_id uuid primary key references public.events (id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'manual')),
  target_kind text check (target_kind is null or target_kind in ('lyst', 'holding', 'break')),
  target_field text check (target_field is null or char_length(target_field) <= 40),
  music_mode text not null default 'auto' check (music_mode in ('auto', 'muted', 'paused')),
  auto_duck boolean not null default true,
  priority_fields text[] not null default '{}' check (cardinality(priority_fields) <= 12),
  rev integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by_label text,
  constraint event_broadcast_control_target check (mode = 'auto' or target_kind is not null),
  constraint event_broadcast_control_lyst check (target_kind is distinct from 'lyst' or target_field is not null)
);
alter table public.event_broadcast_control enable row level security;
revoke all on table public.event_broadcast_control from public, anon, authenticated;

create table public.broadcast_controller_status (
  event_id uuid primary key references public.events (id) on delete cascade,
  reported_at timestamptz not null default now(),
  status jsonb not null default '{}'::jsonb check (octet_length(status::text) <= 4096)
);
alter table public.broadcast_controller_status enable row level security;
revoke all on table public.broadcast_controller_status from public, anon, authenticated;

create function private.broadcast_control_json(p_event uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('mode', c.mode, 'target_kind', c.target_kind, 'target_field', c.target_field, 'music_mode', c.music_mode,
                          'auto_duck', c.auto_duck, 'priority_fields', to_jsonb(c.priority_fields), 'rev', c.rev, 'updated_at', c.updated_at, 'updated_by_label', c.updated_by_label)
                   from public.event_broadcast_control c where c.event_id = p_event),
                  jsonb_build_object('mode', 'auto', 'target_kind', null, 'target_field', null, 'music_mode', 'auto', 'auto_duck', true,
                                     'priority_fields', '[]'::jsonb, 'rev', 0, 'updated_at', null, 'updated_by_label', null))
$$;
revoke execute on function private.broadcast_control_json(uuid) from public, anon, authenticated;

create function public.set_broadcast_control(p_event uuid, p_expected_rev integer, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.event_broadcast_control; k text; v_mode text; v_kind text; v_field text; v_music text; v_duck boolean; v_prio text[];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not coalesce(private.can_broadcast_control(p_event), false) then raise exception 'only an organizer can control the broadcast' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'send an object of changes' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('mode', 'target_kind', 'target_field', 'music_mode', 'auto_duck', 'priority_fields') then raise exception 'unknown setting: %', left(k, 40) using errcode = '22023'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('bos:bcontrol:' || p_event::text, 0));
  insert into public.event_broadcast_control (event_id) values (p_event) on conflict do nothing;
  select * into v from public.event_broadcast_control where event_id = p_event for update;
  if p_expected_rev is distinct from v.rev then return jsonb_build_object('status', 'stale', 'control', private.broadcast_control_json(p_event)); end if;
  v_mode := coalesce(p_patch ->> 'mode', v.mode);
  v_kind := case when p_patch ? 'target_kind' then p_patch ->> 'target_kind' else v.target_kind end;
  v_field := case when p_patch ? 'target_field' then nullif(btrim(p_patch ->> 'target_field'), '') else v.target_field end;
  v_music := coalesce(p_patch ->> 'music_mode', v.music_mode);
  v_duck := case when p_patch ? 'auto_duck' then (p_patch ->> 'auto_duck')::boolean else v.auto_duck end;
  v_prio := case when p_patch ? 'priority_fields' then (select coalesce(array_agg(private.field_key(x)), '{}') from jsonb_array_elements_text(p_patch -> 'priority_fields') x) else v.priority_fields end;
  if v_mode not in ('auto', 'manual') then raise exception 'mode is auto or manual' using errcode = '22023'; end if;
  if v_kind is not null and v_kind not in ('lyst', 'holding', 'break') then raise exception 'unknown target' using errcode = '22023'; end if;
  if v_music not in ('auto', 'muted', 'paused') then raise exception 'unknown music mode' using errcode = '22023'; end if;
  if cardinality(v_prio) > 12 then raise exception 'at most 12 priority fields' using errcode = '22023'; end if;
  if v_mode = 'auto' then v_kind := null; v_field := null; end if;                       -- Return to Auto clears the manual target
  if v_mode = 'manual' and v_kind is null then raise exception 'say what to show (a Lyst, holding or break)' using errcode = '22023'; end if;
  if v_kind = 'lyst' then
    if v_field is null then raise exception 'say which Lyst' using errcode = '22023'; end if;
    v_field := private.field_key(v_field);
  else v_field := null; end if;
  update public.event_broadcast_control set mode = v_mode, target_kind = v_kind, target_field = v_field, music_mode = v_music, auto_duck = v_duck, priority_fields = v_prio,
         rev = rev + 1, updated_at = clock_timestamp(), updated_by_label = private.actor_label() where event_id = p_event;
  perform private.audit(p_event, 'broadcast.control', v_mode, jsonb_build_object('patch', p_patch, 'role', private.actor_role(p_event)));
  return jsonb_build_object('status', 'ok', 'control', private.broadcast_control_json(p_event));
end $$;

-- what the Command Centre shows (control, camera, controller report); not an OBS console
create function public.broadcast_control_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_st public.broadcast_controller_status;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not (coalesce(private.can_command(p_event), false) or coalesce(private.can_broadcast_control(p_event), false)) then
    raise exception 'you cannot see this event''s broadcast state' using errcode = '42501'; end if;
  select * into v_st from public.broadcast_controller_status where event_id = p_event;
  return jsonb_build_object('control', private.broadcast_control_json(p_event), 'camera', private.camera_state_json(p_event),
    'controller', case when v_st.event_id is null then null else jsonb_build_object('reported_at', v_st.reported_at, 'age_seconds', extract(epoch from clock_timestamp() - v_st.reported_at)::integer, 'status', v_st.status) end,
    'controller_exists', exists (select 1 from public.event_credentials c where c.event_id = p_event and c.kind = 'controller' and c.revoked_at is null),
    'can_control', coalesce(private.can_broadcast_control(p_event), false), 'server_now', clock_timestamp());
end $$;

-- the controller's reads and report. The event comes from the controller's own session.
create function public.controller_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d record; v_e public.events;
begin
  select * into d from private.device_ctx() x where x.kind = 'controller' limit 1;
  if not found then raise exception 'this is not a stream controller session' using errcode = '42501'; end if;
  select * into v_e from public.events where id = d.event_id;
  return jsonb_build_object('event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'timezone', v_e.timezone, 'status', v_e.status),
    'control', private.broadcast_control_json(d.event_id), 'camera', private.camera_state_json(d.event_id), 'server_now', clock_timestamp());
end $$;

create function public.broadcast_controller_heartbeat(p_status jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; v_prev jsonb;
begin
  select * into d from private.device_ctx() x where x.kind = 'controller' limit 1;
  if not found then raise exception 'this is not a stream controller session' using errcode = '42501'; end if;
  if p_status is null or jsonb_typeof(p_status) <> 'object' or octet_length(p_status::text) > 4096 then raise exception 'a status report is a small object' using errcode = '22023'; end if;
  select status into v_prev from public.broadcast_controller_status where event_id = d.event_id;
  insert into public.broadcast_controller_status (event_id, reported_at, status) values (d.event_id, clock_timestamp(), p_status)
  on conflict (event_id) do update set reported_at = excluded.reported_at, status = excluded.status;
  update public.event_sessions set last_seen_at = clock_timestamp() where id = d.session_id;
  if v_prev is null or (v_prev ->> 'obs_connected') is distinct from (p_status ->> 'obs_connected') then
    perform private.audit(d.event_id, 'broadcast.controller_status', d.label, jsonb_build_object('obs_connected', p_status ->> 'obs_connected'));
  end if;
  return jsonb_build_object('ok', true, 'control_rev', private.broadcast_control_json(d.event_id) -> 'rev', 'camera_rev', private.camera_state_json(d.event_id) -> 'rev');
end $$;

revoke execute on function public.set_broadcast_control(uuid, integer, jsonb), public.broadcast_control_state(uuid), public.controller_state(), public.broadcast_controller_heartbeat(jsonb) from public, anon;
grant execute on function public.set_broadcast_control(uuid, integer, jsonb), public.broadcast_control_state(uuid) to authenticated;
revoke execute on function public.controller_state(), public.broadcast_controller_heartbeat(jsonb) from authenticated;

-- ---------------------------------------------------------------- the session roles' allow-lists
-- Deny by default: a function that is not named here cannot be called by a device or the controller. (Both roles also inherit `anon`: public reads.)
-- Every function below checks the caller's role FOR THE EVENT inside. This list is mirrored in supabase/tests/device_allowlist.txt, and the gate asserts
-- the two are identical, so a new function can never become reachable by a device without a reviewed change to both.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (array[
             -- identity
             'device_whoami',
             -- counting (own seat only)
             'request_counter_seat', 'counter_state', 'counter_record', 'counter_undo', 'counter_submit', 'end_counter_seat',
             -- Lyst Control and the field (scorekeeper, marshal, temporary organizer)
             'lyst_open', 'lyst_timer_command', 'lyst_end_round', 'lyst_confirm_round', 'lyst_record_discipline', 'lyst_void_discipline', 'lyst_state', 'lyst_finalize',
             'create_lyst_join_code', 'assign_counter_seat', 'carry_counter_seats', 'set_lyst_settings',
             'set_match_queue', 'advance_field_queue', 'move_match_in_queue', 'save_queue_plan', 'clear_manual_queue',
             'submit_match_result', 'record_score_event', 'report_live_score', 'finalize_match',
             -- results (head marshal powers, temporary organizer)
             'list_result_conflicts', 'resolve_result_conflict', 'enter_official_result', 'reopen_match', 'correct_result', 'void_result',
             -- readiness (status words only), schedule clashes, and the head marshal's desk powers (a Temporary Organizer counts as one)
             'match_readiness', 'announcer_readiness', 'fighter_schedule_conflicts',
             'event_readiness', 'inspection_history', 'my_desk_roles', 'set_attendance', 'record_inspection', 'record_weigh_in',
             'set_readiness_override', 'clear_readiness_override',
             -- Command Centre, announcements, staff operations
             'event_command_snapshot', 'send_event_announcement', 'list_event_announcements',
             'grant_event_role_by_email', 'remove_event_role', 'list_event_staff_names',
             -- Camera Off and broadcast control
             'camera_off_activate', 'camera_off_release', 'camera_state', 'broadcast_control_state', 'set_broadcast_control'])
  loop
    execute format('grant execute on function %s to bos_event_device', r.sig);
  end loop;
end $$;
grant execute on function public.controller_state(), public.broadcast_controller_heartbeat(jsonb) to bos_controller;
