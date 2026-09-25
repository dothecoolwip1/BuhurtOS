alter type public.event_status add value if not exists 'cancelled';

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='registration_kind'
  ) then
    create type public.registration_kind as enum ('individual','team');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='registration_eligibility_status'
  ) then
    create type public.registration_eligibility_status as enum ('eligible','ineligible','needs_review');
  end if;
end
$$;

alter table public.events
  add column if not exists public_description text,
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists registration_capacity integer,
  add column if not exists waitlist_enabled boolean not null default true,
  add column if not exists published_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.events
  drop constraint if exists events_registration_capacity_check,
  add constraint events_registration_capacity_check check (registration_capacity is null or registration_capacity > 0),
  drop constraint if exists events_registration_window_check,
  add constraint events_registration_window_check check (
    registration_opens_at is null
    or registration_closes_at is null
    or registration_closes_at > registration_opens_at
  );

update public.events
set published_at=coalesce(published_at,created_at)
where status::text in ('published','live','completed','archived');

alter table public.event_registrations
  add column if not exists registration_kind public.registration_kind not null default 'individual',
  add column if not exists event_division_id uuid references public.event_divisions(id) on delete restrict,
  add column if not exists fighter_identity_id uuid references public.fighter_identities(id) on delete set null,
  add column if not exists submitted_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists team_roster jsonb not null default '[]'::jsonb,
  add column if not exists team_size integer,
  add column if not exists eligibility_status public.registration_eligibility_status not null default 'needs_review',
  add column if not exists eligibility_reasons jsonb not null default '[]'::jsonb,
  add column if not exists eligibility_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists eligibility_override_reason text,
  add column if not exists organizer_notes text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists withdrawn_at timestamptz;

alter table public.event_registrations
  drop constraint if exists event_registrations_team_roster_array,
  add constraint event_registrations_team_roster_array check (jsonb_typeof(team_roster)='array'),
  drop constraint if exists event_registrations_eligibility_reasons_array,
  add constraint event_registrations_eligibility_reasons_array check (jsonb_typeof(eligibility_reasons)='array'),
  drop constraint if exists event_registrations_eligibility_snapshot_object,
  add constraint event_registrations_eligibility_snapshot_object check (jsonb_typeof(eligibility_snapshot)='object'),
  drop constraint if exists event_registrations_team_size_check,
  add constraint event_registrations_team_size_check check (
    (registration_kind='individual' and team_size is null and jsonb_array_length(team_roster)=0)
    or
    (registration_kind='team' and team_size is not null and team_size > 0 and team_size=jsonb_array_length(team_roster))
  );

alter table public.event_registrations
  drop constraint if exists event_registrations_event_id_email_category_key;

create index if not exists event_registrations_event_status_idx
  on public.event_registrations(event_id,status);
create index if not exists event_registrations_division_status_idx
  on public.event_registrations(event_division_id,status);

create unique index if not exists event_registrations_active_email_division_uidx
  on public.event_registrations(event_id,event_division_id,lower(email))
  where event_division_id is not null and status in ('pending','approved','waitlisted');

create unique index if not exists event_registrations_active_team_division_uidx
  on public.event_registrations(event_id,event_division_id,lower(team_name))
  where event_division_id is not null and registration_kind='team' and team_name is not null
    and status in ('pending','approved','waitlisted');

create unique index if not exists event_registrations_active_legacy_uidx
  on public.event_registrations(event_id,lower(email),lower(category))
  where event_division_id is null and status in ('pending','approved','waitlisted');

alter table public.event_roster_entries
  add column if not exists registration_id uuid references public.event_registrations(id) on delete set null,
  add column if not exists event_division_id uuid references public.event_divisions(id) on delete restrict,
  add column if not exists competition_cleared boolean not null default false,
  add column if not exists checked_in_at timestamptz,
  add column if not exists competition_cleared_at timestamptz;

create unique index if not exists event_roster_entries_registration_uidx
  on public.event_roster_entries(registration_id)
  where registration_id is not null;

alter table public.event_roster_entries drop column if exists can_compete;
alter table public.event_roster_entries
  add column can_compete boolean generated always as (
    attendance_status='approved'
    and checked_in
    and competition_cleared
  ) stored;

create or replace function private.event_is_public(check_event uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.events e
    where e.id=check_event
      and e.published_at is not null
      and e.status::text in ('published','live','completed','cancelled')
  );
$$;

revoke execute on function private.event_is_public(uuid) from public;
grant execute on function private.event_is_public(uuid) to anon,authenticated;

create or replace function private.pack6_event_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old text;
  v_new text;
begin
  if not exists (select 1 from pg_timezone_names where name=new.timezone) then
    raise exception 'Unknown event timezone';
  end if;

  if new.registration_opens_at is not null and new.registration_closes_at is not null
    and new.registration_closes_at <= new.registration_opens_at
  then
    raise exception 'Registration close must be after registration open';
  end if;

  if new.registration_closes_at is not null and new.registration_closes_at > new.ends_at then
    raise exception 'Registration cannot close after the event ends';
  end if;

  if tg_op='UPDATE' then
    v_old := old.status::text;
    v_new := new.status::text;

    if v_old='archived' and to_jsonb(new) <> to_jsonb(old) then
      raise exception 'Archived events are immutable';
    end if;

    if v_old <> v_new and not (
      (v_old='draft' and v_new in ('published','cancelled'))
      or (v_old='published' and v_new in ('draft','live','cancelled'))
      or (v_old='live' and v_new in ('completed','cancelled'))
      or (v_old='completed' and v_new='archived')
      or (v_old='cancelled' and v_new='archived')
    ) then
      raise exception 'Invalid event lifecycle transition from % to %',v_old,v_new;
    end if;

    if v_new='published' then
      new.published_at := coalesce(old.published_at,timezone('utc',now()));
    end if;

    if v_new='cancelled' then
      new.cancelled_at := coalesce(old.cancelled_at,timezone('utc',now()));
      new.registration_open := false;
    end if;

    if v_new='archived' then
      new.archived_at := coalesce(old.archived_at,timezone('utc',now()));
      new.registration_open := false;
    end if;

    if v_new in ('completed','cancelled','archived') then
      new.registration_open := false;
    end if;
  end if;

  if new.registration_open and new.status::text not in ('published','live') then
    raise exception 'Registration can only be opened for published or live events';
  end if;

  return new;
