#!/usr/bin/env python3
"""Generates supabase/manual/hosted_rollout_packs_01_05.sql (LOCAL THROWAWAY POSTGRES ONLY).

The function bodies in the rollout script are copied from a database built from the migrations (the branch target), with
pg_get_functiondef, so the hosted functions end up exactly as the canonical migrations define them, including the ones the migrations build
by patching an older body. Everything else (tables, policies, grants, constraint, triggers, views) is written out below from the migration files.

    export PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres
    supabase/tests/build_scratch.sh bos_target              # the branch: every migration
    supabase/manual/build_hosted_replica.sh bos_hosted      # the hosted state as inventoried on 2026-10-03
    python3 supabase/manual/build_hosted_rollout_packs_01_05.py bos_target bos_hosted

The expected fingerprints are measured, not typed: CURRENT_* from the local replica of the hosted state, TARGET_* from the branch build.
Both are embedded in the guard and in the final assertion (and TARGET_* in the verification file).
"""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'hosted_rollout_packs_01_05.sql')
VERIFY = os.path.join(HERE, 'hosted_verify_packs_01_05.sql')

host = os.environ.get('PGHOST', '')
if not (host.startswith('/') or host in ('localhost', '127.0.0.1')):
    sys.exit('refusing: PGHOST must be a local socket directory or localhost')
TARGET_DB = sys.argv[1] if len(sys.argv) > 1 else 'bos_target'
REPLICA_DB = sys.argv[2] if len(sys.argv) > 2 else 'bos_hosted'


def psql(db, sql):
    return subprocess.run(['psql', '-X', '-tA', '-d', db, '-c', sql], check=True, capture_output=True, text=True).stdout.rstrip('\n')


# One normalized line per schema object; the same text runs on hosted and locally. Function/view/trigger bodies are compared without comments
# and with whitespace collapsed (hosted copies of some older functions were applied without their comments).
FP_LINES = r"""select regexp_replace(line, '\s+', ' ', 'g') as line from (
    select 'table ' || c.relnamespace::regnamespace || '.' || c.relname || ' rls=' || c.relrowsecurity as line
      from pg_class c where c.relkind = 'r' and c.relnamespace::regnamespace::text in ('public', 'private')
    union all
    select 'column ' || c.relnamespace::regnamespace || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and c.relnamespace::regnamespace::text in ('public', 'private')
    union all
    select 'constraint ' || c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      from pg_constraint c where c.connamespace::regnamespace::text in ('public', 'private')
    union all
    select 'index ' || i.schemaname || '.' || i.tablename || ' ' || regexp_replace(i.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ', 'CREATE \1INDEX ')
      from pg_indexes i where i.schemaname in ('public', 'private')
    union all
    select 'policy ' || p.schemaname || '.' || p.tablename || ' ' || p.policyname || ' ' || p.cmd || ' roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
      from pg_policies p where p.schemaname in ('public', 'private')
    union all
    select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    union all
    select 'view ' || c.relnamespace::regnamespace || '.' || c.relname || ' opts=' || coalesce(array_to_string(c.reloptions, ','), '') || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_viewdef(c.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
      from pg_class c where c.relkind in ('v', 'm') and c.relnamespace::regnamespace::text in ('public', 'private')
    union all
    select 'trigger ' || c.relnamespace::regnamespace || '.' || c.relname || ' ' || t.tgname || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_triggerdef(t.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
      from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace::regnamespace::text in ('public', 'private')
  ) x"""
FP_SCHEMA = "select count(*) || '|' || md5(string_agg(line, E'\\n' order by line collate \"C\")) from (" + FP_LINES + ") y"
FP_GRANTS = """with o as (
    select 'f ' || p.oid::regprocedure::text as k, has_function_privilege('anon', p.oid, 'execute')::int::text || has_function_privilege('authenticated', p.oid, 'execute')::int::text as v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    union all
    select 't ' || c.oid::regclass::text, (select string_agg(has_table_privilege(r, c.oid, pr)::int::text, '' order by r, pr) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) pr)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm')
    union all select 's private', has_schema_privilege('anon', 'private', 'usage')::int::text || has_schema_privilege('authenticated', 'private', 'usage')::int::text
  ) select count(*) || '|' || md5(string_agg(k || '=' || v, ',' order by k collate "C")) from o"""

