begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('41000000-0000-0000-0000-000000000001','authenticated','authenticated','admin-a@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Pack 4 Admin A"}',timezone('utc',now()),timezone('utc',now())),
('41000000-0000-0000-0000-000000000002','authenticated','authenticated','club-admin@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Club Admin"}',timezone('utc',now()),timezone('utc',now())),
('41000000-0000-0000-0000-000000000003','authenticated','authenticated','team-admin@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Team Admin"}',timezone('utc',now()),timezone('utc',now())),
('41000000-0000-0000-0000-000000000004','authenticated','authenticated','captain@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Captain"}',timezone('utc',now()),timezone('utc',now())),
('41000000-0000-0000-0000-000000000005','authenticated','authenticated','fighter@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Fighter"}',timezone('utc',now()),timezone('utc',now())),
('41000000-0000-0000-0000-000000000006','authenticated','authenticated','support@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Support"}',timezone('utc',now()),timezone('utc',now())),
('42000000-0000-0000-0000-000000000001','authenticated','authenticated','admin-b@pack4.test','',timezone('utc',now()),'{}','{"display_name":"Pack 4 Admin B"}',timezone('utc',now()),timezone('utc',now()));

insert into public.organizations(
  id,name,short_name,region,status,kind,visibility
) values
('41000000-0000-0000-0000-000000000010','Pack Four Organization A','P4A','Region A','active','national_federation','public'),
('42000000-0000-0000-0000-000000000010','Pack Four Organization B','P4B','Region B','active','regional_organization','private');

insert into public.organization_memberships(organization_id,user_id,role)
values
('41000000-0000-0000-0000-000000000010','41000000-0000-0000-0000-000000000001','organization_admin'),
('42000000-0000-0000-0000-000000000010','42000000-0000-0000-0000-000000000001','organization_admin');

