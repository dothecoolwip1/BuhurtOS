begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('00000000-0000-0000-0000-000000000101','authenticated','authenticated','identity-admin@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Identity Admin"}',timezone('utc',now()),timezone('utc',now())),
('00000000-0000-0000-0000-000000000102','authenticated','authenticated','fighter-one@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Fighter One"}',timezone('utc',now()),timezone('utc',now())),
('00000000-0000-0000-0000-000000000103','authenticated','authenticated','fighter-two@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Fighter Two"}',timezone('utc',now()),timezone('utc',now())),
('00000000-0000-0000-0000-000000000104','authenticated','authenticated','identity-reviewer@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Platform Reviewer"}',timezone('utc',now()),timezone('utc',now())),
('00000000-0000-0000-0000-000000000105','authenticated','authenticated','identity-outsider@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Outsider"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(id,name,short_name,region)
values ('00000000-0000-0000-0000-000000000110','Pack Three Org','P3','Test');

insert into public.organization_memberships(organization_id,user_id,role)
values ('00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000101','organization_admin');

insert into public.platform_memberships(user_id,role)
values ('00000000-0000-0000-0000-000000000104','platform_super_admin');

insert into public.seasons(id,organization_id,name,starts_at,ends_at,status)
values ('00000000-0000-0000-0000-000000000120','00000000-0000-0000-0000-000000000110','2026 Identity Test','2026-01-01','2026-12-31','active');

insert into public.events(id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone)
values ('00000000-0000-0000-0000-000000000130','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000120','Identity History Event','Test Field','2026-06-01T16:00:00Z','2026-06-01T23:00:00Z','ranked_competitive','season_and_event','completed','UTC');

insert into public.teams(id,organization_id,name,city_or_region)
values
('00000000-0000-0000-0000-000000000141','00000000-0000-0000-0000-000000000110','Old Team','Test'),
('00000000-0000-0000-0000-000000000142','00000000-0000-0000-0000-000000000110','New Team','Test');

insert into public.fighter_identities(
  id,display_name,profile_visibility,user_id,profile_revision
) values
('10000000-0000-0000-0000-000000000001','Public Fighter','public',null,1),
('10000000-0000-0000-0000-000000000002','Private Fighter','private',null,1),
('10000000-0000-0000-0000-000000000003','Historical Claim','members',null,1),
('10000000-0000-0000-0000-000000000004','Merge Person','members',null,1),
('10000000-0000-0000-0000-000000000005','Merge Person','members',null,1),
('10000000-0000-0000-0000-000000000006','Conflict One','members','00000000-0000-0000-0000-000000000102',1),
('10000000-0000-0000-0000-000000000007','Conflict Two','members','00000000-0000-0000-0000-000000000103',1),
('10000000-0000-0000-0000-000000000008','Youth Fighter','private','00000000-0000-0000-0000-000000000102',1),
('10000000-0000-0000-0000-000000000009','Rejected Claim','members',null,1);

insert into public.fighter_identity_accounts(identity_id,user_id,relationship,created_by)
values
('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000102','self','00000000-0000-0000-0000-000000000101'),
('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000103','self','00000000-0000-0000-0000-000000000101'),
('10000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000102','self','00000000-0000-0000-0000-000000000101')
on conflict (identity_id,user_id,relationship) do nothing;

insert into public.fighter_identity_private_profiles(identity_id,birth_date,revision,last_edited_by)
values ('10000000-0000-0000-0000-000000000008','2012-04-28',1,'00000000-0000-0000-0000-000000000102');

insert into public.fighters(id,organization_id,team_id,user_id,identity_id,name)
values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000110',null,null,'10000000-0000-0000-0000-000000000001','Public Fighter'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000110',null,null,'10000000-0000-0000-0000-000000000002','Private Fighter'),
('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000110',null,null,'10000000-0000-0000-0000-000000000003','Historical Claim'),
('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000141',null,'10000000-0000-0000-0000-000000000004','Merge Person'),
('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000110',null,null,'10000000-0000-0000-0000-000000000005','Merge Person'),
('20000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000110',null,'00000000-0000-0000-0000-000000000102','10000000-0000-0000-0000-000000000006','Conflict One'),
('20000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000110',null,'00000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000007','Conflict Two'),
('20000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000110',null,'00000000-0000-0000-0000-000000000102','10000000-0000-0000-0000-000000000008','Youth Fighter'),
('20000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000110',null,null,'10000000-0000-0000-0000-000000000009','Rejected Claim');

