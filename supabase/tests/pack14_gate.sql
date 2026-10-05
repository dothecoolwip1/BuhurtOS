-- Pack 14 gate: broadcast settings, sponsors and sponsor-logo storage (migration 20261008000100).
--   * presentation data is PUBLIC to read for a public event (and only then, organization boundary included), and writable ONLY by the event's organizers through functions
--   * nobody else (anonymous, fighter, scorekeeper, marshal, head marshal, medic, another event's organizer) can change anything, directly or through a function
--   * stream addresses are an allow-list (https; YouTube / Twitch / Vimeo); a look-alike host or a script address is refused
--   * sponsor logos live in the event's own folder; another event's organizer cannot write there
--   * broadcasting touches no sporting state: no table of Pack 13 / matches / queue / notifications changes
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack14_gate.sql
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
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- users: 90 organizer of event 1, 89 head marshal, 88 scorekeeper, 87 marshal, 85 medic, 70 organizer of event 2, 60 fighter, 50 stranger, 71 organizer of the org-disabled event
insert into auth.users (id, email) select t.u(n), 'u' || n || '@example.test' from generate_series(1, 99) n;
insert into public.organizations (id, slug, name, kind, enabled, disabled_at) values ('00000000-0000-0000-0000-00000000cb01', 'off-org', 'Disabled Org', 'regional', false, now());
insert into public.events (id, slug, name, status, starts_on, ends_on, organization_id) values
  ('00000000-0000-0000-0000-00000000e101', 'cast-cup', 'Cast Cup', 'published', current_date, current_date, null),
  ('00000000-0000-0000-0000-00000000e102', 'other-cup', 'Other Cup', 'published', current_date, current_date, null),
  ('00000000-0000-0000-0000-00000000e103', 'draft-cup', 'Draft Cup', 'draft', current_date, current_date, null),
  ('00000000-0000-0000-0000-00000000e104', 'org-off-cup', 'Org Off Cup', 'published', current_date, current_date, '00000000-0000-0000-0000-00000000cb01');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', t.u(90), 'organizer'), ('00000000-0000-0000-0000-00000000e101', t.u(89), 'head_marshal'), ('00000000-0000-0000-0000-00000000e101', t.u(88), 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e101', t.u(87), 'marshal'), ('00000000-0000-0000-0000-00000000e101', t.u(85), 'medic'),
  ('00000000-0000-0000-0000-00000000e102', t.u(70), 'organizer'), ('00000000-0000-0000-0000-00000000e103', t.u(90), 'organizer'), ('00000000-0000-0000-0000-00000000e104', t.u(71), 'organizer');
create function t.e1() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e101'::uuid $$;
create function t.e2() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e102'::uuid $$;
create function t.e3() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e103'::uuid $$;
create function t.e4() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e104'::uuid $$;
grant execute on all functions in schema t to anon, authenticated, service_role;
create function t.sets(ev uuid, j text) returns text language sql as $$ select public.set_broadcast_settings(ev, j::jsonb)::text $$;
create function t.sponsor(ev uuid, nm text, logo text default null, link text default null, tier text default 'partner') returns text language sql as $$ select public.save_event_sponsor(ev, null, nm, logo, link, tier, 0, true)::text $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- snapshot of the sporting state: broadcasting must not change any of it
create function t.sporting() returns text language sql security definer as $$
  select (select count(*) from public.matches) || ':' || (select count(*) from public.lyst_timer) || ':' || (select count(*) from public.lyst_rounds) || ':' || (select count(*) from public.match_discipline)
    || ':' || (select count(*) from public.notifications) || ':' || (select count(*) from public.result_proposals) $$;
grant execute on all functions in schema t to anon, authenticated, service_role;
select t.sporting() as sp0 \gset

