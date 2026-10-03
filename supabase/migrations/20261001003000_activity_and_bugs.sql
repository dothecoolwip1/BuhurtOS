-- First-party product analytics for the platform owner (super admin), and bug reports from anyone. Additive.
--   * activity_sessions: one row per browser tab visit (a random id the app makes) with a random browser visitor id (new vs returning),
--     who (only if signed in), device class, browser and OS family, referring site, time zone and language, entry page, last page and times.
--     activity_views: each page opened, with the time (only the path, never the query string). activity_events: named product actions.
--     Visiting creates NO account, profile or fighter record: these rows are anonymous unless the person is signed in.
--   * Written only through track_activity() / track_event(); read only by the owner through admin_* functions. Kept 90 days.
--   * No precise location: the time zone is the only place hint. Country/region/city come from the external provider (PostHog), if configured.
--   * bug_reports: what went wrong, what was expected, the page, app version, device and an optional screenshot (private bucket).
--     Written through report_bug() by anyone, signed in or not, at most 10 an hour per visit. The owner is notified and reads them.

create table public.activity_sessions (
  id uuid primary key,
  -- A random id kept in the browser across visits: tells new from returning visitors without any account.
  visitor_id uuid,
  is_new_visitor boolean not null default true,
  user_id uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  path text not null default '/' check (char_length(path) <= 200),
  entry_path text check (char_length(entry_path) <= 200),
  page_count int not null default 1,
  device text check (device in ('phone', 'tablet', 'desktop')),
  browser text check (char_length(browser) <= 40),
  os text check (char_length(os) <= 40),
  referrer_host text check (char_length(referrer_host) <= 120),
  utm_source text check (char_length(utm_source) <= 80),
  time_zone text check (char_length(time_zone) <= 60),
  language text check (char_length(language) <= 20)
);
create index activity_sessions_seen_idx on public.activity_sessions (last_seen_at desc);
create index activity_sessions_user_idx on public.activity_sessions (user_id, last_seen_at desc);
create table public.activity_views (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.activity_sessions (id) on delete cascade,
  path text not null check (char_length(path) <= 200),
  at timestamptz not null default now()
);
create index activity_views_session_idx on public.activity_views (session_id, at);
create index activity_views_at_idx on public.activity_views (at desc);
-- Named product actions (sign_up, login, search, registration_submitted, ...). Short names and small, non-sensitive properties only.
create table public.activity_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.activity_sessions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 1024),
  at timestamptz not null default now()
);
create index activity_events_at_idx on public.activity_events (at desc, name);
alter table public.activity_sessions enable row level security;
alter table public.activity_views enable row level security;
alter table public.activity_events enable row level security;
-- No policies and no grants: written by track_activity() / track_event(), read by the owner-only admin functions.

-- p_meta (all optional, all trimmed): visitor_id, new_visitor, referrer_host, utm_source, browser, os, time_zone, language.
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
      left(m ->> 'browser', 40), left(m ->> 'os', 40), left(lower(m ->> 'referrer_host'), 120), left(m ->> 'utm_source', 80), left(m ->> 'time_zone', 60), left(m ->> 'language', 20))
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
    delete from public.activity_sessions where last_seen_at < now() - interval '90 days';
    delete from public.activity_events where at < now() - interval '90 days';
  end if;
end $$;

-- A named product action. Names are short words; properties are capped at 1 KB and must not carry form contents.
create or replace function public.track_event(p_session uuid, p_name text, p_props jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{1,39}$' then return; end if;
  if p_session is not null and not exists (select 1 from public.activity_sessions where id = p_session) then p_session := null; end if;
  if p_session is not null and (select count(*) from public.activity_events where session_id = p_session) >= 1000 then return; end if;
  insert into public.activity_events (session_id, user_id, name, props)
  values (p_session, auth.uid(), p_name, case when jsonb_typeof(p_props) = 'object' and pg_column_size(p_props) <= 1024 then p_props else '{}'::jsonb end);
end $$;

-- Owner-only analytics over [p_from, p_to). p_audience: 'all' | 'anonymous' | 'registered'. p_device: null or phone/tablet/desktop.
-- One call returns every block of the dashboard as JSON, so the page needs a single round trip.
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
    'searches', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select lower(left(props ->> 'query', 60)) as query, count(*) as n from ev where name = 'search' and props ? 'query' group by 1 order by 2 desc limit 20) x),
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

