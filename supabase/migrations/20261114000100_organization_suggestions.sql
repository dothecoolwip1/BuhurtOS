-- Suggest a new organization (2026-10-31). Additive.
--   * Anyone signed in can suggest a club, league or federation that is not listed yet, through suggest_organization().
--     At most 5 a day per person; a name that is already listed, or already waiting for review, is refused with a plain message.
--   * The platform owner is notified, reviews them (admin_organization_suggestions) and approves or declines
--     (decide_organization_suggestion). Approving creates the organization, switched on, from the fields the owner checked,
--     and can make the person who suggested it an admin of it. The suggestion row is kept either way; nothing is deleted.
--   * The person who suggested it is notified of the decision and can see their own suggestions (my_organization_suggestions).
--   * The table is not readable or writable through the API at all: only these functions touch it. It holds account ids and
--     the suggester's free-text note, so nothing here is public.
-- No in-flight state to backfill: this is a new table with no existing rows.

create table if not exists public.organization_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  short_name text check (short_name is null or char_length(short_name) between 2 and 20),
  kind text not null check (kind in ('federation', 'national', 'regional', 'club', 'other')),
  country text check (country is null or char_length(country) <= 80),
  region text check (region is null or char_length(region) <= 80),
  website text check (website is null or char_length(website) <= 300),
  description text check (description is null or char_length(description) <= 1000),
  involvement text not null default 'none' check (involvement in ('admin', 'member', 'none')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  organization_id uuid references public.organizations (id) on delete set null,
  constraint organization_suggestions_decided_consistent check ((status = 'pending') = (decided_at is null))
);
create index if not exists organization_suggestions_status_idx on public.organization_suggestions (status, created_at desc);
create index if not exists organization_suggestions_user_idx on public.organization_suggestions (user_id, created_at desc);
alter table public.organization_suggestions enable row level security;
revoke all on public.organization_suggestions from anon, authenticated;

-- ---------------------------------------------------------------- notification kinds (system category: the default in notification_category)
do $do$
declare v_def text; v_new text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'notifications_kind_check' and conrelid = 'public.notifications'::regclass;
  if position('organization_suggested' in v_def) = 0 then
    v_new := replace(v_def, $a$'bug_reported'::text$a$, $a$'bug_reported'::text, 'organization_suggested'::text, 'organization_suggestion_decided'::text$a$);
    if v_new = v_def then raise exception 'organization suggestions: notifications kind anchor not found'; end if;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check ' || v_new;
  end if;
end $do$;

-- ---------------------------------------------------------------- helpers
-- Trimmed text, empty becomes null.
create or replace function private.org_sugg_text(p jsonb, p_key text) returns text
language sql immutable set search_path = '' as $$ select nullif(btrim(coalesce(p ->> p_key, '')), '') $$;
revoke execute on function private.org_sugg_text(jsonb, text) from public, anon, authenticated;

-- A website as typed: "example.org" becomes "https://example.org"; anything that is not http(s) is refused.
create or replace function private.org_sugg_website(p_raw text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_raw, '')), '');
begin
  if v is null then return null; end if;
  if v !~* '^https?://' then v := 'https://' || v; end if;
  if v !~* '^https?://[^\s/]+\.[^\s]+$' then raise exception 'that website does not look like a web address' using errcode = '22023'; end if;
  if char_length(v) > 300 then raise exception 'keep the website under 300 characters' using errcode = '22023'; end if;
  return v;
end $$;
revoke execute on function private.org_sugg_website(text) from public, anon, authenticated;