TARGET_SCHEMA = psql(TARGET_DB, FP_SCHEMA)
TARGET_GRANTS = psql(TARGET_DB, FP_GRANTS)
CURRENT_SCHEMA = psql(REPLICA_DB, FP_SCHEMA)
CURRENT_GRANTS = psql(REPLICA_DB, FP_GRANTS)


def fn(sig):
    body = psql(TARGET_DB, "select pg_get_functiondef('%s'::regprocedure)" % sig)
    return body.rstrip() + ';\n'


def fns(*sigs):
    return '\n'.join(fn(s) for s in sigs)


GUARD = f"""
begin;
set local lock_timeout = '10s';          -- never queue behind live traffic for long; rerun later if this times out
set local statement_timeout = '10min';

-- =====================================================================================================================================
-- SECTION 0: preconditions. Nothing changes unless the database is exactly in the state this script was written and tested for.
-- =====================================================================================================================================
do $guard$
declare v_schema text; v_grants text;
begin
  if current_user <> 'postgres' then
    raise exception 'REFUSING: run this as the postgres role (the Supabase SQL Editor default); current_user = %', current_user;
  end if;
  select ({FP_SCHEMA}) into v_schema;
  select ({FP_GRANTS}) into v_grants;
  if v_schema = '{TARGET_SCHEMA}' and v_grants = '{TARGET_GRANTS}' then
    raise notice 'The schema already matches branch fd746d4; this run changes nothing that matters (every step below is idempotent).';
  elsif v_schema <> '{CURRENT_SCHEMA}' or v_grants <> '{CURRENT_GRANTS}' then
    raise exception 'REFUSING: hosted schema is not the partially migrated state this script was built for. Found schema % / grants %; expected % / % (partial Packs 01-02) or % / % (already reconciled). Re-inventory before running.',
      v_schema, v_grants, '{CURRENT_SCHEMA}', '{CURRENT_GRANTS}', '{TARGET_SCHEMA}', '{TARGET_GRANTS}';
  end if;
  -- data prerequisites for the new event_staff role constraint (Section C)
  if exists (select 1 from public.event_staff where role not in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic')) then
    raise exception 'REFUSING: event_staff has a role outside the new list; resolve it first';
  end if;
end $guard$;
"""

SECTION_A = """
-- =====================================================================================================================================
-- SECTION A: additive reconciliation (Pack 02 tables, column and backfill). Creates objects the guard proved absent; changes no existing row
-- except filling the NEW column entries.team_name_at_event from the team's current name (same statement as the canonical migration).
-- =====================================================================================================================================
create table if not exists public.result_revisions (
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
create index if not exists result_revisions_comp_idx on public.result_revisions (competition_id, created_at);
alter table public.result_revisions enable row level security;
do $a$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_revisions' and policyname = 'result_revisions_read') then
    create policy result_revisions_read on public.result_revisions for select to authenticated using (private.is_organizer(private.event_of_competition(competition_id)));
  end if;
end $a$;
grant select on public.result_revisions to authenticated;

create table if not exists public.team_merges (
  removed_team_id uuid primary key,
  removed_name text not null,
  removed_slug text not null,
  kept_team_id uuid not null references public.teams (id) on delete cascade,
  was_public boolean not null,
  merged_at timestamptz not null default now()
);
alter table public.team_merges enable row level security;
do $a$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_merges' and policyname = 'team_merges_read') then
    create policy team_merges_read on public.team_merges for select to anon, authenticated using (was_public);
  end if;
end $a$;
grant select on public.team_merges to anon, authenticated;

alter table public.entries add column if not exists team_name_at_event text;
update public.entries e set team_name_at_event = t.name from public.teams t where t.id = e.team_id and e.team_name_at_event is null;
"""

SECTION_B = """
-- =====================================================================================================================================
-- SECTION B: Pack 02 function replacements (no DELETE inside) and the team_history view
-- =====================================================================================================================================
""" + fns('private.log_result_revision(uuid,uuid,text,integer,numeric,integer,numeric,text)', 'private.result_revisions_append_only()',
          'public.correct_result(uuid,uuid,integer,numeric,text)', 'private.snapshot_entry_team()') + """
revoke execute on function private.log_result_revision(uuid, uuid, text, integer, numeric, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.correct_result(uuid, uuid, integer, numeric, text) to authenticated;

-- team_history: the name used at the event, and the team as it is now (adds three columns at the end; existing columns unchanged)
create or replace view public.team_history with (security_invoker = true) as
 SELECT e.team_id, ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.starts_on, k.id AS competition_id, k.name AS competition_name, k.ruleset, r.final_place, r.points,
        private.is_synthetic('event', ev.id) AS synthetic,
        coalesce(e.team_name_at_event, t.name) AS team_name_at_event, t.name AS team_current_name, t.slug AS team_current_slug
   FROM ((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN teams t ON ((t.id = e.team_id)))
  WHERE e.team_id IS NOT NULL;
"""

