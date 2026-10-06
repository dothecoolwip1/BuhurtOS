#!/usr/bin/env bash
# Pack 23R: the Red Deer Rumble REHEARSAL AND GAP ANALYSIS against a REAL local stack (Postgres from every migration + the TEST fixture
# scripts/e2e/fixtures/pack23r.sql, PostgREST, the local API front, the real built app in a real Chromium). LOCAL ONLY; not part of CI; TEST DATA ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack23r-rehearsal.sh [shots-dir]
# It is a discovery run: it records what the product does with a two-day, one-lyst, ~115-fight weekend (evidence.json in the shots dir) and only
# fails when the stack itself cannot run. The findings are written up in docs/claude-packs/PACK23R_RUMBLE_REHEARSAL.md.
set -uo pipefail
cd "$(dirname "$0")/../.."
E2E_FIXTURE=scripts/e2e/fixtures/pack23r.sql E2E_DB="${E2E_DB:-bos_23r}" E2E_SCRIPT=scripts/e2e/pack23r-rehearsal.mjs exec scripts/e2e/eventday-live.sh "${1:-${E2E_SHOTS:-/tmp/pack23r-shots}}"
