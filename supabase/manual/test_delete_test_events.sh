#!/usr/bin/env bash
# Local test of supabase/manual/hosted_delete_test_events_2026-10-07.sql (LOCAL THROWAWAY POSTGRES ONLY).
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/manual/test_delete_test_events.sh export.json
# export.json: the read-only hosted export described in test_delete_test_events_fixture.py (not committed: production data).
#
# Each case runs the UNCHANGED cleanup file against a fresh copy of the fixture database and checks the outcome with its own queries
# (row hashes and a full-text id search over every table), not with the cleanup's own checks:
#   1 success: every row of the two events is gone (no table holds any of their ids except the kept ambiguous notification); the control
#     events, the shared fighters, team, memberships, organization and Auth accounts are byte-for-byte unchanged; every trigger is enabled as before
#   2 rerun after success refuses
#   3 slug changed -> refuses, nothing changes
#   4 another event's fight points at a test fight -> refuses, nothing changes
#   5 an app session (JWT claims set) -> refuses, nothing changes
#   6 a failure AFTER the deletes, while the four triggers are disabled (a test-only trigger makes an unrelated table change) -> the whole
#     transaction rolls back: every row is back, the four triggers are enabled; run without ON_ERROR_STOP, so COMMIT is reached and rolls back
#   7 a failure IN THE MIDDLE of the cascading delete (a test-only trigger raises) -> same: rolled back, triggers enabled
set -euo pipefail
HOST="${PGHOST:-}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: DATABASE_URL / SUPABASE_DB_URL is set" >&2; exit 2; fi
EXPORT="${1:?usage: test_delete_test_events.sh export.json}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLEANUP="$ROOT/manual/hosted_delete_test_events_2026-10-07.sql"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE=bos_cleanup_base
fail() { echo "FAIL: $*" >&2; exit 1; }

"$ROOT/tests/build_scratch.sh" "$BASE" > /dev/null
python3 "$ROOT/manual/test_delete_test_events_fixture.py" "$EXPORT" > "$TMP/fixture.sql"
psql -X -q -d "$BASE" -v ON_ERROR_STOP=1 <<'SQL'
-- hosted has auth.identities; the local stub schema does not
create table if not exists auth.identities (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade);
-- test-only helpers, outside public/private (the cleanup counts every public/private table)
create schema fixture_check;
create function fixture_check.tables() returns setof text language sql as $$
  select format('%I.%I', n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'private')
  union all select unnest(array['auth.users', 'auth.identities', 'storage.objects']) $$;