SECTION_C = """
-- =====================================================================================================================================
-- SECTION C: statements that DROP or replace something (schema/privileges only; no row is removed)
-- =====================================================================================================================================
-- C1 (Pack 01) the obsolete "organizer of any event" helper. Inventory: no function, policy or view refers to it (pg_depend and bodies checked).
drop function if exists private.is_any_organizer();

-- C2 (Pack 02) official results are written only through finish_competition / correct_result / void_result (all logged).
--    Removes the policy that let any organizer of the event insert/update/delete results directly, and the matching table privileges.
drop policy if exists results_organizer_write on public.results;
revoke insert, update, delete on public.results from authenticated;

-- C3 (Pack 03) event_staff accepts the new head_marshal role. Replaces the CHECK constraint only (existing rows are validated, none removed).
do $c3$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.event_staff'::regclass and conname = 'event_staff_role_check')
     is distinct from $t$CHECK ((role = ANY (ARRAY['organizer'::text, 'head_marshal'::text, 'marshal'::text, 'scorekeeper'::text, 'medic'::text])))$t$ then
    alter table public.event_staff drop constraint if exists event_staff_role_check;
    alter table public.event_staff add constraint event_staff_role_check check (role in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic'));
  end if;
end $c3$;
"""

SECTION_D = """
-- =====================================================================================================================================
-- SECTION D: Pack 02 functions whose bodies contain DELETE, and the triggers that call them. Creating or replacing them deletes nothing now;
-- the DELETEs run later, only through these controlled paths, and every removed official result is first written to result_revisions.
-- =====================================================================================================================================
""" + fns('public.record_tie_decision(uuid,text,uuid[],text)', 'private.clear_tie_decisions()',
          'public.finish_competition(uuid,text)', 'public.void_result(uuid,uuid,text)', 'private.unfinish_competition()',
          'public.build_schedule(uuid,jsonb,text,jsonb,integer)', 'public.merge_teams(uuid,uuid)') + """
grant execute on function public.record_tie_decision(uuid, text, uuid[], text) to authenticated;
grant execute on function public.void_result(uuid, uuid, text) to authenticated;
grant execute on function public.build_schedule(uuid, jsonb, text, jsonb, integer) to authenticated;

create or replace trigger matches_clear_tie_decisions after update of queue_state, result, winner_entry_id, score_a, score_b on public.matches
  for each row when (old.stage in ('pool', 'round_robin') and (old.queue_state = 'final' or new.queue_state = 'final'))
  execute function private.clear_tie_decisions();
create or replace trigger result_revisions_no_change before update or delete on public.result_revisions for each row execute function private.result_revisions_append_only();
create or replace trigger entries_snapshot_team before insert or update of team_id on public.entries for each row execute function private.snapshot_entry_team();
"""

SECTION_E = """
-- =====================================================================================================================================
-- SECTION E: Pack 03 scoring commands (head marshal, idempotent finalization, Needs Review, paper recovery)
-- =====================================================================================================================================
""" + fns('private.can_score(uuid)', 'private.can_resolve_results(uuid)') + """
revoke execute on function private.can_resolve_results(uuid) from public;
grant execute on function private.can_resolve_results(uuid) to anon, authenticated;

""" + fns('public.grant_event_role_by_email(uuid,text,text)', 'private.reopen_match_core(uuid,text)', 'public.reopen_match(uuid,text)') + """
revoke execute on function private.reopen_match_core(uuid, text) from public, anon, authenticated;
grant execute on function public.reopen_match(uuid, text) to authenticated;

create table if not exists public.result_proposals (
  id uuid primary key,  -- the command id chosen by the device: the idempotency key
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  source text not null check (source in ('device', 'paper')),
  proposed_by uuid not null,
  schema_version integer not null,
  expected_version integer,
  result text not null check (result in ('a', 'b', 'draw')),
  score_a integer not null check (score_a >= 0),
  score_b integer not null check (score_b >= 0),
  detail jsonb not null default '{}'::jsonb,
  status text not null check (status in ('accepted', 'duplicate', 'conflict', 'stale', 'resolved_kept', 'resolved_replaced')),
  official_before jsonb,
  note text,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index if not exists result_proposals_match_idx on public.result_proposals (match_id, created_at);
create index if not exists result_proposals_open_idx on public.result_proposals (event_id) where status = 'conflict';
alter table public.result_proposals enable row level security;
do $e$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_proposals' and policyname = 'result_proposals_read') then
    create policy result_proposals_read on public.result_proposals for select to authenticated using (proposed_by = auth.uid() or private.can_resolve_results(event_id));
  end if;
end $e$;
grant select on public.result_proposals to authenticated;

""" + fns('public.list_result_conflicts(uuid)', 'public.resolve_result_conflict(uuid,text,text)',
          'public.enter_official_result(uuid,text,integer,integer,jsonb,text)') + """
grant execute on function public.list_result_conflicts(uuid) to authenticated;
grant execute on function public.resolve_result_conflict(uuid, text, text) to authenticated;
grant execute on function public.enter_official_result(uuid, text, integer, integer, jsonb, text) to authenticated;
"""

