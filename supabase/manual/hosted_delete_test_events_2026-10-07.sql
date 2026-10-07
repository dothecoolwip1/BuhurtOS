-- BuhurtOS: ONE-TIME owner-approved deletion of two test events from the HOSTED database (project mvbxlebznlgroptwwdsm), 2026-10-07.
-- Run in the Supabase dashboard SQL Editor, as the project owner, ONCE, the whole file top to bottom. NOT a migration; never run it anywhere else
-- except the local test (supabase/manual/test_delete_test_events.sh).
--
-- WHY THIS EXISTS. The owner approved, as a one-time exception, the full deletion of the two test events
--     feec4fde-ea8c-4eaa-86f2-9538b5c61785   slug test-stuff-test
--     1acb67d3-db5f-40a5-bce7-682e0aa6edb3   slug test-new-test
-- including their scores, result proposals, results, result revisions, Lyst history, discipline records, registration history, notifications
-- and audit rows. public.delete_event refuses both (published, fights fought, official results), and four append-only logs refuse any DELETE.
-- This authorization covers ONLY these two event ids. Everything is targeted by exact UUID; slugs are only checked, never matched by pattern.
--
-- WHAT IT DOES (one REPEATABLE READ transaction; any failed check raises, and the whole transaction rolls back, triggers included):
--   1. checks it runs as the database owner (not an app session), and that both ids exist with exactly the expected slugs
--   2. collects the two events' rows by id (competitions, matches, entries, results, registrations, invitations, announcements, discipline,
--      credentials) and the notifications that provably belong to them (see NOTIFICATIONS)
--   3. checks the shared records that must stay: fighters Garrett, Odin, Taylor and Bjorn Robson, the team Red Deer Reavers, the organization,
--      and the four Auth accounts linked to the events
--   4. refuses if any row of another event points at these events' rows, or these events' rows point at another event's rows, or if there are
--      rows in a history table whose delete-blocking trigger this script does not bypass (discipline reviews/suspensions/history, sanctions,
--      authenticity findings, weigh-ins, overrides, Lyst counts, camera log, discipline rules, competition rulesets)
--   5. counts every table before: the rows it expects to remove per affected table, and the total of EVERY table in public and private (plus
--      auth.users, auth.identities and storage.objects)
--   6. disables exactly four triggers, each checked to exist and be enabled first:
--        public.result_revisions          result_revisions_no_change
--        public.lyst_round_revisions      lyst_round_revisions_no_change
--        public.match_discipline          match_discipline_guard
--        public.registration_inspections  registration_inspections_append_only
--      (no session_replication_role, no FK, constraint, RLS or other trigger is touched; foreign keys keep cascading normally)
--   7. deletes: the events' results (results.entry_id is ON DELETE RESTRICT), then the two event rows (their ON DELETE CASCADE foreign keys
--      remove competitions, entries, matches, scores, proposals, revisions, Lyst rows, discipline, registrations and their history), then the
--      rows with no foreign key: the events' audit_log rows (by event_id), record_sources links (by entity id) and the owned notifications
--      (push_deliveries cascade from notifications)
--   8. re-enables the four triggers
--   9. verifies: no row of the two events is left in any affected table; the slugs are gone; every affected table lost exactly the expected rows;
--      every other table's total is unchanged; the shared records still exist; every trigger in public and private has exactly the enabled
--      state it had before; ambiguous notifications were kept
--  10. commits, and prints the rows deleted per table (the last result in the SQL Editor)
--
-- NOTIFICATIONS. A notification has no foreign key to an event; it names it in payload ->> 'event_slug'. One is deleted only when its event_slug
-- EQUALS the slug read from one of the two event rows by id, AND every id it carries (event_id, competition_id, match_id, entry_id,
-- registration_id, invitation_id, announcement_id) belongs to the same two events. Any other notification that mentions one of their ids is kept
-- and listed in the report as 'kept (ambiguous)'. No text search.
--
-- NOT DELETED: any fighter, team, team membership, organization, Auth account or profile; the storage file of the test event's sponsor logo
-- (event-sponsors bucket, path 1acb67d3-db5f-40a5-bce7-682e0aa6edb3/...): files are removed in the Storage UI, never by SQL.

