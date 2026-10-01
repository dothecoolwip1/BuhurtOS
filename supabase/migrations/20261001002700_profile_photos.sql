-- Profile photos: a public Storage bucket, a photo list per fighter, team logo / banner.
--
-- PRIVACY / SECURITY DECISIONS
--   * Photos are public sports content (like a hockey card): the bucket `profile-photos` is public-read, 5 MB, jpeg/png/webp only.
--     A fighter whose profile_public is false still has their photo LIST hidden (RLS on fighter_photos); the object URL itself is unguessable-by-listing
--     only in the weak sense that Storage public buckets serve any known path, so do not upload anything you want private.
--   * Storage write access (storage.objects policies, bucket profile-photos only):
--       - an authenticated user writes only under their own folder  <auth.uid()>/...
--       - a team captain writes only under  teams/<team uuid>/...  (private.is_team_captain)
--       - the platform owner may insert / replace / delete anything in this bucket
--       - nobody writes anywhere else, anon never writes
--     Because Storage and the database are separate, the app flow is: 1) upload the file with supabase.storage, 2) call add_my_photo(path, caption).
--     add_my_photo REFUSES a path that is not inside the caller's folder or that does not exist as an object in the bucket.
--     remove_* RPCs delete only the database row and RETURN the path; the client then deletes the object from storage (policies allow it).
--   * fighter_photos has no write grant; every change goes through the RPCs. Max 8 photos per fighter. fighters.photo_path mirrors the primary photo.
--   * Public URL of a path:  <supabase url>/storage/v1/object/public/profile-photos/<path>  (supabase.storage.from('profile-photos').getPublicUrl(path)).

alter table public.teams
  add column logo_path text check (logo_path is null or char_length(logo_path) <= 200),
  add column banner_path text check (banner_path is null or char_length(banner_path) <= 200);

-- ---------------------------------------------------------------- bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------- who may write which object name
create or replace function private.can_write_photo_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null or p_name is null then false
    when coalesce(array_length(storage.foldername(p_name), 1), 0) = 0 then false
    when p_name like '%..%' then false
    when private.is_owner() then true
    when (storage.foldername(p_name))[1] = auth.uid()::text then true
    when (storage.foldername(p_name))[1] = 'teams' and coalesce(array_length(storage.foldername(p_name), 1), 0) >= 2
         and (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_team_captain(((storage.foldername(p_name))[2])::uuid)
    else false end
$$;
revoke execute on function private.can_write_photo_object(text) from public;
grant execute on function private.can_write_photo_object(text) to anon, authenticated;

create policy profile_photos_read on storage.objects for select to anon, authenticated using (bucket_id = 'profile-photos');
create policy profile_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and private.can_write_photo_object(name));
create policy profile_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and private.can_write_photo_object(name)) with check (bucket_id = 'profile-photos' and private.can_write_photo_object(name));
create policy profile_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and private.can_write_photo_object(name));

-- ---------------------------------------------------------------- photo list
create table public.fighter_photos (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 3 and 200),
  caption text check (caption is null or char_length(caption) <= 140),
  is_primary boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index fighter_photos_one_primary on public.fighter_photos (fighter_id) where is_primary;
create index fighter_photos_fighter_idx on public.fighter_photos (fighter_id, sort);
alter table public.fighter_photos enable row level security;
create policy fighter_photos_read on public.fighter_photos for select to anon, authenticated
  using (exists (select 1 from public.fighters f where f.id = fighter_id and (f.profile_public or f.id = private.my_fighter_id() or private.is_owner())));
grant select on public.fighter_photos to anon, authenticated;
-- No write grant: add_my_photo / set_my_primary_photo / remove_my_photo / admin_remove_photo only.

-- ---------------------------------------------------------------- helpers
create or replace function private.valid_photo_path(p_path text, p_prefix text) returns boolean
language sql immutable set search_path = '' as $$
  select p_path is not null and char_length(p_path) <= 200 and left(p_path, char_length(p_prefix)) = p_prefix
    and p_path ~ '^[A-Za-z0-9/_.-]+$' and p_path !~ '\.\.' and p_path !~ '//' and p_path ~* '\.(jpe?g|png|webp)$'
$$;
revoke execute on function private.valid_photo_path(text, text) from public, anon, authenticated;

create or replace function private.sync_primary_photo(p_fighter uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.fighter_photos where fighter_id = p_fighter and is_primary) then
    select id into v_id from public.fighter_photos where fighter_id = p_fighter order by sort, created_at, id limit 1;
    if v_id is not null then update public.fighter_photos set is_primary = true where id = v_id; end if;
  end if;
  update public.fighters set photo_path = (select storage_path from public.fighter_photos where fighter_id = p_fighter and is_primary) where id = p_fighter;
end $$;
revoke execute on function private.sync_primary_photo(uuid) from public, anon, authenticated;

