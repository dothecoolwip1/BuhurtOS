begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','clubs','clubs table exists');
select has_table('public','fighter_affiliations','fighter affiliation history exists');
select has_table('public','fighter_profile_claims','profile claim workflow exists');
select has_table('public','role_definitions','normalized role definitions exist');
select has_table('public','sync_operations','idempotency operation ledger exists');
select has_table('public','event_ruleset_snapshots','event ruleset snapshots exist');
select has_table('public','season_ruleset_snapshots','season ruleset snapshots exist');

select ok((select relrowsecurity from pg_class where oid='public.fighter_private_details'::regclass),'private fighter details have RLS');
select ok((select relrowsecurity from pg_class where oid='public.access_grants'::regclass),'access grants have RLS');
select ok((select relrowsecurity from pg_class where oid='public.account_invitations'::regclass),'account invitations have RLS');
select ok((select relrowsecurity from pg_class where oid='public.sync_operations'::regclass),'sync operation ledger has RLS');

insert into public.organizations(id,name,short_name,slug,region,status)
values('10000000-0000-4000-8000-000000000001','Test Organization','TEST','test','Test Region','active');

insert into public.rulesets(id,organization_id,name,short_name,version,status,settings)
values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Base','BASE','1.0','draft',
 '{"timing":{"rounds":3,"overtimeEnabled":false},"compliance":{"requireCheckIn":true,"requireArmorClearance":true,"requireMedicalClearance":true,"requireWaiver":true,"requireWeighIn":true}}'::jsonb),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Child','CHILD','1.0','draft',
 '{"timing":{"rounds":5},"compliance":{"requireWeighIn":false}}'::jsonb);

update public.rulesets
set parent_ruleset_id='20000000-0000-4000-8000-000000000001'
where id='20000000-0000-4000-8000-000000000002';

select is(
  private.resolve_ruleset_settings('20000000-0000-4000-8000-000000000002')->'timing'->>'rounds',
  '5',
  'child ruleset overrides parent timing'
);
select is(
  private.resolve_ruleset_settings('20000000-0000-4000-8000-000000000002')->'timing'->>'overtimeEnabled',
  'false',
  'child ruleset inherits parent nested values'
);
select is(
  private.resolve_ruleset_settings('20000000-0000-4000-8000-000000000002')->'compliance'->>'requireWeighIn',
  'false',
  'child ruleset overrides parent compliance'
);
select throws_ok(
  $$update public.rulesets set parent_ruleset_id='20000000-0000-4000-8000-000000000002' where id='20000000-0000-4000-8000-000000000001'$$,
  'Ruleset inheritance cycle detected',
  'ruleset cycles are rejected'
);

update public.rulesets set status='published' where id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
select throws_ok(
  $$update public.rulesets set settings='{"timing":{"rounds":99}}'::jsonb where id='20000000-0000-4000-8000-000000000002'$$,
  'Published rulesets are immutable. Create a new version instead',
  'published rulesets cannot be rewritten'
);

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status,ruleset_id)
values(
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '2026 Test Season','2026-01-01','2026-12-31','draft',
  '20000000-0000-4000-8000-000000000002'
);
update public.seasons set status='archived' where id='30000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.season_ruleset_snapshots where season_id='30000000-0000-4000-8000-000000000001'),
  1,
  'archiving a season captures historical ruleset settings'
);

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone,ruleset_id
)
values(
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Test Event','Test Venue','2026-06-01 09:00+00','2026-06-01 18:00+00',
  'ranked_competitive','season_and_event','draft','UTC',
  '20000000-0000-4000-8000-000000000002'
);
update public.events set status='published' where id='40000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.event_ruleset_snapshots where event_id='40000000-0000-4000-8000-000000000001'),
  1,
  'publishing an event captures the effective ruleset'
);
update public.events set status='draft' where id='40000000-0000-4000-8000-000000000001';

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values
(
  '50000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','admin@buhurtos.test','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
  '50000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','viewer@buhurtos.test','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.platform_memberships(user_id,role)
values('50000000-0000-4000-8000-000000000001','platform_super_admin');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok(
  $$select public.create_temporary_fighter_for_event('40000000-0000-4000-8000-000000000001','Unauthorized Fighter','CA',null,null)$$,
  'Not authorized to create temporary fighters',
  'unauthorized authenticated users cannot create temporary fighters'
);
select is(
  (select count(*)::integer from public.event_roster_entries where event_id='40000000-0000-4000-8000-000000000001'),
  0,
  'draft private roster does not leak through RLS'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok(
  $$select public.create_temporary_fighter_for_event('40000000-0000-4000-8000-000000000001','Temporary Fighter','CA',null,null)$$,
  'authorized admin can create temporary fighter and roster identity transactionally'
);
select is(
  (select count(*)::integer from public.fighters where organization_id='10000000-0000-4000-8000-000000000001' and is_temporary),
  1,
  'temporary fighter identity is persisted'
);
select is(
  (select count(*)::integer from public.event_roster_entries where event_id='40000000-0000-4000-8000-000000000001'),
  1,
  'temporary fighter receives event roster entry'
);

reset role;
insert into public.fighters(id,organization_id,name,is_temporary,preferred_weapons)
values
('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Duplicate Source',true,'{}'),
('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Permanent Target',false,'{}');

insert into public.event_roster_entries(
  id,organization_id,event_id,fighter_id,entry_type,display_name,attendance_status
)
values(
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'ghost_fighter','Duplicate Source','registered'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok(
  $$select public.merge_identity_records('fighter','60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','duplicate test')$$,
  'authorized fighter merge succeeds'
);
reset role;

select is(
  (select fighter_id from public.event_roster_entries where id='70000000-0000-4000-8000-000000000001'),
  '60000000-0000-4000-8000-000000000002'::uuid,
  'fighter merge migrates roster relationships'
);
select is(
  (select merged_into_id from public.fighters where id='60000000-0000-4000-8000-000000000001'),
  '60000000-0000-4000-8000-000000000002'::uuid,
  'fighter merge preserves soft-retired source identity'
);
select is(
  (select count(*)::integer from public.entity_merges where source_id='60000000-0000-4000-8000-000000000001'),
  1,
  'fighter merge creates an audit merge record'
);

select * from finish();
rollback;
