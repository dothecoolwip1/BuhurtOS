-- Pack 26: from the field board, whoever runs the day moves a fight to another Lyst or time; the Event Admin tablet reads the cards and penalties.
--
-- 1. "Change field or time" wrote straight to public.matches, which only the permanent organizer's account may update (matches_organizer_update),
--    and the field board linked to the Draws tool, which only the organizer may open. On the practice night the head marshal and the Event Admin
--    tablet could do neither. set_match_schedule is the controlled way: anyone private.can_command says runs the day (organizer, head marshal,
--    Secretary / Scorekeeper, the Event Admin tablet) may set a match's time, Lyst and length, as long as the match is not final. Audited.
-- 2. The cards and penalties page (event_discipline_log, event_discipline_overview) decided correctly (private.can_score) but the Event Admin
--    tablet's database role could not call it at all. It can now; the functions still decide.
-- Additive: one new function, grants only.
create or replace function public.set_match_schedule(p_match uuid, p_scheduled_at timestamptz, p_field text, p_duration_minutes integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_event uuid; v_field text := nullif(btrim(coalesce(p_field, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  v_event := private.event_of_competition(m.competition_id);
  if v_event is null or not (private.can_command(v_event) or private.is_event_operator(v_event)) then
    raise exception 'only the people who run this event can move a fight' using errcode = '42501'; end if;
  if m.queue_state = 'final' then raise exception 'this fight is final; reopen it before moving it' using errcode = '22023'; end if;
  if v_field is not null and char_length(v_field) > 40 then raise exception 'a Lyst name is at most 40 characters' using errcode = '22023'; end if;
  if p_duration_minutes is not null and p_duration_minutes not between 1 and 720 then raise exception 'the length is 1 to 720 minutes' using errcode = '22023'; end if;
  update public.matches set scheduled_at = p_scheduled_at, field = v_field, duration_minutes = coalesce(p_duration_minutes, duration_minutes) where id = p_match;
  perform private.audit(v_event, 'match.rescheduled', p_match::text, jsonb_build_object(
    'from', jsonb_build_object('scheduled_at', m.scheduled_at, 'field', m.field, 'duration_minutes', m.duration_minutes),
    'to', jsonb_build_object('scheduled_at', p_scheduled_at, 'field', v_field, 'duration_minutes', coalesce(p_duration_minutes, m.duration_minutes))));
  return jsonb_build_object('match_id', p_match, 'scheduled_at', p_scheduled_at, 'field', v_field, 'duration_minutes', coalesce(p_duration_minutes, m.duration_minutes));
end $$;
revoke execute on function public.set_match_schedule(uuid, timestamptz, text, integer) from public, anon;
grant execute on function public.set_match_schedule(uuid, timestamptz, text, integer) to authenticated, bos_event_device;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('event_discipline_log', 'event_discipline_overview')
  loop
    execute format('grant execute on function %s to bos_event_device', r.sig);
  end loop;
end $$;