insert into public.event_roster_entries(
  id,organization_id,event_id,fighter_id,entry_type,display_name,
  checked_in,armor_cleared,medical_cleared,waiver_confirmed,attendance_status
) values (
  '30000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000110',
  '00000000-0000-0000-0000-000000000130',
  '20000000-0000-0000-0000-000000000005',
  'fighter','Merge Person',true,true,true,true,'approved'
);

set local role anon;

select is(
  (select count(id)::integer from public.fighter_identities where id='10000000-0000-0000-0000-000000000001'),
  1,
  'anonymous users can read a public fighter identity'
);

select is(
  (select count(id)::integer from public.fighter_identities where id='10000000-0000-0000-0000-000000000002'),
  0,
  'anonymous users cannot read a private fighter identity'
);

select throws_ok(
  $$select user_id from public.fighter_identities limit 1$$,
  '42501',
  null,
  'anonymous users cannot request account linkage from fighter identities'
);

select throws_ok(
  $$select identity_id from public.fighter_identity_private_profiles limit 1$$,
  '42501',
  null,
  'anonymous users cannot read private fighter profiles'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);

select throws_ok(
  $$insert into public.fighter_identities(display_name) values ('Direct Browser Identity')$$,
  '42501',
  null,
  'authenticated users cannot directly insert fighter identities'
);

create temp table pack3_runtime(label text primary key, id uuid);
insert into pack3_runtime
values ('self_identity', public.create_my_fighter_identity('Original Name'));

select ok(
  (select id is not null from pack3_runtime where label='self_identity'),
  'fighter can create a permanent identity through the controlled workflow'
);

select is(
  public.update_fighter_public_profile(
    (select id from pack3_runtime where label='self_identity'),
    1,
    'Renamed Fighter',
    'Ren',
    'Updated bio',
    'Central Alberta',
    'members'
  ),
  2::bigint,
  'fighter can update a controlled public profile with the expected revision'
);

select ok(
  exists(
    select 1
    from public.fighter_identity_aliases
    where identity_id=(select id from pack3_runtime where label='self_identity')
      and normalized_alias='original name'
  ),
  'renaming preserves the old display name as an alias'
);

select throws_ok(
  format(
    'select public.update_fighter_public_profile(%L::uuid,1,%L,null,null,null,%L::public.fighter_profile_visibility)',
    (select id from pack3_runtime where label='self_identity'),
    'Stale Write',
    'private'
  ),
  '40001',
  null,
  'stale fighter profile revisions are rejected instead of overwriting newer data'
);

select lives_ok(
  format(
    'select public.update_fighter_private_profile(%L::uuid,0,%L,%L::date,%L,null,null,null,null,null,null,null)',
    (select id from pack3_runtime where label='self_identity'),
    'Private Legal Name',
    '1995-01-01',
    'private@fighter.test'
  ),
  'fighter can save private administrative details separately from the public profile'
);

select throws_ok(
  $$select public.update_fighter_public_profile(
    '10000000-0000-0000-0000-000000000008',
    1,
    'Youth Fighter',
    null,
    null,
    null,
    'public'
  )$$,
  'P0001',
  null,
  'a youth profile cannot become public without verified guardian consent'
);

insert into pack3_runtime
values ('claim_one', public.submit_fighter_identity_claim(
  '10000000-0000-0000-0000-000000000003','self','Historical result belongs to me'
));

