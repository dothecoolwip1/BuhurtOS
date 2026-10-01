import type { FighterMatchStats, FighterSeasonStats, RankingFilter, RankingRow, RankingScope, ResultRow } from '../data/fighters';
import { ordinal } from './teamDirectory';

/** Pure helpers for the fighter, rankings, event-history and team pages. Nothing here reads the database or invents a number. */

export type Division = 'open' | 'men' | 'women';
export type Outcome = 'win' | 'loss' | 'draw';

const CATEGORY_LABEL: Record<string, string> = {
  '3v3': '3v3', '5v5': '5v5', '12v12': '12v12', '30v30': '30v30', sword_shield: 'Sword and shield', buckler: 'Sword and buckler',
  longsword: 'Longsword', polearm: 'Polearm', profight: 'Profight', sabre: 'Sabre', greatsword: 'Greatsword'
};
export const categoryLabel = (code: string | null | undefined): string => (code ? CATEGORY_LABEL[code] ?? code.replace(/_/g, ' ') : 'All categories');
/** The five categories the rankings page leads with; the rest are offered after them. */
export const RANKING_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['5v5', '5v5'], ['3v3', '3v3'], ['longsword', 'Longsword'], ['sword_shield', 'Sword and shield'], ['polearm', 'Polearm']
];
export const DIVISIONS: ReadonlyArray<readonly [Division, string]> = [['men', 'Men'], ['women', 'Women'], ['open', 'Open']];
export const divisionLabel = (g: string | null | undefined): string => (g === 'men' ? 'Men' : g === 'women' ? 'Women' : g === 'open' ? 'Open' : '');
export const genderLabel = (g: string | null | undefined): string => (g === 'male' ? 'Male' : g === 'female' ? 'Female' : g === 'other' ? 'Other' : '');
export const outcomeLabel = (o: Outcome): string => (o === 'win' ? 'Win' : o === 'loss' ? 'Loss' : 'Draw');
export const outcomeLetter = (o: Outcome): 'W' | 'L' | 'D' => (o === 'win' ? 'W' : o === 'loss' ? 'L' : 'D');

export type Medal = 'gold' | 'silver' | 'bronze';
export const medalOf = (place: number | null | undefined): Medal | null => (place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : null);
export const placeText = (place: number): string => ordinal(place);
export const medalText = (place: number): string => (medalOf(place) ? `${placeText(place)} (${medalOf(place)})` : placeText(place));

export const formatRecord = (w: number, l: number, d: number): string => (d > 0 ? `${w}-${l}-${d}` : `${w}-${l}`);
export const winPctText = (pct: number | null): string => (pct === null ? 'No matches yet' : `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`);
export const scoreText = (a: number | null, b: number | null): string => (a === null || b === null ? '' : `${a} to ${b}`);
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Local calendar date as yyyy-mm-dd (event dates are plain calendar dates). */
export const todayIso = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export type Phase = 'upcoming' | 'current' | 'past';
export const eventPhase = (startsOn: string, endsOn: string, today: string): Phase => (endsOn < today ? 'past' : startsOn > today ? 'upcoming' : 'current');

// ------------------------------------------------------------------ paging and search
export const PAGE_SIZE = 24;
export interface PageInfo { page: number; pages: number; from: number; to: number; total: number }
export function pageInfo(total: number, page: number, size = PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const from = total === 0 ? 0 : (p - 1) * size + 1;
  return { page: p, pages, from, to: Math.min(total, p * size), total };
}
export const parsePage = (raw: string | null): number => { const n = Number(raw); return Number.isInteger(n) && n >= 1 ? n : 1; };
/** Makes a search word safe inside a LIKE pattern (percent, underscore and backslash lose their meaning). */
export const escapeLike = (s: string): string => s.trim().replace(/[\\%_]/g, c => `\\${c}`);

// ------------------------------------------------------------------ fighter stats
export interface MatchTotals { matches: number; wins: number; losses: number; draws: number; roundsWon: number; roundsLost: number; pointsFor: number; pointsAgainst: number }
export function sumMatchStats(rows: readonly FighterMatchStats[]): MatchTotals {
  const t: MatchTotals = { matches: 0, wins: 0, losses: 0, draws: 0, roundsWon: 0, roundsLost: 0, pointsFor: 0, pointsAgainst: 0 };
  for (const r of rows) {
    t.matches += r.matches; t.wins += r.wins; t.losses += r.losses; t.draws += r.draws;
    t.roundsWon += r.roundsWon; t.roundsLost += r.roundsLost; t.pointsFor += r.pointsFor; t.pointsAgainst += r.pointsAgainst;
  }
  return t;
}

