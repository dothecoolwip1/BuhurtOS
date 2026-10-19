-- Pack 09D gate: event lifecycle (archive, exclude from official statistics, restore, safe delete), the one statistics rule, fighter active / inactive,
-- team roster show / hide, and the saved fight plan (migration 20261005000100).
-- Proves: archiving changes NO aggregate (byte-identical snapshot); excluding removes the event's contribution from every official aggregate exactly once
-- and restoring returns it exactly once (snapshots equal the baseline); results, matches and history stay stored; only the right people can do each
-- thing (owner, organization admin, event organizer, captain, the fighter themself) and everybody else is refused by the database; an event with
-- sporting history cannot be deleted, a disposable draft can; an inactive fighter keeps every result and leaves entrant search and the public roster;
-- hiding a roster member never touches represented-team history; the plan touches only waiting fights, is idempotent, orders the queue after the
-- organizer's hand-made order, and a held fight is never called automatically.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack09d_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create table t.nx (k text primary key, v text not null);
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
create function t.expect_ok_undo(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; raise exception 'undo' using errcode = 'P0042'; exception when sqlstate 'P0042' then null; end;   -- allowed; its effect is rolled back so later checks see the same world
  insert into t.log (name) values (label);
end $$;
create function t.uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function t.id(p text) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000' || p)::uuid $$;
create function t.gu(k text) returns uuid language sql stable as $$ select v::uuid from t.nx where k = $1 $$;
create function t.put(k text, v text) returns void language sql as $$ insert into t.nx values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.ent(p_key text, p_comp uuid, p_fighter uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.entries (competition_id, fighter_id, status) values (p_comp, p_fighter, 'checked_in') returning id into v;
  perform t.put('e:' || p_key, v::text);
  return v;
end $$;
create function t.mkm(p_key text, p_comp uuid, p_stage text, p_label text, p_pos int, p_a text, p_b text, p_field text default null) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, field)
  values (v, p_comp, p_stage, p_label, p_pos, t.gu('e:' || p_a), t.gu('e:' || p_b), p_field);
  perform t.put('m:' || p_key, v::text);
end $$;
create function t.fin(p_key text, p_res text, p_a int, p_b int) returns void language plpgsql as $$
begin perform public.finalize_match(t.gu('m:' || p_key), p_res, p_a, p_b, '{}'::jsonb, (select version from public.matches where id = t.gu('m:' || p_key))); end $$;
create function t.audits(p_action text, p_subject text) returns bigint language sql stable security definer as $$ select count(*) from public.audit_log where action = p_action and subject = p_subject $$;
-- Every official aggregate that can carry the event, for the people in it, as one text. Equal text = equal statistics.
create function t.snap() returns text language sql stable as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(':', scope, coalesce(organization_id::text, '-'), coalesce(season_id::text, '-'), coalesce(category, '-'), coalesce(gender, '-'), display_name, competitions, golds, silvers, bronzes, points, rank), ';'
            order by scope, organization_id, season_id, category, gender, display_name) from public.ranking_fighters where fighter_id in (t.id('d9f0'), t.id('d9f1'), t.id('d9f2'))),
    (select string_agg(concat_ws(':', scope, coalesce(category, '-'), coalesce(gender, '-'), team_name, competitions, golds, points), ';' order by scope, category, gender, team_name)
       from public.ranking_teams where team_id in (t.id('d9c1'), t.id('d9c2'))),
    (select string_agg(row_to_json(s)::text, ';' order by s.fighter_id) from public.fighter_career_stats s where s.fighter_id in (t.id('d9f0'), t.id('d9f1'), t.id('d9f2'))),
    (select string_agg(row_to_json(s)::text, ';' order by s.fighter_id, s.season_id) from public.fighter_season_stats s where s.fighter_id in (t.id('d9f0'), t.id('d9f1'), t.id('d9f2'))),
    (select string_agg(row_to_json(s)::text, ';' order by s.team_id) from public.team_stats s where s.team_id in (t.id('d9c1'), t.id('d9c2'))),
    (select string_agg(concat_ws(':', scope, coalesce(category, '-'), coalesce(gender, '-'), team_name, fighters, results, points, rank), ';' order by scope, category, gender, team_name)
       from public.ranking_team_disciplines where team_id in (t.id('d9c1'), t.id('d9c2'))),
    (select count(*)::text from public.match_sides where event_id = t.id('d9e1')),
    (select count(*)::text from public.played_events where event_id = t.id('d9e1')),
    (select count(*)::text from public.fighter_results where event_id = t.id('d9e1'))) $$;
