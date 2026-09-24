begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('10000000-0000-0000-0000-000000000001','authenticated','authenticated','admin-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Org A Admin"}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000002','authenticated','authenticated','staff-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Org A Staff"}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000003','authenticated','authenticated','organizer-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Event Organizer"}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000004','authenticated','authenticated','fighter-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Fighter A"}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000005','authenticated','authenticated','revoked-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Revoked User"}',timezone('utc',now()),timezone('utc',now())),
('20000000-0000-0000-0000-000000000001','authenticated','authenticated','admin-b@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Org B Admin"}',timezone('utc',now()),timezone('utc',now())),
('20000000-0000-0000-0000-000000000002','authenticated','authenticated','fighter-b@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Fighter B"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region,status)
values
('10000000-0000-0000-0000-000000000010','Pack Two Org A','P2A','Test A','active'),
('20000000-0000-0000-0000-000000000010','Pack Two Org B','P2B','Test B','active');

insert into public.organization_memberships(organization_id,user_id,role)
values
('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','organization_admin'),
('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','organization_staff'),
('20000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','organization_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status)
values
('10000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000010','2026 A','2026-01-01','2026-12-31','active'),
('20000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000010','2026 B','2026-01-01','2026-12-31','active');

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone,notes,registration_open
) values
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000020','Public A','Arena A','2026-06-01T16:00:00Z','2026-06-01T23:00:00Z','ranked_competitive','season_and_event','published','UTC','PRIVATE EVENT NOTE',true),
('10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000020','Draft A','Private Arena A','2026-07-01T16:00:00Z','2026-07-01T23:00:00Z','ranked_competitive','season_and_event','draft','UTC','DRAFT SECRET',false),
('20000000-0000-0000-0000-000000000030','20000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000020','Draft B','Private Arena B','2026-08-01T16:00:00Z','2026-08-01T23:00:00Z','ranked_competitive','season_and_event','draft','UTC','ORG B SECRET',false);

insert into public.teams(id,organization_id,name,city_or_region,is_active)
values
('10000000-0000-0000-0000-000000000040','10000000-0000-0000-0000-000000000010','Team A','A',true),
('20000000-0000-0000-0000-000000000040','20000000-0000-0000-0000-000000000010','Team B','B',true);

insert into public.fighters(id,organization_id,team_id,user_id,name,is_active)
values
('10000000-0000-0000-0000-000000000050','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000040','10000000-0000-0000-0000-000000000004','Fighter A',true),
('20000000-0000-0000-0000-000000000050','20000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000040','20000000-0000-0000-0000-000000000002','Fighter B',true);

insert into public.event_memberships(event_id,user_id,role,team_id)
values
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000003','event_organizer',null),
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000004','fighter',null),
('10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000005','fighter',null);

insert into public.event_roster_entries(
  id,organization_id,event_id,team_id,fighter_id,entry_type,display_name,checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared,attendance_status,metadata
) values
('10000000-0000-0000-0000-000000000060','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000040','10000000-0000-0000-0000-000000000050','fighter','Fighter A',true,true,true,true,true,'approved','{"private":"medical-ready"}'),
('10000000-0000-0000-0000-000000000061','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000030',null,null,'guest_fighter','Guest A',false,false,false,false,false,'registered','{"private":"guest-metadata"}'),
('10000000-0000-0000-0000-000000000062','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000031',null,null,'guest_fighter','Draft Guest',false,false,false,false,false,'registered','{"private":"draft"}');

set local role anon;
select set_config('request.jwt.claim.sub','',true);

select is(
  (select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000030'),
  1,
  'anonymous spectators can read a published event'
);

select is(
  (select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000031'),
  0,
  'anonymous spectators cannot read a draft event'
);

select throws_ok(
  $$select notes from public.events where id='10000000-0000-0000-0000-000000000030'$$,
  '42501',
  null,
  'anonymous spectators cannot request private event notes directly'
);

select is(
  (select count(*)::integer from public.event_roster_entries where event_id='10000000-0000-0000-0000-000000000030'),
  2,
  'anonymous spectators can read the safe public roster projection'
);

select throws_ok(
  $$select medical_cleared from public.event_roster_entries where event_id='10000000-0000-0000-0000-000000000030'$$,
  '42501',
  null,
  'anonymous spectators cannot request medical clearance directly'
);

select throws_ok(
  $$select * from public.profiles limit 1$$,
  '42501',
  null,
  'anonymous spectators cannot read private account profiles'
);

select throws_ok(
  $$select * from public.organization_memberships limit 1$$,
  '42501',
  null,
  'anonymous spectators cannot read organization access records'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

select is(
  (select count(*)::integer from public.organizations where id='20000000-0000-0000-0000-000000000010'),
  1,
  'organization B administrator can read organization B'
);

select is(
  (select count(*)::integer from public.organizations where id='10000000-0000-0000-0000-000000000010'),
  0,
  'organization B administrator cannot read unrelated organization A'
);

select is(
  (select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000031'),
  0,
  'organization B administrator cannot read organization A draft events'
);

select is(
  (select count(*)::integer from public.event_memberships where event_id='10000000-0000-0000-0000-000000000030'),
  0,
  'organization B administrator cannot read organization A event access records'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);

select is(
  (select count(*)::integer from public.organizations where id='10000000-0000-0000-0000-000000000010'),
  1,
  'ordinary organization staff can read their own organization'
);

select throws_ok(
  $$update public.organizations set region='Escalated' where id='10000000-0000-0000-0000-000000000010'$$,
  '42501',
  null,
  'ordinary organization staff cannot administer their organization'
);

select ok(
  not has_table_privilege('authenticated','public.organization_memberships','INSERT'),
  'authenticated users have no direct organization membership insert privilege'
);

select ok(
  not has_table_privilege('authenticated','public.event_memberships','DELETE'),
  'authenticated users have no direct event membership delete privilege'
);

select throws_ok(
  $$insert into public.organization_memberships(organization_id,user_id,role) values ('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','organization_admin')$$,
  '42501',
  null,
  'direct membership self escalation is blocked'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);

select is(
  (select count(*)::integer from public.event_roster_entries where event_id='10000000-0000-0000-0000-000000000030'),
  1,
  'fighter access only exposes their own authenticated roster row'
);

select is(
  (select count(*)::integer from public.event_roster_entries where id='10000000-0000-0000-0000-000000000061'),
  0,
  'fighter cannot inspect another competitors private roster state'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);

select lives_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000005','field_marshal',null)$$,
  'event organizer can assign a scoped official role'
);

select throws_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000005','event_organizer',null)$$,
  'P0001',
  'Only organization or platform administrators can assign event organizers',
  'event organizer cannot mint another event organizer'
);

select throws_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000003','field_marshal',null)$$,
  'P0001',
  'Event organizers cannot change their own role',
  'event organizer cannot alter their own access'
);

select throws_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000005','team_captain','20000000-0000-0000-0000-000000000040')$$,
  'P0001',
  'Team is not active in this event organization',
  'event organizer cannot attach a captain to another organizations team'
);

select lives_ok(
  $$select public.revoke_event_membership(id) from public.event_memberships where event_id='10000000-0000-0000-0000-000000000030' and user_id='10000000-0000-0000-0000-000000000005' and role='field_marshal'$$,
  'event organizer can revoke a lower scoped official role'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);

select is(
  (select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000031'),
  1,
  'fighter can read a private event while their event membership is active'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000005','event_organizer',null)$$,
  'organization administrator can assign an event organizer'
);

select lives_ok(
  $$select public.assign_organization_role('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000005','organization_staff')$$,
  'organization administrator can assign organization staff'
);

select throws_ok(
  $$select public.assign_organization_role('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000005','organization_admin')$$,
  'P0001',
  'Only a platform super administrator can assign organization administrators',
  'organization administrator cannot create another organization administrator'
);

select throws_ok(
  $select public.assign_organization_role('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','organization_staff')$,
  'P0001',
  'Organization administrators cannot change their own role',
  'organization administrator cannot mutate their own organization roles'
);

select lives_ok(
  $select public.revoke_organization_role('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000005','organization_staff')$,
  'organization administrator can revoke organization staff assigned to another account'
);

select lives_ok(
  $select public.revoke_event_membership(id) from public.event_memberships where event_id='10000000-0000-0000-0000-000000000031' and user_id='10000000-0000-0000-0000-000000000005' and role='fighter'$,
  'organization administrator can revoke a fighter event membership'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);

select is(
  (select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000031'),
  0,
  'revoked fighter immediately loses private event access'
);

select throws_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000005','fighter',null)$$,
  'P0001',
  'Event administrator access required',
  'revoked fighter cannot restore their own event access'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

select is(
  public.claim_first_super_admin(),
  true,
  'fresh database bootstrap can be claimed once'
);

reset role;
delete from public.platform_memberships
where user_id='10000000-0000-0000-0000-000000000001'
  and role='platform_super_admin';

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

select is(
  public.claim_first_super_admin(),
  false,
  'bootstrap does not reopen after the original platform membership is removed'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);

select is(
  (select count(*)::integer from public.organizations),
  0,
  'missing or expired identity context cannot read private organizations'
);

select throws_ok(
  $$select public.assign_event_role('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000005','fighter',null)$$,
  'P0001',
  'Authentication required',
  'missing or expired identity context cannot call privileged role operations'
);

reset role;

select * from finish();
rollback;
