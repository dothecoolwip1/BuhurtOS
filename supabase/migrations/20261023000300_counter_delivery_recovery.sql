-- A phone must know WHICH fight, round and run it is counting before losing
-- signal. Returning a round creates a new run; late evidence never crosses it.
create table private.counter_runs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  generation integer not null default 1,
  status text not null check (status in ('prepared', 'running', 'closed')),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  closed_at timestamptz,
  unique (match_id, round_no, generation)
);
create table private.counter_receipts (
  run_id uuid not null references private.counter_runs(id) on delete cascade,
  seat_id uuid not null references public.lyst_counter_seats(id) on delete cascade,
  prepared_at timestamptz,
  started_at timestamptz,
  seen_at timestamptz,
  pending integer not null default 0 check (pending between 0 and 100000),
  primary key (run_id, seat_id)
);
create table private.counter_recovery (
  id uuid primary key,
  run_id uuid not null references private.counter_runs(id) on delete cascade,
  seat_id uuid not null references public.lyst_counter_seats(id) on delete cascade,
  action jsonb not null,
  reason text not null,
  received_at timestamptz not null default clock_timestamp(),
  decision text check (decision in ('noted', 'dismissed')),
  review_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid
);
create table private.counter_action_runs (
  id uuid primary key references public.lyst_counts(id) on delete cascade,
  run_id uuid not null references private.counter_runs(id) on delete cascade
);
alter table private.counter_runs enable row level security;
alter table private.counter_receipts enable row level security;
alter table private.counter_recovery enable row level security;
alter table private.counter_action_runs enable row level security;
revoke all on private.counter_runs, private.counter_receipts, private.counter_recovery, private.counter_action_runs from public, anon, authenticated;
create index counter_recovery_run on private.counter_recovery(run_id, received_at);
create index counter_receipts_seat on private.counter_receipts(seat_id, seen_at);

-- Backfill every existing round, including in-flight hosted fights. Do not
-- reset a clock, count, submission, seat or official result. Old phones have
-- no delivery receipt and are shown as unverified until they acknowledge.
insert into private.counter_runs(match_id, round_no, status, started_at, closed_at)
select match_id, round_no, case when status = 'running' then 'running' else 'closed' end,
  clock_timestamp(), case when status <> 'running' then clock_timestamp() end
from public.lyst_rounds;
insert into private.counter_action_runs(id,run_id)
select c.id,r.id from public.lyst_counts c join private.counter_runs r on r.match_id=c.match_id and r.round_no=c.round_no;

create function private.counter_weights_for(p_seat uuid,p_match uuid,p_round integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(c.weight order by c.created_at,c.id),'[]'::jsonb) from public.lyst_counts c
  where c.seat_id=p_seat and c.match_id=p_match and c.round_no=p_round and c.undo_of is null
  and not exists(select 1 from public.lyst_counts u where u.undo_of=c.id)
$$;

create function private.counter_prepare_run(p_match uuid, p_round integer) returns private.counter_runs
language plpgsql volatile security definer set search_path = '' as $$
declare r private.counter_runs;
begin
  select * into r from private.counter_runs where match_id = p_match and round_no = p_round order by generation desc limit 1;
  if found then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-run:' || p_match::text, 0));
  select * into r from private.counter_runs where match_id = p_match and round_no = p_round order by generation desc limit 1;
  if not found then
    insert into private.counter_runs(match_id, round_no, status) values (p_match, p_round, 'prepared') returning * into r;
  end if;
  return r;
end $$;

create function private.counter_round_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r private.counter_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-run:' || new.match_id::text, 0));
  if tg_op = 'INSERT' then
    r := private.counter_prepare_run(new.match_id, new.round_no);
    update private.counter_runs set status = case when new.status = 'running' then 'running' else 'closed' end,
      started_at = clock_timestamp(), closed_at = case when new.status <> 'running' then clock_timestamp() end where id = r.id;
  elsif new.status = 'running' and old.status <> 'running' then
    select * into r from private.counter_runs where match_id = new.match_id and round_no = new.round_no order by generation desc limit 1;
    update private.counter_runs set status = 'closed', closed_at = coalesce(closed_at, clock_timestamp()) where id = r.id;
    insert into private.counter_runs(match_id, round_no, generation, status, started_at)
      values (new.match_id, new.round_no, coalesce(r.generation, 0) + 1, 'running', clock_timestamp());
  elsif new.status <> 'running' then
    update private.counter_runs set status = 'closed', closed_at = coalesce(closed_at, clock_timestamp())
      where match_id = new.match_id and round_no = new.round_no and status <> 'closed';
  end if;
  return null;
end $$;
create trigger counter_round_changed after insert or update of status on public.lyst_rounds
for each row execute function private.counter_round_changed();

