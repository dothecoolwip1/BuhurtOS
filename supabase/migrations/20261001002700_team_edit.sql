-- Editing a team after it exists, and a team emblem. Additive.
--   * Who may edit: the team's captain, the platform owner or an organizer, or an admin of an organization the team is a member of.
--     Only the last two groups (the people who may name captains) may rename a team. The web address (slug) never changes.
--   * Teams change only through update_team_profile() and set_team_emblem(); there is still no table grant for writing teams.
--   * The emblem lives in the public bucket 'team-emblems', one folder per team: <team id>/<timestamp>.(png|jpg|webp). It is shown in
--     the middle of the shield in place of the initial.

alter table public.teams add column emblem_path text check (emblem_path is null or (char_length(emblem_path) <= 120 and emblem_path ~ '^[0-9a-f-]{36}/[0-9]+\.(png|jpg|webp)$'));

create or replace function private.can_edit_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (private.is_team_captain(p_team) or private.can_assign_captain(p_team))
$$;
revoke execute on function private.can_edit_team(uuid) from public, anon, authenticated;

-- What the web page asks to decide whether to show "Edit team" (the database still checks every change).
create or replace function public.can_edit_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.can_edit_team(p_team) $$;
-- Whether the person may also rename the team.
create or replace function public.can_rename_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select auth.uid() is not null and private.can_assign_captain(p_team) $$;
revoke execute on function public.can_edit_team(uuid), public.can_rename_team(uuid) from public, anon;
grant execute on function public.can_edit_team(uuid), public.can_rename_team(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-emblems', 'team-emblems', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy team_emblems_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'team-emblems' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_team(((storage.foldername(name))[1])::uuid) else false end);
create policy team_emblems_update on storage.objects for update to authenticated
  using (bucket_id = 'team-emblems' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_team(((storage.foldername(name))[1])::uuid) else false end)
  with check (bucket_id = 'team-emblems' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_team(((storage.foldername(name))[1])::uuid) else false end);
create policy team_emblems_delete on storage.objects for delete to authenticated
  using (bucket_id = 'team-emblems' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_team(((storage.foldername(name))[1])::uuid) else false end);

-- Keys (all optional; a key that is sent replaces that field, null clears it where allowed):
--   name (owner, organizers and organization admins only), city, region, country, description, website, social_links, founded_year,
--   claimed_organizations, colors, crest_division, initial. Unknown keys are refused.
create or replace function public.update_team_profile(p_team uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text; v jsonb; v_txt text; v_year int; v_social jsonb; v_claims text[]; v_colors text[]; e jsonb; sk text; sv jsonb; v_changed text[] := '{}';
  c_url constant text := '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$';
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.can_edit_team(p_team) then raise exception 'only the team captain or an organizer can edit this team' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the team as an object' using errcode = '22023'; end if;
  for k, v in select key, value from jsonb_each(p) loop
    v_changed := v_changed || k;
    if k = 'name' then
      if not private.can_assign_captain(p_team) then raise exception 'only an organizer can rename a team' using errcode = '42501'; end if;
      if jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) not between 2 and 80 then raise exception 'the team name must be 2 to 80 characters' using errcode = '22023'; end if;
      update public.teams set name = btrim(v #>> '{}') where id = p_team;
    elsif k in ('city', 'region', 'country') then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      if char_length(coalesce(v_txt, '')) > 80 then raise exception 'city, region and country are at most 80 characters' using errcode = '22023'; end if;
      if k <> 'region' and v_txt is null then raise exception '% is required', k using errcode = '22023'; end if;
      execute format('update public.teams set %I = $1 where id = $2', k) using v_txt, p_team;
    elsif k = 'description' then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception 'the description must be text' using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      if v_txt is not null and char_length(v_txt) not between 10 and 500 then raise exception 'describe the team in 10 to 500 characters' using errcode = '22023'; end if;
      update public.teams set description = v_txt where id = p_team;
    elsif k = 'website' then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception 'the website must be text' using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      if v_txt is not null and (char_length(v_txt) > 300 or v_txt !~ c_url) then raise exception 'the website must be a full https:// address' using errcode = '22023'; end if;
      update public.teams set website = v_txt where id = p_team;
    elsif k = 'founded_year' then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{4}$' then raise exception 'founded year must be a four digit year' using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      if v_year is not null and v_year not between 1900 and extract(year from now())::int then raise exception 'founded year must be between 1900 and this year' using errcode = '22023'; end if;
      update public.teams set founded_year = v_year where id = p_team;
    elsif k = 'social_links' then
      v_social := '{}'::jsonb;
      if jsonb_typeof(v) = 'object' then
        if (select count(*) from jsonb_object_keys(v)) > 8 then raise exception 'at most 8 social links' using errcode = '22023'; end if;
        for sk, sv in select key, value from jsonb_each(v) loop
          if sk <> all (array['facebook','instagram','youtube','tiktok','x','discord','twitch','other']) then raise exception 'unknown social link: %', left(sk, 40) using errcode = '22023'; end if;
          if jsonb_typeof(sv) <> 'string' or char_length(sv #>> '{}') > 300 or (sv #>> '{}') !~ c_url then raise exception 'the % link must be a full https:// address', sk using errcode = '22023'; end if;
          v_social := v_social || jsonb_build_object(sk, btrim(sv #>> '{}'));
        end loop;
      elsif jsonb_typeof(v) <> 'null' then raise exception 'social links must be a list of name and address' using errcode = '22023'; end if;
      update public.teams set social_links = v_social where id = p_team;
    elsif k = 'claimed_organizations' then
      v_claims := '{}';
      if jsonb_typeof(v) = 'array' then
        if jsonb_array_length(v) > 5 then raise exception 'name at most 5 organizations' using errcode = '22023'; end if;
        for e in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 2 and 120 then raise exception 'each organization name must be 2 to 120 characters' using errcode = '22023'; end if;
          v_claims := v_claims || btrim(e #>> '{}');
        end loop;
      elsif jsonb_typeof(v) <> 'null' then raise exception 'organizations must be a list' using errcode = '22023'; end if;
      update public.teams set claimed_organizations = v_claims where id = p_team;
    elsif k = 'colors' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2 or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^#[0-9A-Fa-f]{6}$') then
        raise exception 'colours must be two hex colours like #2C4A8C' using errcode = '22023'; end if;
      select array_agg(x #>> '{}' order by o) into v_colors from jsonb_array_elements(v) with ordinality as t(x, o);
      update public.teams set colors = v_colors where id = p_team;
    elsif k = 'crest_division' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire') then raise exception 'unknown crest pattern' using errcode = '22023'; end if;
      update public.teams set crest_division = v #>> '{}' where id = p_team;
    elsif k = 'initial' then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception 'the crest initial must be text' using errcode = '22023'; end if;
      v_txt := upper(coalesce(nullif(btrim(v #>> '{}'), ''), (select left(name, 1) from public.teams where id = p_team)));
      if char_length(v_txt) > 2 then raise exception 'the crest initial is one or two letters' using errcode = '22023'; end if;
      update public.teams set initial = v_txt where id = p_team;
    else
      raise exception 'the team has a field this version does not know: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  perform private.audit(null, 'team.profile_updated', p_team::text, jsonb_build_object('fields', to_jsonb(v_changed)));
end $$;

create or replace function public.set_team_emblem(p_team uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.can_edit_team(p_team) then raise exception 'only the team captain or an organizer can edit this team' using errcode = '42501'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_team::text then raise exception 'that emblem is not in this team''s folder' using errcode = '42501'; end if;
  update public.teams set emblem_path = p_path where id = p_team;
  perform private.audit(null, 'team.emblem_updated', p_team::text);
end $$;

revoke execute on function public.update_team_profile(uuid, jsonb), public.set_team_emblem(uuid, text) from public, anon;
grant execute on function public.update_team_profile(uuid, jsonb), public.set_team_emblem(uuid, text) to authenticated;
