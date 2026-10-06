-- Club membership, annual dues and voting eligibility (first club: the Red Deer Reavers).
-- Additive only. Nothing existing is changed.
--
-- What already exists and is reused (checked against every earlier migration and the hosted project):
--   * auth.users / public.profiles: the ONE account. The Red Deer Reavers website signs in to the same Supabase project, so a member is an
--     auth.users row, never a second account. Email is read from auth.users, never copied.
--   * public.teams: the club. The Reavers are the existing team `red-deer-reavers`. Every table below is keyed by team_id, so each club's
--     records are isolated from every other team's, and another club can switch this on by having a membership year.
--   * public.team_roles holds only 'captain' with primary key (team_id, user_id), so one person cannot be captain AND treasurer there.
--     Society offices (president, secretary, treasurer...) are a different thing from the sporting captain and need tenure history, so they
--     live in public.team_officers below. Captains keep working exactly as before.
--   * public.team_memberships is the public SPORTING roster (who fights for the team). Society membership (who may vote at the AGM, who paid
--     dues) is private and different, so it is public.club_memberships. The two are never merged.
--   * private.can_admin_team (platform owner, or an admin of the team's organization), private.person_name, private.audit / audit_log.
--
-- Security model: RLS on every table; people may read ONLY their own rows directly; there is no insert/update/delete grant on any of these
-- tables for anon or authenticated. Every write goes through a security-definer function below that checks the caller's CURRENT office in
-- THIS team. Authority comes from the office, never from a name: ending someone's term removes it at once, assigning a term grants it.

-- ---------------------------------------------------------------- executive offices (with tenure history)
create table public.team_officers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  office text not null check (office in ('president', 'vice_president', 'secretary', 'treasurer', 'director')),
  started_on date not null default current_date,
  -- Null while in office. Set when the term ends; the row is kept as history.
  ended_on date,
  assigned_by uuid references auth.users (id) on delete set null,
  ended_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);
alter table public.team_officers enable row level security;
-- One current president, vice president, secretary and treasurer per team (directors may be several). One current row per person and office.
create unique index team_officers_one_holder on public.team_officers (team_id, office) where ended_on is null and office <> 'director';
create unique index team_officers_one_term on public.team_officers (team_id, user_id, office) where ended_on is null;
create index team_officers_user_idx on public.team_officers (user_id) where ended_on is null;
create policy team_officers_own on public.team_officers for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- membership years (dues amount and voting rules per year)
create table public.club_membership_years (
  team_id uuid not null references public.teams (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  starts_on date not null,
  ends_on date not null,
  dues_cents int not null default 2000 check (dues_cents between 0 and 100000),
  -- Voting rules for this year. Further rules are added as columns here plus one line in private.club_vote_check.
  min_voting_age int not null default 18 check (min_voting_age between 0 and 100),
  dues_required_to_vote boolean not null default true,
  applications_open boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (team_id, year),
  check (ends_on >= starts_on)
);
alter table public.club_membership_years enable row level security;
-- The dues amount and dates are not private (the club website publishes them).
create policy club_membership_years_read on public.club_membership_years for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- memberships (one per person, club and membership year)
create table public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  membership_year int not null,
  -- Set null if the account is ever erased: the society record stays, identified by the name below.
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive', 'removed')),
  -- The name for the society's register (a profile display name can be a nickname).
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  discord_name text check (discord_name is null or char_length(discord_name) <= 64),
  -- Either a date of birth or the applicant's confirmation that they are 18 or older. Leadership sees only "18+ / under 18", never the date.
  date_of_birth date,
  adult_confirmed boolean not null default false,
  bylaws_agreed_at timestamptz not null,
  applied_at timestamptz not null default now(),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users (id) on delete set null,
  status_note text check (status_note is null or char_length(status_note) <= 300),
  foreign key (team_id, membership_year) references public.club_membership_years (team_id, year),
  check (date_of_birth is not null or adult_confirmed),
  check (date_of_birth is null or date_of_birth >= date '1900-01-01')
);
alter table public.club_memberships enable row level security;
create unique index club_memberships_one_per_year on public.club_memberships (team_id, membership_year, user_id);
create index club_memberships_user_idx on public.club_memberships (user_id);
create policy club_memberships_own on public.club_memberships for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- dues (one record per membership, i.e. per member and year)
create table public.club_dues (
  membership_id uuid primary key references public.club_memberships (id),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived', 'gear_contribution')),
  amount_cents int check (amount_cents is null or amount_cents between 0 and 100000),
  note text check (note is null or char_length(note) <= 300),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null
);
alter table public.club_dues enable row level security;
create policy club_dues_own on public.club_dues for select to authenticated
  using (exists (select 1 from public.club_memberships m where m.id = membership_id and m.user_id = auth.uid()));