-- Extend the existing state without replacing hosted customizations. Preview
-- is read-only; a real phone prepares the next round while it has a connection.
create function private.counter_run_state(p_sub uuid, p_touch boolean, p_state jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.lyst_counter_seats; r private.counter_runs; n integer; rs text;
begin
  select * into s from public.lyst_counter_seats where id = (p_state->'seat'->>'id')::uuid and user_id = p_sub;
  if not found or s.status <> 'active' or s.match_id is null or s.expires_at < now()
    or coalesce((p_state->>'waiting')::boolean, false) or coalesce((p_state->>'final')::boolean, false)
    or coalesce((p_state->'event'->>'closed')::boolean, false) then return p_state; end if;
  select round_no, status into n, rs from public.lyst_rounds where match_id = s.match_id order by round_no desc limit 1;
  n := case when n is null then 1 when rs = 'confirmed' then n + 1 else n end;
  if n > 20 then return p_state; end if;
  if p_touch then
    r := private.counter_prepare_run(s.match_id, n);
    -- Assignment history is distinct from a delivery receipt. It permits late
    -- evidence even if the phone's acknowledgement was lost before advancing.
    if not exists (select 1 from private.counter_receipts where run_id = r.id and seat_id = s.id) then
      insert into private.counter_receipts(run_id,seat_id) values (r.id,s.id) on conflict do nothing;
    end if;
  else select * into r from private.counter_runs where match_id = s.match_id and round_no = n order by generation desc limit 1; end if;
  return p_state || jsonb_build_object('my_weights',private.counter_weights_for(s.id,s.match_id,(p_state->'round'->>'no')::integer),
    'prepared_run', case when r.id is null then null else
    jsonb_build_object('id', r.id, 'match_id', r.match_id, 'no', r.round_no, 'generation', r.generation, 'status', r.status, 'started_at', r.started_at) end);
end $$;
do $patch$
declare body text; anchor text := E'    ''server_now'', clock_timestamp());\nend';
begin
  body := pg_get_functiondef('private.counter_state_for(uuid,boolean)'::regprocedure);
  if strpos(body, E'  return jsonb_build_object(\n    ''kind'',') = 0 or strpos(body, anchor) = 0 then raise exception 'counter state anchor missing'; end if;
  body := replace(body, E'  return jsonb_build_object(\n    ''kind'',', E'  return private.counter_run_state(p_sub, p_touch, jsonb_build_object(\n    ''kind'',');
  execute replace(body, anchor, E'    ''server_now'', clock_timestamp()));\nend');
end $patch$;

-- Called only AFTER the phone has durably cached the matching state. Online
-- heartbeat and start receipt are intentionally different signals.
create function public.counter_acknowledge_run(p_seat uuid, p_run uuid, p_started boolean, p_pending integer default 0) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.lyst_counter_seats; r private.counter_runs;
begin
  perform private.assert_session_alive();
  select * into s from public.lyst_counter_seats where id = p_seat and user_id = auth.uid() and status = 'active' and expires_at >= now();
  if not found then raise exception 'that is not your active seat' using errcode = '42501'; end if;
  select * into r from private.counter_runs where id = p_run and match_id = s.match_id;
  if not found or r.status = 'closed' or (p_started and r.status <> 'running')
    or private.field_current_match(s.event_id, s.field_key) is distinct from s.match_id then
    raise exception 'ROUND_CHANGED' using errcode = 'P0001'; end if;
  if p_started is null or p_pending is null or p_pending not between 0 and 100000 then raise exception 'invalid counter receipt' using errcode = '22023'; end if;
  insert into private.counter_receipts(run_id, seat_id, prepared_at, seen_at, started_at, pending)
    values (p_run, p_seat, clock_timestamp(), clock_timestamp(), case when p_started then clock_timestamp() end, p_pending)
    on conflict (run_id, seat_id) do update set prepared_at = coalesce(private.counter_receipts.prepared_at, excluded.prepared_at), seen_at = clock_timestamp(), pending = excluded.pending,
      started_at = coalesce(private.counter_receipts.started_at, excluded.started_at);
end $$;

-- Exact run + idempotent ID + retained late evidence. Offline manual starts are
-- ALWAYS provisional review evidence, even if the server is now running. This
-- function never changes any awarded score or official result.
create function private.counter_total_for(p_seat uuid, p_match uuid, p_round integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(c.weight),0)::integer from public.lyst_counts c where c.seat_id=p_seat and c.match_id=p_match
  and c.round_no=p_round and c.undo_of is null and not exists(select 1 from public.lyst_counts u where u.undo_of=c.id)
$$;
create function public.counter_deliver_action(p_seat uuid, p_run uuid, p_action jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.lyst_counter_seats; r private.counter_runs; old public.lyst_counts; held private.counter_recovery;
  v_id uuid; kind text; w integer; reason text; result jsonb;
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into s from public.lyst_counter_seats where id = p_seat and user_id = auth.uid();
  if not found then raise exception 'that is not your counter seat' using errcode = '42501'; end if;
  select * into r from private.counter_runs where id = p_run;
  if not found or private.event_of_match(r.match_id) is distinct from s.event_id
    or (r.match_id is distinct from s.match_id and not exists(select 1 from private.counter_receipts where run_id=p_run and seat_id=p_seat)) then
    raise exception 'that run was not assigned to this phone' using errcode = '42501'; end if;
  if jsonb_typeof(p_action) is distinct from 'object' or octet_length(p_action::text) > 2048 then raise exception 'invalid count action' using errcode = '22023'; end if;
  v_id := (p_action->>'id')::uuid; kind := p_action->>'kind'; w := (p_action->>'weight')::integer;
  if v_id is null or kind is null or kind not in ('tap', 'undo') or (p_action->>'round')::integer is distinct from r.round_no
     or (kind = 'tap' and (w is null or w not between 1 and 2)) then raise exception 'invalid count action' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-action:' || v_id::text, 0));
  select * into old from public.lyst_counts where lyst_counts.id = v_id;
  if found then
    if old.seat_id <> p_seat or old.match_id <> r.match_id or old.round_no <> r.round_no or (old.undo_of is null) <> (kind = 'tap') or (kind = 'tap' and old.weight <> w) then
      raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    if exists(select 1 from private.counter_action_runs where counter_action_runs.id=v_id and run_id<>p_run) then
      raise exception 'count ID belongs to a different run' using errcode='42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.counter_total_for(p_seat, r.match_id, r.round_no), 'weights',private.counter_weights_for(p_seat,r.match_id,r.round_no));
  end if;
  select * into held from private.counter_recovery where counter_recovery.id = v_id;
  if found then
    if held.seat_id <> p_seat or held.run_id <> p_run or held.action <> p_action then raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'review', 'reason', held.reason, 'total', private.counter_total_for(p_seat, r.match_id, r.round_no));
  end if;
  -- Serialize with finalize/return/end using the same established match ->
  -- Lyst lock order. Refused evidence can still be retained after finalization.
  perform 1 from public.matches where matches.id = r.match_id for key share;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst:' || s.event_id::text || ':' || s.field_key, 0));
  perform 1 from public.lyst_rounds where match_id = r.match_id and round_no = r.round_no for share;
  select * into r from private.counter_runs where counter_runs.id = p_run;
  if coalesce((p_action->>'recovery')::boolean, false) then reason := 'The counter started locally after the marshal call; timing needs review.';
  elsif r.status <> 'running' then reason := 'The saved run was not running when these counts arrived.';
  elsif s.status <> 'active' or s.expires_at < now() or s.match_id is distinct from r.match_id or private.field_current_match(s.event_id, s.field_key) is distinct from r.match_id then reason := 'The phone is no longer assigned to this fight.';
  elsif exists (select 1 from public.matches where matches.id = s.match_id and queue_state = 'final') then reason := 'The fight is already official.';
  end if;
  if reason is null then
    -- Catch sporting refusals as retained evidence; never swallow permissions
    -- or unexpected database failures. The caller keeps its local copy then.
    begin
      if kind = 'tap' then result := public.counter_record(v_id, p_seat, r.round_no, w);
      else result := public.counter_undo(v_id, p_seat, r.round_no); end if;
      select * into old from public.lyst_counts where lyst_counts.id=v_id;
      if found then
        if old.seat_id<>p_seat or old.match_id<>r.match_id or old.round_no<>r.round_no then raise exception 'count ID belongs to other evidence' using errcode='42501'; end if;
        insert into private.counter_action_runs(id,run_id) values(v_id,p_run) on conflict do nothing;
      end if;
      return result || jsonb_build_object('weights',private.counter_weights_for(p_seat,r.match_id,r.round_no));
    exception when sqlstate 'P0001' then reason := sqlerrm;
    end;
  end if;
  insert into private.counter_recovery(id, run_id, seat_id, action, reason) values (v_id, p_run, p_seat, p_action, reason);
  perform private.audit(s.event_id, 'counter.evidence_retained', r.match_id::text, jsonb_build_object('action', v_id, 'run', p_run, 'seat', p_seat, 'reason', reason));
  return jsonb_build_object('status', 'review', 'reason', reason, 'total', private.counter_total_for(p_seat, r.match_id, r.round_no));
end $$;

create function private.counter_delivery_state(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
    'run_id', r.id, 'round', r.round_no, 'run_status', r.status,
    'prepared_at', ack.prepared_at, 'started_at', ack.started_at, 'seen_at', ack.seen_at, 'pending', ack.pending,
    'submitted', exists (select 1 from public.lyst_counter_rounds c where c.seat_id = s.id and c.round_no = r.round_no and c.match_id = p_match)) order by s.role, s.side, s.display_name), '[]'::jsonb)
  from public.lyst_counter_seats s
  left join lateral (select cr.* from private.counter_runs cr where cr.match_id = p_match order by cr.round_no desc, cr.generation desc limit 1) r on true
  left join private.counter_receipts ack on ack.run_id = r.id and ack.seat_id = s.id
  where s.match_id = p_match and s.status = 'active'
