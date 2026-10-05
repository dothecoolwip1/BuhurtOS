#!/usr/bin/env bash
# Pack 09C under two sessions at once. LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/pack09c_concurrency.sh
# 1. Two organizers finalize the same competition at the same moment: one 'official', one 'already_official', one set of results, one finish audit.
# 2. An organizer reopens while another organizer's finalize is still committing: serialized, both audited, the competition ends running.
# 3. An organizer closes the event while another organizer's reopen is still committing: the close waits, then is refused (the event stays open).
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DB=bos_conc9c; FAIL=0
"$ROOT/tests/build_scratch.sh" $DB >/dev/null
E=00000000-0000-0000-0000-00000000e101; K1=00000000-0000-0000-0000-00000000b101; K2=00000000-0000-0000-0000-00000000b102
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'org1@example.test'), ('00000000-0000-0000-0000-0000000000a3', 'org2@example.test');
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('$E', 'conc9c', 'Closeout Open', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values ('$E', '00000000-0000-0000-0000-0000000000a2', 'organizer'), ('$E', '00000000-0000-0000-0000-0000000000a3', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('$K1', '$E', 'Longsword', 'longsword', 'men', 'Classic', 'round_robin'), ('$K2', '$E', 'Polearm', 'polearm', 'men', 'Classic', 'round_robin');
insert into public.fighters (id, display_name) select ('00000000-0000-0000-0000-00000000f1' || lpad(n::text, 2, '0'))::uuid, 'Fighter ' || n from generate_series(1, 4) n;
insert into public.entries (id, competition_id, fighter_id) select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, case when n <= 2 then '$K1' else '$K2' end::uuid, ('00000000-0000-0000-0000-00000000f1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 4) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, result, winner_entry_id, score_a, score_b, finalized_at) values
  ('00000000-0000-0000-0000-00000000d101', '$K1', 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102', 'final', 'a', '00000000-0000-0000-0000-00000000e101', 5, 2, now()),
  ('00000000-0000-0000-0000-00000000d102', '$K2', 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-00000000e104', 'final', 'b', '00000000-0000-0000-0000-00000000e104', 1, 5, now());
SQL
as_user() { printf "set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" "$1"; }
A2=00000000-0000-0000-0000-0000000000a2; A3=00000000-0000-0000-0000-0000000000a3
run_pair() { # $1 label, $2 first session SQL (holds 3 s), $3 second session SQL (starts after 1 s)
  ( psql -X -q -d $DB -At -c "begin; $(as_user $A2) $2 select pg_sleep(3); commit;" > /tmp/c9c_1.out 2>&1 || true ) &
  sleep 1
  ( psql -X -q -d $DB -At -c "begin; $(as_user $A3) $3 commit;" > /tmp/c9c_2.out 2>&1 || true ) &
  wait
  echo "--- $1"; echo "session 1: $(grep -E "S1|ERROR" /tmp/c9c_1.out | head -2 | tr '\n' ' ')"; echo "session 2: $(grep -E "S2|ERROR" /tmp/c9c_2.out | head -2 | tr '\n' ' ')"
}
Q() { psql -X -At -d $DB -c "$1"; }

run_pair "1. two organizers finalize the same competition" \
  "select 'S1 ' || (public.finalize_competition('$K1') ->> 'status');" \
  "select 'S2 ' || (public.finalize_competition('$K1') ->> 'status');"
R=$(Q "select (select count(*) from public.results where competition_id = '$K1') || '/' || (select count(*) from public.audit_log where action = 'competition.finished' and subject = '$K1') || '/' || (select status from public.competitions where id = '$K1')")
S=$(cat /tmp/c9c_1.out /tmp/c9c_2.out | grep -oE "S[12] [a-z_]+" | sort | tr '\n' ' ')
echo "results/finish audits/status: $R (expected 2/1/finished); outcomes: $S"
[ "$R" = "2/1/finished" ] && [[ "$S" == *"official"* ]] && [[ "$S" == *"already_official"* ]] && echo "ok   one finalize wins, the other learns it is already official" || { echo "FAIL finalize race"; FAIL=1; }

run_pair "2. a reopen arrives while a finalize is committing (K2)" \
  "select 'S1 ' || (public.finalize_competition('$K2') ->> 'status');" \
  "select 'S2 ' || coalesce((select 'reopened' where public.reopen_competition('$K2', 'contested at the table') is null), 'x');"
R=$(Q "select (select status from public.competitions where id = '$K2') || '/' || (select count(*) from public.results where competition_id = '$K2') || '/' || (select count(*) from public.result_revisions where competition_id = '$K2' and action = 'superseded') || '/' || (select count(*) from public.audit_log where action = 'competition.reopened' and subject = '$K2')")
echo "status/results/superseded/reopen audits: $R (expected running/0/2/1)"
[ "$R" = "running/0/2/1" ] && echo "ok   the reopen waited for the finalize, then superseded it with an audit trail" || { echo "FAIL reopen race"; FAIL=1; }
Q "select public.finalize_competition('$K2') from (select set_config('request.jwt.claim.sub', '$A2', false)) s" >/dev/null 2>&1 || true
psql -X -q -d $DB -At -c "begin; $(as_user $A2) select public.finalize_competition('$K2'); commit;" >/dev/null
[ "$(Q "select status from public.competitions where id = '$K2'")" = finished ] || { echo "FAIL could not refinalize K2"; FAIL=1; }

run_pair "3. close event while a reopen of K1 is committing" \
  "select 'S1 ' || coalesce((select 'reopened' where public.reopen_competition('$K1', 'late protest') is null), 'x');" \
  "select 'S2 ' || (public.close_event('$E') ->> 'status');"
R=$(Q "select (select closed_at is null from public.events where id = '$E') || '/' || (select status from public.competitions where id = '$K1')")
echo "event open/K1 status: $R (expected true/running); session 2 must have been refused"
[ "$R" = "true/running" ] && grep -q "ERROR" /tmp/c9c_2.out && echo "ok   the close waited for the reopen and was then refused: no closed event with a running competition" || { echo "FAIL closeout race"; FAIL=1; }

[ "$FAIL" = 0 ] && echo "PACK09C CONCURRENCY OK" || { echo "PACK09C CONCURRENCY FAILED"; exit 1; }
