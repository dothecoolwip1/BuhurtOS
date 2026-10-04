-- Pack 1 (2026-10-04): the corrective pack after the full-site audit (docs/reviews/2026-10-03-full-site-mobile-desktop-audit.md).
-- Three database changes, all additive:
--   1. Competition setup through controlled functions (create / update / remove), audited, organizer-only, with a trigger that
--      stops anyone (even through the plain REST path the organizer policy allows) from removing a competition that already has
--      entries, registrations or matches, or from changing the category or division once matches exist. Loaders without a
--      signed-in user (seeds, cleanup scripts, migrations) are not affected.
--   2. public.my_events(): the events a signed-in person has a DIRECT relationship with (event staff of any role, their own
--      registration, an entry of their fighter, an entry of a team they captain). The platform owner is not special here.
--      Drafts are returned only to the event's staff and to people who registered while it was published.
--   3. registrations.attend_dates: the calendar days a registrant can attend, chosen from the event's own dates. The old
--      `days` column (sat/sun, Rumble-specific) stays for history and is still accepted.

-- ---------------------------------------------------------------- 1. competition setup
create or replace function private.competitions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Seeds, cleanup and maintenance run as the database owner without a signed-in user; they keep their cascades.
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.entries e where e.competition_id = old.id)
       or exists (select 1 from public.matches m where m.competition_id = old.id)
       or exists (select 1 from public.results r where r.competition_id = old.id)
       or exists (select 1 from public.registration_competitions rc where rc.competition_id = old.id) then
      raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.category, new.gender) is distinct from (old.category, old.gender)
     and exists (select 1 from public.matches m where m.competition_id = old.id) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  if old.status = 'finished' and (new.name, new.category, new.gender, new.ruleset, new.rounds_to_win) is distinct from (old.name, old.category, old.gender, old.ruleset, old.rounds_to_win) then
    raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.competitions_guard() from public, anon, authenticated;
create trigger competitions_guard before update or delete on public.competitions for each row execute function private.competitions_guard();

