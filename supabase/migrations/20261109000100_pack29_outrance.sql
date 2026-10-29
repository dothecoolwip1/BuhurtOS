-- Pack 29: Outrance (Profight) on the Lyst, exactly to Outrance Rules and Regulations V.26.4 (docs/claude-packs/PACK_29_OUTRANCE.md).
--
--   * 3 or 5 LINE MARSHALS (§2.3, §15.1.1): a counter phone takes the line-marshal position (side 'm') and keeps one marshal's sheet for BOTH
--     fighters: effective strikes, takedowns, losses of weapon, armour failures (p.25), then, when the strike point difference is 5 or less, the
--     marshal's own criteria in priority order (§15.2). Every tap is a lyst_counts row with its mark and fighter, through the existing delivery
--     pipeline (ids, runs, receipts, recovery). The server computes every total; a phone never sends a number.
--   * The secretary averages the sheets into the Round Score (§15.3.1), kept EXACT in sixtieths (thirds and fifths add up exactly); the Total
--     Fight Score declares the winner (§15.4.1); the win type comes from each marshal's own fight result (§15.4.2).
--   * The knight marshal's calls (§13, §14) are protocol rows: verbal warning (the 3rd → a yellow card), yellow card (−1; the 2nd → red card =
--     disqualification), each 90 s granted for an armour repair (−1), KO / TKO and the other stoppages, notes. Weapon losses come from each
--     marshal's own sheet (3 or more in a round → −1). Owner decisions 2026-10-29: yes to the five gap answers in the pack doc §7.
--   * Timing from the competition: Division 1/2 and Tournament/Matched fight (§4). A tournament fight level after 2 rounds fights a 3rd; still
--     level, the head marshal records the decision (§2.1).
--   * Holds (§14.8, §14.10, §14.11, §5.2, §6.2): medic check after a TKO, assessment after a yield/corner stoppage/medical retirement, equipment
--     to fix after an equipment DQ, out of the tournament after a KO. A fight with an open hold does not open on the Lyst.
--   * Appeals (§16) are recorded and decided; the outcome is applied with the existing tools (void or add a call, correct or return the round).
-- Additive: new columns default to what exists today; the check constraints are widened, never narrowed; nothing is dropped. In-flight: any
-- Profight fight already open on a Lyst is switched to Outrance scoring (none on hosted on 2026-10-29).
set check_function_bodies = off;

-- ================================================================ 1. columns and constraints
alter table public.competitions add column if not exists fight_format text;
alter table public.competitions drop constraint if exists competitions_fight_format_check;
alter table public.competitions add constraint competitions_fight_format_check check (fight_format is null or fight_format in ('tournament', 'matched'));
comment on column public.competitions.fight_format is 'Pack 29, Outrance §4: tournament fights (2 rounds, a 3rd if level) or matched fights (3 rounds). Profight only.';

alter table public.lyst_matches add column if not exists scoring text not null default 'marshal';
alter table public.lyst_matches drop constraint if exists lyst_matches_scoring_check;
alter table public.lyst_matches add constraint lyst_matches_scoring_check check (scoring in ('marshal', 'outrance'));

-- the line-marshal position: side 'm' on a binding and a seat (one marshal's sheet covers both fighters)
alter table public.counter_bindings drop constraint if exists counter_bindings_side_check;
alter table public.counter_bindings add constraint counter_bindings_side_check check (side is null or side in ('a', 'b', 'm'));
alter table public.lyst_counter_seats drop constraint if exists lyst_counter_seats_side_check;
alter table public.lyst_counter_seats add constraint lyst_counter_seats_side_check check (side is null or side in ('a', 'b', 'm'));

alter table public.lyst_counts add column if not exists mark text;
alter table public.lyst_counts add column if not exists mark_side text;
alter table public.lyst_counts drop constraint if exists lyst_counts_mark_check;
alter table public.lyst_counts add constraint lyst_counts_mark_check check (
  (mark is null and mark_side is null) or (mark in ('strike', 'takedown', 'weapon_loss', 'armour_failure') and mark_side in ('a', 'b') and undo_of is null));
comment on column public.lyst_counts.mark is 'Pack 29: what a line marshal tapped (strike, takedown, weapon_loss, armour_failure); mark_side is the fighter it is for.';

alter table public.match_discipline drop constraint if exists match_discipline_kind_check;
alter table public.match_discipline add constraint match_discipline_kind_check check (kind in ('warning', 'card', 'deduction', 'dq', 'armour', 'stoppage', 'note'));

-- ================================================================ 2. tables (written only by the functions below; no client reads them directly)
create table if not exists public.outrance_sheets (
  id uuid primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  seat_id uuid not null references public.lyst_counter_seats (id) on delete cascade,
  role text not null check (role in ('official', 'learning')),
  operator_name text,
  strikes_a integer not null, strikes_b integer not null,
  takedowns_a integer not null, takedowns_b integer not null,
  weapon_losses_a integer not null, weapon_losses_b integer not null,
  armour_a integer not null, armour_b integer not null,
  calls jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz
);
create index if not exists outrance_sheets_round_idx on public.outrance_sheets (match_id, round_no) where superseded_at is null;
create unique index if not exists outrance_sheets_one_current on public.outrance_sheets (seat_id, match_id, round_no) where superseded_at is null;
alter table public.outrance_sheets enable row level security;
revoke all on public.outrance_sheets from public, anon, authenticated;

create table if not exists public.outrance_rounds (
  id uuid primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  lyst_rev integer not null,
  kind text not null check (kind in ('confirm', 'correct')),
  marshals integer not null check (marshals between 1 and 6),
  units_a integer not null, units_b integer not null,
  sheets jsonb not null,
  short boolean not null default false,
  reason text check (reason is null or char_length(reason) <= 200),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default clock_timestamp()
);
create index if not exists outrance_rounds_match_idx on public.outrance_rounds (match_id, round_no, lyst_rev);
alter table public.outrance_rounds enable row level security;
revoke all on public.outrance_rounds from public, anon, authenticated;
comment on table public.outrance_rounds is 'Pack 29: every confirmation of an Outrance round (append-only): the frozen sheets and the Round Score in sixtieths (§15.3.1).';

create table if not exists public.outrance_holds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  kind text not null check (kind in ('medic_check', 'assessment', 'equipment', 'knocked_out')),
  created_at timestamptz not null default clock_timestamp(),
  cleared_at timestamptz, cleared_by uuid, cleared_reason text check (cleared_reason is null or char_length(cleared_reason) <= 200)
);
create index if not exists outrance_holds_open_idx on public.outrance_holds (entry_id) where cleared_at is null;
alter table public.outrance_holds enable row level security;
revoke all on public.outrance_holds from public, anon, authenticated;

create table if not exists public.outrance_appeals (
  id uuid primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  lodged_by text not null check (lodged_by in ('competitor', 'corner')),
  grounds text not null check (char_length(grounds) between 3 and 500),
  lodged_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null,
  decision text check (decision is null or decision in ('upheld', 'rejected')),
  outcome text check (outcome is null or outcome in ('none', 'round_rematch', 'card_imposed', 'card_withdrawn', 'deduction_imposed', 'deduction_withdrawn')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_by uuid, decided_at timestamptz
);
alter table public.outrance_appeals enable row level security;
revoke all on public.outrance_appeals from public, anon, authenticated;

-- ================================================================ 3. the rules as functions (the same vectors as src/lib/outrance.ts)
create or replace function private.outrance_is(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select scoring = 'outrance' from public.lyst_matches where match_id = p_match), false)
$$;
create or replace function private.outrance_league(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m join public.competitions k on k.id = m.competition_id join public.ref_categories c on c.code = k.category
                 where m.id = p_match and c.league = 'outrance')
$$;

