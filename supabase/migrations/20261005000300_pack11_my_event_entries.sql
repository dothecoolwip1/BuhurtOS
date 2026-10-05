-- Pack 11 (Red Deer Rumble dress rehearsal): "My next fight" showed a fighter the fights of EVERY team entry of their club, including a team
-- they are not on (a men's fighter saw his club's women's 3v3 fights, because the club has one team row). A team entry is the viewer's
-- when they are on its recorded roster (entry_fighters); only while no roster has been recorded yet does the registration (the team they
-- registered with for THAT competition) stand in. Additive: the function is replaced in place, same signature, same grants.
create or replace function public.my_event_entries(p_event uuid) returns table (entry_id uuid)
language sql stable security definer set search_path = '' as $$
  with mine as (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = auth.uid()),
  regs as (
    select r.id, r.team_id from public.registrations r
    where r.event_id = p_event and r.user_id = auth.uid() and r.status = 'accepted' and not r.is_volunteer)
  select e.id
  from public.entries e
  join public.competitions k on k.id = e.competition_id
  where k.event_id = p_event
    and auth.uid() is not null
    and e.status in ('registered', 'checked_in')
    and (
      e.fighter_id in (select fighter_id from mine)
      or (e.team_id is not null and (
        -- on the recorded roster of this team entry
        exists (select 1 from public.entry_fighters ef where ef.entry_id = e.id and ef.fighter_id in (select fighter_id from mine))
        -- or no roster recorded yet, and they registered for this competition with this team
        or (not exists (select 1 from public.entry_fighters ef where ef.entry_id = e.id)
            and (
              e.team_id in (select rc.team_id from regs r join public.registration_competitions rc on rc.registration_id = r.id where rc.competition_id = e.competition_id)
              or (e.team_id in (select r.team_id from regs r where r.team_id is not null)
                  and not exists (select 1 from regs r join public.registration_competitions rc on rc.registration_id = r.id))))))
    )
$$;
revoke execute on function public.my_event_entries(uuid) from public, anon;
grant execute on function public.my_event_entries(uuid) to authenticated;
