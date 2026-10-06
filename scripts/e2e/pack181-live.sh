#!/usr/bin/env bash
# Pack 18.1 security scenario (eight temporary devices + the stream controller) against the same REAL local stack as eventday-live.sh.
# LOCAL ONLY, not part of CI. The API-level run needs no browser; the browser part is scripts/e2e/device-live.sh.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack181-live.sh
E2E_SCRIPT=scripts/e2e/pack181-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack181.sql E2E_DB=bos_p181 exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p181shots}}"
