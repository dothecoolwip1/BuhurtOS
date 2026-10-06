import type { CompetitionMatch } from '../../data/matches';
import type { CareerLine } from '../../data/careerProfile';
import type { Team } from '../../data/types';
import { sideLabel } from '../entryLabel';
import { formatRecord } from '../broadcast/sides';
import { TBD, basisOf, lystLabel, scoreText, type AnnSide } from './viewModel';

/**
 * What the announcer sees when they tap a fighter or team: PUBLIC sporting facts only. Built by name from public records (the entry, the career
 * totals, this event's final matches); there is no field here that could hold an email, a phone number, an account id, an inspection or weigh-in
 * note, anything medical, an admin note or a readiness reason.
 */
export interface EarlierFight {
  matchId: string; competition: string; stage: string; lyst: string; opponent: string;
  outcome: 'Won' | 'Lost' | 'Drew'; scoreText: string | null; basis: string | null;
}
export interface EntryInfo {
  entryId: string; name: string; kind: 'fighter' | 'team';
  teamName: string | null; photoUrl: string | null; crest: Team | null;
  category: string | null; corner: 'RED' | 'BLUE' | null;
  career: { text: string; matches: number; events: number } | null;
  event: { text: string; wins: number; losses: number; draws: number };
  earlier: EarlierFight[];
  /** Synthetic / test data: the screen labels it "Test". */
  test: boolean;
}

export interface CareerTotal { wins: number; losses: number; draws: number; matches: number; events: number; test: boolean }
/** The all-time total row: the official one when there is one, else the labelled test one. */
export function careerTotal(lines: readonly Pick<CareerLine, 'context' | 'scope' | 'kind' | 'category' | 'wins' | 'losses' | 'draws' | 'matches' | 'events'>[] | null | undefined): CareerTotal | null {
  const total = (ctx: string) => (lines ?? []).find(r => r.context === ctx && r.scope === 'career' && r.kind === null && r.category === null);
  const o = total('official'), t = o ? undefined : total('test');
  const r = o ?? t;
  return r ? { wins: r.wins, losses: r.losses, draws: r.draws, matches: r.matches, events: r.events, test: !o } : null;
}

/** This event's final fights of one entry, oldest first, as that entry's own record of the day. */
export function earlierFights(entryId: string | readonly string[], matches: readonly CompetitionMatch[], competitions: readonly { id: string; name: string }[]): EarlierFight[] {
  const names = new Map(competitions.map(c => [c.id, c.name]));
  const mineIds = new Set(typeof entryId === 'string' ? [entryId] : entryId);
  return matches
    .filter(m => m.queueState === 'final' && m.entryA && m.entryB && (mineIds.has(m.entryA) || mineIds.has(m.entryB)))
    .sort((x, y) => (x.finalizedAt ?? '').localeCompare(y.finalizedAt ?? '') || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map(m => {
      const mine = mineIds.has(m.entryA as string) ? 'a' : 'b';
      const opp = mine === 'a' ? sideLabel(m.entryB, m.nameB, TBD) : sideLabel(m.entryA, m.nameA, TBD);
      const outcome: EarlierFight['outcome'] = m.result === 'draw' || !m.winnerEntryId ? 'Drew' : mineIds.has(m.winnerEntryId) ? 'Won' : 'Lost';
      const basis = basisOf(m.detail);
      const mineScore = mine === 'a' ? m.scoreA : m.scoreB, theirs = mine === 'a' ? m.scoreB : m.scoreA;
      return {
        matchId: m.id, competition: names.get(m.competitionId) ?? 'Competition', stage: m.pool ? `Pool ${m.pool} · ${m.roundLabel || m.stage}` : m.roundLabel || m.stage,
        lyst: lystLabel(m.field ?? 'Field 1'), opponent: opp, outcome, scoreText: basis === 'walkover' ? null : scoreText(mineScore, theirs), basis
      };
    });
}

export function buildEntryInfo(input: {
  side: AnnSide; competition: string | null;
  matches: readonly CompetitionMatch[]; competitions: readonly { id: string; name: string }[];
  career: readonly CareerLine[] | null | undefined;
  /** The event is a test event (its history is synthetic). */
  eventIsTest?: boolean;
  /** All entries of this fighter / team (other competitions at the same event); the entry shown is always included. */
  entryIds?: readonly string[] | null;
}): EntryInfo {
  const { side } = input;
  const entryId = side.entryId ?? '';
  const earlier = entryId ? earlierFights([...new Set([entryId, ...(input.entryIds ?? [])])], input.matches, input.competitions) : [];
  const wins = earlier.filter(f => f.outcome === 'Won').length, losses = earlier.filter(f => f.outcome === 'Lost').length, draws = earlier.filter(f => f.outcome === 'Drew').length;
  const total = careerTotal(input.career);
  return {
    entryId, name: side.name, kind: side.kind === 'team' ? 'team' : 'fighter',
    teamName: side.teamName, photoUrl: side.photoUrl, crest: side.crest,
    category: input.competition, corner: side.corner,
    career: total ? { text: formatRecord(total), matches: total.matches, events: total.events } : null,
    event: { text: earlier.length === 0 ? 'No fights finished yet' : formatRecord({ wins, losses, draws }), wins, losses, draws },
    earlier,
    test: !!input.eventIsTest || total?.test === true || side.recordIsTest
  };
}
