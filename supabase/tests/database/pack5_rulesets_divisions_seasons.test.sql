begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('51000000-0000-0000-0000-000000000001','authenticated','authenticated','pack5-admin-a@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack 5 Admin A"}',timezone('utc',now()),timezone('utc',now())),
('51000000-0000-0000-0000-000000000002','authenticated','authenticated','pack5-organizer@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack 5 Organizer"}',timezone('utc',now()),timezone('utc',now())),
('52000000-0000-0000-0000-000000000001','authenticated','authenticated','pack5-admin-b@buhurtos.test','',timezone('utc',now()),'{}','{"display_name":"Pack 5 Admin B"}',timezone('utc',now()),timezone('utc',now()));

insert into public.profiles(id,display_name)
values
('51000000-0000-0000-0000-000000000001','Pack 5 Admin A'),
('51000000-0000-0000-0000-000000000002','Pack 5 Organizer'),
('52000000-0000-0000-0000-000000000001','Pack 5 Admin B')
on conflict(id) do nothing;

insert into public.organizations(id,name,short_name,region,status)
values
('51000000-0000-0000-0000-000000000010','Pack Five Org A','P5A','Test A','active'),
('52000000-0000-0000-0000-000000000010','Pack Five Org B','P5B','Test B','active');

insert into public.organization_memberships(organization_id,user_id,role)
values
('51000000-0000-0000-0000-000000000010','51000000-0000-0000-0000-000000000001','organization_admin'),
('52000000-0000-0000-0000-000000000010','52000000-0000-0000-0000-000000000001','organization_admin');

insert into public.seasons(
  id,organization_id,name,starts_at,ends_at,status,created_by,last_edited_by
) values
('51000000-0000-0000-0000-000000000020','51000000-0000-0000-0000-000000000010','2026 Season','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','active','51000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001'),
('52000000-0000-0000-0000-000000000020','52000000-0000-0000-0000-000000000010','2026 Season B','2026-01-01T00:00:00Z','2026-12-31T23:59:59Z','active','52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001');

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone,created_by,last_edited_by
) values
('51000000-0000-0000-0000-000000000030','51000000-0000-0000-0000-000000000010','51000000-0000-0000-0000-000000000020','Pack Five Event','Arena','2026-09-26T15:00:00Z','2026-09-27T23:00:00Z','ranked_competitive','season_and_event','draft','UTC','51000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001');

insert into public.event_memberships(event_id,user_id,role)
values('51000000-0000-0000-0000-000000000030','51000000-0000-0000-0000-000000000002','event_organizer');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-0000-0000-000000000001',true);

insert into public.rulesets(
  id,organization_id,name,short_name,version,status,settings,
  eligibility_policy,scoring_policy,tournament_policy,ranking_policy
) values (
  '51000000-0000-0000-0000-000000000100',
  '51000000-0000-0000-0000-000000000010',
  'Pack Five Base Rules','P5 BASE','2026.1','draft',
  '{"enabledFormats":["longsword","5v5"],"compliance":{"requireWeighIn":true},"discipline":{"yellowCardsBeforeSuspension":2},"bracket":{"antiFratricide":true}}',
  '{"minimumAge":18}',
  '{"duels":{"sourceDriven":true}}',
  '{"bracketPolicy":"source-driven"}',
  '{"method":"organization-defined"}'
);

select lives_ok(
  $$insert into public.ruleset_sources(
    id,ruleset_id,label,source_url,version_label,source_kind,accessed_on
  ) values(
    '51000000-0000-0000-0000-000000000110',
    '51000000-0000-0000-0000-000000000100',
    'Official governing rules',
    'https://www.buhurtinternational.com/rules',
    '2026 source review',
    'official',
    '2026-09-24'
  )$$,
  'organization admin can attach a source to a draft ruleset'
);

select lives_ok(
  format(
    'select public.transition_ruleset_guarded(%L::uuid,%L::timestamptz,%L)',
    '51000000-0000-0000-0000-000000000100',
    (select updated_at::text from public.rulesets where id='51000000-0000-0000-0000-000000000100'),
    'review'
  ),
  'draft ruleset can enter review'
);

