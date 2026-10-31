-- Counter phones and Lyst desks poll every 2.5 s. On hosted (pg_stat_statements since 2026-10-10) counter_state averaged 433 ms over 8,108 calls and
-- lyst_state 248 ms over 10,359, and the 30 Oct rehearsal hit 69 statement timeouts inside them: the polls are most of the database's work on a
-- tournament day. Same answers, less work per poll:
--  1. private.field_key is a one-line expression called once per fight of the event by every queue and "last fight" read (about 300 calls per
--     counter poll on a Rumble-sized day). As SQL with a fixed search_path it was planned again on every call; as PL/pgSQL it is a cached
--     expression. It keeps its fixed, empty search_path (pack24_followups_gate requires one on every function).
--  2. private.counter_state_for read the event's Lyst list twice and the counter's current fight twice per poll; it now reads each once.
--  3. The 28 one-statement helpers the polls and their permission checks call (has_event_role, field_fights, lyst_side_name, ...) were SQL-language
--     SECURITY DEFINER functions. PostgreSQL never inlines those and plans their statement again on every call, many times per poll. Each is now
--     the same statement in PL/pgSQL, whose plans are kept for the connection. The statement text is unchanged; `#variable_conflict use_column`
--     keeps SQL's rule that a column wins over a parameter of the same name, and the FOR loop keeps SQL's "first row, or null" result.
--     Bench (32 events, 2,115 fights; 200 polls): counter_state 1.6 s -> 0.75 s, lyst_state 1.0 s -> 0.15 s, every output identical.
-- Nothing is stored or backfilled: the functions are replaced in place, so every open event, Lyst, fight and counter phone gets them on its next poll.

create or replace function private.field_key(p_field text) returns text language plpgsql immutable set search_path = ''
as $$ begin return lower(coalesce(nullif(btrim(p_field), ''), 'Field 1')); end $$;

