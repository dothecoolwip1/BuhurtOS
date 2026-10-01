-- Matches, score events (the offline outbox target), finalising with winner advancement, standings.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  stage text not null default 'pool' check (stage in ('pool', 'round_robin', 'elimination', 'third_place', 'final')),
  round_label text not null default '',
  position int not null default 0,
  pool text,
  field text,
  scheduled_at timestamptz,
  queue_state text not null default 'scheduled' check (queue_state in ('scheduled', 'on_deck', 'in_the_hole', 'active', 'final')),
  entry_a uuid references public.entries (id) on delete set null,
  entry_b uuid references public.entries (id) on delete set null,
  next_match_id uuid references public.matches (id) on delete set null,
  next_slot text check (next_slot in ('a', 'b')),
  result text check (result in ('a', 'b', 'draw')),
  winner_entry_id uuid references public.entries (id) on delete set null,
  score_a int check (score_a >= 0),
  score_b int check (score_b >= 0),
  -- Per-round or per-method detail: rounds won, duel round points, profight method and totals, Marathon round winners.
  detail jsonb not null default '{}'::jsonb,
  -- Optimistic concurrency: a result is only accepted against the version the scorekeeper saw.
  version int not null default 0,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  check (entry_a is null or entry_b is null or entry_a <> entry_b),
  check ((next_match_id is null) = (next_slot is null))
);
alter table public.matches enable row level security;
create index matches_competition_idx on public.matches (competition_id, stage, position);
create index matches_queue_idx on public.matches (field, queue_state);

create or replace function private.event_of_match(p_match uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.event_id from public.matches m join public.competitions c on c.id = m.competition_id where m.id = p_match
$$;
revoke execute on function private.event_of_match(uuid) from public;
grant execute on function private.event_of_match(uuid) to anon, authenticated;

create or replace function private.check_match_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.entry_a is not null and not exists (select 1 from public.entries where id = new.entry_a and competition_id = new.competition_id) then raise exception 'entry A is not in this competition' using errcode = '23514'; end if;
  if new.entry_b is not null and not exists (select 1 from public.entries where id = new.entry_b and competition_id = new.competition_id) then raise exception 'entry B is not in this competition' using errcode = '23514'; end if;
  if new.next_match_id is not null and not exists (select 1 from public.matches where id = new.next_match_id and competition_id = new.competition_id) then raise exception 'next match is not in this competition' using errcode = '23514'; end if;
  return new;
end $$;
create trigger matches_links before insert or update on public.matches for each row execute function private.check_match_links();

-- Everyone can read matches of a published event. Organizers build the structure; results only come through finalize_match.
create policy matches_read on public.matches for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id)));
create policy matches_organizer_insert on public.matches for insert to authenticated
  with check (private.is_organizer(private.event_of_competition(competition_id)) and queue_state = 'scheduled' and result is null);
create policy matches_organizer_update on public.matches for update to authenticated
  using (private.is_organizer(private.event_of_competition(competition_id)) and queue_state <> 'final')
  with check (private.is_organizer(private.event_of_competition(competition_id)) and queue_state <> 'final');
create policy matches_organizer_delete on public.matches for delete to authenticated
  using (private.is_organizer(private.event_of_competition(competition_id)) and queue_state <> 'final');
grant select on public.matches to anon, authenticated;
grant insert (id, competition_id, stage, round_label, position, pool, field, scheduled_at, entry_a, entry_b, next_match_id, next_slot) on public.matches to authenticated;
grant update (stage, round_label, position, pool, field, scheduled_at, entry_a, entry_b, next_match_id, next_slot) on public.matches to authenticated;
grant delete on public.matches to authenticated;

-- Raw scoring actions. The client generates the id, so a retry after a dropped connection can never double-count.
create table public.score_events (
  id uuid primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  payload jsonb not null default '{}'::jsonb,
  recorded_by uuid not null,
  client_at timestamptz,
  received_at timestamptz not null default now()
);
alter table public.score_events enable row level security;
create index score_events_match_idx on public.score_events (match_id, received_at);
create policy score_events_read on public.score_events for select to authenticated
  using (private.can_score(private.event_of_match(match_id)));
grant select on public.score_events to authenticated;

