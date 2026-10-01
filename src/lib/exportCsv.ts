import type { ManagedRegistration } from '../data/manage';

/**
 * CSV export of registrations for organizers. Pure: no network, no DOM.
 * Health data is never exported. The columns below are listed by hand, so the medical note (and the free-text notes,
 * which people sometimes use for health details) can never slip in by adding a field to the registration type.
 */

/** Cells that a spreadsheet would treat as a formula start with one of these. A tab or carriage return can hide one. */
const FORMULA_START = /^[=+\-@\t\r]/;

type Cell = string | number | boolean | null | undefined;

/** One cell, safe to paste into Excel or Sheets: formulas are defused with a leading apostrophe, then quoted if needed. */
export function csvCell(value: Cell): string {
  let s = value == null ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text. CRLF line endings, as RFC 4180 asks and spreadsheets expect. */
export function toCsv(rows: Cell[][]): string {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface ExportOptions {
  /** Emergency contact name, relationship and phone. Off by default: organizers opt in. */
  includeEmergency?: boolean;
}

const DAY: Record<string, string> = { sat: 'Saturday', sun: 'Sunday' };

export function registrationsCsv(regs: ManagedRegistration[], opts: ExportOptions = {}): string {
  const head = ['Name', 'Status', 'Gender', 'Organization', 'Province', 'Team', 'Mercenary', 'Volunteer', 'Volunteer roles', 'Categories', 'BI profile',
    'Email', 'Insurance', 'Fee due (CAD)', 'Fee paid', 'Days', 'Shares equipment', 'Checked in', 'Kit passed', 'Registered at'];
  if (opts.includeEmergency) head.push('Emergency contact', 'Emergency relationship', 'Emergency phone');
  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const body = regs.map(r => {
    const row: Cell[] = [
      r.fullName, r.status, r.gender, r.organization, r.province, r.teamName, yn(r.mercenary), yn(r.isVolunteer), r.volunteerRoles.join('; '),
      r.categories.map(c => c.name + (c.details.weight ? ` (${c.details.weight} kg)` : '')).join('; '), r.biProfile,
      r.email, r.insurance, (r.feeDueCents / 100).toFixed(2), r.feeDueCents > 0 ? yn(r.feePaid) : 'n/a',
      r.days.map(d => DAY[d] ?? d).join('; '), yn(r.sharesEquipment), yn(r.checkedIn), yn(r.kitPassed), r.createdAt
    ];
    if (opts.includeEmergency) row.push(r.emergencyName, r.emergencyRelationship, r.emergencyPhone);
    return row;
  });
  return toCsv([head, ...body]);
}

export const exportFileName = (slug: string, day: Date, withEmergency: boolean) =>
  `${slug}-registrations${withEmergency ? '-with-emergency-contacts' : ''}-${day.toISOString().slice(0, 10)}.csv`;
