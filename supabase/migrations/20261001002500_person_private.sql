-- Private personal data, entered ONCE and reused to autofill registration forms (account area).
--
-- PRIVACY MODEL (decisions, all deliberate):
--   * person_private holds ONE row per account: legal name, phone, emergency contact, a "medically fit" declaration, a medical note,
--     allergies and blood type. It is NEVER public. anon has no access of any kind. authenticated users have NO table grant either:
--     the only way in or out is get_my_private_profile / save_my_private_profile / delete_my_private_data / registration_prefill,
--     and each only ever touches auth.uid()'s own row.
--   * Nobody else can read it through the API: not an event organizer, not a medic, not a team captain, not an org admin, and NOT the platform
--     owner (platform_roles 'owner'). The owner account gets no default read access; only someone with direct database access
--     (the Supabase dashboard / service role) can see rows, which is outside this application's authority and is why the data is
--     kept minimal and user-deletable.
--   * Organizers and medics keep seeing ONLY the per-event snapshot in registration_private (unchanged): submit_registration COPIES the
--     saved details into that snapshot at submit time, and the snapshot's medical_note is still auto-deleted 30 days after the event
--     (private.purge_medical_notes). Editing or deleting person_private later does not change an already submitted snapshot.
--   * RETENTION: nothing auto-deletes person_private, because it belongs to the user. They can delete it any time with
--     delete_my_private_data() (hard delete). Deleting the auth user cascades. The audit log records WHAT happened (action, which field NAMES
--     changed) and never the contents.
--   * medical_note, allergies and blood_type are never returned by any public view or RPC, and never by a default export.

create table public.person_private (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 2 and 120),
  phone text check (phone is null or (char_length(phone) between 7 and 25 and phone ~ '^[0-9+()./ -]+$' and phone ~ '[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9]')),
  emergency_name text check (emergency_name is null or char_length(emergency_name) between 2 and 120),
  emergency_relationship text check (emergency_relationship is null or char_length(emergency_relationship) <= 60),
  emergency_phone text check (emergency_phone is null or (char_length(emergency_phone) between 7 and 25 and emergency_phone ~ '^[0-9+()./ -]+$' and emergency_phone ~ '[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9]')),
  medically_fit_declared boolean not null default false,
  medical_note text check (medical_note is null or char_length(medical_note) <= 1000),
  allergies text check (allergies is null or char_length(allergies) <= 500),
  blood_type text check (blood_type is null or blood_type in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown')),
  updated_at timestamptz not null default now()
);
alter table public.person_private enable row level security;
-- Defence in depth: a policy for the owner of the row exists, but NO table privilege is granted to anon or authenticated, so it is
-- reachable only through the security-definer functions below.
create policy person_private_own on public.person_private for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.person_private from public, anon, authenticated;