-- §4: rounds, round length, break, tiebreak, from the competition's division (1 or 2) and format; null until both are set
create or replace function private.outrance_timing(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when k.division in ('1', '2') and k.fight_format in ('tournament', 'matched') then jsonb_build_object(
      'division', k.division, 'format', k.fight_format,
      'rounds', case when k.fight_format = 'matched' then 3 else 2 end,
      'round_seconds', case when k.division = '1' then 120 else 90 end,
      'break_seconds', case when k.fight_format = 'matched' then 60 else 45 end,
      'tiebreak', k.fight_format = 'tournament') end
  from public.matches m join public.competitions k on k.id = m.competition_id where m.id = p_match
$$;

-- one sheet's round result before deductions (§15.3.1, p.25): {a, b, band, winner, decided_by}
create or replace function private.outrance_sheet_result(p_sa integer, p_sb integer, p_calls jsonb, p_stop_loser text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_gap integer := abs(p_sa - p_sb); v_lead text := case when p_sa > p_sb then 'a' else 'b' end; v_c text; v_call text; v_loser integer; v_band text;
begin
  if p_stop_loser in ('a', 'b') then
    return jsonb_build_object('a', case when p_stop_loser = 'a' then 7 else 10 end, 'b', case when p_stop_loser = 'b' then 7 else 10 end,
      'band', 'stoppage', 'winner', case when p_stop_loser = 'a' then 'b' else 'a' end, 'decided_by', null);
  end if;
  if v_gap >= 6 then
    v_loser := case when v_gap >= 16 then 7 when v_gap >= 11 then 8 else 9 end;
    v_band := case when v_gap >= 16 then 'dominant' when v_gap >= 11 then 'moderate' else 'slight' end;
    return jsonb_build_object('a', case when v_lead = 'a' then 10 else v_loser end, 'b', case when v_lead = 'b' then 10 else v_loser end, 'band', v_band, 'winner', v_lead, 'decided_by', null);
  end if;
  foreach v_c in array array['grappling', 'list_control', 'aggression', 'defence'] loop
    v_call := p_calls ->> v_c;
    if v_call in ('a', 'b') then
      return jsonb_build_object('a', case when v_call = 'a' then 10 else 9 end, 'b', case when v_call = 'b' then 10 else 9 end, 'band', 'even', 'winner', v_call, 'decided_by', v_c);
    end if;
  end loop;
  return jsonb_build_object('a', 10, 'b', 10, 'band', 'even', 'winner', null, 'decided_by', null);
end $$;

-- the criteria a marshal gave are complete and in order: answered one at a time, stopping at the first that is not Even (p.25)
create or replace function private.outrance_calls_ok(p_calls jsonb, p_needed boolean) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_c text; v_call text; v_done boolean := false; v_keys integer;
begin
  if p_calls is null or jsonb_typeof(p_calls) <> 'object' then return false; end if;
  select count(*) into v_keys from jsonb_object_keys(p_calls);
  if not p_needed then return v_keys = 0; end if;
  foreach v_c in array array['grappling', 'list_control', 'aggression', 'defence'] loop
    v_call := p_calls ->> v_c;
    if v_done then if v_call is not null then return false; end if; continue; end if;
    if v_call is null or v_call not in ('a', 'b', 'even') then return false; end if;
    if v_call in ('a', 'b') then v_done := true; end if;
  end loop;
  return (select count(*) from jsonb_object_keys(p_calls) k where k not in ('grappling', 'list_control', 'aggression', 'defence')) = 0;
end $$;

-- §15.4.2 from each marshal's own fight result ('a', 'b' or 'draw')
create or replace function private.outrance_win_type(p_results text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare n integer := coalesce(array_length(p_results, 1), 0); a integer; b integer; d integer;
begin
  if n = 0 then return null; end if;
  select count(*) filter (where x = 'a'), count(*) filter (where x = 'b'), count(*) filter (where x = 'draw') into a, b, d from unnest(p_results) x;
  if a = n or b = n then return 'unanimous_decision'; end if;
  if d = n then return 'unanimous_draw'; end if;
  if a * 2 > n then return case when b > 0 then 'split_decision' else 'majority_decision' end; end if;
  if b * 2 > n then return case when a > 0 then 'split_decision' else 'majority_decision' end; end if;
  if d * 2 > n then return 'majority_draw'; end if;
  return 'split_draw';
end $$;

-- one line marshal's tally for a round (live taps that were not undone): strikes, takedowns, weapon losses, armour failures per fighter
create or replace function private.outrance_tally(p_seat uuid, p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select c.mark, c.mark_side from public.lyst_counts c where c.seat_id = p_seat and c.match_id = p_match and c.round_no = p_round and c.mark is not null
               and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id))
  select jsonb_build_object(
    'strike', jsonb_build_object('a', count(*) filter (where mark = 'strike' and mark_side = 'a'), 'b', count(*) filter (where mark = 'strike' and mark_side = 'b')),
    'takedown', jsonb_build_object('a', count(*) filter (where mark = 'takedown' and mark_side = 'a'), 'b', count(*) filter (where mark = 'takedown' and mark_side = 'b')),
    'weapon_loss', jsonb_build_object('a', count(*) filter (where mark = 'weapon_loss' and mark_side = 'a'), 'b', count(*) filter (where mark = 'weapon_loss' and mark_side = 'b')),
    'armour_failure', jsonb_build_object('a', count(*) filter (where mark = 'armour_failure' and mark_side = 'a'), 'b', count(*) filter (where mark = 'armour_failure' and mark_side = 'b')))
  from t
$$;

-- the protocol for a round: yellow cards and armour grants per side (each −1 on every sheet), and a round-scoring stoppage (KO / TKO → 10-7)
create or replace function private.outrance_protocol(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'yellows', jsonb_build_object('a', count(*) filter (where kind = 'card' and card_key = 'yellow' and side = 'a'), 'b', count(*) filter (where kind = 'card' and card_key = 'yellow' and side = 'b')),
    'armour', jsonb_build_object('a', count(*) filter (where kind = 'armour' and side = 'a'), 'b', count(*) filter (where kind = 'armour' and side = 'b')),
    'stoppage', (select x.side from public.match_discipline x where x.match_id = p_match and x.round_no = p_round and x.voided_at is null and x.kind = 'stoppage'
                  and x.card_key in ('ko', 'tko', 'tko_round', 'tko_equipment', 'tko_stalling', 'tko_corner') order by x.created_at limit 1))
  from public.match_discipline where match_id = p_match and round_no = p_round and voided_at is null
$$;

-- a sheet with its result and score for a round, given the protocol: {seat_id, operator, role, strikes, takedowns, weapon_losses, armour, calls, result, deduct, score}
create or replace function private.outrance_sheet_json(s public.outrance_sheets, p_protocol jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_res jsonb; v_da integer; v_db integer;
begin
  v_res := private.outrance_sheet_result(s.strikes_a, s.strikes_b, s.calls, p_protocol ->> 'stoppage');
  v_da := coalesce((p_protocol -> 'yellows' ->> 'a')::int, 0) + coalesce((p_protocol -> 'armour' ->> 'a')::int, 0) + case when s.weapon_losses_a >= 3 then 1 else 0 end;
  v_db := coalesce((p_protocol -> 'yellows' ->> 'b')::int, 0) + coalesce((p_protocol -> 'armour' ->> 'b')::int, 0) + case when s.weapon_losses_b >= 3 then 1 else 0 end;
  return jsonb_build_object('sheet_id', s.id, 'seat_id', s.seat_id, 'operator', s.operator_name, 'role', s.role, 'round_no', s.round_no, 'submitted_at', s.submitted_at,
    'strikes', jsonb_build_object('a', s.strikes_a, 'b', s.strikes_b), 'takedowns', jsonb_build_object('a', s.takedowns_a, 'b', s.takedowns_b),
    'weapon_losses', jsonb_build_object('a', s.weapon_losses_a, 'b', s.weapon_losses_b), 'armour_failures', jsonb_build_object('a', s.armour_a, 'b', s.armour_b),
    'calls', s.calls, 'result', v_res, 'deduct', jsonb_build_object('a', v_da, 'b', v_db),
    'score', jsonb_build_object('a', (v_res ->> 'a')::int - v_da, 'b', (v_res ->> 'b')::int - v_db));
end $$;

-- ================================================================ 4. the line marshal's taps (inside the existing delivery pipeline)
create or replace function private.outrance_record(p_id uuid, p_seat uuid, p_round integer, p_mark text, p_side text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_old public.lyst_counts; v_n integer;
begin
  if p_mark is null or p_mark not in ('strike', 'takedown', 'weapon_loss', 'armour_failure') or p_side is null or p_side not in ('a', 'b') then
    raise exception 'say what was tapped and for which fighter' using errcode = '22023'; end if;
  select * into v_old from public.lyst_counts where id = p_id;
  if found then
    if v_old.seat_id <> p_seat or v_old.mark is distinct from p_mark or v_old.mark_side is distinct from p_side then raise exception 'that tap id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.lyst_seat_total(p_seat, v_old.round_no), 'outrance', private.outrance_tally(p_seat, v_old.match_id, v_old.round_no));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  if v_s.side is distinct from 'm' then raise exception 'only a line marshal keeps a Profight sheet' using errcode = 'P0001'; end if;
  if not private.outrance_is(v_s.match_id) then raise exception 'this fight is not a Profight: choose Red or Blue to count it' using errcode = 'P0001'; end if;
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, operator_name, mark, mark_side) values (p_id, p_seat, v_s.match_id, p_round, 1, v_s.display_name, p_mark, p_side) on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n = 1 then 'ok' else 'duplicate' end, 'total', private.lyst_seat_total(p_seat, p_round), 'outrance', private.outrance_tally(p_seat, v_s.match_id, p_round));
end $$;

-- UNDO on a line marshal's phone names what it takes back (the last tap of that mark for that fighter): what the phone showed is what is undone
create or replace function private.outrance_undo(p_id uuid, p_seat uuid, p_round integer, p_mark text, p_side text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_old public.lyst_counts; v_target uuid; v_n integer;
begin
  select * into v_old from public.lyst_counts where id = p_id;
  if found then
    if v_old.seat_id <> p_seat then raise exception 'that id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.lyst_seat_total(p_seat, v_old.round_no), 'outrance', private.outrance_tally(p_seat, v_old.match_id, v_old.round_no));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  if v_s.side is distinct from 'm' then raise exception 'only a line marshal keeps a Profight sheet' using errcode = 'P0001'; end if;
  select c.id into v_target from public.lyst_counts c
   where c.seat_id = p_seat and c.match_id = v_s.match_id and c.round_no = p_round and c.undo_of is null and c.mark = p_mark and c.mark_side = p_side
     and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id)
   order by c.created_at desc, c.id desc limit 1;
  if v_target is null then return jsonb_build_object('status', 'nothing', 'total', private.lyst_seat_total(p_seat, p_round), 'outrance', private.outrance_tally(p_seat, v_s.match_id, p_round)); end if;
  insert into public.lyst_counts (id, seat_id, match_id, round_no, weight, undo_of, operator_name) values (p_id, p_seat, v_s.match_id, p_round, 0, v_target, v_s.display_name) on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n = 1 then 'ok' else 'nothing' end, 'total', private.lyst_seat_total(p_seat, p_round), 'outrance', private.outrance_tally(p_seat, v_s.match_id, p_round));
end $$;
revoke execute on function private.outrance_record(uuid, uuid, integer, text, text), private.outrance_undo(uuid, uuid, integer, text, text) from public, anon, authenticated;

-- ================================================================ 5. the existing functions learn the line-marshal position and Outrance scoring
-- An anchored patch: the definition as it is on hosted (reconciled 2026-10-29), with one exact piece replaced. Refuses if the anchor is not there once.
create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'Pack 29 patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;

-- the position: Red, Blue or Line marshal (Profight); staff moves and trainees too
select pg_temp.bos_patch('public.counter_bind(text,text,text)'::regprocedure,
  $a$if p_side is not null and p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;$a$,
  $a$if p_side is not null and p_side not in ('a', 'b', 'm') then raise exception 'side is a (red), b (blue) or m (line marshal, Profight)' using errcode = '22023'; end if;$a$);
select pg_temp.bos_patch('public.move_counter_session(uuid,text,text)'::regprocedure,
  $a$if p_side is not null and p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;$a$,
  $a$if p_side is not null and p_side not in ('a', 'b', 'm') then raise exception 'side is a (red), b (blue) or m (line marshal, Profight)' using errcode = '22023'; end if;$a$);
select pg_temp.bos_patch('public.join_training_counter(text,text,text)'::regprocedure,
  $a$if p_side is null or p_side not in ('a', 'b') then raise exception 'side is a (red) or b (blue)' using errcode = '22023'; end if;$a$,
  $a$if p_side is null or p_side not in ('a', 'b', 'm') then raise exception 'side is a (red), b (blue) or m (line marshal, Profight)' using errcode = '22023'; end if;$a$);

-- a plain tap, undo or "done" is a side counter's: a line marshal's taps carry their mark, a Profight is never counted by side
select pg_temp.bos_patch('public.counter_record(uuid,uuid,integer,integer)'::regprocedure,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  select counter_input$a$,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  if v_s.side = 'm' then raise exception 'a line marshal''s tap says what it is and for whom: update the app on this phone' using errcode = 'P0001'; end if;
  if private.outrance_is(v_s.match_id) then raise exception 'Profight is scored by 3 or 5 line marshals: choose Line marshal on this phone' using errcode = 'P0001'; end if;
  select counter_input$a$);
select pg_temp.bos_patch('public.counter_undo(uuid,uuid,integer)'::regprocedure,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  select c.id into v_target$a$,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, true);
  if v_s.side = 'm' then raise exception 'a line marshal''s undo says what it takes back: update the app on this phone' using errcode = 'P0001'; end if;
  if private.outrance_is(v_s.match_id) then raise exception 'Profight is scored by 3 or 5 line marshals: choose Line marshal on this phone' using errcode = 'P0001'; end if;
  select c.id into v_target$a$);
