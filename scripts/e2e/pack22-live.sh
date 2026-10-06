#!/usr/bin/env bash
# Pack 22 (rules library, rule search and detail, versions, citing a rule on a marshal's call, discipline log) against the same REAL local stack as
# eventday-live.sh. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack22-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack22-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack22.sql E2E_DB=bos_p22e exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p22shots}}"
