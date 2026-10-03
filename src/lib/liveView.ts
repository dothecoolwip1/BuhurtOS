/**
 * Pure helpers that turn matches and standings from the database into what the public event page shows.
 * No sample data and no database access here. Tie rules are NOT invented: rows are ordered by wins, then score
 * difference, then name (only so the order is stable), and `hasUnresolvedTies` tells the page to show a note.
 */
import type { CompetitionMatch, CompetitionEntry, Standing, QueueState } from '../data/matches';
import { groupIntoRounds } from '../data/matches';
import { sideLabel, UNNAMED_ENTRY } from './entryLabel';
import { explainResult } from './matchExplain';

export const TBD = 'To be decided';

export interface StandingRow {
  entryId: string; name: string; pool: string | null;
  wins: number; losses: number; draws: number; scoreFor: number; scoreAgainst: number; diff: number;
  /** True when a neighbouring row has the same wins and score difference, so these two numbers do not decide their order. */
  tied: boolean;
}
export interface PoolTable { pool: string | null; label: string; rows: StandingRow[]; hasUnresolvedTies: boolean }

export function sortStandings(standings: readonly Standing[], entries: readonly CompetitionEntry[]): StandingRow[] {
  const byEntry = new Map(entries.map(e => [e.id, e]));
  const rows: StandingRow[] = standings.map(s => {
    const e = byEntry.get(s.entryId);
    return { entryId: s.entryId, name: e?.name ?? UNNAMED_ENTRY, pool: e?.pool ?? null, wins: s.wins, losses: s.losses, draws: s.draws, scoreFor: s.scoreFor, scoreAgainst: s.scoreAgainst, diff: s.scoreFor - s.scoreAgainst, tied: s.tied ?? false };
  });
  // When the database ranking is present (always, in the product) it decides the order and which rows are still level, so spectators see the
  // same order the organizer and the official placings use. The wins/difference fallback is only for data that has no database rank.
  if (standings.length > 0 && standings.every(s => s.rank !== undefined)) {
    const rankOf = new Map(standings.map(s => [s.entryId, s.rank as number]));
    rows.sort((a, b) => (a.pool ?? '').localeCompare(b.pool ?? '') || rankOf.get(a.entryId)! - rankOf.get(b.entryId)! || a.name.localeCompare(b.name));
    return rows;
  }
  rows.sort((a, b) => b.wins - a.wins || b.diff - a.diff || a.name.localeCompare(b.name));
  for (let i = 0; i < rows.length; i++) {
    const same = (j: number) => !!rows[j] && rows[j].wins === rows[i].wins && rows[j].diff === rows[i].diff;
    rows[i].tied = same(i - 1) || same(i + 1);
  }
  return rows;
}

