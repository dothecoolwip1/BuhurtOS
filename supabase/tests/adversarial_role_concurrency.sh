#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo 'refusing: local PostgreSQL only' >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo 'refusing: database URL set' >&2; exit 2; fi
cd "$(dirname "$0")/../.."
supabase/tests/build_scratch.sh bos_role_race >/dev/null
node supabase/tests/adversarial_role_concurrency.mjs
