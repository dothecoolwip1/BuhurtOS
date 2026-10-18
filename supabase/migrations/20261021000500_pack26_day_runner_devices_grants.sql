-- Pack 26 (with pack26_day_runners_make_counter_qr): the Event Admin tablet is a device session (database role bos_event_device), which can only call
-- the functions it was granted. The functions it may now use to make the Counter QR, mint ordinary device codes and see the device list
-- are granted to it here; each function still decides for itself (private.can_command, and the organizer-only guards for Event Admin and stream
-- controller codes). Every overload is covered, so a hosted database whose signatures carry later additions is treated the same. Additive.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_event_credential', 'list_event_credentials', 'replace_event_credential', 'revoke_event_credential')
  loop
    execute format('grant execute on function %s to bos_event_device', r.sig);
  end loop;
end $$;
