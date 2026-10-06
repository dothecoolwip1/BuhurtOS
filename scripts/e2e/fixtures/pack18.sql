-- Local fixture for scripts/e2e/pack18-live.mjs (email + password sign-in and the Organizer Command Centre). LOCAL THROWAWAY DATABASE ONLY, loaded
-- after the migrations on the REAL_AUTH stack (the real Supabase Auth server owns auth.*).
-- Everything from the Pack 16 fixture (event "Test stuff test": Field 1 Longsword m1.., Field 2 Sword and shield m11..; Aldric, Brann, Cael, Dara
-- registered; a2 organizer, a4 scorekeeper, a7 stranger, c1 head marshal, d1 check-in desk, d2 inspector, d3 captain, d4 other event's desk,
-- fighter1/fighter2 = Aldric's / Brann's accounts), plus:
--   * every account gets a real bcrypt password ("Fixture-pass-18") in the shape the hosted test-login seed uses, so it signs in through the real
--     Auth server, EXCEPT c7 ("Counter Elm"), who has only ever used email codes (no password);
--   * a long fighter name and a long team name, for the layout review.
\i scripts/e2e/fixtures/pack16.sql

update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated',
  encrypted_password = case when email = 'c7@example.test' then '' else extensions.crypt('Fixture-pass-18', extensions.gen_salt('bf', 4)) end,
  email_confirmed_at = now(), raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  created_at = coalesce(created_at, now()), updated_at = now(),
  confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '', email_change_token_current = '', reauthentication_token = '',
  phone_change = '', phone_change_token = '';
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u;

update public.fighters set display_name = 'Edric Alexander Hale-Montgomery of the Northern Reaches' where id = '00000000-0000-0000-0000-00000000f105';
update public.teams set name = 'Iron Wolves of the Great Northern Plains Buhurt Club' where id = '00000000-0000-0000-0000-00000000a616';
update public.registrations set team_name = 'Iron Wolves of the Great Northern Plains Buhurt Club' where team_id = '00000000-0000-0000-0000-00000000a616';
