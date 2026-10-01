-- Run private.purge_medical_notes() every day so optional medical notes are deleted 30 days after the event ends
-- (docs/PROJECT_SPEC.md, "Registration, waivers, privacy"). Needs the pg_cron extension, which Supabase offers but does not enable by default.
-- Safe to re-run: the job is replaced if it already exists.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-medical-notes') then
    perform cron.unschedule('purge-medical-notes');
  end if;
  perform cron.schedule('purge-medical-notes', '17 9 * * *', 'select private.purge_medical_notes()');
end $$;
