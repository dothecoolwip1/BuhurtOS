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

for g in security_gate captain_gate team_admin_gate activity_gate pack01_gate pack02_gate pack03_gate pack05_gate pack07_gate pack1_gate pack07_pack1_reconcile_gate pack08_gate synthetic_org_rankings_gate pack09a_gate pack09b_gate team_discipline_rankings_gate pack09c_gate pack09d_gate pack10_gate pack11_gate pack12_gate pack13_gate pack14_gate pack16_gate; do
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

step "event-day field queue under real commits and two sessions"
$T/pack09a_concurrency.sh > /tmp/gate-p9c.log 2>&1; grep -E "FAIL|PACK09A" /tmp/gate-p9c.log | head -3; grep -q "PACK09A CONCURRENCY OK" /tmp/gate-p9c.log && ok "pack09a concurrency" || bad "pack09a concurrency"

step "finalize, reopen and close under two sessions"
$T/pack09c_concurrency.sh > /tmp/gate-p9cc.log 2>&1; grep -E "FAIL|PACK09C" /tmp/gate-p9cc.log | head -4; grep -q "PACK09C CONCURRENCY OK" /tmp/gate-p9cc.log && ok "pack09c concurrency" || bad "pack09c concurrency"

step "push notifications under real commits and two sessions"
$T/pack12_commit.sh > /tmp/gate-p12c.log 2>&1; grep -E "FAIL|PACK12" /tmp/gate-p12c.log | head -4; grep -q "PACK12 COMMIT OK" /tmp/gate-p12c.log && ok "pack12 commit" || bad "pack12 commit"

step "lyst control under real commits and parallel sessions"
$T/pack13_commit.sh > /tmp/gate-p13c.log 2>&1; grep -E "FAIL|PACK13" /tmp/gate-p13c.log | head -4; grep -q "PACK13 COMMIT OK" /tmp/gate-p13c.log && ok "pack13 commit" || bad "pack13 commit"

echo; if [ "$FAIL" = 0 ]; then echo "DATABASE GATE PASSED"; else echo "DATABASE GATE FAILED ($FAIL)"; exit 1; fi
