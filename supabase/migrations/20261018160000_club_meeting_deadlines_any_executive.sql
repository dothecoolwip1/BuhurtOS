-- Red Deer Reavers members area: every current executive may set or close the nominations / topic-submission deadlines
-- (owner, 2026-10-18: "It should be accessible by all executive roles"). Additive: only the permission check in
-- set_club_meeting_deadlines changes, from President / Secretary / Treasurer (private.can_change_club_dues) to any current officer
-- of the team (private.can_view_club_roster: president, vice_president, secretary, treasurer, director). Everything else about a
-- meeting (title, time, place, invite list, cancelling) stays with the President, Secretary or Treasurer.
create or replace function public.set_club_meeting_deadlines(p_meeting uuid, p_nominations_close_at timestamptz default null, p_topics_close_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings;
begin
  select * into mt from public.club_meetings where id = p_meeting for update;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not private.can_view_club_roster(mt.team_id) then raise exception 'only the club''s executive can change when nominations or topics close' using errcode = '42501'; end if;
  update public.club_meetings set nominations_close_at = p_nominations_close_at, topics_close_at = p_topics_close_at where id = p_meeting;
  perform private.audit(null, 'club.meeting_deadlines', p_meeting::text, jsonb_build_object(
    'before', jsonb_build_object('nominations_close_at', mt.nominations_close_at, 'topics_close_at', mt.topics_close_at),
    'after', jsonb_build_object('nominations_close_at', p_nominations_close_at, 'topics_close_at', p_topics_close_at)));
  select * into mt from public.club_meetings where id = p_meeting;
  return private.club_meeting_json(mt);
end $$;
comment on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) is 'Any current club executive: when nominations and topic submissions close for a meeting. NULL = when the meeting starts; a past time closes now.';
revoke all on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_club_meeting_deadlines(uuid, timestamptz, timestamptz) to authenticated;
