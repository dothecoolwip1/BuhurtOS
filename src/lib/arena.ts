import type { CompetitionMatch } from '../data/matches';
import type { LiveScore } from '../data/liveScores';
import { buildFieldBoards, competitionSorts, fieldKey, type FieldBoard } from './eventDay';
import { sideLabel } from './entryLabel';

/**
 * What the venue display shows for one field, from server state only (matches, live scores, the clock). Pure.
 * A result is shown for RESULT_HOLD_MS after it became official, from finalized_at: a display that opens late shows the same thing as one that
 * was open, and nothing is remembered on the client.
 */
export const RESULT_HOLD_MS = 25_000;
export const TBD = 'To be decided';

export interface ArenaSide { name: string; score: number | null; winner: boolean }
export interface ArenaFight { id: string; competition: string; stage: string; a: ArenaSide; b: ArenaSide; phase: string | null; live: boolean; detail: LiveScore['detail'] | null }
export type ArenaState =
  | { kind: 'fighting'; now: ArenaFight }
  /** `next` is the fight already called on this field while the result holds the screen (the queue advances the moment a result is saved). */
  | { kind: 'result'; result: ArenaFight; winnerName: string | null; drawn: boolean; next: ArenaFight | null }
  | { kind: 'waiting'; next: ArenaFight | null }
  | { kind: 'finished' }
  | { kind: 'no_matches' };
export interface ArenaView { field: string; state: ArenaState; onDeck: ArenaFight | null; inTheHole: ArenaFight | null; upNext: ArenaFight[]; done: number; total: number }

const roundText = (m: CompetitionMatch) => (m.pool ? `Pool ${m.pool} · ${m.roundLabel || m.stage}` : m.roundLabel || m.stage);

function fight(m: CompetitionMatch, names: ReadonlyMap<string, string>, score: LiveScore | undefined): ArenaFight {
  const final = m.queueState === 'final';
  const a = sideLabel(m.entryA, m.nameA, TBD), b = sideLabel(m.entryB, m.nameB, TBD);
  const winA = final && !!m.winnerEntryId && m.winnerEntryId === m.entryA, winB = final && !!m.winnerEntryId && m.winnerEntryId === m.entryB;
  return {
    id: m.id, competition: names.get(m.competitionId) ?? 'Competition', stage: roundText(m),
    a: { name: a, score: final ? m.scoreA : score ? score.scoreA : null, winner: winA },
    b: { name: b, score: final ? m.scoreB : score ? score.scoreB : null, winner: winB },
    phase: final ? null : score?.phase || null, live: !final && !!score, detail: score?.detail ?? null
  };
}

/** The display's names for the fields, Field 1 first. A blank field is Field 1. */
export const arenaFields = (matches: readonly CompetitionMatch[]): string[] => buildFieldBoards(matches, new Map(), new Set()).map(b => b.name);

/** The field whose key matches `wanted` (case-insensitive), else the first field, else Field 1. */
export function pickField(fields: readonly string[], wanted: string | null | undefined): string {
  if (wanted) { const hit = fields.find(f => fieldKey(f) === fieldKey(wanted)); if (hit) return hit; return wanted.trim(); }
  return fields[0] ?? 'Field 1';
}

export function buildArena(input: {
  matches: readonly CompetitionMatch[]; scores: readonly LiveScore[]; competitions: readonly { id: string; name: string; sort?: number }[]; field: string; now: number;
}): ArenaView {
  const names = new Map(input.competitions.map(c => [c.id, c.name]));
  const scores = new Map(input.scores.map(s => [s.matchId, s]));
  const key = fieldKey(input.field);
  const boards = buildFieldBoards(input.matches, competitionSorts(input.competitions), new Set());
  const board: FieldBoard | undefined = boards.find(b => b.key === key);
  const onField = input.matches.filter(m => fieldKey(m.field) === key);
  const f = (m: CompetitionMatch) => fight(m, names, scores.get(m.id));
  const base = { field: board?.name ?? (input.field.trim() || 'Field 1'), onDeck: board?.onDeck[0] ? f(board.onDeck[0]) : null, inTheHole: board?.inTheHole[0] ? f(board.inTheHole[0]) : null, upNext: (board?.upcoming ?? []).slice(0, 3).map(f), done: board?.done ?? 0, total: board?.total ?? 0 };
  if (!board || board.total === 0) return { ...base, state: { kind: 'no_matches' } };
  // A result stays on screen for a short while after it became official, even though the queue has already called the next fight: the hall
  // wants to see who won while the next pair walks on. The moment that next fight's scorer reports a score, the fight takes the screen.
  const now0 = board.now[0];
  const recent = onField.filter(m => m.queueState === 'final' && m.finalizedAt && input.now - new Date(m.finalizedAt).getTime() < RESULT_HOLD_MS)
    .sort((x, y) => (y.finalizedAt ?? '').localeCompare(x.finalizedAt ?? ''))[0];
  if (recent && !(now0 && scores.has(now0.id))) {
    const r = f(recent);
    return { ...base, state: { kind: 'result', result: r, winnerName: r.a.winner ? r.a.name : r.b.winner ? r.b.name : null, drawn: recent.result === 'draw', next: now0 ? f(now0) : null } };
  }
  if (now0) return { ...base, state: { kind: 'fighting', now: f(now0) } };
  if (board.state === 'finished') return { ...base, state: { kind: 'finished' } };
  return { ...base, state: { kind: 'waiting', next: base.onDeck ?? base.inTheHole ?? base.upNext[0] ?? null } };
}

/** When the result card should be re-checked: the moment the hold on the newest result runs out (or null). */
export function nextArenaTick(matches: readonly CompetitionMatch[], field: string, now: number): number | null {
  const key = fieldKey(field);
  const ends = matches.filter(m => fieldKey(m.field) === key && m.queueState === 'final' && m.finalizedAt).map(m => new Date(m.finalizedAt as string).getTime() + RESULT_HOLD_MS).filter(t => t > now);
  return ends.length ? Math.min(...ends) : null;
}
