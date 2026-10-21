-- Counter recovery follow-ups gate (20261023000600). Pack 18.1 fixture (fictional events, people and devices): u1 organizer E1, u3 marshal E1,
-- u4 scorekeeper (secretary) E1, u10 stranger; Counter Phone 1 and 3 count fight m1 on Field 1. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
create table t.k (name text primary key, id uuid);
grant select on t.k to authenticated, bos_event_device;
create function t.x(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a6e' || n, 12, '0'))::uuid $$;
create function t.a(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('ac6' || n, 12, '0'))::uuid $$;
create function t.kid(n text) returns uuid language sql stable as $$ select id from t.k where name = n $$;
create function t.run() returns uuid language sql stable security definer as $$ select id from private.counter_runs where match_id = t.m(1) and round_no = 1 order by generation desc limit 1 $$;
create function t.rcpt(seat uuid) returns jsonb language sql stable security definer as $$
  select to_jsonb(c) from private.counter_receipts c where c.seat_id = seat and c.run_id = t.kid('run1') $$;
create function t.risk() returns boolean language sql stable security definer as $$ select private.counter_confirmation_risks(t.m(1), 1) $$;
create function t.reported(id uuid) returns jsonb language sql stable security definer as $$ select reported from private.counter_action_runs a where a.id = $1 $$;
create function t.n_audit(a text) returns integer language sql stable security definer as $$ select count(*)::int from public.audit_log where action = a $$;
create function t.tap(id uuid, op text, at jsonb default '"2026-11-07T10:00:00Z"'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('id', id, 'kind', 'tap', 'round', 1, 'weight', 1, 'runId', t.kid('run1'), 'operator', op, 'recordedAt', at, 'side', 'a') $$;
create function t.deliver(seat uuid, a jsonb) returns text language sql as $$ select public.counter_deliver_action(seat, t.kid('run1'), a) ->> 'status' $$;
grant execute on function t.x(int), t.a(int), t.kid(text), t.run(), t.rcpt(uuid), t.risk(), t.reported(uuid), t.n_audit(text), t.tap(uuid, text, jsonb), t.deliver(uuid, jsonb)
  to authenticated, bos_event_device;

-- Fight m1 open on Field 1 with two official counter phones; round 1 running (the round trigger creates its run).
insert into public.lyst_matches (match_id, event_id, field_key, counter_input) values (t.m(1), t.ev(1), 'field 1', 'simple');
insert into public.lyst_field_current (event_id, field_key, match_id) values (t.ev(1), 'field 1', t.m(1));
insert into public.lyst_counter_seats (id, event_id, field_key, user_id, display_name, match_id, side, role, status, expires_at) values
  (t.x(1), t.ev(1), 'field 1', t.sid('counter1'), 'Amber', t.m(1), 'a', 'official', 'active', now() + interval '1 hour'),
  (t.x(2), t.ev(1), 'field 1', t.sid('counter3'), 'Cedar', t.m(1), 'b', 'official', 'active', now() + interval '1 hour');
insert into public.lyst_rounds (match_id, round_no, event_id, status) values (t.m(1), 1, t.ev(1), 'running');
insert into t.k values ('run1', t.run());
select t.expect_eq('the round has a running run', (select status from private.counter_runs where id = t.kid('run1')), 'running');

-- ---------------------------------------------------------------- 1. receipts while running
select t.as_device(t.sid('counter1'));
select t.expect_ok('phone 1 records the start of the running run', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), true, 0)$q$);
select t.as_device(t.sid('counter3'));
select t.expect_ok('phone 3 only saved the round (no start)', $q$select public.counter_acknowledge_run(t.x(2), t.kid('run1'), false, 0)$q$);

