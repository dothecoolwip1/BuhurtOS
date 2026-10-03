import { describe, expect, it } from 'vitest';
import { isSynthetic, syntheticKeys } from './synthetic';

describe('synthetic labels', () => {
  const set = syntheticKeys([
    { entity_type: 'event', entity_id: 'e-1', slug: 'fake-open-test' },
    { entity_type: 'fighter', entity_id: 'f-1', slug: null }
  ]);
  it('matches by id or slug of the right kind', () => {
    expect(isSynthetic(set, 'event', 'e-1')).toBe(true);
    expect(isSynthetic(set, 'event', 'fake-open-test')).toBe(true);
    expect(isSynthetic(set, 'fighter', 'f-1')).toBe(true);
  });
  it('does not match another kind, an unknown id, or a name that merely looks fake', () => {
    expect(isSynthetic(set, 'team', 'e-1')).toBe(false);
    expect(isSynthetic(set, 'event', 'real-open')).toBe(false);
    expect(isSynthetic(set, 'event', 'something-test')).toBe(false);
    expect(isSynthetic(set, 'event', null)).toBe(false);
  });
});
