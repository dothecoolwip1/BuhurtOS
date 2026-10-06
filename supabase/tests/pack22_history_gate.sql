-- Pack 22 historical editions gate (migrations 20261015000800 and 20261015000900).
--   * the archive history is loaded as HISTORICAL versions in review: 37 editions of 25 documents, provenance kept, byte-identical files once
--   * the current 2026-10-06 release is unchanged (fingerprint of its 42 content hashes), and stays the current version after history is added
--   * a historical edition can never become the version in force; it is published only as historical, by the owner, after review
--   * nobody but the owner sees editions in review; published editions read as earlier editions; current citations still resolve
--   * duplicates are refused (same file, same text), the current importer never touches a historical edition and vice versa; re-loading is a no-op
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack22_history_gate.sql

begin;
create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_error(label text, stmt text, state text default null) returns void language plpgsql as $$
declare ok boolean := false; got text;
begin
  begin execute stmt; exception when others then ok := true; got := sqlstate; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  if state is not null and got <> state then raise exception 'FAIL (wrong error % instead of %): %', got, state, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad('d7' || n, 12, '0'))::uuid $$;
create function t.v(doc text, label text) returns uuid language sql stable security definer as $$
  select v.id from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and r.inventory_key = doc and v.version = label $$;
create function t.p(doc text, label text, key text) returns uuid language sql stable security definer as $$ select id from public.rule_provisions where ruleset_version_id = t.v(doc, label) and stable_key = key $$;
-- the current release, as the database holds it: one fingerprint of every current version's document, label and content hash
create function t.current_fingerprint() returns text language sql stable security definer as $$
  select md5(string_agg(r.inventory_key || '=' || v.version || '=' || v.content_sha256, ',' order by r.inventory_key))
    from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and not v.historical $$;
create function t.current_rows() returns text language sql stable security definer as $$
  select md5(string_agg(p.id::text || p.content_sha256 || p.review_status || v.status, ',' order by p.id))
    from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where not v.historical $$;
grant usage on schema t to anon, authenticated, service_role;
grant all on t.log to anon, authenticated, service_role;
grant usage on all sequences in schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

insert into auth.users (id, email) select t.u(n), 'p22h' || n || '@example.test' from generate_series(1, 3) n;
insert into public.platform_roles (user_id, role) values (t.u(1), 'owner');   -- u1 platform owner; u2 a signed-in stranger

-- ---------------------------------------------------------------- 1. what the archive history loaded
select t.expect_eq('history: 37 historical editions of 25 documents, all in review, from history archive-2026-10-06, none synthetic',
  (select count(*) || '/' || count(distinct ruleset_id) || '/' || count(*) filter (where status = 'in_review' and import_release = 'archive-2026-10-06' and not synthetic) from public.ruleset_versions where historical), '37/25/37');
select t.expect_eq('history: 1357 provisions in the historical editions', (select count(*) from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where v.historical)::int, 1357);
select t.expect_eq('history: every edition carries its order, its evidence and its archive files with SHA-256',
  (select count(*) from public.ruleset_versions where historical and edition_seq >= 1 and char_length(edition_evidence) >= 20 and jsonb_array_length(source_files) >= 1
     and not exists (select 1 from jsonb_array_elements(source_files) f where f ->> 'sha256' !~ '^[0-9a-f]{64}$' or coalesce(f ->> 'file', '') !~ '/Archive/'))::int, 37);
select t.expect_eq('history: the 42 archive files are 41 in editions (4 byte-identical pairs share one edition each) + 1 held, never imported',
  (select sum(jsonb_array_length(source_files)) || '/' || count(*) filter (where jsonb_array_length(source_files) = 2) from public.ruleset_versions where historical), '41/4');
select t.expect_eq('history: both file names of a byte-identical pair are kept as provenance of one edition (Duels Regulations V2024.12)',
  (select string_agg(f ->> 'file', ' + ' order by f ->> 'file') || ' | ' || count(distinct f ->> 'sha256') from public.ruleset_versions v, jsonb_array_elements(v.source_files) f where v.id = t.v('tournament/duel-regulations', '2024.12')),
  'Tournament/Archive/Duels Regulations V2024.12(1).pdf + Tournament/Archive/Duels Regulations V2024.12.pdf | 1');
