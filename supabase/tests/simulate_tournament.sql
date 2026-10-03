-- BuhurtOS tournament simulation. Plays the whole competition path through the real RPCs and row-level-security policies:
-- build the matches, queue them onto fields, record score events, finalize, reopen and re-finalize, third-place routing,
-- standings, champions. Runs against the TEST dataset (supabase/seed/test_tournament.sql), which this script loads if it is missing.
--
-- Run (local throwaway database only):   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/simulate_tournament.sql
-- or use supabase/tests/run_simulation.sh, which builds a scratch database from the migrations first (needs supabase/tests/local_stubs.sql: roles, auth.uid(), publication).
-- Extra psql variables: -v keep=1 commits instead of rolling back; -v old_pool_seeding=1 uses the pre-fix pool seeding to show the defect it found.
-- Everything is rolled back at the end (set the psql variable  -v keep=1  to COMMIT instead, for inspecting the data afterwards).
-- Any failed check raises an exception, so the run stops with a non-zero exit status. NEVER run this against the real project.
--
-- The SQL planner below mirrors src/lib/bracket.ts (single elimination with seed order, byes, links and a third-place match;
-- circle-method round robin; pools then a bracket seeded from the pool standings). Winners are pseudo-random but deterministic:
-- they come from a hash of the competition name, stage, pool, round and position, never from random ids.
\set ON_ERROR_STOP on
\if :{?keep}
\else
  \set keep 0
\endif
\if :{?old_pool_seeding}
\else
  \set old_pool_seeding 0
\endif

begin;
\ir ../seed/test_tournament.sql
\o /dev/null

create schema sim;
-- Results can no longer be inserted directly by organizers (Pack 02). The simulation records fixture results as the database owner.
create function sim.put_result(p_comp uuid, p_entry uuid, p_place integer) returns void language sql security definer as $$
  insert into public.results (competition_id, entry_id, final_place) values (p_comp, p_entry, p_place)
$$;
grant execute on function sim.put_result(uuid, uuid, integer) to authenticated, anon;

create table sim.log (n serial, section text, label text);
create table sim.metrics (comp text, entries int, pool_matches int, elim_matches int, third_matches int, final_matches int, total int, draws int, byes int, champion text);
-- planned matches (mirror of PlannedMatch): key links to nextkey, id is generated here like the app does
create table sim.plan (comp uuid, key text, stage text, label text, pos int, pool text, a uuid, b uuid, nextkey text, nextslot text, id uuid default gen_random_uuid(), done boolean default false, primary key (comp, key));
create table sim.cfg (k text primary key, v text);
insert into sim.cfg values ('section', 'setup'), ('old_pool_seeding', :'old_pool_seeding');

