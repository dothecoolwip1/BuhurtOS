-- Local fixture for scripts/e2e/pack24a1-live.mjs (focus layout and tablet safety). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 16 fixture (event "Test stuff test": Longsword m1 = Aldric v Brann on Field 1; a2 organizer, a4 scorekeeper, c1 head marshal,
-- d1 check-in desk, d2 armour inspector, d4 check-in desk at ANOTHER event only, a7 stranger), plus 36 more accepted fighters so the desk has
-- a long list to search (TEST data: synthetic event, made-up names, example.test accounts).
\i scripts/e2e/fixtures/pack16.sql
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid, 'desk' || n || '@example.test' from generate_series(1, 36) n;
insert into public.fighters (id, display_name, gender)
select ('00000000-0000-0000-0000-00000000f2' || lpad(n::text, 2, '0'))::uuid, 'Test Fighter ' || lpad(n::text, 2, '0'), 'male' from generate_series(1, 36) n;
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, is_volunteer, waiver_version_id, waiver_signed_name)
select ('00000000-0000-0000-0000-00000000af' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000ed01', ('00000000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid,
       ('00000000-0000-0000-0000-00000000f2' || lpad(n::text, 2, '0'))::uuid, 'accepted', 'Test Fighter ' || lpad(n::text, 2, '0'), 'male', 'HACSA', 'hacsa_member', false,
       '00000000-0000-0000-0000-0000000aed01', 'Signed Name'
from generate_series(1, 36) n;
insert into public.registration_competitions (registration_id, competition_id, details)
select ('00000000-0000-0000-0000-00000000af' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000cd01', '{}' from generate_series(1, 36) n;
