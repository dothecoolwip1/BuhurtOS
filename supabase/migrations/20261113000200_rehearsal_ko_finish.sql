-- Seven-profile rehearsal fixes (2026-10-30, synthetic event "TEST New Domain Longsword Rehearsal 2026-10-30").
--   1. P1. Outrance Rules V.26.4 §14.11 (KO), §14.8 (Division 1 TKO), §14.2/§14.4/§11.4/§6.2/§5.2 (the other stoppages), §13.4/§14.10 (DQ): a
--      fight-ending call decides the fight whatever the score. A KO winner who was behind on points was refused by the generic
--      finalize_match guard "the winner cannot have the lower score". The guard now lets a lower-scored winner through ONLY when
--        (a) outrance_finish validated the stoppage and marked this match and this winner for its own finalize call (transaction-local
--            bos.outrance_stoppage, not settable through the API), or the audited head-marshal paths (bos.result_override) are finishing it, AND
--        (b) the database holds an active (not voided) fight-ending call or disqualification against the loser on this Outrance fight.
--      The real totals are kept as they are: nothing is reversed or faked. Every other result keeps the guard.
--   2. P2. §4, §14.11: once a fight-ending call is on record, the fight is over. The totals say next = 'stopped' (no extra round, no points
--      decision), the clock refuses to start a new round of that fight, and a points or head-marshal decision is refused until the call is voided.
--   3. A retried finish whose answer was lost is answered as the same result instead of "you cannot run this lyst" (secretary desks).
--   4. The counter phone state carries the competition's category, so a longsword phone can say "two hands" on its +2 pad (Duels §2.1.4).
--   5. The device heartbeat (event_sessions.last_seen_at) skips a row another request of the same phone holds, instead of queueing behind it.
-- In-flight: every change is in a function that reads the live calls and rounds, so fights already open on hosted (including any with a KO on
-- record and a stale "Start round 3" on a desk) get the new behaviour on their next read or command. No stored state needs a backfill.
-- Additive: one new private helper, one new key in the counter phone's state, and anchored patches (each refuses unless its anchor is found exactly once; safe to run twice).
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'rehearsal KO patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

-- the call that ended this Outrance fight, if any: the first active stoppage that ends the fight, or a disqualification (red card, no weapon / armour).
-- A Division 2 TKO for lack of defence (tko_round) loses the round only (§14.8) and does not end the fight.
create or replace function private.outrance_fight_ender(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'side', d.side, 'kind', d.kind, 'key', d.card_key, 'label', d.label, 'round', d.round_no)
    from public.match_discipline d
   where d.match_id = p_match and d.voided_at is null and private.outrance_is(p_match)
     and (d.kind = 'dq' or (d.kind = 'stoppage' and d.card_key in ('ko', 'tko', 'tko_equipment', 'tko_stalling', 'tko_corner', 'yield', 'medical')))
   order by d.created_at, d.id limit 1
$$;
revoke execute on function private.outrance_fight_ender(uuid) from public, anon, authenticated;

-- 1. the score guard: a validated stoppage winner may be behind on points
select pg_temp.bos_patch('public.finalize_match(uuid,text,integer,integer,jsonb,integer)'::regprocedure,
  $a$  if p_result = 'a' and p_score_a < p_score_b then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;
  if p_result = 'b' and p_score_b < p_score_a then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;$a$,
  $b$  if p_result in ('a', 'b') and (case when p_result = 'a' then p_score_a < p_score_b else p_score_b < p_score_a end)
     and not (   (coalesce(current_setting('bos.outrance_stoppage', true), '') = p_match::text || ':' || p_result
                  or coalesce(current_setting('bos.result_override', true), '') = 'on')
             and exists (select 1 from public.match_discipline d
                          where d.match_id = p_match and d.voided_at is null and private.outrance_is(p_match)
                            and d.side = case when p_result = 'a' then 'b' else 'a' end
                            and (d.kind = 'dq' or (d.kind = 'stoppage' and d.card_key in ('ko', 'tko', 'tko_equipment', 'tko_stalling', 'tko_corner', 'yield', 'medical'))))) then
    raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;   -- stoppage winner 20261113000200$b$);

-- outrance_finish marks its own validated stoppage for its own finalize call only, and clears the mark straight after
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$  v_out := public.submit_match_result(p_command, p_match, p_result, greatest(0, round((v_tot ->> 'a')::int / 60.0)::int), greatest(0, round((v_tot ->> 'b')::int / 60.0)::int), v_detail, p_expected_version);$a$,
  $b$  if p_basis not in ('decision', 'head_marshal') then perform set_config('bos.outrance_stoppage', p_match::text || ':' || p_result, true); end if;
  v_out := public.submit_match_result(p_command, p_match, p_result, greatest(0, round((v_tot ->> 'a')::int / 60.0)::int), greatest(0, round((v_tot ->> 'b')::int / 60.0)::int), v_detail, p_expected_version);
  perform set_config('bos.outrance_stoppage', '', true);$b$);

