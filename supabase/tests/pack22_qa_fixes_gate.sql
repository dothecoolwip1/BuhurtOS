-- Pack 22 QA fixes gate (migration 20261015000700): one block per finding of the skeptical QA pass over the discipline domain.
--   1 history keeps reasons from the subject · 2 a suspended fighter is not put back into a competition · 3 a team suspension blocks check-in and roster
--   4 an event appeal's deadline cannot be set by hand · 5 only the Secretary or a decider withdraws an appeal, with a reason, audited
--   6 an event suspension only for participants · 7 eligibility per subject · 8 a team with disciplinary records is kept when merging
--   10 the desk lists the event's fights for an appeal · 11 event suspension reasons only for the issuers · 12 no account ids by direct read
--   13 green cards worded and counted by the official text (field records count) and the appeal outcomes of the official text
-- Same fixture as pack22_discipline_gate.sql. LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack22_qa_fixes_gate.sql
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
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('d5' || n, 12, '0'))::uuid $$;
create function t.ev(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('e5' || n, 12, '0'))::uuid $$;
create function t.f(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('f5' || n, 12, '0'))::uuid $$;
create function t.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('c5' || n, 12, '0'))::uuid $$;
create function t.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('a5' || n, 12, '0'))::uuid $$;
create function t.x(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('b5' || n, 12, '0'))::uuid $$;   -- command ids
create function t.team() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000d5a01'::uuid $$;
create function t.org(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('0a5' || n, 12, '0'))::uuid $$;
create function t.ver(doc text) returns uuid language sql stable security definer as $$
  select rv.id from public.ruleset_versions rv join public.rulesets r on r.id = rv.ruleset_id where r.inventory_key = doc and not rv.historical order by rv.imported_at desc limit 1 $$;   -- the current release (not an earlier edition)
create function t.bp(doc text, num text) returns uuid language sql stable security definer as $$
  select p.id from public.rule_provisions p where p.ruleset_version_id = t.ver(doc) and p.number = num $$;
-- notifications for one account (the table is read by its owner through the app, not directly)
create function t.notes(u uuid, k text, ch text default null) returns int language sql stable security definer as $$
  select count(*)::int from public.notifications where user_id = u and kind = k and (ch is null or payload ->> 'change' = ch) $$;
-- readiness of one registration, as event 1's organizer sees it
create function t.ready(reg uuid) returns text language plpgsql security definer as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', t.u(1)::text, true);
  select (case when x.ready then 'READY' else 'NOT READY' end) || coalesce(': ' || nullif(array_to_string(x.reasons, ', '), ''), '') into v from public.event_readiness(t.ev(1)) x where x.registration_id = reg;
  return v;
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
-- Event 1 (org A): u1 organizer, u2 head marshal (Knight Marshal), u3 scorekeeper (Secretary), u4 inspector (Authenticity Officer), u6 marshal,
-- u7 check-in desk, u14 medic. Event 2 (org B): u8 organizer. u9: Fighter 1's own account. u10: captain of Team D. u11 admin of org A,
-- u12 admin of org B, u13 a stranger, u5 the platform owner.
insert into auth.users (id, email) select t.u(n), 'p22d' || n || '@example.test' from generate_series(1, 14) n;
update public.profiles set display_name = 'Person ' || right(id::text, 2) where id in (select t.u(n) from generate_series(1, 14) n);
insert into public.platform_roles (user_id, role) values (t.u(5), 'owner');
insert into public.organizations (id, slug, name, kind) values (t.org(1), 'p22d-org-a', 'Org A', 'national'), (t.org(2), 'p22d-org-b', 'Org B', 'national');
insert into public.organization_staff (organization_id, user_id, role) values (t.org(1), t.u(11), 'admin'), (t.org(2), t.u(12), 'admin');
insert into public.fighters (id, display_name, gender, disciplines) select t.f(n), 'D Fighter ' || n, 'female', '{}' from generate_series(1, 4) n;
insert into public.fighter_accounts (fighter_id, user_id) values (t.f(1), t.u(9));
insert into public.teams (id, slug, name, status) values (t.team(), 'p22d-team', 'Team D', 'approved');
insert into public.team_roles (team_id, user_id, role) values (t.team(), t.u(10), 'captain');
insert into public.events (id, slug, name, status, starts_on, ends_on, organization_id) values
  (t.ev(1), 'p22d-e1', 'Discipline Open', 'published', current_date, current_date + 1, t.org(1)),
  (t.ev(2), 'p22d-e2', 'Other Org Cup', 'published', current_date, current_date, t.org(2)),
  (t.ev(3), 'p22d-e3', 'Later Open', 'published', current_date + 30, current_date + 31, t.org(1));
