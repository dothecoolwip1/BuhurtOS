-- Pack 22, part 5 (2026-10-15): penalties, suspensions, appeals, authenticity infractions and eligibility. Additive.
--
-- THE OFFICIALS DECIDE. BuhurtOS records what the Knight Marshal, the Authenticity Officer, an organization or the Judiciary Committee decided, cites
-- the official provision, keeps the history, and shows the consequences people must act on. It never decides a penalty, never interprets a rule and
-- never changes a score by itself.
--
-- Extends what exists instead of building beside it:
--   * match incidents stay Pack 13 match_discipline (+ Pack 22 rule citation). New: the ruleset version the fight was fought under is snapshotted on
--     each record, and a card records its CONCEPT (card_key: yellow_card / red_card / green_card ...) next to the label shown on the tablet, so a
--     green card is never counted as a yellow one.
--   * discipline_card_types: each governing body's card and warning concepts, each traced to the provisions that define it (vocabulary, not logic).
--   * event_sanctions(+_private): a sanction at event level, outside a fight (a green card from the Authenticity Officer, a removal, a team
--     disqualification). Kept separate from match records.
--   * authenticity_findings: the Authenticity Officer's infractions (minor / moderate / major, as the Infractions document classifies them).
--   * discipline_suspensions(+_private): who may not take part, issued by an event, an organization or the platform, with a scope and a period. A
--     change or a lift is a new fact (the old row is superseded / lifted, never rewritten).
--   * discipline_reviews: event appeals (to the Knight Marshal, through the Secretary) and Judiciary Committee reviews, with the deadline the
--     official document sets and the outcome it allows.
--   * discipline_history: append-only, every action on the above.
--   * competition_rulesets: the official documents a competition is fought under (any governing body), frozen once it is finished.
--   * eligibility: an active suspension BLOCKS acceptance, check-in, entry and readiness (no readiness override clears it: lifting the suspension does);
--     everything else is a WARNING shown to the people who must act.
-- Notifications go through the existing Pack 15 system (three kinds added, its functions extended in place with asserted anchors).

-- ---------------------------------------------------------------- 0. who may see and do what (existing helpers only; no new super-admin)
-- Event discipline is read by the event's officials (organizer, head marshal, marshal, scorekeeper) and its desk (check-in, inspector).
create or replace function private.can_see_discipline(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.can_score(p_event), false) or coalesce(private.can_see_readiness_detail(p_event), false) $$;
-- The accounts linked to a fighter (a fighter is a sporting identity; accounts are a separate relationship).
create or replace function private.fighter_users(p_fighter uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$ select fa.user_id from public.fighter_accounts fa where fa.fighter_id = p_fighter $$;
create or replace function private.is_my_fighter(p_fighter uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select p_fighter is not null and exists (select 1 from public.fighter_accounts fa where fa.fighter_id = p_fighter and fa.user_id = auth.uid()) $$;
create or replace function private.team_captain_users(p_team uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$ select r.user_id from public.team_roles r where r.team_id = p_team and r.role = 'captain' $$;
revoke execute on function private.can_see_discipline(uuid), private.fighter_users(uuid), private.is_my_fighter(uuid), private.team_captain_users(uuid) from public, anon, authenticated;
-- The row-level policies run as the caller, so the yes/no questions they ask about the caller are executable by signed-in users (like private.can_score).
grant execute on function private.can_see_discipline(uuid), private.is_my_fighter(uuid) to authenticated;

create or replace function private.clean_text(p text, p_max int) returns text
language sql immutable set search_path = '' as $$ select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), p_max), '') $$;
revoke execute on function private.clean_text(text, int) from public, anon, authenticated;

-- A provision cited by a disciplinary record must come from a published (or superseded) version; a test ruleset only at a test event.
create or replace function private.check_cited_provision(p_provision uuid, p_event uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_status text; v_syn boolean; v_version uuid;
begin
  if p_provision is null then return null; end if;
  select v.status, v.synthetic, v.id into v_status, v_syn, v_version from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where p.id = p_provision;
  if v_status is null or v_status not in ('published', 'superseded') then raise exception 'cite a rule from a published ruleset' using errcode = '22023'; end if;
  if v_syn and (p_event is null or not private.is_synthetic('event', p_event)) then raise exception 'a test ruleset can only be cited at a test event' using errcode = '22023'; end if;
  return v_version;
end $$;
revoke execute on function private.check_cited_provision(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. the documents a competition is fought under
create table if not exists public.competition_rulesets (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  ruleset_version_id uuid not null references public.ruleset_versions (id) on delete restrict,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (competition_id, ruleset_version_id)
);
create index if not exists competition_rulesets_version_idx on public.competition_rulesets (ruleset_version_id);
alter table public.competition_rulesets enable row level security;
create policy competition_rulesets_read on public.competition_rulesets for select to anon, authenticated
  using (private.is_event_public(private.event_of_competition(competition_id)) or private.can_score(private.event_of_competition(competition_id))
         or private.is_organizer(private.event_of_competition(competition_id)));
revoke select on public.competition_rulesets from public, anon, authenticated;
grant select (competition_id, ruleset_version_id, added_at) on public.competition_rulesets to anon, authenticated;
revoke insert, update, delete on public.competition_rulesets from public, anon, authenticated;
comment on table public.competition_rulesets is 'Pack 22: the official documents (ruleset versions) a competition is fought under, for any governing body. competitions.ruleset_version_id stays the primary rulebook. Frozen once the competition is finished.';

create or replace function private.competition_rulesets_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_vstatus text; v_syn boolean; v_event uuid;
begin
  select k.status, k.event_id into v_status, v_event from public.competitions k where k.id = coalesce(new.competition_id, old.competition_id);
  if v_status = 'finished' then raise exception 'a finished competition keeps the documents it was fought under' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then raise exception 'remove the document and add the other one instead' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    select status, synthetic into v_vstatus, v_syn from public.ruleset_versions where id = new.ruleset_version_id;
    if v_vstatus is null or v_vstatus not in ('published', 'superseded') then raise exception 'choose a published ruleset version' using errcode = '22023'; end if;
    if v_syn and not private.is_synthetic('event', v_event) then raise exception 'a test ruleset can only be used by a test event' using errcode = '22023'; end if;
    return new;
  end if;
  return old;
end $$;
revoke execute on function private.competition_rulesets_guard() from public, anon, authenticated;
drop trigger if exists competition_rulesets_guard on public.competition_rulesets;
create trigger competition_rulesets_guard before insert or update or delete on public.competition_rulesets for each row execute function private.competition_rulesets_guard();

-- Organizers set the list (replacing it). Every version must be published; the primary rulebook stays competitions.ruleset_version_id.
create or replace function public.set_competition_rulesets(p_competition uuid, p_versions uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.competitions; v_before uuid[]; v_after uuid[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_versions, '{}')) x where x is not null), '{}');
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_c from public.competitions where id = p_competition for update;
  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only this event''s organizers choose its documents' using errcode = '42501'; end if;
  if cardinality(v_after) > 60 then raise exception 'at most 60 documents' using errcode = '22023'; end if;
  select coalesce(array_agg(ruleset_version_id order by ruleset_version_id), '{}') into v_before from public.competition_rulesets where competition_id = p_competition;
  if v_before = v_after then return jsonb_build_object('status', 'unchanged', 'count', cardinality(v_after)); end if;
  delete from public.competition_rulesets where competition_id = p_competition and not (ruleset_version_id = any (v_after));
  insert into public.competition_rulesets (competition_id, ruleset_version_id, added_by)
  select p_competition, x, auth.uid() from unnest(v_after) x on conflict do nothing;
  perform private.audit(v_c.event_id, 'competition.rulesets', p_competition::text, jsonb_build_object('before', v_before, 'after', v_after));
  return jsonb_build_object('status', 'ok', 'count', cardinality(v_after));
end $$;

