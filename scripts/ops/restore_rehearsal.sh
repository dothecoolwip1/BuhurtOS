#!/usr/bin/env bash
# Restore an export into a DISPOSABLE LOCAL database and compare row counts with the manifest. Never touches a hosted project.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres scripts/ops/restore_rehearsal.sh <export-dir> [scratch-db-name]
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ] || [ -n "${SOURCE_DB_URL:-}" ]; then echo "refusing: a database URL is set in the environment" >&2; exit 2; fi
EXPORT="${1:?usage: restore_rehearsal.sh <export-dir> [db]}"; DB="${2:-bos_restore_rehearsal}"
HERE="$(cd "$(dirname "$0")" && pwd)"
( cd "$EXPORT" && sha256sum -c SHA256SUMS ) || { echo "checksum mismatch: the export is damaged" >&2; exit 1; }
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
# A plain Postgres has no Supabase roles/auth/storage/pg_cron: the stubs create just enough for the schema to load.
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/../../supabase/tests/local_stubs.sql" 2>&1 | grep -v 'wal_level\|HINT' || true
psql -X -q -d "$DB" -v ON_ERROR_STOP=0 -f "$EXPORT/schema.sql" > "$EXPORT/restore-schema.log" 2>&1 || true
psql -X -q -d "$DB" -v ON_ERROR_STOP=0 -f "$EXPORT/data.sql" > "$EXPORT/restore-data.log" 2>&1 || true
echo "errors while loading (review them; stub-related ones such as extensions are expected):"
grep -c "ERROR" "$EXPORT/restore-schema.log" "$EXPORT/restore-data.log" || true
BAD=0
while IFS=$'\t' read -r tbl want; do
  schema="${tbl%%.*}"; name="${tbl#*.}"
  got="$(psql -X -At -d "$DB" -c "select count(*) from \"$schema\".\"$name\"" 2>/dev/null || echo MISSING)"
  if [ "$got" != "$want" ]; then echo "MISMATCH $tbl: export has $want rows, restore has $got"; BAD=$((BAD+1)); fi
done < "$EXPORT/rowcounts.tsv"
if [ "$BAD" = 0 ]; then echo "RESTORE OK: every table row count matches the manifest"; else echo "RESTORE INCOMPLETE: $BAD table(s) differ"; exit 1; fi