select pg_temp.bos_patch('public.counter_submit(uuid,integer)'::regprocedure,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, false);
  insert into public.lyst_counter_rounds$a$,
  $a$v_s := private.lyst_seat_for_counting(p_seat, p_round, false);
  if v_s.side = 'm' or private.outrance_is(v_s.match_id) then raise exception 'a Profight round is handed in as the line marshal''s sheet' using errcode = 'P0001'; end if;
  insert into public.lyst_counter_rounds$a$);

-- on a Profight only the line-marshal phones hand in a round: a side counter there has nothing to deliver (its taps are kept for review instead)
select pg_temp.bos_patch('private.counter_confirmation_risks(uuid,integer)'::regprocedure,
  $a$where s.match_id = p_match and s.status = 'active' and s.role = 'official'
    and (c.started_at$a$,
  $a$where s.match_id = p_match and s.status = 'active' and s.role = 'official' and (s.side = 'm' or not private.outrance_is(p_match))
    and (c.started_at$a$);

-- the marshal's whole-number round entry, the duel finish and the duel discipline sheet are not the Outrance path
select pg_temp.bos_patch('public.lyst_confirm_round(uuid,uuid,integer,integer,integer,integer,integer,integer,text)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
$a$,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if private.outrance_is(p_match) then raise exception 'a Profight round is confirmed from the line marshals'' sheets (Outrance §15.3.1)' using errcode = 'P0001'; end if;
$a$);
select pg_temp.bos_patch('public.lyst_finalize(uuid,uuid,integer,text,text,text)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
$a$,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if private.outrance_is(p_match) then raise exception 'a Profight is finished with the Outrance finish (Total Fight Score, KO, TKO or disqualification)' using errcode = 'P0001'; end if;
$a$);
select pg_temp.bos_patch('public.lyst_record_discipline(uuid,uuid,integer,text,text,text,integer,text,text,uuid)'::regprocedure,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
$a$,
  $a$if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if private.outrance_is(p_match) then raise exception 'record Profight calls with the knight marshal''s calls (Outrance §13, §14)' using errcode = 'P0001'; end if;
$a$);

-- the phone's tap goes in with its mark for a line marshal; everything else in the delivery pipeline is unchanged
create or replace function public.counter_deliver_action(p_seat uuid, p_run uuid, p_action jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.lyst_counter_seats; r private.counter_runs; old public.lyst_counts; held private.counter_recovery;
  v_id uuid; kind text; w integer; reason text; result jsonb; v_mark text; v_mside text;
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
  v_mark := p_action->>'mark'; v_mside := p_action->>'markSide';
  if v_id is null or kind is null or kind not in ('tap', 'undo') or (p_action->>'round')::integer is distinct from r.round_no
     or (kind = 'tap' and (w is null or w not between 1 and 2)) then raise exception 'invalid count action' using errcode = '22023'; end if;
  -- Pack 29: a line marshal's action says what it is (strike, takedown, weapon_loss, armour_failure) and for which fighter; a side counter's never does
  if s.side = 'm' and (v_mark is null or v_mark not in ('strike', 'takedown', 'weapon_loss', 'armour_failure') or v_mside is null or v_mside not in ('a', 'b') or (kind = 'tap' and w <> 1)) then
    raise exception 'invalid count action' using errcode = '22023'; end if;
  if s.side is distinct from 'm' and (v_mark is not null or v_mside is not null) then raise exception 'invalid count action' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:counter-action:' || v_id::text, 0));

  if exists(select 1 from private.counter_legacy_evidence where id=v_id) then
    raise exception 'count ID is already retained as evidence with an unknown fight' using errcode='42501';
  end if;
  select * into old from public.lyst_counts where lyst_counts.id = v_id;
  if found then
    if old.seat_id <> p_seat or old.match_id <> r.match_id or old.round_no <> r.round_no or (old.undo_of is null) <> (kind = 'tap') or (kind = 'tap' and old.weight <> w)
       or (kind = 'tap' and (old.mark is distinct from v_mark or old.mark_side is distinct from v_mside)) then
      raise exception 'count ID was already used for different evidence' using errcode = '42501'; end if;
    if exists(select 1 from private.counter_action_runs where counter_action_runs.id=v_id and run_id<>p_run) then
      raise exception 'count ID belongs to a different run' using errcode='42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'total', private.counter_total_for(p_seat, r.match_id, r.round_no), 'weights',private.counter_weights_for(p_seat,r.match_id,r.round_no))
      || case when s.side = 'm' then jsonb_build_object('outrance', private.outrance_tally(p_seat, r.match_id, r.round_no)) else '{}'::jsonb end;
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
      if s.side = 'm' then
        if kind = 'tap' then result := private.outrance_record(v_id, p_seat, r.round_no, v_mark, v_mside);
        else result := private.outrance_undo(v_id, p_seat, r.round_no, v_mark, v_mside); end if;
      elsif kind = 'tap' then result := public.counter_record(v_id, p_seat, r.round_no, w);
      else result := public.counter_undo(v_id, p_seat, r.round_no); end if;
      select * into old from public.lyst_counts where lyst_counts.id=v_id;
      if found then
        if old.seat_id<>p_seat or old.match_id<>r.match_id or old.round_no<>r.round_no then raise exception 'count ID belongs to other evidence' using errcode='42501'; end if;
        insert into private.counter_action_runs(id,run_id,reported,received_at) values(v_id,p_run,private.counter_reported(p_action),clock_timestamp()) on conflict do nothing;
      end if;
      return result || jsonb_build_object('weights',private.counter_weights_for(p_seat,r.match_id,r.round_no));
    exception when sqlstate 'P0001' then reason := sqlerrm;
    end;
  end if;
  insert into private.counter_recovery(id, run_id, seat_id, action, reason) values (v_id, p_run, p_seat, p_action, reason);
  perform private.audit(s.event_id, 'counter.evidence_retained', r.match_id::text, jsonb_build_object('action', v_id, 'run', p_run, 'seat', p_seat, 'reason', reason));
  return jsonb_build_object('status', 'review', 'reason', reason, 'total', private.counter_total_for(p_seat, r.match_id, r.round_no));
end $function$;

-- an Outrance call keeps its own key (yellow, red, ko, tko, ...): the event's duel card list does not apply to it
select pg_temp.bos_patch('private.match_discipline_fill()'::regprocedure,
  $a$if new.kind = 'card' and new.label is not null then$a$,
  $a$if private.outrance_is(new.match_id) then
    null;   -- Pack 29: the Outrance call (outrance_call) set its own key
  elsif new.kind = 'card' and new.label is not null then$a$);

-- ================================================================ 6. the line marshal hands in the sheet
create or replace function public.outrance_submit_sheet(p_id uuid, p_seat uuid, p_round integer, p_calls jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_old public.outrance_sheets; v_t jsonb; v_needed boolean; v_sheet public.outrance_sheets;
begin
  perform private.assert_session_alive();
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_id is null then raise exception 'a sheet id is required' using errcode = '22023'; end if;
  select * into v_old from public.outrance_sheets where id = p_id;
  if found then
    if v_old.seat_id <> p_seat or (select user_id from public.lyst_counter_seats where id = p_seat) is distinct from auth.uid() then raise exception 'that sheet id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'sheet', private.outrance_sheet_json(v_old, '{}'::jsonb));
  end if;
  v_s := private.lyst_seat_for_counting(p_seat, p_round, false);
  if v_s.side is distinct from 'm' then raise exception 'only a line marshal hands in a Profight sheet' using errcode = 'P0001'; end if;
  if not private.outrance_is(v_s.match_id) then raise exception 'this fight is not a Profight' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:outrance-sheet:' || p_seat::text || ':' || p_round, 0));
  select * into v_old from public.outrance_sheets where seat_id = p_seat and match_id = v_s.match_id and round_no = p_round and superseded_at is null;
  if found then return jsonb_build_object('status', 'duplicate', 'sheet', private.outrance_sheet_json(v_old, '{}'::jsonb)); end if;
  v_t := private.outrance_tally(p_seat, v_s.match_id, p_round);
  v_needed := abs((v_t -> 'strike' ->> 'a')::int - (v_t -> 'strike' ->> 'b')::int) <= 5;
  if not private.outrance_calls_ok(coalesce(p_calls, '{}'::jsonb), v_needed) then
    raise exception '%', case when v_needed then 'the strike point difference is 5 or less: answer grappling, list control, aggression and defence in order, until one is not Even (Outrance §15.2)'
      else 'the strike point difference is more than 5: the round is decided on strikes, no criteria (Outrance §15.3.1)' end using errcode = '22023'; end if;
  insert into public.outrance_sheets (id, match_id, event_id, round_no, seat_id, role, operator_name, strikes_a, strikes_b, takedowns_a, takedowns_b, weapon_losses_a, weapon_losses_b, armour_a, armour_b, calls)
  values (p_id, v_s.match_id, v_s.event_id, p_round, p_seat, v_s.role, v_s.display_name,
          (v_t -> 'strike' ->> 'a')::int, (v_t -> 'strike' ->> 'b')::int, (v_t -> 'takedown' ->> 'a')::int, (v_t -> 'takedown' ->> 'b')::int,
          (v_t -> 'weapon_loss' ->> 'a')::int, (v_t -> 'weapon_loss' ->> 'b')::int, (v_t -> 'armour_failure' ->> 'a')::int, (v_t -> 'armour_failure' ->> 'b')::int,
          case when v_needed then p_calls else '{}'::jsonb end)
  returning * into v_sheet;
  insert into public.lyst_counter_rounds (seat_id, match_id, round_no) values (p_seat, v_s.match_id, p_round) on conflict do nothing;
  update private.counter_receipts c set seen_at = clock_timestamp(), pending = 0
   where c.seat_id = p_seat and c.run_id = (select x.id from private.counter_runs x where x.match_id = v_s.match_id and x.round_no = p_round order by x.generation desc limit 1);
  perform private.audit(v_s.event_id, 'outrance.sheet', v_s.match_id::text, jsonb_build_object('sheet', p_id, 'seat', p_seat, 'round', p_round, 'operator', v_s.display_name, 'role', v_s.role));
  return jsonb_build_object('status', 'ok', 'sheet', private.outrance_sheet_json(v_sheet, '{}'::jsonb));
end $$;

-- a sheet is handed in once per round: after that the phone's taps for that round are refused (they would not be on the sheet)
create or replace function private.outrance_sheet_open(p_seat uuid, p_match uuid, p_round integer) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.outrance_sheets where seat_id = p_seat and match_id = p_match and round_no = p_round and superseded_at is null) then
    raise exception 'your sheet for this round is handed in' using errcode = 'P0001'; end if;
end $$;
select pg_temp.bos_patch('private.outrance_record(uuid,uuid,integer,text,text)'::regprocedure,
  $a$if not private.outrance_is(v_s.match_id) then raise exception 'this fight is not a Profight: choose Red or Blue to count it' using errcode = 'P0001'; end if;$a$,
  $a$if not private.outrance_is(v_s.match_id) then raise exception 'this fight is not a Profight: choose Red or Blue to count it' using errcode = 'P0001'; end if;
  perform private.outrance_sheet_open(p_seat, v_s.match_id, p_round);$a$);
select pg_temp.bos_patch('private.outrance_undo(uuid,uuid,integer,text,text)'::regprocedure,
  $a$if v_s.side is distinct from 'm' then raise exception 'only a line marshal keeps a Profight sheet' using errcode = 'P0001'; end if;
  select c.id into v_target$a$,
  $a$if v_s.side is distinct from 'm' then raise exception 'only a line marshal keeps a Profight sheet' using errcode = 'P0001'; end if;
  perform private.outrance_sheet_open(p_seat, v_s.match_id, p_round);
  select c.id into v_target$a$);

-- RETURN FOR RECOUNT clears the round's "done" marks: the marshals' sheets for that round are superseded (kept, never deleted) and taps reopen
create or replace function private.outrance_recount() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.outrance_sheets set superseded_at = clock_timestamp() where seat_id = old.seat_id and match_id = old.match_id and round_no = old.round_no and superseded_at is null;
  return null;
end $$;
revoke execute on function private.outrance_recount() from public, anon, authenticated;
drop trigger if exists lyst_counter_rounds_outrance_recount on public.lyst_counter_rounds;
create trigger lyst_counter_rounds_outrance_recount after delete on public.lyst_counter_rounds for each row execute function private.outrance_recount();

-- ================================================================ 7. the knight marshal's calls (§13, §14), with the rules' escalations
create or replace function public.outrance_call(p_command uuid, p_match uuid, p_round integer, p_side text, p_call text, p_reason text default null, p_called_by text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_kind text; v_label text; v_key text; v_div text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if exists (select 1 from public.match_discipline where id = p_command) then
    if (select match_id from public.match_discipline where id = p_command) <> p_match then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  perform private.lyst_match_check(v_event, p_match, null);
  if not private.outrance_is(p_match) then raise exception 'this fight is not scored to the Outrance rules' using errcode = 'P0001'; end if;
  if p_side is null or p_side not in ('a', 'b') then raise exception 'say which competitor' using errcode = '22023'; end if;
  if p_round is null or p_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;
  if char_length(coalesce(p_reason, '')) > 200 or char_length(coalesce(p_called_by, '')) > 60 then raise exception 'keep the reason under 200 and the marshal''s name under 60 characters' using errcode = '22023'; end if;
  v_div := private.outrance_timing(p_match) ->> 'division';
  case p_call
    when 'warning' then v_kind := 'warning'; v_label := 'Verbal warning'; v_key := null;                          -- §13.1
    when 'yellow' then v_kind := 'card'; v_label := 'Yellow card'; v_key := 'yellow';                             -- §13.2
    when 'red' then v_kind := 'dq'; v_label := 'Red card'; v_key := 'red';                                        -- §13.4 (disruption)
    when 'armour' then v_kind := 'armour'; v_label := 'Armour repair 90 s'; v_key := null;                        -- §14.4: each 90 s granted
    when 'ko' then v_kind := 'stoppage'; v_label := 'Knockout'; v_key := 'ko';                                     -- §14.11
    when 'tko' then v_kind := 'stoppage'; v_key := case when v_div = '1' then 'tko' else 'tko_round' end;         -- §14.8: the match (Div 1) or the round (Div 2)
      v_label := case when v_div = '1' then 'TKO: lack of defence' else 'TKO: round lost (Div 2)' end;
    when 'tko_equipment' then v_kind := 'stoppage'; v_label := 'TKO: armour/weapon failure'; v_key := 'tko_equipment';  -- §14.2, §14.4
    when 'tko_stalling' then v_kind := 'stoppage'; v_label := 'TKO: stalling'; v_key := 'tko_stalling';          -- §11.4
    when 'tko_corner' then v_kind := 'stoppage'; v_label := 'TKO: corner stoppage'; v_key := 'tko_corner';        -- §6.2
    when 'yield' then v_kind := 'stoppage'; v_label := 'Competitor yields'; v_key := 'yield';                     -- §5.2
    when 'medical' then v_kind := 'stoppage'; v_label := 'Medical retirement'; v_key := 'medical';                -- §5.2, §6.2
    when 'dq_equipment' then v_kind := 'dq'; v_label := 'DQ: no weapon / armour'; v_key := 'equipment';           -- §14.10
    when 'corner_expelled' then v_kind := 'note'; v_label := 'Corner man expelled'; v_key := null;               -- §13.3 (no effect on the score)
    else raise exception 'unknown call' using errcode = '22023';
  end case;
  insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label, amount, card_key) values (p_command, p_match, v_event, p_round, p_side, v_kind, v_label, 0, v_key);
  insert into public.match_discipline_private (discipline_id, reason, called_by, recorded_by) values (p_command, nullif(btrim(coalesce(p_reason, '')), ''), nullif(btrim(coalesce(p_called_by, '')), ''), auth.uid());
  perform private.audit(v_event, 'outrance.call', p_match::text, jsonb_build_object('id', p_command, 'round', p_round, 'side', p_side, 'call', p_call, 'called_by', nullif(btrim(coalesce(p_called_by, '')), '')));
  return jsonb_build_object('status', 'ok', 'id', p_command,
    'escalated', coalesce((with recursive chain as (
                              select d.id, d.kind, d.label, 1 as depth from public.match_discipline d where d.related_id = p_command and d.card_key in ('yellow', 'red')
                              union all
                              select d.id, d.kind, d.label, c.depth + 1 from public.match_discipline d join chain c on d.related_id = c.id where d.card_key in ('yellow', 'red'))
                           select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'label', label) order by depth) from chain), '[]'::jsonb));
end $$;

-- §13.1: 3 verbal warnings escalate to a yellow card. §13.4: a second yellow card is automatically a red card (disqualification).
create or replace function private.outrance_escalate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_id uuid;
begin
  if not private.outrance_is(new.match_id) then return null; end if;
  if new.kind = 'warning' then
    select count(*) into v_n from public.match_discipline where match_id = new.match_id and side = new.side and kind = 'warning' and voided_at is null;
    if v_n > 0 and v_n % 3 = 0 then
      v_id := gen_random_uuid();
      insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label, amount, related_id, card_key) values (v_id, new.match_id, new.event_id, new.round_no, new.side, 'card', 'Yellow card', 0, new.id, 'yellow');
      insert into public.match_discipline_private (discipline_id, reason, recorded_by) values (v_id, 'Automatic: third verbal warning (Outrance §13.1)', coalesce(auth.uid(), (select recorded_by from public.match_discipline_private where discipline_id = new.id)));
    end if;
  elsif new.kind = 'card' and new.card_key = 'yellow' then
    select count(*) into v_n from public.match_discipline where match_id = new.match_id and side = new.side and kind = 'card' and card_key = 'yellow' and voided_at is null;
    if v_n >= 2 and not exists (select 1 from public.match_discipline where match_id = new.match_id and side = new.side and kind = 'dq' and card_key = 'red' and voided_at is null) then
      v_id := gen_random_uuid();
      insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label, amount, related_id, card_key) values (v_id, new.match_id, new.event_id, new.round_no, new.side, 'dq', 'Red card', 0, new.id, 'red');
      insert into public.match_discipline_private (discipline_id, reason, recorded_by) values (v_id, 'Automatic: second yellow card (Outrance §13.4)', coalesce(auth.uid(), (select recorded_by from public.match_discipline_private where discipline_id = new.id)));
    end if;
  end if;
  return null;
