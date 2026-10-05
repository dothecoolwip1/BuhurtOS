import { describe, expect, it } from 'vitest';
import type { SetupCompetition } from '../data/competitions';
import { clearAll, competitionCount, competitionsToCreate, initialSelection, reviewLines, rulesetFor, selectAll, toggleCategory, toggleDivision, type CategoryRef } from './quickSetup';

// The reference rows exactly as supabase/migrations/20261001000100_foundation.sql seeds them.
const CATS: CategoryRef[] = [
  { code: '3v3', league: 'buhurt', name: '3v3', sort: 10, source: 'Buhurt Regulations V.26.4 §1.2.1' },
  { code: '5v5', league: 'buhurt', name: '5v5', sort: 11, source: 'Buhurt Regulations V.26.4 §1.2.1' },
  { code: '12v12', league: 'buhurt', name: '12v12', sort: 12, source: 'Buhurt Regulations V.26.4 §1.2.1' },
  { code: '30v30', league: 'buhurt', name: '30v30', sort: 13, source: 'Buhurt Regulations V.26.4 §1.2.1' },
  { code: 'sword_shield', league: 'duels', name: 'Sword & Shield', sort: 20, source: 'Duels rules V.26.4 §2.1.1' },
  { code: 'buckler', league: 'duels', name: 'Sword & Buckler', sort: 21, source: 'Duels rules V.26.4 §2.1.2' },
  { code: 'longsword', league: 'duels', name: 'Longsword', sort: 22, source: 'Duels rules V.26.4 §2.1.4' },
  { code: 'polearm', league: 'duels', name: 'Polearm', sort: 23, source: 'Duels rules V.26.4 §2.1.3' },
  { code: 'profight', league: 'outrance', name: 'Profight', sort: 30, source: 'Outrance Rules V.26.4' },
  { code: 'sabre', league: 'hacsa', name: 'Sabre', sort: 40, source: 'Red Deer Rumble registration form; HACSA ruleset' },
  { code: 'greatsword', league: 'hacsa', name: 'Greatsword', sort: 41, source: 'Red Deer Rumble registration form; HACSA ruleset' },
  { code: 'triathlon', league: 'hacsa', name: 'Triathlon', sort: 42, source: 'Red Deer Rumble registration form' },
  { code: 'marathon', league: 'hacsa', name: 'Marathon (relay)', sort: 43, source: 'Red Deer Rumble registration form: 2 pts per round win, 1 per tie, 0 per loss' }
];

describe('quick setup defaults', () => {
  it('starts with the normal set on and the large melees off', () => {
    const sel = initialSelection(CATS);
    expect([...sel.keys()].sort()).toEqual(['3v3', '5v5', 'buckler', 'longsword', 'marathon', 'polearm', 'profight', 'sabre', 'sword_shield', 'triathlon'].sort());
    expect([...sel.get('longsword')!]).toEqual(['men', 'women']);
    expect([...sel.get('triathlon')!]).toEqual(['open']);
  });

  it('names the ruleset from the reference source, and invents none for HACSA formats', () => {
    expect(rulesetFor(CATS.find(c => c.code === 'longsword')!)).toBe('Buhurt International: Duels rules V.26.4');
    expect(rulesetFor(CATS.find(c => c.code === '5v5')!)).toBe('Buhurt International: Buhurt Regulations V.26.4');
    expect(rulesetFor(CATS.find(c => c.code === 'profight')!)).toBe('Buhurt International: Outrance Rules V.26.4');
    expect(rulesetFor(CATS.find(c => c.code === 'sabre')!)).toBe('');
  });

  it('turning two categories off and creating needs no other decision', () => {
    let sel = initialSelection(CATS);
    sel = toggleCategory(sel, CATS.find(c => c.code === 'profight')!);
    sel = toggleCategory(sel, CATS.find(c => c.code === 'marathon')!);
    const comps = competitionsToCreate(CATS, sel);
    expect(comps.map(c => c.name)).toEqual([
      'Men 3v3', 'Women 3v3', 'Men 5v5', 'Women 5v5', 'Men Sword & Shield', 'Women Sword & Shield', 'Men Sword & Buckler', 'Women Sword & Buckler',
      'Men Longsword', 'Women Longsword', 'Men Polearm', 'Women Polearm', 'Men Sabre', 'Women Sabre', 'Triathlon (open)'
    ]);
    expect(comps.every(c => c.structure === 'round_robin' && c.tier === 'Classic' && c.roundsToWin === null)).toBe(true);
    expect(competitionCount(sel)).toBe(15);
  });

  it('a division can be switched off; the last one off switches the category off', () => {
    let sel = initialSelection(CATS);
    sel = toggleDivision(sel, 'polearm', 'women');
    expect([...sel.get('polearm')!]).toEqual(['men']);
    sel = toggleDivision(sel, 'polearm', 'men');
    expect(sel.has('polearm')).toBe(false);
  });

  it('select all and clear all', () => {
    expect(selectAll(CATS).size).toBe(CATS.length);
    expect(clearAll().size).toBe(0);
  });

  it('the review lists each category once with its divisions and kind', () => {
    const lines = reviewLines(CATS, initialSelection(CATS));
    const ls = lines.find(l => l.code === 'longsword')!;
    expect(ls).toMatchObject({ name: 'Longsword', divisions: 'Men · Women', kind: 'Individual' });
    expect(lines.find(l => l.code === '5v5')!.kind).toBe('Team competition');
    expect(lines.find(l => l.code === 'sabre')!.ruleset).toMatch(/not set/);
  });
});

describe('create event like…', () => {
  const previous: SetupCompetition[] = [
    { id: 'x', name: 'Longsword — Men', category: 'longsword', league: 'duels', gender: 'men', ruleset: 'HACSA LS 2025', structure: 'pools_elimination', roundsToWin: null, status: 'finished', sort: 1, tier: 'Regional', entries: 12, matches: 30, registrations: 12 },
    { id: 'y', name: 'Men 5v5', category: '5v5', league: 'buhurt', gender: 'men', ruleset: null, structure: 'round_robin', roundsToWin: 2, status: 'finished', sort: 2, tier: 'Classic', entries: 6, matches: 15, registrations: 0 }
  ];
  it('copies the categories, divisions and competition settings, never entrants or results', () => {
    const sel = initialSelection(CATS, previous);
    expect([...sel.keys()].sort()).toEqual(['5v5', 'longsword']);
    const comps = competitionsToCreate(CATS, sel, previous);
    expect(comps).toEqual([
      { name: 'Men 5v5', category: '5v5', gender: 'men', ruleset: '', structure: 'round_robin', roundsToWin: 2, tier: 'Classic' },
      { name: 'Longsword — Men', category: 'longsword', gender: 'men', ruleset: 'HACSA LS 2025', structure: 'pools_elimination', roundsToWin: null, tier: 'Regional' }
    ]);
    expect(Object.keys(comps[0])).not.toContain('entries');
  });
});
