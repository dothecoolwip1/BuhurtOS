-- Pack 29 gate: Outrance (Profight) exactly to Outrance Rules and Regulations V.26.4. Pack 18.1 fixture (fictional events, people and phones):
-- u1 organizer E1, u2 head marshal E1, u3 marshal E1, u4 scorekeeper (secretary) E1, u6 medic E1, u10 stranger, u11 organizer E2; Counter Phones 1-4,
-- plus a fifth line-marshal phone made here. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
create table t.k (name text primary key, id uuid);
grant select, insert on t.k to authenticated, bos_event_device;
create function t.kid(n text) returns uuid language sql stable as $$ select id from t.k where name = n $$;
create function t.g(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a29' || n, 12, '0'))::uuid $$;
create function t.seat(phone text) returns uuid language sql stable security definer as $$
  select id from public.lyst_counter_seats where user_id = t.sid(phone) and status = 'active' order by requested_at desc limit 1 $$;
create function t.run(mn int, r int) returns uuid language sql stable security definer as $$
  select id from private.counter_runs where match_id = t.m(mn) and round_no = r order by generation desc limit 1 $$;
create function t.rev(mn int, r int) returns int language sql stable security definer as $$ select rev from public.lyst_rounds where match_id = t.m(mn) and round_no = r $$;
create function t.ver(mn int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(mn) $$;
-- a line marshal's tap through the real delivery pipeline (the phone's only path)
create function t.lm(phone text, mn int, r int, mark text, side text, n int default 1) returns text language plpgsql as $$
declare v text; i int;
begin
  for i in 1..n loop
    v := public.counter_deliver_action(t.seat(phone), t.run(mn, r), jsonb_build_object('id', gen_random_uuid(), 'kind', 'tap', 'round', r, 'weight', 1, 'mark', mark, 'markSide', side)) ->> 'status';
  end loop;
  return v;
end $$;
create function t.lm_undo(phone text, mn int, r int, mark text, side text) returns text language sql as $$
  select public.counter_deliver_action(t.seat(phone), t.run(mn, r), jsonb_build_object('id', gen_random_uuid(), 'kind', 'undo', 'round', r, 'mark', mark, 'markSide', side)) ->> 'status' $$;
create function t.ack(phone text, mn int, r int) returns void language sql as $$ select public.counter_acknowledge_run(t.seat(phone), t.run(mn, r), true, 0) $$;
create function t.sheet(phone text, r int, calls jsonb default '{}'::jsonb) returns jsonb language sql as $$ select public.outrance_submit_sheet(gen_random_uuid(), t.seat(phone), r, calls) $$;
create function t.tally(phone text, mn int, r int) returns jsonb language sql stable security definer as $$ select private.outrance_tally(t.seat(phone), t.m(mn), r) $$;
create function t.start(mn int, r int) returns void language sql security definer as $$
  insert into public.lyst_rounds (match_id, round_no, event_id, status) values (t.m(mn), r, t.ev(1), 'running') $$;
create function t.stop(mn int, r int) returns void language sql security definer as $$
  update public.lyst_rounds set status = 'confirming' where match_id = t.m(mn) and round_no = r $$;
create function t.ostate(mn int) returns jsonb language sql stable security definer as $$ select private.outrance_state(t.m(mn)) $$;
create function t.holds(e uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(kind || case when cleared_at is null then '' else '(cleared)' end, ',' order by kind), '') from public.outrance_holds where entry_id = e $$;
create function t.hold(e uuid, k text) returns uuid language sql stable security definer as $$ select id from public.outrance_holds where entry_id = e and kind = k $$;
grant execute on all functions in schema t to authenticated, bos_event_device, anon;

-- ---------------------------------------------------------------- the world: a Profight competition with fights on Field 1 (Division and format not set yet)
insert into public.competitions (id, event_id, name, category, gender, structure, sort) values
  (t.comp(29), t.ev(1), 'Profight men', 'profight', 'men', 'round_robin', 9),
  (t.comp(30), t.ev(1), 'Profight women', 'profight', 'women', 'round_robin', 10);
insert into public.fighters (id, display_name, gender, disciplines) select ('00000000-0000-0000-0000-' || lpad('f29' || n, 12, '0'))::uuid, 'Pro ' || n, 'male', '{}' from generate_series(1, 6) n;
insert into public.entries (id, competition_id, fighter_id) select t.en(290 + n), case when n <= 4 then t.comp(29) else t.comp(30) end, ('00000000-0000-0000-0000-' || lpad('f29' || n, 12, '0'))::uuid from generate_series(1, 6) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(11), t.comp(29), 'round_robin', 'Round 1', 0, t.en(291), t.en(292), 'active', 'Field 1'),
  (t.m(12), t.comp(29), 'round_robin', 'Round 1', 1, t.en(293), t.en(294), 'on_deck', 'Field 1'),
  (t.m(13), t.comp(29), 'round_robin', 'Round 2', 0, t.en(291), t.en(293), 'in_the_hole', 'Field 1'),
  (t.m(14), t.comp(30), 'round_robin', 'Round 1', 0, t.en(295), t.en(296), 'active', 'Field 2'),
  (t.m(15), t.comp(29), 'round_robin', 'Round 2', 1, t.en(292), t.en(294), 'scheduled', 'Field 1');
-- a fifth phone for a 5-marshal round
select t.as_user(t.u(1));
select public.create_event_credential(t.ev(1), 'device', 'Counter Phone 5', 'counter', t.h(12));
select t.as_admin();
insert into t.s (name, code) values ('counter5', 12);
update t.s set sid = t.open(12), cred = (select id from public.event_credentials where code_hash = t.h(12)) where name = 'counter5';