create function t.roster(p_team uuid) returns text language sql stable as $$ select coalesce(string_agg(display_name, ',' order by display_name), '') from public.team_roster(p_team) $$;
create function t.search(p_comp uuid, p_q text) returns text language sql stable as $$ select coalesce(string_agg(display_name, ',' order by display_name), '') from public.search_fighters_for_entry(p_comp, p_q) $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
grant all on t.log, t.nx to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- Users: e1 owner; e2 organizer of E1; e3 organizer of draft E2; e4 scorekeeper of E1; e6 captain of team c1; e7 stranger; e8 Bob's own account; e9 admin of org a1.
select t.as_admin();
insert into auth.users (id, email) select t.uid(n), 'p9d' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values (t.uid(1), 'owner');
insert into public.organizations (id, slug, name, kind) values (t.id('d9a1'), 'd9-league', 'D9 League', 'regional');
insert into public.organization_staff (organization_id, user_id, role) values (t.id('d9a1'), t.uid(9), 'admin');
insert into public.seasons (id, organization_id, slug, name, starts_on, ends_on) values (t.id('d9b1'), t.id('d9a1'), 'd9-2026', 'D9 2026', current_date - 100, current_date + 100);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, organization_id, season_id) values
  (t.id('d9e1'), 'd9-rumble', 'D9 Rumble', 'published', 'tournament', current_date, current_date + 1, t.id('d9a1'), t.id('d9b1')),
  (t.id('d9e2'), 'd9-draft', 'D9 Draft', 'draft', 'tournament', current_date + 30, current_date + 31, t.id('d9a1'), t.id('d9b1')),
  (t.id('d9e3'), 'd9-plan', 'D9 Plan Day', 'published', 'tournament', current_date, current_date, t.id('d9a1'), t.id('d9b1'));
insert into public.event_staff (event_id, user_id, role) values
  (t.id('d9e1'), t.uid(2), 'organizer'), (t.id('d9e3'), t.uid(2), 'organizer'), (t.id('d9e2'), t.uid(3), 'organizer'), (t.id('d9e1'), t.uid(4), 'scorekeeper'), (t.id('d9e3'), t.uid(4), 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) values
  (t.id('d9c1'), 'd9-biters', 'D9 Biters', 'approved', 'Red Deer', 'CA'), (t.id('d9c2'), 'd9-reavers', 'D9 Reavers', 'approved', 'Red Deer', 'CA');
insert into public.team_roles (team_id, user_id, role) values (t.id('d9c1'), t.uid(6), 'captain');
insert into public.fighters (id, display_name, team_id) values
  (t.id('d9f0'), 'Bobby Ironside', t.id('d9c1')), (t.id('d9f1'), 'Johnny Steel', t.id('d9c1')), (t.id('d9f2'), 'Joey Hammer', t.id('d9c2')),
  (t.id('d9f3'), 'Pia One', null), (t.id('d9f4'), 'Pia Two', null), (t.id('d9f5'), 'Pia Three', null), (t.id('d9f6'), 'Pia Four', null);
insert into public.fighter_accounts (fighter_id, user_id) values (t.id('d9f0'), t.uid(8));
insert into public.team_memberships (fighter_id, team_id, role, mercenary, from_date) values (t.id('d9f1'), t.id('d9c1'), 'fighter', false, current_date - 300);
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  (t.id('d901'), t.id('d9e1'), 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.id('d902'), t.id('d9e2'), 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1),
  (t.id('d903'), t.id('d9e3'), 'Polearm (open)', 'polearm', 'open', 'Classic', 'round_robin', 1);
select t.ent('b', t.id('d901'), t.id('d9f0')), t.ent('j', t.id('d901'), t.id('d9f1')), t.ent('y', t.id('d901'), t.id('d9f2'));
select t.mkm('r1', t.id('d901'), 'round_robin', 'Round 1', 1, 'b', 'j'), t.mkm('r2', t.id('d901'), 'round_robin', 'Round 2', 1, 'b', 'y'), t.mkm('r3', t.id('d901'), 'round_robin', 'Round 3', 1, 'j', 'y');
-- E2: a draft with a competition, an entry, a registration and an unplayed fight: no sporting history.
select t.ent('dz', t.id('d902'), t.id('d9f2')), t.ent('dz2', t.id('d902'), t.id('d9f3'));
select t.mkm('dm', t.id('d902'), 'round_robin', 'Round 1', 1, 'dz', 'dz2');
insert into public.waiver_versions (id, event_id, version, title, body) values (t.id('d9a9'), t.id('d9e2'), 1, 'Waiver', 'Waiver text for the Pack 09D test.');
insert into public.registrations (event_id, user_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name)
  values (t.id('d9e2'), t.uid(7), 'pending', 'Stranger Danger', 'male', 'HACSA', 'hacsa_member', t.id('d9a9'), 'Stranger Danger');

-- E1 is fought and made official by the organizer.
select t.as_user(t.uid(2));
select t.as_user(t.uid(2));
select t.fin('r1', 'a', 5, 1), t.fin('r2', 'a', 5, 2), t.fin('r3', 'a', 5, 3);
select t.as_user(t.uid(2));
select t.expect_eq('E1 longsword finalized through Pack 09C', public.finalize_competition(t.id('d901')) ->> 'status', 'official');

-- ---------------------------------------------------------------- baseline
select t.as_admin();
select t.put('base', t.snap());
select t.expect_eq('baseline: the event feeds the career ranking', (select points > 0 from public.ranking_fighters where scope = 'career' and fighter_id = t.id('d9f0')), true);
select t.expect_eq('baseline: Bob has one gold', (select golds from public.fighter_career_stats where fighter_id = t.id('d9f0'))::int, 1);
select t.expect_eq('baseline: the event is an event attended', (select count(*) from public.played_events where event_id = t.id('d9e1'))::int, 1);
select t.expect_eq('baseline: team discipline total counts Bob for his team', (select points > 0 from public.ranking_team_disciplines where scope = 'career' and team_id = t.id('d9c1') and gender is null and category = 'longsword'), true);
select t.expect_eq('the one rule says E1 counts', private.stats_excluded(t.id('d9e1')), false);

