#!/usr/bin/env bash
# Pack 22 (official Buhurt International text, discipline desk, suspensions and eligibility) against the same REAL local stack as eventday-live.sh.
# LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack22-discipline-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack22-discipline-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack22d.sql E2E_DB=bos_p22d exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p22dshots}}"
