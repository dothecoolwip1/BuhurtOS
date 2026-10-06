#!/usr/bin/env bash
# Pack 18.1: a temporary device over a LONG event (many token refreshes, an outage longer than a token, restart, revoke while offline, replace, sign-out-all),
# on the same REAL local stack as device-live.sh, with the device token shortened to 75 s so minutes stand in for hours. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/device-reliability-live.sh
export DEVICE_TOKEN_TTL_S="${DEVICE_TOKEN_TTL_S:-75}"
E2E_SCRIPT=scripts/e2e/device-reliability-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/device.sql E2E_DB="${E2E_DB:-bos_devrel}" exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/devrel-shots}}"
