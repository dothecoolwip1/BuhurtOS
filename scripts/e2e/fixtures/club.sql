-- Local fixture for scripts/e2e/club-live.mjs (Red Deer Reavers membership, dues and voting; shared sign-in with the club website).
-- LOCAL THROWAWAY DATABASE ONLY, loaded after the migrations on the REAL_AUTH stack (the real Supabase Auth server owns auth.*).
-- Everyone signs in with the password "Fixture-pass-club" through the real Auth server.
--   pres@  President      sec@  Secretary      treas@  Treasurer      vp@  Vice President (no dues authority)
--   member@  Garrett-like active paid member      john@  active, dues unpaid      jane@  pending, paid      kid@  active, paid, under 18
--   newbie@  signed up, never applied      other@  Treasurer of another team      next@  next year's treasurer (no office yet)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c1e01', 'pres@example.test'), ('00000000-0000-0000-0000-0000000c1e02', 'sec@example.test'),
  ('00000000-0000-0000-0000-0000000c1e03', 'treas@example.test'), ('00000000-0000-0000-0000-0000000c1e04', 'vp@example.test'),
  ('00000000-0000-0000-0000-0000000c1e05', 'member@example.test'), ('00000000-0000-0000-0000-0000000c1e06', 'john@example.test'),
  ('00000000-0000-0000-0000-0000000c1e07', 'jane@example.test'), ('00000000-0000-0000-0000-0000000c1e08', 'kid@example.test'),
  ('00000000-0000-0000-0000-0000000c1e09', 'newbie@example.test'), ('00000000-0000-0000-0000-0000000c1e10', 'other@example.test'),
  ('00000000-0000-0000-0000-0000000c1e11', 'next@example.test');
update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated',
  encrypted_password = extensions.crypt('Fixture-pass-club', extensions.gen_salt('bf', 4)),
  email_confirmed_at = now(), raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  created_at = coalesce(created_at, now()), updated_at = now(),
  confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '', email_change_token_current = '', reauthentication_token = '',
  phone_change = '', phone_change_token = '';
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u;
-- finished profiles (so the existing first-sign-in gate does not interrupt the journeys)
update public.profiles p set display_name = v.n, onboarded_at = now(), interests = '{fighter}' from (values
  ('00000000-0000-0000-0000-0000000c1e01'::uuid, 'Kedrixx Streit'), ('00000000-0000-0000-0000-0000000c1e02', 'Carm Example'), ('00000000-0000-0000-0000-0000000c1e03', 'Garrett Robson'),
  ('00000000-0000-0000-0000-0000000c1e04', 'Vic Vice'), ('00000000-0000-0000-0000-0000000c1e05', 'Morgan Member'), ('00000000-0000-0000-0000-0000000c1e06', 'John Smith'),
  ('00000000-0000-0000-0000-0000000c1e07', 'Jane Smith'), ('00000000-0000-0000-0000-0000000c1e08', 'Kit Young'), ('00000000-0000-0000-0000-0000000c1e09', 'Nell Newbie'),
  ('00000000-0000-0000-0000-0000000c1e10', 'Otto Other'), ('00000000-0000-0000-0000-0000000c1e11', 'Nora Next')) v(id, n) where p.id = v.id;

insert into public.teams (id, slug, name, status, city, region, country) values
  ('00000000-0000-0000-0000-0000000c1ea1', 'red-deer-reavers', 'Red Deer Reavers', 'approved', 'Red Deer', 'Alberta', 'Canada'),
  ('00000000-0000-0000-0000-0000000c1ea2', 'other-club', 'Other Club', 'approved', 'Calgary', 'Alberta', 'Canada');
insert into public.club_membership_years (team_id, year, starts_on, ends_on, dues_cents) values
  ('00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 2000),
  ('00000000-0000-0000-0000-0000000c1ea2', extract(year from current_date)::int, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 3000);
insert into public.team_officers (team_id, user_id, office, note) values
  ('00000000-0000-0000-0000-0000000c1ea1', '00000000-0000-0000-0000-0000000c1e01', 'president', 'fixture'),
  ('00000000-0000-0000-0000-0000000c1ea1', '00000000-0000-0000-0000-0000000c1e02', 'secretary', 'fixture'),
  ('00000000-0000-0000-0000-0000000c1ea1', '00000000-0000-0000-0000-0000000c1e03', 'treasurer', 'fixture'),
  ('00000000-0000-0000-0000-0000000c1ea1', '00000000-0000-0000-0000-0000000c1e04', 'vice_president', 'fixture'),
  ('00000000-0000-0000-0000-0000000c1ea2', '00000000-0000-0000-0000-0000000c1e10', 'treasurer', 'fixture');

-- memberships (as the fixture owner; in the product these come from apply_for_club_membership)
insert into public.club_memberships (id, team_id, membership_year, user_id, status, full_name, discord_name, date_of_birth, adult_confirmed, bylaws_agreed_at) values
  ('00000000-0000-0000-0000-0000000c1eb3', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e03', 'active', 'Garrett Robson', 'garrett', null, true, now()),
  ('00000000-0000-0000-0000-0000000c1eb1', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e01', 'active', 'Kedrixx Streit', null, null, true, now()),
  ('00000000-0000-0000-0000-0000000c1eb5', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e05', 'active', 'Morgan Member', 'morgan#7', null, true, now()),
  ('00000000-0000-0000-0000-0000000c1eb6', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e06', 'active', 'John Smith', null, null, true, now()),
  ('00000000-0000-0000-0000-0000000c1eb7', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e07', 'pending', 'Jane Smith', null, (current_date - interval '25 years')::date, false, now()),
  ('00000000-0000-0000-0000-0000000c1eb8', '00000000-0000-0000-0000-0000000c1ea1', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e08', 'active', 'Kit Young', null, (current_date - interval '16 years')::date, false, now()),
  ('00000000-0000-0000-0000-0000000c1eb9', '00000000-0000-0000-0000-0000000c1ea2', extract(year from current_date)::int, '00000000-0000-0000-0000-0000000c1e10', 'active', 'Otto Other', null, null, true, now());
insert into public.club_dues (membership_id, status, amount_cents, changed_at) values
  ('00000000-0000-0000-0000-0000000c1eb3', 'paid', 2000, now()), ('00000000-0000-0000-0000-0000000c1eb1', 'paid', 2000, now()),
  ('00000000-0000-0000-0000-0000000c1eb5', 'paid', 2000, now()), ('00000000-0000-0000-0000-0000000c1eb6', 'unpaid', null, now()),
  ('00000000-0000-0000-0000-0000000c1eb7', 'paid', 2000, now()), ('00000000-0000-0000-0000-0000000c1eb8', 'paid', 2000, now()),
  ('00000000-0000-0000-0000-0000000c1eb9', 'unpaid', null, now());
