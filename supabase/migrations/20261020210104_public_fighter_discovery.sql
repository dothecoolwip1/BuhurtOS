-- Version the existing hosted public directory view. Its synthetic flag supports server filtering before counts/pages.
-- Preserve its public column order and caller RLS; no sporting or in-flight event rows are changed.
create or replace view public.fighter_directory with (security_invoker = true) as
select f.id, f.display_name, f.gender, f.city, f.region, f.country, f.disciplines, f.team_id,
       t.name as team_name, t.slug as team_slug, f.inactive_at, f.avatar_path,
       exists (select 1 from public.record_sources r join public.sources s on s.id=r.source_id
               where s.synthetic and r.entity_type='fighter' and r.entity_id=f.id) as synthetic
from public.fighters f
left join public.teams t on t.id=f.team_id;

revoke all on public.fighter_directory from public;
grant select on public.fighter_directory to anon, authenticated;
comment on view public.fighter_directory is 'Existing public discovery fields and fictional-source flag. Filter synthetic=false before pagination; caller RLS applies.';
