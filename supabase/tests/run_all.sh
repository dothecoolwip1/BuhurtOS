#!/usr/bin/env bash
# The whole database gate, from zero: build a scratch database from the migrations, run every permission / integrity suite, the
# simulation, the fictional-league verifier, the concurrency test, the shared-vector check and the schema fingerprint.
# LOCAL THROWAWAY POSTGRES ONLY (same guard as the other scripts). CI runs exactly this.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/run_all.sh
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket directory, localhost or 127.0.0.1" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
cd "$(dirname "$0")/../.."
T=supabase/tests; DB="${GATE_DB:-bos_gate}"; FAIL=0
step() { printf '\n== %s\n' "$1"; }
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAIL=$((FAIL+1)); }

step "build $DB from every migration"
$T/build_scratch.sh "$DB" > /tmp/gate-build.log 2>&1 && ok "migrations apply from zero" || { cat /tmp/gate-build.log; bad "migrations apply from zero"; exit 1; }

for g in security_gate captain_gate team_admin_gate activity_gate pack01_gate pack02_gate pack03_gate pack05_gate pack1_gate; do
  step "$g"
  out=$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$T/$g.sql" 2>&1); echo "$out" | grep -E "PASSED|FAIL|ERROR" | head -3
  echo "$out" | grep -q "PASSED" && ! echo "$out" | grep -qE "FAIL|ERROR" && ok "$g" || bad "$g"
done

step "shared test vectors (SQL vs TypeScript league points)"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f $T/vectors_gate.sql > /tmp/gate-vec.log 2>&1; grep -E "VECTORS" /tmp/gate-vec.log; grep -q "VECTORS OK" /tmp/gate-vec.log && ok "vectors agree" || bad "vectors"

step "schema fingerprint (repository drift)"
$T/check_fingerprint.sh "$DB" && ok "fingerprint matches supabase/schema.fingerprint.txt" || bad "fingerprint"

step "tournament simulation"
$T/run_simulation.sh > /tmp/gate-sim.log 2>&1; grep -E "SIMULATION|FAIL|ERROR" /tmp/gate-sim.log | tail -3; grep -q "SIMULATION PASSED" /tmp/gate-sim.log && ok "simulation" || bad "simulation"

step "fictional league verifier"
$T/run_nacl_league.sh > /tmp/gate-nacl.log 2>&1; grep -E "^ +[0-9]+ \| +[0-9]+ \| +[0-9]+$" /tmp/gate-nacl.log | head -1
grep -E "^ +[0-9]+ \| +0 \| +[0-9]+$" /tmp/gate-nacl.log | head -1 | grep -q . && ! grep -q " FAIL " /tmp/gate-nacl.log && ok "league verifier" || bad "league verifier"

step "two organizers build the same schedule at once"
$T/pack02_concurrency.sh > /tmp/gate-conc.log 2>&1; grep -E "CONCURRENCY" /tmp/gate-conc.log; grep -q "CONCURRENCY OK" /tmp/gate-conc.log && ok "concurrency" || bad "concurrency"

echo; if [ "$FAIL" = 0 ]; then echo "DATABASE GATE PASSED"; else echo "DATABASE GATE FAILED ($FAIL)"; exit 1; fi