-- ================================================================ 1. nobody but an organizer of THIS event changes anything
select t.as_anon();
select t.expect_error('anonymous cannot change broadcast settings', format($$select t.sets(%L, '{"corners":"team_colors"}')$$, t.e1()), '42501');
select t.expect_error('anonymous cannot add a sponsor', format($$select t.sponsor(%L, 'Evil Co')$$, t.e1()), '42501');
select t.expect_error('anonymous cannot remove a sponsor', $$select public.remove_event_sponsor(gen_random_uuid())$$, '42501');
select t.as_user(t.u(60));
select t.expect_error('a fighter cannot change broadcast settings', format($$select t.sets(%L, '{"show_sponsors":false}')$$, t.e1()), '42501');
select t.as_user(t.u(50));
select t.expect_error('a stranger cannot add a sponsor', format($$select t.sponsor(%L, 'Evil Co')$$, t.e1()), '42501');
select t.as_user(t.u(88));
select t.expect_error('a scorekeeper cannot change broadcast settings (the broadcast follows the lyst, nobody operates it)', format($$select t.sets(%L, '{"corners":"team_colors"}')$$, t.e1()), '42501');
select t.as_user(t.u(87));
select t.expect_error('a marshal cannot add a sponsor', format($$select t.sponsor(%L, 'Evil Co')$$, t.e1()), '42501');
select t.as_user(t.u(89));
select t.expect_error('a head marshal cannot change broadcast settings', format($$select t.sets(%L, '{"corners":"team_colors"}')$$, t.e1()), '42501');
select t.as_user(t.u(85));
select t.expect_error('a medic cannot add a sponsor', format($$select t.sponsor(%L, 'Evil Co')$$, t.e1()), '42501');
select t.as_user(t.u(70));
select t.expect_error('another event''s organizer cannot change this event''s broadcast settings', format($$select t.sets(%L, '{"corners":"team_colors"}')$$, t.e1()), '42501');
select t.expect_error('... nor add its sponsors', format($$select t.sponsor(%L, 'Evil Co')$$, t.e1()), '42501');
select t.as_user(t.u(90));
select t.expect_error('direct table writes are not granted to anyone: settings', format($$insert into public.event_broadcast (event_id, stream_url) values (%L, 'https://youtube.com/x')$$, t.e1()), '42501');
select t.expect_error('... sponsors', format($$insert into public.event_sponsors (event_id, name) values (%L, 'Direct Co')$$, t.e1()), '42501');
select t.expect_error('... and not even an organizer updates a sponsor table directly', $$update public.event_sponsors set name = 'x'$$, '42501');

-- ================================================================ 2. the organizer: settings are validated
select t.as_user(t.u(90));
select t.expect_ok('the organizer sets a YouTube stream and the red/blue corners', format($$select t.sets(%L, '{"stream_url":"https://www.youtube.com/watch?v=abcdefghijk","stream_title":"Main field","corners":"red_blue","sponsor_seconds":10}')$$, t.e1()));
select t.expect_ok('a Twitch address is allowed', format($$select t.sets(%L, '{"stream_url":"https://www.twitch.tv/buhurtos"}')$$, t.e1()));
select t.expect_ok('a Vimeo address is allowed', format($$select t.sets(%L, '{"stream_url":"https://vimeo.com/123456789"}')$$, t.e1()));
select t.expect_ok('a youtu.be short address is allowed', format($$select t.sets(%L, '{"stream_url":"https://youtu.be/abcdefghijk"}')$$, t.e1()));
select t.expect_error('http is refused', format($$select t.sets(%L, '{"stream_url":"http://www.youtube.com/watch?v=abcdefghijk"}')$$, t.e1()), '22023');
select t.expect_error('a look-alike host is refused (youtube.com.evil.test)', format($$select t.sets(%L, '{"stream_url":"https://youtube.com.evil.test/x"}')$$, t.e1()), '22023');
select t.expect_error('another host is refused', format($$select t.sets(%L, '{"stream_url":"https://evil.test/watch"}')$$, t.e1()), '22023');
select t.expect_error('a script address is refused', format($$select t.sets(%L, '{"stream_url":"javascript:alert(1)"}')$$, t.e1()), '22023');
select t.expect_error('an address with spaces is refused', format($$select t.sets(%L, '{"stream_url":"https://youtube.com/a b"}')$$, t.e1()), '22023');
select t.expect_error('unknown settings are refused', format($$select t.sets(%L, '{"password":"x"}')$$, t.e1()), '22023');
select t.expect_error('corners must be known', format($$select t.sets(%L, '{"corners":"green"}')$$, t.e1()), '22023');
select t.expect_error('a sponsor shows 3 to 60 seconds', format($$select t.sets(%L, '{"sponsor_seconds":1}')$$, t.e1()), '22023');
select t.expect_error('switches are yes / no', format($$select t.sets(%L, '{"show_records":"maybe"}')$$, t.e1()), '22023');
select t.expect_error('a title over 80 characters is refused', format($$select t.sets(%L, jsonb_build_object('stream_title', repeat('x', 81))::text)$$, t.e1()), '22023');
select t.expect_ok('the stream can be cleared', format($$select t.sets(%L, '{"stream_url":""}')$$, t.e1()));
select t.expect_ok('and set again', format($$select t.sets(%L, '{"stream_url":"https://www.twitch.tv/buhurtos","show_records":false}')$$, t.e1()));
select t.as_admin();
select t.expect_eq('the row holds exactly what was set', (select stream_url || '|' || corners || '|' || show_records::text || '|' || sponsor_seconds::text from public.event_broadcast where event_id = t.e1()), 'https://www.twitch.tv/buhurtos|red_blue|false|10');
select t.expect_eq('every change is audited', (select count(*) >= 5 from public.audit_log where event_id = t.e1() and action = 'broadcast.settings'), true);

