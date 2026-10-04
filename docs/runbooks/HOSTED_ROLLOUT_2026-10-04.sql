-- BuhurtOS hosted rollout, 2026-10-04. Paste the WHOLE file into the Supabase SQL Editor (project mvbxlebznlgroptwwdsm) and run it once.
-- It applies, in this order, the repository migrations:
--   1. 20261003000600_pack07_ux_workflows.sql
--   2. 20261004000100_pack1_competitions_myevents_days.sql   (re-run; hosted already has Pack 1, so its one non-rerunnable line,
--                                                             `create trigger competitions_guard`, is left out; the trigger already exists)
--   3. 20261004000200_pack07_pack1_reconcile.sql
--   4. 20261004000300_pack08_entrants_and_claims.sql
-- Everything runs in ONE transaction: if any statement fails, nothing changes. The DROP / ALTER / DELETE words in it are schema
-- statements (drop ... if exists before re-creating, a widened check constraint) and DELETEs inside function bodies; no table row is
-- removed by running this file. Checked read-only beforehand: hosted = repository through Pack 1, no Pack 07, no drift in logic.
begin;

do $precheck$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_invitations') then
    raise exception 'ROLLOUT STOPPED: Pack 07 is already on this database (public.event_invitations exists). Nothing was changed.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'competitions_guard' and tgrelid = 'public.competitions'::regclass) then
    raise exception 'ROLLOUT STOPPED: expected the Pack 1 trigger competitions_guard; this database is not in the inspected state. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'registrations' and column_name = 'attend_dates') then
    raise exception 'ROLLOUT STOPPED: expected Pack 1 (registrations.attend_dates). Nothing was changed.';
  end if;
end $precheck$;

-- ======================================================================== 1. 20261003000600_pack07_ux_workflows.sql
-- Pack 07 (2026-10-03): phone-tested workflow fixes. Additive; nothing historical is rewritten.
--   1. Waivers: a version can be text (pasted or started from the BuhurtOS starter template) or an uploaded PDF in the private bucket
--      'waiver-documents'. Versions stay append-only; every registration keeps the exact version it accepted. New versions go through
--      add_waiver_version() which numbers them itself (no client-chosen version numbers) and audits.
--   2. Events: latitude / longitude (venue coordinates from address autocomplete; manual entry never needs them). Public venue facts only.
--   3. Competitions: a delete guard. A competition that has entries, matches, results or registration choices can never be deleted
--      (history is corrected or voided, never dropped); an empty one can.
--   4. Organizer-added fighters: event_invitations. An organizer adds a KNOWN fighter record to an event and chooses competitions. This is
--      not a registration and not staff: the fighter still has to complete the form and accept the waiver themselves. When they do,
--      submit_registration links the invitation and accepts the registration (the organizer already chose them). Fighters can withdraw;
--      organizers can cancel. A fighter record with no linked account can be added, but nobody is notified and nothing can be confirmed
--      until it is claimed. Who added whom is in the audit log, not on the public row.
--   5. Fighter social links (public, optional, the fighter alone edits them) with the same rules as team links.
--   6. Fighter gallery: up to 10 public photos per fighter in the bucket 'fighter-gallery' (<fighter id>/<uuid>.webp|jpg), rows in
--      fighter_gallery, writes only through the owner's own RPCs. The limit is enforced in the database.
--   7. my_event_relations(): the signed-in person's real relationships to events (organizer, staff, fighter, volunteer, invited, captain,
--      organization admin). Being the platform owner is NOT a relationship; owner tools list every event elsewhere.
--   8. Storage: own-folder SELECT policies so a fighter or captain can list and remove their own old files (Storage's remove() needs SELECT).

-- ---------------------------------------------------------------- 1. waivers: text or PDF, one function to add a version
alter table public.waiver_versions
  add column if not exists kind text not null default 'text' check (kind in ('text', 'pdf')),
  add column if not exists source text check (source is null or source in ('template', 'pasted', 'upload')),
  add column if not exists document_path text check (document_path is null or (char_length(document_path) <= 160 and document_path ~ '^[0-9a-f-]{36}/[0-9]+\.pdf$'));
alter table public.waiver_versions alter column body drop not null;
alter table public.waiver_versions drop constraint if exists waiver_versions_kind_shape;
-- NOT VALID: checked for every new or changed version; rows loaded before this pack are left exactly as they were signed.
alter table public.waiver_versions add constraint waiver_versions_kind_shape check (
  (kind = 'text' and body is not null and char_length(btrim(body)) >= 20 and document_path is null)
  or (kind = 'pdf' and document_path is not null and split_part(document_path, '/', 1) = event_id::text)) not valid;
create unique index if not exists waiver_versions_document_path_key on public.waiver_versions (document_path) where document_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waiver-documents', 'waiver-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Organizers of the event upload into the event's folder. A document can be read by the event's organizers and by anyone who may read a
-- waiver version that points at it (the same rule as waiver_read: public event, or organizer). Only a file no version references can be
-- removed, and only by an organizer of that event. Files a version references are immutable, like the version row.
drop policy if exists waiver_docs_insert on storage.objects;
create policy waiver_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'waiver-documents' and name ~ '^[0-9a-f-]{36}/[0-9]+\.pdf$'
    and private.is_organizer(((storage.foldername(name))[1])::uuid));
drop policy if exists waiver_docs_read on storage.objects;
create policy waiver_docs_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'waiver-documents' and (
    (case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then private.is_organizer(((storage.foldername(name))[1])::uuid) else false end)
    or exists (select 1 from public.waiver_versions w where w.document_path = storage.objects.name)));
drop policy if exists waiver_docs_delete_unused on storage.objects;
create policy waiver_docs_delete_unused on storage.objects for delete to authenticated
  using (bucket_id = 'waiver-documents'
    and (case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then private.is_organizer(((storage.foldername(name))[1])::uuid) else false end)
    and not exists (select 1 from public.waiver_versions w where w.document_path = storage.objects.name));

-- Adds the next version. p_kind 'text' needs p_body (20+ characters); 'pdf' needs an uploaded file in the event's folder. p_source records
-- where the text came from (template / pasted / upload) for the organizer's own information only. Returns the new version id.
create or replace function public.add_waiver_version(p_event uuid, p_title text, p_body text, p_kind text default 'text', p_document_path text default null, p_source text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_version int; v_title text := btrim(coalesce(p_title, '')); v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can change its waiver' using errcode = '42501'; end if;
  if char_length(v_title) not between 3 and 120 then raise exception 'give the waiver a title of 3 to 120 characters' using errcode = '22023'; end if;
  if p_kind not in ('text', 'pdf') then raise exception 'a waiver is text or a PDF' using errcode = '22023'; end if;
  if p_source is not null and p_source not in ('template', 'pasted', 'upload') then raise exception 'unknown waiver source' using errcode = '22023'; end if;
  if p_kind = 'text' then
    if v_body is null or char_length(v_body) < 20 then raise exception 'paste the full waiver text (at least 20 characters)' using errcode = '22023'; end if;
    if p_document_path is not null then raise exception 'a text waiver has no document' using errcode = '22023'; end if;
  else
    if p_document_path is null or split_part(p_document_path, '/', 1) <> p_event::text then raise exception 'the document must be uploaded into this event''s waiver folder' using errcode = '22023'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'waiver-documents' and o.name = p_document_path) then raise exception 'the waiver document was not uploaded' using errcode = '22023'; end if;
    if exists (select 1 from public.waiver_versions w where w.document_path = p_document_path) then raise exception 'that document is already a waiver version' using errcode = '22023'; end if;
  end if;
  perform 1 from public.events e where e.id = p_event for update;   -- one version number at a time
  select coalesce(max(version), 0) + 1 into v_version from public.waiver_versions where event_id = p_event;
  insert into public.waiver_versions (event_id, version, title, body, kind, document_path, source)
  values (p_event, v_version, v_title, v_body, p_kind, case when p_kind = 'pdf' then p_document_path end, p_source)
  returning id into v_id;
  perform private.audit(p_event, 'waiver.version_added', v_id::text, jsonb_build_object('version', v_version, 'kind', p_kind, 'source', p_source));
  return v_id;
end $$;
revoke execute on function public.add_waiver_version(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.add_waiver_version(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- 2. venue coordinates
alter table public.events
  add column if not exists latitude double precision check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude double precision check (longitude is null or longitude between -180 and 180);
grant update (latitude, longitude) on public.events to authenticated;

-- ---------------------------------------------------------------- 3. competitions: never delete history
create or replace function private.guard_competition_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.entries where competition_id = old.id)
     or exists (select 1 from public.matches where competition_id = old.id)
     or exists (select 1 from public.results where competition_id = old.id)
     or exists (select 1 from public.registration_competitions where competition_id = old.id) then
    raise exception 'this competition already has entrants, matches, results or registrations; it cannot be deleted' using errcode = '22023';
  end if;
  return old;
end $$;
revoke execute on function private.guard_competition_delete() from public, anon, authenticated;
drop trigger if exists competitions_delete_guard on public.competitions;
create trigger competitions_delete_guard before delete on public.competitions for each row execute function private.guard_competition_delete();

-- ---------------------------------------------------------------- 4. organizer-added fighters
create table if not exists public.event_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'registered', 'withdrawn', 'cancelled')),
  note text check (note is null or char_length(note) <= 300),
  registration_id uuid references public.registrations (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (event_id, fighter_id)
);
create table if not exists public.event_invitation_competitions (
  invitation_id uuid not null references public.event_invitations (id) on delete cascade,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  primary key (invitation_id, competition_id)
);
alter table public.event_invitations enable row level security;
alter table public.event_invitation_competitions enable row level security;
-- Readable by the event's organizers and by the invited fighter (through their own account link). Written only by the functions below.
drop policy if exists event_invitations_read on public.event_invitations;
create policy event_invitations_read on public.event_invitations for select to authenticated
  using (private.is_organizer(event_id) or fighter_id = public.my_fighter_id());
drop policy if exists event_invitation_competitions_read on public.event_invitation_competitions;
create policy event_invitation_competitions_read on public.event_invitation_competitions for select to authenticated
  using (exists (select 1 from public.event_invitations i where i.id = invitation_id and (private.is_organizer(i.event_id) or i.fighter_id = public.my_fighter_id())));
grant select on public.event_invitations, public.event_invitation_competitions to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported',
                  'event_invited', 'registration_withdrawn'));

