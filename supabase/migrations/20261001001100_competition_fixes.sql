-- Competition fixes (additive; replaces functions from 20261001000400_matches_scoring.sql, no schema change):
--  1. finalize_match sends the loser of a semifinal to the competition's third_place match; reopen_match takes them back out.
--  2. set_match_queue: p_field = '' clears the field, null keeps it.
--  3. finalize_match: a null expected version is refused instead of skipping the version check.
--  4. reopen_match clears the stored per-round detail.
--
-- Third-place slot rule (deterministic, so reopen can undo it): among the elimination matches that feed the same final, ordered by
-- (position, id), the first one's loser goes to slot 'a' of the third_place match and the next one's loser to slot 'b'.

create or replace function public.set_match_queue(p_match uuid, p_state text, p_field text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if p_state not in ('scheduled', 'on_deck', 'in_the_hole', 'active') then raise exception 'use finalize_match to finish a match' using errcode = '22023'; end if;
  update public.matches set queue_state = p_state,
    field = case when p_field is null then field when btrim(p_field) = '' then null else p_field end
  where id = p_match and queue_state <> 'final';
  if not found then raise exception 'this match is already final' using errcode = 'P0001'; end if;
end $$;

create or replace function public.finalize_match(p_match uuid, p_result text, p_score_a int, p_score_b int, p_detail jsonb, p_expected_version int)
returns int language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_winner uuid; v_loser uuid; v_next public.matches; v_third public.matches; v_slot text;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  if p_expected_version is null then raise exception 'the version you opened is required, reload the match' using errcode = '22023'; end if;
  if v_m.version <> p_expected_version then raise exception 'this match changed since you opened it, reload and check it' using errcode = 'P0001'; end if;
  if v_m.entry_a is null or v_m.entry_b is null then raise exception 'both sides must be set before a result can be saved' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_result = 'draw' and v_m.stage not in ('pool', 'round_robin') then raise exception 'elimination matches cannot end in a draw' using errcode = '22023'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'scores must be zero or more' using errcode = '22023'; end if;
  if p_result = 'a' and p_score_a < p_score_b then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;
  if p_result = 'b' and p_score_b < p_score_a then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;

  v_winner := case p_result when 'a' then v_m.entry_a when 'b' then v_m.entry_b else null end;
  v_loser := case p_result when 'a' then v_m.entry_b when 'b' then v_m.entry_a else null end;

  -- Lock and check everything that will be touched before changing anything.
  if v_m.next_match_id is not null and (v_winner is not null or v_m.stage = 'elimination') then
    select * into v_next from public.matches where id = v_m.next_match_id for update;
    if v_winner is not null and v_next.queue_state = 'final' then raise exception 'the next match was already played; reopen it first' using errcode = 'P0001'; end if;
  end if;
  if v_m.stage = 'elimination' and v_loser is not null and v_next.id is not null and v_next.stage = 'final' then
    select * into v_third from public.matches where competition_id = v_m.competition_id and stage = 'third_place' order by position, id limit 1 for update;
    if found then
      if v_third.queue_state = 'final' then raise exception 'the third-place match was already played; reopen it first' using errcode = 'P0001'; end if;
      select case when count(*) = 0 then 'a' else 'b' end into v_slot from public.matches s
        where s.next_match_id = v_m.next_match_id and s.stage = 'elimination' and (s.position, s.id) < (v_m.position, v_m.id);
    end if;
  end if;

  update public.matches set result = p_result, winner_entry_id = v_winner, score_a = p_score_a, score_b = p_score_b, detail = coalesce(p_detail, '{}'::jsonb),
    queue_state = 'final', finalized_at = now(), version = version + 1 where id = p_match;

  if v_winner is not null and v_m.next_match_id is not null then
    if v_m.next_slot = 'a' then update public.matches set entry_a = v_winner where id = v_next.id; else update public.matches set entry_b = v_winner where id = v_next.id; end if;
  end if;
  if v_third.id is not null then
    if v_slot = 'a' then update public.matches set entry_a = v_loser where id = v_third.id; else update public.matches set entry_b = v_loser where id = v_third.id; end if;
  end if;
  perform private.audit(v_event, 'match.finalized', p_match::text, jsonb_build_object('result', p_result, 'a', p_score_a, 'b', p_score_b));
  return v_m.version + 1;
end $$;

create or replace function public.reopen_match(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_next public.matches; v_third public.matches; v_loser uuid; v_slot text;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.is_organizer(v_event) then raise exception 'only an organizer can reopen a result' using errcode = '42501'; end if;
  if v_m.queue_state <> 'final' then return; end if;
  if char_length(coalesce(p_reason, '')) < 3 then raise exception 'say why the result is being reopened' using errcode = '22023'; end if;
  v_loser := case v_m.result when 'a' then v_m.entry_b when 'b' then v_m.entry_a else null end;
  if v_m.next_match_id is not null then
    select * into v_next from public.matches where id = v_m.next_match_id for update;
    if v_next.queue_state = 'final' then raise exception 'the next match was already played; reopen that one first' using errcode = 'P0001'; end if;
    if v_m.stage = 'elimination' and v_loser is not null and v_next.stage = 'final' then
      select * into v_third from public.matches where competition_id = v_m.competition_id and stage = 'third_place' order by position, id limit 1 for update;
      if found then
        if v_third.queue_state = 'final' then raise exception 'the third-place match was already played; reopen that one first' using errcode = 'P0001'; end if;
        select case when count(*) = 0 then 'a' else 'b' end into v_slot from public.matches s
          where s.next_match_id = v_m.next_match_id and s.stage = 'elimination' and (s.position, s.id) < (v_m.position, v_m.id);
        if v_slot = 'a' and v_third.entry_a = v_loser then update public.matches set entry_a = null where id = v_third.id; end if;
        if v_slot = 'b' and v_third.entry_b = v_loser then update public.matches set entry_b = null where id = v_third.id; end if;
      end if;
    end if;
    if v_m.next_slot = 'a' and v_next.entry_a = v_m.winner_entry_id then update public.matches set entry_a = null where id = v_next.id; end if;
    if v_m.next_slot = 'b' and v_next.entry_b = v_m.winner_entry_id then update public.matches set entry_b = null where id = v_next.id; end if;
  end if;
  update public.matches set queue_state = 'scheduled', result = null, winner_entry_id = null, score_a = null, score_b = null, detail = '{}'::jsonb, finalized_at = null, version = version + 1 where id = p_match;
  perform private.audit(v_event, 'match.reopened', p_match::text, jsonb_build_object('reason', p_reason));
end $$;

revoke execute on function public.set_match_queue(uuid, text, text), public.finalize_match(uuid, text, int, int, jsonb, int), public.reopen_match(uuid, text) from public, anon;
grant execute on function public.set_match_queue(uuid, text, text), public.finalize_match(uuid, text, int, int, jsonb, int), public.reopen_match(uuid, text) to authenticated;