-- ================================================================ 3. sponsors
select t.as_user(t.u(90));
select t.expect_ok('an organizer adds a title sponsor with a logo in the event''s folder', format($$select t.sponsor(%L, 'Forge & Co', %L, 'https://forge.example.test', 'title')$$, t.e1(), t.e1()::text || '/1.png'));
select t.expect_ok('a partner without a logo or link', format($$select t.sponsor(%L, 'Plain Partner')$$, t.e1()));
select t.expect_error('a logo from another event''s folder is refused', format($$select t.sponsor(%L, 'Stolen Logo', %L)$$, t.e1(), t.e2()::text || '/1.png'), '42501');
select t.expect_error('a logo path with a wrong shape is refused', format($$select t.sponsor(%L, 'Bad Logo', '../../x.png')$$, t.e1()), '42501');
select t.expect_error('a script link is refused', format($$select t.sponsor(%L, 'Bad Link', null, 'javascript:alert(1)')$$, t.e1()), '22023');
select t.expect_error('an http link is refused', format($$select t.sponsor(%L, 'Bad Link', null, 'http://x.example.test')$$, t.e1()), '22023');
select t.expect_error('a one-letter name is refused', format($$select t.sponsor(%L, 'X')$$, t.e1()), '22023');
select t.expect_error('the tier must be known', format($$select t.sponsor(%L, 'Tiered', null, null, 'gold')$$, t.e1()), '22023');
select t.as_admin();
select t.expect_eq('two sponsors exist, with no account id column anywhere in the table', array[(select count(*) from public.event_sponsors where event_id = t.e1())::text, (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('event_sponsors', 'event_broadcast') and column_name ~ 'user|account|created_by|owner')::text], array['2', '0']);
select id as sp1 from public.event_sponsors where name = 'Forge & Co' \gset
select t.as_user(t.u(90));
select t.expect_ok('an organizer edits a sponsor', format($$select public.save_event_sponsor(%L, %L, 'Forge and Co', %L, null, 'title', 5, true)$$, t.e1(), :'sp1', t.e1()::text || '/1.png'));
select t.as_user(t.u(70));
select t.expect_error('another event''s organizer cannot edit it', format($$select public.save_event_sponsor(%L, %L, 'Hijack', null, null, 'partner', 0, true)$$, t.e2(), :'sp1'), 'P0002');
select t.expect_error('... nor remove it', format($$select public.remove_event_sponsor(%L)$$, :'sp1'), '42501');
select t.as_user(t.u(90));
select t.expect_ok('the 24 sponsor limit is reachable', format($$select t.sponsor(%L, 'Bulk ' || n) from generate_series(1, 22) n$$, t.e1()));
select t.expect_error('the 25th sponsor is refused', format($$select t.sponsor(%L, 'One too many')$$, t.e1()), '22023');
select t.expect_ok('removing one makes room', format($$select public.remove_event_sponsor(%L)$$, :'sp1'));
select t.as_admin();
select t.expect_eq('removal is audited and the sponsor is gone', array[(select count(*) from public.event_sponsors where id = :'sp1')::text, (select count(*)::text from public.audit_log where action = 'broadcast.sponsor_removed')], array['0', '1']);

