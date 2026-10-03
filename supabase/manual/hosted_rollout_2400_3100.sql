-- BuhurtOS: apply the two pending hosted migrations, verify them, and prove the 90-day purge.
-- Run in the Supabase dashboard SQL editor for project mvbxlebznlgroptwwdsm (the project the app points at), as the project owner.
-- Do NOT use `supabase db push`: the hosted migration history uses different version numbers, so it would try to re-run everything.
--
-- Contents (run the whole file once, top to bottom; each part is safe to re-run):
--   PART 0  precondition check (refuses to run if the analytics schema from migration ...003000 is missing)
--   PART 1  migration 20261001002400_match_delete_unlink_fix   (verbatim)
--   PART 2  migration 20261001003100_analytics_privacy         (verbatim)
--   PART 3  verification (read-only): one result table, every row should say ok = true
--   PART 4  90-day purge proof with fictional rows, inside a transaction that is ROLLED BACK (nothing remains)
-- Reviewed: additive; 2400 swaps a CHECK on public.matches for a weaker one (no row violates either) and replaces a trigger;
-- 3100 only touches the analytics tables and functions. Neither migration deletes or rewrites user content.

-- ================================================================ PART 0
do $$
begin
  if to_regclass('public.activity_sessions') is null or to_regclass('public.matches') is null then
    raise exception 'The analytics schema (migration 20261001003000) is missing; stop and check the schema before applying these.';
  end if;
end $$;

-- ================================================================ PART 1: 20261001002400_match_delete_unlink_fix
begin;
-- Deleting several linked matches in ONE statement failed (additive; replaces the trigger of 20261001001700).
--
-- 20261001001700 added a BEFORE DELETE ROW trigger that clears next_match_id / next_slot on the matches that lead into the deleted one. It claims that
-- "deleting a whole schedule in one statement, or a whole competition, behaves as before". It does not: when the statement deletes both a match and
-- a match that leads into it, the trigger tries to update a row the same command already deleted and PostgreSQL stops with
--   ERROR: tuple to be updated was already modified by an operation triggered by the current command
-- (a BEFORE trigger must not modify other rows the statement is changing). Found while removing the NACL-test dataset: 17 of its 105 competitions could
-- not have their matches deleted in one statement. The same statement is what the Run tab sends when it replaces a schedule
-- (src/data/matches.ts: delete().in('id', oldIds)) and what deleting a competition or event cascades into.
--
-- Fix: the foreign key's own ON DELETE SET NULL clears next_match_id; the table check only has to allow the slot to linger for a moment. The check
-- becomes "a link needs a slot" (next_match_id null OR next_slot not null) and an AFTER DELETE statement trigger clears the leftover slots of the
-- competitions touched. Result after any delete: the same state as before 20261001001700 intended (link and slot both null), without the error.

