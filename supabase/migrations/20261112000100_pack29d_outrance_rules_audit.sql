-- Pack 29d: Outrance fixes from the rules audit against Outrance Rules and Regulations 26.4 (2026-10-29).
--   1. §15.4.2: a fight saved as a draw is always a draw type (unanimous / majority / split draw), never "split decision".
--   2. §15.4.2: a line marshal is one marshal however their sheets arrive (a new phone, or paper): sheets are grouped by the marshal's name.
--      A paper sheet cannot reuse the name of another sheet already in that round.
--   3. §14.8: in Division 2 a TKO for lack of defence loses the round and "All TKO's must be checked by Medic to verify they can continue to
--      fight": the medic check is created at the call (the tablet will not start the next round until it is cleared); voiding the call
--      clears it; the finish does not create it twice.
--   4. §14.2, §14.4, §14.10: a TKO for armour or weapon failure also needs the equipment fixed before the next match.
--   5. §16.3: a competitor appeals at the end of the fight, before leaving the list: the tablet may record it for 5 minutes after the result.
-- Additive: anchored patches of the Pack 29 functions (each refuses unless its anchor is found exactly once) and one new column.
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'Pack 29d patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

-- 1. draws are draw types
create or replace function private.outrance_win_type(p_results text[], p_winner text) returns text
language plpgsql immutable set search_path = '' as $$
declare n integer := coalesce(array_length(p_results, 1), 0); mine integer; theirs integer; d integer;
begin
  if n = 0 then return null; end if;
  if p_winner = 'draw' then
    select count(*) filter (where x = 'draw') into d from unnest(p_results) x;
    return case when d = n then 'unanimous_draw' when d * 2 > n then 'majority_draw' else 'split_draw' end;
  end if;
  if p_winner is null or p_winner not in ('a', 'b') then return private.outrance_win_type(p_results); end if;
  select count(*) filter (where x = p_winner), count(*) filter (where x = case when p_winner = 'a' then 'b' else 'a' end) into mine, theirs from unnest(p_results) x;
  return case when mine = n then 'unanimous_decision' when theirs = 0 then 'majority_decision' else 'split_decision' end;
end $$;
revoke execute on function private.outrance_win_type(text[], text) from public, anon, authenticated;
select pg_temp.bos_patch('private.outrance_totals(uuid)'::regprocedure,
  $a$when v_ub > v_ua then 'b' end), 'leader'$a$, $a$when v_ub > v_ua then 'b' else 'draw' end), 'leader'$a$);
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$jsonb_array_elements(v_tot -> 'marshals') e), nullif(p_result, 'draw'));$a$, $a$jsonb_array_elements(v_tot -> 'marshals') e), p_result);$a$);

-- 2. one marshal, one result: grouped by name (confirmed rounds keep their frozen sheets, so the totals read the name from each sheet)
select pg_temp.bos_patch('private.outrance_sheet_json(public.outrance_sheets,jsonb)'::regprocedure,
  $a$'marshal', coalesce(s.seat_id::text, 'paper:' || lower(btrim(s.operator_name)))$a$,
  $a$'marshal', coalesce(nullif(lower(btrim(s.operator_name)), ''), s.seat_id::text)$a$);
select pg_temp.bos_patch('private.outrance_totals(uuid)'::regprocedure,
  $a$coalesce(e ->> 'marshal', e ->> 'seat_id') as seat_id$a$,
  $a$coalesce(nullif(lower(btrim(e ->> 'operator')), ''), e ->> 'marshal', e ->> 'seat_id') as seat_id$a$);
select pg_temp.bos_patch('public.outrance_enter_sheet(uuid,uuid,integer,text,jsonb,jsonb,uuid,text)'::regprocedure,
  $a$where match_id = p_match and round_no = p_round and source = 'paper' and superseded_at is null and lower(btrim(operator_name)) = lower(v_name)) then
    raise exception '% already has a paper sheet for round %: replace it instead', v_name, p_round$a$,
  $a$where match_id = p_match and round_no = p_round and superseded_at is null and lower(btrim(operator_name)) = lower(v_name)) then
    raise exception '% already has a sheet for round %: a paper sheet replaces only a paper sheet (Fix)', v_name, p_round$a$);