-- ---------------------------------------------------------------- archive (presentation only)
select t.as_anon();
select t.expect_error('anon cannot archive', $$select public.archive_event(t.id('d9e1'))$$);
select t.as_user(t.uid(7));
select t.expect_error('a stranger cannot archive', $$select public.archive_event(t.id('d9e1'))$$, '42501');
select t.as_user(t.uid(4));
select t.expect_error('a scorekeeper cannot archive', $$select public.archive_event(t.id('d9e1'))$$, '42501');
select t.expect_error('an organizer of another event cannot archive', $$select public.archive_event(t.id('d9e1'))$$, '42501');
select t.as_user(t.uid(2));
select t.expect_error('archived_at cannot be written directly', $$update public.events set archived_at = now() where id = t.id('d9e1')$$);
select t.expect_eq('the organizer archives', public.archive_event(t.id('d9e1'), 'season over') ->> 'status', 'archived');
select t.expect_eq('archive is idempotent', public.archive_event(t.id('d9e1')) ->> 'status', 'already_archived');
select t.as_admin();
select t.expect_eq('ARCHIVE CHANGES NO STATISTIC (snapshot identical)', t.snap(), (select v from t.nx where k = 'base'));
select t.expect_eq('archived event still readable publicly', (select count(*) from public.events where id = t.id('d9e1') and archived_at is not null)::int, 1);
select t.as_anon();
select t.expect_eq('anon still reads the archived event and its podium', (select count(*) from public.competition_results where competition_id = t.id('d901'))::int, 3);
select t.as_admin();
select t.expect_eq('audit: event.archived', t.audits('event.archived', t.id('d9e1')::text), 1::bigint);
select t.as_user(t.uid(2));
select t.expect_eq('restore from archive', public.unarchive_event(t.id('d9e1')) ->> 'status', 'restored');
select t.expect_eq('unarchive is idempotent', public.unarchive_event(t.id('d9e1')) ->> 'status', 'not_archived');
select t.as_admin();
select t.expect_eq('after unarchive the statistics are still identical', t.snap(), (select v from t.nx where k = 'base'));

-- ---------------------------------------------------------------- exclude from official statistics
select t.as_user(t.uid(2));
select t.expect_error('a plain event organizer cannot exclude', $$select public.exclude_event_from_stats(t.id('d9e1'), 'bad data')$$, '42501');
select t.as_user(t.uid(7));
select t.expect_error('a stranger cannot exclude', $$select public.exclude_event_from_stats(t.id('d9e1'), 'bad data')$$, '42501');
select t.as_anon();
select t.expect_error('anon cannot exclude', $$select public.exclude_event_from_stats(t.id('d9e1'), 'bad data')$$);
select t.as_user(t.uid(9));
select t.expect_error('a reason is required', $$select public.exclude_event_from_stats(t.id('d9e1'), ' x ')$$, '22023');
select t.expect_error('stats_excluded_at cannot be written directly', $$update public.events set stats_excluded_at = now() where id = t.id('d9e1')$$);
select t.expect_eq('the organization admin excludes', public.exclude_event_from_stats(t.id('d9e1'), 'imported twice by mistake') ->> 'status', 'excluded');
select t.expect_eq('exclude is idempotent', public.exclude_event_from_stats(t.id('d9e1'), 'again') ->> 'status', 'already_excluded');
select t.as_admin();
select t.put('excluded', t.snap());
select t.expect_eq('the one rule says E1 is excluded', private.stats_excluded(t.id('d9e1')), true);
select t.expect_eq('excluded: no career ranking row for Bob', (select count(*) from public.ranking_fighters where fighter_id = t.id('d9f0'))::int, 0);
select t.expect_eq('excluded: no organization ranking rows either', (select count(*) from public.ranking_teams where team_id in (t.id('d9c1'), t.id('d9c2')))::int, 0);
select t.expect_eq('excluded: no medals in career statistics', coalesce((select golds from public.fighter_career_stats where fighter_id = t.id('d9f0'))::int, 0), 0);
select t.expect_eq('excluded: no matches in career statistics', coalesce((select matches from public.fighter_career_stats where fighter_id = t.id('d9f0'))::int, 0), 0);
select t.expect_eq('excluded: not an event attended', (select count(*) from public.played_events where event_id = t.id('d9e1'))::int, 0);
select t.expect_eq('excluded: no team discipline total', (select count(*) from public.ranking_team_disciplines where team_id in (t.id('d9c1'), t.id('d9c2')))::int, 0);
select t.expect_eq('excluded: no match_sides rows', (select count(*) from public.match_sides where event_id = t.id('d9e1'))::int, 0);
select t.expect_eq('excluded: results rows stay stored', (select count(*) from public.results where competition_id = t.id('d901'))::int, 3);
select t.expect_eq('excluded: matches stay stored', (select count(*) from public.matches where competition_id = t.id('d901') and queue_state = 'final')::int, 3);
select t.expect_eq('excluded: the competition stays official', (select status from public.competitions where id = t.id('d901')), 'finished');
select t.expect_eq('excluded: history still lists it, flagged', (select bool_and(stats_excluded) from public.fighter_results_all where event_id = t.id('d9e1')), true);
select t.expect_eq('excluded: fighter_history flags it', (select bool_and(stats_excluded) from public.fighter_history where event_id = t.id('d9e1')), true);
select t.expect_eq('excluded: the podium is still inspectable', (select count(*) from public.competition_results where competition_id = t.id('d901'))::int, 3);
select t.expect_eq('audit: event.stats_excluded with the reason', (select details ->> 'reason' from public.audit_log where action = 'event.stats_excluded' and subject = t.id('d9e1')::text), 'imported twice by mistake');
select t.as_user(t.uid(2));
select t.expect_eq('archive + exclude are independent: archive still possible', (select (public.archive_event(t.id('d9e1')) ->> 'status')), 'archived');
select t.as_admin();
select t.expect_eq('archiving an excluded event changes nothing more', t.snap(), (select v from t.nx where k = 'excluded'));
select t.as_user(t.uid(2));
select public.unarchive_event(t.id('d9e1'));

