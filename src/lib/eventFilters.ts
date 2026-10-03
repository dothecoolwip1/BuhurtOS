import type { LiveEvent } from '../data/api';
import type { LeagueId } from '../data/types';
import { eventPhase, orgName, type OrgLite, type Phase, type SeasonInfo } from './careerView';
import type { SyntheticSet } from '../data/synthetic';
import { isSynthetic } from '../data/synthetic';

/**
 * One set of search, filter, sort and grouping rules for every view over events: the public Events list, the Calendar, My events and
 * the owner's platform list. Pure functions; nothing here reads the database.
 */

export type EventWhen = 'upcoming' | 'past' | 'all';
export type EventStatusFilter = '' | 'draft' | 'published' | 'finished' | 'cancelled';
export type EventRole = 'organizer' | 'head_marshal' | 'marshal' | 'scorekeeper' | 'medic' | 'fighter' | 'volunteer' | 'captain' | 'invited' | 'org_admin';
export const ROLE_LABEL: Record<EventRole, string> = {
  organizer: 'Organizer', head_marshal: 'Head marshal', marshal: 'Marshal', scorekeeper: 'Scorekeeper', medic: 'Medic', fighter: 'Fighter', volunteer: 'Volunteer',
  captain: 'Captain', invited: 'Added by organizer', org_admin: 'Organization admin'
};
export const ROLE_FILTERS: ReadonlyArray<readonly [EventRole, string]> = [
  ['fighter', 'Fighter'], ['organizer', 'Organizer'], ['captain', 'Captain'], ['marshal', 'Marshal'], ['head_marshal', 'Head marshal'], ['scorekeeper', 'Scorekeeper'], ['medic', 'Medic'],
  ['volunteer', 'Volunteer'], ['invited', 'Added by organizer'], ['org_admin', 'Organization admin']
];
export const FORMAT_FILTERS: ReadonlyArray<readonly ['all' | LeagueId, string]> = [['all', 'All'], ['buhurt', 'Group fight'], ['duels', 'Duels'], ['outrance', 'Profight']];
export const STATUS_FILTERS: ReadonlyArray<readonly [EventStatusFilter, string]> = [['', 'Any status'], ['published', 'Published'], ['draft', 'Draft'], ['finished', 'Finished'], ['cancelled', 'Cancelled']];

export interface EventFilter {
  q: string; format: 'all' | LeagueId; org: string; region: string; type: string; status: EventStatusFilter; when: EventWhen;
  /** Show fictional/test events. Off by default everywhere. */
  test: boolean;
  /** Only events where the viewer has this relationship ('' = any relationship on My events, ignored elsewhere). */
  role: EventRole | '';
}
export const DEFAULT_FILTER: EventFilter = { q: '', format: 'all', org: '', region: '', type: '', status: '', when: 'upcoming', test: false, role: '' };

/** Reads a filter from the URL (?q=&format=&org=&province=&type=&status=&when=&test=1&role=), ignoring values it does not know. */
export function parseEventFilter(params: URLSearchParams, defaults: Partial<EventFilter> = {}): EventFilter {
  const d = { ...DEFAULT_FILTER, ...defaults };
  const pick = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T => (raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback);
  return {
    q: params.get('q') ?? d.q,
    format: pick(params.get('format'), FORMAT_FILTERS.map(([k]) => k), d.format),
    org: params.get('org') ?? d.org, region: params.get('province') ?? d.region, type: params.get('type') ?? d.type,
    status: pick(params.get('status'), STATUS_FILTERS.map(([k]) => k), d.status),
    when: pick(params.get('when'), ['upcoming', 'past', 'all'] as const, d.when),
    test: params.has('test') ? params.get('test') === '1' : d.test,
    role: pick(params.get('role'), ['', ...ROLE_FILTERS.map(([k]) => k)] as const, d.role)
  };
}
/** The URL for a filter: only what differs from the defaults, so links stay short. */
export function eventFilterParams(f: EventFilter, defaults: Partial<EventFilter> = {}): URLSearchParams {
  const d = { ...DEFAULT_FILTER, ...defaults };
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.format !== d.format) p.set('format', f.format);
  if (f.org !== d.org) p.set('org', f.org);
  if (f.region !== d.region) p.set('province', f.region);
  if (f.type !== d.type) p.set('type', f.type);
  if (f.status !== d.status) p.set('status', f.status);
  if (f.when !== d.when) p.set('when', f.when);
  if (f.test !== d.test) p.set('test', f.test ? '1' : '0');
  if (f.role !== d.role) p.set('role', f.role);
  return p;
}
export const activeFilterCount = (f: EventFilter, defaults: Partial<EventFilter> = {}): number => {
  const d = { ...DEFAULT_FILTER, ...defaults };
  return (['format', 'org', 'region', 'type', 'status', 'test', 'role'] as const).filter(k => f[k] !== d[k]).length;
};

