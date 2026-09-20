insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waivers', 'waivers', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy waiver_staff_read on storage.objects for select to authenticated using (
  bucket_id = 'waivers' and exists (
    select 1
    from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.waiver_storage_path = name
      and (
        private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin','organization_staff']::public.organization_role[])
        or private.has_event_role((select auth.uid()), e.id, array['event_organizer']::public.event_role[])
      )
  )
);
