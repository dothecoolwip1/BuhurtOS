import { describe, expect, it } from 'vitest';
import { duesLabel, duesSatisfied, filterRoster, historySentence, isAtLeast, money, parseMoney, summarize, type RosterMember } from './clubMembership';

const m = (over: Partial<RosterMember>): RosterMember => ({
  membershipId: over.fullName ?? 'x', fullName: 'X', email: null, discordName: null, status: 'active', appliedAt: '2026-01-01T00:00:00Z', isAdult: true,
  duesStatus: 'paid', duesAmountCents: 2000, duesNote: null, duesChangedAt: null, duesChangedByName: null, eligible: true, reasonCodes: [], reasons: [],
  offices: [], statusNote: null, ...over
});

const rows = [
  m({ fullName: 'Garrett Robson' }),
  m({ fullName: 'John Smith', duesStatus: 'unpaid', duesAmountCents: null, eligible: false, reasonCodes: ['dues_unpaid'], reasons: ['Dues unpaid'] }),
  m({ fullName: 'Jane Smith', status: 'pending', eligible: false, reasonCodes: ['membership_pending'], reasons: ['Membership pending approval'] }),
  m({ fullName: 'Gear Giver', duesStatus: 'gear_contribution' }),
  m({ fullName: 'Old Member', status: 'inactive', duesStatus: 'unpaid', eligible: false, reasons: ['Membership inactive', 'Dues unpaid'] }),
  m({ fullName: 'Gone Member', status: 'removed', duesStatus: 'unpaid', eligible: false, reasons: ['Membership removed', 'Dues unpaid'] }),
  m({ fullName: 'Young One', isAdult: false, eligible: false, reasons: ['Under 18'] })
];

describe('club membership dashboard', () => {
  it('counts the AGM summary', () => {
    expect(summarize(rows)).toEqual({ total: 6, active: 4, voting: 2, duesPaid: 4, duesOutstanding: 1, pending: 1 });
  });
  it('filters', () => {
    const names = (f: Parameters<typeof filterRoster>[1]) => filterRoster(rows, f).map(r => r.fullName);
    expect(names('eligible')).toEqual(['Garrett Robson', 'Gear Giver']);
    expect(names('not_eligible')).toEqual(['John Smith', 'Jane Smith', 'Old Member', 'Young One']);
    expect(names('unpaid')).toEqual(['John Smith', 'Old Member']);
    expect(names('paid')).toEqual(['Garrett Robson', 'Jane Smith', 'Gear Giver', 'Young One']);
    expect(names('pending')).toEqual(['Jane Smith']);
    expect(names('active')).toHaveLength(4);
    expect(names('all')).toHaveLength(7);
    expect(filterRoster(rows, 'all', 'smith').map(r => r.fullName)).toEqual(['John Smith', 'Jane Smith']);
  });
  it('treats every dues status as satisfied in a year whose fee is waived, and says so', () => {
    expect(summarize(rows, true)).toEqual({ total: 6, active: 4, voting: 2, duesPaid: 6, duesOutstanding: 0, pending: 1 });
    expect(filterRoster(rows, 'unpaid', '', true)).toEqual([]);
    expect(duesSatisfied('unpaid', true)).toBe(true);
    expect(duesSatisfied('unpaid')).toBe(false);
    expect(duesLabel('unpaid', true)).toBe('Fee waived');
    expect(duesLabel('unpaid')).toBe('Unpaid');
    expect(duesLabel('paid', true)).toBe('Paid');
  });
});

describe('money and dates', () => {
  it('formats and parses dues amounts', () => {
    expect(money(2000)).toBe('$20');
    expect(money(2050)).toBe('$20.50');
    expect(money(null)).toBe('');
    expect(parseMoney('$20')).toBe(2000);
    expect(parseMoney('20.5')).toBe(2050);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNaN();
    expect(parseMoney('-5')).toBeNaN();
  });
  it('checks 18+ on a given day, including the birthday itself', () => {
    expect(isAtLeast('2008-10-06', 18, '2026-10-06')).toBe(true);
    expect(isAtLeast('2008-10-07', 18, '2026-10-06')).toBe(false);
    expect(isAtLeast('1990-01-01', 18, '2026-10-06')).toBe(true);
  });
  it('writes the dues history sentence', () => {
    expect(historySentence({
      id: 1, membershipId: 'a', membershipYear: 2026, memberName: 'John Smith', previousStatus: 'unpaid', newStatus: 'paid', previousAmountCents: null,
      newAmountCents: 2000, changedByName: 'Garrett Robson', changedByOffice: 'Treasurer', changedAt: '2026-10-06T18:00:00Z', note: null
    }, 'America/Edmonton')).toBe("Garrett Robson (Treasurer) changed John Smith's 2026 dues from Unpaid to Paid ($20) on October 6, 2026.");
  });
});
