-- Profile photo (additive). A public storage bucket 'avatars' holds one folder per fighter record: <fighter id>/<timestamp>.jpg.
--   * Anyone can read (a profile photo is public, like the rest of the fighter profile). Only the fighter who owns the record can write
--     to its folder (public.my_fighter_id()). The app resizes to at most 512px before upload; the bucket also caps size and type.
--   * fighters.avatar_path is changed only through set_my_fighter_avatar(); it must point inside the caller's own folder, or be null.
--   * fighter_profile() now returns avatar_path.

alter table public.fighters add column avatar_path text check (avatar_path is null or (char_length(avatar_path) <= 120 and avatar_path ~ '^[0-9a-f-]{36}/[0-9]+\.(jpg|png|webp)$'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_fighter_id()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_fighter_id()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_fighter_id()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_fighter_id()::text);

create or replace function public.set_my_fighter_avatar(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> v_f::text then raise exception 'that photo is not in your folder' using errcode = '42501'; end if;
  update public.fighters set avatar_path = p_path where id = v_f;
  perform private.audit(null, 'fighter.avatar_updated', v_f::text);
end $$;
revoke execute on function public.set_my_fighter_avatar(text) from public, anon;
grant execute on function public.set_my_fighter_avatar(text) to authenticated;

drop function public.fighter_profile(uuid);
create function public.fighter_profile(p_fighter uuid)
returns table (fighter_id uuid, display_name text, gender text, birth_year int, age int, city text, region text, country text, joined_year int,
  disciplines text[], fighting_style text, bio text, highlights text[],
  team_id uuid, team_name text, team_slug text,
  team_organization_id uuid, team_organization_slug text, team_organization_name text, team_organization_enabled boolean, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.display_name, f.gender, f.birth_year,
    case when f.birth_year is null then null else extract(year from current_date)::int - f.birth_year end,
    f.city, f.region, f.country, f.joined_year, f.disciplines, f.fighting_style, f.bio, f.highlights,
    t.id, t.name, t.slug, o.id, o.slug, o.name, o.enabled, f.avatar_path
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
revoke execute on function public.fighter_profile(uuid) from public, anon;
grant execute on function public.fighter_profile(uuid) to anon, authenticated;
