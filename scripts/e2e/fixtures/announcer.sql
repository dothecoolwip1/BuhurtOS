-- Local fixture for scripts/e2e/announcer-live.mjs (Pack 18.1 Announcer view). LOCAL THROWAWAY DATABASE ONLY (loaded after the migrations).
-- Everything from the Pack 16 fixture (event "Test stuff test": a2 organizer, a4 scorekeeper, c1 head marshal, d1 check-in desk, d2 inspector; Longsword on
-- Field 1, Sword and shield on Field 2, Polearm knockout on Field 1; registrations for fighters 1-4), then made into a realistic day:
--   * THREE Lysts: Field 1 (Longsword + Polearm), Field 2 (Sword and shield), Field 3 (Buckler, round robin of six).
--   * people: e1 a PERMANENT account holding the `announcer` role of this event (also of the draft event), e2 a marshal, e3 an announcer of ANOTHER event only.
--   * registrations for every fighter that fights (so "Ready / Not yet ready" means something; the script checks some in and inspects some).
--   * fighters on teams (crests), a draft event, finished fights are made by the script through the real Lyst RPCs.
\i scripts/e2e/fixtures/pack16.sql

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, 'e' || n || '@example.test' from generate_series(1, 4) n;
update public.profiles set display_name = (array['Anna Announcer','Marsha Marshal','Elsewhere Announcer','Eve Stranger'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000e%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e1', 'announcer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e2', 'marshal'),
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000e3', 'announcer');

-- a draft event (the announcer view says it is not public yet)
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed03', 'draft-cup', 'Draft Cup', 'draft', 'tournament', (now() at time zone 'America/Edmonton')::date + 30, (now() at time zone 'America/Edmonton')::date + 31, 'Nowhere', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed03', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ed03', '00000000-0000-0000-0000-0000000000e1', 'announcer');

-- ------------------------------------------------------------------ people and teams

insert into public.fighters (id, display_name, gender) select pg_temp.fid(n), (array['Pia Lund','Quin Ash','Rhea Cole','Soren Vale'])[n - 16], 'female' from generate_series(17, 20) n;
insert into public.teams (id, slug, name, status, city, country, colors, crest_division, initial) values
  ('00000000-0000-0000-0000-00000000a617', 'ravens-of-calgary', 'Ravens of Calgary', 'approved', 'Calgary', 'CA', '{"#1c2a4a","#d9b44a"}', 'bend', 'R'),
  ('00000000-0000-0000-0000-00000000a618', 'black-hart-company', 'Black Hart Company', 'approved', 'Edmonton', 'CA', '{"#2b2b2b","#b8322a"}', 'chevron', 'B'),
  ('00000000-0000-0000-0000-00000000a619', 'northern-guard', 'Northern Guard', 'approved', 'Lethbridge', 'CA', '{"#1f5f4a","#e8e2cc"}', 'quarterly', 'N');
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a616' where id in (pg_temp.fid(1), pg_temp.fid(2));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a617' where id in (pg_temp.fid(3), pg_temp.fid(7), pg_temp.fid(15));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a618' where id in (pg_temp.fid(4), pg_temp.fid(8), pg_temp.fid(16), pg_temp.fid(11));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a619' where id in (pg_temp.fid(5), pg_temp.fid(9), pg_temp.fid(17), pg_temp.fid(12));

-- registrations (accepted) for fighters 5..10 and 15..20; accounts for them exist only so the registration has an owner
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'fighter' || n || '@example.test' from generate_series(7, 20) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now() where id::text like '00000000-0000-0000-0000-0000000001%' and display_name is null;
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, is_volunteer, waiver_version_id, waiver_signed_name)
select ('00000000-0000-0000-0000-00000000ae' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000ed01', ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, pg_temp.fid(n),
       'accepted', f.display_name, 'male', 'HACSA', 'hacsa_member', false, '00000000-0000-0000-0000-0000000aed01', 'Signed Name'
from generate_series(5, 20) n join public.fighters f on f.id = pg_temp.fid(n) where n not between 11 and 14;

-- ------------------------------------------------------------------ Field 2: Sword and shield (Aldric stays out of it; he fights on Field 1)
-- (entry 25 is Jory Wick, already in the base fixture)
update public.matches set entry_a = pg_temp.eid(25) where id in (pg_temp.mid(11), pg_temp.mid(13));   -- m11 Jory v Garrick, m13 Jory v Hale
update public.matches set scheduled_at = date_trunc('hour', now()) + interval '-5 minutes' where id = pg_temp.mid(11);
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  (pg_temp.mid(14), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Pool', 3, 'Field 2', pg_temp.eid(21), pg_temp.eid(24), date_trunc('hour', now()) - interval '40 minutes'),
  (pg_temp.mid(15), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Pool', 4, 'Field 2', pg_temp.eid(21), pg_temp.eid(22), date_trunc('hour', now()) - interval '30 minutes'),
  (pg_temp.mid(16), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 2', 1, 'Field 2', pg_temp.eid(22), pg_temp.eid(24), date_trunc('hour', now()) + interval '45 minutes');

-- ------------------------------------------------------------------ Field 3: Buckler, six fighters, round robin
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(50 + (n - 15)), '00000000-0000-0000-0000-00000000cd04', pg_temp.fid(n) from generate_series(15, 20) n;   -- e250..e255 = fighters 15..20
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  (pg_temp.mid(31), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(51), date_trunc('hour', now()) - interval '60 minutes'),
  (pg_temp.mid(32), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 1, 'Field 3', pg_temp.eid(52), pg_temp.eid(53), date_trunc('hour', now()) - interval '50 minutes'),
  (pg_temp.mid(33), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 2, 'Field 3', pg_temp.eid(54), pg_temp.eid(55), date_trunc('hour', now()) + interval '10 minutes'),
  (pg_temp.mid(34), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(52), date_trunc('hour', now()) + interval '20 minutes'),
  (pg_temp.mid(35), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 1, 'Field 3', pg_temp.eid(51), pg_temp.eid(54), date_trunc('hour', now()) + interval '30 minutes'),
  (pg_temp.mid(36), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 2, 'Field 3', pg_temp.eid(53), pg_temp.eid(55), date_trunc('hour', now()) + interval '40 minutes');

-- ------------------------------------------------------------------ Field 1: the two earlier longsword matches that already happened will be played by the script;
-- the polearm semifinals stay on Field 1 behind the longsword (the existing fixture times).
