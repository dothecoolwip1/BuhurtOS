begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('44000000-0000-0000-0000-000000000001','authenticated','authenticated','mega4-admin@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Mega 4 Org Admin"}',timezone('utc',now()),timezone('utc',now())),
('44000000-0000-0000-0000-000000000002','authenticated','authenticated','mega4-organizer@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Mega 4 Organizer"}',timezone('utc',now()),timezone('utc',now())),
('44000000-0000-0000-0000-000000000003','authenticated','authenticated','mega4-marshal@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Mega 4 Marshal"}',timezone('utc',now()),timezone('utc',now())),
('45000000-0000-0000-0000-000000000001','authenticated','authenticated','mega4-other@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Mega 4 Other Admin"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region,status)
values
('44000000-0000-0000-0000-000000000010','Mega Four Org','M4','Test','active'),
('45000000-0000-0000-0000-000000000010','Mega Four Other','M4O','Other','active');

insert into public.organization_memberships(organization_id,user_id,role)
values
('44000000-0000-0000-0000-000000000010','44000000-0000-0000-0000-000000000001','organization_admin'),
('45000000-0000-0000-0000-000000000010','45000000-0000-0000-0000-000000000001','organization_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status)
values
('44000000-0000-0000-0000-000000000020','44000000-0000-0000-0000-000000000010','2026','2026-01-01','2026-12-31','active'),
('45000000-0000-0000-0000-000000000020','45000000-0000-0000-0000-000000000010','2026','2026-01-01','2026-12-31','active');

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,
  standings_mode,status,timezone,registration_open,registration_fee_cents
) values
('44000000-0000-0000-0000-000000000030','44000000-0000-0000-0000-000000000010','44000000-0000-0000-0000-000000000020','Mega Four Event','Arena','2026-10-01T15:00:00Z','2026-10-01T23:00:00Z','ranked_competitive','season_and_event','published','UTC',true,2500),
('45000000-0000-0000-0000-000000000030','45000000-0000-0000-0000-000000000010','45000000-0000-0000-0000-000000000020','Other Event','Other Arena','2026-10-02T15:00:00Z','2026-10-02T23:00:00Z','ranked_competitive','season_and_event','draft','UTC',false,0);

insert into public.event_memberships(event_id,user_id,role)
values
('44000000-0000-0000-0000-000000000030','44000000-0000-0000-0000-000000000002','event_organizer'),
('44000000-0000-0000-0000-000000000030','44000000-0000-0000-0000-000000000003','field_marshal');

insert into public.event_roster_entries(
  id,organization_id,event_id,entry_type,display_name,
  checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared,attendance_status
) values
('44000000-0000-0000-0000-000000000060','44000000-0000-0000-0000-000000000010','44000000-0000-0000-0000-000000000030','guest_fighter','Guarded Fighter',false,false,false,false,false,'approved');

insert into public.fight_cards(id,event_id,name,list_name,status,sort_order)
values
('44000000-0000-0000-0000-000000000070','44000000-0000-0000-0000-000000000030','Field One','Field One','live',0);

insert into public.matches(
  id,organization_id,season_id,event_id,fight_card_id,label,category,match_type,
  scoring_config,status,stage,scheduled_order
) values
('44000000-0000-0000-0000-000000000080','44000000-0000-0000-0000-000000000010','44000000-0000-0000-0000-000000000020','44000000-0000-0000-0000-000000000030','44000000-0000-0000-0000-000000000070','M1','Longsword','duel','{"kind":"duel","roundsRequired":1}','scheduled','pool',1),
('44000000-0000-0000-0000-000000000081','44000000-0000-0000-0000-000000000010','44000000-0000-0000-0000-000000000020','44000000-0000-0000-0000-000000000030','44000000-0000-0000-0000-000000000070','M2','Longsword','duel','{"kind":"duel","roundsRequired":1}','scheduled','pool',2);

insert into public.event_registrations(
  id,event_id,email,display_name,category,waiver_acknowledged,status,payment_status
) values
('44000000-0000-0000-0000-000000000090','44000000-0000-0000-0000-000000000030','fighter@example.test','Registered Fighter','Longsword',true,'pending','pending');

select ok(
  exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='events'
  ),
  'event settings changes publish through realtime'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.update_event_settings_guarded(uuid,timestamptz,public.event_status,public.event_type,public.standings_mode,boolean,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute guarded event settings mutation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','44000000-0000-0000-0000-000000000001',true);

select lives_ok(
  format(
    'select public.update_event_settings_guarded(%L::uuid,%L::timestamptz,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,%L)',
    '44000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='44000000-0000-0000-0000-000000000030'),
    'live',
    'ranked_competitive',
    'season_and_event',
    true,
    'https://youtube.com/watch?v=abcdef'
  ),
  'organization admin can save guarded event settings'
);

select throws_ok(
  format(
    'select public.update_event_settings_guarded(%L::uuid,%L::timestamptz,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,null)',
    '44000000-0000-0000-0000-000000000030',
    '2000-01-01T00:00:00Z',
    'live',
    'ranked_competitive',
    'season_and_event',
    true
  ),
  'P0001',
  'Event settings changed on another device',
  'stale event settings are rejected'
);

select throws_ok(
  format(
    'select public.update_event_settings_guarded(%L::uuid,%L::timestamptz,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,%L)',
    '44000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='44000000-0000-0000-0000-000000000030'),
    'live',
    'ranked_competitive',
    'season_and_event',
    true,
    'http://example.com/stream'
  ),
  'P0001',
  'Livestream URL must use HTTPS',
  'insecure livestream URLs are rejected'
);

select lives_ok(
  $$insert into public.fight_cards(event_id,name,list_name,status,sort_order)
    values('44000000-0000-0000-0000-000000000030','Org Admin Field','Org Admin Field','draft',4)$$,
  'organization admin RLS matches organizer field permissions'
);

select lives_ok(
  $$insert into public.brackets(event_id,name,format,category)
    values('44000000-0000-0000-0000-000000000030','Org Admin Bracket','single_elimination','Longsword')$$,
  'organization admin RLS permits bracket creation'
);

select lives_ok(
  $$insert into public.announcements(event_id,title,body,is_public)
    values('44000000-0000-0000-0000-000000000030','Org notice','Test',false)$$,
  'organization admin can publish operational announcements'
);

select lives_ok(
  $$insert into public.disciplinary_cards(
      organization_id,season_id,event_id,color,card_reason,issued_by
    ) values(
      '44000000-0000-0000-0000-000000000010',
      '44000000-0000-0000-0000-000000000020',
      '44000000-0000-0000-0000-000000000030',
      'yellow','Test card','44000000-0000-0000-0000-000000000001'
    )$$,
  'organization admin can perform discipline actions allowed by the app'
);

select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,%L::boolean)',
    '44000000-0000-0000-0000-000000000060',
    (select updated_at::text from public.event_roster_entries where id='44000000-0000-0000-0000-000000000060'),
    'checked_in',
    true
  ),
  'organization admin can perform guarded roster clearance'
);

