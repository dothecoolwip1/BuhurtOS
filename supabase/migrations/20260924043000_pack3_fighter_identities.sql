-- Pack 3: permanent fighter identities, account claims, profile privacy, aliases,
-- duplicate review, merge provenance, affiliation history, and concurrency controls.

create type public.fighter_profile_visibility as enum ('public', 'members', 'private');
create type public.identity_account_role as enum ('self', 'guardian');
create type public.identity_claim_status as enum ('pending', 'approved', 'rejected', 'disputed', 'cancelled');
create type public.identity_merge_status as enum ('pending', 'completed', 'rejected', 'cancelled');

alter table public.fighter_identities
  add column public_region text,
  add column profile_visibility public.fighter_profile_visibility not null default 'private',
  add column profile_revision bigint not null default 1 check (profile_revision > 0),
  add column verified_at timestamptz,
  add column verified_by uuid references public.profiles(id) on delete set null;

drop index if exists public.fighter_identities_user_unique_idx;
create index fighter_identities_user_idx
  on public.fighter_identities(user_id)
  where user_id is not null and deleted_at is null;

create or replace function private.normalize_identity_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(btrim(coalesce(value, ''))), '[^[:alnum:]]+', ' ', 'g'));
$$;

revoke all on function private.normalize_identity_name(text) from public, anon, authenticated;

create table public.fighter_identity_accounts (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.fighter_identities(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  relationship public.identity_account_role not null,
  verified_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  source_claim_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(identity_id, user_id, relationship)
);

create unique index fighter_identity_accounts_one_self_idx
  on public.fighter_identity_accounts(identity_id)
  where relationship = 'self' and revoked_at is null;

create index fighter_identity_accounts_user_idx
  on public.fighter_identity_accounts(user_id, identity_id)
  where revoked_at is null;

insert into public.fighter_identity_accounts(identity_id, user_id, relationship, verified_at, created_by)
select i.id, i.user_id, 'self'::public.identity_account_role, coalesce(i.updated_at, i.created_at), i.created_by
from public.fighter_identities i
where i.user_id is not null
on conflict (identity_id, user_id, relationship) do nothing;

create table public.fighter_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.fighter_identities(id) on delete restrict,
  alias text not null check (length(btrim(alias)) between 1 and 120),
  normalized_alias text not null,
  is_public boolean not null default false,
  source text not null default 'manual',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(identity_id, normalized_alias)
);

create index fighter_identity_aliases_lookup_idx
  on public.fighter_identity_aliases(normalized_alias);

insert into public.fighter_identity_aliases(identity_id, alias, normalized_alias, is_public, source, created_by)
select i.id, i.display_name, private.normalize_identity_name(i.display_name), false, 'legacy_display_name', i.created_by
from public.fighter_identities i
where private.normalize_identity_name(i.display_name) <> ''
on conflict (identity_id, normalized_alias) do nothing;

create table public.fighter_identity_private_profiles (
  identity_id uuid primary key references public.fighter_identities(id) on delete restrict,
  legal_name text,
  birth_date date,
  contact_email text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  guardian_consent_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id) on delete set null,
  check (birth_date is null or birth_date <= current_date)
);

create trigger fighter_identity_private_profiles_updated
before update on public.fighter_identity_private_profiles
for each row execute function public.set_updated_at();

