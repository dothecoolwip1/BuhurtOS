#!/usr/bin/env bash
# Site sweep: every tournament-day person opens every screen they use, each in their own browser, against a REAL local stack (Postgres from every
# migration + scripts/e2e/fixtures/sweep.sql, PostgREST, the local API front, the real built app). LOCAL ONLY; not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/site-sweep.sh [shots-dir]
cd "$(dirname "$0")/../.."
E2E_FIXTURE=scripts/e2e/fixtures/sweep.sql E2E_DB="${E2E_DB:-bos_sweep}" E2E_SCRIPT=scripts/e2e/site-sweep.mjs exec scripts/e2e/eventday-live.sh "${1:-${E2E_SHOTS:-/tmp/sweep-shots}}"