end;
$$;

revoke execute on function private.pack6_event_lifecycle() from public,anon,authenticated;

drop trigger if exists pack6_event_lifecycle on public.events;
create trigger pack6_event_lifecycle
before insert or update on public.events
for each row execute function private.pack6_event_lifecycle();

drop policy if exists events_anon_read on public.events;
create policy events_anon_read
on public.events for select
to anon
using (
  published_at is not null
  and status::text in ('published','live','completed','cancelled')
);

revoke select on public.events from anon;
grant select (
  id,organization_id,season_id,name,venue,starts_at,ends_at,organizer_name,event_type,
  standings_mode,status,timezone,livestream_url,registration_open,registration_fee_cents,
  currency,ruleset_id,ruleset_snapshot_id,public_description,registration_opens_at,
  registration_closes_at,registration_capacity,waitlist_enabled,published_at,cancelled_at
) on public.events to anon;

revoke select on public.event_divisions from anon;
grant select (
  id,event_id,division_id,ruleset_id,ruleset_snapshot_id,division_snapshot,
  registration_limit,is_registration_open,created_at,updated_at
) on public.event_divisions to anon;

create or replace function private.pack6_evaluate_eligibility(
  p_division_snapshot jsonb,
  p_registration_kind public.registration_kind,
  p_team_size integer,
  p_age_years integer,
  p_weight_kg numeric,
  p_experience_years numeric,
  p_declarations jsonb,
  p_custom_values jsonb
)
returns jsonb
language plpgsql
immutable
set search_path=''
as $$
declare
  v_reasons jsonb := '[]'::jsonb;
  v_ineligible boolean := false;
  v_review boolean := false;
  v_expected_team integer;
  v_age_min numeric;
  v_age_max numeric;
  v_weight_min numeric;
  v_weight_max numeric;
  v_exp_min numeric;
  v_exp_max numeric;
  v_rule jsonb;
  v_key text;
  v_expected text;
  v_actual text;
begin
  if jsonb_typeof(coalesce(p_declarations,'{}'::jsonb)) <> 'object' then
    raise exception 'Declarations must be an object';
  end if;
  if jsonb_typeof(coalesce(p_custom_values,'{}'::jsonb)) <> 'object' then
    raise exception 'Custom eligibility values must be an object';
  end if;

  v_expected_team := nullif(p_division_snapshot->>'teamSize','')::integer;
  v_age_min := nullif(p_division_snapshot->>'ageMin','')::numeric;
  v_age_max := nullif(p_division_snapshot->>'ageMax','')::numeric;
  v_weight_min := nullif(p_division_snapshot->>'minWeightKg','')::numeric;
  v_weight_max := nullif(p_division_snapshot->>'maxWeightKg','')::numeric;
  v_exp_min := nullif(p_division_snapshot->>'minExperienceYears','')::numeric;
  v_exp_max := nullif(p_division_snapshot->>'maxExperienceYears','')::numeric;

  if coalesce(v_expected_team,1) > 1 then
    if p_registration_kind <> 'team' then
      v_ineligible := true;
      v_reasons := v_reasons || jsonb_build_array('This division requires a team registration.');
    elsif p_team_size is distinct from v_expected_team then
      v_ineligible := true;
      v_reasons := v_reasons || jsonb_build_array('Team size must be exactly '||v_expected_team||'.');
    end if;
  elsif p_registration_kind='team' then
    v_ineligible := true;
    v_reasons := v_reasons || jsonb_build_array('This division requires an individual registration.');
  end if;

  if p_registration_kind='team' and (
    v_age_min is not null or v_age_max is not null
    or v_weight_min is not null or v_weight_max is not null
    or v_exp_min is not null or v_exp_max is not null
  ) then
    v_review := true;
    v_reasons := v_reasons || jsonb_build_array('Individual team member eligibility requires organizer verification.');
  elsif p_registration_kind='individual' then
    if v_age_min is not null or v_age_max is not null then
      if p_age_years is null then
        v_review := true;
        v_reasons := v_reasons || jsonb_build_array('Age needs verification.');
      elsif (v_age_min is not null and p_age_years < v_age_min)
        or (v_age_max is not null and p_age_years > v_age_max)
      then
        v_ineligible := true;
        v_reasons := v_reasons || jsonb_build_array('Age is outside the configured division range.');
      end if;
    end if;

    if v_weight_min is not null or v_weight_max is not null then
      if p_weight_kg is null then
        v_review := true;
        v_reasons := v_reasons || jsonb_build_array('Weight needs verification.');
      elsif (v_weight_min is not null and p_weight_kg < v_weight_min)
        or (v_weight_max is not null and p_weight_kg > v_weight_max)
      then
        v_ineligible := true;
        v_reasons := v_reasons || jsonb_build_array('Weight is outside the configured division range.');
      end if;
    end if;

    if v_exp_min is not null or v_exp_max is not null then
      if p_experience_years is null then
        v_review := true;
        v_reasons := v_reasons || jsonb_build_array('Experience needs verification.');
      elsif (v_exp_min is not null and p_experience_years < v_exp_min)
        or (v_exp_max is not null and p_experience_years > v_exp_max)
      then
        v_ineligible := true;
        v_reasons := v_reasons || jsonb_build_array('Experience is outside the configured division range.');
      end if;
    end if;
  end if;

  for v_rule in
    select value
    from jsonb_array_elements(coalesce(p_division_snapshot->'eligibilityRules','[]'::jsonb))
  loop
    if v_rule->>'kind'='declaration' then
      v_key := nullif(v_rule->>'key','');
      if v_key is not null and coalesce((p_declarations->>v_key)::boolean,false) is not true then
        v_review := true;
        v_reasons := v_reasons || jsonb_build_array(coalesce(v_rule->>'label',v_key)||' needs organizer verification.');
      end if;
    elsif v_rule->>'kind'='custom' then
      v_key := nullif(v_rule->>'key','');
      v_expected := v_rule->>'value';
      v_actual := p_custom_values->>v_key;
      if v_key is not null and v_actual is null then
        v_review := true;
        v_reasons := v_reasons || jsonb_build_array(coalesce(v_rule->>'label',v_key)||' needs organizer verification.');
      elsif v_expected is not null and v_actual is distinct from v_expected then
        v_ineligible := true;
        v_reasons := v_reasons || jsonb_build_array(coalesce(v_rule->>'label',v_key)||' does not meet the configured requirement.');
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status',case when v_ineligible then 'ineligible' when v_review then 'needs_review' else 'eligible' end,
    'reasons',v_reasons
  );