export interface CategoryLine {
  key: string; category: string; gender: Division; competitions: number; golds: number; silvers: number; bronzes: number; bestPlace: number | null;
  matches: number; wins: number; losses: number; draws: number;
}
/** One line per category and division, from results (places) and match stats (record). Lines with nothing in them are not made. */
export function categoryLines(results: readonly ResultRow[], stats: readonly FighterMatchStats[]): CategoryLine[] {
  const map = new Map<string, CategoryLine>();
  const line = (category: string, gender: Division): CategoryLine => {
    const key = `${category}:${gender}`;
    let l = map.get(key);
    if (!l) { l = { key, category, gender, competitions: 0, golds: 0, silvers: 0, bronzes: 0, bestPlace: null, matches: 0, wins: 0, losses: 0, draws: 0 }; map.set(key, l); }
    return l;
  };
  for (const r of results) {
    const l = line(r.category, r.gender);
    l.competitions += 1;
    if (r.finalPlace === 1) l.golds += 1; else if (r.finalPlace === 2) l.silvers += 1; else if (r.finalPlace === 3) l.bronzes += 1;
    l.bestPlace = l.bestPlace === null ? r.finalPlace : Math.min(l.bestPlace, r.finalPlace);
  }
  for (const s of stats) { const l = line(s.category, s.gender); l.matches += s.matches; l.wins += s.wins; l.losses += s.losses; l.draws += s.draws; }
  return [...map.values()].sort((a, b) => b.matches + b.competitions - (a.matches + a.competitions) || a.key.localeCompare(b.key));
}

export interface SeasonInfo { id: string; name: string; slug: string; organizationId: string | null; startsOn: string; endsOn: string }
/** Season stats for seasons running today; when none is running, the most recent season that has stats (labelled by the caller). */
export function currentSeasonStats(stats: readonly FighterSeasonStats[], seasons: readonly SeasonInfo[], today: string): { current: boolean; rows: Array<FighterSeasonStats & { season: SeasonInfo }> } {
  const byId = new Map(seasons.map(s => [s.id, s]));
  const joined = stats.flatMap(r => { const season = byId.get(r.seasonId); return season ? [{ ...r, season }] : []; });
  const running = joined.filter(r => r.season.startsOn <= today && today <= r.season.endsOn);
  if (running.length > 0) return { current: true, rows: running };
  const latest = [...joined].sort((a, b) => b.season.endsOn.localeCompare(a.season.endsOn))[0];
  return { current: false, rows: latest ? joined.filter(r => r.season.id === latest.season.id) : [] };
}

export interface MedalCount { golds: number; silvers: number; bronzes: number }
export const countMedals = (places: readonly number[]): MedalCount => ({ golds: places.filter(p => p === 1).length, silvers: places.filter(p => p === 2).length, bronzes: places.filter(p => p === 3).length });

export interface TournamentLine { eventSlug: string; eventName: string; startsOn: string; endsOn: string; placements: Array<{ competition: string; category: string; gender: Division; place: number; medal: Medal | null }> }
/** Groups finished results by event, newest event first. */
export function tournamentHistory(results: readonly ResultRow[]): TournamentLine[] {
  const map = new Map<string, TournamentLine>();
  for (const r of results) {
    let t = map.get(r.eventId);
    if (!t) { t = { eventSlug: r.eventSlug, eventName: r.eventName, startsOn: r.startsOn, endsOn: r.endsOn, placements: [] }; map.set(r.eventId, t); }
    t.placements.push({ competition: r.competitionName, category: r.category, gender: r.gender, place: r.finalPlace, medal: medalOf(r.finalPlace) });
  }
  const out = [...map.values()];
  for (const t of out) t.placements.sort((a, b) => a.place - b.place || a.competition.localeCompare(b.competition));
  return out.sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.eventName.localeCompare(b.eventName));
}

export interface FightRow { matchId: string; outcome: Outcome; scoreFor: number; scoreAgainst: number; endsOn: string; finalizedAt: string | null }
/** Newest first, the order the recent-fights list and the form strip both use. */
export const sortFights = <T extends Pick<FightRow, 'endsOn' | 'finalizedAt' | 'matchId'>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => b.endsOn.localeCompare(a.endsOn) || (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? '') || b.matchId.localeCompare(a.matchId));
export const formString = (rows: readonly Pick<FightRow, 'outcome'>[], n = 10): Array<'W' | 'L' | 'D'> => rows.slice(0, n).map(r => outcomeLetter(r.outcome));

// ------------------------------------------------------------------ rankings
export type RankingSubject = 'fighters' | 'teams';
export interface RankingSelection { scope: RankingScope; organizationId: string; seasonId: string; category: string; gender: Division | '' }
export const RANKING_SCOPES: ReadonlyArray<readonly [RankingScope, string]> = [
  ['season', 'Season'], ['org_career', 'Organization career'], ['org_all', 'Whole organization'], ['career', 'All time']
];
export const RANKING_POINTS_SENTENCE = 'Points are the league points each finished competition awards for a placing, added up; bigger tournaments award more, and fighters or teams with equal points share a rank.';

