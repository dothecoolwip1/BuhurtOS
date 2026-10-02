-- Test accounts, one per role, for walking the site as each role (see /test-login). Run in the Supabase SQL editor.
--   * Emails are <role>@buhurtos-test.example. Passwords are generated here, at random, and shown ONCE in the result: copy them then.
--   * Safe to re-run: it first removes the old test accounts (and so their roles), then makes fresh ones with new passwords.
--   * Roles only reach the fictional NACL data: a NACL-test fighter, the Mountain Bears-test team, the Red Deer Rumble-test event and the
--     NACL-test organization. There is deliberately NO super admin / platform owner test account.
--   * Remove them all afterwards with supabase/seed/test_logins_remove.sql.

delete from auth.users where email like '%@buhurtos-test.example';

drop table if exists pg_temp.creds;
create temp table creds (role text, email text, password text, user_id uuid);
insert into creds (role, email, password)
select r, r || '@buhurtos-test.example', 'Bos-' || encode(extensions.gen_random_bytes(9), 'hex')
from unnest(array['fighter', 'captain', 'organizer', 'orgadmin', 'scorekeeper', 'newuser']) r;

with ins as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', c.email,
         extensions.crypt(c.password, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', case c.role when 'newuser' then '' else 'Test ' || c.role end),
         now(), now(), '', '', '', ''
  from creds c
  returning id, email
)
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), i.id::text, i.id, jsonb_build_object('sub', i.id::text, 'email', i.email, 'email_verified', true), 'email', now(), now(), now() from ins i;

update creds c set user_id = u.id from auth.users u where u.email = c.email;

-- Everyone but "newuser" has already done the first-sign-in profile step; "newuser" has not, so it lands on the profile screen.
update public.profiles p set onboarded_at = now(), interests = array[case c.role when 'fighter' then 'fighter' when 'captain' then 'captain' when 'newuser' then 'fan' else 'organizer' end]
from creds c where c.user_id = p.id and c.role <> 'newuser';

insert into public.fighter_accounts (fighter_id, user_id)
select f.id, c.user_id from creds c,
  (select id from public.fighters where display_name like '%-test' and id not in (select fighter_id from public.fighter_accounts) order by display_name limit 1) f
where c.role = 'fighter';

insert into public.team_roles (team_id, user_id, role)
select t.id, c.user_id, 'captain' from creds c, public.teams t where c.role = 'captain' and t.name = 'Mountain Bears-test';

insert into public.event_staff (event_id, user_id, role)
select e.id, c.user_id, case c.role when 'organizer' then 'organizer' else 'scorekeeper' end
from creds c, public.events e where c.role in ('organizer', 'scorekeeper') and e.slug = 'red-deer-rumble-test';

insert into public.organization_staff (organization_id, user_id, role)
select o.id, c.user_id, 'admin' from creds c, public.organizations o where c.role = 'orgadmin' and o.slug = 'nacl-test';

select role, email, password from creds order by role;