end;
$$;

revoke execute on function private.pack6_evaluate_eligibility(jsonb,public.registration_kind,integer,integer,numeric,numeric,jsonb,jsonb)
from public,anon,authenticated;

create or replace function private.pack6_submit_event_registration(
  p_event_id uuid,
  p_event_division_id uuid,
  p_registration_kind public.registration_kind,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_team_roster jsonb,
  p_fighter_identity_id uuid,
  p_age_years integer,
  p_weight_kg numeric,
  p_experience_years numeric,
  p_declarations jsonb,
  p_custom_values jsonb,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_division public.event_divisions%rowtype;
  v_registration public.event_registrations%rowtype;
  v_eval jsonb;
  v_status public.registration_status := 'pending';
  v_team_size integer;
  v_category text;
  v_event_count integer;
  v_division_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('pack6-registration:'||p_event_id::text));

  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;

  if v_event.published_at is null
    or v_event.status::text not in ('published','live')
    or not v_event.registration_open
  then
    raise exception 'Registration is not open';
  end if;

  if v_event.registration_opens_at is not null and timezone('utc',now()) < v_event.registration_opens_at then
    raise exception 'Registration has not opened yet';
  end if;
  if v_event.registration_closes_at is not null and timezone('utc',now()) > v_event.registration_closes_at then
    raise exception 'Registration is closed';
  end if;

  select * into v_division
  from public.event_divisions
  where id=p_event_division_id and event_id=p_event_id
  for update;
  if not found then raise exception 'Event division not found'; end if;
  if not v_division.is_registration_open then raise exception 'Registration is closed for this division'; end if;

  if length(trim(coalesce(p_email,''))) < 5 or position('@' in p_email)=0 then raise exception 'Valid email required'; end if;
  if length(trim(coalesce(p_display_name,''))) < 2 then raise exception 'Name required'; end if;
  if length(coalesce(p_phone,'')) > 200 or length(coalesce(p_emergency_contact,'')) > 300 then
    raise exception 'Contact details are too long';
  end if;
  if p_age_years is not null and (p_age_years < 0 or p_age_years > 120) then raise exception 'Age is invalid'; end if;
  if p_weight_kg is not null and (p_weight_kg <= 0 or p_weight_kg > 500) then raise exception 'Weight is invalid'; end if;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 100) then raise exception 'Experience is invalid'; end if;

  if p_registration_kind='team' then
    if length(trim(coalesce(p_team_name,''))) < 2 then raise exception 'Team name required'; end if;
    if jsonb_typeof(coalesce(p_team_roster,'[]'::jsonb)) <> 'array' then raise exception 'Team roster must be an array'; end if;
    v_team_size := jsonb_array_length(coalesce(p_team_roster,'[]'::jsonb));
    if v_team_size < 1 or v_team_size > 100 then raise exception 'Team roster size is invalid'; end if;
  else
    v_team_size := null;
    if coalesce(jsonb_array_length(coalesce(p_team_roster,'[]'::jsonb)),0) <> 0 then
      raise exception 'Individual registration cannot include a team roster';
    end if;
  end if;

  if p_fighter_identity_id is not null and not exists (
    select 1 from public.fighter_identities fi
    where fi.id=p_fighter_identity_id and fi.deleted_at is null
  ) then
    raise exception 'Fighter identity not found';
  end if;

  if exists (
    select 1 from public.event_registrations r
    where r.event_id=p_event_id
      and r.event_division_id=p_event_division_id
      and lower(r.email)=lower(trim(p_email))
      and r.status in ('pending','approved','waitlisted')
  ) then
    raise exception 'This email already has an active registration for this division';
  end if;

  if p_registration_kind='team' and exists (
    select 1 from public.event_registrations r
    where r.event_id=p_event_id
      and r.event_division_id=p_event_division_id
      and r.registration_kind='team'
      and lower(r.team_name)=lower(trim(p_team_name))
      and r.status in ('pending','approved','waitlisted')
  ) then
    raise exception 'This team already has an active registration for this division';
  end if;

  v_eval := private.pack6_evaluate_eligibility(
    coalesce(v_division.division_snapshot,'{}'::jsonb),
    p_registration_kind,
    v_team_size,
    p_age_years,
    p_weight_kg,
    p_experience_years,
    coalesce(p_declarations,'{}'::jsonb),
    coalesce(p_custom_values,'{}'::jsonb)
  );

  select count(*)::integer into v_event_count
  from public.event_registrations r
  where r.event_id=p_event_id and r.status='approved';

  select count(*)::integer into v_division_count
  from public.event_registrations r
  where r.event_division_id=p_event_division_id and r.status='approved';

  if (v_event.registration_capacity is not null and v_event_count >= v_event.registration_capacity)
    or (v_division.registration_limit is not null and v_division_count >= v_division.registration_limit)
  then
    if v_event.waitlist_enabled then
      v_status := 'waitlisted';
    else
      raise exception 'Registration capacity is full';
    end if;
  end if;

  v_category := coalesce(
    nullif(v_division.division_snapshot->>'name',''),
    nullif(v_division.division_snapshot->>'competitionFormatId',''),
    'Event division'
  );

  insert into public.event_registrations(
    event_id,email,display_name,team_name,category,phone,emergency_contact,
    waiver_acknowledged,payment_status,registration_kind,event_division_id,
    fighter_identity_id,submitted_by_user_id,team_roster,team_size,
    eligibility_status,eligibility_reasons,eligibility_snapshot,status
  )
  values (
    p_event_id,lower(trim(p_email)),trim(p_display_name),
    case when p_registration_kind='team' then trim(p_team_name) else nullif(trim(coalesce(p_team_name,'')),'') end,
    v_category,nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_emergency_contact,'')),''),
    p_waiver_acknowledged,
    case when v_event.registration_fee_cents=0 then 'not_required'::public.payment_status else 'pending'::public.payment_status end,
    p_registration_kind,p_event_division_id,p_fighter_identity_id,(select auth.uid()),
    case when p_registration_kind='team' then p_team_roster else '[]'::jsonb end,
    v_team_size,
    (v_eval->>'status')::public.registration_eligibility_status,
    coalesce(v_eval->'reasons','[]'::jsonb),
    jsonb_build_object(
      'ageYears',p_age_years,
      'weightKg',p_weight_kg,
      'experienceYears',p_experience_years,
      'declarations',coalesce(p_declarations,'{}'::jsonb),
      'customValues',coalesce(p_custom_values,'{}'::jsonb)
    ),
    v_status
  )
  returning * into v_registration;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,p_event_id,(select auth.uid()),
    'event_registrations',v_registration.id,'submit_registration',
    jsonb_build_object(
      'divisionId',p_event_division_id,
      'kind',p_registration_kind,
      'status',v_registration.status,
      'eligibilityStatus',v_registration.eligibility_status
    )
  );

  return jsonb_build_object(
    'registrationId',v_registration.id,
    'registrationToken',v_registration.registration_token,
    'status',v_registration.status,
    'eligibilityStatus',v_registration.eligibility_status,
    'eligibilityReasons',v_registration.eligibility_reasons,
    'paymentRequired',v_event.registration_fee_cents > 0,
    'amountCents',v_event.registration_fee_cents,
    'currency',v_event.currency
  );
