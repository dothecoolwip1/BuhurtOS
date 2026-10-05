#!/usr/bin/env bash
# Pack 13 (Lyst Control) against the same REAL local stack as eventday-live.sh. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack13-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack13-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack13.sql E2E_DB=bos_p13e exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p13shots}}"
