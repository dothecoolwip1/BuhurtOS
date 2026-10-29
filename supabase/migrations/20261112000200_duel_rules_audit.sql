-- Duel fixes from the rules audit against BI Duels Rules 26.4, Duels Regulations 26.4 and Infraction classification 26.4 (2026-10-29).
-- These apply to the BI duel categories: longsword, sword and shield, sword and buckler, polearm. Other categories are unchanged.
--   1. Rules 2.2.1: sword and buckler is won by the first to 2 ROUND victories; a round is won by 5 points first (or the most points in its
--      minute), so a round score is at most 5.
--   2. Rules 2.2.2: the other duels are won by at least 2 points more over the regular rounds (extra 30-second rounds until then). The Lyst
--      finish now checks both, and never saves a draw for a BI duel.
--   3. Regulations 4.2: a reprimand adds 3 points to the OPPONENT's score (1 for sword and buckler), registered separately; it is no longer a
--      deduction from the offender that stops at 0.
--   4. Rules 2.3, 2.3.4: a technical win can be recorded before any round (a no-show, a withdrawal) and is scored 10-0 per regular round
--      (5-0 for 2 rounds in sword and buckler); automatic walkovers record the same.
--   A sword and buckler result records the rounds won as its score (the points stay in the detail).
-- Additive: new kind 'reprimand' (amount = points to the opponent), new columns at the end of lyst_round_scores, the Lyst finish rewritten
-- with the same command id, stale-version and audit behaviour, and anchored patches. Fights already finished keep their stored result.
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'duel rules patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

-- the BI duel category of a fight (null for anything else)
create or replace function private.bi_duel_category(p_match uuid) returns text
language sql stable security definer set search_path = '' as $$
  select k.category from public.matches m join public.competitions k on k.id = m.competition_id
   where m.id = p_match and k.category in ('longsword', 'sword_shield', 'buckler', 'polearm')
