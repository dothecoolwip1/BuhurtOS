import type { MatchRecord, RosterEntry } from '../types';

export interface FighterStatistics {
  fighterId:string;
  matches:number;
  wins:number;
  losses:number;
  draws:number;
  winPercentage:number;
  roundsWon:number;
  roundsLost:number;
  roundDifferential:number;
  pointsFor:number;
  pointsAgainst:number;
  pointDifferential:number;
  eventAppearances:number;
  uniqueOpponents:number;
}

export interface HeadToHeadSummary {
  leftFighterId:string;
  rightFighterId:string;
  meetings:number;
  leftWins:number;
  rightWins:number;
  draws:number;
  leftRounds:number;
  rightRounds:number;
  leftScore:number;
  rightScore:number;
  matches:Array<{matchId:string;eventId:string;winner:'left'|'right'|'draw';leftScore:number;rightScore:number}>;
}

function accepted(match:MatchRecord):boolean{
  return match.status==='finalized' && (match.validationStatus===undefined || match.validationStatus==='final');
}

function fighterSide(match:MatchRecord,fighterId:string,rosterById:Map<string,RosterEntry>):1|2|undefined{
  const participant=match.participants.find(p=>p.rosterEntryId&&rosterById.get(p.rosterEntryId)?.fighterId===fighterId);
  return participant?.sideIndex;
}

export function calculateFighterStatistics(fighterId:string,matches:MatchRecord[],roster:RosterEntry[]):FighterStatistics{
  const rosterById=new Map(roster.map(r=>[r.id,r]));
  let wins=0,losses=0,draws=0,roundsWon=0,roundsLost=0,pointsFor=0,pointsAgainst=0;
  const events=new Set<string>(),opponents=new Set<string>();
  let count=0;
  for(const match of matches){
    if(!accepted(match)||!match.resultSummary||match.resultSummary.resultType==='bye')continue;
    const side=fighterSide(match,fighterId,rosterById);
    if(!side)continue;
    const other=match.participants.find(p=>p.sideIndex!==side&&p.rosterEntryId)?.rosterEntryId;
    const otherFighter=other?rosterById.get(other)?.fighterId:undefined;
    if(otherFighter)opponents.add(otherFighter);
    count++;events.add(match.eventId);
    const result=match.resultSummary;
    if(result.winnerSide===side)wins++;
    else if(result.winnerSide===null)draws++;
    else losses++;
    if(side===1){
      roundsWon+=result.roundsWonSide1;roundsLost+=result.roundsWonSide2;pointsFor+=result.side1Total;pointsAgainst+=result.side2Total;
    }else{
      roundsWon+=result.roundsWonSide2;roundsLost+=result.roundsWonSide1;pointsFor+=result.side2Total;pointsAgainst+=result.side1Total;
    }
  }
  return {fighterId,matches:count,wins,losses,draws,winPercentage:count?Math.round(wins/count*10000)/100:0,roundsWon,roundsLost,roundDifferential:roundsWon-roundsLost,pointsFor,pointsAgainst,pointDifferential:pointsFor-pointsAgainst,eventAppearances:events.size,uniqueOpponents:opponents.size};
}

export function calculateHeadToHead(leftFighterId:string,rightFighterId:string,matches:MatchRecord[],roster:RosterEntry[]):HeadToHeadSummary{
  const rosterById=new Map(roster.map(r=>[r.id,r]));
  let leftWins=0,rightWins=0,draws=0,leftRounds=0,rightRounds=0,leftScore=0,rightScore=0;
  const rows:HeadToHeadSummary['matches']=[];
  for(const match of matches){
    if(!accepted(match)||!match.resultSummary||match.resultSummary.resultType==='bye')continue;
    const leftSide=fighterSide(match,leftFighterId,rosterById);
    const rightSide=fighterSide(match,rightFighterId,rosterById);
    if(!leftSide||!rightSide||leftSide===rightSide)continue;
    const result=match.resultSummary;
    const leftPoints=leftSide===1?result.side1Total:result.side2Total;
    const rightPoints=rightSide===1?result.side1Total:result.side2Total;
    const lRounds=leftSide===1?result.roundsWonSide1:result.roundsWonSide2;
    const rRounds=rightSide===1?result.roundsWonSide1:result.roundsWonSide2;
    let winner:'left'|'right'|'draw'='draw';
    if(result.winnerSide===leftSide){leftWins++;winner='left';}
    else if(result.winnerSide===rightSide){rightWins++;winner='right';}
    else draws++;
    leftScore+=leftPoints;rightScore+=rightPoints;leftRounds+=lRounds;rightRounds+=rRounds;
    rows.push({matchId:match.id,eventId:match.eventId,winner,leftScore:leftPoints,rightScore:rightPoints});
  }
  return {leftFighterId,rightFighterId,meetings:rows.length,leftWins,rightWins,draws,leftRounds,rightRounds,leftScore,rightScore,matches:rows};
}
