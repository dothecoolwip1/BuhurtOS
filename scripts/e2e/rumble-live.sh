#!/usr/bin/env bash
# Pack 11: the Red Deer Rumble full dress rehearsal against a REAL local stack (Postgres from every migration + the deterministic rehearsal
# fixture scripts/e2e/fixtures/rumble.sql, PostgREST, the local API front, the real built app in a real Chromium). LOCAL ONLY; not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/rumble-live.sh [shots-dir]
# The whole lifecycle runs through the application: Quick Setup, waiver, registration, review, check-in, Build tournament, two fields, scoring,
# problems, review, finalize, closeout, Arena, My next fight, career statistics, archive / exclusion / synthetic isolation, permissions.
set -uo pipefail
cd "$(dirname "$0")/../.."
E2E_FIXTURE=scripts/e2e/fixtures/rumble.sql E2E_DB="${E2E_DB:-bos_rumble}" E2E_SCRIPT=scripts/e2e/rumble-live.mjs exec scripts/e2e/eventday-live.sh "${1:-${E2E_SHOTS:-/tmp/rumble-shots}}"