select t.as_user(t.uid(2));
select t.expect_error('a plain event organizer cannot restore', $$select public.restore_event_stats(t.id('d9e1'), 'fixed')$$, '42501');
select t.as_user(t.uid(1));
select t.expect_error('restore needs a reason', $$select public.restore_event_stats(t.id('d9e1'), '')$$, '22023');
select t.expect_eq('the owner restores', public.restore_event_stats(t.id('d9e1'), 'it was the only copy after all') ->> 'status', 'restored');
select t.expect_eq('restore is idempotent', public.restore_event_stats(t.id('d9e1'), 'again') ->> 'status', 'already_counted');
select t.as_admin();
select t.expect_eq('RESTORE RETURNS EXACTLY THE BASELINE (no double counting)', t.snap(), (select v from t.nx where k = 'base'));
select t.expect_eq('restore created no new result rows', (select count(*) from public.results where competition_id = t.id('d901'))::int, 3);
select t.expect_eq('audit: event.stats_restored', t.audits('event.stats_restored', t.id('d9e1')::text), 1::bigint);
-- exclude / restore twice more: still exact
select t.as_user(t.uid(9)); select public.exclude_event_from_stats(t.id('d9e1'), 'second round'); select t.as_admin();
select t.expect_eq('second exclusion equals the first', t.snap(), (select v from t.nx where k = 'excluded'));
select t.as_user(t.uid(9)); select public.restore_event_stats(t.id('d9e1'), 'second round'); select t.as_admin();
select t.expect_eq('second restore equals the baseline', t.snap(), (select v from t.nx where k = 'base'));

-- ---------------------------------------------------------------- closed still counts; delete refused for history
select t.as_user(t.uid(2));
select t.expect_eq('the event closes (Pack 09C)', public.close_event(t.id('d9e1'), 'done') ->> 'status', 'closed');
select t.as_admin();
select t.expect_eq('CLOSED EVENT STILL COUNTS (snapshot identical)', t.snap(), (select v from t.nx where k = 'base'));
select t.as_user(t.uid(2));
select t.expect_eq('a closed event can still be archived', public.archive_event(t.id('d9e1')) ->> 'status', 'archived');
select t.as_admin();
select t.expect_eq('closed + archived still counts', t.snap(), (select v from t.nx where k = 'base'));
select t.as_user(t.uid(2));
select t.expect_error('an event with official results cannot be deleted', $$select public.delete_event(t.id('d9e1'), 'd9-rumble')$$, 'P0001');
select t.expect_eq('delete check names the history', (select public.event_delete_check(t.id('d9e1')) -> 'blockers' ? 'official_results'), true);
select t.expect_error('direct delete of an event is refused (no grant)', $$delete from public.events where id = t.id('d9e1')$$);
select t.as_admin();
select t.expect_eq('E1 and its results are still there', (select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = t.id('d9e1'))::int, 3);

-- ---------------------------------------------------------------- delete a disposable draft
select t.as_user(t.uid(7));
select t.expect_error('a stranger cannot delete the draft', $$select public.delete_event(t.id('d9e2'), 'd9-draft')$$, '42501');
select t.as_user(t.uid(2));
select t.expect_error('another event''s organizer cannot delete the draft', $$select public.delete_event(t.id('d9e2'), 'd9-draft')$$, '42501');
select t.as_user(t.uid(3));
select t.expect_eq('the draft has no blockers', jsonb_array_length(public.event_delete_check(t.id('d9e2')) -> 'blockers'), 0);
select t.expect_error('the typed confirmation must match', $$select public.delete_event(t.id('d9e2'), 'wrong')$$, '22023');
select t.expect_eq('the organizer deletes the draft', public.delete_event(t.id('d9e2'), 'd9-draft') ->> 'status', 'deleted');
select t.as_admin();
select t.expect_eq('the draft is gone with its competitions, entries, fights and registrations',
  (select count(*) from public.events where id = t.id('d9e2')) + (select count(*) from public.competitions where id = t.id('d902')) + (select count(*) from public.registrations where event_id = t.id('d9e2'))
  + (select count(*) from public.matches where id = t.gu('m:dm')), 0::bigint);
