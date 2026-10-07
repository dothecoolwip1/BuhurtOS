-- Pack 25 HOSTED verification (production-safe). Like pack24_hosted_verify.sql: ONE DO block that builds its own throwaway synthetic fixtures
-- (tagged with the existing test-data source, fresh random ids), acts as the designated synthetic test organizer (pack181-hosted-test@example.test),
-- as counter-phone sessions (role bos_event_device, exactly as the Data API does with a device token) and as a signed-in trainee, walks the whole
-- Pack 25 counter workflow through the real database functions, and ENDS WITH A DELIBERATE EXCEPTION so every row it wrote is rolled back.
-- It never reads or writes a genuine event, fight, score, credential or session. It holds no destructive keyword (the Supabase SQL tool refuses those).
-- Expected: the exception message is a list of name=PASS items (or name=<sqlstate> for refusals), with no FAIL anywhere.
-- Local dry run (2026-10-07): supabase/tests/hosted/run_pack25_verify_locally.sh against the Pack 25 scratch database.
-- helpers for this one session (temporary schema; nothing is left behind)
create function pg_temp.p25_as(p_role text, p_sub uuid) returns void language plpgsql as $h$
begin
  execute 'reset role';
  if p_role is null then
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role, 'session_id', p_sub)::text, true); perform set_config('request.jwt.claim.sub', p_sub::text, true);
    execute 'set local role ' || p_role;
  end if;
end $h$;
create function pg_temp.p25_session(p_cred uuid) returns uuid language plpgsql as $h$
declare sid uuid;
begin
  insert into public.event_sessions (credential_id, secret_hash, last_seen_at, multi) values (p_cred, sha256(gen_random_uuid()::text::bytea), clock_timestamp(), true) returning id into sid;
  return sid;
end $h$;
-- a read of the fixtures as the owner while another role is set (the checks only; every workflow call runs as the role under test)
create function pg_temp.p25_q(p_q text) returns text language plpgsql security definer as $h$
declare v text;
begin
  execute p_q into v;
  return v;
end $h$;
grant execute on function pg_temp.p25_as(text, uuid), pg_temp.p25_session(uuid), pg_temp.p25_q(text) to public;
do $v$
declare
  r text := '';
  src constant uuid := 'ac7ebfbe-8866-5e61-918e-0f3ae9fafab8';   -- the existing synthetic (test-data) source
  org constant uuid := 'a1810000-0000-4000-8000-000000000001';   -- pack181-hosted-test@example.test, the designated synthetic test organizer
  trainee uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  ev uuid := gen_random_uuid(); evb uuid := gen_random_uuid();
  cls uuid := gen_random_uuid(); cteam uuid := gen_random_uuid(); cb uuid := gen_random_uuid();
  f uuid[] := '{}'; e uuid[] := '{}'; t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); et1 uuid := gen_random_uuid(); et2 uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid(); mt uuid := gen_random_uuid(); mb uuid := gen_random_uuid();
  pool uuid; poolb uuid; legacy uuid;
  s1 uuid; s2 uuid; s3 uuid; sb uuid; s4 uuid;
  x jsonb; seat1 uuid; seat2 uuid; seat3 uuid; tseat uuid; n int; ver int; code text; ok boolean;
