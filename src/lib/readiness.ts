/**
 * Pack 16: pure helpers for the check-in desk. The readiness answer itself comes from the database (event_readiness); this file only sorts,
 * filters, counts and words it, so it can be tested without a browser.
 */
export type Attendance = 'expected' | 'arrived' | 'checked_in' | 'withdrawn';
export type Inspection = 'not_inspected' | 'passed' | 'conditional' | 'failed' | 'not_needed';
export type InspectionIssue = 'armour' | 'helmet' | 'gloves' | 'weapon' | 'shield' | 'footwear' | 'missing_equipment' | 'other';

export interface ReadinessRow {
  registrationId: string; fighterId: string | null; fullName: string; teamId: string | null; teamName: string | null; competitions: string[];
  isVolunteer: boolean; status: string; attendance: Attendance; inspection: Inspection; issues: InspectionIssue[]; note: string | null;
  inspectedAt: string | null; inspectedBy: string | null; reinspected: boolean; insuranceOk: boolean; feeOk: boolean;
  overrideActive: boolean; overrideReason: string | null; profight: boolean; declaredWeight: string | null; weightKg: number | null;
  ready: boolean; reasons: string[];
}

export const ISSUES: readonly (readonly [InspectionIssue, string])[] = [
  ['armour', 'Armour'], ['helmet', 'Helmet'], ['gloves', 'Gloves'], ['weapon', 'Weapon'], ['shield', 'Shield'], ['footwear', 'Footwear'], ['missing_equipment', 'Missing equipment'], ['other', 'Other']
];
export const issueLabel = (i: InspectionIssue): string => ISSUES.find(([k]) => k === i)?.[1] ?? i;

export const ATTENDANCE_LABEL: Record<Attendance, string> = { expected: 'Not here yet', arrived: 'Arrived', checked_in: 'Checked in', withdrawn: 'Withdrawn' };
export const INSPECTION_LABEL: Record<Inspection, string> = {
  not_inspected: 'Not inspected', passed: 'Armour passed', conditional: 'Needs correction', failed: 'Failed inspection', not_needed: 'No inspection (volunteer)'
};

export type ReadinessFilter = 'all' | 'not_ready' | 'missing' | 'arrived' | 'needs_inspection' | 'issues' | 'ready';
export const FILTER_LABEL: Record<ReadinessFilter, string> = {
  all: 'Everyone', not_ready: 'Not ready', missing: 'Not here yet', arrived: 'Arrived, not checked in', needs_inspection: 'Needs inspection', issues: 'Armour issues', ready: 'Ready'
};

/** Only people who are part of the day: accepted (and the pending ones, so they are not forgotten). Withdrawn people are counted apart. */
const active = (r: ReadinessRow) => r.status === 'accepted' || r.status === 'pending';

export function matchesFilter(r: ReadinessRow, f: ReadinessFilter): boolean {
  if (f === 'all') return r.status !== 'withdrawn';
  if (!active(r)) return false;
  switch (f) {
    case 'not_ready': return !r.ready;
    case 'missing': return r.attendance === 'expected';
    case 'arrived': return r.attendance === 'arrived';
    case 'needs_inspection': return r.inspection === 'not_inspected';
    case 'issues': return r.inspection === 'conditional' || r.inspection === 'failed';
    case 'ready': return r.ready;
  }
}

export function matchesQuery(r: ReadinessRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.fullName, r.teamName ?? '', ...r.competitions].some(s => s.toLowerCase().includes(q));
}

export interface DeskFilters { filter: ReadinessFilter; query: string; team: string | null; competition: string | null }
export function filterDesk(rows: readonly ReadinessRow[], f: DeskFilters): ReadinessRow[] {
  return rows.filter(r => matchesFilter(r, f.filter) && matchesQuery(r, f.query) && (!f.team || r.teamName === f.team) && (!f.competition || r.competitions.includes(f.competition)));
}

export interface DeskCounts { expected: number; arrived: number; checkedIn: number; needsInspection: number; issues: number; ready: number; missing: number; withdrawn: number }
export function deskCounts(rows: readonly ReadinessRow[]): DeskCounts {
  const acc = rows.filter(r => r.status === 'accepted');
  return {
    expected: acc.length,
    arrived: acc.filter(r => r.attendance === 'arrived' || r.attendance === 'checked_in').length,
    checkedIn: acc.filter(r => r.attendance === 'checked_in').length,
    needsInspection: acc.filter(r => r.inspection === 'not_inspected').length,
    issues: acc.filter(r => r.inspection === 'conditional' || r.inspection === 'failed').length,
    ready: acc.filter(r => r.ready).length,
    missing: acc.filter(r => r.attendance === 'expected').length,
    withdrawn: rows.filter(r => r.status === 'withdrawn').length
  };
}

/** Most urgent first: not ready before ready, then by name. A QR-scanned person can be pinned to the top by the caller. */
export function sortDesk(rows: readonly ReadinessRow[], pinned?: string | null): ReadinessRow[] {
  // Alphabetical, so a card does not jump when its status changes under the desk's thumb; the counts and filters give the status view.
  return [...rows].sort((a, b) => Number(b.registrationId === pinned) - Number(a.registrationId === pinned) || a.fullName.localeCompare(b.fullName));
}

/** The team names and competitions present, for the filter menus. */
export function filterOptions(rows: readonly ReadinessRow[]): { teams: string[]; competitions: string[] } {
  const teams = new Set<string>(), comps = new Set<string>();
  for (const r of rows) { if (r.teamName) teams.add(r.teamName); r.competitions.forEach(c => comps.add(c)); }
  return { teams: [...teams].sort(), competitions: [...comps].sort() };
}

/** What the check-in QR code holds: only the event-day desk address and an opaque registration id. No name or personal data. */
export const checkinQrPath = (eventSlug: string, registrationId: string): string => `/events/${eventSlug}/checkin?r=${encodeURIComponent(registrationId)}`;

/** Full link for a check-in code. Carries only the event slug and the registration id: no name, no personal data. */
export function checkinUrl(origin: string, base: string, slug: string, regId: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${origin}${b}${checkinQrPath(slug, regId)}`;
}

/** "7/8 checked in · 6/8 ready" for a captain. */
export function teamSummary(rows: readonly { isVolunteer: boolean; attendance: Attendance; ready: boolean }[]): string {
  const fighters = rows.filter(r => !r.isVolunteer);
  const n = fighters.length;
  return `${fighters.filter(r => r.attendance === 'checked_in').length}/${n} checked in · ${fighters.filter(r => r.ready).length}/${n} ready`;
}

/**
 * The Lyst warning for one fight: one line per fighter who is tracked and not ready ("Brann Oakley: Armour needs correction").
 * A fighter with no registration (organizer-added) is not tracked and never warned about. Empty means nothing to show.
 */
export function matchWarnings(sides: readonly { name: string; tracked: boolean; ready: boolean; reasons: readonly string[] }[]): string[] {
  return sides.filter(s => s.tracked && !s.ready).map(s => `${s.name}: ${s.reasons.length ? s.reasons.join(', ').replace(/^./, c => c.toLowerCase()) : 'not ready'}`);
}

/** Pack 22: a readiness reason that is a suspension. It BLOCKS check-in and entry; no readiness override clears it (lifting the suspension does). */
export const isDisciplineBlock = (reason: string) => /^Suspended\b/.test(reason);
export const disciplineBlock = (reasons: readonly string[]) => reasons.find(isDisciplineBlock) ?? null;
