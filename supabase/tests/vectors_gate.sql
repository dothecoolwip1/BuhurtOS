-- Shared test vectors: the SQL league-points rule (private.base_points + private.tier_points) must give the same totals as the
-- TypeScript rule (src/lib/tournament.ts leaguePoints). Run from the repository root against a scratch database:
--   psql -v ON_ERROR_STOP=1 -d <scratch db> -f supabase/tests/vectors_gate.sql
\set ON_ERROR_STOP on
\set vec `cat supabase/tests/vectors/league_points.json`
create temp table vec as select :'vec'::jsonb as j;
do $$
declare bad text; n int;
begin
  select count(*), string_agg(format('%s/%s/%s/%s/%s expected %s got %s', c."poolWins", c."eliminationWins", c.placement, c.tier, c.source, c.total, got.v), '; ')
    filter (where got.v is distinct from c.total)
  into n, bad
  from jsonb_to_recordset((select j from vec) -> 'cases') as c("poolWins" int, "eliminationWins" int, placement text, tier text, source text, total numeric)
  cross join lateral (select private.tier_points(
      private.base_points(c."poolWins", c."eliminationWins", case c.placement when 'first' then 1 when 'second' then 2 when 'third' then 3 end),
      c.tier, case c.source when 'leagueStructure' then 'league_structure' else 'tournament_structure' end) as v) got;
  if n = 0 then raise exception 'VECTORS FAILED: no vectors loaded'; end if;
  if bad is not null then raise exception 'VECTORS FAILED: %', bad; end if;
  raise notice 'VECTORS OK: all % league-points vectors agree between SQL and TypeScript', n;
end $$;

-- Pack 29: the Outrance vectors (supabase/tests/vectors/outrance.json) give the same answers in SQL as in src/lib/outrance.ts
\set ovec `cat supabase/tests/vectors/outrance.json`
create temp table ovec as select :'ovec'::jsonb as j;
do $$
declare bad text := ''; n int := 0; v jsonb; got jsonb; s public.outrance_sheets; units_a int; units_b int; k int;
begin
  for v in select jsonb_array_elements(j -> 'sheets') from ovec loop
    got := private.outrance_sheet_result((v -> 'strikes' ->> 0)::int, (v -> 'strikes' ->> 1)::int, v -> 'calls', v ->> 'stoppage');
    if (got ->> 'a')::int <> (v ->> 'a')::int or (got ->> 'b')::int <> (v ->> 'b')::int or got ->> 'band' <> v ->> 'band' or (got ->> 'decided_by') is distinct from (v ->> 'decidedBy') then
      bad := bad || format('sheet "%s" got %s; ', v ->> 'note', got); end if;
    n := n + 1;
  end loop;
  for v in select jsonb_array_elements(j -> 'deductions') from ovec loop
    s := row(gen_random_uuid(), null, null, 1, null, 'official', null, 0, 0, 0, 0, (v ->> 'weaponLosses')::int, 0, 0, 0, '{}'::jsonb, now(), null)::public.outrance_sheets;
    got := private.outrance_sheet_json(s, jsonb_build_object('yellows', jsonb_build_object('a', (v ->> 'yellows')::int, 'b', 0), 'armour', jsonb_build_object('a', (v ->> 'armourGrants')::int, 'b', 0), 'stoppage', null));
    if (got -> 'deduct' ->> 'a')::int <> (v ->> 'points')::int then bad := bad || format('deduction "%s" got %s; ', v ->> 'note', got -> 'deduct'); end if;
    n := n + 1;
  end loop;
  for v in select jsonb_array_elements(j -> 'rounds') from ovec loop
    k := jsonb_array_length(v -> 'sheets');
    select sum((x ->> 0)::int) * (60 / k), sum((x ->> 1)::int) * (60 / k) into units_a, units_b from jsonb_array_elements(v -> 'sheets') x;
    if units_a <> (v -> 'units' ->> 0)::int or units_b <> (v -> 'units' ->> 1)::int then bad := bad || format('round "%s" got %s-%s; ', v ->> 'note', units_a, units_b); end if;
    n := n + 1;
  end loop;
  for v in select jsonb_array_elements(j -> 'winTypes') from ovec loop
    if private.outrance_win_type(array(select jsonb_array_elements_text(v -> 'results'))) is distinct from v ->> 'type' then
      bad := bad || format('win type %s got %s; ', v -> 'results', private.outrance_win_type(array(select jsonb_array_elements_text(v -> 'results')))); end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'VECTORS FAILED: no Outrance vectors loaded'; end if;
  if bad <> '' then raise exception 'VECTORS FAILED (Outrance): %', bad; end if;
  raise notice 'VECTORS OK: all % Outrance vectors agree between SQL and TypeScript', n;
end $$;
