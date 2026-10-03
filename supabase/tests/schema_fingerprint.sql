-- A deterministic text fingerprint of the BuhurtOS schema (schemas public and private): tables and columns, constraints, indexes, policies,
-- functions (with an md5 of each definition), views (md5 of each definition) and triggers. One line per object, sorted.
-- Used two ways:  (1) CI rebuilds the database from the migrations and compares this output with supabase/schema.fingerprint.txt, so a migration that changes
-- the schema without the snapshot being updated (or the other way round) fails the build.  (2) The same query can be run read-only against the hosted
-- project and diffed, to detect drift between what the repository says and what is deployed. Grants are left out on purpose: Supabase adds default
-- privileges that a plain Postgres does not have; permissions are covered by the *_gate.sql suites instead.
\pset format unaligned
\pset tuples_only on
\pset footer off
select line from (
  select 'table ' || c.relnamespace::regnamespace || '.' || c.relname || ' rls=' || c.relrowsecurity as line
    from pg_class c where c.relkind = 'r' and c.relnamespace::regnamespace::text in ('public', 'private')
  union all
  select 'column ' || c.relnamespace::regnamespace || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and c.relnamespace::regnamespace::text in ('public', 'private')
  union all
  select 'constraint ' || c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    from pg_constraint c where c.connamespace::regnamespace::text in ('public', 'private')
  union all
  select 'index ' || i.schemaname || '.' || i.tablename || ' ' || regexp_replace(i.indexdef, '^CREATE (UNIQUE )?INDEX \S+ ', 'CREATE \1INDEX ')
    from pg_indexes i where i.schemaname in ('public', 'private')
  union all
  select 'policy ' || p.schemaname || '.' || p.tablename || ' ' || p.policyname || ' ' || p.cmd || ' roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
    from pg_policies p where p.schemaname in ('public', 'private')
  union all
  select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef || ' ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 'view ' || c.relnamespace::regnamespace || '.' || c.relname || ' opts=' || coalesce(array_to_string(c.reloptions, ','), '') || ' ' || md5(pg_get_viewdef(c.oid))
    from pg_class c where c.relkind in ('v', 'm') and c.relnamespace::regnamespace::text in ('public', 'private')
  union all
  select 'trigger ' || c.relnamespace::regnamespace || '.' || c.relname || ' ' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace::regnamespace::text in ('public', 'private')
) x order by line;
