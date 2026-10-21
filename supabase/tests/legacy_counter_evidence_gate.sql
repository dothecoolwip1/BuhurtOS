-- Legacy counter evidence gate (20261023000500): counter_upload_legacy_action, event_counter_evidence, review_legacy_counter_evidence.
-- Pack 18.1 fixture (fictional people, events and devices): u1 organizer E1, u2 head marshal E1, u3 marshal E1, u4 scorekeeper (secretary) E1,
-- u9 an account that held a training seat, u10 stranger, u11 organizer E2. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
create function t.x(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a5e' || n, 12, '0'))::uuid $$;
create function t.a(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('ac7' || n, 12, '0'))::uuid $$;
create function t.tap(id uuid, r int default 1, w int default 1) returns jsonb language sql immutable as $$ select jsonb_build_object('id', id, 'kind', 'tap', 'round', r, 'weight', w) $$;
create function t.up(seat uuid, a jsonb) returns text language sql as $$ select public.counter_upload_legacy_action(seat, a) ->> 'status' $$;
create function t.n_legacy() returns integer language sql stable security definer as $$ select count(*)::int from private.counter_legacy_evidence $$;
create function t.n_audit(a text) returns integer language sql stable security definer as $$ select count(*)::int from public.audit_log where action = a $$;
-- everything that could carry an official or provisional score for event 1
create function t.score_fingerprint() returns text language sql stable security definer as $$
  select md5(coalesce((select string_agg(m.id::text || ':' || m.queue_state || ':' || coalesce(m.result::text, '-'), ',' order by m.id) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = t.ev(1)), '')
    || (select count(*)::text from public.lyst_counts) || (select count(*)::text from public.lyst_rounds) || (select count(*)::text from public.results))
$$;
grant execute on function t.x(int), t.a(int), t.tap(uuid, int, int), t.up(uuid, jsonb), t.n_legacy(), t.n_audit(text), t.score_fingerprint() to authenticated, bos_event_device;

-- seats: a training account's ENDED seat (carried away from m1); counter phones 1 and 2 on Field 1; an (abnormal) seat held by the secretary device;
-- an event 2 counter. A fight that is already official (m7) has modern late evidence from counter phone 1.
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field)
  values (t.m(7), t.comp(1), 'round_robin', 'Round 2', 9, t.en(5), t.en(6), 'final', 'Field 2');
insert into public.lyst_counter_seats (id, event_id, field_key, user_id, display_name, match_id, side, role, status, expires_at) values
  (t.x(1), t.ev(1), 'field 1', t.u(9), 'Trainee Pat', t.m(1), 'a', 'learning', 'ended', now() - interval '1 hour'),
  (t.x(2), t.ev(1), 'field 1', t.sid('counter1'), 'Counter Phone 1', t.m(2), 'b', 'official', 'active', now() + interval '1 hour'),
  (t.x(3), t.ev(1), 'field 1', t.sid('counter2'), 'Counter Phone 2', t.m(2), 'a', 'official', 'active', now() + interval '1 hour'),
  (t.x(4), t.ev(1), 'field 2', t.sid('secretary'), 'Secretary Tablet', t.m(3), 'a', 'official', 'active', now() + interval '1 hour'),
  (t.x(5), t.ev(2), 'field 1', t.sid('e2counter'), 'E2 Counter', t.m(4), 'a', 'official', 'active', now() + interval '1 hour'),
  (t.x(6), t.ev(1), 'field 2', t.sid('counter3'), 'Counter Phone 3', t.m(3), 'b', 'official', 'active', now() + interval '1 hour');
insert into private.counter_runs (id, match_id, round_no, status) values (t.x(90), t.m(7), 1, 'closed');
insert into private.counter_recovery (id, run_id, seat_id, action, reason) values
  (t.a(30), t.x(90), t.x(2), jsonb_build_object('id', t.a(30), 'kind', 'tap', 'round', 1, 'weight', 1, 'runId', t.x(90)), 'The saved run was not running when these counts arrived.');
insert into public.lyst_counts (id, seat_id, match_id, round_no, weight) values (t.a(20), t.x(2), t.m(2), 1, 1);
create table t.fp as select t.score_fingerprint() as v;
grant select on t.fp to authenticated, bos_event_device;

