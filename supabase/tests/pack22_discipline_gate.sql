-- Pack 22 discipline gate (migration 20261018000500): penalties, suspensions, appeals, authenticity infractions, eligibility.
--   * vocabulary and review windows are traced to provisions that exist in the imported Buhurt International release
--   * competition documents: organizers only, published versions only, chosen from the classification (not hardcoded), frozen when finished
--   * match records snapshot the ruleset and the card concept (a green card is never a yellow card) and stay void-only
--   * event sanctions: head marshal / organizer; green card also the authenticity officer, one per competitor per event; never deleted
--   * authenticity findings: authenticity officer / head marshal / organizer; the fighter sees their own without the staff note
--   * suspensions: event / organization / platform authority only; cross-event and cross-organization boundaries; a change supersedes, a lift ends
--   * eligibility: a suspension BLOCKS acceptance, check-in, entry and readiness; a readiness override does not clear it
--   * appeals and Judiciary reviews: who lodges, who decides, deadlines from the documents, outcomes applied through the controlled paths only
--   * history is append-only; notifications reach the subject; no write function is executable by anon; direct table writes are refused
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack22_discipline_gate.sql
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

-- ================================================================ 1. vocabulary traced to the official text
select t.expect_eq('BI card concepts: verbal warning, reprimand, yellow, red and green cards, each distinct',
  (select string_agg(key || '=' || level, ',' order by sort) from public.discipline_card_types where governing_body = 'Buhurt International'),
  'verbal_warning=verbal_warning,reprimand=reprimand,yellow_card=yellow_card,red_card=red_card,green_card=green_card');
select t.expect_eq('every provision a card concept or a review window cites exists in the imported Buhurt International release',
  (select count(*) from (select unnest(sources) k from public.discipline_card_types where governing_body = 'Buhurt International'
                         union all select unnest(sources) from public.discipline_review_rules where governing_body = 'Buhurt International') s
    where not exists (select 1 from public.rule_provisions p join public.ruleset_versions rv on rv.id = p.ruleset_version_id join public.rulesets r on r.id = rv.ruleset_id
                      where r.governing_body = 'Buhurt International' and p.stable_key = s.k))::int, 0);
select t.expect_eq('review windows from the documents: 15 minutes, 14 days, 30 days',
  (select string_agg(kind || '=' || window_interval::text, ',' order by kind) from public.discipline_review_rules where governing_body = 'Buhurt International'),
  'event_appeal=00:15:00,judiciary_application=30 days,judiciary_red_card=14 days');

-- ================================================================ 2. the documents a competition is fought under
select t.as_user(t.u(3));
select t.expect_error('a scorekeeper cannot choose a competition''s documents', $$select public.apply_current_documents(t.k(1), 'Buhurt International')$$, '42501');
select t.as_user(t.u(8));
select t.expect_error('another event''s organizer cannot either', $$select public.apply_current_documents(t.k(1), 'Buhurt International')$$, '42501');
select t.as_user(t.u(1));
select t.expect_eq('the organizer applies the current documents for the format (from the classification, not a list in code)',
  (select (public.apply_current_documents(t.k(1), 'Buhurt International')) ->> 'count'), '3');
select t.expect_eq('a duels competition gets the duels rules, the duel regulations and the infractions document, not the buhurt ones',
  (select string_agg(r.inventory_key, ',' order by r.inventory_key) from public.competition_rulesets cr join public.ruleset_versions rv on rv.id = cr.ruleset_version_id join public.rulesets r on r.id = rv.ruleset_id where cr.competition_id = t.k(1)),
  'authenticity/infractions,marshal/duels-rules,tournament/duel-regulations');
