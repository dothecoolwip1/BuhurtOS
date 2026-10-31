-- Analytics testing gate: visits by the owner, the test crew or an excluded account, and every visit from a browser once signed in as one,
-- are kept but left out of the owner's Analytics reads; real visitors still count. Rolled back.
\set ON_ERROR_STOP on
begin;
create temp table log (n serial, msg text);
create function pg_temp.ok(p boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(p, false) then raise exception 'FAIL: %', msg; end if; insert into log (msg) values (msg); end $$;
create function pg_temp.visit(u uuid, s uuid, v uuid, path text) returns void language plpgsql as $$
begin
  reset role; perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  if u is null then set local role anon; else set local role authenticated; end if;
  perform public.track_activity(s, path, 'phone', jsonb_build_object('visitor_id', v, 'new_visitor', true));
  reset role;
end $$;
do $$ begin execute format('grant usage on schema %s to public', pg_my_temp_schema()::regnamespace); end $$;
grant execute on function pg_temp.visit(uuid, uuid, uuid, text) to public;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'owner@example.test'), ('00000000-0000-0000-0000-00000000a002', 'crew@example.test'),
  ('00000000-0000-0000-0000-00000000a003', 'fan@example.test'), ('00000000-0000-0000-0000-00000000a004', 'extra@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-00000000a001', 'owner');
insert into private.test_event_crew (user_id, role) values ('00000000-0000-0000-0000-00000000a002', 'scorekeeper');
insert into private.analytics_excluded_accounts (user_id, note) values ('00000000-0000-0000-0000-00000000a004', 'gate');

-- a rehearsal browser: signed out first, then signs in as the crew account; both visits are testing
select pg_temp.visit(null, '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000f0001', '/events');
select pg_temp.ok(not (select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0001'), 'an unknown signed-out visit counts at first');
select pg_temp.visit('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000f0001', '/events/x');
select pg_temp.ok((select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0001'), 'signing in as the test crew marks the visit as testing');
select pg_temp.visit(null, '00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-0000000f0001', '/teams');
select pg_temp.ok((select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0002'), 'a later signed-out visit from that browser is testing');
select pg_temp.visit(null, '00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-0000000f0003', '/');
select pg_temp.visit('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-0000000b0004', '00000000-0000-0000-0000-0000000f0003', '/rules');
select pg_temp.ok((select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0003'), 'an earlier signed-out visit is marked once its browser signs in as an excluded account');

-- the owner and a real fan
select pg_temp.visit('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000b0005', '00000000-0000-0000-0000-0000000f0005', '/platform');
select pg_temp.visit('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000b0006', '00000000-0000-0000-0000-0000000f0006', '/fighters');
select pg_temp.visit(null, '00000000-0000-0000-0000-0000000b0007', '00000000-0000-0000-0000-0000000f0007', '/');
select pg_temp.ok((select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0005'), 'the owner''s own visit is testing');
select pg_temp.ok(not (select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0006') and not (select internal from public.activity_sessions where id = '00000000-0000-0000-0000-0000000b0007'), 'real visitors still count');

-- product actions by a testing account are left out too
insert into public.activity_events (session_id, user_id, name) values (null, '00000000-0000-0000-0000-00000000a002', 'sign_up'), (null, '00000000-0000-0000-0000-00000000a003', 'sign_up');

-- what the owner reads
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
create temp table a as select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute') j;
select pg_temp.ok(((select j from a) -> 'totals' ->> 'visitors')::int = 2, 'Analytics counts only the two real visitors');
select pg_temp.ok(((select j from a) -> 'totals' ->> 'testing_hidden')::int = 5, 'and says how many testing visits it left out');
select pg_temp.ok(not exists (select 1 from public.admin_activity(24) x where x.session_id::text like '00000000-0000-0000-0000-0000000b000_' and x.session_id not in ('00000000-0000-0000-0000-0000000b0006', '00000000-0000-0000-0000-0000000b0007')), 'the visit list leaves testing out');
select pg_temp.ok((select count(*) from public.admin_user_activity(now() - interval '1 day', now() + interval '1 minute')) = 1, 'per-person usage shows only the real signed-in fan');
select pg_temp.ok((select count(*) from public.activity_sessions where internal) = 5, 'testing visits are kept, not deleted');
select pg_temp.ok(not has_table_privilege('authenticated', 'private.analytics_excluded_accounts', 'select'), 'the excluded list is not reachable from the app');

do $$ begin raise notice 'ANALYTICS TESTING GATE PASSED % checks', (select count(*) from log); end $$;
rollback;
