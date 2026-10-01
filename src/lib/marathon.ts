import type { Side } from './tournament';

/**
 * A series is a list of one-round contests between two sides, scored by points per round. It runs the Marathon relay
 * (rules from the Red Deer Rumble registration form) and, with organizer-set disciplines and points, Triathlon, Sabre
 * and Greatsword, whose rulesets are not loaded. Nothing here invents a rule: where the source is silent (tiebreaks,
 * which fighter fights which round, Triathlon disciplines) the engine says so instead of deciding.
 */
export type SeriesResult = Side | 'tie';
export type SeriesKind = 'marathon' | 'triathlon' | 'sabre' | 'greatsword';

export const BREAK_SECONDS = 10;

export interface SeriesConfig {
  disciplines: string[];
  winPoints: number;
  tiePoints: number;
  /** False when the ruleset is not loaded: the organizer sets disciplines and points, and the screen says so. */
  rulesLoaded: boolean;
  /** Seconds between rounds. Marathon: 10 (registration form). Others: 0 unless the organizer sets one. */
  breakSeconds: number;
}

export interface SeriesState {
  kind: SeriesKind;
  config: SeriesConfig;
  /** Marathon: always true, the form fixes the config. Others: true once the organizer confirms the setup. */
  configured: boolean;
  /** One entry per discipline, in order. null = not yet fought. */
  results: (SeriesResult | null)[];
  /** ms timestamp when the current break began, or null. */
  breakAt: number | null;
  /** A side may run solo: one fighter fights every round. Informational, it does not change scoring. */
  solo: Record<Side, boolean>;
}

/** Marathon order from the registration form. The last slot is Short Axe, or Greatsword if both teams agree. */
export const MARATHON_ROUNDS = [
  { key: 'longsword', label: 'Longsword' },
  { key: 'sword_shield', label: 'Sword and Shield' },
  { key: 'sabre', label: 'Sabre' },
  { key: 'polearm', label: 'Polearm' },
  { key: 'buckler', label: 'Sword and Buckler' },
  { key: 'short_axe', label: 'Short Axe' }
] as const;

export const SERIES_TITLE: Record<SeriesKind, string> = { marathon: 'Marathon relay', triathlon: 'Triathlon', sabre: 'Sabre', greatsword: 'Greatsword' };

export function newMarathon(last: 'short_axe' | 'greatsword' = 'short_axe'): SeriesState {
  const disciplines: string[] = MARATHON_ROUNDS.map(r => r.label);
  if (last === 'greatsword') disciplines[5] = 'Greatsword';
  return {
    kind: 'marathon', configured: true, results: disciplines.map(() => null), breakAt: null, solo: { a: false, b: false },
    config: { disciplines, winPoints: 2, tiePoints: 1, rulesLoaded: true, breakSeconds: BREAK_SECONDS }
  };
}

/** Rules not loaded: no disciplines until the organizer adds them. Placeholder points of 1 and 0 are shown and editable. */
export function newSeries(kind: Exclude<SeriesKind, 'marathon'>): SeriesState {
  return { kind, configured: false, results: [], breakAt: null, solo: { a: false, b: false }, config: { disciplines: [], winPoints: 1, tiePoints: 0, rulesLoaded: false, breakSeconds: 0 } };
}

/** Organizer setup: replace the disciplines and points. Clears any rounds already scored. Marathon cannot be changed. */
export function configureSeries(s: SeriesState, c: { disciplines: string[]; winPoints: number; tiePoints: number; breakSeconds?: number }): SeriesState {
  const disciplines = c.disciplines.map(d => d.trim()).filter(Boolean);
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;
  const brk = c.breakSeconds ?? 0;
  if (s.kind === 'marathon' || !disciplines.length || disciplines.length > 20 || !ok(c.winPoints) || !ok(c.tiePoints) || !ok(brk)) return s;
  return { ...s, configured: true, results: disciplines.map(() => null), breakAt: null, config: { ...s.config, disciplines, winPoints: c.winPoints, tiePoints: c.tiePoints, breakSeconds: brk } };
}