select throws_ok(
  $$select public.update_roster_clearance_guarded(
    '44000000-0000-0000-0000-000000000060',
    '2000-01-01T00:00:00Z',
    'armor_cleared',
    true
  )$$,
  'P0001',
  'Roster entry changed on another device',
  'stale roster clearance is rejected'
);

select throws_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,%L::boolean)',
    '44000000-0000-0000-0000-000000000060',
    (select updated_at::text from public.event_roster_entries where id='44000000-0000-0000-0000-000000000060'),
    'not_a_clearance',
    true
  ),
  'P0001',
  'Unsupported roster clearance field',
  'unexpected roster fields cannot be mutated through the guarded RPC'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','44000000-0000-0000-0000-000000000003',true);

select lives_ok(
  format(
    'select public.update_fight_card_guarded(%L::uuid,%L::timestamptz,%L,%L::public.fight_card_status)',
    '44000000-0000-0000-0000-000000000070',
    (select updated_at::text from public.fight_cards where id='44000000-0000-0000-0000-000000000070'),
    'Field Alpha',
    'live'
  ),
  'field marshal can update a field with the current version'
);

select throws_ok(
  $$select public.update_fight_card_guarded(
    '44000000-0000-0000-0000-000000000070',
    '2000-01-01T00:00:00Z',
    'Stale Field',
    'live'
  )$$,
  'P0001',
  'Tournament field changed on another device',
  'stale field changes are rejected'
);

select lives_ok(
  $$select public.reorder_match_guarded(
    '44000000-0000-0000-0000-000000000080',
    1,
    1
  )$$,
  'guarded fight-card reorder accepts the expected position'
);

select throws_ok(
  $$select public.reorder_match_guarded(
    '44000000-0000-0000-0000-000000000080',
    -1,
    1
  )$$,
  'P0001',
  'Fight card order changed on another device',
  'stale fight-card reorder is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','44000000-0000-0000-0000-000000000002',true);

select lives_ok(
  format(
    'select public.review_event_registration_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status)',
    '44000000-0000-0000-0000-000000000090',
    (select updated_at::text from public.event_registrations where id='44000000-0000-0000-0000-000000000090'),
    'waitlisted'
  ),
  'event organizer can review a registration with its current version'
);

select throws_ok(
  $$select public.review_event_registration_guarded(
    '44000000-0000-0000-0000-000000000090',
    '2000-01-01T00:00:00Z',
    'approved'
  )$$,
  'P0001',
  'Registration changed on another device',
  'stale registration review is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','45000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$insert into public.fight_cards(event_id,name,list_name,status,sort_order)
    values('44000000-0000-0000-0000-000000000030','Hostile Field','Hostile Field','live',99)$$,
  '42501',
  null,
  'unrelated organization admin cannot create a field in another organization'
);

select throws_ok(
  format(
    'select public.update_event_settings_guarded(%L::uuid,%L::timestamptz,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,null)',
    '44000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='44000000-0000-0000-0000-000000000030'),
    'live',
    'ranked_competitive',
    'season_and_event',
    true
  ),
  'P0001',
  'Event not found',
  'unrelated organization cannot use guarded event mutation through RLS'
);

select * from finish();
rollback;
