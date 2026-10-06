-- Pack 24A0: match safety guards. Additive. Found by the Pack 23R Rumble rehearsal (docs/claude-packs/PACK_23R_RUMBLE_REHEARSAL.md).
--
--   1. A draw can no longer be replaced over a fight that has started or has history (build_schedule 'replace'). One definition of "protected
--      history", private.match_history_reason, is used by the check and by the tests.
--   2. build_schedule validates the shape of the bracket it is given (no unfed slot, no two feeders into one slot, no self-link, no collision with a
--      side that is already filled), so a plan cannot leave a downstream match with a missing feeder.
--   3. The organizer's raw table rights on public.matches shrink to the three schedule columns (scheduled_at, field, duration_minutes). INSERT, DELETE and
--      every structural column (entry_a, entry_b, next_match_id, next_slot, position, stage, round_label, pool) are no longer writable through the table
--      API; no screen used them. Schedule edits are audited (match.schedule_changed).
--   4. set_match_queue: only an organizer may call a waiting fight, reorder the called fights or move a fight to another field. Other scoring staff keep
--      what a field screen needs: open a called fight, send a called or active fight back to the line. Every change is audited (queue.state_set).
--   5. Holds: set_match_hold (organizer) makes a hold deliberate; save_queue_plan (what Event day saves on every open) never clears a deliberate hold.
--      A hold the planner made from attendance is still the planner's to change.
-- Nothing is deleted or rewritten; one column is added.

alter table public.matches add column if not exists hold_manual boolean not null default false;
comment on column public.matches.hold_manual is 'True when an organizer deliberately held this waiting fight (set_match_hold). Event day''s saved plan never clears it; only set_match_hold(false) does. plan_hold is the effective hold (planner or deliberate).';

