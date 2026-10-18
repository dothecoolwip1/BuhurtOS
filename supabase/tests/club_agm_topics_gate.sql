-- Club AGM topics and nominations gate (migration 20261017000100_club_agm_topics_nominations.sql).
--   * members submit topics, see their own, edit/withdraw their OWN until the meeting starts or it is addressed; nobody touches another member's
--   * the executive (President/Secretary/Treasurer) sets Submitted / Added to Agenda / Addressed; any executive looks; others get nothing; nothing is deleted
--   * only members who can vote nominate; yourself = accepted at once; someone else = awaiting THEIR answer; the nominator can never answer for them
--   * one live candidacy per member, office and AGM however many nominators; declined/withdrawn are kept; nominations never change team_officers
--   * nobody reads or writes these tables directly; other clubs and non-members get nothing
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/club_agm_topics_gate.sql
--   * a waived year's unpaid dues do not stop an otherwise eligible member voting; a normal year's still do; dues records/history keep working
--   * members act only on their OWN membership; RSVP is one row per member with append-only history; proxies are documented authority only
--   * invalid proxies are refused (self, ineligible holder, other club, holder who gave their own proxy, no authorization)
--   * check-in is separate from the RSVP, executive-only, snapshotted, with history; saved records and histories cannot be changed
--   * nobody reads or writes these tables directly; other clubs' executives and regular members get nothing (42501)
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/club_agm_gate.sql
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
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.ok(label text) returns void language plpgsql as $$ begin insert into t.log (name) values (label); end $$;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a6' || n, 12, '0'))::uuid $$;
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b6' || n, 12, '0'))::uuid $$;
create function t.r() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6a01'::uuid $$;
create function t.o() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6a02'::uuid $$;
create function t.mt() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6c01'::uuid $$;
create function t.omt() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000a6c02'::uuid $$;
-- read as the owner (callers' own RLS view would hide the rows being checked)
create function t.q(sql text) returns text language plpgsql security definer as $$ declare v text; begin execute sql into v; return v; end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- Club R (2026 fee WAIVED, 2027 normal) and club O.  u1 President R, u2 Secretary R, u3 Treasurer R, u4 Vice President R,
-- u5 Ann (active adult, dues unpaid), u6 Bo (active adult), u7 Cy (pending), u8 Di (active, under 18), u9 Ed (removed), u10 Fay (active),
-- u11 stranger (no membership), u12 Treasurer of O, u13 Oli (member of O).
insert into auth.users (id, email) select t.u(n), 'agm' || n || '@example.test' from generate_series(1, 13) n;
update public.profiles set display_name = 'Person ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 13) n);
insert into public.teams (id, slug, name, status) values (t.r(), 'agm-gate-r', 'Gate Club', 'approved'), (t.o(), 'agm-gate-o', 'Other Club', 'approved');
insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents, fee_waived) values
  (t.r(), 2026, '2026-01-01', '2026-12-31', 2000, true), (t.r(), 2027, '2027-01-01', '2027-12-31', 2000, false), (t.o(), 2026, '2026-01-01', '2026-12-31', 2000, false);
insert into public.team_officers (team_id, user_id, office) values
  (t.r(), t.u(1), 'president'), (t.r(), t.u(2), 'secretary'), (t.r(), t.u(3), 'treasurer'), (t.r(), t.u(4), 'vice_president'), (t.o(), t.u(12), 'treasurer');
insert into public.club_memberships (id, team_id, membership_year, user_id, status, full_name, date_of_birth, adult_confirmed, bylaws_agreed_at) values
  (t.m(1), t.r(), 2026, t.u(1), 'active', 'Pres Ident', null, true, now()),
  (t.m(3), t.r(), 2026, t.u(3), 'active', 'Trea Surer', null, true, now()),
  (t.m(5), t.r(), 2026, t.u(5), 'active', 'Ann', null, true, now()),
  (t.m(6), t.r(), 2026, t.u(6), 'active', 'Bo', null, true, now()),
  (t.m(7), t.r(), 2026, t.u(7), 'pending', 'Cy', null, true, now()),
  (t.m(8), t.r(), 2026, t.u(8), 'active', 'Di', date '2015-01-01', false, now()),
  (t.m(9), t.r(), 2026, t.u(9), 'removed', 'Ed', null, true, now()),
  (t.m(10), t.r(), 2026, t.u(10), 'active', 'Fay', null, true, now()),
  (t.m(13), t.o(), 2026, t.u(13), 'active', 'Oli', null, true, now()),
  (t.m(25), t.r(), 2027, t.u(5), 'active', 'Ann', null, true, now());
