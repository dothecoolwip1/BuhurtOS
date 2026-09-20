create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_platform_admin(check_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_memberships pm where pm.user_id = check_user and pm.role = 'platform_super_admin');
$$;

create or replace function private.has_org_role(check_user uuid, check_org uuid, roles public.organization_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_memberships om where om.user_id = check_user and om.organization_id = check_org and om.role = any(roles));
$$;

create or replace function private.has_event_role(check_user uuid, check_event uuid, roles public.event_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_memberships em where em.user_id = check_user and em.event_id = check_event and em.role = any(roles));
$$;

create or replace function private.has_team_event_role(check_user uuid, check_event uuid, check_team uuid, roles public.event_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_memberships em
    where em.user_id = check_user and em.event_id = check_event and em.team_id = check_team and em.role = any(roles)
  );
$$;

create or replace function private.event_is_public(check_event uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = check_event and e.status in ('published','live','completed'));
$$;

create or replace function private.can_view_managed_profile(check_user uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    private.is_platform_admin(check_user)
    or exists (
      select 1
      from public.event_memberships target
      join public.events e on e.id = target.event_id
      where target.user_id = target_user
        and (
          private.has_org_role(check_user, e.organization_id, array['organization_admin']::public.organization_role[])
          or private.has_event_role(check_user, e.id, array['event_organizer']::public.event_role[])
        )
    );
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
-- RLS policies run as the requesting database role. Grant only schema usage + EXECUTE
-- so policies can call these SECURITY DEFINER helpers. The private schema is not exposed
-- through the Data API, so these helpers are not public endpoints.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_platform_admin(uuid) to anon, authenticated;
grant execute on function private.has_org_role(uuid,uuid,public.organization_role[]) to anon, authenticated;
grant execute on function private.has_event_role(uuid,uuid,public.event_role[]) to anon, authenticated;
grant execute on function private.has_team_event_role(uuid,uuid,uuid,public.event_role[]) to anon, authenticated;
grant execute on function private.event_is_public(uuid) to anon, authenticated;
grant execute on function private.can_view_managed_profile(uuid,uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.platform_memberships enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.fighters enable row level security;
alter table public.events enable row level security;
alter table public.event_memberships enable row level security;
alter table public.event_roster_entries enable row level security;
alter table public.fight_cards enable row level security;
alter table public.brackets enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.match_side_members enable row level security;
alter table public.match_rounds enable row level security;
alter table public.disciplinary_cards enable row level security;
alter table public.fight_notes enable row level security;
alter table public.announcements enable row level security;
alter table public.event_registrations enable row level security;
alter table public.registration_payments enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_event_admin_read on public.profiles for select to authenticated using (private.can_view_managed_profile((select auth.uid()), id));
create policy profiles_self_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy organizations_member_read on public.organizations for select to authenticated using (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), id, array['organization_admin','organization_staff']::public.organization_role[])
);
create policy organizations_admin_write on public.organizations for all to authenticated using (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), id, array['organization_admin']::public.organization_role[])
) with check (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), id, array['organization_admin']::public.organization_role[])
);

create policy platform_memberships_self_read on public.platform_memberships for select to authenticated using (user_id = (select auth.uid()) or private.is_platform_admin((select auth.uid())));
create policy org_memberships_member_read on public.organization_memberships for select to authenticated using (user_id = (select auth.uid()) or private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]));
create policy org_memberships_admin_write on public.organization_memberships for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]));

create policy seasons_org_read on public.seasons for select to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]));
create policy seasons_org_write on public.seasons for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]));

create policy teams_org_read on public.teams for select to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]));
create policy teams_org_write on public.teams for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]));

create policy fighters_org_read on public.fighters for select to authenticated using (user_id = (select auth.uid()) or private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]));
create policy fighters_org_write on public.fighters for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]));

create policy events_public_read on public.events for select to anon, authenticated using (
  status in ('published','live','completed') or private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[])
);
create policy events_staff_write on public.events for all to authenticated using (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), id, array['event_organizer']::public.event_role[])
) with check (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), id, array['event_organizer']::public.event_role[])
);

