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
