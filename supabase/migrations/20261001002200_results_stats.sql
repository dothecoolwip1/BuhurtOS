-- Results and statistics computed from real matches (additive).
--
-- finish_competition(p_competition, p_multiplier_source) turns the final matches of a competition into results rows
-- (final_place + league points) and marks the competition 'finished'. Everything below (stats, rankings) is a view over matches/results.
--
-- ===================================================================== PLACES (how final_place is decided)
-- Every non-withdrawn entry gets a place. A place is 1 + the number of entries that ranked strictly better, so entries that are
-- level SHARE a place (competition ranking: 1, 2, 3, 3, 5, 5, 5, 5, 9 ...). Nothing breaks a tie by chance.
--  Elimination (stages elimination / third_place / final):
--    1st = winner of the final, 2nd = its loser.
--    With a third_place match: 3rd = its winner, 4th = its loser. Without one: both semifinal losers share 3rd.
--    Everyone else: by the round they lost in, later round = better; entries that lost in the same round share a place.
--    Byes need no special case (a bye is a missing round-1 match; the entry simply loses later).
--  Round robin, and the pool stage of pools_elimination: rank by (1) match wins, (2) score difference (score_for - score_against),
--    (3) head-to-head: wins against the other entries that are level on (1) and (2), (4) score_for. Draws count as neither win nor loss.
--    Still level after (4) = they share the place. Pools are ranked inside each pool.
--  pools_elimination: entries that reached the knockout rank first (by the elimination rules). Then, if no knockout was played and a
--    'round_robin' stage was, its entries rank next by the round robin rules. Entries that only played pools come after, ordered by
--    (finishing position in their own pool, wins, score difference, score_for); different pool sizes make that last part only indicative.
--  Entries with no final match rank after everyone who played; disqualified entries rank last. Neither earns placement or win points
--  beyond what they won (disqualified: none).
-- ===================================================================== POINTS (the project's league maths, src/lib/tournament.ts)
--  base = 1 per pool / round-robin win + 2 per elimination-stage win (elimination, third_place and final matches all count)
--         + placement 6 / 4 / 2 for place 1 / 2 / 3 (only for entries that played; shared places each get the full placement points)
--  points = round(base * tier multiplier, 2). The multiplier is read from ref_tiers for competitions.tier, from the column named by
--  p_multiplier_source: 'tournament_structure' (default, same as the app's default) or 'league_structure' (the two documents disagree for
--  Regional and Conference). A competition WITHOUT a tier gets 0 points (no tier, no league points); places are still stored.
--  Draws earn nothing.

-- Per-side round counts from matches.detail where the scorer stored them (see src/lib/fieldScoring.ts), else from score_a / score_b:
--   group fights: detail.roundsWon {a,b}                       (score_a / score_b are rounds won as well)
--   duels:        detail.rounds {a:[points per round], b:[...]} a round is won by the higher number
--   profight:     detail.rounds [{a,b}] the 10-point-must round scores, a round is won by the higher number
--   otherwise:    rounds_won = this side's score, rounds_lost = the other side's score
create or replace function private.side_rounds(p_detail jsonb, p_side text, p_sf int, p_sa int) returns table (won int, lost int)
language plpgsql immutable set search_path = '' as $$
declare r jsonb; o text := case p_side when 'a' then 'b' else 'a' end; i int;
begin
  won := p_sf; lost := p_sa;
  begin
    r := p_detail -> 'roundsWon';
    if r is not null and jsonb_typeof(r) = 'object' and r ? p_side and r ? o then
      won := (r ->> p_side)::int; lost := (r ->> o)::int;
    elsif jsonb_typeof(p_detail -> 'rounds') = 'object' then
      r := p_detail -> 'rounds';
      if jsonb_typeof(r -> p_side) = 'array' and jsonb_typeof(r -> o) = 'array' then
        won := 0; lost := 0;
        for i in 0 .. least(jsonb_array_length(r -> p_side), jsonb_array_length(r -> o)) - 1 loop
          if (r -> p_side ->> i)::numeric > (r -> o ->> i)::numeric then won := won + 1;
          elsif (r -> p_side ->> i)::numeric < (r -> o ->> i)::numeric then lost := lost + 1; end if;
        end loop;
      end if;
    elsif jsonb_typeof(p_detail -> 'rounds') = 'array' then
      won := 0; lost := 0;
      for r in select value from jsonb_array_elements(p_detail -> 'rounds') loop
        if (r ->> p_side)::numeric > (r ->> o)::numeric then won := won + 1;
        elsif (r ->> p_side)::numeric < (r ->> o)::numeric then lost := lost + 1; end if;
      end loop;
    end if;
  exception when others then
    won := p_sf; lost := p_sa;
  end;
  return next;
end $$;
revoke execute on function private.side_rounds(jsonb, text, int, int) from public;
grant execute on function private.side_rounds(jsonb, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------- the placement engine (read-only, used by finish_competition)
create or replace function private.compute_places(p_comp uuid)
returns table (entry_id uuid, final_place int, pool_wins int, elim_wins int, base_points numeric)
language sql stable security definer set search_path = '' as $$
  with recursive
  k as (select structure from public.competitions where id = p_comp),
  ent as (select e.id, e.status from public.entries e where e.competition_id = p_comp and e.status <> 'withdrawn'),
  mm as (select m.* from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null),
  sides as (
    select m.id as mid, m.stage, coalesce(m.pool, '') as pool, s.me, s.opp, s.sf, s.sa,
           coalesce(m.winner_entry_id = s.me, false) as won, coalesce(m.winner_entry_id = s.opp, false) as lost, (m.result = 'draw') as drew
    from mm m cross join lateral (values (m.entry_a, m.entry_b, m.score_a, m.score_b), (m.entry_b, m.entry_a, m.score_b, m.score_a)) s(me, opp, sf, sa)),
  gs as (
    select sd.*, case when (select structure from k) = 'pools_elimination' and sd.stage = 'pool' then 'p' else 'r' end as lvl,
           case when (select structure from k) = 'pools_elimination' and sd.stage = 'pool' then sd.pool else '' end as part
    from sides sd where sd.stage in ('pool', 'round_robin')),
  st as (
    select me as ent, lvl, part, count(*) filter (where won) as w, count(*) filter (where lost) as l, coalesce(sum(sf), 0) as sf, coalesce(sum(sa), 0) as sa, coalesce(sum(sf), 0) - coalesce(sum(sa), 0) as diff
    from gs group by me, lvl, part),
  h2h as (
    select a.ent, a.lvl, a.part, count(*) filter (where g.won) as h
    from st a left join st b on b.lvl = a.lvl and b.part = a.part and b.w = a.w and b.diff = a.diff and b.ent <> a.ent
              left join gs g on g.me = a.ent and g.opp = b.ent and g.lvl = a.lvl and g.part = a.part
    group by a.ent, a.lvl, a.part),
  wr as (
    select st.*, rank() over (partition by st.lvl, st.part order by st.w desc, st.diff desc, coalesce(h.h, 0) desc, st.sf desc) as wrank
    from st left join h2h h on h.ent = st.ent and h.lvl = st.lvl and h.part = st.part),
  km as (select * from mm where stage in ('elimination', 'third_place', 'final')),
  depth(id, d) as (
    select id, 0 from km where stage = 'final'
    union all select m.id, depth.d + 1 from km m join depth on m.next_match_id = depth.id where m.stage = 'elimination'),
  has3 as (select exists (select 1 from km where stage = 'third_place') as yes),
  kk as (
    select m.winner_entry_id as ent, 0 as key from km m where m.stage = 'final'
    union all select case when m.winner_entry_id = m.entry_a then m.entry_b else m.entry_a end, 1 from km m where m.stage = 'final'
    union all select m.winner_entry_id, 2 from km m where m.stage = 'third_place'
    union all select case when m.winner_entry_id = m.entry_a then m.entry_b else m.entry_a end, 3 from km m where m.stage = 'third_place'
    union all select case when m.winner_entry_id = m.entry_a then m.entry_b else m.entry_a end, case when dp.d = 1 then 2 else 10 + dp.d end
      from km m join depth dp on dp.id = m.id where m.stage = 'elimination' and (dp.d > 1 or not (select yes from has3))),
  kp as (
    select ent, min(key) as key from kk group by ent
    union select x.me, 99 from (select entry_a as me from km union select entry_b from km) x where x.me not in (select ent from kk)),
  tup as (
    select e.id as ent, e.status,
      case when e.status = 'disqualified' then 5 when kp.ent is not null then 1 when wrr.ent is not null then 2 when wrp.ent is not null then 3 else 4 end as g,
      case when e.status = 'disqualified' then 0 when kp.ent is not null then kp.key when wrr.ent is not null then wrr.wrank when wrp.ent is not null then wrp.wrank else 0 end::numeric as a,
      case when e.status <> 'disqualified' and kp.ent is null and wrr.ent is null and wrp.ent is not null then -wrp.w else 0 end::numeric as b,
      case when e.status <> 'disqualified' and kp.ent is null and wrr.ent is null and wrp.ent is not null then -wrp.diff else 0 end::numeric as c,
      case when e.status <> 'disqualified' and kp.ent is null and wrr.ent is null and wrp.ent is not null then -wrp.sf else 0 end::numeric as d
    from ent e
    left join kp on kp.ent = e.id
    left join lateral (select * from wr where wr.ent = e.id and wr.lvl = 'r' order by wr.part limit 1) wrr on true
    left join lateral (select * from wr where wr.ent = e.id and wr.lvl = 'p' order by wr.part limit 1) wrp on true),
  placed as (
    select t.*, 1 + (select count(*) from tup u where (u.g, u.a, u.b, u.c, u.d) < (t.g, t.a, t.b, t.c, t.d)) as place from tup t)
  select p.ent, p.place::int,
    (select count(*) from gs where gs.me = p.ent and gs.won)::int,
    (select count(*) from sides sd where sd.me = p.ent and sd.won and sd.stage in ('elimination', 'third_place', 'final'))::int,
    case when p.status = 'disqualified' then 0::numeric else
      (select count(*) from gs where gs.me = p.ent and gs.won)
      + 2 * (select count(*) from sides sd where sd.me = p.ent and sd.won and sd.stage in ('elimination', 'third_place', 'final'))
      + case when p.g in (1, 2, 3) then case p.place when 1 then 6 when 2 then 4 when 3 then 2 else 0 end else 0 end end
  from placed p
$$;
revoke execute on function private.compute_places(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- finish_competition
-- Organizer only. Requires every match of the competition to be final. Safe to run again: results are recomputed (upsert) and results of
-- entries that are no longer ranked (withdrawn since) are removed. Returns how many entries were ranked.
create or replace function public.finish_competition(p_competition uuid, p_multiplier_source text default 'tournament_structure') returns int
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_open int; v_mult numeric; n int;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can finish a competition' using errcode = '42501'; end if;
  if p_multiplier_source is null or p_multiplier_source not in ('tournament_structure', 'league_structure') then
    raise exception 'multiplier source must be tournament_structure or league_structure' using errcode = '22023'; end if;
  if not exists (select 1 from public.matches where competition_id = p_competition) then raise exception 'this competition has no matches' using errcode = 'P0001'; end if;
  select count(*) into v_open from public.matches where competition_id = p_competition and queue_state <> 'final';
  if v_open > 0 then raise exception '% match(es) are not final yet', v_open using errcode = 'P0001'; end if;
  if v_k.tier is not null then
    select case p_multiplier_source when 'league_structure' then multiplier_league_structure else multiplier_tournament_structure end into v_mult
      from public.ref_tiers where name = v_k.tier;
  end if;

  insert into public.results (competition_id, entry_id, final_place, points)
  select p_competition, c.entry_id, c.final_place, case when v_k.tier is null then 0 else round(c.base_points * coalesce(v_mult, 0), 2) end
  from private.compute_places(p_competition) c
  on conflict (competition_id, entry_id) do update set final_place = excluded.final_place, points = excluded.points;
  get diagnostics n = row_count;
  delete from public.results where competition_id = p_competition and entry_id not in (select entry_id from private.compute_places(p_competition));
  update public.competitions set status = 'finished' where id = p_competition;
  perform private.audit(v_k.event_id, 'competition.finished', p_competition::text,
    jsonb_build_object('entries', n, 'tier', v_k.tier, 'multiplier', v_mult, 'source', p_multiplier_source));
  return n;
end $$;

-- A finished competition whose match is reopened (or that gets a new unfinished match) is no longer finished: results are cleared and
-- the status goes back to 'running'. Hooked on matches so reopen_match (and any other path) stays consistent without being rewritten.
create or replace function private.unfinish_competition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if tg_op = 'UPDATE' and not (old.queue_state = 'final' and new.queue_state <> 'final') then return new; end if;
  if tg_op = 'INSERT' and new.queue_state = 'final' then return new; end if;
  select event_id into v_event from public.competitions where id = new.competition_id and status = 'finished';
  if found then
    delete from public.results where competition_id = new.competition_id;
    update public.competitions set status = 'running' where id = new.competition_id;
    perform private.audit(v_event, 'competition.reopened', new.competition_id::text, jsonb_build_object('match', new.id));
  end if;
  return new;
end $$;
revoke execute on function private.unfinish_competition() from public, anon, authenticated;
create trigger matches_unfinish after insert or update of queue_state on public.matches for each row execute function private.unfinish_competition();

revoke execute on function public.finish_competition(uuid, text) from public, anon;
grant execute on function public.finish_competition(uuid, text) to authenticated;

-- ===================================================================== VIEWS
-- All views are security_invoker: they show exactly what the caller may already read from matches / entries / results / entry_fighters
-- (public for a public event; staff for the rest; the organization-disabled rule of 20261001001900 applies through is_event_public).
-- Organization of an event = events.organization_id, else its season's organization. Season = events.season_id.
-- gender is the COMPETITION's gender ('open' | 'men' | 'women'), not a person's.

-- One row per side of every final match with both sides set.
--   score_for / score_against: this side's and the other side's matches.score_a / score_b (rounds won in group fights, points in duels).
--   rounds_won / rounds_lost: from matches.detail when the scorer stored it, else equal to score_for / score_against (see private.side_rounds).
create view public.match_sides with (security_invoker = true) as
select m.id as match_id, m.competition_id, k.event_id, k.category, k.gender, k.tier, k.structure, m.stage, m.finalized_at,
  ev.ends_on as event_ends_on, ev.event_type, ev.season_id, coalesce(ev.organization_id, se.organization_id) as organization_id,
  s.side, e.id as entry_id, e.team_id, e.fighter_id,
  case when m.result = 'draw' then 'draw' when m.winner_entry_id = e.id then 'win' else 'loss' end as outcome,
  s.sf as score_for, s.sa as score_against, r.won as rounds_won, r.lost as rounds_lost
from public.matches m
join public.competitions k on k.id = m.competition_id
join public.events ev on ev.id = k.event_id
left join public.seasons se on se.id = ev.season_id
cross join lateral (values ('a', m.entry_a, m.score_a, m.score_b), ('b', m.entry_b, m.score_b, m.score_a)) s(side, entry_id, sf, sa)
join public.entries e on e.id = s.entry_id
cross join lateral private.side_rounds(m.detail, s.side, s.sf, s.sa) r
where m.queue_state = 'final' and m.entry_a is not null and m.entry_b is not null;

-- Who took part: a fighter on a duel entry, or on a team entry's roster. Withdrawn entries are left out.
create view public.fighter_participation with (security_invoker = true) as
select e.fighter_id, e.id as entry_id, e.competition_id, k.event_id
from public.entries e join public.competitions k on k.id = e.competition_id where e.fighter_id is not null and e.status <> 'withdrawn'
union all
select ef.fighter_id, e.id, e.competition_id, k.event_id
from public.entry_fighters ef join public.entries e on e.id = ef.entry_id join public.competitions k on k.id = e.competition_id where e.status <> 'withdrawn';

-- Every fighter's final matches. A team entry counts for each fighter on its roster (melee appearances need set_entry_roster).
create view public.fighter_match_rows with (security_invoker = true) as
select x.fighter_id, ms.match_id, ms.competition_id, ms.event_id, ms.category, ms.gender, ms.tier, ms.stage, ms.finalized_at, ms.event_ends_on, ms.event_type,
  ms.season_id, ms.organization_id, ms.entry_id, ms.team_id, ms.outcome, ms.score_for, ms.score_against, ms.rounds_won, ms.rounds_lost
from public.match_sides ms
left join public.entry_fighters ef on ef.entry_id = ms.entry_id
cross join lateral (select coalesce(ms.fighter_id, ef.fighter_id) as fighter_id) x
where x.fighter_id is not null;

-- Results with their context. final_place / points exist only after finish_competition (or a loader) wrote them.
create view public.result_rows with (security_invoker = true) as
select r.competition_id, r.entry_id, r.final_place, coalesce(r.points, 0) as points,
  k.name as competition_name, k.category, k.gender, k.tier, k.structure,
  ev.id as event_id, ev.slug as event_slug, ev.name as event_name, ev.event_type, ev.starts_on, ev.ends_on as event_ends_on,
  ev.season_id, coalesce(ev.organization_id, se.organization_id) as organization_id, e.team_id, e.fighter_id as entry_fighter_id
from public.results r
join public.entries e on e.id = r.entry_id
join public.competitions k on k.id = r.competition_id
join public.events ev on ev.id = k.event_id
left join public.seasons se on se.id = ev.season_id
where r.final_place is not null;

-- A fighter's results (duel entries and rosters), with category / gender / season / organization. Richer than fighter_history.
create view public.fighter_results with (security_invoker = true) as
select fp.fighter_id, rr.competition_id, rr.entry_id, rr.final_place, rr.points, rr.competition_name, rr.category, rr.gender, rr.tier, rr.structure,
  rr.event_id, rr.event_slug, rr.event_name, rr.event_type, rr.starts_on, rr.event_ends_on, rr.season_id, rr.organization_id, rr.team_id
from public.result_rows rr join public.fighter_participation fp on fp.entry_id = rr.entry_id;

create view public.team_results with (security_invoker = true) as
select rr.team_id, rr.competition_id, rr.entry_id, rr.final_place, rr.points, rr.competition_name, rr.category, rr.gender, rr.tier, rr.structure,
  rr.event_id, rr.event_slug, rr.event_name, rr.event_type, rr.starts_on, rr.event_ends_on, rr.season_id, rr.organization_id
from public.result_rows rr where rr.team_id is not null;

-- ---------------------------------------------------------------- fighter_match_stats
-- Per (fighter, organization, season, category, gender). points_for / points_against = score_for / score_against summed (rounds won in group
-- fights, strike points in duels). rounds_won / rounds_lost per private.side_rounds.
create view public.fighter_match_stats with (security_invoker = true) as
select fr.fighter_id, f.display_name, fr.organization_id, fr.season_id, fr.category, fr.gender,
  count(*) as matches,
  count(*) filter (where fr.outcome = 'win') as wins,
  count(*) filter (where fr.outcome = 'loss') as losses,
  count(*) filter (where fr.outcome = 'draw') as draws,
  coalesce(sum(fr.rounds_won), 0) as rounds_won, coalesce(sum(fr.rounds_lost), 0) as rounds_lost,
  coalesce(sum(fr.score_for), 0) as points_for, coalesce(sum(fr.score_against), 0) as points_against
from public.fighter_match_rows fr join public.fighters f on f.id = fr.fighter_id
group by fr.fighter_id, f.display_name, fr.organization_id, fr.season_id, fr.category, fr.gender;

-- ---------------------------------------------------------------- fighter_career_stats (every fighter, zeros when nothing is visible)
--   events_attended: distinct events with an entry or roster row (withdrawn entries excluded)
--   win_pct: wins / matches * 100, one decimal (draws count as matches); null with no matches
--   golds / silvers / bronzes: final_place 1 / 2 / 3 (a shared third place is a bronze for each). podiums = their sum.
--   tournament_victories: golds in an event_type 'tournament' competition that has a tier other than 'Exhibition'
--   points: sum of results.points; every roster member (fighter, mercenary or guest) of a team entry gets the team's points
create view public.fighter_career_stats with (security_invoker = true) as
with ev as (select fighter_id, count(distinct event_id) as events from public.fighter_participation group by fighter_id),
mt as (select fighter_id, count(*) as matches, count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses,
              count(*) filter (where outcome = 'draw') as draws from public.fighter_match_rows group by fighter_id),
rs as (select fighter_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes,
              count(*) filter (where final_place = 1 and event_type = 'tournament' and tier is not null and tier <> 'Exhibition') as tournament_victories,
              coalesce(sum(points), 0) as points from public.fighter_results group by fighter_id)
select f.id as fighter_id, f.display_name,
  coalesce(ev.events, 0) as events_attended, coalesce(mt.matches, 0) as matches, coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  case when coalesce(mt.matches, 0) = 0 then null else round(mt.wins * 100.0 / mt.matches, 1) end as win_pct,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums,
  coalesce(rs.tournament_victories, 0) as tournament_victories, coalesce(rs.points, 0) as points
from public.fighters f left join ev on ev.fighter_id = f.id left join mt on mt.fighter_id = f.id left join rs on rs.fighter_id = f.id;

-- ---------------------------------------------------------------- fighter_season_stats (per fighter, season and organization; seasons only)
create view public.fighter_season_stats with (security_invoker = true) as
with ev as (select fp.fighter_id, e.season_id, coalesce(e.organization_id, se.organization_id) as organization_id, count(distinct fp.event_id) as events
            from public.fighter_participation fp join public.events e on e.id = fp.event_id left join public.seasons se on se.id = e.season_id
            where e.season_id is not null group by 1, 2, 3),
mt as (select fighter_id, season_id, organization_id, count(*) as matches, count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses,
              count(*) filter (where outcome = 'draw') as draws from public.fighter_match_rows where season_id is not null group by 1, 2, 3),
rs as (select fighter_id, season_id, organization_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers,
              count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points from public.fighter_results where season_id is not null group by 1, 2, 3),
keys as (select fighter_id, season_id, organization_id from ev union select fighter_id, season_id, organization_id from mt union select fighter_id, season_id, organization_id from rs)
select k.fighter_id, f.display_name, k.season_id, k.organization_id,
  coalesce(ev.events, 0) as events_attended, coalesce(mt.matches, 0) as matches, coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums, coalesce(rs.points, 0) as points
from keys k join public.fighters f on f.id = k.fighter_id
left join ev on ev.fighter_id = k.fighter_id and ev.season_id = k.season_id and ev.organization_id is not distinct from k.organization_id
left join mt on mt.fighter_id = k.fighter_id and mt.season_id = k.season_id and mt.organization_id is not distinct from k.organization_id
left join rs on rs.fighter_id = k.fighter_id and rs.season_id = k.season_id and rs.organization_id is not distinct from k.organization_id;

-- ---------------------------------------------------------------- team_stats (every visible team)
--   matches_5v5 / matches_3v3 / matches_other: final matches by competition category. matches = all of them.
--   events: distinct events with a non-withdrawn team entry. win_pct as for fighters.
--   podiums / golds as for fighters; tournament_wins = tournament_victories rule. points = sum of results.points.
--   recent_form: outcomes of the last 5 final matches, MOST RECENT FIRST, as letters W / L / D (e.g. 'WWLDW'); order: event end date,
--   finalized_at, match id, newest first.
create view public.team_stats with (security_invoker = true) as
with ev as (select e.team_id, count(distinct k.event_id) as events from public.entries e join public.competitions k on k.id = e.competition_id
            where e.team_id is not null and e.status <> 'withdrawn' group by e.team_id),
mt as (select team_id, count(*) as matches, count(*) filter (where category = '5v5') as m5, count(*) filter (where category = '3v3') as m3,
              count(*) filter (where outcome = 'win') as wins, count(*) filter (where outcome = 'loss') as losses, count(*) filter (where outcome = 'draw') as draws
       from public.match_sides where team_id is not null group by team_id),
rs as (select team_id, count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes,
              count(*) filter (where final_place = 1 and event_type = 'tournament' and tier is not null and tier <> 'Exhibition') as tournament_wins,
              coalesce(sum(points), 0) as points from public.team_results group by team_id)
select t.id as team_id, t.name as team_name, t.slug as team_slug,
  coalesce(ev.events, 0) as events, coalesce(mt.matches, 0) as matches, coalesce(mt.m5, 0) as matches_5v5, coalesce(mt.m3, 0) as matches_3v3,
  coalesce(mt.matches, 0) - coalesce(mt.m5, 0) - coalesce(mt.m3, 0) as matches_other,
  coalesce(mt.wins, 0) as wins, coalesce(mt.losses, 0) as losses, coalesce(mt.draws, 0) as draws,
  case when coalesce(mt.matches, 0) = 0 then null else round(mt.wins * 100.0 / mt.matches, 1) end as win_pct,
  coalesce(rs.golds, 0) as golds, coalesce(rs.silvers, 0) as silvers, coalesce(rs.bronzes, 0) as bronzes,
  coalesce(rs.golds, 0) + coalesce(rs.silvers, 0) + coalesce(rs.bronzes, 0) as podiums,
  coalesce(rs.tournament_wins, 0) as tournament_wins, coalesce(rs.points, 0) as points,
  coalesce((select string_agg(case f.outcome when 'win' then 'W' when 'loss' then 'L' else 'D' end, '' order by f.event_ends_on desc, f.finalized_at desc nulls last, f.match_id desc)
            from (select ms.outcome, ms.event_ends_on, ms.finalized_at, ms.match_id from public.match_sides ms where ms.team_id = t.id
                  order by ms.event_ends_on desc, ms.finalized_at desc nulls last, ms.match_id desc limit 5) f), '') as recent_form
from public.teams t left join ev on ev.team_id = t.id left join mt on mt.team_id = t.id left join rs on rs.team_id = t.id;

-- ---------------------------------------------------------------- rankings
-- rank = rank() over points DESC: entries with equal points share a rank and the next rank is skipped (1, 2, 2, 4). No other tie-break.
-- Points are summed from results.points. One row per (scope, organization, season, category, gender, subject):
--   scope 'season'      per organization + season + category + gender             (season_id not null)
--   scope 'org_career'  per organization + category + gender, all seasons         (season_id null)
--   scope 'org_all'     per organization, all categories and genders, all seasons (season_id, category, gender null)
--   scope 'career'      everything, all organizations and categories              (all of them null)
-- Results of events without an organization appear only in 'career' (and in 'season' if the event has a season).
create view public.ranking_fighters with (security_invoker = true) as
with agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, fighter_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from public.fighter_results where season_id is not null group by organization_id, season_id, category, gender, fighter_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.fighter_results where organization_id is not null group by organization_id, category, gender, fighter_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.fighter_results where organization_id is not null group by organization_id, fighter_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.fighter_results group by fighter_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.fighter_id, f.display_name, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.fighters f on f.id = a.fighter_id;

create view public.ranking_teams with (security_invoker = true) as
with agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, team_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from public.team_results where season_id is not null group by organization_id, season_id, category, gender, team_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.team_results where organization_id is not null group by organization_id, category, gender, team_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.team_results where organization_id is not null group by organization_id, team_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.team_results group by team_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.team_id, t.name as team_name, t.slug as team_slug, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.teams t on t.id = a.team_id;

grant select on public.match_sides, public.fighter_participation, public.fighter_match_rows, public.result_rows, public.fighter_results, public.team_results,
  public.fighter_match_stats, public.fighter_career_stats, public.fighter_season_stats, public.team_stats, public.ranking_fighters, public.ranking_teams to anon, authenticated;
