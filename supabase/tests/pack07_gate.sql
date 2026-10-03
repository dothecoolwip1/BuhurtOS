-- Pack 07 gate: synthetic results stay out of official views but show on their own event; waiver versions (text and PDF) are append-only and
-- numbered by the database; competitions with history cannot be deleted; organizer-added fighters are invitations, not registrations or staff;
-- fighter social links and gallery are owner-only; my_event_relations never comes from platform-wide power.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack07_gate.sql
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
-- notifications have no table grant (people read their own through my_notifications); the gate looks at them with a definer helper.
create function t.notifs(u uuid, k text) returns setof public.notifications language sql security definer as $$ select * from public.notifications where user_id = u and kind = k $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- u1 owner (no personal relationship to any event); u2 organizer of E1 and E2; u3 fighter with account (F3); u4 stranger; u5 medic of E1;
-- u6 captain of team C1; u7 fighter with account (F7); u8 organizer of E3 only
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 8) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000d1', 'owner');
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000d3', 'Three Fighter'), ('00000000-0000-0000-0000-0000000000d7', 'Seven Fighter') on conflict (id) do update set display_name = excluded.display_name;
insert into public.events (id, slug, name, status, starts_on, ends_on, registration_closes_at) values
  ('00000000-0000-0000-0000-0000000e7001', 'e7-one', 'Event One', 'published', current_date + 30, current_date + 31, now() + interval '20 days'),
  ('00000000-0000-0000-0000-0000000e7002', 'e7-two', 'Event Two', 'published', current_date + 40, current_date + 41, null),
  ('00000000-0000-0000-0000-0000000e7003', 'e7-three', 'Event Three', 'draft', current_date + 50, current_date + 51, null),
  ('00000000-0000-0000-0000-0000000e7009', 'e7-fake-test', 'Fake Open', 'published', current_date - 30, current_date - 29, null);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000000d2', 'organizer'),
  ('00000000-0000-0000-0000-0000000e7002', '00000000-0000-0000-0000-0000000000d2', 'organizer'),
  ('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000000d5', 'medic'),
  ('00000000-0000-0000-0000-0000000e7003', '00000000-0000-0000-0000-0000000000d8', 'organizer');
insert into public.competitions (id, event_id, name, category, gender, sort) values
  ('00000000-0000-0000-0000-0000000c7001', '00000000-0000-0000-0000-0000000e7001', 'Longsword (men)', 'longsword', 'men', 1),
  ('00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000e7001', 'Melee 5v5 (men)', '5v5', 'men', 2),
  ('00000000-0000-0000-0000-0000000c7003', '00000000-0000-0000-0000-0000000e7002', 'Polearm (open)', 'polearm', 'open', 1),
  ('00000000-0000-0000-0000-0000000c7004', '00000000-0000-0000-0000-0000000e7001', 'Empty one', 'sabre', 'open', 3),
  ('00000000-0000-0000-0000-0000000c7009', '00000000-0000-0000-0000-0000000e7009', 'Fake Longsword', 'longsword', 'men', 1);
insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-0000000c7101', 'team-c1', 'Team C1', 'approved', 'Red Deer', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-0000000c7101', '00000000-0000-0000-0000-0000000000d6', 'captain');
insert into public.fighters (id, display_name, team_id) values
  ('00000000-0000-0000-0000-0000000f7003', 'Three Fighter', null),
  ('00000000-0000-0000-0000-0000000f7007', 'Seven Fighter', '00000000-0000-0000-0000-0000000c7101'),
  ('00000000-0000-0000-0000-0000000f7099', 'Unclaimed Historical', null),
  ('00000000-0000-0000-0000-0000000f7009', 'Fake Fighter', null);
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-0000000f7003', '00000000-0000-0000-0000-0000000000d3'), ('00000000-0000-0000-0000-0000000f7007', '00000000-0000-0000-0000-0000000000d7');
-- The fictional event: a synthetic source tags it; a finished result exists.
insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000b7901', 'imported', 'Fictional league', 'test', true);
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000b7901', 'event', '00000000-0000-0000-0000-0000000e7009', 'imported', 'fiction');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-0000000a7009', '00000000-0000-0000-0000-0000000c7009', '00000000-0000-0000-0000-0000000f7009');
insert into public.results (competition_id, entry_id, final_place, points) values ('00000000-0000-0000-0000-0000000c7009', '00000000-0000-0000-0000-0000000a7009', 1, 99);

