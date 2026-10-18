-- Red Deer Reavers members area: meetings become reusable (owner request 2026-10-17: "it will be used for dozens of meetings and anytime
-- we need to vote for stuff"). Additive. Extends the club meeting system instead of adding a parallel one.
--
--   * club_meetings.kind: 'agm' (one per membership year), 'general' (any members' meeting), 'leadership' (usually invite-only),
--     'vote' (a voting session with no gathering: questions open and close on their own schedule). 'special' stays allowed for history;
--     the one existing 'special' row (the 2026 Pre-AGM Leadership Meeting, invited-only) becomes 'leadership' + invite_only here.
--   * New columns: details (agenda / description shown to members), ends_at, invite_only, created_by, cancelled_at / cancelled_by.
--     A cancelled meeting is kept with its RSVPs, topics, questions and ballots: nothing is deleted.
--   * club_meetings_list(team): every meeting the signed-in person may see (public ones; invite-only ones for invitees and the executive),
--     with their own RSVP, check-in and the number of open questions still waiting for their ballot. The page's Home and Meetings read this.
--   * club_meeting_view(meeting): one meeting by id, the same shape as club_meeting_member_view (RSVP, proxy, eligibility, video link)
--     plus kind, details, attendees (invite-only meetings) and the agenda. Existing AGM links (members.html?view=agm) keep working
--     through club_meeting_member_view, which is unchanged.
--   * create_club_meeting / update_club_meeting / cancel_club_meeting / set_club_meeting_invitees: President, Secretary or Treasurer only.
--   * club_leadership_meeting() now finds kind 'leadership' as well as 'special'; the Discord RSVP alert names the meeting and links to it.
--
-- Everything that already decides who may RSVP, hold a proxy, nominate, run or cast a vote is untouched: those functions take a meeting id
-- and never cared which kind it was. Ballot secrecy, eligibility rules and the append-only histories are unchanged.

-- ---------------------------------------------------------------- 1. club_meetings
alter table public.club_meetings drop constraint if exists club_meetings_kind_check;
alter table public.club_meetings add constraint club_meetings_kind_check check (kind in ('agm', 'special', 'general', 'leadership', 'vote'));
-- one AGM per year stays a rule; every other kind may repeat within a year
alter table public.club_meetings drop constraint if exists club_meetings_team_id_kind_membership_year_key;
create unique index if not exists club_meetings_one_agm_per_year on public.club_meetings (team_id, membership_year) where kind = 'agm';
alter table public.club_meetings
  add column if not exists details text,
  add column if not exists ends_at timestamptz,
  add column if not exists invite_only boolean not null default false,
  add column if not exists created_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid;
alter table public.club_meetings drop constraint if exists club_meetings_details_check;
alter table public.club_meetings add constraint club_meetings_details_check check (details is null or char_length(details) <= 4000);
alter table public.club_meetings drop constraint if exists club_meetings_ends_after_start;
alter table public.club_meetings add constraint club_meetings_ends_after_start check (ends_at is null or ends_at > starts_at);
create index if not exists club_meetings_team_starts_idx on public.club_meetings (team_id, starts_at);
comment on column public.club_meetings.kind is 'agm (one per year), general, leadership, vote (a voting session without a gathering); special = historical name for leadership';
comment on column public.club_meetings.invite_only is 'Shown only to the memberships in club_meeting_invitees (and the executive)';

-- in-flight state on hosted: the Pre-AGM Leadership Meeting was stored as ''special'' with an invite list
update public.club_meetings set kind = 'leadership' where kind = 'special';
update public.club_meetings m set invite_only = true
  where not m.invite_only and exists (select 1 from public.club_meeting_invitees i where i.meeting_id = m.id);

-- ---------------------------------------------------------------- 2. helpers
create or replace function private.club_meeting_can_see(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.club_meetings m
    where m.id = p_meeting
      and (private.can_view_club_roster(m.team_id)
           or not m.invite_only
           or exists (select 1 from public.club_meeting_invitees i where i.meeting_id = m.id and i.membership_id = private.club_meeting_my_membership(m.id))))
$$;

create or replace function private.club_meeting_json(mt public.club_meetings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', mt.id, 'kind', case when mt.kind = 'special' then 'leadership' else mt.kind end, 'title', mt.title, 'details', mt.details,
    'starts_at', mt.starts_at, 'ends_at', mt.ends_at, 'timezone', mt.timezone, 'location', mt.location,
    'year', mt.membership_year, 'started', now() >= mt.starts_at, 'invite_only', mt.invite_only, 'cancelled', mt.cancelled_at is not null,
    'local_date', to_char(mt.starts_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY'),
    'local_time', to_char(mt.starts_at at time zone mt.timezone, 'FMHH12:MI AM'),
    'local_end_time', case when mt.ends_at is null then null else to_char(mt.ends_at at time zone mt.timezone, 'FMHH12:MI AM') end,
    'local_end_date', case when mt.ends_at is null then null else to_char(mt.ends_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY') end)
$$;

-- ---------------------------------------------------------------- 3. the member's reads
create or replace function public.club_meetings_list(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_exec boolean; v_manage boolean; mt public.club_meetings; v_mem public.club_memberships; v_ok boolean; v_gave boolean;
  v_rsvp text; v_att text; v_open int; v_to_vote int; v_invited boolean; out_rows jsonb := '[]'::jsonb; v_day date;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  v_exec := private.can_view_club_roster(p_team); v_manage := private.can_change_club_dues(p_team);
  for mt in select * from public.club_meetings m where m.team_id = p_team order by m.starts_at loop
    select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(mt.id);
    v_invited := v_mem.id is not null and exists (select 1 from public.club_meeting_invitees i where i.meeting_id = mt.id and i.membership_id = v_mem.id);
    if mt.invite_only and not v_exec and not v_invited then continue; end if;
    v_day := private.club_meeting_day(mt.id); v_rsvp := null; v_att := null; v_ok := false; v_gave := false; v_to_vote := 0;
    if v_mem.id is not null then
      select r.response into v_rsvp from public.club_meeting_rsvps r where r.meeting_id = mt.id and r.membership_id = v_mem.id;
      select a.status into v_att from public.club_meeting_attendance a where a.meeting_id = mt.id and a.membership_id = v_mem.id;
      select c.eligible into v_ok from private.club_vote_check(v_mem.id, v_day) c;
      v_gave := exists (select 1 from public.club_meeting_proxies p where p.meeting_id = mt.id and p.grantor_membership_id = v_mem.id and p.status = 'active');
    end if;
    select count(*) into v_open from public.club_meeting_questions q where q.meeting_id = mt.id and q.status = 'open';
    if v_mem.id is not null and v_open > 0 then
      select count(*) into v_to_vote from public.club_meeting_questions q where q.meeting_id = mt.id and q.status = 'open' and (
        (coalesce(v_ok, false) and not v_gave and not exists (select 1 from public.club_meeting_ballots b where b.question_id = q.id and b.voter_membership_id = v_mem.id))
        or exists (select 1 from public.club_meeting_proxies p where p.meeting_id = mt.id and p.holder_membership_id = v_mem.id and p.status = 'active'
                   and private.club_proxy_problem(p.id) is null
                   and not exists (select 1 from public.club_meeting_ballots b where b.question_id = q.id and b.voter_membership_id = p.grantor_membership_id)));
    end if;
    out_rows := out_rows || (private.club_meeting_json(mt) || jsonb_build_object(
      'my_rsvp', v_rsvp, 'my_attendance', v_att, 'invited', v_invited, 'is_member', v_mem.id is not null,
      'open_questions', v_open, 'to_vote', v_to_vote,
      'closed_questions', (select count(*) from public.club_meeting_questions q where q.meeting_id = mt.id and q.status = 'closed'),
      'invitee_count', case when mt.invite_only then (select count(*) from public.club_meeting_invitees i where i.meeting_id = mt.id) end));
  end loop;
  return jsonb_build_object('meetings', out_rows, 'can_view_admin', v_exec, 'can_manage', v_manage);
end $$;
comment on function public.club_meetings_list(uuid) is 'Every club meeting the signed-in person may see, with their own RSVP, check-in and open questions awaiting their ballot.';
revoke all on function public.club_meetings_list(uuid) from public, anon;
grant execute on function public.club_meetings_list(uuid) to authenticated;

create or replace function public.club_meeting_view(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_day date; v_fee boolean; v_ok boolean; v_reasons text[];
  v_rsvp public.club_meeting_rsvps; v_proxy public.club_meeting_proxies; v_officer boolean; v_att public.club_meeting_attendance;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if not private.club_meeting_can_see(mt.id) then raise exception 'this meeting is for invited members only' using errcode = '42501'; end if;
  v_day := private.club_meeting_day(mt.id);
  v_officer := private.can_view_club_roster(mt.team_id);
  select fee_waived into v_fee from public.club_membership_years where team_id = mt.team_id and year = mt.membership_year;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(mt.id);
  if v_mem.id is not null then
    select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, v_day) c;
    select * into v_rsvp from public.club_meeting_rsvps where meeting_id = mt.id and membership_id = v_mem.id;
    select * into v_proxy from public.club_meeting_proxies where meeting_id = mt.id and grantor_membership_id = v_mem.id and status = 'active';
    select * into v_att from public.club_meeting_attendance where meeting_id = mt.id and membership_id = v_mem.id;
  end if;
  return jsonb_build_object(
    'meeting', private.club_meeting_json(mt),
    'fee_waived', coalesce(v_fee, false),
    'membership', case when v_mem.id is null then null else jsonb_build_object('id', v_mem.id, 'status', v_mem.status, 'full_name', v_mem.full_name,
       'dues_status', coalesce((select d.status from public.club_dues d where d.membership_id = v_mem.id), 'unpaid')) end,
    'eligible', coalesce(v_ok, false), 'reasons', to_jsonb(coalesce(v_reasons, '{}')),
    'rsvp', case when v_rsvp.membership_id is null then null else jsonb_build_object('response', v_rsvp.response, 'responded_at', v_rsvp.responded_at) end,
    'my_attendance', v_att.status,
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
    'invited', v_mem.id is not null and exists (select 1 from public.club_meeting_invitees i where i.meeting_id = mt.id and i.membership_id = v_mem.id),
    -- invite-only meetings show who is invited and who has arrived (the leadership meeting did this already)
    'attendees', case when not mt.invite_only then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('membership_id', cm.id, 'name', cm.full_name,
        'offices', coalesce((select jsonb_agg(private.office_label(o.office) order by o.office) from public.team_officers o
                             where o.team_id = mt.team_id and o.user_id = cm.user_id and o.ended_on is null and o.started_on <= current_date), '[]'::jsonb),
        'attendance', a.status, 'recorded_at', a.recorded_at) order by lower(cm.full_name))
      from public.club_meeting_invitees i join public.club_memberships cm on cm.id = i.membership_id
      left join public.club_meeting_attendance a on a.meeting_id = mt.id and a.membership_id = cm.id
      where i.meeting_id = mt.id), '[]'::jsonb) end,
    -- the agenda: topics the executive put on it (every submitted topic for an invite-only meeting, as before). Members and the executive
    -- only (a signed-in person who is not a member sees the meeting, not what members submitted), and never the submitter's name.
    'agenda', case when v_mem.id is null and not v_officer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'details', t.details, 'status', t.status) order by t.created_at, t.id)
      from public.club_meeting_topics t where t.meeting_id = mt.id
        and (case when mt.invite_only then t.status <> 'withdrawn' else t.status in ('on_agenda', 'addressed') end)), '[]'::jsonb) end,
    'can_view_admin', v_officer,
    'can_manage', private.can_change_club_dues(mt.team_id));
