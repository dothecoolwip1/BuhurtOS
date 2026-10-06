#!/usr/bin/env bash
# Red Deer Reavers membership, dues and voting + one account across BuhurtOS and the club website, on the REAL_AUTH local stack (the real Supabase
# Auth server, a mail sink, PostgREST and Postgres built from every migration). REAVERS_DIR = a checkout of the Red-deer-reavers website. LOCAL ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest AUTH_BIN=/path/to/supabase-auth REAVERS_DIR=../Red-deer-reavers scripts/e2e/club-live.sh [shots-dir]
REAL_AUTH=1 E2E_SCRIPT=scripts/e2e/club-live.mjs E2E_FIXTURE=scripts/e2e/fixtures/club.sql E2E_DB=bos_club exec "$(dirname "$0")/eventday-live.sh" "${1:-${E2E_SHOTS:-/tmp/clubshots}}"
