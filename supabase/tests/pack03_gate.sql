-- Pack 03 gate: idempotent finalization command, stale/conflicting proposals kept as evidence, head-marshal resolution, paper recovery.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack03_gate.sql
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

-- a1 owner; a2 organizer E1; a3 head marshal E1; a4 scorekeeper E1 (device A); a5 scorekeeper E1 (device B); a6 scorekeeper of E2; a7 stranger
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.events (id, slug, name, status, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000e101', 'e1', 'Event One', 'published', current_date, current_date + 1),
  ('00000000-0000-0000-0000-00000000e102', 'e2', 'Event Two', 'published', current_date, current_date + 1);
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a3', 'head_marshal'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a5', 'scorekeeper'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-0000000000a6', 'scorekeeper');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid, 'team-' || n, 'Team ' || n, 'approved', 'Red Deer', 'CA' from generate_series(1, 4) n;
insert into public.competitions (id, event_id, name, category, gender, tier, structure) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000e101', 'Round Robin One', '5v5', 'men', 'Classic', 'round_robin');
insert into public.entries (id, competition_id, team_id) select ('00000000-0000-0000-0000-00000000e1' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b101', ('00000000-0000-0000-0000-00000000c1' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 4) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 1', 1, '00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-00000000e104'),
  ('00000000-0000-0000-0000-0000000f0003', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 0, '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e103'),
  ('00000000-0000-0000-0000-0000000f0004', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 2', 1, '00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000e104'),
  ('00000000-0000-0000-0000-0000000f0005', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 3', 0, '00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e104'),
  ('00000000-0000-0000-0000-0000000f0006', '00000000-0000-0000-0000-00000000b101', 'round_robin', 'Round 3', 1, '00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000e103');
create function t.m(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000f000' || n)::uuid $$;
create function t.cmd(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000ca' || lpad(n::text, 2, '0'))::uuid $$;
create function t.ver(n int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(n) $$;
grant execute on function t.m(int), t.cmd(int), t.ver(int) to anon, authenticated;

-- ================================================================ roles
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('an organizer can name a head marshal', $q$select public.grant_event_role_by_email('00000000-0000-0000-0000-00000000e101', 'u7@example.test', 'head_marshal')$q$);
select t.as_admin();
delete from public.event_staff where user_id = '00000000-0000-0000-0000-0000000000a7';
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('the head marshal can score', private.can_score('00000000-0000-0000-0000-00000000e101'), true);
select t.expect_eq('the head marshal can resolve results', private.can_resolve_results('00000000-0000-0000-0000-00000000e101'), true);
select t.expect_error('the head marshal is not an organizer: cannot reopen a match through the organizer door', format($q$select public.reopen_match(%L, 'trying it')$q$, t.m(1)), '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a scorekeeper cannot resolve results', private.can_resolve_results('00000000-0000-0000-0000-00000000e101'), false);

-- ================================================================ idempotent finalization
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('device A finalizes match 1', public.submit_match_result(t.cmd(1), t.m(1), 'a', 5, 3, '{}'::jsonb, t.ver(1), 1) ->> 'status', 'accepted');
select t.expect_eq('the same command again is a repeat, not a second result', public.submit_match_result(t.cmd(1), t.m(1), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'status', 'accepted');
select t.expect_eq('... flagged as repeat', (public.submit_match_result(t.cmd(1), t.m(1), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'repeat')::boolean, true);
select t.as_admin();
select t.expect_eq('match 1 is final once, with one proposal row', (select queue_state || '/' || (select count(*) from public.result_proposals where match_id = t.m(1)) from public.matches where id = t.m(1)), 'final/1');
select t.expect_eq('only one finalize audit entry', (select count(*) from public.audit_log where action = 'match.finalized' and subject = t.m(1)::text), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_error('another user cannot reuse someone else''s command id', $q$select public.submit_match_result(t.cmd(1), t.m(1), 'a', 5, 3, '{}'::jsonb, 0, 1)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.expect_error('a stranger cannot submit a result', $q$select public.submit_match_result(t.cmd(90), t.m(2), 'a', 5, 3, '{}'::jsonb, 0, 1)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_error('a scorekeeper of another event cannot submit a result', $q$select public.submit_match_result(t.cmd(91), t.m(2), 'a', 5, 3, '{}'::jsonb, 0, 1)$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('an unknown command schema is refused clearly', $q$select public.submit_match_result(t.cmd(92), t.m(2), 'a', 5, 3, '{}'::jsonb, 0, 99)$q$, '22023');
select t.expect_error('a missing version is refused', $q$select public.submit_match_result(t.cmd(93), t.m(2), 'a', 5, 3, '{}'::jsonb, null, 1)$q$, '22023');
select t.expect_error('a winner with the lower score is refused and recorded nowhere', $q$select public.submit_match_result(t.cmd(94), t.m(2), 'a', 1, 3, '{}'::jsonb, 0, 1)$q$, '22023');
select t.as_admin();
select t.expect_eq('the refused commands left no proposal rows', (select count(*) from public.result_proposals where match_id = t.m(2)), 0::bigint);

-- ================================================================ stale participant/version
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('the organizer replaces an entrant of match 2 after device A opened it', $q$update public.matches set entry_b = '00000000-0000-0000-0000-00000000e102' where id = t.m(2) $q$);
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('a stale command is refused safely (status stale, not applied)', public.submit_match_result(t.cmd(2), t.m(2), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'status', 'stale');
select t.as_admin();
select t.expect_eq('match 2 is untouched', (select queue_state from public.matches where id = t.m(2)), 'scheduled');
select t.expect_eq('the stale proposal is kept as evidence', (select status from public.result_proposals where id = t.cmd(2)), 'stale');

-- ================================================================ two devices disagree
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('device B sends the SAME result: no conflict', public.submit_match_result(t.cmd(3), t.m(1), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'status', 'duplicate');
select t.expect_eq('device B sends a DIFFERENT result: kept as a conflict, never applied', public.submit_match_result(t.cmd(4), t.m(1), 'b', 3, 5, '{"sheet":"B"}'::jsonb, 0, 1) ->> 'status', 'conflict');
select t.as_admin();
select t.expect_eq('the official result is still device A''s (no last-write-wins)', (select result || ' ' || score_a || '-' || score_b from public.matches where id = t.m(1)), 'a 5-3');
select t.expect_eq('device B''s evidence is preserved with the official result it lost to', (select (official_before ->> 'result') || '/' || result || '/' || (detail ->> 'sheet') from public.result_proposals where id = t.cmd(4)), 'a/b/B');
select t.expect_eq('the conflict was audited', (select count(*) from public.audit_log where action = 'result.conflict' and subject = t.m(1)::text), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_error('a scorekeeper cannot list conflicts', $q$select * from public.list_result_conflicts('00000000-0000-0000-0000-00000000e101')$q$, '42501');
select t.expect_error('a scorekeeper cannot resolve a conflict', $q$select public.resolve_result_conflict(t.cmd(4), 'use_proposal', 'my result is right')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select t.expect_error('another event''s scorekeeper cannot list them either', $q$select * from public.list_result_conflicts('00000000-0000-0000-0000-00000000e101')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('the head marshal sees exactly one open conflict with both results', (select official_result || official_score_a || official_score_b || '|' || proposed_result || proposed_score_a || proposed_score_b || '|' || side_a || ' vs ' || side_b from public.list_result_conflicts('00000000-0000-0000-0000-00000000e101')), 'a53|b35|Team 1 vs Team 2');
select t.expect_error('resolution needs a note', $q$select public.resolve_result_conflict(t.cmd(4), 'use_proposal', '')$q$, '22023');
select t.expect_error('resolution must be one of the two decisions', $q$select public.resolve_result_conflict(t.cmd(4), 'flip a coin', 'because')$q$, '22023');
select t.expect_ok('the head marshal decides device B was right', $q$select public.resolve_result_conflict(t.cmd(4), 'use_proposal', 'confirmed with the paper sheet: B is correct')$q$);
select t.as_admin();
select t.expect_eq('one official result now: the chosen one', (select result || ' ' || score_a || '-' || score_b || ' ' || queue_state from public.matches where id = t.m(1)), 'b 3-5 final');
select t.expect_eq('the conflict evidence survives, marked resolved', (select status || '/' || resolution_note from public.result_proposals where id = t.cmd(4)), 'resolved_replaced/confirmed with the paper sheet: B is correct');
select t.expect_eq('device A''s original proposal is still on record', (select status from public.result_proposals where id = t.cmd(1)), 'accepted');
select t.expect_eq('the resolution was audited with both results', (select count(*) from public.audit_log where action = 'result.conflict_resolved' and details -> 'official_before' ->> 'result' = 'a' and details -> 'proposal_result' ->> 'result' = 'b'), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('no conflicts remain open', (select count(*) from public.list_result_conflicts('00000000-0000-0000-0000-00000000e101')), 0::bigint);
select t.expect_error('a resolved conflict cannot be resolved twice', $q$select public.resolve_result_conflict(t.cmd(4), 'keep_official', 'again')$q$, 'P0001');
-- keep_official on another match
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('A finalizes match 3', public.submit_match_result(t.cmd(5), t.m(3), 'a', 5, 1, '{}'::jsonb, t.ver(3), 1) ->> 'status', 'accepted');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
select t.expect_eq('B disagrees on match 3', public.submit_match_result(t.cmd(6), t.m(3), 'b', 1, 5, '{}'::jsonb, 0, 1) ->> 'status', 'conflict');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_ok('an organizer can also resolve: keep the official result', $q$select public.resolve_result_conflict(t.cmd(6), 'keep_official', 'device B had the sides the wrong way round')$q$);
select t.as_admin();
select t.expect_eq('match 3 keeps the original official result', (select result || ' ' || score_a || '-' || score_b from public.matches where id = t.m(3)), 'a 5-1');
select t.expect_eq('the losing proposal is kept, marked resolved_kept', (select status from public.result_proposals where id = t.cmd(6)), 'resolved_kept');

-- ================================================================ paper recovery
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_error('a scorekeeper cannot enter an official result from paper', $q$select public.enter_official_result(t.m(4), 'a', 5, 2, '{}'::jsonb, 'paper sheet 12')$q$, '42501');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_error('a note naming the paper source is required', $q$select public.enter_official_result(t.m(4), 'a', 5, 2, '{}'::jsonb, '')$q$, '22023');
select t.expect_error('the same validation applies as for any result', $q$select public.enter_official_result(t.m(4), 'a', 1, 2, '{}'::jsonb, 'paper sheet 12')$q$, '22023');
select t.expect_eq('the head marshal enters a result from the paper sheet', public.enter_official_result(t.m(4), 'a', 5, 2, '{}'::jsonb, 'paper sheet 12') ->> 'status', 'entered');
select t.as_admin();
select t.expect_eq('match 4 is final and the version moved', (select queue_state from public.matches where id = t.m(4)), 'final');
select t.expect_eq('the paper entry is recorded with its source note and actor', (select source || '/' || note || '/' || proposed_by::text from public.result_proposals where match_id = t.m(4)), 'paper/paper sheet 12/00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('... and audited', (select count(*) from public.audit_log where action = 'result.paper_entered' and subject = t.m(4)::text), 1::bigint);
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('entering the same result again changes nothing', public.enter_official_result(t.m(4), 'a', 5, 2, '{}'::jsonb, 'paper sheet 12') ->> 'status', 'unchanged');
select t.expect_eq('a correction from paper replaces the official result', public.enter_official_result(t.m(4), 'b', 2, 5, '{}'::jsonb, 'paper sheet 12 re-read by the head marshal') ->> 'status', 'corrected');
select t.as_admin();
select t.expect_eq('the new official result stands', (select result from public.matches where id = t.m(4)), 'b');
select t.expect_eq('the replaced value is kept in the audit trail', (select details -> 'replaced' ->> 'result' from public.audit_log where action = 'result.paper_entered' and details ->> 'result' = 'b' and subject = t.m(4)::text), 'a');
select t.expect_eq('both reopen and re-finalize were audited by the normal path', (select count(*) from public.audit_log where action in ('match.reopened', 'match.finalized') and subject = t.m(4)::text), 3::bigint);
-- paper entry into a competition that was already finished supersedes its results (Pack 02), never deletes them silently
select t.as_user('00000000-0000-0000-0000-0000000000a4');
select t.expect_eq('A finalizes the remaining matches (5 and 6) so the competition can finish', public.submit_match_result(t.cmd(7), t.m(5), 'a', 5, 1, '{}'::jsonb, t.ver(5), 1) ->> 'status', 'accepted');
select t.expect_eq('... 6', public.submit_match_result(t.cmd(8), t.m(6), 'a', 5, 1, '{}'::jsonb, t.ver(6), 1) ->> 'status', 'accepted');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('the head marshal enters match 2 from paper too', public.enter_official_result(t.m(2), 'a', 5, 3, '{}'::jsonb, 'paper sheet 13') ->> 'status', 'entered');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.expect_eq('the organizer finishes the competition', public.finish_competition('00000000-0000-0000-0000-00000000b101'), 4);
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.expect_eq('a paper correction after the competition finished succeeds', public.enter_official_result(t.m(5), 'b', 1, 5, '{}'::jsonb, 'paper sheet 5 was read wrongly') ->> 'status', 'corrected');
select t.as_admin();
select t.expect_eq('the competition is running again and current results are cleared', (select status || '/' || (select count(*) from public.results where competition_id = '00000000-0000-0000-0000-00000000b101') from public.competitions where id = '00000000-0000-0000-0000-00000000b101'), 'running/0');
select t.expect_eq('the earlier official places are kept in the revision log with the paper reason', (select count(*) from public.result_revisions where competition_id = '00000000-0000-0000-0000-00000000b101' and action = 'superseded' and reason like 'corrected from paper:%'), 4::bigint);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
