-- Team manager: join an existing team (captain decides), request a new team (organizer reviews), public rosters, notifications.
-- Additive: nothing existing is changed or removed. create_team / approve_team / merge_teams keep working.
--
-- What exists today (checked against every earlier migration):
--   * team_roles.role is only 'captain'. There is no role above captain on a team. "Captain or higher" therefore means
--     a captain of that team, the platform owner, or a platform organizer (platform_roles owner / organizer).
--   * team_memberships and fighters are already publicly readable for approved teams and carry no account id.
--     fighter_accounts (which account controls which fighter) and team_roles are private. So a roster WITHOUT captain flags
--     cannot be built from the tables alone: team_roster() adds is_captain without exposing any account id.
--   * Nothing here ever links a person to an existing public fighter record by name. On approval a person with no fighter
--     gets a NEW one; matching them to an existing look-alike is the later claim flow (docs/VISION.md, "Real data matters":
--     a public roster entry is not an account).
--
-- Email and push delivery of notifications is out of scope (follow-up). Notifications live in the database and are read in the app.
-- Private contact details given on a new-team request stay in team_request_private until a purge or retention rule is decided (follow-up).

-- ---------------------------------------------------------------- public team profile fields (additive columns)
-- A team's own claims. Never verified by this column: affiliations that are verified live in team_affiliations (owner-written).
alter table public.teams
  add column description text check (description is null or char_length(description) <= 500),
  add column website text check (website is null or (char_length(website) <= 300 and website ~ '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$')),
  add column social_links jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  add column founded_year int check (founded_year is null or founded_year between 1900 and 2100),
  -- Free-text claims by the team about which organizations it belongs to. Shown as "claimed, unverified".
  add column claimed_organizations text[] not null default '{}' check (cardinality(claimed_organizations) <= 5);

-- ---------------------------------------------------------------- private reviewer-only part of a new-team request
create table public.team_request_private (
  team_id uuid primary key references public.teams (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  contact_email text not null check (char_length(contact_email) <= 200 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  captain_reason text not null check (char_length(captain_reason) between 10 and 1000),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.team_request_private enable row level security;
-- No policy and no grant: only new_team_request_details() reads it, and only for organizers.

-- ---------------------------------------------------------------- join requests
create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  message text check (message is null or char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null) or status = 'cancelled')
);
alter table public.team_join_requests enable row level security;
create unique index team_join_requests_one_pending on public.team_join_requests (team_id, requester_id) where status = 'pending';
create index team_join_requests_team_idx on public.team_join_requests (team_id, status);
create index team_join_requests_requester_idx on public.team_join_requests (requester_id, created_at desc);
-- No policy and no grant: everything goes through the functions below.

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
create index notifications_user_idx on public.notifications (user_id, created_at desc);
-- No policy and no grant: a person reads their own through my_notifications() and marks them read through mark_notifications_read().

-- ---------------------------------------------------------------- private helpers
-- A person's display name for people reviewing them: profile name, else their public fighter name, else the name on their latest registration.
-- Never an email. Null when there is no usable name.
create or replace function private.person_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = p_user and char_length(btrim(p.display_name)) >= 2),
    (select f.display_name from public.fighter_accounts fa join public.fighters f on f.id = fa.fighter_id where fa.user_id = p_user),
    (select r.full_name from public.registrations r where r.user_id = p_user order by r.created_at desc limit 1))
$$;
revoke execute on function private.person_name(uuid) from public, anon, authenticated;

-- True when the person is already on the team: its captain, a current member of its roster, or marked as its fighter.
create or replace function private.is_team_member(p_team uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_roles where team_id = p_team and user_id = p_user)
    or exists (select 1 from public.fighter_accounts fa
               join public.team_memberships m on m.fighter_id = fa.fighter_id and m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)
               where fa.user_id = p_user)
    or exists (select 1 from public.fighter_accounts fa join public.fighters f on f.id = fa.fighter_id where fa.user_id = p_user and f.team_id = p_team)
$$;
revoke execute on function private.is_team_member(uuid, uuid) from public, anon, authenticated;

-- May the caller decide join requests for this team: its captain, the owner, or a platform organizer.
create or replace function private.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_team_captain(p_team) or private.is_platform_organizer()
$$;
revoke execute on function private.can_manage_team(uuid) from public, anon, authenticated;