select lives_ok(
  format(
    'select public.transition_ruleset_guarded(%L::uuid,%L::timestamptz,%L)',
    '51000000-0000-0000-0000-000000000100',
    (select updated_at::text from public.rulesets where id='51000000-0000-0000-0000-000000000100'),
    'published'
  ),
  'reviewed sourced ruleset can be published'
);

select throws_ok(
  $$update public.rulesets
    set description='silently changed after publication'
    where id='51000000-0000-0000-0000-000000000100'$$,
  'P0001',
  'Only draft rulesets can be edited',
  'published ruleset content is immutable'
);

insert into public.rulesets(
  id,organization_id,parent_ruleset_id,name,short_name,version,status,settings,
  eligibility_policy,scoring_policy,tournament_policy,ranking_policy,
  effective_from,effective_to
) values (
  '51000000-0000-0000-0000-000000000101',
  '51000000-0000-0000-0000-000000000010',
  '51000000-0000-0000-0000-000000000100',
  'Pack Five Child Rules','P5 CHILD','2026.2','draft',
  '{"enabledFormats":["longsword"],"compliance":{"requireWeighIn":false},"scoringOverrides":{"longsword":{"roundsRequired":5}}}',
  '{"medicalDeclarationRequired":true}',
  '{"duels":{"localOverride":"documented"}}',
  '{"fieldCount":3}',
  '{"minimumRankedEntrants":3}',
  '2026-01-01T00:00:00Z','2027-01-01T00:00:00Z'
);

insert into public.ruleset_sources(
  ruleset_id,label,source_url,version_label,source_kind,accessed_on
) values (
  '51000000-0000-0000-0000-000000000101',
  'Organization amendment',
  'https://www.hacsacanada.com/buhurt-international-rules',
  'Reviewed 2026-09-24',
  'organization',
  '2026-09-24'
);

select public.transition_ruleset_guarded(
  '51000000-0000-0000-0000-000000000101',
  (select updated_at from public.rulesets where id='51000000-0000-0000-0000-000000000101'),
  'review'
);
select public.transition_ruleset_guarded(
  '51000000-0000-0000-0000-000000000101',
  (select updated_at from public.rulesets where id='51000000-0000-0000-0000-000000000101'),
  'published'
);

