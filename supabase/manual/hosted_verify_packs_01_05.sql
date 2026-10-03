-- BuhurtOS hosted verification for Packs 01-05 (branch ccr-a435c5f7-pmrfxr).
--
-- WHAT IT DOES
--   Runs behavioural and permission checks against the live schema as anon, a fighter, a captain, scorekeepers, a head marshal,
--   event organizers, an organization administrator and a platform owner, and returns one row per check: pack | check | result | detail.
--
-- WHY IT LEAVES NOTHING BEHIND
--   Every fixture (fictional accounts *@verify.invalid, events/teams with slugs starting "zz-verify-", ids derived from md5('bos-verify:...'))
--   is created inside a plpgsql sub-transaction that is ALWAYS rolled back at the end (the block raises SQLSTATE ZZ999 on purpose and catches it).
--   Only the collected TRUE/FALSE rows survive, in a local variable. Known, harmless side effects of a rolled-back transaction: sequence values
--   (audit_log_id_seq) are consumed, so audit ids get a gap. Realtime and pg_notify only publish committed changes, so nothing is broadcast.
--   The helper function lives in pg_temp and disappears with the session.
--
-- HOW TO RUN
--   Supabase SQL Editor (role postgres): paste and run this file. The last statement returns the result table.
--   It contains no DROP/DELETE/TRUNCATE statements; result removal is exercised through the official RPCs only.
--   A FALSE row is a failure to investigate. A single row "harness | ran to the end | false" means a fixture could not be created; its detail
--   names the statement.

create or replace function pg_temp.bos_verify_packs_01_05()
returns table(pack text, check_name text, result boolean, detail text)
language plpgsql as $V$
#variable_conflict use_column
declare
  v_rows jsonb := '[]'::jsonb;
  v_msg text; v_ctx text;