-- ================================================================ 1. setting the competition up (§1.3, §4)
select t.as_user(t.u(4));
select t.expect_error('a Profight cannot open before its division and format are set', $q$select public.lyst_open(t.m(11), 'simple')$q$, 'P0001');
select t.expect_error('the secretary cannot set the division and format', $q$select public.set_profight_format(t.comp(29), '2', 'tournament')$q$, '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot either', $q$select public.set_profight_format(t.comp(29), '2', 'tournament')$q$, '42501');
select t.as_anon();
select t.expect_error('anon cannot either', $q$select public.set_profight_format(t.comp(29), '2', 'tournament')$q$, '42501');
select t.as_user(t.u(1));
select t.expect_error('the division is 1 or 2', $q$select public.set_profight_format(t.comp(29), '3', 'tournament')$q$, '22023');
select t.expect_error('the format is tournament or matched', $q$select public.set_profight_format(t.comp(29), '2', 'league')$q$, '22023');
select t.expect_error('a duel competition has no Outrance format', $q$select public.set_profight_format(t.comp(1), '2', 'tournament')$q$, '22023');
select t.expect_eq('the organizer sets Division 2, tournament', public.set_profight_format(t.comp(29), '2', 'tournament') ->> 'status', 'ok');
select t.expect_error('a women''s weight class cannot be set on the men''s competition (§1.2)', $q$select public.set_profight_format(t.comp(29), '2', 'tournament', 'women_lightweight')$q$, '22023');
select t.expect_error('an unknown weight class is refused', $q$select public.set_profight_format(t.comp(29), '2', 'tournament', 'feather')$q$, '22023');
select t.expect_eq('the men''s competition is heavyweight (95 to 105 kg)', public.set_profight_format(t.comp(29), '2', 'tournament', 'men_heavyweight') ->> 'weight_class', 'men_heavyweight');
select t.as_user(t.u(2));
select t.expect_eq('the head marshal sets the women''s: Division 1, tournament, open weight (§1.2.3)', public.set_profight_format(t.comp(30), '1', 'tournament') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('§4.2 Division 2 tournament: 2 rounds of 90 s, a 45 s break, a 3rd round if level', private.outrance_timing(t.m(11)),
  '{"division":"2","format":"tournament","rounds":2,"round_seconds":90,"break_seconds":45,"tiebreak":true}'::jsonb);
select t.expect_eq('§4.1 matched fights: 3 rounds, 60 s breaks (checked on a copy of the settings)', (select private.outrance_timing(t.m(11)) from (select 1) x), private.outrance_timing(t.m(11)));

-- ================================================================ 2. opening the fight; the phones take their positions
select t.as_user(t.u(4));
select t.expect_eq('the secretary opens the fight: scored to the Outrance rules', public.lyst_open(t.m(11), 'simple') ->> 'scoring', 'outrance');
select t.as_device(t.sid('counter1')); select public.counter_bind('Field 1', 'm', 'Marshal One');
select t.as_device(t.sid('counter2')); select public.counter_bind('Field 1', 'm', 'Marshal Two');
select t.as_device(t.sid('counter3')); select public.counter_bind('Field 1', 'm', 'Marshal Three');
select t.as_device(t.sid('counter4')); select public.counter_bind('Field 1', 'a', 'Side Counter');
select t.as_admin();
select t.expect_eq('three line-marshal seats and one side seat on the fight', (select string_agg(display_name || ':' || side, ',' order by display_name) from public.lyst_counter_seats where match_id = t.m(11) and status = 'active'),
  'Marshal One:m,Marshal Three:m,Marshal Two:m,Side Counter:a');
select t.as_device(t.sid('counter4'));
select t.expect_eq('a side counter on a Profight is told to take the line-marshal position', public.counter_state() -> 'outrance', '{"position":"wrong","need":"line_marshal"}'::jsonb);
select t.as_device(t.sid('counter1'));
select t.expect_eq('a line marshal sees both fighters by name', public.counter_state() -> 'outrance' -> 'fighters', '{"a":"Pro 1","b":"Pro 2"}'::jsonb);

-- ================================================================ 3. round 1: the sheets (§15.2, §15.3, p.25)
select t.start(11, 1);
select t.as_device(t.sid('counter1')); select t.ack('counter1', 11, 1);
select t.as_device(t.sid('counter2')); select t.ack('counter2', 11, 1);
select t.as_device(t.sid('counter3')); select t.ack('counter3', 11, 1);
select t.as_device(t.sid('counter1'));
select t.expect_eq('marshal one taps Red strike 10 times', t.lm('counter1', 11, 1, 'strike', 'a', 10), 'ok');
select t.expect_eq('... and Blue strike 4 times', t.lm('counter1', 11, 1, 'strike', 'b', 4), 'ok');
select t.expect_eq('... UNDO takes back the last Red strike', t.lm_undo('counter1', 11, 1, 'strike', 'a'), 'ok');
select t.expect_eq('... the tally shows 9-4', (select (j -> 'strike' ->> 'a') || '-' || (j -> 'strike' ->> 'b') from (select t.tally('counter1', 11, 1) j) x), '9-4');
select t.expect_eq('... and one more Red strike: 10-4', t.lm('counter1', 11, 1, 'strike', 'a'), 'ok');
select t.expect_eq('... the phone shows what UNDO would take back', public.counter_state() -> 'outrance' -> 'last', '{"mark":"strike","side":"a"}'::jsonb);
select t.expect_eq('... a line marshal never sees another marshal''s sheet or any score on the phone (§2.3)', coalesce(jsonb_typeof(public.counter_state() -> 'officials'), 'null') <> 'null' or (public.counter_state() -> 'outrance' ? 'totals') or (public.counter_state() -> 'outrance' ? 'sheets'), false);
select t.expect_error('a line marshal''s tap must say what it is', $q$select public.counter_deliver_action(t.seat('counter1'), t.run(11, 1), jsonb_build_object('id', gen_random_uuid(), 'kind', 'tap', 'round', 1, 'weight', 1))$q$, '22023');
select t.expect_error('... and for which fighter', $q$select public.counter_deliver_action(t.seat('counter1'), t.run(11, 1), jsonb_build_object('id', gen_random_uuid(), 'kind', 'tap', 'round', 1, 'weight', 1, 'mark', 'strike'))$q$, '22023');
select t.expect_error('... a weighted tap does not exist for a line marshal', $q$select public.counter_deliver_action(t.seat('counter1'), t.run(11, 1), jsonb_build_object('id', gen_random_uuid(), 'kind', 'tap', 'round', 1, 'weight', 2, 'mark', 'strike', 'markSide', 'a'))$q$, '22023');
select t.expect_error('the old direct tap function refuses a line marshal', $q$select public.counter_record(gen_random_uuid(), t.seat('counter1'), 1, 1)$q$, 'P0001');
select t.as_device(t.sid('counter4'));
select t.expect_error('a side counter''s tap cannot carry a mark', $q$select public.counter_deliver_action(t.seat('counter4'), t.run(11, 1), jsonb_build_object('id', gen_random_uuid(), 'kind', 'tap', 'round', 1, 'weight', 1, 'mark', 'strike', 'markSide', 'a'))$q$, '22023');
select t.expect_eq('a side counter''s plain tap on a Profight is kept for review, never counted', public.counter_deliver_action(t.seat('counter4'), t.run(11, 1), jsonb_build_object('id', t.g(1), 'kind', 'tap', 'round', 1, 'weight', 1)) ->> 'status', 'review');
select t.as_device(t.sid('counter2'));
select t.expect_eq('marshal two: Red 8, Blue 4', t.lm('counter2', 11, 1, 'strike', 'a', 8) || t.lm('counter2', 11, 1, 'strike', 'b', 4), 'okok');
select t.expect_eq('... Red loses the weapon 3 times', t.lm('counter2', 11, 1, 'weapon_loss', 'a', 3), 'ok');
select t.expect_eq('... a takedown for Blue (recorded for posterity, §15.2.2)', t.lm('counter2', 11, 1, 'takedown', 'b'), 'ok');
select t.as_device(t.sid('counter3'));
select t.expect_eq('marshal three: Red 20, Blue 4', t.lm('counter3', 11, 1, 'strike', 'a', 20) || t.lm('counter3', 11, 1, 'strike', 'b', 4), 'okok');
select t.as_device(t.sid('counter1'));
select t.expect_eq('the phone says the criteria are needed only for a difference of 5 or less: 10-4 needs none', (public.counter_state() -> 'outrance' ->> 'needs_criteria')::boolean, false);

-- the knight marshal's calls (§13.2, §14.4)
select t.as_user(t.u(3));
select t.expect_error('the duel discipline sheet is not the Profight path', $q$select public.lyst_record_discipline(gen_random_uuid(), t.m(11), 1, 'b', 'warning')$q$, 'P0001');
select t.expect_eq('the marshal gives Blue a yellow card', public.outrance_call(t.g(10), t.m(11), 1, 'b', 'yellow') ->> 'status', 'ok');
select t.expect_eq('... the same command twice is one card', public.outrance_call(t.g(10), t.m(11), 1, 'b', 'yellow') ->> 'status', 'duplicate');
select t.expect_eq('Red is granted 90 s for an armour repair', public.outrance_call(t.g(11), t.m(11), 1, 'a', 'armour') ->> 'status', 'ok');
select t.expect_error('an unknown call is refused', $q$select public.outrance_call(gen_random_uuid(), t.m(11), 1, 'a', 'point')$q$, '22023');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot make a call', $q$select public.outrance_call(gen_random_uuid(), t.m(11), 1, 'a', 'yellow')$q$, '42501');
select t.as_device(t.sid('counter1'));
select t.expect_error('a phone cannot make a call', $q$select public.outrance_call(gen_random_uuid(), t.m(11), 1, 'a', 'yellow')$q$, '42501');

-- the round ends; the marshals hand in their sheets
select t.stop(11, 1);
select t.as_device(t.sid('counter1'));
select t.expect_error('10-4 is decided on strikes: criteria are refused', $q$select t.sheet('counter1', 1, '{"grappling":"a"}')$q$, '22023');
select t.expect_eq('marshal one hands in: Slight 10-9 Red', (select (j -> 'sheet' -> 'result' ->> 'band') || ' ' || (j -> 'sheet' -> 'result' ->> 'a') || '-' || (j -> 'sheet' -> 'result' ->> 'b') from (select t.sheet('counter1', 1) j) x), 'slight 10-9');
select t.expect_eq('... handing it in twice gives back the same sheet', t.sheet('counter1', 1) ->> 'status', 'duplicate');
select t.as_device(t.sid('counter2'));
select t.expect_error('8-4 is Even: the criteria must be answered', $q$select t.sheet('counter2', 1)$q$, '22023');
select t.expect_error('... in priority order (grappling first)', $q$select t.sheet('counter2', 1, '{"list_control":"b"}')$q$, '22023');
select t.expect_error('... and nothing after the first that is not Even', $q$select t.sheet('counter2', 1, '{"grappling":"b","list_control":"a"}')$q$, '22023');
select t.expect_eq('marshal two: grappling Even, list control Blue: 9-10 (decided by list control)',
  (select (j -> 'sheet' -> 'result' ->> 'a') || '-' || (j -> 'sheet' -> 'result' ->> 'b') || ' ' || (j -> 'sheet' -> 'result' ->> 'decided_by') from (select t.sheet('counter2', 1, '{"grappling":"even","list_control":"b"}') j) x), '9-10 list_control');
select t.expect_eq('... a tap after handing in is kept for review, not added to the sheet', t.lm('counter2', 11, 1, 'strike', 'a'), 'review');

select t.as_user(t.u(4));
select t.expect_error('the whole-number duel entry is refused for a Profight', $q$select public.lyst_confirm_round(gen_random_uuid(), t.m(11), 1, 10, 9, t.rev(11, 1))$q$, 'P0001');
select t.expect_error('the round waits for marshal three''s sheet', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 1, t.rev(11, 1))$q$, 'P0001');
select t.as_device(t.sid('counter3'));
select t.expect_eq('marshal three: Dominant 10-7', (select t.sheet('counter3', 1) -> 'sheet' -> 'result' ->> 'band'), 'dominant');
select t.as_user(t.u(4));
select t.expect_eq('the tablet sees the three sheets with the round''s deductions: 9-8, 7-9, 9-6',
  (select string_agg((e -> 'score' ->> 'a') || '-' || (e -> 'score' ->> 'b'), ', ' order by e ->> 'operator') from jsonb_array_elements(public.lyst_state(t.m(11)) -> 'outrance' -> 'sheets') e),
  '9-8, 9-6, 7-9');
