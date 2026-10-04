import { describe, expect, it } from 'vitest';
import { claimNoteProblem, claimStatusText, historyLine, outcomeText, reviewHeading } from './claims';

describe('historyLine', () => {
  it('counts competitions and names the last event', () => expect(historyLine({ entries: 3, lastEvent: 'Event One' })).toBe('3 competitions · last at Event One'));
  it('uses the singular', () => expect(historyLine({ entries: 1, lastEvent: null })).toBe('1 competition'));
  it('says when there is none', () => expect(historyLine({ entries: 0, lastEvent: null })).toMatch(/No competitions/));
});
describe('claimStatusText', () => {
  it('explains a review for someone who already has a profile', () => expect(claimStatusText({ status: 'pending', needsReview: true })).toMatch(/already have a fighter profile/));
  it('does not promise a link while pending', () => expect(claimStatusText({ status: 'pending', needsReview: false })).not.toMatch(/yours/));
  it('covers every status', () => { for (const s of ['approved', 'declined', 'cancelled'] as const) expect(claimStatusText({ status: s, needsReview: false }).length).toBeGreaterThan(3); });
});
describe('outcomeText', () => {
  it('never reports a refused approval as linked', () => {
    expect(outcomeText('already_claimed', 'Zed')).toMatch(/without linking/);
    expect(outcomeText('account_has_fighter', 'Zed')).toMatch(/Nothing was linked/);
  });
  it('confirms history stayed', () => expect(outcomeText('approved', 'Zed')).toMatch(/same profile/));
});
describe('claimNoteProblem', () => {
  it('needs a few characters', () => { expect(claimNoteProblem(' a ')).toBeTruthy(); expect(claimNoteProblem('checked ID')).toBeNull(); });
  it('has a ceiling', () => expect(claimNoteProblem('x'.repeat(301))).toBeTruthy());
});
describe('reviewHeading', () => {
  it('names every source', () => { for (const k of ['registration', 'team_join', 'organizer_entry', 'claim']) expect(reviewHeading(k)).not.toBe('Possible duplicate'); expect(reviewHeading('x')).toBe('Possible duplicate'); });
});
