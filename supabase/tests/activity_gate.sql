-- (Inside one transaction now() does not move, so pages opened together tie on time; orders are checked as sets.)
-- Checks for usage activity (owner only) and bug reports (anyone may send, owner reads). LOCAL THROWAWAY DATABASE ONLY; rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/activity_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);

create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;

-- expect_ok / expect_error run a statement and compare the outcome. SQLSTATE can be left null to accept any error.
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
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;



insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c001', 'owner@example.test'),
  ('00000000-0000-0000-0000-00000000c002', 'user@example.test'),
  ('00000000-0000-0000-0000-00000000c003', 'other@example.test'),
  ('00000000-0000-0000-0000-00000000c004', 'fighter@example.test'),
  ('00000000-0000-0000-0000-00000000c005', 'captain@example.test'),
  ('00000000-0000-0000-0000-00000000c006', 'organizer@example.test'),
  ('00000000-0000-0000-0000-00000000c007', 'orgadmin@example.test'),
  ('00000000-0000-0000-0000-00000000c008', 'marshal@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-00000000c001', 'owner'), ('00000000-0000-0000-0000-00000000c006', 'organizer');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-00000000cb01', 'league-a', 'League A', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000c007', 'admin');
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000cc01', 'bears', 'Bears', 'approved', 'Red Deer', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000c005', 'captain');
insert into public.fighters (id, display_name, team_id) values ('00000000-0000-0000-0000-00000000cd01', 'Fighter One', '00000000-0000-0000-0000-00000000cc01');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000c004');
insert into public.events (id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000ce01', 'rumble', 'Rumble', current_date + 30, current_date + 31);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-00000000c008', 'organizer');
grant select, insert on storage.objects to anon;
create table t.counts as select (select count(*) from public.profiles) as profiles, (select count(*) from public.fighters) as fighters,
  (select count(*) from public.fighter_accounts) as fighter_accounts, (select count(*) from auth.users) as users;
grant select on t.counts to anon, authenticated;

-- ---------------------------------------------------------------- activity: anyone may record, nobody but the owner may read
select t.as_anon();
select t.expect_ok('a visitor records a visit', $q$select public.track_activity('00000000-0000-0000-0000-00000000d001', '/events?x=secret#top', 'phone',
  '{"visitor_id":"00000000-0000-0000-0000-00000000f001","new_visitor":true,"referrer_host":"Google.com","utm_source":"discord","browser":"Safari","os":"iOS","time_zone":"America/Edmonton","language":"en-CA"}')$q$);
select t.expect_ok('... opens a team page', $q$select public.track_activity('00000000-0000-0000-0000-00000000d001', '/teams/bears', 'phone')$q$);
select t.expect_ok('... and records a search (no session id needed to be valid)', $q$select public.track_event('00000000-0000-0000-0000-00000000d001', 'search', '{"query":"Bears","where":"teams"}')$q$);
select t.expect_ok('a bad event name is dropped quietly', $q$select public.track_event('00000000-0000-0000-0000-00000000d001', 'DROP TABLE x', '{}')$q$);
select t.expect_ok('oversized event properties are replaced with nothing', $q$select public.track_event('00000000-0000-0000-0000-00000000d001', 'big_one', jsonb_build_object('x', repeat('a', 5000)))$q$);
select t.as_admin();
select t.expect_eq('browsing created no profile, fighter or account', (select (profiles, fighters, fighter_accounts, users)::text from t.counts),
  (select ((select count(*) from public.profiles), (select count(*) from public.fighters), (select count(*) from public.fighter_accounts), (select count(*) from auth.users))::text));