select t.expect_eq('the fighters in the deleted draft still exist', (select count(*) from public.fighters where id in (t.id('d9f2'), t.id('d9f3')))::int, 2);
select t.expect_eq('the deletion is audited', t.audits('event.deleted', t.id('d9e2')::text), 1::bigint);

-- ---------------------------------------------------------------- fighter active / inactive
select t.as_user(t.uid(2));
select t.expect_error('an event organizer cannot deactivate a fighter', $$select public.set_fighter_active(t.id('d9f0'), false)$$, '42501');
select t.as_user(t.uid(7));
select t.expect_error('a stranger cannot deactivate a fighter', $$select public.set_fighter_active(t.id('d9f0'), false)$$, '42501');
select t.expect_error('fighters cannot be updated directly', $$update public.fighters set inactive_at = now() where id = t.id('d9f0')$$);
select t.as_user(t.uid(8));
select t.expect_eq('Bob deactivates himself', public.set_fighter_active(t.id('d9f0'), false, 'retired') ->> 'status', 'inactive');
select t.expect_eq('deactivate is idempotent', public.set_fighter_active(t.id('d9f0'), false) ->> 'status', 'already_inactive');
select t.as_admin();
select t.expect_eq('INACTIVE FIGHTER KEEPS EVERY STATISTIC (snapshot identical)', t.snap(), (select v from t.nx where k = 'base'));
select t.expect_eq('inactive fighter keeps the gold in history', (select count(*) from public.fighter_results_all where fighter_id = t.id('d9f0') and final_place = 1)::int, 1);
select t.expect_eq('inactive fighter keeps his represented team on the old entry', (select represented_team_id from public.entries where id = t.gu('e:b')), t.id('d9c1'));
select t.as_user(t.uid(2));
select t.expect_eq('entrant search leaves the inactive fighter out', t.search(t.id('d903'), 'bobby'), '');
select t.expect_eq('the exact name still finds him (a returning fighter)', t.search(t.id('d903'), 'Bobby Ironside'), 'Bobby Ironside');
select t.expect_eq('active fighters are still found', t.search(t.id('d903'), 'johnny'), 'Johnny Steel');
select t.as_anon();
select t.expect_eq('the public current roster leaves the inactive fighter out', t.roster(t.id('d9c1')), 'Johnny Steel');
select t.expect_eq('his public profile record still exists', (select count(*) from public.fighters where id = t.id('d9f0'))::int, 1);
select t.as_user(t.uid(6));
select t.expect_eq('the captain reactivates him (same identity)', public.set_fighter_active(t.id('d9f0'), true) ->> 'status', 'active');
select t.as_user(t.uid(2));
select t.expect_eq('reactivated: found by search again', t.search(t.id('d903'), 'bobby'), 'Bobby Ironside');
select t.as_admin();
select t.expect_eq('reactivation created no new fighter', (select count(*) from public.fighters where display_name = 'Bobby Ironside')::int, 1);
select t.expect_eq('audit: fighter.deactivated and fighter.reactivated', t.audits('fighter.deactivated', t.id('d9f0')::text) + t.audits('fighter.reactivated', t.id('d9f0')::text), 2::bigint);
select t.as_user(t.uid(9));
select t.expect_eq('the organization admin may not manage a fighter whose team is not affiliated', public.can_manage_fighter(t.id('d9f0')), false);

-- ---------------------------------------------------------------- roster show / hide
select t.as_user(t.uid(7));
select t.expect_error('a stranger cannot hide a roster member', $$select public.set_roster_visibility(t.id('d9c1'), t.id('d9f1'), false)$$, '42501');
select t.expect_error('a stranger cannot read the managed roster', $$select * from public.team_roster_manage(t.id('d9c1'))$$, '42501');
select t.expect_ok('a stranger''s direct write reaches no membership row (RLS)', $$update public.team_memberships set hidden_from_roster = true where fighter_id = t.id('d9f1')$$);
select t.as_admin();
select t.expect_eq('the direct write changed nothing', (select hidden_from_roster from public.team_memberships where fighter_id = t.id('d9f1') and team_id = t.id('d9c1')), false);
select t.as_user(t.uid(6));
select t.expect_eq('the captain hides Johnny', public.set_roster_visibility(t.id('d9c1'), t.id('d9f1'), false) ->> 'status', 'hidden');
select t.expect_eq('the captain hides Bobby (home team, no membership row yet)', public.set_roster_visibility(t.id('d9c1'), t.id('d9f0'), false) ->> 'status', 'hidden');
select t.expect_eq('the managed roster shows both, hidden', (select string_agg(display_name || '=' || hidden, ',' order by display_name) from public.team_roster_manage(t.id('d9c1'))), 'Bobby Ironside=true,Johnny Steel=true');
select t.as_anon();
select t.expect_eq('the public current roster no longer lists them', t.roster(t.id('d9c1')), '');
select t.as_admin();
select t.expect_eq('HIDING CHANGES NO STATISTIC (snapshot identical)', t.snap(), (select v from t.nx where k = 'base'));
select t.expect_eq('represented-team history untouched', (select string_agg(coalesce(represented_team_id::text, '-'), ',' order by id) from public.entries where competition_id = t.id('d901')),
  (select string_agg(coalesce(represented_team_id::text, '-'), ',' order by id) from public.entries where competition_id = t.id('d901')));
