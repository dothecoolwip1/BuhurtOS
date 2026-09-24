begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('10000000-0000-0000-0000-000000000001','authenticated','authenticated','admin-a@buhurtos.test','',timezone('utc',now()),'{}','{}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000002','authenticated','authenticated','member-a@buhurtos.test','',timezone('utc',now()),'{}','{}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000003','authenticated','authenticated','admin-b@buhurtos.test','',timezone('utc',now()),'{}','{}',timezone('utc',now()),timezone('utc',now())),
('10000000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@buhurtos.test','',timezone('utc',now()),'{}','{}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region) values
('10000000-0000-0000-0000-000000000010','Org A','OA','Test'),
('10000000-0000-0000-0000-000000000011','Org B','OB','Test');

insert into public.organization_memberships(organization_id,user_id,role) values
('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','organization_admin'),
('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','organization_staff'),
('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000003','organization_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status) values
('10000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000010','A Season','2026-01-01','2026-12-31','active'),
('10000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000011','B Season','2026-01-01','2026-12-31','active');

insert into public.events(id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone) values
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000020','Private A','Field','2026-06-01','2026-06-02','ranked_competitive','event_only','draft','UTC'),
('10000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000021','Public B','Field','2026-06-01','2026-06-02','ranked_competitive','event_only','published','UTC');

insert into public.event_memberships(event_id,user_id,role) values
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000001','event_organizer'),
('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000002','fighter');

set local role anon;
select is((select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000030'),0,'anonymous cannot read draft event');
select is((select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000031'),1,'anonymous can read published event');
select throws_ok($$select * from public.profiles limit 1$$,'42501',null,'anonymous cannot read private account profiles');
select throws_ok($$insert into public.event_memberships(event_id,user_id,role) values ('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000004','fighter')$$,'42501',null,'anonymous cannot assign event roles');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.organizations where id='10000000-0000-0000-0000-000000000010'),1,'ordinary org member can read own organization');
select is((select count(*)::integer from public.organizations where id='10000000-0000-0000-0000-000000000011'),0,'ordinary member cannot read unrelated organization');
select throws_ok($$insert into public.organization_memberships(organization_id,user_id,role) values ('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','organization_admin')$$,'42501',null,'ordinary member cannot directly self escalate');
select throws_ok($$select public.set_organization_membership('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','organization_admin')$$,'P0001',null,'ordinary member cannot self escalate through RPC');
select throws_ok($$select public.set_event_membership('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000002','event_organizer',null)$$,'P0001',null,'fighter cannot grant event organizer role');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_event_membership('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000004','field_marshal',null)$$,'organization admin can assign an official');
select ok(exists(select 1 from public.event_memberships where event_id='10000000-0000-0000-0000-000000000030' and user_id='10000000-0000-0000-0000-000000000004' and role='field_marshal'),'assigned official membership exists');
select lives_ok($$select public.revoke_event_membership((select id from public.event_memberships where event_id='10000000-0000-0000-0000-000000000030' and user_id='10000000-0000-0000-0000-000000000004' and role='field_marshal'))$$,'organization admin can revoke an official');
select ok(not exists(select 1 from public.event_memberships where event_id='10000000-0000-0000-0000-000000000030' and user_id='10000000-0000-0000-0000-000000000004' and role='field_marshal'),'revoked membership is immediately absent');
select throws_ok($select public.revoke_organization_membership('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001')$,'P0001',null,'last organization admin cannot remove own access');
select throws_ok($select public.set_organization_membership('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','organization_staff')$,'P0001',null,'last organization admin cannot demote own access');
select ok(exists(select 1 from public.audit_log where action='set_event_membership'),'role assignment is audited');
select ok(exists(select 1 from public.audit_log where action='revoke_event_membership'),'role revocation is audited');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is((select count(*)::integer from public.events where id='10000000-0000-0000-0000-000000000030'),0,'admin of unrelated organization cannot read Org A draft event');
select throws_ok($$select public.set_event_membership('10000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000003','field_marshal',null)$$,'P0001',null,'admin of unrelated organization cannot assign Org A event roles');

select * from finish();
rollback;
