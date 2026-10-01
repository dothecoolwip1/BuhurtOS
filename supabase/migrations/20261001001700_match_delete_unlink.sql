-- Deleting one match that another match leads into used to fail with an unreadable error ("violates check constraint matches_check1"):
-- the foreign key next_match_id sets the link to null when the target is deleted, but next_slot stayed set, and the table requires
-- next_match_id and next_slot to be null together. Found by supabase/tests/simulate_tournament.sql.
-- Additive: a BEFORE DELETE trigger clears both link columns on every match that pointed at the match being deleted (it runs as the
-- table owner, because the organizer's own update policy cannot touch a finished match, and a finished match may lead into the one being removed).
-- Deleting a whole schedule in one statement, or a whole competition, behaves as before.
create or replace function private.unlink_deleted_match() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.matches set next_match_id = null, next_slot = null where next_match_id = old.id;
  return old;
end $$;
revoke execute on function private.unlink_deleted_match() from public, anon, authenticated;
drop trigger if exists matches_unlink_before_delete on public.matches;
create trigger matches_unlink_before_delete before delete on public.matches for each row execute function private.unlink_deleted_match();
