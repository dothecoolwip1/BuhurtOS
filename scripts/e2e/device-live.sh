#!/usr/bin/env bash
# Pack 18.1 temporary event devices, CLIENT side, against the same REAL local stack as eventday-live.sh: Postgres built from every migration + the device
# fixture, PostgREST, the local API front (which serves the REAL device-session Edge Function handler), the real built app in real Chromium.
# Eight devices (Counter Phone 1-4, Secretary / Scorekeeper, Marshal, Announcer, Event Admin) are created through the Edge Function and signed in
# through the real /device page, each in its own browser context. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/device-live.sh [shots-dir]
# Side by side with other runs:  E2E_DB=bos_dev1 REST_PORT=3300 STACK_PORT=54621 APP_PORT=4482 E2E_TMP=/tmp/dev1-e2e
E2E_SCRIPT=scripts/e2e/device-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/device.sql E2E_DB="${E2E_DB:-bos_dev1}" exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/device-shots}}"
