import type { CareerContext, CareerLine, CareerResult, Fight, HeadToHeadLine, RepresentedFighter, TeamDisciplineRank, TeamFight } from '../data/careerProfile';
import type { RankingRow } from '../data/fighters';
import { medalOf, outcomeLetter, type Medal, type OrgLite, type Outcome, type SeasonInfo } from './careerView';

/**
 * Pack 10: pure helpers for the fighter and team career profiles. Nothing here reads the database or invents a number: every total comes from
 * fighter_career / team_career rows, every fight from career_fights, every placing from career_results. The helpers only choose, group and word.
 */

// ------------------------------------------------------------------ filters
/** What a profile can be narrowed to: the whole career, one season, or one organization (offered only when there is more than one). */
export interface CareerFilter { kind: 'career' | 'season' | 'organization'; id: string | null; label: string }
export const CAREER_FILTER: CareerFilter = { kind: 'career', id: null, label: 'Career' };
export function careerFilters(lines: readonly CareerLine[], seasons: readonly SeasonInfo[], orgs: readonly OrgLite[], context: CareerContext): CareerFilter[] {
  const mine = lines.filter(l => l.context === context && l.category === null);
  const seasonById = new Map(seasons.map(s => [s.id, s]));
  const seasonRows = mine.filter(l => l.scope === 'season' && l.seasonId && seasonById.has(l.seasonId))
    .map(l => ({ id: l.seasonId as string, season: seasonById.get(l.seasonId as string) as SeasonInfo }))
    .sort((a, b) => b.season.endsOn.localeCompare(a.season.endsOn));
  const orgIds = mine.filter(l => l.scope === 'organization' && l.organizationId).map(l => l.organizationId as string);
  const orgRows = orgIds.length > 1 ? orgs.filter(o => orgIds.includes(o.id)) : [];
  return [CAREER_FILTER, ...seasonRows.map(s => ({ kind: 'season' as const, id: s.id, label: s.season.name })), ...orgRows.map(o => ({ kind: 'organization' as const, id: o.id, label: o.shortName ?? o.name }))];
}
const inFilter = (f: CareerFilter, seasonId: string | null, organizationId: string | null): boolean =>
  f.kind === 'career' || (f.kind === 'season' ? seasonId === f.id : organizationId === f.id);
const lineMatches = (l: CareerLine, f: CareerFilter, context: CareerContext): boolean =>
  l.context === context && l.scope === f.kind && (f.kind === 'career' || (f.kind === 'season' ? l.seasonId === f.id : l.organizationId === f.id));

/** The total row for a filter (undefined when nothing is recorded for it). */
export const careerTotal = (lines: readonly CareerLine[], f: CareerFilter, context: CareerContext): CareerLine | undefined =>
  lines.find(l => lineMatches(l, f, context) && l.category === null);
/** Per-discipline lines for a filter, most fought first. kind narrows to duel categories or team fights. */
export const careerLines = (lines: readonly CareerLine[], f: CareerFilter, context: CareerContext, kind?: 'individual' | 'team'): CareerLine[] =>
  lines.filter(l => lineMatches(l, f, context) && l.category !== null && (!kind || l.kind === kind))
    .sort((a, b) => b.matches - a.matches || b.competitions - a.competitions || (a.categoryName ?? '').localeCompare(b.categoryName ?? ''));
export const fightsIn = <T extends { seasonId: string | null; organizationId: string | null }>(rows: readonly T[], f: CareerFilter): T[] => rows.filter(r => inFilter(f, r.seasonId, r.organizationId));

/** Which rows a page shows: a fictional fighter or team shows its own fictional ("test") history, labelled; everyone else the official record. */
export const contextFor = (synthetic: boolean): CareerContext => (synthetic ? 'test' : 'official');
/** Official rows only (not fictional, not excluded): the ones every total is made of. */
export const official = <T extends { synthetic: boolean; statsExcluded: boolean }>(rows: readonly T[], context: CareerContext): T[] =>
  rows.filter(r => !r.statsExcluded && (context === 'test' ? r.synthetic : !r.synthetic));

