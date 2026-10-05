-- Pack 09A (2026-10-04): the field queue becomes operational for event day.
--   * matches.queue_order: the organizer's manual running order inside one field's line (the one new column).
--   * One rule for "who is next" on a field (private.queue_ordered), one for "can this match run" (private.match_runnable).
--   * Automatic advancement: when a match that held a place in the live queue becomes final, the field's queue is settled in the same transaction.
--   * public.advance_field_queue: "start the next match" / "fill the queue" for anyone who can score the event.
--   * public.move_match_in_queue: run sooner / later / skip for organizers.
--   * set_match_queue keeps its behaviour, now serialized with the above and clearing the manual order when a match is called.
-- Additive: no result, entry, bracket link, schedule time or permission is changed. Queue changes never bump matches.version.
--
-- Locking, in one place: every function that changes the queue takes ONE advisory transaction lock per event first (private.queue_lock). While
-- holding it, a function never waits for a row lock: it asks for the rows it needs with FOR UPDATE SKIP LOCKED and either skips them (settling is
-- convergent, the next settle finishes the job) or refuses with "try again". A scorekeeper finalizing a match holds that match's row lock and meets the
-- advisory lock only at commit, so the two sides can never wait for each other.

alter table public.matches add column if not exists queue_order integer;
comment on column public.matches.queue_order is 'Manual running order among a field''s waiting matches (lower runs sooner). Written only by public.move_match_in_queue; null means "in schedule order".';
-- No column grant on purpose: clients cannot write queue_order directly.

-- ---------------------------------------------------------------- small rules
-- A field is its name, trimmed and case-insensitive; a blank field is Field 1 (the product default, never written to rows just to show it).
create or replace function private.field_key(p_field text) returns text
language sql immutable set search_path = '' as $$ select lower(coalesce(nullif(btrim(p_field), ''), 'Field 1')) $$;

create or replace function private.stage_rank(p_stage text) returns integer
language sql immutable set search_path = '' as $$
  select case p_stage when 'pool' then 0 when 'round_robin' then 0 when 'elimination' then 1 when 'third_place' then 2 when 'final' then 3 else 4 end $$;

