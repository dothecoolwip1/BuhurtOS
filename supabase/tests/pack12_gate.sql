-- Pack 12 gate: push notifications (migrations 20261006000100 / 20261006000200).
--   * device subscriptions are secret and owned: no client reads them, owners manage only their own, the dispatcher doors are service-role only
--   * fight notifications come from REAL queue transitions: in the hole, on deck, now, moved back, field changed; once each, never from churn or rereads
--   * recipients follow the event-time roster (the same rule as "My next fight"), never the team's current members
--   * test / synthetic events never push; team and event notices go only to the right people; a failure in notifying never blocks the queue
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack12_gate.sql
-- The fight trigger is deferred to COMMIT; this script never commits, so t.settle() forces pending trigger events (the same trick pack09a_gate uses).
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.as_actor(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create function t.as_service() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role service_role; end $$;
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
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;

create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000a' || n)::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f0' || lpad(n::text, 3, '0'))::uuid $$;
create function t.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
-- how many notifications of a kind (and stage) a user has, read or not; and the unread ones
create function t.cnt(u uuid, k text, st text default null, mn int default null) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications n where n.user_id = u and n.kind = k and (st is null or n.payload ->> 'stage' = st) and (mn is null or n.payload ->> 'match_id' = t.m(mn)::text) $$;
create function t.unread(u uuid, mn int) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications n where n.user_id = u and n.kind in ('fight_called', 'fight_moved') and n.read_at is null and n.payload ->> 'match_id' = t.m(mn)::text $$;
create function t.total(u uuid) returns bigint language sql stable security definer as $$ select count(*) from public.notifications n where n.user_id = u $$;
create function t.foreign_in_feed(other uuid) returns bigint language sql stable security definer as $$ select count(*) from public.my_notification_feed(200) f where f.id in (select id from public.notifications where user_id = other) $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) select t.u(n), 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.teams (id, slug, name, status) values
  ('00000000-0000-0000-0000-00000000c001', 'team-t', 'Team T', 'approved'), ('00000000-0000-0000-0000-00000000c002', 'team-u', 'Team U', 'approved'),
  ('00000000-0000-0000-0000-00000000c003', 'team-v', 'Team V', 'approved'), ('00000000-0000-0000-0000-00000000c004', 'team-w', 'Team W', 'approved');
