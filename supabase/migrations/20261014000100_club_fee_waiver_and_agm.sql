-- Club membership, part 2: a per-year membership fee waiver (Red Deer Reavers 2026) and club general meetings (the 2026 AGM): RSVP, proxy
-- authorizations, check-in and saved AGM records. Additive only; builds on 20261013000100_club_membership_dues_voting.sql.
--
-- * Fee waiver is a property of the MEMBERSHIP YEAR (club_membership_years.fee_waived), not of each member's dues record and not a removal of
--   dues: per-member dues records, their history and the Paid / Waived / Gear contribution statuses are untouched and keep working for 2027+.
--   When a year's fee is waived, Unpaid dues no longer stop anyone voting, and the apps show the fee as waived.
-- * Voting eligibility stays ONE rule set (private.club_vote_check). The AGM uses it with the meeting day as the "as of" date.
-- * Planned participation (RSVP) and actual attendance (check-in) are separate tables; neither overwrites the other.
-- * Proxies are documented authority only: nothing here casts or counts a vote. A proxy row is never edited except to end it (cancelled /
--   replaced), never removed, so the table itself is the audit trail. RSVP and check-in changes also go to append-only history tables.
-- * Saved AGM records are frozen JSON snapshots, so the official record does not change when someone's membership changes later.
-- * RLS on every table; no API role can read or write these tables directly; every action is a checked security-definer function.
--   Members act only on their OWN membership; President / Secretary / Treasurer administer; any current executive can view.

-- ---------------------------------------------------------------- 1. per-year fee waiver
alter table public.club_membership_years add column fee_waived boolean not null default false;

-- Paid, Waived and Gear contribution satisfy dues; in a year whose fee is waived, nothing is owed at all.
create or replace function private.club_vote_check(p_membership uuid, p_as_of date default current_date)
returns table (eligible boolean, reason_codes text[], reasons text[], is_adult boolean)
language sql stable security definer set search_path = '' as $$
  with m as (
    select m.*, y.min_voting_age, y.dues_required_to_vote, y.fee_waived, coalesce(d.status, 'unpaid') as dues_status,
           case when m.date_of_birth is not null then extract(year from age(coalesce(p_as_of, current_date), m.date_of_birth))::int >= y.min_voting_age
                when m.adult_confirmed then true end as adult
    from public.club_memberships m
    join public.club_membership_years y on y.team_id = m.team_id and y.year = m.membership_year
    left join public.club_dues d on d.membership_id = m.id
    where m.id = p_membership
  ), rules(sort, code, label, fails) as (
    select 1, 'membership_pending', 'Membership pending approval', m.status = 'pending' from m
    union all select 2, 'membership_inactive', 'Membership inactive', m.status = 'inactive' from m
    union all select 3, 'membership_removed', 'Membership removed', m.status = 'removed' from m
    union all select 4, 'under_age', 'Under ' || m.min_voting_age, m.adult is false from m
    union all select 5, 'age_unknown', 'Age not confirmed', m.adult is null from m
    -- Paid, Waived and Gear contribution satisfy the dues requirement. A gear contribution can only be recorded by a dues officer, so a
    -- recorded one is an approved one. A year whose fee is waived requires no dues.
    union all select 6, 'dues_unpaid', 'Dues unpaid', m.dues_required_to_vote and not m.fee_waived and m.dues_status = 'unpaid' from m
  )
  select not coalesce(bool_or(r.fails), true),
         coalesce(array_agg(r.code order by r.sort) filter (where r.fails), '{}'),
         coalesce(array_agg(r.label order by r.sort) filter (where r.fails), '{}'),
         (select m.adult from m)
  from rules r
$$;
revoke execute on function private.club_vote_check(uuid, date) from public, anon, authenticated;

