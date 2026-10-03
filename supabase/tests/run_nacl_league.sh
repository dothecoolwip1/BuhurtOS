#!/usr/bin/env bash
# Builds a scratch database from the migrations, loads the NACL-test seed (supabase/seed/nacl_test) and runs the verification.
# LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/nacl/run PGPORT=55433 PGUSER=postgres supabase/tests/run_nacl_league.sh [--keep] [--no-verify] [--no-seed]
#   --no-seed builds only the migrated database (use NACL_DB=<name> to keep it apart, e.g. for security_gate.sql)
# Refuses any host that is not a local socket directory, localhost or 127.0.0.1, so it can never touch a hosted Supabase project.
set -euo pipefail
HOST="${PGHOST:-}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1 (got '${HOST}')" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: DATABASE_URL / SUPABASE_DB_URL is set; this script only uses PGHOST" >&2; exit 2; fi
DB="${NACL_DB:-nacl_scratch}"
OWNER_ID="${OWNER_ID:-00000000-0000-4000-8000-0000000000a1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGHOST
VERIFY=1; KEEP=0; SEED=1
for a in "$@"; do case "$a" in --keep) KEEP=1;; --no-verify) VERIFY=0;; --no-seed) SEED=0; VERIFY=0;; esac; done

if [ "$KEEP" = 0 ] || ! psql -X -q -d postgres -tAc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/local_stubs.sql" 2>&1 | grep -v 'wal_level\|HINT' || true
  for f in $(ls "$ROOT"/migrations/*.sql | sort); do
    case "$f" in *20261001001300*) continue;; esac   # needs pg_cron, which a plain local Postgres does not have
    psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }
  done
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -c "insert into auth.users (id, email) values ('$OWNER_ID', 'owner@example.test') on conflict do nothing" \
    -c "insert into public.platform_roles (user_id, role) values ('$OWNER_ID', 'owner') on conflict do nothing"
fi

for f in $( [ "$SEED" = 1 ] && ls "$ROOT"/seed/nacl_test/[0-9][0-9]_*.sql | sort ); do
  echo "loading $(basename "$f")"
  sed "s/__OWNER_ID__/$OWNER_ID/g" "$f" | psql -X -q -d "$DB" -v ON_ERROR_STOP=1 > /dev/null
done
# The verifier checks the stats/ranking views over the fictional league, but synthetic events are (by design) excluded from those views.
# So in this THROWAWAY scratch database only, switch the synthetic flag off to let the views see the data. The exclusion itself is tested in tests/pack01_gate.sql.
if [ "$VERIFY" = 1 ]; then psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -c "update public.sources set synthetic = false"; fi
if [ "$VERIFY" = 1 ]; then psql -X -d "$DB" -v ON_ERROR_STOP=0 -f "$ROOT/tests/nacl_league_verify.sql"; fi