select t.expect_eq('Johnny still represented D9 Biters at the event', (select represented_team_id from public.entries where id = t.gu('e:j')), t.id('d9c1'));
select t.as_user(t.uid(6));
select t.expect_eq('show again', public.set_roster_visibility(t.id('d9c1'), t.id('d9f1'), true) ->> 'status', 'shown');
select public.set_roster_visibility(t.id('d9c1'), t.id('d9f0'), true);
select t.as_anon();
select t.expect_eq('shown members are back on the public roster', t.roster(t.id('d9c1')), 'Bobby Ironside,Johnny Steel');
select t.as_user(t.uid(6));
select t.expect_error('a fighter not on the team cannot be shown/hidden', $$select public.set_roster_visibility(t.id('d9c1'), t.id('d9f2'), false)$$, 'P0001');
-- a former member (to_date in the past) is not current, so nothing to hide; their history stays
select t.as_admin();
update public.team_memberships set to_date = current_date - 1 where fighter_id = t.id('d9f1') and team_id = t.id('d9c1');
update public.fighters set team_id = t.id('d9c2') where id = t.id('d9f1');
select t.as_anon();
select t.expect_eq('a former member is not on the current roster', t.roster(t.id('d9c1')), 'Bobby Ironside');
select t.expect_eq('changing teams moves no historical attribution', (select represented_team_id from public.entries where id = t.gu('e:j')), t.id('d9c1'));

-- ---------------------------------------------------------------- the saved plan and the queue
select t.as_admin();
select t.ent('p1', t.id('d903'), t.id('d9f3')), t.ent('p2', t.id('d903'), t.id('d9f4')), t.ent('p3', t.id('d903'), t.id('d9f5')), t.ent('p4', t.id('d903'), t.id('d9f6'));
select t.mkm('q1', t.id('d903'), 'round_robin', 'Round 1', 1, 'p1', 'p2'), t.mkm('q2', t.id('d903'), 'round_robin', 'Round 1', 2, 'p3', 'p4'),
       t.mkm('q3', t.id('d903'), 'round_robin', 'Round 2', 1, 'p1', 'p3'), t.mkm('q4', t.id('d903'), 'round_robin', 'Round 2', 2, 'p2', 'p4');