-- The overview now also says whether each year's fee is waived (same signature and output otherwise).
create or replace function public.club_membership_overview(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_year int;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  v_year := private.club_current_year(p_team);
  return jsonb_build_object(
    'team_id', p_team,
    'enabled', v_year is not null,
    'current_year', v_year,
    'years', coalesce((select jsonb_agg(jsonb_build_object('year', y.year, 'starts_on', y.starts_on, 'ends_on', y.ends_on, 'dues_cents', y.dues_cents,
                         'min_voting_age', y.min_voting_age, 'applications_open', y.applications_open, 'fee_waived', y.fee_waived) order by y.year desc)
                       from public.club_membership_years y where y.team_id = p_team), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'year', m.membership_year, 'status', m.status, 'full_name', m.full_name, 'discord_name', m.discord_name,
        'date_of_birth', m.date_of_birth, 'adult_confirmed', m.adult_confirmed, 'applied_at', m.applied_at,
        'dues_status', coalesce(d.status, 'unpaid'), 'dues_amount_cents', d.amount_cents, 'dues_changed_at', d.changed_at,
        'fee_waived', y.fee_waived,
        'eligible', c.eligible, 'reason_codes', to_jsonb(c.reason_codes), 'reasons', to_jsonb(c.reasons)) order by m.membership_year desc)
      from public.club_memberships m
      join public.club_membership_years y on y.team_id = m.team_id and y.year = m.membership_year
      left join public.club_dues d on d.membership_id = m.id
      cross join lateral private.club_vote_check(m.id, current_date) c
      where m.team_id = p_team and m.user_id = v_uid), '[]'::jsonb),
    'offices', coalesce((select jsonb_agg(jsonb_build_object('office', o, 'label', private.office_label(o))) from unnest(private.my_team_offices(p_team)) o), '[]'::jsonb),
    'email', (select u.email from auth.users u where u.id = v_uid),
    'suggested_name', private.person_name(v_uid),
    'can_view_roster', private.can_view_club_roster(p_team),
    'can_change_dues', private.can_change_club_dues(p_team),
    'can_assign_officers', private.can_assign_team_officers(p_team));
end $$;

-- The Red Deer Reavers' 2026 membership fee is waived (owner decision 2026-10-06). Found by slug; nothing happens elsewhere.
update public.club_membership_years y set fee_waived = true
  from public.teams t where t.id = y.team_id and t.slug = 'red-deer-reavers' and y.year = 2026;

-- ---------------------------------------------------------------- 2. meetings
create table public.club_meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  membership_year int not null,
  kind text not null default 'agm' check (kind in ('agm', 'special')),
  title text not null check (char_length(title) between 3 and 120),
  starts_at timestamptz not null,
  timezone text not null default 'America/Edmonton',
  location text check (location is null or char_length(location) <= 200),
  -- Private: only the club's members and executive receive it, through club_meeting_member_view. Set by the executive, never hard-coded.
  video_link text check (video_link is null or (char_length(video_link) <= 500 and video_link ~ '^https://[^[:space:]]+$')),
  video_details text check (video_details is null or char_length(video_details) <= 500),
  created_at timestamptz not null default now(),
  foreign key (team_id, membership_year) references public.club_membership_years (team_id, year),
  unique (team_id, kind, membership_year)
);
alter table public.club_meetings enable row level security;

-- Planned participation: ONE row per member and meeting (changing it updates the row; every change is in the history below).
create table public.club_meeting_rsvps (
  meeting_id uuid not null references public.club_meetings (id) on delete cascade,
  membership_id uuid not null references public.club_memberships (id),
  -- null = the member withdrew their answer (for example by cancelling their proxy)
  response text check (response is null or response in ('in_person', 'video', 'proxy', 'not_attending')),
  responded_at timestamptz not null default now(),
  primary key (meeting_id, membership_id)
);
alter table public.club_meeting_rsvps enable row level security;

create table public.club_meeting_rsvp_history (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.club_meetings (id),
  membership_id uuid not null references public.club_memberships (id),
  previous_response text,
  new_response text,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.club_meeting_rsvp_history enable row level security;

-- Proxy authorizations. Documented authority only. One ACTIVE proxy per member and meeting; ended ones are kept.
create table public.club_meeting_proxies (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.club_meetings (id),
  grantor_membership_id uuid not null references public.club_memberships (id),
  holder_membership_id uuid not null references public.club_memberships (id),
  authorization_text text not null check (char_length(authorization_text) between 10 and 400),
  authorized_by uuid not null,
  authorized_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'cancelled', 'replaced')),
  ended_at timestamptz,
  ended_by uuid,
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  check (grantor_membership_id <> holder_membership_id),
  check ((status = 'active') = (ended_at is null))
);
alter table public.club_meeting_proxies enable row level security;
create unique index club_meeting_proxies_one_active on public.club_meeting_proxies (meeting_id, grantor_membership_id) where status = 'active';
create index club_meeting_proxies_holder_idx on public.club_meeting_proxies (meeting_id, holder_membership_id) where status = 'active';

