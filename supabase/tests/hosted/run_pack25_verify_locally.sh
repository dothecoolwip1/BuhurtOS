#!/usr/bin/env bash
# Dry run of pack25_hosted_verify.sql on a LOCAL throwaway database built with the Pack 25 migration (never hosted). It seeds the two rows the hosted
# script assumes exist there (the synthetic test organizer's auth row and the test-data source), runs the block, and prints its result line.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/hosted/run_pack25_verify_locally.sh [dbname]
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
DB="${1:-bos_p25e}"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -c "insert into auth.users (id, email) values ('a1810000-0000-4000-8000-000000000001', 'pack181-hosted-test@example.test') on conflict (id) do nothing" \
  -c "insert into public.sources (id, kind, title, synthetic) values ('ac7ebfbe-8866-5e61-918e-0f3ae9fafab8', 'submitted', 'Synthetic test data (local dry run)', true) on conflict (id) do nothing"
out=$(psql -X -q -d "$DB" -f "$(dirname "$0")/pack25_hosted_verify.sql" 2>&1 || true)
echo "$out" | grep -o 'P25VERIFY ROLLED BACK: .*' || { echo "$out" | tail -5; exit 1; }
echo "$out" | grep -q 'FAIL' && { echo "FAILED checks above"; exit 1; } || echo "no FAIL"
