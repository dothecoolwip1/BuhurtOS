/*
  Double-elimination loser progression and conditional grand-final reset.
  Winner advancement remains in submit_match_result; this trigger handles the paths
  that only exist for double elimination.
*/

create or replace function private.advance_double_elimination_paths()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_winner_side smallint;
  v_loser_side smallint;
  v_loser_entry uuid;
  v_side1_entry uuid;
  v_side2_entry uuid;
  v_reset_id uuid;
begin
  if new.status <> 'finalized' or old.status = 'finalized' then return new; end if;
  v_winner_side := nullif(new.result_summary->>'winnerSide','')::smallint;
  if v_winner_side is null then return new; end if;
  v_loser_side := case when v_winner_side=1 then 2 else 1 end;

  if new.loser_advances_to_match_id is not null and new.loser_advances_to_slot is not null then
    select roster_entry_id into v_loser_entry
    from public.match_participants
    where match_id=new.id and side_index=v_loser_side and roster_entry_id is not null;

    if v_loser_entry is not null then
      delete from public.match_participants
      where match_id=new.loser_advances_to_match_id and side_index=new.loser_advances_to_slot;

      insert into public.match_participants(match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder)
      values(new.loser_advances_to_match_id,v_loser_entry,new.loser_advances_to_slot,new.id,new.loser_advances_to_slot,false,false);

      insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
      values(new.organization_id,new.event_id,(select auth.uid()),'matches',new.id,'advance_loser',
        jsonb_build_object('targetMatchId',new.loser_advances_to_match_id,'rosterEntryId',v_loser_entry));
    end if;
  end if;

  if new.bracket_slot='GF' then
    select id into v_reset_id
    from public.matches
    where bracket_id=new.bracket_id and bracket_slot='GF-RESET'
    limit 1
    for update;

    if v_reset_id is not null then
      if v_winner_side=2 then
        select roster_entry_id into v_side1_entry from public.match_participants where match_id=new.id and side_index=1;
        select roster_entry_id into v_side2_entry from public.match_participants where match_id=new.id and side_index=2;
        if v_side1_entry is null or v_side2_entry is null then
          raise exception 'Grand final reset cannot be activated without both finalists';
        end if;
        delete from public.match_participants where match_id=v_reset_id;
        insert into public.match_participants(match_id,roster_entry_id,side_index,source_match_id,source_slot,is_winner_source,is_placeholder)
        values
          (v_reset_id,v_side1_entry,1,new.id,1,false,false),
          (v_reset_id,v_side2_entry,2,new.id,2,true,false);
        update public.matches set status='scheduled',last_edited_by=(select auth.uid()) where id=v_reset_id;
        insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
        values(new.organization_id,new.event_id,(select auth.uid()),'matches',v_reset_id,'activate_grand_final_reset',
          jsonb_build_object('sourceMatchId',new.id));
      else
        update public.matches set status='cancelled',last_edited_by=(select auth.uid()) where id=v_reset_id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists advance_double_elimination_paths on public.matches;
create trigger advance_double_elimination_paths
after update of status,result_summary on public.matches
for each row
when (new.status='finalized' and old.status is distinct from new.status)
execute function private.advance_double_elimination_paths();
