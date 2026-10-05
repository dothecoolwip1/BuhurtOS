-- Pack 16 (2026-10-10): check-in, armour control and fighter readiness. Additive.
--
--   * registration_checks stays the current state ("checked_in", "kit" = inspection passed) and learns "arrived". Everything that reads it keeps working.
--   * registration_inspections: append-only inspection history (passed / conditional / failed / reset), with short issue tags, a private note,
--     who and when. The latest record is the current inspection; registration_checks.kit follows it (one writer).
--   * registration_weighins: optional measured weight, profight entrants only, never public, never a blocker.
--   * registration_overrides: an explicit, reasoned, audited readiness override by an organizer or head marshal.
--   * Two event roles: check_in (the check-in desk) and inspector (armour). A scorekeeper is neither.
--   * Readiness is DERIVED (event_readiness / match_readiness / team_readiness), never stored, and never touches the queue.

-- ---------------------------------------------------------------- 1. roles
alter table public.event_staff drop constraint if exists event_staff_role_check;
alter table public.event_staff add constraint event_staff_role_check check (role in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic', 'check_in', 'inspector'));

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'grant_event_role_by_email';
  v_def := replace(v_def, $$p_role not in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic')$$, $$p_role not in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic', 'check_in', 'inspector')$$);
  if position('''inspector''' in v_def) = 0 then raise exception 'grant_event_role_by_email body did not match the expected text'; end if;
  execute v_def;
end $do$;

