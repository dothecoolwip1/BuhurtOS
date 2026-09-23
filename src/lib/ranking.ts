import type { MatchRecord } from '../types';

export interface RankingConfig {
  initialRating: number;
  kFactor: number;
  minimumMatches: number;
  provisionalKFactor?: number;
  provisionalMatches?: number;
}

export interface RankingContribution {
  matchId: string;
  opponentId: string;
  before: number;
  expected: number;
  actual: number;
  delta: number;
  after: number;
}

export interface RankingResult {
  competitorId: string;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  eligible: boolean;
  contributions: RankingContribution[];
}

export function computeEloRankings(matches:MatchRecord[],config:RankingConfig):RankingResult[]{
  if(config.initialRating<=0||config.kFactor<=0||config.minimumMatches<0) throw new Error('Invalid ranking configuration.');
  const state=new Map<string,RankingResult>();
  const ensure=(id:string)=>{
    if(!state.has(id))state.set(id,{competitorId:id,rating:config.initialRating,matches:0,wins:0,losses:0,draws:0,eligible:false,contributions:[]});
    return state.get(id)!;
  };
  const ordered=[...matches].filter(m=>m.status==='finalized'&&m.resultSummary&&m.resultSummary.resultType!=='bye')
    .sort((a,b)=>(a.bracketRound??0)-(b.bracketRound??0)||a.scheduledOrder-b.scheduledOrder||a.id.localeCompare(b.id));

  for(const match of ordered){
    const p1=match.participants.find(p=>p.sideIndex===1&&!p.isPlaceholder)?.rosterEntryId;
    const p2=match.participants.find(p=>p.sideIndex===2&&!p.isPlaceholder)?.rosterEntryId;
    if(!p1||!p2)continue;
    const a=ensure(p1),b=ensure(p2);
    const beforeA=a.rating,beforeB=b.rating;
    const expectedA=1/(1+Math.pow(10,(beforeB-beforeA)/400));
    const expectedB=1-expectedA;
    const actualA=match.resultSummary!.winnerSide===1?1:match.resultSummary!.winnerSide===2?0:0.5;
    const actualB=1-actualA;
    const kA=a.matches<(config.provisionalMatches??0)?(config.provisionalKFactor??config.kFactor):config.kFactor;
    const kB=b.matches<(config.provisionalMatches??0)?(config.provisionalKFactor??config.kFactor):config.kFactor;
    const deltaA=kA*(actualA-expectedA),deltaB=kB*(actualB-expectedB);
    a.rating=beforeA+deltaA;b.rating=beforeB+deltaB;
    a.matches++;b.matches++;
    if(actualA===1){a.wins++;b.losses++;}else if(actualA===0){a.losses++;b.wins++;}else{a.draws++;b.draws++;}
    a.contributions.push({matchId:match.id,opponentId:p2,before:beforeA,expected:expectedA,actual:actualA,delta:deltaA,after:a.rating});
    b.contributions.push({matchId:match.id,opponentId:p1,before:beforeB,expected:expectedB,actual:actualB,delta:deltaB,after:b.rating});
  }
  for(const row of state.values())row.eligible=row.matches>=config.minimumMatches;
  return [...state.values()].sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.rating-a.rating||b.matches-a.matches||a.competitorId.localeCompare(b.competitorId));
}