insert into public.club_dues (membership_id, status) select id, 'unpaid' from public.club_memberships where team_id in (t.r(), t.o());
insert into public.club_meetings (id, team_id, membership_year, title, starts_at, location) values
  (t.mt(), t.r(), 2026, 'Gate Club 2026 AGM', now() + interval '10 days', 'Hall'),
  (t.omt(), t.o(), 2026, 'Other Club 2026 AGM', now() + interval '10 days', null);
create function t.vote(mem uuid) returns text language sql security definer as $$ select c.eligible || '/' || array_to_string(c.reasons, ';') from private.club_vote_check(mem) c $$;
grant execute on function t.vote(uuid) to authenticated;
create table t.ids (k text primary key, v uuid);
grant all on t.ids to anon, authenticated, service_role;
create function t.id(k text) returns uuid language sql stable security definer as $$ select v from t.ids where ids.k = $1 $$;
grant execute on function t.id(text) to anon, authenticated, service_role;
-- one-line helpers for the JSON the member and executive screens read
create function t.view(u int) returns jsonb language plpgsql as $$ begin perform t.as_user(t.u(u)); return public.club_agm_member_view(t.mt()); end $$;
grant execute on function t.view(int) to anon, authenticated, service_role;

-- ================================================================ 1. topics: who may submit
select t.as_user(t.u(11));
select t.expect_error('a signed-in non-member cannot submit a topic', format($q$select public.submit_club_agm_topic(%L, 'Hall rental', 'Can we talk about it')$q$, t.mt()), '42501');
select t.as_user(t.u(9));
select t.expect_error('a removed member cannot submit a topic', format($q$select public.submit_club_agm_topic(%L, 'Hall rental', 'Can we talk about it')$q$, t.mt()), '42501');
select t.as_user(t.u(13));
select t.expect_error('a member of another club cannot submit a topic for this AGM', format($q$select public.submit_club_agm_topic(%L, 'Hall rental', 'Can we talk about it')$q$, t.mt()), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot submit a topic', format($q$select public.submit_club_agm_topic(%L, 'Hall rental', 'Can we talk about it')$q$, t.mt()), '42501');
select t.as_user(t.u(5));
select t.expect_error('a topic needs a real title', format($q$select public.submit_club_agm_topic(%L, 'ab', 'Details here')$q$, t.mt()), '22023');
select t.expect_error('a topic needs details', format($q$select public.submit_club_agm_topic(%L, 'Hall rental', '   ')$q$, t.mt()), '22023');
select t.expect_error('a topic title has a length limit', format($q$select public.submit_club_agm_topic(%L, %L, 'Details')$q$, t.mt(), repeat('x', 121)), '22023');
insert into t.ids select 'ann_topic', public.submit_club_agm_topic(t.mt(), '  Hall rental  ', 'The hall costs more next year.');
select t.expect_eq('a member can submit a topic (trimmed, status Submitted)', t.q(format($q$select subject || '|' || status from public.club_meeting_topics where id = %L$q$, t.id('ann_topic'))), 'Hall rental|submitted');
select t.expect_eq('the submission is in the topic history', t.q(format($q$select string_agg(action, ',' order by id) from public.club_meeting_topic_history where topic_id = %L$q$, t.id('ann_topic'))), 'submitted');
select t.expect_eq('the submission is in the audit log', t.q($q$select count(*) from public.audit_log where action = 'club.agm_topic_submitted'$q$), '1');
select t.as_user(t.u(7));
insert into t.ids select 'cy_topic', public.submit_club_agm_topic(t.mt(), 'Welcome packs', 'New members could get a welcome pack.');
select t.ok('a pending applicant may also submit a topic (they are a member record, not yet a voter)');

-- ================================================================ 2. topics: my own, edit, withdraw
select t.expect_eq('Ann sees her own topic with edit allowed', (t.view(5) -> 'my_topics' -> 0 ->> 'subject') || '/' || (t.view(5) -> 'my_topics' -> 0 ->> 'can_edit') || '/' || jsonb_array_length(t.view(5) -> 'my_topics'), 'Hall rental/true/1');
select t.expect_eq('Bo does not see Ann''s topic', jsonb_array_length(t.view(6) -> 'my_topics'), 0);
select t.as_user(t.u(6));
select t.expect_error('a member cannot edit another member''s topic', format($q$select public.update_club_agm_topic(%L, 'Changed by Bo', 'Bo wrote this')$q$, t.id('ann_topic')), '42501');
select t.expect_error('a member cannot withdraw another member''s topic', format($q$select public.withdraw_club_agm_topic(%L)$q$, t.id('ann_topic')), '42501');
select t.expect_error('an unknown topic is refused', $q$select public.withdraw_club_agm_topic('00000000-0000-0000-0000-000000000999')$q$, 'P0002');
select t.expect_error('a member cannot read the topic table directly', 'select count(*) from public.club_meeting_topics', '42501');
select t.expect_error('a member cannot write the topic table directly', format($q$insert into public.club_meeting_topics (meeting_id, membership_id, subject, details) values (%L, %L, 'Sneaky', 'x')$q$, t.mt(), t.m(5)), '42501');
select t.expect_error('a member cannot change a topic directly', $q$update public.club_meeting_topics set status = 'addressed'$q$, '42501');
select t.expect_error('a member cannot read the topic history directly', 'select count(*) from public.club_meeting_topic_history', '42501');
select t.as_user(t.u(5));
select public.update_club_agm_topic(t.id('ann_topic'), 'Hall rental costs', 'The hall costs more next year, so what do we do?');
select t.expect_eq('the owner can edit their topic', t.q(format($q$select subject from public.club_meeting_topics where id = %L$q$, t.id('ann_topic'))), 'Hall rental costs');
select public.update_club_agm_topic(t.id('ann_topic'), 'Hall rental costs', 'The hall costs more next year, so what do we do?');
select t.expect_eq('saving without a change adds no history; the edit did', t.q(format($q$select string_agg(action, ',' order by id) from public.club_meeting_topic_history where topic_id = %L$q$, t.id('ann_topic'))), 'submitted,edited');
select t.expect_error('an edit still needs a real title', format($q$select public.update_club_agm_topic(%L, 'x', 'Details')$q$, t.id('ann_topic')), '22023');
select public.withdraw_club_agm_topic(t.id('ann_topic'));
select t.expect_eq('the owner can withdraw their topic (it is kept, not deleted)', t.q(format($q$select status from public.club_meeting_topics where id = %L$q$, t.id('ann_topic'))), 'withdrawn');
select t.expect_error('a withdrawn topic cannot be edited', format($q$select public.update_club_agm_topic(%L, 'Hall rental again', 'More')$q$, t.id('ann_topic')), '22023');
select t.expect_error('a withdrawn topic cannot be withdrawn again', format($q$select public.withdraw_club_agm_topic(%L)$q$, t.id('ann_topic')), '22023');
select t.expect_eq('the history keeps submit, edit and withdraw', t.q(format($q$select string_agg(action, ',' order by id) from public.club_meeting_topic_history where topic_id = %L$q$, t.id('ann_topic'))), 'submitted,edited,withdrawn');
select t.expect_eq('a withdrawn topic shows as withdrawn and not editable', (t.view(5) -> 'my_topics' -> 0 ->> 'status') || '/' || (t.view(5) -> 'my_topics' -> 0 ->> 'can_edit'), 'withdrawn/false');
select t.as_user(t.u(6));
insert into t.ids select 'bo_topic', public.submit_club_agm_topic(t.mt(), 'Practice nights', 'Add a second practice night.');

-- ================================================================ 3. topics: the executive
select t.as_user(t.u(3));
select t.expect_eq('the Treasurer sees every topic, withdrawn last, with the member''s name',
  (select string_agg(member_name || ':' || status, ',' order by member_name) from public.club_agm_topics_admin(t.mt())), 'Ann:withdrawn,Bo:submitted,Cy:submitted');
select t.expect_eq('withdrawn topics are listed last', (select (array_agg(status order by ord))[3] from (select status, row_number() over () ord from public.club_agm_topics_admin(t.mt())) x), 'withdrawn');
select t.expect_eq('the executive list says which topics were edited', (select edited from public.club_agm_topics_admin(t.mt()) where topic_id = t.id('ann_topic')), true);
select public.set_club_agm_topic_status(t.id('bo_topic'), 'on_agenda');
select t.expect_eq('the Treasurer can add a topic to the agenda', t.q(format($q$select status from public.club_meeting_topics where id = %L$q$, t.id('bo_topic'))), 'on_agenda');
select t.expect_error('the executive cannot reopen a withdrawn topic', format($q$select public.set_club_agm_topic_status(%L, 'submitted')$q$, t.id('ann_topic')), '22023');
select t.expect_error('the executive cannot set Withdrawn (only the member does)', format($q$select public.set_club_agm_topic_status(%L, 'withdrawn')$q$, t.id('bo_topic')), '22023');
select t.expect_error('an unknown status is refused', format($q$select public.set_club_agm_topic_status(%L, 'done')$q$, t.id('bo_topic')), '22023');
select t.as_user(t.u(6));
select public.update_club_agm_topic(t.id('bo_topic'), 'Practice nights', 'Add a second practice night on Thursdays.');
select t.ok('a member can still edit a topic that is Added to Agenda');
select t.as_user(t.u(2));
select public.set_club_agm_topic_status(t.id('bo_topic'), 'addressed');
select t.ok('the Secretary can mark a topic Addressed');
select t.as_user(t.u(6));
select t.expect_error('an Addressed topic can no longer be edited by the member', format($q$select public.update_club_agm_topic(%L, 'Practice nights', 'Different')$q$, t.id('bo_topic')), '22023');
select t.expect_error('an Addressed topic can no longer be withdrawn by the member', format($q$select public.withdraw_club_agm_topic(%L)$q$, t.id('bo_topic')), '22023');
select t.expect_eq('status changes are in the history', t.q(format($q$select string_agg(action || ':' || status, ',' order by id) from public.club_meeting_topic_history where topic_id = %L$q$, t.id('bo_topic'))), 'submitted:submitted,status:on_agenda,edited:on_agenda,status:addressed');
select t.expect_error('a regular member cannot open the executive topic list', format($q$select * from public.club_agm_topics_admin(%L)$q$, t.mt()), '42501');
select t.expect_error('a regular member cannot set a topic''s status', format($q$select public.set_club_agm_topic_status(%L, 'on_agenda')$q$, t.id('cy_topic')), '42501');
select t.as_user(t.u(4));
select t.expect_eq('the Vice President can look at the topics', (select count(*) from public.club_agm_topics_admin(t.mt())), 3::bigint);
select t.expect_error('the Vice President cannot change a status (same people who run dues)', format($q$select public.set_club_agm_topic_status(%L, 'on_agenda')$q$, t.id('cy_topic')), '42501');
select t.as_user(t.u(12));
select t.expect_error('another club''s Treasurer cannot read these topics', format($q$select * from public.club_agm_topics_admin(%L)$q$, t.mt()), '42501');
select t.expect_error('another club''s Treasurer cannot set their status', format($q$select public.set_club_agm_topic_status(%L, 'on_agenda')$q$, t.id('cy_topic')), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot read the executive topic list', format($q$select * from public.club_agm_topics_admin(%L)$q$, t.mt()), '42501');
select t.as_admin();
select t.expect_error('a topic can never be deleted, even by the table owner', 'delete from public.club_meeting_topics', '42501');
select t.expect_error('topic history can never be edited', 'update public.club_meeting_topic_history set subject = ''x''', '42501');
select t.expect_error('topic history can never be deleted', 'delete from public.club_meeting_topic_history', '42501');

-- ================================================================ 4. nominations: who may nominate
select t.as_admin();
create temp table officers_before as select team_id, user_id, office, started_on, ended_on from public.team_officers;
select t.expect_eq('Cy (pending) sees why they cannot nominate', (t.view(7) ->> 'can_nominate') || '|' || (t.view(7) ->> 'nominate_blocked'),
  'false|Only members who can currently vote can nominate (Membership pending approval).');
select t.expect_eq('Cy gets no list of members to nominate', jsonb_array_length(t.view(7) -> 'nominees'), 0);
select t.expect_error('a pending member cannot nominate themselves', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.as_user(t.u(8));
select t.expect_error('an under-18 member cannot nominate', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.as_user(t.u(9));
select t.expect_error('a removed member cannot nominate', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.as_user(t.u(11));
select t.expect_error('a non-member cannot nominate', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.as_user(t.u(13));
select t.expect_error('a member of another club cannot nominate for this AGM', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot nominate', format($q$select public.nominate_for_club_office(%L, 'president')$q$, t.mt()), '42501');
select t.expect_eq('a voting member can nominate and is offered the other voting members only',
  (t.view(5) ->> 'can_nominate') || '|' || (select string_agg(e ->> 'name', ',' order by e ->> 'name') from jsonb_array_elements(t.view(5) -> 'nominees') e), 'true|Bo,Fay,Pres Ident,Trea Surer');
select t.as_user(t.u(5));
select t.expect_error('only President, Secretary and Treasurer can be nominated for', format($q$select public.nominate_for_club_office(%L, 'vice_president')$q$, t.mt()), '22023');
select t.expect_error('no other office can be invented', format($q$select public.nominate_for_club_office(%L, 'director')$q$, t.mt()), '22023');
select t.expect_error('an office is required', format($q$select public.nominate_for_club_office(%L, null)$q$, t.mt()), '22023');

-- ================================================================ 5. nominate yourself
insert into t.ids select 'ann_pres', public.nominate_for_club_office(t.mt(), 'president');
select t.expect_eq('a self-nomination is accepted at once', t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('ann_pres'))), 'accepted');
select t.expect_eq('the self-nominator is recorded as their own nominator', t.q(format($q$select count(*) from public.club_meeting_nominators where nomination_id = %L and nominator_membership_id = %L$q$, t.id('ann_pres'), t.m(5))), '1');
insert into t.ids select 'ann_sec', public.nominate_for_club_office(t.mt(), 'secretary', t.m(5));
insert into t.ids select 'ann_trea', public.nominate_for_club_office(t.mt(), 'treasurer');
select t.expect_eq('nothing stops one member standing for more than one office', t.q(format($q$select count(*) from public.club_meeting_nominations where nominee_membership_id = %L and status = 'accepted'$q$, t.m(5))), '3');
select t.expect_eq('nominating yourself again changes nothing (one candidacy)', (select public.nominate_for_club_office(t.mt(), 'president') = t.id('ann_pres')), true);
select t.expect_eq('... and adds no second nominator row', t.q(format($q$select count(*) from public.club_meeting_nominators where nomination_id = %L$q$, t.id('ann_pres'))), '1');
select t.expect_eq('the nomination is in the audit log', t.q($q$select count(*) from public.audit_log where action = 'club.agm_nomination'$q$), '4');

-- ================================================================ 6. nominate someone else: one candidacy however many nominators
select t.as_user(t.u(6));
select t.expect_eq('five people (here two) nominating the same member for the same office share ONE candidacy', (select public.nominate_for_club_office(t.mt(), 'president', t.m(5)) = t.id('ann_pres')), true);
select t.expect_eq('... the candidacy now lists both nominators', t.q(format($q$select count(*) from public.club_meeting_nominators where nomination_id = %L$q$, t.id('ann_pres'))), '2');
select t.expect_eq('... and there is still exactly one live candidacy', t.q(format($q$select count(*) from public.club_meeting_nominations where nominee_membership_id = %L and office = 'president'$q$, t.m(5))), '1');
insert into t.ids select 'fay_trea', public.nominate_for_club_office(t.mt(), 'treasurer', t.m(10));
select t.expect_eq('nominating someone else leaves them AWAITING their answer', t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('fay_trea'))), 'awaiting_acceptance');
select t.expect_error('the nominator cannot accept on the nominee''s behalf', format($q$select public.respond_to_club_nomination(%L, 'accept')$q$, t.id('fay_trea')), '42501');
select t.expect_error('the nominator cannot decline on the nominee''s behalf', format($q$select public.respond_to_club_nomination(%L, 'decline')$q$, t.id('fay_trea')), '42501');
select t.as_user(t.u(1));
select t.expect_eq('a second member nominating the same person joins the same candidacy', (select public.nominate_for_club_office(t.mt(), 'treasurer', t.m(10)) = t.id('fay_trea')), true);
select t.expect_error('the President cannot accept for the nominee either', format($q$select public.respond_to_club_nomination(%L, 'accept')$q$, t.id('fay_trea')), '42501');
select t.expect_eq('a candidacy awaiting acceptance is still awaiting', t.q(format($q$select status || '/' || (select count(*) from public.club_meeting_nominators where nomination_id = n.id) from public.club_meeting_nominations n where id = %L$q$, t.id('fay_trea'))), 'awaiting_acceptance/2');
select t.as_user(t.u(6));
select t.expect_error('you cannot nominate a member who cannot vote (pending)', format($q$select public.nominate_for_club_office(%L, 'president', %L)$q$, t.mt(), t.m(7)), '22023');
select t.expect_error('you cannot nominate an under-18 member', format($q$select public.nominate_for_club_office(%L, 'president', %L)$q$, t.mt(), t.m(8)), '22023');
select t.expect_error('you cannot nominate a removed member', format($q$select public.nominate_for_club_office(%L, 'president', %L)$q$, t.mt(), t.m(9)), '22023');
select t.expect_error('you cannot nominate a member of another club', format($q$select public.nominate_for_club_office(%L, 'president', %L)$q$, t.mt(), t.m(13)), '22023');
select t.expect_error('you cannot nominate someone who is not a member', format($q$select public.nominate_for_club_office(%L, 'president', %L)$q$, t.mt(), '00000000-0000-0000-0000-000000000999'::uuid), '22023');

-- ================================================================ 7. the nominee answers
select t.as_user(t.u(10));
select t.expect_eq('the nominee sees the nomination, the role and who nominated them', (t.view(10) -> 'to_respond' -> 0 ->> 'label') || '|' || (t.view(10) -> 'to_respond' -> 0 -> 'nominated_by')::text, 'Treasurer|["Bo", "Pres Ident"]');
select t.expect_eq('only the nominee sees it waiting for them', jsonb_array_length(t.view(6) -> 'to_respond'), 0);
select t.as_user(t.u(10));
select public.respond_to_club_nomination(t.id('fay_trea'), 'accept');
select t.expect_eq('the nominee can accept: they become an accepted candidate', t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('fay_trea'))), 'accepted');
select t.expect_error('a nomination can only be answered once', format($q$select public.respond_to_club_nomination(%L, 'decline')$q$, t.id('fay_trea')), '22023');
select t.expect_eq('the original nomination and both nominators are kept', t.q(format($q$select (select count(*) from public.club_meeting_nominators where nomination_id = %L) || '/' || (select string_agg(action || ':' || new_status, ',' order by id) from public.club_meeting_nomination_history where nomination_id = %L)$q$, t.id('fay_trea'), t.id('fay_trea'))),
  '2/nominated:awaiting_acceptance,also_nominated:awaiting_acceptance,accepted:accepted');
select t.as_user(t.u(6));
insert into t.ids select 'fay_sec', public.nominate_for_club_office(t.mt(), 'secretary', t.m(10));
select t.as_user(t.u(10));
select public.respond_to_club_nomination(t.id('fay_sec'), 'decline');
select t.expect_eq('the nominee can decline: recorded as declined, not deleted', t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('fay_sec'))), 'declined');
select t.expect_error('a declined nomination cannot be accepted afterwards', format($q$select public.respond_to_club_nomination(%L, 'accept')$q$, t.id('fay_sec')), '22023');
select t.expect_eq('a declined candidate is not on the member board', (select count(*) from jsonb_array_elements(t.view(6) -> 'board') b, jsonb_array_elements(b -> 'candidates') c where b ->> 'office' = 'secretary' and c ->> 'name' = 'Fay'), 0::bigint);
select t.as_user(t.u(6));
insert into t.ids select 'fay_sec2', public.nominate_for_club_office(t.mt(), 'secretary', t.m(10));
select t.expect_eq('after a decline a new nomination starts a new candidacy; the declined one is kept', t.q(format($q$select count(*) || '/' || count(*) filter (where status = 'declined') from public.club_meeting_nominations where nominee_membership_id = %L and office = 'secretary'$q$, t.m(10))), '2/1');
select t.as_user(t.u(10));
insert into t.ids select 'fay_sec3', public.nominate_for_club_office(t.mt(), 'secretary');
select t.expect_eq('standing yourself while a nomination waits accepts that same candidacy', (t.id('fay_sec3') = t.id('fay_sec2'))::text || '/' || t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('fay_sec2'))), 'true/accepted');
select public.respond_to_club_nomination(t.id('fay_sec2'), 'withdraw');
select t.expect_eq('an accepted candidate can withdraw', t.q(format($q$select status from public.club_meeting_nominations where id = %L$q$, t.id('fay_sec2'))), 'withdrawn');
select t.expect_error('a withdrawn candidacy cannot be withdrawn again', format($q$select public.respond_to_club_nomination(%L, 'withdraw')$q$, t.id('fay_sec2')), '22023');
select t.expect_error('an unknown answer is refused', format($q$select public.respond_to_club_nomination(%L, 'maybe')$q$, t.id('fay_trea')), '22023');
select t.expect_error('an unknown nomination is refused', $q$select public.respond_to_club_nomination('00000000-0000-0000-0000-000000000999', 'accept')$q$, 'P0002');
select t.as_user(t.u(6));
insert into t.ids select 'trea_pres', public.nominate_for_club_office(t.mt(), 'president', t.m(3));
select t.as_user(t.u(3));
select t.expect_error('only an accepted candidacy can be withdrawn', format($q$select public.respond_to_club_nomination(%L, 'withdraw')$q$, t.id('trea_pres')), '22023');
select t.as_admin();
update public.club_memberships set status = 'inactive' where id = t.m(3);
select t.as_user(t.u(3));
select t.expect_error('a nominee who can no longer vote cannot accept', format($q$select public.respond_to_club_nomination(%L, 'accept')$q$, t.id('trea_pres')), '42501');
select t.as_admin();
update public.club_memberships set status = 'active' where id = t.m(3);
select t.as_user(t.u(3));
select public.respond_to_club_nomination(t.id('trea_pres'), 'accept');
select t.ok('... and can once they can vote again');
select t.as_user(t.u(5));
select t.expect_error('a member cannot answer a nomination of someone else', format($q$select public.respond_to_club_nomination(%L, 'decline')$q$, t.id('trea_pres')), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot answer a nomination', format($q$select public.respond_to_club_nomination(%L, 'accept')$q$, t.id('trea_pres')), '42501');

-- ================================================================ 8. what members see
select t.expect_eq('the member board names the current officer without hard-coded names',
  (select string_agg(b ->> 'label' || '=' || coalesce(b ->> 'current_officer', '-'), ',' order by b ->> 'label') from jsonb_array_elements(t.view(6) -> 'board') b),
  'President=Pres Ident,Secretary=Person 62,Treasurer=Trea Surer');
select t.expect_eq('the member board lists accepted candidates once each', (select string_agg(b ->> 'label' || ':' || (select string_agg(c ->> 'name' || '/' || (c ->> 'status'), ',' order by c ->> 'name') from jsonb_array_elements(b -> 'candidates') c), ';' order by b ->> 'label') from jsonb_array_elements(t.view(6) -> 'board') b),
  'President:Ann/accepted,Trea Surer/accepted;Secretary:Ann/accepted;Treasurer:Ann/accepted,Fay/accepted');
select t.expect_eq('the member board never contains an e-mail address', (t.view(6) -> 'board')::text !~ '@' and t.view(6)::text !~ '@', true);
select t.as_admin();
update public.club_memberships set status = 'removed' where id = t.m(10);
select t.expect_eq('a candidate whose membership was removed drops off the member board (the executive still sees the record)',
  (select count(*) from jsonb_array_elements(t.view(6) -> 'board') b, jsonb_array_elements(b -> 'candidates') c where c ->> 'name' = 'Fay'), 0::bigint);
select t.as_admin();
update public.club_memberships set status = 'active' where id = t.m(10);
select t.as_user(t.u(6));
select t.expect_eq('a non-member sees nothing of the nominations', (t.view(11))::text, '{"is_member": false}');
select t.expect_eq('another club''s executive sees nothing of this AGM''s nominations', (t.view(12))::text, '{"is_member": false}');
select t.expect_eq('a removed member sees nothing of the nominations', (t.view(9))::text, '{"is_member": false}');
select t.as_anon();
select t.expect_error('anonymous callers cannot read the AGM board', format($q$select public.club_agm_member_view(%L)$q$, t.mt()), '42501');
select t.as_user(t.u(6));
select t.expect_error('a member cannot read the nomination tables directly', 'select count(*) from public.club_meeting_nominations', '42501');
select t.expect_error('a member cannot read the nominator table directly', 'select count(*) from public.club_meeting_nominators', '42501');
select t.expect_error('a member cannot read the nomination history directly', 'select count(*) from public.club_meeting_nomination_history', '42501');
select t.expect_error('a member cannot write a candidate in directly', format($q$insert into public.club_meeting_nominations (meeting_id, office, nominee_membership_id, status) values (%L, 'president', %L, 'accepted')$q$, t.mt(), t.m(6)), '42501');
select t.expect_error('a member cannot accept a nomination by editing the table', $q$update public.club_meeting_nominations set status = 'accepted'$q$, '42501');

-- ================================================================ 9. the executive nomination dashboard
select t.as_user(t.u(3));
select t.expect_eq('the Treasurer''s dashboard shows each office, its current officer and every candidacy with who nominated them',
  (select string_agg(o ->> 'label' || '=' || coalesce(o ->> 'current_officer', '-') || '[' || (select coalesce(string_agg((n ->> 'nominee') || '/' || (n ->> 'status') || '/' || case when (n ->> 'self_nominated')::boolean then 'self' else 'member' end || '/' || (n -> 'nominated_by')::text, '; ' order by n ->> 'nominee', n ->> 'status'), '') from jsonb_array_elements(o -> 'nominations') n) || ']', ' | ' order by o ->> 'label')
   from jsonb_array_elements(public.club_agm_nominations_admin(t.mt()) -> 'offices') o),
  'President=Pres Ident[Ann/accepted/self/["Bo"]; Trea Surer/accepted/member/["Bo"]] | Secretary=Person 62[Ann/accepted/self/[]; Fay/declined/member/["Bo"]; Fay/withdrawn/self/["Bo"]] | Treasurer=Trea Surer[Ann/accepted/self/[]; Fay/accepted/member/["Bo", "Pres Ident"]]');
select t.as_user(t.u(4));
select t.expect_eq('the Vice President can look at the nominations', jsonb_array_length(public.club_agm_nominations_admin(t.mt()) -> 'offices'), 3);
select t.as_user(t.u(6));
select t.expect_error('a regular member cannot open the executive nomination dashboard', format($q$select public.club_agm_nominations_admin(%L)$q$, t.mt()), '42501');
select t.as_user(t.u(12));
select t.expect_error('another club''s executive cannot open it', format($q$select public.club_agm_nominations_admin(%L)$q$, t.mt()), '42501');
select t.as_anon();
select t.expect_error('anonymous callers cannot open it', format($q$select public.club_agm_nominations_admin(%L)$q$, t.mt()), '42501');

-- ================================================================ 10. nominations never change the officers
select t.as_admin();
select t.expect_eq('no officer was added, removed or changed by any nomination, acceptance or decline',
  (select count(*) from (select team_id, user_id, office, started_on, ended_on from public.team_officers except select * from officers_before) x)
  + (select count(*) from (select * from officers_before except select team_id, user_id, office, started_on, ended_on from public.team_officers) y), 0::bigint);
select t.expect_eq('the Treasurer is still the Treasurer', t.q(format($q$select count(*) from public.team_officers where team_id = %L and office = 'treasurer' and user_id = %L and ended_on is null$q$, t.r(), t.u(3))), '1');

-- ================================================================ 11. records are never removed or rewritten
select t.expect_error('a nomination can never be deleted', 'delete from public.club_meeting_nominations', '42501');
select t.expect_error('a nominator record can never be deleted', 'delete from public.club_meeting_nominators', '42501');
select t.expect_error('a nominator record can never be rewritten', 'update public.club_meeting_nominators set nominated_by = nominated_by', '42501');
select t.expect_error('a nomination cannot be pointed at another member', format($q$update public.club_meeting_nominations set nominee_membership_id = %L where id = %L$q$, t.m(6), t.id('fay_trea')), '42501');
select t.expect_error('a nomination cannot be moved to another office', format($q$update public.club_meeting_nominations set office = 'president' where id = %L$q$, t.id('fay_trea')), '42501');
select t.expect_error('nomination history can never be edited', 'update public.club_meeting_nomination_history set new_status = ''accepted''', '42501');
select t.expect_error('nomination history can never be deleted', 'delete from public.club_meeting_nomination_history', '42501');
select t.expect_error('the database refuses a second live candidacy for the same member, office and meeting', format($q$insert into public.club_meeting_nominations (meeting_id, office, nominee_membership_id) values (%L, 'treasurer', %L)$q$, t.mt(), t.m(10)), '23505');

-- ================================================================ 12. once the AGM starts
update public.club_meetings set starts_at = now() - interval '1 minute' where id = t.mt();
select t.as_user(t.u(6));
select t.expect_error('a topic cannot be submitted after the meeting starts', format($q$select public.submit_club_agm_topic(%L, 'Late topic', 'Too late')$q$, t.mt()), '22023');
select t.as_user(t.u(7));
select t.expect_error('a topic cannot be edited after the meeting starts', format($q$select public.update_club_agm_topic(%L, 'Welcome packs', 'Changed late')$q$, t.id('cy_topic')), '22023');
select t.expect_error('a topic cannot be withdrawn after the meeting starts', format($q$select public.withdraw_club_agm_topic(%L)$q$, t.id('cy_topic')), '22023');
select t.as_user(t.u(6));
select t.expect_error('nominations close when the meeting starts', format($q$select public.nominate_for_club_office(%L, 'secretary', %L)$q$, t.mt(), t.m(6)), '22023');
select t.as_user(t.u(10));
select t.expect_error('a nominee cannot answer after the meeting starts', format($q$select public.respond_to_club_nomination(%L, 'withdraw')$q$, t.id('fay_trea')), '22023');
-- since the deadlines (2026-10-18) the reason names the moment they closed (the meeting's start here), in the club's time zone
select t.expect_eq('the member view says nominations are closed', (t.view(6) ->> 'can_nominate') = 'false' and (t.view(6) ->> 'nominate_blocked') ~ '^Nominations closed .+ at .+\.$', true);
select t.as_user(t.u(3));
select public.set_club_agm_topic_status(t.id('cy_topic'), 'addressed');
select t.ok('the executive can still mark topics Addressed during the meeting');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'CLUB AGM TOPICS GATE PASSED % checks', n; end $$;
rollback;