create temp table pack4_runtime(
  label text primary key,
  id uuid
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

insert into pack4_runtime(label,id)
values (
  'child_org',
  public.create_subordinate_organization(
    '41000000-0000-0000-0000-000000000010',
    'Pack Four Child',
    'P4C',
    'Child Region',
    'regional_organization',
    'members'
  )
);

select ok(
  exists(
    select 1
    from public.organization_relationships r
    where r.parent_organization_id='41000000-0000-0000-0000-000000000010'
      and r.child_organization_id=(select id from pack4_runtime where label='child_org')
      and r.relationship_kind='governs'
      and r.ends_on is null
  ),
  'creating a subordinate organization creates an active governing relationship'
);

select ok(
  exists(
    select 1
    from public.organization_memberships m
    where m.organization_id=(select id from pack4_runtime where label='child_org')
      and m.user_id='41000000-0000-0000-0000-000000000001'
      and m.role='organization_admin'
  ),
  'the creator receives initial administrator access to the new child organization'
);

select throws_ok(
  format(
    'select public.create_organization_relationship(%L::uuid,%L::uuid,%L::public.organization_relationship_kind,current_date)',
    (select id from pack4_runtime where label='child_org'),
    '41000000-0000-0000-0000-000000000010',
    'governs'
  ),
  'P0001',
  'Organization hierarchy cycle detected',
  'a governing cycle is rejected'
);

select throws_ok(
  $$select public.create_organization_relationship(
    '41000000-0000-0000-0000-000000000010',
    '42000000-0000-0000-0000-000000000010',
    'recognizes',
    current_date
  )$$,
  'P0001',
  'Administrator access to both existing organizations is required',
  'an administrator cannot attach an unrelated existing organization'
);

insert into pack4_runtime(label,id)
values (
  'club',
  public.create_club(
    '41000000-0000-0000-0000-000000000010',
    'Pack Four Club',
    'P4C',
    'Central',
    'public',
    'Public club description',
    'https://club.example'
  )
);

select ok(
  exists(
    select 1
    from public.club_memberships m
    where m.club_id=(select id from pack4_runtime where label='club')
      and m.user_id='41000000-0000-0000-0000-000000000001'
      and m.role='club_admin'
      and m.ends_on is null
  ),
  'creating a club creates an initial club administrator membership'
);

insert into pack4_runtime(label,id)
values (
  'club_admin_invite',
  public.create_membership_invitation(
    'club',
    (select id from pack4_runtime where label='club'),
    'club-admin@pack4.test',
    'club_admin',
    null,
    'Help administer this club'
  )
);

select ok(
  (select id is not null from pack4_runtime where label='club_admin_invite'),
  'organization administrator can create an expiring club administrator invitation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000002',true);

insert into pack4_runtime(label,id)
values (
  'club_admin_membership',
  public.accept_membership_invitation(
    (select id from pack4_runtime where label='club_admin_invite')
  )
);

select is(
  (
    select role::text
    from public.club_memberships
    where id=(select id from pack4_runtime where label='club_admin_membership')
  ),
  'club_admin',
  'matching account email can accept a club administrator invitation'
);

insert into pack4_runtime(label,id)
values (
  'team',
  public.create_team(
    '41000000-0000-0000-0000-000000000010',
    (select id from pack4_runtime where label='club'),
    'Pack Four Reavers',
    'P4R',
    'Red Deer',
    'public',
    'Pack 4 test team'
  )
);

select is(
  (
    select status::text
    from public.teams
    where id=(select id from pack4_runtime where label='team')
  ),
  'pending',
  'a club administrator created team requires organization approval'
);

select is(
  (
    select is_active
    from public.teams
    where id=(select id from pack4_runtime where label='team')
  ),
  false,
  'pending team is not active for applications or public operations'
);

select throws_ok(
  format(
    'select public.request_membership(%L::public.membership_scope,%L::uuid,null,%L::public.team_role,null)',
    'team',
    (select id from pack4_runtime where label='team'),
    'fighter'
  ),
  'P0001',
  'Active team not found',
  'membership applications are blocked until the team is approved'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

select lives_ok(
  format(
    'select public.set_team_status(%L::uuid,%L::public.team_status)',
    (select id from pack4_runtime where label='team'),
    'active'
  ),
  'organization administrator can approve a pending team'
);

select is(
  (
    select is_active
    from public.teams
    where id=(select id from pack4_runtime where label='team')
  ),
  true,
  'approved team becomes active'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000002',true);

insert into pack4_runtime(label,id)
values (
  'team_admin_invite',
  public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'team-admin@pack4.test',
    null,
    'team_admin',
    null
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000003',true);

insert into pack4_runtime(label,id)
values (
  'team_admin_membership',
  public.accept_membership_invitation(
    (select id from pack4_runtime where label='team_admin_invite')
  )
);

insert into pack4_runtime(label,id)
values (
  'captain_invite',
  public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'captain@pack4.test',
    null,
    'captain',
    null
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000004',true);

insert into pack4_runtime(label,id)
values (
  'captain_membership',
  public.accept_membership_invitation(
    (select id from pack4_runtime where label='captain_invite')
  )
);

insert into pack4_runtime(label,id)
values (
  'fighter_invite',
  public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'fighter@pack4.test',
    null,
    'fighter',
    'Join the roster'
  )
);

select throws_ok(
  $$select public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'support@pack4.test',
    null,
    'captain',
    null
  )$$,
  'P0001',
  'Only team, club, or organization administrators can assign captains',
  'captain cannot mint another captain'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000005',true);

insert into pack4_runtime(label,id)
values (
  'fighter_membership',
  public.accept_membership_invitation(
    (select id from pack4_runtime where label='fighter_invite')
  )
);

select is(
  (
    select role::text
    from public.team_memberships
    where id=(select id from pack4_runtime where label='fighter_membership')
  ),
  'fighter',
  'fighter invitation becomes an active historical team membership'
);

insert into pack4_runtime(label,id)
values (
  'support_application',
  public.request_membership(
    'team',
    (select id from pack4_runtime where label='team'),
    null,
    'support',
    'I can help with team logistics'
  )
);

select is(
  (
    select status::text
    from public.membership_requests
    where id=(select id from pack4_runtime where label='support_application')
  ),
  'pending',
  'fighter can apply for a permitted additional team role'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000004',true);

select lives_ok(
  format(
    'select public.review_membership_application(%L::uuid,%L)',
    (select id from pack4_runtime where label='support_application'),
    'accept'
  ),
  'captain can accept a normal fighter or support membership application'
);

select ok(
  exists(
    select 1
    from public.team_memberships
    where team_id=(select id from pack4_runtime where label='team')
      and user_id='41000000-0000-0000-0000-000000000005'
      and role='support'
      and ends_on is null
  ),
  'accepted application creates the requested active membership'
);

select throws_ok(
  format(
    'select public.change_membership_role(%L::public.membership_scope,%L::uuid,null,%L::public.team_role)',
    'team',
    (select id from pack4_runtime where label='fighter_membership'),
    'captain'
  ),
  'P0001',
  'Only team, club, or organization administrators can assign captains',
  'captain cannot promote a fighter to captain'
);

select lives_ok(
  format(
    'select public.change_membership_role(%L::public.membership_scope,%L::uuid,null,%L::public.team_role)',
    'team',
    (select id from pack4_runtime where label='fighter_membership'),
    'coach'
  ),
  'captain can move a lower role to coach'
);

select ok(
  exists(
    select 1
    from public.team_memberships
    where id=(select id from pack4_runtime where label='fighter_membership')
      and ends_on is not null
  ),
  'role change closes the previous membership period rather than deleting it'
);

select ok(
  exists(
    select 1
    from public.team_memberships
    where team_id=(select id from pack4_runtime where label='team')
      and user_id='41000000-0000-0000-0000-000000000005'
      and role='coach'
      and ends_on is null
  ),
  'role change starts a new active membership period'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000003',true);

insert into pack4_runtime(label,id)
values (
  'stale_invite',
  public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'support@pack4.test',
    null,
    'support',
    null
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

select lives_ok(
  format(
    'select public.end_membership(%L::public.membership_scope,%L::uuid,current_date)',
    'team',
    (select id from pack4_runtime where label='team_admin_membership')
  ),
  'organization administrator can revoke a non-last team administrator'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000006',true);

select throws_ok(
  format(
    'select public.accept_membership_invitation(%L::uuid)',
    (select id from pack4_runtime where label='stale_invite')
  ),
  'P0001',
  'The invitation issuer no longer has authority to grant this membership',
  'an invitation becomes unusable after its issuer loses grant authority'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

insert into pack4_runtime(label,id)
values (
  'email_guard_invite',
  public.create_membership_invitation(
    'team',
    (select id from pack4_runtime where label='team'),
    'support@pack4.test',
    null,
    'support',
    null
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000005',true);

select throws_ok(
  format(
    'select public.accept_membership_invitation(%L::uuid)',
    (select id from pack4_runtime where label='email_guard_invite')
  ),
  'P0001',
  'Invitation email does not match the signed-in account',
  'invitation token cannot be accepted by a different signed-in email'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000002',true);

select throws_ok(
  format(
    'select public.end_membership(%L::public.membership_scope,%L::uuid,current_date)',
    'team',
    (
      select id
      from public.team_memberships
      where team_id=(select id from pack4_runtime where label='team')
        and user_id='41000000-0000-0000-0000-000000000002'
        and role='team_admin'
        and ends_on is null
      limit 1
    )
  ),
  'P0001',
  'The last team administrator cannot be removed',
  'last team administrator protection prevents orphaning the team'
);

select throws_ok(
  $$insert into public.team_memberships(team_id,user_id,role,display_name)
    values(
      (select id from pack4_runtime where label='team'),
      '41000000-0000-0000-0000-000000000005',
      'team_admin',
      'Direct Escalation'
    )$$,
  '42501',
  null,
  'direct membership escalation is blocked by grants'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','42000000-0000-0000-0000-000000000001',true);

select is(
  (
    select count(*)::integer
    from public.teams
    where id=(select id from pack4_runtime where label='team')
  ),
  1,
  'public team remains visible to an unrelated organization through public visibility only'
);

select is(
  (
    select count(*)::integer
    from public.team_memberships
    where team_id=(select id from pack4_runtime where label='team')
  ),
  0,
  'unrelated organization administrator cannot read private team membership records'
);

select is(
  (
    select count(*)::integer
    from public.clubs
    where id=(select id from pack4_runtime where label='club')
  ),
  1,
  'public club remains visible without granting unrelated management access'
);

select is(
  (
    select count(*)::integer
    from public.club_memberships
    where club_id=(select id from pack4_runtime where label='club')
  ),
  0,
  'unrelated organization administrator cannot read private club membership records'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);

select is(
  (
    select count(*)::integer
    from public.teams
    where id=(select id from pack4_runtime where label='team')
  ),
  1,
  'anonymous spectators can read an approved public team'
);

select is(
  (
    select count(*)::integer
    from public.clubs
    where id=(select id from pack4_runtime where label='club')
  ),
  1,
  'anonymous spectators can read a public club'
);

select throws_ok(
  $$select * from public.team_memberships limit 1$$,
  '42501',
  null,
  'anonymous spectators cannot read team membership history'
);

select throws_ok(
  $$select * from public.membership_requests limit 1$$,
  '42501',
  null,
  'anonymous spectators cannot read invitations or applications'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

select ok(
  exists(
    select 1
    from public.audit_log
    where organization_id='41000000-0000-0000-0000-000000000010'
      and action='create_team'
      and record_id=(select id from pack4_runtime where label='team')
  ),
  'team creation is auditable'
);

select ok(
  exists(
    select 1
    from public.audit_log
    where organization_id='41000000-0000-0000-0000-000000000010'
      and action='review_membership_application'
      and record_id=(select id from pack4_runtime where label='support_application')
  ),
  'membership review decisions are auditable'
);

select * from finish();
rollback;
