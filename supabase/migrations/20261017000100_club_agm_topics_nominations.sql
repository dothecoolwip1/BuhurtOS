-- Red Deer Reavers AGM: member concerns / topics and executive nominations.
-- Additive: new tables and functions only. Nothing here changes membership, dues, eligibility, RSVP, proxy, check-in, officers or the saved
-- records. The club website (not BuhurtOS) shows these screens; BuhurtOS has no UI for them.
--   * A member submits topics for the AGM agenda, sees them, edits or withdraws their own until the meeting starts or it is addressed.
--     The executive (President, Secretary, Treasurer) sets Submitted / Added to Agenda / Addressed. Nothing is ever deleted.
--   * Voting members nominate themselves or another eligible member for President, Secretary or Treasurer. A self-nomination is accepted at
--     once; a nomination of someone else waits until THAT member accepts or declines. One candidacy per member, office and AGM, however
--     many people nominated them. Nominations never change team_officers: the election happens at the AGM.
-- The tables have no policies and no grants: everything goes through the functions below (same design as the other AGM tables).

-- ---------------------------------------------------------------- 1. tables
create table public.club_meeting_topics (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.club_meetings (id) on delete cascade,
  membership_id uuid not null references public.club_memberships (id),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  details text not null check (char_length(btrim(details)) between 1 and 4000),
  status text not null default 'submitted' check (status in ('submitted', 'on_agenda', 'addressed', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid
);
alter table public.club_meeting_topics enable row level security;
create index club_meeting_topics_meeting_idx on public.club_meeting_topics (meeting_id, created_at);
create index club_meeting_topics_member_idx on public.club_meeting_topics (membership_id);

-- Every submission, edit, withdrawal and status change keeps a copy of what the topic said at that moment.
create table public.club_meeting_topic_history (
  id bigint generated always as identity primary key,
  topic_id uuid not null references public.club_meeting_topics (id),
  action text not null check (action in ('submitted', 'edited', 'withdrawn', 'status')),
  subject text not null,
  details text not null,
  status text not null,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.club_meeting_topic_history enable row level security;

create table public.club_meeting_nominations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.club_meetings (id) on delete cascade,
  -- The offices open for nomination. Widening this list later is an additive migration; team_officers stays the source of truth for who holds them.
  office text not null check (office in ('president', 'secretary', 'treasurer')),
  nominee_membership_id uuid not null references public.club_memberships (id),
  status text not null default 'awaiting_acceptance' check (status in ('awaiting_acceptance', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid
);
alter table public.club_meeting_nominations enable row level security;
-- ONE live candidacy per member, office and AGM (declined and withdrawn ones are kept as history and do not count).
create unique index club_meeting_nominations_one_live on public.club_meeting_nominations (meeting_id, office, nominee_membership_id)
  where status in ('awaiting_acceptance', 'accepted');
create index club_meeting_nominations_nominee_idx on public.club_meeting_nominations (nominee_membership_id);

-- Everyone who put that member forward (a self-nomination is the nominee listed as their own nominator).
create table public.club_meeting_nominators (
  nomination_id uuid not null references public.club_meeting_nominations (id),
  nominator_membership_id uuid not null references public.club_memberships (id),
  nominated_at timestamptz not null default now(),
  nominated_by uuid not null,
  primary key (nomination_id, nominator_membership_id)
);
alter table public.club_meeting_nominators enable row level security;

create table public.club_meeting_nomination_history (
  id bigint generated always as identity primary key,
  nomination_id uuid not null references public.club_meeting_nominations (id),
  action text not null check (action in ('nominated', 'also_nominated', 'accepted', 'declined', 'withdrawn')),
  previous_status text,
  new_status text not null,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.club_meeting_nomination_history enable row level security;

revoke all on public.club_meeting_topics, public.club_meeting_topic_history, public.club_meeting_nominations, public.club_meeting_nominators,
  public.club_meeting_nomination_history from public, anon, authenticated;

-- Histories can never be edited or removed; topics, nominations and nominators can never be removed (they change status instead).
create trigger club_meeting_topic_history_append_only before update or delete on public.club_meeting_topic_history
  for each row execute function private.club_append_only();
create trigger club_meeting_nomination_history_append_only before update or delete on public.club_meeting_nomination_history
  for each row execute function private.club_append_only();
create or replace function private.club_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'this record cannot be removed' using errcode = '42501'; end $$;
revoke execute on function private.club_no_delete() from public, anon, authenticated;
create trigger club_meeting_topics_no_delete before delete on public.club_meeting_topics for each row execute function private.club_no_delete();
create trigger club_meeting_nominations_no_delete before delete on public.club_meeting_nominations for each row execute function private.club_no_delete();
create trigger club_meeting_nominators_no_delete before delete on public.club_meeting_nominators for each row execute function private.club_no_delete();
-- A nominator row is never rewritten; a nomination can only move forward in its own life (never be pointed at someone else or another office).
create or replace function private.club_nomination_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.meeting_id <> old.meeting_id or new.office <> old.office or new.nominee_membership_id <> old.nominee_membership_id or new.created_at <> old.created_at then
    raise exception 'a nomination cannot be pointed at another member, office or meeting' using errcode = '42501'; end if;
  return new;
end $$;
revoke execute on function private.club_nomination_guard() from public, anon, authenticated;
create trigger club_meeting_nominations_guard before update on public.club_meeting_nominations for each row execute function private.club_nomination_guard();
create trigger club_meeting_nominators_append_only before update on public.club_meeting_nominators for each row execute function private.club_append_only();

-- ---------------------------------------------------------------- 2. helpers
create or replace function private.club_office_label(p_office text) returns text
language sql immutable set search_path = '' as $$
  select case p_office when 'president' then 'President' when 'secretary' then 'Secretary' when 'treasurer' then 'Treasurer' else p_office end
$$;
-- Name of the current holder of an office (membership name for that AGM's year, otherwise the profile name), or null when nobody holds it.
create or replace function private.club_current_officer_name(p_team uuid, p_year int, p_office text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.full_name from public.club_memberships m where m.team_id = p_team and m.membership_year = p_year and m.user_id = o.user_id),
                  (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = o.user_id))
  from public.team_officers o
  where o.team_id = p_team and o.office = p_office and o.ended_on is null and o.started_on <= current_date
  limit 1
$$;
revoke execute on function private.club_office_label(text), private.club_current_officer_name(uuid, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. member: concerns / topics
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
  if now() >= mt.starts_at then raise exception 'the meeting has started: speak to the club executive' using errcode = '22023'; end if;
  if char_length(v_subject) < 3 or char_length(v_subject) > 120 then raise exception 'give your topic a short title (3 to 120 characters)' using errcode = '22023'; end if;
  if char_length(v_details) < 1 or char_length(v_details) > 4000 then raise exception 'add some details (up to 4000 characters)' using errcode = '22023'; end if;
  insert into public.club_meeting_topics (meeting_id, membership_id, subject, details, status_changed_by) values (p_meeting, v_mem.id, v_subject, v_details, v_uid) returning id into v_id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (v_id, 'submitted', v_subject, v_details, 'submitted', v_uid);
  perform private.audit(null, 'club.agm_topic_submitted', v_id::text, jsonb_build_object('meeting', p_meeting, 'membership', v_mem.id));
  return v_id;
end $$;

-- Edit or withdraw: only the member's own topic, only before the meeting starts, and only while it is Submitted or Added to Agenda.
create or replace function private.club_my_open_topic(p_topic uuid) returns public.club_meeting_topics
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics; mt public.club_meetings;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into tp from public.club_meeting_topics where id = p_topic for update;
  if not found then raise exception 'topic not found' using errcode = 'P0002'; end if;
  if tp.membership_id is distinct from private.club_meeting_my_membership(tp.meeting_id) then raise exception 'that is not your topic' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = tp.meeting_id;
  if now() >= mt.starts_at then raise exception 'the meeting has started: speak to the club executive' using errcode = '22023'; end if;
  if tp.status = 'withdrawn' then raise exception 'this topic was withdrawn' using errcode = '22023'; end if;
  if tp.status = 'addressed' then raise exception 'this topic has already been addressed' using errcode = '22023'; end if;
  return tp;
end $$;
revoke execute on function private.club_my_open_topic(uuid) from public, anon, authenticated;

create or replace function public.update_club_agm_topic(p_topic uuid, p_subject text, p_details text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics; v_subject text := btrim(coalesce(p_subject, '')); v_details text := btrim(coalesce(p_details, ''));
begin
  tp := private.club_my_open_topic(p_topic);
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
  tp := private.club_my_open_topic(p_topic);
  update public.club_meeting_topics set status = 'withdrawn', updated_at = now(), status_changed_at = now(), status_changed_by = v_uid where id = tp.id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (tp.id, 'withdrawn', tp.subject, tp.details, 'withdrawn', v_uid);
  perform private.audit(null, 'club.agm_topic_withdrawn', tp.id::text, jsonb_build_object('meeting', tp.meeting_id));
end $$;

-- ---------------------------------------------------------------- 4. member: nominations
-- Put yourself (p_nominee null) or another eligible member forward. Returns the candidacy. Many nominators of the same member for the same
-- office share ONE candidacy. Yourself: accepted at once. Someone else: awaits THEIR answer.
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
  if now() >= mt.starts_at then raise exception 'nominations closed when the meeting started' using errcode = '22023'; end if;
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

-- Only the nominated member answers. 'accept' / 'decline' while awaiting; 'withdraw' takes back an accepted candidacy. Never by someone else.
create or replace function public.respond_to_club_nomination(p_nomination uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); nm public.club_meeting_nominations; mt public.club_meetings; v_new text; v_action text; v_nominee_user uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_response is null or p_response not in ('accept', 'decline', 'withdraw') then raise exception 'choose accept, decline or withdraw' using errcode = '22023'; end if;
  select * into nm from public.club_meeting_nominations where id = p_nomination for update;
  if not found then raise exception 'nomination not found' using errcode = 'P0002'; end if;
  select user_id into v_nominee_user from public.club_memberships where id = nm.nominee_membership_id;
  if v_nominee_user is distinct from v_uid then raise exception 'only the nominated member can answer a nomination' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = nm.meeting_id;
  if now() >= mt.starts_at then raise exception 'nominations closed when the meeting started' using errcode = '22023'; end if;
  if p_response = 'withdraw' then
    if nm.status <> 'accepted' then raise exception 'only an accepted candidacy can be withdrawn' using errcode = '22023'; end if;
    v_new := 'withdrawn'; v_action := 'withdrawn';
  else
    if nm.status <> 'awaiting_acceptance' then raise exception 'this nomination has already been answered' using errcode = '22023'; end if;
    -- accepting still needs the member to be able to vote now
    if p_response = 'accept' and not (select c.eligible from private.club_vote_check(nm.nominee_membership_id, private.club_meeting_day(nm.meeting_id)) c) then
      raise exception 'you cannot currently vote, so you cannot accept a nomination' using errcode = '42501'; end if;
    v_new := case p_response when 'accept' then 'accepted' else 'declined' end; v_action := v_new;
  end if;
  update public.club_meeting_nominations set status = v_new, responded_at = now(), responded_by = v_uid where id = nm.id;
  insert into public.club_meeting_nomination_history (nomination_id, action, previous_status, new_status, changed_by) values (nm.id, v_action, nm.status, v_new, v_uid);
  perform private.audit(null, 'club.agm_nomination_' || v_action, nm.id::text, jsonb_build_object('meeting', nm.meeting_id, 'office', nm.office));
end $$;

-- ---------------------------------------------------------------- 5. member: what I see on the AGM page
-- My own topics, nominations waiting for MY answer, whether I may nominate (and if not, why), the members I could nominate, and the board of
-- current officers with accepted / awaiting candidates. Declined and withdrawn candidacies, and candidates whose membership was removed, are not
-- shown on the member board (the executive still sees every record). No e-mail addresses.
create or replace function public.club_agm_member_view(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); mt public.club_meetings; v_mem public.club_memberships; v_day date; v_ok boolean := false; v_reasons text[] := '{}'; v_officer boolean;
  v_open boolean; v_block text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  v_day := private.club_meeting_day(p_meeting);
  v_officer := private.can_view_club_roster(mt.team_id);
  v_open := now() < mt.starts_at;
  select * into v_mem from public.club_memberships where id = private.club_meeting_my_membership(p_meeting);
  if (v_mem.id is null or v_mem.status = 'removed') and not v_officer then return jsonb_build_object('is_member', false); end if;
  if v_mem.id is not null then
    select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_mem.id, v_day) c;
  end if;
  v_ok := coalesce(v_ok, false) and v_mem.id is not null and v_mem.status <> 'removed';
  v_block := case when v_mem.id is null then 'Only voting members can nominate.' when v_mem.status = 'removed' then 'Your membership was removed.'
    when not v_open then 'Nominations closed when the AGM started.'
    when not v_ok then 'Only members who can currently vote can nominate' || case when cardinality(v_reasons) > 0 then ' (' || array_to_string(v_reasons, ', ') || ')' else '' end || '.' end;
  return jsonb_build_object(
    'is_member', v_mem.id is not null and v_mem.status <> 'removed',
    'topics_open', v_open and v_mem.id is not null and v_mem.status <> 'removed',
    'my_topics', case when v_mem.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'details', t.details, 'status', t.status,
        'created_at', t.created_at, 'updated_at', t.updated_at,
        'can_edit', v_open and t.status in ('submitted', 'on_agenda')) order by t.created_at desc)
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

-- ---------------------------------------------------------------- 6. executive: concerns and nominations
-- Any current executive may look; only the President, Secretary or Treasurer set a topic's status (same people who run dues and the video link).
create or replace function public.club_agm_topics_admin(p_meeting uuid)
returns table (topic_id uuid, membership_id uuid, member_name text, subject text, details text, status text, created_at timestamptz, updated_at timestamptz,
  edited boolean, status_changed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see AGM topics' using errcode = '42501'; end if;
  return query
  select t.id, t.membership_id, m.full_name, t.subject, t.details, t.status, t.created_at, t.updated_at,
         exists (select 1 from public.club_meeting_topic_history h where h.topic_id = t.id and h.action = 'edited'), t.status_changed_at
  from public.club_meeting_topics t join public.club_memberships m on m.id = t.membership_id
  where t.meeting_id = p_meeting
  order by (t.status = 'withdrawn'), t.created_at, t.id;
end $$;

create or replace function public.set_club_agm_topic_status(p_topic uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); tp public.club_meeting_topics; v_team uuid;
begin
  select * into tp from public.club_meeting_topics where id = p_topic for update;
  if not found then raise exception 'topic not found' using errcode = 'P0002'; end if;
  v_team := private.club_meeting_team(tp.meeting_id);
  if v_uid is null or not private.can_change_club_dues(v_team) then raise exception 'only the club''s President, Secretary or Treasurer can set a topic''s status' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('submitted', 'on_agenda', 'addressed') then raise exception 'choose Submitted, Added to Agenda or Addressed' using errcode = '22023'; end if;
  if tp.status = 'withdrawn' then raise exception 'the member withdrew this topic' using errcode = '22023'; end if;
  if tp.status = p_status then return; end if;
  update public.club_meeting_topics set status = p_status, status_changed_at = now(), status_changed_by = v_uid where id = tp.id;
  insert into public.club_meeting_topic_history (topic_id, action, subject, details, status, changed_by) values (tp.id, 'status', tp.subject, tp.details, p_status, v_uid);
  perform private.audit(null, 'club.agm_topic_status', tp.id::text, jsonb_build_object('meeting', tp.meeting_id, 'from', tp.status, 'to', p_status));
end $$;

-- Per office: the current officer and every candidacy (live and ended) with who nominated, self or member nomination, and the status.
create or replace function public.club_agm_nominations_admin(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only this club''s executive can see nominations' using errcode = '42501'; end if;
  return jsonb_build_object('offices', (select jsonb_agg(jsonb_build_object('office', o.office, 'label', private.club_office_label(o.office),
      'current_officer', private.club_current_officer_name(mt.team_id, mt.membership_year, o.office),
      'nominations', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'nominee', c.full_name, 'status', n.status, 'created_at', n.created_at, 'responded_at', n.responded_at,
          'self_nominated', exists (select 1 from public.club_meeting_nominators nr where nr.nomination_id = n.id and nr.nominator_membership_id = n.nominee_membership_id),
          'nominated_by', (select coalesce(jsonb_agg(g.full_name order by nr.nominated_at, g.full_name), '[]'::jsonb) from public.club_meeting_nominators nr
                           join public.club_memberships g on g.id = nr.nominator_membership_id where nr.nomination_id = n.id and nr.nominator_membership_id <> n.nominee_membership_id))
          order by (n.status = 'accepted') desc, (n.status = 'awaiting_acceptance') desc, lower(c.full_name), n.created_at)
        from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id
        where n.meeting_id = p_meeting and n.office = o.office), '[]'::jsonb)) order by o.sort)
    from (values ('president', 1), ('secretary', 2), ('treasurer', 3)) as o(office, sort)));
end $$;

-- ---------------------------------------------------------------- 7. grants
revoke execute on function
  public.submit_club_agm_topic(uuid, text, text), public.update_club_agm_topic(uuid, text, text), public.withdraw_club_agm_topic(uuid),
  public.nominate_for_club_office(uuid, text, uuid), public.respond_to_club_nomination(uuid, text), public.club_agm_member_view(uuid),
  public.club_agm_topics_admin(uuid), public.set_club_agm_topic_status(uuid, text), public.club_agm_nominations_admin(uuid)
from public, anon;
grant execute on function
  public.submit_club_agm_topic(uuid, text, text), public.update_club_agm_topic(uuid, text, text), public.withdraw_club_agm_topic(uuid),
  public.nominate_for_club_office(uuid, text, uuid), public.respond_to_club_nomination(uuid, text), public.club_agm_member_view(uuid),
  public.club_agm_topics_admin(uuid), public.set_club_agm_topic_status(uuid, text), public.club_agm_nominations_admin(uuid)
to authenticated;
