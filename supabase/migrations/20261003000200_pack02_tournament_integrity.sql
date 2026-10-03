-- Pack 02 (2026-10-03): tournament and sporting-record integrity.
--  1. A match's version moves whenever its sides (or stage/pool/links) change, so stale commands cannot score replacement entrants.
--  2. Bracket construction is one locked transaction (public.build_schedule); the draw seed and algorithm are stored.
--  3. Pool ties are decided by one rule in the database (private.group_ranks); an unresolved tie blocks advancement and finishing
--     until an organizer records an order (public.record_tie_decision). Browser and official placings read the same ranking.
--  4. Official results cannot be written directly. Every change goes through a controlled path and is appended to result_revisions.
--     Reopening supersedes results (kept in the log) instead of silently deleting them.
--  5. Entries remember the team name used at the event; merges keep a successor link instead of rewriting history.
-- Additive. Depends on 20261003000100 only for the history views it re-creates (team_history keeps the `synthetic` column).

-- 1. Match version ------------------------------------------------------------------------------------------------------------------
create or replace function private.bump_match_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.version = old.version and (
       new.entry_a is distinct from old.entry_a or new.entry_b is distinct from old.entry_b
    or new.stage is distinct from old.stage or new.pool is distinct from old.pool
    or new.next_match_id is distinct from old.next_match_id or new.next_slot is distinct from old.next_slot) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
-- or replace: sections 1-3 were applied to the hosted project by hand before the rest of this file, so they must be rerunnable.
create or replace trigger matches_bump_version before update on public.matches for each row execute function private.bump_match_version();

-- 2. Draw record ---------------------------------------------------------------------------------------------------------------------
alter table public.competitions
  add column if not exists draw_seed integer,
  add column if not exists draw_mode text check (draw_mode is null or draw_mode in ('random', 'manual')),
  add column if not exists draw_algorithm text,
  add column if not exists drawn_at timestamptz;  -- who drew is in audit_log (public tables never carry account ids)
comment on column public.competitions.draw_seed is 'Seed of the random draw that built this competition''s schedule (null for a manual order). With draw_algorithm it reproduces the draw.';

-- 3. Pool ties -----------------------------------------------------------------------------------------------------------------------
create table if not exists public.pool_tie_decisions (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  part text not null default '',
  rank integer not null check (rank >= 1),
  note text not null check (char_length(note) >= 3),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  primary key (competition_id, entry_id)
);
-- "if not exists" must not hide a different table: an existing one has to have exactly these columns and constraints.
do $do$
begin
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attnum)
      from pg_attribute a where a.attrelid = 'public.pool_tie_decisions'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'competition_id uuid not null, entry_id uuid not null, part text not null, rank integer not null, note text not null, decided_by uuid not null, decided_at timestamp with time zone not null'
  or (select count(*) from pg_constraint where conrelid = 'public.pool_tie_decisions'::regclass) <> 5 then
    raise exception 'public.pool_tie_decisions exists with a different shape; reconcile it by hand';
  end if;
end $do$;
alter table public.pool_tie_decisions enable row level security;
drop policy if exists pool_tie_decisions_read on public.pool_tie_decisions;
create policy pool_tie_decisions_read on public.pool_tie_decisions for select to authenticated using (private.is_organizer(private.event_of_competition(competition_id)));
grant select on public.pool_tie_decisions to authenticated;