insert into public.fighters (id, display_name, team_id, gender, disciplines)
select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, 'Fighter ' || n, case when n in (5, 6) then '00000000-0000-0000-0000-00000000c001'::uuid when n = 7 then '00000000-0000-0000-0000-00000000c002'::uuid end, 'male', '{}'
from generate_series(1, 7) n;
-- fighter 3 has NO account on purpose (fighters exist without accounts)
insert into public.fighter_accounts (fighter_id, user_id) select ('00000000-0000-0000-0000-00000000f00' || n)::uuid, t.u(n) from generate_series(1, 7) n where n <> 3;
insert into public.team_memberships (fighter_id, team_id, role, from_date) values
  ('00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-00000000c001', 'fighter', current_date),
  ('00000000-0000-0000-0000-00000000f006', '00000000-0000-0000-0000-00000000c001', 'fighter', current_date),
  ('00000000-0000-0000-0000-00000000f007', '00000000-0000-0000-0000-00000000c002', 'fighter', current_date);
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000c001', t.u(8), 'captain');
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date - 1, current_date + 1),
  ('00000000-0000-0000-0000-00000000e102', 'fake-e2-test', 'Fictional Event', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', t.u(9), 'organizer'), ('00000000-0000-0000-0000-00000000e102', t.u(9), 'organizer');
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-00000000b001', 'submitted', 'Fictional test dataset', 'test', true);
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-00000000b001', 'event', '00000000-0000-0000-0000-00000000e102', 'unverified', 'fictional');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1),
  ('00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000e101', 'Men 5v5', '5v5', 'men', 'Classic', 'round_robin', 2),
  ('00000000-0000-0000-0000-00000000b103', '00000000-0000-0000-0000-00000000e102', 'Fictional Longsword', 'longsword', 'men', 'Classic', 'round_robin', 1);
-- duel entries eF1, eF2, eF3 (no account), eF4; team entries eT (roster f5 only), eU (roster f7), eV and eW (no roster recorded: the registration stands in)
insert into public.entries (id, competition_id, team_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000b101', null, '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-00000000b101', null, '00000000-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-00000000b101', null, '00000000-0000-0000-0000-00000000f003'),
  ('00000000-0000-0000-0000-00000000ee04', '00000000-0000-0000-0000-00000000b101', null, '00000000-0000-0000-0000-00000000f004'),
  ('00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c001', null),
  ('00000000-0000-0000-0000-00000000ee06', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c002', null),
  ('00000000-0000-0000-0000-00000000ee07', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c003', null),
  ('00000000-0000-0000-0000-00000000ee08', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c004', null),
  ('00000000-0000-0000-0000-00000000ee09', '00000000-0000-0000-0000-00000000b103', null, '00000000-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000ee0a', '00000000-0000-0000-0000-00000000b103', null, '00000000-0000-0000-0000-00000000f002');
insert into public.entry_fighters (entry_id, competition_id, fighter_id, role) values
  ('00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000f005', 'fighter'),
  ('00000000-0000-0000-0000-00000000ee06', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000f007', 'fighter');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000aa11', '00000000-0000-0000-0000-00000000e101', 1, 'Waiver', 'Fictional waiver text for the gate.');
-- u3 registered (accepted) with Team V for the 5v5; u5's registration is volunteer-free and accepted
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, team_id) values
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000e101', t.u(3), null, 'accepted', 'Person Three', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Person Three', '00000000-0000-0000-0000-00000000c003');
insert into public.registration_competitions (registration_id, competition_id, team_id) values ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-00000000c003');
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  (t.m(1), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 0, null, '00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee02'),
  (t.m(2), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 1, null, '00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-00000000ee04'),
  (t.m(3), '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 0, null, '00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee04'),
  (t.m(4), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 0, 'Field 3', '00000000-0000-0000-0000-00000000ee05', '00000000-0000-0000-0000-00000000ee06'),
  (t.m(5), '00000000-0000-0000-0000-00000000b102', 'round_robin', 'Round 1', 1, 'Field 4', '00000000-0000-0000-0000-00000000ee07', '00000000-0000-0000-0000-00000000ee08'),
  (t.m(6), '00000000-0000-0000-0000-00000000b103', 'round_robin', 'Round 1', 0, null, '00000000-0000-0000-0000-00000000ee09', '00000000-0000-0000-0000-00000000ee0a');

-- ================================================================ 1. nothing is sent for a schedule that merely exists
select t.expect_eq('building matches sends nobody anything', (select count(*) from public.notifications where kind in ('fight_called', 'fight_moved')), 0::bigint);

-- ================================================================ 2. the critical event-day scenario (duel m1: fighter 1 / u1 against fighter 2 / u2)
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('IN THE HOLE: each fighter with an account gets exactly one alert', array[t.cnt(t.u(1), 'fight_called', 'in_the_hole', 1), t.cnt(t.u(2), 'fight_called', 'in_the_hole', 1)], array[1::bigint, 1::bigint]);
select t.expect_eq('... and nobody else (the opponent of another fight, the organizer, a stranger)', array[t.total(t.u(4)), t.total(t.u(9)), t.total(t.u(3))], array[0::bigint, 0::bigint, 0::bigint]);
select t.expect_eq('the alert is meant for the lock screen, pending, in the fights group, and opens the event page at My next fight',
  (select row(category, push, push_state, route) from public.notifications where user_id = t.u(1) and kind = 'fight_called')::text, '(fights,t,pending,/events/e1#my-next-fight)');
select t.expect_eq('the alert says no more than the fighter needs (no opponent, no account data)',
  (select payload from public.notifications where user_id = t.u(1) and kind = 'fight_called') - 'match_id', jsonb_build_object('stage', 'in_the_hole', 'field', 'Field 1', 'competition_name', 'Longsword', 'event_name', 'Event One', 'event_slug', 'e1'));
select t.expect_eq('lock-screen wording', (select t.title || ' | ' || t.body from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) t where n.user_id = t.u(1)), 'In the hole | You''re coming up soon. Longsword · Field 1');

-- the same state written again (realtime churn, a second tap, advance_field_queue run twice) changes nothing and sends nothing
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('writing the same state again sends nothing', t.cnt(t.u(1), 'fight_called', null, 1), 1::bigint);
-- reading is not writing: the screen and the list read, they never produce alerts
select t.as_user(t.u(1));
select count(*) from public.my_event_entries('00000000-0000-0000-0000-00000000e101');
select count(*) from public.my_notification_feed(50);
select t.as_admin();
select t.expect_eq('reading My next fight and the bell sends nothing', t.cnt(t.u(1), 'fight_called', null, 1), 1::bigint);

select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'on_deck');
select t.settle();
select t.as_admin();
select t.expect_eq('ON DECK: one more alert each, with the field', array[t.cnt(t.u(1), 'fight_called', 'on_deck', 1), t.cnt(t.u(2), 'fight_called', 'on_deck', 1)], array[1::bigint, 1::bigint]);
select t.expect_eq('on-deck wording matches the app''s own label (go to the bullpen)', (select t.body from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) t where n.user_id = t.u(1) and n.payload ->> 'stage' = 'on_deck'), 'You''re up next on Field 1. Get to the bullpen.');
select t.expect_eq('a newer alert marks the older unread one for that match as read, so the list does not contradict itself', t.unread(t.u(1), 1), 1::bigint);

select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'active');
select t.settle();
select t.as_admin();
select t.expect_eq('NOW: one alert each', array[t.cnt(t.u(1), 'fight_called', 'active', 1), t.cnt(t.u(2), 'fight_called', 'active', 1)], array[1::bigint, 1::bigint]);
select t.expect_eq('now wording', (select t.title || ' | ' || t.body from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) t where n.user_id = t.u(1) and n.payload ->> 'stage' = 'active'), 'You''re up now | You''re up now on Field 1.');
select t.expect_eq('three states, three alerts, exactly one per transition', t.cnt(t.u(1), 'fight_called', null, 1), 3::bigint);
select t.expect_eq('the fight screen and the alert read the same column: the match really is active', (select queue_state from public.matches where id = t.m(1)), 'active');

