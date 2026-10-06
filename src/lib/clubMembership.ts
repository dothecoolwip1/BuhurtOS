/**
 * Club membership (Red Deer Reavers first): words, filters and counts for the membership screens. Pure functions only.
 * Nothing here decides who may vote: eligibility and its reasons come from the database (private.club_vote_check). This file only
 * counts and filters what the database returned.
 */

export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'removed';
export type DuesStatus = 'unpaid' | 'paid' | 'waived' | 'gear_contribution';

export interface RosterMember {
  membershipId: string;
  fullName: string;
  email: string | null;
  discordName: string | null;
  status: MembershipStatus;
  appliedAt: string;
  isAdult: boolean | null;
  duesStatus: DuesStatus;
  duesAmountCents: number | null;
  duesNote: string | null;
  duesChangedAt: string | null;
  duesChangedByName: string | null;
  eligible: boolean;
  reasonCodes: string[];
  reasons: string[];
  offices: string[];
  statusNote: string | null;
}

export const MEMBERSHIP_LABEL: Record<MembershipStatus, string> = { pending: 'Pending', active: 'Active', inactive: 'Inactive', removed: 'Removed' };
export const DUES_LABEL: Record<DuesStatus, string> = { unpaid: 'Unpaid', paid: 'Paid', waived: 'Waived', gear_contribution: 'Gear contribution' };
export const DUES_OPTIONS: readonly DuesStatus[] = ['paid', 'unpaid', 'waived', 'gear_contribution'];
export const MEMBERSHIP_OPTIONS: readonly MembershipStatus[] = ['active', 'pending', 'inactive', 'removed'];

/** Paid, Waived and a recorded Gear contribution meet the dues requirement; Unpaid does not. Mirrors the database rule for display only. */
export const duesSatisfied = (s: DuesStatus): boolean => s !== 'unpaid';

export type RosterFilter = 'all' | 'eligible' | 'not_eligible' | 'paid' | 'unpaid' | 'pending' | 'active';
export const ROSTER_FILTERS: readonly (readonly [RosterFilter, string])[] = [
  ['all', 'All'], ['eligible', 'Can vote'], ['not_eligible', 'Cannot vote'], ['paid', 'Dues paid'], ['unpaid', 'Dues unpaid'], ['pending', 'Pending'], ['active', 'Active']
];

/** "Members" on the dashboard are everyone with a record this year except removed ones (removed stay visible under All for the record). */
export function filterRoster(rows: readonly RosterMember[], filter: RosterFilter, search = ''): RosterMember[] {
  const q = search.trim().toLowerCase();
  return rows.filter(r => {
    if (q && !`${r.fullName} ${r.discordName ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q)) return false;
    switch (filter) {
      case 'all': return true;
      case 'eligible': return r.eligible;
      case 'not_eligible': return !r.eligible && r.status !== 'removed';
      case 'paid': return r.status !== 'removed' && duesSatisfied(r.duesStatus);
      case 'unpaid': return r.status !== 'removed' && !duesSatisfied(r.duesStatus);
      case 'pending': return r.status === 'pending';
      case 'active': return r.status === 'active';
    }
  });
}

export interface RosterSummary { total: number; active: number; voting: number; duesPaid: number; duesOutstanding: number; pending: number }

/**
 * The six numbers at the top of the dashboard. Total = everyone not removed. Dues paid counts any dues requirement met (paid, waived, gear);
 * Dues outstanding = active or pending members whose dues are unpaid (inactive members owe nothing for voting purposes).
 */
export function summarize(rows: readonly RosterMember[]): RosterSummary {
  const live = rows.filter(r => r.status !== 'removed');
  return {
    total: live.length,
    active: live.filter(r => r.status === 'active').length,
    voting: rows.filter(r => r.eligible).length,
    duesPaid: live.filter(r => duesSatisfied(r.duesStatus)).length,
    duesOutstanding: live.filter(r => (r.status === 'active' || r.status === 'pending') && !duesSatisfied(r.duesStatus)).length,
    pending: live.filter(r => r.status === 'pending').length
  };
}

/** The AGM snapshot: who can vote, and everyone else (removed members are not listed) with the reason. Sorted by name. */
export function agmSnapshot(rows: readonly RosterMember[]): { voters: RosterMember[]; excluded: RosterMember[] } {
  const byName = (a: RosterMember, b: RosterMember) => a.fullName.localeCompare(b.fullName);
  return {
    voters: rows.filter(r => r.eligible).sort(byName),
    excluded: rows.filter(r => !r.eligible && r.status !== 'removed').sort(byName)
  };
}

export const money = (cents: number | null | undefined): string =>
  cents == null ? '' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** "$20" -> 2000. Empty -> null. Anything that is not a sensible amount -> NaN (the form says so). */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/^\$/, '');
  if (s === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

export interface DuesChange {
  id: number; membershipId: string; membershipYear: number; memberName: string; previousStatus: DuesStatus | null; newStatus: DuesStatus;
  previousAmountCents: number | null; newAmountCents: number | null; changedByName: string; changedByOffice: string; changedAt: string; note: string | null;
}

/** "Garrett Robson (Treasurer) changed John Smith's 2026 dues from Unpaid to Paid on October 6, 2026." */
export function historySentence(h: DuesChange, timeZone?: string): string {
  const when = new Date(h.changedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone });
  const from = h.previousStatus ? DUES_LABEL[h.previousStatus] : 'no record';
  const amount = h.newAmountCents != null ? ` (${money(h.newAmountCents)})` : '';
  return `${h.changedByName} (${h.changedByOffice}) changed ${h.memberName}'s ${h.membershipYear} dues from ${from} to ${DUES_LABEL[h.newStatus]}${amount} on ${when}.`;
}

/** Age check for the application form: true when the date of birth makes the person at least `min` on `on` (ISO dates). */
export function isAtLeast(dobIso: string, min: number, onIso: string): boolean {
  const [y, m, d] = dobIso.split('-').map(Number);
  const [ty, tm, td] = onIso.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= min;
}
