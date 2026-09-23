import { describe, expect, it } from 'vitest';
import { validateScore } from '../src/lib/scoring';
import { checkCompliance } from '../src/lib/compliance';
import { advanceWinner, generateSingleElimination, placeSeedsAntiFratricide } from '../src/lib/bracket';
import { computeEventStandings } from '../src/lib/standings';
import { resolveStreamEmbed } from '../src/lib/stream';
import { computePoolStandings, generateSeededPools } from '../src/lib/pools';
import { computeEloRankings } from '../src/lib/ranking';
import { detectScheduleConflicts } from '../src/lib/schedule';
import { findDuplicateCandidates, nameSimilarity } from '../src/lib/duplicates';
import { calculateFighterStatistics, calculateHeadToHead } from '../src/lib/sportsAnalytics';
import type { EventRecord, MatchRecord, RosterEntry } from '../src/types';

const roster = (id:string,name:string,teamId:string):RosterEntry=>({
  id,organizationId:'org',eventId:'event',teamId,entryType:'fighter',displayName:name,
  checkedIn:true,armorCleared:true,medicalCleared:true,waiverConfirmed:true,weighInCleared:true,attendanceStatus:'approved'
});
const entries=[
  {entry:roster('a','A','red'),seed:1},{entry:roster('b','B','red'),seed:2},
  {entry:roster('c','C','blue'),seed:3},{entry:roster('d','D','blue'),seed:4},
  {entry:roster('e','E','green'),seed:5}
];
const scoring={kind:'duel' as const,roundsRequired:3,allowDrawRound:false,scoreCapPerRound:10};