export const currentRound = (s: SeriesState): number => { const i = s.results.indexOf(null); return i === -1 ? s.results.length : i; };
export const seriesComplete = (s: SeriesState): boolean => s.configured && s.results.length > 0 && s.results.every(r => r !== null);

/** Record the winner of the current round (or a tie). Starts the break unless it was the last round. */
export function setSeriesRound(s: SeriesState, result: SeriesResult, now: number): SeriesState {
  if (!s.configured || seriesComplete(s)) return s;
  const i = currentRound(s);
  if (i >= s.results.length) return s;
  const results = [...s.results];
  results[i] = result;
  const last = i === results.length - 1;
  return { ...s, results, breakAt: last || s.config.breakSeconds <= 0 ? null : now };
}

/** Take back the most recent round. */
export function seriesUndo(s: SeriesState): SeriesState {
  const i = currentRound(s) - 1;
  if (i < 0) return s;
  const results = [...s.results];
  results[i] = null;
  return { ...s, results, breakAt: null };
}

export const seriesSolo = (s: SeriesState, side: Side, solo: boolean): SeriesState => ({ ...s, solo: { ...s.solo, [side]: solo } });

export function roundPoints(s: SeriesState, r: SeriesResult | null): { a: number; b: number } {
  const { winPoints: w, tiePoints: t } = s.config;
  if (r === 'a') return { a: w, b: 0 };
  if (r === 'b') return { a: 0, b: w };
  if (r === 'tie') return { a: t, b: t };
  return { a: 0, b: 0 };
}

export function seriesTotals(s: SeriesState): { a: number; b: number } {
  return s.results.reduce((t, r) => { const p = roundPoints(s, r); return { a: t.a + p.a, b: t.b + p.b }; }, { a: 0, b: 0 });
}

/** Whole seconds left of the break, 0 when over or none is running. */
export function breakRemaining(breakAt: number | null, now: number, seconds = BREAK_SECONDS): number {
  if (breakAt === null) return 0;
  return Math.max(0, Math.min(seconds, Math.ceil((seconds * 1000 - (now - breakAt)) / 1000)));
}

export type SeriesOutcome =
  | { state: 'incomplete'; played: number; of: number }
  | { state: 'decided'; winner: Side; a: number; b: number }
  | { state: 'draw'; a: number; b: number }
  | { state: 'needs_decider'; a: number; b: number; message: string };

/**
 * Match result: most points wins. A level total is a draw in pool and round robin. In elimination the database refuses
 * a draw and no tiebreak rule is loaded, so the series reports 'needs_decider' and leaves the call to the organizer.
 */
export function seriesOutcome(s: SeriesState, stage: string): SeriesOutcome {
  const played = s.results.filter(r => r !== null).length;
  if (!seriesComplete(s)) return { state: 'incomplete', played, of: s.results.length };
  const { a, b } = seriesTotals(s);
  if (a !== b) return { state: 'decided', winner: a > b ? 'a' : 'b', a, b };
  if (stage === 'pool' || stage === 'round_robin') return { state: 'draw', a, b };
  return { state: 'needs_decider', a, b, message: `Level at ${a} points each. An elimination match cannot end level and no tiebreak rule is loaded, so this match needs a decider. Ask the head marshal or an organizer how to settle it.` };
}

export interface SeriesDetail {
  kind: SeriesKind;
  rounds: { round: number; label: string; winner: SeriesResult | null; a: number; b: number }[];
  totals: { a: number; b: number };
  pointsPerWin: number;
  pointsPerTie: number;
  rulesLoaded: boolean;
  solo: Record<Side, boolean>;
}

export function seriesDetail(s: SeriesState): SeriesDetail {
  return {
    kind: s.kind,
    rounds: s.results.map((r, i) => ({ round: i + 1, label: s.config.disciplines[i] ?? `Round ${i + 1}`, winner: r, ...roundPoints(s, r) })),
    totals: seriesTotals(s), pointsPerWin: s.config.winPoints, pointsPerTie: s.config.tiePoints, rulesLoaded: s.config.rulesLoaded, solo: { ...s.solo }
  };
}
