import type { CompetitionInput, Division, RefCategory, SetupCompetition } from '../data/competitions';
import { DEFAULT_TIER, suggestName } from '../data/competitions';

/**
 * Quick Setup (Pack 09D): what a normal event offers, worked out from the reference categories (public.ref_categories) so the organizer only turns OFF
 * what they are not running. Pure; tested in quickSetup.test.ts.
 *
 * Defaults, and where each comes from
 *   categories   every row of ref_categories. ON by default: the categories a normal tournament runs. OFF by default (still one tap away): the large
 *                melees (12v12, 30v30: they need 24 to 60 fighters per side of the field) and Greatsword (on the Red Deer Rumble form it is part of the
 *                Marathon relay, not its own competition).
 *   divisions    Men and Women for every category that has them on the registration form (duels, group fights, Sabre, Profight); Open for the
 *                formats that are not split (Triathlon, Marathon). The organizer can switch any division off or on.
 *   entry kind   the category's league: group fights take team entries, everything else takes fighters (the database enforces it).
 *   ruleset      the rules document the reference row cites (ref_categories.source), named with its version: Buhurt International documents for the
 *                buhurt / duels / outrance leagues. HACSA rules text is not loaded in BuhurtOS, so HACSA categories get no ruleset rather than a guess.
 *   format       nothing is fixed here: Build Tournament proposes the format from the real number of entrants.
 *   tier         the database default (shown as Classic) until the organizer chooses another in Advanced setup.
 */

export type Selection = ReadonlyMap<string, ReadonlySet<Division>>;

const OFF_BY_DEFAULT = new Set(['12v12', '30v30', 'greatsword']);
const OPEN_ONLY = new Set(['triathlon', 'marathon']);

export interface CategoryRef extends RefCategory { source?: string | null }

export const isStandard = (c: Pick<RefCategory, 'code'>): boolean => !OFF_BY_DEFAULT.has(c.code);
export const defaultDivisions = (c: Pick<RefCategory, 'code'>): Division[] => (OPEN_ONLY.has(c.code) ? ['open'] : ['men', 'women']);
export const isTeamCategory = (c: Pick<RefCategory, 'league'>): boolean => c.league === 'buhurt';

/** "Buhurt International: Duels rules V.26.4" from the reference row's source, or '' when BuhurtOS has no rules text for it. */
export function rulesetFor(c: CategoryRef): string {
  if (c.league === 'hacsa' || !c.source) return '';
  const doc = c.source.split('§')[0].split(';')[0].trim();
  return doc ? `Buhurt International: ${doc}`.slice(0, 120) : '';
}

/** The starting selection: the standard categories with their default divisions, or (Create event like…) exactly what another event ran. */
export function initialSelection(categories: readonly RefCategory[], copyFrom?: readonly Pick<SetupCompetition, 'category' | 'gender'>[]): Map<string, Set<Division>> {
  const out = new Map<string, Set<Division>>();
  if (copyFrom && copyFrom.length > 0) {
    for (const k of copyFrom) { const s = out.get(k.category) ?? new Set<Division>(); s.add(k.gender); out.set(k.category, s); }
    return out;
  }
  for (const c of categories) if (isStandard(c)) out.set(c.code, new Set(defaultDivisions(c)));
  return out;
}

export const selectAll = (categories: readonly RefCategory[]): Map<string, Set<Division>> => new Map(categories.map(c => [c.code, new Set(defaultDivisions(c))]));
export const clearAll = (): Map<string, Set<Division>> => new Map();

/** Turn one category on (with its default divisions) or off. */
export function toggleCategory(sel: Selection, c: RefCategory): Map<string, Set<Division>> {
  const next = new Map([...sel].map(([k, v]) => [k, new Set(v)]));
  if (next.has(c.code)) next.delete(c.code); else next.set(c.code, new Set(defaultDivisions(c)));
  return next;
}
/** Turn one division of a category on or off; switching off the last one switches the category off. */
export function toggleDivision(sel: Selection, code: string, d: Division): Map<string, Set<Division>> {
  const next = new Map([...sel].map(([k, v]) => [k, new Set(v)]));
  const s = next.get(code) ?? new Set<Division>();
  if (s.has(d)) s.delete(d); else s.add(d);
  if (s.size === 0) next.delete(code); else next.set(code, s);
  return next;
}

const DIVISION_ORDER: Division[] = ['men', 'women', 'open'];
export const DIVISION_WORD: Record<Division, string> = { men: 'Men', women: 'Women', open: 'Open' };

/**
 * The competitions to create, in the reference order (category sort, then Men, Women, Open). When copying another event, its ruleset, structure,
 * rounds to win and tier come along for the same category and division; nothing else (no entrants, fights or results) ever does.
 */
export function competitionsToCreate(categories: readonly CategoryRef[], sel: Selection, copyFrom?: readonly SetupCompetition[]): CompetitionInput[] {
  const out: CompetitionInput[] = [];
  for (const c of [...categories].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))) {
    const divs = sel.get(c.code);
    if (!divs) continue;
    for (const d of DIVISION_ORDER) {
      if (!divs.has(d)) continue;
      const like = copyFrom?.find(k => k.category === c.code && k.gender === d);
      out.push({
        name: like?.name ?? suggestName(c, d), category: c.code, gender: d,
        ruleset: like ? (like.ruleset ?? '') : rulesetFor(c),
        structure: like?.structure ?? 'round_robin', roundsToWin: like?.roundsToWin ?? null, tier: like?.tier ?? DEFAULT_TIER
      });
    }
  }
  return out;
}

export interface ReviewLine { code: string; name: string; divisions: string; kind: string; ruleset: string }
/** The one-screen summary: "Longsword · Men · Women · Fighters · Buhurt International: Duels rules V.26.4". */
export function reviewLines(categories: readonly CategoryRef[], sel: Selection, copyFrom?: readonly SetupCompetition[]): ReviewLine[] {
  const comps = competitionsToCreate(categories, sel, copyFrom);
  const out: ReviewLine[] = [];
  for (const c of [...categories].sort((a, b) => a.sort - b.sort)) {
    const mine = comps.filter(k => k.category === c.code);
    if (mine.length === 0) continue;
    const rulesets = [...new Set(mine.map(k => k.ruleset).filter(Boolean))];
    out.push({
      code: c.code, name: c.name, divisions: mine.map(k => DIVISION_WORD[k.gender]).join(' · '),
      kind: isTeamCategory(c) ? 'Team competition' : 'Individual', ruleset: rulesets.join(' / ') || 'Ruleset not set (add it in Advanced setup if you need one)'
    });
  }
  return out;
}

/** How many competitions Quick Setup will create. */
export const competitionCount = (sel: Selection): number => [...sel.values()].reduce((s, v) => s + v.size, 0);
