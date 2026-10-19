-- Organizer lineup (owner decision 2026-10-18), after 20261022000100_secretary_boundary. ADDITIVE: two new functions, four anchored patches.
--
--   public.replace_match_entrant(match, side, entry, reason, version)  an organizer (or the Event Admin tablet) puts another eligible entrant on one
--       side of a fight that has not started. Never a fight with history, never a slot a bracket or the third-place rule fills, never the opponent
--       again, never someone withdrawn, disqualified, not ready (readiness is authoritative) or fighting right now. Version-checked, audited.
--   public.save_field_lineup(event, field, order, versions)  the organizer's drag-and-drop: the COMPLETE list of a field's editable fights (called and
--       waiting, including fights still waiting on an earlier result) in the new order, with the version each was seen at. Exact set or nothing
--       ('stale', nothing changes). The first two fights that can run go on deck / in the hole, the rest keep a manual order. Fights that are on now,
--       final, have history, or are already on a Lyst are not editable and never move.
--   Secretary (private.is_secretary_only, from the previous migration) loses the last event-wide counter / side / discipline-desk powers:
--       event_discipline_overview, set_event_sides, end_counter_seat (someone else's seat), counter_operator_history.
-- Nothing in flight changes: no rows are rewritten here.

create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;
  if position(p_from in v_def) = 0 then raise exception 'lineup patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;
create or replace function pg_temp.bos_patch_all(p_name text, p_from text, p_to text) returns integer language plpgsql as $p$
declare r record; v_n integer := 0;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = p_name loop
    perform pg_temp.bos_patch(r.fn, p_from, p_to);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'lineup patch: no function public.%', p_name; end if;
  return v_n;
end $p$;

-- ---------------------------------------------------------------- 1. the last secretary restrictions
select pg_temp.bos_patch_all('event_discipline_overview',
  $a$if auth.uid() is null or not private.can_see_discipline(p_event) then$a$,
  $b$if auth.uid() is null or not private.can_see_discipline(p_event) or private.is_secretary_only(p_event) then$b$);
select pg_temp.bos_patch_all('set_event_sides',
  $a$if p_event is null or not (private.can_score(p_event) or private.is_owner()) then$a$,
  $b$if p_event is null or not (private.can_score(p_event) or private.is_owner()) or private.is_secretary_only(p_event) then$b$);
-- the counter may still end their own seat; staff ending someone else's is not the secretary's
select pg_temp.bos_patch('public.end_counter_seat(uuid,boolean)'::regprocedure,
  $a$if v_s.user_id <> auth.uid() and not private.can_score(v_s.event_id) then$a$,
  $b$if v_s.user_id <> auth.uid() and (not private.can_score(v_s.event_id) or private.is_secretary_only(v_s.event_id)) then$b$);
select pg_temp.bos_patch('public.counter_operator_history(uuid,uuid)'::regprocedure,
  $a$if p_event is null or not (private.is_owner() or private.can_score(p_event)) then$a$,
  $b$if p_event is null or not (private.is_owner() or private.can_score(p_event)) or private.is_secretary_only(p_event) then$b$);

-- ---------------------------------------------------------------- 2. which fights the organizer's lineup edits
-- On this field, not on now and not final, nothing recorded (private.match_history_reason), and not the fight a Lyst or the clock is already on.
create or replace function private.lineup_editable(p_event uuid, p_key text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.matches m join public.competitions k on k.id = m.competition_id
  where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state in ('scheduled', 'on_deck', 'in_the_hole')
    and private.match_history_reason(m.id) is null
    and not exists (select 1 from public.lyst_field_current f where f.match_id = m.id)
    and not exists (select 1 from public.lyst_timer t where t.match_id = m.id)
$$;
revoke execute on function private.lineup_editable(uuid, text) from public, anon, authenticated;

-- the fighters behind an entry (a fighter entry, or a team's roster)
create or replace function private.entry_fighter_ids(p_entry uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.fighter_id from public.entries e where e.id = p_entry and e.fighter_id is not null
  union select ef.fighter_id from public.entry_fighters ef where ef.entry_id = p_entry
$$;
revoke execute on function private.entry_fighter_ids(uuid) from public, anon, authenticated;

-- Server-owned editable set: a fight returned to the line may still carry Lyst/clock history.
create or replace function public.editable_field_lineup(p_event uuid, p_field text) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if not coalesce(private.is_event_operator(p_event), false) then raise exception 'only an organizer of this event can edit the lineup' using errcode = '42501'; end if;
  return coalesce((select array_agg(x order by x) from private.lineup_editable(p_event, private.field_key(p_field)) x), '{}');
end $$;
revoke execute on function public.editable_field_lineup(uuid, text) from public, anon;
grant execute on function public.editable_field_lineup(uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.editable_field_lineup(uuid, text) to bos_event_device;
  end if;
end $$;

-- ---------------------------------------------------------------- 3. the organizer's drag-and-drop
create or replace function public.save_field_lineup(p_event uuid, p_field text, p_order uuid[], p_versions jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := private.field_key(p_field); v_now uuid[]; v_slots text[] := array[]::text[]; v_id uuid; v_m public.matches; v_i integer := 0; v_slot integer := 0;
  v_waiting integer := 0; v_state text; v_before jsonb; v_after jsonb := '[]'::jsonb; v_changed integer := 0; v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_event is null or not coalesce(private.is_event_operator(p_event), false) then raise exception 'only an organizer of this event can change the running order' using errcode = '42501'; end if;
  if private.event_closed(p_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  if p_order is null or cardinality(p_order) > 500 then raise exception 'send the field''s fights in order (at most 500)' using errcode = '22023'; end if;
  if array_position(p_order, null) is not null or (select count(distinct x) from unnest(p_order) x) <> cardinality(p_order) then
    raise exception 'list every fight once' using errcode = '22023'; end if;
  if p_versions is null or jsonb_typeof(p_versions) <> 'object' then raise exception 'send the version of every fight' using errcode = '22023'; end if;
  perform private.queue_lock(p_event);
  perform pg_advisory_xact_lock(hashtextextended('bos:lineup:' || p_event::text || ':' || v_key, 0));

  select coalesce(array_agg(x order by x), '{}') into v_now from private.lineup_editable(p_event, v_key) x;
  -- Lock the event-owned rows before checking their snapshots; concurrent scoring must not slip between validation and mutation.
  if cardinality(v_now) > 0 and not private.lock_matches_nowait(v_now) then raise exception 'someone else is changing these fights right now; try again' using errcode = '55P03'; end if;
  -- exact set, exact versions: otherwise nothing changes and the screen reloads
  if v_now is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_order) x)
     or (select count(*) from jsonb_object_keys(p_versions)) <> cardinality(p_order)
     or exists (select 1 from public.matches m where m.id = any (p_order)
                and (p_versions -> m.id::text) is distinct from jsonb_build_object(
                  'version', m.version, 'queue_state', m.queue_state, 'queue_order', m.queue_order,
                  'plan_order', m.plan_order, 'plan_hold', m.plan_hold)) then
    return jsonb_build_object('status', 'stale', 'field', v_key,
      'fights', coalesce((select jsonb_agg(jsonb_build_object('match_id', m.id, 'version', m.version, 'queue_state', m.queue_state) order by m.id)
                          from public.matches m where m.id = any (v_now)), '[]'::jsonb));
  end if;
  if cardinality(p_order) = 0 then return jsonb_build_object('status', 'ok', 'changed', 0, 'field', v_key); end if;

  -- a place on deck / in the hole that a fight we may not move already holds stays its own
  select array_agg(s) into v_slots from unnest(array['on_deck', 'in_the_hole']) s
   where not exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id
                     where k.event_id = p_event and private.field_key(m.field) = v_key and m.queue_state = s and not (m.id = any (p_order)));
  select jsonb_agg(jsonb_build_object('match_id', m.id, 'queue_state', m.queue_state, 'queue_order', m.queue_order) order by o.ord) into v_before
    from unnest(p_order) with ordinality o(id, ord) join public.matches m on m.id = o.id;

  foreach v_id in array p_order loop
    v_i := v_i + 1;
    select * into v_m from public.matches where id = v_id;
    if v_slot < coalesce(cardinality(v_slots), 0) and private.match_runnable(v_m) and not v_m.plan_hold and not v_m.hold_manual then
      v_slot := v_slot + 1; v_state := v_slots[v_slot];
      update public.matches set queue_state = v_state, queue_order = null where id = v_id and (queue_state, queue_order) is distinct from (v_state, null::integer);
    else
      v_waiting := v_waiting + 1; v_state := 'scheduled';
      update public.matches set queue_state = 'scheduled', queue_order = v_waiting where id = v_id and (queue_state, queue_order) is distinct from ('scheduled', v_waiting);
    end if;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
    v_after := v_after || jsonb_build_object('match_id', v_id, 'queue_state', v_state, 'queue_order', case when v_state = 'scheduled' then v_waiting end);
  end loop;
  if v_changed > 0 then
    perform private.audit(p_event, 'queue.lineup_saved', v_key, jsonb_build_object('field', v_key, 'changed', v_changed, 'before', v_before, 'after', v_after, 'by', private.actor_role(p_event)));
  end if;
  return jsonb_build_object('status', 'ok', 'changed', v_changed, 'field', v_key, 'lineup', v_after);
end $$;

-- ---------------------------------------------------------------- 4. another entrant on one side
create or replace function public.replace_match_entrant(p_match uuid, p_side text, p_entry uuid, p_reason text, p_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_e public.entries; v_old uuid; v_other uuid; v_why text; v_reason text := btrim(coalesce(p_reason, '')); v_bad text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not coalesce(private.is_event_operator(v_event), false) then raise exception 'only an organizer of this event can change who fights' using errcode = '42501'; end if;
  if p_side is null or p_side not in ('a', 'b') then raise exception 'say which side (a or b)' using errcode = '22023'; end if;
  if p_entry is null then raise exception 'choose the entrant' using errcode = '22023'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then raise exception 'say why the entrant changes (3 to 200 characters)' using errcode = '22023'; end if;
  if p_version is null then raise exception 'the version you opened is required, reload the fight' using errcode = '22023'; end if;
  if private.event_closed(v_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  perform private.queue_lock(v_event);
  if not private.lock_matches_nowait(array[p_match]) then raise exception 'someone else is changing this fight right now; try again' using errcode = '55P03'; end if;
  select * into v_m from public.matches where id = p_match;
  if v_m.version <> p_version then return jsonb_build_object('status', 'stale', 'version', v_m.version); end if;

  if v_m.queue_state not in ('scheduled', 'on_deck', 'in_the_hole') then raise exception 'this fight has started or is final: its entrants are part of the record' using errcode = 'P0001'; end if;
  v_why := private.match_history_reason(p_match);
  if v_why is not null then raise exception 'this fight has history (%): its entrants are part of the record', v_why using errcode = 'P0001'; end if;
  if exists (select 1 from public.lyst_field_current f where f.match_id = p_match) or exists (select 1 from public.lyst_timer t where t.match_id = p_match) then
    raise exception 'this fight is already on a Lyst: take it off first' using errcode = 'P0001'; end if;
  if v_m.stage = 'third_place' or exists (select 1 from public.matches s where s.next_match_id = p_match and s.next_slot = p_side) then
    raise exception 'this side is filled by an earlier result, not by hand' using errcode = 'P0001'; end if;

  v_old := case when p_side = 'a' then v_m.entry_a else v_m.entry_b end;
  v_other := case when p_side = 'a' then v_m.entry_b else v_m.entry_a end;
  if p_entry is not distinct from v_old then return jsonb_build_object('status', 'unchanged', 'version', v_m.version); end if;
  select * into v_e from public.entries where id = p_entry;
  if not found or v_e.competition_id <> v_m.competition_id then raise exception 'that entrant is not in this competition' using errcode = '22023'; end if;
  if v_e.status in ('withdrawn', 'disqualified') then raise exception 'that entrant is %', v_e.status using errcode = 'P0001'; end if;
  if p_entry is not distinct from v_other then raise exception 'an entrant cannot fight themselves' using errcode = 'P0001'; end if;
  if v_other is not null and exists (select 1 from private.entry_fighter_ids(p_entry) a join private.entry_fighter_ids(v_other) b on a = b) then
    raise exception 'a fighter would be on both sides' using errcode = 'P0001'; end if;
  -- readiness is authoritative: an accepted registration that is not ready blocks (no registration at all is not a block, as announcer_readiness reads it)
  select string_agg(distinct coalesce(r.full_name, 'a fighter'), ', ') into v_bad
    from private.readiness_rows(v_event, false) r where r.status = 'accepted' and r.fighter_id in (select private.entry_fighter_ids(p_entry)) and not coalesce(r.ready, true);
  if v_bad is not null then raise exception 'not ready to fight: %', v_bad using errcode = 'P0001'; end if;
  -- nobody fighting right now
  if exists (select 1 from public.matches x join public.competitions k on k.id = x.competition_id
             where k.event_id = v_event and x.queue_state = 'active' and x.id <> p_match
               and exists (select 1 from private.entry_fighter_ids(p_entry) f
                           where f in (select private.entry_fighter_ids(x.entry_a)) or f in (select private.entry_fighter_ids(x.entry_b)))) then
    raise exception 'that entrant is fighting right now' using errcode = 'P0001'; end if;

  if p_side = 'a' then update public.matches set entry_a = p_entry, version = version + 1 where id = p_match;
  else update public.matches set entry_b = p_entry, version = version + 1 where id = p_match; end if;
  perform private.audit(v_event, 'match.entrant_replaced', p_match::text, jsonb_build_object('side', p_side, 'from', v_old, 'to', p_entry, 'reason', v_reason,
    'version', v_m.version + 1, 'by', private.actor_role(v_event)));
  -- a called fight that can no longer run goes back to the line, and the line fills itself again
  perform private.settle_field_queue(v_event, private.field_key(v_m.field), false);
  return jsonb_build_object('status', 'ok', 'version', v_m.version + 1, 'side', p_side, 'entry', p_entry);
end $$;

-- ---------------------------------------------------------------- 5. privileges
revoke execute on function public.save_field_lineup(uuid, text, uuid[], jsonb), public.replace_match_entrant(uuid, text, uuid, text, integer) from public, anon;
grant execute on function public.save_field_lineup(uuid, text, uuid[], jsonb), public.replace_match_entrant(uuid, text, uuid, text, integer) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.save_field_lineup(uuid, text, uuid[], jsonb), public.replace_match_entrant(uuid, text, uuid, text, integer) to bos_event_device;
  end if;
end $$;
