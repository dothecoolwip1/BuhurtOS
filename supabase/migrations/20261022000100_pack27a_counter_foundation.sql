-- Pack 27A: Official Counter Foundation (the Counter QR phones, verified against the product model and tightened where the code fell short).
-- What was already there from Pack 25 stays: one reusable Counter QR per event (many phones, nobody kicked out), a phone binds itself to a Lyst and a
-- side with a typed name (audit metadata, never a permission), the server derives everything else from the session, the phones follow the Lyst to the
-- next fight, stale taps are refused, every phone is its own evidence and nothing ever sums or averages counters into a result. This migration:
--   1. OPERATOR TURNS KNOW THE FIGHT. counter_operator_log gains match_id. A turn is "who held this phone, on which Lyst and side, counting which fight,
--      from when to when". Following the Lyst to the next fight closes the turn and opens a new one for the same person. The append-only guard covers the
--      new column. Backfill: every open turn gets the fight its phone is counting right now (hosted will have phones mid-fight when this is applied).
--   2. THE FROZEN EVIDENCE NAMES EVERY OPERATOR. A handoff keeps the phone's tally (Pack 25), but the seat's display name becomes the new person's, so the
--      snapshot credited the whole round to whoever held the phone last. Every tap already carries the operator's name; the snapshot and the tablet's
--      per-round tallies now carry the per-operator breakdown too. No tap is rewritten.
--   3. ONE CURRENT FIGHT PER LYST, under contention. lyst_field_current's primary key already allows one row per Lyst; what was missing was the rule for
--      changing it: a Lyst still IN A ROUND on one fight is not switched to another by a second tablet (the round is ended first), and a tablet left on an
--      earlier fight cannot pull the phones back by touching its clock. The claim lives in one place (private.lyst_field_claim) used by lyst_open and the
--      timer trigger, under the same advisory lock. Opening a fight the Lyst is already on, or the normal next fight after a final one, is unchanged.
--   4. COUNTER MESSAGES FOR PEOPLE. The server's own words for a counter whose place moved on said "seat"; the person holding the phone knows a Lyst and a side.
--   5. counter_undo answers 'nothing' (with the live total) when another undo for the same phone already took the tap, instead of 'ok'.
--   6. lyst_state: each seat carries its session id (a phone) so the tablet matches a waiting phone to its seat by session, never by name; tallies carry operators.
-- Additive: one nullable column, one index, functions redefined, no grants or policies changed, no table dropped, nothing on the device allowlist added.

-- ---------------------------------------------------------------- 1. operator turns know the fight
alter table public.counter_operator_log add column match_id uuid references public.matches (id) on delete set null;
create index counter_operator_log_match_idx on public.counter_operator_log (match_id) where match_id is not null;
comment on column public.counter_operator_log.match_id is 'Pack 27A: the fight this turn counted (null for a phone bound before any fight was open on its Lyst).';

create or replace function private.operator_log_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'the operator log is append-only' using errcode = '42501'; end if;
  if (new.id, new.session_id, new.event_id, new.operator_name, new.field_key, new.side, new.started_at, new.match_id) is distinct from (old.id, old.session_id, old.event_id, old.operator_name, old.field_key, old.side, old.started_at, old.match_id)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    raise exception 'the operator log is append-only' using errcode = '42501'; end if;
  return new;
end $$;