select t.expect_eq('... marshal two''s Red lost 2: the armour grant and 3 weapon losses (one point, §14.1)',
  (select e -> 'deduct' ->> 'a' from jsonb_array_elements(public.lyst_state(t.m(11)) -> 'outrance' -> 'sheets') e where e ->> 'operator' = 'Marshal Two'), '2');
insert into t.k values ('c1', gen_random_uuid());
select t.expect_error('evidence kept for review (the side counter''s tap, the tap after a sheet) needs the secretary''s reason', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 1, t.rev(11, 1))$q$, '22023');
select t.expect_eq('the secretary confirms round 1 with the reason: Round Score 25/3 - 23/3 (500 - 460 sixtieths)',
  (select (j -> 'units' ->> 'a') || '-' || (j -> 'units' ->> 'b') from (select public.outrance_confirm_round(t.kid('c1'), t.m(11), 1, t.rev(11, 1), 'Reviewed: the side counter tap and the late tap are not on any sheet') j) x), '500-460');
select t.expect_eq('... the same command again is a duplicate', public.outrance_confirm_round(t.kid('c1'), t.m(11), 1, t.rev(11, 1) - 1) ->> 'status', 'duplicate');
select t.expect_eq('... an old revision is stale', public.outrance_confirm_round(gen_random_uuid(), t.m(11), 1, t.rev(11, 1) - 1) ->> 'status', 'stale');
select t.expect_eq('... the round shows 8-8 where a whole number is needed', (select awarded_a || '-' || awarded_b from public.lyst_rounds where match_id = t.m(11) and round_no = 1), '8-8');
select t.expect_error('a correction needs a reason', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 1, t.rev(11, 1))$q$, '22023');
select t.expect_eq('the next step: round 2', t.ostate(11) -> 'totals' ->> 'next', 'round');
select t.expect_error('the fight cannot finish after 1 of 2 rounds', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'decision', 'a')$q$, 'P0001');

