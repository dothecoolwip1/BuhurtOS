-- Pack 11 gate: "My next fight" sees only the viewer's own entries (migration 20261005000300). A club with one team row and several teams
-- (men's 5v5, women's 3v3) must not show a man his club's women's fights: a team entry is the viewer's when they are on its recorded roster,
-- or, while no roster is recorded yet, when they registered for that competition with that team.
-- LOCAL THROWAWAY DATABASE ONLY; everything is rolled back.   Run:  psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/pack11_gate.sql
\set ON_ERROR_STOP on
begin;

create schema t;
create table t.log (n serial, name text);
create function t.as_anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); set local role anon; end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; end $$;
create function t.as_admin() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.expect_error(label text, stmt text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin execute stmt; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL (expected an error): %', label; end if;
  insert into t.log (name) values (label);
end $$;
create function t.expect_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL (% <> %): %', got, want, label; end if;
  insert into t.log (name) values (label);
end $$;
grant usage on schema t to anon, authenticated;
grant all on t.log to anon, authenticated;
grant usage on all sequences in schema t to anon, authenticated;
create function t.mine(u uuid) returns text language plpgsql as $$
declare out text;
begin
  perform t.as_user(u);
  select coalesce(string_agg(right(entry_id::text, 2), ',' order by entry_id), '') into out from public.my_event_entries('00000000-0000-0000-0000-00000000e111');
  perform t.as_admin();
  return out;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures: one club (Kestrel), a man (f1 = account a1), a woman (f2 = a2), a reserve (f4 = a4), a bystander (a3)
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'u' || n || '@example.test' from generate_series(1, 9) n;
insert into public.platform_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a9', 'organizer');
insert into public.teams (id, slug, name, status) values ('00000000-0000-0000-0000-00000000d111', 'kestrel', 'Kestrel Guard', 'approved');
insert into public.fighters (id, display_name, team_id, gender, disciplines) values
  ('00000000-0000-0000-0000-00000000f101', 'Aldric Stone', '00000000-0000-0000-0000-00000000d111', 'male', '{}'),
  ('00000000-0000-0000-0000-00000000f102', 'Dot Dale', '00000000-0000-0000-0000-00000000d111', 'female', '{}'),
  ('00000000-0000-0000-0000-00000000f104', 'Rafe Reserve', '00000000-0000-0000-0000-00000000d111', 'male', '{}');
insert into public.fighter_accounts (fighter_id, user_id) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-00000000f104', '00000000-0000-0000-0000-0000000000a4');
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000e111', 'club-cup', 'Club Cup', 'published', current_date, current_date);
insert into public.event_staff (event_id, user_id, role) values ('00000000-0000-0000-0000-00000000e111', '00000000-0000-0000-0000-0000000000a9', 'organizer');
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-00000000aa11', '00000000-0000-0000-0000-00000000e111', 1, 'Waiver', 'Fictional waiver text for the gate.');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
select public.create_competition('00000000-0000-0000-0000-00000000e111', 'Men 5v5', '5v5', 'men') as k1 \gset
select public.create_competition('00000000-0000-0000-0000-00000000e111', 'Women 3v3', '3v3', 'women') as k2 \gset
select public.create_competition('00000000-0000-0000-0000-00000000e111', 'Men Longsword', 'longsword', 'men') as k3 \gset
select public.create_competition('00000000-0000-0000-0000-00000000e111', 'Men 3v3', '3v3', 'men') as k4 \gset
select t.as_admin();
-- registrations (accepted): f1 for 5v5 + longsword + men's 3v3 with the club; f2 for women's 3v3 with the club; f4 with the club, no competition rows (an older shape)
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, team_id) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000e111', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000f101', 'accepted', 'Aldric Stone', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Aldric Stone', '00000000-0000-0000-0000-00000000d111'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000e111', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000f102', 'accepted', 'Dot Dale', 'female', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Dot Dale', '00000000-0000-0000-0000-00000000d111'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-00000000e111', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000f104', 'accepted', 'Rafe Reserve', 'male', 'HACSA', 'hacsa_member', '00000000-0000-0000-0000-00000000aa11', 'Rafe Reserve', '00000000-0000-0000-0000-00000000d111');
insert into public.registration_competitions (registration_id, competition_id, team_id) values
  ('00000000-0000-0000-0000-00000000aa01', :'k1', '00000000-0000-0000-0000-00000000d111'),
  ('00000000-0000-0000-0000-00000000aa01', :'k3', null),
  ('00000000-0000-0000-0000-00000000aa01', :'k4', '00000000-0000-0000-0000-00000000d111'),
  ('00000000-0000-0000-0000-00000000aa02', :'k2', '00000000-0000-0000-0000-00000000d111');
