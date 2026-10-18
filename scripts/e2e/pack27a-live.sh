#!/usr/bin/env bash
# Pack 27A (Official Counter Foundation: one Counter QR, three phones, independent counting, per-phone undo, Change Counter, one current fight per Lyst,
# the marshal's call and the result ignoring the phones, the next fight, stale taps, a personal phone in and out of Counter mode) against the same REAL
# local stack as eventday-live.sh, on the Pack 13 fixture. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack27a-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack27a-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack13.sql E2E_DB=bos_p27a exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p27ashots}}"