-- Folded name for duplicate checks: lower case, single spaces.
create or replace function private.org_sugg_fold(p text) returns text
language sql immutable set search_path = '' as $$ select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) $$;
revoke execute on function private.org_sugg_fold(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- suggest (anyone signed in)
create or replace function public.suggest_organization(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_name text; v_short text; v_kind text; v_country text; v_region text; v_web text; v_desc text; v_inv text; v_note text;
begin
  if v_uid is null then raise exception 'sign in to suggest an organization' using errcode = '28000'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the suggestion as an object' using errcode = '22023'; end if;
  v_name := regexp_replace(coalesce(private.org_sugg_text(p, 'name'), ''), '\s+', ' ', 'g');
  if char_length(v_name) < 2 then raise exception 'give the organization''s name' using errcode = '22023'; end if;
  if char_length(v_name) > 120 then raise exception 'keep the name under 120 characters' using errcode = '22023'; end if;
  v_short := private.org_sugg_text(p, 'short_name');
  if v_short is not null and char_length(v_short) not between 2 and 20 then raise exception 'a short name is 2 to 20 characters' using errcode = '22023'; end if;
  v_kind := coalesce(private.org_sugg_text(p, 'kind'), 'club');
  if v_kind not in ('federation', 'national', 'regional', 'club', 'other') then raise exception 'unknown kind of organization' using errcode = '22023'; end if;
  v_country := private.org_sugg_text(p, 'country');
  if v_country is not null and char_length(v_country) > 80 then raise exception 'keep the country under 80 characters' using errcode = '22023'; end if;
  v_region := private.org_sugg_text(p, 'region');
  if v_region is not null and char_length(v_region) > 80 then raise exception 'keep the province or state under 80 characters' using errcode = '22023'; end if;
  v_web := private.org_sugg_website(p ->> 'website');
  v_desc := private.org_sugg_text(p, 'description');
  if v_desc is not null and char_length(v_desc) > 1000 then raise exception 'keep the description under 1000 characters' using errcode = '22023'; end if;
  v_inv := coalesce(private.org_sugg_text(p, 'involvement'), 'none');
  if v_inv not in ('admin', 'member', 'none') then raise exception 'unknown answer for how you are involved' using errcode = '22023'; end if;
  v_note := private.org_sugg_text(p, 'note');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'keep the note under 1000 characters' using errcode = '22023'; end if;

  if (select count(*) from public.organization_suggestions s where s.user_id = v_uid and s.created_at > now() - interval '1 day') >= 5 then
    raise exception 'that is five suggestions today, thank you! Try again tomorrow' using errcode = 'P0001'; end if;
  if exists (select 1 from public.organizations o where private.org_sugg_fold(o.name) = private.org_sugg_fold(v_name)
               or (o.short_name is not null and private.org_sugg_fold(o.short_name) = private.org_sugg_fold(v_name))) then
    raise exception '% is already listed on BuhurtOS', v_name using errcode = '23505'; end if;
  if exists (select 1 from public.organization_suggestions s where s.status = 'pending' and private.org_sugg_fold(s.name) = private.org_sugg_fold(v_name)) then
    raise exception '% was already suggested and is waiting for review', v_name using errcode = '23505'; end if;

  insert into public.organization_suggestions (user_id, name, short_name, kind, country, region, website, description, involvement, note)
  values (v_uid, v_name, v_short, v_kind, v_country, v_region, v_web, v_desc, v_inv, v_note)
  returning id into v_id;
  insert into public.notifications (user_id, kind, payload)
  select pr.user_id, 'organization_suggested', jsonb_build_object('suggestion_id', v_id, 'organization_name', left(v_name, 120))
  from public.platform_roles pr where pr.role = 'owner';
  perform private.audit(null, 'organization.suggested', v_id::text, jsonb_build_object('name', v_name));
  return v_id;
end $$;

-- ---------------------------------------------------------------- the suggester's own list
create or replace function public.my_organization_suggestions()
returns table (id uuid, created_at timestamptz, name text, kind text, country text, status text, decided_at timestamptz, decision_note text, organization_slug text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  return query select s.id, s.created_at, s.name, s.kind, s.country, s.status, s.decided_at, s.decision_note, o.slug
    from public.organization_suggestions s left join public.organizations o on o.id = s.organization_id
    where s.user_id = auth.uid() order by s.created_at desc limit 50;
end $$;

-- ---------------------------------------------------------------- owner review
create or replace function public.admin_organization_suggestions(p_status text default 'pending')
returns table (id uuid, created_at timestamptz, person_name text, email text, name text, short_name text, kind text, country text, region text, website text,
               description text, involvement text, note text, status text, decided_at timestamptz, decision_note text, organization_slug text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only the platform owner can review organization suggestions' using errcode = '42501'; end if;
  return query select s.id, s.created_at, private.person_name(s.user_id), u.email::text, s.name, s.short_name, s.kind, s.country, s.region, s.website,
      s.description, s.involvement, s.note, s.status, s.decided_at, s.decision_note, o.slug
    from public.organization_suggestions s left join auth.users u on u.id = s.user_id left join public.organizations o on o.id = s.organization_id
    where p_status is null or s.status = p_status order by s.created_at desc limit 300;
end $$;

-- p_decision 'approved' creates the organization from p_org (the owner's checked fields: slug, name, short_name, kind, country, region, website,
-- description; anything missing comes from the suggestion). p_make_admin also makes the person who suggested it an admin of the new organization.
-- 'declined' only records the decision and the optional note, which the person sees.
create or replace function public.decide_organization_suggestion(p_suggestion uuid, p_decision text, p_note text default null, p_org jsonb default '{}'::jsonb,
                                                                 p_make_admin boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.organization_suggestions%rowtype; v_org uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text; v_short text; v_kind text; v_slug text; v_country text; v_region text; v_web text; v_desc text; o jsonb := coalesce(p_org, '{}'::jsonb);
begin
  if not private.is_owner() then raise exception 'only the platform owner can decide organization suggestions' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'declined') then raise exception 'decide approved or declined' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'keep the note under 500 characters' using errcode = '22023'; end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'send the organization as an object' using errcode = '22023'; end if;
  select * into s from public.organization_suggestions where id = p_suggestion for update;
  if not found then raise exception 'suggestion not found' using errcode = 'P0002'; end if;
  if s.status <> 'pending' then raise exception 'this suggestion was already %', s.status using errcode = 'P0001'; end if;

  if p_decision = 'approved' then
    v_name := regexp_replace(coalesce(private.org_sugg_text(o, 'name'), s.name), '\s+', ' ', 'g');
    if char_length(v_name) not between 2 and 120 then raise exception 'the name is 2 to 120 characters' using errcode = '22023'; end if;
    v_short := case when o ? 'short_name' then private.org_sugg_text(o, 'short_name') else s.short_name end;
    if v_short is not null and char_length(v_short) not between 2 and 20 then raise exception 'a short name is 2 to 20 characters' using errcode = '22023'; end if;
    v_kind := coalesce(private.org_sugg_text(o, 'kind'), s.kind);
    if v_kind not in ('federation', 'national', 'regional', 'club', 'other') then raise exception 'unknown kind of organization' using errcode = '22023'; end if;
    v_country := case when o ? 'country' then private.org_sugg_text(o, 'country') else s.country end;
    v_region := case when o ? 'region' then private.org_sugg_text(o, 'region') else s.region end;
    if char_length(coalesce(v_country, '')) > 80 or char_length(coalesce(v_region, '')) > 80 then raise exception 'keep country and province or state under 80 characters' using errcode = '22023'; end if;
    v_web := case when o ? 'website' then private.org_sugg_website(o ->> 'website') else s.website end;
    v_desc := case when o ? 'description' then private.org_sugg_text(o, 'description') else s.description end;
    if char_length(coalesce(v_desc, '')) > 1000 then raise exception 'keep the description under 1000 characters' using errcode = '22023'; end if;
    v_slug := coalesce(private.org_sugg_text(o, 'slug'),
                       nullif(btrim(regexp_replace(lower(coalesce(v_short, v_name)), '[^a-z0-9]+', '-', 'g'), '-'), ''));
    if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 60 then
      raise exception 'the web address name uses lower-case letters, numbers and single dashes' using errcode = '22023'; end if;
    if exists (select 1 from public.organizations where slug = v_slug) then
      raise exception 'the web address /organizations/% is taken; choose another', v_slug using errcode = '23505'; end if;
    if exists (select 1 from public.organizations where private.org_sugg_fold(name) = private.org_sugg_fold(v_name)) then
      raise exception '% is already listed', v_name using errcode = '23505'; end if;

    insert into public.organizations (slug, name, short_name, kind, country, region, website, description)
    values (v_slug, v_name, v_short, v_kind, v_country, v_region, v_web, v_desc) returning id into v_org;
    perform private.audit(null, 'organization.created', v_org::text, jsonb_build_object('from_suggestion', s.id, 'slug', v_slug));
    if p_make_admin and s.user_id is not null then
      insert into public.organization_staff (organization_id, user_id, role) values (v_org, s.user_id, 'admin') on conflict do nothing;
      perform private.audit(null, 'organization.admin_granted', v_org::text, jsonb_build_object('user', s.user_id, 'from_suggestion', s.id));
    end if;
  end if;

  update public.organization_suggestions
     set status = p_decision, decided_at = now(), decided_by = auth.uid(), decision_note = v_note, organization_id = v_org
   where id = s.id;
  perform private.audit(null, 'organization.suggestion_decided', s.id::text, jsonb_build_object('decision', p_decision, 'organization', v_org));
  if s.user_id is not null then
    insert into public.notifications (user_id, kind, payload)
    values (s.user_id, 'organization_suggestion_decided', jsonb_build_object('suggestion_id', s.id, 'decision', p_decision,
      'organization_name', left(coalesce(v_name, s.name), 120), 'organization_slug', v_slug, 'admin', coalesce(p_make_admin and v_org is not null, false)));
  end if;
  return v_org;
end $$;

revoke execute on function public.suggest_organization(jsonb), public.my_organization_suggestions(), public.admin_organization_suggestions(text),
  public.decide_organization_suggestion(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.suggest_organization(jsonb), public.my_organization_suggestions(), public.admin_organization_suggestions(text),
  public.decide_organization_suggestion(uuid, text, text, jsonb, boolean) to authenticated;
