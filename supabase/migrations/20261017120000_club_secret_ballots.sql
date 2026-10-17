-- Red Deer Reavers AGM voting: secret ballots.
-- Additive: replaces one read function only. Tables, casting, tallies, open/close and the audit log are unchanged.
--
-- Context: the AGM vote (club_meeting_questions / club_meeting_ballots / club_meeting_ballot_history, cast_club_ballot,
-- club_question_list, open/close/create/update_club_question, private.club_question_tally, club_vote_officers) was rolled out to the
-- hosted project on 2026-10-08 and is kept here as the record of the one change made since: the returning officer could call
-- club_question_ballots and see every member's choice by name. The club wants a secret ballot, so from now on:
--   * nobody can read how a member voted: not members, not the executive, not the returning officer, not through any function;
--   * the executive (President, Secretary, Treasurer: private.can_change_club_dues) and the returning officer can see TURNOUT only:
--     who has a ballot in (and, for a proxy ballot, who cast it), when, how many times it was changed, and who has not voted yet;
--   * each member still sees their own ballot (and the ballots they cast as a proxy holder) through club_question_list, so they can
--     change it until the question closes; counts stay as they were (executive while open, everyone once closed).
-- The voter-to-choice link stays in club_meeting_ballots so a member can vote once and change their mind; the tables have no policies
-- and no grants, so the only readers are the SECURITY DEFINER functions, and after this change none of them returns a choice by name.

create or replace function public.club_question_ballots(p_question uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_team uuid;
begin
  q := private.club_question(p_question);
  v_team := private.club_meeting_team(q.meeting_id);
  if auth.uid() is null or not (private.can_change_club_dues(v_team) or private.club_is_vote_officer(v_team)) then
    raise exception 'only the club''s executive or returning officer can see who has voted' using errcode = '42501';
  end if;
  perform private.audit(null, 'club.turnout_viewed', p_question::text, jsonb_build_object('meeting', q.meeting_id));
  return jsonb_build_object(
    'question', jsonb_build_object('id', q.id, 'title', q.title, 'status', q.status, 'options', q.options),
    'secret', true,
    'ballots', coalesce((select jsonb_agg(jsonb_build_object(
        'voter', v.full_name, 'voter_membership_id', v.id,
        'cast_by', case when b.cast_by_membership_id = v.id then null else c.full_name end,
        'cast_at', b.cast_at, 'changed_at', b.changed_at,
        'changes', (select count(*) from public.club_meeting_ballot_history hh where hh.question_id = q.id and hh.voter_membership_id = v.id) - 1)
        order by lower(v.full_name))
      from public.club_meeting_ballots b
      join public.club_memberships v on v.id = b.voter_membership_id
      join public.club_memberships c on c.id = b.cast_by_membership_id
      where b.question_id = p_question), '[]'::jsonb),
    'not_voted', coalesce((select jsonb_agg(cm.full_name order by lower(cm.full_name))
      from public.club_memberships cm join public.club_meetings mt on mt.id = q.meeting_id
      cross join lateral private.club_vote_check(cm.id, private.club_meeting_day(mt.id)) e
      where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and e.eligible
        and not exists (select 1 from public.club_meeting_ballots b where b.question_id = q.id and b.voter_membership_id = cm.id)), '[]'::jsonb));
end $$;

comment on function public.club_question_ballots(uuid) is
  'AGM turnout for one question (who has a ballot in, who has not): executive or returning officer only. Never returns a choice: ballots are secret.';
