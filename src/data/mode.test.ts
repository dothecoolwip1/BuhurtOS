import { describe, expect, it } from 'vitest';
import { initSampleMode, SAMPLE_KEY } from './mode';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe('sample mode persistence', () => {
  it('is off for a first-time visitor', () => {
    const local = store();
    expect(initSampleMode('', local, store())).toBe(false);
    expect(local.m.size).toBe(0);
  });
  it('?sample=1 turns it on and keeps it in persistent storage', () => {
    const local = store();
    expect(initSampleMode('?sample=1', local, store())).toBe(true);
    expect(local.m.get(SAMPLE_KEY)).toBe('1');
    expect(initSampleMode('', local, store())).toBe(true);   // a refresh, another tab or a new browser session
  });
  it('?sample=0 turns it off and clears the stored setting', () => {
    const local = store({ [SAMPLE_KEY]: '1' });
    expect(initSampleMode('?sample=0', local, store())).toBe(false);
    expect(local.m.has(SAMPLE_KEY)).toBe(false);
    expect(initSampleMode('', local, store())).toBe(false);
  });
  it('only an explicit 1 counts', () => {
    expect(initSampleMode('?sample=yes', store(), store())).toBe(false);
    expect(initSampleMode('', store({ [SAMPLE_KEY]: 'true' }), store())).toBe(false);
  });
  it('carries over a flag from the old session-only version once', () => {
    const local = store(); const session = store({ [SAMPLE_KEY]: '1' });
    expect(initSampleMode('', local, session)).toBe(true);
    expect(session.m.has(SAMPLE_KEY)).toBe(false);
    expect(local.m.get(SAMPLE_KEY)).toBe('1');
  });
  it('?sample=0 wins over an old session flag', () => {
    const local = store(); const session = store({ [SAMPLE_KEY]: '1' });
    expect(initSampleMode('?sample=0', local, session)).toBe(false);
    expect(local.m.has(SAMPLE_KEY)).toBe(false);
    expect(session.m.has(SAMPLE_KEY)).toBe(false);
  });
});
