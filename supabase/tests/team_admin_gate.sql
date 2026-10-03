-- Checks for the team-admin, team-edit, photo, emblem, sign-up notification and first-sign-in features (migrations 0025xx-0029xx).
-- Plays each role against the schema. LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/team_admin_gate.sql
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


-- ---------------------------------------------------------------- fixtures (as the database owner)
-- People: owner, platform organizer, NACL org admin, other-org admin, captain, fighter, stranger, event organizer.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'owner@example.test'),
  ('00000000-0000-0000-0000-00000000aa02', 'platorg@example.test'),
  ('00000000-0000-0000-0000-00000000aa03', 'orgadmin@example.test'),
  ('00000000-0000-0000-0000-00000000aa04', 'otheradmin@example.test'),
  ('00000000-0000-0000-0000-00000000aa05', 'captain@example.test'),
  ('00000000-0000-0000-0000-00000000aa06', 'fighter@example.test'),
  ('00000000-0000-0000-0000-00000000aa07', 'stranger@example.test'),
  ('00000000-0000-0000-0000-00000000aa08', 'evorg@example.test'),
  ('00000000-0000-0000-0000-00000000aa09', 'newcaptain@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-00000000aa01', 'owner'), ('00000000-0000-0000-0000-00000000aa02', 'organizer');
