-- Pack 22: fixes from the skeptical QA pass over 20261015000500_pack22_discipline.sql. Additive: functions replaced, triggers and grants added, two
-- data rows of the Buhurt International appeal rule corrected to the official text. Each block names the finding it closes.

-- ---------------------------------------------------------------- shared: does a fighter / team take part in an event
-- An accepted or pending registration, or an entry (or a roster place) in one of the event's competitions. Same rule as issue_event_sanction.
create or replace function private.takes_part(p_event uuid, p_fighter uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_fighter is not null then
      exists (select 1 from public.registrations g where g.event_id = p_event and g.fighter_id = p_fighter and g.status in ('accepted', 'pending'))
      or exists (select 1 from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = p_event and en.fighter_id = p_fighter)
      or exists (select 1 from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where k.event_id = p_event and ef.fighter_id = p_fighter)
    when p_team is not null then
      exists (select 1 from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = p_event and en.team_id = p_team)
      or exists (select 1 from public.registrations g where g.event_id = p_event and g.team_id = p_team)
    else false end
$$;
revoke execute on function private.takes_part(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- finding 6: an event suspension only for someone taking part in that event
create or replace function private.suspension_subject_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.authority = 'event' and new.supersedes_id is null and not private.takes_part(new.event_id, new.fighter_id, new.team_id) then
    raise exception '% is not taking part in this event: an event suspension is for its participants (an organization or the platform suspends others)',
      case when new.fighter_id is not null then 'that fighter' else 'that team' end using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.suspension_subject_check() from public, anon, authenticated;
drop trigger if exists discipline_suspensions_subject_check on public.discipline_suspensions;
create trigger discipline_suspensions_subject_check before insert on public.discipline_suspensions for each row execute function private.suspension_subject_check();

-- ---------------------------------------------------------------- finding 15: an organization suspension covers the events the organization runs,
-- including events whose organization comes from their season (private.event_org), like every other organization check.
create or replace function private.suspension_applies(s public.discipline_suspensions, p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.lifted_at is null and s.superseded_by is null and exists (
    select 1 from public.events e where e.id = p_event
      and s.starts_at::date <= e.ends_on and (s.ends_at is null or s.ends_at::date >= e.starts_on)
      and case s.authority when 'platform' then true
                           when 'organization' then s.organization_id is not null and private.event_org(e.id) is not distinct from s.organization_id
                           when 'event' then s.event_id = p_event end)
$$;
revoke execute on function private.suspension_applies(public.discipline_suspensions, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- findings 2 and 3: eligibility at acceptance, check-in, entry and roster
-- Acceptance: a team-only registration is refused too when the team is suspended (the fighter condition is gone).
create or replace function private.registration_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_why text;
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') and not new.is_volunteer then
    v_why := private.discipline_block_reason(new.fighter_id, new.event_id, new.team_id);
    if v_why is not null then raise exception 'cannot accept: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke execute on function private.registration_discipline_check() from public, anon, authenticated;

-- Check-in: the registration's team counts (a team suspension blocks its people at the desk, as readiness already says).
create or replace function private.checkin_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_why text;
begin
  if new.check_name = 'checked_in' and new.passed then
    select * into v_r from public.registrations where id = new.registration_id;
    if found and not v_r.is_volunteer then
      v_why := private.discipline_block_reason(v_r.fighter_id, v_r.event_id, v_r.team_id);
      if v_why is not null then raise exception 'cannot check in: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.checkin_discipline_check() from public, anon, authenticated;

-- Entries: also when a withdrawn or disqualified entry is put back (add_entrant re-activates the old row). Roster places: the entry's team counts.
-- Entries and rosters that existed BEFORE a suspension are not removed or rewritten: readiness shows the person NOT READY with the reason, and the
-- organizer withdraws the entry through the normal path.
create or replace function private.entry_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_why text; v_team uuid; v_comp uuid;
begin
  if tg_table_name = 'entries' then
    if tg_op = 'UPDATE' and new.fighter_id is not distinct from old.fighter_id and new.team_id is not distinct from old.team_id and new.competition_id = old.competition_id
       and not (old.status in ('withdrawn', 'disqualified') and new.status in ('registered', 'checked_in')) then return new; end if;
    if new.status in ('withdrawn', 'disqualified') then return new; end if;
    v_why := private.discipline_entry_block(new.fighter_id, new.team_id, new.competition_id);
  else
    if tg_op = 'UPDATE' and new.fighter_id = old.fighter_id and new.entry_id = old.entry_id then return new; end if;
    -- from the entry itself: set_entry_roster leaves competition_id to a later trigger (triggers run in name order)
    select en.team_id, en.competition_id into v_team, v_comp from public.entries en where en.id = new.entry_id;
    v_why := private.discipline_entry_block(new.fighter_id, v_team, coalesce(v_comp, new.competition_id));
  end if;
  if v_why is not null then raise exception 'cannot enter: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.entry_discipline_check() from public, anon, authenticated;

-- ---------------------------------------------------------------- finding 8: a team or fighter with disciplinary records is never deleted
-- (merge_teams deletes the removed team). Refused with a clear message before the history's append-only guard would refuse it obscurely.
create or replace function private.discipline_subject_delete_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'teams' then
    if exists (select 1 from public.event_sanctions where team_id = old.id) or exists (select 1 from public.discipline_suspensions where team_id = old.id)
       or exists (select 1 from public.discipline_reviews where team_id = old.id) or exists (select 1 from public.discipline_history where team_id = old.id) then
      raise exception 'this team has disciplinary records, which are permanent: keep this team when merging (merge the other one into it)' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from public.event_sanctions where fighter_id = old.id) or exists (select 1 from public.discipline_suspensions where fighter_id = old.id)
       or exists (select 1 from public.discipline_reviews where fighter_id = old.id) or exists (select 1 from public.authenticity_findings where fighter_id = old.id)
       or exists (select 1 from public.discipline_history where fighter_id = old.id) then
      raise exception 'this fighter has disciplinary records, which are permanent' using errcode = 'P0001';
    end if;
  end if;
  return old;
end $$;
revoke execute on function private.discipline_subject_delete_guard() from public, anon, authenticated;
drop trigger if exists teams_discipline_delete_guard on public.teams;
create trigger teams_discipline_delete_guard before delete on public.teams for each row execute function private.discipline_subject_delete_guard();
drop trigger if exists fighters_discipline_delete_guard on public.fighters;
create trigger fighters_discipline_delete_guard before delete on public.fighters for each row execute function private.discipline_subject_delete_guard();

-- ---------------------------------------------------------------- finding 13: the green card, worded and checked by the official text
-- Infractions 3: "A competitor can receive only 1 green card per tournament"; Tournament Structure 2: green cards "follow the competitor from tournament
-- to tournament". A tournament is a category (Tournament Structure 6), i.e. a BuhurtOS competition. Read together: while a green card is in force it
-- is the competitor's green card in every tournament of the event, so a second one is refused until the first is removed. Green cards given on the
-- field tablet (Pack 13 records) count as well.
comment on index public.event_sanctions_one_green_card is
  'Pack 22: one green card in force per competitor at an event (Infractions 3: one per tournament; Tournament Structure 2: it follows the competitor into every tournament).';

create or replace function private.green_card_in_force(p_event uuid, p_fighter uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_sanctions where event_id = p_event and fighter_id = p_fighter and card_key = 'green_card' and status = 'active')
      or exists (select 1 from public.match_discipline d join public.matches m on m.id = d.match_id
                   left join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
                  where d.event_id = p_event and d.card_key = 'green_card' and d.voided_at is null
                    and (en.fighter_id = p_fighter or exists (select 1 from public.entry_fighters ef where ef.entry_id = en.id and ef.fighter_id = p_fighter)))
$$;
revoke execute on function private.green_card_in_force(uuid, uuid) from public, anon, authenticated;

create or replace function public.issue_event_sanction(p_command uuid, p_event uuid, p_kind text, p_fighter uuid default null, p_team uuid default null,
  p_competition uuid default null, p_card_key text default null, p_provision uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.event_sanctions; v_label text; v_version uuid; v_reason text := private.clean_text(p_reason, 300);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null or p_event is null then raise exception 'a command id and an event are required' using errcode = '22023'; end if;
  select * into v_old from public.event_sanctions where id = p_command;
  if found then
    if v_old.event_id <> p_event then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  if not (private.can_resolve_results(p_event) or (p_kind = 'card' and p_card_key = 'green_card' and private.can_inspect(p_event))) then
    raise exception 'only the head marshal or an organizer (or, for a green card, the authenticity officer) can give a sanction' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('warning', 'card', 'removal', 'disqualification', 'team_disqualification') then raise exception 'unknown kind of sanction' using errcode = '22023'; end if;
  if (p_fighter is null) = (p_team is null) then raise exception 'name either a fighter or a team' using errcode = '22023'; end if;
  if p_kind = 'team_disqualification' and p_team is null then raise exception 'a team disqualification names a team' using errcode = '22023'; end if;
  if p_competition is not null and not exists (select 1 from public.competitions where id = p_competition and event_id = p_event) then raise exception 'that competition is not at this event' using errcode = '22023'; end if;
  if not private.takes_part(p_event, p_fighter, p_team) then
    raise exception '% is not taking part in this event', case when p_fighter is not null then 'that fighter' else 'that team' end using errcode = '22023'; end if;
  if p_kind = 'card' then
    if p_card_key is null then raise exception 'choose a card' using errcode = '22023'; end if;
    select c ->> 'label' into v_label from jsonb_array_elements(private.lyst_settings_for(p_event) -> 'cards') c where c ->> 'key' = p_card_key limit 1;
    if v_label is null then
      select t.label into v_label from public.discipline_card_types t where t.key = p_card_key and t.issued_at_event limit 1;
    end if;
    if v_label is null then raise exception 'that card type is not set up for this event' using errcode = '22023'; end if;
    if p_card_key = 'green_card' and p_fighter is null then raise exception 'a green card is given to a competitor' using errcode = '22023'; end if;
    if p_card_key = 'green_card' and private.green_card_in_force(p_event, p_fighter) then
      raise exception 'this competitor already has a green card in force at this event: it follows them into every tournament, and a competitor receives only one green card per tournament (Infractions 3, Tournament Structure 2). Remove it first if the correction was validated'
        using errcode = 'P0001'; end if;
  elsif p_card_key is not null then raise exception 'only a card has a card type' using errcode = '22023'; end if;
  v_version := private.check_cited_provision(p_provision, p_event);
  insert into public.event_sanctions (id, event_id, competition_id, fighter_id, team_id, kind, card_key, label, provision_id, ruleset_version_id)
  values (p_command, p_event, p_competition, p_fighter, p_team, p_kind, p_card_key, v_label, p_provision, v_version);
  insert into public.event_sanctions_private (sanction_id, reason, issued_by) values (p_command, v_reason, auth.uid());
  perform private.discipline_log(p_event, private.event_org(p_event), p_fighter, p_team, 'event_sanction', p_command, 'issued',
    jsonb_build_object('kind', p_kind, 'card', p_card_key, 'competition', p_competition, 'provision', p_provision));
  perform private.audit(p_event, 'discipline.sanction_issued', p_command::text, jsonb_build_object('kind', p_kind, 'card', p_card_key, 'fighter', p_fighter, 'team', p_team, 'competition', p_competition));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

-- The event appeal, as the official texts put it. Buhurt Regulations 7.1/7.2 and Duel Regulations 5.1/5.2: to the Secretary, in person, within
-- 15 minutes after the end of the match and before the next phase. Outrance 16.3: to the Knight Marshal, at the end of the fight or in person within
-- 15 minutes. Outcomes: Buhurt Regulations 7.4, Duel Regulations 5.4, Outrance 16.4 (point deduction); "kept" = not approved (7.1 / 5.1: "If an
-- appeal is approved ...", so an appeal can also be refused).
update public.discipline_review_rules
   set outcomes = array['rematch_round', 'restart', 'cards_imposed', 'cards_withdrawn', 'point_deduction_imposed', 'point_deduction_withdrawn', 'kept'],
       sources = array['buhurt-regulations:7.1', 'buhurt-regulations:7.2', 'buhurt-regulations:7.4', 'duel-regulations:5.1', 'duel-regulations:5.2', 'duel-regulations:5.4',
                       'outrance-rules:16.3', 'outrance-rules:16.4'],
       note = 'Buhurt and Duel Regulations: to the Secretary, in person, within 15 minutes after the end of the match and before the next phase. Outrance 16.3: to the Knight Marshal, within 15 minutes. Decided by the Knight Marshal.'
 where governing_body = 'Buhurt International' and kind = 'event_appeal';

-- ---------------------------------------------------------------- finding 4: an event appeal's deadline runs from the end of the fight, never set by hand
-- ---------------------------------------------------------------- finding 10: an appeal about a fight is about a fight of this event
create or replace function public.lodge_review(p_command uuid, p_kind text, p_lodged_by text, p_grounds text, p_match_discipline uuid default null, p_event_sanction uuid default null,
  p_suspension uuid default null, p_match uuid default null, p_governing_body text default 'Buhurt International', p_from timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.discipline_reviews; v_rule public.discipline_review_rules; v_event uuid; v_org uuid; v_fighter uuid; v_team uuid; v_entry uuid; v_from timestamptz; v_due timestamptz;
  v_md public.match_discipline; v_es public.event_sanctions; v_su public.discipline_suspensions; v_state text; v_final timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  select * into v_old from public.discipline_reviews where id = p_command;
  if found then return jsonb_build_object('status', 'duplicate', 'id', p_command); end if;
  select * into v_rule from public.discipline_review_rules where governing_body = btrim(coalesce(p_governing_body, '')) and kind = p_kind;
  if not found then raise exception 'no % review is defined for %', p_kind, p_governing_body using errcode = '22023'; end if;
  if p_kind = 'event_appeal' and p_from is not null then
    raise exception 'an event appeal''s deadline runs from the end of the fight; it is not set by hand' using errcode = '22023'; end if;
  if num_nonnulls(p_match_discipline, p_event_sanction, p_suspension, p_match) <> 1 then raise exception 'name the one record (or fight) this is about' using errcode = '22023'; end if;
  if p_match_discipline is not null then
    select * into v_md from public.match_discipline where id = p_match_discipline;
    if not found then raise exception 'record not found' using errcode = 'P0002'; end if;
    v_event := v_md.event_id;
    select case v_md.side when 'a' then m.entry_a else m.entry_b end, m.queue_state, m.finalized_at into v_entry, v_state, v_final from public.matches m where m.id = v_md.match_id;
  elsif p_match is not null then
    v_event := private.event_of_match(p_match);
    if v_event is null then raise exception 'fight not found' using errcode = 'P0002'; end if;
    select m.queue_state, m.finalized_at into v_state, v_final from public.matches m where m.id = p_match;
  elsif p_event_sanction is not null then
    select * into v_es from public.event_sanctions where id = p_event_sanction;
    if not found then raise exception 'sanction not found' using errcode = 'P0002'; end if;
    v_event := v_es.event_id; v_fighter := v_es.fighter_id; v_team := v_es.team_id;
  else
    select * into v_su from public.discipline_suspensions where id = p_suspension;
    if not found then raise exception 'suspension not found' using errcode = 'P0002'; end if;
    v_event := v_su.event_id; v_fighter := v_su.fighter_id; v_team := v_su.team_id;
    if p_kind = 'event_appeal' then raise exception 'a suspension is reviewed by the Judiciary Committee, not appealed at the event' using errcode = '22023'; end if;
  end if;
  if v_entry is not null then select en.fighter_id, en.team_id into v_fighter, v_team from public.entries en where en.id = v_entry; end if;
  v_org := coalesce(v_su.organization_id, private.event_org(v_event));
  if p_kind = 'event_appeal' then
    if v_event is null then raise exception 'an event appeal is about something at an event' using errcode = '22023'; end if;
    if not private.can_score(v_event) then raise exception 'appeals are lodged with the Secretary or an official of this event' using errcode = '42501'; end if;
  elsif not private.can_decide_review(p_kind, v_event, v_org) then
    raise exception 'a Judiciary Committee review is recorded by the platform owner or an admin of the event''s organization' using errcode = '42501';
  end if;
  v_from := case when p_kind = 'event_appeal' then coalesce(v_final, clock_timestamp()) else coalesce(p_from, clock_timestamp()) end;
  v_due := v_from + v_rule.window_interval;
  insert into public.discipline_reviews (id, event_id, organization_id, governing_body, kind, match_discipline_id, event_sanction_id, suspension_id, match_id, fighter_id, team_id, lodged_by_name, grounds, due_by, recorded_by)
  values (p_command, v_event, v_org, v_rule.governing_body, p_kind, p_match_discipline, p_event_sanction, p_suspension, coalesce(p_match, v_md.match_id), v_fighter, v_team,
          coalesce(private.clean_text(p_lodged_by, 80), 'unknown'), coalesce(private.clean_text(p_grounds, 500), ''), v_due, auth.uid());
  perform private.discipline_log(v_event, v_org, v_fighter, v_team, 'review', p_command, 'lodged',
    jsonb_build_object('kind', p_kind, 'due_by', v_due, 'late', p_kind = 'event_appeal' and clock_timestamp() > v_due));
  perform private.audit(v_event, 'discipline.review_lodged', p_command::text, jsonb_build_object('kind', p_kind, 'due_by', v_due, 'late', p_kind = 'event_appeal' and clock_timestamp() > v_due));
  return jsonb_build_object('status', 'ok', 'id', p_command, 'due_by', v_due, 'late', p_kind = 'event_appeal' and clock_timestamp() > v_due);
end $$;

-- ---------------------------------------------------------------- finding 5: withdrawing an appeal is the Secretary's or the decider's act, with a reason, audited
create or replace function private.can_withdraw_review(p_kind text, p_event uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.can_decide_review(p_kind, p_event, p_org), false)
      or (p_kind = 'event_appeal' and p_event is not null and coalesce(private.has_event_role(p_event, array['scorekeeper']), false))
$$;
revoke execute on function private.can_withdraw_review(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.withdraw_review(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.discipline_reviews; v_reason text := private.clean_text(p_reason, 300);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.discipline_reviews where id = p_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if not private.can_withdraw_review(v.kind, v.event_id, v.organization_id) then
    raise exception 'only the Secretary (scorekeeper), the Knight Marshal (head marshal) or an organizer records that an appeal was withdrawn' using errcode = '42501'; end if;
  if v.status <> 'lodged' then return jsonb_build_object('status', 'duplicate'); end if;
  if char_length(coalesce(v_reason, '')) < 3 then raise exception 'say who withdrew it and why (3 to 300 characters)' using errcode = '22023'; end if;
  update public.discipline_reviews set status = 'withdrawn' where id = p_id;
  perform private.discipline_log(v.event_id, v.organization_id, v.fighter_id, v.team_id, 'review', p_id, 'withdrawn', jsonb_build_object('reason', v_reason));
  perform private.audit(v.event_id, 'discipline.review_withdrawn', p_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- finding 1: reasons in the history stay with the people who may read them
-- The subject (fighter, captain) reads what happened and when, never the reason or the decider's name. Reasons: event staff for event sanctions and
-- reviews, the issuing authority for suspensions.
create or replace function public.discipline_record_history(p_entity text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean := false; v_staff boolean := false; v_ids uuid[] := array[p_id]; v_next uuid; s public.discipline_suspensions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_entity = 'suspension' then
    select * into s from public.discipline_suspensions where id = p_id;
    if found then
      v_staff := private.can_manage_suspension(s.authority, s.event_id, s.organization_id);
      v_ok := v_staff or private.is_my_fighter(s.fighter_id) or (s.team_id is not null and private.is_team_captain(s.team_id)) or (s.authority = 'event' and private.can_see_discipline(s.event_id));
    end if;
    loop select supersedes_id into v_next from public.discipline_suspensions where id = v_ids[1]; exit when v_next is null; v_ids := v_next || v_ids; end loop;
    loop select superseded_by into v_next from public.discipline_suspensions where id = v_ids[cardinality(v_ids)]; exit when v_next is null; v_ids := v_ids || v_next; end loop;
  elsif p_entity = 'event_sanction' then
    select coalesce(bool_or(private.can_see_discipline(x.event_id)), false), coalesce(bool_or(private.can_see_discipline(x.event_id) or private.is_my_fighter(x.fighter_id) or (x.team_id is not null and private.is_team_captain(x.team_id))), false)
      into v_staff, v_ok from public.event_sanctions x where x.id = p_id;
  elsif p_entity = 'review' then
    select coalesce(bool_or((r.event_id is not null and private.can_see_discipline(r.event_id)) or private.can_decide_review(r.kind, r.event_id, r.organization_id)), false),
           coalesce(bool_or((r.event_id is not null and private.can_see_discipline(r.event_id)) or private.can_decide_review(r.kind, r.event_id, r.organization_id) or private.is_my_fighter(r.fighter_id)
                            or (r.team_id is not null and private.is_team_captain(r.team_id))), false)
      into v_staff, v_ok from public.discipline_reviews r where r.id = p_id;
  elsif p_entity = 'finding' then
    select coalesce(bool_or(private.can_read_findings(a.event_id)), false) into v_ok from public.authenticity_findings a where a.id = p_id;
    v_staff := v_ok;
  end if;
  if not v_ok then raise exception 'not found or not yours to read' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('entity_id', h.entity_id, 'action', h.action, 'at', h.at,
      'details', case when v_staff then h.details else h.details - 'reason' - 'note' end,
      'by', case when v_staff then private.person_name(h.actor) end) order by h.at, h.id)
    from public.discipline_history h where h.entity = p_entity and h.entity_id = any (v_ids)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- finding 7: eligibility, per subject, for people who may ask about that subject
create or replace function public.discipline_eligibility(p_event uuid, p_fighter uuid default null, p_team uuid default null)
returns table (kind text, code text, message text, source_key text)
language plpgsql stable security definer set search_path = '' as $$
declare v_staff boolean;
begin
  if auth.uid() is null or p_event is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_fighter is null and p_team is null then raise exception 'name a fighter or a team' using errcode = '22023'; end if;
  v_staff := private.can_see_discipline(p_event) or private.is_organizer(p_event);
  if p_fighter is not null and not ((v_staff and private.takes_part(p_event, p_fighter, null)) or private.is_my_fighter(p_fighter)) then
    raise exception 'only this event''s staff (about its participants) or the fighter can see this' using errcode = '42501'; end if;
  if p_team is not null and not ((v_staff and private.takes_part(p_event, null, p_team)) or private.is_team_captain(p_team)
      or (private.is_my_fighter(p_fighter) and (exists (select 1 from public.fighters f where f.id = p_fighter and f.team_id = p_team)
            or exists (select 1 from public.registrations g where g.event_id = p_event and g.fighter_id = p_fighter and g.team_id = p_team)))) then
    raise exception 'only this event''s staff (about its participants), the team''s captain or its own fighters can see this' using errcode = '42501'; end if;
  return query
  select 'block'::text, 'suspended'::text, private.suspension_label(s), (select rp.stable_key from public.rule_provisions rp where rp.id = s.provision_id)
    from public.discipline_suspensions s
   where ((p_fighter is not null and s.fighter_id = p_fighter) or (p_team is not null and s.team_id = p_team)) and private.suspension_applies(s, p_event)
  union all
  select 'warning', 'green_card', 'Green card at this event' || coalesce(' (' || (select k.name from public.competitions k where k.id = es.competition_id) || ')', ''),
         'infractions:3'
    from public.event_sanctions es where es.event_id = p_event and p_fighter is not null and es.fighter_id = p_fighter and es.card_key = 'green_card' and es.status = 'active'
  union all
  select 'warning', 'card', x.n || ' ' || x.label || case when x.n = 1 then '' else 's' end || ' in ' || x.comp, null
    from (select d.label, k.name as comp, count(*) as n from public.match_discipline d join public.matches m on m.id = d.match_id join public.competitions k on k.id = m.competition_id
            join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
           where d.event_id = p_event and d.kind = 'card' and d.voided_at is null and ((p_fighter is not null and en.fighter_id = p_fighter) or (p_team is not null and en.team_id = p_team))
           group by d.label, k.name) x
  union all
  select 'warning', 'disqualified', 'Disqualified in ' || k.name, null
    from public.match_discipline d join public.matches m on m.id = d.match_id join public.competitions k on k.id = m.competition_id
    join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
   where d.event_id = p_event and d.kind = 'dq' and d.voided_at is null and ((p_fighter is not null and en.fighter_id = p_fighter) or (p_team is not null and en.team_id = p_team))
  union all
  select 'warning', 'authenticity', count(*) || ' open authenticity finding' || case when count(*) = 1 then '' else 's' end || ' (' || string_agg(distinct f.severity, ', ') || ')', 'infractions:2'
    from public.authenticity_findings f where f.event_id = p_event and p_fighter is not null and f.fighter_id = p_fighter and f.status = 'open' having count(*) > 0
  union all
  select 'warning', 'review', 'Appeal or review open: ' || replace(r.kind, '_', ' '), null
    from public.discipline_reviews r where r.event_id = p_event and r.status = 'lodged' and ((p_fighter is not null and r.fighter_id = p_fighter) or (p_team is not null and r.team_id = p_team));
end $$;

-- ---------------------------------------------------------------- findings 10 and 11: the desk overview
-- * 'fights': the event's fights that have started or finished, so an appeal about a fight where nothing was recorded can be lodged (BI 7.3);
-- * event suspension reasons only for the people who issue and lift them (head marshal, organizer), as discipline_suspensions_private says;
-- * 'can.withdraw_appeal' for the desk.
create or replace function public.event_discipline_overview(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mgr boolean;
begin
  if auth.uid() is null or not private.can_see_discipline(p_event) then raise exception 'only this event''s officials can read its discipline desk' using errcode = '42501'; end if;
  v_mgr := private.can_manage_suspension('event', p_event, null);
  return jsonb_build_object(
    'sanctions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'card_key', s.card_key, 'label', s.label, 'status', s.status, 'created_at', s.created_at, 'ended_at', s.ended_at,
        'fighter_id', s.fighter_id, 'team_id', s.team_id, 'against', coalesce(f.display_name, t.name), 'competition', k.name, 'reason', sp.reason, 'end_reason', sp.end_reason,
        'issued_by_name', private.person_name(sp.issued_by), 'rule', case when rp.id is not null then jsonb_build_object('id', rp.id, 'number', rp.number, 'title', rp.title, 'document', rs.name, 'version', rv.version) end)
        order by s.created_at desc)
      from public.event_sanctions s join public.event_sanctions_private sp on sp.sanction_id = s.id left join public.fighters f on f.id = s.fighter_id left join public.teams t on t.id = s.team_id
      left join public.competitions k on k.id = s.competition_id left join public.rule_provisions rp on rp.id = s.provision_id left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id
      left join public.rulesets rs on rs.id = rv.ruleset_id where s.event_id = p_event), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'registration_id', a.registration_id, 'fighter_id', a.fighter_id, 'name', g.full_name, 'severity', a.severity, 'item', a.item,
        'status', a.status, 'created_at', a.created_at, 'note', case when private.can_see_readiness_detail(p_event) or private.can_resolve_results(p_event) then a.note end,
        'rule', case when rp.id is not null then jsonb_build_object('id', rp.id, 'number', rp.number, 'title', rp.title, 'document', rs.name, 'version', rv.version) end) order by a.created_at desc)
      from public.authenticity_findings a join public.registrations g on g.id = a.registration_id left join public.rule_provisions rp on rp.id = a.provision_id
      left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id left join public.rulesets rs on rs.id = rv.ruleset_id where a.event_id = p_event), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'outcome', r.outcome, 'lodged_by_name', r.lodged_by_name, 'grounds', r.grounds,
        'lodged_at', r.lodged_at, 'due_by', r.due_by, 'late', r.lodged_at > r.due_by, 'decision_note', r.decision_note, 'decided_at', r.decided_at,
        'match_discipline_id', r.match_discipline_id, 'event_sanction_id', r.event_sanction_id, 'match_id', r.match_id, 'against', coalesce(f.display_name, t.name)) order by r.lodged_at desc)
      from public.discipline_reviews r left join public.fighters f on f.id = r.fighter_id left join public.teams t on t.id = r.team_id where r.event_id = p_event), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('registration_id', g.id, 'fighter_id', g.fighter_id, 'name', g.full_name, 'message', private.discipline_block_reason(g.fighter_id, p_event, g.team_id)) order by g.full_name)
      from public.registrations g where g.event_id = p_event and g.status in ('accepted', 'pending') and not g.is_volunteer and private.discipline_block_reason(g.fighter_id, p_event, g.team_id) is not null), '[]'::jsonb),
    'event_suspensions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scope', s.scope, 'competition', k.name, 'fighter_id', s.fighter_id, 'team_id', s.team_id, 'against', coalesce(f.display_name, t.name),
        'starts_at', s.starts_at, 'lifted_at', s.lifted_at, 'label', private.suspension_label(s),
        'reason', case when v_mgr then sp.reason end, 'lift_reason', case when v_mgr then sp.lift_reason end) order by s.created_at desc)
      from public.discipline_suspensions s join public.discipline_suspensions_private sp on sp.suspension_id = s.id left join public.fighters f on f.id = s.fighter_id
      left join public.teams t on t.id = s.team_id left join public.competitions k on k.id = s.competition_id where s.authority = 'event' and s.event_id = p_event), '[]'::jsonb),
    'tallies', coalesce((select jsonb_agg(x order by x ->> 'competition', x ->> 'against') from (
      select jsonb_build_object('competition', k.name, 'against', coalesce(f.display_name, t.name), 'fighter_id', en.fighter_id, 'team_id', en.team_id,
             'cards', jsonb_object_agg(coalesce(d.card_key, d.label), d.n)) as x
      from (select m.competition_id, case dd.side when 'a' then m.entry_a else m.entry_b end as entry_id, dd.card_key, dd.label, count(*) as n
              from public.match_discipline dd join public.matches m on m.id = dd.match_id where dd.event_id = p_event and dd.kind = 'card' and dd.voided_at is null group by 1, 2, 3, 4) d
      join public.competitions k on k.id = d.competition_id join public.entries en on en.id = d.entry_id left join public.fighters f on f.id = en.fighter_id left join public.teams t on t.id = en.team_id
      group by k.name, f.display_name, t.name, en.fighter_id, en.team_id) y), '[]'::jsonb),
    'fights', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'competition', k.name, 'round_label', m.round_label, 'field', m.field, 'state', m.queue_state,
        'a', coalesce(fa.display_name, ta.name), 'b', coalesce(fb.display_name, tb.name)) order by coalesce(m.finalized_at, now()) desc, k.name)
      from public.matches m join public.competitions k on k.id = m.competition_id
      left join public.entries ea on ea.id = m.entry_a left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id
      left join public.entries eb on eb.id = m.entry_b left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id
      where k.event_id = p_event and m.queue_state in ('active', 'final')), '[]'::jsonb),
    'can', jsonb_build_object('sanction', private.can_resolve_results(p_event), 'green_card', private.can_inspect(p_event), 'finding', private.can_inspect(p_event),
      'suspend', private.can_resolve_results(p_event), 'lodge_appeal', private.can_score(p_event), 'decide_appeal', private.can_resolve_results(p_event),
      'withdraw_appeal', private.can_withdraw_review('event_appeal', p_event, null)));
end $$;

-- ---------------------------------------------------------------- finding 12: no account ids through direct reads of the desk tables
revoke select on public.event_sanctions_private from authenticated;
grant select (sanction_id, reason, end_reason) on public.event_sanctions_private to authenticated;
revoke select on public.discipline_suspensions_private from authenticated;
grant select (suspension_id, reason, lift_reason) on public.discipline_suspensions_private to authenticated;
revoke select on public.authenticity_findings from authenticated;
grant select (id, event_id, registration_id, fighter_id, severity, item, provision_id, ruleset_version_id, note, status, created_at, closed_at) on public.authenticity_findings to authenticated;

-- Grants on the replaced functions are unchanged (create or replace keeps them); the new helpers are private and executable by nobody but definers.
