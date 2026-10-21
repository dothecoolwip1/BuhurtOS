-- Rehearsal R1: both finalization entry points share the same official boundary.
-- Patch the existing body so hosted guards and grants remain in place.
do $patch$
declare body text; anchor text := '  v_block := private.competition_blockers(p_competition);';
begin
  body := pg_get_functiondef('public.finish_competition(uuid,text)'::regprocedure);
  if strpos(body, anchor) = 0 then raise exception 'finish_competition guard anchor missing'; end if;
  body := replace(body, anchor, $guard$
  if private.event_closed(v_k.event_id) then
    raise exception 'this event is closed; reopen the event first' using errcode = 'P0001';
  end if;
  if v_k.status = 'finished' then
    -- finalize_competition already answers retries with already_official.
    -- Legacy callers must explicitly reopen before recomputing anything.
    raise exception 'this competition is already official; reopen it with a reason before changing its results' using errcode = 'P0001';
  end if;
$guard$ || anchor);
  execute body;
end $patch$;

-- R3: absence of evidence is unknown. A recorded block still takes precedence
-- over missing members of a team. No private reason is exposed to the announcer.
create or replace function public.announcer_readiness(p_event uuid)
returns table (match_id uuid, side text, ready boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'announcer']) then
    raise exception 'only this event''s staff can see readiness' using errcode = '42501'; end if;
  return query
  with rr as (select * from private.readiness_rows(p_event, false)),
  live as (
    select m.id, m.entry_a, m.entry_b
    from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and m.queue_state <> 'final' and m.result is null and m.entry_a is not null and m.entry_b is not null
    order by case m.queue_state when 'active' then 0 when 'on_deck' then 1 when 'in_the_hole' then 2 else 3 end, m.queue_order nulls last, m.scheduled_at nulls last, m.id
    limit 40),
  sides as (select l.id mid, 'a'::text sd, l.entry_a entry from live l union all select l.id, 'b', l.entry_b from live l),
  people as (
    select s.mid, s.sd, en.fighter_id from sides s join public.entries en on en.id = s.entry where en.fighter_id is not null
    union
    select s.mid, s.sd, ef.fighter_id from sides s join public.entry_fighters ef on ef.entry_id = s.entry)
  select s.mid, s.sd,
    case when bool_or(x.ready is false) then false
         when count(p.fighter_id) = 0 or bool_or(x.ready is null) then null
         else true end
  from sides s
  left join people p on p.mid = s.mid and p.sd = s.sd
  left join lateral (select r.ready from rr r where r.fighter_id = p.fighter_id and r.status = 'accepted' limit 1) x on true
  group by s.mid, s.sd;
end $$;

-- R2: create all proposed draws and assign their Lysts in ONE transaction.
-- An invalid assignment or failed write rolls the entire plan back. Existing
-- draws are deliberately refused by build_schedule, never silently replaced.
create table private.tournament_build_plans (
  event_id uuid not null references public.events(id) on delete cascade,
  payload_hash text not null,
  summary jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(event_id,payload_hash)
);
alter table private.tournament_build_plans enable row level security;
revoke all on private.tournament_build_plans from public,anon,authenticated;
create function public.build_tournament_plan(p_event uuid, p_fields integer, p_plans jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p jsonb; k uuid; chosen text; n integer; fights integer := 0; built integer := 0; fingerprint text; summary jsonb;
begin
  perform private.assert_session_alive();
  if auth.uid() is null or not private.is_organizer(p_event) then
    raise exception 'only this event''s organizer can build its tournament' using errcode = '42501'; end if;
  if private.event_closed(p_event) then raise exception 'reopen this event first' using errcode = 'P0001'; end if;
  if p_fields is null or p_fields not between 1 and 12 or jsonb_typeof(p_plans) is distinct from 'array'
     or jsonb_array_length(p_plans) not between 1 and 100 then
    raise exception 'choose 1 to 12 Lysts and a tournament plan' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:build-event:' || p_event::text, 0));
  fingerprint := md5(jsonb_build_object('fields',p_fields,'plans',p_plans)::text);
  select b.summary into summary from private.tournament_build_plans b where event_id=p_event and payload_hash=fingerprint;
  if found then return summary || jsonb_build_object('status','duplicate'); end if;
  if (select count(distinct v->>'competition') from jsonb_array_elements(p_plans) v) <> jsonb_array_length(p_plans) then
    raise exception 'list each competition once' using errcode='22023'; end if;
  if p_fields < (select field_count from public.events where id=p_event) and (
    exists(select 1 from public.matches m join public.competitions c on c.id=m.competition_id where c.event_id=p_event and m.queue_state<>'final'
      and not exists(select 1 from generate_series(1,p_fields) i where private.field_key(m.field) = 'field ' || i))
    or exists(select 1 from public.counter_bindings b where b.event_id=p_event and b.field_key is not null
      and not exists(select 1 from generate_series(1,p_fields) i where b.field_key='field ' || i))
  ) then raise exception 'a Lyst you are removing still has fights or counter phones; move them first' using errcode='22023'; end if;
  -- Stable lock order for two organizers submitting overlapping plans.
  perform 1 from public.competitions c where c.event_id = p_event
    and c.id in (select (v->>'competition')::uuid from jsonb_array_elements(p_plans) v)
    order by c.id for update;
  update public.events set field_count = p_fields where id = p_event;
  for p in select value from jsonb_array_elements(p_plans) order by value->>'competition' loop
    k := (p->>'competition')::uuid; chosen := p->>'field';
    if not exists (select 1 from public.competitions where id = k and event_id = p_event) then
      raise exception 'competition is not in this event' using errcode = '42501'; end if;
    if chosen is null or not exists (select 1 from generate_series(1, p_fields) i where chosen = 'Field ' || i) then
      raise exception 'choose a Lyst in this event' using errcode = '22023'; end if;
    n := public.build_schedule(k, p->'matches', 'new', p->'draw', null);
    update public.matches set field = chosen where competition_id = k and queue_state <> 'final';
    built := built + 1; fights := fights + n;
  end loop;
  perform private.audit(p_event, 'tournament.built', p_event::text, jsonb_build_object('competitions', built, 'fights', fights, 'fields', p_fields));
  summary := jsonb_build_object('built', built, 'fights', fights);
  insert into private.tournament_build_plans(event_id,payload_hash,summary) values(p_event,fingerprint,summary);
  return summary || jsonb_build_object('status','built');
end $$;
revoke execute on function public.build_tournament_plan(uuid, integer, jsonb) from public, anon;
grant execute on function public.build_tournament_plan(uuid, integer, jsonb) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.build_tournament_plan(uuid, integer, jsonb) to bos_event_device;
  end if;
end $$;

-- No sporting records need rewriting: these guards immediately protect all
-- existing competitions and the readiness read includes already queued fights.
notify pgrst, 'reload schema';
