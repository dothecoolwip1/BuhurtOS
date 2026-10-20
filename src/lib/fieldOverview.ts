import { fieldKey, fieldName } from './eventDay';
/** Per-field summary of an event's matches, for the "Scorekeeping" picker. Pure: what to show is decided by the matches alone. */
export interface FieldSummary { field: string; queued: number; active: number; scheduled: number; final: number; total: number }

type M = { field: string | null; queueState: string };

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Fields that have at least one match, in natural order (Ring 2 before Ring 10). A blank field is the default Lyst, matching the server. */
export function fieldOverview(matches: readonly M[]): FieldSummary[] {
  const by = new Map<string, FieldSummary>();
  for (const m of matches) {
    const f = fieldName(m.field), key = fieldKey(m.field);
    const s = by.get(key) ?? { field: f, queued: 0, active: 0, scheduled: 0, final: 0, total: 0 };
    s.total += 1;
    if (m.queueState === 'active') { s.active += 1; s.queued += 1; }
    else if (m.queueState === 'on_deck' || m.queueState === 'in_the_hole') s.queued += 1;
    else if (m.queueState === 'final') s.final += 1;
    else s.scheduled += 1;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => natural(a.field, b.field));
}

/** One line under a field button: what is waiting there right now. */
export function fieldLine(s: FieldSummary): string {
  if (s.queued > 0) return `${s.queued} ${s.queued === 1 ? 'match' : 'matches'} queued${s.active ? ` · ${s.active} active` : ''}`;
  if (s.scheduled > 0) return `${s.scheduled} scheduled, none queued yet`;
  if (s.final === s.total) return 'All matches final';
  return 'Nothing queued';
}