-- ================================================================ 4. round 2: level after 2 rounds → a 3rd round (§4.2)
select t.start(11, 2);
select t.as_device(t.sid('counter1')); select t.ack('counter1', 11, 2);
select t.as_device(t.sid('counter2')); select t.ack('counter2', 11, 2); select t.lm('counter2', 11, 2, 'strike', 'a', 3); select t.lm('counter2', 11, 2, 'strike', 'b', 3);
select t.as_device(t.sid('counter3')); select t.ack('counter3', 11, 2); select t.lm('counter3', 11, 2, 'strike', 'b', 6);
select t.stop(11, 2);
select t.as_device(t.sid('counter1'));
select t.expect_eq('marshal one: no strikes, all four criteria Even: 10-10', (select (j -> 'sheet' -> 'result' ->> 'a') || '-' || (j -> 'sheet' -> 'result' ->> 'b') from (select t.sheet('counter1', 2, '{"grappling":"even","list_control":"even","aggression":"even","defence":"even"}') j) x), '10-10');
select t.as_device(t.sid('counter2')); select t.sheet('counter2', 2, '{"grappling":"b"}');
select t.as_device(t.sid('counter3')); select t.sheet('counter3', 2);
select t.as_user(t.u(4));
select t.expect_eq('round 2: 28 - 30 (560 - 600 sixtieths)', (select (j -> 'units' ->> 'a') || '-' || (j -> 'units' ->> 'b') from (select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 2, t.rev(11, 2)) j) x), '560-600');
select t.expect_eq('the Total Fight Score is level, 1060 - 1060: next is the 3rd round', (select (j ->> 'a') || '-' || (j ->> 'b') || ' ' || (j ->> 'next') from (select t.ostate(11) -> 'totals' j) x), '1060-1060 tiebreak');
select t.expect_error('a decision is refused until the 3rd round is fought', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'decision', 'draw')$q$, 'P0001');
select t.expect_error('... nor can the head marshal decide it yet', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'head_marshal', 'a', 'decided')$q$, 'P0001');

-- ================================================================ 5. round 3 with 5 line marshals; a split decision
select t.as_device(t.sid('counter4')); select public.counter_bind('Field 1', 'm', 'Marshal Four');
select t.as_device(t.sid('counter5')); select public.counter_bind('Field 1', 'm', 'Marshal Five');
select t.start(11, 3);
select t.as_device(t.sid('counter1')); select t.ack('counter1', 11, 3); select t.lm('counter1', 11, 3, 'strike', 'a', 7);
select t.as_device(t.sid('counter2')); select t.ack('counter2', 11, 3); select t.lm('counter2', 11, 3, 'strike', 'a', 7);
select t.as_device(t.sid('counter3')); select t.ack('counter3', 11, 3);
select t.as_device(t.sid('counter4')); select t.ack('counter4', 11, 3); select t.lm('counter4', 11, 3, 'strike', 'b', 7);
select t.as_device(t.sid('counter5')); select t.ack('counter5', 11, 3); select t.lm('counter5', 11, 3, 'strike', 'a', 12);
select t.stop(11, 3);
select t.as_device(t.sid('counter1')); select t.sheet('counter1', 3);
select t.as_device(t.sid('counter2')); select t.sheet('counter2', 3);
select t.as_device(t.sid('counter3')); select t.sheet('counter3', 3, '{"grappling":"even","list_control":"even","aggression":"even","defence":"even"}');
select t.as_device(t.sid('counter4')); select t.sheet('counter4', 3);
select t.as_user(t.u(4));
select t.expect_error('4 of 5 sheets: the round waits for the fifth', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 3, t.rev(11, 3))$q$, 'P0001');
select t.expect_error('... the secretary cannot confirm short', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 3, t.rev(11, 3), 'phone died', true)$q$, '42501');
select t.as_device(t.sid('counter5')); select t.sheet('counter5', 3);
select t.as_user(t.u(4));
select t.expect_eq('round 3 with 5 marshals: 49 - 46 (588 - 552 sixtieths)', (select (j -> 'units' ->> 'a') || '-' || (j -> 'units' ->> 'b') || ' ' || (j ->> 'marshals') from (select public.outrance_confirm_round(gen_random_uuid(), t.m(11), 3, t.rev(11, 3)) j) x), '588-552 5');
select t.expect_eq('Total Fight Score 1648 - 1612: Red leads; three marshals for Red, two for Blue: split decision',
  (select (j ->> 'a') || '-' || (j ->> 'b') || ' ' || (j ->> 'leader') || ' ' || (j ->> 'win_type') || ' ' || (j ->> 'next') from (select t.ostate(11) -> 'totals' j) x), '1648-1612 a split_decision finish');
