import type { MatchRecord, RosterEntry } from '../types';

export interface PoolSeed {
  entry: RosterEntry;
  seed: number;
}

export interface PoolGroup {
  id: string;
  name: string;
  entries: PoolSeed[];
}

export type PoolTieBreaker = 'standing_points' | 'head_to_head' | 'round_differential' | 'score_differential' | 'score_for' | 'seed';

export interface PoolStanding {
  rosterEntryId: string;
  name: string;
  seed: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  standingPoints: number;
  roundsFor: number;
  roundsAgainst: number;
  roundDifferential: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifferential: number;
}

export function generateSeededPools(entries: PoolSeed[], poolCount: number): PoolGroup[] {
  if (!Number.isInteger(poolCount) || poolCount < 1) throw new Error('Pool count must be at least one.');
  if (entries.length < poolCount) throw new Error('Each pool must contain at least one competitor.');

  const ordered = [...entries].sort((a,b) => a.seed - b.seed || a.entry.displayName.localeCompare(b.entry.displayName));
  const pools: PoolGroup[] = Array.from({ length: poolCount }, (_,i) => ({ id: `pool-${i + 1}`, name: `Pool ${String.fromCharCode(65 + i)}`, entries: [] }));

  let direction = 1;
  let index = 0;
  for (const candidate of ordered) {
    pools[index].entries.push(candidate);
    if (poolCount === 1) continue;
    if (direction === 1 && index === poolCount - 1) direction = -1;
    else if (direction === -1 && index === 0) direction = 1;
    else index += direction;
  }

  // Minimize same-team opening concentration without destroying seed balance.
  for (let pass = 0; pass < 32; pass += 1) {
    let improved = false;
    const cost = () => pools.reduce((sum,pool) => {
      const teams = new Map<string,number>();
      for (const item of pool.entries) if (item.entry.teamId) teams.set(item.entry.teamId,(teams.get(item.entry.teamId) ?? 0) + 1);
      return sum + [...teams.values()].reduce((s,count) => s + Math.max(0,count - 1) ** 2,0);
    },0);
    const base = cost();
    outer: for (let a=0;a<pools.length;a++) {
      for (let b=a+1;b<pools.length;b++) {
        for (let ai=0;ai<pools[a].entries.length;ai++) {
          for (let bi=0;bi<pools[b].entries.length;bi++) {
            const left=pools[a].entries[ai], right=pools[b].entries[bi];
            if (Math.abs(left.seed-right.seed) > poolCount) continue;
            [pools[a].entries[ai],pools[b].entries[bi]]=[right,left];
            if (cost() < base) { improved=true; break outer; }
            [pools[a].entries[ai],pools[b].entries[bi]]=[left,right];
          }
        }
      }
    }
    if (!improved) break;
  }
  for (const pool of pools) pool.entries.sort((a,b)=>a.seed-b.seed);
  return pools;
}

function headToHeadWinner(a:string,b:string,matches:MatchRecord[]): string | null {
  for (const match of matches) {
    if (match.status !== 'finalized' || !match.resultSummary?.winnerSide) continue;
    const p1=match.participants.find(p=>p.sideIndex===1)?.rosterEntryId;
    const p2=match.participants.find(p=>p.sideIndex===2)?.rosterEntryId;
    if (!p1 || !p2 || !((p1===a&&p2===b)||(p1===b&&p2===a))) continue;
    return match.resultSummary.winnerSide===1?p1:p2;
  }
  return null;
}

export function computePoolStandings(params:{
  entries: PoolSeed[];
  matches: MatchRecord[];
  winPoints?: number;
  drawPoints?: number;
  tieBreakers?: PoolTieBreaker[];
}): PoolStanding[] {
  const winPoints=params.winPoints ?? 3;
  const drawPoints=params.drawPoints ?? 1;
  const tieBreakers=params.tieBreakers ?? ['standing_points','head_to_head','round_differential','score_differential','score_for','seed'];
  const allowed=new Set(params.entries.map(e=>e.entry.id));
  const rows=new Map<string,PoolStanding>(params.entries.map(item=>[item.entry.id,{
    rosterEntryId:item.entry.id,name:item.entry.displayName,seed:item.seed,matches:0,wins:0,losses:0,draws:0,standingPoints:0,
    roundsFor:0,roundsAgainst:0,roundDifferential:0,scoreFor:0,scoreAgainst:0,scoreDifferential:0
  }]));

  const relevant=params.matches.filter(match=>{
    if (match.stage!=='pool'||match.status!=='finalized'||!match.resultSummary) return false;
    const ids=match.participants.filter(p=>p.rosterEntryId&&!p.isPlaceholder).map(p=>p.rosterEntryId!);
    return ids.length===2&&ids.every(id=>allowed.has(id));
  });

  for (const match of relevant) {
    const p1=match.participants.find(p=>p.sideIndex===1)?.rosterEntryId;
    const p2=match.participants.find(p=>p.sideIndex===2)?.rosterEntryId;
    if(!p1||!p2) continue;
    const a=rows.get(p1)!, b=rows.get(p2)!, r=match.resultSummary!;
    a.matches++; b.matches++;
    a.scoreFor+=r.side1Total; a.scoreAgainst+=r.side2Total;
    b.scoreFor+=r.side2Total; b.scoreAgainst+=r.side1Total;
    a.roundsFor+=r.roundsWonSide1; a.roundsAgainst+=r.roundsWonSide2;
    b.roundsFor+=r.roundsWonSide2; b.roundsAgainst+=r.roundsWonSide1;
    if(r.winnerSide===1){a.wins++;b.losses++;a.standingPoints+=winPoints;}
    else if(r.winnerSide===2){b.wins++;a.losses++;b.standingPoints+=winPoints;}
    else {a.draws++;b.draws++;a.standingPoints+=drawPoints;b.standingPoints+=drawPoints;}
  }

  const result=[...rows.values()].map(r=>({...r,roundDifferential:r.roundsFor-r.roundsAgainst,scoreDifferential:r.scoreFor-r.scoreAgainst}));
  result.sort((a,b)=>{
    for(const rule of tieBreakers){
      let diff=0;
      if(rule==='standing_points') diff=b.standingPoints-a.standingPoints;
      else if(rule==='head_to_head' && a.standingPoints===b.standingPoints){
        const winner=headToHeadWinner(a.rosterEntryId,b.rosterEntryId,relevant);
        if(winner===a.rosterEntryId) diff=-1;
        if(winner===b.rosterEntryId) diff=1;
      } else if(rule==='round_differential') diff=b.roundDifferential-a.roundDifferential;
      else if(rule==='score_differential') diff=b.scoreDifferential-a.scoreDifferential;
      else if(rule==='score_for') diff=b.scoreFor-a.scoreFor;
      else if(rule==='seed') diff=a.seed-b.seed;
      if(diff!==0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
  return result;
}