-- "Use the current documents of <governing body> for this format": every PUBLISHED version of that body whose classification says it applies directly
-- to the competition's format (or to every format). Read from the inventory's classification, not from a list in code; any governing body works.
-- The primary rulebook is the body's 'rules' document for the format, when there is exactly one.
create or replace function public.apply_current_documents(p_competition uuid, p_governing_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.competitions; v_league text; v_set uuid[]; v_primary uuid; v_n int; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_c from public.competitions where id = p_competition;
  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only this event''s organizers choose its documents' using errcode = '42501'; end if;
  select league into v_league from public.ref_categories where code = v_c.category;
  select coalesce(array_agg(rv.id order by r.page_order, r.inventory_key), '{}') into v_set
  from public.rulesets r join public.ruleset_versions rv on rv.ruleset_id = r.id and rv.status = 'published'
  where r.governing_body = btrim(coalesce(p_governing_body, '')) and r.relevance = 'direct' and (cardinality(r.applies_to) = 0 or v_league = any (r.applies_to))
    and (not rv.synthetic or private.is_synthetic('event', v_c.event_id));
  if cardinality(v_set) = 0 then raise exception 'no published % documents apply to this format yet', btrim(coalesce(p_governing_body, '')) using errcode = 'P0002'; end if;
  select count(*), min(rv.id::text)::uuid into v_n, v_primary from public.rulesets r join public.ruleset_versions rv on rv.ruleset_id = r.id and rv.status = 'published'
  where r.governing_body = btrim(p_governing_body) and r.kind = 'rules' and v_league = any (r.applies_to);
  v_res := public.set_competition_rulesets(p_competition, v_set);
  if v_n = 1 and v_c.ruleset_version_id is distinct from v_primary then perform public.set_competition_ruleset_version(p_competition, v_primary); end if;
  return v_res || jsonb_build_object('primary', case when v_n = 1 then v_primary end);
end $$;

-- ---------------------------------------------------------------- 2. card and warning concepts per governing body (vocabulary, traced to the text)
create table if not exists public.discipline_card_types (
  governing_body text not null,
  key text not null check (key ~ '^[a-z0-9_]{1,24}$'),
  label text not null check (char_length(label) between 1 and 30),
  level text not null check (level in ('verbal_warning', 'reprimand', 'yellow_card', 'red_card', 'green_card')),
  on_tablet boolean not null default true,          -- offered on the field tablet (the marshal shows it in a fight)
  issued_at_event boolean not null default false,   -- can also be given outside a fight (event_sanctions)
  sources text[] not null default '{}',              -- provision stable keys that define it ("buhurt-regulations:6.2")
  note text check (note is null or char_length(note) <= 300),
  sort int not null default 0,
  primary key (governing_body, key)
);
alter table public.discipline_card_types enable row level security;
create policy discipline_card_types_read on public.discipline_card_types for select to anon, authenticated using (true);
grant select on public.discipline_card_types to anon, authenticated;
revoke insert, update, delete on public.discipline_card_types from public, anon, authenticated;
comment on table public.discipline_card_types is 'Pack 22: the card and warning concepts a governing body defines, each traced to the provisions that define them. BuhurtOS does not compute their consequences.';

insert into public.discipline_card_types (governing_body, key, label, level, on_tablet, issued_at_event, sources, note, sort) values
  ('Buhurt International', 'verbal_warning', 'Verbal warning', 'verbal_warning', false, false, array['buhurt-regulations:6.1', 'duel-regulations:4.1', 'outrance-rules:13'],
   'Recorded on the tablet as a warning. Buhurt Regulations 6.1: it can''t affect scoring. Duel Regulations 4.1: not registered in protocols.', 1),
  ('Buhurt International', 'reprimand', 'Reprimand', 'reprimand', true, false, array['duel-regulations:4.2'],
   'Duels only. Duel Regulations 4.2 adds points to the opponent; BuhurtOS records the reprimand and does not change the score.', 2),
  ('Buhurt International', 'yellow_card', 'Yellow card', 'yellow_card', true, true, array['buhurt-regulations:6.2', 'buhurt-regulations:6.2.2', 'duel-regulations:4.3', 'tournament-structure:2'], null, 3),
  ('Buhurt International', 'red_card', 'Red card', 'red_card', true, true, array['buhurt-regulations:6.3', 'duel-regulations:4.4', 'tournament-structure:2'], null, 4),
  ('Buhurt International', 'green_card', 'Green card', 'green_card', true, true,
   array['buhurt-regulations:6.4', 'duel-regulations:4.5', 'tournament-structure:2', 'infractions:3'],
   'Authenticity warning. Not a yellow card: it is counted on its own (Buhurt Regulations 6.5.2: green cards do not count in team disqualification).', 5)
on conflict (governing_body, key) do nothing;

-- The event's tablet card list from a governing body's vocabulary (the head marshal or an organizer; Pack 13 settings, one writer).
create or replace function public.apply_card_preset(p_event uuid, p_governing_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cards jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.can_resolve_results(p_event) then raise exception 'only the head marshal or an organizer can change the lyst settings' using errcode = '42501'; end if;
  select jsonb_agg(jsonb_build_object('key', key, 'label', label) order by sort) into v_cards from public.discipline_card_types where governing_body = btrim(coalesce(p_governing_body, '')) and on_tablet;
  if v_cards is null then raise exception 'no card types are recorded for %', p_governing_body using errcode = 'P0002'; end if;
  return public.set_lyst_settings(p_event, jsonb_build_object('cards', v_cards));
end $$;

-- ---------------------------------------------------------------- 3. match records: ruleset snapshot and card concept
alter table public.match_discipline add column if not exists ruleset_version_id uuid references public.ruleset_versions (id) on delete restrict;
alter table public.match_discipline add column if not exists card_key text check (card_key is null or card_key ~ '^[a-z0-9_]{1,24}$');
comment on column public.match_discipline.ruleset_version_id is 'Pack 22: the primary ruleset version of the competition when the record was made (snapshot; never changes).';
comment on column public.match_discipline.card_key is 'Pack 22: the card concept (the key of the event''s card type: yellow_card, red_card, green_card ...). The label is what the tablet showed.';

create or replace function private.match_discipline_fill() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select k.ruleset_version_id into new.ruleset_version_id from public.matches m join public.competitions k on k.id = m.competition_id where m.id = new.match_id;
  if new.kind = 'card' and new.label is not null then
    select c ->> 'key' into new.card_key from jsonb_array_elements(private.lyst_settings_for(new.event_id) -> 'cards') c where c ->> 'label' = new.label limit 1;
  else
    new.card_key := null;
  end if;
  return new;
end $$;
revoke execute on function private.match_discipline_fill() from public, anon, authenticated;
drop trigger if exists match_discipline_fill on public.match_discipline;
create trigger match_discipline_fill before insert on public.match_discipline for each row execute function private.match_discipline_fill();

-- The Pack 13 guard learns the two new columns: they are as final as the rest of the record.
create or replace function private.lyst_discipline_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a disciplinary record is never deleted: void it with a reason' using errcode = 'P0001'; end if;
  if (new.id, new.match_id, new.event_id, new.round_no, new.side, new.kind, new.label, new.amount, new.related_id, new.created_at, new.ruleset_version_id, new.card_key)
     is distinct from (old.id, old.match_id, old.event_id, old.round_no, old.side, old.kind, old.label, old.amount, old.related_id, old.created_at, old.ruleset_version_id, old.card_key)
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
    raise exception 'only voiding is allowed on a disciplinary record' using errcode = 'P0001'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 4. the append-only history
create table if not exists public.discipline_history (
  id bigserial primary key,
  event_id uuid references public.events (id) on delete cascade,
  organization_id uuid,
  fighter_id uuid references public.fighters (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  entity text not null check (entity in ('event_sanction', 'suspension', 'review', 'finding')),
  entity_id uuid not null,
  action text not null check (char_length(action) between 3 and 40),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 4096),
  actor uuid,
  at timestamptz not null default clock_timestamp()
);
create index if not exists discipline_history_entity_idx on public.discipline_history (entity, entity_id, at);
create index if not exists discipline_history_fighter_idx on public.discipline_history (fighter_id, at) where fighter_id is not null;
create index if not exists discipline_history_event_idx on public.discipline_history (event_id, at) where event_id is not null;
alter table public.discipline_history enable row level security;
-- Read through the functions below only (the actor is an account id).
revoke all on public.discipline_history from public, anon, authenticated;
create or replace function private.discipline_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'disciplinary history is append-only' using errcode = 'P0001'; end $$;
revoke execute on function private.discipline_append_only() from public, anon, authenticated;
drop trigger if exists discipline_history_append_only on public.discipline_history;
create trigger discipline_history_append_only before update or delete on public.discipline_history for each row execute function private.discipline_append_only();

create or replace function private.discipline_log(p_event uuid, p_org uuid, p_fighter uuid, p_team uuid, p_entity text, p_id uuid, p_action text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.discipline_history (event_id, organization_id, fighter_id, team_id, entity, entity_id, action, details, actor)
  values (p_event, p_org, p_fighter, p_team, p_entity, p_id, p_action, coalesce(p_details, '{}'::jsonb), auth.uid())
$$;
revoke execute on function private.discipline_log(uuid, uuid, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. event-level sanctions (outside a fight)
create table if not exists public.event_sanctions (
  id uuid primary key,                                     -- the command id (idempotent)
  event_id uuid not null references public.events (id) on delete cascade,
  competition_id uuid references public.competitions (id) on delete cascade,
  fighter_id uuid references public.fighters (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  kind text not null check (kind in ('warning', 'card', 'removal', 'disqualification', 'team_disqualification')),
  card_key text check (card_key is null or card_key ~ '^[a-z0-9_]{1,24}$'),
  label text check (label is null or char_length(label) <= 30),
  provision_id uuid references public.rule_provisions (id) on delete restrict,
  ruleset_version_id uuid references public.ruleset_versions (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'withdrawn', 'removed')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((fighter_id is null) <> (team_id is null)),
  check ((kind = 'card') = (card_key is not null)),
  check (kind <> 'team_disqualification' or team_id is not null),
  check ((status = 'active') = (ended_at is null))
);
create index if not exists event_sanctions_event_idx on public.event_sanctions (event_id, created_at);
create index if not exists event_sanctions_fighter_idx on public.event_sanctions (fighter_id) where fighter_id is not null;
create index if not exists event_sanctions_team_idx on public.event_sanctions (team_id) where team_id is not null;
-- Tournament Structure 2 / Buhurt Regulations 6.4: one green card per competitor, and it follows them from tournament to tournament at the event.
create unique index if not exists event_sanctions_one_green_card on public.event_sanctions (event_id, fighter_id) where card_key = 'green_card' and status = 'active';
alter table public.event_sanctions enable row level security;
create policy event_sanctions_read on public.event_sanctions for select to authenticated
  using (private.can_see_discipline(event_id) or private.is_my_fighter(fighter_id) or (team_id is not null and private.is_team_captain(team_id)) or private.is_org_admin_of_event(event_id));
grant select on public.event_sanctions to authenticated;
revoke insert, update, delete on public.event_sanctions from public, anon, authenticated;
comment on table public.event_sanctions is 'Pack 22: sanctions given at event level, outside a fight (green card from the Authenticity Officer, removal, team disqualification). Never deleted: withdrawn or removed with a reason.';

create table if not exists public.event_sanctions_private (
  sanction_id uuid primary key references public.event_sanctions (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 300),
  issued_by uuid not null,
  end_reason text check (end_reason is null or char_length(end_reason) <= 300),
  ended_by uuid
);
alter table public.event_sanctions_private enable row level security;
create policy event_sanctions_private_read on public.event_sanctions_private for select to authenticated
  using (private.can_see_discipline((select s.event_id from public.event_sanctions s where s.id = sanction_id)));
grant select on public.event_sanctions_private to authenticated;
revoke insert, update, delete on public.event_sanctions_private from public, anon, authenticated;

create or replace function private.event_sanction_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a sanction is never deleted: withdraw it with a reason' using errcode = 'P0001'; end if;
  if (new.id, new.event_id, new.competition_id, new.fighter_id, new.team_id, new.kind, new.card_key, new.label, new.provision_id, new.ruleset_version_id, new.created_at)
     is distinct from (old.id, old.event_id, old.competition_id, old.fighter_id, old.team_id, old.kind, old.card_key, old.label, old.provision_id, old.ruleset_version_id, old.created_at)
     or old.status <> 'active' then
    raise exception 'a sanction only ends (withdrawn or removed), once' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.event_sanction_guard() from public, anon, authenticated;
drop trigger if exists event_sanctions_guard on public.event_sanctions;
create trigger event_sanctions_guard before update or delete on public.event_sanctions for each row execute function private.event_sanction_guard();

-- The event's officials record a sanction the Knight Marshal (head marshal) or an organizer decided. A green card is the Authenticity Officer's
-- (inspector) decision as well. A scorekeeper, a marshal or the medic cannot.
create or replace function public.issue_event_sanction(p_command uuid, p_event uuid, p_kind text, p_fighter uuid default null, p_team uuid default null,
  p_competition uuid default null, p_card_key text default null, p_provision uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.event_sanctions; v_label text; v_body text; v_version uuid; v_reason text := private.clean_text(p_reason, 300);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null or p_event is null then raise exception 'a command id and an event are required' using errcode = '22023'; end if;
  select * into v_old from public.event_sanctions where id = p_command;
  if found then
    if v_old.event_id <> p_event then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  if not (private.can_resolve_results(p_event) or (p_kind = 'card' and p_card_key = 'green_card' and private.can_inspect(p_event))) then
    raise exception 'only the head marshal or an organizer (or, for a green card, the authenticity officer) can give a sanction' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('warning', 'card', 'removal', 'disqualification', 'team_disqualification') then raise exception 'unknown kind of sanction' using errcode = '22023'; end if;
  if (p_fighter is null) = (p_team is null) then raise exception 'name either a fighter or a team' using errcode = '22023'; end if;
  if p_kind = 'team_disqualification' and p_team is null then raise exception 'a team disqualification names a team' using errcode = '22023'; end if;
  if p_competition is not null and not exists (select 1 from public.competitions where id = p_competition and event_id = p_event) then raise exception 'that competition is not at this event' using errcode = '22023'; end if;
  -- The subject must take part in this event (an accepted registration, or an entry in one of its competitions).
  if p_fighter is not null and not exists (select 1 from public.registrations g where g.event_id = p_event and g.fighter_id = p_fighter and g.status in ('accepted', 'pending'))
     and not exists (select 1 from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = p_event and en.fighter_id = p_fighter)
     and not exists (select 1 from public.entry_fighters ef join public.competitions k on k.id = ef.competition_id where k.event_id = p_event and ef.fighter_id = p_fighter) then
    raise exception 'that fighter is not taking part in this event' using errcode = '22023'; end if;
  if p_team is not null and not exists (select 1 from public.entries en join public.competitions k on k.id = en.competition_id where k.event_id = p_event and en.team_id = p_team)
     and not exists (select 1 from public.registrations g where g.event_id = p_event and g.team_id = p_team) then
    raise exception 'that team is not taking part in this event' using errcode = '22023'; end if;
  if p_kind = 'card' then
    if p_card_key is null then raise exception 'choose a card' using errcode = '22023'; end if;
    -- the card's concept from the event's tablet vocabulary, else from the governing body of the competition's documents
    select c ->> 'label' into v_label from jsonb_array_elements(private.lyst_settings_for(p_event) -> 'cards') c where c ->> 'key' = p_card_key limit 1;
    if v_label is null then
      select t.label into v_label from public.discipline_card_types t where t.key = p_card_key and t.issued_at_event limit 1;
    end if;
    if v_label is null then raise exception 'that card type is not set up for this event' using errcode = '22023'; end if;
    if p_card_key = 'green_card' and p_fighter is null then raise exception 'a green card is given to a competitor' using errcode = '22023'; end if;
    if p_card_key = 'green_card' and exists (select 1 from public.event_sanctions where event_id = p_event and fighter_id = p_fighter and card_key = 'green_card' and status = 'active') then
      raise exception 'this competitor already has a green card at this event (one per event)' using errcode = 'P0001'; end if;
  elsif p_card_key is not null then raise exception 'only a card has a card type' using errcode = '22023'; end if;
  v_version := private.check_cited_provision(p_provision, p_event);
  insert into public.event_sanctions (id, event_id, competition_id, fighter_id, team_id, kind, card_key, label, provision_id, ruleset_version_id)
  values (p_command, p_event, p_competition, p_fighter, p_team, p_kind, p_card_key, v_label, p_provision, v_version);
  insert into public.event_sanctions_private (sanction_id, reason, issued_by) values (p_command, v_reason, auth.uid());
  perform private.discipline_log(p_event, private.event_org(p_event), p_fighter, p_team, 'event_sanction', p_command, 'issued',
    jsonb_build_object('kind', p_kind, 'card', p_card_key, 'competition', p_competition, 'provision', p_provision));
  perform private.audit(p_event, 'discipline.sanction_issued', p_command::text, jsonb_build_object('kind', p_kind, 'card', p_card_key, 'fighter', p_fighter, 'team', p_team, 'competition', p_competition));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

-- Withdraw (a mistake, an upheld appeal) or remove (a green card after the Authenticity Officer validated the correction). Never deleted.
create or replace function public.end_event_sanction(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.event_sanctions; v_reason text := private.clean_text(p_reason, 300);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.event_sanctions where id = p_id for update;
  if not found then raise exception 'sanction not found' using errcode = 'P0002'; end if;
  if not (private.can_resolve_results(v.event_id) or (v.card_key = 'green_card' and private.can_inspect(v.event_id))) then
    raise exception 'only the head marshal or an organizer (or, for a green card, the authenticity officer) can change a sanction' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('withdrawn', 'removed') then raise exception 'a sanction is withdrawn or removed' using errcode = '22023'; end if;
  if p_status = 'removed' and v.card_key is distinct from 'green_card' then raise exception 'only a green card is removed (after the correction is validated); withdraw other sanctions' using errcode = '22023'; end if;
  if v.status <> 'active' then return jsonb_build_object('status', 'duplicate'); end if;
  if char_length(coalesce(v_reason, '')) < 3 then raise exception 'say why (3 to 300 characters)' using errcode = '22023'; end if;
  update public.event_sanctions set status = p_status, ended_at = clock_timestamp() where id = p_id;
  update public.event_sanctions_private set end_reason = v_reason, ended_by = auth.uid() where sanction_id = p_id;
  perform private.discipline_log(v.event_id, private.event_org(v.event_id), v.fighter_id, v.team_id, 'event_sanction', p_id, p_status, jsonb_build_object('reason', v_reason));
  perform private.audit(v.event_id, 'discipline.sanction_' || p_status, p_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 6. authenticity infractions (the Authenticity Officer = the event's inspector role)
create table if not exists public.authenticity_findings (
  id uuid primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  fighter_id uuid references public.fighters (id) on delete restrict,
  severity text not null check (severity in ('minor', 'moderate', 'major')),   -- Infractions Classification and Application
  item text not null check (char_length(item) between 2 and 120),               -- what: "gauntlets", "tabard sleeves"
  provision_id uuid references public.rule_provisions (id) on delete restrict,
  ruleset_version_id uuid references public.ruleset_versions (id) on delete restrict,
  note text check (note is null or char_length(note) <= 300),                    -- staff only
  status text not null default 'open' check (status in ('open', 'corrected', 'voided')),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  check ((status = 'open') = (closed_at is null))
);
create index if not exists authenticity_findings_reg_idx on public.authenticity_findings (registration_id, created_at);
create index if not exists authenticity_findings_event_idx on public.authenticity_findings (event_id);
alter table public.authenticity_findings enable row level security;
-- The desk reads them in full; the fighter reads their own through my_discipline (without the staff note).
create or replace function private.can_read_findings(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.can_see_readiness_detail(p_event), false) or coalesce(private.can_resolve_results(p_event), false) $$;
revoke execute on function private.can_read_findings(uuid) from public, anon, authenticated;
grant execute on function private.can_read_findings(uuid) to authenticated;   -- a policy helper: yes/no about the caller
create policy authenticity_findings_read on public.authenticity_findings for select to authenticated using (private.can_read_findings(event_id));
grant select on public.authenticity_findings to authenticated;
revoke insert, update, delete on public.authenticity_findings from public, anon, authenticated;
comment on table public.authenticity_findings is 'Pack 22: authenticity infractions found by the Authenticity Officer, classified minor / moderate / major as the official Infractions document does. Never deleted: corrected or voided.';

create or replace function private.authenticity_finding_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a finding is never deleted: void it with a reason' using errcode = 'P0001'; end if;
  if (new.id, new.event_id, new.registration_id, new.fighter_id, new.severity, new.item, new.provision_id, new.ruleset_version_id, new.note, new.recorded_by, new.created_at)
     is distinct from (old.id, old.event_id, old.registration_id, old.fighter_id, old.severity, old.item, old.provision_id, old.ruleset_version_id, old.note, old.recorded_by, old.created_at)
     or old.status <> 'open' then
    raise exception 'a finding only closes (corrected or voided), once' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.authenticity_finding_guard() from public, anon, authenticated;
drop trigger if exists authenticity_findings_guard on public.authenticity_findings;
create trigger authenticity_findings_guard before update or delete on public.authenticity_findings for each row execute function private.authenticity_finding_guard();

create or replace function public.record_authenticity_finding(p_command uuid, p_registration uuid, p_severity text, p_item text, p_provision uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_old public.authenticity_findings; v_item text := private.clean_text(p_item, 120); v_version uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  select * into v_r from public.registrations where id = p_registration;
  if not found then raise exception 'registration not found' using errcode = 'P0002'; end if;
  if not private.can_inspect(v_r.event_id) then raise exception 'only the authenticity officer (inspector), the head marshal or an organizer of this event can record a finding' using errcode = '42501'; end if;
  select * into v_old from public.authenticity_findings where id = p_command;
  if found then
    if v_old.registration_id <> p_registration then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  if p_severity is null or p_severity not in ('minor', 'moderate', 'major') then raise exception 'an infraction is minor, moderate or major' using errcode = '22023'; end if;
  if char_length(coalesce(v_item, '')) < 2 then raise exception 'say which item (2 to 120 characters)' using errcode = '22023'; end if;
  v_version := private.check_cited_provision(p_provision, v_r.event_id);
  insert into public.authenticity_findings (id, event_id, registration_id, fighter_id, severity, item, provision_id, ruleset_version_id, note, recorded_by)
  values (p_command, v_r.event_id, p_registration, v_r.fighter_id, p_severity, v_item, p_provision, v_version, private.clean_text(p_note, 300), auth.uid());
  perform private.discipline_log(v_r.event_id, private.event_org(v_r.event_id), v_r.fighter_id, null, 'finding', p_command, 'recorded', jsonb_build_object('severity', p_severity, 'item', v_item, 'provision', p_provision));
  perform private.audit(v_r.event_id, 'discipline.finding', p_command::text, jsonb_build_object('registration', p_registration, 'severity', p_severity, 'item', v_item));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

create or replace function public.close_authenticity_finding(p_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.authenticity_findings;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.authenticity_findings where id = p_id for update;
  if not found then raise exception 'finding not found' using errcode = 'P0002'; end if;
  if not private.can_inspect(v.event_id) then raise exception 'only the authenticity officer (inspector), the head marshal or an organizer of this event can close a finding' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('corrected', 'voided') then raise exception 'a finding is corrected or voided' using errcode = '22023'; end if;
  if p_status = 'voided' and char_length(coalesce(private.clean_text(p_reason, 300), '')) < 3 then raise exception 'say why it is voided' using errcode = '22023'; end if;
  if v.status <> 'open' then return jsonb_build_object('status', 'duplicate'); end if;
  update public.authenticity_findings set status = p_status, closed_at = clock_timestamp(), closed_by = auth.uid() where id = p_id;
  perform private.discipline_log(v.event_id, private.event_org(v.event_id), v.fighter_id, null, 'finding', p_id, p_status, jsonb_build_object('reason', private.clean_text(p_reason, 300)));
  perform private.audit(v.event_id, 'discipline.finding_' || p_status, p_id::text);
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 7. suspensions
create table if not exists public.discipline_suspensions (
  id uuid primary key,                                     -- the command id
  fighter_id uuid references public.fighters (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  authority text not null check (authority in ('event', 'organization', 'platform')),
  event_id uuid references public.events (id) on delete cascade,              -- the issuing event (authority event)
  organization_id uuid references public.organizations (id) on delete cascade, -- the issuing organization (authority organization)
  scope text not null check (scope in ('remainder_of_event', 'competition', 'organization_events', 'all_events')),
  competition_id uuid references public.competitions (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,                                     -- null: no end date
  provision_id uuid references public.rule_provisions (id) on delete restrict,
  ruleset_version_id uuid references public.ruleset_versions (id) on delete restrict,
  supersedes_id uuid references public.discipline_suspensions (id) on delete restrict,
  superseded_by uuid references public.discipline_suspensions (id) on delete restrict,
  lifted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((fighter_id is null) <> (team_id is null)),
  check (ends_at is null or ends_at > starts_at),
  check (authority <> 'event' or (event_id is not null and scope in ('remainder_of_event', 'competition'))),
  check (authority <> 'organization' or (organization_id is not null and scope = 'organization_events')),
  check (authority <> 'platform' or scope = 'all_events'),
  check ((scope = 'competition') = (competition_id is not null))
);
create index if not exists discipline_suspensions_fighter_idx on public.discipline_suspensions (fighter_id) where fighter_id is not null;
create index if not exists discipline_suspensions_team_idx on public.discipline_suspensions (team_id) where team_id is not null;
create index if not exists discipline_suspensions_event_idx on public.discipline_suspensions (event_id) where event_id is not null;
create index if not exists discipline_suspensions_org_idx on public.discipline_suspensions (organization_id) where organization_id is not null;

create table if not exists public.discipline_suspensions_private (
  suspension_id uuid primary key references public.discipline_suspensions (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  issued_by uuid not null,
  lift_reason text check (lift_reason is null or char_length(lift_reason) <= 500),
  lifted_by uuid
);

-- Who issues / changes / lifts: the authority that owns it. An event suspension: that event's head marshal or organizer. An organization suspension:
-- that organization's admins. A platform suspension: the platform owner.
create or replace function private.can_manage_suspension(p_authority text, p_event uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_authority when 'event' then coalesce(private.can_resolve_results(p_event), false)
                          when 'organization' then coalesce(private.is_org_admin(p_org), false) or coalesce(private.is_owner(), false)
                          when 'platform' then coalesce(private.is_owner(), false) else false end
$$;
revoke execute on function private.can_manage_suspension(text, uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_manage_suspension(text, uuid, uuid) to authenticated;

alter table public.discipline_suspensions enable row level security;
alter table public.discipline_suspensions_private enable row level security;
-- The subject (their own fighter accounts; a team's captains), the owning authority and the platform owner read it. Other events' staff learn only that
-- a fighter is blocked from THEIR event (eligibility), never the reason or another organization's decisions.
create policy discipline_suspensions_read on public.discipline_suspensions for select to authenticated
  using (private.is_my_fighter(fighter_id) or (team_id is not null and private.is_team_captain(team_id)) or private.can_manage_suspension(authority, event_id, organization_id)
         or (authority = 'event' and private.can_see_discipline(event_id)));
grant select on public.discipline_suspensions to authenticated;
create policy discipline_suspensions_private_read on public.discipline_suspensions_private for select to authenticated
  using ((select private.can_manage_suspension(s.authority, s.event_id, s.organization_id) from public.discipline_suspensions s where s.id = suspension_id));
grant select on public.discipline_suspensions_private to authenticated;
revoke insert, update, delete on public.discipline_suspensions, public.discipline_suspensions_private from public, anon, authenticated;
comment on table public.discipline_suspensions is 'Pack 22: who may not take part, issued by an event, an organization or the platform, with a scope and a period. Never rewritten: a change supersedes the row, a lift ends it.';

create or replace function private.suspension_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a suspension is never deleted: lift it with a reason' using errcode = 'P0001'; end if;
  if (new.id, new.fighter_id, new.team_id, new.authority, new.event_id, new.organization_id, new.scope, new.competition_id, new.starts_at, new.ends_at, new.provision_id,
      new.ruleset_version_id, new.supersedes_id, new.created_at)
     is distinct from (old.id, old.fighter_id, old.team_id, old.authority, old.event_id, old.organization_id, old.scope, old.competition_id, old.starts_at, old.ends_at, old.provision_id,
      old.ruleset_version_id, old.supersedes_id, old.created_at)
     or old.superseded_by is not null or old.lifted_at is not null
     or (new.superseded_by is not null and new.lifted_at is not null) then
    raise exception 'a suspension is changed by a new decision that supersedes it, or lifted, once' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.suspension_guard() from public, anon, authenticated;
drop trigger if exists discipline_suspensions_guard on public.discipline_suspensions;
create trigger discipline_suspensions_guard before update or delete on public.discipline_suspensions for each row execute function private.suspension_guard();

-- The current state: a suspension in force (not lifted, not superseded) that covers the event's days and applies to it.
create or replace function private.suspension_applies(s public.discipline_suspensions, p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.lifted_at is null and s.superseded_by is null and exists (
    select 1 from public.events e where e.id = p_event
      and s.starts_at::date <= e.ends_on and (s.ends_at is null or s.ends_at::date >= e.starts_on)
      and case s.authority when 'platform' then true
                           when 'organization' then e.organization_id is not distinct from s.organization_id and s.organization_id is not null
                           when 'event' then s.event_id = p_event end)
$$;
revoke execute on function private.suspension_applies(public.discipline_suspensions, uuid) from public, anon, authenticated;

create or replace function private.suspension_label(s public.discipline_suspensions) returns text
language sql stable security definer set search_path = '' as $$
  select 'Suspended' || case s.scope when 'remainder_of_event' then ' for the rest of this event' when 'competition' then ' from ' || coalesce((select k.name from public.competitions k where k.id = s.competition_id), 'a competition')
                                     when 'organization_events' then ' from ' || coalesce((select o.name from public.organizations o where o.id = s.organization_id), 'this organization') || ' events'
                                     else ' from all events' end
    || case when s.ends_at is null then case when s.scope in ('remainder_of_event', 'competition') then '' else ' (no end date)' end
            else ' until ' || to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD') end
$$;
revoke execute on function private.suspension_label(public.discipline_suspensions) from public, anon, authenticated;

-- Eligibility: one reason that BLOCKS a fighter (or their team) from an event, or null. Used by readiness, acceptance, check-in and entries.
-- A competition-scoped suspension blocks only entries into that competition (see private.discipline_entry_block).
create or replace function private.discipline_block_reason(p_fighter uuid, p_event uuid, p_team uuid default null) returns text
language sql stable security definer set search_path = '' as $$
  select private.suspension_label(s) from public.discipline_suspensions s
  where ((p_fighter is not null and s.fighter_id = p_fighter) or (p_team is not null and s.team_id = p_team)) and s.scope <> 'competition' and private.suspension_applies(s, p_event)
  order by s.ends_at desc nulls first limit 1
$$;
create or replace function private.discipline_entry_block(p_fighter uuid, p_team uuid, p_competition uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(private.discipline_block_reason(p_fighter, k.event_id, p_team),
    (select private.suspension_label(s) from public.discipline_suspensions s
      where ((p_fighter is not null and s.fighter_id = p_fighter) or (p_team is not null and s.team_id = p_team)) and s.scope = 'competition' and s.competition_id = p_competition
        and private.suspension_applies(s, k.event_id) limit 1))
  from public.competitions k where k.id = p_competition
$$;
revoke execute on function private.discipline_block_reason(uuid, uuid, uuid), private.discipline_entry_block(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.issue_suspension(p_command uuid, p_authority text, p_scope text, p_reason text, p_fighter uuid default null, p_team uuid default null,
  p_event uuid default null, p_organization uuid default null, p_competition uuid default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_provision uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.discipline_suspensions; v_reason text := private.clean_text(p_reason, 500); v_version uuid; v_start timestamptz := coalesce(p_starts_at, clock_timestamp());
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  select * into v_old from public.discipline_suspensions where id = p_command;
  if found then
    if v_old.fighter_id is distinct from p_fighter or v_old.team_id is distinct from p_team then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  if p_authority is null or p_authority not in ('event', 'organization', 'platform') then raise exception 'a suspension is issued by an event, an organization or the platform' using errcode = '22023'; end if;
  if p_authority <> 'event' and (p_event is not null or p_competition is not null) then raise exception 'only an event suspension names an event' using errcode = '22023'; end if;
  if p_authority <> 'organization' and p_organization is not null then raise exception 'only an organization suspension names an organization' using errcode = '22023'; end if;
  if p_authority = 'event' and p_event is null then raise exception 'name the event' using errcode = '22023'; end if;
  if p_authority = 'organization' and p_organization is null then raise exception 'name the organization' using errcode = '22023'; end if;
  if not private.can_manage_suspension(p_authority, p_event, p_organization) then
    raise exception 'only the issuing authority can suspend: the event''s head marshal or organizer, the organization''s admins, or the platform owner' using errcode = '42501'; end if;
  if (p_fighter is null) = (p_team is null) then raise exception 'name either a fighter or a team' using errcode = '22023'; end if;
  if p_competition is not null and not exists (select 1 from public.competitions where id = p_competition and event_id = p_event) then raise exception 'that competition is not at this event' using errcode = '22023'; end if;
  if char_length(coalesce(v_reason, '')) < 3 then raise exception 'give the reason (3 to 500 characters)' using errcode = '22023'; end if;
  if p_ends_at is not null and p_ends_at <= v_start then raise exception 'the end must come after the start' using errcode = '22023'; end if;
  if p_authority = 'event' and p_ends_at is not null then raise exception 'an event suspension lasts for the rest of the event (or the competition): use an organization or platform suspension for a period' using errcode = '22023'; end if;
  v_version := private.check_cited_provision(p_provision, p_event);
  insert into public.discipline_suspensions (id, fighter_id, team_id, authority, event_id, organization_id, scope, competition_id, starts_at, ends_at, provision_id, ruleset_version_id)
  values (p_command, p_fighter, p_team, p_authority, p_event, p_organization, p_scope, p_competition, v_start, p_ends_at, p_provision, v_version);
  insert into public.discipline_suspensions_private (suspension_id, reason, issued_by) values (p_command, v_reason, auth.uid());
  perform private.discipline_log(p_event, coalesce(p_organization, private.event_org(p_event)), p_fighter, p_team, 'suspension', p_command, 'issued',
    jsonb_build_object('authority', p_authority, 'scope', p_scope, 'starts_at', v_start, 'ends_at', p_ends_at, 'provision', p_provision));
  perform private.audit(p_event, 'discipline.suspension_issued', p_command::text, jsonb_build_object('authority', p_authority, 'scope', p_scope, 'fighter', p_fighter, 'team', p_team, 'ends_at', p_ends_at));
  perform private.suspension_notify(p_command, 'issued');
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

-- A change (new end date, e.g. after a Judiciary Committee decision to reduce or increase it) is a NEW row that supersedes the old one.
create or replace function public.change_suspension(p_command uuid, p_id uuid, p_ends_at timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.discipline_suspensions; v_reason text := private.clean_text(p_reason, 500);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if exists (select 1 from public.discipline_suspensions where id = p_command) then
    if exists (select 1 from public.discipline_suspensions where id = p_command and supersedes_id = p_id) then return jsonb_build_object('status', 'duplicate', 'id', p_command); end if;
    raise exception 'that command id belongs to something else' using errcode = '42501';
  end if;
  select * into v from public.discipline_suspensions where id = p_id for update;
  if not found then raise exception 'suspension not found' using errcode = 'P0002'; end if;
  if not private.can_manage_suspension(v.authority, v.event_id, v.organization_id) then raise exception 'only the authority that issued it can change it' using errcode = '42501'; end if;
  if v.lifted_at is not null or v.superseded_by is not null then raise exception 'this suspension is no longer in force' using errcode = 'P0001'; end if;
  if v.authority = 'event' then raise exception 'an event suspension lasts for the rest of the event: lift it instead' using errcode = '22023'; end if;
  if char_length(coalesce(v_reason, '')) < 3 then raise exception 'give the reason (3 to 500 characters)' using errcode = '22023'; end if;
  if p_ends_at is not null and p_ends_at <= v.starts_at then raise exception 'the end must come after the start' using errcode = '22023'; end if;
  if p_ends_at is not distinct from v.ends_at then return jsonb_build_object('status', 'unchanged'); end if;
  insert into public.discipline_suspensions (id, fighter_id, team_id, authority, event_id, organization_id, scope, competition_id, starts_at, ends_at, provision_id, ruleset_version_id, supersedes_id)
  values (p_command, v.fighter_id, v.team_id, v.authority, v.event_id, v.organization_id, v.scope, v.competition_id, v.starts_at, p_ends_at, v.provision_id, v.ruleset_version_id, v.id);
  insert into public.discipline_suspensions_private (suspension_id, reason, issued_by) values (p_command, v_reason, auth.uid());
  update public.discipline_suspensions set superseded_by = p_command where id = p_id;
  perform private.discipline_log(v.event_id, coalesce(v.organization_id, private.event_org(v.event_id)), v.fighter_id, v.team_id, 'suspension', p_command, 'changed',
    jsonb_build_object('supersedes', p_id, 'ends_at_before', v.ends_at, 'ends_at', p_ends_at, 'reason', v_reason));
  perform private.audit(v.event_id, 'discipline.suspension_changed', p_command::text, jsonb_build_object('supersedes', p_id, 'ends_at', p_ends_at));
  perform private.suspension_notify(p_command, 'changed');
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

create or replace function public.lift_suspension(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.discipline_suspensions; v_reason text := private.clean_text(p_reason, 500);
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.discipline_suspensions where id = p_id for update;
  if not found then raise exception 'suspension not found' using errcode = 'P0002'; end if;
  if not private.can_manage_suspension(v.authority, v.event_id, v.organization_id) then raise exception 'only the authority that issued it can lift it' using errcode = '42501'; end if;
  if v.superseded_by is not null then raise exception 'this suspension was replaced by a later decision: lift that one' using errcode = 'P0001'; end if;
  if v.lifted_at is not null then return jsonb_build_object('status', 'duplicate'); end if;
  if char_length(coalesce(v_reason, '')) < 3 then raise exception 'give the reason (3 to 500 characters)' using errcode = '22023'; end if;
  update public.discipline_suspensions set lifted_at = clock_timestamp() where id = p_id;
  update public.discipline_suspensions_private set lift_reason = v_reason, lifted_by = auth.uid() where suspension_id = p_id;
  perform private.discipline_log(v.event_id, coalesce(v.organization_id, private.event_org(v.event_id)), v.fighter_id, v.team_id, 'suspension', p_id, 'lifted', jsonb_build_object('reason', v_reason));
  perform private.audit(v.event_id, 'discipline.suspension_lifted', p_id::text, jsonb_build_object('reason', v_reason));
  perform private.suspension_notify(p_id, 'lifted');
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 8. appeals and reviews
-- The windows the official documents set, per governing body (data with its source, not code):
create table if not exists public.discipline_review_rules (
  governing_body text not null,
  kind text not null check (kind in ('event_appeal', 'judiciary_red_card', 'judiciary_application')),
  window_interval interval not null,
  outcomes text[] not null,
  sources text[] not null default '{}',
  note text check (note is null or char_length(note) <= 300),
  primary key (governing_body, kind)
);
alter table public.discipline_review_rules enable row level security;
create policy discipline_review_rules_read on public.discipline_review_rules for select to anon, authenticated using (true);
grant select on public.discipline_review_rules to anon, authenticated;
revoke insert, update, delete on public.discipline_review_rules from public, anon, authenticated;
insert into public.discipline_review_rules (governing_body, kind, window_interval, outcomes, sources, note) values
  ('Buhurt International', 'event_appeal', interval '15 minutes', array['rematch_round', 'restart', 'cards_imposed', 'cards_withdrawn', 'kept'],
   array['buhurt-regulations:7.2', 'buhurt-regulations:7.4', 'duel-regulations:5.2', 'duel-regulations:5.4', 'outrance-rules:16.3', 'outrance-rules:16.4'],
   'To the Secretary, in person, within 15 minutes after the end of the match and before the next phase starts. Decided by the Knight Marshal.'),
  ('Buhurt International', 'judiciary_red_card', interval '14 days', array['kept', 'revoked', 'increased', 'reduced'],
   array['judiciary-committee:3.4', 'judiciary-committee:3.1.1', 'judiciary-committee:4.4'], 'Processed no more than 14 calendar days from the date the competition is reported.'),
  ('Buhurt International', 'judiciary_application', interval '30 days', array['kept', 'revoked', 'increased', 'reduced'],
   array['judiciary-committee:3.2', 'judiciary-committee:3.4', 'judiciary-committee:4.4'], 'Processed no more than 30 calendar days from the date of the application.')
on conflict (governing_body, kind) do nothing;

create table if not exists public.discipline_reviews (
  id uuid primary key,
  event_id uuid references public.events (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,   -- the event's organization, or the organization whose suspension is reviewed
  governing_body text not null,
  kind text not null check (kind in ('event_appeal', 'judiciary_red_card', 'judiciary_application')),
  match_discipline_id uuid references public.match_discipline (id) on delete restrict,
  event_sanction_id uuid references public.event_sanctions (id) on delete restrict,
  suspension_id uuid references public.discipline_suspensions (id) on delete restrict,
  match_id uuid references public.matches (id) on delete restrict,             -- an appeal about a fight with no record (e.g. "unregistered violation")
  fighter_id uuid references public.fighters (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  lodged_by_name text not null check (char_length(lodged_by_name) between 2 and 80),  -- "the captain of Team X", as stated to the Secretary
  grounds text not null check (char_length(grounds) between 3 and 500),
  lodged_at timestamptz not null default clock_timestamp(),
  due_by timestamptz not null,                                                 -- from discipline_review_rules
  status text not null default 'lodged' check (status in ('lodged', 'decided', 'withdrawn')),
  outcome text,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_at timestamptz,
  decided_by uuid,
  recorded_by uuid not null,
  check (num_nonnulls(match_discipline_id, event_sanction_id, suspension_id, match_id) >= 1),
  check ((status = 'decided') = (outcome is not null and decided_at is not null)),
  check (kind <> 'event_appeal' or event_id is not null)
);
create index if not exists discipline_reviews_event_idx on public.discipline_reviews (event_id, lodged_at) where event_id is not null;
create index if not exists discipline_reviews_fighter_idx on public.discipline_reviews (fighter_id) where fighter_id is not null;
alter table public.discipline_reviews enable row level security;
create policy discipline_reviews_read on public.discipline_reviews for select to authenticated
  using ((event_id is not null and private.can_see_discipline(event_id)) or private.is_my_fighter(fighter_id) or (team_id is not null and private.is_team_captain(team_id))
         or private.is_owner() or private.is_org_admin(organization_id));
revoke select on public.discipline_reviews from public, anon, authenticated;
grant select (id, event_id, organization_id, governing_body, kind, match_discipline_id, event_sanction_id, suspension_id, match_id, fighter_id, team_id, lodged_by_name, grounds, lodged_at,
              due_by, status, outcome, decision_note, decided_at) on public.discipline_reviews to authenticated;
revoke insert, update, delete on public.discipline_reviews from public, anon, authenticated;
comment on table public.discipline_reviews is 'Pack 22: event appeals and Judiciary Committee reviews with the deadline and outcomes the official documents set. Decided once; never deleted.';

create or replace function private.review_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'an appeal or review is never deleted' using errcode = 'P0001'; end if;
  if (new.id, new.event_id, new.governing_body, new.kind, new.match_discipline_id, new.event_sanction_id, new.suspension_id, new.match_id, new.fighter_id, new.team_id,
      new.lodged_by_name, new.grounds, new.lodged_at, new.due_by, new.recorded_by)
     is distinct from (old.id, old.event_id, old.governing_body, old.kind, old.match_discipline_id, old.event_sanction_id, old.suspension_id, old.match_id, old.fighter_id, old.team_id,
      old.lodged_by_name, old.grounds, old.lodged_at, old.due_by, old.recorded_by)
     or old.status <> 'lodged' then
    raise exception 'an appeal or review is decided or withdrawn once' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.review_guard() from public, anon, authenticated;
drop trigger if exists discipline_reviews_guard on public.discipline_reviews;
create trigger discipline_reviews_guard before update or delete on public.discipline_reviews for each row execute function private.review_guard();

-- Who records / decides: an event appeal is lodged with the Secretary (scorekeeper) or any official of the event and decided by the Knight Marshal
-- (head marshal) or an organizer. A Judiciary Committee decision is recorded by the platform owner or an admin of the event's organization: BuhurtOS
-- records the committee's decision; it does not make one.
create or replace function private.can_decide_review(p_kind text, p_event uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_kind = 'event_appeal' then coalesce(private.can_resolve_results(p_event), false)
              else coalesce(private.is_owner(), false) or (p_org is not null and coalesce(private.is_org_admin(p_org), false)) end
$$;
revoke execute on function private.can_decide_review(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.lodge_review(p_command uuid, p_kind text, p_lodged_by text, p_grounds text, p_match_discipline uuid default null, p_event_sanction uuid default null,
  p_suspension uuid default null, p_match uuid default null, p_governing_body text default 'Buhurt International', p_from timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.discipline_reviews; v_rule public.discipline_review_rules; v_event uuid; v_org uuid; v_fighter uuid; v_team uuid; v_entry uuid; v_from timestamptz; v_due timestamptz;
  v_md public.match_discipline; v_es public.event_sanctions; v_su public.discipline_suspensions; v_state text; v_final timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  select * into v_old from public.discipline_reviews where id = p_command;
  if found then return jsonb_build_object('status', 'duplicate', 'id', p_command); end if;
  select * into v_rule from public.discipline_review_rules where governing_body = btrim(coalesce(p_governing_body, '')) and kind = p_kind;
  if not found then raise exception 'no % review is defined for %', p_kind, p_governing_body using errcode = '22023'; end if;
  if num_nonnulls(p_match_discipline, p_event_sanction, p_suspension, p_match) <> 1 then raise exception 'name the one record (or fight) this is about' using errcode = '22023'; end if;
  if p_match_discipline is not null then
    select * into v_md from public.match_discipline where id = p_match_discipline;
    if not found then raise exception 'record not found' using errcode = 'P0002'; end if;
    v_event := v_md.event_id;
    select case v_md.side when 'a' then m.entry_a else m.entry_b end, m.queue_state, m.finalized_at into v_entry, v_state, v_final from public.matches m where m.id = v_md.match_id;
  elsif p_match is not null then
    v_event := private.event_of_match(p_match);
    select m.queue_state, m.finalized_at into v_state, v_final from public.matches m where m.id = p_match;
  elsif p_event_sanction is not null then
    select * into v_es from public.event_sanctions where id = p_event_sanction;
    if not found then raise exception 'sanction not found' using errcode = 'P0002'; end if;
    v_event := v_es.event_id; v_fighter := v_es.fighter_id; v_team := v_es.team_id;
  else
    select * into v_su from public.discipline_suspensions where id = p_suspension;
    if not found then raise exception 'suspension not found' using errcode = 'P0002'; end if;
    v_event := v_su.event_id; v_fighter := v_su.fighter_id; v_team := v_su.team_id;
    if p_kind = 'event_appeal' then raise exception 'a suspension is reviewed by the Judiciary Committee, not appealed at the event' using errcode = '22023'; end if;
  end if;
  if v_entry is not null then select en.fighter_id, en.team_id into v_fighter, v_team from public.entries en where en.id = v_entry; end if;
  v_org := coalesce(v_su.organization_id, private.event_org(v_event));
  if p_kind = 'event_appeal' then
    if v_event is null then raise exception 'an event appeal is about something at an event' using errcode = '22023'; end if;
    if not private.can_score(v_event) then raise exception 'appeals are lodged with the Secretary or an official of this event' using errcode = '42501'; end if;
  elsif not private.can_decide_review(p_kind, v_event, v_org) then
    raise exception 'a Judiciary Committee review is recorded by the platform owner or an admin of the event''s organization' using errcode = '42501';
  end if;
  -- The window starts at: the end of the fight (event appeal), the reporting of the competition / the application (judiciary; given by the recorder).
  v_from := coalesce(p_from, case when p_kind = 'event_appeal' then coalesce(v_final, clock_timestamp()) else clock_timestamp() end);
  v_due := v_from + v_rule.window_interval;
  insert into public.discipline_reviews (id, event_id, organization_id, governing_body, kind, match_discipline_id, event_sanction_id, suspension_id, match_id, fighter_id, team_id, lodged_by_name, grounds, due_by, recorded_by)
  values (p_command, v_event, v_org, v_rule.governing_body, p_kind, p_match_discipline, p_event_sanction, p_suspension, coalesce(p_match, v_md.match_id), v_fighter, v_team,
          coalesce(private.clean_text(p_lodged_by, 80), 'unknown'), coalesce(private.clean_text(p_grounds, 500), ''), v_due, auth.uid());
  perform private.discipline_log(v_event, v_org, v_fighter, v_team, 'review', p_command, 'lodged',
    jsonb_build_object('kind', p_kind, 'due_by', v_due, 'late', p_kind = 'event_appeal' and clock_timestamp() > v_due));
  perform private.audit(v_event, 'discipline.review_lodged', p_command::text, jsonb_build_object('kind', p_kind, 'due_by', v_due));
  return jsonb_build_object('status', 'ok', 'id', p_command, 'due_by', v_due, 'late', p_kind = 'event_appeal' and clock_timestamp() > v_due);
end $$;

-- Deciding records the outcome. With p_apply the matching record is changed through its own controlled path, never silently:
--   revoked / cards_withdrawn + a fight record  -> the record is voided (Pack 13 void), refused if the fight result is final (reopen it first);
--   revoked + an event sanction                  -> the sanction is withdrawn;
--   revoked + a suspension                       -> the suspension is lifted.
-- Increased / reduced suspensions are recorded with change_suspension (a new end date, which supersedes the old row).
create or replace function public.decide_review(p_id uuid, p_outcome text, p_note text default null, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.discipline_reviews; v_rule public.discipline_review_rules; v_note text := private.clean_text(p_note, 500); v_state text; v_applied text;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.discipline_reviews where id = p_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if not private.can_decide_review(v.kind, v.event_id, v.organization_id) then raise exception 'only the Knight Marshal (head marshal) or an organizer decides an event appeal; the platform owner or the organization''s admins record a Judiciary Committee decision' using errcode = '42501'; end if;
  if v.status <> 'lodged' then return jsonb_build_object('status', 'duplicate'); end if;
  select * into v_rule from public.discipline_review_rules where governing_body = v.governing_body and kind = v.kind;
  if p_outcome is null or not (p_outcome = any (v_rule.outcomes)) then raise exception 'the outcome must be one of: %', array_to_string(v_rule.outcomes, ', ') using errcode = '22023'; end if;
  update public.discipline_reviews set status = 'decided', outcome = p_outcome, decision_note = v_note, decided_at = clock_timestamp(), decided_by = auth.uid() where id = p_id;
  if p_apply and p_outcome in ('revoked', 'cards_withdrawn') then
    if v.match_discipline_id is not null then
      select m.queue_state into v_state from public.match_discipline d join public.matches m on m.id = d.match_id where d.id = v.match_discipline_id;
      if v_state = 'final' then raise exception 'the fight result is final: reopen it (with its reason) before withdrawing this record' using errcode = 'P0001'; end if;
      perform public.lyst_void_discipline(gen_random_uuid(), v.match_discipline_id, 'appeal upheld (' || left(p_id::text, 8) || ')');
      v_applied := 'record voided';
    elsif v.event_sanction_id is not null then
      perform public.end_event_sanction(v.event_sanction_id, 'withdrawn', 'review upheld (' || left(p_id::text, 8) || ')');
      v_applied := 'sanction withdrawn';
    elsif v.suspension_id is not null then
      perform public.lift_suspension(v.suspension_id, 'review upheld (' || left(p_id::text, 8) || ')');
      v_applied := 'suspension lifted';
    end if;
  end if;
  perform private.discipline_log(v.event_id, v.organization_id, v.fighter_id, v.team_id, 'review', p_id, 'decided', jsonb_build_object('outcome', p_outcome, 'applied', v_applied));
  perform private.audit(v.event_id, 'discipline.review_decided', p_id::text, jsonb_build_object('outcome', p_outcome, 'applied', v_applied));
  perform private.review_decided_notify(p_id);
  return jsonb_build_object('status', 'ok', 'applied', v_applied);
end $$;

create or replace function public.withdraw_review(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.discipline_reviews;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v from public.discipline_reviews where id = p_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if not (private.can_decide_review(v.kind, v.event_id, v.organization_id) or (v.kind = 'event_appeal' and private.can_score(v.event_id))) then raise exception 'you cannot change this appeal' using errcode = '42501'; end if;
  if v.status <> 'lodged' then return jsonb_build_object('status', 'duplicate'); end if;
  update public.discipline_reviews set status = 'withdrawn' where id = p_id;
  perform private.discipline_log(v.event_id, v.organization_id, v.fighter_id, v.team_id, 'review', p_id, 'withdrawn', jsonb_build_object('reason', private.clean_text(p_reason, 300)));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 9. eligibility at registration, check-in, entry and readiness
-- BLOCK: an accepted registration, a check-in or an entry for a fighter (or team) under a suspension that applies to the event. Lift the suspension
-- to clear it; a readiness override does not.
create or replace function private.registration_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_why text;
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') and not new.is_volunteer then
    v_why := private.discipline_block_reason(new.fighter_id, new.event_id, new.team_id);
    if v_why is not null and new.fighter_id is not null then raise exception 'cannot accept: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke execute on function private.registration_discipline_check() from public, anon, authenticated;
drop trigger if exists registrations_discipline_check on public.registrations;
create trigger registrations_discipline_check before insert or update of status on public.registrations for each row execute function private.registration_discipline_check();

create or replace function private.checkin_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_r public.registrations; v_why text;
begin
  if new.check_name = 'checked_in' and new.passed then
    select * into v_r from public.registrations where id = new.registration_id;
    if found and not v_r.is_volunteer then
      v_why := private.discipline_block_reason(v_r.fighter_id, v_r.event_id, null);
      if v_why is not null then raise exception 'cannot check in: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.checkin_discipline_check() from public, anon, authenticated;
drop trigger if exists registration_checks_discipline_check on public.registration_checks;
create trigger registration_checks_discipline_check before insert or update on public.registration_checks for each row execute function private.checkin_discipline_check();

create or replace function private.entry_discipline_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_why text;
begin
  if tg_table_name = 'entries' then
    if tg_op = 'UPDATE' and new.fighter_id is not distinct from old.fighter_id and new.team_id is not distinct from old.team_id and new.competition_id = old.competition_id then return new; end if;
    v_why := private.discipline_entry_block(new.fighter_id, new.team_id, new.competition_id);
  else
    if tg_op = 'UPDATE' and new.fighter_id = old.fighter_id and new.competition_id = old.competition_id then return new; end if;
    v_why := private.discipline_entry_block(new.fighter_id, null, new.competition_id);
  end if;
  if v_why is not null then raise exception 'cannot enter: % (lift the suspension first)', v_why using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.entry_discipline_check() from public, anon, authenticated;
drop trigger if exists entries_discipline_check on public.entries;
create trigger entries_discipline_check before insert or update on public.entries for each row execute function private.entry_discipline_check();
drop trigger if exists entry_fighters_discipline_check on public.entry_fighters;
create trigger entry_fighters_discipline_check before insert or update on public.entry_fighters for each row execute function private.entry_discipline_check();

-- Readiness (Pack 16, the one readiness rule): a block is a reason no override clears. Extended in place; each anchor is asserted.
do $do$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('private.readiness_rows(uuid,boolean)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$      case when y.status = 'accepted' and not y.f_ok then 'Fee not paid' end
    ], null) as why$a$, $a$      case when y.status = 'accepted' and not y.f_ok then 'Fee not paid' end,
      case when y.status = 'accepted' and not y.is_volunteer then private.discipline_block_reason(y.fighter_id, y.event_id, y.team_id) end
    ], null) as why,
    case when y.status = 'accepted' and not y.is_volunteer then private.discipline_block_reason(y.fighter_id, y.event_id, y.team_id) end as blocked_why$a$);
  if v_new = v_def then raise exception 'pack22: readiness_rows reasons anchor not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$z.status = 'accepted' and (cardinality(z.why) = 0 or z.o_reason is not null),$a$,
                          $a$z.status = 'accepted' and (cardinality(z.why) = 0 or (z.o_reason is not null and z.blocked_why is null)),$a$);
  if v_new = v_def then raise exception 'pack22: readiness_rows ready anchor not found'; end if;
  execute v_new;
end $do$;
revoke execute on function private.readiness_rows(uuid, boolean) from public, anon, authenticated;

-- WARNINGS and BLOCKS for one fighter at one event, for the people who must act (desk, officials, the fighter's own accounts, their captain).
-- No private reasons, no account ids. kind: block | warning.
create or replace function public.discipline_eligibility(p_event uuid, p_fighter uuid default null, p_team uuid default null)
returns table (kind text, code text, message text, source_key text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_event is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not (private.can_see_discipline(p_event) or private.is_organizer(p_event) or private.is_my_fighter(p_fighter) or (p_team is not null and private.is_team_captain(p_team))) then
    raise exception 'only this event''s staff, the fighter or their captain can see this' using errcode = '42501'; end if;
  return query
  select 'block'::text, 'suspended'::text, private.suspension_label(s), (select rp.stable_key from public.rule_provisions rp where rp.id = s.provision_id)
    from public.discipline_suspensions s
   where ((p_fighter is not null and s.fighter_id = p_fighter) or (p_team is not null and s.team_id = p_team)) and private.suspension_applies(s, p_event)
  union all
  select 'warning', 'green_card', 'Green card at this event' || coalesce(' (' || (select k.name from public.competitions k where k.id = es.competition_id) || ')', ''),
         'buhurt-regulations:6.4'
    from public.event_sanctions es where es.event_id = p_event and p_fighter is not null and es.fighter_id = p_fighter and es.card_key = 'green_card' and es.status = 'active'
  union all
  select 'warning', 'card', x.n || ' ' || x.label || case when x.n = 1 then '' else 's' end || ' in ' || x.comp, null
    from (select d.label, k.name as comp, count(*) as n from public.match_discipline d join public.matches m on m.id = d.match_id join public.competitions k on k.id = m.competition_id
            join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
           where d.event_id = p_event and d.kind = 'card' and d.voided_at is null and ((p_fighter is not null and en.fighter_id = p_fighter) or (p_team is not null and en.team_id = p_team))
           group by d.label, k.name) x
  union all
  select 'warning', 'disqualified', 'Disqualified in ' || k.name, null
    from public.match_discipline d join public.matches m on m.id = d.match_id join public.competitions k on k.id = m.competition_id
    join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
   where d.event_id = p_event and d.kind = 'dq' and d.voided_at is null and ((p_fighter is not null and en.fighter_id = p_fighter) or (p_team is not null and en.team_id = p_team))
  union all
  select 'warning', 'authenticity', count(*) || ' open authenticity finding' || case when count(*) = 1 then '' else 's' end || ' (' || string_agg(distinct f.severity, ', ') || ')', 'infractions:2'
    from public.authenticity_findings f where f.event_id = p_event and p_fighter is not null and f.fighter_id = p_fighter and f.status = 'open' having count(*) > 0
  union all
  select 'warning', 'review', 'Appeal or review open: ' || replace(r.kind, '_', ' '), null
    from public.discipline_reviews r where r.event_id = p_event and r.status = 'lodged' and ((p_fighter is not null and r.fighter_id = p_fighter) or (p_team is not null and r.team_id = p_team));
end $$;

-- ---------------------------------------------------------------- 10. reading: the event's discipline desk, a person's own record, a suspension's history
create or replace function public.event_discipline_overview(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_see_discipline(p_event) then raise exception 'only this event''s officials can read its discipline desk' using errcode = '42501'; end if;
  return jsonb_build_object(
    'sanctions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'card_key', s.card_key, 'label', s.label, 'status', s.status, 'created_at', s.created_at, 'ended_at', s.ended_at,
        'fighter_id', s.fighter_id, 'team_id', s.team_id, 'against', coalesce(f.display_name, t.name), 'competition', k.name, 'reason', sp.reason, 'end_reason', sp.end_reason,
        'issued_by_name', private.person_name(sp.issued_by), 'rule', case when rp.id is not null then jsonb_build_object('id', rp.id, 'number', rp.number, 'title', rp.title, 'document', rs.name, 'version', rv.version) end)
        order by s.created_at desc)
      from public.event_sanctions s join public.event_sanctions_private sp on sp.sanction_id = s.id left join public.fighters f on f.id = s.fighter_id left join public.teams t on t.id = s.team_id
      left join public.competitions k on k.id = s.competition_id left join public.rule_provisions rp on rp.id = s.provision_id left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id
      left join public.rulesets rs on rs.id = rv.ruleset_id where s.event_id = p_event), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'registration_id', a.registration_id, 'fighter_id', a.fighter_id, 'name', g.full_name, 'severity', a.severity, 'item', a.item,
        'status', a.status, 'created_at', a.created_at, 'note', case when private.can_see_readiness_detail(p_event) or private.can_resolve_results(p_event) then a.note end,
        'rule', case when rp.id is not null then jsonb_build_object('id', rp.id, 'number', rp.number, 'title', rp.title, 'document', rs.name, 'version', rv.version) end) order by a.created_at desc)
      from public.authenticity_findings a join public.registrations g on g.id = a.registration_id left join public.rule_provisions rp on rp.id = a.provision_id
      left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id left join public.rulesets rs on rs.id = rv.ruleset_id where a.event_id = p_event), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'outcome', r.outcome, 'lodged_by_name', r.lodged_by_name, 'grounds', r.grounds,
        'lodged_at', r.lodged_at, 'due_by', r.due_by, 'late', r.lodged_at > r.due_by, 'decision_note', r.decision_note, 'decided_at', r.decided_at,
        'match_discipline_id', r.match_discipline_id, 'event_sanction_id', r.event_sanction_id, 'match_id', r.match_id, 'against', coalesce(f.display_name, t.name)) order by r.lodged_at desc)
      from public.discipline_reviews r left join public.fighters f on f.id = r.fighter_id left join public.teams t on t.id = r.team_id where r.event_id = p_event), '[]'::jsonb),
    -- suspensions that apply to this event's participants: the label only (an organization's or the platform's reasons stay with them)
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('registration_id', g.id, 'fighter_id', g.fighter_id, 'name', g.full_name, 'message', private.discipline_block_reason(g.fighter_id, p_event, g.team_id)) order by g.full_name)
      from public.registrations g where g.event_id = p_event and g.status in ('accepted', 'pending') and not g.is_volunteer and private.discipline_block_reason(g.fighter_id, p_event, g.team_id) is not null), '[]'::jsonb),
    'event_suspensions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scope', s.scope, 'competition', k.name, 'fighter_id', s.fighter_id, 'team_id', s.team_id, 'against', coalesce(f.display_name, t.name),
        'starts_at', s.starts_at, 'lifted_at', s.lifted_at, 'label', private.suspension_label(s), 'reason', sp.reason, 'lift_reason', sp.lift_reason) order by s.created_at desc)
      from public.discipline_suspensions s join public.discipline_suspensions_private sp on sp.suspension_id = s.id left join public.fighters f on f.id = s.fighter_id
      left join public.teams t on t.id = s.team_id left join public.competitions k on k.id = s.competition_id where s.authority = 'event' and s.event_id = p_event), '[]'::jsonb),
    -- card tallies per competition, by card concept: facts for the Knight Marshal, with no consequence computed
    'tallies', coalesce((select jsonb_agg(x order by x ->> 'competition', x ->> 'against') from (
      select jsonb_build_object('competition', k.name, 'against', coalesce(f.display_name, t.name), 'fighter_id', en.fighter_id, 'team_id', en.team_id,
             'cards', jsonb_object_agg(coalesce(d.card_key, d.label), d.n)) as x
      from (select m.competition_id, case dd.side when 'a' then m.entry_a else m.entry_b end as entry_id, dd.card_key, dd.label, count(*) as n
              from public.match_discipline dd join public.matches m on m.id = dd.match_id where dd.event_id = p_event and dd.kind = 'card' and dd.voided_at is null group by 1, 2, 3, 4) d
      join public.competitions k on k.id = d.competition_id join public.entries en on en.id = d.entry_id left join public.fighters f on f.id = en.fighter_id left join public.teams t on t.id = en.team_id
      group by k.name, f.display_name, t.name, en.fighter_id, en.team_id) y), '[]'::jsonb),
    'can', jsonb_build_object('sanction', private.can_resolve_results(p_event), 'green_card', private.can_inspect(p_event), 'finding', private.can_inspect(p_event),
      'suspend', private.can_resolve_results(p_event), 'lodge_appeal', private.can_score(p_event), 'decide_appeal', private.can_resolve_results(p_event)));
end $$;

-- A fighter's own record, for their linked accounts (and people who manage the fighter): suspensions, sanctions, findings and reviews. No staff notes.
create or replace function public.fighter_discipline(p_fighter uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (private.is_my_fighter(p_fighter) or private.can_manage_fighter(p_fighter) or private.is_owner()) then
    raise exception 'only the fighter (or someone who manages them) can read this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'suspensions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'authority', s.authority, 'scope', s.scope, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'lifted_at', s.lifted_at,
        'superseded', s.superseded_by is not null, 'label', private.suspension_label(s), 'event', e.name, 'organization', o.name,
        'in_force', s.lifted_at is null and s.superseded_by is null and (s.ends_at is null or s.ends_at > now()),
        'rule', case when rp.id is not null then jsonb_build_object('id', rp.id, 'number', rp.number, 'title', rp.title, 'version', rv.version) end) order by s.created_at desc)
      from public.discipline_suspensions s left join public.events e on e.id = s.event_id left join public.organizations o on o.id = s.organization_id
      left join public.rule_provisions rp on rp.id = s.provision_id left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id where s.fighter_id = p_fighter), '[]'::jsonb),
    'sanctions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'card_key', s.card_key, 'label', s.label, 'status', s.status, 'event', e.name, 'created_at', s.created_at) order by s.created_at desc)
      from public.event_sanctions s join public.events e on e.id = s.event_id where s.fighter_id = p_fighter), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'severity', a.severity, 'item', a.item, 'status', a.status, 'event', e.name, 'created_at', a.created_at) order by a.created_at desc)
      from public.authenticity_findings a join public.events e on e.id = a.event_id where a.fighter_id = p_fighter), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'outcome', r.outcome, 'lodged_at', r.lodged_at, 'due_by', r.due_by, 'decided_at', r.decided_at) order by r.lodged_at desc)
      from public.discipline_reviews r where r.fighter_id = p_fighter), '[]'::jsonb));
