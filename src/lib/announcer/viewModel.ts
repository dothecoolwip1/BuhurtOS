import type { CompetitionMatch } from '../../data/matches';
import type { LystPublic } from '../../data/lyst';
import type { Team } from '../../data/types';
import { buildFieldBoards, competitionSorts, fieldKey } from '../eventDay';
import { sideLabel } from '../entryLabel';
import { presentSide, type SideSource } from '../broadcast/sides';

/**
 * The Announcer view-model. PURE: matches, the official lyst rows, the public side records and the readiness booleans go in; what the announcer's
 * screen shows comes out. It is a WHITELIST projection: every output field is copied by name from the inputs, so an input that carries something
 * private (an email, a note, a reason, a counter tally, an account id) cannot come out the other side; the tests feed it such objects to prove it.
 *
 * Official data only: a fight's score is the marshal-confirmed lyst total (lyst_public_state.official_a/b) while it is being fought, and
 * matches.score_a/b once it is final. The classic board's running snapshot (match_live_scores) and any counter tally are not inputs at all.
 */
export const TBD = 'To be decided';
/** How many fights are listed after "Up next" on each Lyst. A small queue, not the bracket. */
export const COMING_LIMIT = 5;
export const RECENT_LIMIT = 8;

export interface AnnMark { side: 'a' | 'b'; text: string; kind: 'warning' | 'card' | 'deduction' | 'dq' }
export interface AnnTimer { mode: string; status: 'idle' | 'running' | 'paused'; remainingMs: number; startedAt: string | null }
export interface AnnSide {
  side: 'a' | 'b';
  corner: 'RED' | 'BLUE';
  entryId: string | null;
  /** null until the public record has loaded. */
  kind: 'fighter' | 'team' | null;
  name: string;
  /** The fighter's team (a team entry has none: its name is the team). */
  teamName: string | null;
  photoUrl: string | null;
  crest: Team | null;
  record: string | null;
  recordIsTest: boolean;
  /** The official score; null when there is none (yet). */
  score: number | null;
  marks: AnnMark[];
  /** true: Ready, false: Not yet ready, null: not known / not shown. */
  ready: boolean | null;
}
export type FightSlot = 'fighting' | 'on_deck' | 'in_the_hole' | 'waiting';
export interface AnnFight {
  id: string; field: string; slot: FightSlot; competition: string; stage: string;
  a: AnnSide; b: AnnSide;
  round: number | null; phase: string | null; timer: AnnTimer | null;
  /** Any fighter of this fight is marked "Not yet ready". */
  notReady: boolean;
}
export interface LystCard {
  key: string; field: string; label: string; live: boolean;
  now: AnnFight | null;
  /** More than one fight is marked active on this Lyst (the marshal's problem; the card says so, quietly). */
  alsoActive: number;
  next: AnnFight | null; coming: AnnFight[];
  /** Fights still to come on this Lyst beyond those listed. */
  more: number;
  done: number; total: number;
}
export interface RecentResult {
  id: string; field: string; fieldLabel: string; competition: string; stage: string;
  a: { name: string; score: number | null; winner: boolean }; b: { name: string; score: number | null; winner: boolean };
  winnerName: string | null; drawn: boolean;
  scoreText: string | null; basis: string | null; finalizedAt: string | null;
}
export interface AnnouncerView {
  lysts: LystCard[];
  recent: RecentResult[];
  /** The Lyst key this screen is focused on (local choice), or null for all Lysts. Always one that exists. */
  focus: string | null;
  /** The entry ids whose public records/crests the screen needs (fights shown in the Lyst cards). */
  entryIds: string[];
}

// ------------------------------------------------------------------------------------------------ words
/** "Field 2" is "Lyst 2" on the announcer's screen; any other name is kept as the organizer wrote it. */
export function lystLabel(field: string): string {
  const m = /^\s*field\s*(\d+)\s*$/i.exec(field);
  if (m) return `Lyst ${m[1]}`;
  return field.trim() || 'Lyst 1';
}

const SLOT_WORD: Record<FightSlot, string> = { fighting: 'Fighting now', on_deck: 'On deck', in_the_hole: 'In the hole', waiting: 'Coming up' };
export const slotWord = (s: FightSlot): string => SLOT_WORD[s];

/** The mark words are the ones the Arena and the Broadcast overlay show. A card's label is a public word ("Yellow"), never the marshal's reason. */
const markText = (d: LystPublic['discipline'][number]): string =>
  d.kind === 'card' ? (typeof d.label === 'string' && d.label.trim() ? d.label.trim().slice(0, 40) : 'Card')
    : d.kind === 'deduction' ? `−${Number(d.amount) || 0} point${Number(d.amount) === 1 ? '' : 's'}`
      : d.kind === 'dq' ? 'Disqualified' : 'Warning';
