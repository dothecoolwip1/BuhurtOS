/**
 * The line marshal's phone (Pack 29, Outrance §2.3 and the p.25 sheet). Pure: what the phone shows is the server's tally for the round plus
 * the phone's own taps still waiting to be sent, so every tap answers at once and a lost signal never changes the sheet.
 */
import type { CountAction, Mark } from './counters';
import type { Pair, Side } from '../outrance';

export type Tally = Record<Mark, Pair>;
export const MARKS: readonly Mark[] = ['strike', 'takedown', 'weapon_loss', 'armour_failure'];
export const MARK_LABEL: Record<Mark, string> = { strike: 'Strike', takedown: 'Takedown', weapon_loss: 'Weapon lost', armour_failure: 'Armour failure' };
export const emptyTally = (): Tally => ({ strike: { a: 0, b: 0 }, takedown: { a: 0, b: 0 }, weapon_loss: { a: 0, b: 0 }, armour_failure: { a: 0, b: 0 } });

/** A tally read from the server (untrusted shape): anything missing is zero, never negative. */
export function readTally(v: unknown): Tally {
  const out = emptyTally();
  if (!v || typeof v !== 'object') return out;
  for (const m of MARKS) {
    const p = (v as Record<string, unknown>)[m] as Record<string, unknown> | undefined;
    for (const s of ['a', 'b'] as const) {
      const n = Number(p?.[s]);
      out[m][s] = Number.isSafeInteger(n) && n > 0 ? n : 0;
    }
  }
  return out;
}

/** The tally the phone shows: the server's, then this round's pending taps and undos in order (an undo takes back one of its mark for its fighter). */
export function shownTally(base: Tally, pending: readonly CountAction[], round: number, runId?: string): Tally {
  const out: Tally = { strike: { ...base.strike }, takedown: { ...base.takedown }, weapon_loss: { ...base.weapon_loss }, armour_failure: { ...base.armour_failure } };
  for (const a of pending) {
    if (a.round !== round || (runId && a.runId && a.runId !== runId) || !a.mark || !a.markSide) continue;
    const cell = out[a.mark];
    cell[a.markSide] = a.kind === 'tap' ? cell[a.markSide] + 1 : Math.max(0, cell[a.markSide] - 1);
  }
  return out;
}

/**
 * What UNDO takes back: the last tap this phone made in the round that is not undone yet (its own taps, newest first), or, when the phone has
 * no history (it was reloaded), the server's last tap. Null when there is nothing to take back.
 */
export function undoTarget(history: readonly { mark: Mark; side: Side }[], serverLast: { mark: Mark; side: Side } | null, shown: Tally): { mark: Mark; side: Side } | null {
  const last = history.at(-1) ?? serverLast;
  return last && shown[last.mark][last.side] > 0 ? last : null;
}

/** The strike point difference and whether the criteria are needed (5 or less, §15.3.1). */
export const strikeGap = (t: Tally): number => Math.abs(t.strike.a - t.strike.b);
