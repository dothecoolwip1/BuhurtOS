import type { ScoringConfig } from '../types';

export type CompetitionFamily = 'duel' | 'melee' | 'combined' | 'special';

export interface CompetitionFormatPreset {
  id: string;
  name: string;
  family: CompetitionFamily;
  matchType: string;
  scoringConfig: ScoringConfig;
  teamSize?: number;
  description: string;
}

export const competitionFormats: CompetitionFormatPreset[] = [
  { id:'longsword', name:'Longsword', family:'duel', matchType:'longsword', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one longsword division. Scoring remains ruleset-configurable.' },
  { id:'sword_buckler', name:'Sword & Buckler', family:'duel', matchType:'sword_buckler', scoringConfig:{kind:'sword_buckler',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one sword and buckler division.' },
  { id:'sword_shield', name:'Sword & Shield', family:'duel', matchType:'sword_shield', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one sword and shield division.' },
  { id:'sword_sword', name:'Sword & Sword', family:'duel', matchType:'sword_sword', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one dual sword division.' },
  { id:'saber', name:'Sabre', family:'duel', matchType:'saber', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one sabre division.' },
  { id:'polearm', name:'Polearm', family:'duel', matchType:'polearm', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one polearm division.' },
  { id:'two_handed', name:'Two-Handed Weapon', family:'duel', matchType:'two_handed', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'One-on-one two-handed weapon division.' },
  { id:'profight', name:'ProFight', family:'special', matchType:'profight', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'Configurable ProFight template. Organization rulesets determine exact scoring.' },
  { id:'triathlon', name:'Triathlon', family:'combined', matchType:'triathlon', scoringConfig:{kind:'duel',roundsRequired:3,allowDrawRound:false,requireReasonOnForfeit:true}, description:'Combined-format template whose phases are configured by the active ruleset.' },
  { id:'marathon', name:'Marathon', family:'special', matchType:'marathon', scoringConfig:{kind:'duel',roundsRequired:1,allowDrawRound:false,requireReasonOnForfeit:true}, description:'Marathon template with ruleset-defined scoring and duration.' },
  { id:'3v3', name:'3v3 Melee', family:'melee', matchType:'3v3', teamSize:3, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Three-fighter team melee.' },
  { id:'5v5', name:'5v5 Melee', family:'melee', matchType:'5v5', teamSize:5, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Five-fighter team melee.' },
  { id:'10v10', name:'10v10 Melee', family:'melee', matchType:'10v10', teamSize:10, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Ten-fighter team melee.' },
  { id:'12v12', name:'12v12 Melee', family:'melee', matchType:'12v12', teamSize:12, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Twelve-fighter team melee.' },
  { id:'16v16', name:'16v16 Melee', family:'melee', matchType:'16v16', teamSize:16, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Sixteen-fighter team melee.' },
  { id:'21v21', name:'21v21 Melee', family:'melee', matchType:'21v21', teamSize:21, scoringConfig:{kind:'team_fight',roundsRequired:3,winsRequired:2,allowDrawRound:false,teamFightMode:'round_wins',requireReasonOnForfeit:true}, description:'Twenty-one-fighter team melee.' }
];

export function competitionFormatById(id:string): CompetitionFormatPreset {
  return competitionFormats.find(format=>format.id===id) ?? competitionFormats[0];
}
