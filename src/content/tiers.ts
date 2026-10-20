import { TIER_MULTIPLIER, type MultiplierSource, type TierName } from '../lib/tournament';

/** League Structure V2026.1 §2.3. Points are not stored here: they come from TIER_MULTIPLIER, so the tier table and the calculator always agree. */
export interface TierInfo {
  name: TierName;
  submitDays: string;
  marshals: string;
  groupEntrants: string;
  duelEntrants: string;
  video: string;
  note: string;
}
export const TIERS: TierInfo[] = [
  { name: 'Exhibition', submitDays: 'No submission needed', marshals: 'None required', groupEntrants: 'No minimum', duelEntrants: 'No minimum', video: 'Not required', note: 'Promotion only. Can be a small festival where one club attends for fun fights.' },
  { name: 'Source', submitDays: '45 days', marshals: '1 Regional-accredited marshal (National Org may waive)', groupEntrants: '3 or more teams (3v3 or 5v5)', duelEntrants: '3 or more duellists per category', video: 'Not stated', note: 'For developing regions. BI Committee approval needed. No Division 1 teams.' },
  { name: 'Classic', submitDays: '45 days', marshals: '1 Conference-accredited marshal (waiver may be requested)', groupEntrants: '4 registered men\'s 5v5 teams, or 3 women\'s', duelEntrants: '6 men or 3 women per category, from at least 2 clubs', video: 'Video recording; livestream recommended', note: 'Division 1, Division 2 or Open.' },
  { name: 'Regional', submitDays: '90 days', marshals: '1 International-accredited and 2 Regional-accredited marshals', groupEntrants: '8 registered men\'s 5v5 teams, or 5 women\'s', duelEntrants: '8 men or 5 women per category, from at least 3 clubs', video: 'Video required; livestream recommended', note: 'One per region, or two if over 80 competitors are registered there.' },
  { name: 'Conference', submitDays: '120 days', marshals: '3 International-accredited marshals', groupEntrants: '10 men\'s teams (8 with Council approval), or 7 women\'s (5)', duelEntrants: '10 men or 7 women per category, from at least 5 clubs', video: 'Livestream and recording mandatory', note: 'One per conference. Needs 60/40 approval from the National Orgs in that conference.' }
];

/** The two documents that set tier points. Neither is treated as the official choice until the owner decides. */
export const MULTIPLIER_SOURCES: readonly (readonly [MultiplierSource, string])[] = [
  ['tournamentStructure', 'Tournament Structure §4.2'],
  ['leagueStructure', 'League Structure §2.3']
];
export const sourceLabel = (s: MultiplierSource) => MULTIPLIER_SOURCES.find(([k]) => k === s)?.[1] ?? s;

/** Share of points a tier awards under one source, e.g. "125%". */
export function tierPoints(tier: TierName, source: MultiplierSource): string {
  const m = TIER_MULTIPLIER[source][tier];
  return m === 0 ? 'No points' : `${Math.round(m * 100)}%`;
}
/** True when the two sources give a tier different points. */
export const tierDisputed = (tier: TierName) => TIER_MULTIPLIER.tournamentStructure[tier] !== TIER_MULTIPLIER.leagueStructure[tier];