-- ================================================================ 4. public read: only for a public event, organization boundary included
select t.as_user(t.u(90));
select t.sets(t.e3(), '{"stream_url":"https://www.twitch.tv/draftcast"}'), t.sponsor(t.e3(), 'Draft Sponsor');
select t.as_user(t.u(71));
select t.expect_error('the organizer of an event whose organization is disabled cannot change its broadcast settings (the organization boundary freezes it)', format($$select t.sets(%L, '{"corners":"team_colors"}')$$, t.e4()), '42501');
select t.as_admin();
insert into public.event_broadcast (event_id, stream_url) values (t.e4(), 'https://www.twitch.tv/orgoff');
insert into public.event_sponsors (event_id, name) values (t.e4(), 'Org Off Sponsor');
select t.as_user(t.u(70));
select t.sets(t.e2(), '{"stream_url":"https://www.twitch.tv/other"}'), t.sponsor(t.e2(), 'Other Sponsor');
select t.as_anon();
select t.expect_eq('anyone can read the stream and sponsors of a published event', array[(select stream_url from public.event_broadcast where event_id = t.e1()), (select count(*)::text from public.event_sponsors where event_id = t.e1())], array['https://www.twitch.tv/buhurtos', '23']);
select t.expect_eq('... but nothing of a draft event', array[(select count(*)::text from public.event_broadcast where event_id = t.e3()), (select count(*)::text from public.event_sponsors where event_id = t.e3())], array['0', '0']);
select t.expect_eq('... nor of an event whose organization is disabled (the organization boundary holds)', array[(select count(*)::text from public.event_broadcast where event_id = t.e4()), (select count(*)::text from public.event_sponsors where event_id = t.e4())], array['0', '0']);
select t.as_user(t.u(50));
select t.expect_eq('a signed-in stranger sees the same: published only', (select count(*) from public.event_broadcast), 2::bigint);
select t.as_user(t.u(90));
select t.expect_eq('the organizer also sees their own draft event''s settings (to prepare before publishing)', (select count(*) from public.event_broadcast where event_id = t.e3()), 1::bigint);
select t.as_user(t.u(71));
select t.expect_eq('... and even that event''s own organizer sees nothing while the organization is disabled', (select count(*) from public.event_sponsors where event_id = t.e4()), 0::bigint);

-- ================================================================ 5. sponsor-logo storage
select t.as_admin();
select t.expect_eq('the bucket is public, 512 KB, images only', (select public::text || ':' || file_size_limit::text || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'sponsor-logos'), 'true:524288:image/png,image/jpeg,image/webp');
select t.as_user(t.u(90));
select t.expect_ok('an organizer uploads into their event''s folder', format($$insert into storage.objects (bucket_id, name) values ('sponsor-logos', %L)$$, t.e1()::text || '/2.png'));
select t.expect_error('... but not into another event''s folder', format($$insert into storage.objects (bucket_id, name) values ('sponsor-logos', %L)$$, t.e2()::text || '/2.png'), '42501');
select t.expect_error('... nor with a path of the wrong shape', format($$insert into storage.objects (bucket_id, name) values ('sponsor-logos', %L)$$, t.e1()::text || '/evil.svg'), '42501');
select t.as_user(t.u(88));
select t.expect_error('a scorekeeper cannot upload a logo', format($$insert into storage.objects (bucket_id, name) values ('sponsor-logos', %L)$$, t.e1()::text || '/3.png'), '42501');
select t.as_anon();
select t.expect_error('anonymous cannot upload a logo', format($$insert into storage.objects (bucket_id, name) values ('sponsor-logos', %L)$$, t.e1()::text || '/3.png'), '42501');
select t.as_user(t.u(70));
select t.expect_ok('another event''s organizer''s delete finds nothing to delete (row-level security hides the file)', format($$delete from storage.objects where bucket_id = 'sponsor-logos' and name = %L$$, t.e1()::text || '/2.png'));
select t.as_admin();
select t.expect_eq('the logo is still there', (select count(*) from storage.objects where bucket_id = 'sponsor-logos' and name = t.e1()::text || '/2.png'), 1::bigint);
select t.as_user(t.u(90));
select t.expect_ok('the organizer deletes it', format($$delete from storage.objects where bucket_id = 'sponsor-logos' and name = %L$$, t.e1()::text || '/2.png'));

-- ================================================================ 6. grants and the boundary of this pack
select t.as_admin();
select t.expect_eq('both tables have row-level security on', (select count(*) from pg_class where relname in ('event_broadcast', 'event_sponsors') and relnamespace = 'public'::regnamespace and relrowsecurity), 2::bigint);
select t.expect_eq('no client role holds any write grant on either table',
  (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('event_broadcast', 'event_sponsors') and g.grantee in ('anon', 'authenticated', 'public') and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')), 0::bigint);
select t.expect_eq('anonymous cannot execute any of the three functions',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('set_broadcast_settings', 'save_event_sponsor', 'remove_event_sponsor') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.expect_eq('all three pin an empty search path',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('set_broadcast_settings', 'save_event_sponsor', 'remove_event_sponsor') and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 3::bigint);
select t.expect_eq('NOTHING SPORTING changed: matches, clocks, rounds, penalties, notifications and results are exactly as before', t.sporting(), :'sp0');

select 'PACK14 GATE PASSED ' || count(*) || ' checks' from t.log;
rollback;