-- One ranking rule for round robins and pools: wins, score difference, head-to-head wins among entries level on both, points scored,
-- then an organizer's recorded decision. Entries still level after that share a rank and are "tied".
create or replace function private.group_ranks(p_comp uuid)
returns table(lvl text, part text, ent uuid, w bigint, l bigint, sf bigint, sa bigint, diff bigint, h2h bigint, manual integer, raw_rank bigint, wrank bigint, tied boolean)
language sql stable security definer set search_path = '' as $$
  with k as (select structure from public.competitions where id = p_comp),
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
  h2h as (
    select a.ent, a.lvl, a.part, count(*) filter (where g.won) as h
    from st a left join st b on b.lvl = a.lvl and b.part = a.part and b.w = a.w and b.diff = a.diff and b.ent <> a.ent
              left join gs g on g.me = a.ent and g.opp = b.ent and g.lvl = a.lvl and g.part = a.part
    group by a.ent, a.lvl, a.part),
  base as (
    select st.*, coalesce(h.h, 0) as h, td.rank as manual from st
    left join h2h h on h.ent = st.ent and h.lvl = st.lvl and h.part = st.part
    left join public.pool_tie_decisions td on td.competition_id = p_comp and td.entry_id = st.ent),
  ranked as (
    select b.*, rank() over (partition by b.lvl, b.part order by b.w desc, b.diff desc, b.h desc, b.sf desc) as raw_rank,
           rank() over (partition by b.lvl, b.part order by b.w desc, b.diff desc, b.h desc, b.sf desc, coalesce(b.manual, 1000000)) as wrank
    from base b)
  select r.lvl, r.part, r.ent, r.w, r.l, r.sf, r.sa, r.diff, r.h, r.manual, r.raw_rank, r.wrank,
         (count(*) over (partition by r.lvl, r.part, r.wrank) > 1)
  from ranked r
$$;
revoke execute on function private.group_ranks(uuid) from public, anon, authenticated;


-- The league points rule as two small pure functions, shared by finish_competition and checked against src/lib/tournament.ts
-- with the vectors in supabase/tests/vectors/league_points.json.
create or replace function private.base_points(p_pool_wins integer, p_elim_wins integer, p_place integer) returns numeric
language sql immutable set search_path = '' as $$
  select (coalesce(p_pool_wins, 0) + 2 * coalesce(p_elim_wins, 0) + case p_place when 1 then 6 when 2 then 4 when 3 then 2 else 0 end)::numeric
$$;
create or replace function private.tier_points(p_base numeric, p_tier text, p_source text) returns numeric
language sql stable set search_path = '' as $$
  select case when p_tier is null then 0::numeric else round(p_base * coalesce(
    (select case p_source when 'league_structure' then t.multiplier_league_structure else t.multiplier_tournament_structure end from public.ref_tiers t where t.name = p_tier), 0), 2) end
$$;

-- compute_places: identical to the previous definition except that group ranking now comes from private.group_ranks.
create or replace function private.compute_places(p_comp uuid)
returns table(entry_id uuid, final_place integer, pool_wins integer, elim_wins integer, base_points numeric)
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
  wr as (select g.lvl, g.part, g.ent, g.w, g.diff, g.sf, g.wrank from private.group_ranks(p_comp) g),
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
      private.base_points((select count(*) from gs where gs.me = p.ent and gs.won)::int,
                          (select count(*) from sides sd where sd.me = p.ent and sd.won and sd.stage in ('elimination', 'third_place', 'final'))::int,
                          case when p.g in (1, 2, 3) then p.place::int end) end
  from placed p
$$;

-- Entries (by pool) whose rank is level and falls within the top `p_top` places: these must be decided by an organizer.
create or replace function private.unresolved_ties(p_comp uuid, p_top integer) returns table(part text, ent uuid, rank bigint)
language sql stable security definer set search_path = '' as $$
  select g.part, g.ent, g.wrank from private.group_ranks(p_comp) g where g.tied and g.wrank <= p_top
$$;
revoke execute on function private.unresolved_ties(uuid, integer) from public, anon, authenticated;

