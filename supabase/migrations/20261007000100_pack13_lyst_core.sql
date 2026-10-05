-- Pack 13 (2026-10-07), part 1 of 2: LYST CONTROL core. Additive.
--
-- THE MARSHAL HAS FINAL SPORTING AUTHORITY. BuhurtOS records what the marshal decides; it never decides for them.
--   * OFFICIAL data = what the person operating the lyst tablet records as the marshal's call: the awarded score of a round (lyst_rounds),
--     official point deductions / warnings / cards / disqualifications (match_discipline), and the timer state (lyst_timer).
--   * PROVISIONAL data = what counters tally (part 2). It is evidence for the humans reconciling at the end of the round. It is never read by any
--     function that produces an official score, a result, a ranking, a bracket move, a notification or public state.
--   * The final result is still a human decision (Pack 03 / 09C finalization): a timer reaching zero or counters agreeing decides nothing.
--
-- What is new here (nothing existing is changed):
--   event_lyst_settings   per event: timer presets, card vocabulary, deduction amounts (starting values; organizers set them per ruleset)
--   lyst_matches          a match run through Lyst Control (counter input style)
--   lyst_timer            ONE authoritative timer per (event, field): clients derive the countdown from server state, never from setInterval
--   lyst_rounds           the official awarded score of each round + its state (running / confirming / confirmed), with a revision log
--   lyst_round_revisions  append-only: every confirmation and correction, with the counters' snapshot and the marshal's reason (staff only)
--   match_discipline(+_private)  structured warnings / cards / deductions / DQ; public columns carry no account ids, reasons or notes
--   views lyst_round_scores   official round scores (awarded minus deductions), public for published events
-- Every write is a controlled function (no client table grants). Realtime: the public tables join supabase_realtime.

-- ---------------------------------------------------------------- 1. settings
create table if not exists public.event_lyst_settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) <= 8192),
  updated_at timestamptz not null default now()
);
alter table public.event_lyst_settings enable row level security;
create policy event_lyst_settings_read on public.event_lyst_settings for select to authenticated using (private.can_score(event_id));
grant select on public.event_lyst_settings to authenticated;
revoke insert, update, delete on public.event_lyst_settings from public, anon, authenticated;
comment on table public.event_lyst_settings is 'Pack 13: per-event Lyst Control settings. Starting values only: organizers set the durations and vocabulary their ruleset uses.';

-- Starting values taken from the operating description and the repository''s own rules text (duel rounds 1:00 and 0:30 breaks; Profight 2:00 rounds with 1:00
-- breaks is one example of an organization setting it differently). They are PRESETS, not rules: every number is editable per event.
create or replace function private.lyst_default_settings() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'presets', jsonb_build_array(
      jsonb_build_object('key', 'fight', 'label', 'Round', 'seconds', 60, 'kind', 'fight'),
      jsonb_build_object('key', 'break', 'label', 'Break', 'seconds', 30, 'kind', 'break'),
      jsonb_build_object('key', 'long_break', 'label', 'Long break', 'seconds', 180, 'kind', 'extended_break'),
      jsonb_build_object('key', 'dq', 'label', 'DQ countdown', 'seconds', 60, 'kind', 'dq'),
      jsonb_build_object('key', 'equipment', 'label', 'Equipment', 'seconds', 60, 'kind', 'equipment')),
    'auto_break', false,
    -- rounds fought at the full length; later rounds (a duel that is not yet decided) use the shorter extra length. The Duels rules text in this repository
    -- says two rounds, then extra rounds until one fighter leads by 2: these two numbers are that rule as settings, so another ruleset can change them.
    'regular_rounds', 2,
    'extra_round_seconds', 30,
    'counter_input', 'auto',
    'cards', '[]'::jsonb,
    'deduction_amounts', jsonb_build_array(1, 2, 3),
    'reasons', jsonb_build_array('Unsafe conduct', 'Illegal strike', 'Equipment', 'Conduct', 'Other'))
$$;

