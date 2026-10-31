-- Analytics leaves out testing (owner request 2026-10-31: "This should not keep track of all the testing you and codex do").
-- A visit counts as testing, and is left out of the Analytics page, when:
--   * it is signed in as the platform owner, a test-event crew account (organizer@buhurtos.ca, scorekeeper@buhurtos.ca), or an account
--     listed in private.analytics_excluded_accounts (for more test accounts later), or
--   * it comes from a browser that has ever been signed in as one of those accounts (the same random visitor id), so the signed-out part of
--     a rehearsal in that browser is left out too.
-- The visits are kept, only marked (activity_sessions.internal) and hidden from the reads; the Analytics page shows how many were hidden.
-- Browsers driven by automation (navigator.webdriver) and browsers with analytics turned off on /privacy send nothing at all (app side).
-- In-flight: every visit already recorded (90 days) is marked by the backfill below, so the page is clean straight away.
-- Additive: one column, one private table, two triggers, a backfill and anchored patches of the four owner-only reads (each refuses unless
-- its anchor is found exactly once; safe to run twice).
set check_function_bodies = off;

create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'analytics testing patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

alter table public.activity_sessions add column if not exists internal boolean not null default false;
comment on column public.activity_sessions.internal is 'Testing (owner, test crew or an excluded account, or a browser once signed in as one): kept, but left out of Analytics.';
create index if not exists activity_sessions_visitor_idx on public.activity_sessions (visitor_id) where visitor_id is not null;

create table if not exists private.analytics_excluded_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table private.analytics_excluded_accounts enable row level security;
revoke all on table private.analytics_excluded_accounts from public, anon, authenticated;
comment on table private.analytics_excluded_accounts is 'Extra accounts whose visits are testing and left out of Analytics (the owner and the test crew are always left out).';

create or replace function private.analytics_internal_account(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
       exists (select 1 from public.platform_roles r where r.user_id = p_user and r.role = 'owner')
    or exists (select 1 from private.test_event_crew c where c.user_id = p_user)
    or exists (select 1 from private.analytics_excluded_accounts a where a.user_id = p_user))
$$;
revoke execute on function private.analytics_internal_account(uuid) from public, anon, authenticated;

-- a visit is marked when it is (or becomes) signed in as a testing account, or its browser already has a marked visit
create or replace function private.activity_sessions_mark_internal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.internal and (private.analytics_internal_account(new.user_id)
      or (new.visitor_id is not null and exists (select 1 from public.activity_sessions x where x.visitor_id = new.visitor_id and x.internal and x.id <> new.id))) then
    new.internal := true;
  end if;
  return new;
end $$;
revoke execute on function private.activity_sessions_mark_internal() from public, anon, authenticated;
drop trigger if exists activity_sessions_mark_internal on public.activity_sessions;
create trigger activity_sessions_mark_internal before insert or update of user_id, visitor_id on public.activity_sessions
  for each row execute function private.activity_sessions_mark_internal();

-- once a browser is known to be a testing browser, its earlier signed-out visits are marked too
create or replace function private.activity_sessions_mark_visitor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.internal and new.visitor_id is not null and (tg_op = 'INSERT' or not old.internal) then
    update public.activity_sessions set internal = true where visitor_id = new.visitor_id and not internal and id <> new.id;
  end if;
  return null;
end $$;
revoke execute on function private.activity_sessions_mark_visitor() from public, anon, authenticated;
drop trigger if exists activity_sessions_mark_visitor on public.activity_sessions;
create trigger activity_sessions_mark_visitor after insert or update of internal, user_id on public.activity_sessions
  for each row execute function private.activity_sessions_mark_visitor();

-- backfill: every visit already recorded
update public.activity_sessions set internal = true where not internal and private.analytics_internal_account(user_id);
update public.activity_sessions s set internal = true
 where not s.internal and s.visitor_id in (select x.visitor_id from public.activity_sessions x where x.internal and x.visitor_id is not null);

-- the owner-only reads leave testing out
select pg_temp.bos_patch('public.admin_analytics(timestamp with time zone,timestamp with time zone,text,text)'::regprocedure,
  $a$where x.started_at < p_to and x.last_seen_at >= p_from$a$,   -- one line: hosted keeps a differently indented copy of this function
  $b$where not x.internal and x.started_at < p_to and x.last_seen_at >= p_from$b$);
select pg_temp.bos_patch('public.admin_analytics(timestamp with time zone,timestamp with time zone,text,text)'::regprocedure,
  $a$      and (e.session_id is null or e.session_id in (select id from s))$a$,
  $b$      and (e.session_id is null or e.session_id in (select id from s)) and not private.analytics_internal_account(e.user_id)$b$);
select pg_temp.bos_patch('public.admin_analytics(timestamp with time zone,timestamp with time zone,text,text)'::regprocedure,
  $a$    'totals', jsonb_build_object($a$,
  $b$    'totals', jsonb_build_object(
      'testing_hidden', (select count(*) from public.activity_sessions x where x.internal and x.started_at < p_to and x.last_seen_at >= p_from),$b$);
select pg_temp.bos_patch('public.admin_user_activity(timestamp with time zone,timestamp with time zone)'::regprocedure,
  $a$  with s as (select * from public.activity_sessions x where x.user_id is not null and$a$,
  $b$  with s as (select * from public.activity_sessions x where not x.internal and x.user_id is not null and$b$);
select pg_temp.bos_patch('public.admin_activity(integer)'::regprocedure,
  $a$  where s.last_seen_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 90)))$a$,
  $b$  where not s.internal and s.last_seen_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 90)))$b$);

reset check_function_bodies;
