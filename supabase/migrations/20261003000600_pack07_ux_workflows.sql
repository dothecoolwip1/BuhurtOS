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
