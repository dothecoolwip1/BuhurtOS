-- Pack 26 gate (full Rumble rehearsal, 2026-10-07): the server-side fixes of the pack, each tested as allowed and denied.
--   2. The alert text says Lyst N for the stored Field N, like every screen (private.field_label).
--   1. "Send me a test" always pushes: a test push is claimed even when the person switched the BuhurtOS category off (migration 20261021000100);
--      an ordinary notification of that category is still held back by the switch.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack26_gate.sql
-- Soft mode (negative control against a schema without the migration):  PGOPTIONS="-c t.soft=on" psql -d <db> -f supabase/tests/pack26_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create table t.fails (n serial, name text, why text);
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.as_service() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role service_role; end $$;
create function t.bad(label text, why text) returns void language plpgsql as $$
begin
  if coalesce(current_setting('t.soft', true), '') = 'on' then insert into t.fails (name, why) values (label, why); else raise exception 'FAIL (%): %', why, label; end if;
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then perform t.bad(label, coalesce(got::text, 'null') || ' <> ' || coalesce(want::text, 'null')); return; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then perform t.bad(label, 'expected an error'); return; end if;
  if state is not null and got <> state then perform t.bad(label, 'wrong error ' || got || ' instead of ' || state); return; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log, t.fails to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures: one person with a phone, the BuhurtOS category switched off
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000026a1', 'p26-quiet@example.test'), ('00000000-0000-0000-0000-0000000026a2', 'p26-other@example.test');
select t.as_user('00000000-0000-0000-0000-0000000026a1');
select public.register_push_device('https://push.example/p26-quiet', repeat('E', 87), repeat('F', 22), 'Quiet phone');
select t.expect_eq('the person switches the BuhurtOS category off (fights, team and events stay on)', public.set_notification_settings(true, true, true, false) ->> 'system', 'false');

-- ================================================================ 1. the test push is claimed whatever the preferences say; an ordinary BuhurtOS notification is not
select t.as_admin();
update public.notifications set push_state = 'done' where push_state = 'pending';
insert into public.notifications (user_id, kind, payload) values ('00000000-0000-0000-0000-0000000026a1', 'test_push', '{}');
insert into public.notifications (user_id, kind, payload) values ('00000000-0000-0000-0000-0000000026a1', 'fighter_claim_decided', jsonb_build_object('decision', 'approved', 'fighter_id', gen_random_uuid()));
select t.expect_eq('two pushes are pending: the test and an ordinary BuhurtOS one', (select count(*) from public.notifications where push_state = 'pending' and user_id = '00000000-0000-0000-0000-0000000026a1'), 2::bigint);
select t.as_service();
select public.push_claim(50) as batch \gset
select t.as_admin();
select t.expect_eq('exactly one push is handed out: the test the person asked for', jsonb_array_length(:'batch'::jsonb), 1);
select t.expect_eq('... and it is the test push, to that phone', ((:'batch'::jsonb -> 0 ->> 'title') || '|' || (:'batch'::jsonb -> 0 ->> 'endpoint')), 'BuhurtOS test|https://push.example/p26-quiet');
select t.expect_eq('the ordinary BuhurtOS notification was closed without sending (the switch still works)', (select push_state from public.notifications where user_id = '00000000-0000-0000-0000-0000000026a1' and kind = 'fighter_claim_decided'), 'done');
select t.expect_eq('the test push is being sent', (select count(*) from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.kind = 'test_push' and n.user_id = '00000000-0000-0000-0000-0000000026a1' and d.state = 'sending'), 1::bigint);

-- the person without a phone: nothing to hand out, nothing leaks
select t.as_admin();
insert into public.notifications (user_id, kind, payload) values ('00000000-0000-0000-0000-0000000026a2', 'test_push', '{}');
select t.as_service();
select t.expect_eq('a test push for someone with no phone is simply closed', jsonb_array_length(public.push_claim(50)), 0);
select t.as_admin();
select t.expect_eq('... as done', (select push_state from public.notifications where user_id = '00000000-0000-0000-0000-0000000026a2' and kind = 'test_push'), 'done');
-- who may claim at all is unchanged
select t.as_user('00000000-0000-0000-0000-0000000026a1');
select t.expect_error('a signed-in person still cannot claim pushes', 'select public.push_claim(10)', '42501');
select t.as_admin();

-- ================================================================ 2. the word for a field in an alert is Lyst (private.field_label, notification_text)
select t.as_admin();
select t.expect_eq('the stored default Field 1 reads Lyst 1', private.field_label('Field 1'), 'Lyst 1');
select t.expect_eq('a blank field is the default: Lyst 1', private.field_label(null), 'Lyst 1');
select t.expect_eq('a bare number someone typed reads Lyst 10', private.field_label('10'), 'Lyst 10');
select t.expect_eq('a lowercase key reads Lyst 2', private.field_label('field 2'), 'Lyst 2');
select t.expect_eq('a custom name is kept as written', private.field_label('Arena A'), 'Arena A');
select t.expect_eq('an alert says Lyst, like the screens', (select body from private.notification_text('fight_called', '{"stage": "active", "field": "Field 2"}'::jsonb)), 'Report to Lyst 2 now.');
select t.expect_eq('... and a custom name stays the organizer''s word', (select body from private.notification_text('fight_called', '{"stage": "on_deck", "field": "Arena A"}'::jsonb)), 'Report to Arena A and be ready to fight.');
select t.expect_eq('a moved fight says Lyst too', (select title from private.notification_text('fight_moved', '{"stage": "field", "field": "Field 1"}'::jsonb)), 'Your fight changed Lyst');
select t.as_user('00000000-0000-0000-0000-0000000026a1');
select t.expect_error('the label helper is private', 'select private.field_label(''Field 1'')', '42501');
select t.as_admin();

-- ================================================================ result
do $$
declare n int; f int;
begin
  select count(*) into n from t.log; select count(*) into f from t.fails;
  if f > 0 then raise notice 'PACK26 GATE: % FAIL (soft mode)', f; else raise notice 'PACK26 GATE PASSED % checks', n; end if;
end $$;
select name, why from t.fails;
rollback;
