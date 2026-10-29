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

import { vi } from 'vitest';
describe('loading the synthetic index', () => {
  it('reads past the API\'s 1000-row page, so a new test event still gets its Test badge', async () => {
    vi.resetModules();
    const all = Array.from({ length: 1098 }, (_, i) => ({ entity_type: 'event', entity_id: `e-${i}`, slug: null }));
    const ranges: [number, number][] = [];
    const q = { select: () => q, order: () => q, range: async (from: number, to: number) => { ranges.push([from, to]); return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null }; } };
    vi.doMock('../lib/supabase', () => ({ supabase: { from: () => q } }));
    const { loadSyntheticStrict, isSynthetic: is } = await import('./synthetic');
    const set = await loadSyntheticStrict();
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(is(set, 'event', 'e-1097')).toBe(true);
    vi.doUnmock('../lib/supabase');
  });
});