-- Deletes the row, keeps a primary photo if any is left, returns the storage path (so the client can delete the object).
create or replace function private.remove_photo(p_photo uuid, p_fighter uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text; v_f uuid;
begin
  delete from public.fighter_photos where id = p_photo and (p_fighter is null or fighter_id = p_fighter) returning storage_path, fighter_id into v_path, v_f;
  if v_path is null then raise exception 'photo not found' using errcode = 'P0002'; end if;
  perform private.sync_primary_photo(v_f);
  return v_path;
end $$;
revoke execute on function private.remove_photo(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- fighter RPCs
-- The caller uploaded the file to profile-photos/<their uid>/<file>.jpg|png|webp first. The first photo becomes the primary one.
create or replace function public.add_my_photo(p_path text, p_caption text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_f uuid; v_cap text := nullif(btrim(coalesce(p_caption, '')), ''); v_id uuid; v_n int;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_f := private.my_fighter_id();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  if not private.valid_photo_path(p_path, v_uid::text || '/') then raise exception 'the photo must be an image inside your own folder' using errcode = '22023'; end if;
  if char_length(coalesce(v_cap, '')) > 140 then raise exception 'the caption is at most 140 characters' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_path) then raise exception 'upload the file first' using errcode = '22023'; end if;
  perform 1 from public.fighters where id = v_f for update;
  select count(*) into v_n from public.fighter_photos where fighter_id = v_f;
  if v_n >= 8 then raise exception 'you can have at most 8 photos; remove one first' using errcode = '22023'; end if;
  if exists (select 1 from public.fighter_photos where storage_path = p_path) then raise exception 'that photo is already added' using errcode = '22023'; end if;
  insert into public.fighter_photos (fighter_id, storage_path, caption, sort, is_primary)
  values (v_f, p_path, v_cap, coalesce((select max(sort) + 1 from public.fighter_photos where fighter_id = v_f), 0), false) returning id into v_id;
  perform private.sync_primary_photo(v_f);
  perform private.audit(null, 'fighter.photo_added', v_f::text, jsonb_build_object('photo', v_id));
  return v_id;
end $$;

create or replace function public.set_my_primary_photo(p_photo uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f uuid := private.my_fighter_id();
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_f is null or not exists (select 1 from public.fighter_photos where id = p_photo and fighter_id = v_f) then raise exception 'photo not found' using errcode = 'P0002'; end if;
  update public.fighter_photos set is_primary = false where fighter_id = v_f and is_primary and id <> p_photo;
  update public.fighter_photos set is_primary = true where id = p_photo;
  perform private.sync_primary_photo(v_f);
end $$;

-- Returns the storage path so the client can delete the object itself.
create or replace function public.remove_my_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_f uuid := private.my_fighter_id(); v_path text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_f is null then raise exception 'photo not found' using errcode = 'P0002'; end if;
  v_path := private.remove_photo(p_photo, v_f);
  perform private.audit(null, 'fighter.photo_removed', v_f::text, jsonb_build_object('photo', p_photo));
  return v_path;
end $$;

-- Platform owner only (moderation). Returns the path; the owner's client deletes the object (owner may delete anything in the bucket).
create or replace function public.admin_remove_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text; v_f uuid;
begin
  if not private.is_owner() then raise exception 'only the platform owner can remove another person''s photo' using errcode = '42501'; end if;
  select fighter_id into v_f from public.fighter_photos where id = p_photo;
  v_path := private.remove_photo(p_photo, null);
  perform private.audit(null, 'admin.photo_removed', v_f::text, jsonb_build_object('photo', p_photo));
  return v_path;
end $$;

-- ---------------------------------------------------------------- team logo / banner
-- p_path null clears it. The path must be teams/<team uuid>/<file>.jpg|png|webp and the object must exist. Captains of that team and the owner.
create or replace function private.set_team_image(p_team uuid, p_path text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not (private.is_team_captain(p_team) or private.is_owner()) then raise exception 'only the team captain can change the team images' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  if p_path is not null then
    if not private.valid_photo_path(p_path, 'teams/' || p_team::text || '/') then raise exception 'the image must be inside the team folder teams/<team id>/' using errcode = '22023'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_path) then raise exception 'upload the file first' using errcode = '22023'; end if;
  end if;
  if p_kind = 'logo' then update public.teams set logo_path = p_path where id = p_team; else update public.teams set banner_path = p_path where id = p_team; end if;
  perform private.audit(null, 'team.' || p_kind || '_set', p_team::text, jsonb_build_object('cleared', p_path is null));
end $$;
revoke execute on function private.set_team_image(uuid, text, text) from public, anon, authenticated;

create or replace function public.set_team_logo(p_team uuid, p_path text) returns void
language sql security definer set search_path = '' as $$ select private.set_team_image(p_team, p_path, 'logo') $$;
create or replace function public.set_team_banner(p_team uuid, p_path text) returns void
language sql security definer set search_path = '' as $$ select private.set_team_image(p_team, p_path, 'banner') $$;

revoke execute on function public.add_my_photo(text, text), public.set_my_primary_photo(uuid), public.remove_my_photo(uuid), public.admin_remove_photo(uuid),
  public.set_team_logo(uuid, text), public.set_team_banner(uuid, text) from public, anon;
grant execute on function public.add_my_photo(text, text), public.set_my_primary_photo(uuid), public.remove_my_photo(uuid), public.admin_remove_photo(uuid),
  public.set_team_logo(uuid, text), public.set_team_banner(uuid, text) to authenticated;