-- ---------------------------------------------------------------- 2. M2: reported operator and time kept beside the accepted count
select t.as_device(t.sid('counter1'));
select t.expect_eq('a modern tap is accepted', t.deliver(t.x(1), t.tap(t.a(1), 'Amber')), 'ok');
select t.expect_eq('... a lost-ack retry with different claims is a duplicate', t.deliver(t.x(1), t.tap(t.a(1), 'Brook', '"2026-11-07T11:00:00Z"')), 'duplicate');
select t.expect_eq('... and the first report is kept', t.reported(t.a(1)) ->> 'operator', 'Amber');
select t.expect_eq('... with its reported time', t.reported(t.a(1)) ->> 'recordedAt', '2026-11-07T10:00:00Z');
select t.as_admin();
update public.lyst_counter_seats set display_name = 'Brook' where id = t.x(1);   -- operator handoff on the same phone
select t.as_device(t.sid('counter1'));
select t.expect_eq('after the handoff the next tap is accepted', t.deliver(t.x(1), t.tap(t.a(2), 'Brook', '12345'::jsonb)), 'ok');
select t.expect_eq('... it reports the new operator', t.reported(t.a(2)) ->> 'operator', 'Brook');
select t.expect_eq('... a non-text time is dropped and named', t.reported(t.a(2)) -> 'invalid', '["recordedAt"]'::jsonb);
select t.expect_eq('... and no time is invented', t.reported(t.a(2)) ? 'recordedAt', false);
select t.as_admin();
select t.expect_eq('the first official count row still names who held the seat then', (select operator_name from public.lyst_counts where id = t.a(1)), 'Amber');

-- ---------------------------------------------------------------- 3. M3: the direct count functions refuse ids kept as evidence
select t.as_admin();
insert into private.counter_legacy_evidence (id, event_id, seat_id, uploader, operator_name, side, role, field_key, action)
  values (t.a(10), t.ev(1), t.x(1), t.sid('counter1'), 'Amber', 'a', 'official', 'field 1', jsonb_build_object('id', t.a(10), 'kind', 'tap', 'round', 1, 'weight', 1));
insert into private.counter_recovery (id, run_id, seat_id, action, reason, decision, review_reason, reviewed_at)
  values (t.a(11), t.kid('run1'), t.x(1), jsonb_build_object('id', t.a(11), 'kind', 'tap', 'round', 1, 'weight', 1, 'runId', t.kid('run1')), 'Fictional late tap', 'noted', 'Fixture', now());
select t.as_device(t.sid('counter1'));
select t.expect_error('an older app cannot count an id kept with an unknown fight', $q$select public.counter_record(t.a(10), t.x(1), 1, 1)$q$, '42501');
select t.expect_error('... nor undo with it', $q$select public.counter_undo(t.a(10), t.x(1), 1)$q$, '42501');
select t.expect_error('... nor count an id kept as review evidence of a known run', $q$select public.counter_record(t.a(11), t.x(1), 1, 1)$q$, '42501');
select t.expect_error('... nor undo with that one', $q$select public.counter_undo(t.a(11), t.x(1), 1)$q$, '42501');
select t.expect_error('the modern path refuses the unknown-fight id too', $q$select t.deliver(t.x(1), t.tap(t.a(10), 'Brook'))$q$, '42501');
select t.expect_eq('a fresh id still counts directly', public.counter_record(t.a(12), t.x(1), 1, 1) ->> 'status', 'ok');

-- ---------------------------------------------------------------- 4. H2: the round ends; receipts after the end
select t.as_admin();
update public.lyst_rounds set status = 'confirming' where match_id = t.m(1) and round_no = 1;
select t.expect_eq('ending the round closes its run', (select status from private.counter_runs where id = t.kid('run1')), 'closed');
select t.as_device(t.sid('counter3'));
select t.expect_error('a start cannot be recorded on a closed run', $q$select public.counter_acknowledge_run(t.x(2), t.kid('run1'), true, 0)$q$, 'P0001');
select t.expect_ok('the phone can still report it is here', $q$select public.counter_acknowledge_run(t.x(2), t.kid('run1'), false, 0)$q$);
select t.expect_eq('... and its start stays missing', t.rcpt(t.x(2)) ->> 'started_at', null::text);
select t.expect_error('a phone cannot report for another phone''s seat', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), false, 0)$q$, '42501');
select t.as_device(t.sid('counter1'));
select t.expect_ok('phone 1 reports 2 pending after the end', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), false, 2)$q$);
select t.expect_eq('... recorded', (t.rcpt(t.x(1)) ->> 'pending')::int, 2);
select t.expect_eq('Done is accepted while the round is being confirmed', public.counter_submit(t.x(1), 1) ->> 'status', 'ok');
select t.expect_eq('... Done refreshes the receipt: nothing pending', (t.rcpt(t.x(1)) ->> 'pending')::int, 0);
select t.expect_eq('... and keeps the real start', t.rcpt(t.x(1)) ->> 'started_at' is not null, true);
select t.as_device(t.sid('counter3'));
select t.expect_eq('phone 3 presses Done', public.counter_submit(t.x(2), 1) ->> 'status', 'ok');
select t.expect_eq('... Done never records a start', t.rcpt(t.x(2)) ->> 'started_at', null::text);
select t.as_admin();
select t.expect_eq('a phone with no start receipt still needs the marshal''s reason', t.risk(), true);

