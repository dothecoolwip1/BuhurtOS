begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table('public','fighter_identities','canonical fighter identities exist');
select has_table('public','clubs','clubs exist');
select has_table('public','fighter_affiliations','affiliation history exists');
select has_table('public','competition_divisions','formal divisions exist');
select has_table('public','event_divisions','event division assignments exist');

select has_column('public','fighters','identity_id','fighters link to canonical identity');
select has_column('public','fighters','merged_into_fighter_id','fighter merges are traceable');
select has_column('public','fighters','deleted_at','fighters use soft deletion');
select has_column('public','teams','club_id','teams can belong to clubs');
select has_column('public','matches','division_id','matches can reference formal divisions');
select has_column('public','brackets','division_id','brackets can reference formal divisions');
select has_column('public','event_registrations','division_id','registrations can reference formal divisions');

select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='fighter_identities'),'fighter identities have RLS');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='clubs'),'clubs have RLS');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='fighter_affiliations'),'affiliations have RLS');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='competition_divisions'),'divisions have RLS');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='event_divisions'),'event divisions have RLS');

select ok(has_table_privilege('anon','public.competition_divisions','SELECT'),'anonymous spectators can read published divisions through RLS');
select ok(not has_table_privilege('anon','public.competition_divisions','INSERT'),'anonymous spectators cannot create divisions');
select ok(has_table_privilege('authenticated','public.clubs','SELECT'),'authenticated users have Data API table access subject to RLS');

select ok(not has_function_privilege('anon','public.claim_temporary_fighter(uuid,uuid,text)','EXECUTE'),'anonymous users cannot claim temporary fighters');
select ok(not has_function_privilege('anon','public.merge_fighters(uuid,uuid)','EXECUTE'),'anonymous users cannot merge fighters');

select * from finish();
rollback;