-- What the organizer screen and the bracket builder both read: the same ranking, with ties and decisions visible.
create or replace function public.pool_standings(p_competition uuid)
returns table(part text, entry_id uuid, wins integer, losses integer, score_for integer, score_against integer, diff integer, head_to_head integer, rank integer, tied boolean, decided boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.event_of_competition(p_competition);
  if v_event is null or not (private.is_event_public(v_event) or private.can_score(v_event)) then return; end if;
  return query
  select g.part, g.ent, g.w::int, g.l::int, g.sf::int, g.sa::int, g.diff::int, g.h2h::int, g.wrank::int, g.tied, (g.manual is not null)
  from private.group_ranks(p_competition) g order by g.part, g.wrank, g.ent;
end $$;
grant execute on function public.pool_standings(uuid) to anon, authenticated;

create or replace function public.record_tie_decision(p_competition uuid, p_part text, p_order uuid[], p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_part text := coalesce(p_part, ''); v_raw bigint; v_group uuid[]; i int;
begin
  v_event := private.event_of_competition(p_competition);
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can decide a tie' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why this order was chosen' using errcode = '22023'; end if;
  if p_order is null or cardinality(p_order) < 2 then raise exception 'list the tied entries in the order they should finish' using errcode = '22023'; end if;
  perform 1 from public.competitions where id = p_competition for update;
  select g.raw_rank into v_raw from private.group_ranks(p_competition) g where g.part = v_part and g.ent = p_order[1];
  if v_raw is null then raise exception 'that entry has no standing in this pool yet' using errcode = '22023'; end if;
  select array_agg(g.ent) into v_group from private.group_ranks(p_competition) g where g.part = v_part and g.raw_rank = v_raw;
  if cardinality(v_group) < 2 then raise exception 'there is no tie to decide here' using errcode = '22023'; end if;
  if not (v_group @> p_order and p_order @> v_group and cardinality(p_order) = cardinality(v_group)) then
    raise exception 'list exactly the tied entries, each once' using errcode = '22023'; end if;
  delete from public.pool_tie_decisions where competition_id = p_competition and entry_id = any (v_group);
  for i in 1 .. cardinality(p_order) loop
    insert into public.pool_tie_decisions (competition_id, entry_id, part, rank, note, decided_by) values (p_competition, p_order[i], v_part, i, btrim(p_note), auth.uid());
  end loop;
  perform private.audit(v_event, 'pool.tie_decided', p_competition::text, jsonb_build_object('pool', v_part, 'order', to_jsonb(p_order), 'note', btrim(p_note)));
end $$;
grant execute on function public.record_tie_decision(uuid, text, uuid[], text) to authenticated;

-- A decision describes the standings at one moment: changing a pool or round-robin result clears it.
create or replace function private.clear_tie_decisions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pool_tie_decisions where competition_id = new.competition_id;
  return new;
end $$;
create trigger matches_clear_tie_decisions after update of queue_state, result, winner_entry_id, score_a, score_b on public.matches
  for each row when (old.stage in ('pool', 'round_robin') and (old.queue_state = 'final' or new.queue_state = 'final'))
  execute function private.clear_tie_decisions();

-- 4. Official results: append-only revision log, no direct writes ------------------------------------------------------------------
create table public.result_revisions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id uuid not null,
  revision integer not null,
  action text not null check (action in ('computed', 'recomputed', 'corrected', 'superseded', 'voided')),
  old_place integer, old_points numeric,
  new_place integer, new_points numeric,
  reason text,
  actor uuid,
  created_at timestamptz not null default now(),
  unique (competition_id, entry_id, revision)
);
create index result_revisions_comp_idx on public.result_revisions (competition_id, created_at);
alter table public.result_revisions enable row level security;
create policy result_revisions_read on public.result_revisions for select to authenticated using (private.is_organizer(private.event_of_competition(competition_id)));
grant select on public.result_revisions to authenticated;
create or replace function private.result_revisions_append_only() returns trigger language plpgsql as $$
begin raise exception 'the result revision log is append-only' using errcode = '42501'; end $$;
create trigger result_revisions_no_change before update or delete on public.result_revisions for each row execute function private.result_revisions_append_only();

create or replace function private.log_result_revision(p_comp uuid, p_entry uuid, p_action text, p_old_place integer, p_old_points numeric, p_new_place integer, p_new_points numeric, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.result_revisions (competition_id, entry_id, revision, action, old_place, old_points, new_place, new_points, reason, actor)
  select p_comp, p_entry, coalesce(max(revision), 0) + 1, p_action, p_old_place, p_old_points, p_new_place, p_new_points, p_reason, auth.uid()
  from public.result_revisions where competition_id = p_comp and entry_id = p_entry
$$;
revoke execute on function private.log_result_revision(uuid, uuid, text, integer, numeric, integer, numeric, text) from public, anon, authenticated;

-- Results are written only by finish_competition / correct_result / void_result (all logged).
drop policy results_organizer_write on public.results;
revoke insert, update, delete on public.results from authenticated;

create or replace function public.finish_competition(p_competition uuid, p_multiplier_source text default 'tournament_structure') returns integer
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_open int; v_mult numeric; n int := 0; r record; v_old public.results; v_pts numeric;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can finish a competition' using errcode = '42501'; end if;
  if p_multiplier_source is null or p_multiplier_source not in ('tournament_structure', 'league_structure') then
    raise exception 'multiplier source must be tournament_structure or league_structure' using errcode = '22023'; end if;
  if not exists (select 1 from public.matches where competition_id = p_competition) then raise exception 'this competition has no matches' using errcode = 'P0001'; end if;
  select count(*) into v_open from public.matches where competition_id = p_competition and queue_state <> 'final';
  if v_open > 0 then raise exception '% match(es) are not final yet', v_open using errcode = 'P0001'; end if;
  -- Finishing again recomputes from the matches; any change to a stored result is written to result_revisions ('recomputed').
  if exists (select 1 from public.result_revisions where competition_id = p_competition and action = 'corrected')
     and exists (select 1 from public.results where competition_id = p_competition) then
    raise exception 'results were corrected by hand; reopen a match to recompute them, or correct them again' using errcode = 'P0001'; end if;
  if v_k.structure = 'round_robin' and exists (select 1 from private.unresolved_ties(p_competition, 3)) then
    raise exception 'a tie for a medal place is not decided yet; record the order first' using errcode = 'P0001'; end if;
  if v_k.tier is not null then
    select case p_multiplier_source when 'league_structure' then multiplier_league_structure else multiplier_tournament_structure end into v_mult
      from public.ref_tiers where name = v_k.tier;
  end if;

  for r in select c.entry_id, c.final_place, c.base_points from private.compute_places(p_competition) c loop
    v_pts := private.tier_points(r.base_points, v_k.tier, p_multiplier_source);
    select * into v_old from public.results where competition_id = p_competition and entry_id = r.entry_id;
    if not found then
      insert into public.results (competition_id, entry_id, final_place, points) values (p_competition, r.entry_id, r.final_place, v_pts);
      perform private.log_result_revision(p_competition, r.entry_id, 'computed', null, null, r.final_place, v_pts, null);
    elsif v_old.final_place is distinct from r.final_place or v_old.points is distinct from v_pts then
      update public.results set final_place = r.final_place, points = v_pts where id = v_old.id;
      perform private.log_result_revision(p_competition, r.entry_id, 'recomputed', v_old.final_place, v_old.points, r.final_place, v_pts, null);
    end if;
    n := n + 1;
  end loop;
  for v_old in select * from public.results where competition_id = p_competition and entry_id not in (select c.entry_id from private.compute_places(p_competition) c) loop
    perform private.log_result_revision(p_competition, v_old.entry_id, 'superseded', v_old.final_place, v_old.points, null, null, 'entry no longer ranked');
    delete from public.results where id = v_old.id;
  end loop;
  update public.competitions set status = 'finished' where id = p_competition;
  perform private.audit(v_k.event_id, 'competition.finished', p_competition::text,
    jsonb_build_object('entries', n, 'tier', v_k.tier, 'multiplier', v_mult, 'source', p_multiplier_source));
  return n;
end $$;

create or replace function public.correct_result(p_competition uuid, p_entry uuid, p_place integer, p_points numeric, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_old public.results;
begin
  v_event := private.event_of_competition(p_competition);
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can correct an official result' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the result is being corrected' using errcode = '22023'; end if;
  if p_place is null or p_place < 1 or p_points is null or p_points < 0 then raise exception 'place must be 1 or more and points 0 or more' using errcode = '22023'; end if;
  select * into v_old from public.results where competition_id = p_competition and entry_id = p_entry for update;
  if not found then raise exception 'there is no official result for that entry' using errcode = 'P0002'; end if;
  update public.results set final_place = p_place, points = p_points where id = v_old.id;
  perform private.log_result_revision(p_competition, p_entry, 'corrected', v_old.final_place, v_old.points, p_place, p_points, btrim(p_reason));
  perform private.audit(v_event, 'result.corrected', p_competition::text, jsonb_build_object('entry', p_entry, 'reason', btrim(p_reason)));
end $$;
grant execute on function public.correct_result(uuid, uuid, integer, numeric, text) to authenticated;

create or replace function public.void_result(p_competition uuid, p_entry uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_old public.results;
begin
  v_event := private.event_of_competition(p_competition);
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can void an official result' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the result is being voided' using errcode = '22023'; end if;
  select * into v_old from public.results where competition_id = p_competition and entry_id = p_entry for update;
  if not found then raise exception 'there is no official result for that entry' using errcode = 'P0002'; end if;
  perform private.log_result_revision(p_competition, p_entry, 'voided', v_old.final_place, v_old.points, null, null, btrim(p_reason));
  delete from public.results where id = v_old.id;
  perform private.audit(v_event, 'result.voided', p_competition::text, jsonb_build_object('entry', p_entry, 'reason', btrim(p_reason)));
end $$;
grant execute on function public.void_result(uuid, uuid, text) to authenticated;

-- Reopening a match supersedes the competition's results: they leave the current record, but stay in result_revisions with the reason.
create or replace function private.unfinish_competition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; r public.results; v_reason text := coalesce(nullif(current_setting('bos.reopen_reason', true), ''), 'a match was reopened or added');
begin
  if tg_op = 'UPDATE' and not (old.queue_state = 'final' and new.queue_state <> 'final') then return new; end if;
  if tg_op = 'INSERT' and new.queue_state = 'final' then return new; end if;
  select event_id into v_event from public.competitions where id = new.competition_id and status = 'finished';
  if found then
    for r in select * from public.results where competition_id = new.competition_id loop
      perform private.log_result_revision(new.competition_id, r.entry_id, 'superseded', r.final_place, r.points, null, null, v_reason);
    end loop;
    delete from public.results where competition_id = new.competition_id;
    update public.competitions set status = 'running' where id = new.competition_id;
    perform private.audit(v_event, 'competition.reopened', new.competition_id::text, jsonb_build_object('match', new.id, 'reason', v_reason, 'results_superseded', true));
  end if;
  return new;
end $$;

-- reopen_match: same body, plus the reason travels to the trigger above.
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reopen_match';
  v_def := replace(v_def, $$  v_loser := case v_m.result when 'a' then v_m.entry_b when 'b' then v_m.entry_a else null end;$$,
    $$  perform set_config('bos.reopen_reason', btrim(p_reason), true);
  v_loser := case v_m.result when 'a' then v_m.entry_b when 'b' then v_m.entry_a else null end;$$);
  if position('bos.reopen_reason' in v_def) = 0 then raise exception 'reopen_match body did not match the expected text'; end if;
  execute v_def;
end $do$;

-- 5. Atomic schedule construction ----------------------------------------------------------------------------------------------------
-- p_matches: [{key, stage, round_label, position, pool?, a?, b?, next_key?, next_slot?}] planned by the browser; the database validates
-- and persists it in ONE transaction under a lock on the competition, so concurrent requests cannot interleave and a failure leaves
-- nothing behind. p_mode: new (no matches may exist), replace (nothing may be final), append (build the bracket after finished pools).
create or replace function public.build_schedule(p_competition uuid, p_matches jsonb, p_mode text, p_draw jsonb default null, p_advance integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_k public.competitions; v_ids jsonb := '{}'::jsonb; v_el jsonb; v_key text; v_id uuid; v_n int := 0; v_existing int; v_final int;
  v_old uuid[]; v_expect uuid[]; v_got uuid[]; v_format text; v_next text;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can build a schedule' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('new', 'replace', 'append') then raise exception 'mode must be new, replace or append' using errcode = '22023'; end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) > 400 then raise exception 'send a list of at most 400 planned matches' using errcode = '22023'; end if;
  select count(*), count(*) filter (where queue_state = 'final') into v_existing, v_final from public.matches where competition_id = p_competition;

  if p_mode = 'new' and v_existing > 0 then raise exception 'This competition already has matches. Replace them to start over.' using errcode = 'P0001'; end if;
  if p_mode = 'replace' then
    if v_final > 0 then raise exception 'Some matches are already final. Reopen them before replacing the schedule.' using errcode = 'P0001'; end if;
    select array_agg(id) into v_old from public.matches where competition_id = p_competition;
  end if;
  if p_mode = 'append' then
    if p_advance is null or p_advance < 1 then raise exception 'say how many advance from each pool' using errcode = '22023'; end if;
    if not exists (select 1 from public.matches where competition_id = p_competition and stage = 'pool') then raise exception 'there is no pool play to build a bracket from' using errcode = 'P0001'; end if;
    if exists (select 1 from public.matches where competition_id = p_competition and stage in ('elimination', 'third_place', 'final')) then
      raise exception 'the bracket for this competition was already built' using errcode = 'P0001'; end if;
    if exists (select 1 from public.matches where competition_id = p_competition and stage = 'pool' and queue_state <> 'final') then
      raise exception 'pool play is not finished' using errcode = 'P0001'; end if;
    if v_k.structure <> 'pools_elimination' then update public.competitions set structure = 'pools_elimination' where id = p_competition; end if;
    if exists (select 1 from private.unresolved_ties(p_competition, p_advance)) then
      raise exception 'a pool tie affects who advances; record the order first' using errcode = 'P0001'; end if;
    select array_agg(g.ent order by g.ent) into v_expect from private.group_ranks(p_competition) g where g.lvl = 'p' and g.wrank <= p_advance;
  end if;

  for v_el in select value from jsonb_array_elements(p_matches) loop
    v_key := v_el ->> 'key';
    if v_key is null or v_ids ? v_key then raise exception 'every planned match needs its own key' using errcode = '22023'; end if;
    v_id := gen_random_uuid();
    v_ids := v_ids || jsonb_build_object(v_key, v_id);
    insert into public.matches (id, competition_id, stage, round_label, position, pool, entry_a, entry_b)
    values (v_id, p_competition, v_el ->> 'stage', coalesce(v_el ->> 'round_label', ''), coalesce((v_el ->> 'position')::int, 0), nullif(v_el ->> 'pool', ''),
            nullif(v_el ->> 'a', '')::uuid, nullif(v_el ->> 'b', '')::uuid);
    v_n := v_n + 1;
  end loop;
  for v_el in select value from jsonb_array_elements(p_matches) loop
    v_next := v_el ->> 'next_key';
    if v_next is not null then
      if not (v_ids ? v_next) then raise exception 'planned match % links to unknown match %', v_el ->> 'key', v_next using errcode = '22023'; end if;
      update public.matches set next_match_id = (v_ids ->> v_next)::uuid, next_slot = v_el ->> 'next_slot' where id = (v_ids ->> (v_el ->> 'key'))::uuid;
    end if;
  end loop;

  if p_mode = 'append' then
    select array_agg(distinct x order by x) into v_got
    from (select nullif(e.value ->> 'a', '')::uuid x from jsonb_array_elements(p_matches) e union all select nullif(e.value ->> 'b', '')::uuid from jsonb_array_elements(p_matches) e) s where x is not null;
    if v_got is distinct from v_expect then raise exception 'the bracket does not match the pool standings; reload and try again' using errcode = 'P0001'; end if;
  end if;
  if p_mode = 'replace' and v_old is not null then delete from public.matches where id = any (v_old); end if;

  if p_mode <> 'append' and p_draw is not null then
    v_format := p_draw ->> 'format';
    update public.competitions set
      draw_seed = case when p_draw ->> 'mode' = 'random' then (p_draw ->> 'seed')::int end,
      draw_mode = p_draw ->> 'mode', draw_algorithm = p_draw ->> 'algorithm', drawn_at = now(),
      structure = case v_format when 'pools' then 'pools_elimination' when 'single_elimination' then 'elimination' when 'round_robin' then 'round_robin' else structure end
    where id = p_competition;
  end if;
  perform private.audit(v_k.event_id, 'schedule.built', p_competition::text, jsonb_build_object('mode', p_mode, 'matches', v_n, 'draw', p_draw, 'advance', p_advance));
  return v_n;
end $$;
grant execute on function public.build_schedule(uuid, jsonb, text, jsonb, integer) to authenticated;

-- 6. Team identity at the event ------------------------------------------------------------------------------------------------------
alter table public.entries add column if not exists team_name_at_event text;
update public.entries e set team_name_at_event = t.name from public.teams t where t.id = e.team_id and e.team_name_at_event is null;

create or replace function private.snapshot_entry_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.team_id is null then new.team_name_at_event := null; return new; end if;
  if tg_op = 'INSERT' or (new.team_id is distinct from old.team_id and coalesce(current_setting('bos.merging', true), '') <> 'on') then
    select t.name into new.team_name_at_event from public.teams t where t.id = new.team_id;
  end if;
  return new;
end $$;
create trigger entries_snapshot_team before insert or update of team_id on public.entries for each row execute function private.snapshot_entry_team();

create table public.team_merges (
  removed_team_id uuid primary key,
  removed_name text not null,
  removed_slug text not null,
  kept_team_id uuid not null references public.teams (id) on delete cascade,
  was_public boolean not null,
  merged_at timestamptz not null default now()
);
alter table public.team_merges enable row level security;
create policy team_merges_read on public.team_merges for select to anon, authenticated using (was_public);
grant select on public.team_merges to anon, authenticated;

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'merge_teams';
  v_def := replace(v_def, $$  update public.entries set team_id = p_keep where team_id = p_remove;$$,
    $$  perform set_config('bos.merging', 'on', true);
  update public.entries set team_id = p_keep where team_id = p_remove;
  perform set_config('bos.merging', '', true);$$);
  v_def := replace(v_def, $$  delete from public.teams where id = p_remove;$$,
    $$  insert into public.team_merges (removed_team_id, removed_name, removed_slug, kept_team_id, was_public) values (p_remove, v_remove.name, v_remove.slug, p_keep, v_remove.status = 'approved');
  delete from public.teams where id = p_remove;$$);
  if position('team_merges' in v_def) = 0 or position('bos.merging' in v_def) = 0 then raise exception 'merge_teams body did not match the expected text'; end if;
  execute v_def;
end $do$;

-- team_history: the name used at the event, and the team as it is now.
create or replace view public.team_history with (security_invoker = true) as
 SELECT e.team_id, ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.starts_on, k.id AS competition_id, k.name AS competition_name, k.ruleset, r.final_place, r.points,
        private.is_synthetic('event', ev.id) AS synthetic,
        coalesce(e.team_name_at_event, t.name) AS team_name_at_event, t.name AS team_current_name, t.slug AS team_current_slug
   FROM ((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN teams t ON ((t.id = e.team_id)))
  WHERE e.team_id IS NOT NULL;
