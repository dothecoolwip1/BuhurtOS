#!/usr/bin/env bash
# Pack 22 with nothing published (the production state until the owner publishes): visitor vs owner on a document in review. Same REAL local stack as
# eventday-live.sh, with the Event day fixture (owner a1, stranger a7; no rule version published). LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack22-review-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack22-review-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/eventday.sql E2E_DB=bos_p22r exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p22rshots}}"