create or replace function private.lyst_settings_for(p_event uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.lyst_default_settings() || coalesce((select s.settings from public.event_lyst_settings s where s.event_id = p_event), '{}'::jsonb)
$$;
revoke execute on function private.lyst_default_settings(), private.lyst_settings_for(uuid) from public, anon, authenticated;

-- Organizers and head marshals set them. Validated shape; unknown keys refused.
create or replace function public.set_lyst_settings(p_event uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k text; v_p jsonb; v_clean jsonb := '{}'::jsonb; v_n integer; v_c jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.can_resolve_results(p_event) then raise exception 'only the head marshal or an organizer can change the lyst settings' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_settings, 'null'::jsonb)) <> 'object' then raise exception 'send the settings as an object' using errcode = '22023'; end if;
  for v_k in select jsonb_object_keys(p_settings) loop
    if v_k not in ('presets', 'auto_break', 'regular_rounds', 'extra_round_seconds', 'counter_input', 'cards', 'deduction_amounts', 'reasons') then raise exception 'unknown setting: %', v_k using errcode = '22023'; end if;
  end loop;
  if p_settings ? 'presets' then
    if jsonb_typeof(p_settings -> 'presets') <> 'array' or jsonb_array_length(p_settings -> 'presets') not between 1 and 12 then raise exception 'give 1 to 12 timer presets' using errcode = '22023'; end if;
    for v_p in select * from jsonb_array_elements(p_settings -> 'presets') loop
      if coalesce(v_p ->> 'key', '') !~ '^[a-z0-9_]{1,24}$' or char_length(coalesce(v_p ->> 'label', '')) not between 1 and 30
         or coalesce(v_p ->> 'kind', '') not in ('fight', 'break', 'extended_break', 'dq', 'equipment', 'custom')
         or coalesce(v_p ->> 'seconds', '') !~ '^\d{1,4}$' or (v_p ->> 'seconds')::int not between 1 and 3600 then
        raise exception 'each preset needs a key, a label (30 characters at most), a kind and 1 to 3600 seconds' using errcode = '22023'; end if;
    end loop;
    v_clean := v_clean || jsonb_build_object('presets', p_settings -> 'presets');
  end if;
  if p_settings ? 'auto_break' then
    if jsonb_typeof(p_settings -> 'auto_break') <> 'boolean' then raise exception 'auto_break is yes or no' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('auto_break', p_settings -> 'auto_break');
  end if;
  if p_settings ? 'regular_rounds' then
    if jsonb_typeof(p_settings -> 'regular_rounds') <> 'number' or (p_settings ->> 'regular_rounds') !~ '^\d{1,2}$' or (p_settings ->> 'regular_rounds')::int not between 1 and 20 then raise exception 'regular rounds is a whole number from 1 to 20' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('regular_rounds', p_settings -> 'regular_rounds');
  end if;
  if p_settings ? 'extra_round_seconds' then
    if jsonb_typeof(p_settings -> 'extra_round_seconds') <> 'number' or (p_settings ->> 'extra_round_seconds') !~ '^\d{1,4}$' or (p_settings ->> 'extra_round_seconds')::int not between 1 and 3600 then raise exception 'extra round length is 1 to 3600 seconds' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('extra_round_seconds', p_settings -> 'extra_round_seconds');
  end if;
  if p_settings ? 'counter_input' then
    if coalesce(p_settings ->> 'counter_input', '') not in ('auto', 'simple', 'weighted') then raise exception 'counter input is auto, simple or weighted' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('counter_input', p_settings -> 'counter_input');
  end if;
  if p_settings ? 'cards' then
    if jsonb_typeof(p_settings -> 'cards') <> 'array' or jsonb_array_length(p_settings -> 'cards') > 8 then raise exception 'give at most 8 card types' using errcode = '22023'; end if;
    for v_c in select * from jsonb_array_elements(p_settings -> 'cards') loop
      if coalesce(v_c ->> 'key', '') !~ '^[a-z0-9_]{1,24}$' or char_length(coalesce(v_c ->> 'label', '')) not between 1 and 30 then raise exception 'each card type needs a key and a label' using errcode = '22023'; end if;
    end loop;
    v_clean := v_clean || jsonb_build_object('cards', p_settings -> 'cards');
  end if;
  if p_settings ? 'deduction_amounts' then
    if jsonb_typeof(p_settings -> 'deduction_amounts') <> 'array' or jsonb_array_length(p_settings -> 'deduction_amounts') not between 1 and 6
       or exists (select 1 from jsonb_array_elements_text(p_settings -> 'deduction_amounts') x where x !~ '^\d{1,2}$' or x::int not between 1 and 10) then
      raise exception 'deduction amounts are 1 to 6 whole numbers between 1 and 10' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('deduction_amounts', p_settings -> 'deduction_amounts');
  end if;
  if p_settings ? 'reasons' then
    if jsonb_typeof(p_settings -> 'reasons') <> 'array' or jsonb_array_length(p_settings -> 'reasons') > 12
       or exists (select 1 from jsonb_array_elements(p_settings -> 'reasons') x where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and 40) then
      raise exception 'give at most 12 reasons of 40 characters' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object('reasons', p_settings -> 'reasons');
  end if;
  insert into public.event_lyst_settings (event_id, settings, updated_at) values (p_event, v_clean, now())
  on conflict (event_id) do update set settings = public.event_lyst_settings.settings || excluded.settings, updated_at = now();
  perform private.audit(p_event, 'lyst.settings', p_event::text, v_clean);
  return private.lyst_settings_for(p_event);
end $$;

-- ---------------------------------------------------------------- 2. the match as the lyst runs it
create table if not exists public.lyst_matches (
  match_id uuid primary key references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text not null,
  -- simple: a counter taps once per valid strike. weighted: one big tap per point value (the repository's Sword and Shield rules score 2 and 1).
  counter_input text not null default 'simple' check (counter_input in ('simple', 'weighted')),
  created_at timestamptz not null default now()
);
create index if not exists lyst_matches_event_idx on public.lyst_matches (event_id);
alter table public.lyst_matches enable row level security;
create policy lyst_matches_read on public.lyst_matches for select to authenticated using (private.can_score(event_id));
grant select on public.lyst_matches to authenticated;
revoke insert, update, delete on public.lyst_matches from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. the authoritative timer (one row per event + field)
create table if not exists public.lyst_timer (
  event_id uuid not null references public.events (id) on delete cascade,
  field_key text not null,
  match_id uuid references public.matches (id) on delete set null,
  round_no integer not null default 1 check (round_no between 1 and 20),
  mode text not null default 'fight' check (mode in ('fight', 'break', 'extended_break', 'dq', 'equipment', 'custom')),
  status text not null default 'idle' check (status in ('idle', 'running', 'paused')),
  duration_ms integer not null default 60000 check (duration_ms between 1000 and 3600000),
  -- milliseconds left: exact when idle or paused; when running it is what was left AT started_at (the countdown continues from there)
  remaining_ms integer not null default 60000 check (remaining_ms between 0 and 3600000),
  started_at timestamptz,
  rev integer not null default 1,
  last_command uuid,
  -- the state before the last change, so a mistaken change can be taken back (restore)
  previous jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, field_key)
);
create index if not exists lyst_timer_match_idx on public.lyst_timer (match_id);
alter table public.lyst_timer enable row level security;
create policy lyst_timer_read on public.lyst_timer for select to anon, authenticated using (private.is_event_public(event_id) or private.can_score(event_id));
grant select on public.lyst_timer to anon, authenticated;
revoke insert, update, delete on public.lyst_timer from public, anon, authenticated;
comment on table public.lyst_timer is 'Pack 13: the one authoritative lyst timer per event and field. Display = remaining_ms minus (server now - started_at) while running. No account ids: who changed it is in audit_log.';