// ------------------------------------------------------------------ wording
export const recordText = (l: Pick<CareerLine, 'wins' | 'losses' | 'draws'>): string => `${l.wins} W · ${l.losses} L${l.draws > 0 ? ` · ${l.draws} D` : ''}`;
export const medalsText = (l: Pick<CareerLine, 'golds' | 'silvers' | 'bronzes'>): string =>
  [l.golds > 0 && `${l.golds} gold`, l.silvers > 0 && `${l.silvers} silver`, l.bronzes > 0 && `${l.bronzes} bronze`].filter(Boolean).join(' · ');
export const pointsText = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')} ${n === 1 ? 'point' : 'points'}`;
export const fightWord = (n: number): string => `${n} ${n === 1 ? 'fight' : 'fights'}`;
/** "Won 5 to 2", "Lost by walkover", "Drew 3 to 3": one line a spectator reads at a glance. */
export function fightLine(f: Pick<Fight, 'outcome' | 'scoreFor' | 'scoreAgainst' | 'walkover'>): string {
  const verb = f.outcome === 'win' ? 'Won' : f.outcome === 'loss' ? 'Lost' : 'Drew';
  if (f.walkover) return `${verb} by walkover`;
  return f.scoreFor !== null && f.scoreAgainst !== null ? `${verb} ${f.scoreFor} to ${f.scoreAgainst}` : verb;
}
/** Screen-reader friendly outcome word for the W / L / D strip. */
export const outcomeWord = (o: Outcome): string => (o === 'win' ? 'Win' : o === 'loss' ? 'Loss' : 'Draw');
export const placeWord = (place: number): string => (place === 1 ? 'Gold' : place === 2 ? 'Silver' : place === 3 ? 'Bronze' : `${place}${place % 100 >= 11 && place % 100 <= 13 ? 'th' : place % 10 === 1 ? 'st' : place % 10 === 2 ? 'nd' : place % 10 === 3 ? 'rd' : 'th'} place`);

// ------------------------------------------------------------------ chronology
/** Newest first: event end date, then when the fight was made official, then the id (the order the database lists them in). */
export const newestFirst = <T extends { endsOn: string; finalizedAt: string | null; matchId: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => b.endsOn.localeCompare(a.endsOn) || (b.finalizedAt ?? '').localeCompare(a.finalizedAt ?? '') || b.matchId.localeCompare(a.matchId));
export const formLetters = (rows: readonly { outcome: Outcome }[], n = 5): Array<'W' | 'L' | 'D'> => rows.slice(0, n).map(r => outcomeLetter(r.outcome));

/**
 * The run of wins the fighter is on right now, counted backwards from the newest official fight. Claimed only when the order is certain: two
 * fights of the same event whose times are unknown cannot be ordered, so the streak stops there as "unknown" instead of guessing. A draw ends it.
 */
export function currentWinStreak(rows: readonly Fight[]): { length: number; reliable: boolean } {
  const ordered = newestFirst(rows);
  let length = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const f = ordered[i];
    const prev = ordered[i - 1];
    if (prev && prev.eventId === f.eventId && (!prev.finalizedAt || !f.finalizedAt)) return { length, reliable: false };
    if (f.outcome !== 'win') break;
    length += 1;
  }
  return { length, reliable: true };
}

// ------------------------------------------------------------------ rankings
/** The few rankings worth showing in the hero: best rank first, a running season before an organization's career, at most `max`, one per (organization, category, scope). */
export function rankingHighlights(rows: readonly RankingRow[], seasons: readonly SeasonInfo[], today: string, max = 3): RankingRow[] {
  const seasonById = new Map(seasons.map(s => [s.id, s]));
  const running = (r: RankingRow) => { const s = r.seasonId ? seasonById.get(r.seasonId) : undefined; return !!s && s.startsOn <= today && today <= s.endsOn; };
  const weight = (r: RankingRow) => (r.scope === 'season' ? (running(r) ? 0 : 3) : r.scope === 'org_career' ? 1 : r.scope === 'career' ? 2 : 4);
  return [...rows]
    .filter(r => !(r.scope === 'season' && !running(r)))
    .sort((a, b) => a.rank - b.rank || weight(a) - weight(b) || b.points - a.points)
    .slice(0, max);
}

