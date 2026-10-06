#!/usr/bin/env bash
# The Broadcast Companion (tools/obs-controller, BUILT) against the OBS STAND-IN (scripts/obs-standin: NOT OBS) and a REAL local stack:
# Postgres built from every migration + the OBS fixture, PostgREST, scripts/e2e/localstack.mjs (which also serves the real device-session Edge Function).
# Pack 13 is driven through its real RPCs as authorized users; the Companion follows it. No browser is needed. LOCAL ONLY, not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/obs-live.sh
# Ports / names are overridable so it can run beside other scenarios:
#   E2E_DB=bos_ctrl REST_PORT=3100 STACK_PORT=54421 E2E_TMP=/tmp/ctrl-e2e OBS_STANDIN_PORT=44655 COMPANION_UI_PORT=47777
# Result: PASS / FAIL lines and a final count. A run against the stand-in is "stand-in verified", never "OBS verified".
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory or localhost" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
: "${POSTGREST_BIN:?set POSTGREST_BIN to a PostgREST binary}"
cd "$(dirname "$0")/../.."
REST_PORT="${REST_PORT:-3100}"; STACK_PORT="${STACK_PORT:-54421}"; TMPD="${E2E_TMP:-/tmp/ctrl-e2e}"; mkdir -p "$TMPD"
export STACK_PORT POSTGREST_URL="http://127.0.0.1:$REST_PORT"
DB="${E2E_DB:-bos_ctrl}"; export JWT_SECRET="local-event-day-secret-0123456789-abcdef"
PIDS=(); cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }; trap cleanup EXIT

supabase/tests/build_scratch.sh "$DB" > /dev/null || exit 1
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f scripts/e2e/fixtures/obs.sql || exit 1

CONF=$(mktemp); cat > "$CONF" <<CFG
db-uri = "postgresql://postgres@/$DB?host=$PGHOST&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $REST_PORT
db-pool = 8
CFG
"$POSTGREST_BIN" "$CONF" > "$TMPD/postgrest.log" 2>&1 & PIDS+=($!)
node scripts/e2e/localstack.mjs > "$TMPD/localstack.log" 2>&1 & PIDS+=($!)

# the Companion, built exactly as it ships (one file); its dependencies live in its own folder
[ -d tools/obs-controller/node_modules/ws ] || npm ci --prefix tools/obs-controller --no-audit --no-fund > "$TMPD/npm-ci.log" 2>&1 || { tail -5 "$TMPD/npm-ci.log"; exit 1; }
(cd tools/obs-controller && node build.mjs) || exit 1

for i in $(seq 1 60); do curl -sf -o /dev/null "localhost:$REST_PORT/" && break; sleep 0.5; done
curl -sf -o /dev/null "localhost:$STACK_PORT/rest/v1/events?select=id" || { echo "the local API did not come up"; tail -5 "$TMPD/postgrest.log"; exit 1; }

if [ -n "${STACK_ONLY:-}" ]; then echo "stack ready (STACK_ONLY): API :$STACK_PORT, database $DB"; wait; fi
E2E_API="http://127.0.0.1:$STACK_PORT" E2E_TMP="$TMPD" JWT_SECRET="$JWT_SECRET" PGDATABASE="$DB" \
  OBS_STANDIN_PORT="${OBS_STANDIN_PORT:-44655}" COMPANION_UI_PORT="${COMPANION_UI_PORT:-47777}" node scripts/e2e/obs-live.mjs
