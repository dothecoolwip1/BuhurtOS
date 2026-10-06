#!/usr/bin/env bash
# Event day browser run against a REAL local stack: Postgres built from every migration + the Event day fixture, PostgREST, a small API front
# (scripts/e2e/localstack.mjs) and the real built app. LOCAL ONLY (refuses anything but a local socket / localhost). Not part of CI.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest scripts/e2e/eventday-live.sh [shots-dir]
# E2E_SCRIPT picks the browser script (default scripts/e2e/eventday-live.mjs; scripts/e2e/arena-live.sh runs the Pack 09B one on the same stack).
# E2E_FIXTURE / E2E_DB pick the fixture and the scratch database (scripts/e2e/finalize-live.sh uses them for the Pack 09C journeys).
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory or localhost" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
: "${POSTGREST_BIN:?set POSTGREST_BIN to a PostgREST binary}"
cd "$(dirname "$0")/../.."
DB="${E2E_DB:-bos_ed}"; export JWT_SECRET="local-event-day-secret-0123456789-abcdef"
SHOTS="${1:-${E2E_SHOTS:-/tmp/eventday-shots}}"; mkdir -p "$SHOTS"
PIDS=(); cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }; trap cleanup EXIT

if [ -n "${REAL_AUTH:-}" ]; then
  # The REAL Supabase Auth server (GoTrue, AUTH_BIN) owns auth.* exactly as on hosted Supabase: it migrates its schema first, then the BuhurtOS
  # migrations run on top (local_stubs.sql only adds what is still missing), so sign-up, sign-in, reset and reauthentication are the real thing.
  : "${AUTH_BIN:?set AUTH_BIN to a Supabase Auth (gotrue) binary}"
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB" || exit 1
  psql -X -q -d $DB -v ON_ERROR_STOP=1 -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end \$\$" \
    -c "create schema if not exists auth" -c "create schema if not exists extensions" -c "create extension if not exists pgcrypto with schema extensions" || exit 1
  export GOTRUE_DB_DRIVER=postgres DB_NAMESPACE=auth; AUTH_DB_URL="postgres://${PGUSER:-postgres}:${PGPASSWORD:-postgres}@${PGHOST}:${PGPORT:-5432}/$DB?sslmode=disable&search_path=auth"
  export API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_SITE_URL=http://localhost:4182 GOTRUE_URI_ALLOW_LIST="http://localhost:4182/**"
  export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM="${AUTH_AUTOCONFIRM:-false}" GOTRUE_EXTERNAL_PHONE_ENABLED=false GOTRUE_PASSWORD_MIN_LENGTH=8
  export GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=noreply@buhurtos.test GOTRUE_SMTP_SENDER_NAME=BuhurtOS GOTRUE_SMTP_MAX_FREQUENCY=1s
  export GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
  export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_VERIFY=10000 GOTRUE_RATE_LIMIT_OTP=10000 GOTRUE_RATE_LIMIT_HEADER=
  export GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION="${AUTH_SECURE_PASSWORD_CHANGE:-true}" GOTRUE_LOG_LEVEL=warn
  DATABASE_URL="$AUTH_DB_URL" "$AUTH_BIN" migrate > /tmp/auth-migrate.log 2>&1 || { tail -20 /tmp/auth-migrate.log; exit 1; }
  SCRATCH_KEEP=1 supabase/tests/build_scratch.sh $DB > /dev/null || exit 1
  node scripts/e2e/mailsink.mjs > /tmp/mailsink.log 2>&1 & PIDS+=($!)
  DATABASE_URL="$AUTH_DB_URL" "$AUTH_BIN" serve > /tmp/auth-serve.log 2>&1 & PIDS+=($!)
  export AUTH_URL=http://127.0.0.1:9999 MAILSINK=http://127.0.0.1:2580
else
  supabase/tests/build_scratch.sh $DB > /dev/null || exit 1
fi
psql -X -q -d $DB -v ON_ERROR_STOP=1 -f "${E2E_FIXTURE:-scripts/e2e/fixtures/eventday.sql}" || exit 1

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
for i in $(seq 1 40); do curl -sf -o /dev/null localhost:3000/ && curl -sf -o /dev/null localhost:4182/ && { [ -z "${REAL_AUTH:-}" ] || curl -sf -o /dev/null localhost:9999/health; } && break; sleep 0.5; done
curl -sf -o /dev/null "localhost:54321/rest/v1/events?select=id" || { echo "the local API did not come up"; tail -5 /tmp/postgrest.log; exit 1; }

if [ -n "${STACK_ONLY:-}" ]; then echo "stack ready (STACK_ONLY): app :4182, API :54321, database $DB"; wait; fi
E2E_BASE=http://localhost:4182 E2E_API=http://localhost:54321 E2E_SHOTS="$SHOTS" MAILSINK="${MAILSINK:-}" JWT_SECRET="$JWT_SECRET" PGDATABASE=$DB node "${E2E_SCRIPT:-scripts/e2e/eventday-live.mjs}"
