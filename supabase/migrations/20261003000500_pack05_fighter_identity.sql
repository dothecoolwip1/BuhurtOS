-- Pack 05 (2026-10-03): fighter identity.
-- Product rule: ONE account represents ONE fighter. The database already enforces it (fighter_accounts: fighter_id is the primary key, user_id is unique)
-- and accounts cannot write that table directly (RLS has a select policy only). Fighter records without an account stay valid (historical, imported,
-- organizer-created).
-- What this adds: the two places that create a fighter for an account (accepting a registration, accepting a team-join request) now go through ONE
-- function that never creates a second fighter for an account, serialises concurrent attempts, and, when an UNLINKED fighter with the same name already
-- exists, records an identity review for the platform administrator instead of guessing, auto-merging or silently adding a likely duplicate.

create table public.fighter_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.fighters (id) on delete cascade,       -- the record just created for an account
  candidate_id uuid not null references public.fighters (id) on delete cascade,     -- an existing record that may be the same person
  reason text not null default 'same_name' check (reason in ('same_name')),
  source text not null check (source in ('registration', 'team_join')),
  status text not null default 'open' check (status in ('open', 'distinct', 'duplicate')),
  note text,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  unique (fighter_id, candidate_id),
  check (fighter_id <> candidate_id)
);
create index fighter_identity_reviews_open_idx on public.fighter_identity_reviews (created_at) where status = 'open';
alter table public.fighter_identity_reviews enable row level security;   -- no policies: reachable only through the administrator functions below
revoke all on public.fighter_identity_reviews from anon, authenticated;

-- The one place that gives an account its fighter. Existing link wins; otherwise create the record, link it, and flag look-alikes for a person to judge.
create or replace function private.ensure_fighter_for_account(p_user uuid, p_name text, p_team uuid, p_source text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_fighter uuid; v_name text := left(btrim(p_name), 80);
begin
  perform pg_advisory_xact_lock(hashtextextended('fighter-account:' || p_user::text, 0));   -- two simultaneous accepts for one account run one after the other
  select fighter_id into v_fighter from public.fighter_accounts where user_id = p_user;
  if v_fighter is not null then return v_fighter; end if;
  insert into public.fighters (display_name, team_id) values (v_name, p_team) returning id into v_fighter;
  insert into public.fighter_accounts (fighter_id, user_id) values (v_fighter, p_user);
  insert into public.fighter_identity_reviews (fighter_id, candidate_id, source)
  select v_fighter, f.id, p_source from public.fighters f
  where f.id <> v_fighter and lower(btrim(f.display_name)) = lower(v_name)
    and not exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id and a.user_id = p_user)
  on conflict do nothing;
  if found then
    perform private.audit(null, 'fighter.identity_review_opened', v_fighter::text, jsonb_build_object('source', p_source));
  end if;
  return v_fighter;
end $$;
revoke execute on function private.ensure_fighter_for_account(uuid, text, uuid, text) from public, anon, authenticated;

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'decide_registration';
  v_def := replace(v_def, $$      insert into public.fighters (display_name, team_id) values (v_reg.full_name, v_reg.team_id) returning id into v_fighter;
      insert into public.fighter_accounts (fighter_id, user_id) values (v_fighter, v_reg.user_id);$$,
    $$      v_fighter := private.ensure_fighter_for_account(v_reg.user_id, v_reg.full_name, v_reg.team_id, 'registration');$$);
  if position('ensure_fighter_for_account' in v_def) = 0 then raise exception 'decide_registration body did not match the expected text'; end if;
  execute v_def;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'decide_team_join';
  v_def := replace(v_def, $$      insert into public.fighters (display_name, team_id) values (left(v_name, 80), v_req.team_id) returning id into v_fighter;
      insert into public.fighter_accounts (fighter_id, user_id) values (v_fighter, v_req.requester_id);$$,
    $$      v_fighter := private.ensure_fighter_for_account(v_req.requester_id, v_name, v_req.team_id, 'team_join');$$);
  if position('ensure_fighter_for_account' in v_def) = 0 then raise exception 'decide_team_join body did not match the expected text'; end if;
  execute v_def;
end $do$;