create table public.fighter_identity_claims (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.fighter_identities(id) on delete restrict,
  claimant_user_id uuid not null references public.profiles(id) on delete cascade,
  relationship public.identity_account_role not null,
  status public.identity_claim_status not null default 'pending',
  claim_note text,
  review_note text,
  dispute_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  disputed_by uuid references public.profiles(id) on delete set null,
  disputed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger fighter_identity_claims_updated
before update on public.fighter_identity_claims
for each row execute function public.set_updated_at();

create unique index fighter_identity_claims_active_unique_idx
  on public.fighter_identity_claims(identity_id, claimant_user_id, relationship)
  where status in ('pending', 'disputed');

create index fighter_identity_claims_review_idx
  on public.fighter_identity_claims(status, created_at);

alter table public.fighter_identity_accounts
  add constraint fighter_identity_accounts_source_claim_fk
  foreign key (source_claim_id) references public.fighter_identity_claims(id) on delete set null;

create table public.fighter_identity_merge_reviews (
  id uuid primary key default gen_random_uuid(),
  canonical_identity_id uuid not null references public.fighter_identities(id) on delete restrict,
  duplicate_identity_id uuid not null references public.fighter_identities(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reason text,
  status public.identity_merge_status not null default 'pending',
  canonical_revision bigint not null,
  duplicate_revision bigint not null,
  request_snapshot jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (canonical_identity_id <> duplicate_identity_id)
);

create unique index fighter_identity_merge_reviews_pending_pair_idx
  on public.fighter_identity_merge_reviews(
    least(canonical_identity_id, duplicate_identity_id),
    greatest(canonical_identity_id, duplicate_identity_id)
  )
  where status = 'pending';

create index fighter_identity_merge_reviews_status_idx
  on public.fighter_identity_merge_reviews(status, created_at);

create or replace function private.user_controls_identity(check_user uuid, check_identity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user is not null and exists (
    select 1
    from public.fighter_identity_accounts a
    where a.identity_id = check_identity
      and a.user_id = check_user
      and a.revoked_at is null
  );
$$;

create or replace function private.can_admin_identity(check_user uuid, check_identity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user is not null and (
    private.is_platform_admin(check_user)
    or exists (
      select 1
      from public.fighters f
      where f.identity_id = check_identity
        and private.has_org_role(
          check_user,
          f.organization_id,
          array['organization_admin']::public.organization_role[]
        )
    )
  );
$$;

revoke all on function private.user_controls_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_admin_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function private.user_controls_identity(uuid, uuid) to authenticated;
grant execute on function private.can_admin_identity(uuid, uuid) to authenticated;

alter table public.fighter_identity_accounts enable row level security;
alter table public.fighter_identity_aliases enable row level security;
alter table public.fighter_identity_private_profiles enable row level security;
alter table public.fighter_identity_claims enable row level security;
alter table public.fighter_identity_merge_reviews enable row level security;

drop policy if exists fighter_identities_read on public.fighter_identities;
drop policy if exists fighter_identities_admin_update on public.fighter_identities;

create policy fighter_identities_anon_public_read
on public.fighter_identities
for select to anon
using (
  deleted_at is null
  and merged_into_identity_id is null
  and profile_visibility = 'public'
);

create policy fighter_identities_authenticated_read
on public.fighter_identities
for select to authenticated
using (
  deleted_at is null
  and merged_into_identity_id is null
  and (
    profile_visibility in ('public', 'members')
    or private.user_controls_identity((select auth.uid()), id)
    or private.can_admin_identity((select auth.uid()), id)
  )
);

create policy fighter_identity_accounts_read
on public.fighter_identity_accounts
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.can_admin_identity((select auth.uid()), identity_id)
);

create policy fighter_identity_aliases_anon_read
on public.fighter_identity_aliases
for select to anon
using (
  is_public
  and exists (
    select 1
    from public.fighter_identities i
    where i.id = identity_id
      and i.deleted_at is null
      and i.merged_into_identity_id is null
      and i.profile_visibility = 'public'
  )
);

create policy fighter_identity_aliases_authenticated_read
on public.fighter_identity_aliases
for select to authenticated
using (
  (is_public and exists (
    select 1
    from public.fighter_identities i
    where i.id = identity_id
      and i.deleted_at is null
      and i.merged_into_identity_id is null
      and i.profile_visibility in ('public', 'members')
  ))
  or private.user_controls_identity((select auth.uid()), identity_id)
  or private.can_admin_identity((select auth.uid()), identity_id)
);

create policy fighter_identity_private_profiles_read
on public.fighter_identity_private_profiles
for select to authenticated
using (
  private.user_controls_identity((select auth.uid()), identity_id)
  or private.can_admin_identity((select auth.uid()), identity_id)
);

create policy fighter_identity_claims_read
on public.fighter_identity_claims
for select to authenticated
using (
  claimant_user_id = (select auth.uid())
  or private.can_admin_identity((select auth.uid()), identity_id)
  or private.is_platform_admin((select auth.uid()))
);

create policy fighter_identity_merge_reviews_read
on public.fighter_identity_merge_reviews
for select to authenticated
using (
  requested_by = (select auth.uid())
  or private.is_platform_admin((select auth.uid()))
  or (
    private.can_admin_identity((select auth.uid()), canonical_identity_id)
    and private.can_admin_identity((select auth.uid()), duplicate_identity_id)
  )
);

revoke all on public.fighter_identities from anon, authenticated;
grant select (
  id, display_name, nickname, avatar_path, bio, public_region,
  profile_visibility, profile_revision, updated_at
) on public.fighter_identities to anon;
grant select (
  id, display_name, nickname, avatar_path, bio, public_region,
  profile_visibility, profile_revision, merged_into_identity_id,
  deleted_at, updated_at, verified_at
) on public.fighter_identities to authenticated;

revoke all on public.fighter_identity_accounts from anon, authenticated;
revoke all on public.fighter_identity_aliases from anon, authenticated;
revoke all on public.fighter_identity_private_profiles from anon, authenticated;
revoke all on public.fighter_identity_claims from anon, authenticated;
revoke all on public.fighter_identity_merge_reviews from anon, authenticated;

grant select on public.fighter_identity_accounts to authenticated;
grant select on public.fighter_identity_aliases to authenticated;
grant select on public.fighter_identity_private_profiles to authenticated;
grant select on public.fighter_identity_claims to authenticated;
grant select on public.fighter_identity_merge_reviews to authenticated;
grant select (id, identity_id, alias, is_public, source, created_at)
  on public.fighter_identity_aliases to anon;

grant all on public.fighter_identity_accounts to service_role;
grant all on public.fighter_identity_aliases to service_role;
grant all on public.fighter_identity_private_profiles to service_role;
grant all on public.fighter_identity_claims to service_role;
grant all on public.fighter_identity_merge_reviews to service_role;

revoke insert, update, delete on public.fighter_identities from authenticated;
revoke insert, update, delete on public.fighter_affiliations from authenticated;

create or replace function private.create_my_fighter_identity(p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_identity_id uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Display name must be between 2 and 120 characters';
  end if;

  insert into public.fighter_identities(
    user_id, display_name, profile_visibility, created_by, last_edited_by
  )
  values (
    v_uid, v_name, 'private', v_uid, v_uid
  )
  returning id into v_identity_id;

  insert into public.fighter_identity_accounts(
    identity_id, user_id, relationship, verified_at, created_by
  )
  values (
    v_identity_id, v_uid, 'self', timezone('utc', now()), v_uid
  );

  insert into public.fighter_identity_aliases(
    identity_id, alias, normalized_alias, is_public, source, created_by
  )
  values (
    v_identity_id, v_name, private.normalize_identity_name(v_name), false, 'created_name', v_uid
  )
  on conflict (identity_id, normalized_alias) do nothing;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid, 'fighter_identities', v_identity_id, 'create_fighter_identity',
    jsonb_build_object('relationship', 'self')
  );

  return v_identity_id;
end;
$$;

create or replace function private.search_claimable_fighter_identities(p_query text)
returns table (
  identity_id uuid,
  display_name text,
  nickname text,
  public_region text,
  is_claimed boolean,
  is_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with query as (
    select private.normalize_identity_name(p_query) as q
  )
  select
    i.id,
    i.display_name,
    i.nickname,
    i.public_region,
    exists (
      select 1 from public.fighter_identity_accounts a
      where a.identity_id = i.id
        and a.relationship = 'self'
        and a.revoked_at is null
    ) as is_claimed,
    i.verified_at is not null as is_verified
  from public.fighter_identities i
  cross join query
  where length(query.q) >= 3
    and i.deleted_at is null
    and i.merged_into_identity_id is null
    and (
      private.normalize_identity_name(i.display_name) like '%' || query.q || '%'
      or exists (
        select 1
        from public.fighter_identity_aliases a
        where a.identity_id = i.id
          and a.normalized_alias like '%' || query.q || '%'
      )
    )
    and (
      i.profile_visibility in ('public', 'members')
      or (
        not exists (
          select 1 from public.fighter_identity_accounts owner_link
          where owner_link.identity_id = i.id
            and owner_link.relationship = 'self'
            and owner_link.revoked_at is null
        )
        and exists (
          select 1
          from public.fighters f
          join public.event_roster_entries r on r.fighter_id = f.id
          join public.events e on e.id = r.event_id
          where f.identity_id = i.id
            and e.status in ('published', 'live', 'completed')
        )
      )
    )
  order by
    (private.normalize_identity_name(i.display_name) = query.q) desc,
    i.display_name
  limit 20;
$$;

create or replace function private.update_fighter_public_profile(
  p_identity_id uuid,
  p_expected_revision bigint,
  p_display_name text,
  p_nickname text,
  p_bio text,
  p_public_region text,
  p_visibility public.fighter_profile_visibility
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_identity public.fighter_identities%rowtype;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_new_revision bigint;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Display name must be between 2 and 120 characters';
  end if;
  if length(coalesce(p_nickname, '')) > 120 then raise exception 'Nickname is too long'; end if;
  if length(coalesce(p_bio, '')) > 2000 then raise exception 'Bio is too long'; end if;
  if length(coalesce(p_public_region, '')) > 160 then raise exception 'Region is too long'; end if;

  select * into v_identity
  from public.fighter_identities
  where id = p_identity_id
  for update;

  if v_identity.id is null or v_identity.deleted_at is not null or v_identity.merged_into_identity_id is not null then
    raise exception 'Active fighter identity not found';
  end if;

  if not (
    private.user_controls_identity(v_uid, p_identity_id)
    or private.can_admin_identity(v_uid, p_identity_id)
  ) then
    raise exception 'Not authorized to edit this fighter identity';
  end if;

  if v_identity.profile_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Fighter profile changed on another device';
  end if;

  if p_visibility = 'public' and exists (
    select 1
    from public.fighter_identity_private_profiles p
    where p.identity_id = p_identity_id
      and p.birth_date is not null
      and p.birth_date > (current_date - interval '18 years')::date
      and p.guardian_consent_at is null
  ) then
    raise exception 'Youth profiles require verified guardian consent before becoming public';
  end if;

  if private.normalize_identity_name(v_identity.display_name) <> private.normalize_identity_name(v_name) then
    insert into public.fighter_identity_aliases(
      identity_id, alias, normalized_alias, is_public, source, created_by
    )
    values (
      p_identity_id,
      v_identity.display_name,
      private.normalize_identity_name(v_identity.display_name),
      false,
      'previous_display_name',
      v_uid
    )
    on conflict (identity_id, normalized_alias) do nothing;
  end if;

  update public.fighter_identities
  set display_name = v_name,
      nickname = nullif(btrim(coalesce(p_nickname, '')), ''),
      bio = nullif(btrim(coalesce(p_bio, '')), ''),
      public_region = nullif(btrim(coalesce(p_public_region, '')), ''),
      profile_visibility = p_visibility,
      profile_revision = profile_revision + 1,
      last_edited_by = v_uid
  where id = p_identity_id
  returning profile_revision into v_new_revision;

  update public.fighters
  set name = v_name,
      nickname = nullif(btrim(coalesce(p_nickname, '')), ''),
      last_edited_by = v_uid
  where identity_id = p_identity_id
    and deleted_at is null
    and merged_into_fighter_id is null;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identities',
    p_identity_id,
    'update_fighter_public_profile',
    jsonb_build_object(
      'fromRevision', p_expected_revision,
      'toRevision', v_new_revision,
      'visibility', p_visibility
    )
  );

  return v_new_revision;
end;
$$;

create or replace function private.update_fighter_private_profile(
  p_identity_id uuid,
  p_expected_revision bigint,
  p_legal_name text,
  p_birth_date date,
  p_contact_email text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_guardian_consent boolean default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current public.fighter_identity_private_profiles%rowtype;
  v_new_revision bigint;
  v_can_set_consent boolean;
  v_consent_at timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not (
    private.user_controls_identity(v_uid, p_identity_id)
    or private.can_admin_identity(v_uid, p_identity_id)
  ) then
    raise exception 'Not authorized to edit private fighter information';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'Birth date cannot be in the future';
  end if;

  select * into v_current
  from public.fighter_identity_private_profiles
  where identity_id = p_identity_id
  for update;

  v_can_set_consent :=
    private.is_platform_admin(v_uid)
    or exists (
      select 1
      from public.fighter_identity_accounts a
      where a.identity_id = p_identity_id
        and a.user_id = v_uid
        and a.relationship = 'guardian'
        and a.revoked_at is null
    );

  if p_guardian_consent is not null and not v_can_set_consent then
    raise exception 'Only a verified guardian or platform administrator can change guardian consent';
  end if;

  if v_current.identity_id is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception using errcode = '40001', message = 'Private fighter profile changed on another device';
    end if;

    v_consent_at := case when p_guardian_consent = true then timezone('utc', now()) else null end;

    insert into public.fighter_identity_private_profiles(
      identity_id, legal_name, birth_date, contact_email, phone,
      emergency_contact_name, emergency_contact_phone,
      guardian_name, guardian_email, guardian_phone, guardian_consent_at,
      revision, last_edited_by
    )
    values (
      p_identity_id,
      nullif(btrim(coalesce(p_legal_name, '')), ''),
      p_birth_date,
      nullif(btrim(coalesce(p_contact_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_emergency_contact_name, '')), ''),
      nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''),
      nullif(btrim(coalesce(p_guardian_name, '')), ''),
      nullif(btrim(coalesce(p_guardian_email, '')), ''),
      nullif(btrim(coalesce(p_guardian_phone, '')), ''),
      v_consent_at,
      1,
      v_uid
    )
    returning revision into v_new_revision;
  else
    if v_current.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'Private fighter profile changed on another device';
    end if;

    v_consent_at := case
      when p_guardian_consent is null then v_current.guardian_consent_at
      when p_guardian_consent then coalesce(v_current.guardian_consent_at, timezone('utc', now()))
      else null
    end;

    update public.fighter_identity_private_profiles
    set legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
        birth_date = p_birth_date,
        contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
        phone = nullif(btrim(coalesce(p_phone, '')), ''),
        emergency_contact_name = nullif(btrim(coalesce(p_emergency_contact_name, '')), ''),
        emergency_contact_phone = nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''),
        guardian_name = nullif(btrim(coalesce(p_guardian_name, '')), ''),
        guardian_email = nullif(btrim(coalesce(p_guardian_email, '')), ''),
        guardian_phone = nullif(btrim(coalesce(p_guardian_phone, '')), ''),
        guardian_consent_at = v_consent_at,
        revision = revision + 1,
        last_edited_by = v_uid
    where identity_id = p_identity_id
    returning revision into v_new_revision;
  end if;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_private_profiles',
    p_identity_id,
    'update_fighter_private_profile',
    jsonb_build_object(
      'fromRevision', coalesce(p_expected_revision, 0),
      'toRevision', v_new_revision,
      'guardianConsentChanged', p_guardian_consent is not null
    )
  );

  return v_new_revision;
end;
$$;

create or replace function private.submit_fighter_identity_claim(
  p_identity_id uuid,
  p_relationship public.identity_account_role,
  p_claim_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim_id uuid;
  v_status public.identity_claim_status := 'pending';
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1
    from public.fighter_identities i
    where i.id = p_identity_id
      and i.deleted_at is null
      and i.merged_into_identity_id is null
  ) then
    raise exception 'Active fighter identity not found';
  end if;

  if exists (
    select 1
    from public.fighter_identity_accounts a
    where a.identity_id = p_identity_id
      and a.user_id = v_uid
      and a.relationship = p_relationship
      and a.revoked_at is null
  ) then
    raise exception 'This account is already linked to the fighter identity';
  end if;

  if p_relationship = 'self' and exists (
    select 1
    from public.fighter_identity_accounts a
    where a.identity_id = p_identity_id
      and a.relationship = 'self'
      and a.user_id <> v_uid
      and a.revoked_at is null
  ) then
    v_status := 'disputed';
  end if;

  insert into public.fighter_identity_claims(
    identity_id, claimant_user_id, relationship, status, claim_note
  )
  values (
    p_identity_id,
    v_uid,
    p_relationship,
    v_status,
    nullif(btrim(coalesce(p_claim_note, '')), '')
  )
  returning id into v_claim_id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_claims',
    v_claim_id,
    'submit_fighter_identity_claim',
    jsonb_build_object(
      'identityId', p_identity_id,
      'relationship', p_relationship,
      'status', v_status
    )
  );

  return v_claim_id;
end;
$$;

create or replace function private.review_fighter_identity_claim(
  p_claim_id uuid,
  p_decision text,
  p_review_note text,
  p_expected_version bigint
)
returns public.identity_claim_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.fighter_identity_claims%rowtype;
  v_previous_self_user uuid;
  v_new_status public.identity_claim_status;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into v_claim
  from public.fighter_identity_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then raise exception 'Identity claim not found'; end if;
  if v_claim.status not in ('pending', 'disputed') then raise exception 'Identity claim is no longer reviewable'; end if;
  if v_claim.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Identity claim changed on another device';
  end if;
  if v_claim.claimant_user_id = v_uid then raise exception 'Claimants cannot review their own claim'; end if;

  if v_claim.status = 'disputed' then
    if not private.is_platform_admin(v_uid) then
      raise exception 'Platform administrator access is required to resolve disputed claims';
    end if;
  elsif not (
    private.is_platform_admin(v_uid)
    or private.can_admin_identity(v_uid, v_claim.identity_id)
  ) then
    raise exception 'Identity administrator access required';
  end if;

  if p_decision = 'approve' then
    if v_claim.relationship = 'self' then
      select a.user_id into v_previous_self_user
      from public.fighter_identity_accounts a
      where a.identity_id = v_claim.identity_id
        and a.relationship = 'self'
        and a.revoked_at is null
      limit 1
      for update;

      if v_previous_self_user is not null and v_previous_self_user <> v_claim.claimant_user_id then
        if v_claim.status <> 'disputed' or not private.is_platform_admin(v_uid) then
          raise exception 'Identity is already controlled by another account';
        end if;

        update public.fighter_identity_accounts
        set revoked_at = timezone('utc', now())
        where identity_id = v_claim.identity_id
          and relationship = 'self'
          and revoked_at is null;
      end if;
    end if;

    insert into public.fighter_identity_accounts(
      identity_id, user_id, relationship, verified_at, source_claim_id, created_by
    )
    values (
      v_claim.identity_id,
      v_claim.claimant_user_id,
      v_claim.relationship,
      timezone('utc', now()),
      v_claim.id,
      v_uid
    )
    on conflict (identity_id, user_id, relationship)
    do update set
      verified_at = excluded.verified_at,
      revoked_at = null,
      source_claim_id = excluded.source_claim_id;

    if v_claim.relationship = 'self' then
      update public.fighter_identities
      set user_id = v_claim.claimant_user_id,
          verified_at = timezone('utc', now()),
          verified_by = v_uid,
          last_edited_by = v_uid
      where id = v_claim.identity_id;
    end if;

    v_new_status := 'approved';
  else
    v_new_status := 'rejected';
  end if;

  update public.fighter_identity_claims
  set status = v_new_status,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      reviewed_by = v_uid,
      reviewed_at = timezone('utc', now()),
      version = version + 1
  where id = v_claim.id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_claims',
    v_claim.id,
    'review_fighter_identity_claim',
    jsonb_build_object(
      'identityId', v_claim.identity_id,
      'decision', p_decision,
      'relationship', v_claim.relationship,
      'displacedSelfUserId', v_previous_self_user
    )
  );

  return v_new_status;