-- Actual attendance at the meeting (check-in). Separate from the RSVP. Eligibility is snapshotted at check-in.
create table public.club_meeting_attendance (
  meeting_id uuid not null references public.club_meetings (id),
  membership_id uuid not null references public.club_memberships (id),
  status text not null check (status in ('present_in_person', 'present_video', 'absent')),
  recorded_by uuid not null,
  recorded_by_name text not null,
  recorded_at timestamptz not null default now(),
  membership_status_at_checkin text not null,
  eligible_at_checkin boolean not null,
  reasons_at_checkin text[] not null default '{}',
  primary key (meeting_id, membership_id)
);
alter table public.club_meeting_attendance enable row level security;

create table public.club_meeting_attendance_history (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.club_meetings (id),
  membership_id uuid not null references public.club_memberships (id),
  previous_status text,
  new_status text not null,
  recorded_by uuid not null,
  recorded_by_name text not null,
  recorded_at timestamptz not null default now(),
  eligible_at_checkin boolean not null
);
alter table public.club_meeting_attendance_history enable row level security;

-- Saved AGM records: frozen snapshots of the voter list, attendance and proxies at the moment the executive saved them.
create table public.club_meeting_records (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.club_meetings (id),
  recorded_by uuid not null,
  recorded_by_name text not null,
  recorded_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table public.club_meeting_records enable row level security;

revoke all on public.club_meetings, public.club_meeting_rsvps, public.club_meeting_rsvp_history, public.club_meeting_proxies,
  public.club_meeting_attendance, public.club_meeting_attendance_history, public.club_meeting_records from public, anon, authenticated;
-- No policies and no grants: everything goes through the functions below.

-- History and records can never be edited or removed (even by the table owner).
create or replace function private.club_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'this record cannot be changed or removed' using errcode = '42501'; end $$;
revoke execute on function private.club_append_only() from public, anon, authenticated;
create trigger club_meeting_rsvp_history_append_only before update or delete on public.club_meeting_rsvp_history
  for each row execute function private.club_append_only();
create trigger club_meeting_attendance_history_append_only before update or delete on public.club_meeting_attendance_history
  for each row execute function private.club_append_only();
create trigger club_meeting_records_append_only before update or delete on public.club_meeting_records
  for each row execute function private.club_append_only();

-- A proxy row can only be ENDED (active -> cancelled / replaced), never rewritten, reopened or removed.
create or replace function private.club_proxy_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'proxy records cannot be removed' using errcode = '42501'; end if;
  if old.status <> 'active' or new.status = 'active'
     or new.meeting_id <> old.meeting_id or new.grantor_membership_id <> old.grantor_membership_id or new.holder_membership_id <> old.holder_membership_id
     or new.authorization_text <> old.authorization_text or new.authorized_by <> old.authorized_by or new.authorized_at <> old.authorized_at then
    raise exception 'a proxy record can only be ended, not changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger club_meeting_proxies_guard before update or delete on public.club_meeting_proxies
  for each row execute function private.club_proxy_guard();
revoke execute on function private.club_proxy_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- The meeting's own day in its time zone: ages for the voter list are counted on this day.
create or replace function private.club_meeting_day(p_meeting uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (m.starts_at at time zone m.timezone)::date from public.club_meetings m where m.id = p_meeting
$$;
-- The caller's membership record for the meeting's club and year (any status), or null.
create or replace function private.club_meeting_my_membership(p_meeting uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select cm.id from public.club_meetings mt
  join public.club_memberships cm on cm.team_id = mt.team_id and cm.membership_year = mt.membership_year
  where mt.id = p_meeting and auth.uid() is not null and cm.user_id = auth.uid()
$$;
-- Is this proxy valid right now: still active, the giver and the holder both eligible to vote (on the meeting day), and the holder has not
-- given away their own vote. Returns null when valid, otherwise the reason.
create or replace function private.club_proxy_problem(p_proxy uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.status <> 'active' then 'Proxy ' || p.status
    when not (select c.eligible from private.club_vote_check(p.grantor_membership_id, private.club_meeting_day(p.meeting_id)) c) then 'Member giving the proxy is not eligible to vote'
    when not (select c.eligible from private.club_vote_check(p.holder_membership_id, private.club_meeting_day(p.meeting_id)) c) then 'Proxy holder is not eligible to vote'
    when exists (select 1 from public.club_meeting_proxies q where q.meeting_id = p.meeting_id and q.grantor_membership_id = p.holder_membership_id and q.status = 'active')
      then 'Proxy holder has given their own proxy'
  end
  from public.club_meeting_proxies p where p.id = p_proxy
$$;
revoke execute on function private.club_meeting_day(uuid), private.club_meeting_my_membership(uuid), private.club_proxy_problem(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- member: the AGM as I see it
-- For any signed-in person: the club's current AGM (date, time, place), their own membership, fee status, eligibility (counted on the
-- meeting day), their RSVP, their proxy, the proxies they hold, the private video link (members and executive only) and the eligible members
-- they could choose as proxy (only for people who have a membership record). Never another member's private data.
create or replace function public.club_meeting_member_view(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_day date; v_fee boolean; v_ok boolean; v_reasons text[];
  v_rsvp public.club_meeting_rsvps; v_proxy public.club_meeting_proxies; v_officer boolean;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where team_id = p_team and kind = 'agm'
    order by (starts_at >= now() - interval '1 day') desc, case when starts_at >= now() - interval '1 day' then starts_at end asc, starts_at desc limit 1;
  if not found then return jsonb_build_object('meeting', null); end if;
  v_day := private.club_meeting_day(mt.id);
  v_officer := private.can_view_club_roster(p_team);
  select fee_waived into v_fee from public.club_membership_years where team_id = mt.team_id and year = mt.membership_year;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(mt.id);
  if v_mem.id is not null then
    select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, v_day) c;
    select * into v_rsvp from public.club_meeting_rsvps where meeting_id = mt.id and membership_id = v_mem.id;
    select * into v_proxy from public.club_meeting_proxies where meeting_id = mt.id and grantor_membership_id = v_mem.id and status = 'active';
  end if;
  return jsonb_build_object(
    'meeting', jsonb_build_object('id', mt.id, 'title', mt.title, 'starts_at', mt.starts_at, 'timezone', mt.timezone, 'location', mt.location,
       'year', mt.membership_year, 'started', now() >= mt.starts_at,
       'local_date', to_char(mt.starts_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY'),
       'local_time', to_char(mt.starts_at at time zone mt.timezone, 'FMHH12:MI AM')),
    'fee_waived', coalesce(v_fee, false),
    'membership', case when v_mem.id is null then null else jsonb_build_object('id', v_mem.id, 'status', v_mem.status, 'full_name', v_mem.full_name,
       'dues_status', coalesce((select d.status from public.club_dues d where d.membership_id = v_mem.id), 'unpaid')) end,
    'eligible', v_ok, 'reasons', to_jsonb(coalesce(v_reasons, '{}')),
    'rsvp', case when v_rsvp.membership_id is null then null else jsonb_build_object('response', v_rsvp.response, 'responded_at', v_rsvp.responded_at) end,
    'proxy', case when v_proxy.id is null then null else jsonb_build_object('id', v_proxy.id, 'holder_membership_id', v_proxy.holder_membership_id,
       'holder_name', (select h.full_name from public.club_memberships h where h.id = v_proxy.holder_membership_id),
       'authorized_at', v_proxy.authorized_at, 'problem', private.club_proxy_problem(v_proxy.id)) end,
    'proxies_held', case when v_mem.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('grantor_name', g.full_name,
       'valid', private.club_proxy_problem(p.id) is null) order by g.full_name)
       from public.club_meeting_proxies p join public.club_memberships g on g.id = p.grantor_membership_id
       where p.meeting_id = mt.id and p.holder_membership_id = v_mem.id and p.status = 'active'), '[]'::jsonb) end,
    'video', case when v_officer or v_mem.status in ('active', 'pending') then jsonb_build_object('link', mt.video_link, 'details', mt.video_details) end,
    'proxy_candidates', case when v_mem.id is null or v_mem.status = 'removed' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('membership_id', c.id, 'name', c.full_name) order by lower(c.full_name))
       from public.club_memberships c cross join lateral private.club_vote_check(c.id, v_day) e
       where c.team_id = mt.team_id and c.membership_year = mt.membership_year and c.id <> v_mem.id and e.eligible
         and not exists (select 1 from public.club_meeting_proxies q where q.meeting_id = mt.id and q.grantor_membership_id = c.id and q.status = 'active')), '[]'::jsonb) end,
    'can_view_admin', v_officer,
    'can_manage', private.can_change_club_dues(p_team));