/** An event with everything the views need to filter and label it. */
export interface IndexedEvent extends LiveEvent {
  synthetic: boolean;
  /** The viewer's relationships (empty for anonymous visitors and for events they are not part of). */
  roles: EventRole[];
  orgLabel: string | null; orgEnabled: boolean;
  /** The organization that counts for filters: the event's own, else its season's. */
  orgId: string | null;
}
export function indexEvents(events: readonly LiveEvent[], synthetic: SyntheticSet, relations: ReadonlyMap<string, readonly string[]>, orgs: readonly OrgLite[], seasons: readonly SeasonInfo[] = []): IndexedEvent[] {
  const orgById = new Map(orgs.map(o => [o.id, o]));
  const seasonOrg = new Map(seasons.map(s => [s.id, s.organizationId]));
  return events.map(e => {
    const orgId = e.organizationId ?? (e.seasonId ? seasonOrg.get(e.seasonId) ?? null : null);
    const o = orgId ? orgById.get(orgId) : undefined;
    return { ...e, synthetic: isSynthetic(synthetic, 'event', e.id) || isSynthetic(synthetic, 'event', e.slug), roles: [...new Set((relations.get(e.id) ?? []) as EventRole[])], orgLabel: o ? orgName(o) : null, orgEnabled: o?.enabled ?? true, orgId };
  });
}

const fold = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Every word of the query has to appear in the name, venue, city, province, organization or type. */
export function matchesEventQuery(e: Pick<IndexedEvent, 'name' | 'venue' | 'city' | 'region' | 'orgLabel' | 'eventType'>, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([e.name, e.venue, e.city, e.region, e.orgLabel, e.eventType].filter(Boolean).join(' '));
  return words.every(w => hay.includes(w));
}

export const isFinished = (e: Pick<LiveEvent, 'status' | 'endsOn'>, today: string): boolean => e.status === 'published' && e.endsOn < today;

/** The rules every view shares. `mine` limits to events with a relationship (My events); `role` narrows further. */
export function applyEventFilter<T extends IndexedEvent>(events: readonly T[], f: EventFilter, today: string, mine = false): T[] {
  return events.filter(e => {
    if (e.synthetic && !f.test) return false;
    if (mine && e.roles.length === 0) return false;
    if (mine && f.role && !e.roles.includes(f.role)) return false;
    if (!matchesEventQuery(e, f.q)) return false;
    if (f.format !== 'all' && !e.leagues.includes(f.format)) return false;
    if (f.org && e.orgId !== f.org) return false;
    if (f.region && e.region !== f.region) return false;
    if (f.type && e.eventType !== f.type) return false;
    if (f.status === 'finished' ? !isFinished(e, today) : f.status && e.status !== f.status) return false;
    const past = e.endsOn < today;
    if (f.when === 'upcoming' && past && e.status !== 'draft') return false;
    if (f.when === 'past' && !past) return false;
    return true;
  });
}

export type EventGroup = 'now' | 'upcoming' | 'drafts' | 'past';
export const GROUP_LABEL: Record<EventGroup, string> = { now: 'Happening now', upcoming: 'Upcoming', drafts: 'Drafts', past: 'Past' };
export function eventGroup(e: Pick<LiveEvent, 'status' | 'startsOn' | 'endsOn'>, today: string): EventGroup {
  if (e.status === 'draft') return 'drafts';
  const phase: Phase = eventPhase(e.startsOn, e.endsOn, today);
  return phase === 'current' ? 'now' : phase === 'upcoming' ? 'upcoming' : 'past';
}
const GROUP_ORDER: Record<EventGroup, number> = { now: 0, upcoming: 1, drafts: 2, past: 3 };
/** Happening now, then the nearest upcoming first, then drafts (soonest first), then past events newest first. Never database order. */
export function sortEvents<T extends Pick<LiveEvent, 'status' | 'startsOn' | 'endsOn' | 'name'>>(events: readonly T[], today: string): T[] {
  return [...events].sort((a, b) => {
    const ga = eventGroup(a, today), gb = eventGroup(b, today);
    if (ga !== gb) return GROUP_ORDER[ga] - GROUP_ORDER[gb];
    if (ga === 'past') return b.endsOn.localeCompare(a.endsOn) || a.name.localeCompare(b.name);
    return a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name);
  });
}
export function groupEvents<T extends Pick<LiveEvent, 'status' | 'startsOn' | 'endsOn' | 'name'>>(events: readonly T[], today: string): Record<EventGroup, T[]> {
  const g: Record<EventGroup, T[]> = { now: [], upcoming: [], drafts: [], past: [] };
  for (const e of sortEvents(events, today)) g[eventGroup(e, today)].push(e);
  return g;
}