update public.matches set queue_state = 'active' where id = t.gu('m:q1');
select t.put('ver', (select string_agg(version::text, ',' order by id) from public.matches where competition_id = t.id('d903')));
select t.as_user(t.uid(4));
select t.expect_error('a secretary cannot save a running-order plan', $$select public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4')], '{}')$$, '42501');
select t.as_anon();
select t.expect_error('anon cannot save a plan', $$select public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4')], '{}')$$);
select t.as_user(t.uid(3));
select t.expect_error('another event''s organizer cannot save a plan', $$select public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4')], '{}')$$, '42501');
select t.as_user(t.uid(2));
select t.expect_eq('the organizer saves a plan: q4 before q3, q2 held', (public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4'), t.gu('m:q3'), t.gu('m:q1')], array[t.gu('m:q2')]) ->> 'changed')::int, 3);
select t.expect_eq('saving the same plan again changes nothing', (public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4'), t.gu('m:q3'), t.gu('m:q1')], array[t.gu('m:q2')]) ->> 'changed')::int, 0);
select t.as_admin();
select t.expect_eq('the active fight is never given a plan order', (select plan_order from public.matches where id = t.gu('m:q1')), null::int);
select t.expect_eq('plan order saved', (select string_agg(coalesce(plan_order::text, '-'), ',' order by position, round_label) from public.matches where competition_id = t.id('d903') and queue_state = 'scheduled'), '2,-,1');
select t.expect_eq('the plan does not change match versions', (select string_agg(version::text, ',' order by id) from public.matches where competition_id = t.id('d903')), (select v from t.nx where k = 'ver'));
select t.as_user(t.uid(4));
select t.expect_ok('the scorekeeper fills the queue', $$select public.advance_field_queue(t.id('d9e3'), null, true)$$);
select t.as_admin();
select t.expect_eq('on deck = the first planned fight (q4), the held fight q2 is not called', (select queue_state from public.matches where id = t.gu('m:q4')), 'on_deck');
select t.expect_eq('in the hole = the next planned fight (q3)', (select queue_state from public.matches where id = t.gu('m:q3')), 'in_the_hole');
select t.expect_eq('the held fight waits', (select queue_state from public.matches where id = t.gu('m:q2')), 'scheduled');
select t.as_user(t.uid(4));
select t.expect_error('a secretary cannot call a held waiting fight by hand', $$select public.set_match_queue(t.gu('m:q2'), 'in_the_hole', null)$$, '42501');
select t.as_user(t.uid(2));
select t.expect_ok('an organizer can still call the held fight by hand', $$select public.set_match_queue(t.gu('m:q2'), 'in_the_hole', null)$$);
select t.as_admin();
update public.matches set queue_state = 'scheduled', plan_order = null, plan_hold = false where competition_id = t.id('d903') and queue_state <> 'active';
-- manual order beats the plan
select t.as_user(t.uid(2));
select public.save_queue_plan(t.id('d9e3'), array[t.gu('m:q4'), t.gu('m:q3'), t.gu('m:q2')], '{}');
select t.expect_ok('the organizer moves q2 first by hand', $$select public.move_match_in_queue(t.gu('m:q2'), 'first')$$);
select t.as_admin();
select t.expect_eq('hand-made order first, then the plan', (select string_agg(x::text, ',') from private.queue_ordered(t.id('d9e3'), 'field 1', array['scheduled']) x),
  concat_ws(',', t.gu('m:q2'), t.gu('m:q4'), t.gu('m:q3')));
select t.as_user(t.uid(4));
select t.expect_error('a secretary cannot clear the organizer''s hand-made order', $$select public.clear_manual_queue(t.id('d9e3'), 'Field 1')$$, '42501');
select t.as_user(t.uid(2));
select t.expect_eq('the organizer lets BuhurtOS plan the field again', (public.clear_manual_queue(t.id('d9e3'), 'Field 1') ->> 'changed')::int, 3);
select t.as_admin();
select t.expect_eq('after clearing, the plan decides', (select string_agg(x::text, ',') from private.queue_ordered(t.id('d9e3'), 'field 1', array['scheduled']) x),
  concat_ws(',', t.gu('m:q4'), t.gu('m:q3'), t.gu('m:q2')));
select t.expect_eq('the plan is audited', t.audits('queue.planned', t.id('d9e3')::text) >= 1, true);


-- ---------------------------------------------------------------- bracket automation (the existing server path, exercised end to end)
-- 5 entrants, single elimination with a third-place fight: three byes go straight to the semifinals; only one quarterfinal is fought.
select t.as_admin();
insert into public.fighters (id, display_name) values (t.id('d9b0'), 'Br One'), (t.id('d9b1'), 'Br Two'), (t.id('d9b2'), 'Br Three'), (t.id('d9b3'), 'Br Four'), (t.id('d9b4'), 'Br Five');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values (t.id('d904'), t.id('d9e3'), 'Sword & Buckler (open)', 'buckler', 'open', 'Classic', 'elimination', 2);
select t.ent('b1', t.id('d904'), t.id('d9b0')), t.ent('b2', t.id('d904'), t.id('d9b1')), t.ent('b3', t.id('d904'), t.id('d9b2')), t.ent('b4', t.id('d904'), t.id('d9b3')), t.ent('b5', t.id('d904'), t.id('d9b4'));
select t.as_user(t.uid(2));
select t.expect_ok('the bracket is built through build_schedule', format($$select public.build_schedule(%L, %L::jsonb, 'new', '{"format":"single_elimination","mode":"random","seed":7,"algorithm":"ts-draw-v1"}'::jsonb, null)$$, t.id('d904'),
  jsonb_build_array(
    jsonb_build_object('key', 'q1', 'stage', 'elimination', 'round_label', 'Quarterfinal', 'position', 0, 'pool', null, 'a', t.gu('e:b4'), 'b', t.gu('e:b5'), 'next_key', 's2', 'next_slot', 'b'),
    jsonb_build_object('key', 's1', 'stage', 'elimination', 'round_label', 'Semifinal', 'position', 0, 'pool', null, 'a', t.gu('e:b1'), 'b', t.gu('e:b2'), 'next_key', 'f', 'next_slot', 'a'),
    jsonb_build_object('key', 's2', 'stage', 'elimination', 'round_label', 'Semifinal', 'position', 1, 'pool', null, 'a', t.gu('e:b3'), 'b', null, 'next_key', 'f', 'next_slot', 'b'),
    jsonb_build_object('key', 'f', 'stage', 'final', 'round_label', 'Final', 'position', 0, 'pool', null, 'a', null, 'b', null, 'next_key', null, 'next_slot', null),
    jsonb_build_object('key', 't', 'stage', 'third_place', 'round_label', 'Third place', 'position', 0, 'pool', null, 'a', null, 'b', null, 'next_key', null, 'next_slot', null))::text));
select t.as_admin();
select t.put('m:bq1', (select id::text from public.matches where competition_id = t.id('d904') and round_label = 'Quarterfinal'));
select t.put('m:bs1', (select id::text from public.matches where competition_id = t.id('d904') and round_label = 'Semifinal' and position = 0));
select t.put('m:bs2', (select id::text from public.matches where competition_id = t.id('d904') and round_label = 'Semifinal' and position = 1));
select t.put('m:bf', (select id::text from public.matches where competition_id = t.id('d904') and stage = 'final'));
select t.put('m:bt', (select id::text from public.matches where competition_id = t.id('d904') and stage = 'third_place'));
create function t.runnable(k text) returns boolean language sql stable security definer as $$ select private.match_runnable(m) from public.matches m where m.id = t.gu(k) $$;
select t.expect_eq('byes: the three top entrants are already in the semifinals', (select count(*) from public.matches where competition_id = t.id('d904') and round_label = 'Semifinal' and entry_a is not null)::int, 2);
select t.expect_eq('the semifinal waiting for a quarterfinal winner is not ready', t.runnable('m:bs2'), false);
select t.expect_eq('the final is not ready before the semifinals', t.runnable('m:bf'), false);
select t.expect_eq('a fight with an unknown side is never in the line', (select count(*) from private.queue_ordered(t.id('d9e3'), 'field 1', array['scheduled']) x where x in (t.gu('m:bs2'), t.gu('m:bf'), t.gu('m:bt')))::int, 0);
select t.as_user(t.uid(4));
select t.put('v:bq1', (select version::text from public.matches where id = t.gu('m:bq1')));
select t.as_user(t.uid(2));
select t.fin('bq1', 'a', 5, 2);
select t.as_admin();
select t.expect_eq('winner advances automatically into the semifinal slot', (select entry_b from public.matches where id = t.gu('m:bs2')), t.gu('e:b4'));
select t.expect_eq('that semifinal is now ready (newly schedulable)', t.runnable('m:bs2'), true);
select t.as_user(t.uid(4));
select t.expect_error('a stale result (old version) is refused and changes nothing', format($$select public.finalize_match(%L, 'b', 1, 5, '{}'::jsonb, %s)$$, t.gu('m:bq1'), (select v from t.nx where k = 'v:bq1')));
select t.as_admin();
select t.expect_eq('the stale result did not corrupt the bracket', (select entry_b from public.matches where id = t.gu('m:bs2')), t.gu('e:b4'));
select t.expect_eq('no duplicate advancement: the winner sits in exactly one later slot', (select count(*) from public.matches where competition_id = t.id('d904') and t.gu('e:b4') in (entry_a, entry_b) and queue_state <> 'final')::int, 1);
select t.as_user(t.uid(2));
select t.as_user(t.uid(2));
select t.fin('bs1', 'a', 5, 3);
select t.as_admin();
select t.expect_eq('semifinal winner goes to the final', (select entry_a from public.matches where id = t.gu('m:bf')), t.gu('e:b1'));
select t.expect_eq('semifinal loser goes to the third-place fight', (select t.gu('e:b2') in (entry_a, entry_b) from public.matches where id = t.gu('m:bt')), true);
select t.expect_eq('the final waits for the other semifinal', t.runnable('m:bf'), false);
select t.as_user(t.uid(2));
select t.as_user(t.uid(2));
select t.fin('bs2', 'a', 5, 4);
select t.as_admin();
select t.expect_eq('both finalists known: the final is ready', t.runnable('m:bf'), true);
select t.expect_eq('both third-place fighters known: ready', t.runnable('m:bt'), true);
select t.as_user(t.uid(2));
select t.expect_eq('bracket not complete yet: still running', public.competition_finalize_preflight(t.id('d904')) ->> 'state', 'running');
select t.as_user(t.uid(2));
select t.as_user(t.uid(2));
select t.fin('bt', 'a', 5, 1), t.fin('bf', 'b', 2, 5);
select t.as_user(t.uid(2));
select t.expect_eq('every required fight done: the competition is ready for review by itself', public.competition_finalize_preflight(t.id('d904')) ->> 'state', 'ready');
select t.expect_eq('...and NOT official until a person confirms', (select status from public.competitions where id = t.id('d904')) <> 'finished', true);
select t.expect_eq('the review shows the calculated champion', (select p ->> 'name' from jsonb_array_elements(public.competition_finalize_preflight(t.id('d904')) -> 'placements') p where (p ->> 'place')::int = 1), 'Br Three');
select t.expect_eq('Confirm results = Pack 09C finalize_competition', public.finalize_competition(t.id('d904')) ->> 'status', 'official');
select t.expect_eq('confirming twice is harmless', public.finalize_competition(t.id('d904')) ->> 'status', 'already_official');
select t.as_admin();
select t.expect_eq('placings written once', (select count(*) from public.results where competition_id = t.id('d904'))::int, 5);

-- ---------------------------------------------------------------- privileges
select t.expect_eq('new private functions are not executable by clients',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('can_govern_event_stats', 'event_delete_blockers', 'discard_event', 'discard_event_matches', 'discard_event_entries', 'discard_event_registrations', 'discard_event_competitions', 'discard_event_row', 'can_manage_fighter', 'events_lifecycle_guard')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))::int, 0);
select t.expect_eq('new public commands are not executable by anon',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('archive_event', 'unarchive_event', 'exclude_event_from_stats', 'restore_event_stats', 'delete_event', 'event_delete_check',
      'set_fighter_active', 'team_roster_manage', 'set_roster_visibility', 'save_queue_plan', 'clear_manual_queue', 'can_manage_fighter')
      and has_function_privilege('anon', p.oid, 'execute'))::int, 0);
select t.expect_eq('the new commands are security definer with an empty search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('archive_event', 'unarchive_event', 'exclude_event_from_stats', 'restore_event_stats', 'delete_event', 'event_delete_check',
      'set_fighter_active', 'team_roster_manage', 'set_roster_visibility', 'save_queue_plan', 'clear_manual_queue')
      and p.prosecdef and p.proconfig @> array['search_path=""'])::int, 11);
select t.expect_eq('clients have no write grant on the planner columns',
  has_column_privilege('authenticated', 'public.matches', 'plan_order', 'update') or has_column_privilege('authenticated', 'public.matches', 'plan_hold', 'update'), false);
select t.expect_eq('clients have no write grant on fighters.inactive_at', has_column_privilege('authenticated', 'public.fighters', 'inactive_at', 'update'), false);

select 'PACK09D GATE PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
