-- Pack 08 gate: organizer-added entrants without accounts, and claiming an unclaimed fighter.
-- Proves: only the event's organizer can search/create/add; a created fighter is a normal record with no account and no auth user; it works in the
-- draw, scoring and results; claims never link anything by themselves; only the platform administrator decides; approval links the account to the
-- ORIGINAL fighter UUID and nothing else moves; a claimed fighter cannot be claimed again; an account that owns a fighter is never given another;
-- normal self-registration still works and surfaces look-alikes for review instead of guessing.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack08_gate.sql
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
create function t.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function t.id(p text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
-- notifications have no table grant; the gate reads them through a definer helper
create function t.notifs(u uuid, k text) returns setof public.notifications language sql security definer as $$ select * from public.notifications where user_id = u and kind = k $$;
create function t.fin(p_match uuid, p_res text, p_a int, p_b int) returns integer language sql as $$
  select public.finalize_match(p_match, p_res, p_a, p_b, '{}'::jsonb, (select version from public.matches where id = p_match))
$$;
create function t.rr(p_key text, p_pos int, a uuid, b uuid) returns jsonb language sql immutable as $$
  select jsonb_build_object('key', p_key, 'stage', 'round_robin', 'round_label', 'Round ' || (p_pos + 1), 'position', p_pos, 'a', a, 'b', b)
$$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- d1 platform owner; d2 organizer of E1; d3 organizer of E2 only; d4 scorekeeper of E1 (staff, not organizer); d5 stranger;
-- d6 / d7 claimants without a fighter; d8 owns fighter F8; d9 registers for E1 the ordinary way
insert into auth.users (id, email) select t.uid(n), 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values (t.uid(1), 'owner');
insert into public.profiles (id, display_name) select t.uid(n), 'Person ' || n from generate_series(2, 9) n on conflict (id) do update set display_name = excluded.display_name;
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  (t.id('e801'), 'e8-one', 'Event One', 'published', current_date + 20, current_date + 21),
  (t.id('e802'), 'e8-two', 'Event Two', 'published', current_date + 20, current_date + 21);
insert into public.event_staff (event_id, user_id, role) values
  (t.id('e801'), t.uid(2), 'organizer'), (t.id('e802'), t.uid(3), 'organizer'), (t.id('e801'), t.uid(4), 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) values
  (t.id('c801'), 'team-one', 'Team One', 'approved', 'Red Deer', 'CA'), (t.id('c802'), 'team-two', 'Team Two', 'approved', 'Calgary', 'CA'),
  (t.id('c803'), 'team-pending', 'Team Pending', 'pending', 'Edmonton', 'CA');
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  (t.id('b801'), t.id('e801'), 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('b802'), t.id('e801'), 'Melee 5v5 (men)', '5v5', 'men', 'Classic', 'round_robin'),
  (t.id('b803'), t.id('e802'), 'Longsword (E2)', 'longsword', 'men', 'Classic', 'round_robin'),
  (t.id('b804'), t.id('e801'), 'Finished longsword', 'longsword', 'women', 'Classic', 'round_robin'),
  (t.id('b805'), t.id('e801'), 'Polearm (men)', 'polearm', 'men', 'Classic', 'round_robin');
update public.competitions set status = 'finished' where id = t.id('b804');
-- an existing, unclaimed fighter (historical record), a fighter that belongs to d8, and a fictional one
insert into public.fighters (id, display_name, team_id, city, region) values
  (t.id('f801'), 'Alex Existing', t.id('c801'), 'Red Deer', 'AB'),
  (t.id('f808'), 'Eight Account', null, null, null),
  (t.id('f809'), 'Fictional Fighter', null, null, null);
insert into public.fighter_accounts (fighter_id, user_id) values (t.id('f808'), t.uid(8));
insert into public.sources (id, kind, title, citation, synthetic) values (t.id('b901'), 'imported', 'Fictional league', 'test', true);
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (t.id('b901'), 'fighter', t.id('f809'), 'imported', 'fiction');
insert into public.waiver_versions (id, event_id, version, title, body) values (t.id('a801'), t.id('e801'), 1, 'Waiver', 'Waiver text for the test, long enough to be real.');

-- ================================================================ 1. who may search, create and add
select t.as_anon();
select t.expect_error('anon cannot search for entrants', $q$select * from public.search_fighters_for_entry(t.id('b801'), 'alex')$q$, '42501');
select t.expect_error('anon cannot create a fighter', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Nobody Anon')$q$, '42501');
select t.expect_error('anon cannot add an entrant', $q$select public.add_entrant(t.id('b801'), t.id('f801'))$q$, '42501');
select t.as_user(t.uid(5));
select t.expect_error('a stranger cannot search for entrants', $q$select * from public.search_fighters_for_entry(t.id('b801'), 'alex')$q$, '42501');
select t.expect_error('a stranger cannot create a fighter for an event', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Nobody Stranger')$q$, '42501');
select t.expect_error('a stranger cannot add an entrant', $q$select public.add_entrant(t.id('b801'), t.id('f801'))$q$, '42501');
select t.as_user(t.uid(4));
select t.expect_error('a scorekeeper (staff, not organizer) cannot add an entrant', $q$select public.add_entrant(t.id('b801'), t.id('f801'))$q$, '42501');
select t.expect_error('a scorekeeper cannot create a fighter', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Nobody Score')$q$, '42501');
select t.as_user(t.uid(3));
select t.expect_error('an organizer of ANOTHER event cannot add an entrant to this event', $q$select public.add_entrant(t.id('b801'), t.id('f801'))$q$, '42501');
select t.expect_error('... cannot create a fighter for this event', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Nobody Other')$q$, '42501');
select t.expect_error('... cannot search this event''s competition', $q$select * from public.search_fighters_for_entry(t.id('b801'), 'alex')$q$, '42501');
select t.expect_error('... and cannot smuggle in a competition of the other event', $q$select public.create_unclaimed_fighter(t.id('e802'), 'Nobody Smuggle', null, null, null, null, false, t.id('b801'))$q$, '22023');
select t.as_admin();
select t.expect_eq('none of that created a fighter', (select count(*) from public.fighters where display_name like 'Nobody%'), 0::bigint);

-- ================================================================ 2. search shows enough to tell people apart
select t.as_user(t.uid(2));
select t.expect_eq('search finds the existing fighter with team, place and "unclaimed"',
  (select display_name || '|' || team_name || '|' || city || '|' || region || '|' || claimed::text || '|' || in_competition::text from public.search_fighters_for_entry(t.id('b801'), 'alex')),
  'Alex Existing|Team One|Red Deer|AB|false|false');
select t.expect_eq('search also matches the team name', (select count(*) from public.search_fighters_for_entry(t.id('b801'), 'team one')), 1::bigint);
select t.expect_eq('a one-letter search returns nothing', (select count(*) from public.search_fighters_for_entry(t.id('b801'), 'a')), 0::bigint);
select t.expect_eq('fictional fighters are not offered for a real event', (select count(*) from public.search_fighters_for_entry(t.id('b801'), 'fictional')), 0::bigint);
select t.expect_eq('a claimed fighter is shown as claimed', (select claimed from public.search_fighters_for_entry(t.id('b801'), 'eight account')), true);

-- ================================================================ 3. creating an unclaimed fighter
select t.as_admin();
create table t.counts as select (select count(*) from auth.users) as users, (select count(*) from public.fighter_accounts) as accounts, (select count(*) from public.fighters) as fighters;
select t.as_user(t.uid(2));
select t.expect_error('a name that is too short is refused', $q$select public.create_unclaimed_fighter(t.id('e801'), 'A')$q$, '22023');
select t.expect_error('a gender outside the list is refused', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Gender Test', null, null, null, 'robot')$q$, '22023');
select t.expect_error('a team that is not approved is refused', $q$select public.create_unclaimed_fighter(t.id('e801'), 'Pending Team Test', t.id('c803'))$q$, '22023');
select t.expect_error('a name that already exists must be confirmed as a different person first', $q$select public.create_unclaimed_fighter(t.id('e801'), '  alex   EXISTING ')$q$, '22023');
select t.expect_ok('the organizer creates a new fighter and enters them in one step',
  $q$select set_config('t.zed', public.create_unclaimed_fighter(t.id('e801'), 'Zed Newcomer', t.id('c801'), 'Lacombe', 'AB', 'male', false, t.id('b801')) ->> 'fighter_id', true)$q$);
select t.as_admin();
select t.expect_eq('the fighter is a normal record with the typed details', (select display_name || '|' || team_id::text || '|' || city || '|' || gender from public.fighters where id = current_setting('t.zed')::uuid), 'Zed Newcomer|' || t.id('c801')::text || '|Lacombe|male');
select t.expect_eq('no auth user was made', (select count(*) from auth.users), (select users from t.counts));
select t.expect_eq('no account is linked', (select count(*) from public.fighter_accounts where fighter_id = current_setting('t.zed')::uuid), 0::bigint);
select t.expect_eq('the fighter is on the competition''s normal entry list', (select count(*) from public.entries where competition_id = t.id('b801') and fighter_id = current_setting('t.zed')::uuid and status = 'registered'), 1::bigint);
select t.expect_eq('the organizer entry is audited with the event', (select count(*) from public.audit_log where event_id = t.id('e801') and action = 'fighter.created_by_organizer' and subject = current_setting('t.zed')), 1::bigint);
select t.expect_eq('... and so is the entrant being added', (select count(*) from public.audit_log where event_id = t.id('e801') and action = 'entrant.added' and subject = current_setting('t.zed')), 1::bigint);
select t.expect_eq('a name with no look-alike opens no review', (select count(*) from public.fighter_identity_reviews where fighter_id = current_setting('t.zed')::uuid), 0::bigint);
select t.as_anon();
select t.expect_eq('the public sees the fighter (public record) and that it is unclaimed', (select claimed from public.fighter_claim_states(array[current_setting('t.zed')::uuid])), false);
select t.as_user(t.uid(2));
select t.expect_ok('with the look-alike confirmed as a different person it is created',
  $q$select set_config('t.zed2', public.create_unclaimed_fighter(t.id('e801'), 'Alex Existing', t.id('c802'), 'Calgary', 'AB', null, true, t.id('b801')) ->> 'fighter_id', true)$q$);
select t.as_admin();
select t.expect_eq('the second Alex is a separate record: nothing was matched or merged by name', (select count(*) from public.fighters where display_name = 'Alex Existing'), 2::bigint);
select t.expect_eq('the look-alike was put in front of the administrator', (select source || ':' || reason || ':' || status from public.fighter_identity_reviews where fighter_id = current_setting('t.zed2')::uuid and candidate_id = t.id('f801')), 'organizer_entry:same_name:open');
select t.expect_eq('the existing fighter was not touched', (select team_id from public.fighters where id = t.id('f801')), t.id('c801'));

-- ================================================================ 4. adding to competitions through the normal paths
select t.as_user(t.uid(2));
select t.expect_eq('search marks who is already in this competition', (select in_competition from public.search_fighters_for_entry(t.id('b801'), 'zed newcomer')), true);
select t.expect_eq('adding an existing fighter creates a normal fighter entry', (public.add_entrant(t.id('b801'), t.id('f801')) ->> 'kind'), 'fighter');
select t.expect_eq('adding the same fighter again changes nothing', (public.add_entrant(t.id('b801'), t.id('f801')) ->> 'already'), 'true');
select t.as_admin();
select t.expect_eq('one entry only', (select count(*) from public.entries where competition_id = t.id('b801') and fighter_id = t.id('f801')), 1::bigint);
update public.entries set status = 'withdrawn' where competition_id = t.id('b801') and fighter_id = t.id('f801');
select t.as_user(t.uid(2));
select t.expect_ok('a withdrawn entrant can be put back by adding them again', $q$select public.add_entrant(t.id('b801'), t.id('f801'))$q$);
select t.as_admin();
select t.expect_eq('... as a registered entry', (select status from public.entries where competition_id = t.id('b801') and fighter_id = t.id('f801')), 'registered');
select t.as_user(t.uid(2));
select t.expect_error('a finished competition takes no new entrants', $q$select public.add_entrant(t.id('b804'), t.id('f801'))$q$, 'P0001');
select t.expect_error('an individual competition does not take a team', $q$select public.add_entrant(t.id('b801'), t.id('f801'), t.id('c801'))$q$, '22023');
select t.expect_error('a group fight needs the team the fighter fights for', $q$select public.add_entrant(t.id('b802'), t.id('f801'))$q$, '22023');
select t.expect_eq('a group fight: the fighter joins the team''s roster through the normal roster path', (public.add_entrant(t.id('b802'), t.id('f801'), t.id('c801')) ->> 'kind'), 'team');
select t.expect_eq('an unclaimed fighter with no team joins as a guest', (public.add_entrant(t.id('b802'), current_setting('t.zed')::uuid, t.id('c801')) ->> 'kind'), 'team');
select t.as_admin();
select t.expect_eq('the team entry was made and carries both fighters with the usual roles',
  (select string_agg(f.display_name || ':' || ef.role, ',' order by f.display_name) from public.entry_fighters ef join public.fighters f on f.id = ef.fighter_id where ef.competition_id = t.id('b802')),
  'Alex Existing:fighter,Zed Newcomer:fighter');
select t.expect_eq('the roster rule is the existing one: the roster is audited', (select count(*) from public.audit_log where event_id = t.id('e801') and action = 'entry.roster_set') >= 2, true);
select t.as_user(t.uid(2));
select t.expect_error('a fighter cannot be on two teams in one competition', $q$select public.add_entrant(t.id('b802'), t.id('f801'), t.id('c802'))$q$, '22023');
select t.expect_eq('both appear as participants of the event', (select count(distinct fighter_id) from public.fighter_participation where event_id = t.id('e801') and fighter_id in (t.id('f801'), current_setting('t.zed')::uuid)), 2::bigint);

-- ================================================================ 5. draw, scoring and results work for entrants without accounts
select t.expect_ok('three entrants for a draw: two without accounts', $q$select public.add_entrant(t.id('b805'), t.id('f801')), public.add_entrant(t.id('b805'), current_setting('t.zed')::uuid), public.add_entrant(t.id('b805'), current_setting('t.zed2')::uuid)$q$);
select t.expect_ok('the draw is built from those entries',
  $q$select public.build_schedule(t.id('b805'), jsonb_build_array(
      t.rr('m1', 0, (select id from public.entries where competition_id = t.id('b805') and fighter_id = t.id('f801')), (select id from public.entries where competition_id = t.id('b805') and fighter_id = current_setting('t.zed')::uuid)),
      t.rr('m2', 1, (select id from public.entries where competition_id = t.id('b805') and fighter_id = t.id('f801')), (select id from public.entries where competition_id = t.id('b805') and fighter_id = current_setting('t.zed2')::uuid)),
      t.rr('m3', 2, (select id from public.entries where competition_id = t.id('b805') and fighter_id = current_setting('t.zed')::uuid), (select id from public.entries where competition_id = t.id('b805') and fighter_id = current_setting('t.zed2')::uuid))), 'new', null)$q$);
select t.expect_ok('the matches are scored', $q$select t.fin(m.id, case when m.position < 2 then 'a' else 'b' end, case when m.position < 2 then 5 else 1 end, case when m.position < 2 then 1 else 5 end) from public.matches m where m.competition_id = t.id('b805') order by m.position$q$);
select t.expect_eq('the competition finishes and ranks all three', public.finish_competition(t.id('b805')), 3);
select t.as_admin();
select t.expect_eq('official results exist for the entrants without accounts', (select count(*) from public.fighter_results where competition_id = t.id('b805') and fighter_id in (t.id('f801'), current_setting('t.zed')::uuid, current_setting('t.zed2')::uuid)), 3::bigint);
select t.expect_eq('... and match statistics', (select count(*) from public.fighter_match_rows where fighter_id = current_setting('t.zed')::uuid), 2::bigint);
create table t.before_claim as
  select (select count(*) from public.fighter_results where fighter_id = current_setting('t.zed')::uuid) as results,
         (select count(*) from public.fighter_participation where fighter_id = current_setting('t.zed')::uuid) as parts,
         (select count(*) from public.fighter_match_rows where fighter_id = current_setting('t.zed')::uuid) as matches,
         (select count(*) from public.entries) as entries, (select count(*) from public.fighters) as fighters;

-- ================================================================ 6. claims: asking never links anything
select t.as_user(t.uid(6));
select t.expect_eq('a claimant finds the unclaimed fighter by name and team, with context', (select display_name || '|' || team_name || '|' || entries::text || '|' || last_event from public.search_unclaimed_fighters('zed team one')), 'Zed Newcomer|Team One|3|Event One');
select t.expect_eq('claimed and fictional profiles are not offered', (select count(*) from public.search_unclaimed_fighters('eight account')) + (select count(*) from public.search_unclaimed_fighters('fictional')), 0::bigint);
select t.expect_error('a user cannot give themselves a fighter directly', format($q$insert into public.fighter_accounts (fighter_id, user_id) values (%L, %L)$q$, current_setting('t.zed')::uuid, t.uid(6)), '42501');
select t.expect_error('a user cannot write claim requests directly', format($q$insert into public.fighter_claim_requests (fighter_id, claimant, status) values (%L, %L, 'approved')$q$, current_setting('t.zed')::uuid, t.uid(6)), '42501');
select t.expect_error('a user cannot read the claim table', $q$select * from public.fighter_claim_requests$q$, '42501');
select t.expect_ok('d6 asks to claim Zed', $q$select set_config('t.req6', public.request_fighter_claim(current_setting('t.zed')::uuid, 'I fought at Event One for Team One') ->> 'request_id', true)$q$);
select t.expect_eq('asking again returns the same request, not a second one', (public.request_fighter_claim(current_setting('t.zed')::uuid) ->> 'request_id'), current_setting('t.req6'));
select t.expect_eq('the request is waiting and links nothing', (select status from public.my_fighter_claims() where request_id = current_setting('t.req6')::uuid), 'pending');
select t.expect_eq('d6 still has no fighter', (select public.my_fighter_id()), null::uuid);
select t.expect_error('d6 cannot approve their own request', format($q$select public.resolve_fighter_claim(%L, 'approve', 'it is me')$q$, current_setting('t.req6')::uuid), '42501');
select t.expect_error('a claim on an already claimed profile is refused', $q$select public.request_fighter_claim(t.id('f808'))$q$, '22023');
select t.expect_error('a claim on a fictional profile is refused', $q$select public.request_fighter_claim(t.id('f809'))$q$, '22023');
select t.expect_error('a claim on a profile that does not exist is refused', $q$select public.request_fighter_claim(t.id('ffff'))$q$, 'P0002');
select t.as_user(t.uid(7));
select t.expect_eq('d7 sees none of d6''s requests', (select count(*) from public.my_fighter_claims()), 0::bigint);
select t.expect_ok('a second person asks for the same profile', $q$select set_config('t.req7', public.request_fighter_claim(current_setting('t.zed')::uuid, 'That is me') ->> 'request_id', true)$q$);
select t.expect_error('d7 cannot cancel d6''s request', format($q$select public.cancel_fighter_claim(%L)$q$, current_setting('t.req6')::uuid), 'P0002');
select t.as_user(t.uid(2));
select t.expect_error('the event organizer cannot list claims', $q$select * from public.list_fighter_claims()$q$, '42501');
select t.expect_error('the event organizer cannot decide a claim, even on a fighter they created', format($q$select public.resolve_fighter_claim(%L, 'approve', 'organizer says so')$q$, current_setting('t.req6')::uuid), '42501');
select t.as_user(t.uid(5));
select t.expect_error('a stranger cannot list claims', $q$select * from public.list_fighter_claims()$q$, '42501');
select t.as_anon();
select t.expect_error('anon cannot ask for a claim', $q$select public.request_fighter_claim(t.id('f801'))$q$, '42501');
select t.as_admin();
select t.expect_eq('the platform administrator was told', (select count(*) from t.notifs(t.uid(1), 'fighter_claim_requested')), 2::bigint);

-- ================================================================ 7. the administrator decides
select t.as_user(t.uid(1));
select t.expect_eq('the administrator sees both requests with context', (select string_agg((claimant ->> 'email') || '>' || (fighter ->> 'name') || '>' || (fighter ->> 'origin'), ',' order by claimant ->> 'email') from public.list_fighter_claims()),
  'u6@example.test>Zed Newcomer>Event One,u7@example.test>Zed Newcomer>Event One');
select t.expect_error('a decision needs a note', format($q$select public.resolve_fighter_claim(%L, 'approve', 'no')$q$, current_setting('t.req6')::uuid), '22023');
select t.expect_error('a decision must be approve or decline', format($q$select public.resolve_fighter_claim(%L, 'maybe', 'because')$q$, current_setting('t.req6')::uuid), '22023');
select t.expect_eq('approval links the account', public.resolve_fighter_claim(current_setting('t.req6')::uuid, 'approve', 'Confirmed with the team captain'), 'approved');
select t.expect_error('a decision cannot be made twice', format($q$select public.resolve_fighter_claim(%L, 'approve', 'again')$q$, current_setting('t.req6')::uuid), 'P0001');
select t.as_admin();
select t.expect_eq('the account is linked to the ORIGINAL fighter record', (select fighter_id from public.fighter_accounts where user_id = t.uid(6)), current_setting('t.zed')::uuid);
select t.expect_eq('no fighter was created, copied or merged', (select count(*) from public.fighters), (select fighters from t.before_claim));
select t.expect_eq('no entry was created or moved', (select count(*) from public.entries), (select entries from t.before_claim));
select t.expect_eq('results stay on the same fighter', (select count(*) from public.fighter_results where fighter_id = current_setting('t.zed')::uuid), (select results from t.before_claim));
select t.expect_eq('participation stays on the same fighter', (select count(*) from public.fighter_participation where fighter_id = current_setting('t.zed')::uuid), (select parts from t.before_claim));
select t.expect_eq('match history stays on the same fighter', (select count(*) from public.fighter_match_rows where fighter_id = current_setting('t.zed')::uuid), (select matches from t.before_claim));
select t.expect_eq('the fighter record itself is unchanged', (select display_name || '|' || team_id::text from public.fighters where id = current_setting('t.zed')::uuid), 'Zed Newcomer|' || t.id('c801')::text);
select t.expect_eq('the public now sees it as claimed', (select claimed from public.fighter_claim_states(array[current_setting('t.zed')::uuid])), true);
select t.expect_eq('the approval is audited (administrator only)', (select count(*) from public.audit_log where action = 'fighter.claim_approved' and subject = current_setting('t.zed') and event_id is null), 1::bigint);
select t.expect_eq('the claimant was told', (select (payload ->> 'decision') from t.notifs(t.uid(6), 'fighter_claim_decided')), 'approved');
select t.expect_eq('the other claimant''s request was closed and they were told', (select status from public.fighter_claim_requests where id = current_setting('t.req7')::uuid), 'declined');
select t.expect_eq('... with a notice', (select (payload ->> 'decision') from t.notifs(t.uid(7), 'fighter_claim_decided')), 'declined');
select t.as_user(t.uid(6));
select t.expect_eq('the new owner now has that fighter', public.my_fighter_id(), current_setting('t.zed')::uuid);
select t.expect_ok('and may edit their own profile', $q$select public.update_my_fighter_profile(jsonb_build_object('city', 'Lacombe'))$q$);
select t.as_user(t.uid(7));
select t.expect_error('a second claimant cannot take a claimed fighter', $q$select public.request_fighter_claim(current_setting('t.zed')::uuid)$q$, '22023');

-- a request that was waiting when the profile got claimed another way fails safely at approval
select t.as_admin();
insert into public.fighters (id, display_name) values (t.id('f810'), 'Race Target');
select t.as_user(t.uid(7));
select t.expect_ok('d7 asks for Race Target', $q$select set_config('t.reqrace', public.request_fighter_claim(t.id('f810')) ->> 'request_id', true)$q$);
select t.as_admin();
insert into public.fighter_accounts (fighter_id, user_id) values (t.id('f810'), t.uid(9));   -- another route claimed it first
select t.as_user(t.uid(1));
select t.expect_eq('approving the later request is refused safely', public.resolve_fighter_claim(current_setting('t.reqrace')::uuid, 'approve', 'checked'), 'already_claimed');
select t.as_admin();
select t.expect_eq('the profile still belongs to its first owner', (select user_id from public.fighter_accounts where fighter_id = t.id('f810')), t.uid(9));
select t.expect_eq('d7 got no fighter', (select count(*) from public.fighter_accounts where user_id = t.uid(7)), 0::bigint);
select t.expect_eq('the late request was closed', (select status from public.fighter_claim_requests where id = current_setting('t.reqrace')::uuid), 'declined');
delete from public.fighter_accounts where fighter_id = t.id('f810') and user_id = t.uid(9);

-- an account that already owns a fighter is never given another
select t.as_user(t.uid(8));
select t.expect_ok('d8 (owns a fighter) asks for another profile', $q$select set_config('t.req8', public.request_fighter_claim(t.id('f801'), 'I think this is also me') ->> 'request_id', true)$q$);
select t.expect_eq('it is routed to review', (select needs_review from public.my_fighter_claims() where request_id = current_setting('t.req8')::uuid), true);
select t.as_admin();
select t.expect_eq('a possible-duplicate identity review was opened for the administrator', (select source || ':' || reason || ':' || status from public.fighter_identity_reviews where fighter_id = t.id('f808') and candidate_id = t.id('f801')), 'claim:claim_conflict:open');
select t.as_user(t.uid(1));
select t.expect_eq('approving it is refused: no silent replace, merge or move', public.resolve_fighter_claim(current_setting('t.req8')::uuid, 'approve', 'looks right'), 'account_has_fighter');
select t.as_admin();
select t.expect_eq('d8 still has exactly their own fighter', (select string_agg(fighter_id::text, ',') from public.fighter_accounts where user_id = t.uid(8)), t.id('f808')::text);
select t.expect_eq('the target is still unclaimed', (select count(*) from public.fighter_accounts where fighter_id = t.id('f801')), 0::bigint);
select t.expect_eq('the request waits for a deliberate decision', (select status from public.fighter_claim_requests where id = current_setting('t.req8')::uuid), 'pending');
select t.as_user(t.uid(1));
select t.expect_eq('the administrator can decline it', public.resolve_fighter_claim(current_setting('t.req8')::uuid, 'decline', 'Separate people'), 'declined');
select t.expect_eq('the identity review lists truthfully which record has an account',
  (select (new_fighter ->> 'has_account') || ':' || (candidate ->> 'has_account') from public.list_fighter_identity_reviews() where source = 'organizer_entry' limit 1), 'false:false');
select t.expect_eq('... and for a claim conflict the claimant''s own record has one',
  (select (new_fighter ->> 'has_account') from public.list_fighter_identity_reviews() where source = 'claim' limit 1), 'true');
select t.as_user(t.uid(2));
select t.expect_error('an event organizer cannot read the identity reviews', $q$select * from public.list_fighter_identity_reviews()$q$, '42501');
select t.as_user(t.uid(7));
select t.expect_ok('a claimant can take their own request back', $q$select public.cancel_fighter_claim((public.request_fighter_claim(t.id('f801')) ->> 'request_id')::uuid)$q$);

-- ================================================================ 8. ordinary self-registration still works, and does not guess
select t.as_user(t.uid(9));
select t.expect_ok('an ordinary registration is submitted',
  $q$select set_config('t.reg9', public.submit_registration(t.id('e801'), jsonb_build_object('full_name', 'Alex Existing', 'gender', 'male', 'organization', 'HACSA', 'province', 'AB', 'insurance', 'hacsa_member',
    'is_volunteer', false, 'waiver_agree', true, 'waiver_version_id', t.id('a801'), 'waiver_signed_name', 'Alex Existing', 'days', jsonb_build_array('sat'),
    'competitions', jsonb_build_array(jsonb_build_object('competition_id', t.id('b801'))),
    'private', jsonb_build_object('email', 'nine@example.test', 'emergency_name', 'Pat', 'emergency_phone', '4035550100', 'medically_fit', true)))::text, true)$q$);
select t.expect_eq('it waits for review as before', (select status from public.registrations where id = current_setting('t.reg9')::uuid), 'pending');
select t.as_user(t.uid(2));
select t.expect_ok('the organizer accepts it', $q$select public.decide_registration(current_setting('t.reg9')::uuid, 'accepted')$q$);
select t.as_admin();
select t.expect_eq('the account got its own fighter (never an unclaimed look-alike by name)', (select count(*) from public.fighter_accounts where user_id = t.uid(9)), 1::bigint);
select t.expect_eq('... which is not any of the Alex records that already existed', (select count(*) from public.fighter_accounts where user_id = t.uid(9) and fighter_id in (t.id('f801'), current_setting('t.zed2')::uuid)), 0::bigint);
select t.expect_eq('the unclaimed Alex records stay unclaimed', (select count(*) from public.fighter_accounts where fighter_id in (t.id('f801'), current_setting('t.zed2')::uuid)), 0::bigint);
select t.expect_eq('the look-alikes were put in front of the administrator instead', (select count(*) from public.fighter_identity_reviews where source = 'registration' and status = 'open'), 2::bigint);
select t.expect_eq('the registered fighter has the entry', (select count(*) from public.entries e join public.fighter_accounts a on a.fighter_id = e.fighter_id where a.user_id = t.uid(9) and e.competition_id = t.id('b801')), 1::bigint);

select t.as_admin();
select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