end;
$$;

create or replace function private.dispute_fighter_identity_claim(
  p_claim_id uuid,
  p_reason text,
  p_expected_version bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.fighter_identity_claims%rowtype;
  v_allowed boolean := false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Dispute reason is required'; end if;

  select * into v_claim
  from public.fighter_identity_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then raise exception 'Identity claim not found'; end if;
  if v_claim.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Identity claim changed on another device';
  end if;

  if v_claim.claimant_user_id = v_uid and v_claim.status = 'rejected' then
    v_allowed := true;
  elsif v_claim.claimant_user_id <> v_uid
    and v_claim.status = 'pending'
    and private.user_controls_identity(v_uid, v_claim.identity_id)
  then
    v_allowed := true;
  end if;

  if not v_allowed then raise exception 'This claim cannot be disputed by this account'; end if;

  update public.fighter_identity_claims
  set status = 'disputed',
      dispute_reason = btrim(p_reason),
      disputed_by = v_uid,
      disputed_at = timezone('utc', now()),
      version = version + 1
  where id = v_claim.id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_claims',
    v_claim.id,
    'dispute_fighter_identity_claim',
    jsonb_build_object('identityId', v_claim.identity_id)
  );
end;
$$;

create or replace function private.cancel_fighter_identity_claim(
  p_claim_id uuid,
  p_expected_version bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.fighter_identity_claims%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_claim
  from public.fighter_identity_claims
  where id = p_claim_id
  for update;

  if v_claim.id is null then raise exception 'Identity claim not found'; end if;
  if v_claim.claimant_user_id <> v_uid then raise exception 'Only the claimant can cancel this claim'; end if;
  if v_claim.status not in ('pending', 'disputed') then raise exception 'This claim cannot be cancelled'; end if;
  if v_claim.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Identity claim changed on another device';
  end if;

  update public.fighter_identity_claims
  set status = 'cancelled',
      version = version + 1
  where id = v_claim.id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_claims',
    v_claim.id,
    'cancel_fighter_identity_claim',
    jsonb_build_object('identityId', v_claim.identity_id)
  );