end;
$$;

revoke execute on function private.pack6_submit_event_registration(
  uuid,uuid,public.registration_kind,text,text,text,jsonb,uuid,integer,numeric,numeric,jsonb,jsonb,text,text,boolean
) from public,anon,authenticated;
grant execute on function private.pack6_submit_event_registration(
  uuid,uuid,public.registration_kind,text,text,text,jsonb,uuid,integer,numeric,numeric,jsonb,jsonb,text,text,boolean
) to anon,authenticated;

create or replace function public.submit_event_registration(
  p_event_id uuid,
  p_event_division_id uuid,
  p_registration_kind public.registration_kind,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_team_roster jsonb,
  p_fighter_identity_id uuid,
  p_age_years integer,
  p_weight_kg numeric,
  p_experience_years numeric,
  p_declarations jsonb,
  p_custom_values jsonb,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.pack6_submit_event_registration(
    p_event_id,p_event_division_id,p_registration_kind,p_email,p_display_name,p_team_name,
    p_team_roster,p_fighter_identity_id,p_age_years,p_weight_kg,p_experience_years,
    p_declarations,p_custom_values,p_phone,p_emergency_contact,p_waiver_acknowledged
  );
$$;

revoke all on function public.submit_event_registration(
  uuid,uuid,public.registration_kind,text,text,text,jsonb,uuid,integer,numeric,numeric,jsonb,jsonb,text,text,boolean
) from public;
grant execute on function public.submit_event_registration(
  uuid,uuid,public.registration_kind,text,text,text,jsonb,uuid,integer,numeric,numeric,jsonb,jsonb,text,text,boolean
) to anon,authenticated;

create or replace function private.pack6_submit_legacy_registration(
  p_event_id uuid,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_category text,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_registration public.event_registrations%rowtype;
  v_count integer;
  v_status public.registration_status := 'pending';
begin
  perform pg_advisory_xact_lock(hashtext('pack6-registration:'||p_event_id::text));
  select * into v_event from public.events where id=p_event_id for update;
  if not found
    or v_event.published_at is null
    or v_event.status::text not in ('published','live')
    or not v_event.registration_open
  then
    raise exception 'Registration is not open';
  end if;
  if v_event.registration_opens_at is not null and timezone('utc',now()) < v_event.registration_opens_at then
    raise exception 'Registration has not opened yet';
  end if;
  if v_event.registration_closes_at is not null and timezone('utc',now()) > v_event.registration_closes_at then
    raise exception 'Registration is closed';
  end if;
  if length(trim(coalesce(p_email,''))) < 5 or position('@' in p_email)=0 then raise exception 'Valid email required'; end if;
  if length(trim(coalesce(p_display_name,''))) < 2 then raise exception 'Name required'; end if;
  if length(trim(coalesce(p_category,''))) < 1 then raise exception 'Category required'; end if;

  if exists (
    select 1 from public.event_registrations r
    where r.event_id=p_event_id and r.event_division_id is null
      and lower(r.email)=lower(trim(p_email)) and lower(r.category)=lower(trim(p_category))
      and r.status in ('pending','approved','waitlisted')
  ) then
    raise exception 'This email is already registered for that category';
  end if;

  select count(*)::integer into v_count
  from public.event_registrations r
  where r.event_id=p_event_id and r.status='approved';

  if v_event.registration_capacity is not null and v_count >= v_event.registration_capacity then
    if v_event.waitlist_enabled then v_status:='waitlisted';
    else raise exception 'Registration capacity is full';
    end if;
  end if;

  insert into public.event_registrations(
    event_id,email,display_name,team_name,category,phone,emergency_contact,
    waiver_acknowledged,payment_status,status,eligibility_status,eligibility_reasons
  )
  values (
    p_event_id,lower(trim(p_email)),trim(p_display_name),nullif(trim(coalesce(p_team_name,'')),''),
    trim(p_category),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_emergency_contact,'')),''),
    p_waiver_acknowledged,
    case when v_event.registration_fee_cents=0 then 'not_required'::public.payment_status else 'pending'::public.payment_status end,
    v_status,'needs_review','["Legacy category registration requires organizer division review."]'::jsonb
  )
  returning * into v_registration;

  return jsonb_build_object(
    'registrationId',v_registration.id,
    'registrationToken',v_registration.registration_token,
    'status',v_registration.status,
    'eligibilityStatus',v_registration.eligibility_status,
    'eligibilityReasons',v_registration.eligibility_reasons,
    'paymentRequired',v_event.registration_fee_cents > 0,
    'amountCents',v_event.registration_fee_cents,
    'currency',v_event.currency
  );
