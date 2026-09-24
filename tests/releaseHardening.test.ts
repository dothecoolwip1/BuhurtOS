import { describe, expect, it } from 'vitest';
import { validateScore } from '../src/lib/scoring';
import { resolveStreamEmbed } from '../src/lib/stream';

describe('release scoring abuse cases', () => {
  it('rejects duplicated, non-finite and negative round scores', () => {
    const duplicate = validateScore(
      { kind: 'duel', roundsRequired: 2, allowDrawRound: true },
      [
        { roundNumber: 1, side1Score: 1, side2Score: 0 },
        { roundNumber: 1, side1Score: 2, side2Score: 0 }
      ]
    );
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors.join(' ')).toMatch(/duplicated/i);

    const nonFinite = validateScore(
      { kind: 'duel', roundsRequired: 1 },
      [{ roundNumber: 1, side1Score: Number.POSITIVE_INFINITY, side2Score: 0 }]
    );
    expect(nonFinite.valid).toBe(false);

    const negative = validateScore(
      { kind: 'duel', roundsRequired: 1 },
      [{ roundNumber: 1, side1Score: -1, side2Score: 0 }]
    );
    expect(negative.valid).toBe(false);
  });

  it('requires a reason when the ruleset requires one for forfeits', () => {
    const result = validateScore(
      { kind: 'duel', roundsRequired: 1, requireReasonOnForfeit: true },
      [],
      { side: 1, reason: '   ' }
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/reason/i);
  });
});

describe('stream URL abuse cases', () => {
  it('rejects non-HTTPS and non-supported embeds', () => {
    expect(resolveStreamEmbed('javascript:alert(1)')).toBeNull();
    expect(resolveStreamEmbed('data:text/html,hello')).toBeNull();
    expect(resolveStreamEmbed('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(resolveStreamEmbed('https://example.com/video')).toBeNull();
  });
});