/** What a draft still needs before it can be published, in two or three words; null when nothing obvious. */
export function eventAttention(e: Pick<LiveEvent, 'status' | 'eventType' | 'competitionCount' | 'venue' | 'address'>): string | null {
  if (e.status !== 'draft') return null;
  if (e.eventType === 'tournament' && e.competitionCount === 0) return 'Needs competition setup';
  if (!e.venue && !e.address) return 'Needs a venue';
  return null;
}

/** The choices the selects offer: only values that appear in the events being filtered. */
export function filterOptions(events: readonly IndexedEvent[], orgs: readonly OrgLite[]): { orgs: OrgLite[]; regions: string[]; types: string[] } {
  const orgIds = new Set(events.map(e => e.orgId).filter(Boolean));
  return {
    orgs: orgs.filter(o => orgIds.has(o.id)),
    regions: [...new Set(events.map(e => e.region).filter((r): r is string => Boolean(r)))].sort(),
    types: [...new Set(events.map(e => e.eventType))].sort()
  };
}

// ------------------------------------------------------------------ calendar
export interface CalendarDay { iso: string; day: number; inMonth: boolean; today: boolean }
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;
export const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;
export function parseMonth(raw: string | null, today: string): { y: number; m: number } {
  const mm = /^(\d{4})-(\d{2})$/.exec(raw ?? '');
  if (mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) return { y: Number(mm[1]), m: Number(mm[2]) };
  return { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
}
export const addMonths = (y: number, m: number, delta: number): { y: number; m: number } => {
  const t = (y * 12 + (m - 1)) + delta;
  return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
};
/** Six rows of seven days (weeks start on Monday), with the days outside the month marked. Plain calendar dates, no time zones. */
export function monthGrid(y: number, m: number, today: string): CalendarDay[][] {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(y, m - 1, 1 - lead));
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const iso = isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      row.push({ iso, day: dt.getUTCDate(), inMonth: dt.getUTCMonth() + 1 === m && dt.getUTCFullYear() === y, today: iso === today });
    }
    weeks.push(row);
    if (w >= 3 && weeks[w][6].inMonth === false && weeks[w][0].inMonth === false) { weeks.pop(); break; }
  }
  return weeks;
}
/** Events that run on that day (multi-day events count every day they cover). */
export const eventsOnDay = <T extends Pick<LiveEvent, 'startsOn' | 'endsOn'>>(events: readonly T[], iso: string): T[] => events.filter(e => e.startsOn <= iso && iso <= e.endsOn);
export const eventsInMonth = <T extends Pick<LiveEvent, 'startsOn' | 'endsOn'>>(events: readonly T[], y: number, m: number): T[] => {
  const from = isoDate(y, m, 1), to = isoDate(y, m, 31);
  return events.filter(e => e.startsOn <= to && e.endsOn >= from);
};

// ------------------------------------------------------------------ export to other calendars (all-day events, plain dates)
const compact = (iso: string) => iso.replace(/-/g, '');
const nextDay = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const where = (e: Pick<LiveEvent, 'venue' | 'address' | 'city' | 'region'>) => [e.venue, e.address, [e.city, e.region].filter(Boolean).join(', ')].filter(Boolean).join(', ');
export function googleCalendarUrl(e: Pick<LiveEvent, 'name' | 'startsOn' | 'endsOn' | 'venue' | 'address' | 'city' | 'region' | 'slug'>, origin: string): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.name, dates: `${compact(e.startsOn)}/${compact(nextDay(e.endsOn))}`, location: where(e), details: `${origin}/events/${e.slug}` });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
export function icsForEvent(e: Pick<LiveEvent, 'name' | 'startsOn' | 'endsOn' | 'venue' | 'address' | 'city' | 'region' | 'slug' | 'id'>, origin: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BuhurtOS//Events//EN', 'BEGIN:VEVENT', `UID:${e.id}@buhurtos`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(e.startsOn)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.endsOn))}`,
    `SUMMARY:${icsEscape(e.name)}`, `LOCATION:${icsEscape(where(e))}`, `URL:${origin}/events/${e.slug}`, `DESCRIPTION:${icsEscape(`${origin}/events/${e.slug}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
