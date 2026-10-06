#!/usr/bin/env bash
# Pack 22 (official Buhurt International text, discipline desk, suspensions and eligibility) against the same REAL local stack as eventday-live.sh.
# LOCAL ONLY, not part of CI. With REAL_AUTH=1 (and AUTH_BIN) every role signs in through the real Supabase Auth server instead of a signed test token.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack22-discipline-live.sh [shots-dir]
#   PGHOST=localhost PGPORT=55432 PGUSER=postgres POSTGREST_BIN=… AUTH_BIN=/path/to/supabase-auth REAL_AUTH=1 scripts/e2e/pack22-discipline-live.sh [shots-dir]
FIX=scripts/e2e/fixtures/pack22d.sql; [ -n "${REAL_AUTH:-}" ] && FIX=scripts/e2e/fixtures/pack22d_real.sql
E2E_SCRIPT=scripts/e2e/pack22-discipline-live.mjs E2E_FIXTURE=$FIX E2E_DB=bos_p22d exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p22dshots}}"
