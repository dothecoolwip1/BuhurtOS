#!/usr/bin/env bash
# Live updates must not reset the view: long event-day screens at phone and desktop size, scrolled, with transient UI state, while the server data
# changes underneath (Pack 18 requirement). Same REAL local stack as eventday-live.sh. LOCAL ONLY, not part of CI.
E2E_SCRIPT=scripts/e2e/live-stability.mjs E2E_FIXTURE=scripts/e2e/fixtures/pack16.sql E2E_DB=bos_stab exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/stabshots}}"