-- Organizer adds a known fighter record to the event with the competitions they are expected in. Returns {invitation_id, notified}.
-- notified is false when the fighter record has no linked account: nothing is faked, and the organizer is told so.
create or replace function public.invite_fighter_to_event(p_event uuid, p_fighter uuid, p_competitions uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ev public.events; v_fighter public.fighters; v_user uuid; v_id uuid; v_existing public.event_invitations; v_comp uuid; v_names text;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can add fighters' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if v_ev.registration_mode <> 'buhuros' then raise exception 'this event does not take registrations on BuhurtOS' using errcode = '22023'; end if;
  select * into v_fighter from public.fighters where id = p_fighter;
  if not found then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  if p_competitions is null or cardinality(p_competitions) = 0 then raise exception 'choose at least one competition' using errcode = '22023'; end if;
  if char_length(coalesce(v_note, '')) > 300 then raise exception 'keep the note under 300 characters' using errcode = '22023'; end if;
  foreach v_comp in array p_competitions loop
    if not exists (select 1 from public.competitions c where c.id = v_comp and c.event_id = p_event) then raise exception 'a chosen competition does not belong to this event' using errcode = '22023'; end if;
  end loop;
  select user_id into v_user from public.fighter_accounts where fighter_id = p_fighter;
  if v_user is not null and exists (select 1 from public.registrations r where r.event_id = p_event and r.user_id = v_user and r.status in ('pending', 'accepted')) then
    raise exception 'this fighter is already registered for the event' using errcode = '22023'; end if;
  select * into v_existing from public.event_invitations where event_id = p_event and fighter_id = p_fighter;
  if found then
    if v_existing.status = 'invited' then raise exception 'this fighter has already been added and is still pending' using errcode = '22023'; end if;
    if v_existing.status = 'registered' then raise exception 'this fighter has already completed their registration' using errcode = '22023'; end if;
    -- withdrawn or cancelled: adding again reopens it with the new choices
    v_id := v_existing.id;
    update public.event_invitations set status = 'invited', note = v_note, registration_id = null, created_at = now(), decided_at = null where id = v_id;
    delete from public.event_invitation_competitions where invitation_id = v_id;
  else
    insert into public.event_invitations (event_id, fighter_id, note) values (p_event, p_fighter, v_note) returning id into v_id;
  end if;
  insert into public.event_invitation_competitions (invitation_id, competition_id) select v_id, x from unnest(p_competitions) x on conflict do nothing;
  select string_agg(c.name, ', ' order by c.sort, c.name) into v_names from public.competitions c where c.id = any (p_competitions);
  if v_user is not null then
    insert into public.notifications (user_id, kind, payload)
    values (v_user, 'event_invited', jsonb_build_object('invitation_id', v_id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'competitions', v_names, 'note', v_note));
  end if;
  perform private.audit(p_event, 'registration.invited', v_id::text, jsonb_build_object('fighter', p_fighter, 'competitions', to_jsonb(p_competitions), 'notified', v_user is not null));
  return jsonb_build_object('invitation_id', v_id, 'notified', v_user is not null);
end $$;

-- The organizer takes an invitation back (only while it is still pending). The fighter's notice is marked read.
create or replace function public.cancel_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_inv public.event_invitations;
begin
  select * into v_inv from public.event_invitations where id = p_invitation;
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_inv.event_id) then raise exception 'only an organizer of this event can cancel this' using errcode = '42501'; end if;
  if v_inv.status <> 'invited' then raise exception 'this invitation is no longer pending' using errcode = '22023'; end if;
  update public.event_invitations set status = 'cancelled', decided_at = now() where id = p_invitation;
  update public.notifications set read_at = coalesce(read_at, now()) where kind = 'event_invited' and payload ->> 'invitation_id' = p_invitation::text;
  perform private.audit(v_inv.event_id, 'registration.invitation_cancelled', p_invitation::text);
end $$;

-- The fighter says no (only while pending). The organizers are told.
create or replace function public.withdraw_my_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_inv public.event_invitations; v_ev public.events; v_name text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_inv from public.event_invitations where id = p_invitation;
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if v_inv.fighter_id is distinct from public.my_fighter_id() then raise exception 'only the fighter who was added can withdraw' using errcode = '42501'; end if;
  if v_inv.status <> 'invited' then raise exception 'this invitation is no longer pending' using errcode = '22023'; end if;
  update public.event_invitations set status = 'withdrawn', decided_at = now() where id = p_invitation;
  update public.notifications set read_at = coalesce(read_at, now()) where kind = 'event_invited' and payload ->> 'invitation_id' = p_invitation::text;
  select * into v_ev from public.events where id = v_inv.event_id;
  select display_name into v_name from public.fighters where id = v_inv.fighter_id;
  insert into public.notifications (user_id, kind, payload)
  select u, 'registration_withdrawn', jsonb_build_object('invitation_id', p_invitation, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'person_name', v_name)
  from private.event_organizer_users(v_inv.event_id) u where u is distinct from auth.uid();
  perform private.audit(v_inv.event_id, 'registration.invitation_withdrawn', p_invitation::text);
end $$;

-- What the organizer sees: every fighter they added, what is still missing, and whether the record can confirm at all (has_account).
-- has_account is a yes/no only; no account id leaves the database.
create or replace function public.list_event_invitations(p_event uuid)
returns table (invitation_id uuid, fighter_id uuid, display_name text, team_name text, status text, has_account boolean, note text, competitions jsonb,
               registration_id uuid, registration_status text, created_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.fighter_id, f.display_name, t.name, i.status, exists (select 1 from public.fighter_accounts a where a.fighter_id = i.fighter_id), i.note,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name)
              from public.event_invitation_competitions ic join public.competitions c on c.id = ic.competition_id where ic.invitation_id = i.id), '[]'::jsonb),
    i.registration_id, r.status, i.created_at, i.decided_at
  from public.event_invitations i
  join public.fighters f on f.id = i.fighter_id
  left join public.teams t on t.id = f.team_id and t.status = 'approved'
  left join public.registrations r on r.id = i.registration_id
  where i.event_id = p_event and private.is_organizer(p_event)
  order by (i.status = 'invited') desc, lower(f.display_name), i.id
$$;

revoke execute on function public.invite_fighter_to_event(uuid, uuid, uuid[], text), public.cancel_invitation(uuid), public.withdraw_my_invitation(uuid), public.list_event_invitations(uuid) from public, anon;
grant execute on function public.invite_fighter_to_event(uuid, uuid, uuid[], text), public.cancel_invitation(uuid), public.withdraw_my_invitation(uuid), public.list_event_invitations(uuid) to authenticated;

