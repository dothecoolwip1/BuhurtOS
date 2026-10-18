-- Red Deer Reavers members area: a vote closes on its own 24 hours after it opens (owner, 2026-10-18: "I want the voting to close 24 hours
-- after the voting starts"). Additive.
--
--   * club_meeting_questions.closes_at: set when a question opens (opened_at + 24 hours). The executive can still close earlier.
--   * private.club_close_question(question, by, at): the one place a question is closed (manual close and automatic close both use it):
--     status closed, closed_at, result = the tally. The trigger club_question_guard keeps a closed question final.
--   * private.club_questions_autoclose(): closes every open question whose time has come. Runs every minute from pg_cron
--     (job club-votes-autoclose). cast_club_ballot refuses a ballot once closes_at has passed, so nothing slips in while cron catches up.
--   * club_question_list: carries closes_at; an open question whose closes_at has passed is reported as closed (status 'closed', closed_at =
--     closes_at, tally) even before the sweep has run, so every reader sees the same result from the closing second.
--   * In-flight state: no question is open on hosted at the time of writing; an open one would get closes_at = greatest(opened_at + 24 h,
--     now() + 24 h) so nothing closes by surprise the moment this is applied.

alter table public.club_meeting_questions add column if not exists closes_at timestamptz;
comment on column public.club_meeting_questions.closes_at is 'When voting closes on its own (opened_at + 24 hours). NULL until opened.';
update public.club_meeting_questions set closes_at = greatest(opened_at + interval '24 hours', now() + interval '24 hours') where status = 'open' and closes_at is null;

-- the meeting's time zone, for messages
create or replace function private.club_meeting_tz(p_meeting uuid) returns text
language sql stable security definer set search_path = '' as $$ select coalesce((select m.timezone from public.club_meetings m where m.id = p_meeting), 'America/Edmonton') $$;
revoke execute on function private.club_meeting_tz(uuid) from public, anon, authenticated;

create or replace function private.club_close_question(p_question uuid, p_by uuid, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_res jsonb; v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  select * into q from public.club_meeting_questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.status <> 'open' then raise exception 'only an open question can be closed' using errcode = '22023'; end if;
  v_res := private.club_question_tally(p_question) || jsonb_build_object('closed_at', v_at, 'auto', p_by is null);
  update public.club_meeting_questions set status = 'closed', closed_at = v_at, closed_by = p_by, result = v_res where id = p_question;
  perform private.audit(null, 'club.question_closed', p_question::text, jsonb_build_object('meeting', q.meeting_id, 'total', v_res -> 'total', 'auto', p_by is null));
  return v_res;
end $$;
revoke execute on function private.club_close_question(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function private.club_questions_autoclose() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select q.id, q.closes_at from public.club_meeting_questions q where q.status = 'open' and q.closes_at is not null and q.closes_at <= now() loop
    perform private.club_close_question(r.id, null, r.closes_at);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.club_questions_autoclose() from public, anon, authenticated;

create or replace function public.open_club_question(p_question uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_opts jsonb;
begin
  q := private.club_question(p_question);
  perform private.club_question_manage_check(private.club_meeting_team(q.meeting_id));
  if q.status <> 'draft' then raise exception 'this question was already opened' using errcode = '22023'; end if;
  v_opts := private.club_question_options(q);
  if q.kind = 'election' and jsonb_array_length(v_opts) < 2 then raise exception 'no accepted candidate for this office yet: the election cannot open' using errcode = '22023'; end if;
  update public.club_meeting_questions set status = 'open', opened_at = now(), closes_at = now() + interval '24 hours', options = v_opts where id = p_question;
  perform private.audit(null, 'club.question_opened', p_question::text, jsonb_build_object('meeting', q.meeting_id, 'options', jsonb_array_length(v_opts), 'closes_at', now() + interval '24 hours'));
end $$;

create or replace function public.close_club_question(p_question uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions;
begin
  q := private.club_question(p_question);
  perform private.club_question_manage_check(private.club_meeting_team(q.meeting_id));
  if q.status = 'open' and q.closes_at is not null and q.closes_at <= now() then return private.club_close_question(p_question, null, q.closes_at); end if;
  return private.club_close_question(p_question, auth.uid(), now());
end $$;

create or replace function public.cast_club_ballot(p_question uuid, p_choice text, p_for_membership uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; mt public.club_meetings; v_me public.club_memberships; v_voter public.club_memberships; v_day date;
  v_ok boolean; v_reasons text[]; v_old public.club_meeting_ballots; v_proxy public.club_meeting_proxies; v_problem text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  q := private.club_question(p_question);
  if q.status = 'open' and q.closes_at is not null and q.closes_at <= now() then
    raise exception 'voting closed %', private.club_when_text(q.closes_at, private.club_meeting_tz(q.meeting_id)) using errcode = '22023';
  end if;
  select * into mt from public.club_meetings where id = q.meeting_id;
  select * into v_me from public.club_memberships where id = private.club_meeting_my_membership(mt.id);
  if v_me.id is null then raise exception 'only club members vote: apply for membership first' using errcode = '42501'; end if;
  if q.status <> 'open' then raise exception 'this question is not open for voting' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(q.options) o where o ->> 'key' = p_choice) then raise exception 'that is not one of the choices' using errcode = '22023'; end if;
  v_day := private.club_meeting_day(mt.id);
  if p_for_membership is null or p_for_membership = v_me.id then
    v_voter := v_me;
    if exists (select 1 from public.club_meeting_proxies p where p.meeting_id = mt.id and p.grantor_membership_id = v_me.id and p.status = 'active') then
      raise exception 'you gave your proxy for this meeting: your proxy holder votes for you (cancel the proxy on the AGM page to vote yourself)' using errcode = '42501';
    end if;
  else
    select * into v_voter from public.club_memberships where id = p_for_membership and team_id = mt.team_id and membership_year = mt.membership_year;
    if v_voter.id is null then raise exception 'that member is not in this club' using errcode = 'P0002'; end if;
    select * into v_proxy from public.club_meeting_proxies p where p.meeting_id = mt.id and p.grantor_membership_id = v_voter.id and p.holder_membership_id = v_me.id and p.status = 'active';
    if v_proxy.id is null then raise exception 'you do not hold that member''s proxy' using errcode = '42501'; end if;
    v_problem := private.club_proxy_problem(v_proxy.id);
    if v_problem is not null then raise exception 'that proxy is not valid right now: %', v_problem using errcode = '42501'; end if;
  end if;
  select c.eligible, c.reasons into v_ok, v_reasons from private.club_vote_check(v_voter.id, v_day) c;
  if not v_ok then raise exception 'not eligible to vote: %', array_to_string(v_reasons, ', ') using errcode = '42501'; end if;
  select * into v_old from public.club_meeting_ballots where question_id = p_question and voter_membership_id = v_voter.id;
  if v_old.id is null then
    insert into public.club_meeting_ballots (question_id, voter_membership_id, cast_by_membership_id, cast_by, choice) values (p_question, v_voter.id, v_me.id, auth.uid(), p_choice);
  elsif v_old.choice <> p_choice or v_old.cast_by_membership_id <> v_me.id then
    update public.club_meeting_ballots set choice = p_choice, cast_by_membership_id = v_me.id, cast_by = auth.uid(), changed_at = now() where id = v_old.id;
  else
    return;
  end if;
  insert into public.club_meeting_ballot_history (question_id, voter_membership_id, cast_by_membership_id, previous_choice, new_choice, changed_by)
    values (p_question, v_voter.id, v_me.id, v_old.choice, p_choice, auth.uid());
  perform private.audit(null, case when v_old.id is null then 'club.ballot_cast' else 'club.ballot_changed' end, p_question::text,
    jsonb_build_object('meeting', mt.id, 'voter', v_voter.id, 'by', v_me.id, 'as_proxy', v_voter.id <> v_me.id));
end $$;

create or replace function public.club_question_list(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mt public.club_meetings; v_me public.club_memberships; v_day date; v_manage boolean; v_exec boolean; v_officer boolean; v_gave boolean; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  v_day := private.club_meeting_day(mt.id);
  v_manage := private.can_change_club_dues(mt.team_id); v_exec := private.can_view_club_roster(mt.team_id); v_officer := private.club_is_vote_officer(mt.team_id);
  select * into v_me from public.club_memberships where id = private.club_meeting_my_membership(mt.id);
  if v_me.id is null and not v_exec then raise exception 'only club members and the executive see the vote' using errcode = '42501'; end if;
  if v_me.id is not null then
    select c.eligible into v_ok from private.club_vote_check(v_me.id, v_day) c;
    v_gave := exists (select 1 from public.club_meeting_proxies p where p.meeting_id = mt.id and p.grantor_membership_id = v_me.id and p.status = 'active');
  end if;
  return jsonb_build_object(
    'can_manage', v_manage, 'can_see_ballots', v_officer, 'is_member', v_me.id is not null,
    'my_membership_id', v_me.id, 'eligible', coalesce(v_ok, false), 'gave_proxy', coalesce(v_gave, false),
    'voters', case when v_me.id is null then '[]'::jsonb else
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('membership_id', v_me.id, 'name', v_me.full_name, 'self', true, 'can', coalesce(v_ok, false) and not coalesce(v_gave, false),
          'why', case when v_gave then 'you gave your proxy' when not coalesce(v_ok, false) then 'not eligible to vote' end) as x
        union all
        select jsonb_build_object('membership_id', g.id, 'name', g.full_name, 'self', false, 'can', private.club_proxy_problem(p.id) is null, 'why', private.club_proxy_problem(p.id))
        from public.club_meeting_proxies p join public.club_memberships g on g.id = p.grantor_membership_id
        where p.meeting_id = mt.id and p.holder_membership_id = v_me.id and p.status = 'active') s) end,
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'office', q.office, 'title', q.title, 'details', q.details,
        'status', case when q.status = 'open' and q.closes_at <= now() then 'closed' else q.status end, 'options', q.options,
        'opened_at', q.opened_at, 'closes_at', q.closes_at,
        'closed_at', case when q.status = 'open' and q.closes_at <= now() then q.closes_at else q.closed_at end,
        'closes_text', case when q.closes_at is null then null else private.club_when_text(q.closes_at, mt.timezone) end,
        'auto_closed', (q.status = 'open' and q.closes_at <= now()) or coalesce((q.result ->> 'auto')::boolean, false),
        'sort_order', q.sort_order,
        'ballots_in', (select count(*) from public.club_meeting_ballots b where b.question_id = q.id),
        'eligible_count', (select count(*) from public.club_memberships cm cross join lateral private.club_vote_check(cm.id, v_day) c
                           where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and c.eligible),
        'tally', case when q.status = 'closed' then q.result
                      when q.status = 'open' and q.closes_at <= now() then private.club_question_tally(q.id) || jsonb_build_object('closed_at', q.closes_at, 'auto', true)
                      when v_exec and q.status = 'open' then private.club_question_tally(q.id) end,
        'my_ballots', case when v_me.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('membership_id', b.voter_membership_id, 'choice', b.choice, 'changed_at', b.changed_at))
            from public.club_meeting_ballots b where b.question_id = q.id
              and (b.voter_membership_id = v_me.id or b.voter_membership_id in (select p.grantor_membership_id from public.club_meeting_proxies p where p.meeting_id = mt.id and p.holder_membership_id = v_me.id and p.status = 'active'))), '[]'::jsonb) end)
        order by q.sort_order, q.created_at)
      from public.club_meeting_questions q where q.meeting_id = p_meeting and (q.status <> 'draft' or v_exec)), '[]'::jsonb));
end $$;

-- the sweep: every minute
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'club-votes-autoclose';
    perform cron.schedule('club-votes-autoclose', '* * * * *', $job$select private.club_questions_autoclose()$job$);
  end if;
end $$;
