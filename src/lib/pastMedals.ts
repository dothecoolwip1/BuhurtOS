import type { CareerResult } from '../data/careerProfile';
import { dateRange } from './dates';

/**
 * Past medals: tournaments that were not run in BuhurtOS, kept for their medals (events.medals_only). A fighter reports their own podium
 * places there; nothing was fought or scored here, so the placings are "reported, not verified" and earn no ranking points.
 * Pure rules for the form and the lists; the database (add_past_medal) decides everything that matters.
 */
export interface PastMedalEvent { id: string; slug: string; name: string; startsOn: string; endsOn: string; city: string | null; region: string | null; timeNote: string | null }
export interface DisciplineOption { code: string; name: string; league: string; sort: number }
export interface PastMedalRecord { resultId: string; competitionId: string; eventId: string; finalPlace: number; status: 'official' | 'imported' | 'unverified'; note: string | null; reportedAt: string }
export interface PastMedalDraft { eventId: string; category: string; place: number; note: string }

export const EMPTY_DRAFT: PastMedalDraft = { eventId: '', category: '', place: 0, note: '' };
export const MEDAL_PLACES: ReadonlyArray<readonly [number, string]> = [[1, 'Gold'], [2, 'Silver'], [3, 'Bronze']];
export const NOTE_MAX = 300;

/** Individual disciplines only, in the usual order: team medals (3v3, 5v5 ...) are not reported here yet. */
export const reportableDisciplines = (all: readonly DisciplineOption[]): DisciplineOption[] =>
  all.filter(d => d.league !== 'buhurt').slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

/** Newest tournament first; a placeholder date (see the time note) is still shown as what it is. */
export const sortPastMedalEvents = (events: readonly PastMedalEvent[]): PastMedalEvent[] =>
  events.slice().sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.name.localeCompare(b.name));

export const eventWhen = (e: Pick<PastMedalEvent, 'startsOn' | 'endsOn' | 'timeNote'>): string =>
  e.timeNote ? `${dateRange(e.startsOn, e.endsOn)} (${e.timeNote.toLowerCase()})` : dateRange(e.startsOn, e.endsOn);

export const eventWhere = (e: Pick<PastMedalEvent, 'city' | 'region'>): string | null => [e.city, e.region].filter(Boolean).join(', ') || null;

/** The medal this fighter already has in that discipline at that tournament, if any (the database refuses a second, different one). */
export const alreadyReported = (results: readonly CareerResult[], eventId: string, category: string): CareerResult | undefined =>
  results.find(r => r.eventId === eventId && r.category === category && r.kind === 'individual');

/** Why the draft cannot be sent yet, in the fighter's words; null when it can. */
export function draftProblem(d: PastMedalDraft, events: readonly PastMedalEvent[], disciplines: readonly DisciplineOption[], results: readonly CareerResult[] = []): string | null {
  if (!d.eventId) return 'Choose the tournament.';
  if (!events.some(e => e.id === d.eventId)) return 'That tournament is not one that takes reported medals.';
  if (!d.category) return 'Choose the discipline.';
  const disc = disciplines.find(x => x.code === d.category);
  if (!disc) return 'Choose a discipline from the list.';
  if (disc.league === 'buhurt') return 'Team medals cannot be added here yet; individual disciplines only.';
  if (![1, 2, 3].includes(d.place)) return 'Choose gold, silver or bronze.';
  if (d.note.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  const had = alreadyReported(results, d.eventId, d.category);
  if (had && had.finalPlace !== d.place) return `You already have ${placeName(had.finalPlace)} in ${disc.name} there. Remove it first if that was wrong.`;
  return null;
}

export const placeName = (place: number): string => MEDAL_PLACES.find(([p]) => p === place)?.[1] ?? `${place}th place`;

/** What a reported placing is, for the person looking at it. */
export const reportStatusText = (status: PastMedalRecord['status']): string =>
  status === 'unverified' ? 'Reported by the fighter · not verified' : status === 'imported' ? 'From a recorded source' : 'Verified';

export interface PastMedalGroup { event: PastMedalEvent; medals: Array<{ result: CareerResult; record: PastMedalRecord | null }> }

/** A fighter's placings at medals-only tournaments, newest tournament first, each with the status of its report when known. */
export function medalsAtPastTournaments(results: readonly CareerResult[], events: readonly PastMedalEvent[], records: readonly PastMedalRecord[] = []): PastMedalGroup[] {
  const byId = new Map(events.map(e => [e.id, e]));
  const recordOf = new Map(records.map(r => [r.competitionId, r]));
  const groups = new Map<string, PastMedalGroup>();
  for (const r of results) {
    const e = byId.get(r.eventId);
    if (!e) continue;
    let g = groups.get(e.id);
    if (!g) { g = { event: e, medals: [] }; groups.set(e.id, g); }
    g.medals.push({ result: r, record: recordOf.get(r.competitionId) ?? null });
  }
  const out = [...groups.values()];
  for (const g of out) g.medals.sort((a, b) => a.result.finalPlace - b.result.finalPlace || a.result.competitionName.localeCompare(b.result.competitionName));
  return out.sort((a, b) => b.event.endsOn.localeCompare(a.event.endsOn) || a.event.name.localeCompare(b.event.name));
}
