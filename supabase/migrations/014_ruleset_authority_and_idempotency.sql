-- Authoritative ruleset execution, historical snapshots and idempotent mutation RPCs.

create or replace function private.jsonb_deep_merge(base jsonb, overlay jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(base, '{}'::jsonb);
  item record;
begin
  if jsonb_typeof(overlay) <> 'object' then
    return coalesce(overlay, result);
  end if;
  if jsonb_typeof(result) <> 'object' then
    result := '{}'::jsonb;
  end if;

  for item in select key, value from jsonb_each(overlay)
  loop
    if jsonb_typeof(result -> item.key) = 'object' and jsonb_typeof(item.value) = 'object' then
      result := jsonb_set(result, array[item.key], private.jsonb_deep_merge(result -> item.key, item.value), true);
    else
      result := jsonb_set(result, array[item.key], item.value, true);
    end if;
  end loop;
  return result;
end;
$$;

revoke execute on function private.jsonb_deep_merge(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.resolve_ruleset_settings(check_ruleset uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  merged jsonb := '{}'::jsonb;
  settings_row record;
begin
  if check_ruleset is null then return merged; end if;

  for settings_row in
    with recursive chain as (
      select r.id,r.parent_ruleset_id,r.settings,0 as depth,array[r.id]::uuid[] as path
      from public.rulesets r where r.id=check_ruleset
      union all
      select parent.id,parent.parent_ruleset_id,parent.settings,chain.depth+1,chain.path||parent.id
      from chain
      join public.rulesets parent on parent.id=chain.parent_ruleset_id
      where not parent.id=any(chain.path)
    )
    select settings from chain order by depth desc
  loop
    merged := private.jsonb_deep_merge(merged, settings_row.settings);
  end loop;

  return merged;
end;
$$;

create or replace function private.event_ruleset_settings(check_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.resolve_ruleset_settings(e.ruleset_id)
  from public.events e
  where e.id=check_event;
$$;

revoke execute on function private.resolve_ruleset_settings(uuid) from public,anon,authenticated;
revoke execute on function private.event_ruleset_settings(uuid) from public,anon,authenticated;

create or replace function private.validate_ruleset_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_org uuid;
  cycle_found boolean;
begin
  if new.parent_ruleset_id is null then return new; end if;
  if new.parent_ruleset_id=new.id then raise exception 'A ruleset cannot inherit from itself'; end if;

  select organization_id into parent_org from public.rulesets where id=new.parent_ruleset_id;
  if not found then raise exception 'Parent ruleset not found'; end if;
  if parent_org is not null and parent_org is distinct from new.organization_id then
    raise exception 'Organization rulesets may only inherit from global or same-organization rulesets';
  end if;

  with recursive ancestors as (
    select r.id,r.parent_ruleset_id,array[r.id]::uuid[] path
    from public.rulesets r where r.id=new.parent_ruleset_id
    union all
    select p.id,p.parent_ruleset_id,a.path||p.id
    from ancestors a
    join public.rulesets p on p.id=a.parent_ruleset_id
    where not p.id=any(a.path)
  )
  select exists(select 1 from ancestors where id=new.id) into cycle_found;

  if cycle_found then raise exception 'Ruleset inheritance cycle detected'; end if;
  return new;
end;
$$;

create or replace function private.protect_published_ruleset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    if old.status <> 'draft' then raise exception 'Published or retired rulesets cannot be deleted'; end if;
    return old;
  end if;

  if old.status='retired' then
    raise exception 'Retired rulesets are immutable';
  end if;

  if old.status='published' then
    if new.status='retired'
      and (to_jsonb(new)-'status'-'updated_at'-'last_edited_by')
          = (to_jsonb(old)-'status'-'updated_at'-'last_edited_by')
    then
      return new;
    end if;
    raise exception 'Published rulesets are immutable. Create a new version instead';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_ruleset_parent() from public,anon,authenticated;
revoke execute on function private.protect_published_ruleset() from public,anon,authenticated;

drop trigger if exists ruleset_validate_parent on public.rulesets;
create trigger ruleset_validate_parent
before insert or update of parent_ruleset_id,organization_id on public.rulesets
for each row execute function private.validate_ruleset_parent();

drop trigger if exists ruleset_immutable_history on public.rulesets;
create trigger ruleset_immutable_history
before update or delete on public.rulesets
for each row execute function private.protect_published_ruleset();

create table public.event_ruleset_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  ruleset_name text not null,
  ruleset_version text not null,
  settings_snapshot jsonb not null,
  event_status public.event_status not null,
  captured_at timestamptz not null default timezone('utc',now()),
  captured_by uuid references public.profiles(id)
);

create index event_ruleset_snapshots_event_idx on public.event_ruleset_snapshots(event_id,captured_at desc);

create table public.season_ruleset_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  ruleset_name text not null,
  ruleset_version text not null,
  settings_snapshot jsonb not null,
  captured_at timestamptz not null default timezone('utc',now()),
  captured_by uuid references public.profiles(id)
);

create index season_ruleset_snapshots_season_idx on public.season_ruleset_snapshots(season_id,captured_at desc);

create or replace function private.enforce_event_ruleset_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ruleset_status text;
begin
  if new.ruleset_id is null then return new; end if;
  select status into ruleset_status from public.rulesets where id=new.ruleset_id;
  if not found then raise exception 'Ruleset not found'; end if;

  if new.status in ('published','live','completed') and ruleset_status <> 'published' then
    raise exception 'Published, live or completed events must use a published ruleset';
  end if;
  return new;
end;
$$;

create or replace function private.capture_event_ruleset_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rulesets%rowtype;
begin
  if new.ruleset_id is null then return new; end if;
  if new.status not in ('published','live','completed') then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.ruleset_id is not distinct from new.ruleset_id then return new; end if;

  select * into r from public.rulesets where id=new.ruleset_id;
  insert into public.event_ruleset_snapshots(event_id,ruleset_id,ruleset_name,ruleset_version,settings_snapshot,event_status,captured_by)
  values(new.id,r.id,r.name,r.version,private.resolve_ruleset_settings(r.id),new.status,(select auth.uid()));
  return new;
end;
$$;

revoke execute on function private.enforce_event_ruleset_state() from public,anon,authenticated;
revoke execute on function private.capture_event_ruleset_snapshot() from public,anon,authenticated;

drop trigger if exists event_ruleset_state_guard on public.events;
create trigger event_ruleset_state_guard
before insert or update of ruleset_id,status on public.events
for each row execute function private.enforce_event_ruleset_state();

drop trigger if exists event_ruleset_snapshot on public.events;
create trigger event_ruleset_snapshot
after insert or update of ruleset_id,status on public.events
for each row execute function private.capture_event_ruleset_snapshot();

create or replace function private.capture_season_ruleset_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rulesets%rowtype;
begin
  if new.ruleset_id is null then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.ruleset_id is not distinct from new.ruleset_id then return new; end if;
  if new.status <> 'archived' then return new; end if;
  select * into r from public.rulesets where id=new.ruleset_id;
  insert into public.season_ruleset_snapshots(season_id,ruleset_id,ruleset_name,ruleset_version,settings_snapshot,captured_by)
  values(new.id,r.id,r.name,r.version,private.resolve_ruleset_settings(r.id),(select auth.uid()));
  return new;
end;
$$;

revoke execute on function private.capture_season_ruleset_snapshot() from public,anon,authenticated;
drop trigger if exists season_ruleset_snapshot on public.seasons;
create trigger season_ruleset_snapshot
after insert or update of ruleset_id,status on public.seasons
for each row execute function private.capture_season_ruleset_snapshot();

create or replace function private.roster_entry_is_eligible(check_roster uuid, check_event uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.event_roster_entries%rowtype;
  settings jsonb;
  compliance jsonb;
begin
  select * into r from public.event_roster_entries where id=check_roster and event_id=check_event;
  if not found then return false; end if;
  if r.attendance_status in ('withdrawn','no_show') then return false; end if;

  settings := coalesce(private.event_ruleset_settings(check_event),'{}'::jsonb);
  compliance := coalesce(settings->'compliance','{}'::jsonb);

  if coalesce((compliance->>'requireCheckIn')::boolean,true) and not r.checked_in then return false; end if;
  if coalesce((compliance->>'requireArmorClearance')::boolean,true) and not r.armor_cleared then return false; end if;
  if coalesce((compliance->>'requireMedicalClearance')::boolean,true) and not r.medical_cleared then return false; end if;
  if coalesce((compliance->>'requireWaiver')::boolean,true) and not r.waiver_confirmed then return false; end if;
  if coalesce((compliance->>'requireWeighIn')::boolean,true) and not r.weigh_in_cleared then return false; end if;
  return true;
end;
$$;

revoke execute on function private.roster_entry_is_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function private.enforce_participant_clearance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if new.roster_entry_id is null then return new; end if;
  select event_id into v_event_id from public.matches where id=new.match_id;
  if v_event_id is null then raise exception 'Match not found'; end if;
  if not private.roster_entry_is_eligible(new.roster_entry_id,v_event_id) then
    raise exception 'Participant is not cleared under the active event ruleset';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_participant_clearance() from public,anon,authenticated;

create or replace function public.set_match_status(
  p_match_id uuid,
  p_status public.match_status,
  p_expected_status public.match_status
)
returns public.match_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_participant_count integer;
begin
  if p_status not in ('scheduled','in_the_hole','on_deck','active','cancelled') then
    raise exception 'Unsupported field status transition';
  end if;

  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> p_expected_status then raise exception 'Match changed since it was loaded'; end if;
  if v_match.status in ('finalized','cancelled') then raise exception 'Closed matches cannot be moved into field states'; end if;

  if not private.user_has_permission((select auth.uid()),'match.manage',v_match.organization_id,v_match.event_id,null) then
    raise exception 'Not authorized to change match status';
  end if;

  if p_status in ('in_the_hole','on_deck','active') then
    select count(*) into v_participant_count
    from public.match_participants mp
    where mp.match_id=p_match_id and not mp.is_placeholder and mp.roster_entry_id is not null;

    if v_participant_count < 2 then raise exception 'Match does not have two resolved competitors'; end if;

    if exists(
      select 1 from public.match_participants mp
      where mp.match_id=p_match_id and not mp.is_placeholder
        and (mp.roster_entry_id is null or not private.roster_entry_is_eligible(mp.roster_entry_id,v_match.event_id))
    ) then
      raise exception 'All competitors must be cleared under the active event ruleset';
    end if;

    update public.matches
    set status='scheduled',last_edited_by=(select auth.uid())
    where event_id=v_match.event_id
      and fight_card_id is not distinct from v_match.fight_card_id
      and id<>p_match_id and status=p_status;
  end if;

  update public.matches
  set status=p_status,
      started_at=case when p_status='active' and started_at is null then timezone('utc',now()) else started_at end,
      last_edited_by=(select auth.uid())
  where id=p_match_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_match.organization_id,v_match.event_id,(select auth.uid()),'matches',p_match_id,'set_status',jsonb_build_object('from',v_match.status,'to',p_status));

  return p_status;
end;
$$;

create or replace function public.reorder_match(p_match_id uuid,p_direction integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_other public.matches%rowtype;
begin
  if p_direction not in (-1,1) then raise exception 'Direction must be -1 or 1'; end if;
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if not private.user_has_permission((select auth.uid()),'match.manage',v_match.organization_id,v_match.event_id,null) then
    raise exception 'Not authorized';
  end if;

  if p_direction=-1 then
    select * into v_other from public.matches
    where fight_card_id is not distinct from v_match.fight_card_id and event_id=v_match.event_id and scheduled_order<v_match.scheduled_order
    order by scheduled_order desc limit 1 for update;
  else
    select * into v_other from public.matches
    where fight_card_id is not distinct from v_match.fight_card_id and event_id=v_match.event_id and scheduled_order>v_match.scheduled_order
    order by scheduled_order asc limit 1 for update;
  end if;

  if not found then return; end if;
  update public.matches set scheduled_order=v_other.scheduled_order,last_edited_by=(select auth.uid()) where id=v_match.id;
  update public.matches set scheduled_order=v_match.scheduled_order,last_edited_by=(select auth.uid()) where id=v_other.id;
end;
$$;

create or replace function public.submit_match_result(
  p_match_id uuid,
  p_rounds jsonb,
  p_forfeit_side smallint default null,
  p_forfeit_reason text default null,
  p_expected_status public.match_status default 'scheduled'
)
returns jsonb
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
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> p_expected_status then raise exception 'Match changed since it was loaded'; end if;
  if v_match.status in ('finalized','cancelled') then raise exception 'Match is already closed'; end if;
  if v_match.status not in ('active','completed') then raise exception 'Match must be active before a result can be submitted'; end if;
  if not private.user_has_permission((select auth.uid()),'match.score',v_match.organization_id,v_match.event_id,null) then
    raise exception 'Not authorized to score this match';
  end if;

  for v_entry in select roster_entry_id from public.match_participants where match_id=p_match_id and roster_entry_id is not null
  loop
    if not private.roster_entry_is_eligible(v_entry,v_match.event_id) then
      raise exception 'A match participant is not cleared under the active event ruleset';
    end if;
  end loop;

  v_config:=v_match.scoring_config;
  v_required:=coalesce((v_config->>'roundsRequired')::integer,1);
  v_allow_draw:=coalesce((v_config->>'allowDrawRound')::boolean,false);
  v_cap:=nullif(v_config->>'scoreCapPerRound','')::numeric;
  v_kind:=coalesce(v_config->>'kind','duel');
  v_wins_required:=coalesce((v_config->>'winsRequired')::integer,floor(v_required/2.0)::integer+1);

  if p_forfeit_side is not null then
    if p_forfeit_side not in (1,2) then raise exception 'Invalid forfeit side'; end if;
    if coalesce((v_config->>'requireReasonOnForfeit')::boolean,true) and length(trim(coalesce(p_forfeit_reason,'')))=0 then
      raise exception 'Forfeit reason is required';
    end if;
    v_winner:=case when p_forfeit_side=1 then 2 else 1 end;
    delete from public.match_rounds where match_id=p_match_id;
  else
    if jsonb_typeof(p_rounds)<>'array' then raise exception 'Rounds must be an array'; end if;
    select jsonb_array_length(p_rounds) into v_count;
    if v_count<>v_required then raise exception 'Incorrect number of rounds'; end if;
    delete from public.match_rounds where match_id=p_match_id;

    for v_item in select value from jsonb_array_elements(p_rounds)
    loop
      if (v_item->>'roundNumber')::integer<1 or (v_item->>'roundNumber')::integer>v_required then raise exception 'Round number outside configured range'; end if;
      if (v_item->>'side1Score')::numeric<0 or (v_item->>'side2Score')::numeric<0 then raise exception 'Scores cannot be negative'; end if;
      if v_cap is not null and ((v_item->>'side1Score')::numeric>v_cap or (v_item->>'side2Score')::numeric>v_cap) then raise exception 'Score exceeds configured cap'; end if;
      if not v_allow_draw and (v_item->>'side1Score')::numeric=(v_item->>'side2Score')::numeric then raise exception 'Tied round is not allowed'; end if;

      insert into public.match_rounds(match_id,round_number,side_1_score,side_2_score,notes)
      values(p_match_id,(v_item->>'roundNumber')::integer,(v_item->>'side1Score')::numeric,(v_item->>'side2Score')::numeric,v_item->>'notes');

      v_s1:=v_s1+(v_item->>'side1Score')::numeric;
      v_s2:=v_s2+(v_item->>'side2Score')::numeric;
      if (v_item->>'side1Score')::numeric>(v_item->>'side2Score')::numeric then v_w1:=v_w1+1;
      elsif (v_item->>'side2Score')::numeric>(v_item->>'side1Score')::numeric then v_w2:=v_w2+1;
      end if;
    end loop;

    if v_kind='team_fight' or v_config ? 'winsRequired' then
      if v_w1>=v_wins_required then v_winner:=1;
      elsif v_w2>=v_wins_required then v_winner:=2;
      elsif v_w1<>v_w2 then v_winner:=case when v_w1>v_w2 then 1 else 2 end;
      end if;
    else
      if v_s1>v_s2 then v_winner:=1; elsif v_s2>v_s1 then v_winner:=2; end if;
    end if;
  end if;

  update public.matches set
    status='finalized',completed_at=timezone('utc',now()),finalized_at=timezone('utc',now()),last_edited_by=(select auth.uid()),
    result_summary=jsonb_build_object(
      'winnerSide',v_winner,'side1Total',v_s1,'side2Total',v_s2,'roundsWonSide1',v_w1,'roundsWonSide2',v_w2,
      'resultType',case when p_forfeit_side is not null then 'forfeit' when v_winner is null then 'draw' when v_kind='team_fight' or v_config ? 'winsRequired' then 'rounds' else 'points' end,
      'forfeitReason',p_forfeit_reason
    )
  where id=p_match_id;

  if v_winner is not null and v_match.winner_advances_to_match_id is not null then
    select roster_entry_id into v_entry from public.match_participants where match_id=p_match_id and side_index=v_winner;
    delete from public.match_participants where match_id=v_match.winner_advances_to_match_id and side_index=v_match.winner_advances_to_slot;
    insert into public.match_participants(match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder)
    values(v_match.winner_advances_to_match_id,v_entry,v_match.winner_advances_to_slot,p_match_id,v_match.winner_advances_to_slot,true,false);
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_match.organization_id,v_match.event_id,(select auth.uid()),'matches',p_match_id,'finalize_result',jsonb_build_object('winnerSide',v_winner));

  return (select result_summary from public.matches where id=p_match_id);
end;
$$;

create or replace function public.save_bracket_plan(p_bracket jsonb,p_matches jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bracket_id uuid := (p_bracket->>'id')::uuid;
  v_event_id uuid := (p_bracket->>'eventId')::uuid;
  v_event public.events%rowtype;
  v_match jsonb;
  v_participant jsonb;
  v_roster uuid;
begin
  select * into v_event from public.events where id=v_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not private.user_has_permission((select auth.uid()),'bracket.manage',v_event.organization_id,v_event_id,null) then
    raise exception 'Not authorized to create brackets';
  end if;
  if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)<1 then raise exception 'Bracket plan has no matches'; end if;

  insert into public.brackets(id,event_id,fight_card_id,name,format,category,metadata,created_by)
  values(v_bracket_id,v_event_id,nullif(p_bracket->>'fightCardId','')::uuid,p_bracket->>'name',p_bracket->>'format',p_bracket->>'category',coalesce(p_bracket->'metadata','{}'::jsonb),(select auth.uid()));

  for v_match in select value from jsonb_array_elements(p_matches)
  loop
    insert into public.matches(
      id,organization_id,season_id,event_id,fight_card_id,bracket_id,label,category,match_type,scoring_config,status,stage,
      scheduled_order,bracket_round,bracket_slot,winner_advances_to_match_id,winner_advances_to_slot,loser_advances_to_match_id,
      loser_advances_to_slot,result_summary,created_by
    )
    values(
      (v_match->>'id')::uuid,v_event.organization_id,v_event.season_id,v_event.id,nullif(v_match->>'fightCardId','')::uuid,v_bracket_id,
      v_match->>'label',v_match->>'category',v_match->>'matchType',coalesce(v_match->'scoringConfig','{}'::jsonb),
      coalesce((v_match->>'status')::public.match_status,'scheduled'::public.match_status),
      coalesce((v_match->>'stage')::public.match_stage,'bracket'::public.match_stage),
      coalesce((v_match->>'scheduledOrder')::integer,0),nullif(v_match->>'bracketRound','')::integer,v_match->>'bracketSlot',
      nullif(v_match->>'winnerAdvancesToMatchId','')::uuid,nullif(v_match->>'winnerAdvancesToSlot','')::smallint,
      nullif(v_match->>'loserAdvancesToMatchId','')::uuid,nullif(v_match->>'loserAdvancesToSlot','')::smallint,
      coalesce(v_match->'resultSummary','{}'::jsonb),(select auth.uid())
    );
  end loop;

  for v_match in select value from jsonb_array_elements(p_matches)
  loop
    for v_participant in select value from jsonb_array_elements(coalesce(v_match->'participants','[]'::jsonb))
    loop
      v_roster:=nullif(v_participant->>'rosterEntryId','')::uuid;
      if v_roster is not null and not private.roster_entry_is_eligible(v_roster,v_event_id) then
        raise exception 'Bracket contains a competitor who is not cleared under the active ruleset';
      end if;
      insert into public.match_participants(match_id,roster_entry_id,side_index,seed,is_placeholder,placeholder_label,source_match_id,source_slot,is_winner_source)
      values(
        (v_match->>'id')::uuid,v_roster,(v_participant->>'sideIndex')::smallint,nullif(v_participant->>'seed','')::integer,
        coalesce((v_participant->>'isPlaceholder')::boolean,false),v_participant->>'placeholderLabel',
        nullif(v_participant->>'sourceMatchId','')::uuid,nullif(v_participant->>'sourceSlot','')::smallint,
        nullif(v_participant->>'isWinnerSource','')::boolean
      );
    end loop;
  end loop;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_event.organization_id,v_event_id,(select auth.uid()),'brackets',v_bracket_id,'create_bracket',jsonb_build_object('matchCount',jsonb_array_length(p_matches)));

  return v_bracket_id;
end;
$$;

-- Operation IDs make queued writes safe to retry after reconnects.
create policy sync_operations_self_insert on public.sync_operations for insert to authenticated
with check (user_id=(select auth.uid()));
create policy sync_operations_self_update on public.sync_operations for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant insert,update on public.sync_operations to authenticated;

create or replace function public.set_match_status_idempotent(
  p_operation_id uuid,
  p_match_id uuid,
  p_status public.match_status,
  p_expected_status public.match_status
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.sync_operations%rowtype;
  result_status public.match_status;
  result_json jsonb;
begin
  select * into existing from public.sync_operations where operation_id=p_operation_id for update;
  if found and existing.user_id is distinct from (select auth.uid()) then raise exception 'Operation ID belongs to another user'; end if;
  if found and existing.operation_type<>'set_match_status' then raise exception 'Operation ID type mismatch'; end if;
  if found and existing.state='completed' then return existing.result; end if;

  if not found then
    insert into public.sync_operations(operation_id,user_id,operation_type,entity_type,entity_id)
    values(p_operation_id,(select auth.uid()),'set_match_status','match',p_match_id);
  end if;

  result_status:=public.set_match_status(p_match_id,p_status,p_expected_status);
  result_json:=jsonb_build_object('status',result_status);
  update public.sync_operations set state='completed',result=result_json,completed_at=timezone('utc',now()) where operation_id=p_operation_id;
  return result_json;
end;
$$;

create or replace function public.reorder_match_idempotent(
  p_operation_id uuid,
  p_match_id uuid,
  p_direction integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.sync_operations%rowtype;
  result_json jsonb := jsonb_build_object('ok',true);
begin
  select * into existing from public.sync_operations where operation_id=p_operation_id for update;
  if found and existing.user_id is distinct from (select auth.uid()) then raise exception 'Operation ID belongs to another user'; end if;
  if found and existing.operation_type<>'reorder_match' then raise exception 'Operation ID type mismatch'; end if;
  if found and existing.state='completed' then return existing.result; end if;

  if not found then
    insert into public.sync_operations(operation_id,user_id,operation_type,entity_type,entity_id)
    values(p_operation_id,(select auth.uid()),'reorder_match','match',p_match_id);
  end if;

  perform public.reorder_match(p_match_id,p_direction);
  update public.sync_operations set state='completed',result=result_json,completed_at=timezone('utc',now()) where operation_id=p_operation_id;
  return result_json;
end;
$$;

create or replace function public.submit_match_result_idempotent(
  p_operation_id uuid,
  p_match_id uuid,
  p_rounds jsonb,
  p_forfeit_side smallint default null,
  p_forfeit_reason text default null,
  p_expected_status public.match_status default 'scheduled'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.sync_operations%rowtype;
  result_json jsonb;
begin
  select * into existing from public.sync_operations where operation_id=p_operation_id for update;
  if found and existing.user_id is distinct from (select auth.uid()) then raise exception 'Operation ID belongs to another user'; end if;
  if found and existing.operation_type<>'submit_match_result' then raise exception 'Operation ID type mismatch'; end if;
  if found and existing.state='completed' then return existing.result; end if;

  if not found then
    insert into public.sync_operations(operation_id,user_id,operation_type,entity_type,entity_id)
    values(p_operation_id,(select auth.uid()),'submit_match_result','match',p_match_id);
  end if;

  result_json:=public.submit_match_result(p_match_id,p_rounds,p_forfeit_side,p_forfeit_reason,p_expected_status);
  update public.sync_operations set state='completed',result=result_json,completed_at=timezone('utc',now()) where operation_id=p_operation_id;
  return result_json;
end;
$$;

revoke execute on function public.set_match_status_idempotent(uuid,uuid,public.match_status,public.match_status) from public,anon;
revoke execute on function public.reorder_match_idempotent(uuid,uuid,integer) from public,anon;
revoke execute on function public.submit_match_result_idempotent(uuid,uuid,jsonb,smallint,text,public.match_status) from public,anon;
grant execute on function public.set_match_status_idempotent(uuid,uuid,public.match_status,public.match_status) to authenticated;
grant execute on function public.reorder_match_idempotent(uuid,uuid,integer) to authenticated;
grant execute on function public.submit_match_result_idempotent(uuid,uuid,jsonb,smallint,text,public.match_status) to authenticated;

alter table public.event_ruleset_snapshots enable row level security;
alter table public.season_ruleset_snapshots enable row level security;

create policy event_ruleset_snapshots_read on public.event_ruleset_snapshots for select to authenticated using (
  exists(select 1 from public.events e where e.id=event_id and (
    private.has_org_role((select auth.uid()),e.organization_id,array['organization_admin','organization_staff']::public.organization_role[])
    or private.user_has_permission((select auth.uid()),'event.view_private',e.organization_id,e.id,null)
  ))
);

create policy season_ruleset_snapshots_read on public.season_ruleset_snapshots for select to authenticated using (
  exists(select 1 from public.seasons s where s.id=season_id and private.has_org_role((select auth.uid()),s.organization_id,array['organization_admin','organization_staff']::public.organization_role[]))
);

grant select on public.event_ruleset_snapshots,public.season_ruleset_snapshots to authenticated;
