-- The audit log is readable by the platform owner and by an event's organizers. Nobody can write to it except security-definer functions.
create policy audit_log_read on public.audit_log for select to authenticated
  using (private.is_owner() or (event_id is not null and private.is_organizer(event_id)));
grant select on public.audit_log to authenticated;