end $$;
comment on function public.club_meeting_view(uuid) is 'One club meeting for the signed-in person: details, their RSVP, proxy, eligibility, video link, attendees (invite-only) and agenda.';
revoke all on function public.club_meeting_view(uuid) from public, anon;
grant execute on function public.club_meeting_view(uuid) to authenticated;

-- the leadership meeting read (kept for members.html?view=leadership links) now finds the renamed kind too
create or replace function public.club_leadership_meeting(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where team_id = p_team and kind in ('special', 'leadership') and cancelled_at is null
    order by (starts_at >= now() - interval '1 day') desc, case when starts_at >= now() - interval '1 day' then starts_at end asc, starts_at desc limit 1;
  if not found then return jsonb_build_object('meeting', null); end if;
  v_mem := private.club_meeting_my_membership(mt.id);
  if v_mem is null or not exists (select 1 from public.club_meeting_invitees i where i.meeting_id = mt.id and i.membership_id = v_mem) then
    return jsonb_build_object('meeting', null);
  end if;
  return jsonb_build_object(
    'meeting', private.club_meeting_json(mt) || jsonb_build_object('notes_link', mt.video_link, 'notes_label', mt.video_details),
    'can_manage', private.can_change_club_dues(p_team),
    'my_membership_id', v_mem,
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('membership_id', cm.id, 'name', cm.full_name,
        'offices', coalesce((select jsonb_agg(private.office_label(o.office) order by o.office) from public.team_officers o
                             where o.team_id = mt.team_id and o.user_id = cm.user_id and o.ended_on is null and o.started_on <= current_date), '[]'::jsonb),
        'attendance', a.status, 'recorded_at', a.recorded_at) order by lower(cm.full_name))
      from public.club_meeting_invitees i join public.club_memberships cm on cm.id = i.membership_id
      left join public.club_meeting_attendance a on a.meeting_id = mt.id and a.membership_id = cm.id
      where i.meeting_id = mt.id), '[]'::jsonb),
    'agenda', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'details', t.details, 'status', t.status) order by t.created_at, t.id)
      from public.club_meeting_topics t where t.meeting_id = mt.id and t.status <> 'withdrawn'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- 4. the executive: create, change, cancel, invite
