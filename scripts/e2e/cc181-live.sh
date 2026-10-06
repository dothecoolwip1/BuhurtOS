#!/usr/bin/env bash
# Pack 18.1 Command Centre panels (Event devices, Broadcast, Staff, Camera Off) against the REAL local stack of eventday-live.sh: Postgres built from every
# migration + the cc181 fixture, PostgREST, the local stack with the REAL device-session Edge Function handler (HS256), and the real built app in Chromium.
# LOCAL ONLY, not part of CI. Use your own database and ports so it can run beside other scenarios:
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/home/user/tools/postgrest \
#   E2E_DB=bos_cc181 REST_PORT=3400 STACK_PORT=54721 APP_PORT=4582 E2E_TMP=/tmp/cc181-e2e scripts/e2e/cc181-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/cc181-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/cc181.sql E2E_DB="${E2E_DB:-bos_cc181}" exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/cc181shots}}"
