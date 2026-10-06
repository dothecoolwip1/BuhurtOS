-- Pack 24 follow-ups gate (audit 2026-10-06): a fighter created for a test event is test data (20261019000200), and the result revision log's
-- append-only trigger has a fixed search_path and still refuses every change (20261019000300). LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack24_followups_gate.sql
-- Soft mode (negative control against a schema without the migrations):  PGOPTIONS="-c t.soft=on" psql -d <db> -f supabase/tests/pack24_followups_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create table t.fails (n serial, name text, why text);
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.bad(label text, why text) returns void language plpgsql as $$
begin
  if coalesce(current_setting('t.soft', true), '') = 'on' then insert into t.fails (name, why) values (label, why); else raise exception 'FAIL (%): %', why, label; end if;
end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then perform t.bad(label, 'expected an error'); return; end if;
  if state is not null and got <> state then perform t.bad(label, 'wrong error ' || got || ' instead of ' || state); return; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_ok(label text, stmt text) returns void language plpgsql as $$
declare ok boolean := true; why text;
begin
  begin execute stmt; exception when others then ok := false; why := sqlstate || ' ' || sqlerrm; end;
  if not ok then perform t.bad(label, 'unexpected error ' || why); return; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then perform t.bad(label, coalesce(got::text, 'null') || ' <> ' || coalesce(want::text, 'null')); return; end if;
  insert into t.log (name) values (label);
end $$;
create table t.kv (k text primary key, v text);
create function t.get(key text) returns uuid language sql stable as $$ select v::uuid from t.kv where k = key $$;
grant usage on schema t to anon, authenticated;
grant all on t.log, t.fails, t.kv to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- a1 organizer of both events; a2 a plain signed-in person (would-be claimant). TEST = an event tagged with a synthetic source; REAL = a normal event.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000024a1', 'org24@example.test'), ('00000000-0000-0000-0000-0000000024a2', 'person24@example.test');
insert into public.sources (id, kind, title, synthetic) values ('00000000-0000-0000-0000-00000000245e', 'imported', 'Pack 24 gate test dataset', true);
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000024e1', 'p24-test-event', 'Pack 24 TEST event', 'published', current_date, current_date),
  ('00000000-0000-0000-0000-0000000024e2', 'p24-real-event', 'Pack 24 real event', 'published', current_date, current_date);
insert into public.record_sources (source_id, entity_type, entity_id) values ('00000000-0000-0000-0000-00000000245e', 'event', '00000000-0000-0000-0000-0000000024e1');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000024e1', '00000000-0000-0000-0000-0000000024a1', 'organizer'), ('00000000-0000-0000-0000-0000000024e2', '00000000-0000-0000-0000-0000000024a1', 'organizer');
insert into public.competitions (id, event_id, name, category, gender) values
  ('00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024e1', 'Longsword (test)', 'longsword', 'men'),
  ('00000000-0000-0000-0000-0000000024c2', '00000000-0000-0000-0000-0000000024e2', 'Longsword (real)', 'longsword', 'men');
insert into public.fighters (id, display_name) values ('00000000-0000-0000-0000-0000000024f1', 'Pat Genuine-Person');   -- a real fighter, no account

-- ================================================================ 1. a fighter created for a test event is test data
select t.as_user('00000000-0000-0000-0000-0000000024a1');
insert into t.kv select 'test_fighter', (public.create_unclaimed_fighter('00000000-0000-0000-0000-0000000024e1', 'Tess Fictional', p_competition => '00000000-0000-0000-0000-0000000024c1')) ->> 'fighter_id';
select t.as_admin();
select t.expect_eq('a fighter the organizer creates on a TEST event is marked test data (private.is_synthetic)', private.is_synthetic('fighter', t.get('test_fighter')), true);
select t.expect_eq('... through the existing model: one record_sources row naming the event''s own synthetic source',
  (select string_agg(source_id::text, ',') from public.record_sources where entity_type = 'fighter' and entity_id = t.get('test_fighter')), '00000000-0000-0000-0000-00000000245e');
select t.expect_eq('... it is listed with the other test records (the "Test" label reads this view)', exists (select 1 from public.synthetic_records where entity_type = 'fighter' and entity_id = t.get('test_fighter')), true);
select t.expect_eq('... it was entered in the test competition in the same call', exists (select 1 from public.entries where competition_id = '00000000-0000-0000-0000-0000000024c1' and fighter_id = t.get('test_fighter')), true);
select t.expect_eq('... and the audit row says it is test data', (select details ->> 'synthetic' from public.audit_log where action = 'fighter.created_by_organizer' and subject = t.get('test_fighter')::text), 'true');

-- a test fighter named like a real person is not a look-alike of that person
select t.as_user('00000000-0000-0000-0000-0000000024a1');
select t.expect_ok('on a TEST event, a fighter named like a real fighter needs no "different person" confirmation', $q$insert into t.kv select 'test_twin', (public.create_unclaimed_fighter('00000000-0000-0000-0000-0000000024e1', 'Pat Genuine-Person')) ->> 'fighter_id'$q$);
select t.as_admin();
select t.expect_eq('... and raises NO identity review against the real fighter', (select count(*)::int from public.fighter_identity_reviews where fighter_id = t.get('test_twin') or candidate_id = '00000000-0000-0000-0000-0000000024f1'), 0);
select t.expect_eq('... and is test data too', private.is_synthetic('fighter', t.get('test_twin')), true);

