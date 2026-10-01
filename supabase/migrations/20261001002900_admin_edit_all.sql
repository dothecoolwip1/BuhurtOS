-- Platform owner: see and edit ALL teams and fighters.
-- Authority: private.is_owner() ONLY (platform_roles 'owner'). Platform organizers, event organizers, org admins, captains, marshals and fighters are refused.
-- Every function is security definer, so the owner sees everything regardless of a team's status, a disabled organization (teams_active's rule does not
-- apply here), or an unclaimed fighter. No account ids are returned. Every change is audited with the changed FIELD NAMES, never medical or private data
-- (the owner has no access to person_private / registration_private through these functions).
-- fighters / teams still have NO table write grant: the only way to change them is these functions (and the existing captain / self-service ones).

create or replace function private.require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_owner() then raise exception 'only the platform owner can do this' using errcode = '42501'; end if;
end $$;
revoke execute on function private.require_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------- lists
-- p_query matches name or slug (case-insensitive). total_count is the number of matches before limit / offset. limit is capped at 200.
create or replace function public.admin_list_teams(p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (team_id uuid, slug text, name text, status text, city text, region text, country text, logo_path text, created_at timestamptz,
  organization_id uuid, organization_slug text, organization_name text, organization_enabled boolean, roster_count int, captain_count int, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_owner();
  return query
  select t.id, t.slug, t.name, t.status, t.city, t.region, t.country, t.logo_path, t.created_at, o.id, o.slug, o.name, o.enabled,
    (select count(*)::int from (
       select m.fighter_id from public.team_memberships m where m.team_id = t.id and (m.to_date is null or m.to_date >= current_date)
       union select f.id from public.fighters f where f.team_id = t.id) r),
    (select count(*)::int from public.team_roles r where r.team_id = t.id),
    count(*) over ()
  from public.teams t
  left join lateral (
    select og.* from public.team_affiliations a join public.organizations og on og.id = a.organization_id
    where a.team_id = t.id and a.relation = 'member' and (a.from_date is null or a.from_date <= current_date) and (a.to_date is null or a.to_date >= current_date)
    order by og.enabled desc, a.from_date nulls last, og.id limit 1) o on true
  where v_q is null or t.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or t.slug ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
  order by lower(t.name), t.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- claimed = some account controls the record (the account itself is never returned). Unclaimed fighters are included.
create or replace function public.admin_list_fighters(p_query text default null, p_team uuid default null, p_limit int default 50, p_offset int default 0)
returns table (fighter_id uuid, display_name text, team_id uuid, team_name text, team_slug text, claimed boolean, city text, region text, country text,
  photo_path text, profile_public boolean, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_owner();
  return query
  select f.id, f.display_name, f.team_id, t.name, t.slug, exists (select 1 from public.fighter_accounts fa where fa.fighter_id = f.id),
    f.city, f.region, f.country, f.photo_path, f.profile_public, f.created_at, count(*) over ()
  from public.fighters f left join public.teams t on t.id = f.team_id
  where (v_q is null or f.display_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
    and (p_team is null or f.team_id = p_team or exists (select 1 from public.team_memberships m where m.fighter_id = f.id and m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)))
  order by lower(f.display_name), f.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------- edit a team
-- Keys: name (2..80), slug (unique, lowercase-dashes), city, region, country (<=80), description (<=500), website (https), social_links, colors (two #rrggbb),
-- crest_division, initial (<=2), status (approved|pending), founded_year, claimed_organizations (<=5), logo_path, banner_path (null clears; else teams/<id>/file.jpg|png|webp
-- that exists in storage). Unknown keys are refused. A key sent as null clears nullable fields; name, slug, status, colors, crest_division cannot be null.
create or replace function public.admin_update_team(p_team uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text; v jsonb; v_txt text; v_max int; v_arr text[]; v_year int;
  c_url constant text := '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$';
begin
  perform private.require_owner();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the changes as an object' using errcode = '22023'; end if;
  perform 1 from public.teams where id = p_team for update;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k in ('name', 'slug', 'city', 'region', 'country', 'description', 'website', 'initial', 'status', 'crest_division') then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      if v_txt is null and k in ('name', 'slug', 'status', 'crest_division') then raise exception '% cannot be empty', k using errcode = '22023'; end if;
      v_max := case k when 'description' then 500 when 'website' then 300 when 'initial' then 2 when 'slug' then 60 else 80 end;
      if char_length(coalesce(v_txt, '')) > v_max then raise exception '% is too long', k using errcode = '22023'; end if;
      if k = 'name' and char_length(v_txt) < 2 then raise exception 'the team name must be 2 to 80 characters' using errcode = '22023'; end if;
      if k = 'slug' then
        if v_txt !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'the team address must be lowercase letters, numbers and dashes' using errcode = '22023'; end if;
        if exists (select 1 from public.teams where slug = v_txt and id <> p_team) then raise exception 'that team address is already taken' using errcode = '22023'; end if;
      end if;
      if k = 'status' and v_txt not in ('approved', 'pending') then raise exception 'status must be approved or pending' using errcode = '22023'; end if;
      if k = 'crest_division' and v_txt not in ('pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire') then raise exception 'unknown crest pattern' using errcode = '22023'; end if;
      if k = 'website' and v_txt is not null and v_txt !~ c_url then raise exception 'the website must be a full https:// address' using errcode = '22023'; end if;
      if k = 'initial' then v_txt := upper(coalesce(v_txt, '')); end if;
      execute format('update public.teams set %I = $1 where id = $2', k) using case when k = 'initial' then v_txt else v_txt end, p_team;
    elsif k = 'founded_year' then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{4}$' then raise exception 'founded year must be a four digit year' using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      if v_year is not null and v_year not between 1900 and extract(year from current_date)::int then raise exception 'founded year must be between 1900 and this year' using errcode = '22023'; end if;
      update public.teams set founded_year = v_year where id = p_team;
    elsif k = 'social_links' then
      update public.teams set social_links = private.clean_social_links(v) where id = p_team;
    elsif k = 'claimed_organizations' then
      if jsonb_typeof(v) = 'null' then v_arr := '{}';
      elsif jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5 or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 2 and 120) then
        raise exception 'name at most 5 organizations, 2 to 120 characters each' using errcode = '22023';
      else select coalesce(array_agg(btrim(e #>> '{}') order by o), '{}') into v_arr from jsonb_array_elements(v) with ordinality x(e, o); end if;
      update public.teams set claimed_organizations = v_arr where id = p_team;
    elsif k = 'colors' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2 or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^#[0-9A-Fa-f]{6}$') then
        raise exception 'colours must be two hex colours like #2C4A8C' using errcode = '22023'; end if;
      select array_agg(e #>> '{}' order by o) into v_arr from jsonb_array_elements(v) with ordinality x(e, o);
      update public.teams set colors = v_arr where id = p_team;
    elsif k in ('logo_path', 'banner_path') then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      if v_txt is not null then
        if not private.valid_photo_path(v_txt, 'teams/' || p_team::text || '/') then raise exception '% must be inside teams/<team id>/ and be an image', k using errcode = '22023'; end if;
        if not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = v_txt) then raise exception 'upload the file first' using errcode = '22023'; end if;
      end if;
      execute format('update public.teams set %I = $1 where id = $2', k) using v_txt, p_team;
    else
      raise exception 'a team has no editable field named %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  perform private.audit(null, 'admin.team_updated', p_team::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
end $$;

-- ---------------------------------------------------------------- move a fighter between teams (history is kept)
-- Closes every open, non-mercenary membership of the fighter at OTHER teams (to_date = today, or their from_date if that is later), opens a membership at the new
-- team (role 'fighter', from_date today) unless an open one already exists there, and sets fighters.team_id. Nothing is deleted. p_team null = leave the team.
create or replace function private.move_fighter_team(p_fighter uuid, p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_team is not null and not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  update public.team_memberships set to_date = greatest(current_date, coalesce(from_date, current_date))
    where fighter_id = p_fighter and to_date is null and not mercenary and team_id is distinct from p_team;
  if p_team is not null and not exists (select 1 from public.team_memberships where fighter_id = p_fighter and team_id = p_team and to_date is null and not mercenary) then
    insert into public.team_memberships (fighter_id, team_id, role, from_date) values (p_fighter, p_team, 'fighter', current_date);
  end if;
  update public.fighters set team_id = p_team where id = p_fighter;
end $$;
revoke execute on function private.move_fighter_team(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_set_fighter_team(p_fighter uuid, p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  perform private.require_owner();
  select team_id into v_old from public.fighters where id = p_fighter for update;
  if not found then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  perform private.move_fighter_team(p_fighter, p_team);
  perform private.audit(null, 'admin.fighter_team_set', p_fighter::text, jsonb_build_object('from', v_old, 'to', p_team));
end $$;

-- ---------------------------------------------------------------- edit a fighter
-- Keys: display_name (2..80), team_id (uuid or null; moves the fighter as above), photo_path (null clears; else it must be one of THIS fighter's photos), and every profile
-- field of update_my_fighter_profile (gender, birth_year, city, region, country, joined_year, disciplines, fighting_style, bio, highlights, nickname, pronouns, handedness,
-- jersey_number, height_cm, weight_kg, social_links, show_age, show_physical, profile_public). Unknown keys are refused. Works on unclaimed fighters too.
create or replace function public.admin_update_fighter(p_fighter uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_team uuid; v_rest jsonb; v_old uuid; v_path text;
begin
  perform private.require_owner();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the changes as an object' using errcode = '22023'; end if;
  select team_id into v_old from public.fighters where id = p_fighter for update;
  if not found then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  v_rest := p - 'display_name' - 'team_id' - 'photo_path';
  if p ? 'display_name' then
    if jsonb_typeof(p -> 'display_name') <> 'string' then raise exception 'display_name must be text' using errcode = '22023'; end if;
    v_name := btrim(p ->> 'display_name');
    if char_length(v_name) not between 2 and 80 then raise exception 'the name must be 2 to 80 characters' using errcode = '22023'; end if;
    update public.fighters set display_name = v_name where id = p_fighter;
  end if;
  if p ? 'photo_path' then
    if jsonb_typeof(p -> 'photo_path') not in ('string', 'null') then raise exception 'photo_path must be text' using errcode = '22023'; end if;
    v_path := nullif(btrim(p ->> 'photo_path'), '');
    if v_path is null then
      update public.fighter_photos set is_primary = false where fighter_id = p_fighter and is_primary;
      update public.fighters set photo_path = null where id = p_fighter;
    else
      if not exists (select 1 from public.fighter_photos where fighter_id = p_fighter and storage_path = v_path) then raise exception 'photo_path must be one of the fighter''s photos' using errcode = '22023'; end if;
      update public.fighter_photos set is_primary = false where fighter_id = p_fighter and is_primary and storage_path <> v_path;
      update public.fighter_photos set is_primary = true where fighter_id = p_fighter and storage_path = v_path;
      perform private.sync_primary_photo(p_fighter);
    end if;
  end if;
  if v_rest <> '{}'::jsonb then perform private.apply_fighter_profile(p_fighter, v_rest); end if;
  if p ? 'team_id' then
    if jsonb_typeof(p -> 'team_id') not in ('string', 'null') then raise exception 'team_id must be an id or null' using errcode = '22023'; end if;
    begin v_team := nullif(p ->> 'team_id', '')::uuid; exception when invalid_text_representation then raise exception 'team_id must be an id or null' using errcode = '22023'; end;
    if v_team is distinct from v_old then perform private.move_fighter_team(p_fighter, v_team); end if;
  end if;
  perform private.audit(null, 'admin.fighter_updated', p_fighter::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
end $$;

-- ---------------------------------------------------------------- merge two fighter records (duplicates)
-- Everything that points at p_remove is repointed to p_keep, then p_remove is deleted: entries, entry_fighters, registrations, team_memberships, the account link, photos.
-- Refused (nothing changes) when: both fighters have an account; both have an entry (or a roster place) in the same competition; the photos would exceed 8.
-- Profile fields of p_keep are never overwritten; empty ones are filled from p_remove.
create or replace function public.admin_merge_fighters(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_keep public.fighters; v_remove public.fighters; n_entries int; n_roster int; n_regs int; n_members int; n_photos int;
begin
  perform private.require_owner();
  if p_keep is null or p_remove is null or p_keep = p_remove then raise exception 'choose two different fighters' using errcode = '22023'; end if;
  perform 1 from public.fighters where id in (p_keep, p_remove) order by id for update;
  select * into v_keep from public.fighters where id = p_keep;
  select * into v_remove from public.fighters where id = p_remove;
  if v_keep.id is null or v_remove.id is null then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.fighter_accounts where fighter_id = p_keep) and exists (select 1 from public.fighter_accounts where fighter_id = p_remove) then
    raise exception 'both fighters belong to an account; they cannot be merged' using errcode = '22023'; end if;
  if exists (select 1 from public.entries a join public.entries b on b.competition_id = a.competition_id where a.fighter_id = p_keep and b.fighter_id = p_remove)
     or exists (select 1 from public.entry_fighters a join public.entry_fighters b on b.competition_id = a.competition_id where a.fighter_id = p_keep and b.fighter_id = p_remove)
     or exists (select 1 from public.entry_fighters a join public.entry_fighters b on b.entry_id = a.entry_id where a.fighter_id = p_keep and b.fighter_id = p_remove) then
    raise exception 'both fighters appear in the same competition; resolve that first' using errcode = '22023'; end if;
  if (select count(*) from public.fighter_photos where fighter_id in (p_keep, p_remove)) > 8 then raise exception 'together they have more than 8 photos; remove some first' using errcode = '22023'; end if;

  update public.entries set fighter_id = p_keep where fighter_id = p_remove;
  get diagnostics n_entries = row_count;
  update public.entry_fighters set fighter_id = p_keep where fighter_id = p_remove;
  get diagnostics n_roster = row_count;
  update public.registrations set fighter_id = p_keep where fighter_id = p_remove;
  get diagnostics n_regs = row_count;
  update public.team_memberships set fighter_id = p_keep where fighter_id = p_remove;
  get diagnostics n_members = row_count;
  update public.fighter_accounts set fighter_id = p_keep where fighter_id = p_remove;
  update public.fighter_photos set is_primary = false, fighter_id = p_keep, sort = sort + 100 where fighter_id = p_remove;
  get diagnostics n_photos = row_count;
  update public.fighters k set team_id = coalesce(k.team_id, v_remove.team_id), gender = coalesce(k.gender, v_remove.gender), birth_year = coalesce(k.birth_year, v_remove.birth_year),
    city = coalesce(k.city, v_remove.city), region = coalesce(k.region, v_remove.region), country = coalesce(k.country, v_remove.country), joined_year = coalesce(k.joined_year, v_remove.joined_year),
    fighting_style = coalesce(k.fighting_style, v_remove.fighting_style), bio = coalesce(k.bio, v_remove.bio), nickname = coalesce(k.nickname, v_remove.nickname),
    handedness = coalesce(k.handedness, v_remove.handedness)
  where k.id = p_keep;
  delete from public.fighters where id = p_remove;
  perform private.sync_primary_photo(p_keep);
  perform private.audit(null, 'admin.fighters_merged', p_keep::text, jsonb_build_object('removed', p_remove, 'removed_name', v_remove.display_name,
    'moved', jsonb_build_object('entries', n_entries, 'entry_fighters', n_roster, 'registrations', n_regs, 'team_memberships', n_members, 'photos', n_photos)));
end $$;

revoke execute on function public.admin_list_teams(text, int, int), public.admin_list_fighters(text, uuid, int, int), public.admin_update_team(uuid, jsonb),
  public.admin_set_fighter_team(uuid, uuid), public.admin_update_fighter(uuid, jsonb), public.admin_merge_fighters(uuid, uuid) from public, anon;
grant execute on function public.admin_list_teams(text, int, int), public.admin_list_fighters(text, uuid, int, int), public.admin_update_team(uuid, jsonb),
  public.admin_set_fighter_team(uuid, uuid), public.admin_update_fighter(uuid, jsonb), public.admin_merge_fighters(uuid, uuid) to authenticated;