end $$;

-- The history of one disciplinary record (every action, oldest first) for whoever may read the record.
create or replace function public.discipline_record_history(p_entity text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean := false; v_ids uuid[] := array[p_id]; v_next uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_entity = 'suspension' then
    select exists (select 1 from public.discipline_suspensions s where s.id = p_id) into v_ok;
    v_ok := v_ok and exists (select 1 from public.discipline_suspensions s where s.id = p_id and (private.is_my_fighter(s.fighter_id) or (s.team_id is not null and private.is_team_captain(s.team_id))
              or private.can_manage_suspension(s.authority, s.event_id, s.organization_id) or (s.authority = 'event' and private.can_see_discipline(s.event_id))));
    -- the whole chain: earlier and later decisions about the same suspension
    loop select supersedes_id into v_next from public.discipline_suspensions where id = v_ids[1]; exit when v_next is null; v_ids := v_next || v_ids; end loop;
    loop select superseded_by into v_next from public.discipline_suspensions where id = v_ids[cardinality(v_ids)]; exit when v_next is null; v_ids := v_ids || v_next; end loop;
  elsif p_entity = 'event_sanction' then
    select exists (select 1 from public.event_sanctions s where s.id = p_id and (private.can_see_discipline(s.event_id) or private.is_my_fighter(s.fighter_id) or (s.team_id is not null and private.is_team_captain(s.team_id)))) into v_ok;
  elsif p_entity = 'review' then
    select exists (select 1 from public.discipline_reviews r where r.id = p_id and ((r.event_id is not null and private.can_see_discipline(r.event_id)) or private.is_my_fighter(r.fighter_id) or private.is_owner()
                   or private.is_org_admin(r.organization_id))) into v_ok;
  elsif p_entity = 'finding' then
    select exists (select 1 from public.authenticity_findings a where a.id = p_id and (private.can_see_readiness_detail(a.event_id) or private.can_resolve_results(a.event_id))) into v_ok;
  end if;
  if not v_ok then raise exception 'not found or not yours to read' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('entity_id', h.entity_id, 'action', h.action, 'at', h.at, 'details', h.details,
      'by', case when private.can_see_discipline(h.event_id) or private.is_owner() or private.is_org_admin(h.organization_id) then private.person_name(h.actor) end) order by h.at, h.id)
    from public.discipline_history h where h.entity = p_entity and h.entity_id = any (v_ids)), '[]'::jsonb);
