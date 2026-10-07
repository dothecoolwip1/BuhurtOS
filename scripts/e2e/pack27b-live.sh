#!/usr/bin/env bash
# Pack 27B (Training Counters: the Training Counter QR, a learner's phone without an account, learning seats apart from the official evidence, the
# comparison with the same side's official counters, following, Exit Training) against the same REAL local stack as eventday-live.sh, on the Pack 13
# fixture. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack27b-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack27b-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack13.sql E2E_DB=bos_p27b exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p27bshots}}"
