import { describe, expect, it } from 'vitest';
import { groupStandings, type StandingRow } from './profight';

const row = (p: Partial<StandingRow>): StandingRow => ({ fighterId: p.name ?? 'x', name: 'x', gender: 'men', weightClass: 'men_heavyweight', weightClassName: 'Heavyweight', weightClassSort: 13,
  fights: 1, wins: 1, losses: 0, draws: 0, lastFightAt: null, status: 'active', current: true, rank: 1, ...p });

describe('Profight standings (Outrance §17)', () => {
  it('groups by weight class in the rules\' order, open weight last, each fighter only in their current class', () => {
    const g = groupStandings([
      row({ name: 'Ann', weightClass: null, weightClassName: 'Open weight', weightClassSort: null }),
      row({ name: 'Bo', rank: 2 }), row({ name: 'Cy', rank: 1 }),
      row({ name: 'Di', weightClass: 'men_lightweight', weightClassName: 'Lightweight', weightClassSort: 10 }),
      row({ name: 'Bo', weightClass: 'men_lightweight', weightClassName: 'Lightweight', weightClassSort: 10, current: false }),
      row({ name: 'Ed', status: 'retired', rank: null }), row({ name: 'Fay', gender: 'women' })
    ], 'men');
    expect(g.map(c => c.weightClass)).toEqual(['Lightweight', 'Heavyweight', 'Open weight']);
    expect(g[0].rows.map(r => r.name)).toEqual(['Di']);
    expect(g[1].rows.map(r => r.name)).toEqual(['Cy', 'Bo']);
    expect(g[1].retired.map(r => r.name)).toEqual(['Ed']);
  });
});
