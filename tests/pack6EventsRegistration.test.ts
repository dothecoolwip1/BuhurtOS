import { describe, expect, it } from 'vitest';
import { checkCompliance, checkPhysicalCompliance } from '../src/lib/compliance';
import type { RosterEntry } from '../src/types';

const entry = (overrides: Partial<RosterEntry> = {}): RosterEntry => ({
  id: 'r1',
  organizationId: 'o1',
  eventId: 'e1',
  entryType: 'fighter',
  displayName: 'Fighter',
  checkedIn: true,
  armorCleared: true,
  medicalCleared: true,
  waiverConfirmed: true,
  weighInCleared: true,
  competitionCleared: false,
  attendanceStatus: 'approved',
  ...overrides
});

describe('Pack 6 competition clearance', () => {
  it('keeps physical readiness separate from final marshal clearance', () => {
    expect(checkPhysicalCompliance(entry()).eligible).toBe(true);
    expect(checkCompliance(entry()).eligible).toBe(false);
    expect(checkCompliance(entry()).missing).toContain('competition clearance');
  });

  it('requires approved registration before physical readiness', () => {
    const result = checkPhysicalCompliance(entry({ attendanceStatus: 'registered' }));
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain('registration approval');
  });

  it('becomes competition-ready only after explicit final clearance', () => {
    expect(checkCompliance(entry({ competitionCleared: true })).eligible).toBe(true);
  });

  it('still reports revoked physical checks after a final clearance flag', () => {
    const result = checkCompliance(entry({ competitionCleared: true, armorCleared: false }));
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain('armor clearance');
  });
});