select t.expect_eq('history: the held one-sheet shields export is not an edition (its file is in no version)',
  (select count(*) from public.ruleset_versions v, jsonb_array_elements(coalesce(v.source_files, '[]')) f where f ->> 'file' like '%Shields 2025.3%')::int, 0);
select t.expect_eq('history: no two versions of a document share a text or a file',
  (select count(*) from (select ruleset_id, content_sha256 from public.ruleset_versions group by 1, 2 having count(*) > 1) x)::int
  + (select count(*) from (select ruleset_id, source_sha256 from public.ruleset_versions where source_sha256 is not null group by 1, 2 having count(*) > 1) y)::int, 0);
select t.expect_eq('history: Duel Regulations has three earlier editions in evidence order (2024.12, 2025.03, 26.1), and its current version is still 26.4',
  (select string_agg(v.version, ',' order by v.edition_seq) from public.ruleset_versions v where v.ruleset_id = (select ruleset_id from public.ruleset_versions where id = t.v('tournament/duel-regulations', '26.4')) and v.historical)
  || ' | ' || (select string_agg(v.version, ',') from public.ruleset_versions v where v.ruleset_id = (select ruleset_id from public.ruleset_versions where id = t.v('tournament/duel-regulations', '26.4')) and not v.historical),
  '2024.12,2025.03,26.1 | 26.4');
select t.expect_eq('history: an earlier name is recorded as evidence, not guessed (Side-hinged visored Bascinets → Side-pivoting visored Bascinets)',
  (select edition_evidence ~ 'Replace throughout the document Side-hinged visored Bascinets by Side-pivoting visored Bascinets' from public.ruleset_versions where id = t.v('authenticity/side-pivoting-visored-bascinets', '2025.01')), true);
select t.expect_eq('history: a cover/change-log disagreement is recorded on the edition, not smoothed over (Duel Regulations 2025.03)',
  (select note ~ 'the label is the cover''s, the disagreement is recorded' from public.ruleset_versions where id = t.v('tournament/duel-regulations', '2025.03')), true);
select t.expect_eq('history: stable keys line up with the current version (Duel Regulations 5.2 exists in 2024.12 and 26.4)',
  (t.p('tournament/duel-regulations', '2024.12', 'duel-regulations:5.2') is not null and t.p('tournament/duel-regulations', '26.4', 'duel-regulations:5.2') is not null), true);

-- ---------------------------------------------------------------- 2. the current release did not change
select t.expect_eq('current: the 2026-10-06 release is exactly the committed one (42 versions, fingerprint of document = label = content hash)',
  (select count(*) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and not v.historical and v.import_release = '2026-10-06')::int || '/' || t.current_fingerprint(),
  '42/2ee64069ffe03f4d73876825ec7d32a8');
select t.expect_eq('current: still 1281 provisions, none of them historical', (select count(*) from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and not v.historical)::int, 1281);
select t.expect_eq('current: the recorded conflicts still point only at current versions', (select count(*) || '/' || count(*) filter (where c.status = 'open') from public.rule_conflicts c join public.ruleset_versions a on a.id = c.version_a join public.ruleset_versions b on b.id = c.version_b where not a.historical and not b.historical and c.governing_body = 'Buhurt International'), '3/3');
create temp table snap as select t.current_rows() as rows, t.current_fingerprint() as fp;
\i supabase/migrations/20261015000900_rules_bi_history_archive_2026_10_06.sql
select t.expect_eq('reload: loading the history again changes nothing (no new import, current rows identical)',
  (select count(*) from public.audit_log where action = 'rules.historical_version_imported')::int || '/' || (t.current_rows() = (select rows from snap))::text, '37/true');