-- Administration: platform owner only.
create or replace function public.list_fighter_identity_reviews()
returns table(review_id uuid, source text, created_at timestamptz, new_fighter jsonb, candidate jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner() then raise exception 'only a platform administrator can review fighter identities' using errcode = '42501'; end if;
  return query
  select r.id, r.source, r.created_at,
    (select jsonb_build_object('id', f.id, 'name', f.display_name, 'team', t.name, 'has_account', true, 'created_at', f.created_at,
        'entries', (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id), 'synthetic', private.is_synthetic('fighter', f.id))
       from public.fighters f left join public.teams t on t.id = f.team_id where f.id = r.fighter_id),
    (select jsonb_build_object('id', f.id, 'name', f.display_name, 'team', t.name, 'has_account', exists (select 1 from public.fighter_accounts a where a.fighter_id = f.id), 'created_at', f.created_at,
        'entries', (select count(*) from public.fighter_participation fp where fp.fighter_id = f.id), 'synthetic', private.is_synthetic('fighter', f.id),
        'sources', coalesce((select jsonb_agg(s.title) from public.record_sources rs join public.sources s on s.id = rs.source_id where rs.entity_type = 'fighter' and rs.entity_id = f.id), '[]'::jsonb))
       from public.fighters f left join public.teams t on t.id = f.team_id where f.id = r.candidate_id)
  from public.fighter_identity_reviews r where r.status = 'open' order by r.created_at;
end $$;
grant execute on function public.list_fighter_identity_reviews() to authenticated;

create or replace function public.resolve_fighter_identity_review(p_review uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.fighter_identity_reviews;
begin
  if not private.is_owner() then raise exception 'only a platform administrator can review fighter identities' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('distinct', 'duplicate') then raise exception 'decision must be distinct or duplicate' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'say how this was decided' using errcode = '22023'; end if;
  select * into v_r from public.fighter_identity_reviews where id = p_review for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'open' then raise exception 'this review was already decided' using errcode = 'P0001'; end if;
  -- Nothing is merged here. "duplicate" records that a person judged the two records to be one human; the merge itself is a later, deliberate step.
  update public.fighter_identity_reviews set status = p_decision, note = btrim(p_note), resolved_by = auth.uid(), resolved_at = now() where id = p_review;
  perform private.audit(null, 'fighter.identity_review_' || p_decision, v_r.fighter_id::text, jsonb_build_object('candidate', v_r.candidate_id, 'note', btrim(p_note)));
end $$;
grant execute on function public.resolve_fighter_identity_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Public history lists. The ranking and statistics views (result_rows, fighter_results, team_results, ...) leave fictional events out (Pack 01). A
-- person's or team's own tournament history is not an aggregate, so it still shows fictional results, flagged `synthetic` so every page can label them,
-- and a team's row carries the name it used at the event and the team's current name (a merge or rename never rewrites the event-time identity).
create or replace view public.result_rows_all with (security_invoker = true) as
 SELECT r.competition_id, r.entry_id, r.final_place, COALESCE(r.points, (0)::numeric) AS points, k.name AS competition_name, k.category, k.gender, k.tier, k.structure,
        ev.id AS event_id, ev.slug AS event_slug, ev.name AS event_name, ev.event_type, ev.starts_on, ev.ends_on AS event_ends_on, ev.season_id,
        COALESCE(ev.organization_id, se.organization_id) AS organization_id, e.team_id, e.fighter_id AS entry_fighter_id,
        private.is_synthetic('event', ev.id) AS synthetic, COALESCE(e.team_name_at_event, t.name) AS team_name_at_event, t.name AS team_current_name, t.slug AS team_current_slug
   FROM (((((results r JOIN entries e ON ((e.id = r.entry_id))) JOIN competitions k ON ((k.id = r.competition_id))) JOIN events ev ON ((ev.id = k.event_id)))
        LEFT JOIN seasons se ON ((se.id = ev.season_id))) LEFT JOIN teams t ON ((t.id = e.team_id)))
  WHERE r.final_place IS NOT NULL;
create or replace view public.fighter_results_all with (security_invoker = true) as
 SELECT fp.fighter_id, rr.* FROM (result_rows_all rr JOIN fighter_participation fp ON ((fp.entry_id = rr.entry_id)));
create or replace view public.team_results_all with (security_invoker = true) as
 SELECT rr.* FROM result_rows_all rr WHERE rr.team_id IS NOT NULL;
grant select on public.result_rows_all, public.fighter_results_all, public.team_results_all to anon, authenticated;
