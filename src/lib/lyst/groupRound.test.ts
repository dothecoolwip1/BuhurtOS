import { describe, expect, it } from 'vitest';
import { pendingGroupWinner } from './groupRound';
describe('team counter round recovery', () => {
  const a = { status: 'confirmed', awarded_a: 1, awarded_b: 0 };
  const b = { status: 'confirmed', awarded_a: 0, awarded_b: 1 };
  it('recovers a trailing side winning the latest round after reload', () => {
    expect(pendingGroupWinner({ a: 2, b: 1 }, [a, a])).toBe('b');
    expect(pendingGroupWinner({ a: 1, b: 2 }, [b, b])).toBe('a');
  });
  it('does not guess when no round is missing or several rounds are missing', () => {
    expect(pendingGroupWinner({ a: 1, b: 1 }, [a, b])).toBeNull();
    expect(pendingGroupWinner({ a: 2, b: 1 }, [a])).toBeNull();
    expect(pendingGroupWinner({ a: 0, b: 0 }, [a])).toBeNull();
  });
});
