import type { DisciplineLogRow } from '../../data/rules';

export type LogFilter = 'all' | 'card' | 'warning' | 'deduction' | 'dq';
export interface PersonLog { key: string; name: string; rows: DisciplineLogRow[]; tally: Record<DisciplineLogRow['kind'], number>; cards: Record<string, number> }

/**
 * The event's discipline log grouped by who it was against, most recent first. Counts include only records still in force (voided ones are shown
 * but never counted). No rule about what a number of cards means is applied here: that is the governing body's rule, read by the officials.
 */
export function groupDiscipline(rows: DisciplineLogRow[], filter: LogFilter, showVoided: boolean, q: string): PersonLog[] {
  const needle = q.trim().toLowerCase();
  const out = new Map<string, PersonLog>();
  for (const r of rows) {
    const key = r.fighter_id ?? r.team_id ?? r.entry_id ?? `unknown-${r.side}`;
    const name = r.against ?? 'Unknown fighter';
    if (!out.has(key)) out.set(key, { key, name, rows: [], tally: { warning: 0, card: 0, deduction: 0, dq: 0 }, cards: {} });
    const p = out.get(key)!;
    if (!r.voided_at) { p.tally[r.kind]++; if (r.kind === 'card' && r.label) p.cards[r.label] = (p.cards[r.label] ?? 0) + 1; }
    if ((filter === 'all' || r.kind === filter) && (showVoided || !r.voided_at)) p.rows.push(r);
  }
  return [...out.values()]
    .filter(p => p.rows.length && (!needle || p.name.toLowerCase().includes(needle)))
    .map(p => ({ ...p, rows: [...p.rows].sort((a, b) => b.created_at.localeCompare(a.created_at)) }))
    .sort((a, b) => b.rows[0].created_at.localeCompare(a.rows[0].created_at));
}

export const KIND_WORD: Record<DisciplineLogRow['kind'], string> = { warning: 'Warning', card: 'Card', deduction: 'Points taken off', dq: 'Disqualified' };
export function describeRow(r: DisciplineLogRow): string {
  if (r.kind === 'card') return r.label ? `${r.label} card` : 'Card';
  if (r.kind === 'deduction') return `−${r.amount} point${r.amount === 1 ? '' : 's'}`;
  return KIND_WORD[r.kind];
}
