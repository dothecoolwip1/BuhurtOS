import type { ManagedRegistration } from '../data/manage';
import { blockers } from './review';

export type CheckinFilter = 'todo' | 'blocked' | 'ready' | 'all';
export type CheckinOverride = { checkedIn?: boolean; kitPassed?: boolean };

/** Why an accepted person cannot simply be waved through. Only insurance and fee are stored today; the waiver is not recorded in the registration data yet. */
export function blockReasons(r: ManagedRegistration): string[] {
  return blockers(r).filter(b => /insurance|fee/i.test(b));
}

/** "Blocked because: insurance, fee" in plain words, or null when nothing blocks them. */
export function blockedBecause(r: ManagedRegistration): string | null {
  const reasons = blockReasons(r).map(b => (/insurance/i.test(b) ? 'insurance' : 'fee'));
  return reasons.length ? `Blocked because: ${[...new Set(reasons)].join(', ')}` : null;
}

export const isBlocked = (r: ManagedRegistration) => r.status === 'accepted' && blockReasons(r).length > 0;
export const isCleared = (r: ManagedRegistration) => r.status === 'accepted' && blockers(r).length === 0;

export function applyOverride(r: ManagedRegistration, o: CheckinOverride | undefined): ManagedRegistration {
  return o ? { ...r, checkedIn: o.checkedIn ?? r.checkedIn, kitPassed: o.kitPassed ?? r.kitPassed } : r;
}

export function matchesCheckinFilter(r: ManagedRegistration, f: CheckinFilter): boolean {
  if (r.status !== 'accepted') return false;
  if (f === 'all') return true;
  if (f === 'todo') return !r.checkedIn;
  if (f === 'blocked') return isBlocked(r);
  return blockReasons(r).length === 0 && !r.checkedIn;
}

export function matchesSearch(r: ManagedRegistration, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.fullName, r.teamName ?? '', r.organization, ...r.categories.map(c => c.name)].some(s => s.toLowerCase().includes(q));
}

export function filterCheckin(list: ManagedRegistration[], f: CheckinFilter, query: string): ManagedRegistration[] {
  return list.filter(r => matchesCheckinFilter(r, f) && matchesSearch(r, query));
}

export interface CheckinCounts { accepted: number; checkedIn: number; todo: number; blocked: number; ready: number; kitPending: number }
export function checkinCounts(list: ManagedRegistration[]): CheckinCounts {
  const acc = list.filter(r => r.status === 'accepted');
  return {
    accepted: acc.length,
    checkedIn: acc.filter(r => r.checkedIn).length,
    todo: acc.filter(r => !r.checkedIn).length,
    blocked: acc.filter(isBlocked).length,
    ready: acc.filter(r => matchesCheckinFilter(r, 'ready')).length,
    kitPending: acc.filter(r => !r.isVolunteer && !r.kitPassed).length
  };
}

export type AttentionKind = 'pending' | 'blocked' | 'unpaid' | 'teams';
export interface AttentionItem { kind: AttentionKind; count: number; label: string }

/** The "needs attention now" strip. Zero-count items are left out; teamsWithoutCaptain is only shown when the caller knows it. */
export function attentionItems(list: ManagedRegistration[], teamsWithoutCaptain?: number): AttentionItem[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const pending = list.filter(r => r.status === 'pending').length;
  const blocked = list.filter(isBlocked).length;
  const unpaid = list.filter(r => (r.status === 'pending' || r.status === 'accepted') && r.feeDueCents > 0 && !r.feePaid).length;
  const out: AttentionItem[] = [
    { kind: 'pending', count: pending, label: `${plural(pending, 'registration', 'registrations')} to review` },
    { kind: 'blocked', count: blocked, label: `${plural(blocked, 'accepted fighter', 'accepted fighters')} blocked` },
    { kind: 'unpaid', count: unpaid, label: `${unpaid} unpaid` }
  ];
  if (teamsWithoutCaptain !== undefined) out.push({ kind: 'teams', count: teamsWithoutCaptain, label: `${plural(teamsWithoutCaptain, 'team', 'teams')} without a captain` });
  return out.filter(i => i.count > 0);
}