begin
  begin
    -- ------------------------------------------------------------------------------------------------ helpers (rolled back with everything else)
    create schema zzv;
    create table zzv.log (n serial primary key, pack text, check_name text, ok boolean, detail text);
    create table zzv.kv (k text primary key, v text);
    create function zzv.id(k text) returns uuid language sql immutable as $h$ select md5('bos-verify:' || k)::uuid $h$;
    create function zzv.pack(p text) returns text language sql as $h$ select set_config('zzv.pack', p, true) $h$;
    create function zzv.as_admin() returns void language plpgsql as $h$
    begin reset role; perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true); end $h$;
    create function zzv.as_anon() returns void language plpgsql as $h$
    begin reset role; perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon; end $h$;
    create function zzv.as_user(u text) returns void language plpgsql as $h$
    begin
      reset role;
      perform set_config('request.jwt.claim.sub', zzv.id(u)::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', zzv.id(u), 'role', 'authenticated')::text, true);
      set local role authenticated;
    end $h$;
    create function zzv.rec(p_ok boolean, p_label text, p_detail text) returns void language sql as $h$
      insert into zzv.log (pack, check_name, ok, detail) values (current_setting('zzv.pack', true), p_label, coalesce(p_ok, false), p_detail)
    $h$;
    -- q: run a query, compare its single value (as text) with the expected text. An error is a FALSE row, never an abort.
    create function zzv.q(p_label text, p_sql text, p_want text) returns void language plpgsql as $h$
    declare v text;
    begin
      begin execute 'select (' || p_sql || ')::text' into v;
      exception when others then perform zzv.rec(false, p_label, 'error ' || sqlstate || ': ' || sqlerrm); return; end;
      perform zzv.rec(v is not distinct from p_want, p_label, 'got ' || coalesce(v, 'null') || case when v is distinct from p_want then ', expected ' || coalesce(p_want, 'null') else '' end);
    end $h$;
    -- err: the statement must fail, with the given SQLSTATE when one is given.
    create function zzv.err(p_label text, p_sql text, p_state text) returns void language plpgsql as $h$
    begin
      begin execute p_sql;
      exception when others then
        perform zzv.rec(p_state is null or sqlstate = p_state, p_label, 'refused ' || sqlstate || ': ' || left(sqlerrm, 160)); return;
      end;
      perform zzv.rec(false, p_label, 'NOT refused: the statement succeeded');
    end $h$;
    -- ok: the statement must succeed.
    create function zzv.ok(p_label text, p_sql text) returns void language plpgsql as $h$
    begin
      begin execute p_sql;
      exception when others then perform zzv.rec(false, p_label, 'error ' || sqlstate || ': ' || left(sqlerrm, 160)); return; end;
      perform zzv.rec(true, p_label, 'allowed');
    end $h$;
    create function zzv.ver(k text) returns integer language sql stable security definer set search_path = '' as $h$ select version from public.matches where id = zzv.id(k) $h$;
    grant usage on schema zzv to anon, authenticated;
    grant execute on all functions in schema zzv to anon, authenticated;
    grant all on zzv.log, zzv.kv to anon, authenticated;
    grant usage on all sequences in schema zzv to anon, authenticated;

    -- ------------------------------------------------------------------------------------------------ fictional fixtures
    perform zzv.as_admin();
    insert into auth.users (id, email)
    select zzv.id(u), u || '@verify.invalid'
    from unnest(array['owner', 'org1', 'hm1', 'sk1', 'sk2', 'org2', 'sk3', 'cap1', 'fighter1', 'oadmA', 'skold', 'orgold', 'stranger', 'reg1', 'newstaff']) u;
    insert into public.platform_roles (user_id, role) values (zzv.id('owner'), 'owner');
    insert into public.organizations (id, slug, name, kind) values
      (zzv.id('orgA'), 'zz-verify-org-a', 'ZZ Verify Org A', 'regional'), (zzv.id('orgB'), 'zz-verify-org-b', 'ZZ Verify Org B', 'regional');
    insert into public.organization_staff (organization_id, user_id, role) values (zzv.id('orgA'), zzv.id('oadmA'), 'admin');
    insert into public.teams (id, slug, name, status, city, country) values
      (zzv.id('T1'), 'zz-verify-t1', 'ZZ Verify T1', 'approved', 'Red Deer', 'CA'),
      (zzv.id('T2'), 'zz-verify-t2', 'ZZ Verify T2', 'approved', 'Red Deer', 'CA'),
      (zzv.id('T3'), 'zz-verify-t3', 'ZZ Verify T3', 'approved', 'Red Deer', 'CA'),
      (zzv.id('T4'), 'zz-verify-t4', 'ZZ Verify T4', 'approved', 'Red Deer', 'CA'),
      (zzv.id('T5'), 'zz-verify-t5', 'ZZ Verify T5 pending A', 'pending', 'Red Deer', 'CA'),
      (zzv.id('T7'), 'zz-verify-t7', 'ZZ Verify T7 pending B', 'pending', 'Red Deer', 'CA');
    insert into public.team_affiliations (team_id, organization_id, relation) values (zzv.id('T5'), zzv.id('orgA'), 'member'), (zzv.id('T7'), zzv.id('orgB'), 'member');
    insert into public.team_roles (team_id, user_id, role) values (zzv.id('T1'), zzv.id('cap1'), 'captain');
    insert into public.fighters (id, display_name, team_id) values (zzv.id('F1'), 'ZZ Verify Fighter One', zzv.id('T1')), (zzv.id('Fhist'), 'ZZ Verify Samename', null);
    insert into public.fighter_accounts (fighter_id, user_id) values (zzv.id('F1'), zzv.id('fighter1'));
    insert into public.events (id, slug, name, status, starts_on, ends_on) values
      (zzv.id('E1'), 'zz-verify-e1', 'ZZ Verify E1', 'published', current_date, current_date + 1),
      (zzv.id('E2'), 'zz-verify-e2', 'ZZ Verify E2', 'published', current_date, current_date + 1),
      (zzv.id('E3'), 'zz-verify-e3', 'ZZ Verify E3 ended 20 days ago', 'published', current_date - 21, current_date - 20),
      (zzv.id('E4'), 'zz-verify-e4', 'ZZ Verify E4 ended 5 days ago', 'published', current_date - 6, current_date - 5);
    insert into public.event_staff (event_id, user_id, role) values
      (zzv.id('E1'), zzv.id('org1'), 'organizer'), (zzv.id('E1'), zzv.id('hm1'), 'head_marshal'),
      (zzv.id('E1'), zzv.id('sk1'), 'scorekeeper'), (zzv.id('E1'), zzv.id('sk2'), 'scorekeeper'),
      (zzv.id('E2'), zzv.id('org2'), 'organizer'), (zzv.id('E2'), zzv.id('sk3'), 'scorekeeper'),
      (zzv.id('E3'), zzv.id('skold'), 'scorekeeper'), (zzv.id('E3'), zzv.id('orgold'), 'organizer'), (zzv.id('E4'), zzv.id('orgold'), 'organizer');
    insert into public.waiver_versions (id, event_id, version, title, body) values
      (zzv.id('W1'), zzv.id('E1'), 1, 'Waiver', 'ZZ verify waiver text.'), (zzv.id('W2'), zzv.id('E2'), 1, 'Waiver', 'ZZ verify waiver text.');
    insert into public.competitions (id, event_id, name, category, gender, structure) values
      (zzv.id('C1'), zzv.id('E1'), 'ZZ RR', '5v5', 'men', 'round_robin'),
      (zzv.id('C2'), zzv.id('E1'), 'ZZ Bracket', '5v5', 'men', 'elimination'),
      (zzv.id('C3'), zzv.id('E2'), 'ZZ Other Event', '5v5', 'men', 'round_robin'),
      (zzv.id('C4'), zzv.id('E3'), 'ZZ Old Event', '5v5', 'men', 'round_robin');
    insert into public.entries (id, competition_id, team_id)
    select zzv.id(c || 'e' || n), zzv.id(c), zzv.id('T' || n)
    from (values ('C1', 1), ('C1', 2), ('C1', 3), ('C1', 4), ('C2', 1), ('C2', 2), ('C3', 1), ('C3', 2), ('C4', 3), ('C4', 4)) x(c, n);
    -- C1: T1 beats everyone; T2>T3, T3>T4, T4>T2, all 5-3, so T2/T3/T4 are level on wins, difference, head-to-head and points scored.
    insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
      (zzv.id('m1'), zzv.id('C1'), 'round_robin', 'Round 1', 0, zzv.id('C1e1'), zzv.id('C1e2')),
      (zzv.id('m2'), zzv.id('C1'), 'round_robin', 'Round 1', 1, zzv.id('C1e3'), zzv.id('C1e4')),
      (zzv.id('m3'), zzv.id('C1'), 'round_robin', 'Round 2', 0, zzv.id('C1e1'), zzv.id('C1e3')),
      (zzv.id('m4'), zzv.id('C1'), 'round_robin', 'Round 2', 1, zzv.id('C1e2'), zzv.id('C1e4')),
      (zzv.id('m5'), zzv.id('C1'), 'round_robin', 'Round 3', 0, zzv.id('C1e1'), zzv.id('C1e4')),
      (zzv.id('m6'), zzv.id('C1'), 'round_robin', 'Round 3', 1, zzv.id('C1e2'), zzv.id('C1e3')),
      (zzv.id('m31'), zzv.id('C3'), 'round_robin', 'Round 1', 0, zzv.id('C3e1'), zzv.id('C3e2')),
      (zzv.id('m41'), zzv.id('C4'), 'round_robin', 'Round 1', 0, zzv.id('C4e3'), zzv.id('C4e4'));
    -- synthetic vs real history
    insert into public.sources (id, kind, title, citation, synthetic) values (zzv.id('Ssyn'), 'submitted', 'ZZ verify fictional dataset', 'verify', true);
    insert into public.events (id, slug, name, status, event_type, starts_on, ends_on) values
      (zzv.id('ES'), 'zz-verify-synthetic', 'ZZ Verify Synthetic', 'published', 'tournament', current_date - 41, current_date - 40),
      (zzv.id('ER'), 'zz-verify-real', 'ZZ Verify Real', 'published', 'tournament', current_date - 41, current_date - 40);
    insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (zzv.id('Ssyn'), 'event', zzv.id('ES'), 'unverified', 'fictional');
    insert into public.competitions (id, event_id, name, category, gender, structure) values
      (zzv.id('CS'), zzv.id('ES'), 'ZZ Synthetic 5v5', '5v5', 'men', 'round_robin'), (zzv.id('CR'), zzv.id('ER'), 'ZZ Real 5v5', '5v5', 'men', 'round_robin');
    insert into public.entries (id, competition_id, team_id) values (zzv.id('CSe1'), zzv.id('CS'), zzv.id('T1')), (zzv.id('CRe2'), zzv.id('CR'), zzv.id('T2'));
    insert into public.results (competition_id, entry_id, final_place, points) values (zzv.id('CS'), zzv.id('CSe1'), 1, 50), (zzv.id('CR'), zzv.id('CRe2'), 1, 7);

    -- ================================================================================================ Schema identity
    perform zzv.pack('Schema');
    perform zzv.q('normalized schema fingerprint equals branch fd746d4 (1037 objects)', $s$(
      select count(*) || '|' || md5(string_agg(line, E'\n' order by line collate "C")) from (select regexp_replace(line, '\s+', ' ', 'g') as line from (
        select 'table ' || c.relnamespace::regnamespace || '.' || c.relname || ' rls=' || c.relrowsecurity as line
          from pg_class c where c.relkind = 'r' and c.relnamespace::regnamespace::text in ('public', 'private')
        union all
        select 'column ' || c.relnamespace::regnamespace || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
          from pg_attribute a join pg_class c on c.oid = a.attrelid
          where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and c.relnamespace::regnamespace::text in ('public', 'private')
        union all
        select 'constraint ' || c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
          from pg_constraint c where c.connamespace::regnamespace::text in ('public', 'private')
        union all
        select 'index ' || i.schemaname || '.' || i.tablename || ' ' || regexp_replace(i.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ', 'CREATE \1INDEX ')
          from pg_indexes i where i.schemaname in ('public', 'private')
        union all
        select 'policy ' || p.schemaname || '.' || p.tablename || ' ' || p.policyname || ' ' || p.cmd || ' roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
          from pg_policies p where p.schemaname in ('public', 'private')
        union all
        select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
        union all
        select 'view ' || c.relnamespace::regnamespace || '.' || c.relname || ' opts=' || coalesce(array_to_string(c.reloptions, ','), '') || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_viewdef(c.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
          from pg_class c where c.relkind in ('v', 'm') and c.relnamespace::regnamespace::text in ('public', 'private')
        union all
        select 'trigger ' || c.relnamespace::regnamespace || '.' || c.relname || ' ' || t.tgname || ' ' || md5(btrim(regexp_replace(regexp_replace(pg_get_triggerdef(t.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
          from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace::regnamespace::text in ('public', 'private')
      ) x) y)$s$, '1037|43986d8c12e7a5bbab04485e924e9a69');
    perform zzv.q('anon/authenticated privileges equal branch fd746d4', $s$(
      with o as (
        select 'f ' || p.oid::regprocedure::text as k, has_function_privilege('anon', p.oid, 'execute')::int::text || has_function_privilege('authenticated', p.oid, 'execute')::int::text as v
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
        union all
        select 't ' || c.oid::regclass::text, (select string_agg(has_table_privilege(r, c.oid, pr)::int::text, '' order by r, pr) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) pr)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm')
        union all select 's private', has_schema_privilege('anon', 'private', 'usage')::int::text || has_schema_privilege('authenticated', 'private', 'usage')::int::text
      ) select count(*) || '|' || md5(string_agg(k || '=' || v, ',' order by k collate "C")) from o)$s$, '205|b5e6b055d964385036f10a98f3910e16');

    -- ================================================================================================ Pack 01
    perform zzv.pack('Pack 01');
    perform zzv.q('obsolete helper private.is_any_organizer() no longer exists', $s$exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'is_any_organizer')$s$, 'false');
    perform zzv.q('no function or policy still refers to is_any_organizer', $s$(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%is_any_organizer%') + (select count(*) from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ilike '%is_any_organizer%')$s$, '0');
    perform zzv.q('team authority function private.can_admin_team exists', $s$to_regprocedure('private.can_admin_team(uuid)') is not null$s$, 'true');
    perform zzv.as_user('org1');
    perform zzv.err('event organizer cannot approve a team', $s$select public.approve_team(zzv.id('T5'))$s$, '42501');
    perform zzv.err('event organizer cannot merge teams', $s$select public.merge_teams(zzv.id('T1'), zzv.id('T2'))$s$, '42501');
    perform zzv.q('event organizer cannot edit a team', $s$public.can_edit_team(zzv.id('T1'))$s$, 'false');
    perform zzv.as_user('oadmA');
    perform zzv.ok('organization admin approves a pending team of their organization', $s$select public.approve_team(zzv.id('T5'))$s$);
    perform zzv.err('organization admin cannot approve another organization''s team', $s$select public.approve_team(zzv.id('T7'))$s$, '42501');
    perform zzv.as_user('owner');
    perform zzv.ok('platform owner approves any team', $s$select public.approve_team(zzv.id('T7'))$s$);
    perform zzv.as_user('cap1');
    perform zzv.q('captain can edit their own team', $s$public.can_edit_team(zzv.id('T1'))$s$, 'true');
    perform zzv.q('captain cannot edit another team', $s$public.can_edit_team(zzv.id('T2'))$s$, 'false');
    perform zzv.err('captain cannot change another team''s profile', $s$select public.update_team_profile(zzv.id('T2'), '{"description":"zz verify hijack"}'::jsonb)$s$, '42501');
    perform zzv.err('captain cannot approve teams', $s$select public.approve_team(zzv.id('T5'))$s$, '42501');
    perform zzv.as_user('fighter1');
    perform zzv.q('a plain fighter cannot edit a team', $s$public.can_edit_team(zzv.id('T1'))$s$, 'false');
    perform zzv.err('a plain fighter cannot grant event roles', $s$select public.grant_event_role_by_email(zzv.id('E1'), 'newstaff@verify.invalid', 'scorekeeper')$s$, '42501');
    perform zzv.as_anon();
    perform zzv.err('anon cannot approve teams', $s$select public.approve_team(zzv.id('T5'))$s$, null);
    perform zzv.as_user('skold');
    perform zzv.q('scorekeeper of an event that ended 20 days ago has lost scoring authority', $s$private.can_score(zzv.id('E3'))$s$, 'false');
    perform zzv.err('... and cannot submit a result there', $s$select public.submit_match_result(zzv.id('cmd-old'), zzv.id('m41'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m41'), 1)$s$, '42501');
    perform zzv.as_user('orgold');
    perform zzv.q('organizer keeps authority within the 7-day grace window (E4 ended 5 days ago)', $s$private.is_organizer(zzv.id('E4'))$s$, 'true');
    perform zzv.q('organizer of an event that ended 20 days ago has lost authority', $s$private.is_organizer(zzv.id('E3'))$s$, 'false');
    perform zzv.err('expired organizer cannot add staff', $s$select public.grant_event_role_by_email(zzv.id('E3'), 'newstaff@verify.invalid', 'scorekeeper')$s$, '42501');
    perform zzv.as_admin();
    perform zzv.q('expired staff rows are kept for history', $s$(select count(*) from public.event_staff where event_id = zzv.id('E3'))$s$, '2');
    perform zzv.as_user('org1');
    perform zzv.q('organizer of E1 is not an organizer of E2', $s$private.is_organizer(zzv.id('E2'))$s$, 'false');
    perform zzv.err('organizer cannot add staff to another organizer''s event', $s$select public.grant_event_role_by_email(zzv.id('E2'), 'newstaff@verify.invalid', 'scorekeeper')$s$, '42501');
    perform zzv.err('organizer cannot build the schedule of another organizer''s event', $s$select public.build_schedule(zzv.id('C3'), '[]'::jsonb, 'new', null)$s$, '42501');
    perform zzv.err('organizer cannot finish a competition of another organizer''s event', $s$select public.finish_competition(zzv.id('C3'))$s$, '42501');
    perform zzv.as_anon();
    perform zzv.q('synthetic event is excluded from official result rows', $s$(select count(*) from public.result_rows where event_id = zzv.id('ES'))$s$, '0');
    perform zzv.q('real event stays in official result rows', $s$(select count(*) from public.result_rows where event_id = zzv.id('ER'))$s$, '1');
    perform zzv.q('synthetic event is not a played event', $s$(select count(*) from public.played_events where event_id = zzv.id('ES'))$s$, '0');
    perform zzv.q('real event is a played event', $s$(select count(*) from public.played_events where event_id = zzv.id('ER'))$s$, '1');
    perform zzv.q('team history still lists the synthetic result, flagged synthetic', $s$(select synthetic from public.team_history where event_id = zzv.id('ES'))$s$, 'true');
    perform zzv.q('synthetic_records lists the synthetic event', $s$(select count(*) from public.synthetic_records where entity_type = 'event' and entity_id = zzv.id('ES'))$s$, '1');

    -- ================================================================================================ Pack 03 scoring commands (and Pack 02 match versions)
    perform zzv.pack('Pack 02');
    perform zzv.as_admin();
    insert into zzv.kv values ('m2v0', zzv.ver('m2')::text);
    perform zzv.as_user('org1');
    perform zzv.ok('organizer re-seats an entrant of match 2', $s$update public.matches set entry_b = zzv.id('C1e2') where id = zzv.id('m2')$s$);
    perform zzv.ok('... and puts the original entrant back', $s$update public.matches set entry_b = zzv.id('C1e4') where id = zzv.id('m2')$s$);
    perform zzv.q('match version moved by 2 when the sides changed twice', $s$zzv.ver('m2') - (select v::int from zzv.kv where k = 'm2v0')$s$, '2');
    perform zzv.pack('Pack 03');
    perform zzv.as_user('sk1');
    perform zzv.q('a command based on the old version is refused as stale', $s$public.submit_match_result(zzv.id('cmd-stale'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, (select v::int from zzv.kv where k = 'm2v0'), 1) ->> 'status'$s$, 'stale');
    perform zzv.as_admin();
    perform zzv.q('... the stale command changed nothing', $s$(select queue_state from public.matches where id = zzv.id('m2'))$s$, 'scheduled');
    perform zzv.q('... and is kept as evidence', $s$(select status from public.result_proposals where id = zzv.id('cmd-stale'))$s$, 'stale');
    perform zzv.as_user('sk1');
    perform zzv.q('assigned scorekeeper finalizes match 1', $s$public.submit_match_result(zzv.id('cmd1'), zzv.id('m1'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m1'), 1) ->> 'status'$s$, 'accepted');
    perform zzv.q('the same command again is a repeat, not a second result', $s$public.submit_match_result(zzv.id('cmd1'), zzv.id('m1'), 'a', 5, 3, '{}'::jsonb, 0, 1) ->> 'repeat'$s$, 'true');
    perform zzv.as_user('sk2');
    perform zzv.err('a command id cannot be replayed by another user', $s$select public.submit_match_result(zzv.id('cmd1'), zzv.id('m1'), 'a', 5, 3, '{}'::jsonb, 0, 1)$s$, '42501');
    perform zzv.as_user('sk3');
    perform zzv.err('a scorekeeper of another event cannot score here', $s$select public.submit_match_result(zzv.id('cmd-x'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m2'), 1)$s$, '42501');
    perform zzv.as_user('stranger');
    perform zzv.err('a signed-in stranger cannot score', $s$select public.submit_match_result(zzv.id('cmd-y'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m2'), 1)$s$, '42501');
    perform zzv.as_user('cap1');
    perform zzv.err('a captain cannot score', $s$select public.submit_match_result(zzv.id('cmd-z'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m2'), 1)$s$, '42501');
    perform zzv.as_anon();
    perform zzv.err('anon cannot score', $s$select public.submit_match_result(zzv.id('cmd-w'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m2'), 1)$s$, null);
    perform zzv.as_user('sk2');
    perform zzv.q('a second device with a DIFFERENT result is kept as a conflict', $s$public.submit_match_result(zzv.id('cmd2'), zzv.id('m1'), 'b', 3, 5, '{}'::jsonb, 0, 1) ->> 'status'$s$, 'conflict');
    perform zzv.as_admin();
    perform zzv.q('... and the official result is unchanged (no last-write-wins)', $s$(select result || ' ' || score_a || '-' || score_b from public.matches where id = zzv.id('m1'))$s$, 'a 5-3');
    perform zzv.as_user('sk1');
    perform zzv.err('a scorekeeper cannot resolve a conflict', $s$select public.resolve_result_conflict(zzv.id('cmd2'), 'use_proposal', 'zz verify mine')$s$, '42501');
    perform zzv.as_user('org2');
    perform zzv.err('another event''s organizer cannot list the conflicts', $s$select * from public.list_result_conflicts(zzv.id('E1'))$s$, '42501');
    perform zzv.as_user('hm1');
    perform zzv.q('the head marshal sees the open conflict', $s$(select count(*) from public.list_result_conflicts(zzv.id('E1')))$s$, '1');
    perform zzv.ok('the head marshal keeps the official result', $s$select public.resolve_result_conflict(zzv.id('cmd2'), 'keep_official', 'zz verify checked the sheet')$s$);
    perform zzv.err('the head marshal cannot use the organizer-only reopen', $s$select public.reopen_match(zzv.id('m1'), 'zz verify')$s$, '42501');
    perform zzv.as_user('sk1');
    perform zzv.err('a scorekeeper cannot enter an official result from paper', $s$select public.enter_official_result(zzv.id('m3'), 'a', 5, 3, '{}'::jsonb, 'zz verify sheet 3')$s$, '42501');
    perform zzv.as_user('hm1');
    perform zzv.q('the head marshal enters a result from paper', $s$public.enter_official_result(zzv.id('m3'), 'a', 5, 3, '{}'::jsonb, 'zz verify sheet 3') ->> 'status'$s$, 'entered');
    perform zzv.as_user('org1');
    perform zzv.ok('an organizer may name a head marshal (event_staff accepts the role)', $s$select public.grant_event_role_by_email(zzv.id('E1'), 'newstaff@verify.invalid', 'head_marshal')$s$);
    perform zzv.err('an unknown event role is refused', $s$select public.grant_event_role_by_email(zzv.id('E1'), 'newstaff@verify.invalid', 'warlord')$s$, null);
    perform zzv.as_admin();
    perform zzv.q('event_staff role check includes head_marshal', $s$(select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.event_staff'::regclass and conname = 'event_staff_role_check')$s$,
      'CHECK ((role = ANY (ARRAY[''organizer''::text, ''head_marshal''::text, ''marshal''::text, ''scorekeeper''::text, ''medic''::text])))');
    perform zzv.as_user('sk1');
    perform zzv.q('scorekeeper finalizes match 2 at the current version', $s$public.submit_match_result(zzv.id('cmd3'), zzv.id('m2'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m2'), 1) ->> 'status'$s$, 'accepted');
    perform zzv.q('... match 4', $s$public.submit_match_result(zzv.id('cmd4'), zzv.id('m4'), 'b', 3, 5, '{}'::jsonb, zzv.ver('m4'), 1) ->> 'status'$s$, 'accepted');
    perform zzv.q('... match 5', $s$public.submit_match_result(zzv.id('cmd5'), zzv.id('m5'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m5'), 1) ->> 'status'$s$, 'accepted');
    perform zzv.q('... match 6', $s$public.submit_match_result(zzv.id('cmd6'), zzv.id('m6'), 'a', 5, 3, '{}'::jsonb, zzv.ver('m6'), 1) ->> 'status'$s$, 'accepted');

    -- ================================================================================================ Pack 04
    perform zzv.pack('Pack 04');
    perform zzv.q('command window accepts version 1', $s$private.command_schema_ok(1)$s$, 'true');
    perform zzv.q('command window refuses version 0', $s$private.command_schema_ok(0)$s$, 'false');
    perform zzv.q('command window refuses version 2', $s$private.command_schema_ok(2)$s$, 'false');
    perform zzv.err('a command outside the window is refused clearly (22023)', $s$select public.submit_match_result(zzv.id('cmd-v2'), zzv.id('m31'), 'a', 5, 3, '{}'::jsonb, 0, 2)$s$, '22023');
    perform zzv.as_admin();
    perform zzv.q('realtime publication carries exactly the tables the app subscribes to', $s$(select string_agg(schemaname || '.' || tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime')$s$, 'public.entries,public.matches');
    perform zzv.q('anon cannot read result proposals', $s$has_table_privilege('anon', 'public.result_proposals', 'select')$s$, 'false');
    perform zzv.q('anon cannot read result revisions', $s$has_table_privilege('anon', 'public.result_revisions', 'select')$s$, 'false');
    perform zzv.q('anon cannot read pool tie decisions', $s$has_table_privilege('anon', 'public.pool_tie_decisions', 'select')$s$, 'false');
    perform zzv.q('nobody but the owner functions can read fighter identity reviews', $s$has_table_privilege('anon', 'public.fighter_identity_reviews', 'select') or has_table_privilege('authenticated', 'public.fighter_identity_reviews', 'select')$s$, 'false');
    perform zzv.as_user('stranger');
    perform zzv.q('a signed-in stranger sees no one else''s result proposals', $s$(select count(*) from public.result_proposals where event_id = zzv.id('E1'))$s$, '0');

    -- ================================================================================================ Pack 02 tournament integrity
    perform zzv.pack('Pack 02');
    perform zzv.q('draw fields exist on competitions', $s$(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'competitions' and column_name in ('draw_seed', 'draw_mode', 'draw_algorithm', 'drawn_at'))$s$, '4');
    perform zzv.q('tie-clearing trigger exists on matches', $s$exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'matches_clear_tie_decisions')$s$, 'true');
    perform zzv.q('match version trigger exists on matches', $s$exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'matches_bump_version')$s$, 'true');
    perform zzv.as_anon();
    perform zzv.q('pool_standings shows the three-way tie for 2nd', $s$(select count(*) from public.pool_standings(zzv.id('C1')) where tied and rank = 2)$s$, '3');
    perform zzv.as_user('org1');
    perform zzv.err('finishing is refused while a medal tie is undecided', $s$select public.finish_competition(zzv.id('C1'))$s$, 'P0001');
    perform zzv.as_user('sk1');
    perform zzv.err('a scorekeeper cannot decide a tie', $s$select public.record_tie_decision(zzv.id('C1'), '', array[zzv.id('C1e2'), zzv.id('C1e3'), zzv.id('C1e4')], 'zz verify lots')$s$, '42501');
    perform zzv.as_user('org2');
    perform zzv.err('another event''s organizer cannot decide a tie', $s$select public.record_tie_decision(zzv.id('C1'), '', array[zzv.id('C1e2'), zzv.id('C1e3'), zzv.id('C1e4')], 'zz verify lots')$s$, '42501');
    perform zzv.as_user('org1');
    perform zzv.ok('the organizer records the tie order', $s$select public.record_tie_decision(zzv.id('C1'), '', array[zzv.id('C1e2'), zzv.id('C1e3'), zzv.id('C1e4')], 'zz verify drew lots')$s$);
    perform zzv.q('standings are decided, nothing tied', $s$(select count(*) filter (where tied) || '/' || count(*) filter (where decided) from public.pool_standings(zzv.id('C1')))$s$, '0/3');
    perform zzv.as_user('org2');
    perform zzv.err('another event''s organizer cannot finish it', $s$select public.finish_competition(zzv.id('C1'))$s$, '42501');
    perform zzv.as_user('org1');
    perform zzv.q('the organizer finishes the competition', $s$public.finish_competition(zzv.id('C1'))$s$, '4');
    perform zzv.q('places follow the decided order', $s$(select string_agg(t.slug || '=' || r.final_place, ',' order by r.final_place) from public.results r join public.entries e on e.id = r.entry_id join public.teams t on t.id = e.team_id where r.competition_id = zzv.id('C1'))$s$,
      'zz-verify-t1=1,zz-verify-t2=2,zz-verify-t3=3,zz-verify-t4=4');
    perform zzv.q('every official result was logged as computed', $s$(select count(*) from public.result_revisions where competition_id = zzv.id('C1') and action = 'computed')$s$, '4');
    perform zzv.err('organizer cannot rewrite official results directly (update)', $s$update public.results set points = 999 where competition_id = zzv.id('C1')$s$, '42501');
    perform zzv.err('organizer cannot insert official results directly', $s$insert into public.results (competition_id, entry_id, final_place, points) values (zzv.id('C2'), zzv.id('C2e1'), 1, 999)$s$, '42501');
    perform zzv.q('signed-in users hold no insert/update/delete privilege on results', $s$has_table_privilege('authenticated', 'public.results', 'insert') or has_table_privilege('authenticated', 'public.results', 'update') or has_table_privilege('authenticated', 'public.results', 'delete')$s$, 'false');
    perform zzv.q('no write policy remains on results', $s$(select count(*) from pg_policies where schemaname = 'public' and tablename = 'results' and cmd <> 'SELECT')$s$, '0');
    perform zzv.err('organizer cannot write the revision log directly', $s$insert into public.result_revisions (competition_id, entry_id, revision, action) values (zzv.id('C1'), zzv.id('C1e1'), 99, 'corrected')$s$, '42501');
    perform zzv.as_user('sk1');
    perform zzv.q('a scorekeeper cannot read the revision log', $s$(select count(*) from public.result_revisions where competition_id = zzv.id('C1'))$s$, '0');
    perform zzv.err('a scorekeeper cannot correct a result', $s$select public.correct_result(zzv.id('C1'), zzv.id('C1e4'), 4, 1, 'zz verify typo')$s$, '42501');
    perform zzv.err('a scorekeeper cannot void a result', $s$select public.void_result(zzv.id('C1'), zzv.id('C1e4'), 'zz verify')$s$, '42501');
    perform zzv.as_user('org1');
    perform zzv.ok('the organizer corrects a result through correct_result', $s$select public.correct_result(zzv.id('C1'), zzv.id('C1e4'), 4, 1, 'zz verify typo on the sheet')$s$);
    perform zzv.q('the correction is in the revision history with old and new values', $s$(select old_points || '->' || new_points || ' ' || reason from public.result_revisions where competition_id = zzv.id('C1') and entry_id = zzv.id('C1e4') and action = 'corrected')$s$, '0->1 zz verify typo on the sheet');
    perform zzv.err('finishing again after a hand correction is refused', $s$select public.finish_competition(zzv.id('C1'))$s$, 'P0001');
    perform zzv.ok('the organizer voids a result through void_result', $s$select public.void_result(zzv.id('C1'), zzv.id('C1e4'), 'zz verify withdrawn')$s$);
    perform zzv.q('the void is logged and the result left the current record', $s$(select count(*) from public.result_revisions where competition_id = zzv.id('C1') and action = 'voided') || '/' || (select count(*) from public.results where competition_id = zzv.id('C1'))$s$, '1/3');
    perform zzv.ok('the organizer reopens a match of the finished competition', $s$select public.reopen_match(zzv.id('m5'), 'zz verify reopen')$s$);
    perform zzv.q('reopening supersedes results (kept in the log) and the competition runs again', $s$(select status from public.competitions where id = zzv.id('C1')) || '/' || (select count(*) from public.results where competition_id = zzv.id('C1')) || '/' || (select count(*) from public.result_revisions where competition_id = zzv.id('C1') and action = 'superseded' and reason = 'zz verify reopen')$s$, 'running/0/3');
    perform zzv.q('changing a round-robin result cleared the recorded tie order', $s$(select count(*) from public.pool_standings(zzv.id('C1')) where decided)$s$, '0');
    perform zzv.as_admin();
    perform zzv.err('the revision log is append-only, even for the database owner', $s$update public.result_revisions set reason = 'zz verify rewrite' where competition_id = zzv.id('C1')$s$, '42501');
    perform zzv.as_user('org2');
    perform zzv.err('another event''s organizer cannot build this schedule', $s$select public.build_schedule(zzv.id('C2'), '[]'::jsonb, 'new', null)$s$, '42501');
    perform zzv.as_user('org1');
    perform zzv.q('build_schedule builds a bracket atomically and records the draw', $s$public.build_schedule(zzv.id('C2'), jsonb_build_array(jsonb_build_object('key', 'f', 'stage', 'final', 'round_label', 'Final', 'position', 0, 'a', zzv.id('C2e1'), 'b', zzv.id('C2e2'))), 'new', '{"mode":"random","seed":42,"algorithm":"zz-verify","format":"single_elimination"}'::jsonb)$s$, '1');
    perform zzv.q('the draw seed is stored', $s$(select draw_seed || '/' || draw_mode || '/' || draw_algorithm from public.competitions where id = zzv.id('C2'))$s$, '42/random/zz-verify');
    perform zzv.err('a second "new" build is refused', $s$select public.build_schedule(zzv.id('C2'), jsonb_build_array(jsonb_build_object('key', 'f', 'stage', 'final', 'round_label', 'Final', 'position', 0, 'a', zzv.id('C2e1'), 'b', zzv.id('C2e2'))), 'new', null)$s$, 'P0001');
    perform zzv.q('"replace" swaps the unplayed schedule in one step', $s$public.build_schedule(zzv.id('C2'), jsonb_build_array(jsonb_build_object('key', 'f', 'stage', 'final', 'round_label', 'Final', 'position', 0, 'a', zzv.id('C2e2'), 'b', zzv.id('C2e1'))), 'replace', null)$s$, '1');
    perform zzv.as_admin();
    perform zzv.q('... leaving exactly one match', $s$(select count(*) from public.matches where competition_id = zzv.id('C2'))$s$, '1');
    perform zzv.q('entries remember the team name used at the event', $s$(select team_name_at_event from public.entries where id = zzv.id('C2e1'))$s$, 'ZZ Verify T1');
    update public.teams set name = 'ZZ Verify T2 Renamed' where id = zzv.id('T2');
    perform zzv.q('renaming a team does not rewrite the event-time name', $s$(select team_name_at_event || ' / ' || team_current_name from public.result_rows_all where event_id = zzv.id('ER'))$s$, 'ZZ Verify T2 / ZZ Verify T2 Renamed');
    perform zzv.q('existing entries were backfilled with a team name (none with a team left blank)', $s$(select count(*) from public.entries where team_id is not null and team_name_at_event is null)$s$, '0');

    -- ================================================================================================ Pack 05
    perform zzv.pack('Pack 05');
    perform zzv.q('fighter identity review table exists with RLS on', $s$(select relrowsecurity from pg_class where oid = 'public.fighter_identity_reviews'::regclass)$s$, 'true');
    perform zzv.q('all-results/history views exist', $s$(select count(*) from pg_views where schemaname = 'public' and viewname in ('result_rows_all', 'fighter_results_all', 'team_results_all'))$s$, '3');
    insert into public.registrations (id, event_id, user_id, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name)
    values (zzv.id('R1'), zzv.id('E1'), zzv.id('reg1'), 'ZZ VERIFY SAMENAME', 'male', 'HACSA', 'hacsa_member', zzv.id('W1'), 'ZZ VERIFY SAMENAME');
    insert into public.registrations (id, event_id, user_id, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name)
    values (zzv.id('R2'), zzv.id('E2'), zzv.id('reg1'), 'ZZ Verify Samename', 'male', 'HACSA', 'hacsa_member', zzv.id('W2'), 'ZZ Verify Samename');
    perform zzv.as_user('org1');
    perform zzv.ok('organizer accepts a registration whose name matches an unlinked fighter', $s$select public.decide_registration(zzv.id('R1'), 'accepted')$s$);
    perform zzv.as_user('org2');
    perform zzv.ok('another organizer accepts the same account at another event', $s$select public.decide_registration(zzv.id('R2'), 'accepted')$s$);
    perform zzv.as_admin();
    perform zzv.q('one account has exactly one fighter', $s$(select count(*) from public.fighter_accounts where user_id = zzv.id('reg1'))$s$, '1');
    perform zzv.q('the historical record was not silently linked', $s$(select count(*) from public.fighter_accounts where fighter_id = zzv.id('Fhist'))$s$, '0');
    perform zzv.q('one open identity review links the two records', $s$(select count(*) from public.fighter_identity_reviews where status = 'open' and candidate_id = zzv.id('Fhist'))$s$, '1');
    insert into zzv.kv select 'review', id::text from public.fighter_identity_reviews where candidate_id = zzv.id('Fhist');
    perform zzv.as_user('org1');
    perform zzv.err('an event organizer cannot list identity reviews', $s$select * from public.list_fighter_identity_reviews()$s$, '42501');
    perform zzv.err('an event organizer cannot resolve an identity review', $s$select public.resolve_fighter_identity_review((select v::uuid from zzv.kv where k = 'review'), 'duplicate', 'zz verify')$s$, '42501');
    perform zzv.as_user('oadmA');
    perform zzv.err('an organization admin cannot resolve an identity review', $s$select public.resolve_fighter_identity_review((select v::uuid from zzv.kv where k = 'review'), 'duplicate', 'zz verify')$s$, '42501');
    perform zzv.as_user('owner');
    perform zzv.q('the platform owner sees the review', $s$(select count(*) from public.list_fighter_identity_reviews() where review_id = (select v::uuid from zzv.kv where k = 'review'))$s$, '1');
    perform zzv.ok('the platform owner decides it', $s$select public.resolve_fighter_identity_review((select v::uuid from zzv.kv where k = 'review'), 'distinct', 'zz verify two different people')$s$);
    perform zzv.as_admin();
    perform zzv.q('the decision is recorded, nothing merged', $s$(select status from public.fighter_identity_reviews where id = (select v::uuid from zzv.kv where k = 'review')) || '/' || (select count(*) from public.fighters where id = zzv.id('Fhist'))$s$, 'distinct/1');
    perform zzv.as_anon();
    perform zzv.q('history view keeps the synthetic result, flagged', $s$(select synthetic from public.result_rows_all where event_id = zzv.id('ES'))$s$, 'true');
    perform zzv.q('history view keeps the real result, not flagged', $s$(select synthetic from public.result_rows_all where event_id = zzv.id('ER'))$s$, 'false');

    -- ================================================================================================ Hosted data (read-only, as anon)
    perform zzv.pack('Hosted data');
    perform zzv.as_anon();
    perform zzv.q('pool_standings runs on an existing published competition without error', $s$(select count(*) > 0 from public.pool_standings((select k.id from public.competitions k join public.events ev on ev.id = k.event_id join public.matches m on m.competition_id = k.id where ev.status = 'published' and m.stage in ('pool', 'round_robin') and m.queue_state = 'final' and ev.slug not like 'zz-verify-%' order by k.id limit 1)))$s$, 'true');
    perform zzv.q('no synthetic event feeds official result rows', $s$(select count(*) from public.result_rows r where private.is_synthetic('event', r.event_id))$s$, '0');
    perform zzv.q('no synthetic event counts as a played event', $s$(select count(*) from public.played_events p where private.is_synthetic('event', p.event_id))$s$, '0');
    perform zzv.q('no synthetic match feeds match statistics', $s$(select count(*) from public.match_sides s where private.is_synthetic('event', s.event_id))$s$, '0');
    perform zzv.q('anon can read approved teams', $s$(select count(*) > 0 from public.teams where status = 'approved' and slug not like 'zz-verify-%')$s$, 'true');
    perform zzv.q('anon can read published events', $s$(select count(*) > 0 from public.events where status = 'published' and slug not like 'zz-verify-%')$s$, 'true');
    perform zzv.q('anon cannot see the draft Red Deer Rumble 2026 event (draft stays private)', $s$(select count(*) from public.events where slug = 'red-deer-rumble-2026')$s$, '0');
    perform zzv.as_user('owner');
    perform zzv.q('the platform owner can see the draft Red Deer Rumble 2026 event', $s$(select count(*) from public.events where slug = 'red-deer-rumble-2026')$s$, '1');

    -- ------------------------------------------------------------------------------------------------ collect, then undo everything
    perform zzv.as_admin();
    select coalesce(jsonb_agg(jsonb_build_object('pack', l.pack, 'check', l.check_name, 'ok', l.ok, 'detail', l.detail) order by l.n), '[]'::jsonb) into v_rows from zzv.log l;
    raise exception using errcode = 'ZZ999', message = 'roll back every verification fixture';
  exception
    when sqlstate 'ZZ999' then null;  -- expected: the fixtures, helpers and every change made by the checks are undone here
    when others then
      get stacked diagnostics v_msg = message_text, v_ctx = pg_exception_context;
      v_rows := jsonb_build_array(jsonb_build_object('pack', 'harness', 'check', 'ran to the end', 'ok', false, 'detail', sqlstate || ': ' || v_msg || ' @ ' || left(v_ctx, 300)));
  end;
  return query select r ->> 'pack', r ->> 'check', (r ->> 'ok')::boolean, r ->> 'detail' from jsonb_array_elements(v_rows) r;
end $V$;

select * from pg_temp.bos_verify_packs_01_05();
