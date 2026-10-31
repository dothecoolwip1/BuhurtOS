import { describe, expect, it } from 'vitest';
import { CHUNK_RELOAD_KEY, shouldReloadForChunk } from './lazyPage';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('reload after a screen failed to download (a new deploy replaced the old build)', () => {
  it('reloads once and records when', () => {
    const s = store();
    expect(shouldReloadForChunk(s, 1_000_000)).toBe(true);
    expect(s.m.get(CHUNK_RELOAD_KEY)).toBe('1000000');
  });
  it('does not reload again within a minute, so a screen that really fails shows its error instead of looping', () => {
    const s = store();
    expect(shouldReloadForChunk(s, 1_000_000)).toBe(true);
    expect(shouldReloadForChunk(s, 1_030_000)).toBe(false);
  });
  it('reloads again after a minute (a later deploy in the same tab)', () => {
    const s = store({ [CHUNK_RELOAD_KEY]: '1000000' });
    expect(shouldReloadForChunk(s, 1_061_000)).toBe(true);
  });
  it('never reloads when the browser blocks storage (no way to stop a loop)', () => {
    expect(shouldReloadForChunk(null, 1)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(shouldReloadForChunk(broken, 1)).toBe(false);
  });
});