-- Pool rounds by their number; elimination rounds earliest first ("Round of 16" before Quarterfinal before Semifinal). Mirrors src/lib/eventDay.ts.
create or replace function private.round_rank(p_stage text, p_label text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_stage in ('pool', 'round_robin') then coalesce(nullif(substring(p_label from '(\d+)'), '')::integer, 0)
    when p_label ~ '^Round of \d+$' then -substring(p_label from '^Round of (\d+)$')::integer
    when p_label = 'Quarterfinal' then -8
    when p_label = 'Semifinal' then -4
    else 0 end $$;

-- Both sides set and neither entry withdrawn or disqualified. Anything else is never promoted automatically.
create or replace function private.match_runnable(p_match public.matches) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_match.entry_a is not null and p_match.entry_b is not null
     and not exists (select 1 from public.entries e where e.id in (p_match.entry_a, p_match.entry_b) and e.status in ('withdrawn', 'disqualified')) $$;

create or replace function private.queue_lock(p_event uuid) returns void
language sql set search_path = '' as $$ select pg_advisory_xact_lock(hashtextextended('bos:queue:' || p_event::text, 0)) $$;

-- Lock every given match row without waiting. True only when all of them were locked.
create or replace function private.lock_matches_nowait(p_ids uuid[]) returns boolean
language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  select count(*) into v_n from (select id from public.matches where id = any (p_ids) order by id for update skip locked) s;
  return v_n = coalesce(array_length(p_ids, 1), 0);
end $$;

-- The runnable, non-final matches of one field in running order: on deck, then in the hole, then the waiting line. The waiting line is ordered by
--   manual order (nulls last), scheduled time (nulls last), competition order, competition, stage, round, pool, position, id.
-- The caller picks which of the three groups it wants through p_states. Active matches are not part of the line.
create or replace function private.queue_ordered(p_event uuid, p_key text, p_states text[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from public.matches m join public.competitions k on k.id = m.competition_id
  where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = any (p_states) and m.queue_state in ('scheduled', 'on_deck', 'in_the_hole')
    and private.match_runnable(m)
  order by case m.queue_state when 'on_deck' then 0 when 'in_the_hole' then 1 else 2 end,
           m.queue_order nulls last, m.scheduled_at nulls last, k.sort, k.id, private.stage_rank(m.stage), private.round_rank(m.stage, m.round_label),
           coalesce(m.pool, '') collate "C", m.position, m.id $$;

-- Promote the first runnable match of p_from (in running order) to p_to, trying the next one when another transaction holds a row (for example a result
-- being saved at this very moment). Returns the match promoted, or null.
create or replace function private.promote_one(p_event uuid, p_key text, p_from text[], p_to text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select x as id from private.queue_ordered(p_event, p_key, p_from) x limit 6 loop
    if private.lock_matches_nowait(array[r.id]) then
      update public.matches set queue_state = p_to, queue_order = null where id = r.id and queue_state = any (p_from);
      if found then return r.id; end if;
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------- settle a field's queue
-- Fills the gaps from the top and never demotes a runnable match, so running it twice changes nothing:
--   no active match and p_start  -> the first runnable of (on deck, in the hole, waiting) becomes active
--   no on-deck match             -> the first runnable of (in the hole, waiting) goes on deck
--   no in-the-hole match         -> the first runnable waiting match goes in the hole
-- An on-deck or in-the-hole match that can no longer run (a side replaced, an entrant withdrawn) goes back to the line; an unrunnable ACTIVE match is left alone.
-- Rows another transaction holds are skipped, not waited for.
create or replace function private.settle_field_queue(p_event uuid, p_key text, p_start boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_promoted jsonb := '[]'::jsonb; v_demoted jsonb := '[]'::jsonb; v_id uuid; r record; v_has boolean;
begin
  for r in
    select m.id from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state in ('on_deck', 'in_the_hole') and not private.match_runnable(m) order by m.id
  loop
    if private.lock_matches_nowait(array[r.id]) then
      update public.matches set queue_state = 'scheduled' where id = r.id and queue_state in ('on_deck', 'in_the_hole');
      v_demoted := v_demoted || to_jsonb(r.id);
    end if;
  end loop;

  select exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id
                 where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = 'active') into v_has;
  if p_start and not v_has then
    v_id := private.promote_one(p_event, p_key, array['on_deck', 'in_the_hole', 'scheduled'], 'active');
    if v_id is not null then v_promoted := v_promoted || jsonb_build_object('match', v_id, 'to', 'active'); end if;
  end if;

  select exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id
                 where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = 'on_deck') into v_has;
  if not v_has then
    v_id := private.promote_one(p_event, p_key, array['in_the_hole', 'scheduled'], 'on_deck');
    if v_id is not null then v_promoted := v_promoted || jsonb_build_object('match', v_id, 'to', 'on_deck'); end if;
  end if;

  select exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id
                 where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = 'in_the_hole') into v_has;
  if not v_has then
    v_id := private.promote_one(p_event, p_key, array['scheduled'], 'in_the_hole');
    if v_id is not null then v_promoted := v_promoted || jsonb_build_object('match', v_id, 'to', 'in_the_hole'); end if;
  end if;

  return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end $$;

-- ---------------------------------------------------------------- automatic advancement after a result
-- Runs at COMMIT of the transaction that made a live match final, so it sees everything finalize_match did (the bracket successor already has its
-- entrant). Same transaction: the result and the queue move together or not at all. A problem here is written to the audit trail and NEVER
-- rolls back or blocks the result. Only a match that held a place in the live queue triggers it; `start` is true when it was the ACTIVE one.
create or replace function private.advance_after_final() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_res jsonb;
begin
  begin
    select k.event_id into v_event from public.competitions k where k.id = new.competition_id;
    perform private.queue_lock(v_event);
    v_res := private.settle_field_queue(v_event, private.field_key(new.field), old.queue_state = 'active');
    if v_res <> '{"promoted": [], "demoted": []}'::jsonb then
      perform private.audit(v_event, 'queue.advanced', new.id::text, v_res || jsonb_build_object('field', private.field_key(new.field), 'after', 'result'));
    end if;
  exception when others then
    begin perform private.audit(v_event, 'queue.advance_failed', new.id::text, jsonb_build_object('error', sqlerrm)); exception when others then null; end;
    raise warning 'queue advance failed for match %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.advance_after_final() from public, anon, authenticated;

do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_advance_queue' and tgrelid = 'public.matches'::regclass) then
    create constraint trigger matches_advance_queue after update of queue_state on public.matches
      deferrable initially deferred for each row
      when (old.queue_state in ('active', 'on_deck', 'in_the_hole') and new.queue_state = 'final')
      execute function private.advance_after_final();
  end if;
end $do$;

-- ---------------------------------------------------------------- start the next match / fill the queue
create or replace function public.advance_field_queue(p_event uuid, p_field text default null, p_start boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.can_score(p_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  perform private.queue_lock(p_event);
  v_res := private.settle_field_queue(p_event, private.field_key(p_field), coalesce(p_start, true));
  if v_res <> '{"promoted": [], "demoted": []}'::jsonb then
    perform private.audit(p_event, 'queue.advanced', private.field_key(p_field), v_res || jsonb_build_object('field', private.field_key(p_field), 'after', 'request'));
  end if;
  return v_res;
end $$;

-- ---------------------------------------------------------------- run sooner / later / skip
-- Works on the field's line: on deck, in the hole, then waiting matches. A move swaps places; the places keep their roles, so moving the match on deck
-- one place later puts it in the hole and brings the one from the hole on deck. The waiting matches are then numbered 1..n so the order is explicit.
--   first: make it the next match   earlier / later: one place   skip: same as later, "not yet"
-- An active match cannot be moved, and a match that cannot run yet (waiting on an earlier result) has no place in the line.
create or replace function public.move_match_in_queue(p_match uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid; v_m public.matches; v_key text; v_ids uuid[]; v_roles text[]; v_new uuid[]; v_n integer; v_i integer; v_pos integer; v_scheduled integer := 0; v_tmp uuid; v_role text;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can change the running order' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('first', 'earlier', 'later', 'skip') then raise exception 'unknown action' using errcode = '22023'; end if;
  perform private.queue_lock(v_event);

  select * into v_m from public.matches where id = p_match;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  if v_m.queue_state = 'active' then raise exception 'this match is being fought; finish it or send it back to scheduled first' using errcode = 'P0001'; end if;
  if not private.match_runnable(v_m) then raise exception 'this match is waiting on earlier results and has no place in the line yet' using errcode = 'P0001'; end if;
  v_key := private.field_key(v_m.field);

  select array_agg(o.id order by o.ord), array_agg(m.queue_state order by o.ord) into v_ids, v_roles
  from private.queue_ordered(v_event, v_key, array['on_deck', 'in_the_hole', 'scheduled']) with ordinality as o(id, ord) join public.matches m on m.id = o.id;
  v_n := coalesce(array_length(v_ids, 1), 0);
  v_i := array_position(v_ids, p_match);
  if v_i is null then raise exception 'this match is not in the line' using errcode = 'P0001'; end if;

  v_new := v_ids;
  if p_action = 'first' then
    v_new := p_match || array_remove(v_ids, p_match);
  elsif p_action = 'earlier' and v_i > 1 then
    v_tmp := v_new[v_i - 1]; v_new[v_i - 1] := v_new[v_i]; v_new[v_i] := v_tmp;
  elsif p_action in ('later', 'skip') and v_i < v_n then
    v_tmp := v_new[v_i + 1]; v_new[v_i + 1] := v_new[v_i]; v_new[v_i] := v_tmp;
  end if;
  if v_new = v_ids then return jsonb_build_object('changed', false, 'order', to_jsonb(v_ids)); end if;

  if not private.lock_matches_nowait(v_new) then raise exception 'someone else is changing these matches right now; try again' using errcode = '55P03'; end if;
  for v_pos in 1..v_n loop
    v_role := v_roles[v_pos];
    if v_role = 'scheduled' then v_scheduled := v_scheduled + 1; end if;
    update public.matches set queue_state = v_role, queue_order = case when v_role = 'scheduled' then v_scheduled else null end
    where id = v_new[v_pos] and queue_state in ('scheduled', 'on_deck', 'in_the_hole');
  end loop;
  perform private.audit(v_event, 'queue.reordered', p_match::text, jsonb_build_object('action', p_action, 'field', v_key, 'order', to_jsonb(v_new)));
  return jsonb_build_object('changed', true, 'order', to_jsonb(v_new));
end $$;

-- ---------------------------------------------------------------- set_match_queue: same behaviour, serialized with the rest
-- Changes from the previous definition: the event lock, a "try again" instead of waiting on a row another transaction holds, and a called
-- match (anything but 'scheduled') forgets its manual order.
create or replace function public.set_match_queue(p_match uuid, p_state text, p_field text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if p_state not in ('scheduled', 'on_deck', 'in_the_hole', 'active') then raise exception 'use finalize_match to finish a match' using errcode = '22023'; end if;
  perform private.queue_lock(v_event);
  if not private.lock_matches_nowait(array[p_match]) then raise exception 'someone else is changing this match right now; try again' using errcode = '55P03'; end if;
  update public.matches set queue_state = p_state,
    queue_order = case when p_state = 'scheduled' then queue_order else null end,
    field = case when p_field is null then field when btrim(p_field) = '' then null else p_field end
  where id = p_match and queue_state <> 'final';
  if not found then raise exception 'this match is already final' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------- privileges
revoke execute on function private.field_key(text), private.stage_rank(text), private.round_rank(text, text), private.match_runnable(public.matches),
  private.queue_lock(uuid), private.lock_matches_nowait(uuid[]), private.queue_ordered(uuid, text, text[]), private.promote_one(uuid, text, text[], text),
  private.settle_field_queue(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.advance_field_queue(uuid, text, boolean), public.move_match_in_queue(uuid, text) from public, anon;
grant execute on function public.advance_field_queue(uuid, text, boolean), public.move_match_in_queue(uuid, text) to authenticated;
