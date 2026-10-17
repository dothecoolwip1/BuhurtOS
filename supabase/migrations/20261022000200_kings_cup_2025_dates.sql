-- Kings Cup 2025: the dates (2026-10-17). The owner confirmed June 28-29, 2025; the placeholder (January 1, 2025) and its time note go.
-- The medal competitions created for it move their "official since" day along with the event (the day after it ended). Additive; safe to run twice.
do $$
declare v_ev public.events; v_src uuid;
begin
  select * into v_ev from public.events where slug = 'kings-cup-2025';
  if v_ev.id is null then raise notice 'kings_cup_2025_dates: event not found; nothing to do'; return; end if;

  perform set_config('bos.unlock', 'on', true);
  update public.events
     set starts_on = '2025-06-28', ends_on = '2025-06-29', time_note = null,
         description = 'A 2025 armoured combat tournament, June 28 to 29, 2025, kept here for its medals. It was not run in BuhurtOS: there are no fights or scores, only the podium places fighters have reported. The venue has not been recorded yet.'
   where id = v_ev.id and (starts_on, ends_on) is distinct from (date '2025-06-28', date '2025-06-29');
  update public.competitions k set finalized_at = timestamptz '2025-06-30 00:00'
   where k.event_id = v_ev.id and k.status = 'finished' and k.finalized_at is distinct from timestamptz '2025-06-30 00:00';
  perform set_config('bos.unlock', '', true);

  insert into public.sources (kind, title, citation, retrieved_on)
  select 'submitted', 'BuhurtOS owner: Kings Cup 2025 dates', 'June 28-29, 2025, given by the BuhurtOS owner (Garrett) on 2026-10-17 after the date could not be found online.', '2026-10-17'
  where not exists (select 1 from public.sources s where s.title = 'BuhurtOS owner: Kings Cup 2025 dates');
  select id into v_src from public.sources where title = 'BuhurtOS owner: Kings Cup 2025 dates';
  insert into public.record_sources (source_id, entity_type, entity_id, status, note) values (v_src, 'event', v_ev.id, 'imported', 'Dates of the tournament.')
  on conflict (source_id, entity_type, entity_id) do nothing;
  perform private.audit_as(null, v_ev.id, 'event.dates_set', v_ev.id::text, jsonb_build_object('from', jsonb_build_array(v_ev.starts_on, v_ev.ends_on), 'to', jsonb_build_array('2025-06-28', '2025-06-29'), 'by', 'owner'));
end $$;
