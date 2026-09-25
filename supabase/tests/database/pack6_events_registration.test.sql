begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('61000000-0000-0000-0000-000000000001','authenticated','authenticated','pack6-admin@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack 6 Admin"}',timezone('utc',now()),timezone('utc',now())),
('61000000-0000-0000-0000-000000000002','authenticated','authenticated','pack6-other@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack 6 Other Admin"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region,status)
values
('61000000-0000-0000-0000-000000000010','Pack Six Org','P6','Test','active'),
('62000000-0000-0000-0000-000000000010','Other Pack Six Org','P6O','Other','active');

insert into public.organization_memberships(organization_id,user_id,role)
values
('61000000-0000-0000-0000-000000000010','61000000-0000-0000-0000-000000000001','organization_admin'),
('62000000-0000-0000-0000-000000000010','61000000-0000-0000-0000-000000000002','organization_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status)
values
('61000000-0000-0000-0000-000000000020','61000000-0000-0000-0000-000000000010','Pack 6 Season',timezone('utc',now())-interval '1 year',timezone('utc',now())+interval '2 years','active');

insert into public.rulesets(
  id,organization_id,name,short_name,version,status,settings,published_at
) values (
  '61000000-0000-0000-0000-000000000150',
  '61000000-0000-0000-0000-000000000010',
  'Pack 6 Rules','P6R','1.0','published',
  '{"compliance":{"requireCheckIn":true,"requireArmorClearance":true,"requireMedicalClearance":true,"requireWaiver":true,"requireWeighIn":true}}',
  timezone('utc',now())
);

insert into public.competition_divisions(
  id,organization_id,name,slug,competition_format_id,team_size,age_min,status,metadata
) values
('61000000-0000-0000-0000-000000000100','61000000-0000-0000-0000-000000000010','Adult Longsword','pack6-adult-longsword','longsword',1,18,'published','{}'),
('61000000-0000-0000-0000-000000000101','61000000-0000-0000-0000-000000000010','Three Fighter Melee','pack6-3v3','3v3',3,null,'published','{}');

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,
  status,timezone,registration_open,registration_opens_at,registration_closes_at,
  registration_capacity,waitlist_enabled,ruleset_id
) values
(
  '61000000-0000-0000-0000-000000000030',
  '61000000-0000-0000-0000-000000000010',
  '61000000-0000-0000-0000-000000000020',
  'Pack 6 Open Event','Arena',timezone('utc',now())+interval '60 days',timezone('utc',now())+interval '61 days',
  'ranked_competitive','season_and_event','published','UTC',true,
  timezone('utc',now())-interval '1 day',timezone('utc',now())+interval '30 days',2,true,
  '61000000-0000-0000-0000-000000000150'
),
(
  '61000000-0000-0000-0000-000000000031',
  '61000000-0000-0000-0000-000000000010',
  '61000000-0000-0000-0000-000000000020',
  'Pack 6 Closed Event','Arena',timezone('utc',now())+interval '60 days',timezone('utc',now())+interval '61 days',
  'ranked_competitive','season_and_event','published','UTC',true,
  timezone('utc',now())-interval '30 days',timezone('utc',now())-interval '1 day',null,true,
  '61000000-0000-0000-0000-000000000150'
);

insert into public.event_ruleset_snapshots(
  id,event_id,ruleset_id,ruleset_name,ruleset_short_name,ruleset_version,resolved_settings
) values
(
  '61000000-0000-0000-0000-000000000160',
  '61000000-0000-0000-0000-000000000030',
  '61000000-0000-0000-0000-000000000150',
  'Pack 6 Rules','P6R','1.0',
  '{"compliance":{"requireCheckIn":true,"requireArmorClearance":true,"requireMedicalClearance":true,"requireWaiver":true,"requireWeighIn":true}}'
),
(
  '61000000-0000-0000-0000-000000000161',
  '61000000-0000-0000-0000-000000000031',
  '61000000-0000-0000-0000-000000000150',
  'Pack 6 Rules','P6R','1.0',
  '{"compliance":{"requireCheckIn":true,"requireArmorClearance":true,"requireMedicalClearance":true,"requireWaiver":true,"requireWeighIn":true}}'
);

update public.events
set ruleset_snapshot_id=case id
  when '61000000-0000-0000-0000-000000000030'::uuid then '61000000-0000-0000-0000-000000000160'::uuid
  when '61000000-0000-0000-0000-000000000031'::uuid then '61000000-0000-0000-0000-000000000161'::uuid
  else ruleset_snapshot_id
end
where id in (
  '61000000-0000-0000-0000-000000000030',
  '61000000-0000-0000-0000-000000000031'
);

insert into public.event_divisions(
  id,event_id,division_id,ruleset_id,ruleset_snapshot_id,registration_limit,is_registration_open
)
values
(
  '61000000-0000-0000-0000-000000000200',
  '61000000-0000-0000-0000-000000000030',
  '61000000-0000-0000-0000-000000000100',
  '61000000-0000-0000-0000-000000000150',
  '61000000-0000-0000-0000-000000000160',
  1,true
),
(
  '61000000-0000-0000-0000-000000000201',
  '61000000-0000-0000-0000-000000000030',
  '61000000-0000-0000-0000-000000000101',
  '61000000-0000-0000-0000-000000000150',
  '61000000-0000-0000-0000-000000000160',
  2,true
),
(
  '61000000-0000-0000-0000-000000000202',
  '61000000-0000-0000-0000-000000000031',
  '61000000-0000-0000-0000-000000000100',
  '61000000-0000-0000-0000-000000000150',
  '61000000-0000-0000-0000-000000000161',
  1,true
);

select ok(
  (select published_at is not null from public.events where id='61000000-0000-0000-0000-000000000030'),
  'published events inserted after Pack 6 receive publication provenance'
);

select ok(
  not has_table_privilege('anon','public.event_registrations','INSERT'),
  'anonymous clients cannot bypass governed registration RPCs with direct inserts'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.review_event_registration(uuid,public.registration_status)',
    'EXECUTE'
  ),
  'legacy unguarded registration review is no longer executable'
);

