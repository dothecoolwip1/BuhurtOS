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

-- ---------------------------------------------------------------- two fields: never the same person in two fights at once
-- Rehearsal finding: automatic promotion (advance_field_queue → promote_one) chose the next fight of a field by its order alone, so with two
-- fields running at different paces a fighter could be made ACTIVE on both at the same moment. Event day only flagged it afterwards.
-- Now a fight is not promoted to active while someone in it (the fighter of a duel side, the recorded roster of a team side) is in an active
-- fight anywhere in the event. On deck / in the hole are unaffected (by the time they start the other fight is over), and an organizer's explicit
-- call (set_match_queue, "Run this fight") is unchanged: the screen marks such fights and will not start them.
create or replace function private.fighting_elsewhere(p_event uuid, p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with ppl as (
    select coalesce(e.fighter_id, ef.fighter_id) as fighter_id
    from public.matches m join public.entries e on e.id in (m.entry_a, m.entry_b)
    left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null
    where m.id = p_match)
  select exists (
    select 1 from public.matches a join public.competitions k on k.id = a.competition_id
    join public.entries e on e.id in (a.entry_a, a.entry_b)
    left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null
    where k.event_id = p_event and a.queue_state = 'active' and a.id <> p_match
      and coalesce(e.fighter_id, ef.fighter_id) in (select fighter_id from ppl where fighter_id is not null))
$$;
revoke execute on function private.fighting_elsewhere(uuid, uuid) from public, anon, authenticated;

create or replace function private.promote_one(p_event uuid, p_key text, p_from text[], p_to text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select x as id from private.queue_ordered(p_event, p_key, p_from) x
           join public.matches m on m.id = x
           where not (m.plan_hold and m.queue_state = 'scheduled')
             and (p_to <> 'active' or not private.fighting_elsewhere(p_event, m.id))
           limit 6 loop
    if private.lock_matches_nowait(array[r.id]) then
      update public.matches set queue_state = p_to, queue_order = null where id = r.id and queue_state = any (p_from);
      if found then return r.id; end if;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function private.promote_one(uuid, text, text[], text) from public, anon, authenticated;
