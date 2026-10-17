-- Past medals (2026-10-17): tournaments that were not run in BuhurtOS, kept for their medals.
--
-- Fighters have medals from tournaments that happened before BuhurtOS existed (or that ran on paper). Those tournaments were never scored here,
-- so there are no fights, no brackets and no ranking points: only who stood on the podium, by the fighters' own word. This pack adds:
--   1. events.medals_only: a published, past tournament kept for its medals. No registration, no fights, no scoring; nothing live ever runs on it.
--   2. The 'axe' discipline (short / long axe, a HACSA category) that the Geeky Market 2025 medals need.
--   3. public.add_past_medal: a signed-in fighter adds their OWN medal (gold, silver or bronze in an individual discipline) to such a tournament.
--      A platform organizer or the owner may add one for another fighter from that fighter's report. The competition is created on first use
--      (status finished, no tier: every placing is worth 0 ranking points), the entry and the result are written through the same audited path
--      as official results (result_revisions action 'reported'), and the result carries a source: "Fighter-reported past medals", status unverified.
--      Existing medal counts, career profiles, event records and podiums read these rows as they read every result; rankings see 0 points.
--   4. public.withdraw_past_medal: the fighter takes back their own unverified report (logged as voided, never silently).
--   5. public.past_medal_records: the source status of each reported medal, so the pages can say "reported, not verified".
--   6. Four tournaments from Keston Piche's report, with the dates found for them, and his medals (Red Deer Reavers).
-- Additive and safe to run twice. Nothing in flight on hosted is touched: medals_only defaults to false, the new functions do nothing until called,
-- and the guards of Pack 09C stay in force for every other event.

-- ---------------------------------------------------------------- 1. a tournament kept for its medals
alter table public.events add column if not exists medals_only boolean not null default false;
comment on column public.events.medals_only is 'A past tournament that was not run in BuhurtOS, kept for its medals: no registration, no fights, no scoring. Placings are reported by the fighters (add_past_medal) and carry a source with status unverified until confirmed.';

-- ---------------------------------------------------------------- 2. the axe discipline
insert into public.ref_categories (code, league, name, sort, source) values
  ('axe', 'hacsa', 'Axe (short / long)', 44, 'Fighter-reported past medal (Geeky Market 2025, Edmonton); HACSA ruleset')
on conflict (code) do nothing;

-- A reported placing is its own kind of revision: it was never computed from fights.
alter table public.result_revisions drop constraint if exists result_revisions_action_check;
alter table public.result_revisions add constraint result_revisions_action_check
  check (action in ('computed', 'recomputed', 'corrected', 'superseded', 'voided', 'reported'));

-- The one source every reported medal hangs from. Fixed id so the client and later migrations can name it.
insert into public.sources (id, kind, title, citation, retrieved_on)
values ('5c2d7e1a-3f64-4b8e-9a0c-7d1e2f3a4b5c', 'submitted', 'Fighter-reported past medals',
        'Medals from tournaments that were not run in BuhurtOS, as reported by the fighters themselves (or entered for them from their report). Unverified until an official source confirms them.',
        '2026-10-17')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 3. recording a reported medal
