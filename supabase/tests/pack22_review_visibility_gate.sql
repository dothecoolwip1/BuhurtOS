-- Pack 22 review visibility gate: the REAL Buhurt International import exactly as it stands on hosted until the owner publishes (42 current versions
-- and 37 earlier editions, all in review, nothing published). Added after the 2026-10-06 report of an in-review document showing "not in BuhurtOS yet".
--   * a visitor and a signed-in non-owner read no version and no provision (the documents themselves stay listed);
--   * the platform owner reads every version in review and its provisions, through the same tables and columns the app selects;
--   * every listed document has exactly one current version with provisions; only the three archive folders have none (the only documents for
--     which "the text is not in BuhurtOS yet" is true).
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack22_review_visibility_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c2a01', 'owner@example.test'), ('00000000-0000-0000-0000-0000000c2a02', 'member@example.test');
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000c2a01', 'owner');

-- the import as it stands (nothing published)
select t.expect_eq('nothing is published (current or earlier editions)', (select count(*) from public.ruleset_versions where status not in ('draft', 'in_review'))::int, 0);
select t.expect_eq('42 current versions and 37 earlier editions are in review', (select count(*) filter (where not historical) || '/' || count(*) filter (where historical) from public.ruleset_versions where status = 'in_review'), '42/37');
select t.expect_eq('every listed document has exactly one current version with provisions; only the 3 archive folders have none',
  (select count(*) from public.rulesets r where r.governing_body = 'Buhurt International' and (case when r.source_host = 'drive_folder' then 0 else 1 end) <>
     (select count(*) from public.ruleset_versions v where v.ruleset_id = r.id and not v.historical and exists (select 1 from public.rule_provisions p where p.ruleset_version_id = v.id))
     or (r.source_host = 'drive_folder' and exists (select 1 from public.ruleset_versions v where v.ruleset_id = r.id)))::int, 0);

-- a visitor
select t.as_anon();
select t.expect_eq('visitor: all 45 Buhurt International documents are listed', (select count(*) from public.rulesets where governing_body = 'Buhurt International')::int, 45);
select t.expect_eq('visitor: no version in review', (select count(*) from public.ruleset_versions)::int, 0);
select t.expect_eq('visitor: no provision of a version in review', (select count(*) from public.rule_provisions)::int, 0);

-- a signed-in person who is not the platform owner
select t.as_user('00000000-0000-0000-0000-0000000c2a02');
select t.expect_eq('signed-in non-owner: no version in review', (select count(*) from public.ruleset_versions)::int, 0);
select t.expect_eq('signed-in non-owner: no provision of a version in review', (select count(*) from public.rule_provisions)::int, 0);

-- the platform owner, through the columns the app selects (src/data/rules.ts VER_COLS / PROV_COLS)
select t.as_user('00000000-0000-0000-0000-0000000c2a01');
select t.expect_eq('owner: every version in review (42 current + 37 earlier editions)', (select count(*) from (select id, ruleset_id, version, title, status, published_on, effective_from, effective_to,
  source_url, source_sha256, source_retrieved_at, page_count, import_release, imported_at, published_at, successor_version_id, withdrawn_reason, synthetic, note, historical, edition_seq,
  edition_evidence, source_files from public.ruleset_versions) x)::int, 79);
select t.expect_eq('owner: every provision (1281 current + 1357 earlier editions)', (select count(*) from (select id, ruleset_version_id, parent_id, ordinal, depth, kind, number, title, body,
  page_from, page_to, stable_key, review_status, review_note, keywords, cross_refs, topics, has_figures, extraction from public.rule_provisions) x)::int, 2638);
select t.expect_eq('owner: Duels Rules (Marshal Committee) opens on 26.4, in review, with 56 provisions',
  (select v.version || ' ' || v.status || ' ' || (select count(*) from public.rule_provisions p where p.ruleset_version_id = v.id)
     from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.slug = 'buhurt-international-marshal-duels-rules' and not v.historical), '26.4 in_review 56');
select t.expect_eq('owner: Duels Rules has its 2 earlier editions apart, in review',
  (select count(*) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.slug = 'buhurt-international-marshal-duels-rules' and v.historical and v.status = 'in_review')::int, 2);
select t.expect_eq('owner: an archive folder has no version (nothing to read: "not in BuhurtOS yet" is true there)',
  (select count(*) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.slug = 'buhurt-international-marshal-marshal-archives')::int, 0);

-- and back to a visitor in the same session: nothing carries over
select t.as_anon();
select t.expect_eq('visitor again: still no version and no provision', ((select count(*) from public.ruleset_versions) + (select count(*) from public.rule_provisions))::int, 0);

select t.as_admin();
do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK22 REVIEW VISIBILITY GATE PASSED % checks', n; end $$;
rollback;