do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.matches'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'next_match_id IS NULL\) = \(next_slot IS NULL' loop
    execute format('alter table public.matches drop constraint %I', c);
  end loop;
end $$;
alter table public.matches drop constraint if exists matches_next_link_has_slot;
alter table public.matches add constraint matches_next_link_has_slot check (next_match_id is null or next_slot is not null);

drop trigger if exists matches_unlink_before_delete on public.matches;
drop function if exists private.unlink_deleted_match();

create or replace function private.clear_orphan_next_slots() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches m set next_slot = null
  where m.next_match_id is null and m.next_slot is not null and m.competition_id in (select o.competition_id from old_rows o);
  return null;
end $$;
revoke execute on function private.clear_orphan_next_slots() from public, anon, authenticated;
drop trigger if exists matches_clear_orphan_slots on public.matches;
create trigger matches_clear_orphan_slots after delete on public.matches referencing old table as old_rows for each statement execute function private.clear_orphan_next_slots();
commit;

-- ================================================================ PART 2: 20261001003100_analytics_privacy
begin;
-- Analytics privacy. Additive; safe to re-run.
--   * What people type is never stored: track_event drops a 'query' property whatever an old browser sends, the owner's analytics counts
--     search boxes used (by page) instead of search words, and search words already stored are removed.
--   * Campaign values (utm_source, from the query string) and the browser language are no longer stored; stored values are cleared.
--   * The 90-day limit no longer depends on traffic: private.purge_activity() is run every day by pg_cron (and still occasionally by
--     track_activity). It deletes visits and actions older than 90 days.
-- Everything else about these tables is unchanged (see 20261001003000_activity_and_bugs.sql).

create or replace function private.purge_activity() returns void
language sql security definer set search_path = '' as $$
  delete from public.activity_sessions where last_seen_at < now() - interval '90 days';
  delete from public.activity_events where at < now() - interval '90 days';
$$;
revoke execute on function private.purge_activity() from public, anon, authenticated;

-- Daily purge. pg_cron is already used for the medical-notes purge; where it is not available (a plain local Postgres) this is skipped
-- with a notice and the occasional purge inside track_activity still runs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-activity') then perform cron.unschedule('purge-activity'); end if;
    perform cron.schedule('purge-activity', '41 9 * * *', 'select private.purge_activity()');
  else
    raise notice 'pg_cron is not installed: the daily activity purge was not scheduled';
  end if;
end $$;

-- Remove what the older code already stored.
update public.activity_events set props = props - 'query' where name = 'search' and props ? 'query';
update public.activity_sessions set utm_source = null, language = null where utm_source is not null or language is not null;

create or replace function public.track_activity(p_session uuid, p_path text, p_device text default null, p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_path text := left(coalesce(nullif(split_part(split_part(coalesce(p_path, '/'), '?', 1), '#', 1), ''), '/'), 200);
  v_dev text := case when p_device in ('phone', 'tablet', 'desktop') then p_device end;
  m jsonb := case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end;
  v_old public.activity_sessions;
begin
  if p_session is null then return; end if;
  select * into v_old from public.activity_sessions where id = p_session;
  if not found then
    insert into public.activity_sessions (id, visitor_id, is_new_visitor, user_id, path, entry_path, device, browser, os, referrer_host, utm_source, time_zone, language)
    values (p_session,
      case when (m ->> 'visitor_id') ~ '^[0-9a-f-]{36}$' then (m ->> 'visitor_id')::uuid end,
      coalesce((m ->> 'new_visitor')::boolean, true), auth.uid(), v_path, v_path, v_dev,
      left(m ->> 'browser', 40), left(m ->> 'os', 40), left(lower(m ->> 'referrer_host'), 120), null, left(m ->> 'time_zone', 60), null)
    on conflict (id) do nothing;
    insert into public.activity_views (session_id, path) values (p_session, v_path);
  else
    -- A visit belongs to whoever started it; a different signed-in person cannot write into it.
    if v_old.user_id is not null and auth.uid() is distinct from v_old.user_id then return; end if;
    if v_old.path = v_path and v_old.last_seen_at > now() - interval '20 seconds' then return; end if;
    update public.activity_sessions set last_seen_at = now(), path = v_path, user_id = coalesce(user_id, auth.uid()),
      page_count = page_count + case when v_old.path <> v_path then 1 else 0 end
    where id = p_session;
    if v_old.path <> v_path and v_old.page_count < 2000 then insert into public.activity_views (session_id, path) values (p_session, v_path); end if;
  end if;
  if random() < 0.01 then
    perform private.purge_activity();
  end if;
end $$;

create or replace function public.track_event(p_session uuid, p_name text, p_props jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{1,39}$' then return; end if;
  if p_session is not null and not exists (select 1 from public.activity_sessions where id = p_session) then p_session := null; end if;
  if p_session is not null and (select count(*) from public.activity_events where session_id = p_session) >= 1000 then return; end if;
  insert into public.activity_events (session_id, user_id, name, props)
  values (p_session, auth.uid(), p_name, (case when jsonb_typeof(p_props) = 'object' and pg_column_size(p_props) <= 1024 then p_props else '{}'::jsonb end) - 'query');
end $$;

create or replace function public.admin_analytics(p_from timestamptz, p_to timestamptz, p_audience text default 'all', p_device text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_owner() then raise exception 'only the platform owner can see analytics' using errcode = '42501'; end if;
  with s as (
    select * from public.activity_sessions x
    where x.started_at < p_to and x.last_seen_at >= p_from
      and (coalesce(p_audience, 'all') = 'all' or (p_audience = 'anonymous' and x.user_id is null) or (p_audience = 'registered' and x.user_id is not null))
      and (p_device is null or x.device = p_device)
  ), vw as (
    select v.*, lead(v.at) over (partition by v.session_id order by v.at) as next_at,
           lead(v.path) over (partition by v.session_id order by v.at) as next_path, s.last_seen_at
    from public.activity_views v join s on s.id = v.session_id
  ), vt as (
    -- Time on a page: until the next page, or until the visit was last seen; capped at 30 minutes so a tab left open does not count for hours.
    select path, next_path, session_id, least(extract(epoch from (coalesce(next_at, last_seen_at) - at)), 1800) as secs, (next_at is null) as is_exit from vw
  ), ev as (
    select e.* from public.activity_events e where e.at >= p_from and e.at < p_to
      and (e.session_id is null or e.session_id in (select id from s))
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'visitors', (select count(distinct coalesce(visitor_id, id)) from s),
      'new_visitors', (select count(distinct coalesce(visitor_id, id)) from s where is_new_visitor),
      'returning_visitors', (select count(distinct visitor_id) from s where not is_new_visitor and visitor_id is not null),
      'sessions', (select count(*) from s),
      'anonymous_sessions', (select count(*) from s where user_id is null),
      'registered_people', (select count(distinct user_id) from s where user_id is not null),
      'online_now', (select count(*) from s where last_seen_at > now() - interval '2 minutes'),
      'avg_session_seconds', (select coalesce(round(avg(extract(epoch from (last_seen_at - started_at)))), 0) from s),
      'page_views', (select count(*) from vw),
      'signups', (select count(*) from auth.users u where u.created_at >= p_from and u.created_at < p_to),
      'logins', (select count(*) from ev where name = 'login'),
      'accounts_total', (select count(*) from auth.users)
    ),
    'pages', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (select path, count(*) as views, count(distinct session_id) as visits, round(avg(secs)) as avg_seconds from vt group by path order by count(*) desc limit 40) x),
    'entry_pages', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select entry_path as path, count(*) as n from s group by entry_path order by count(*) desc limit 15) x),
    'exit_pages', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select path, count(*) as n from vt where is_exit group by path order by count(*) desc limit 15) x),
    'paths', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select path as from_path, next_path as to_path, count(*) as n from vt where next_path is not null group by path, next_path order by count(*) desc limit 25) x),
    'referrers', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(nullif(referrer_host, ''), 'direct') as source, count(*) as n from s group by 1 order by 2 desc limit 15) x),
    'utm_sources', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select utm_source as source, count(*) as n from s where utm_source is not null group by 1 order by 2 desc limit 15) x),
    'devices', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(device, 'unknown') as name, count(*) as n from s group by 1) x),
    'browsers', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(browser, 'unknown') as name, count(*) as n from s group by 1) x),
    'os', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(os, 'unknown') as name, count(*) as n from s group by 1) x),
    'time_zones', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(time_zone, 'unknown') as name, count(*) as n from s group by 1 order by 2 desc limit 20) x),
    'events', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select name, count(*) as n, count(distinct session_id) as sessions from ev group by name) x),
    'searches', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select props ->> 'where' as "where", count(*) as n from ev where name = 'search' and props ? 'where' group by 1 order by 2 desc limit 20) x),
    'signup_entry_pages', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select s.entry_path as path, count(*) as n from s join ev on ev.session_id = s.id and ev.name = 'sign_up' group by s.entry_path order by count(*) desc limit 15) x),
    'funnel_registration', jsonb_build_object(
      'event_page_views', (select count(distinct session_id) from vt where path ~ '^/events/[^/]+$'),
      'register_page_views', (select count(distinct session_id) from vt where path ~ '^/events/[^/]+/register$'),
      'registrations_submitted', (select count(*) from ev where name = 'registration_submitted')
    ),
    'funnel_signup', jsonb_build_object(
      'visitors', (select count(*) from s where user_id is null or is_new_visitor),
      'sign_in_opened', (select count(distinct session_id) from ev where name = 'sign_in_opened'),
      'code_requested', (select count(distinct session_id) from ev where name = 'sign_in_code_sent'),
      'signed_up', (select count(*) from ev where name = 'sign_up'),
      'profile_completed', (select count(*) from ev where name = 'profile_completed')
    ),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]') from (select date_trunc('day', started_at)::date as day, count(*) as sessions, count(distinct coalesce(visitor_id, id)) as visitors from s group by 1) x)
  ) into v;
  return v;
