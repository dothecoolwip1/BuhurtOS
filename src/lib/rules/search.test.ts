import { describe, expect, it } from 'vitest';
import { cmpNumber, highlightParts, normalize, numberQuery, queryGroups, searchRules, snippet, stem, type SearchableRule } from './search';

// Invented provisions (the example body used by the importer tests), NOT real rules.
const R: SearchableRule[] = [
  { id: 'g', number: '1.2', title: 'Grounded fighter', body: 'A fighter is grounded when any part of the body other than the feet touches the ground. A grounded fighter takes no further part in the round.', keywords: ['downed', 'on the ground'], path: ['General'], document: 'Example Combat Rules' },
  { id: 'pt', number: '2.1', title: 'Prohibited targets', body: 'Strikes to the back of the knee, the neck and the feet are prohibited. See 1.2 for grounded fighters.', keywords: ['back of knee', 'knee'], path: ['Prohibited actions'], document: 'Example Combat Rules' },
  { id: 'gr', number: '2.2', title: 'Grappling', body: 'Grappling is allowed only while both fighters stand. Throws onto the head are prohibited.', path: ['Prohibited actions'], document: 'Example Combat Rules' },
  { id: 'th', number: '2.3', title: 'Two-handed weapons', body: 'A two-handed weapon must be held with both hands when striking. A shield may not be used to strike with its edge.', keywords: ['two handed weapon', '2h'], path: ['Prohibited actions'], document: 'Example Combat Rules' },
  { id: 'w', number: '3.1', title: 'Warnings', body: 'The marshal may give a verbal warning for a minor breach.', path: ['Penalties'], document: 'Example Combat Rules' },
  { id: 'c', number: '3.2', title: 'Cards', body: 'A yellow card is shown for a repeated breach; a red card removes the fighter from the bout (see 3.1).', path: ['Penalties'], document: 'Example Combat Rules' },
  { id: 'h', number: '4.1', title: 'Helmet', body: 'Every fighter wears a helmet that covers the whole head.', path: ['Equipment'], document: 'Example Combat Rules' },
  { id: 's', number: '4.2', title: 'Shield sizes', body: 'Shield sizes are listed in this table.', path: ['Equipment'], document: 'Example Combat Rules' },
  { id: 's10', number: '4.10', title: 'Armour', body: 'Armor must cover the joints.', path: ['Equipment'], document: 'Example Combat Rules' },
  { id: 'p', number: '2.1', title: 'Protests', body: 'A captain may raise a protest with the head marshal within ten minutes of the bout ending.', path: ['Results'], document: 'Example Event Regulations' }
];
const top = (q: string) => searchRules(R, q).hits.map(h => h.item.id);

describe('rules search: what a referee types at the list', () => {
  it('"back of knee" finds the prohibited targets rule first', () => expect(top('back of knee')[0]).toBe('pt'));
  it('"behind the knee" (a synonym) finds it too', () => expect(top('behind the knee')[0]).toBe('pt'));
  it('"two handed weapon" finds the two-handed rule first', () => expect(top('two handed weapon')[0]).toBe('th'));
  it('"2h" finds it through the synonym', () => expect(top('2h')).toContain('th'));
  it('"helmet" finds the helmet rule first', () => expect(top('helmet')[0]).toBe('h'));
  it('"yellow card" finds the cards rule first, and only rules with both words', () => {
    expect(top('yellow card')).toEqual(['c']);
  });
  it('"grounded fighter" puts the definition first', () => expect(top('grounded fighter')[0]).toBe('g'));
  it('"downed" finds grounded through the search words', () => expect(top('downed')[0]).toBe('g'));
  it('"grappling" and "throws" find grappling', () => { expect(top('grappling')[0]).toBe('gr'); expect(top('throw')[0]).toBe('gr'); });
  it('"shield" finds both shield rules', () => expect(top('shield').slice(0, 2).sort()).toEqual(['s', 'th']));
  it('"armour" and "armor" find the same rule', () => { expect(top('armour')[0]).toBe('s10'); expect(top('armor')[0]).toBe('s10'); });
  it('"appeal" finds protests through the synonym', () => expect(top('appeal')[0]).toBe('p'));
  it('is case and accent insensitive', () => expect(top('HÉLMET')[0]).toBe('h'));
});

describe('rule numbers', () => {
  it('reads numbers in the forms people type', () => {
    expect(numberQuery('4.2')).toBe('4.2');
    expect(numberQuery('§ 4.2')).toBe('4.2');
    expect(numberQuery('rule 4.2.1')).toBe('4.2.1');
    expect(numberQuery('4.')).toBe('4');
    expect(numberQuery('4.2 helmet')).toBeNull();
  });
  it('an exact number comes first, then the rules under it, in order', () => {
    const r = searchRules(R, '4');
    expect(r.numberQuery).toBe('4');
    expect(r.hits.map(h => h.item.number)).toEqual(['4.1', '4.2', '4.10']);
    expect(searchRules(R, '2.1').hits.map(h => h.item.id)).toEqual(['pt', 'p']);
  });
  it('sorts numbers numerically', () => expect(['4.10', '4.2', '4.1', '10', '2'].sort(cmpNumber)).toEqual(['2', '4.1', '4.2', '4.10', '10']));
});

describe('no results and partial results', () => {
  it('an empty query returns nothing', () => expect(searchRules(R, '   ').hits).toEqual([]));
  it('a word in no rule returns nothing', () => { const r = searchRules(R, 'zebra'); expect(r.hits).toEqual([]); expect(r.partial).toBe(false); });
  it('when no rule has every word, the closest are offered and marked partial', () => {
    const r = searchRules(R, 'helmet zebra');
    expect(r.partial).toBe(true);
    expect(r.hits[0].item.id).toBe('h');
  });
  it('stop words alone find nothing', () => expect(searchRules(R, 'the of and').hits).toEqual([]));
});

describe('text helpers', () => {
  it('normalizes punctuation, hyphens and accents but keeps rule numbers', () => {
    expect(normalize('Two-handed (weapons): Rule 4.2.1!')).toBe('two handed weapons rule 4.2.1');
    expect(normalize('Ségolène')).toBe('segolene');
  });
  it('stems common endings', () => {
    expect(stem('cards')).toBe('card');
    expect(stem('grappling')).toBe(stem('grapple'));
    expect(stem('prohibited')).toBe('prohibit');
    expect(stem('penalties')).toBe('penalty');
    expect(stem('4.2')).toBe('4.2');
  });
  it('groups synonym phrases before words', () => {
    expect(queryGroups('back of the knee strike').map(g => g.label)).toEqual(['back of the knee', 'strike']);
  });
  it('makes a short snippet around the match', () => {
    const long = 'Lorem ipsum dolor sit amet. '.repeat(20) + 'The helmet must fit. ' + 'More text follows here. '.repeat(10);
    const s = snippet(long, ['helmet']);
    expect(s).toContain('helmet');
    expect(s.length).toBeLessThan(175);
    expect(s.startsWith('…')).toBe(true);
  });
  it('marks matched words without changing the text', () => {
    const parts = highlightParts('A grounded fighter is Grounded.', ['grounded']);
    expect(parts.map(p => p.text).join('')).toBe('A grounded fighter is Grounded.');
    expect(parts.filter(p => p.mark).map(p => p.text)).toEqual(['grounded', 'Grounded']);
  });
  it('is fast enough for thousands of rules on a phone', () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({ ...R[i % R.length], id: String(i), number: `${1 + (i % 40)}.${i % 97}` }));
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) searchRules(many, 'back of knee');
    expect((performance.now() - t0) / 5).toBeLessThan(200);
  });
});
