-- Disposable LOCAL database only; fixtures and checks are rolled back.
\set ON_ERROR_STOP on
begin;
create temp table ui_discovery_fixture as
select gen_random_uuid() as id, n, n <= 1500 as fictional from generate_series(1,1530) n;
insert into public.fighters(id,display_name)
select id, '__UI Discovery ' || case when fictional then 'Fictional ' else 'Real ' end || lpad(n::text,4,'0') from ui_discovery_fixture;
insert into public.sources(id,kind,title,synthetic)
values ('99999999-0000-0000-0000-000000001501','submitted','Local discovery gate',true);
insert into public.record_sources(source_id,entity_type,entity_id,status)
select '99999999-0000-0000-0000-000000001501','fighter',id,'unverified' from ui_discovery_fixture where fictional;

do $$ begin
  if (select count(*) from public.fighters where display_name like '__UI Discovery %') <> 1530 then raise exception 'FAIL base fixture count'; end if;
  if (select count(*) from public.fighter_directory where display_name like '__UI Discovery %' and not synthetic) <> 30 then raise exception 'FAIL exclusion before exact count'; end if;
  if exists(select 1 from public.fighter_directory where display_name like '__UI Discovery Fictional %' and not synthetic) then raise exception 'FAIL fictional discovery'; end if;
  if (select count(*) from (select id from public.fighter_directory where display_name like '__UI Discovery %' and not synthetic order by display_name,id limit 24 offset 24) page) <> 6 then raise exception 'FAIL second page is not six real fighters'; end if;
  if not (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.fighter_directory'::regclass) then raise exception 'FAIL caller RLS'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='fighter_directory') <> 13 or exists(select 1 from information_schema.columns where table_schema='public' and table_name='fighter_directory' and column_name in ('birth_year','inactive_reason','email','user_id')) then raise exception 'FAIL extra private columns'; end if;
end $$;

set local role anon;
do $$ begin
  if (select count(*) from public.fighter_directory where display_name like '__UI Discovery %' and not synthetic) <> 30 then raise exception 'FAIL anon count'; end if;
  if has_table_privilege(current_user,'public.fighter_directory','INSERT,UPDATE,DELETE') then raise exception 'FAIL anon write privilege'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  if (select count(*) from public.fighter_directory where display_name like '__UI Discovery %' and not synthetic) <> 30 then raise exception 'FAIL authenticated count'; end if;
  if has_table_privilege(current_user,'public.fighter_directory','INSERT,UPDATE,DELETE') then raise exception 'FAIL authenticated write privilege'; end if;
end $$;
reset role;
rollback;
\echo 'PUBLIC FIGHTER DISCOVERY PASSED (10 checks; 1500 fictional fighters; pagination, permissions and public columns)'