-- The work, with no permission check: the public function and this migration's data section call it. p_actor is who is responsible (null: a migration).
create or replace function private.record_past_medal(p_fighter uuid, p_event uuid, p_category text, p_place integer, p_team uuid default null, p_note text default null, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_src constant uuid := '5c2d7e1a-3f64-4b8e-9a0c-7d1e2f3a4b5c';
  v_ev public.events; v_cat public.ref_categories; v_comp uuid; v_entry uuid; v_result uuid; v_old public.results; v_note text;
begin
  select * into v_ev from public.events where id = p_event;
  if not found then raise exception 'tournament not found' using errcode = 'P0002'; end if;
  if not v_ev.medals_only then raise exception 'this tournament was run in BuhurtOS: its placings come from its fights, not from reports' using errcode = '22023'; end if;
  if v_ev.status <> 'published' then raise exception 'this tournament is not published' using errcode = '22023'; end if;
  if v_ev.ends_on >= current_date then raise exception 'a medal can be reported once the tournament is over' using errcode = '22023'; end if;
  if p_place is null or p_place not between 1 and 3 then raise exception 'a medal is gold (1), silver (2) or bronze (3)' using errcode = '22023'; end if;
  select * into v_cat from public.ref_categories where code = p_category;
  if not found then raise exception 'unknown discipline' using errcode = '22023'; end if;
  if v_cat.league = 'buhurt' then raise exception 'team medals (3v3, 5v5 ...) cannot be reported here yet: individual disciplines only' using errcode = '22023'; end if;
  if not exists (select 1 from public.fighters f where f.id = p_fighter) then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  if private.is_synthetic('fighter', p_fighter) then raise exception 'a fictional test fighter cannot report medals' using errcode = '22023'; end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(coalesce(v_note, '')) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;

  -- The writes below are the sanctioned path for a medals-only tournament; the Pack 09C guards are told so, the way Finalize tells them.
  perform set_config('bos.unlock', 'on', true);

  -- one competition per discipline (open division): created the first time someone reports a medal in it
  select k.id into v_comp from public.competitions k where k.event_id = p_event and k.category = p_category and k.gender = 'open' and k.division = 'open'
   order by k.created_at limit 1;
  if v_comp is null then
    insert into public.competitions (event_id, name, category, gender, division, tier, ruleset, structure, status, sort, finalized_at, multiplier_source)
    values (p_event, v_cat.name, p_category, 'open', 'open', null, null, 'elimination', 'finished', v_cat.sort, (v_ev.ends_on + 1)::timestamptz, null)
    returning id into v_comp;
    perform private.audit_as(p_actor, p_event, 'competition.created_for_past_medals', v_comp::text, jsonb_build_object('category', p_category));
  end if;

  -- The entry is kept for good once it exists (result_revisions hang from it): a withdrawn report leaves it 'withdrawn', a new one wakes it.
  select e.id into v_entry from public.entries e where e.competition_id = v_comp and e.fighter_id = p_fighter;
  if v_entry is null then
    insert into public.entries (competition_id, fighter_id, status, represented_team_id, represented_team_basis)
    values (v_comp, p_fighter, 'registered', p_team, case when p_team is not null then 'recorded' end)
    returning id into v_entry;
  else
    update public.entries e set status = 'registered' where e.id = v_entry and e.status = 'withdrawn';
  end if;

  select * into v_old from public.results r where r.competition_id = v_comp and r.entry_id = v_entry for update;
  if found then
    perform set_config('bos.unlock', '', true);
    if v_old.final_place = p_place then
      return jsonb_build_object('status', 'already_recorded', 'competition_id', v_comp, 'entry_id', v_entry, 'result_id', v_old.id);
    end if;
    raise exception 'a different placing is already recorded for this discipline at this tournament; withdraw it first, or ask the owner to correct it' using errcode = '23505';
  end if;

  insert into public.results (competition_id, entry_id, final_place, points) values (v_comp, v_entry, p_place, 0) returning id into v_result;
  insert into public.record_sources (source_id, entity_type, entity_id, status, note)
  values (v_src, 'result', v_result, 'unverified', coalesce(v_note, case when p_actor is null then 'entered from the fighter''s report' else null end));
  perform private.log_result_revision(v_comp, v_entry, 'reported', null, null, p_place, 0, coalesce(v_note, 'reported by the fighter'));
  perform private.audit_as(p_actor, p_event, 'result.reported', v_comp::text,
    jsonb_build_object('entry', v_entry, 'fighter', p_fighter, 'place', p_place, 'result', v_result, 'team', p_team, 'note', v_note));
  perform set_config('bos.unlock', '', true);
  return jsonb_build_object('status', 'recorded', 'competition_id', v_comp, 'entry_id', v_entry, 'result_id', v_result);
end $$;
revoke execute on function private.record_past_medal(uuid, uuid, text, integer, uuid, text, uuid) from public, anon, authenticated;

-- A signed-in fighter reports their own medal; a platform organizer (or the owner) may report one for another fighter, from that fighter's report.
-- The team shown with the medal is the fighter's current team when the fighter reports it themself (they fight for it today and are telling us about
-- their own past), or the team given. Nothing else is guessed.
create or replace function public.add_past_medal(p_event uuid, p_category text, p_place integer, p_note text default null, p_fighter uuid default null, p_team uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_fighter uuid; v_team uuid;
begin
  if auth.uid() is null then raise exception 'sign in to add a medal' using errcode = '42501'; end if;
  select fa.fighter_id into v_me from public.fighter_accounts fa where fa.user_id = auth.uid();
  v_fighter := coalesce(p_fighter, v_me);
  if v_fighter is null then raise exception 'you have no fighter profile yet; create or claim one first' using errcode = '22023'; end if;
  if v_fighter <> coalesce(v_me, '00000000-0000-0000-0000-000000000000'::uuid) and not private.is_platform_organizer() then
    raise exception 'you can add medals to your own profile only' using errcode = '42501';
  end if;
  v_team := p_team;
  if v_team is null and v_fighter = v_me then select f.team_id into v_team from public.fighters f where f.id = v_fighter; end if;
  return private.record_past_medal(v_fighter, p_event, p_category, p_place, v_team, p_note, auth.uid());
end $$;
revoke execute on function public.add_past_medal(uuid, text, integer, text, uuid, uuid) from public, anon;
grant execute on function public.add_past_medal(uuid, text, integer, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 4. taking a report back
-- Only a reported medal that is still unverified, and only by the fighter it belongs to (or a platform organizer). Logged as voided with the reason.
-- The entry stays and becomes 'withdrawn' (no placing, no points, not an appearance): result_revisions and the audit trail hang from it, so it is
-- never deleted. The removal itself lives in one small private helper, as Pack 09C keeps every removal of result rows in private.discard_result.
create or replace function private.discard_past_medal_report(p_record_source uuid, p_result uuid, p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.record_sources rs where rs.id = p_record_source;
  perform private.discard_result(p_result);
  if not exists (select 1 from public.results r where r.entry_id = p_entry) and not exists (select 1 from public.matches m where m.entry_a = p_entry or m.entry_b = p_entry) then
    update public.entries e set status = 'withdrawn' where e.id = p_entry;
  end if;
end $$;
revoke execute on function private.discard_past_medal_report(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.withdraw_past_medal(p_result uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_src constant uuid := '5c2d7e1a-3f64-4b8e-9a0c-7d1e2f3a4b5c';
  v_r public.results; v_entry public.entries; v_event uuid; v_rs public.record_sources; v_reason text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_r from public.results r where r.id = p_result for update;
  if not found then raise exception 'that medal is not recorded' using errcode = 'P0002'; end if;
  select * into v_rs from public.record_sources rs where rs.source_id = v_src and rs.entity_type = 'result' and rs.entity_id = v_r.id;
  if not found then raise exception 'this placing is an official result, not a report; an organizer corrects it' using errcode = '22023'; end if;
  if v_rs.status <> 'unverified' then raise exception 'this medal has been verified; ask the owner to change it' using errcode = '22023'; end if;
  select * into v_entry from public.entries e where e.id = v_r.entry_id;
  v_event := private.event_of_competition(v_r.competition_id);
  if not (exists (select 1 from public.fighter_accounts fa where fa.user_id = auth.uid() and fa.fighter_id = v_entry.fighter_id) or private.is_platform_organizer()) then
    raise exception 'you can withdraw your own reported medals only' using errcode = '42501';
  end if;
  v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'withdrawn by the fighter');
  perform set_config('bos.unlock', 'on', true);
  perform private.log_result_revision(v_r.competition_id, v_r.entry_id, 'voided', v_r.final_place, v_r.points, null, null, v_reason);
  perform private.discard_past_medal_report(v_rs.id, v_r.id, v_entry.id);
  perform private.audit(v_event, 'result.report_withdrawn', v_r.competition_id::text, jsonb_build_object('entry', v_entry.id, 'fighter', v_entry.fighter_id, 'place', v_r.final_place, 'reason', v_reason));
  perform set_config('bos.unlock', '', true);
  return jsonb_build_object('status', 'withdrawn');
end $$;
revoke execute on function public.withdraw_past_medal(uuid, text) from public, anon;
grant execute on function public.withdraw_past_medal(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 5. which placings are reports, and whether they are verified
-- Follows the caller's own permissions on results and entries (public for a published event). No account ids.
create or replace view public.past_medal_records with (security_invoker = true) as
  select r.id as result_id, r.competition_id, k.event_id, r.entry_id, e.fighter_id, r.final_place, rs.status, rs.note, rs.created_at as reported_at
  from public.results r
  join public.record_sources rs on rs.entity_type = 'result' and rs.entity_id = r.id and rs.source_id = '5c2d7e1a-3f64-4b8e-9a0c-7d1e2f3a4b5c'
  join public.entries e on e.id = r.entry_id
  join public.competitions k on k.id = r.competition_id;
grant select on public.past_medal_records to anon, authenticated;
comment on view public.past_medal_records is 'Placings that were reported (add_past_medal) rather than fought in BuhurtOS, with the status of the report: unverified until confirmed.';

-- ---------------------------------------------------------------- 6. the four tournaments and Keston Piche's medals
-- Dates come from the sources recorded below (web search on 2026-10-17; the pages themselves could not be opened from the build environment).
-- Kings Cup 2025 could not be found online: its date is a PLACEHOLDER (January 1, 2025) and the event says so until someone confirms it.
do $$
declare
  v_hacsa uuid; v_ev uuid; v_src uuid; v_keston uuid; v_reavers uuid;
begin
  select id into v_hacsa from public.organizations where slug = 'hacsa';

  -- Kings Cup 2025 (date unknown)
  insert into public.events (slug, name, description, event_type, status, city, region, country, timezone, starts_on, ends_on, registration_mode, medals_only, time_note)
  values ('kings-cup-2025', 'Kings Cup 2025',
          'A 2025 armoured combat tournament, kept here for its medals. It was not run in BuhurtOS: there are no fights or scores, only the podium places fighters have reported. The exact date and venue have not been confirmed yet; the date shown is a placeholder until they are.',
          'tournament', 'published', null, null, 'CA', 'America/Edmonton', '2025-01-01', '2025-01-01', 'none', true, 'Exact date to be confirmed')
  on conflict (slug) do nothing;

  -- Strathmore Summer Siege 2025: HACSA, at the Strathmore Medieval Faire, Aug 22-24, 2025
  insert into public.events (slug, name, description, event_type, status, venue, city, region, country, timezone, starts_on, ends_on, registration_mode, medals_only, organization_id)
  values ('strathmore-summer-siege-2025', 'Strathmore Summer Siege 2025',
          'HACSA''s full-contact armoured tournament at the Strathmore Medieval Faire & Artisan Market, August 22 to 24, 2025. Kept here for its medals: it was not run in BuhurtOS, so there are no fights or scores, only the podium places fighters have reported.',
          'tournament', 'published', 'Strathmore Ag Grounds (Medieval Faire)', 'Strathmore', 'AB', 'CA', 'America/Edmonton', '2025-08-22', '2025-08-24', 'none', true, v_hacsa)
  on conflict (slug) do nothing;
  select id into v_ev from public.events where slug = 'strathmore-summer-siege-2025';
  insert into public.sources (kind, title, url, citation, retrieved_on)
  select 'imported', 'HACSA: Strathmore Summer Siege 2025 (event page)', 'https://www.hacsacanada.com/event-details-registration/strathmore-summer-siege-2025',
         'Listed as Aug 22, 2025 4:00 p.m. to Aug 24, 2025 6:00 p.m., at the Strathmore Medieval Faire; the faire ran Aug 22-24, 2025 (StrathmoreNow). Found by web search; the page itself was not opened.', '2026-10-17'
  where not exists (select 1 from public.sources s where s.url = 'https://www.hacsacanada.com/event-details-registration/strathmore-summer-siege-2025');
  select id into v_src from public.sources where url = 'https://www.hacsacanada.com/event-details-registration/strathmore-summer-siege-2025';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (v_src, 'event', v_ev, 'imported', 'Name, dates and place of the tournament.')
  on conflict (source_id, entity_type, entity_id) do nothing;

  -- Geeky Market 2025, Edmonton: the Holiday Geeky Gift Market, Edmonton EXPO Centre, Nov 22-23, 2025 (market dates; the tournament itself is not on the page)
  insert into public.events (slug, name, description, event_type, status, venue, city, region, country, timezone, starts_on, ends_on, registration_mode, medals_only, time_note)
  values ('geeky-market-2025', 'Geeky Market 2025 (Edmonton)',
          'Armoured combat tournament at the Holiday Geeky Gift Market, Edmonton EXPO Centre, November 22 to 23, 2025. Kept here for its medals: it was not run in BuhurtOS, so there are no fights or scores, only the podium places fighters have reported. The dates are the market''s; the tournament day within them is not confirmed.',
          'tournament', 'published', 'Edmonton EXPO Centre, Hall E', 'Edmonton', 'AB', 'CA', 'America/Edmonton', '2025-11-22', '2025-11-23', 'none', true, 'Market dates; tournament day to be confirmed')
  on conflict (slug) do nothing;
  select id into v_ev from public.events where slug = 'geeky-market-2025';
  insert into public.sources (kind, title, url, citation, retrieved_on)
  select 'imported', 'Edmonton EXPO Centre: Holiday Geeky Gift Market 2025', 'https://edmontonexpocentre.com/events/holiday-geeky-gift-market-2025/',
         'Market listed for November 22 (10 a.m. to 7 p.m.) and 23 (10 a.m. to 5 p.m.), 2025, Hall E. The page does not mention the tournament; the dates are the market''s.', '2026-10-17'
  where not exists (select 1 from public.sources s where s.url = 'https://edmontonexpocentre.com/events/holiday-geeky-gift-market-2025/');
  select id into v_src from public.sources where url = 'https://edmontonexpocentre.com/events/holiday-geeky-gift-market-2025/';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (v_src, 'event', v_ev, 'unverified', 'Dates of the market the tournament was part of; the tournament itself is not on the page.')
  on conflict (source_id, entity_type, entity_id) do nothing;

  -- Coulee Clash 2026: Company of the Black Spears, Servus Sports Centre, Lethbridge, May 30-31, 2026
  insert into public.events (slug, name, description, event_type, status, venue, city, region, country, timezone, starts_on, ends_on, registration_mode, medals_only, organization_id)
  values ('coulee-clash-2026', 'Coulee Clash 2026',
          'Lethbridge''s annual armoured combat tournament, hosted by the Company of the Black Spears at the Servus Sports Centre on the weekend of May 30 to 31, 2026, with more than 50 competitors from across Western Canada. Kept here for its medals: it was not run in BuhurtOS, so there are no fights or scores, only the podium places fighters have reported.',
          'tournament', 'published', 'Servus Sports Centre', 'Lethbridge', 'AB', 'CA', 'America/Edmonton', '2026-05-30', '2026-05-31', 'none', true, v_hacsa)
  on conflict (slug) do nothing;
  select id into v_ev from public.events where slug = 'coulee-clash-2026';
  insert into public.sources (kind, title, url, citation, retrieved_on)
  select 'imported', 'Lethbridge Herald: Armoured fighters bring medieval combat to Lethbridge Coulee Clash (June 2, 2026)', 'https://lethbridgeherald.com/news/lethbridge-news/2026/06/02/armoured-fighters-bring-medieval-combat-to-lethbridge-coulee-clash/',
         'Weekend tournament at the Servus Sports Centre hosted by the Company of the Black Spears, with a Sunday pro bout; Buhurt International and buhurt-ranking.com list the event on May 30, 2026 (longsword, buckler, shield, polearm, 3v3, 5v5, profight).', '2026-10-17'
  where not exists (select 1 from public.sources s where s.url like 'https://lethbridgeherald.com/news/lethbridge-news/2026/06/02/%');
  select id into v_src from public.sources where url like 'https://lethbridgeherald.com/news/lethbridge-news/2026/06/02/%';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (v_src, 'event', v_ev, 'imported', 'Dates, venue and host of the tournament.')
  on conflict (source_id, entity_type, entity_id) do nothing;

  -- Keston Piche (Red Deer Reavers), from his own report to the owner. Skipped, with a notice, on a database without that fighter.
  select f.id into v_keston from public.fighters f join public.teams t on t.id = f.team_id
   where f.display_name = 'Keston Piche' and t.slug = 'red-deer-reavers' and not private.is_synthetic('fighter', f.id);
  if v_keston is null then
    raise notice 'past_medals: fighter "Keston Piche" (red-deer-reavers) not found; his medals were not recorded here';
  else
    select id into v_reavers from public.teams where slug = 'red-deer-reavers';
    select id into v_ev from public.events where slug = 'kings-cup-2025';
    perform private.record_past_medal(v_keston, v_ev, 'longsword', 3, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'profight', 1, v_reavers, 'Reported by Keston to the owner');
    select id into v_ev from public.events where slug = 'strathmore-summer-siege-2025';
    perform private.record_past_medal(v_keston, v_ev, 'sword_shield', 3, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'longsword', 2, v_reavers, 'Reported by Keston to the owner');
    select id into v_ev from public.events where slug = 'geeky-market-2025';
    perform private.record_past_medal(v_keston, v_ev, 'longsword', 1, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'axe', 1, v_reavers, 'Reported by Keston to the owner; Keston still has to double-check this one');
    perform private.record_past_medal(v_keston, v_ev, 'buckler', 3, v_reavers, 'Reported by Keston to the owner');
    select id into v_ev from public.events where slug = 'coulee-clash-2026';
    perform private.record_past_medal(v_keston, v_ev, 'longsword', 1, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'greatsword', 1, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'polearm', 2, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'buckler', 3, v_reavers, 'Reported by Keston to the owner');
    perform private.record_past_medal(v_keston, v_ev, 'sabre', 2, v_reavers, 'Reported by Keston to the owner');
  end if;
end $$;
