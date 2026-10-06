import { describe, expect, it } from 'vitest';
import { describeRow, groupDiscipline } from './disciplineLog';
import type { DisciplineLogRow } from '../../data/rules';

const row = (o: Partial<DisciplineLogRow>): DisciplineLogRow => ({
  id: Math.random().toString(36), match_id: 'm', round_no: 1, side: 'a', kind: 'warning', label: null, amount: 0, related_id: null, created_at: '2026-10-10T10:00:00Z', voided_at: null,
  reason: null, called_by: null, void_reason: null, recorded_by_name: null, recorded_by_me: false, field: 'Field 1', round_label: 'Round 1', queue_state: 'final', competition_id: 'k', competition_name: 'Longsword',
  entry_id: 'e1', fighter_id: 'f1', team_id: null, against: 'Ada', provision_id: null, rule_number: null, rule_title: null, rule_document: null, rule_version: null, rule_version_status: null, citation_changes: 0, ...o
});

describe('discipline log grouping', () => {
  const rows = [
    row({ kind: 'card', label: 'Yellow', created_at: '2026-10-10T10:05:00Z' }),
    row({ kind: 'card', label: 'Yellow', created_at: '2026-10-10T11:00:00Z', voided_at: '2026-10-10T11:01:00Z' }),
    row({ kind: 'warning', created_at: '2026-10-10T09:00:00Z' }),
    row({ kind: 'deduction', amount: 2, fighter_id: 'f2', entry_id: 'e2', against: 'Bo', created_at: '2026-10-10T12:00:00Z' })
  ];
  it('groups by person, newest activity first, and counts only records in force', () => {
    const g = groupDiscipline(rows, 'all', true, '');
    expect(g.map(p => p.name)).toEqual(['Bo', 'Ada']);
    expect(g[1].tally).toEqual({ warning: 1, card: 1, deduction: 0, dq: 0 });
    expect(g[1].cards).toEqual({ Yellow: 1 });
    expect(g[1].rows).toHaveLength(3);
  });
  it('hides voided records unless asked, without changing the counts', () => {
    const g = groupDiscipline(rows, 'all', false, '');
    expect(g[1].rows).toHaveLength(2);
    expect(g[1].tally.card).toBe(1);
  });
  it('filters by kind and by name', () => {
    expect(groupDiscipline(rows, 'card', false, '').map(p => p.name)).toEqual(['Ada']);
    expect(groupDiscipline(rows, 'all', false, 'bo').map(p => p.name)).toEqual(['Bo']);
    expect(groupDiscipline(rows, 'dq', false, '')).toEqual([]);
  });
  it('describes records in plain words', () => {
    expect(describeRow(row({ kind: 'card', label: 'Red' }))).toBe('Red card');
    expect(describeRow(row({ kind: 'deduction', amount: 1 }))).toBe('−1 point');
    expect(describeRow(row({ kind: 'dq' }))).toBe('Disqualified');
  });
});
