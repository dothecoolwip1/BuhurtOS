#!/usr/bin/env bash
# Builds a scratch database from the migrations and runs the tournament simulation. LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/run_simulation.sh [-v old_pool_seeding=1] [-v keep=1]
# Refuses any host that is not a local socket directory, localhost or 127.0.0.1, so it can never touch a hosted Supabase project.
set -euo pipefail
HOST="${PGHOST:-}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1 (got '${HOST}')" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: DATABASE_URL / SUPABASE_DB_URL is set; this script only uses PGHOST" >&2; exit 2; fi
DB="${SIM_DB:-bos_sim_scratch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGHOST
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/local_stubs.sql" 2>&1 | grep -v 'wal_level\|HINT' || true
for f in $(ls "$ROOT"/migrations/*.sql | sort); do
  case "$f" in *20261001001300*) continue;; esac   # needs pg_cron, which a plain local Postgres does not have
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }
done
psql -X -d "$DB" -v ON_ERROR_STOP=1 "$@" -f "$ROOT/tests/simulate_tournament.sql"
