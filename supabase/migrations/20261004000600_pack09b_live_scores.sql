-- Pack 09B (2026-10-04): the running score of a fight, for the venue display.
-- The device scoring a fight already knows the score; spectators could only see the official result at the end. This adds ONE ephemeral
-- table: the latest score snapshot a scorer reported for a match that is still being fought. It is display state, never a result:
--   * it is written only through public.report_live_score (scorers of the event), never by direct table writes;
--   * it is readable by everyone who may read the match (published events), through the same rule as public.matches;
--   * it disappears the moment the match becomes final (or leaves the live queue), so a result and a live score never coexist;
--   * it never touches matches.version, results, or the finalization command (Pack 03), which stay exactly as they are.
-- Additive: one table, one function, one trigger, one publication membership. Safe to run twice.

create table if not exists public.match_live_scores (
  match_id uuid primary key references public.matches(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  score_a integer not null default 0 check (score_a >= 0),
  score_b integer not null default 0 check (score_b >= 0),
  -- A short line for the display: "Round 2 of 2", "Extra round", "Round 3 · Polearm". Never a rule, only what the board shows.
  phase text not null default '' check (char_length(phase) <= 80),
  -- Mode-specific summary the display may use (rounds won, per-round points). Small by construction.
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 4096),
  -- Ordering within one device: an older snapshot never overwrites a newer one. Another device taking over simply replaces it.
  seq bigint not null default 0,
  -- An opaque per-tab id, never an account: this table is PUBLIC for published events, so it carries no auth user id at all.
  device text not null default '' check (char_length(device) <= 64),
  updated_at timestamptz not null default now()
);
comment on table public.match_live_scores is 'Pack 09B: the latest running score a scorer reported for a fight still in progress. Display state for the venue screen; never an official result. Deleted when the match becomes final.';
create index if not exists match_live_scores_competition_idx on public.match_live_scores (competition_id);
alter table public.match_live_scores enable row level security;

-- Everyone who may read the match may read its live score (published events; staff of any event they can score).
drop policy if exists match_live_scores_read on public.match_live_scores;
create policy match_live_scores_read on public.match_live_scores for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id)));
grant select on public.match_live_scores to anon, authenticated;
-- No insert / update / delete grants: the function below is the only way in.

-- ---------------------------------------------------------------- report a snapshot
-- SECURITY DEFINER because scorers have no write grant on the table (and must not: a direct write could set anything). The checks are the same
-- as record_score_event: signed in, allowed to score this event, match not final. A stale device (the match changed since it opened it) is told
-- 'stale' and nothing is written; an older snapshot from the same device is ignored ('older'). Nothing here is ever a result.
create or replace function public.report_live_score(
  p_match uuid, p_device text, p_seq bigint, p_score_a integer, p_score_b integer, p_phase text default '', p_detail jsonb default '{}'::jsonb, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_old public.match_live_scores;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_m from public.matches where id = p_match;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;
  if v_m.queue_state = 'final' then return jsonb_build_object('status', 'final'); end if;
  if p_expected_version is not null and v_m.version <> p_expected_version then return jsonb_build_object('status', 'stale'); end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'scores must be zero or more' using errcode = '22023'; end if;

  select * into v_old from public.match_live_scores where match_id = p_match for update;
  if found and v_old.device = coalesce(p_device, '') and v_old.seq >= coalesce(p_seq, 0) then return jsonb_build_object('status', 'older'); end if;

  insert into public.match_live_scores (match_id, competition_id, score_a, score_b, phase, detail, seq, device, updated_at)
  values (p_match, v_m.competition_id, p_score_a, p_score_b, left(coalesce(p_phase, ''), 80), coalesce(p_detail, '{}'::jsonb), coalesce(p_seq, 0), left(coalesce(p_device, ''), 64), now())
  on conflict (match_id) do update set
    score_a = excluded.score_a, score_b = excluded.score_b, phase = excluded.phase, detail = excluded.detail, seq = excluded.seq, device = excluded.device, updated_at = now();
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.report_live_score(uuid, text, bigint, integer, integer, text, jsonb, integer) from public, anon;
grant execute on function public.report_live_score(uuid, text, bigint, integer, integer, text, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------- a result and a live score never coexist
-- When a match becomes final, or leaves the live queue (sent back to the line, reopened), its live score is dropped. SECURITY DEFINER so the
-- delete works whichever path changed the match (every queue_state change already goes through a definer function); not callable by users.
create or replace function private.clear_live_score() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.queue_state = 'final' or (old.queue_state = 'active' and new.queue_state <> 'active') then
    delete from public.match_live_scores where match_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function private.clear_live_score() from public, anon, authenticated;

do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_clear_live_score' and tgrelid = 'public.matches'::regclass) then
    create trigger matches_clear_live_score after update of queue_state on public.matches
      for each row when (old.queue_state is distinct from new.queue_state) execute function private.clear_live_score();
  end if;
end $do$;

-- ---------------------------------------------------------------- realtime
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_live_scores') then
    alter publication supabase_realtime add table public.match_live_scores;
  end if;
end $do$;