end;
$$;

revoke execute on function private.pack6_submit_legacy_registration(uuid,text,text,text,text,text,text,boolean)
from public,anon,authenticated;
grant execute on function private.pack6_submit_legacy_registration(uuid,text,text,text,text,text,text,boolean)
to anon,authenticated;

create or replace function public.submit_public_registration(
  p_event_id uuid,
  p_email text,
  p_display_name text,
  p_team_name text,
  p_category text,
  p_phone text,
  p_emergency_contact text,
  p_waiver_acknowledged boolean
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.pack6_submit_legacy_registration(
    p_event_id,p_email,p_display_name,p_team_name,p_category,p_phone,p_emergency_contact,p_waiver_acknowledged
  );
$$;

revoke all on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) from public;
grant execute on function public.submit_public_registration(uuid,text,text,text,text,text,text,boolean) to anon,authenticated;

drop policy if exists registrations_public_insert on public.event_registrations;
revoke insert,update,delete on public.event_registrations from anon,authenticated;
grant select on public.event_registrations to authenticated;

create or replace function private.pack6_review_registration(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.registration_status,
  p_eligibility_override_reason text,
  p_organizer_notes text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_registration public.event_registrations%rowtype;
  v_event public.events%rowtype;
  v_division public.event_divisions%rowtype;
  v_team_id uuid;
  v_fighter_id uuid;
  v_roster_id uuid;
  v_event_count integer;
  v_division_count integer;
  v_entry_type public.roster_entry_type;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_registration
  from public.event_registrations
  where id=p_registration_id
  for update;
  if not found then raise exception 'Registration not found'; end if;

  select * into v_event from public.events where id=v_registration.event_id;
  if not found then raise exception 'Event not found'; end if;

  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role(v_actor,v_event.id,array['event_organizer']::public.event_role[])
  ) then
    raise exception 'Not authorized to review registrations';
  end if;

  if p_expected_updated_at is null or v_registration.updated_at <> p_expected_updated_at then
    raise exception 'Registration changed on another device';
  end if;

  if p_status not in ('approved','waitlisted','withdrawn','rejected') then
    raise exception 'Unsupported registration review status';
  end if;

  if v_registration.status in ('withdrawn','rejected') and p_status <> v_registration.status then
    raise exception 'Withdrawn or rejected registrations are final';
  end if;

  if v_registration.status='approved' and p_status not in ('approved','withdrawn') then
    raise exception 'Approved registration can only remain approved or be withdrawn';
  end if;

  if p_status='approved' then
    if v_event.status::text not in ('published','live') then
      raise exception 'Only active events can approve registrations';
    end if;

    if v_registration.eligibility_status='ineligible' then
      raise exception 'Ineligible registration cannot be approved';
    end if;

    if v_registration.eligibility_status='needs_review'
      and length(trim(coalesce(p_eligibility_override_reason,''))) < 3
    then
      raise exception 'Eligibility review reason is required before approval';
    end if;

    perform pg_advisory_xact_lock(hashtext('pack6-registration:'||v_event.id::text));

    select count(*)::integer into v_event_count
    from public.event_registrations r
    where r.event_id=v_event.id and r.status='approved' and r.id<>v_registration.id;

    if v_event.registration_capacity is not null and v_event_count >= v_event.registration_capacity then
      raise exception 'Event capacity reached; waitlist this registration instead';
    end if;

    if v_registration.event_division_id is not null then
      select * into v_division
      from public.event_divisions
      where id=v_registration.event_division_id and event_id=v_event.id
      for update;
      if not found then raise exception 'Registration division no longer exists'; end if;

      select count(*)::integer into v_division_count
      from public.event_registrations r
      where r.event_division_id=v_division.id and r.status='approved' and r.id<>v_registration.id;

      if v_division.registration_limit is not null and v_division_count >= v_division.registration_limit then
        raise exception 'Division capacity reached; waitlist this registration instead';
      end if;
    end if;

    if v_registration.team_name is not null then
      select id into v_team_id
      from public.teams
      where organization_id=v_event.organization_id
        and lower(name)=lower(v_registration.team_name)
        and is_active
      order by created_at
      limit 1;
    end if;

    if v_registration.registration_kind='individual' and v_registration.fighter_identity_id is not null then
      select id into v_fighter_id
      from public.fighters
      where organization_id=v_event.organization_id
        and identity_id=v_registration.fighter_identity_id
        and deleted_at is null
      order by created_at
      limit 1;
    end if;

    if v_registration.registration_kind='team' then
      v_entry_type := 'team';
    elsif v_fighter_id is not null then
      v_entry_type := 'fighter';
    else
      v_entry_type := 'guest_fighter';
    end if;

    select id into v_roster_id
    from public.event_roster_entries
    where registration_id=v_registration.id
    limit 1;

    if v_roster_id is null then
      insert into public.event_roster_entries(
        organization_id,event_id,team_id,fighter_id,entry_type,display_name,
        checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared,
        attendance_status,metadata,created_by,last_edited_by,registration_id,
        event_division_id,competition_cleared
      )
      values (
        v_event.organization_id,v_event.id,v_team_id,v_fighter_id,v_entry_type,
        case when v_registration.registration_kind='team' then v_registration.team_name else v_registration.display_name end,
        false,false,false,false,false,'approved',
        jsonb_build_object(
          'registrationId',v_registration.id,
          'category',v_registration.category,
          'teamRoster',v_registration.team_roster,
          'eligibilityStatus',v_registration.eligibility_status
        ),
        v_actor,v_actor,v_registration.id,v_registration.event_division_id,false
      )
      returning id into v_roster_id;
    else
      update public.event_roster_entries
      set attendance_status='approved',
          team_id=v_team_id,
          fighter_id=v_fighter_id,
          entry_type=v_entry_type,
          display_name=case when v_registration.registration_kind='team' then v_registration.team_name else v_registration.display_name end,
          event_division_id=v_registration.event_division_id,
          competition_cleared=false,
          competition_cleared_at=null,
          last_edited_by=v_actor
      where id=v_roster_id;
    end if;
  elsif p_status in ('withdrawn','rejected','waitlisted') then
    select id into v_roster_id
    from public.event_roster_entries
    where registration_id=v_registration.id
    limit 1;
    if v_roster_id is not null then
      update public.event_roster_entries
      set attendance_status='withdrawn',
          competition_cleared=false,
          competition_cleared_at=null,
          last_edited_by=v_actor
      where id=v_roster_id;
    end if;
  end if;

  update public.event_registrations
  set status=p_status,
      reviewed_by=v_actor,
      reviewed_at=timezone('utc',now()),
      withdrawn_at=case when p_status='withdrawn' then timezone('utc',now()) else withdrawn_at end,
      eligibility_override_reason=case
        when p_status='approved' and eligibility_status='needs_review'
          then nullif(trim(coalesce(p_eligibility_override_reason,'')),'')
        else eligibility_override_reason
      end,
      organizer_notes=case
        when p_organizer_notes is null then organizer_notes
        else nullif(trim(p_organizer_notes),'')
      end
  where id=v_registration.id;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,v_event.id,v_actor,'event_registrations',v_registration.id,
    'review_registration',
    jsonb_build_object(
      'from',v_registration.status,
      'to',p_status,
      'rosterEntryId',v_roster_id,
      'eligibilityStatus',v_registration.eligibility_status,
      'eligibilityOverrideReason',nullif(trim(coalesce(p_eligibility_override_reason,'')),'')
    )
  );

  return v_roster_id;
