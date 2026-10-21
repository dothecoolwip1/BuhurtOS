-- Legacy counter evidence (additive). Older phones saved count actions with no run (and often no fight). They are retained here as AMBIGUOUS
-- evidence for a person to look at: the fight is never guessed, nothing is replayed into a tally, and no awarded score or official result is
-- touched. A phone may upload only its OWN seat's actions (an ended or carried seat included), while its session is alive.
--
-- Staff read one event-scoped list that combines this table with private.counter_recovery (late/refused modern evidence), so evidence stays
-- findable after a fight is official or a seat was replaced:
--   * organizer / head marshal (results resolver): all modern evidence of the event;
--   * other scoring staff (marshal, secretary, scoring devices): modern evidence only for fights they may score (private.can_score_match; for the
--     secretary that is the board only);
--   * legacy evidence (no fight authority can be established): the event's organizer only.
-- Reviews are a reasoned, audited decision only ('noted' / 'dismissed'). Modern evidence keeps public.review_counter_recovery(_batch).

create table private.counter_legacy_evidence (
  id uuid primary key,                                     -- the phone's own action id
  event_id uuid not null references public.events (id) on delete cascade,
  seat_id uuid not null references public.lyst_counter_seats (id) on delete cascade,
  uploader uuid not null,                                  -- auth.uid() of the seat holder (person or device session); never returned
  operator_name text,
  side text,
  role text not null,
  field_key text not null,
  -- The seat's assignment when the upload arrived. A HINT only: a seat can be carried between fights, so this is not proof of the fight.
  seat_match_hint uuid references public.matches (id) on delete set null,
  action jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  decision text check (decision in ('noted', 'dismissed')),
  review_reason text check (review_reason is null or char_length(review_reason) between 3 and 1000),
  reviewed_at timestamptz,
  reviewed_by uuid,
  check ((decision is null) = (reviewed_at is null))
);
create index counter_legacy_evidence_event on private.counter_legacy_evidence (event_id, received_at);
create index counter_legacy_evidence_seat on private.counter_legacy_evidence (seat_id);
alter table private.counter_legacy_evidence enable row level security;
revoke all on private.counter_legacy_evidence from public, anon, authenticated;

-- IDs share one namespace across legacy uploads, accepted counts and known-run
-- recovery. A later modern delivery cannot turn an ambiguous upload into a tap.
do $patch$
declare body text; anchor text := '  select * into old from public.lyst_counts where lyst_counts.id = v_id;';
begin
  body:=pg_get_functiondef('public.counter_deliver_action(uuid,uuid,jsonb)'::regprocedure);
  if strpos(body,anchor)=0 then raise exception 'counter action identity anchor missing'; end if;
  execute replace(body,anchor,$guard$
  if exists(select 1 from private.counter_legacy_evidence where id=v_id) then
    raise exception 'count ID is already retained as evidence with an unknown fight' using errcode='42501';
  end if;
$guard$||anchor);
end $patch$;

