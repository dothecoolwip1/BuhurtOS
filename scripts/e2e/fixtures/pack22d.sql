-- Local fixture for scripts/e2e/pack22-discipline-live.mjs (official rules text, discipline desk, suspensions, eligibility). LOCAL THROWAWAY DATABASE ONLY.
-- Everything from the Pack 16 fixture (event "Test stuff test": Aldric, Brann, Cael, Dara registered and accepted; a2 organizer, a4 scorekeeper (the
-- Secretary), c1 head marshal (the Knight Marshal), d1 check-in desk, d2 inspector (the Authenticity Officer), d3 captain of Iron Wolves, fighter1 =
-- Aldric's own account, fighter2 = Brann's), plus:
--   * the Buhurt International release 2026-10-06 (loaded by the migrations, in review): the owner publishes the documents the run reads (both
--     structure documents too, so the recorded tier points conflict is visible);
--   * Org A (admin e1) owns the event; Org B (admin e2) owns nothing here;
--   * the Buhurt International card list on the event's tablet, and one yellow card already recorded against Brann in Longsword m1;
--   * Longsword m2 already fought, with nothing recorded.
\i scripts/e2e/fixtures/pack16.sql
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e1@example.test'), ('00000000-0000-0000-0000-0000000000e2', 'e2@example.test');
update public.profiles set display_name = case right(id::text, 1) when '1' then 'Org A Admin' else 'Org B Admin' end, onboarded_at = now() where id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
insert into public.organizations (id, slug, name, kind) values ('00000000-0000-0000-0000-0000000a0a01', 'org-a-test', 'Org A', 'national'), ('00000000-0000-0000-0000-0000000a0a02', 'org-b-test', 'Org B', 'national');
insert into public.organization_staff (organization_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000a0a01', '00000000-0000-0000-0000-0000000000e1', 'admin'), ('00000000-0000-0000-0000-0000000a0a02', '00000000-0000-0000-0000-0000000000e2', 'admin');
update public.events set organization_id = '00000000-0000-0000-0000-0000000a0a01' where id = '00000000-0000-0000-0000-00000000ed01';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.publish_ruleset_version(v.id, 'published for the browser run')
  from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id
 where r.governing_body = 'Buhurt International' and not v.historical and r.inventory_key in ('marshal/buhurt-rules', 'tournament/buhurt-regulations', 'marshal/duels-rules', 'tournament/duel-regulations',
       'authenticity/infractions', 'marshal/accreditation', 'marshal/weapon-shield-chart', 'authenticity/falchions', 'authenticity/tabards',
       'tournament/league-structure', 'tournament/tournament-structure');
select set_config('request.jwt.claim.sub', '', false);

insert into public.event_lyst_settings (event_id, settings) values ('00000000-0000-0000-0000-00000000ed01',
  '{"cards": [{"key": "reprimand", "label": "Reprimand"}, {"key": "yellow_card", "label": "Yellow card"}, {"key": "red_card", "label": "Red card"}, {"key": "green_card", "label": "Green card"}]}')
on conflict (event_id) do update set settings = public.event_lyst_settings.settings || excluded.settings;
insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000fd001', '00000000-0000-0000-0000-00000000ed01', 1, 'b', 'card', 'Yellow card');
insert into public.match_discipline_private (discipline_id, reason, called_by, recorded_by) values
  ('00000000-0000-0000-0000-00000000dd01', 'Struck after the stop', 'Knight Marshal', '00000000-0000-0000-0000-0000000000a4');
-- Fight m2 has been fought and nothing was recorded in it: an appeal can still be about it ("unregistered violation", Buhurt Regulations 7.3).
update public.matches set queue_state = 'final', finalized_at = now() - interval '5 minutes' where id = '00000000-0000-0000-0000-0000000fd002';
