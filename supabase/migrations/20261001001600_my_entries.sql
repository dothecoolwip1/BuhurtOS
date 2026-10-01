-- "My next fight": which competition entries in an event belong to the signed-in caller. Additive only.
-- Returns entry ids and nothing else (no account ids, no registration data). Anonymous callers get no rows.
--   * duel and profight entries: the entry's fighter is the caller's fighter (fighter_accounts)
--   * team entries: the caller has an ACCEPTED, non-volunteer registration in this event for that team
--     (registrations.team_id, or the team chosen for that competition in registration_competitions)
-- Withdrawn and disqualified entries are left out.
create or replace function public.my_event_entries(p_event uuid) returns table (entry_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.entries e
  join public.competitions k on k.id = e.competition_id
  where k.event_id = p_event
    and auth.uid() is not null
    and e.status in ('registered', 'checked_in')
    and (
      e.fighter_id in (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = auth.uid())
      or e.team_id in (
        select r.team_id from public.registrations r
        where r.event_id = p_event and r.user_id = auth.uid() and r.status = 'accepted' and not r.is_volunteer and r.team_id is not null
        union
        select rc.team_id from public.registrations r join public.registration_competitions rc on rc.registration_id = r.id
        where r.event_id = p_event and r.user_id = auth.uid() and r.status = 'accepted' and not r.is_volunteer and rc.team_id is not null
      )
    )
$$;
revoke execute on function public.my_event_entries(uuid) from public, anon;
grant execute on function public.my_event_entries(uuid) to authenticated;