begin isolation level repeatable read;
set local lock_timeout = '15s';

do $cleanup$
declare
  k_stuff constant uuid := 'feec4fde-ea8c-4eaa-86f2-9538b5c61785';
  k_new   constant uuid := '1acb67d3-db5f-40a5-bce7-682e0aa6edb3';
  k_fighters constant uuid[] := array['7c848b31-39db-453c-b2c4-7fa84982620f',   -- Garrett Robson
                                      'f847b3c6-db5b-4a0b-bad2-bc9a4a8e0b38',   -- Odin Robson
                                      '9c9f5faa-687c-4035-b269-2d0d36774756',   -- Taylor Robson
                                      'd2a3cda7-8ba1-4bff-8850-6a3c2eba4619']::uuid[]; -- Bjorn Robson (Red Deer Reavers member)
  k_team constant uuid := 'a87fcf7c-c3a3-4fb6-b373-9c0b61676d68';           -- Red Deer Reavers
  k_org  constant uuid := 'cbaf08ce-0317-4179-99a5-f3ad2cc7e7d0';           -- organization of test-new-test
  k_triggers constant text[][] := array[['result_revisions', 'result_revisions_no_change'],
                                        ['lyst_round_revisions', 'lyst_round_revisions_no_change'],
                                        ['match_discipline', 'match_discipline_guard'],
                                        ['registration_inspections', 'registration_inspections_append_only']];
  r record; v_n bigint; v_m bigint; v_users uuid[]; i int;