create or replace function public.record_score_event(p_id uuid, p_match uuid, p_kind text, p_payload jsonb default '{}'::jsonb, p_client_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_state text; n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;
  select queue_state into v_state from public.matches where id = p_match;
  if v_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  insert into public.score_events (id, match_id, kind, payload, recorded_by, client_at) values (p_id, p_match, p_kind, coalesce(p_payload, '{}'::jsonb), auth.uid(), p_client_at) on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.set_match_queue(p_match uuid, p_state text, p_field text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if p_state not in ('scheduled', 'on_deck', 'in_the_hole', 'active') then raise exception 'use finalize_match to finish a match' using errcode = '22023'; end if;
  update public.matches set queue_state = p_state, field = coalesce(p_field, field) where id = p_match and queue_state <> 'final';
  if not found then raise exception 'this match is already final' using errcode = 'P0001'; end if;
end $$;

-- Finish a match: validate, store the result, move the winner into the next match, all in one step.
create or replace function public.finalize_match(p_match uuid, p_result text, p_score_a int, p_score_b int, p_detail jsonb, p_expected_version int)
returns int language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_winner uuid; v_next public.matches;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  if v_m.version <> p_expected_version then raise exception 'this match changed since you opened it, reload and check it' using errcode = 'P0001'; end if;
  if v_m.entry_a is null or v_m.entry_b is null then raise exception 'both sides must be set before a result can be saved' using errcode = '22023'; end if;
  if p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_result = 'draw' and v_m.stage not in ('pool', 'round_robin') then raise exception 'elimination matches cannot end in a draw' using errcode = '22023'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'scores must be zero or more' using errcode = '22023'; end if;
  if p_result = 'a' and p_score_a < p_score_b then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;
  if p_result = 'b' and p_score_b < p_score_a then raise exception 'the winner cannot have the lower score' using errcode = '22023'; end if;

  v_winner := case p_result when 'a' then v_m.entry_a when 'b' then v_m.entry_b else null end;
  update public.matches set result = p_result, winner_entry_id = v_winner, score_a = p_score_a, score_b = p_score_b, detail = coalesce(p_detail, '{}'::jsonb),
    queue_state = 'final', finalized_at = now(), version = version + 1 where id = p_match;

  if v_winner is not null and v_m.next_match_id is not null then
    select * into v_next from public.matches where id = v_m.next_match_id for update;
    if v_next.queue_state = 'final' then raise exception 'the next match was already played; reopen it first' using errcode = 'P0001'; end if;
    if v_m.next_slot = 'a' then update public.matches set entry_a = v_winner where id = v_next.id; else update public.matches set entry_b = v_winner where id = v_next.id; end if;
  end if;
  perform private.audit(v_event, 'match.finalized', p_match::text, jsonb_build_object('result', p_result, 'a', p_score_a, 'b', p_score_b));
  return v_m.version + 1;
end $$;

-- Organizer corrects a mistake: clears the result and takes the winner back out of the next match (if that is not played yet).
create or replace function public.reopen_match(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_next public.matches;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.is_organizer(v_event) then raise exception 'only an organizer can reopen a result' using errcode = '42501'; end if;
  if v_m.queue_state <> 'final' then return; end if;
  if char_length(coalesce(p_reason, '')) < 3 then raise exception 'say why the result is being reopened' using errcode = '22023'; end if;
  if v_m.next_match_id is not null then
    select * into v_next from public.matches where id = v_m.next_match_id for update;
    if v_next.queue_state = 'final' then raise exception 'the next match was already played; reopen that one first' using errcode = 'P0001'; end if;
    if v_m.next_slot = 'a' and v_next.entry_a = v_m.winner_entry_id then update public.matches set entry_a = null where id = v_next.id; end if;
    if v_m.next_slot = 'b' and v_next.entry_b = v_m.winner_entry_id then update public.matches set entry_b = null where id = v_next.id; end if;
  end if;
  update public.matches set queue_state = 'scheduled', result = null, winner_entry_id = null, score_a = null, score_b = null, finalized_at = null, version = version + 1 where id = p_match;
  perform private.audit(v_event, 'match.reopened', p_match::text, jsonb_build_object('reason', p_reason));
end $$;

revoke execute on function public.record_score_event(uuid, uuid, text, jsonb, timestamptz), public.set_match_queue(uuid, text, text),
  public.finalize_match(uuid, text, int, int, jsonb, int), public.reopen_match(uuid, text) from public, anon;
grant execute on function public.record_score_event(uuid, uuid, text, jsonb, timestamptz), public.set_match_queue(uuid, text, text),
  public.finalize_match(uuid, text, int, int, jsonb, int), public.reopen_match(uuid, text) to authenticated;

-- Pool and round-robin standings from final matches. Tiebreak ordering beyond wins lives in the app's tested rule maths.
create view public.competition_standings with (security_invoker = true) as
select e.competition_id, e.id as entry_id,
  count(m.id) filter (where m.winner_entry_id = e.id) as wins,
  count(m.id) filter (where m.winner_entry_id is not null and m.winner_entry_id <> e.id) as losses,
  count(m.id) filter (where m.result = 'draw') as draws,
  coalesce(sum(case when m.entry_a = e.id then m.score_a else m.score_b end), 0) as score_for,
  coalesce(sum(case when m.entry_a = e.id then m.score_b else m.score_a end), 0) as score_against
from public.entries e
left join public.matches m on m.competition_id = e.competition_id and m.queue_state = 'final' and m.stage in ('pool', 'round_robin') and (m.entry_a = e.id or m.entry_b = e.id)
group by e.competition_id, e.id;
grant select on public.competition_standings to anon, authenticated;

alter publication supabase_realtime add table public.matches, public.entries;
