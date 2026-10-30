import { describe, expect, it } from 'vitest';
import { noticeStillTrue, type NoticeScope } from './counters';

const given: NoticeScope = { match: 'm1', round: 1, run: 'r1' };
const at = (o: Partial<Parameters<typeof noticeStillTrue>[1]> = {}) => ({ match_id: 'm1', final: false, waiting: false, round: { no: 1, status: 'confirming' }, run: 'r1', ...o });

describe('a counter phone\'s "Score confirmed. Wait for the next round." (seven-profile rehearsal 2026-10-30)', () => {
  it('stays while the round it was given for is being confirmed, and once it is confirmed', () => {
    expect(noticeStillTrue(given, at())).toBe(true);
    expect(noticeStillTrue(given, at({ round: { no: 1, status: 'confirmed' } }))).toBe(true);
  });
  it('goes when the next round starts, without a tap', () => {
    expect(noticeStillTrue(given, at({ round: { no: 2, status: 'running' }, run: 'r2' }))).toBe(false);
  });
  it('goes when the fight is over (official result) or the phone waits for the next fight', () => {
    expect(noticeStillTrue(given, at({ final: true }))).toBe(false);
    expect(noticeStillTrue(given, at({ waiting: true }))).toBe(false);
    expect(noticeStillTrue(given, at({ match_id: 'm2', round: { no: 1, status: 'running' }, run: 'r9' }))).toBe(false);
  });
  it('goes when the round is returned for a recount', () => {
    expect(noticeStillTrue(given, at({ round: { no: 1, status: 'running' } }))).toBe(false);
  });
  it('an unscoped notice (evidence kept, offline) is not touched', () => {
    expect(noticeStillTrue(null, at({ final: true }))).toBe(true);
  });
});

import { weightedPadWords } from './counters';
describe('the counter phone\'s +2 pad names its rule (seven-profile rehearsal: the longsword pad showed only "+2")', () => {
  it('longsword: head or torso with two hands, visibly and to a screen reader (Duels §2.1.4)', () => {
    const w = weightedPadWords('longsword');
    expect(w.two).toBe('Head or torso, two hands');
    expect(w.twoLabel).toContain('two hands');
    expect(w.twoLabel.startsWith('Count two points, head or torso')).toBe(true);   // the browser journeys find the pad by this name
    expect(w.oneLabel.startsWith('Count one point, arm leg or hand')).toBe(true);
  });
  it('other weapons do not get the longsword qualification', () => {
    for (const c of ['sword_shield', null, undefined]) { expect(weightedPadWords(c).two).toBe('Head or torso'); expect(weightedPadWords(c).twoLabel).not.toContain('two hands'); }
  });
});