end $$;
-- voiding a call voids what it escalated to (the automatic card it caused), with the same audit trail
create or replace function private.outrance_void_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.voided_at is null and new.voided_at is not null and private.outrance_is(new.match_id) then
    update public.match_discipline_private p set void_reason = 'Automatic: the call it came from was voided', voided_by = coalesce(auth.uid(), p.recorded_by)
      where p.discipline_id in (select id from public.match_discipline where related_id = new.id and voided_at is null and card_key in ('yellow', 'red'));
    update public.match_discipline set voided_at = now() where related_id = new.id and voided_at is null and card_key in ('yellow', 'red');
  end if;
  return null;
end $$;
revoke execute on function private.outrance_escalate(), private.outrance_void_cascade() from public, anon, authenticated;
drop trigger if exists match_discipline_outrance_escalate on public.match_discipline;
create trigger match_discipline_outrance_escalate after insert on public.match_discipline for each row execute function private.outrance_escalate();
drop trigger if exists match_discipline_outrance_void on public.match_discipline;
create trigger match_discipline_outrance_void after update of voided_at on public.match_discipline for each row execute function private.outrance_void_cascade();

-- ================================================================ 8. the secretary confirms the round: the Round Score is the average of the sheets (§15.3.1)
create or replace function public.outrance_confirm_round(p_command uuid, p_match uuid, p_round integer, p_expected_rev integer, p_reason text default null, p_short boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_r public.lyst_rounds; v_have boolean; v_kind text; v_n integer; v_missing text; v_protocol jsonb; v_sheets jsonb; v_ua integer; v_ub integer;
  v_wa integer; v_wb integer; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_prev public.lyst_round_revisions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if exists (select 1 from public.outrance_rounds where id = p_command) then
    if (select match_id from public.outrance_rounds where id = p_command) <> p_match or (select confirmed_by from public.outrance_rounds where id = p_command) <> auth.uid() then
      raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'round', (select to_jsonb(r) - 'event_id' from public.lyst_rounds r where r.match_id = p_match and r.round_no = p_round));
  end if;
  perform private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);
  if not private.outrance_is(p_match) then raise exception 'this fight is not scored to the Outrance rules' using errcode = 'P0001'; end if;
  if p_round is null or p_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'keep the reason under 200 characters' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-round:' || p_match::text, 0));

  select * into v_r from public.lyst_rounds where match_id = p_match and round_no = p_round for update;
  v_have := found;
  if not v_have then raise exception 'round % has not been fought yet' , p_round using errcode = 'P0001'; end if;
  if coalesce(p_expected_rev, 0) is distinct from v_r.rev then return jsonb_build_object('status', 'stale', 'round', to_jsonb(v_r) - 'event_id'); end if;
  if p_round > 1 and not exists (select 1 from public.lyst_rounds where match_id = p_match and round_no = p_round - 1 and status = 'confirmed') then
    raise exception 'confirm round % first', p_round - 1 using errcode = 'P0001'; end if;
  v_kind := case when v_r.status = 'confirmed' then 'correct' else 'confirm' end;
  if v_kind = 'correct' and coalesce(char_length(v_reason), 0) < 3 then raise exception 'say why the confirmed round is being corrected' using errcode = '22023'; end if;

  -- the official sheets: one per line marshal, handed in and not superseded
  select count(*) into v_n from public.outrance_sheets s join public.lyst_counter_seats x on x.id = s.seat_id
   where s.match_id = p_match and s.round_no = p_round and s.superseded_at is null and s.role = 'official';
  select string_agg(x.display_name, ', ' order by x.requested_at) into v_missing from public.lyst_counter_seats x
   where x.match_id = p_match and x.status = 'active' and x.side = 'm' and x.role = 'official'
     and not exists (select 1 from public.outrance_sheets s where s.seat_id = x.id and s.match_id = p_match and s.round_no = p_round and s.superseded_at is null);
  if v_n = 0 then raise exception 'no line marshal has handed in a sheet for round %', p_round using errcode = 'P0001'; end if;
  if v_n > 6 then raise exception 'more than 6 sheets: end the extra line-marshal phones first' using errcode = 'P0001'; end if;
  if (v_n not in (3, 5) or v_missing is not null) then
    if not coalesce(p_short, false) then
      raise exception '%', case when v_missing is not null then format('waiting for the sheet of %s', v_missing)
        else format('Outrance needs 3 or 5 line marshals (§15.1.1): %s sheet%s handed in', v_n, case when v_n = 1 then '' else 's' end) end using errcode = 'P0001'; end if;
    if not private.can_resolve_results(v_event) then raise exception 'only the head marshal or an organizer can confirm a round without 3 or 5 line marshals' using errcode = '42501'; end if;
    if coalesce(char_length(v_reason), 0) < 3 then raise exception 'say why the round is confirmed without 3 or 5 line marshals' using errcode = '22023'; end if;
  end if;
  if private.counter_confirmation_risks(p_match, p_round) and coalesce(char_length(v_reason), 0) < 3 then
    raise exception 'Some line-marshal phones have not confirmed delivery, have pending taps, or have evidence to review. Check the phones and record the reason.' using errcode = '22023'; end if;

  v_protocol := private.outrance_protocol(p_match, p_round);
  select coalesce(jsonb_agg(private.outrance_sheet_json(s, v_protocol) order by x.requested_at, s.id), '[]'::jsonb) into v_sheets
    from public.outrance_sheets s join public.lyst_counter_seats x on x.id = s.seat_id
   where s.match_id = p_match and s.round_no = p_round and s.superseded_at is null and s.role = 'official';
  select sum((e -> 'score' ->> 'a')::int) * (60 / v_n), sum((e -> 'score' ->> 'b')::int) * (60 / v_n) into v_ua, v_ub from jsonb_array_elements(v_sheets) e;
  v_wa := least(99, greatest(0, round(v_ua / 60.0)::int)); v_wb := least(99, greatest(0, round(v_ub / 60.0)::int));

  select * into v_prev from public.lyst_round_revisions where match_id = p_match and round_no = p_round order by changed_at desc limit 1;
  update public.lyst_rounds set status = 'confirmed', awarded_a = v_wa, awarded_b = v_wb, rev = rev + 1, confirmed_at = now() where match_id = p_match and round_no = p_round returning * into v_r;
  insert into public.lyst_round_revisions (id, match_id, round_no, kind, previous_a, previous_b, awarded_a, awarded_b, recommended_a, recommended_b, counters, reason, changed_by)
  values (p_command, p_match, p_round, v_kind, case when v_kind = 'correct' then v_prev.awarded_a end, case when v_kind = 'correct' then v_prev.awarded_b end,
          v_wa, v_wb, null, null, v_sheets, v_reason, auth.uid());
  insert into public.outrance_rounds (id, match_id, event_id, round_no, lyst_rev, kind, marshals, units_a, units_b, sheets, short, reason, confirmed_by)
  values (p_command, p_match, v_event, p_round, v_r.rev, v_kind, v_n, v_ua, v_ub, v_sheets, v_n not in (3, 5) or v_missing is not null, v_reason, auth.uid());
  perform private.audit(v_event, case when v_kind = 'correct' then 'outrance.round_corrected' else 'outrance.round_confirmed' end, p_match::text,
    jsonb_build_object('round', p_round, 'marshals', v_n, 'units', jsonb_build_object('a', v_ua, 'b', v_ub), 'short', v_n not in (3, 5) or v_missing is not null, 'reason', v_reason));
  return jsonb_build_object('status', 'ok', 'kind', v_kind, 'round', to_jsonb(v_r) - 'event_id', 'units', jsonb_build_object('a', v_ua, 'b', v_ub), 'marshals', v_n);
