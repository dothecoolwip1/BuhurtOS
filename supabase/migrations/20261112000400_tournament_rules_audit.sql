-- Pool and round-robin tie-breaks from the rules audit against BI Tournament Structure 26.1 §3 (2026-10-29):
--   §3.1 head-to-head, "Only in 2 competitor/teams tie"; §3.2 the difference between round victories and losses (Buhurt; Sword and Buckler),
--   or the ratio of hits earned to hits received (the other duels); §3.3 / §3.4 (active vs downed, fewest penalties) stay with the organizer's
--   tie decision, as before. The previous order put the score difference before head-to-head, counted head-to-head across any number of tied
--   entries, and used a points difference for every duel.
-- The function keeps its signature and columns (diff and h2h are still returned; h2h is now the head-to-head that applies). Standings are
-- computed live, so fights in progress follow the rule from now on; places already written when a competition was finished are unchanged.
create or replace function private.group_ranks(p_comp uuid)
 RETURNS TABLE(lvl text, part text, ent uuid, w bigint, l bigint, sf bigint, sa bigint, diff bigint, h2h bigint, manual integer, raw_rank bigint, wrank bigint, tied boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with k as (select c.structure, c.category, r.league from public.competitions c left join public.ref_categories r on r.code = c.category where c.id = p_comp),
  mm as (select m.* from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null),
  sides as (
    select m.id as mid, m.stage, coalesce(m.pool, '') as pool, s.me, s.opp, s.sf, s.sa,
           coalesce(m.winner_entry_id = s.me, false) as won, coalesce(m.winner_entry_id = s.opp, false) as lost
    from mm m cross join lateral (values (m.entry_a, m.entry_b, m.score_a, m.score_b), (m.entry_b, m.entry_a, m.score_b, m.score_a)) s(me, opp, sf, sa)),
  gs as (
    select sd.*, case when (select structure from k) = 'pools_elimination' and sd.stage = 'pool' then 'p' else 'r' end as lvl,
           case when (select structure from k) = 'pools_elimination' and sd.stage = 'pool' then sd.pool else '' end as part
    from sides sd where sd.stage in ('pool', 'round_robin')),
  st as (
    select me as ent, lvl, part, count(*) filter (where won) as w, count(*) filter (where lost) as l, coalesce(sum(sf), 0) as sf, coalesce(sum(sa), 0) as sa, coalesce(sum(sf), 0) - coalesce(sum(sa), 0) as diff
    from gs group by me, lvl, part),
  tie as (select st.*, count(*) over (partition by st.lvl, st.part, st.w) as level_on_wins from st),
  -- §3.1: head-to-head decides only a tie between exactly 2
  h2h as (
    select a.ent, a.lvl, a.part, case when a.level_on_wins = 2 then count(*) filter (where g.won) else 0 end as h
    from tie a left join tie b on b.lvl = a.lvl and b.part = a.part and b.w = a.w and b.ent <> a.ent
              left join gs g on g.me = a.ent and g.opp = b.ent and g.lvl = a.lvl and g.part = a.part
    group by a.ent, a.lvl, a.part, a.level_on_wins),
  base as (
    select st.*, coalesce(h.h, 0) as h, td.rank as manual,
           -- §3.2: round difference (team fights; sword and buckler record rounds won) or the ratio of hits earned to hits received
           case when (select league from k) = 'buhurt' or (select category from k) = 'buckler' then st.diff::numeric
                when st.sa = 0 then 1000000 + st.sf
                else round(st.sf::numeric / st.sa, 6) end as metric
    from st
    left join h2h h on h.ent = st.ent and h.lvl = st.lvl and h.part = st.part
    left join public.pool_tie_decisions td on td.competition_id = p_comp and td.entry_id = st.ent),
  ranked as (
    select b.*, rank() over (partition by b.lvl, b.part order by b.w desc, b.h desc, b.metric desc) as raw_rank,
           rank() over (partition by b.lvl, b.part order by b.w desc, b.h desc, b.metric desc, coalesce(b.manual, 1000000)) as wrank
    from base b)
  select r.lvl, r.part, r.ent, r.w, r.l, r.sf, r.sa, r.diff, r.h, r.manual, r.raw_rank, r.wrank,
         (count(*) over (partition by r.lvl, r.part, r.wrank) > 1)
  from ranked r
$function$;
