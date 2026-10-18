-- Red Deer Reavers members area: nominations open at a set moment and close 24 hours later (owner, 2026-10-18: "Nominations should also
-- close 24 hours after they open. And let's change opening time to two pm MST"). Additive.
--
--   * club_meetings.nominations_open_at: when new nominations open. NULL = open from the moment the meeting exists (today's behaviour).
--   * The effective close becomes: nominations_close_at if set; else nominations_open_at + 24 hours if an opening time is set; else the
--     meeting start. Accepting, declining and withdrawing a nomination stay open until the meeting starts (unchanged).
--   * set_club_nominations_open(meeting, opens_at): any current executive; NULL clears; audited.
--   * club_agm_member_view / club_meeting_json carry nominations_open_at, nominations_opens_text and nominations_not_yet; nominate_blocked
--     reads "Nominations open Sunday, October 18 at 2:00 PM and close Monday, October 19 at 2:00 PM."
--   * In-flight state: the 2026 AGM's nominations open 2026-10-18 14:00 America/Edmonton (owner instruction); the hand-made 12:45 PM close is
--     cleared so they close 24 hours after opening. Nominations already recorded stay as they are.

alter table public.club_meetings add column if not exists nominations_open_at timestamptz;
comment on column public.club_meetings.nominations_open_at is 'When new nominations open; NULL = from the moment the meeting exists. Close = nominations_close_at, else open + 24 h, else the meeting start.';

create or replace function private.club_nominations_close_at(mt public.club_meetings) returns timestamptz
language sql immutable as $$
  select coalesce(mt.nominations_close_at, case when mt.nominations_open_at is not null then mt.nominations_open_at + interval '24 hours' else mt.starts_at end)
$$;
create or replace function private.club_nominations_open(mt public.club_meetings) returns boolean
language sql stable as $$
  select now() >= coalesce(mt.nominations_open_at, '-infinity'::timestamptz) and now() < private.club_nominations_close_at(mt)
$$;
revoke execute on function private.club_nominations_open(public.club_meetings) from public, anon, authenticated;

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
    'nominations_close_text', private.club_when_text(private.club_nominations_close_at(mt), mt.timezone), 'nominations_open', private.club_nominations_open(mt),
    'nominations_open_at', mt.nominations_open_at, 'nominations_opens_text', case when mt.nominations_open_at is null then null else private.club_when_text(mt.nominations_open_at, mt.timezone) end,
    'nominations_not_yet', mt.nominations_open_at is not null and now() < mt.nominations_open_at,
    'topics_close_set', mt.topics_close_at is not null, 'topics_close_at', private.club_topics_close_at(mt),
    'topics_close_text', private.club_when_text(private.club_topics_close_at(mt), mt.timezone), 'topics_open', now() < private.club_topics_close_at(mt))
$$;

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
  if mt.nominations_open_at is not null and now() < mt.nominations_open_at then raise exception 'nominations open %', private.club_when_text(mt.nominations_open_at, mt.timezone) using errcode = '22023'; end if;
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
  v_open := private.club_nominations_open(mt); v_topics_open := now() < v_top_close;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting);
  if (v_mem.id is null or v_mem.status = 'removed') and not v_officer then return jsonb_build_object('is_member', false); end if;
  if v_mem.id is not null then
    select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, v_day) c;
  end if;
  v_ok := coalesce(v_ok, false) and v_mem.id is not null and v_mem.status <> 'removed';
  v_block := case when v_mem.id is null then 'Only voting members can nominate.' when v_mem.status = 'removed' then 'Your membership was removed.'
    when mt.nominations_open_at is not null and now() < mt.nominations_open_at then 'Nominations open ' || private.club_when_text(mt.nominations_open_at, mt.timezone) || ' and close ' || private.club_when_text(v_nom_close, mt.timezone) || '.'
    when not v_open then 'Nominations closed ' || private.club_when_text(v_nom_close, mt.timezone) || '.'
    when not v_ok then 'Only members who can currently vote can nominate' || case when cardinality(v_reasons) > 0 then ' (' || array_to_string(v_reasons, ', ') || ')' else '' end || '.' end;
  return jsonb_build_object(
    'is_member', v_mem.id is not null and v_mem.status <> 'removed',
    'topics_open', v_topics_open and v_mem.id is not null and v_mem.status <> 'removed',
    'topics_close_at', v_top_close, 'topics_close_text', private.club_when_text(v_top_close, mt.timezone),
    'nominations_open', v_open, 'nominations_close_at', v_nom_close, 'nominations_close_text', private.club_when_text(v_nom_close, mt.timezone),
    'nominations_open_at', mt.nominations_open_at, 'nominations_opens_text', case when mt.nominations_open_at is null then null else private.club_when_text(mt.nominations_open_at, mt.timezone) end,
    'nominations_not_yet', mt.nominations_open_at is not null and now() < mt.nominations_open_at,
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

create or replace function public.set_club_nominations_open(p_meeting uuid, p_opens_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting for update;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only the club''s executive can change when nominations open' using errcode = '42501'; end if;
  -- a close time that is not after the new opening time is stale (nominations were closed by hand earlier): clear it so "open + 24 hours" applies
  update public.club_meetings set nominations_open_at = p_opens_at,
    nominations_close_at = case when p_opens_at is not null and nominations_close_at is not null and nominations_close_at <= p_opens_at then null else nominations_close_at end
    where id = p_meeting;
  perform private.audit(null, 'club.nominations_open_at', p_meeting::text, jsonb_build_object('before', mt.nominations_open_at, 'after', p_opens_at, 'close_before', mt.nominations_close_at));
  select * into mt from public.club_meetings where id = p_meeting;
  return private.club_meeting_json(mt);
end $$;
comment on function public.set_club_nominations_open(uuid, timestamptz) is 'Any current club executive: when new nominations open (they close 24 hours later unless a close time is set). NULL = open from the start.';
revoke all on function public.set_club_nominations_open(uuid, timestamptz) from public, anon;
grant execute on function public.set_club_nominations_open(uuid, timestamptz) to authenticated;

-- owner instruction 2026-10-18: the 2026 AGM's nominations open at 2:00 PM Mountain time today and close 24 hours later. The executive had
-- closed them by hand at 12:45 PM (nominations_close_at); that close is cleared so the 24-hour rule applies from the new opening time.
update public.club_meetings set nominations_open_at = timestamptz '2026-10-18 14:00 America/Edmonton',
  nominations_close_at = case when nominations_close_at <= timestamptz '2026-10-18 14:00 America/Edmonton' then null else nominations_close_at end
  where kind = 'agm' and membership_year = 2026 and nominations_open_at is null;