end $$;

-- the confirmed Outrance rounds as they stand now (the latest confirmation of each round that is still confirmed)
create or replace function private.outrance_current_rounds(p_match uuid) returns setof public.outrance_rounds
language sql stable security definer set search_path = '' as $$
  select o.* from public.outrance_rounds o join public.lyst_rounds r on r.match_id = o.match_id and r.round_no = o.round_no and r.status = 'confirmed' and r.rev = o.lyst_rev
  where o.match_id = p_match order by o.round_no
$$;

-- the Total Fight Score (§15.4.1), each marshal's own fight result and the win type (§15.4.2), and what comes next (§4)
create or replace function private.outrance_totals(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t jsonb := private.outrance_timing(p_match); v_ua integer; v_ub integer; v_n integer; v_open integer; v_marshals jsonb; v_results text[]; v_next text; v_rounds integer;
begin
  select coalesce(sum(units_a), 0), coalesce(sum(units_b), 0), count(*) into v_ua, v_ub, v_n from private.outrance_current_rounds(p_match);
  select count(*) into v_open from public.lyst_rounds where match_id = p_match and status <> 'confirmed';
  with s as (select e ->> 'seat_id' as seat_id, max(e ->> 'operator') as operator, sum((e -> 'score' ->> 'a')::int) as a, sum((e -> 'score' ->> 'b')::int) as b, count(*) as rounds
             from private.outrance_current_rounds(p_match) o, jsonb_array_elements(o.sheets) e group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('seat_id', seat_id, 'operator', operator, 'a', a, 'b', b, 'rounds', rounds, 'result', case when a > b then 'a' when b > a then 'b' else 'draw' end) order by operator), '[]'::jsonb),
         array_agg(case when a > b then 'a' when b > a then 'b' else 'draw' end)
    into v_marshals, v_results from s;
  v_rounds := coalesce((v_t ->> 'rounds')::int, 0);
  v_next := case when v_t is null then null when v_open > 0 then 'confirm' when v_n < v_rounds then 'round'
                 when v_ua <> v_ub or not (v_t ->> 'tiebreak')::boolean then 'finish' when v_n = v_rounds then 'tiebreak' else 'head_marshal' end;
  return jsonb_build_object('unit', 60, 'a', v_ua, 'b', v_ub, 'rounds', v_n, 'open', v_open, 'marshals', v_marshals,
    'win_type', private.outrance_win_type(v_results), 'leader', case when v_ua > v_ub then 'a' when v_ub > v_ua then 'b' end, 'next', v_next);
