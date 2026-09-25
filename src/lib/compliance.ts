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

export function checkPhysicalCompliance(
  entry: RosterEntry,
  requirements: RulesetSettings['compliance'] = defaultComplianceRequirements
): ComplianceResult {
  const missing: string[] = [];
  if (requirements.requireCheckIn && !entry.checkedIn) missing.push('check in');
  if (requirements.requireArmorClearance && !entry.armorCleared) missing.push('armor clearance');
  if (requirements.requireMedicalClearance && !entry.medicalCleared) missing.push('medical clearance');
  if (requirements.requireWaiver && !entry.waiverConfirmed) missing.push('waiver');
  if (requirements.requireWeighIn && !entry.weighInCleared) missing.push('weigh in');
  if (entry.attendanceStatus !== 'approved') missing.push('registration approval');
  return { eligible: missing.length === 0, missing };
}

export function checkCompliance(
  entry: RosterEntry,
  requirements: RulesetSettings['compliance'] = defaultComplianceRequirements
): ComplianceResult {
  const physical = checkPhysicalCompliance(entry, requirements);
  const missing = [...physical.missing];
  if (!entry.competitionCleared) missing.push('competition clearance');
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
