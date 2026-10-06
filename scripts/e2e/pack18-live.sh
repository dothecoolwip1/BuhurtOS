#!/usr/bin/env bash
# Pack 18 (email + password sign-in, Organizer Command Centre) on the REAL_AUTH local stack: the real Supabase Auth server, a mail sink, PostgREST and
# Postgres built from every migration. LOCAL ONLY, not part of CI.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=… POSTGREST_BIN=/path/to/postgrest AUTH_BIN=/path/to/supabase-auth scripts/e2e/pack18-live.sh [shots-dir]
REAL_AUTH=1 E2E_SCRIPT=scripts/e2e/pack18-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack18.sql E2E_DB=bos_p18e exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p18shots}}"