-- ---------------------------------------------------------------- 1. what counts as protected history
-- Protected history = a fight that has been fought, is being fought, or whose scoring or result left a record. It is never deleted by a draw rebuild.
-- Called fights (on deck, in the hole) with nothing recorded are NOT history. Pure setup rows (lyst_matches, lyst_counter_seats, lyst_timer) are not either:
-- they hold no sporting data and are tied to the fight, not to a result.
create or replace function private.match_history_reason(p_match uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when m.queue_state = 'final' or m.result is not null or m.winner_entry_id is not null or m.finalized_at is not null then 'a result is recorded'
    when m.queue_state = 'active' then 'a fight is being fought'
    when exists (select 1 from public.score_events e where e.match_id = m.id) then 'scoring has been recorded'
    when exists (select 1 from public.match_live_scores s where s.match_id = m.id) then 'live scoring is in progress'
    when exists (select 1 from public.lyst_rounds r where r.match_id = m.id)
      or exists (select 1 from public.lyst_round_revisions r where r.match_id = m.id)
      or exists (select 1 from public.lyst_counts c where c.match_id = m.id)
      or exists (select 1 from public.lyst_counter_rounds c where c.match_id = m.id) then 'Lyst scoring has been recorded'
    when exists (select 1 from public.match_discipline d where d.match_id = m.id) then 'discipline has been recorded'
    when exists (select 1 from public.result_proposals r where r.match_id = m.id) then 'a result was submitted or reviewed'
    when exists (select 1 from public.audit_log a where a.event_id = k.event_id and a.subject = m.id::text and a.action in ('match.finalized', 'match.reopened', 'result.paper_entered')) then 'a result was recorded and later reopened'
  end
  from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match $$;
revoke execute on function private.match_history_reason(uuid) from public, anon, authenticated;

-- The shape of a planned bracket. A match that others feed into must have both of its sides covered: a feeder or a side already filled (a bye).
-- The third-place match is filled by the server from the semifinal losers and is exempt.
create or replace function private.plan_rows(p_matches jsonb) returns table (k text, stage text, a text, b text, nk text, ns text)
language sql immutable set search_path = '' as $$
  select e.value ->> 'key', e.value ->> 'stage', nullif(e.value ->> 'a', ''), nullif(e.value ->> 'b', ''), nullif(e.value ->> 'next_key', ''), e.value ->> 'next_slot'
  from jsonb_array_elements(p_matches) e $$;
revoke execute on function private.plan_rows(jsonb) from public, anon, authenticated;

create or replace function private.check_plan_structure(p_matches jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare v_bad text;
begin
  select p.k into v_bad from private.plan_rows(p_matches) p where p.nk = p.k limit 1;
  if v_bad is not null then raise exception 'planned match % feeds itself', v_bad using errcode = 'P0001'; end if;
  select p.k into v_bad from private.plan_rows(p_matches) p where p.nk is not null and (p.ns is null or p.ns not in ('a', 'b')) limit 1;
  if v_bad is not null then raise exception 'planned match % needs a slot (a or b) in the match it feeds', v_bad using errcode = 'P0001'; end if;
  select p.nk into v_bad from private.plan_rows(p_matches) p where p.nk is not null group by p.nk, p.ns having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'two planned matches feed the same side of match %', v_bad using errcode = 'P0001'; end if;
  select f.k into v_bad from private.plan_rows(p_matches) f join private.plan_rows(p_matches) t on t.k = f.nk
    where (f.ns = 'a' and t.a is not null) or (f.ns = 'b' and t.b is not null) limit 1;
  if v_bad is not null then raise exception 'planned match % feeds a side that is already filled', v_bad using errcode = 'P0001'; end if;
  select t.k into v_bad from private.plan_rows(p_matches) t
    where t.stage <> 'third_place' and exists (select 1 from private.plan_rows(p_matches) f where f.nk = t.k)
      and ((t.a is null and not exists (select 1 from private.plan_rows(p_matches) f where f.nk = t.k and f.ns = 'a'))
        or (t.b is null and not exists (select 1 from private.plan_rows(p_matches) f where f.nk = t.k and f.ns = 'b'))) limit 1;
  if v_bad is not null then raise exception 'planned match % has a side that no match feeds and nobody fills', v_bad using errcode = 'P0001'; end if;
end $$;
revoke execute on function private.check_plan_structure(jsonb) from public, anon, authenticated;

create or replace function public.build_schedule(p_competition uuid, p_matches jsonb, p_mode text, p_draw jsonb default null, p_advance integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_k public.competitions; v_ids jsonb := '{}'::jsonb; v_el jsonb; v_key text; v_id uuid; v_n int := 0; v_existing int;
  v_old uuid[]; v_expect uuid[]; v_got uuid[]; v_format text; v_next text; v_hist int; v_why text; v_prev jsonb;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can build a schedule' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('new', 'replace', 'append') then raise exception 'mode must be new, replace or append' using errcode = '22023'; end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) > 400 then raise exception 'send a list of at most 400 planned matches' using errcode = '22023'; end if;
  perform private.check_plan_structure(p_matches);
  select count(*) into v_existing from public.matches where competition_id = p_competition;

  if p_mode = 'new' and v_existing > 0 then raise exception 'This competition already has matches. Replace them to start over.' using errcode = 'P0001'; end if;
  if p_mode = 'replace' then
    -- hold every fight of this draw first, so nothing can start or be scored between the check below and the delete
    perform 1 from public.matches where competition_id = p_competition order by id for update;
    select count(*), string_agg(distinct x.r, '; ') into v_hist, v_why
    from (select private.match_history_reason(m.id) as r from public.matches m where m.competition_id = p_competition) x where x.r is not null;
    if v_hist > 0 then
      raise exception 'This draw cannot be replaced: % of its fights have started or already have a result or scoring history (%). Those fights are never deleted. If a fight was only set going by mistake and nothing was scored, send it back to the line first.', v_hist, v_why using errcode = 'P0001';
    end if;
    select array_agg(id) into v_old from public.matches where competition_id = p_competition;
    select coalesce(jsonb_object_agg(s.queue_state, s.c), '{}'::jsonb) into v_prev from (select queue_state, count(*) c from public.matches where competition_id = p_competition group by queue_state) s;
  end if;
  if p_mode = 'append' then
    if p_advance is null or p_advance < 1 then raise exception 'say how many advance from each pool' using errcode = '22023'; end if;
    if not exists (select 1 from public.matches where competition_id = p_competition and stage = 'pool') then raise exception 'there is no pool play to build a bracket from' using errcode = 'P0001'; end if;
    if exists (select 1 from public.matches where competition_id = p_competition and stage in ('elimination', 'third_place', 'final')) then
      raise exception 'the bracket for this competition was already built' using errcode = 'P0001'; end if;
    if exists (select 1 from public.matches where competition_id = p_competition and stage = 'pool' and queue_state <> 'final') then
      raise exception 'pool play is not finished' using errcode = 'P0001'; end if;
    if v_k.structure <> 'pools_elimination' then update public.competitions set structure = 'pools_elimination' where id = p_competition; end if;
    if exists (select 1 from private.unresolved_ties(p_competition, p_advance)) then
      raise exception 'a pool tie affects who advances; record the order first' using errcode = 'P0001'; end if;
    select array_agg(g.ent order by g.ent) into v_expect from private.group_ranks(p_competition) g where g.lvl = 'p' and g.wrank <= p_advance;
  end if;

  for v_el in select value from jsonb_array_elements(p_matches) loop
    v_key := v_el ->> 'key';
    if v_key is null or v_ids ? v_key then raise exception 'every planned match needs its own key' using errcode = '22023'; end if;
    v_id := gen_random_uuid();
    v_ids := v_ids || jsonb_build_object(v_key, v_id);
    insert into public.matches (id, competition_id, stage, round_label, position, pool, entry_a, entry_b)
    values (v_id, p_competition, v_el ->> 'stage', coalesce(v_el ->> 'round_label', ''), coalesce((v_el ->> 'position')::int, 0), nullif(v_el ->> 'pool', ''),
            nullif(v_el ->> 'a', '')::uuid, nullif(v_el ->> 'b', '')::uuid);
    v_n := v_n + 1;
  end loop;
  for v_el in select value from jsonb_array_elements(p_matches) loop
    v_next := v_el ->> 'next_key';
    if v_next is not null then
      if not (v_ids ? v_next) then raise exception 'planned match % links to unknown match %', v_el ->> 'key', v_next using errcode = '22023'; end if;
      update public.matches set next_match_id = (v_ids ->> v_next)::uuid, next_slot = v_el ->> 'next_slot' where id = (v_ids ->> (v_el ->> 'key'))::uuid;
    end if;
  end loop;

  if p_mode = 'append' then
    select array_agg(distinct x order by x) into v_got
    from (select nullif(e.value ->> 'a', '')::uuid x from jsonb_array_elements(p_matches) e union all select nullif(e.value ->> 'b', '')::uuid from jsonb_array_elements(p_matches) e) s where x is not null;
    if v_got is distinct from v_expect then raise exception 'the bracket does not match the pool standings; reload and try again' using errcode = 'P0001'; end if;
  end if;
  if p_mode = 'replace' and v_old is not null then delete from public.matches where id = any (v_old); end if;

  if p_mode <> 'append' and p_draw is not null then
    v_format := p_draw ->> 'format';
    update public.competitions set
      draw_seed = case when p_draw ->> 'mode' = 'random' then (p_draw ->> 'seed')::int end,
      draw_mode = p_draw ->> 'mode', draw_algorithm = p_draw ->> 'algorithm', drawn_at = now(),
      structure = case v_format when 'pools' then 'pools_elimination' when 'single_elimination' then 'elimination' when 'round_robin' then 'round_robin' else structure end
    where id = p_competition;
  end if;
  perform private.audit(v_k.event_id, 'schedule.built', p_competition::text,
    jsonb_build_object('mode', p_mode, 'matches', v_n, 'draw', p_draw, 'advance', p_advance)
    || case when p_mode = 'replace' then jsonb_build_object('replaced', coalesce(cardinality(v_old), 0), 'replaced_states', coalesce(v_prev, '{}'::jsonb), 'replaced_ids', to_jsonb(coalesce(v_old[1:100], '{}'::uuid[]))) else '{}'::jsonb end);
  return v_n;
end $$;

-- ---------------------------------------------------------------- 2. raw table rights on matches
-- Nothing in the app inserts or deletes matches, or writes a structural column, through the table API (src/data/runSchedule.ts and src/data/eventDay.ts
-- write only scheduled_at, field and duration_minutes). Structure is built, replaced and advanced by build_schedule, finalize_match, reopen_match and
-- withdraw_entry, which check who may and leave an audit row.
revoke insert, update, delete on public.matches from authenticated;
grant update (scheduled_at, field, duration_minutes) on public.matches to authenticated;
drop policy if exists matches_organizer_insert on public.matches;
drop policy if exists matches_organizer_delete on public.matches;

-- Time, field and length stay a direct write for an organizer (the row policy and the lock guard still apply); every change is audited, one row per
-- statement and event, with the old and new values. A change made inside set_match_queue is audited by that function instead.
create or replace function private.audit_schedule_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if auth.uid() is null or coalesce(current_setting('bos.queue_audited', true), '') = 'on' then return null; end if;
  for r in
    select k.event_id, count(*) as n,
           (array_agg(
              jsonb_build_object('match', nw.id)
              || case when o.scheduled_at is distinct from nw.scheduled_at then jsonb_build_object('scheduled_at', jsonb_build_array(o.scheduled_at, nw.scheduled_at)) else '{}'::jsonb end
              || case when o.field is distinct from nw.field then jsonb_build_object('field', jsonb_build_array(o.field, nw.field)) else '{}'::jsonb end
              || case when o.duration_minutes is distinct from nw.duration_minutes then jsonb_build_object('duration_minutes', jsonb_build_array(o.duration_minutes, nw.duration_minutes)) else '{}'::jsonb end
              order by nw.id))[1:50] as changes
    from new_rows nw join old_rows o on o.id = nw.id join public.competitions k on k.id = nw.competition_id
    where o.scheduled_at is distinct from nw.scheduled_at or o.field is distinct from nw.field or o.duration_minutes is distinct from nw.duration_minutes
    group by k.event_id
  loop
    perform private.audit(r.event_id, 'match.schedule_changed', null, jsonb_build_object('matches', r.n, 'changes', to_jsonb(r.changes)));
  end loop;
  return null;
end $$;
revoke execute on function private.audit_schedule_changes() from public, anon, authenticated;
drop trigger if exists matches_audit_schedule on public.matches;
create trigger matches_audit_schedule after update on public.matches referencing old table as old_rows new table as new_rows
  for each statement execute function private.audit_schedule_changes();

-- ---------------------------------------------------------------- 3. set_match_queue: who may do what
-- An organizer (the platform owner and an organization administrator count as organizers) keeps full control. Scorekeepers, marshals and the head
-- marshal may open a fight that has already been called (on deck, in the hole, active) and send a called or active fight back to the line; they cannot
-- call a waiting fight, swap the called fights or change a fight's field. advance_field_queue (the queue picks, in order) is unchanged.
create or replace function public.set_match_queue(p_match uuid, p_state text, p_field text default null::text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_org boolean; v_field text;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if p_state not in ('scheduled', 'on_deck', 'in_the_hole', 'active') then raise exception 'use finalize_match to finish a match' using errcode = '22023'; end if;
  v_org := private.is_organizer(v_event);
  perform private.queue_lock(v_event);
  if not private.lock_matches_nowait(array[p_match]) then raise exception 'someone else is changing this match right now; try again' using errcode = '55P03'; end if;
  select * into v_m from public.matches where id = p_match;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  v_field := case when p_field is null then v_m.field when btrim(p_field) = '' then null else p_field end;
  if not v_org then
    if v_m.queue_state not in ('on_deck', 'in_the_hole', 'active') then raise exception 'only an organizer can call a fight that is still waiting in the line' using errcode = '42501'; end if;
    if p_state not in ('active', 'scheduled') then raise exception 'only an organizer can change the order of the called fights' using errcode = '42501'; end if;
    -- a field screen passes the field it is showing ('Field 1' for a fight with no field set): the same field is not a change, and is not written
    if private.field_key(v_field) is distinct from private.field_key(v_m.field) then raise exception 'only an organizer can move a fight to another field' using errcode = '42501'; end if;
    v_field := v_m.field;
  end if;
  if v_m.queue_state = p_state and v_field is not distinct from v_m.field then return; end if;
  perform set_config('bos.queue_audited', 'on', true);
  update public.matches set queue_state = p_state, queue_order = case when p_state = 'scheduled' then queue_order else null end, field = v_field where id = p_match;
  perform set_config('bos.queue_audited', '', true);
  perform private.audit(v_event, 'queue.state_set', p_match::text, jsonb_build_object('from', v_m.queue_state, 'to', p_state, 'field_from', v_m.field, 'field_to', v_field,
    'by', case when v_org then 'organizer' else 'scoring staff' end));
end $$;

-- ---------------------------------------------------------------- 4. holds
create or replace function public.set_match_hold(p_match uuid, p_held boolean, p_reason text default null::text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can hold or release a fight' using errcode = '42501'; end if;
  if p_held is null then raise exception 'say whether to hold or release the fight' using errcode = '22023'; end if;
  if p_held and (char_length(v_reason) < 3 or char_length(v_reason) > 120) then raise exception 'say why the fight is held (3 to 120 characters)' using errcode = '22023'; end if;
  perform private.queue_lock(v_event);
  if not private.lock_matches_nowait(array[p_match]) then raise exception 'someone else is changing this match right now; try again' using errcode = '55P03'; end if;
  select * into v_m from public.matches where id = p_match;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  if p_held and v_m.queue_state <> 'scheduled' then raise exception 'only a fight waiting in the line can be held; send it back to the line first' using errcode = 'P0001'; end if;
  if p_held and v_m.hold_manual then return jsonb_build_object('held', true, 'changed', false); end if;
  if not p_held and not v_m.plan_hold and not v_m.hold_manual then return jsonb_build_object('held', false, 'changed', false); end if;
  update public.matches set plan_hold = p_held, hold_manual = p_held where id = p_match;
  perform private.audit(v_event, case when p_held then 'queue.hold_set' else 'queue.hold_released' end, p_match::text,
    jsonb_build_object('reason', nullif(v_reason, ''), 'before', jsonb_build_object('plan_hold', v_m.plan_hold, 'hold_manual', v_m.hold_manual)));
  return jsonb_build_object('held', p_held, 'changed', true);
end $$;
revoke execute on function public.set_match_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_match_hold(uuid, boolean, text) to authenticated;

-- Event day saves the planner's order and holds every time an organizer has it open. A deliberate hold is not the planner's to change.
create or replace function public.save_queue_plan(p_event uuid, p_order uuid[], p_hold uuid[] default '{}'::uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_changed integer := 0; v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer can plan the running order' using errcode = '42501'; end if;
  if coalesce(cardinality(p_order), 0) > 2000 or coalesce(cardinality(p_hold), 0) > 2000 then raise exception 'too many fights in one plan' using errcode = '22023'; end if;
  if private.event_closed(p_event) then return jsonb_build_object('changed', 0, 'status', 'closed'); end if;
  perform private.queue_lock(p_event);
  with target as (
    select m.id,
           (select o.ord::integer from unnest(coalesce(p_order, '{}')) with ordinality o(id, ord) where o.id = m.id limit 1) as new_order,
           (m.id = any (coalesce(p_hold, '{}')) or m.hold_manual) as new_hold
    from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and m.queue_state = 'scheduled' and k.status <> 'finished'
    for update of m skip locked
  )
  update public.matches m set plan_order = t.new_order, plan_hold = t.new_hold
  from target t where m.id = t.id and (m.plan_order is distinct from t.new_order or m.plan_hold is distinct from t.new_hold);
  get diagnostics v_n = row_count;
  v_changed := v_n;
  if v_changed > 0 then perform private.audit(p_event, 'queue.planned', p_event::text, jsonb_build_object('changed', v_changed, 'planned', coalesce(cardinality(p_order), 0), 'held', coalesce(cardinality(p_hold), 0))); end if;
  return jsonb_build_object('changed', v_changed);
end $$;
