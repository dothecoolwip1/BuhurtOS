#!/usr/bin/env bash
# Two organizers build the schedule for the SAME competition at the same moment. LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/pack02_concurrency.sh
# Expect: exactly one request succeeds, the other is refused, and the competition ends with exactly one complete schedule.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DB=bos_conc
"$ROOT/tests/build_scratch.sh" $DB >/dev/null
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'org1@example.test'), ('00000000-0000-0000-0000-0000000000a3', 'org2@example.test');
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e101', 'conc', 'Concurrency Open', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'), ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a3', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Race', '5v5', 'men', 'Classic', 'round_robin');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 't' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 4) n;
insert into public.entries (id, competition_id, team_id) select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 4) n;
SQL
PLAN='[{"key":"a","stage":"round_robin","round_label":"Round 1","position":0,"a":"00000000-0000-0000-0000-00000000e101","b":"00000000-0000-0000-0000-00000000e102"},{"key":"b","stage":"round_robin","round_label":"Round 1","position":1,"a":"00000000-0000-0000-0000-00000000e103","b":"00000000-0000-0000-0000-00000000e104"}]'
as_user() { printf "set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" "$1"; }
# session 1 builds, then holds its transaction open for 3 seconds
( psql -X -q -d $DB -v ON_ERROR_STOP=1 -At -c "begin; $(as_user 00000000-0000-0000-0000-0000000000a2) select 'S1 built ' || public.build_schedule('00000000-0000-0000-0000-00000000b101', '$PLAN'::jsonb, 'new', '{\"format\":\"round_robin\",\"mode\":\"random\",\"seed\":7,\"algorithm\":\"ts-draw-v1\"}'::jsonb); select pg_sleep(3); commit;" > /tmp/conc1.out 2>&1 || true ) &
sleep 1
# session 2 starts while session 1 still holds the lock
( psql -X -q -d $DB -v ON_ERROR_STOP=1 -At -c "begin; $(as_user 00000000-0000-0000-0000-0000000000a3) select 'S2 built ' || public.build_schedule('00000000-0000-0000-0000-00000000b101', '$PLAN'::jsonb, 'new', null); commit;" > /tmp/conc2.out 2>&1 || true ) &
wait
echo "--- session 1:"; grep -E "built|ERROR" /tmp/conc1.out || true
echo "--- session 2:"; grep -E "built|ERROR" /tmp/conc2.out || true
N=$(psql -X -At -d $DB -c "select count(*) from public.matches where competition_id = '00000000-0000-0000-0000-00000000b101'")
OK=$(cat /tmp/conc1.out /tmp/conc2.out | grep -c " built ")
echo "matches in the competition: $N (expected 2); successful builds: $OK (expected 1)"
[ "$N" = 2 ] && [ "$OK" = 1 ] && echo "CONCURRENCY OK" || { echo "CONCURRENCY FAILED"; exit 1; }
SEED=$(psql -X -At -d $DB -c "select draw_seed from public.competitions where id = '00000000-0000-0000-0000-00000000b101'")
echo "stored draw seed: $SEED (expected 7, from the successful request)"; [ "$SEED" = 7 ] || exit 1