select t.expect_eq('its primary rulebook is the duels rules', (select ruleset_version_id from public.competitions where id = t.k(1)), t.ver('marshal/duels-rules'));
select t.expect_error('only published versions can be listed', $$select public.set_competition_rulesets(t.k(1), array[t.ver('marshal/outrance-rules')])$$, '22023');
select t.expect_error('another governing body with nothing published is refused clearly', $$select public.apply_current_documents(t.k(1), 'Nobody')$$, 'P0002');
select t.as_admin();
update public.competitions set status = 'finished' where id = t.k(1);
select t.as_user(t.u(1));
select t.expect_error('a finished competition keeps its documents', $$select public.set_competition_rulesets(t.k(1), array[]::uuid[])$$, 'P0001');
select t.as_admin();
update public.competitions set status = 'running' where id = t.k(1);

-- ================================================================ 3. the tablet's card vocabulary and match records
select t.as_user(t.u(3));
select t.expect_error('a scorekeeper cannot set the card list', $$select public.apply_card_preset(t.ev(1), 'Buhurt International')$$, '42501');
select t.as_user(t.u(2));
select t.expect_eq('the head marshal sets the BI card list on the tablet (concept keys, not just labels)',
  (select string_agg(c ->> 'key', ',') from jsonb_array_elements(public.apply_card_preset(t.ev(1), 'Buhurt International') -> 'cards') c), 'reprimand,yellow_card,red_card,green_card');
select t.as_admin();
insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label) values
  (t.x(1), '00000000-0000-0000-0000-0000000f5d01', t.ev(1), 1, 'a', 'card', 'Yellow card'), (t.x(2), '00000000-0000-0000-0000-0000000f5d01', t.ev(1), 1, 'b', 'card', 'Green card'),
  (t.x(3), '00000000-0000-0000-0000-0000000f5d01', t.ev(1), 1, 'a', 'warning', null);
insert into public.match_discipline_private (discipline_id, reason, called_by, recorded_by) select id, 'gate', 'Knight Marshal', t.u(3) from public.match_discipline where id in (t.x(1), t.x(2), t.x(3));
select t.expect_eq('a match card records its concept: the green card is a green card, not a yellow one',
  (select string_agg(coalesce(card_key, '-'), ',' order by id) from public.match_discipline where id in (t.x(1), t.x(2), t.x(3))), 'yellow_card,green_card,-');
select t.expect_eq('and the ruleset version the fight was fought under', (select count(*) from public.match_discipline where id in (t.x(1), t.x(2)) and ruleset_version_id = t.ver('marshal/duels-rules'))::int, 2);
select t.expect_error('the snapshot can never be changed', $$update public.match_discipline set card_key = 'red_card' where id = t.x(1)$$, 'P0001');