create or replace function private.can_check_in(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'head_marshal', 'check_in']) $$;
create or replace function private.can_inspect(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'head_marshal', 'inspector']) $$;
-- the event-day desk: may see notes, weights and history
create or replace function private.can_see_readiness_detail(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'head_marshal', 'check_in', 'inspector']) $$;
revoke execute on function private.can_check_in(uuid), private.can_inspect(uuid), private.can_see_readiness_detail(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. arrived
alter table public.registration_checks drop constraint if exists registration_checks_check_name_check;
alter table public.registration_checks add constraint registration_checks_check_name_check check (check_name in ('arrived', 'checked_in', 'kit'));

-- ---------------------------------------------------------------- 3. inspection history
create table if not exists public.registration_inspections (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  result text not null check (result in ('passed', 'conditional', 'failed', 'reset')),
  issues text[] not null default '{}' check (issues <@ array['armour', 'helmet', 'gloves', 'weapon', 'shield', 'footwear', 'missing_equipment', 'other']::text[]),
  note text check (note is null or char_length(note) <= 200),
  inspected_by uuid references auth.users (id) on delete set null,
  inspected_at timestamptz not null default clock_timestamp()
);
create index if not exists registration_inspections_reg_idx on public.registration_inspections (registration_id, inspected_at desc);
create index if not exists registration_inspections_event_idx on public.registration_inspections (event_id, inspected_at desc);
alter table public.registration_inspections enable row level security;
revoke all on public.registration_inspections from public, anon, authenticated;
comment on table public.registration_inspections is 'Pack 16: append-only armour/equipment inspection history for an event registration. The latest row is the current result. Read and written only through functions.';

create table if not exists public.registration_weighins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  weight_kg numeric(5, 1) not null check (weight_kg between 30 and 250),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists registration_weighins_reg_idx on public.registration_weighins (registration_id, recorded_at desc);
alter table public.registration_weighins enable row level security;
revoke all on public.registration_weighins from public, anon, authenticated;
comment on table public.registration_weighins is 'Pack 16: optional measured weight (profight entrants). Private: event desk staff only.';

create table if not exists public.registration_overrides (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 140),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists registration_overrides_active_idx on public.registration_overrides (registration_id) where revoked_at is null;
alter table public.registration_overrides enable row level security;
revoke all on public.registration_overrides from public, anon, authenticated;
comment on table public.registration_overrides is 'Pack 16: an explicit readiness override (organizer or head marshal, with a reason). Never silent: shown wherever readiness is shown.';

-- history is never rewritten
create or replace function private.readiness_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'registration_overrides' and tg_op = 'UPDATE' then
    -- withdrawing an override is the one allowed change (checked in its own block: the other tables have no such columns)
    if old.revoked_at is null and new.revoked_at is not null and new.reason = old.reason and new.created_by is not distinct from old.created_by
       and new.created_at = old.created_at and new.registration_id = old.registration_id then
      return new;
    end if;
  end if;
  raise exception '% is history: it is never changed or deleted', tg_table_name using errcode = '42501';
end $$;
revoke execute on function private.readiness_append_only() from public, anon, authenticated;
do $do$
declare t text;
begin
  foreach t in array array['registration_inspections', 'registration_weighins', 'registration_overrides'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_append_only' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before update or delete on public.%I for each row when (pg_trigger_depth() = 0) execute function private.readiness_append_only()', t || '_append_only', t);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------- 4. the desk's actions
-- Shared checks: the registration exists, belongs to an event the caller works at, and is still someone who could fight or help.
create or replace function private.desk_registration(p_reg uuid) returns public.registrations
language plpgsql stable security definer set search_path = '' as $$
declare v_r public.registrations;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_r from public.registrations where id = p_reg;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  return v_r;
end $$;
revoke execute on function private.desk_registration(uuid) from public, anon, authenticated;

-- Attendance: expected (undo everything), arrived, checked_in. Setting the state the record already has changes nothing (a second tap is harmless).
create or replace function public.set_attendance(p_reg uuid, p_state text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_arrived boolean; v_in boolean; v_was text;
begin
  v_r := private.desk_registration(p_reg);
  if not private.can_check_in(v_r.event_id) then raise exception 'only the check-in desk, the head marshal or an organizer of this event can check people in' using errcode = '42501'; end if;
  if p_state is null or p_state not in ('expected', 'arrived', 'checked_in') then raise exception 'state is expected, arrived or checked_in' using errcode = '22023'; end if;
  if v_r.status <> 'accepted' and p_state <> 'expected' then raise exception 'only an accepted registration can be checked in' using errcode = '22023'; end if;
  select coalesce(bool_or(passed) filter (where check_name = 'arrived'), false), coalesce(bool_or(passed) filter (where check_name = 'checked_in'), false)
    into v_arrived, v_in from public.registration_checks where registration_id = p_reg;
  v_was := case when v_in then 'checked_in' when v_arrived then 'arrived' else 'expected' end;
  if v_was = p_state then return jsonb_build_object('state', p_state, 'changed', false); end if;
  insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, 'arrived', p_state <> 'expected')
    on conflict (registration_id, check_name) do update set passed = excluded.passed, at = now();
  insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, 'checked_in', p_state = 'checked_in')
    on conflict (registration_id, check_name) do update set passed = excluded.passed, at = now();
  perform private.audit(v_r.event_id, 'checkin.' || p_state, p_reg::text, jsonb_build_object('from', v_was));
  return jsonb_build_object('state', p_state, 'changed', true);
end $$;