end $$;

-- ================================================================ 9. finishing the fight
create or replace function public.outrance_finish(p_command uuid, p_match uuid, p_expected_version integer, p_basis text, p_result text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_t jsonb; v_tot jsonb; v_loser text; v_win_type text; v_detail jsonb; v_out jsonb; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_comp uuid; v_entry uuid; r record;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) or not private.can_score_match(p_match) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if exists (select 1 from public.result_proposals where id = p_command) then
    return public.submit_match_result(p_command, p_match, p_result, 0, 0, '{}'::jsonb, coalesce(p_expected_version, 0));
  end if;
  if not private.outrance_is(p_match) then raise exception 'this fight is not scored to the Outrance rules' using errcode = 'P0001'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_basis is null or p_basis not in ('decision', 'head_marshal', 'ko', 'tko', 'tko_equipment', 'tko_stalling', 'tko_corner', 'yield', 'medical', 'dq') then raise exception 'unknown finish' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'keep the reason under 200 characters' using errcode = '22023'; end if;
  select * into v_m from public.matches where id = p_match;
  v_t := private.outrance_timing(p_match);
  v_tot := private.outrance_totals(p_match);
  if p_basis in ('decision', 'head_marshal') then
    if (v_tot ->> 'open')::int > 0 then raise exception 'confirm every round before finishing on the score' using errcode = 'P0001'; end if;
    if p_basis = 'decision' then
      if (v_tot ->> 'next') = 'round' then raise exception 'this fight has % rounds (Outrance §4): % confirmed', v_t ->> 'rounds', v_tot ->> 'rounds' using errcode = 'P0001'; end if;
      if (v_tot ->> 'next') = 'tiebreak' then raise exception 'level after % rounds: fight the 3rd round (Outrance §4.2)', v_t ->> 'rounds' using errcode = 'P0001'; end if;
      if (v_tot ->> 'next') = 'head_marshal' then raise exception 'still level after the 3rd round: the head marshal records the decision' using errcode = 'P0001'; end if;
      if p_result is distinct from coalesce(v_tot ->> 'leader', 'draw') then raise exception 'the Total Fight Score does not support that result (Outrance §15.4.1)' using errcode = 'P0001'; end if;
    else
      if (v_tot ->> 'next') is distinct from 'head_marshal' then raise exception 'the head marshal decides only a tournament fight still level after the 3rd round' using errcode = 'P0001'; end if;
      if not private.can_resolve_results(v_event) then raise exception 'only the head marshal or an organizer records this decision' using errcode = '42501'; end if;
      if coalesce(char_length(v_reason), 0) < 3 then raise exception 'say how the head marshal decided' using errcode = '22023'; end if;
    end if;
    v_win_type := v_tot ->> 'win_type';
  else
    if p_result = 'draw' then raise exception 'a stoppage or a disqualification has a winner' using errcode = '22023'; end if;
    v_loser := case when p_result = 'a' then 'b' else 'a' end;
    if p_basis = 'dq' then
      if not exists (select 1 from public.match_discipline where match_id = p_match and kind = 'dq' and side = v_loser and voided_at is null) then raise exception 'record the red card or the disqualification first' using errcode = 'P0001'; end if;
    elsif not exists (select 1 from public.match_discipline where match_id = p_match and kind = 'stoppage' and card_key = p_basis and side = v_loser and voided_at is null) then
      raise exception '%', case when p_basis = 'tko' and (v_t ->> 'division') = '2' then 'in Division 2 a TKO for lack of defence loses the round, not the fight (Outrance §14.8)' else 'record the stoppage first' end using errcode = 'P0001';
    end if;
    v_win_type := case when p_basis = 'ko' then 'ko' when p_basis like 'tko%' then 'tko' else p_basis end;
  end if;
  v_detail := jsonb_build_object('kind', 'outrance', 'rules', 'Outrance Rules and Regulations V.26.4', 'division', v_t ->> 'division', 'format', v_t ->> 'format',
    'method', p_basis, 'win_type', v_win_type, 'reason', v_reason, 'unit', 60,
    'totals', jsonb_build_object('a', (v_tot ->> 'a')::int, 'b', (v_tot ->> 'b')::int, 'score_a', round((v_tot ->> 'a')::numeric / 60, 3), 'score_b', round((v_tot ->> 'b')::numeric / 60, 3)),
    'marshals', v_tot -> 'marshals',
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', o.round_no, 'marshals', o.marshals, 'a', o.units_a, 'b', o.units_b, 'short', o.short, 'reason', o.reason, 'sheets', o.sheets) order by o.round_no)
                        from private.outrance_current_rounds(p_match) o), '[]'::jsonb),
    'discipline', coalesce((select jsonb_agg(jsonb_build_object('round', round_no, 'side', side, 'kind', kind, 'key', card_key, 'label', label) order by created_at)
                        from public.match_discipline where match_id = p_match and voided_at is null), '[]'::jsonb));
  v_out := public.submit_match_result(p_command, p_match, p_result, greatest(0, round((v_tot ->> 'a')::int / 60.0)::int), greatest(0, round((v_tot ->> 'b')::int / 60.0)::int), v_detail, p_expected_version);
  if v_out ->> 'status' = 'accepted' and not coalesce((v_out ->> 'repeat')::boolean, false) then
    -- §14.8, §14.10, §14.11, §5.2, §6.2: what a fighter must clear before their next fight in this competition
    v_comp := v_m.competition_id;
    for r in select distinct d.side, case when d.kind = 'dq' and d.card_key = 'equipment' then 'equipment' when d.card_key = 'ko' then 'knocked_out'
                                          when d.card_key in ('tko', 'tko_round', 'tko_equipment', 'tko_stalling') then 'medic_check' else 'assessment' end as hold
             from public.match_discipline d where d.match_id = p_match and d.voided_at is null
              and ((d.kind = 'stoppage' and d.card_key in ('ko', 'tko', 'tko_round', 'tko_equipment', 'tko_stalling', 'tko_corner', 'yield', 'medical')) or (d.kind = 'dq' and d.card_key = 'equipment')) loop
      v_entry := case when r.side = 'a' then v_m.entry_a else v_m.entry_b end;
      if v_entry is not null then
        insert into public.outrance_holds (event_id, competition_id, entry_id, match_id, kind) values (v_event, v_comp, v_entry, p_match, r.hold);
      end if;
    end loop;
  end if;
  return v_out;
end $$;