-- ================================================================ 4. event-level sanctions
select t.as_user(t.u(3));
select t.expect_error('a scorekeeper cannot give an event sanction', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card')$$, '42501');
select t.as_user(t.u(6));
select t.expect_error('a field marshal cannot either', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card')$$, '42501');
select t.as_user(t.u(14));
select t.expect_error('nor the medic', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card')$$, '42501');
select t.as_user(t.u(8));
select t.expect_error('nor another event''s organizer', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card')$$, '42501');
select t.as_user(t.u(4));
select t.expect_error('the authenticity officer cannot give a yellow card', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card')$$, '42501');
select t.as_user(t.u(2));
select t.expect_error('a rule from a version still in review cannot be cited', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, null, 'yellow_card', t.bp('marshal/outrance-rules', '13'))$$, '22023');
select t.expect_error('the subject must take part in the event', $$select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(4), null, null, 'yellow_card')$$, '22023');
select t.expect_eq('the head marshal gives a yellow card at event level, citing Buhurt Regulations 6.2',
  (select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, t.k(1), 'yellow_card', t.bp('tournament/buhurt-regulations', '6.2'), 'Ignored the marshal''s command') ->> 'status'), 'ok');
select t.expect_eq('the same command again is a duplicate, not a second card', (select public.issue_event_sanction(t.x(10), t.ev(1), 'card', t.f(1), null, t.k(1), 'yellow_card') ->> 'status'), 'duplicate');
select t.expect_eq('the sanction carries the version of the rule it cites', (select ruleset_version_id from public.event_sanctions where id = t.x(10)), t.ver('tournament/buhurt-regulations'));
select t.as_user(t.u(4));
select t.expect_eq('the authenticity officer gives a green card', (select public.issue_event_sanction(t.x(11), t.ev(1), 'card', t.f(1), null, null, 'green_card', t.bp('tournament/buhurt-regulations', '6.4'), 'Modern gloves') ->> 'status'), 'ok');
select t.expect_error('one green card per competitor per event', $$select public.issue_event_sanction(t.x(12), t.ev(1), 'card', t.f(1), null, null, 'green_card')$$, 'P0001');
select t.as_user(t.u(2));
select t.expect_eq('a team disqualification names the team', (select public.issue_event_sanction(t.x(13), t.ev(1), 'team_disqualification', null, t.team(), t.k(2), null, t.bp('tournament/buhurt-regulations', '6.5.2'), 'Card limit') ->> 'status'), 'ok');
select t.as_admin();
select t.expect_error('a sanction is never deleted', $$delete from public.event_sanctions where id = t.x(10)$$, 'P0001');
select t.expect_error('a sanction''s facts never change', $$update public.event_sanctions set kind = 'removal' where id = t.x(10)$$, 'P0001');
select t.as_user(t.u(9));
select t.expect_eq('the fighter''s own account sees their sanctions (2) but not the staff reason',
  (select count(*) from public.event_sanctions where fighter_id = t.f(1))::text || '/' || (select count(*) from public.event_sanctions_private)::text, '2/0');
select t.as_user(t.u(10));
select t.expect_eq('the captain sees their team''s sanction only', (select string_agg(kind, ',') from public.event_sanctions), 'team_disqualification');
select t.as_user(t.u(13));
select t.expect_eq('a stranger sees none', (select count(*) from public.event_sanctions)::int, 0);
select t.as_anon();
select t.expect_error('anonymous visitors cannot read sanctions at all', $$select count(*) from public.event_sanctions$$, '42501');
select t.as_user(t.u(9));
select t.expect_eq('the fighter was told about the green card', t.notes(t.u(9), 'green_card_changed', 'issued'), 1);
select t.as_user(t.u(4));
select t.expect_error('only a green card is "removed"; other sanctions are withdrawn', $$select public.end_event_sanction(t.x(10), 'removed', 'mistake')$$, '42501');
select t.expect_eq('the authenticity officer removes the green card after validating the correction', (select public.end_event_sanction(t.x(11), 'removed', 'Gloves replaced and checked') ->> 'status'), 'ok');
select t.as_user(t.u(2));
select t.expect_eq('the head marshal withdraws the event yellow card with a reason', (select public.end_event_sanction(t.x(10), 'withdrawn', 'Recorded against the wrong fighter') ->> 'status'), 'ok');
select t.expect_eq('ending it again changes nothing', (select public.end_event_sanction(t.x(10), 'withdrawn', 'again') ->> 'status'), 'duplicate');
select t.expect_eq('the history keeps both facts, in order', (select string_agg(h ->> 'action', ',') from jsonb_array_elements(public.discipline_record_history('event_sanction', t.x(10))) h), 'issued,withdrawn');
select t.as_user(t.u(4));
select t.expect_eq('after removal a new green card can be given (still one active at a time)', (select public.issue_event_sanction(t.x(14), t.ev(1), 'card', t.f(1), null, null, 'green_card') ->> 'status'), 'ok');

-- ================================================================ 5. authenticity findings
select t.as_user(t.u(3));
select t.expect_error('a scorekeeper cannot record an authenticity finding', $$select public.record_authenticity_finding(t.x(20), t.r(1), 'moderate', 'gauntlets')$$, '42501');
select t.as_user(t.u(4));
select t.expect_error('the classification is minor, moderate or major', $$select public.record_authenticity_finding(t.x(20), t.r(1), 'severe', 'gauntlets')$$, '22023');
select t.expect_eq('the authenticity officer records a moderate infraction citing the Infractions document',
  (select public.record_authenticity_finding(t.x(20), t.r(1), 'moderate', 'gauntlets', t.bp('authenticity/infractions', '2.2'), 'staff only: modern rivets') ->> 'status'), 'ok');
select t.as_user(t.u(7));
select t.expect_eq('the check-in desk reads findings (its desk)', (select count(*) from public.authenticity_findings)::int, 1);
select t.as_user(t.u(9));
select t.expect_eq('the fighter cannot read the findings table (staff note) ...', (select count(*) from public.authenticity_findings)::int, 0);
select t.expect_eq('... but sees their own finding, without the note, in their record',
  (select (f -> 'findings' -> 0 ->> 'severity') || '/' || (f -> 'findings' -> 0 ->> 'item') || '/' || coalesce(f -> 'findings' -> 0 ->> 'note', 'no note') from public.fighter_discipline(t.f(1)) f), 'moderate/gauntlets/no note');
select t.as_user(t.u(4));
select t.expect_eq('corrected once', (select public.close_authenticity_finding(t.x(20), 'corrected') ->> 'status'), 'ok');
select t.expect_eq('closing again changes nothing', (select public.close_authenticity_finding(t.x(20), 'voided', 'again') ->> 'status'), 'duplicate');
select t.as_admin();
select t.expect_error('a finding is never edited or deleted', $$update public.authenticity_findings set severity = 'minor' where id = t.x(20)$$, 'P0001');

-- ================================================================ 6. suspensions: event authority
select t.as_user(t.u(3));
select t.expect_error('a scorekeeper cannot suspend', $$select public.issue_suspension(t.x(30), 'event', 'remainder_of_event', 'Repeated misconduct', t.f(3), null, t.ev(1))$$, '42501');
select t.as_user(t.u(2));
select t.expect_error('an event suspension has no end date of its own (use an organization or platform suspension for a period)',
  $$select public.issue_suspension(t.x(30), 'event', 'remainder_of_event', 'Repeated misconduct', t.f(3), null, t.ev(1), null, null, null, now() + interval '1 day')$$, '22023');
select t.expect_eq('the head marshal suspends Fighter 3 for the rest of the event',
  (select public.issue_suspension(t.x(30), 'event', 'remainder_of_event', 'Struck a grounded fighter after the stop', t.f(3), null, t.ev(1), null, null, null, null, t.bp('tournament/buhurt-regulations', '6.3.1')) ->> 'status'), 'ok');
select t.as_admin();
select t.expect_eq('readiness: blocked, with the reason in plain words', t.ready(t.r(5)), 'NOT READY: Not checked in, Armour inspection required, Suspended for the rest of this event');
select t.as_user(t.u(1));
select t.expect_error('a readiness override is refused for a suspended fighter (lift the suspension instead)', $$select public.set_readiness_override(t.r(5), 'Organizer override attempt')$$, 'P0001');
select t.as_admin();
select t.expect_eq('still NOT READY: no override clears a suspension', left(t.ready(t.r(5)), 9), 'NOT READY');
select t.as_user(t.u(7));
select t.expect_error('the check-in desk cannot check a suspended fighter in', $$select public.set_attendance(t.r(5), 'checked_in')$$, 'P0001');
select t.expect_eq('the desk sees why on the discipline desk (the label, not the private reason)',
  (select b ->> 'message' from jsonb_array_elements(public.event_discipline_overview(t.ev(1)) -> 'blocks') b where b ->> 'fighter_id' = t.f(3)::text), 'Suspended for the rest of this event');
select t.as_user(t.u(2));
select t.expect_eq('the head marshal lifts it, with a reason', (select public.lift_suspension(t.x(30), 'Video review: no strike after the stop') ->> 'status'), 'ok');
select t.as_user(t.u(7));
select t.expect_eq('after the lift the fighter can be checked in', (select public.set_attendance(t.r(5), 'checked_in') ->> 'state'), 'checked_in');

-- ================================================================ 7. suspensions: organization and platform authority, across events
select t.as_user(t.u(12));
select t.expect_error('Org B''s admin cannot suspend for Org A', $$select public.issue_suspension(t.x(31), 'organization', 'organization_events', 'x', t.f(1), null, null, t.org(1))$$, '42501');
select t.as_user(t.u(11));
select t.expect_error('an organization admin cannot issue a platform suspension', $$select public.issue_suspension(t.x(31), 'platform', 'all_events', 'Ban', t.f(1))$$, '42501');
select t.expect_eq('Org A''s admin suspends Fighter 1 from Org A events for 40 days',
  (select public.issue_suspension(t.x(31), 'organization', 'organization_events', 'Judiciary decision: temporary ban', t.f(1), null, null, t.org(1), null, now() - interval '1 hour', now() + interval '40 days') ->> 'status'), 'ok');
select t.as_admin();
select t.expect_eq('it blocks Org A''s events (now and next month) but not Org B''s',
  coalesce(private.discipline_block_reason(t.f(1), t.ev(1)), '-') || ' | ' || coalesce(private.discipline_block_reason(t.f(1), t.ev(3)), '-') || ' | ' || coalesce(private.discipline_block_reason(t.f(1), t.ev(2)), '-'),
  'Suspended from Org A events until ' || to_char((now() + interval '40 days') at time zone 'UTC', 'YYYY-MM-DD') || ' | Suspended from Org A events until ' || to_char((now() + interval '40 days') at time zone 'UTC', 'YYYY-MM-DD') || ' | -');
select t.expect_error('acceptance at a later Org A event is blocked', $$update public.registrations set status = 'accepted' where id = t.r(4)$$, 'P0001');
select t.expect_error('an entry into an Org A competition is blocked', $$insert into public.entries (competition_id, fighter_id) values (t.k(4), t.f(1))$$, 'P0001');
select t.expect_eq('an entry at the other organization''s event is not', (select count(*) from (select 1) x where (select private.discipline_entry_block(t.f(1), null, t.k(3))) is null)::int, 1);
select t.as_user(t.u(12));
select t.expect_eq('Org B''s admin cannot see Org A''s suspension', (select count(*) from public.discipline_suspensions)::int, 0);
select t.expect_error('nor lift it', $$select public.lift_suspension(t.x(31), 'x')$$, '42501');
select t.as_user(t.u(8));
select t.expect_eq('Org B''s organizer sees no block for Fighter 1 at their event', (select count(*) from public.discipline_eligibility(t.ev(2), t.f(1)) e where e.kind = 'block')::int, 0);
select t.as_user(t.u(7));
select t.expect_eq('Event 1''s desk sees the block (label only) ...', (select count(*) from public.discipline_eligibility(t.ev(1), t.f(1)) e where e.kind = 'block')::int, 1);
select t.expect_eq('... but cannot read Org A''s suspension record or its reason', (select count(*) from public.discipline_suspensions where id = t.x(31))::text || '/' || (select count(*) from public.discipline_suspensions_private)::text, '0/0');
select t.as_user(t.u(9));
select t.expect_eq('the fighter sees their own suspension in force, without the reason',
  (select (f -> 'suspensions' -> 0 ->> 'in_force') || '/' || coalesce(f -> 'suspensions' -> 0 ->> 'reason', 'no reason') from public.fighter_discipline(t.f(1)) f), 'true/no reason');
select t.expect_eq('and was notified', t.notes(t.u(9), 'suspension_changed'), 1);
select t.expect_error('a fighter cannot read another fighter''s record', $$select public.fighter_discipline(t.f(3))$$, '42501');
select t.as_user(t.u(11));
select t.expect_eq('a reduction is a new decision that supersedes the old one', (select public.change_suspension(t.x(32), t.x(31), now() + interval '5 days', 'Judiciary Committee reduced it') ->> 'status'), 'ok');
select t.as_admin();
select t.expect_eq('the old row is superseded, the new one is in force; next month''s event is no longer blocked',
  (select (superseded_by = t.x(32))::text from public.discipline_suspensions where id = t.x(31)) || ' / ' || coalesce(private.discipline_block_reason(t.f(1), t.ev(3)), 'not blocked'), 'true / not blocked');
select t.expect_error('a superseded suspension cannot be lifted (lift the decision in force)', $$select public.lift_suspension(t.x(31), 'x')$$);
select t.expect_error('a suspension is never deleted', $$delete from public.discipline_suspensions where id = t.x(32)$$, 'P0001');
select t.expect_error('nor rewritten', $$update public.discipline_suspensions set ends_at = now() + interval '1 day' where id = t.x(32)$$, 'P0001');
select t.as_user(t.u(9));
select t.expect_eq('the history follows the whole chain: issued, then changed', (select string_agg(h ->> 'action', ',') from jsonb_array_elements(public.discipline_record_history('suspension', t.x(32))) h), 'issued,changed');
select t.expect_eq('the fighter does not see who decided (staff and authority only)', (select count(*) from jsonb_array_elements(public.discipline_record_history('suspension', t.x(32))) h where h ->> 'by' is not null)::int, 0);
select t.as_user(t.u(5));
select t.expect_eq('the platform owner suspends Fighter 2 from all events (no end date)', (select public.issue_suspension(t.x(33), 'platform', 'all_events', 'Permanent ban voted by the NOs', t.f(2)) ->> 'status'), 'ok');
select t.as_admin();
select t.expect_eq('a platform suspension blocks every event', t.ready(t.r(2)), 'NOT READY: Not checked in, Armour inspection required, Suspended from all events (no end date)');
select t.as_user(t.u(11));
select t.expect_error('an organization admin cannot lift a platform suspension', $$select public.lift_suspension(t.x(33), 'x')$$, '42501');
select t.as_user(t.u(10));
select t.expect_eq('a team suspension blocks the team''s entries (captain told)',
  t.notes(t.u(10), 'suspension_changed'), 0);
select t.as_user(t.u(11));
select public.issue_suspension(t.x(34), 'organization', 'organization_events', 'Team ban', null, t.team(), null, t.org(1), null, now() - interval '1 hour', now() + interval '40 days');
select t.as_admin();
select t.expect_error('a suspended team cannot be entered', $$insert into public.entries (competition_id, team_id) values (t.k(5), t.team())$$, 'P0001');
select t.as_user(t.u(10));
select t.expect_eq('the captain was told and can read it', t.notes(t.u(10), 'suspension_changed')::text || '/' || (select count(*) from public.discipline_suspensions where team_id = t.team())::text, '1/1');

-- ================================================================ 8. appeals and Judiciary Committee reviews
select t.as_user(t.u(9));
select t.expect_error('a fighter does not lodge an appeal in the system (the captain tells the Secretary)', $$select public.lodge_review(t.x(40), 'event_appeal', 'Captain', 'Wrong card', t.x(1))$$, '42501');
select t.as_user(t.u(3));
select t.expect_eq('the Secretary (scorekeeper) records the captain''s appeal; it is due 15 minutes after the fight',
  (select (r ->> 'status') || '/' || (r ->> 'late') from public.lodge_review(t.x(40), 'event_appeal', 'Captain of D Fighter 1', 'False implementation of a penalty', t.x(1)) r), 'ok/false');
select t.expect_eq('due_by is 15 minutes after the reference time', (select (due_by - lodged_at) <= interval '15 minutes' and (due_by - lodged_at) > interval '14 minutes' from public.discipline_reviews where id = t.x(40)), true);
select t.expect_error('the Secretary cannot decide it', $$select public.decide_review(t.x(40), 'cards_withdrawn')$$, '42501');
select t.as_user(t.u(2));
select t.expect_error('the outcome must be one the document allows', $$select public.decide_review(t.x(40), 'revoked')$$, '22023');
select t.expect_eq('the Knight Marshal withdraws the card; with apply, the match record is voided through the Pack 13 path',
  (select public.decide_review(t.x(40), 'cards_withdrawn', 'Video shows a legal strike', true) ->> 'applied'), 'record voided');
select t.expect_eq('the yellow card is voided (never deleted)', (select (voided_at is not null)::text from public.match_discipline where id = t.x(1)), 'true');
select t.expect_eq('deciding again changes nothing', (select public.decide_review(t.x(40), 'kept') ->> 'status'), 'duplicate');
select t.as_user(t.u(3));
select public.lodge_review(t.x(41), 'event_appeal', 'Captain', 'Unregistered violation', t.x(3));
select t.as_admin();
update public.matches set queue_state = 'final', finalized_at = now() where id = '00000000-0000-0000-0000-0000000f5d01';
select t.as_user(t.u(2));
select t.expect_error('a final fight result is never changed silently by an appeal (reopen it first)', $$select public.decide_review(t.x(41), 'cards_withdrawn', 'x', true)$$, 'P0001');
select t.expect_eq('the appeal is recorded without applying it', (select public.decide_review(t.x(41), 'kept', 'Result stands') ->> 'status'), 'ok');
select t.expect_error('the head marshal cannot record a Judiciary Committee decision', $$select public.lodge_review(t.x(42), 'judiciary_application', 'D Fighter 1', 'Asks for review of the ban', null, null, t.x(32))$$, '42501');
select t.as_user(t.u(11));
select t.expect_eq('Org A''s admin records the application against its suspension; due in 30 days',
  (select (date_trunc('day', (r ->> 'due_by')::timestamptz) = date_trunc('day', now() + interval '30 days'))::text from public.lodge_review(t.x(42), 'judiciary_application', 'D Fighter 1', 'Asks for review of the ban', null, null, t.x(32)) r), 'true');
select t.expect_eq('the committee revoked it: recorded and applied (the suspension is lifted)', (select public.decide_review(t.x(42), 'revoked', 'Committee decision of the session', true) ->> 'applied'), 'suspension lifted');
select t.as_admin();
select t.expect_eq('Fighter 1 is no longer blocked at Org A events', coalesce(private.discipline_block_reason(t.f(1), t.ev(1)), 'not blocked'), 'not blocked');
select t.as_user(t.u(9));
select t.expect_eq('the fighter was told each decision (two appeals, one Judiciary review)', t.notes(t.u(9), 'review_decided'), 3);
select t.as_user(t.u(12));
select t.expect_eq('Org B''s admin cannot see Org A''s review', (select count(*) from public.discipline_reviews where id = t.x(42))::int, 0);

-- ================================================================ 9. reading boundaries and eligibility words
select t.as_user(t.u(14));
select t.expect_error('the medic cannot read the discipline desk', $$select public.event_discipline_overview(t.ev(1))$$, '42501');
select t.as_user(t.u(13));
select t.expect_error('a stranger cannot read the discipline desk', $$select public.event_discipline_overview(t.ev(1))$$, '42501');
select t.expect_error('nor anyone''s eligibility', $$select * from public.discipline_eligibility(t.ev(1), t.f(1))$$, '42501');
select t.as_user(t.u(3));
select t.expect_eq('the scorekeeper reads the desk but may not sanction, suspend or decide',
  (select (o -> 'can' ->> 'sanction') || (o -> 'can' ->> 'suspend') || (o -> 'can' ->> 'decide_appeal') || (o -> 'can' ->> 'lodge_appeal') from public.event_discipline_overview(t.ev(1)) o), 'falsefalsefalsetrue');
select t.expect_eq('card tallies are facts by concept, voided cards excluded (green 1 for Fighter 3, Fighter 1''s yellow voided)',
  (select string_agg((x ->> 'against') || ':' || (x -> 'cards')::text, ' ') from jsonb_array_elements(public.event_discipline_overview(t.ev(1)) -> 'tallies') x), 'D Fighter 3:{"green_card": 1}');
select t.as_user(t.u(9));
select t.expect_eq('the fighter sees warnings in plain words: the green card at the event',
  (select string_agg(e.kind || ':' || e.code, ',' order by e.code) from public.discipline_eligibility(t.ev(1), t.f(1)) e), 'warning:green_card');
select t.expect_error('the history table is not readable directly', $$select count(*) from public.discipline_history$$, '42501');
select t.as_admin();
select t.expect_error('history is append-only', $$update public.discipline_history set action = 'x'$$, 'P0001');

-- ================================================================ 10. privileges
select t.expect_eq('no Pack 22 discipline function is executable by anon',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('set_competition_rulesets', 'apply_current_documents', 'apply_card_preset', 'issue_event_sanction', 'end_event_sanction', 'record_authenticity_finding',
                       'close_authenticity_finding', 'issue_suspension', 'change_suspension', 'lift_suspension', 'lodge_review', 'decide_review', 'withdraw_review',
                       'discipline_eligibility', 'event_discipline_overview', 'fighter_discipline', 'discipline_record_history', 'managed_suspensions')
     and has_function_privilege('anon', p.oid, 'execute'))::int, 0);
select t.expect_eq('the policy helpers (yes/no about the caller) are for signed-in users only, never anon',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('can_see_discipline', 'is_my_fighter', 'can_manage_suspension', 'can_read_findings')
     and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute')))::int, 0);
select t.expect_eq('no other private discipline helper is executable by clients',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
     and p.proname in ('fighter_users', 'team_captain_users', 'discipline_block_reason', 'discipline_entry_block', 'suspension_applies',
                       'can_decide_review', 'discipline_log', 'suspension_notify', 'review_decided_notify', 'check_cited_provision')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))::int, 0);
