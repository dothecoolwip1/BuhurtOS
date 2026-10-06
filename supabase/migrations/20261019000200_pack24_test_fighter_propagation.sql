-- Pack 24 follow-up (audit 2026-10-06): a fighter created for a test event is itself test data. ADDITIVE.
--
-- The synthetic/test model is unchanged (Pack 01): a record is test data when record_sources tags it with a source whose `synthetic` flag is set, and
-- private.is_synthetic(type, id) is the one question everything asks. Names and slugs are never looked at.
--
-- The bug: create_unclaimed_fighter (Pack 08), the organizer's "add a new fighter" on a test event, made an ordinary fighter. That fighter then showed
-- in the claimable-profile search, could be claimed by a real account, raised look-alike reviews against real fighters, and could be entered in real
-- events, all as if it were a real person.
--
--   1. create_unclaimed_fighter on a synthetic event tags the new fighter with the same synthetic source as the event (one record_sources row), skips
--      the look-alike check and review queue against real fighters (a test profile is not a candidate identity of a real person), and says so in its
--      audit row. On a real event nothing changes.
--   2. add_entrant_core refuses a synthetic fighter in a competition of a real event (the search already hides them there; this closes a direct call).
--
-- Not changed, deliberately: a person with an ACCOUNT who registers for a test event keeps (or gets) their real fighter (ensure_fighter_for_account);
-- an account's identity is never marked as test data. Existing fighters are not backfilled here: which ones were made for the published test events is
-- the owner's cleanup decision (docs/claude-packs/PACK_24A0_MATCH_SAFETY_GUARDS.md, section 0).

create or replace function private.synthetic_source_of(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.source_id from public.record_sources r join public.sources s on s.id = r.source_id
  where s.synthetic and r.entity_type = p_type and r.entity_id = p_id order by r.created_at, r.source_id limit 1 $$;
revoke execute on function private.synthetic_source_of(text, uuid) from public, anon, authenticated;

create or replace function public.create_unclaimed_fighter(
  p_event uuid, p_name text, p_home_team uuid default null, p_city text default null, p_region text default null, p_gender text default null,
  p_confirmed_distinct boolean default false, p_competition uuid default null, p_entry_team uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_city text := nullif(btrim(coalesce(p_city, '')), ''); v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_dups uuid[] := '{}'; v_id uuid; v_entry jsonb; v_ev public.events; d uuid; v_test uuid;
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
  v_test := private.synthetic_source_of('event', p_event);
  if v_test is null then
    select coalesce(array_agg(f.id), '{}') into v_dups from public.fighters f
    where lower(regexp_replace(btrim(f.display_name), '\s+', ' ', 'g')) = lower(v_name) and not private.is_synthetic('fighter', f.id);
    if cardinality(v_dups) > 0 and not coalesce(p_confirmed_distinct, false) then
      raise exception '% fighter(s) named % already exist; pick one of them, or confirm this is a different person', cardinality(v_dups), v_name using errcode = '22023';
    end if;
  end if;
  insert into public.fighters (display_name, team_id, city, region, gender) values (v_name, p_home_team, v_city, v_region, p_gender) returning id into v_id;
  if v_test is not null then
    insert into public.record_sources (source_id, entity_type, entity_id, note)
    values (v_test, 'fighter', v_id, left('Created for the test event ' || v_ev.slug, 500));
  end if;
  foreach d in array v_dups loop
    insert into public.fighter_identity_reviews (fighter_id, candidate_id, reason, source) values (v_id, d, 'same_name', 'organizer_entry') on conflict do nothing;
  end loop;
  perform private.audit(p_event, 'fighter.created_by_organizer', v_id::text, jsonb_build_object('event_name', v_ev.name, 'flagged', cardinality(v_dups), 'synthetic', v_test is not null));
  if p_competition is not null then
    v_entry := private.add_entrant_core(p_competition, v_id, p_entry_team);
    perform private.audit(p_event, 'entrant.added', v_id::text, jsonb_build_object('competition', p_competition, 'entry', v_entry ->> 'entry_id', 'unclaimed', true));
  end if;
  return jsonb_build_object('fighter_id', v_id, 'flagged', cardinality(v_dups), 'entry', v_entry, 'synthetic', v_test is not null);
end $$;

-- 2. a test fighter stays out of real events (patched in place with an anchor, the Pack 18.1 technique; the rest of the function is kept as it is)
create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack24 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;
select pg_temp.bos_patch('private.add_entrant_core(uuid,uuid,uuid)'::regprocedure,
  $a$  if not exists (select 1 from public.fighters where id = p_fighter) then raise exception 'fighter not found' using errcode = 'P0002'; end if;$a$,
  $b$  if not exists (select 1 from public.fighters where id = p_fighter) then raise exception 'fighter not found' using errcode = 'P0002'; end if;
  if private.is_synthetic('fighter', p_fighter) and not private.is_synthetic('event', v_k.event_id) then
    raise exception 'this is a fictional test fighter; it can only be entered in a test event' using errcode = '22023'; end if;$b$);
