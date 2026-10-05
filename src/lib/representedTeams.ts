import type { RepresentedBasis } from '../data/matches';

/**
 * Wording for Manage > Run > "Teams represented": the team an individual fighter fought for in one competition, which is what their points
 * count toward in the team discipline totals. A correction changes only that competition, never the fighter's current team.
 */

export const REASON_MIN = 3;
export const REASON_MAX = 200;

/** How the team is known, in plain words. */
export function basisLabel(basis: RepresentedBasis | null, hasTeam: boolean): string {
  if (!hasTeam) return basis === 'correction' ? 'Set to no team by an organizer' : 'No team recorded';
  switch (basis) {
    case 'registration': return 'From their registration for this event';
    case 'team_at_entry': return 'Their team when they were entered';
    case 'recorded': return 'Recorded with the results';
    case 'correction': return 'Corrected by an organizer';
    default: return 'Recorded';
  }
}

/** Why Save is not possible yet, or null when it is. '' as a team means "no team". */
export function correctionProblem(currentTeamId: string | null, chosenTeamId: string, reason: string): string | null {
  if ((chosenTeamId || null) === currentTeamId) return 'Choose a different team.';
  if (reason.trim().length < REASON_MIN) return 'Say why you are changing it.';
  return null;
}

/** The confirmation shown after a correction. */
export const savedText = (fighter: string, teamName: string | null, competition: string): string =>
  teamName
    ? `Saved. ${fighter}'s points in ${competition} now count for ${teamName}. Their current team is unchanged.`
    : `Saved. ${fighter}'s points in ${competition} now count for no team. Their current team is unchanged.`;