-- ---------------------------------------------------------------- 1. upload: own seat only, ended/carried seat included
select t.as_user(t.u(9));
select t.expect_eq('the holder of an ended (carried) seat can still upload its saved action', t.up(t.x(1), t.tap(t.a(1))), 'retained');
select t.expect_eq('a retry with the same id and payload is a duplicate, not a second row', t.up(t.x(1), t.tap(t.a(1))), 'duplicate');
select t.expect_eq('... one row kept', t.n_legacy(), 1);
select t.expect_error('the same id with a different payload is refused', $q$select t.up(t.x(1), t.tap(t.a(1), 1, 2))$q$, '42501');
select t.expect_error('the same id on another round is refused', $q$select t.up(t.x(1), t.tap(t.a(1), 2, 1))$q$, '42501');
select t.expect_error('a seat this account never held is refused', $q$select t.up(t.x(2), t.tap(t.a(2)))$q$, '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot upload to someone else''s seat', $q$select t.up(t.x(1), t.tap(t.a(3)))$q$, '42501');
select t.as_user(t.u(1));
select t.expect_error('nor can the organizer (it is the phone''s evidence, not theirs)', $q$select t.up(t.x(1), t.tap(t.a(3)))$q$, '42501');
select t.as_anon();
select t.expect_error('signed out: no upload', $q$select t.up(t.x(1), t.tap(t.a(3)))$q$);

-- ---------------------------------------------------------------- 2. devices: own seat, alive session, counter role, own event
select t.as_device(t.sid('counter1'));
select t.expect_eq('a counter phone uploads its own seat''s action', t.up(t.x(2), t.tap(t.a(4))), 'retained');
select t.expect_error('... not another phone''s seat', $q$select t.up(t.x(3), t.tap(t.a(5)))$q$, '42501');
select t.expect_eq('an action already counted is acknowledged, not replayed', t.up(t.x(2), t.tap(t.a(20))), 'already_accepted');
select t.expect_error('an already counted id with a different weight is refused', $q$select t.up(t.x(2), t.tap(t.a(20), 1, 2))$q$, '42501');
select t.expect_eq('modern retained evidence is acknowledged as already retained', t.up(t.x(2), t.tap(t.a(30))), 'already_retained');
select t.expect_eq('neither acknowledgement adds legacy evidence', t.n_legacy(), 2);select t.as_device(t.sid('counter3'));
select t.expect_error('a phone cannot reuse another seat''s counted id on its own seat', $q$select t.up(t.x(6), t.tap(t.a(20)))$q$, '42501');
select t.expect_error('... nor another seat''s legacy id', $q$select t.up(t.x(6), t.tap(t.a(4)))$q$, '42501');
select t.as_device(t.sid('e2counter'));
select t.expect_eq('another event''s phone uploads to its own seat', t.up(t.x(5), t.tap(t.a(10))), 'retained');
select t.expect_error('... but not to a seat of event 1', $q$select t.up(t.x(2), t.tap(t.a(11)))$q$, '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('a non-counter device cannot upload counter evidence, even for a seat it holds', $q$select t.up(t.x(4), t.tap(t.a(6)))$q$, '42501');
select t.as_admin();
update public.event_credentials set revoked_at = now(), revoked_reason = 'gate' where id = t.cred('counter2');
select t.as_device(t.sid('counter2'));
select t.expect_error('a withdrawn code cannot upload (the phone keeps its local copy)', $q$select t.up(t.x(3), t.tap(t.a(7)))$q$, '42501');

-- ---------------------------------------------------------------- 3. validation
select t.as_device(t.sid('counter1'));
select t.expect_error('an action with a run id goes through the normal path', $q$select t.up(t.x(2), t.tap(t.a(8)) || jsonb_build_object('runId', t.x(90)))$q$, '22023');
select t.expect_error('unknown fields are refused', $q$select t.up(t.x(2), t.tap(t.a(8)) || '{"note":"x"}'::jsonb)$q$, '22023');
select t.expect_error('round 21 is refused', $q$select t.up(t.x(2), t.tap(t.a(8), 21, 1))$q$, '22023');
select t.expect_error('weight 3 is refused', $q$select t.up(t.x(2), t.tap(t.a(8), 1, 3))$q$, '22023');
select t.expect_error('a non-uuid id is refused', $q$select t.up(t.x(2), '{"id":"x","kind":"tap","round":1,"weight":1}'::jsonb)$q$, '22023');
select t.expect_error('an oversized action is refused', $q$select t.up(t.x(2), t.tap(t.a(8)) || jsonb_build_object('recordedAt', repeat('x', 3000)))$q$, '22023');
select t.expect_eq('a claimed fight id is kept as part of the payload only', t.up(t.x(2), jsonb_build_object('id', t.a(9), 'kind', 'undo', 'round', 1, 'matchId', t.m(3)::text, 'recovery', true)), 'retained');

-- ---------------------------------------------------------------- 4. who reads what
select t.as_user(t.u(1));
select t.expect_eq('organizer: all legacy evidence of the event', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'legacy'), 3);
select t.expect_eq('organizer: the late evidence on the official fight', (public.event_counter_evidence(t.ev(1)) -> 'modern' -> 0 -> 'fight' ->> 'official')::boolean, true);
select t.expect_eq('legacy fight is unknown, never attached', (select bool_and((j ->> 'fight_unknown')::boolean and j -> 'fight' = 'null'::jsonb) from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'legacy') j), true);
select t.expect_eq('the carried seat''s fight is a labelled hint only', (select j -> 'seat_fight_hint' ->> 'match_id' from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'legacy') j where j ->> 'id' = t.a(1)::text), t.m(1)::text);
select t.expect_eq('the training seat is marked learning', (select j ->> 'role' from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'legacy') j where j ->> 'id' = t.a(1)::text), 'learning');
select t.expect_eq('no account id is returned', position(t.u(9)::text in public.event_counter_evidence(t.ev(1))::text), 0);
select t.as_user(t.u(2));
select t.expect_eq('head marshal: modern evidence, including the official fight', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'modern'), 1);
select t.expect_eq('head marshal: no legacy evidence (no fight authority)', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'legacy'), 0);
select t.as_user(t.u(3));
select t.expect_eq('marshal: modern evidence of fights they may score', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'modern'), 1);
select t.expect_eq('marshal: no legacy evidence', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'legacy'), 0);
select t.as_user(t.u(4));
select t.expect_eq('secretary: not the official fight (off the board)', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'modern'), 0);
select t.expect_eq('secretary: no legacy evidence', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'legacy'), 0);
select t.as_device(t.sid('secretary'));
select t.expect_eq('secretary device: same as the secretary', jsonb_array_length(public.event_counter_evidence(t.ev(1)) -> 'modern'), 0);
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot read it', $q$select public.event_counter_evidence(t.ev(1))$q$, '42501');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot read it', $q$select public.event_counter_evidence(t.ev(1))$q$, '42501');
select t.as_device(t.sid('counter1'));
select t.expect_error('a counter phone cannot read the event list', $q$select public.event_counter_evidence(t.ev(1))$q$, '42501');
select t.as_anon();
select t.expect_error('signed out: no read', $q$select public.event_counter_evidence(t.ev(1))$q$);

