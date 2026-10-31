-- Organization suggestions gate (20261114000100): anyone signed in suggests, only the platform owner reads and decides, approving creates the
-- organization (and optionally makes the suggester its admin), both sides are notified, nothing is deleted. Pack 18.1 fixture (fictional people):
-- u12 platform owner, u1 and u10 ordinary accounts. Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
insert into public.organizations (slug, name, short_name, kind) values ('known-league', 'Known League', 'KL', 'national');
create function t.sugg(n text) returns uuid language sql stable security definer as $$ select id from public.organization_suggestions where name = n $$;
create function t.notes(u uuid, k text) returns int language sql stable security definer as $$ select count(*)::int from public.notifications where user_id = u and kind = k $$;
grant execute on all functions in schema t to authenticated, anon;

-- ================================================================ 1. who may suggest
select t.as_anon();
select t.expect_error('a visitor who is not signed in cannot suggest', $$select public.suggest_organization('{"name":"Visitor Club"}')$$);
select t.expect_error('the table is not readable through the API', $$select count(*) from public.organization_suggestions$$, '42501');

select t.as_user(t.u(1));
select t.expect_error('the table is not readable by a signed-in person either', $$select count(*) from public.organization_suggestions$$, '42501');
select t.expect_error('the table is not writable directly', $$insert into public.organization_suggestions (name, kind) values ('Sneaky', 'club')$$, '42501');
select t.expect_error('a name is required', $$select public.suggest_organization('{"name":" "}')$$, '22023');
select t.expect_error('an unknown kind is refused', $$select public.suggest_organization('{"name":"Odd Club","kind":"empire"}')$$, '22023');
select t.expect_error('a website that is not a web address is refused', $$select public.suggest_organization('{"name":"Odd Club","website":"not a site"}')$$, '22023');
select t.expect_error('an organization already listed is refused by name', $$select public.suggest_organization('{"name":"  known   league "}')$$, '23505');
select t.expect_error('an organization already listed is refused by short name', $$select public.suggest_organization('{"name":"kl"}')$$, '23505');
select t.expect_ok('u1 suggests Prairie Buhurt League', $$select public.suggest_organization('{"name":"Prairie  Buhurt League","short_name":"PBL","kind":"regional","country":"Canada","region":"Alberta","website":"prairiebuhurt.ca","involvement":"admin","note":"I run it"}')$$);
select t.expect_ok('u1 suggests Lone Club', $$select public.suggest_organization('{"name":"Lone Club"}')$$);

select t.as_admin();
select t.expect_eq('spaces are tidied and the website gets https://', (select name || '|' || website || '|' || kind || '|' || involvement from public.organization_suggestions where id = t.sugg('Prairie Buhurt League')),
  'Prairie Buhurt League|https://prairiebuhurt.ca|regional|admin');
select t.expect_eq('a bare suggestion defaults to a club', (select kind || '|' || involvement || '|' || status from public.organization_suggestions where id = t.sugg('Lone Club')), 'club|none|pending');
select t.expect_eq('the owner is notified of each suggestion', t.notes(t.u(12), 'organization_suggested'), 2);
select t.expect_eq('nobody else is notified', (select count(*)::int from public.notifications where kind = 'organization_suggested' and user_id <> t.u(12)), 0);

select t.as_user(t.u(10));
select t.expect_error('the same name waiting for review is refused for someone else', $$select public.suggest_organization('{"name":"prairie buhurt league"}')$$, '23505');
select t.expect_eq('u10 sees none of u1''s suggestions', (select count(*)::int from public.my_organization_suggestions()), 0);
select t.expect_error('u10 cannot read the review list', $$select * from public.admin_organization_suggestions()$$, '42501');
select t.expect_error('u10 cannot approve', format('select public.decide_organization_suggestion(%L, ''approved'')', t.sugg('Lone Club')), '42501');
select t.as_user(t.u(1));
select t.expect_eq('u1 sees their two suggestions, waiting', (select string_agg(status, ',') from public.my_organization_suggestions()), 'pending,pending');
select t.expect_error('u1 cannot decide their own suggestion', format('select public.decide_organization_suggestion(%L, ''approved'')', t.sugg('Lone Club')), '42501');

-- rate limit: five a day per person
select t.as_user(t.u(10));
select public.suggest_organization(jsonb_build_object('name', 'Rate Club ' || n)) from generate_series(1, 5) n;
select t.expect_error('a sixth suggestion in a day is refused', $$select public.suggest_organization('{"name":"Rate Club 6"}')$$, 'P0001');

-- ================================================================ 2. owner review and decisions
select t.as_user(t.u(12));
select t.expect_eq('the owner sees every waiting suggestion with who sent it',
  (select person_name is not null or email is not null from public.admin_organization_suggestions('pending') where name = 'Prairie Buhurt League'), true);
