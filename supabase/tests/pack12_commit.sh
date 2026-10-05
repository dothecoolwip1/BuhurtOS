#!/usr/bin/env bash
# Pack 12: fight notifications under REAL commits (the queue advances at COMMIT and the notification trigger is deferred too). LOCAL THROWAWAY POSTGRES ONLY.
#   PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres supabase/tests/pack12_commit.sh
# The gate (pack12_gate.sql) never commits. Here, with real transactions and two sessions:
#   1  "start next" promotes three fights: each fighter gets exactly the alert for where their fight now is
#   2  a scorekeeper's result advances the queue by itself and the people who moved up are alerted once; the finished fight's alerts are retired
#   3  pressing "start next" again, and two people pressing it at once, send nothing more
#   4  a result is NEVER blocked by a broken notification store
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ]; then echo "refusing: a database URL is set" >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DB=bos_p12c; FAIL=0
"$ROOT/tests/build_scratch.sh" $DB >/dev/null
E=00000000-0000-0000-0000-00000000e101; ORG=00000000-0000-0000-0000-0000000000a9
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'Fighter ' || n, 'male', '{}' from generate_series(1, 8) n;
insert into public.fighter_accounts (fighter_id, user_id) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, ('00000000-0000-0000-0000-0000000000a' || n)::uuid from generate_series(1, 8) n;
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e101', 'commit-cup', 'Commit Cup', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a9', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Longsword', 'longsword', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, fighter_id) select ('00000000-0000-0000-0000-00000000ee0' || n)::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000f00' || n)::uuid from generate_series(1, 8) n;
-- four fights: fighters 1v2, 3v4, 5v6, 7v8
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b)
select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round ' || n, 0,
       ('00000000-0000-0000-0000-00000000ee0' || (2 * n - 1))::uuid, ('00000000-0000-0000-0000-00000000ee0' || (2 * n))::uuid from generate_series(1, 4) n;
SQL
m() { printf "00000000-0000-0000-0000-0000000f0%03d" "$1"; }
as_user() { printf "set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" "$1"; }
# "match:stage:count" lines for fight alerts
alerts() { psql -X -At -d $DB -c "select string_agg(right(payload->>'match_id', 1) || ':' || (payload->>'stage') || ':' || c, ' ' order by right(payload->>'match_id', 1), payload->>'stage') from (select payload, count(*) c from public.notifications where kind in ('fight_called','fight_moved') group by payload) x"; }
total() { psql -X -At -d $DB -c "select count(*) from public.notifications where kind in ('fight_called','fight_moved')"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "       got:  $2"; echo "       want: $3"; FAIL=$((FAIL+1)); fi; }

# ---- 1. start the field: 1 active, 2 on deck, 3 in the hole (two fighters each)
psql -X -q -At -d $DB -c "$(as_user $ORG) select public.advance_field_queue('$E', null, true);" >/dev/null
check "1a three fights called: one alert per fighter, each for where their fight is" "$(psql -X -At -d $DB -c "select string_agg(right(payload->>'match_id',1) || ':' || (payload->>'stage'), ' ' order by right(payload->>'match_id',1)) from (select distinct payload from public.notifications) x")" "1:active 2:on_deck 3:in_the_hole"
check "1b six fighters alerted once (2 per fight x 3 fights)" "$(total)" "6"

# ---- 2. a committed result advances the queue; the people who moved up are told once
psql -X -q -At -d $DB -c "$(as_user $ORG) select public.submit_match_result(gen_random_uuid(), '$(m 1)', 'a', 5, 3, '{}'::jsonb, (select version from public.matches where id = '$(m 1)'), 1)->>'status';" >/dev/null
check "2a fight 1 is final; 2 now active, 3 on deck, 4 in the hole" "$(psql -X -At -d $DB -c "select string_agg(right(id::text,1) || ':' || queue_state, ',' order by id) from public.matches")" "1:final,2:active,3:on_deck,4:in_the_hole"
check "2b the people who moved up were told, once each (6 + 2 + 2 + 2)" "$(total)" "12"
check "2c fighters 3 and 4 were told on deck then now: fight 2 has an in_the_hole(read) , on_deck(read) and active" "$(psql -X -At -d $DB -c "select string_agg(payload->>'stage', ',' order by created_at) from public.notifications where payload->>'match_id' = '$(m 2)' and user_id = '00000000-0000-0000-0000-0000000000a3'")" "on_deck,active"
check "2d the finished fight's alerts are retired (nothing unread for fight 1)" "$(psql -X -At -d $DB -c "select count(*) from public.notifications where payload->>'match_id' = '$(m 1)' and read_at is null")" "0"

# ---- 3. pressing start again, and two people at once: nothing new
before=$(total)
psql -X -q -At -d $DB -c "$(as_user $ORG) select public.advance_field_queue('$E', null, true);" >/dev/null
check "3a pressing start again sends nothing" "$(total)" "$before"
( psql -X -q -At -d $DB -c "begin; $(as_user $ORG) select public.advance_field_queue('$E', null, true); select pg_sleep(1.5); commit;" >/dev/null 2>&1 ) &
sleep 0.5
( psql -X -q -At -d $DB -c "$(as_user $ORG) select public.advance_field_queue('$E', 'Field 1', true);" >/dev/null 2>&1 ) &
wait
check "3b two people pressing start at once send nothing" "$(total)" "$before"

# ---- 4. a broken notification store never blocks a result
psql -X -q -d $DB -v ON_ERROR_STOP=1 <<'SQL'
create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'broken'; end $$;
create trigger boom before insert on public.notifications for each row execute function public.boom();
SQL
out=$(psql -X -q -At -d $DB -c "$(as_user $ORG) select public.submit_match_result(gen_random_uuid(), '$(m 2)', 'b', 2, 5, '{}'::jsonb, (select version from public.matches where id = '$(m 2)'), 1)->>'status';" 2>&1 | tail -1)
check "4a the result was accepted although notifying is broken" "$out" "accepted"
check "4b the queue still advanced (3 active, 4 on deck)" "$(psql -X -At -d $DB -c "select string_agg(right(id::text,1) || ':' || queue_state, ',' order by id) from public.matches")" "1:final,2:final,3:active,4:on_deck"
psql -X -q -d $DB -c "drop trigger boom on public.notifications"

if [ "$FAIL" = 0 ]; then echo "PACK12 COMMIT OK"; else echo "PACK12 COMMIT FAILED ($FAIL)"; exit 1; fi