$$;
create function private.counter_recovery_state(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'seat_id', e.seat_id, 'operator', s.display_name, 'side', s.side, 'role', s.role,
    'run_id', r.id, 'round', r.round_no, 'generation', r.generation, 'action', e.action, 'reason', e.reason,
    'received_at', e.received_at, 'decision', e.decision, 'review_reason', e.review_reason) order by e.received_at), '[]'::jsonb)
  from private.counter_recovery e join private.counter_runs r on r.id = e.run_id join public.lyst_counter_seats s on s.id = e.seat_id
  where r.match_id = p_match
$$;
do $patch$
declare body text; anchor text := E'    ''server_now'', clock_timestamp(),';
begin
  body := pg_get_functiondef('public.lyst_state(uuid)'::regprocedure);
  if strpos(body, anchor) = 0 then raise exception 'Lyst delivery state anchor missing'; end if;
  execute replace(body, anchor, anchor || E'\n    ''counter_delivery'', private.counter_delivery_state(p_match),\n    ''counter_recovery'', private.counter_recovery_state(p_match),');
end $patch$;

-- A late new tap invalidates "done". The marshal must never see a done mark
-- from before evidence changed. Existing snapshots and revisions remain intact.
create function private.counter_clear_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.lyst_counter_rounds where seat_id = new.seat_id and match_id = new.match_id and round_no = new.round_no;
  return null;
