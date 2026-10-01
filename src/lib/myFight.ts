/**
 * Pure helpers for "My next fight": from the event's matches and the entry ids that belong to the signed-in person, work out
 * the next match, where it sits in the field queue, and the result so far. No database access and no invented facts: a position
 * is only given when the match is actually in a field's queue.
 */
import type { CompetitionMatch, QueueState } from '../data/matches';
import { fieldQueue } from './fieldScoring';
import { sideLabel } from './entryLabel';

export const TBD_OPPONENT = 'Opponent to be decided';

export interface NextFight {
  match: CompetitionMatch;
  /** The entry of the viewer's side. */
  myEntry: string;
  opponent: string;
  /** Matches ahead of this one on its field, or null when it is not in a field queue (not queued, or no field set). */
  ahead: number | null;
}
export interface FightResultLine { matchId: string; competitionId: string; roundLabel: string; opponent: string; outcome: 'won' | 'lost' | 'drawn'; mine: number | null; theirs: number | null }
export interface MyFightSummary {
  next: NextFight | null;
  results: FightResultLine[];
  wins: number; losses: number; draws: number;
  /** Matches in the event that involve one of the viewer's entries. */
  total: number;
}

const URGENCY: Record<QueueState, number> = { active: 0, on_deck: 1, in_the_hole: 2, scheduled: 3, final: 4 };

const isMine = (m: CompetitionMatch, ids: ReadonlySet<string>) => (m.entryA !== null && ids.has(m.entryA)) || (m.entryB !== null && ids.has(m.entryB));

function sides(m: CompetitionMatch, ids: ReadonlySet<string>) {
  const aMine = m.entryA !== null && ids.has(m.entryA);
  return aMine
    ? { myEntry: m.entryA!, opponent: sideLabel(m.entryB, m.nameB, TBD_OPPONENT), mine: m.scoreA, theirs: m.scoreB, iAm: 'a' as const }
    : { myEntry: m.entryB!, opponent: sideLabel(m.entryA, m.nameA, TBD_OPPONENT), mine: m.scoreB, theirs: m.scoreA, iAm: 'b' as const };
}

/**
 * The viewer's most pressing unfinished match (active, then on deck, in the hole, scheduled; ties by start time then position),
 * plus their finished matches and win/loss/draw count. `matches` is every match of the event, so queue positions are right.
 */
export function nextForEntries(matches: readonly CompetitionMatch[], entryIds: Iterable<string>): MyFightSummary {
  const ids = new Set(entryIds);
  const mine = matches.filter(m => isMine(m, ids));
  const open = mine
    .filter(m => m.queueState !== 'final')
    .sort((x, y) => URGENCY[x.queueState] - URGENCY[y.queueState] || (x.scheduledAt ?? '￿').localeCompare(y.scheduledAt ?? '￿') || x.position - y.position);
  let next: NextFight | null = null;
  if (open[0]) {
    const m = open[0];
    const s = sides(m, ids);
    let ahead: number | null = null;
    if (m.field && m.field.trim()) {
      const i = fieldQueue(matches, m.field).findIndex(q => q.id === m.id);
      ahead = i >= 0 ? i : null;
    }
    next = { match: m, myEntry: s.myEntry, opponent: s.opponent, ahead };
  }
  const done = mine.filter(m => m.queueState === 'final').sort((x, y) => (x.finalizedAt ?? '').localeCompare(y.finalizedAt ?? '') || x.position - y.position);
  const results: FightResultLine[] = done.map(m => {
    const s = sides(m, ids);
    const outcome = m.result === 'draw' || m.result === null ? 'drawn' : m.result === s.iAm ? 'won' : 'lost';
    return { matchId: m.id, competitionId: m.competitionId, roundLabel: m.pool ? `Pool ${m.pool}, ${m.roundLabel}` : m.roundLabel, opponent: s.opponent, outcome, mine: s.mine, theirs: s.theirs };
  });
  return {
    next, results, total: mine.length,
    wins: results.filter(r => r.outcome === 'won').length,
    losses: results.filter(r => r.outcome === 'lost').length,
    draws: results.filter(r => r.outcome === 'drawn').length
  };
}

export function aheadText(ahead: number): string {
  return ahead === 0 ? 'You are up next' : ahead === 1 ? '1 match ahead of you' : `${ahead} matches ahead of you`;
}

export interface StatusText { label: string; detail: string; tone: 'go' | 'soon' | 'wait' }

/** Plain-language status for the next fight. `field` is the field name when one is set; `ahead` comes from nextForEntries. */
export function statusLabel(state: QueueState, ahead: number | null, field: string | null): StatusText {
  const f = field && field.trim() ? field.trim() : null;
  const where = f ? ` on ${f}` : '';
  switch (state) {
    case 'active': return { label: `You are fighting now${where}`, detail: f ? `Go to ${f}.` : 'Go to your field.', tone: 'go' };
    case 'on_deck': return { label: 'You are on deck. Go to the bullpen', detail: `You are next${where}. Get your gear on and be ready.`, tone: 'go' };
    case 'in_the_hole': return { label: 'You are in the hole', detail: ahead === null ? 'You are close to the front. Start getting ready.' : `${aheadText(ahead)}${where}. Start getting ready.`, tone: 'soon' };
    case 'scheduled': return { label: 'Scheduled', detail: 'You are not in the queue yet. This page updates by itself when you are called.', tone: 'wait' };
    case 'final': return { label: 'Finished', detail: '', tone: 'wait' };
  }
}

export const recordText = (s: Pick<MyFightSummary, 'wins' | 'losses' | 'draws'>): string => {
  const parts = [`${s.wins} won`, `${s.losses} lost`];
  if (s.draws > 0) parts.push(`${s.draws} drawn`);
  return parts.join(', ');
};