select lives_ok(
  format(
    'select public.assign_event_ruleset_guarded(%L::uuid,%L::uuid,%L::timestamptz,null)',
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000101',
    (select updated_at::text from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'event can lock a published ruleset snapshot'
);

select is(
  (
    select resolved_settings #>> '{compliance,requireWeighIn}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'false',
  'child ruleset overrides parent compliance in immutable event snapshot'
);

select is(
  (
    select resolved_settings #>> '{bracket,antiFratricide}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'true',
  'child ruleset preserves inherited bracket policy in event snapshot'
);

select is(
  (
    select eligibility_policy #>> '{minimumAge}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  '18',
  'event snapshot inherits eligibility policy independently'
);

select is(
  (
    select eligibility_policy #>> '{medicalDeclarationRequired}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'true',
  'event snapshot merges child eligibility overrides'
);

select is(
  (
    select resolved_settings #>> '{scoringOverrides,longsword,roundsRequired}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  '5',
  'event snapshot stores resolved scoring configuration'
);

select is(
  (
    select eligibility_policy #>> '{minimumAge}'
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  '18',
  'event snapshot stores inherited eligibility policy'
);

select cmp_ok(
  (
    select jsonb_array_length(source_snapshot)
    from public.event_ruleset_snapshots
    where id=(select ruleset_snapshot_id from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  '>=',
  2,
  'event snapshot stores source provenance from the inheritance chain'
);

insert into public.competition_divisions(
  id,organization_id,name,slug,competition_format_id,ruleset_id,team_size,
  age_min,min_experience_years,eligibility_label,eligibility_rules,eligibility_explanation,status
) values (
  '51000000-0000-0000-0000-000000000200',
  '51000000-0000-0000-0000-000000000010',
  'Adult Longsword','adult-longsword','longsword',
  '51000000-0000-0000-0000-000000000101',
  1,18,0,
  'Adult division',
  '[{"kind":"age","min":18,"label":"At least 18 on event start"},{"kind":"declaration","key":"equipment_check","label":"Pass equipment check"}]',
  'Age is evaluated on the event date. Equipment eligibility requires organizer confirmation.',
  'draft'
);

update public.competition_divisions
set status='published'
where id='51000000-0000-0000-0000-000000000200';

select throws_ok(
  $$update public.competition_divisions
    set age_min=21
    where id='51000000-0000-0000-0000-000000000200'$$,
  'P0001',
  'Published and retired divisions are immutable; create a new version',
  'published division eligibility cannot be rewritten'
);

select lives_ok(
  $$select public.assign_event_division_guarded(
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000200',
    32
  )$$,
  'published division can be assigned to a draft event through governed mutation'
);

select is(
  (
    select division_snapshot #>> '{version}'
    from public.event_divisions
    where event_id='51000000-0000-0000-0000-000000000030'
      and division_id='51000000-0000-0000-0000-000000000200'
  ),
  '1',
  'event division records immutable division version snapshot'
);

select is(
  (
    select ruleset_snapshot_id::text
    from public.event_divisions
    where event_id='51000000-0000-0000-0000-000000000030'
      and division_id='51000000-0000-0000-0000-000000000200'
  ),
  (select ruleset_snapshot_id::text from public.events where id='51000000-0000-0000-0000-000000000030'),
  'division using the event default ruleset reuses the event rules snapshot'
);

select throws_ok(
  format(
    'select public.assign_event_ruleset_guarded(%L::uuid,null,%L::timestamptz,null)',
    '51000000-0000-0000-0000-000000000030',
    (select updated_at::text from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'P0001',
  'Remove event divisions and competition structures before changing the event ruleset',
  'event rules cannot be cleared underneath assigned divisions'
);

insert into public.competition_divisions(
  id,organization_id,name,slug,competition_format_id,ruleset_id,team_size,
  eligibility_label,eligibility_rules,status
) values (
  '51000000-0000-0000-0000-000000000201',
  '51000000-0000-0000-0000-000000000010',
  'Base Rules Five on Five','base-rules-five','5v5',
  '51000000-0000-0000-0000-000000000100',
  5,'Base rules team division','[]','draft'
);
update public.competition_divisions
set status='published'
where id='51000000-0000-0000-0000-000000000201';

select lives_ok(
  $$select public.assign_event_division_guarded(
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000201',
    8
  )$$,
  'division-specific published ruleset can override the event default'
);

select is(
  (
    select ruleset_id::text
    from public.event_divisions
    where event_id='51000000-0000-0000-0000-000000000030'
      and division_id='51000000-0000-0000-0000-000000000201'
  ),
  '51000000-0000-0000-0000-000000000100',
  'event division stores its effective division-specific ruleset'
);

select is(
  (
    select s.ruleset_id::text
    from public.event_divisions ed
    join public.event_ruleset_snapshots s on s.id=ed.ruleset_snapshot_id
    where ed.event_id='51000000-0000-0000-0000-000000000030'
      and ed.division_id='51000000-0000-0000-0000-000000000201'
  ),
  '51000000-0000-0000-0000-000000000100',
  'division-specific ruleset is independently snapshotted for the event'
);

select lives_ok(
  $$select public.create_division_version('51000000-0000-0000-0000-000000000200')$$,
  'published division can be cloned into a new draft version'
);

select is(
  (
    select max(version)::text
    from public.competition_divisions
    where organization_id='51000000-0000-0000-0000-000000000010'
      and slug='adult-longsword'
  ),
  '2',
  'division versioning increments without rewriting version one'
);

update public.competition_divisions
set status='retired'
where id='51000000-0000-0000-0000-000000000200';

select is(
  (
    select division_snapshot #>> '{ageMin}'
    from public.event_divisions
    where event_id='51000000-0000-0000-0000-000000000030'
      and division_id='51000000-0000-0000-0000-000000000200'
  ),
  '18',
  'retiring a division does not alter the event snapshot'
);

select lives_ok(
  format(
    'select public.remove_event_division_guarded(%L::uuid,%L::timestamptz)',
    (select id::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000030' and division_id='51000000-0000-0000-0000-000000000200'),
    (select updated_at::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000030' and division_id='51000000-0000-0000-0000-000000000200')
  ),
  'event division can be removed with its current record version'
);

select lives_ok(
  format(
    'select public.remove_event_division_guarded(%L::uuid,%L::timestamptz)',
    (select id::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000030' and division_id='51000000-0000-0000-0000-000000000201'),
    (select updated_at::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000030' and division_id='51000000-0000-0000-0000-000000000201')
  ),
  'division-specific event assignment can be removed before competition'
);


update public.seasons
set default_ruleset_id='51000000-0000-0000-0000-000000000101'
where id='51000000-0000-0000-0000-000000000020';

insert into public.events(
  id,organization_id,season_id,name,venue,starts_at,ends_at,event_type,standings_mode,status,timezone,created_by,last_edited_by
) values (
  '51000000-0000-0000-0000-000000000031',
  '51000000-0000-0000-0000-000000000010',
  '51000000-0000-0000-0000-000000000020',
  'Pack Five Bracket Event','Second Arena',
  '2026-10-10T15:00:00Z','2026-10-10T23:00:00Z',
  'ranked_competitive','season_and_event','draft','UTC',
  '51000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001'
);

select is(
  (select ruleset_id::text from public.events where id='51000000-0000-0000-0000-000000000031'),
  '51000000-0000-0000-0000-000000000101',
  'new event inherits the season default published ruleset'
);

select lives_ok(
  $select public.assign_event_division_guarded(
    '51000000-0000-0000-0000-000000000031',
    '51000000-0000-0000-0000-000000000200',
    16,
    null
  )$,
  'assigning a formal division locks the inherited season ruleset snapshot'
);

insert into public.event_roster_entries(
  id,organization_id,event_id,entry_type,display_name,
  checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared,attendance_status
) values
('51000000-0000-0000-0000-000000000300','51000000-0000-0000-0000-000000000010','51000000-0000-0000-0000-000000000031','fighter','Bracket Fighter One',true,true,true,true,true,'approved'),
('51000000-0000-0000-0000-000000000301','51000000-0000-0000-0000-000000000010','51000000-0000-0000-0000-000000000031','fighter','Bracket Fighter Two',true,true,true,true,true,'approved');

select lives_ok(
  $select public.save_bracket_plan(
    '{
      "id":"51000000-0000-0000-0000-000000000400",
      "eventId":"51000000-0000-0000-0000-000000000031",
      "divisionId":"51000000-0000-0000-0000-000000000200",
      "fightCardId":"",
      "name":"Adult Longsword Test",
      "format":"single_elimination",
      "category":"Adult Longsword",
      "metadata":{}
    }'::jsonb,
    '[
      {
        "id":"51000000-0000-0000-0000-000000000410",
        "fightCardId":"",
        "label":"Final",
        "category":"Adult Longsword",
        "matchType":"longsword",
        "scoringConfig":{"kind":"duel","roundsRequired":5,"allowDrawRound":false,"requireReasonOnForfeit":true},
        "status":"scheduled",
        "stage":"final",
        "scheduledOrder":1,
        "bracketRound":1,
        "bracketSlot":"1-1",
        "participants":[
          {"rosterEntryId":"51000000-0000-0000-0000-000000000300","sideIndex":1,"seed":1},
          {"rosterEntryId":"51000000-0000-0000-0000-000000000301","sideIndex":2,"seed":2}
        ]
      }
    ]'::jsonb
  )$,
  'bracket creation accepts scoring that contains the locked snapshot override'
);

select is(
  (select division_id::text from public.brackets where id='51000000-0000-0000-0000-000000000400'),
  '51000000-0000-0000-0000-000000000200',
  'bracket retains its formal division version'
);

select is(
  (
    select ruleset_snapshot_id::text
    from public.brackets
    where id='51000000-0000-0000-0000-000000000400'
  ),
  (
    select ruleset_snapshot_id::text
    from public.event_divisions
    where event_id='51000000-0000-0000-0000-000000000031'
      and division_id='51000000-0000-0000-0000-000000000200'
  ),
  'bracket retains the event division ruleset snapshot'
);

select is(
  (select ruleset_snapshot_id::text from public.matches where id='51000000-0000-0000-0000-000000000410'),
  (select ruleset_snapshot_id::text from public.brackets where id='51000000-0000-0000-0000-000000000400'),
  'match inherits the bracket ruleset snapshot'
);

select is(
  (select scoring_config #>> '{roundsRequired}' from public.matches where id='51000000-0000-0000-0000-000000000410'),
  '5',
  'match persists scoring resolved from the locked ruleset'
);

select throws_ok(
  $select public.save_bracket_plan(
    '{
      "id":"51000000-0000-0000-0000-000000000401",
      "eventId":"51000000-0000-0000-0000-000000000031",
      "divisionId":"51000000-0000-0000-0000-000000000200",
      "fightCardId":"",
      "name":"Bad Scoring Test",
      "format":"single_elimination",
      "category":"Adult Longsword",
      "metadata":{}
    }'::jsonb,
    '[
      {
        "id":"51000000-0000-0000-0000-000000000411",
        "fightCardId":"",
        "label":"Final",
        "category":"Adult Longsword",
        "matchType":"longsword",
        "scoringConfig":{"kind":"duel","roundsRequired":3},
        "status":"scheduled",
        "stage":"final",
        "scheduledOrder":1,
        "participants":[]
      }
    ]'::jsonb
  )$,
  'P0001',
  'Match scoring does not include the locked ruleset override',
  'database rejects bracket scoring that contradicts the locked rules snapshot'
);

select throws_ok(
  format(
    'select public.remove_event_division_guarded(%L::uuid,%L::timestamptz)',
    (select id::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000031' and division_id='51000000-0000-0000-0000-000000000200'),
    (select updated_at::text from public.event_divisions where event_id='51000000-0000-0000-0000-000000000031' and division_id='51000000-0000-0000-0000-000000000200')
  ),
  'P0001',
  'Remove the division competition structure before removing the event division',
  'event division cannot be removed underneath an existing bracket'
);

update public.events
set status='completed'
where id='51000000-0000-0000-0000-000000000031';

insert into public.rulesets(
  id,organization_id,name,short_name,version,status,settings,effective_from
) values (
  '51000000-0000-0000-0000-000000000102',
  '51000000-0000-0000-0000-000000000010',
  'Future Rules','FUTURE','2027.1','draft',
  '{"enabledFormats":["longsword"]}',
  '2027-01-01T00:00:00Z'
);
insert into public.ruleset_sources(ruleset_id,label,source_url,version_label,source_kind,accessed_on)
values(
  '51000000-0000-0000-0000-000000000102',
  'Future source',
  'https://www.buhurtinternational.com/rules',
  'Future test source',
  'official',
  '2026-09-24'
);
select public.transition_ruleset_guarded(
  '51000000-0000-0000-0000-000000000102',
  (select updated_at from public.rulesets where id='51000000-0000-0000-0000-000000000102'),
  'review'
);
select public.transition_ruleset_guarded(
  '51000000-0000-0000-0000-000000000102',
  (select updated_at from public.rulesets where id='51000000-0000-0000-0000-000000000102'),
  'published'
);

select throws_ok(
  format(
    'select public.assign_event_ruleset_guarded(%L::uuid,%L::uuid,%L::timestamptz,%L)',
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000102',
    (select updated_at::text from public.events where id='51000000-0000-0000-0000-000000000030'),
    ''
  ),
  'P0001',
  'Event date is outside the ruleset effective window; record an exception reason',
  'out-of-window rules require an explicit exception reason'
);

select lives_ok(
  format(
    'select public.assign_event_ruleset_guarded(%L::uuid,%L::uuid,%L::timestamptz,%L)',
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000102',
    (select updated_at::text from public.events where id='51000000-0000-0000-0000-000000000030'),
    'Organizer approved this documented one-event exception.'
  ),
  'out-of-window rules can only be assigned with an audited exception'
);

select is(
  (
    select count(*)::integer
    from public.event_policy_exceptions
    where event_id='51000000-0000-0000-0000-000000000030'
      and rule_key='ruleset_effective_window'
      and status='approved'
  ),
  1,
  'effective-window exception is explicitly recorded'
);

update public.events
set status='live'
where id='51000000-0000-0000-0000-000000000030';

select throws_ok(
  format(
    'select public.assign_event_ruleset_guarded(%L::uuid,%L::uuid,%L::timestamptz,null)',
    '51000000-0000-0000-0000-000000000030',
    '51000000-0000-0000-0000-000000000101',
    (select updated_at::text from public.events where id='51000000-0000-0000-0000-000000000030')
  ),
  'P0001',
  'Live or historical events cannot change rulesets',
  'live event cannot switch ruleset snapshots'
);

select throws_ok(
  $$update public.seasons
    set ends_at='2026-09-01T00:00:00Z'
    where id='51000000-0000-0000-0000-000000000020'$$,
  'P0001',
  'Season policy and dates are locked after live competition begins',
  'season dates cannot be rewritten after live competition begins'
);

select throws_ok(
  $$update public.seasons
    set status='archived'
    where id='51000000-0000-0000-0000-000000000020'$$,
  'P0001',
  'A season cannot be archived while it has unfinished events',
  'season cannot archive while a live event remains unfinished'
);

update public.events
set status='completed'
where id='51000000-0000-0000-0000-000000000030';

select lives_ok(
  $$update public.seasons
    set status='archived'
    where id='51000000-0000-0000-0000-000000000020'$$,
  'completed season can be archived'
);

select throws_ok(
  $$update public.seasons
    set name='Rewritten historical season'
    where id='51000000-0000-0000-0000-000000000020'$$,
  'P0001',
  'Archived seasons are immutable',
  'archived season cannot be rewritten'
);

insert into public.rulesets(
  id,organization_id,name,short_name,version,status,settings
) values (
  '51000000-0000-0000-0000-000000000103',
  '51000000-0000-0000-0000-000000000010',
  'Unsourced Rules','NO SOURCE','1.0','draft','{}'
);
insert into public.ruleset_sources(
  ruleset_id,label,version_label,source_kind,notes,accessed_on
) values (
  '51000000-0000-0000-0000-000000000103',
  'Internal drafting memo',
  'Internal working note',
  'internal',
  'This may support drafting but is intentionally not public provenance.',
  '2026-09-24'
);
select public.transition_ruleset_guarded(
  '51000000-0000-0000-0000-000000000103',
  (select updated_at from public.rulesets where id='51000000-0000-0000-0000-000000000103'),
  'review'
);

select throws_ok(
  format(
    'select public.transition_ruleset_guarded(%L::uuid,%L::timestamptz,%L)',
    '51000000-0000-0000-0000-000000000103',
    (select updated_at::text from public.rulesets where id='51000000-0000-0000-0000-000000000103'),
    'published'
  ),
  'P0001',
  'A reviewed ruleset needs at least one public source before publication',
  'internal-only evidence cannot be used to silently publish a ruleset'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','52000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$update public.rulesets
    set description='cross organization change'
    where id='51000000-0000-0000-0000-000000000101'$$,
  '42501',
  null,
  'unrelated organization admin cannot mutate another organization ruleset'
);

select is(
  (
    select count(*)::integer
    from public.event_policy_exceptions
    where event_id='51000000-0000-0000-0000-000000000030'
  ),
  0,
  'unrelated organization cannot read another event policy exceptions'
);

select * from finish();
rollback;
