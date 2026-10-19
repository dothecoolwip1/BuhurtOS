#!/usr/bin/env bash
# Pack 09A: the field queue under real commits and two sessions at once. LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/pack09a_concurrency.sh
# The gate (pack09a_gate.sql) never commits, so the commit-time advancement trigger only runs for real here. Checks:
#   1  a result committed by a scorekeeper advances the queue (real commit)
#   2  two people press "start" at once: one outcome, nothing promoted twice
#   3  two live matches finalized at nearly the same moment (either order): the same settled queue
#   4  a call-by-hand on the match being finalized answers "try again" at once instead of waiting or deadlocking
#   5  an organizer reorders while a result is being saved: both land, the organizer's choice is respected
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DB=bos_p9c; FAIL=0
"$ROOT/tests/build_scratch.sh" $DB >/dev/null
E=00000000-0000-0000-0000-00000000e101; A2=00000000-0000-0000-0000-0000000000a2; A4=00000000-0000-0000-0000-0000000000a4
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'org@example.test'), ('00000000-0000-0000-0000-0000000000a4', 'score@example.test');
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e101', 'conc', 'Concurrency Open', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'), ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Race', '5v5', 'men', 'Classic', 'round_robin');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 't' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 8) n;
insert into public.entries (id, competition_id, team_id) select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 8) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b)
select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round ' || n, 0,
       ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, ('00000000-0000-0000-0000-00000000e1' || lpad((n % 8 + 1)::text, 2, '0'))::uuid from generate_series(1, 8) n;
SQL
m() { printf "00000000-0000-0000-0000-0000000f0%03d" "$1"; }
as_user() { printf "set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" "$1"; }
reset() { psql -X -q -d $DB -c "update public.matches set queue_state = 'scheduled', queue_order = null, result = null, winner_entry_id = null, score_a = null, score_b = null, finalized_at = null, version = 0, detail = '{}'" >/dev/null; psql -X -q -d $DB -c "delete from public.result_proposals" >/dev/null; }
state() { psql -X -At -d $DB -c "select string_agg(right(id::text, 1) || ':' || queue_state, ',' order by id) from public.matches"; }
finish() { printf "select public.submit_match_result(gen_random_uuid(), '%s', 'a', 5, 3, '{}'::jsonb, (select version from public.matches where id = '%s'), 1)->>'status';" "$(m $1)" "$(m $1)"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "       got:  $2"; echo "       want: $3"; FAIL=$((FAIL+1)); fi; }
start_field() { psql -X -q -At -d $DB -c "$(as_user $A4) select public.advance_field_queue('$E', null, true);" >/dev/null; }

# ---- 1. a committed result advances the queue
reset; start_field
check "1a start: 1 active, 2 on deck, 3 in the hole" "$(state)" "1:active,2:on_deck,3:in_the_hole,4:scheduled,5:scheduled,6:scheduled,7:scheduled,8:scheduled"
psql -X -q -At -d $DB -c "$(as_user $A4) $(finish 1)" >/dev/null
check "1b the committed result advanced the queue" "$(state)" "1:final,2:active,3:on_deck,4:in_the_hole,5:scheduled,6:scheduled,7:scheduled,8:scheduled"

# ---- 2. two people press start at once
reset
( psql -X -q -At -d $DB -c "begin; $(as_user $A4) select 'S1 ' || (public.advance_field_queue('$E', null, true) -> 'promoted')::text; select pg_sleep(2); commit;" > /tmp/p9-1.out 2>&1 ) &
sleep 0.7
( psql -X -q -At -d $DB -c "$(as_user $A2) select 'S2 ' || (public.advance_field_queue('$E', 'Field 1', true) -> 'promoted')::text;" > /tmp/p9-2.out 2>&1 ) &
wait
check "2a the first press promoted three matches" "$(grep -c '"to"' /tmp/p9-1.out | tr -d ' ')" "1"
check "2b the second press (made to wait for the first) promoted nothing" "$(grep 'S2' /tmp/p9-2.out | tr -d '\n')" "S2 []"
check "2c exactly one active, one on deck, one in the hole" "$(psql -X -At -d $DB -c "select count(*) filter (where queue_state='active') || '/' || count(*) filter (where queue_state='on_deck') || '/' || count(*) filter (where queue_state='in_the_hole') from public.matches")" "1/1/1"

