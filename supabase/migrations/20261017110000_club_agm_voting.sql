-- Red Deer Reavers AGM voting: questions (elections and motions), ballots, the returning officer.
-- Applied to the hosted project 2026-10-08 in eight parts (club_agm_voting_1_tables .. club_agm_voting_4c_grants_officer); this is the same SQL,
-- in the same order, added to the repository so the migrations build from zero again (club_secret_ballots and the club meeting migrations that
-- followed depend on these tables). Idempotent where it can be: already-applied hosted databases are not touched by it.

-- ---------------------------------------------------------------- part 1: tables and guards
create table if not exists public.club_meeting_questions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.club_meetings (id) on delete cascade,
  kind text not null check (kind in ('election', 'motion')),
  office text check (office is null or office in ('president', 'secretary', 'treasurer')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  details text check (details is null or char_length(details) <= 2000),
  options jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  sort_order int not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  result jsonb,
  check ((kind = 'election') = (office is not null)),
  check ((status = 'draft') = (opened_at is null)),
  check ((status = 'closed') = (closed_at is not null))
);
create index if not exists club_meeting_questions_meeting on public.club_meeting_questions (meeting_id, sort_order, created_at);
alter table public.club_meeting_questions enable row level security;

create table if not exists public.club_meeting_ballots (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.club_meeting_questions (id),
  voter_membership_id uuid not null references public.club_memberships (id),
  cast_by_membership_id uuid not null references public.club_memberships (id),
  cast_by uuid not null,
  choice text not null check (char_length(choice) between 1 and 120),
  cast_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  unique (question_id, voter_membership_id)
);
alter table public.club_meeting_ballots enable row level security;

create table if not exists public.club_meeting_ballot_history (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.club_meeting_questions (id),
  voter_membership_id uuid not null references public.club_memberships (id),
  cast_by_membership_id uuid not null references public.club_memberships (id),
  previous_choice text,
  new_choice text not null,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.club_meeting_ballot_history enable row level security;

create table if not exists public.club_vote_officers (
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  note text,
  added_at timestamptz not null default now(),
  primary key (team_id, email)
);
alter table public.club_vote_officers enable row level security;

drop trigger if exists club_meeting_ballot_history_append_only on public.club_meeting_ballot_history;
create trigger club_meeting_ballot_history_append_only before update or delete on public.club_meeting_ballot_history
  for each row execute function private.club_append_only();
drop trigger if exists club_meeting_ballots_no_delete on public.club_meeting_ballots;
create trigger club_meeting_ballots_no_delete before delete on public.club_meeting_ballots for each row execute function private.club_no_delete();
create or replace function private.club_ballot_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.question_id <> old.question_id or new.voter_membership_id <> old.voter_membership_id then raise exception 'a ballot cannot be moved' using errcode = '42501'; end if;
  if (select status from public.club_meeting_questions where id = old.question_id) <> 'open' then raise exception 'this question is not open' using errcode = '42501'; end if;
  return new;
end $$;
revoke execute on function private.club_ballot_guard() from public, anon, authenticated;
drop trigger if exists club_meeting_ballots_guard on public.club_meeting_ballots;
create trigger club_meeting_ballots_guard before update on public.club_meeting_ballots for each row execute function private.club_ballot_guard();
create or replace function private.club_question_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'a question that was opened cannot be removed' using errcode = '42501'; end if;
    return old;
  end if;
  if new.meeting_id <> old.meeting_id or new.kind <> old.kind or new.office is distinct from old.office then raise exception 'a question cannot change its meeting, kind or office' using errcode = '42501'; end if;
  if old.status = 'closed' and (new.status <> 'closed' or new.result is distinct from old.result or new.options <> old.options) then raise exception 'a closed question is final' using errcode = '42501'; end if;
  if old.status = 'open' and new.status = 'draft' then raise exception 'an opened question cannot go back to draft' using errcode = '42501'; end if;
  return new;
end $$;
revoke execute on function private.club_question_guard() from public, anon, authenticated;
drop trigger if exists club_meeting_questions_guard on public.club_meeting_questions;
create trigger club_meeting_questions_guard before update or delete on public.club_meeting_questions for each row execute function private.club_question_guard();

-- ---------------------------------------------------------------- part 2: helpers
create or replace function private.club_is_vote_officer(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.club_vote_officers o join auth.users u on lower(u.email) = o.email where o.team_id = p_team and u.id = auth.uid())
$$;
create or replace function private.club_question(p_question uuid) returns public.club_meeting_questions
language plpgsql stable security definer set search_path = '' as $$
declare q public.club_meeting_questions;
begin
  select * into q from public.club_meeting_questions where id = p_question;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  return q;
end $$;
create or replace function private.club_question_options(q public.club_meeting_questions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when q.kind = 'motion' then '[{"key":"yes","label":"Yes"},{"key":"no","label":"No"},{"key":"abstain","label":"Abstain"}]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object('key', n.nominee_membership_id::text, 'label', c.full_name) order by lower(c.full_name))
                   from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id
                   where n.meeting_id = q.meeting_id and n.office = q.office and n.status = 'accepted'), '[]'::jsonb)
         || '[{"key":"abstain","label":"Abstain"}]'::jsonb end