select is(
  (select status::text from public.fighter_identity_claims where id=(select id from pack3_runtime where label='claim_one')),
  'pending',
  'unclaimed identity claim enters pending review'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

select is(
  public.review_fighter_identity_claim(
    (select id from pack3_runtime where label='claim_one'),
    'approve',
    'Verified against event history',
    1
  )::text,
  'approved',
  'organization administrator can approve a normal claim in their organization'
);

select ok(
  exists(
    select 1
    from public.fighter_identity_accounts
    where identity_id='10000000-0000-0000-0000-000000000003'
      and user_id='00000000-0000-0000-0000-000000000102'
      and relationship='self'
      and revoked_at is null
  ),
  'approved claim creates a verified identity account link'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);

insert into pack3_runtime
values ('claim_two', public.submit_fighter_identity_claim(
  '10000000-0000-0000-0000-000000000003','self','I believe this is my record'
));

select is(
  (select status::text from public.fighter_identity_claims where id=(select id from pack3_runtime where label='claim_two')),
  'disputed',
  'a competing self claim becomes disputed instead of silently taking ownership'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

select throws_ok(
  format(
    'select public.review_fighter_identity_claim(%L::uuid,%L,%L,1)',
    (select id from pack3_runtime where label='claim_two'),
    'approve',
    'Attempted local resolution'
  ),
  'P0001',
  null,
  'organization administrator cannot resolve a disputed ownership claim'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);

select is(
  public.review_fighter_identity_claim(
    (select id from pack3_runtime where label='claim_two'),
    'approve',
    'Platform dispute resolution',
    1
  )::text,
  'approved',
  'platform reviewer can resolve a disputed identity claim'
);

select ok(
  exists(
    select 1
    from public.fighter_identity_accounts
    where identity_id='10000000-0000-0000-0000-000000000003'
      and user_id='00000000-0000-0000-0000-000000000103'
      and relationship='self'
      and revoked_at is null
  )
  and not exists(
    select 1
    from public.fighter_identity_accounts
    where identity_id='10000000-0000-0000-0000-000000000003'
      and user_id='00000000-0000-0000-0000-000000000102'
      and relationship='self'
      and revoked_at is null
  ),
  'dispute resolution transfers active self control without deleting prior linkage history'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000105',true);

select throws_ok(
  $$select public.update_fighter_public_profile(
    '10000000-0000-0000-0000-000000000003',
    1,
    'Unauthorized Rename',
    null,
    null,
    null,
    'private'
  )$$,
  'P0001',
  null,
  'unrelated authenticated account cannot edit another fighter identity'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);

insert into pack3_runtime
values ('rejected_claim', public.submit_fighter_identity_claim(
  '10000000-0000-0000-0000-000000000009','self','Please review this record'
));

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

select is(
  public.review_fighter_identity_claim(
    (select id from pack3_runtime where label='rejected_claim'),
    'reject',
    'Evidence does not match',
    1
  )::text,
  'rejected',
  'administrator can reject an unsupported identity claim'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);

select lives_ok(
  format(
    'select public.dispute_fighter_identity_claim(%L::uuid,%L,2)',
    (select id from pack3_runtime where label='rejected_claim'),
    'I can provide additional event evidence'
  ),
  'claimant can dispute a rejected claim with a reason'
);

select is(
  (select status::text from public.fighter_identity_claims where id=(select id from pack3_runtime where label='rejected_claim')),
  'disputed',
  'rejected claim moves into disputed review after claimant challenge'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

select throws_ok(
  $$insert into public.fighter_affiliations(identity_id,organization_id,team_id,affiliation_type,starts_on,is_primary)
    values ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000141','member','2026-01-01',true)$$,
  '42501',
  null,
  'authenticated browser cannot directly insert affiliation history'
);

insert into pack3_runtime
values ('affiliation_one', public.create_fighter_affiliation(
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000110',
  null,
  '00000000-0000-0000-0000-000000000141',
  'member',
  '2026-01-01',
  null,
  true,
  null,
  'Original team'
));

select ok(
  (select id is not null from pack3_runtime where label='affiliation_one'),
  'organization administrator can create dated affiliation history through the controlled workflow'
);

insert into pack3_runtime
values ('affiliation_two', public.create_fighter_affiliation(
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000110',
  null,
  '00000000-0000-0000-0000-000000000142',
  'member',
  '2026-05-01',
  null,
  true,
  null,
  'Changed teams'
));

select ok(
  (select id is not null from pack3_runtime where label='affiliation_two'),
  'new primary affiliation can be recorded without deleting the previous period'
);

select is(
  (select ends_on from public.fighter_affiliations where id=(select id from pack3_runtime where label='affiliation_one')),
  '2026-04-30'::date,
  'starting a new primary affiliation closes the prior period on the previous day'
);

select is(
  (select team_id from public.fighters where id='20000000-0000-0000-0000-000000000004'),
  '00000000-0000-0000-0000-000000000142'::uuid,
  'current fighter row follows the active primary team while affiliation history remains dated'
);

select is(
  (select count(*)::integer from public.fighter_affiliations where identity_id='10000000-0000-0000-0000-000000000004'),
  2,
  'team changes preserve both affiliation history rows'
);

select is(
  (select count(id)::integer from public.fighter_identities where display_name='Merge Person' and deleted_at is null),
  2,
  'shared fighter names are allowed and do not force automatic deduplication'
);

select ok(
  exists(
    select 1
    from public.suggest_fighter_identity_duplicates('10000000-0000-0000-0000-000000000004')
    where candidate_identity_id='10000000-0000-0000-0000-000000000005'
  ),
  'duplicate detection suggests a same-name candidate for human review'
);

select ok(
  (select deleted_at is null and merged_into_identity_id is null from public.fighter_identities where id='10000000-0000-0000-0000-000000000005'),
  'duplicate suggestion does not merge or archive the candidate automatically'
);

insert into pack3_runtime
values ('merge_review', public.request_fighter_identity_merge(
  '10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005',
  'Same historical person'
));

select is(
  (select status::text from public.fighter_identity_merge_reviews where id=(select id from pack3_runtime where label='merge_review')),
  'pending',
  'authorized administrator can request a merge without changing identity history'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);

select is(
  public.review_fighter_identity_merge(
    (select id from pack3_runtime where label='merge_review'),
    'approve',
    'Verified duplicate'
  )::text,
  'completed',
  'different platform reviewer can complete an approved identity merge'
);

select is(
  (select fighter_id from public.event_roster_entries where id='30000000-0000-0000-0000-000000000005'),
  '20000000-0000-0000-0000-000000000005'::uuid,
  'identity merge preserves historical roster fighter references'
);

select ok(
  (select deleted_at is not null and merged_into_identity_id='10000000-0000-0000-0000-000000000004'
   from public.fighter_identities where id='10000000-0000-0000-0000-000000000005'),
  'duplicate identity is soft archived with canonical merge provenance'
);

select ok(
  (select deleted_at is not null and merged_into_fighter_id='20000000-0000-0000-0000-000000000004'
   from public.fighters where id='20000000-0000-0000-0000-000000000005'),
  'duplicate organization fighter row is retained and points to the canonical fighter'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

insert into pack3_runtime
values ('conflict_merge', public.request_fighter_identity_merge(
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000007',
  'Potential duplicate with conflicting owners'
));

select is(
  (select status::text from public.fighter_identity_merge_reviews where id=(select id from pack3_runtime where label='conflict_merge')),
  'pending',
  'conflicting verified owners can be escalated into merge review without auto-merging'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);

select throws_ok(
  format(
    'select public.review_fighter_identity_merge(%L::uuid,%L,%L)',
    (select id from pack3_runtime where label='conflict_merge'),
    'approve',
    'Should be blocked'
  ),
  '40001',
  null,
  'merge transaction refuses identities controlled by different verified self accounts'
);

select is(
  (select count(*)::integer
   from public.fighter_identities
   where id in ('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007')
     and deleted_at is null
     and merged_into_identity_id is null),
  2,
  'failed merge rolls back without partially archiving either identity'
);

select ok(
  exists(
    select 1 from public.audit_log
    where action='complete_fighter_identity_merge'
      and record_id=(select id from pack3_runtime where label='merge_review')
  ),
  'completed merge records an audit event'
);

select throws_ok(
  $$select public.merge_fighters(
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000006'
  )$$,
  '42501',
  null,
  'legacy direct merge RPC is no longer executable by authenticated clients'
);

select ok(
  exists(
    select 1 from public.audit_log
    where action='review_fighter_identity_claim'
      and record_id=(select id from pack3_runtime where label='claim_two')
  ),
  'claim review decisions are audited'
);

select ok(
  exists(
    select 1 from public.audit_log
    where action='create_fighter_affiliation'
      and record_id=(select id from pack3_runtime where label='affiliation_two')
  ),
  'affiliation changes are audited'
);

select ok(
  exists(
    select 1 from public.fighter_identity_aliases
    where identity_id='10000000-0000-0000-0000-000000000004'
      and normalized_alias='merge person'
  ),
  'canonical identity retains searchable alias provenance after merge'
);

select is(
  (select status::text from public.fighter_identity_merge_reviews where id=(select id from pack3_runtime where label='conflict_merge')),
  'pending',
  'failed conflicting-owner merge remains pending for explicit human resolution'
);

select ok(
  (select profile_revision >= 2 from public.fighter_identities where id='10000000-0000-0000-0000-000000000004'),
  'successful merge advances canonical profile revision for concurrency safety'
);

select ok(
  (select profile_revision >= 2 from public.fighter_identities where id='10000000-0000-0000-0000-000000000005'),
  'successful merge advances duplicate profile revision before archival'
);

select is(
  (select count(*)::integer
   from public.fighter_identity_accounts
   where identity_id='10000000-0000-0000-0000-000000000003'
     and relationship='self'),
  2,
  'ownership dispute preserves both historical account-link records'
);

select ok(
  exists(
    select 1
    from public.fighter_identity_accounts
    where identity_id='10000000-0000-0000-0000-000000000003'
      and user_id='00000000-0000-0000-0000-000000000102'
      and revoked_at is not null
  ),
  'superseded self ownership is revoked rather than deleted'
);

select * from finish();
rollback;