create policy event_memberships_self_read on public.event_memberships for select to authenticated using (
  user_id = (select auth.uid())
  or private.is_platform_admin((select auth.uid()))
  or exists (select 1 from public.events e where e.id = event_id and private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin']::public.organization_role[]))
  or private.has_event_role((select auth.uid()), event_id, array['event_organizer']::public.event_role[])
);
create policy event_memberships_admin_write on public.event_memberships for all to authenticated using (
  private.is_platform_admin((select auth.uid()))
  or exists (select 1 from public.events e where e.id = event_id and private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin']::public.organization_role[]))
  or private.has_event_role((select auth.uid()), event_id, array['event_organizer']::public.event_role[])
) with check (
  private.is_platform_admin((select auth.uid()))
  or exists (select 1 from public.events e where e.id = event_id and private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin']::public.organization_role[]))
  or private.has_event_role((select auth.uid()), event_id, array['event_organizer']::public.event_role[])
);

create policy roster_read on public.event_roster_entries for select to anon, authenticated using (
  private.event_is_public(event_id) or private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[])
);
create policy roster_staff_write on public.event_roster_entries for all to authenticated using (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
) with check (
  private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
);

create policy fight_cards_read on public.fight_cards for select to anon, authenticated using (private.event_is_public(event_id) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]));
create policy fight_cards_write on public.fight_cards for all to authenticated using (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[])) with check (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[]));

create policy brackets_read on public.brackets for select to anon, authenticated using (private.event_is_public(event_id) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]));
create policy brackets_write on public.brackets for all to authenticated using (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[])) with check (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[]));

create policy matches_read on public.matches for select to anon, authenticated using (private.event_is_public(event_id) or private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]));
create policy matches_write on public.matches for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]));

create policy participants_read on public.match_participants for select to anon, authenticated using (exists (select 1 from public.matches m where m.id = match_id and (private.event_is_public(m.event_id) or private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]))));
create policy participants_write on public.match_participants for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]))) with check (exists (select 1 from public.matches m where m.id = match_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])));

create policy side_members_read on public.match_side_members for select to anon, authenticated using (exists (select 1 from public.match_participants mp join public.matches m on m.id = mp.match_id where mp.id = match_participant_id and (private.event_is_public(m.event_id) or private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]))));
create policy side_members_write on public.match_side_members for all to authenticated using (exists (select 1 from public.match_participants mp join public.matches m on m.id = mp.match_id where mp.id = match_participant_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]))) with check (exists (select 1 from public.match_participants mp join public.matches m on m.id = mp.match_id where mp.id = match_participant_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])));

create policy rounds_read on public.match_rounds for select to anon, authenticated using (exists (select 1 from public.matches m where m.id = match_id and (private.event_is_public(m.event_id) or private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]))));
create policy rounds_write on public.match_rounds for all to authenticated using (exists (select 1 from public.matches m where m.id = match_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]))) with check (exists (select 1 from public.matches m where m.id = match_id and private.has_event_role((select auth.uid()), m.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])));

create policy discipline_read on public.disciplinary_cards for select to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]));
create policy discipline_write on public.disciplinary_cards for all to authenticated using (private.is_platform_admin((select auth.uid())) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[])) with check (private.is_platform_admin((select auth.uid())) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal']::public.event_role[]));

create policy fight_notes_read on public.fight_notes for select to authenticated using (
  author_user_id = (select auth.uid()) or
  (visibility = 'marshal_visible' and private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])) or
  (visibility = 'team_only' and team_id is not null and exists (select 1 from public.fighters f where f.user_id = (select auth.uid()) and f.team_id = fight_notes.team_id)) or
  (visibility = 'team_only' and team_id is not null and private.has_team_event_role((select auth.uid()), event_id, team_id, array['team_captain']::public.event_role[]))
);
create policy fight_notes_author_write on public.fight_notes for all to authenticated
using (author_user_id = (select auth.uid()))
with check (
  author_user_id = (select auth.uid())
  and private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[])
  and (
    visibility <> 'team_only'
    or (
      team_id is not null
      and (
        private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
        or private.has_team_event_role((select auth.uid()), event_id, team_id, array['team_captain']::public.event_role[])
        or exists (select 1 from public.fighters f where f.user_id = (select auth.uid()) and f.team_id = fight_notes.team_id)
      )
    )
  )
);