begin
  -- 1 ---------------------------------------------------------------------------------------------------------------------------------------
  if private.is_client_session() then
    raise exception 'refusing: run this as the database owner in the Supabase SQL Editor, not from an app session'; end if;
  create temp table _t on commit drop as select id, slug from public.events where id in (k_stuff, k_new);
  if (select count(*) from _t) <> 2 then raise exception 'refusing: expected both test events, found %', (select count(*) from _t); end if;
  if not exists (select 1 from _t where id = k_stuff and slug = 'test-stuff-test') then
    raise exception 'refusing: event % no longer has slug test-stuff-test', k_stuff; end if;
  if not exists (select 1 from _t where id = k_new and slug = 'test-new-test') then
    raise exception 'refusing: event % no longer has slug test-new-test', k_new; end if;

  -- 2 ---------------------------------------------------------------------------------------------------------------------------------------
  create temp table _c on commit drop as select id from public.competitions where event_id in (select id from _t);
  create temp table _m on commit drop as select id from public.matches where competition_id in (select id from _c);
  create temp table _e on commit drop as select id from public.entries where competition_id in (select id from _c);
  create temp table _res on commit drop as select id from public.results where competition_id in (select id from _c);
  create temp table _r on commit drop as select id from public.registrations where event_id in (select id from _t);
  create temp table _w on commit drop as select id from public.waiver_versions where event_id in (select id from _t);
  create temp table _inv on commit drop as select id from public.event_invitations where event_id in (select id from _t);
  create temp table _ann on commit drop as select id from public.event_announcements where event_id in (select id from _t);
  create temp table _md on commit drop as select id from public.match_discipline where event_id in (select id from _t);
  create temp table _cred on commit drop as select id from public.event_credentials where event_id in (select id from _t);
  create temp table _seat on commit drop as select id from public.lyst_counter_seats where event_id in (select id from _t);
  create temp table _ids on commit drop as
    select id from _t union all select id from _c union all select id from _m union all select id from _e union all select id from _res
    union all select id from _r union all select id from _inv union all select id from _ann union all select id from _md;

  -- notifications: a candidate names one of the two slugs exactly; it is owned when every id it carries belongs to the two events
  create temp table _ncand on commit drop as
    select n.id, n.payload from public.notifications n where n.payload ->> 'event_slug' in (select slug from _t);
  create temp table _n on commit drop as
    select id from _ncand x
    where (x.payload ->> 'event_id' is null or x.payload ->> 'event_id' in (select id::text from _t))
      and (x.payload ->> 'competition_id' is null or x.payload ->> 'competition_id' in (select id::text from _c))
      and (x.payload ->> 'match_id' is null or x.payload ->> 'match_id' in (select id::text from _m))
      and (x.payload ->> 'entry_id' is null or x.payload ->> 'entry_id' in (select id::text from _e))
      and (x.payload ->> 'registration_id' is null or x.payload ->> 'registration_id' in (select id::text from _r))
      and (x.payload ->> 'invitation_id' is null or x.payload ->> 'invitation_id' in (select id::text from _inv))
      and (x.payload ->> 'announcement_id' is null or x.payload ->> 'announcement_id' in (select id::text from _ann));
  -- kept: a candidate that is not owned, or any other notification that carries one of the events' ids under one of those keys
  create temp table _namb on commit drop as
    select n.id from public.notifications n
    where n.id not in (select id from _n)
      and (n.id in (select id from _ncand)
           or exists (select 1 from jsonb_each_text(case when jsonb_typeof(n.payload) = 'object' then n.payload else '{}'::jsonb end) kv
                      where kv.key in ('event_id', 'competition_id', 'match_id', 'entry_id', 'registration_id', 'invitation_id', 'announcement_id')
                        and kv.value in (select id::text from _ids)));

  -- 3 ---------------------------------------------------------------------------------------------------------------------------------------
  if (select count(*) from public.fighters where id = any (k_fighters)) <> 4 then raise exception 'refusing: a protected fighter is missing'; end if;
  if not exists (select 1 from public.teams where id = k_team) then raise exception 'refusing: Red Deer Reavers is missing'; end if;
  if not exists (select 1 from public.team_memberships where team_id = k_team and fighter_id = 'd2a3cda7-8ba1-4bff-8850-6a3c2eba4619') then
    raise exception 'refusing: Bjorn Robson''s Red Deer Reavers membership is missing'; end if;
  if not exists (select 1 from public.organizations where id = k_org) then raise exception 'refusing: the organization is missing'; end if;
  select coalesce(array_agg(distinct u), '{}') into v_users from (
    select user_id u from public.event_staff where event_id in (select id from _t)
    union select user_id from public.registrations where id in (select id from _r)
    union select inspected_by from public.registration_inspections where event_id in (select id from _t)
    union select sent_by from public.event_announcements where event_id in (select id from _t)
    union select user_id from public.notifications where id in (select id from _n)) x where u is not null;
  if (select count(*) from auth.users where id = any (v_users)) <> cardinality(v_users) then raise exception 'refusing: a linked Auth account is missing'; end if;
  create temp table _keep on commit drop as
    select 'fighter' kind, id from public.fighters where id = any (k_fighters)
    union all select 'team', id from public.teams where id = k_team
    union all select 'organization', id from public.organizations where id = k_org
    union all select 'auth user', id from auth.users where id = any (v_users)
    union all select 'team membership', id from public.team_memberships where fighter_id = any (k_fighters) or team_id = k_team
    union all select 'kept notification', id from _namb;

  -- 4 ---------------------------------------------------------------------------------------------------------------------------------------
  for r in select * from (values
    ('another event''s fight points at these events'' entrants or fights',
     $q$select count(*) from public.matches where id not in (select id from _m) and (entry_a in (select id from _e) or entry_b in (select id from _e)
        or winner_entry_id in (select id from _e) or next_match_id in (select id from _m))$q$),
    ('these events'' fights point at another event''s entrants or fights',
     $q$select count(*) from public.matches where id in (select id from _m) and (entry_a not in (select id from _e) or entry_b not in (select id from _e)
        or winner_entry_id not in (select id from _e) or next_match_id not in (select id from _m))$q$),
    ('a result crosses events', $q$select count(*) from public.results where (competition_id in (select id from _c)) <> (entry_id in (select id from _e))$q$),
    ('a result revision crosses events',
     $q$select count(*) from public.result_revisions where entry_id is not null and (competition_id in (select id from _c)) <> (entry_id in (select id from _e))$q$),
    ('a registration competition crosses events',
     $q$select count(*) from public.registration_competitions where (registration_id in (select id from _r)) <> (competition_id in (select id from _c))$q$),
    ('an invitation competition crosses events',
     $q$select count(*) from public.event_invitation_competitions where (invitation_id in (select id from _inv)) <> (competition_id in (select id from _c))$q$),
    ('another event''s invitation points at these events'' registrations',
     $q$select count(*) from public.event_invitations where id not in (select id from _inv) and registration_id in (select id from _r)$q$),
    ('another event''s registration uses these events'' waiver',
     $q$select count(*) from public.registrations where id not in (select id from _r) and waiver_version_id in (select id from _w)$q$),
    ('an entrant record crosses events',
     $q$select (select count(*) from public.entry_fighters where (entry_id in (select id from _e)) <> (competition_id in (select id from _c)))
             + (select count(*) from public.pool_tie_decisions where (entry_id in (select id from _e)) <> (competition_id in (select id from _c)))
             + (select count(*) from public.match_live_scores where (match_id in (select id from _m)) <> (competition_id in (select id from _c)))$q$),
    ('a fight record crosses events',
     $q$select (select count(*) from public.result_proposals where (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.lyst_matches where (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.lyst_rounds where (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.match_discipline where (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.match_discipline where id not in (select id from _md) and related_id in (select id from _md))
             + (select count(*) from public.lyst_timer where match_id is not null and (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.lyst_counter_seats where match_id is not null and (event_id in (select id from _t)) <> (match_id in (select id from _m)))
             + (select count(*) from public.lyst_counter_rounds where (seat_id in (select id from _seat)) <> (match_id in (select id from _m)))
             + (select count(*) from public.lyst_counts where (seat_id in (select id from _seat)) <> (match_id in (select id from _m)))$q$),
    ('a registration record crosses events',
     $q$select count(*) from public.registration_inspections where (event_id in (select id from _t)) <> (registration_id in (select id from _r))$q$),
    ('another event''s credential points at these events'' credentials',
     $q$select count(*) from public.event_credentials where id not in (select id from _cred) and replaced_by in (select id from _cred)$q$),
    ('a history table whose delete guard is not bypassed has rows of these events',
     $q$select (select count(*) from public.discipline_reviews where event_id in (select id from _t) or match_id in (select id from _m) or match_discipline_id in (select id from _md))
             + (select count(*) from public.discipline_suspensions where event_id in (select id from _t) or competition_id in (select id from _c))
             + (select count(*) from public.discipline_history where event_id in (select id from _t))
             + (select count(*) from public.event_sanctions where event_id in (select id from _t) or competition_id in (select id from _c))
             + (select count(*) from public.authenticity_findings where event_id in (select id from _t) or registration_id in (select id from _r))
             + (select count(*) from public.registration_weighins where event_id in (select id from _t) or registration_id in (select id from _r))
             + (select count(*) from public.registration_overrides where event_id in (select id from _t) or registration_id in (select id from _r))
             + (select count(*) from public.lyst_counts where match_id in (select id from _m) or seat_id in (select id from _seat))
             + (select count(*) from public.event_camera_log where event_id in (select id from _t))
             + (select count(*) from public.match_discipline_rules where event_id in (select id from _t) or discipline_id in (select id from _md))
             + (select count(*) from public.competition_rulesets where competition_id in (select id from _c))$q$)
  ) q(what, sql) loop
    execute r.sql into v_n;
    if v_n <> 0 then raise exception 'refusing: % (% rows)', r.what, v_n; end if;
  end loop;

  -- 5 ---------------------------------------------------------------------------------------------------------------------------------------
  -- the rows each affected table should lose, as a predicate on the ids collected above
  create temp table _aff (tbl text primary key, pred text not null, expected bigint, before bigint, after bigint, left_over bigint) on commit drop;
  insert into _aff (tbl, pred) values
    ('events', 'id in (select id from _t)'),
    ('competitions', 'event_id in (select id from _t)'), ('waiver_versions', 'event_id in (select id from _t)'),
    ('event_staff', 'event_id in (select id from _t)'), ('event_announcements', 'event_id in (select id from _t)'),
    ('event_invitations', 'event_id in (select id from _t)'), ('event_sponsors', 'event_id in (select id from _t)'),
    ('lyst_matches', 'event_id in (select id from _t)'), ('lyst_rounds', 'event_id in (select id from _t)'),
    ('lyst_timer', 'event_id in (select id from _t)'), ('lyst_counter_seats', 'event_id in (select id from _t)'),
    ('lyst_join_codes', 'event_id in (select id from _t)'), ('event_lyst_settings', 'event_id in (select id from _t)'),
    ('match_discipline', 'event_id in (select id from _t)'), ('registration_inspections', 'event_id in (select id from _t)'),
    ('registrations', 'event_id in (select id from _t)'), ('result_proposals', 'event_id in (select id from _t)'),
    ('broadcast_controller_status', 'event_id in (select id from _t)'), ('event_broadcast', 'event_id in (select id from _t)'),
    ('event_broadcast_control', 'event_id in (select id from _t)'), ('event_camera_state', 'event_id in (select id from _t)'),
    ('event_credentials', 'event_id in (select id from _t)'), ('event_sessions', 'credential_id in (select id from _cred)'),
    ('matches', 'competition_id in (select id from _c)'), ('entries', 'competition_id in (select id from _c)'),
    ('results', 'competition_id in (select id from _c)'), ('result_revisions', 'competition_id in (select id from _c)'),
    ('match_live_scores', 'competition_id in (select id from _c)'), ('pool_tie_decisions', 'competition_id in (select id from _c)'),
    ('entry_fighters', 'competition_id in (select id from _c)'), ('registration_competitions', 'competition_id in (select id from _c)'),
    ('event_invitation_competitions', 'competition_id in (select id from _c)'),
    ('score_events', 'match_id in (select id from _m)'), ('lyst_round_revisions', 'match_id in (select id from _m)'),
    ('lyst_counter_rounds', 'match_id in (select id from _m)'),
    ('registration_checks', 'registration_id in (select id from _r)'), ('registration_private', 'registration_id in (select id from _r)'),
    ('match_discipline_private', 'discipline_id in (select id from _md)'),
    ('notifications', 'id in (select id from _n)'), ('push_deliveries', 'notification_id in (select id from _n)'),
    ('audit_log', 'event_id in (select id from _t)'),
    ('record_sources', 'entity_id in (select id from _ids)');
  for r in select tbl, pred from _aff loop
    execute format('select count(*) filter (where %s), count(*) from public.%I', r.pred, r.tbl) into v_n, v_m;
    update _aff set expected = v_n, before = v_m where tbl = r.tbl;
  end loop;
  -- every other table: its total must not change
  create temp table _other (tbl text primary key, before bigint, after bigint) on commit drop;
  for r in select format('%I.%I', n.nspname, c.relname) q from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r', 'p') and not c.relispartition and n.nspname in ('public', 'private')
             and not (n.nspname = 'public' and c.relname in (select tbl from _aff))
           union all select unnest(array['auth.users', 'auth.identities', 'storage.objects']) loop
    execute format('select count(*) from %s', r.q) into v_n;
    insert into _other values (r.q, v_n, null);
  end loop;
  create temp table _trig on commit drop as
    select t.tgrelid, t.tgrelid::regclass::text tbl, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'private');

  -- 6 ---------------------------------------------------------------------------------------------------------------------------------------
  for i in 1 .. array_length(k_triggers, 1) loop
    if not exists (select 1 from _trig where tgrelid = ('public.' || k_triggers[i][1])::regclass and tgname = k_triggers[i][2] and tgenabled = 'O') then
      raise exception 'refusing: trigger %.% is missing or not enabled', k_triggers[i][1], k_triggers[i][2]; end if;
    execute format('alter table public.%I disable trigger %I', k_triggers[i][1], k_triggers[i][2]);
  end loop;

  -- 7 ---------------------------------------------------------------------------------------------------------------------------------------
  delete from public.results where competition_id in (select id from _c);
  delete from public.events where id in (k_stuff, k_new);
  delete from public.audit_log where event_id in (k_stuff, k_new);
  delete from public.record_sources where entity_id in (select id from _ids);
  delete from public.notifications where id in (select id from _n);

  -- 8 ---------------------------------------------------------------------------------------------------------------------------------------
  for i in 1 .. array_length(k_triggers, 1) loop
    execute format('alter table public.%I enable trigger %I', k_triggers[i][1], k_triggers[i][2]);
  end loop;

  -- 9 ---------------------------------------------------------------------------------------------------------------------------------------
  if exists (select 1 from _trig b left join pg_trigger t on t.tgrelid = b.tgrelid and t.tgname = b.tgname
             where t.tgenabled is distinct from b.tgenabled) then
    raise exception 'a trigger did not return to its previous state; rolling back'; end if;
  if exists (select 1 from pg_trigger t, generate_subscripts(k_triggers, 1) s
             where t.tgrelid = ('public.' || k_triggers[s][1])::regclass and t.tgname = k_triggers[s][2] and t.tgenabled <> 'O') then
    raise exception 'a bypassed trigger is not enabled again; rolling back'; end if;
  if exists (select 1 from public.events where id in (k_stuff, k_new) or slug in ('test-stuff-test', 'test-new-test')) then
    raise exception 'a test event is still there; rolling back'; end if;
  for r in select tbl, pred from _aff loop
    execute format('select count(*) filter (where %s), count(*) from public.%I', r.pred, r.tbl) into v_n, v_m;
    update _aff set left_over = v_n, after = v_m where tbl = r.tbl;
  end loop;
  if exists (select 1 from _aff where left_over <> 0) then
    raise exception 'rows of the test events are left in: %; rolling back', (select string_agg(tbl, ', ') from _aff where left_over <> 0); end if;
  if exists (select 1 from _aff where after <> before - expected) then
    raise exception 'a table lost a different number of rows than expected: %; rolling back',
      (select string_agg(format('%s (before %s, expected -%s, after %s)', tbl, before, expected, after), ', ') from _aff where after <> before - expected); end if;
  for r in select tbl from _other loop
    execute format('select count(*) from %s', r.tbl) into v_n;
    update _other set after = v_n where tbl = r.tbl;
  end loop;
  if exists (select 1 from _other where after <> before) then
    raise exception 'an unrelated table changed: %; rolling back',
      (select string_agg(format('%s (%s -> %s)', tbl, before, after), ', ') from _other where after <> before); end if;
  if exists (select 1 from _keep k where not exists (
       select 1 from public.fighters where k.kind = 'fighter' and id = k.id
       union all select 1 from public.teams where k.kind = 'team' and id = k.id
       union all select 1 from public.organizations where k.kind = 'organization' and id = k.id
       union all select 1 from auth.users where k.kind = 'auth user' and id = k.id
       union all select 1 from public.team_memberships where k.kind = 'team membership' and id = k.id
       union all select 1 from public.notifications where k.kind = 'kept notification' and id = k.id)) then
    raise exception 'a protected record is missing; rolling back'; end if;

  -- 10 -------------------------------------------------------------------------------------------------------------------------------------- (report)
  drop table if exists pg_temp.cleanup_report;
  create temp table cleanup_report (section text, item text, n bigint);
  insert into cleanup_report select 'deleted', tbl, before - after from _aff where before - after > 0;
  insert into cleanup_report select 'deleted', 'TOTAL', sum(before - after) from _aff;
  insert into cleanup_report select 'kept (protected)', kind, count(*) from _keep where kind <> 'kept notification' group by kind;
  insert into cleanup_report select 'kept (ambiguous)', 'notification ' || id, 1 from _namb;
  insert into cleanup_report select 'unchanged totals', 'tables checked', count(*) from _other;
  insert into cleanup_report select 'triggers', 'bypassed then re-enabled', array_length(k_triggers, 1);
end $cleanup$;

commit;

select * from pg_temp.cleanup_report order by case section when 'deleted' then 1 when 'kept (protected)' then 2 when 'kept (ambiguous)' then 3 else 4 end, item = 'TOTAL', item;
