-- Pack 09C (2026-10-04): competition finalization, official podiums, event closeout and official history. Additive; safe to run twice.
--
-- What already existed (kept as the authority, not replaced):
--   * competitions.status = 'finished' IS the official boundary: results rows exist only after public.finish_competition (organizer only, every
--     match final, medal ties decided), which writes result_revisions and audits 'competition.finished'. Rankings, statistics and history read
--     results, so only official competitions ever count.
--   * private.compute_places derives placements: a bracket proves 1st and 2nd, a third-place match proves 3rd and 4th, without one both semifinal
--     losers share 3rd; round robin / pools use group_ranks with the recorded tie decisions; disqualified entries place last with 0 points;
--     withdrawn entries get no result.
--   * A reopened match (reopen_match, organizer, reason) supersedes the results through result_revisions and sets the competition back to running.
-- What this pack adds:
--   1. Metadata: competitions.finalized_at / reopened_at / multiplier_source; events.closed_at / reopened_at. WHO did it and WHY stay in audit_log
--      (organizer-readable), never on these publicly readable tables.
--   2. Preflight: the server lists exactly what blocks an official result (open fights, bracket not built, final not played, conflicts to review,
--      medal ties, a live score still on the board, a closed event) and what only deserves a warning (fighters with no recorded team, no tier).
--      finish_competition now refuses on any blocker, so the rule holds for every caller.
--   3. finalize_competition: the organizer's atomic, idempotent action (a second tap or a stale screen gets 'already_official', nothing recomputes).
--   4. Locks: once official, matches, entries and the competition's status change only through the audited paths (reopen_match, reopen_competition,
--      set_represented_team, merge_teams, finish). Once an event is closed, nothing operational changes until reopen_event.
--   5. reopen_competition (reason, audited, results superseded through result_revisions, never silently deleted), close_event / reopen_event
--      (preflight, reason, audited), event_close_preflight.
--   6. public.competition_results: the official placements of a competition for the public podium, sporting identities only.
--   7. competitions and events join the realtime publication so open screens learn about OFFICIAL / closed without a refresh.
--   8. Legacy: every already-finished competition gets finalized_at from its own 'competition.finished' audit row (else the time its results were
--      written). Nothing is re-ranked; no result changes.

-- ---------------------------------------------------------------- 1. metadata
alter table public.competitions add column if not exists finalized_at timestamptz;
alter table public.competitions add column if not exists reopened_at timestamptz;
alter table public.competitions add column if not exists multiplier_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'competitions_multiplier_source_check') then
    alter table public.competitions add constraint competitions_multiplier_source_check
      check (multiplier_source is null or multiplier_source in ('tournament_structure', 'league_structure'));
  end if;
end $$;
alter table public.events add column if not exists closed_at timestamptz;
alter table public.events add column if not exists reopened_at timestamptz;
comment on column public.competitions.finalized_at is 'When the placements became official (finish_competition). Null while running or after a reopen.';
comment on column public.competitions.reopened_at is 'When an official result was last reopened for correction. Who and why: audit_log competition.reopened.';
comment on column public.events.closed_at is 'When the organizer closed the event: every competition official, the event is history. Who: audit_log event.closed.';

-- ---------------------------------------------------------------- 2. helpers
-- A loader / migration session (no JWT, not one of the API roles) is not a client: the locks below do not apply to it, exactly as competitions_guard already decides.
create or replace function private.is_client_session() returns boolean
language sql stable set search_path = '' as $$
  select not (auth.uid() is null
    and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated', 'service_role')
    and nullif(current_setting('request.jwt.claims', true), '') is null)
$$;
revoke execute on function private.is_client_session() from public, anon, authenticated;

-- The sanctioned paths set bos.unlock for their own transaction; nothing a client can set reaches here (PostgREST never forwards GUCs).
create or replace function private.unlocked() returns boolean
language sql stable set search_path = '' as $$ select coalesce(current_setting('bos.unlock', true), '') = 'on' $$;
revoke execute on function private.unlocked() from public, anon, authenticated;