create policy announcements_read on public.announcements for select to anon, authenticated using (is_public and private.event_is_public(event_id) or private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]));
create policy announcements_write on public.announcements for all to authenticated using (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])) with check (private.has_event_role((select auth.uid()), event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]));

create policy registrations_staff_read on public.event_registrations for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and (private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), e.id, array['event_organizer']::public.event_role[]))));
create policy registrations_staff_write on public.event_registrations for update to authenticated using (exists (select 1 from public.events e where e.id = event_id and (private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), e.id, array['event_organizer']::public.event_role[])))) with check (exists (select 1 from public.events e where e.id = event_id and (private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), e.id, array['event_organizer']::public.event_role[]))));

create policy payments_staff_read on public.registration_payments for select to authenticated using (exists (select 1 from public.event_registrations r join public.events e on e.id = r.event_id where r.id = registration_id and (private.has_org_role((select auth.uid()), e.organization_id, array['organization_admin','organization_staff']::public.organization_role[]) or private.has_event_role((select auth.uid()), e.id, array['event_organizer']::public.event_role[]))));

create policy audit_staff_read on public.audit_log for select to authenticated using (private.is_platform_admin((select auth.uid())) or (organization_id is not null and private.has_org_role((select auth.uid()), organization_id, array['organization_admin']::public.organization_role[])));

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.events, public.matches, public.match_participants, public.match_rounds, public.brackets, public.fight_cards, public.announcements to anon;
grant select (id, event_id, team_id, entry_type, display_name, attendance_status) on public.event_roster_entries to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function public.submit_match_result(
  p_match_id uuid,
  p_rounds jsonb,
  p_forfeit_side smallint default null,
  p_forfeit_reason text default null,
  p_expected_status public.match_status default 'scheduled'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_config jsonb;
  v_required integer;
  v_allow_draw boolean;
  v_cap numeric;
  v_kind text;
  v_wins_required integer;
  v_count integer;
  v_s1 numeric := 0;
  v_s2 numeric := 0;
  v_w1 integer := 0;
  v_w2 integer := 0;
  v_winner smallint := null;
  v_item jsonb;
  v_entry uuid;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> p_expected_status then raise exception 'Match changed since it was loaded'; end if;
  if v_match.status in ('finalized','cancelled') then raise exception 'Match is already closed'; end if;
  if v_match.status not in ('active','completed') then raise exception 'Match must be active before a result can be submitted'; end if;
  if not (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()), v_match.organization_id, array['organization_admin']::public.organization_role[]) or private.has_event_role((select auth.uid()), v_match.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])) then raise exception 'Not authorized to score this match'; end if;

  for v_entry in select roster_entry_id from public.match_participants where match_id = p_match_id and roster_entry_id is not null loop
    if not exists (select 1 from public.event_roster_entries where id = v_entry and can_compete) then raise exception 'A match participant is not cleared to compete'; end if;
  end loop;

  v_config := v_match.scoring_config;
  v_required := coalesce((v_config->>'roundsRequired')::integer, 1);
  v_allow_draw := coalesce((v_config->>'allowDrawRound')::boolean, false);
  v_cap := nullif(v_config->>'scoreCapPerRound','')::numeric;
  v_kind := coalesce(v_config->>'kind','duel');
  v_wins_required := coalesce((v_config->>'winsRequired')::integer, floor(v_required / 2.0)::integer + 1);

  if p_forfeit_side is not null then
    if p_forfeit_side not in (1,2) then raise exception 'Invalid forfeit side'; end if;
    if coalesce((v_config->>'requireReasonOnForfeit')::boolean, true) and length(trim(coalesce(p_forfeit_reason,''))) = 0 then raise exception 'Forfeit reason is required'; end if;
    v_winner := case when p_forfeit_side = 1 then 2 else 1 end;
    delete from public.match_rounds where match_id = p_match_id;
  else
    if jsonb_typeof(p_rounds) <> 'array' then raise exception 'Rounds must be an array'; end if;
    select jsonb_array_length(p_rounds) into v_count;
    if v_count <> v_required then raise exception 'Incorrect number of rounds'; end if;
    delete from public.match_rounds where match_id = p_match_id;
    for v_item in select value from jsonb_array_elements(p_rounds) loop
      if (v_item->>'roundNumber')::integer < 1 or (v_item->>'roundNumber')::integer > v_required then raise exception 'Round number outside configured range'; end if;
      if (v_item->>'side1Score')::numeric < 0 or (v_item->>'side2Score')::numeric < 0 then raise exception 'Scores cannot be negative'; end if;
      if v_cap is not null and ((v_item->>'side1Score')::numeric > v_cap or (v_item->>'side2Score')::numeric > v_cap) then raise exception 'Score exceeds configured cap'; end if;
      if not v_allow_draw and (v_item->>'side1Score')::numeric = (v_item->>'side2Score')::numeric then raise exception 'Tied round is not allowed'; end if;
      insert into public.match_rounds(match_id, round_number, side_1_score, side_2_score, notes) values (p_match_id, (v_item->>'roundNumber')::integer, (v_item->>'side1Score')::numeric, (v_item->>'side2Score')::numeric, v_item->>'notes');
      v_s1 := v_s1 + (v_item->>'side1Score')::numeric;
      v_s2 := v_s2 + (v_item->>'side2Score')::numeric;
      if (v_item->>'side1Score')::numeric > (v_item->>'side2Score')::numeric then v_w1 := v_w1 + 1; elsif (v_item->>'side2Score')::numeric > (v_item->>'side1Score')::numeric then v_w2 := v_w2 + 1; end if;
    end loop;
    if v_kind = 'team_fight' or v_config ? 'winsRequired' then
      if v_w1 >= v_wins_required then v_winner := 1; elsif v_w2 >= v_wins_required then v_winner := 2; elsif v_w1 <> v_w2 then v_winner := case when v_w1 > v_w2 then 1 else 2 end; end if;
    else
      if v_s1 > v_s2 then v_winner := 1; elsif v_s2 > v_s1 then v_winner := 2; end if;
    end if;
  end if;

  update public.matches set
    status = 'finalized', completed_at = timezone('utc', now()), finalized_at = timezone('utc', now()), last_edited_by = (select auth.uid()),
    result_summary = jsonb_build_object('winnerSide', v_winner, 'side1Total', v_s1, 'side2Total', v_s2, 'roundsWonSide1', v_w1, 'roundsWonSide2', v_w2, 'resultType', case when p_forfeit_side is not null then 'forfeit' when v_winner is null then 'draw' when v_kind = 'team_fight' or v_config ? 'winsRequired' then 'rounds' else 'points' end, 'forfeitReason', p_forfeit_reason)
  where id = p_match_id;

  if v_winner is not null and v_match.winner_advances_to_match_id is not null then
    select roster_entry_id into v_entry from public.match_participants where match_id = p_match_id and side_index = v_winner;
    delete from public.match_participants where match_id = v_match.winner_advances_to_match_id and side_index = v_match.winner_advances_to_slot;
    insert into public.match_participants(match_id, roster_entry_id, side_index, source_match_id, source_slot, is_winner_source, is_placeholder)
      values (v_match.winner_advances_to_match_id, v_entry, v_match.winner_advances_to_slot, p_match_id, v_match.winner_advances_to_slot, true, false);
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload) values (v_match.organization_id,v_match.event_id,(select auth.uid()),'matches',p_match_id,'finalize_result',jsonb_build_object('winnerSide',v_winner));
  return (select result_summary from public.matches where id = p_match_id);
end;
$$;

create or replace function public.reorder_match(p_match_id uuid, p_direction integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_match public.matches%rowtype; v_other public.matches%rowtype;
begin
  if p_direction not in (-1,1) then raise exception 'Direction must be -1 or 1'; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
