import { describe, expect, it } from 'vitest';
import type { ManagedRegistration } from '../data/manage';
import { blockers, countByStatus, filterRegistrations } from './review';

const reg = (over: Partial<ManagedRegistration> = {}): ManagedRegistration => ({
  id: 'r', status: 'pending', fullName: 'Ada Lovelace', gender: 'female', organization: 'HACSA', province: 'AB', teamName: 'Iron Wardens', sharesEquipment: false,
  days: ['sat'], attendDates: [], availabilityNotes: null, biProfile: null, insurance: 'hacsa_member', isVolunteer: false, volunteerRoles: [], mercenary: false, notes: null,
  feeDueCents: 4000, feePaid: false, createdAt: '2026-10-01T00:00:00Z', email: 'a@x.test', emergencyName: 'P', emergencyRelationship: '', emergencyPhone: '4035550100', medicalNote: null,
  categories: [{ competitionId: 'c1', name: 'Longsword (women)', details: {} }], checkedIn: false, kitPassed: false, ...over
});

describe('review helpers', () => {
  it('lists what is still missing, in order', () => {
    expect(blockers(reg())).toEqual(['Not reviewed yet', 'Fee not marked paid']);
    expect(blockers(reg({ status: 'accepted', insurance: 'proof_pending', feePaid: true }))).toEqual(['Insurance proof not received', 'Not checked in', 'Kit not passed']);
    expect(blockers(reg({ status: 'accepted', insurance: 'needs_cover', feeDueCents: 0 }))[0]).toBe('No insurance cover yet');
  });
  it('a fully ready fighter has nothing outstanding', () => {
    expect(blockers(reg({ status: 'accepted', feePaid: true, checkedIn: true, kitPassed: true }))).toEqual([]);
  });
  it('volunteers need no kit check', () => {
    expect(blockers(reg({ status: 'accepted', isVolunteer: true, feeDueCents: 0, checkedIn: true }))).toEqual([]);
  });
  it('filters by status and searches name, team and category', () => {
    const list = [reg({ id: '1' }), reg({ id: '2', status: 'accepted', fullName: 'Grace Hopper', teamName: 'Northgate', categories: [{ competitionId: 'c2', name: 'Polearm (women)', details: {} }] })];
    expect(filterRegistrations(list, 'pending', '').map(r => r.id)).toEqual(['1']);
    expect(filterRegistrations(list, 'all', 'north').map(r => r.id)).toEqual(['2']);
    expect(filterRegistrations(list, 'all', 'polearm').map(r => r.id)).toEqual(['2']);
    expect(filterRegistrations(list, 'all', '').length).toBe(2);
  });
  it('counts by status', () => expect(countByStatus([reg(), reg({ status: 'accepted' }), reg({ status: 'accepted' })])).toEqual({ pending: 1, accepted: 2, declined: 0, withdrawn: 0 }));
});
