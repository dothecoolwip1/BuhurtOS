-- Local fixture for scripts/e2e/pack22-live.mjs (rules library, discipline citations). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 13 fixture (event "Test stuff test", Field 1 / Field 2, head marshal c1, scorekeepers), plus:
--   * the event is marked as TEST DATA (it may use the invented test rulesets; real events cannot)
--   * the INVENTED example rulesets (rules-library/_example-body, NOT real rules): r1 and r2 imported, then published by the platform owner (a1),
--     so V.1.0 of the example combat rules is superseded by V.1.1, and one provision of V.1.1 carries a recorded correction.
\i scripts/e2e/fixtures/pack13.sql
insert into public.sources (id, kind, title) values ('00000000-0000-0000-0000-00000000a22e', 'imported', 'Pack 22 browser test data');
update public.sources set synthetic = true where id = '00000000-0000-0000-0000-00000000a22e';
insert into public.record_sources (source_id, entity_type, entity_id) values ('00000000-0000-0000-0000-00000000a22e', 'event', '00000000-0000-0000-0000-00000000ed01');
\i supabase/tests/fixtures/pack22_example_r1.sql
\i supabase/tests/fixtures/pack22_example_r2.sql
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.publish_ruleset_version((select v.id from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'marshal/example-combat-rules' and v.version = 'V.1.0'), 'first edition (test)');
select public.publish_ruleset_version((select v.id from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'tournament/example-event-regulations' and v.version = 'V.2.0'));
select public.publish_ruleset_version((select v.id from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'marshal/example-combat-rules' and v.version = 'V.1.1'), 'second edition (test)');
select public.correct_rule_provision((select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where v.version = 'V.1.1' and p.number = '4.1'),
  'Helmet', 'Every fighter wears a helmet that covers the whole head and the neck, closed at the back (test correction).', 'the import dropped the last words (test)');
select set_config('request.jwt.claim.sub', '', false);
