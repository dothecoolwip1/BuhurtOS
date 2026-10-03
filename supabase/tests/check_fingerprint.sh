#!/usr/bin/env bash
# Compare the schema built from the migrations with the committed fingerprint (schema drift inside the repository).
#   PGHOST=... PGPORT=... PGUSER=... supabase/tests/check_fingerprint.sh [db]            check
#   PGHOST=... PGPORT=... PGUSER=... supabase/tests/check_fingerprint.sh [db] --update    rewrite supabase/schema.fingerprint.txt (do this in the same commit as a migration)
set -euo pipefail
DB="${1:-bos_scratch}"; MODE="${2:-check}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp)"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/tests/schema_fingerprint.sql" | grep -v '^$' > "$OUT"
if [ "$MODE" = "--update" ]; then cp "$OUT" "$ROOT/schema.fingerprint.txt"; echo "updated schema.fingerprint.txt ($(wc -l < "$OUT") lines)"; exit 0; fi
if diff -u "$ROOT/schema.fingerprint.txt" "$OUT" > /tmp/fingerprint.diff; then echo "SCHEMA FINGERPRINT OK ($(wc -l < "$OUT") objects)"; else head -60 /tmp/fingerprint.diff; echo "SCHEMA FINGERPRINT DIFFERS: run supabase/tests/check_fingerprint.sh <db> --update and commit it with the migration" >&2; exit 1; fi
