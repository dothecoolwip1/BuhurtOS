-- Site sweep fixture (scripts/e2e/site-sweep.sh): the Event day fixture plus one account for every tournament-day person, so each role can be
-- played in its own browser. LOCAL THROWAWAY DATABASE ONLY, loaded after the migrations. Everything here is fictional.
--   a1 owner · a2 organizer · a3 head marshal · a4 secretary (scorekeeper) · a5 medic · a6 announcer · a7 signed-in stranger (no role)
--   fighter1 (u ...0101) owns Aldric Stone's profile · fighter2 (u ...0102) is captain of TEST Sweep Wardens
\ir eventday.sql

insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a3', 'head_marshal'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a5', 'medic'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a6', 'announcer');
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000102');
insert into public.teams (id, slug, name) values ('00000000-0000-0000-0000-00000000d5e1', 'test-sweep-wardens', 'TEST Sweep Wardens');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'team', '00000000-0000-0000-0000-00000000d5e1', 'unverified', 'fixture');
insert into public.team_memberships (fighter_id, team_id, role, from_date) values
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000d5e1', 'captain', '2025-01-15'),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-00000000d5e1', 'fighter', '2025-01-15');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000d5e1', '00000000-0000-0000-0000-000000000102', 'captain');
-- private data that must never reach anyone but the event's officials: an emergency contact and a medical note on Dara Voss's registration
-- (no account in the sweep owns it)
insert into public.registration_private (registration_id, email, emergency_name, emergency_phone, emergency_relationship, medical_note)
values ('00000000-0000-0000-0000-00000000ae04', 'sweep-private@example.test', 'Sweep Emergency Person', '403-555-0199', 'sibling', 'SWEEP-PRIVATE-MEDICAL');