-- Owner-only: product usage per account over [p_from, p_to). No form contents, no tokens.
create or replace function public.admin_user_activity(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, name text, email text, account_created timestamptz, last_sign_in timestamptz, last_active timestamptz, sessions bigint,
               total_seconds bigint, page_views bigint, top_device text, time_zone text, recent_pages text[], recent_events text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can see analytics' using errcode = '42501'; end if;
  return query
  with s as (select * from public.activity_sessions x where x.user_id is not null and x.started_at < p_to and x.last_seen_at >= p_from)
  select u.id, private.person_name(u.id), u.email::text, u.created_at, u.last_sign_in_at,
    max(s.last_seen_at), count(s.id), coalesce(sum(extract(epoch from (s.last_seen_at - s.started_at)))::bigint, 0), coalesce(sum(s.page_count), 0)::bigint,
    mode() within group (order by s.device), mode() within group (order by s.time_zone),
    (select array_agg(p) from (select v.path as p from public.activity_views v join public.activity_sessions s2 on s2.id = v.session_id where s2.user_id = u.id order by v.at desc limit 8) r),
    (select array_agg(n) from (select e.name || coalesce(' ' || (e.props ->> 'label'), '') as n from public.activity_events e where e.user_id = u.id order by e.at desc limit 8) r)
  from auth.users u join s on s.user_id = u.id
  group by u.id, u.email, u.created_at, u.last_sign_in_at
  order by max(s.last_seen_at) desc limit 300;
end $$;

-- Sessions seen in the last p_hours, newest first. Owner only. Names and emails are shown to the owner only.
create or replace function public.admin_activity(p_hours int default 24)
returns table (session_id uuid, user_id uuid, name text, email text, device text, started_at timestamptz, last_seen_at timestamptz, path text, page_count int, online boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can see activity' using errcode = '42501'; end if;
  return query
  select s.id, s.user_id, private.person_name(s.user_id), u.email::text, s.device, s.started_at, s.last_seen_at, s.path, s.page_count,
         s.last_seen_at > now() - interval '2 minutes'
  from public.activity_sessions s left join auth.users u on u.id = s.user_id
  where s.last_seen_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 90)))
  order by s.last_seen_at desc limit 500;
end $$;

-- The pages one visit opened, in order. Owner only.
create or replace function public.admin_session_views(p_session uuid) returns table (path text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can see activity' using errcode = '42501'; end if;
  return query select v.path, v.at from public.activity_views v where v.session_id = p_session order by v.at limit 500;
end $$;

-- ---------------------------------------------------------------- bug reports
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  session_id uuid,
  contact text check (contact is null or char_length(contact) <= 200),
  what text not null check (char_length(what) between 5 and 2000),
  expected text check (expected is null or char_length(expected) <= 2000),
  path text check (char_length(path) <= 200),
  app_version text check (char_length(app_version) <= 120),
  user_agent text check (char_length(user_agent) <= 400),
  screen text check (char_length(screen) <= 40),
  screenshot_path text check (screenshot_path is null or screenshot_path ~ '^reports/[0-9a-f-]{36}\.(jpg|png)$'),
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wontfix'))
);
create index bug_reports_created_idx on public.bug_reports (created_at desc);
alter table public.bug_reports enable row level security;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported'));

