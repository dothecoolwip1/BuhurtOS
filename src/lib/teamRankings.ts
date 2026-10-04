import type { RankingRow, RankingScope } from '../data/fighters';
import { categoryLabel, DIVISIONS, divisionLabel, RANKING_CATEGORIES, type Division } from './careerView';

/**
 * Team rankings by category. Which categories a team ranking has, and whether a division (men / women / open) applies, is read from the
 * ranking data itself: a category is offered only when at least one team has a ranking row in it for the chosen scope, organization and season.
 * Nothing here knows a list of team categories, and no formula is touched.
 */

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const divisionRank = (g: string) => DIVISIONS.findIndex(([k]) => k === g);

/** Fighters keep the leading five categories (and any other one already chosen). Unchanged behaviour, kept here so it can be tested. */
export function fighterCategoryOptions(current: string): ReadonlyArray<readonly [string, string]> {
  return [...RANKING_CATEGORIES, ...(RANKING_CATEGORIES.some(([k]) => k === current) ? [] : [[current, categoryLabel(current)] as const])];
}

/**
 * Where a category-by-category overview comes from. Season and organization-career rankings are split by category. "Whole organization" has
 * no category of its own, so its overview is the organization's career ranking per category (the same results). "All time" is one table across
 * every category, so it has no per-category overview.
 */
export const overviewScope = (scope: RankingScope): 'season' | 'org_career' | null =>
  scope === 'season' ? 'season' : scope === 'org_career' || scope === 'org_all' ? 'org_career' : null;

export interface TeamLeaderCard {
  key: string; category: string; gender: Division; label: string;
  /** True only when this category has more than one division in the data, so a lone division is never shown as a choice. */
  showDivision: boolean;
  /** Everyone sharing rank 1, by name. More than one means a tie on points. */
  leaders: RankingRow[]; points: number;
}

/** One card per (category, division) that has a ranked team, listing the team(s) at rank 1. Rows with no category or division are ignored. */
export function teamOverview(rows: readonly RankingRow[]): TeamLeaderCard[] {
  const groups = new Map<string, { category: string; gender: Division; leaders: RankingRow[] }>();
  for (const r of rows) {
    if (r.rank !== 1 || !r.category || !r.gender) continue;
    const key = `${r.category}|${r.gender}`;
    const g = groups.get(key) ?? { category: r.category, gender: r.gender as Division, leaders: [] };
    g.leaders.push(r);
    groups.set(key, g);
  }
  const divisionsOf = new Map<string, number>();
  for (const g of groups.values()) divisionsOf.set(g.category, (divisionsOf.get(g.category) ?? 0) + 1);
  return [...groups.entries()]
    .map(([key, g]) => ({
      key, category: g.category, gender: g.gender, label: categoryLabel(g.category), showDivision: (divisionsOf.get(g.category) ?? 0) > 1,
      leaders: [...g.leaders].sort((a, b) => a.name.localeCompare(b.name)), points: g.leaders[0].points
    }))
    .sort((a, b) => natural(a.category, b.category) || divisionRank(a.gender) - divisionRank(b.gender));
}

/** "Men's 5v5" when the division matters, "5v5" when it does not. */
export const cardTitle = (c: Pick<TeamLeaderCard, 'label' | 'gender' | 'showDivision'>): string => (c.showDivision ? `${c.label} · ${divisionLabel(c.gender)}` : c.label);

export interface TeamCategoryOption { code: string; label: string; divisions: Division[] }
/** The categories a team ranking can be shown for, each with the divisions that really exist in it. */
export function teamCategoryOptions(cards: readonly TeamLeaderCard[]): TeamCategoryOption[] {
  const out = new Map<string, TeamCategoryOption>();
  for (const c of cards) {
    const o = out.get(c.category) ?? { code: c.category, label: c.label, divisions: [] };
    o.divisions.push(c.gender);
    out.set(c.category, o);
  }
  return [...out.values()];
}

/**
 * The category and division to actually show. A category that is not offered for teams (a duel category left over from the Fighters view, say)
 * falls back to the first one that is; a division that does not exist in the category falls back to its first. Null when there is nothing to show.
 */
export function resolveTeamSelection(options: readonly TeamCategoryOption[], category: string, gender: string): { category: string; gender: Division } | null {
  const opt = options.find(o => o.code === category) ?? options[0];
  if (!opt) return null;
  return { category: opt.code, gender: (opt.divisions.find(d => d === gender) ?? opt.divisions[0]) };
}

/** The page parameters that open the full leaderboard for a card. "Whole organization" has no category table, so it opens the organization's career one. */
export function leaderboardParams(card: Pick<TeamLeaderCard, 'category' | 'gender'>, scope: RankingScope, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('who', 'teams');
  next.set('scope', scope === 'org_all' ? 'org_career' : scope);
  next.set('category', card.category);
  next.set('division', card.gender);
  return next;
}
