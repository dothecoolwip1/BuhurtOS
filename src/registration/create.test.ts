import { describe, expect, it } from 'vitest';
import { blankToNull, slugError, slugify, validateNewEvent, validateNewTeam } from './create';

describe('slugify', () => {
  it('lowercases and hyphenates', () => expect(slugify('Red Deer Rumble 2026')).toBe('red-deer-rumble-2026'));
  it('strips accents and punctuation', () => expect(slugify("  Château d'Été!! ")).toBe('chateau-d-ete'));
  it('collapses repeats and trims hyphens', () => expect(slugify('--a   &  b--')).toBe('a-b'));
  it('can return empty', () => expect(slugify('!!!')).toBe(''));
});

describe('slugError', () => {
  it('accepts valid', () => expect(slugError('red-deer-rumble')).toBeNull());
  it('rejects bad shapes', () => {
    for (const s of ['', 'Red', 'a--b', '-a', 'a-', 'a b', 'a_b']) expect(slugError(s)).not.toBeNull();
  });
  it('rejects very long', () => expect(slugError('a'.repeat(61))).not.toBeNull());
});

describe('validateNewEvent', () => {
  const ok = { name: 'Red Deer Rumble', slug: 'red-deer-rumble', startsOn: '2026-11-14', endsOn: '2026-11-15', venue: '', address: '' };
  it('passes a good form', () => expect(validateNewEvent(ok)).toEqual({}));
  it('allows a one-day event', () => expect(validateNewEvent({ ...ok, endsOn: '2026-11-14' })).toEqual({}));
  it('flags end before start', () => expect(validateNewEvent({ ...ok, endsOn: '2026-11-13' }).endsOn).toBeTruthy());
  it('flags short name, bad slug, missing dates', () => {
    const e = validateNewEvent({ ...ok, name: 'ab', slug: 'Bad Slug', startsOn: '', endsOn: '' });
    expect(Object.keys(e).sort()).toEqual(['endsOn', 'name', 'slug', 'startsOn']);
  });
});

describe('validateNewTeam', () => {
  const ok = { name: 'Red Deer Reavers', slug: 'red-deer-reavers', city: '', region: '', country: '' };
  it('passes', () => expect(validateNewTeam(ok)).toEqual({}));
  it('flags one-letter name and bad slug', () => expect(Object.keys(validateNewTeam({ ...ok, name: 'R', slug: 'X' })).sort()).toEqual(['name', 'slug']));
});

describe('blankToNull', () => {
  it('maps blanks', () => { expect(blankToNull('  ')).toBeNull(); expect(blankToNull(' x ')).toBe('x'); });
});
