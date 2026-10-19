-- Secretary boundary (owner decision 2026-10-18). ADDITIVE: helpers are replaced, existing functions are patched in place with anchors (the Pack 18.1
-- technique: a missing anchor stops the migration), one new evidence table, two new functions.
--
-- The Secretary / Scorekeeper (event role or device role 'scorekeeper', and nothing above it) runs the fights on a field's board ONLY: the one on now
-- (the field's current Lyst fight, or the active one), on deck and in the hole. On those fights: accept, return or manually enter a round's score (with or
-- without counters), record the marshal's decisions, run the clock, start the next fight. Nothing else:
--   * no Command Centre, device list / codes / preview, staff, scheduling, running-order changes, holds, announcements, Counter QR or training QR;
--   * no opening, starting, scoring or reading the evidence of an arbitrary waiting fight.
-- Unchanged: the head marshal and marshals (every event fight, as before); the organizer; the Temporary Organizer (Event Admin tablet), which now reaches
-- the queue and announcements through private.is_event_operator instead of its scorekeeper device role. Counters are untouched.
-- In flight: a fight that is already the field's current one (lyst_field_current or the field's clock) stays reachable whatever its queue state, so a
-- secretary tablet mid-fight keeps working. No rows are rewritten; permissions apply from the next call.
--
-- New:
--   private.is_secretary_only(event), private.can_score_match(match), private.can_view_match(match)
--   public.secretary_board(event, field)              the narrow now / on deck / in the hole read, with the viewer's flags (no command data)
--   public.lyst_return_round(cmd, match, round, rev, reason)  a round goes back to the counters: tally evidence kept, submissions reset, audited
--   public.lyst_round_returns                          append-only record of every return (the counters' snapshot and submissions at that moment)
--   lyst_confirm_round: a manual score that differs from every total the counters submitted for a side needs a reason, and the audit says so.

-- ---------------------------------------------------------------- 0. patch helpers
create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;   -- already patched (a re-run changes nothing)
  if position(p_from in v_def) = 0 then raise exception 'secretary patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;

-- every overload of a public function (hosted signatures may carry later additions)
create or replace function pg_temp.bos_patch_all(p_name text, p_from text, p_to text) returns integer language plpgsql as $p$
declare r record; v_n integer := 0;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = p_name loop
    perform pg_temp.bos_patch(r.fn, p_from, p_to);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'secretary patch: no function public.%', p_name; end if;
  return v_n;
end $p$;

-- ---------------------------------------------------------------- 1. who is "only the secretary", and which fights they reach
-- True when the caller reaches this event as a scorekeeper and through nothing stronger (organizer, head marshal, marshal, Temporary Organizer, owner).
create or replace function private.is_secretary_only(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_event is not null
     and coalesce(private.has_event_role(p_event, array['scorekeeper']), false)
     and not coalesce(private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal']), false)
     and not coalesce(private.is_event_operator(p_event), false)
$$;

-- The secretary's board: not final, and on now / on deck / in the hole, or the fight a field's Lyst or clock is on (in-flight fights stay reachable).
create or replace function private.match_on_secretary_board(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match and m.queue_state <> 'final'
      and (m.queue_state in ('active', 'on_deck', 'in_the_hole')
           or exists (select 1 from public.lyst_field_current f where f.match_id = m.id)
           or exists (select 1 from public.lyst_timer t where t.match_id = m.id)))
$$;

-- May the caller score / run THIS fight? Every scoring role of the event as before; the secretary only on the board.
create or replace function private.can_score_match(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with e as (select private.event_of_match(p_match) as ev)
  select case
    when e.ev is null then false
    when not coalesce(private.can_score(e.ev), false) then false
    when not private.is_secretary_only(e.ev) then true
    else private.match_on_secretary_board(p_match) end
  from e
$$;

-- May the caller read this fight's staff evidence (tallies, revisions, private discipline, returns)? What they may score, plus, for the secretary,
-- the field's last finished fight (the tablet reads it once more right after finishing it).
create or replace function private.can_view_match(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.can_score_match(p_match), false) or coalesce((
    select private.can_score(k.event_id) and m.queue_state = 'final'
       and m.id = (select m2.id from public.matches m2 join public.competitions k2 on k2.id = m2.competition_id
                   where k2.event_id = k.event_id and private.field_key(m2.field) = private.field_key(m.field) and m2.queue_state = 'final'
                   order by m2.finalized_at desc nulls last, m2.version desc, m2.id limit 1)
    from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match), false)
$$;

revoke execute on function private.is_secretary_only(uuid), private.match_on_secretary_board(uuid), private.can_score_match(uuid), private.can_view_match(uuid)
  from public, anon, authenticated;
-- row policies below call can_view_match as the reading role
grant execute on function private.can_view_match(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. narrowed event-wide powers
-- Command Centre and everything that hangs off it (devices, device codes, staff, schedule moves): organizer and head marshal. The Temporary Organizer
-- keeps it through its head_marshal device role.
create or replace function private.can_command(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_event is not null and private.has_event_role(p_event, array['organizer', 'head_marshal'])
$$;
-- Running order, holds, plans: the organizer or the Temporary Organizer (it had this through its scorekeeper device role; now explicitly).
create or replace function private.can_adjust_queue(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select p_event is not null and coalesce(private.is_event_operator(p_event), false) $$;
-- Announcements: the same.
create or replace function private.can_announce(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select p_event is not null and coalesce(private.is_event_operator(p_event), false) $$;

-- the Counter QR, the training QR and moving counter phones are not the secretary's
select pg_temp.bos_patch_all('counter_pool_code',
  $a$if p_event is null or not (private.can_score(p_event) or private.is_owner()) then$a$,
  $b$if p_event is null or not (private.can_score(p_event) or private.is_owner()) or private.is_secretary_only(p_event) then$b$);
select pg_temp.bos_patch('public.create_lyst_join_code(uuid,text)'::regprocedure,
  $a$if p_event is null or not private.can_score(p_event) then$a$,
  $b$if p_event is null or not private.can_score(p_event) or private.is_secretary_only(p_event) then$b$);
select pg_temp.bos_patch('public.move_counter_session(uuid,text,text)'::regprocedure,
  $a$if not (private.is_owner() or private.can_score(v_c.event_id)) then$a$,
  $b$if not (private.is_owner() or private.can_score(v_c.event_id)) or private.is_secretary_only(v_c.event_id) then$b$);
-- the event-wide cards and penalties log reads every fight's reasons: not the secretary's
select pg_temp.bos_patch_all('event_discipline_log',
  $a$if auth.uid() is null or not private.can_score(p_event) then$a$,
  $b$if auth.uid() is null or not private.can_score(p_event) or private.is_secretary_only(p_event) then$b$);

-- ---------------------------------------------------------------- 3. per-fight checks on every scoring path
-- Every Lyst command (open, clock, end / confirm round, discipline) goes through lyst_match_check.
select pg_temp.bos_patch('private.lyst_match_check(uuid,uuid,text)'::regprocedure,
  $a$if private.event_closed(p_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;$a$,
  $b$if private.event_closed(p_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  if not private.can_score_match(p_match) then raise exception 'the secretary runs only the fight on now, on deck and in the hole' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.lyst_state(uuid)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) or not private.can_view_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$b$);
-- the tablet's training code is not shown to the secretary
select pg_temp.bos_patch('public.lyst_state(uuid)'::regprocedure,
  $a$where c.event_id = v_event and c.field_key = v_key and c.revoked_at is null$a$,
  $b$where not private.is_secretary_only(v_event) and c.event_id = v_event and c.field_key = v_key and c.revoked_at is null$b$);
select pg_temp.bos_patch('public.lyst_void_discipline(uuid,uuid,text)'::regprocedure,
  $a$if not private.can_score(v_d.event_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_d.event_id) or not private.can_score_match(v_d.match_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch_all('lyst_cite_rule',
  $a$if not private.can_score(v_d.event_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_d.event_id) or not private.can_score_match(v_d.match_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;$b$);
-- classic scoring and finalization (lyst_finalize saves through submit_match_result)
select pg_temp.bos_patch('public.submit_match_result(uuid,uuid,text,integer,integer,jsonb,integer,integer)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.finalize_match(uuid,text,integer,integer,jsonb,integer)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.record_score_event(uuid,uuid,text,jsonb,timestamptz)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.report_live_score(uuid,text,bigint,integer,integer,text,jsonb,integer)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot score this event' using errcode = '42501'; end if;$b$);
-- the queue: the secretary starts a fight that is already on the board (on deck / in the hole -> active), on its own field; nothing else.
-- advance_field_queue is unchanged: it only follows the field's own order, so "start the next fight" keeps working.
select pg_temp.bos_patch('public.set_match_queue(uuid,text,text)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;$a$,
  $b$if not private.can_score(v_event) then raise exception 'you cannot run this event' using errcode = '42501'; end if;
  if private.is_secretary_only(v_event) then
    if not private.can_score_match(p_match) then raise exception 'the secretary runs only the fight on now, on deck and in the hole' using errcode = '42501'; end if;
    if p_state is distinct from 'active' then raise exception 'the secretary starts the next fight; an organizer changes the running order' using errcode = '42501'; end if;
    if p_field is not null and private.field_key(p_field) is distinct from (select private.field_key(x.field) from public.matches x where x.id = p_match) then
      raise exception 'an organizer moves a fight to another Lyst' using errcode = '42501'; end if;
  end if;$b$);

-- ---------------------------------------------------------------- 4. evidence reads: only for fights the reader may see
drop policy if exists lyst_round_revisions_read on public.lyst_round_revisions;
create policy lyst_round_revisions_read on public.lyst_round_revisions for select to authenticated using (private.can_view_match(match_id));
drop policy if exists lyst_counts_read on public.lyst_counts;
create policy lyst_counts_read on public.lyst_counts for select to authenticated
  using (private.can_view_match(match_id) or exists (select 1 from public.lyst_counter_seats s where s.id = seat_id and s.user_id = (select auth.uid())));
drop policy if exists lyst_counter_rounds_read on public.lyst_counter_rounds;
create policy lyst_counter_rounds_read on public.lyst_counter_rounds for select to authenticated
  using (private.can_view_match(match_id) or exists (select 1 from public.lyst_counter_seats s where s.id = seat_id and s.user_id = (select auth.uid())));
drop policy if exists lyst_counter_seats_read on public.lyst_counter_seats;
create policy lyst_counter_seats_read on public.lyst_counter_seats for select to authenticated
  using (user_id = (select auth.uid()) or (match_id is not null and private.can_view_match(match_id))
         or (match_id is null and private.can_score(event_id) and not private.is_secretary_only(event_id)));
drop policy if exists match_discipline_private_read on public.match_discipline_private;
create policy match_discipline_private_read on public.match_discipline_private for select to authenticated
  using (private.can_view_match((select d.match_id from public.match_discipline d where d.id = discipline_id)));
drop policy if exists lyst_join_codes_read on public.lyst_join_codes;
create policy lyst_join_codes_read on public.lyst_join_codes for select to authenticated using (private.can_score(event_id) and not private.is_secretary_only(event_id));
drop policy if exists score_events_read on public.score_events;
create policy score_events_read on public.score_events for select to authenticated using (private.can_view_match(match_id));
grant execute on function private.is_secretary_only(uuid) to authenticated;   -- lyst_counter_seats_read / lyst_join_codes_read

-- ---------------------------------------------------------------- 5. the secretary's board
create or replace function private.board_fight(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('match_id', m.id, 'a', private.lyst_side_name(m.entry_a), 'b', private.lyst_side_name(m.entry_b),
           'competition', k.name, 'round_label', m.round_label, 'stage', m.stage, 'queue_state', m.queue_state, 'version', m.version,
           'field_key', private.field_key(m.field), 'lyst_open', exists (select 1 from public.lyst_matches lm where lm.match_id = m.id))
  from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match
$$;
revoke execute on function private.board_fight(uuid) from public, anon, authenticated;

-- Names only (what the public Live view shows anyway), plus what the viewer may do. No devices, staff, codes, counters or reasons.
create or replace function public.secretary_board(p_event uuid, p_field text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_fields jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_event is null or not private.can_score(p_event) then raise exception 'only this event''s scoring staff can see the board' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label,
           'now', private.board_fight(coalesce(private.field_current_match(p_event, f.field_key),
                    (select m.id from public.matches m join public.competitions k on k.id = m.competition_id
                      where k.event_id = p_event and private.field_key(m.field) = f.field_key and m.queue_state = 'active' order by m.id limit 1))),
           'on_deck', private.board_fight((select q from private.queue_ordered(p_event, f.field_key, array['on_deck']) q limit 1)),
           'in_the_hole', private.board_fight((select q from private.queue_ordered(p_event, f.field_key, array['in_the_hole']) q limit 1)))
         order by f.field_key collate "C"), '[]'::jsonb) into v_fields
  from private.event_field_keys(p_event) f
  where p_field is null or f.field_key = private.field_key(p_field);
  return jsonb_build_object('event_id', p_event, 'fields', v_fields,
    'viewer', jsonb_build_object(
      'secretary_only', private.is_secretary_only(p_event),
      'organizer', coalesce(private.is_organizer(p_event), false),
      'operator', coalesce(private.is_event_operator(p_event), false),
      'command', coalesce(private.can_command(p_event), false),
      'adjust_queue', coalesce(private.can_adjust_queue(p_event), false),
      'announce', coalesce(private.can_announce(p_event), false),
      'resolve_results', coalesce(private.can_resolve_results(p_event), false),
      'camera_off', coalesce(private.can_camera_off_activate(p_event), false)),
    'server_now', clock_timestamp());
end $$;

-- ---------------------------------------------------------------- 6. a round goes back to the counters
create table if not exists public.lyst_round_returns (
  id uuid primary key,                    -- the command id: a retried return is recognised
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  previous_status text not null check (previous_status in ('confirming', 'confirmed')),
  previous_a integer, previous_b integer, previous_rev integer not null,
  counters jsonb not null default '[]'::jsonb,       -- each counter's tally at that moment (private.lyst_counter_snapshot)
  submissions jsonb not null default '[]'::jsonb,    -- the "done" marks that were reset: seat and time
  reason text check (reason is null or char_length(reason) <= 200),
  returned_by uuid not null,
  returned_at timestamptz not null default now()
);
create index if not exists lyst_round_returns_match_idx on public.lyst_round_returns (match_id, round_no, returned_at);
alter table public.lyst_round_returns enable row level security;
drop policy if exists lyst_round_returns_read on public.lyst_round_returns;
create policy lyst_round_returns_read on public.lyst_round_returns for select to authenticated using (private.can_view_match(match_id));
grant select on public.lyst_round_returns to authenticated;
revoke insert, update, delete on public.lyst_round_returns from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'lyst_round_returns_no_change' and tgrelid = 'public.lyst_round_returns'::regclass) then
    create trigger lyst_round_returns_no_change before update or delete on public.lyst_round_returns for each row execute function private.lyst_append_only();
  end if;
end $do$;
comment on table public.lyst_round_returns is 'Every time a round went back to the counters: what it was (status, awarded score), the counters'' tallies and submissions at that moment, why, who. Append-only.';

-- The latest round of a live fight, being confirmed or confirmed, goes back to RUNNING so the counters can amend and submit again. Their taps are never
-- touched (the tally carries on); their "done" marks for that round are reset, and kept in the return record. A confirmed round loses its awarded score
-- (it is no longer official until confirmed again) and needs a reason. Idempotent on the command id; stale on the round revision.
create or replace function public.lyst_return_round(p_command uuid, p_match uuid, p_round integer, p_expected_rev integer, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_r public.lyst_rounds; v_old public.lyst_round_returns; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
        v_max integer; v_subs jsonb; v_n integer; v_prev text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  perform private.assert_session_alive();
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  select * into v_old from public.lyst_round_returns where id = p_command;
  if found then
    if v_old.match_id <> p_match or v_old.returned_by <> auth.uid() then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'round', (select to_jsonb(r) - 'event_id' from public.lyst_rounds r where r.match_id = p_match and r.round_no = v_old.round_no));
  end if;
  perform private.lyst_match_check(v_event, p_match, null);
  if p_round is null or p_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'keep the reason under 200 characters' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-round:' || p_match::text, 0));

  select * into v_r from public.lyst_rounds where match_id = p_match and round_no = p_round for update;
  if not found then raise exception 'that round has not started' using errcode = 'P0001'; end if;
  if coalesce(p_expected_rev, 0) is distinct from v_r.rev then return jsonb_build_object('status', 'stale', 'round', to_jsonb(v_r) - 'event_id'); end if;
  if v_r.status = 'running' then return jsonb_build_object('status', 'unchanged', 'round', to_jsonb(v_r) - 'event_id'); end if;
  select max(round_no) into v_max from public.lyst_rounds where match_id = p_match;
  if v_max > p_round then raise exception 'only the latest round can go back to the counters: round % has started', v_max using errcode = 'P0001'; end if;
  if v_r.status = 'confirmed' and coalesce(char_length(v_reason), 0) < 3 then raise exception 'say why the confirmed round goes back to the counters' using errcode = '22023'; end if;
  v_prev := v_r.status;

  select coalesce(jsonb_agg(jsonb_build_object('seat_id', c.seat_id, 'submitted_at', c.submitted_at) order by c.submitted_at), '[]'::jsonb) into v_subs
    from public.lyst_counter_rounds c where c.match_id = p_match and c.round_no = p_round;
  insert into public.lyst_round_returns (id, match_id, event_id, round_no, previous_status, previous_a, previous_b, previous_rev, counters, submissions, reason, returned_by)
  values (p_command, p_match, v_event, p_round, v_prev, v_r.awarded_a, v_r.awarded_b, v_r.rev, private.lyst_counter_snapshot(p_match, p_round), v_subs, v_reason, auth.uid());
  delete from public.lyst_counter_rounds where match_id = p_match and round_no = p_round;
  get diagnostics v_n = row_count;
  update public.lyst_rounds set status = 'running', awarded_a = null, awarded_b = null, confirmed_at = null, rev = rev + 1
   where match_id = p_match and round_no = p_round returning * into v_r;
  perform private.audit(v_event, 'lyst.round_returned', p_match::text, jsonb_build_object('command', p_command, 'round', p_round, 'from', v_prev,
    'previous', jsonb_build_object('a', (select x.previous_a from public.lyst_round_returns x where x.id = p_command), 'b', (select x.previous_b from public.lyst_round_returns x where x.id = p_command)),
    'submissions_reset', v_n, 'reason', v_reason));
  return jsonb_build_object('status', 'ok', 'round', to_jsonb(v_r) - 'event_id', 'submissions_reset', v_n);
end $$;

-- ---------------------------------------------------------------- 7. manual entry over the counters: a reason when it differs from what they submitted
-- "Differs" = for a side where at least one OFFICIAL counter submitted, the awarded score equals none of their totals. Team fights ('standing': fighters
-- down, not points) are never compared. Counting nothing official: this only decides whether a reason is required, and says so in the audit.
create or replace function private.lyst_confirm_overrides(p_match uuid, p_round integer, p_a integer, p_b integer) returns boolean
language sql stable security definer set search_path = '' as $$
  with sub as (
    select s.side, private.lyst_seat_total(s.id, p_round) as total
    from public.lyst_counter_seats s join public.lyst_counter_rounds r on r.seat_id = s.id and r.match_id = p_match and r.round_no = p_round
    where s.match_id = p_match and s.status = 'active' and s.role = 'official' and s.side in ('a', 'b'))
  select coalesce((select lm.counter_input from public.lyst_matches lm where lm.match_id = p_match), 'simple') <> 'standing'
     and ((exists (select 1 from sub where side = 'a') and not exists (select 1 from sub where side = 'a' and total = p_a))
       or (exists (select 1 from sub where side = 'b') and not exists (select 1 from sub where side = 'b' and total = p_b)))
$$;
revoke execute on function private.lyst_confirm_overrides(uuid, integer, integer, integer) from public, anon, authenticated;

select pg_temp.bos_patch('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure,
  $a$v_kind := case when v_have and v_r.status = 'confirmed' then 'correct' else 'confirm' end;$a$,
  $b$v_kind := case when v_have and v_r.status = 'confirmed' then 'correct' else 'confirm' end;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 and private.lyst_confirm_overrides(p_match, p_round, p_awarded_a, p_awarded_b) then
    raise exception 'the counters submitted different totals: say why the score differs' using errcode = '22023'; end if;$b$);
select pg_temp.bos_patch('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure,
  $a$'reason', nullif(btrim(coalesce(p_reason, '')), '')));$a$,
  $b$'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'override', private.lyst_confirm_overrides(p_match, p_round, p_awarded_a, p_awarded_b)));$b$);

-- ---------------------------------------------------------------- 8. privileges
revoke execute on function public.secretary_board(uuid, text), public.lyst_return_round(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.secretary_board(uuid, text), public.lyst_return_round(uuid, uuid, integer, integer, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bos_event_device') then
    grant execute on function public.secretary_board(uuid, text), public.lyst_return_round(uuid, uuid, integer, integer, text) to bos_event_device;
  end if;
end $$;
