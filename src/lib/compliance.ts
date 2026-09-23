import type { RosterEntry, RulesetSettings } from '../types';

export interface ComplianceResult {
  eligible: boolean;
  missing: string[];
}

export const defaultComplianceRequirements: RulesetSettings['compliance'] = {
  requireCheckIn: true,
  requireArmorClearance: true,
  requireMedicalClearance: true,
  requireWaiver: true,
  requireWeighIn: true
};

export function checkCompliance(
  entry: RosterEntry,
  requirements: RulesetSettings['compliance'] = defaultComplianceRequirements
): ComplianceResult {
  const missing: string[] = [];
  if (requirements.requireCheckIn && !entry.checkedIn) missing.push('check in');
  if (requirements.requireArmorClearance && !entry.armorCleared) missing.push('armor clearance');
  if (requirements.requireMedicalClearance && !entry.medicalCleared) missing.push('medical clearance');
  if (requirements.requireWaiver && !entry.waiverConfirmed) missing.push('waiver');
  if (requirements.requireWeighIn && !entry.weighInCleared) missing.push('weigh in');
  if (entry.attendanceStatus === 'withdrawn' || entry.attendanceStatus === 'no_show') missing.push(entry.attendanceStatus.replace('_', ' '));
  return { eligible: missing.length === 0, missing };
}

export function assertParticipantsCompliant(
  entries: RosterEntry[],
  requirements: RulesetSettings['compliance'] = defaultComplianceRequirements
): void {
  const blocked = entries.map(entry => ({ entry, result: checkCompliance(entry, requirements) })).filter(item => !item.result.eligible);
  if (blocked.length) {
    throw new Error(blocked.map(item => `${item.entry.displayName}: ${item.result.missing.join(', ')}`).join('; '));
  }
}