begin
  -- ---------------- fixtures, as the database owner (all rolled back at the end)
  perform pg_temp.p25_as(null, null);
  for i in 1..8 loop f := f || gen_random_uuid(); e := e || gen_random_uuid(); end loop;
  insert into public.events (id, slug, name, status, starts_on, ends_on, timezone, field_count) values
    (ev,  'p25-verify-' || left(ev::text, 8),  'Pack 25 hosted verification (rolled back)', 'published', current_date, current_date + 1, 'America/Edmonton', 2),
    (evb, 'p25-verify-b-' || left(evb::text, 8), 'Pack 25 hosted verification, other event (rolled back)', 'published', current_date, current_date + 1, 'America/Edmonton', 1);
  insert into public.record_sources (source_id, entity_type, entity_id) values (src, 'event', ev), (src, 'event', evb);
  insert into public.event_staff (event_id, user_id, role) values (ev, org, 'organizer'), (evb, org, 'organizer');
  insert into public.competitions (id, event_id, name, category, gender, structure, rounds_to_win) values
    (cls, ev, 'P25 verify longsword', 'longsword', 'men', 'round_robin', 2), (cteam, ev, 'P25 verify 5v5', '5v5', 'men', 'round_robin', 2), (cb, evb, 'P25 verify other', 'longsword', 'men', 'round_robin', 2);
  for i in 1..8 loop
    insert into public.fighters (id, display_name) values (f[i], 'P25 Verify Fighter ' || i);
    insert into public.record_sources (source_id, entity_type, entity_id) values (src, 'fighter', f[i]);
  end loop;
  for i in 1..6 loop insert into public.entries (id, competition_id, fighter_id) values (e[i], cls, f[i]); end loop;
  insert into public.entries (id, competition_id, fighter_id) values (e[7], cb, f[7]), (e[8], cb, f[8]);
  insert into public.teams (id, slug, name, status) values (t1, 'p25-verify-red-' || left(t1::text, 8), 'P25 Verify Red Team', 'approved'), (t2, 'p25-verify-blue-' || left(t2::text, 8), 'P25 Verify Blue Team', 'approved');
  insert into public.record_sources (source_id, entity_type, entity_id) values (src, 'team', t1), (src, 'team', t2);
  insert into public.entries (id, competition_id, team_id) values (et1, cteam, t1), (et2, cteam, t2);
  insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, queue_state) values
    (m1, cls, 'round_robin', 'Round 1', 0, 'Field 1', e[1], e[2], 'active'),
    (m2, cls, 'round_robin', 'Round 1', 1, 'Field 1', e[3], e[4], 'on_deck'),
    (m3, cls, 'round_robin', 'Round 1', 2, 'Field 2', e[5], e[6], 'active'),
    (mt, cteam, 'round_robin', 'Round 1', 0, 'Field 2', et1, et2, 'scheduled'),
    (mb, cb, 'round_robin', 'Round 1', 0, 'Field 1', e[7], e[8], 'active');
  -- the event's ONE Counter QR (what the Edge Function creates through create_event_credential; here written by the owner with a fresh verifier)
  insert into public.event_credentials (event_id, kind, label, role, code_hash, pool_code, created_by) values
    (ev, 'counter_pool', 'Counter QR', 'counter', sha256(gen_random_uuid()::text::bytea), 'P25VRFY00001', org) returning id into pool;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, pool_code, created_by) values
    (evb, 'counter_pool', 'Counter QR', 'counter', sha256(gen_random_uuid()::text::bytea), 'P25VRFY00002', org) returning id into poolb;
  insert into public.event_credentials (event_id, kind, label, role, code_hash, created_by) values (ev, 'device', 'Counter Phone legacy', 'counter', sha256(gen_random_uuid()::text::bytea), org) returning id into legacy;
  begin
    insert into public.event_credentials (event_id, kind, label, role, code_hash, pool_code, created_by) values (ev, 'counter_pool', 'Second QR', 'counter', sha256('x'::bytea), 'P25VRFY00009', org);
    r := r || 'one_pool_per_event=FAIL(second allowed); ';
  exception when others then r := r || 'one_pool_per_event=' || sqlstate || '; '; end;
  begin
    insert into public.event_credentials (event_id, kind, label, role, code_hash, created_by) values (ev, 'counter_pool', 'No code', 'counter', sha256('y'::bytea), org);
    r := r || 'pool_needs_code=FAIL; ';
  exception when others then r := r || 'pool_needs_code=' || sqlstate || '; '; end;
  -- three phones scan the SAME QR: three open sessions, none ends another (multi)
  s1 := pg_temp.p25_session(pool); s2 := pg_temp.p25_session(pool); s3 := pg_temp.p25_session(pool); sb := pg_temp.p25_session(poolb);
  r := r || 'three_phones_one_qr=' || case when (select count(*) from public.event_sessions where credential_id = pool and ended_at is null) = 3 then 'PASS' else 'FAIL' end || '; ';

  -- ---------------- the organizer opens the first fight on Field 1 and starts round 1
  perform pg_temp.p25_as('authenticated', org);
  x := public.counter_pool_code(ev);
  r := r || 'organizer_shows_qr=' || case when x ->> 'code' = 'P25VRFY00001' and (x ->> 'open_sessions')::int = 3 and (x ->> 'can_create')::boolean then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  x := public.lyst_open(m1, 'weighted');
  r := r || 'lyst_open=' || (x ->> 'status') || '; ';
  x := public.lyst_timer_command(ev, 'Field 1', m1, 0, gen_random_uuid(), 'start', 'fight', 60000, 1, 0);
  r := r || 'round1_start=' || (x ->> 'status') || '; ';

  -- ---------------- phone 1: who, Lyst, side; count (two red counters: phone 1 and phone 2; phone 3 blue)
  perform pg_temp.p25_as('bos_event_device', s1);
  x := public.counter_state();
  r := r || 'fresh_phone_needs_setup=' || case when x ->> 'kind' = 'device' and x -> 'seat' = 'null'::jsonb and jsonb_array_length(x -> 'fields') = 2 then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  x := public.counter_bind('Field 1', 'a', 'Garrett');
  seat1 := (x -> 'seat' ->> 'id')::uuid;
  r := r || 'bind_red=' || case when x -> 'seat' ->> 'status' = 'active' and x ->> 'fighter' = 'P25 Verify Fighter 1' and (x ->> 'can_count')::boolean then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform public.counter_record(gen_random_uuid(), seat1, 1, 2); perform public.counter_record(gen_random_uuid(), seat1, 1, 2);
  x := public.counter_record(gen_random_uuid(), seat1, 1, 1);
  r := r || 'red1_counts_5=' || case when (x ->> 'total')::int = 5 then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform pg_temp.p25_as('bos_event_device', s2);
  x := public.counter_bind('Field 1', 'a', 'Nathan');
  seat2 := (x -> 'seat' ->> 'id')::uuid;
  perform public.counter_record(gen_random_uuid(), seat2, 1, 2); perform public.counter_record(gen_random_uuid(), seat2, 1, 2); perform public.counter_record(gen_random_uuid(), seat2, 1, 2);
  perform pg_temp.p25_as('bos_event_device', s3);
  x := public.counter_bind('Field 1', 'b', 'Taylor');
  seat3 := (x -> 'seat' ->> 'id')::uuid;
  perform public.counter_record(gen_random_uuid(), seat3, 1, 1);
  -- a counter cannot touch another counter's seat, the clock or the result
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 1); r := r || 'other_seat=FAIL(allowed); ';
  exception when others then r := r || 'other_seat=' || sqlstate || '; '; end;
  begin perform public.lyst_timer_command(ev, 'Field 1', m1, 1, gen_random_uuid(), 'pause', null, null, null, 0); r := r || 'counter_clock=FAIL(allowed); ';
  exception when others then r := r || 'counter_clock=' || sqlstate || '; '; end;
  begin perform public.finalize_match(m1, 'a', 5, 1, '{}'::jsonb, (select version from public.matches where id = m1)); r := r || 'counter_finalize=FAIL(allowed); ';
  exception when others then r := r || 'counter_finalize=' || sqlstate || '; '; end;
  begin perform public.lyst_confirm_round(gen_random_uuid(), m1, 1, 9, 0, 1, null, null, null); r := r || 'counter_confirm=FAIL(allowed); ';
  exception when others then r := r || 'counter_confirm=' || sqlstate || '; '; end;
  begin perform public.counter_record(gen_random_uuid(), seat3, 2, 1); r := r || 'stale_round=FAIL(allowed); ';
  exception when others then r := r || 'stale_round=' || sqlstate || ':' || left(sqlerrm, 20) || '; '; end;
  begin perform public.move_counter_session(s1, 'Field 2', 'b'); r := r || 'counter_moves_other=FAIL(allowed); ';
  exception when others then r := r || 'counter_moves_other=' || sqlstate || '; '; end;

  -- ---------------- the Lyst sees each phone on its own; the handoff keeps the tally and names every tap
  perform pg_temp.p25_as('authenticated', org);
  x := public.lyst_state(m1);
  r := r || 'lyst_evidence=' || case when (select string_agg((s ->> 'name') || ':' || (s ->> 'side') || ':' || (s -> 'tallies' -> 0 ->> 'total'), ',' order by s ->> 'side', s ->> 'name') from jsonb_array_elements(x -> 'seats') s)
    = 'Garrett:a:5,Nathan:a:6,Taylor:b:1' and jsonb_array_length(x -> 'field_counters') = 3 then 'PASS' else 'FAIL(' || (x -> 'seats')::text || ')' end || '; ';
  perform pg_temp.p25_as('bos_event_device', s1);
  x := public.counter_set_operator('Odin');
  r := r || 'handoff_keeps_tally=' || case when (x ->> 'my_total')::int = 5 and x -> 'binding' ->> 'operator' = 'Odin' and (x -> 'seat' ->> 'id')::uuid = seat1 then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform public.counter_record(gen_random_uuid(), seat1, 1, 1);
  perform pg_temp.p25_as('authenticated', org);
  r := r || 'taps_named=' || case when pg_temp.p25_q('select string_agg(distinct operator_name, '','' order by operator_name) from public.lyst_counts where seat_id = ''' || seat1 || '''') = 'Garrett,Odin' then 'PASS' else 'FAIL' end || '; ';
  x := public.counter_operator_history(ev, s1);
  r := r || 'operator_history=' || case when jsonb_array_length(x) = 2 and x -> 0 ->> 'operator' = 'Odin' and x -> 1 ->> 'operator' = 'Garrett' and x -> 1 ->> 'ended_at' is not null then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  -- the public view and the anonymous role see no counter data
  r := r || 'public_view_no_counters=' || case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lyst_public_state' and column_name ~ '(count|seat|operator|tally)') then 'PASS' else 'FAIL' end || '; ';
  execute 'reset role'; execute 'set local role anon';
  begin select count(*) into n from public.lyst_counts; r := r || 'anon_counts=' || case when n = 0 then 'PASS(0 rows)' else 'FAIL(' || n || ')' end || '; ';
  exception when others then r := r || 'anon_counts=' || sqlstate || '; '; end;
  begin select count(*) into n from public.counter_bindings; r := r || 'anon_bindings=' || case when n = 0 then 'PASS(0 rows)' else 'FAIL' end || '; ';
  exception when others then r := r || 'anon_bindings=' || sqlstate || '; '; end;

  -- ---------------- the round ends: taps refused; the marshal's call is the only score
  perform pg_temp.p25_as('authenticated', org);
  perform public.lyst_timer_command(ev, 'Field 1', m1, (select rev from public.lyst_timer where event_id = ev and field_key = 'field 1'), gen_random_uuid(), 'start', 'break', 30000, null, 0);
  perform pg_temp.p25_as('bos_event_device', s1);
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 1); r := r || 'round_over_refused=FAIL(allowed); ';
  exception when others then r := r || 'round_over_refused=' || sqlstate || ':' || left(sqlerrm, 11) || '; '; end;
  perform pg_temp.p25_as('authenticated', org);
  x := public.lyst_confirm_round(gen_random_uuid(), m1, 1, 3, 1, pg_temp.p25_q('select rev from public.lyst_rounds where match_id = ''' || m1 || ''' and round_no = 1')::int, null, null, null);
  r := r || 'confirm=' || coalesce(x ->> 'status', 'none') || '; ';
  r := r || 'marshal_call_not_counters=' || case when pg_temp.p25_q('select official_a || ''-'' || official_b from public.lyst_public_state where match_id = ''' || m1 || '''') = '3-1' then 'PASS' else 'FAIL' end || '; ';
  r := r || 'evidence_frozen=' || case when pg_temp.p25_q('select string_agg((c ->> ''operator'') || '':'' || (c ->> ''total''), '','' order by c ->> ''operator'') from public.lyst_round_revisions rv, jsonb_array_elements(rv.counters) c where rv.match_id = ''' || m1 || ''' and rv.round_no = 1') = 'Nathan:6,Odin:6,Taylor:1' then 'PASS' else 'FAIL' end || '; ';

  -- ---------------- the next fight: the phones follow by themselves; the old evidence stays
  select version into ver from public.matches where id = m1;
  perform public.finalize_match(m1, 'a', 3, 1, '{}'::jsonb, ver);
  r := r || 'final_frees_field=' || case when pg_temp.p25_q('select count(*) from public.lyst_field_current where event_id = ''' || ev || ''' and field_key = ''field 1''')::int = 0 then 'PASS' else 'FAIL' end || '; ';
  perform pg_temp.p25_as(null, null); update public.matches set queue_state = 'active' where id = m2; perform pg_temp.p25_as('authenticated', org);
  x := public.lyst_open(m2, 'weighted');
  r := r || 'follow=' || case when pg_temp.p25_q('select count(*) from public.lyst_counter_seats where match_id = ''' || m2 || ''' and status = ''active''')::int = 3
    and pg_temp.p25_q('select count(*) from public.lyst_counter_seats where match_id = ''' || m1 || ''' and status = ''ended''')::int = 3 and pg_temp.p25_q('select count(distinct match_id) from public.lyst_counter_seats where event_id = ''' || ev || ''' and status = ''active''')::int = 1 then 'PASS' else 'FAIL' end || '; ';
  r := r || 'old_tally_kept=' || case when pg_temp.p25_q('select private.lyst_seat_total(''' || seat1 || ''', 1)')::int = 6 then 'PASS' else 'FAIL' end || '; ';
  perform public.lyst_timer_command(ev, 'Field 1', m2, (select rev from public.lyst_timer where event_id = ev and field_key = 'field 1'), gen_random_uuid(), 'start', 'fight', 60000, 1, 0);
  perform pg_temp.p25_as('bos_event_device', s1);
  x := public.counter_state();
  r := r || 'phone_follows_at_zero=' || case when x ->> 'match_id' = m2::text and x ->> 'fighter' = 'P25 Verify Fighter 3' and (x ->> 'my_total')::int = 0 and x -> 'binding' ->> 'side' = 'a' and (x ->> 'can_count')::boolean then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 1); r := r || 'stale_seat_refused=FAIL(allowed); ';
  exception when others then r := r || 'stale_seat_refused=' || sqlstate || '; '; end;
  -- side change, then Lyst change (Field 2 has its own open fight)
  x := public.counter_bind('Field 1', 'b');
  r := r || 'side_change=' || case when x -> 'binding' ->> 'side' = 'b' and x ->> 'fighter' = 'P25 Verify Fighter 4' and x -> 'binding' ->> 'operator' = 'Odin' then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform pg_temp.p25_as('authenticated', org); perform public.lyst_open(m3, 'weighted'); perform pg_temp.p25_as('bos_event_device', s1);
  x := public.counter_bind('Field 2', 'a');
  r := r || 'lyst_change=' || case when x ->> 'match_id' = m3::text and x ->> 'fighter' = 'P25 Verify Fighter 5' then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  begin perform public.counter_bind('Field 7', 'a'); r := r || 'unknown_field=FAIL(allowed); ';
  exception when others then r := r || 'unknown_field=' || sqlstate || '; '; end;

  -- ---------------- staff manage the phones; the owner may too; a stranger may not; nothing impersonates
  perform pg_temp.p25_as('authenticated', org);
  x := public.move_counter_session(s2, 'Field 2', 'b');
  r := r || 'staff_move=' || case when x -> 'binding' ->> 'field_key' = 'field 2' and x -> 'binding' ->> 'side' = 'b' and x -> 'binding' ->> 'operator' = 'Nathan' and x -> 'seat' ->> 'match_id' = m3::text then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  x := public.device_session_preview(s2);
  r := r || 'preview_read_only=' || case when x ->> 'fighter' = 'P25 Verify Fighter 6' and x -> 'binding' ->> 'operator' = 'Nathan' then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  x := public.list_event_device_sessions(ev, false);
  r := r || 'event_sessions_listed=' || case when jsonb_array_length(x) = 3 then 'PASS' else 'FAIL(' || jsonb_array_length(x) || ')' end || '; ';
  x := public.end_event_session(s3, 'phone lost');
  r := r || 'sign_out_one=' || case when x ->> 'status' = 'ended' and pg_temp.p25_q('select count(*) from public.event_sessions where credential_id = ''' || pool || ''' and ended_at is null')::int = 2 then 'PASS' else 'FAIL' end || '; ';
  perform pg_temp.p25_as('bos_event_device', s3);
  begin perform public.counter_state(); r := r || 'ended_session_refused=FAIL(allowed); ';
  exception when others then r := r || 'ended_session_refused=' || sqlstate || '; '; end;
  perform pg_temp.p25_as(null, null); s4 := pg_temp.p25_session(pool);   -- the lost phone's replacement scans the same QR
  perform pg_temp.p25_as('bos_event_device', s4);
  x := public.counter_bind('Field 2', 'b', 'Taylor again');
  r := r || 'rescan_after_signout=' || case when x -> 'seat' ->> 'status' = 'active' and x ->> 'match_id' = m3::text then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform pg_temp.p25_as('authenticated', stranger);
  begin perform public.move_counter_session(s1, 'Field 1', 'a'); r := r || 'stranger_move=FAIL(allowed); ';
  exception when others then r := r || 'stranger_move=' || sqlstate || '; '; end;
  begin perform public.end_event_session(s1, null); r := r || 'stranger_end=FAIL(allowed); ';
  exception when others then r := r || 'stranger_end=' || sqlstate || '; '; end;
  begin perform public.counter_pool_code(ev); r := r || 'stranger_qr=FAIL(allowed); ';
  exception when others then r := r || 'stranger_qr=' || sqlstate || '; '; end;
  begin perform public.device_session_preview(s1); r := r || 'stranger_preview=FAIL(allowed); ';
  exception when others then r := r || 'stranger_preview=' || sqlstate || '; '; end;

  -- ---------------- another event's phone never lands on this event
  perform pg_temp.p25_as('bos_event_device', sb);
  x := public.counter_bind('Field 1', 'a', 'Other');
  r := r || 'other_event_isolated=' || case when x -> 'event' ->> 'id' = evb::text and x ->> 'match_id' is null and pg_temp.p25_q('select count(*) from public.lyst_counter_seats where event_id = ''' || ev || ''' and user_id = ''' || sb || '''')::int = 0 then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 1); r := r || 'other_event_seat=FAIL(allowed); ';
  exception when others then r := r || 'other_event_seat=' || sqlstate || '; '; end;

  -- ---------------- expired and revoked credentials
  perform pg_temp.p25_as(null, null); update public.event_credentials set expires_at = clock_timestamp() - interval '1 hour' where id = poolb;
  perform pg_temp.p25_as('bos_event_device', sb);
  begin perform public.counter_bind('Field 1', 'a'); r := r || 'expired_refused=FAIL(allowed); ';
  exception when others then r := r || 'expired_refused=' || sqlstate || '; '; end;
  perform pg_temp.p25_as(null, null); update public.event_credentials set expires_at = null, revoked_at = clock_timestamp() where id = poolb;
  perform pg_temp.p25_as('bos_event_device', sb);
  begin perform public.counter_state(); r := r || 'revoked_refused=FAIL(allowed); ';
  exception when others then r := r || 'revoked_refused=' || sqlstate || '; '; end;
  -- a legacy per-phone counter code still works, binding itself the same way
  perform pg_temp.p25_as(null, null); s3 := pg_temp.p25_session(legacy); update public.event_sessions set multi = false where id = s3;
  perform pg_temp.p25_as('bos_event_device', s3);
  x := public.counter_bind('Field 1', 'a', 'Legacy phone');
  r := r || 'legacy_counter_code=' || case when x -> 'seat' ->> 'status' = 'active' and x ->> 'match_id' = m2::text then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';

  -- ---------------- training: a signed-in person, the Lyst's training QR, never official
  perform pg_temp.p25_as('authenticated', org);
  x := public.create_lyst_join_code(ev, 'Field 1');
  code := coalesce(x ->> 'code', x -> 0 ->> 'code');
  perform pg_temp.p25_as('authenticated', trainee);
  x := public.join_training_counter(code, 'Trainee Tam', 'a');
  tseat := (x -> 'state' -> 'seat' ->> 'id')::uuid;
  r := r || 'training_join=' || case when x ->> 'status' = 'ok' and x -> 'state' -> 'seat' ->> 'role' = 'learning' and x -> 'state' ->> 'match_id' = m2::text then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  perform public.counter_record(gen_random_uuid(), tseat, 1, 2);
  perform pg_temp.p25_as('authenticated', org);
  x := public.lyst_state(m2);
  r := r || 'training_apart=' || case when (select count(*) from jsonb_array_elements(x -> 'seats') s where s ->> 'role' = 'learning' and s ->> 'name' = 'Trainee Tam') = 1
    and (select count(*) from jsonb_array_elements(x -> 'seats') s where s ->> 'role' = 'official') = 1 then 'PASS' else 'FAIL(' || (x -> 'seats')::text || ')' end || '; ';   -- the one official phone still on Field 1 (the legacy code); the pool phones moved to Field 2
  x := public.join_training_counter('NOPE', 'x', 'a');
  r := r || 'bad_training_code=' || case when x ->> 'status' = 'invalid' then 'PASS' else 'FAIL' end || '; ';

  -- ---------------- a team fight: standing count, bounded, evidence only
  perform pg_temp.p25_as(null, null); update public.matches set queue_state = 'active' where id = mt; update public.matches set queue_state = 'scheduled' where id = m3;
  perform pg_temp.p25_as('authenticated', org);
  x := public.lyst_open(mt, 'standing');
  r := r || 'standing_open=' || (x ->> 'counter_input') || '; ';
  perform public.lyst_timer_command(ev, 'Field 2', mt, (select rev from public.lyst_timer where event_id = ev and field_key = 'field 2'), gen_random_uuid(), 'start', 'fight', 180000, 1, 0);
  perform pg_temp.p25_as('bos_event_device', s4);
  x := public.counter_state();
  r := r || 'standing_5=' || case when x ->> 'counter_input' = 'standing' and (x ->> 'per_side')::int = 5 and (x ->> 'standing')::int = 5 and x ->> 'fighter' = 'P25 Verify Blue Team' then 'PASS' else 'FAIL(' || x::text || ')' end || '; ';
  seat1 := (x -> 'seat' ->> 'id')::uuid;
  for i in 1..5 loop perform public.counter_record(gen_random_uuid(), seat1, 1, 1); end loop;
  x := public.counter_state();
  r := r || 'standing_0=' || case when (x ->> 'standing')::int = 0 then 'PASS' else 'FAIL' end || '; ';
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 1); r := r || 'standing_bounded=FAIL(allowed); ';
  exception when others then r := r || 'standing_bounded=' || sqlstate || '; '; end;
  begin perform public.counter_record(gen_random_uuid(), seat1, 1, 2); r := r || 'standing_weight=FAIL(allowed); ';
  exception when others then r := r || 'standing_weight=' || sqlstate || '; '; end;
  r := r || 'standing_not_a_score=' || case when pg_temp.p25_q('select count(*) from public.lyst_rounds where match_id = ''' || mt || ''' and status = ''confirmed''')::int = 0 and pg_temp.p25_q('select coalesce(result, ''none'') from public.matches where id = ''' || mt || '''') = 'none' then 'PASS' else 'FAIL' end || '; ';

  -- ---------------- the old ceremony is gone; the allow-list holds the new phone functions only for the phone's own role
  r := r || 'old_rpcs_gone=' || case when to_regprocedure('public.request_counter_seat(text)') is null and to_regprocedure('public.assign_counter_seat(uuid,uuid,text,text,text)') is null and to_regprocedure('public.carry_counter_seats(uuid,uuid)') is null then 'PASS' else 'FAIL' end || '; ';
  r := r || 'allow_list=' || case when (select count(*) from information_schema.routine_privileges where grantee = 'bos_event_device' and privilege_type = 'EXECUTE' and specific_schema = 'public' and routine_name in ('counter_bind', 'counter_set_operator', 'counter_leave', 'counter_pool_code')) = 4
    and (select count(*) from information_schema.routine_privileges where grantee = 'bos_event_device' and privilege_type = 'EXECUTE' and routine_name in ('platform_device_sessions', 'join_training_counter', 'device_session_preview')) = 0 then 'PASS' else 'FAIL' end || '; ';
  perform pg_temp.p25_as(null, null);
  r := r || 'audit=' || (select string_agg(a.action || '=' || a.n, ',' order by a.action) from (select action, count(*) n from public.audit_log where event_id = ev and action in ('counter.bound', 'counter.operator', 'counter.moved', 'device.session_ended', 'lyst.counters_followed', 'lyst.field_current', 'lyst.trainee_joined') group by action) a);
  raise exception 'P25VERIFY ROLLED BACK: %', r;
end $v$;