-- one line per table: row count and a hash of every row (order-independent)
create function fixture_check.db_hash() returns table (tbl text, n bigint, h text) language plpgsql as $$
declare t text; begin
  for t in select * from fixture_check.tables() order by 1 loop
    tbl := t; execute format('select count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '','' order by to_jsonb(x)::text), '''')) from %s x', t) into n, h;
    return next;
  end loop; end $$;
-- rows of any table whose content mentions one of the given ids
create function fixture_check.mentions(p_ids uuid[]) returns table (tbl text, n bigint) language plpgsql as $$
declare t text; v_re text := (select string_agg(i::text, '|') from unnest(p_ids) i); begin
  for t in select * from fixture_check.tables() order by 1 loop
    tbl := t; execute format('select count(*) from %s x where to_jsonb(x)::text ~ %L', t, v_re) into n;
    if n > 0 then return next; end if;
  end loop; end $$;
SQL
psql -X -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$TMP/fixture.sql"

TARGET_IDS="select array_agg(id) from (select id from public.events where id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')
  union all select id from public.competitions where event_id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')
  union all select m.id from public.matches m join public.competitions c on c.id = m.competition_id where c.event_id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')
  union all select e.id from public.entries e join public.competitions c on c.id = e.competition_id where c.event_id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')
  union all select id from public.registrations where event_id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')) x"
# the control rows, the shared records and every trigger's state: must be identical after a successful run
KEEP_HASH="with ctl as (select array_agg(id) a from (select id from public.events where slug like 'control-%'
    union all select c.id from public.competitions c join public.events e on e.id = c.event_id where e.slug like 'control-%') x)
  select md5(string_agg(t || ':' || h, ',' order by t)) from (
    select 'events' t, md5(string_agg(to_jsonb(e)::text, ',' order by e.id)) h from public.events e where slug like 'control-%'
    union all select 'competitions', md5(string_agg(to_jsonb(c)::text, ',' order by c.id)) from public.competitions c where c.id in (select unnest(a) from ctl)
    union all select 'matches', md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) from public.matches m where m.competition_id in (select unnest(a) from ctl)
    union all select 'entries', md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) from public.entries m where m.competition_id in (select unnest(a) from ctl)
    union all select 'results', md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) from public.results m where m.competition_id in (select unnest(a) from ctl)
    union all select 'result_revisions', md5(string_agg(to_jsonb(m)::text, ',' order by m.id)) from public.result_revisions m where m.competition_id in (select unnest(a) from ctl)
    union all select 'score_events', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.score_events s join public.matches m on m.id = s.match_id where m.competition_id in (select unnest(a) from ctl)
    union all select 'lyst_round_revisions', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.lyst_round_revisions s join public.matches m on m.id = s.match_id where m.competition_id in (select unnest(a) from ctl)
    union all select 'match_discipline', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.match_discipline s join public.events e on e.id = s.event_id where e.slug like 'control-%'
    union all select 'registrations', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.registrations s join public.events e on e.id = s.event_id where e.slug like 'control-%'
    union all select 'registration_inspections', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.registration_inspections s join public.events e on e.id = s.event_id where e.slug like 'control-%'
    union all select 'audit_log', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.audit_log s join public.events e on e.id = s.event_id where e.slug like 'control-%'
    union all select 'notifications', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.notifications s where s.payload ->> 'event_slug' like 'control-%' or s.id::text like '00000000-0000-4000-8000-0000000000a%'
    union all select 'fighters', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.fighters s
    union all select 'teams', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.teams s
    union all select 'team_memberships', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.team_memberships s
    union all select 'organizations', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.organizations s
    union all select 'auth.users', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from auth.users s
    union all select 'triggers', md5(string_agg(tgrelid::regclass::text || tgname || tgenabled::text, ',' order by tgrelid::regclass::text, tgname)) from pg_trigger where not tgisinternal) y"
DB_HASH="select md5(string_agg(tbl || n || h, ',' order by tbl)) from fixture_check.db_hash()"
DISABLED="select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','private') and t.tgenabled <> 'O'"

fresh() { psql -X -q -d postgres -c "drop database if exists $1" -c "create database $1 template $BASE" > /dev/null; }
q() { psql -X -At -d "$1" -c "$2"; }

echo "== 1 success"
fresh bos_cl_ok
TIDS=$(q bos_cl_ok "$TARGET_IDS")
[ "$(q bos_cl_ok "select count(*) from public.events where slug like 'control-%'")" = 2 ] || fail "fixture: control events missing"
q bos_cl_ok "select 'before: rows mentioning a test id', sum(n) from fixture_check.mentions('$TIDS')"
K0=$(q bos_cl_ok "$KEEP_HASH"); D0=$(q bos_cl_ok "$DISABLED")
psql -X -d bos_cl_ok -v ON_ERROR_STOP=1 -f "$CLEANUP" > "$TMP/ok.out" || { cat "$TMP/ok.out"; fail "cleanup failed"; }
cat "$TMP/ok.out"
[ "$(q bos_cl_ok "select count(*) from public.events where id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3') or slug in ('test-stuff-test','test-new-test')")" = 0 ] || fail "events left"
LEFT=$(q bos_cl_ok "select string_agg(tbl || '=' || n, ' ') from fixture_check.mentions('$TIDS')")
echo "after: tables still mentioning a test id: $LEFT"
# a2 carries a test registration id (kept as ambiguous); a1 names test-new-test but carries a control fight id (kept as ambiguous, mentions no test id)
[ "$LEFT" = "public.notifications=1" ] || fail "rows mentioning a test id remain beyond the ambiguous notification: $LEFT"
[ "$(q bos_cl_ok "select string_agg(id::text, ',' order by id) from public.notifications where to_jsonb(notifications)::text ~ '$(echo "$TIDS" | tr -d '{}' | tr ',' '|')'")" = "00000000-0000-4000-8000-0000000000a2" ] || fail "the remaining mention is not the ambiguous notification"
[ "$(q bos_cl_ok "select count(*) from public.notifications where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2')")" = 2 ] || fail "an ambiguous notification was deleted"
[ "$(q bos_cl_ok "select count(*) from public.notifications where id = '00000000-0000-4000-8000-0000000000e1'")" = 0 ] || fail "the owned test-stuff-test notification was kept"
[ "$(q bos_cl_ok "select count(*) from public.notifications where id = '00000000-0000-4000-8000-0000000000d1'")" = 1 ] || fail "decoy notification deleted"
[ "$(q bos_cl_ok "$KEEP_HASH")" = "$K0" ] || fail "control events, shared records or trigger states changed"
[ "$(q bos_cl_ok "$DISABLED")" = "$D0" ] && [ "$D0" = 0 ] || fail "a trigger is disabled"
for f in 7c848b31-39db-453c-b2c4-7fa84982620f f847b3c6-db5b-4a0b-bad2-bc9a4a8e0b38 9c9f5faa-687c-4035-b269-2d0d36774756 d2a3cda7-8ba1-4bff-8850-6a3c2eba4619; do
  [ "$(q bos_cl_ok "select count(*) from public.fighters where id = '$f'")" = 1 ] || fail "fighter $f missing"; done
[ "$(q bos_cl_ok "select count(*) from public.team_memberships where fighter_id = 'd2a3cda7-8ba1-4bff-8850-6a3c2eba4619' and team_id = 'a87fcf7c-c3a3-4fb6-b373-9c0b61676d68'")" = 1 ] || fail "Bjorn's membership missing"
echo "ok: test events gone, control + shared records + triggers unchanged"

echo "== 2 rerun refuses"
if psql -X -q -d bos_cl_ok -v ON_ERROR_STOP=1 -f "$CLEANUP" > "$TMP/re.out" 2>&1; then fail "rerun succeeded"; fi
grep -q "refusing: expected both test events, found 0" "$TMP/re.out" || { cat "$TMP/re.out"; fail "wrong rerun error"; }
echo "ok: $(grep -o 'refusing: .*' "$TMP/re.out" | head -1)"

refuses() {  # db, expected message, setup sql [, psql env]
  fresh "$1"
  psql -X -q -d "$1" -v ON_ERROR_STOP=1 -c "set session_replication_role = replica; $3" > /dev/null
  local h0 k0; h0=$(q "$1" "$DB_HASH"); k0=$(q "$1" "$KEEP_HASH")
  if env ${4:-} psql -X -q -d "$1" -v ON_ERROR_STOP=1 -f "$CLEANUP" > "$TMP/$1.out" 2>&1; then fail "$1: cleanup succeeded"; fi
  grep -q "$2" "$TMP/$1.out" || { cat "$TMP/$1.out"; fail "$1: expected '$2'"; }
  [ "$(q "$1" "$DB_HASH")" = "$h0" ] || fail "$1: the database changed"
  [ "$(q "$1" "$KEEP_HASH")" = "$k0" ] && [ "$(q "$1" "$DISABLED")" = 0 ] || fail "$1: triggers changed"
  echo "ok: $(grep -o 'ERROR: .*' "$TMP/$1.out" | head -1); every table's rows unchanged; all triggers enabled"
}
echo "== 3 slug changed"
refuses bos_cl_slug "no longer has slug test-stuff-test" "update public.events set slug = 'test-stuff-test-2' where id = 'feec4fde-ea8c-4eaa-86f2-9538b5c61785'"
echo "== 4 another event's fight points at a test fight"
refuses bos_cl_cross "another event's fight points at" "update public.matches set next_slot = 'a', next_match_id = (select m.id from public.matches m join public.competitions c on c.id = m.competition_id where c.event_id = '1acb67d3-db5f-40a5-bce7-682e0aa6edb3' limit 1)
  where id = (select m.id from public.matches m join public.competitions c on c.id = m.competition_id join public.events e on e.id = c.event_id where e.slug = 'control-new-test' limit 1)"
echo "== 5 app session"
refuses bos_cl_jwt "refusing: run this as the database owner" "select 1" "PGOPTIONS=-crequest.jwt.claims={\"sub\":\"8c40a519-d188-4779-ab4c-88ef4b939e07\",\"role\":\"authenticated\"}"

echo "== 6 failure after the deletes rolls everything back"
fresh bos_cl_late
psql -X -q -d bos_cl_late -v ON_ERROR_STOP=1 <<'SQL'
create function fixture_check.intrude() returns trigger language plpgsql as $$ begin insert into public.fighters (display_name) values ('Intruder (test)'); return null; end $$;
create trigger zz_test_intrude after delete on public.events for each statement execute function fixture_check.intrude();
SQL
H0=$(q bos_cl_late "$DB_HASH"); K0=$(q bos_cl_late "$KEEP_HASH")
psql -X -d bos_cl_late -f "$CLEANUP" > "$TMP/late.out" 2>&1 || true   # no ON_ERROR_STOP: COMMIT is reached on the aborted transaction
cat "$TMP/late.out"
grep -q "an unrelated table changed: public.fighters" "$TMP/late.out" || fail "late failure not detected"
grep -q "^ROLLBACK" "$TMP/late.out" || fail "COMMIT did not roll back"
[ "$(q bos_cl_late "$DB_HASH")" = "$H0" ] || fail "late failure: the database changed"
[ "$(q bos_cl_late "$KEEP_HASH")" = "$K0" ] || fail "late failure: triggers or kept rows changed"
[ "$(q bos_cl_late "$DISABLED")" = 0 ] || fail "late failure: a trigger is still disabled"
q bos_cl_late "select 'four bypassed triggers after rollback: ' || string_agg(tgname || '=' || tgenabled::text, ' ' order by tgname) from pg_trigger where tgname in ('result_revisions_no_change','lyst_round_revisions_no_change','match_discipline_guard','registration_inspections_append_only')"
[ "$(q bos_cl_late "select count(*) from public.events where id in ('feec4fde-ea8c-4eaa-86f2-9538b5c61785','1acb67d3-db5f-40a5-bce7-682e0aa6edb3')")" = 2 ] || fail "events gone after rollback"
echo "ok: rolled back, every row back, all triggers enabled"
echo "== 7 failure DURING the deletes (the four triggers disabled at that moment) rolls everything back"
fresh bos_cl_mid
psql -X -q -d bos_cl_mid -v ON_ERROR_STOP=1 <<'SQL'
create function fixture_check.boom() returns trigger language plpgsql as $$ begin raise exception 'test-only failure in the middle of the deletes'; end $$;
create trigger zz_test_boom before delete on public.lyst_rounds for each row execute function fixture_check.boom();
SQL
H0=$(q bos_cl_mid "$DB_HASH"); K0=$(q bos_cl_mid "$KEEP_HASH")
psql -X -d bos_cl_mid -f "$CLEANUP" > "$TMP/mid.out" 2>&1 || true
grep -q "test-only failure in the middle of the deletes" "$TMP/mid.out" || { cat "$TMP/mid.out"; fail "mid failure not raised"; }
grep -q "^ROLLBACK" "$TMP/mid.out" || fail "COMMIT did not roll back"
[ "$(q bos_cl_mid "$DB_HASH")" = "$H0" ] && [ "$(q bos_cl_mid "$KEEP_HASH")" = "$K0" ] && [ "$(q bos_cl_mid "$DISABLED")" = 0 ] || fail "mid failure: something changed"
echo "ok: $(grep -o 'ERROR: .*' "$TMP/mid.out" | head -1); rolled back, every row back, all triggers enabled"
echo "ALL CASES PASSED"