insert into public.organizations (id, slug, name, kind) values
  ('00000000-0000-0000-0000-00000000ab01', 'league-a', 'League A', 'regional'),
  ('00000000-0000-0000-0000-00000000ab02', 'league-b', 'League B', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000aa03', 'admin'),
  ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-00000000aa04', 'admin');
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-00000000ac01', 'bears', 'Bears', 'approved', 'Red Deer', 'CA'),
  ('00000000-0000-0000-0000-00000000ac02', 'wolves', 'Wolves', 'approved', 'Calgary', 'CA');
insert into public.team_affiliations (team_id, organization_id, relation) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ab01', 'member'),
  ('00000000-0000-0000-0000-00000000ac02', '00000000-0000-0000-0000-00000000ab02', 'member');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000aa05', 'captain');
insert into public.fighters (id, display_name, team_id) values ('00000000-0000-0000-0000-00000000ad01', 'Fighter One', '00000000-0000-0000-0000-00000000ac01');
insert into public.fighter_accounts (fighter_id, user_id) values ('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-00000000aa06');
insert into public.events (id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000ae01', 'rumble', 'Rumble', current_date + 30, current_date + 31);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa08', 'organizer');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000af01', '00000000-0000-0000-0000-00000000ae01', 1, 'Waiver', 'Waiver text for the test.');

-- ---------------------------------------------------------------- my_team_ids / my_fighter_id
select t.as_user('00000000-0000-0000-0000-00000000aa06');
select t.expect_eq('fighter: my_team_ids is their home team', (select array_agg(x) from public.my_team_ids() x), array['00000000-0000-0000-0000-00000000ac01'::uuid]);
select t.expect_eq('fighter: my_fighter_id is their record', public.my_fighter_id(), '00000000-0000-0000-0000-00000000ad01'::uuid);
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_eq('captain: my_team_ids is the team they captain', (select array_agg(x) from public.my_team_ids() x), array['00000000-0000-0000-0000-00000000ac01'::uuid]);
select t.expect_eq('captain: no fighter record', public.my_fighter_id(), null::uuid);
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_eq('stranger: on no team', (select count(*) from public.my_team_ids()), 0::bigint);
select t.as_anon();
select t.expect_error('anon cannot call my_team_ids', 'select public.my_team_ids()', '42501');

-- ---------------------------------------------------------------- naming captains
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_error('stranger cannot name a captain', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', 'newcaptain@example.test')$q$, '42501');
select t.expect_error('stranger cannot list captains', $q$select * from public.list_team_captains('00000000-0000-0000-0000-00000000ac01')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_error('a captain cannot name another captain', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', 'newcaptain@example.test')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa04');
select t.expect_error('admin of ANOTHER organization cannot name a captain here', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', 'newcaptain@example.test')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa03');
select t.expect_error('org admin: unknown email is refused clearly', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', 'nobody@example.test')$q$, 'P0002');
select t.expect_ok('org admin names a captain for a member team', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', ' NewCaptain@Example.test ')$q$);
select t.expect_eq('... and sees both captains with names and emails', (select count(*) from public.list_team_captains('00000000-0000-0000-0000-00000000ac01')), 2::bigint);
select t.expect_ok('naming the same captain twice is harmless', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac01', 'newcaptain@example.test')$q$);
select t.expect_error('org admin cannot name captains for a team outside their organization', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac02', 'newcaptain@example.test')$q$, '42501');
select t.expect_ok('org admin removes a captain', $q$select public.remove_team_captain('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000aa09')$q$);
select t.expect_eq('... gone', (select count(*) from public.list_team_captains('00000000-0000-0000-0000-00000000ac01')), 1::bigint);
select t.as_user('00000000-0000-0000-0000-00000000aa02');
select t.expect_error('a platform-role organizer (event creator) cannot name a captain on any team', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac02', 'newcaptain@example.test')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.expect_ok('owner names a captain on any team', $q$select public.assign_team_captain('00000000-0000-0000-0000-00000000ac02', 'newcaptain@example.test')$q$);
select t.expect_ok('owner removes it again', $q$select public.remove_team_captain('00000000-0000-0000-0000-00000000ac02', '00000000-0000-0000-0000-00000000aa09')$q$);
select t.as_admin();
select t.expect_eq('captain changes are audited', (select count(*) from public.audit_log where action in ('team.captain_assigned', 'team.captain_removed')), 5::bigint);

-- ---------------------------------------------------------------- editing a team
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_eq('stranger: cannot edit', public.can_edit_team('00000000-0000-0000-0000-00000000ac01'), false);
select t.expect_error('stranger cannot update a team', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"description":"Hijacked description"}')$q$, '42501');
select t.expect_error('nobody writes teams directly', $q$update public.teams set description = 'x' where id = '00000000-0000-0000-0000-00000000ac01'$q$);
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_eq('captain: can edit', public.can_edit_team('00000000-0000-0000-0000-00000000ac01'), true);
select t.expect_eq('captain: cannot rename', public.can_rename_team('00000000-0000-0000-0000-00000000ac01'), false);
select t.expect_eq('captain: cannot edit another team', public.can_edit_team('00000000-0000-0000-0000-00000000ac02'), false);
select t.expect_ok('captain updates the page', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"description":"We train on Tuesdays.","website":"https://bears.example","colors":["#112233","#AABBCC"],"crest_division":"bend","initial":"b","founded_year":2019,"social_links":{"instagram":"https://instagram.com/bears"},"claimed_organizations":["League A"],"region":null}')$q$);
select t.as_admin();
select t.expect_eq('... saved, initial upper-cased, region cleared', (select (description, website, colors[1], crest_division, initial, founded_year, social_links ->> 'instagram', region) from public.teams where id = '00000000-0000-0000-0000-00000000ac01')::text,
  '("We train on Tuesdays.",https://bears.example,#112233,bend,B,2019,https://instagram.com/bears,)');
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_error('captain cannot rename', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"name":"Not Bears"}')$q$, '42501');
select t.expect_error('a non-https website is refused', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"website":"http://bears.example"}')$q$, '22023');
select t.expect_error('a too-short description is refused', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"description":"short"}')$q$, '22023');
select t.expect_error('the city cannot be emptied', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"city":""}')$q$, '22023');
select t.expect_error('an unknown field is refused', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"status":"approved"}')$q$, '22023');
select t.expect_error('a bad colour is refused', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"colors":["red","blue"]}')$q$, '22023');
select t.expect_error('a slug cannot be changed', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"slug":"x"}')$q$, '22023');
select t.as_user('00000000-0000-0000-0000-00000000aa03');
select t.expect_eq('org admin: can rename a member team', public.can_rename_team('00000000-0000-0000-0000-00000000ac01'), true);
select t.expect_ok('org admin renames', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac01', '{"name":"Mountain Bears"}')$q$);
select t.expect_error('org admin cannot edit a team in another organization', $q$select public.update_team_profile('00000000-0000-0000-0000-00000000ac02', '{"description":"Not my team at all."}')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.expect_eq('owner: can edit and rename any team', (public.can_edit_team('00000000-0000-0000-0000-00000000ac02') and public.can_rename_team('00000000-0000-0000-0000-00000000ac02')), true);

-- ---------------------------------------------------------------- team emblem (storage + pointer)
select t.as_user('00000000-0000-0000-0000-00000000aa05');
select t.expect_ok('captain uploads into the team folder', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', '00000000-0000-0000-0000-00000000ac01/1700000000000.png')$q$);
select t.expect_error('captain cannot upload into another team folder', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', '00000000-0000-0000-0000-00000000ac02/1700000000000.png')$q$);
select t.expect_error('a folder that is not a team id is refused', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', 'not-a-uuid/1.png')$q$);
select t.expect_ok('captain points the team at it', $q$select public.set_team_emblem('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac01/1700000000000.png')$q$);
select t.expect_error('captain cannot point at a file in another team folder', $q$select public.set_team_emblem('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac02/1.png')$q$, '42501');
select t.expect_ok('captain clears the emblem', $q$select public.set_team_emblem('00000000-0000-0000-0000-00000000ac01', null)$q$);
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_error('stranger cannot upload an emblem', $q$insert into storage.objects (bucket_id, name) values ('team-emblems', '00000000-0000-0000-0000-00000000ac01/2.png')$q$);
select t.expect_error('stranger cannot set an emblem', $q$select public.set_team_emblem('00000000-0000-0000-0000-00000000ac01', null)$q$, '42501');

-- ---------------------------------------------------------------- profile photo
select t.as_user('00000000-0000-0000-0000-00000000aa06');
select t.expect_ok('fighter uploads a photo into their own folder', $q$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000ad01/1700000000000.jpg')$q$);
select t.expect_error('fighter cannot upload into someone else''s folder', $q$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000ad99/1.jpg')$q$);
select t.expect_ok('fighter sets the photo', $q$select public.set_my_fighter_avatar('00000000-0000-0000-0000-00000000ad01/1700000000000.jpg')$q$);
select t.expect_error('fighter cannot point at a file outside their folder', $q$select public.set_my_fighter_avatar('00000000-0000-0000-0000-00000000ad99/1.jpg')$q$, '42501');
select t.as_anon();
select t.expect_eq('the public profile shows the photo path', (select avatar_path from public.fighter_profile('00000000-0000-0000-0000-00000000ad01')), '00000000-0000-0000-0000-00000000ad01/1700000000000.jpg');
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_error('someone with no fighter record cannot set a photo', $q$select public.set_my_fighter_avatar(null)$q$, '42501');
select t.expect_error('or upload one', $q$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000ad01/9.jpg')$q$);

-- ---------------------------------------------------------------- first sign-in profile
select t.as_user('00000000-0000-0000-0000-00000000aa07');
select t.expect_error('a name is required', $q$select public.complete_my_profile(' ', array['fan'])$q$, '22023');
select t.expect_error('at least one way of taking part is required', $q$select public.complete_my_profile('Sam Stranger', array[]::text[])$q$, '22023');
select t.expect_error('unknown choices are refused', $q$select public.complete_my_profile('Sam Stranger', array['king'])$q$, '22023');
select t.expect_ok('the profile is saved', $q$select public.complete_my_profile('Sam Stranger', array['fan','fighter','fan'], 'Red Deer', null, 'Canada')$q$);
select t.expect_eq('... onboarded, choices de-duplicated, own row readable', (select (display_name, onboarded_at is not null, cardinality(interests), city) from public.profiles where id = '00000000-0000-0000-0000-00000000aa07')::text, '("Sam Stranger",t,2,"Red Deer")');
select t.as_user('00000000-0000-0000-0000-00000000aa06');
select t.expect_eq('other people''s profiles stay private', (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000aa07'), 0::bigint);

-- ---------------------------------------------------------------- sign-up notifications
select t.as_admin();
insert into public.registrations (id, event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer)
values ('00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000aa06', 'pending', 'Fighter One', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000af01', 'Fighter One', false);
select t.expect_eq('a new sign-up notifies the event organizer', (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa08' and kind = 'registration_submitted' and payload ->> 'person_name' = 'Fighter One'), 1::bigint);
select t.expect_eq('... and not the person who signed up', (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa06'), 0::bigint);
select t.expect_eq('... and not the owner, since the event has an organizer', (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa01' and kind = 'registration_submitted'), 0::bigint);
update public.registrations set status = 'accepted' where id = '00000000-0000-0000-0000-00000000ba01';
select t.expect_eq('accepting notifies the person', (select payload ->> 'decision' from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa06' and kind = 'registration_decided'), 'accepted');
select t.expect_eq('... and marks the organizer''s notice read', (select read_at is not null from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa08' and kind = 'registration_submitted'), true);
insert into public.events (id, slug, name, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000ae02', 'lonely', 'Lonely', current_date + 40, current_date + 40);
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000af02', '00000000-0000-0000-0000-00000000ae02', 1, 'Waiver', 'Waiver text for the test.');
insert into public.registrations (id, event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name)
values ('00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000aa07', 'pending', 'Sam Stranger', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000af02', 'Sam Stranger');
select t.expect_eq('an event with no organizer notifies the owner instead', (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-00000000aa01' and kind = 'registration_submitted'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-00000000aa06');
select t.expect_eq('the person reads their decision through my_notifications', (select count(*) from public.my_notifications(50) where kind = 'registration_decided'), 1::bigint);
select t.expect_error('nobody reads the notifications table directly', 'select * from public.notifications');

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