-- ---------------------------------------------------------------- 5. H2: a healthy phone, confirmed 30 seconds after the end, needs no reason
update public.lyst_counter_seats set status = 'ended' where id = t.x(2);   -- leave only the healthy phone 1
update private.counter_runs set closed_at = clock_timestamp() - interval '30 seconds' where id = t.kid('run1');
update private.counter_receipts set seen_at = (select closed_at from private.counter_runs where id = t.kid('run1')) - interval '2 seconds' where run_id = t.kid('run1') and seat_id = t.x(1);
select t.expect_eq('the phone was last heard 32 s ago (the old rule would warn)', (t.rcpt(t.x(1)) ->> 'seen_at')::timestamptz < clock_timestamp() - interval '20 seconds', true);
select t.expect_eq('healthy: started, nothing pending, Done, heard at the end: no reason needed', t.risk(), false);
update private.counter_receipts set seen_at = (select closed_at from private.counter_runs where id = t.kid('run1')) - interval '25 seconds' where run_id = t.kid('run1') and seat_id = t.x(1);
select t.expect_eq('quiet for 25 s before the end: reason needed', t.risk(), true);
update private.counter_receipts set seen_at = (select closed_at from private.counter_runs where id = t.kid('run1')) - interval '2 seconds' where run_id = t.kid('run1') and seat_id = t.x(1);
update private.counter_receipts set pending = 1 where run_id = t.kid('run1') and seat_id = t.x(1);
select t.expect_eq('counts still pending: reason needed', t.risk(), true);
update private.counter_receipts set pending = 0 where run_id = t.kid('run1') and seat_id = t.x(1);
delete from public.lyst_counter_rounds where seat_id = t.x(1) and match_id = t.m(1) and round_no = 1;
select t.expect_eq('no Done: reason needed', t.risk(), true);
insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values (t.x(1), t.m(1), 1);
update private.counter_receipts set started_at = null where run_id = t.kid('run1') and seat_id = t.x(1);
select t.expect_eq('no start receipt: reason needed', t.risk(), true);
update private.counter_receipts set started_at = clock_timestamp() - interval '2 minutes' where run_id = t.kid('run1') and seat_id = t.x(1);
select t.expect_eq('healthy again', t.risk(), false);
insert into private.counter_recovery (id, run_id, seat_id, action, reason)
  values (t.a(20), t.kid('run1'), t.x(1), jsonb_build_object('id', t.a(20), 'kind', 'tap', 'round', 1, 'weight', 1, 'runId', t.kid('run1')), 'Fictional late tap'),
         (t.a(21), t.kid('run1'), t.x(1), jsonb_build_object('id', t.a(21), 'kind', 'tap', 'round', 1, 'weight', 1, 'runId', t.kid('run1')), 'Fictional late tap');
select t.expect_eq('unreviewed official evidence: reason needed', t.risk(), true);
select t.expect_eq('the delivery view carries the run''s close time', (select (j ->> 'closed_at') is not null from jsonb_array_elements(private.counter_delivery_state(t.m(1))) j where j ->> 'seat_id' = t.x(1)::text), true);