end $$;

-- The suspensions an organization (its admins) or the platform owner manages.
create or replace function public.managed_suspensions(p_organization uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_organization is not null and not (private.is_org_admin(p_organization) or private.is_owner()) then raise exception 'only this organization''s admins can see its suspensions' using errcode = '42501'; end if;
  if p_organization is null and not private.is_owner() then raise exception 'only the platform owner manages platform suspensions' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'authority', s.authority, 'scope', s.scope, 'fighter_id', s.fighter_id, 'team_id', s.team_id, 'against', coalesce(f.display_name, t.name),
      'starts_at', s.starts_at, 'ends_at', s.ends_at, 'lifted_at', s.lifted_at, 'superseded', s.superseded_by is not null, 'label', private.suspension_label(s), 'reason', sp.reason, 'lift_reason', sp.lift_reason,
      'in_force', s.lifted_at is null and s.superseded_by is null and (s.ends_at is null or s.ends_at > now())) order by s.created_at desc)
    from public.discipline_suspensions s join public.discipline_suspensions_private sp on sp.suspension_id = s.id left join public.fighters f on f.id = s.fighter_id left join public.teams t on t.id = s.team_id
    where (p_organization is not null and s.authority = 'organization' and s.organization_id = p_organization) or (p_organization is null and s.authority = 'platform')), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 11. notifications (Pack 15's system, three kinds)
do $do$
declare v_def text; v_new text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'notifications_kind_check' and conrelid = 'public.notifications'::regclass;
  if position('suspension_changed' in v_def) = 0 then
    v_new := replace(v_def, $a$'inspection_passed'::text$a$, $a$'inspection_passed'::text, 'suspension_changed'::text, 'review_decided'::text, 'green_card_changed'::text$a$);
    if v_new = v_def then raise exception 'pack22: notifications kind anchor not found'; end if;
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check ' || v_new;
  end if;

  select pg_get_functiondef('private.notification_category(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$'inspection_needs_correction', 'inspection_passed') then 'events'$a$,
                          $a$'inspection_needs_correction', 'inspection_passed', 'green_card_changed') then 'events'$a$);
  if v_new = v_def then raise exception 'pack22: notification_category anchor not found'; end if;
  execute v_new;

  select pg_get_functiondef('private.notification_pushable(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$'inspection_needs_correction', 'inspection_passed')$a$, $a$'inspection_needs_correction', 'inspection_passed', 'suspension_changed', 'review_decided', 'green_card_changed')$a$);
  if v_new = v_def then raise exception 'pack22: notification_pushable anchor not found'; end if;
  execute v_new;

  select pg_get_functiondef('private.notification_route(text,jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$when p_kind in ('registration_decided', 'event_invited', 'event_cancelled', 'event_announcement', 'inspection_needs_correction', 'inspection_passed') and$a$,
                          $a$when p_kind in ('registration_decided', 'event_invited', 'event_cancelled', 'event_announcement', 'inspection_needs_correction', 'inspection_passed', 'green_card_changed') and$a$);
  if v_new = v_def then raise exception 'pack22: notification_route anchor not found'; end if;
  execute v_new;

  select pg_get_functiondef('private.notification_text(text,jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, $a$  if p_kind = 'inspection_needs_correction' then$a$,
$a$  if p_kind = 'suspension_changed' then
    return query select (case p_payload ->> 'change' when 'lifted' then 'Suspension lifted' when 'changed' then 'Suspension changed' else 'You are suspended' end)::text,
      (case p_payload ->> 'change' when 'lifted' then 'A suspension on your record was lifted.' else left(coalesce(p_payload ->> 'label', 'A suspension was recorded'), 140) || '.' end
       || ' See your discipline record.')::text;
    return;
  elsif p_kind = 'review_decided' then
    return query select 'Appeal decided'::text, ('An appeal or review on your record was decided: ' || replace(coalesce(p_payload ->> 'outcome', ''), '_', ' ') || '.')::text;
    return;
  elsif p_kind = 'green_card_changed' then
    return query select (case p_payload ->> 'change' when 'removed' then 'Green card removed' else 'Green card' end)::text,
      (case p_payload ->> 'change' when 'removed' then 'Your green card at ' || v_event || ' was removed after the correction was validated.'
            else 'You received a green card (authenticity) at ' || v_event || '. Talk to the authenticity officer.' end)::text;
    return;
  end if;
  if p_kind = 'inspection_needs_correction' then$a$);
  if v_new = v_def then raise exception 'pack22: notification_text anchor not found'; end if;
  execute v_new;
end $do$;
revoke execute on function private.notification_category(text), private.notification_pushable(text), private.notification_route(text, jsonb),
  private.notification_text(text, jsonb) from public, anon, authenticated;

-- Producers. A notification failure never undoes the decision (same pattern as Pack 15/16).
create or replace function private.suspension_notify(p_id uuid, p_change text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.discipline_suspensions; v_u uuid; v_payload jsonb;
begin
  begin
    select * into s from public.discipline_suspensions where id = p_id;
    if not found then return; end if;
    v_payload := jsonb_build_object('change', p_change, 'label', private.suspension_label(s));   -- no reason: it stays with the authority
    for v_u in select private.fighter_users(s.fighter_id) where s.fighter_id is not null union select private.team_captain_users(s.team_id) where s.team_id is not null loop
      insert into public.notifications (user_id, kind, payload, dedupe_key) values (v_u, 'suspension_changed', v_payload, 'suspension:' || p_id::text || ':' || p_change || ':' || v_u::text)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then raise warning 'suspension notification failed for %: %', p_id, sqlerrm;
  end;
end $$;
create or replace function private.review_decided_notify(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.discipline_reviews; v_u uuid;
begin
  begin
    select * into r from public.discipline_reviews where id = p_id;
    if not found then return; end if;
    for v_u in select private.fighter_users(r.fighter_id) where r.fighter_id is not null union select private.team_captain_users(r.team_id) where r.team_id is not null loop
      insert into public.notifications (user_id, kind, payload, dedupe_key) values (v_u, 'review_decided', jsonb_build_object('outcome', r.outcome, 'kind', r.kind), 'review:' || p_id::text || ':' || v_u::text)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then raise warning 'review notification failed for %: %', p_id, sqlerrm;
  end;
end $$;
create or replace function private.green_card_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events; v_u uuid; v_change text;
begin
  begin
    if new.card_key is distinct from 'green_card' or new.fighter_id is null then return null; end if;
    v_change := case when tg_op = 'INSERT' then 'issued' when new.status <> old.status then new.status else null end;
    if v_change is null then return null; end if;
    select * into v_ev from public.events where id = new.event_id;
    for v_u in select private.fighter_users(new.fighter_id) loop
      insert into public.notifications (user_id, kind, payload, dedupe_key)
      values (v_u, 'green_card_changed', jsonb_build_object('change', v_change, 'event_name', v_ev.name, 'event_slug', v_ev.slug), 'green:' || new.id::text || ':' || v_change || ':' || v_u::text)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then raise warning 'green card notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.suspension_notify(uuid, text), private.review_decided_notify(uuid), private.green_card_notify() from public, anon, authenticated;
drop trigger if exists event_sanctions_green_notify on public.event_sanctions;
create trigger event_sanctions_green_notify after insert or update of status on public.event_sanctions for each row execute function private.green_card_notify();

-- ---------------------------------------------------------------- 12. privileges and realtime
revoke execute on function public.set_competition_rulesets(uuid, uuid[]), public.apply_current_documents(uuid, text), public.apply_card_preset(uuid, text),
  public.issue_event_sanction(uuid, uuid, text, uuid, uuid, uuid, text, uuid, text), public.end_event_sanction(uuid, text, text),
  public.record_authenticity_finding(uuid, uuid, text, text, uuid, text), public.close_authenticity_finding(uuid, text, text),
  public.issue_suspension(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid), public.change_suspension(uuid, uuid, timestamptz, text),
  public.lift_suspension(uuid, text), public.lodge_review(uuid, text, text, text, uuid, uuid, uuid, uuid, text, timestamptz), public.decide_review(uuid, text, text, boolean),
  public.withdraw_review(uuid, text), public.discipline_eligibility(uuid, uuid, uuid), public.event_discipline_overview(uuid), public.fighter_discipline(uuid),
  public.discipline_record_history(text, uuid), public.managed_suspensions(uuid) from public, anon;
grant execute on function public.set_competition_rulesets(uuid, uuid[]), public.apply_current_documents(uuid, text), public.apply_card_preset(uuid, text),
  public.issue_event_sanction(uuid, uuid, text, uuid, uuid, uuid, text, uuid, text), public.end_event_sanction(uuid, text, text),
  public.record_authenticity_finding(uuid, uuid, text, text, uuid, text), public.close_authenticity_finding(uuid, text, text),
  public.issue_suspension(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid), public.change_suspension(uuid, uuid, timestamptz, text),
  public.lift_suspension(uuid, text), public.lodge_review(uuid, text, text, text, uuid, uuid, uuid, uuid, text, timestamptz), public.decide_review(uuid, text, text, boolean),
  public.withdraw_review(uuid, text), public.discipline_eligibility(uuid, uuid, uuid), public.event_discipline_overview(uuid), public.fighter_discipline(uuid),
  public.discipline_record_history(text, uuid), public.managed_suspensions(uuid) to authenticated;

do $do$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_sanctions') then
      alter publication supabase_realtime add table public.event_sanctions; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'discipline_reviews') then
      alter publication supabase_realtime add table public.discipline_reviews; end if;
  end if;
end $do$;