select t.expect_eq('every new security definer function pins an empty search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public', 'private')
     and p.proname in ('set_competition_rulesets', 'apply_current_documents', 'apply_card_preset', 'issue_event_sanction', 'end_event_sanction', 'record_authenticity_finding',
                       'close_authenticity_finding', 'issue_suspension', 'change_suspension', 'lift_suspension', 'lodge_review', 'decide_review', 'withdraw_review',
                       'discipline_eligibility', 'event_discipline_overview', 'fighter_discipline', 'discipline_record_history', 'managed_suspensions', 'discipline_block_reason',
                       'can_see_discipline', 'suspension_applies', 'match_discipline_fill', 'registration_discipline_check', 'checkin_discipline_check', 'entry_discipline_check')
     and not (coalesce(p.proconfig, '{}') @> array['search_path=""']))::int, 0);
select t.expect_eq('RLS is on for every new table',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('competition_rulesets', 'discipline_card_types', 'discipline_history', 'event_sanctions', 'event_sanctions_private', 'authenticity_findings',
                       'discipline_suspensions', 'discipline_suspensions_private', 'discipline_review_rules', 'discipline_reviews'))::int, 10);
select t.as_user(t.u(2));
select t.expect_error('no client writes the tables directly', $$insert into public.discipline_suspensions (id, fighter_id, authority, event_id, scope, starts_at) values (gen_random_uuid(), t.f(4), 'event', t.ev(1), 'remainder_of_event', now())$$, '42501');

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK22 DISCIPLINE GATE PASSED % checks', n; end $$;
rollback;
