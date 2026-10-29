#!/usr/bin/env bash
# Pack 13: Lyst Control under REAL commits and several sessions at once. LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/pack13_commit.sh
# The gate (pack13_gate.sql) never commits. Here, with real transactions and parallel connections:
#   1  two tablets press PAUSE on the same field timer at once: exactly one wins, the other is told "stale"; the timer is paused once
#   2  the same START command sent twice at once (a retry) changes the timer once
#   3  two tablets confirm the same round at once with different scores: exactly one official score is recorded, the other is stale
#   4  the same CONFIRM ROUND command sent four times at once: one revision, three "duplicate"
#   5  30 counters' taps (distinct ids) at once land exactly 30 times; the same 10 tap ids sent twice count once each
#   6  FINISH MATCH sent by two tablets at once saves one result; the queue and the bracket move once
#   7  a real commit of the finish leaves the timer idle and creates no lyst notification
#   8  (Pack 27A) two undos from one phone at once for a single tap: one 'ok', one 'nothing', the tap undone once
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DB=bos_p13c; FAIL=0
"$ROOT/tests/build_scratch.sh" $DB >/dev/null
E=00000000-0000-0000-0000-00000000e101
U1=00000000-0000-0000-0000-000000000090; U2=00000000-0000-0000-0000-000000000089
M=00000000-0000-0000-0000-0000000f0001
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@example.test' from generate_series(1, 99) n;
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'Fighter ' || n, 'male', '{}' from generate_series(1, 4) n;
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e101', 'commit-cup', 'Commit Cup', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000090', 'organizer'), ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000089', 'scorekeeper');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Longsword', 'longsword', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, fighter_id) select ('00000000-0000-0000-0000-00000000ee0' || n)::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000f00' || n)::uuid from generate_series(1, 4) n;
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee02'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 0, 'Field 1', '00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-00000000ee04');
-- The scoring tablets may operate called fights only; generic timer/concurrency tests start with both fights called.
update public.matches set queue_state = case when position = 0 and round_label = 'Round 1' then 'active' else 'on_deck' end;
SQL
uuid() { node -e "console.log(require('node:crypto').randomUUID())"; }
as_user() { printf "set role authenticated; set request.jwt.claim.sub = '%s';" "$1"; }
q() { psql -X -At -d $DB -c "$1"; }
run() { psql -X -q -At -d $DB -c "$(as_user "$1") $2" 2>&1 | tr -d '\r\n'; echo; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "       got:  $2"; echo "       want: $3"; FAIL=$((FAIL+1)); fi; }

run $U1 "select public.lyst_open('$M', 'simple');" >/dev/null
run $U1 "select public.lyst_open('00000000-0000-0000-0000-0000000f0002', 'simple');" >/dev/null
# ---- 2 first (the timer must exist): the same START sent twice at once
C=$(uuid)
run $U1 "select public.lyst_timer_command('$E','Field 1','$M',0,'$C','start','fight',60000,1)->>'status';" >/tmp/p13-a1 &
run $U2 "select public.lyst_timer_command('$E','Field 1','$M',0,'$C','start','fight',60000,1)->>'status';" >/tmp/p13-a2 &
wait
check "2 the same START twice at once starts once (one ok, one duplicate)" "$(cat /tmp/p13-a1 /tmp/p13-a2 | sort | tr '\n' ',')" "duplicate,ok,"
check "2b the timer is running, revision 1" "$(q "select status || ':' || rev from public.lyst_timer where event_id='$E' and field_key='field 1'")" "running:1"

# ---- 1. two tablets PAUSE at once
run $U1 "select public.lyst_timer_command('$E','Field 1','$M',1,gen_random_uuid(),'pause')->>'status';" >/tmp/p13-b1 &
run $U2 "select public.lyst_timer_command('$E','Field 1','$M',1,gen_random_uuid(),'pause')->>'status';" >/tmp/p13-b2 &
wait
check "1a exactly one PAUSE wins, the other is told stale" "$(cat /tmp/p13-b1 /tmp/p13-b2 | sort | tr '\n' ',')" "ok,stale,"
check "1b the timer is paused once (revision 2)" "$(q "select status || ':' || rev from public.lyst_timer where event_id='$E' and field_key='field 1'")" "paused:2"

# ---- 5. 30 counters tap at once
q "insert into public.lyst_matches (match_id, event_id, field_key) select '$M', '$E', 'field 1' on conflict do nothing" >/dev/null
SEATS=""
for n in $(seq 21 50); do
  S=$(uuid)
  q "insert into public.lyst_counter_seats (id, event_id, field_key, user_id, display_name, match_id, side, slot, role, status, expires_at) values ('$S','$E','field 1','00000000-0000-0000-0000-0000000000$n','Counter $n','$M','a','$([ $n -le 24 ] && echo $(printf "\\x$(printf %x $((n+44)))") || echo L$n)','$([ $n -le 24 ] && echo official || echo learning)','active', now() + interval '1 hour')" >/dev/null
  SEATS="$SEATS $n:$S"
