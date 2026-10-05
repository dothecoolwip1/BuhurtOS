#!/usr/bin/env bash
# Pack 10 journeys (fighter career profile, team profile, cross-profile navigation, visual QA) against the same REAL local stack as eventday-live.sh,
# built from every migration plus scripts/e2e/fixtures/pack10.sql. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack10-live.sh [shots-dir]
export PGTZ="${PGTZ:-America/Edmonton}"
E2E_SCRIPT=scripts/e2e/pack10-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack10.sql E2E_DB=bos_p10live exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/pack10-shots}}"
