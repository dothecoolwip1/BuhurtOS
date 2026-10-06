-- Pack 15 gate: event-day alerts, schedule changes, event announcements, result-review alerts (migration 20261009000100).
--   * fight alerts still come only from real queue changes; they now say how far away and where to report; every one carries a durable dedupe key
--   * a field change reaches people already alerted about that fight; a schedule change is one alert per person per event, only when it matters
--   * announcements: organizer of THAT event only, short, no links, rate-limited, audited, recipients only from that event
--   * a result conflict reaches the event's organizers and head marshals once; nothing private is in any payload
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack15_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise exception 'FAIL (unexpected error %: %): %', sqlstate, sqlerrm, label; end;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok_undo(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; raise exception 'undo' using errcode = 'P0042'; exception when sqlstate 'P0042' then null; end;   -- allowed; its effect is rolled back so later checks see the same world
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;

create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('f15' || n, 12, '0'))::uuid $$;
create function t.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function t.cnt(u uuid, k text, st text default null, mn int default null) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications n where n.user_id = u and n.kind = k and (st is null or n.payload ->> 'stage' = st) and (mn is null or n.payload ->> 'match_id' = t.m(mn)::text) $$;
create function t.words(u uuid, k text, st text default null) returns text language sql stable security definer as $$
  select x.title || ' | ' || x.body from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) x
  where n.user_id = u and n.kind = k and (st is null or n.payload ->> 'stage' = st) order by n.created_at desc limit 1 $$;
