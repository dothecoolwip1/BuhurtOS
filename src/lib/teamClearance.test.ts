import { describe, expect, it } from 'vitest';
import { missingItems, sortForChasing, summarizeClearance, type ClearanceRow } from './teamClearance';

const row = (over: Partial<ClearanceRow> = {}): ClearanceRow => ({
  registrationId: 'r', fullName: 'Ada', status: 'accepted', isVolunteer: false, waiverSigned: true, insuranceOk: true, checkedIn: true, kitPassed: true, ...over
});

describe('missingItems', () => {
  it('is empty for a fully ready fighter', () => expect(missingItems(row())).toEqual([]));
  it('lists waiver, insurance, check-in and kit in order', () => {
    expect(missingItems(row({ waiverSigned: false, insuranceOk: false, checkedIn: false, kitPassed: false }))).toEqual(['Waiver', 'Insurance', 'Check-in', 'Kit check']);
  });
  it('a pending registration is waiting for review, and check-in is not yet asked for', () => {
    expect(missingItems(row({ status: 'pending', checkedIn: false, kitPassed: false }))).toEqual(['Waiting for organizer review']);
  });
  it('volunteers need no kit check', () => expect(missingItems(row({ isVolunteer: true, kitPassed: false }))).toEqual([]));
});

describe('summarizeClearance', () => {
  it('counts totals and each gap', () => {
    const s = summarizeClearance([row(), row({ insuranceOk: false }), row({ checkedIn: false }), row({ waiverSigned: false })]);
    expect(s).toEqual({ total: 4, ready: 1, missingWaiver: 1, missingInsurance: 1, notCheckedIn: 1 });
  });
  it('handles an empty roster', () => expect(summarizeClearance([]).total).toBe(0));
});

describe('sortForChasing', () => {
  it('puts people with gaps first, then alphabetical, without changing the input', () => {
    const input = [row({ fullName: 'Zed' }), row({ fullName: 'Bea', checkedIn: false }), row({ fullName: 'Al' })];
    expect(sortForChasing(input).map(r => r.fullName)).toEqual(['Bea', 'Al', 'Zed']);
    expect(input[0].fullName).toBe('Zed');
  });
});
