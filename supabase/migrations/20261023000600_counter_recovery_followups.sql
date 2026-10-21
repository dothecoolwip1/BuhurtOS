-- Counter recovery follow-ups (review 2). ADDITIVE: new nullable columns, anchored patches and same-signature function replacements; grants kept.
-- No existing row is rewritten: old accepted counts keep no reported metadata (nothing is fabricated), receipts and runs are untouched.
--
--   H2  Delivery-risk staleness is measured against the run's close time once the round has ended (now while it runs). A phone may report
--       seen/pending on its seat's latest run while that round is being confirmed, but only a RUNNING run can record a start. Done refreshes the
--       seat's receipt (seen now, pending 0) and never records a start. counter_delivery_state also returns the run's closed_at for the client mirror.
--   M2  A delivered count keeps what the phone REPORTED (operator, time, side, fighter, opponent; type- and length-checked, unverified) and when the
--       server received it, beside the official count row (whose server time and seat name are unchanged). A retry never overwrites the first report.
--       event_counter_evidence returns these as 'accepted', with the same role/event scoping and paging as the other lists.
--   M3  The direct count functions (counter_record / counter_undo, still granted for older apps) take the same per-action lock as
--       counter_deliver_action, before anything else, and refuse an id already kept as evidence (unknown fight, or a known run's review evidence).
--   L2  Repeating a review with the same decision and (trimmed) reason succeeds without a second audit row; a different one is still refused.

create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;
  if position(p_from in v_def) = 0 then raise exception 'counter follow-up patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;

-- ================================================================ H2: receipts and the confirmation warning
create or replace function public.counter_acknowledge_run(p_seat uuid, p_run uuid, p_started boolean, p_pending integer default 0) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.lyst_counter_seats; r private.counter_runs; v_latest uuid; v_round text;
begin
  perform private.assert_session_alive();
  if p_started is null or p_pending is null or p_pending not between 0 and 100000 then raise exception 'invalid counter receipt' using errcode = '22023'; end if;
  select * into s from public.lyst_counter_seats where id = p_seat and user_id = auth.uid() and status = 'active' and expires_at >= now();
  if not found then raise exception 'that is not your active seat' using errcode = '42501'; end if;
  select * into r from private.counter_runs where id = p_run and match_id = s.match_id;
  if not found or private.field_current_match(s.event_id, s.field_key) is distinct from s.match_id then
    raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
  if r.status = 'closed' then
    -- The round ended and is being confirmed: the phone may still say it is here and how much it holds, on that exact latest run.
    -- It can never record a start now.
    select x.id into v_latest from private.counter_runs x where x.match_id = s.match_id order by x.round_no desc, x.generation desc limit 1;
    select lr.status into v_round from public.lyst_rounds lr where lr.match_id = s.match_id and lr.round_no = r.round_no;
    if p_started or v_latest is distinct from r.id or v_round is distinct from 'confirming' then
      raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
    update private.counter_receipts set seen_at = clock_timestamp(), pending = p_pending where run_id = p_run and seat_id = p_seat;
    if not found then raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
    return;
  end if;
  if p_started and r.status <> 'running' then raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
  insert into private.counter_receipts(run_id, seat_id, prepared_at, seen_at, started_at, pending)
    values (p_run, p_seat, clock_timestamp(), clock_timestamp(), case when p_started then clock_timestamp() end, p_pending)
    on conflict (run_id, seat_id) do update set prepared_at = coalesce(private.counter_receipts.prepared_at, excluded.prepared_at), seen_at = clock_timestamp(), pending = excluded.pending,
      started_at = coalesce(private.counter_receipts.started_at, excluded.started_at);
end $$;

-- Done: the phone has delivered what it holds for this round (it flushes first). Refresh its receipt; a missing start stays missing.
select pg_temp.bos_patch('public.counter_submit(uuid,integer)'::regprocedure,
  $a$insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values (p_seat, v_s.match_id, p_round) on conflict do nothing;$a$,
  $b$insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values (p_seat, v_s.match_id, p_round) on conflict do nothing;
  -- counter follow-up 20261023000600: Done refreshes the receipt of the round's latest run (never its start)
  update private.counter_receipts c set seen_at = clock_timestamp(), pending = 0
   where c.seat_id = p_seat and c.run_id = (select x.id from private.counter_runs x where x.match_id = v_s.match_id and x.round_no = p_round order by x.generation desc limit 1);$b$);

-- A healthy phone: start received, nothing pending, Done, heard from within 20 s of the round's end (or of now while it runs), no open evidence.
create or replace function private.counter_confirmation_risks(p_match uuid, p_round integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.lyst_counter_seats s
    left join lateral (select r.id, r.status, r.closed_at from private.counter_runs r where r.match_id = p_match and r.round_no = p_round order by r.generation desc limit 1) run on true
    left join private.counter_receipts c on c.run_id = run.id and c.seat_id = s.id
    where s.match_id = p_match and s.status = 'active' and s.role = 'official'
    and (c.started_at is null or c.pending > 0 or c.seen_at is null
      or c.seen_at < (case when run.status = 'closed' and run.closed_at is not null then run.closed_at else clock_timestamp() end) - interval '20 seconds'
      or not exists (select 1 from public.lyst_counter_rounds done where done.seat_id = s.id and done.match_id = p_match and done.round_no = p_round))
  ) or exists (select 1 from private.counter_recovery e join private.counter_runs r on r.id = e.run_id
    join public.lyst_counter_seats s on s.id = e.seat_id
    where r.match_id = p_match and r.round_no = p_round and s.role = 'official' and e.decision is null)
$$;
revoke execute on function private.counter_confirmation_risks(uuid, integer) from public, anon, authenticated;

create or replace function private.counter_delivery_state(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
    'run_id', r.id, 'round', r.round_no, 'run_status', r.status, 'closed_at', r.closed_at,
    'prepared_at', ack.prepared_at, 'started_at', ack.started_at, 'seen_at', ack.seen_at, 'pending', ack.pending,
    'submitted', exists (select 1 from public.lyst_counter_rounds c where c.seat_id = s.id and c.round_no = r.round_no and c.match_id = p_match)) order by s.role, s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s
  left join lateral (select cr.* from private.counter_runs cr where cr.match_id = p_match order by cr.round_no desc, cr.generation desc limit 1) r on true
  left join private.counter_receipts ack on ack.run_id = r.id and ack.seat_id = s.id
  where s.match_id = p_match and s.status = 'active'
$$;
revoke execute on function private.counter_delivery_state(uuid) from public, anon, authenticated;

-- ================================================================ M2: what the phone reported, kept beside the accepted count
alter table private.counter_action_runs add column reported jsonb, add column received_at timestamptz;

create function private.counter_claim(p_value jsonb, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') between 1 and p_max then p_value #>> '{}' end
$$;
-- Unverified claims only. Fields of the wrong type or too long are dropped and named in 'invalid'.
create function private.counter_reported(p_action jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with f(k, n) as (values ('operator', 80), ('recordedAt', 64), ('side', 8), ('fighter', 120), ('opponent', 120))
  select coalesce((select jsonb_object_agg(f.k, private.counter_claim(p_action -> f.k, f.n)) from f where private.counter_claim(p_action -> f.k, f.n) is not null), '{}'::jsonb)
      || coalesce((select jsonb_build_object('invalid', jsonb_agg(f.k order by f.k)) from f
                   where jsonb_typeof(p_action -> f.k) is not null and jsonb_typeof(p_action -> f.k) <> 'null' and private.counter_claim(p_action -> f.k, f.n) is null
                   having count(*) > 0), '{}'::jsonb)
$$;
revoke execute on function private.counter_claim(jsonb, integer), private.counter_reported(jsonb) from public, anon, authenticated;

-- First delivery wins (on conflict do nothing): a retry with different claims never rewrites the first report.
select pg_temp.bos_patch('public.counter_deliver_action(uuid,uuid,jsonb)'::regprocedure,
  $a$insert into private.counter_action_runs(id,run_id) values(v_id,p_run) on conflict do nothing;$a$,
  $b$insert into private.counter_action_runs(id,run_id,reported,received_at) values(v_id,p_run,private.counter_reported(p_action),clock_timestamp()) on conflict do nothing;$b$);

-- ================================================================ M3: the direct count functions share the action identity
select pg_temp.bos_patch('public.counter_record(uuid,uuid,integer,integer)'::regprocedure,
  $a$if p_id is null then raise exception 'a tap id is required' using errcode = '22023'; end if;$a$,
  $b$if p_id is null then raise exception 'a tap id is required' using errcode = '22023'; end if;
  -- counter follow-up 20261023000600: same per-action lock as counter_deliver_action, before any seat, match or field lock
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-action:' || p_id::text, 0));
  if exists (select 1 from private.counter_legacy_evidence where id = p_id) or exists (select 1 from private.counter_recovery where id = p_id) then
    raise exception 'count ID is already kept as evidence for review' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.counter_undo(uuid,uuid,integer)'::regprocedure,
  $a$if p_id is null then raise exception 'an undo id is required' using errcode = '22023'; end if;$a$,
  $b$if p_id is null then raise exception 'an undo id is required' using errcode = '22023'; end if;
  -- counter follow-up 20261023000600: same per-action lock as counter_deliver_action, before any seat, match or field lock
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-action:' || p_id::text, 0));
  if exists (select 1 from private.counter_legacy_evidence where id = p_id) or exists (select 1 from private.counter_recovery where id = p_id) then
    raise exception 'count ID is already kept as evidence for review' using errcode = '42501'; end if;$b$);

-- ================================================================ L2: a repeated identical review is a success
create or replace function public.review_counter_recovery(p_id uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e private.counter_recovery; m uuid; ev uuid;
begin
  perform private.assert_session_alive();
  select * into e from private.counter_recovery where id = p_id;
  select match_id into m from private.counter_runs where id = e.run_id;
  ev := private.event_of_match(m);
  if auth.uid() is null or ev is null or not (private.can_score_match(m) or private.can_resolve_results(ev)) then raise exception 'only this event''s scoring staff can review evidence' using errcode = '42501'; end if;
  select * into e from private.counter_recovery where id = p_id for update;
  if p_decision is null or p_decision not in ('noted', 'dismissed') or char_length(btrim(coalesce(p_reason, ''))) < 3 or char_length(p_reason) > 1000 then
    raise exception 'record a decision and a reason' using errcode = '22023'; end if;
  if e.decision is not null then
    if e.decision = p_decision and e.review_reason = btrim(p_reason) then return; end if;   -- a retry of the same review
    raise exception 'this evidence was already reviewed' using errcode = 'P0001';
  end if;
  update private.counter_recovery set decision = p_decision, review_reason = btrim(p_reason), reviewed_at = clock_timestamp(), reviewed_by = auth.uid() where id = p_id;
  perform private.audit(ev, 'counter.evidence_reviewed', m::text, jsonb_build_object('evidence', p_id, 'decision', p_decision, 'reason', btrim(p_reason)));
end $$;

-- Returns how many items this call newly reviewed (a repeated identical review counts 0).
create or replace function public.review_legacy_counter_evidence(p_ids uuid[], p_decision text, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; e private.counter_legacy_evidence; v_reason text := btrim(coalesce(p_reason, '')); n integer := 0;
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if coalesce(cardinality(p_ids), 0) not between 1 and 1000 then raise exception 'review 1 to 1000 actions at a time' using errcode = '22023'; end if;
  if p_decision is null or p_decision not in ('noted', 'dismissed') or char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception 'record a decision and a reason' using errcode = '22023'; end if;
  for v_id in select distinct u from unnest(p_ids) u where u is not null order by 1 loop
    select * into e from private.counter_legacy_evidence where id = v_id;
    if not found then raise exception 'evidence not found' using errcode = 'P0002'; end if;
    if not coalesce(private.is_organizer(e.event_id), false) then
      raise exception 'only this event''s organizer can review evidence whose fight is unknown' using errcode = '42501'; end if;
    select * into e from private.counter_legacy_evidence where id = v_id for update;
    if e.decision is not null then
      if e.decision = p_decision and e.review_reason = v_reason then continue; end if;   -- a retry of the same review
      raise exception 'this evidence was already reviewed' using errcode = 'P0001';
    end if;
    update private.counter_legacy_evidence set decision = p_decision, review_reason = v_reason, reviewed_at = clock_timestamp(), reviewed_by = auth.uid() where id = v_id;
    perform private.audit(e.event_id, 'counter.legacy_evidence_reviewed', e.seat_id::text,
      jsonb_build_object('evidence', v_id, 'decision', p_decision, 'reason', v_reason, 'fight', 'unknown'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ================================================================ M2: accepted counts in the event-wide evidence list
-- Only counts delivered through counter_deliver_action since this migration (received_at set). Backfilled run mappings and older direct counts
-- have no reported metadata and are not listed here.
create function private.counter_accepted_provenance(p_event uuid, p_all boolean, p_offset integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.at desc, x.id desc), '[]'::jsonb) from (
    select a.received_at as at, c.id, jsonb_build_object('id', c.id, 'kind', 'accepted', 'seat_id', s.id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
      'field_key', s.field_key, 'run_id', r.id, 'round', c.round_no, 'generation', r.generation, 'fight', private.counter_fight_label(c.match_id),
      'count', jsonb_build_object('kind', case when c.undo_of is null then 'tap' else 'undo' end, 'weight', c.weight),
      'server_operator', c.operator_name, 'recorded_at', c.created_at, 'received_at', a.received_at,
      'reported', coalesce(a.reported, '{}'::jsonb), 'reported_unverified', true) as j
    from private.counter_action_runs a
    join public.lyst_counts c on c.id = a.id
    join private.counter_runs r on r.id = a.run_id
    join public.lyst_counter_seats s on s.id = c.seat_id
    where a.received_at is not null and s.event_id = p_event and private.event_of_match(c.match_id) = p_event
      and (p_all or private.can_score_match(c.match_id))
    order by a.received_at desc, c.id desc limit 500 offset p_offset) x
$$;
revoke execute on function private.counter_accepted_provenance(uuid, boolean, integer) from public, anon, authenticated;

create or replace function public.event_counter_evidence(p_event uuid, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org boolean; v_all boolean; v_modern jsonb; v_legacy jsonb; v_accepted jsonb;
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then raise exception 'invalid evidence page' using errcode='22023'; end if;
  v_org := coalesce(private.is_organizer(p_event), false);
  v_all := v_org or coalesce(private.can_resolve_results(p_event), false);
  if not (v_all or coalesce(private.can_score(p_event), false)) then
    raise exception 'only this event''s scoring staff can see counter evidence' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_modern from (
    select e.received_at as at, jsonb_build_object('id', e.id, 'kind', 'modern', 'seat_id', s.id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
      'field_key', s.field_key, 'run_id', r.id, 'round', r.round_no, 'generation', r.generation, 'fight', private.counter_fight_label(r.match_id),
      'action', e.action, 'reason', e.reason, 'received_at', e.received_at, 'decision', e.decision, 'review_reason', e.review_reason, 'reviewed_at', e.reviewed_at) as j
    from private.counter_recovery e
    join private.counter_runs r on r.id = e.run_id
    join public.lyst_counter_seats s on s.id = e.seat_id
    where s.event_id = p_event and private.event_of_match(r.match_id) = p_event
      and (v_all or private.can_score_match(r.match_id))
    order by e.received_at desc, e.id desc limit 500 offset p_offset) x;

  if v_org then
    select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_legacy from (
      select l.received_at as at, jsonb_build_object('id', l.id, 'kind', 'legacy', 'seat_id', l.seat_id, 'operator', l.operator_name, 'side', l.side, 'role', l.role,
        'field_key', l.field_key, 'round', (l.action ->> 'round')::integer, 'fight', null, 'fight_unknown', true,
        'seat_fight_hint', case when l.seat_match_hint is null then null else private.counter_fight_label(l.seat_match_hint) end,
        'action', l.action, 'received_at', l.received_at, 'decision', l.decision, 'review_reason', l.review_reason, 'reviewed_at', l.reviewed_at) as j
      from private.counter_legacy_evidence l where l.event_id = p_event
      order by l.received_at desc, l.id desc limit 500 offset p_offset) x;
  else v_legacy := '[]'::jsonb;
  end if;
  v_accepted := private.counter_accepted_provenance(p_event, v_all, p_offset);
  return jsonb_build_object('modern', v_modern, 'legacy', v_legacy, 'accepted', v_accepted, 'can_review_legacy', v_org, 'sees_all_fights', v_all,
    'next_offset', case when greatest(jsonb_array_length(v_modern), jsonb_array_length(v_legacy), jsonb_array_length(v_accepted)) = 500 then p_offset + 500 end,
    'server_now', clock_timestamp());
end $$;

notify pgrst, 'reload schema';