end;
$$;

revoke execute on function private.pack6_review_registration(uuid,timestamptz,public.registration_status,text,text)
from public,anon,authenticated;
grant execute on function private.pack6_review_registration(uuid,timestamptz,public.registration_status,text,text)
to authenticated;

create or replace function public.review_event_registration_guarded(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.registration_status
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.pack6_review_registration(
    p_registration_id,p_expected_updated_at,p_status,null,null
  );
$$;

create or replace function public.review_event_registration_v2_guarded(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.registration_status,
  p_eligibility_override_reason text default null,
  p_organizer_notes text default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.pack6_review_registration(
    p_registration_id,p_expected_updated_at,p_status,p_eligibility_override_reason,p_organizer_notes
  );
$$;

revoke all on function public.review_event_registration_guarded(uuid,timestamptz,public.registration_status) from public,anon;
grant execute on function public.review_event_registration_guarded(uuid,timestamptz,public.registration_status) to authenticated;
revoke all on function public.review_event_registration_v2_guarded(uuid,timestamptz,public.registration_status,text,text) from public,anon;
grant execute on function public.review_event_registration_v2_guarded(uuid,timestamptz,public.registration_status,text,text) to authenticated;

create or replace function private.pack6_update_registration_roster(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_team_name text,
  p_team_roster jsonb,
  p_organizer_notes text
)
returns timestamptz
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_registration public.event_registrations%rowtype;
  v_event public.events%rowtype;
  v_division public.event_divisions%rowtype;
  v_eval jsonb;
  v_size integer;
  v_updated timestamptz;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_registration
  from public.event_registrations
  where id=p_registration_id
  for update;
  if not found then raise exception 'Registration not found'; end if;

  select * into v_event from public.events where id=v_registration.event_id;
  if not (
    private.is_platform_admin(v_actor)
    or private.has_org_role(v_actor,v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role(v_actor,v_event.id,array['event_organizer']::public.event_role[])
  ) then
    raise exception 'Not authorized to edit registration roster';
  end if;

  if p_expected_updated_at is null or v_registration.updated_at <> p_expected_updated_at then
    raise exception 'Registration changed on another device';
  end if;
  if v_registration.registration_kind <> 'team' then raise exception 'Registration is not a team entry'; end if;
  if v_registration.status not in ('pending','waitlisted') then raise exception 'Only pending or waitlisted team rosters can be edited'; end if;
  if length(trim(coalesce(p_team_name,''))) < 2 then raise exception 'Team name required'; end if;
  if jsonb_typeof(coalesce(p_team_roster,'[]'::jsonb)) <> 'array' then raise exception 'Team roster must be an array'; end if;

  v_size := jsonb_array_length(p_team_roster);
  if v_size < 1 or v_size > 100 then raise exception 'Team roster size is invalid'; end if;

  select * into v_division from public.event_divisions where id=v_registration.event_division_id;
  if found then
    v_eval := private.pack6_evaluate_eligibility(
      coalesce(v_division.division_snapshot,'{}'::jsonb),'team',v_size,
      nullif(v_registration.eligibility_snapshot->>'ageYears','')::integer,
      nullif(v_registration.eligibility_snapshot->>'weightKg','')::numeric,
      nullif(v_registration.eligibility_snapshot->>'experienceYears','')::numeric,
      coalesce(v_registration.eligibility_snapshot->'declarations','{}'::jsonb),
      coalesce(v_registration.eligibility_snapshot->'customValues','{}'::jsonb)
    );
  else
    v_eval := jsonb_build_object(
      'status','needs_review',
      'reasons',jsonb_build_array('Legacy category registration requires organizer division review.')
    );
  end if;

  update public.event_registrations
  set team_name=trim(p_team_name),
      team_roster=p_team_roster,
      team_size=v_size,
      eligibility_status=(v_eval->>'status')::public.registration_eligibility_status,
      eligibility_reasons=coalesce(v_eval->'reasons','[]'::jsonb),
      organizer_notes=case when p_organizer_notes is null then organizer_notes else nullif(trim(p_organizer_notes),'') end,
      reviewed_by=v_actor
  where id=v_registration.id
  returning updated_at into v_updated;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,v_event.id,v_actor,'event_registrations',v_registration.id,
    'update_team_roster',jsonb_build_object('teamSize',v_size)
  );

  return v_updated;
end;
$$;

revoke execute on function private.pack6_update_registration_roster(uuid,timestamptz,text,jsonb,text)
from public,anon,authenticated;
grant execute on function private.pack6_update_registration_roster(uuid,timestamptz,text,jsonb,text)
to authenticated;

create or replace function public.update_registration_roster_guarded(
  p_registration_id uuid,
  p_expected_updated_at timestamptz,
  p_team_name text,
  p_team_roster jsonb,
  p_organizer_notes text default null
)
returns timestamptz
language sql
security invoker
set search_path=''
as $$
  select private.pack6_update_registration_roster(
    p_registration_id,p_expected_updated_at,p_team_name,p_team_roster,p_organizer_notes
  );
$$;

revoke all on function public.update_registration_roster_guarded(uuid,timestamptz,text,jsonb,text) from public,anon;
grant execute on function public.update_registration_roster_guarded(uuid,timestamptz,text,jsonb,text) to authenticated;

create or replace function private.pack6_withdraw_registration(
  p_registration_id uuid,
  p_registration_token uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_registration public.event_registrations%rowtype;
  v_event public.events%rowtype;
begin
  select * into v_registration
  from public.event_registrations
  where id=p_registration_id
  for update;
  if not found or v_registration.registration_token <> p_registration_token then
    raise exception 'Registration not found';
  end if;

  if v_registration.status='withdrawn' then return; end if;
  if v_registration.status='rejected' then raise exception 'Rejected registration cannot be withdrawn'; end if;

  select * into v_event from public.events where id=v_registration.event_id;

  update public.event_registrations
  set status='withdrawn',withdrawn_at=timezone('utc',now())
  where id=v_registration.id;

  update public.event_roster_entries
  set attendance_status='withdrawn',
      competition_cleared=false,
      competition_cleared_at=null
  where registration_id=v_registration.id;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,v_event.id,(select auth.uid()),'event_registrations',
    v_registration.id,'withdraw_registration','{}'::jsonb
  );
end;
$$;

revoke execute on function private.pack6_withdraw_registration(uuid,uuid) from public,anon,authenticated;
grant execute on function private.pack6_withdraw_registration(uuid,uuid) to anon,authenticated;

create or replace function public.withdraw_event_registration(
  p_registration_id uuid,
  p_registration_token uuid
)
returns void
language sql
security invoker
set search_path=''
as $$
  select private.pack6_withdraw_registration(p_registration_id,p_registration_token);
$$;

revoke all on function public.withdraw_event_registration(uuid,uuid) from public;
grant execute on function public.withdraw_event_registration(uuid,uuid) to anon,authenticated;

create or replace function public.update_event_details_guarded(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_venue text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_status public.event_status,
  p_event_type public.event_type,
  p_standings_mode public.standings_mode,
  p_registration_open boolean,
  p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz,
  p_registration_capacity integer,
  p_waitlist_enabled boolean,
  p_public_description text,
  p_livestream_url text
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_updated timestamptz;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_event.id,array['event_organizer']::public.event_role[])
  ) then
    raise exception 'Not authorized to update event settings';
  end if;

  if p_expected_updated_at is null or v_event.updated_at <> p_expected_updated_at then
    raise exception 'Event settings changed on another device';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Event name is required'; end if;
  if length(trim(coalesce(p_venue,''))) < 2 then raise exception 'Venue is required'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Event end must be after event start'; end if;
  if p_registration_capacity is not null and p_registration_capacity < 1 then raise exception 'Registration capacity must be positive'; end if;
  if nullif(trim(coalesce(p_livestream_url,'')),'') is not null and lower(trim(p_livestream_url)) !~ '^https://' then
    raise exception 'Livestream URL must use HTTPS';
  end if;

  update public.events
  set name=trim(p_name),
      venue=trim(p_venue),
      starts_at=p_starts_at,
      ends_at=p_ends_at,
      timezone=trim(p_timezone),
      status=p_status,
      event_type=p_event_type,
      standings_mode=p_standings_mode,
      registration_open=p_registration_open,
      registration_opens_at=p_registration_opens_at,
      registration_closes_at=p_registration_closes_at,
      registration_capacity=p_registration_capacity,
      waitlist_enabled=p_waitlist_enabled,
      public_description=nullif(trim(coalesce(p_public_description,'')),''),
      livestream_url=nullif(trim(coalesce(p_livestream_url,'')),''),
      last_edited_by=(select auth.uid())
  where id=p_event_id
  returning updated_at into v_updated;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_event.organization_id,v_event.id,(select auth.uid()),'events',v_event.id,
    'update_event_details_guarded',
    jsonb_build_object(
      'status',p_status,
      'registrationOpen',p_registration_open,
      'registrationCapacity',p_registration_capacity,
      'registrationOpensAt',p_registration_opens_at,
      'registrationClosesAt',p_registration_closes_at
    )
  );

  return v_updated;
