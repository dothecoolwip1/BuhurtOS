-- One-time secure bootstrap for a fresh BuhurtOS database.
-- The first authenticated account may claim platform_super_admin only while no platform membership exists.
create or replace function public.claim_first_super_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  lock table public.platform_memberships in share row exclusive mode;
  if exists (select 1 from public.platform_memberships) then
    return false;
  end if;
  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Profile bootstrap has not completed';
  end if;
  insert into public.platform_memberships(user_id, role) values (v_user, 'platform_super_admin');
  insert into public.audit_log(actor_user_id,table_name,record_id,action,payload)
  values (v_user,'platform_memberships',v_user,'claim_first_super_admin','{}'::jsonb);
  return true;
end;
$$;

revoke execute on function public.claim_first_super_admin() from public, anon;
grant execute on function public.claim_first_super_admin() to authenticated;
