-- Red Deer Reavers: an invited-only leadership meeting before the AGM (owner request 2026-10-17, applied live the same evening).
-- Additive. Extends the club meeting system instead of adding a parallel one:
--   * club_meeting_invitees: who a 'special' meeting is for. The AGM has no rows here (everyone is invited to an AGM).
--   * club_leadership_meeting(team): the member page's read of the current special meeting. Returns meeting: null unless the caller's
--     membership is on the invite list, so nobody else learns the meeting exists. Attendance uses set_club_meeting_attendance as the AGM does.
--   * reavers_discord_topic_alert now posts to Discord for AGM topics only: a leadership meeting's agenda is not announced to the whole club.
--   * Data: the 2026 Pre-AGM Leadership Meeting, its six invitees and its five agenda items (from the agenda PDF), status on_agenda.

create table if not exists public.club_meeting_invitees (
  meeting_id uuid not null references public.club_meetings(id),
  membership_id uuid not null references public.club_memberships(id),
  invited_at timestamptz not null default now(),
  primary key (meeting_id, membership_id)
);
comment on table public.club_meeting_invitees is 'Members a special club meeting is for. Read only through club_leadership_meeting().';
alter table public.club_meeting_invitees enable row level security;
revoke all on public.club_meeting_invitees from anon, authenticated;

-- Discord: topic alerts and the topic board are for the AGM only.
create or replace function private.reavers_discord_topic_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  webhook text;
  team_slug text;
  meeting_kind text;
  mid text;
  result jsonb;
  payload jsonb;
begin
  select tm.slug, m.kind into team_slug, meeting_kind
  from public.club_meetings m
  join public.teams tm on tm.id=m.team_id
  where m.id=new.meeting_id;

  if team_slug is distinct from 'red-deer-reavers' or meeting_kind is distinct from 'agm' then return new; end if;

  webhook := private.reavers_discord_webhook();
  if webhook is null or btrim(webhook)='' then return new; end if;

  payload := private.reavers_discord_topic_payload(new.id);
  select message_id into mid from private.reavers_discord_topic_messages where topic_id=new.id;

  if tg_op='INSERT' and mid is null then
    result := private.reavers_discord_http('POST', webhook || case when position('?' in webhook)>0 then '&wait=true' else '?wait=true' end, payload);
    mid := result->>'id';
    if mid is not null then
      insert into private.reavers_discord_topic_messages(topic_id,message_id,synced_at)
      values(new.id,mid,now())
      on conflict(topic_id) do update set message_id=excluded.message_id,synced_at=excluded.synced_at;
    end if;
  elsif mid is not null then
    perform private.reavers_discord_http('PATCH', webhook || '/messages/' || mid, payload);
    update private.reavers_discord_topic_messages set synced_at=now() where topic_id=new.id;
  end if;

  perform private.reavers_discord_sync_board(new.meeting_id);
  return new;
exception when others then
  raise warning 'Reavers Discord topic sync failed: %', sqlerrm;
  return new;
end
$$;

