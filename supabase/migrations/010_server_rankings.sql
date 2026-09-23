/*
  Reproducible server-side Elo ranking publication.
  Historical snapshots store the exact formula configuration used at publication time.
*/

create index if not exists matches_season_finalized_idx on public.matches(season_id,status,finalized_at) where status='finalized';

create or replace function public.rebuild_elo_ranking(p_config_id uuid)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_config public.ranking_configs%rowtype;
  v_snapshot_id uuid;
  v_initial numeric;
  v_k numeric;
  v_provisional_k numeric;
  v_provisional_matches integer;
  v_minimum integer;
  v_match record;
  v_rating_a numeric;
  v_rating_b numeric;
  v_matches_a integer;
  v_matches_b integer;
  v_expected_a numeric;
  v_expected_b numeric;
  v_actual_a numeric;
  v_actual_b numeric;
  v_k_a numeric;
  v_k_b numeric;
  v_previous_snapshot uuid;
begin
  select * into v_config from public.ranking_configs where id=p_config_id for update;
  if not found then raise exception 'Ranking configuration not found'; end if;
  if v_config.organization_id is null then raise exception 'This ranking builder requires an organization-scoped configuration'; end if;
  if not private.can_manage_org(v_config.organization_id) then raise exception 'Not authorized to publish this ranking'; end if;
  if coalesce(v_config.formula->>'type','')<>'elo' then raise exception 'This function only publishes Elo ranking configurations'; end if;

  v_initial:=coalesce((v_config.formula->>'initialRating')::numeric,1500);
  v_k:=coalesce((v_config.formula->>'kFactor')::numeric,32);
  v_provisional_k:=coalesce((v_config.formula->>'provisionalKFactor')::numeric,v_k);
  v_provisional_matches:=coalesce((v_config.formula->>'provisionalMatches')::integer,0);
  v_minimum:=greatest(v_config.minimum_matches,0);

  if v_initial<=0 or v_k<=0 or v_provisional_k<=0 then raise exception 'Ranking formula contains invalid rating constants'; end if;

  create temporary table if not exists pg_temp.buhurt_ratings(
    fighter_id uuid primary key,
    rating numeric not null,
    matches integer not null default 0,
    wins integer not null default 0,
    losses integer not null default 0,
    draws integer not null default 0
  ) on commit drop;
  truncate pg_temp.buhurt_ratings;

  for v_match in
    select
      m.id,
      m.result_summary,
      r1.fighter_id as fighter_a,
      r2.fighter_id as fighter_b
    from public.matches m
    join public.events e on e.id=m.event_id
    join public.match_participants p1 on p1.match_id=m.id and p1.side_index=1 and not p1.is_placeholder
    join public.match_participants p2 on p2.match_id=m.id and p2.side_index=2 and not p2.is_placeholder
    join public.event_roster_entries r1 on r1.id=p1.roster_entry_id
    join public.event_roster_entries r2 on r2.id=p2.roster_entry_id
    where m.season_id=v_config.season_id
      and m.organization_id=v_config.organization_id
      and m.status='finalized'
      and e.event_type='ranked_competitive'
      and coalesce(m.result_summary->>'resultType','')<>'bye'
      and r1.fighter_id is not null
      and r2.fighter_id is not null
      and r1.fighter_id<>r2.fighter_id
      and (v_config.discipline_key is null or m.match_type=v_config.discipline_key or m.category=v_config.discipline_key)
    order by coalesce(m.finalized_at,m.completed_at,m.created_at),m.id
  loop
    insert into pg_temp.buhurt_ratings(fighter_id,rating) values(v_match.fighter_a,v_initial) on conflict do nothing;
    insert into pg_temp.buhurt_ratings(fighter_id,rating) values(v_match.fighter_b,v_initial) on conflict do nothing;

    select rating,matches into v_rating_a,v_matches_a from pg_temp.buhurt_ratings where fighter_id=v_match.fighter_a;
    select rating,matches into v_rating_b,v_matches_b from pg_temp.buhurt_ratings where fighter_id=v_match.fighter_b;

    v_expected_a:=1/(1+power(10,(v_rating_b-v_rating_a)/400));
    v_expected_b:=1-v_expected_a;
    if nullif(v_match.result_summary->>'winnerSide','')::integer=1 then
      v_actual_a:=1;v_actual_b:=0;
    elsif nullif(v_match.result_summary->>'winnerSide','')::integer=2 then
      v_actual_a:=0;v_actual_b:=1;
    else
      v_actual_a:=0.5;v_actual_b:=0.5;
    end if;
    v_k_a:=case when v_matches_a<v_provisional_matches then v_provisional_k else v_k end;
    v_k_b:=case when v_matches_b<v_provisional_matches then v_provisional_k else v_k end;

    update pg_temp.buhurt_ratings
    set rating=rating+v_k_a*(v_actual_a-v_expected_a),
        matches=matches+1,
        wins=wins+case when v_actual_a=1 then 1 else 0 end,
        losses=losses+case when v_actual_a=0 then 1 else 0 end,
        draws=draws+case when v_actual_a=0.5 then 1 else 0 end
    where fighter_id=v_match.fighter_a;

    update pg_temp.buhurt_ratings
    set rating=rating+v_k_b*(v_actual_b-v_expected_b),
        matches=matches+1,
        wins=wins+case when v_actual_b=1 then 1 else 0 end,
        losses=losses+case when v_actual_b=0 then 1 else 0 end,
        draws=draws+case when v_actual_b=0.5 then 1 else 0 end
    where fighter_id=v_match.fighter_b;
  end loop;

  select id into v_previous_snapshot
  from public.ranking_snapshots
  where ranking_config_id=p_config_id
  order by calculated_at desc
  limit 1;

  insert into public.ranking_snapshots(ranking_config_id,organization_id,season_id,formula_snapshot,source_cutoff)
  values(p_config_id,v_config.organization_id,v_config.season_id,v_config.formula,timezone('utc',now()))
  returning id into v_snapshot_id;

  insert into public.ranking_snapshot_entries(snapshot_id,fighter_id,rank,rating,previous_rank,matches_counted,points,explanation)
  select
    v_snapshot_id,
    r.fighter_id,
    row_number() over(order by (r.matches>=v_minimum) desc,r.rating desc,r.matches desc,r.fighter_id),
    round(r.rating,4),
    previous.rank,
    r.matches,
    null,
    jsonb_build_object(
      'eligible',r.matches>=v_minimum,
      'matches',r.matches,
      'wins',r.wins,
      'losses',r.losses,
      'draws',r.draws,
      'minimumMatches',v_minimum
    )
  from pg_temp.buhurt_ratings r
  left join public.ranking_snapshot_entries previous
    on previous.snapshot_id=v_previous_snapshot and previous.fighter_id=r.fighter_id
  order by (r.matches>=v_minimum) desc,r.rating desc,r.matches desc,r.fighter_id;

  insert into public.audit_log(organization_id,actor_user_id,table_name,record_id,action,payload)
  values(v_config.organization_id,(select auth.uid()),'ranking_snapshots',v_snapshot_id,'publish_ranking',jsonb_build_object('configId',p_config_id,'entryCount',(select count(*) from pg_temp.buhurt_ratings)));

  return v_snapshot_id;
end;
$$;

revoke execute on function public.rebuild_elo_ranking(uuid) from public,anon;
grant execute on function public.rebuild_elo_ranking(uuid) to authenticated;