create or replace function public.create_competition(p_event uuid, p_name text, p_category text, p_gender text default 'open', p_ruleset text default null,
                                                     p_structure text default 'round_robin', p_rounds_to_win integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sort integer; v_name text := left(btrim(coalesce(p_name, '')), 80);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only the organizers of this event can set up its competitions' using errcode = '42501'; end if;
  if char_length(v_name) < 2 then raise exception 'give the competition a name of at least 2 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.ref_categories c where c.code = p_category) then raise exception 'choose a category from the list' using errcode = '22023'; end if;
  if p_gender not in ('open', 'men', 'women') then raise exception 'choose a division: open, men or women' using errcode = '22023'; end if;
  if p_structure not in ('round_robin', 'pools_elimination', 'elimination') then raise exception 'choose a structure from the list' using errcode = '22023'; end if;
  if p_rounds_to_win is not null and (p_rounds_to_win < 1 or p_rounds_to_win > 5) then raise exception 'rounds to win must be between 1 and 5' using errcode = '22023'; end if;
  select coalesce(max(k.sort), 0) + 1 into v_sort from public.competitions k where k.event_id = p_event;
  insert into public.competitions (event_id, name, category, gender, ruleset, structure, rounds_to_win, status, sort)
  values (p_event, v_name, p_category, p_gender, nullif(left(btrim(coalesce(p_ruleset, '')), 120), ''), p_structure, p_rounds_to_win, 'registration', v_sort)
  returning id into v_id;
  perform private.audit(p_event, 'competition.created', v_id::text, jsonb_build_object('name', v_name, 'category', p_category, 'gender', p_gender, 'structure', p_structure, 'rounds_to_win', p_rounds_to_win));
  return v_id;
end $$;
revoke execute on function public.create_competition(uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function public.create_competition(uuid, text, text, text, text, text, integer) to authenticated;

create or replace function public.update_competition(p_comp uuid, p_name text, p_category text, p_gender text, p_ruleset text, p_structure text, p_rounds_to_win integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_event uuid; v_name text := left(btrim(coalesce(p_name, '')), 80); v_has_matches boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions k where k.id = p_comp;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  v_event := v_k.event_id;
  if not private.is_organizer(v_event) then raise exception 'only the organizers of this event can change its competitions' using errcode = '42501'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001'; end if;
  if char_length(v_name) < 2 then raise exception 'give the competition a name of at least 2 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.ref_categories c where c.code = p_category) then raise exception 'choose a category from the list' using errcode = '22023'; end if;
  if p_gender not in ('open', 'men', 'women') then raise exception 'choose a division: open, men or women' using errcode = '22023'; end if;
  if p_structure not in ('round_robin', 'pools_elimination', 'elimination') then raise exception 'choose a structure from the list' using errcode = '22023'; end if;
  if p_rounds_to_win is not null and (p_rounds_to_win < 1 or p_rounds_to_win > 5) then raise exception 'rounds to win must be between 1 and 5' using errcode = '22023'; end if;
  v_has_matches := exists (select 1 from public.matches m where m.competition_id = p_comp);
  if v_has_matches and (p_category, p_gender) is distinct from (v_k.category, v_k.gender) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  update public.competitions set name = v_name, category = p_category, gender = p_gender, ruleset = nullif(left(btrim(coalesce(p_ruleset, '')), 120), ''),
    -- Once a draw exists the structure belongs to the draw (build_schedule sets it); only the setup fields change.
    structure = case when v_has_matches then structure else p_structure end,
    rounds_to_win = p_rounds_to_win
  where id = p_comp;
  perform private.audit(v_event, 'competition.updated', p_comp::text, jsonb_build_object('name', v_name, 'category', p_category, 'gender', p_gender, 'structure', p_structure, 'rounds_to_win', p_rounds_to_win, 'had_matches', v_has_matches));
end $$;
revoke execute on function public.update_competition(uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function public.update_competition(uuid, text, text, text, text, text, integer) to authenticated;

-- Removing a competition is only possible while nothing depends on it. Anything with registrations, entries, matches or results stays
-- (withdraw entries and reopen matches first; a finished competition is a record and never goes away this way).
create or replace function public.delete_competition(p_comp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions k where k.id = p_comp;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only the organizers of this event can remove its competitions' using errcode = '42501'; end if;
  if exists (select 1 from public.entries e where e.competition_id = p_comp)
     or exists (select 1 from public.matches m where m.competition_id = p_comp)
     or exists (select 1 from public.results r where r.competition_id = p_comp)
     or exists (select 1 from public.registration_competitions rc where rc.competition_id = p_comp) then
    raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
  end if;
  delete from public.competitions where id = p_comp;
  perform private.audit(v_k.event_id, 'competition.deleted', p_comp::text, jsonb_build_object('name', v_k.name, 'category', v_k.category, 'gender', v_k.gender));
end $$;
revoke execute on function public.delete_competition(uuid) from public, anon;
grant execute on function public.delete_competition(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. my events
create or replace function public.my_events() returns table (
  id uuid, slug text, name text, status text, event_type text, starts_on date, ends_on date, city text, region text, venue text, registration_mode text,
  synthetic boolean, staff_roles text[], registration_id uuid, registration_status text, fee_due_cents integer, fee_paid boolean, insurance text,
  is_volunteer boolean, checked_in boolean, fighter_entry boolean, captain_entry boolean, pending_registrations integer
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  my_fighters as (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = (select uid from me)),
  staff as (select s.event_id, array_agg(distinct s.role order by s.role) as roles from public.event_staff s where s.user_id = (select uid from me) group by s.event_id),
  regs as (
    select r.event_id, r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer,
           exists (select 1 from public.registration_checks c where c.registration_id = r.id and c.check_name = 'checked_in' and c.passed) as checked_in
    from public.registrations r where r.user_id = (select uid from me)),
  fighter as (
    select distinct k.event_id from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and (e.fighter_id in (select fighter_id from my_fighters)
           or e.id in (select ef.entry_id from public.entry_fighters ef where ef.fighter_id in (select fighter_id from my_fighters)))),
  captain as (
    select distinct k.event_id from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and e.team_id in (select tr.team_id from public.team_roles tr where tr.user_id = (select uid from me) and tr.role = 'captain')),
  ids as (select event_id from staff union select event_id from regs union select event_id from fighter union select event_id from captain)
  select ev.id, ev.slug, ev.name, ev.status, ev.event_type, ev.starts_on, ev.ends_on, ev.city, ev.region, ev.venue, ev.registration_mode,
         private.is_synthetic('event', ev.id),
         coalesce(s.roles, '{}'::text[]), r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer, coalesce(r.checked_in, false),
         ev.id in (select event_id from fighter), ev.id in (select event_id from captain),
         case when coalesce(s.roles, '{}'::text[]) @> array['organizer'] then (select count(*)::integer from public.registrations x where x.event_id = ev.id and x.status = 'pending') end
  from public.events ev
  join ids on ids.event_id = ev.id
  left join staff s on s.event_id = ev.id
  left join regs r on r.event_id = ev.id
  where (select uid from me) is not null
    and (ev.status = 'published' or s.roles is not null or r.id is not null)
  order by ev.starts_on, ev.name
$$;
revoke execute on function public.my_events() from public, anon;
grant execute on function public.my_events() to authenticated;

-- ---------------------------------------------------------------- 3. attendance dates
alter table public.registrations add column if not exists attend_dates date[] not null default '{}';

create or replace function public.submit_registration(p_event uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg uuid;
  v_waiver public.waiver_versions;
  v_comp jsonb;
  v_volunteer boolean := coalesce((p_data ->> 'is_volunteer')::boolean, false);
  v_priv jsonb := coalesce(p_data -> 'private', '{}'::jsonb);
  v_existing public.registrations;
  v_days text[];
  v_dates date[];
  v_roles text[];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_event from public.events where id = p_event;
  if not found or v_event.status <> 'published' then raise exception 'this event is not open for registration' using errcode = 'P0002'; end if;
  if v_event.registration_opens_at is not null and now() < v_event.registration_opens_at then raise exception 'registration has not opened yet' using errcode = '22023'; end if;
  if v_event.registration_closes_at is not null and now() > v_event.registration_closes_at then raise exception 'registration is closed' using errcode = '22023'; end if;

  if coalesce((p_data ->> 'waiver_agree')::boolean, false) is not true then raise exception 'the waiver must be accepted to take part' using errcode = '22023'; end if;
  select * into v_waiver from public.waiver_versions where id = (p_data ->> 'waiver_version_id')::uuid and event_id = p_event;
  if not found then raise exception 'unknown waiver version' using errcode = '22023'; end if;
  if v_waiver.version <> (select max(version) from public.waiver_versions where event_id = p_event) then raise exception 'the waiver was updated, please read and accept the new version' using errcode = '22023'; end if;
  if char_length(coalesce(p_data ->> 'waiver_signed_name', '')) < 2 then raise exception 'type your full name to sign the waiver' using errcode = '22023'; end if;

  if (p_data ->> 'insurance') is null or (p_data ->> 'insurance') not in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover') then
    raise exception 'choose an insurance option' using errcode = '22023'; end if;
  if coalesce((v_priv ->> 'medically_fit')::boolean, false) is not true then raise exception 'you must declare that you are medically fit to take part' using errcode = '22023'; end if;
  if char_length(coalesce(v_priv ->> 'emergency_name', '')) < 2 or char_length(coalesce(v_priv ->> 'emergency_phone', '')) < 7 then raise exception 'emergency contact name and phone are required' using errcode = '22023'; end if;
  if not v_volunteer and jsonb_array_length(coalesce(p_data -> 'competitions', '[]'::jsonb)) = 0 then raise exception 'choose at least one category, or sign up as a volunteer' using errcode = '22023'; end if;

  select * into v_existing from public.registrations where event_id = p_event and user_id = auth.uid();
  if found and v_existing.status not in ('pending', 'declined', 'withdrawn') then raise exception 'your registration was already accepted; ask an organizer to change it' using errcode = '22023'; end if;

  v_days := coalesce(array(select jsonb_array_elements_text(p_data -> 'days')), '{}');
  -- Attendance days are the event's own calendar days; anything outside the event is dropped rather than refused.
  v_dates := coalesce(array(select d::date from jsonb_array_elements_text(p_data -> 'attend_dates') d
                            where d ~ '^\d{4}-\d{2}-\d{2}$' and d::date between v_event.starts_on and v_event.ends_on), '{}');
  v_roles := coalesce(array(select jsonb_array_elements_text(p_data -> 'volunteer_roles')), '{}');

  insert into public.registrations as r (event_id, user_id, status, full_name, gender, organization, province, team_id, team_name, shares_equipment, days, attend_dates, availability_notes,
      bi_profile, insurance, is_volunteer, volunteer_roles, mercenary, notes, fee_due_cents, waiver_version_id, waiver_signed_name, waiver_signed_at)
  values (p_event, auth.uid(), 'pending', p_data ->> 'full_name', p_data ->> 'gender', p_data ->> 'organization', nullif(p_data ->> 'province', ''),
      nullif(p_data ->> 'team_id', '')::uuid, nullif(p_data ->> 'team_name', ''), coalesce((p_data ->> 'shares_equipment')::boolean, false), v_days, v_dates, nullif(p_data ->> 'availability_notes', ''),
      nullif(p_data ->> 'bi_profile', ''), p_data ->> 'insurance', v_volunteer, v_roles, coalesce((p_data ->> 'mercenary')::boolean, false), nullif(p_data ->> 'notes', ''),
      private.compute_fee(p_event, p_data ->> 'province', v_volunteer), v_waiver.id, p_data ->> 'waiver_signed_name', now())
  on conflict (event_id, user_id) do update set status = 'pending', full_name = excluded.full_name, gender = excluded.gender, organization = excluded.organization, province = excluded.province,
      team_id = excluded.team_id, team_name = excluded.team_name, shares_equipment = excluded.shares_equipment, days = excluded.days, attend_dates = excluded.attend_dates, availability_notes = excluded.availability_notes,
      bi_profile = excluded.bi_profile, insurance = excluded.insurance, is_volunteer = excluded.is_volunteer, volunteer_roles = excluded.volunteer_roles, mercenary = excluded.mercenary,
      notes = excluded.notes, fee_due_cents = excluded.fee_due_cents, waiver_version_id = excluded.waiver_version_id, waiver_signed_name = excluded.waiver_signed_name, waiver_signed_at = now()
  returning r.id into v_reg;

  insert into public.registration_private as p (registration_id, email, emergency_name, emergency_relationship, emergency_phone, medically_fit, medical_note)
  values (v_reg, coalesce(v_priv ->> 'email', ''), v_priv ->> 'emergency_name', coalesce(v_priv ->> 'emergency_relationship', ''), v_priv ->> 'emergency_phone', true, nullif(v_priv ->> 'medical_note', ''))
  on conflict (registration_id) do update set email = excluded.email, emergency_name = excluded.emergency_name, emergency_relationship = excluded.emergency_relationship,
      emergency_phone = excluded.emergency_phone, medically_fit = true, medical_note = excluded.medical_note;

  delete from public.registration_competitions where registration_id = v_reg;
  for v_comp in select * from jsonb_array_elements(coalesce(p_data -> 'competitions', '[]'::jsonb)) loop
    if not exists (select 1 from public.competitions where id = (v_comp ->> 'competition_id')::uuid and event_id = p_event) then
      raise exception 'a chosen category does not belong to this event' using errcode = '22023'; end if;
    insert into public.registration_competitions (registration_id, competition_id, team_id, details)
    values (v_reg, (v_comp ->> 'competition_id')::uuid, nullif(v_comp ->> 'team_id', '')::uuid, coalesce(v_comp -> 'details', '{}'::jsonb));
  end loop;

  perform private.audit(p_event, 'registration.submitted', v_reg::text);
  return v_reg;
end $$;