end $$;
create trigger counter_clear_done after insert on public.lyst_counts for each row execute function private.counter_clear_done();

-- Review records a human decision only. Awarded numbers still use the existing
-- marshal confirmation/correction flow and its authorization and audit trail.
create function public.review_counter_recovery(p_id uuid, p_decision text, p_reason text) returns void
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
  if e.decision is not null then raise exception 'this evidence was already reviewed' using errcode = 'P0001'; end if;
  update private.counter_recovery set decision = p_decision, review_reason = btrim(p_reason), reviewed_at = clock_timestamp(), reviewed_by = auth.uid() where id = p_id;
  perform private.audit(ev, 'counter.evidence_reviewed', m::text, jsonb_build_object('evidence', p_id, 'decision', p_decision, 'reason', btrim(p_reason)));
end $$;

create function public.review_counter_recovery_batch(p_ids uuid[], p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(cardinality(p_ids),0) not between 1 and 1000 then raise exception 'review 1 to 1000 actions at a time' using errcode='22023'; end if;
  for v_id in select distinct unnest(p_ids) order by 1 loop
    perform public.review_counter_recovery(v_id,p_decision,p_reason);
  end loop;
end $$;
revoke execute on function public.review_counter_recovery_batch(uuid[],text,text) from public,anon;
grant execute on function public.review_counter_recovery_batch(uuid[],text,text) to authenticated;

revoke execute on function private.counter_prepare_run(uuid, integer), private.counter_round_changed(), private.counter_run_state(uuid, boolean, jsonb),
  private.counter_delivery_state(uuid), private.counter_recovery_state(uuid), private.counter_total_for(uuid,uuid,integer), private.counter_weights_for(uuid,uuid,integer), private.counter_clear_done() from public, anon, authenticated;
revoke execute on function public.counter_acknowledge_run(uuid, uuid, boolean, integer), public.counter_deliver_action(uuid, uuid, jsonb), public.review_counter_recovery(uuid, text, text) from public, anon;
grant execute on function public.counter_acknowledge_run(uuid, uuid, boolean, integer), public.counter_deliver_action(uuid, uuid, jsonb), public.review_counter_recovery(uuid, text, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.counter_acknowledge_run(uuid, uuid, boolean, integer), public.counter_deliver_action(uuid, uuid, jsonb), public.review_counter_recovery(uuid, text, text) to bos_event_device;
    grant execute on function public.review_counter_recovery_batch(uuid[],text,text) to bos_event_device;
  end if;
end $$;
notify pgrst, 'reload schema';