end $$;

-- ---------------------------------------------------------------- member: RSVP (and proxy) for MY OWN membership only
create or replace function public.set_club_meeting_rsvp(p_meeting uuid, p_response text, p_proxy_holder uuid default null, p_authorize boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_holder public.club_memberships; v_old public.club_meeting_rsvps;
  v_active public.club_meeting_proxies; v_day date; v_text text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting) for update;
  if v_mem.id is null then raise exception 'only members can register: apply for membership first' using errcode = '42501'; end if;
  if v_mem.status = 'removed' then raise exception 'your membership was removed: ask the club executive' using errcode = '42501'; end if;
  if now() >= mt.starts_at then raise exception 'the meeting has started: ask the club executive to record a change' using errcode = '22023'; end if;
  if p_response is null or p_response not in ('in_person', 'video', 'proxy', 'not_attending') then raise exception 'choose how you will take part' using errcode = '22023'; end if;
  v_day := private.club_meeting_day(p_meeting);
  select * into v_active from public.club_meeting_proxies where meeting_id = p_meeting and grantor_membership_id = v_mem.id and status = 'active' for update;

  if p_response = 'proxy' then
    if not coalesce(p_authorize, false) then raise exception 'confirm that you authorize your proxy' using errcode = '22023'; end if;
    if p_proxy_holder is null then raise exception 'choose the member who will hold your proxy' using errcode = '22023'; end if;
    select * into v_holder from public.club_memberships where id = p_proxy_holder;
    if v_holder.id is null or v_holder.team_id <> mt.team_id or v_holder.membership_year <> mt.membership_year then
      raise exception 'that person is not a member for this meeting' using errcode = '22023'; end if;
    if v_holder.id = v_mem.id then raise exception 'you cannot hold your own proxy' using errcode = '22023'; end if;
    if not (select c.eligible from private.club_vote_check(v_holder.id, v_day) c) then
      raise exception 'the member you chose is not eligible to vote, so they cannot hold a proxy' using errcode = '22023'; end if;
    if exists (select 1 from public.club_meeting_proxies q where q.meeting_id = p_meeting and q.grantor_membership_id = v_holder.id and q.status = 'active') then
      raise exception 'the member you chose has given their own proxy, so they cannot hold one' using errcode = '22023'; end if;
    if exists (select 1 from public.club_meeting_proxies q where q.meeting_id = p_meeting and q.holder_membership_id = v_mem.id and q.status = 'active') then
      raise exception 'you hold another member''s proxy, so you cannot give yours away' using errcode = '22023'; end if;
    if v_active.id is not null and v_active.holder_membership_id = v_holder.id then
      null;   -- same holder again: the existing authorization stands
    else
      if v_active.id is not null then
        update public.club_meeting_proxies set status = 'replaced', ended_at = now(), ended_by = v_uid, end_reason = 'replaced by a new proxy' where id = v_active.id;
      end if;
      v_text := 'I authorize ' || v_holder.full_name || ' to act as my proxy for the ' || to_char(mt.starts_at at time zone mt.timezone, 'FMMonth FMDD, YYYY')
        || ' ' || (select t.name from public.teams t where t.id = mt.team_id) || ' ' || upper(mt.kind) || '.';
      insert into public.club_meeting_proxies (meeting_id, grantor_membership_id, holder_membership_id, authorization_text, authorized_by)
        values (p_meeting, v_mem.id, v_holder.id, v_text, v_uid);
      perform private.audit(null, 'club.proxy_authorized', p_meeting::text, jsonb_build_object('grantor', v_mem.id, 'holder', v_holder.id));
    end if;
  elsif v_active.id is not null then
    update public.club_meeting_proxies set status = 'cancelled', ended_at = now(), ended_by = v_uid, end_reason = 'participation changed' where id = v_active.id;
    perform private.audit(null, 'club.proxy_cancelled', p_meeting::text, jsonb_build_object('grantor', v_mem.id));
  end if;

  select * into v_old from public.club_meeting_rsvps where meeting_id = p_meeting and membership_id = v_mem.id for update;
  if v_old.membership_id is null then
    insert into public.club_meeting_rsvps (meeting_id, membership_id, response) values (p_meeting, v_mem.id, p_response);
  elsif v_old.response is distinct from p_response then
    update public.club_meeting_rsvps set response = p_response, responded_at = now() where meeting_id = p_meeting and membership_id = v_mem.id;
  end if;
  if v_old.response is distinct from p_response then
    insert into public.club_meeting_rsvp_history (meeting_id, membership_id, previous_response, new_response, changed_by)
      values (p_meeting, v_mem.id, v_old.response, p_response, v_uid);
  end if;
