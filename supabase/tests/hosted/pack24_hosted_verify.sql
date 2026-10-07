-- Pack 24 HOSTED verification (production-safe). Unlike supabase/tests/pack24a0_gate.sql and pack24_followups_gate.sql (local throwaway databases only),
-- this is written to be run on the hosted project. It is ONE DO block: it builds its own throwaway synthetic event (tagged with the existing test-data
-- source, a fresh random slug), a stand-in "real" event, three small competitions and their fighters, acts as the designated synthetic test organizer
-- (pack181-hosted-test@example.test) through the authenticated role, and ENDS WITH A DELIBERATE EXCEPTION, so every row it wrote is rolled back.
-- It never reads or writes a genuine event, fight or score, and never opens test-stuff-test / test-new-test. It contains no destructive keywords (the
-- Supabase SQL tool refuses those outright); the refusal of direct row removal is proven by the grant/policy state instead.
-- Expected: the exception message lists every check (P0001 refusals with their messages, 42501 on every structural table write, PASS on the allowed
-- writes, the audit rows and the synthetic tagging). Take row counts before and after to prove nothing remained (done on 2026-10-07: identical).
-- Run 2026-10-07 on mvbxlebznlgroptwwdsm after the three Pack 24 migrations: all checks as expected (see PACK_24A0_MATCH_SAFETY_GUARDS.md section 0.7).
do $v$
declare
  r text := '';
  src constant uuid := 'ac7ebfbe-8866-5e61-918e-0f3ae9fafab8';   -- the existing synthetic (test-data) source
  org constant uuid := 'a1810000-0000-4000-8000-000000000001';   -- pack181-hosted-test@example.test, the designated synthetic test organizer
  ev uuid := gen_random_uuid(); evr uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  f uuid[] := '{}'; e uuid[] := '{}'; rf uuid := gen_random_uuid();
  plan1 jsonb; plan2 jsonb; plan3 jsonb; ids_a uuid[]; ids_b uuid[];
  m_active uuid; m_wait uuid; m_c2 uuid; m_c3 uuid; ver int; n int; x jsonb; tf uuid; tfr uuid; ok boolean;
