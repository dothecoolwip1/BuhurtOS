-- Team discipline rankings: a team's total of its fighters' INDIVIDUAL ranking points, per discipline (2026-10-04). Additive.
--
-- Two different statistics, kept apart on purpose:
--   ranking_teams              TEAM COMPETITION ranking: results of team entries (5v5, 3v3, ...). Unchanged.
--   ranking_team_disciplines   TEAM DISCIPLINE AGGREGATE (new): the ranking points of individual (fighter) entries, credited to the team the
--                              fighter represented in that competition, and added up per team. Team-entry (group fight) results never count.
--
-- 1. Who a fighter represented. Until now a fighter (duel) entry stored only the fighter, so joining a result to the fighter's CURRENT team would
--    rewrite history after a transfer. entries.represented_team_id records it on the entry itself (team entries keep entries.team_id):
--      * set when the entry is created, from evidence of that time:
--          'registration'   the fighter's own registration for that event named a team
--          'team_at_entry'  otherwise the fighter's home team (private.fighter_home_team) while the event is not over yet
--          'recorded'       a loader or organizer wrote the team explicitly on insert
--        A fighter entry created for an event that is already over gets no default: the current team is not evidence of the past.
--      * changed afterwards only through set_represented_team (organizer of that event, reason required, audited from/to/reason),
--        or by merge_teams (the successor team inherits the merged team's results, as entries.team_id already does).
--      * represented_team_name_at_event keeps the name the team had then (a later rename or merge never rewrites it).
--    Existing fighter entries are back-filled only from registration evidence, or from the home team when the event is not over yet.
--    Finished history with no evidence stays unattributed (team null): it is shown as "no recorded team", never guessed.
-- 2. The aggregate is derived from exactly the rows ranking_fighters ranks (fighter_results_all, the same synthetic rule): no new formula.
-- Scopes: 'season', 'org_career' (whole organization history, per discipline) and 'career' (all time, real results only), each per division
-- (competition gender) and combined across divisions (gender null). A result belongs to one competition with one gender, so the combined total
-- is the plain sum of the divisions and nothing is counted twice.

-- ---------------------------------------------------------------- 1. the represented team on a fighter entry
alter table public.entries add column if not exists represented_team_id uuid references public.teams (id) on delete restrict;
alter table public.entries add column if not exists represented_team_name_at_event text;
alter table public.entries add column if not exists represented_team_basis text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_represented_team_fighter_only') then
    alter table public.entries add constraint entries_represented_team_fighter_only check (represented_team_id is null or team_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entries_represented_team_basis_check') then
    alter table public.entries add constraint entries_represented_team_basis_check
      check (represented_team_basis is null or represented_team_basis in ('registration', 'team_at_entry', 'recorded', 'correction'));
  end if;
end $$;
create index if not exists entries_represented_team_idx on public.entries (represented_team_id) where represented_team_id is not null;
comment on column public.entries.represented_team_id is 'Fighter (individual) entries only: the team the fighter represented in this competition. Set from evidence when the entry is created; corrected only through set_represented_team.';
comment on column public.entries.represented_team_basis is 'How represented_team_id is known: registration, team_at_entry, recorded or correction.';

-- The team a fighter represents in an event, from evidence that exists at that time. Null when there is none.
create or replace function private.represented_team_evidence(p_event uuid, p_fighter uuid, out team_id uuid, out basis text)
language plpgsql stable security definer set search_path = '' as $$
begin
  select g.team_id into team_id from public.registrations g
   where g.event_id = p_event and g.fighter_id = p_fighter and g.team_id is not null and g.status in ('pending', 'accepted')
   order by (g.status = 'accepted') desc, g.created_at desc limit 1;
  if team_id is not null then basis := 'registration'; return; end if;
  if exists (select 1 from public.events ev where ev.id = p_event and ev.ends_on >= current_date) then
    team_id := private.fighter_home_team(p_fighter);
    if team_id is not null then basis := 'team_at_entry'; end if;
  end if;
end $$;
revoke execute on function private.represented_team_evidence(uuid, uuid) from public, anon, authenticated;

create or replace function private.entries_represented_team() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev record;
begin
  if tg_op = 'INSERT' then
    -- A team entry keeps whatever was given, so entries_represented_team_fighter_only rejects a represented team on it loudly.
    if new.fighter_id is null then return new; end if;
    if new.represented_team_id is not null then
      new.represented_team_basis := coalesce(new.represented_team_basis, 'recorded');
    else
      select * into v_ev from private.represented_team_evidence(private.event_of_competition(new.competition_id), new.fighter_id);
      new.represented_team_id := v_ev.team_id; new.represented_team_basis := v_ev.basis;
    end if;
    select t.name into new.represented_team_name_at_event from public.teams t where t.id = new.represented_team_id;
    return new;
  end if;
  -- UPDATE: only set_represented_team (bos.represented_team) and merge_teams (bos.merging) may change it.
  if new.represented_team_id is distinct from old.represented_team_id
     or new.represented_team_name_at_event is distinct from old.represented_team_name_at_event
     or new.represented_team_basis is distinct from old.represented_team_basis then
    if coalesce(current_setting('bos.merging', true), '') = 'on' then
      new.represented_team_name_at_event := old.represented_team_name_at_event; new.represented_team_basis := old.represented_team_basis;
    elsif coalesce(current_setting('bos.represented_team', true), '') <> 'on' then
      raise exception 'the team a fighter represented is changed with set_represented_team (it is audited)' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.entries_represented_team() from public, anon, authenticated;

-- 1b. back-fill existing fighter entries (before the guard trigger exists). No evidence, no team.
update public.entries e set represented_team_id = x.team_id, represented_team_basis = x.basis,
       represented_team_name_at_event = (select t.name from public.teams t where t.id = x.team_id)
  from public.entries e2 cross join lateral private.represented_team_evidence(private.event_of_competition(e2.competition_id), e2.fighter_id) x
 where e.id = e2.id and e.fighter_id is not null and e.represented_team_id is null and x.team_id is not null;

drop trigger if exists entries_represented_team on public.entries;
create trigger entries_represented_team before insert or update on public.entries for each row execute function private.entries_represented_team();

-- 1c. corrections: an organizer of the event (or the platform owner) with a reason. p_team null records "no team" (independent fighter).
create or replace function public.set_represented_team(p_entry uuid, p_team uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_e public.entries; v_event uuid;
begin
  select * into v_e from public.entries where id = p_entry for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_competition(v_e.competition_id);
  if not private.is_organizer(v_event) then raise exception 'only an organizer of this event can change who a fighter represented' using errcode = '42501'; end if;
  if v_e.fighter_id is null then raise exception 'a team entry already is its team; this is for individual entries' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the team is being changed' using errcode = '22023'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  if p_team is not distinct from v_e.represented_team_id then return; end if;
  perform set_config('bos.represented_team', 'on', true);
  update public.entries set represented_team_id = p_team, represented_team_basis = 'correction',
         represented_team_name_at_event = (select t.name from public.teams t where t.id = p_team)
   where id = p_entry;
  perform set_config('bos.represented_team', '', true);
  perform private.audit(v_event, 'entry.represented_team_changed', p_entry::text, jsonb_build_object(
    'fighter', v_e.fighter_id, 'from', v_e.represented_team_id, 'from_name', v_e.represented_team_name_at_event, 'from_basis', v_e.represented_team_basis,
    'to', p_team, 'reason', btrim(p_reason)));
end $$;
revoke execute on function public.set_represented_team(uuid, uuid, text) from public, anon;
grant execute on function public.set_represented_team(uuid, uuid, text) to authenticated;

-- 1d. merge_teams carries represented teams to the kept team, inside the existing merging flag (event-time names are kept).
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'merge_teams';
  if position('represented_team_id' in v_def) = 0 then
    v_def := replace(v_def, $$  update public.entries set team_id = p_keep where team_id = p_remove;$$,
      $$  update public.entries set team_id = p_keep where team_id = p_remove;
  update public.entries set represented_team_id = p_keep where represented_team_id = p_remove;$$);
    if position('represented_team_id' in v_def) = 0 then raise exception 'merge_teams body did not match the expected text'; end if;
    execute v_def;
  end if;
end $do$;

-- ---------------------------------------------------------------- 2. the aggregate
-- One row per (scope, organization, season, discipline, division, team, fighter): that fighter's points while representing that team.
-- gender null = all divisions of the discipline together. team_id null = results with no recorded team (shown as such, never ranked).
create or replace view public.team_discipline_contributions with (security_invoker = true) as
with base as (
  select fr.organization_id, fr.season_id, fr.category, fr.gender, fr.fighter_id, e.represented_team_id as team_id, fr.points, fr.synthetic
  from public.fighter_results_all fr join public.entries e on e.id = fr.entry_id
  where fr.entry_fighter_id is not null),                 -- individual entries only: a team entry's roster never feeds this
scoped as (
  select 'season'::text as scope, organization_id, season_id, category, gender, team_id, fighter_id, points from base
   where season_id is not null and (not synthetic or private.is_synthetic('organization', organization_id))
  union all
  select 'org_career', organization_id, null::uuid, category, gender, team_id, fighter_id, points from base
   where organization_id is not null and (not synthetic or private.is_synthetic('organization', organization_id))
  union all
  select 'career', null::uuid, null::uuid, category, gender, team_id, fighter_id, points from base where not synthetic)
select s.scope, s.organization_id, s.season_id, s.category, s.gender, s.team_id, s.fighter_id, f.display_name, count(*) as results, coalesce(sum(s.points), 0) as points
from scoped s join public.fighters f on f.id = s.fighter_id
group by grouping sets ((s.scope, s.organization_id, s.season_id, s.category, s.gender, s.team_id, s.fighter_id, f.display_name),
                        (s.scope, s.organization_id, s.season_id, s.category, s.team_id, s.fighter_id, f.display_name));

create or replace view public.ranking_team_disciplines with (security_invoker = true) as
select c.scope, c.organization_id, c.season_id, c.category, coalesce(rc.name, c.category) as category_name, c.gender,
  c.team_id, t.name as team_name, t.slug as team_slug, count(*) as fighters, sum(c.results) as results, sum(c.points) as points,
  rank() over (partition by c.scope, c.organization_id, c.season_id, c.category, c.gender order by sum(c.points) desc) as rank
from public.team_discipline_contributions c
join public.teams t on t.id = c.team_id
left join public.ref_categories rc on rc.code = c.category
group by c.scope, c.organization_id, c.season_id, c.category, rc.name, c.gender, c.team_id, t.name, t.slug;

grant select on public.team_discipline_contributions, public.ranking_team_disciplines to anon, authenticated;
comment on view public.ranking_team_disciplines is 'Team discipline aggregate: the sum of the individual ranking points of the fighters who represented each team, per discipline. Not a team competition ranking (that is ranking_teams).';
comment on view public.team_discipline_contributions is 'Where each team discipline total comes from: each fighter''s points while representing the team. team_id null: results with no recorded team.';