create or replace function public.club_leadership_meeting(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where team_id = p_team and kind = 'special'
    order by (starts_at >= now() - interval '1 day') desc, case when starts_at >= now() - interval '1 day' then starts_at end asc, starts_at desc limit 1;
  if not found then return jsonb_build_object('meeting', null); end if;
  v_mem := private.club_meeting_my_membership(mt.id);
  if v_mem is null or not exists (select 1 from public.club_meeting_invitees i where i.meeting_id = mt.id and i.membership_id = v_mem) then
    return jsonb_build_object('meeting', null);
  end if;
  return jsonb_build_object(
    'meeting', jsonb_build_object('id', mt.id, 'title', mt.title, 'starts_at', mt.starts_at, 'timezone', mt.timezone, 'location', mt.location,
      'year', mt.membership_year, 'started', now() >= mt.starts_at,
      'local_date', to_char(mt.starts_at at time zone mt.timezone, 'FMDay, FMMonth FMDD, YYYY'),
      'local_time', to_char(mt.starts_at at time zone mt.timezone, 'FMHH12:MI AM'),
      'notes_link', mt.video_link, 'notes_label', mt.video_details),
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
comment on function public.club_leadership_meeting(uuid) is 'The current special (leadership) meeting for the signed-in member: meeting null unless they are invited.';
revoke all on function public.club_leadership_meeting(uuid) from public, anon;
grant execute on function public.club_leadership_meeting(uuid) to authenticated;

-- Data: 2026 Pre-AGM Leadership Meeting for the Red Deer Reavers. Idempotent.
do $$
declare v_team uuid; v_meeting uuid; v_garrett uuid; v_uid uuid; t0 timestamptz := date_trunc('second', now());
  items text[][] := array[
    ['1. Leadership Structure', E'• Clarify whether President and Team Captain should be the same position.\n• Discuss what each leadership role should involve.\n• Review what the team needs from its leadership.'],
    ['2. Roles and Expectations', E'• Review responsibilities for President, Secretary, and Treasurer.\n• Discuss expectations for attendance, communication, and involvement.\n• Identify areas that need improvement.'],
    ['3. Current Leadership', E'• Discuss how the current leadership is working.\n• Address concerns about roles and responsibilities.\n• Discuss possible changes while recognizing everyone’s contributions.'],
    ['4. AGM Elections and Voting', E'• Decide which positions need to be reviewed or opened for nominations.\n• Review voting requirements and bylaws.\n• Confirm which decisions need to be brought to the AGM for a vote.'],
    ['5. AGM Preparation', E'• Confirm who will facilitate the AGM.\n• Finalize leadership topics for the AGM agenda.\n• Confirm next steps and responsibilities.\n\nMeeting goal: make sure everyone understands the team’s leadership needs and agrees on a fair, respectful process for discussing any changes at the AGM.']
  ];
  i int; v_topic uuid;
begin
  select id into v_team from public.teams where slug = 'red-deer-reavers';
  if v_team is null then return; end if;
  select id, user_id into v_garrett, v_uid from public.club_memberships where team_id = v_team and membership_year = 2026 and full_name = 'Garrett Robson';
  if v_garrett is null then return; end if;

  select id into v_meeting from public.club_meetings where team_id = v_team and kind = 'special' and membership_year = 2026;
  if v_meeting is null then
    insert into public.club_meetings (team_id, membership_year, kind, title, starts_at, timezone, location, video_link, video_details)
    values (v_team, 2026, 'special', 'Pre-AGM Leadership Meeting', t0, 'America/Edmonton', null,
            'https://claude.ai/code/artifact/04958abc-a37f-490c-bddc-886f7f6e6fc9', 'Shared notes for this meeting (open in a new tab)')
    returning id into v_meeting;
  end if;

  insert into public.club_meeting_invitees (meeting_id, membership_id)
  select v_meeting, cm.id from public.club_memberships cm
  where cm.team_id = v_team and cm.membership_year = 2026 and cm.status = 'active'
    and cm.full_name in ('Garrett Robson', 'Taylor Robson', 'Keston Piche', 'Kolby Verkirk', 'Kedrixx Streit', 'Carmalee Farn-Baker')
  on conflict do nothing;

  for i in 1..array_length(items, 1) loop
    if not exists (select 1 from public.club_meeting_topics where meeting_id = v_meeting and subject = items[i][1]) then
      insert into public.club_meeting_topics (meeting_id, membership_id, subject, details, status, created_at, updated_at, status_changed_at, status_changed_by)
      values (v_meeting, v_garrett, items[i][1], items[i][2], 'on_agenda', t0 + (i * interval '1 second'), t0 + (i * interval '1 second'), t0 + (i * interval '1 second'), v_uid)
      returning id into v_topic;
      insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by, changed_at) values
        (v_topic, 'submitted', items[i][1], items[i][2], 'submitted', v_uid, t0 + (i * interval '1 second')),
        (v_topic, 'status', items[i][1], items[i][2], 'on_agenda', v_uid, t0 + (i * interval '1 second'));
    end if;
  end loop;
end $$;