-- ---------------------------------------------------------------- 1. synthetic results: on the event page yes, in official views no
select t.as_anon();
select t.expect_eq('the fictional event''s own results are readable, flagged synthetic',
  (select count(*) from public.result_rows_all where event_id = '00000000-0000-0000-0000-0000000e7009' and synthetic), 1::bigint);
select t.expect_eq('official result rows leave the fictional event out', (select count(*) from public.result_rows where event_id = '00000000-0000-0000-0000-0000000e7009'), 0::bigint);
select t.expect_eq('official fighter rankings leave the fictional fighter out', (select count(*) from public.ranking_fighters where fighter_id = '00000000-0000-0000-0000-0000000f7009'), 0::bigint);
select t.expect_eq('official career statistics count nothing for the fictional fighter',
  (select coalesce(sum(golds + points + events_attended), 0) from public.fighter_career_stats where fighter_id = '00000000-0000-0000-0000-0000000f7009'), 0::numeric);
select t.expect_eq('played-event counts leave the fictional event out', (select count(*) from public.played_events where event_id = '00000000-0000-0000-0000-0000000e7009'), 0::bigint);

-- ---------------------------------------------------------------- 2. waivers: text and PDF versions, append-only, numbered by the database
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_error('a stranger cannot add a waiver version', $q$select public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Waiver', 'This is a long enough waiver text for the test.')$q$, '42501');
select t.expect_error('a stranger cannot upload a waiver document', $q$insert into storage.objects (bucket_id, name) values ('waiver-documents', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf')$q$);
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_error('a text waiver needs the full text', $q$select public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Waiver', 'too short')$q$, '22023');
select t.expect_error('a PDF waiver needs an uploaded document', $q$select public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Waiver', null, 'pdf', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf', 'upload')$q$, '22023');
select t.expect_ok('the organizer adds a text waiver (starter template)', $q$select set_config('t.w1', public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Waiver and release', 'This is a long enough waiver text for the test, from the template.', 'text', null, 'template')::text, true)$q$);
select t.expect_eq('the database numbered it version 1', (select version from public.waiver_versions where id = current_setting('t.w1')::uuid), 1);
select t.expect_ok('the organizer uploads a PDF into the event folder', $q$insert into storage.objects (bucket_id, name) values ('waiver-documents', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf')$q$);
select t.expect_error('the organizer cannot upload into another event''s folder', $q$insert into storage.objects (bucket_id, name) values ('waiver-documents', '00000000-0000-0000-0000-0000000e7003/1700000000000.pdf')$q$);
select t.expect_error('a document from another event''s folder cannot become this event''s waiver', $q$select public.add_waiver_version('00000000-0000-0000-0000-0000000e7002', 'Waiver', null, 'pdf', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf', 'upload')$q$, '22023');
select t.as_anon();
select t.expect_eq('before a version references it, the public cannot see the document', (select count(*) from storage.objects where bucket_id = 'waiver-documents'), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_ok('the organizer makes the PDF version 2', $q$select set_config('t.w2', public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Waiver (PDF)', null, 'pdf', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf', 'upload')::text, true)$q$);
select t.expect_eq('version 2 keeps version 1 as it was', (select count(*) from public.waiver_versions where event_id = '00000000-0000-0000-0000-0000000e7001'), 2::bigint);
select t.expect_error('the same document cannot be used twice', $q$select public.add_waiver_version('00000000-0000-0000-0000-0000000e7001', 'Again', null, 'pdf', '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf', 'upload')$q$, '22023');
select t.expect_error('a version is never edited', $q$update public.waiver_versions set title = 'x' where id = current_setting('t.w1')::uuid$q$, '42501');
select t.expect_error('a version is never deleted', $q$delete from public.waiver_versions where id = current_setting('t.w1')::uuid$q$, '42501');
delete from storage.objects where bucket_id = 'waiver-documents' and name = '00000000-0000-0000-0000-0000000e7001/1700000000000.pdf';
select t.expect_eq('a document a version references cannot be removed, even by its organizer', (select count(*) from storage.objects where bucket_id = 'waiver-documents'), 1::bigint);
select t.as_anon();
select t.expect_eq('once a public version references it, the public can read the document', (select count(*) from storage.objects where bucket_id = 'waiver-documents'), 1::bigint);
select t.expect_eq('the public sees the newest version is a PDF', (select kind from public.waiver_versions where id = current_setting('t.w2')::uuid), 'pdf');
select t.as_user('00000000-0000-0000-0000-0000000000d4');
delete from storage.objects where bucket_id = 'waiver-documents';
select t.as_admin();
select t.expect_eq('the public cannot delete a waiver document', (select count(*) from storage.objects where bucket_id = 'waiver-documents'), 1::bigint);

-- ---------------------------------------------------------------- 3. competitions: delete only when nothing hangs off them
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_ok('an organizer removes an empty competition', $q$delete from public.competitions where id = '00000000-0000-0000-0000-0000000c7004'$q$);
select t.expect_eq('it is gone', (select count(*) from public.competitions where id = '00000000-0000-0000-0000-0000000c7004'), 0::bigint);
select t.as_admin();
insert into public.entries (id, competition_id, team_id) values ('00000000-0000-0000-0000-0000000a7002', '00000000-0000-0000-0000-0000000c7002', '00000000-0000-0000-0000-0000000c7101');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_error('a competition with an entrant cannot be deleted', $q$delete from public.competitions where id = '00000000-0000-0000-0000-0000000c7002'$q$, '22023');
select t.expect_eq('it is still there', (select count(*) from public.competitions where id = '00000000-0000-0000-0000-0000000c7002'), 1::bigint);
select t.as_admin();
select t.expect_error('not even the table owner can delete it', $q$delete from public.competitions where id = '00000000-0000-0000-0000-0000000c7002'$q$, '22023');

-- ---------------------------------------------------------------- 4. organizer-added fighters
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_error('a stranger cannot add a fighter to an event', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[])$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000d5');
select t.expect_error('a medic is staff but cannot add fighters', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[])$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000d8');
select t.expect_error('an organizer of another event cannot add fighters here', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[])$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_error('a competition of another event is refused', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7003']::uuid[])$q$, '22023');
select t.expect_error('at least one competition is needed', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array[]::uuid[])$q$, '22023');
select t.expect_ok('the organizer adds a fighter who has an account',
  $q$select set_config('t.inv3', (public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[], 'Organizer added you') ->> 'invitation_id'), true)$q$);
select t.expect_eq('the fighter with an account was notified',
  (select count(*) from t.notifs('00000000-0000-0000-0000-0000000000d3', 'event_invited') where payload ->> 'invitation_id' = current_setting('t.inv3')), 1::bigint);
select t.expect_eq('adding is not a registration', (select count(*) from public.registrations where event_id = '00000000-0000-0000-0000-0000000e7001'), 0::bigint);
select t.expect_eq('adding is not staff', (select count(*) from public.event_staff where event_id = '00000000-0000-0000-0000-0000000e7001' and user_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint);
select t.expect_error('the same fighter cannot be added twice while pending', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[])$q$, '22023');
select t.expect_eq('an unclaimed record can be added, but nobody is notified',
  (public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7099', array['00000000-0000-0000-0000-0000000c7001']::uuid[]) ->> 'notified'), 'false');
select t.expect_eq('the organizer list says which record has no account',
  (select string_agg(display_name || ':' || has_account::text || ':' || status, ',' order by display_name) from public.list_event_invitations('00000000-0000-0000-0000-0000000e7001')), 'Three Fighter:true:invited,Unclaimed Historical:false:invited');
select t.expect_eq('no notification was faked for the unclaimed record', (select count(*) from t.notifs('00000000-0000-0000-0000-0000000000d3', 'event_invited')), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_eq('a stranger cannot list the invitations', (select count(*) from public.list_event_invitations('00000000-0000-0000-0000-0000000e7001')), 0::bigint);
select t.expect_eq('a stranger cannot read invitation rows', (select count(*) from public.event_invitations), 0::bigint);
select t.expect_error('a stranger cannot withdraw someone else''s invitation', $q$select public.withdraw_my_invitation(current_setting('t.inv3')::uuid)$q$, '42501');
select t.expect_error('a stranger cannot cancel an invitation', $q$select public.cancel_invitation(current_setting('t.inv3')::uuid)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.expect_eq('the fighter sees their own invitation and nobody else''s',
  (select string_agg(fighter_id::text, ',') from public.event_invitations), '00000000-0000-0000-0000-0000000f7003');
select t.expect_eq('with the competitions the organizer chose', (select count(*) from public.event_invitation_competitions where invitation_id = current_setting('t.inv3')::uuid), 1::bigint);
select t.expect_eq('my events: the fighter''s relationship is "invited"', (select string_agg(role, ',') from public.my_event_relations() where event_id = '00000000-0000-0000-0000-0000000e7001'), 'invited');
select t.expect_ok('the fighter withdraws', $q$select public.withdraw_my_invitation(current_setting('t.inv3')::uuid)$q$);
select t.expect_eq('the organizer hears about the withdrawal', (select count(*) from t.notifs('00000000-0000-0000-0000-0000000000d2', 'registration_withdrawn')), 1::bigint);
select t.expect_eq('a withdrawn invitation is no longer a relationship', (select count(*) from public.my_event_relations()), 0::bigint);
select t.expect_error('a withdrawn invitation cannot be withdrawn again', $q$select public.withdraw_my_invitation(current_setting('t.inv3')::uuid)$q$, '22023');
-- The organizer adds them again, after registration has closed; completing the form is still possible for an added fighter.
select t.as_admin();
update public.events set registration_closes_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-0000000e7001';
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_ok('the organizer adds the fighter again', $q$select public.invite_fighter_to_event('00000000-0000-0000-0000-0000000e7001', '00000000-0000-0000-0000-0000000f7003', array['00000000-0000-0000-0000-0000000c7001']::uuid[])$q$);
select t.expect_eq('the invitation is pending again, with one row per fighter', (select status from public.event_invitations where fighter_id = '00000000-0000-0000-0000-0000000f7003'), 'invited');
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.expect_error('a fighter who was not added cannot register after the close', $q$select public.submit_registration('00000000-0000-0000-0000-0000000e7001', jsonb_build_object('full_name', 'Seven Fighter', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member',
  'waiver_agree', true, 'waiver_version_id', current_setting('t.w2'), 'waiver_signed_name', 'Seven Fighter', 'days', jsonb_build_array('sat'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', '00000000-0000-0000-0000-0000000c7001')),
  'private', jsonb_build_object('email', 'seven@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$, '22023');
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.expect_error('the added fighter still has to accept the waiver', $q$select public.submit_registration('00000000-0000-0000-0000-0000000e7001', jsonb_build_object('full_name', 'Three Fighter', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member',
  'waiver_agree', false, 'waiver_version_id', current_setting('t.w2'), 'waiver_signed_name', 'Three Fighter', 'days', jsonb_build_array('sat'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', '00000000-0000-0000-0000-0000000c7001')),
  'private', jsonb_build_object('email', 'three@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))$q$, '22023');
select t.expect_ok('the added fighter completes the form and signs the PDF waiver after the close', $q$select set_config('t.reg3', public.submit_registration('00000000-0000-0000-0000-0000000e7001', jsonb_build_object('full_name', 'Three Fighter', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member',
  'waiver_agree', true, 'waiver_version_id', current_setting('t.w2'), 'waiver_signed_name', 'Three Fighter', 'days', jsonb_build_array('sat'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', '00000000-0000-0000-0000-0000000c7001')),
  'private', jsonb_build_object('email', 'three@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))::text, true)$q$);
select t.expect_eq('the registration is accepted at once: the organizer already chose them', (select status from public.registrations where id = current_setting('t.reg3')::uuid), 'accepted');
select t.expect_eq('it records the exact waiver version signed', (select waiver_version_id::text from public.registrations where id = current_setting('t.reg3')::uuid), current_setting('t.w2'));
select t.expect_eq('the invitation is marked registered and linked', (select status || ':' || (registration_id::text = current_setting('t.reg3'))::text from public.event_invitations where fighter_id = '00000000-0000-0000-0000-0000000f7003'), 'registered:true');
select t.expect_eq('the duel entry exists', (select count(*) from public.entries where competition_id = '00000000-0000-0000-0000-0000000c7001' and fighter_id = '00000000-0000-0000-0000-0000000f7003' and status = 'registered'), 1::bigint);
select t.expect_eq('my events: the relationship is now "fighter" (once, not twice)', (select string_agg(role, ',') from public.my_event_relations() where event_id = '00000000-0000-0000-0000-0000000e7001'), 'fighter');
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_error('a stranger cannot withdraw someone else''s registration', $q$select public.withdraw_registration(current_setting('t.reg3')::uuid)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.expect_ok('the fighter withdraws their registration', $q$select public.withdraw_registration(current_setting('t.reg3')::uuid)$q$);
select t.expect_eq('the registration is withdrawn and the entry too', (select r.status || ':' || e.status from public.registrations r, public.entries e where r.id = current_setting('t.reg3')::uuid and e.fighter_id = r.fighter_id), 'withdrawn:withdrawn');
select t.expect_eq('the organizer hears about it', (select count(*) from t.notifs('00000000-0000-0000-0000-0000000000d2', 'registration_withdrawn') where payload ->> 'registration_id' = current_setting('t.reg3')), 1::bigint);
select t.expect_eq('the invitation follows the registration', (select status from public.event_invitations where fighter_id = '00000000-0000-0000-0000-0000000f7003'), 'withdrawn');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_error('an organizer cannot accept a withdrawn registration behind the person''s back', $q$select public.decide_registration(current_setting('t.reg3')::uuid, 'accepted')$q$, '22023');
select t.expect_ok('the organizer cancels the unclaimed record''s invitation', $q$select public.cancel_invitation((select id from public.event_invitations where fighter_id = '00000000-0000-0000-0000-0000000f7099'))$q$);
select t.expect_eq('cancelled', (select status from public.event_invitations where fighter_id = '00000000-0000-0000-0000-0000000f7099'), 'cancelled');
-- An ordinary registration still goes through review, and the ordinary accept path still works.
select t.as_admin();
update public.events set registration_closes_at = now() + interval '20 days' where id = '00000000-0000-0000-0000-0000000e7001';
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.expect_ok('an ordinary fighter registers', $q$select set_config('t.reg7', public.submit_registration('00000000-0000-0000-0000-0000000e7001', jsonb_build_object('full_name', 'Seven Fighter', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member',
  'waiver_agree', true, 'waiver_version_id', current_setting('t.w2'), 'waiver_signed_name', 'Seven Fighter', 'days', jsonb_build_array('sat'),
  'competitions', jsonb_build_array(jsonb_build_object('competition_id', '00000000-0000-0000-0000-0000000c7001')),
  'private', jsonb_build_object('email', 'seven@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))::text, true)$q$);
select t.expect_eq('it waits for review', (select status from public.registrations where id = current_setting('t.reg7')::uuid), 'pending');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_ok('the organizer accepts it', $q$select public.decide_registration(current_setting('t.reg7')::uuid, 'accepted')$q$);
select t.expect_eq('accepted with an entry', (select r.status || ':' || (select count(*) from public.entries e where e.fighter_id = r.fighter_id and e.competition_id = '00000000-0000-0000-0000-0000000c7001')::text from public.registrations r where r.id = current_setting('t.reg7')::uuid), 'accepted:1');

-- ---------------------------------------------------------------- 5. fighter social links
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.expect_ok('a fighter sets their own social links', $q$select public.update_my_fighter_profile(jsonb_build_object('social_links', jsonb_build_object('instagram', 'https://instagram.com/three', 'other', 'https://three.example/')))$q$);
select t.expect_error('a link without https:// is refused', $q$select public.update_my_fighter_profile(jsonb_build_object('social_links', jsonb_build_object('facebook', 'facebook.com/three')))$q$, '22023');
select t.expect_error('an unknown network is refused', $q$select public.update_my_fighter_profile(jsonb_build_object('social_links', jsonb_build_object('myspace', 'https://myspace.com/three')))$q$, '22023');
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_error('someone without a fighter cannot set links on anyone', $q$select public.update_my_fighter_profile(jsonb_build_object('social_links', jsonb_build_object('x', 'https://x.com/three')))$q$, '42501');
select t.as_anon();
select t.expect_eq('the public reads the links', (select social_links ->> 'instagram' from public.fighters where id = '00000000-0000-0000-0000-0000000f7003'), 'https://instagram.com/three');
select t.expect_eq('the other fighter''s links are untouched', (select social_links from public.fighters where id = '00000000-0000-0000-0000-0000000f7007'), '{}'::jsonb);

-- ---------------------------------------------------------------- 6. fighter gallery
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.expect_error('cannot upload into another fighter''s gallery folder', $q$insert into storage.objects (bucket_id, name) values ('fighter-gallery', '00000000-0000-0000-0000-0000000f7007/00000000-0000-0000-0000-00000000aa01.webp')$q$);
select t.expect_error('a row cannot point at a file that was not uploaded', $q$select public.add_my_gallery_photo('00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa01.webp')$q$, '22023');
do $$ declare i int; begin
  for i in 1..10 loop
    insert into storage.objects (bucket_id, name) values ('fighter-gallery', '00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa' || lpad(i::text, 2, '0') || '.webp');
    perform public.add_my_gallery_photo('00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa' || lpad(i::text, 2, '0') || '.webp');
  end loop;
end $$;
select t.expect_eq('ten photos in order', (select string_agg(sort_order::text, ',' order by sort_order) from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003'), '0,1,2,3,4,5,6,7,8,9');
insert into storage.objects (bucket_id, name) values ('fighter-gallery', '00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa11.webp');
select t.expect_error('the eleventh photo is refused', $q$select public.add_my_gallery_photo('00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa11.webp')$q$, '22023');
select t.expect_error('nobody can add a photo to another fighter''s gallery', $q$select public.add_my_gallery_photo('00000000-0000-0000-0000-0000000f7007/00000000-0000-0000-0000-00000000aa01.webp')$q$, '42501');
select t.expect_error('the gallery table is not writable directly', $q$insert into public.fighter_gallery (fighter_id, storage_path) values ('00000000-0000-0000-0000-0000000f7003', '00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa12.webp')$q$, '42501');
select t.expect_ok('the fighter removes one', $q$select public.remove_my_gallery_photo((select id from public.fighter_gallery where storage_path like '%aa05.webp'))$q$);
select t.expect_ok('and can remove the file from their own folder', $q$delete from storage.objects where bucket_id = 'fighter-gallery' and name like '%aa05.webp'$q$);
select t.expect_eq('the file is gone', (select count(*) from storage.objects where bucket_id = 'fighter-gallery' and name like '%aa05.webp'), 0::bigint);
select t.expect_ok('now the eleventh fits as the tenth', $q$select public.add_my_gallery_photo('00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa11.webp')$q$);
select t.expect_error('reordering must list every photo once', $q$select public.reorder_my_gallery(array(select id from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003' limit 3))$q$, '22023');
select t.expect_ok('the fighter reverses the order', $q$select public.reorder_my_gallery(array(select id from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003' order by sort_order desc))$q$);
select t.expect_eq('the newest is now first', (select storage_path from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003' order by sort_order limit 1), '00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa11.webp');
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.expect_error('another fighter cannot remove it', $q$select public.remove_my_gallery_photo((select id from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003' limit 1))$q$, '42501');
select t.expect_error('another fighter cannot reorder it', $q$select public.reorder_my_gallery(array(select id from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003'))$q$, '22023');
select t.expect_eq('another fighter cannot delete the files', (select count(*) from storage.objects where bucket_id = 'fighter-gallery' and (storage.foldername(name))[1] = '00000000-0000-0000-0000-0000000f7003'), 0::bigint);
select t.as_anon();
select t.expect_eq('the public sees the gallery rows', (select count(*) from public.fighter_gallery where fighter_id = '00000000-0000-0000-0000-0000000f7003'), 10::bigint);
select t.as_admin();
select t.expect_error('even the table owner cannot exceed ten', $q$insert into public.fighter_gallery (fighter_id, storage_path) values ('00000000-0000-0000-0000-0000000f7003', '00000000-0000-0000-0000-0000000f7003/00000000-0000-0000-0000-00000000aa12.webp')$q$, '22023');

-- ---------------------------------------------------------------- 7. my events: relationships, never platform power
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.expect_eq('the platform owner has no personal events just for being the owner', (select count(*) from public.my_event_relations()), 0::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.expect_eq('an organizer gets the events they organize', (select string_agg(event_id::text || ':' || role, ',' order by event_id) from public.my_event_relations()), '00000000-0000-0000-0000-0000000e7001:organizer,00000000-0000-0000-0000-0000000e7002:organizer');
select t.as_user('00000000-0000-0000-0000-0000000000d5');
select t.expect_eq('a medic gets the event they staff', (select string_agg(role, ',') from public.my_event_relations()), 'medic');
select t.as_user('00000000-0000-0000-0000-0000000000d6');
select t.expect_eq('a captain gets the events their team is entered in', (select string_agg(event_id::text || ':' || role, ',') from public.my_event_relations()), '00000000-0000-0000-0000-0000000e7001:captain');
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.expect_eq('a registered fighter gets the event as fighter', (select string_agg(role, ',') from public.my_event_relations() where event_id = '00000000-0000-0000-0000-0000000e7001'), 'fighter');
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.expect_eq('a stranger has none', (select count(*) from public.my_event_relations()), 0::bigint);
select t.as_anon();
select t.expect_error('anonymous visitors cannot call it', $q$select * from public.my_event_relations()$q$, '42501');

-- ---------------------------------------------------------------- 8. own-folder reads on the existing picture buckets
select t.as_user('00000000-0000-0000-0000-0000000000d3');
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000f7003/1700000000000.jpg');
select t.expect_eq('a fighter can list their own avatar files (needed to remove old ones)', (select count(*) from storage.objects where bucket_id = 'avatars'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.expect_eq('but not another fighter''s', (select count(*) from storage.objects where bucket_id = 'avatars'), 0::bigint);

select t.as_admin();
select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
