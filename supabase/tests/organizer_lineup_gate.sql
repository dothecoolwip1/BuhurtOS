-- Organizer lineup gate (20261022000200): save_field_lineup, replace_match_entrant, and the last secretary restrictions. Pack 18.1 fixture:
-- u1 organizer, u2 head marshal, u3 marshal, u4 scorekeeper (secretary) on E1; devices 'secretary' and 'admin' (Event Admin / temporary organizer).
-- Everything is rolled back.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

-- Field 1: m1 on now (active), m2 on deck, m5 waiting, m6 waiting on m5's result (side b is fed by m5). Field 2: m3 waiting, with scoring history.
select t.as_admin();
insert into public.fighters (id, display_name, gender, disciplines)
  select ('00000000-0000-0000-0000-' || lpad('f181' || n, 12, '0'))::uuid, 'Fighter ' || n, 'male', '{}' from generate_series(9, 11) n;
insert into public.entries (id, competition_id, fighter_id)
  select t.en(n), t.comp(1), ('00000000-0000-0000-0000-' || lpad('f181' || n, 12, '0'))::uuid from generate_series(9, 11) n;
update public.entries set status = 'withdrawn' where id = t.en(9);
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(6), t.comp(1), 'round_robin', 'Round 3', 5, t.en(2), null, 'scheduled', 'Field 1'),
  (t.m(5), t.comp(1), 'round_robin', 'Round 2', 4, t.en(1), t.en(3), 'scheduled', 'Field 1');
update public.matches set next_match_id = t.m(6), next_slot = 'b' where id = t.m(5);
update public.matches set queue_state = 'active' where id = t.m(1);
update public.matches set queue_state = 'on_deck' where id = t.m(2);
insert into public.score_events (id, match_id, kind, payload, recorded_by) values (gen_random_uuid(), t.m(3), 'point', '{}', t.u(3));
-- fighter 6 is registered and accepted but not ready (nothing checked in)
insert into public.waiver_versions (id, event_id, version, title, body) values ('00000000-0000-0000-0000-0000000a1820', t.ev(1), 1, 'Waiver', 'Fictional waiver text for the gate.');
insert into public.registrations (id, event_id, user_id, fighter_id, status, full_name, gender, organization, insurance, waiver_version_id, waiver_signed_name, is_volunteer)
values ('00000000-0000-0000-0000-0000000ae182', t.ev(1), t.u(10), ('00000000-0000-0000-0000-' || lpad('f1816', 12, '0'))::uuid, 'accepted', 'Fighter 6', 'male', 'HACSA', 'hacsa_member',
        '00000000-0000-0000-0000-0000000a1820', 'Signed', false);

create function t.vers(ids uuid[]) returns jsonb language sql stable as $$ select coalesce(jsonb_object_agg(id::text, jsonb_build_object('version', version, 'queue_state', queue_state, 'queue_order', queue_order, 'plan_order', plan_order, 'plan_hold', plan_hold)), '{}'::jsonb) from public.matches where id = any (ids) $$;
create function t.lineup() returns text language sql stable as $$
  select string_agg(right(id::text, 1) || ':' || queue_state || coalesce(':' || queue_order, ''), ',' order by id) from public.matches where id in (t.m(1), t.m(2), t.m(5), t.m(6)) $$;
create function t.n_audit(a text) returns integer language sql stable as $$ select count(*)::int from public.audit_log where action = a $$;
grant execute on function t.vers(uuid[]), t.lineup(), t.n_audit(text) to authenticated, bos_event_device;

-- ---------------------------------------------------------------- 1. who may save a lineup
select t.expect_eq('start: 1 now, 2 on deck, 5 and 6 waiting', t.lineup(), '1:active,2:on_deck,5:scheduled,6:scheduled');
select t.as_user(t.u(4));
select t.expect_error('secretary cannot read the organizer editable set', $q$select public.editable_field_lineup(t.ev(1), 'Field 1')$q$, '42501');
select t.expect_error('the secretary cannot save a lineup', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '42501');
select t.as_device(t.sid('secretary'));
select t.expect_error('... nor the secretary device', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '42501');
select t.as_user(t.u(2));
select t.expect_error('... nor the head marshal (organizer or Event Admin only)', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '42501');
select t.as_user(t.u(3));
select t.expect_error('... nor a marshal', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '42501');
select t.as_user(t.u(11));
select t.expect_error('... nor another event''s organizer', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '42501');
select t.as_anon();
select t.expect_error('... nor anyone signed out', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[]::uuid[], '{}'::jsonb)$q$);

