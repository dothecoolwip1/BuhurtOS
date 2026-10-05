import type { LiveCompetition } from '../data/api';
import type { ClosePreflight, FinalizePreflight, OfficialResult, Placement } from '../data/finalization';
import type { CompetitionMatch } from '../data/matches';

/**
 * Pure helpers for the tournament-completion screens. The sums, placings and blockers are the database's; this file only decides what the
 * screens show for them (which competition is ready, how a podium is laid out, how a shared place reads).
 */

/** The record state of one competition, from its row and its fights. 'reopened' is running after an official result was taken back. */
export type RecordState = 'official' | 'reopened' | 'ready' | 'running' | 'no_draw';
export function recordState(comp: Pick<LiveCompetition, 'status' | 'reopenedAt'>, matches: readonly Pick<CompetitionMatch, 'queueState'>[]): RecordState {
  if (comp.status === 'finished') return 'official';
  if (matches.length === 0) return 'no_draw';
  const allFinal = matches.every(m => m.queueState === 'final');
  if (comp.reopenedAt) return allFinal ? 'ready' : 'reopened';
  return allFinal ? 'ready' : 'running';
}
export const RECORD_LABEL: Record<RecordState, string> = { official: 'Official', reopened: 'Reopened', ready: 'Ready to finalize', running: 'In progress', no_draw: 'No draw yet' };

/** The one-line reason a competition is not ready, from the server's blockers (the first, with its count where it has one). */
export const blockerLine = (pre: Pick<FinalizePreflight, 'blockers'>): string | null => pre.blockers[0]?.text ?? null;

// ---------------------------------------------------------------- the podium
export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDAL_LABEL: Record<Medal, string> = { gold: 'Champion', silver: 'Silver', bronze: 'Bronze' };
const medalOfPlace = (place: number): Medal | null => (place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : null);

export interface PodiumStep<T> { place: 1 | 2 | 3; medal: Medal; label: string; entries: T[]; shared: boolean }
export interface Podium<T> { steps: PodiumStep<T>[]; rest: Array<{ place: number; entries: T[]; shared: boolean }>; total: number }

/**
 * Places 1 to 3 as podium steps (a step is shown only when someone holds that place: no invented bronze), everyone sharing a place on one step,
 * then the full list of the remaining places. Works for official results and for the preview alike.
 */
export function buildPodium<T extends { place: number; name: string }>(rows: readonly T[]): Podium<T> {
  const byPlace = new Map<number, T[]>();
  for (const r of rows) byPlace.set(r.place, [...(byPlace.get(r.place) ?? []), r]);
  const places = [...byPlace.keys()].sort((a, b) => a - b);
  const steps: PodiumStep<T>[] = [];
  const rest: Podium<T>['rest'] = [];
  for (const place of places) {
    const entries = [...(byPlace.get(place) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const medal = medalOfPlace(place);
    if (medal) steps.push({ place: place as 1 | 2 | 3, medal, label: MEDAL_LABEL[medal], entries, shared: entries.length > 1 });
    else rest.push({ place, entries, shared: entries.length > 1 });
  }
  return { steps, rest, total: rows.length };
}
/** "3rd" or "3rd, shared" for the full list. */
export const placeWord = (place: number, shared = false): string => {
  const s = place % 100;
  const suffix = s >= 11 && s <= 13 ? 'th' : place % 10 === 1 ? 'st' : place % 10 === 2 ? 'nd' : place % 10 === 3 ? 'rd' : 'th';
  return `${place}${suffix}${shared ? ', shared' : ''}`;
};
/** The team an individual fighter represented, for the line under their name; a team entry's own name needs no second line. */
export const representedLine = (r: Pick<OfficialResult | Placement, 'kind' | 'representedTeamName'>): string | null =>
  r.kind === 'fighter' ? r.representedTeamName ?? 'No recorded team' : null;
/** Points as the league awards them: whole numbers stay whole, fractional multipliers keep up to two decimals. */
export const pointsText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

// ---------------------------------------------------------------- the review screen
/** What the Finalize button does right now, in words, or null when there is nothing to do. */
export function finalizeAction(pre: Pick<FinalizePreflight, 'state' | 'eventClosed'>): { enabled: boolean; label: string; reason: string | null } {
  if (pre.eventClosed) return { enabled: false, label: 'Finalize competition', reason: 'The event is closed. Reopen the event before changing a result.' };
  if (pre.state === 'official') return { enabled: false, label: 'Official', reason: null };
  if (pre.state === 'ready') return { enabled: true, label: 'Finalize competition', reason: null };
  if (pre.state === 'running') return { enabled: false, label: 'Finalize competition', reason: 'Every fight needs a result first.' };
  return { enabled: false, label: 'Finalize competition', reason: 'Settle what is listed above first.' };
}
/** The fighters a represented-team warning names, so the screen can link each to the correction. */
export const unattributedFighters = (pre: Pick<FinalizePreflight, 'warnings'>): Array<{ entryId: string; fighterId: string; name: string }> =>
  (pre.warnings.find(w => w.code === 'no_represented_team')?.entries ?? []).map(e => ({ entryId: e.entry_id, fighterId: e.fighter_id, name: e.name }));
/** Reasons for reopen / close need a few real characters. */
export const REASON_MIN = 3;
export const reasonOk = (s: string): boolean => s.trim().length >= REASON_MIN;

// ---------------------------------------------------------------- event closeout
export interface CloseoutSummary { official: number; open: number; neverRan: number; canClose: boolean; nextToFinalize: ClosePreflight['competitions'][number] | null }
export function closeoutSummary(pre: ClosePreflight): CloseoutSummary {
  const official = pre.competitions.filter(c => c.state === 'official').length;
  const neverRan = pre.competitions.filter(c => c.state === 'no_draw').length;
  const open = pre.competitions.length - official - neverRan;
  return { official, open, neverRan, canClose: pre.ready, nextToFinalize: pre.competitions.find(c => c.state === 'ready') ?? null };
}
/** The next competition that is ready after this one became official, for the "Finalize next" action. */
export const nextReady = (list: ReadonlyArray<{ id: string; state: string }>, currentId: string): string | null =>
  list.find(c => c.id !== currentId && c.state === 'ready')?.id ?? null;
