-- The Pack 22 discipline fixture on the REAL_AUTH stack (the real Supabase Auth server owns auth.*): everything in pack22d.sql, and every account
-- gets a real bcrypt password ("Fixture-pass-22") and an email identity, in the shape the Pack 18 fixture uses, so each role signs in through Auth.
\i scripts/e2e/fixtures/pack22d.sql
update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated',
  encrypted_password = extensions.crypt('Fixture-pass-22', extensions.gen_salt('bf', 4)),
  email_confirmed_at = now(), raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  created_at = coalesce(created_at, now()), updated_at = now(),
  confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '', email_change_token_current = '', reauthentication_token = '',
  phone_change = '', phone_change_token = '';
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u;
