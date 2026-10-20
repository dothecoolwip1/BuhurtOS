-- Event role race guards (adversarial audit, 2026-10-19), after 20261022000200_organizer_lineup. ADDITIVE: anchored patches and two private guards,
-- no rows rewritten (clocks, counters, seats, sessions and every in-flight fight are untouched; the rules apply from the next call).
--
--   1. set_match_queue: the Secretary / Scorekeeper starts the next called fight only when nothing else is on now on THAT field. Checked after the
--      event's queue lock, on a fresh read (two secretaries pressing "start" at once are serialized; the second one is refused). The fight must still
--      be on the secretary's board at that moment. Organizer, head marshal, marshal and the Event Admin tablet are unchanged.
--   2. save_field_lineup: the editable set was read BEFORE its rows were locked, so a fight opened on a Lyst, put on the clock or scored in between
--      could still be moved. Now: the field's Lyst lock (the one lyst_open and the clock trigger take before making a fight the field's current one)
--      is taken first, the rows are locked, and the editable set is read AGAIN; any difference answers 'stale' and changes nothing.
--      Every write that makes a fight non-editable (lyst_field_current, lyst_timer.match_id, lyst_rounds, lyst_counts, score_events, live scores,
--      discipline, proposals) carries a foreign key to the match, so while it is uncommitted it holds a key-share lock on the match row and the
--      lineup's NOWAIT lock fails ("try again"); once committed, the second read sees it. Writes that arrive after the lineup holds its locks wait for
--      it and then act on the saved order.
--      Lock order: queue lock -> lineup lock -> field Lyst lock -> match rows (NOWAIT). lyst_open and the clock trigger take the field Lyst lock and
--      never the queue or lineup locks; the lineup never waits on a match row; finalization takes the queue lock only at commit and never the field
--      Lyst lock. No wait cycle.
--   replace_match_entrant already locks its row before reading the Lyst / clock / history state, so it needs no change.
--   3. finalize_match (and so submit_match_result, lyst_finalize and every other ordinary path): a TEAM fight (the competition's category is a
--      buhurt-league category; the caller's detail is never consulted) that has Lyst rounds can only be finished with exactly the rounds won the Lyst
--      recorded: every Lyst round confirmed, the scores equal to the rounds each side won, the result the side with more, and the winner at the
--      competition's rounds to win; or, for an early finish, a disqualification of the losing side recorded through the marshal's call
--      (lyst_record_discipline, audited; the secretary may record it on the fight on now) with the rounds won still as recorded.
--      Anything else is refused (P0001) before anything is written. A team fight with no Lyst rounds is scored by hand
--      exactly as before. The deliberate, audited paths are unchanged: enter_official_result and resolve_result_conflict mark their own call
--      (bos.result_override, transaction-local, not settable through the API), and the withdrawal walkover cascade keeps its own mark.
--      Races: finalize_match holds the fight's row FOR UPDATE, then reads its Lyst rounds FOR SHARE. A confirm / correct / return / end in progress
--      holds the round row, so the read waits for it and sees its result; a NEW round (clock start, confirm of a round not yet started) inserts with a
--      foreign key to the fight and waits for the fight row. Neither of those writers waits on anything finalize_match holds first: no deadlock.
--   4. Clock, end, confirm / correct and return take the fight's row (FOR KEY SHARE) before their own locks and re-check that it is not final, so
--      nothing changes a final fight's Lyst rounds after finalize_match wins (see part 4 below for the lock order).

create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;   -- already patched (a re-run changes nothing)
  if position(p_from in v_def) = 0 then raise exception 'race guard patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;

-- ---------------------------------------------------------------- 1. the secretary starts a fight only on an idle field
select pg_temp.bos_patch('public.set_match_queue(uuid,text,text)'::regprocedure,
  $a$if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;$a$,
  $b$if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  -- race guard 20261023000100: re-checked under the queue lock on a fresh read
  if private.is_secretary_only(v_event) then
    if not private.match_on_secretary_board(p_match) then raise exception 'the secretary runs only the fight on now, on deck and in the hole' using errcode = '42501'; end if;
    if p_state = 'active' and exists (select 1 from public.matches x join public.competitions k on k.id = x.competition_id
               where k.event_id = v_event and private.field_key(x.field) = private.field_key(v_m.field) and x.queue_state = 'active' and x.id <> p_match) then
      raise exception 'another fight is on now on this Lyst: finish it before starting the next' using errcode = 'P0001'; end if;
  end if;$b$);

-- ---------------------------------------------------------------- 2. the lineup reads its editable set again after locking
select pg_temp.bos_patch('public.save_field_lineup(uuid,text,uuid[],jsonb)'::regprocedure,
  $a$perform pg_advisory_xact_lock(hashtextextended('bos:lineup:' || p_event::text || ':' || v_key, 0));$a$,
  $b$perform pg_advisory_xact_lock(hashtextextended('bos:lineup:' || p_event::text || ':' || v_key, 0));
  -- race guard 20261023000100: lyst_open and the clock trigger make a fight the field's current one under this lock
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-field:' || p_event::text || ':' || v_key, 0));$b$);
select pg_temp.bos_patch('public.save_field_lineup(uuid,text,uuid[],jsonb)'::regprocedure,
  $a$if cardinality(v_now) > 0 and not private.lock_matches_nowait(v_now) then raise exception 'someone else is changing these fights right now; try again' using errcode = '55P03'; end if;$a$,
  $b$if cardinality(v_now) > 0 and not private.lock_matches_nowait(v_now) then raise exception 'someone else is changing these fights right now; try again' using errcode = '55P03'; end if;
  -- race guard 20261023000100: what was editable before the locks must still be exactly what is editable now
  if v_now is distinct from (select coalesce(array_agg(x order by x), '{}') from private.lineup_editable(p_event, v_key) x) then
    return jsonb_build_object('status', 'stale', 'field', v_key,
      'fights', coalesce((select jsonb_agg(jsonb_build_object('match_id', m.id, 'version', m.version, 'queue_state', m.queue_state) order by m.id)
                          from public.matches m where m.id in (select private.lineup_editable(p_event, v_key))), '[]'::jsonb));
  end if;$b$);

-- ---------------------------------------------------------------- 3. a team fight's result agrees with its confirmed Lyst rounds
-- Called by finalize_match with the fight's row already locked.
create or replace function private.assert_team_rounds(p_match uuid, p_result text, p_score_a integer, p_score_b integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer; v_open integer; v_first_open integer; v_a integer; v_b integer; v_need integer; v_league text;
begin
  if coalesce(current_setting('bos.result_override', true), '') = 'on' or coalesce(current_setting('bos.withdrawal_cascade', true), '') = 'on' then return; end if;
  select c.league, coalesce(k.rounds_to_win, 2) into v_league, v_need
    from public.matches m join public.competitions k on k.id = m.competition_id join public.ref_categories c on c.code = k.category where m.id = p_match;
  if v_league is distinct from 'buhurt' then return; end if;
  perform 1 from public.lyst_rounds r where r.match_id = p_match for share;
  select count(*)::int, (count(*) filter (where r.status <> 'confirmed'))::int, min(r.round_no) filter (where r.status <> 'confirmed'),
         (count(*) filter (where r.status = 'confirmed' and r.awarded_a > r.awarded_b))::int, (count(*) filter (where r.status = 'confirmed' and r.awarded_b > r.awarded_a))::int
    into v_n, v_open, v_first_open, v_a, v_b
    from public.lyst_rounds r where r.match_id = p_match;
  if v_n = 0 then return; end if;   -- scored by hand: nothing recorded to agree with
  if v_open > 0 then
    raise exception 'round % of this team fight is not confirmed on the Lyst yet: confirm it before finishing the fight', v_first_open using errcode = 'P0001'; end if;
  if p_score_a is distinct from v_a or p_score_b is distinct from v_b then
    raise exception 'the Lyst recorded rounds won %-% for this team fight, not %-%: correct the round on the Lyst, or ask the head marshal or an organizer to enter the official result',
      v_a, v_b, p_score_a, p_score_b using errcode = 'P0001'; end if;
  -- an early finish by disqualification: the marshal's call (match_discipline, audited) is recorded against the losing side. The rounds won stay as
  -- recorded; the fight need not have reached its rounds to win, and the winner is the other side.
  if p_result in ('a', 'b') and exists (select 1 from public.match_discipline d where d.match_id = p_match and d.kind = 'dq' and d.voided_at is null
                                          and d.side = case p_result when 'a' then 'b' else 'a' end) then return; end if;
  if p_result is distinct from (case when v_a > v_b then 'a' when v_b > v_a then 'b' else 'draw' end) then
    raise exception 'the Lyst recorded rounds won %-% for this team fight, not %-%: correct the round on the Lyst, or ask the head marshal or an organizer to enter the official result',
      v_a, v_b, p_score_a, p_score_b using errcode = 'P0001'; end if;
  if greatest(v_a, v_b) < v_need then
    raise exception 'the Lyst recorded rounds won %-% and this team fight needs % to win: confirm the remaining rounds, or ask the head marshal or an organizer to enter the official result',
      v_a, v_b, v_need using errcode = 'P0001'; end if;
end $$;
revoke execute on function private.assert_team_rounds(uuid, text, integer, integer) from public, anon, authenticated;

select pg_temp.bos_patch('public.finalize_match(uuid,text,integer,integer,jsonb,integer)'::regprocedure,
  $a$if p_result = 'b' and p_score_b < p_score_a then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;$a$,
  $b$if p_result = 'b' and p_score_b < p_score_a then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;
  perform private.assert_team_rounds(p_match, p_result, p_score_a, p_score_b);   -- race guard 20261023000100$b$);
-- the deliberate, audited paths say so for their own finalize_match call only
select pg_temp.bos_patch('public.enter_official_result(uuid,text,integer,integer,jsonb,text)'::regprocedure,
  $a$v_version := public.finalize_match(p_match, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), (select version from public.matches where id = p_match));$a$,
  $b$perform set_config('bos.result_override', 'on', true);
  v_version := public.finalize_match(p_match, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), (select version from public.matches where id = p_match));
  perform set_config('bos.result_override', '', true);$b$);
select pg_temp.bos_patch('public.resolve_result_conflict(uuid,text,text)'::regprocedure,
  $a$perform public.finalize_match(v_p.match_id, v_p.result, v_p.score_a, v_p.score_b, v_p.detail, (select version from public.matches where id = v_p.match_id));$a$,
  $b$perform set_config('bos.result_override', 'on', true);
    perform public.finalize_match(v_p.match_id, v_p.result, v_p.score_a, v_p.score_b, v_p.detail, (select version from public.matches where id = v_p.match_id));
    perform set_config('bos.result_override', '', true);$b$);

-- ---------------------------------------------------------------- 4. no Lyst round changes once the fight is final
-- Every writer of lyst_rounds (clock, end, confirm / correct, return) checked "not final" BEFORE taking any lock, so a write could land on a fight
-- finalize_match had just made final. Now each takes the fight's row FOR KEY SHARE right after that first check and checks again. One order for all:
-- fight row -> Lyst advisory lock -> clock / round row. finalize_match: fight row FOR UPDATE -> its rounds FOR SHARE -> the clock (trigger). Whoever
-- holds the fight row first finishes before the other touches anything else, so neither can deadlock; a writer that waited sees the fight final and
-- changes nothing. A retried command already recorded is still answered before this point (confirm and return answer 'duplicate' as before).
-- KEY SHARE conflicts only with FOR UPDATE (finalize, reopen, the queue's row locks), never with other Lyst writers or counters.
create or replace function private.lyst_lock_live_match(p_match uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_state text;
begin
  select m.queue_state into v_state from public.matches m where m.id = p_match for key share;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  if v_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
end $$;
revoke execute on function private.lyst_lock_live_match(uuid) from public, anon, authenticated;

-- Opening an existing Lyst must also re-check under the lock, before rebinding counter phones to it.
select pg_temp.bos_patch('public.lyst_open(uuid,text)'::regprocedure,
  $a$v_m := private.lyst_match_check(v_event, p_match, null);$a$,
  $b$v_m := private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100$b$);

-- Hosted also has the press-time overload (p_pressed_at timestamptz). Patch the existing body in place, retaining press-time correction and grants.
do $$ declare r record; v_n integer := 0; begin
  for r in select p.oid::regprocedure fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lyst_timer_command' loop
    perform pg_temp.bos_patch(r.fn,
      $a$perform private.lyst_match_check(p_event, p_match, p_field);$a$,
      $b$perform private.lyst_match_check(p_event, p_match, p_field);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100$b$);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'race guard: no lyst_timer_command function'; end if;
end $$;
select pg_temp.bos_patch('public.lyst_end_round(uuid,integer)'::regprocedure,
  $a$perform private.lyst_match_check(v_event, p_match, null);$a$,
  $b$perform private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100$b$);
select pg_temp.bos_patch('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure,
  $a$perform private.lyst_match_check(v_event, p_match, null);$a$,
  $b$perform private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100$b$);
select pg_temp.bos_patch('public.lyst_return_round(uuid,uuid,integer,integer,text)'::regprocedure,
  $a$perform private.lyst_match_check(v_event, p_match, null);$a$,
  $b$perform private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100$b$);

-- A lost-ack retry may have read "no proposal" before the first caller committed, then waited on the match row. Serialize the command BEFORE
-- reading its proposal or locking a match, so every concurrent retry returns the stored answer rather than inserting the same primary key twice.
-- lyst_finalize delegates without holding a match/round lock; all ordinary submission paths share this order.
select pg_temp.bos_patch('public.submit_match_result(uuid,uuid,text,integer,integer,jsonb,integer,integer)'::regprocedure,
  $a$select * into v_prop from public.result_proposals where id = p_command;$a$,
  $b$perform pg_advisory_xact_lock(hashtextextended('bos:result-command:' || p_command::text, 0));
  select * into v_prop from public.result_proposals where id = p_command;$b$);
