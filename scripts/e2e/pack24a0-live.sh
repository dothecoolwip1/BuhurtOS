#!/usr/bin/env bash
# Pack 24A0: match safety guards verified in the RUNNING product, against a REAL local stack (Postgres from every migration + the Pack 23R TEST fixture,
# PostgREST, the local API front, the real built app in a real Chromium). LOCAL ONLY; not part of CI; TEST DATA ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack24a0-live.sh [shots-dir]
set -uo pipefail
cd "$(dirname "$0")/../.."
E2E_FIXTURE=scripts/e2e/fixtures/pack23r.sql E2E_DB="${E2E_DB:-bos_24a0e}" E2E_SCRIPT=scripts/e2e/pack24a0-live.mjs exec scripts/e2e/eventday-live.sh "${1:-${E2E_SHOTS:-/tmp/pack24a0-shots}}"
