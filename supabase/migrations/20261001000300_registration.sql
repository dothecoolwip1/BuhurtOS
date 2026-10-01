-- Registration: one signup per person per event (matching the paper/Google form), waiver, private paperwork, review, check-in.
-- Account ids live only in private tables. Health and contact data is readable only by the registrant, organizers and medics.

create table public.waiver_versions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  version int not null,
  title text not null,
  -- The exact text the fighter agrees to. Supplied by the event owner, never edited here: add a new version instead.
  body text not null,
  created_at timestamptz not null default now(),
  unique (event_id, version)
);
alter table public.waiver_versions enable row level security;
create policy waiver_read on public.waiver_versions for select to anon, authenticated
  using (private.is_event_public(event_id) or private.is_organizer(event_id));
create policy waiver_organizer_insert on public.waiver_versions for insert to authenticated with check (private.is_organizer(event_id));
grant select on public.waiver_versions to anon, authenticated;
grant insert on public.waiver_versions to authenticated;

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fighter_id uuid references public.fighters (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  full_name text not null check (char_length(full_name) between 2 and 80),
  gender text not null check (gender in ('male', 'female', 'other')),
  organization text not null check (organization in ('HACSA', 'MCC', 'other')),
  province text,
  team_id uuid references public.teams (id) on delete set null,
  team_name text,
  shares_equipment boolean not null default false,
  days text[] not null default '{}' check (days <@ array['sat', 'sun']),
  availability_notes text,
  bi_profile text,
  insurance text not null check (insurance in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover')),
  is_volunteer boolean not null default false,
  volunteer_roles text[] not null default '{}',
  mercenary boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  fee_due_cents int not null default 0,
  fee_paid boolean not null default false,
  waiver_version_id uuid not null references public.waiver_versions (id),
  waiver_signed_name text not null,
  waiver_signed_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table public.registrations enable row level security;
create index registrations_event_idx on public.registrations (event_id, status);
create trigger registrations_touch before update on public.registrations for each row execute function private.touch_updated_at();

create or replace function private.reg_event(p_reg uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select event_id from public.registrations where id = p_reg $$;
create or replace function private.reg_owner(p_reg uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select user_id from public.registrations where id = p_reg $$;
revoke execute on function private.reg_event(uuid), private.reg_owner(uuid) from public;
grant execute on function private.reg_event(uuid), private.reg_owner(uuid) to authenticated;

create policy registrations_read on public.registrations for select to authenticated
  using (user_id = auth.uid() or private.can_read_health(event_id));
grant select on public.registrations to authenticated;

create table public.registration_competitions (
  registration_id uuid not null references public.registrations (id) on delete cascade,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  -- Category-specific answers: profight weight, Marathon teammate and team name, melee captain.
  details jsonb not null default '{}'::jsonb,
  primary key (registration_id, competition_id)
);
alter table public.registration_competitions enable row level security;
create policy reg_comp_read on public.registration_competitions for select to authenticated
  using (private.reg_owner(registration_id) = auth.uid() or private.can_read_health(private.reg_event(registration_id)));
grant select on public.registration_competitions to authenticated;

create table public.registration_private (
  registration_id uuid primary key references public.registrations (id) on delete cascade,
  email text not null,
  emergency_name text not null,
  emergency_relationship text not null,
  emergency_phone text not null,
  medically_fit boolean not null default false,
  -- Optional. Readable only by the registrant, organizers and medics. Deleted 30 days after the event.
  medical_note text check (medical_note is null or char_length(medical_note) <= 1000)
);
alter table public.registration_private enable row level security;
create policy reg_private_read on public.registration_private for select to authenticated
  using (private.reg_owner(registration_id) = auth.uid() or private.can_read_health(private.reg_event(registration_id)));
grant select on public.registration_private to authenticated;

create table public.registration_checks (
  registration_id uuid not null references public.registrations (id) on delete cascade,
  check_name text not null check (check_name in ('checked_in', 'kit')),
  passed boolean not null,
  at timestamptz not null default now(),
  primary key (registration_id, check_name)
);
alter table public.registration_checks enable row level security;
create policy reg_checks_read on public.registration_checks for select to authenticated
  using (private.can_read_health(private.reg_event(registration_id)));
grant select on public.registration_checks to authenticated;

-- Cleared = checked in, kit passed, waiver signed, fit declaration and insurance in order.
create view public.registration_clearance with (security_invoker = true) as
select r.id as registration_id, r.event_id,
  coalesce(bool_or(c.passed) filter (where c.check_name = 'checked_in'), false) as checked_in,
  coalesce(bool_or(c.passed) filter (where c.check_name = 'kit'), false) as kit_passed,
  true as waiver_signed,
  coalesce(p.medically_fit, false) as medically_fit,
  r.insurance in ('hacsa_member', 'mcc_member', 'proof_received') as insurance_ok,
  (coalesce(bool_or(c.passed) filter (where c.check_name = 'checked_in'), false)
   and coalesce(bool_or(c.passed) filter (where c.check_name = 'kit'), false)
   and coalesce(p.medically_fit, false)
   and r.insurance in ('hacsa_member', 'mcc_member', 'proof_received')) as cleared
from public.registrations r
left join public.registration_private p on p.registration_id = r.id
left join public.registration_checks c on c.registration_id = r.id
where r.status = 'accepted'
group by r.id, r.event_id, p.medically_fit, r.insurance;
grant select on public.registration_clearance to authenticated;

-- ---------------------------------------------------------------- functions
create or replace function private.compute_fee(p_event uuid, p_province text, p_volunteer boolean) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when p_volunteer then 0
    when e.fee_province is null then e.fee_cents
    when upper(coalesce(p_province, '')) = upper(e.fee_province) then e.fee_cents
    else 0 end
  from public.events e where e.id = p_event
$$;
revoke execute on function private.compute_fee(uuid, text, boolean) from public;

-- Owner or platform organizer creates an event and becomes its organizer.
create or replace function public.create_event(p_slug text, p_name text, p_starts_on date, p_ends_on date, p_venue text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_platform_organizer() then raise exception 'only approved organizers can create events' using errcode = '42501'; end if;
  insert into public.events (slug, name, starts_on, ends_on, venue, address) values (p_slug, p_name, p_starts_on, p_ends_on, p_venue, p_address) returning id into v_id;
  insert into public.event_staff (event_id, user_id, role) values (v_id, auth.uid(), 'organizer');
  perform private.audit(v_id, 'event.created', p_slug, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.grant_event_role_by_email(p_event uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.is_organizer(p_event) then raise exception 'only an organizer can add staff' using errcode = '42501'; end if;
  if p_role not in ('organizer', 'marshal', 'scorekeeper', 'medic') then raise exception 'unknown role' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'that person has not signed in to BuhurtOS yet' using errcode = 'P0002'; end if;
  insert into public.event_staff (event_id, user_id, role) values (p_event, v_user, p_role) on conflict do nothing;
  perform private.audit(p_event, 'staff.granted', p_role, jsonb_build_object('user', v_user));
end $$;

create or replace function public.remove_event_role(p_event uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organizer(p_event) then raise exception 'only an organizer can remove staff' using errcode = '42501'; end if;
  delete from public.event_staff where event_id = p_event and user_id = p_user and role = p_role;
  perform private.audit(p_event, 'staff.removed', p_role, jsonb_build_object('user', p_user));
end $$;

-- Any signed-in person can propose a team. It stays private until an organizer approves it. The proposer is its captain.
create or replace function public.create_team(p_slug text, p_name text, p_city text default null, p_region text default null, p_country text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  insert into public.teams (slug, name, city, region, country, initial) values (p_slug, p_name, p_city, p_region, p_country, upper(left(p_name, 1))) returning id into v_id;
  insert into public.team_roles (team_id, user_id, role) values (v_id, auth.uid(), 'captain');
  perform private.audit(null, 'team.proposed', p_slug, jsonb_build_object('team', v_id));
  return v_id;
end $$;

create or replace function public.approve_team(p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_any_organizer() then raise exception 'only an organizer can approve teams' using errcode = '42501'; end if;
  update public.teams set status = 'approved' where id = p_team;
  perform private.audit(null, 'team.approved', p_team::text);
end $$;

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
  v_roles := coalesce(array(select jsonb_array_elements_text(p_data -> 'volunteer_roles')), '{}');

  insert into public.registrations as r (event_id, user_id, status, full_name, gender, organization, province, team_id, team_name, shares_equipment, days, availability_notes,
      bi_profile, insurance, is_volunteer, volunteer_roles, mercenary, notes, fee_due_cents, waiver_version_id, waiver_signed_name, waiver_signed_at)
  values (p_event, auth.uid(), 'pending', p_data ->> 'full_name', p_data ->> 'gender', p_data ->> 'organization', nullif(p_data ->> 'province', ''),
      nullif(p_data ->> 'team_id', '')::uuid, nullif(p_data ->> 'team_name', ''), coalesce((p_data ->> 'shares_equipment')::boolean, false), v_days, nullif(p_data ->> 'availability_notes', ''),
      nullif(p_data ->> 'bi_profile', ''), p_data ->> 'insurance', v_volunteer, v_roles, coalesce((p_data ->> 'mercenary')::boolean, false), nullif(p_data ->> 'notes', ''),
      private.compute_fee(p_event, p_data ->> 'province', v_volunteer), v_waiver.id, p_data ->> 'waiver_signed_name', now())
  on conflict (event_id, user_id) do update set status = 'pending', full_name = excluded.full_name, gender = excluded.gender, organization = excluded.organization, province = excluded.province,
      team_id = excluded.team_id, team_name = excluded.team_name, shares_equipment = excluded.shares_equipment, days = excluded.days, availability_notes = excluded.availability_notes,
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

-- Organizer accepts or declines. Accepting creates the competition entries.
create or replace function public.decide_registration(p_reg uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reg public.registrations; v_rc record; v_fighter uuid; v_league text;
begin
  select * into v_reg from public.registrations where id = p_reg;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_reg.event_id) then raise exception 'only an organizer can decide registrations' using errcode = '42501'; end if;
  if p_status not in ('accepted', 'declined', 'pending') then raise exception 'unknown status' using errcode = '22023'; end if;

  if p_status = 'accepted' then
    select fighter_id into v_fighter from public.fighter_accounts where user_id = v_reg.user_id;
    if v_fighter is null then
      insert into public.fighters (display_name, team_id) values (v_reg.full_name, v_reg.team_id) returning id into v_fighter;
      insert into public.fighter_accounts (fighter_id, user_id) values (v_fighter, v_reg.user_id);
    end if;
    update public.registrations set fighter_id = v_fighter where id = p_reg;
    for v_rc in select rc.*, c.category from public.registration_competitions rc join public.competitions c on c.id = rc.competition_id where rc.registration_id = p_reg loop
      select league into v_league from public.ref_categories where code = v_rc.category;
      if v_league = 'buhurt' then
        if v_rc.team_id is not null then
          insert into public.entries (competition_id, team_id) values (v_rc.competition_id, v_rc.team_id) on conflict (competition_id, team_id) do nothing;
        end if;
      else
        insert into public.entries (competition_id, fighter_id) values (v_rc.competition_id, v_fighter) on conflict (competition_id, fighter_id) do update set status = 'registered';
      end if;
    end loop;
  elsif v_reg.status = 'accepted' then
    -- Reversing an acceptance withdraws the person's own duel entries; team entries are left for the organizer.
    update public.entries set status = 'withdrawn' where fighter_id = v_reg.fighter_id and competition_id in (select competition_id from public.registration_competitions where registration_id = p_reg);
  end if;

  update public.registrations set status = p_status, decided_at = now() where id = p_reg;
  perform private.audit(v_reg.event_id, 'registration.' || p_status, p_reg::text);
end $$;

create or replace function public.set_registration_check(p_reg uuid, p_check text, p_value boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organizer(private.reg_event(p_reg)) then raise exception 'only an organizer can check people in' using errcode = '42501'; end if;
  insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, p_check, p_value)
  on conflict (registration_id, check_name) do update set passed = excluded.passed, at = now();
  perform private.audit(private.reg_event(p_reg), 'registration.check', p_reg::text, jsonb_build_object('check', p_check, 'passed', p_value));
end $$;

create or replace function public.set_registration_paid(p_reg uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organizer(private.reg_event(p_reg)) then raise exception 'only an organizer can record payments' using errcode = '42501'; end if;
  update public.registrations set fee_paid = p_paid where id = p_reg;
  perform private.audit(private.reg_event(p_reg), 'registration.paid', p_reg::text, jsonb_build_object('paid', p_paid));
end $$;

-- Medical notes are deleted 30 days after the event ends. Scheduled with pg_cron when that extension is enabled.
create or replace function private.purge_medical_notes() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.registration_private p set medical_note = null
  from public.registrations r join public.events e on e.id = r.event_id
  where p.registration_id = r.id and p.medical_note is not null and e.ends_on + 30 < current_date;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function private.purge_medical_notes() from public, anon, authenticated;

-- API surface: signed-in users only. Each function checks its own authority.
revoke execute on function public.create_event(text, text, date, date, text, text), public.grant_event_role_by_email(uuid, text, text), public.remove_event_role(uuid, uuid, text),
  public.create_team(text, text, text, text, text), public.approve_team(uuid), public.submit_registration(uuid, jsonb), public.decide_registration(uuid, text),
  public.set_registration_check(uuid, text, boolean), public.set_registration_paid(uuid, boolean) from public, anon;
grant execute on function public.create_event(text, text, date, date, text, text), public.grant_event_role_by_email(uuid, text, text), public.remove_event_role(uuid, uuid, text),
  public.create_team(text, text, text, text, text), public.approve_team(uuid), public.submit_registration(uuid, jsonb), public.decide_registration(uuid, text),
  public.set_registration_check(uuid, text, boolean), public.set_registration_paid(uuid, boolean) to authenticated;