create or replace function private.club_meeting_check_fields(p_kind text, p_title text, p_starts_at timestamptz, p_timezone text, p_location text, p_details text, p_ends_at timestamptz) returns void
language plpgsql stable set search_path = '' as $$
declare v_probe timestamp;
begin
  if p_kind not in ('agm', 'general', 'leadership', 'vote') then raise exception 'a meeting is an AGM, a general meeting, a leadership meeting or a vote' using errcode = '22023'; end if;
  if p_title is null or char_length(btrim(p_title)) < 3 or char_length(btrim(p_title)) > 120 then raise exception 'give the meeting a title (3 to 120 characters)' using errcode = '22023'; end if;
  if p_starts_at is null then raise exception 'when does it start?' using errcode = '22023'; end if;
  if p_timezone is null or btrim(p_timezone) = '' then raise exception 'choose a time zone' using errcode = '22023'; end if;
  begin v_probe := p_starts_at at time zone p_timezone; exception when others then raise exception 'that time zone is not known' using errcode = '22023'; end;
  if p_location is not null and char_length(p_location) > 200 then raise exception 'keep the location under 200 characters' using errcode = '22023'; end if;
  if p_details is not null and char_length(p_details) > 4000 then raise exception 'keep the details under 4000 characters' using errcode = '22023'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'the end must come after the start' using errcode = '22023'; end if;
