-- Double-elimination result propagation.
-- Replaces result submission with winner + loser advancement and grand-final reset handling.

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
  v_loser smallint := null;
  v_item jsonb;
  v_entry uuid;
  v_winner_entry uuid;
  v_loser_entry uuid;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status <> p_expected_status then raise exception 'Match changed since it was loaded'; end if;
  if v_match.status in ('finalized','cancelled') then raise exception 'Match is already closed'; end if;
  if v_match.status not in ('active','completed') then raise exception 'Match must be active before a result can be submitted'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()), v_match.organization_id, array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()), v_match.event_id, array['event_organizer','field_marshal','assistant_marshal']::public.event_role[])
  ) then
    raise exception 'Not authorized to score this match';
  end if;

  for v_entry in
    select roster_entry_id
    from public.match_participants
    where match_id = p_match_id and roster_entry_id is not null
  loop
    if not exists (
      select 1 from public.event_roster_entries where id = v_entry and can_compete
    ) then
      raise exception 'A match participant is not cleared to compete';
    end if;
  end loop;

  v_config := v_match.scoring_config;
  v_required := coalesce((v_config->>'roundsRequired')::integer, 1);
  v_allow_draw := coalesce((v_config->>'allowDrawRound')::boolean, false);
  v_cap := nullif(v_config->>'scoreCapPerRound','')::numeric;
  v_kind := coalesce(v_config->>'kind','duel');
  v_wins_required := coalesce((v_config->>'winsRequired')::integer, floor(v_required / 2.0)::integer + 1);

  if p_forfeit_side is not null then
    if p_forfeit_side not in (1,2) then raise exception 'Invalid forfeit side'; end if;
    if coalesce((v_config->>'requireReasonOnForfeit')::boolean, true)
      and length(trim(coalesce(p_forfeit_reason,''))) = 0
    then
      raise exception 'Forfeit reason is required';
    end if;
    v_winner := case when p_forfeit_side = 1 then 2 else 1 end;
    delete from public.match_rounds where match_id = p_match_id;
  else
    if jsonb_typeof(p_rounds) <> 'array' then raise exception 'Rounds must be an array'; end if;
    select jsonb_array_length(p_rounds) into v_count;
    if v_count <> v_required then raise exception 'Incorrect number of rounds'; end if;
    delete from public.match_rounds where match_id = p_match_id;

    for v_item in select value from jsonb_array_elements(p_rounds)
    loop
      if (v_item->>'roundNumber')::integer < 1 or (v_item->>'roundNumber')::integer > v_required then
        raise exception 'Round number outside configured range';
      end if;
      if (v_item->>'side1Score')::numeric < 0 or (v_item->>'side2Score')::numeric < 0 then
        raise exception 'Scores cannot be negative';
      end if;
      if v_cap is not null and (
        (v_item->>'side1Score')::numeric > v_cap
        or (v_item->>'side2Score')::numeric > v_cap
      ) then
        raise exception 'Score exceeds configured cap';
      end if;
      if not v_allow_draw and (v_item->>'side1Score')::numeric = (v_item->>'side2Score')::numeric then
        raise exception 'Tied round is not allowed';
      end if;

      insert into public.match_rounds(match_id,round_number,side_1_score,side_2_score,notes)
      values (
        p_match_id,
        (v_item->>'roundNumber')::integer,
        (v_item->>'side1Score')::numeric,
        (v_item->>'side2Score')::numeric,
        v_item->>'notes'
      );

      v_s1 := v_s1 + (v_item->>'side1Score')::numeric;
      v_s2 := v_s2 + (v_item->>'side2Score')::numeric;
      if (v_item->>'side1Score')::numeric > (v_item->>'side2Score')::numeric then
        v_w1 := v_w1 + 1;
      elsif (v_item->>'side2Score')::numeric > (v_item->>'side1Score')::numeric then
        v_w2 := v_w2 + 1;
      end if;
    end loop;

    if v_kind = 'team_fight' or v_config ? 'winsRequired' then
      if v_w1 >= v_wins_required then
        v_winner := 1;
      elsif v_w2 >= v_wins_required then
        v_winner := 2;
      elsif v_w1 <> v_w2 then
        v_winner := case when v_w1 > v_w2 then 1 else 2 end;
      end if;
    else
      if v_s1 > v_s2 then v_winner := 1;
      elsif v_s2 > v_s1 then v_winner := 2;
      end if;
    end if;
  end if;

  if v_winner is not null then
    v_loser := case when v_winner = 1 then 2 else 1 end;
    select roster_entry_id into v_winner_entry
    from public.match_participants
    where match_id = p_match_id and side_index = v_winner;

    select roster_entry_id into v_loser_entry
    from public.match_participants
    where match_id = p_match_id and side_index = v_loser;
  end if;

  update public.matches set
    status = 'finalized',
    completed_at = timezone('utc', now()),
    finalized_at = timezone('utc', now()),
    last_edited_by = (select auth.uid()),
    result_summary = jsonb_build_object(
      'winnerSide', v_winner,
      'side1Total', v_s1,
      'side2Total', v_s2,
      'roundsWonSide1', v_w1,
      'roundsWonSide2', v_w2,
      'resultType',
        case
          when p_forfeit_side is not null then 'forfeit'
          when v_winner is null then 'draw'
          when v_kind = 'team_fight' or v_config ? 'winsRequired' then 'rounds'
          else 'points'
        end,
      'forfeitReason', p_forfeit_reason
    )
  where id = p_match_id;

  if v_winner is not null then
    if v_match.bracket_slot = 'GF-1' and v_match.winner_advances_to_match_id is not null then
      if v_winner = 1 then
        update public.matches
        set status = 'cancelled', last_edited_by = (select auth.uid())
        where id = v_match.winner_advances_to_match_id;
      else
        update public.matches
        set status = 'scheduled', last_edited_by = (select auth.uid())
        where id = v_match.winner_advances_to_match_id;

        delete from public.match_participants
        where match_id = v_match.winner_advances_to_match_id
          and side_index in (v_match.winner_advances_to_slot, v_match.loser_advances_to_slot);

        insert into public.match_participants(
          match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder
        ) values (
          v_match.winner_advances_to_match_id,v_winner_entry,v_match.winner_advances_to_slot,
          p_match_id,v_match.winner_advances_to_slot,true,false
        );

        insert into public.match_participants(
          match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder
        ) values (
          v_match.loser_advances_to_match_id,v_loser_entry,v_match.loser_advances_to_slot,
          p_match_id,v_match.loser_advances_to_slot,false,false
        );
      end if;
    else
      if v_match.winner_advances_to_match_id is not null and v_winner_entry is not null then
        delete from public.match_participants
        where match_id = v_match.winner_advances_to_match_id
          and side_index = v_match.winner_advances_to_slot;

        insert into public.match_participants(
          match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder
        ) values (
          v_match.winner_advances_to_match_id,v_winner_entry,v_match.winner_advances_to_slot,
          p_match_id,v_match.winner_advances_to_slot,true,false
        );
      end if;

      if v_match.loser_advances_to_match_id is not null and v_loser_entry is not null then
        delete from public.match_participants
        where match_id = v_match.loser_advances_to_match_id
          and side_index = v_match.loser_advances_to_slot;

        insert into public.match_participants(
          match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder
        ) values (
          v_match.loser_advances_to_match_id,v_loser_entry,v_match.loser_advances_to_slot,
          p_match_id,v_match.loser_advances_to_slot,false,false
        );
      end if;
    end if;
  end if;

  insert into public.audit_log(
    organization_id,event_id,actor_user_id,table_name,record_id,action,payload
  ) values (
    v_match.organization_id,v_match.event_id,(select auth.uid()),
    'matches',p_match_id,'finalize_result',
    jsonb_build_object(
      'winnerSide',v_winner,
      'winnerAdvancedTo',v_match.winner_advances_to_match_id,
      'loserAdvancedTo',v_match.loser_advances_to_match_id
    )
  );

  return (select result_summary from public.matches where id = p_match_id);
end;
$$;

revoke execute on function public.submit_match_result(uuid,jsonb,smallint,text,public.match_status) from public, anon;
grant execute on function public.submit_match_result(uuid,jsonb,smallint,text,public.match_status) to authenticated;