end $$;

-- Cancel my proxy without choosing another way to take part yet (my answer goes back to "no response").
create or replace function public.cancel_club_meeting_proxy(p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem uuid; v_active public.club_meeting_proxies; v_old text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  v_mem := private.club_meeting_my_membership(p_meeting);
  if v_mem is null then raise exception 'only members can register' using errcode = '42501'; end if;
  if now() >= mt.starts_at then raise exception 'the meeting has started: ask the club executive to record a change' using errcode = '22023'; end if;
  select * into v_active from public.club_meeting_proxies where meeting_id = p_meeting and grantor_membership_id = v_mem and status = 'active' for update;
  if v_active.id is null then raise exception 'you have no proxy to cancel' using errcode = 'P0002'; end if;
  update public.club_meeting_proxies set status = 'cancelled', ended_at = now(), ended_by = v_uid, end_reason = 'cancelled by the member' where id = v_active.id;
  select response into v_old from public.club_meeting_rsvps where meeting_id = p_meeting and membership_id = v_mem for update;
  update public.club_meeting_rsvps set response = null, responded_at = now() where meeting_id = p_meeting and membership_id = v_mem;
  insert into public.club_meeting_rsvp_history (meeting_id, membership_id, previous_response, new_response, changed_by) values (p_meeting, v_mem, v_old, null, v_uid);
  perform private.audit(null, 'club.proxy_cancelled', p_meeting::text, jsonb_build_object('grantor', v_mem));
end $$;

-- ---------------------------------------------------------------- executive: dashboard, proxies, check-in, video link, saved records
create or replace function private.club_meeting_team(p_meeting uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select team_id from public.club_meetings where id = p_meeting $$;
revoke execute on function private.club_meeting_team(uuid) from public, anon, authenticated;

-- Every membership record of the meeting's year with eligibility (on the meeting day), fee status, RSVP, proxy, proxies held and check-in.
create or replace function public.club_meeting_dashboard(p_meeting uuid)
returns table (membership_id uuid, full_name text, membership_status text, eligible boolean, reasons text[], dues_status text, fee_waived boolean,
  response text, responded_at timestamptz, proxy_holder_name text, proxy_problem text, valid_proxies_held int, proxies_held_names text[],
  attendance text, attendance_recorded_by text, attendance_recorded_at timestamptz, eligible_at_checkin boolean, offices text[])
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings; v_day date;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see the AGM list' using errcode = '42501'; end if;
  v_day := private.club_meeting_day(p_meeting);
  return query
  select cm.id, cm.full_name, cm.status, c.eligible, c.reasons, coalesce(d.status, 'unpaid'), y.fee_waived,
         r.response, r.responded_at,
         (select h.full_name from public.club_meeting_proxies p join public.club_memberships h on h.id = p.holder_membership_id
            where p.meeting_id = p_meeting and p.grantor_membership_id = cm.id and p.status = 'active'),
         (select private.club_proxy_problem(p.id) from public.club_meeting_proxies p where p.meeting_id = p_meeting and p.grantor_membership_id = cm.id and p.status = 'active'),
         (select count(*)::int from public.club_meeting_proxies p where p.meeting_id = p_meeting and p.holder_membership_id = cm.id and p.status = 'active'
            and private.club_proxy_problem(p.id) is null),
         coalesce((select array_agg(g.full_name order by g.full_name) from public.club_meeting_proxies p join public.club_memberships g on g.id = p.grantor_membership_id
            where p.meeting_id = p_meeting and p.holder_membership_id = cm.id and p.status = 'active'), '{}'),
         a.status, a.recorded_by_name, a.recorded_at, a.eligible_at_checkin,
         coalesce((select array_agg(private.office_label(o.office) order by o.office) from public.team_officers o
                   where o.team_id = mt.team_id and o.user_id = cm.user_id and o.ended_on is null and o.started_on <= current_date), '{}')
  from public.club_memberships cm
  join public.club_membership_years y on y.team_id = cm.team_id and y.year = cm.membership_year
  left join public.club_dues d on d.membership_id = cm.id
  left join public.club_meeting_rsvps r on r.meeting_id = p_meeting and r.membership_id = cm.id
  left join public.club_meeting_attendance a on a.meeting_id = p_meeting and a.membership_id = cm.id
  cross join lateral private.club_vote_check(cm.id, v_day) c
  where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year
  order by lower(cm.full_name), cm.id;
end $$;

create or replace function public.club_meeting_proxy_list(p_meeting uuid)
returns table (proxy_id uuid, grantor_membership_id uuid, grantor_name text, grantor_eligible boolean, holder_membership_id uuid, holder_name text,
  holder_eligible boolean, status text, valid boolean, problem text, authorization_text text, authorized_at timestamptz, ended_at timestamptz, end_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings; v_day date;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see proxies' using errcode = '42501'; end if;
  v_day := private.club_meeting_day(p_meeting);
  return query
  select p.id, g.id, g.full_name, (select c.eligible from private.club_vote_check(g.id, v_day) c), h.id, h.full_name,
         (select c.eligible from private.club_vote_check(h.id, v_day) c), p.status, private.club_proxy_problem(p.id) is null, private.club_proxy_problem(p.id),
         p.authorization_text, p.authorized_at, p.ended_at, p.end_reason
  from public.club_meeting_proxies p
  join public.club_memberships g on g.id = p.grantor_membership_id
  join public.club_memberships h on h.id = p.holder_membership_id
  where p.meeting_id = p_meeting
  order by (p.status = 'active') desc, lower(h.full_name), lower(g.full_name), p.authorized_at desc;
end $$;

-- Check-in on the day: President, Secretary or Treasurer. Never touches the RSVP. Eligibility at that moment is kept with the record.
create or replace function public.set_club_meeting_attendance(p_meeting uuid, p_membership uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_old public.club_meeting_attendance; v_ok boolean; v_reasons text[]; v_name text;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if v_uid is null or not private.can_change_club_dues(mt.team_id) then
    raise exception 'only the club''s President, Secretary or Treasurer can record attendance' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('present_in_person', 'present_video', 'absent') then raise exception 'unknown attendance' using errcode = '22023'; end if;
  select * into v_mem from public.club_memberships where id = p_membership;
  if v_mem.id is null or v_mem.team_id <> mt.team_id or v_mem.membership_year <> mt.membership_year then raise exception 'not a member for this meeting' using errcode = '22023'; end if;
  select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, private.club_meeting_day(p_meeting)) c;
  v_name := coalesce(private.person_name(v_uid), 'Unnamed account');
  select * into v_old from public.club_meeting_attendance where meeting_id = p_meeting and membership_id = p_membership for update;
  if v_old.membership_id is not null and v_old.status = p_status then raise exception 'nothing changed' using errcode = '22023'; end if;
  insert into public.club_meeting_attendance (meeting_id, membership_id, status, recorded_by, recorded_by_name, recorded_at, membership_status_at_checkin, eligible_at_checkin, reasons_at_checkin)
    values (p_meeting, p_membership, p_status, v_uid, v_name, now(), v_mem.status, v_ok, v_reasons)
    on conflict (meeting_id, membership_id) do update set status = excluded.status, recorded_by = excluded.recorded_by, recorded_by_name = excluded.recorded_by_name,
      recorded_at = excluded.recorded_at, membership_status_at_checkin = excluded.membership_status_at_checkin, eligible_at_checkin = excluded.eligible_at_checkin,
      reasons_at_checkin = excluded.reasons_at_checkin;
  insert into public.club_meeting_attendance_history (meeting_id, membership_id, previous_status, new_status, recorded_by, recorded_by_name, eligible_at_checkin)
    values (p_meeting, p_membership, v_old.status, p_status, v_uid, v_name, v_ok);
end $$;

create or replace function public.set_club_meeting_video(p_meeting uuid, p_link text, p_details text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings; v_link text := nullif(btrim(coalesce(p_link, '')), ''); v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_change_club_dues(mt.team_id) then
    raise exception 'only the club''s President, Secretary or Treasurer can set the video link' using errcode = '42501'; end if;
  if v_link is not null and (char_length(v_link) > 500 or v_link !~ '^https://[^[:space:]]+$') then raise exception 'the video link must start with https://' using errcode = '22023'; end if;
  if v_details is not null and char_length(v_details) > 500 then raise exception 'keep the details under 500 characters' using errcode = '22023'; end if;
  update public.club_meetings set video_link = v_link, video_details = v_details where id = p_meeting;
  perform private.audit(null, 'club.meeting_video_set', p_meeting::text, jsonb_build_object('has_link', v_link is not null));
end $$;

-- Save the official AGM record: a frozen copy of the voter list, attendance and proxies. Later membership changes do not alter it.
create or replace function public.record_club_meeting_snapshot(p_meeting uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_id bigint; v_snap jsonb;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if v_uid is null or not private.can_change_club_dues(mt.team_id) then
    raise exception 'only the club''s President, Secretary or Treasurer can save the AGM record' using errcode = '42501'; end if;
  v_snap := jsonb_build_object(
    'meeting', jsonb_build_object('title', mt.title, 'starts_at', mt.starts_at, 'timezone', mt.timezone, 'year', mt.membership_year),
    'members', coalesce((select jsonb_agg(to_jsonb(d)) from public.club_meeting_dashboard(p_meeting) d), '[]'::jsonb),
    'proxies', coalesce((select jsonb_agg(to_jsonb(p)) from public.club_meeting_proxy_list(p_meeting) p where p.status = 'active'), '[]'::jsonb));
  insert into public.club_meeting_records (meeting_id, recorded_by, recorded_by_name, snapshot)
    values (p_meeting, v_uid, coalesce(private.person_name(v_uid), 'Unnamed account'), v_snap) returning id into v_id;
  perform private.audit(null, 'club.meeting_record_saved', p_meeting::text, jsonb_build_object('record', v_id));
  return v_id;
end $$;

create or replace function public.club_meeting_records(p_meeting uuid)
returns table (id bigint, recorded_at timestamptz, recorded_by_name text, snapshot jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where club_meetings.id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see AGM records' using errcode = '42501'; end if;
  return query select r.id, r.recorded_at, r.recorded_by_name, r.snapshot from public.club_meeting_records r where r.meeting_id = p_meeting order by r.recorded_at desc;
end $$;

-- The executive's view of the video link (to edit it).
create or replace function public.club_meeting_admin_info(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see this' using errcode = '42501'; end if;
  return jsonb_build_object('video_link', mt.video_link, 'video_details', mt.video_details, 'can_manage', private.can_change_club_dues(mt.team_id));
end $$;

revoke execute on function
  public.club_meeting_member_view(uuid), public.set_club_meeting_rsvp(uuid, text, uuid, boolean), public.cancel_club_meeting_proxy(uuid),
  public.club_meeting_dashboard(uuid), public.club_meeting_proxy_list(uuid), public.set_club_meeting_attendance(uuid, uuid, text),
  public.set_club_meeting_video(uuid, text, text), public.record_club_meeting_snapshot(uuid), public.club_meeting_records(uuid), public.club_meeting_admin_info(uuid)
from public, anon;
grant execute on function
  public.club_meeting_member_view(uuid), public.set_club_meeting_rsvp(uuid, text, uuid, boolean), public.cancel_club_meeting_proxy(uuid),
  public.club_meeting_dashboard(uuid), public.club_meeting_proxy_list(uuid), public.set_club_meeting_attendance(uuid, uuid, text),
  public.set_club_meeting_video(uuid, text, text), public.record_club_meeting_snapshot(uuid), public.club_meeting_records(uuid), public.club_meeting_admin_info(uuid)
to authenticated;

-- ---------------------------------------------------------------- the Red Deer Reavers 2026 AGM
-- Sunday, October 18, 2026, 5:30 PM in Edmonton time; place as already published on the club website. No video link yet (the executive sets it).
insert into public.club_meetings (team_id, membership_year, kind, title, starts_at, timezone, location)
select t.id, 2026, 'agm', 'Red Deer Reavers 2026 AGM', timestamp '2026-10-18 17:30' at time zone 'America/Edmonton', 'America/Edmonton', 'Alister''s home'
from public.teams t
where t.slug = 'red-deer-reavers' and exists (select 1 from public.club_membership_years y where y.team_id = t.id and y.year = 2026)
on conflict (team_id, kind, membership_year) do nothing;