end;
$$;

create or replace function private.suggest_fighter_identity_duplicates(p_identity_id uuid)
returns table (
  candidate_identity_id uuid,
  candidate_display_name text,
  reason text,
  score integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select
      i.id,
      private.normalize_identity_name(i.display_name) as normalized_name,
      private.normalize_identity_name(i.nickname) as normalized_nickname
    from public.fighter_identities i
    where i.id = p_identity_id
      and i.deleted_at is null
      and i.merged_into_identity_id is null
      and (
        private.user_controls_identity((select auth.uid()), i.id)
        or private.can_admin_identity((select auth.uid()), i.id)
      )
  ),
  source_aliases as (
    select normalized_alias
    from public.fighter_identity_aliases
    where identity_id = p_identity_id
  ),
  candidates as (
    select
      c.id,
      c.display_name,
      case
        when private.normalize_identity_name(c.display_name) = s.normalized_name then 'same normalized display name'
        when exists (
          select 1 from public.fighter_identity_aliases a
          where a.identity_id = c.id and a.normalized_alias = s.normalized_name
        ) then 'display name matches a known alias'
        when exists (
          select 1 from source_aliases sa
          where sa.normalized_alias = private.normalize_identity_name(c.display_name)
        ) then 'known alias matches candidate display name'
        when s.normalized_nickname <> ''
          and s.normalized_nickname = private.normalize_identity_name(c.nickname)
          then 'same normalized nickname'
        else 'matching alias history'
      end as duplicate_reason,
      case
        when private.normalize_identity_name(c.display_name) = s.normalized_name then 100
        when exists (
          select 1 from public.fighter_identity_aliases a
          where a.identity_id = c.id and a.normalized_alias = s.normalized_name
        ) then 95
        when exists (
          select 1 from source_aliases sa
          where sa.normalized_alias = private.normalize_identity_name(c.display_name)
        ) then 90
        when s.normalized_nickname <> ''
          and s.normalized_nickname = private.normalize_identity_name(c.nickname)
          then 75
        else 70
      end as duplicate_score
    from source s
    join public.fighter_identities c on c.id <> s.id
    where c.deleted_at is null
      and c.merged_into_identity_id is null
      and (
        private.normalize_identity_name(c.display_name) = s.normalized_name
        or exists (
          select 1 from public.fighter_identity_aliases a
          where a.identity_id = c.id
            and (
              a.normalized_alias = s.normalized_name
              or a.normalized_alias in (select normalized_alias from source_aliases)
            )
        )
        or exists (
          select 1 from source_aliases sa
          where sa.normalized_alias = private.normalize_identity_name(c.display_name)
        )
        or (
          s.normalized_nickname <> ''
          and s.normalized_nickname = private.normalize_identity_name(c.nickname)
        )
      )
      and (
        c.profile_visibility in ('public', 'members')
        or private.can_admin_identity((select auth.uid()), c.id)
        or exists (
          select 1
          from public.fighters f
          join public.event_roster_entries r on r.fighter_id = f.id
          join public.events e on e.id = r.event_id
          where f.identity_id = c.id
            and e.status in ('published', 'live', 'completed')
        )
      )
  )
  select c.id, c.display_name, c.duplicate_reason, c.duplicate_score
  from candidates c
  order by c.duplicate_score desc, c.display_name
  limit 20;
