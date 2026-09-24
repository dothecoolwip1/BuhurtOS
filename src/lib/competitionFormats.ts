import type { ScoringConfig } from '../types';

export type CompetitionFamily = 'duel' | 'melee' | 'combined' | 'special';
export type FormatSupportLevel = 'verified' | 'configurable' | 'custom_template';

export interface CompetitionFormatPreset {
  id: string;
  name: string;
  family: CompetitionFamily;
  matchType: string;
  scoringConfig: ScoringConfig;
  teamSize?: number;
  supportLevel: FormatSupportLevel;
  sourceFamily: 'BI-current' | 'organization-defined';
  description: string;
}

const duel = (roundsRequired = 3): ScoringConfig => ({
  kind: 'duel',
  roundsRequired,
  allowDrawRound: false,
  requireReasonOnForfeit: true
});

const melee = (teamSize: number): ScoringConfig => ({
  kind: 'team_fight',
  roundsRequired: 3,
  winsRequired: 2,
  allowDrawRound: false,
  teamFightMode: 'round_wins',
  requireReasonOnForfeit: true
});

export const competitionFormats: CompetitionFormatPreset[] = [
  { id:'longsword', name:'Longsword', family:'duel', matchType:'longsword', scoringConfig:duel(), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI duel category. Exact scoring comes from the selected sourced ruleset version.' },
  { id:'sword_buckler', name:'Sword & Buckler', family:'duel', matchType:'sword_buckler', scoringConfig:{...duel(),kind:'sword_buckler'}, supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI duel category. Exact scoring comes from the selected sourced ruleset version.' },
  { id:'sword_shield', name:'Sword & Shield', family:'duel', matchType:'sword_shield', scoringConfig:duel(), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI duel category. Exact scoring comes from the selected sourced ruleset version.' },
  { id:'polearm', name:'Polearm', family:'duel', matchType:'polearm', scoringConfig:duel(), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI duel category. Exact scoring comes from the selected sourced ruleset version.' },
  { id:'3v3', name:'3v3 Melee', family:'melee', matchType:'3v3', teamSize:3, scoringConfig:melee(3), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI team-melee category. Exact round and advancement rules come from the selected sourced ruleset.' },
  { id:'5v5', name:'5v5 Melee', family:'melee', matchType:'5v5', teamSize:5, scoringConfig:melee(5), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI team-melee category. Exact round and advancement rules come from the selected sourced ruleset.' },
  { id:'12v12', name:'12v12 Melee', family:'melee', matchType:'12v12', teamSize:12, scoringConfig:melee(12), supportLevel:'verified', sourceFamily:'BI-current', description:'Current BI team-melee category. Exact round and advancement rules come from the selected sourced ruleset.' },
  { id:'outrance', name:'Outrance', family:'special', matchType:'outrance', scoringConfig:duel(), supportLevel:'configurable', sourceFamily:'BI-current', description:'BI format recognized. BuhurtOS requires an explicit sourced ruleset before exact scoring is treated as authoritative.' },
  { id:'sword_sword', name:'Sword & Sword', family:'duel', matchType:'sword_sword', scoringConfig:duel(), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Organization template. Do not present as a current BI category unless a sourced ruleset defines it.' },
  { id:'saber', name:'Sabre', family:'duel', matchType:'saber', scoringConfig:duel(), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Organization template. Exact scoring must be sourced by the organization.' },
  { id:'two_handed', name:'Two-Handed Weapon', family:'duel', matchType:'two_handed', scoringConfig:duel(), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Organization template. Exact scoring must be sourced by the organization.' },
  { id:'profight', name:'ProFight', family:'special', matchType:'profight', scoringConfig:duel(), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Organization template. Exact scoring and eligibility must be defined by the selected ruleset.' },
  { id:'triathlon', name:'Triathlon', family:'combined', matchType:'triathlon', scoringConfig:duel(), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Combined-format template. Phases and scoring must be defined by the selected ruleset.' },
  { id:'marathon', name:'Marathon', family:'special', matchType:'marathon', scoringConfig:duel(1), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Endurance template. Duration and scoring must be defined by the selected ruleset.' },
  { id:'10v10', name:'10v10 Melee', family:'melee', matchType:'10v10', teamSize:10, scoringConfig:melee(10), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Team-melee template. Use only when the selected ruleset explicitly defines it.' },
  { id:'16v16', name:'16v16 Melee', family:'melee', matchType:'16v16', teamSize:16, scoringConfig:melee(16), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Team-melee template. Use only when the selected ruleset explicitly defines it.' },
  { id:'21v21', name:'21v21 Melee', family:'melee', matchType:'21v21', teamSize:21, scoringConfig:melee(21), supportLevel:'custom_template', sourceFamily:'organization-defined', description:'Team-melee template. Use only when the selected ruleset explicitly defines it.' }
];

export const verifiedCompetitionFormats = competitionFormats.filter(format => format.supportLevel === 'verified');

export function competitionFormatById(id:string): CompetitionFormatPreset {
  return competitionFormats.find(format=>format.id===id) ?? competitionFormats[0];
}
