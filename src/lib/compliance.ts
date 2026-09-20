import type { RosterEntry } from '../types';

export interface ComplianceResult {
  eligible: boolean;
  missing: string[];
}

export function checkCompliance(entry: RosterEntry): ComplianceResult {
  const missing: string[] = [];
  if (!entry.checkedIn) missing.push('check in');
  if (!entry.armorCleared) missing.push('armor clearance');
  if (!entry.medicalCleared) missing.push('medical clearance');
  if (!entry.waiverConfirmed) missing.push('waiver');
  if (entry.attendanceStatus === 'withdrawn' || entry.attendanceStatus === 'no_show') missing.push(entry.attendanceStatus.replace('_', ' '));
  return { eligible: missing.length === 0, missing };
}

export function assertParticipantsCompliant(entries: RosterEntry[]): void {
  const blocked = entries.map(entry => ({ entry, result: checkCompliance(entry) })).filter(item => !item.result.eligible);
  if (blocked.length) {
    throw new Error(blocked.map(item => `${item.entry.displayName}: ${item.result.missing.join(', ')}`).join('; '));
  }
}
