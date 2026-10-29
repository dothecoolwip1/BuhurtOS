-- Pack 29c: a counter phone's "Last fight" shows a Profight's exact Total Fight Score (§15.4.1). The score columns hold whole numbers, so an
-- 18.667–19.333 fight read as "19-19 to Blue" (rehearsal 2026-10-29). Other fights are unchanged. Additive: one anchored patch.
set check_function_bodies = off;
create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'Pack 29c patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;
select pg_temp.bos_patch('private.field_fights(uuid,text)'::regprocedure,
  $a$'result', a.result, 'score_a', a.score_a, 'score_b', a.score_b) from a where slot = 'last'$a$,
  $a$'result', a.result,
      'score_a', case when a.detail ->> 'kind' = 'outrance' and a.detail -> 'totals' ? 'a' then round((a.detail -> 'totals' ->> 'a')::numeric / 60, 2) else a.score_a end,
      'score_b', case when a.detail ->> 'kind' = 'outrance' and a.detail -> 'totals' ? 'b' then round((a.detail -> 'totals' ->> 'b')::numeric / 60, 2) else a.score_b end) from a where slot = 'last'$a$);
reset check_function_bodies;
