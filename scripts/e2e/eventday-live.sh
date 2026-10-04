#!/usr/bin/env bash
# Event day browser run against a REAL local stack: Postgres built from every migration + the Event day fixture, PostgREST, a small API front
# (scripts/e2e/localstack.mjs) and the real built app. LOCAL ONLY (refuses anything but a local socket / localhost). Not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/eventday-live.sh [shots-dir]
# E2E_SCRIPT picks the browser script (default scripts/e2e/eventday-live.mjs; scripts/e2e/arena-live.sh runs the Pack 09B one on the same stack).
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory or localhost" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
: "${POSTGREST_BIN:?set POSTGREST_BIN to a PostgREST binary}"
cd "$(dirname "$0")/../.."
DB=bos_ed; export JWT_SECRET="local-event-day-secret-0123456789-abcdef"
SHOTS="${1:-${E2E_SHOTS:-/tmp/eventday-shots}}"; mkdir -p "$SHOTS"
PIDS=(); cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }; trap cleanup EXIT

supabase/tests/build_scratch.sh $DB > /dev/null || exit 1
psql -X -q -d $DB -v ON_ERROR_STOP=1 -f scripts/e2e/fixtures/eventday.sql || exit 1

CONF=$(mktemp); cat > "$CONF" <<CFG
db-uri = "postgresql://postgres@/$DB?host=$PGHOST&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
db-pool = 8
CFG
"$POSTGREST_BIN" "$CONF" > /tmp/postgrest.log 2>&1 & PIDS+=($!)
node scripts/e2e/localstack.mjs > /tmp/localstack.log 2>&1 & PIDS+=($!)

VITE_BASE=/ VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local-publishable-key npx vite build --outDir /tmp/e2e-live > /tmp/e2e-live-build.log 2>&1 || { tail -5 /tmp/e2e-live-build.log; exit 1; }
npx vite preview --outDir /tmp/e2e-live --port 4182 > /tmp/e2e-live-preview.log 2>&1 & PIDS+=($!)
for i in $(seq 1 40); do curl -sf -o /dev/null localhost:3000/ && curl -sf -o /dev/null localhost:4182/ && break; sleep 0.5; done
curl -sf -o /dev/null "localhost:54321/rest/v1/events?select=id" || { echo "the local API did not come up"; tail -5 /tmp/postgrest.log; exit 1; }

if [ -n "${STACK_ONLY:-}" ]; then echo "stack ready (STACK_ONLY): app :4182, API :54321, database $DB"; wait; fi
E2E_BASE=http://localhost:4182 E2E_API=http://localhost:54321 E2E_SHOTS="$SHOTS" JWT_SECRET="$JWT_SECRET" PGDATABASE=$DB node "${E2E_SCRIPT:-scripts/e2e/eventday-live.mjs}"
