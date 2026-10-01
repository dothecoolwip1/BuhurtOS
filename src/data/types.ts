import type { TierName } from '../lib/tournament';

export type LeagueId = 'buhurt' | 'duels' | 'outrance';
export const LEAGUE_NAME: Record<LeagueId, string> = { buhurt: 'Group fight', duels: 'Duels', outrance: 'Profight' };

export type CrestDivision = 'pale' | 'fess' | 'bend' | 'chevron' | 'quarterly' | 'saltire';

export interface Team {
  id: string;
  name: string;
  place: string;
  colors: [string, string];
  division: CrestDivision;
  initial: string;
  points: number;
  record: [number, number];
}

export interface EventSummary {
  id: string;
  month: string;
  day: string;
  year: string;
  name: string;
  meta: string[];
  leagues: LeagueId[];
  tier: TierName | 'Practice' | 'Matched fights';
  badges: { tone: ChipTone; label: string }[];
  /** Only some sample events have a full hub. */
  hasHub: boolean;
}

export type ChipTone = '' | 'live' | 'win' | 'steel' | 'brass';

export interface Competition {
  id: string;
  name: string;
  league: LeagueId;
  tier: string;
  division: string;
  entrants: string;
  structure: string;
  status: { tone: ChipTone; label: string };
}

export interface BracketMatch {
  id: string;
  a?: string;
  b?: string;
  rounds?: [number, number];
  status: 'done' | 'live' | 'next';
  note: string;
}
export interface BracketRound { name: string; when: string; matches: BracketMatch[] }

export interface StandingRow { name: string; subtitle?: string; teamId?: string; wins: number; losses: number; metric: string }

export interface ProBout { no: string; weight: string; a: string; b: string; winner?: string; result: string; note: string }

export interface QueueSlot { kind: 'now' | 'deck' | 'hole'; label: string; teamA?: string; teamB?: string; score?: string; sub: string }
export interface FieldQueue { name: string; slots: QueueSlot[] }

export interface ScheduleItem { time: string; state: '' | 'on' | 'done'; title: string; text: string }

export interface Duelist { name: string; club: string }