$$;
create or replace function private.club_question_tally(p_question uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'options', coalesce((select jsonb_agg(jsonb_build_object('key', o ->> 'key', 'label', o ->> 'label',
        'votes', (select count(*) from public.club_meeting_ballots b where b.question_id = q.id and b.choice = o ->> 'key')) order by ord)
      from jsonb_array_elements(q.options) with ordinality as x(o, ord)), '[]'::jsonb),
    'total', (select count(*) from public.club_meeting_ballots b where b.question_id = q.id),
    'eligible', (select count(*) from public.club_memberships cm cross join lateral private.club_vote_check(cm.id, private.club_meeting_day(q.meeting_id)) c
                 where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and c.eligible))
  from public.club_meeting_questions q join public.club_meetings mt on mt.id = q.meeting_id where q.id = p_question
$$;
revoke execute on function private.club_is_vote_officer(uuid), private.club_question(uuid), private.club_question_options(public.club_meeting_questions),
  private.club_question_tally(uuid) from public, anon, authenticated;
create or replace function private.club_question_manage_check(p_team uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_change_club_dues(p_team) then raise exception 'only the club''s President, Secretary or Treasurer can run the vote' using errcode = '42501'; end if;
end $$;
revoke execute on function private.club_question_manage_check(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- part 3b: open and close a question
create or replace function public.open_club_question(p_question uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_opts jsonb;
begin
  q := private.club_question(p_question);
  perform private.club_question_manage_check(private.club_meeting_team(q.meeting_id));
  if q.status <> 'draft' then raise exception 'this question was already opened' using errcode = '22023'; end if;
  v_opts := private.club_question_options(q);
  if q.kind = 'election' and jsonb_array_length(v_opts) < 2 then raise exception 'no accepted candidate for this office yet: the election cannot open' using errcode = '22023'; end if;
  update public.club_meeting_questions set status = 'open', opened_at = now(), options = v_opts where id = p_question;
  perform private.audit(null, 'club.question_opened', p_question::text, jsonb_build_object('meeting', q.meeting_id, 'options', jsonb_array_length(v_opts)));
end $$;

create or replace function public.close_club_question(p_question uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_res jsonb;
begin
  q := private.club_question(p_question);
  perform private.club_question_manage_check(private.club_meeting_team(q.meeting_id));
  if q.status <> 'open' then raise exception 'only an open question can be closed' using errcode = '22023'; end if;
  v_res := private.club_question_tally(p_question) || jsonb_build_object('closed_at', now());
  update public.club_meeting_questions set status = 'closed', closed_at = now(), closed_by = auth.uid(), result = v_res where id = p_question;
  perform private.audit(null, 'club.question_closed', p_question::text, jsonb_build_object('meeting', q.meeting_id, 'total', v_res -> 'total'));
  return v_res;
end $$;

-- ---------------------------------------------------------------- part 4a: the questions as the caller may see them
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
        'id', q.id, 'kind', q.kind, 'office', q.office, 'title', q.title, 'details', q.details, 'status', q.status, 'options', q.options,
        'opened_at', q.opened_at, 'closed_at', q.closed_at, 'sort_order', q.sort_order,
        'ballots_in', (select count(*) from public.club_meeting_ballots b where b.question_id = q.id),
        'eligible_count', (select count(*) from public.club_memberships cm cross join lateral private.club_vote_check(cm.id, v_day) c
                           where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and c.eligible),
        'tally', case when q.status = 'closed' then q.result when v_exec and q.status = 'open' then private.club_question_tally(q.id) end,
        'my_ballots', case when v_me.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('membership_id', b.voter_membership_id, 'choice', b.choice, 'changed_at', b.changed_at))
            from public.club_meeting_ballots b where b.question_id = q.id
              and (b.voter_membership_id = v_me.id or b.voter_membership_id in (select p.grantor_membership_id from public.club_meeting_proxies p where p.meeting_id = mt.id and p.holder_membership_id = v_me.id and p.status = 'active'))), '[]'::jsonb) end)
        order by q.sort_order, q.created_at)
      from public.club_meeting_questions q where q.meeting_id = p_meeting and (q.status <> 'draft' or v_exec)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- part 3c: casting a ballot