create or replace function private.counter_state_for(p_sub uuid, p_touch boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sid uuid; v_event uuid; v_label text; v_b public.counter_bindings; v_s public.lyst_counter_seats; v_m public.matches; v_cur public.lyst_rounds; v_t public.lyst_timer;
  v_e public.events; v_input text; v_comp text; v_match uuid; v_key text; v_side text; v_per integer; v_total integer; v_kind text; v_fields jsonb; v_opponent text;
  v_training boolean := false; v_officials jsonb; v_known boolean; v_field_label text;
begin
  select s.id, c.event_id, c.label, c.training into v_sid, v_event, v_label, v_training from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
   where s.id = p_sub and s.ended_at is null and c.revoked_at is null and c.role = 'counter' and private.device_valid_at(c.id, clock_timestamp());
  if v_sid is not null then
    v_kind := 'device';
    if p_touch then update public.event_sessions set last_seen_at = clock_timestamp() where id = (select x.id from public.event_sessions x where x.id = v_sid and (x.last_seen_at is null or x.last_seen_at < clock_timestamp() - interval '30 seconds') for update skip locked); end if;
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
  -- one pass over the event's Lysts: the list for the phone, the counter's own Lyst label and its current fight (each was worked out twice before)
  select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label, 'open', c.match_id is not null,
      'now', case when c.match_id is null then null else jsonb_build_object('a', private.lyst_side_name(c.entry_a), 'b', private.lyst_side_name(c.entry_b)) end) order by f.field_key collate "C"), '[]'::jsonb),
      bool_or(f.field_key = v_key), (array_agg(c.match_id) filter (where f.field_key = v_key))[1], (array_agg(f.label) filter (where f.field_key = v_key))[1]
    into v_fields, v_known, v_match, v_field_label
    from private.event_field_keys(v_event) f left join lateral (select m.id as match_id, m.entry_a, m.entry_b from public.matches m where m.id = private.field_current_match(v_event, f.field_key)) c on true;
  -- a binding to a Lyst that is not in the list (none of its fights left, no clock): ask for it directly, exactly as before
  if v_key is not null and not coalesce(v_known, false) then v_match := private.field_current_match(v_event, v_key); end if;
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
  return private.counter_run_state(p_sub, p_touch, jsonb_build_object(
    'kind', v_kind, 'training', v_training, 'session_id', v_sid, 'device_label', v_label,
    'event', jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'name', v_e.name, 'closed', v_e.closed_at is not null),
    'fields', v_fields,
    'binding', case when v_kind = 'device' then jsonb_build_object('field_key', v_b.field_key, 'side', v_b.side, 'operator', v_b.operator_name) else jsonb_build_object('field_key', v_s.field_key, 'side', v_s.side, 'operator', v_s.display_name) end,
    'field_label', v_field_label,
    'seat', case when v_s.id is null then null else jsonb_build_object('id', v_s.id, 'status', case when v_s.expires_at < now() then 'expired' else v_s.status end, 'side', v_s.side, 'role', v_s.role, 'field_key', v_s.field_key, 'operator', v_s.display_name, 'match_id', v_s.match_id) end,
    'waiting', v_s.id is not null and (v_s.match_id is null or v_s.match_id is distinct from v_match),
    'match_id', case when v_m.id is null then null else v_m.id end, 'competition', v_comp, 'round_label', v_m.round_label, 'final', coalesce(v_m.queue_state = 'final', false),
    'fighter', case when v_m.id is null then null else private.lyst_side_name(case when v_side = 'a' then v_m.entry_a else v_m.entry_b end) end,
    'opponent', v_opponent,
    'counter_input', coalesce(v_input, 'simple'), 'category', (select k.category from public.competitions k where k.id = v_m.competition_id), 'per_side', v_per, 'standing', case when v_input = 'standing' then greatest(0, v_per - coalesce(v_total, 0)) end,
    'round', case when v_cur.match_id is null then null else jsonb_build_object('no', v_cur.round_no, 'status', v_cur.status) end,
    'my_total', coalesce(v_total, 0),
    'officials', v_officials,
    'submitted', case when v_cur.match_id is null then false else exists (select 1 from public.lyst_counter_rounds r where r.seat_id = v_s.id and r.match_id = v_match and r.round_no = v_cur.round_no) end,
    'can_count', v_s.id is not null and v_s.status = 'active' and v_s.expires_at >= now() and v_side is not null and v_m.id is not null and v_m.queue_state <> 'final' and v_cur.status = 'running',
    'timer', case when v_t.event_id is null then null else private.lyst_timer_json(v_t) end,
    'fights', case when v_key is null then null else private.field_fights(v_event, v_key) end,
    'sides', private.event_sides(v_event),
    'server_now', clock_timestamp(), 'outrance', case when v_s.id is not null and v_s.match_id = v_match then private.outrance_phone(v_s.id, v_match) end));
end $function$;

-- 3. Same statements, PL/pgSQL (generated from the live definitions, which match hosted byte for byte).

