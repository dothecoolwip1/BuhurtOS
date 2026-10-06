-- Local fixture for scripts/e2e/cc181-live.mjs (Pack 18.1: the Command Centre's Event devices, Broadcast, Staff and Camera Off panels).
-- LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 16 fixture (event "Test stuff test", slug test-stuff-test: Field 1 Longsword, Field 2 Sword and shield; a2 organizer,
-- a4 scorekeeper, c1 head marshal, c2 second scorekeeper, d1 check-in desk, d2 inspector; today and tomorrow in the event's time zone), plus:
--   * a THIRD field (Buckler on Field 3) so "Take Lyst 1..3" has three Lysts to offer;
--   * named staff for the names-only panel: e1 "Announcer Anna" (announcer), e2 "Medic Mo" (medic); e3 "Newcomer Nia" has signed in once but has no role yet
--     (to be added by email); e4 organizes ANOTHER event only;
--   * the stream laptop's credential (an ordinary controller credential, no known code) and a heartbeat it "just sent": OBS connected, AUTO, Lyst 1 on air,
--     music playing, mic quiet, Lyst 2 also live, one setup problem;
--   * a Temporary Organizer DEVICE ("Gate Tablet") with an open session, made the way the Edge Function's door makes one (credential + session rows; the
--     script signs its token with the stack's HS256 secret, role bos_event_device, sub = the session id).
\i scripts/e2e/fixtures/pack16.sql

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, case n when 1 then 'anna@example.test' when 2 then 'mo@example.test' when 3 then 'newcomer@example.test' else 'e4@example.test' end from generate_series(1, 4) n;
update public.profiles set display_name = (array['Announcer Anna','Medic Mo','Newcomer Nia','Other Organizer'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000e%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e1', 'announcer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e2', 'medic'),
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000e4', 'organizer');

-- the third field: Buckler (competition cd04, no draw in the base fixture) gets two entries and one fight on Field 3
insert into public.entries (id, competition_id, fighter_id) values
  ('00000000-0000-0000-0000-00000000e250', '00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000f115'),
  ('00000000-0000-0000-0000-00000000e251', '00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000f116');
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  ('00000000-0000-0000-0000-0000000fd031', '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 0, 'Field 3',
   '00000000-0000-0000-0000-00000000e250', '00000000-0000-0000-0000-00000000e251', date_trunc('hour', now()) + interval '15 minutes');

-- the stream laptop: a controller credential (the plaintext of its code was never known here) and the heartbeat it last sent
insert into public.event_credentials (event_id, kind, label, role, code_hash, created_at)
values ('00000000-0000-0000-0000-00000000ed01', 'controller', 'Stream laptop', 'broadcast_controller', decode(md5('cc181-controller-a') || md5('cc181-controller-b'), 'hex'), now() - interval '2 hours');
insert into public.broadcast_controller_status (event_id, reported_at, status) values ('00000000-0000-0000-0000-00000000ed01', now(), jsonb_build_object(
  'obs_connected', true, 'mode', 'auto',
  'on_air', jsonb_build_object('kind', 'lyst', 'field', 'field 1', 'scene', 'Lyst 1 camera', 'reason', 'first live'),
  'fight', 'Aldric Stone vs Brann Oakley', 'camera_off', false,
  'music', jsonb_build_object('state', 'playing', 'ducking', false, 'mic', 'quiet'),
  'also_live', jsonb_build_array(jsonb_build_object('field', 'field 2', 'title', 'Garrick Fell vs Hale Morrow', 'round', 1)),
  'mapping_problems', jsonb_build_array('Lyst 3 has no camera mapping'), 'controller_version', 'fixture'));

-- a Temporary Organizer device with an open session
insert into public.event_credentials (id, event_id, kind, label, role, code_hash, created_at)
values ('00000000-0000-0000-0000-0000000c0d01', '00000000-0000-0000-0000-00000000ed01', 'device', 'Gate Tablet', 'temporary_organizer', decode(md5('cc181-gate-a') || md5('cc181-gate-b'), 'hex'), now() - interval '1 hour');
insert into public.event_sessions (id, credential_id, secret_hash, created_at, last_seen_at)
values ('00000000-0000-0000-0000-0000000e5d01', '00000000-0000-0000-0000-0000000c0d01', decode(md5('cc181-gate-s1') || md5('cc181-gate-s2'), 'hex'), now() - interval '30 minutes', now());
