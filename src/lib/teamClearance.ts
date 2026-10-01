/** One person on a team's roster for an event, as the team_clearance database function returns it. No health or contact data. */
export interface ClearanceRow {
  registrationId: string; fullName: string; status: 'pending' | 'accepted'; isVolunteer: boolean;
  waiverSigned: boolean; insuranceOk: boolean; checkedIn: boolean; kitPassed: boolean;
}

/** What a person still lacks, in plain words. Check-in and kit only count once an organizer has accepted them. */
export function missingItems(r: ClearanceRow): string[] {
  const out: string[] = [];
  if (!r.waiverSigned) out.push('Waiver');
  if (!r.insuranceOk) out.push('Insurance');
  if (r.status === 'pending') out.push('Waiting for organizer review');
  if (r.status === 'accepted' && !r.checkedIn) out.push('Check-in');
  if (r.status === 'accepted' && !r.isVolunteer && !r.kitPassed) out.push('Kit check');
  return out;
}

export interface ClearanceSummary { total: number; ready: number; missingWaiver: number; missingInsurance: number; notCheckedIn: number }

export function summarizeClearance(rows: ClearanceRow[]): ClearanceSummary {
  return {
    total: rows.length,
    ready: rows.filter(r => missingItems(r).length === 0).length,
    missingWaiver: rows.filter(r => !r.waiverSigned).length,
    missingInsurance: rows.filter(r => !r.insuranceOk).length,
    notCheckedIn: rows.filter(r => !r.checkedIn).length
  };
}

/** People who need chasing come first; within each group, alphabetical. */
export function sortForChasing(rows: ClearanceRow[]): ClearanceRow[] {
  return [...rows].sort((a, b) => Number(missingItems(a).length === 0) - Number(missingItems(b).length === 0) || a.fullName.localeCompare(b.fullName));
}
