-- Fictional non-HACSA tournament. Include inside a rollback test transaction.

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 7) n;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'fighter' || n || '@example.test' from generate_series(1, 6) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now();
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');

insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000d0e01', 'submitted', 'Event day test data', 'local fixture', true);
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed01', 'independent-rehearsal-cup', 'Independent Rehearsal Cup', 'published', 'tournament', (now() at time zone 'America/Edmonton')::date, (now() at time zone 'America/Edmonton')::date + 1, 'Fictional Rehearsal Hall', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed01', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a2', 'organizer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000a4', 'scorekeeper');

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-00000000ed01', 'Longsword (men)', 'longsword', 'men', 'Classic', 'round_robin', 1, 2),
  ('00000000-0000-0000-0000-00000000cd02', '00000000-0000-0000-0000-00000000ed01', 'Sword and shield (men)', 'sword_shield', 'men', 'Classic', 'round_robin', 2, 2),
  ('00000000-0000-0000-0000-00000000cd03', '00000000-0000-0000-0000-00000000ed01', 'Polearm (men)', 'polearm', 'men', 'Classic', 'elimination', 3, 2),
  ('00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000ed01', 'Buckler (men)', 'buckler', 'men', 'Classic', 'round_robin', 4, 2);

create function pg_temp.fid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000f1' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.eid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000000e2' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.mid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000fd' || lpad(n::text, 3, '0'))::uuid $$;
insert into public.fighters (id, display_name, gender) select pg_temp.fid(n), (array['Rehearsal Fighter 01','Rehearsal Fighter 02','Rehearsal Fighter 03','Rehearsal Fighter 04','Rehearsal Fighter 05','Rehearsal Fighter 06','Rehearsal Fighter 07','Rehearsal Fighter 08','Rehearsal Fighter 09','Rehearsal Fighter 10','Rehearsal Fighter 11','Rehearsal Fighter 12','Rehearsal Fighter 13','Rehearsal Fighter 14','Rehearsal Fighter 15','Rehearsal Fighter 16'])[n], 'male' from generate_series(1, 16) n;
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(n), '00000000-0000-0000-0000-00000000cd01', pg_temp.fid(n) from generate_series(1, 6) n;
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid((20 + i)::int), '00000000-0000-0000-0000-00000000cd02', pg_temp.fid(f) from unnest(array[1, 7, 8, 9, 10]) with ordinality as u(f, i);
insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(30 + n), '00000000-0000-0000-0000-00000000cd03', pg_temp.fid(n) from generate_series(11, 14) n;

insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  (pg_temp.mid(1), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 0, pg_temp.eid(1), pg_temp.eid(2)),
  (pg_temp.mid(2), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 1, pg_temp.eid(3), pg_temp.eid(4)),
  (pg_temp.mid(3), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 1', 2, pg_temp.eid(5), pg_temp.eid(6)),
  (pg_temp.mid(4), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 0, pg_temp.eid(1), pg_temp.eid(3)),
  (pg_temp.mid(5), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 1, pg_temp.eid(2), pg_temp.eid(4)),
  (pg_temp.mid(6), '00000000-0000-0000-0000-00000000cd01', 'round_robin', 'Round 2', 2, pg_temp.eid(5), pg_temp.eid(6));
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  (pg_temp.mid(11), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 1', 0, 'Field 2', pg_temp.eid(21), pg_temp.eid(22)),
  (pg_temp.mid(12), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 1', 1, 'Field 2', pg_temp.eid(23), pg_temp.eid(24)),
  (pg_temp.mid(13), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 2', 0, 'Field 2', pg_temp.eid(21), pg_temp.eid(23));
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b) values
  (pg_temp.mid(23), '00000000-0000-0000-0000-00000000cd03', 'final', 'Final', 0, null, null),
  (pg_temp.mid(24), '00000000-0000-0000-0000-00000000cd03', 'third_place', 'Third place', 0, null, null);
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, next_match_id, next_slot) values
  (pg_temp.mid(21), '00000000-0000-0000-0000-00000000cd03', 'elimination', 'Semifinal', 0, pg_temp.eid(41), pg_temp.eid(42), pg_temp.mid(23), 'a'),
  (pg_temp.mid(22), '00000000-0000-0000-0000-00000000cd03', 'elimination', 'Semifinal', 1, pg_temp.eid(43), pg_temp.eid(44), pg_temp.mid(23), 'b');

update public.matches m set scheduled_at = date_trunc('hour', now()) + make_interval(mins => t.mins)
from (values (1, 0), (2, 10), (3, 20), (4, 30), (5, 40), (6, 50), (21, 60), (22, 70), (12, 0), (11, 35), (13, 20)) as t(n, mins) where m.id = pg_temp.mid(t.n);

insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000aed01', '00000000-0000-0000-0000-00000000ed01', 1, 'Waiver', 'A long enough waiver text for the check constraint.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, is_volunteer, waiver_version_id, waiver_signed_name)
select ('00000000-0000-0000-0000-00000000ae' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000ed01', ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, pg_temp.fid(n),
       'accepted', (array['Rehearsal Fighter 01','Rehearsal Fighter 02','Rehearsal Fighter 03','Rehearsal Fighter 04'])[n], 'male', 'other', 'proof_received', false, '00000000-0000-0000-0000-0000000aed01', 'Signed Name'
from generate_series(1, 4) n;
insert into public.registration_checks (registration_id, check_name, passed) values
  ('00000000-0000-0000-0000-00000000ae01', 'checked_in', true), ('00000000-0000-0000-0000-00000000ae03', 'checked_in', true);
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, 'c' || n || '@example.test' from generate_series(1, 8) n;
update public.profiles set display_name = (array['Head Marshal','Second Scorekeeper','Counter Ash','Counter Birch','Counter Cedar','Counter Dune','Counter Elm','Fighter Account'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000c%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000c1', 'head_marshal'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000c2', 'scorekeeper');
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000101'), ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000102');
insert into public.teams (id, slug, name, status, city, country) values
  ('00000000-0000-0000-0000-00000000a301', 'rehearsal-amber', 'Rehearsal Amber', 'approved', 'Fictional City', 'CA'), ('00000000-0000-0000-0000-00000000a302', 'rehearsal-blue', 'Rehearsal Blue', 'approved', 'Fictional City', 'CA');
insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd07', '00000000-0000-0000-0000-00000000ed01', '5v5 (men)', '5v5', 'men', 'Classic', 'round_robin', 5, 2);
insert into public.entries (id, competition_id, team_id) values
  ('00000000-0000-0000-0000-00000000e271', '00000000-0000-0000-0000-00000000cd07', '00000000-0000-0000-0000-00000000a301'),
  ('00000000-0000-0000-0000-00000000e272', '00000000-0000-0000-0000-00000000cd07', '00000000-0000-0000-0000-00000000a302');
insert into public.entry_fighters (entry_id, fighter_id, role) select '00000000-0000-0000-0000-00000000e271', ('00000000-0000-0000-0000-00000000f1' || n)::uuid, 'fighter' from generate_series(11, 13) n;
insert into public.entry_fighters (entry_id, fighter_id, role) select '00000000-0000-0000-0000-00000000e272', ('00000000-0000-0000-0000-00000000f1' || n)::uuid, 'fighter' from generate_series(14, 16) n;
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b) values
  ('00000000-0000-0000-0000-0000000fd042', '00000000-0000-0000-0000-00000000cd07', 'round_robin', 'Round 1', 0, 'Field 2', '00000000-0000-0000-0000-00000000e271', '00000000-0000-0000-0000-00000000e272');
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'd' || n || '@example.test' from generate_series(1, 4) n;
update public.profiles set display_name = (array['Desk Dana','Inspector Ines','Captain Cora','Other Desk'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000d%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000d1', 'check_in'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000d2', 'inspector');
insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed02', 'other-event', 'Other event', 'published', 'tournament', (now() at time zone 'America/Edmonton')::date, (now() at time zone 'America/Edmonton')::date, 'Elsewhere', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed02', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000d4', 'check_in');

insert into public.teams (id, slug, name, status, city, country) values ('00000000-0000-0000-0000-00000000a616', 'rehearsal-copper', 'Rehearsal Copper', 'approved', 'Fictional City', 'CA');
insert into public.team_roles (team_id, user_id, role) values ('00000000-0000-0000-0000-00000000a616', '00000000-0000-0000-0000-0000000000d3', 'captain');
update public.registrations set team_id = '00000000-0000-0000-0000-00000000a616', team_name = 'Rehearsal Copper'
 where id in ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000ae02');

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort, rounds_to_win) values
  ('00000000-0000-0000-0000-00000000cd05', '00000000-0000-0000-0000-00000000ed01', 'Profight (men)', 'profight', 'men', 'Classic', 'round_robin', 5, 2);
insert into public.registration_competitions (registration_id, competition_id, details) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000cd01', '{}'),
  ('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000cd01', '{}'),
  ('00000000-0000-0000-0000-00000000ae03', '00000000-0000-0000-0000-00000000cd05', '{"weight": "84 kg"}'),
  ('00000000-0000-0000-0000-00000000ae04', '00000000-0000-0000-0000-00000000cd01', '{}');

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, 'e' || n || '@example.test' from generate_series(1, 4) n;
update public.profiles set display_name = (array['Anna Announcer','Marsha Marshal','Elsewhere Announcer','Eve Stranger'])[right(id::text, 1)::int], onboarded_at = now()
 where id::text like '00000000-0000-0000-0000-0000000000e%';
insert into public.event_staff (event_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e1', 'announcer'),
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-0000000000e2', 'marshal'),
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000e3', 'announcer');

insert into public.events (id, slug, name, status, event_type, starts_on, ends_on, venue, timezone) values
  ('00000000-0000-0000-0000-00000000ed03', 'draft-cup', 'Draft Cup', 'draft', 'tournament', (now() at time zone 'America/Edmonton')::date + 30, (now() at time zone 'America/Edmonton')::date + 31, 'Nowhere', 'America/Edmonton');
insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000d0e01', 'event', '00000000-0000-0000-0000-00000000ed03', 'unverified', 'fixture');
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000ed03', '00000000-0000-0000-0000-0000000000e1', 'announcer');


insert into public.fighters (id, display_name, gender) select pg_temp.fid(n), (array['Rehearsal Fighter 17','Rehearsal Fighter 18','Rehearsal Fighter 19','Rehearsal Fighter 20'])[n - 16], 'female' from generate_series(17, 20) n;
insert into public.teams (id, slug, name, status, city, country, colors, crest_division, initial) values
  ('00000000-0000-0000-0000-00000000a617', 'rehearsal-violet', 'Rehearsal Violet', 'approved', 'Fictional City', 'CA', '{"#1c2a4a","#d9b44a"}', 'bend', 'R'),
  ('00000000-0000-0000-0000-00000000a618', 'rehearsal-slate', 'Rehearsal Slate', 'approved', 'Fictional City', 'CA', '{"#2b2b2b","#b8322a"}', 'chevron', 'B'),
  ('00000000-0000-0000-0000-00000000a619', 'rehearsal-green', 'Rehearsal Green', 'approved', 'Fictional City', 'CA', '{"#1f5f4a","#e8e2cc"}', 'quarterly', 'N');
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a616' where id in (pg_temp.fid(1), pg_temp.fid(2));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a617' where id in (pg_temp.fid(3), pg_temp.fid(7), pg_temp.fid(15));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a618' where id in (pg_temp.fid(4), pg_temp.fid(8), pg_temp.fid(16), pg_temp.fid(11));
update public.fighters set team_id = '00000000-0000-0000-0000-00000000a619' where id in (pg_temp.fid(5), pg_temp.fid(9), pg_temp.fid(17), pg_temp.fid(12));

insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'fighter' || n || '@example.test' from generate_series(7, 20) n;
update public.profiles set display_name = 'User ' || right(id::text, 3), onboarded_at = now() where id::text like '00000000-0000-0000-0000-0000000001%' and display_name is null;
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, is_volunteer, waiver_version_id, waiver_signed_name)
select ('00000000-0000-0000-0000-00000000ae' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000ed01', ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, pg_temp.fid(n),
       'accepted', f.display_name, 'male', 'other', 'proof_received', false, '00000000-0000-0000-0000-0000000aed01', 'Signed Name'
from generate_series(5, 20) n join public.fighters f on f.id = pg_temp.fid(n) where n not between 11 and 14;

update public.matches set entry_a = pg_temp.eid(25) where id in (pg_temp.mid(11), pg_temp.mid(13));   -- m11 Jory v Garrick, m13 Jory v Hale
update public.matches set scheduled_at = date_trunc('hour', now()) + interval '-5 minutes' where id = pg_temp.mid(11);
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  (pg_temp.mid(14), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Pool', 3, 'Field 2', pg_temp.eid(21), pg_temp.eid(24), date_trunc('hour', now()) - interval '40 minutes'),
  (pg_temp.mid(15), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Pool', 4, 'Field 2', pg_temp.eid(21), pg_temp.eid(22), date_trunc('hour', now()) - interval '30 minutes'),
  (pg_temp.mid(16), '00000000-0000-0000-0000-00000000cd02', 'round_robin', 'Round 2', 1, 'Field 2', pg_temp.eid(22), pg_temp.eid(24), date_trunc('hour', now()) + interval '45 minutes');

insert into public.entries (id, competition_id, fighter_id) select pg_temp.eid(50 + (n - 15)), '00000000-0000-0000-0000-00000000cd04', pg_temp.fid(n) from generate_series(15, 20) n;   -- e250..e255 = fighters 15..20
insert into public.matches (id, competition_id, stage, round_label, position, field, entry_a, entry_b, scheduled_at) values
  (pg_temp.mid(31), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(51), date_trunc('hour', now()) - interval '60 minutes'),
  (pg_temp.mid(32), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 1, 'Field 3', pg_temp.eid(52), pg_temp.eid(53), date_trunc('hour', now()) - interval '50 minutes'),
  (pg_temp.mid(33), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 1', 2, 'Field 3', pg_temp.eid(54), pg_temp.eid(55), date_trunc('hour', now()) + interval '10 minutes'),
  (pg_temp.mid(34), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 0, 'Field 3', pg_temp.eid(50), pg_temp.eid(52), date_trunc('hour', now()) + interval '20 minutes'),
  (pg_temp.mid(35), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 1, 'Field 3', pg_temp.eid(51), pg_temp.eid(54), date_trunc('hour', now()) + interval '30 minutes'),
  (pg_temp.mid(36), '00000000-0000-0000-0000-00000000cd04', 'round_robin', 'Round 2', 2, 'Field 3', pg_temp.eid(53), pg_temp.eid(55), date_trunc('hour', now()) + interval '40 minutes');

insert into public.fighters (id, display_name, gender) values ('00000000-0000-0000-0000-00000000f121', 'Reserve Fighter (local test)', 'male');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-00000000e256', '00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000f121');
update public.fighters set joined_year = 2018 where id = '00000000-0000-0000-0000-00000000f115';

update public.fighters set joined_year = 2017 where id = '00000000-0000-0000-0000-00000000f117';
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000099','novice@example.test');
insert into public.platform_roles(user_id,role) values ('00000000-0000-0000-0000-0000000000a2','organizer');
insert into public.organizations(id,slug,name,kind) values ('00000000-0000-0000-0000-00000000da01','independent-rehearsal-league','Independent Rehearsal League (fictional)','other');
update public.events set organization_id='00000000-0000-0000-0000-00000000da01';
insert into public.record_sources(source_id,entity_type,entity_id,status,note)
select '00000000-0000-0000-0000-0000000d0e01','fighter',id,'unverified','Fictional non-HACSA rehearsal' from public.fighters on conflict do nothing;
insert into public.record_sources(source_id,entity_type,entity_id,status,note)
select '00000000-0000-0000-0000-0000000d0e01','team',id,'unverified','Fictional non-HACSA rehearsal' from public.teams on conflict do nothing;
insert into public.record_sources(source_id,entity_type,entity_id,status,note)
values ('00000000-0000-0000-0000-0000000d0e01','organization','00000000-0000-0000-0000-00000000da01','unverified','Fictional non-HACSA rehearsal');

do $$ begin
 if exists(select 1 from public.events where name ilike '%hacsa%')
 or exists(select 1 from public.teams where name ilike '%reaver%' or name ilike '%hacsa%')
 or exists(select 1 from public.fighters where display_name ilike '%robson%')
 or exists(select 1 from public.registrations where organization ilike '%hacsa%' or insurance='hacsa_member') then raise exception 'Non-HACSA scope guard failed'; end if;
end $$;
