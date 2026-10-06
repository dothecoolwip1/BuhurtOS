#!/usr/bin/env bash
# Regenerates supabase/tests/device_allowlist.txt from a scratch database built from the migrations (LOCAL THROWAWAY POSTGRES ONLY).
# The file is the REVIEWED statement of what the event-session roles may execute; pack181_sessions_gate.sql fails if the database and the file differ.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/gen_device_allowlist.sh [scratch-db]
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
cd "$(dirname "$0")/../.."
DB="${1:-bos_allow}"
supabase/tests/build_scratch.sh "$DB" > /dev/null
Q="select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')"
{
  echo "# Functions the BuhurtOS event-session roles may execute in addition to what anon already can (checked by supabase/tests/pack181_sessions_gate.sql)."
  echo "# One 'name(identity args)' per line. A new function becomes callable by a device ONLY by editing the migration AND regenerating this file (supabase/tests/gen_device_allowlist.sh) in the same reviewed change."
  echo "## bos_event_device"
  psql -X -d "$DB" -At -c "$Q and has_function_privilege('bos_event_device',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') order by 1"
  echo "## bos_controller"
  psql -X -d "$DB" -At -c "$Q and has_function_privilege('bos_controller',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') order by 1"
  echo "## anon (inherited by both roles; pinned so a forgotten REVOKE FROM PUBLIC cannot silently widen devices)"
  psql -X -d "$DB" -At -c "$Q and has_function_privilege('anon',p.oid,'execute') order by 1"
} > supabase/tests/device_allowlist.txt
psql -X -q -d postgres -c "drop database if exists $DB" > /dev/null
echo "wrote supabase/tests/device_allowlist.txt ($(grep -vc '^#' supabase/tests/device_allowlist.txt) entries)"
