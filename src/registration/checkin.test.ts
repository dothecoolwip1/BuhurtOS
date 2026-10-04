import { describe, expect, it } from 'vitest';
import type { ManagedRegistration } from '../data/manage';
import { applyOverride, attentionItems, blockedBecause, checkinCounts, filterCheckin } from './checkin';
import { groupByDay, parseSchedule } from './schedule';

const reg = (o: Partial<ManagedRegistration> = {}): ManagedRegistration => ({
  id: 'r', status: 'accepted', fullName: 'Ada North', gender: 'f', organization: 'Org', province: 'AB', teamName: 'Wolves', sharesEquipment: false, days: [], attendDates: [],
  availabilityNotes: null, biProfile: null, insurance: 'hacsa_member', isVolunteer: false, volunteerRoles: [], mercenary: false, notes: null,
  feeDueCents: 0, feePaid: false, createdAt: '', email: '', emergencyName: '', emergencyRelationship: '', emergencyPhone: '', medicalNote: null,
  categories: [{ competitionId: 'c', name: 'Duels', details: {} }], checkedIn: false, kitPassed: false, ...o
});

describe('check-in helpers', () => {
  it('explains blocks in plain words', () => {
    expect(blockedBecause(reg())).toBeNull();
    expect(blockedBecause(reg({ insurance: 'proof_pending', feeDueCents: 5000 }))).toBe('Blocked because: insurance, fee');
    expect(blockedBecause(reg({ feeDueCents: 5000, feePaid: true }))).toBeNull();
  });
  it('filters and searches', () => {
    const list = [reg({ id: '1' }), reg({ id: '2', fullName: 'Bo', insurance: 'needs_cover' }), reg({ id: '3', checkedIn: true }), reg({ id: '4', status: 'pending' })];
    expect(filterCheckin(list, 'todo', '').map(r => r.id)).toEqual(['1', '2']);
    expect(filterCheckin(list, 'blocked', '').map(r => r.id)).toEqual(['2']);
    expect(filterCheckin(list, 'ready', '').map(r => r.id)).toEqual(['1']);
    expect(filterCheckin(list, 'all', 'wolves').map(r => r.id)).toEqual(['1', '2', '3']);
    expect(filterCheckin(list, 'all', 'duel')).toHaveLength(3);
  });
  it('counts and applies optimistic overrides', () => {
    const list = [reg({ id: '1' }), reg({ id: '2', checkedIn: true, kitPassed: true }), reg({ id: '3', isVolunteer: true })];
    expect(checkinCounts(list)).toMatchObject({ accepted: 3, checkedIn: 1, todo: 2, kitPending: 1 });
    expect(applyOverride(list[0], { checkedIn: true }).checkedIn).toBe(true);
    expect(applyOverride(list[0], undefined)).toBe(list[0]);
  });
  it('builds the attention strip, hiding zeros and unknown team data', () => {
    const list = [reg({ status: 'pending', feeDueCents: 100 }), reg({ insurance: 'proof_pending' })];
    const items = attentionItems(list);
    expect(items.map(i => i.kind)).toEqual(['pending', 'blocked', 'unpaid']);
    expect(attentionItems(list, 2).at(-1)).toMatchObject({ kind: 'teams', count: 2 });
    expect(attentionItems([reg()], 0)).toEqual([]);
  });
});

describe('parseSchedule', () => {
  const desc = 'Saturday, November 14th, 10 am to 6 pm. Sunday, November 15th, 10 am to 6 pm. Weapons check at 8:00 am. Safety meeting at 9:30 am on both days.\n\nCamping is available on site.';
  it('keeps only sentences with times, verbatim', () => {
    const e = parseSchedule(null, desc);
    expect(e.map(x => x.text)).toEqual(['Saturday, November 14th, 10 am to 6 pm', 'Sunday, November 15th, 10 am to 6 pm', 'Weapons check at 8:00 am', 'Safety meeting at 9:30 am on both days']);
    expect(e[2].times).toEqual(['8:00 am']);
    expect(groupByDay(e).map(g => g.day)).toEqual(['Saturday', 'Sunday', 'Event days', 'Both days']);
  });
  it('returns nothing when no time is written and dedupes', () => {
    expect(parseSchedule('Doors open soon', undefined)).toEqual([]);
    expect(parseSchedule('Doors 6 pm', 'Doors 6 pm')).toHaveLength(1);
  });
});