-- ---------------------------------------------------------------- 3. the two importers never cross
select t.expect_error('the current importer refuses a historical payload', $$select private.rules_import_version('{"governing_body":"Buhurt International","inventory_key":"tournament/duel-regulations","version":{"version":"x1","historical":true,"content_sha256":"0000000000000000000000000000000000000000000000000000000000000000"},"provisions":[]}'::jsonb)$$, '22023');
select t.expect_error('the current importer never replaces a historical edition (same label)', $$select private.rules_import_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','release','x',
  'version', jsonb_build_object('version','2024.12','content_sha256',repeat('1',64),'source_sha256',repeat('1',64),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, 'P0001');
select t.expect_error('the historical importer never touches a current version (same label as 26.4)', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','history','x',
  'version', jsonb_build_object('version','26.4','historical',true,'edition_seq',9,'edition_evidence','an attempt to replace the current version','content_sha256',repeat('2',64),'source_sha256',repeat('2',64),
  'source_files',jsonb_build_array(jsonb_build_object('file','Tournament/Archive/x.pdf','sha256',repeat('2',64))),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, 'P0001');
select t.expect_error('the same text as another version is refused (one edition is one version)', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','history','x',
  'version', jsonb_build_object('version','2099.1','historical',true,'edition_seq',9,'edition_evidence','a copy of the 2025.03 text under another label','content_sha256',(select content_sha256 from public.ruleset_versions where id = t.v('tournament/duel-regulations','2025.03')),'source_sha256',repeat('3',64),
  'source_files',jsonb_build_array(jsonb_build_object('file','Tournament/Archive/y.pdf','sha256',repeat('3',64))),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, 'P0001');
select t.expect_error('the same file as another edition is refused', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','history','x',
  'version', jsonb_build_object('version','2099.2','historical',true,'edition_seq',9,'edition_evidence','the 2024.12 file again under another label','content_sha256',repeat('4',64),'source_sha256',(select source_sha256 from public.ruleset_versions where id = t.v('tournament/duel-regulations','2024.12')),
  'source_files',jsonb_build_array(jsonb_build_object('file','Tournament/Archive/z.pdf','sha256',repeat('4',64))),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, 'P0001');
select t.expect_error('an edition without its archive files is refused', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','history','x',
  'version', jsonb_build_object('version','2099.3','historical',true,'edition_seq',9,'edition_evidence','no provenance given for this edition','content_sha256',repeat('5',64),'source_sha256',repeat('5',64),'source_files','[]'::jsonb,'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, '22023');
select t.expect_error('the order of editions is unique per document', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/duel-regulations','history','x',
  'version', jsonb_build_object('version','2099.4','historical',true,'edition_seq',1,'edition_evidence','claims to be the oldest edition as well','content_sha256',repeat('6',64),'source_sha256',repeat('6',64),
  'source_files',jsonb_build_array(jsonb_build_object('file','Tournament/Archive/w.pdf','sha256',repeat('6',64))),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$);
select t.expect_eq('nothing above changed the current release', t.current_fingerprint(), '2ee64069ffe03f4d73876825ec7d32a8');

-- ---------------------------------------------------------------- 4. reading: in review is the owner's only
select t.as_anon();
select t.expect_eq('anon: no historical edition is visible while in review, nor its text', (select count(*) from public.ruleset_versions where historical)::int + (select count(*) from public.rule_provisions where ruleset_version_id = t.v('tournament/duel-regulations', '2024.12'))::int, 0);
select t.as_user(t.u(2));
select t.expect_eq('a signed-in stranger: none either', (select count(*) from public.ruleset_versions where historical)::int, 0);
select t.as_user(t.u(1));
select t.expect_eq('the owner sees the 37 editions in review, with their order and provenance', (select count(*) from public.ruleset_versions where historical and edition_seq is not null and source_files is not null)::int, 37);
select t.as_admin();
select t.expect_eq('the API reads the new columns but still not who published', (select has_column_privilege('anon', 'public.ruleset_versions', 'historical', 'select') and has_column_privilege('anon', 'public.ruleset_versions', 'source_files', 'select')
  and not has_column_privilege('anon', 'public.ruleset_versions', 'published_by', 'select')), true);

-- ---------------------------------------------------------------- 5. publishing: the current version stays current
select t.as_user(t.u(1));
select public.publish_ruleset_version(t.v('tournament/duel-regulations', '26.4'), 'current, for the gate');
select t.as_admin();
select t.expect_error('a historical edition can never be published as the version in force', $$select t.as_user(t.u(1)); select public.publish_ruleset_version(t.v('tournament/duel-regulations', '26.1'), 'wrong path')$$, 'P0001');
select t.as_admin();
select t.expect_error('nor moved there directly by the owner''s table access', $$select t.as_user(t.u(1)); update public.ruleset_versions set status = 'published', published_at = now() where id = t.v('tournament/duel-regulations', '26.1')$$, 'P0001');
select t.as_admin();
select t.expect_error('a version cannot be turned into a historical one (or back)', $$update public.ruleset_versions set historical = true, edition_seq = 99, source_files = '[{"file":"x","sha256":"x"}]' where id = t.v('tournament/duel-regulations', '26.4')$$, 'P0001');
select t.expect_error('a stranger cannot publish a historical edition', $$select t.as_user(t.u(2)); select public.publish_historical_version(t.v('tournament/duel-regulations', '2024.12'), 'no')$$, '42501');
select t.as_admin();
select t.expect_error('a current version is not published through the historical path', $$select t.as_user(t.u(1)); select public.publish_historical_version(t.v('tournament/buhurt-regulations', '26.4'), 'no')$$, 'P0001');
select t.as_admin();
select t.expect_error('an edition with provisions still to check cannot be published (Duel Regulations 2024.12 has open items)', $$select t.as_user(t.u(1)); select public.publish_historical_version(t.v('tournament/duel-regulations', '2024.12'), 'too early')$$, 'P0001');
select t.as_admin();
select t.as_user(t.u(1));
select t.expect_eq('the owner publishes a reviewed edition AS HISTORICAL (Tournament Structure 2024.06, nothing open): it points at the current version',
  (public.publish_historical_version(t.v('tournament/tournament-structure', '2024.06'), 'gate') ->> 'next')::uuid = t.v('tournament/tournament-structure', 'January 2026'), true);
select t.expect_eq('… and an older edition points at the next edition, not the current one (Buhurt Rules 2024.12.13 → 2026.1.1)',
  (public.publish_historical_version(t.v('marshal/buhurt-rules', '2024.12.13'), 'gate') ->> 'next')::uuid = t.v('marshal/buhurt-rules', '2026.1.1'), true);
select t.as_admin();
select t.expect_eq('published historical editions read as older versions (superseded, historical), audited',
  (select string_agg(status, ',' order by version) from public.ruleset_versions where id in (t.v('tournament/tournament-structure', '2024.06'), t.v('marshal/buhurt-rules', '2024.12.13')))
  || '/' || (select count(*) from public.audit_log where action = 'rules.historical_version_published'), 'superseded,superseded/2');
select t.expect_eq('the version in force did not change: Duel Regulations 26.4 is still the only published version of its document',
  (select string_agg(version, ',') from public.ruleset_versions where ruleset_id = (select ruleset_id from public.ruleset_versions where id = t.v('tournament/duel-regulations', '26.4')) and status = 'published'), '26.4');
select t.expect_eq('publishing history changed no current version or provision', (select t.current_fingerprint()) || '/' || (select count(*) from public.ruleset_versions where not historical and status = 'superseded'), '2ee64069ffe03f4d73876825ec7d32a8/0');
select t.as_anon();
select t.expect_eq('anon now reads the published earlier edition, marked historical, with its text; the others stay hidden',
  (select count(*) || '/' || bool_and(historical) from public.ruleset_versions where historical) || '/' || (select count(*) > 0 from public.rule_provisions where ruleset_version_id = t.v('tournament/tournament-structure', '2024.06'))::text, '2/true/true');
select t.as_admin();
select t.expect_error('published historical text is frozen like any published text', $$update public.rule_provisions set body = 'rewritten' where ruleset_version_id = t.v('tournament/tournament-structure', '2024.06') and body <> ''$$, 'P0001');
select t.expect_error('a published edition is never re-imported over', $$select private.rules_import_historical_version(jsonb_build_object('governing_body','Buhurt International','inventory_key','tournament/tournament-structure','history','x',
  'version', jsonb_build_object('version','2024.06','historical',true,'edition_seq',1,'edition_evidence','re-import over a published edition','content_sha256',repeat('7',64),'source_sha256',repeat('7',64),
  'source_files',jsonb_build_array(jsonb_build_object('file','Tournament/Archive/q.pdf','sha256',repeat('7',64))),'reconciliation',jsonb_build_object('ok',true,'provisions',0)),'provisions','[]'::jsonb))$$, 'P0001');

-- ---------------------------------------------------------------- 6. citations
select t.expect_error('a rule from an edition still in review cannot be cited', $$select private.check_cited_provision(t.p('tournament/duel-regulations', '2024.12', 'duel-regulations:5.2'), null)$$, '22023');
select t.expect_eq('a current rule is cited from the current version, as before', private.check_cited_provision(t.p('tournament/duel-regulations', '26.4', 'duel-regulations:5.2'), null), t.v('tournament/duel-regulations', '26.4'));
-- a cited rule in the discipline log says when it is from an earlier edition
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-0000000e7e01', 'p22h-e1', 'History Open', 'published', current_date, current_date);
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values ('00000000-0000-0000-0000-0000000c7c01', '00000000-0000-0000-0000-0000000e7e01', 'Longsword', 'longsword', 'women', 'Classic', 'round_robin', 1);
insert into public.fighters (id, display_name, gender, disciplines) values ('00000000-0000-0000-0000-0000000f7f01', 'H One', 'female', '{}'), ('00000000-0000-0000-0000-0000000f7f02', 'H Two', 'female', '{}');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-0000000e7d01', '00000000-0000-0000-0000-0000000c7c01', '00000000-0000-0000-0000-0000000f7f01'), ('00000000-0000-0000-0000-0000000e7d02', '00000000-0000-0000-0000-0000000c7c01', '00000000-0000-0000-0000-0000000f7f02');
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state) values ('00000000-0000-0000-0000-0000000a7a01', '00000000-0000-0000-0000-0000000c7c01', 'round_robin', 'Round 1', 0, '00000000-0000-0000-0000-0000000e7d01', '00000000-0000-0000-0000-0000000e7d02', 'active');
insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label) values
  ('00000000-0000-0000-0000-0000000b7b01', '00000000-0000-0000-0000-0000000a7a01', '00000000-0000-0000-0000-0000000e7e01', 1, 'a', 'warning', null),
  ('00000000-0000-0000-0000-0000000b7b02', '00000000-0000-0000-0000-0000000a7a01', '00000000-0000-0000-0000-0000000e7e01', 1, 'b', 'warning', null);
insert into public.match_discipline_private (discipline_id, reason, called_by, recorded_by) values ('00000000-0000-0000-0000-0000000b7b01', 'gate', 'KM', t.u(1)), ('00000000-0000-0000-0000-0000000b7b02', 'gate', 'KM', t.u(1));
insert into public.match_discipline_rules (id, event_id, discipline_id, provision_id, set_by) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e7e01', '00000000-0000-0000-0000-0000000b7b01', t.p('marshal/buhurt-rules', '2024.12.13', (select stable_key from public.rule_provisions where ruleset_version_id = t.v('marshal/buhurt-rules', '2024.12.13') and number is not null order by ordinal limit 1)), t.u(1)),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e7e01', '00000000-0000-0000-0000-0000000b7b02', t.p('tournament/duel-regulations', '26.4', 'duel-regulations:5.2'), t.u(1));
select t.as_user(t.u(1));
select t.expect_eq('the discipline log names a cited historical rule as an earlier edition, and a current one as current',
  (select string_agg((x ->> 'rule_version') || ':' || (x ->> 'rule_version_historical'), ',' order by x ->> 'rule_version') from jsonb_array_elements(public.event_discipline_log('00000000-0000-0000-0000-0000000e7e01')) x),
  '2024.12.13:true,26.4:false');
select t.as_admin();

-- ---------------------------------------------------------------- 7. privileges
select t.expect_eq('the historical importer is executable by neither anon nor authenticated; publishing history is not executable by anon',
  (has_function_privilege('anon', 'private.rules_import_historical_version(jsonb)', 'execute') or has_function_privilege('authenticated', 'private.rules_import_historical_version(jsonb)', 'execute')
   or has_function_privilege('anon', 'public.publish_historical_version(uuid,text)', 'execute')), false);
select t.expect_eq('the new functions pin an empty search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('rules_import_historical_version', 'publish_historical_version', 'ruleset_version_guard', 'rules_import_version')
     and not (coalesce(p.proconfig, '{}') @> array['search_path=""']))::int, 0);

do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'PACK22 HISTORY GATE PASSED % checks', n; end $$;
rollback;
