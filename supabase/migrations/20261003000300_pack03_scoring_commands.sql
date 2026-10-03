-- Pack 03 (2026-10-03): scoring resilience on the server side.
--  * head_marshal event role: the event-day authority who resolves a disagreement between two devices.
--  * public.submit_match_result: the controlled, idempotent finalization command (versioned schema, expected match version).
--    It never silently overwrites: a second, different result for a final match is kept as a conflict, a stale version is kept as evidence.
--  * public.list_result_conflicts / resolve_result_conflict: the "Needs Review" path for the head marshal or an organizer.
--  * public.enter_official_result: the paper recovery path (transcribe a score sheet) through the same audited result machinery.
-- Depends on Pack 02 (match versions, result_revisions, reopen supersession). Additive.

-- 1. head marshal ------------------------------------------------------------------------------------------------------------------
alter table public.event_staff drop constraint event_staff_role_check;
alter table public.event_staff add constraint event_staff_role_check check (role in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic'));

create or replace function private.can_score(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'head_marshal', 'marshal', 'scorekeeper']) $$;
-- Who may settle a disagreement or enter an official result from paper: the head marshal and the organizers (and the platform owner).
create or replace function private.can_resolve_results(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_event_role(p_event, array['organizer', 'head_marshal']) $$;
revoke execute on function private.can_resolve_results(uuid) from public;
grant execute on function private.can_resolve_results(uuid) to anon, authenticated;

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'grant_event_role_by_email';
  v_def := replace(v_def, $$p_role not in ('organizer', 'marshal', 'scorekeeper', 'medic')$$, $$p_role not in ('organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic')$$);
  if position('head_marshal' in v_def) = 0 then raise exception 'grant_event_role_by_email body did not match the expected text'; end if;
  execute v_def;
end $do$;

-- 2. reopen without the permission check, for the controlled paths below ---------------------------------------------------------------
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reopen_match';
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.reopen_match(', 'CREATE OR REPLACE FUNCTION private.reopen_match_core(');
  v_def := replace(v_def, $$  if not private.is_organizer(v_event) then raise exception 'only an organizer can reopen a result' using errcode = '42501'; end if;
$$, '');
  if position('is_organizer' in v_def) > 0 or position('private.reopen_match_core' in v_def) = 0 then raise exception 'reopen_match body did not match the expected text'; end if;
  execute v_def;
end $do$;
revoke execute on function private.reopen_match_core(uuid, text) from public, anon, authenticated;

create or replace function public.reopen_match(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organizer(private.event_of_match(p_match)) then raise exception 'only an organizer can reopen a result' using errcode = '42501'; end if;
  perform private.reopen_match_core(p_match, p_reason);
end $$;
grant execute on function public.reopen_match(uuid, text) to authenticated;

-- 3. proposals: every result a device or a paper sheet puts forward, with its outcome ------------------------------------------------------
create table public.result_proposals (
  id uuid primary key,  -- the command id chosen by the device: the idempotency key
  match_id uuid not null references public.matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  source text not null check (source in ('device', 'paper')),
  proposed_by uuid not null,
  schema_version integer not null,
  expected_version integer,
  result text not null check (result in ('a', 'b', 'draw')),
  score_a integer not null check (score_a >= 0),
  score_b integer not null check (score_b >= 0),
  detail jsonb not null default '{}'::jsonb,
  status text not null check (status in ('accepted', 'duplicate', 'conflict', 'stale', 'resolved_kept', 'resolved_replaced')),
  official_before jsonb,
  note text,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index result_proposals_match_idx on public.result_proposals (match_id, created_at);
create index result_proposals_open_idx on public.result_proposals (event_id) where status = 'conflict';
alter table public.result_proposals enable row level security;
create policy result_proposals_read on public.result_proposals for select to authenticated using (proposed_by = auth.uid() or private.can_resolve_results(event_id));
grant select on public.result_proposals to authenticated;

create or replace function public.submit_match_result(p_command uuid, p_match uuid, p_result text, p_score_a integer, p_score_b integer, p_detail jsonb, p_expected_version integer, p_schema integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_prop public.result_proposals; v_status text; v_version integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  if p_schema is null or p_schema <> 1 then raise exception 'this app version is not supported by the server; reload the page' using errcode = '22023'; end if;

  select * into v_prop from public.result_proposals where id = p_command;
  if found then
    if v_prop.proposed_by <> auth.uid() then raise exception 'that command id belongs to someone else' using errcode = '42501'; end if;
    return jsonb_build_object('status', v_prop.status, 'version', (select version from public.matches where id = v_prop.match_id), 'repeat', true);
  end if;

  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.can_score(v_event) then raise exception 'you cannot score this event' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'scores must be zero or more' using errcode = '22023'; end if;
  if p_expected_version is null then raise exception 'the version you opened is required, reload the match' using errcode = '22023'; end if;

  if v_m.queue_state = 'final' then
    if v_m.result = p_result and v_m.score_a = p_score_a and v_m.score_b = p_score_b then
      v_status := 'duplicate';  -- another device already saved the same result: nothing to review
    else
      v_status := 'conflict';   -- a different official result exists: never overwrite, keep this one for the head marshal
    end if;
    insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, expected_version, result, score_a, score_b, detail, status, official_before)
    values (p_command, p_match, v_event, 'device', auth.uid(), p_schema, p_expected_version, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), v_status,
            jsonb_build_object('result', v_m.result, 'score_a', v_m.score_a, 'score_b', v_m.score_b, 'detail', v_m.detail, 'version', v_m.version, 'finalized_at', v_m.finalized_at));
    if v_status = 'conflict' then
      perform private.audit(v_event, 'result.conflict', p_match::text, jsonb_build_object('proposal', p_command, 'official', v_m.result, 'proposed', p_result));
    end if;
    return jsonb_build_object('status', v_status, 'version', v_m.version);
  end if;

  if v_m.version <> p_expected_version then
    insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, expected_version, result, score_a, score_b, detail, status)
    values (p_command, p_match, v_event, 'device', auth.uid(), p_schema, p_expected_version, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), 'stale');
    return jsonb_build_object('status', 'stale', 'version', v_m.version);
  end if;

  v_version := public.finalize_match(p_match, p_result, p_score_a, p_score_b, p_detail, p_expected_version);
  insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, expected_version, result, score_a, score_b, detail, status)
  values (p_command, p_match, v_event, 'device', auth.uid(), p_schema, p_expected_version, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), 'accepted');
  return jsonb_build_object('status', 'accepted', 'version', v_version);
