/** Pure helpers for the public team directory and team workspace. No database calls here. */

export interface DirectoryAffiliation { organizationSlug: string; organizationName: string }
export interface DirectoryTeam {
  name: string; city: string | null; region: string | null; country: string | null;
  affiliations: DirectoryAffiliation[];
}

export interface RecordSourceRef { kind: 'official' | 'imported' | 'submitted' | 'observed'; title: string; url: string | null; status: 'official' | 'imported' | 'unverified' }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function locationText(t: Pick<DirectoryTeam, 'city' | 'region' | 'country'>): string {
  return [t.city, t.region, t.country].map(v => v?.trim()).filter((v): v is string => Boolean(v)).join(', ');
}

/** Matches every word of the query against name, city, region and country. An empty query matches everything. */
export function matchesQuery(t: DirectoryTeam, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm([t.name, t.city, t.region, t.country].filter(Boolean).join(' '));
  return words.every(w => hay.includes(w));
}

/** orgSlug '' means any. Only recorded affiliations count, never location. */
export function filterTeams<T extends DirectoryTeam>(teams: T[], query: string, orgSlug: string): T[] {
  return teams.filter(t => matchesQuery(t, query) && (orgSlug === '' || t.affiliations.some(a => a.organizationSlug === orgSlug)));
}

/** The organizations that appear on at least one team, sorted by name. */
export function affiliationOptions(teams: DirectoryTeam[]): DirectoryAffiliation[] {
  const seen = new Map<string, DirectoryAffiliation>();
  for (const t of teams) for (const a of t.affiliations) if (!seen.has(a.organizationSlug)) seen.set(a.organizationSlug, { organizationSlug: a.organizationSlug, organizationName: a.organizationName });
  return [...seen.values()].sort((a, b) => a.organizationName.localeCompare(b.organizationName));
}

/** "Listed from HACSA website: Teams list (imported)". */
export function listedFromLabel(src: Pick<RecordSourceRef, 'title' | 'status'>): string {
  return `Listed from ${src.title} (${src.status})`;
}
export const NO_SOURCE_LABEL = 'No source recorded for this listing';

export const PENDING_LABEL = 'Pending approval: only visible to organizers';

/**
 * Whether a team has joined BuhurtOS. A team has joined when it has a captain with an account, but account links are private
 * and cannot be read publicly, so callers pass null (unknown) and nothing is shown. Never guess.
 */
export function adoptionLabel(hasCaptain: boolean | null): string | null {
  if (hasCaptain === null) return null;
  return hasCaptain ? 'On BuhurtOS' : 'Team has not joined BuhurtOS';
}

const RELATION_LABEL: Record<string, string> = { member: 'Member', recognized: 'Recognized', affiliate: 'Affiliate', other: 'Related' };
export const relationLabel = (r: string) => RELATION_LABEL[r] ?? 'Related';

const ROLE_LABEL: Record<string, string> = { fighter: 'Fighter', captain: 'Captain', coach: 'Coach', squire: 'Squire', other: 'Other' };
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? 'Other';

/** A role in a fighter's team HISTORY. Captain here is a sporting role; who may manage the team page is decided elsewhere (team_roles). */
export const historyRoleLabel = (r: string) => (r === 'captain' ? 'Captain · team history' : roleLabel(r));
export const HISTORY_ROLE_NOTE = '“Captain · team history” is a role the fighter held on the team. It does not give access to manage the team page.';

/** "Since Mar 2024", or null when the start date is unknown. Plain calendar dates, no time zone. */
export function sinceLabel(since: string | null): string | null {
  if (!since || !/^\d{4}-\d{2}-\d{2}/.test(since)) return null;
  const [y, m] = since.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m >= 1 && m <= 12 ? `Since ${months[m - 1]} ${y}` : null;
}

export interface ResultRow { eventName: string; eventSlug: string; startsOn: string; competitionName: string; finalPlace: number | null; points: number | null }

/** Only rows with a recorded final place count. Returns null when there is nothing real to summarize. */
export function summarizeResults(rows: ResultRow[]): { competitions: number; events: number; podiums: number; bestPlace: number } | null {
  const placed = rows.filter((r): r is ResultRow & { finalPlace: number } => r.finalPlace !== null);
  if (placed.length === 0) return null;
  return {
    competitions: placed.length,
    events: new Set(placed.map(r => r.eventSlug)).size,
    podiums: placed.filter(r => r.finalPlace <= 3).length,
    bestPlace: Math.min(...placed.map(r => r.finalPlace))
  };
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Safe https link or null (website and social links are validated by the database too). */
export const safeHttpsUrl = (u: string | null | undefined): string | null => (u && /^https:\/\//.test(u) ? u : null);

export const NO_ORGANIZATION = 'No organization';
export interface OrgGroup<T> { key: string; name: string; teams: T[] }

/**
 * Teams under the organization they are a member of (the first affiliation when there are several), organizations sorted by name,
 * "No organization" last. Only recorded affiliations count, never location. Teams keep the order they came in.
 */
export function groupByOrganization<T>(teams: readonly T[], orgOf: (t: T) => { slug: string; name: string } | null): OrgGroup<T>[] {
  const by = new Map<string, OrgGroup<T>>();
  for (const t of teams) {
    const o = orgOf(t);
    const key = o?.slug ?? '';
    const g = by.get(key) ?? { key, name: o?.name ?? NO_ORGANIZATION, teams: [] };
    g.teams.push(t);
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)));
}
