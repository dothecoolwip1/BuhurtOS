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
