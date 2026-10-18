-- Red Deer Reavers members area: close nominations and topics (concerns) at a set date and time (owner request 2026-10-18:
-- "Make it so you can close nominations and concerns at a set date and time"). Additive.
--
--   * club_meetings.nominations_close_at / topics_close_at: when SUBMISSIONS close (owner: "I meant to say close the submission"). After
--     the nominations time nobody can nominate; a nominee may still accept, decline or withdraw until the meeting starts. After the topics
--     time nobody can submit or edit a topic; a member may still withdraw their own until the meeting starts. NULL keeps today's rule
--     (everything closes when the meeting starts), so every meeting already on hosted behaves exactly as before until an executive sets a time.
--   * set_club_meeting_deadlines(meeting, nominations_close_at, topics_close_at): President, Secretary or Treasurer. A time in the past
--     closes at once ("close now"); NULL goes back to "when the meeting starts". Audited.
--   * submit/update topic, nominate and club_agm_member_view read the effective close time through two helpers instead of mt.starts_at;
--     withdraw topic and respond to a nomination keep "until the meeting starts". club_meeting_json carries both times so the page can show them.
--
-- Nothing already recorded changes: topics and nominations submitted earlier stay, with their histories.

-- ---------------------------------------------------------------- 1. columns
alter table public.club_meetings
  add column if not exists nominations_close_at timestamptz,
  add column if not exists topics_close_at timestamptz;
comment on column public.club_meetings.nominations_close_at is 'When executive nominations stop being accepted; NULL = when the meeting starts';
comment on column public.club_meetings.topics_close_at is 'When members stop being able to submit or edit topics (withdrawing stays open until the meeting starts); NULL = when the meeting starts';

-- ---------------------------------------------------------------- 2. helpers
create or replace function private.club_nominations_close_at(mt public.club_meetings) returns timestamptz
language sql immutable as $$ select coalesce(mt.nominations_close_at, mt.starts_at) $$;
create or replace function private.club_topics_close_at(mt public.club_meetings) returns timestamptz
language sql immutable as $$ select coalesce(mt.topics_close_at, mt.starts_at) $$;
-- "Sunday, October 18 at 5:30 PM" in the meeting's time zone (used in messages members read)
create or replace function private.club_when_text(p_at timestamptz, p_tz text) returns text
language sql stable as $$
  select to_char(p_at at time zone coalesce(p_tz, 'America/Edmonton'), 'FMDay, FMMonth FMDD') || ' at ' || to_char(p_at at time zone coalesce(p_tz, 'America/Edmonton'), 'FMHH12:MI AM')
