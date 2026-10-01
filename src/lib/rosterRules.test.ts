import { describe, expect, it } from 'vitest';
import { DB_ROSTER_MAX, canAdd, formatSize, homeTeamNotice, roleChoices, rosterRefusal, validateRoster } from './rosterRules';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ fighterId: `f${i}`, role: 'fighter' as const }));

describe('formatSize', () => {
  it('reads team formats', () => {
    expect(formatSize('5v5')).toBe(5);
    expect(formatSize('3v3')).toBe(3);
    expect(formatSize('12v12')).toBe(12);
    expect(formatSize('Longsword')).toBeNull();
    expect(formatSize('3v5')).toBeNull();
  });
});

describe('validateRoster', () => {
  it('accepts a full roster with no notes', () => {
    expect(validateRoster(people(5), 5)).toEqual({ ok: true, errors: [], notes: [] });
  });
  it('notes how many are missing and allows saving', () => {
    const r = validateRoster(people(3), 5);
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toContain('2 more are needed');
  });
  it('allows substitutes', () => {
    const r = validateRoster(people(7), 5);
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toContain('2 are substitutes');
    expect(validateRoster(people(6), 5).notes[0]).toContain('1 is a substitute');
  });
  it('blocks past the database limit and repeats', () => {
    expect(validateRoster(people(DB_ROSTER_MAX + 1), 5).ok).toBe(false);
    expect(validateRoster([...people(2), { fighterId: 'f0', role: 'guest' }], 3).ok).toBe(false);
  });
  it('has no size note for an unknown format', () => {
    expect(validateRoster(people(2), null).notes).toEqual([]);
  });
});

describe('adding', () => {
  it('refuses repeats and a full roster', () => {
    expect(canAdd(people(2), 'f1')).toEqual({ ok: false, reason: 'Already on this roster.' });
    expect(canAdd(people(2), 'x')).toEqual({ ok: true });
    expect(canAdd(people(DB_ROSTER_MAX), 'x').ok).toBe(false);
  });
  it('offers roles by home team', () => {
    expect(roleChoices({ fighterId: 'a', homeTeamId: 't1', homeTeamName: 'One' }, 't1')).toEqual(['fighter']);
    expect(roleChoices({ fighterId: 'a', homeTeamId: 't2', homeTeamName: 'Two' }, 't1')).toEqual(['mercenary', 'guest']);
    expect(roleChoices({ fighterId: 'a', homeTeamId: null, homeTeamName: null }, 't1')).toEqual(['guest']);
  });
  it('confirms the home team does not change', () => {
    const c = { fighterId: 'a', homeTeamId: 't2', homeTeamName: 'Two' };
    expect(homeTeamNotice(c, 'mercenary', 'One')).toContain('stays on Two');
    expect(homeTeamNotice(c, 'fighter', 'One')).toBeNull();
    expect(homeTeamNotice({ ...c, homeTeamId: null, homeTeamName: null }, 'guest', 'One')).toContain('no home team');
  });
});

describe('rosterRefusal', () => {
  it('translates known refusals', () => {
    expect(rosterRefusal('a fighter is already on another entry of this competition')).toContain('only fight for one entry');
    expect(rosterRefusal('this competition is finished; reopen a match before changing a roster')).toContain('Reopen a match');
    expect(rosterRefusal('a roster has at most 40 fighters')).toContain('40');
    expect(rosterRefusal('something else')).toBeNull();
    expect(rosterRefusal(undefined)).toBeNull();
  });
});