set local role anon;
select set_config('request.jwt.claim.sub','',true);

select is(
  (select count(*)::integer from public.events where id='61000000-0000-0000-0000-000000000030'),
  1,
  'anonymous spectators can read a published Pack 6 event'
);

select is(
  (select count(*)::integer from public.event_divisions where event_id='61000000-0000-0000-0000-000000000030'),
  2,
  'anonymous registration can discover safe published event divisions'
);

select throws_ok(
  $$select email from public.event_registrations limit 1$$,
  '42501',
  null,
  'anonymous users cannot read private registration contacts'
);

select throws_ok(
  $$select public.submit_public_registration(
    '61000000-0000-0000-0000-000000000030',
    'legacy@buhurtos.test','Legacy Bypass','','Adult Longsword','','',true
  )$$,
  'P0001',
  'Choose an event division for registration',
  'legacy category registration cannot bypass formal event divisions'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'eligible-a@buhurtos.test','Eligible A','',
    '[]'::jsonb,null,25,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'eligible individual can submit through the governed public RPC'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='eligible-a@buhurtos.test'),
  'eligible',
  'eligible individual receives an explainable eligible decision'
);

select throws_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'eligible-a@buhurtos.test','Duplicate A','',
    '[]'::jsonb,null,25,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'P0001',
  'This email already has an active registration for this division',
  'duplicate active registration is rejected'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'eligible-b@buhurtos.test','Eligible B','',
    '[]'::jsonb,null,30,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'second eligible individual can be pending before approval'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'underage@buhurtos.test','Under Age','',
    '[]'::jsonb,null,16,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'underage registration is saved for an explicit decision rather than silently passing'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='underage@buhurtos.test'),
  'ineligible',
  'age failure is stored as ineligible'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'review@buhurtos.test','Needs Review','',
    '[]'::jsonb,null,null,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'missing eligibility fact is accepted only as a needs-review registration'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='review@buhurtos.test'),
  'needs_review',
  'missing age never silently qualifies the fighter'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000201',
    'team'::public.registration_kind,
    'team-a@buhurtos.test','Captain A','Team A',
    '["Fighter One","Fighter Two","Fighter Three"]'::jsonb,null,null,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'correct-size team registration is accepted'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='team-a@buhurtos.test'),
  'eligible',
  'team size requirement is evaluated at submission'
);

select lives_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000201',
    'team'::public.registration_kind,
    'team-edit@buhurtos.test','Captain Edit','Team Edit',
    '["One","Two","Three"]'::jsonb,null,null,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'second team can remain pending for roster editing'
);

select throws_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000031',
    '61000000-0000-0000-0000-000000000202',
    'individual'::public.registration_kind,
    'late@buhurtos.test','Late Fighter','',
    '[]'::jsonb,null,25,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'P0001',
  'Registration is closed',
  'registration deadline is enforced by the database'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000002',true);

select throws_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='eligible-a@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='eligible-a@buhurtos.test'),
    'approved'
  ),
  'P0001',
  'Not authorized to review registrations',
  'administrator from another organization cannot review registrations'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);