insert into public.event_staff (event_id, user_id, role) values
  (t.ev(1), t.u(1), 'organizer'), (t.ev(1), t.u(2), 'head_marshal'), (t.ev(1), t.u(3), 'scorekeeper'), (t.ev(1), t.u(4), 'inspector'), (t.ev(1), t.u(6), 'marshal'),
  (t.ev(1), t.u(7), 'check_in'), (t.ev(1), t.u(14), 'medic'), (t.ev(2), t.u(8), 'organizer'), (t.ev(3), t.u(1), 'organizer');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  (t.k(1), t.ev(1), 'Longsword', 'longsword', 'women', 'Classic', 'round_robin', 1), (t.k(2), t.ev(1), 'Women 5v5', '5v5', 'women', 'Classic', 'round_robin', 2),
  (t.k(3), t.ev(2), 'Longsword', 'longsword', 'women', 'Classic', 'round_robin', 1), (t.k(4), t.ev(3), 'Longsword', 'longsword', 'women', 'Classic', 'round_robin', 1),
  (t.k(5), t.ev(3), 'Women 5v5', '5v5', 'women', 'Classic', 'round_robin', 2);
insert into public.waiver_versions (id, event_id, version, title, body) select ('00000000-0000-0000-0000-0000000a5d0' || n)::uuid, t.ev(n), 1, 'Waiver', 'Fictional waiver text for the gate.' from generate_series(1, 3) n;
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, team_id) values
  (t.r(1), t.ev(1), t.u(9), t.f(1), 'accepted', 'D Fighter 1', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a5d01', 'D Fighter 1', null),
  (t.r(2), t.ev(1), t.u(10), t.f(2), 'accepted', 'D Fighter 2', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a5d01', 'D Fighter 2', t.team()),
  (t.r(3), t.ev(2), t.u(9), t.f(1), 'accepted', 'D Fighter 1', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a5d02', 'D Fighter 1', null),
  (t.r(4), t.ev(3), t.u(9), t.f(1), 'pending', 'D Fighter 1', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a5d03', 'D Fighter 1', null),
  (t.r(5), t.ev(1), t.u(13), t.f(3), 'accepted', 'D Fighter 3', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-0000000a5d01', 'D Fighter 3', null);
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-0000000e5d01', t.k(1), t.f(1)), ('00000000-0000-0000-0000-0000000e5d02', t.k(1), t.f(3));
insert into public.entries (id, competition_id, team_id) values ('00000000-0000-0000-0000-0000000e5d03', t.k(2), t.team());
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  ('00000000-0000-0000-0000-0000000f5d01', t.k(1), 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-0000000e5d01', '00000000-0000-0000-0000-0000000e5d02', 'active', 'Field 1');

-- The owner publishes the documents the gate cites (they arrive "in review" from the release migration).
select t.as_user(t.u(5));
select public.publish_ruleset_version(t.ver(d), 'gate') from unnest(array['tournament/buhurt-regulations', 'tournament/duel-regulations', 'marshal/duels-rules', 'authenticity/infractions']) d;
select t.as_admin();

-- ---------------------------------------------------------------- 1. reasons in the history stay with the people who may read them
select t.as_user(t.u(2));
select public.issue_suspension(t.x(901), 'event', 'remainder_of_event', 'SECRET event reason', t.f(1), null, t.ev(1));
select public.lift_suspension(t.x(901), 'SECRET LIFT reason');
select public.issue_event_sanction(t.x(902), t.ev(1), 'warning', t.f(1), null, null, null, null, 'SECRET sanction reason');
select public.end_event_sanction(t.x(902), 'withdrawn', 'SECRET end reason');
select t.as_user(t.u(11));
select public.issue_suspension(t.x(903), 'organization', 'organization_events', 'SECRET org reason', t.f(1), null, null, t.org(1), null, now(), now() + interval '30 days');
select public.change_suspension(t.x(904), t.x(903), now() + interval '60 days', 'SECRET org change reason');
select public.lift_suspension(t.x(904), 'SECRET org lift reason');
select t.as_user(t.u(9));
select t.expect_eq('1. the fighter reads what happened to their event suspension, without the reason or who decided',
  (select public.discipline_record_history('suspension', t.x(901))::text !~ 'SECRET' and jsonb_array_length(public.discipline_record_history('suspension', t.x(901))) = 2
     and (public.discipline_record_history('suspension', t.x(901)) -> 1 ->> 'by') is null), true);
select t.expect_eq('1. ... nor the organization''s reasons for issuing, changing and lifting', public.discipline_record_history('suspension', t.x(904))::text ~ 'SECRET', false);
select t.expect_eq('1. ... nor the reason a sanction was withdrawn', public.discipline_record_history('event_sanction', t.x(902))::text ~ 'SECRET', false);
select t.as_user(t.u(2));
select t.expect_eq('1. the head marshal who lifted it reads the reason and the name', (public.discipline_record_history('suspension', t.x(901)) -> 1 -> 'details' ->> 'reason') || '/' || ((public.discipline_record_history('suspension', t.x(901)) -> 1 ->> 'by') is not null)::text, 'SECRET LIFT reason/true');
select t.as_user(t.u(11));
select t.expect_eq('1. the organization''s admin reads its own reasons', public.discipline_record_history('suspension', t.x(904))::text ~ 'SECRET org change reason', true);
select t.as_admin();

-- ---------------------------------------------------------------- 11 and 12. reasons and account ids on the desk
select t.as_user(t.u(7));
select t.expect_eq('11. the check-in desk sees an event suspension without its reasons',
  (select count(*) from jsonb_array_elements(public.event_discipline_overview(t.ev(1)) -> 'event_suspensions') x where x ->> 'reason' is not null or x ->> 'lift_reason' is not null)::int, 0);
select t.as_user(t.u(2));
select t.expect_eq('11. the head marshal (who issues and lifts them) sees the reasons', (select x ->> 'reason' from jsonb_array_elements(public.event_discipline_overview(t.ev(1)) -> 'event_suspensions') x where x ->> 'id' = t.x(901)::text), 'SECRET event reason');
select t.as_admin();
select t.expect_error('12. staff cannot read who issued a sanction (an account id) from the table', $$select t.as_user(t.u(7)); select issued_by from public.event_sanctions_private$$, '42501');
select t.as_admin();
select t.expect_error('12. ... nor who ended it', $$select t.as_user(t.u(3)); select ended_by from public.event_sanctions_private$$, '42501');
select t.as_admin();
select t.expect_error('12. ... nor who recorded an authenticity finding', $$select t.as_user(t.u(7)); select recorded_by from public.authenticity_findings$$, '42501');
select t.as_admin();
select t.expect_error('12. ... nor who issued or lifted a suspension', $$select t.as_user(t.u(2)); select lifted_by from public.discipline_suspensions_private$$, '42501');
select t.as_admin();
select t.as_user(t.u(7));
select t.expect_eq('12. the reason columns stay readable to the staff the policy allows', (select count(*) from public.event_sanctions_private where reason = 'SECRET sanction reason')::int, 1);
select t.as_admin();

-- ---------------------------------------------------------------- 6. an event suspension only for the event's participants
select t.expect_error('6. another event''s organizer cannot suspend a fighter who is not at their event', $$select t.as_user(t.u(8)); select public.issue_suspension(t.x(951), 'event', 'remainder_of_event', 'spite', t.f(4), null, t.ev(2))$$, '22023');
select t.as_admin();
select t.expect_error('6. ... nor a team that is not at their event', $$select t.as_user(t.u(8)); select public.issue_suspension(t.x(952), 'event', 'remainder_of_event', 'spite', null, t.team(), t.ev(2))$$, '22023');
select t.as_admin();
select t.expect_eq('6. and nobody was notified of a suspension that was refused', t.notes(t.u(10), 'suspension_changed'), 0);

-- ---------------------------------------------------------------- 2. a suspended fighter is not put back into a competition
select t.as_user(t.u(2));
select public.issue_suspension(t.x(911), 'event', 'remainder_of_event', 'violent conduct', t.f(3), null, t.ev(1));
select t.as_admin();
update public.entries set status = 'withdrawn' where id = '00000000-0000-0000-0000-0000000e5d02';
select t.expect_error('2. re-adding a withdrawn entry of a suspended fighter is refused', $$select t.as_user(t.u(1)); select public.add_entrant(t.k(1), t.f(3))$$, 'P0001');
select t.as_admin();
select t.expect_eq('2. the entry stays withdrawn', (select status from public.entries where id = '00000000-0000-0000-0000-0000000e5d02'), 'withdrawn');
select t.as_user(t.u(2));
select public.lift_suspension(t.x(911), 'cleared after review');
select t.as_user(t.u(1));
select t.expect_eq('2. after the lift the organizer can put the entry back', (public.add_entrant(t.k(1), t.f(3)) ->> 'already') is not null, true);
select t.as_admin();

-- ---------------------------------------------------------------- 3. a team suspension blocks check-in and the roster
select t.as_user(t.u(11));
select public.issue_suspension(t.x(921), 'organization', 'organization_events', 'team banned', null, t.team(), null, t.org(1), null, now(), now() + interval '30 days');
select t.as_admin();
select t.expect_eq('3. readiness: the team''s fighter is NOT READY with the suspension', t.ready(t.r(2)) ~ 'Suspended from Org A events', true);
select t.expect_error('3. the check-in desk cannot check in a fighter of a suspended team', $$select t.as_user(t.u(7)); select public.set_attendance(t.r(2), 'checked_in')$$, 'P0001');
select t.as_admin();
select t.expect_error('3. nobody is added to the suspended team''s roster', $$select t.as_user(t.u(1)); select public.add_entrant(t.k(2), t.f(2), t.team())$$, 'P0001');
select t.as_admin();

-- ---------------------------------------------------------------- 7. eligibility, per subject
select t.expect_error('7. a fighter cannot ask about a team they are not part of', $$select t.as_user(t.u(9)); select * from public.discipline_eligibility(t.ev(1), t.f(1), t.team())$$, '42501');
select t.as_admin();
select t.expect_error('7. event staff cannot probe someone who is not at their event', $$select t.as_user(t.u(7)); select * from public.discipline_eligibility(t.ev(1), t.f(4))$$, '42501');
select t.as_admin();
select t.as_user(t.u(10));
select t.expect_eq('7. the captain sees the team''s block', (select count(*) from public.discipline_eligibility(t.ev(1), null, t.team()) where kind = 'block')::int, 1);
select t.as_user(t.u(7));
select t.expect_eq('7. the desk sees it for the team''s fighter at its event', (select count(*) from public.discipline_eligibility(t.ev(1), t.f(2), t.team()) where kind = 'block')::int, 1);
select t.as_user(t.u(11));
select public.lift_suspension(t.x(921), 'ban ended early');
select t.as_admin();

-- ---------------------------------------------------------------- 8. a team with disciplinary records is kept when merging
insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-0000000d5a02', 'p22d-team2', 'Team D2', 'approved');
select t.expect_error('8. merging away a team with disciplinary records is refused, with the way out in the message', $$select t.as_user(t.u(5)); select public.merge_teams('00000000-0000-0000-0000-0000000d5a02', t.team())$$, 'P0001');
select t.as_admin();
select t.as_user(t.u(5));
select public.merge_teams(t.team(), '00000000-0000-0000-0000-0000000d5a02');
select t.as_admin();
select t.expect_eq('8. merging the other way works and the records stay with the kept team', (select count(*) from public.teams where id = '00000000-0000-0000-0000-0000000d5a02')::int || '/' || (select count(*) from public.discipline_suspensions where team_id = t.team())::int, '0/1');

-- ---------------------------------------------------------------- 4, 5 and 10. appeals
select t.as_user(t.u(3));
select t.expect_eq('10. the desk lists the event''s fights (an appeal can be about a fight where nothing was recorded)',
  (select count(*) from jsonb_array_elements(public.event_discipline_overview(t.ev(1)) -> 'fights') x where x ->> 'id' = '00000000-0000-0000-0000-0000000f5d01' and x ->> 'a' = 'D Fighter 1')::int, 1);
select t.as_admin();
update public.matches set queue_state = 'final', finalized_at = now() - interval '2 hours' where id = '00000000-0000-0000-0000-0000000f5d01';
select t.as_user(t.u(3));
select t.expect_eq('4. an appeal two hours after the fight is marked late', (public.lodge_review(t.x(931), 'event_appeal', 'Captain', 'bad call', null, null, null, '00000000-0000-0000-0000-0000000f5d01') ->> 'late'), 'true');
select t.as_admin();
select t.expect_error('4. the Secretary cannot move the start of the window to make it look on time',
  $$select t.as_user(t.u(3)); select public.lodge_review(t.x(932), 'event_appeal', 'Captain', 'bad call', null, null, null, '00000000-0000-0000-0000-0000000f5d01', 'Buhurt International', now())$$, '22023');
select t.as_admin();
select t.expect_error('5. a marshal (possibly the official whose call is appealed) cannot withdraw the appeal', $$select t.as_user(t.u(6)); select public.withdraw_review(t.x(931), 'the captain said so')$$, '42501');
select t.as_admin();
select t.expect_error('5. the check-in desk cannot either', $$select t.as_user(t.u(7)); select public.withdraw_review(t.x(931), 'the captain said so')$$, '42501');
select t.as_admin();
select t.expect_error('5. the Secretary must say who withdrew it and why', $$select t.as_user(t.u(3)); select public.withdraw_review(t.x(931), null)$$, '22023');
select t.as_admin();
select t.as_user(t.u(3));
select t.expect_eq('5. the Secretary records the withdrawal with the reason', public.withdraw_review(t.x(931), 'The captain withdrew it at the desk') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('5. the withdrawal is audited', (select count(*) from public.audit_log where action = 'discipline.review_withdrawn' and subject = t.x(931)::text)::int, 1);
select t.as_user(t.u(3));
select t.expect_eq('5. the desk is told who may withdraw', (public.event_discipline_overview(t.ev(1)) -> 'can' ->> 'withdraw_appeal') || '/' || (select (public.event_discipline_overview(t.ev(1)) -> 'can' ->> 'decide_appeal')), 'true/false');
select t.as_user(t.u(6));
select t.expect_eq('5. ... and a marshal is told they may not', public.event_discipline_overview(t.ev(1)) -> 'can' ->> 'withdraw_appeal', 'false');
select t.as_admin();
select t.expect_eq('13. the event appeal outcomes are the official ones (Outrance 16.4 point deductions included), with the Outrance route to the Knight Marshal noted',
  (select array_to_string(outcomes, ',') || ' | ' || (note ~ 'Outrance 16.3: to the Knight Marshal')::text from public.discipline_review_rules where governing_body = 'Buhurt International' and kind = 'event_appeal'),
  'rematch_round,restart,cards_imposed,cards_withdrawn,point_deduction_imposed,point_deduction_withdrawn,kept | true');
select t.expect_eq('13. every source of the appeal rule is a provision of the imported release',
  (select count(*) from public.discipline_review_rules r, unnest(r.sources) s where r.governing_body = 'Buhurt International' and not exists (select 1 from public.rule_provisions p where p.stable_key = s))::int, 0);

-- ---------------------------------------------------------------- 13. green cards
-- a green card given on the field tablet (a Pack 13 record) counts
insert into public.event_lyst_settings (event_id, settings) values (t.ev(1), '{"cards": [{"key": "green_card", "label": "Green card"}, {"key": "yellow_card", "label": "Yellow card"}]}')
  on conflict (event_id) do update set settings = excluded.settings;
insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label) values ('00000000-0000-0000-0000-00000000b5e1', '00000000-0000-0000-0000-0000000f5d01', t.ev(1), 1, 'a', 'card', 'Green card');
select t.expect_eq('13. the field record carries the green card concept', (select card_key from public.match_discipline where id = '00000000-0000-0000-0000-00000000b5e1'), 'green_card');
select t.expect_error('13. a second green card while one from the field is in force is refused (one per tournament; it follows the competitor)',
  $$select t.as_user(t.u(4)); select public.issue_event_sanction(t.x(961), t.ev(1), 'card', t.f(1), null, null, 'green_card', null, 'gauntlets')$$, 'P0001');
select t.as_admin();
update public.match_discipline set voided_at = now() where id = '00000000-0000-0000-0000-00000000b5e1';
select t.as_user(t.u(4));
select t.expect_eq('13. once the field card is voided, the Authenticity Officer can give one', public.issue_event_sanction(t.x(961), t.ev(1), 'card', t.f(1), null, null, 'green_card', null, 'gauntlets') ->> 'status', 'ok');
select t.as_admin();
select t.as_user(t.u(9));
select t.expect_eq('13. the fighter''s eligibility cites Infractions 3 for the green card', (select source_key from public.discipline_eligibility(t.ev(1), t.f(1)) where code = 'green_card'), 'infractions:3');
select t.as_admin();

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK22 QA FIXES GATE PASSED % checks', n; end $$;
rollback;