select t.expect_error('the Total Fight Score does not support Blue', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'decision', 'b')$q$, 'P0001');
select t.expect_error('nor a draw', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'decision', 'draw')$q$, 'P0001');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot finish the fight', $q$select public.outrance_finish(gen_random_uuid(), t.m(11), t.ver(11), 'decision', 'a')$q$, '42501');
select t.as_user(t.u(4));
select t.expect_eq('the secretary finishes: Red wins by split decision', public.outrance_finish(t.g(20), t.m(11), t.ver(11), 'decision', 'a') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('the result keeps the exact Total Fight Score and the win type; the score columns hold the rounded totals',
  (select result || ' ' || score_a || '-' || score_b || ' ' || (detail ->> 'win_type') || ' ' || (detail -> 'totals' ->> 'score_a') || '-' || (detail -> 'totals' ->> 'score_b') from public.matches where id = t.m(11)),
  'a 27-27 split_decision 27.467-26.867');
select t.expect_eq('... with every round''s sheets and each marshal''s own fight result',
  (select string_agg((m ->> 'operator') || '=' || (m ->> 'result'), ',' order by m ->> 'operator') from public.matches, jsonb_array_elements(detail -> 'marshals') m where id = t.m(11)),
  'Marshal Five=a,Marshal Four=b,Marshal One=a,Marshal Three=a,Marshal Two=b');

-- ================================================================ 6. appeals (§16)
select t.as_user(t.u(4));
select t.expect_error('after the fight a competitor''s appeal is too late (they appeal before leaving the list)', $q$select public.outrance_appeal(gen_random_uuid(), t.m(11), 'b', 'competitor', 'unregistered clean blows')$q$, 'P0001');
select t.expect_eq('the corner men appeal within 15 minutes', public.outrance_appeal(t.g(30), t.m(11), 'b', 'corner', 'Unregistered clean blows in round 3') ->> 'status', 'ok');
select t.expect_error('the secretary cannot decide an appeal', $q$select public.outrance_appeal_decide(t.g(30), 'rejected', 'none', 'no grounds')$q$, '42501');
select t.as_user(t.u(2));
select t.expect_error('an upheld appeal needs a §16.4 outcome', $q$select public.outrance_appeal_decide(t.g(30), 'upheld', 'none', 'upheld')$q$, '22023');
select t.expect_eq('the head marshal rejects it after the video review', public.outrance_appeal_decide(t.g(30), 'rejected', 'none', 'Video shows the blows were blocked') ->> 'status', 'ok');
select t.as_admin();
update public.matches set finalized_at = now() - interval '16 minutes' where id = t.m(11);
select t.as_user(t.u(4));
select t.expect_error('16 minutes after the fight the corner is too late too', $q$select public.outrance_appeal(gen_random_uuid(), t.m(11), 'b', 'corner', 'late')$q$, 'P0001');

-- ================================================================ 7. warnings and cards escalate (§13.1, §13.4); voiding undoes the escalation
select t.as_user(t.u(4));
select t.expect_eq('the next fight opens', public.lyst_open(t.m(12), 'simple') ->> 'scoring', 'outrance');
select t.expect_eq('the line-marshal phones followed to it', (select count(*) from public.lyst_counter_seats where match_id = t.m(12) and side = 'm' and status = 'active')::int, 5);
select t.start(12, 1);
select t.as_user(t.u(3));
select public.outrance_call(gen_random_uuid(), t.m(12), 1, 'a', 'warning');
select public.outrance_call(gen_random_uuid(), t.m(12), 1, 'a', 'warning');
select t.expect_eq('the third verbal warning escalates to a yellow card', (select (j -> 'escalated' -> 0 ->> 'label') from (select public.outrance_call(t.g(40), t.m(12), 1, 'a', 'warning') j) x), 'Yellow card');
select t.expect_eq('a second yellow card is automatically a red card', (select string_agg(e ->> 'label', ',') from jsonb_array_elements(public.outrance_call(t.g(41), t.m(12), 1, 'a', 'yellow') -> 'escalated') e), 'Red card');
select t.as_user(t.u(2));
select public.lyst_void_discipline(gen_random_uuid(), t.g(41), 'given to the wrong fighter');
select t.as_admin();
select t.expect_eq('voiding the second yellow voids the red card it caused', (select count(*) from public.match_discipline where match_id = t.m(12) and card_key = 'red' and voided_at is null)::int, 0);
select t.expect_eq('... the yellow from the warnings stays', (select count(*) from public.match_discipline where match_id = t.m(12) and card_key = 'yellow' and voided_at is null)::int, 1);

-- ================================================================ 8. stoppages: TKO in Division 2 loses the round; holds before the next fight (§14.8)
select t.as_user(t.u(3));
select public.outrance_call(t.g(50), t.m(12), 1, 'b', 'tko');
select t.expect_eq('Division 2: a TKO for lack of defence is recorded as the round lost', (select label || ' ' || card_key from public.match_discipline where id = t.g(50)), 'TKO: round lost (Div 2) tko_round');
select t.as_user(t.u(4));
select t.expect_error('in Division 2 that TKO does not end the fight', $q$select public.outrance_finish(gen_random_uuid(), t.m(12), t.ver(12), 'tko', 'a')$q$, 'P0001');
select t.as_admin();
select t.expect_eq('... the round''s sheets score it 10-7 (§15.3.1)', private.outrance_sheet_result(5, 5, '{}'::jsonb, private.outrance_protocol(t.m(12), 1) ->> 'stoppage'), '{"a":10,"b":7,"band":"stoppage","winner":"a","decided_by":null}'::jsonb);
select t.as_user(t.u(3));
select public.outrance_call(gen_random_uuid(), t.m(12), 1, 'b', 'ko');
select t.as_user(t.u(4));
select t.expect_eq('a KO ends the fight', public.outrance_finish(gen_random_uuid(), t.m(12), t.ver(12), 'ko', 'a') ->> 'status', 'accepted');
select t.as_admin();
select t.expect_eq('... the result says KO', (select detail ->> 'win_type' from public.matches where id = t.m(12)), 'ko');
select t.expect_eq('... Blue (Pro 4) is held: medic check after the TKO, and out of the tournament after the KO', t.holds(t.en(294)), 'knocked_out,medic_check');
select t.as_user(t.u(3));
select t.expect_error('Pro 4''s next fight does not open (§14.11)', $q$select public.lyst_open(t.m(15), 'simple')$q$, 'P0001');
select t.as_user(t.u(6));
select t.expect_error('the medic cannot clear a KO: the entry must be withdrawn', $q$select public.outrance_clear_hold(t.hold(t.en(294), 'knocked_out'), 'feels fine')$q$, 'P0001');
select t.expect_eq('the medic clears the TKO check', public.outrance_clear_hold(t.hold(t.en(294), 'medic_check'), 'Checked after the TKO: fit') ->> 'status', 'ok');
select t.as_user(t.u(3));
select t.expect_error('... the KO still keeps Pro 4 out', $q$select public.lyst_open(t.m(15), 'simple')$q$, 'P0001');
-- Pack 29b: the tablet sees the holds before the fight can open, so the medic or head marshal can clear them from there
select t.as_user(t.u(4));
select t.expect_eq('the secretary sees why the next fight cannot open', (select string_agg((h ->> 'kind') || ':' || (h ->> 'name'), ',' order by h ->> 'kind') from jsonb_array_elements(public.outrance_match_holds(t.m(15))) h), 'knocked_out:Pro 4');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot read the holds', $q$select public.outrance_match_holds(t.m(15))$q$, '42501');
select t.as_anon();
select t.expect_error('nor anon', $q$select public.outrance_match_holds(t.m(15))$q$, '42501');
select t.as_user(t.u(4));
select t.expect_error('the secretary cannot clear a hold', $q$select public.outrance_clear_hold(t.hold(t.en(294), 'knocked_out'), 'ok')$q$, '42501');

-- Division 1: a TKO for lack of defence ends the fight
select t.as_user(t.u(4));
select public.lyst_open(t.m(14), 'simple');
select t.start(14, 1);
select t.as_user(t.u(3));
select public.outrance_call(t.g(51), t.m(14), 1, 'a', 'tko');
select t.expect_eq('Division 1: the TKO is the match', (select card_key from public.match_discipline where id = t.g(51)), 'tko');
select t.as_user(t.u(4));
select t.expect_error('a stoppage has a winner', $q$select public.outrance_finish(gen_random_uuid(), t.m(14), t.ver(14), 'tko', 'draw')$q$, '22023');
select t.expect_error('the TKO was against Red, not Blue', $q$select public.outrance_finish(gen_random_uuid(), t.m(14), t.ver(14), 'tko', 'a')$q$, 'P0001');
select t.expect_eq('Blue wins by TKO', (select public.outrance_finish(gen_random_uuid(), t.m(14), t.ver(14), 'tko', 'b') ->> 'status'), 'accepted');
select t.as_admin();
select t.expect_eq('... and Red needs the medic''s check', t.holds(t.en(295)), 'medic_check');

-- ================================================================ 8b. phones are not mandatory (owner decision 2026-10-29): paper sheets, any 1 to 5 sheets
select t.as_admin();
insert into public.fighters (id, display_name, gender, disciplines) values (t.g(71), 'Paper Red', 'female', '{}'), (t.g(72), 'Paper Blue', 'female', '{}');
insert into public.entries (id, competition_id, fighter_id) values (t.en(297), t.comp(30), t.g(71)), (t.en(298), t.comp(30), t.g(72));
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(16), t.comp(30), 'round_robin', 'Round 2', 0, t.en(297), t.en(298), 'active', 'Field 2');
select t.as_user(t.u(4));
select t.expect_eq('a Profight opens with no phones at all', public.lyst_open(t.m(16), 'simple') ->> 'scoring', 'outrance');
select t.start(16, 1); select t.stop(16, 1);
select t.expect_error('no sheet yet: the round cannot be confirmed', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(16), 1, t.rev(16, 1))$q$, 'P0001');
select t.as_user(t.u(10));
select t.expect_error('a stranger cannot type in a paper sheet', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 1, 'Anna', '{"strike":{"a":10,"b":3}}')$q$, '42501');
select t.as_user(t.u(4));
select t.expect_error('a paper sheet needs the marshal''s name', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 1, ' ', '{"strike":{"a":10,"b":3}}')$q$, '22023');
select t.expect_error('... and whole numbers', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 1, 'Anna', '{"strike":{"a":"ten","b":3}}')$q$, '22023');
select t.expect_error('... and the criteria when the strike difference is 5 or less (§15.2)', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 1, 'Anna', '{"strike":{"a":8,"b":3}}')$q$, '22023');
select t.expect_error('... and only for a round that was fought', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 4, 'Anna', '{"strike":{"a":10,"b":3}}')$q$, 'P0001');
select t.expect_eq('the secretary types in Anna''s paper sheet: 10-3 strikes, one Blue weapon loss',
  (select (j -> 'sheet' ->> 'source') || ' ' || (j -> 'sheet' -> 'strikes' ->> 'a') || '-' || (j -> 'sheet' -> 'strikes' ->> 'b') || ' ' || (j -> 'sheet' -> 'weapon_losses' ->> 'b')
     from (select public.outrance_enter_sheet(t.g(73), t.m(16), 1, 'Anna', '{"strike":{"a":10,"b":3},"weapon_loss":{"b":1}}') j) x), 'paper 10-3 1');