select throws_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='eligible-b@buhurtos.test'),
    '2000-01-01T00:00:00Z',
    'approved'
  ),
  'P0001',
  'Registration changed on another device',
  'stale registration review is rejected'
);

select lives_ok(
  format(
    'select public.update_registration_roster_guarded(%L::uuid,%L::timestamptz,%L,%L::jsonb,null)',
    (select id::text from public.event_registrations where email='team-edit@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='team-edit@buhurtos.test'),
    'Team Edit',
    '["One","Two"]'
  ),
  'organizer can edit a pending team roster'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='team-edit@buhurtos.test'),
  'ineligible',
  'team roster edit immediately recalculates eligibility'
);

select lives_ok(
  format(
    'select public.update_registration_roster_guarded(%L::uuid,%L::timestamptz,%L,%L::jsonb,null)',
    (select id::text from public.event_registrations where email='team-edit@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='team-edit@buhurtos.test'),
    'Team Edit',
    '["One","Two","Three"]'
  ),
  'organizer can repair the pending team roster'
);

select is(
  (select eligibility_status::text from public.event_registrations where email='team-edit@buhurtos.test'),
  'eligible',
  'repaired team roster returns to eligible'
);

select lives_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,%L)',
    (select id::text from public.event_registrations where email='eligible-a@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='eligible-a@buhurtos.test'),
    'approved',
    'Approved normally'
  ),
  'organizer can approve an eligible individual registration'
);

select is(
  (select count(*)::integer from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
  1,
  'approval creates exactly one event roster record'
);

select is(
  (select count(*)::integer from public.fighters where name='Eligible A'),
  0,
  'approval does not invent a permanent fighter identity from submitted display text'
);

select throws_ok(
  format(
    'select public.set_roster_competition_clearance_guarded(%L::uuid,%L::timestamptz,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test'))
  ),
  'P0001',
  'Check in is incomplete',
  'approval alone does not make a competitor competition-cleared'
);

select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'checked_in'
  ),
  'physical check in is a distinct guarded operation'
);
select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'armor_cleared'
  ),
  'armor clearance can be recorded'
);
select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'medical_cleared'
  ),
  'medical clearance can be recorded'
);
select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'waiver_confirmed'
  ),
  'waiver clearance can be recorded'
);
select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'weigh_in_cleared'
  ),
  'weigh in clearance can be recorded'
);

select lives_ok(
  format(
    'select public.set_roster_competition_clearance_guarded(%L::uuid,%L::timestamptz,true)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test'))
  ),
  'marshal can grant final competition clearance after physical gates pass'
);

select ok(
  (select can_compete from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
  'database competition readiness requires explicit final marshal clearance'
);

select lives_ok(
  format(
    'select public.update_roster_clearance_guarded(%L::uuid,%L::timestamptz,%L,false)',
    (select id::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    (select updated_at::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
    'armor_cleared'
  ),
  'revoking a physical clearance is allowed'
);

select ok(
  not (select competition_cleared from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='eligible-a@buhurtos.test')),
  'revoking a physical clearance automatically revokes final competition clearance'
);

select lives_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='team-a@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='team-a@buhurtos.test'),
    'approved'
  ),
  'organizer can approve an eligible team registration'
);

select is(
  (select entry_type::text from public.event_roster_entries where registration_id=(select id from public.event_registrations where email='team-a@buhurtos.test')),
  'team',
  'team approval creates a team roster entry rather than a fake fighter'
);

select throws_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='eligible-b@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='eligible-b@buhurtos.test'),
    'approved'
  ),
  'P0001',
  'Event capacity reached; waitlist this registration instead',
  'approval cannot overbook event capacity even when multiple entries were pending'
);

select lives_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='eligible-b@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='eligible-b@buhurtos.test'),
    'waitlisted'
  ),
  'full registration can be explicitly waitlisted'
);

select throws_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='underage@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='underage@buhurtos.test'),
    'approved'
  ),
  'P0001',
  'Ineligible registration cannot be approved',
  'ineligible entrant cannot be organizer-approved'
);

select throws_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,null,null)',
    (select id::text from public.event_registrations where email='review@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='review@buhurtos.test'),
    'approved'
  ),
  'P0001',
  'Eligibility review reason is required before approval',
  'needs-review entrant cannot be approved without an explicit reason'
);

select set_config(
  'pack6.registration_id',
  (select id::text from public.event_registrations where email='eligible-a@buhurtos.test'),
  false
);
select set_config(
  'pack6.registration_token',
  (select registration_token::text from public.event_registrations where email='eligible-a@buhurtos.test'),
  false
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);