/** The database filter for a selection, or the plain-language thing still to choose. */
export function buildRankingFilter(s: RankingSelection): { filter: RankingFilter | null; missing: string | null } {
  if (s.scope === 'career') return { filter: { scope: 'career' }, missing: null };
  if (!s.organizationId) return { filter: null, missing: 'Choose an organization.' };
  if (s.scope === 'org_all') return { filter: { scope: 'org_all', organizationId: s.organizationId }, missing: null };
  if (!s.category) return { filter: null, missing: 'Choose a category.' };
  if (!s.gender) return { filter: null, missing: 'Choose a division.' };
  if (s.scope === 'org_career') return { filter: { scope: 'org_career', organizationId: s.organizationId, category: s.category, gender: s.gender }, missing: null };
  if (!s.seasonId) return { filter: null, missing: 'Choose a season.' };
  return { filter: { scope: 'season', organizationId: s.organizationId, seasonId: s.seasonId, category: s.category, gender: s.gender }, missing: null };
}

/** Which of the selection's boxes apply to a scope. */
export const scopeUses = (scope: RankingScope) => ({
  organization: scope !== 'career', season: scope === 'season', category: scope === 'season' || scope === 'org_career', division: scope === 'season' || scope === 'org_career'
});

export const medalSummary = (r: Pick<RankingRow, 'golds' | 'silvers' | 'bronzes' | 'competitions'>): string =>
  `${plural(r.competitions, 'competition')} · ${r.golds} gold, ${r.silvers} silver, ${r.bronzes} bronze`;

/** Latest season first, so a page can default to the newest. */
export const seasonsOf = (seasons: readonly SeasonInfo[], organizationId: string): SeasonInfo[] =>
  seasons.filter(s => s.organizationId === organizationId).sort((a, b) => b.endsOn.localeCompare(a.endsOn));

export interface OrgLite { id: string; name: string; shortName: string | null; enabled: boolean; slug: string }
export const orgName = (o: Pick<OrgLite, 'name' | 'shortName'>): string => o.shortName ?? o.name;
export const orgOptionLabel = (o: OrgLite): string => (o.enabled ? orgName(o) : `${orgName(o)} (inactive)`);
export const INACTIVE_ORG_NOTICE = 'This organization is switched off. Everything it recorded stays here as history, and it is marked inactive.';
/** Default organization for a page: the first active one, else the first. */
export const defaultOrganization = (orgs: readonly OrgLite[]): OrgLite | undefined => orgs.find(o => o.enabled) ?? orgs[0];

/** A fighter's rankings in a stable, readable order: whole-organization, then per category, then season; best rank first within a group. */
export function sortFighterRankings(rows: readonly RankingRow[]): RankingRow[] {
  const order: Record<RankingScope, number> = { season: 0, org_career: 1, org_all: 2, career: 3 };
  return [...rows].sort((a, b) => order[a.scope] - order[b.scope] || (a.organizationId ?? '').localeCompare(b.organizationId ?? '') || (a.category ?? '').localeCompare(b.category ?? '') || a.rank - b.rank);
}

// ------------------------------------------------------------------ teams and events
export interface RosterPerson { fighterId: string; displayName: string; gender: string | null }
export interface RosterGroups { male: RosterPerson[]; female: RosterPerson[]; other: RosterPerson[]; unspecified: RosterPerson[] }
export function rosterGroups(people: readonly RosterPerson[]): RosterGroups {
  const g: RosterGroups = { male: [], female: [], other: [], unspecified: [] };
  for (const p of [...people].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    (p.gender === 'male' ? g.male : p.gender === 'female' ? g.female : p.gender === 'other' ? g.other : g.unspecified).push(p);
  }
  return g;
}

export interface EventResultRow { competitionId: string; competitionName: string; category: string; gender: Division; entryId: string; finalPlace: number; points: number; teamId: string | null; fighterId: string | null }
export interface MedalTableRow { key: string; name: string; teamId: string | null; golds: number; silvers: number; bronzes: number; total: number }
/** Medal table by team (group fights) or by fighter name when an entry has no team. Sorted gold, silver, bronze, then name. */
export function medalTable(rows: readonly EventResultRow[], nameOf: (r: EventResultRow) => string): MedalTableRow[] {
  const map = new Map<string, MedalTableRow>();
  for (const r of rows) {
    const m = medalOf(r.finalPlace);
    if (!m) continue;
    const key = r.teamId ?? r.fighterId ?? r.entryId;
    let t = map.get(key);
    if (!t) { t = { key, name: nameOf(r), teamId: r.teamId, golds: 0, silvers: 0, bronzes: 0, total: 0 }; map.set(key, t); }
    if (m === 'gold') t.golds += 1; else if (m === 'silver') t.silvers += 1; else t.bronzes += 1;
    t.total += 1;
  }
  return [...map.values()].sort((a, b) => b.golds - a.golds || b.silvers - a.silvers || b.bronzes - a.bronzes || a.name.localeCompare(b.name));
}