create or replace function public.report_bug(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_what text; v_session uuid; v_shot text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the report as an object' using errcode = '22023'; end if;
  v_what := btrim(coalesce(p ->> 'what', ''));
  if char_length(v_what) < 5 then raise exception 'say in a few words what went wrong' using errcode = '22023'; end if;
  if char_length(v_what) > 2000 then raise exception 'keep it under 2000 characters' using errcode = '22023'; end if;
  v_session := case when (p ->> 'session_id') ~ '^[0-9a-f-]{36}$' then (p ->> 'session_id')::uuid end;
  if (select count(*) from public.bug_reports b where b.created_at > now() - interval '1 hour'
        and ((v_session is not null and b.session_id = v_session) or (auth.uid() is not null and b.user_id = auth.uid()))) >= 10 then
    raise exception 'that is a lot of reports in an hour; thank you! try again a little later' using errcode = 'P0001'; end if;
  v_shot := nullif(p ->> 'screenshot_path', '');
  if v_shot is not null and v_shot !~ '^reports/[0-9a-f-]{36}\.(jpg|png)$' then v_shot := null; end if;
  insert into public.bug_reports (user_id, session_id, contact, what, expected, path, app_version, user_agent, screen, screenshot_path)
  values (auth.uid(), v_session, left(nullif(btrim(p ->> 'contact'), ''), 200), v_what, left(nullif(btrim(p ->> 'expected'), ''), 2000),
          left(split_part(coalesce(p ->> 'path', ''), '?', 1), 200), left(p ->> 'app_version', 120), left(p ->> 'user_agent', 400), left(p ->> 'screen', 40), v_shot)
  returning id into v_id;
  insert into public.notifications (user_id, kind, payload)
  select pr.user_id, 'bug_reported', jsonb_build_object('report_id', v_id, 'what', left(v_what, 120), 'path', left(split_part(coalesce(p ->> 'path', ''), '?', 1), 200))
  from public.platform_roles pr where pr.role = 'owner';
  return v_id;
end $$;

create or replace function public.admin_bug_reports(p_status text default null)
returns table (id uuid, created_at timestamptz, name text, email text, contact text, what text, expected text, path text, app_version text, user_agent text, screen text, screenshot_path text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can read bug reports' using errcode = '42501'; end if;
  return query select b.id, b.created_at, private.person_name(b.user_id), u.email::text, b.contact, b.what, b.expected, b.path, b.app_version, b.user_agent, b.screen, b.screenshot_path, b.status
    from public.bug_reports b left join auth.users u on u.id = b.user_id
    where p_status is null or b.status = p_status order by b.created_at desc limit 300;
end $$;

create or replace function public.set_bug_status(p_report uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can change bug reports' using errcode = '42501'; end if;
  if p_status not in ('new', 'seen', 'fixed', 'wontfix') then raise exception 'unknown status' using errcode = '22023'; end if;
  update public.bug_reports set status = p_status where id = p_report;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-screenshots', 'bug-screenshots', false, 3145728, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Anyone may drop a screenshot into reports/; only the owner can read them (the bucket is private).
create policy bug_shots_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'bug-screenshots' and name ~ '^reports/[0-9a-f-]{36}\.(jpg|png)$');
create policy bug_shots_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'bug-screenshots' and private.is_owner());

revoke execute on function public.track_activity(uuid, text, text, jsonb), public.track_event(uuid, text, jsonb), public.report_bug(jsonb) from public;
grant execute on function public.track_activity(uuid, text, text, jsonb), public.track_event(uuid, text, jsonb), public.report_bug(jsonb) to anon, authenticated;
revoke execute on function public.admin_analytics(timestamptz, timestamptz, text, text), public.admin_user_activity(timestamptz, timestamptz), public.admin_activity(int),
  public.admin_session_views(uuid), public.admin_bug_reports(text), public.set_bug_status(uuid, text) from public, anon;
grant execute on function public.admin_analytics(timestamptz, timestamptz, text, text), public.admin_user_activity(timestamptz, timestamptz), public.admin_activity(int),
  public.admin_session_views(uuid), public.admin_bug_reports(text), public.set_bug_status(uuid, text) to authenticated;