begin
  -- ---------------- fixtures, as the database owner with no client claims (all rolled back at the end)
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  for i in 1..10 loop f := f || gen_random_uuid(); e := e || gen_random_uuid(); end loop;
  insert into public.events (id, slug, name, status, starts_on, ends_on) values
    (ev,  'p24-verify-' || left(ev::text, 8),  'Pack 24 hosted verification (rolled back)', 'draft', current_date, current_date + 1),
    (evr, 'p24-verify-real-' || left(evr::text, 8), 'Pack 24 hosted verification, real-event stand-in (rolled back)', 'draft', current_date, current_date + 1);
  insert into public.record_sources (source_id, entity_type, entity_id) values (src, 'event', ev);
  insert into public.event_staff (event_id, user_id, role) values (ev, org, 'organizer'), (evr, org, 'organizer');
  insert into public.competitions (id, event_id, name, category, gender) values
    (c1, ev, 'P24 verify A', 'longsword', 'men'), (c2, ev, 'P24 verify B', 'longsword', 'men'), (c3, ev, 'P24 verify C', 'longsword', 'men'), (cr, evr, 'P24 verify real', 'longsword', 'men');
  for i in 1..10 loop
    insert into public.fighters (id, display_name) values (f[i], 'P24 Verify Fighter ' || i);
    insert into public.record_sources (source_id, entity_type, entity_id) values (src, 'fighter', f[i]);
  end loop;
  insert into public.fighters (id, display_name) values (rf, 'P24 Verify Real Stand-in');   -- untagged: a "real" fighter
  for i in 1..4 loop insert into public.entries (id, competition_id, fighter_id) values (e[i], c1, f[i]); end loop;
  for i in 5..8 loop insert into public.entries (id, competition_id, fighter_id) values (e[i], c2, f[i]); end loop;
  for i in 9..10 loop insert into public.entries (id, competition_id, fighter_id) values (e[i], c3, f[i]); end loop;
  plan1 := jsonb_build_array(
    jsonb_build_object('key','m1','stage','round_robin','round_label','Round 1','position',0,'a',e[1],'b',e[2]),
    jsonb_build_object('key','m2','stage','round_robin','round_label','Round 1','position',1,'a',e[3],'b',e[4]),
    jsonb_build_object('key','m3','stage','round_robin','round_label','Round 2','position',0,'a',e[1],'b',e[3]),
    jsonb_build_object('key','m4','stage','round_robin','round_label','Round 2','position',1,'a',e[2],'b',e[4]),
    jsonb_build_object('key','m5','stage','round_robin','round_label','Round 3','position',0,'a',e[1],'b',e[4]),
    jsonb_build_object('key','m6','stage','round_robin','round_label','Round 3','position',1,'a',e[2],'b',e[3]));
  plan2 := jsonb_build_array(
    jsonb_build_object('key','m1','stage','round_robin','round_label','Round 1','position',0,'a',e[5],'b',e[6]),
    jsonb_build_object('key','m2','stage','round_robin','round_label','Round 1','position',1,'a',e[7],'b',e[8]),
    jsonb_build_object('key','m3','stage','round_robin','round_label','Round 2','position',0,'a',e[5],'b',e[7]),
    jsonb_build_object('key','m4','stage','round_robin','round_label','Round 2','position',1,'a',e[6],'b',e[8]),
    jsonb_build_object('key','m5','stage','round_robin','round_label','Round 3','position',0,'a',e[5],'b',e[8]),
    jsonb_build_object('key','m6','stage','round_robin','round_label','Round 3','position',1,'a',e[6],'b',e[7]));
  plan3 := jsonb_build_array(jsonb_build_object('key','f','stage','final','round_label','Final','position',0,'a',e[9],'b',e[10]));

  -- ---------------- act as the organizer through the authenticated role (as the API would)
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', org::text, true);
  execute 'set local role authenticated';

  r := r || 'build_new=' || public.build_schedule(c1, plan1, 'new', null) || '/' || public.build_schedule(c2, plan2, 'new', null) || '/' || public.build_schedule(c3, plan3, 'new', null) || '; ';

  -- an untouched future schedule can still be replaced
  select array_agg(id order by id) into ids_a from public.matches where competition_id = c2;
  n := public.build_schedule(c2, plan2, 'replace', null);
  select array_agg(id order by id) into ids_b from public.matches where competition_id = c2;
  r := r || 'clean_replace=' || case when n = 6 and ids_a <> ids_b and cardinality(ids_b) = 6 then 'PASS' else 'FAIL' end || '; ';

  -- an active fight with a score event (through the real scoring RPC) and a live score
  select id into m_active from public.matches where competition_id = c1 and round_label = 'Round 1' and position = 0;
  select id into m_wait from public.matches where competition_id = c1 and round_label = 'Round 2' and position = 0;
  perform public.set_match_queue(m_active, 'active');
  perform public.record_score_event(gen_random_uuid(), m_active, 'point', '{"side":"a"}'::jsonb, now());
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  insert into public.match_live_scores (match_id, competition_id, score_a, score_b, phase, device, seq) values (m_active, c1, 1, 0, 'round', 'p24-verify', 1);
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', org::text, true);
  execute 'set local role authenticated';

  select array_agg(id order by id) into ids_a from public.matches where competition_id = c1;
  begin
    perform public.build_schedule(c1, plan1, 'replace', '{"mode":"random","seed":7,"algorithm":"x","format":"round_robin"}'::jsonb);
    r := r || 'replace_over_active=FAIL(allowed); ';
  exception when others then r := r || 'replace_over_active=' || sqlstate || ' "' || left(sqlerrm, 150) || '"; ';
  end;
  select array_agg(id order by id) into ids_b from public.matches where competition_id = c1;
  r := r || 'same_rows_after_refusal=' || case when ids_a = ids_b then 'PASS' else 'FAIL' end || '; ';
  r := r || 'active_still_active=' || (select queue_state from public.matches where id = m_active) || '; ';

  -- an official result (through finalize_match), then a replace
  select id, version into m_c2, ver from public.matches where competition_id = c2 and round_label = 'Round 1' and position = 0;
  perform public.finalize_match(m_c2, 'a', 2, 0, '{}'::jsonb, ver);
  begin
    perform public.build_schedule(c2, plan2, 'replace', null);
    r := r || 'replace_over_result=FAIL(allowed); ';
  exception when others then r := r || 'replace_over_result=' || sqlstate || ' "' || left(sqlerrm, 120) || '"; ';
  end;
  r := r || 'result_still_final=' || (select queue_state from public.matches where id = m_c2) || '; ';

  -- direct table writes as the organizer
  begin insert into public.matches (competition_id, stage, round_label, position) values (c1, 'round_robin', 'X', 9); r := r || 'tbl_insert=FAIL(allowed); ';
  exception when others then r := r || 'tbl_insert=' || sqlstate || '; '; end;
  begin update public.matches set entry_a = e[4] where id = m_wait; r := r || 'tbl_entry_a=FAIL(allowed); ';
  exception when others then r := r || 'tbl_entry_a=' || sqlstate || '; '; end;
  begin update public.matches set stage = 'final' where id = m_wait; r := r || 'tbl_stage=FAIL(allowed); ';
  exception when others then r := r || 'tbl_stage=' || sqlstate || '; '; end;
  begin update public.matches set next_match_id = m_active, next_slot = 'a' where id = m_wait; r := r || 'tbl_next_match=FAIL(allowed); ';
  exception when others then r := r || 'tbl_next_match=' || sqlstate || '; '; end;
  begin update public.matches set queue_state = 'on_deck' where id = m_wait; r := r || 'tbl_queue_state=FAIL(allowed); ';
  exception when others then r := r || 'tbl_queue_state=' || sqlstate || '; '; end;
  begin update public.matches set result = 'a' where id = m_wait; r := r || 'tbl_result=FAIL(allowed); ';
  exception when others then r := r || 'tbl_result=' || sqlstate || '; '; end;
  update public.matches set scheduled_at = now() + interval '1 day', field = 'Field 9', duration_minutes = 15 where id = m_wait;
  get diagnostics n = row_count;
  r := r || 'tbl_schedule_cols=' || case when n = 1 then 'PASS' else 'FAIL' end || '; ';

  -- holds
  x := public.set_match_hold(m_wait, true, 'Pack 24 hosted verification');
  r := r || 'set_match_hold=' || x::text || '; ';

  -- protected entrants through the table path
  begin update public.entries set fighter_id = f[9] where id = e[1]; r := r || 'entrant_repoint=FAIL(allowed); ';
  exception when others then r := r || 'entrant_repoint=' || sqlstate || ' "' || left(sqlerrm, 90) || '"; '; end;
  begin update public.entries set competition_id = c2 where id = e[1]; r := r || 'entrant_move=FAIL(allowed); ';
  exception when others then r := r || 'entrant_move=' || sqlstate || '; '; end;
  update public.entries set seed = 3 where id = e[1];
  get diagnostics n = row_count;
  r := r || 'entrant_seed_ok=' || case when n = 1 then 'PASS' else 'FAIL' end || '; ';

  -- synthetic fighter propagation
  x := public.create_unclaimed_fighter(ev, 'P24 Verify Tess Fictional', p_competition => c1);
  tf := (x ->> 'fighter_id')::uuid;
  r := r || 'test_fighter_return_synthetic=' || coalesce(x ->> 'synthetic', 'null') || '; ';
  begin perform public.add_entrant(cr, tf); r := r || 'test_fighter_into_real_event=FAIL(allowed); ';
  exception when others then r := r || 'test_fighter_into_real_event=' || sqlstate || '; '; end;
  perform public.add_entrant(c1, rf);
  x := public.create_unclaimed_fighter(evr, 'P24 Verify Real Person Stand-in', p_confirmed_distinct => true);
  tfr := (x ->> 'fighter_id')::uuid;

  -- ---------------- back to the owner for the record checks
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  r := r || 'score_events_kept=' || (select count(*) from public.score_events where match_id = m_active) || '; ';
  r := r || 'live_score_kept=' || (select count(*) from public.match_live_scores where match_id = m_active) || '; ';
  r := r || 'hold_manual=' || (select hold_manual from public.matches where id = m_wait) || '; ';

  -- a discipline review on an untouched fight
  select id into m_c3 from public.matches where competition_id = c3;
  insert into public.discipline_reviews (id, event_id, governing_body, kind, match_id, lodged_by_name, grounds, due_by, recorded_by)
  values (gen_random_uuid(), ev, 'Buhurt International', 'event_appeal', m_c3, 'P24 verify', 'Hosted verification appeal', now() + interval '1 day', org);
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', org::text, true);
  execute 'set local role authenticated';
  begin perform public.build_schedule(c3, plan3, 'replace', null); r := r || 'replace_over_discipline_review=FAIL(allowed); ';
  exception when others then r := r || 'replace_over_discipline_review=' || sqlstate || ' "' || left(sqlerrm, 110) || '"; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  r := r || 'review_fight_kept=' || (select count(*) from public.matches where id = m_c3) || '; ';

  r := r || 'test_fighter_synthetic=' || private.is_synthetic('fighter', tf) || '; ';
  r := r || 'test_fighter_source=' || coalesce((select string_agg(source_id::text, ',') from public.record_sources where entity_type = 'fighter' and entity_id = tf), 'none') || '; ';
  r := r || 'real_fighter_in_test_event_still_real=' || (not private.is_synthetic('fighter', rf)) || '; ';
  r := r || 'fighter_created_on_real_event_real=' || (not private.is_synthetic('fighter', tfr)) || '; ';
  r := r || 'test_fighter_not_in_real_comp=' || (not exists (select 1 from public.entries where competition_id = cr and fighter_id = tf)) || '; ';

  -- audit trail
  r := r || 'audit_replace_clean=' || coalesce((select details ->> 'replaced' from public.audit_log where action = 'schedule.built' and subject = c2::text and details ->> 'mode' = 'replace' limit 1), 'none') || '; ';
  r := r || 'audit_refused_replace_rows=' || (select count(*) from public.audit_log where action = 'schedule.built' and subject = c1::text and details ->> 'mode' = 'replace') || '; ';
  r := r || 'audit_queue=' || coalesce((select details ->> 'by' from public.audit_log where action = 'queue.state_set' and subject = m_active::text limit 1), 'none') || '; ';
  r := r || 'audit_hold=' || (select count(*) from public.audit_log where action = 'queue.hold_set' and subject = m_wait::text) || '; ';
  r := r || 'audit_schedule_changed=' || (select count(*) from public.audit_log where action = 'match.schedule_changed' and event_id = ev and actor = org) || '; ';
  r := r || 'audit_test_fighter=' || coalesce((select details ->> 'synthetic' from public.audit_log where action = 'fighter.created_by_organizer' and subject = tf::text), 'none');

  raise exception 'P24VERIFY ROLLED BACK: %', r;
end $v$;