# ---- 3. two live matches finalized at nearly the same moment
for order in "first-active-then-deck" "deck-then-active"; do
  reset; start_field
  if [ "$order" = "first-active-then-deck" ]; then
    ( psql -X -q -At -d $DB -c "begin; $(as_user $A4) $(finish 1) select pg_sleep(2); commit;" > /tmp/p9-1.out 2>&1 ) &
    sleep 0.7
    ( psql -X -q -At -d $DB -c "$(as_user $A4) $(finish 2)" > /tmp/p9-2.out 2>&1 ) &
  else
    ( psql -X -q -At -d $DB -c "begin; $(as_user $A4) $(finish 2) select pg_sleep(2); commit;" > /tmp/p9-2.out 2>&1 ) &
    sleep 0.7
    ( psql -X -q -At -d $DB -c "$(as_user $A4) $(finish 1)" > /tmp/p9-1.out 2>&1 ) &
  fi
  wait
  check "3 ($order) both results official" "$(cat /tmp/p9-1.out /tmp/p9-2.out | grep -c accepted | tr -d ' ')" "2"
  check "3 ($order) the same settled queue either way: 3 active, 4 on deck, 5 in the hole" "$(state)" "1:final,2:final,3:active,4:on_deck,5:in_the_hole,6:scheduled,7:scheduled,8:scheduled"
done

# ---- 4. calling by hand the match that is being finalized right now
reset; start_field
( psql -X -q -At -d $DB -c "begin; $(as_user $A4) $(finish 1) select pg_sleep(2.5); commit;" > /tmp/p9-1.out 2>&1 ) &
sleep 0.7
T0=$(date +%s.%N)
psql -X -q -At -d $DB -c "$(as_user $A2) select public.set_match_queue('$(m 1)', 'scheduled');" > /tmp/p9-2.out 2>&1
T1=$(date +%s.%N)
wait
check "4a the hand call was told to try again (55P03)" "$(grep -c 'try again' /tmp/p9-2.out | tr -d ' ')" "1"
check "4b ... straight away, not after waiting for the result to commit" "$(awk -v a="$T0" -v b="$T1" 'BEGIN { print (b - a < 1.5) ? 1 : 0 }')" "1"
check "4c the result is official and the queue advanced" "$(state)" "1:final,2:active,3:on_deck,4:in_the_hole,5:scheduled,6:scheduled,7:scheduled,8:scheduled"

# ---- 5. an organizer reorders while a result is being saved
reset; start_field
( psql -X -q -At -d $DB -c "begin; $(as_user $A4) $(finish 1) select pg_sleep(2); commit;" > /tmp/p9-1.out 2>&1 ) &
sleep 0.7
T0=$(date +%s.%N)
psql -X -q -At -d $DB -c "$(as_user $A2) select public.move_match_in_queue('$(m 2)', 'later') ->> 'changed';" > /tmp/p9-2.out 2>&1
T1=$(date +%s.%N)
wait
check "5a the reorder went through without waiting" "$(grep -c true /tmp/p9-2.out | tr -d ' ') $(awk -v a="$T0" -v b="$T1" 'BEGIN { print (b - a < 1.5) ? 1 : 0 }')" "1 1"
check "5b the organizer's choice is respected after the result commits: 3 active, 2 on deck, 4 in the hole" "$(state)" "1:final,2:on_deck,3:active,4:in_the_hole,5:scheduled,6:scheduled,7:scheduled,8:scheduled"

echo; if [ "$FAIL" = 0 ]; then echo "PACK09A CONCURRENCY OK"; else echo "PACK09A CONCURRENCY FAILED ($FAIL)"; exit 1; fi
