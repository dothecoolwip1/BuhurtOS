-- Pack 14 (2026-10-08): Broadcast, livestream and spectator graphics. Additive.
--
-- NOTHING ABOUT SCORES, TIMERS, CARDS OR THE QUEUE IS NEW. The broadcast overlay is another read-only view of the public state that already exists
-- (matches, entries, teams, fighters, lyst_public_state from Pack 13, the career functions from Pack 10). The only state BuhurtOS did not have is:
--   * the event's livestream address and the broadcast presentation options  -> event_broadcast
--   * the event's sponsors (name, logo, link, tier)                           -> event_sponsors + storage bucket sponsor-logos
-- Both are PRESENTATION data: public to read for a public event (the same rule as every other public table, private.is_event_public, which also
-- enforces the organization boundary), writable only by the event's organizers and only through functions. No account id is stored in either table.

-- ---------------------------------------------------------------- 1. broadcast settings (one row per event)
create table if not exists public.event_broadcast (
  event_id uuid primary key references public.events (id) on delete cascade,
  stream_url text check (stream_url is null or (char_length(stream_url) <= 300 and stream_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv|vimeo\.com)(/\S*)?$')),
  stream_title text check (stream_title is null or char_length(stream_title) <= 80),
  -- red_blue: fighter A is the red corner, B the blue corner. team_colors: each side wears its own team colours.
  corners text not null default 'red_blue' check (corners in ('red_blue', 'team_colors')),
  show_records boolean not null default true,
  show_photos boolean not null default true,
  show_sponsors boolean not null default true,
  sponsor_seconds integer not null default 8 check (sponsor_seconds between 3 and 60),
  updated_at timestamptz not null default now()
);
alter table public.event_broadcast enable row level security;
create policy event_broadcast_read on public.event_broadcast for select to anon, authenticated using (private.is_event_public(event_id) or private.is_organizer(event_id));
grant select on public.event_broadcast to anon, authenticated;
revoke insert, update, delete on public.event_broadcast from public, anon, authenticated;
comment on table public.event_broadcast is 'Pack 14: per-event livestream address and broadcast presentation options. Presentation only; no scoring or timing state lives here.';

-- ---------------------------------------------------------------- 2. sponsors
create table if not exists public.event_sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  logo_path text check (logo_path is null or (char_length(logo_path) <= 120 and logo_path ~ '^[0-9a-f-]{36}/[0-9]+\.(png|jpg|webp)$')),
  link_url text check (link_url is null or (char_length(link_url) <= 300 and link_url ~ '^https://[^\s/]+\.[^\s/]+(/\S*)?$')),
  tier text not null default 'partner' check (tier in ('title', 'partner')),
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  on_broadcast boolean not null default true,
  created_at timestamptz not null default now(),
  check (logo_path is null or split_part(logo_path, '/', 1) = event_id::text)
);
create index if not exists event_sponsors_event_idx on public.event_sponsors (event_id, sort_order);
alter table public.event_sponsors enable row level security;
create policy event_sponsors_read on public.event_sponsors for select to anon, authenticated using (private.is_event_public(event_id) or private.is_organizer(event_id));
grant select on public.event_sponsors to anon, authenticated;
revoke insert, update, delete on public.event_sponsors from public, anon, authenticated;
comment on table public.event_sponsors is 'Pack 14: event sponsors shown on the public page and in broadcast graphics. Presentation only.';