end;
$$;

revoke all on function public.update_event_details_guarded(
  uuid,timestamptz,text,text,timestamptz,timestamptz,text,public.event_status,
  public.event_type,public.standings_mode,boolean,timestamptz,timestamptz,integer,boolean,text,text
) from public,anon;
grant execute on function public.update_event_details_guarded(
  uuid,timestamptz,text,text,timestamptz,timestamptz,text,public.event_status,
  public.event_type,public.standings_mode,boolean,timestamptz,timestamptz,integer,boolean,text,text
) to authenticated;

create or replace function public.update_roster_clearance_guarded(
  p_roster_entry_id uuid,
  p_expected_updated_at timestamptz,
  p_field text,
  p_value boolean
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_entry public.event_roster_entries%rowtype;
  v_updated timestamptz;
begin
  select * into v_entry
  from public.event_roster_entries
  where id=p_roster_entry_id
  for update;
  if not found then raise exception 'Roster entry not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_entry.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_entry.event_id,array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
  ) then
    raise exception 'Not authorized to update roster clearance';
  end if;

  if p_expected_updated_at is null or v_entry.updated_at <> p_expected_updated_at then
    raise exception 'Roster entry changed on another device';
  end if;
  if v_entry.attendance_status <> 'approved' then
    raise exception 'Registration approval is required before check in or clearance';
  end if;
  if p_field not in ('checked_in','armor_cleared','medical_cleared','waiver_confirmed','weigh_in_cleared') then
    raise exception 'Unsupported roster clearance field';
  end if;

  update public.event_roster_entries
  set checked_in=case when p_field='checked_in' then p_value else checked_in end,
      armor_cleared=case when p_field='armor_cleared' then p_value else armor_cleared end,
      medical_cleared=case when p_field='medical_cleared' then p_value else medical_cleared end,
      waiver_confirmed=case when p_field='waiver_confirmed' then p_value else waiver_confirmed end,
      weigh_in_cleared=case when p_field='weigh_in_cleared' then p_value else weigh_in_cleared end,
      checked_in_at=case
        when p_field='checked_in' and p_value then coalesce(checked_in_at,timezone('utc',now()))
        when p_field='checked_in' and not p_value then null
        else checked_in_at
      end,
      competition_cleared=case when not p_value then false else competition_cleared end,
      competition_cleared_at=case when not p_value then null else competition_cleared_at end,
      last_edited_by=(select auth.uid())
  where id=p_roster_entry_id
  returning updated_at into v_updated;

  return v_updated;
