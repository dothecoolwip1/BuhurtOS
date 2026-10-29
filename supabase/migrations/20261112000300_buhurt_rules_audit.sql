-- Team fight (buhurt) fixes from the rules audit against BI Buhurt Rules 26.4.1 and Buhurt Regulations 26.4 (2026-10-29).
--   Regulations 4.2 (group stage): "If the match ends in a draw (provided the number of round victories was a draw), record the match as a draw"
--   (the match time limit ran out). Regulations 4.3: round robin, elimination, semi-finals and finals "cannot end in a draw".
--   The check on a team fight's recorded rounds allowed a level fight anywhere a draw was allowed (pool and round robin) only once a side had
--   its rounds to win, i.e. never at 1-1. It now: refuses a draw outside the group stage ('pool'), even when scored by hand; and accepts a
--   group-stage draw with the rounds level (the match time ran out).
-- Additive: one anchored patch. Results already saved are unchanged.
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'buhurt rules patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

select pg_temp.bos_patch('private.assert_team_rounds(uuid,text,integer,integer)'::regprocedure,
  $a$  if v_league is distinct from 'buhurt' then return; end if;$a$,
  $a$  if v_league is distinct from 'buhurt' then return; end if;
  -- Buhurt Regulations 4.3: only the group stage can end level (4.2)
  if p_result = 'draw' and (select stage from public.matches where id = p_match) is distinct from 'pool' then
    raise exception 'a team fight cannot end in a draw outside the group stage (Buhurt Regulations 4.3): fight another round' using errcode = 'P0001'; end if;$a$);
select pg_temp.bos_patch('private.assert_team_rounds(uuid,text,integer,integer)'::regprocedure,
  $a$  if greatest(v_a, v_b) < v_need then$a$,
  $a$  -- Buhurt Regulations 4.2: in the group stage, rounds level when the match time runs out is a draw
  if p_result = 'draw' and v_a = v_b then return; end if;
  if greatest(v_a, v_b) < v_need then$a$);

reset check_function_bodies;