end $$;
grant execute on function public.submit_match_result(uuid, uuid, text, integer, integer, jsonb, integer, integer) to authenticated;

-- 4. Needs Review ----------------------------------------------------------------------------------------------------------------------
create or replace function public.list_result_conflicts(p_event uuid)
returns table(proposal_id uuid, match_id uuid, competition_name text, round_label text, side_a text, side_b text,
              official_result text, official_score_a integer, official_score_b integer, proposed_result text, proposed_score_a integer, proposed_score_b integer,
              proposed_detail jsonb, proposed_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_resolve_results(p_event) then raise exception 'only the head marshal or an organizer can review result conflicts' using errcode = '42501'; end if;
  return query
  select p.id, p.match_id, k.name, m.round_label,
         coalesce((select t.name from public.entries e join public.teams t on t.id = e.team_id where e.id = m.entry_a), (select f.display_name from public.entries e join public.fighters f on f.id = e.fighter_id where e.id = m.entry_a), 'Side A'),
         coalesce((select t.name from public.entries e join public.teams t on t.id = e.team_id where e.id = m.entry_b), (select f.display_name from public.entries e join public.fighters f on f.id = e.fighter_id where e.id = m.entry_b), 'Side B'),
         m.result, m.score_a, m.score_b, p.result, p.score_a, p.score_b, p.detail, coalesce(private.person_name(p.proposed_by), 'Unnamed scorer'), p.created_at
  from public.result_proposals p join public.matches m on m.id = p.match_id join public.competitions k on k.id = m.competition_id
  where p.event_id = p_event and p.status = 'conflict' order by p.created_at;
end $$;
grant execute on function public.list_result_conflicts(uuid) to authenticated;

create or replace function public.resolve_result_conflict(p_proposal uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.result_proposals; v_m public.matches;
begin
  select * into v_p from public.result_proposals where id = p_proposal for update;
  if not found then raise exception 'conflict not found' using errcode = 'P0002'; end if;
  if not private.can_resolve_results(v_p.event_id) then raise exception 'only the head marshal or an organizer can resolve a result conflict' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('keep_official', 'use_proposal') then raise exception 'decision must be keep_official or use_proposal' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say how this was decided' using errcode = '22023'; end if;
  if v_p.status <> 'conflict' then raise exception 'this conflict was already resolved' using errcode = 'P0001'; end if;
  select * into v_m from public.matches where id = v_p.match_id for update;
  if p_decision = 'use_proposal' then
    perform private.reopen_match_core(v_p.match_id, 'result conflict resolved: ' || btrim(p_note));
    perform public.finalize_match(v_p.match_id, v_p.result, v_p.score_a, v_p.score_b, v_p.detail, (select version from public.matches where id = v_p.match_id));
    update public.result_proposals set status = 'resolved_replaced', resolved_by = auth.uid(), resolved_at = now(), resolution_note = btrim(p_note) where id = p_proposal;
  else
    update public.result_proposals set status = 'resolved_kept', resolved_by = auth.uid(), resolved_at = now(), resolution_note = btrim(p_note) where id = p_proposal;
  end if;
  perform private.audit(v_p.event_id, 'result.conflict_resolved', v_p.match_id::text,
    jsonb_build_object('proposal', p_proposal, 'decision', p_decision, 'note', btrim(p_note), 'official_before', jsonb_build_object('result', v_m.result, 'score_a', v_m.score_a, 'score_b', v_m.score_b),
                       'proposal_result', jsonb_build_object('result', v_p.result, 'score_a', v_p.score_a, 'score_b', v_p.score_b)));
end $$;
grant execute on function public.resolve_result_conflict(uuid, text, text) to authenticated;

-- 5. paper recovery ----------------------------------------------------------------------------------------------------------------------
-- Transcribe or correct an official result from the paper score sheet. Uses the same finalize/reopen machinery, so results are
-- superseded into result_revisions, the match version moves, and the audit log records who entered what and the sheet note.
create or replace function public.enter_official_result(p_match uuid, p_result text, p_score_a integer, p_score_b integer, p_detail jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_m public.matches; v_event uuid; v_before jsonb; v_version integer; v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_match(p_match);
  if not private.can_resolve_results(v_event) then raise exception 'only the head marshal or an organizer can enter an official result' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say where this result comes from (for example the paper sheet number)' using errcode = '22023'; end if;
  if v_m.entry_a is null or v_m.entry_b is null then raise exception 'both sides must be set before a result can be entered' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('a', 'b', 'draw') then raise exception 'result must be a, b or draw' using errcode = '22023'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'scores must be zero or more' using errcode = '22023'; end if;
  if v_m.queue_state = 'final' then
    if v_m.result = p_result and v_m.score_a = p_score_a and v_m.score_b = p_score_b then
      return jsonb_build_object('status', 'unchanged', 'version', v_m.version);
    end if;
    v_before := jsonb_build_object('result', v_m.result, 'score_a', v_m.score_a, 'score_b', v_m.score_b, 'detail', v_m.detail, 'version', v_m.version);
    perform private.reopen_match_core(p_match, 'corrected from paper: ' || btrim(p_note));
  end if;
  v_version := public.finalize_match(p_match, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), (select version from public.matches where id = p_match));
  insert into public.result_proposals (id, match_id, event_id, source, proposed_by, schema_version, expected_version, result, score_a, score_b, detail, status, official_before, note)
  values (v_id, p_match, v_event, 'paper', auth.uid(), 1, null, p_result, p_score_a, p_score_b, coalesce(p_detail, '{}'::jsonb), 'accepted', v_before, btrim(p_note));
  perform private.audit(v_event, 'result.paper_entered', p_match::text, jsonb_build_object('note', btrim(p_note), 'result', p_result, 'a', p_score_a, 'b', p_score_b, 'replaced', v_before));
  return jsonb_build_object('status', case when v_before is null then 'entered' else 'corrected' end, 'version', v_version);
end $$;
grant execute on function public.enter_official_result(uuid, text, integer, integer, jsonb, text) to authenticated;