-- ---------------------------------------------------------------- read
create or replace function public.get_my_private_profile()
returns table (full_name text, phone text, emergency_name text, emergency_relationship text, emergency_phone text,
  medically_fit_declared boolean, medical_note text, allergies text, blood_type text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return query select p.full_name, p.phone, p.emergency_name, p.emergency_relationship, p.emergency_phone, p.medically_fit_declared, p.medical_note, p.allergies, p.blood_type, p.updated_at
    from public.person_private p where p.user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------- write
-- Keys (all optional; a key sent as null or '' clears that field; keys left out are untouched): full_name, phone, emergency_name,
-- emergency_relationship, emergency_phone, medically_fit_declared (boolean), medical_note (<=1000), allergies (<=500),
-- blood_type (A+ A- B+ B- AB+ AB- O+ O- unknown). Unknown keys are refused. Returns the saved row.
create or replace function public.save_my_private_profile(p jsonb)
returns table (full_name text, phone text, emergency_name text, emergency_relationship text, emergency_phone text,
  medically_fit_declared boolean, medical_note text, allergies text, blood_type text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); k text; v jsonb; v_txt text; v_max int;
  c_text constant text[] := array['full_name', 'phone', 'emergency_name', 'emergency_relationship', 'emergency_phone', 'medical_note', 'allergies', 'blood_type'];
  v_row public.person_private;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the details as an object' using errcode = '22023'; end if;
  -- Validate everything first, so a refusal leaves no half-written row behind (the whole call is one transaction anyway).
  insert into public.person_private (user_id) values (v_uid) on conflict (user_id) do nothing;
  for k, v in select key, value from jsonb_each(p) loop
    if k = 'medically_fit_declared' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'medically_fit_declared must be true or false' using errcode = '22023'; end if;
      update public.person_private set medically_fit_declared = (v #>> '{}')::boolean where user_id = v_uid;
    elsif k = any (c_text) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      v_max := case k when 'medical_note' then 1000 when 'allergies' then 500 when 'emergency_relationship' then 60 when 'phone' then 25 when 'emergency_phone' then 25 when 'blood_type' then 10 else 120 end;
      if char_length(coalesce(v_txt, '')) > v_max then raise exception '% is too long (at most % characters)', k, v_max using errcode = '22023'; end if;
      if k in ('phone', 'emergency_phone') and v_txt is not null and (v_txt !~ '^[0-9+()./ -]+$' or v_txt !~ '[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9].*[0-9]') then
        raise exception '% must be a phone number of at least 7 digits (digits, spaces, + ( ) . / - only)', k using errcode = '22023'; end if;
      if k in ('full_name', 'emergency_name') and v_txt is not null and char_length(v_txt) < 2 then raise exception '% must be at least 2 characters', k using errcode = '22023'; end if;
      if k = 'blood_type' and v_txt is not null and v_txt not in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown') then
        raise exception 'blood_type must be A+, A-, B+, B-, AB+, AB-, O+, O- or unknown' using errcode = '22023'; end if;
      execute format('update public.person_private set %I = $1 where user_id = $2', k) using v_txt, v_uid;
    else
      raise exception 'this version does not know the field: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  update public.person_private set updated_at = now() where user_id = v_uid returning * into v_row;
  -- Field NAMES only. Contents are never written to the audit log.
  perform private.audit(null, 'person.private_saved', v_uid::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
  return query select v_row.full_name, v_row.phone, v_row.emergency_name, v_row.emergency_relationship, v_row.emergency_phone, v_row.medically_fit_declared,
    v_row.medical_note, v_row.allergies, v_row.blood_type, v_row.updated_at;
end $$;

-- Hard delete of the caller's saved details. Already submitted registration snapshots are NOT touched (they follow their own 30 day purge).
create or replace function public.delete_my_private_data() returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  delete from public.person_private where user_id = auth.uid();
  get diagnostics n = row_count;
  perform private.audit(null, 'person.private_deleted', auth.uid()::text, jsonb_build_object('had_data', n > 0));
  return n > 0;
end $$;

-- ---------------------------------------------------------------- prefill for forms
-- One row (never more) with what a registration form can autofill. Only the caller's own data. full_name falls back to the profile name,
-- then the public fighter name. team_* is the caller's current fighter team when there is one. has_saved says whether person_private exists.
create or replace function public.registration_prefill()
returns table (has_saved boolean, full_name text, phone text, emergency_name text, emergency_relationship text, emergency_phone text,
  medically_fit boolean, medical_note text, allergies text, blood_type text, gender text, team_id uuid, team_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return query
  select (pp.user_id is not null), coalesce(pp.full_name, private.person_name(v_uid)), pp.phone, pp.emergency_name, pp.emergency_relationship, pp.emergency_phone,
    coalesce(pp.medically_fit_declared, false), pp.medical_note, pp.allergies, pp.blood_type, f.gender, t.id, t.name
  from (select 1) x
  left join public.person_private pp on pp.user_id = v_uid
  left join public.fighter_accounts fa on fa.user_id = v_uid
  left join public.fighters f on f.id = fa.fighter_id
  left join public.teams t on t.id = f.team_id and t.status = 'approved';
end $$;

-- ---------------------------------------------------------------- fill a registration's private part from the saved details
-- Missing = key absent, null or blank. Never overrides what the person typed. medically_fit and medical_note are filled only when the key is
-- absent (an explicit false or an explicit empty note is respected). The medical snapshot combines note, allergies and blood type, cut to 1000.
create or replace function private.merge_saved_private(p_priv jsonb, p_pp public.person_private) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb := p_priv; k text; v_note text;
begin
  if p_pp.user_id is null or jsonb_typeof(r) <> 'object' then return p_priv; end if;
  foreach k in array array['emergency_name', 'emergency_relationship', 'emergency_phone'] loop
    if coalesce(btrim(r ->> k), '') = '' and nullif(to_jsonb(p_pp) ->> k, '') is not null then r := r || jsonb_build_object(k, to_jsonb(p_pp) ->> k); end if;
  end loop;
  if (not r ? 'medically_fit' or r -> 'medically_fit' = 'null'::jsonb) and p_pp.medically_fit_declared then r := r || jsonb_build_object('medically_fit', true); end if;
  if not r ? 'medical_note' or r -> 'medical_note' = 'null'::jsonb then
    v_note := left(concat_ws(E'\n', nullif(p_pp.medical_note, ''), case when p_pp.allergies is not null and p_pp.allergies <> '' then 'Allergies: ' || p_pp.allergies end,
      case when p_pp.blood_type is not null then 'Blood type: ' || p_pp.blood_type end), 1000);
    if v_note <> '' then r := r || jsonb_build_object('medical_note', v_note); end if;
  end if;
  return r;
end $$;
revoke execute on function private.merge_saved_private(jsonb, public.person_private) from public, anon, authenticated;

revoke execute on function public.get_my_private_profile(), public.save_my_private_profile(jsonb), public.delete_my_private_data(), public.registration_prefill() from public, anon;
grant execute on function public.get_my_private_profile(), public.save_my_private_profile(jsonb), public.delete_my_private_data(), public.registration_prefill() to authenticated;

-- ---------------------------------------------------------------- submit_registration: the function from 20261001000300 plus ONE autofill step
-- Everything else is byte-for-byte the previous behaviour.
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
  v_pp public.person_private;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  -- NEW (20261001002500): emergency / medical details the person did not type are filled from their saved private profile.
  select * into v_pp from public.person_private where user_id = auth.uid();
  if found then v_priv := private.merge_saved_private(v_priv, v_pp); end if;
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

