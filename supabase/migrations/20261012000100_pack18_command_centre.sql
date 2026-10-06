-- Pack 18: the Organizer Command Centre's one server-side read. ADDITIVE: no new tables, no stored state, no writes, no audit noise.
-- Everything is derived from the authoritative Pack 09–16 data at the moment of the call:
--   * readiness: Pack 16 private.readiness_rows (the single readiness rule), called WITHOUT detail, so no inspection notes, weights or override
--     detail beyond the reason the override roles already see;
--   * the fights in play / coming up: Pack 09A queue on public.matches (read only);
--   * staff: event_staff assignments by role, display names only (no emails, no account ids). "Assigned" is all BuhurtOS knows: not presence.
-- Who: the organizer (incl. org admins and the platform owner, by the existing has_event_role rule) and the HEAD MARSHAL of THIS event, the two
-- roles that already decide result conflicts and readiness overrides here. Everyone else (desk, inspector, marshal, scorekeeper, medic, captain,
-- fighter, other events' staff, anonymous) is refused by the database.

create or replace function private.can_command(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_event is not null and private.can_resolve_results(p_event)
$$;
revoke execute on function private.can_command(uuid) from public, anon, authenticated;

create or replace function public.event_command_snapshot(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ev public.events;
  v_out jsonb;
begin
  if not coalesce(private.can_command(p_event), false) then
    raise exception 'only this event''s organizers and head marshal can open the command centre' using errcode = '42501';
  end if;
  select * into v_ev from public.events where id = p_event;
  if not found then raise exception 'only this event''s organizers and head marshal can open the command centre' using errcode = '42501'; end if;

  with rr as (select * from private.readiness_rows(p_event, false)),
  acc as (select * from rr where status = 'accepted'),
  fighters as (select * from acc where not is_volunteer),
  -- the fights that matter now: called (in the hole, on deck, active) or scheduled within the next 90 minutes (or overdue up to 3 hours)
  live as (
    select m.id, m.entry_a, m.entry_b
    from public.matches m join public.competitions k on k.id = m.competition_id
    where k.event_id = p_event and m.queue_state <> 'final' and m.result is null
      and (m.queue_state in ('active', 'on_deck', 'in_the_hole')
           or (m.scheduled_at is not null and m.scheduled_at between clock_timestamp() - interval '3 hours' and clock_timestamp() + interval '90 minutes'))
    order by case m.queue_state when 'active' then 0 when 'on_deck' then 1 when 'in_the_hole' then 2 else 3 end, m.scheduled_at nulls last, m.id
    limit 80),
  sides as (select l.id as match_id, 'a'::text as side, l.entry_a as entry from live l where l.entry_a is not null
            union all select l.id, 'b', l.entry_b from live l where l.entry_b is not null),
  people as (
    select s.match_id, s.side, en.fighter_id from sides s join public.entries en on en.id = s.entry where en.fighter_id is not null
    union
    select s.match_id, s.side, ef.fighter_id from sides s join public.entry_fighters ef on ef.entry_id = s.entry),
  warn as (
    select p.match_id, p.side, p.fighter_id, x.full_name, x.reasons
    from people p
    join lateral (select * from rr where rr.fighter_id = p.fighter_id order by (rr.status = 'accepted') desc limit 1) x on true
    where x.status = 'accepted' and not x.ready)                 -- untracked people (no registration) are never warned about
  select jsonb_build_object(
    'server_now', clock_timestamp(),
    'event', jsonb_build_object('id', v_ev.id, 'slug', v_ev.slug, 'name', v_ev.name, 'status', v_ev.status, 'timezone', v_ev.timezone,
                                'starts_on', v_ev.starts_on, 'ends_on', v_ev.ends_on, 'closed', v_ev.closed_at is not null),
    'viewer', jsonb_build_object('organizer', coalesce(private.is_organizer(p_event), false)),
    'readiness', jsonb_build_object(
      'fighters', (select count(*) from fighters),
      'volunteers', (select count(*) from acc where is_volunteer),
      'missing', (select count(*) from fighters where attendance = 'expected'),
      'arrived', (select count(*) from fighters where attendance = 'arrived'),
      'checked_in', (select count(*) from fighters where attendance = 'checked_in'),
      'ready', (select count(*) from fighters where ready),
      'not_ready', (select count(*) from fighters where not ready),
      'needs_inspection', (select count(*) from fighters where inspection = 'not_inspected'),
      'needs_correction', (select count(*) from fighters where inspection = 'conditional'),
      'failed', (select count(*) from fighters where inspection = 'failed'),
      'overrides', (select count(*) from acc where override_active),
      'admin_blocked', (select count(*) from fighters where not insurance_ok or not fee_ok),
      'pending_registrations', (select count(*) from rr where status = 'pending')),
    'not_ready', coalesce((select jsonb_agg(jsonb_build_object('registration_id', f.registration_id, 'fighter_id', f.fighter_id, 'name', f.full_name,
                                   'team', f.team_name, 'attendance', f.attendance, 'inspection', f.inspection, 'reasons', f.reasons) order by lower(f.full_name))
                           from (select * from fighters where not ready limit 300) f), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('registration_id', o.registration_id, 'name', o.full_name,
                                   'reason', (select r.reason from public.registration_overrides r where r.registration_id = o.registration_id and r.revoked_at is null limit 1)) order by lower(o.full_name))
                           from acc o where o.override_active), '[]'::jsonb),
    'fight_warnings', coalesce((select jsonb_agg(jsonb_build_object('match_id', w.match_id, 'side', w.side, 'fighter_id', w.fighter_id, 'name', w.full_name, 'reasons', w.reasons)
                                     order by w.match_id, w.side, lower(w.full_name)) from warn w), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('role', s.role, 'names', s.names) order by s.ord)
                       from (select st.role,
                                    array_agg(coalesce(nullif(trim(pr.display_name), ''), 'A staff member') order by lower(coalesce(pr.display_name, ''))) as names,
                                    array_position(array['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'check_in', 'inspector', 'medic'], st.role) as ord
                             from public.event_staff st left join public.profiles pr on pr.id = st.user_id
                             where st.event_id = p_event
                             group by st.role) s), '[]'::jsonb),
    'broadcast', jsonb_build_object('configured', exists (select 1 from public.event_broadcast b where b.event_id = p_event and b.stream_url is not null))
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.event_command_snapshot(uuid) from public, anon;
grant execute on function public.event_command_snapshot(uuid) to authenticated;
