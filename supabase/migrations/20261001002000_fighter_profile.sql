-- Public fighter profile (additive). fighters is publicly readable, so every column added here is PUBLIC. Nothing here is an account id.
--   * birth_year is optional. REAL fighters should leave it null: it is a public column, and the UI only shows an age when it is set.
--     Fictional or consenting profiles may fill it. age is computed (current year - birth_year), never stored.
--   * disciplines holds ref_categories codes ('longsword', '5v5', ...). Checked by a trigger because a CHECK cannot read another table.
--   * Fighters change their own profile only through update_my_fighter_profile(). There is no table grant for writing fighters.
--     Seeds and loaders (service role / postgres) may insert directly.

alter table public.fighters
  add column gender text check (gender is null or gender in ('male', 'female', 'other')),
  add column birth_year int check (birth_year is null or birth_year between 1900 and 2100),
  add column city text check (city is null or char_length(city) <= 80),
  add column region text check (region is null or char_length(region) <= 80),
  add column country text check (country is null or char_length(country) <= 80),
  add column joined_year int check (joined_year is null or joined_year between 1990 and 2100),
  add column disciplines text[] not null default '{}' check (cardinality(disciplines) <= 12),
  add column fighting_style text check (fighting_style is null or char_length(fighting_style) <= 120),
  add column bio text check (bio is null or char_length(bio) <= 1500),
  add column highlights text[] not null default '{}' check (cardinality(highlights) <= 10);

create or replace function private.check_fighter_profile() returns trigger
language plpgsql set search_path = '' as $$
declare d text; h text;
begin
  foreach d in array new.disciplines loop
    if d is null or not exists (select 1 from public.ref_categories c where c.code = d) then raise exception 'unknown discipline: %', coalesce(left(d, 40), 'null') using errcode = '22023'; end if;
  end loop;
  if (select count(distinct x) from unnest(new.disciplines) x) <> cardinality(new.disciplines) then raise exception 'a discipline is listed twice' using errcode = '22023'; end if;
  foreach h in array new.highlights loop
    if h is null or char_length(btrim(h)) not between 1 and 200 then raise exception 'each highlight must be 1 to 200 characters' using errcode = '22023'; end if;
  end loop;
  return new;
end $$;
revoke execute on function private.check_fighter_profile() from public, anon, authenticated;
create trigger fighters_profile_check before insert or update on public.fighters for each row execute function private.check_fighter_profile();

-- The public profile with the current team and its organization. No account ids. Approved teams only.
-- current team = fighters.team_id, else the newest current non-mercenary membership. team_organization = the team's member affiliation
-- (an enabled one preferred). team_organization_enabled lets a page show "Inactive".
create or replace function public.fighter_profile(p_fighter uuid)
returns table (fighter_id uuid, display_name text, gender text, birth_year int, age int, city text, region text, country text, joined_year int,
  disciplines text[], fighting_style text, bio text, highlights text[],
  team_id uuid, team_name text, team_slug text,
  team_organization_id uuid, team_organization_slug text, team_organization_name text, team_organization_enabled boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.display_name, f.gender, f.birth_year,
    case when f.birth_year is null then null else extract(year from current_date)::int - f.birth_year end,
    f.city, f.region, f.country, f.joined_year, f.disciplines, f.fighting_style, f.bio, f.highlights,
    t.id, t.name, t.slug, o.id, o.slug, o.name, o.enabled
  from public.fighters f
  left join public.teams t on t.status = 'approved' and t.id = coalesce(f.team_id, (
    select m.team_id from public.team_memberships m where m.fighter_id = f.id and not m.mercenary and (m.to_date is null or m.to_date >= current_date)
    order by m.from_date desc nulls last, m.id limit 1))
  left join lateral (
    select og.* from public.team_affiliations a join public.organizations og on og.id = a.organization_id
    where a.team_id = t.id and a.relation = 'member' and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)
    order by og.enabled desc, a.from_date nulls last, og.id limit 1) o on true
  where f.id = p_fighter
$$;

-- Keys (all optional, null clears): gender, birth_year, city, region, country, joined_year, disciplines (array of category codes),
-- fighting_style, bio, highlights (array of strings). Unknown keys are refused. The caller must own a fighter record (fighter_accounts).
create or replace function public.update_my_fighter_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f uuid; k text; v jsonb; v_txt text; v_year int; v_arr text[]; v_max int;
  t_text constant text[] := array['gender','city','region','country','fighting_style','bio'];
  t_int constant text[] := array['birth_year','joined_year'];
  t_arr constant text[] := array['disciplines','highlights'];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the profile as an object' using errcode = '22023'; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k = any (t_text) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      v_max := case k when 'bio' then 1500 when 'fighting_style' then 120 else 80 end;
      if char_length(coalesce(v_txt, '')) > v_max then raise exception '% is too long', k using errcode = '22023'; end if;
      if k = 'gender' and v_txt is not null and v_txt not in ('male', 'female', 'other') then raise exception 'gender must be male, female or other' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_txt, v_f;
    elsif k = any (t_int) then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{4}$' then raise exception '% must be a four digit year', k using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      if v_year is not null and k = 'birth_year' and v_year not between 1900 and extract(year from current_date)::int then raise exception 'birth year is out of range' using errcode = '22023'; end if;
      if v_year is not null and k = 'joined_year' and v_year not between 1990 and extract(year from current_date)::int then raise exception 'joined year is out of range' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_year, v_f;
    elsif k = any (t_arr) then
      if jsonb_typeof(v) = 'null' then v_arr := '{}';
      elsif jsonb_typeof(v) <> 'array' then raise exception '% must be a list', k using errcode = '22023';
      else
        if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then raise exception 'every item in % must be text', k using errcode = '22023'; end if;
        select coalesce(array_agg(btrim(e #>> '{}') order by o), '{}') into v_arr from jsonb_array_elements(v) with ordinality x(e, o);
      end if;
      v_max := case k when 'disciplines' then 12 else 10 end;
      if cardinality(v_arr) > v_max then raise exception 'too many items in %', k using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_arr, v_f;
    else
      raise exception 'the profile has a field this version does not know: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  perform private.audit(null, 'fighter.profile_updated', v_f::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
end $$;

revoke execute on function public.fighter_profile(uuid), public.update_my_fighter_profile(jsonb) from public, anon;
grant execute on function public.fighter_profile(uuid) to anon, authenticated;
grant execute on function public.update_my_fighter_profile(jsonb) to authenticated;