-- 2a. a fight ended by a call is not decided on points, and the head marshal does not decide a level fight that a call already ended
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$  if p_basis in ('decision', 'head_marshal') then
    if (v_tot ->> 'open')::int > 0 then$a$,
  $b$  if p_basis in ('decision', 'head_marshal') then
    if (v_tot ->> 'next') = 'stopped' then
      raise exception 'this fight was ended by % against %: finish it by that call, or void the call first', v_tot -> 'ended_by' ->> 'label', private.lyst_side_name(case when v_tot -> 'ended_by' ->> 'side' = 'a' then v_m.entry_a else v_m.entry_b end) using errcode = 'P0001'; end if;
    if (v_tot ->> 'open')::int > 0 then$b$);
-- (v_m is read before the totals in outrance_finish; the anchor above sits after both)

-- 2b. what comes next: 'stopped' once a fight-ending call is on record (§14.11, §14.8, §13.4)
select pg_temp.bos_patch('private.outrance_totals(uuid)'::regprocedure,
  $a$  v_next := case when v_t is null then null when v_open > 0 then 'confirm'$a$,
  $b$  v_next := case when v_t is null then null when private.outrance_fight_ender(p_match) is not null then 'stopped' when v_open > 0 then 'confirm'$b$);
select pg_temp.bos_patch('private.outrance_totals(uuid)'::regprocedure,
  $a$'leader', case when v_ua > v_ub then 'a' when v_ub > v_ua then 'b' end, 'next', v_next);$a$,
  $b$'leader', case when v_ua > v_ub then 'a' when v_ub > v_ua then 'b' end, 'next', v_next, 'ended_by', private.outrance_fight_ender(p_match));$b$);

-- 2c. the clock: a stale desk cannot start a new round of a fight a call has ended (re-starting the same round's clock is unchanged)
select pg_temp.bos_patch('public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,timestamp with time zone)'::regprocedure,
  $a$      if found and v_r.status = 'confirmed' then raise exception 'round % is already confirmed: start the next round, or correct that round', v_round using errcode = 'P0001'; end if;$a$,
  $b$      if found and v_r.status = 'confirmed' then raise exception 'round % is already confirmed: start the next round, or correct that round', v_round using errcode = 'P0001'; end if;
      if not found and private.outrance_fight_ender(p_match) is not null then
        raise exception 'this fight was ended by %: finish the fight instead of starting round %, or void the call first', private.outrance_fight_ender(p_match) ->> 'label', v_round using errcode = 'P0001'; end if;$b$);

-- 3. a retried finish whose answer was lost: the secretary's fight leaves the secretary board once it is final, so the retry was refused
--    "you cannot run this lyst" before it could be recognised as the same command. The repeat is answered first (submit_match_result checks the
--    command is the caller's own and changes nothing).
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$  if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if exists (select 1 from public.result_proposals where id = p_command) then
    return public.submit_match_result(p_command, p_match, p_result, 0, 0, '{}'::jsonb, coalesce(p_expected_version, 0));
  end if;$a$,
  $b$  if private.can_score(v_event) and exists (select 1 from public.result_proposals where id = p_command and match_id = p_match) then   -- a repeat, answered first
    return public.submit_match_result(p_command, p_match, p_result, 0, 0, '{}'::jsonb, coalesce(p_expected_version, 0));
  end if;
  if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if exists (select 1 from public.result_proposals where id = p_command) then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;$b$);

-- 4. the counter phone's +2 / +1 pads name the zones, and on a longsword duel the two-hands rule (Duels Rules V.26.4 §2.1.4): the phone is told the category
select pg_temp.bos_patch('private.counter_state_for(uuid,boolean)'::regprocedure,
  $a$'counter_input', coalesce(v_input, 'simple'), 'per_side'$a$,
  $b$'counter_input', coalesce(v_input, 'simple'), 'category', (select k.category from public.competitions k where k.id = v_m.competition_id), 'per_side'$b$);

-- 5. the device heartbeat never waits for a lock. Hosted logs 2026-10-30 19:20-19:56: counter_state and device_whoami queued 1-4 s behind each other on
--    "update public.event_sessions set last_seen_at" (ShareLock waits, then statement timeouts) when a phone's reads overlapped. The heartbeat is a
--    30-second "still here" mark: when another request of the same device holds the row it is skipped this time (the next read sets it).
select pg_temp.bos_patch('private.counter_state_for(uuid,boolean)'::regprocedure,
  $a$update public.event_sessions set last_seen_at = clock_timestamp() where id = v_sid and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds');$a$,
  $b$update public.event_sessions set last_seen_at = clock_timestamp() where id = (select x.id from public.event_sessions x where x.id = v_sid and (x.last_seen_at is null or x.last_seen_at < clock_timestamp() - interval '30 seconds') for update skip locked);$b$);
select pg_temp.bos_patch('public.device_whoami()'::regprocedure,
  $a$update public.event_sessions set last_seen_at = clock_timestamp() where id = d.session_id and (last_seen_at is null or last_seen_at < clock_timestamp() - interval '30 seconds');$a$,
  $b$update public.event_sessions set last_seen_at = clock_timestamp() where id = (select x.id from public.event_sessions x where x.id = d.session_id and (x.last_seen_at is null or x.last_seen_at < clock_timestamp() - interval '30 seconds') for update skip locked);$b$);

reset check_function_bodies;
