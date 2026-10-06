#!/usr/bin/env bash
# Red Deer Reavers: one account across the club website and BuhurtOS, joining, the 2026 fee waiver and the 2026 AGM, on the REAL_AUTH local stack
# (the real Supabase Auth server with its DEFAULT link-only emails, a mail sink, PostgREST and Postgres built from every migration). Both websites are
# served from ONE origin like production (http://localhost:4300/BuhurtOS/ and /Red-deer-reavers/). REAVERS_DIR = a checkout of Red-deer-reavers. LOCAL ONLY.
#   PGHOST=localhost PGPORT=55432 PGUSER=postgres PGPASSWORD=… POSTGREST_BIN=… AUTH_BIN=… REAVERS_DIR=../Red-deer-reavers scripts/e2e/club-live.sh [shots-dir]
REAL_AUTH=1 AUTH_DEFAULT_TEMPLATES=1 AUTH_SITE_URL=http://localhost:4300/BuhurtOS/ AUTH_ALLOW_LIST="http://localhost:4300/**,http://localhost:4182/**" \
  E2E_SCRIPT=scripts/e2e/club-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/club.sql E2E_DB=bos_club exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/clubshots}}"
