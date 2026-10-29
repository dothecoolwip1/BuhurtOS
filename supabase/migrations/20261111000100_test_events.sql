-- Test events (owner decision 2026-10-29): "This is a test event" when creating an event.
--   * Only its own staff (the creator is its organizer) can see it: never listed, never public, even when published.
--   * It is test data: tagged with the "Test events" synthetic source, so it is kept out of rankings, records, standings and fighter histories
--     by the existing synthetic rules.
--   * Nothing from it is kept: 10 days after it is created the event and everything in it (competitions, fights, entries, results, the Lyst,
--     counters, scoring history) are deleted by a daily job. Fighter profiles are never deleted.
--   * Chosen once, at creation: a real event can never be turned into a test event (that would make its history deletable), nor the reverse.
-- Additive. No existing event changes (every event so far stays a normal event).
set check_function_bodies = off;

alter table public.events add column if not exists test_event boolean not null default false;
alter table public.events add column if not exists test_delete_after timestamptz;
alter table public.events drop constraint if exists events_test_delete_after_check;
alter table public.events add constraint events_test_delete_after_check check (test_event = (test_delete_after is not null));
comment on column public.events.test_event is 'A test event: visible only to its staff, kept out of every record, and deleted (not its fighters) at test_delete_after.';

create or replace function private.events_test_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.test_event is distinct from old.test_event or new.test_delete_after is distinct from old.test_delete_after then
    raise exception 'whether an event is a test event is chosen when it is created and cannot change' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.events_test_fixed() from public, anon, authenticated;
drop trigger if exists events_test_fixed on public.events;
create trigger events_test_fixed before update of test_event, test_delete_after on public.events for each row execute function private.events_test_fixed();

-- the synthetic source every test event is tagged with
insert into public.sources (id, kind, title, citation, synthetic)
values ('7e570000-0000-4000-8000-000000000001', 'submitted', 'Test events', 'Created as a test event in BuhurtOS; deleted 10 days after creation', true)
on conflict (id) do nothing;

-- creating an event, with the test choice
drop function if exists public.create_event(text, text, date, date, text, text);
create or replace function public.create_event(p_slug text, p_name text, p_starts_on date, p_ends_on date, p_venue text default null, p_address text default null,
  p_test boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_test boolean := coalesce(p_test, false);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_platform_organizer() then raise exception 'only approved organizers can create events' using errcode = '42501'; end if;
  insert into public.events (slug, name, starts_on, ends_on, venue, address, test_event, test_delete_after)
  values (p_slug, p_name, p_starts_on, p_ends_on, p_venue, p_address, v_test, case when v_test then now() + interval '10 days' end) returning id into v_id;
  insert into public.event_staff (event_id, user_id, role) values (v_id, auth.uid(), 'organizer');
  if v_test then
    insert into public.record_sources (source_id, entity_type, entity_id, status) values ('7e570000-0000-4000-8000-000000000001', 'event', v_id, 'unverified');
  end if;
  perform private.audit(v_id, 'event.created', p_slug, jsonb_build_object('name', p_name, 'test', v_test));
  return v_id;
end $$;
revoke execute on function public.create_event(text, text, date, date, text, text, boolean) from public, anon;
grant execute on function public.create_event(text, text, date, date, text, text, boolean) to authenticated;

-- a test event is never public: only its staff see it (events_read and every child table use is_event_public or can_score)
create function pg_temp.bos_patch(p_fn regprocedure, p_anchor text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_n integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n = 0 and strpos(v_def, p_new) > 0 then return; end if;   -- already patched (safe to run twice)
  if v_n <> 1 then raise exception 'test events patch: anchor found % times in %', v_n, p_fn; end if;
  execute replace(v_def, p_anchor, p_new);
end $f$;
select pg_temp.bos_patch('private.is_event_public(uuid)'::regprocedure,
  $a$e.status = 'published' and$a$, $a$e.status = 'published' and not e.test_event and$a$);
-- The permanent-record guards (append-only logs, disciplinary records, readiness checks) let ONLY the test-event clean-up through: it sets
-- bos.test_purge inside private.purge_test_events, which nobody but the database's own schedule can call. Each guard gets one line at the
-- top of its body; nothing else in it changes.
create function pg_temp.bos_purge_ok(p_fn regprocedure) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_fn); v_at integer := strpos(v_def, 'AS $function$'); v_head text; v_body text;
  v_line text := E'\n  if current_setting(''bos.test_purge'', true) = ''on'' then return coalesce(new, old); end if;';
begin
  if strpos(v_def, 'bos.test_purge') > 0 then return; end if;   -- already done (safe to run twice)
  if v_at = 0 then raise exception 'test events patch: % is not a plpgsql function', p_fn; end if;
  v_head := left(v_def, v_at + 12); v_body := substr(v_def, v_at + 13);
  if v_body !~* '\mbegin\M' then raise exception 'test events patch: no body in %', p_fn; end if;
  execute v_head || regexp_replace(v_body, '\m(begin)\M', '\1' || v_line, 'i');
end $f$;
do $$
declare f text;
begin
  foreach f in array array['private.result_revisions_append_only()', 'private.lyst_append_only()', 'private.lyst_discipline_guard()', 'private.readiness_append_only()',
    'private.camera_log_append_only()', 'private.discipline_rule_guard()', 'private.competition_rulesets_guard()', 'private.discipline_append_only()',
    'private.event_sanction_guard()', 'private.authenticity_finding_guard()', 'private.suspension_guard()', 'private.review_guard()', 'private.operator_log_guard()'] loop
    if to_regprocedure(f) is not null then perform pg_temp.bos_purge_ok(f::regprocedure); end if;
  end loop;
end $$;

-- the daily clean-up: every test event past its date, with everything in it; fighter profiles stay
create or replace function private.purge_test_events(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_names text[];
begin
  select array_agg(id), array_agg(name) into v_ids, v_names from public.events where test_event and test_delete_after <= p_now;
  if v_ids is null then return 0; end if;
  perform set_config('bos.test_purge', 'on', true);
  delete from public.results r using public.competitions c where r.competition_id = c.id and c.event_id = any(v_ids);
  delete from public.record_sources where entity_type = 'event' and entity_id = any(v_ids);
  delete from public.events where id = any(v_ids);
  perform set_config('bos.test_purge', '', true);
  perform private.retention_note('schedule', 'test_events', array(select x::text from unnest(v_ids) x), jsonb_build_object('events', to_jsonb(v_names)));
  return coalesce(array_length(v_ids, 1), 0);
end $$;
revoke execute on function private.purge_test_events(timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-test-events';
    perform cron.schedule('purge-test-events', '23 10 * * *', $job$select private.purge_test_events()$job$);
  else
    raise notice 'pg_cron is not installed: schedule select private.purge_test_events() daily';
  end if;
end $$;

reset check_function_bodies;