done
# resume the timer so round 1 is the live round (fight timer running)
run $U1 "select public.lyst_timer_command('$E','Field 1','$M',2,gen_random_uuid(),'resume')->>'status';" >/dev/null
for pair in $SEATS; do
  n=${pair%%:*}; S=${pair##*:}
  run "00000000-0000-0000-0000-0000000000$n" "select public.counter_record(gen_random_uuid(), '$S', 1, 1)->>'status';" >/dev/null &
done
wait
check "5a 30 counters tapping at once: exactly 30 taps recorded" "$(q "select count(*) from public.lyst_counts where match_id='$M' and undo_of is null")" "30"
S21=$(echo "$SEATS" | tr ' ' '\n' | grep '^21:' | cut -d: -f2)
for i in 1 2 3 4 5 6 7 8 9 10; do ID[$i]=$(uuid); done
for round in 1 2; do for i in 1 2 3 4 5 6 7 8 9 10; do run 00000000-0000-0000-0000-000000000021 "select public.counter_record('${ID[$i]}', '$S21', 1, 1)->>'status';" >/dev/null & done; done
wait
check "5b the same 10 tap ids sent twice at once count once each (1 + 10)" "$(q "select coalesce(sum(weight),0) from public.lyst_counts where seat_id='$S21' and undo_of is null")" "11"

# ---- 8 (Pack 27A). two UNDOs from one phone at once, with one tap to undo: one takes it, the other is told "nothing"; the tap is undone once
S22=$(echo "$SEATS" | tr ' ' '\n' | grep '^22:' | cut -d: -f2)
run 00000000-0000-0000-0000-000000000022 "select public.counter_undo(gen_random_uuid(), '$S22', 1)->>'status';" >/tmp/p13-u1 &
run 00000000-0000-0000-0000-000000000022 "select public.counter_undo(gen_random_uuid(), '$S22', 1)->>'status';" >/tmp/p13-u2 &
wait
check "8a two undos at once for one tap: one ok, one nothing (never two ok)" "$(cat /tmp/p13-u1 /tmp/p13-u2 | sort | tr '\n' ',')" "nothing,ok,"
check "8b the tap is undone exactly once and the tally is 0" "$(q "select (select count(*) from public.lyst_counts where seat_id='$S22' and undo_of is not null) || ':' || private.lyst_seat_total('$S22', 1)")" "1:0"

# ---- 3 / 4. confirm round: two tablets with different scores; one command four times
run $U1 "select public.lyst_timer_command('$E','Field 1','$M',(select rev from public.lyst_timer where event_id='$E' and field_key='field 1'),gen_random_uuid(),'start','break',30000,1)->>'status';" >/dev/null
REV=$(q "select rev from public.lyst_rounds where match_id='$M' and round_no=1")
run $U1 "select public.lyst_confirm_round(gen_random_uuid(),'$M',1,6,5,$REV,null,null,'Marshal verified paper counts')->>'status';" >/tmp/p13-c1 &
run $U2 "select public.lyst_confirm_round(gen_random_uuid(),'$M',1,4,7,$REV,null,null,'Marshal verified paper counts')->>'status';" >/tmp/p13-c2 &
wait
check "3a two tablets confirm the same round at once: one official score, the other stale" "$(cat /tmp/p13-c1 /tmp/p13-c2 | sort | tr '\n' ',')" "ok,stale,"
check "3b exactly one revision, and it is the official score" "$(q "select count(*) || ':' || (select awarded_a || '-' || awarded_b from public.lyst_rounds where match_id='$M' and round_no=1 and status='confirmed') from public.lyst_round_revisions where match_id='$M'")" "1:$(q "select awarded_a || '-' || awarded_b from public.lyst_rounds where match_id='$M' and round_no=1")"
CC=$(uuid)
REV2=$(q "select rev from public.lyst_rounds where match_id='$M' and round_no=1")
for i in 1 2 3 4; do run $U1 "select public.lyst_confirm_round('$CC','$M',1,8,2,$REV2,null,null,'Same command four times')->>'status';" >/tmp/p13-d$i & done
wait
check "4 one confirm command sent four times at once: exactly one ok, never a second revision" "$(cat /tmp/p13-d1 /tmp/p13-d2 /tmp/p13-d3 /tmp/p13-d4 | grep -c "^ok$")" "1"
check "4b ... and never more than one revision from that command" "$(q "select (count(*) <= 1)::text from public.lyst_round_revisions where id='$CC'")" "true"

# ---- 6. FINISH MATCH from two tablets at once
V=$(q "select version from public.matches where id='$M'")
FC=$(uuid)
run $U1 "select public.lyst_finalize('$FC','$M',$V,'a')->>'status';" >/tmp/p13-f1 &
run $U2 "select public.lyst_finalize('$FC','$M',$V,'a')->>'status';" >/tmp/p13-f2 &
wait
check "6a the same FINISH from two tablets: one result saved, one answered as a repeat" "$(q "select count(*) from public.result_proposals where match_id='$M'")" "1"
check "6b the match is final once, with a version bump of one" "$(q "select queue_state || ':' || (version - $V) from public.matches where id='$M'")" "final:1"
# ---- 7
check "7a the finish stopped the field timer" "$(q "select status from public.lyst_timer where event_id='$E' and field_key='field 1'")" "idle"
check "7b nothing in lyst created a notification of its own kind" "$(q "select count(*) from public.notifications where kind not in ('fight_called','fight_moved')")" "0"

echo; if [ "$FAIL" = 0 ]; then echo "PACK13 COMMIT OK"; else echo "PACK13 COMMIT FAILED ($FAIL)"; exit 1; fi
