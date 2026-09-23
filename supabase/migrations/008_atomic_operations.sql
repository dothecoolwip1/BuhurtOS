/*
  Atomic operational commands for pool planning, result validation, and identity merges.
*/

create or replace function public.replace_division_pools(
  p_event_id uuid,
  p_division_id uuid,
  p_pools jsonb
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_pool jsonb;
  v_entry jsonb;
  v_pool_id uuid;
  v_event public.events%rowtype;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not private.can_manage_event(p_event_id) then raise exception 'Not authorized to manage pools'; end if;
  if not exists(select 1 from public.event_divisions where id=p_division_id and event_id=p_event_id) then raise exception 'Division does not belong to this event'; end if;
  if jsonb_typeof(p_pools)<>'array' or jsonb_array_length(p_pools)<1 then raise exception 'Pool plan is empty'; end if;

  if exists(
    select 1 from public.matches m
    join public.pools p on p.id=m.pool_id
    where p.division_id=p_division_id and m.status not in ('cancelled')
  ) then
    raise exception 'Pools cannot be regenerated after matches have been created. Correct the existing pool plan instead.';
  end if;

  delete from public.pools where division_id=p_division_id;

  for v_pool in select value from jsonb_array_elements(p_pools) loop
    if coalesce(trim(v_pool->>'name'),'')='' then raise exception 'Pool name is required'; end if;
    insert into public.pools(event_id,division_id,name,advancement_count,standings_config,created_by)
    values(
      p_event_id,
      p_division_id,
      trim(v_pool->>'name'),
      greatest(coalesce((v_pool->>'advancementCount')::integer,0),0),
      '{"winPoints":3,"drawPoints":1,"tieBreakers":["standing_points","head_to_head","round_differential","score_differential","score_for","seed"]}'::jsonb,
      (select auth.uid())
    )
    returning id into v_pool_id;

    if jsonb_typeof(coalesce(v_pool->'entries','[]'::jsonb))<>'array' then raise exception 'Pool entries must be an array'; end if;
    for v_entry in select value from jsonb_array_elements(coalesce(v_pool->'entries','[]'::jsonb)) loop
      if not exists(
        select 1 from public.event_roster_entries r
        where r.id=(v_entry->>'rosterEntryId')::uuid
          and r.event_id=p_event_id
          and r.can_compete
          and r.attendance_status not in ('withdrawn','no_show')
      ) then
        raise exception 'Pool includes a competitor who is not cleared for this event';
      end if;
      insert into public.pool_entries(pool_id,roster_entry_id,seed)
      values(v_pool_id,(v_entry->>'rosterEntryId')::uuid,(v_entry->>'seed')::integer);
    end loop;
  end loop;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_event.organization_id,p_event_id,(select auth.uid()),'pools',p_division_id,'replace_division_pools',jsonb_build_object('poolCount',jsonb_array_length(p_pools)));
end;
$$;
revoke execute on function public.replace_division_pools(uuid,uuid,jsonb) from public,anon;
grant execute on function public.replace_division_pools(uuid,uuid,jsonb) to authenticated;

create or replace function public.set_match_validation_status(
  p_match_id uuid,
  p_status public.validation_status,
  p_expected_status public.validation_status,
  p_reason text default null
)
returns public.validation_status
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_match public.matches%rowtype;
begin
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.validation_status<>p_expected_status then raise exception 'Validation status changed since this match was loaded'; end if;

  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_match.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_match.event_id,array['event_organizer','field_marshal']::public.event_role[])
  ) then raise exception 'Not authorized to validate results'; end if;

  if p_status in ('validated','final') and v_match.status<>'finalized' then
    raise exception 'Only finalized match scores can be validated';
  end if;
  if p_status='final' and v_match.validation_status not in ('validated','corrected') then
    raise exception 'A result must be validated or corrected before it becomes final';
  end if;
  if p_status in ('disputed','corrected') and coalesce(trim(p_reason),'')='' then
    raise exception 'A reason is required for a dispute or correction';
  end if;

  insert into public.match_validation_history(match_id,status,result_snapshot,reason,actor_user_id)
  values(p_match_id,p_status,coalesce(v_match.result_summary,'{}'::jsonb),nullif(trim(p_reason),''),(select auth.uid()));

  update public.matches
  set validation_status=p_status,last_edited_by=(select auth.uid())
  where id=p_match_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values(v_match.organization_id,v_match.event_id,(select auth.uid()),'matches',p_match_id,'validation_status',jsonb_build_object('from',v_match.validation_status,'to',p_status,'reason',nullif(trim(p_reason),'')));

  return p_status;