-- Accepting a registration, in one place: links the account to its fighter, creates the competition entries, marks it accepted.
-- Used by decide_registration (an organizer's decision) and by submit_registration when the organizer had already added the fighter.
create or replace function private.accept_registration_core(p_reg uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reg public.registrations; v_rc record; v_fighter uuid; v_league text;
begin
  select * into v_reg from public.registrations where id = p_reg;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  v_fighter := private.ensure_fighter_for_account(v_reg.user_id, v_reg.full_name, v_reg.team_id, 'registration');
  update public.registrations set fighter_id = v_fighter where id = p_reg;
  for v_rc in select rc.*, c.category from public.registration_competitions rc join public.competitions c on c.id = rc.competition_id where rc.registration_id = p_reg loop
    select league into v_league from public.ref_categories where code = v_rc.category;
    if v_league = 'buhurt' then
      if v_rc.team_id is not null then
        insert into public.entries (competition_id, team_id) values (v_rc.competition_id, v_rc.team_id) on conflict (competition_id, team_id) do nothing;
      end if;
    else
      insert into public.entries (competition_id, fighter_id) values (v_rc.competition_id, v_fighter) on conflict (competition_id, fighter_id) do update set status = 'registered';
    end if;
  end loop;
  update public.registrations set status = 'accepted', decided_at = now() where id = p_reg;
end $$;
revoke execute on function private.accept_registration_core(uuid) from public, anon, authenticated;

-- Organizer accepts or declines (same behaviour as before; the accept body moved to accept_registration_core).
create or replace function public.decide_registration(p_reg uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reg public.registrations;
begin
  select * into v_reg from public.registrations where id = p_reg;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_reg.event_id) then raise exception 'only an organizer can decide registrations' using errcode = '42501'; end if;
  if p_status not in ('accepted', 'declined', 'pending') then raise exception 'unknown status' using errcode = '22023'; end if;
  if v_reg.status = 'withdrawn' then raise exception 'this registration was withdrawn; the person has to register again' using errcode = '22023'; end if;
  if p_status = 'accepted' then
    perform private.accept_registration_core(p_reg);
  else
    if v_reg.status = 'accepted' then
      -- Reversing an acceptance withdraws the person's own duel entries; team entries are left for the organizer.
      update public.entries set status = 'withdrawn' where fighter_id = v_reg.fighter_id and competition_id in (select competition_id from public.registration_competitions where registration_id = p_reg);
    end if;
    update public.registrations set status = p_status, decided_at = now() where id = p_reg;
  end if;
  perform private.audit(v_reg.event_id, 'registration.' || p_status, p_reg::text);
end $$;

-- The registration form, as before, plus: a fighter the organizer added may complete it after the window closes, and completing it
-- links the invitation and accepts the registration at once (the organizer chose them; insurance, fee and check-in still apply).
create or replace function public.submit_registration(p_event uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg uuid;
  v_waiver public.waiver_versions;
  v_comp jsonb;
  v_volunteer boolean := coalesce((p_data ->> 'is_volunteer')::boolean, false);
  v_priv jsonb := coalesce(p_data -> 'private', '{}'::jsonb);
  v_existing public.registrations;
  v_days text[];
  v_roles text[];
  v_my_fighter uuid;
  v_inv public.event_invitations;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_event from public.events where id = p_event;
  if not found or v_event.status <> 'published' then raise exception 'this event is not open for registration' using errcode = 'P0002'; end if;
  select fighter_id into v_my_fighter from public.fighter_accounts where user_id = auth.uid();
  if v_my_fighter is not null then
    select * into v_inv from public.event_invitations where event_id = p_event and fighter_id = v_my_fighter and status = 'invited';
  end if;
  if v_inv.id is null then
    if v_event.registration_opens_at is not null and now() < v_event.registration_opens_at then raise exception 'registration has not opened yet' using errcode = '22023'; end if;
    if v_event.registration_closes_at is not null and now() > v_event.registration_closes_at then raise exception 'registration is closed' using errcode = '22023'; end if;
  end if;

  if coalesce((p_data ->> 'waiver_agree')::boolean, false) is not true then raise exception 'the waiver must be accepted to take part' using errcode = '22023'; end if;
  select * into v_waiver from public.waiver_versions where id = (p_data ->> 'waiver_version_id')::uuid and event_id = p_event;
  if not found then raise exception 'unknown waiver version' using errcode = '22023'; end if;
  if v_waiver.version <> (select max(version) from public.waiver_versions where event_id = p_event) then raise exception 'the waiver was updated, please read and accept the new version' using errcode = '22023'; end if;
  if char_length(coalesce(p_data ->> 'waiver_signed_name', '')) < 2 then raise exception 'type your full name to sign the waiver' using errcode = '22023'; end if;

  if (p_data ->> 'insurance') is null or (p_data ->> 'insurance') not in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover') then
    raise exception 'choose an insurance option' using errcode = '22023'; end if;
  if coalesce((v_priv ->> 'medically_fit')::boolean, false) is not true then raise exception 'you must declare that you are medically fit to take part' using errcode = '22023'; end if;
  if char_length(coalesce(v_priv ->> 'emergency_name', '')) < 2 or char_length(coalesce(v_priv ->> 'emergency_phone', '')) < 7 then raise exception 'emergency contact name and phone are required' using errcode = '22023'; end if;
  if not v_volunteer and jsonb_array_length(coalesce(p_data -> 'competitions', '[]'::jsonb)) = 0 then raise exception 'choose at least one category, or sign up as a volunteer' using errcode = '22023'; end if;

  select * into v_existing from public.registrations where event_id = p_event and user_id = auth.uid();
  if found and v_existing.status not in ('pending', 'declined', 'withdrawn') then raise exception 'your registration was already accepted; ask an organizer to change it' using errcode = '22023'; end if;

  v_days := coalesce(array(select jsonb_array_elements_text(p_data -> 'days')), '{}');
  v_roles := coalesce(array(select jsonb_array_elements_text(p_data -> 'volunteer_roles')), '{}');

  insert into public.registrations as r (event_id, user_id, status, full_name, gender, organization, province, team_id, team_name, shares_equipment, days, availability_notes,
      bi_profile, insurance, is_volunteer, volunteer_roles, mercenary, notes, fee_due_cents, waiver_version_id, waiver_signed_name, waiver_signed_at)
  values (p_event, auth.uid(), 'pending', p_data ->> 'full_name', p_data ->> 'gender', p_data ->> 'organization', nullif(p_data ->> 'province', ''),
      nullif(p_data ->> 'team_id', '')::uuid, nullif(p_data ->> 'team_name', ''), coalesce((p_data ->> 'shares_equipment')::boolean, false), v_days, nullif(p_data ->> 'availability_notes', ''),
      nullif(p_data ->> 'bi_profile', ''), p_data ->> 'insurance', v_volunteer, v_roles, coalesce((p_data ->> 'mercenary')::boolean, false), nullif(p_data ->> 'notes', ''),
      private.compute_fee(p_event, p_data ->> 'province', v_volunteer), v_waiver.id, p_data ->> 'waiver_signed_name', now())
  on conflict (event_id, user_id) do update set status = 'pending', full_name = excluded.full_name, gender = excluded.gender, organization = excluded.organization, province = excluded.province,
      team_id = excluded.team_id, team_name = excluded.team_name, shares_equipment = excluded.shares_equipment, days = excluded.days, availability_notes = excluded.availability_notes,
      bi_profile = excluded.bi_profile, insurance = excluded.insurance, is_volunteer = excluded.is_volunteer, volunteer_roles = excluded.volunteer_roles, mercenary = excluded.mercenary,
      notes = excluded.notes, fee_due_cents = excluded.fee_due_cents, waiver_version_id = excluded.waiver_version_id, waiver_signed_name = excluded.waiver_signed_name, waiver_signed_at = now()
  returning r.id into v_reg;

  insert into public.registration_private as p (registration_id, email, emergency_name, emergency_relationship, emergency_phone, medically_fit, medical_note)
  values (v_reg, coalesce(v_priv ->> 'email', ''), v_priv ->> 'emergency_name', coalesce(v_priv ->> 'emergency_relationship', ''), v_priv ->> 'emergency_phone', true, nullif(v_priv ->> 'medical_note', ''))
  on conflict (registration_id) do update set email = excluded.email, emergency_name = excluded.emergency_name, emergency_relationship = excluded.emergency_relationship,
      emergency_phone = excluded.emergency_phone, medically_fit = true, medical_note = excluded.medical_note;

  delete from public.registration_competitions where registration_id = v_reg;
  for v_comp in select * from jsonb_array_elements(coalesce(p_data -> 'competitions', '[]'::jsonb)) loop
    if not exists (select 1 from public.competitions where id = (v_comp ->> 'competition_id')::uuid and event_id = p_event) then
      raise exception 'a chosen category does not belong to this event' using errcode = '22023'; end if;
    insert into public.registration_competitions (registration_id, competition_id, team_id, details)
    values (v_reg, (v_comp ->> 'competition_id')::uuid, nullif(v_comp ->> 'team_id', '')::uuid, coalesce(v_comp -> 'details', '{}'::jsonb));
  end loop;

  perform private.audit(p_event, 'registration.submitted', v_reg::text);

  if v_inv.id is not null then
    update public.event_invitations set status = 'registered', registration_id = v_reg, decided_at = now() where id = v_inv.id;
    update public.notifications set read_at = coalesce(read_at, now()) where kind = 'event_invited' and payload ->> 'invitation_id' = v_inv.id::text;
    perform private.accept_registration_core(v_reg);
    perform private.audit(p_event, 'registration.accepted', v_reg::text, jsonb_build_object('via', 'invitation', 'invitation', v_inv.id));
  end if;
  return v_reg;
end $$;

-- The person withdraws their own registration (or an organizer does it for them). Accepted duel entries are withdrawn; team entries are
-- left for the organizer, as when an acceptance is reversed. A withdrawn registration can be submitted again later.
create or replace function public.withdraw_registration(p_reg uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reg public.registrations;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_reg from public.registrations where id = p_reg;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  if v_reg.user_id <> auth.uid() and not private.is_organizer(v_reg.event_id) then raise exception 'only the person who registered, or an organizer, can withdraw it' using errcode = '42501'; end if;
  if v_reg.status not in ('pending', 'accepted') then raise exception 'this registration is not active' using errcode = '22023'; end if;
  if v_reg.status = 'accepted' and v_reg.fighter_id is not null then
    update public.entries set status = 'withdrawn' where fighter_id = v_reg.fighter_id and competition_id in (select competition_id from public.registration_competitions where registration_id = p_reg);
  end if;
  update public.registrations set status = 'withdrawn', decided_at = now() where id = p_reg;
  update public.event_invitations set status = 'withdrawn', decided_at = now() where registration_id = p_reg and status = 'registered';
  perform private.audit(v_reg.event_id, 'registration.withdrawn', p_reg::text, jsonb_build_object('by_organizer', v_reg.user_id <> auth.uid()));
end $$;
revoke execute on function public.withdraw_registration(uuid) from public, anon;
grant execute on function public.withdraw_registration(uuid) to authenticated;

-- Notifications: as before, plus organizers hear when a person withdraws.
create or replace function private.registration_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = new.event_id;
  if not found then return new; end if;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    insert into public.notifications (user_id, kind, payload)
    select u, 'registration_submitted', jsonb_build_object('registration_id', new.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'person_name', new.full_name, 'volunteer', new.is_volunteer)
    from private.event_organizer_users(new.event_id) u where u is distinct from new.user_id;
  elsif tg_op = 'UPDATE' and new.status in ('accepted', 'declined') and old.status is distinct from new.status then
    insert into public.notifications (user_id, kind, payload)
    values (new.user_id, 'registration_decided', jsonb_build_object('registration_id', new.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'decision', new.status));
    -- The organizers' "new sign-up" notice is done with once someone has decided it.
    update public.notifications set read_at = coalesce(read_at, now()) where kind = 'registration_submitted' and payload ->> 'registration_id' = new.id::text;
  elsif tg_op = 'UPDATE' and new.status = 'withdrawn' and old.status is distinct from 'withdrawn' then
    insert into public.notifications (user_id, kind, payload)
    select u, 'registration_withdrawn', jsonb_build_object('registration_id', new.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug, 'person_name', new.full_name)
    from private.event_organizer_users(new.event_id) u where u is distinct from new.user_id and u is distinct from auth.uid();
    update public.notifications set read_at = coalesce(read_at, now()) where kind = 'registration_submitted' and payload ->> 'registration_id' = new.id::text;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 5. fighter social links
-- Same rules as team links: known networks only, full https:// addresses, at most 8. Shared by the team and fighter functions.
create or replace function private.clean_social_links(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '{}'::jsonb; sk text; sv jsonb;
  c_url constant text := '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$';
begin
  if p is null or jsonb_typeof(p) = 'null' then return v_out; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'social links must be a list of name and address' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(p)) > 8 then raise exception 'at most 8 social links' using errcode = '22023'; end if;
  for sk, sv in select key, value from jsonb_each(p) loop
    if sk <> all (array['facebook','instagram','youtube','tiktok','x','discord','twitch','other']) then raise exception 'unknown social link: %', left(sk, 40) using errcode = '22023'; end if;
    if jsonb_typeof(sv) <> 'string' or char_length(sv #>> '{}') > 300 or btrim(sv #>> '{}') !~ c_url then raise exception 'the % link must be a full https:// address', sk using errcode = '22023'; end if;
    v_out := v_out || jsonb_build_object(sk, btrim(sv #>> '{}'));
  end loop;
  return v_out;
end $$;
revoke execute on function private.clean_social_links(jsonb) from public, anon, authenticated;

alter table public.fighters add column if not exists social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object');

-- Keys (all optional, null clears): gender, birth_year, city, region, country, joined_year, disciplines, fighting_style, bio, highlights,
-- and now social_links (object of network -> https address). Unknown keys are refused. The caller must own a fighter record.
create or replace function public.update_my_fighter_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f uuid; k text; v jsonb; v_txt text; v_year int; v_arr text[]; v_max int;
  t_text constant text[] := array['gender','city','region','country','fighting_style','bio'];
  t_int constant text[] := array['birth_year','joined_year'];
  t_arr constant text[] := array['disciplines','highlights'];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send the profile as an object' using errcode = '22023'; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k = any (t_text) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception '% must be text', k using errcode = '22023'; end if;
      v_txt := nullif(btrim(v #>> '{}'), '');
      v_max := case k when 'bio' then 1500 when 'fighting_style' then 120 else 80 end;
      if char_length(coalesce(v_txt, '')) > v_max then raise exception '% is too long', k using errcode = '22023'; end if;
      if k = 'gender' and v_txt is not null and v_txt not in ('male', 'female', 'other') then raise exception 'gender must be male, female or other' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_txt, v_f;
    elsif k = any (t_int) then
      if jsonb_typeof(v) = 'null' then v_year := null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{4}$' then raise exception '% must be a four digit year', k using errcode = '22023';
      else v_year := (v #>> '{}')::int; end if;
      if v_year is not null and k = 'birth_year' and v_year not between 1900 and extract(year from current_date)::int then raise exception 'birth year is out of range' using errcode = '22023'; end if;
      if v_year is not null and k = 'joined_year' and v_year not between 1990 and extract(year from current_date)::int then raise exception 'joined year is out of range' using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_year, v_f;
    elsif k = any (t_arr) then
      if jsonb_typeof(v) = 'null' then v_arr := '{}';
      elsif jsonb_typeof(v) <> 'array' then raise exception '% must be a list', k using errcode = '22023';
      else
        if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then raise exception 'every item in % must be text', k using errcode = '22023'; end if;
        select coalesce(array_agg(btrim(e #>> '{}') order by o), '{}') into v_arr from jsonb_array_elements(v) with ordinality x(e, o);
      end if;
      v_max := case k when 'disciplines' then 12 else 10 end;
      if cardinality(v_arr) > v_max then raise exception 'too many items in %', k using errcode = '22023'; end if;
      execute format('update public.fighters set %I = $1 where id = $2', k) using v_arr, v_f;
    elsif k = 'social_links' then
      update public.fighters set social_links = private.clean_social_links(v) where id = v_f;
    else
      raise exception 'the profile has a field this version does not know: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  perform private.audit(null, 'fighter.profile_updated', v_f::text, jsonb_build_object('fields', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(p) key)));
end $$;

-- ---------------------------------------------------------------- 6. fighter gallery
create table if not exists public.fighter_gallery (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 120 and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = fighter_id::text)
);
create index if not exists fighter_gallery_fighter_idx on public.fighter_gallery (fighter_id, sort_order, created_at);
alter table public.fighter_gallery enable row level security;
drop policy if exists fighter_gallery_public_read on public.fighter_gallery;
create policy fighter_gallery_public_read on public.fighter_gallery for select to anon, authenticated using (true);
grant select on public.fighter_gallery to anon, authenticated;   -- no write grant: the owner's functions below only

-- Ten photos at most, whoever writes the row.
create or replace function private.guard_gallery_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.fighter_gallery g where g.fighter_id = new.fighter_id and g.id <> new.id) >= 10 then
    raise exception 'a gallery holds at most 10 photos' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.guard_gallery_limit() from public, anon, authenticated;
drop trigger if exists fighter_gallery_limit on public.fighter_gallery;
create trigger fighter_gallery_limit before insert on public.fighter_gallery for each row execute function private.guard_gallery_limit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fighter-gallery', 'fighter-gallery', true, 4194304, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists gallery_insert_own on storage.objects;
create policy gallery_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'fighter-gallery' and (storage.foldername(name))[1] = public.my_fighter_id()::text);
drop policy if exists gallery_select_own on storage.objects;
create policy gallery_select_own on storage.objects for select to authenticated
  using (bucket_id = 'fighter-gallery' and (storage.foldername(name))[1] = public.my_fighter_id()::text);
drop policy if exists gallery_delete_own on storage.objects;
create policy gallery_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'fighter-gallery' and (storage.foldername(name))[1] = public.my_fighter_id()::text);

-- After the file is uploaded into the caller's own folder: records it as the last photo. Returns the row id.
create or replace function public.add_my_gallery_photo(p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_f uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gallery:' || v_f::text, 0));
  if p_path is null or split_part(p_path, '/', 1) <> v_f::text then raise exception 'that photo is not in your folder' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'fighter-gallery' and o.name = p_path) then raise exception 'the photo was not uploaded' using errcode = '22023'; end if;
  if (select count(*) from public.fighter_gallery where fighter_id = v_f) >= 10 then raise exception 'a gallery holds at most 10 photos' using errcode = '22023'; end if;
  insert into public.fighter_gallery (fighter_id, storage_path, sort_order)
  values (v_f, p_path, coalesce((select max(sort_order) from public.fighter_gallery where fighter_id = v_f), -1) + 1) returning id into v_id;
  perform private.audit(null, 'fighter.gallery_added', v_f::text, jsonb_build_object('photo', v_id));
  return v_id;
end $$;

-- Removes the row; the caller then removes the file (own-folder policy). Returns the storage path so the client can.
create or replace function public.remove_my_gallery_photo(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_f uuid; v_path text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  delete from public.fighter_gallery where id = p_id and fighter_id = v_f returning storage_path into v_path;
  if v_path is null then raise exception 'that photo is not in your gallery' using errcode = '42501'; end if;
  perform private.audit(null, 'fighter.gallery_removed', v_f::text, jsonb_build_object('photo', p_id));
  return v_path;
end $$;

-- The new order: exactly the caller's photo ids, first to last.
create or replace function public.reorder_my_gallery(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_f uuid; v_n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select fighter_id into v_f from public.fighter_accounts where user_id = auth.uid();
  if v_f is null then raise exception 'you have no fighter profile yet' using errcode = '42501'; end if;
  select count(*) into v_n from public.fighter_gallery where fighter_id = v_f;
  if p_ids is null or cardinality(p_ids) <> v_n or (select count(distinct x) from unnest(p_ids) x) <> v_n
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.fighter_gallery g where g.id = x and g.fighter_id = v_f)) then
    raise exception 'the order must list each of your photos once' using errcode = '22023';
  end if;
  update public.fighter_gallery g set sort_order = o.n - 1 from unnest(p_ids) with ordinality o(id, n) where g.id = o.id and g.fighter_id = v_f;
end $$;
revoke execute on function public.add_my_gallery_photo(text), public.remove_my_gallery_photo(uuid), public.reorder_my_gallery(uuid[]) from public, anon;
grant execute on function public.add_my_gallery_photo(text), public.remove_my_gallery_photo(uuid), public.reorder_my_gallery(uuid[]) to authenticated;

-- ---------------------------------------------------------------- 7. my events: real relationships only
-- One row per (event, role) for the signed-in person. Nothing here comes from platform-wide powers: the owner gets only the events they
-- personally organize, fight at, captain into, staff or administer.
create or replace function public.my_event_relations()
returns table (event_id uuid, role text)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid, public.my_fighter_id() as fid)
  select s.event_id, s.role from public.event_staff s, me where s.user_id = me.uid
  union
  select r.event_id, case when r.is_volunteer then 'volunteer' else 'fighter' end from public.registrations r, me where r.user_id = me.uid and r.status in ('pending', 'accepted')
  union
  select i.event_id, 'invited' from public.event_invitations i, me where me.fid is not null and i.fighter_id = me.fid and i.status = 'invited'
  union
  select c.event_id, 'fighter' from public.entries e join public.competitions c on c.id = e.competition_id, me
    where me.fid is not null and e.fighter_id = me.fid and e.status <> 'withdrawn'
  union
  select c.event_id, 'fighter' from public.entry_fighters ef join public.entries e on e.id = ef.entry_id join public.competitions c on c.id = e.competition_id, me
    where me.fid is not null and ef.fighter_id = me.fid and e.status <> 'withdrawn'
  union
  select c.event_id, 'captain' from public.team_roles tr join public.entries e on e.team_id = tr.team_id join public.competitions c on c.id = e.competition_id, me
    where tr.user_id = me.uid and tr.role = 'captain' and e.status <> 'withdrawn'
  union
  select ev.id, 'org_admin' from public.organization_staff os join public.events ev on private.event_org(ev.id) = os.organization_id, me
    where os.user_id = me.uid and os.role = 'admin'
$$;
revoke execute on function public.my_event_relations() from public, anon;
grant execute on function public.my_event_relations() to authenticated;

-- ---------------------------------------------------------------- 8. own-folder reads on the existing picture buckets
-- Storage's remove() needs SELECT on the object; without it old photos and emblems were silently left behind.
drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.my_fighter_id()::text);
drop policy if exists team_emblems_select_editor on storage.objects;
create policy team_emblems_select_editor on storage.objects for select to authenticated
  using (bucket_id = 'team-emblems' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_edit_team(((storage.foldername(name))[1])::uuid) else false end);


-- ======================================================================== 2. 20261004000100_pack1_competitions_myevents_days.sql (re-run)
-- Pack 1 (2026-10-04): the corrective pack after the full-site audit (docs/reviews/2026-10-03-full-site-mobile-desktop-audit.md).
-- Three database changes, all additive:
--   1. Competition setup through controlled functions (create / update / remove), audited, organizer-only, with a trigger that
--      stops anyone (even through the plain REST path the organizer policy allows) from removing a competition that already has
--      entries, registrations or matches, or from changing the category or division once matches exist. Loaders without a
--      signed-in user (seeds, cleanup scripts, migrations) are not affected.
--   2. public.my_events(): the events a signed-in person has a DIRECT relationship with (event staff of any role, their own
--      registration, an entry of their fighter, an entry of a team they captain). The platform owner is not special here.
--      Drafts are returned only to the event's staff and to people who registered while it was published.
--   3. registrations.attend_dates: the calendar days a registrant can attend, chosen from the event's own dates. The old
--      `days` column (sat/sun, Rumble-specific) stays for history and is still accepted.

-- ---------------------------------------------------------------- 1. competition setup
create or replace function private.competitions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Seeds, cleanup and maintenance run as the database owner without a signed-in user; they keep their cascades.
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.entries e where e.competition_id = old.id)
       or exists (select 1 from public.matches m where m.competition_id = old.id)
       or exists (select 1 from public.results r where r.competition_id = old.id)
       or exists (select 1 from public.registration_competitions rc where rc.competition_id = old.id) then
      raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.category, new.gender) is distinct from (old.category, old.gender)
     and exists (select 1 from public.matches m where m.competition_id = old.id) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  if old.status = 'finished' and (new.name, new.category, new.gender, new.ruleset, new.rounds_to_win) is distinct from (old.name, old.category, old.gender, old.ruleset, old.rounds_to_win) then
    raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.competitions_guard() from public, anon, authenticated;
-- [rollout note] `create trigger competitions_guard` omitted: hosted already has this exact trigger from the earlier Pack 1 run (checked by the precheck above).

create or replace function public.create_competition(p_event uuid, p_name text, p_category text, p_gender text default 'open', p_ruleset text default null,
                                                     p_structure text default 'round_robin', p_rounds_to_win integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sort integer; v_name text := left(btrim(coalesce(p_name, '')), 80);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.is_organizer(p_event) then raise exception 'only the organizers of this event can set up its competitions' using errcode = '42501'; end if;
  if char_length(v_name) < 2 then raise exception 'give the competition a name of at least 2 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.ref_categories c where c.code = p_category) then raise exception 'choose a category from the list' using errcode = '22023'; end if;
  if p_gender not in ('open', 'men', 'women') then raise exception 'choose a division: open, men or women' using errcode = '22023'; end if;
  if p_structure not in ('round_robin', 'pools_elimination', 'elimination') then raise exception 'choose a structure from the list' using errcode = '22023'; end if;
  if p_rounds_to_win is not null and (p_rounds_to_win < 1 or p_rounds_to_win > 5) then raise exception 'rounds to win must be between 1 and 5' using errcode = '22023'; end if;
  select coalesce(max(k.sort), 0) + 1 into v_sort from public.competitions k where k.event_id = p_event;
  insert into public.competitions (event_id, name, category, gender, ruleset, structure, rounds_to_win, status, sort)
  values (p_event, v_name, p_category, p_gender, nullif(left(btrim(coalesce(p_ruleset, '')), 120), ''), p_structure, p_rounds_to_win, 'registration', v_sort)
  returning id into v_id;
  perform private.audit(p_event, 'competition.created', v_id::text, jsonb_build_object('name', v_name, 'category', p_category, 'gender', p_gender, 'structure', p_structure, 'rounds_to_win', p_rounds_to_win));
  return v_id;
end $$;
revoke execute on function public.create_competition(uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function public.create_competition(uuid, text, text, text, text, text, integer) to authenticated;

create or replace function public.update_competition(p_comp uuid, p_name text, p_category text, p_gender text, p_ruleset text, p_structure text, p_rounds_to_win integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_event uuid; v_name text := left(btrim(coalesce(p_name, '')), 80); v_has_matches boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions k where k.id = p_comp;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  v_event := v_k.event_id;
  if not private.is_organizer(v_event) then raise exception 'only the organizers of this event can change its competitions' using errcode = '42501'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001'; end if;
  if char_length(v_name) < 2 then raise exception 'give the competition a name of at least 2 letters' using errcode = '22023'; end if;
  if not exists (select 1 from public.ref_categories c where c.code = p_category) then raise exception 'choose a category from the list' using errcode = '22023'; end if;
  if p_gender not in ('open', 'men', 'women') then raise exception 'choose a division: open, men or women' using errcode = '22023'; end if;
  if p_structure not in ('round_robin', 'pools_elimination', 'elimination') then raise exception 'choose a structure from the list' using errcode = '22023'; end if;
  if p_rounds_to_win is not null and (p_rounds_to_win < 1 or p_rounds_to_win > 5) then raise exception 'rounds to win must be between 1 and 5' using errcode = '22023'; end if;
  v_has_matches := exists (select 1 from public.matches m where m.competition_id = p_comp);
  if v_has_matches and (p_category, p_gender) is distinct from (v_k.category, v_k.gender) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  update public.competitions set name = v_name, category = p_category, gender = p_gender, ruleset = nullif(left(btrim(coalesce(p_ruleset, '')), 120), ''),
    -- Once a draw exists the structure belongs to the draw (build_schedule sets it); only the setup fields change.
    structure = case when v_has_matches then structure else p_structure end,
    rounds_to_win = p_rounds_to_win
  where id = p_comp;
  perform private.audit(v_event, 'competition.updated', p_comp::text, jsonb_build_object('name', v_name, 'category', p_category, 'gender', p_gender, 'structure', p_structure, 'rounds_to_win', p_rounds_to_win, 'had_matches', v_has_matches));
end $$;
revoke execute on function public.update_competition(uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function public.update_competition(uuid, text, text, text, text, text, integer) to authenticated;

-- Removing a competition is only possible while nothing depends on it. Anything with registrations, entries, matches or results stays
-- (withdraw entries and reopen matches first; a finished competition is a record and never goes away this way).
create or replace function public.delete_competition(p_comp uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions k where k.id = p_comp;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only the organizers of this event can remove its competitions' using errcode = '42501'; end if;
  if exists (select 1 from public.entries e where e.competition_id = p_comp)
     or exists (select 1 from public.matches m where m.competition_id = p_comp)
     or exists (select 1 from public.results r where r.competition_id = p_comp)
     or exists (select 1 from public.registration_competitions rc where rc.competition_id = p_comp) then
    raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
  end if;
  delete from public.competitions where id = p_comp;
  perform private.audit(v_k.event_id, 'competition.deleted', p_comp::text, jsonb_build_object('name', v_k.name, 'category', v_k.category, 'gender', v_k.gender));
end $$;
revoke execute on function public.delete_competition(uuid) from public, anon;
grant execute on function public.delete_competition(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. my events
create or replace function public.my_events() returns table (
  id uuid, slug text, name text, status text, event_type text, starts_on date, ends_on date, city text, region text, venue text, registration_mode text,
  synthetic boolean, staff_roles text[], registration_id uuid, registration_status text, fee_due_cents integer, fee_paid boolean, insurance text,
  is_volunteer boolean, checked_in boolean, fighter_entry boolean, captain_entry boolean, pending_registrations integer
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  my_fighters as (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = (select uid from me)),
  staff as (select s.event_id, array_agg(distinct s.role order by s.role) as roles from public.event_staff s where s.user_id = (select uid from me) group by s.event_id),
  regs as (
    select r.event_id, r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer,
           exists (select 1 from public.registration_checks c where c.registration_id = r.id and c.check_name = 'checked_in' and c.passed) as checked_in
    from public.registrations r where r.user_id = (select uid from me)),
  fighter as (
    select distinct k.event_id from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and (e.fighter_id in (select fighter_id from my_fighters)
           or e.id in (select ef.entry_id from public.entry_fighters ef where ef.fighter_id in (select fighter_id from my_fighters)))),
  captain as (
    select distinct k.event_id from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and e.team_id in (select tr.team_id from public.team_roles tr where tr.user_id = (select uid from me) and tr.role = 'captain')),
  ids as (select event_id from staff union select event_id from regs union select event_id from fighter union select event_id from captain)
  select ev.id, ev.slug, ev.name, ev.status, ev.event_type, ev.starts_on, ev.ends_on, ev.city, ev.region, ev.venue, ev.registration_mode,
         private.is_synthetic('event', ev.id),
         coalesce(s.roles, '{}'::text[]), r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer, coalesce(r.checked_in, false),
         ev.id in (select event_id from fighter), ev.id in (select event_id from captain),
         case when coalesce(s.roles, '{}'::text[]) @> array['organizer'] then (select count(*)::integer from public.registrations x where x.event_id = ev.id and x.status = 'pending') end
  from public.events ev
  join ids on ids.event_id = ev.id
  left join staff s on s.event_id = ev.id
  left join regs r on r.event_id = ev.id
  where (select uid from me) is not null
    and (ev.status = 'published' or s.roles is not null or r.id is not null)
  order by ev.starts_on, ev.name
$$;
revoke execute on function public.my_events() from public, anon;
grant execute on function public.my_events() to authenticated;

-- ---------------------------------------------------------------- 3. attendance dates
alter table public.registrations add column if not exists attend_dates date[] not null default '{}';

create or replace function public.submit_registration(p_event uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg uuid;
  v_waiver public.waiver_versions;
  v_comp jsonb;
  v_volunteer boolean := coalesce((p_data ->> 'is_volunteer')::boolean, false);
  v_priv jsonb := coalesce(p_data -> 'private', '{}'::jsonb);
  v_existing public.registrations;
  v_days text[];
  v_dates date[];
  v_roles text[];
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_event from public.events where id = p_event;
  if not found or v_event.status <> 'published' then raise exception 'this event is not open for registration' using errcode = 'P0002'; end if;
  if v_event.registration_opens_at is not null and now() < v_event.registration_opens_at then raise exception 'registration has not opened yet' using errcode = '22023'; end if;
  if v_event.registration_closes_at is not null and now() > v_event.registration_closes_at then raise exception 'registration is closed' using errcode = '22023'; end if;

  if coalesce((p_data ->> 'waiver_agree')::boolean, false) is not true then raise exception 'the waiver must be accepted to take part' using errcode = '22023'; end if;
  select * into v_waiver from public.waiver_versions where id = (p_data ->> 'waiver_version_id')::uuid and event_id = p_event;
  if not found then raise exception 'unknown waiver version' using errcode = '22023'; end if;
  if v_waiver.version <> (select max(version) from public.waiver_versions where event_id = p_event) then raise exception 'the waiver was updated, please read and accept the new version' using errcode = '22023'; end if;
  if char_length(coalesce(p_data ->> 'waiver_signed_name', '')) < 2 then raise exception 'type your full name to sign the waiver' using errcode = '22023'; end if;

  if (p_data ->> 'insurance') is null or (p_data ->> 'insurance') not in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover') then
    raise exception 'choose an insurance option' using errcode = '22023'; end if;
  if coalesce((v_priv ->> 'medically_fit')::boolean, false) is not true then raise exception 'you must declare that you are medically fit to take part' using errcode = '22023'; end if;
  if char_length(coalesce(v_priv ->> 'emergency_name', '')) < 2 or char_length(coalesce(v_priv ->> 'emergency_phone', '')) < 7 then raise exception 'emergency contact name and phone are required' using errcode = '22023'; end if;
  if not v_volunteer and jsonb_array_length(coalesce(p_data -> 'competitions', '[]'::jsonb)) = 0 then raise exception 'choose at least one category, or sign up as a volunteer' using errcode = '22023'; end if;

  select * into v_existing from public.registrations where event_id = p_event and user_id = auth.uid();
  if found and v_existing.status not in ('pending', 'declined', 'withdrawn') then raise exception 'your registration was already accepted; ask an organizer to change it' using errcode = '22023'; end if;

  v_days := coalesce(array(select jsonb_array_elements_text(p_data -> 'days')), '{}');
  -- Attendance days are the event's own calendar days; anything outside the event is dropped rather than refused.
  v_dates := coalesce(array(select d::date from jsonb_array_elements_text(p_data -> 'attend_dates') d
                            where d ~ '^\d{4}-\d{2}-\d{2}$' and d::date between v_event.starts_on and v_event.ends_on), '{}');
  v_roles := coalesce(array(select jsonb_array_elements_text(p_data -> 'volunteer_roles')), '{}');

  insert into public.registrations as r (event_id, user_id, status, full_name, gender, organization, province, team_id, team_name, shares_equipment, days, attend_dates, availability_notes,
      bi_profile, insurance, is_volunteer, volunteer_roles, mercenary, notes, fee_due_cents, waiver_version_id, waiver_signed_name, waiver_signed_at)
  values (p_event, auth.uid(), 'pending', p_data ->> 'full_name', p_data ->> 'gender', p_data ->> 'organization', nullif(p_data ->> 'province', ''),
      nullif(p_data ->> 'team_id', '')::uuid, nullif(p_data ->> 'team_name', ''), coalesce((p_data ->> 'shares_equipment')::boolean, false), v_days, v_dates, nullif(p_data ->> 'availability_notes', ''),
      nullif(p_data ->> 'bi_profile', ''), p_data ->> 'insurance', v_volunteer, v_roles, coalesce((p_data ->> 'mercenary')::boolean, false), nullif(p_data ->> 'notes', ''),
      private.compute_fee(p_event, p_data ->> 'province', v_volunteer), v_waiver.id, p_data ->> 'waiver_signed_name', now())
  on conflict (event_id, user_id) do update set status = 'pending', full_name = excluded.full_name, gender = excluded.gender, organization = excluded.organization, province = excluded.province,
      team_id = excluded.team_id, team_name = excluded.team_name, shares_equipment = excluded.shares_equipment, days = excluded.days, attend_dates = excluded.attend_dates, availability_notes = excluded.availability_notes,
      bi_profile = excluded.bi_profile, insurance = excluded.insurance, is_volunteer = excluded.is_volunteer, volunteer_roles = excluded.volunteer_roles, mercenary = excluded.mercenary,
      notes = excluded.notes, fee_due_cents = excluded.fee_due_cents, waiver_version_id = excluded.waiver_version_id, waiver_signed_name = excluded.waiver_signed_name, waiver_signed_at = now()
  returning r.id into v_reg;

  insert into public.registration_private as p (registration_id, email, emergency_name, emergency_relationship, emergency_phone, medically_fit, medical_note)
  values (v_reg, coalesce(v_priv ->> 'email', ''), v_priv ->> 'emergency_name', coalesce(v_priv ->> 'emergency_relationship', ''), v_priv ->> 'emergency_phone', true, nullif(v_priv ->> 'medical_note', ''))
  on conflict (registration_id) do update set email = excluded.email, emergency_name = excluded.emergency_name, emergency_relationship = excluded.emergency_relationship,
      emergency_phone = excluded.emergency_phone, medically_fit = true, medical_note = excluded.medical_note;

  delete from public.registration_competitions where registration_id = v_reg;
  for v_comp in select * from jsonb_array_elements(coalesce(p_data -> 'competitions', '[]'::jsonb)) loop
    if not exists (select 1 from public.competitions where id = (v_comp ->> 'competition_id')::uuid and event_id = p_event) then
      raise exception 'a chosen category does not belong to this event' using errcode = '22023'; end if;
    insert into public.registration_competitions (registration_id, competition_id, team_id, details)
    values (v_reg, (v_comp ->> 'competition_id')::uuid, nullif(v_comp ->> 'team_id', '')::uuid, coalesce(v_comp -> 'details', '{}'::jsonb));
  end loop;

  perform private.audit(p_event, 'registration.submitted', v_reg::text);
  return v_reg;
end $$;


-- ======================================================================== 3. 20261004000200_pack07_pack1_reconcile.sql
-- Pack 07 + Pack 1 reconciliation (2026-10-04). Both packs were built in parallel and each changed the same things; this migration runs
-- after both and leaves ONE definition of each. Additive: no table or row is removed. Owner decisions (2026-10-04):
--   1. Competitions: Pack 1's private.competitions_guard() is the single history guard (it covers everything Pack 07's delete guard did,
--      plus category/division once matches exist and finished competitions). Pack 07's duplicate delete trigger is retired here.
--      The one setup field only Pack 07's editor offered, the tier, gets its own organizer-only, audited function.
--   2. My events: one relationship rule, private.my_event_links(), read by BOTH public.my_events() (My events cards) and
--      public.my_event_relations() (Calendar "mine", filters). Direct relationships only: staff role, own registration, own fighter's entry or
--      roster place, captained team's entry, and a pending organizer invitation (Pack 07). Platform owner and organization admin status
--      add nothing. Drafts only for the event's staff and for people who registered (Pack 1 rule).
--   3. submit_registration: Pack 1's version (attendance dates) replaced Pack 07's (waiver versions, organizer invitations). The final
--      definition below keeps both behaviours.

-- ---------------------------------------------------------------- 1. competitions: one guard
drop trigger if exists competitions_delete_guard on public.competitions;
drop function if exists private.guard_competition_delete();

-- Pack 1's guard, unchanged except for WHO is let through without checks. Pack 1 let every request without a signed-in user through (seeds,
-- cleanup scripts and migrations need their cascades). That also let through service-role API calls, which Pack 07's guard refused. Now only
-- a direct database session (no API role, no request JWT: the SQL editor, seeds, cleanup, migrations) skips the checks; every API request,
-- service role included, is guarded. Nothing Pack 1 allowed to a signed-in organizer changes.
create or replace function private.competitions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null
     and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated', 'service_role')
     and nullif(current_setting('request.jwt.claims', true), '') is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.entries e where e.competition_id = old.id)
       or exists (select 1 from public.matches m where m.competition_id = old.id)
       or exists (select 1 from public.results r where r.competition_id = old.id)
       or exists (select 1 from public.registration_competitions rc where rc.competition_id = old.id) then
      raise exception 'this competition already has registrations, entries or matches, so it cannot be removed' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.category, new.gender) is distinct from (old.category, old.gender)
     and exists (select 1 from public.matches m where m.competition_id = old.id) then
    raise exception 'this competition already has matches; its category and division can no longer change' using errcode = 'P0001';
  end if;
  if old.status = 'finished' and (new.name, new.category, new.gender, new.ruleset, new.rounds_to_win) is distinct from (old.name, old.category, old.gender, old.ruleset, old.rounds_to_win) then
    raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.competitions_guard() from public, anon, authenticated;

-- Tier (which league-points table the competition uses) was editable in Pack 07's Setup editor; Pack 1's create/update functions do not
-- carry it. Kept as its own call so the Competitions tab can set it; a finished competition's tier is part of the record.
create or replace function public.set_competition_tier(p_comp uuid, p_tier text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_k from public.competitions k where k.id = p_comp;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_k.event_id) then raise exception 'only the organizers of this event can change its competitions' using errcode = '42501'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is finished; its setup is part of the record and cannot change' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ref_tiers t where t.name = p_tier) then raise exception 'choose a tier from the list' using errcode = '22023'; end if;
  if v_k.tier is distinct from p_tier then
    update public.competitions set tier = p_tier where id = p_comp;
    perform private.audit(v_k.event_id, 'competition.tier_changed', p_comp::text, jsonb_build_object('from', v_k.tier, 'to', p_tier));
  end if;
end $$;
revoke execute on function public.set_competition_tier(uuid, text) from public, anon;
grant execute on function public.set_competition_tier(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. my events: one rule
create or replace function private.my_event_links(p_uid uuid) returns table (event_id uuid, role text)
language sql stable security definer set search_path = '' as $$
  with mf as (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = p_uid),
  l as (
    select s.event_id, s.role from public.event_staff s where s.user_id = p_uid
    union
    select r.event_id, case when r.is_volunteer then 'volunteer' else 'fighter' end from public.registrations r where r.user_id = p_uid
    union
    select i.event_id, 'invited' from public.event_invitations i where i.status = 'invited' and i.fighter_id in (select fighter_id from mf)
    union
    select k.event_id, 'fighter' from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and (e.fighter_id in (select fighter_id from mf)
           or e.id in (select ef.entry_id from public.entry_fighters ef where ef.fighter_id in (select fighter_id from mf)))
    union
    select k.event_id, 'captain' from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and e.team_id in (select tr.team_id from public.team_roles tr where tr.user_id = p_uid and tr.role = 'captain')
  )
  select l.event_id, l.role
  from l join public.events ev on ev.id = l.event_id
  where p_uid is not null
    and (ev.status = 'published'
         or exists (select 1 from public.event_staff s where s.event_id = ev.id and s.user_id = p_uid)
         or exists (select 1 from public.registrations r where r.event_id = ev.id and r.user_id = p_uid))
$$;
revoke execute on function private.my_event_links(uuid) from public, anon, authenticated;

-- One row per (event, relationship) for the signed-in person. Same rule as my_events().
create or replace function public.my_event_relations()
returns table (event_id uuid, role text)
language sql stable security definer set search_path = '' as $$
  select x.event_id, x.role from private.my_event_links(auth.uid()) x
$$;
revoke execute on function public.my_event_relations() from public, anon;
grant execute on function public.my_event_relations() to authenticated;

-- my_events() gains `invited` (a pending organizer invitation); its rows come from the same rule. The return type changes, so the
-- function is replaced (no data is involved).
drop function if exists public.my_events();
create function public.my_events() returns table (
  id uuid, slug text, name text, status text, event_type text, starts_on date, ends_on date, city text, region text, venue text, registration_mode text,
  synthetic boolean, staff_roles text[], registration_id uuid, registration_status text, fee_due_cents integer, fee_paid boolean, insurance text,
  is_volunteer boolean, checked_in boolean, fighter_entry boolean, captain_entry boolean, pending_registrations integer, invited boolean
) language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  links as (select x.event_id, x.role from private.my_event_links((select uid from me)) x),
  my_fighters as (select fa.fighter_id from public.fighter_accounts fa where fa.user_id = (select uid from me)),
  staff as (select s.event_id, array_agg(distinct s.role order by s.role) as roles from public.event_staff s where s.user_id = (select uid from me) group by s.event_id),
  regs as (
    select r.event_id, r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer,
           exists (select 1 from public.registration_checks c where c.registration_id = r.id and c.check_name = 'checked_in' and c.passed) as checked_in
    from public.registrations r where r.user_id = (select uid from me)),
  fighter as (
    select distinct k.event_id from public.entries e join public.competitions k on k.id = e.competition_id
    where e.status <> 'withdrawn'
      and (e.fighter_id in (select fighter_id from my_fighters)
           or e.id in (select ef.entry_id from public.entry_fighters ef where ef.fighter_id in (select fighter_id from my_fighters)))),
  captain as (select distinct event_id from links where role = 'captain'),
  invited as (select distinct event_id from links where role = 'invited'),
  ids as (select distinct event_id from links)
  select ev.id, ev.slug, ev.name, ev.status, ev.event_type, ev.starts_on, ev.ends_on, ev.city, ev.region, ev.venue, ev.registration_mode,
         private.is_synthetic('event', ev.id),
         coalesce(s.roles, '{}'::text[]), r.id, r.status, r.fee_due_cents, r.fee_paid, r.insurance, r.is_volunteer, coalesce(r.checked_in, false),
         ev.id in (select event_id from fighter), ev.id in (select event_id from captain),
         case when coalesce(s.roles, '{}'::text[]) @> array['organizer'] then (select count(*)::integer from public.registrations x where x.event_id = ev.id and x.status = 'pending') end,
         ev.id in (select event_id from invited)
  from public.events ev
  join ids on ids.event_id = ev.id
  left join staff s on s.event_id = ev.id
  left join regs r on r.event_id = ev.id
  order by ev.starts_on, ev.name
$$;
revoke execute on function public.my_events() from public, anon;
grant execute on function public.my_events() to authenticated;

-- ---------------------------------------------------------------- 3. submit_registration: both packs
-- Pack 07: the current waiver version must be accepted; a fighter the organizer added may complete the form outside the registration window,
-- and completing it links the invitation and accepts the registration at once. Pack 1: attendance dates are the event's own days
-- (anything outside the event is dropped); the legacy `days` list is still accepted.
create or replace function public.submit_registration(p_event uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_reg uuid;
  v_waiver public.waiver_versions;
  v_comp jsonb;
  v_volunteer boolean := coalesce((p_data ->> 'is_volunteer')::boolean, false);
  v_priv jsonb := coalesce(p_data -> 'private', '{}'::jsonb);
  v_existing public.registrations;
  v_days text[];
  v_dates date[];
  v_roles text[];
  v_my_fighter uuid;
  v_inv public.event_invitations;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_event from public.events where id = p_event;
  if not found or v_event.status <> 'published' then raise exception 'this event is not open for registration' using errcode = 'P0002'; end if;
  select fighter_id into v_my_fighter from public.fighter_accounts where user_id = auth.uid();
  if v_my_fighter is not null then
    select * into v_inv from public.event_invitations where event_id = p_event and fighter_id = v_my_fighter and status = 'invited';
  end if;
  if v_inv.id is null then
    if v_event.registration_opens_at is not null and now() < v_event.registration_opens_at then raise exception 'registration has not opened yet' using errcode = '22023'; end if;
    if v_event.registration_closes_at is not null and now() > v_event.registration_closes_at then raise exception 'registration is closed' using errcode = '22023'; end if;
  end if;

  if coalesce((p_data ->> 'waiver_agree')::boolean, false) is not true then raise exception 'the waiver must be accepted to take part' using errcode = '22023'; end if;
  select * into v_waiver from public.waiver_versions where id = (p_data ->> 'waiver_version_id')::uuid and event_id = p_event;
  if not found then raise exception 'unknown waiver version' using errcode = '22023'; end if;
  if v_waiver.version <> (select max(version) from public.waiver_versions where event_id = p_event) then raise exception 'the waiver was updated, please read and accept the new version' using errcode = '22023'; end if;
  if char_length(coalesce(p_data ->> 'waiver_signed_name', '')) < 2 then raise exception 'type your full name to sign the waiver' using errcode = '22023'; end if;

  if (p_data ->> 'insurance') is null or (p_data ->> 'insurance') not in ('hacsa_member', 'mcc_member', 'proof_received', 'proof_pending', 'needs_cover') then
    raise exception 'choose an insurance option' using errcode = '22023'; end if;
  if coalesce((v_priv ->> 'medically_fit')::boolean, false) is not true then raise exception 'you must declare that you are medically fit to take part' using errcode = '22023'; end if;
  if char_length(coalesce(v_priv ->> 'emergency_name', '')) < 2 or char_length(coalesce(v_priv ->> 'emergency_phone', '')) < 7 then raise exception 'emergency contact name and phone are required' using errcode = '22023'; end if;
  if not v_volunteer and jsonb_array_length(coalesce(p_data -> 'competitions', '[]'::jsonb)) = 0 then raise exception 'choose at least one category, or sign up as a volunteer' using errcode = '22023'; end if;

  select * into v_existing from public.registrations where event_id = p_event and user_id = auth.uid();
  if found and v_existing.status not in ('pending', 'declined', 'withdrawn') then raise exception 'your registration was already accepted; ask an organizer to change it' using errcode = '22023'; end if;

  v_days := coalesce(array(select jsonb_array_elements_text(p_data -> 'days')), '{}');
  -- Attendance days are the event's own calendar days; anything outside the event is dropped rather than refused.
  v_dates := coalesce(array(select d::date from jsonb_array_elements_text(p_data -> 'attend_dates') d
                            where d ~ '^\d{4}-\d{2}-\d{2}$' and d::date between v_event.starts_on and v_event.ends_on), '{}');
  v_roles := coalesce(array(select jsonb_array_elements_text(p_data -> 'volunteer_roles')), '{}');

  insert into public.registrations as r (event_id, user_id, status, full_name, gender, organization, province, team_id, team_name, shares_equipment, days, attend_dates, availability_notes,
      bi_profile, insurance, is_volunteer, volunteer_roles, mercenary, notes, fee_due_cents, waiver_version_id, waiver_signed_name, waiver_signed_at)
  values (p_event, auth.uid(), 'pending', p_data ->> 'full_name', p_data ->> 'gender', p_data ->> 'organization', nullif(p_data ->> 'province', ''),
      nullif(p_data ->> 'team_id', '')::uuid, nullif(p_data ->> 'team_name', ''), coalesce((p_data ->> 'shares_equipment')::boolean, false), v_days, v_dates, nullif(p_data ->> 'availability_notes', ''),
      nullif(p_data ->> 'bi_profile', ''), p_data ->> 'insurance', v_volunteer, v_roles, coalesce((p_data ->> 'mercenary')::boolean, false), nullif(p_data ->> 'notes', ''),
      private.compute_fee(p_event, p_data ->> 'province', v_volunteer), v_waiver.id, p_data ->> 'waiver_signed_name', now())
  on conflict (event_id, user_id) do update set status = 'pending', full_name = excluded.full_name, gender = excluded.gender, organization = excluded.organization, province = excluded.province,
      team_id = excluded.team_id, team_name = excluded.team_name, shares_equipment = excluded.shares_equipment, days = excluded.days, attend_dates = excluded.attend_dates, availability_notes = excluded.availability_notes,
      bi_profile = excluded.bi_profile, insurance = excluded.insurance, is_volunteer = excluded.is_volunteer, volunteer_roles = excluded.volunteer_roles, mercenary = excluded.mercenary,
      notes = excluded.notes, fee_due_cents = excluded.fee_due_cents, waiver_version_id = excluded.waiver_version_id, waiver_signed_name = excluded.waiver_signed_name, waiver_signed_at = now()
  returning r.id into v_reg;

  insert into public.registration_private as p (registration_id, email, emergency_name, emergency_relationship, emergency_phone, medically_fit, medical_note)
  values (v_reg, coalesce(v_priv ->> 'email', ''), v_priv ->> 'emergency_name', coalesce(v_priv ->> 'emergency_relationship', ''), v_priv ->> 'emergency_phone', true, nullif(v_priv ->> 'medical_note', ''))
  on conflict (registration_id) do update set email = excluded.email, emergency_name = excluded.emergency_name, emergency_relationship = excluded.emergency_relationship,
      emergency_phone = excluded.emergency_phone, medically_fit = true, medical_note = excluded.medical_note;

  delete from public.registration_competitions where registration_id = v_reg;
  for v_comp in select * from jsonb_array_elements(coalesce(p_data -> 'competitions', '[]'::jsonb)) loop
    if not exists (select 1 from public.competitions where id = (v_comp ->> 'competition_id')::uuid and event_id = p_event) then
      raise exception 'a chosen category does not belong to this event' using errcode = '22023'; end if;
    insert into public.registration_competitions (registration_id, competition_id, team_id, details)
    values (v_reg, (v_comp ->> 'competition_id')::uuid, nullif(v_comp ->> 'team_id', '')::uuid, coalesce(v_comp -> 'details', '{}'::jsonb));
  end loop;

  perform private.audit(p_event, 'registration.submitted', v_reg::text);

  if v_inv.id is not null then
    update public.event_invitations set status = 'registered', registration_id = v_reg, decided_at = now() where id = v_inv.id;
    update public.notifications set read_at = coalesce(read_at, now()) where kind = 'event_invited' and payload ->> 'invitation_id' = v_inv.id::text;
    perform private.accept_registration_core(v_reg);
    perform private.audit(p_event, 'registration.accepted', v_reg::text, jsonb_build_object('via', 'invitation', 'invitation', v_inv.id));
  end if;
  return v_reg;
end $$;
revoke execute on function public.submit_registration(uuid, jsonb) from public, anon;
grant execute on function public.submit_registration(uuid, jsonb) to authenticated;


-- ======================================================================== 4. 20261004000300_pack08_entrants_and_claims.sql
-- Pack 08 (2026-10-04): organizer-added entrants and claimable unclaimed fighter profiles. Additive; extends the Pack 05 identity architecture.
--
-- Organizer side
--   * create_unclaimed_fighter(): an organizer of an event creates a NORMAL fighter record (stable UUID, no account, no fake auth user, no email) and
--     can enter it in a competition in the same transaction. A look-alike name (same name, any other real fighter) must be confirmed as "a different
--     person" first, and then every look-alike is put in front of the platform administrator through fighter_identity_reviews (source organizer_entry).
--     Nothing is merged and nothing is linked on a name match.
--   * add_entrant(): puts an existing fighter in a competition through the normal paths: individual competitions take a fighter entry, group fights
--     take the team's entry and the fighter joins its roster through set_entry_roster() (the same rules: roles, one entry per competition, 40 at most,
--     locked once the competition is finished). Audited.
--   * search_fighters_for_entry(): the organizer's search, with enough context (team, place, claimed or not, already in this competition) to tell
--     two people with one name apart.
-- Claim side
--   * Anyone signed in can ASK to be linked to an unclaimed fighter (request_fighter_claim). Only the platform administrator decides
--     (resolve_fighter_claim); event organizers have no say over identities outside their own entry lists.
--   * Approval links the account to the EXISTING fighter UUID (fighter_accounts). No fighter is created, copied or moved, so matches, results,
--     rankings, team history and participation stay exactly where they were.
--   * A fighter that is already claimed cannot be claimed again; an account that already owns a fighter is never given a second one: that request is
--     put in front of the administrator as a possible duplicate identity (source claim) and approving it is refused.
-- Public: only a yes/no "has this profile been claimed" (fighter_claim_states). No account id is ever exposed.

-- ---------------------------------------------------------------- 1. identity review sources and reasons
alter table public.fighter_identity_reviews drop constraint if exists fighter_identity_reviews_reason_check;
alter table public.fighter_identity_reviews add constraint fighter_identity_reviews_reason_check check (reason in ('same_name', 'claim_conflict'));
alter table public.fighter_identity_reviews drop constraint if exists fighter_identity_reviews_source_check;
alter table public.fighter_identity_reviews add constraint fighter_identity_reviews_source_check check (source in ('registration', 'team_join', 'organizer_entry', 'claim'));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported',
                  'event_invited', 'registration_withdrawn', 'fighter_claim_requested', 'fighter_claim_decided'));

-- The administrator's list now says truthfully which side has an account (the "new" side used to be hard-coded as having one, which is wrong for an
-- organizer-created record and for a claimant's own record).
create or replace function public.list_fighter_identity_reviews()
returns table(review_id uuid, source text, created_at timestamptz, new_fighter jsonb, candidate jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only a platform administrator can review fighter identities' using errcode = '42501'; end if;
  return query
  select r.id, r.source, r.created_at,
    (select jsonb_build_object('id', f.id, 'name', f.display_name, 'team', t.name, 'has_account', exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id), 'created_at', f.created_at,
        'entries', (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id), 'synthetic', private.is_synthetic('fighter', f.id))
       from public.fighters f left join public.teams t on t.id = f.team_id where f.id = r.fighter_id),
    (select jsonb_build_object('id', f.id, 'name', f.display_name, 'team', t.name, 'has_account', exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id), 'created_at', f.created_at,
        'entries', (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id), 'synthetic', private.is_synthetic('fighter', f.id),
        'sources', coalesce((select jsonb_agg(s.title) from public.record_sources rs join public.sources s on s.id = rs.source_id where rs.entity_type = 'fighter' and rs.entity_id = f.id), '[]'::jsonb))
       from public.fighters f left join public.teams t on t.id = f.team_id where f.id = r.candidate_id)
  from public.fighter_identity_reviews r where r.status = 'open' order by r.created_at;
end $$;

-- ---------------------------------------------------------------- 2. public: has this profile been claimed? (yes/no only)
create or replace function public.fighter_claim_states(p_ids uuid[]) returns table (fighter_id uuid, claimed boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id)
  from public.fighters f where f.id = any (p_ids[1:500])
$$;
revoke execute on function public.fighter_claim_states(uuid[]) from public;
grant execute on function public.fighter_claim_states(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------- 3. organizer: search, create, add
create or replace function public.search_fighters_for_entry(p_competition uuid, p_query text)
returns table (fighter_id uuid, display_name text, team_name text, city text, region text, gender text, claimed boolean, in_competition boolean, in_event boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_event uuid := private.event_of_competition(p_competition); v_q text := lower(btrim(coalesce(p_query, ''))); v_fiction boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer of this event can search for entrants' using errcode = '42501'; end if;
  if char_length(v_q) < 2 then return; end if;
  v_fiction := private.is_synthetic('event', v_event);
  return query
  select f.id, f.display_name, t.name, f.city, f.region, f.gender,
    exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id),
    exists (select 1 from public.fighter_participation fp where fp.fighter_id = f.id and fp.competition_id = p_competition),
    exists (select 1 from public.fighter_participation fp where fp.fighter_id = f.id and fp.event_id = v_event)
  from public.fighters f
  left join public.teams t on t.id = f.team_id and t.status = 'approved'
  where (v_fiction or not private.is_synthetic('fighter', f.id))
    and not exists (select 1 from unnest(string_to_array(v_q, ' ')) w
                    where w <> '' and position(w in lower(concat_ws(' ', f.display_name, t.name, f.city, f.region))) = 0)
  order by (lower(f.display_name) = v_q) desc, f.display_name, f.id
  limit 15;
end $$;

-- Puts a fighter in a competition through the normal entry paths. Callers check who may. Returns {entry_id, kind, already}.
create or replace function private.add_entrant_core(p_competition uuid, p_fighter uuid, p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k public.competitions; v_league text; v_entry uuid; v_status text; v_cur jsonb;
begin
  select * into v_k from public.competitions where id = p_competition for update;
  if not found then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if v_k.status = 'finished' then raise exception 'this competition is finished; reopen a match before adding entrants' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.fighters where id = p_fighter) then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  select c.league into v_league from public.ref_categories c where c.code = v_k.category;
  if v_league = 'buhurt' then
    if p_team is null then raise exception 'choose the team this fighter fights for in this group fight' using errcode = '22023'; end if;
    if not exists (select 1 from public.teams where id = p_team) then raise exception 'team not found' using errcode = 'P0002'; end if;
    select id, status into v_entry, v_status from public.entries where competition_id = p_competition and team_id = p_team;
    if v_entry is null then
      insert into public.entries (competition_id, team_id) values (p_competition, p_team) returning id into v_entry;
    elsif v_status in ('withdrawn', 'disqualified') then
      raise exception 'that team''s entry is % in this competition; put it back in first', v_status using errcode = '22023';
    end if;
    if exists (select 1 from public.entry_fighters where entry_id = v_entry and fighter_id = p_fighter) then
      return jsonb_build_object('entry_id', v_entry, 'kind', 'team', 'already', true);
    end if;
    if exists (select 1 from public.entry_fighters where competition_id = p_competition and fighter_id = p_fighter) then
      raise exception 'this fighter is already on another team''s roster in this competition' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('fighter_id', fighter_id, 'role', role)), '[]'::jsonb) into v_cur from public.entry_fighters where entry_id = v_entry;
    perform public.set_entry_roster(v_entry, v_cur || jsonb_build_array(jsonb_build_object('fighter_id', p_fighter)));
    return jsonb_build_object('entry_id', v_entry, 'kind', 'team', 'already', false);
  end if;
  if p_team is not null then raise exception 'this competition takes individual fighters, not a team' using errcode = '22023'; end if;
  select id, status into v_entry, v_status from public.entries where competition_id = p_competition and fighter_id = p_fighter;
  if v_entry is null then
    insert into public.entries (competition_id, fighter_id) values (p_competition, p_fighter) returning id into v_entry;
    return jsonb_build_object('entry_id', v_entry, 'kind', 'fighter', 'already', false);
  elsif v_status = 'withdrawn' then
    update public.entries set status = 'registered' where id = v_entry;
    return jsonb_build_object('entry_id', v_entry, 'kind', 'fighter', 'already', false);
  elsif v_status = 'disqualified' then
    raise exception 'this fighter was disqualified from this competition' using errcode = '22023';
  end if;
  return jsonb_build_object('entry_id', v_entry, 'kind', 'fighter', 'already', true);
end $$;
revoke execute on function private.add_entrant_core(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.add_entrant(p_competition uuid, p_fighter uuid, p_team uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event uuid := private.event_of_competition(p_competition); r jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_event is null then raise exception 'competition not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_event) then raise exception 'only an organizer of this event can add entrants' using errcode = '42501'; end if;
  r := private.add_entrant_core(p_competition, p_fighter, p_team);
  if (r ->> 'already')::boolean is not true then
    perform private.audit(v_event, 'entrant.added', p_fighter::text, jsonb_build_object('competition', p_competition, 'entry', r ->> 'entry_id',
      'unclaimed', not exists (select 1 from public.fighter_accounts a where a.fighter_id = p_fighter)));
  end if;
  return r;
end $$;

-- Creates a normal fighter record with no account. p_competition (optional) enters it straight away, in the same transaction.
-- A look-alike (another real fighter with the same name) is refused until the organizer confirms this is a different person; then each look-alike is
-- queued for the platform administrator. Returns {fighter_id, flagged, entry}.
create or replace function public.create_unclaimed_fighter(
  p_event uuid, p_name text, p_home_team uuid default null, p_city text default null, p_region text default null, p_gender text default null,
  p_confirmed_distinct boolean default false, p_competition uuid default null, p_entry_team uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_city text := nullif(btrim(coalesce(p_city, '')), ''); v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_dups uuid[]; v_id uuid; v_entry jsonb; v_ev public.events; d uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_ev from public.events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(p_event) then raise exception 'only an organizer of this event can add entrants' using errcode = '42501'; end if;
  if p_competition is not null and private.event_of_competition(p_competition) is distinct from p_event then raise exception 'that competition belongs to another event' using errcode = '22023'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'the name must be 2 to 80 characters' using errcode = '22023'; end if;
  if char_length(coalesce(v_city, '')) > 80 or char_length(coalesce(v_region, '')) > 80 then raise exception 'city and region are at most 80 characters' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female', 'other') then raise exception 'gender must be male, female or other' using errcode = '22023'; end if;
  if p_home_team is not null and not exists (select 1 from public.teams where id = p_home_team and status = 'approved') then raise exception 'choose a listed team, or leave it empty' using errcode = '22023'; end if;
  select coalesce(array_agg(f.id), '{}') into v_dups from public.fighters f
  where lower(regexp_replace(btrim(f.display_name), '\s+', ' ', 'g')) = lower(v_name) and not private.is_synthetic('fighter', f.id);
  if cardinality(v_dups) > 0 and not coalesce(p_confirmed_distinct, false) then
    raise exception '% fighter(s) named % already exist; pick one of them, or confirm this is a different person', cardinality(v_dups), v_name using errcode = '22023';
  end if;
  insert into public.fighters (display_name, team_id, city, region, gender) values (v_name, p_home_team, v_city, v_region, p_gender) returning id into v_id;
  foreach d in array v_dups loop
    insert into public.fighter_identity_reviews (fighter_id, candidate_id, reason, source) values (v_id, d, 'same_name', 'organizer_entry') on conflict do nothing;
  end loop;
  perform private.audit(p_event, 'fighter.created_by_organizer', v_id::text, jsonb_build_object('event_name', v_ev.name, 'flagged', cardinality(v_dups)));
  if p_competition is not null then
    v_entry := private.add_entrant_core(p_competition, v_id, p_entry_team);
    perform private.audit(p_event, 'entrant.added', v_id::text, jsonb_build_object('competition', p_competition, 'entry', v_entry ->> 'entry_id', 'unclaimed', true));
  end if;
  return jsonb_build_object('fighter_id', v_id, 'flagged', cardinality(v_dups), 'entry', v_entry);
end $$;

-- ---------------------------------------------------------------- 4. claims
create table if not exists public.fighter_claim_requests (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,
  claimant uuid not null references auth.users (id) on delete cascade,
  message text check (message is null or char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- The claimant already owns another fighter: a possible duplicate identity, decided deliberately, never by a claim approval.
  needs_review boolean not null default false,
  review_id uuid references public.fighter_identity_reviews (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists fighter_claim_requests_open_key on public.fighter_claim_requests (fighter_id, claimant) where status = 'pending';
create index if not exists fighter_claim_requests_pending_idx on public.fighter_claim_requests (created_at) where status = 'pending';
alter table public.fighter_claim_requests enable row level security;   -- no policies and no grants: reachable only through the functions below
revoke all on public.fighter_claim_requests from anon, authenticated;

create or replace function public.search_unclaimed_fighters(p_query text)
returns table (fighter_id uuid, display_name text, team_name text, city text, region text, entries bigint, last_event text)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if char_length(v_q) < 2 then return; end if;
  return query
  select f.id, f.display_name, t.name, f.city, f.region,
    (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id),
    (select ev.name from public.fighter_participation fp join public.events ev on ev.id = fp.event_id where fp.fighter_id = f.id order by ev.ends_on desc limit 1)
  from public.fighters f
  left join public.teams t on t.id = f.team_id and t.status = 'approved'
  where not exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id)
    and not private.is_synthetic('fighter', f.id)
    and not exists (select 1 from unnest(string_to_array(v_q, ' ')) w
                    where w <> '' and position(w in lower(concat_ws(' ', f.display_name, t.name, f.city, f.region))) = 0)
  order by (lower(f.display_name) = v_q) desc, f.display_name, f.id
  limit 15;
end $$;

-- The signed-in person asks to be linked to an unclaimed fighter. Nothing is linked here. Returns {request_id, needs_review}.
create or replace function public.request_fighter_claim(p_fighter uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid(); v_mine uuid; v_id uuid; v_review uuid; v_name text; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if char_length(coalesce(v_msg, '')) > 500 then raise exception 'keep the message under 500 characters' using errcode = '22023'; end if;
  select display_name into v_name from public.fighters where id = p_fighter;
  if not found then raise exception 'fighter profile not found' using errcode = 'P0002'; end if;
  if private.is_synthetic('fighter', p_fighter) then raise exception 'this is a fictional test profile and cannot be claimed' using errcode = '22023'; end if;
  select fighter_id into v_mine from public.fighter_accounts where user_id = v_me;
  if v_mine = p_fighter then raise exception 'this is already your profile' using errcode = '22023'; end if;
  if exists (select 1 from public.fighter_accounts where fighter_id = p_fighter) then raise exception 'this profile already belongs to an account' using errcode = '22023'; end if;
  select id into v_id from public.fighter_claim_requests where fighter_id = p_fighter and claimant = v_me and status = 'pending';
  if found then return jsonb_build_object('request_id', v_id, 'needs_review', v_mine is not null); end if;
  if (select count(*) from public.fighter_claim_requests where claimant = v_me and status = 'pending') >= 5 then raise exception 'you have 5 claim requests waiting; wait for a decision or cancel one' using errcode = '22023'; end if;
  if v_mine is not null then
    insert into public.fighter_identity_reviews (fighter_id, candidate_id, reason, source) values (v_mine, p_fighter, 'claim_conflict', 'claim') on conflict (fighter_id, candidate_id) do nothing;
    select id into v_review from public.fighter_identity_reviews where fighter_id = v_mine and candidate_id = p_fighter;
  end if;
  insert into public.fighter_claim_requests (fighter_id, claimant, message, needs_review, review_id) values (p_fighter, v_me, v_msg, v_mine is not null, v_review) returning id into v_id;
  insert into public.notifications (user_id, kind, payload)
  select pr.user_id, 'fighter_claim_requested', jsonb_build_object('request_id', v_id, 'fighter_name', v_name) from public.platform_roles pr where pr.role = 'owner';
  perform private.audit(null, 'fighter.claim_requested', p_fighter::text, jsonb_build_object('request', v_id, 'claimant', v_me, 'needs_review', v_mine is not null));
  return jsonb_build_object('request_id', v_id, 'needs_review', v_mine is not null);
end $$;

create or replace function public.cancel_fighter_claim(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.fighter_claim_requests set status = 'cancelled', decided_at = now() where id = p_request and claimant = auth.uid() and status = 'pending';
  if not found then raise exception 'no waiting request of yours with that id' using errcode = 'P0002'; end if;
end $$;

create or replace function public.my_fighter_claims()
returns table (request_id uuid, fighter_id uuid, fighter_name text, team_name text, status text, needs_review boolean, note text, created_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.fighter_id, f.display_name, t.name, c.status, c.needs_review, c.note, c.created_at, c.decided_at
  from public.fighter_claim_requests c join public.fighters f on f.id = c.fighter_id left join public.teams t on t.id = f.team_id and t.status = 'approved'
  where c.claimant = auth.uid() order by c.created_at desc limit 50
$$;

-- Platform administrator only: the waiting claims with enough context to decide.
create or replace function public.list_fighter_claims()
returns table (request_id uuid, created_at timestamptz, message text, needs_review boolean, claimant jsonb, fighter jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only a platform administrator can review fighter claims' using errcode = '42501'; end if;
  return query
  select c.id, c.created_at, c.message, c.needs_review,
    jsonb_build_object('name', private.person_name(c.claimant), 'email', (select u.email from auth.users u where u.id = c.claimant),
      'own_fighter', (select jsonb_build_object('id', f.id, 'name', f.display_name) from public.fighter_accounts a join public.fighters f on f.id = a.fighter_id where a.user_id = c.claimant)),
    (select jsonb_build_object('id', f.id, 'name', f.display_name, 'team', t.name, 'city', f.city, 'region', f.region, 'claimed', exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id),
        'entries', (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id),
        'events', coalesce((select jsonb_agg(x.name) from (select distinct ev.name, ev.ends_on from public.fighter_participation fp join public.events ev on ev.id = fp.event_id where fp.fighter_id = f.id order by ev.ends_on desc limit 3) x), '[]'::jsonb),
        'origin', (select l.details ->> 'event_name' from public.audit_log l where l.action = 'fighter.created_by_organizer' and l.subject = f.id::text order by l.at limit 1))
       from public.fighters f left join public.teams t on t.id = f.team_id where f.id = c.fighter_id)
  from public.fighter_claim_requests c where c.status = 'pending' order by c.created_at;
end $$;

-- Platform administrator only. approve: links the account to the EXISTING fighter. Returns 'approved' | 'declined' | 'already_claimed' | 'account_has_fighter'.
create or replace function public.resolve_fighter_claim(p_request uuid, p_decision text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_r public.fighter_claim_requests; v_note text := btrim(coalesce(p_note, '')); v_name text; v_other record;
begin
  if not private.is_owner() then raise exception 'only a platform administrator can decide fighter claims' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approve', 'decline') then raise exception 'decision must be approve or decline' using errcode = '22023'; end if;
  if char_length(v_note) < 3 or char_length(v_note) > 300 then raise exception 'say how this was decided (3 to 300 characters)' using errcode = '22023'; end if;
  select * into v_r from public.fighter_claim_requests where id = p_request for update;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'pending' then raise exception 'this claim was already decided' using errcode = 'P0001'; end if;
  select display_name into v_name from public.fighters where id = v_r.fighter_id;

  if p_decision = 'decline' then
    update public.fighter_claim_requests set status = 'declined', note = v_note, decided_by = auth.uid(), decided_at = now() where id = p_request;
    insert into public.notifications (user_id, kind, payload) values (v_r.claimant, 'fighter_claim_decided', jsonb_build_object('fighter_id', v_r.fighter_id, 'fighter_name', v_name, 'decision', 'declined'));
    perform private.audit(null, 'fighter.claim_declined', v_r.fighter_id::text, jsonb_build_object('request', p_request, 'claimant', v_r.claimant, 'note', v_note));
    return 'declined';
  end if;

  -- The same lock the registration path takes for an account, so a claim and a registration for one account run one after the other.
  perform pg_advisory_xact_lock(hashtextextended('fighter-account:' || v_r.claimant::text, 0));
  perform 1 from public.fighters where id = v_r.fighter_id for update;
  if exists (select 1 from public.fighter_accounts where fighter_id = v_r.fighter_id) then
    update public.fighter_claim_requests set status = 'declined', note = 'This profile was claimed by someone else before this request was decided.', decided_by = auth.uid(), decided_at = now() where id = p_request;
    insert into public.notifications (user_id, kind, payload) values (v_r.claimant, 'fighter_claim_decided', jsonb_build_object('fighter_id', v_r.fighter_id, 'fighter_name', v_name, 'decision', 'declined'));
    perform private.audit(null, 'fighter.claim_refused_already_claimed', v_r.fighter_id::text, jsonb_build_object('request', p_request, 'claimant', v_r.claimant));
    return 'already_claimed';
  end if;
  select a.fighter_id into v_other from public.fighter_accounts a where a.user_id = v_r.claimant;
  if found then
    -- Never replace, merge or move history because of a claim. The question is "are these two records one person?", and that is decided as an identity review.
    update public.fighter_claim_requests set needs_review = true where id = p_request;
    insert into public.fighter_identity_reviews (fighter_id, candidate_id, reason, source) values (v_other.fighter_id, v_r.fighter_id, 'claim_conflict', 'claim') on conflict (fighter_id, candidate_id) do nothing;
    perform private.audit(null, 'fighter.claim_refused_account_has_fighter', v_r.fighter_id::text, jsonb_build_object('request', p_request, 'claimant', v_r.claimant));
    return 'account_has_fighter';
  end if;

  insert into public.fighter_accounts (fighter_id, user_id) values (v_r.fighter_id, v_r.claimant);
  update public.fighter_claim_requests set status = 'approved', note = v_note, decided_by = auth.uid(), decided_at = now() where id = p_request;
  -- Everyone else waiting for this profile is told it has been taken.
  with other as (
    update public.fighter_claim_requests set status = 'declined', note = 'Another request for this profile was approved.', decided_by = auth.uid(), decided_at = now()
    where fighter_id = v_r.fighter_id and status = 'pending' and id <> p_request returning claimant)
  insert into public.notifications (user_id, kind, payload)
  select o.claimant, 'fighter_claim_decided', jsonb_build_object('fighter_id', v_r.fighter_id, 'fighter_name', v_name, 'decision', 'declined') from other o;
  insert into public.notifications (user_id, kind, payload) values (v_r.claimant, 'fighter_claim_decided', jsonb_build_object('fighter_id', v_r.fighter_id, 'fighter_name', v_name, 'decision', 'approved'));
  perform private.audit(null, 'fighter.claim_approved', v_r.fighter_id::text, jsonb_build_object('request', p_request, 'claimant', v_r.claimant, 'note', v_note));
  return 'approved';
end $$;

-- ---------------------------------------------------------------- 5. grants: signed-in only (each function checks its own authority)
revoke execute on function public.search_fighters_for_entry(uuid, text), public.add_entrant(uuid, uuid, uuid),
  public.create_unclaimed_fighter(uuid, text, uuid, text, text, text, boolean, uuid, uuid), public.search_unclaimed_fighters(text),
  public.request_fighter_claim(uuid, text), public.cancel_fighter_claim(uuid), public.my_fighter_claims(), public.list_fighter_claims(),
  public.resolve_fighter_claim(uuid, text, text) from public, anon;
grant execute on function public.search_fighters_for_entry(uuid, text), public.add_entrant(uuid, uuid, uuid),
  public.create_unclaimed_fighter(uuid, text, uuid, text, text, text, boolean, uuid, uuid), public.search_unclaimed_fighters(text),
  public.request_fighter_claim(uuid, text), public.cancel_fighter_claim(uuid), public.my_fighter_claims(), public.list_fighter_claims(),
  public.resolve_fighter_claim(uuid, text, text) to authenticated;


-- ======================================================================== post-check: refuse to commit a half-applied state
do $postcheck$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fighter_claim_requests') then raise exception 'ROLLOUT CHECK FAILED: Pack 08 table missing'; end if;
  if exists (select 1 from pg_trigger where tgname = 'competitions_delete_guard') then raise exception 'ROLLOUT CHECK FAILED: the Pack 07 delete guard should have been retired'; end if;
  if (select count(*) from pg_trigger where tgname = 'competitions_guard' and tgrelid = 'public.competitions'::regclass) <> 1 then raise exception 'ROLLOUT CHECK FAILED: competitions_guard'; end if;
  if not exists (select 1 from pg_proc where proname = 'my_event_links') then raise exception 'ROLLOUT CHECK FAILED: reconcile function missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'set_competition_tier') then raise exception 'ROLLOUT CHECK FAILED: set_competition_tier missing'; end if;
  if (select count(*) from storage.buckets where id in ('waiver-documents', 'fighter-gallery')) <> 2 then raise exception 'ROLLOUT CHECK FAILED: storage buckets'; end if;
end $postcheck$;

commit;
notify pgrst, 'reload schema';
select 'BuhurtOS rollout applied: Pack 07, Pack 1 (re-run), Pack 07/Pack 1 reconcile, Pack 08' as result;
