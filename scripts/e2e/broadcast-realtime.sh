#!/usr/bin/env bash
# Manage › Broadcast / public stream / overlay with a WORKING realtime connection (regression for the production blank screen). Same REAL local stack
# as eventday-live.sh plus a realtime stand-in inside the browser. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/broadcast-realtime.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/broadcast-realtime.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack14.sql E2E_DB=bos_brt exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/brshots}}"
