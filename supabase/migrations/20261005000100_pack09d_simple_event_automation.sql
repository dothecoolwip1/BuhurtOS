-- Pack 09D (2026-10-05): simple event mode, automatic planning, event / fighter / roster lifecycle.
--
-- Additive and re-runnable. Nothing here changes a result, a placing, a points formula, a bracket link or a match version.
--
--   1. Event lifecycle, four separate ideas (one column each, never one status meaning all of them):
--        closed      events.closed_at (Pack 09C, unchanged): finished, history, counts normally.
--        archived    events.archived_at: presentation only. Hidden from current/upcoming browsing; results and statistics count exactly as before.
--        excluded    events.stats_excluded_at: the event's results stay stored and visible, but no longer feed official aggregates.
--        deletable   a draft (or fictional) event with no sporting history can be removed through delete_event; anything else cannot.
--   2. ONE rule for "does this event feed official statistics": private.stats_excluded(event). Every aggregate path reads it:
--        result_rows (fighter_results, team_results, career/season/team statistics, the global ranking scope), match_sides (match counts, form),
--        played_events (events attended), the organization ranking scopes and the team discipline totals (through result_rows_all.stats_excluded).
--      Synthetic isolation (private.is_synthetic) is untouched and stays a separate rule.
--   3. Fighters: fighters.inactive_at (+ reason). Inactive fighters keep every result; they are left out of entrant search and the current public roster.
--   4. Team roster: team_memberships.hidden_from_roster. Current public presentation only; historical attribution never reads it.
--   5. Planning: matches.plan_order (the planner's event-wide order of waiting fights) and matches.plan_hold (a fighter in it is not here today, so the
--      queue never calls it by itself). Written only by save_queue_plan. The organizer's hand-made order (queue_order, Pack 09A) still comes first.
--   6. events.field_count: how many fields the event runs (Quick Setup asks it once; the planner and Build Tournament use it).

-- ================================================================ 1. columns
alter table public.events add column if not exists archived_at timestamptz;
alter table public.events add column if not exists stats_excluded_at timestamptz;
alter table public.events add column if not exists stats_excluded_reason text;
alter table public.events add column if not exists field_count integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_field_count_range' and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_field_count_range check (field_count between 1 and 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_stats_excluded_reason_len' and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_stats_excluded_reason_len check (stats_excluded_reason is null or char_length(stats_excluded_reason) <= 500);
  end if;
end $$;
-- Organizers set the number of fields like any other event detail; archive and exclusion change only through the functions below.
grant update (field_count) on public.events to authenticated;
comment on column public.events.archived_at is 'Archived: hidden from current/upcoming browsing by default. Presentation only: results and statistics count as before. Who/why: audit_log event.archived.';
comment on column public.events.stats_excluded_at is 'Excluded from official statistics: results stay stored and visible but feed no official aggregate (private.stats_excluded). Who: audit_log event.stats_excluded.';
comment on column public.events.field_count is 'How many fields the event runs (Quick Setup). Field names are "Field 1".."Field n".';

alter table public.fighters add column if not exists inactive_at timestamptz;
alter table public.fighters add column if not exists inactive_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fighters_inactive_reason_len' and conrelid = 'public.fighters'::regclass) then
    alter table public.fighters add constraint fighters_inactive_reason_len check (inactive_reason is null or char_length(inactive_reason) <= 300);
  end if;
end $$;
comment on column public.fighters.inactive_at is 'The fighter has stopped competing (for now). Every result and team history stays; entrant search and current rosters leave them out. Reversible.';

alter table public.team_memberships add column if not exists hidden_from_roster boolean not null default false;
comment on column public.team_memberships.hidden_from_roster is 'Hide from the team''s CURRENT public roster. Presentation only: represented-team history, results and rankings never read it.';

alter table public.matches add column if not exists plan_order integer;
alter table public.matches add column if not exists plan_hold boolean not null default false;
comment on column public.matches.plan_order is 'The planner''s event-wide order of waiting fights (Pack 09D, lower runs sooner). After the organizer''s queue_order. Written only by save_queue_plan.';
comment on column public.matches.plan_hold is 'Someone in this fight is registered as not here today: the queue does not call it by itself (an organizer still can). Written only by save_queue_plan.';
-- No client grant on plan_order / plan_hold: only save_queue_plan writes them.

