#!/usr/bin/env bash
# Independent export of a BuhurtOS Postgres database (schema + data) with a manifest and checksums.
# Does NOT depend on Supabase platform backups (the Free plan has none). Read-only against the source database.
#
#   export SOURCE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'   # session-mode URL, Settings > Database
#   CONFIRM_EXPORT=yes scripts/ops/export_production.sh [output-dir]
#
# Writes <output-dir>/buhurtos-<UTCstamp>/ containing: schema.sql, data.sql, roles-note.txt, rowcounts.tsv, manifest.txt, SHA256SUMS
# The password is never written to disk or the manifest.
set -euo pipefail
: "${SOURCE_DB_URL:?set SOURCE_DB_URL (never commit it)}"
[ "${CONFIRM_EXPORT:-}" = "yes" ] || { echo "refusing: set CONFIRM_EXPORT=yes to take an export" >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "pg_dump not found; install postgresql-client (major version >= the server's)" >&2; exit 2; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-.}/buhurtos-$STAMP"
mkdir -p "$OUT"
# Schemas that hold BuhurtOS data. auth holds the accounts (emails, provider ids, hashed secrets): treat the export as sensitive.
SCHEMAS=(-n public -n private -n auth -n storage -n supabase_migrations)
pg_dump "$SOURCE_DB_URL" --schema-only --no-owner --no-privileges "${SCHEMAS[@]}" > "$OUT/schema.sql"
pg_dump "$SOURCE_DB_URL" --data-only --no-owner --no-privileges --disable-triggers "${SCHEMAS[@]}" > "$OUT/data.sql"
psql "$SOURCE_DB_URL" -X -At -F $'\t' -c "
  select schemaname||'.'||relname, n_live_tup from pg_stat_user_tables where schemaname in ('public','private','auth','storage','supabase_migrations') order by 1" > "$OUT/rowcounts.approx.tsv"
# Exact row counts (n_live_tup is only an estimate)
psql "$SOURCE_DB_URL" -X -At -F $'\t' -c "
  select table_schema||'.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
  from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','private','auth','storage','supabase_migrations') order by 1" > "$OUT/rowcounts.tsv"
HEAD="$(psql "$SOURCE_DB_URL" -X -At -c "select coalesce(max(version),'none') from supabase_migrations.schema_migrations" 2>/dev/null || echo unknown)"
{
  echo "BuhurtOS database export"
  echo "taken_utc: $STAMP"
  echo "source_host: $(printf '%s' "$SOURCE_DB_URL" | sed -E 's#^[a-z]+://[^@]*@##; s#[:/].*##')"
  echo "server_version: $(psql "$SOURCE_DB_URL" -X -At -c 'show server_version')"
  echo "migration_head: $HEAD"
  echo "repo_migration_head: $(ls "$(dirname "$0")/../../supabase/migrations" | sort | tail -1)"
  echo "pg_dump: $(pg_dump --version)"
  echo "note: storage.objects rows are included; the FILES in Storage buckets are not. Download them separately (see docs/runbooks/PRODUCTION_EXPORT_AND_RESTORE.md)."
  echo "note: the auth schema is included, so this export contains personal data. Encrypt it before copying it anywhere."
} > "$OUT/manifest.txt"
( cd "$OUT" && sha256sum schema.sql data.sql rowcounts.tsv manifest.txt > SHA256SUMS )
echo "export written to $OUT"; cat "$OUT/manifest.txt"
