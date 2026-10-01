-- Sports profile ("hockey card") fields for fighters, with explicit public/private switches.
--
-- PRIVACY DECISIONS
--   * fighters has table-level SELECT for anon, so EVERY new column would be public. Instead this migration moves fighters to COLUMN-LEVEL
--     grants. Directly readable (as before, so existing pages keep working): id, display_name, team_id, created_at, gender, city, region,
--     country, disciplines, joined_year, show_age, show_physical, profile_public.
--     NOT directly readable any more (reachable only through fighter_profile / fighter_profile_v2, which apply the switches below):
--     birth_year, fighting_style, bio, highlights, nickname, pronouns, handedness, jersey_number, height_cm, weight_kg, social_links, photo_path.
--     (photo_path is exposed to lists through the fighter_directory view, which honours profile_public.)
--   * show_age (default false): fighter_profile computes age ONLY when true, and returns birth_year only to the person themselves / the platform
--     owner. Fictional '%-test' fighters get show_age = true (migration + insert trigger) so the NACL-test pages keep showing ages.
--   * show_physical (default false): height_cm / weight_kg are returned to others only when true.
--   * profile_public (default true): when false, fighter_profile / fighter_profile_v2 return ONLY the name and the team to everyone except
--     the person themselves and the platform owner. KNOWN LIMIT: gender, city, region, country, disciplines and joined_year stay readable directly
--     from the fighters table (existing directory pages select them). Fighter_directory hides photo / nickname / number for such profiles.
--   * Nothing here is an account id. Seeds and loaders (postgres / service role) are unaffected by the column grants.

alter table public.fighters
  add column nickname text check (nickname is null or char_length(nickname) between 1 and 40),
  add column pronouns text check (pronouns is null or char_length(pronouns) between 1 and 30),
  add column handedness text check (handedness is null or handedness in ('left', 'right', 'ambi')),
  add column jersey_number smallint check (jersey_number is null or jersey_number between 0 and 999),
  add column height_cm smallint check (height_cm is null or height_cm between 100 and 250),
  add column weight_kg numeric(5, 1) check (weight_kg is null or weight_kg between 30 and 250),
  add column social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  add column show_age boolean not null default false,
  add column show_physical boolean not null default false,
  add column profile_public boolean not null default true,
  add column photo_path text check (photo_path is null or char_length(photo_path) <= 200);

-- Fictional NACL-test fighters keep showing an age. Idempotent; also applied to rows inserted later (seeds run after migrations).
update public.fighters set show_age = true where display_name like '%-test' and not show_age;
create or replace function private.fighter_test_show_age() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.display_name like '%-test' then new.show_age := true; end if;
  return new;
end $$;
revoke execute on function private.fighter_test_show_age() from public, anon, authenticated;
create trigger fighters_test_show_age before insert on public.fighters for each row execute function private.fighter_test_show_age();

-- ---------------------------------------------------------------- column level grants
revoke select on public.fighters from anon, authenticated;
grant select (id, display_name, team_id, created_at, gender, city, region, country, disciplines, joined_year, show_age, show_physical, profile_public)
  on public.fighters to anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- Social links, same shape as teams.social_links: {facebook, instagram, youtube, tiktok, x, discord, twitch, other: https url}, at most 8.
