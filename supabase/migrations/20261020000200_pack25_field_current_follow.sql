-- Pack 25.1: a field's current fight is found from the marshal's clock too; counters see last / now / next.
-- Found on the hosted event on 2026-10-07, the first day of Pack 25: a fight opened on a Lyst BEFORE the Pack 25 migration (or by any path that never
-- calls lyst_open) has its lyst_matches row and a running timer, but no lyst_field_current row. A counter phone bound to that field therefore waited
-- for ever ("Waiting for the next fight on this Lyst"), with the round running next to it.
--   1. private.field_current_match falls back to the fight the field's timer is on, then to the one active Lyst fight on the field.
--   2. A trigger on lyst_timer: when the clock is set or started on a (non-final) Lyst fight, that fight becomes the field's current one and the
--      bound phones are seated on it, exactly as lyst_open does. The marshal's clock is the strongest signal that a fight is on.
--   3. Backfill, once: every field whose timer or open Lyst fight points at a non-final fight gets its row now, and its bound phones their seats.
--   4. counter_state adds 'fights' (last, now, next on the phone's field) so a counter sees what just happened and what comes next.
-- Additive: no table changes, no drops; the same security (security definer, empty search_path, private helpers not callable by clients).

-- ---------------------------------------------------------------- 1. the field's current fight, with fallbacks
create or replace function private.field_current_match(p_event uuid, p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select f.match_id from public.lyst_field_current f join public.matches m on m.id = f.match_id
      where f.event_id = p_event and f.field_key = p_key and m.queue_state <> 'final'),
    -- the fight the field's clock is on (a Lyst fight opened before Pack 25, or by any path that skipped lyst_open)
    (select t.match_id from public.lyst_timer t join public.matches m on m.id = t.match_id join public.lyst_matches lm on lm.match_id = m.id
      where t.event_id = p_event and t.field_key = p_key and m.queue_state <> 'final'),
    -- the one Lyst fight that is active on the field
    (select lm.match_id from public.lyst_matches lm join public.matches m on m.id = lm.match_id
      where lm.event_id = p_event and lm.field_key = p_key and m.queue_state = 'active' order by lm.created_at desc limit 1))
$$;

-- ---------------------------------------------------------------- 2. the marshal's clock makes the fight current
create or replace function private.lyst_timer_field_current() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prev uuid;
begin
  if new.match_id is null then return null; end if;
  if not exists (select 1 from public.matches m join public.lyst_matches lm on lm.match_id = m.id where m.id = new.match_id and m.queue_state <> 'final') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-field:' || new.event_id::text || ':' || new.field_key, 0));
  select match_id into v_prev from public.lyst_field_current where event_id = new.event_id and field_key = new.field_key;
  if v_prev is distinct from new.match_id then
    insert into public.lyst_field_current (event_id, field_key, match_id, opened_at) values (new.event_id, new.field_key, new.match_id, clock_timestamp())
    on conflict (event_id, field_key) do update set match_id = excluded.match_id, opened_at = excluded.opened_at;
    perform private.audit(new.event_id, 'lyst.field_current', new.match_id::text, jsonb_build_object('field', new.field_key, 'previous', v_prev, 'source', 'timer'));
    perform private.counter_rebind_field(new.event_id, new.field_key, new.match_id);
  end if;
  return null;
end $$;
revoke execute on function private.lyst_timer_field_current() from public, anon, authenticated;
create trigger lyst_timer_field_current after insert or update of match_id, status on public.lyst_timer
  for each row when (new.match_id is not null) execute function private.lyst_timer_field_current();

-- ---------------------------------------------------------------- 3. backfill: fields already fighting get their current fight now
do $$
declare r record; v_n integer;
begin
  for r in
    select t.event_id, t.field_key, t.match_id from public.lyst_timer t join public.matches m on m.id = t.match_id join public.lyst_matches lm on lm.match_id = m.id
    where m.queue_state <> 'final' and not exists (select 1 from public.lyst_field_current f where f.event_id = t.event_id and f.field_key = t.field_key)
    union
    select lm.event_id, lm.field_key, lm.match_id from public.lyst_matches lm join public.matches m on m.id = lm.match_id
    where m.queue_state = 'active' and not exists (select 1 from public.lyst_field_current f where f.event_id = lm.event_id and f.field_key = lm.field_key)
      and not exists (select 1 from public.lyst_timer t where t.event_id = lm.event_id and t.field_key = lm.field_key and t.match_id is not null)
  loop
    insert into public.lyst_field_current (event_id, field_key, match_id, opened_at) values (r.event_id, r.field_key, r.match_id, clock_timestamp()) on conflict (event_id, field_key) do nothing;
    perform private.audit(r.event_id, 'lyst.field_current', r.match_id::text, jsonb_build_object('field', r.field_key, 'previous', null, 'source', 'backfill 20261020000200'));
    v_n := private.counter_rebind_field(r.event_id, r.field_key, r.match_id);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. last / now / next on a field, for the counter phone
-- Names only (what the public Live view shows anyway): never a counter, never an account id.
create or replace function private.field_fights(p_event uuid, p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with f as (
    select 'last' as slot, m.* from public.matches m join public.competitions k on k.id = m.competition_id
      where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = 'final' order by m.finalized_at desc nulls last, m.version desc limit 1),
  n as (select 'now' as slot, m.* from public.matches m where m.id = private.field_current_match(p_event, p_key)),
  x as (select 'next' as slot, m.* from public.matches m where m.id = (select q from private.queue_ordered(p_event, p_key, array['on_deck', 'in_the_hole', 'scheduled']) q limit 1)),
  a as (select * from f union all select * from n union all select * from x)
  select jsonb_build_object(
    'last', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label, 'result', a.result, 'score_a', a.score_a, 'score_b', a.score_b) from a where slot = 'last'),
    'now', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label) from a where slot = 'now'),
    'next', (select jsonb_build_object('match_id', a.id, 'a', private.lyst_side_name(a.entry_a), 'b', private.lyst_side_name(a.entry_b), 'competition', (select name from public.competitions where id = a.competition_id), 'round_label', a.round_label, 'state', a.queue_state) from a where slot = 'next'))
$$;
revoke execute on function private.field_fights(uuid, text) from public, anon, authenticated;

create or replace function private.counter_state_for(p_sub uuid, p_touch boolean) returns jsonb
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
    'fights', case when v_key is null then null else private.field_fights(v_event, v_key) end,
    'server_now', clock_timestamp());
end $$;
