begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('00000000-0000-0000-0000-000000000001','authenticated','authenticated','admin@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack One Admin"}',timezone('utc',now()),timezone('utc',now())),
('00000000-0000-0000-0000-000000000002','authenticated','authenticated','outsider@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Outsider"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region)
values ('00000000-0000-0000-0000-000000000010','Pack One Org','P1','Test');

insert into public.organization_memberships(organization_id,user_id,role)
values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','organization_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status)
values ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','2026 Test','2026-01-01','2026-12-31','active');

insert into public.events(id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone)
values ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','Pack One Event','Test Field','2026-06-01T16:00:00Z','2026-06-01T23:00:00Z','ranked_competitive','season_and_event','draft','UTC');

insert into public.event_roster_entries(id,organization_id,event_id,entry_type,display_name,attendance_status)
values
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000030','ghost_fighter','Ghost One','registered'),
('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000030','guest_fighter','Guest Two','registered');

insert into public.clubs(id,organization_id,name)
values ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000010','Test Club');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);

select is(
  (select count(*)::integer from public.clubs where organization_id='00000000-0000-0000-0000-000000000010'),
  1,
  'organization admin can read own clubs'
);

select lives_ok(
  $$insert into public.clubs(organization_id,name) values ('00000000-0000-0000-0000-000000000010','Admin Created Club')$$,
  'organization admin can create a club'
);

create temp table claimed(label text primary key, fighter_id uuid);
insert into claimed values
('one', public.claim_temporary_fighter('00000000-0000-0000-0000-000000000041',null,'Ghost One')),
('two', public.claim_temporary_fighter('00000000-0000-0000-0000-000000000042',null,'Guest Two'));

select is(
  (select entry_type::text from public.event_roster_entries where id='00000000-0000-0000-0000-000000000041'),
  'fighter',
  'claim converts ghost roster entry into fighter entry'
);

select ok(
  (select fighter_id is not null from public.event_roster_entries where id='00000000-0000-0000-0000-000000000041'),
  'claim links roster entry to a permanent fighter'
);

select is(
  (select id from public.event_roster_entries where id='00000000-0000-0000-0000-000000000041'),
  '00000000-0000-0000-0000-000000000041'::uuid,
  'claim preserves the historical roster entry id'
);

do $$
declare
  canonical_id uuid;
  duplicate_id uuid;
begin
  select fighter_id into canonical_id from claimed where label='one';
  select fighter_id into duplicate_id from claimed where label='two';
  perform public.merge_fighters(canonical_id,duplicate_id);
end;
$$;

select is(
  (select fighter_id from public.event_roster_entries where id='00000000-0000-0000-0000-000000000042'),
  (select fighter_id from claimed where label='one'),
  'merge rewires duplicate roster references to canonical fighter'
);

select ok(
  (select deleted_at is not null and merged_into_fighter_id=(select fighter_id from claimed where label='one')
   from public.fighters where id=(select fighter_id from claimed where label='two')),
  'merge soft deletes duplicate fighter and records canonical target'
);

select ok(
  exists(select 1 from public.audit_log where action='claim_temporary_fighter'),
  'temporary fighter claim is audited'
);

select ok(
  exists(select 1 from public.audit_log where action='merge_fighter'),
  'fighter merge is audited'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);

select is(
  (select count(*)::integer from public.clubs where organization_id='00000000-0000-0000-0000-000000000010'),
  0,
  'unrelated authenticated user cannot read another organizations clubs'
);

select throws_ok(
  $$insert into public.clubs(organization_id,name) values ('00000000-0000-0000-0000-000000000010','Unauthorized Club')$$,
  '42501',
  null,
  'unrelated authenticated user cannot create a club'
);

reset role;
set local role anon;
select is(
  (select count(*)::integer from public.competition_divisions where organization_id='00000000-0000-0000-0000-000000000010'),
  0,
  'anonymous users do not see unpublished organization divisions'
);

select throws_ok(
  $$insert into public.competition_divisions(organization_id,name,slug,competition_format_id,status) values ('00000000-0000-0000-0000-000000000010','Bad','bad','longsword','draft')$$,
  '42501',
  null,
  'anonymous users cannot insert divisions'
);

select * from finish();
rollback;
