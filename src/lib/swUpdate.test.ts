import { describe, expect, it, vi } from 'vitest';
import { scoringGuard, updateSafety } from './swUpdate';

describe('updateSafety', () => {
  it('is safe only when nothing is being scored and no work is waiting on this device', () => {
    expect(updateSafety({ scoringOpen: false, pendingActions: 0, unfinishedBoards: 0 })).toEqual({ safe: true, reasons: [] });
  });
  it('is not safe while a scoring screen is open', () => {
    const r = updateSafety({ scoringOpen: true, pendingActions: 0, unfinishedBoards: 0 });
    expect(r.safe).toBe(false);
    expect(r.reasons[0]).toMatch(/scoring screen is open/);
  });
  it('is not safe with unconfirmed score actions, and says how many', () => {
    const r = updateSafety({ scoringOpen: false, pendingActions: 3, unfinishedBoards: 0 });
    expect(r.safe).toBe(false);
    expect(r.reasons[0]).toMatch(/3 score actions are still waiting/);
    expect(updateSafety({ scoringOpen: false, pendingActions: 1, unfinishedBoards: 0 }).reasons[0]).toMatch(/1 score action is still waiting/);
  });
  it('is not safe with a part-scored match or an unconfirmed finalization on the device', () => {
    expect(updateSafety({ scoringOpen: false, pendingActions: 0, unfinishedBoards: 2 }).safe).toBe(false);
  });
  it('lists every reason', () => {
    expect(updateSafety({ scoringOpen: true, pendingActions: 2, unfinishedBoards: 1 }).reasons).toHaveLength(3);
  });
});

describe('scoringGuard', () => {
  it('counts open screens, so two screens or a quick remount cannot unlock an update early', () => {
    const seen = vi.fn();
    expect(scoringGuard.open).toBe(false);
    scoringGuard.enter(); scoringGuard.enter();
    expect(scoringGuard.open).toBe(true);
    scoringGuard.leave();
    expect(scoringGuard.open).toBe(true);
    scoringGuard.leave();
    expect(scoringGuard.open).toBe(false);
    scoringGuard.leave();   // extra leave never goes negative
    expect(scoringGuard.open).toBe(false);
    seen();
  });
});
