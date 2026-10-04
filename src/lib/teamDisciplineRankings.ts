import type { DisciplineContribution, DisciplineScope, RankingScope, TeamDisciplineRow } from '../data/fighters';
import { DIVISIONS, divisionLabel, type Division } from './careerView';

/**
 * Team discipline totals: a team's total of the individual ranking points its fighters earned in one discipline while representing it.
 * This is NOT the team competition ranking (5v5, 3v3, ... results of team entries; see teamRankings.ts). Every discipline, its name and its
 * divisions are read from the ranking data: nothing here knows a list of disciplines. The sums themselves are made by the database.
 */

/** "All divisions": the discipline's divisions added together. */
export type DivisionChoice = Division | 'all';
export const ALL_DIVISIONS: DivisionChoice = 'all';
const divisionOrder = (g: string | null) => DIVISIONS.findIndex(([k]) => k === g);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The discipline-total scope behind a page scope. "Whole organization" has no discipline of its own, so it shows each discipline over the
 * organization's whole history (the organization career totals), as the team competition overview already does.
 */
export const disciplineScope = (scope: RankingScope): DisciplineScope => (scope === 'season' ? 'season' : scope === 'career' ? 'career' : 'org_career');

export interface DisciplineCard {
  category: string; label: string;
  /** Everyone sharing rank 1 across all divisions together, by name. More than one means a tie on points. */
  leaders: TeamDisciplineRow[]; points: number;
  /** The divisions that really exist in this discipline, in the usual order. */
  divisions: Division[];
}

/** One card per discipline that has a credited team. Leaders are the rank-1 rows of the all-divisions total (gender null). */
export function disciplineOverview(rows: readonly TeamDisciplineRow[]): DisciplineCard[] {
  const map = new Map<string, DisciplineCard>();
  for (const r of rows) {
    const c = map.get(r.category) ?? { category: r.category, label: r.categoryName || r.category, leaders: [], points: 0, divisions: [] };
    if (r.gender === null) { if (r.rank === 1) { c.leaders.push(r); c.points = r.points; } }
    else if (!c.divisions.includes(r.gender as Division)) c.divisions.push(r.gender as Division);
    map.set(r.category, c);
  }
  return [...map.values()]
    .filter(c => c.leaders.length > 0)
    .map(c => ({ ...c, leaders: [...c.leaders].sort((a, b) => byName(a.teamName, b.teamName)), divisions: [...c.divisions].sort((a, b) => divisionOrder(a) - divisionOrder(b)) }))
    .sort((a, b) => byName(a.label, b.label));
}

/** The discipline to show: the one asked for when it exists, else the first. Null when there are no disciplines. */
export const resolveDiscipline = (cards: readonly DisciplineCard[], category: string | null): DisciplineCard | null =>
  cards.find(c => c.category === category) ?? cards[0] ?? null;

/** "All divisions" first, then each division that exists. A discipline with one division offers no choice (the total is that division). */
export function divisionOptions(card: Pick<DisciplineCard, 'divisions'> | null): ReadonlyArray<readonly [DivisionChoice, string]> {
  if (!card || card.divisions.length < 2) return [];
  return [[ALL_DIVISIONS, 'All divisions'], ...card.divisions.map(d => [d, divisionLabel(d)] as const)];
}
/** A division that does not exist in the discipline falls back to all divisions. */
export const resolveDivision = (card: Pick<DisciplineCard, 'divisions'> | null, raw: string | null): DivisionChoice =>
  card && card.divisions.length > 1 && card.divisions.includes(raw as Division) ? (raw as Division) : ALL_DIVISIONS;
/** The gender the database uses for a division choice (null = all divisions together). */
export const genderOf = (d: DivisionChoice): Division | null => (d === ALL_DIVISIONS ? null : d);

/** The full table for one division (or all divisions together), best first; equal points share a rank and are listed by name. */
export const disciplineBoard = (rows: readonly TeamDisciplineRow[], division: DivisionChoice): TeamDisciplineRow[] =>
  rows.filter(r => r.gender === genderOf(division)).sort((a, b) => a.rank - b.rank || byName(a.teamName, b.teamName));

/** How a team's all-divisions total splits by division ("Men 23 · Women 15"). Empty when there is only one division. */
export function divisionSplit(rows: readonly TeamDisciplineRow[], teamId: string): Array<{ gender: Division; points: number }> {
  const parts = rows.filter(r => r.teamId === teamId && r.gender !== null).map(r => ({ gender: r.gender as Division, points: r.points }));
  return parts.length > 1 ? parts.sort((a, b) => divisionOrder(a.gender) - divisionOrder(b.gender)) : [];
}
export const splitText = (parts: ReadonlyArray<{ gender: Division; points: number }>): string => parts.map(p => `${divisionLabel(p.gender)} ${formatPoints(p.points)}`).join(' · ');

/** Points as the league awards them: whole numbers stay whole, fractional multipliers keep up to two decimals. */
export const formatPoints = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** "1 point", "9 points", "12.5 points". */
export const pointsText = (n: number): string => `${formatPoints(n)} ${n === 1 ? 'point' : 'points'}`;

/** The fighters behind a total, most points first. The sum of the lines is the team's total. */
export const contributionLines = (rows: readonly DisciplineContribution[]): DisciplineContribution[] =>
  [...rows].sort((a, b) => b.points - a.points || byName(a.displayName, b.displayName));
export const contributionTotal = (rows: readonly DisciplineContribution[]): number => Math.round(rows.reduce((s, r) => s + r.points, 0) * 100) / 100;

/** "Longsword" or "Longsword · Women". */
export const boardTitle = (card: Pick<DisciplineCard, 'label'>, division: DivisionChoice): string =>
  division === ALL_DIVISIONS ? card.label : `${card.label} · ${divisionLabel(division)}`;

/** The page parameters that open a discipline's full table: same organization, season and scope, all divisions. */
export function disciplineParams(category: string, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('who', 'teams');
  next.set('table', 'disciplines');
  next.set('discipline', category);
  next.delete('division');
  return next;
}
