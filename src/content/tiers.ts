import type { TierName } from '../lib/tournament';

/** League Structure V2026.1 §2.3. */
export interface TierInfo {
  name: TierName;
  pointsGiven: string;
  submitDays: string;
  marshals: string;
  groupEntrants: string;
  duelEntrants: string;
  video: string;
  note: string;
}
export const TIERS: TierInfo[] = [
  { name: 'Exhibition', pointsGiven: 'No points', submitDays: 'No submission needed', marshals: 'None required', groupEntrants: 'No minimum', duelEntrants: 'No minimum', video: 'Not required', note: 'Promotion only. Can be a small festival where one club attends for fun fights.' },
  { name: 'Source', pointsGiven: '50%', submitDays: '45 days', marshals: '1 Regional-accredited marshal (National Org may waive)', groupEntrants: '3 or more teams (3v3 or 5v5)', duelEntrants: '3 or more duellists per category', video: 'Not stated', note: 'For developing regions. BI Committee approval needed. No Division 1 teams.' },
  { name: 'Classic', pointsGiven: '100%', submitDays: '45 days', marshals: '1 Conference-accredited marshal (waiver may be requested)', groupEntrants: '4 registered men\'s 5v5 teams, or 3 women\'s', duelEntrants: '6 men or 3 women per category, from at least 2 clubs', video: 'Video recording; livestream recommended', note: 'Division 1, Division 2 or Open.' },
  { name: 'Regional', pointsGiven: '150%', submitDays: '90 days', marshals: '1 International-accredited and 2 Regional-accredited marshals', groupEntrants: '8 registered men\'s 5v5 teams, or 5 women\'s', duelEntrants: '8 men or 5 women per category, from at least 3 clubs', video: 'Video required; livestream recommended', note: 'One per region, or two if over 80 competitors are registered there.' },
  { name: 'Conference', pointsGiven: '200%', submitDays: '120 days', marshals: '3 International-accredited marshals', groupEntrants: '10 men\'s teams (8 with Council approval), or 7 women\'s (5)', duelEntrants: '10 men or 7 women per category, from at least 5 clubs', video: 'Livestream and recording mandatory', note: 'One per conference. Needs 60/40 approval from the National Orgs in that conference.' }
];