-- ---- send it back to the line: a sensible single "moved back", never a flood
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'scheduled');
select t.settle();
select t.as_admin();
select t.expect_eq('SEND BACK: one "moved back" each', array[t.cnt(t.u(1), 'fight_moved', 'back', 1), t.cnt(t.u(2), 'fight_moved', 'back', 1)], array[1::bigint, 1::bigint]);
select t.expect_eq('... and the older unread alerts for that fight are now read (one unread truth left)', t.unread(t.u(1), 1), 1::bigint);
select t.expect_eq('moved-back wording', (select t.title from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) t where n.user_id = t.u(1) and n.payload ->> 'stage' = 'back'), 'Your fight moved back');
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'scheduled');
select t.settle();
select t.as_admin();
select t.expect_eq('sending back a fight that is already back changes nothing', t.cnt(t.u(1), 'fight_moved', 'back', 1), 1::bigint);

-- ---- manual reorder: m2 (u4 against a fighter with no account) on deck, m3 (u1 against u4) in the hole; then run m3 first
select t.as_user(t.u(9));
select public.set_match_queue(t.m(2), 'on_deck');
select public.set_match_queue(t.m(3), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('a fighter without an account is simply not notified (the other side still is)', array[t.cnt(t.u(4), 'fight_called', 'on_deck', 2), t.cnt(t.u(4), 'fight_called', 'in_the_hole', 3), t.cnt(t.u(1), 'fight_called', 'in_the_hole', 3)], array[1::bigint, 1::bigint, 1::bigint]);
select t.as_user(t.u(9));
select public.move_match_in_queue(t.m(3), 'first');
select t.settle();
select t.as_admin();
select t.expect_eq('REORDER: the fight that moved up is called on deck', array[t.cnt(t.u(1), 'fight_called', 'on_deck', 3), t.cnt(t.u(4), 'fight_called', 'on_deck', 3)], array[1::bigint, 1::bigint]);
select t.expect_eq('... the fight it displaced hears it moved back, once', t.cnt(t.u(4), 'fight_moved', 'back', 2), 1::bigint);
select t.expect_eq('... and nothing contradictory is left unread for the displaced fight', t.unread(t.u(4), 2), 1::bigint);
select t.expect_eq('the database order agrees with what was announced (m3 on deck, m2 in the hole)', (select string_agg(queue_state, ',' order by position, round_label) from public.matches where id in (t.m(2), t.m(3))), 'on_deck,in_the_hole');

-- ---- field change while called: the new field is the news
select t.as_user(t.u(9));
select public.set_match_queue(t.m(3), 'on_deck', 'Field 2');
select t.settle();
select t.as_admin();
select t.expect_eq('FIELD CHANGE of a called fight: one "your field changed" naming the new field', array[t.cnt(t.u(1), 'fight_moved', 'field', 3), t.cnt(t.u(4), 'fight_moved', 'field', 3)], array[1::bigint, 1::bigint]);
select t.expect_eq('... saying Field 2', (select t.body from public.notifications n cross join lateral private.notification_text(n.kind, n.payload) t where n.user_id = t.u(1) and n.payload ->> 'stage' = 'field'), 'Your fight is now on Field 2.');
select t.as_user(t.u(9));
select public.set_match_queue(t.m(2), 'scheduled', 'Field 9');
select t.settle();
select t.as_admin();
select t.expect_eq('a waiting fight changing field is not worth an alert (back, not field)', t.cnt(t.u(4), 'fight_moved', 'field', 2), 0::bigint);

-- ---- becoming final retires the alerts, sends nothing new
update public.matches set queue_state = 'final', finalized_at = now() where id = t.m(3);
select t.settle();
select t.expect_eq('a finished fight leaves no unread fight alerts behind', t.unread(t.u(1), 3), 0::bigint);
select t.expect_eq('... and finishing sent no extra alert', t.cnt(t.u(1), 'fight_called', null, 3) + t.cnt(t.u(1), 'fight_moved', null, 3), 3::bigint);

-- ================================================================ 3. who is told in a team fight: the event-time roster
select t.as_user(t.u(9));
select public.set_match_queue(t.m(4), 'in_the_hole');
select public.set_match_queue(t.m(5), 'on_deck');
select t.settle();
select t.as_admin();
select t.expect_eq('team fight: the fighters on the RECORDED rosters are told', array[t.cnt(t.u(5), 'fight_called', 'in_the_hole', 4), t.cnt(t.u(7), 'fight_called', 'in_the_hole', 4)], array[1::bigint, 1::bigint]);
select t.expect_eq('... not a current teammate who is not on the roster, not the captain, not a bystander', array[t.cnt(t.u(6), 'fight_called', null, 4), t.cnt(t.u(8), 'fight_called', null, 4), t.cnt(t.u(1), 'fight_called', null, 4)], array[0::bigint, 0::bigint, 0::bigint]);
select t.expect_eq('no roster recorded yet: the accepted registration with that team stands in (u3), nobody else', array[t.cnt(t.u(3), 'fight_called', 'on_deck', 5), t.cnt(t.u(5), 'fight_called', null, 5)], array[1::bigint, 0::bigint]);
-- ---- Home: "what matters right now" reads the same queue
select t.as_user(t.u(5));
select t.expect_eq('Home: the fighter on the roster sees their called fight, with field and opponent', (select row(event_slug, stage, field, opponent)::text from public.my_fight_now()), '(e1,in_the_hole,"Field 3","Team U")');
select t.as_user(t.u(6));
select t.expect_eq('Home: a current teammate who is not on the roster sees nothing', (select count(*) from public.my_fight_now()), 0::bigint);
select t.as_user(t.u(3));
select t.expect_eq('Home: the registrant stood in by the registration sees the on-deck fight', (select stage from public.my_fight_now()), 'on_deck');
select t.as_anon();
select t.expect_error('Home: anonymous cannot ask', 'select * from public.my_fight_now()', '42501');
select t.as_admin();
-- the rule is the same one My next fight uses: for every person and every entry, "I am a recipient" = "my_event_entries lists it"
do $$
declare r record; v_bad text := '';
begin
  for r in select u.id as uid, e.id as eid from auth.users u cross join public.entries e where e.competition_id in ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b102') loop
    perform set_config('request.jwt.claim.sub', r.uid::text, true);
    if (r.eid in (select entry_id from public.my_event_entries('00000000-0000-0000-0000-00000000e101'))) is distinct from (r.uid in (select private.entry_recipient_users(r.eid))) then
      v_bad := v_bad || right(r.uid::text, 2) || '/' || right(r.eid::text, 2) || ' ';
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  if v_bad <> '' then raise exception 'FAIL (alerts and My next fight disagree about: %)', v_bad; end if;
  insert into t.log (name) values ('alerts and My next fight use the same rule for every person and entry');
end $$;
update public.entries set status = 'withdrawn' where id = '00000000-0000-0000-0000-00000000ee06';
select t.expect_eq('a withdrawn entry notifies nobody', (select count(*) from private.entry_recipient_users('00000000-0000-0000-0000-00000000ee06')), 0::bigint);

-- ================================================================ 4. test events never push
select t.as_user(t.u(9));
select public.set_match_queue(t.m(6), 'on_deck');
select t.settle();
select t.as_admin();
select t.expect_eq('a fictional event still reaches the in-app list', t.cnt(t.u(1), 'fight_called', 'on_deck', 6), 1::bigint);
select t.expect_eq('... but is never meant for a lock screen', (select row(push, push_state)::text from public.notifications where user_id = t.u(1) and payload ->> 'match_id' = t.m(6)::text), '(f,none)');

-- ================================================================ 5. a failure in notifying cannot block the queue
create function t.boom() returns trigger language plpgsql as $$ begin raise exception 'notification store is broken'; end $$;
create trigger boom before insert on public.notifications for each row execute function t.boom();
select t.as_user(t.u(9));
select public.set_match_queue(t.m(1), 'in_the_hole');
select t.settle();
select t.as_admin();
select t.expect_eq('the queue moved even though notifying failed', (select queue_state from public.matches where id = t.m(1)), 'in_the_hole');
select t.expect_eq('... and nothing was half-written', t.cnt(t.u(2), 'fight_called', 'in_the_hole', 1), 1::bigint);
drop trigger boom on public.notifications;

-- ================================================================ 6. device subscriptions: secret, owned, validated
select t.as_user(t.u(1));
select t.expect_error('a signed-in user cannot read the subscription table', 'select * from public.push_subscriptions', '42501');
select t.expect_error('... nor write it', $$insert into public.push_subscriptions (user_id, endpoint, endpoint_digest, p256dh, auth) values ('00000000-0000-0000-0000-0000000000a1', 'https://push.example/x', 'x', 'x', 'x')$$, '42501');
select t.expect_error('... nor read preferences or deliveries directly', 'select * from public.notification_preferences', '42501');
select t.expect_error('... nor the server settings (private schema)', 'select * from private.push_config', '42501');
select t.expect_error('... nor read the notification table directly', 'select * from public.notifications', '42501');
select t.as_anon();
select t.expect_error('anonymous cannot register a device', $$select public.register_push_device('https://push.example/a', repeat('A', 87), repeat('B', 22), 'x')$$, '42501');
select t.expect_error('anonymous cannot read the subscription table', 'select * from public.push_subscriptions', '42501');
select t.expect_error('anonymous cannot read settings or the list', 'select public.my_notification_settings()', '42501');
select t.expect_ok('anonymous may read the public half of the key (the browser needs it)', 'select public.push_public_key()');
select t.as_user(t.u(1));
select t.expect_error('an http endpoint is refused', $$select public.register_push_device('http://push.example/a', repeat('A', 87), repeat('B', 22), 'x')$$, '22023');
select t.expect_error('badly formed keys are refused', $$select public.register_push_device('https://push.example/a', 'not-a-key', repeat('B', 22), 'x')$$, '22023');
select public.register_push_device('https://push.example/user1-phone', repeat('A', 87), repeat('B', 22), E'Pixel\nphone  ') as d1 \gset
select public.register_push_device('https://push.example/user1-laptop', repeat('C', 87), repeat('D', 22), 'Laptop') as d2 \gset
select t.expect_eq('a person can have several devices', (select count(*) from public.my_push_devices()), 2::bigint);
select t.expect_eq('the label is cleaned', (select label from public.my_push_devices() where id = (:'d1'::jsonb ->> 'id')::uuid), 'Pixelphone');
select t.expect_eq('the device list shape has no secrets', (select pg_get_function_result('public.my_push_devices()'::regprocedure)), 'TABLE(id uuid, label text, endpoint_digest text, created_at timestamp with time zone, last_success_at timestamp with time zone)');
select t.as_user(t.u(2));
select t.expect_eq('another user sees none of those devices', (select count(*) from public.my_push_devices()), 0::bigint);
select t.expect_eq('... and cannot remove them by id', public.remove_push_device((:'d1'::jsonb ->> 'id')::uuid, null), 0);
select t.expect_eq('... nor by endpoint', public.remove_push_device(null, 'https://push.example/user1-phone'), 0);
select t.as_user(t.u(1));
select t.expect_eq('the owner''s devices are untouched', (select count(*) from public.my_push_devices()), 2::bigint);
select t.expect_eq('the owner removes one', public.remove_push_device((:'d2'::jsonb ->> 'id')::uuid, null), 1);
select t.as_admin();
select t.expect_eq('a removed device is scrubbed: no endpoint, no keys left',
  (select row(endpoint, p256dh, auth, revoked_at is not null)::text from public.push_subscriptions where id = (:'d2'::jsonb ->> 'id')::uuid), '(revoked:' || (:'d2'::jsonb ->> 'id') || ',"","",t)');
select t.as_user(t.u(1));
select t.expect_eq('... and it no longer shows in the list', (select count(*) from public.my_push_devices()), 1::bigint);
-- the same browser installation signed in as someone else is ONE device with one owner at a time
select t.as_user(t.u(2));
select public.register_push_device('https://push.example/user1-phone', repeat('A', 87), repeat('B', 22), 'Shared tablet');
select t.expect_eq('a device that signs in as someone else moves to them', array[(select count(*) from public.my_push_devices()), 0::bigint], array[1::bigint, 0::bigint]);
select t.as_user(t.u(1));
select t.expect_eq('... and the previous account no longer has it (it cannot receive their alerts any more)', (select count(*) from public.my_push_devices()), 0::bigint);
-- device cap
select t.as_user(t.u(5));
do $$ begin for i in 1..10 loop perform public.register_push_device('https://push.example/u5-' || i, repeat('A', 87), repeat('B', 22), 'd' || i); end loop; end $$;
select t.expect_error('the eleventh device is refused with a clear message', $$select public.register_push_device('https://push.example/u5-11', repeat('A', 87), repeat('B', 22), 'd11')$$, '22023');

-- ================================================================ 7. preferences are the person's own
select t.as_user(t.u(1));
select t.expect_eq('settings default to everything on', public.my_notification_settings(), '{"team": true, "fights": true, "events": true, "system": true}'::jsonb);
select t.expect_eq('a person changes their own settings', public.set_notification_settings(false, true, true, true), '{"team": true, "fights": false, "events": true, "system": true}'::jsonb);
select t.as_user(t.u(2));
select t.expect_eq('... which no one else sees or shares', public.my_notification_settings(), '{"team": true, "fights": true, "events": true, "system": true}'::jsonb);
select t.as_anon();
select t.expect_error('anonymous cannot change settings', 'select public.set_notification_settings(false, false, false, false)', '42501');

-- ================================================================ 8. the dispatcher's doors: service role only
select t.as_user(t.u(1));
select t.expect_error('a user cannot claim pushes', 'select public.push_claim(10)', '42501');
select t.expect_error('a user cannot report deliveries', $$select public.push_report('[]'::jsonb)$$, '42501');
select t.expect_error('a user cannot read the dispatch secret or the private key', 'select public.push_dispatch_config()', '42501');
select t.expect_error('a user cannot store a key pair', $$select public.push_store_vapid(repeat('a', 90), repeat('b', 50))$$, '42501');
select t.as_anon();
select t.expect_error('anonymous cannot claim pushes', 'select public.push_claim(10)', '42501');
select t.expect_error('anonymous cannot read the dispatch config', 'select public.push_dispatch_config()', '42501');

-- the key pair is stored once; a second dispatcher cannot replace it
select t.as_service();
select t.expect_eq('the dispatch secret exists and is long', (select char_length(public.push_dispatch_config() ->> 'secret') >= 60), true);
select t.expect_eq('the first key pair is stored', public.push_store_vapid(repeat('p', 90), repeat('k', 50)), true);
select t.expect_eq('a second key pair is refused (it would orphan every device)', public.push_store_vapid(repeat('x', 90), repeat('y', 50)), false);
select t.expect_eq('the first pair survives', public.push_dispatch_config() ->> 'vapid_public', repeat('p', 90));
select t.as_anon();
select t.expect_eq('anyone may read only the public half', public.push_public_key(), repeat('p', 90));

-- ================================================================ 9. claim and report: preferences, device scoping, idempotence, expiry, retries, gone devices
select t.as_admin();
-- u5 has 10 devices, u1's only device moved to u2. u2: one device. A fresh, simple recipient set-up for the claim tests:
update public.notifications set push_state = 'done' where push_state = 'pending';       -- everything so far is closed; start clean
select t.as_user(t.u(1)); select public.register_push_device('https://push.example/user1-new', repeat('E', 87), repeat('F', 22), 'New phone');
select t.as_admin();
insert into public.notifications (user_id, kind, payload) values (t.u(1), 'test_push', '{}');                                                   -- system, u1 has a device
insert into public.notifications (user_id, kind, payload) values (t.u(1), 'fight_called', jsonb_build_object('match_id', t.m(1), 'stage', 'on_deck', 'field', 'Field 1', 'competition_name', 'Longsword', 'event_name', 'Event One', 'event_slug', 'e1'));   -- fights group switched OFF for u1
insert into public.notifications (user_id, kind, payload) values (t.u(3), 'test_push', '{}');                                                   -- u3 has no device
select t.expect_eq('three pending pushes were made', (select count(*) from public.notifications where push_state = 'pending'), 3::bigint);
select t.as_service();
select public.push_claim(50) as batch \gset
select t.as_admin();
select t.expect_eq('only the deliverable one is claimed: u1''s test on u1''s new device', jsonb_array_length(:'batch'::jsonb), 1);
select t.expect_eq('... for the right device', (:'batch'::jsonb -> 0 ->> 'endpoint'), 'https://push.example/user1-new');
select t.expect_eq('... with short lock-screen text and a safe route', ((:'batch'::jsonb -> 0 ->> 'title') || '|' || (:'batch'::jsonb -> 0 ->> 'route') || '|' || (:'batch'::jsonb -> 0 ->> 'category')), 'BuhurtOS test|/account|system');
select t.expect_eq('the dispatcher is handed exactly these fields (no names, no account ids, no health or contact data)',
  (select array_agg(k order by k) from jsonb_object_keys(:'batch'::jsonb -> 0) k), array['auth', 'body', 'category', 'endpoint', 'notification_id', 'p256dh', 'route', 'subscription_id', 'tag', 'title', 'ttl', 'urgent']);
select t.expect_eq('a group the person switched off is closed without sending, as is a person with no device', (select count(*) from public.notifications where push_state = 'pending'), 1::bigint);
select t.as_service();
select t.expect_eq('claiming again hands out nothing (the pair is already being sent)', jsonb_array_length(public.push_claim(50)), 0);
select public.push_report(jsonb_build_array(jsonb_build_object('notification_id', (:'batch'::jsonb -> 0 ->> 'notification_id'), 'subscription_id', (:'batch'::jsonb -> 0 ->> 'subscription_id'), 'outcome', 'retry', 'error', 'push service 503'))) as _r;
select t.expect_eq('a retry is handed out again', jsonb_array_length(public.push_claim(50)), 1);
select public.push_report(jsonb_build_array(jsonb_build_object('notification_id', (:'batch'::jsonb -> 0 ->> 'notification_id'), 'subscription_id', (:'batch'::jsonb -> 0 ->> 'subscription_id'), 'outcome', 'sent'))) as _r2;
select t.as_admin();
select t.expect_eq('once sent the notification is done', (select count(*) from public.notifications where push_state = 'pending'), 0::bigint);
select t.expect_eq('... and the device records its last success', (select last_success_at is not null from public.push_subscriptions where endpoint = 'https://push.example/user1-new'), true);

-- gone device (the push service says it no longer exists) is revoked at once
insert into public.notifications (user_id, kind, payload) values (t.u(1), 'test_push', '{}');
select t.as_service();
select public.push_claim(50) as batch2 \gset
select public.push_report(jsonb_build_array(jsonb_build_object('notification_id', (:'batch2'::jsonb -> 0 ->> 'notification_id'), 'subscription_id', (:'batch2'::jsonb -> 0 ->> 'subscription_id'), 'outcome', 'gone', 'error', 'HTTP 410'))) as _r3;
select t.as_admin();
select t.expect_eq('a gone device is revoked and scrubbed', (select row(revoked_at is not null, p256dh)::text from public.push_subscriptions where id = (:'batch2'::jsonb -> 0 ->> 'subscription_id')::uuid), '(t,"")');
select t.expect_eq('... and its notification is closed', (select count(*) from public.notifications where push_state = 'pending'), 0::bigint);

-- a fight alert that would arrive late is worth nothing: closed unsent
select t.as_user(t.u(1)); select public.register_push_device('https://push.example/user1-again', repeat('G', 87), repeat('H', 22), 'Again');
select public.set_notification_settings(true, true, true, true);
select t.as_admin();
insert into public.notifications (user_id, kind, payload, created_at) values (t.u(1), 'fight_called', jsonb_build_object('match_id', t.m(1), 'stage', 'on_deck', 'field', 'Field 1', 'competition_name', 'Longsword', 'event_name', 'Event One', 'event_slug', 'e1'), now() - interval '11 minutes');
select t.as_service();
select t.expect_eq('a fight alert 11 minutes old is not sent', jsonb_array_length(public.push_claim(50)), 0);
select t.as_admin();
select t.expect_eq('... it is closed, still readable in the app', array[(select push_state from public.notifications where user_id = t.u(1) and created_at < now() - interval '10 minutes'), (select count(*)::text from public.notifications where user_id = t.u(1) and created_at < now() - interval '10 minutes')], array['done', '1']);
insert into public.notifications (user_id, kind, payload) values (t.u(1), 'fight_called', jsonb_build_object('match_id', t.m(1), 'stage', 'on_deck', 'field', 'Field 1', 'competition_name', 'Longsword', 'event_name', 'Event One', 'event_slug', 'e1'));
select t.as_service();
select public.push_claim(50) as batch3 \gset
select t.expect_eq('a fresh fight alert is sent as urgent, short-lived, replacing the earlier alert for that fight', (:'batch3'::jsonb -> 0 ->> 'urgent') || '|' || (:'batch3'::jsonb -> 0 ->> 'ttl') || '|' || (:'batch3'::jsonb -> 0 ->> 'tag'), 'true|600|fight-' || t.m(1));
select t.as_admin();

-- ================================================================ 10. test notification: self only, rate limited
select t.as_user(t.u(2));
select t.expect_eq('a person can send themselves a test', (public.send_test_notification() ->> 'devices')::int, 1);
select t.expect_error('... but not in a burst', 'select public.send_test_notification()', '22023');
select t.as_anon();
select t.expect_error('anonymous cannot send tests', 'select public.send_test_notification()', '42501');

-- ================================================================ 11. the notification list (what the bell reads)
select t.as_user(t.u(1));
select t.expect_eq('the list carries ready-made text and a safe route', (select row(title, route)::text from public.my_notification_feed(200) where kind = 'test_push' limit 1), '("BuhurtOS test",/account)');
select t.expect_eq('a person reads only their own', t.foreign_in_feed(t.u(2)), 0::bigint);

-- ================================================================ 12. team and event notices
select t.as_actor(t.u(9));
insert into public.fighters (id, display_name, gender, disciplines) values ('00000000-0000-0000-0000-00000000f0a1', 'Newcomer Nine', 'male', '{}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'newcomer@example.test');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000b1');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000c001', 'fighter', current_date);
select t.as_admin();
select t.expect_eq('the captain hears a fighter joined', (select count(*) from public.notifications where user_id = t.u(8) and kind = 'team_member_joined' and payload ->> 'fighter_name' = 'Newcomer Nine'), 1::bigint);
select t.expect_eq('the fighter hears they were added (someone else did it)', t.cnt('00000000-0000-0000-0000-0000000000b1', 'team_member_added'), 1::bigint);
select t.expect_eq('the person who made the change is not told about their own action', t.cnt(t.u(9), 'team_member_joined'), 0::bigint);
select t.expect_eq('other team members are not told', array[t.cnt(t.u(5), 'team_member_joined'), t.cnt(t.u(6), 'team_member_joined')], array[0::bigint, 0::bigint]);
select t.expect_eq('team notices push, in the team group, to the team page', (select row(category, push, route)::text from public.notifications where user_id = t.u(8) and kind = 'team_member_joined'), '(team,t,/teams/team-t)');
-- bulk / system work (no signed-in actor) and coaches or mercenaries are silent
select t.as_admin();
insert into public.team_memberships (fighter_id, team_id, role, from_date) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000c001', 'fighter', current_date);
select t.expect_eq('a seed or import with no signed-in actor sends nothing', (select count(*) from public.notifications where user_id = t.u(8) and kind = 'team_member_joined'), 1::bigint);
select t.as_actor(t.u(9));
insert into public.team_memberships (fighter_id, team_id, role, mercenary, from_date) values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000c001', 'fighter', true, current_date);
insert into public.team_memberships (fighter_id, team_id, role, from_date) values ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-00000000c001', 'coach', current_date);
select t.as_admin();
select t.expect_eq('mercenaries and coaches are silent', (select count(*) from public.notifications where user_id = t.u(8) and kind = 'team_member_joined'), 1::bigint);
-- an event is cancelled: accepted people hear once
update public.events set status = 'cancelled' where id = '00000000-0000-0000-0000-00000000e101';
update public.events set status = 'published' where id = '00000000-0000-0000-0000-00000000e101';
update public.events set status = 'cancelled' where id = '00000000-0000-0000-0000-00000000e101';
select t.expect_eq('the accepted registrant hears the event was cancelled, once', t.cnt(t.u(3), 'event_cancelled'), 1::bigint);
select t.expect_eq('... in the events group, to the event page', (select row(category, route)::text from public.notifications where user_id = t.u(3) and kind = 'event_cancelled'), '(events,/events/e1)');
select t.expect_eq('others are not told', t.cnt(t.u(1), 'event_cancelled'), 0::bigint);
-- organizer firehose stays in the app
insert into public.notifications (user_id, kind, payload) values (t.u(9), 'registration_submitted', jsonb_build_object('event_slug', 'e1', 'event_name', 'Event One', 'person_name', 'Someone'));
insert into public.notifications (user_id, kind, payload) values (t.u(9), 'bug_reported', jsonb_build_object('what', 'x'));
select t.expect_eq('sign-up and bug-report notices are for the app only', (select count(*) from public.notifications where user_id = t.u(9) and push), 0::bigint);
select t.expect_eq('legacy kinds get a group and a route without any change to their producers', (select row(category, route)::text from public.notifications where user_id = t.u(9) and kind = 'registration_submitted'), '(events,/events/e1/manage)');
insert into public.notifications (user_id, kind, payload) values (t.u(4), 'registration_decided', jsonb_build_object('event_slug', 'fake-e2-test', 'event_name', 'Fictional Event', 'decision', 'accepted'));
select t.expect_eq('a registration decision for a fictional event does not push either', (select push from public.notifications where user_id = t.u(4) and kind = 'registration_decided'), false);
insert into public.notifications (user_id, kind, payload) values (t.u(4), 'registration_decided', jsonb_build_object('event_slug', 'e1', 'event_name', 'Event One', 'decision', 'accepted'));
select t.expect_eq('a real one does', (select count(*) from public.notifications where user_id = t.u(4) and kind = 'registration_decided' and push), 1::bigint);

-- ================================================================ 13. a user never sees another's notification text in the list; deleting an account cleans its devices
select t.as_admin();
select t.expect_eq('device rows follow the account (cascade) so nothing is left to deliver to', (select count(*) from information_schema.referential_constraints rc join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name where tc.table_name = 'push_subscriptions' and rc.delete_rule = 'CASCADE'), 1::bigint);

-- ================================================================ 14. gender decides which categories a registration can enter
-- (registrations: u3 is male. Competitions here: Longsword and Men 5v5 are men's; add a women's and an open one.)
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  ('00000000-0000-0000-0000-00000000b104', '00000000-0000-0000-0000-00000000e101', 'Women Longsword', 'longsword', 'women', 'Classic', 'round_robin', 3),
  ('00000000-0000-0000-0000-00000000b105', '00000000-0000-0000-0000-00000000e101', 'Open Longsword', 'longsword', 'open', 'Classic', 'round_robin', 4);
insert into public.registrations (id, event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name) values
  ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000e101', t.u(5), 'pending', 'Person Five', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Person Five'),
  ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-00000000e101', t.u(6), 'pending', 'Person Six', 'other', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Person Six');
select t.expect_error('a man cannot enter a women''s category', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000b104')$$, '22023');
select t.expect_ok('a man can enter an open category', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000b105')$$);
select t.expect_error('a woman cannot enter a men''s category', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000b101')$$, '22023');
select t.expect_ok('a woman can enter a women''s category', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000b104')$$);
select t.expect_ok('a person who chose Other can enter a men''s category', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-00000000b101')$$);
select t.expect_ok('... and a women''s one', $$insert into public.registration_competitions (registration_id, competition_id) values ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-00000000b104')$$);

select 'PACK12 GATE PASSED ' || count(*) || ' checks' from t.log;
rollback;
