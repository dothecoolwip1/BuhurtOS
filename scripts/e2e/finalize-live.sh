#!/usr/bin/env bash
# Pack 09C (finalize a competition, reopen it, close the event, podiums on the public page and the Arena) against the same REAL local stack as
# eventday-live.sh, built from every migration plus scripts/e2e/fixtures/finalize.sql. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/finalize-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/finalize-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/finalize.sql E2E_DB=bos_fin exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/finalize-shots}}"
