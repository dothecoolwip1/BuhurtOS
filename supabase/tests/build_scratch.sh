#!/usr/bin/env bash
# Builds a scratch database from the migrations (LOCAL THROWAWAY POSTGRES ONLY). Same guard as run_simulation.sh.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/build_scratch.sh [dbname]
set -euo pipefail
HOST="${PGHOST:-}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: DATABASE_URL / SUPABASE_DB_URL is set" >&2; exit 2; fi
DB="${1:-bos_scratch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGHOST
# SCRATCH_KEEP=1: the database already exists and must be kept (scripts/e2e/eventday-live.sh REAL_AUTH=1 lets the real Supabase Auth server lay out
# its auth schema first); otherwise start from an empty database.
[ -n "${SCRATCH_KEEP:-}" ] || psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/local_stubs.sql" 2>&1 | grep -v 'wal_level\|HINT' || true
for f in $(ls "$ROOT"/migrations/*.sql | sort); do
  case "$f" in *20261001001300*) continue;; esac   # needs pg_cron
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }
done
echo "built $DB"
