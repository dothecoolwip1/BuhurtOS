import type { ClaimOutcome, MyClaim, UnclaimedFighter } from '../data/claims';

/** "3 competitions · last at Event One": what the claimant sees to recognise their own history. */
export function historyLine(f: Pick<UnclaimedFighter, 'entries' | 'lastEvent'>): string {
  if (f.entries === 0) return 'No competitions recorded yet';
  return `${f.entries} ${f.entries === 1 ? 'competition' : 'competitions'}${f.lastEvent ? ` · last at ${f.lastEvent}` : ''}`;
}

export function claimStatusText(c: Pick<MyClaim, 'status' | 'needsReview'>): string {
  switch (c.status) {
    case 'pending': return c.needsReview ? 'Waiting for review. You already have a fighter profile, so an administrator checks whether the two are the same person.' : 'Waiting for an administrator to confirm it is you.';
    case 'approved': return 'Approved. This profile is yours, with all its history.';
    case 'declined': return 'Not approved.';
    default: return 'Cancelled.';
  }
}

/** What the administrator is told after deciding. A refused approval is never reported as a success. */
export function outcomeText(o: ClaimOutcome, fighterName: string): string {
  switch (o) {
    case 'approved': return `${fighterName} now belongs to that account. Their history stayed on the same profile.`;
    case 'declined': return 'Claim declined. The person is told.';
    case 'already_claimed': return `${fighterName} already belongs to another account, so this claim was closed without linking anything.`;
    case 'account_has_fighter': return 'That account already has its own fighter profile. Nothing was linked; the two are queued under Fighter identities to decide deliberately.';
  }
}

export const claimNoteProblem = (note: string): string | null => (note.trim().length < 3 ? 'Say how this was decided (at least 3 characters).' : note.trim().length > 300 ? 'Keep the note under 300 characters.' : null);

/** Why a look-alike pair is in the identity list. */
export function reviewHeading(source: string): string {
  switch (source) {
    case 'registration': return 'Same name, found when a registration was accepted';
    case 'team_join': return 'Same name, found when a team request was accepted';
    case 'organizer_entry': return 'Same name, found when an organizer added a new fighter';
    case 'claim': return 'Found when someone who already has a profile asked to claim another';
    default: return 'Possible duplicate';
  }
}