-- One inspection. passed / conditional (needs correction) / failed; reset = "not inspected" again. Conditional and failed need at least one issue.
create or replace function public.record_inspection(p_reg uuid, p_result text, p_issues text[] default '{}', p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_id uuid; v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), ''); v_issues text[] := coalesce(p_issues, '{}');
begin
  v_r := private.desk_registration(p_reg);
  if not private.can_inspect(v_r.event_id) then raise exception 'only an armour inspector, the head marshal or an organizer of this event can record inspections' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('passed', 'conditional', 'failed', 'reset') then raise exception 'result is passed, conditional, failed or reset' using errcode = '22023'; end if;
  if v_r.status <> 'accepted' then raise exception 'only an accepted registration can be inspected' using errcode = '22023'; end if;
  if not (v_issues <@ array['armour', 'helmet', 'gloves', 'weapon', 'shield', 'footwear', 'missing_equipment', 'other']::text[]) then raise exception 'unknown issue' using errcode = '22023'; end if;
  if p_result in ('conditional', 'failed') and cardinality(v_issues) = 0 then raise exception 'say what needs fixing (at least one issue)' using errcode = '22023'; end if;
  if p_result in ('passed', 'reset') then v_issues := '{}'; end if;
  if v_note is not null and char_length(v_note) > 200 then raise exception 'keep the note to 200 characters' using errcode = '22023'; end if;
  insert into public.registration_inspections (registration_id, event_id, result, issues, note, inspected_by)
  values (p_reg, v_r.event_id, p_result, v_issues, v_note, auth.uid()) returning id into v_id;
  insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, 'kit', p_result = 'passed')
    on conflict (registration_id, check_name) do update set passed = excluded.passed, at = now();
  perform private.audit(v_r.event_id, 'inspection.' || p_result, p_reg::text, jsonb_build_object('inspection', v_id, 'issues', v_issues,
    'reinspection', exists (select 1 from public.registration_inspections where registration_id = p_reg and id <> v_id and result in ('conditional', 'failed'))));
  return jsonb_build_object('id', v_id, 'result', p_result);
end $$;

-- The older one-switch path (Manage › Check-in "Kit check") keeps its signature but now writes through an inspection record, so there is one writer.
create or replace function public.set_registration_check(p_reg uuid, p_check text, p_value boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid := private.reg_event(p_reg);
begin
  if not private.is_organizer(v_event) then raise exception 'only an organizer can check people in' using errcode = '42501'; end if;
  if p_check = 'kit' then
    insert into public.registration_inspections (registration_id, event_id, result, inspected_by) values (p_reg, v_event, case when p_value then 'passed' else 'reset' end, auth.uid());
  end if;
  insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, p_check, p_value)
  on conflict (registration_id, check_name) do update set passed = excluded.passed, at = now();
  if p_check = 'checked_in' and p_value then
    insert into public.registration_checks (registration_id, check_name, passed) values (p_reg, 'arrived', true)
    on conflict (registration_id, check_name) do update set passed = true, at = now();
  end if;
  perform private.audit(v_event, 'registration.check', p_reg::text, jsonb_build_object('check', p_check, 'passed', p_value));
end $$;

