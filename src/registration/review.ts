import type { Insurance, ManagedRegistration, RegStatus } from '../data/manage';
import type { MembershipContext } from './model';

/** HACSA event wording. hacsa_member and mcc_member always read as exactly that, in any event: they are real, historical answers. */
export const INSURANCE_LABEL: Record<Insurance, string> = {
  hacsa_member: 'HACSA member', mcc_member: 'MCC member', proof_received: 'Proof received', proof_pending: 'Proof pending', needs_cover: 'Needs cover (temporary HACSA)'
};
/** Any other event: only "needs cover" changes, because it no longer names HACSA's temporary membership. */
const GENERIC_LABEL: Record<Insurance, string> = { ...INSURANCE_LABEL, needs_cover: 'Needs cover' };

/** The words for a stored insurance answer; an unknown code is shown as it is. */
export const insuranceLabel = (code: string, ctx: MembershipContext): string =>
  (ctx === 'hacsa' ? INSURANCE_LABEL : GENERIC_LABEL)[code as Insurance] ?? code;

/** What the organizer may set. Outside a HACSA event, HACSA/MCC membership appears only when it is the registration's current answer. */
export function organizerInsuranceChoices(ctx: MembershipContext, current: Insurance | string): Insurance[] {
  if (ctx === 'hacsa') return Object.keys(INSURANCE_LABEL) as Insurance[];
  const legacy = (['hacsa_member', 'mcc_member'] as Insurance[]).filter(k => k === current);
  return [...legacy, 'proof_received', 'proof_pending', 'needs_cover'];
}
export const insuranceOk = (i: Insurance) => i === 'hacsa_member' || i === 'mcc_member' || i === 'proof_received';

export type ReviewFilter = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'all';

/** What still stands between a registration and being ready to fight. Plain words, in the order an organizer would chase them. */
export function blockers(r: ManagedRegistration): string[] {
  const out: string[] = [];
  if (r.status === 'pending') out.push('Not reviewed yet');
  if (!insuranceOk(r.insurance)) out.push(r.insurance === 'needs_cover' ? 'No insurance cover yet' : 'Insurance proof not received');
  if (r.feeDueCents > 0 && !r.feePaid) out.push('Fee not marked paid');
  if (r.status === 'accepted' && !r.checkedIn) out.push('Not checked in');
  if (r.status === 'accepted' && !r.isVolunteer && !r.kitPassed) out.push('Kit not passed');
  return out;
}

export function filterRegistrations(list: ManagedRegistration[], filter: ReviewFilter, query: string): ManagedRegistration[] {
  const q = query.trim().toLowerCase();
  return list.filter(r => (filter === 'all' ? true : r.status === filter)
    && (!q || r.fullName.toLowerCase().includes(q) || (r.teamName ?? '').toLowerCase().includes(q) || r.categories.some(c => c.name.toLowerCase().includes(q))));
}

export function countByStatus(list: ManagedRegistration[]): Record<RegStatus, number> {
  const c: Record<RegStatus, number> = { pending: 0, accepted: 0, declined: 0, withdrawn: 0 };
  for (const r of list) c[r.status]++;
  return c;
}