-- ---------------------------------------------------------------- 4. rounds: the official, marshal-approved score
create table if not exists public.lyst_rounds (
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  event_id uuid not null references public.events (id) on delete cascade,
  -- running: the round is being fought. confirming: it ended, the counters are reconciling, the marshal is making the call ("Scores being confirmed").
  -- confirmed: the marshal's awarded score is recorded.
  status text not null default 'running' check (status in ('running', 'confirming', 'confirmed')),
  awarded_a integer check (awarded_a is null or awarded_a between 0 and 99),
  awarded_b integer check (awarded_b is null or awarded_b between 0 and 99),
  rev integer not null default 1,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (match_id, round_no),
  check ((status = 'confirmed') = (awarded_a is not null and awarded_b is not null))
);
create index if not exists lyst_rounds_event_idx on public.lyst_rounds (event_id);
alter table public.lyst_rounds enable row level security;
create policy lyst_rounds_read on public.lyst_rounds for select to anon, authenticated using (private.is_event_public(event_id) or private.can_score(event_id));
grant select on public.lyst_rounds to anon, authenticated;
revoke insert, update, delete on public.lyst_rounds from public, anon, authenticated;
comment on table public.lyst_rounds is 'Pack 13: OFFICIAL awarded round scores (the marshal''s call as recorded by the lyst operator). Counter tallies never write here. No account ids.';