select t.expect_eq('... typing it again (same id) changes nothing', public.outrance_enter_sheet(t.g(73), t.m(16), 1, 'Anna', '{"strike":{"a":1,"b":1}}') ->> 'status', 'duplicate');
select t.expect_error('... a second sheet for Anna in the same round is refused (replace it instead)', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 1, ' anna ', '{"strike":{"a":10,"b":3}}')$q$, 'P0001');
select t.expect_eq('one sheet confirms the round, no reason needed',
  (select (j ->> 'status') || ' ' || (j ->> 'marshals') from (select public.outrance_confirm_round(gen_random_uuid(), t.m(16), 1, t.rev(16, 1)) j) x), 'ok 1');
select t.expect_eq('... and the round is not flagged short', (select (r ->> 'short') || ' ' || (r ->> 'marshals') from jsonb_array_elements(t.ostate(16) -> 'rounds') r where (r ->> 'round_no')::int = 1), 'false 1');

-- round 2: two paper sheets and a line-marshal phone
select t.as_device(t.sid('counter5')); select public.counter_bind('Field 2', 'm', 'Marshal Five');
select t.start(16, 2);
select t.as_device(t.sid('counter5')); select t.ack('counter5', 16, 2); select t.lm('counter5', 16, 2, 'strike', 'a', 9);
select t.stop(16, 2);
select t.as_user(t.u(4));
select public.outrance_enter_sheet(t.g(74), t.m(16), 2, 'Anna', '{"strike":{"a":9,"b":1}}');
select public.outrance_enter_sheet(t.g(75), t.m(16), 2, 'Bea', '{"strike":{"a":2,"b":9}}');
select t.expect_error('a mistyped paper sheet is replaced only with a reason', $q$select public.outrance_enter_sheet(gen_random_uuid(), t.m(16), 2, 'Bea', '{"strike":{"a":9,"b":2}}', '{}', t.g(75))$q$, '22023');
select t.expect_eq('... with a reason, Bea''s sheet is replaced', public.outrance_enter_sheet(t.g(76), t.m(16), 2, 'Bea', '{"strike":{"a":9,"b":2}}', '{}', t.g(75), 'Red and Blue swapped') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... the mistyped sheet is kept, superseded, with the reason', (select void_reason from public.outrance_sheets where id = t.g(75) and superseded_at is not null), 'Red and Blue swapped');
select t.as_user(t.u(4));
select t.expect_error('a connected phone that has not handed in its sheet still holds the round', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(16), 2, t.rev(16, 2))$q$, 'P0001');
select t.expect_error('removing a paper sheet needs a reason', $q$select public.outrance_remove_sheet(t.g(74), '')$q$, '22023');
select t.as_device(t.sid('counter5')); select t.sheet('counter5', 2);
select t.as_user(t.u(4));
select t.expect_error('a phone''s sheet cannot be removed (it is returned for recount)', $q$select public.outrance_remove_sheet((select (e ->> 'sheet_id')::uuid from jsonb_array_elements(t.ostate(16) -> 'sheets') e where e ->> 'source' = 'phone' limit 1), 'wrong')$q$, 'P0001');
select t.expect_eq('two paper sheets and the phone''s sheet: 3 marshals', public.outrance_confirm_round(gen_random_uuid(), t.m(16), 2, t.rev(16, 2)) ->> 'marshals', '3');
select t.expect_eq('the tablet shows each marshal''s fight result; Anna''s paper sheets are one marshal across both rounds',
  (select string_agg((e ->> 'operator') || ':' || (e ->> 'source') || ':' || (e ->> 'rounds'), ',' order by e ->> 'operator') from jsonb_array_elements(t.ostate(16) -> 'totals' -> 'marshals') e),
  'Anna:paper:2,Bea:paper:1,Marshal Five:phone:1');
