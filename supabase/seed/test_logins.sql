-- Test accounts, one per role, for walking the site as each role (see /test-login). Paste into the Supabase SQL editor and Run.
--   * Emails are <role>@buhurtos.ca. BEFORE running, replace each SET-A-PASSWORD-FOR-... with a password of your choice (at least 8 characters).
--     Never commit real passwords.
--   * Safe to re-run: it removes only these six addresses first, then creates them again.
--   * Roles only reach the fictional NACL data: a NACL-test fighter, the Mountain Bears-test team, the Red Deer Rumble-test event and the
--     NACL-test organization. There is deliberately NO super admin / platform owner test account.
--   * Remove them all afterwards with supabase/seed/test_logins_remove.sql.

do $$
declare
  r record;
  v_uid uuid;
begin
  -- Only these six addresses are ever touched. Any other @buhurtos.ca account is left alone.
  delete from auth.users where email in ('fighter@buhurtos.ca', 'captain@buhurtos.ca', 'organizer@buhurtos.ca', 'orgadmin@buhurtos.ca', 'scorekeeper@buhurtos.ca', 'newuser@buhurtos.ca');

  for r in select * from (values
      ('fighter', 'SET-A-PASSWORD-FOR-FIGHTER'),
      ('captain', 'SET-A-PASSWORD-FOR-CAPTAIN'),
      ('organizer', 'SET-A-PASSWORD-FOR-ORGANIZER'),
      ('orgadmin', 'SET-A-PASSWORD-FOR-ORGADMIN'),
      ('scorekeeper', 'SET-A-PASSWORD-FOR-SCOREKEEPER'),
      ('newuser', 'SET-A-PASSWORD-FOR-NEWUSER')
    ) as t(role, pw)
  loop
    v_uid := gen_random_uuid();

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', r.role || '@buhurtos.ca',
            extensions.crypt(r.pw, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', case r.role when 'newuser' then '' else 'Test ' || r.role end),
            now(), now(), '', '', '', '');

    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', r.role || '@buhurtos.ca', 'email_verified', true), 'email', now(), now(), now());

    -- Everyone but newuser has done the first-sign-in profile step; newuser has not, so it lands on the profile screen.
    if r.role <> 'newuser' then
      update public.profiles set onboarded_at = now(),
        interests = array[case r.role when 'fighter' then 'fighter' when 'captain' then 'captain' else 'organizer' end]
      where id = v_uid;
    end if;

    if r.role = 'fighter' then
      insert into public.fighter_accounts (fighter_id, user_id)
      select id, v_uid from public.fighters where display_name like '%-test' and id not in (select fighter_id from public.fighter_accounts) order by display_name limit 1;
    elsif r.role = 'captain' then
      insert into public.team_roles (team_id, user_id, role) select id, v_uid, 'captain' from public.teams where name = 'Mountain Bears-test';
    elsif r.role in ('organizer', 'scorekeeper') then
      insert into public.event_staff (event_id, user_id, role) select id, v_uid, r.role from public.events where slug = 'red-deer-rumble-test';
    elsif r.role = 'orgadmin' then
      insert into public.organization_staff (organization_id, user_id, role) select id, v_uid, 'admin' from public.organizations where slug = 'nacl-test';
    end if;
  end loop;
end $$;
