#!/usr/bin/env bash
# Builds a LOCAL replica of the hosted database schema as inventoried on 2026-10-03 (LOCAL THROWAWAY POSTGRES ONLY):
#   every migration up to 20261001003100, then Pack 01 without its "drop function private.is_any_organizer()", then Pack 02 sections 1-3 up to pool_standings
#   (match version trigger, draw columns, pool_tie_decisions, ranking functions, pool_standings; NOT record_tie_decision or the tie-clearing
#   trigger). This is exactly what was applied to hosted in chunks (pack02_a1_version_draw_tie_table, pack02_a2_ranking_functions).
# Its normalized fingerprint was compared with hosted's (same object count and hash) before the rollout script was written.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/manual/build_hosted_replica.sh [dbname]
set -euo pipefail
HOST="${PGHOST:-}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: DATABASE_URL / SUPABASE_DB_URL is set" >&2; exit 2; fi
DB="${1:-bos_hosted}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/local_stubs.sql" 2>&1 | grep -v 'wal_level\|HINT' || true
for f in $(ls "$ROOT"/migrations/*.sql | sort); do
  case "$f" in *20261001001300*) continue;; esac   # needs pg_cron
  case "$f" in *202610030*) continue;; esac          # Packs 01-05 are handled below
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }
done
grep -v '^drop function if exists private.is_any_organizer' "$ROOT/migrations/20261003000100_pack01_permissions_synthetic.sql" > "$TMP/p01.sql"
sed '/^create or replace function public.record_tie_decision/,$d' "$ROOT/migrations/20261003000200_pack02_tournament_integrity.sql" > "$TMP/p02.sql"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP/p01.sql" > /dev/null
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP/p02.sql" > /dev/null
echo "built $DB (replica of the partially migrated hosted schema)"
