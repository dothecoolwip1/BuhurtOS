#!/usr/bin/env bash
# Pack 18.1 Announcer view (browser at 390x844, 820x1180, 1280x900 + device-token security checks) against the same REAL local stack as eventday-live.sh.
# LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/announcer-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/announcer-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/announcer.sql E2E_DB="${E2E_DB:-bos_ann}" exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/ann-e2e}}"