-- ---------------------------------------------------------------- 3. logo storage: public read, the event's organizers write into the event's folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sponsor_logos_insert on storage.objects;
create policy sponsor_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and name ~ '^[0-9a-f-]{36}/[0-9]+\.(png|jpg|webp)$' and private.is_organizer(((storage.foldername(name))[1])::uuid));
drop policy if exists sponsor_logos_update on storage.objects;
create policy sponsor_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'sponsor-logos' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and private.is_organizer(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'sponsor-logos' and name ~ '^[0-9a-f-]{36}/[0-9]+\.(png|jpg|webp)$' and private.is_organizer(((storage.foldername(name))[1])::uuid));
drop policy if exists sponsor_logos_delete on storage.objects;
create policy sponsor_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and private.is_organizer(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------- 4. organizer functions (the only writers)
create or replace function public.set_broadcast_settings(p_event uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k text; v_row public.event_broadcast; v_url text; v_title text; v_secs integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can change its broadcast settings' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_settings, 'null'::jsonb)) <> 'object' then raise exception 'send the settings as an object' using errcode = '22023'; end if;
  for v_k in select jsonb_object_keys(p_settings) loop
    if v_k not in ('stream_url', 'stream_title', 'corners', 'show_records', 'show_photos', 'show_sponsors', 'sponsor_seconds') then raise exception 'unknown setting: %', v_k using errcode = '22023'; end if;
  end loop;
  if p_settings ? 'stream_url' then
    v_url := nullif(btrim(coalesce(p_settings ->> 'stream_url', '')), '');
    if v_url is not null and (char_length(v_url) > 300 or v_url !~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv|vimeo\.com)(/\S*)?$') then
      raise exception 'use the full YouTube, Twitch or Vimeo address, starting with https://' using errcode = '22023'; end if;
  end if;
  if p_settings ? 'stream_title' then
    v_title := nullif(btrim(coalesce(p_settings ->> 'stream_title', '')), '');
    if v_title is not null and char_length(v_title) > 80 then raise exception 'the stream title is 80 characters at most' using errcode = '22023'; end if;
  end if;
  if p_settings ? 'corners' and coalesce(p_settings ->> 'corners', '') not in ('red_blue', 'team_colors') then raise exception 'corners is red_blue or team_colors' using errcode = '22023'; end if;
  for v_k in select unnest(array['show_records', 'show_photos', 'show_sponsors']) loop
    if p_settings ? v_k and jsonb_typeof(p_settings -> v_k) <> 'boolean' then raise exception '% is yes or no', v_k using errcode = '22023'; end if;
  end loop;
  if p_settings ? 'sponsor_seconds' then
    if jsonb_typeof(p_settings -> 'sponsor_seconds') <> 'number' or (p_settings ->> 'sponsor_seconds') !~ '^\d{1,2}$' or (p_settings ->> 'sponsor_seconds')::int not between 3 and 60 then
      raise exception 'a sponsor shows for 3 to 60 seconds' using errcode = '22023'; end if;
    v_secs := (p_settings ->> 'sponsor_seconds')::int;
  end if;

  insert into public.event_broadcast (event_id) values (p_event) on conflict (event_id) do nothing;
  update public.event_broadcast set
    stream_url = case when p_settings ? 'stream_url' then v_url else stream_url end,
    stream_title = case when p_settings ? 'stream_title' then v_title else stream_title end,
    corners = coalesce(p_settings ->> 'corners', corners),
    show_records = coalesce((p_settings ->> 'show_records')::boolean, show_records),
    show_photos = coalesce((p_settings ->> 'show_photos')::boolean, show_photos),
    show_sponsors = coalesce((p_settings ->> 'show_sponsors')::boolean, show_sponsors),
    sponsor_seconds = coalesce(v_secs, sponsor_seconds),
    updated_at = now()
  where event_id = p_event returning * into v_row;
  perform private.audit(p_event, 'broadcast.settings', p_event::text, p_settings);
  return to_jsonb(v_row);
end $$;

create or replace function public.save_event_sponsor(
  p_event uuid, p_id uuid default null, p_name text default null, p_logo_path text default null, p_link text default null,
  p_tier text default 'partner', p_sort integer default 0, p_on_broadcast boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.event_sponsors; v_name text := btrim(coalesce(p_name, '')); v_link text := nullif(btrim(coalesce(p_link, '')), ''); v_logo text := nullif(btrim(coalesce(p_logo_path, '')), '');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can manage its sponsors' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'a sponsor name is 2 to 60 characters' using errcode = '22023'; end if;
  if p_tier is null or p_tier not in ('title', 'partner') then raise exception 'tier is title or partner' using errcode = '22023'; end if;
  if p_sort is null or p_sort not between 0 and 999 then raise exception 'sort order is 0 to 999' using errcode = '22023'; end if;
  if v_link is not null and (char_length(v_link) > 300 or v_link !~ '^https://[^\s/]+\.[^\s/]+(/\S*)?$') then raise exception 'use the full https:// address of the sponsor' using errcode = '22023'; end if;
  if v_logo is not null and (v_logo !~ '^[0-9a-f-]{36}/[0-9]+\.(png|jpg|webp)$' or split_part(v_logo, '/', 1) <> p_event::text) then raise exception 'that logo is not in this event''s folder' using errcode = '42501'; end if;
  if p_id is null then
    if (select count(*) from public.event_sponsors where event_id = p_event) >= 24 then raise exception 'an event can show up to 24 sponsors' using errcode = '22023'; end if;
    insert into public.event_sponsors (event_id, name, logo_path, link_url, tier, sort_order, on_broadcast) values (p_event, v_name, v_logo, v_link, p_tier, p_sort, coalesce(p_on_broadcast, true)) returning * into v_row;
  else
    update public.event_sponsors set name = v_name, logo_path = v_logo, link_url = v_link, tier = p_tier, sort_order = p_sort, on_broadcast = coalesce(p_on_broadcast, true)
      where id = p_id and event_id = p_event returning * into v_row;
    if not found then raise exception 'sponsor not found in this event' using errcode = 'P0002'; end if;
  end if;
  perform private.audit(p_event, 'broadcast.sponsor_saved', v_row.id::text, jsonb_build_object('name', v_row.name, 'tier', v_row.tier, 'on_broadcast', v_row.on_broadcast));
  return to_jsonb(v_row);
end $$;

create or replace function public.remove_event_sponsor(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.event_sponsors;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_row from public.event_sponsors where id = p_id;
  if not found then raise exception 'sponsor not found' using errcode = 'P0002'; end if;
  if not private.is_organizer(v_row.event_id) then raise exception 'only an organizer of this event can manage its sponsors' using errcode = '42501'; end if;
  delete from public.event_sponsors where id = p_id;
  perform private.audit(v_row.event_id, 'broadcast.sponsor_removed', p_id::text, jsonb_build_object('name', v_row.name));
  return jsonb_build_object('status', 'ok', 'logo_path', v_row.logo_path);
end $$;

revoke execute on function public.set_broadcast_settings(uuid, jsonb), public.save_event_sponsor(uuid, uuid, text, text, text, text, integer, boolean), public.remove_event_sponsor(uuid) from public, anon;
grant execute on function public.set_broadcast_settings(uuid, jsonb), public.save_event_sponsor(uuid, uuid, text, text, text, text, integer, boolean), public.remove_event_sponsor(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. realtime: a sponsor or stream change reaches an open overlay at once (public tables only)
do $do$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['event_broadcast', 'event_sponsors'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $do$;
