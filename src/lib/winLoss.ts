import type { CompetitionEntry, CompetitionMatch } from '../data/matches';
import type { Placement } from '../data/finalization';
import { placeWord } from './finalization';

/**
 * Review wins & losses (Pack 09D): each competitor's record in ONE competition, read from its finished fights. Pure; tested in winLoss.test.ts.
 * Nothing here decides a placing or points: those are the server's (competition_finalize_preflight, the same computation finalize writes).
 * A walkover counts as a fight won / lost and is marked as such; a draw counts as a tie (only pools and round robins can have one).
 */
export type Outcome = 'won' | 'lost' | 'tied';
export interface Bout {
  matchId: string; opponentId: string | null; opponent: string; outcome: Outcome;
  scoreFor: number | null; scoreAgainst: number | null; walkover: boolean; stage: string; round: string;
}
export interface WinLoss { entryId: string; name: string; status: string; wins: number; losses: number; ties: number; bouts: Bout[] }

const isWalkover = (m: Pick<CompetitionMatch, 'detail'>) => (m.detail as { walkover?: unknown } | null)?.walkover === true;

export function winLossRecords(entries: readonly Pick<CompetitionEntry, 'id' | 'name' | 'status'>[], matches: readonly CompetitionMatch[]): WinLoss[] {
  const byId = new Map(entries.map(e => [e.id, e]));
  const out = new Map<string, WinLoss>(entries.map(e => [e.id, { entryId: e.id, name: e.name, status: e.status, wins: 0, losses: 0, ties: 0, bouts: [] }]));
  const ordered = [...matches].filter(m => m.queueState === 'final' && m.entryA && m.entryB)
    .sort((a, b) => (a.finalizedAt ?? '').localeCompare(b.finalizedAt ?? '') || a.id.localeCompare(b.id));
  for (const m of ordered) {
    for (const side of ['a', 'b'] as const) {
      const me = side === 'a' ? m.entryA! : m.entryB!;
      const them = side === 'a' ? m.entryB! : m.entryA!;
      const rec = out.get(me);
      if (!rec) continue;
      const outcome: Outcome = m.result === 'draw' ? 'tied' : m.winnerEntryId === me ? 'won' : 'lost';
      if (outcome === 'won') rec.wins += 1; else if (outcome === 'lost') rec.losses += 1; else rec.ties += 1;
      rec.bouts.push({
        matchId: m.id, opponentId: them, opponent: byId.get(them)?.name ?? (side === 'a' ? m.nameB : m.nameA) ?? 'Unknown', outcome,
        scoreFor: side === 'a' ? m.scoreA : m.scoreB, scoreAgainst: side === 'a' ? m.scoreB : m.scoreA, walkover: isWalkover(m), stage: m.stage, round: m.roundLabel
      });
    }
  }
  return [...out.values()];
}

/** "5 wins · 1 loss" (ties only when there are some). */
export function recordLine(r: Pick<WinLoss, 'wins' | 'losses' | 'ties'>): string {
  const parts = [`${r.wins} win${r.wins === 1 ? '' : 's'}`, `${r.losses} loss${r.losses === 1 ? '' : 'es'}`];
  if (r.ties > 0) parts.push(`${r.ties} tie${r.ties === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** "Won vs John 5–1", "Lost vs Chris (walkover)". */
export function boutLine(b: Bout): string {
  const verb = b.outcome === 'won' ? 'Won vs' : b.outcome === 'lost' ? 'Lost vs' : 'Tied with';
  const score = b.walkover ? ' (walkover)' : b.scoreFor !== null && b.scoreAgainst !== null ? ` ${b.scoreFor}–${b.scoreAgainst}` : '';
  return `${verb} ${b.opponent}${score}`;
}

export interface ReviewRow extends WinLoss { place: number | null; placeText: string; points: number | null; shared: boolean }
/**
 * Everyone, in the server's calculated order (placings from the preflight), with their record. Entrants the server does not place (withdrawn) come last.
 * `shared` marks a place held by more than one competitor (the server already decided it is shared, or a tie still needs a decision).
 */
export function reviewRows(records: readonly WinLoss[], placements: readonly Placement[]): ReviewRow[] {
  const placeOf = new Map(placements.map(p => [p.entryId, p]));
  const counts = new Map<number, number>();
  for (const p of placements) counts.set(p.place, (counts.get(p.place) ?? 0) + 1);
  return records.map(r => {
    const p = placeOf.get(r.entryId);
    const shared = p ? (counts.get(p.place) ?? 0) > 1 : false;
    return { ...r, place: p?.place ?? null, placeText: p ? placeWord(p.place, shared) : r.status === 'withdrawn' ? 'Withdrawn' : 'Not placed', points: p ? p.points : null, shared };
  }).sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
}

/** Two competitors side by side: their records and every time they met. */
export function compareTwo(a: WinLoss, b: WinLoss): { meetings: Bout[]; line: string } {
  const meetings = a.bouts.filter(x => x.opponentId === b.entryId);
  const aw = meetings.filter(x => x.outcome === 'won').length, bw = meetings.filter(x => x.outcome === 'lost').length;
  const line = meetings.length === 0 ? `${a.name} and ${b.name} did not meet.` : `Head to head: ${a.name} ${aw} – ${bw} ${b.name}${meetings.some(x => x.outcome === 'tied') ? ' (with a tie)' : ''}.`;
  return { meetings, line };
}