create or replace function private.clean_social_links(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '{}'::jsonb; v_k text; v_v jsonb;
  c_url constant text := '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$';
begin
  if p is null or p = 'null'::jsonb then return v_out; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'social links must be a list of name and address' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(p)) > 8 then raise exception 'at most 8 social links' using errcode = '22023'; end if;
  for v_k, v_v in select key, value from jsonb_each(p) loop
    if v_k <> all (array['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'discord', 'twitch', 'other']) then raise exception 'unknown social link: %', left(v_k, 40) using errcode = '22023'; end if;
    if jsonb_typeof(v_v) <> 'string' or char_length(v_v #>> '{}') > 300 or (v_v #>> '{}') !~ c_url then raise exception 'the % link must be a full https:// address', v_k using errcode = '22023'; end if;
    v_out := v_out || jsonb_build_object(v_k, btrim(v_v #>> '{}'));
  end loop;
  return v_out;
end $$;
revoke execute on function private.clean_social_links(jsonb) from public, anon, authenticated;

-- The fighter record the caller controls (null when none).
create or replace function private.my_fighter_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select fighter_id from public.fighter_accounts where user_id = auth.uid()
$$;
revoke execute on function private.my_fighter_id() from public;
grant execute on function private.my_fighter_id() to anon, authenticated;   -- anon: RLS policies call it; it returns null for them

-- ---------------------------------------------------------------- profile read (v2 = everything; the old function is rewritten on top of it)
-- is_self: the caller controls this fighter record. can_edit: is_self or the platform owner.
-- Masking rules are in the header of this file. For a hidden profile only fighter_id, display_name, team_* and the two flags are filled.
create or replace function public.fighter_profile_v2(p_fighter uuid)
returns table (fighter_id uuid, display_name text, gender text, birth_year int, age int, city text, region text, country text, joined_year int,
  disciplines text[], fighting_style text, bio text, highlights text[],
  team_id uuid, team_name text, team_slug text,
  team_organization_id uuid, team_organization_slug text, team_organization_name text, team_organization_enabled boolean,
  nickname text, pronouns text, handedness text, jersey_number int, height_cm int, weight_kg numeric, social_links jsonb,
  show_age boolean, show_physical boolean, profile_public boolean, photo_path text, is_self boolean, can_edit boolean)
language sql stable security definer set search_path = '' as $$
  with me as (
    select f.id as fid,
      (auth.uid() is not null and exists (select 1 from public.fighter_accounts fa where fa.fighter_id = f.id and fa.user_id = auth.uid())) as is_self,
      private.is_owner() as is_owner
    from public.fighters f where f.id = p_fighter
  ), v as (
    select f.*, me.is_self, (me.is_self or me.is_owner) as can_edit, (f.profile_public or me.is_self or me.is_owner) as show
    from public.fighters f join me on me.fid = f.id
  )
  select v.id, v.display_name,
    case when v.show then v.gender end,
    case when v.show and (v.show_age or v.can_edit) then v.birth_year end,
    case when v.show and v.show_age and v.birth_year is not null then extract(year from current_date)::int - v.birth_year end,
    case when v.show then v.city end, case when v.show then v.region end, case when v.show then v.country end, case when v.show then v.joined_year end,
    case when v.show then v.disciplines else '{}'::text[] end, case when v.show then v.fighting_style end, case when v.show then v.bio end,
    case when v.show then v.highlights else '{}'::text[] end,
    t.id, t.name, t.slug, o.id, o.slug, o.name, o.enabled,
    case when v.show then v.nickname end, case when v.show then v.pronouns end, case when v.show then v.handedness end, case when v.show then v.jersey_number::int end,
    case when v.show and (v.show_physical or v.can_edit) then v.height_cm::int end, case when v.show and (v.show_physical or v.can_edit) then v.weight_kg end,
    case when v.show then v.social_links else '{}'::jsonb end,
    v.show_age, v.show_physical, v.profile_public, case when v.show then v.photo_path end, v.is_self, v.can_edit
  from v
  left join public.teams t on t.status = 'approved' and t.id = coalesce(v.team_id, (
    select m.team_id from public.team_memberships m where m.fighter_id = v.id and not m.mercenary and (m.to_date is null or m.to_date >= current_date)
    order by m.from_date desc nulls last, m.id limit 1))
  left join lateral (
    select og.* from public.team_affiliations a join public.organizations og on og.id = a.organization_id
    where a.team_id = t.id and a.relation = 'member' and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)
    order by og.enabled desc, a.from_date nulls last, og.id limit 1) o on true
$$;

-- Same signature and columns as before (20261001002000): existing callers keep working, but the privacy switches now apply.
create or replace function public.fighter_profile(p_fighter uuid)
returns table (fighter_id uuid, display_name text, gender text, birth_year int, age int, city text, region text, country text, joined_year int,
  disciplines text[], fighting_style text, bio text, highlights text[],
  team_id uuid, team_name text, team_slug text,
  team_organization_id uuid, team_organization_slug text, team_organization_name text, team_organization_enabled boolean)
language sql stable security definer set search_path = '' as $$
  select v.fighter_id, v.display_name, v.gender, v.birth_year, v.age, v.city, v.region, v.country, v.joined_year, v.disciplines, v.fighting_style, v.bio, v.highlights,
    v.team_id, v.team_name, v.team_slug, v.team_organization_id, v.team_organization_slug, v.team_organization_name, v.team_organization_enabled
  from public.fighter_profile_v2(p_fighter) v
$$;

-- Directory columns for lists and cards: photo, nickname and number are blanked for profiles that are not public.
create view public.fighter_directory as
  select f.id as fighter_id, f.display_name, f.team_id, f.gender, f.city, f.region, f.country, f.disciplines, f.joined_year,
    case when f.profile_public then f.nickname end as nickname, case when f.profile_public then f.jersey_number end as jersey_number,
    case when f.profile_public then f.photo_path end as photo_path
  from public.fighters f;
grant select on public.fighter_directory to anon, authenticated;

-- ---------------------------------------------------------------- one writer for every profile field (self-service and platform owner)
-- Keys (null clears): gender, birth_year, city, region, country, joined_year, disciplines, fighting_style, bio, highlights,
-- nickname (<=40), pronouns (<=30), handedness (left|right|ambi), jersey_number (0..999), height_cm (100..250), weight_kg (30..250),
-- social_links ({facebook,instagram,youtube,tiktok,x,discord,twitch,other: https url}), show_age, show_physical, profile_public (booleans, not clearable).
create or replace function private.apply_fighter_profile(p_fighter uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text; v jsonb; v_txt text; v_year int; v_arr text[]; v_max int; v_num numeric;
  t_text constant text[] := array['gender', 'city', 'region', 'country', 'fighting_style', 'bio', 'nickname', 'pronouns', 'handedness'];
  t_int constant text[] := array['birth_year', 'joined_year'];
  t_arr constant text[] := array['disciplines', 'highlights'];
  t_bool constant text[] := array['show_age', 'show_physical', 'profile_public'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the profile as an object' using errcode = '22023'; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k = any (t_text) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      v_max := case k when 'bio' then 1500 when 'fighting_style' then 120 when 'nickname' then 40 when 'pronouns' then 30 when 'handedness' then 5 else 80 end;
      if char_length(coalesce(v_txt, '')) > v_max then raise exception '% is too long', k using errcode = '22023'; end if;
      if k = 'gender' and v_txt is not null and v_txt not in ('male', 'female', 'other') then raise exception 'gender must be male, female or other' using errcode = '22023'; end if;
      if k = 'handedness' and v_txt is not null and v_txt not in ('left', 'right', 'ambi') then raise exception 'handedness must be left, right or ambi' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_txt, p_fighter;
    elsif k = any (t_int) then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{4}$' then raise exception '% must be a four digit year', k using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      if v_year is not null and k = 'birth_year' and v_year not between 1900 and extract(year from current_date)::int then raise exception 'birth year is out of range' using errcode = '22023'; end if;
      if v_year is not null and k = 'joined_year' and v_year not between 1990 and extract(year from current_date)::int then raise exception 'joined year is out of range' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_year, p_fighter;
    elsif k = any (t_arr) then
      if jsonb_typeof(v) = 'null' then v_arr := '{}';
      elsif jsonb_typeof(v) <> 'array' then raise exception '% must be a list', k using errcode = '22023';
      else
        if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then raise exception 'every item in % must be text', k using errcode = '22023'; end if;
        select coalesce(array_agg(btrim(e #>> '{}') order by o), '{}') into v_arr from jsonb_array_elements(v) with ordinality x(e, o);
      end if;
      v_max := case k when 'disciplines' then 12 else 10 end;
      if cardinality(v_arr) > v_max then raise exception 'too many items in %', k using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_arr, p_fighter;
    elsif k = 'jersey_number' then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,3}$' then raise exception 'jersey_number must be a whole number from 0 to 999' using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      update public.fighters set jersey_number = v_year where id = p_fighter;
    elsif k in ('height_cm', 'weight_kg') then
      if jsonb_typeof(v) = 'null' then v_num := null;
      elsif jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k using errcode = '22023';
      else v_num := (v #>> '{}')::numeric; end if;
      if v_num is not null and k = 'height_cm' and (v_num <> trunc(v_num) or v_num not between 100 and 250) then raise exception 'height_cm must be a whole number from 100 to 250' using errcode = '22023'; end if;
      if v_num is not null and k = 'weight_kg' and v_num not between 30 and 250 then raise exception 'weight_kg must be between 30 and 250' using errcode = '22023'; end if;
      if k = 'height_cm' then update public.fighters set height_cm = v_num::smallint where id = p_fighter;
      else update public.fighters set weight_kg = round(v_num, 1) where id = p_fighter; end if;
    elsif k = 'social_links' then
      update public.fighters set social_links = private.clean_social_links(v) where id = p_fighter;
    elsif k = any (t_bool) then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% must be true or false', k using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using (v #>> '{}')::boolean, p_fighter;
    else
      raise exception 'the profile has a field this version does not know: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
end $$;
revoke execute on function private.apply_fighter_profile(uuid, jsonb) from public, anon, authenticated;

create or replace function public.update_my_fighter_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  perform private.apply_fighter_profile(v_f, p);
  perform private.audit(null, 'fighter.profile_updated', v_f::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
end $$;

revoke execute on function public.fighter_profile_v2(uuid) from public, anon;
grant execute on function public.fighter_profile_v2(uuid) to anon, authenticated;