-- Weigh-in: only for someone entered in a profight (outrance) competition of this event.
create or replace function public.record_weigh_in(p_reg uuid, p_weight_kg numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_id uuid;
begin
  v_r := private.desk_registration(p_reg);
  if not (private.can_inspect(v_r.event_id) or private.can_check_in(v_r.event_id)) then raise exception 'only event desk staff can record a weigh-in' using errcode = '42501'; end if;
  if v_r.status <> 'accepted' then raise exception 'only an accepted registration can be weighed in' using errcode = '22023'; end if;
  if not exists (select 1 from public.registration_competitions rc join public.competitions k on k.id = rc.competition_id join public.ref_categories c on c.code = k.category
                 where rc.registration_id = p_reg and c.league = 'outrance') then
    raise exception 'a weigh-in is only for profight entrants' using errcode = '22023'; end if;
  if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 250 then raise exception 'a weight is 30 to 250 kg' using errcode = '22023'; end if;
  insert into public.registration_weighins (registration_id, event_id, weight_kg, recorded_by) values (p_reg, v_r.event_id, round(p_weight_kg, 1), auth.uid()) returning id into v_id;
  perform private.audit(v_r.event_id, 'weighin.recorded', p_reg::text, jsonb_build_object('weighin', v_id, 'kg', round(p_weight_kg, 1)));
  return jsonb_build_object('id', v_id, 'weight_kg', round(p_weight_kg, 1));
end $$;

-- An explicit override: ready despite the open reasons, for the genuine exception. Organizer or head marshal, with a reason; withdrawable; audited.
create or replace function public.set_readiness_override(p_reg uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')); v_id uuid;
begin
  v_r := private.desk_registration(p_reg);
  if not private.can_resolve_results(v_r.event_id) then raise exception 'only the head marshal or an organizer of this event can override readiness' using errcode = '42501'; end if;
  if v_r.status <> 'accepted' then raise exception 'only an accepted registration can be overridden' using errcode = '22023'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 140 then raise exception 'give a short reason (5 to 140 characters)' using errcode = '22023'; end if;
  update public.registration_overrides set revoked_at = clock_timestamp(), revoked_by = auth.uid() where registration_id = p_reg and revoked_at is null;
  insert into public.registration_overrides (registration_id, event_id, reason, created_by) values (p_reg, v_r.event_id, v_reason, auth.uid()) returning id into v_id;
  perform private.audit(v_r.event_id, 'readiness.override', p_reg::text, jsonb_build_object('override', v_id, 'reason', v_reason));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.clear_readiness_override(p_reg uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_n integer;
begin
  v_r := private.desk_registration(p_reg);
  if not private.can_resolve_results(v_r.event_id) then raise exception 'only the head marshal or an organizer of this event can change an override' using errcode = '42501'; end if;
  update public.registration_overrides set revoked_at = clock_timestamp(), revoked_by = auth.uid() where registration_id = p_reg and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform private.audit(v_r.event_id, 'readiness.override_cleared', p_reg::text); end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------- 5. readiness (derived; one rule for every screen)
-- Every registration of the event that is accepted, pending or withdrawn, with its attendance, current inspection, admin blockers, override and
-- the resulting READY / NOT READY with plain reasons. Private columns (note, weights, override reason) are filled only for the desk.
create or replace function private.readiness_rows(p_event uuid, p_detail boolean)
returns table (registration_id uuid, fighter_id uuid, full_name text, team_id uuid, team_name text, competitions text[], is_volunteer boolean, status text,
               attendance text, inspection text, issues text[], inspection_note text, inspected_at timestamptz, inspected_by_name text, reinspected boolean,
               insurance_ok boolean, fee_ok boolean, override_active boolean, override_reason text, profight boolean, declared_weight text, weight_kg numeric,
               ready boolean, reasons text[])
language sql stable security definer set search_path = '' as $$
  with r as (
    select g.*, t.name as tname,
      coalesce((select bool_or(c.passed) from public.registration_checks c where c.registration_id = g.id and c.check_name = 'arrived'), false) as arrived,
      coalesce((select bool_or(c.passed) from public.registration_checks c where c.registration_id = g.id and c.check_name = 'checked_in'), false) as checked_in,
      coalesce((select bool_or(c.passed) from public.registration_checks c where c.registration_id = g.id and c.check_name = 'kit'), false) as kit
    from public.registrations g left join public.teams t on t.id = g.team_id
    where g.event_id = p_event and g.status in ('accepted', 'pending', 'withdrawn')),
  x as (
    select r.*, li.result as last_result, li.issues as last_issues, li.note as last_note, li.inspected_at as last_at, li.inspected_by as last_by,
      exists (select 1 from public.registration_inspections q where q.registration_id = r.id and q.result in ('conditional', 'failed')) as had_problem,
      o.reason as o_reason,
      (select array_agg(k.name order by k.sort, k.name) from public.registration_competitions rc join public.competitions k on k.id = rc.competition_id where rc.registration_id = r.id) as comps,
      exists (select 1 from public.registration_competitions rc join public.competitions k on k.id = rc.competition_id join public.ref_categories c on c.code = k.category
              where rc.registration_id = r.id and c.league = 'outrance') as is_pro,
      (select rc.details ->> 'weight' from public.registration_competitions rc where rc.registration_id = r.id and rc.details ? 'weight' limit 1) as declared,
      (select w.weight_kg from public.registration_weighins w where w.registration_id = r.id order by w.recorded_at desc limit 1) as measured
    from r
    left join lateral (select q.* from public.registration_inspections q where q.registration_id = r.id order by q.inspected_at desc, q.id desc limit 1) li on true
    left join public.registration_overrides o on o.registration_id = r.id and o.revoked_at is null),
  y as (
    select x.*,
      case when x.status = 'withdrawn' then 'withdrawn' when x.checked_in then 'checked_in' when x.arrived then 'arrived' else 'expected' end as att,
      case when x.is_volunteer then 'not_needed'
           when x.last_result in ('passed', 'conditional', 'failed') then x.last_result
           when x.last_result is null and x.kit then 'passed'       -- recorded before Pack 16 by the one-switch kit check
           else 'not_inspected' end as insp,
      x.insurance in ('hacsa_member', 'mcc_member', 'proof_received') as ins_ok,
      not (x.fee_due_cents > 0 and not x.fee_paid) as f_ok
    from x),
  z as (
    select y.*, array_remove(array[
      case when y.status = 'withdrawn' then 'Withdrawn' when y.status <> 'accepted' then 'Registration not accepted' end,
      case when y.status = 'accepted' and y.att = 'expected' then 'Not checked in' when y.status = 'accepted' and y.att = 'arrived' then 'Arrived, not checked in' end,
      case when y.status = 'accepted' then case y.insp when 'not_inspected' then 'Armour inspection required' when 'conditional' then 'Armour needs correction' when 'failed' then 'Armour failed inspection' end end,
      case when y.status = 'accepted' and not y.ins_ok then 'Insurance not in order' end,
      case when y.status = 'accepted' and not y.f_ok then 'Fee not paid' end
    ], null) as why
    from y)
  select z.id, z.fighter_id, z.full_name, z.team_id, z.tname, coalesce(z.comps, '{}'), z.is_volunteer, z.status,
    z.att, z.insp, coalesce(case when z.insp in ('conditional', 'failed') then z.last_issues end, '{}'),
    case when p_detail then z.last_note end, z.last_at, case when p_detail and z.last_by is not null then coalesce(private.person_name(z.last_by), 'A staff member') end,
    z.had_problem and z.insp = 'passed',
    z.ins_ok, z.f_ok, z.o_reason is not null, case when p_detail then z.o_reason end, z.is_pro,
    case when p_detail then z.declared end, case when p_detail then z.measured end,
    z.status = 'accepted' and (cardinality(z.why) = 0 or z.o_reason is not null),
    z.why
  from z
  order by lower(z.full_name), z.id
$$;
revoke execute on function private.readiness_rows(uuid, boolean) from public, anon, authenticated;

-- The desk's dashboard (organizer, head marshal, check-in desk, inspector): everything, including notes and weights.
create or replace function public.event_readiness(p_event uuid)
returns table (registration_id uuid, fighter_id uuid, full_name text, team_id uuid, team_name text, competitions text[], is_volunteer boolean, status text,
               attendance text, inspection text, issues text[], inspection_note text, inspected_at timestamptz, inspected_by_name text, reinspected boolean,
               insurance_ok boolean, fee_ok boolean, override_active boolean, override_reason text, profight boolean, declared_weight text, weight_kg numeric,
               ready boolean, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_event is null or not private.can_see_readiness_detail(p_event) then
    raise exception 'only event desk staff (check-in, inspection, head marshal, organizer) can see this' using errcode = '42501'; end if;
  return query select * from private.readiness_rows(p_event, true);
end $$;

-- One person's inspection history (desk only).
create or replace function public.inspection_history(p_reg uuid)
returns table (result text, issues text[], note text, inspected_at timestamptz, inspected_by_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_r public.registrations;
begin
  v_r := private.desk_registration(p_reg);
  if not private.can_see_readiness_detail(v_r.event_id) then raise exception 'only event desk staff can see inspection history' using errcode = '42501'; end if;
  return query select q.result, q.issues, q.note, q.inspected_at, case when q.inspected_by is not null then coalesce(private.person_name(q.inspected_by), 'A staff member') end
  from public.registration_inspections q where q.registration_id = p_reg order by q.inspected_at desc, q.id desc;
end $$;

-- The two sides of a fight, for the Lyst screen and Event day (desk + marshal + scorekeeper): ready or not, and why. No notes, no weights.
create or replace function public.match_readiness(p_match uuid)
returns table (side text, fighter_id uuid, name text, tracked boolean, ready boolean, reasons text[], override_active boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.event_of_match(p_match);
  if auth.uid() is null or v_event is null or not (private.can_score(v_event) or private.can_see_readiness_detail(v_event)) then
    raise exception 'only event staff can see fighter readiness' using errcode = '42501'; end if;
  return query
  with sides as (
    select 'a'::text as s, m.entry_a as e from public.matches m where m.id = p_match
    union all select 'b', m.entry_b from public.matches m where m.id = p_match),
  people as (
    select sides.s, f.id as fid, f.display_name as fname from sides join public.entries en on en.id = sides.e join public.fighters f on f.id = en.fighter_id
    union
    select sides.s, f.id, f.display_name from sides join public.entry_fighters ef on ef.entry_id = sides.e join public.fighters f on f.id = ef.fighter_id),
  rows as (select * from private.readiness_rows(v_event, false))
  select p.s, p.fid, p.fname, rr.registration_id is not null,
         coalesce(rr.ready, false) or rr.registration_id is null,
         coalesce(rr.reasons, '{}'), coalesce(rr.override_active, false)
  from people p left join lateral (select * from rows where rows.fighter_id = p.fid order by (rows.status = 'accepted') desc limit 1) rr on true
  order by p.s, lower(p.fname);
end $$;

-- A captain's own team (or an organizer): status words only. No notes, no weights, no health data, no override reason.
create or replace function public.team_readiness(p_event uuid, p_team uuid)
returns table (registration_id uuid, full_name text, is_volunteer boolean, attendance text, inspection text, ready boolean, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.is_team_captain(p_team) or private.is_organizer(p_event)) then
    raise exception 'only the team captain or an organizer can see this' using errcode = '42501'; end if;
  return query
  select r.registration_id, r.full_name, r.is_volunteer, r.attendance, r.inspection, r.ready, r.reasons
  from private.readiness_rows(p_event, false) r
  where r.status in ('accepted', 'pending')
    and (r.team_id = p_team or exists (
      select 1 from public.registration_competitions rc join public.competitions k on k.id = rc.competition_id
      where rc.registration_id = r.registration_id and rc.team_id = p_team and k.event_id = p_event));
end $$;

-- Am I staff at this event's desk? (the check-in screen decides what to show; the database still checks every action)
create or replace function public.my_desk_roles(p_event uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('check_in', coalesce(private.can_check_in(p_event), false), 'inspect', coalesce(private.can_inspect(p_event), false),
                            'override', coalesce(private.can_resolve_results(p_event), false), 'detail', coalesce(private.can_see_readiness_detail(p_event), false))
  where auth.uid() is not null
$$;

revoke execute on function public.set_attendance(uuid, text), public.record_inspection(uuid, text, text[], text), public.record_weigh_in(uuid, numeric),
  public.set_readiness_override(uuid, text), public.clear_readiness_override(uuid), public.event_readiness(uuid), public.inspection_history(uuid),
  public.match_readiness(uuid), public.team_readiness(uuid, uuid), public.my_desk_roles(uuid) from public, anon;
grant execute on function public.set_attendance(uuid, text), public.record_inspection(uuid, text, text[], text), public.record_weigh_in(uuid, numeric),
  public.set_readiness_override(uuid, text), public.clear_readiness_override(uuid), public.event_readiness(uuid), public.inspection_history(uuid),
  public.match_readiness(uuid), public.team_readiness(uuid, uuid), public.my_desk_roles(uuid) to authenticated;