-- ---------------------------------------------------------------- 6. M2: accepted provenance in the event list, role-scoped, no account ids
select t.as_user(t.u(1));
select t.expect_eq('organizer: the two delivered counts are listed as accepted', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'accepted'), 2);
select t.expect_eq('... each with what the phone reported', (select j -> 'reported' ->> 'operator' from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'accepted') j where j ->> 'id' = t.a(1)::text), 'Amber');
select t.expect_eq('... marked unverified', (select bool_and((j ->> 'reported_unverified')::boolean) from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'accepted') j), true);
select t.expect_eq('... beside the server''s own name for the count', (select j ->> 'server_operator' from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'accepted') j where j ->> 'id' = t.a(1)::text), 'Amber');
select t.expect_eq('the direct count (no delivery record) is not listed', (select count(*)::int from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'accepted') j where j ->> 'id' = t.a(12)::text), 0);
select t.expect_eq('no device session or account id is returned', position(t.sid('counter1')::text in public.event_counter_evidence(t.ev(1))::text), 0);
select t.expect_eq('one page: no next offset', public.event_counter_evidence(t.ev(1)) -> 'next_offset', 'null'::jsonb);
select t.as_user(t.u(4));
select t.expect_eq('secretary: the fight on the Lyst now is on the board, so it is listed', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'accepted'), 2);
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot read it', $q$select public.event_counter_evidence(t.ev(1))$q$, '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot read it', $q$select public.event_counter_evidence(t.ev(1))$q$, '42501');

-- ---------------------------------------------------------------- 7. L2: identical review retries succeed once; a different review is refused
select t.as_user(t.u(1));
select t.expect_ok('the organizer reviews late evidence', $q$select public.review_counter_recovery(t.a(20), 'noted', 'Checked the paper sheet')$q$);
select t.expect_ok('... the identical retry succeeds', $q$select public.review_counter_recovery(t.a(20), 'noted', 'Checked the paper sheet')$q$);
select t.expect_ok('... so does one differing only in spaces', $q$select public.review_counter_recovery(t.a(20), 'noted', '  Checked the paper sheet ')$q$);
select t.expect_eq('... audited once', t.n_audit('counter.evidence_reviewed'), 1);
select t.expect_error('a different reason is refused', $q$select public.review_counter_recovery(t.a(20), 'noted', 'Something else')$q$, 'P0001');
select t.expect_error('a different decision is refused', $q$select public.review_counter_recovery(t.a(20), 'dismissed', 'Checked the paper sheet')$q$, 'P0001');
select t.expect_ok('a batch retry with one new item succeeds', $q$select public.review_counter_recovery_batch(array[t.a(20), t.a(21)], 'noted', 'Checked the paper sheet')$q$);
select t.expect_eq('... only the new item is audited', t.n_audit('counter.evidence_reviewed'), 2);
select t.expect_error('a batch with a conflicting item changes nothing', $q$select public.review_counter_recovery_batch(array[t.a(20), t.a(21)], 'dismissed', 'Checked the paper sheet')$q$, 'P0001');
select t.as_admin();
select t.expect_eq('reviewed: no reason needed for the healthy phone', t.risk(), false);
select t.as_user(t.u(1));
select t.expect_eq('legacy review', public.review_legacy_counter_evidence(array[t.a(10)], 'dismissed', 'Older phone, checked with the marshal'), 1);
select t.expect_eq('... the identical retry succeeds with nothing new', public.review_legacy_counter_evidence(array[t.a(10)], 'dismissed', 'Older phone, checked with the marshal'), 0);
select t.expect_eq('... audited once', t.n_audit('counter.legacy_evidence_reviewed'), 1);
select t.expect_error('... a different decision is refused', $q$select public.review_legacy_counter_evidence(array[t.a(10)], 'noted', 'Older phone, checked with the marshal')$q$, 'P0001');

-- ---------------------------------------------------------------- 8. an old run cannot be acknowledged after a recount
select t.as_admin();
update public.lyst_rounds set status = 'running' where match_id = t.m(1) and round_no = 1;   -- returned to the counters: a new run
select t.expect_eq('the return made a new run', t.run() is distinct from t.kid('run1'), true);
select t.as_device(t.sid('counter1'));
select t.expect_error('the old run cannot be acknowledged', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), false, 0)$q$, 'P0001');
select t.expect_error('... nor started', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), true, 0)$q$, 'P0001');
select t.as_admin();
update public.lyst_rounds set status = 'confirming' where match_id = t.m(1) and round_no = 1;
select t.as_device(t.sid('counter1'));
select t.expect_error('... nor reported on once the new run has ended either', $q$select public.counter_acknowledge_run(t.x(1), t.kid('run1'), false, 0)$q$, 'P0001');

select t.as_admin();
select count(*) as checks_passed from t.log;
do $$ begin raise notice 'COUNTER RECOVERY FOLLOWUPS GATE PASSED'; end $$;
rollback;
