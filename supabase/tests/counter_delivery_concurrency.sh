#!/usr/bin/env bash
# Fictional independent tournament; local disposable Postgres only.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then exit 2; fi
cd "$(dirname "$0")/../.."
DB=bos_counter_delivery_race
supabase/tests/build_scratch.sh "$DB" >/dev/null
E=00000000-0000-0000-0000-00000000ed01
M=00000000-0000-0000-0000-0000000fd001
U=00000000-0000-0000-0000-0000000000a2
C=00000000-0000-0000-0000-000000000099
S=00000000-0000-0000-0000-0000000afe01
q(){ psql -X -q -At -d "$DB" -v ON_ERROR_STOP=1 -c "$1"; }
run(){ q "set role authenticated; set request.jwt.claim.sub='$1'; $2"; }
id(){ node -e "console.log(require('node:crypto').randomUUID())"; }
check(){ [ "$2" = "$3" ] || { echo "FAIL $1: got $2, expected $3"; exit 1; }; echo "PASS $1"; }
wait_for(){
  for _ in $(seq 1 100); do
    if [ "$(q "select exists(select 1 from pg_stat_activity where datname='$DB' and application_name='$1' and wait_event='$2')")" = t ]; then return; fi
    sleep .03
  done
  echo "FAIL expected session $1 to reach $2"; exit 1
}
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/fixtures/independent_rehearsal.sql >/dev/null
run "$U" "select public.lyst_open('$M','weighted');" >/dev/null
q "insert into public.lyst_counter_seats(id,event_id,field_key,user_id,display_name,match_id,side,role,status,expires_at) values('$S','$E','field 1','$C','Fictional Race Counter','$M','a','learning','active',now()+interval '1 day');" >/dev/null
GO=$(id); PRESS=$(q 'select clock_timestamp()')
CMD="select public.lyst_timer_command_reliable('$E','field 1','$M',0,'$GO','start','fight',60000,1,0,null,'$PRESS')->>'status';"
run "$U" "$CMD" >/tmp/bos-counter-go-1 &
run "$U" "$CMD" >/tmp/bos-counter-go-2 &
wait
check 'same Go sent concurrently starts once' "$(cat /tmp/bos-counter-go-{1,2} | tr -d '\r' | sort | tr '\n' ',')" 'duplicate,ok,'
run "$U" "select public.lyst_timer_command_reliable('$E','field 1','$M',1,gen_random_uuid(),'pause',null,null,null,0,null,clock_timestamp());" >/dev/null
check 'lost Go response after Pause remains duplicate' "$(run "$U" "$CMD")" duplicate
check 'old Go did not restart paused clock' "$(q "select status||':'||rev from public.lyst_timer where event_id='$E' and field_key='field 1'")" paused:2

# A request fresh at dispatch must still expire after waiting for the Lyst lock.
PGAPPNAME=counter_hold psql -X -q -d "$DB" -c "begin; select pg_advisory_xact_lock(hashtextextended('bos:lyst:$E:field 1',0)); select pg_sleep(3); commit;" >/dev/null &
HOLD=$!
wait_for counter_hold PgSleep
check 'start intent expires after lock wait' "$(run "$U" "select public.lyst_timer_command_reliable('$E','field 1','$M',2,gen_random_uuid(),'start','fight',60000,1,0,null,clock_timestamp()-interval '14 seconds')->>'status';")" expired
wait "$HOLD"
check 'expired queued Go changes no revision' "$(q "select rev from public.lyst_timer where event_id='$E' and field_key='field 1'")" 2
run "$U" "select public.lyst_timer_command_reliable('$E','field 1','$M',2,gen_random_uuid(),'resume',null,null,null,0,null,clock_timestamp());" >/dev/null
RUN=$(q "select id from private.counter_runs where match_id='$M' order by generation desc limit 1")
TAP=$(id)
for n in $(seq 1 20); do
  run "$C" "select public.counter_deliver_action('$S','$RUN',jsonb_build_object('id','$TAP','kind','tap','round',1,'weight',1))->>'status';" >"/tmp/bos-counter-tap-$n" &
done
wait
check '20 concurrent retries save exactly one tap' "$(q "select count(*) from public.lyst_counts where id='$TAP'")" 1
check 'all retries acknowledge that tap' "$(cat /tmp/bos-counter-tap-* | grep -Ec '^(ok|duplicate)$')" 20

# Queue End first under the same clock lock; the later tap must be review evidence.
PGAPPNAME=counter_hold psql -X -q -d "$DB" -c "begin; select pg_advisory_xact_lock(hashtextextended('bos:lyst:$E:field 1',0)); select pg_sleep(3); commit;" >/dev/null &
HOLD=$!
wait_for counter_hold PgSleep
LATE=$(id)
PGAPPNAME=counter_late run "$C" "select public.counter_deliver_action('$S','$RUN',jsonb_build_object('id','$LATE','kind','tap','round',1,'weight',2))->>'status';" >/tmp/bos-counter-late &
LATER=$!
wait_for counter_late advisory
run "$U" "select public.lyst_end_round('$M',1);" >/tmp/bos-counter-end
wait "$HOLD" "$LATER"
check 'End preceding a waiting tap retains it for review' "$(tr -d '\r\n' </tmp/bos-counter-late)" review
check 'late tap never entered accepted counts' "$(q "select count(*) from public.lyst_counts where id='$LATE'")" 0

# Both paths use the same action-ID lock and cannot save conflicting identities.
run "$U" "select public.lyst_return_round(gen_random_uuid(),'$M',1,(select rev from public.lyst_rounds where match_id='$M' and round_no=1),'Marshal requests a fictional recount');" >/dev/null
RUN2=$(q "select id from private.counter_runs where match_id='$M' order by generation desc limit 1")
COLLISION=$(id)
run "$C" "select public.counter_upload_legacy_action('$S',jsonb_build_object('id','$COLLISION','kind','tap','round',1,'weight',1));" >/tmp/bos-counter-legacy 2>&1 &
LEGACY=$!
run "$C" "select public.counter_deliver_action('$S','$RUN2',jsonb_build_object('id','$COLLISION','kind','tap','round',1,'weight',1));" >/tmp/bos-counter-modern 2>&1 &
MODERN=$!
wait "$LEGACY" || true
wait "$MODERN" || true
check 'legacy/modern collision has one retained identity' "$(q "select (select count(*) from private.counter_legacy_evidence where id='$COLLISION')+(select count(*) from public.lyst_counts where id='$COLLISION')")" 1
echo 'COUNTER DELIVERY CONCURRENCY OK'