-- entries: e1 the club in men's 5v5 (roster f1), e2 the club in women's 3v3 (roster f2), e3 f1 in longsword, e4 the club in men's 3v3 (no roster yet)
insert into public.entries (id, competition_id, team_id, fighter_id, status) values
  ('00000000-0000-0000-0000-00000000ee01', :'k1', '00000000-0000-0000-0000-00000000d111', null, 'registered'),
  ('00000000-0000-0000-0000-00000000ee02', :'k2', '00000000-0000-0000-0000-00000000d111', null, 'registered'),
  ('00000000-0000-0000-0000-00000000ee03', :'k3', null, '00000000-0000-0000-0000-00000000f101', 'registered'),
  ('00000000-0000-0000-0000-00000000ee04', :'k4', '00000000-0000-0000-0000-00000000d111', null, 'registered');
insert into public.entry_fighters (entry_id, competition_id, fighter_id, role) values
  ('00000000-0000-0000-0000-00000000ee01', :'k1', '00000000-0000-0000-0000-00000000f101', 'fighter'),
  ('00000000-0000-0000-0000-00000000ee02', :'k2', '00000000-0000-0000-0000-00000000f102', 'fighter');

-- ---------------------------------------------------------------- the rule
select t.expect_eq('the man sees his 5v5 (on the roster), his longsword entry and the men''s 3v3 he registered for (no roster yet); NOT the women''s 3v3', t.mine('00000000-0000-0000-0000-0000000000a1'), '01,03,04');
select t.expect_eq('the woman sees only the women''s 3v3 she is on', t.mine('00000000-0000-0000-0000-0000000000a2'), '02');
select t.expect_eq('a club member with no competition rows sees only the entry with no roster yet (registration-level team), never a rostered one', t.mine('00000000-0000-0000-0000-0000000000a4'), '04');
select t.expect_eq('a bystander sees nothing', t.mine('00000000-0000-0000-0000-0000000000a3'), '');
-- the roster is recorded for men's 3v3 without f4 and without f1: the registration no longer stands in
insert into public.entry_fighters (entry_id, competition_id, fighter_id, role) values ('00000000-0000-0000-0000-00000000ee04', :'k4', '00000000-0000-0000-0000-00000000f102', 'fighter');
select t.expect_eq('once a roster is recorded, only the roster counts (f1 drops the men''s 3v3 he is not on)', t.mine('00000000-0000-0000-0000-0000000000a1'), '01,03');
select t.expect_eq('... and the reserve with no roster place sees nothing', t.mine('00000000-0000-0000-0000-0000000000a4'), '');
insert into public.entry_fighters (entry_id, competition_id, fighter_id, role) values ('00000000-0000-0000-0000-00000000ee01', :'k1', '00000000-0000-0000-0000-00000000f104', 'fighter');
select t.expect_eq('put on the 5v5 roster, the reserve sees that entry', t.mine('00000000-0000-0000-0000-0000000000a4'), '01');
update public.entries set status = 'withdrawn' where id = '00000000-0000-0000-0000-00000000ee03';
select t.expect_eq('a withdrawn entry is no longer the viewer''s', t.mine('00000000-0000-0000-0000-0000000000a1'), '01');
select t.as_anon();
select t.expect_error('anonymous cannot call my_event_entries', 'select * from public.my_event_entries(''00000000-0000-0000-0000-00000000e111'')');
select t.as_admin();
select t.expect_eq('the function stays security definer with an empty search_path', (select prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where proname = 'my_event_entries'), true);

select 'PASSED ' || count(*) || ' checks' as result from t.log;
rollback;
