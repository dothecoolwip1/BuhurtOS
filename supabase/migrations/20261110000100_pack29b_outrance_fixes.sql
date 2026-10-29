-- Pack 29b: fixes from the hosted rehearsal (2026-10-29, synthetic event "TEST Outrance V26.4 Rehearsal 2026-10-28").
--   1. A fight with a winner is always a DECISION (§15.4.1 decides the winner; §15.4.2 names the type). With uneven sheets (one marshal each
--      way) the marshals alone read as a split DRAW, so the result said "Winner: … by split draw". The win type now takes the winner: unanimous
--      when every marshal had the winner ahead, majority when nobody had the loser ahead, otherwise split. The head marshal's decision on a
--      level fight is named the same way from the winner they chose.
--   2. A fight blocked by a hold (medic check, assessment, equipment) could not be cleared from the tablet: the hold list came with the opened
--      Lyst, and the hold stops the Lyst opening. outrance_match_holds gives the staff the holds on this fight's fighters before it opens.
-- Additive. Finished results are not rewritten here: a wrong label on an official result is corrected through the result correction process.
set check_function_bodies = off;

create or replace function private.outrance_win_type(p_results text[], p_winner text) returns text
language plpgsql immutable set search_path = '' as $$
declare n integer := coalesce(array_length(p_results, 1), 0); mine integer; theirs integer;
begin
  if n = 0 then return null; end if;
  if p_winner is null or p_winner not in ('a', 'b') then return private.outrance_win_type(p_results); end if;
  select count(*) filter (where x = p_winner), count(*) filter (where x = case when p_winner = 'a' then 'b' else 'a' end) into mine, theirs from unnest(p_results) x;
  return case when mine = n then 'unanimous_decision' when theirs = 0 then 'majority_decision' else 'split_decision' end;
end $$;
revoke execute on function private.outrance_win_type(text[], text) from public, anon, authenticated;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'Pack 29b patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

-- the tablet's running win type follows the Total Fight Score's leader
select pg_temp.bos_patch('private.outrance_totals(uuid)'::regprocedure,
  $a$'win_type', private.outrance_win_type(v_results), 'leader'$a$,
  $a$'win_type', private.outrance_win_type(v_results, case when v_ua > v_ub then 'a' when v_ub > v_ua then 'b' end), 'leader'$a$);
-- the official result is named from the winner it records (the Total Fight Score's, or the head marshal's on a level fight)
select pg_temp.bos_patch('public.outrance_finish(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$v_win_type := v_tot ->> 'win_type';$a$,
  $a$v_win_type := private.outrance_win_type(array(select e ->> 'result' from jsonb_array_elements(v_tot -> 'marshals') e), nullif(p_result, 'draw'));$a$);

-- the holds on this fight's fighters, for the staff, before the fight opens on the Lyst (§14.8, §14.10, §14.11, §5.2, §6.2)
create or replace function public.outrance_match_holds(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'side', case when h.entry_id = m.entry_a then 'a' else 'b' end, 'kind', h.kind,
                                                       'created_at', h.created_at, 'from_match', h.match_id, 'name', private.lyst_side_name(h.entry_id)) order by h.created_at)
                     from public.matches m join public.outrance_holds h on h.competition_id = m.competition_id and h.entry_id in (m.entry_a, m.entry_b) and h.cleared_at is null
                    where m.id = p_match), '[]'::jsonb);
end $$;
revoke execute on function public.outrance_match_holds(uuid) from public, anon;
grant execute on function public.outrance_match_holds(uuid) to authenticated;

reset check_function_bodies;