$$;

create or replace function private.request_fighter_identity_merge(
  p_canonical_identity_id uuid,
  p_duplicate_identity_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_canonical public.fighter_identities%rowtype;
  v_duplicate public.fighter_identities%rowtype;
  v_review_id uuid;
  v_authorized boolean;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_canonical_identity_id = p_duplicate_identity_id then raise exception 'Choose two different identities'; end if;

  select * into v_canonical
  from public.fighter_identities
  where id = p_canonical_identity_id;

  select * into v_duplicate
  from public.fighter_identities
  where id = p_duplicate_identity_id;

  if v_canonical.id is null or v_duplicate.id is null then raise exception 'Fighter identity not found'; end if;
  if v_canonical.deleted_at is not null or v_duplicate.deleted_at is not null
     or v_canonical.merged_into_identity_id is not null or v_duplicate.merged_into_identity_id is not null then
    raise exception 'Archived or merged identities cannot be reviewed for merge';
  end if;

  v_authorized := private.is_platform_admin(v_uid)
    or exists (
      select 1
      from public.fighters c
      join public.fighters d on d.organization_id = c.organization_id
      where c.identity_id = p_canonical_identity_id
        and d.identity_id = p_duplicate_identity_id
        and private.has_org_role(
          v_uid,
          c.organization_id,
          array['organization_admin']::public.organization_role[]
        )
    );

  if not v_authorized then raise exception 'Organization administrator access required for both identities'; end if;

  insert into public.fighter_identity_merge_reviews(
    canonical_identity_id,
    duplicate_identity_id,
    requested_by,
    reason,
    canonical_revision,
    duplicate_revision,
    request_snapshot
  )
  values (
    p_canonical_identity_id,
    p_duplicate_identity_id,
    v_uid,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_canonical.profile_revision,
    v_duplicate.profile_revision,
    jsonb_build_object(
      'canonicalDisplayName', v_canonical.display_name,
      'duplicateDisplayName', v_duplicate.display_name,
      'canonicalVerified', v_canonical.verified_at is not null,
      'duplicateVerified', v_duplicate.verified_at is not null
    )
  )
  returning id into v_review_id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_merge_reviews',
    v_review_id,
    'request_fighter_identity_merge',
    jsonb_build_object(
      'canonicalIdentityId', p_canonical_identity_id,
      'duplicateIdentityId', p_duplicate_identity_id
    )
  );

  return v_review_id;
end;
$$;