const MARK_KINDS = new Set(['warning', 'card', 'deduction', 'dq']);

/** Words for the round state; a score nobody has confirmed is never shown, and the screen says so. */
export function phaseWord(row: Pick<LystPublic, 'round_status' | 'round_no'> | undefined): string | null {
  if (!row) return null;
  return row.round_status === 'confirming' ? 'Scores being confirmed…'
    : row.round_status === 'running' ? `Round ${row.round_no}`
      : row.round_status === 'confirmed' ? `After round ${row.round_no}` : null;
}

export const BASIS_WORD: Record<string, string> = { score: 'on score', dq: 'by disqualification', technical: 'technical result' };

/** How a final result was reached, from the official record only: matches.detail.lyst.basis (never its `reason`) or a walkover. */
export function basisOf(detail: Readonly<Record<string, unknown>> | null | undefined): string | null {
  if (!detail || typeof detail !== 'object') return null;
  if ((detail as { walkover?: unknown }).walkover === true) return 'walkover';
  const lyst = (detail as { lyst?: unknown }).lyst;
  const basis = lyst && typeof lyst === 'object' ? (lyst as { basis?: unknown }).basis : undefined;
  return typeof basis === 'string' && Object.prototype.hasOwnProperty.call(BASIS_WORD, basis) ? BASIS_WORD[basis] : null;
}

export const scoreText = (a: number | null, b: number | null): string | null => (a === null || b === null ? null : `${a} – ${b}`);