/** One table per pool (a round robin with no pools gets a single table). Pools are ordered by name. Empty when there are no pool matches. */
export function buildPoolTables(standings: readonly Standing[], entries: readonly CompetitionEntry[], matches: readonly CompetitionMatch[]): PoolTable[] {
  const inPlay = new Set(matches.filter(m => m.stage === 'pool' || m.stage === 'round_robin').flatMap(m => [m.entryA, m.entryB]).filter((x): x is string => !!x));
  if (inPlay.size === 0) return [];
  const rows = sortStandings(standings.filter(s => inPlay.has(s.entryId)), entries);
  const names = [...new Set(rows.map(r => r.pool))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  return names.map(pool => {
    const list = rows.filter(r => r.pool === pool);
    return { pool, label: pool ? `Pool ${pool}` : 'Standings', rows: list, hasUnresolvedTies: list.some(r => r.tied) };
  });
}

export interface BracketSlot { entryId: string | null; name: string; tbd: boolean; score: number | null; winner: boolean; loser: boolean }
export interface BracketMatchView { id: string; label: string; state: QueueState; field: string | null; slots: [BracketSlot, BracketSlot]; done: boolean; /** One factual sentence from the recorded result (matchExplain.ts); null until the match is final. */ explanation: string | null }
export interface BracketColumn { key: string; title: string; matches: BracketMatchView[] }

function slot(m: CompetitionMatch, side: 'a' | 'b'): BracketSlot {
  const entryId = side === 'a' ? m.entryA : m.entryB;
  const name = side === 'a' ? m.nameA : m.nameB;
  const done = m.queueState === 'final';
  const winner = done && !!entryId && m.winnerEntryId === entryId;
  const loser = done && m.winnerEntryId !== null && !!entryId && m.winnerEntryId !== entryId;
  const score = done ? (side === 'a' ? m.scoreA : m.scoreB) : null;
  return { entryId, name: sideLabel(entryId, name, TBD), tbd: !entryId, score, winner, loser };
}

/** Elimination rounds as columns, earliest first, then the final, then third place. Empty when there are no bracket matches. */
export function buildBracketColumns(matches: readonly CompetitionMatch[]): BracketColumn[] {
  const rounds = groupIntoRounds(matches.filter(m => m.stage === 'elimination' || m.stage === 'final' || m.stage === 'third_place'));
  const order = (s: string) => (s === 'elimination' ? 0 : s === 'final' ? 1 : 2);
  return rounds.sort((a, b) => order(a.stage) - order(b.stage)).map(r => ({
    key: r.key,
    title: r.label,
    matches: r.matches.map(m => ({ id: m.id, label: `${r.label} ${m.position + 1}`, state: m.queueState, field: m.field, slots: [slot(m, 'a'), slot(m, 'b')], done: m.queueState === 'final', explanation: explainResult(m) }))
  }));
}

/** The winner of a finished final, or null (a drawn or unfinished final has no champion). */
export function championOf(matches: readonly CompetitionMatch[]): string | null {
  const f = matches.find(m => m.stage === 'final' && m.queueState === 'final' && m.winnerEntryId);
  if (!f) return null;
  return (f.winnerEntryId === f.entryA ? f.nameA : f.winnerEntryId === f.entryB ? f.nameB : null) ?? null;
}

export interface NowItem { id: string; state: 'active' | 'in_the_hole' | 'on_deck'; competition: string; round: string; nameA: string; nameB: string }
export interface FieldNow { field: string; items: NowItem[] }
const NOW_RANK = { active: 0, in_the_hole: 1, on_deck: 2 } as const;
export const NOW_LABEL: Record<NowItem['state'], string> = { active: 'Now', in_the_hole: 'In the hole', on_deck: 'On deck' };

/** Matches that are running or queued, grouped by field (fields sorted by name, matches by state then scheduled time). */
export function buildNowAndNext(matches: readonly CompetitionMatch[], competitionNames: ReadonlyMap<string, string>): FieldNow[] {
  const live = matches.filter((m): m is CompetitionMatch & { queueState: NowItem['state'] } => m.queueState === 'active' || m.queueState === 'in_the_hole' || m.queueState === 'on_deck');
  const byField = new Map<string, typeof live>();
  for (const m of live) {
    const f = m.field?.trim() || 'Field not set';
    byField.set(f, [...(byField.get(f) ?? []), m]);
  }
  return [...byField.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([field, list]) => ({
    field,
    items: [...list].sort((x, y) => NOW_RANK[x.queueState] - NOW_RANK[y.queueState] || (x.scheduledAt ?? '').localeCompare(y.scheduledAt ?? '') || x.position - y.position).map(m => ({
      id: m.id, state: m.queueState, competition: competitionNames.get(m.competitionId) ?? 'Competition', round: m.pool ? `Pool ${m.pool}, ${m.roundLabel}` : m.roundLabel,
      nameA: sideLabel(m.entryA, m.nameA, TBD), nameB: sideLabel(m.entryB, m.nameB, TBD)
    }))
  }));
}
