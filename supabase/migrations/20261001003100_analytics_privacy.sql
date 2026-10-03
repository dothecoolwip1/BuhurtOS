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
