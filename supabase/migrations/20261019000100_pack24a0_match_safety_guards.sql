-- Pack 24A0: match safety guards. Additive. Found by the Pack 23R Rumble rehearsal (docs/claude-packs/PACK_23R_RUMBLE_REHEARSAL.md).
-- Reconciled with Pack 18.1 and Pack 22 (docs/claude-packs/PACK_24A0_MATCH_SAFETY_GUARDS.md, section 0). First written as 20261015000100, a version
-- that Pack 18.1 took on main; renumbered to 20261019000100, after every migration on main (the last is Pack 22's 20261018001000).
--
--   1. A draw can no longer be replaced over a fight that has started or has history (build_schedule 'replace'). One definition of "protected
--      history", private.match_history_reason, is used by the check, by the entrant guard (7) and by the tests.
--   2. build_schedule validates the shape of the bracket it is given (no unfed slot, no two feeders into one slot, no self-link, no collision with a
--      side that is already filled), so a plan cannot leave a downstream match with a missing feeder.
--   3. The organizer's raw table rights on public.matches shrink to the three schedule columns (scheduled_at, field, duration_minutes). INSERT, DELETE and
--      every structural column (entry_a, entry_b, next_match_id, next_slot, position, stage, round_label, pool) are no longer writable through the table
--      API; no screen used them. Schedule edits are audited (match.schedule_changed).
--   4. set_match_queue: who may call it is unchanged (private.can_score, the Pack 18.1 matrix); every change is now audited (queue.state_set).
--   5. Holds: set_match_hold (private.can_adjust_queue, Pack 18.1: organizer, Secretary / Scorekeeper, Event Admin) makes a hold deliberate; save_queue_plan (what Event day saves on every open) never clears a deliberate
--      hold. save_queue_plan is PATCHED in place, not replaced, so Pack 18.1's can_adjust_queue check in it stays exactly as it is.
--   6. (Pack 22) a discipline review lodged about a fight protects it (discipline_reviews.match_id is ON DELETE RESTRICT).
--   7. An entrant who is in a protected fight cannot be deleted or re-pointed (competition, fighter, team) through the table API: matches.entry_a/b are
--      ON DELETE SET NULL, so that write would silently blank a side of a fight that has been fought. Withdrawal (withdraw_entry) is unchanged.
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
    when exists (select 1 from public.discipline_reviews v where v.match_id = m.id) then 'a discipline review was lodged about it'
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

-- ---------------------------------------------------------------- 3. set_match_queue: audited
-- Who may call it is unchanged (private.can_score, as on main: the Pack 18.1 permission matrix gives "call fight" to every scoring role, marshals
-- included). Narrowing it, as the first Pack 24A0 draft did, is left to an owner decision. What it gains: every change is on the audit trail
-- (queue.state_set: from, to, field before and after, the caller's role), and a field changed here is audited once, by this function, not again by the
-- schedule trigger. A call that changes nothing writes no audit row. The write itself is exactly the one main makes.
create or replace function public.set_match_queue(p_match uuid, p_state text, p_field text default null::text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_field text;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if p_state not in ('scheduled', 'on_deck', 'in_the_hole', 'active') then raise exception 'use finalize_match to finish a match' using errcode = '22023'; end if;
  perform private.queue_lock(v_event);
  if not private.lock_matches_nowait(array[p_match]) then raise exception 'someone else is changing this match right now; try again' using errcode = '55P03'; end if;
  select * into v_m from public.matches where id = p_match;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  v_field := case when p_field is null then v_m.field when btrim(p_field) = '' then null else p_field end;
  perform set_config('bos.queue_audited', 'on', true);
  update public.matches set queue_state = p_state,
    queue_order = case when p_state = 'scheduled' then queue_order else null end,
    field = v_field
  where id = p_match and queue_state <> 'final';
  if not found then raise exception 'this match is already final' using errcode = 'P0001'; end if;   -- checked before PERFORM resets FOUND
  perform set_config('bos.queue_audited', '', true);
  if v_m.queue_state is distinct from p_state or v_m.field is distinct from v_field then
    perform private.audit(v_event, 'queue.state_set', p_match::text, jsonb_build_object('from', v_m.queue_state, 'to', p_state, 'field_from', v_m.field,
      'field_to', v_field, 'by', private.actor_role(v_event)));
  end if;
end $$;

-- ---------------------------------------------------------------- 4. holds
create or replace function public.set_match_hold(p_match uuid, p_held boolean, p_reason text default null::text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_adjust_queue(v_event) then raise exception 'only an organizer or the secretary can hold or release a fight' using errcode = '42501'; end if;
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

-- Event day saves the planner's order and holds every time it is open. A deliberate hold is not the planner's to change. Patched in place with an
-- anchor (the Pack 18.1 technique) so the rest of the function, including Pack 18.1's can_adjust_queue check, is kept exactly as it is.
create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack24a0 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;
select pg_temp.bos_patch('public.save_queue_plan(uuid,uuid[],uuid[])'::regprocedure,
  $a$(m.id = any (coalesce(p_hold, '{}'))) as new_hold$a$,
  $b$(m.id = any (coalesce(p_hold, '{}')) or m.hold_manual) as new_hold$b$);

-- ---------------------------------------------------------------- 5. entrants of a protected fight
-- matches.entry_a / entry_b reference entries ON DELETE SET NULL, and an organizer may still write entries through the table API (no screen deletes or
-- re-points one; withdrawal is the withdraw_entry RPC). Deleting an entrant, or pointing it at another competition, fighter or team, would blank or
-- rewrite a side of a fight that has been fought. Refused while that entrant is in a fight with protected history (private.match_history_reason).
-- The sanctioned server paths are unaffected: functions that unlock (private.unlocked), team merges (bos.merging) and non-client sessions.
create or replace function private.entries_history_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_why text;
begin
  if not private.is_client_session() or private.unlocked() or coalesce(current_setting('bos.merging', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (new.competition_id, new.fighter_id, new.team_id) is not distinct from (old.competition_id, old.fighter_id, old.team_id) then
    return new;
  end if;
  select r into v_why from (select private.match_history_reason(m.id) as r from public.matches m where m.entry_a = old.id or m.entry_b = old.id) x
    where r is not null limit 1;
  if v_why is not null then
    raise exception 'This entrant is in a fight that has started or has history (%), so the entry is part of the record and cannot be %. Withdraw the entrant instead.',
      v_why, case when tg_op = 'DELETE' then 'removed' else 'moved to another competition, fighter or team' end using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function private.entries_history_guard() from public, anon, authenticated;
drop trigger if exists entries_history_guard on public.entries;
create trigger entries_history_guard before update or delete on public.entries for each row execute function private.entries_history_guard();
