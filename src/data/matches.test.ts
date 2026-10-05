import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { fieldArg } from './matches';
import { groupIntoRounds, toMatch, type CompetitionMatch } from './matches';

const m = (over: Partial<CompetitionMatch>): CompetitionMatch => ({
  id: Math.random().toString(), competitionId: 'c', stage: 'elimination', roundLabel: 'Final', position: 0, pool: null, field: null, scheduledAt: null,
  queueState: 'scheduled', entryA: null, entryB: null, nameA: null, nameB: null, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 0, finalizedAt: null, ...over
});

describe('groupIntoRounds', () => {
  it('orders pools, then elimination rounds earliest first, then third place and final', () => {
    const rounds = groupIntoRounds([
      m({ stage: 'final', roundLabel: 'Final' }), m({ stage: 'third_place', roundLabel: 'Third place' }),
      m({ roundLabel: 'Semifinal', position: 1 }), m({ roundLabel: 'Semifinal', position: 0 }),
      m({ roundLabel: 'Round of 16' }), m({ roundLabel: 'Quarterfinal' }),
      m({ stage: 'pool', pool: 'B', roundLabel: 'Round 1' }), m({ stage: 'pool', pool: 'A', roundLabel: 'Round 2' }), m({ stage: 'pool', pool: 'A', roundLabel: 'Round 10' }), m({ stage: 'pool', pool: 'A', roundLabel: 'Round 1' })
    ]);
    expect(rounds.map(r => `${r.pool ?? ''}${r.label}`)).toEqual(['ARound 1', 'ARound 2', 'ARound 10', 'BRound 1', 'Round of 16', 'Quarterfinal', 'Semifinal', 'Third place', 'Final']);
    expect(rounds.find(r => r.label === 'Semifinal')!.matches.map(x => x.position)).toEqual([0, 1]);
  });
});

describe('toMatch', () => {
  it('uses team names for team entries and fighter names for fighter entries', () => {
    const row = {
      id: '1', competition_id: 'c', stage: 'elimination' as const, round_label: 'Final', position: 0, pool: null, field: null, scheduled_at: null, queue_state: 'scheduled' as const,
      entry_a: 'x', entry_b: 'y', next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: null, version: 0, finalized_at: null,
      a: { teams: { name: 'Iron Wolves' }, fighters: null }, b: [{ teams: null, fighters: { display_name: 'Ana K' } }]
    };
    const r = toMatch(row);
    expect(r.nameA).toBe('Iron Wolves');
    expect(r.nameB).toBe('Ana K');
    expect(r.detail).toEqual({});
  });
  it('treats a match with no field as Field 1 and keeps a field the organizer assigned', () => {
    const base = {
      id: '1', competition_id: 'c', stage: 'pool' as const, round_label: 'Round 1', position: 0, pool: 'A', scheduled_at: null, queue_state: 'scheduled' as const,
      entry_a: null, entry_b: null, next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: null, version: 0, finalized_at: null, a: null, b: null
    };
    expect(toMatch({ ...base, field: null }).field).toBe('Field 1');
    expect(toMatch({ ...base, field: '  ' }).field).toBe('Field 1');
    expect(toMatch({ ...base, field: 'Field 2' }).field).toBe('Field 2');
    expect(toMatch({ ...base, field: 'Main ring' }).field).toBe('Main ring');
  });
});

describe('fieldArg', () => {
  it('sends empty text to clear, null to keep, trimmed text to set', () => {
    expect(fieldArg('')).toBe('');
    expect(fieldArg('   ')).toBe('');
    expect(fieldArg(null)).toBeNull();
    expect(fieldArg(undefined)).toBeNull();
    expect(fieldArg(' Field 2 ')).toBe('Field 2');
  });
});

describe('fetchCompetitionMatchesOrdered', () => {
  it('falls back to schedule order when the database has no queue_order column yet', async () => {
    vi.resetModules();
    const calls: string[] = [];
    const row = { id: '1', competition_id: 'c', stage: 'pool', round_label: 'Round 1', position: 0, pool: null, field: null, scheduled_at: null, queue_state: 'scheduled', entry_a: 'a', entry_b: 'b',
      next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: null, version: 0, finalized_at: null, a: null, b: null };
    const chain = (cols: string) => {
      const res = cols.includes('queue_order') ? { data: null, error: { code: '42703', message: 'column matches.queue_order does not exist' } } : { data: [row], error: null };
      calls.push(cols.includes('queue_order') ? 'with order' : 'without order');
      const q: Record<string, unknown> = { eq: () => q, order: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) };
      return q;
    };
    vi.doMock('../lib/supabase', () => ({ supabase: { from: () => ({ select: (cols: string) => chain(cols) }) } }));
    const mod = await import('./matches');
    const list = await mod.fetchCompetitionMatchesOrdered('c');
    expect(calls).toEqual(['with order', 'with order', 'without order']);   // Pack 09D columns, then Pack 09A's, then the plain list
    expect(list).toHaveLength(1);
    expect(list[0].field).toBe('Field 1');
    expect(list[0].queueOrder).toBeNull();
  });

  it('keeps the manual order when only the Pack 09D plan columns are missing', async () => {
    vi.resetModules();
    const calls: string[] = [];
    const row = { id: '1', competition_id: 'c', stage: 'pool', round_label: 'Round 1', position: 0, pool: null, field: null, scheduled_at: null, queue_state: 'scheduled', entry_a: 'a', entry_b: 'b',
      next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: null, version: 0, finalized_at: null, queue_order: 2, a: null, b: null };
    const chain = (cols: string) => {
      const res = cols.includes('plan_order') ? { data: null, error: { code: '42703', message: 'column matches.plan_order does not exist' } } : { data: [row], error: null };
      calls.push(cols.includes('plan_order') ? 'plan' : cols.includes('queue_order') ? 'manual' : 'plain');
      const q: Record<string, unknown> = { eq: () => q, order: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) };
      return q;
    };
    vi.doMock('../lib/supabase', () => ({ supabase: { from: () => ({ select: (cols: string) => chain(cols) }) } }));
    const mod = await import('./matches');
    const list = await mod.fetchCompetitionMatchesOrdered('c');
    expect(calls).toEqual(['plan', 'manual']);
    expect(list[0].queueOrder).toBe(2);
    expect(list[0].planOrder).toBeNull();
    expect(list[0].planHold).toBe(false);
  });
});