SECTION_F = """
-- =====================================================================================================================================
-- SECTION F: Pack 04 command compatibility window. submit_match_result is the final (Pack 03 + Pack 04) definition.
-- =====================================================================================================================================
""" + fns('private.command_schema_ok(integer)') + """
revoke execute on function private.command_schema_ok(integer) from public;
grant execute on function private.command_schema_ok(integer) to anon, authenticated;

""" + fns('public.submit_match_result(uuid,uuid,text,integer,integer,jsonb,integer,integer)') + """
grant execute on function public.submit_match_result(uuid, uuid, text, integer, integer, jsonb, integer, integer) to authenticated;
"""

SECTION_G = """
-- =====================================================================================================================================
-- SECTION G: Pack 05 fighter identity and history views
-- =====================================================================================================================================
create table if not exists public.fighter_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,       -- the record just created for an account
  candidate_id uuid not null references public.fighters (id) on delete cascade,     -- an existing record that may be the same person
  reason text not null default 'same_name' check (reason in ('same_name')),
  source text not null check (source in ('registration', 'team_join')),
  status text not null default 'open' check (status in ('open', 'distinct', 'duplicate')),
  note text,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  unique (fighter_id, candidate_id),
  check (fighter_id <> candidate_id)
);
create index if not exists fighter_identity_reviews_open_idx on public.fighter_identity_reviews (created_at) where status = 'open';
alter table public.fighter_identity_reviews enable row level security;   -- no policies: reachable only through the administrator functions
revoke all on public.fighter_identity_reviews from anon, authenticated;

""" + fns('private.ensure_fighter_for_account(uuid,text,uuid,text)') + """
revoke execute on function private.ensure_fighter_for_account(uuid, text, uuid, text) from public, anon, authenticated;

""" + fns('public.decide_registration(uuid,text)', 'public.decide_team_join(uuid,text)',
          'public.list_fighter_identity_reviews()', 'public.resolve_fighter_identity_review(uuid,text,text)') + """
grant execute on function public.list_fighter_identity_reviews() to authenticated;
grant execute on function public.resolve_fighter_identity_review(uuid, text, text) to authenticated;

create or replace view public.result_rows_all with (security_invoker = true) as
 SELECT r.competition_id, r.entry_id, r.final_place, COALESCE(r.points, (0)::numeric) AS points, k.name AS competition_name, k.category, k.gender, k.tier, k.structure,
        ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.event_type, ev.starts_on, ev.ends_on AS event_ends_on, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, e.team_id, e.fighter_id AS entry_fighter_id,
        private.is_synthetic('event', ev.id) AS synthetic, COALESCE(e.team_name_at_event, t.name) AS team_name_at_event, t.name AS team_current_name, t.slug AS team_current_slug
   FROM (((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN seasons se ON ((se.id = ev.season_id))) LEFT JOIN teams t ON ((t.id = e.team_id)))
  WHERE r.final_place IS NOT NULL;
create or replace view public.fighter_results_all with (security_invoker = true) as
 SELECT fp.fighter_id, rr.* FROM (result_rows_all rr JOIN fighter_participation fp ON ((fp.entry_id = rr.entry_id)));
create or replace view public.team_results_all with (security_invoker = true) as
 SELECT rr.* FROM result_rows_all rr WHERE rr.team_id IS NOT NULL;
grant select on public.result_rows_all, public.fighter_results_all, public.team_results_all to anon, authenticated;
"""