create or replace function private.review_fighter_identity_merge(
  p_review_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.identity_merge_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_review public.fighter_identity_merge_reviews%rowtype;
  v_canonical public.fighter_identities%rowtype;
  v_duplicate public.fighter_identities%rowtype;
  v_self_users integer;
  v_fighter public.fighters%rowtype;
  v_target_fighter_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.is_platform_admin(v_uid) then raise exception 'Platform super administrator access required'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into v_review
  from public.fighter_identity_merge_reviews
  where id = p_review_id
  for update;

  if v_review.id is null then raise exception 'Merge review not found'; end if;
  if v_review.status <> 'pending' then raise exception 'Merge review is no longer pending'; end if;
  if v_review.requested_by = v_uid then raise exception 'Merge requests require a different reviewer'; end if;

  if p_decision = 'reject' then
    update public.fighter_identity_merge_reviews
    set status = 'rejected',
        reviewed_by = v_uid,
        review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
        reviewed_at = timezone('utc', now())
    where id = p_review_id;

    insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
    values (
      v_uid,
      'fighter_identity_merge_reviews',
      p_review_id,
      'reject_fighter_identity_merge',
      jsonb_build_object(
        'canonicalIdentityId', v_review.canonical_identity_id,
        'duplicateIdentityId', v_review.duplicate_identity_id
      )
    );

    return 'rejected';
  end if;

  perform 1
  from public.fighter_identities
  where id in (v_review.canonical_identity_id, v_review.duplicate_identity_id)
  order by id
  for update;

  select * into v_canonical
  from public.fighter_identities
  where id = v_review.canonical_identity_id;

  select * into v_duplicate
  from public.fighter_identities
  where id = v_review.duplicate_identity_id;

  if v_canonical.id is null or v_duplicate.id is null then raise exception 'Fighter identity not found'; end if;
  if v_canonical.deleted_at is not null or v_duplicate.deleted_at is not null
     or v_canonical.merged_into_identity_id is not null or v_duplicate.merged_into_identity_id is not null then
    raise exception 'Identity state changed before merge review completed';
  end if;
  if v_canonical.profile_revision <> v_review.canonical_revision
     or v_duplicate.profile_revision <> v_review.duplicate_revision then
    raise exception using errcode = '40001', message = 'Identity profile changed after merge review was requested';
  end if;

  select count(distinct a.user_id)::integer into v_self_users
  from public.fighter_identity_accounts a
  where a.identity_id in (v_canonical.id, v_duplicate.id)
    and a.relationship = 'self'
    and a.revoked_at is null;

  if v_self_users > 1 then
    raise exception using errcode = '40001', message = 'Merge blocked because the identities are controlled by different accounts';
  end if;

  insert into public.fighter_identity_accounts(
    identity_id, user_id, relationship, verified_at, source_claim_id, created_by
  )
  select
    v_canonical.id,
    a.user_id,
    a.relationship,
    a.verified_at,
    a.source_claim_id,
    v_uid
  from public.fighter_identity_accounts a
  where a.identity_id = v_duplicate.id
    and a.revoked_at is null
  on conflict (identity_id, user_id, relationship)
  do update set
    verified_at = greatest(public.fighter_identity_accounts.verified_at, excluded.verified_at),
    revoked_at = null;

  insert into public.fighter_identity_aliases(
    identity_id, alias, normalized_alias, is_public, source, created_by
  )
  values (
    v_canonical.id,
    v_duplicate.display_name,
    private.normalize_identity_name(v_duplicate.display_name),
    false,
    'merged_identity',
    v_uid
  )
  on conflict (identity_id, normalized_alias) do nothing;

  insert into public.fighter_identity_aliases(
    identity_id, alias, normalized_alias, is_public, source, created_by
  )
  select
    v_canonical.id,
    a.alias,
    a.normalized_alias,
    false,
    'merged_identity_alias',
    v_uid
  from public.fighter_identity_aliases a
  where a.identity_id = v_duplicate.id
  on conflict (identity_id, normalized_alias) do nothing;

  if not exists (
    select 1 from public.fighter_identity_private_profiles p
    where p.identity_id = v_canonical.id
  ) then
    insert into public.fighter_identity_private_profiles(
      identity_id, legal_name, birth_date, contact_email, phone,
      emergency_contact_name, emergency_contact_phone,
      guardian_name, guardian_email, guardian_phone, guardian_consent_at,
      revision, last_edited_by
    )
    select
      v_canonical.id,
      p.legal_name,
      p.birth_date,
      p.contact_email,
      p.phone,
      p.emergency_contact_name,
      p.emergency_contact_phone,
      p.guardian_name,
      p.guardian_email,
      p.guardian_phone,
      p.guardian_consent_at,
      1,
      v_uid
    from public.fighter_identity_private_profiles p
    where p.identity_id = v_duplicate.id;
  end if;

  update public.fighter_affiliations duplicate_affiliation
  set is_primary = false,
      last_edited_by = v_uid
  where duplicate_affiliation.identity_id = v_duplicate.id
    and duplicate_affiliation.is_primary
    and duplicate_affiliation.ends_on is null
    and exists (
      select 1
      from public.fighter_affiliations canonical_affiliation
      where canonical_affiliation.identity_id = v_canonical.id
        and canonical_affiliation.organization_id = duplicate_affiliation.organization_id
        and canonical_affiliation.is_primary
        and canonical_affiliation.ends_on is null
    );

  update public.fighter_affiliations
  set identity_id = v_canonical.id,
      last_edited_by = v_uid
  where identity_id = v_duplicate.id;

  for v_fighter in
    select *
    from public.fighters
    where identity_id = v_duplicate.id
      and deleted_at is null
    order by organization_id, created_at, id
    for update
  loop
    select f.id into v_target_fighter_id
    from public.fighters f
    where f.identity_id = v_canonical.id
      and f.organization_id = v_fighter.organization_id
      and f.deleted_at is null
      and f.merged_into_fighter_id is null
    order by f.created_at, f.id
    limit 1;

    if v_target_fighter_id is null then
      update public.fighters
      set identity_id = v_canonical.id,
          user_id = coalesce(v_canonical.user_id, v_duplicate.user_id),
          last_edited_by = v_uid
      where id = v_fighter.id;
    else
      update public.fighters
      set identity_id = v_canonical.id,
          is_active = false,
          merged_into_fighter_id = v_target_fighter_id,
          deleted_at = timezone('utc', now()),
          deleted_by = v_uid,
          last_edited_by = v_uid
      where id = v_fighter.id;
    end if;
  end loop;

  update public.fighters
  set identity_id = v_canonical.id,
      last_edited_by = v_uid
  where identity_id = v_duplicate.id;

  update public.fighter_identities
  set user_id = coalesce(v_canonical.user_id, v_duplicate.user_id),
      verified_at = coalesce(v_canonical.verified_at, v_duplicate.verified_at),
      verified_by = coalesce(v_canonical.verified_by, v_duplicate.verified_by),
      profile_revision = profile_revision + 1,
      last_edited_by = v_uid
  where id = v_canonical.id;

  update public.fighter_identities
  set merged_into_identity_id = v_canonical.id,
      deleted_at = timezone('utc', now()),
      deleted_by = v_uid,
      profile_revision = profile_revision + 1,
      last_edited_by = v_uid
  where id = v_duplicate.id;

  update public.fighter_identity_merge_reviews
  set status = 'completed',
      reviewed_by = v_uid,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      reviewed_at = timezone('utc', now()),
      completed_at = timezone('utc', now())
  where id = p_review_id;

  insert into public.audit_log(actor_user_id, table_name, record_id, action, payload)
  values (
    v_uid,
    'fighter_identity_merge_reviews',
    p_review_id,
    'complete_fighter_identity_merge',
    jsonb_build_object(
      'canonicalIdentityId', v_canonical.id,
      'duplicateIdentityId', v_duplicate.id,
      'historicalFighterReferencesPreserved', true
    )
  );

  return 'completed';
end;
$$;

create or replace function private.create_fighter_affiliation(
  p_identity_id uuid,
  p_organization_id uuid,
  p_club_id uuid,
  p_team_id uuid,
  p_affiliation_type public.affiliation_type,
  p_starts_on date,
  p_ends_on date,
  p_is_primary boolean,
  p_source_event_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.fighter_affiliations%rowtype;
  v_affiliation_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not (
    private.is_platform_admin(v_uid)
    or private.has_org_role(
      v_uid,
      p_organization_id,
      array['organization_admin']::public.organization_role[]
    )
  ) then
    raise exception 'Organization administrator access required';
  end if;
  if p_starts_on is null then raise exception 'Start date is required'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'End date cannot be before start date'; end if;
  if p_club_id is null and p_team_id is null and p_affiliation_type <> 'independent' then
    raise exception 'Choose a club or team, or mark the fighter independent';
  end if;
  if not exists (
    select 1 from public.fighter_identities i
    where i.id = p_identity_id
      and i.deleted_at is null
      and i.merged_into_identity_id is null
  ) then
    raise exception 'Active fighter identity not found';
  end if;
  if p_club_id is not null and not exists (
    select 1 from public.clubs c
    where c.id = p_club_id
      and c.organization_id = p_organization_id
      and c.deleted_at is null
  ) then
    raise exception 'Club does not belong to this organization';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.organization_id = p_organization_id
      and t.deleted_at is null
  ) then
    raise exception 'Team does not belong to this organization';
  end if;

  if p_is_primary and p_ends_on is null then
    select * into v_existing
    from public.fighter_affiliations
    where identity_id = p_identity_id
      and organization_id = p_organization_id
      and is_primary
      and ends_on is null
    for update;

    if v_existing.id is not null then
      if p_starts_on <= v_existing.starts_on then
        raise exception 'New primary affiliation must start after the current primary affiliation';
      end if;

      update public.fighter_affiliations
      set ends_on = p_starts_on - 1,
          is_primary = false,
          last_edited_by = v_uid
      where id = v_existing.id;
    end if;
  end if;

  insert into public.fighter_affiliations(
    identity_id, organization_id, club_id, team_id, affiliation_type,
    starts_on, ends_on, is_primary, source_event_id, notes,
    created_by, last_edited_by
  )
  values (
    p_identity_id, p_organization_id, p_club_id, p_team_id, p_affiliation_type,
    p_starts_on, p_ends_on, p_is_primary, p_source_event_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_uid, v_uid
  )
  returning id into v_affiliation_id;

  if p_is_primary and p_ends_on is null then
    update public.fighters
    set team_id = p_team_id,
        last_edited_by = v_uid
    where identity_id = p_identity_id
      and organization_id = p_organization_id
      and deleted_at is null
      and merged_into_fighter_id is null;
  end if;

  insert into public.audit_log(organization_id, actor_user_id, table_name, record_id, action, payload)
  values (
    p_organization_id,
    v_uid,
    'fighter_affiliations',
    v_affiliation_id,
    'create_fighter_affiliation',
    jsonb_build_object(
      'identityId', p_identity_id,
      'isPrimary', p_is_primary,
      'teamId', p_team_id,
      'clubId', p_club_id
    )
  );

  return v_affiliation_id;
end;
$$;

create or replace function private.end_fighter_affiliation(
  p_affiliation_id uuid,
  p_ends_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_affiliation public.fighter_affiliations%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_affiliation
  from public.fighter_affiliations
  where id = p_affiliation_id
  for update;

  if v_affiliation.id is null then raise exception 'Affiliation not found'; end if;
  if not (
    private.is_platform_admin(v_uid)
    or private.has_org_role(
      v_uid,
      v_affiliation.organization_id,
      array['organization_admin']::public.organization_role[]
    )
  ) then
    raise exception 'Organization administrator access required';
  end if;
  if p_ends_on < v_affiliation.starts_on then raise exception 'End date cannot be before start date'; end if;

  update public.fighter_affiliations
  set ends_on = p_ends_on,
      is_primary = false,
      last_edited_by = v_uid
  where id = p_affiliation_id;

  insert into public.audit_log(organization_id, actor_user_id, table_name, record_id, action, payload)
  values (
    v_affiliation.organization_id,
    v_uid,
    'fighter_affiliations',
    p_affiliation_id,
    'end_fighter_affiliation',
    jsonb_build_object(
      'identityId', v_affiliation.identity_id,
      'endsOn', p_ends_on
    )
  );
end;
$$;

revoke all on function public.merge_fighters(uuid, uuid) from authenticated;

drop policy if exists fighters_org_read on public.fighters;
create policy fighters_org_read
on public.fighters
for select to authenticated
using (
  private.user_controls_identity((select auth.uid()), identity_id)
  or private.is_platform_admin((select auth.uid()))
  or private.has_org_role(
    (select auth.uid()),
    organization_id,
    array['organization_admin', 'organization_staff']::public.organization_role[]
  )
);

create or replace function private.can_view_roster_entry(
  check_user uuid,
  check_event uuid,
  check_team uuid,
  check_fighter uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_platform_admin(check_user)
    or exists (
      select 1
      from public.events e
      where e.id = check_event
        and private.has_org_role(
          check_user,
          e.organization_id,
          array['organization_admin', 'organization_staff']::public.organization_role[]
        )
    )
    or private.has_event_role(
      check_user,
      check_event,
      array['event_organizer', 'field_marshal', 'assistant_marshal']::public.event_role[]
    )
    or (
      check_team is not null
      and private.has_team_event_role(
        check_user,
        check_event,
        check_team,
        array['team_captain']::public.event_role[]
      )
    )
    or (
      check_fighter is not null
      and exists (
        select 1
        from public.fighters f
        where f.id = check_fighter
          and f.deleted_at is null
          and private.user_controls_identity(check_user, f.identity_id)
      )
    );
$$;

drop policy if exists fight_notes_read on public.fight_notes;
drop policy if exists fight_notes_author_write on public.fight_notes;

create policy fight_notes_read
on public.fight_notes
for select to authenticated
using (
  author_user_id = (select auth.uid())
  or (
    visibility = 'marshal_visible'
    and private.has_event_role(
      (select auth.uid()),
      event_id,
      array['event_organizer', 'field_marshal', 'assistant_marshal']::public.event_role[]
    )
  )
  or (
    visibility = 'team_only'
    and team_id is not null
    and exists (
      select 1
      from public.fighters f
      where f.team_id = fight_notes.team_id
        and f.deleted_at is null
        and private.user_controls_identity((select auth.uid()), f.identity_id)
    )
  )
  or (
    visibility = 'team_only'
    and team_id is not null
    and private.has_team_event_role(
      (select auth.uid()),
      event_id,
      team_id,
      array['team_captain']::public.event_role[]
    )
  )
);

create policy fight_notes_author_write
on public.fight_notes
for all to authenticated
using (author_user_id = (select auth.uid()))
with check (
  author_user_id = (select auth.uid())
  and private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer', 'field_marshal', 'assistant_marshal', 'team_captain', 'fighter']::public.event_role[]
  )
  and (
    visibility <> 'team_only'
    or (
      team_id is not null
      and (
        private.has_event_role(
          (select auth.uid()),
          event_id,
          array['event_organizer', 'field_marshal', 'assistant_marshal']::public.event_role[]
        )
        or private.has_team_event_role(
          (select auth.uid()),
          event_id,
          team_id,
          array['team_captain']::public.event_role[]
        )
        or exists (
          select 1
          from public.fighters f
          where f.team_id = fight_notes.team_id
            and f.deleted_at is null
            and private.user_controls_identity((select auth.uid()), f.identity_id)
        )
      )
    )
  )
);

revoke all on function private.create_my_fighter_identity(text) from public, anon, authenticated;
revoke all on function private.search_claimable_fighter_identities(text) from public, anon, authenticated;
revoke all on function private.update_fighter_public_profile(uuid,bigint,text,text,text,text,public.fighter_profile_visibility) from public, anon, authenticated;
revoke all on function private.update_fighter_private_profile(uuid,bigint,text,date,text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function private.submit_fighter_identity_claim(uuid,public.identity_account_role,text) from public, anon, authenticated;
revoke all on function private.review_fighter_identity_claim(uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function private.dispute_fighter_identity_claim(uuid,text,bigint) from public, anon, authenticated;
revoke all on function private.cancel_fighter_identity_claim(uuid,bigint) from public, anon, authenticated;
revoke all on function private.suggest_fighter_identity_duplicates(uuid) from public, anon, authenticated;
revoke all on function private.request_fighter_identity_merge(uuid,uuid,text) from public, anon, authenticated;
revoke all on function private.review_fighter_identity_merge(uuid,text,text) from public, anon, authenticated;
revoke all on function private.create_fighter_affiliation(uuid,uuid,uuid,uuid,public.affiliation_type,date,date,boolean,uuid,text) from public, anon, authenticated;
revoke all on function private.end_fighter_affiliation(uuid,date) from public, anon, authenticated;

grant execute on function private.create_my_fighter_identity(text) to authenticated;
grant execute on function private.search_claimable_fighter_identities(text) to authenticated;
grant execute on function private.update_fighter_public_profile(uuid,bigint,text,text,text,text,public.fighter_profile_visibility) to authenticated;
grant execute on function private.update_fighter_private_profile(uuid,bigint,text,date,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function private.submit_fighter_identity_claim(uuid,public.identity_account_role,text) to authenticated;
grant execute on function private.review_fighter_identity_claim(uuid,text,text,bigint) to authenticated;
grant execute on function private.dispute_fighter_identity_claim(uuid,text,bigint) to authenticated;
grant execute on function private.cancel_fighter_identity_claim(uuid,bigint) to authenticated;
grant execute on function private.suggest_fighter_identity_duplicates(uuid) to authenticated;
grant execute on function private.request_fighter_identity_merge(uuid,uuid,text) to authenticated;
grant execute on function private.review_fighter_identity_merge(uuid,text,text) to authenticated;
grant execute on function private.create_fighter_affiliation(uuid,uuid,uuid,uuid,public.affiliation_type,date,date,boolean,uuid,text) to authenticated;
grant execute on function private.end_fighter_affiliation(uuid,date) to authenticated;

create or replace function public.create_my_fighter_identity(p_display_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_my_fighter_identity(p_display_name); $$;

create or replace function public.search_claimable_fighter_identities(p_query text)
returns table (
  identity_id uuid,
  display_name text,
  nickname text,
  public_region text,
  is_claimed boolean,
  is_verified boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_claimable_fighter_identities(p_query); $$;

create or replace function public.update_fighter_public_profile(
  p_identity_id uuid,
  p_expected_revision bigint,
  p_display_name text,
  p_nickname text,
  p_bio text,
  p_public_region text,
  p_visibility public.fighter_profile_visibility
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.update_fighter_public_profile(
    p_identity_id, p_expected_revision, p_display_name, p_nickname,
    p_bio, p_public_region, p_visibility
  );
$$;

create or replace function public.update_fighter_private_profile(
  p_identity_id uuid,
  p_expected_revision bigint,
  p_legal_name text,
  p_birth_date date,
  p_contact_email text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_guardian_consent boolean default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.update_fighter_private_profile(
    p_identity_id, p_expected_revision, p_legal_name, p_birth_date,
    p_contact_email, p_phone, p_emergency_contact_name, p_emergency_contact_phone,
    p_guardian_name, p_guardian_email, p_guardian_phone, p_guardian_consent
  );
$$;

create or replace function public.submit_fighter_identity_claim(
  p_identity_id uuid,
  p_relationship public.identity_account_role,
  p_claim_note text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.submit_fighter_identity_claim(p_identity_id, p_relationship, p_claim_note); $$;

create or replace function public.review_fighter_identity_claim(
  p_claim_id uuid,
  p_decision text,
  p_review_note text,
  p_expected_version bigint
)
returns public.identity_claim_status
language sql
security invoker
set search_path = ''
as $$ select private.review_fighter_identity_claim(p_claim_id, p_decision, p_review_note, p_expected_version); $$;

create or replace function public.dispute_fighter_identity_claim(
  p_claim_id uuid,
  p_reason text,
  p_expected_version bigint
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.dispute_fighter_identity_claim(p_claim_id, p_reason, p_expected_version); $$;

create or replace function public.cancel_fighter_identity_claim(
  p_claim_id uuid,
  p_expected_version bigint
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.cancel_fighter_identity_claim(p_claim_id, p_expected_version); $$;

create or replace function public.suggest_fighter_identity_duplicates(p_identity_id uuid)
returns table (
  candidate_identity_id uuid,
  candidate_display_name text,
  reason text,
  score integer
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.suggest_fighter_identity_duplicates(p_identity_id); $$;

create or replace function public.request_fighter_identity_merge(
  p_canonical_identity_id uuid,
  p_duplicate_identity_id uuid,
  p_reason text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_fighter_identity_merge(p_canonical_identity_id, p_duplicate_identity_id, p_reason); $$;

create or replace function public.review_fighter_identity_merge(
  p_review_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.identity_merge_status
language sql
security invoker
set search_path = ''
as $$ select private.review_fighter_identity_merge(p_review_id, p_decision, p_review_note); $$;

create or replace function public.create_fighter_affiliation(
  p_identity_id uuid,
  p_organization_id uuid,
  p_club_id uuid,
  p_team_id uuid,
  p_affiliation_type public.affiliation_type,
  p_starts_on date,
  p_ends_on date,
  p_is_primary boolean,
  p_source_event_id uuid,
  p_notes text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_fighter_affiliation(
    p_identity_id, p_organization_id, p_club_id, p_team_id,
    p_affiliation_type, p_starts_on, p_ends_on, p_is_primary,
    p_source_event_id, p_notes
  );
$$;

create or replace function public.end_fighter_affiliation(
  p_affiliation_id uuid,
  p_ends_on date
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.end_fighter_affiliation(p_affiliation_id, p_ends_on); $$;

revoke all on function public.create_my_fighter_identity(text) from public, anon;
revoke all on function public.search_claimable_fighter_identities(text) from public, anon;
revoke all on function public.update_fighter_public_profile(uuid,bigint,text,text,text,text,public.fighter_profile_visibility) from public, anon;
revoke all on function public.update_fighter_private_profile(uuid,bigint,text,date,text,text,text,text,text,text,text,boolean) from public, anon;
revoke all on function public.submit_fighter_identity_claim(uuid,public.identity_account_role,text) from public, anon;
revoke all on function public.review_fighter_identity_claim(uuid,text,text,bigint) from public, anon;
revoke all on function public.dispute_fighter_identity_claim(uuid,text,bigint) from public, anon;
revoke all on function public.cancel_fighter_identity_claim(uuid,bigint) from public, anon;
revoke all on function public.suggest_fighter_identity_duplicates(uuid) from public, anon;
revoke all on function public.request_fighter_identity_merge(uuid,uuid,text) from public, anon;
revoke all on function public.review_fighter_identity_merge(uuid,text,text) from public, anon;
revoke all on function public.create_fighter_affiliation(uuid,uuid,uuid,uuid,public.affiliation_type,date,date,boolean,uuid,text) from public, anon;
revoke all on function public.end_fighter_affiliation(uuid,date) from public, anon;

grant execute on function public.create_my_fighter_identity(text) to authenticated;
grant execute on function public.search_claimable_fighter_identities(text) to authenticated;
grant execute on function public.update_fighter_public_profile(uuid,bigint,text,text,text,text,public.fighter_profile_visibility) to authenticated;
grant execute on function public.update_fighter_private_profile(uuid,bigint,text,date,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.submit_fighter_identity_claim(uuid,public.identity_account_role,text) to authenticated;
grant execute on function public.review_fighter_identity_claim(uuid,text,text,bigint) to authenticated;
grant execute on function public.dispute_fighter_identity_claim(uuid,text,bigint) to authenticated;
grant execute on function public.cancel_fighter_identity_claim(uuid,bigint) to authenticated;
grant execute on function public.suggest_fighter_identity_duplicates(uuid) to authenticated;
grant execute on function public.request_fighter_identity_merge(uuid,uuid,text) to authenticated;
grant execute on function public.review_fighter_identity_merge(uuid,text,text) to authenticated;
grant execute on function public.create_fighter_affiliation(uuid,uuid,uuid,uuid,public.affiliation_type,date,date,boolean,uuid,text) to authenticated;
grant execute on function public.end_fighter_affiliation(uuid,date) to authenticated;
