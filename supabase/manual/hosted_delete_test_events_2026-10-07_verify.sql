-- READ-ONLY check after supabase/manual/hosted_delete_test_events_2026-10-07.sql has been run on hosted. Changes nothing. Every row should say ok = true.
with ids(id) as (values ('feec4fde-ea8c-4eaa-86f2-9538b5c61785'::uuid), ('1acb67d3-db5f-40a5-bce7-682e0aa6edb3'::uuid)),
checks(check_name, ok, detail) as (
  select 'both test events gone (by id and slug)', not exists (select 1 from public.events where id in (select id from ids) or slug in ('test-stuff-test', 'test-new-test')), null::text
  union all select 'no competitions, staff, registrations, Lyst, discipline, proposals or waivers left',
    (select count(*) from public.competitions where event_id in (select id from ids)) + (select count(*) from public.event_staff where event_id in (select id from ids))
    + (select count(*) from public.registrations where event_id in (select id from ids)) + (select count(*) from public.registration_inspections where event_id in (select id from ids))
    + (select count(*) from public.lyst_rounds where event_id in (select id from ids)) + (select count(*) from public.lyst_matches where event_id in (select id from ids))
    + (select count(*) from public.lyst_timer where event_id in (select id from ids)) + (select count(*) from public.match_discipline where event_id in (select id from ids))
    + (select count(*) from public.result_proposals where event_id in (select id from ids)) + (select count(*) from public.waiver_versions where event_id in (select id from ids))
    + (select count(*) from public.event_invitations where event_id in (select id from ids)) + (select count(*) from public.event_announcements where event_id in (select id from ids))
    + (select count(*) from public.event_sponsors where event_id in (select id from ids)) = 0, null
  union all select 'no matches, entries, results, revisions or scores without a competition',
    (select count(*) from public.matches m where not exists (select 1 from public.competitions c where c.id = m.competition_id))
    + (select count(*) from public.entries e where not exists (select 1 from public.competitions c where c.id = e.competition_id))
    + (select count(*) from public.result_revisions r where not exists (select 1 from public.competitions c where c.id = r.competition_id))
    + (select count(*) from public.score_events s where not exists (select 1 from public.matches m where m.id = s.match_id))
    + (select count(*) from public.lyst_round_revisions s where not exists (select 1 from public.matches m where m.id = s.match_id)) = 0, null
  union all select 'no audit rows of the test events', not exists (select 1 from public.audit_log where event_id in (select id from ids)), null
  union all select 'no notification names the test slugs', not exists (select 1 from public.notifications where payload ->> 'event_slug' in ('test-stuff-test', 'test-new-test')), null
  union all select 'Garrett, Odin, Taylor and Bjorn Robson remain', (select count(*) from public.fighters where id in ('7c848b31-39db-453c-b2c4-7fa84982620f',
    'f847b3c6-db5b-4a0b-bad2-bc9a4a8e0b38', '9c9f5faa-687c-4035-b269-2d0d36774756', 'd2a3cda7-8ba1-4bff-8850-6a3c2eba4619')) = 4, null
  union all select 'Red Deer Reavers remains, with Bjorn''s membership', exists (select 1 from public.teams where id = 'a87fcf7c-c3a3-4fb6-b373-9c0b61676d68')
    and exists (select 1 from public.team_memberships where team_id = 'a87fcf7c-c3a3-4fb6-b373-9c0b61676d68' and fighter_id = 'd2a3cda7-8ba1-4bff-8850-6a3c2eba4619'), null
  union all select 'the organization remains', exists (select 1 from public.organizations where id = 'cbaf08ce-0317-4179-99a5-f3ad2cc7e7d0'), null
  union all select 'the four bypassed triggers are enabled', (select count(*) from pg_trigger where tgenabled = 'O' and (tgrelid, tgname) in (
    ('public.result_revisions'::regclass, 'result_revisions_no_change'), ('public.lyst_round_revisions'::regclass, 'lyst_round_revisions_no_change'),
    ('public.match_discipline'::regclass, 'match_discipline_guard'), ('public.registration_inspections'::regclass, 'registration_inspections_append_only'))) = 4, null
  union all select 'no trigger in public/private is disabled', not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'private') and t.tgenabled <> 'O'), null
)
select * from checks;