-- ---------------------------------------------------------------- dues audit history (append-only)
-- Names are snapshotted so the record still reads correctly after a rename or an erased account.
create table public.club_dues_history (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.club_memberships (id),
  team_id uuid not null,
  membership_year int not null,
  member_name text not null,
  previous_status text check (previous_status is null or previous_status in ('unpaid', 'paid', 'waived', 'gear_contribution')),
  new_status text not null check (new_status in ('unpaid', 'paid', 'waived', 'gear_contribution')),
  previous_amount_cents int,
  new_amount_cents int,
  changed_by uuid not null,
  changed_by_name text not null,
  -- The office that authorised the change, as held at that moment.
  changed_by_office text not null,
  changed_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 300)
);
alter table public.club_dues_history enable row level security;
create index club_dues_history_team_idx on public.club_dues_history (team_id, membership_year, changed_at desc);
create index club_dues_history_member_idx on public.club_dues_history (membership_id, changed_at desc);
-- No policy and no grant: leadership reads it through club_dues_history(); nobody can write it except set_club_dues().

-- Grants, stated explicitly rather than trusting default privileges (hosted Supabase can grant new tables to the API roles by default):
-- read-only, and only through the row-level policies above. No API role may insert, update or delete any of these tables.
revoke all on public.team_officers, public.club_membership_years, public.club_memberships, public.club_dues, public.club_dues_history
  from public, anon, authenticated;
grant select on public.team_officers, public.club_memberships, public.club_dues to authenticated;
grant select on public.club_membership_years to anon, authenticated;

create or replace function private.club_dues_history_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'dues history cannot be changed or removed' using errcode = '42501'; end $$;
create trigger club_dues_history_append_only before update or delete on public.club_dues_history
  for each row execute function private.club_dues_history_immutable();
revoke execute on function private.club_dues_history_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------- authority helpers
-- The caller's current offices in a team (empty when none). A term counts from its start day until it is ended.
create or replace function private.my_team_offices(p_team uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(o.office order by array_position(array['president','vice_president','secretary','treasurer','director'], o.office)), '{}')
  from public.team_officers o
  where auth.uid() is not null and o.team_id = p_team and o.user_id = auth.uid() and o.ended_on is null and o.started_on <= current_date