create or replace function private.event_closed(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.events e where e.id = p_event and e.closed_at is not null) $$;
revoke execute on function private.event_closed(uuid) from public;
grant execute on function private.event_closed(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- 3. what stands between a competition and an official result
-- Blockers are sporting facts the organizer must settle; each carries a code (for the screen) and plain words. Order: what matters most first.
create or replace function private.competition_blockers(p_comp uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_k public.competitions; out jsonb := '[]'::jsonb; n int; n2 int; v_tie text;
begin
  select * into v_k from public.competitions where id = p_comp;
  if not found then return jsonb_build_array(jsonb_build_object('code', 'not_found', 'text', 'competition not found')); end if;
  if private.event_closed(v_k.event_id) then out := out || jsonb_build_object('code', 'event_closed', 'text', 'The event is closed. Reopen the event before changing a result.'); end if;
  if not exists (select 1 from public.matches where competition_id = p_comp) then
    return out || jsonb_build_object('code', 'no_draw', 'text', 'No draw has been built, so there are no fights to rank.');
  end if;
  select count(*) filter (where queue_state in ('active', 'on_deck', 'in_the_hole')), count(*) filter (where queue_state = 'scheduled') into n, n2
    from public.matches where competition_id = p_comp;
  if n > 0 then out := out || jsonb_build_object('code', 'live_matches', 'count', n, 'text', n || case when n = 1 then ' fight is' else ' fights are' end || ' still on the field (now, on deck or in the hole).'); end if;
  if n2 > 0 then
    if exists (select 1 from public.matches where competition_id = p_comp and queue_state = 'scheduled' and stage = 'third_place') then
      out := out || jsonb_build_object('code', 'open_matches', 'count', n2, 'text', n2 || case when n2 = 1 then ' fight has' else ' fights have' end || ' no result yet, including the third-place match.');
    else
      out := out || jsonb_build_object('code', 'open_matches', 'count', n2, 'text', n2 || case when n2 = 1 then ' fight has' else ' fights have' end || ' no result yet.');
    end if;
  end if;
  if v_k.structure = 'pools_elimination' and not exists (select 1 from public.matches where competition_id = p_comp and stage in ('elimination', 'final', 'third_place')) then
    out := out || jsonb_build_object('code', 'bracket_missing', 'text', 'Pool play is done but the bracket has not been built.');
  elsif v_k.structure in ('pools_elimination', 'elimination') and not exists (select 1 from public.matches where competition_id = p_comp and stage = 'final' and queue_state = 'final') then
    if n = 0 and n2 = 0 then out := out || jsonb_build_object('code', 'final_missing', 'text', 'The bracket has no played final, so there is no champion to record.'); end if;
  end if;
  select count(*) into n from public.result_proposals p join public.matches m on m.id = p.match_id where m.competition_id = p_comp and p.status = 'conflict';
  if n > 0 then out := out || jsonb_build_object('code', 'result_conflicts', 'count', n, 'text', n || case when n = 1 then ' result needs' else ' results need' end || ' review: two devices disagreed.'); end if;
  if v_k.structure = 'round_robin' and n2 = 0 then
    select string_agg(distinct case when part = '' then 'the standings' else 'pool ' || part end, ', ') into v_tie from private.unresolved_ties(p_comp, 3);
    if v_tie is not null then out := out || jsonb_build_object('code', 'medal_tie', 'text', 'A tie for a medal place in ' || v_tie || ' is not decided yet. Record the order first.'); end if;
  end if;
  if exists (select 1 from public.match_live_scores s join public.matches m on m.id = s.match_id where m.competition_id = p_comp) then
    out := out || jsonb_build_object('code', 'live_score', 'text', 'A running score is still on the board for a fight of this competition.');
  end if;
  if v_k.status = 'finished' and exists (select 1 from public.result_revisions where competition_id = p_comp and action = 'corrected')
     and exists (select 1 from public.results where competition_id = p_comp) then
    out := out || jsonb_build_object('code', 'hand_corrected', 'text', 'Placements were corrected by hand; reopen the competition to recompute them, or correct them again.');
  end if;
  return out;
end $$;
revoke execute on function private.competition_blockers(uuid) from public, anon, authenticated;

-- Warnings never stop an official result. A fighter with no recorded team keeps their official placement; the points simply stay unattributed in the team totals.
create or replace function private.competition_warnings(p_comp uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_k public.competitions; out jsonb := '[]'::jsonb; v_list jsonb; n int;
begin
  select * into v_k from public.competitions where id = p_comp;
  if not found then return out; end if;
  select jsonb_agg(jsonb_build_object('entry_id', e.id, 'fighter_id', e.fighter_id, 'name', f.display_name) order by f.display_name), count(*) into v_list, n
    from public.entries e join public.fighters f on f.id = e.fighter_id
   where e.competition_id = p_comp and e.fighter_id is not null and e.status <> 'withdrawn' and e.represented_team_id is null;
  if n > 0 then out := out || jsonb_build_object('code', 'no_represented_team', 'count', n, 'entries', v_list,
    'text', n || case when n = 1 then ' fighter has' else ' fighters have' end || ' no recorded team for this competition. Their placing is official either way; their points count for no team until a team is recorded.'); end if;
  select count(*) into n from public.entries where competition_id = p_comp and status = 'withdrawn';
  if n > 0 then out := out || jsonb_build_object('code', 'withdrawn', 'count', n, 'text', n || ' withdrawn: no placing, no points.'); end if;
  select count(*) into n from public.entries where competition_id = p_comp and status = 'disqualified';
  if n > 0 then out := out || jsonb_build_object('code', 'disqualified', 'count', n, 'text', n || ' disqualified: placed last, 0 points.'); end if;
  if v_k.tier is null then out := out || jsonb_build_object('code', 'no_tier', 'text', 'The competition has no tier, so every placing is worth 0 ranking points.'); end if;
  return out;
end $$;
revoke execute on function private.competition_warnings(uuid) from public, anon, authenticated;

-- The placements as they stand: the official ones when the competition is finished, otherwise what finish_competition would write now.
create or replace function private.competition_placements(p_comp uuid, p_source text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with k as (select * from public.competitions where id = p_comp),
  calc as (
    select c.entry_id, c.final_place, c.pool_wins, c.elim_wins, c.base_points, private.tier_points(c.base_points, (select tier from k), p_source) as points
    from private.compute_places(p_comp) c where (select status from k) <> 'finished'
    union all
    select r.entry_id, r.final_place, null, null, null, coalesce(r.points, 0) from public.results r where r.competition_id = p_comp and (select status from k) = 'finished')
  select coalesce(jsonb_agg(jsonb_build_object(
      'entry_id', c.entry_id, 'place', c.final_place, 'kind', case when e.team_id is not null then 'team' else 'fighter' end,
      'name', case when e.team_id is not null then coalesce(e.team_name_at_event, t.name) else f.display_name end,
      'team_slug', t.slug, 'fighter_id', e.fighter_id, 'status', e.status,
      'represented_team_name', e.represented_team_name_at_event, 'represented_team_slug', rt.slug,
      'pool_wins', c.pool_wins, 'elim_wins', c.elim_wins, 'base_points', c.base_points, 'points', c.points)
    order by c.final_place, case when e.team_id is not null then coalesce(e.team_name_at_event, t.name) else f.display_name end), '[]'::jsonb)
  from calc c join public.entries e on e.id = c.entry_id
  left join public.teams t on t.id = e.team_id left join public.fighters f on f.id = e.fighter_id left join public.teams rt on rt.id = e.represented_team_id
$$;
revoke execute on function private.competition_placements(uuid, text) from public, anon, authenticated;

-- The review screen's one read. Organizers of the event only (the public reads competition_results once it is official).
create or replace function public.competition_finalize_preflight(p_competition uuid, p_multiplier_source text default 'tournament_structure') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_k public.competitions; v_block jsonb; v_total int; v_final int; v_state text; v_mult numeric; v_src text;
begin
  select * into v_k from public.competitions where id = p_competition;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer of this event can review its results' using errcode = '42501'; end if;
  v_src := case when v_k.status = 'finished' then coalesce(v_k.multiplier_source, 'tournament_structure') else coalesce(p_multiplier_source, 'tournament_structure') end;
  if v_src not in ('tournament_structure', 'league_structure') then raise exception 'multiplier source must be tournament_structure or league_structure' using errcode = '22023'; end if;
  select count(*), count(*) filter (where queue_state = 'final') into v_total, v_final from public.matches where competition_id = p_competition;
  v_block := private.competition_blockers(p_competition);
  v_state := case when v_k.status = 'finished' then 'official'
                  when v_total > 0 and v_final < v_total then 'running'
                  when jsonb_array_length(v_block) > 0 then 'blocked' else 'ready' end;
  if v_k.tier is not null then
    select case v_src when 'league_structure' then multiplier_league_structure else multiplier_tournament_structure end into v_mult from public.ref_tiers where name = v_k.tier;
  end if;
  return jsonb_build_object(
    'competition', jsonb_build_object('id', v_k.id, 'name', v_k.name, 'status', v_k.status, 'structure', v_k.structure, 'tier', v_k.tier, 'category', v_k.category, 'gender', v_k.gender,
                                      'finalized_at', v_k.finalized_at, 'reopened_at', v_k.reopened_at, 'multiplier_source', v_k.multiplier_source),
    'event_closed', private.event_closed(v_k.event_id),
    'state', v_state, 'matches', jsonb_build_object('total', v_total, 'final', v_final),
    'blockers', v_block, 'warnings', private.competition_warnings(p_competition),
    'source', v_src, 'multiplier', v_mult,
    'placements', private.competition_placements(p_competition, v_src));
end $$;
revoke execute on function public.competition_finalize_preflight(uuid, text) from public, anon;
grant execute on function public.competition_finalize_preflight(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 4. finish_competition: same computation, now refuses on every blocker and records the metadata
create or replace function public.finish_competition(p_competition uuid, p_multiplier_source text default 'tournament_structure') returns integer
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_block jsonb; v_mult numeric; n int := 0; r record; v_old public.results; v_pts numeric;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer can finish a competition' using errcode = '42501'; end if;
  if p_multiplier_source is null or p_multiplier_source not in ('tournament_structure', 'league_structure') then
    raise exception 'multiplier source must be tournament_structure or league_structure' using errcode = '22023'; end if;
  v_block := private.competition_blockers(p_competition);
  if jsonb_array_length(v_block) > 0 then raise exception '%', v_block -> 0 ->> 'text' using errcode = 'P0001'; end if;
  if v_k.tier is not null then
    select case p_multiplier_source when 'league_structure' then multiplier_league_structure else multiplier_tournament_structure end into v_mult
      from public.ref_tiers where name = v_k.tier;
  end if;
  perform set_config('bos.unlock', 'on', true);
  -- Finishing again recomputes from the matches; any change to a stored result is written to result_revisions ('recomputed').
  for r in select c.entry_id, c.final_place, c.base_points from private.compute_places(p_competition) c loop
    v_pts := private.tier_points(r.base_points, v_k.tier, p_multiplier_source);
    select * into v_old from public.results where competition_id = p_competition and entry_id = r.entry_id;
    if not found then
      insert into public.results (competition_id, entry_id, final_place, points) values (p_competition, r.entry_id, r.final_place, v_pts);
      perform private.log_result_revision(p_competition, r.entry_id, 'computed', null, null, r.final_place, v_pts, null);
    elsif v_old.final_place is distinct from r.final_place or v_old.points is distinct from v_pts then
      update public.results set final_place = r.final_place, points = v_pts where id = v_old.id;
      perform private.log_result_revision(p_competition, r.entry_id, 'recomputed', v_old.final_place, v_old.points, r.final_place, v_pts, null);
    end if;
    n := n + 1;
  end loop;
  for v_old in select * from public.results where competition_id = p_competition and entry_id not in (select c.entry_id from private.compute_places(p_competition) c) loop
    perform private.log_result_revision(p_competition, v_old.entry_id, 'superseded', v_old.final_place, v_old.points, null, null, 'entry no longer ranked');
    delete from public.results where id = v_old.id;
  end loop;
  update public.competitions set status = 'finished', finalized_at = coalesce(case when status = 'finished' then finalized_at end, now()), multiplier_source = p_multiplier_source
   where id = p_competition;
  perform set_config('bos.unlock', '', true);
  perform private.audit(v_k.event_id, 'competition.finished', p_competition::text,
    jsonb_build_object('entries', n, 'tier', v_k.tier, 'multiplier', v_mult, 'source', p_multiplier_source, 'again', v_k.status = 'finished'));
  return n;
end $$;
revoke execute on function public.finish_competition(uuid, text) from public, anon;
grant execute on function public.finish_competition(uuid, text) to authenticated;

-- The organizer's action from the review screen: atomic, and idempotent. A second tap, or a screen that did not see another organizer finish
-- first, gets 'already_official' and nothing is recomputed: once official, placements change only through a reopen.
create or replace function public.finalize_competition(p_competition uuid, p_multiplier_source text default 'tournament_structure') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; n int;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer of this event can make its results official' using errcode = '42501'; end if;
  if v_k.status = 'finished' then
    return jsonb_build_object('status', 'already_official', 'finalized_at', v_k.finalized_at, 'entries', (select count(*) from public.results where competition_id = p_competition));
  end if;
  n := public.finish_competition(p_competition, coalesce(p_multiplier_source, 'tournament_structure'));
  select finalized_at into v_k.finalized_at from public.competitions where id = p_competition;
  return jsonb_build_object('status', 'official', 'finalized_at', v_k.finalized_at, 'entries', n);
end $$;
revoke execute on function public.finalize_competition(uuid, text) from public, anon;
grant execute on function public.finalize_competition(uuid, text) to authenticated;

-- Deliberately take an official result back for correction. The results are superseded in result_revisions (every version stays, with who and why);
-- the competition runs again until it is finalized once more. Organizer of the event (while their role is valid), organization administrator or owner.
create or replace function public.reopen_competition(p_competition uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; r public.results; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only an organizer of this event can reopen an official result' using errcode = '42501'; end if;
  if private.event_closed(v_k.event_id) then raise exception 'this event is closed; reopen the event first' using errcode = 'P0001'; end if;
  if char_length(v_reason) < 3 then raise exception 'say why the result is being reopened' using errcode = '22023'; end if;
  if v_k.status <> 'finished' then raise exception 'this competition is not official, so there is nothing to reopen' using errcode = 'P0001'; end if;
  perform set_config('bos.unlock', 'on', true);
  for r in select * from public.results where competition_id = p_competition loop
    perform private.log_result_revision(p_competition, r.entry_id, 'superseded', r.final_place, r.points, null, null, v_reason);
  end loop;
  delete from public.results where competition_id = p_competition;
  update public.competitions set status = 'running', reopened_at = now(), finalized_at = null where id = p_competition;
  perform set_config('bos.unlock', '', true);
  perform private.audit(v_k.event_id, 'competition.reopened', p_competition::text,
    jsonb_build_object('reason', v_reason, 'results_superseded', true, 'was_official_since', v_k.finalized_at, 'by', 'reopen_competition'));
end $$;
revoke execute on function public.reopen_competition(uuid, text) from public, anon;
grant execute on function public.reopen_competition(uuid, text) to authenticated;

-- A match reopened inside an official competition (reopen_match) also takes the competition back: same metadata as reopen_competition.
create or replace function private.unfinish_competition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; r public.results; v_reason text := coalesce(nullif(current_setting('bos.reopen_reason', true), ''), 'a match was reopened or added');
begin
  if tg_op = 'UPDATE' and not (old.queue_state = 'final' and new.queue_state <> 'final') then return new; end if;
  if tg_op = 'INSERT' and new.queue_state = 'final' then return new; end if;
  select event_id into v_event from public.competitions where id = new.competition_id and status = 'finished';
  if found then
    perform set_config('bos.unlock', 'on', true);
    for r in select * from public.results where competition_id = new.competition_id loop
      perform private.log_result_revision(new.competition_id, r.entry_id, 'superseded', r.final_place, r.points, null, null, v_reason);
    end loop;
    delete from public.results where competition_id = new.competition_id;
    update public.competitions set status = 'running', reopened_at = now(), finalized_at = null where id = new.competition_id;
    perform set_config('bos.unlock', '', true);
    perform private.audit(v_event, 'competition.reopened', new.competition_id::text, jsonb_build_object('match', new.id, 'reason', v_reason, 'results_superseded', true, 'by', 'reopen_match'));
  end if;
  return new;
end $$;
revoke execute on function private.unfinish_competition() from public, anon, authenticated;

-- reopen_match_core: unchanged, except that it clears its own flag once the match is reopened (the unfinish trigger has already read it),
-- so the lock below is bypassed only for that one update.
CREATE OR REPLACE FUNCTION private.reopen_match_core(p_match uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_m public.matches; v_event uuid; v_next public.matches; v_third public.matches; v_loser uuid; v_slot text;
begin
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if v_m.queue_state <> 'final' then return; end if;
  if char_length(coalesce(p_reason, '')) < 3 then raise exception 'say why the result is being reopened' using errcode = '22023'; end if;
  perform set_config('bos.reopen_reason', btrim(p_reason), true);
  v_loser := case v_m.result when 'a' then v_m.entry_b when 'b' then v_m.entry_a else null end;
  if v_m.next_match_id is not null then
    select * into v_next from public.matches where id = v_m.next_match_id for update;
    if v_next.queue_state = 'final' then raise exception 'the next match was already played; reopen that one first' using errcode = 'P0001'; end if;
    if v_m.stage = 'elimination' and v_loser is not null and v_next.stage = 'final' then
      select * into v_third from public.matches where competition_id = v_m.competition_id and stage = 'third_place' order by position, id limit 1 for update;
      if found then
        if v_third.queue_state = 'final' then raise exception 'the third-place match was already played; reopen that one first' using errcode = 'P0001'; end if;
        select case when count(*) = 0 then 'a' else 'b' end into v_slot from public.matches s
          where s.next_match_id = v_m.next_match_id and s.stage = 'elimination' and (s.position, s.id) < (v_m.position, v_m.id);
        if v_slot = 'a' and v_third.entry_a = v_loser then update public.matches set entry_a = null where id = v_third.id; end if;
        if v_slot = 'b' and v_third.entry_b = v_loser then update public.matches set entry_b = null where id = v_third.id; end if;
      end if;
    end if;
    if v_m.next_slot = 'a' and v_next.entry_a = v_m.winner_entry_id then update public.matches set entry_a = null where id = v_next.id; end if;
    if v_m.next_slot = 'b' and v_next.entry_b = v_m.winner_entry_id then update public.matches set entry_b = null where id = v_next.id; end if;
  end if;
  update public.matches set queue_state = 'scheduled', result = null, winner_entry_id = null, score_a = null, score_b = null, detail = '{}'::jsonb, finalized_at = null, version = version + 1 where id = p_match;
  perform private.audit(v_event, 'match.reopened', p_match::text, jsonb_build_object('reason', p_reason));
  perform set_config('bos.reopen_reason', '', true);
end $$;
revoke execute on function private.reopen_match_core(uuid, text) from public, anon, authenticated;

-- A tie decision changes placements, so it is not taken once they are official.
create or replace function public.record_tie_decision(p_competition uuid, p_part text, p_order uuid[], p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_part text := coalesce(p_part, ''); v_raw bigint; v_group uuid[]; i int; v_status text;
begin
  v_event := private.event_of_competition(p_competition);
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer can decide a tie' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say why this order was chosen' using errcode = '22023'; end if;
  if p_order is null or cardinality(p_order) < 2 then raise exception 'list the tied entries in the order they should finish' using errcode = '22023'; end if;
  select status into v_status from public.competitions where id = p_competition for update;
  if v_status = 'finished' then raise exception 'this competition is official; reopen it before deciding a tie' using errcode = 'P0001'; end if;
  if private.event_closed(v_event) then raise exception 'this event is closed; reopen it first' using errcode = 'P0001'; end if;
  select g.raw_rank into v_raw from private.group_ranks(p_competition) g where g.part = v_part and g.ent = p_order[1];
  if v_raw is null then raise exception 'that entry has no standing in this pool yet' using errcode = '22023'; end if;
  select array_agg(g.ent) into v_group from private.group_ranks(p_competition) g where g.part = v_part and g.raw_rank = v_raw;
  if cardinality(v_group) < 2 then raise exception 'there is no tie to decide here' using errcode = '22023'; end if;
  if not (v_group @> p_order and p_order @> v_group and cardinality(p_order) = cardinality(v_group)) then
    raise exception 'list exactly the tied entries, each once' using errcode = '22023'; end if;
  delete from public.pool_tie_decisions where competition_id = p_competition and entry_id = any (v_group);
  for i in 1 .. cardinality(p_order) loop
    insert into public.pool_tie_decisions (competition_id, entry_id, part, rank, note, decided_by) values (p_competition, p_order[i], v_part, i, btrim(p_note), auth.uid());
  end loop;
  perform private.audit(v_event, 'pool.tie_decided', p_competition::text, jsonb_build_object('pool', v_part, 'order', to_jsonb(p_order), 'note', btrim(p_note)));
end $$;

-- ---------------------------------------------------------------- 5. locks (server side; a disabled button is not a lock)
-- Fights of an official competition, or of a closed event, change only through the audited paths. reopen_match sets bos.reopen_reason; the finish,
-- reopen and close functions set bos.unlock. A closed event is not reopened by reopening a match.
create or replace function private.matches_lock_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_comp uuid := coalesce(new.competition_id, old.competition_id); v_k public.competitions;
begin
  if not private.is_client_session() or private.unlocked() then return coalesce(new, old); end if;
  select * into v_k from public.competitions where id = v_comp;
  if v_k.id is null then return coalesce(new, old); end if;
  if private.event_closed(v_k.event_id) then raise exception 'this event is closed; its fights are history. Reopen the event to change anything.' using errcode = 'P0001'; end if;
  if v_k.status = 'finished' and coalesce(nullif(current_setting('bos.reopen_reason', true), ''), '') = '' then
    raise exception 'this competition is official; reopen it before changing a fight' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
revoke execute on function private.matches_lock_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_lock_guard' and tgrelid = 'public.matches'::regclass) then
    create trigger matches_lock_guard before insert or update or delete on public.matches for each row execute function private.matches_lock_guard();
  end if;
end $$;

-- Entrants of an official competition stay as they were. The represented-team correction and a team merge keep working (they carry their own flags).
create or replace function private.entries_lock_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_comp uuid := coalesce(new.competition_id, old.competition_id); v_k public.competitions;
begin
  if not private.is_client_session() or private.unlocked()
     or coalesce(current_setting('bos.represented_team', true), '') = 'on' or coalesce(current_setting('bos.merging', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select * into v_k from public.competitions where id = v_comp;
  if v_k.id is null then return coalesce(new, old); end if;
  if private.event_closed(v_k.event_id) then raise exception 'this event is closed; its entrants are history. Reopen the event to change anything.' using errcode = 'P0001'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is official; reopen it before changing its entrants' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
revoke execute on function private.entries_lock_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'entries_lock_guard' and tgrelid = 'public.entries'::regclass) then
    create trigger entries_lock_guard before insert or update or delete on public.entries for each row execute function private.entries_lock_guard();
  end if;
end $$;

-- The competition row: status moves to or from 'finished' only through finish / reopen; nothing changes once the event is closed.
create or replace function private.competitions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_client_session() then return coalesce(new, old); end if;
  if private.event_closed(coalesce(new.event_id, old.event_id)) and not private.unlocked() then
    raise exception 'this event is closed; its competitions are history. Reopen the event to change anything.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if not private.unlocked() and (new.status = 'finished' or new.finalized_at is not null) then
      raise exception 'a competition becomes official only through Finalize' using errcode = 'P0001'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.entries e where e.competition_id = old.id)
       or exists (select 1 from public.matches m where m.competition_id = old.id)
       or exists (select 1 from public.results r where r.competition_id = old.id)
       or exists (select 1 from public.registration_competitions rc where rc.competition_id = old.id) then
      raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.category, new.gender) is distinct from (old.category, old.gender)
     and exists (select 1 from public.matches m where m.competition_id = old.id) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  if old.status = 'finished' and (new.name, new.category, new.gender, new.ruleset, new.rounds_to_win) is distinct from (old.name, old.category, old.gender, old.ruleset, old.rounds_to_win) then
    raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001';
  end if;
  if not private.unlocked() then
    if old.status = 'finished' and new.status <> 'finished' then
      raise exception 'this competition is official; use Reopen (with a reason) to take it back' using errcode = 'P0001'; end if;
    if old.status <> 'finished' and new.status = 'finished' then
      raise exception 'a competition becomes official only through Finalize' using errcode = 'P0001'; end if;
    if (new.finalized_at, new.reopened_at, new.multiplier_source) is distinct from (old.finalized_at, old.reopened_at, old.multiplier_source) then
      raise exception 'the official-result record is written only by Finalize and Reopen' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke execute on function private.competitions_guard() from public, anon, authenticated;

-- The one competitions trigger now also sees inserts (Pack 07's gates require exactly this one trigger on the table).
create or replace trigger competitions_guard before insert or delete or update on public.competitions for each row execute function private.competitions_guard();

-- The event row: closed_at / reopened_at are written only by close_event / reopen_event, and a closed event does not change at all until reopened.
create or replace function private.events_lock_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_client_session() or private.unlocked() then return new; end if;
  if (new.closed_at, new.reopened_at) is distinct from (old.closed_at, old.reopened_at) then
    raise exception 'an event is closed and reopened only through Close event and Reopen event' using errcode = 'P0001'; end if;
  if old.closed_at is not null then raise exception 'this event is closed; it is history now. Reopen it (with a reason) to change anything.' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.events_lock_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'events_lock_guard' and tgrelid = 'public.events'::regclass) then
    create trigger events_lock_guard before update on public.events for each row execute function private.events_lock_guard();
  end if;
end $$;

-- ---------------------------------------------------------------- 6. event closeout
create or replace function public.event_close_preflight(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_e public.events; v_block jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb; v_comps jsonb; n int; v_names text;
begin
  select * into v_e from public.events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can close it' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'status', k.status, 'total', x.total, 'final', x.final,
           'state', case when k.status = 'finished' then 'official' when x.total = 0 then 'no_draw' when x.final < x.total then 'running' else 'ready' end,
           'finalized_at', k.finalized_at) order by k.sort, k.name), '[]'::jsonb) into v_comps
    from public.competitions k
    cross join lateral (select count(*) as total, count(*) filter (where queue_state = 'final') as final from public.matches m where m.competition_id = k.id) x
   where k.event_id = p_event;
  if v_e.status <> 'published' then v_block := v_block || jsonb_build_object('code', 'not_published', 'text', 'Only a published event can be closed (this one is ' || v_e.status || ').'); end if;
  select count(*), string_agg(k.name, ', ' order by k.sort, k.name) into n, v_names from public.competitions k
   where k.event_id = p_event and k.status <> 'finished' and exists (select 1 from public.matches m where m.competition_id = k.id);
  if n > 0 then v_block := v_block || jsonb_build_object('code', 'competitions_open', 'count', n, 'text', n || case when n = 1 then ' competition is' else ' competitions are' end || ' not official yet: ' || v_names || '.'); end if;
  select count(*) into n from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = p_event and m.queue_state in ('active', 'on_deck', 'in_the_hole');
  if n > 0 then v_block := v_block || jsonb_build_object('code', 'live_matches', 'count', n, 'text', n || case when n = 1 then ' fight is' else ' fights are' end || ' still on a field.'); end if;
  select count(*) into n from public.result_proposals p where p.event_id = p_event and p.status = 'conflict';
  if n > 0 then v_block := v_block || jsonb_build_object('code', 'result_conflicts', 'count', n, 'text', n || case when n = 1 then ' result needs' else ' results need' end || ' review: two devices disagreed.'); end if;
  select count(*) into n from public.match_live_scores s join public.competitions k on k.id = s.competition_id where k.event_id = p_event;
  if n > 0 then v_block := v_block || jsonb_build_object('code', 'live_score', 'count', n, 'text', 'A running score is still on the board.'); end if;
  select count(*) into n from public.competitions k join public.results r on r.competition_id = k.id where k.event_id = p_event and k.status <> 'finished';
  if n > 0 then v_block := v_block || jsonb_build_object('code', 'inconsistent_results', 'text', 'Results exist for a competition that is not official. Finalize or reopen it.'); end if;
  select count(*), string_agg(k.name, ', ' order by k.sort, k.name) into n, v_names from public.competitions k
   where k.event_id = p_event and k.status <> 'finished' and not exists (select 1 from public.matches m where m.competition_id = k.id);
  if n > 0 then v_warn := v_warn || jsonb_build_object('code', 'never_ran', 'count', n, 'text', n || case when n = 1 then ' competition never ran' else ' competitions never ran' end || ' (no draw): ' || v_names || '. It will be closed as not held.'); end if;
  select count(*) into n from public.results r join public.entries e on e.id = r.entry_id join public.competitions k on k.id = r.competition_id
   where k.event_id = p_event and e.fighter_id is not null and e.represented_team_id is null;
  if n > 0 then v_warn := v_warn || jsonb_build_object('code', 'no_represented_team', 'count', n, 'text', n || case when n = 1 then ' individual result has' else ' individual results have' end || ' no recorded team. The placings are official; the points count for no team until a team is recorded.'); end if;
  select count(*) into n from public.competitions k where k.event_id = p_event and k.status = 'finished' and k.tier is null;
  if n > 0 then v_warn := v_warn || jsonb_build_object('code', 'no_tier', 'count', n, 'text', n || case when n = 1 then ' official competition has' else ' official competitions have' end || ' no tier: its placings are worth 0 ranking points.'); end if;
  return jsonb_build_object('event', jsonb_build_object('id', v_e.id, 'name', v_e.name, 'status', v_e.status, 'closed_at', v_e.closed_at, 'reopened_at', v_e.reopened_at),
    'closed', v_e.closed_at is not null, 'ready', v_e.closed_at is null and jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'warnings', v_warn, 'competitions', v_comps);
end $$;
revoke execute on function public.event_close_preflight(uuid) from public, anon;
grant execute on function public.event_close_preflight(uuid) to authenticated;

create or replace function public.close_event(p_event uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.events; v_pre jsonb; n int;
begin
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can close it' using errcode = '42501'; end if;
  if v_e.closed_at is not null then return jsonb_build_object('status', 'already_closed', 'closed_at', v_e.closed_at); end if;
  -- Every competition row is locked before the checks, so a reopen or finalize committing in the same moment is seen (and a reopen
  -- started after this waits, then finds the event closed).
  perform 1 from public.competitions where event_id = p_event order by id for update;
  v_pre := public.event_close_preflight(p_event);
  if jsonb_array_length(v_pre -> 'blockers') > 0 then raise exception '%', v_pre -> 'blockers' -> 0 ->> 'text' using errcode = 'P0001'; end if;
  perform set_config('bos.unlock', 'on', true);
  update public.events set closed_at = now() where id = p_event;
  perform set_config('bos.unlock', '', true);
  select count(*) into n from public.competitions where event_id = p_event and status = 'finished';
  perform private.audit(p_event, 'event.closed', p_event::text, jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'official_competitions', n, 'warnings', v_pre -> 'warnings'));
  return jsonb_build_object('status', 'closed', 'closed_at', now());
end $$;
revoke execute on function public.close_event(uuid, text) from public, anon;
grant execute on function public.close_event(uuid, text) to authenticated;

create or replace function public.reopen_event(p_event uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_e public.events; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_e from public.events where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can reopen it' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'say why the event is being reopened' using errcode = '22023'; end if;
  if v_e.closed_at is null then raise exception 'this event is not closed' using errcode = 'P0001'; end if;
  perform set_config('bos.unlock', 'on', true);
  update public.events set closed_at = null, reopened_at = now() where id = p_event;
  perform set_config('bos.unlock', '', true);
  perform private.audit(p_event, 'event.reopened', p_event::text, jsonb_build_object('reason', v_reason, 'was_closed_at', v_e.closed_at));
end $$;
revoke execute on function public.reopen_event(uuid, text) from public, anon;
grant execute on function public.reopen_event(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 7. the official placements, for everyone who may see the event
-- Sporting identities only: the name the team used at the event, the fighter, the team the fighter represented. No account ids, no notes.
create or replace view public.competition_results with (security_invoker = true) as
select r.competition_id, r.entry_id, r.final_place, coalesce(r.points, 0) as points, e.status as entry_status,
  case when e.team_id is not null then 'team' else 'fighter' end as kind,
  e.team_id, t.slug as team_slug, coalesce(e.team_name_at_event, t.name) as team_name_at_event, t.name as team_current_name,
  e.fighter_id, f.display_name as fighter_name,
  e.represented_team_id, rt.slug as represented_team_slug, e.represented_team_name_at_event
from public.results r
join public.entries e on e.id = r.entry_id
left join public.teams t on t.id = e.team_id
left join public.fighters f on f.id = e.fighter_id
left join public.teams rt on rt.id = e.represented_team_id
where r.final_place is not null;
grant select on public.competition_results to anon, authenticated;
comment on view public.competition_results is 'Pack 09C: the official placements of a competition (results rows), with sporting identities only, for the public podium and full results.';

-- ---------------------------------------------------------------- 8. realtime: open screens learn that a competition is official or an event closed
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'competitions') then
    alter publication supabase_realtime add table public.competitions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- ---------------------------------------------------------------- 9. legacy: competitions finished before this pack
-- Each one was finished by finish_competition (its 'competition.finished' audit row is the evidence); its finalized_at is that moment. A finished
-- competition without such a row (none on the hosted project) gets the time its results were written. Nothing else changes. Returns how many rows it filled.
create or replace function private.backfill_official_metadata() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.competitions k set
    finalized_at = coalesce((select max(a.at) from public.audit_log a where a.action = 'competition.finished' and a.subject = k.id::text),
                            (select max(r.created_at) from public.results r where r.competition_id = k.id)),
    multiplier_source = coalesce(k.multiplier_source, (select a.details ->> 'source' from public.audit_log a where a.action = 'competition.finished' and a.subject = k.id::text order by a.at desc, a.id desc limit 1))
  where k.status = 'finished' and k.finalized_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function private.backfill_official_metadata() from public, anon, authenticated;
select private.backfill_official_metadata();