SECTION_H = f"""
-- =====================================================================================================================================
-- SECTION H: commit only if the result is exactly branch fd746d4 (schema objects and anon/authenticated privileges). Otherwise everything
-- above is rolled back and the database is unchanged.
-- =====================================================================================================================================
do $final$
declare v_schema text; v_grants text;
begin
  select ({FP_SCHEMA}) into v_schema;
  select ({FP_GRANTS}) into v_grants;
  if v_schema <> '{TARGET_SCHEMA}' or v_grants <> '{TARGET_GRANTS}' then
    raise exception 'ROLLED BACK: the result does not match branch fd746d4 (schema % / grants %, expected % / %). Nothing was changed.',
      v_schema, v_grants, '{TARGET_SCHEMA}', '{TARGET_GRANTS}';
  end if;
  raise notice 'Schema and privileges now match branch fd746d4 (schema %, grants %).', v_schema, v_grants;
end $final$;

commit;

-- =====================================================================================================================================
-- VERIFICATION (after commit). Behavioural and permission checks with fictional fixtures inside a sub-transaction that is always rolled
-- back; the result table below is the output of this script. Same content as supabase/manual/hosted_verify_packs_01_05.sql.
-- =====================================================================================================================================
"""

HEADER = f"""-- BuhurtOS: ONE-TIME manual reconciliation of the HOSTED Supabase database (project mvbxlebznlgroptwwdsm) with branch
-- ccr-a435c5f7-pmrfxr at fd746d4 (Packs 01-05). GENERATED by supabase/manual/build_hosted_rollout_packs_01_05.py; do not edit by hand.
--
-- THIS IS NOT MIGRATION HISTORY. The canonical, clean-install definitions stay in supabase/migrations/20261003000100..0500. This script exists
-- because Packs 01 and 02 were applied to hosted partially, in chunks, and the hosted migration tool refuses DROP/DELETE without confirmation.
--
-- WHAT IT EXPECTS (Section 0 refuses otherwise): hosted exactly as inventoried on 2026-10-03:
--   Pack 01 applied except "drop function private.is_any_organizer()"; Pack 02 sections 1-3 applied (match version trigger, draw columns,
--   pool_tie_decisions, ranking functions, pool_standings); Packs 03-05 absent.
--   Normalized schema fingerprint {CURRENT_SCHEMA}, privileges {CURRENT_GRANTS}.
-- WHAT IT PRODUCES (Section H refuses to commit otherwise): fingerprint {TARGET_SCHEMA}, privileges {TARGET_GRANTS} = a database built from
--   the branch migrations. Tested on a local replica whose fingerprint equals hosted's; see docs/claude-packs/HOSTED_RECONCILIATION_2026-10-03.md.
--
-- DATA: no row is deleted. One additive UPDATE fills the new column entries.team_name_at_event from the team's current name (null -> name).
--   All 596 existing official results belong to synthetic (test) events; the real Red Deer Rumble 2026 event is a draft with no results.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor (role postgres) -> paste the whole file -> Run. Supabase may ask you to confirm the
--   destructive statements (Section C, and DELETE inside function bodies in Section D): that confirmation is intended.
--   One transaction: if anything fails, nothing is changed. Safe to run again (it then changes nothing). The last result set is the
--   verification table: every row should be TRUE.
"""


def main():
    verify = open(VERIFY).read()
    # the two fingerprint checks end with $s$, '<expected>'); : first the schema, then the privileges
    values = iter([TARGET_SCHEMA, TARGET_GRANTS])
    verify, n = re.subn(r"\$s\$, '(?:@@TARGET_SCHEMA@@|@@TARGET_GRANTS@@|\d+\|[0-9a-f]{32})'\);", lambda m: "$s$, '%s');" % next(values), verify)
    assert n == 2, n
    # the verification file keeps its own header; drop it inside the rollout
    verify_body = verify[verify.index('create or replace function pg_temp.bos_verify_packs_01_05()'):]
    script = (HEADER + GUARD + SECTION_A + SECTION_B + SECTION_C + SECTION_D + SECTION_E + SECTION_F + SECTION_G + SECTION_H + '\n' + verify_body)
    for word in ('drop table', 'truncate'):
        assert word not in script.lower(), word
    open(OUT, 'w').write(script)
    # the standalone verification file gets the measured targets too
    open(VERIFY, 'w').write(verify)
    print('wrote', OUT)
    print('current', CURRENT_SCHEMA, CURRENT_GRANTS)
    print('target ', TARGET_SCHEMA, TARGET_GRANTS)


main()