$$;
revoke execute on function private.club_nominations_close_at(public.club_meetings), private.club_topics_close_at(public.club_meetings), private.club_when_text(timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. what the page reads
create or replace function private.club_meeting_json(mt public.club_meetings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', mt.id, 'kind', case when mt.kind = 'special' then 'leadership' else mt.kind end, 'title', mt.title, 'details', mt.details,
    'starts_at', mt.starts_at, 'ends_at', mt.ends_at, 'timezone', mt.timezone, 'location', mt.location,
    'year', mt.membership_year, 'started', now() >= mt.starts_at, 'invite_only', mt.invite_only, 'cancelled', mt.cancelled_at is not null,
    'local_date', to_char(mt.starts_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY'),
    'local_time', to_char(mt.starts_at at time zone mt.timezone, 'FMHH12:MI AM'),
    'local_end_time', case when mt.ends_at is null then null else to_char(mt.ends_at at time zone mt.timezone, 'FMHH12:MI AM') end,
    'local_end_date', case when mt.ends_at is null then null else to_char(mt.ends_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY') end,
    'nominations_close_set', mt.nominations_close_at is not null, 'nominations_close_at', private.club_nominations_close_at(mt),
    'nominations_close_text', private.club_when_text(private.club_nominations_close_at(mt), mt.timezone), 'nominations_open', now() < private.club_nominations_close_at(mt),
    'topics_close_set', mt.topics_close_at is not null, 'topics_close_at', private.club_topics_close_at(mt),
    'topics_close_text', private.club_when_text(private.club_topics_close_at(mt), mt.timezone), 'topics_open', now() < private.club_topics_close_at(mt))
$$;

-- ---------------------------------------------------------------- 4. members: the same functions, reading the set close time
create or replace function public.submit_club_agm_topic(p_meeting uuid, p_subject text, p_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_subject text := btrim(coalesce(p_subject, '')); v_details text := btrim(coalesce(p_details, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting);
  if v_mem.id is null then raise exception 'only members can submit a topic: apply for membership first' using errcode = '42501'; end if;
  if v_mem.status = 'removed' then raise exception 'your membership was removed: ask the club executive' using errcode = '42501'; end if;
  if now() >= private.club_topics_close_at(mt) then raise exception 'topics closed %: speak to the club executive', private.club_when_text(private.club_topics_close_at(mt), mt.timezone) using errcode = '22023'; end if;
  if char_length(v_subject) < 3 or char_length(v_subject) > 120 then raise exception 'give your topic a short title (3 to 120 characters)' using errcode = '22023'; end if;
  if char_length(v_details) < 1 or char_length(v_details) > 4000 then raise exception 'add some details (up to 4000 characters)' using errcode = '22023'; end if;
  insert into public.club_meeting_topics (meeting_id, membership_id, subject, details, status_changed_by) values (p_meeting, v_mem.id, v_subject, v_details, v_uid) returning id into v_id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (v_id, 'submitted', v_subject, v_details, 'submitted', v_uid);
  perform private.audit(null, 'club.agm_topic_submitted', v_id::text, jsonb_build_object('meeting', p_meeting, 'membership', v_mem.id));
  return v_id;
end $$;

-- Edit: only until topics close. Withdraw: until the meeting starts (a member may always pull their own topic before the meeting).
-- The one-argument club_my_open_topic stays (it means 'edit') so nothing that calls it changes shape.
create or replace function private.club_my_topic_for(p_topic uuid, p_action text) returns public.club_meeting_topics
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics; mt public.club_meetings;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into tp from public.club_meeting_topics where id = p_topic for update;
  if not found then raise exception 'topic not found' using errcode = 'P0002'; end if;
  if tp.membership_id is distinct from private.club_meeting_my_membership(tp.meeting_id) then raise exception 'that is not your topic' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = tp.meeting_id;
  if p_action = 'withdraw' then
    if now() >= mt.starts_at then raise exception 'the meeting has started: speak to the club executive' using errcode = '22023'; end if;
  elsif now() >= private.club_topics_close_at(mt) then raise exception 'topics closed %: speak to the club executive', private.club_when_text(private.club_topics_close_at(mt), mt.timezone) using errcode = '22023'; end if;
  if tp.status = 'withdrawn' then raise exception 'this topic was withdrawn' using errcode = '22023'; end if;
  if tp.status = 'addressed' then raise exception 'this topic has already been addressed' using errcode = '22023'; end if;
  return tp;
end $$;
create or replace function private.club_my_open_topic(p_topic uuid) returns public.club_meeting_topics
language sql security definer set search_path = '' as $$ select private.club_my_topic_for(p_topic, 'edit') $$;
revoke execute on function private.club_my_topic_for(uuid, text), private.club_my_open_topic(uuid) from public, anon, authenticated;

create or replace function public.update_club_agm_topic(p_topic uuid, p_subject text, p_details text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics; v_subject text := btrim(coalesce(p_subject, '')); v_details text := btrim(coalesce(p_details, ''));
begin
  tp := private.club_my_topic_for(p_topic, 'edit');
  if char_length(v_subject) < 3 or char_length(v_subject) > 120 then raise exception 'give your topic a short title (3 to 120 characters)' using errcode = '22023'; end if;
  if char_length(v_details) < 1 or char_length(v_details) > 4000 then raise exception 'add some details (up to 4000 characters)' using errcode = '22023'; end if;
  if v_subject = tp.subject and v_details = tp.details then return; end if;
  update public.club_meeting_topics set subject = v_subject, details = v_details, updated_at = now() where id = tp.id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (tp.id, 'edited', v_subject, v_details, tp.status, v_uid);
  perform private.audit(null, 'club.agm_topic_edited', tp.id::text, jsonb_build_object('meeting', tp.meeting_id));
end $$;

create or replace function public.withdraw_club_agm_topic(p_topic uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics;
begin
  tp := private.club_my_topic_for(p_topic, 'withdraw');
  update public.club_meeting_topics set status = 'withdrawn', updated_at = now(), status_changed_at = now(), status_changed_by = v_uid where id = tp.id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (tp.id, 'withdrawn', tp.subject, tp.details, 'withdrawn', v_uid);
  perform private.audit(null, 'club.agm_topic_withdrawn', tp.id::text, jsonb_build_object('meeting', tp.meeting_id));
end $$;

create or replace function public.nominate_for_club_office(p_meeting uuid, p_office text, p_nominee uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_nominee public.club_memberships; v_day date; nm public.club_meeting_nominations;
  v_self boolean; v_new_status text; v_action text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting);
  if v_mem.id is null then raise exception 'only voting members can nominate: apply for membership first' using errcode = '42501'; end if;
  if p_office is null or p_office not in ('president', 'secretary', 'treasurer') then raise exception 'choose President, Secretary or Treasurer' using errcode = '22023'; end if;
  if now() >= private.club_nominations_close_at(mt) then raise exception 'nominations closed %', private.club_when_text(private.club_nominations_close_at(mt), mt.timezone) using errcode = '22023'; end if;
  v_day := private.club_meeting_day(p_meeting);
  if not (select c.eligible from private.club_vote_check(v_mem.id, v_day) c) then
    raise exception 'only members who can currently vote can nominate' using errcode = '42501'; end if;
  v_self := p_nominee is null or p_nominee = v_mem.id;
  if v_self then v_nominee := v_mem;
  else
    select * into v_nominee from public.club_memberships where id = p_nominee;
    if v_nominee.id is null or v_nominee.team_id <> mt.team_id or v_nominee.membership_year <> mt.membership_year then raise exception 'that person is not a member for this meeting' using errcode = '22023'; end if;
    if not (select c.eligible from private.club_vote_check(v_nominee.id, v_day) c) then raise exception 'that member cannot currently vote, so they cannot be nominated' using errcode = '22023'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_meeting::text || p_office || v_nominee.id::text, 0));
  select * into nm from public.club_meeting_nominations
    where meeting_id = p_meeting and office = p_office and nominee_membership_id = v_nominee.id and status in ('awaiting_acceptance', 'accepted') for update;
  if nm.id is null then
    v_new_status := case when v_self then 'accepted' else 'awaiting_acceptance' end;
    insert into public.club_meeting_nominations (meeting_id, office, nominee_membership_id, status, responded_at, responded_by)
      values (p_meeting, p_office, v_nominee.id, v_new_status, case when v_self then now() end, case when v_self then v_uid end) returning * into nm;
    v_action := 'nominated';
    insert into public.club_meeting_nomination_history (nomination_id, action, previous_status, new_status, changed_by) values (nm.id, v_action, null, v_new_status, v_uid);
  elsif v_self and nm.status = 'awaiting_acceptance' then
    -- the nominee put themselves forward too: that is their answer
    update public.club_meeting_nominations set status = 'accepted', responded_at = now(), responded_by = v_uid where id = nm.id;
    insert into public.club_meeting_nomination_history (nomination_id, action, previous_status, new_status, changed_by) values (nm.id, 'accepted', 'awaiting_acceptance', 'accepted', v_uid);
    v_action := 'accepted';
  else
    v_action := 'also_nominated';
    insert into public.club_meeting_nomination_history (nomination_id, action, previous_status, new_status, changed_by) values (nm.id, v_action, nm.status, nm.status, v_uid);
  end if;
  insert into public.club_meeting_nominators (nomination_id, nominator_membership_id, nominated_by) values (nm.id, v_mem.id, v_uid) on conflict do nothing;
  perform private.audit(null, 'club.agm_nomination', nm.id::text, jsonb_build_object('meeting', p_meeting, 'office', p_office, 'nominee', v_nominee.id, 'self', v_self, 'result', v_action));
  return nm.id;
end $$;

create or replace function public.club_agm_member_view(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_day date; v_ok boolean := false; v_reasons text[] := '{}'; v_officer boolean;
  v_open boolean; v_topics_open boolean; v_nom_close timestamptz; v_top_close timestamptz; v_block text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  v_day := private.club_meeting_day(p_meeting);
  v_officer := private.can_view_club_roster(mt.team_id);
  v_nom_close := private.club_nominations_close_at(mt); v_top_close := private.club_topics_close_at(mt);
  v_open := now() < v_nom_close; v_topics_open := now() < v_top_close;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting);
  if (v_mem.id is null or v_mem.status = 'removed') and not v_officer then return jsonb_build_object('is_member', false); end if;
  if v_mem.id is not null then
    select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, v_day) c;
  end if;
  v_ok := coalesce(v_ok, false) and v_mem.id is not null and v_mem.status <> 'removed';
  v_block := case when v_mem.id is null then 'Only voting members can nominate.' when v_mem.status = 'removed' then 'Your membership was removed.'
    when not v_open then 'Nominations closed ' || private.club_when_text(v_nom_close, mt.timezone) || '.'
    when not v_ok then 'Only members who can currently vote can nominate' || case when cardinality(v_reasons) > 0 then ' (' || array_to_string(v_reasons, ', ') || ')' else '' end || '.' end;
  return jsonb_build_object(
    'is_member', v_mem.id is not null and v_mem.status <> 'removed',
    'topics_open', v_topics_open and v_mem.id is not null and v_mem.status <> 'removed',
    'topics_close_at', v_top_close, 'topics_close_text', private.club_when_text(v_top_close, mt.timezone),
    'nominations_open', v_open, 'nominations_close_at', v_nom_close, 'nominations_close_text', private.club_when_text(v_nom_close, mt.timezone),
    'my_topics', case when v_mem.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'details', t.details, 'status', t.status,
        'created_at', t.created_at, 'updated_at', t.updated_at,
        'can_edit', v_topics_open and t.status in ('submitted', 'on_agenda'), 'can_withdraw', now() < mt.starts_at and t.status in ('submitted', 'on_agenda')) order by t.created_at desc)
      from public.club_meeting_topics t where t.meeting_id = p_meeting and t.membership_id = v_mem.id), '[]'::jsonb) end,
    'can_nominate', v_block is null,
    'nominate_blocked', v_block,
    'nominees', case when v_block is not null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('membership_id', c.id, 'name', c.full_name) order by lower(c.full_name), c.id)
        from public.club_memberships c cross join lateral private.club_vote_check(c.id, v_day) e
        where c.team_id = mt.team_id and c.membership_year = mt.membership_year and c.id <> v_mem.id and e.eligible), '[]'::jsonb) end,
    'to_respond', case when v_mem.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'office', n.office, 'label', private.club_office_label(n.office),
        'nominated_at', n.created_at,
        'nominated_by', (select coalesce(jsonb_agg(g.full_name order by nr.nominated_at, g.full_name), '[]'::jsonb) from public.club_meeting_nominators nr
                         join public.club_memberships g on g.id = nr.nominator_membership_id where nr.nomination_id = n.id)) order by n.created_at)
      from public.club_meeting_nominations n where n.meeting_id = p_meeting and n.nominee_membership_id = v_mem.id and n.status = 'awaiting_acceptance'), '[]'::jsonb) end,
    'my_candidacies', case when v_mem.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'office', n.office, 'label', private.club_office_label(n.office),
        'status', n.status) order by n.created_at)
      from public.club_meeting_nominations n where n.meeting_id = p_meeting and n.nominee_membership_id = v_mem.id), '[]'::jsonb) end,
    'board', (select jsonb_agg(jsonb_build_object('office', o.office, 'label', private.club_office_label(o.office),
        'current_officer', private.club_current_officer_name(mt.team_id, mt.membership_year, o.office),
        'candidates', coalesce((select jsonb_agg(jsonb_build_object('name', c.full_name, 'status', n.status) order by (n.status = 'accepted') desc, lower(c.full_name), n.id)
            from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id
            where n.meeting_id = p_meeting and n.office = o.office and n.status in ('accepted', 'awaiting_acceptance') and c.status <> 'removed'), '[]'::jsonb)) order by o.sort)
      from (values ('president', 1), ('secretary', 2), ('treasurer', 3)) as o(office, sort)));
end $$;

-- ---------------------------------------------------------------- 5. executive: set the close times
create or replace function public.set_club_meeting_deadlines(p_meeting uuid, p_nominations_close_at timestamptz default null, p_topics_close_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting for update;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_change_club_dues(mt.team_id) then raise exception 'only the club''s President, Secretary or Treasurer can change when nominations or topics close' using errcode = '42501'; end if;
  update public.club_meetings set nominations_close_at = p_nominations_close_at, topics_close_at = p_topics_close_at where id = p_meeting;
  perform private.audit(null, 'club.meeting_deadlines', p_meeting::text, jsonb_build_object(
    'before', jsonb_build_object('nominations_close_at', mt.nominations_close_at, 'topics_close_at', mt.topics_close_at),
    'after', jsonb_build_object('nominations_close_at', p_nominations_close_at, 'topics_close_at', p_topics_close_at)));
  select * into mt from public.club_meetings where id = p_meeting;
  return private.club_meeting_json(mt);
end $$;
comment on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) is 'President, Secretary or Treasurer: when nominations and topics close for a meeting. NULL = when the meeting starts; a past time closes now.';
revoke all on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) to authenticated;