describe('scoring',()=>{
  it('validates complete duel scores',()=>{
    const result=validateScore(scoring,[
      {roundNumber:1,side1Score:3,side2Score:1},{roundNumber:2,side1Score:2,side2Score:4},{roundNumber:3,side1Score:5,side2Score:2}
    ]);
    expect(result.valid).toBe(true); expect(result.result?.winnerSide).toBe(1); expect(result.result?.side1Total).toBe(10);
  });
  it('rejects capped and tied rounds when disallowed',()=>{
    const result=validateScore({kind:'sword_buckler',roundsRequired:2,allowDrawRound:false,scoreCapPerRound:5},[
      {roundNumber:1,side1Score:6,side2Score:1},{roundNumber:2,side1Score:2,side2Score:2}
    ]);
    expect(result.valid).toBe(false); expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
  it('requires forfeit reasons when configured',()=>{
    expect(validateScore({...scoring,requireReasonOnForfeit:true},[],{side:1,reason:''}).valid).toBe(false);
  });
});

describe('eligibility and brackets',()=>{
  it('blocks uncleared competitors',()=>{
    const result=checkCompliance({...roster('x','Blocked','x'),armorCleared:false});
    expect(result.eligible).toBe(false); expect(result.missing).toContain('armor clearance');
  });
  it('separates same team seeds when practical',()=>{
    const slots=placeSeedsAntiFratricide(entries);
    const red=slots.map((v,i)=>v?.entry.teamId==='red'?i:-1).filter(i=>i>=0);
    expect(Math.floor(red[0]/2)).not.toBe(Math.floor(red[1]/2));
  });
  it('generates and advances an eight slot bracket',()=>{
    const generated=generateSingleElimination({organizationId:'org',seasonId:'season',eventId:'event',fightCardId:'card',bracketId:'bracket',category:'Duel',matchType:'duel',entries,scoringConfig:scoring});
    expect(generated.size).toBe(8); expect(generated.matches).toHaveLength(7);
    const first=generated.matches.find(m=>m.winnerAdvancesToMatchId&&m.participants.some(p=>p.rosterEntryId))!;
    const winner=first.participants.find(p=>p.rosterEntryId)!.rosterEntryId!;
    const advanced=advanceWinner(generated.matches,first.id,winner);
    expect(advanced.find(m=>m.id===first.winnerAdvancesToMatchId)?.participants.some(p=>p.rosterEntryId===winner)).toBe(true);
  });
  it('auto finalizes byes without creating empty opening matches',()=>{
    const generated=generateSingleElimination({organizationId:'org',seasonId:'season',eventId:'event',bracketId:'five',category:'Duel',matchType:'duel',entries,scoringConfig:scoring});
    const opening=generated.matches.filter(m=>m.bracketRound===1);
    expect(opening.every(m=>m.participants.some(p=>p.rosterEntryId))).toBe(true);
    expect(opening.filter(m=>m.resultSummary?.resultType==='bye')).toHaveLength(3);
  });
});

describe('pools and standings',()=>{
  it('creates balanced snake pools',()=>{
    const pools=generateSeededPools(entries,2);
    expect(pools).toHaveLength(2);
    expect(pools.flatMap(p=>p.entries)).toHaveLength(entries.length);
    expect(new Set(pools.flatMap(p=>p.entries.map(e=>e.entry.id))).size).toBe(entries.length);
  });
  it('uses head to head before score differential when configured',()=>{
    const match:MatchRecord={
      id:'pool-1',organizationId:'org',seasonId:'season',eventId:'event',label:'Pool',category:'Duel',matchType:'duel',scoringConfig:scoring,
      status:'finalized',stage:'pool',scheduledOrder:1,participants:[{rosterEntryId:'a',sideIndex:1},{rosterEntryId:'c',sideIndex:2}],rounds:[],
      resultSummary:{winnerSide:1,side1Total:2,side2Total:1,roundsWonSide1:2,roundsWonSide2:1,resultType:'points'}
    };
    const rows=computePoolStandings({entries:[entries[0],entries[2]],matches:[match]});
    expect(rows[0].rosterEntryId).toBe('a'); expect(rows[0].standingPoints).toBe(3);
  });
  it('computes event standings only from finalized matches',()=>{
    const event:EventRecord={id:'event',organizationId:'org',seasonId:'season',name:'Event',venue:'Venue',startsAt:'2026-09-20T00:00:00Z',endsAt:'2026-09-21T00:00:00Z',eventType:'ranked_competitive',standingsMode:'season_and_event',status:'completed',timezone:'UTC'};
    const match:MatchRecord={id:'m',organizationId:'org',seasonId:'season',eventId:'event',label:'M',category:'Duel',matchType:'duel',scoringConfig:scoring,status:'finalized',stage:'pool',scheduledOrder:1,participants:[{rosterEntryId:'a',sideIndex:1},{rosterEntryId:'c',sideIndex:2}],rounds:[],resultSummary:{winnerSide:1,side1Total:5,side2Total:3,roundsWonSide1:2,roundsWonSide2:1,resultType:'points'}};
    expect(computeEventStandings(event,[match],entries.map(e=>e.entry))[0].rosterEntryId).toBe('a');
  });
});

describe('rankings',()=>{
  it('updates both competitors symmetrically and exposes contributions',()=>{
    const match:MatchRecord={id:'rank-1',organizationId:'org',seasonId:'season',eventId:'event',label:'M',category:'Duel',matchType:'duel',scoringConfig:scoring,status:'finalized',stage:'bracket',scheduledOrder:1,participants:[{rosterEntryId:'a',sideIndex:1},{rosterEntryId:'c',sideIndex:2}],rounds:[],resultSummary:{winnerSide:1,side1Total:1,side2Total:0,roundsWonSide1:1,roundsWonSide2:0,resultType:'points'}};
    const result=computeEloRankings([match],{initialRating:1500,kFactor:32,minimumMatches:1});
    expect(result[0].rating).toBeGreaterThan(1500); expect(result[1].rating).toBeLessThan(1500);
    expect(result[0].contributions).toHaveLength(1);
    expect(Math.round(result[0].rating+result[1].rating)).toBe(3000);
  });
});

describe('schedule safety',()=>{
  it('detects participant and ring overlaps',()=>{
    const conflicts=detectScheduleConflicts([
      {id:'a',startsAt:'2026-09-20T10:00:00Z',endsAt:'2026-09-20T10:10:00Z',ringId:'r1',participantIds:['f1','f2']},
      {id:'b',startsAt:'2026-09-20T10:05:00Z',endsAt:'2026-09-20T10:15:00Z',ringId:'r1',participantIds:['f1','f3']}
    ]);
    expect(conflicts.map(c=>c.reason)).toEqual(expect.arrayContaining(['participant_overlap','ring_overlap']));
  });
  it('allows adjacent assignments with no overlap',()=>{
    expect(detectScheduleConflicts([
      {id:'a',startsAt:'2026-09-20T10:00:00Z',endsAt:'2026-09-20T10:10:00Z',participantIds:['f1']},
      {id:'b',startsAt:'2026-09-20T10:10:00Z',endsAt:'2026-09-20T10:20:00Z',participantIds:['f1']}
    ])).toHaveLength(0);
  });
});

describe('duplicate management helpers',()=>{
  it('normalizes punctuation and accents',()=>expect(nameSimilarity('Garrett R.','Garrett R')).toBe(1));
  it('flags likely duplicate identities without merging them automatically',()=>{
    const candidates=findDuplicateCandidates([{id:'1',name:'Garrett Robson',secondary:'Red Deer'},{id:'2',name:'Garret Robson',secondary:'Red Deer'},{id:'3',name:'Bob Mercer',secondary:'Edmonton'}],0.75);
    expect(candidates[0].leftId).toBe('1'); expect(candidates[0].rightId).toBe('2'); expect(candidates).toHaveLength(1);
  });
});

describe('safe livestreams',()=>{
  it('embeds supported HTTPS video URLs only',()=>{
    expect(resolveStreamEmbed('https://youtu.be/dQw4w9WgXcQ')?.embedUrl).toContain('youtube.com/embed/');
    expect(resolveStreamEmbed('http://example.com/not-safe')).toBeNull();
  });
});


describe('official sporting analytics',()=>{
  const officialMatches:MatchRecord[]=[
    {id:'s1',organizationId:'org',seasonId:'season',eventId:'event',label:'A vs C',category:'Duel',matchType:'duel',scoringConfig:scoring,status:'finalized',stage:'bracket',scheduledOrder:1,validationStatus:'final',participants:[{rosterEntryId:'a',sideIndex:1},{rosterEntryId:'c',sideIndex:2}],rounds:[],resultSummary:{winnerSide:1,side1Total:5,side2Total:3,roundsWonSide1:2,roundsWonSide2:1,resultType:'points'}},
    {id:'s2',organizationId:'org',seasonId:'season',eventId:'event',label:'A vs C disputed',category:'Duel',matchType:'duel',scoringConfig:scoring,status:'finalized',stage:'bracket',scheduledOrder:2,validationStatus:'disputed',participants:[{rosterEntryId:'a',sideIndex:1},{rosterEntryId:'c',sideIndex:2}],rounds:[],resultSummary:{winnerSide:2,side1Total:2,side2Total:4,roundsWonSide1:0,roundsWonSide2:2,resultType:'points'}}
  ];
  it('counts accepted results and ignores disputed history',()=>{
    const stats=calculateFighterStatistics('fighter-a',officialMatches,[
      {...roster('a','A','red'),fighterId:'fighter-a'},
      {...roster('c','C','blue'),fighterId:'fighter-c'}
    ]);
    expect(stats.matches).toBe(1);expect(stats.wins).toBe(1);expect(stats.pointDifferential).toBe(2);
  });
  it('builds head to head from the same official source of truth',()=>{
    const h2h=calculateHeadToHead('fighter-a','fighter-c',officialMatches,[
      {...roster('a','A','red'),fighterId:'fighter-a'},
      {...roster('c','C','blue'),fighterId:'fighter-c'}
    ]);
    expect(h2h.meetings).toBe(1);expect(h2h.leftWins).toBe(1);expect(h2h.rightWins).toBe(0);
  });
});