-- Who is told about a request for this team: its captains, or, when it has none, the platform owner and organizers.
create or replace function private.team_managers(p_team uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.team_roles where team_id = p_team
  union
  select user_id from public.platform_roles where role in ('owner', 'organizer') and not exists (select 1 from public.team_roles where team_id = p_team)
$$;
revoke execute on function private.team_managers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- roster (public safe)
-- The current roster of a team. Approved teams are public. A pending team's roster is for its captain, its members and organizers.
-- Returns public sporting identity only: the fighter record id (already public), a name, a role, a start date and a captain flag.
-- No account id, no email, no profile data.
create or replace function public.team_roster(p_team uuid)
returns table (fighter_id uuid, display_name text, role text, is_captain boolean, mercenary boolean, since date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (
    exists (select 1 from public.teams t where t.id = p_team and t.status = 'approved')
    or (auth.uid() is not null and (private.is_any_organizer() or private.is_team_member(p_team, auth.uid())))
  ) then
    return;
  end if;
  return query
  with cur as (
    select m.fighter_id, m.role, m.mercenary, m.from_date
    from public.team_memberships m
    where m.team_id = p_team and (m.to_date is null or m.to_date >= current_date)
    union all
    -- People marked as on the team (fighters.team_id) who have no membership row for it at all.
    select f.id, 'fighter', false, null::date
    from public.fighters f
    where f.team_id = p_team and not exists (select 1 from public.team_memberships m where m.team_id = p_team and m.fighter_id = f.id)
  ), one as (
    select distinct on (c.fighter_id) c.fighter_id, c.role, c.mercenary, c.from_date
    from cur c order by c.fighter_id, (c.role = 'captain') desc, c.from_date nulls last
  )
  select o.fighter_id, f.display_name, o.role,
         (o.role = 'captain' or exists (select 1 from public.fighter_accounts fa join public.team_roles r on r.user_id = fa.user_id and r.team_id = p_team and r.role = 'captain' where fa.fighter_id = o.fighter_id)),
         o.mercenary, o.from_date
  from one o join public.fighters f on f.id = o.fighter_id
  order by 4 desc, lower(f.display_name), f.id;
end $$;

-- ---------------------------------------------------------------- join: request, cancel, decide
create or replace function public.request_team_join(p_team uuid, p_message text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_team public.teams; v_msg text := nullif(btrim(coalesce(p_message, '')), ''); v_id uuid; v_name text; v_mgr uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_msg is not null and char_length(v_msg) > 500 then raise exception 'keep your message to 500 characters' using errcode = '22023'; end if;
  -- Only approved teams are joinable. A pending team looks like a missing one, so it is not leaked.
  select * into v_team from public.teams where id = p_team and status = 'approved';
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;
  if private.is_team_member(p_team, v_uid) then raise exception 'you are already part of this team' using errcode = '22023'; end if;
  if exists (select 1 from public.team_join_requests where team_id = p_team and requester_id = v_uid and status = 'pending') then
    raise exception 'you already have a request waiting for this team' using errcode = '22023'; end if;
  if (select count(*) from public.team_join_requests where requester_id = v_uid and status = 'pending') >= 5 then
    raise exception 'you have 5 requests waiting; cancel one or wait for an answer' using errcode = '22023'; end if;
  v_name := private.person_name(v_uid);
  if v_name is null then raise exception 'add your name to your profile first, so the captain knows who is asking' using errcode = '22023'; end if;

  insert into public.team_join_requests (team_id, requester_id, message) values (p_team, v_uid, v_msg) returning id into v_id;
  for v_mgr in select private.team_managers(p_team) loop
    insert into public.notifications (user_id, kind, payload)
    values (v_mgr, 'team_join_requested', jsonb_build_object('request_id', v_id, 'team_id', p_team, 'team_name', v_team.name, 'team_slug', v_team.slug, 'requester_name', v_name));
  end loop;
  perform private.audit(null, 'team.join_requested', p_team::text, jsonb_build_object('request', v_id));
  return v_id;
end $$;

create or replace function public.cancel_team_join(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_req public.team_join_requests;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_req from public.team_join_requests where id = p_request and requester_id = auth.uid() for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'this request has already been answered' using errcode = '22023'; end if;
  update public.team_join_requests set status = 'cancelled', decided_at = now() where id = p_request;
  -- The captains' notification about it no longer has anything to act on.
  update public.notifications set read_at = coalesce(read_at, now()) where kind = 'team_join_requested' and payload ->> 'request_id' = p_request::text;
end $$;

create or replace function public.decide_team_join(p_request uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_req public.team_join_requests; v_team public.teams; v_name text; v_fighter uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_decision not in ('approved', 'declined') then raise exception 'decision must be approved or declined' using errcode = '22023'; end if;
  select * into v_req from public.team_join_requests where id = p_request for update;
  -- A caller who may not decide cannot tell a missing request from someone else's.
  if not found or not private.can_manage_team(v_req.team_id) then raise exception 'you cannot decide this request' using errcode = '42501'; end if;
  if v_req.requester_id = auth.uid() then raise exception 'you cannot decide your own request' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'this request has already been answered' using errcode = '22023'; end if;
  select * into v_team from public.teams where id = v_req.team_id;

  if p_decision = 'approved' then
    v_name := private.person_name(v_req.requester_id);
    if v_name is null then raise exception 'this person has no name on their profile yet' using errcode = '22023'; end if;
    select fighter_id into v_fighter from public.fighter_accounts where user_id = v_req.requester_id;
    if v_fighter is null then
      -- A NEW fighter record. Never matched to an existing public fighter by name: that is the later claim flow.
      insert into public.fighters (display_name, team_id) values (left(v_name, 80), v_req.team_id) returning id into v_fighter;
      insert into public.fighter_accounts (fighter_id, user_id) values (v_fighter, v_req.requester_id);
    else
      update public.fighters set team_id = v_req.team_id where id = v_fighter and team_id is null;
    end if;
    if not exists (select 1 from public.team_memberships where fighter_id = v_fighter and team_id = v_req.team_id and (to_date is null or to_date >= current_date)) then
      insert into public.team_memberships (fighter_id, team_id, role, from_date) values (v_fighter, v_req.team_id, 'fighter', current_date);
    end if;
  end if;

  update public.team_join_requests set status = p_decision, decided_by = auth.uid(), decided_at = now() where id = p_request;
  insert into public.notifications (user_id, kind, payload)
  values (v_req.requester_id, 'team_join_decided', jsonb_build_object('request_id', p_request, 'team_id', v_team.id, 'team_name', v_team.name, 'team_slug', v_team.slug, 'decision', p_decision));
  -- Every manager's "new request" notification is done with.
  update public.notifications set read_at = coalesce(read_at, now()) where kind = 'team_join_requested' and payload ->> 'request_id' = p_request::text;
  perform private.audit(null, 'team.join_' || p_decision, v_team.id::text, jsonb_build_object('request', p_request));
end $$;

-- The caller's own requests, newest first.
create or replace function public.my_team_requests()
returns table (id uuid, team_id uuid, team_name text, team_slug text, status text, message text, created_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.team_id, t.name, t.slug, r.status, r.message, r.created_at, r.decided_at
  from public.team_join_requests r join public.teams t on t.id = r.team_id
  where r.requester_id = auth.uid()
  order by r.created_at desc
$$;

-- Pending requests the caller can decide: for teams they captain. The owner and platform organizers see the pending requests of
-- teams that have no captain. Requester name only (never an email or an account id).
create or replace function public.team_requests_inbox()
returns table (id uuid, team_id uuid, team_name text, team_slug text, requester_name text, message text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.team_id, t.name, t.slug, coalesce(private.person_name(r.requester_id), 'Unnamed member'), r.message, r.created_at
  from public.team_join_requests r join public.teams t on t.id = r.team_id
  where r.status = 'pending' and r.requester_id <> auth.uid()
    and (private.is_team_captain(r.team_id)
         or (private.is_platform_organizer() and not exists (select 1 from public.team_roles c where c.team_id = r.team_id)))
  order by r.created_at
$$;

-- ---------------------------------------------------------------- notifications API
create or replace function public.my_notifications(p_limit int default 50)
returns table (id uuid, kind text, payload jsonb, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.kind, n.payload, n.created_at, n.read_at
  from public.notifications n where n.user_id = auth.uid()
  order by n.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Marks the given notifications read (null = all of the caller's). Returns how many changed.
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- request a new team (the whole form)
-- p_payload keys: name*, slug (derived from name when absent), city*, region, country*, description* (10..500), website (https),
--   social_links ({facebook, instagram, youtube, tiktok, x, discord, twitch, other: https url}), founded_year, claimed_organizations (up to 5 free-text names),
--   colors ([two #rrggbb]), crest_division, initial (1..2 chars), and the reviewer-only keys contact_email*, contact_phone, captain_reason* (10..1000), notes.
-- Creates a PENDING team (private until an organizer approves it) with the caller as captain, and stores the reviewer-only part separately.
create or replace function public.request_new_team(p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_name text; v_slug text; v_city text; v_region text; v_country text; v_desc text; v_site text; v_year int; v_init text; v_div text;
  v_social jsonb := '{}'::jsonb; v_claims text[] := '{}'; v_colors text[]; v_email text; v_phone text; v_reason text; v_notes text;
  v_k text; v_v jsonb; v_c jsonb; v_id uuid;
  c_url constant text := '^https://[^[:space:]/]+\.[^[:space:]/]+([/?#][^[:space:]]*)?$';
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'send the form as an object' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k <> all (array['name','slug','city','region','country','description','website','social_links','founded_year',
     'claimed_organizations','colors','crest_division','initial','contact_email','contact_phone','captain_reason','notes'])) then
    raise exception 'the form has a field this version does not know' using errcode = '22023'; end if;
  -- Every value is read as text first, so a wrongly typed value is a clear refusal and not a cast error.
  if exists (select 1 from jsonb_each(p) e where e.key not in ('social_links','claimed_organizations','colors','founded_year') and e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'string') then
    raise exception 'text fields must be text' using errcode = '22023'; end if;

  v_name := btrim(coalesce(p ->> 'name', ''));
  if char_length(v_name) not between 2 and 80 then raise exception 'the team name must be 2 to 80 characters' using errcode = '22023'; end if;
  v_slug := btrim(coalesce(nullif(p ->> 'slug', ''), regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g')));
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 60 then raise exception 'the team address must be lowercase letters, numbers and dashes' using errcode = '22023'; end if;
  if exists (select 1 from public.teams where slug = v_slug) then raise exception 'that team address is already taken; add your city or a number' using errcode = '22023'; end if;
  v_city := nullif(btrim(coalesce(p ->> 'city', '')), '');
  v_region := nullif(btrim(coalesce(p ->> 'region', '')), '');
  v_country := nullif(btrim(coalesce(p ->> 'country', '')), '');
  if v_city is null or v_country is null then raise exception 'city and country are required' using errcode = '22023'; end if;
  if char_length(v_city) > 80 or char_length(coalesce(v_region, '')) > 80 or char_length(v_country) > 80 then raise exception 'city, region and country are at most 80 characters' using errcode = '22023'; end if;
  v_desc := btrim(coalesce(p ->> 'description', ''));
  if char_length(v_desc) not between 10 and 500 then raise exception 'describe the team in 10 to 500 characters' using errcode = '22023'; end if;
  v_site := nullif(btrim(coalesce(p ->> 'website', '')), '');
  if v_site is not null and (char_length(v_site) > 300 or v_site !~ c_url) then raise exception 'the website must be a full https:// address' using errcode = '22023'; end if;

  if p ? 'founded_year' and p -> 'founded_year' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'founded_year') <> 'number' or (p ->> 'founded_year') !~ '^[0-9]{4}$' then raise exception 'founded year must be a four digit year' using errcode = '22023'; end if;
    v_year := (p ->> 'founded_year')::int;
    if v_year < 1900 or v_year > extract(year from now())::int then raise exception 'founded year must be between 1900 and this year' using errcode = '22023'; end if;
  end if;

  if p ? 'social_links' and p -> 'social_links' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'social_links') <> 'object' then raise exception 'social links must be a list of name and address' using errcode = '22023'; end if;
    if (select count(*) from jsonb_object_keys(p -> 'social_links')) > 8 then raise exception 'at most 8 social links' using errcode = '22023'; end if;
    for v_k, v_v in select key, value from jsonb_each(p -> 'social_links') loop
      if v_k <> all (array['facebook','instagram','youtube','tiktok','x','discord','twitch','other']) then raise exception 'unknown social link: %', left(v_k, 40) using errcode = '22023'; end if;
      if jsonb_typeof(v_v) <> 'string' or char_length(v_v #>> '{}') > 300 or (v_v #>> '{}') !~ c_url then raise exception 'the % link must be a full https:// address', v_k using errcode = '22023'; end if;
      v_social := v_social || jsonb_build_object(v_k, btrim(v_v #>> '{}'));
    end loop;
  end if;

  if p ? 'claimed_organizations' and p -> 'claimed_organizations' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'claimed_organizations') <> 'array' then raise exception 'organizations must be a list' using errcode = '22023'; end if;
    if jsonb_array_length(p -> 'claimed_organizations') > 5 then raise exception 'name at most 5 organizations' using errcode = '22023'; end if;
    for v_c in select value from jsonb_array_elements(p -> 'claimed_organizations') loop
      if jsonb_typeof(v_c) <> 'string' or char_length(btrim(v_c #>> '{}')) not between 2 and 120 then raise exception 'each organization name must be 2 to 120 characters' using errcode = '22023'; end if;
      v_claims := v_claims || btrim(v_c #>> '{}');
    end loop;
  end if;

  v_colors := array['#2C4A8C', '#E9ECEF'];
  if p ? 'colors' and p -> 'colors' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'colors') <> 'array' or jsonb_array_length(p -> 'colors') <> 2
       or exists (select 1 from jsonb_array_elements(p -> 'colors') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^#[0-9A-Fa-f]{6}$') then
      raise exception 'colours must be two hex colours like #2C4A8C' using errcode = '22023'; end if;
    select array_agg(e #>> '{}' order by o) into v_colors from jsonb_array_elements(p -> 'colors') with ordinality as x(e, o);
  end if;
  v_div := coalesce(nullif(p ->> 'crest_division', ''), 'pale');
  if v_div not in ('pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire') then raise exception 'unknown crest pattern' using errcode = '22023'; end if;
  v_init := upper(coalesce(nullif(btrim(p ->> 'initial'), ''), left(v_name, 1)));
  if char_length(v_init) > 2 then raise exception 'the crest initial is one or two letters' using errcode = '22023'; end if;

  v_email := btrim(coalesce(p ->> 'contact_email', ''));
  if char_length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'give a contact email the reviewers can reach you on' using errcode = '22023'; end if;
  v_phone := nullif(btrim(coalesce(p ->> 'contact_phone', '')), '');
  if char_length(coalesce(v_phone, '')) > 40 then raise exception 'the phone number is at most 40 characters' using errcode = '22023'; end if;
  v_reason := btrim(coalesce(p ->> 'captain_reason', ''));
  if char_length(v_reason) not between 10 and 1000 then raise exception 'say in 10 to 1000 characters why you are the captain' using errcode = '22023'; end if;
  v_notes := nullif(btrim(coalesce(p ->> 'notes', '')), '');
  if char_length(coalesce(v_notes, '')) > 2000 then raise exception 'notes are at most 2000 characters' using errcode = '22023'; end if;

  if (select count(*) from public.team_roles r join public.teams t on t.id = r.team_id where r.user_id = v_uid and t.status = 'pending') >= 3 then
    raise exception 'you already have 3 new teams waiting for review' using errcode = '22023'; end if;

  insert into public.teams (slug, name, city, region, country, colors, crest_division, initial, description, website, social_links, founded_year, claimed_organizations)
  values (v_slug, v_name, v_city, v_region, v_country, v_colors, v_div, v_init, v_desc, v_site, v_social, v_year, v_claims)
  returning id into v_id;
  insert into public.team_roles (team_id, user_id, role) values (v_id, v_uid, 'captain');
  insert into public.team_request_private (team_id, requested_by, contact_email, contact_phone, captain_reason, notes) values (v_id, v_uid, v_email, v_phone, v_reason, v_notes);
  -- Tell the platform owner and organizers that a team is waiting for review.
  insert into public.notifications (user_id, kind, payload)
  select pr.user_id, 'team_proposed', jsonb_build_object('team_id', v_id, 'team_name', v_name, 'team_slug', v_slug)
  from public.platform_roles pr where pr.role in ('owner', 'organizer');
  perform private.audit(null, 'team.proposed', v_slug, jsonb_build_object('team', v_id));
  return v_id;
end $$;

-- The reviewer-only part of a new-team request. Organizers only (platform owner, platform organizer, or any event organizer).
create or replace function public.new_team_request_details(p_team uuid)
returns table (team_id uuid, requested_by_name text, contact_email text, contact_phone text, captain_reason text, notes text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_any_organizer() then raise exception 'only an organizer can read a team request' using errcode = '42501'; end if;
  return query
  select p.team_id, private.person_name(p.requested_by), p.contact_email, p.contact_phone, p.captain_reason, p.notes, p.created_at
  from public.team_request_private p where p.team_id = p_team;
end $$;

-- ---------------------------------------------------------------- API surface
-- Signed-in people only, except the roster, which is public for approved teams (the function itself decides for the rest).
revoke execute on function public.request_team_join(uuid, text), public.cancel_team_join(uuid), public.decide_team_join(uuid, text),
  public.my_team_requests(), public.team_requests_inbox(), public.my_notifications(int), public.mark_notifications_read(uuid[]),
  public.request_new_team(jsonb), public.new_team_request_details(uuid), public.team_roster(uuid) from public, anon;
grant execute on function public.request_team_join(uuid, text), public.cancel_team_join(uuid), public.decide_team_join(uuid, text),
  public.my_team_requests(), public.team_requests_inbox(), public.my_notifications(int), public.mark_notifications_read(uuid[]),
  public.request_new_team(jsonb), public.new_team_request_details(uuid) to authenticated;
grant execute on function public.team_roster(uuid) to anon, authenticated;
