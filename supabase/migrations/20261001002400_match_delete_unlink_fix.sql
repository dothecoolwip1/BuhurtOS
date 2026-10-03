-- Deleting several linked matches in ONE statement failed (additive; replaces the trigger of 20261001001700).
--
-- 20261001001700 added a BEFORE DELETE ROW trigger that clears next_match_id / next_slot on the matches that lead into the deleted one. It claims that
-- "deleting a whole schedule in one statement, or a whole competition, behaves as before". It does not: when the statement deletes both a match and
-- a match that leads into it, the trigger tries to update a row the same command already deleted and PostgreSQL stops with
--   ERROR: tuple to be updated was already modified by an operation triggered by the current command
-- (a BEFORE trigger must not modify other rows the statement is changing). Found while removing the NACL-test dataset: 17 of its 105 competitions could
-- not have their matches deleted in one statement. The same statement is what the Run tab sends when it replaces a schedule
-- (src/data/matches.ts: delete().in('id', oldIds)) and what deleting a competition or event cascades into.
--
-- Fix: the foreign key's own ON DELETE SET NULL clears next_match_id; the table check only has to allow the slot to linger for a moment. The check
-- becomes "a link needs a slot" (next_match_id null OR next_slot not null) and an AFTER DELETE statement trigger clears the leftover slots of the
-- competitions touched. Result after any delete: the same state as before 20261001001700 intended (link and slot both null), without the error.

do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.matches'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'next_match_id IS NULL\) = \(next_slot IS NULL' loop
    execute format('alter table public.matches drop constraint %I', c);
  end loop;
end $$;
alter table public.matches drop constraint if exists matches_next_link_has_slot;
alter table public.matches add constraint matches_next_link_has_slot check (next_match_id is null or next_slot is not null);

drop trigger if exists matches_unlink_before_delete on public.matches;
drop function if exists private.unlink_deleted_match();

create or replace function private.clear_orphan_next_slots() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches m set next_slot = null
  where m.next_match_id is null and m.next_slot is not null and m.competition_id in (select o.competition_id from old_rows o);
  return null;
end $$;
revoke execute on function private.clear_orphan_next_slots() from public, anon, authenticated;
drop trigger if exists matches_clear_orphan_slots on public.matches;
create trigger matches_clear_orphan_slots after delete on public.matches referencing old table as old_rows for each statement execute function private.clear_orphan_next_slots();