// ------------------------------------------------------------------ events
export interface EventPlacing { competitionId: string; competitionName: string; category: string; categoryName: string; place: number; medal: Medal | null; points: number; teamName: string | null; teamSlug: string | null; kind: 'individual' | 'team'; entryStatus: string }
export interface EventLine {
  eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null; synthetic: boolean; statsExcluded: boolean;
  placings: EventPlacing[]; fights: number; wins: number; losses: number; draws: number;
  /** The teams the fighter fought for at that event, from the records (usually one). */
  teams: Array<{ id: string; name: string; slug: string | null }>;
}
/** The fighter's events, newest first: placings and the fights fought at each, with the team represented THERE (never the team today). */
export function eventHistory(results: readonly CareerResult[], fights: readonly Fight[]): EventLine[] {
  const map = new Map<string, EventLine>();
  const line = (r: { eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null; synthetic: boolean; statsExcluded: boolean }) => {
    let e = map.get(r.eventId);
    if (!e) { e = { eventId: r.eventId, eventSlug: r.eventSlug, eventName: r.eventName, startsOn: r.startsOn, endsOn: r.endsOn, seasonId: r.seasonId, organizationId: r.organizationId, synthetic: r.synthetic, statsExcluded: r.statsExcluded, placings: [], fights: 0, wins: 0, losses: 0, draws: 0, teams: [] }; map.set(r.eventId, e); }
    return e;
  };
  const addTeam = (e: EventLine, id: string | null, name: string | null, slug: string | null) => { if (id && name && !e.teams.some(t => t.id === id)) e.teams.push({ id, name, slug }); };
  for (const r of results) {
    const e = line(r);
    e.placings.push({ competitionId: r.competitionId, competitionName: r.competitionName, category: r.category, categoryName: r.categoryName, place: r.finalPlace, medal: medalOf(r.finalPlace), points: r.points, teamName: r.teamName, teamSlug: r.teamSlug, kind: r.kind, entryStatus: r.entryStatus });
    addTeam(e, r.teamId, r.teamName, r.teamSlug);
  }
  for (const f of fights) {
    const e = line(f);
    e.fights += 1;
    if (f.outcome === 'win') e.wins += 1; else if (f.outcome === 'loss') e.losses += 1; else e.draws += 1;
    addTeam(e, f.teamId, f.teamName, f.teamSlug);
  }
  for (const e of map.values()) e.placings.sort((a, b) => a.place - b.place || a.competitionName.localeCompare(b.competitionName));
  return [...map.values()].sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.eventName.localeCompare(b.eventName));
}

/** The teams a fighter represented in official history, from the records: each with the events it is proven at. No joined / left dates are invented. */
export interface RepresentedTeam { id: string; name: string; slug: string | null; events: Array<{ eventId: string; eventName: string; eventSlug: string; endsOn: string }>; firstOn: string; lastOn: string }
export function teamsRepresented(events: readonly EventLine[]): RepresentedTeam[] {
  const map = new Map<string, RepresentedTeam>();
  for (const e of events) {
    for (const t of e.teams) {
      let r = map.get(t.id);
      if (!r) { r = { id: t.id, name: t.name, slug: t.slug, events: [], firstOn: e.endsOn, lastOn: e.endsOn }; map.set(t.id, r); }
      r.events.push({ eventId: e.eventId, eventName: e.eventName, eventSlug: e.eventSlug, endsOn: e.endsOn });
      if (e.endsOn < r.firstOn) r.firstOn = e.endsOn;
      if (e.endsOn > r.lastOn) r.lastOn = e.endsOn;
    }
  }
  const out = [...map.values()];
  for (const r of out) r.events.sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  return out.sort((a, b) => b.lastOn.localeCompare(a.lastOn) || a.name.localeCompare(b.name));
}
/** "2025" or "2025 to 2026": the years the evidence spans (never a membership period). */
export const yearSpan = (firstOn: string, lastOn: string): string => (firstOn.slice(0, 4) === lastOn.slice(0, 4) ? firstOn.slice(0, 4) : `${firstOn.slice(0, 4)} to ${lastOn.slice(0, 4)}`);