create function t.ev(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('e15' || n, 12, '0'))::uuid $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- u1, u2, u4, u5 duel fighters with accounts in event 1; u3 accepted registration (fighter, no entry yet); u6 accepted VOLUNTEER;
-- u7 scorekeeper, u8 head marshal, u9 organizer of event 1; u10 organizer of event 2 only; u11 stranger; u12 a fighter only in event 2.
insert into auth.users (id, email) select t.u(n), 'p15u' || n || '@example.test' from generate_series(1, 12) n;
insert into public.fighters (id, display_name, gender, disciplines)
select ('00000000-0000-0000-0000-' || lpad('ff' || n, 12, '0'))::uuid, 'P15 Fighter ' || n, 'male', '{}' from generate_series(1, 12) n;
insert into public.fighter_accounts (fighter_id, user_id) select ('00000000-0000-0000-0000-' || lpad('ff' || n, 12, '0'))::uuid, t.u(n) from generate_series(1, 12) n where n in (1, 2, 4, 5, 12);
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  (t.ev(1), 'p15-e1', 'Pack Fifteen Open', 'published', current_date, current_date + 1),
  (t.ev(2), 'p15-e2', 'Other Event', 'published', current_date, current_date),
  (t.ev(3), 'p15-draft', 'Draft Event', 'draft', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values
  (t.ev(1), t.u(9), 'organizer'), (t.ev(1), t.u(8), 'head_marshal'), (t.ev(1), t.u(7), 'scorekeeper'),
  (t.ev(2), t.u(10), 'organizer'), (t.ev(3), t.u(9), 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-0000000c1501', t.ev(1), 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  ('00000000-0000-0000-0000-0000000c1502', t.ev(2), 'Other Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1);
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-0000000e1501', '00000000-0000-0000-0000-0000000c1501', '00000000-0000-0000-0000-000000000ff1'),
  ('00000000-0000-0000-0000-0000000e1502', '00000000-0000-0000-0000-0000000c1501', '00000000-0000-0000-0000-000000000ff2'),
  ('00000000-0000-0000-0000-0000000e1504', '00000000-0000-0000-0000-0000000c1501', '00000000-0000-0000-0000-000000000ff4'),
  ('00000000-0000-0000-0000-0000000e1505', '00000000-0000-0000-0000-0000000c1501', '00000000-0000-0000-0000-000000000ff5'),
  ('00000000-0000-0000-0000-0000000e1512', '00000000-0000-0000-0000-0000000c1502', '00000000-0000-0000-0000-00000000ff12'),
  ('00000000-0000-0000-0000-0000000e1513', '00000000-0000-0000-0000-0000000c1502', '00000000-0000-0000-0000-00000000ff11');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000a1501', t.ev(1), 1, 'Waiver', 'Fictional waiver text for the gate.');
insert into public.registrations (id, event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer) values
  ('00000000-0000-0000-0000-0000000a1503', t.ev(1), t.u(3), 'accepted', 'Person Three', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a1501', 'Person Three', false),
  ('00000000-0000-0000-0000-0000000a1506', t.ev(1), t.u(6), 'accepted', 'Person Six', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a1501', 'Person Six', true);
-- Field 1 (no field written = the default field): m1 u1 v u2, m2 u4 v u5, m3 u1 v u4. Event 2: m9 u12 v a fighter without an account.
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  (t.m(1), '00000000-0000-0000-0000-0000000c1501', 'round_robin', 'Round 1', 0, null, '00000000-0000-0000-0000-0000000e1501', '00000000-0000-0000-0000-0000000e1502', now() + interval '1 hour'),
  (t.m(2), '00000000-0000-0000-0000-0000000c1501', 'round_robin', 'Round 1', 1, null, '00000000-0000-0000-0000-0000000e1504', '00000000-0000-0000-0000-0000000e1505', now() + interval '70 minutes'),
  (t.m(3), '00000000-0000-0000-0000-0000000c1501', 'round_robin', 'Round 2', 0, null, '00000000-0000-0000-0000-0000000e1501', '00000000-0000-0000-0000-0000000e1504', now() + interval '80 minutes'),
  (t.m(9), '00000000-0000-0000-0000-0000000c1502', 'round_robin', 'Round 1', 0, null, '00000000-0000-0000-0000-0000000e1512', '00000000-0000-0000-0000-0000000e1513', now() + interval '1 hour');

-- ================================================================ 1. fight alerts: how far away, where to report, durable keys
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'active');
select public.set_match_queue(t.m(2), 'on_deck');
select public.set_match_queue(t.m(3), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('IN THE HOLE with a fight on the field and one on deck: "You''re 2 fights away"', t.words(t.u(4), 'fight_called', 'in_the_hole'), 'You''re 2 fights away | Start getting ready for Longsword on Field 1.');
select t.expect_eq('... the count is stored on the alert (the real line at that moment)', (select payload ->> 'ahead' from public.notifications where user_id = t.u(1) and kind = 'fight_called' and payload ->> 'match_id' = t.m(3)::text), '2');
select t.expect_eq('ON DECK: "You''re up next · Report to Field 1"', t.words(t.u(5), 'fight_called', 'on_deck'), 'You''re up next | Report to Field 1 and be ready to fight.');
select t.expect_eq('NOW: "Your fight is ready · Report to Field 1 now"', t.words(t.u(2), 'fight_called', 'active'), 'Your fight is ready | Report to Field 1 now.');
select t.expect_eq('every fight alert carries a durable dedupe key', (select count(*) from public.notifications where kind in ('fight_called', 'fight_moved') and dedupe_key is null), 0::bigint);
select t.expect_eq('... in the form fight:<match>:<person>:<number>:<kind>:<stage>', (select dedupe_key from public.notifications where user_id = t.u(4) and payload ->> 'match_id' = t.m(3)::text), 'fight:' || t.m(3) || ':' || t.u(4) || ':0:fight_called:in_the_hole');
-- the same transition produced again (a retried or concurrent producer) cannot write a second row
select t.expect_ok('replaying the same alert key inserts nothing',
  $$insert into public.notifications (user_id, kind, payload, dedupe_key) select user_id, kind, payload, dedupe_key from public.notifications where user_id = t.u(4) and payload ->> 'match_id' = t.m(3)::text on conflict (dedupe_key) where dedupe_key is not null do nothing$$);
select t.expect_eq('... still exactly one in-the-hole alert for that fight', t.cnt(t.u(4), 'fight_called', 'in_the_hole', 3), 1::bigint);

-- moved back, then called again later: the later call is real news and gets the next number
select t.as_user(t.u(9));
select public.set_match_queue(t.m(3), 'scheduled');
select t.settle();
select t.as_admin();
update public.notifications set created_at = created_at - interval '5 minutes' where payload ->> 'match_id' = t.m(3)::text;
select t.as_user(t.u(9));
select public.set_match_queue(t.m(3), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('called again after moving back: a second in-the-hole alert (genuine news, new key)', t.cnt(t.u(4), 'fight_called', 'in_the_hole', 3), 2::bigint);
select t.expect_eq('... keys differ by the alert number', (select count(distinct dedupe_key) from public.notifications where user_id = t.u(4) and payload ->> 'match_id' = t.m(3)::text), 3::bigint);

-- ================================================================ 2. lyst (field) changes
select t.as_user(t.u(9));
select public.set_match_queue(t.m(3), 'scheduled');
select t.settle();
select t.as_admin();
update public.matches set field = 'Field 2' where id = t.m(3);
select t.settle();
select t.expect_eq('a fight back in the line moving field: people already alerted about it are told (both fighters)', array[t.cnt(t.u(1), 'fight_moved', 'field', 3), t.cnt(t.u(4), 'fight_moved', 'field', 3)], array[1::bigint, 1::bigint]);
select t.expect_eq('... "Your fight changed field · It is now on Field 2"', t.words(t.u(4), 'fight_moved', 'field'), 'Your fight changed field | It is now on Field 2. Report there.');
update public.matches set field = 'Field 3' where id = t.m(9);
select t.settle();
select t.expect_eq('a waiting fight nobody was alerted about changing field sends nothing', t.cnt(t.u(12), 'fight_moved'), 0::bigint);

-- ================================================================ 3. schedule changes
update public.matches set scheduled_at = scheduled_at + interval '30 minutes' where id = t.m(9);
select t.settle();
select t.expect_eq('a 30-minute move close to now: the fighter hears once', t.cnt(t.u(12), 'schedule_changed'), 1::bigint);
select t.expect_eq('... "Your schedule changed", no clock time claimed', t.words(t.u(12), 'schedule_changed'), 'Your schedule changed | Fight times at Other Event changed. Check My next fight for your place in the line.');
select t.expect_eq('... fights group, pushed, opening My next fight', (select row(category, push, route) from public.notifications where user_id = t.u(12) and kind = 'schedule_changed')::text, '(fights,t,/events/p15-e2#my-next-fight)');
update public.matches set scheduled_at = scheduled_at + interval '5 minutes' where id = t.m(9);
select t.settle();
select t.expect_eq('a 5-minute nudge is not news', t.cnt(t.u(12), 'schedule_changed'), 1::bigint);
update public.matches set scheduled_at = scheduled_at + interval '40 minutes' where id in (t.m(1), t.m(2));
select t.settle();
select t.expect_eq('two of a fighter''s fights moved together: ONE alert for that person and event', t.cnt(t.u(2), 'schedule_changed') + t.cnt(t.u(1), 'schedule_changed'), 2::bigint);
update public.matches set scheduled_at = now() + interval '3 days' where id = t.m(1);
update public.matches set scheduled_at = now() + interval '4 days' where id = t.m(1);
select t.settle();
select t.expect_eq('moving a fight days ahead (old and new time not within 24 hours) is not news', t.cnt(t.u(2), 'schedule_changed'), 1::bigint);
update public.matches set queue_state = 'final', finalized_at = now(), scheduled_at = now() + interval '2 hours' where id = t.m(2);
select t.settle();
select t.expect_eq('a final fight changing time is not news', t.cnt(t.u(5), 'schedule_changed'), 1::bigint);

-- ================================================================ 4. result conflicts reach the people who decide them
insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, result, score_a, score_b, status)
values ('00000000-0000-0000-0000-0000000d1501', t.m(2), t.ev(1), 'device', t.u(7), 1, 'b', 1, 3, 'conflict');
insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, result, score_a, score_b, status)
values ('00000000-0000-0000-0000-0000000d1502', t.m(2), t.ev(1), 'device', t.u(7), 1, 'a', 3, 1, 'duplicate');
select t.expect_eq('a CONFLICT reaches the organizer and the head marshal once each', array[t.cnt(t.u(9), 'result_needs_review'), t.cnt(t.u(8), 'result_needs_review')], array[1::bigint, 1::bigint]);
select t.expect_eq('... not the scorekeeper, not the fighters, not another event''s organizer; a duplicate result alerts nobody',
  t.cnt(t.u(7), 'result_needs_review') + t.cnt(t.u(4), 'result_needs_review') + t.cnt(t.u(10), 'result_needs_review'), 0::bigint);
select t.expect_eq('... opens Event day, says what to do', (select route from public.notifications where user_id = t.u(9) and kind = 'result_needs_review') || ' | ' || t.words(t.u(9), 'result_needs_review'),
  '/events/p15-e1/manage?tab=eventday | Result needs review | Two results disagree in Longsword. Open Event day to decide.');

-- ================================================================ 5. announcements: who may send
select t.as_anon();
select t.expect_error('anonymous cannot send an announcement', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$, '42501');
select t.as_user(t.u(11));
select t.expect_error('a stranger cannot', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$, '42501');
select t.as_user(t.u(1));
select t.expect_error('a fighter cannot', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$, '42501');
select t.as_user(t.u(7));
select t.expect_ok_undo('a scorekeeper (the secretary) may send an announcement (Pack 18.1)', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$);
select t.as_user(t.u(8));
select t.expect_error('a head marshal cannot (organizers only)', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$, '42501');
select t.as_user(t.u(10));
select t.expect_error('another event''s organizer cannot message this event', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.')$$, '42501');
select t.as_user(t.u(9));
select t.expect_error('a draft event cannot be announced to', $$select public.send_event_announcement(t.ev(3), 'Lunch ends at 1:15 PM.')$$, '22023');
select t.expect_error('too short', $$select public.send_event_announcement(t.ev(1), 'Hi')$$, '22023');
select t.expect_error('too long (over 140)', $$select public.send_event_announcement(t.ev(1), repeat('x', 141))$$, '22023');
select t.expect_error('no links (https)', $$select public.send_event_announcement(t.ev(1), 'Results at https://evil.example/x')$$, '22023');
select t.expect_error('no links (bare domain)', $$select public.send_event_announcement(t.ev(1), 'Go to evil.com now')$$, '22023');
select t.expect_error('unknown audience', $$select public.send_event_announcement(t.ev(1), 'Lunch ends at 1:15 PM.', 'world')$$, '22023');

-- ================================================================ 6. announcements: who hears
select t.expect_ok('the event''s organizer sends to everyone', $$select public.send_event_announcement(t.ev(1), '  Lyst 2 is running   20 minutes behind. ')$$);
select t.as_admin();
select t.expect_eq('everyone taking part hears: fighters with entries, the accepted registration, the volunteer, the staff (not the sender)',
  (select array_agg(n order by n) from (select generate_series(1, 12) n) g where t.cnt(t.u(n), 'event_announcement') = 1), array[1, 2, 3, 4, 5, 6, 7, 8]);
select t.expect_eq('... nobody from another event, no stranger, not the sender', t.cnt(t.u(12), 'event_announcement') + t.cnt(t.u(10), 'event_announcement') + t.cnt(t.u(11), 'event_announcement') + t.cnt(t.u(9), 'event_announcement'), 0::bigint);
select t.expect_eq('the words are the message, cleaned of extra spaces; the title is the event', t.words(t.u(1), 'event_announcement'), 'Pack Fifteen Open | Lyst 2 is running 20 minutes behind.');
select t.expect_eq('... events group, pushed, opens the event', (select row(category, push, route) from public.notifications where user_id = t.u(1) and kind = 'event_announcement')::text, '(events,t,/events/p15-e1)');
select t.expect_eq('the payload carries no account of the sender', (select count(*) from public.notifications n where kind = 'event_announcement' and (n.payload::text like '%' || t.u(9)::text || '%' or n.payload ? 'sent_by')), 0::bigint);
select t.expect_eq('recorded with its recipient count and audited', (select recipients::text || '/' || audience from public.event_announcements where event_id = t.ev(1)) || ' audit=' || (select count(*) from public.audit_log where action = 'event.announcement' and event_id = t.ev(1)), '8/everyone audit=1');
select t.as_user(t.u(9));
select t.expect_ok('to fighters only', $$select public.send_event_announcement(t.ev(1), 'All fighters report for armour check.', 'fighters')$$);
select t.as_admin();
select t.expect_eq('fighters only: the fighters and the accepted fighter registration, not the volunteer or the staff',
  (select array_agg(n order by n) from (select generate_series(1, 12) n) g where t.cnt(t.u(n), 'event_announcement') = 2), array[1, 2, 3, 4, 5]);
select t.as_user(t.u(9));
select t.expect_ok('third', $$select public.send_event_announcement(t.ev(1), 'Third message for the rate limit.')$$);
select t.expect_ok('fourth', $$select public.send_event_announcement(t.ev(1), 'Fourth message for the rate limit.')$$);
select t.expect_ok('fifth', $$select public.send_event_announcement(t.ev(1), 'Fifth message for the rate limit.')$$);
select t.expect_error('a sixth in one hour is refused (no mass messaging)', $$select public.send_event_announcement(t.ev(1), 'Sixth message for the rate limit.')$$, '22023');
select t.expect_eq('the organizer sees the history (newest first)', (select message from public.list_event_announcements(t.ev(1)) limit 1), 'Fifth message for the rate limit.');
select t.as_user(t.u(11));
select t.expect_error('a stranger cannot read the history', $$select * from public.list_event_announcements(t.ev(1))$$, '42501');
select t.as_user(t.u(7));
select t.expect_error('a scorekeeper cannot read the history', $$select * from public.list_event_announcements(t.ev(1))$$, '42501');
select t.expect_error('nobody reads the announcements table directly', $$select count(*) from public.event_announcements$$, '42501');
select t.expect_error('nobody writes notifications directly (no client can message anyone)', $$insert into public.notifications (user_id, kind, payload) values (t.u(1), 'event_announcement', '{"message":"fake"}')$$, '42501');
select t.as_anon();
select t.expect_error('anonymous cannot read the history', $$select * from public.list_event_announcements(t.ev(1))$$, '42501');

-- ================================================================ 7. synthetic events stay in the app; nothing private in any payload; hardened functions
select t.as_admin();
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000b1501', 'submitted', 'Fictional', 'test', true);
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000b1501', 'event', t.ev(2), 'unverified', 'fictional');
select t.as_user(t.u(10));
select t.expect_ok('an organizer of a test event can announce', $$select public.send_event_announcement(t.ev(2), 'Test event announcement.')$$);
select t.as_admin();
select t.expect_eq('a test (synthetic) event never pushes: in-app only', (select bool_or(push) from public.notifications where kind = 'event_announcement' and payload ->> 'event_slug' = 'p15-e2'), false);
select t.expect_eq('no payload of the new kinds names an account, contact, counter or private reason',
  (select count(*) from public.notifications where kind in ('schedule_changed', 'event_announcement', 'result_needs_review', 'fight_called', 'fight_moved')
     and payload::text ~* '(user_id|email|phone|counter|seat|reason|tally|proposed_by|sent_by)'), 0::bigint);
select t.expect_eq('every new public function is SECURITY DEFINER with an empty search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('send_event_announcement', 'list_event_announcements')
     and p.prosecdef and p.proconfig = array['search_path=""']), 2::bigint);
select t.expect_eq('anon cannot execute them; authenticated can (the role check is inside)',
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) || '/' || bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('send_event_announcement', 'list_event_announcements')), 'false/true');
select t.expect_eq('the private producers and the audience helper are callable by nobody',
  (select bool_or(has_function_privilege(r, p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated')) v(r)
   where n.nspname = 'private' and p.proname in ('schedule_notify', 'review_notify', 'event_audience', 'queue_notify')), false);
select t.expect_eq('the announcements table has RLS on and no client grant',
  (select relrowsecurity from pg_class where oid = 'public.event_announcements'::regclass)::text || '/' ||
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'event_announcements' and grantee in ('anon', 'authenticated')), 'true/0');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK15 GATE PASSED % checks', n; end $$;
rollback;