-- ---------------------------------------------------------------- 2. stale sets and versions change nothing
select t.as_user(t.u(1));
select t.expect_eq('server editable set excludes active fights', public.editable_field_lineup(t.ev(1), 'Field 1'), array[t.m(2), t.m(5), t.m(6)]);
select t.expect_eq('server editable set excludes a waiting fight with recorded history', public.editable_field_lineup(t.ev(1), 'Field 2'), array[]::uuid[]);
select t.expect_eq('a list missing a fight (6, waiting on a result) is stale',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2)], t.vers(array[t.m(2), t.m(5)])) ->> 'status', 'stale');
select t.expect_eq('a list with the fight on now is stale (it never moves)',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(1), t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(1), t.m(2), t.m(5), t.m(6)])) ->> 'status', 'stale');
select t.expect_eq('an old version is stale',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]) || jsonb_build_object(t.m(5)::text, 0)) ->> 'status', 'stale');
select t.expect_eq('a missing version is stale',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5)])) ->> 'status', 'stale');
select t.expect_eq('... the stale answer lists what the server has', jsonb_array_length(public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5)], '{}'::jsonb) -> 'fights'), 3);
select t.expect_error('a fight listed twice is refused', $q$select public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(5), t.m(5), t.m(2), t.m(6)], t.vers(array[t.m(2), t.m(5), t.m(6)]))$q$, '22023');
select t.expect_eq('... nothing changed', t.lineup(), '1:active,2:on_deck,5:scheduled,6:scheduled');
select t.expect_eq('... and nothing was audited', t.n_audit('queue.lineup_saved'), 0);

-- ---------------------------------------------------------------- 3. the organizer's order
create temp table previous_line as select t.vers(array[t.m(2),t.m(5),t.m(6)]) as versions;
select t.expect_eq('the organizer puts 6, 5, 2: 6 cannot run yet and waits first, 5 goes on deck, 2 in the hole',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(6), t.m(5), t.m(2)], t.vers(array[t.m(2), t.m(5), t.m(6)])) ->> 'status', 'ok');
select t.expect_eq('... the field', t.lineup(), '1:active,2:in_the_hole,5:on_deck,6:scheduled:1');
select t.expect_eq('... audited once', t.n_audit('queue.lineup_saved'), 1);
select t.expect_eq('a second screen cannot overwrite a newer order even though scoring versions are unchanged', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(2),t.m(5),t.m(6)], (select versions from previous_line)) ->> 'status', 'stale');
select t.expect_eq('... queue moves never bump a fight''s version', (select version from public.matches where id = t.m(5)), 1);
select t.expect_eq('saving the same lineup again changes nothing',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(6), t.m(5), t.m(2)], t.vers(array[t.m(2), t.m(5), t.m(6)])) ->> 'changed', '0');
select t.expect_eq('... and writes no audit', t.n_audit('queue.lineup_saved'), 1);
select t.expect_eq('a field whose only fight has history has nothing to edit', public.save_field_lineup(t.ev(1), 'Field 2', array[]::uuid[], '{}'::jsonb) ->> 'status', 'ok');
select t.expect_eq('... and that fight cannot be listed', public.save_field_lineup(t.ev(1), 'Field 2', array[t.m(3)], t.vers(array[t.m(3)])) ->> 'status', 'stale');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Event Admin tablet saves 2, 6, 5', public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(2), t.m(6), t.m(5)], t.vers(array[t.m(2), t.m(5), t.m(6)])) ->> 'status', 'ok');
select t.expect_eq('... 2 on deck, 5 in the hole, 6 waiting', t.lineup(), '1:active,2:on_deck,5:in_the_hole,6:scheduled:1');
select t.as_admin();
select t.expect_eq('... the audit names the device', (select count(*)::int from public.audit_log where action = 'queue.lineup_saved' and details -> 'device' ->> 'label' = 'Event Admin Tablet'), 1);