-- ---------------------------------------------------------------- 5. review: organizer only, reasoned, audited, no score change
select t.as_user(t.u(2));
select t.expect_error('the head marshal cannot review evidence with no known fight', $q$select public.review_legacy_counter_evidence(array[t.a(1)], 'noted', 'Checked the paper sheet')$q$, '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot review it', $q$select public.review_legacy_counter_evidence(array[t.a(1)], 'noted', 'Checked the paper sheet')$q$, '42501');
select t.as_user(t.u(1));
select t.expect_error('a reason is required', $q$select public.review_legacy_counter_evidence(array[t.a(1)], 'noted', 'ok')$q$, '22023');
select t.expect_error('only noted or dismissed', $q$select public.review_legacy_counter_evidence(array[t.a(1)], 'awarded', 'Checked the paper sheet')$q$, '22023');
select t.expect_error('an unknown id is refused and nothing is reviewed', $q$select public.review_legacy_counter_evidence(array[t.a(1), t.a(99)], 'noted', 'Checked the paper sheet')$q$, 'P0002');
select t.expect_eq('the organizer reviews a batch', public.review_legacy_counter_evidence(array[t.a(1), t.a(4)], 'noted', 'Checked the paper sheet with the marshal'), 2);
select t.expect_error('a reviewed item cannot be reviewed again', $q$select public.review_legacy_counter_evidence(array[t.a(1)], 'dismissed', 'Second look')$q$, 'P0001');
select t.expect_eq('the review is shown with its reason', (select j ->> 'review_reason' from jsonb_array_elements(public.event_counter_evidence(t.ev(1)) -> 'legacy') j where j ->> 'id' = t.a(4)::text), 'Checked the paper sheet with the marshal');
select t.expect_eq('every review is audited', t.n_audit('counter.legacy_evidence_reviewed'), 2);
select t.expect_eq('every retained upload was audited (event 2''s included)', t.n_audit('counter.legacy_evidence_retained'), 4);
select t.expect_eq('no official result, round or tally changed', t.score_fingerprint(), (select v from t.fp));

select t.as_admin();
select count(*) as checks_passed from t.log;
do $$ begin raise notice 'LEGACY COUNTER EVIDENCE GATE PASSED'; end $$;
rollback;