select t.as_anon();
select t.expect_error('a visitor cannot read activity tables', 'select * from public.activity_sessions', '42501');
select t.expect_error('a visitor cannot read events', 'select * from public.activity_events', '42501');
select t.expect_error('a visitor cannot write the tables directly', $q$insert into public.activity_events (name) values ('fake')$q$, '42501');
select t.expect_error('a visitor cannot read activity', 'select * from public.admin_activity(24)', '42501');
select t.expect_error('a visitor cannot read analytics', $q$select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute')$q$, '42501');
select t.expect_error('a visitor cannot read per-user usage', $q$select * from public.admin_user_activity(now() - interval '1 day', now() + interval '1 minute')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000c002');
select t.expect_ok('a signed-in person records a visit', $q$select public.track_activity('00000000-0000-0000-0000-00000000d002', '/teams', 'desktop', '{"visitor_id":"00000000-0000-0000-0000-00000000f002","new_visitor":false}')$q$);
select t.expect_ok('... moves to another page', $q$select public.track_activity('00000000-0000-0000-0000-00000000d002', '/teams/bears', 'desktop')$q$);
select t.expect_ok('... a heartbeat on the same page is accepted quietly', $q$select public.track_activity('00000000-0000-0000-0000-00000000d002', '/teams/bears', 'desktop')$q$);
select t.expect_ok('... logs in (event)', $q$select public.track_event('00000000-0000-0000-0000-00000000d002', 'login', '{"method":"code"}')$q$);
select t.as_user('00000000-0000-0000-0000-00000000c003');
select t.expect_ok('someone else writing into that visit is ignored, not an error', $q$select public.track_activity('00000000-0000-0000-0000-00000000d002', '/hijack', 'phone')$q$);

-- Every role except the platform owner is refused, at the database, whatever the app shows.
select t.as_user(u), t.expect_error('analytics refused for ' || n, $q$select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute')$q$, '42501'),
  t.expect_error('per-user usage refused for ' || n, $q$select * from public.admin_user_activity(now() - interval '1 day', now() + interval '1 minute')$q$, '42501'),
  t.expect_error('visit list refused for ' || n, 'select * from public.admin_activity(24)', '42501'),
  t.expect_error('visit trail refused for ' || n, $q$select * from public.admin_session_views('00000000-0000-0000-0000-00000000d002')$q$, '42501'),
  t.expect_error('raw sessions refused for ' || n, 'select * from public.activity_sessions', '42501')
from (values ('00000000-0000-0000-0000-00000000c002'::uuid, 'a normal account'), ('00000000-0000-0000-0000-00000000c004', 'a fighter'),
             ('00000000-0000-0000-0000-00000000c005', 'a captain'), ('00000000-0000-0000-0000-00000000c006', 'a platform organizer'),
             ('00000000-0000-0000-0000-00000000c007', 'an organization admin'), ('00000000-0000-0000-0000-00000000c008', 'an event organizer')) r(u, n);

select t.as_user('00000000-0000-0000-0000-00000000c001');
select t.expect_eq('owner sees both visits', (select count(*) from public.admin_activity(24)), 2::bigint);
select t.expect_eq('... the query string and anchor are not kept', (select path from public.admin_activity(24) where session_id = '00000000-0000-0000-0000-00000000d001'), '/teams/bears');
select t.expect_eq('... the signed-in visit is named, on its last page, 2 pages, online', (select (email, path, page_count, online) from public.admin_activity(24) where session_id = '00000000-0000-0000-0000-00000000d002')::text, '(user@example.test,/teams/bears,2,t)');
select t.expect_eq('... the timeline lists both pages in order', (select string_agg(path, ' > ' order by at) from public.admin_session_views('00000000-0000-0000-0000-00000000d002')), '/teams > /teams/bears');
create temp table a as select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute') as j;
select t.expect_eq('analytics: 2 visitors, 1 new, 1 returning, 2 visits, 1 anonymous, 1 signed-in person',
  (select (j->'totals'->>'visitors') || ',' || (j->'totals'->>'new_visitors') || ',' || (j->'totals'->>'returning_visitors') || ',' || (j->'totals'->>'sessions') || ',' || (j->'totals'->>'anonymous_sessions') || ',' || (j->'totals'->>'registered_people') from a), '2,1,1,2,1,1');
select t.expect_eq('... 4 page views, 1 login', (select (j->'totals'->>'page_views') || ',' || (j->'totals'->>'logins') from a), '4,1');
select t.expect_eq('... top page is /teams/bears with 2 visits', (select (j->'pages'->0->>'path') || ' ' || (j->'pages'->0->>'visits') from a), '/teams/bears 2');
select t.expect_eq('... entry page kept without the query string', (select count(*) from a, jsonb_array_elements(j->'entry_pages') e where e->>'path' = '/events'), 1::bigint);
select t.expect_eq('... path /events -> /teams/bears counted', (select count(*) from a, jsonb_array_elements(j->'paths') e where e->>'from_path' = '/events' and e->>'to_path' = '/teams/bears'), 1::bigint);
select t.expect_eq('... referrer host lower-cased and time zone kept; campaign values (utm) are NOT stored', (select (j->'referrers'->0->>'source') || ',' || jsonb_array_length(j->'utm_sources') || ',' || (select string_agg(e->>'name', '/' order by e->>'name') from jsonb_array_elements(j->'time_zones') e) from a), 'google.com,0,America/Edmonton/unknown');
select t.expect_eq('... search boxes counted by page (not by word), bad event names dropped', (select (j->'searches'->0->>'where') || ',' || (select count(*) from jsonb_array_elements(j->'events') e where e->>'name' not in ('search', 'login', 'big_one')) from a), 'teams,0');
select t.as_admin();
select t.expect_eq('... oversized properties were emptied', (select props::text from public.activity_events e where e.name = 'big_one'), '{}');
select t.as_user('00000000-0000-0000-0000-00000000c001');
select t.expect_eq('analytics: the anonymous filter keeps only the visitor', (select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute', 'anonymous')->'totals'->>'sessions'), '1');
select t.expect_eq('analytics: the device filter keeps only desktop', (select public.admin_analytics(now() - interval '1 day', now() + interval '1 minute', 'all', 'desktop')->'totals'->>'registered_people'), '1');
select t.expect_eq('analytics: an empty range has no visits', (select public.admin_analytics(now() - interval '10 days', now() - interval '9 days')->'totals'->>'sessions'), '0');
select t.expect_eq('per-user usage: one person, 2 pages, last pages listed, login shown', (select email || ',' || page_views || ',' || (select string_agg(x, '>' order by x) from unnest(recent_pages) x) || ',' || array_to_string(recent_events, '>') from public.admin_user_activity(now() - interval '1 day', now() + interval '1 minute')), 'user@example.test,2,/teams>/teams/bears,login');

-- ---------------------------------------------------------------- bug reports
select t.as_anon();
select t.expect_error('an empty report is refused', $q$select public.report_bug('{"what":"   "}')$q$, '22023');
select t.expect_ok('a visitor reports a bug', $q$select public.report_bug('{"what":"The save button does nothing","expected":"It saves","path":"/teams/bears/edit?x=1","session_id":"00000000-0000-0000-0000-00000000d001","app_version":"v0.1.0","screen":"390x844","screenshot_path":"reports/00000000-0000-0000-0000-00000000e001.jpg"}')$q$);
select t.expect_ok('a visitor uploads a screenshot into reports/', $q$insert into storage.objects (bucket_id, name) values ('bug-screenshots', 'reports/00000000-0000-0000-0000-00000000e001.jpg')$q$);
select t.expect_error('but not anywhere else in that bucket', $q$insert into storage.objects (bucket_id, name) values ('bug-screenshots', 'other/x.jpg')$q$);
select t.expect_eq('a visitor cannot read screenshots', (select count(*) from storage.objects where bucket_id = 'bug-screenshots'), 0::bigint);
select t.expect_error('a visitor cannot read reports', 'select * from public.admin_bug_reports()', '42501');
select t.expect_ok('a bad screenshot path is dropped, not trusted', $q$select public.report_bug('{"what":"Second report here","session_id":"00000000-0000-0000-0000-00000000d001","screenshot_path":"../../etc/passwd"}')$q$);
select t.as_user('00000000-0000-0000-0000-00000000c002');
select t.expect_error('a signed-in person cannot read reports', 'select * from public.admin_bug_reports()', '42501');
select t.expect_error('or change their status', $q$select public.set_bug_status(gen_random_uuid(), 'fixed')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000c001');
select t.expect_eq('owner reads both reports', (select count(*) from public.admin_bug_reports()), 2::bigint);
select t.expect_eq('... page kept without the query string, screenshot kept only when valid', (select string_agg(coalesce(path, '-') || '|' || coalesce(screenshot_path, '-'), ',' order by created_at, what) from public.admin_bug_reports()), '|-,/teams/bears/edit|reports/00000000-0000-0000-0000-00000000e001.jpg');
select t.expect_eq('owner can see the screenshot', (select count(*) from storage.objects where bucket_id = 'bug-screenshots'), 1::bigint);
select t.expect_eq('owner was notified twice', (select count(*) from public.my_notifications(50) where kind = 'bug_reported'), 2::bigint);
select t.expect_ok('owner marks one fixed', $q$select public.set_bug_status((select id from public.admin_bug_reports() order by created_at limit 1), 'fixed')$q$);
select t.expect_eq('... and can filter by status', (select count(*) from public.admin_bug_reports('fixed')), 1::bigint);
select t.as_anon();
select t.expect_ok('reports 3 to 10 in an hour are fine', $q$select count(public.report_bug(jsonb_build_object('what', 'Report number ' || g, 'session_id', '00000000-0000-0000-0000-00000000d001'))) from generate_series(3, 10) g$q$);
select t.expect_error('the 11th in an hour from one visit is refused', $q$select public.report_bug('{"what":"One more report","session_id":"00000000-0000-0000-0000-00000000d001"}')$q$, 'P0001');

select t.as_admin();

-- ---------------------------------------------------------------- analytics privacy (migration 20261001003100)
select t.as_admin();
select t.expect_eq('what people type is never stored: a stale browser sending a search "query" has it dropped', (select count(*) from public.activity_events where name = 'search' and props ? 'query'), 0::bigint);
select t.expect_eq('... the search is still counted with its page', (select props ->> 'where' from public.activity_events where name = 'search'), 'teams');
select t.expect_eq('campaign values and browser language are not stored even when an old browser sends them', (select count(*) from public.activity_sessions where utm_source is not null or language is not null), 0::bigint);
select t.expect_eq('the other visit details are still kept (referrer, browser, system, time zone)', (select referrer_host || ',' || browser || ',' || os || ',' || time_zone from public.activity_sessions where id = '00000000-0000-0000-0000-00000000d001'), 'google.com,Safari,iOS,America/Edmonton');
select t.as_anon();
select t.expect_error('a visitor cannot run the purge', $q$select private.purge_activity()$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000c002');
select t.expect_error('a signed-in person cannot run the purge', $q$select private.purge_activity()$q$, '42501');
select t.as_admin();
insert into public.activity_sessions (id, last_seen_at, path) values ('00000000-0000-0000-0000-00000000d0aa', now() - interval '91 days', '/'), ('00000000-0000-0000-0000-00000000d0ab', now() - interval '89 days', '/');
insert into public.activity_views (session_id, path, at) values ('00000000-0000-0000-0000-00000000d0aa', '/', now() - interval '91 days'), ('00000000-0000-0000-0000-00000000d0ab', '/', now() - interval '89 days');
insert into public.activity_events (session_id, name, at) values (null, 'old_action', now() - interval '91 days'), (null, 'recent_action', now() - interval '89 days');
select private.purge_activity();
select t.expect_eq('purge: a visit last seen 91 days ago is gone, with its page views', (select count(*) from public.activity_sessions where id = '00000000-0000-0000-0000-00000000d0aa') + (select count(*) from public.activity_views where session_id = '00000000-0000-0000-0000-00000000d0aa'), 0::bigint);
select t.expect_eq('purge: a visit seen 89 days ago is kept, with its page views', (select count(*) from public.activity_sessions where id = '00000000-0000-0000-0000-00000000d0ab') + (select count(*) from public.activity_views where session_id = '00000000-0000-0000-0000-00000000d0ab'), 2::bigint);
select t.expect_eq('purge: actions older than 90 days are gone, newer ones kept', (select string_agg(name, ',' order by name) from public.activity_events where name in ('old_action', 'recent_action')), 'recent_action');

select t.expect_eq('every table in public has row level security on', (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity), 0::bigint);
select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