end $$;

create or replace function public.create_club_meeting(p_team uuid, p_kind text, p_title text, p_starts_at timestamptz, p_timezone text default 'America/Edmonton',
  p_location text default null, p_details text default null, p_invite_only boolean default false, p_ends_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_year int; v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_loc text := nullif(btrim(coalesce(p_location, '')), ''); v_det text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if auth.uid() is null or not private.can_change_club_dues(p_team) then raise exception 'only the club''s President, Secretary or Treasurer can create a meeting' using errcode = '42501'; end if;
  perform private.club_meeting_check_fields(p_kind, v_title, p_starts_at, p_timezone, v_loc, v_det, p_ends_at);
  -- the membership year the meeting falls in (its RSVPs, proxies and ballots belong to that year's memberships)
  select y.year into v_year from public.club_membership_years y where y.team_id = p_team and (p_starts_at at time zone p_timezone)::date between y.starts_on and y.ends_on order by y.year desc limit 1;
  if v_year is null then select max(y.year) into v_year from public.club_membership_years y where y.team_id = p_team and y.starts_on <= (p_starts_at at time zone p_timezone)::date; end if;
  if v_year is null then select min(y.year) into v_year from public.club_membership_years y where y.team_id = p_team; end if;
  if v_year is null then raise exception 'set up a membership year first' using errcode = '22023'; end if;
  if p_kind = 'agm' and exists (select 1 from public.club_meetings m where m.team_id = p_team and m.kind = 'agm' and m.membership_year = v_year) then
    raise exception 'the % AGM already exists: open it from the meetings list', v_year using errcode = '23505'; end if;
  insert into public.club_meetings (team_id, membership_year, kind, title, starts_at, ends_at, timezone, location, details, invite_only, created_by)
    values (p_team, v_year, p_kind, v_title, p_starts_at, p_ends_at, p_timezone, v_loc, v_det, coalesce(p_invite_only, false), auth.uid())
    returning id into v_id;
  perform private.audit(null, 'club.meeting_created', v_id::text, jsonb_build_object('team', p_team, 'kind', p_kind, 'title', v_title, 'starts_at', p_starts_at, 'year', v_year, 'invite_only', coalesce(p_invite_only, false)));
  return v_id;
end $$;
comment on function public.create_club_meeting(uuid, text, text, timestamptz, text, text, text, boolean, timestamptz) is 'President, Secretary or Treasurer: schedule a club meeting or voting session.';
revoke all on function public.create_club_meeting(uuid, text, text, timestamptz, text, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.create_club_meeting(uuid, text, text, timestamptz, text, text, text, boolean, timestamptz) to authenticated;

create or replace function public.update_club_meeting(p_meeting uuid, p_title text, p_starts_at timestamptz, p_timezone text default 'America/Edmonton',
  p_location text default null, p_details text default null, p_invite_only boolean default false, p_ends_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings; v_title text := btrim(coalesce(p_title, '')); v_loc text := nullif(btrim(coalesce(p_location, '')), ''); v_det text := nullif(btrim(coalesce(p_details, '')), '');
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_change_club_dues(mt.team_id) then raise exception 'only the club''s President, Secretary or Treasurer can change a meeting' using errcode = '42501'; end if;
  perform private.club_meeting_check_fields(case when mt.kind = 'special' then 'leadership' else mt.kind end, v_title, p_starts_at, p_timezone, v_loc, v_det, p_ends_at);
  if (p_starts_at at time zone p_timezone)::date <> private.club_meeting_day(mt.id)
     and exists (select 1 from public.club_meeting_questions q where q.meeting_id = mt.id and q.status <> 'draft') then
    raise exception 'the day cannot change once a vote has opened: eligibility was counted on that day' using errcode = '22023'; end if;
  update public.club_meetings set title = v_title, starts_at = p_starts_at, ends_at = p_ends_at, timezone = p_timezone, location = v_loc, details = v_det,
    invite_only = coalesce(p_invite_only, false) where id = p_meeting;
  perform private.audit(null, 'club.meeting_updated', p_meeting::text, jsonb_build_object(
    'before', jsonb_build_object('title', mt.title, 'starts_at', mt.starts_at, 'ends_at', mt.ends_at, 'timezone', mt.timezone, 'location', mt.location, 'invite_only', mt.invite_only, 'details', mt.details),
    'after', jsonb_build_object('title', v_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'timezone', p_timezone, 'location', v_loc, 'invite_only', coalesce(p_invite_only, false), 'details', v_det)));
end $$;
comment on function public.update_club_meeting(uuid, text, timestamptz, text, text, text, boolean, timestamptz) is 'President, Secretary or Treasurer: change a meeting''s title, time, place, details or invite-only flag. The kind never changes.';
revoke all on function public.update_club_meeting(uuid, text, timestamptz, text, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.update_club_meeting(uuid, text, timestamptz, text, text, text, boolean, timestamptz) to authenticated;

create or replace function public.cancel_club_meeting(p_meeting uuid, p_cancelled boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_change_club_dues(mt.team_id) then raise exception 'only the club''s President, Secretary or Treasurer can cancel a meeting' using errcode = '42501'; end if;
  if coalesce(p_cancelled, true) and exists (select 1 from public.club_meeting_questions q where q.meeting_id = mt.id and q.status = 'open') then
    raise exception 'close the open vote before cancelling this meeting' using errcode = '22023'; end if;
  update public.club_meetings set cancelled_at = case when coalesce(p_cancelled, true) then coalesce(cancelled_at, now()) end,
    cancelled_by = case when coalesce(p_cancelled, true) then coalesce(cancelled_by, auth.uid()) end where id = p_meeting;
  perform private.audit(null, case when coalesce(p_cancelled, true) then 'club.meeting_cancelled' else 'club.meeting_restored' end, p_meeting::text, jsonb_build_object('title', mt.title));
end $$;
comment on function public.cancel_club_meeting(uuid, boolean) is 'President, Secretary or Treasurer: cancel (or restore) a meeting. Its records are kept.';
revoke all on function public.cancel_club_meeting(uuid, boolean) from public, anon;
grant execute on function public.cancel_club_meeting(uuid, boolean) to authenticated;

create or replace function public.set_club_meeting_invitees(p_meeting uuid, p_memberships uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings; v_bad int; v_added int; v_removed int;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_change_club_dues(mt.team_id) then raise exception 'only the club''s President, Secretary or Treasurer can change the invite list' using errcode = '42501'; end if;
  select count(*) into v_bad from unnest(coalesce(p_memberships, '{}')) x(id)
    where not exists (select 1 from public.club_memberships cm where cm.id = x.id and cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and cm.status <> 'removed');
  if v_bad > 0 then raise exception 'only this club''s current members can be invited' using errcode = '22023'; end if;
  with gone as (delete from public.club_meeting_invitees i where i.meeting_id = p_meeting and not (i.membership_id = any (coalesce(p_memberships, '{}'))) returning 1)
    select count(*) into v_removed from gone;
  with added as (insert into public.club_meeting_invitees (meeting_id, membership_id) select p_meeting, x.id from unnest(coalesce(p_memberships, '{}')) x(id) on conflict do nothing returning 1)
    select count(*) into v_added from added;
  perform private.audit(null, 'club.meeting_invitees_set', p_meeting::text, jsonb_build_object('invited', coalesce(array_length(p_memberships, 1), 0), 'added', v_added, 'removed', v_removed));
end $$;
comment on function public.set_club_meeting_invitees(uuid, uuid[]) is 'President, Secretary or Treasurer: replace the invite list of a meeting with these memberships.';
revoke all on function public.set_club_meeting_invitees(uuid, uuid[]) from public, anon;
grant execute on function public.set_club_meeting_invitees(uuid, uuid[]) to authenticated;

-- the executive's roster read of a meeting's invite list (membership ids, so the picker can be pre-ticked)
create or replace function public.club_meeting_invitee_ids(p_meeting uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see this' using errcode = '42501'; end if;
  return coalesce((select array_agg(i.membership_id) from public.club_meeting_invitees i where i.meeting_id = p_meeting), '{}');
end $$;
revoke all on function public.club_meeting_invitee_ids(uuid) from public, anon;
grant execute on function public.club_meeting_invitee_ids(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. Discord: the RSVP alert names the meeting and links to it
create or replace function private.reavers_discord_rsvp_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_webhook text;
  v_member text;
  v_holder text;
  v_team public.teams;
  v_meeting public.club_meetings;
  v_response text;
  v_fields jsonb;
  v_body jsonb;
  v_url text;
begin
  if tg_op = 'UPDATE' and old.response is not distinct from new.response then
    return new;
  end if;

  select * into v_meeting from public.club_meetings where id = new.meeting_id;
  if not found then return new; end if;

  select * into v_team from public.teams where id = v_meeting.team_id;
  if not found or v_team.slug <> 'red-deer-reavers' then return new; end if;
  if v_meeting.invite_only then return new; end if;   -- an invited-only meeting is not announced to the whole club

  select full_name into v_member from public.club_memberships where id = new.membership_id;

  if new.response = 'proxy' then
    select holder.full_name into v_holder
    from public.club_meeting_proxies p
    join public.club_memberships holder on holder.id = p.holder_membership_id
    where p.meeting_id = new.meeting_id and p.grantor_membership_id = new.membership_id and p.status = 'active'
    order by p.authorized_at desc limit 1;
  end if;

  v_response := case new.response
    when 'in_person' then 'Attending In Person'
    when 'video' then 'Attending by Video Call'
    when 'proxy' then 'Voting by Proxy'
    when 'not_attending' then 'Not Attending'
    else initcap(replace(coalesce(new.response, 'withdrawn'), '_', ' '))
  end;

  v_fields := jsonb_build_array(jsonb_build_object('name', 'RSVP', 'value', v_response, 'inline', true));
  if new.response = 'proxy' then
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('name', 'Proxy Holder', 'value', coalesce(v_holder, 'Not found'), 'inline', true));
  end if;

  select decrypted_secret into v_webhook from vault.decrypted_secrets where name = 'reavers_discord_rsvp_webhook' order by created_at desc limit 1;
  if v_webhook is null or btrim(v_webhook) = '' then return new; end if;

  v_url := case when v_meeting.kind = 'agm' then 'https://red-deer-reavers.vercel.app/members.html?view=agm'
                else 'https://red-deer-reavers.vercel.app/members.html?view=meeting&meeting=' || v_meeting.id::text end;
  v_body := jsonb_build_object(
    'username', 'Red Deer Reavers RSVP Bot',
    'content', '📋 **' || v_meeting.title || ': RSVP updated**',
    'embeds', jsonb_build_array(jsonb_build_object('title', coalesce(v_member, 'Member'), 'fields', v_fields, 'url', v_url)));

  perform net.http_post(url := v_webhook, headers := '{"Content-Type":"application/json"}'::jsonb, body := v_body);
  return new;
exception when others then
  raise warning 'Reavers Discord RSVP alert failed: %', sqlerrm;
  return new;
end
$$;
