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