select throws_ok(
  format(
    'select public.withdraw_event_registration(%L::uuid,%L::uuid)',
    current_setting('pack6.registration_id'),
    '00000000-0000-0000-0000-000000000000'
  ),
  'P0001',
  'Registration not found',
  'withdrawal capability rejects the wrong token'
);

select lives_ok(
  format(
    'select public.withdraw_event_registration(%L::uuid,%L::uuid)',
    current_setting('pack6.registration_id'),
    current_setting('pack6.registration_token')
  ),
  'correct registration capability can withdraw a registration'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);

select is(
  (select status::text from public.event_registrations where email='eligible-a@buhurtos.test'),
  'withdrawn',
  'withdrawal status is persisted'
);

select is(
  (select attendance_status::text from public.event_roster_entries where registration_id=current_setting('pack6.registration_id')::uuid),
  'withdrawn',
  'withdrawal also removes the roster entry from active competition'
);

select lives_ok(
  format(
    'select public.review_event_registration_v2_guarded(%L::uuid,%L::timestamptz,%L::public.registration_status,%L,null)',
    (select id::text from public.event_registrations where email='review@buhurtos.test'),
    (select updated_at::text from public.event_registrations where email='review@buhurtos.test'),
    'approved',
    'Organizer verified age against private event documentation'
  ),
  'needs-review entry can be approved only with an audited organizer reason after capacity is freed'
);

select is(
  (select eligibility_override_reason from public.event_registrations where email='review@buhurtos.test'),
  'Organizer verified age against private event documentation',
  'eligibility override reason is preserved with the registration'
);

select throws_ok(
  format(
    'select public.update_event_details_guarded(%L::uuid,%L::timestamptz,%L,%L,%L::timestamptz,%L::timestamptz,%L,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,%L::timestamptz,%L::timestamptz,%L::integer,%L::boolean,%L,%L)',
    '61000000-0000-0000-0000-000000000030',
    '2000-01-01T00:00:00Z',
    'Pack 6 Open Event','Arena',
    (select starts_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select ends_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    'UTC','published','ranked_competitive','season_and_event',true,
    (select registration_opens_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select registration_closes_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    2,true,'Public event',''
  ),
  'P0001',
  'Event settings changed on another device',
  'stale event administration is rejected'
);

select lives_ok(
  format(
    'select public.update_event_details_guarded(%L::uuid,%L::timestamptz,%L,%L,%L::timestamptz,%L::timestamptz,%L,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,%L::timestamptz,%L::timestamptz,%L::integer,%L::boolean,%L,%L)',
    '61000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    'Pack 6 Open Event','Arena',
    (select starts_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select ends_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    'UTC','cancelled','ranked_competitive','season_and_event',false,
    (select registration_opens_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select registration_closes_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    2,true,'Public event',''
  ),
  'authorized organizer can cancel a published event through the guarded lifecycle'
);

select ok(
  (select cancelled_at is not null and not registration_open from public.events where id='61000000-0000-0000-0000-000000000030'),
  'cancellation is timestamped and closes registration'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);

select is(
  (select count(*)::integer from public.events where id='61000000-0000-0000-0000-000000000030'),
  1,
  'cancelled published event remains visible to spectators'
);

select throws_ok(
  $$select public.submit_event_registration(
    '61000000-0000-0000-0000-000000000030',
    '61000000-0000-0000-0000-000000000200',
    'individual'::public.registration_kind,
    'after-cancel@buhurtos.test','After Cancel','',
    '[]'::jsonb,null,25,null,null,'{}'::jsonb,'{}'::jsonb,'','',true
  )$$,
  'P0001',
  'Registration is not open',
  'cancelled event rejects new registrations'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);

select lives_ok(
  format(
    'select public.update_event_details_guarded(%L::uuid,%L::timestamptz,%L,%L,%L::timestamptz,%L::timestamptz,%L,%L::public.event_status,%L::public.event_type,%L::public.standings_mode,%L::boolean,%L::timestamptz,%L::timestamptz,%L::integer,%L::boolean,%L,%L)',
    '61000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    'Pack 6 Open Event','Arena',
    (select starts_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select ends_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    'UTC','archived','ranked_competitive','season_and_event',false,
    (select registration_opens_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    (select registration_closes_at::text from public.events where id='61000000-0000-0000-0000-000000000030'),
    2,true,'Public event',''
  ),
  'cancelled event can be archived'
);

select throws_ok(
  $$update public.events set name='Rewrite history' where id='61000000-0000-0000-0000-000000000030'$$,
  'P0001',
  'Archived events are immutable',
  'archived event history cannot be rewritten'
);

select * from finish();
rollback;