-- 3. Division 2 TKO: the medic check before the next round
alter table public.outrance_holds add column if not exists discipline_id uuid;
select pg_temp.bos_patch('public.outrance_call(uuid,uuid,integer,text,text,text,text)'::regprocedure,
  $a$  perform private.audit(v_event, 'outrance.call', p_match::text,$a$,
  $a$  if v_key = 'tko_round' then   -- §14.8: the round is lost and the medic checks the fighter before the next round
    insert into public.outrance_holds (event_id, competition_id, entry_id, match_id, kind, discipline_id)
    select v_event, m.competition_id, case when p_side = 'a' then m.entry_a else m.entry_b end, p_match, 'medic_check', p_command
      from public.matches m where m.id = p_match and (case when p_side = 'a' then m.entry_a else m.entry_b end) is not null;
  end if;
  perform private.audit(v_event, 'outrance.call', p_match::text,$a$);
select pg_temp.bos_patch('private.outrance_void_cascade()'::regprocedure,
  $a$    update public.match_discipline set voided_at = now() where related_id = new.id and voided_at is null and card_key in ('yellow', 'red');$a$,
  $a$    update public.match_discipline set voided_at = now() where related_id = new.id and voided_at is null and card_key in ('yellow', 'red');
    update public.outrance_holds set cleared_at = clock_timestamp(), cleared_by = auth.uid(), cleared_reason = 'the call it came from was voided'
     where discipline_id = new.id and cleared_at is null;$a$);
-- 4. what the finish puts on hold: an equipment TKO needs the medic check and the equipment fixed; nothing is created twice
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$    for r in select distinct d.side, case when d.kind = 'dq' and d.card_key = 'equipment' then 'equipment' when d.card_key = 'ko' then 'knocked_out'
                                          when d.card_key in ('tko', 'tko_round', 'tko_equipment', 'tko_stalling') then 'medic_check' else 'assessment' end as hold
             from public.match_discipline d where$a$,
  $a$    for r in select distinct d.side, h.hold
             from public.match_discipline d cross join lateral unnest(case when d.kind = 'dq' and d.card_key = 'equipment' then array['equipment'] when d.card_key = 'ko' then array['knocked_out']
                    when d.card_key = 'tko_equipment' then array['medic_check', 'equipment'] when d.card_key in ('tko', 'tko_round', 'tko_stalling') then array['medic_check']
                    else array['assessment'] end) h(hold) where$a$);
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$        insert into public.outrance_holds (event_id, competition_id, entry_id, match_id, kind) values (v_event, v_comp, v_entry, p_match, r.hold);$a$,
  $a$        if not exists (select 1 from public.outrance_holds where entry_id = v_entry and match_id = p_match and kind = r.hold) then
          insert into public.outrance_holds (event_id, competition_id, entry_id, match_id, kind) values (v_event, v_comp, v_entry, p_match, r.hold);
        end if;$a$);

-- 5. §16.3: the competitor's appeal at the end of the fight
select pg_temp.bos_patch('public.outrance_appeal(uuid,uuid,text,text,text)'::regprocedure,
  $a$  if v_m.queue_state = 'final' and (p_lodged_by = 'competitor' or v_m.finalized_at < clock_timestamp() - interval '15 minutes') then
    raise exception '%', case when p_lodged_by = 'competitor' then 'a competitor appeals at the end of the fight, before leaving the list (Outrance §16.3)'$a$,
  $a$  if v_m.queue_state = 'final' and ((p_lodged_by = 'competitor' and v_m.finalized_at < clock_timestamp() - interval '5 minutes') or v_m.finalized_at < clock_timestamp() - interval '15 minutes') then
    raise exception '%', case when p_lodged_by = 'competitor' then 'a competitor appeals at the end of the fight, before leaving the list (Outrance §16.3): more than 5 minutes have passed since the result'$a$);

-- the tablet's hold list says which call a hold came from, so a hold from this fight can be told apart
select pg_temp.bos_patch('private.outrance_state(uuid)'::regprocedure,
  $a$'kind', h.kind, 'created_at', h.created_at, 'from_match', h.match_id)$a$,
  $a$'kind', h.kind, 'created_at', h.created_at, 'from_match', h.match_id, 'during_fight', h.discipline_id is not null)$a$);

reset check_function_bodies;
