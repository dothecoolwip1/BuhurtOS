import { describe, expect, it } from 'vitest';
import { lookupState } from './lookupState';

const s = (data: unknown, loading = false, error: unknown = undefined) => ({ data, loading, error });

describe('lookupState', () => {
  it('is loading, never none, before the first answer arrives', () => {
    expect(lookupState(s(undefined, true))).toBe('loading');
  });
  it('is found when a value arrived, including while a reload runs', () => {
    expect(lookupState(s({ id: 1 }))).toBe('found');
    expect(lookupState(s({ id: 1 }, true))).toBe('found');
  });
  it('is none only after a successful lookup that returned nothing', () => {
    expect(lookupState(s(null))).toBe('none');
    expect(lookupState(s(null, true))).toBe('loading');   // a stale null from an earlier run is not the answer
    expect(lookupState(s([]))).toBe('none');
    expect(lookupState(s(undefined, false))).toBe('none');
  });
  it('treats a non-empty list as found', () => {
    expect(lookupState(s([1]))).toBe('found');
  });
  it('is error, not none, when the lookup failed', () => {
    expect(lookupState(s(undefined, false, new Error('x')))).toBe('error');
    expect(lookupState(s(undefined, true, new Error('x')))).toBe('error');
  });
});