$$;
-- Only these three offices may change dues and membership status. Other executives (vice president, director) may only look.
create or replace function private.can_change_club_dues(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_team_offices(p_team) && array['president', 'secretary', 'treasurer']
$$;
-- Any current executive of THIS team may read the membership roster, eligibility and dues history.
create or replace function private.can_view_club_roster(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(private.my_team_offices(p_team)) > 0
$$;
-- Who records office holders: the platform owner or an admin of the team's organization (existing can_admin_team), or the team's current
-- president or secretary (so a handover never needs the platform owner).
create or replace function private.can_assign_team_officers(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_admin_team(p_team) or private.my_team_offices(p_team) && array['president', 'secretary']
$$;
revoke execute on function private.my_team_offices(uuid), private.can_change_club_dues(uuid), private.can_view_club_roster(uuid), private.can_assign_team_officers(uuid) from public, anon, authenticated;

-- The membership year in force for a club: the one whose dates contain today, otherwise the latest one that has started, otherwise the earliest.
create or replace function private.club_current_year(p_team uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select y.year from public.club_membership_years y where y.team_id = p_team and current_date between y.starts_on and y.ends_on order by y.year desc limit 1),
    (select y.year from public.club_membership_years y where y.team_id = p_team and y.starts_on <= current_date order by y.year desc limit 1),
    (select min(y.year) from public.club_membership_years y where y.team_id = p_team))
$$;
revoke execute on function private.club_current_year(uuid) from public, anon, authenticated;

create or replace function private.office_label(p_office text) returns text
language sql immutable set search_path = '' as $$
  select case p_office when 'president' then 'President' when 'vice_president' then 'Vice President' when 'secretary' then 'Secretary'
    when 'treasurer' then 'Treasurer' when 'director' then 'Director' else p_office end
$$;
create or replace function private.dues_label(p_status text) returns text
language sql immutable set search_path = '' as $$
  select case p_status when 'unpaid' then 'Unpaid' when 'paid' then 'Paid' when 'waived' then 'Waived' when 'gear_contribution' then 'Gear contribution' else p_status end
$$;
revoke execute on function private.office_label(text), private.dues_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- voting eligibility (calculated, never stored, never editable)
-- One row per rule. A member is eligible when no rule fails. To add a bylaw rule later: add one more `select` line to `rules` (and, when it
-- needs a setting, a column on club_membership_years). Codes are stable for the apps; labels are what people read.
create or replace function private.club_vote_check(p_membership uuid, p_as_of date default current_date)
returns table (eligible boolean, reason_codes text[], reasons text[], is_adult boolean)
language sql stable security definer set search_path = '' as $$
  with m as (
    select m.*, y.min_voting_age, y.dues_required_to_vote, coalesce(d.status, 'unpaid') as dues_status,
           case when m.date_of_birth is not null then extract(year from age(coalesce(p_as_of, current_date), m.date_of_birth))::int >= y.min_voting_age
                when m.adult_confirmed then true end as adult
    from public.club_memberships m
    join public.club_membership_years y on y.team_id = m.team_id and y.year = m.membership_year
    left join public.club_dues d on d.membership_id = m.id
    where m.id = p_membership
  ), rules(sort, code, label, fails) as (
    select 1, 'membership_pending', 'Membership pending approval', m.status = 'pending' from m
    union all select 2, 'membership_inactive', 'Membership inactive', m.status = 'inactive' from m
    union all select 3, 'membership_removed', 'Membership removed', m.status = 'removed' from m
    union all select 4, 'under_age', 'Under ' || m.min_voting_age, m.adult is false from m
    union all select 5, 'age_unknown', 'Age not confirmed', m.adult is null from m
    -- Paid, Waived and Gear contribution satisfy the dues requirement. A gear contribution can only be recorded by a dues officer, so a
    -- recorded one is an approved one.
    union all select 6, 'dues_unpaid', 'Dues unpaid', m.dues_required_to_vote and m.dues_status = 'unpaid' from m
  )
  select not coalesce(bool_or(r.fails), true),
         coalesce(array_agg(r.code order by r.sort) filter (where r.fails), '{}'),
         coalesce(array_agg(r.label order by r.sort) filter (where r.fails), '{}'),
         (select m.adult from m)
  from rules r
$$;
revoke execute on function private.club_vote_check(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- what the signed-in person may see about one club
-- Any signed-in person: the club's years, their OWN membership(s) with dues and eligibility, their OWN offices, and what they may do.
-- Never another person's data.
create or replace function public.club_membership_overview(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_year int;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  v_year := private.club_current_year(p_team);
  return jsonb_build_object(
    'team_id', p_team,
    'enabled', v_year is not null,
    'current_year', v_year,
    'years', coalesce((select jsonb_agg(jsonb_build_object('year', y.year, 'starts_on', y.starts_on, 'ends_on', y.ends_on, 'dues_cents', y.dues_cents,
                         'min_voting_age', y.min_voting_age, 'applications_open', y.applications_open) order by y.year desc)
                       from public.club_membership_years y where y.team_id = p_team), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'year', m.membership_year, 'status', m.status, 'full_name', m.full_name, 'discord_name', m.discord_name,
        'date_of_birth', m.date_of_birth, 'adult_confirmed', m.adult_confirmed, 'applied_at', m.applied_at,
        'dues_status', coalesce(d.status, 'unpaid'), 'dues_amount_cents', d.amount_cents, 'dues_changed_at', d.changed_at,
        'eligible', c.eligible, 'reason_codes', to_jsonb(c.reason_codes), 'reasons', to_jsonb(c.reasons)) order by m.membership_year desc)
      from public.club_memberships m left join public.club_dues d on d.membership_id = m.id
      cross join lateral private.club_vote_check(m.id, current_date) c
      where m.team_id = p_team and m.user_id = v_uid), '[]'::jsonb),
    'offices', coalesce((select jsonb_agg(jsonb_build_object('office', o, 'label', private.office_label(o))) from unnest(private.my_team_offices(p_team)) o), '[]'::jsonb),
    'email', (select u.email from auth.users u where u.id = v_uid),
    'suggested_name', private.person_name(v_uid),
    'can_view_roster', private.can_view_club_roster(p_team),
    'can_change_dues', private.can_change_club_dues(p_team),
    'can_assign_officers', private.can_assign_team_officers(p_team));
end $$;

-- ---------------------------------------------------------------- apply (the signed-in person, for themselves only)
create or replace function public.apply_for_club_membership(
  p_team uuid, p_year int, p_full_name text, p_discord_name text, p_date_of_birth date, p_adult_confirmed boolean, p_agree_bylaws boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_y public.club_membership_years; v_m public.club_memberships; v_name text := btrim(coalesce(p_full_name, ''));
  v_discord text := nullif(btrim(coalesce(p_discord_name, '')), '');
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_y from public.club_membership_years where team_id = p_team and year = p_year;
  if not found then raise exception 'that membership year does not exist' using errcode = 'P0002'; end if;
  if not v_y.applications_open then raise exception 'applications for % are closed' , p_year using errcode = '22023'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'enter your full name' using errcode = '22023'; end if;
  if v_discord is not null and char_length(v_discord) > 64 then raise exception 'that Discord name is too long' using errcode = '22023'; end if;
  if not coalesce(p_agree_bylaws, false) then raise exception 'you must agree to follow the bylaws and team standards' using errcode = '22023'; end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then raise exception 'check the date of birth' using errcode = '22023'; end if;
  if p_date_of_birth is null and not coalesce(p_adult_confirmed, false) then raise exception 'give your date of birth or confirm you are 18 or older' using errcode = '22023'; end if;

  select * into v_m from public.club_memberships where team_id = p_team and membership_year = p_year and user_id = v_uid for update;
  if found then
    if v_m.status <> 'pending' then raise exception 'you already have a % membership record for %: ask the club executive to change it', v_m.status, p_year using errcode = '23505'; end if;
    -- Still pending: the applicant may correct their own details. Status and dues are untouched.
    update public.club_memberships set full_name = v_name, discord_name = v_discord, date_of_birth = p_date_of_birth,
      adult_confirmed = coalesce(p_adult_confirmed, false), bylaws_agreed_at = now()
      where id = v_m.id;
    return v_m.id;
  end if;

  insert into public.club_memberships (team_id, membership_year, user_id, full_name, discord_name, date_of_birth, adult_confirmed, bylaws_agreed_at)
    values (p_team, p_year, v_uid, v_name, v_discord, p_date_of_birth, coalesce(p_adult_confirmed, false), now())
    returning * into v_m;
  insert into public.club_dues (membership_id, status, changed_at, changed_by) values (v_m.id, 'unpaid', now(), null);
  perform private.audit(null, 'club.membership_applied', v_m.id::text, jsonb_build_object('team', p_team, 'year', p_year));
  return v_m.id;
end $$;

-- ---------------------------------------------------------------- leadership: roster with eligibility (also the AGM snapshot)
-- Read-only. p_as_of is the date ages are counted at (the AGM date for an AGM snapshot). Never changes anything.
create or replace function public.club_member_roster(p_team uuid, p_year int, p_as_of date default current_date)
returns table (
  membership_id uuid, full_name text, email text, discord_name text, status text, applied_at timestamptz, is_adult boolean,
  dues_status text, dues_amount_cents int, dues_note text, dues_changed_at timestamptz, dues_changed_by_name text,
  eligible boolean, reason_codes text[], reasons text[], offices text[], status_note text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_view_club_roster(p_team) then
    raise exception 'only this club''s executive can see the membership list' using errcode = '42501';
  end if;
  return query
  select m.id, m.full_name, u.email::text, m.discord_name, m.status, m.applied_at, c.is_adult,
         coalesce(d.status, 'unpaid'), d.amount_cents, d.note, d.changed_at, case when d.changed_by is null then null else private.person_name(d.changed_by) end,
         c.eligible, c.reason_codes, c.reasons,
         coalesce((select array_agg(private.office_label(o.office) order by o.office) from public.team_officers o
                   where o.team_id = p_team and o.user_id = m.user_id and o.ended_on is null and o.started_on <= current_date), '{}'),
         m.status_note
  from public.club_memberships m
  left join auth.users u on u.id = m.user_id
  left join public.club_dues d on d.membership_id = m.id
  cross join lateral private.club_vote_check(m.id, coalesce(p_as_of, current_date)) c
  where m.team_id = p_team and m.membership_year = p_year
  order by (m.status = 'pending') desc, lower(m.full_name), m.id;
end $$;

-- ---------------------------------------------------------------- leadership: change dues (president, secretary or treasurer only)
create or replace function public.set_club_dues(p_membership uuid, p_status text, p_amount_cents int default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_m public.club_memberships; v_d public.club_dues; v_y public.club_membership_years; v_amount int;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_office text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_m from public.club_memberships where id = p_membership;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  -- Checked against the membership's OWN club: an officer of another team gets nothing here.
  if not private.can_change_club_dues(v_m.team_id) then
    raise exception 'only the club''s President, Secretary or Treasurer can change dues' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('unpaid', 'paid', 'waived', 'gear_contribution') then raise exception 'unknown dues status' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  if p_amount_cents is not null and (p_amount_cents < 0 or p_amount_cents > 100000) then raise exception 'check the amount' using errcode = '22023'; end if;
  select * into v_y from public.club_membership_years where team_id = v_m.team_id and year = v_m.membership_year;
  -- Paid with no amount = the year's normal dues. Unpaid and Waived carry no amount. A gear contribution may record its value.
  v_amount := case p_status when 'paid' then coalesce(p_amount_cents, v_y.dues_cents) when 'gear_contribution' then p_amount_cents else null end;

  select * into v_d from public.club_dues where membership_id = p_membership for update;
  if not found then
    insert into public.club_dues (membership_id) values (p_membership) returning * into v_d;
  end if;
  if v_d.status = p_status and v_d.amount_cents is not distinct from v_amount and v_d.note is not distinct from v_note then
    raise exception 'nothing changed' using errcode = '22023';
  end if;
  v_office := private.office_label((select o from unnest(private.my_team_offices(v_m.team_id)) o where o in ('president', 'secretary', 'treasurer') limit 1));

  update public.club_dues set status = p_status, amount_cents = v_amount, note = v_note, changed_at = now(), changed_by = v_uid
    where membership_id = p_membership;
  insert into public.club_dues_history (membership_id, team_id, membership_year, member_name, previous_status, new_status, previous_amount_cents,
      new_amount_cents, changed_by, changed_by_name, changed_by_office, note)
    values (p_membership, v_m.team_id, v_m.membership_year, v_m.full_name, v_d.status, p_status, v_d.amount_cents, v_amount, v_uid,
      coalesce(private.person_name(v_uid), 'Unnamed account'), v_office, v_note);
  perform private.audit(null, 'club.dues_changed', p_membership::text,
    jsonb_build_object('team', v_m.team_id, 'year', v_m.membership_year, 'from', v_d.status, 'to', p_status, 'amount_cents', v_amount));
end $$;

-- ---------------------------------------------------------------- leadership: approve / change membership status (same three offices)
create or replace function public.set_club_membership_status(p_membership uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_m public.club_memberships; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_m from public.club_memberships where id = p_membership for update;
  if not found then raise exception 'membership not found' using errcode = 'P0002'; end if;
  if not private.can_change_club_dues(v_m.team_id) then
    raise exception 'only the club''s President, Secretary or Treasurer can change membership status' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'active', 'inactive', 'removed') then raise exception 'unknown membership status' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  if v_m.status = p_status then raise exception 'nothing changed' using errcode = '22023'; end if;
  update public.club_memberships set status = p_status, status_changed_at = now(), status_changed_by = v_uid, status_note = v_note where id = p_membership;
  perform private.audit(null, 'club.membership_status', p_membership::text,
    jsonb_build_object('team', v_m.team_id, 'year', v_m.membership_year, 'from', v_m.status, 'to', p_status, 'note', v_note));
end $$;

-- ---------------------------------------------------------------- leadership: dues history (read-only)
create or replace function public.club_dues_history(p_team uuid, p_year int default null, p_membership uuid default null)
returns table (id bigint, membership_id uuid, membership_year int, member_name text, previous_status text, new_status text,
  previous_amount_cents int, new_amount_cents int, changed_by_name text, changed_by_office text, changed_at timestamptz, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_view_club_roster(p_team) then
    raise exception 'only this club''s executive can see dues history' using errcode = '42501';
  end if;
  return query select h.id, h.membership_id, h.membership_year, h.member_name, h.previous_status, h.new_status, h.previous_amount_cents,
      h.new_amount_cents, h.changed_by_name, h.changed_by_office, h.changed_at, h.note
    from public.club_dues_history h
    where h.team_id = p_team and (p_year is null or h.membership_year = p_year) and (p_membership is null or h.membership_id = p_membership)
    order by h.changed_at desc, h.id desc
    limit 500;
end $$;

-- ---------------------------------------------------------------- offices: list, assign, end
create or replace function public.list_team_officers(p_team uuid)
returns table (officer_id uuid, office text, office_label text, name text, email text, started_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.can_view_club_roster(p_team) or private.can_assign_team_officers(p_team)) then
    raise exception 'only this club''s executive can see its officers' using errcode = '42501';
  end if;
  return query select o.id, o.office, private.office_label(o.office), private.person_name(o.user_id), u.email::text, o.started_on
    from public.team_officers o join auth.users u on u.id = o.user_id
    where o.team_id = p_team and o.ended_on is null and o.started_on <= current_date
    order by array_position(array['president','vice_president','secretary','treasurer','director'], o.office), lower(coalesce(private.person_name(o.user_id), ''));
end $$;

-- Assigning an office that has one holder ends the previous holder's term the same day (their authority stops at once).
create or replace function public.assign_team_officer(p_team uuid, p_email text, p_office text, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_user uuid; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_prev uuid;
begin
  if v_uid is null or not private.can_assign_team_officers(p_team) then
    raise exception 'only the club''s President or Secretary, or a platform or organization administrator, can assign executive roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  if p_office is null or p_office not in ('president', 'vice_president', 'secretary', 'treasurer', 'director') then raise exception 'unknown office' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then raise exception 'that person has not signed in to BuhurtOS yet' using errcode = 'P0002'; end if;
  if exists (select 1 from public.team_officers where team_id = p_team and user_id = v_user and office = p_office and ended_on is null) then
    raise exception 'that person already holds this office' using errcode = '23505';
  end if;
  if p_office <> 'director' then
    update public.team_officers set ended_on = greatest(current_date, started_on), ended_by = v_uid,
        note = coalesce(note || ' / ', '') || 'term ended: ' || private.office_label(p_office) || ' reassigned'
      where team_id = p_team and office = p_office and ended_on is null
      returning user_id into v_prev;
  end if;
  insert into public.team_officers (team_id, user_id, office, assigned_by, note) values (p_team, v_user, p_office, v_uid, v_note) returning id into v_id;
  perform private.audit(null, 'team.officer_assigned', p_team::text, jsonb_build_object('user', v_user, 'office', p_office, 'replaced', v_prev));
  return v_id;
end $$;

create or replace function public.end_team_officer(p_officer uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.team_officers; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_o from public.team_officers where id = p_officer for update;
  if not found or v_o.ended_on is not null then raise exception 'that term is not current' using errcode = 'P0002'; end if;
  if not private.can_assign_team_officers(v_o.team_id) then
    raise exception 'only the club''s President or Secretary, or a platform or organization administrator, can end an executive term' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  update public.team_officers set ended_on = greatest(current_date, started_on), ended_by = v_uid,
      note = case when v_note is null then note else coalesce(note || ' / ', '') || v_note end
    where id = p_officer;
  perform private.audit(null, 'team.officer_ended', v_o.team_id::text, jsonb_build_object('user', v_o.user_id, 'office', v_o.office));
end $$;

-- ---------------------------------------------------------------- leadership: open or adjust a membership year
create or replace function public.set_club_membership_year(p_team uuid, p_year int, p_dues_cents int, p_starts_on date, p_ends_on date, p_applications_open boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_change_club_dues(p_team) then
    raise exception 'only the club''s President, Secretary or Treasurer can set up a membership year' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_dues_cents is null or p_dues_cents < 0 or p_dues_cents > 100000 then
    raise exception 'check the year, dates and dues amount' using errcode = '22023';
  end if;
  insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents, applications_open)
    values (p_team, p_year, p_starts_on, p_ends_on, p_dues_cents, coalesce(p_applications_open, true))
    on conflict (team_id, year) do update set starts_on = excluded.starts_on, ends_on = excluded.ends_on, dues_cents = excluded.dues_cents,
      applications_open = excluded.applications_open;
  perform private.audit(null, 'club.membership_year_set', p_team::text,
    jsonb_build_object('year', p_year, 'dues_cents', p_dues_cents, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'open', p_applications_open));
end $$;

revoke execute on function
  public.club_membership_overview(uuid),
  public.apply_for_club_membership(uuid, int, text, text, date, boolean, boolean),
  public.club_member_roster(uuid, int, date),
  public.set_club_dues(uuid, text, int, text),
  public.set_club_membership_status(uuid, text, text),
  public.club_dues_history(uuid, int, uuid),
  public.list_team_officers(uuid),
  public.assign_team_officer(uuid, text, text, text),
  public.end_team_officer(uuid, text),
  public.set_club_membership_year(uuid, int, int, date, date, boolean)
from public, anon;
grant execute on function
  public.club_membership_overview(uuid),
  public.apply_for_club_membership(uuid, int, text, text, date, boolean, boolean),
  public.club_member_roster(uuid, int, date),
  public.set_club_dues(uuid, text, int, text),
  public.set_club_membership_status(uuid, text, text),
  public.club_dues_history(uuid, int, uuid),
  public.list_team_officers(uuid),
  public.assign_team_officer(uuid, text, text, text),
  public.end_team_officer(uuid, text),
  public.set_club_membership_year(uuid, int, int, date, date, boolean)
to authenticated;

-- ---------------------------------------------------------------- the Red Deer Reavers' first membership year
-- Found by slug (no generated id is hard-coded). Nothing happens on a database without that team. Dates: the calendar year (owner to confirm).
insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents, min_voting_age, dues_required_to_vote, applications_open)
select t.id, 2026, date '2026-01-01', date '2026-12-31', 2000, 18, true, true from public.teams t where t.slug = 'red-deer-reavers'
on conflict (team_id, year) do nothing;