end;
$$;
revoke execute on function public.set_match_validation_status(uuid,public.validation_status,public.validation_status,text) from public,anon;
grant execute on function public.set_match_validation_status(uuid,public.validation_status,public.validation_status,text) to authenticated;

create or replace function public.merge_fighter_profiles(
  p_source_id uuid,
  p_target_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_source public.fighters%rowtype;
  v_target public.fighters%rowtype;
  v_source_private public.fighter_private_profiles%rowtype;
  v_target_private public.fighter_private_profiles%rowtype;
begin
  if p_source_id=p_target_id then raise exception 'Source and target fighters must be different'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Merge reason is required'; end if;

  select * into v_source from public.fighters where id=p_source_id for update;
  select * into v_target from public.fighters where id=p_target_id for update;
  if not found or v_source.id is null or v_target.id is null then raise exception 'Both fighters must exist'; end if;
  if v_source.organization_id<>v_target.organization_id then raise exception 'Cross organization fighter merges require platform migration tooling'; end if;
  if not (private.is_platform_admin((select auth.uid())) or private.has_org_role((select auth.uid()),v_target.organization_id,array['organization_admin']::public.organization_role[])) then
    raise exception 'Not authorized to merge fighters';
  end if;
  if v_source.user_id is not null and v_target.user_id is not null and v_source.user_id<>v_target.user_id then
    raise exception 'Both fighter profiles are claimed by different user accounts. Resolve ownership before merging.';
  end if;

  insert into public.merge_history(entity_type,source_id,target_id,source_snapshot,target_snapshot_before,reason,merged_by)
  values('fighter',p_source_id,p_target_id,to_jsonb(v_source),to_jsonb(v_target),trim(p_reason),(select auth.uid()));

  update public.fighters
  set user_id=coalesce(v_target.user_id,v_source.user_id),
      nickname=coalesce(v_target.nickname,v_source.nickname),
      avatar_path=coalesce(v_target.avatar_path,v_source.avatar_path),
      bio=coalesce(v_target.bio,v_source.bio),
      country_code=coalesce(v_target.country_code,v_source.country_code),
      province_state=coalesce(v_target.province_state,v_source.province_state),
      city=coalesce(v_target.city,v_source.city),
      nationality=coalesce(v_target.nationality,v_source.nationality),
      weight_kg=coalesce(v_target.weight_kg,v_source.weight_kg),
      height_cm=coalesce(v_target.height_cm,v_source.height_cm),
      experience_started_on=coalesce(v_target.experience_started_on,v_source.experience_started_on),
      social_links=coalesce(v_target.social_links,'{}'::jsonb)||coalesce(v_source.social_links,'{}'::jsonb),
      last_edited_by=(select auth.uid())
  where id=p_target_id;

  select * into v_source_private from public.fighter_private_profiles where fighter_id=p_source_id;
  select * into v_target_private from public.fighter_private_profiles where fighter_id=p_target_id;
  if v_source_private.fighter_id is not null then
    insert into public.fighter_private_profiles(fighter_id,legal_name,date_of_birth,email,phone,emergency_contact,medical_notes,insurance_details,guardian_details,youth_profile,updated_by)
    values(
      p_target_id,
      coalesce(v_target_private.legal_name,v_source_private.legal_name),
      coalesce(v_target_private.date_of_birth,v_source_private.date_of_birth),
      coalesce(v_target_private.email,v_source_private.email),
      coalesce(v_target_private.phone,v_source_private.phone),
      coalesce(v_target_private.emergency_contact,v_source_private.emergency_contact),
      coalesce(v_target_private.medical_notes,v_source_private.medical_notes),
      coalesce(v_target_private.insurance_details,v_source_private.insurance_details),
      coalesce(v_target_private.guardian_details,v_source_private.guardian_details),
      coalesce(v_target_private.youth_profile,false) or coalesce(v_source_private.youth_profile,false),
      (select auth.uid())
    )
    on conflict(fighter_id) do update set
      legal_name=coalesce(public.fighter_private_profiles.legal_name,excluded.legal_name),
      date_of_birth=coalesce(public.fighter_private_profiles.date_of_birth,excluded.date_of_birth),
      email=coalesce(public.fighter_private_profiles.email,excluded.email),
      phone=coalesce(public.fighter_private_profiles.phone,excluded.phone),
      emergency_contact=coalesce(public.fighter_private_profiles.emergency_contact,excluded.emergency_contact),
      medical_notes=coalesce(public.fighter_private_profiles.medical_notes,excluded.medical_notes),
      insurance_details=coalesce(public.fighter_private_profiles.insurance_details,excluded.insurance_details),
      guardian_details=coalesce(public.fighter_private_profiles.guardian_details,excluded.guardian_details),
      youth_profile=public.fighter_private_profiles.youth_profile or excluded.youth_profile,
      updated_by=(select auth.uid());
    delete from public.fighter_private_profiles where fighter_id=p_source_id;
  end if;

  update public.event_roster_entries set fighter_id=p_target_id,last_edited_by=(select auth.uid()) where fighter_id=p_source_id;
  update public.disciplinary_cards set fighter_id=p_target_id where fighter_id=p_source_id;
  update public.fighter_affiliations set fighter_id=p_target_id where fighter_id=p_source_id;

  update public.team_rosters s
  set ends_at=greatest(s.starts_at,timezone('utc',now()))
  where s.fighter_id=p_source_id and s.ends_at is null
    and exists(select 1 from public.team_rosters t where t.fighter_id=p_target_id and t.team_id=s.team_id and t.roster_role=s.roster_role and t.ends_at is null);
  update public.team_rosters set fighter_id=p_target_id where fighter_id=p_source_id;

  insert into public.fighter_achievements(fighter_id,achievement_id,event_id,season_id,earned_at,source_data)
  select p_target_id,achievement_id,event_id,season_id,earned_at,source_data
  from public.fighter_achievements where fighter_id=p_source_id
  on conflict do nothing;
  delete from public.fighter_achievements where fighter_id=p_source_id;

  insert into public.video_fighters(video_id,fighter_id)
  select video_id,p_target_id from public.video_fighters where fighter_id=p_source_id
  on conflict do nothing;
  delete from public.video_fighters where fighter_id=p_source_id;

  delete from public.ranking_snapshot_entries s
  where s.fighter_id=p_source_id
    and exists(select 1 from public.ranking_snapshot_entries t where t.snapshot_id=s.snapshot_id and t.fighter_id=p_target_id);
  update public.ranking_snapshot_entries set fighter_id=p_target_id where fighter_id=p_source_id;

  update public.fighter_claims s set status='withdrawn',review_notes=coalesce(review_notes,'')||' Superseded during profile merge.',reviewed_at=timezone('utc',now())
  where s.fighter_id=p_source_id and s.status in ('submitted','needs_information')
    and exists(select 1 from public.fighter_claims t where t.fighter_id=p_target_id and t.claimant_user_id=s.claimant_user_id and t.status in ('submitted','needs_information'));
  update public.fighter_claims set fighter_id=p_target_id where fighter_id=p_source_id;

  update public.fighters
  set is_active=false,public_visibility=false,deleted_at=timezone('utc',now()),user_id=null,team_id=null,notes=coalesce(notes,'')||' Merged into fighter '||p_target_id::text,last_edited_by=(select auth.uid())
  where id=p_source_id;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(v_target.organization_id,(select auth.uid()),'fighters',p_target_id,'merge_fighter',jsonb_build_object('sourceId',p_source_id,'reason',trim(p_reason)));

  return p_target_id;
end;
$$;
revoke execute on function public.merge_fighter_profiles(uuid,uuid,text) from public,anon;
grant execute on function public.merge_fighter_profiles(uuid,uuid,text) to authenticated;
