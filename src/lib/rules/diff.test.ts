import { describe, expect, it } from 'vitest';
import { sameWords, wordDiff } from './diff';

describe('word diff between two versions of a rule', () => {
  it('marks the words that changed and keeps the rest', () => {
    const d = wordDiff('An appeal is submitted to the Knight Marshal in person.', 'An appeal is submitted to the Secretary in person.')!;
    expect(d.filter(p => p.kind === 'removed').map(p => p.text.trim())).toEqual(['Knight Marshal']);
    expect(d.filter(p => p.kind === 'added').map(p => p.text.trim())).toEqual(['Secretary']);
    // rebuilding either side from the parts gives the original text back
    expect(d.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe('An appeal is submitted to the Knight Marshal in person.');
    expect(d.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe('An appeal is submitted to the Secretary in person.');
  });
  it('removed and added words never run together', () => {
    const d = wordDiff('The competitor’s representative must announce', 'The competitor or the competitor’s representative must announce')!;
    for (const p of d.filter(x => x.kind !== 'same')) expect(p.text).toMatch(/\s$/);
    expect(d.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe('The competitor or the competitor’s representative must announce');
  });
  it('identical texts are one unchanged part', () => {
    expect(wordDiff('same words', 'same words')).toEqual([{ kind: 'same', text: 'same words' }]);
    expect(sameWords('a  b\nc', 'a b c')).toBe(true);
  });
  it('a rule that is new or gone is all added or all removed', () => {
    expect(wordDiff('', 'new rule')).toEqual([{ kind: 'added', text: 'new rule' }]);
    expect(wordDiff('old rule', '')).toEqual([{ kind: 'removed', text: 'old rule' }]);
  });
  it('refuses to diff very long texts (they are shown whole instead)', () => {
    expect(wordDiff('x '.repeat(3000), 'y', 2500)).toBeNull();
  });
});
