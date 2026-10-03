-- Pack 05 gate: one account = one fighter, no avoidable duplicate fighters, look-alikes go to an administrator, nothing is auto-merged.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack05_gate.sql
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

-- u1 owner; u2 organizer of E1; u3 captain of Team One; u4 registrant who already has a fighter; u5 brand-new registrant; u6 brand-new team joiner;
-- u7 registrant whose name matches an unlinked historical fighter; u8 another account claiming the same linked fighter; u9 stranger
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'owner');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b4', 'Existing Linked'), ('00000000-0000-0000-0000-0000000000b5', 'Brand New Person'), ('00000000-0000-0000-0000-0000000000b6', 'Team Joiner'),
  ('00000000-0000-0000-0000-0000000000b7', 'Mara Kessling'), ('00000000-0000-0000-0000-0000000000b8', 'Eight Account') on conflict (id) do update set display_name = excluded.display_name;
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date + 30, current_date + 31);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000b2', 'organizer');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000e101', 1, 'Waiver', 'Waiver text for the test.');
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000c101', 'team-one', 'Team One', 'approved', 'Red Deer', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000b3', 'captain');
-- fighters: F1 is linked to u4; H1 is an UNLINKED historical record (imported, with a source); F8 is linked to u8
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-00000000f001', 'Existing Linked', '00000000-0000-0000-0000-00000000c101'),
  ('00000000-0000-0000-0000-00000000f0a1', 'Mara Kessling', null),
  ('00000000-0000-0000-0000-00000000f008', 'Eight Account', null);
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000b4'), ('00000000-0000-0000-0000-00000000f008', '00000000-0000-0000-0000-0000000000b8');
insert into public.sources (id, kind, title, citation) values ('00000000-0000-0000-0000-00000000b901', 'imported', 'HACSA 2025 roster import', 'test');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-00000000b901', 'fighter', '00000000-0000-0000-0000-00000000f0a1', 'imported', 'roster');
create function t.reg(u text, name text) returns uuid language plpgsql security definer as $$
declare r uuid := gen_random_uuid();
begin
  insert into public.registrations (id, event_id, user_id, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name)
  values (r, '00000000-0000-0000-0000-00000000e101', ('00000000-0000-0000-0000-0000000000b' || u)::uuid, name, 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000f701', name);
  return r;
end $$;
create function t.join(u text) returns uuid language plpgsql security definer as $$
declare r uuid := gen_random_uuid();
begin
  insert into public.team_join_requests (id, team_id, requester_id) values (r, '00000000-0000-0000-0000-00000000c101', ('00000000-0000-0000-0000-0000000000b' || u)::uuid);
  return r;
end $$;
create function t.nf() returns bigint language sql security definer as $$ select count(*) from public.fighters $$;
grant execute on function t.reg(text, text), t.join(text), t.nf() to anon, authenticated;
create table t.ids (k text primary key, v uuid); grant all on t.ids to anon, authenticated;

-- ================================================================ 1. an account that already has a fighter never gets a second one
insert into t.ids select 'r4', t.reg('4', 'Existing Linked');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.expect_ok('the organizer accepts a registration from an account that already has a fighter', $q$select public.decide_registration((select v from t.ids where k = 'r4'), 'accepted')$q$);
select t.as_admin();
select t.expect_eq('no new fighter was created', t.nf(), 3::bigint);
select t.expect_eq('the registration points at the existing fighter', (select fighter_id from public.registrations where id = (select v from t.ids where k = 'r4')), '00000000-0000-0000-0000-00000000f001'::uuid);
select t.expect_eq('no review was opened', (select count(*) from public.fighter_identity_reviews), 0::bigint);

-- ================================================================ 2. team-join acceptance for a linked account: no duplicate
insert into t.ids select 'j4', t.join('4');
select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.expect_ok('the captain accepts a join request from an account that already has a fighter', $q$select public.decide_team_join((select v from t.ids where k = 'j4'), 'approved')$q$);
select t.as_admin();
select t.expect_eq('still no new fighter', t.nf(), 3::bigint);

-- ================================================================ 3. a brand-new account gets exactly one fighter, and the second flow reuses it
insert into t.ids select 'r5', t.reg('5', 'Brand New Person');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.expect_ok('accept the registration of a brand-new account', $q$select public.decide_registration((select v from t.ids where k = 'r5'), 'accepted')$q$);
select t.as_admin();
select t.expect_eq('exactly one fighter was created and linked', t.nf() || '/' || (select count(*) from public.fighter_accounts where user_id = '00000000-0000-0000-0000-0000000000b5'), '4/1');
select t.expect_eq('no look-alike, so no review', (select count(*) from public.fighter_identity_reviews), 0::bigint);
-- the same account then asks to join a team: the captain's acceptance reuses the fighter made by the registration
insert into public.team_join_requests (id, team_id, requester_id) values ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000b5');
select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.expect_ok('the captain accepts that same account into the team', $q$select public.decide_team_join('00000000-0000-0000-0000-0000000000d5', 'approved')$q$);
select t.as_admin();
select t.expect_eq('the team flow reused the registration''s fighter: still one fighter for the account', t.nf() || '/' || (select count(*) from public.fighter_accounts where user_id = '00000000-0000-0000-0000-0000000000b5'), '4/1');
-- and the other way round
insert into t.ids select 'j6', t.join('6');
select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.expect_ok('a new account is accepted into the team first', $q$select public.decide_team_join((select v from t.ids where k = 'j6'), 'approved')$q$);
select t.as_admin();
insert into t.ids select 'r6', t.reg('6', 'Team Joiner');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.expect_ok('then its registration is accepted', $q$select public.decide_registration((select v from t.ids where k = 'r6'), 'accepted')$q$);
select t.as_admin();
select t.expect_eq('the registration reused the team flow''s fighter: one fighter for the account', t.nf() || '/' || (select count(*) from public.fighter_accounts where user_id = '00000000-0000-0000-0000-0000000000b6'), '5/1');

-- ================================================================ 4. the database refuses a second link either way
select t.expect_error('one account cannot be linked to a second fighter', $q$insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000b4')$q$, '23505');
select t.expect_error('one fighter cannot be claimed by a second account', $q$insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000b9')$q$, '23505');
select t.expect_ok('a fighter without any account is fine (historical / imported)', $q$select 1 from public.fighters where id = '00000000-0000-0000-0000-00000000f0a1' and not exists (select 1 from public.fighter_accounts where fighter_id = id)$q$);
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.expect_error('a signed-in user cannot link themselves to a fighter by direct insert', $q$insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000b9')$q$);
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.expect_error('an account cannot take over another account''s fighter', $q$update public.fighter_accounts set user_id = '00000000-0000-0000-0000-0000000000b8' where fighter_id = '00000000-0000-0000-0000-00000000f001'$q$);
select t.expect_error('nor repoint its own link at someone else''s fighter', $q$update public.fighter_accounts set fighter_id = '00000000-0000-0000-0000-00000000f001' where user_id = '00000000-0000-0000-0000-0000000000b8'$q$);
select t.as_admin();
select t.expect_eq('all links are unchanged', (select string_agg(user_id::text || '>' || fighter_id::text, ',' order by user_id) from public.fighter_accounts where user_id in ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b8')), '00000000-0000-0000-0000-0000000000b4>00000000-0000-0000-0000-00000000f001,00000000-0000-0000-0000-0000000000b8>00000000-0000-0000-0000-00000000f008');

-- ================================================================ 5. a look-alike goes to an administrator; nothing is auto-merged
insert into t.ids select 'r7', t.reg('7', 'mara  kessling'::text);
update public.registrations set full_name = 'MARA KESSLING' where id = (select v from t.ids where k = 'r7');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.expect_ok('the organizer accepts a registration whose name matches an unlinked historical fighter', $q$select public.decide_registration((select v from t.ids where k = 'r7'), 'accepted')$q$);
select t.as_admin();
select t.expect_eq('a new fighter was created for the account (not silently linked to the historical record)', t.nf(), 6::bigint);
select t.expect_eq('the historical record is untouched and still has no account', (select count(*) from public.fighter_accounts where fighter_id = '00000000-0000-0000-0000-00000000f0a1'), 0::bigint);
select t.expect_eq('exactly one open review links the two records', (select count(*) from public.fighter_identity_reviews where status = 'open' and candidate_id = '00000000-0000-0000-0000-00000000f0a1' and source = 'registration'), 1::bigint);
select t.expect_eq('the source of the historical record is still attached', (select count(*) from public.record_sources where entity_type = 'fighter' and entity_id = '00000000-0000-0000-0000-00000000f0a1'), 1::bigint);
select t.expect_eq('opening the review was audited', (select count(*) from public.audit_log where action = 'fighter.identity_review_opened'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.expect_error('an organizer cannot see the reviews', $q$select * from public.list_fighter_identity_reviews()$q$, '42501');
select t.expect_error('nor read the table directly', $q$select * from public.fighter_identity_reviews$q$);
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.expect_error('a stranger cannot resolve one', $q$select public.resolve_fighter_identity_review(gen_random_uuid(), 'distinct', 'because')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.expect_eq('the platform administrator sees both records with context (name, account, sources)', (select (new_fighter ->> 'name') || '|' || (new_fighter ->> 'has_account') || '|' || (candidate ->> 'name') || '|' || (candidate ->> 'has_account') || '|' || (candidate -> 'sources' ->> 0) from public.list_fighter_identity_reviews()), 'MARA KESSLING|true|Mara Kessling|false|HACSA 2025 roster import');
select t.expect_error('a decision needs a note', $q$select public.resolve_fighter_identity_review((select review_id from public.list_fighter_identity_reviews()), 'duplicate', '')$q$, '22023');
select t.expect_error('a decision must be one of the two', $q$select public.resolve_fighter_identity_review((select review_id from public.list_fighter_identity_reviews()), 'merge now', 'sure')$q$, '22023');
select t.expect_ok('the administrator records that these are two different people', $q$select public.resolve_fighter_identity_review((select review_id from public.list_fighter_identity_reviews()), 'distinct', 'different city and age, checked with the team captain')$q$);
select t.expect_eq('the review leaves the open list', (select count(*) from public.list_fighter_identity_reviews()), 0::bigint);
select t.as_admin();
select t.expect_eq('still nothing was merged: both fighter records exist', (select count(*) from public.fighters where id in ('00000000-0000-0000-0000-00000000f0a1') or display_name = 'MARA KESSLING'), 2::bigint);
select t.expect_eq('the decision is recorded with who and why', (select status || '/' || note || '/' || (resolved_by = '00000000-0000-0000-0000-0000000000b1')::text from public.fighter_identity_reviews), 'distinct/different city and age, checked with the team captain/true');
insert into t.ids select 'rev', id from public.fighter_identity_reviews limit 1;
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.expect_error('a review cannot be decided twice', $q$select public.resolve_fighter_identity_review((select v from t.ids where k = 'rev'), 'duplicate', 'again')$q$, 'P0001');


-- ================================================================ 6. public history keeps fictional results visible and labelled, while aggregates leave them out; event-time team names survive
select t.as_admin();
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000c102', 'old-name', 'Old Name', 'approved', 'Leduc', 'CA'), ('00000000-0000-0000-0000-00000000c103', 'successor', 'Successor', 'approved', 'Leduc', 'CA');
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e201', 'real-cup', 'Real Cup', 'published', 'tournament', current_date - 40, current_date - 39),
  ('00000000-0000-0000-0000-00000000e202', 'fiction-cup', 'Fiction Cup', 'published', 'tournament', current_date - 40, current_date - 39);
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-00000000b902', 'submitted', 'Fictional dataset', 'test', true);
insert into public.record_sources (source_id, entity_type, entity_id, status) values ('00000000-0000-0000-0000-00000000b902', 'event', '00000000-0000-0000-0000-00000000e202', 'unverified');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000e201', 'Real 5v5', '5v5', 'men', 'Classic', 'round_robin'),
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000e202', 'Fiction 5v5', '5v5', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, team_id) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000c102'),
  ('00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000c102');
insert into public.results (competition_id, entry_id, final_place, points) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000e301', 1, 6), ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000e302', 1, 6);
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.expect_ok('the platform administrator merges the old team into its successor', $q$select public.merge_teams('00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-00000000c102')$q$);
select t.as_anon();
select t.expect_eq('the history list shows both results, the fictional one flagged', (select string_agg(event_slug || ':' || synthetic::text, ',' order by event_slug) from public.team_results_all where team_id = '00000000-0000-0000-0000-00000000c103'), 'fiction-cup:true,real-cup:false');
select t.expect_eq('rankings and statistics see only the real one', (select string_agg(event_slug, ',') from public.team_results where team_id = '00000000-0000-0000-0000-00000000c103'), 'real-cup');
select t.expect_eq('the old result still carries the name used at the event, and the team as it is now', (select distinct team_name_at_event || ' -> ' || team_current_name from public.team_results_all where team_id = '00000000-0000-0000-0000-00000000c103'), 'Old Name -> Successor');
select t.expect_eq('team statistics count one gold, not two', (select golds from public.team_stats where team_id = '00000000-0000-0000-0000-00000000c103'), 1::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