-- clearing a hold: the medic check or assessment is done, or the equipment is fixed (§14.10). A KO is never cleared (§14.11): withdraw the entry.
create or replace function public.outrance_clear_hold(p_hold uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_h public.outrance_holds;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_h from public.outrance_holds where id = p_hold for update;
  if not found then raise exception 'hold not found' using errcode = 'P0002'; end if;
  if not (private.can_resolve_results(v_h.event_id) or private.has_event_role(v_h.event_id, array['medic'])) then raise exception 'only the head marshal, an organizer or the medic can clear this' using errcode = '42501'; end if;
  if v_h.kind = 'knocked_out' then raise exception 'a fighter who lost by KO takes no further part in the tournament (Outrance §14.11): withdraw the entry' using errcode = 'P0001'; end if;
  if v_h.cleared_at is not null then return jsonb_build_object('status', 'duplicate'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 or char_length(p_reason) > 200 then raise exception 'say what was checked (3 to 200 characters)' using errcode = '22023'; end if;
  update public.outrance_holds set cleared_at = clock_timestamp(), cleared_by = auth.uid(), cleared_reason = btrim(p_reason) where id = p_hold;
  perform private.audit(v_h.event_id, 'outrance.hold_cleared', v_h.entry_id::text, jsonb_build_object('hold', p_hold, 'kind', v_h.kind, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'ok');
end $$;

-- ================================================================ 10. appeals (§16)
create or replace function public.outrance_appeal(p_command uuid, p_match uuid, p_side text, p_lodged_by text, p_grounds text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) or not private.can_view_match(p_match) then raise exception 'you cannot record an appeal here' using errcode = '42501'; end if;
  if exists (select 1 from public.outrance_appeals where id = p_command) then return jsonb_build_object('status', 'duplicate', 'id', p_command); end if;
  if not private.outrance_is(p_match) then raise exception 'this fight is not scored to the Outrance rules' using errcode = 'P0001'; end if;
  if p_side not in ('a', 'b') or p_lodged_by not in ('competitor', 'corner') then raise exception 'say whose appeal and who lodged it' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_grounds, ''))) < 3 or char_length(p_grounds) > 500 then raise exception 'write the grounds of the appeal (3 to 500 characters)' using errcode = '22023'; end if;
  select * into v_m from public.matches where id = p_match;
  -- §16.3: the competitor appeals at the end of the fight, before leaving the list; the corner men no later than 15 minutes after the fight
  if v_m.queue_state = 'final' and (p_lodged_by = 'competitor' or v_m.finalized_at < clock_timestamp() - interval '15 minutes') then
    raise exception '%', case when p_lodged_by = 'competitor' then 'a competitor appeals at the end of the fight, before leaving the list (Outrance §16.3)'
      else 'the corner men''s appeal must be announced no later than 15 minutes after the fight (Outrance §16.3)' end using errcode = 'P0001'; end if;
  insert into public.outrance_appeals (id, match_id, event_id, side, lodged_by, grounds, recorded_by) values (p_command, p_match, v_event, p_side, p_lodged_by, btrim(p_grounds), auth.uid());
  perform private.audit(v_event, 'outrance.appeal', p_match::text, jsonb_build_object('id', p_command, 'side', p_side, 'lodged_by', p_lodged_by));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

create or replace function public.outrance_appeal_decide(p_appeal uuid, p_decision text, p_outcome text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.outrance_appeals;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_a from public.outrance_appeals where id = p_appeal for update;
  if not found then raise exception 'appeal not found' using errcode = 'P0002'; end if;
  if not private.can_resolve_results(v_a.event_id) then raise exception 'only the head marshal or an organizer decides an appeal' using errcode = '42501'; end if;
  if v_a.decided_at is not null then return jsonb_build_object('status', 'duplicate'); end if;
  if p_decision not in ('upheld', 'rejected') then raise exception 'the appeal is upheld or rejected' using errcode = '22023'; end if;
  if p_outcome is null or p_outcome not in ('none', 'round_rematch', 'card_imposed', 'card_withdrawn', 'deduction_imposed', 'deduction_withdrawn') or (p_decision = 'rejected' and p_outcome <> 'none') or (p_decision = 'upheld' and p_outcome = 'none') then
    raise exception 'the outcome of an upheld appeal is a round rematch, a card or a point deduction imposed or withdrawn (Outrance §16.4)' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 or char_length(p_note) > 500 then raise exception 'write the decision (3 to 500 characters)' using errcode = '22023'; end if;
  update public.outrance_appeals set decision = p_decision, outcome = p_outcome, decision_note = btrim(p_note), decided_by = auth.uid(), decided_at = clock_timestamp() where id = p_appeal;
  perform private.audit(v_a.event_id, 'outrance.appeal_decided', v_a.match_id::text, jsonb_build_object('id', p_appeal, 'decision', p_decision, 'outcome', p_outcome));
  return jsonb_build_object('status', 'ok');
end $$;

-- ================================================================ 11. opening a Profight on the Lyst
create or replace function public.lyst_open(p_match uuid, p_counter_input text default 'simple') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches; v_key text; v_out boolean; v_hold record;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_counter_input is null or p_counter_input not in ('simple', 'weighted', 'standing') then raise exception 'counter input is simple, weighted or standing' using errcode = '22023'; end if;
  v_m := private.lyst_match_check(v_event, p_match, null);
  perform private.lyst_lock_live_match(p_match);   -- race guard 20261023000100
  v_out := private.outrance_league(p_match);
  if v_out then
    -- Pack 29: a Profight is scored to the Outrance rules: its division and format set the rounds (§4); a fighter with an open hold does not fight
    if private.outrance_timing(p_match) is null then
      raise exception 'set this Profight competition''s division (1 or 2) and format (tournament or matched fight) first (Outrance §1.3, §4)' using errcode = 'P0001'; end if;
    select h.kind, private.lyst_side_name(h.entry_id) as who into v_hold from public.outrance_holds h
     where h.cleared_at is null and h.competition_id = v_m.competition_id and h.entry_id in (v_m.entry_a, v_m.entry_b) order by h.created_at limit 1;
    if found then
      raise exception '%', case v_hold.kind
        when 'knocked_out' then format('%s lost by KO and takes no further part in the tournament (Outrance §14.11): withdraw the entry', v_hold.who)
        when 'medic_check' then format('%s needs the medic''s check after a TKO before fighting again (Outrance §14.8)', v_hold.who)
        when 'equipment' then format('%s must show fixed equipment before fighting again (Outrance §14.10)', v_hold.who)
        else format('%s needs the medic''s and head marshal''s assessment before fighting again (Outrance §5.2, §6.2)', v_hold.who) end using errcode = 'P0001';
    end if;
    p_counter_input := 'simple';
  end if;
  v_key := private.field_key(v_m.field);
  insert into public.lyst_matches (match_id, event_id, field_key, counter_input, scoring) values (p_match, v_event, v_key, p_counter_input, case when v_out then 'outrance' else 'marshal' end)
  on conflict (match_id) do update set scoring = excluded.scoring where v_out and public.lyst_matches.scoring <> 'outrance';
  perform private.lyst_field_claim(v_event, v_key, p_match, 'open');
  perform private.counter_rebind_field(v_event, v_key, p_match);
  return jsonb_build_object('status', 'ok', 'match_id', p_match, 'counter_input', (select counter_input from public.lyst_matches where match_id = p_match),
    'scoring', (select scoring from public.lyst_matches where match_id = p_match), 'outrance', private.outrance_timing(p_match));
end $$;

-- ================================================================ 12. what the tablet and the phone see
-- the tablet (staff): every sheet, the Round Scores, the Total Fight Score, the marshals' results, what comes next, holds and appeals
create or replace function private.outrance_state(p_match uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not private.outrance_is(p_match) then null else jsonb_build_object(
    'rules', 'Outrance Rules and Regulations V.26.4',
    'timing', private.outrance_timing(p_match),
    'sheets', coalesce((select jsonb_agg(private.outrance_sheet_json(s, private.outrance_protocol(p_match, s.round_no)) order by s.round_no, x.requested_at, s.id)
                        from public.outrance_sheets s join public.lyst_counter_seats x on x.id = s.seat_id where s.match_id = p_match and s.superseded_at is null), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_no', o.round_no, 'marshals', o.marshals, 'a', o.units_a, 'b', o.units_b, 'short', o.short, 'reason', o.reason, 'confirmed_at', o.confirmed_at) order by o.round_no)
                        from private.outrance_current_rounds(p_match) o), '[]'::jsonb),
    'protocol', coalesce((select jsonb_agg(private.outrance_protocol(p_match, r.round_no) || jsonb_build_object('round_no', r.round_no) order by r.round_no) from public.lyst_rounds r where r.match_id = p_match), '[]'::jsonb),
    'totals', private.outrance_totals(p_match),
    'holds', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'side', case when h.entry_id = m.entry_a then 'a' else 'b' end, 'kind', h.kind, 'created_at', h.created_at, 'from_match', h.match_id) order by h.created_at)
                       from public.matches m join public.outrance_holds h on h.competition_id = m.competition_id and h.entry_id in (m.entry_a, m.entry_b) and h.cleared_at is null where m.id = p_match), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'side', a.side, 'lodged_by', a.lodged_by, 'grounds', a.grounds, 'lodged_at', a.lodged_at, 'decision', a.decision, 'outcome', a.outcome, 'decision_note', a.decision_note) order by a.lodged_at)
                        from public.outrance_appeals a where a.match_id = p_match), '[]'::jsonb)) end
$$;