create function sim.section(p text) returns void language sql as $$ update sim.cfg set v = p where k = 'section' $$;
create function sim.ok(p_label text, p_ok boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'SIM FAIL [%]: % %', (select v from sim.cfg where k = 'section'), p_label, coalesce('(' || p_detail || ')', ''); end if;
  insert into sim.log (section, label) values ((select v from sim.cfg where k = 'section'), p_label);
end $$;
create function sim.expect_error(p_label text, p_stmt text, p_state text default null) returns void language plpgsql as $$
declare got text; failed boolean := false;
begin
  begin execute p_stmt; exception when others then failed := true; got := sqlstate; end;
  perform sim.ok(p_label || ' (expected an error)', failed, 'statement succeeded: ' || p_stmt);
  if p_state is not null then perform sim.ok(p_label || ' (sqlstate ' || p_state || ')', got = p_state, 'got ' || got); end if;
end $$;

-- ---------------------------------------------------------------- planner (mirror of src/lib/bracket.ts)
create function sim.round_label(entrants int) returns text language sql immutable as $$
  select case when entrants <= 2 then 'Final' when entrants = 4 then 'Semifinal' when entrants = 8 then 'Quarterfinal' else 'Round of ' || entrants end $$;

create function sim.seed_order(p_size int) returns int[] language plpgsql immutable as $$
declare o int[] := array[1]; nxt int; r int[]; s int;
begin
  while cardinality(o) < p_size loop
    nxt := cardinality(o) * 2; r := '{}';
    foreach s in array o loop r := r || s || (nxt + 1 - s); end loop;
    o := r;
  end loop;
  return o;
end $$;

-- buildSingleElimination(entries, {manualOrder: true, thirdPlace})
create function sim.plan_elim(p_comp uuid, p_entries uuid[], p_third boolean) returns void language plpgsql as $$
declare n int := cardinality(p_entries); size int := 2; rounds int := 1; ord int[]; r int; i int; cnt int; a uuid; b uuid; nxt text; slot text; ex boolean;
begin
  if (select count(distinct x) from unnest(p_entries) x) <> n then raise exception 'an entry cannot appear twice in a bracket'; end if;
  if n < 2 then return; end if;
  while size < n loop size := size * 2; rounds := rounds + 1; end loop;
  ord := sim.seed_order(size);
  for r in 1..rounds loop
    cnt := size / (2 ^ r)::int;
    for i in 0..cnt - 1 loop
      if r = 1 then
        a := case when ord[2 * i + 1] <= n then p_entries[ord[2 * i + 1]] end;
        b := case when ord[2 * i + 2] <= n then p_entries[ord[2 * i + 2]] end;
        if a is null or b is null then continue; end if; -- a bye: no match
        insert into sim.plan (comp, key, stage, label, pos, a, b) values (p_comp, 'e1-' || i, case when rounds = 1 then 'final' else 'elimination' end, sim.round_label(size), i, a, b);
      else
        insert into sim.plan (comp, key, stage, label, pos) values (p_comp, 'e' || r || '-' || i, case when r = rounds then 'final' else 'elimination' end, sim.round_label(size / (2 ^ (r - 1))::int), i);
      end if;
    end loop;
  end loop;
  for r in 1..rounds - 1 loop
    for i in 0..size / (2 ^ r)::int - 1 loop
      nxt := 'e' || (r + 1) || '-' || (i / 2);
      slot := case when i % 2 = 0 then 'a' else 'b' end;
      select exists (select 1 from sim.plan where comp = p_comp and key = 'e' || r || '-' || i) into ex;
      if ex then update sim.plan set nextkey = nxt, nextslot = slot where comp = p_comp and key = 'e' || r || '-' || i;
      elsif r = 1 then
        a := coalesce(case when ord[2 * i + 1] <= n then p_entries[ord[2 * i + 1]] end, case when ord[2 * i + 2] <= n then p_entries[ord[2 * i + 2]] end);
        execute format('update sim.plan set %I = $1 where comp = $2 and key = $3', slot) using a, p_comp, nxt;
      end if;
    end loop;
  end loop;
  if p_third and n >= 4 then insert into sim.plan (comp, key, stage, label, pos) values (p_comp, 'third', 'third_place', 'Third place', 0); end if;
end $$;

-- buildRoundRobin (circle method); p_pool null means a plain round robin
create function sim.plan_rr(p_comp uuid, p_entries uuid[], p_pool text, p_stage text) returns void language plpgsql as $$
declare slots uuid[] := p_entries; total int; ring uuid[]; r int; i int; pos int; a uuid; b uuid; t uuid; prefix text;
begin
  if (select count(distinct x) from unnest(p_entries) x) <> cardinality(p_entries) then raise exception 'an entry cannot appear twice in a round robin'; end if;
  if cardinality(slots) < 2 then return; end if;
  if cardinality(slots) % 2 = 1 then slots := slots || null::uuid; end if;
  total := cardinality(slots);
  prefix := case when p_pool is not null then 'p' || p_pool || '-' else 'rr-' end;
  ring := slots;
  for r in 0..total - 2 loop
    pos := 0;
    for i in 0..total / 2 - 1 loop
      a := ring[i + 1]; b := ring[total - i];
      if a is null or b is null then continue; end if;
      if i = 0 and r % 2 = 1 then t := a; a := b; b := t; end if;
      insert into sim.plan (comp, key, stage, label, pos, pool, a, b) values (p_comp, prefix || 'r' || (r + 1) || '-' || pos, p_stage, 'Round ' || (r + 1), pos, p_pool, a, b);
      pos := pos + 1;
    end loop;
    ring := array[ring[1], ring[total]] || ring[2:total - 1];
  end loop;
end $$;

-- Insert the planned matches (two passes, like src/data/matches.ts generateMatches: rows first, then the next_match links).
create function sim.insert_plan(p_comp uuid) returns int language plpgsql as $$
declare n int;
begin
  insert into public.matches (id, competition_id, stage, round_label, position, pool, entry_a, entry_b)
    select id, comp, stage, label, pos, pool, a, b from sim.plan where comp = p_comp and not done;
  get diagnostics n = row_count;
  update public.matches m set next_match_id = nx.id, next_slot = p.nextslot
    from sim.plan p join sim.plan nx on nx.comp = p.comp and nx.key = p.nextkey
    where m.id = p.id and p.comp = p_comp and not p.done and p.nextkey is not null;
  update sim.plan set done = true where comp = p_comp;
  return n;
end $$;

-- ---------------------------------------------------------------- pool qualifiers (mirror of seedPoolQualifiers)
create function sim.round_ord(p_stage text, p_label text) returns int language sql immutable as $$
  select case when p_stage in ('pool', 'round_robin') then coalesce((regexp_match(p_label, '(\d+)'))[1]::int, 0)
              when p_label ~ '^Round of \d+$' then -(regexp_match(p_label, '(\d+)'))[1]::int
              when p_label = 'Quarterfinal' then -8 when p_label = 'Semifinal' then -4 else 0 end $$;

-- Round-1 meetings between two qualifiers of the same pool, for a given seeding (1 = best).
create function sim.same_pool_clashes(p_seeding uuid[], p_pools text[]) returns int language plpgsql immutable as $$
declare n int := cardinality(p_seeding); size int := 2; ord int[]; i int; clashes int := 0;
begin
  while size < n loop size := size * 2; end loop;
  ord := sim.seed_order(size);
  for i in 0..size / 2 - 1 loop
    if ord[2 * i + 1] <= n and ord[2 * i + 2] <= n and p_pools[ord[2 * i + 1]] = p_pools[ord[2 * i + 2]] then clashes := clashes + 1; end if;
  end loop;
  return clashes;
end $$;

-- The rk-th best entry of every pool (pool order A, B, ...), ranked like rankPools: wins, score difference, points scored, fewest losses, seed.
create function sim.rank_row(p_comp uuid, p_rk int) returns uuid[] language sql stable as $$
  select coalesce(array_agg(x.id order by x.pool), '{}') from (
    select e.id, e.pool, row_number() over (partition by e.pool order by s.wins desc, (s.score_for - s.score_against) desc, s.score_for desc, s.losses asc, e.seed asc) as rnk
    from public.entries e join public.competition_standings s on s.entry_id = e.id where e.competition_id = p_comp and e.pool is not null) x
  where x.rnk = p_rk + 1 $$;
create function sim.rev(p uuid[]) returns uuid[] language sql immutable as $$ select coalesce(array_agg(x order by o desc), '{}') from unnest(p) with ordinality t(x, o) $$;
create function sim.pools_of(p uuid[]) returns text[] language sql stable as $$ select array_agg((select e.pool from public.entries e where e.id = q) order by o) from unnest(p) with ordinality t(q, o) $$;

-- seedPoolQualifiers: winners are the top seeds. Each later rank row is placed as the rotation (or reversed rotation) that causes the fewest
-- same-pool meetings in bracket round 1. The OLD rule (sim.cfg old_pool_seeding = 1) reversed every second row, which paired seed 1 with its
-- own pool's runner-up.
create function sim.pool_qualifiers(p_comp uuid, p_adv int) returns uuid[] language plpgsql as $$
declare out uuid[] := '{}'; rk int; rw uuid[]; rest uuid[]; best uuid[]; best_c int; cand uuid[]; base uuid[]; fl uuid[]; s int; kk int; cl int;
  old boolean := (select v from sim.cfg where k = 'old_pool_seeding') = '1';
begin
  for rk in 0..p_adv - 1 loop
    rw := sim.rank_row(p_comp, rk);
    if rk = 0 then out := out || rw;
    elsif old then out := out || case when rk % 2 = 1 then sim.rev(rw) else rw end;
    else
      rest := '{}';
      for kk in rk + 1..p_adv - 1 loop rest := rest || sim.rank_row(p_comp, kk); end loop;
      best := rw; best_c := 1000000;
      for s in 0..1 loop
        base := case when s = 0 then rw else sim.rev(rw) end;
        for kk in 0..cardinality(base) - 1 loop
          cand := base[kk + 1:] || base[1:kk];
          fl := out || cand || rest;
          cl := sim.same_pool_clashes(fl, sim.pools_of(fl));
          if cl < best_c then best := cand; best_c := cl; end if;
        end loop;
      end loop;
      out := out || best;
    end if;
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- playing matches
create function sim.hash(p_text text) returns int language sql immutable as $$ select (hashtext(p_text)::bigint & 2147483647)::int $$;

-- Queue states, score events, finalize. p_stress: reopen and re-finalize with the opposite result and check every consequence.
create function sim.play(p_id uuid, p_stress boolean) returns void language plpgsql as $$
declare m public.matches; c public.competitions; h int; res text; sa int; sb int; nv int; ev uuid := gen_random_uuid(); got boolean; rtw int;
  m2 public.matches; nx public.matches; th public.matches; opp text; win uuid; lose uuid; semi_slot text;
begin
  select * into m from public.matches where id = p_id;
  select * into c from public.competitions where id = m.competition_id;
  perform sim.ok('match is scheduled before play', m.queue_state = 'scheduled' and m.result is null);
  perform sim.ok('both sides are set before play', m.entry_a is not null and m.entry_b is not null);

  perform public.set_match_queue(m.id, 'on_deck');
  perform sim.ok('queue on_deck', (select queue_state from public.matches where id = m.id) = 'on_deck');
  perform public.set_match_queue(m.id, 'in_the_hole', 'Field ' || (1 + m.position % 3));
  perform sim.ok('queue in_the_hole sets the field', (select field from public.matches where id = m.id) = 'Field ' || (1 + m.position % 3));
  perform public.set_match_queue(m.id, 'active', null);
  perform sim.ok('active with null field keeps the field', (select field from public.matches where id = m.id) = 'Field ' || (1 + m.position % 3) and (select queue_state from public.matches where id = m.id) = 'active');
  if m.position % 5 = 4 then
    perform public.set_match_queue(m.id, 'active', '');
    perform sim.ok('empty field clears it', (select field from public.matches where id = m.id) is null);
    perform public.set_match_queue(m.id, 'active', 'Field 9');
  end if;
  perform sim.ok('queue changes do not bump the version', (select version from public.matches where id = m.id) = m.version);

  got := public.record_score_event(ev, m.id, 'point', jsonb_build_object('side', 'a', 'n', 1), now());
  perform sim.ok('score event is stored', got);
  got := public.record_score_event(ev, m.id, 'point', jsonb_build_object('side', 'a', 'n', 1), now());
  perform sim.ok('replaying the same score event id is a no-op', not got);

  h := sim.hash(c.name || '|' || m.stage || '|' || coalesce(m.pool, '') || '|' || m.round_label || '|' || m.position);
  rtw := coalesce(c.rounds_to_win, 2);
  if m.stage in ('pool', 'round_robin') and h % 9 = 0 then
    res := 'draw'; sa := case when c.category in ('3v3', '5v5') then rtw - 1 else (h / 29) % 10 end; sb := sa;
  else
    res := case when (h / 7) % 2 = 0 then 'a' else 'b' end;
    if c.category in ('3v3', '5v5') then sa := rtw; sb := (h / 3) % rtw; else sa := 4 + (h / 3) % 9; sb := (h / 29) % sa; end if;
    if res = 'b' then nv := sa; sa := sb; sb := nv; end if;
  end if;

  -- a stale version is refused and changes nothing
  perform sim.expect_error('stale version is refused', format('select public.finalize_match(%L, %L, %s, %s, %L, %s)', m.id, res, sa, sb, '{}', m.version + 7), 'P0001');
  perform sim.ok('refused finalize left the match untouched', (select queue_state || coalesce(result, '') from public.matches where id = m.id) = 'active');

  nv := public.finalize_match(m.id, res, sa, sb, jsonb_build_object('sim', true, 'rounds', jsonb_build_array(sa, sb)), m.version);
  perform sim.ok('finalize returns version + 1', nv = m.version + 1);
  select * into m2 from public.matches where id = m.id;
  perform sim.ok('match is final with the result stored', m2.queue_state = 'final' and m2.result = res and m2.score_a = sa and m2.score_b = sb and m2.finalized_at is not null and m2.version = nv);
  perform sim.ok('winner is the entry of the winning side', m2.winner_entry_id is not distinct from case res when 'a' then m.entry_a when 'b' then m.entry_b else null end);
  perform sim.expect_error('a final match cannot be finalized again', format('select public.finalize_match(%L, %L, 1, 0, %L, %s)', m.id, 'a', '{}', nv), 'P0001');
  perform sim.expect_error('a final match cannot be queued again', format('select public.set_match_queue(%L, %L)', m.id, 'active'), 'P0001');
  perform sim.expect_error('a final match takes no more score events', format('select public.record_score_event(gen_random_uuid(), %L, %L)', m.id, 'point'), 'P0001');
  if m2.next_match_id is not null and m2.winner_entry_id is not null then
    select * into nx from public.matches where id = m2.next_match_id;
    perform sim.ok('winner moved into the next match slot', case m2.next_slot when 'a' then nx.entry_a else nx.entry_b end = m2.winner_entry_id);
  end if;

  -- Reopen, then finalize the opposite way: every consequence (next slot, third-place slot, version, cleared detail) is checked.
  if p_stress and res <> 'draw' then
    win := m2.winner_entry_id; lose := case res when 'a' then m.entry_b else m.entry_a end;
    select * into nx from public.matches where id = m2.next_match_id;
    if m.stage = 'elimination' and nx.stage = 'final' then select * into th from public.matches where competition_id = m.competition_id and stage = 'third_place'; end if;
    perform sim.expect_error('reopen needs a reason', format('select public.reopen_match(%L, %L)', m.id, ''), '22023');
    perform public.reopen_match(m.id, 'sim: correction');
    select * into m2 from public.matches where id = m.id;
    perform sim.ok('reopen clears the result', m2.queue_state = 'scheduled' and m2.result is null and m2.winner_entry_id is null and m2.score_a is null and m2.score_b is null and m2.finalized_at is null);
    perform sim.ok('reopen clears the stored detail', m2.detail = '{}'::jsonb);
    perform sim.ok('reopen bumps the version', m2.version = nv + 1);
    perform sim.ok('reopen keeps both sides', m2.entry_a = m.entry_a and m2.entry_b = m.entry_b);
    if nx.id is not null then
      select * into nx from public.matches where id = m2.next_match_id;
      perform sim.ok('reopen takes the winner back out of the next match', case m2.next_slot when 'a' then nx.entry_a else nx.entry_b end is null);
    end if;
    if th.id is not null then
      select * into th from public.matches where id = th.id;
      perform sim.ok('reopen takes the loser back out of the third-place match', th.entry_a is distinct from lose and th.entry_b is distinct from lose);
    end if;
    perform public.reopen_match(m.id, 'sim: second reopen');
    perform sim.ok('reopening an open match is a no-op', (select version from public.matches where id = m.id) = nv + 1);
    opp := case res when 'a' then 'b' else 'a' end;
    nv := public.finalize_match(m.id, opp, sb, sa, '{}', nv + 1);
    perform sim.ok('re-finalize works with the new version', nv = m.version + 3);
    select * into m2 from public.matches where id = m.id;
    perform sim.ok('re-finalized with the opposite winner', m2.result = opp and m2.winner_entry_id = lose);
    if nx.id is not null then
      select * into nx from public.matches where id = m2.next_match_id;
      perform sim.ok('new winner is in the next match', case m2.next_slot when 'a' then nx.entry_a else nx.entry_b end = lose);
    end if;
    if th.id is not null then
      select * into th from public.matches where id = th.id;
      perform sim.ok('new loser is in the third-place match', win in (th.entry_a, th.entry_b) and th.entry_a is distinct from lose and th.entry_b is distinct from lose, format('win=%s lose=%s third a=%s b=%s match pos=%s result=%s', win, lose, th.entry_a, th.entry_b, m.position, opp));
      select case when count(*) = 0 then 'a' else 'b' end into semi_slot from public.matches s where s.next_match_id = m.next_match_id and s.stage = 'elimination' and (s.position, s.id) < (m.position, m.id);
      perform sim.ok('third-place slot follows the position rule', case semi_slot when 'a' then th.entry_a else th.entry_b end = win);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- one competition, start to finish
create function sim.run_comp(p_comp uuid, p_stress boolean) returns void language plpgsql as $$
declare c public.competitions; ents uuid[]; n int; third boolean; size int := 2; exp_elim int; exp_pool int := 0; exp_third int := 0; exp_total int; planned int;
  cur public.matches; pools int; sizes int[]; pn text; i int; k int; pe uuid[]; off int := 0; quals uuid[]; adv int := 2; r1 int; draws int; byes int;
  fm public.matches; sm public.matches; tm public.matches; champ uuid; runner uuid; thirdw uuid; ranked uuid[]; clashes int; cnt int; last_state text;
begin
  select * into c from public.competitions where id = p_comp;
  perform sim.section(c.name);
  select coalesce(array_agg(id order by seed, id), '{}') into ents from public.entries where competition_id = p_comp and status in ('registered', 'checked_in');
  n := cardinality(ents);
  perform sim.ok('has entries', n >= 2);
  perform sim.ok('no matches yet', not exists (select 1 from public.matches where competition_id = p_comp));
  while size < n loop size := size * 2; end loop;
  third := c.category <> 'profight' and n >= 4;
  byes := size - n;

  if c.structure = 'elimination' then
    perform sim.plan_elim(p_comp, ents, third);
    planned := sim.insert_plan(p_comp);
    exp_elim := n - 1; exp_third := case when third then 1 else 0 end;
  elsif c.structure = 'round_robin' then
    perform sim.plan_rr(p_comp, ents, null, 'round_robin');
    planned := sim.insert_plan(p_comp);
    exp_pool := n * (n - 1) / 2; exp_elim := 0; byes := 0;
  else
    -- pools: splitPools(n, n/4); entries are dealt into pools by a deterministic shuffle (hash of seed), like drawPools with a fixed seed
    pools := n / 4; byes := 0;
    sizes := '{}'; k := n;
    for i in 0..pools - 1 loop sizes := sizes || ceil(k::numeric / (pools - i))::int; k := k - sizes[i + 1]; end loop;
    select coalesce(array_agg(id order by sim.hash('draw-42:' || seed), id), '{}') into ents from public.entries where competition_id = p_comp;
    for i in 0..pools - 1 loop
      pn := chr(65 + i); pe := ents[off + 1:off + sizes[i + 1]]; off := off + sizes[i + 1];
      update public.entries set pool = pn where id = any (pe);
      perform sim.plan_rr(p_comp, pe, pn, 'pool');
      exp_pool := exp_pool + sizes[i + 1] * (sizes[i + 1] - 1) / 2;
    end loop;
    planned := sim.insert_plan(p_comp);
    perform sim.ok('every entry has a pool', not exists (select 1 from public.entries where competition_id = p_comp and pool is null));
    perform sim.ok('pool sizes are as even as possible', (select max(c2) - min(c2) from (select count(*) c2 from public.entries where competition_id = p_comp group by pool) x) <= 1);
    adv := 2;
    exp_elim := pools * adv - 1; exp_third := 1;
  end if;
  perform sim.ok('planned count equals inserted count', planned = (select count(*) from public.matches where competition_id = p_comp));

  -- ---- structure of what was built (before any play)
  perform sim.ok('pool/round-robin match count', (select count(*) from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin')) = exp_pool,
    (select count(*)::text from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin')) || ' vs ' || exp_pool);
  if c.structure = 'elimination' then
    perform sim.ok('elimination matches = n - 1', (select count(*) from public.matches where competition_id = p_comp and stage in ('elimination', 'final')) = n - 1);
    perform sim.ok('exactly one final', (select count(*) from public.matches where competition_id = p_comp and stage = 'final') = 1);
    perform sim.ok('third-place match iff planned', (select count(*) from public.matches where competition_id = p_comp and stage = 'third_place') = exp_third);
    perform sim.ok('first-round matches = n - size/2', (select count(*) from public.matches where competition_id = p_comp and stage in ('elimination', 'final') and round_label = sim.round_label(size)) = n - size / 2);
    perform sim.ok('every entry is placed exactly once before play', (select count(distinct x) from public.matches m, unnest(array[m.entry_a, m.entry_b]) x where m.competition_id = p_comp and x is not null) = n
      and (select count(x) from public.matches m, unnest(array[m.entry_a, m.entry_b]) x where m.competition_id = p_comp and x is not null) = n);
    perform sim.ok('byes = size - n entries placed past round 1', (select count(x) from public.matches m, unnest(array[m.entry_a, m.entry_b]) x where m.competition_id = p_comp and x is not null and m.round_label <> sim.round_label(size)) = byes
      or n = size);
    perform sim.ok('every match but the final and third place links onward', not exists (select 1 from public.matches where competition_id = p_comp and stage = 'elimination' and next_match_id is null));
    perform sim.ok('the final and third place link nowhere', not exists (select 1 from public.matches where competition_id = p_comp and stage in ('final', 'third_place') and next_match_id is not null));
    perform sim.ok('no slot is fed twice', not exists (select 1 from public.matches where competition_id = p_comp and next_match_id is not null group by next_match_id, next_slot having count(*) > 1));
  end if;

  -- ---- first, a few refusals on an unplayable or unready match
  if exists (select 1 from public.matches where competition_id = p_comp and (entry_a is null or entry_b is null)) then
    select * into cur from public.matches where competition_id = p_comp and (entry_a is null or entry_b is null) order by position limit 1;
    perform sim.expect_error('a match with an empty side cannot be finalized', format('select public.finalize_match(%L, %L, 1, 0, %L, %s)', cur.id, 'a', '{}', cur.version), '22023');
  end if;
  select * into cur from public.matches where competition_id = p_comp and entry_a is not null and entry_b is not null order by stage, position limit 1;
  perform sim.expect_error('null version is refused', format('select public.finalize_match(%L, %L, 1, 0, %L, null)', cur.id, 'a', '{}'), '22023');
  perform sim.expect_error('winner with the lower score is refused', format('select public.finalize_match(%L, %L, 0, 3, %L, %s)', cur.id, 'a', '{}', cur.version), '22023');
  perform sim.expect_error('negative score is refused', format('select public.finalize_match(%L, %L, -1, 0, %L, %s)', cur.id, 'a', '{}', cur.version), '22023');
  perform sim.expect_error('unknown result is refused', format('select public.finalize_match(%L, %L, 1, 0, %L, %s)', cur.id, 'x', '{}', cur.version), '22023');
  if cur.stage not in ('pool', 'round_robin') then
    perform sim.expect_error('elimination cannot end in a draw', format('select public.finalize_match(%L, %L, 1, 1, %L, %s)', cur.id, 'draw', '{}', cur.version), '22023');
  end if;
  perform sim.ok('refusals changed nothing', (select count(*) from public.matches where competition_id = p_comp and (queue_state <> 'scheduled' or result is not null)) = 0);

  -- ---- play: pool / round-robin matches round by round
  for cur in select * from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin') order by coalesce(pool, ''), sim.round_ord(stage, round_label), position loop
    perform sim.play(cur.id, false);
  end loop;
  if exp_pool > 0 then
    perform sim.ok('all pool/round-robin matches are final', not exists (select 1 from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin') and queue_state <> 'final'));
    perform sim.check_standings(p_comp);
    -- no entry plays twice in a round
    perform sim.ok('no entry plays twice in a pool round', not exists (
      select 1 from (select m.pool, m.round_label, x from public.matches m, unnest(array[m.entry_a, m.entry_b]) x where m.competition_id = p_comp and m.stage in ('pool', 'round_robin')) q
      group by pool, round_label, x having count(*) > 1));
    perform sim.ok('every pair meets exactly once in a pool/round robin', not exists (
      select 1 from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin') group by least(entry_a, entry_b), greatest(entry_a, entry_b) having count(*) > 1));
  end if;

  -- ---- pools -> bracket from the standings
  if c.structure = 'pools_elimination' then
    quals := sim.pool_qualifiers(p_comp, adv);
    perform sim.ok('qualifiers = pools x advance', cardinality(quals) = pools * adv);
    perform sim.ok('qualifiers are distinct', (select count(distinct x) from unnest(quals) x) = cardinality(quals));
    perform sim.plan_elim(p_comp, quals, true);
    planned := sim.insert_plan(p_comp);
    perform sim.ok('bracket match count after pools', (select count(*) from public.matches where competition_id = p_comp and stage in ('elimination', 'final')) = cardinality(quals) - 1,
      planned::text);
    perform sim.ok('third place built after pools', (select count(*) from public.matches where competition_id = p_comp and stage = 'third_place') = 1);
    -- the first bracket round must not pair two qualifiers of the same pool (they have already met)
    size := 2; while size < cardinality(quals) loop size := size * 2; end loop;
    select count(*) into clashes from public.matches m join public.entries ea on ea.id = m.entry_a join public.entries eb on eb.id = m.entry_b
      where m.competition_id = p_comp and m.stage in ('elimination', 'final') and m.round_label = sim.round_label(size) and ea.pool = eb.pool;
    perform sim.ok('no first-round bracket match pairs two entries of the same pool', clashes = 0, clashes || ' same-pool rematches in round 1');
  end if;

  -- ---- play the bracket: always the earliest playable match (both sides known)
  if exists (select 1 from public.matches where competition_id = p_comp and stage in ('elimination', 'third_place', 'final')) then
    loop
      select * into cur from public.matches where competition_id = p_comp and stage in ('elimination', 'third_place', 'final') and queue_state <> 'final' and entry_a is not null and entry_b is not null
        order by case stage when 'elimination' then 1 when 'third_place' then 2 else 3 end, sim.round_ord(stage, round_label), position limit 1;
      exit when not found;
      -- the final cannot be finalized while a semifinal is unplayed
      if cur.stage = 'final' and exists (select 1 from public.matches where competition_id = p_comp and stage = 'elimination' and queue_state <> 'final') then raise exception 'SIM FAIL: final became playable before the semifinals were final'; end if;
      perform sim.play(cur.id, p_stress and cur.stage in ('elimination', 'final', 'third_place'));
    end loop;
    if exists (select 1 from public.matches s join public.matches f on f.id = s.next_match_id where s.competition_id = p_comp and f.stage = 'final') then
    perform sim.expect_error('the final was already played, a semifinal cannot be reopened under it',
      format('select public.reopen_match(%L, %L)', (select s.id from public.matches s join public.matches f on f.id = s.next_match_id where s.competition_id = p_comp and f.stage = 'final' order by s.position limit 1), 'sim: too late'), 'P0001');
    end if;
  end if;

  -- ---- verify the finished competition
  perform sim.ok('every match is final', not exists (select 1 from public.matches where competition_id = p_comp and queue_state <> 'final') and (select count(*) from public.matches where competition_id = p_comp) > 0);
  perform sim.ok('every final match has a result and both sides', not exists (select 1 from public.matches where competition_id = p_comp and (result is null or entry_a is null or entry_b is null or score_a is null or score_b is null or finalized_at is null)));
  perform sim.ok('winner matches the result', not exists (select 1 from public.matches where competition_id = p_comp and
    (result = 'a' and winner_entry_id is distinct from entry_a or result = 'b' and winner_entry_id is distinct from entry_b or result = 'draw' and winner_entry_id is not null)));
  perform sim.ok('draws only in pool/round-robin', not exists (select 1 from public.matches where competition_id = p_comp and result = 'draw' and stage not in ('pool', 'round_robin')));
  perform sim.ok('one score event per match', (select count(*) from public.score_events se join public.matches mm on mm.id = se.match_id where mm.competition_id = p_comp) = (select count(*) from public.matches where competition_id = p_comp));
  perform sim.ok('every finalize left an audit row', (select count(*) from public.audit_log where action = 'match.finalized' and subject in (select id::text from public.matches where competition_id = p_comp)) >= (select count(*) from public.matches where competition_id = p_comp));
  perform sim.ok('no entry appears twice in an elimination round', not exists (
    select 1 from (select m.round_label, m.stage, x from public.matches m, unnest(array[m.entry_a, m.entry_b]) x where m.competition_id = p_comp and m.stage in ('elimination', 'final')) q group by round_label, stage, x having count(*) > 1));
  perform sim.ok('no match pairs an entry with itself', not exists (select 1 from public.matches where competition_id = p_comp and entry_a = entry_b));
  perform sim.ok('matches belong only to this competition entries', not exists (select 1 from public.matches m join public.entries e on e.id in (m.entry_a, m.entry_b) where m.competition_id = p_comp and e.competition_id <> p_comp));

  select count(*) filter (where result = 'draw') into draws from public.matches where competition_id = p_comp;
  if exists (select 1 from public.matches where competition_id = p_comp and stage = 'final') then
    select * into fm from public.matches where competition_id = p_comp and stage = 'final';
    champ := fm.winner_entry_id; runner := case fm.result when 'a' then fm.entry_b else fm.entry_a end;
    perform sim.ok('the final has a champion', champ is not null);
    -- each entry except the champion lost exactly once in the elimination bracket; the champion never lost
    perform sim.ok('every bracket entry but the champion lost exactly once', (
      select count(*) from (select (case result when 'a' then entry_b else entry_a end) as loser from public.matches where competition_id = p_comp and stage in ('elimination', 'final')) l group by loser having count(*) <> 1) is null
      and (select count(distinct case result when 'a' then entry_b else entry_a end) from public.matches where competition_id = p_comp and stage in ('elimination', 'final')) = (case when c.structure = 'pools_elimination' then pools * adv else n end) - 1
      and not exists (select 1 from public.matches where competition_id = p_comp and stage in ('elimination', 'final') and (case result when 'a' then entry_b else entry_a end) = champ));
    if third and (select count(*) from public.matches where competition_id = p_comp and stage = 'third_place') = 1 then
      select * into tm from public.matches where competition_id = p_comp and stage = 'third_place';
      thirdw := tm.winner_entry_id;
      -- the two third-place entrants are exactly the semifinal losers, in the position-rule order
      perform sim.ok('third place is fought between the two semifinal losers', (
        select array_agg(case s.result when 'a' then s.entry_b else s.entry_a end order by s.position, s.id) from public.matches s where s.competition_id = p_comp and s.stage = 'elimination' and s.next_match_id = fm.id)
        = array[tm.entry_a, tm.entry_b]);
      perform sim.ok('third place winner is neither finalist', thirdw not in (champ, runner));
      perform sim.ok('finalists are the winners of the semifinals', (select array_agg(winner_entry_id order by position, id) from public.matches where competition_id = p_comp and stage = 'elimination' and next_match_id = fm.id) = array[fm.entry_a, fm.entry_b]);
    end if;
    -- record the podium as results through the organizer policy, and read it back through the history views
    perform sim.put_result(p_comp, champ, 1); perform sim.put_result(p_comp, runner, 2);
    if thirdw is not null then perform sim.put_result(p_comp, thirdw, 3); end if;
    perform sim.ok('champion appears in the history view as place 1', exists (
      select 1 from public.results r join public.entries e on e.id = r.entry_id where r.competition_id = p_comp and r.entry_id = champ and r.final_place = 1
        and (select count(*) from (select 1 from public.team_history h where h.competition_id = p_comp and h.team_id = e.team_id and h.final_place = 1 union all select 1 from public.fighter_history h where h.competition_id = p_comp and h.fighter_id = e.fighter_id and h.final_place = 1) z) = 1));
  else
    -- round robin: champion = best standing
    select entry_id into champ from public.competition_standings where competition_id = p_comp order by wins desc, (score_for - score_against) desc, score_for desc, entry_id limit 1;
    perform sim.put_result(p_comp, x.entry_id, x.rn::int) from (select entry_id, row_number() over (order by wins desc, (score_for - score_against) desc, score_for desc, entry_id) as rn from public.competition_standings where competition_id = p_comp) x;
    perform sim.ok('round robin results: one place per entry, place 1 has the most wins', (select count(*) from public.results where competition_id = p_comp) = n
      and (select wins from public.competition_standings where entry_id = champ) = (select max(wins) from public.competition_standings where competition_id = p_comp));
  end if;

  insert into sim.metrics select c.name, n, (select count(*) from public.matches where competition_id = p_comp and stage in ('pool', 'round_robin')),
    (select count(*) from public.matches where competition_id = p_comp and stage = 'elimination'), (select count(*) from public.matches where competition_id = p_comp and stage = 'third_place'),
    (select count(*) from public.matches where competition_id = p_comp and stage = 'final'), (select count(*) from public.matches where competition_id = p_comp), draws,
    case when c.structure = 'elimination' then byes else 0 end,
    coalesce((select t.name from public.entries e join public.teams t on t.id = e.team_id where e.id = champ), (select f.display_name from public.entries e join public.fighters f on f.id = e.fighter_id where e.id = champ));
  perform sim.ok('total match count', (select count(*) from public.matches where competition_id = p_comp) = exp_pool + exp_elim + exp_third,
    (select count(*) from public.matches where competition_id = p_comp)::text || ' vs ' || (exp_pool + exp_elim + exp_third));
end $$;

-- competition_standings against an independent recount from the matches
create function sim.check_standings(p_comp uuid) returns void language plpgsql as $$
declare bad int;
begin
  perform sim.ok('standings has one row per entry', (select count(*) from public.competition_standings where competition_id = p_comp) = (select count(*) from public.entries where competition_id = p_comp));
  select count(*) into bad from public.competition_standings s where s.competition_id = p_comp and (s.wins::bigint, s.losses::bigint, s.draws::bigint, s.score_for::bigint, s.score_against::bigint) is distinct from (
    (select count(*) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and m.winner_entry_id = s.entry_id),
    (select count(*) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and s.entry_id in (m.entry_a, m.entry_b) and m.result in ('a', 'b') and m.winner_entry_id <> s.entry_id),
    (select count(*) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and s.entry_id in (m.entry_a, m.entry_b) and m.result = 'draw'),
    (select coalesce(sum(case when m.entry_a = s.entry_id then m.score_a else m.score_b end), 0) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and s.entry_id in (m.entry_a, m.entry_b)),
    (select coalesce(sum(case when m.entry_a = s.entry_id then m.score_b else m.score_a end), 0) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and s.entry_id in (m.entry_a, m.entry_b)));
  perform sim.ok('standings equal an independent recount', bad = 0, bad || ' rows differ');
  perform sim.ok('standings are zero-sum (wins = losses, for = against)', (select sum(wins) - sum(losses) from public.competition_standings where competition_id = p_comp) = 0
    and (select sum(score_for) - sum(score_against) from public.competition_standings where competition_id = p_comp) = 0);
  perform sim.ok('wins + losses + draws = matches played', not exists (
    select 1 from public.competition_standings s where s.competition_id = p_comp and s.wins + s.losses + s.draws <> (select count(*) from public.matches m where m.competition_id = p_comp and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and s.entry_id in (m.entry_a, m.entry_b))));
end $$;

-- A throwaway duel competition with n of the test fighters, to run odd sizes (byes) and odd round robins.
create function sim.scratch(p_event uuid, p_kind text, p_n int, p_third boolean) returns uuid language plpgsql as $$
declare v_comp uuid := gen_random_uuid(); i int;
begin
  insert into public.competitions (id, event_id, name, category, structure, sort) values (v_comp, p_event, 'SIM scratch ' || p_kind || ' ' || lpad(p_n::text, 2, '0') || case when p_third then ' third' else '' end, case when p_third then 'longsword' else 'profight' end, p_kind, 900 + p_n);
  insert into public.entries (competition_id, fighter_id, seed) select v_comp, f.id, row_number() over (order by f.display_name) from public.fighters f where f.display_name ~ '^Test Fighter [0-9]{3}$' order by f.display_name limit p_n;
  return v_comp;
end $$;

create function sim.as_user(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function sim.as_anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); execute 'set local role anon'; end $$;
create function sim.as_owner() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

grant usage on schema sim to anon, authenticated;
grant all on all tables in schema sim to anon, authenticated;
grant usage on all sequences in schema sim to anon, authenticated;
grant execute on all functions in schema sim to anon, authenticated;

-- ---------------------------------------------------------------- fixtures: throwaway users and staff (rolled back)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'sim-organizer@example.test'),
  ('00000000-0000-0000-0000-00000000f002', 'sim-marshal@example.test'),
  ('00000000-0000-0000-0000-00000000f003', 'sim-stranger@example.test');
insert into public.event_staff (event_id, user_id, role)
  select id, '00000000-0000-0000-0000-00000000f001'::uuid, 'organizer' from public.events where slug = 'test-tournament'
  union all select id, '00000000-0000-0000-0000-00000000f002'::uuid, 'marshal' from public.events where slug = 'test-tournament';

-- ---------------------------------------------------------------- roles on a small bracket, and what the public can see
select sim.as_user('00000000-0000-0000-0000-00000000f001');
select sim.section('roles on a 4-entry bracket');
select sim.ok('the organizer sees the draft event, 8 competitions and 82 entries', (select count(*) from public.events where slug = 'test-tournament') = 1
  and (select count(*) from public.competitions where name like 'TEST %') = 8 and (select count(*) from public.entries) = 82);
select sim.scratch((select id from public.events where slug = 'test-tournament'), 'elimination', 4, true) as c \gset roles_
select sim.plan_elim(:'roles_c'::uuid, (select array_agg(id order by seed) from public.entries where competition_id = :'roles_c'::uuid), true);
select sim.insert_plan(:'roles_c'::uuid);
select id as m0 from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination' \gset roles_
select sim.ok('4 entries + third place = 4 matches (2 semis, final, third place)', (select count(*) from public.matches where competition_id = :'roles_c'::uuid) = 4);

select sim.section('draft event is invisible to the public');
select sim.as_anon();
select sim.ok('anon cannot see the draft test event', (select count(*) from public.events where slug = 'test-tournament') = 0);
select sim.ok('anon cannot see competitions, entries or matches', (select count(*) from public.competitions) = 0 and (select count(*) from public.entries) = 0 and (select count(*) from public.matches) = 0);
select sim.ok('anon cannot see the pending test teams', (select count(*) from public.teams where slug like 'test-team-%') = 0);
select sim.expect_error('anon cannot finalize', 'select public.finalize_match(gen_random_uuid(), ''a'', 1, 0, ''{}'', 0)', '42501');
select sim.expect_error('anon cannot set the queue', 'select public.set_match_queue(gen_random_uuid(), ''active'')', '42501');
do $$ begin raise notice 'NOTE (not asserted): anon can read % Test Fighter rows, % test organization row(s) and % TEST DATA source row(s): fighters, organizations and sources are public tables in this schema.',
  (select count(*) from public.fighters where display_name like 'Test Fighter %'), (select count(*) from public.organizations where slug = 'test-organization'), (select count(*) from public.sources where title like 'TEST DATA%'); end $$;

select sim.section('stranger');
select sim.as_user('00000000-0000-0000-0000-00000000f003');
select sim.ok('a stranger cannot see the draft event or its matches', (select count(*) from public.events where slug = 'test-tournament') = 0 and (select count(*) from public.matches) = 0);
select sim.expect_error('a stranger cannot score', format('select public.record_score_event(gen_random_uuid(), %L, ''x'')', :'roles_m0'), '42501');
select sim.expect_error('a stranger cannot finalize', format('select public.finalize_match(%L, ''a'', 1, 0, ''{}'', 0)', :'roles_m0'), '42501');
select sim.expect_error('a stranger cannot build matches', format('insert into public.matches (competition_id, stage) values (%L, ''pool'')', :'roles_c'), '42501');

select sim.section('marshal');
select sim.as_user('00000000-0000-0000-0000-00000000f002');
select sim.ok('a marshal can read the matches', (select count(*) from public.matches where competition_id = :'roles_c'::uuid) = 4);
select sim.expect_error('a marshal cannot build matches', format('insert into public.matches (competition_id, stage) values (%L, ''pool'')', :'roles_c'), '42501');
delete from public.matches where competition_id = :'roles_c'::uuid;
select sim.ok('a marshal cannot delete matches (policy hides them from delete)', (select count(*) from public.matches where competition_id = :'roles_c'::uuid) = 4);
select public.set_match_queue((select id from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination'), 'on_deck', 'Field 1');
select sim.ok('a marshal can queue a match', (select queue_state from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination') = 'on_deck');
select sim.ok('a marshal can record a score event', public.record_score_event(gen_random_uuid(), (select id from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination'), 'point', '{"side":"a"}', now()));
select public.finalize_match((select id from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination'), 'a', 2, 0, '{}',
  (select version from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination'));  -- linking the bracket bumps the version, so read the current one
select sim.ok('a marshal can finalize', (select queue_state from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination') = 'final');
select sim.expect_error('a marshal cannot reopen', format('select public.reopen_match(%L, %L)', (select id from public.matches where competition_id = :'roles_c'::uuid and position = 0 and stage = 'elimination'), 'marshal tries'), '42501');
select sim.expect_error('a marshal cannot edit a result column directly', format('update public.matches set result = null where competition_id = %L', :'roles_c'), '42501');

-- replacing an unfinished schedule: the organizer may delete unfinished matches, never final ones
select sim.as_user('00000000-0000-0000-0000-00000000f001');
select sim.section('replace an unfinished schedule');
select sim.ok('the finalized semifinal sent its winner to the final and its loser to third place', (select count(*) from public.matches where competition_id = :'roles_c'::uuid and stage in ('final', 'third_place') and (entry_a is not null or entry_b is not null)) = 2);
delete from public.matches where competition_id = :'roles_c'::uuid and queue_state = 'final';
select sim.ok('the policy hides final matches from delete, so the final one survived', (select count(*) from public.matches where competition_id = :'roles_c'::uuid and queue_state = 'final') = 1);
delete from public.matches where competition_id = :'roles_c'::uuid and stage = 'final';
select sim.ok('deleting the unfinished final that a finished semifinal leads into clears that link (migration 20261001001700)', (select count(*) from public.matches where competition_id = :'roles_c'::uuid and stage = 'final') = 0
  and (select next_match_id is null and next_slot is null from public.matches where id = :'roles_m0'::uuid));

-- ---------------------------------------------------------------- the seeded competitions, full tournament
select sim.as_user('00000000-0000-0000-0000-00000000f001');
select sim.run_comp(c.id, c.name in ('TEST Melee 3v3 (men)', 'TEST Sword and Shield', 'TEST Melee 5v5 (men)'))
  from public.competitions c where c.event_id = (select id from public.events where slug = 'test-tournament') and c.name like 'TEST %' order by c.sort;

-- ---------------------------------------------------------------- odd sizes: byes in every shape and odd round robins
select sim.section('scratch brackets 2..17 (with third place) and 2..17 without');
select sim.run_comp(sim.scratch((select id from public.events where slug = 'test-tournament'), 'elimination', n, true), true) from generate_series(2, 17) n;
select sim.run_comp(sim.scratch((select id from public.events where slug = 'test-tournament'), 'elimination', n, false), true) from generate_series(2, 17) n;
select sim.section('scratch round robins 2..9');
select sim.run_comp(sim.scratch((select id from public.events where slug = 'test-tournament'), 'round_robin', n, true), false) from generate_series(2, 9) n;
select sim.section('scratch pools 8, 12, 20');
select sim.run_comp(sim.scratch((select id from public.events where slug = 'test-tournament'), 'pools_elimination', n, true), false) from unnest(array[8, 12, 20]) n;

-- ---------------------------------------------------------------- the whole event
select sim.as_user('00000000-0000-0000-0000-00000000f001');
select sim.section('whole event');
select sim.ok('no match in the seeded TEST competitions is left unfinished', not exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.name like 'TEST %' and k.event_id = (select id from public.events where slug = 'test-tournament') and m.queue_state <> 'final'));
select sim.ok('no tier, no league points anywhere in the test event', not exists (select 1 from public.competitions where event_id = (select id from public.events where slug = 'test-tournament') and tier is not null));
select sim.ok('the event is still a draft', (select status from public.events where slug = 'test-tournament') = 'draft');

-- ---------------------------------------------------------------- report
select sim.as_owner();
\o
\echo
\echo ===== matches per seeded competition =====
select comp, entries, pool_matches as pool_rr, elim_matches as elim, third_matches as third, final_matches as final, total, draws, byes, champion from sim.metrics where comp like 'TEST %' order by comp;
\echo ===== scratch competitions (comp, entries, total matches) =====
select count(*) as scratch_comps, sum(total) as scratch_matches from sim.metrics where comp like 'SIM scratch%';
\echo ===== checks passed per section =====
select section, count(*) as checks from sim.log group by section order by min(n);
select count(*) as total_checks_passed from sim.log;
select count(*) as matches_played_in_event from public.matches;
\echo SIMULATION PASSED
\if :keep
commit;
\else
rollback;
\endif
