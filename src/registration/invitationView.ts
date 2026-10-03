import type { EventInvitation } from '../data/invitations';

/** Plain-language states for an organizer-added fighter. Being added is never "registered": the fighter completes the form and waiver. */
export type InvitationState = 'no_account' | 'pending_confirmation' | 'ready' | 'withdrawn' | 'cancelled';

export function invitationState(i: Pick<EventInvitation, 'status' | 'hasAccount' | 'registrationStatus'>): InvitationState {
  if (i.status === 'withdrawn') return 'withdrawn';
  if (i.status === 'cancelled') return 'cancelled';
  if (i.status === 'registered') return i.registrationStatus === 'withdrawn' ? 'withdrawn' : 'ready';
  return i.hasAccount ? 'pending_confirmation' : 'no_account';
}

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  no_account: 'Invited: no linked account', pending_confirmation: 'Pending fighter confirmation', ready: 'Ready', withdrawn: 'Withdrawn', cancelled: 'Cancelled'
};

/** What the fighter still has to do themselves, in the order they will meet it. Empty once they are ready. */
export function invitationTodo(i: Pick<EventInvitation, 'status' | 'hasAccount' | 'registrationStatus'>): string[] {
  const s = invitationState(i);
  if (s === 'ready' || s === 'withdrawn' || s === 'cancelled') return [];
  const out = s === 'no_account' ? ['Cannot confirm until the fighter claims this record with a BuhurtOS account'] : [];
  return [...out, 'Pending form submission', 'Pending waiver'];
}

/** Every network-visible word the organizer sees under the name: "Added by organizer · Pending waiver · Pending form submission". */
export function invitationSummary(i: Pick<EventInvitation, 'status' | 'hasAccount' | 'registrationStatus'>): string {
  return ['Added by organizer', INVITATION_STATE_LABEL[invitationState(i)], ...invitationTodo(i).filter(t => !t.startsWith('Cannot'))].join(' · ');
}

export const countInvitationStates = (list: readonly Pick<EventInvitation, 'status' | 'hasAccount' | 'registrationStatus'>[]): Record<InvitationState, number> => {
  const c: Record<InvitationState, number> = { no_account: 0, pending_confirmation: 0, ready: 0, withdrawn: 0, cancelled: 0 };
  for (const i of list) c[invitationState(i)]++;
  return c;
};
