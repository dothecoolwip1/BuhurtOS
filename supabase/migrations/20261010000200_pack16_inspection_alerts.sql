-- Pack 16, part 2: inspection alerts through Pack 15's EXISTING notification system (the integration point named in PACK_16_READINESS.md §6).
-- No second notification system: two kinds are added to public.notifications, its words/route/group/push rules learn them, and one AFTER INSERT
-- trigger on registration_inspections produces them. The fighter is told their own result and which items need fixing; the inspector's note is
-- staff-only and never goes into a notification. A notification failure never undoes an inspection (same pattern as Pack 15's producers).
-- Additive: Pack 15's notification functions are extended in place (each patch asserts its anchor, so a changed definition fails loudly here).

-- ---------------------------------------------------------------- 1. kinds
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported',
                  'event_invited', 'registration_withdrawn', 'fighter_claim_requested', 'fighter_claim_decided',
                  'fight_called', 'fight_moved', 'team_member_joined', 'team_member_added', 'event_cancelled', 'test_push',
                  'schedule_changed', 'event_announcement', 'result_needs_review',
                  'inspection_needs_correction', 'inspection_passed'));

-- ---------------------------------------------------------------- 2. group, push, route, words (Pack 15 functions, extended in place)
do $do$
declare v_def text; v_new text;
begin
  -- group: event-day alerts about this event
  select pg_get_functiondef('private.notification_category(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$'event_announcement', 'result_needs_review') then 'events'$a$,
                          $a$'event_announcement', 'result_needs_review', 'inspection_needs_correction', 'inspection_passed') then 'events'$a$);
  if v_new = v_def then raise exception 'pack16: notification_category anchor not found'; end if;
  execute v_new;

  -- push: both are worth a lock-screen alert (the fighter is waiting at the event)
  select pg_get_functiondef('private.notification_pushable(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$'schedule_changed', 'event_announcement', 'result_needs_review')$a$,
                          $a$'schedule_changed', 'event_announcement', 'result_needs_review', 'inspection_needs_correction', 'inspection_passed')$a$);
  if v_new = v_def then raise exception 'pack16: notification_pushable anchor not found'; end if;
  execute v_new;

  -- route: the fighter's own event page (registration card, check-in code)
  select pg_get_functiondef('private.notification_route(text,jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$when p_kind in ('registration_decided', 'event_invited', 'event_cancelled', 'event_announcement') and$a$,
                          $a$when p_kind in ('registration_decided', 'event_invited', 'event_cancelled', 'event_announcement', 'inspection_needs_correction', 'inspection_passed') and$a$);
  if v_new = v_def then raise exception 'pack16: notification_route anchor not found'; end if;
  execute v_new;

  -- words: short, plain, lock-screen sized
  select pg_get_functiondef('private.notification_text(text,jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$  if p_kind = 'fight_called' then$a$,
$a$  if p_kind = 'inspection_needs_correction' then
    if p_payload ->> 'result' = 'failed' then
      return query select 'Armour did not pass'::text,
        ('Inspection at ' || v_event || ' did not pass: ' || left(coalesce(nullif(p_payload ->> 'issues', ''), 'see the inspectors'), 80) || '. Talk to the inspectors before you fight.')::text;
    else
      return query select 'Armour needs a fix'::text,
        ('Inspectors at ' || v_event || ' asked you to fix: ' || left(coalesce(nullif(p_payload ->> 'issues', ''), 'see the inspectors'), 80) || '. Then go back for reinspection.')::text;
    end if;
  elsif p_kind = 'inspection_passed' then
    return query select 'Armour passed'::text, ('Your armour passed inspection at ' || v_event || '.')::text;
  elsif p_kind = 'fight_called' then$a$);
  if v_new = v_def then raise exception 'pack16: notification_text anchor not found'; end if;
  execute v_new;
end $do$;
revoke execute on function private.notification_category(text), private.notification_pushable(text), private.notification_route(text, jsonb),
  private.notification_text(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. the producer: one alert per inspection per account of that fighter
create or replace function private.inspection_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_ev public.events; v_kind text; v_issues text; v_payload jsonb; v_u uuid;
begin
  begin
    if new.result not in ('passed', 'conditional', 'failed') then return null; end if;   -- a reset tells nobody anything
    select * into v_r from public.registrations where id = new.registration_id;
    if not found or v_r.is_volunteer or v_r.status <> 'accepted' then return null; end if;
    select * into v_ev from public.events where id = v_r.event_id;
    if not found or v_ev.status <> 'published' then return null; end if;
    v_kind := case when new.result = 'passed' then 'inspection_passed' else 'inspection_needs_correction' end;
    select string_agg(case i when 'missing_equipment' then 'missing equipment' else i end, ', ' order by o) into v_issues
      from unnest(coalesce(new.issues, '{}'::text[])) with ordinality as x(i, o);
    -- the note is staff-only: it is NOT in the payload
    v_payload := jsonb_build_object('event_name', v_ev.name, 'event_slug', v_ev.slug, 'result', new.result, 'issues', coalesce(v_issues, ''));
    for v_u in select v_r.user_id where v_r.user_id is not null
               union select fa.user_id from public.fighter_accounts fa where v_r.fighter_id is not null and fa.fighter_id = v_r.fighter_id loop
      insert into public.notifications (user_id, kind, payload, dedupe_key)
      values (v_u, v_kind, v_payload, 'inspection:' || new.id::text || ':' || v_u::text)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then
    raise warning 'inspection notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.inspection_notify() from public, anon, authenticated;
drop trigger if exists registration_inspections_notify on public.registration_inspections;
create trigger registration_inspections_notify after insert on public.registration_inspections
  for each row execute function private.inspection_notify();