-- a turn: close the phone's open one, open the next (same person or a new one), on the fight named, or the Lyst's current fight when none is named
create function private.counter_log_operator(p_session uuid, p_event uuid, p_name text, p_key text, p_side text, p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.counter_operator_log set ended_at = clock_timestamp() where session_id = p_session and ended_at is null;
  insert into public.counter_operator_log (session_id, event_id, operator_name, field_key, side, match_id) values (p_session, p_event, p_name, p_key, p_side, p_match);
end $$;
revoke execute on function private.counter_log_operator(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
create or replace function private.counter_log_operator(p_session uuid, p_event uuid, p_name text, p_key text, p_side text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.counter_log_operator(p_session, p_event, p_name, p_key, p_side, case when p_key is null then null else private.field_current_match(p_event, p_key) end);
end $$;

-- following the Lyst to the next fight: the same person's turn continues on the new fight (a new line in the log, the old one closed)
create or replace function private.counter_rebind_field(p_event uuid, p_key text, p_match uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  -- seats on this field that are on another (or no) match: trainees and devices alike
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
    perform private.counter_seat_create(p_event, p_key, r.session_id, r.operator_name, p_match, r.side, 'official');
    if p_match is not null then perform private.counter_log_operator(r.session_id, p_event, r.operator_name, p_key, r.side, p_match); end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.audit(p_event, 'lyst.counters_followed', p_match::text, jsonb_build_object('field', p_key, 'seats', v_n)); end if;
  return v_n;
end $$;

-- backfill, once: open turns get the fight their phone is counting now
update public.counter_operator_log l set match_id = s.match_id
  from public.lyst_counter_seats s
  where l.ended_at is null and l.match_id is null and s.user_id = l.session_id and s.status = 'active' and s.match_id is not null
    and s.field_key is not distinct from l.field_key;

-- ---------------------------------------------------------------- 2. the evidence names every operator who tapped during the round
-- per operator, the taps that stand (not undone) in this round on this fight; a tap from before Pack 25 has no name and is credited to the seat's name
create function private.lyst_seat_operators(p_seat uuid, p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'total', o.total) order by o.first_at), '[]'::jsonb)
  from (select coalesce(c.operator_name, s.display_name, 'Counter') as name, sum(c.weight)::integer as total, min(c.created_at) as first_at
        from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id
        where c.seat_id = p_seat and c.match_id = p_match and c.round_no = p_round and c.undo_of is null and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id)
        group by 1) o
$$;
revoke execute on function private.lyst_seat_operators(uuid, uuid, integer) from public, anon, authenticated;

create or replace function private.lyst_counter_snapshot(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'user_id', s.user_id, 'operator', s.display_name, 'slot', s.slot, 'side', s.side, 'role', s.role,
         'device', exists (select 1 from public.event_sessions es where es.id = s.user_id),
         'total', private.lyst_seat_total(s.id, p_round),
         'operators', private.lyst_seat_operators(s.id, p_match, p_round),
         'submitted', exists (select 1 from public.lyst_counter_rounds r where r.seat_id = s.id and r.match_id = p_match and r.round_no = p_round)) order by s.role, s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s where s.match_id = p_match and s.status = 'active'
$$;

-- ---------------------------------------------------------------- 3. one current fight per Lyst
-- The one place a Lyst's current fight changes. Under the field's advisory lock: the same fight is a no-op; a Lyst whose current fight is still in a
-- running round is not switched (end the round there first); otherwise the fight becomes current, it is audited with its source, and the phones follow.
create function private.lyst_field_claim(p_event uuid, p_key text, p_match uuid, p_source text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_prev uuid; v_prev_m public.matches; v_round integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-field:' || p_event::text || ':' || p_key, 0));
  select match_id into v_prev from public.lyst_field_current where event_id = p_event and field_key = p_key;
  if v_prev is not distinct from p_match then return false; end if;
  if v_prev is not null then
    select * into v_prev_m from public.matches where id = v_prev;
    if v_prev_m.id is not null and v_prev_m.queue_state <> 'final' then
      select r.round_no into v_round from public.lyst_rounds r where r.match_id = v_prev and r.status = 'running' order by r.round_no desc limit 1;
      if v_round is not null then
        raise exception '% is still in round % of % vs %. End that round there first.', private.field_label(p_key), v_round,
          coalesce(private.lyst_side_name(v_prev_m.entry_a), 'Side A'), coalesce(private.lyst_side_name(v_prev_m.entry_b), 'Side B') using errcode = 'P0001';
      end if;
    end if;
  end if;
  insert into public.lyst_field_current (event_id, field_key, match_id, opened_at) values (p_event, p_key, p_match, clock_timestamp())
  on conflict (event_id, field_key) do update set match_id = excluded.match_id, opened_at = excluded.opened_at;
  perform private.audit(p_event, 'lyst.field_current', p_match::text, jsonb_build_object('field', p_key, 'previous', v_prev, 'source', p_source));
  return true;
end $$;
revoke execute on function private.lyst_field_claim(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.lyst_open(p_match uuid, p_counter_input text default 'simple') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_key text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_counter_input is null or p_counter_input not in ('simple', 'weighted', 'standing') then raise exception 'counter input is simple, weighted or standing' using errcode = '22023'; end if;
  v_m := private.lyst_match_check(v_event, p_match, null);
  v_key := private.field_key(v_m.field);
  insert into public.lyst_matches (match_id, event_id, field_key, counter_input) values (p_match, v_event, v_key, p_counter_input) on conflict (match_id) do nothing;
  perform private.lyst_field_claim(v_event, v_key, p_match, 'open');
  perform private.counter_rebind_field(v_event, v_key, p_match);
  return jsonb_build_object('status', 'ok', 'match_id', p_match, 'counter_input', (select counter_input from public.lyst_matches where match_id = p_match));
end $$;

-- The marshal's clock makes a fight current when it is SET or STARTED on it (a new fight on the clock), or when the Lyst has no current fight at all (a
-- fight opened by a path that skipped lyst_open). A status change on a fight the Lyst has moved on from (a tablet left behind) changes nothing and is told so.
create or replace function private.lyst_timer_field_current() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cur uuid; v_cur_m public.matches;
begin
  if new.match_id is null then return null; end if;
  if not exists (select 1 from public.matches m join public.lyst_matches lm on lm.match_id = m.id where m.id = new.match_id and m.queue_state <> 'final') then return null; end if;
  if tg_op = 'UPDATE' and old.match_id is not distinct from new.match_id then
    -- the clock changed on the fight it was already on: the Lyst's recorded current fight → nothing to do; none recorded (a fight opened by a path that
    -- skipped lyst_open, or before Pack 25) → claim it; another fight recorded as current → this screen is behind
    select f.match_id into v_cur from public.lyst_field_current f join public.matches m on m.id = f.match_id
      where f.event_id = new.event_id and f.field_key = new.field_key and m.queue_state <> 'final';
    if v_cur is not distinct from new.match_id then return null; end if;
    if v_cur is not null then
      select * into v_cur_m from public.matches where id = v_cur;
      raise exception '% has moved on to % vs %. This screen is on an earlier fight: open the fight that is on.', private.field_label(new.field_key),
        coalesce(private.lyst_side_name(v_cur_m.entry_a), 'Side A'), coalesce(private.lyst_side_name(v_cur_m.entry_b), 'Side B') using errcode = 'P0001';
    end if;
  end if;
  if private.lyst_field_claim(new.event_id, new.field_key, new.match_id, 'timer') then
    perform private.counter_rebind_field(new.event_id, new.field_key, new.match_id);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- 4. the server's words for a counter whose place moved on
create or replace function private.lyst_seat_for_counting(p_seat uuid, p_round integer, p_need_running boolean) returns public.lyst_counter_seats
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_state text; v_cur integer; v_rs text;
begin
  select * into v_s from public.lyst_counter_seats where id = p_seat;
  if not found or v_s.user_id is distinct from auth.uid() then raise exception 'this phone is not counting on that fight' using errcode = '42501'; end if;
  if v_s.status <> 'active' or v_s.expires_at is null or v_s.expires_at < now() then raise exception 'this phone is not counting now: choose your Lyst and side again' using errcode = 'P0001'; end if;
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

-- ---------------------------------------------------------------- 5. two undos racing for the same tap: the second one took nothing
create or replace function public.counter_undo(p_id uuid, p_seat uuid, p_round integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_old public.lyst_counts; v_target uuid; v_n integer;
begin
  perform private.assert_session_alive();   -- a dead device session has no authority here either (Pack 18.1)
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
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, undo_of, operator_name) values (p_id, p_seat, v_s.match_id, p_round, 0, v_target, v_s.display_name) on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n = 1 then 'ok' else 'nothing' end, 'total', private.lyst_seat_total(p_seat, p_round));
end $$;