export interface AttendanceEntry { entryId: string; competitionId: string; teamId: string | null; fighterId: string | null; status: string }
export interface AttendanceTotals { entries: number; teams: number; fighters: number }
/** Withdrawn entries are not attendance. Fighters are counted once however many categories they fought in. */
export function attendanceTotals(entries: readonly AttendanceEntry[], participants: readonly { fighterId: string; entryId: string }[]): AttendanceTotals {
  const live = entries.filter(e => e.status !== 'withdrawn');
  const ids = new Set(live.map(e => e.entryId));
  return {
    entries: live.length,
    teams: new Set(live.flatMap(e => (e.teamId ? [e.teamId] : []))).size,
    fighters: new Set(participants.filter(p => ids.has(p.entryId)).map(p => p.fighterId)).size
  };
}
export interface TeamEntryCount { teamId: string; name: string; entries: number }
export function entriesByTeam(entries: readonly AttendanceEntry[], names: ReadonlyMap<string, string>): TeamEntryCount[] {
  const map = new Map<string, TeamEntryCount>();
  for (const e of entries) {
    if (e.status === 'withdrawn' || !e.teamId) continue;
    const t = map.get(e.teamId) ?? { teamId: e.teamId, name: names.get(e.teamId) ?? 'Team', entries: 0 };
    t.entries += 1;
    map.set(e.teamId, t);
  }
  return [...map.values()].sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
}

export interface EventLike { id: string; slug: string; name: string; startsOn: string; endsOn: string; status: string; region: string | null; organizationId: string | null; seasonId: string | null }
export interface PastFilter { seasonId: string; organizationId: string; region: string }
export const pastFilterActive = (f: PastFilter): boolean => Boolean(f.seasonId || f.organizationId || f.region);
/** Past published events, newest first, narrowed by season, organization and province. Cancelled and draft events never count as completed. */
export function pastEvents<T extends EventLike>(events: readonly T[], today: string, f: PastFilter): T[] {
  return events
    .filter(e => e.status === 'published' && e.endsOn < today)
    .filter(e => (!f.seasonId || e.seasonId === f.seasonId) && (!f.organizationId || e.organizationId === f.organizationId) && (!f.region || e.region === f.region))
    .sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.name.localeCompare(b.name));
}
/** Everything that is not a completed published event: upcoming, running, drafts and cancelled (as the page showed before). */
export const notPast = <T extends EventLike>(events: readonly T[], today: string): T[] => events.filter(e => !(e.status === 'published' && e.endsOn < today));

/** Fighters on the roster of a group-fight entry who are guests of that team (role from entry_roster). */
export const guestLabel = (teamName: string): string => `Guest for ${teamName}`;

export interface MembershipLine { id: string; teamName: string; teamSlug: string; role: string; mercenary: boolean; fromDate: string | null; toDate: string | null }
export function membershipSpan(m: Pick<MembershipLine, 'fromDate' | 'toDate'>): string {
  const y = (d: string | null) => (d ? d.slice(0, 4) : null);
  const a = y(m.fromDate), b = y(m.toDate);
  if (a && b) return a === b ? a : `${a} to ${b}`;
  if (a) return `Since ${a}`;
  if (b) return `Until ${b}`;
  return '';
}
export const sortMemberships = <T extends Pick<MembershipLine, 'fromDate' | 'id'>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (b.fromDate ?? '').localeCompare(a.fromDate ?? '') || a.id.localeCompare(b.id));

export interface RecordLine { category: string; matches: number; wins: number; losses: number; draws: number }
/** W-L-D per category from raw match outcomes; biggest category first. */
export function categoryRecords(rows: readonly { category: string; outcome: Outcome }[]): RecordLine[] {
  const map = new Map<string, RecordLine>();
  for (const r of rows) {
    const l = map.get(r.category) ?? { category: r.category, matches: 0, wins: 0, losses: 0, draws: 0 };
    l.matches += 1;
    if (r.outcome === 'win') l.wins += 1; else if (r.outcome === 'loss') l.losses += 1; else l.draws += 1;
    map.set(r.category, l);
  }
  return [...map.values()].sort((a, b) => b.matches - a.matches || a.category.localeCompare(b.category));
}