// ------------------------------------------------------------------------------------------------ the view
export interface AnnouncerInput {
  matches: readonly CompetitionMatch[];
  competitions: readonly { id: string; name: string; sort?: number }[];
  /** lyst_public_state rows for the event. */
  lyst: readonly LystPublic[];
  /** Public records by entry id (the Broadcast's side source). Missing entries just show a name. */
  sides: Readonly<Record<string, SideSource>>;
  /** announcer_readiness rows; null when the viewer cannot read them (the screen then shows no readiness at all). */
  readiness: readonly { match_id: string; side: string; ready: boolean }[] | null;
  /** The local focus choice (a Lyst key or field name), or null. */
  focus: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function buildAnnouncerView(input: AnnouncerInput): AnnouncerView {
  const names = new Map(input.competitions.map(c => [c.id, c.name]));
  const lystByMatch = new Map(input.lyst.map(r => [r.match_id, r]));
  const ready = input.readiness ? new Map(input.readiness.map(r => [`${r.match_id}:${r.side}`, r.ready === true])) : null;
  const boards = buildFieldBoards(input.matches, competitionSorts(input.competitions), new Set());
  const stageOf = (m: CompetitionMatch) => (m.pool ? `Pool ${m.pool} · ${m.roundLabel || m.stage}` : m.roundLabel || m.stage);

  const sideOf = (m: CompetitionMatch, side: 'a' | 'b', slot: FightSlot, row: LystPublic | undefined): AnnSide => {
    const entryId = side === 'a' ? m.entryA : m.entryB;
    const src = entryId ? input.sides[entryId] ?? null : null;
    const name = sideLabel(entryId, side === 'a' ? m.nameA : m.nameB, TBD);
    const p = presentSide(src, side, name, { scheme: 'red_blue', records: true, photos: true });
    const marks: AnnMark[] = slot === 'fighting' && row
      ? (row.discipline ?? []).filter(d => d && d.side === side && MARK_KINDS.has(d.kind)).map(d => ({ side, text: markText(d), kind: d.kind }))
      : [];
    const known = ready?.get(`${m.id}:${side}`);
    return {
      side, corner: side === 'a' ? 'RED' : 'BLUE', entryId, kind: src ? src.kind : null, name: p.name,
      teamName: src?.kind === 'fighter' ? p.subtitle : null,
      photoUrl: p.avatarUrl, crest: p.crest, record: p.record, recordIsTest: p.recordNote === 'test record',
      score: slot === 'fighting' && row ? num(side === 'a' ? row.official_a : row.official_b) : null,
      marks,
      ready: slot === 'fighting' || known === undefined ? null : known
    };
  };

  const fightOf = (m: CompetitionMatch, slot: FightSlot): AnnFight => {
    const row = slot === 'fighting' ? lystByMatch.get(m.id) : undefined;
    const a = sideOf(m, 'a', slot, row), b = sideOf(m, 'b', slot, row);
    return {
      id: m.id, field: m.field ?? 'Field 1', slot, competition: names.get(m.competitionId) ?? 'Competition', stage: stageOf(m),
      a, b,
      round: row ? row.round_no : null, phase: phaseWord(row),
      timer: row && row.timer_status && row.timer_mode ? { mode: row.timer_mode, status: row.timer_status, remainingMs: num(row.timer_remaining_ms) ?? 0, startedAt: row.timer_started_at } : null,
      notReady: a.ready === false || b.ready === false
    };
  };

  // One card per Lyst that still has something to fight (or a fight on). Order: the event's own field order (Field 1 first); never by "who is live",
  // so a card does not jump when a fight starts or ends.
  const lysts: LystCard[] = boards.filter(b => b.total > b.done || b.now.length > 0).map(b => {
    const now = b.now[0] ?? null;
    // the queue as the database calls it: on deck, then in the hole, then the runnable waiting fights in running order. Fights whose sides are not decided are not listed.
    const queue: Array<[CompetitionMatch, FightSlot]> = [
      ...b.onDeck.map(m => [m, 'on_deck'] as [CompetitionMatch, FightSlot]),
      ...b.inTheHole.map(m => [m, 'in_the_hole'] as [CompetitionMatch, FightSlot]),
      ...b.upcoming.map(m => [m, 'waiting'] as [CompetitionMatch, FightSlot])
    ];
    const [first, ...rest] = queue;
    const shown = rest.slice(0, COMING_LIMIT);
    return {
      key: b.key, field: b.name, label: lystLabel(b.name), live: now !== null,
      now: now ? fightOf(now, 'fighting') : null, alsoActive: Math.max(0, b.now.length - 1),
      next: first ? fightOf(first[0], first[1]) : null, coming: shown.map(([m, s]) => fightOf(m, s)), more: Math.max(0, rest.length - shown.length),
      done: b.done, total: b.total
    };
  });

  // recent results: the last finalized fights of the whole event, newest first. A bye (a side that never existed) is not a fight.
  const recent: RecentResult[] = input.matches
    .filter(m => m.queueState === 'final' && m.entryA && m.entryB)
    .sort((x, y) => (y.finalizedAt ?? '').localeCompare(x.finalizedAt ?? '') || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, RECENT_LIMIT)
    .map(m => {
      const nameA = sideLabel(m.entryA, m.nameA, TBD), nameB = sideLabel(m.entryB, m.nameB, TBD);
      const drawn = m.result === 'draw';
      const winA = !drawn && !!m.winnerEntryId && m.winnerEntryId === m.entryA, winB = !drawn && !!m.winnerEntryId && m.winnerEntryId === m.entryB;
      const basis = basisOf(m.detail);
      return {
        id: m.id, field: m.field ?? 'Field 1', fieldLabel: lystLabel(m.field ?? 'Field 1'), competition: names.get(m.competitionId) ?? 'Competition', stage: stageOf(m),
        a: { name: nameA, score: num(m.scoreA), winner: winA }, b: { name: nameB, score: num(m.scoreB), winner: winB },
        winnerName: winA ? nameA : winB ? nameB : null, drawn,
        scoreText: basis === 'walkover' ? null : scoreText(num(m.scoreA), num(m.scoreB)), basis, finalizedAt: m.finalizedAt
      };
    });

  const focus = resolveFocus(lysts, input.focus);
  const entryIds = [...new Set(lysts.flatMap(l => [l.now, l.next, ...l.coming]).flatMap(f => (f ? [f.a.entryId, f.b.entryId] : [])).filter((x): x is string => !!x))];
  return { lysts, recent, focus, entryIds };
}

/** The wanted Lyst when it is one of the cards (by key, field name or label, any case), else null (all Lysts). */
export function resolveFocus(lysts: readonly Pick<LystCard, 'key' | 'field' | 'label'>[], wanted: string | null | undefined): string | null {
  if (!wanted) return null;
  const k = fieldKey(wanted), w = wanted.trim().toLowerCase();
  return lysts.find(l => l.key === k || fieldKey(l.field) === k || l.label.toLowerCase() === w)?.key ?? null;
}

/** With a focus, the focused Lyst comes first and the others follow in their usual order; without one, the usual order. Never changes the data. */
export function orderLysts<T extends { key: string }>(lysts: readonly T[], focus: string | null): T[] {
  if (!focus) return [...lysts];
  return [...lysts.filter(l => l.key === focus), ...lysts.filter(l => l.key !== focus)];
}
