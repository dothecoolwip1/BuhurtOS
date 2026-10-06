#!/usr/bin/env bash
# Pack 24A1: focus layout and tablet safety, verified in the RUNNING product against a REAL local stack (Postgres from every migration + the Pack 24A1
# fixture, PostgREST, the local API front, the real built app in a real Chromium) at 390x844, 768x1024, 1024x768 and 1280x900. LOCAL ONLY; not part of CI;
# TEST DATA ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack24a1-live.sh [shots-dir]
set -uo pipefail
cd "$(dirname "$0")/../.."
E2E_FIXTURE=scripts/e2e/fixtures/pack24a1.sql E2E_DB="${E2E_DB:-bos_24a1e}" E2E_SCRIPT=scripts/e2e/pack24a1-live.mjs exec scripts/e2e/eventday-live.sh "${1:-${E2E_SHOTS:-/tmp/pack24a1-shots}}"
