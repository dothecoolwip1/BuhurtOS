-- Fix for 20261004000600 (2026-10-04). Additive.
-- entries.represented_team_id was declared as a second foreign key from entries to teams. PostgREST then has two relationships for the embed
-- `entries -> teams(name)` and refuses every such request with PGRST201 ("more than one relationship was found"). The app embeds a team's name
-- that way for entrants, matches, brackets, event history and opponents, so those reads failed.
-- The foreign key on represented_team_id is replaced by the same rules enforced with triggers, so entries.team_id stays the only
-- entries -> teams relationship PostgREST sees:
--   * a represented team must exist when it is written (insert, or set_represented_team / merge_teams),
--   * a team that is still someone's represented team cannot be removed (merge_teams moves those entries to the kept team first).
alter table public.entries drop constraint if exists entries_represented_team_id_fkey;

create or replace function private.entries_represented_team() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev record;
begin
  if tg_op = 'INSERT' then
    -- A team entry keeps whatever was given, so entries_represented_team_fighter_only rejects a represented team on it loudly.
    if new.fighter_id is null then return new; end if;
    if new.represented_team_id is not null then
      new.represented_team_basis := coalesce(new.represented_team_basis, 'recorded');
    else
      select * into v_ev from private.represented_team_evidence(private.event_of_competition(new.competition_id), new.fighter_id);
      new.represented_team_id := v_ev.team_id; new.represented_team_basis := v_ev.basis;
    end if;
    if new.represented_team_id is not null and not exists (select 1 from public.teams t where t.id = new.represented_team_id) then
      raise exception 'represented team not found' using errcode = '23503';
    end if;
    select t.name into new.represented_team_name_at_event from public.teams t where t.id = new.represented_team_id;
    return new;
  end if;
  -- UPDATE: only set_represented_team (bos.represented_team) and merge_teams (bos.merging) may change it.
  if new.represented_team_id is distinct from old.represented_team_id
     or new.represented_team_name_at_event is distinct from old.represented_team_name_at_event
     or new.represented_team_basis is distinct from old.represented_team_basis then
    if coalesce(current_setting('bos.merging', true), '') = 'on' then
      new.represented_team_name_at_event := old.represented_team_name_at_event; new.represented_team_basis := old.represented_team_basis;
    elsif coalesce(current_setting('bos.represented_team', true), '') <> 'on' then
      raise exception 'the team a fighter represented is changed with set_represented_team (it is audited)' using errcode = '42501';
    end if;
    if new.represented_team_id is not null and not exists (select 1 from public.teams t where t.id = new.represented_team_id) then
      raise exception 'represented team not found' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.entries_represented_team() from public, anon, authenticated;

create or replace function private.teams_keep_represented() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.entries e where e.represented_team_id = old.id) then
    raise exception 'this team is still the team fighters represented in recorded competitions; merge it into another team instead'
      using errcode = '23503';
  end if;
  return old;
end $$;
revoke execute on function private.teams_keep_represented() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'teams_keep_represented' and tgrelid = 'public.teams'::regclass) then
    create trigger teams_keep_represented before delete on public.teams for each row execute function private.teams_keep_represented();
  end if;
end $$;
