/*
  Public sporting analytics are derived from accepted official results.
  These functions intentionally expose aggregate competition facts only.
*/

create or replace function public.get_fighter_statistics(p_fighter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with facts as (
  select
    m.id as match_id,
    m.event_id,
    m.completed_at,
    m.finalized_at,
    m.result_summary,
    me.side_index,
    opp.fighter_id as opponent_id,
    coalesce(m.result_summary->>'winnerSide','') as winner_side,
    coalesce((m.result_summary->>'side1Total')::numeric,0) as side1_total,
    coalesce((m.result_summary->>'side2Total')::numeric,0) as side2_total,
    coalesce((m.result_summary->>'roundsWonSide1')::integer,0) as rounds1,
    coalesce((m.result_summary->>'roundsWonSide2')::integer,0) as rounds2
  from public.matches m
  join public.match_participants me on me.match_id=m.id and not me.is_placeholder
  join public.event_roster_entries my_entry on my_entry.id=me.roster_entry_id and my_entry.fighter_id=p_fighter_id
  join public.match_participants them on them.match_id=m.id and them.side_index<>me.side_index and not them.is_placeholder
  join public.event_roster_entries opp on opp.id=them.roster_entry_id
  join public.events e on e.id=m.event_id
  where m.status='finalized'
    and m.validation_status='final'
    and e.status in ('completed','archived','live')
    and coalesce(m.result_summary->>'resultType','')<>'bye'
),
agg as (
  select
    count(*)::integer as matches,
    count(*) filter(where winner_side=side_index::text)::integer as wins,
    count(*) filter(where winner_side in ('1','2') and winner_side<>side_index::text)::integer as losses,
    count(*) filter(where winner_side='' or winner_side is null)::integer as draws,
    coalesce(sum(case when side_index=1 then rounds1 else rounds2 end),0)::integer as rounds_won,
    coalesce(sum(case when side_index=1 then rounds2 else rounds1 end),0)::integer as rounds_lost,
    coalesce(sum(case when side_index=1 then side1_total else side2_total end),0) as points_for,
    coalesce(sum(case when side_index=1 then side2_total else side1_total end),0) as points_against,
    count(distinct event_id)::integer as event_appearances,
    count(distinct opponent_id)::integer as unique_opponents,
    max(coalesce(finalized_at,completed_at)) as last_competition
  from facts
)
select jsonb_build_object(
  'fighterId',p_fighter_id,
  'matches',matches,
  'wins',wins,
  'losses',losses,
  'draws',draws,
  'winPercentage',case when matches>0 then round((wins::numeric/matches::numeric)*100,2) else 0 end,
  'roundsWon',rounds_won,
  'roundsLost',rounds_lost,
  'roundDifferential',rounds_won-rounds_lost,
  'pointsFor',points_for,
  'pointsAgainst',points_against,
  'pointDifferential',points_for-points_against,
  'eventAppearances',event_appearances,
  'uniqueOpponents',unique_opponents,
  'lastCompetition',last_competition
)
from agg;
$$;

revoke execute on function public.get_fighter_statistics(uuid) from public;
grant execute on function public.get_fighter_statistics(uuid) to anon,authenticated;

create or replace function public.get_fighter_head_to_head(p_left uuid,p_right uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with meetings as (
  select
    m.id,
    m.event_id,
    e.name as event_name,
    coalesce(m.finalized_at,m.completed_at) as occurred_at,
    left_p.side_index as left_side,
    right_p.side_index as right_side,
    m.result_summary,
    m.video_url
  from public.matches m
  join public.events e on e.id=m.event_id
  join public.match_participants left_p on left_p.match_id=m.id and not left_p.is_placeholder
  join public.event_roster_entries left_e on left_e.id=left_p.roster_entry_id and left_e.fighter_id=p_left
  join public.match_participants right_p on right_p.match_id=m.id and right_p.side_index<>left_p.side_index and not right_p.is_placeholder
  join public.event_roster_entries right_e on right_e.id=right_p.roster_entry_id and right_e.fighter_id=p_right
  where m.status='finalized'
    and m.validation_status='final'
    and coalesce(m.result_summary->>'resultType','')<>'bye'
),
summary as (
  select
    count(*)::integer as meetings,
    count(*) filter(where result_summary->>'winnerSide'=left_side::text)::integer as left_wins,
    count(*) filter(where result_summary->>'winnerSide'=right_side::text)::integer as right_wins,
    count(*) filter(where coalesce(result_summary->>'winnerSide','')='')::integer as draws,
    coalesce(sum(case when left_side=1 then (result_summary->>'roundsWonSide1')::integer else (result_summary->>'roundsWonSide2')::integer end),0)::integer as left_rounds,
    coalesce(sum(case when right_side=1 then (result_summary->>'roundsWonSide1')::integer else (result_summary->>'roundsWonSide2')::integer end),0)::integer as right_rounds,
    coalesce(sum(case when left_side=1 then (result_summary->>'side1Total')::numeric else (result_summary->>'side2Total')::numeric end),0) as left_score,
    coalesce(sum(case when right_side=1 then (result_summary->>'side1Total')::numeric else (result_summary->>'side2Total')::numeric end),0) as right_score,
    max(occurred_at) as latest_meeting
  from meetings
)
select jsonb_build_object(
  'leftFighterId',p_left,
  'rightFighterId',p_right,
  'meetings',meetings,
  'leftWins',left_wins,
  'rightWins',right_wins,
  'draws',draws,
  'leftRounds',left_rounds,
  'rightRounds',right_rounds,
  'leftScore',left_score,
  'rightScore',right_score,
  'latestMeeting',latest_meeting,
  'matches',coalesce((
    select jsonb_agg(jsonb_build_object(
      'matchId',id,
      'eventId',event_id,
      'eventName',event_name,
      'occurredAt',occurred_at,
      'leftSide',left_side,
      'rightSide',right_side,
      'result',result_summary,
      'videoUrl',video_url
    ) order by occurred_at desc)
    from meetings
  ),'[]'::jsonb)
)
from summary;
$$;

revoke execute on function public.get_fighter_head_to_head(uuid,uuid) from public;
grant execute on function public.get_fighter_head_to_head(uuid,uuid) to anon,authenticated;

create or replace function public.get_team_statistics(p_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with facts as (
  select
    m.id,
    m.event_id,
    team_participant.side_index,
    m.result_summary
  from public.matches m
  join public.match_participants team_participant on team_participant.match_id=m.id and not team_participant.is_placeholder
  join public.event_roster_entries entry on entry.id=team_participant.roster_entry_id and entry.team_id=p_team_id
  where m.status='finalized'
    and m.validation_status='final'
    and coalesce(m.result_summary->>'resultType','')<>'bye'
),
dedup as (
  select distinct on(id) * from facts order by id
)
select jsonb_build_object(
  'teamId',p_team_id,
  'matches',count(*)::integer,
  'wins',count(*) filter(where result_summary->>'winnerSide'=side_index::text)::integer,
  'losses',count(*) filter(where result_summary->>'winnerSide' in ('1','2') and result_summary->>'winnerSide'<>side_index::text)::integer,
  'draws',count(*) filter(where coalesce(result_summary->>'winnerSide','')='')::integer,
  'eventAppearances',count(distinct event_id)::integer,
  'winPercentage',case when count(*)>0 then round((count(*) filter(where result_summary->>'winnerSide'=side_index::text)::numeric/count(*)::numeric)*100,2) else 0 end
)
from dedup;
$$;

revoke execute on function public.get_team_statistics(uuid) from public;
grant execute on function public.get_team_statistics(uuid) to anon,authenticated;