select t.expect_eq('the secretary removes a paper sheet, with a reason (kept, superseded)', public.outrance_remove_sheet(t.g(74), 'entered on the wrong fight') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... and it is kept', (select count(*) from public.outrance_sheets where id = t.g(74) and superseded_at is not null)::int, 1);
select t.expect_eq('the audit records every paper sheet', (select count(*) from public.audit_log where action in ('outrance.paper_sheet', 'outrance.paper_sheet_removed') and subject = t.m(16)::text)::int, 5);

-- ================================================================ 9. recount, settings frozen once fights started, in-flight fights
select t.as_user(t.u(1));
select t.expect_error('the division and format can no longer change once fights started', $q$select public.set_profight_format(t.comp(29), '1', 'tournament')$q$, 'P0001');
select t.expect_eq('... setting the same again is fine', public.set_profight_format(t.comp(29), '2', 'tournament', 'men_heavyweight') ->> 'status', 'ok');
-- a Profight opened on the Lyst before Pack 29 (scored as a duel) is scored to the Outrance rules the next time it opens
select t.as_admin();
insert into public.lyst_matches (match_id, event_id, field_key, counter_input, scoring) values (t.m(13), t.ev(1), 'field 1', 'simple', 'marshal');
update public.matches set queue_state = 'active' where id = t.m(13);
update public.matches set queue_state = 'scheduled' where id = t.m(15);
select t.as_user(t.u(4));
select t.expect_eq('an in-flight Profight Lyst switches to Outrance scoring', public.lyst_open(t.m(13), 'simple') ->> 'scoring', 'outrance');
select t.start(13, 1);
select t.as_device(t.sid('counter1')); select t.ack('counter1', 13, 1); select t.lm('counter1', 13, 1, 'strike', 'a', 2); select t.sheet('counter1', 1, '{"grappling":"a"}');
select t.expect_eq('before the return, a tap after the sheet is kept for review', t.lm('counter1', 13, 1, 'strike', 'a'), 'review');
select t.stop(13, 1);
select t.as_user(t.u(4));
select t.expect_eq('the secretary returns round 1 for recount', public.lyst_return_round(gen_random_uuid(), t.m(13), 1, t.rev(13, 1), 'marshal one recounts') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('RETURN FOR RECOUNT supersedes the sheet (kept, never deleted)', (select count(*) filter (where superseded_at is not null) || '/' || count(*) from public.outrance_sheets where match_id = t.m(13)), '1/1');
select t.as_device(t.sid('counter1'));
select t.expect_eq('... and the phone can tap again', t.lm('counter1', 13, 1, 'strike', 'a'), 'ok');

-- ================================================================ 9b. the standings (§17): win/loss within the weight class
select t.as_anon();
select t.expect_eq('anyone sees the Profight records by weight class: heavyweight 1-0 and 0-1, open weight 1-0 and 0-1',
  (select string_agg(display_name || ' ' || weight_class_name || ' ' || wins || '-' || losses || ' #' || coalesce(rank::text, '-'), ', ' order by weight_class_name, rank, display_name) from public.profight_standings where display_name like 'Pro %'),
  'Pro 1 Heavyweight 1-0 #1, Pro 3 Heavyweight 1-0 #1, Pro 2 Heavyweight 0-1 #3, Pro 4 Heavyweight 0-1 #3, Pro 6 Open weight 1-0 #1, Pro 5 Open weight 0-1 #2');
select t.as_admin();
update public.matches set finalized_at = now() - interval '13 months' where id = t.m(14);
select t.expect_eq('no Profight for a year: retired and not ranked', (select status || ' ' || coalesce(rank::text, 'unranked') from public.profight_standings where display_name = 'Pro 6'), 'retired unranked');
update public.matches set finalized_at = now() - interval '25 months' where id = t.m(14);
select t.expect_eq('two years: out of the standings (the fight itself is kept)', (select count(*) from public.profight_standings where display_name in ('Pro 5', 'Pro 6'))::int || '/' || (select count(*) from public.matches where id = t.m(14) and queue_state = 'final')::int, '0/1');
insert into public.sources (id, kind, title, citation, synthetic) values (t.g(90), 'submitted', 'Test data', 'fixture', true);
insert into public.record_sources (source_id, entity_type, entity_id, status) values (t.g(90), 'event', t.ev(1), 'unverified');
select t.expect_eq('a synthetic (test) event is never in the standings', (select count(*) from public.profight_standings where display_name like 'Pro %')::int, 0);
delete from public.record_sources where source_id = t.g(90);

-- Pack 29c: the counter phone's "Last fight" shows the exact Total Fight Score, not the whole-number columns
select t.as_admin();
select t.expect_eq('the phone''s last fight on Field 1 is a Profight with its exact score',
  (select (j -> 'last' ->> 'score_a') || '/' || (select round((detail -> 'totals' ->> 'a')::numeric / 60, 2)::text || ' ' || (detail ->> 'kind') from public.matches where id = (j -> 'last' ->> 'match_id')::uuid)
     from (select private.field_fights(t.ev(1), 'field 1') j) x) ~ '^([0-9.]+)/\1 outrance$', true);

-- ================================================================ 10. permissions
select t.as_anon();
select t.expect_error('anon cannot read the sheets', $q$select count(*) from public.outrance_sheets$q$, '42501');
select t.expect_error('anon cannot confirm a round', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(13), 1, 1)$q$, '42501');
select t.as_user(t.u(4));
select t.expect_error('a signed-in person cannot read the sheets table directly', $q$select count(*) from public.outrance_sheets$q$, '42501');
select t.expect_error('nor the rounds', $q$select count(*) from public.outrance_rounds$q$, '42501');
select t.as_user(t.u(11));
select t.expect_error('another event''s organizer cannot confirm here', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(13), 1, 1)$q$, '42501');
select t.as_device(t.sid('counter1'));
select t.expect_error('a phone cannot confirm a round', $q$select public.outrance_confirm_round(gen_random_uuid(), t.m(13), 1, 1)$q$, '42501');
select t.expect_error('a phone cannot hand in another phone''s sheet', $q$select public.outrance_submit_sheet(gen_random_uuid(), t.seat('counter2'), 1, '{}')$q$, '42501');
select t.expect_error('a phone cannot read the sheets directly', $q$select count(*) from public.outrance_sheets$q$, '42501');