-- ================================================================ 2. it cannot pass for a real person
select t.as_user('00000000-0000-0000-0000-0000000024a2');
select t.expect_eq('a test fighter does not appear in the claimable-profile search', (select count(*)::int from public.search_unclaimed_fighters('Tess Fictional')), 0);
select t.expect_error('... and cannot be claimed by a real account', format($q$select public.request_fighter_claim(%L)$q$, t.get('test_fighter')), '22023');
select t.as_user('00000000-0000-0000-0000-0000000024a1');
select t.expect_error('... and cannot be entered in a REAL event (closing a direct call; the search already hides it)', format($q$select public.add_entrant('00000000-0000-0000-0000-0000000024c2', %L)$q$, t.get('test_fighter')), '22023');
select t.as_admin();
select t.expect_eq('... the real competition has no entry for it', exists (select 1 from public.entries where competition_id = '00000000-0000-0000-0000-0000000024c2' and fighter_id = t.get('test_fighter')), false);
select t.as_user('00000000-0000-0000-0000-0000000024a1');
select t.expect_ok('a REAL fighter can still be entered in a test event (unchanged)', $q$select public.add_entrant('00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-0000000024f1')$q$);
select t.as_admin();
select t.expect_eq('... and stays real (entering a test event does not make a person test data)', private.is_synthetic('fighter', '00000000-0000-0000-0000-0000000024f1'), false);

-- ================================================================ 3. real events are unchanged
select t.as_user('00000000-0000-0000-0000-0000000024a1');
select t.expect_error('on a REAL event a same-name fighter still needs the "different person" confirmation', $q$select public.create_unclaimed_fighter('00000000-0000-0000-0000-0000000024e2', 'Pat Genuine-Person')$q$, '22023');
insert into t.kv select 'real_twin', (public.create_unclaimed_fighter('00000000-0000-0000-0000-0000000024e2', 'Pat Genuine-Person', p_confirmed_distinct => true, p_competition => '00000000-0000-0000-0000-0000000024c2')) ->> 'fighter_id';
select t.as_admin();
select t.expect_eq('... once confirmed, the new fighter is real', private.is_synthetic('fighter', t.get('real_twin')), false);
select t.expect_eq('... with no test-source row', exists (select 1 from public.record_sources where entity_type = 'fighter' and entity_id = t.get('real_twin')), false);
select t.expect_eq('... and the look-alike is queued for the administrator as before', (select count(*)::int from public.fighter_identity_reviews where fighter_id = t.get('real_twin') and candidate_id = '00000000-0000-0000-0000-0000000024f1'), 1);
select t.expect_eq('... the audit row says it is not test data', (select details ->> 'synthetic' from public.audit_log where action = 'fighter.created_by_organizer' and subject = t.get('real_twin')::text), 'false');
select t.as_user('00000000-0000-0000-0000-0000000024a2');
select t.expect_eq('... and a real unclaimed fighter is still claimable-searchable', (select count(*)::int from public.search_unclaimed_fighters('Pat Genuine') where fighter_id = t.get('real_twin')), 1);
select t.as_admin();
select t.expect_eq('the helper that finds an event''s test source is not callable by clients', coalesce((select has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') from (select to_regprocedure('private.synthetic_source_of(text, uuid)') as f) x where f is not null), false), false);

-- ================================================================ 4. result_revisions_append_only: fixed search_path, same behaviour
select t.expect_eq('private.result_revisions_append_only has a fixed, empty search_path',
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'private.result_revisions_append_only()'::regprocedure), 'search_path=""');
select t.expect_eq('no function in public or private is left without a fixed search_path',
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 0);
select t.expect_eq('... it is still the trigger on result_revisions', (select tgfoid::regprocedure::text from pg_trigger where tgname = 'result_revisions_no_change' and tgrelid = 'public.result_revisions'::regclass), 'private.result_revisions_append_only()');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-0000000024d1', '00000000-0000-0000-0000-0000000024c2', '00000000-0000-0000-0000-0000000024f1');
select t.expect_ok('a revision can still be appended (as Finalize and Correct do)', $q$select private.log_result_revision('00000000-0000-0000-0000-0000000024c2', '00000000-0000-0000-0000-0000000024d1', 'computed', null, null, 1, 10, 'gate')$q$);
select t.expect_error('... but not changed, even by the database owner', $q$update public.result_revisions set reason = 'rewritten' where entry_id = '00000000-0000-0000-0000-0000000024d1'$q$, '42501');
select t.expect_error('... nor deleted', $q$delete from public.result_revisions where entry_id = '00000000-0000-0000-0000-0000000024d1'$q$, '42501');
select t.expect_eq('... the revision is intact', (select reason from public.result_revisions where entry_id = '00000000-0000-0000-0000-0000000024d1'), 'gate');

select 'PASSED ' || (select count(*) from t.log) || ' checks' as result where not exists (select 1 from t.fails);
select 'FAILED ' || (select count(*) from t.fails) || ' of ' || ((select count(*) from t.log) + (select count(*) from t.fails)) || ' checks (soft mode)' as result where exists (select 1 from t.fails);
select n, name, why from t.fails order by n;
rollback;
