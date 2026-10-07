#!/usr/bin/env bash
# Pack 26: the FULL Rumble rehearsal (event setup → registration → review → check-in → build → two Lysts → devices → Counter QR → duel and team fight →
# handoff → offline → My next fight → public Live → Arena → conflict → correction → finalization → close → public Results) against the same REAL local
# stack as eventday-live.sh, on the Pack 26 fixture. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/pack26-live.sh [shots-dir]
E2E_SCRIPT=scripts/e2e/pack26-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack26.sql E2E_DB=bos_p26 exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/p26shots}}"