end;
$$;

create or replace function public.set_roster_competition_clearance_guarded(
  p_roster_entry_id uuid,
  p_expected_updated_at timestamptz,
  p_cleared boolean
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_entry public.event_roster_entries%rowtype;
  v_event public.events%rowtype;
  v_snapshot public.event_ruleset_snapshots%rowtype;
  v_settings jsonb;
  v_compliance jsonb;
  v_snapshot_id uuid;
  v_updated timestamptz;
begin
  select * into v_entry
  from public.event_roster_entries
  where id=p_roster_entry_id
  for update;
  if not found then raise exception 'Roster entry not found'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_entry.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_entry.event_id,array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
  ) then
    raise exception 'Not authorized to set competition clearance';
  end if;

  if p_expected_updated_at is null or v_entry.updated_at <> p_expected_updated_at then
    raise exception 'Roster entry changed on another device';
  end if;

  if not p_cleared then
    update public.event_roster_entries
    set competition_cleared=false,competition_cleared_at=null,last_edited_by=(select auth.uid())
    where id=v_entry.id
    returning updated_at into v_updated;
    return v_updated;
  end if;

  if v_entry.attendance_status <> 'approved' then raise exception 'Registration approval is required'; end if;

  select * into v_event from public.events where id=v_entry.event_id;
  if v_event.status::text not in ('published','live') then raise exception 'Event is not active for competition clearance'; end if;

  if v_entry.event_division_id is not null then
    select ruleset_snapshot_id into v_snapshot_id
    from public.event_divisions
    where id=v_entry.event_division_id and event_id=v_entry.event_id;
  end if;
  v_snapshot_id := coalesce(v_snapshot_id,v_event.ruleset_snapshot_id);

  if v_snapshot_id is not null then
    select * into v_snapshot from public.event_ruleset_snapshots where id=v_snapshot_id;
    v_settings := coalesce(v_snapshot.resolved_settings,'{}'::jsonb);
    v_compliance := coalesce(v_settings->'compliance','{}'::jsonb);
  else
    v_compliance := '{}'::jsonb;
  end if;

  if coalesce((v_compliance->>'requireCheckIn')::boolean,true) and not v_entry.checked_in then raise exception 'Check in is incomplete'; end if;
  if coalesce((v_compliance->>'requireArmorClearance')::boolean,true) and not v_entry.armor_cleared then raise exception 'Armor clearance is incomplete'; end if;
  if coalesce((v_compliance->>'requireMedicalClearance')::boolean,true) and not v_entry.medical_cleared then raise exception 'Medical clearance is incomplete'; end if;
  if coalesce((v_compliance->>'requireWaiver')::boolean,true) and not v_entry.waiver_confirmed then raise exception 'Waiver clearance is incomplete'; end if;
  if coalesce((v_compliance->>'requireWeighIn')::boolean,true) and not v_entry.weigh_in_cleared then raise exception 'Weigh in is incomplete'; end if;

  update public.event_roster_entries
  set competition_cleared=true,
      competition_cleared_at=timezone('utc',now()),
      last_edited_by=(select auth.uid())
  where id=v_entry.id
  returning updated_at into v_updated;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  )
  values (
    v_entry.organization_id,v_entry.event_id,(select auth.uid()),
    'event_roster_entries',v_entry.id,'set_competition_clearance',
    jsonb_build_object('cleared',true,'rulesetSnapshotId',v_snapshot_id)
  );

  return v_updated;
end;
$$;

revoke all on function public.set_roster_competition_clearance_guarded(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.set_roster_competition_clearance_guarded(uuid,timestamptz,boolean) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname='supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='event_registrations'
  ) then
    alter publication supabase_realtime add table public.event_registrations;
  end if;
end
$$;