create or replace function private.can_score(p_event uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in
 select private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal', 'scorekeeper'])
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.can_score_match(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  with e as (select private.event_of_match(p_match) as ev)
  select case
    when e.ev is null then false
    when not coalesce(private.can_score(e.ev), false) then false
    when not private.is_secretary_only(e.ev) then true
    else private.match_on_secretary_board(p_match) end
  from e
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.can_view_match(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select coalesce(private.can_score_match(p_match), false) or coalesce((
    select private.can_score(k.event_id) and m.queue_state = 'final'
       and m.id = (select m2.id from public.matches m2 join public.competitions k2 on k2.id = m2.competition_id
                   where k2.event_id = k.event_id and private.field_key(m2.field) = private.field_key(m.field) and m2.queue_state = 'final'
                   order by m2.finalized_at desc nulls last, m2.version desc, m2.id limit 1)
    from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match), false)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.counter_delivery_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
    'run_id', r.id, 'round', r.round_no, 'run_status', r.status, 'closed_at', r.closed_at,
    'prepared_at', ack.prepared_at, 'started_at', ack.started_at, 'seen_at', ack.seen_at, 'pending', ack.pending,
    'submitted', exists (select 1 from public.lyst_counter_rounds c where c.seat_id = s.id and c.round_no = r.round_no and c.match_id = p_match)) order by s.role, s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s
  left join lateral (select cr.* from private.counter_runs cr where cr.match_id = p_match order by cr.round_no desc, cr.generation desc limit 1) r on true
  left join private.counter_receipts ack on ack.run_id = r.id and ack.seat_id = s.id
  where s.match_id = p_match and s.status = 'active'
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.counter_recovery_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'seat_id', e.seat_id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
    'run_id', r.id, 'round', r.round_no, 'generation', r.generation, 'action', e.action, 'reason', e.reason,
    'received_at', e.received_at, 'decision', e.decision, 'review_reason', e.review_reason) order by e.received_at), '[]'::jsonb)
  from private.counter_recovery e join private.counter_runs r on r.id = e.run_id join public.lyst_counter_seats s on s.id = e.seat_id
  where r.match_id = p_match
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.counter_weights_for(p_seat uuid, p_match uuid, p_round integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select coalesce(jsonb_agg(c.weight order by c.created_at,c.id),'[]'::jsonb) from public.lyst_counts c
  where c.seat_id=p_seat and c.match_id=p_match and c.round_no=p_round and c.undo_of is null
  and not exists(select 1 from public.lyst_counts u where u.undo_of=c.id)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.device_credential_expiry(p_credential uuid) returns timestamp with time zone
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r timestamp with time zone;
begin
  for bos_r in

  select least(coalesce(c.expires_at, 'infinity'::timestamptz), private.device_event_end(c.event_id) + interval '24 hours')
  from public.event_credentials c where c.id = p_credential
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.device_ctx() returns TABLE(session_id uuid, credential_id uuid, event_id uuid, kind text, role text, label text)
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
begin
  return query

  select s.id, c.id, c.event_id, case when c.kind = 'counter_pool' then 'device' else c.kind end, c.role, c.label
  from public.event_sessions s join public.event_credentials c on c.id = s.credential_id
  where s.id = auth.uid() and s.ended_at is null and c.revoked_at is null
    and private.device_valid_at(c.id, clock_timestamp()) and private.event_org_enabled(c.event_id);
end $bos$;

create or replace function private.device_event_end(p_event uuid) returns timestamp with time zone
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r timestamp with time zone;
begin
  for bos_r in

  select ((e.ends_on + 1)::timestamp at time zone e.timezone) from public.events e where e.id = p_event
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.device_has_role(p_event uuid, p_roles text[]) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select exists (select 1 from private.device_ctx() d
                 where d.kind = 'device' and d.event_id = p_event and private.device_effective_roles(d.role) && p_roles)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.device_valid_at(p_credential uuid, p_at timestamp with time zone) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select coalesce((select c.created_at <= p_at and (c.revoked_at is null or c.revoked_at > p_at) and p_at < private.device_credential_expiry(c.id)
                   from public.event_credentials c where c.id = p_credential), false)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.event_field_keys(p_event uuid) returns TABLE(field_key text, label text)
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
begin
  return query

  with raw as (
    select coalesce(nullif(btrim(m.field), ''), 'Field 1') as label from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = p_event and m.queue_state <> 'final'
    union all
    select 'Field ' || g from public.events e, generate_series(1, greatest(1, coalesce(e.field_count, 1))) g where e.id = p_event
    union all
    select t.field_key from public.lyst_timer t where t.event_id = p_event)
  select lower(r.label) as field_key, min(r.label) as label from raw r group by 1 order by 1;
end $bos$;

create or replace function private.event_of_match(p_match uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r uuid;
begin
  for bos_r in

  select c.event_id from public.matches m join public.competitions c on c.id = m.competition_id where m.id = p_match
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.event_org_enabled(p_event uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select coalesce((select o.enabled from public.organizations o where o.id = private.event_org(p_event)), true)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.event_sides(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select jsonb_build_object(
    'a', jsonb_build_object('name', 'Red', 'color', '#B42318') || coalesce((select s.settings -> 'sides' -> 'a' from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb),
    'b', jsonb_build_object('name', 'Blue', 'color', '#2C4A8C') || coalesce((select s.settings -> 'sides' -> 'b' from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb))
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.event_staff_active(p_event uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select coalesce((select coalesce(e.ends_on, e.starts_on) is null or current_date <= coalesce(e.ends_on, e.starts_on) + 7
                   from public.events e where e.id = p_event), false)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.field_current_match(p_event uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r uuid;
begin
  for bos_r in

  select coalesce(
    (select f.match_id from public.lyst_field_current f join public.matches m on m.id = f.match_id
      where f.event_id = p_event and f.field_key = p_key and m.queue_state <> 'final'),
    -- the fight the field's clock is on (a Lyst fight opened before Pack 25, or by any path that skipped lyst_open)
    (select t.match_id from public.lyst_timer t join public.matches m on m.id = t.match_id join public.lyst_matches lm on lm.match_id = m.id
      where t.event_id = p_event and t.field_key = p_key and m.queue_state <> 'final'),
    -- the one Lyst fight that is active on the field
    (select lm.match_id from public.lyst_matches lm join public.matches m on m.id = lm.match_id
      where lm.event_id = p_event and lm.field_key = p_key and m.queue_state = 'active' order by lm.created_at desc limit 1))
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.field_fights(p_event uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  with f as (
    select 'last' as slot, m.* from public.matches m join public.competitions k on k.id = m.competition_id
      where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = 'final' order by m.finalized_at desc nulls last, m.version desc limit 1),
  n as (select 'now' as slot, m.* from public.matches m where m.id = private.field_current_match(p_event, p_key)),
  x as (select 'next' as slot, m.* from public.matches m where m.id = (select q from private.queue_ordered(p_event, p_key, array['on_deck', 'in_the_hole', 'scheduled']) q limit 1)),
  a as (select * from f union all select * from n union all select * from x)
  select jsonb_build_object(
    'last', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label, 'result', a.result,
      'score_a', case when a.detail ->> 'kind' = 'outrance' and a.detail -> 'totals' ? 'a' then round((a.detail -> 'totals' ->> 'a')::numeric / 60, 2) else a.score_a end,
      'score_b', case when a.detail ->> 'kind' = 'outrance' and a.detail -> 'totals' ? 'b' then round((a.detail -> 'totals' ->> 'b')::numeric / 60, 2) else a.score_b end) from a where slot = 'last'),
    'now', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label) from a where slot = 'now'),
    'next', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label, 'state', a.queue_state) from a where slot = 'next'))
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.has_event_role(p_event uuid, p_roles text[]) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select private.is_owner() or (
    private.event_org_enabled(p_event) and (
      (private.event_staff_active(p_event)
       and exists (select 1 from public.event_staff where event_id = p_event and user_id = auth.uid() and role = any (p_roles)))
      or ('organizer' = any (p_roles) and private.is_org_admin_of_event(p_event))
      or private.device_has_role(p_event, p_roles)))
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.is_owner() returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select exists (select 1 from public.platform_roles where user_id = auth.uid() and role = 'owner')
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.is_secretary_only(p_event uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select p_event is not null
     and coalesce(private.has_event_role(p_event, array['scorekeeper']), false)
     and not coalesce(private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal']), false)
     and not coalesce(private.is_event_operator(p_event), false)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.lyst_per_side(p_match uuid) returns integer
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r integer;
begin
  for bos_r in

  select coalesce(
    (select nullif(substring(k.category from '^(\d+)v\d+$'), '')::integer from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match),
    (select nullif(greatest(
        (select count(*) from public.entry_fighters f where f.entry_id = m.entry_a),
        (select count(*) from public.entry_fighters f where f.entry_id = m.entry_b)), 0)::integer
      from public.matches m join public.competitions k on k.id = m.competition_id join public.ref_categories c on c.code = k.category
      where m.id = p_match and c.league = 'buhurt'),
    (select case when c.league = 'buhurt' then 5 else 1 end
      from public.matches m join public.competitions k on k.id = m.competition_id join public.ref_categories c on c.code = k.category where m.id = p_match),
    1)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.lyst_settings_for(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select private.lyst_default_settings() || coalesce((select s.settings from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.lyst_side_name(p_entry uuid) returns text
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r text;
begin
  for bos_r in

  select coalesce(t.name, f.display_name, 'Fighter') from public.entries e left join public.teams t on t.id = e.team_id left join public.fighters f on f.id = e.fighter_id where e.id = p_entry
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.match_runnable(p_match matches) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select p_match.entry_a is not null and p_match.entry_b is not null
     and not exists (select 1 from public.entries e where e.id in (p_match.entry_a, p_match.entry_b) and e.status in ('withdrawn', 'disqualified'))
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.outrance_is(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r boolean;
begin
  for bos_r in

  select coalesce((select scoring = 'outrance' from public.lyst_matches where match_id = p_match), false)
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.outrance_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
declare bos_r jsonb;
begin
  for bos_r in

  select case when not private.outrance_is(p_match) then null else jsonb_build_object(
    'rules', 'Outrance Rules and Regulations V.26.4',
    'timing', private.outrance_timing(p_match),
    'sheets', coalesce((select jsonb_agg(private.outrance_sheet_json(s, private.outrance_protocol(p_match, s.round_no)) order by s.round_no, s.submitted_at, s.id)
                        from public.outrance_sheets s where s.match_id = p_match and s.superseded_at is null), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_no', o.round_no, 'marshals', o.marshals, 'a', o.units_a, 'b', o.units_b, 'short', o.short, 'reason', o.reason, 'confirmed_at', o.confirmed_at) order by o.round_no)
                        from private.outrance_current_rounds(p_match) o), '[]'::jsonb),
    'protocol', coalesce((select jsonb_agg(private.outrance_protocol(p_match, r.round_no) || jsonb_build_object('round_no', r.round_no) order by r.round_no) from public.lyst_rounds r where r.match_id = p_match), '[]'::jsonb),
    'totals', private.outrance_totals(p_match),
    'holds', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'side', case when h.entry_id = m.entry_a then 'a' else 'b' end, 'kind', h.kind, 'created_at', h.created_at, 'from_match', h.match_id, 'during_fight', h.discipline_id is not null) order by h.created_at)
                       from public.matches m join public.outrance_holds h on h.competition_id = m.competition_id and h.entry_id in (m.entry_a, m.entry_b) and h.cleared_at is null where m.id = p_match), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'side', a.side, 'lodged_by', a.lodged_by, 'grounds', a.grounds, 'lodged_at', a.lodged_at, 'decision', a.decision, 'outcome', a.outcome, 'decision_note', a.decision_note) order by a.lodged_at)
                        from public.outrance_appeals a where a.match_id = p_match), '[]'::jsonb)) end
  loop return bos_r; end loop;
  return null;
end $bos$;

create or replace function private.queue_ordered(p_event uuid, p_key text, p_states text[]) returns SETOF uuid
language plpgsql stable security definer set search_path = ''
as $bos$
#variable_conflict use_column
begin
  return query

  select m.id
  from public.matches m join public.competitions k on k.id = m.competition_id
  where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = any (p_states) and m.queue_state in ('scheduled', 'on_deck', 'in_the_hole')
    and private.match_runnable(m)
  order by case m.queue_state when 'on_deck' then 0 when 'in_the_hole' then 1 else 2 end,
           m.queue_order nulls last, m.plan_order nulls last, m.scheduled_at nulls last, k.sort, k.id, private.stage_rank(m.stage), private.round_rank(m.stage, m.round_label),
           coalesce(m.pool, '') collate "C", m.position, m.id;
end $bos$;