$$;
-- the score of a technical win for the winner (Rules 2.3.4): 10 per regular round; in sword and buckler 2 (rounds won, 5-0 x 2); 0 outside BI duels
create or replace function private.technical_win_points(p_match uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when private.bi_duel_category(p_match) is null then 0
    when private.bi_duel_category(p_match) = 'buckler' then 2   -- rounds won (5-0 for 2 rounds): the buckler score is round victories
    else 10 * coalesce((private.lyst_settings_for(private.event_of_match(p_match)) ->> 'regular_rounds')::int, 2) end
$$;
revoke execute on function private.bi_duel_category(uuid), private.technical_win_points(uuid) from public, anon, authenticated;

-- 3. the reprimand
alter table public.match_discipline drop constraint if exists match_discipline_kind_check;
alter table public.match_discipline add constraint match_discipline_kind_check check (kind in ('warning', 'card', 'deduction', 'dq', 'armour', 'stoppage', 'note', 'reprimand'));
-- only a deduction or a reprimand carries points
alter table public.match_discipline drop constraint if exists match_discipline_check;
alter table public.match_discipline add constraint match_discipline_check check ((kind in ('deduction', 'reprimand')) = (amount > 0));
select pg_temp.bos_patch('public.lyst_record_discipline(uuid,uuid,integer,text,text,text,integer,text,text,uuid)'::regprocedure,
  $a$p_kind not in ('warning', 'card', 'deduction', 'dq')$a$, $a$p_kind not in ('warning', 'card', 'deduction', 'dq', 'reprimand')$a$);
select pg_temp.bos_patch('public.lyst_record_discipline(uuid,uuid,integer,text,text,text,integer,text,text,uuid)'::regprocedure,
  $a$  elsif coalesce(p_amount, 0) <> 0 then raise exception 'only a deduction has an amount' using errcode = '22023'; end if;$a$,
  $a$  elsif p_kind = 'reprimand' then
    -- Regulations 4.2: 3 points to the opponent, 1 in sword and buckler (the server sets it)
    if private.bi_duel_category(p_match) is null then raise exception 'a reprimand adds points to the opponent in a duel (Duels Regulations 4.2)' using errcode = '22023'; end if;
    p_amount := case when private.bi_duel_category(p_match) = 'buckler' then 1 else 3 end;
  elsif coalesce(p_amount, 0) <> 0 then raise exception 'only a deduction has an amount' using errcode = '22023'; end if;$a$);

create or replace view public.lyst_round_scores with (security_invoker = true) as
 SELECT r.match_id,
    r.event_id,
    r.round_no,
    r.status,
    r.rev,
    r.awarded_a,
    r.awarded_b,
    (COALESCE(d.da, (0)::bigint))::integer AS deduct_a,
    (COALESCE(d.db, (0)::bigint))::integer AS deduct_b,
        CASE
            WHEN (r.status = 'confirmed'::text) THEN GREATEST((0)::bigint, (r.awarded_a - COALESCE(d.da, (0)::bigint))) + COALESCE(d.pa, (0)::bigint)
            ELSE NULL::bigint
        END AS official_a,
        CASE
            WHEN (r.status = 'confirmed'::text) THEN GREATEST((0)::bigint, (r.awarded_b - COALESCE(d.db, (0)::bigint))) + COALESCE(d.pb, (0)::bigint)
            ELSE NULL::bigint
        END AS official_b,
    (COALESCE(d.pa, (0)::bigint))::integer AS award_a,
    (COALESCE(d.pb, (0)::bigint))::integer AS award_b
   FROM (public.lyst_rounds r
     LEFT JOIN LATERAL ( SELECT sum(x.amount) FILTER (WHERE x.kind = 'deduction' AND x.side = 'a'::text) AS da,
            sum(x.amount) FILTER (WHERE x.kind = 'deduction' AND x.side = 'b'::text) AS db,
            -- a reprimand against one side is points for the other (Duels Regulations 4.2)
            sum(x.amount) FILTER (WHERE x.kind = 'reprimand' AND x.side = 'b'::text) AS pa,
            sum(x.amount) FILTER (WHERE x.kind = 'reprimand' AND x.side = 'a'::text) AS pb
           FROM public.match_discipline x
          WHERE ((x.match_id = r.match_id) AND (x.round_no = r.round_no) AND (x.kind in ('deduction', 'reprimand')) AND (x.voided_at IS NULL))) d ON (true));
comment on view public.lyst_round_scores is 'A Lyst round: the marshal''s score, deductions, reprimand points to the opponent (award_*), and the official score.';

-- 1. a sword and buckler round is at most 5 points
select pg_temp.bos_patch('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure,
  $a$then raise exception 'scores are whole numbers from 0 to 99' using errcode = '22023'; end if;$a$,
  $a$then raise exception 'scores are whole numbers from 0 to 99' using errcode = '22023'; end if;
  if private.bi_duel_category(p_match) = 'buckler' and (p_awarded_a > 5 or p_awarded_b > 5) then
    raise exception 'a sword and buckler round is won with 5 points: at most 5 each (Duels Rules 2.2.1)' using errcode = '22023'; end if;$a$);

-- 1, 2, 4. the Lyst finish
create or replace function public.lyst_finalize(p_command uuid, p_match uuid, p_expected_version integer, p_result text, p_basis text DEFAULT 'score'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_event uuid; v_ta integer; v_tb integer; v_n integer; v_open integer; v_detail jsonb; v_m public.matches; v_loser text;
  v_cat text; v_regular integer; v_wa integer; v_wb integer; v_pts integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if private.outrance_is(p_match) then raise exception 'a Profight is finished with the Outrance finish (Total Fight Score, KO, TKO or disqualification)' using errcode = 'P0001'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_basis is null or p_basis not in ('score', 'dq', 'technical') then raise exception 'basis is score, dq or technical' using errcode = '22023'; end if;
  -- the match first (the established match -> Lyst lock order): a retry of a finish that is being saved waits for it and is answered as a
  -- repeat, before any rule below could refuse it
  perform 1 from public.matches where id = p_match for update;
  if exists (select 1 from public.result_proposals where id = p_command) then
    return public.submit_match_result(p_command, p_match, p_result, 0, 0, '{}'::jsonb, coalesce(p_expected_version, 0));
  end if;
  select * into v_m from public.matches where id = p_match;
  v_cat := private.bi_duel_category(p_match);
  v_regular := coalesce((private.lyst_settings_for(v_event) ->> 'regular_rounds')::int, 2);
  select count(*), count(*) filter (where status <> 'confirmed') into v_n, v_open from public.lyst_rounds where match_id = p_match;
  -- a technical win can come before any round is fought (Duels Rules 2.3: a no-show, a withdrawal)
  if v_n = 0 and p_basis <> 'technical' then raise exception 'no round has been confirmed yet' using errcode = 'P0001'; end if;
  if v_open > 0 then raise exception 'confirm every round before finishing the match' using errcode = 'P0001'; end if;
  select coalesce(sum(official_a), 0), coalesce(sum(official_b), 0),
         count(*) filter (where official_a > official_b), count(*) filter (where official_b > official_a)
    into v_ta, v_tb, v_wa, v_wb from public.lyst_round_scores where match_id = p_match and status = 'confirmed';
  if p_basis = 'score' then
    if v_cat is not null and p_result = 'draw' then raise exception 'a duel has no draw: fight extra rounds until it is decided (Duels Rules 2.2)' using errcode = 'P0001'; end if;
    if v_cat = 'buckler' then
      -- Rules 2.2.1: the first to 2 round victories
      if (p_result = 'a' and not (v_wa >= 2 and v_wa > v_wb)) or (p_result = 'b' and not (v_wb >= 2 and v_wb > v_wa)) then
        raise exception 'sword and buckler is won with 2 round victories (Duels Rules 2.2.1): rounds won % to %', v_wa, v_wb using errcode = 'P0001'; end if;
    else
      if (p_result = 'a' and v_ta <= v_tb) or (p_result = 'b' and v_tb <= v_ta) or (p_result = 'draw' and v_ta <> v_tb) then raise exception 'the official totals do not support that result' using errcode = 'P0001'; end if;
      if v_cat is not null then
        -- Rules 2.2.2: the regular rounds, then at least 2 points more
        if v_n < v_regular then raise exception 'fight the % regular rounds first (Duels Rules 2.2.2)', v_regular using errcode = 'P0001'; end if;
        if abs(v_ta - v_tb) < 2 then raise exception 'a duel is won by at least 2 points more: fight an extra 30-second round (Duels Rules 2.2.2)' using errcode = 'P0001'; end if;
      end if;
    end if;
  elsif p_basis = 'dq' then
    if p_result = 'draw' then raise exception 'a disqualification has a winner' using errcode = '22023'; end if;
    v_loser := case when p_result = 'a' then 'b' else 'a' end;
    if not exists (select 1 from public.match_discipline where match_id = p_match and kind = 'dq' and side = v_loser and voided_at is null) then raise exception 'record the disqualification first' using errcode = 'P0001'; end if;
  else
    if p_result = 'draw' or char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a technical result needs a winner and the marshal''s reason' using errcode = '22023'; end if;
    -- Rules 2.3.4: a technical win is scored 10-0 per round (5-0 for 2 rounds in sword and buckler)
    if v_cat is not null then
      v_pts := private.technical_win_points(p_match);
      v_ta := case when p_result = 'a' then v_pts else 0 end; v_tb := case when p_result = 'b' then v_pts else 0 end;
    end if;
  end if;
  v_detail := jsonb_build_object(
    'kind', 'duel',
    'rounds', jsonb_build_object('a', (select jsonb_agg(official_a order by round_no) from public.lyst_round_scores where match_id = p_match), 'b', (select jsonb_agg(official_b order by round_no) from public.lyst_round_scores where match_id = p_match)),
    'totals', jsonb_build_object('a', v_ta, 'b', v_tb),
    'round_wins', jsonb_build_object('a', v_wa, 'b', v_wb),
    'lyst', jsonb_build_object('basis', p_basis, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'rounds', (select jsonb_agg(jsonb_build_object('round', round_no, 'awarded_a', awarded_a, 'awarded_b', awarded_b, 'deduct_a', deduct_a, 'deduct_b', deduct_b,
                   'award_a', award_a, 'award_b', award_b, 'official_a', official_a, 'official_b', official_b) order by round_no)
                 from public.lyst_round_scores where match_id = p_match),
      'discipline', coalesce((select jsonb_agg(jsonb_build_object('round', round_no, 'side', side, 'kind', kind, 'label', label, 'amount', amount) order by created_at)
                 from public.match_discipline where match_id = p_match and voided_at is null), '[]'::jsonb)));
  -- sword and buckler is decided by round victories (Rules 2.2.1, and the round-difference tie-break of Tournament Structure §3.2): the score
  -- recorded is the rounds won (5-0 x 2 for a technical win: 2-0); the points stay in the detail
  if v_cat = 'buckler' then
    if p_basis = 'technical' then v_wa := case when p_result = 'a' then 2 else 0 end; v_wb := case when p_result = 'b' then 2 else 0 end; end if;
    return public.submit_match_result(p_command, p_match, p_result, v_wa, v_wb, v_detail || jsonb_build_object('score_is', 'round_wins'), p_expected_version);
  end if;
  return public.submit_match_result(p_command, p_match, p_result, v_ta, v_tb, v_detail, p_expected_version);
end $function$;

-- 4. automatic walkovers record the technical-win score
select pg_temp.bos_patch('private.resolve_withdrawn_walkovers(uuid)'::regprocedure,
  $a$      v_result,
      0,
      0,
      jsonb_build_object('walkover', true,$a$,
  $a$      v_result,
      case when v_result = 'a' then private.technical_win_points(v_m.id) else 0 end,
      case when v_result = 'b' then private.technical_win_points(v_m.id) else 0 end,
      jsonb_build_object('walkover', true,$a$);

reset check_function_bodies;