end $$;
commit;

-- Optional bookkeeping so the migration history lists them (the SQL editor does not write it). Versions are arbitrary but increasing.
insert into supabase_migrations.schema_migrations (version, name) values ('20261003090001', 'match_delete_unlink_fix') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261003090002', 'analytics_privacy') on conflict do nothing;

-- ================================================================ PART 3: verification (read-only)
select check_name, ok, detail from (
  select 1 as n, '2400: new check matches_next_link_has_slot exists' as check_name,
         exists(select 1 from pg_constraint where conname = 'matches_next_link_has_slot') as ok, '' as detail
  union all select 2, '2400: old equality check is gone',
         not exists(select 1 from pg_constraint where conrelid = 'public.matches'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'next_match_id IS NULL\) = \(next_slot IS NULL'), ''
  union all select 3, '2400: statement trigger matches_clear_orphan_slots exists',
         exists(select 1 from pg_trigger where tgname = 'matches_clear_orphan_slots' and not tgisinternal), ''
  union all select 4, '2400: old row trigger matches_unlink_before_delete is gone',
         not exists(select 1 from pg_trigger where tgname = 'matches_unlink_before_delete'), ''
  union all select 5, '2400: no match row violates the new check',
         (select count(*) from public.matches where next_match_id is not null and next_slot is null) = 0, ''
  union all select 6, '3100: private.purge_activity() exists',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'purge_activity'), ''
  union all select 7, '3100: purge_activity is NOT executable by anon / authenticated',
         not has_function_privilege('anon', 'private.purge_activity()', 'execute') and not has_function_privilege('authenticated', 'private.purge_activity()', 'execute'), ''
  union all select 8, '3100: cron job purge-activity exists and is active',
         exists(select 1 from cron.job where jobname = 'purge-activity' and active), coalesce((select schedule || ' -> ' || command from cron.job where jobname = 'purge-activity'), 'missing')
  union all select 9, '3100: track_event drops a "query" property',
         (select pg_get_functiondef(p.oid) like '%- ''query''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'track_event'), ''
  union all select 10, '3100: track_activity no longer stores utm_source or language',
         (select pg_get_functiondef(p.oid) not like '%''utm_source'', 80%' and pg_get_functiondef(p.oid) not like '%''language'', 20%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'track_activity'), ''
  union all select 11, '3100: no stored search words and no stored utm_source / language remain',
         (select count(*) from public.activity_events where props ? 'query') = 0 and (select count(*) from public.activity_sessions where utm_source is not null or language is not null) = 0, ''
  union all select 12, '3100: owner analytics counts searches by page (no search words)',
         (select pg_get_functiondef(p.oid) like '%props ->> ''where''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_analytics'), ''
  union all select 13, 'RLS is still on for all analytics tables',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('activity_sessions', 'activity_views', 'activity_events', 'bug_reports') and relrowsecurity) = 4, ''
  union all select 14, 'analytics tables still have no direct grants for anon / authenticated',
         not exists(select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('activity_sessions', 'activity_views', 'activity_events') and grantee in ('anon', 'authenticated')), ''
) v order by n;

-- ================================================================ PART 4: 90-day purge proof (fictional rows; the transaction is rolled back)
begin;
  insert into public.activity_sessions (id, last_seen_at, path) values
    ('00000000-0000-4000-8000-00000000d091', now() - interval '91 days', '/qa-test-older-than-90-days'),
    ('00000000-0000-4000-8000-00000000d089', now() - interval '89 days', '/qa-test-newer-than-90-days');
  insert into public.activity_events (session_id, name, at) values
    (null, 'qa_test_old_action', now() - interval '91 days'),
    (null, 'qa_test_recent_action', now() - interval '89 days');
  select private.purge_activity();
  select 'purge proof' as what,
         (select count(*) from public.activity_sessions where id = '00000000-0000-4000-8000-00000000d091') = 0 as older_than_90_days_session_removed,
         (select count(*) from public.activity_sessions where id = '00000000-0000-4000-8000-00000000d089') = 1 as newer_session_kept,
         (select count(*) from public.activity_events where name = 'qa_test_old_action') = 0 as old_action_removed,
         (select count(*) from public.activity_events where name = 'qa_test_recent_action') = 1 as recent_action_kept;
rollback;
