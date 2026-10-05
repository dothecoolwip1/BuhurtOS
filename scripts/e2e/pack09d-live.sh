#!/usr/bin/env bash
# Pack 09D journeys (Quick Setup, Build tournament, Event day planning, Review wins & losses, archive / statistics, fighter and roster lifecycle) against
# the same REAL local stack as eventday-live.sh, built from every migration plus scripts/e2e/fixtures/pack09d.sql. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack09d-live.sh [shots-dir]
# PGTZ keeps the fixture's current_date on the browser's calendar day (America/Edmonton) whatever the UTC hour.
export PGTZ="${PGTZ:-America/Edmonton}"
E2E_SCRIPT=scripts/e2e/pack09d-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack09d.sql E2E_DB=bos_9d exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/pack09d-shots}}"
