#!/usr/bin/env bash
# Pack 09B (scorekeeper screen + Live Arena display) against the same REAL local stack as eventday-live.sh. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/arena-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/arena-live.mjs exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/arena-shots}}"