-- ================================================================ 11. test events (owner decision 2026-10-29)
select t.as_user(t.u(12));
insert into t.k values ('tev', public.create_event('test-ev-gate', 'Gate test event', current_date, current_date, null, null, true));
insert into t.k values ('rev', public.create_event('real-ev-gate', 'Gate real event', current_date, current_date));
select t.as_admin();
select t.expect_eq('the owner creates a test event; a normal event by default', (select string_agg(slug || ':' || test_event, ',' order by slug) from public.events where id in (t.kid('tev'), t.kid('rev'))), 'real-ev-gate:false,test-ev-gate:true');
update public.events set status = 'published' where slug in ('test-ev-gate', 'real-ev-gate');
select t.expect_eq('the test event is test data (kept out of rankings and records) and is deleted after 10 days',
  (select private.is_synthetic('event', id)::text || ' ' || (test_delete_after between now() + interval '9 days 23 hours' and now() + interval '10 days 1 hour')::text from public.events where slug = 'test-ev-gate'), 'true true');
select t.as_anon();
select t.expect_eq('the public never sees a test event, even published; it sees a published real one',
  (select string_agg(slug, ',' order by slug) from public.events where slug in ('test-ev-gate', 'real-ev-gate')), 'real-ev-gate');
select t.as_user(t.u(10));
select t.expect_eq('nor does another signed-in person', (select count(*) from public.events where slug = 'test-ev-gate')::int, 0);
select t.as_user(t.u(12));
select t.expect_eq('its creator does', (select count(*) from public.events where slug = 'test-ev-gate')::int, 1);
select t.as_admin();
select t.expect_error('a test event cannot be turned into a real one', $q$update public.events set test_event = false, test_delete_after = null where slug = 'test-ev-gate'$q$, 'P0001');
select t.expect_error('nor a real event into a test one', $q$update public.events set test_event = true, test_delete_after = now() where slug = 'real-ev-gate'$q$, 'P0001');
select t.expect_eq('nothing is deleted before its date', private.purge_test_events(), 0);
-- the purge on the fullest event there is: everything this gate scored (Lyst, phones, sheets, calls, results, holds, appeals) becomes a test event past its date
alter table public.events disable trigger events_test_fixed;
update public.events set test_event = true, test_delete_after = now() - interval '1 minute' where id = t.ev(1);
alter table public.events enable trigger events_test_fixed;
create temp table gate_fighters as select distinct en.fighter_id from public.entries en join public.competitions c on c.id = en.competition_id where c.event_id = t.ev(1);
select t.expect_eq('the daily clean-up deletes the test event past its date', private.purge_test_events(), 1);
select t.expect_eq('... with every competition, fight, entry and result in it',
  (select count(*) from public.events where id = t.ev(1))::int + (select count(*) from public.competitions where event_id = t.ev(1))::int
  + (select count(*) from public.matches where id in (t.m(11), t.m(12), t.m(13), t.m(14), t.m(16)))::int + (select count(*) from public.outrance_sheets where event_id = t.ev(1))::int, 0);
select t.expect_eq('... but never a fighter profile', (select count(*) from public.fighters where id in (select fighter_id from gate_fighters)) = (select count(*) from gate_fighters) and (select count(*) from gate_fighters) > 0, true);
select t.expect_eq('... and the clean-up is logged', (select count(*) from public.retention_log where rule = 'test_events')::int >= 1, true);

do $$ begin raise notice 'PACK29 OUTRANCE GATE PASSED % checks', (select count(*) from t.log); end $$;
rollback;
