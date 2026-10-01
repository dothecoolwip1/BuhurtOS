import type { LeagueId } from '../data/types';

export interface League { id: LeagueId; name: string; tag: string; summary: string; categories: string[] }

/** Buhurt Rules V.26.4.1 §1.2; Duels rules V.26.4; Outrance Rules V.26.4. */
export const LEAGUES: League[] = [
  { id: 'buhurt', name: 'Buhurt', tag: 'Group fight', summary: 'Teams fight at the same time on one list. A fighter is out when grounded, and a team wins when every opposing fighter is grounded.', categories: ['3v3', '5v5', '12v12', '30v30'] },
  { id: 'duels', name: 'Duels', tag: 'One on one', summary: 'Two fighters, no weight classes. Line marshals count clean blade strikes, and each of the four categories scores differently.', categories: ['Sword & Shield', 'Sword & Buckler', 'Longsword', 'Polearm'] },
  { id: 'outrance', name: 'Profight', tag: 'Outrance', summary: 'Full-contact bouts with strikes, grappling and takedowns, judged round by round on the 10-point must system and fought in weight classes.', categories: ['Men: 6 classes', 'Women: 5 classes', 'Division 1 and 2'] }
];