-- Every confirmation and correction, kept for good. Staff only (it carries the counters' snapshot and who acted).
create table if not exists public.lyst_round_revisions (
  id uuid primary key,                 -- the command id: a retry of the same command is recognised
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no integer not null,
  kind text not null check (kind in ('confirm', 'correct')),
  previous_a integer, previous_b integer,
  awarded_a integer not null, awarded_b integer not null,
  -- optional: what the counters recommended after reconciling (the secretary may type it), and what each counter tallied at that moment.
  recommended_a integer, recommended_b integer,
  counters jsonb not null default '[]'::jsonb,
  reason text,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
create index if not exists lyst_round_revisions_match_idx on public.lyst_round_revisions (match_id, round_no, changed_at);
alter table public.lyst_round_revisions enable row level security;
create policy lyst_round_revisions_read on public.lyst_round_revisions for select to authenticated using (private.can_score(private.event_of_match(match_id)));
grant select on public.lyst_round_revisions to authenticated;
revoke insert, update, delete on public.lyst_round_revisions from public, anon, authenticated;

create or replace function private.lyst_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'this record is append-only: record a correction instead' using errcode = 'P0001'; end $$;
revoke execute on function private.lyst_append_only() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'lyst_round_revisions_no_change' and tgrelid = 'public.lyst_round_revisions'::regclass) then
    create trigger lyst_round_revisions_no_change before update or delete on public.lyst_round_revisions for each row execute function private.lyst_append_only();
  end if;
end $do$;

-- ---------------------------------------------------------------- 5. discipline: structured, auditable, never deleted
create table if not exists public.match_discipline (
  id uuid primary key,                 -- the command id (idempotent)
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  round_no integer not null check (round_no between 1 and 20),
  side text not null check (side in ('a', 'b')),
  kind text not null check (kind in ('warning', 'card', 'deduction', 'dq')),
  label text check (label is null or char_length(label) <= 30),   -- the card type's label, from the event's own vocabulary
  amount integer not null default 0 check (amount between 0 and 10),
  related_id uuid references public.match_discipline (id),         -- e.g. the card this deduction came with
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  check ((kind = 'deduction') = (amount > 0))
);
create index if not exists match_discipline_match_idx on public.match_discipline (match_id, created_at);
create index if not exists match_discipline_event_idx on public.match_discipline (event_id);
create index if not exists match_discipline_related_idx on public.match_discipline (related_id) where related_id is not null;
alter table public.match_discipline enable row level security;
create policy match_discipline_read on public.match_discipline for select to anon, authenticated using (private.is_event_public(event_id) or private.can_score(event_id));
grant select on public.match_discipline to anon, authenticated;
revoke insert, update, delete on public.match_discipline from public, anon, authenticated;
comment on table public.match_discipline is 'Pack 13: official warnings, cards, point deductions and disqualifications. PUBLIC columns only; reasons, the marshal''s name and who recorded it live in match_discipline_private.';

create table if not exists public.match_discipline_private (
  discipline_id uuid primary key references public.match_discipline (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  called_by text check (called_by is null or char_length(called_by) <= 60),   -- the marshal who made the call, as the operator states it
  recorded_by uuid not null,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  voided_by uuid
);
alter table public.match_discipline_private enable row level security;
create policy match_discipline_private_read on public.match_discipline_private for select to authenticated
  using (private.can_score((select d.event_id from public.match_discipline d where d.id = discipline_id)));
grant select on public.match_discipline_private to authenticated;
revoke insert, update, delete on public.match_discipline_private from public, anon, authenticated;

create or replace function private.lyst_discipline_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a disciplinary record is never deleted: void it with a reason' using errcode = 'P0001'; end if;
  if (new.id, new.match_id, new.event_id, new.round_no, new.side, new.kind, new.label, new.amount, new.related_id, new.created_at)
     is distinct from (old.id, old.match_id, old.event_id, old.round_no, old.side, old.kind, old.label, old.amount, old.related_id, old.created_at)
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
    raise exception 'only voiding is allowed on a disciplinary record' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.lyst_discipline_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'match_discipline_guard' and tgrelid = 'public.match_discipline'::regclass) then
    create trigger match_discipline_guard before update or delete on public.match_discipline for each row execute function private.lyst_discipline_guard();
  end if;
end $do$;

-- ---------------------------------------------------------------- 6. official round scores (awarded minus active deductions)
create or replace view public.lyst_round_scores with (security_invoker = true) as
select r.match_id, r.event_id, r.round_no, r.status, r.rev, r.awarded_a, r.awarded_b,
       coalesce(d.da, 0)::integer as deduct_a, coalesce(d.db, 0)::integer as deduct_b,
       case when r.status = 'confirmed' then greatest(0, r.awarded_a - coalesce(d.da, 0)) end as official_a,
       case when r.status = 'confirmed' then greatest(0, r.awarded_b - coalesce(d.db, 0)) end as official_b
from public.lyst_rounds r
left join lateral (
  select sum(x.amount) filter (where x.side = 'a') as da, sum(x.amount) filter (where x.side = 'b') as db
  from public.match_discipline x where x.match_id = r.match_id and x.round_no = r.round_no and x.kind = 'deduction' and x.voided_at is null) d on true;
grant select on public.lyst_round_scores to anon, authenticated;

-- ---------------------------------------------------------------- 7. helpers
create or replace function private.lyst_remaining_ms(p_status text, p_remaining integer, p_started timestamptz) returns integer
language sql volatile set search_path = '' as $$
  select case when p_status = 'running' and p_started is not null
              then greatest(0, p_remaining - floor(extract(epoch from (clock_timestamp() - p_started)) * 1000)::integer)
              else p_remaining end
$$;
revoke execute on function private.lyst_remaining_ms(text, integer, timestamptz) from public, anon, authenticated;

create or replace function private.lyst_timer_json(t public.lyst_timer) returns jsonb
language sql volatile set search_path = '' as $$
  select jsonb_build_object('event_id', t.event_id, 'field_key', t.field_key, 'match_id', t.match_id, 'round_no', t.round_no, 'mode', t.mode, 'status', t.status,
    'duration_ms', t.duration_ms, 'remaining_ms', t.remaining_ms, 'started_at', t.started_at, 'rev', t.rev, 'can_restore', t.previous is not null,
    'now_remaining_ms', private.lyst_remaining_ms(t.status, t.remaining_ms, t.started_at))
$$;
revoke execute on function private.lyst_timer_json(public.lyst_timer) from public, anon, authenticated;

-- A match must be in this event, on this field, not final, and the event not closed. One place, used by every lyst command.
create or replace function private.lyst_match_check(p_event uuid, p_match uuid, p_field text) returns public.matches
language plpgsql stable security definer set search_path = '' as $$
declare v_m public.matches;
begin
  select * into v_m from public.matches where id = p_match;
  if not found or private.event_of_match(p_match) is distinct from p_event then raise exception 'match not found in this event' using errcode = 'P0002'; end if;
  if p_field is not null and private.field_key(v_m.field) <> private.field_key(p_field) then raise exception 'this match is not on that field' using errcode = 'P0001'; end if;
  if v_m.queue_state = 'final' then raise exception 'this match is already final' using errcode = 'P0001'; end if;
  if private.event_closed(p_event) then raise exception 'this event is closed' using errcode = 'P0001'; end if;
  return v_m;
end $$;
revoke execute on function private.lyst_match_check(uuid, uuid, text) from public, anon, authenticated;

-- Opens a match in Lyst Control. Idempotent. The counter input style is the tablet's choice for this fight.
create or replace function public.lyst_open(p_match uuid, p_counter_input text default 'simple') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_m public.matches;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_counter_input is null or p_counter_input not in ('simple', 'weighted') then raise exception 'counter input is simple or weighted' using errcode = '22023'; end if;
  v_m := private.lyst_match_check(v_event, p_match, null);
  insert into public.lyst_matches (match_id, event_id, field_key, counter_input) values (p_match, v_event, private.field_key(v_m.field), p_counter_input) on conflict (match_id) do nothing;
  return jsonb_build_object('status', 'ok', 'match_id', p_match, 'counter_input', (select counter_input from public.lyst_matches where match_id = p_match));
end $$;

-- ---------------------------------------------------------------- 8. the timer command
-- One function, every timer change. Actions: set (choose a preset, not running), start, pause, resume, reset, adjust (+/- seconds), restore (take back the last change).
-- Safety: signed in and allowed to score THIS event; the match is on THIS field; the caller names the revision it saw (a stale device is told and changes nothing);
-- the command id makes a retried tap harmless. Starting a FIGHT timer opens that round (so Arena and counters know which round is live); starting a BREAK ends the
-- running round ("Scores being confirmed"). It never touches the match result, the queue, or any official score.
create or replace function public.lyst_timer_command(
  p_event uuid, p_field text, p_match uuid, p_expected_rev integer, p_command uuid, p_action text,
  p_mode text default null, p_duration_ms integer default null, p_round integer default null, p_delta_ms integer default 0)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_t public.lyst_timer; v_have boolean; v_rem integer; v_mode text; v_dur integer; v_round integer; v_prev jsonb; v_new_match boolean; v_r public.lyst_rounds;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.can_score(p_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  if p_action is null or p_action not in ('set', 'start', 'pause', 'resume', 'reset', 'adjust', 'restore') then raise exception 'unknown timer action' using errcode = '22023'; end if;
  v_key := private.field_key(p_field);
  perform private.lyst_match_check(p_event, p_match, p_field);
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst:' || p_event::text || ':' || v_key, 0));

  select * into v_t from public.lyst_timer where event_id = p_event and field_key = v_key for update;
  v_have := found;
  if v_have and v_t.last_command = p_command then return jsonb_build_object('status', 'duplicate', 'timer', private.lyst_timer_json(v_t), 'server_now', clock_timestamp()); end if;
  if coalesce(p_expected_rev, 0) is distinct from (case when v_have then v_t.rev else 0 end) then
    return jsonb_build_object('status', 'stale', 'timer', case when v_have then private.lyst_timer_json(v_t) end, 'server_now', clock_timestamp());
  end if;
  v_new_match := not v_have or v_t.match_id is distinct from p_match;
  if v_new_match and p_action not in ('set', 'start', 'reset') then
    return jsonb_build_object('status', 'stale', 'timer', case when v_have then private.lyst_timer_json(v_t) end, 'server_now', clock_timestamp());
  end if;

  if v_have then
    v_rem := private.lyst_remaining_ms(v_t.status, v_t.remaining_ms, v_t.started_at);
    v_prev := jsonb_build_object('match_id', v_t.match_id, 'mode', v_t.mode, 'duration_ms', v_t.duration_ms, 'remaining_ms', v_rem, 'round_no', v_t.round_no);
  else
    v_rem := 60000; v_prev := null;
  end if;
  v_mode := coalesce(p_mode, case when v_new_match then 'fight' else v_t.mode end);
  if v_mode not in ('fight', 'break', 'extended_break', 'dq', 'equipment', 'custom') then raise exception 'unknown timer mode' using errcode = '22023'; end if;
  v_dur := coalesce(p_duration_ms, case when v_new_match then 60000 else v_t.duration_ms end);
  if v_dur not between 1000 and 3600000 then raise exception 'a timer runs from 1 second to 60 minutes' using errcode = '22023'; end if;
  v_round := coalesce(p_round, case when v_new_match then 1 else v_t.round_no end);
  if v_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;

  if p_action = 'set' then
    insert into public.lyst_timer (event_id, field_key, match_id, round_no, mode, status, duration_ms, remaining_ms, started_at, rev, last_command, previous, updated_at)
    values (p_event, v_key, p_match, v_round, v_mode, 'idle', v_dur, v_dur, null, 1, p_command, null, now())
    on conflict (event_id, field_key) do update set match_id = excluded.match_id, round_no = excluded.round_no, mode = excluded.mode, status = 'idle', duration_ms = excluded.duration_ms,
      remaining_ms = excluded.remaining_ms, started_at = null, rev = public.lyst_timer.rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
    returning * into v_t;
  elsif p_action = 'start' then
    -- a fight timer opens its round; a break closes the running one for scoring. A confirmed round cannot be re-run: correct it instead.
    if v_mode = 'fight' then
      select * into v_r from public.lyst_rounds where match_id = p_match and round_no = v_round;
      if found and v_r.status = 'confirmed' then raise exception 'round % is already confirmed: start the next round, or correct that round', v_round using errcode = 'P0001'; end if;
      if v_round > 1 and not exists (select 1 from public.lyst_rounds where match_id = p_match and round_no = v_round - 1 and status = 'confirmed') then
        raise exception 'confirm round % before starting round %', v_round - 1, v_round using errcode = 'P0001'; end if;
      insert into public.lyst_rounds (match_id, round_no, event_id, status) values (p_match, v_round, p_event, 'running')
      on conflict (match_id, round_no) do update set status = case when public.lyst_rounds.status = 'confirming' then 'running' else public.lyst_rounds.status end,
        rev = case when public.lyst_rounds.status = 'confirming' then public.lyst_rounds.rev + 1 else public.lyst_rounds.rev end;
    elsif v_mode in ('break', 'extended_break') then
      update public.lyst_rounds set status = 'confirming', rev = rev + 1 where match_id = p_match and round_no = (select max(round_no) from public.lyst_rounds where match_id = p_match) and status = 'running';
    end if;
    insert into public.lyst_timer (event_id, field_key, match_id, round_no, mode, status, duration_ms, remaining_ms, started_at, rev, last_command, previous, updated_at)
    values (p_event, v_key, p_match, v_round, v_mode, 'running', v_dur, v_dur, clock_timestamp(), 1, p_command, v_prev, now())
    on conflict (event_id, field_key) do update set match_id = excluded.match_id, round_no = excluded.round_no, mode = excluded.mode, status = 'running', duration_ms = excluded.duration_ms,
      remaining_ms = excluded.remaining_ms, started_at = excluded.started_at, rev = public.lyst_timer.rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
    returning * into v_t;
  elsif p_action = 'pause' then
    if v_t.status <> 'running' then raise exception 'the timer is not running' using errcode = 'P0001'; end if;
    update public.lyst_timer set status = 'paused', remaining_ms = v_rem, started_at = null, rev = rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
      where event_id = p_event and field_key = v_key returning * into v_t;
  elsif p_action = 'resume' then
    if v_t.status <> 'paused' then raise exception 'the timer is not paused' using errcode = 'P0001'; end if;
    update public.lyst_timer set status = 'running', started_at = clock_timestamp(), rev = rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
      where event_id = p_event and field_key = v_key returning * into v_t;
  elsif p_action = 'reset' then
    update public.lyst_timer set match_id = p_match, status = 'idle', remaining_ms = case when v_new_match then v_dur else v_t.duration_ms end, duration_ms = case when v_new_match then v_dur else v_t.duration_ms end,
      started_at = null, round_no = v_round, rev = rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
      where event_id = p_event and field_key = v_key returning * into v_t;
    if not found then
      insert into public.lyst_timer (event_id, field_key, match_id, round_no, mode, status, duration_ms, remaining_ms, rev, last_command, updated_at)
      values (p_event, v_key, p_match, v_round, v_mode, 'idle', v_dur, v_dur, 1, p_command, now()) returning * into v_t;
    end if;
  elsif p_action = 'adjust' then
    if p_delta_ms is null or abs(p_delta_ms) > 300000 or p_delta_ms = 0 then raise exception 'adjust by up to 5 minutes' using errcode = '22023'; end if;
    update public.lyst_timer set remaining_ms = greatest(0, least(3600000, v_rem + p_delta_ms)), started_at = case when status = 'running' then clock_timestamp() else null end,
      rev = rev + 1, last_command = p_command, previous = v_prev, updated_at = now()
      where event_id = p_event and field_key = v_key returning * into v_t;
  else
    if v_t.previous is null then raise exception 'there is nothing to take back' using errcode = 'P0001'; end if;
    -- restore as PAUSED at the time that was showing, so nothing starts by surprise
    update public.lyst_timer set mode = v_t.previous ->> 'mode', duration_ms = (v_t.previous ->> 'duration_ms')::integer, remaining_ms = (v_t.previous ->> 'remaining_ms')::integer,
      status = case when (v_t.previous ->> 'remaining_ms')::integer = (v_t.previous ->> 'duration_ms')::integer then 'idle' else 'paused' end,
      started_at = null, round_no = coalesce((v_t.previous ->> 'round_no')::integer, round_no), rev = rev + 1, last_command = p_command, previous = null, updated_at = now()
      where event_id = p_event and field_key = v_key returning * into v_t;
  end if;

  perform private.audit(p_event, 'lyst.timer', p_match::text, jsonb_build_object('action', p_action, 'field', v_key, 'mode', v_t.mode, 'status', v_t.status, 'duration_ms', v_t.duration_ms, 'round', v_t.round_no, 'rev', v_t.rev));
  return jsonb_build_object('status', 'ok', 'timer', private.lyst_timer_json(v_t), 'server_now', clock_timestamp());
end $$;

-- A finished match stops its timer (the timer row stays: it belongs to the field).
create or replace function private.lyst_match_final() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.lyst_timer set status = 'idle', remaining_ms = duration_ms, started_at = null, rev = rev + 1, previous = null, updated_at = now() where match_id = new.id and status <> 'idle';
  return null;
end $$;
revoke execute on function private.lyst_match_final() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_lyst_final' and tgrelid = 'public.matches'::regclass) then
    create trigger matches_lyst_final after update of queue_state on public.matches for each row when (new.queue_state = 'final' and old.queue_state is distinct from 'final') execute function private.lyst_match_final();
  end if;
end $do$;

-- ---------------------------------------------------------------- 9. the round: end it, confirm it (the marshal's call), correct it
create or replace function public.lyst_end_round(p_match uuid, p_round integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_r public.lyst_rounds;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  perform private.lyst_match_check(v_event, p_match, null);
  update public.lyst_rounds set status = 'confirming', rev = rev + 1 where match_id = p_match and round_no = p_round and status = 'running' returning * into v_r;
  if not found then
    select * into v_r from public.lyst_rounds where match_id = p_match and round_no = p_round;
    if not found then raise exception 'that round has not started' using errcode = 'P0001'; end if;
    return jsonb_build_object('status', 'unchanged', 'round_status', v_r.status);
  end if;
  perform private.audit(v_event, 'lyst.round_ended', p_match::text, jsonb_build_object('round', p_round));
  return jsonb_build_object('status', 'ok', 'round_status', 'confirming');
end $$;

-- What each counter tallied so far in a round, frozen into the revision for audit and training. Defined in part 2 once the counter tables exist; here a
-- harmless empty answer so this file stands alone.
create or replace function private.lyst_counter_snapshot(p_match uuid, p_round integer) returns jsonb
language sql stable security definer set search_path = '' as $$ select '[]'::jsonb $$;
revoke execute on function private.lyst_counter_snapshot(uuid, integer) from public, anon, authenticated;

-- THE MARSHAL'S CALL. p_awarded_* are the scores the marshal awarded for the round, entered by whoever operates the tablet. Nothing is computed from counters:
-- not an average, not the higher or lower count, not a majority. p_recommended_* is optional and only recorded (what the counters agreed, if the operator typed it).
-- Confirming an already confirmed round is a CORRECTION: it needs a reason, keeps the old numbers in the revision log, and is refused once the match is final
-- (then the existing reopen / correct-result path applies).
create or replace function public.lyst_confirm_round(
  p_command uuid, p_match uuid, p_round integer, p_awarded_a integer, p_awarded_b integer, p_expected_rev integer,
  p_recommended_a integer default null, p_recommended_b integer default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_r public.lyst_rounds; v_have boolean; v_kind text; v_rev public.lyst_round_revisions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;

  select * into v_rev from public.lyst_round_revisions where id = p_command;
  if found then
    if v_rev.match_id <> p_match or v_rev.changed_by <> auth.uid() then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'round', (select to_jsonb(r) - 'event_id' from public.lyst_rounds r where r.match_id = p_match and r.round_no = p_round));
  end if;

  perform private.lyst_match_check(v_event, p_match, null);
  if p_round is null or p_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;
  if p_awarded_a is null or p_awarded_b is null or p_awarded_a not between 0 and 99 or p_awarded_b not between 0 and 99 then raise exception 'scores are whole numbers from 0 to 99' using errcode = '22023'; end if;
  if (p_recommended_a is not null and p_recommended_a not between 0 and 99) or (p_recommended_b is not null and p_recommended_b not between 0 and 99) then raise exception 'recommended scores are 0 to 99' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:lyst-round:' || p_match::text, 0));

  select * into v_r from public.lyst_rounds where match_id = p_match and round_no = p_round for update;
  v_have := found;
  if coalesce(p_expected_rev, 0) is distinct from (case when v_have then v_r.rev else 0 end) then
    return jsonb_build_object('status', 'stale', 'round', case when v_have then (to_jsonb(v_r) - 'event_id') end);
  end if;
  if p_round > 1 and not exists (select 1 from public.lyst_rounds where match_id = p_match and round_no = p_round - 1 and status = 'confirmed') then
    raise exception 'confirm round % first', p_round - 1 using errcode = 'P0001'; end if;
  v_kind := case when v_have and v_r.status = 'confirmed' then 'correct' else 'confirm' end;
  if v_kind = 'correct' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the confirmed round is being corrected' using errcode = '22023'; end if;

  if v_have then
    update public.lyst_rounds set status = 'confirmed', awarded_a = p_awarded_a, awarded_b = p_awarded_b, rev = rev + 1, confirmed_at = now()
      where match_id = p_match and round_no = p_round returning * into v_r;
  else
    insert into public.lyst_rounds (match_id, round_no, event_id, status, awarded_a, awarded_b, confirmed_at) values (p_match, p_round, v_event, 'confirmed', p_awarded_a, p_awarded_b, now()) returning * into v_r;
  end if;
  insert into public.lyst_round_revisions (id, match_id, round_no, kind, previous_a, previous_b, awarded_a, awarded_b, recommended_a, recommended_b, counters, reason, changed_by)
  values (p_command, p_match, p_round, v_kind,
          case when v_kind = 'correct' then (select r.awarded_a from public.lyst_round_revisions r where r.match_id = p_match and r.round_no = p_round order by r.changed_at desc limit 1) end,
          case when v_kind = 'correct' then (select r.awarded_b from public.lyst_round_revisions r where r.match_id = p_match and r.round_no = p_round order by r.changed_at desc limit 1) end,
          p_awarded_a, p_awarded_b, p_recommended_a, p_recommended_b, private.lyst_counter_snapshot(p_match, p_round), nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
  perform private.audit(v_event, case when v_kind = 'correct' then 'lyst.round_corrected' else 'lyst.round_confirmed' end, p_match::text,
    jsonb_build_object('round', p_round, 'awarded', jsonb_build_object('a', p_awarded_a, 'b', p_awarded_b), 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('status', 'ok', 'kind', v_kind, 'round', to_jsonb(v_r) - 'event_id');
end $$;

-- ---------------------------------------------------------------- 10. warnings, cards, deductions, disqualification
-- Recorded by whoever operates the tablet FROM the marshal's call (called_by names the marshal). A deduction lowers that round's OFFICIAL score; it is never done
-- by deleting an earlier scoring action (that is "undo", which only exists for the operator's own mistaken input before a round is confirmed).
create or replace function public.lyst_record_discipline(
  p_command uuid, p_match uuid, p_round integer, p_side text, p_kind text, p_label text default null, p_amount integer default 0,
  p_reason text default null, p_called_by text default null, p_related uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_old public.match_discipline; v_cards jsonb; v_amounts jsonb; v_label text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  v_event := private.event_of_match(p_match);
  if v_event is null then raise exception 'match not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_event) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  select * into v_old from public.match_discipline where id = p_command;
  if found then
    if v_old.match_id <> p_match then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  perform private.lyst_match_check(v_event, p_match, null);
  if p_side is null or p_side not in ('a', 'b') then raise exception 'say which side' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('warning', 'card', 'deduction', 'dq') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if p_round is null or p_round not between 1 and 20 then raise exception 'round must be 1 to 20' using errcode = '22023'; end if;
  if char_length(coalesce(p_reason, '')) > 200 or char_length(coalesce(p_called_by, '')) > 60 then raise exception 'keep the reason under 200 and the marshal''s name under 60 characters' using errcode = '22023'; end if;
  v_label := nullif(btrim(coalesce(p_label, '')), '');
  if p_kind = 'card' then
    v_cards := private.lyst_settings_for(v_event) -> 'cards';
    if jsonb_array_length(v_cards) = 0 then raise exception 'no card types are set up for this event: the head marshal sets them in the lyst settings' using errcode = 'P0001'; end if;
    if v_label is null or not exists (select 1 from jsonb_array_elements(v_cards) c where c ->> 'label' = v_label) then raise exception 'choose one of this event''s card types' using errcode = '22023'; end if;
  elsif v_label is not null then raise exception 'only a card has a card type' using errcode = '22023'; end if;
  if p_kind = 'deduction' then
    v_amounts := private.lyst_settings_for(v_event) -> 'deduction_amounts';
    if p_amount is null or p_amount < 1 or not exists (select 1 from jsonb_array_elements_text(v_amounts) a where a::int = p_amount) then raise exception 'choose a deduction amount this event allows' using errcode = '22023'; end if;
  elsif coalesce(p_amount, 0) <> 0 then raise exception 'only a deduction has an amount' using errcode = '22023'; end if;
  if p_related is not null and not exists (select 1 from public.match_discipline where id = p_related and match_id = p_match) then raise exception 'the related record is not in this match' using errcode = '22023'; end if;

  insert into public.match_discipline (id, match_id, event_id, round_no, side, kind, label, amount, related_id) values (p_command, p_match, v_event, p_round, p_side, p_kind, v_label, coalesce(p_amount, 0), p_related);
  insert into public.match_discipline_private (discipline_id, reason, called_by, recorded_by) values (p_command, nullif(btrim(coalesce(p_reason, '')), ''), nullif(btrim(coalesce(p_called_by, '')), ''), auth.uid());
  perform private.audit(v_event, 'lyst.discipline', p_match::text, jsonb_build_object('id', p_command, 'round', p_round, 'side', p_side, 'kind', p_kind, 'label', v_label, 'amount', coalesce(p_amount, 0), 'called_by', nullif(btrim(coalesce(p_called_by, '')), '')));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

-- Void (never delete). The head marshal or an organizer may void any record; the person who recorded it may take back their own mistake for 10 minutes while the match is live.
create or replace function public.lyst_void_discipline(p_command uuid, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d public.match_discipline; v_p public.match_discipline_private; v_state text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_d from public.match_discipline where id = p_id;
  if not found then raise exception 'record not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_d.event_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  if v_d.voided_at is not null then return jsonb_build_object('status', 'duplicate'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 or char_length(p_reason) > 200 then raise exception 'say why this is being voided (3 to 200 characters)' using errcode = '22023'; end if;
  select * into v_p from public.match_discipline_private where discipline_id = p_id;
  select queue_state into v_state from public.matches where id = v_d.match_id;
  if not private.can_resolve_results(v_d.event_id) then
    if v_p.recorded_by is distinct from auth.uid() or v_state = 'final' or v_d.created_at < now() - interval '10 minutes' then
      raise exception 'only the head marshal or an organizer can void this' using errcode = '42501'; end if;
  end if;
  update public.match_discipline set voided_at = now() where id = p_id;
  update public.match_discipline_private set void_reason = btrim(p_reason), voided_by = auth.uid() where discipline_id = p_id;
  perform private.audit(v_d.event_id, 'lyst.discipline_voided', v_d.match_id::text, jsonb_build_object('id', p_id, 'kind', v_d.kind, 'round', v_d.round_no, 'side', v_d.side, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 11. privileges
revoke execute on function public.set_lyst_settings(uuid, jsonb), public.lyst_open(uuid, text), public.lyst_timer_command(uuid, text, uuid, integer, uuid, text, text, integer, integer, integer),
  public.lyst_end_round(uuid, integer), public.lyst_confirm_round(uuid, uuid, integer, integer, integer, integer, integer, integer, text),
  public.lyst_record_discipline(uuid, uuid, integer, text, text, text, integer, text, text, uuid), public.lyst_void_discipline(uuid, uuid, text) from public, anon;
grant execute on function public.set_lyst_settings(uuid, jsonb), public.lyst_open(uuid, text), public.lyst_timer_command(uuid, text, uuid, integer, uuid, text, text, integer, integer, integer),
  public.lyst_end_round(uuid, integer), public.lyst_confirm_round(uuid, uuid, integer, integer, integer, integer, integer, integer, text),
  public.lyst_record_discipline(uuid, uuid, integer, text, text, text, integer, text, text, uuid), public.lyst_void_discipline(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- 12. realtime (the public tables only: Arena and tablets are nudged, then read)
do $do$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['lyst_timer', 'lyst_rounds', 'match_discipline'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $do$;
