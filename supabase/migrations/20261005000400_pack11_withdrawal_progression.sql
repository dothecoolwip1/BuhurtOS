-- Pack 11 follow-up: keep elimination brackets moving when an entrant withdraws after the draw is built.
-- A withdrawal can sit in a future match with only one known side. When the feeder later finishes, that match becomes
-- fully known but Pack 09A correctly refuses to call a withdrawn entrant, leaving the bracket stuck. The database now
-- resolves that situation as the same audited 0-0 walkover the organizer already records for currently-known matches.
-- Additive: one controlled withdrawal command, two private helpers, and a small patch to finalize_match. No tables or
-- ranking rules change. Both-withdrawn and withdrawn-vs-disqualified matches are deliberately left for human review.

create or replace function private.withdrawal_reason(p_entry uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(a.details ->> 'reason'), '')
       from public.audit_log a
      where a.action = 'entrant.withdrawn' and a.subject = p_entry::text
      order by a.at desc
      limit 1),
    'Opponent withdrawn')
$$;
revoke execute on function private.withdrawal_reason(uuid) from public, anon, authenticated;

-- Resolve every newly-runnable walkover in one competition. finalize_match can reveal another one by advancing a
-- bracket winner, so this loops until the bracket is stable. A transaction-local guard prevents nested calls from
-- re-entering the loop when the walkover itself is finalized.
create or replace function private.resolve_withdrawn_walkovers(p_competition uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.matches;
  v_a_status text;
  v_b_status text;
  v_out uuid;
  v_result text;
  v_reason text;
  v_n integer := 0;
begin
  if coalesce(current_setting('bos.withdrawal_cascade', true), '') = 'on' then
    return 0;
  end if;
  perform set_config('bos.withdrawal_cascade', 'on', true);

  loop
    select m.*, ea.status, eb.status
      into v_m, v_a_status, v_b_status
      from public.matches m
      join public.entries ea on ea.id = m.entry_a
      join public.entries eb on eb.id = m.entry_b
     where m.competition_id = p_competition
       and m.queue_state <> 'final'
       and m.entry_a is not null
       and m.entry_b is not null
       and (
         (ea.status = 'withdrawn' and eb.status not in ('withdrawn', 'disqualified'))
         or
         (eb.status = 'withdrawn' and ea.status not in ('withdrawn', 'disqualified'))
       )
     order by
       case m.stage when 'pool' then 0 when 'round_robin' then 0 when 'elimination' then 1 when 'third_place' then 2 when 'final' then 3 else 4 end,
       m.position, m.id
     limit 1
     for update of m;

    exit when not found;

    if v_a_status = 'withdrawn' then
      v_out := v_m.entry_a;
      v_result := 'b';
    else
      v_out := v_m.entry_b;
      v_result := 'a';
    end if;
    v_reason := private.withdrawal_reason(v_out);

    perform public.finalize_match(
      v_m.id,
      v_result,
      0,
      0,
      jsonb_build_object('walkover', true, 'reason', v_reason, 'automatic', true),
      v_m.version
    );
    v_n := v_n + 1;
    if v_n > 400 then
      raise exception 'withdrawal walkover cascade did not settle' using errcode = 'P0001';
    end if;
  end loop;

  perform set_config('bos.withdrawal_cascade', '', true);
  return v_n;
exception when others then
  perform set_config('bos.withdrawal_cascade', '', true);
  raise;
end $$;
revoke execute on function private.resolve_withdrawn_walkovers(uuid) from public, anon, authenticated;

-- One domain action for taking an entrant out. Before event day the caller passes p_walkovers=false and rebuilds the draw.
-- On event day it atomically marks the entrant out, keeps the reason in the audit trail, and resolves every walkover that
-- is already knowable. Future bracket sides are handled by finalize_match below as soon as they become known.
create or replace function public.withdraw_entry(
  p_entry uuid,
  p_reason text default 'Withdrawn',
  p_walkovers boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_entry public.entries;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  v_event := private.event_of_entry(p_entry);
  if v_event is null then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if not private.is_organizer(v_event) then
    raise exception 'only an organizer can take an entrant out' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 120 then
    raise exception 'say why the entrant is being taken out (3 to 120 characters)' using errcode = '22023';
  end if;

  select * into v_entry from public.entries where id = p_entry for update;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if v_entry.status = 'disqualified' then
    raise exception 'a disqualified entrant cannot be changed to withdrawn' using errcode = '22023';
  end if;

  if v_entry.status <> 'withdrawn' then
    update public.entries set status = 'withdrawn' where id = p_entry;
    perform private.audit(v_event, 'entrant.withdrawn', p_entry::text,
      jsonb_build_object('reason', v_reason, 'competition', v_entry.competition_id));
  end if;

  if coalesce(p_walkovers, false) then
    v_n := private.resolve_withdrawn_walkovers(v_entry.competition_id);
  end if;
  return v_n;
end $$;
revoke execute on function public.withdraw_entry(uuid, text, boolean) from public, anon;
grant execute on function public.withdraw_entry(uuid, text, boolean) to authenticated;

-- Keep the existing, battle-tested finalize_match body and insert one convergence step just before its audit/return.
-- This also covers a withdrawal that occupied a bye: the feeder result fills the other side, then the walkover is
-- settled immediately and its winner continues through the bracket.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'finalize_match'
     and pg_get_function_identity_arguments(p.oid) = 'p_match uuid, p_result text, p_score_a integer, p_score_b integer, p_detail jsonb, p_expected_version integer';

  if v_def is null then
    raise exception 'finalize_match was not found';
  end if;
  if position('private.resolve_withdrawn_walkovers' in v_def) = 0 then
    v_old := '  perform private.audit(v_event, ''match.finalized'', p_match::text, jsonb_build_object(''result'', p_result, ''a'', p_score_a, ''b'', p_score_b));' || chr(10)
          || '  return v_m.version + 1;';
    v_new := '  perform private.resolve_withdrawn_walkovers(v_m.competition_id);' || chr(10)
          || '  perform private.audit(v_event, ''match.finalized'', p_match::text, jsonb_build_object(''result'', p_result, ''a'', p_score_a, ''b'', p_score_b));' || chr(10)
          || '  return v_m.version + 1;';
    v_def := replace(v_def, v_old, v_new);
    if position('private.resolve_withdrawn_walkovers' in v_def) = 0 then
      raise exception 'finalize_match body did not match the expected Pack 11 baseline';
    end if;
    execute v_def;
  end if;
end $do$;

-- Reassert the intended API surface after CREATE OR REPLACE / dynamic replacement.
revoke execute on function public.finalize_match(uuid, text, integer, integer, jsonb, integer) from public, anon;
grant execute on function public.finalize_match(uuid, text, integer, integer, jsonb, integer) to authenticated;