-- ---------------------------------------------------------------- upload (the seat holder only)
create function public.counter_upload_legacy_action(p_seat uuid, p_action jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.lyst_counter_seats; v_id uuid; v_kind text; v_round integer; v_weight integer;
  old public.lyst_counts; held private.counter_recovery; prior private.counter_legacy_evidence;
begin
  perform private.assert_session_alive();                  -- an ended session or a withdrawn code is refused here
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if exists (select 1 from private.device_ctx() d where d.role <> 'counter') then
    raise exception 'only a counter phone can send counter evidence' using errcode = '42501'; end if;
  select * into s from public.lyst_counter_seats where id = p_seat and user_id = auth.uid();
  if not found then raise exception 'that is not your counter seat' using errcode = '42501'; end if;
  if exists (select 1 from private.device_ctx() d where d.event_id <> s.event_id) then
    raise exception 'that seat belongs to another event' using errcode = '42501'; end if;

  -- shape: small, known keys only, exact types
  if p_action is null or jsonb_typeof(p_action) is distinct from 'object' or octet_length(p_action::text) > 2048 then
    raise exception 'invalid count action' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_action) k where k not in ('id', 'kind', 'round', 'weight', 'matchId', 'recovery', 'recordedAt', 'undoWeight', 'runId')) then
    raise exception 'invalid count action: unknown field' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'runId') is not null and jsonb_typeof(p_action -> 'runId') <> 'null' then
    raise exception 'this count has a round identity: send it as a normal count' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'id') is distinct from 'string'
     or (p_action ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid count action: id' using errcode = '22023'; end if;
  v_id := (p_action ->> 'id')::uuid;
  v_kind := case when jsonb_typeof(p_action -> 'kind') = 'string' then p_action ->> 'kind' end;
  if v_kind is null or v_kind not in ('tap', 'undo') then raise exception 'invalid count action: kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'round') is distinct from 'number' or (p_action ->> 'round') !~ '^([1-9]|1[0-9]|20)$' then
    raise exception 'invalid count action: round' using errcode = '22023'; end if;
  v_round := (p_action ->> 'round')::integer;
  if v_kind = 'tap' then
    if jsonb_typeof(p_action -> 'weight') is distinct from 'number' or (p_action ->> 'weight') !~ '^[12]$' then
      raise exception 'invalid count action: weight' using errcode = '22023'; end if;
    v_weight := (p_action ->> 'weight')::integer;
  end if;
  if jsonb_typeof(p_action -> 'undoWeight') is not null and ((p_action -> 'undoWeight') is distinct from '1'::jsonb and (p_action -> 'undoWeight') is distinct from '2'::jsonb) then
    raise exception 'invalid count action: undo weight' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'matchId') is not null and jsonb_typeof(p_action -> 'matchId') not in ('string', 'null') or char_length(coalesce(p_action ->> 'matchId', '')) > 64 then
    raise exception 'invalid count action: fight' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'recovery') is not null and jsonb_typeof(p_action -> 'recovery') not in ('boolean', 'null') then
    raise exception 'invalid count action: recovery' using errcode = '22023'; end if;
  if jsonb_typeof(p_action -> 'recordedAt') is not null and jsonb_typeof(p_action -> 'recordedAt') not in ('string', 'null') or char_length(coalesce(p_action ->> 'recordedAt', '')) > 64 then
    raise exception 'invalid count action: time' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('bos:counter-action:' || v_id::text, 0));
  -- Already counted (the acknowledgement was lost): acknowledge, never replay.
  select * into old from public.lyst_counts where id = v_id;
  if found then
    if old.seat_id <> p_seat or old.round_no <> v_round or (old.undo_of is null) <> (v_kind = 'tap') or (v_kind = 'tap' and old.weight <> v_weight) then
      raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'already_accepted', 'id', v_id);
  end if;
  -- Already retained through the modern path.
  select * into held from private.counter_recovery where id = v_id;
  if found then
    if held.seat_id <> p_seat or held.action ->> 'kind' is distinct from v_kind or (held.action ->> 'round')::integer is distinct from v_round
       or (v_kind = 'tap' and (held.action ->> 'weight')::integer is distinct from v_weight) then
      raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'already_retained', 'id', v_id);
  end if;
  -- A retry of this upload.
  select * into prior from private.counter_legacy_evidence where id = v_id;
  if found then
    if prior.seat_id <> p_seat or prior.action <> p_action then raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', v_id);
  end if;

  insert into private.counter_legacy_evidence (id, event_id, seat_id, uploader, operator_name, side, role, field_key, seat_match_hint, action)
  values (v_id, s.event_id, s.id, auth.uid(), s.display_name, s.side, s.role, s.field_key, s.match_id, p_action);
  perform private.audit(s.event_id, 'counter.legacy_evidence_retained', s.id::text,
    jsonb_build_object('action', v_id, 'seat', s.id, 'round', v_round, 'kind', v_kind, 'fight', 'unknown'));
  return jsonb_build_object('status', 'retained', 'id', v_id);
end $$;

-- ---------------------------------------------------------------- one event-scoped list for staff
create function private.counter_fight_label(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('match_id', m.id, 'competition', k.name, 'round_label', m.round_label, 'field', m.field,
    'a', private.lyst_side_name(m.entry_a), 'b', private.lyst_side_name(m.entry_b), 'queue_state', m.queue_state,
    'official', m.queue_state = 'final', 'current', exists (select 1 from public.lyst_field_current f where f.match_id = m.id))
  from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match
$$;
revoke execute on function private.counter_fight_label(uuid) from public, anon, authenticated;

create function public.event_counter_evidence(p_event uuid, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org boolean; v_all boolean; v_modern jsonb; v_legacy jsonb;
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
  return jsonb_build_object('modern', v_modern, 'legacy', v_legacy, 'can_review_legacy', v_org, 'sees_all_fights', v_all, 'next_offset', case when greatest(jsonb_array_length(v_modern),jsonb_array_length(v_legacy))=500 then p_offset+500 end, 'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------- reasoned review of legacy evidence (organizer only); never touches a score
create function public.review_legacy_counter_evidence(p_ids uuid[], p_decision text, p_reason text) returns integer
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
    if e.decision is not null then raise exception 'this evidence was already reviewed' using errcode = 'P0001'; end if;
    update private.counter_legacy_evidence set decision = p_decision, review_reason = v_reason, reviewed_at = clock_timestamp(), reviewed_by = auth.uid() where id = v_id;
    perform private.audit(e.event_id, 'counter.legacy_evidence_reviewed', e.seat_id::text,
      jsonb_build_object('evidence', v_id, 'decision', p_decision, 'reason', v_reason, 'fight', 'unknown'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- API surface
revoke execute on function public.counter_upload_legacy_action(uuid, jsonb), public.event_counter_evidence(uuid,integer), public.review_legacy_counter_evidence(uuid[], text, text) from public, anon;
grant execute on function public.counter_upload_legacy_action(uuid, jsonb), public.event_counter_evidence(uuid,integer), public.review_legacy_counter_evidence(uuid[], text, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.counter_upload_legacy_action(uuid, jsonb), public.event_counter_evidence(uuid,integer), public.review_legacy_counter_evidence(uuid[], text, text) to bos_event_device;
  end if;
end $$;
notify pgrst, 'reload schema';
