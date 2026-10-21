-- A timer intent survives more than just the field's last_command slot. A
-- lost acknowledgement followed by another action cannot restart a clock.
create table private.lyst_timer_intents (
  id uuid primary key,
  actor uuid not null,
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  payload jsonb not null,
  outcome text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.lyst_timer_intents enable row level security;
revoke all on private.lyst_timer_intents from public,anon,authenticated;

create function public.lyst_timer_command_reliable(
  p_event uuid, p_field text, p_match uuid, p_expected_rev integer, p_command uuid, p_action text,
  p_mode text default null, p_duration_ms integer default null, p_round integer default null, p_delta_ms integer default 0,
  p_override_reason text default null, p_requested_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare old private.lyst_timer_intents; payload jsonb; answer jsonb; t public.lyst_timer;
  n integer; mode text; r private.counter_runs; missing integer; reason text := nullif(btrim(coalesce(p_override_reason,'')),'');
begin
  perform private.assert_session_alive();
  if auth.uid() is null or not private.can_score(p_event) or private.event_of_match(p_match) is distinct from p_event then
    raise exception 'you cannot run this fight' using errcode='42501'; end if;
  if p_command is null then raise exception 'a command ID is required' using errcode='22023'; end if;
  payload := jsonb_build_object('event',p_event,'field',private.field_key(p_field),'match',p_match,'expected',p_expected_rev,
    'action',p_action,'mode',p_mode,'duration',p_duration_ms,'round',p_round,'delta',p_delta_ms,'override',reason,'requested_at',p_requested_at);
  perform pg_advisory_xact_lock(hashtextextended('bos:timer-intent:' || p_command::text,0));
  select * into old from private.lyst_timer_intents where id=p_command;
  if found then
    if old.actor<>auth.uid() or old.payload<>payload then raise exception 'that command ID belongs to another intent' using errcode='42501'; end if;
    select * into t from public.lyst_timer where event_id=p_event and field_key=private.field_key(p_field);
    return jsonb_build_object('status',case when old.outcome='ok' then 'duplicate' else old.outcome end,
      'timer',case when t.event_id is null then null else private.lyst_timer_json(t) end,'server_now',clock_timestamp());
  end if;
  if not private.can_score_match(p_match) then raise exception 'you cannot change this fight''s clock' using errcode='42501'; end if;
  perform private.lyst_match_check(p_event,p_match,p_field);
  perform private.lyst_lock_live_match(p_match);
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst:' || p_event::text || ':' || private.field_key(p_field),0));
  -- Check age AFTER waiting for the clock lock; a queued request must not
  -- become a fresh start merely because it was fresh before the wait.
  if p_requested_at is null or p_requested_at>clock_timestamp()+interval '5 seconds' then raise exception 'a valid server-adjusted press time is required' using errcode='22023'; end if;
  if p_requested_at<clock_timestamp()-interval '15 seconds' then
    select * into t from public.lyst_timer where event_id=p_event and field_key=private.field_key(p_field);
    insert into private.lyst_timer_intents(id,actor,event_id,match_id,payload,outcome) values(p_command,auth.uid(),p_event,p_match,payload,'expired');
    return jsonb_build_object('status','expired','timer',case when t.event_id is null then null else private.lyst_timer_json(t) end,'server_now',clock_timestamp());
  end if;
  -- The existing function checks the match again under its established locks.
  perform private.lyst_match_check(p_event,p_match,p_field);
  select * into t from public.lyst_timer where event_id=p_event and field_key=private.field_key(p_field);
  mode := coalesce(p_mode,t.mode,'fight'); n := coalesce(p_round,t.round_no,1);
  if p_action='start' and mode='fight' then
    -- Read only here: taking the run lock before the existing match/round
    -- locks would invert the order used by confirmation and round return.
    select * into r from private.counter_runs where match_id=p_match and round_no=n order by generation desc limit 1;
    select count(*) into missing from public.lyst_counter_seats s
    left join private.counter_receipts c on c.seat_id=s.id and c.run_id=r.id
    where s.match_id=p_match and s.status='active' and s.role='official' and (c.prepared_at is null or s.expires_at<now());
    if missing>0 and coalesce(char_length(reason),0)<3 then
      raise exception 'COUNTERS_NOT_PREPARED: % counter phones have not saved this round. Check them or record why the marshal is starting with paper/offline counting.',missing using errcode='P0001'; end if;
    if char_length(reason)>1000 then raise exception 'keep the reason to 1000 characters' using errcode='22023'; end if;
  end if;
  -- Some hosted installations already accept a press timestamp. Preserve that
  -- implementation (including pause timing) instead of replacing its overload.
  if to_regprocedure('public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,timestamptz)') is not null then
    execute 'select public.lyst_timer_command($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)' into answer
      using p_event,p_field,p_match,p_expected_rev,p_command,p_action,p_mode,p_duration_ms,p_round,p_delta_ms,p_requested_at;
  else
    answer := public.lyst_timer_command(p_event,p_field,p_match,p_expected_rev,p_command,p_action,p_mode,p_duration_ms,p_round,p_delta_ms);
  end if;
  if answer->>'status'='ok' and p_action in ('start','resume') then
    -- Correct bounded transport lag using the already measured server clock.
    -- A retry returns the ledger answer above and never backdates again.
    update public.lyst_timer set started_at=least(clock_timestamp(),greatest(p_requested_at,t.updated_at))
      where event_id=p_event and field_key=private.field_key(p_field) and last_command=p_command and status='running'
      returning * into t;
    if found then
      if t.started_at is distinct from (answer->'timer'->>'started_at')::timestamptz then
        perform private.audit(p_event,'lyst.timer_transport_compensation',p_match::text,
          jsonb_build_object('command',p_command,'requested_at',p_requested_at,'previous_applied_at',answer->'timer'->>'started_at','applied_at',t.started_at));
      end if;
      answer := answer || jsonb_build_object('timer',private.lyst_timer_json(t),'server_now',clock_timestamp(),'applied_at',t.started_at);
    end if;
  end if;
  insert into private.lyst_timer_intents(id,actor,event_id,match_id,payload,outcome)
    values(p_command,auth.uid(),p_event,p_match,payload,answer->>'status');
  if (coalesce(missing,0)>0 or reason is not null) and answer->>'status'='ok' then
    perform private.audit(p_event,'counter.start_override',p_match::text,jsonb_build_object('command',p_command,'round',n,'missing',missing,'reason',reason));
  end if;
  return answer;
end $$;

create function private.counter_confirmation_risks(p_match uuid,p_round integer) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.lyst_counter_seats s
    left join lateral (select r.id from private.counter_runs r where r.match_id=p_match and r.round_no=p_round order by r.generation desc limit 1) run on true
    left join private.counter_receipts c on c.run_id=run.id and c.seat_id=s.id
    where s.match_id=p_match and s.status='active' and s.role='official'
    and (c.started_at is null or c.pending>0 or c.seen_at is null or c.seen_at<clock_timestamp()-interval '20 seconds'
      or not exists(select 1 from public.lyst_counter_rounds done where done.seat_id=s.id and done.match_id=p_match and done.round_no=p_round))
  ) or exists(select 1 from private.counter_recovery e join private.counter_runs r on r.id=e.run_id
    join public.lyst_counter_seats s on s.id=e.seat_id
    where r.match_id=p_match and r.round_no=p_round and s.role='official' and e.decision is null)
$$;

do $patch$
declare body text; anchor text := '  v_kind := case when v_have and v_r.status = ''confirmed'' then ''correct'' else ''confirm'' end;';
begin
  body := pg_get_functiondef('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure);
  if strpos(body,anchor)=0 then raise exception 'confirmation safety anchor missing'; end if;
  execute replace(body,anchor,anchor || $guard$
  if private.counter_confirmation_risks(p_match,p_round) and char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'Some counters have not confirmed delivery, have pending counts, or have evidence to review. Check the phones and record the marshal''s reason for the awarded score.' using errcode='22023';
  end if;
$guard$);
end $patch$;

revoke execute on function private.counter_confirmation_risks(uuid,integer) from public,anon,authenticated;
revoke execute on function public.lyst_timer_command_reliable(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,text,timestamptz) from public,anon;
grant execute on function public.lyst_timer_command_reliable(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,text,timestamptz) to authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='bos_event_device') then
  grant execute on function public.lyst_timer_command_reliable(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,text,timestamptz) to bos_event_device;
end if; end $$;
notify pgrst,'reload schema';