create or replace function public.cast_club_ballot(p_question uuid, p_choice text, p_for_membership uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; mt public.club_meetings; v_me public.club_memberships; v_voter public.club_memberships; v_day date;
  v_ok boolean; v_reasons text[]; v_old public.club_meeting_ballots; v_proxy public.club_meeting_proxies; v_problem text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  q := private.club_question(p_question);
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

-- ---------------------------------------------------------------- part 4b: the returning officer's view of one question (every look is audited)
create or replace function public.club_question_ballots(p_question uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_team uuid;
begin
  q := private.club_question(p_question);
  v_team := private.club_meeting_team(q.meeting_id);
  if not private.club_is_vote_officer(v_team) then raise exception 'only the club''s returning officer can see individual ballots' using errcode = '42501'; end if;
  perform private.audit(null, 'club.ballots_viewed', p_question::text, jsonb_build_object('meeting', q.meeting_id));
  return jsonb_build_object('question', jsonb_build_object('id', q.id, 'title', q.title, 'status', q.status, 'options', q.options),
    'ballots', coalesce((select jsonb_agg(jsonb_build_object('voter', v.full_name, 'voter_membership_id', v.id, 'cast_by', case when b.cast_by_membership_id = v.id then null else c.full_name end,
        'choice', b.choice, 'label', coalesce((select o ->> 'label' from jsonb_array_elements(q.options) o where o ->> 'key' = b.choice), b.choice),
        'cast_at', b.cast_at, 'changed_at', b.changed_at,
        'changes', (select count(*) from public.club_meeting_ballot_history hh where hh.question_id = q.id and hh.voter_membership_id = v.id) - 1) order by lower(v.full_name))
      from public.club_meeting_ballots b join public.club_memberships v on v.id = b.voter_membership_id join public.club_memberships c on c.id = b.cast_by_membership_id
      where b.question_id = p_question), '[]'::jsonb),
    'not_voted', coalesce((select jsonb_agg(cm.full_name order by lower(cm.full_name)) from public.club_memberships cm join public.club_meetings mt on mt.id = q.meeting_id
      cross join lateral private.club_vote_check(cm.id, private.club_meeting_day(mt.id)) e
      where cm.team_id = mt.team_id and cm.membership_year = mt.membership_year and e.eligible
        and not exists (select 1 from public.club_meeting_ballots b where b.question_id = q.id and b.voter_membership_id = cm.id)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- part 3a: create / edit a question
create or replace function public.create_club_question(p_meeting uuid, p_kind text, p_title text, p_details text default null, p_office text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mt public.club_meetings; v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_details text := nullif(btrim(coalesce(p_details, '')), ''); q public.club_meeting_questions;
begin
  select * into mt from public.club_meetings where id = p_meeting;
  if not found then raise exception 'meeting not found' using errcode = 'P0002'; end if;
  perform private.club_question_manage_check(mt.team_id);
  if p_kind not in ('election', 'motion') then raise exception 'a question is an election or a motion' using errcode = '22023'; end if;
  if p_kind = 'election' and (p_office is null or p_office not in ('president', 'secretary', 'treasurer')) then raise exception 'choose the office being elected' using errcode = '22023'; end if;
  if p_kind = 'motion' and p_office is not null then raise exception 'a motion has no office' using errcode = '22023'; end if;
  if p_kind = 'election' and v_title = '' then v_title := 'Election: ' || private.club_office_label(p_office); end if;
  if char_length(v_title) < 3 or char_length(v_title) > 160 then raise exception 'give the question a short title (3 to 160 characters)' using errcode = '22023'; end if;
  if v_details is not null and char_length(v_details) > 2000 then raise exception 'keep the details under 2000 characters' using errcode = '22023'; end if;
  insert into public.club_meeting_questions (meeting_id, kind, office, title, details, created_by, sort_order)
    values (p_meeting, p_kind, case when p_kind = 'election' then p_office end, v_title, v_details, auth.uid(),
            coalesce((select max(sort_order) + 1 from public.club_meeting_questions where meeting_id = p_meeting), 1))
    returning * into q;
  update public.club_meeting_questions set options = private.club_question_options(q) where id = q.id;
  perform private.audit(null, 'club.question_created', q.id::text, jsonb_build_object('meeting', p_meeting, 'kind', p_kind, 'office', p_office));
  return q.id;
end $$;

create or replace function public.update_club_question(p_question uuid, p_title text, p_details text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.club_meeting_questions; v_title text := btrim(coalesce(p_title, '')); v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  q := private.club_question(p_question);
  perform private.club_question_manage_check(private.club_meeting_team(q.meeting_id));
  if q.status <> 'draft' then raise exception 'only a question that has not been opened can be edited' using errcode = '22023'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 160 then raise exception 'give the question a short title (3 to 160 characters)' using errcode = '22023'; end if;
  if v_details is not null and char_length(v_details) > 2000 then raise exception 'keep the details under 2000 characters' using errcode = '22023'; end if;
  update public.club_meeting_questions set title = v_title, details = v_details where id = p_question;
end $$;

-- ---------------------------------------------------------------- part 4c: grants and the club's returning officer
revoke execute on function
  public.create_club_question(uuid, text, text, text, text), public.update_club_question(uuid, text, text),
  public.open_club_question(uuid), public.close_club_question(uuid), public.cast_club_ballot(uuid, text, uuid),
  public.club_question_list(uuid), public.club_question_ballots(uuid)
from public, anon;
grant execute on function
  public.create_club_question(uuid, text, text, text, text), public.update_club_question(uuid, text, text),
  public.open_club_question(uuid), public.close_club_question(uuid), public.cast_club_ballot(uuid, text, uuid),
  public.club_question_list(uuid), public.club_question_ballots(uuid)
to authenticated;

-- the Red Deer Reavers' returning officer (owner decision 2026-10-08)
insert into public.club_vote_officers (team_id, email, note)
  select t.id, 'dothecoolwip@gmail.com', 'club owner: runs the AGM vote and may see individual ballots if a result is questioned'
  from public.teams t where t.slug = 'red-deer-reavers'
on conflict do nothing;