select t.expect_eq('waiting count', (select count(*)::int from public.admin_organization_suggestions('pending')), 7);
select t.expect_error('a taken web address is refused', format($$select public.decide_organization_suggestion(%L, 'approved', null, '{"slug":"known-league"}')$$, t.sugg('Prairie Buhurt League')), '23505');
select t.expect_error('a bad web address is refused', format($$select public.decide_organization_suggestion(%L, 'approved', null, '{"slug":"Bad Slug"}')$$, t.sugg('Prairie Buhurt League')), '22023');
select t.expect_ok('the owner approves PBL, fixing the description and making u1 its admin',
  format($$select public.decide_organization_suggestion(%L, 'approved', 'Welcome', '{"description":"Buhurt across the prairies"}', true)$$, t.sugg('Prairie Buhurt League')));
select t.expect_ok('the owner declines Lone Club with a note', format($$select public.decide_organization_suggestion(%L, 'declined', 'We could not find this club')$$, t.sugg('Lone Club')));
select t.expect_error('a decided suggestion cannot be decided again', format($$select public.decide_organization_suggestion(%L, 'approved')$$, t.sugg('Lone Club')), 'P0001');

select t.as_admin();
select t.expect_eq('the organization exists, switched on, with the checked fields',
  (select slug || '|' || name || '|' || short_name || '|' || kind || '|' || country || '|' || region || '|' || website || '|' || description || '|' || enabled from public.organizations where name = 'Prairie Buhurt League'),
  'pbl|Prairie Buhurt League|PBL|regional|Canada|Alberta|https://prairiebuhurt.ca|Buhurt across the prairies|true');
select t.expect_eq('u1 is its admin', (select count(*)::int from public.organization_staff s join public.organizations o on o.id = s.organization_id where o.slug = 'pbl' and s.user_id = t.u(1) and s.role = 'admin'), 1);
select t.expect_eq('the suggestion is kept and linked', (select status || '|' || (organization_id is not null) || '|' || decision_note from public.organization_suggestions where id = t.sugg('Prairie Buhurt League')), 'approved|true|Welcome');
select t.expect_eq('the declined suggestion is kept', (select status || '|' || (organization_id is null) from public.organization_suggestions where id = t.sugg('Lone Club')), 'declined|true');
select t.expect_eq('u1 is told about both decisions', t.notes(t.u(1), 'organization_suggestion_decided'), 2);
select t.expect_eq('the approval notification links the new organization',
  (select payload ->> 'organization_slug' || '|' || (payload ->> 'admin') from public.notifications where user_id = t.u(1) and kind = 'organization_suggestion_decided' and payload ->> 'decision' = 'approved'), 'pbl|true');
select t.expect_eq('every step is in the audit log', (select count(*)::int from public.audit_log where action in ('organization.suggested', 'organization.created', 'organization.admin_granted', 'organization.suggestion_decided')), 11);

select t.as_user(t.u(1));
select t.expect_eq('u1 sees the outcome and the new address', (select string_agg(status || ':' || coalesce(organization_slug, '-'), ',' order by name) from public.my_organization_suggestions()), 'declined:-,approved:pbl');
select t.expect_error('now that PBL is listed, suggesting it again is refused', $$select public.suggest_organization('{"name":"PBL"}')$$, '23505');

-- approve without making anyone admin, slug from the name
select t.as_user(t.u(12));
select t.expect_ok('the owner approves Rate Club 1 as is', format($$select public.decide_organization_suggestion(%L, 'approved')$$, t.sugg('Rate Club 1')));
select t.as_admin();
select t.expect_eq('slug made from the name, no admin added', (select o.slug || '|' || (select count(*) from public.organization_staff s where s.organization_id = o.id) from public.organizations o where o.name = 'Rate Club 1'), 'rate-club-1|0');

select t.expect_eq('API roles cannot call the helpers',
  (select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated']) r,
     unnest(array['private.org_sugg_text(jsonb,text)', 'private.org_sugg_website(text)', 'private.org_sugg_fold(text)']) f), false);
select t.expect_eq('visitors cannot call any of the functions',
  (select bool_or(has_function_privilege('anon', f, 'execute')) from unnest(array['public.suggest_organization(jsonb)', 'public.my_organization_suggestions()',
     'public.admin_organization_suggestions(text)', 'public.decide_organization_suggestion(uuid,text,text,jsonb,boolean)']) f), false);

do $$ begin raise notice 'ORGANIZATION SUGGESTIONS GATE PASSED % checks', (select count(*) from t.log); end $$;
rollback;
