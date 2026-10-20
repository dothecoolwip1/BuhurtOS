import { describe, expect, it } from 'vitest';
import { MULTIPLIER_SOURCES, TIERS, tierDisputed, tierPoints } from './tiers';
import { leaguePoints } from '../lib/tournament';

describe('the tier table and calculator share a documented source', () => {
  it('keeps every displayed percentage consistent with calculated points under either source', () => {
    for (const [source] of MULTIPLIER_SOURCES) for (const { name: tier } of TIERS) {
      const result = leaguePoints({ poolWins: 3, eliminationWins: 2, placement: 'second', tier, source });
      const label = tierPoints(tier, source);
      expect(label === 'No points' ? 0 : Number.parseInt(label, 10) / 100).toBe(result.multiplier);
      expect(result.total).toBe(result.base * result.multiplier);
    }
  });
  it('preserves the actual disagreement rather than choosing an official policy', () => {
    expect(tierPoints('Regional', 'tournamentStructure')).toBe('125%');
    expect(tierPoints('Regional', 'leagueStructure')).toBe('150%');
    expect(tierDisputed('Regional')).toBe(true);
    expect(tierDisputed('Classic')).toBe(false);
  });
});