// ------------------------------------------------------------------ highlights (deterministic rules only)
export interface Highlight { label: string; value: string; to?: string }
export function careerHighlights(a: { total: CareerLine | undefined; lines: readonly CareerLine[]; events: readonly EventLine[]; rankings: readonly RankingRow[]; fights: readonly Fight[]; rankingLabel: (r: RankingRow) => string }): Highlight[] {
  const out: Highlight[] = [];
  const gold = a.events.flatMap(e => e.placings.filter(p => p.place === 1).map(p => ({ e, p }))).sort((x, y) => y.e.endsOn.localeCompare(x.e.endsOn))[0];
  if (gold) out.push({ label: 'Most recent gold', value: `${gold.p.competitionName} · ${gold.e.eventName}`, to: `/events/${gold.e.eventSlug}` });
  const best = [...a.rankings].sort((x, y) => x.rank - y.rank || y.points - x.points)[0];
  if (best) out.push({ label: 'Best current ranking', value: `#${best.rank} ${a.rankingLabel(best)}`, to: '/rankings' });
  const most = a.lines.filter(l => l.kind === 'individual').sort((x, y) => y.matches - x.matches)[0];
  if (most && most.matches > 0) out.push({ label: 'Most fought discipline', value: `${most.categoryName ?? most.category} · ${fightWord(most.matches)}` });
  const streak = currentWinStreak(a.fights);
  if (streak.reliable && streak.length >= 3) out.push({ label: 'Current win streak', value: fightWord(streak.length) });
  const last = a.events[0];
  if (last) out.push({ label: 'Most recent event', value: last.eventName, to: `/events/${last.eventSlug}` });
  return out;
}

// ------------------------------------------------------------------ head to head
export interface Opponent { id: string; name: string; slug: string | null; meetings: number; wins: number; losses: number; draws: number; lastOn: string | null; byCategory: HeadToHeadLine[] }
/** Opponents in the chosen context, most met first, each with its per-category split. */
export function opponents(lines: readonly HeadToHeadLine[], context: CareerContext): Opponent[] {
  const totals = lines.filter(l => l.context === context && l.category === null);
  return totals.map(t => ({
    id: t.opponentId, name: t.opponentName, slug: t.opponentSlug, meetings: t.meetings, wins: t.wins, losses: t.losses, draws: t.draws, lastOn: t.lastOn,
    byCategory: lines.filter(l => l.context === context && l.opponentId === t.opponentId && l.category !== null).sort((a, b) => b.meetings - a.meetings || (a.categoryName ?? '').localeCompare(b.categoryName ?? ''))
  })).sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name));
}
/** "Bob 4 · John 2 · Draws 1" */
export const headToHeadLine = (me: string, o: Pick<Opponent, 'name' | 'wins' | 'losses' | 'draws'>): string => `${me} ${o.wins} · ${o.name} ${o.losses}${o.draws > 0 ? ` · Draws ${o.draws}` : ''}`;
export const splitText = (l: Pick<HeadToHeadLine, 'wins' | 'losses' | 'draws'>): string => `${l.wins} to ${l.losses}${l.draws > 0 ? ` (${l.draws} drawn)` : ''}`;

// ------------------------------------------------------------------ teams
export interface TeamEventLine {
  eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null; synthetic: boolean; statsExcluded: boolean;
  /** Competitions the team itself entered (group fights), with its record and placing. */
  direct: Array<{ competitionId: string; competitionName: string; categoryName: string; fights: number; wins: number; losses: number; draws: number; place: number | null; medal: Medal | null; points: number }>;
  /** Fighters who represented the team in individual competitions there. */
  represented: { fighters: number; results: number; golds: number; silvers: number; bronzes: number; names: string[] };
}
/** Events the team has history at, newest first, keeping what the TEAM fought apart from what duelists fought for it. */
export function teamEventHistory(teamFights: readonly TeamFight[], represented: readonly (CareerResult & { fighterId: string })[], nameOf: (fighterId: string) => string | undefined): TeamEventLine[] {
  const map = new Map<string, TeamEventLine>();
  const line = (r: { eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null; synthetic: boolean; statsExcluded: boolean }) => {
    let e = map.get(r.eventId);
    if (!e) { e = { eventId: r.eventId, eventSlug: r.eventSlug, eventName: r.eventName, startsOn: r.startsOn, endsOn: r.endsOn, seasonId: r.seasonId, organizationId: r.organizationId, synthetic: r.synthetic, statsExcluded: r.statsExcluded, direct: [], represented: { fighters: 0, results: 0, golds: 0, silvers: 0, bronzes: 0, names: [] } }; map.set(r.eventId, e); }
    return e;
  };
  for (const f of teamFights) {
    const e = line(f);
    let c = e.direct.find(d => d.competitionId === f.competitionId);
    if (!c) { c = { competitionId: f.competitionId, competitionName: f.competitionName, categoryName: f.categoryName, fights: 0, wins: 0, losses: 0, draws: 0, place: f.finalPlace, medal: medalOf(f.finalPlace), points: f.points }; e.direct.push(c); }
    c.fights += 1;
    if (f.outcome === 'win') c.wins += 1; else if (f.outcome === 'loss') c.losses += 1; else c.draws += 1;
  }
  const seen = new Map<string, Set<string>>();
  for (const r of represented) {
    const e = line(r);
    e.represented.results += 1;
    if (r.finalPlace === 1) e.represented.golds += 1; else if (r.finalPlace === 2) e.represented.silvers += 1; else if (r.finalPlace === 3) e.represented.bronzes += 1;
    const s = seen.get(r.eventId) ?? new Set<string>();
    if (!s.has(r.fighterId)) { s.add(r.fighterId); seen.set(r.eventId, s); e.represented.fighters += 1; const n = nameOf(r.fighterId); if (n) e.represented.names.push(n); }
  }
  for (const e of map.values()) { e.direct.sort((a, b) => a.competitionName.localeCompare(b.competitionName)); e.represented.names.sort(); }
  return [...map.values()].sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.eventName.localeCompare(b.eventName));
}

