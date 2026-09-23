-- Keep public.profile rows synchronized with Supabase Auth identities.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name, locale, timezone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1), 'BuhurtOS User'),
    coalesce(nullif(new.raw_user_meta_data->>'locale',''),'en'),
    'UTC'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Backfill identities that existed before this migration.
insert into public.profiles(id, display_name, locale, timezone)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(coalesce(u.email,''),'@',1), 'BuhurtOS User'),
  coalesce(nullif(u.raw_user_meta_data->>'locale',''),'en'),
  'UTC'
from auth.users u
on conflict (id) do nothing;