-- ---------------------------------------------------------------- 6. the tablet's read: seats carry their session, tallies carry operators
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
                  'device', es.id is not null, 'session_id', es.id, 'online', case when es.id is null then null else coalesce(es.last_seen_at > clock_timestamp() - interval '90 seconds', false) end,
                  'tallies', coalesce((select jsonb_agg(jsonb_build_object('round_no', rr.round_no, 'total', private.lyst_seat_total(s.id, rr.round_no),
                        'operators', private.lyst_seat_operators(s.id, p_match, rr.round_no),
                        'submitted', exists (select 1 from public.lyst_counter_rounds cr where cr.seat_id = s.id and cr.match_id = p_match and cr.round_no = rr.round_no)) order by rr.round_no)
                        from public.lyst_rounds rr where rr.match_id = p_match), '[]'::jsonb)) order by s.role, s.side, s.display_name)
                  from public.lyst_counter_seats s left join public.event_sessions es on es.id = s.user_id where s.match_id = p_match and s.status = 'active'), '[]'::jsonb),
    'field_counters', coalesce((select jsonb_agg(jsonb_build_object('session_id', b.session_id, 'operator', b.operator_name, 'side', b.side,
                  'online', coalesce(es.last_seen_at > clock_timestamp() - interval '90 seconds', false)) order by b.side, b.operator_name)
                  from public.counter_bindings b join public.event_sessions es on es.id = b.session_id where b.event_id = v_event and b.field_key = v_key and es.ended_at is null), '[]'::jsonb),
    'join_code', (select jsonb_build_object('code', c.code, 'expires_at', c.expires_at) from public.lyst_join_codes c
                  where c.event_id = v_event and c.field_key = v_key and c.revoked_at is null and c.expires_at > now() order by c.created_at desc limit 1));
end $$;

comment on table public.counter_operator_log is 'Pack 25/27A: who held each counter phone, on which Lyst and side, counting which fight, from when to when. Audit only; append-only.';