-- ---------------------------------------------------------------- 4. another entrant
select t.as_user(t.u(4));
select t.expect_error('the secretary cannot change who fights', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(10), 'fighter injured', 1)$q$, '42501');
select t.as_user(t.u(2));
select t.expect_error('... nor the head marshal', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(10), 'fighter injured', 1)$q$, '42501');
select t.as_user(t.u(1));
select t.expect_error('not the fight on now', $q$select public.replace_match_entrant(t.m(1), 'a', t.en(10), 'fighter injured', (select version from public.matches where id=t.m(1)))$q$, 'P0001');
select t.expect_error('not a fight with history', $q$select public.replace_match_entrant(t.m(3), 'a', t.en(10), 'fighter injured', (select version from public.matches where id=t.m(3)))$q$, 'P0001');
select t.expect_error('not a side an earlier result fills', $q$select public.replace_match_entrant(t.m(6), 'b', t.en(10), 'fighter injured', (select version from public.matches where id=t.m(6)))$q$, 'P0001');
select t.expect_error('not the opponent', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(3), 'fighter injured', 1)$q$, 'P0001');
select t.expect_error('not a withdrawn entrant', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(9), 'fighter injured', 1)$q$, 'P0001');
select t.expect_error('not an entrant of another competition', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(7), 'fighter injured', 1)$q$, '22023');
select t.expect_error('not someone fighting right now (fighter 2 is on now)', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(2), 'fighter injured', 1)$q$, 'P0001');
select t.as_admin();
select t.expect_eq('fighter 6 is registered and not ready', (select bool_or(not ready) from private.readiness_rows(t.ev(1), false) where fighter_id = ('00000000-0000-0000-0000-' || lpad('f1816', 12, '0'))::uuid), true);
select t.as_user(t.u(1));
select t.expect_error('not someone who is not ready (readiness is authoritative)', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(6), 'fighter injured', 1)$q$, 'P0001');
select t.expect_error('a reason is required', $q$select public.replace_match_entrant(t.m(5), 'a', t.en(10), 'x', 1)$q$, '22023');
select t.expect_eq('an old version is stale', public.replace_match_entrant(t.m(5), 'a', t.en(10), 'fighter injured', 0) ->> 'status', 'stale');
select t.as_admin();
select t.expect_eq('... the refusals changed nothing', (select entry_a::text || '/' || version from public.matches where id = t.m(5)), t.en(1)::text || '/1');
select t.expect_eq('... and audited nothing', t.n_audit('match.entrant_replaced'), 0);
select t.as_user(t.u(1));
select t.expect_eq('the organizer puts fighter 10 in for fighter 1', public.replace_match_entrant(t.m(5), 'a', t.en(10), 'fighter injured', 1) ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... the side and the version moved', (select entry_a::text || '/' || version from public.matches where id = t.m(5)), t.en(10)::text || '/2');
select t.expect_eq('... audited with who was replaced and why',
  (select (details ->> 'from') || '>' || (details ->> 'to') || ':' || (details ->> 'reason') from public.audit_log where action = 'match.entrant_replaced'), t.en(1)::text || '>' || t.en(10)::text || ':fighter injured');
select t.expect_eq('... the fight keeps its place on the field', t.lineup(), '1:active,2:on_deck,5:in_the_hole,6:scheduled:1');
select t.as_user(t.u(1));
select t.expect_eq('a retry on the old version is stale', public.replace_match_entrant(t.m(5), 'a', t.en(11), 'fighter injured', 1) ->> 'status', 'stale');
select t.expect_eq('the same entrant again is unchanged', public.replace_match_entrant(t.m(5), 'a', t.en(10), 'fighter injured', 2) ->> 'status', 'unchanged');
select t.expect_eq('a lineup saved on the old version of 5 is stale',
  public.save_field_lineup(t.ev(1), 'Field 1', array[t.m(2), t.m(6), t.m(5)], t.vers(array[t.m(2), t.m(6)]) || jsonb_build_object(t.m(5)::text, 1)) ->> 'status', 'stale');
select t.as_device(t.sid('admin'));
select t.expect_eq('the Event Admin tablet fills the open side of 6 (not the fed one)', public.replace_match_entrant(t.m(6), 'a', t.en(11), 'late swap', (select version from public.matches where id=t.m(6))) ->> 'status', 'ok');

-- ---------------------------------------------------------------- 5. the secretary's last event-wide powers
select t.as_user(t.u(4));
select t.expect_error('the secretary cannot read the discipline desk', $q$select public.event_discipline_overview(t.ev(1))$q$, '42501');
select t.expect_error('... set the side colours', $q$select public.set_event_sides(t.ev(1), '{"a": {"name": "Red"}}'::jsonb)$q$, '42501');
select t.expect_error('... read the counters'' operator history', $q$select public.counter_operator_history(t.ev(1), null)$q$, '42501');
select t.as_admin();
insert into public.lyst_counter_seats (id, event_id, field_key, user_id, display_name, match_id, side, role, status, expires_at)
  values ('00000000-0000-0000-0000-5ec000000011', t.ev(1), 'field 1', t.u(9), 'Counter Nine', t.m(1), 'a', 'official', 'active', now() + interval '1 hour');
select t.as_user(t.u(4));
select t.expect_error('... or end someone else''s counter seat', $q$select public.end_counter_seat('00000000-0000-0000-0000-5ec000000011', false)$q$, '42501');
select t.as_user(t.u(9));
select t.expect_eq('the counter still ends their own seat', public.end_counter_seat('00000000-0000-0000-0000-5ec000000011', false) ->> 'status', 'ok');
select t.as_user(t.u(2));
select t.expect_ok('the head marshal reads the discipline desk', $q$select public.event_discipline_overview(t.ev(1))$q$);
select t.expect_ok('... and the operator history', $q$select public.counter_operator_history(t.ev(1), null)$q$);
select t.as_device(t.sid('admin'));
select t.expect_error('the Event Admin device keeps its existing SQL execute allowlist for operator history', $q$select public.counter_operator_history(t.ev(1), null)$q$, '42501');

select t.as_admin();
do $$ declare n integer; begin select count(*) into n from t.log; raise notice 'ORGANIZER LINEUP GATE PASSED % checks', n; end $$;
rollback;