/** The team's discipline totals for a filter: one row per discipline (all divisions together), best rank first. Season totals need the organization. */
export function disciplineTotals(rows: readonly TeamDisciplineRank[], f: CareerFilter, organizationId: string | null): TeamDisciplineRank[] {
  const pick = rows.filter(r => r.gender === null && (
    f.kind === 'career' ? r.scope === 'career' : f.kind === 'season' ? r.scope === 'season' && r.seasonId === f.id : r.scope === 'org_career' && r.organizationId === f.id));
  const narrowed = f.kind === 'season' && organizationId ? pick.filter(r => r.organizationId === organizationId) : pick;
  return [...narrowed].sort((a, b) => a.rank - b.rank || b.points - a.points || a.categoryName.localeCompare(b.categoryName));
}
/** The filter a discipline total's contributor list needs (the same view Rankings > Teams reads). */
export const contributionScope = (f: CareerFilter, organizationId: string | null): { scope: 'season' | 'org_career' | 'career'; organizationId: string | null; seasonId: string | null } =>
  f.kind === 'career' ? { scope: 'career', organizationId: null, seasonId: null } : f.kind === 'season' ? { scope: 'season', organizationId, seasonId: f.id } : { scope: 'org_career', organizationId: f.id, seasonId: null };

/** Represented fighters in the chosen context, most recent first; `current` marks those on the public roster today. */
export const representedList = (rows: readonly RepresentedFighter[], context: CareerContext, rosterIds: ReadonlySet<string>): Array<RepresentedFighter & { current: boolean }> =>
  rows.filter(r => r.context === context).map(r => ({ ...r, current: rosterIds.has(r.fighterId) })).sort((a, b) => (b.lastOn ?? '').localeCompare(a.lastOn ?? '') || a.displayName.localeCompare(b.displayName));
export function representedText(r: RepresentedFighter): string {
  const parts: string[] = [];
  if (r.individualResults > 0) parts.push(`${r.individualResults} individual ${r.individualResults === 1 ? 'result' : 'results'}`);
  if (r.teamFights > 0) parts.push(`${r.teamFights} team ${r.teamFights === 1 ? 'fight' : 'fights'}`);
  if (parts.length === 0 && r.individualFights > 0) parts.push(fightWord(r.individualFights));
  return parts.join(' · ');
}

/**
 * A fighter's Upcoming list. A real fighter's public profile does not list fictional (synthetic) events: those are labelled demo and rehearsal data,
 * hidden from the events list by default, and next to a real event's name ("Red Deer Rumble-test" beside the Red Deer Rumble) they mislead
 * (domain rehearsal 2026-10-30, O2). A fictional fighter's profile lists them, as its career does. Cancelled events never show.
 */
export function upcomingFor<T extends { endsOn: string; startsOn: string; eventStatus: string; eventSlug: string }>(a: readonly T[], today: string, context: CareerContext, fictionalEvent: (slug: string) => boolean): T[] {
  return a.filter(x => x.endsOn >= today && x.eventStatus !== 'cancelled' && (context === 'test' || !fictionalEvent(x.eventSlug)))
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn));
}