-- the phone: a line marshal sees ONLY their own sheet (§2.3): the tally, the last tap (what UNDO takes back), whether the criteria are needed, the sheet once handed in.
-- A side counter on a Profight (or a line marshal on another fight) is told which position this fight needs.
create or replace function private.outrance_phone(p_seat uuid, p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.lyst_counter_seats; v_m public.matches; v_round integer; v_t jsonb; v_sheet public.outrance_sheets; v_last_mark text; v_last_side text; v_is boolean;
begin
  if p_seat is null or p_match is null then return null; end if;
  select * into v_s from public.lyst_counter_seats where id = p_seat;
  v_is := private.outrance_is(p_match);
  if not v_is then return case when v_s.side = 'm' then jsonb_build_object('position', 'wrong', 'need', 'side') end; end if;
  if v_s.side is distinct from 'm' then return jsonb_build_object('position', 'wrong', 'need', 'line_marshal'); end if;
  select * into v_m from public.matches where id = p_match;
  select max(round_no) into v_round from public.lyst_rounds where match_id = p_match;
  v_t := case when v_round is null then null else private.outrance_tally(p_seat, p_match, v_round) end;
  if v_round is not null then
    select * into v_sheet from public.outrance_sheets where seat_id = p_seat and match_id = p_match and round_no = v_round and superseded_at is null;
    select c.mark, c.mark_side into v_last_mark, v_last_side from public.lyst_counts c where c.seat_id = p_seat and c.match_id = p_match and c.round_no = v_round and c.mark is not null
       and not exists (select 1 from public.lyst_counts u where u.undo_of = c.id) order by c.created_at desc, c.id desc limit 1;
  end if;
  return jsonb_build_object('position', 'ok', 'round_no', v_round,
    'fighters', jsonb_build_object('a', private.lyst_side_name(v_m.entry_a), 'b', private.lyst_side_name(v_m.entry_b)),
    'tally', v_t, 'last', case when v_last_mark is null then null else jsonb_build_object('mark', v_last_mark, 'side', v_last_side) end,
    'needs_criteria', case when v_t is null then null else abs((v_t -> 'strike' ->> 'a')::int - (v_t -> 'strike' ->> 'b')::int) <= 5 end,
    'sheet', case when v_sheet.id is null then null else private.outrance_sheet_json(v_sheet, '{}'::jsonb) end,
    'timing', private.outrance_timing(p_match));
end $$;

select pg_temp.bos_patch('public.lyst_state(uuid)'::regprocedure,
  $a$order by c.created_at desc limit 1));$a$,
  $a$order by c.created_at desc limit 1)) || jsonb_build_object('outrance', private.outrance_state(p_match));$a$);
select pg_temp.bos_patch('public.lyst_state(uuid)'::regprocedure,
  $a$jsonb_build_object('id', d.id, 'round_no', d.round_no, 'side', d.side, 'kind', d.kind, 'label', d.label,$a$,
  $a$jsonb_build_object('id', d.id, 'round_no', d.round_no, 'side', d.side, 'kind', d.kind, 'label', d.label, 'key', d.card_key,$a$);
select pg_temp.bos_patch('private.counter_state_for(uuid,boolean)'::regprocedure,
  $a$'server_now', clock_timestamp()));$a$,
  $a$'server_now', clock_timestamp(), 'outrance', case when v_s.id is not null and v_s.match_id = v_match then private.outrance_phone(v_s.id, v_match) end));$a$);

-- ================================================================ 13. setting a Profight competition up (§1.3, §4)
drop function if exists public.set_profight_format(uuid, text, text);   -- an earlier draft of this pack (never on hosted)
create or replace function public.set_profight_format(p_competition uuid, p_division text, p_format text, p_weight_class text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_wc text := nullif(btrim(coalesce(p_weight_class, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not (private.is_organizer(v_k.event_id) or private.can_resolve_results(v_k.event_id)) then raise exception 'only an organizer or the head marshal sets this' using errcode = '42501'; end if;
  if not exists (select 1 from public.ref_categories c where c.code = v_k.category and c.league = 'outrance') then raise exception 'only a Profight competition has an Outrance division and format' using errcode = '22023'; end if;
  if p_division is null or p_division not in ('1', '2') then raise exception 'division is 1 or 2 (Outrance §1.3)' using errcode = '22023'; end if;
  if p_format is null or p_format not in ('tournament', 'matched') then raise exception 'format is tournament or matched fight (Outrance §4)' using errcode = '22023'; end if;
  -- §1.2: the weight class (men 6, women 5) or none for an open-weight competition (§1.2.3); the class must fit the competition's division (checked by its trigger)
  if v_wc is not null and not exists (select 1 from public.ref_weight_classes w where w.code = v_wc) then raise exception 'unknown weight class' using errcode = '22023'; end if;
  if (v_k.division is distinct from p_division or v_k.fight_format is distinct from p_format or v_k.weight_class is distinct from v_wc)
     and exists (select 1 from public.lyst_rounds r join public.matches m on m.id = r.match_id where m.competition_id = p_competition) then
    raise exception 'fights in this competition have started: the division, format and weight class can no longer change' using errcode = 'P0001'; end if;
  update public.competitions set division = p_division, fight_format = p_format, weight_class = v_wc where id = p_competition;
  perform private.audit(v_k.event_id, 'outrance.format', p_competition::text, jsonb_build_object('division', p_division, 'format', p_format, 'weight_class', v_wc,
    'previous', jsonb_build_object('division', v_k.division, 'format', v_k.fight_format, 'weight_class', v_k.weight_class)));
  return jsonb_build_object('status', 'ok', 'division', p_division, 'format', p_format, 'weight_class', v_wc);
end $$;

-- ================================================================ 14. permissions
revoke execute on function private.outrance_is(uuid), private.outrance_league(uuid), private.outrance_timing(uuid), private.outrance_sheet_result(integer, integer, jsonb, text),
  private.outrance_calls_ok(jsonb, boolean), private.outrance_win_type(text[]), private.outrance_tally(uuid, uuid, integer), private.outrance_protocol(uuid, integer),
  private.outrance_sheet_json(public.outrance_sheets, jsonb), private.outrance_sheet_open(uuid, uuid, integer), private.outrance_current_rounds(uuid), private.outrance_totals(uuid),
  private.outrance_state(uuid), private.outrance_phone(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.outrance_submit_sheet(uuid, uuid, integer, jsonb), public.outrance_call(uuid, uuid, integer, text, text, text, text),
  public.outrance_confirm_round(uuid, uuid, integer, integer, text, boolean), public.outrance_finish(uuid, uuid, integer, text, text, text),
  public.outrance_clear_hold(uuid, text), public.outrance_appeal(uuid, uuid, text, text, text), public.outrance_appeal_decide(uuid, text, text, text),
  public.set_profight_format(uuid, text, text, text) from public, anon;
grant execute on function public.outrance_submit_sheet(uuid, uuid, integer, jsonb) to authenticated, bos_event_device;
grant execute on function public.outrance_call(uuid, uuid, integer, text, text, text, text), public.outrance_confirm_round(uuid, uuid, integer, integer, text, boolean),
  public.outrance_finish(uuid, uuid, integer, text, text, text), public.outrance_clear_hold(uuid, text), public.outrance_appeal(uuid, uuid, text, text, text),
  public.outrance_appeal_decide(uuid, text, text, text), public.set_profight_format(uuid, text, text, text) to authenticated;
-- lyst_open and counter_deliver_action are replaced in place: CREATE OR REPLACE keeps their grants as they were.

-- ================================================================ 14b. the Profight standings (§17): win/loss record within the weight class
-- Official fights only (match_sides: final, both sides, no synthetic or stats-excluded event). No fight for 1 year: "retired"; for 2 years: not in
-- the standings (the record itself is never deleted). One row per fighter per weight class; `current` marks the class of their latest Profight.
create or replace view public.profight_standings with (security_invoker = true) as
  with r as (
    select fr.fighter_id, fr.gender, k.weight_class, fr.outcome, coalesce(fr.finalized_at, fr.event_ends_on::timestamptz) as at
      from public.fighter_match_rows fr join public.competitions k on k.id = fr.competition_id
     where fr.category = 'profight'),
  latest as (select distinct on (fighter_id) fighter_id, weight_class from r order by fighter_id, at desc nulls last),
  g as (
    select r.fighter_id, r.gender, r.weight_class, count(*) as fights, count(*) filter (where r.outcome = 'win') as wins,
           count(*) filter (where r.outcome = 'loss') as losses, count(*) filter (where r.outcome = 'draw') as draws, max(r.at) as last_fight_at
      from r group by r.fighter_id, r.gender, r.weight_class)
  select g.fighter_id, f.display_name, g.gender, g.weight_class, coalesce(w.name, 'Open weight') as weight_class_name, w.sort as weight_class_sort,
         g.fights, g.wins, g.losses, g.draws, g.last_fight_at,
         case when g.last_fight_at < now() - interval '1 year' then 'retired' else 'active' end as status,
         (l.weight_class is not distinct from g.weight_class) as current,
         case when g.last_fight_at >= now() - interval '1 year' then
           rank() over (partition by g.gender, g.weight_class, (g.last_fight_at >= now() - interval '1 year') order by g.wins desc, g.losses asc, g.fights desc) end as rank
    from g join public.fighters f on f.id = g.fighter_id
    left join public.ref_weight_classes w on w.code = g.weight_class
    left join latest l on l.fighter_id = g.fighter_id
   where g.last_fight_at >= now() - interval '2 years';
comment on view public.profight_standings is 'Pack 29, Outrance §17: Profight win/loss records by weight class (official, non-synthetic fights). Retired after 1 year without a fight; out of the standings after 2.';
revoke all on public.profight_standings from public, anon, authenticated;
grant select on public.profight_standings to anon, authenticated;

-- ================================================================ 15. in flight: a Profight already open on a Lyst is scored to the Outrance rules from now on
update public.lyst_matches lm set scoring = 'outrance'
  from public.matches m where m.id = lm.match_id and m.queue_state <> 'final' and lm.scoring <> 'outrance' and private.outrance_league(m.id);

reset check_function_bodies;