-- The audit log is append-only (no client writes) and organizers read it per event; nothing to change.

-- ================================================================ 2. the one statistics rule
create or replace function private.stats_excluded(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.stats_excluded_at is not null from public.events e where e.id = p_event), false) $$;
revoke execute on function private.stats_excluded(uuid) from public;
grant execute on function private.stats_excluded(uuid) to anon, authenticated;   -- read by security_invoker views, like private.is_synthetic
comment on function private.stats_excluded(uuid) is 'THE rule for whether an event''s results are left out of official aggregates (Pack 09D). Synthetic isolation is a separate rule.';

-- Same columns, same order as before; only the WHERE gains the rule (create or replace keeps grants and the frontend contract).
create or replace view public.result_rows with (security_invoker = true) as
 SELECT r.competition_id, r.entry_id, r.final_place, COALESCE(r.points, (0)::numeric) AS points, k.name AS competition_name, k.category, k.gender, k.tier, k.structure,
        ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.event_type, ev.starts_on, ev.ends_on AS event_ends_on, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, e.team_id, e.fighter_id AS entry_fighter_id
   FROM ((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN seasons se ON ((se.id = ev.season_id)))
  WHERE r.final_place IS NOT NULL AND NOT private.is_synthetic('event', ev.id) AND NOT private.stats_excluded(ev.id);

create or replace view public.played_events with (security_invoker = true) as
 SELECT id AS event_id FROM events e
  WHERE NOT private.is_synthetic('event', e.id) AND NOT private.stats_excluded(e.id)
    AND ((ends_on < CURRENT_DATE) OR (EXISTS ( SELECT 1 FROM (matches m JOIN competitions k ON ((k.id = m.competition_id))) WHERE ((k.event_id = e.id) AND (m.queue_state = 'final'::text)))));

create or replace view public.match_sides with (security_invoker = true) as
 SELECT m.id AS match_id, m.competition_id, k.event_id, k.category, k.gender, k.tier, k.structure, m.stage, m.finalized_at, ev.ends_on AS event_ends_on, ev.event_type, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, s.side, e.id AS entry_id, e.team_id, e.fighter_id,
        CASE WHEN (m.result = 'draw'::text) THEN 'draw'::text WHEN (m.winner_entry_id = e.id) THEN 'win'::text ELSE 'loss'::text END AS outcome,
        s.sf AS score_for, s.sa AS score_against, r.won AS rounds_won, r.lost AS rounds_lost
   FROM ((((((matches m JOIN competitions k ON ((k.id = m.competition_id))) JOIN events ev ON ((ev.id = k.event_id))) LEFT JOIN seasons se ON ((se.id = ev.season_id)))
        CROSS JOIN LATERAL ( VALUES ('a'::text,m.entry_a,m.score_a,m.score_b), ('b'::text,m.entry_b,m.score_b,m.score_a)) s(side, entry_id, sf, sa))
        JOIN entries e ON ((e.id = s.entry_id))) CROSS JOIN LATERAL private.side_rounds(m.detail, s.side, s.sf, s.sa) r(won, lost))
  WHERE ((m.queue_state = 'final'::text) AND (m.entry_a IS NOT NULL) AND (m.entry_b IS NOT NULL) AND NOT private.is_synthetic('event', ev.id) AND NOT private.stats_excluded(ev.id));

-- The "all results" views keep every row (a person's history still lists an excluded event) and gain one column at the end saying so.
create or replace view public.result_rows_all with (security_invoker = true) as
 SELECT r.competition_id, r.entry_id, r.final_place, COALESCE(r.points, (0)::numeric) AS points, k.name AS competition_name, k.category, k.gender, k.tier, k.structure,
        ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.event_type, ev.starts_on, ev.ends_on AS event_ends_on, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, e.team_id, e.fighter_id AS entry_fighter_id,
        private.is_synthetic('event', ev.id) AS synthetic, COALESCE(e.team_name_at_event, t.name) AS team_name_at_event, t.name AS team_current_name, t.slug AS team_current_slug,
        private.stats_excluded(ev.id) AS stats_excluded
   FROM (((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN seasons se ON ((se.id = ev.season_id))) LEFT JOIN teams t ON ((t.id = e.team_id)))
  WHERE r.final_place IS NOT NULL;
create or replace view public.fighter_results_all with (security_invoker = true) as
 SELECT fp.fighter_id, rr.* FROM (result_rows_all rr JOIN fighter_participation fp ON ((fp.entry_id = rr.entry_id)));
create or replace view public.team_results_all with (security_invoker = true) as
 SELECT rr.* FROM result_rows_all rr WHERE rr.team_id IS NOT NULL;

create or replace view public.fighter_history with (security_invoker = true) as
 SELECT e.fighter_id, ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.starts_on, k.id AS competition_id, k.name AS competition_name, k.ruleset, r.final_place, r.points,
        private.is_synthetic('event', ev.id) AS synthetic, private.stats_excluded(ev.id) AS stats_excluded
   FROM (((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
  WHERE e.fighter_id IS NOT NULL;

-- Rankings: identical text except the excluded-event rule in the organization scopes (the career scope already reads result_rows).
create or replace view public.ranking_fighters with (security_invoker = true) as
with org_rows as (
  select fighter_id, organization_id, season_id, category, gender, final_place, points
  from public.fighter_results_all
  where not stats_excluded and (not synthetic or private.is_synthetic('organization', organization_id))),
agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, fighter_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from org_rows where season_id is not null group by organization_id, season_id, category, gender, fighter_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, category, gender, fighter_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, fighter_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, fighter_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.fighter_results group by fighter_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.fighter_id, f.display_name, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.fighters f on f.id = a.fighter_id;

create or replace view public.ranking_teams with (security_invoker = true) as
with org_rows as (
  select team_id, organization_id, season_id, category, gender, final_place, points
  from public.team_results_all
  where not stats_excluded and (not synthetic or private.is_synthetic('organization', organization_id))),
agg as (
  select 'season'::text as scope, organization_id, season_id, category, gender, team_id, count(*) as competitions,
    count(*) filter (where final_place = 1) as golds, count(*) filter (where final_place = 2) as silvers, count(*) filter (where final_place = 3) as bronzes, coalesce(sum(points), 0) as points
  from org_rows where season_id is not null group by organization_id, season_id, category, gender, team_id
  union all
  select 'org_career', organization_id, null::uuid, category, gender, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, category, gender, team_id
  union all
  select 'org_all', organization_id, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from org_rows where organization_id is not null group by organization_id, team_id
  union all
  select 'career', null::uuid, null::uuid, null::text, null::text, team_id, count(*), count(*) filter (where final_place = 1), count(*) filter (where final_place = 2),
    count(*) filter (where final_place = 3), coalesce(sum(points), 0)
  from public.team_results group by team_id)
select a.scope, a.organization_id, a.season_id, a.category, a.gender, a.team_id, t.name as team_name, t.slug as team_slug, a.competitions, a.golds, a.silvers, a.bronzes, a.points,
  rank() over (partition by a.scope, a.organization_id, a.season_id, a.category, a.gender order by a.points desc) as rank
from agg a join public.teams t on t.id = a.team_id;

create or replace view public.team_discipline_contributions with (security_invoker = true) as
with base as (
  select fr.organization_id, fr.season_id, fr.category, fr.gender, fr.fighter_id, e.represented_team_id as team_id, fr.points, fr.synthetic
  from public.fighter_results_all fr join public.entries e on e.id = fr.entry_id
  where fr.entry_fighter_id is not null and not fr.stats_excluded),   -- individual entries only; an excluded event never feeds it
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

-- ================================================================ 3. event lifecycle commands
-- Who may: archive / unarchive = the event's organizers (organization admins and the platform owner included, as for every organizer command).
--          exclude / restore statistics = the platform owner, or an administrator of the event's organization. Never a plain event organizer.
--          delete = the event's organizers, and only for an event with no sporting history (see private.event_delete_blockers).
create or replace function private.can_govern_event_stats(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_owner() or private.is_org_admin_of_event(p_event) $$;
revoke execute on function private.can_govern_event_stats(uuid) from public, anon, authenticated;

-- The lifecycle flags may change only through the functions below (they set bos.unlock); a closed event can still be archived or excluded.
create or replace function private.events_lifecycle_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_client_session() or private.unlocked() then return new; end if;
  if (new.archived_at, new.stats_excluded_at, new.stats_excluded_reason) is distinct from (old.archived_at, old.stats_excluded_at, old.stats_excluded_reason) then
    raise exception 'archive and statistics changes go through Archive event / Exclude from official statistics' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.events_lifecycle_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'events_lifecycle_guard' and tgrelid = 'public.events'::regclass) then
    create trigger events_lifecycle_guard before update on public.events for each row execute function private.events_lifecycle_guard();
  end if;
end $$;

-- Archive: presentation only. Returns {status: archived | already_archived}.
create or replace function public.archive_event(p_event uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can archive it' using errcode = '42501'; end if;
  if v_e.archived_at is not null then return jsonb_build_object('status', 'already_archived', 'archived_at', v_e.archived_at); end if;
  perform set_config('bos.unlock', 'on', true);
  update public.events set archived_at = now() where id = p_event;
  perform set_config('bos.unlock', '', true);
  perform private.audit(p_event, 'event.archived', p_event::text, jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('status', 'archived');
end $$;

create or replace function public.unarchive_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can restore it from the archive' using errcode = '42501'; end if;
  if v_e.archived_at is null then return jsonb_build_object('status', 'not_archived'); end if;
  perform set_config('bos.unlock', 'on', true);
  update public.events set archived_at = null where id = p_event;
  perform set_config('bos.unlock', '', true);
  perform private.audit(p_event, 'event.unarchived', p_event::text, '{}'::jsonb);
  return jsonb_build_object('status', 'restored');
end $$;

-- Exclude from official statistics: the reason is required and audited; idempotent.
create or replace function public.exclude_event_from_stats(p_event uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events; v_reason text := btrim(coalesce(p_reason, '')); v_results integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.can_govern_event_stats(p_event) then
    raise exception 'only the platform administrator or an administrator of this event''s organization can change whether it counts in official statistics' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then raise exception 'say why (3 to 500 characters)' using errcode = '22023'; end if;
  if v_e.stats_excluded_at is not null then return jsonb_build_object('status', 'already_excluded', 'excluded_at', v_e.stats_excluded_at); end if;
  select count(*) into v_results from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = p_event and r.final_place is not null;
  perform set_config('bos.unlock', 'on', true);
  update public.events set stats_excluded_at = now(), stats_excluded_reason = v_reason where id = p_event;
  perform set_config('bos.unlock', '', true);
  perform private.audit(p_event, 'event.stats_excluded', p_event::text, jsonb_build_object('reason', v_reason, 'results', v_results));
  return jsonb_build_object('status', 'excluded', 'results', v_results);
end $$;

create or replace function public.restore_event_stats(p_event uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events; v_reason text := btrim(coalesce(p_reason, '')); v_results integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.can_govern_event_stats(p_event) then
    raise exception 'only the platform administrator or an administrator of this event''s organization can change whether it counts in official statistics' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then raise exception 'say why (3 to 500 characters)' using errcode = '22023'; end if;
  if v_e.stats_excluded_at is null then return jsonb_build_object('status', 'already_counted'); end if;
  select count(*) into v_results from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = p_event and r.final_place is not null;
  perform set_config('bos.unlock', 'on', true);
  update public.events set stats_excluded_at = null, stats_excluded_reason = null where id = p_event;
  perform set_config('bos.unlock', '', true);
  perform private.audit(p_event, 'event.stats_restored', p_event::text, jsonb_build_object('reason', v_reason, 'previous_reason', v_e.stats_excluded_reason, 'results', v_results));
  return jsonb_build_object('status', 'restored', 'results', v_results);
end $$;

-- What stops an event from being deleted. Empty = it has no sporting history and is a draft (or a fictional event) that nobody published for real.
create or replace function private.event_delete_blockers(p_event uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.events e where e.id = p_event and e.status = 'published' and not private.is_synthetic('event', e.id)) then 'published' end,
    case when exists (select 1 from public.events e where e.id = p_event and e.closed_at is not null) then 'closed' end,
    case when exists (select 1 from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = p_event) then 'official_results' end,
    case when exists (select 1 from public.result_revisions v join public.competitions k on k.id = v.competition_id where k.event_id = p_event) then 'result_history' end,
    case when exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = p_event and m.queue_state = 'final') then 'fights_fought' end,
    case when exists (select 1 from public.competitions k where k.event_id = p_event and k.status = 'finished') then 'official_competition' end
  ], null) $$;
revoke execute on function private.event_delete_blockers(uuid) from public, anon, authenticated;

-- The removal itself, bottom-up (so the competition guard sees empty competitions), one named private helper per table: the hosted migration tool
-- asks a person to confirm a function body with several DELETE statements, so each table's removal is its own small function (as Pack 09C did for
-- results). Called only by delete_event, after it refused anything with sporting history.
create or replace function private.discard_event_matches(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin delete from public.matches m using public.competitions k where k.id = m.competition_id and k.event_id = p_event; end $$;
create or replace function private.discard_event_entries(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin delete from public.entries n using public.competitions k where k.id = n.competition_id and k.event_id = p_event; end $$;
create or replace function private.discard_event_registrations(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin delete from public.registrations where event_id = p_event; end $$;
create or replace function private.discard_event_competitions(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin delete from public.competitions where event_id = p_event; end $$;
create or replace function private.discard_event_row(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin delete from public.events where id = p_event; end $$;
create or replace function private.discard_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.discard_event_matches(p_event);
  perform private.discard_event_entries(p_event);
  perform private.discard_event_registrations(p_event);
  perform private.discard_event_competitions(p_event);
  perform private.discard_event_row(p_event);
end $$;
revoke execute on function private.discard_event(uuid), private.discard_event_matches(uuid), private.discard_event_entries(uuid), private.discard_event_registrations(uuid),
  private.discard_event_competitions(uuid), private.discard_event_row(uuid) from public, anon, authenticated;

create or replace function public.event_delete_check(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see this' using errcode = '42501'; end if;
  return jsonb_build_object('blockers', to_jsonb(private.event_delete_blockers(p_event)),
    'registrations', (select count(*) from public.registrations where event_id = p_event),
    'competitions', (select count(*) from public.competitions where event_id = p_event));
end $$;

-- Delete a disposable event. p_confirm must be the event's web address name (a typed confirmation). Server-side refusal for anything with history.
create or replace function public.delete_event(p_event uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events; v_blockers text[];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can delete it' using errcode = '42501'; end if;
  if coalesce(btrim(p_confirm), '') <> v_e.slug then raise exception 'type the event''s web address name to confirm' using errcode = '22023'; end if;
  perform 1 from public.competitions where event_id = p_event for update;
  v_blockers := private.event_delete_blockers(p_event);
  if cardinality(v_blockers) > 0 then
    raise exception 'this event has sporting history (%), so it cannot be deleted. Archive it, or exclude it from official statistics, instead', array_to_string(v_blockers, ', ') using errcode = 'P0001';
  end if;
  perform private.audit(p_event, 'event.deleted', p_event::text, jsonb_build_object('slug', v_e.slug, 'name', v_e.name, 'status', v_e.status,
    'competitions', (select count(*) from public.competitions where event_id = p_event), 'registrations', (select count(*) from public.registrations where event_id = p_event)));
  perform private.discard_event(p_event);
  return jsonb_build_object('status', 'deleted', 'slug', v_e.slug);
end $$;

-- ================================================================ 4. fighters: active / inactive
-- Who may: the platform owner; the fighter's own account; a captain or organization administrator of a team the fighter currently belongs to
-- (home team or current membership). Event organizers get nothing new here.
create or replace function private.can_manage_fighter(p_fighter uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.is_owner()
    or exists (select 1 from public.fighter_accounts a where a.fighter_id = p_fighter and a.user_id = auth.uid())
    or exists (select 1 from public.fighters f where f.id = p_fighter and f.team_id is not null and private.can_manage_team(f.team_id))
    or exists (select 1 from public.team_memberships m where m.fighter_id = p_fighter and (m.to_date is null or m.to_date >= current_date) and private.can_manage_team(m.team_id))) $$;
revoke execute on function private.can_manage_fighter(uuid) from public, anon, authenticated;

create or replace function public.can_manage_fighter(p_fighter uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.can_manage_fighter(p_fighter) $$;

create or replace function public.set_fighter_active(p_fighter uuid, p_active boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_f public.fighters; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_f from public.fighters where id = p_fighter for update;
  if not found then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  if not private.can_manage_fighter(p_fighter) then raise exception 'only the fighter, their team captain or administrator, or the platform administrator can change this' using errcode = '42501'; end if;
  if p_active is null then raise exception 'say active or inactive' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  if p_active and v_f.inactive_at is null then return jsonb_build_object('status', 'already_active'); end if;
  if not p_active and v_f.inactive_at is not null then return jsonb_build_object('status', 'already_inactive'); end if;
  update public.fighters set inactive_at = case when p_active then null else now() end, inactive_reason = case when p_active then null else v_reason end where id = p_fighter;
  perform private.audit(null, case when p_active then 'fighter.reactivated' else 'fighter.deactivated' end, p_fighter::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('status', case when p_active then 'active' else 'inactive' end);
end $$;

-- Entrant search leaves inactive fighters out unless the organizer types their exact name (a returning fighter is still found, never by browsing).
create or replace function public.search_fighters_for_entry(p_competition uuid, p_query text)
returns table (fighter_id uuid, display_name text, team_name text, city text, region text, gender text, claimed boolean, in_competition boolean, in_event boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid := private.event_of_competition(p_competition); v_q text := lower(btrim(coalesce(p_query, ''))); v_fiction boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer of this event can search for entrants' using errcode = '42501'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_fiction := private.is_synthetic('event', v_event);
  return query
  select f.id, f.display_name, t.name, f.city, f.region, f.gender,
    exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id),
    exists (select 1 from public.fighter_participation fp where fp.fighter_id = f.id and fp.competition_id = p_competition),
    exists (select 1 from public.fighter_participation fp where fp.fighter_id = f.id and fp.event_id = v_event)
  from public.fighters f
  left join public.teams t on t.id = f.team_id and t.status = 'approved'
  where (v_fiction or not private.is_synthetic('fighter', f.id))
    and (f.inactive_at is null or lower(f.display_name) = v_q)
    and not exists (select 1 from unnest(string_to_array(v_q, ' ')) w
                    where w <> '' and position(w in lower(concat_ws(' ', f.display_name, t.name, f.city, f.region))) = 0)
  order by (lower(f.display_name) = v_q) desc, f.display_name, f.id
  limit 15;
end $$;

-- ================================================================ 5. team roster: show / hide (current presentation only)
-- The current public roster leaves out hidden members and inactive fighters. Team managers keep seeing everyone through team_roster_manage.
create or replace function public.team_roster(p_team uuid)
returns table(fighter_id uuid, display_name text, role text, is_captain boolean, mercenary boolean, since date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (
    exists (select 1 from public.teams t where t.id = p_team and t.status = 'approved')
    or (auth.uid() is not null and (private.can_admin_team(p_team) or private.is_team_member(p_team, auth.uid())))
  ) then
    return;
  end if;
  return query
  with cur as (
    select m.fighter_id, m.role, m.mercenary, m.from_date, m.hidden_from_roster
    from public.team_memberships m
    where m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)
    union all
    select f.id, 'fighter', false, null::date, false
    from public.fighters f
    where f.team_id = p_team and not exists (select 1 from public.team_memberships m where m.team_id = p_team and m.fighter_id = f.id)
  ), one as (
    select distinct on (c.fighter_id) c.fighter_id, c.role, c.mercenary, c.from_date, c.hidden_from_roster
    from cur c order by c.fighter_id, (c.role = 'captain') desc, c.from_date nulls last
  )
  select o.fighter_id, f.display_name, o.role,
         (o.role = 'captain' or exists (select 1 from public.fighter_accounts fa join public.team_roles r on r.user_id = fa.user_id and r.team_id = p_team and r.role = 'captain' where fa.fighter_id = o.fighter_id)),
         o.mercenary, o.from_date
  from one o join public.fighters f on f.id = o.fighter_id
  where not o.hidden_from_roster and f.inactive_at is null
  order by 4 desc, lower(f.display_name), f.id;
end $$;

-- For the people who manage the team: every current member with whether they show publicly and whether they are active.
create or replace function public.team_roster_manage(p_team uuid)
returns table(fighter_id uuid, display_name text, role text, hidden boolean, inactive boolean, since date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.can_manage_team(p_team) then raise exception 'only a captain or administrator of this team can see this' using errcode = '42501'; end if;
  return query
  with cur as (
    select m.fighter_id, m.role, m.from_date, m.hidden_from_roster
    from public.team_memberships m
    where m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)
    union all
    select f.id, 'fighter', null::date, false
    from public.fighters f
    where f.team_id = p_team and not exists (select 1 from public.team_memberships m where m.team_id = p_team and m.fighter_id = f.id)
  ), one as (
    select distinct on (c.fighter_id) c.fighter_id, c.role, c.from_date, c.hidden_from_roster
    from cur c order by c.fighter_id, (c.role = 'captain') desc, c.from_date nulls last
  )
  select o.fighter_id, f.display_name, o.role, o.hidden_from_roster, f.inactive_at is not null, o.from_date
  from one o join public.fighters f on f.id = o.fighter_id
  order by lower(f.display_name), f.id;
end $$;

-- Show / hide one current member. A home-team fighter with no membership row gets one (current, from today) to carry the flag; nothing historical changes.
create or replace function public.set_roster_visibility(p_team uuid, p_fighter uuid, p_visible boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.can_manage_team(p_team) then raise exception 'only a captain or administrator of this team can change its roster' using errcode = '42501'; end if;
  if p_visible is null then raise exception 'say show or hide' using errcode = '22023'; end if;
  update public.team_memberships set hidden_from_roster = not p_visible
   where team_id = p_team and fighter_id = p_fighter and (to_date is null or to_date >= current_date);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if not exists (select 1 from public.fighters f where f.id = p_fighter and f.team_id = p_team) then
      raise exception 'this fighter is not a current member of the team' using errcode = 'P0001'; end if;
    insert into public.team_memberships (fighter_id, team_id, role, mercenary, from_date, hidden_from_roster) values (p_fighter, p_team, 'fighter', false, null, not p_visible);
  end if;
  perform private.audit(null, case when p_visible then 'team.roster_shown' else 'team.roster_hidden' end, p_team::text, jsonb_build_object('fighter', p_fighter));
  return jsonb_build_object('status', case when p_visible then 'shown' else 'hidden' end);
end $$;

-- ================================================================ 6. planning: the saved plan and the queue
-- The waiting line: manual order (Pack 09A), then the plan (Pack 09D), then the schedule and the bracket order exactly as before.
create or replace function private.queue_ordered(p_event uuid, p_key text, p_states text[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from public.matches m join public.competitions k on k.id = m.competition_id
  where k.event_id = p_event and private.field_key(m.field) = p_key and m.queue_state = any (p_states) and m.queue_state in ('scheduled', 'on_deck', 'in_the_hole')
    and private.match_runnable(m)
  order by case m.queue_state when 'on_deck' then 0 when 'in_the_hole' then 1 else 2 end,
           m.queue_order nulls last, m.plan_order nulls last, m.scheduled_at nulls last, k.sort, k.id, private.stage_rank(m.stage), private.round_rank(m.stage, m.round_label),
           coalesce(m.pool, '') collate "C", m.position, m.id $$;

-- Automatic promotion skips a held fight (someone in it is not here today); an organizer can still call it by hand (set_match_queue).
create or replace function private.promote_one(p_event uuid, p_key text, p_from text[], p_to text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select x as id from private.queue_ordered(p_event, p_key, p_from) x
           join public.matches m on m.id = x where not (m.plan_hold and m.queue_state = 'scheduled') limit 6 loop
    if private.lock_matches_nowait(array[r.id]) then
      update public.matches set queue_state = p_to, queue_order = null where id = r.id and queue_state = any (p_from);
      if found then return r.id; end if;
    end if;
  end loop;
  return null;
end $$;

-- Save the planner's order. p_order: the waiting fights in event-wide order (array of match ids); p_hold: fights to hold back today.
-- Only WAITING ('scheduled') fights of this event are touched; called fights (now / on deck / in the hole) never move. Fights not listed lose their plan
-- order. Idempotent: saving the same plan twice changes nothing. Returns {changed}.
create or replace function public.save_queue_plan(p_event uuid, p_order uuid[], p_hold uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_changed integer := 0; v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer can plan the running order' using errcode = '42501'; end if;
  if coalesce(cardinality(p_order), 0) > 2000 or coalesce(cardinality(p_hold), 0) > 2000 then raise exception 'too many fights in one plan' using errcode = '22023'; end if;
  if private.event_closed(p_event) then return jsonb_build_object('changed', 0, 'status', 'closed'); end if;
  perform private.queue_lock(p_event);
  with target as (
    select m.id,
           (select o.ord::integer from unnest(coalesce(p_order, '{}')) with ordinality o(id, ord) where o.id = m.id limit 1) as new_order,
           (m.id = any (coalesce(p_hold, '{}'))) as new_hold
    from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and m.queue_state = 'scheduled' and k.status <> 'finished'
    for update of m skip locked
  )
  update public.matches m set plan_order = t.new_order, plan_hold = t.new_hold
  from target t where m.id = t.id and (m.plan_order is distinct from t.new_order or m.plan_hold is distinct from t.new_hold);
  get diagnostics v_n = row_count;
  v_changed := v_n;
  if v_changed > 0 then perform private.audit(p_event, 'queue.planned', p_event::text, jsonb_build_object('changed', v_changed, 'planned', coalesce(cardinality(p_order), 0), 'held', coalesce(cardinality(p_hold), 0))); end if;
  return jsonb_build_object('changed', v_changed);
end $$;

-- "Let BuhurtOS plan this field again": forget the hand-made order of one field's waiting fights. Organizers only.
create or replace function public.clear_manual_queue(p_event uuid, p_field text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_key text := private.field_key(p_field); v_n integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer can change the running order' using errcode = '42501'; end if;
  perform private.queue_lock(p_event);
  update public.matches m set queue_order = null
  from public.competitions k
  where k.id = m.competition_id and k.event_id = p_event and private.field_key(m.field) = v_key and m.queue_state = 'scheduled' and m.queue_order is not null and k.status <> 'finished';
  get diagnostics v_n = row_count;
  if v_n > 0 then perform private.audit(p_event, 'queue.manual_cleared', v_key, jsonb_build_object('matches', v_n)); end if;
  return jsonb_build_object('changed', v_n);
end $$;

-- ================================================================ 7. privileges
revoke execute on function public.archive_event(uuid, text), public.unarchive_event(uuid), public.exclude_event_from_stats(uuid, text), public.restore_event_stats(uuid, text),
  public.event_delete_check(uuid), public.delete_event(uuid, text), public.can_manage_fighter(uuid), public.set_fighter_active(uuid, boolean, text),
  public.team_roster_manage(uuid), public.set_roster_visibility(uuid, uuid, boolean), public.save_queue_plan(uuid, uuid[], uuid[]), public.clear_manual_queue(uuid, text) from public, anon;
grant execute on function public.archive_event(uuid, text), public.unarchive_event(uuid), public.exclude_event_from_stats(uuid, text), public.restore_event_stats(uuid, text),
  public.event_delete_check(uuid), public.delete_event(uuid, text), public.can_manage_fighter(uuid), public.set_fighter_active(uuid, boolean, text),
  public.team_roster_manage(uuid), public.set_roster_visibility(uuid, uuid, boolean), public.save_queue_plan(uuid, uuid[], uuid[]), public.clear_manual_queue(uuid, text) to authenticated;
revoke execute on function private.queue_ordered(uuid, text, text[]), private.promote_one(uuid, text, text[], text) from public, anon, authenticated;
